// =============================================================================
// HİZMET FATURASI BAĞI — tek yazar (Gülkesim dalga 2 · H7, karar belgesi §5, §12-7)
// =============================================================================
// Soru: "bu sevkte müşterinin kumaşına yaptığımız hangi iş henüz faturalanmadı?"
// Sevk edilen topların ATA zinciri yürünür (iş, işin uygulandığı topa bağlanır),
// aktif bağı olan iş düşer, kalan `resolveServiceItemsForRolls` (H6) ile hizmet
// kalemi × birim fiyata çözülür. Bağ (`ServiceBillingLink`) fatura tx'inde yazılır:
// okumalar FOR UPDATE ORDER BY id → fatura insert → bağ insert (okuma aktifse).
// Ters yol: DRAFT silme → Cascade; iptal → AYNI tx'te damga (iş yeniden faturalanır).
// İade bağı ÇÖZMEZ (storno ≠ iade).
// =============================================================================
import { Currency, Prisma, ServiceMeterBasis } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { alreadyBilled, findActiveBillingTx } from "./service-billing-gate.helper";
import { resolveServiceItemsForRolls, serviceWorkKey } from "./service-pricing.helper";
import { SACK_ABSENT_STATUSES } from "./sack-invariants.helper";
import type { loadServiceBillingSettings } from "../system-setting.service";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
export type ServiceBillingSettings = Awaited<ReturnType<typeof loadServiceBillingSettings>>;

/** Fatura tx'ine taşınan bağ girdisi (birim fiyat bağ anında donar). */
export interface ServiceBillingLinkInput {
  rollId: string;
  workOrderStepId: string | null;
  serviceItemId: string;
  readingId: string | null;
  billedMeters: Prisma.Decimal;
  meterBasis: ServiceMeterBasis;
  unitPrice: Prisma.Decimal;
  currency: Currency;
  serviceAt: Date;
}

export interface ServiceBillingDraft {
  lines: Array<{ itemId: string; description: string; qty: Prisma.Decimal; unit: string; unitPrice: Prisma.Decimal }>;
  links: ServiceBillingLinkInput[];
  warnings: string[];
}

/** Ata zinciri (kendisi dahil) — Tambur bölmesi `parentRollId` ile; derinlik tavanı döngüye karşı sigorta. */
export async function collectRollLineage(rollIds: string[], db: Db = prisma): Promise<string[]> {
  const seen = new Set(rollIds);
  let frontier = [...seen];
  for (let depth = 0; depth < 32 && frontier.length > 0; depth++) {
    const rows = await db.roll.findMany({ where: { id: { in: frontier }, parentRollId: { not: null } }, select: { parentRollId: true } });
    frontier = rows.map((r) => r.parentRollId!).filter((id) => !seen.has(id));
    for (const id of frontier) seen.add(id);
  }
  return [...seen];
}

/** Toplara (ve atalarına) bağlı AKTİF bağ anahtarları. */
async function loadBilledKeys(rollIds: string[]): Promise<Set<string>> {
  const rows = rollIds.length === 0 ? [] : await prisma.serviceBillingLink.findMany({
    where: { rollId: { in: rollIds }, revokedAt: null },
    select: { rollId: true, serviceItemId: true, workOrderStepId: true },
  });
  return new Set(rows.map(serviceWorkKey));
}

/**
 * Sevk edilen (emanet) toplara yapılan, henüz faturalanmamış işler → taslak satırları + bağ girdileri.
 * Yazmaz. Kalem çözülemeyen / fiyatsız iş `warnings`te görünür; fiyatsız satır 0 ile gelir (onay seddi durdurur).
 */
export async function collectServiceBillingDraft(params: {
  rollIds: string[];
  customerId: string;
  currency: Currency;
  settings: ServiceBillingSettings;
  dispatchedAt: Date | null;
}): Promise<ServiceBillingDraft> {
  if (params.rollIds.length === 0) return { lines: [], links: [], warnings: [] };
  const lineage = await collectRollLineage(params.rollIds);
  const res = await resolveServiceItemsForRolls({
    rollIds: lineage,
    customerId: params.customerId,
    currency: params.currency,
    options: {
      meterBasis: params.settings.meterBasis,
      missingMeter: params.settings.missingMeter,
      priceAsOf: params.settings.priceDate === "DISPATCH_DAY" ? params.dispatchedAt ?? new Date() : undefined,
      billedKeys: await loadBilledKeys(lineage),
    },
  });
  const lines = res.lines.map((l) => ({
    itemId: l.serviceItemId,
    description: `${l.name} (${l.rollCount} top)`,
    qty: new Prisma.Decimal(l.quantity),
    unit: "m",
    unitPrice: new Prisma.Decimal(l.unitPrice ?? 0),
  }));
  const links: ServiceBillingLinkInput[] = res.works
    .filter((w) => w.serviceItemId !== null)
    .map((w) => ({
      rollId: w.rollId,
      workOrderStepId: w.workOrderStepId,
      serviceItemId: w.serviceItemId!,
      readingId: w.readingId,
      billedMeters: new Prisma.Decimal(w.meters).toDecimalPlaces(3),
      meterBasis: w.meterBasis as ServiceMeterBasis,
      unitPrice: new Prisma.Decimal(w.unitPrice ?? 0),
      currency: params.currency,
      serviceAt: w.serviceAt,
    }));
  return { lines, links, warnings: res.warnings };
}

/** Kilit sırası ①: bağın dayandığı okumalar — `createDraftFromGoodsReceipts` emsali (kilit → insert → pivot). */
export async function lockServiceReadingsTx(tx: Tx, links: ServiceBillingLinkInput[]): Promise<void> {
  const ids = [...new Set(links.map((l) => l.readingId).filter((v): v is string => v !== null))].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM roll_meter_readings WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

/** Kilit sırası ③: bağ insert'i (okuma hâlâ aktif olmalı; aynı iş iki faturaya giremez → 409). */
export async function insertServiceLinksTx(tx: Tx, invoiceId: string, links: ServiceBillingLinkInput[]): Promise<number> {
  if (links.length === 0) return 0;
  const readingIds = [...new Set(links.map((l) => l.readingId).filter((v): v is string => v !== null))];
  if (readingIds.length > 0) {
    const live = await tx.rollMeterReading.count({ where: { id: { in: readingIds }, revokedAt: null } });
    if (live !== readingIds.length) {
      throw AppError.conflict("Metre okuması taslak hazırlanırken düzeltildi — taslağı yeniden oluşturun", { code: "SERVICE_READING_CHANGED" });
    }
  }
  for (const l of links) {
    const prior = await findActiveBillingTx(tx, { rollId: l.rollId, serviceItemId: l.serviceItemId, workOrderStepId: l.workOrderStepId });
    if (prior) throw alreadyBilled(prior.docNo);
  }
  try {
    const res = await tx.serviceBillingLink.createMany({ data: links.map((l) => ({ ...l, invoiceId })) });
    return res.count;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw alreadyBilled(null);
    throw e;
  }
}

/** Ters yol: fatura iptalinde AYNI tx'te damga — iş yeniden faturalanabilir. Dönen: damgalanan bağ sayısı. */
export async function revokeServiceLinksTx(tx: Tx, invoiceId: string, userId: string | null, reason: string): Promise<number> {
  const res = await tx.serviceBillingLink.updateMany({
    where: { invoiceId, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: userId, revokeReason: reason.slice(0, 300) },
  });
  return res.count;
}

/**
 * Sevkiyatın EMANET topları (canlı + iade edilmiş, BRÜT) → hizmet taslağı. Müşterinin kendi malı satılmaz;
 * ona yapılan iş faturalanır. Bizim malımızdaki iş ürün fiyatının içindedir (ikinci kez kesilmez).
 */
export async function collectShipmentServiceBilling(params: {
  shipmentId: string;
  customerId: string;
  currency: Currency;
  settings: ServiceBillingSettings;
  dispatchedAt: Date | null;
}): Promise<ServiceBillingDraft> {
  const live = await prisma.roll.findMany({ where: { shipmentId: params.shipmentId, ownerCustomerId: { not: null }, status: { notIn: SACK_ABSENT_STATUSES } }, select: { id: true } });
  const returned = await prisma.rollReturn.findMany({
    where: { fromShipmentId: params.shipmentId, cancelledAt: null, roll: { ownerCustomerId: { not: null } } },
    select: { rollId: true },
  });
  const rollIds = [...new Set([...live.map((r) => r.id), ...returned.map((r) => r.rollId)])];
  return collectServiceBillingDraft({ ...params, rollIds });
}
