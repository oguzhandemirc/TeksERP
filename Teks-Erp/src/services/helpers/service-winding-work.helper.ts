// =============================================================================
// LEVENT SARIM HİZMET İŞİ — dönem taslağı kaynağı (genel fason F4, patron kararı 2026-11-08)
// =============================================================================
// Soru: "bu müşteriye dönemde sahibine geri gönderdiğimiz (emanet) leventlerden hangisini biz sardık, hangi
// hizmet kartıyla, kaç metre — ve henüz faturalanmadı?" Faturalanabilir AN = leventin AKTİF `SHIP_TO_OWNER`
// olayı (F5 emanet çıkışı; ters olayı yok + belge iptal edilmemiş). Olay yoksa iş yoktur. Öznesi LEVENTTİR
// (WARP_BEAM, adımsız); yalnız DÖNEM taslağında görünür (top sevk taslağı bu dosyayı çağırmaz).
// Metre: sarım metresi (`windingMetersByBeam`, WOUND ± WOUND_CANCEL — tek okuyucu); hizmet anı = belge
// `dispatchedAt`; kart: WOUND makinesinin istasyonunun süreç türü → `service_item_processes` (F3 ile tek kaynak).
// Bizde sarılmamış (fason/satın alma, makinesiz) levent iş değildir — uyarısız; yalnız BİZİM sardığımız ama süreç
// türü eşlenmemiş levent sayılır (çağıran uyarır). Levent TEK sarım işidir: faturalı anahtarı yalnız levent (kart değil).
// =============================================================================
import { Currency, InvoiceLineType, PriceKind, Prisma, ServiceMeterBasis } from "@prisma/client";
import prisma from "../../lib/prisma";
import { resolveItemPricesAtMany } from "../item-price.service";
import { loadServiceTierItemsAtMany, pickServicePrice, tierMissingWarning } from "./service-price-pick.helper";
import { priceUnitMatches, SERVICE_QTY_UNIT_LABEL } from "./service-quantity.helper";
import { loadProcessMap } from "./service-step-work.helper";
import { processOfMachines } from "./service-weaving-work.helper";
import type { ServiceBillingDraft, ServiceBillingLinkInput } from "./service-billing.helper";
import type { ServiceDraftWorkRow } from "../service-billing/types";

type Db = Prisma.TransactionClient | typeof prisma;

/** Sarım işinin süreç etiketi (`ServiceDraftWorkRow.processLabel`, sözleşme). */
export const WINDING_PROCESS_LABEL = "Sarım";

/** Aktif sahibine-çıkış olayı yüklemi — ters olayı yok, belgesi iptal edilmemiş (liste ve fatura tx kapısı ortak). */
export function activeShipToOwnerWhere(extra: Prisma.ConsignmentDispatchWhereInput = {}): Prisma.WarpBeamEventWhereInput {
  return { kind: "SHIP_TO_OWNER", reversal: { is: null }, consignmentItem: { is: { dispatch: { is: { cancelledAt: null, ...extra } } } } };
}

/** Leventin sarım metresi — WOUND (+) ve WOUND_CANCEL (−) toplamı; TEK okuyucu. Sarımı olmayan levent haritada YOK. */
export async function windingMetersByBeam(db: Db, beamIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (beamIds.length === 0) return out;
  const rows = await db.warpBeamEvent.findMany({ where: { beamId: { in: beamIds }, kind: { in: ["WOUND", "WOUND_CANCEL"] } }, select: { beamId: true, kind: true, lengthM: true } });
  for (const r of rows) {
    const m = r.lengthM ?? new Prisma.Decimal(0);
    out.set(r.beamId, (out.get(r.beamId) ?? new Prisma.Decimal(0)).plus(r.kind === "WOUND" ? m : m.neg()));
  }
  return out;
}

export interface WindingWork {
  warpBeamId: string;
  beamNo: string;
  serviceItemId: string;
  meters: Prisma.Decimal;
  serviceAt: Date;
}

export interface WindingWorkList {
  works: WindingWork[];
  /** Bizim makinemizde sarılmış ama devere istasyonunun süreç türü eşlenmemiş leventler (makinesiz levent sayılmaz). */
  unmappedCount: number;
  zeroMeterCount: number;
}

/** Müşterinin dönemde (belge `dispatchedAt`) sahibine çıkan leventlerinin sarım işleri. Faturalı süzgeç çağıranda. */
export async function listWindingServiceWorks(p: { customerId: string; from: Date; to: Date; db?: Db }): Promise<WindingWorkList> {
  const db = p.db ?? prisma;
  const out: WindingWorkList = { works: [], unmappedCount: 0, zeroMeterCount: 0 };
  const ships = await db.warpBeamEvent.findMany({
    where: activeShipToOwnerWhere({ ownerCustomerId: p.customerId, dispatchedAt: { gte: p.from, lte: p.to } }),
    select: { beamId: true, beam: { select: { beamNo: true } }, consignmentItem: { select: { dispatch: { select: { dispatchedAt: true } } } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (ships.length === 0) return out;
  const beamIds = [...new Set(ships.map((s) => s.beamId))];
  const wound = await db.warpBeamEvent.findMany({ where: { beamId: { in: beamIds }, kind: "WOUND" }, select: { beamId: true, machineId: true } });
  const machineOf = new Map(wound.map((w) => [w.beamId, w.machineId]));
  const processMap = await loadProcessMap(db);
  const byMachine = await processOfMachines(db, [...new Set(wound.map((w) => w.machineId).filter((v): v is string => v !== null))], processMap);
  const meters = await windingMetersByBeam(db, beamIds);
  const seen = new Set<string>(); // levent tek sarım işi: birden çok aktif çıkışta ilki
  for (const s of ships) {
    if (seen.has(s.beamId)) continue;
    seen.add(s.beamId);
    const machineId = machineOf.get(s.beamId) ?? null;
    if (!machineId) continue; // bizde sarılmamış: hizmet işi değil, uyarı da değil
    const proc = byMachine.get(machineId);
    if (!proc) { out.unmappedCount++; continue; }
    const m = meters.get(s.beamId) ?? new Prisma.Decimal(0);
    if (m.lte(0)) { out.zeroMeterCount++; continue; }
    out.works.push({ warpBeamId: s.beamId, beamNo: s.beam.beamNo, serviceItemId: proc.serviceItemId, meters: m, serviceAt: s.consignmentItem!.dispatch.dispatchedAt });
  }
  return out;
}

/** Uyarı metinleri — bekçi aynı cümleyi arar. */
export function windingUnmappedWarning(count: number): string {
  return `${count} leventin devere istasyonunun süreç türü hizmet kartına eşlenmemiş — sarım işi faturaya alınmadı.`;
}
export function windingZeroMeterWarning(count: number): string {
  return `${count} leventin sarım metresi bulunamadı — sarım işi faturaya alınmadı, leventi kontrol edin.`;
}

/**
 * Dönem taslağının levent kolu: sarım işleri → aktif bağı olan levent düşer (kart değişse de: levent tek iş) → fiyat `pickServicePrice` sırasıyla (levent
 * işinde kademe/gram adayı yok; kartın kademe tablosu varsa fiyatsız + uyarı) → kart başına satır + bağ + kırılım.
 */
export async function collectWindingServiceBilling(p: { customerId: string; currency: Currency; from: Date; to: Date; db?: Db }): Promise<ServiceBillingDraft & { billedCount: number; billedDocNo: string | null }> {
  const db = p.db ?? prisma;
  const list = await listWindingServiceWorks({ customerId: p.customerId, from: p.from, to: p.to, db });
  const warnings: string[] = [];
  if (list.unmappedCount > 0) warnings.push(windingUnmappedWarning(list.unmappedCount));
  if (list.zeroMeterCount > 0) warnings.push(windingZeroMeterWarning(list.zeroMeterCount));
  const ids = [...new Set(list.works.map((w) => w.warpBeamId))];
  const billed = ids.length === 0 ? [] : await db.serviceBillingLink.findMany({ where: { warpBeamId: { in: ids }, revokedAt: null }, select: { warpBeamId: true, invoice: { select: { docNo: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const billedDocNo = billed[0]?.invoice.docNo ?? null;
  const billedBeams = new Set(billed.map((b) => b.warpBeamId));
  const works = list.works.filter((w) => !billedBeams.has(w.warpBeamId));
  if (works.length === 0) return { lines: [], links: [], warnings, works: [], billedCount: billed.length, billedDocNo };
  const items = new Map((await db.serviceItem.findMany({ where: { id: { in: [...new Set(works.map((w) => w.serviceItemId))] } }, select: { id: true, code: true, name: true } })).map((i) => [i.id, i]));
  // Fiyat anı = her çıkışın KENDİ anı (gün içi fiyat değişimi doğru); bütün anlar için TEK sorgu çifti.
  const itemIds = works.map((w) => w.serviceItemId);
  const ats = works.map((w) => w.serviceAt);
  const priceAt = await resolveItemPricesAtMany({ itemIds, kind: PriceKind.SALE, currency: p.currency, customerId: p.customerId, ats, db });
  const hasTiersAt = await loadServiceTierItemsAtMany({ itemIds, currency: p.currency, customerId: p.customerId, ats, db });
  const price = new Map<WindingWork, Prisma.Decimal | null>();
  const tierMissing = new Map<string, number>();
  for (const w of works) {
    const hit = priceAt(w.serviceItemId, w.serviceAt);
    const pick = pickServicePrice({ customerTier: null, generalTier: null, gram: null, item: hit && priceUnitMatches(hit.priceUnit, "METER") ? hit.price : null, itemHasTiers: hasTiersAt(w.serviceItemId, w.serviceAt), valueInTable: false });
    price.set(w, pick.unitPrice);
    if (pick.tierMissing) tierMissing.set(w.serviceItemId, (tierMissing.get(w.serviceItemId) ?? 0) + 1);
  }
  const groups = new Map<string, { serviceItemId: string; unitPrice: Prisma.Decimal | null; qty: Prisma.Decimal; n: number }>();
  for (const w of works) {
    const u = price.get(w) ?? null;
    const key = `${w.serviceItemId}:${u?.toString() ?? "-"}`;
    const g = groups.get(key) ?? { serviceItemId: w.serviceItemId, unitPrice: u, qty: new Prisma.Decimal(0), n: 0 };
    g.qty = g.qty.plus(w.meters);
    g.n += 1;
    groups.set(key, g);
  }
  for (const [itemId, n] of tierMissing) warnings.push(tierMissingWarning(items.get(itemId)?.name ?? "Sarım", n));
  for (const g of groups.values()) if (g.unitPrice === null && !tierMissing.has(g.serviceItemId)) warnings.push(`"${items.get(g.serviceItemId)?.name ?? "Sarım"}" için ${p.currency} satış fiyatı yok — satır fiyatsız.`);
  const lines = [...groups.values()]
    .sort((a, b) => (items.get(a.serviceItemId)?.code ?? "").localeCompare(items.get(b.serviceItemId)?.code ?? "", "tr") || (a.unitPrice?.toString() ?? "").localeCompare(b.unitPrice?.toString() ?? ""))
    .map((g) => ({
      lineType: InvoiceLineType.SERVICE, itemId: null, serviceItemId: g.serviceItemId,
      description: `${items.get(g.serviceItemId)?.name ?? WINDING_PROCESS_LABEL} (${g.n} levent)`,
      qty: g.qty.toDecimalPlaces(3), unit: SERVICE_QTY_UNIT_LABEL.METER, unitPrice: g.unitPrice ?? new Prisma.Decimal(0),
    }));
  const links: ServiceBillingLinkInput[] = works.map((w) => ({
    rollId: null, warpBeamId: w.warpBeamId, workOrderStepId: null, serviceItemId: w.serviceItemId, readingId: null,
    billedMeters: w.meters.toDecimalPlaces(3), billedQty: null, billedUnit: null, meterBasis: ServiceMeterBasis.WOUND,
    unitPrice: price.get(w) ?? new Prisma.Decimal(0), currency: p.currency, serviceAt: w.serviceAt,
  }));
  const rows: ServiceDraftWorkRow[] = works.map((w) => ({
    source: "WINDING", subjectKind: "WARP_BEAM", subjectId: w.warpBeamId, subjectCode: w.beamNo, serviceItemId: w.serviceItemId,
    processLabel: WINDING_PROCESS_LABEL, workOrderStepId: null, qty: w.meters.toFixed(3), unit: "METER", meterBasis: "WOUND",
    unitPrice: (price.get(w) ?? new Prisma.Decimal(0)).toFixed(4), excludedReason: null,
  }));
  return { lines, links, warnings, works: rows, billedCount: billed.length, billedDocNo };
}
