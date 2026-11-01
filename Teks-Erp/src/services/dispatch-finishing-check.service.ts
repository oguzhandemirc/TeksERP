// =============================================================================
// FASON SEVK KG KONTROLÜ — okuyucu (SY-E2, tasarım §6.5)
// =============================================================================
// Sevkin ürününü/varyantını, SEVK TARİHİNDEKİ terbiye tarifesini (`pickFinishingRateAtDispatch`), topların sevk kg'ını ve bu sevkin
// toplarını kabul eden fason kabul(ler)ine bağlı ALIŞ faturalarını okur; hesap saf helper'da.
// YALNIZ OKUMA: yazım, audit, kilit yok. Tarife çözümü `resolveFinishingRateCode` (maliyetle aynı öncelik).
// Fatura okuması FİNANS kapılıdır: yalnız `finance:read` izni (route) ∧ ön muhasebe açık (`readFinanceEnabled`);
// aksi hâlde fatura sorgusu ATILMAZ, `invoice` null döner (cost:read tek başına fatura bilgisi vermez).
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { readFinanceEnabled } from "./system-setting.service";
import { ACTIVE_ORDER_LINK } from "./helpers/order-link.helper";
import { resolveFinishingRateCode } from "./helpers/finishing-rate-code.helper";
import {
  computeDispatchFinishingCheck,
  pickDispatchRateCode,
  pickFinishingRateAtDispatch,
  type FinishingCheckInvoice,
  type FinishingCheckResult,
} from "./helpers/dispatch-finishing-check.helper";

export interface DispatchFinishingCheckOptions {
  /** Çağıranın `finance:read` izni var mı — route `matchesPermission` ile hesaplar. */
  canReadInvoices: boolean;
}

export async function getDispatchFinishingCheck(dispatchId: string, opts: DispatchFinishingCheckOptions): Promise<FinishingCheckResult> {
  const d = await prisma.subcontractorDispatch.findUnique({
    where: { id: dispatchId },
    select: {
      id: true,
      subcontractorId: true,
      cancelledAt: true,
      dispatchedAt: true,
      items: { where: { kind: "ROLL" }, select: { id: true, dispatchedWeight: true, roll: { select: { itemId: true } } } },
      workOrder: {
        select: {
          targetItemId: true,
          orderLinks: { where: ACTIVE_ORDER_LINK, select: { orderLine: { select: { itemId: true, recipe: { select: { finishingRateCode: true } } } } } },
        },
      },
    },
  });
  if (!d) throw AppError.notFound("Fason sevk bulunamadı.", { code: "DISPATCH_NOT_FOUND" });
  if (d.cancelledAt) return { line: null, reason: "DISPATCH_CANCELLED" };

  const rateCodes = await resolveRateCodes(d);
  const picked = pickDispatchRateCode(rateCodes);
  // Kodun TÜM sürümleri (damgalılar dahil); hangisinin geçerli olduğunu tek yardımcı seçer.
  const versions = picked && picked !== "AMBIGUOUS"
    ? await prisma.finishingRate.findMany({
        where: { code: picked },
        select: { id: true, createdAt: true, revokedAt: true, code: true, name: true, basis: true, currency: true, pricePerM: true, subcontractorId: true },
      })
    : [];
  const atDispatch = pickFinishingRateAtDispatch(versions, d.dispatchedAt);
  const rate = atDispatch?.rate ?? null;
  const invoicesAllowed = rate?.basis === "KG" && opts.canReadInvoices && (await readFinanceEnabled());
  const { invoices, coversOther, coversWhole } = invoicesAllowed
    ? await readInvoices(d.id, d.items.map((i) => i.id))
    : { invoices: [], coversOther: false, coversWhole: false };

  return computeDispatchFinishingCheck({
    subcontractorId: d.subcontractorId,
    fabricWeights: d.items.map((i) => i.dispatchedWeight),
    rateCodes,
    rate,
    rateAsOf: atDispatch?.asOf ?? null,
    invoices,
    invoicesCoverOtherDispatches: coversOther,
    invoicesCoverWholeDispatch: coversWhole,
  });
}

interface DispatchRow {
  items: { roll: { itemId: string } | null }[];
  workOrder: { targetItemId: string | null; orderLinks: { orderLine: { itemId: string; recipe: { finishingRateCode: string | null } | null } }[] } | null;
}

/** Sipariş satırı başına (varyant > ürün yapısı) kod; satır yoksa iş emri hedef ürünü, o da yoksa topların ürünü. */
async function resolveRateCodes(d: DispatchRow): Promise<(string | null)[]> {
  const links = d.workOrder?.orderLinks ?? [];
  const fallbackItems = d.workOrder?.targetItemId
    ? [d.workOrder.targetItemId]
    : [...new Set(d.items.map((i) => i.roll?.itemId).filter((x): x is string => !!x))];
  const itemIds = links.length ? [...new Set(links.map((l) => l.orderLine.itemId))] : fallbackItems;
  if (itemIds.length === 0) return [];
  const structures = await prisma.costStructure.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, finishingRateCode: true } });
  const byItem = new Map(structures.map((s) => [s.itemId, s.finishingRateCode]));
  if (links.length) return links.map((l) => resolveFinishingRateCode(l.orderLine.recipe?.finishingRateCode, byItem.get(l.orderLine.itemId)));
  return itemIds.map((id) => resolveFinishingRateCode(null, byItem.get(id)));
}

interface InvoiceRead { invoices: FinishingCheckInvoice[]; coversOther: boolean; coversWhole: boolean }

/** Bu sevkin toplarını kabul eden fason kabullerine bağlı, iptal edilmemiş ALIŞ faturaları. */
async function readInvoices(dispatchId: string, itemIds: string[]): Promise<InvoiceRead> {
  if (itemIds.length === 0) return { invoices: [], coversOther: false, coversWhole: false };
  const rows = await prisma.invoice.findMany({
    where: {
      type: "PURCHASE",
      status: { in: ["DRAFT", "CONFIRMED"] },
      subcontractorReceipt: { items: { some: { sourceDispatchItemId: { in: itemIds } } } },
    },
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
    select: {
      docNo: true, status: true, currency: true, subtotal: true, discountTotal: true,
      subcontractorReceipt: { select: { items: { select: { sourceDispatchItemId: true, sourceDispatchItem: { select: { dispatchId: true } } } } } },
    },
  });
  const receiptItems = rows.flatMap((r) => r.subcontractorReceipt?.items ?? []);
  const coversOther = receiptItems.some((it) => it.sourceDispatchItem?.dispatchId !== dispatchId);
  // Kısmi kabul: faturalı kabuller sevkin her kumaş kalemini kapsamıyorsa fark tüm sevkle kıyaslanamaz.
  const covered = new Set(receiptItems.map((it) => it.sourceDispatchItemId));
  const coversWhole = itemIds.every((id) => covered.has(id));
  return {
    invoices: rows.map((r) => ({ docNo: r.docNo, status: r.status === "DRAFT" ? "DRAFT" : "CONFIRMED", currency: r.currency, net: r.subtotal.minus(r.discountTotal) })),
    coversOther,
    coversWhole,
  };
}
