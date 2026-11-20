// =============================================================================
// DEVERE A1 — DEVERECİ FATURASI: beklenen ücret · fatura ↔ kabul bağı · fark uyarısı · storno kapısı · yarış
// =============================================================================
// Fikstür: tek iplikli kart (3000 tel × 150 den → 1000 m = 50 kg). Siparişler (dönüş kabulü; iplik sevki gerekmez):
//   A METRE 0,05 USD — kabul 1: 6×1000 m (300) · kabul 2: 1×500 m (25)   B KG 2 USD — 1×1000 m (50 kg → 100)
//   E ENDS_METRE 0,0001 USD — 1×1000 m (3 000 000 tel·m → 300)   F ücretsiz   G METRE 1,5 TRY   H geri alınmış kabul
//   S başka devereci (zımpara fikstürü) — taraf kapısı
// Kapsam: K2 (A1/A7/A8/A9) · K3 ikizi · A2 fark uyarır/onay serbest · A3 iki sipariş tek fatura · A4 faturalı seçilemez,
//   iptal → seçilir · A6 faturalı kabul/levent stornosu 409 · A10 farklı döviz fark yok · A13 taraf 400 · A14 fatura bilgisi
//   izinsiz yok · A15 replay · A16 yarış (iki taslak aynı kabul; açık bağlama tx'i ↔ storno) · PATCH REPLACE · liste süzgeci
//   · ALIŞ dışı 400 · `devere.reworkBillable` okuyucusu (kayıt yok = true).
// NEGATİF SONDA (koşuldu 2026-11-20): bkz. arşiv notu "Devere A1 — devereci faturası".
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; ayarlar FOTOĞRAFINA döndürülür, kendi kayıtlarını siler.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestSubcontractor, ensureTestSander, TEST_KARTELA } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";
import { SETTING_KEYS, readDevereReworkBillable } from "../src/services/system-setting.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { cancelWound } from "../src/services/warp-beam-wind.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { receiveWarpingOrder } from "../src/services/warping-order/receive";
import { cancelWarpingReceipt, previewCancelWarpingReceipt } from "../src/services/warping-order/receive-cancel";
import { listWarpingOrders } from "../src/services/warping-order/read";
import { createWarpingInvoiceDraft, getWarpingOrderFeeSummary, listWarpingInvoiceCandidates, warpingFeeMatch } from "../src/services/warping-order/fee-invoice";
import { invoiceService } from "../src/services/invoice.service";
import { ACCEPTED_WARPING_BEAM_WHERE, isAcceptedWarpingBeam } from "../src/services/helpers/warping-fee.helper";
import { assertWarpingReceiptsLinkableTx, lockWarpingReceiptOrdersTx, writeInvoiceWarpingReceiptsTx } from "../src/services/helpers/invoice-warping-receipts.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FDF-${process.pid}`;
type Err = { status?: number; code?: string; msg: string };
const errOf = async (fn: () => Promise<unknown>): Promise<Err | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string }; message?: string };
    return { status: x.statusCode, code: x.details?.code, msg: String(x.message ?? e) };
  }
};
const show = (e: Err | null) => (e ? `${e.status} ${e.code ?? ""} ${e.msg.slice(0, 140)}` : "hata yok");
const SETTING_FOTO = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.DEVERE_LOT_REQUIRED, SETTING_KEYS.DEVERE_FASON_LOT_POLICY, SETTING_KEYS.DEVERE_REWORK_BILLABLE] as const;
const setSetting = (key: string, value: Prisma.InputJsonValue) => prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    await pool.end();
    return;
  }
  console.log("=== DEVERE A1 — DEVERECİ FATURASI ===");
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...SETTING_FOTO] } }, select: { key: true, value: true } });
  const U = await testActorId();
  const sub = await ensureTestSubcontractor(TEST_KARTELA);
  const sander = await ensureTestSander();
  const subSnap = await prisma.subcontractor.findUniqueOrThrow({ where: { id: sub.id }, select: { customerId: true } });
  const orderIds: string[] = [];
  const invoiceIds: string[] = [];
  let cardId: string | null = null;
  let yarnId: string | null = null;
  let specId: string | null = null;
  let rateId: string | null = null;
  try {
    for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.FINANCE_ENABLED]) await setSetting(k, "true");
    await setSetting(SETTING_KEYS.DEVERE_LOT_REQUIRED, "false");
    await setSetting(SETTING_KEYS.DEVERE_FASON_LOT_POLICY, "FREE");
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DEVERE_REWORK_BILLABLE } });
    await reconcileReasonPresets();
    if (!(await prisma.exchangeRate.findFirst({ where: { currency: "USD", rateDate: { lte: new Date() } }, select: { id: true } }))) {
      rateId = (await prisma.exchangeRate.create({ data: { rateDate: new Date("2001-01-01"), currency: "USD", rate: 30 }, select: { id: true } })).id;
    }
    cardId = (await prisma.customer.create({ data: { code: `${TAG}-C`.slice(0, 32), name: `${TAG} devereci kartı` }, select: { id: true } })).id;
    await prisma.subcontractor.update({ where: { id: sub.id }, data: { customerId: cardId } });
    yarnId = (await prisma.item.create({ data: { code: `${TAG}-X`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 150 }, select: { id: true } })).id;
    specId = (await prisma.warpSpec.create({ data: { code: `${TAG}-S`, name: `${TAG} zemin`, yarnItemId: yarnId, endsCount: 3000, yarns: { create: [{ yarnItemId: yarnId, endsCount: 3000, sortOrder: 0 }] } }, select: { id: true } })).id;
    const newOrder = async (fee: { feeUnit?: "METRE" | "KG" | "ENDS_METRE"; feeUnitPrice?: number | null; feeCurrency?: "USD" | "TRY" | null }, subcontractorId = sub.id) => {
      const r = await createWarpingOrder({ subcontractorId, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: specId!, beamLines: [{ beamCount: 6, beamLengthM: 1000 }], ...fee }, U);
      orderIds.push(r.data.id);
      return r.data.id;
    };
    const receive = async (orderId: string, lengths: number[], note: string) => (await receiveWarpingOrder(orderId, { clientToken: randomUUID(), deliveryNoteNo: note, beams: lengths.map((lengthM) => ({ lengthM })) }, U)).receiptKey;
    const track = (r: { data: { id: string } }) => { invoiceIds.push(r.data.id); return r.data.id; };

    // ── K2 beklenen ücret ────────────────────────────────────────────────
    const A = await newOrder({ feeUnit: "METRE", feeUnitPrice: 0.05, feeCurrency: "USD" });
    const B = await newOrder({ feeUnit: "KG", feeUnitPrice: 2, feeCurrency: "USD" });
    const E = await newOrder({ feeUnit: "ENDS_METRE", feeUnitPrice: 0.0001, feeCurrency: "USD" });
    const F = await newOrder({ feeUnit: "METRE", feeUnitPrice: null });
    const G = await newOrder({ feeUnit: "METRE", feeUnitPrice: 1.5, feeCurrency: "TRY" });
    const H = await newOrder({ feeUnit: "METRE", feeUnitPrice: 0.05, feeCurrency: "USD" });
    const S = await newOrder({ feeUnit: "METRE", feeUnitPrice: 0.05, feeCurrency: "USD" }, sander.id);
    const a1 = await receive(A, [1000, 1000, 1000, 1000, 1000, 1000], "DV-1");
    const a2 = await receive(A, [500], "DV-2");
    const b1 = await receive(B, [1000], "DV-3");
    const e1 = await receive(E, [1000], "DV-4");
    const f1 = await receive(F, [1000], "DV-5");
    const g1 = await receive(G, [1000], "DV-6");
    const h1 = await receive(H, [100], "DV-7");
    const s1 = await receive(S, [1000], "DV-8");
    await cancelWarpingReceipt(H, h1, `${TAG} geri`, U);
    const sumA = await getWarpingOrderFeeSummary(A, { canReadInvoices: true });
    check("A1 METRE: kabul 6×1000 m → 6000 m × 0,05 = 300,00; ikinci kabul 25,00; toplam 325,00 USD; faturasız (NONE)",
      sumA.receipts.length === 2 && sumA.receipts[0]!.qty === "6000.000" && sumA.receipts[0]!.expectedAmount === "300.00" && sumA.receipts[1]!.expectedAmount === "25.00" && sumA.totals.expectedAmount === "325.00" && sumA.invoiceState === "NONE" && sumA.fee.currency === "USD",
      JSON.stringify(sumA.totals));
    const [sB, sE, sF, sH] = await Promise.all([B, E, F, H].map((id) => getWarpingOrderFeeSummary(id, { canReadInvoices: true })));
    check("A7 KG: 1000 m × 3000 tel × 150 den = 50 kg × 2 = 100,00", sB!.receipts[0]!.qty === "50.000" && sB!.totals.expectedAmount === "100.00", JSON.stringify(sB!.totals));
    check("A8 ENDS_METRE: 3000 tel × 1000 m × 0,0001 = 300,00", sE!.receipts[0]!.qty === "3000000.000" && sE!.totals.expectedAmount === "300.00", JSON.stringify(sE!.totals));
    check("A9 ücretsiz sipariş: beklenen null (0 uydurulmaz), ölçü yine var", sF!.totals.expectedAmount === null && sF!.receipts[0]!.expectedAmount === null && sF!.receipts[0]!.qty === "1000.000");
    check("K3 geri alınmış kabul sayılmaz: H kabulsüz, fatura durumu null", sH!.receipts.length === 0 && sH!.invoiceState === null);
    const beams = await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true, warpingOrderId: true, events: { where: { kind: "WOUND" }, select: { kind: true, reversal: { select: { id: true } } } } } });
    const dbAccepted = new Set((await prisma.warpBeam.findMany({ where: { AND: [{ warpingOrderId: { in: orderIds } }, ACCEPTED_WARPING_BEAM_WHERE] }, select: { id: true } })).map((b) => b.id));
    const twinOk = beams.every((b) => isAcceptedWarpingBeam(b) === dbAccepted.has(b.id));
    check("K3 boğaz-ikiz: bellek-içi yüklem ↔ Prisma parçası her levent için aynı (geri alınmış dahil)", twinOk && beams.length === 13 && dbAccepted.size === 12, `${beams.length}/${dbAccepted.size}`);
    const sNoFin = await getWarpingOrderFeeSummary(A, { canReadInvoices: false });
    check("A14 finance:read yok → yalnız beklenen (fatura bilgisi ve durum null)", sNoFin.invoiceState === null && sNoFin.totals.expectedAmount === "325.00" && sNoFin.receipts.every((r) => r.invoice === null));

    // ── A taslağı + replay + fark ─────────────────────────────────────────
    const tokA = randomUUID();
    const dA = await createWarpingInvoiceDraft({ warpingOrderIds: [A], clientToken: tokA }, U);
    const invA = track(dA);
    const rowA = await prisma.invoice.findUniqueOrThrow({ where: { id: invA }, select: { type: true, currency: true, status: true, lines: { select: { qty: true, unitPrice: true, unit: true, description: true } }, warpingReceiptLinks: { select: { warpingReceiptKey: true } } } });
    check("A5/A1 siparişten taslak: ALIŞ · USD · tek satır 6500 m × 0,05 · iki kabul bağlı · açıklamada irsaliyeler",
      rowA.type === "PURCHASE" && rowA.currency === "USD" && rowA.lines.length === 1 && Number(rowA.lines[0]!.qty) === 6500 && Number(rowA.lines[0]!.unitPrice) === 0.05 && rowA.lines[0]!.unit === "m" && /DV-1/.test(rowA.lines[0]!.description) && rowA.warpingReceiptLinks.length === 2,
      JSON.stringify(rowA.lines));
    const rp = await createWarpingInvoiceDraft({ warpingOrderIds: [A], clientToken: tokA }, U);
    check("A15 replay: aynı token → aynı taslak, ikinci fatura yok", rp.data.id === invA && (await prisma.invoice.count({ where: { warpingReceiptLinks: { some: { warpingOrderId: A } } } })) === 1);
    const m0 = await warpingFeeMatch(invA);
    check("Fark: beklenen 325,00 ↔ net 325,00 → fark 0, uyarı yok", m0?.expectedTotal === "325.00" && m0.invoiceNet === "325.00" && m0.difference === "0.00" && !m0.exceeded && m0.warnings.length === 0, JSON.stringify(m0));
    const detail = await invoiceService.findById(invA);
    check("Detay DTO `warpingReceipts[]` (sipariş no + kabul anahtarı)", detail.data.warpingReceipts.length === 2 && detail.data.warpingReceipts.every((w) => w.orderNo && w.warpingOrderId === A));

    // ── A6 storno kapısı ──────────────────────────────────────────────────
    const a2Beam = (await prisma.warpBeam.findFirstOrThrow({ where: { warpingReceiptKey: a2 }, select: { id: true } })).id;
    const eRc = await errOf(() => cancelWarpingReceipt(A, a2, `${TAG} geri`, U));
    const eWd = await errOf(() => cancelWound(a2Beam, `${TAG} geri`, U));
    const pv = await previewCancelWarpingReceipt(A, a2);
    check("A6 faturalı kabul stornosu 409 WARPING_RECEIPT_INVOICED (kabul + tekil levent), önizleme engelli", eRc?.code === "WARPING_RECEIPT_INVOICED" && eWd?.code === "WARPING_RECEIPT_INVOICED" && pv.blockers.some((b) => /faturalı/.test(b)), `${show(eRc)} | ${show(eWd)}`);

    // ── A4 faturalı seçilemez ────────────────────────────────────────────
    const cand = await listWarpingInvoiceCandidates({ cariId: (await prisma.invoice.findUniqueOrThrow({ where: { id: invA }, select: { cariId: true } })).cariId });
    const cA = cand.find((o) => o.id === A);
    const cB = cand.find((o) => o.id === B);
    check("A4 aday listesi: A tümü faturalı (FULL, seçilemez, fatura no), B faturasız (NONE, seçilir); S başka devereci listede yok; H kabulsüz yok",
      cA?.invoiceState === "FULL" && cA.receipts.every((r) => r.selectable === false && r.invoice?.docNo === dA.data.docNo) && cB?.invoiceState === "NONE" && cB.receipts.every((r) => r.selectable) && !cand.some((o) => o.id === S || o.id === H));
    const candEdit = await listWarpingInvoiceCandidates({ cariId: (await prisma.invoice.findUniqueOrThrow({ where: { id: invA }, select: { cariId: true } })).cariId, invoiceId: invA });
    check("Düzenlenen faturanın kendi kabulleri seçilebilir kalır", candEdit.find((o) => o.id === A)!.receipts.every((r) => r.selectable === true));
    const eAgain = await errOf(() => createWarpingInvoiceDraft({ warpingOrderIds: [A], clientToken: randomUUID() }, U));
    const eKey = await errOf(() => createWarpingInvoiceDraft({ receiptKeys: [a1], clientToken: randomUUID() }, U));
    check("A4 ikinci taslak: sipariş seçimi 409 WARPING_NOTHING_TO_INVOICE · kabul seçimi 409 WARPING_RECEIPT_ALREADY_INVOICED", eAgain?.code === "WARPING_NOTHING_TO_INVOICE" && eKey?.code === "WARPING_RECEIPT_ALREADY_INVOICED", `${show(eAgain)} | ${show(eKey)}`);
    const full = await listWarpingOrders({ status: [], subcontractorId: sub.id, warpSpecId: specId, salesOrderId: null, feeInvoiced: ["FULL"], limit: 50 });
    const none = await listWarpingOrders({ status: [], subcontractorId: sub.id, warpSpecId: specId, salesOrderId: null, feeInvoiced: ["NONE"], limit: 50 });
    check("Liste `filter[feeInvoiced]`: FULL = {A} · NONE = {B, E, F, G}; özet şeridi aynı where'den", full.data.map((r) => r.id).join() === A && none.data.length === 4 && none.summary.count === 4 && !none.data.some((r) => r.id === A || r.id === H), `${full.data.length}/${none.data.length}`);

    // ── A2 fark uyarır, onay serbest; iptal → seçilir ─────────────────────
    await invoiceService.updateDraft(invA, { lines: [{ description: "Devere ücreti", qty: 1, unit: "adet", unitPrice: 345 }] }, U);
    const m1 = await warpingFeeMatch(invA);
    check("A2 kâğıt 345 ↔ beklenen 325 → fark +20,00 (%6,15) uyarı", m1?.difference === "20.00" && m1.diffPct === "6.15" && m1.exceeded && m1.warnings.length === 1, JSON.stringify({ d: m1?.difference, p: m1?.diffPct, t: m1?.tolerancePct }));
    const conf = await errOf(() => invoiceService.confirm(invA, U));
    check("A2 fark onayı ENGELLEMEZ (onay başarılı)", conf === null && (await prisma.invoice.findUniqueOrThrow({ where: { id: invA }, select: { status: true } })).status === "CONFIRMED", show(conf));
    const ePatch = await errOf(() => invoiceService.updateDraft(invA, { warpingReceiptKeys: [] }, U));
    check("Onaylı faturanın bağı değişmez (409)", ePatch?.status === 409, show(ePatch));
    await invoiceService.cancel(invA, `${TAG} iptal`, U);
    const afterCancel = await getWarpingOrderFeeSummary(A, { canReadInvoices: true });
    check("A4 fatura iptali → kabuller yeniden faturasız (NONE)", afterCancel.invoiceState === "NONE" && afterCancel.receipts.every((r) => r.invoice === null));
    const c2 = await cancelWarpingReceipt(A, a2, `${TAG} geri`, U);
    check("İptal sonrası storno serbest (en yeni kabul geri alındı)", c2.cancelledBeams.length === 1);

    // ── A3 iki sipariş tek fatura · A10 döviz · A9 ücretsiz ─────────────────
    const d3 = await createWarpingInvoiceDraft({ receiptKeys: [a1, b1], clientToken: randomUUID() }, U);
    track(d3);
    const r3 = await prisma.invoice.findUniqueOrThrow({ where: { id: d3.data.id }, select: { lines: { select: { qty: true, unit: true } }, warpingReceiptLinks: { select: { warpingOrderId: true } } } });
    const m3 = await warpingFeeMatch(d3.data.id);
    check("A3 iki sipariş tek fatura: sipariş başı satır (6000 m · 50 kg), beklenen 400,00 = net, sipariş kırılımı 2",
      r3.lines.length === 2 && r3.warpingReceiptLinks.length === 2 && m3?.expectedTotal === "400.00" && m3.difference === "0.00" && m3.orders.length === 2 && m3.orders.find((o) => o.warpingOrderId === B)?.expectedAmount === "100.00", JSON.stringify(r3.lines));
    const eMix = await errOf(() => createWarpingInvoiceDraft({ warpingOrderIds: [E, G], clientToken: randomUUID() }, U));
    check("A10 farklı ücret dövizli siparişler tek taslakta → 400 WARPING_FEE_CURRENCY_MIXED", eMix?.code === "WARPING_FEE_CURRENCY_MIXED", show(eMix));
    const tryInv = track(await invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "TRY", warpingReceiptKeys: [e1], lines: [{ description: "Devere", qty: 1, unit: "adet", unitPrice: 9000 }] }, U));
    const m10 = await warpingFeeMatch(tryInv);
    check("A10 USD ücretli kabul TRY faturaya bağlanır; kur çevrilmez → fark null, uyarı", m10?.currencyMismatch === true && m10.difference === null && m10.expectedTotal === null && m10.warnings.some((w) => /para birimi/.test(w)));
    const dF = await createWarpingInvoiceDraft({ warpingOrderIds: [F], clientToken: randomUUID() }, U);
    track(dF);
    const mF = await warpingFeeMatch(dF.data.id);
    check("A9 ücretsiz siparişten taslak: fiyatsız satır + uyarı; fark hesaplanmaz", (dF.warnings ?? []).some((w) => /ücreti yok/.test(w)) && mF?.missingPrice === true && mF.expectedTotal === null);
    const dG = await createWarpingInvoiceDraft({ warpingOrderIds: [G], clientToken: randomUUID() }, U);
    track(dG);
    check("TRY ücretli siparişin taslağı TRY doğar", (await prisma.invoice.findUniqueOrThrow({ where: { id: dG.data.id }, select: { currency: true } })).currency === "TRY");
    // A8b: tel×m fiyatı 8 ondalık (16,8) — kolonda kaybolmaz; fatura satırı (4 ondalık) götürü doğar, tutar kaymaz.
    const E8 = await newOrder({ feeUnit: "ENDS_METRE", feeUnitPrice: 0.00002345, feeCurrency: "USD" });
    await receive(E8, [1000], "DV-9");
    const sE8 = await getWarpingOrderFeeSummary(E8, { canReadInvoices: true });
    const dE8 = await createWarpingInvoiceDraft({ warpingOrderIds: [E8], clientToken: randomUUID() }, U);
    track(dE8);
    const lE8 = await prisma.invoiceLine.findMany({ where: { invoiceId: dE8.data.id }, select: { qty: true, unit: true, unitPrice: true, description: true } });
    check("A8b 8 ondalık tel×m fiyatı: 3 000 000 × 0,00002345 = 70,35; taslak götürü satır 1 × 70,35, ölçü açıklamada",
      sE8.fee.unitPrice === "0.00002345" && sE8.totals.expectedAmount === "70.35" && lE8.length === 1 && lE8[0]!.qty.toFixed(3) === "1.000" && lE8[0]!.unit === "götürü" && lE8[0]!.unitPrice.toFixed(2) === "70.35" && /3000000 tel×m × 0,00002345/.test(lE8[0]!.description ?? ""),
      JSON.stringify({ p: sE8.fee.unitPrice, t: sE8.totals.expectedAmount, l: lE8[0] }));

    // ── A13 taraf · ALIŞ dışı · PATCH REPLACE ─────────────────────────────
    const eParty = await errOf(() => invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "USD", warpingReceiptKeys: [s1], lines: [{ description: "x", qty: 1, unit: "adet", unitPrice: 1 }] }, U));
    const eParty2 = await errOf(() => createWarpingInvoiceDraft({ receiptKeys: [b1, s1], clientToken: randomUUID() }, U));
    check("A13 başka deverecinin kabulü → 400 WARPING_RECEIPT_PARTY_MISMATCH (bağlama ve taslak)", eParty?.code === "WARPING_RECEIPT_PARTY_MISMATCH" && eParty2?.code === "WARPING_RECEIPT_PARTY_MISMATCH", `${show(eParty)} | ${show(eParty2)}`);
    const eSales = await errOf(() => invoiceService.createDraft({ type: "SALES", customerId: cardId, currency: "USD", warpingReceiptKeys: [f1], lines: [{ description: "x", qty: 1, unit: "adet", unitPrice: 1 }] }, U));
    const eDead = await errOf(() => invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "USD", warpingReceiptKeys: [h1], lines: [{ description: "x", qty: 1, unit: "adet", unitPrice: 1 }] }, U));
    check("Satış faturasına bağ 400 · geri alınmış kabul 400 WARPING_RECEIPT_NOT_LINKABLE", eSales?.code === "WARPING_RECEIPT_NOT_LINKABLE" && eDead?.code === "WARPING_RECEIPT_NOT_LINKABLE", `${show(eSales)} | ${show(eDead)}`);
    const blank = track(await invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "USD", lines: [{ description: "x", qty: 1, unit: "adet", unitPrice: 1 }] }, U));
    await invoiceService.updateDraft(dG.data.id, { warpingReceiptKeys: [] }, U);
    await invoiceService.updateDraft(blank, { warpingReceiptKeys: [g1] }, U);
    const links = async (id: string) => (await prisma.invoiceToWarpingReceipt.findMany({ where: { invoiceId: id }, select: { warpingReceiptKey: true } })).map((l) => l.warpingReceiptKey);
    check("PATCH REPLACE: `[]` bağı kaldırır, kabul başka taslağa taşınır", (await links(dG.data.id)).length === 0 && (await links(blank)).join() === g1);
    const busyPatch = await errOf(() => invoiceService.updateDraft(blank, { warpingReceiptKeys: [a1] }, U));
    check("PATCH başka taslağa bağlı kabul → 409 WARPING_RECEIPT_ALREADY_INVOICED", busyPatch?.code === "WARPING_RECEIPT_ALREADY_INVOICED", show(busyPatch));

    // ── A16 yarış ────────────────────────────────────────────────────────
    const B2 = await newOrder({ feeUnit: "METRE", feeUnitPrice: 0.05, feeCurrency: "USD" });
    const b2 = await receive(B2, [800], "DV-9");
    const race = await Promise.allSettled([1, 2].map(() => createWarpingInvoiceDraft({ receiptKeys: [b2], clientToken: randomUUID() }, U)));
    for (const r of race) if (r.status === "fulfilled") invoiceIds.push(r.value.data.id);
    const rej = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    check("A16a iki eşzamanlı taslak aynı kabulü alamaz: biri başarılı, öteki 409 WARPING_RECEIPT_ALREADY_INVOICED",
      race.filter((r) => r.status === "fulfilled").length === 1 && rej.length === 1 && (rej[0]!.reason as { details?: { code?: string } }).details?.code === "WARPING_RECEIPT_ALREADY_INVOICED");
    const B3 = await newOrder({ feeUnit: "METRE", feeUnitPrice: 0.05, feeCurrency: "USD" });
    const b3 = await receive(B3, [700], "DV-10");
    const holderInv = track(await invoiceService.createDraft({ type: "PURCHASE", customerId: cardId, currency: "USD", lines: [{ description: "x", qty: 1, unit: "adet", unitPrice: 1 }] }, U));
    const cari = await prisma.invoice.findUniqueOrThrow({ where: { id: holderInv }, select: { cari: { select: { customerId: true, subcontractorId: true } } } });
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let inTx!: () => void;
    const entered = new Promise<void>((res) => { inTx = res; });
    const holder = prisma.$transaction(async (tx) => {
      await lockWarpingReceiptOrdersTx(tx, [b3]);
      const rows = await assertWarpingReceiptsLinkableTx(tx, { receiptKeys: [b3], invoiceId: holderInv, type: "PURCHASE", cari: cari.cari });
      await writeInvoiceWarpingReceiptsTx(tx, holderInv, rows);
      inTx();
      await gate;
    }, { timeout: 20_000 });
    await entered;
    const racing = errOf(() => cancelWarpingReceipt(B3, b3, `${TAG} yarış`, U));
    await new Promise((r) => setTimeout(r, 400));
    release();
    await holder;
    const eRace = await racing;
    check("A16b açık bağlama tx'i ↔ kabul stornosu: storno sipariş kilidinde bekler, faturayı TAZE görür → 409", eRace?.code === "WARPING_RECEIPT_INVOICED", show(eRace));

    // ── Ayar ─────────────────────────────────────────────────────────────
    const def = await readDevereReworkBillable();
    await setSetting(SETTING_KEYS.DEVERE_REWORK_BILLABLE, false);
    const off = await readDevereReworkBillable();
    check("`devere.reworkBillable` kayıt yokken true (kullanıcı kararı), false yazılınca false", def === true && off === false);
  } finally {
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
    const beamIds = (await prisma.warpBeam.findMany({ where: { warpingOrderId: { in: orderIds } }, select: { id: true } })).map((b) => b.id);
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
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...beamIds] } } });
    if (specId) await prisma.warpSpec.deleteMany({ where: { id: specId } });
    if (yarnId) await prisma.item.deleteMany({ where: { id: yarnId } });
    if (cardId) await prisma.customer.deleteMany({ where: { id: cardId } });
    if (rateId) await prisma.exchangeRate.deleteMany({ where: { id: rateId } });
    for (const key of SETTING_FOTO) {
      const f = foto.find((s) => s.key === key);
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
