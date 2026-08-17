// =============================================================================
// Test: "Manuel Top Ekle" — PARTİ BAĞLAMA sözleşmesi
// Çalıştır: npx tsx scripts/test_tambur_manual_batch.ts
// =============================================================================
// SAHA BULGUSU (2026-08-04): iş emrine elle eklenen top PARTİSİZ doğuyordu.
// Görünürdeki sonuç masumdu ("Parti: —"), gerçek sonuç iki katmanlıydı:
//
//   1) İZLENEBİLİRLİK KAYBI. Parti, "üretime aynı anda giren top grubu"dur ve
//      bir sorun çıktığında etki kümesini o tanımlar ("şu partide boya tutmadı,
//      hangi toplar etkilendi"). Partisiz top bu sorunun DIŞINDA kalır — üstelik
//      elle eklenen top, zincir dışı doğduğu için tam da en çok izlenmesi
//      gereken toptur.
//   2) GÖRÜNMEZLİK. Electron iş emri detayı topları PARTİYE göre grupluyor →
//      partisiz top "PARTİSİZ" kutusuna düşüyor, mobil Tambur listesinde ise
//      hiç görünmüyordu. Yani operatör topu ekliyor, ekranda bulamıyor, TEKRAR
//      ekliyor. (Aynı sınıf hata: kök CLAUDE.md "Buraya geliş ≠ oluşturma" —
//      statüyü doğru yazmak yetmez, operatörün onu BULABİLMESİ gerekir.)
//
// SEKTÖR STANDARDI: parti (batch/lot) yönetimli malzemede parti ATAMASI zorunlu
// bir alandır (SAP'ta "batch determination"), sistem sessizce boş bırakamaz —
// ya türetir ya sorar. Uygulanan kural tam olarak bu üç dallı davranıştır:
//
//   • TEK açık parti  → SORMADAN bağla (tek seçenekli soru sürtünmedir)
//   • BİRDEN FAZLA    → 400 + BATCH_REQUIRED + seçenek listesi (varsayma!)
//   • HİÇ YOK         → NULL meşru (parti kavramı işlememiş iş emri)
//
// Bu bekçi dört şeyi kilitler:
//   [1] tek parti sessizce bağlanır VE yanıtta operatöre GERİ SÖYLENİR
//       (sessiz doğru cevap ≠ görünmez cevap — operatör aksi halde topun
//        partisiz gittiğini sanar)
//   [2] birden fazla açık partide 400 + seçenekler döner, top YARATILMAZ
//       (hata FAZ 1'den önce → aynı clientToken temiz kalır, tekrar denenebilir)
//   [3] operatörün seçtiği parti YAZILIR; başka iş emrinin partisi REDDEDİLİR
//   [4] "açık" tanımı VERİYE dayanır: yalnız ölü toplu parti seçenek DEĞİLDİR
//       (kapanmış partiye top eklemek onun metraj muhasebesini geriye bozar)
//
// Ayrıca SIRA kilitlenir: yanlış ürün + çok parti aynı anda gönderilirse
// ITEM_MISMATCH dönmeli (BATCH_REQUIRED değil) — bağlam çözümü, payload'ın kendi
// tutarlılığından SONRA gelir; aksi halde operatör asıl hatasını hiç göremez.
//
// Fixture: `fixture-manual-move.ts` (4 adımlı WO, son adım Tambur) + bu dosyanın
// kendi ürettiği ek partiler. Servis DOĞRUDAN çağrılır (HTTP sözleşmesi zaten
// `test_tambur_manual_roll.ts`de). Cleanup finally'de.
// =============================================================================

import { randomUUID } from "crypto";
import prisma, { pool } from "../src/lib/prisma";
import { TamburManualService } from "../src/services/tambur-manual.service";
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

const svc = new TamburManualService();

interface ManualResult {
  rollId: string;
  barcode: string | null;
  batchId?: string | null;
  batchNumber?: string | null;
}

/** Hata gövdesini tipsiz okumadan sondala. */
function errInfo(e: unknown): { status?: number; code?: string; batches?: unknown } {
  const err = e as { statusCode?: number; details?: Record<string, unknown> } | null;
  return {
    status: err?.statusCode,
    code: err?.details?.code as string | undefined,
    batches: err?.details?.batches,
  };
}

async function main(): Promise<void> {
  const fx = await createManualMoveFixture(1);
  const tamburStepId = fx.stepIdBySeq[4];
  const createdRolls: string[] = [];
  const extraBatches: string[] = [];

  // Fixture'ın topunu Tambur adımına koy — parti "açık" sayılsın diye canlı bir
  // top gerekir ("açık" tanımı listeye değil VERİYE dayanır).
  await prisma.roll.update({
    where: { id: fx.rollIds[0] },
    data: { status: RollStatus.IN_PRODUCTION, currentStepId: tamburStepId, batchId: fx.batchId },
  });

  const mkBatch = async (suffix: string, opts: { dead?: boolean } = {}) => {
    const b = await prisma.batch.create({
      data: {
        batchNumber: `TEST-PB-${suffix}-${Date.now().toString().slice(-6)}`,
        workOrderId: fx.woId,
      },
      select: { id: true, batchNumber: true },
    });
    extraBatches.push(b.id);
    // Partiyi "açık" yapan şey canlı topudur; ölü top parti kapanmış demektir.
    const r = await prisma.roll.create({
      data: {
        barcode: `TEST-PB-R-${suffix}-${randomUUID().slice(0, 8).toUpperCase()}`,
        itemId: (await prisma.roll.findUniqueOrThrow({
          where: { id: fx.rollIds[0] },
          select: { itemId: true },
        })).itemId,
        // "Ölü" = K18_DEAD_STATUSES. SCRAP burada BİLEREK kullanılmıyor —
        // aşağıdaki [4b] tam da SCRAP'in partiyi KAPATMADIĞINI doğruluyor.
        status: opts.dead ? RollStatus.CANCELLED : RollStatus.IN_PRODUCTION,
        initialQty: 50,
        currentQty: 50,
        entrySource: "MANUAL_ENTRY",
        batchId: b.id,
        ...(opts.dead ? {} : { currentStepId: tamburStepId }),
      },
      select: { id: true },
    });
    createdRolls.push(r.id);
    return b;
  };

  const addManual = async (input: {
    qty: number;
    batchId?: string | null;
    itemId?: string;
  }): Promise<ManualResult> => {
    const res = await svc.createManualRoll({
      targetStepId: tamburStepId,
      initialQty: input.qty,
      reason: "Sayım farkı — fiziksel mal var",
      clientToken: randomUUID(),
      ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
    });
    const data = res.data as ManualResult;
    createdRolls.push(data.rollId);
    return data;
  };

  try {
    // ── [1] TEK AÇIK PARTİ → sessizce bağla + GERİ SÖYLE ─────────────────────
    console.log("\n[1] Tek açık parti — sormadan bağlanır ve operatöre söylenir");
    const one = await addManual({ qty: 111 });
    const oneRow = await prisma.roll.findUniqueOrThrow({
      where: { id: one.rollId },
      select: { batchId: true },
    });
    check("top fixture partisine bağlandı", oneRow.batchId === fx.batchId, String(oneRow.batchId));
    // ASIL İDDİA: sessiz ≠ görünmez. Yanıt partiyi taşımazsa operatör topun
    // partisiz gittiğini sanar ve ikinci kez ekler.
    check("yanıt batchId taşıyor", one.batchId === fx.batchId, String(one.batchId));
    check(
      "yanıt batchNumber taşıyor (ekranda gösterilebilir)",
      typeof one.batchNumber === "string" && one.batchNumber.length > 0,
      String(one.batchNumber),
    );

    // ── [2] BİRDEN FAZLA AÇIK PARTİ → 400 BATCH_REQUIRED, top YARATILMAZ ─────
    console.log("\n[2] İkinci açık parti — sistem VARSAYMAZ, sorar");
    const b2 = await mkBatch("B2");
    const rollsBefore = await prisma.roll.count({ where: { currentStepId: tamburStepId } });
    let e2 = errInfo(null);
    try {
      await addManual({ qty: 222 });
      check("çok partide 400 atmalı", false, "hata atmadı");
    } catch (e) {
      e2 = errInfo(e);
    }
    check("400 döndü", e2.status === 400, String(e2.status));
    check("code = BATCH_REQUIRED", e2.code === "BATCH_REQUIRED", String(e2.code));
    const opts = Array.isArray(e2.batches) ? (e2.batches as { id: string }[]) : [];
    check("seçenek listesi döndü (2 parti)", opts.length === 2, `${opts.length} seçenek`);
    check(
      "seçenekler her iki partiyi de içeriyor",
      opts.some((b) => b.id === fx.batchId) && opts.some((b) => b.id === b2.id),
    );
    // Hata parti çözümünde, yani FAZ 1'den (top yaratma) ÖNCE atıldı: yarım top
    // kalmamalı, aksi halde her reddedilen deneme envantere hayalet top bırakır.
    const rollsAfter = await prisma.roll.count({ where: { currentStepId: tamburStepId } });
    check("reddedilen denemede TOP YARATILMADI", rollsAfter === rollsBefore, `${rollsBefore} → ${rollsAfter}`);

    // ── [3] OPERATÖR SEÇİMİ ──────────────────────────────────────────────────
    console.log("\n[3] Operatör seçtiği parti yazılır, yabancı parti reddedilir");
    const picked = await addManual({ qty: 333, batchId: b2.id });
    const pickedRow = await prisma.roll.findUniqueOrThrow({
      where: { id: picked.rollId },
      select: { batchId: true },
    });
    check("seçilen partiye yazıldı", pickedRow.batchId === b2.id, String(pickedRow.batchId));
    check("yanıt seçilen partiyi doğruluyor", picked.batchId === b2.id);

    // Başka bir iş emrinin partisi: kabul edilirse iki iş emrinin muhasebesi karışır.
    const foreignWo = await createManualMoveFixture(1);
    let e3 = errInfo(null);
    try {
      await addManual({ qty: 444, batchId: foreignWo.batchId });
      check("yabancı parti reddedilmeli", false, "kabul etti");
    } catch (e) {
      e3 = errInfo(e);
    }
    check("yabancı parti → 400", e3.status === 400, String(e3.status));
    check("code = BATCH_INVALID", e3.code === "BATCH_INVALID", String(e3.code));
    await foreignWo.teardown();

    // ── [4] "AÇIK" TANIMI VERİYE DAYANIR — ve ölü kümesi TEK KAYNAKTAN ──────
    // Kural kök CLAUDE.md'den: ölü top kümesinin tek kaynağı K18_DEAD_STATUSES
    // (SUBCONTRACTOR_CONSUMED · TAMBUR_CONSUMED · KARTELA_CONSUMED · CANCELLED);
    // "liste/lane filtrelerinde elle statü listesi kopyalama". Bu bekçi o tek
    // kaynağa YASLANIR, kendi ölü listesini kurmaz.
    console.log("\n[4] Yalnız ölü toplu parti seçenek DEĞİL (ölü = K18)");
    const bDead = await mkBatch("BDEAD", { dead: true });
    let e4 = errInfo(null);
    try {
      await addManual({ qty: 555 });
    } catch (e) {
      e4 = errInfo(e);
    }
    const opts4 = Array.isArray(e4.batches) ? (e4.batches as { id: string }[]) : [];
    check("hâlâ 2 seçenek (ölü parti sayılmadı)", opts4.length === 2, `${opts4.length} seçenek`);
    check("ölü parti listede YOK", !opts4.some((b) => b.id === bDead.id));
    // Ölü partiye AÇIKÇA yazmak da reddedilmeli — kapanmış partinin metraj
    // muhasebesi geriye dönük bozulmasın.
    let e4b = errInfo(null);
    try {
      await addManual({ qty: 666, batchId: bDead.id });
      check("kapalı partiye yazım reddedilmeli", false, "kabul etti");
    } catch (e) {
      e4b = errInfo(e);
    }
    check("kapalı parti → BATCH_INVALID", e4b.code === "BATCH_INVALID", String(e4b.code));

    // [4b] SCRAP partiyi KAPATMAZ — ve bu bilinçli bir ayrımdır.
    // SCRAP "gerçek fire KARARIDIR" (kök CLAUDE.md), arşivleme değil: mal vardı,
    // üretildi, sonra fire oldu. Batch hâlâ o üretimin kimliğidir ve ona top
    // eklemek muhasebeyi bozmaz. K18'e SCRAP eklemek burada partiyi kapatırdı
    // ama aynı sabit onlarca liste/lane filtresini de besliyor — fireli topu
    // her yerde "yok" saymak apayrı ve çok daha geniş bir karar olurdu.
    // Bu satır o ayrımı KİLİTLER: biri K18'e SCRAP eklerse burası kırmızı verir
    // ve kararın bilinçli alınmasını zorlar.
    const bScrap = await mkBatch("BSCRAP");
    await prisma.roll.updateMany({
      where: { batchId: bScrap.id },
      data: { status: RollStatus.SCRAP, currentStepId: null },
    });
    let e4c = errInfo(null);
    try {
      await addManual({ qty: 667 });
    } catch (e) {
      e4c = errInfo(e);
    }
    const opts4c = Array.isArray(e4c.batches) ? (e4c.batches as { id: string }[]) : [];
    check(
      "SCRAP partiyi KAPATMAZ — hâlâ seçenek (K18 tek kaynak)",
      opts4c.some((b) => b.id === bScrap.id),
      `${opts4c.length} seçenek`,
    );

    // ── [5] SIRA: payload tutarlılığı ÖNCE, bağlam çözümü SONRA ──────────────
    console.log("\n[5] Yanlış ürün + çok parti → ITEM_MISMATCH (BATCH_REQUIRED değil)");
    const otherItem = await prisma.item.findFirst({
      where: { isActive: true, id: { not: (await prisma.workOrder.findUniqueOrThrow({
        where: { id: fx.woId }, select: { targetItemId: true },
      })).targetItemId ?? undefined } },
      select: { id: true },
    });
    if (!otherItem) {
      check("(atlandı) ikinci aktif ürün yok", true);
    } else {
      let e5 = errInfo(null);
      try {
        await addManual({ qty: 777, itemId: otherItem.id });
        check("yanlış ürün reddedilmeli", false, "kabul etti");
      } catch (e) {
        e5 = errInfo(e);
      }
      // Parti kontrolü öne alınsaydı operatör BATCH_REQUIRED görüp partiyi
      // seçer, sonra ITEM_MISMATCH yerdi — asıl hatasını iki tur sonra öğrenirdi.
      check(
        "önce ITEM_MISMATCH (parti sorusu maskelemedi)",
        e5.code === "ITEM_MISMATCH",
        String(e5.code),
      );
    }

    // ── [6] HİÇ AÇIK PARTİ YOK → NULL meşru ──────────────────────────────────
    console.log("\n[6] Açık parti yoksa NULL meşrudur (parti işlememiş iş emri)");
    const bare = await createManualMoveFixture(1);
    const bareStep = bare.stepIdBySeq[4];
    // Fixture partisini kapat: hiçbir CANLI top kalmasın. CANCELLED kullanılıyor
    // (K18 kümesi) — SCRAP partiyi kapatmaz, bkz. [4b].
    await prisma.roll.updateMany({
      where: { batchId: bare.batchId },
      data: { status: RollStatus.CANCELLED, currentStepId: null },
    });
    const bareRes = await svc.createManualRoll({
      targetStepId: bareStep,
      initialQty: 88,
      reason: "Sayım farkı — fiziksel mal var",
      clientToken: randomUUID(),
    });
    const bareData = bareRes.data as ManualResult;
    createdRolls.push(bareData.rollId);
    const bareRow = await prisma.roll.findUniqueOrThrow({
      where: { id: bareData.rollId },
      select: { batchId: true },
    });
    check("açık parti yokken top yaratıldı", Boolean(bareData.rollId));
    check("parti NULL kaldı (uydurma parti yok)", bareRow.batchId === null, String(bareRow.batchId));
    check("yanıt batchNumber null", bareData.batchNumber == null, String(bareData.batchNumber));
    // Bu topu fixture teardown'ından ÖNCE söküyoruz: adıma bağlı olduğu için
    // WO silinemez (FK RESTRICT). Sıra hareket → operasyon → top.
    await prisma.rollMovement.deleteMany({ where: { rollId: bareData.rollId } });
    await prisma.rollOperation.deleteMany({ where: { rollId: bareData.rollId } });
    await prisma.roll.deleteMany({ where: { id: bareData.rollId } });
    createdRolls.splice(createdRolls.indexOf(bareData.rollId), 1);
    await bare.teardown();
  } finally {
    // Sıra önemli: hareket → top → parti (FK zinciri).
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } });
    await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } });
    await prisma.batch.deleteMany({ where: { id: { in: extraBatches } } });
    await fx.teardown();
    console.log("\n(temizlendi — TEST-PB fixture'ları silindi)");
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
