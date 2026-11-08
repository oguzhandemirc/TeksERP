// =============================================================================
// FASON KABULÜNDEN ALIŞ FATURASI TASLAĞI (F6) — önizleme + yaratım TEK hesaptan
// =============================================================================
// Kalem = tarifenin hizmet kartı (`FinishingRate.serviceItemId`; yoksa açıklama satırı + uyarı). Fiyat = kabulün İE'si
// için tarife kodu (`resolveRateCodes`, maliyetle aynı öncelik) → kaynak SEVKİN fabrika gününde geçerli sürüm
// (`pickFinishingRateAtDispatch`). Miktar tarife tabanından: RAW_M = fasonun hesabından düşülen metre (kabul kalemi),
// FINISHED_M = makbuzdan doğan topların metresi (yoksa düşülen), KG = sevk kaleminin tartısı × kabul oranı.
// Makbuz birden çok sevke yayılırsa her sevk kendi tarihinin fiyatını alır; doğan metre düşülen paya göre bölünür.
// Bulunamayan tarife/tartı SESSİZ DÜŞMEZ: satır fiyatsız kalır ve `warnings` söyler. Yazım `invoiceService.createDraft`
// (kabul başına tek aktif fatura: `assertSourceFree` + kısmi unique). Vergi ön değeri fason bağlamıyla (F7 çift rol).
// =============================================================================
import { Currency, FinishingBasis, InvoiceLineType, InvoiceStatus, InvoiceType, Prisma, RollStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { ACTIVE_ORDER_LINK } from "./helpers/order-link.helper";
import { pickDispatchRateCode, pickFinishingRateAtDispatch } from "./helpers/dispatch-finishing-check.helper";
import { resolveRateCodes } from "./dispatch-finishing-check.service";
import { resolveInvoiceTaxDefaults, taxLineFields } from "./helpers/invoice-tax-defaults.helper";
import { deriveInvoiceDueDate, findCariAccountForCardTx } from "./helpers/finance.helper";
import { invoiceService } from "./invoice.service";
import type { SubcontractorPurchaseDraftLine, SubcontractorPurchaseDraftPreview } from "./subcontractor/types";
import { TERIM } from "../constants/terim";

const ZERO = new Prisma.Decimal(0);

const RECEIPT_SELECT = {
  id: true,
  receiptNo: true,
  manifestNo: true,
  workOrderId: true,
  stepId: true,
  receivedAt: true,
  cancelledAt: true,
  subcontractor: { select: { id: true, name: true, customerId: true } },
  workOrder: {
    select: {
      workOrderNumber: true,
      targetItemId: true,
      orderLinks: { where: ACTIVE_ORDER_LINK, select: { orderLine: { select: { itemId: true, recipe: { select: { finishingRateCode: true } } } } } },
    },
  },
  items: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      newRollId: true,
      receivedQty: true,
      newRoll: { select: { itemId: true, currentQty: true } },
      sourceDispatchItem: {
        select: { dispatchedQty: true, dispatchedWeight: true, dispatch: { select: { id: true, dispatchNo: true, dispatchedAt: true } } },
      },
    },
  },
  // İptal edilen doğan top üretilmemiş sayılır (fazla ödeme); `*_CONSUMED` top sonraki adımda tüketilmiş ama
  // fasonun ürettiği maldır — K18 kümesinin tamamı DIŞLANMAZ, ölçü `initialQty`den gelir.
  bornRolls: { where: { status: { not: RollStatus.CANCELLED } }, select: { initialQty: true, currentQty: true } },
} satisfies Prisma.SubcontractorReceiptSelect;

type ReceiptRow = Prisma.SubcontractorReceiptGetPayload<{ select: typeof RECEIPT_SELECT }>;

interface DispatchRef { id: string; dispatchNo: string; dispatchedAt: Date }

/** Kabul kalemi başına: düşülen metre + (KG için) oransal tartı + kaynak sevk. */
interface ItemShare {
  dispatch: DispatchRef | null;
  deductedM: Prisma.Decimal;
  kg: Prisma.Decimal | null;
}

interface Computed {
  preview: SubcontractorPurchaseDraftPreview;
  /** Yaratım girdisi (önizlemeyle aynı hesap). */
  draft: {
    customerId: string | null;
    currency: Currency;
    issueDate: Date;
    dueDate: Date | null;
    lines: Array<{ lineType: InvoiceLineType; serviceItemId: string | null; description: string; qty: string; unit: string; unitPrice: string; vatRate: number; withholdingRate?: number }>;
  };
}

/** Kaynak sevki olmayan eski kalemler: aynı adımda bu topu taşıyan en son iptalsiz sevk (tek sorgu). */
async function loadFallbackDispatches(r: ReceiptRow): Promise<Map<string, { dispatch: DispatchRef; dispatchedQty: Prisma.Decimal; dispatchedWeight: Prisma.Decimal | null }>> {
  const orphanRolls = r.items.filter((i) => !i.sourceDispatchItem).map((i) => i.newRollId);
  if (orphanRolls.length === 0 || !r.stepId) return new Map();
  const rows = await prisma.subcontractorDispatchItem.findMany({
    where: { rollId: { in: orphanRolls }, dispatch: { stepId: r.stepId, cancelledAt: null, dispatchedAt: { lte: r.receivedAt } } },
    select: { rollId: true, dispatchedQty: true, dispatchedWeight: true, dispatch: { select: { id: true, dispatchNo: true, dispatchedAt: true } } },
    orderBy: [{ dispatch: { dispatchedAt: "desc" } }, { id: "desc" }],
  });
  const out = new Map<string, { dispatch: DispatchRef; dispatchedQty: Prisma.Decimal; dispatchedWeight: Prisma.Decimal | null }>();
  for (const row of rows) if (row.rollId && !out.has(row.rollId)) out.set(row.rollId, row);
  return out;
}

/** Kalem payları: düşülen metre (NULL = 2026-08-19 öncesi "tamamı" → topun kendisi) + oransal kg. */
function shareOf(
  item: ReceiptRow["items"][number],
  src: { dispatch: DispatchRef; dispatchedQty: Prisma.Decimal; dispatchedWeight: Prisma.Decimal | null } | null,
): ItemShare {
  const deductedM = item.receivedQty ?? item.newRoll.currentQty;
  let kg: Prisma.Decimal | null = null;
  if (src?.dispatchedWeight) {
    kg = item.receivedQty === null || src.dispatchedQty.lte(0)
      ? src.dispatchedWeight
      : src.dispatchedWeight.times(Prisma.Decimal.min(item.receivedQty.div(src.dispatchedQty), 1));
  }
  return { dispatch: src?.dispatch ?? null, deductedM, kg };
}

type BoundReceipt = ReceiptRow & { workOrderId: string; workOrder: NonNullable<ReceiptRow["workOrder"]> };
type RateVersion = Prisma.FinishingRateGetPayload<{ select: typeof RATE_VERSION_SELECT }>;
type Line = SubcontractorPurchaseDraftLine & { lineType: InvoiceLineType };
interface DispatchGroup { dispatch: DispatchRef | null; deductedM: Prisma.Decimal; kg: Prisma.Decimal; unweighed: number }

const RATE_VERSION_SELECT = {
  id: true, code: true, name: true, createdAt: true, revokedAt: true, basis: true, currency: true, pricePerM: true, subcontractorId: true,
  serviceItemId: true, serviceItem: { select: { name: true } },
} satisfies Prisma.FinishingRateSelect;

/** Kabul + kapılar: yok 404, iptal 409, İE'siz (dokuma) 409. */
async function loadReceipt(receiptId: string): Promise<BoundReceipt> {
  const r = await prisma.subcontractorReceipt.findUnique({ where: { id: receiptId }, select: RECEIPT_SELECT });
  if (!r) throw AppError.notFound("Fason kabul bulunamadı.", { code: "SUBCONTRACTOR_RECEIPT_NOT_FOUND" });
  if (r.cancelledAt) {
    throw AppError.conflict(`${r.receiptNo} kabulü iptal edilmiş — faturası çıkarılamaz.`, { code: "SUBCONTRACTOR_RECEIPT_CANCELLED" });
  }
  if (!r.workOrderId || !r.workOrder) {
    throw AppError.conflict(`${r.receiptNo} bir ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} bağlı değil (dokuma fason kabulü) — bu yoldan faturalanmaz.`, {
      code: "SUBCONTRACTOR_RECEIPT_NOT_WORK_ORDER_BOUND",
    });
  }
  return r as BoundReceipt;
}

/** Tarife kodu: kabulün İE'si + kabul edilen topların ürünü (sevk okuyucusuyla aynı çözüm) → kodun tüm sürümleri. */
async function loadRateVersions(r: BoundReceipt, warnings: string[]): Promise<{ picked: string | null; versions: RateVersion[] }> {
  const codes = await resolveRateCodes({ items: r.items.map((i) => ({ roll: { itemId: i.newRoll.itemId } })), workOrder: r.workOrder });
  const picked = pickDispatchRateCode(codes);
  if (picked === "AMBIGUOUS") {
    warnings.push(`${TERIM.terbiyeIsEmri.cumleBasi.ilgi} satırları farklı terbiye tarifelerine işaret ediyor — fiyat önerilemedi, satırı elle fiyatlayın.`);
    return { picked: null, versions: [] };
  }
  if (!picked) {
    warnings.push("Bu iş için terbiye tarifesi tanımlı değil (maliyet yapısı / reçete) — fiyat önerilemedi.");
    return { picked: null, versions: [] };
  }
  return { picked, versions: await prisma.finishingRate.findMany({ where: { code: picked }, select: RATE_VERSION_SELECT }) };
}

/** Sevk başına grup (her sevk kendi gününün tarifesini alır) + makbuz toplamları. */
async function groupByDispatch(r: BoundReceipt, warnings: string[]): Promise<{ groups: DispatchGroup[]; deductedTotal: Prisma.Decimal; bornTotal: Prisma.Decimal }> {
  const fallback = await loadFallbackDispatches(r);
  const shares = r.items.map((i) =>
    shareOf(i, i.sourceDispatchItem ? { dispatch: i.sourceDispatchItem.dispatch, dispatchedQty: i.sourceDispatchItem.dispatchedQty, dispatchedWeight: i.sourceDispatchItem.dispatchedWeight } : fallback.get(i.newRollId) ?? null),
  );
  if (shares.some((s) => !s.dispatch)) warnings.push("Bazı kabul kalemlerinin kaynak sevki bulunamadı — fiyat kabul tarihindeki tarifeden alındı.");
  const groups = new Map<string, DispatchGroup>();
  for (const s of shares) {
    const key = s.dispatch?.id ?? "-";
    const g = groups.get(key) ?? { dispatch: s.dispatch, deductedM: ZERO, kg: ZERO, unweighed: 0 };
    g.deductedM = g.deductedM.plus(s.deductedM);
    if (s.kg) g.kg = g.kg.plus(s.kg);
    else g.unweighed += 1;
    groups.set(key, g);
  }
  return {
    groups: [...groups.values()],
    deductedTotal: shares.reduce((a, s) => a.plus(s.deductedM), ZERO),
    bornTotal: r.bornRolls.reduce((a, b) => a.plus(b.initialQty.gt(0) ? b.initialQty : b.currentQty), ZERO),
  };
}

/** Grubun tarifesi: sevk gününün sürümü; başka firmanın / farklı para birimli sürüm fiyatsız (uyarılı). */
function pickGroupRate(
  ctx: { r: BoundReceipt; picked: string | null; versions: RateVersion[]; currency: Currency | null; warn: (key: string, msg: string) => void },
  g: DispatchGroup,
): RateVersion | null {
  const at = pickFinishingRateAtDispatch(ctx.versions, g.dispatch?.dispatchedAt ?? ctx.r.receivedAt);
  if (ctx.picked && !at) ctx.warn(`nover:${g.dispatch?.id ?? "-"}`, `"${ctx.picked}" tarifesinin ${g.dispatch?.dispatchNo ?? ctx.r.receiptNo} tarihinde geçerli sürümü yok — fiyat önerilmedi.`);
  const rate = at?.rate ?? null;
  if (rate?.subcontractorId && rate.subcontractorId !== ctx.r.subcontractor.id) {
    ctx.warn("other", `"${rate.code}" tarifesi başka bir fason firmaya ait — fiyat önerilmedi.`);
    return null;
  }
  if (rate && ctx.currency && rate.currency !== ctx.currency) {
    ctx.warn("currency", "Kabulün sevkleri farklı para birimli tarife sürümlerine düşüyor — farklı para birimli satır fiyatsız bırakıldı.");
    return null;
  }
  if (rate && !rate.serviceItemId) ctx.warn("bridge", `"${rate.code}" tarifesine hizmet kartı bağlanmamış — satır açıklama satırı olarak geldi; tarifeye hizmet kartı bağlayın.`);
  return rate;
}

/** Satırlar: tarife tabanından miktar; aynı sürüm + taban tek satırda birleşir. */
function priceLines(
  r: BoundReceipt,
  rates: { picked: string | null; versions: RateVersion[] },
  grouped: { groups: DispatchGroup[]; deductedTotal: Prisma.Decimal; bornTotal: Prisma.Decimal },
  { tax, warnings }: { tax: { vatRate: number; withholdingRate: number }; warnings: string[] },
): { lines: Line[]; currency: Currency } {
  const warned = new Set<string>();
  const warn = (key: string, msg: string) => {
    if (!warned.has(key)) warnings.push(msg);
    warned.add(key);
  };
  const merged = new Map<string, Line>();
  let currency: Currency | null = null;
  let unweighed = 0;
  for (const g of grouped.groups) {
    const rate = pickGroupRate({ r, ...rates, currency, warn }, g);
    if (rate) currency ??= rate.currency;
    const basis: FinishingBasis = rate?.basis ?? FinishingBasis.RAW_M;
    if (basis === FinishingBasis.KG) unweighed += g.unweighed;
    const qty = basis === FinishingBasis.KG ? g.kg
      : basis === FinishingBasis.FINISHED_M && grouped.bornTotal.gt(0) && grouped.deductedTotal.gt(0) ? grouped.bornTotal.times(g.deductedM).div(grouped.deductedTotal)
      : g.deductedM;
    const key = `${rate?.id ?? "-"}:${basis}`;
    const prev = merged.get(key);
    if (prev) {
      prev.qty = new Prisma.Decimal(prev.qty).plus(qty).toFixed(3);
      if (g.dispatch && !prev.description.includes(g.dispatch.dispatchNo)) prev.description = `${prev.description}, ${g.dispatch.dispatchNo}`;
      continue;
    }
    const serviceItemId = rate?.serviceItemId ?? null;
    merged.set(key, {
      lineType: serviceItemId ? InvoiceLineType.SERVICE : InvoiceLineType.TEXT,
      serviceItemId,
      description: `${rate ? (rate.serviceItem?.name ?? rate.name) : "Fason işçilik"} — ${r.receiptNo}${g.dispatch ? ` / ${g.dispatch.dispatchNo}` : ""}`,
      qty: qty.toFixed(3),
      unit: basis === FinishingBasis.KG ? "KG" : "METER",
      unitPrice: (rate ? rate.pricePerM : ZERO).toFixed(4),
      currency: Currency.TRY,
      finishingRateId: rate?.id ?? null,
      vatRate: tax.vatRate,
      withholdingRate: tax.withholdingRate,
    });
  }
  if (unweighed > 0) warnings.push(`${unweighed} kabul kaleminin sevk tartısı yok — kilo miktarına katılmadı; satırı kontrol edin.`);
  const lines = [...merged.values()];
  const finalCurrency = currency ?? Currency.TRY;
  for (const l of lines) l.currency = finalCurrency;
  return { lines, currency: finalCurrency };
}

async function compute(receiptId: string): Promise<Computed> {
  const r = await loadReceipt(receiptId);
  const warnings: string[] = [];
  const customerId = r.subcontractor.customerId;
  if (!customerId) warnings.push(`"${r.subcontractor.name}" fason profili bir cari karta bağlı değil — taslak yaratılamaz; önce fason firmayı kartına bağlayın.`);
  const existing = await prisma.invoice.findFirst({
    where: { subcontractorReceiptId: r.id, status: { not: InvoiceStatus.CANCELLED } },
    select: { id: true, docNo: true, status: true },
  });
  if (existing) warnings.push(`Bu kabulün zaten aktif faturası var: ${existing.docNo}.`);
  const rates = await loadRateVersions(r, warnings);
  const grouped = await groupByDispatch(r, warnings);
  // Vergi ön değeri fason KABULÜ bağlamıyla (F7 çift rollü kart) + İE malzeme bağlamı (F7b).
  const tax = await resolveInvoiceTaxDefaults({ type: InvoiceType.PURCHASE, customerId, workOrderId: r.workOrderId, purchaseContext: "SUBCONTRACT" });
  const taxFields = taxLineFields(tax);
  const { lines, currency: finalCurrency } = priceLines(r, rates, grouped, { tax, warnings });
  const subtotal = lines.reduce((a, l) => a.plus(new Prisma.Decimal(l.qty).times(l.unitPrice)), ZERO);

  const cari = customerId ? await findCariAccountForCardTx(prisma, { customerId, subcontractorId: null }, { paymentTermDays: true }) : null;
  return {
    preview: {
      receiptId: r.id,
      receiptNo: r.receiptNo,
      subcontractor: { id: r.subcontractor.id, name: r.subcontractor.name },
      supplierCustomerId: customerId,
      currency: finalCurrency,
      lines: lines.map(({ lineType: _t, ...l }) => l),
      subtotal: subtotal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      existingInvoice: existing ? { id: existing.id, docNo: existing.docNo, status: existing.status } : null,
      warnings,
    },
    draft: {
      customerId,
      currency: finalCurrency,
      issueDate: r.receivedAt,
      dueDate: deriveInvoiceDueDate(r.receivedAt, cari?.paymentTermDays),
      lines: lines.map((l) => ({
        lineType: l.lineType,
        serviceItemId: l.serviceItemId,
        description: l.description,
        qty: l.qty,
        unit: l.unit === "KG" ? "kg" : "m",
        unitPrice: l.unitPrice,
        ...taxFields,
      })),
    },
  };
}

/** Önizleme (yazmaz): taraf bağsızsa ya da aktif fatura varsa da döner — durum `supplierCustomerId`/`existingInvoice`te. */
export async function previewSubcontractorPurchaseDraft(receiptId: string): Promise<SubcontractorPurchaseDraftPreview> {
  return (await compute(receiptId)).preview;
}

/** Taslak yaratır (201). Replay `clientToken` ile `createDraft`in tek boğazından. */
export async function createSubcontractorPurchaseDraft(
  receiptId: string,
  opts: { clientToken?: string | null },
  userId?: string,
): Promise<ApiResponse<{ id: string; docNo: string }>> {
  const { preview, draft } = await compute(receiptId);
  if (!draft.customerId) {
    throw AppError.conflict(`"${preview.subcontractor.name}" fason profili bir cari karta bağlı değil — önce fason firmayı kartına bağlayın.`, {
      code: "SUBCONTRACTOR_NOT_LINKED_TO_CARD",
    });
  }
  if (preview.existingInvoice && !opts.clientToken) {
    throw AppError.conflict(`Bu fason kabul için zaten bir fatura var: ${preview.existingInvoice.docNo}. Yeni fatura için önce onu iptal edin.`, {
      code: "SUBCONTRACTOR_RECEIPT_ALREADY_INVOICED",
    });
  }
  if (draft.lines.length === 0) throw AppError.badRequest("Kabulde faturalanacak kalem yok.");
  const created = await invoiceService.createDraft(
    {
      type: InvoiceType.PURCHASE,
      customerId: draft.customerId,
      currency: draft.currency,
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      notes: `${preview.receiptNo} fason kabulünden üretildi.`,
      subcontractorReceiptId: receiptId,
      clientToken: opts.clientToken ?? null,
      lines: draft.lines,
    },
    userId,
  );
  return preview.warnings.length > 0 ? { ...created, warnings: [...(created.warnings ?? []), ...preview.warnings] } : created;
}
