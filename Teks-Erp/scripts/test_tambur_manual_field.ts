// =============================================================================
// TAMBUR SAHA DÜZELTMESİ — "Mevcut Topu Buraya Al" + "Manuel Top Ekle"
// =============================================================================
// Doğrulananlar:
//   1) Hedef adım guard'ı: Tambur olmayan adım + oturumun istasyonu uyuşmuyor
//   2) Önizleme: engelsiz topta canApply + etkiler; engellide blockCode
//   3) Uygulama: top Tambur adımına geçer, açık hareket doğar, SAHA audit'i yazılır
//   4) Saha kapsam daraltmaları: zaten burada / ölü top / BAŞKA İŞ EMRİ
//   5) Sebep zorunluluğu (her iki uçta)
//   6) Manuel top: barkod SUNUCUDA, entrySource=TAMBUR_MANUAL, adıma bağlı,
//      hareket marker'ı + audit event'i (SEBEP burada kalıcı durur)
//   7) İdempotency: aynı clientToken ile 2. çağrı MÜKERRER TOP DOĞURMAZ
//   8) Ölü iş emri (CANCELLED) reddi
//
// Fixture: `fixture-manual-move.ts` (Zımpara → Boyahane → Kurşun+KK2 → Tambur).
// Manuel top testi KENDİ TEST- ürününü yaratır — seed ürününün "uygulanabilir
// renk" listesi ortama göre değişir ve testi ortam verisine bağlardı.
// =============================================================================

import p from "../src/lib/prisma";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { createManualMoveFixture } from "./fixture-manual-move";
import { lengthWarning, LENGTH_WARN_M } from "../src/services/helpers/measurement-threshold.helper";
import { randomUUID } from "crypto";

const svc = new TamburManualService();
let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`);
  c ? pass++ : fail++;
};

/** Hata fırlatmasını bekle + `details.code`'u doğrula. */
async function expectCode(
  label: string,
  code: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
    ok(false, `${label}: hata bekleniyordu, geçti`);
  } catch (e) {
    const details = (e as { details?: Record<string, unknown> }).details;
    const actual = details?.code;
    ok(actual === code, `${label}: code=${String(actual)} (beklenen ${code})`);
  }
}

interface PreviewData {
  canApply: boolean;
  blockCode: string | null;
  blockReason: string | null;
  warnings: string[];
  effects: { direction: string; fromStepName: string | null; newParty: boolean } | null;
  roll: { barcode: string | null; currentLocation: string };
}

(async () => {
  const fx = await createManualMoveFixture(2);
  const kursunStepId = fx.stepIdBySeq[3];
  const tamburStepId = fx.stepIdBySeq[4];
  const [rollA, rollB] = fx.rollIds;
  const manualRollIds: string[] = [];
  let testItemId: string | null = null;
  let fx2: Awaited<ReturnType<typeof createManualMoveFixture>> | null = null;

  try {
    // --- SETUP: rollA Kurşun'da açık hareketle bekliyor ---
    await p.roll.updateMany({
      where: { id: { in: fx.rollIds } },
      data: { status: "IN_PRODUCTION", currentStepId: kursunStepId },
    });
    await p.rollMovement.create({
      data: { rollId: rollA, workOrderStepId: kursunStepId, qtyIn: 100 },
    });
    await p.rollMovement.create({
      data: { rollId: rollB, workOrderStepId: kursunStepId, qtyIn: 100 },
    });
    await p.workOrderStep.update({ where: { id: kursunStepId }, data: { status: "ACTIVE" } });

    const kursunStation = await p.workOrderStep.findUniqueOrThrow({
      where: { id: kursunStepId },
      select: { stationId: true },
    });

    // === 1) ADIM GUARD'LARI ===
    await expectCode("Tambur olmayan adım", "STEP_NOT_TAMBUR", () =>
      svc.getBringPreview({ rollId: rollA, targetStepId: kursunStepId }),
    );
    await expectCode("oturum başka istasyonda", "STATION_MISMATCH", () =>
      svc.getBringPreview(
        { rollId: rollA, targetStepId: tamburStepId },
        { stationId: kursunStation.stationId },
      ),
    );
    await expectCode("bulunmayan barkod", "ROLL_NOT_FOUND", () =>
      svc.getBringPreview({ barcode: `TEST-YOK-${randomUUID()}`, targetStepId: tamburStepId }),
    );

    // === 2) ÖNİZLEME — engelsiz top ===
    const pv = (await svc.getBringPreview({ rollId: rollA, targetStepId: tamburStepId }))
      .data as PreviewData;
    ok(pv.canApply === true, `önizleme canApply=true (blockReason=${pv.blockReason ?? "-"})`);
    ok(pv.effects?.direction === "forward", `yön ileri (${pv.effects?.direction})`);
    ok(
      typeof pv.effects?.fromStepName === "string" && pv.effects.fromStepName.length > 0,
      `kaynak adım adı dolu (${pv.effects?.fromStepName})`,
    );
    ok(pv.roll.currentLocation.length > 0, `konum etiketi (${pv.roll.currentLocation})`);

    // === 5) SEBEP ZORUNLU ===
    await expectCode("sebep kısa (buraya al)", "REASON_REQUIRED", () =>
      svc.bringRoll({ rollId: rollA, targetStepId: tamburStepId, reason: "ab" }),
    );

    // === 3) UYGULA ===
    await svc.bringRoll(
      { rollId: rollA, targetStepId: tamburStepId, reason: "saha: top Kurşun'da unutuldu" },
      { userId: undefined, machineId: null, stationId: null },
    );
    const movedRoll = await p.roll.findUniqueOrThrow({
      where: { id: rollA },
      select: { status: true, currentStepId: true },
    });
    ok(
      movedRoll.status === "IN_PRODUCTION" && movedRoll.currentStepId === tamburStepId,
      `top Tambur adımında (${movedRoll.status})`,
    );
    const openMove = await p.rollMovement.count({
      where: { rollId: rollA, workOrderStepId: tamburStepId, exitedAt: null },
    });
    ok(openMove === 1, `Tambur'da tek açık hareket (${openMove})`);
    const bringLog = await p.systemLog.findFirst({
      where: { tableName: "ROLL", recordId: rollA },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const bringData = bringLog?.newData as Record<string, unknown> | null;
    ok(
      bringData?.event === "TAMBUR_MANUAL_BRING" &&
        typeof bringData?.reason === "string" &&
        (bringData.reason as string).includes("unutuldu"),
      `saha audit'i sebebiyle yazıldı (${String(bringData?.event)})`,
    );

    // === 4) SAHA KAPSAM DARALTMALARI ===
    await expectCode("zaten bu adımda", "ROLL_ALREADY_HERE", () =>
      svc.bringRoll({ rollId: rollA, targetStepId: tamburStepId, reason: "tekrar dene" }),
    );

    await p.roll.update({ where: { id: rollB }, data: { status: "TAMBUR_CONSUMED" } });
    const deadPv = (await svc.getBringPreview({ rollId: rollB, targetStepId: tamburStepId }))
      .data as PreviewData;
    ok(
      deadPv.canApply === false && deadPv.blockCode === "ROLL_DEAD",
      `ölü top önizlemede engelli (${deadPv.blockCode})`,
    );
    await p.roll.update({
      where: { id: rollB },
      data: { status: "IN_PRODUCTION", currentStepId: kursunStepId },
    });

    fx2 = await createManualMoveFixture(1);
    const foreignPv = (
      await svc.getBringPreview({ rollId: fx2.rollIds[0], targetStepId: tamburStepId })
    ).data as PreviewData;
    ok(
      foreignPv.blockCode === "ROLL_OTHER_WORKORDER",
      `başka iş emrinin topu reddedildi (${foreignPv.blockCode})`,
    );
    await expectCode("başka iş emri (uygula)", "ROLL_OTHER_WORKORDER", () =>
      svc.bringRoll({
        rollId: fx2!.rollIds[0],
        targetStepId: tamburStepId,
        reason: "başka iş emrinden çekmeyi dene",
      }),
    );

    // === 6) MANUEL TOP EKLE ===
    const stamp = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
    const item = await p.item.create({
      data: { code: `TEST-TMB-${stamp}`.slice(0, 32), name: `TEST Tambur ${stamp}`, itemType: "FABRIC" },
      select: { id: true },
    });
    testItemId = item.id;

    await expectCode("sebep kısa (manuel top)", "REASON_REQUIRED", () =>
      svc.createManualRoll({
        targetStepId: tamburStepId,
        initialQty: 50,
        reason: "x",
        clientToken: randomUUID(),
      }),
    );

    const token = randomUUID();
    const created = (await svc.createManualRoll(
      {
        targetStepId: tamburStepId,
        initialQty: 123.5,
        reason: "saha: sistemde olmayan top elde bulundu",
        clientToken: token,
        // Parti açıkça — birden fazla açık parti varsa backend sorar (BATCH_REQUIRED).
        batchId: fx.batchId,
      },
      { machineId: null, stationId: null },
    )).data as { rollId: string; barcode: string | null; alreadyAttached: boolean; colorSource: string };
    manualRollIds.push(created.rollId);

    // ── GERÇEKÇİLİK EŞİĞİ (metraj) — UYARI, blok DEĞİL ─────────────────────────
    // `createManualRoll` dönüşüne `warnings` ekleniyor; eşik altı metrajda (bu
    // fikstürün 123,5'i) uyarı ÇIKMAMALI.
    ok(
      lengthWarning(123.5) === null,
      `eşik altı metraj uyarı ÜRETMEZ (123,5 m < ${LENGTH_WARN_M})`,
    );
    ok(
      lengthWarning(LENGTH_WARN_M + 1) !== null,
      `eşik üstü metraj uyarı ÜRETİR (${LENGTH_WARN_M + 1} m)`,
    );

    // === 6b) EŞİK AŞIMI SERVİSTE: uyarı YANITA ve AUDİT YÜKÜNE birlikte girer ===
    // Yanıttaki uyarı ekranda kaybolur; "bu top girilirken uyarı verildi mi" sorusunun
    // kalıcı cevabı audit yüküdür (çuval tartısı `finishWeigh` emsali). Kayıt yine YAZILIR.
    const bigRes = await svc.createManualRoll(
      {
        targetStepId: tamburStepId,
        initialQty: LENGTH_WARN_M + 1,
        reason: "saha: eşik aşan metraj (sonda)",
        clientToken: randomUUID(),
        batchId: fx.batchId,
      },
      { machineId: null, stationId: null },
    );
    const bigRoll = bigRes.data as { rollId: string };
    manualRollIds.push(bigRoll.rollId);
    const bigWarning = bigRes.warnings?.[0] ?? null;
    ok(bigWarning !== null && bigRes.warnings?.length === 1, `eşik aşımı → yanıtta TEK uyarı (${bigWarning ?? "-"})`);
    ok(
      Number((await p.roll.findUniqueOrThrow({ where: { id: bigRoll.rollId }, select: { initialQty: true } })).initialQty) === LENGTH_WARN_M + 1,
      "eşik aşımı kaydı ENGELLEMEDİ (top yazıldı)",
    );
    const bigLog = await p.systemLog.findFirst({
      where: { tableName: "ROLL", recordId: bigRoll.rollId, action: "CREATE" },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const bigData = bigLog?.newData as Record<string, unknown> | null;
    ok(
      typeof bigData?.thresholdWarning === "string" && bigData.thresholdWarning === bigWarning,
      `audit yükünde thresholdWarning YANITLA AYNI (${String(bigData?.thresholdWarning ?? "YOK")})`,
    );

    const mRoll = await p.roll.findUniqueOrThrow({
      where: { id: created.rollId },
      select: {
        barcode: true,
        entrySource: true,
        status: true,
        currentStepId: true,
        currentQty: true,
        clientToken: true,
      },
    });
    ok(mRoll.barcode !== null && mRoll.barcode.length > 0, `barkod SUNUCUDA üretildi (${mRoll.barcode})`);
    ok(mRoll.entrySource === "TAMBUR_MANUAL", `entrySource=TAMBUR_MANUAL (${mRoll.entrySource})`);
    ok(
      mRoll.status === "IN_PRODUCTION" && mRoll.currentStepId === tamburStepId,
      `doğan top Tambur adımına bağlandı (${mRoll.status})`,
    );
    ok(Number(mRoll.currentQty) === 123.5, `metraj korundu (${Number(mRoll.currentQty)})`);
    // 2026-08-04: renk (ve ürün) İŞ EMRİNDEN gelir — operatör seçemez. Eskiden
    // burada `colorId: null` gönderilip "OPERATOR" bekleniyordu; o yol artık
    // COLOR_MISMATCH ile reddediliyor (bkz. test_tambur_manual_roll).
    ok(created.colorSource === "WORKORDER", `renk kaynağı iş emri (${created.colorSource})`);

    const mMove = await p.rollMovement.findFirst({
      where: { rollId: created.rollId, workOrderStepId: tamburStepId, exitedAt: null },
      select: { notes: true },
    });
    ok(
      (mMove?.notes ?? "").startsWith("TAMBUR_MANUAL_ROLL:"),
      `giriş hareketinde marker + sebep (${mMove?.notes ?? "-"})`,
    );

    const mLog = await p.systemLog.findFirst({
      where: { tableName: "ROLL", recordId: created.rollId, action: "CREATE" },
      orderBy: { createdAt: "desc" },
      select: { newData: true },
    });
    const mData = mLog?.newData as Record<string, unknown> | null;
    ok(
      mData?.event === "TAMBUR_MANUAL_ROLL" &&
        typeof mData?.reason === "string" &&
        (mData.reason as string).includes("elde bulundu"),
      `manuel top audit'i sebebiyle yazıldı (${String(mData?.event)})`,
    );
    ok(!("thresholdWarning" in (mData ?? {})), "eşik altı topun audit yükünde thresholdWarning anahtarı YOK (iki yönlü)");

    // === 7) İDEMPOTENCY — aynı token, mükerrer top YOK ===
    const retry = (await svc.createManualRoll(
      {
        targetStepId: tamburStepId,
        initialQty: 123.5,
        reason: "saha: sistemde olmayan top elde bulundu",
        clientToken: token,
        batchId: fx.batchId,
      },
      { machineId: null, stationId: null },
    )).data as { rollId: string; alreadyAttached: boolean };
    ok(retry.rollId === created.rollId, "aynı clientToken → AYNI top döndü");
    ok(retry.alreadyAttached === true, "tekrar denemede adıma yeniden bağlanmadı (idempotent)");
    const tokenRolls = await p.roll.count({ where: { clientToken: token } });
    ok(tokenRolls === 1, `token başına tek top (${tokenRolls})`);
    const openMoves = await p.rollMovement.count({
      where: { rollId: created.rollId, workOrderStepId: tamburStepId, exitedAt: null },
    });
    ok(openMoves === 1, `tekrar denemede ikinci açık hareket doğmadı (${openMoves})`);

    // === 8) ÖLÜ İŞ EMRİ ===
    await p.workOrder.update({ where: { id: fx.woId }, data: { status: "CANCELLED" } });
    await expectCode("iptal edilmiş iş emri (manuel top)", "WORKORDER_DEAD", () =>
      svc.createManualRoll({
        targetStepId: tamburStepId,
        initialQty: 10,
        reason: "ölü iş emrine ekleme denemesi",
        clientToken: randomUUID(),
      }),
    );
    await expectCode("iptal edilmiş iş emri (buraya al)", "WORKORDER_DEAD", () =>
      svc.getBringPreview({ rollId: rollB, targetStepId: tamburStepId }),
    );
    await p.workOrder.update({ where: { id: fx.woId }, data: { status: "IN_PROGRESS" } });
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.stack : e);
  } finally {
    // Manuel toplar fixture kapsamı DIŞINDA doğdu → önce onlar sökülür (FK: currentStepId).
    if (manualRollIds.length > 0) {
      await p.rollMovement.deleteMany({ where: { rollId: { in: manualRollIds } } });
      await p.rollOperation.deleteMany({ where: { rollId: { in: manualRollIds } } });
      await p.rollProperty.deleteMany({ where: { rollId: { in: manualRollIds } } });
      await p.systemLog.deleteMany({ where: { recordId: { in: manualRollIds } } });
      await p.roll.deleteMany({ where: { id: { in: manualRollIds } } });
    }
    // Taşıma varsayılan parti kararı 'new' → fixture'ın BİLMEDİĞİ bir parti doğdu;
    // fixture teardown'ı yalnız kendi partisini siler ve WO silme FK'ya takılır.
    const extraBatches = await p.batch.findMany({
      where: { workOrderId: fx.woId, id: { not: fx.batchId } },
      select: { id: true },
    });
    if (extraBatches.length > 0) {
      const ids = extraBatches.map((b) => b.id);
      await p.roll.updateMany({ where: { batchId: { in: ids } }, data: { batchId: fx.batchId } });
      await p.systemLog.deleteMany({ where: { recordId: { in: ids } } });
      await p.batch.deleteMany({ where: { id: { in: ids } } });
    }
    if (fx2) await fx2.teardown();
    await fx.teardown();
    if (testItemId) await p.item.deleteMany({ where: { id: testItemId } });
    console.log("(temizlendi — TEST- fixture WO/parti/toplar + manuel toplar + ürün silindi)");
    await p.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
