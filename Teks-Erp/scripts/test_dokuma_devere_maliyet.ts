// =============================================================================
// BEKÇİ — Devere faturası → dokuma gerçek maliyeti (devere maliyet dilim 1; plan PLAN-devere-maliyet-1126 §3)
// =============================================================================
// Uçtan uca: devere siparişi → kabul → onaylı fatura (USD, belge kuru) → levent tezgâha takılır → top doğar
// (KK1, `devere.autoConsume` açık → CONSUMED) → "Dokuma maliyeti standarttan saptı mı?" tablosunda Devere /m.
//   §1 ⭐ el hesabı: 0,10 USD/m sipariş, kabul 2×1000 m; fatura 250 USD − %16 iskonto = 210 net (+%20 KDV hariç),
//      kur 40 → kabul 8400 TL → 4,20 TL/çözgü m; top 100 m kumaş, take-up %20 → 125 m çözgü → 525 TL → 5,25 TL/m; FATURA
//   §2 faturasız kabul → beklenen 200 USD × kabul günü kuru (TARIFE, tahmini = tamamı); taslak fatura da TARIFE
//   §3 ⭐ fatura iptal (storno) → aynı iş TARIFE değerine döner
//   §4 ⭐ bir fatura iki kabul: net beklenen tutar payıyla bölünür, Σ pay = net (son kabul kalanı alır); karşılaştırılamazsa metre
//   §5 iki levent tek top: biri faturalı biri faturasız → KARMA, tahmini pay ayrı
//   §6 ⭐ tüketimsiz top paya/paydaya girmez + `COZGU_TUKETIMI`; geri alınmış tüketim (`CONSUMED_CANCEL`) sayılmaz
//   §7 kendi leventi (IN_HOUSE) → ölçülmüş 0; ücretsiz sipariş → `DEVERE_UCRETI` ("eksik", 0 değil); YALNIZ_FATURA →
//      `DEVERE_FATURASI`; kur yok → `FX_RATE_MISSING`
//   §8 tek kaynak (metin): dokuma helper'ı devere/fatura tablosuna dokunmaz (köprü); ücret çarpımı yok; float yok
//   §9 devere kapalı → alanlar null, kolon var hücre boş; iş emri ayrıntısında yalnız Tezgâh satırı
//   §10 (dilim 2) iş emri ayrıntısı ucu: DTO el hesabı (5,25 · fatura · standart karşılık null), 404, uç kapıları
// NEGATİF SONDALAR (2026-11-26, hepsi kırmızı verdi, geri alındı):
//   ① fatura okuyucusunda `status: CONFIRMED` → DRAFT+CANCELLED da → §2c/§3a/§5b/§6c/§7c ❌ (21/6)
//   ② net = `subtotal − discountTotal` (iskonto iki kez düşer; subtotal zaten satır neti) → §1b/§1c/§6a ❌ (23/4)
//   ③ tüketim satırından `reversal: null` kaldırıldı → §6c ❌ (26/1)  ④ son kabul kalanı almadı → §4b ❌ (26/1)
//   §11 levent kökeni: satın alınan / emanet → LEVENT_KOKENI (0 değil); müşteri ipliğiyle devere siparişi → TARIFE; karışık top null
//   ⑤ PURCHASED dalı kaldırıldı → §11a/§11d ❌ (29/2)  ⑥ CONSIGNED dalı kaldırıldı → §11b ❌ (30/1)
//   ⑦ köken koşulunda `ownerCustomerId ||` (düzeltme öncesi) → §11c ❌ (30/1)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döner, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MachineDataSource, Prisma, RollEntrySource, StationType, WarpBeamOrigin, WarpBeamStatus, WarpKgSource } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { invoiceService } from "../src/services/invoice.service";
import { InventoryService } from "../src/services/inventory.service";
import { openDoff } from "../src/services/machine-doff.service";
import { mountBeam } from "../src/services/warp-beam-mount.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { applyWarpBeamEventTx } from "../src/services/helpers/warp-beam-event.helper";
import { cancelConsumedForRollTx } from "../src/services/warp-beam-auto-consume.service";
import { resolveExchangeRateTx } from "../src/services/helpers/finance.helper";
import { weavingActualCostTx, type WeavingActualCost } from "../src/services/helpers/weaving-actual-cost.helper";
import { loadRollWarpingCostsTx, splitInvoiceNet } from "../src/services/helpers/warping-actual-fee.helper";
import { buildWeavingEfficiencySunumu, EKSIK, weavingEfficiencyTable, type WeavingEfficiencyReport } from "../src/services/reports/weaving-efficiency.report";
import { resolveCoreDayRange } from "../src/services/reports/temel/_day-range";
import { getWeavingOrderActualCost } from "../src/services/weaving-order-actual-cost.service";
import { yorumlariSok } from "./lib/regime-gate-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const TAG = `TEST-DVM-${process.pid}`;
const code = (s: string) => `${TAG}-${s}`.slice(0, 32);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const eq = (d: Prisma.Decimal | null | undefined, v: Prisma.Decimal.Value) => d != null && d.toDecimalPlaces(6).eq(D(v).toDecimalPlaces(6));
const s = (d: Prisma.Decimal | null | undefined) => (d == null ? "null" : d.toString());
const SETTING_FOTO = [
  SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED,
  SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_REWORK_BILLABLE,
  SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME, SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE,
  SETTING_KEYS.EMANET_ENABLED,
] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

function staticSection(): void {
  console.log("\n§8 — tek kaynak (metin)");
  const src = (f: string) => yorumlariSok(readFileSync(path.join(__dirname, "..", f), "utf8"));
  const weaving = src("src/services/helpers/weaving-actual-cost.helper.ts");
  const fee = src("src/services/helpers/warping-actual-fee.helper.ts");
  const fin = src("src/services/helpers/warping-fee-finance.helper.ts");
  check("§8a dokuma helper'ı devere/fatura tablosuna DOĞRUDAN dokunmaz; payı köprüden (`loadRollWarpingCosts`) okur",
    !/\b(warpBeam|warpBeamEvent|invoice|invoiceToWarpingReceipt|warpingOrder)\./.test(weaving) && /loadRollWarpingCosts\(/.test(weaving) && !/warping-actual-fee|warping-fee-finance/.test(weaving));
  check("§8b devere payı helper'ı ücret çarpımı yazmaz (`feeUnitPrice` yok), beklenen tutarı `loadWarpingOrderFeesTx`ten alır",
    !fee.includes("feeUnitPrice") && /loadWarpingOrderFeesTx\(/.test(fee));
  check("§8c yeni helper'larda JS sayı aritmetiği yok (`Number(` / `parseFloat` / `toNumber`)",
    ![fee, fin].some((t) => /\bNumber\(|parseFloat|toNumber\(/.test(t)));
  const srcFiles = ["src/services/helpers/maliyet-bridge.helper.ts", "src/services/helpers/weaving-actual-cost.helper.ts", "src/services/reports/weaving-efficiency.report.ts"].map(src);
  check("§8d devere/fatura okuyucuları yalnız köprüde ve DİNAMİK import edilir",
    /await import\("\.\/warping-actual-fee\.helper"\)/.test(srcFiles[0]!) && /await import\("\.\/warping-fee-finance\.helper"\)/.test(srcFiles[0]!)
      && !srcFiles.some((t) => /^import .*warping-(actual-fee|fee-finance)\.helper/m.test(t)));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERE FATURASI → DOKUMA GERÇEK MALİYETİ ===");
  staticSection();
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const subSnap = await prisma.subcontractor.findUniqueOrThrow({ where: { id: sub.id }, select: { customerId: true } });
  const inventory = new InventoryService();
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  const rollIds: string[] = [];
  const woIds: string[] = [];
  const machineIds: string[] = [];
  const extraBeamIds: string[] = [];
  let stationId: string | null = null;
  let cardId: string | null = null;
  let yarnId: string | null = null;
  let fabricId: string | null = null;
  let specId: string | null = null;
  let rateId: string | null = null;
  let ownerId: string | null = null;
  try {
    for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING, SETTING_KEYS.DEVERE_AUTO_CONSUME, SETTING_KEYS.EMANET_ENABLED]) await setSetting(k, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.DEVERE_REWORK_BILLABLE, SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE] } } });
    await reconcileReasonPresets();
    if (!(await prisma.exchangeRate.findFirst({ where: { currency: "USD", rateDate: { lte: new Date() } }, select: { id: true } }))) {
      rateId = (await prisma.exchangeRate.create({ data: { rateDate: new Date("2001-01-01"), currency: "USD", rate: 30 }, select: { id: true } })).id;
    }
    cardId = (await prisma.customer.create({ data: { code: code("C"), name: `${TAG} devereci kartı` }, select: { id: true } })).id;
    await prisma.subcontractor.update({ where: { id: sub.id }, data: { customerId: cardId } });
    yarnId = (await prisma.item.create({ data: { code: code("X"), name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
    fabricId = (await prisma.item.create({ data: { code: code("KM"), name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
    specId = (await prisma.warpSpec.create({ data: { code: code("S"), name: `${TAG} zemin`, yarnItemId: yarnId, endsCount: 3000, takeUpPct: 20, yarns: { create: [{ yarnItemId: yarnId, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
    stationId = (await prisma.station.create({ data: { name: `${TAG}-DOKUMA`, code: code("DK"), type: StationType.INTERNAL, kind: "WEAVING", consumesWarpBeam: true }, select: { id: true } })).id;

    const newOrder = async (fee: { feeUnitPrice: number | null; feeCurrency?: "USD" | null }) => {
      const r = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: specId!, beamLines: [{ beamCount: 4, beamLengthM: 1000 }], feeUnit: "METRE", ...fee }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const receive = async (orderId: string, lengths: number[], note: string) => (await receiveWarpingOrder(orderId, { clientToken: randomUUID(), deliveryNoteNo: note, beams: lengths.map((lengthM) => ({ lengthM })) }, U)).receiptKey;
    const beamsOf = async (key: string) => (await prisma.warpBeam.findMany({ where: { warpingReceiptKey: key }, select: { id: true }, orderBy: { beamNo: "asc" } })).map((b) => b.id);
    const receivedAt = async (key: string) => (await prisma.warpBeamEvent.findFirstOrThrow({ where: { kind: "WOUND", beam: { warpingReceiptKey: key } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })).createdAt;
    const usdAt = async (at: Date) => (await resolveExchangeRateTx(prisma as unknown as Prisma.TransactionClient, "USD", at))!;
    // Tezgâh + iş + açık koşum; levent(ler) bağlanır.
    const loomFor = async (n: string, beamIds: string[]) => {
      const m = await prisma.machine.create({ data: { stationId: stationId!, name: `${TAG} ${n}`, code: code(n), warpBeamSlots: Math.max(1, beamIds.length) }, select: { id: true } });
      machineIds.push(m.id);
      const wo = await prisma.weavingOrder.create({ data: { weavingOrderNumber: code(`W${n}`), itemId: fabricId!, executionKind: "IN_HOUSE", status: "COMPLETED" }, select: { id: true } });
      woIds.push(wo.id);
      const run = await prisma.machineRun.create({ data: { machineId: m.id, weavingOrderId: wo.id, startedAt: new Date(Date.now() - 3_600_000) }, select: { id: true } });
      for (const [i, b] of beamIds.entries()) await mountBeam(b, { machineId: m.id, position: i + 1 });
      return { machineId: m.id, woId: wo.id, runId: run.id };
    };
    // KK1 doğuşu: doff + top → `autoConsumeForRollTx` bağlı leventlerden CONSUMED yazar.
    const top = async (loom: { machineId: string; runId: string }, m: number) => {
      const doff = (await openDoff({ machineId: loom.machineId, machineRunId: loom.runId, productionLineNo: 1, pieceCount: 1, counterSource: MachineDataSource.OPERATOR })).data!.id;
      const r = await inventory.createInitialEntry({ itemId: fabricId!, initialQty: m }, undefined, null, false, { forcedEntrySource: RollEntrySource.WEAVING, doffEventId: doff });
      const id = (r.data as { id: string }).id;
      rollIds.push(id);
      return id;
    };
    const row = async (woId: string): Promise<WeavingActualCost> => (await weavingActualCostTx(prisma, [woId], "OTURUM"))[0]!;
    const report = (rows: WeavingActualCost[]): WeavingEfficiencyReport => ({ currency: "TRY", fxRate: null, rows, runlessMeters: "0" });
    const cell = (w: WeavingActualCost, key: string) => weavingEfficiencyTable(report([w])).satirlar[0]![key];

    // ── Fikstür: O1 faturalı · O2 faturasız · O3 bir fatura iki kabul · O4 ücretsiz ──
    const O1 = await newOrder({ feeUnitPrice: 0.1, feeCurrency: "USD" });
    const O2 = await newOrder({ feeUnitPrice: 0.1, feeCurrency: "USD" });
    const O3 = await newOrder({ feeUnitPrice: 0.1, feeCurrency: "USD" });
    const O4 = await newOrder({ feeUnitPrice: null, feeCurrency: null });
    const k1 = await receive(O1, [1000, 1000], "DVM-1");
    const k2 = await receive(O2, [1000, 1000], "DVM-2");
    const k3a = await receive(O3, [1000], "DVM-3A");
    const k3b = await receive(O3, [500], "DVM-3B");
    const k4 = await receive(O4, [1000], "DVM-4");
    const inv1 = (await invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "USD", exchangeRate: 40, warpingReceiptKeys: [k1], lines: [{ description: "Devere", qty: 1, unit: "adet", unitPrice: 250, discountRate: 16, vatRate: 20 }] }, U)).data.id;
    invoiceIds.push(inv1);
    await invoiceService.confirm(inv1, U);
    const inv1Row = await prisma.invoice.findUniqueOrThrow({ where: { id: inv1 }, select: { subtotal: true, discountTotal: true, vatTotal: true } });
    check("§1 fikstür: fatura satır neti 210 (250 − %16 iskonto 40), KDV 42 ayrı", eq(inv1Row.subtotal, 210) && eq(inv1Row.discountTotal, 40) && eq(inv1Row.vatTotal, 42), JSON.stringify(inv1Row));
    const inv3 = (await invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "USD", exchangeRate: 40, warpingReceiptKeys: [k3a, k3b], lines: [{ description: "Devere", qty: 1, unit: "adet", unitPrice: 160 }] }, U)).data.id;
    invoiceIds.push(inv3);
    await invoiceService.confirm(inv3, U);

    const [b1a] = await beamsOf(k1);
    const [b2a, b2b, ] = await beamsOf(k2);
    const [b3b] = await beamsOf(k3b);
    const [b4] = await beamsOf(k4);
    const L1 = await loomFor("T1", [b1a!]);
    const L2 = await loomFor("T2", [b2a!]);
    const L3 = await loomFor("T3", [b3b!, b2b!]);
    const L5 = await loomFor("T5", [b4!]);

    console.log("\n§1 — el hesabı (faturalı kabul)");
    const rA = await top(L1, 100);
    const consA = await prisma.warpBeamEvent.findMany({ where: { rollId: rA, kind: "CONSUMED" }, select: { lengthM: true } });
    check("§1a top doğdu, çözgü tüketimi yazıldı: 100 m kumaş, take-up %20 → 125 m", consA.length === 1 && eq(consA[0]!.lengthM, 125), JSON.stringify(consA));
    const w1 = await row(L1.woId);
    check("§1b ⭐ Devere = 125 × (210 × 40 ÷ 2000) = 525 TL; 525 ÷ 100 m = 5,25 TL/m; kaynak FATURA; tahmini 0",
      eq(w1.warpingCostTry, 525) && eq(w1.warpingPerMTry, "5.25") && eq(w1.warpingCoveredMeters, 100) && w1.warpingSource === "FATURA" && eq(w1.warpingEstimatedTry, 0) && w1.warpingMissing?.length === 0,
      `${s(w1.warpingCostTry)} · ${s(w1.warpingPerMTry)} · ${w1.warpingSource} · ${w1.warpingMissing}`);
    check("§1c tablo: 'Devere /m' 5,25 · 'Devere kaynağı' fatura; tezgâh sayıları ve ana `missing` devereden etkilenmez",
      cell(w1, "devereM") === 5.25 && cell(w1, "devereKaynak") === "fatura" && !w1.missing.some((m) => m.startsWith("DEVERE") || m === "COZGU_TUKETIMI"),
      `${cell(w1, "devereM")} | ${cell(w1, "devereKaynak")}`);
    const tablo = weavingEfficiencyTable(report([w1]));
    const keys = tablo.kolonlar.map((k) => k.anahtar);
    check("§1d kolonlar: 'Devere /m' + 'Devere kaynağı' Durum'dan önce; eski kolonlar aynı sırada",
      keys.join(",") === "is,urun,tezgah,standartM,gercekM,fark,farkYuzde,teorikMSaat,gercekMSaat,durusPayi,kosumluM,kosumsuzM,devereM,devereKaynak,cozguIplikM,cozguIplikKaynak,durum"
        && tablo.kolonlar.find((k) => k.anahtar === "devereM")?.baslik === "Devere /m" && tablo.kolonlar.find((k) => k.anahtar === "devereKaynak")?.baslik === "Devere kaynağı");

    console.log("\n§10 — iş emri ayrıntısı ucu (DTO)");
    const dto = await getWeavingOrderActualCost(L1.woId);
    const dv = dto.satirlar.find((x) => x.anahtar === "DEVERE");
    check("§10a ⭐ DTO satırları Tezgâh · Devere · Çözgü ipliği; Devere gerçekleşen 5,25 TL/m, kaynak 'fatura', tahmini değil, standart karşılık YOK (null, 0 değil)",
      dto.satirlar.map((x) => x.anahtar).join(",") === "TEZGAH,DEVERE,COZGU_IPLIGI" && dv?.gercekTlM === "5.25" && dv.kaynak === "fatura" && dv.tahmini === false && dv.standartTlM === null && dv.eksik.length === 0,
      JSON.stringify(dv));
    check("§10b DTO notu devere için standart kalemin seçilemediğini söyler; iş no ve top metresi tek kaynaktan",
      dto.notlar.some((n) => /standart maliyette ayrı kalem seçilemiyor/.test(n)) && dto.isEmriId === L1.woId && dto.topMetre === "100");
    let notFound = 0;
    try { await getWeavingOrderActualCost(randomUUID()); } catch (e) { notFound = (e as { statusCode?: number }).statusCode ?? -1; }
    check("§10c olmayan iş emri → 404", notFound === 404, String(notFound));
    const routeSrc = yorumlariSok(readFileSync(path.join(__dirname, "..", "src/routes/cost.routes.ts"), "utf8"));
    check("§10d uç `/api/cost/weaving-orders/:id/actual`: dokuma kapısı + `cost:read` (maliyet kapısı router seviyesinde)",
      /router\.get\("\/weaving-orders\/:id\/actual", requireDokumaEnabled, requirePermission\("cost:read"\)/.test(routeSrc) && /router\.use\(verifyToken, requireMaliyetEnabled\)/.test(routeSrc));

    console.log("\n§2 — faturasız kabul (tahmini)");
    const R2 = await usdAt(await receivedAt(k2));
    const rB = await top(L2, 100);
    const w2 = await row(L2.woId);
    // Kabul beklenen = 2000 m × 0,10 = 200 USD × R → 0,1·R TL/çözgü m → 125 m → 12,5·R TL → 0,125·R TL/m.
    check("§2a ⭐ beklenen 200 USD × kabul günü kuru; kaynak TARIFE, tahmini = tamamı",
      eq(w2.warpingCostTry, R2.mul("12.5")) && eq(w2.warpingPerMTry, R2.mul("0.125")) && w2.warpingSource === "TARIFE" && eq(w2.warpingEstimatedTry, R2.mul("12.5")),
      `R=${R2} · ${s(w2.warpingCostTry)} · ${w2.warpingSource}`);
    check("§2b tablo kaynağı 'tarife (tahmini)'; sunumda tahmin uyarısı", cell(w2, "devereKaynak") === "tarife (tahmini)"
      && buildWeavingEfficiencySunumu(report([w1, w2]), resolveCoreDayRange({}, 30)).uyarilar.some((u) => /siparişindeki ücretten tahmin/.test(u)));
    const draft2 = (await invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "USD", exchangeRate: 40, warpingReceiptKeys: [k2], lines: [{ description: "Devere", qty: 1, unit: "adet", unitPrice: 999 }] }, U)).data.id;
    invoiceIds.push(draft2);
    const w2d = await row(L2.woId);
    check("§2c ⭐ TASLAK fatura maliyete girmez → yine TARIFE, aynı değer", w2d.warpingSource === "TARIFE" && eq(w2d.warpingCostTry, R2.mul("12.5")), `${w2d.warpingSource} ${s(w2d.warpingCostTry)}`);

    console.log("\n§4 — bir fatura iki kabul");
    const split = splitInvoiceNet(D(6400), [
      { receiptKey: "a", expectedAmount: D(100), lengthM: D(1000), currency: "USD" },
      { receiptKey: "b", expectedAmount: D(50), lengthM: D(500), currency: "USD" },
      { receiptKey: "c", expectedAmount: D(50), lengthM: D(500), currency: "USD" },
    ]);
    const sum = [...split.values()].reduce((a, v) => a.plus(v), D(0));
    check("§4a paylaştırma beklenen tutar payıyla (3200 · 1600 · 1600), Σ = net", eq(split.get("a"), 3200) && eq(split.get("b"), 1600) && eq(sum, 6400));
    const odd = splitInvoiceNet(D(100), [
      { receiptKey: "a", expectedAmount: D(1), lengthM: D(1), currency: "USD" },
      { receiptKey: "b", expectedAmount: D(1), lengthM: D(1), currency: "USD" },
      { receiptKey: "c", expectedAmount: D(1), lengthM: D(1), currency: "USD" },
    ]);
    check("§4b kuruş: 33,33 · 33,33 · son kabul kalanı 33,34 (Σ tam 100)", eq(odd.get("a"), "33.33") && eq(odd.get("c"), "33.34") && eq([...odd.values()].reduce((a, v) => a.plus(v), D(0)), 100));
    const mixed = splitInvoiceNet(D(300), [
      { receiptKey: "a", expectedAmount: D(10), lengthM: D(1000), currency: "USD" },
      { receiptKey: "b", expectedAmount: null, lengthM: D(500), currency: null },
    ]);
    check("§4c beklenen karşılaştırılamıyorsa (ücretsiz/farklı döviz) sarım metresi payı: 200 · 100", eq(mixed.get("a"), 200) && eq(mixed.get("b"), 100));

    console.log("\n§5 — iki levent tek top: faturalı + faturasız (KARMA)");
    const rC = await top(L3, 40);
    const consC = await prisma.warpBeamEvent.findMany({ where: { rollId: rC, kind: "CONSUMED" }, select: { beamId: true, lengthM: true } });
    const w3 = await row(L3.woId);
    // inv3: 160 USD × 40 = 6400 TL; k3a beklenen 100, k3b 50 → k3b = 6400 − 4266,67 = 2133,33 → 2133,33 ÷ 500 = 4,26666 TL/m.
    const fromInvoice = D("2133.33").div(500).mul(50);
    const estimated = R2.mul("0.1").mul(50);
    check("§5a fikstür: top iki leventten 50'şer m çözgü tüketti", consC.length === 2 && consC.every((c) => eq(c.lengthM, 50)));
    check("§5b ⭐ fatura payı (k3b'ye 2133,33 TL düştü) + tarife payı; kaynak KARMA, tahmini pay ayrı",
      eq(w3.warpingCostTry, fromInvoice.plus(estimated)) && w3.warpingSource === "KARMA" && eq(w3.warpingEstimatedTry, estimated) && eq(w3.warpingPerMTry, fromInvoice.plus(estimated).div(40)),
      `${s(w3.warpingCostTry)} · ${w3.warpingSource} · tahmini ${s(w3.warpingEstimatedTry)}`);
    check("§5c tablo kaynağı 'karma (kısmen tahmini)'", cell(w3, "devereKaynak") === "karma (kısmen tahmini)");

    console.log("\n§6 — tüketim kapsamı");
    const rA2 = (await prisma.roll.create({ data: { barcode: code("RA2"), itemId: fabricId!, initialQty: 50, currentQty: 50, status: "STOCK", entrySource: RollEntrySource.WEAVING, weavingOrderId: L1.woId }, select: { id: true } })).id;
    rollIds.push(rA2);
    const w1b = await row(L1.woId);
    check("§6a ⭐ tüketimsiz top (KK1 iş seçimi, tezgâh yok) paya da paydaya da girmez: yine 5,25 TL/m, kapsanan 100 / 150 m + COZGU_TUKETIMI",
      eq(w1b.warpingPerMTry, "5.25") && eq(w1b.warpingCoveredMeters, 100) && eq(w1b.totalMeters, 150) && w1b.warpingMissing?.includes("COZGU_TUKETIMI") === true,
      `${s(w1b.warpingPerMTry)} · ${w1b.warpingMissing}`);
    check("§6b tablo kaynağı kapsamı açık yazar (uydurma 0 yok)", /^fatura · eksik: çözgü tüketimi \(kapsanan 100(,0)? \/ 150(,0)? m\)$/.test(String(cell(w1b, "devereKaynak"))), String(cell(w1b, "devereKaynak")));
    const rB2 = await top(L2, 20);
    await prisma.$transaction((tx) => cancelConsumedForRollTx(tx, rB2, `${TAG} sonda`));
    const w2c = await row(L2.woId);
    check("§6c ⭐ geri alınmış tüketim (CONSUMED_CANCEL) sayılmaz: top tüketimsiz kalır, değer §2'yle aynı",
      eq(w2c.warpingCostTry, R2.mul("12.5")) && eq(w2c.warpingCoveredMeters, 100) && w2c.warpingMissing?.includes("COZGU_TUKETIMI") === true,
      `${s(w2c.warpingCostTry)} · ${s(w2c.warpingCoveredMeters)}`);

    console.log("\n§7 — köken, ücretsiz sipariş, ayar, kur");
    const own = await createWarpBeam({ warpSpecId: specId, plannedLengthM: 1000, originKind: WarpBeamOrigin.IN_HOUSE });
    extraBeamIds.push(own.data.id);
    // İçeride sarım iplik çıkışı ister; maliyet sorusu yalnız kökeni okur → WOUND tek yazardan doğrudan.
    await prisma.$transaction((tx) => applyWarpBeamEventTx(tx, { beamId: own.data.id, kind: "WOUND", from: WarpBeamStatus.PLANNED, to: WarpBeamStatus.READY, data: { lengthM: 1000, endsCount: 3000, denier: 150, theoreticalKg: 50, kgSource: WarpKgSource.THEORETICAL } }));
    const L4 = await loomFor("T4", [own.data.id]);
    await top(L4, 10);
    const w4 = await row(L4.woId);
    check("§7a kendi devere leventi → ölçülmüş 0 (dış hizmet yok), kaynak 'fason devere yok'",
      eq(w4.warpingCostTry, 0) && eq(w4.warpingPerMTry, 0) && w4.warpingSource === null && w4.warpingMissing?.length === 0 && cell(w4, "devereKaynak") === "fason devere yok (kendi leventi)",
      `${s(w4.warpingCostTry)} | ${cell(w4, "devereKaynak")}`);
    await top(L5, 10);
    const w5 = await row(L5.woId);
    check("§7b ⭐ ücretsiz devere siparişi → null + DEVERE_UCRETI; 'Devere /m' hücresi 'eksik' (0 değil)",
      w5.warpingCostTry === null && w5.warpingPerMTry === null && w5.warpingMissing?.includes("DEVERE_UCRETI") === true && cell(w5, "devereM") === EKSIK,
      `${cell(w5, "devereM")} | ${cell(w5, "devereKaynak")}`);
    await setSetting(SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE, "YALNIZ_FATURA");
    const [w1y, w2y] = await weavingActualCostTx(prisma, [L1.woId, L2.woId], "OTURUM");
    check("§7c YALNIZ_FATURA: faturasız kabul tahmin edilmez → DEVERE_FATURASI; faturalı iş aynı (5,25)",
      w2y!.warpingCostTry === null && w2y!.warpingMissing?.includes("DEVERE_FATURASI") === true && eq(w1y!.warpingPerMTry, "5.25"), `${w2y!.warpingMissing}`);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.COST_PROFIT_SUBCONTRACT_SOURCE } });
    const noFx = await loadRollWarpingCostsTx(prisma, [rB], { readInvoices: null, fxRate: async () => null, reworkBillable: true, invoiceOnly: false });
    check("§7d kur yok → null + FX_RATE_MISSING (kur asla 1 varsayılmaz)", noFx.get(rB)?.costTry === null && noFx.get(rB)?.missing.includes("FX_RATE_MISSING") === true);

    console.log("\n§11 — levent kökeni (satın alınan · emanet · müşteri ipliğiyle devere)");
    ownerId = (await prisma.customer.create({ data: { code: code("OWN"), name: `${TAG} kumaş müşterisi` }, select: { id: true } })).id;
    // Satın alınan/emanet leventin sarım iplik çıkışı yok; maliyet sorusu yalnız kökeni okur → WOUND tek yazardan doğrudan.
    const readyBeam = async (origin: { originKind: WarpBeamOrigin; subcontractorId?: string; ownerCustomerId?: string }) => {
      const b = (await createWarpBeam({ warpSpecId: specId!, plannedLengthM: 1000, ...origin })).data.id;
      extraBeamIds.push(b);
      await prisma.$transaction((tx) => applyWarpBeamEventTx(tx, { beamId: b, kind: "WOUND", from: WarpBeamStatus.PLANNED, to: WarpBeamStatus.READY, data: { lengthM: 1000, endsCount: 3000, denier: 150, theoreticalKg: 50, kgSource: WarpKgSource.THEORETICAL } }));
      return b;
    };
    const kokenEksik = (w: WeavingActualCost) => w.warpingCostTry === null && w.warpingPerMTry === null && w.warpingSource === null
      && w.warpingMissing?.includes("LEVENT_KOKENI") === true && cell(w, "devereM") === EKSIK && String(cell(w, "devereKaynak")).includes("satın alınan ya da emanet levent");
    const LP = await loomFor("T6", [await readyBeam({ originKind: WarpBeamOrigin.PURCHASED, subcontractorId: sub.id })]);
    await top(LP, 10);
    const wP = await row(LP.woId);
    check("§11a ⭐ satın alınan levent → devere null + LEVENT_KOKENI; 'Devere /m' 'eksik' (0 değil), kaynak 'eksik: satın alınan ya da emanet levent'",
      kokenEksik(wP), `${s(wP.warpingCostTry)} · ${wP.warpingMissing} | ${cell(wP, "devereM")} | ${cell(wP, "devereKaynak")}`);
    const LC = await loomFor("T7", [await readyBeam({ originKind: WarpBeamOrigin.CONSIGNED, ownerCustomerId: ownerId })]);
    await top(LC, 10);
    const wC = await row(LC.woId);
    check("§11b ⭐ emanet (müşterinin) levent → aynı: null + LEVENT_KOKENI, hücre 'eksik'",
      kokenEksik(wC), `${s(wC.warpingCostTry)} · ${wC.warpingMissing} | ${cell(wC, "devereM")}`);
    // Devere kabulü sahibi müşteri ipliği lotundan kalıtır (`receive-core`); fikstür kalıtılmış hâli doğrudan kurar.
    const O5 = await newOrder({ feeUnitPrice: 0.1, feeCurrency: "USD" });
    const k5 = await receive(O5, [1000, 1000], "DVM-5");
    const [b5a, b5b] = await beamsOf(k5);
    await prisma.warpBeam.updateMany({ where: { warpingReceiptKey: k5 }, data: { ownerCustomerId: ownerId } });
    const R5 = await usdAt(await receivedAt(k5));
    const LO = await loomFor("T8", [b5a!]);
    await top(LO, 10);
    const wO = await row(LO.woId);
    // Kabul beklenen = 2000 m × 0,10 = 200 USD × R → 0,1·R TL/çözgü m → 12,5 m → 1,25·R TL.
    check("§11c ⭐ kendi devere siparişimizden, sahibi müşteri olan (müşteri ipliği) levent → bugünkü hesap: TARIFE 1,25·R, LEVENT_KOKENI YOK",
      eq(wO.warpingCostTry, R5.mul("1.25")) && wO.warpingSource === "TARIFE" && wO.warpingMissing?.length === 0,
      `R=${R5} · ${s(wO.warpingCostTry)} · ${wO.warpingSource} · ${wO.warpingMissing}`);
    const LM = await loomFor("T9", [await readyBeam({ originKind: WarpBeamOrigin.PURCHASED, subcontractorId: sub.id }), b5b!]);
    await top(LM, 10);
    const wM = await row(LM.woId);
    check("§11d satın alınan + devere leventi tek top → toplam null (devere payı kısmi toplam olarak yazılmaz) + LEVENT_KOKENI",
      wM.warpingCostTry === null && wM.warpingMissing?.includes("LEVENT_KOKENI") === true && cell(wM, "devereM") === EKSIK, `${s(wM.warpingCostTry)} · ${wM.warpingMissing}`);

    console.log("\n§3 — fatura iptali");
    const R1 = await usdAt(await receivedAt(k1));
    await invoiceService.cancel(inv1, `${TAG} storno`, U);
    const w1c = await row(L1.woId);
    check("§3a ⭐ iptal edilen fatura sayılmaz → beklenen 200 USD × kabul günü kuru (TARIFE): 125 × 0,1·R",
      w1c.warpingSource === "TARIFE" && eq(w1c.warpingCostTry, R1.mul("12.5")) && eq(w1c.warpingEstimatedTry, R1.mul("12.5")),
      `${w1c.warpingSource} · ${s(w1c.warpingCostTry)}`);

    console.log("\n§9 — devere kapalı");
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "false");
    const w1off = await row(L1.woId);
    check("§9a devere kapalı → devere alanları null (sorgu yok), tezgâh alanları aynı; kolon var hücre boş",
      w1off.warpingCostTry === null && w1off.warpingMissing === null && w1off.warpingSource === null && eq(w1off.totalMeters, 150)
        && cell(w1off, "devereM") === null && cell(w1off, "devereKaynak") === null && weavingEfficiencyTable(report([w1off])).kolonlar.some((k) => k.anahtar === "devereM"));
    const dtoOff = await getWeavingOrderActualCost(L1.woId);
    check("§9b devere kapalı → iş emri ayrıntısında yalnız Tezgâh satırı (devere/iplik satırı yok)", dtoOff.satirlar.map((x) => x.anahtar).join(",") === "TEZGAH");
    await setSetting(SETTING_KEYS.DEVERE_ENABLED, "true");
  } finally {
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: rollIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.doffEvent.deleteMany({ where: { machineId: { in: machineIds } } });
    await prisma.machineRun.deleteMany({ where: { machineId: { in: machineIds } } });
    if (invoiceIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.printedDocument.deleteMany({ where: { sourceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: invoiceIds } } });
    }
    if (cardId) {
      const cariler = (await prisma.cariAccount.findMany({ where: { customerId: cardId }, select: { id: true } })).map((c) => c.id);
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariler } } });
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariler } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariler } } });
    }
    await prisma.subcontractor.update({ where: { id: sub.id }, data: { customerId: subSnap.customerId } });
    const beamIds = [...(await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id), ...extraBeamIds];
    await prisma.warpBeamYarnAllocation.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpBeamEventYarn.deleteMany({ where: { event: { beamId: { in: beamIds } } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds }, reversesEventId: { not: null } } });
    await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: beamIds } } });
    await prisma.notificationOutbox.deleteMany({ where: { subjectId: { in: beamIds } } }).catch(() => undefined);
    await prisma.warpBeam.deleteMany({ where: { id: { in: beamIds } } });
    await prisma.warpingOrderToOrder.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderExtraSpec.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: orderIds } } });
    await prisma.warpingOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...beamIds, ...woIds] } } });
    await prisma.weavingOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.machine.deleteMany({ where: { id: { in: machineIds } } });
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
    if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
    await prisma.item.deleteMany({ where: { id: { in: [yarnId, fabricId].filter((x): x is string => !!x) } } });
    await prisma.customer.deleteMany({ where: { id: { in: [cardId, ownerId].filter((x): x is string => !!x) } } });
    if (rateId) await prisma.exchangeRate.deleteMany({ where: { id: rateId } });
    for (const key of SETTING_FOTO) {
      const f = foto.find((x) => x.key === key);
      if (f) await prisma.systemSetting.update({ where: { key }, data: { value: f.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await pool.end();
}

main().catch(async (e) => {
  console.error("💥", e);
  process.exitCode = 1;
  await pool.end();
});
