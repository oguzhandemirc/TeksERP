// =============================================================================
// HİZMET FATURASI ÖNİZLEME KAPISI — F1 (Gülkesim dalga 3a)
// =============================================================================
// Soru: "önizlemeden bu yana tetik ya da işlerin bağ durumu değişti mi?" Panel sevk taslağı istek gövdesinde bağ
// taşımaz; bağlar fatura tx'inde sevk kilidi altında yeniden çözülür. Sevkin emanet işine ait hizmet satırı taze
// bağlarla örtüşmüyorsa 409 — emanet işine BAĞSIZ hizmet satırı hiçbir yoldan yazılmaz (çift fatura seddi).
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { collectRollLineage, listShipmentServiceRollIds } from "./service-billing-gate.helper";
import {
  collectShipmentServiceBilling,
  reconcileServiceLinksWithLines,
  resolveCustomerServiceBillingTrigger,
  syncServiceLinksToLinesTx,
  type ServiceBillingLinkInput,
  type ServiceBillingSettings,
} from "./service-billing.helper";
import { loadServiceBillingSettings } from "../system-setting.service";
import { linkBilledQty } from "./service-quantity.helper";

type Tx = Prisma.TransactionClient;

export function servicePreviewStale(reason: string, serviceItemId: string): AppError {
  return AppError.conflict(`Önizleme eskidi — yeniden önizleyin (${reason}).`, { code: "SERVICE_PREVIEW_STALE", serviceItemId });
}

/** Sevkin emanet işlerinin taze durumu: faturalanmamış bağ girdileri + işlerin (faturalı dahil) hizmet kalemleri. */
async function loadShipmentServiceWorkState(tx: Tx, p: { shipmentId: string; customerId: string; currency: Currency; settings: ServiceBillingSettings }) {
  const sh = await tx.shipment.findUnique({ where: { id: p.shipmentId }, select: { dispatchedAt: true } });
  // Toplayıcı fatura tx'inin KENDİ istemcisiyle okur (K3b): çağıran 8023 sevk kilidini tutar; tx dışı okuma havuzda
  // ikinci bağlantı bekler ve tx'in kendi yazımını görmezdi.
  const draft = await collectShipmentServiceBilling({ shipmentId: p.shipmentId, customerId: p.customerId, currency: p.currency, settings: p.settings, dispatchedAt: sh?.dispatchedAt ?? null, db: tx });
  const rollIds = await listShipmentServiceRollIds([p.shipmentId], tx);
  const billed = rollIds.length === 0 ? [] : await tx.serviceBillingLink.findMany({
    where: { rollId: { in: await collectRollLineage(rollIds, tx) }, revokedAt: null },
    select: { serviceItemId: true, invoiceId: true },
  });
  const itemIds = new Set([...draft.links.map((l) => l.serviceItemId), ...billed.map((b) => b.serviceItemId)]);
  return { links: draft.links, billed, itemIds };
}

function sumLineQty(lines: Array<{ itemId?: string | null; qty: Prisma.Decimal.Value }>, itemId: string): Prisma.Decimal {
  return lines.filter((l) => l.itemId === itemId).reduce((a, l) => a.plus(new Prisma.Decimal(l.qty)), new Prisma.Decimal(0));
}

/**
 * F1 TEK KAPI (panel "Sevkiyattan Fatura Taslağı"): bağlar fatura tx'inde, sevk kilidi ALTINDA etkin tetik + aktif bağ
 * durumuyla YENİDEN çözülür. Sevkin emanet işine ait hizmet kalemli satır taze bağlarla örtüşmüyorsa (tetik dönem sonuna
 * döndü · iş başka faturaya bağlandı) 409 SERVICE_PREVIEW_STALE — emanet işine bağsız hizmet satırı yazılmaz.
 */
export async function resolveShipmentServiceLinksTx(
  tx: Tx,
  p: { shipmentId: string; customerId: string; currency: Currency; lines: Array<{ itemId?: string | null; qty: Prisma.Decimal.Value; description?: string }> },
): Promise<ServiceBillingLinkInput[]> {
  const settings = await loadServiceBillingSettings(tx);
  if (!settings.enabled) return [];
  const { trigger } = await resolveCustomerServiceBillingTrigger(p.customerId, settings, tx);
  const state = await loadShipmentServiceWorkState(tx, { ...p, settings });
  const fresh = trigger === "PERIOD_END" ? [] : state.links;
  for (const itemId of new Set(p.lines.map((l) => l.itemId).filter((v): v is string => !!v && state.itemIds.has(v)))) {
    if (trigger === "PERIOD_END") throw servicePreviewStale("bu müşterinin hizmet işleri artık dönem sonu faturasında kesiliyor", itemId);
    const own = fresh.filter((l) => l.serviceItemId === itemId);
    if (own.length === 0) throw servicePreviewStale("işler başka bir faturaya bağlandı", itemId);
    const sum = own.reduce((a, l) => a.plus(linkBilledQty(l)), new Prisma.Decimal(0));
    const drift = sumLineQty(p.lines, itemId).minus(sum).abs().gt(new Prisma.Decimal(0.001).mul(own.length));
    if (drift && state.billed.some((b) => b.serviceItemId === itemId)) throw servicePreviewStale("işlerin bir kısmı önizlemeden sonra değişti ya da başka bir faturaya bağlandı", itemId);
  }
  return reconcileServiceLinksWithLines(p.lines, fresh).keep;
}

/**
 * F1 düzenleme kapısı: sevk taslağına, BU faturada aktif bağı olmayan bir emanet işinin hizmet kalemiyle satır
 * eklenemez (bağ yalnız oluşturmada kurulur; bağsız satır dönem/başka sevk faturasıyla çift kesilirdi) → 409.
 */
export async function assertNoUnlinkedShipmentServiceLinesTx(
  tx: Tx,
  p: { invoiceId: string; shipmentId: string; customerId: string; currency: Currency; lines: Array<{ itemId?: string | null; qty: Prisma.Decimal.Value }> },
): Promise<void> {
  const settings = await loadServiceBillingSettings(tx);
  if (!settings.enabled) return;
  const lineItems = new Set(p.lines.map((l) => l.itemId).filter((v): v is string => !!v));
  if (lineItems.size === 0) return;
  const state = await loadShipmentServiceWorkState(tx, { ...p, settings });
  for (const itemId of lineItems) {
    if (!state.itemIds.has(itemId)) continue;
    if (state.billed.some((b) => b.serviceItemId === itemId && b.invoiceId === p.invoiceId)) continue;
    throw AppError.conflict(
      "Bu hizmet satırı taslağa bağlı iş taşımıyor — çift fatura olmasın diye eklenemez. Taslağı silip sevkiyattan yeniden oluşturun.",
      { code: "SERVICE_LINE_UNLINKED", serviceItemId: itemId },
    );
  }
}

/**
 * K3b dönem taslağı düzenleme kapısı: dönem taslağına (shipmentId yok, hizmet bağı kurulmuş) BU faturada aktif bağı
 * olmayan eşlenmiş hizmet kalemiyle (özellik/değer → hizmet kalemi) satır eklenemez → 409. Bağ yalnız dönem ucunda kurulur.
 */
export async function assertNoUnlinkedPeriodServiceLinesTx(
  tx: Tx,
  p: { invoiceId: string; lines: Array<{ itemId?: string | null }> },
): Promise<void> {
  const lineItems = [...new Set(p.lines.map((l) => l.itemId).filter((v): v is string => !!v))];
  if (lineItems.length === 0) return;
  // Dönem taslağı = bağ kurulmuş (damgalı dahil) sevksiz satış taslağı; elle açılmış serbest fatura bu kapıya girmez.
  if ((await tx.serviceBillingLink.count({ where: { invoiceId: p.invoiceId } })) === 0) return;
  const linked = new Set((await tx.serviceBillingLink.findMany({
    where: { invoiceId: p.invoiceId, revokedAt: null, serviceItemId: { in: lineItems } }, select: { serviceItemId: true }, distinct: ["serviceItemId"],
  })).map((l) => l.serviceItemId));
  const rest = lineItems.filter((id) => !linked.has(id));
  if (rest.length === 0) return;
  const mapped = new Set([
    ...(await tx.fabricProperty.findMany({ where: { serviceItemId: { in: rest } }, select: { serviceItemId: true } })).map((r) => r.serviceItemId),
    ...(await tx.fabricPropertyValue.findMany({ where: { serviceItemId: { in: rest } }, select: { serviceItemId: true } })).map((r) => r.serviceItemId),
  ]);
  const hit = rest.find((id) => mapped.has(id));
  if (!hit) return;
  throw AppError.conflict(
    "Dönem faturasına emanet hizmet satırı elle eklenemez — işler bu taslağa bağlı değil. Dönem sonu hizmet faturası ucunu yeniden çalıştırın.",
    { code: "SERVICE_LINE_UNLINKED", serviceItemId: hit },
  );
}

/** Taslak düzenlemesinin hizmet ayağı: bağ ↔ satır eşitlemesi (H7) + sevk (F1) / dönem (K3b) taslağında bağsız emanet satırı kapısı. */
export async function syncDraftServiceLinksTx(
  tx: Tx,
  p: { invoiceId: string; type: string; shipmentId: string | null; currency: Currency; cari: { customerId: string | null }; lines: Array<{ itemId?: string | null; qty: Prisma.Decimal.Value; description?: string }>; userId: string | null },
): Promise<number> {
  const revoked = await syncServiceLinksToLinesTx(tx, p.invoiceId, p.lines, p.userId);
  if (p.type === "SALES" && p.shipmentId && p.cari.customerId) {
    await assertNoUnlinkedShipmentServiceLinesTx(tx, { invoiceId: p.invoiceId, shipmentId: p.shipmentId, customerId: p.cari.customerId, currency: p.currency, lines: p.lines });
  } else if (p.type === "SALES" && !p.shipmentId) {
    await assertNoUnlinkedPeriodServiceLinesTx(tx, { invoiceId: p.invoiceId, lines: p.lines });
  }
  return revoked;
}
