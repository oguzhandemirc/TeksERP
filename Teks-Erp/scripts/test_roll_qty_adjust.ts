// =============================================================================
// Test: G4 — SAYIM METRAJ DÜZELTMESİ (`InventoryService.adjustRollQty`)
// Çalıştır: npx tsx scripts/test_roll_qty_adjust.ts
// =============================================================================
// 2026-08-14 (ticaret paketi). Bugüne kadar elle top ekleme + iptal vardı,
// SAYIM düzeltmesi yoktu: 500 m kayıtlı top rafta 480 m çıkınca operatörün
// meşru yolu yoktu. Bu bekçi YEDİ cepheyi kilitler:
//
//   §1 Sebep ZORUNLU (min 3) + geçersiz metraj + "fark yok" → 400
//   §2 Kapsam DAR — kapsam dışı statü (IN_PRODUCTION / SHIPPED / CANCELLED)
//      anlamlı 409 (üretimdeki topun metrajını istasyon akışı belirler)
//   §3 Çuvaldaki top 409 (çuval toplamı + çuval etiketi bayatlar)
//   §4 Mutlu yol AŞAĞI: yalnız currentQty düşer, initialQty DOKUNULMAZ,
//      labelDirty yanar, RECORD_CORRECTION sapma satırı + audit doğar
//   §5 Mutlu yol YUKARI: OVERAGE sapma satırı (sebep kodu istemez)
//   §6 CLAIM YARIŞI: iki paralel düzeltmeden yalnız BİRİ geçer; kaybeden 409
//      alır ve sapma defteri farkı İKİ KEZ görmez (tek satır)
//   §7 İş emri adımına bağlı FREE_STOCK topu 409 (currentStepId guard'ı)
//
// Fixture kendi verisini üretir (ortam verisine bağımlı DEĞİL), finally'de
// siler. ⚠️ RollVariance FK'sı RESTRICT — top silinmeden ÖNCE variance satırı
// silinir (bellek notu: "top silen her testin cleanup'ına deleteMany şart").
//
// ⚠️ §6'daki paralel çağrı MEŞRUDUR (perf kuralı 11 tek tx client'ını
// paylaşmaya ilişkindir; burada iki AYRI transaction yarışıyor — KK1 mükerrer
// tuzağı bekçisiyle aynı gerekçe). "Düzeltip" sıralı hale getirirsen yarış
// penceresi kapanır ve bekçi sessizce ölür.
// =============================================================================
import { RollVarianceKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { AppError } from "../src/utils/app-error";

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

const service = new InventoryService();

/** Servis çağrısının fırlattığı AppError'ı yakala; fırlatmazsa null. */
async function grab(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const cleanupRollIds: string[] = [];
  let itemId = "";
  let sackId = "";
  let stationId = "";
  let workOrderId = "";
  let stepId = "";

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-QADJ-${ts}`, name: `TEST Sayım Düzeltme ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    itemId = item.id;

    const mkRoll = async (
      status: "STOCK" | "WAREHOUSE" | "A1_STOCK" | "IN_PRODUCTION" | "SHIPPED" | "CANCELLED",
      qty: number,
      suffix: string,
      extra: Record<string, unknown> = {},
    ): Promise<string> => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-QADJ-${suffix}-${ts}`,
          itemId: item.id,
          status,
          initialQty: qty,
          currentQty: qty,
          entrySource: "MANUAL_ENTRY",
          ...extra,
        },
        select: { id: true },
      });
      cleanupRollIds.push(r.id);
      return r.id;
    };

    // ── §1 Sebep zorunlu + geçersiz girdi ───────────────────────────────────
    console.log("\n── §1 Sebep zorunlu + geçersiz girdi ──");

    const wRoll = await mkRoll("WAREHOUSE", 500, "W");

    let err = await grab(() => service.adjustRollQty(wRoll, { newQty: 480, reason: "" }));
    check("sebepsiz çağrı 400", err?.statusCode === 400, err?.message ?? "hata yok");

    err = await grab(() => service.adjustRollQty(wRoll, { newQty: 480, reason: "ab" }));
    check("2 karakterlik sebep 400 (min 3)", err?.statusCode === 400);

    err = await grab(() => service.adjustRollQty(wRoll, { newQty: 0, reason: "sayım farkı" }));
    check("newQty=0 → 400", err?.statusCode === 400);

    err = await grab(() => service.adjustRollQty(wRoll, { newQty: 500, reason: "sayım farkı" }));
    check(
      "aynı değer → 400 (fark yok; sapma defterine gürültü satırı yazılmaz)",
      err?.statusCode === 400,
    );

    // Hiçbir 400 yolu veri değiştirmemeli — yarım kayıt bırakmaz.
    const wAfter400 = await prisma.roll.findUniqueOrThrow({
      where: { id: wRoll },
      select: { currentQty: true, labelDirty: true },
    });
    check(
      "400 yolları veri DEĞİŞTİRMEZ (currentQty=500, labelDirty=false)",
      Number(wAfter400.currentQty) === 500 && wAfter400.labelDirty === false,
    );

    // ── §2 Kapsam dışı statüler ─────────────────────────────────────────────
    console.log("\n── §2 Kapsam dışı statü → anlamlı 409 ──");

    const prodRoll = await mkRoll("IN_PRODUCTION", 200, "P");
    err = await grab(() => service.adjustRollQty(prodRoll, { newQty: 180, reason: "sayım farkı" }));
    check(
      "IN_PRODUCTION → 409 (metrajı istasyon akışı belirler)",
      err?.statusCode === 409 && err.message.includes("üretimde"),
      err?.message ?? "hata yok",
    );

    const shippedRoll = await mkRoll("SHIPPED", 200, "S");
    err = await grab(() => service.adjustRollQty(shippedRoll, { newQty: 180, reason: "sayım farkı" }));
    check(
      "SHIPPED → 409 (çıkış kaydına dokunulmaz — brüt kuralı)",
      err?.statusCode === 409 && err.message.includes("sevk"),
    );

    const cancelledRoll = await mkRoll("CANCELLED", 200, "C");
    err = await grab(() => service.adjustRollQty(cancelledRoll, { newQty: 180, reason: "sayım farkı" }));
    check("CANCELLED → 409 (arşiv statüde canlı stok yok)", err?.statusCode === 409);

    // Kapsam dışı yollar da veri değiştirmez.
    const prodAfter = await prisma.roll.findUniqueOrThrow({
      where: { id: prodRoll },
      select: { currentQty: true },
    });
    check("409 yolu veri DEĞİŞTİRMEZ", Number(prodAfter.currentQty) === 200);

    // ── §3 Çuvaldaki top ────────────────────────────────────────────────────
    console.log("\n── §3 Çuvaldaki top → 409 ──");

    const sack = await prisma.sack.create({
      data: { sackNo: `TEST-QADJ-CV-${ts}` },
      select: { id: true },
    });
    sackId = sack.id;
    const sackedRoll = await mkRoll("WAREHOUSE", 300, "SK", { sackId: sack.id });
    err = await grab(() => service.adjustRollQty(sackedRoll, { newQty: 280, reason: "sayım farkı" }));
    check(
      "çuvaldaki WAREHOUSE topu 409 (çuval toplamı/etiketi bayatlar)",
      err?.statusCode === 409 && err.message.includes("çuval"),
      err?.message ?? "hata yok",
    );

    // ── §4 Mutlu yol — sayım DÜŞÜK (500 → 480) ─────────────────────────────
    console.log("\n── §4 Mutlu yol: 500 → 480 (RECORD_CORRECTION) ──");

    const down = await service.adjustRollQty(wRoll, {
      newQty: 480,
      reason: "yıl sonu sayımı — rafta 480 m ölçüldü",
    });
    check("çağrı başarılı", down.success === true);
    check(
      "yanıt somut konuşur (old/new/diff/kind)",
      (down.data as Record<string, unknown>)?.oldQty === 500 &&
        (down.data as Record<string, unknown>)?.newQty === 480 &&
        (down.data as Record<string, unknown>)?.diffQty === 20 &&
        (down.data as Record<string, unknown>)?.kind === RollVarianceKind.RECORD_CORRECTION,
    );

    const wAfter = await prisma.roll.findUniqueOrThrow({
      where: { id: wRoll },
      select: { currentQty: true, initialQty: true, labelDirty: true, status: true },
    });
    check("currentQty 480'e indi", Number(wAfter.currentQty) === 480);
    check(
      "initialQty DOKUNULMADI (tarihsel giriş kaydı — fark initialQty-currentQty olarak okunur)",
      Number(wAfter.initialQty) === 500,
    );
    check(
      "labelDirty=true (metraj etikete basılıyor; fiziksel etiket artık yanlış sayı taşıyor)",
      wAfter.labelDirty === true,
    );
    check("statü DEĞİŞMEDİ (bu bir statü geçişi değil)", wAfter.status === "WAREHOUSE");

    const downVars = await prisma.rollVariance.findMany({
      where: { rollId: wRoll },
      select: { kind: true, qty: true, source: true, reasonCode: true, reasonText: true, reversedAt: true },
    });
    check("TEK sapma satırı doğdu", downVars.length === 1);
    const dv = downVars[0];
    check(
      "satır: RECORD_CORRECTION · qty=20 · source=WAREHOUSE_QTY_ADJUST",
      dv?.kind === RollVarianceKind.RECORD_CORRECTION &&
        Number(dv?.qty) === 20 &&
        dv?.source === "WAREHOUSE_QTY_ADJUST",
      `kind=${dv?.kind} qty=${dv?.qty} source=${dv?.source}`,
    );
    check(
      "gerekçe kayıtlı (DIGER + serbest metin) ve satır TERSLENMEMİŞ",
      dv?.reasonCode === "DIGER" &&
        (dv?.reasonText ?? "").includes("480 m ölçüldü") &&
        dv?.reversedAt === null,
    );

    const auditRows = await prisma.systemLog.findMany({
      where: { tableName: "ROLL_QTY_ADJUST", recordId: wRoll },
      select: { action: true, oldData: true, newData: true },
    });
    check("audit satırı doğdu (ROLL_QTY_ADJUST)", auditRows.length === 1);
    const audit = auditRows[0];
    check(
      "audit old/new metrajı + sebebi taşıyor",
      (audit?.oldData as Record<string, unknown>)?.currentQty === 500 &&
        (audit?.newData as Record<string, unknown>)?.currentQty === 480 &&
        typeof (audit?.newData as Record<string, unknown>)?.reason === "string",
    );

    // ── §5 Mutlu yol — sayım YÜKSEK (480 → 495) ────────────────────────────
    console.log("\n── §5 Mutlu yol: 480 → 495 (OVERAGE) ──");

    const up = await service.adjustRollQty(wRoll, {
      newQty: 495,
      reason: "sayımda fazla çıktı",
    });
    check("artı yön de çalışır", up.success === true);
    const upVars = await prisma.rollVariance.findMany({
      where: { rollId: wRoll, kind: RollVarianceKind.OVERAGE },
      select: { qty: true, source: true, reasonCode: true, reasonText: true },
    });
    check("OVERAGE satırı doğdu (qty=15)", upVars.length === 1 && Number(upVars[0]?.qty) === 15);
    check(
      "OVERAGE sebep kodu İSTEMEZ ama gerekçe metni yine taşınır",
      upVars[0]?.reasonCode === null && upVars[0]?.reasonText === "sayımda fazla çıktı",
    );
    const wAfterUp = await prisma.roll.findUniqueOrThrow({
      where: { id: wRoll },
      select: { currentQty: true, initialQty: true },
    });
    check(
      "currentQty=495, initialQty hâlâ 500",
      Number(wAfterUp.currentQty) === 495 && Number(wAfterUp.initialQty) === 500,
    );

    // ── §6 Claim yarışı ─────────────────────────────────────────────────────
    console.log("\n── §6 Claim yarışı: 2 paralel düzeltmeden yalnız BİRİ geçer ──");

    const raceRoll = await mkRoll("STOCK", 300, "R");
    // İki AYRI transaction — bkz. dosya başındaki perf-kuralı-11 notu.
    const results = await Promise.allSettled([
      service.adjustRollQty(raceRoll, { newQty: 280, reason: "paralel sayım A" }),
      service.adjustRollQty(raceRoll, { newQty: 260, reason: "paralel sayım B" }),
    ]);
    const wins = results.filter((r) => r.status === "fulfilled");
    const losses = results.filter((r) => r.status === "rejected");
    check("tam olarak 1 geçti, 1 düştü", wins.length === 1 && losses.length === 1);
    const loser = losses[0] as PromiseRejectedResult | undefined;
    check(
      "kaybeden 409 alır (sessiz çift yazım yok)",
      loser?.reason instanceof AppError && loser.reason.statusCode === 409,
      loser ? String((loser.reason as Error).message) : "düşen yok",
    );
    const winData = (wins[0] as PromiseFulfilledResult<{ data?: unknown }> | undefined)?.value
      ?.data as Record<string, unknown> | undefined;
    const raceAfter = await prisma.roll.findUniqueOrThrow({
      where: { id: raceRoll },
      select: { currentQty: true },
    });
    check(
      "DB kazananın değerini taşır",
      winData?.newQty === Number(raceAfter.currentQty),
      `db=${raceAfter.currentQty} kazanan=${winData?.newQty}`,
    );
    const raceVars = await prisma.rollVariance.findMany({
      where: { rollId: raceRoll },
      select: { qty: true },
    });
    check(
      "sapma defteri farkı İKİ KEZ görmez (tek satır, kazananın farkı)",
      raceVars.length === 1 && Number(raceVars[0]?.qty) === Number(winData?.diffQty),
      `satır=${raceVars.length} qty=${raceVars[0]?.qty}`,
    );

    // ── §7 İş emri adımına bağlı FREE_STOCK topu ───────────────────────────
    console.log("\n── §7 Adıma bağlı top → 409 ──");

    const station = await prisma.station.create({
      data: {
        code: `TEST-QADJ-ST-${ts}`,
        name: `TEST İstasyon ${ts}`,
        type: "INTERNAL",
        kind: "TAMBUR",
      },
      select: { id: true },
    });
    stationId = station.id;
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `TEST-QADJ-WO-${ts}`, status: "IN_PROGRESS" },
      select: { id: true },
    });
    workOrderId = wo.id;
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
      select: { id: true },
    });
    stepId = step.id;
    const steppedRoll = await mkRoll("STOCK", 120, "WS", { currentStepId: step.id });
    err = await grab(() => service.adjustRollQty(steppedRoll, { newQty: 110, reason: "sayım farkı" }));
    check(
      "FREE_STOCK statülü ama adıma bağlı top 409 (istasyon akışının malı)",
      err?.statusCode === 409 && err.message.includes("iş emri"),
      err?.message ?? "hata yok",
    );
  } finally {
    if (cleanupRollIds.length) {
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: cleanupRollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: cleanupRollIds } } });
    }
    if (stepId) await prisma.workOrderStep.deleteMany({ where: { id: stepId } });
    if (workOrderId) await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
    if (sackId) await prisma.sack.deleteMany({ where: { id: sackId } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => process.exit(fail > 0 ? 1 : 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
