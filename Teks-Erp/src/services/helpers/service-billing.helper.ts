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
import { Currency, Prisma, ServiceMeterBasis, ShipmentStatus } from "@prisma/client";
import { lockShipmentScopeTx } from "./shipment-locks.helper";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { alreadyBilled, collectRollLineage, findActiveBillingTx, listShipmentServiceRollIds, listShipmentServiceRollShipments } from "./service-billing-gate.helper";
import { resolveServiceItemsForRolls, serviceWorkKey } from "./service-pricing.helper";
import { SERVICE_BILLING_TRIGGERS, type ServiceBillingTrigger, type loadServiceBillingSettings } from "../system-setting.service";

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

/** H8b: etkin tetik + kaynağı (müşteri carisinin kendi seçimi mi, fabrika ayarı mı). */
export interface EffectiveServiceBillingTrigger {
  trigger: ServiceBillingTrigger;
  source: "CUSTOMER" | "FACTORY";
}

/**
 * H8b TEK ÇÖZÜCÜ: müşterinin etkin hizmet faturası tetiği. Carinin `serviceBillingTrigger`ı doluysa o, NULL ya da
 * cari yoksa fabrika ayarı (`settings.trigger`). Sevk kancası, panel sevk önizlemesi, sevk taslağının bağ yolu ve
 * dönem sonu toplayıcı AYNI cevabı buradan okur.
 */
export async function resolveCustomerServiceBillingTrigger(customerId: string, settings: Pick<ServiceBillingSettings, "trigger">, db: Db = prisma): Promise<EffectiveServiceBillingTrigger> {
  const cari = await db.cariAccount.findUnique({ where: { customerId }, select: { serviceBillingTrigger: true } });
  const own = cari?.serviceBillingTrigger;
  if (own && (SERVICE_BILLING_TRIGGERS as string[]).includes(own)) return { trigger: own as ServiceBillingTrigger, source: "CUSTOMER" };
  return { trigger: settings.trigger, source: "FACTORY" };
}

/** Toplara (ve atalarına) bağlı AKTİF bağ anahtarları. */
async function loadBilledKeys(rollIds: string[], db: Db): Promise<Set<string>> {
  const rows = rollIds.length === 0 ? [] : await db.serviceBillingLink.findMany({
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
  /** H8b: DISPATCH_DAY'de iş başına sevk anı (dönem taslağı); yoksa herkese `dispatchedAt`. */
  dispatchedAtByRoll?: Map<string, Date>;
  /** K3b: verilirse BÜTÜN okumalar bu istemciden (önizleme kapısı fatura tx'inde, sevk kilidi altında okur). */
  db?: Db;
}): Promise<ServiceBillingDraft> {
  if (params.rollIds.length === 0) return { lines: [], links: [], warnings: [] };
  const db = params.db ?? prisma;
  const dispatchDay = params.settings.priceDate === "DISPATCH_DAY";
  const lineage = await collectRollLineage(params.rollIds, db);
  const res = await resolveServiceItemsForRolls({
    rollIds: lineage,
    customerId: params.customerId,
    currency: params.currency,
    db,
    options: {
      meterBasis: params.settings.meterBasis,
      missingMeter: params.settings.missingMeter,
      priceAsOf: dispatchDay ? params.dispatchedAt ?? new Date() : undefined,
      priceAsOfByRoll: dispatchDay ? params.dispatchedAtByRoll : undefined,
      billedKeys: await loadBilledKeys(lineage, db),
      shippedRollIds: new Set(params.rollIds),
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

/**
 * Bağ ↔ fatura satırı tutarlılığı (bağ = "bu iş BU faturada"): hizmet kalemi başına Σ satır qty = Σ bağ metresi.
 * Kalemin satırı hiç yoksa bağları düşer (iş faturasız kalır, sonra yeniden toplanır); miktar tutmuyorsa 409 —
 * aksi hâlde iş ya faturada olmadan "faturalandı" sayılır ya da iki kez kesilir.
 */
export function reconcileServiceLinksWithLines<T extends { serviceItemId: string; billedMeters: Prisma.Decimal }>(
  lines: Array<{ itemId?: string | null; qty: Prisma.Decimal.Value; description?: string }>,
  links: T[],
): { keep: T[]; droppedItemIds: string[] } {
  const byItem = new Map<string, { sum: Prisma.Decimal; n: number }>();
  for (const l of links) {
    const g = byItem.get(l.serviceItemId) ?? { sum: new Prisma.Decimal(0), n: 0 };
    byItem.set(l.serviceItemId, { sum: g.sum.plus(l.billedMeters), n: g.n + 1 });
  }
  const dropped: string[] = [];
  for (const [itemId, g] of byItem) {
    const itemLines = lines.filter((l) => l.itemId === itemId);
    if (itemLines.length === 0) { dropped.push(itemId); continue; }
    const qty = itemLines.reduce((acc, l) => acc.plus(new Prisma.Decimal(l.qty)), new Prisma.Decimal(0));
    // Bağ metresi iş başına 3 haneye yuvarlı, satır toplamı yuvarlanmadan toplanır → iş başına 0,001 pay.
    if (qty.minus(g.sum).abs().gt(new Prisma.Decimal(0.001).mul(g.n))) {
      throw AppError.conflict(
        `"${itemLines[0].description ?? "Hizmet"}" satırının miktarı (${qty.toFixed(3)} m) faturalanmamış işlerle (${g.sum.toFixed(3)} m) tutmuyor — satırı önizlemedeki miktarla bırakın ya da tamamen çıkarın.`,
        { code: "SERVICE_LINES_MISMATCH", serviceItemId: itemId },
      );
    }
  }
  return { keep: links.filter((l) => !dropped.includes(l.serviceItemId)), droppedItemIds: dropped };
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
    // Alanlar AÇIK yazılır: `test_snapshot_kolonlari` unitPrice yazıcısını AST ile ölçer (spread görünmez).
    const res = await tx.serviceBillingLink.createMany({
      data: links.map((l) => ({
        invoiceId,
        rollId: l.rollId,
        workOrderStepId: l.workOrderStepId,
        serviceItemId: l.serviceItemId,
        readingId: l.readingId,
        billedMeters: l.billedMeters,
        meterBasis: l.meterBasis,
        unitPrice: l.unitPrice,
        currency: l.currency,
        serviceAt: l.serviceAt,
      })),
    });
    return res.count;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw alreadyBilled(null);
    throw e;
  }
}

/**
 * Ters yol: fatura iptalinde AYNI tx'te damga — iş yeniden faturalanabilir. `serviceItemIds` verilirse yalnız o
 * kalemlerin bağları (taslaktan hizmet satırı çıkarıldı). Dönen: damgalanan bağ sayısı.
 */
export async function revokeServiceLinksTx(
  tx: Tx,
  invoiceId: string,
  by: { userId: string | null; reason: string },
  serviceItemIds?: string[],
): Promise<number> {
  if (serviceItemIds && serviceItemIds.length === 0) return 0;
  const { userId, reason } = by;
  const res = await tx.serviceBillingLink.updateMany({
    where: { invoiceId, revokedAt: null, ...(serviceItemIds ? { serviceItemId: { in: serviceItemIds } } : {}) },
    data: { revokedAt: new Date(), revokedById: userId, revokeReason: reason.slice(0, 300) },
  });
  return res.count;
}

/** Taslak satırları değişti: çıkarılan hizmet satırının bağı damgalanır, miktar değişimi 409 (bkz. reconcile). */
export async function syncServiceLinksToLinesTx(
  tx: Tx,
  invoiceId: string,
  lines: Array<{ itemId?: string | null; qty: Prisma.Decimal.Value; description?: string }>,
  userId: string | null,
): Promise<number> {
  const active = await tx.serviceBillingLink.findMany({ where: { invoiceId, revokedAt: null }, select: { serviceItemId: true, billedMeters: true } });
  const { droppedItemIds } = reconcileServiceLinksWithLines(lines, active);
  return revokeServiceLinksTx(tx, invoiceId, { userId, reason: "Hizmet satırı taslaktan çıkarıldı" }, droppedItemIds);
}

/**
 * Bağlı taslak sevk geri almayla serileşir: 8023 sevkiyat kilidi (tx'in İLK ifadesi olarak çağrılır) + taze durum.
 * `undoDispatch` aynı kilit altında bağları sayar — kilitsiz taslak phantom bağ doğururdu.
 */
export async function lockBillableShipmentTx(tx: Tx, shipmentId: string): Promise<void> {
  await lockBillableShipmentsTx(tx, [shipmentId]);
}

/**
 * H8 dönem taslağı: n sevkiyat → 8023 kilitleri id sırasıyla (deterministik; çok kilit deadlock'suz), ÖNCE hepsi
 * kilitlenir, sonra taze durum okunur. Sıralanmış tek kilit = `lockBillableShipmentTx`.
 */
export async function lockBillableShipmentsTx(tx: Tx, shipmentIds: string[], opts: { assertDispatched?: boolean } = {}): Promise<void> {
  const ids = [...new Set(shipmentIds)].sort();
  for (const id of ids) await lockShipmentScopeTx(tx, id);
  if (opts.assertDispatched !== false) await assertShipmentsDispatchedTx(tx, ids);
}

/** Kilit ALTINDA taze durum: bağ yazılacak her sevkiyat hâlâ DISPATCHED (değilse 409). */
export async function assertShipmentsDispatchedTx(tx: Tx, shipmentIds: string[]): Promise<void> {
  const ids = [...new Set(shipmentIds)];
  if (ids.length === 0) return;
  const live = await tx.shipment.count({ where: { id: { in: ids }, status: ShipmentStatus.DISPATCHED } });
  if (live !== ids.length) {
    throw AppError.conflict("Sevkiyat artık sevk edilmiş durumda değil — hizmet işleri faturalanamaz. Ekranı yenileyin.", { code: "SHIPMENT_NOT_DISPATCHED" });
  }
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
  db?: Db;
}): Promise<ServiceBillingDraft> {
  return collectServiceBillingDraft({ ...params, rollIds: await listShipmentServiceRollIds([params.shipmentId], params.db) });
}

/** H8b: top → sevk anı; ata zincirine en erken çocuğun anı yayılır (iş atada kayıtlıysa da kendi sevk gününe çözülür). */
async function mapLineageDispatchedAt(
  pairs: Array<{ rollId: string; shipmentId: string }>,
  shipments: Array<{ id: string; dispatchedAt: Date | null }>,
  db: Db = prisma,
): Promise<Map<string, Date>> {
  const at = new Map(shipments.filter((s) => s.dispatchedAt).map((s) => [s.id, s.dispatchedAt!]));
  const out = new Map<string, Date>();
  const put = (rollId: string, d: Date): boolean => {
    const cur = out.get(rollId);
    if (cur && cur.getTime() <= d.getTime()) return false;
    out.set(rollId, d);
    return true;
  };
  for (const p of pairs) { const d = at.get(p.shipmentId); if (d) put(p.rollId, d); }
  let frontier = [...out.keys()];
  for (let depth = 0; depth < 32 && frontier.length > 0; depth++) {
    const rows = await db.roll.findMany({ where: { id: { in: frontier }, parentRollId: { not: null } }, select: { id: true, parentRollId: true } });
    frontier = [...new Set(rows.filter((r) => put(r.parentRollId!, out.get(r.id)!)).map((r) => r.parentRollId!))];
  }
  return out;
}

/**
 * H8 DÖNEM SONU: cari müşterisinin dönemde (fabrika günü sınırları çağırandan) sevk edilmiş sevkiyatlarının emanet
 * topları → TEK toplayıcı (`collectServiceBillingDraft`); aktif bağı olan iş düşer (sevk taslağıyla çift yol yok).
 * Tüm toplar TEK çağrıda: aynı atanın iki çocuğu iki sevkte olsa da iş bir kez sayılır. H8b: `DISPATCH_DAY`
 * fiyatı her işin KENDİ sevk anına çözülür (ata işi en erken sevk edilen çocuğunun anına).
 */
export async function collectPeriodServiceBilling(params: {
  customerId: string;
  currency: Currency;
  settings: ServiceBillingSettings;
  from: Date;
  to: Date;
}): Promise<ServiceBillingDraft & { shipments: Array<{ id: string; shipmentNo: string; dispatchedAt: Date | null }>; billedWorkCount: number; billedDocNo: string | null }> {
  const shipments = await prisma.shipment.findMany({
    where: { customerId: params.customerId, status: ShipmentStatus.DISPATCHED, dispatchedAt: { gte: params.from, lte: params.to } },
    select: { id: true, shipmentNo: true, dispatchedAt: true },
    orderBy: [{ dispatchedAt: "asc" }, { id: "asc" }],
  });
  const pairs = await listShipmentServiceRollShipments(shipments.map((s) => s.id));
  const rollIds = [...new Set(pairs.map((p) => p.rollId))];
  const draft = await collectServiceBillingDraft({
    rollIds, customerId: params.customerId, currency: params.currency, settings: params.settings,
    dispatchedAt: shipments.at(-1)?.dispatchedAt ?? null,
    dispatchedAtByRoll: params.settings.priceDate === "DISPATCH_DAY" ? await mapLineageDispatchedAt(pairs, shipments) : undefined,
  });
  const billedWhere = rollIds.length === 0 ? null : { rollId: { in: await collectRollLineage(rollIds) }, revokedAt: null };
  const billedWorkCount = billedWhere ? await prisma.serviceBillingLink.count({ where: billedWhere }) : 0;
  // 409 mesajındaki fatura no dönemin KENDİ toplarının bağından (carinin rastgele bağından değil).
  const billedDocNo = billedWhere && billedWorkCount > 0 ? (await findActiveBillingTx(prisma, billedWhere))?.docNo ?? null : null;
  return { ...draft, shipments, billedWorkCount, billedDocNo };
}
