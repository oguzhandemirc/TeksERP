// =============================================================================
// Test: ELLE EKLENEN TOPU GERİ ALMA (undo MANUAL modu) + yan sözleşmeler
// Çalıştır: npx tsx scripts/test_manual_roll_undo.ts
// =============================================================================
// SAHA SORUSU (2026-08-05): "Bir partiye manuel top ekledim, yanlış olabilir.
// Bu işlemi nasıl geri alacağım?"
//
// Araştırma şunu buldu: doğru MOTOR zaten vardı (`softDelete` → CANCELLED,
// açık hareket qtyOut=0 ile kapanır — sektördeki storno mantığı), ama onu
// sahaya açan hiçbir yüzey yoktu. Dahası, operatörün elindeki "Geri Al" butonu
// elle eklenen topun satırında GÖRÜNÜYOR ama backend 400 veriyordu ("Bu top bir
// Tambur kesim/finalize işleminin parçası değil") — yani operatör tam da "Geri
// Al" yazan modalda ÇIKMAZA giriyordu.
//
// Bu bekçi beş şeyi kilitler:
//   [1] MANUAL modu çözülüyor ve önizleme İPTAL EDİLECEK KAYDI somut listeliyor
//       (yıkıcı-işlem kuralı: "1 kayıt etkilenecek" gibi soyut sayı yetmez)
//   [2] Uygulama topu CANCELLED yapıyor, açık hareketi qtyOut=0 ile kapatıyor
//       (kurtarmanın qtyOut=qtyIn semantiğinden AYRI — orada mal gerçekten
//        vardı ve çıktı; burada kayıt baştan hatalıydı)
//   [3] EKLEME SEBEBİNİN HAREKET İZİ KORUNUYOR — softDelete eskiden notes'u
//       körlemesine "CANCELLED" ile eziyordu ve "bu top neden vardı" sorusunun
//       operasyonel cevabı siliniyordu
//   [4] Kapsam DAR: kesilmiş / istasyon işlemi görmüş / çuvaldaki top REDDEDİLİR
//       ve blockReason SEBEBİ SÖYLER (çıkmaz bırakmak, yanlış işlem yaptırmaktan
//       sonra en kötüsüdür)
//   [5] İptal edilmiş topun clientToken'ı REPLAY EDİLEMEZ — eskiden aynı token
//       tekrar gönderilince uç `success:true` + iptal edilmiş topun barkodunu
//       dönüyordu: operatör "eklendi" görür, envanterde top YOKTUR
//
// Fixture: `fixture-manual-move.ts` (4 adımlı WO, son adım Tambur). Cleanup
// finally'de; `TEST-` önekli.
// =============================================================================

import { randomUUID } from "crypto";
import prisma, { pool } from "../src/lib/prisma";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";
import { createManualMoveFixture } from "./fixture-manual-move";
import { RollStatus } from "@prisma/client";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const manual = new TamburManualService();
const undo = new TamburUndoService();

interface UndoPreview {
  mode: string;
  canApply: boolean;
  blockReason: string | null;
  parent: { id: string; barcode: string | null };
  children: Array<{ id: string; barcode: string | null; qty: number }>;
  warnings: string[];
}

function errInfo(e: unknown): { status?: number; code?: string; message?: string } {
  const err = e as
    | { statusCode?: number; message?: string; details?: Record<string, unknown> }
    | null;
  return {
    status: err?.statusCode,
    code: err?.details?.code as string | undefined,
    message: err?.message,
  };
}

async function main(): Promise<void> {
  const fx = await createManualMoveFixture(1);
  const stepId = fx.stepIdBySeq[4];
  const created: string[] = [];

  // Fixture topunu adıma koy — parti "açık" sayılsın (tek parti → sessiz bağlanır).
  await prisma.roll.update({
    where: { id: fx.rollIds[0] },
    data: { status: RollStatus.IN_PRODUCTION, currentStepId: stepId, batchId: fx.batchId },
  });

  const REASON = "Sayım farkı — fiziksel mal var";
  const addManual = async (qty: number, token = randomUUID()) => {
    const res = await manual.createManualRoll({
      targetStepId: stepId,
      initialQty: qty,
      reason: REASON,
      clientToken: token,
    });
    const d = res.data as { rollId: string; barcode: string | null };
    created.push(d.rollId);
    return { ...d, token };
  };

  try {
    // ── [1] ÖNİZLEME ─────────────────────────────────────────────────────────
    console.log("\n[1] MANUAL modu çözülüyor ve etkilenen kaydı somut listeliyor");
    const r1 = await addManual(123);
    const pv = ((await undo.getUndoPreview(r1.rollId)).data as unknown) as UndoPreview;
    check("mode = MANUAL", pv.mode === "MANUAL", pv.mode);
    check("canApply = true (hiç işlem görmemiş top)", pv.canApply === true, String(pv.blockReason));
    // Yıkıcı-işlem kuralı: SOYUT sayı yetmez, kaydın kendisi listelenir.
    check(
      "iptal edilecek kayıt barkoduyla listeleniyor",
      pv.children.length === 1 && pv.children[0].id === r1.rollId,
      `${pv.children.length} kayıt`,
    );
    check("metraj somut yazılı", pv.children[0]?.qty === 123, String(pv.children[0]?.qty));
    check(
      "parti uyarısı var (topun düşeceği yeri söylüyor)",
      pv.warnings.some((w) => /parti/i.test(w) || /P\d/.test(w)),
      pv.warnings.join(" | "),
    );

    // ── [2]+[3] UYGULAMA ─────────────────────────────────────────────────────
    console.log("\n[2] Uygulama: CANCELLED + hareket qtyOut=0 + SEBEP İZİ KORUNUR");
    const movBefore = await prisma.rollMovement.findFirst({
      where: { rollId: r1.rollId },
      select: { id: true, notes: true },
    });
    check(
      "ön koşul — ekleme hareketi sebebi taşıyor",
      Boolean(movBefore?.notes?.includes(REASON)),
      String(movBefore?.notes),
    );

    await undo.applyUndo(r1.rollId);
    const after = await prisma.roll.findUniqueOrThrow({
      where: { id: r1.rollId },
      select: { status: true, currentStepId: true, batchId: true },
    });
    check("top CANCELLED", after.status === RollStatus.CANCELLED, after.status);
    check("adımdan çıkarıldı", after.currentStepId === null);
    // Parti işaretçisi BİLEREK kalır: "hangi partiye yanlış top yazılmıştı" izi.
    check("parti bağı topta KALIR (iz)", after.batchId === fx.batchId, String(after.batchId));

    const movAfter = await prisma.rollMovement.findUniqueOrThrow({
      where: { id: movBefore!.id },
      select: { exitedAt: true, qtyOut: true, notes: true },
    });
    check("hareket kapandı", movAfter.exitedAt !== null);
    // qtyOut=0 = "mal bu istasyondan HİÇ geçmedi" (storno). Kurtarmanın
    // qtyOut=qtyIn'i olsaydı hiç var olmamış 123 m istasyon iş hacmine yazılırdı.
    check("qtyOut = 0 (storno semantiği)", Number(movAfter.qtyOut) === 0, String(movAfter.qtyOut));
    // ASIL İDDİA: sebep izi ezilmedi.
    check(
      "ekleme sebebi hareket notunda KORUNDU",
      Boolean(movAfter.notes?.includes(REASON)),
      String(movAfter.notes),
    );
    check(
      "not CANCELLED olarak da işaretli",
      Boolean(movAfter.notes?.startsWith("CANCELLED")),
      String(movAfter.notes),
    );

    // ── [4] KAPSAM DAR ───────────────────────────────────────────────────────
    console.log("\n[3] Kapsam dar: işlem görmüş top REDDEDİLİR ve SEBEBİ söylenir");
    // (a) zaten iptal
    const pvDone = ((await undo.getUndoPreview(r1.rollId)).data as unknown) as UndoPreview;
    check("iptal edilmiş topta canApply=false", pvDone.canApply === false);
    check(
      "sebep açık ('zaten iptal')",
      /zaten iptal/i.test(pvDone.blockReason ?? ""),
      String(pvDone.blockReason),
    );

    // (b) istasyon işlemi görmüş
    const r2 = await addManual(50);
    await prisma.rollOperation.create({
      data: {
        rollId: r2.rollId,
        workOrderStepId: stepId,
        operationType: "TAMBUR_PROCESSED",
      },
    });
    const pv2 = ((await undo.getUndoPreview(r2.rollId)).data as unknown) as UndoPreview;
    check("istasyon işlemi görmüş topta canApply=false", pv2.canApply === false);
    check(
      "sebep süpervizöre yönlendiriyor (çıkmaz yok)",
      /süpervizör/i.test(pv2.blockReason ?? ""),
      String(pv2.blockReason),
    );
    // apply de reddetmeli — preview'a güvenilmez (yıkıcı-işlem kuralı).
    let eApply = errInfo(null);
    try {
      await undo.applyUndo(r2.rollId);
      check("apply de reddetmeli", false, "kabul etti");
    } catch (e) {
      eApply = errInfo(e);
    }
    check("apply 409 döndü", eApply.status === 409, String(eApply.status));

    // (c) kesilmiş top
    const r3 = await addManual(80);
    const child = await prisma.roll.create({
      data: {
        barcode: `TEST-MU-CHILD-${randomUUID().slice(0, 8)}`,
        itemId: (await prisma.roll.findUniqueOrThrow({
          where: { id: r3.rollId },
          select: { itemId: true },
        })).itemId,
        status: RollStatus.WAREHOUSE,
        initialQty: 10,
        currentQty: 10,
        entrySource: "TAMBUR_SPLIT",
        parentRollId: r3.rollId,
      },
      select: { id: true },
    });
    created.push(child.id);
    const pv3 = ((await undo.getUndoPreview(r3.rollId)).data as unknown) as UndoPreview;
    // ⚠️ Kesilmiş topta mod artık MANUAL DEĞİL: çocuğu olan top FULL/SINGLE
    // yoluna girebilir. Önemli olan "sessizce iptal edilmemesi".
    check(
      "kesilmiş top elle-geri-alma ile İPTAL EDİLMEZ",
      pv3.mode !== "MANUAL" || pv3.canApply === false,
      `${pv3.mode} / canApply=${pv3.canApply}`,
    );

    // (d) çuvaldaki top
    const r4 = await addManual(60);
    const sack = await prisma.sack.create({
      data: { sackNo: `TEST-MU-CV-${Date.now().toString().slice(-8)}` },
      select: { id: true },
    });
    await prisma.roll.update({ where: { id: r4.rollId }, data: { sackId: sack.id } });
    const pv4 = ((await undo.getUndoPreview(r4.rollId)).data as unknown) as UndoPreview;
    check("çuvaldaki topta canApply=false", pv4.canApply === false);
    check(
      "sebep çuvalı işaret ediyor",
      /çuval/i.test(pv4.blockReason ?? ""),
      String(pv4.blockReason),
    );
    await prisma.roll.update({ where: { id: r4.rollId }, data: { sackId: null } });
    await prisma.sack.delete({ where: { id: sack.id } });

    // ── [5] İPTAL EDİLMİŞ TOKEN REPLAY EDİLEMEZ ──────────────────────────────
    console.log("\n[4] İptal edilmiş topun token'ı replay EDİLEMEZ (sessiz yanlış cevap)");
    let eReplay = errInfo(null);
    try {
      await addManual(123, r1.token);
      check("iptal edilmiş token reddedilmeli", false, "kabul etti");
    } catch (e) {
      eReplay = errInfo(e);
    }
    check("409 döndü", eReplay.status === 409, String(eReplay.status));
    check("code = ENTRY_CANCELLED", eReplay.code === "ENTRY_CANCELLED", String(eReplay.code));
    // Mesaj operatöre NE YAPACAĞINI söylemeli — "çakışma" demek yetmez.
    check(
      "mesaj yol gösteriyor (formu yeniden aç)",
      /yeniden aç/i.test(eReplay.message ?? ""),
      String(eReplay.message),
    );
  } finally {
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: created } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: created } } });
    // Çocuk önce (parentRollId FK).
    await prisma.roll.deleteMany({ where: { parentRollId: { in: created } } });
    await prisma.roll.deleteMany({ where: { id: { in: created } } });
    await fx.teardown();
    console.log("\n(temizlendi — TEST-MU fixture'ları silindi)");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
