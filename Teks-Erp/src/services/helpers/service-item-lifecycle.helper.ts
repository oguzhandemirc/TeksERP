// =============================================================================
// HİZMET KARTI YAŞAM DÖNGÜSÜ — tek yazar + canlı referans tek kaynağı (`service_items`)
// =============================================================================
// Ürün kartı emsali (`item-lifecycle.helper.ts`): Pasif (ARCHIVED) hizmet kartında canlı referans OLAMAZ
// (MV-06). Hata kodları ürünle AYNI (`ITEM_HAS_LIVE_REFERENCES`, `ITEM_LIFECYCLE_CHANGED`, `ITEM_MERGED`) —
// istemcinin yaşam döngüsü diyaloğu iki kart türünde tek dalla çalışsın.
// KİLİT SIRASI: 8030 SHARED → `service_items` satırı FOR UPDATE; referans yazanlar aynı sırayla FOR SHARE
// alır (`item-usage.helper` → `assertServiceItemUsableTx`) ⇒ sayım ile yazım arasında doğan bağ görünür.
// =============================================================================
import { InvoiceStatus, ItemLifecycleStatus, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { lowerTr } from "../../utils/tr-case";
import { AuditService } from "../audit.service";
import { lockAgainstMergeTx } from "./master-data-live.helper";
import { itemLifecycleWriteData } from "./item-lifecycle-data.helper";
import { ACTIVE_ITEM_PRICE } from "./item-price-validity.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export const SERVICE_ITEM_TABLE = "SERVICE_ITEM";

export type ServiceItemLiveRefKind =
  | "SERVICE_PROPERTY_MAP" | "SERVICE_VALUE_MAP" | "SERVICE_CUSTOMER_PRICE" | "CONSUMABLE_NORM" | "DRAFT_INVOICE_LINE";

export const SERVICE_ITEM_LIVE_REF_KINDS: ReadonlyArray<{ kind: ServiceItemLiveRefKind; label: string }> = [
  // Faturalama motoru eşlemeyi ve müşteri hizmet fiyatını HER sevkte okur (1e K2a, 2026-10-29).
  { kind: "SERVICE_PROPERTY_MAP", label: "Hizmet eşlemesi (özellik)" },
  { kind: "SERVICE_VALUE_MAP", label: "Hizmet eşlemesi (özellik değeri)" },
  { kind: "SERVICE_CUSTOMER_PRICE", label: "Müşteri hizmet fiyatı" },
  { kind: "CONSUMABLE_NORM", label: "Aktif sarf normu" },
  // Taslak fatura onaylanınca hizmeti satış defterine yazar (plan §3.7).
  { kind: "DRAFT_INVOICE_LINE", label: "Taslak fatura satırı" },
];

interface LiveRefWhere {
  SERVICE_PROPERTY_MAP: Prisma.FabricPropertyWhereInput;
  SERVICE_VALUE_MAP: Prisma.FabricPropertyValueWhereInput;
  SERVICE_CUSTOMER_PRICE: Prisma.ItemPriceWhereInput;
  CONSUMABLE_NORM: Prisma.ServiceConsumableNormWhereInput;
  DRAFT_INVOICE_LINE: Prisma.InvoiceLineWhereInput;
}

function liveRefWhere(serviceItemId: string): LiveRefWhere {
  return {
    // Eşleme pasif özellik/değerde de sayılır: çözücü `isActive`e bakmadan faturalar (fail-closed).
    SERVICE_PROPERTY_MAP: { serviceItemId },
    SERVICE_VALUE_MAP: { serviceItemId },
    // Kart varsayılan fiyatı (müşterisiz) TANIMDIR, canlı referans değildir.
    SERVICE_CUSTOMER_PRICE: { serviceItemId, customerId: { not: null }, ...ACTIVE_ITEM_PRICE },
    CONSUMABLE_NORM: { serviceItemId, revokedAt: null },
    DRAFT_INVOICE_LINE: { serviceItemId, invoice: { status: InvoiceStatus.DRAFT } },
  };
}

export interface ServiceItemLiveRefCount { kind: ServiceItemLiveRefKind; label: string; count: number }
export interface ServiceItemLiveRefRecord { id: string; title: string; detail: string }

/** Türe göre canlı referans sayıları (0 olanlar DAHİL — önizleme hepsini gösterir). */
export async function countServiceItemLiveRefs(db: Db, serviceItemId: string): Promise<ServiceItemLiveRefCount[]> {
  const w = liveRefWhere(serviceItemId);
  // Sıralı: tx istemcisinde Promise.all yasak.
  const counts: Record<ServiceItemLiveRefKind, number> = {
    SERVICE_PROPERTY_MAP: await db.fabricProperty.count({ where: w.SERVICE_PROPERTY_MAP }),
    SERVICE_VALUE_MAP: await db.fabricPropertyValue.count({ where: w.SERVICE_VALUE_MAP }),
    SERVICE_CUSTOMER_PRICE: await db.itemPrice.count({ where: w.SERVICE_CUSTOMER_PRICE }),
    CONSUMABLE_NORM: await db.serviceConsumableNorm.count({ where: w.CONSUMABLE_NORM }),
    DRAFT_INVOICE_LINE: await db.invoiceLine.count({ where: w.DRAFT_INVOICE_LINE }),
  };
  return SERVICE_ITEM_LIVE_REF_KINDS.map(({ kind, label }) => ({ kind, label, count: counts[kind] }));
}

export const totalServiceItemLiveRefs = (c: ServiceItemLiveRefCount[]): number => c.reduce((s, x) => s + x.count, 0);

const LIST_LIMIT = 500;

/** Canlı referansları TEK TEK listeler (yıkıcı işlem kuralı). */
export async function listServiceItemLiveRefs(
  db: Db,
  serviceItemId: string,
): Promise<Array<ServiceItemLiveRefCount & { records: ServiceItemLiveRefRecord[] }>> {
  const w = liveRefWhere(serviceItemId);
  const take = LIST_LIMIT;
  const counts = await countServiceItemLiveRefs(db, serviceItemId);
  const rec: Record<ServiceItemLiveRefKind, ServiceItemLiveRefRecord[]> = {
    SERVICE_PROPERTY_MAP: (await db.fabricProperty.findMany({
      where: w.SERVICE_PROPERTY_MAP, take, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, isActive: true },
    })).map((x) => ({ id: x.id, title: x.name, detail: `${x.code}${x.isActive ? "" : " · pasif"} — eşlemeyi kaldırın` })),
    SERVICE_VALUE_MAP: (await db.fabricPropertyValue.findMany({
      where: w.SERVICE_VALUE_MAP, take, orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, isActive: true, property: { select: { name: true } } },
    })).map((x) => ({ id: x.id, title: `${x.property.name} · ${x.name}`, detail: `${x.code}${x.isActive ? "" : " · pasif"} — eşlemeyi kaldırın` })),
    SERVICE_CUSTOMER_PRICE: (await db.itemPrice.findMany({
      where: w.SERVICE_CUSTOMER_PRICE, take, orderBy: { createdAt: "asc" },
      select: { id: true, currency: true, customer: { select: { name: true } } },
    })).map((x) => ({ id: x.id, title: x.customer?.name ?? "—", detail: `${x.currency} — müşteri fiyatını kaldırın` })),
    CONSUMABLE_NORM: (await db.serviceConsumableNorm.findMany({
      where: w.CONSUMABLE_NORM, take, orderBy: { createdAt: "asc" },
      select: { id: true, serviceItem: { select: { name: true } }, consumableItem: { select: { name: true } } },
    })).map((x) => ({ id: x.id, title: `${x.serviceItem.name} · ${x.consumableItem.name}`, detail: "sarf normunu kaldırın" })),
    DRAFT_INVOICE_LINE: (await db.invoiceLine.findMany({
      where: w.DRAFT_INVOICE_LINE, take, orderBy: { createdAt: "asc" },
      select: { id: true, invoice: { select: { docNo: true } } },
    })).map((x) => ({ id: x.id, title: x.invoice.docNo, detail: "taslak faturayı onaylayın ya da satırı kaldırın" })),
  };
  return counts.map((c) => ({ ...c, records: rec[c.kind] }));
}

export interface ServiceItemTransitionInput {
  serviceItemId: string;
  to: ItemLifecycleStatus;
  reason?: string | null;
  userId?: string | null;
  /** Yalnız bu durumlardan geçilir; kart başka durumdaysa yazmadan döner (kilit altında karar). */
  onlyFrom?: ItemLifecycleStatus[];
}

export interface ServiceItemTransitionResult {
  serviceItemId: string;
  from: ItemLifecycleStatus;
  to: ItemLifecycleStatus;
  idempotent: boolean;
  name: string;
}

/** TEK YAZAR. 8030 SHARED (ilk ifade) → kart FOR UPDATE → arşiv kapısı → atomik claim. */
export async function transitionServiceItemLifecycleTx(
  tx: Prisma.TransactionClient,
  input: ServiceItemTransitionInput,
): Promise<ServiceItemTransitionResult> {
  await lockAgainstMergeTx(tx);
  const rows = await tx.$queryRaw<Array<{ name: string; status: ItemLifecycleStatus; mergedIntoId: string | null }>>`
    SELECT "name", "lifecycleStatus" AS status, "mergedIntoId" FROM "service_items" WHERE id = ${input.serviceItemId}::uuid FOR UPDATE`;
  const cur = rows[0];
  if (!cur) throw AppError.notFound("Hizmet kartı bulunamadı");
  const base = { serviceItemId: input.serviceItemId, from: cur.status, to: input.to, name: cur.name };
  if (cur.status === input.to) return { ...base, idempotent: true };
  if (input.onlyFrom && !input.onlyFrom.includes(cur.status)) return { ...base, to: cur.status, idempotent: true };
  if (cur.mergedIntoId) {
    throw AppError.badRequest("Bu hizmet kartı başka bir karta birleştirildi ve yeniden aktifleştirilemez.", { code: "ITEM_MERGED" });
  }
  if (input.to === ItemLifecycleStatus.ARCHIVED) {
    const counts = await countServiceItemLiveRefs(tx, input.serviceItemId);
    if (totalServiceItemLiveRefs(counts) > 0) {
      const references = await listServiceItemLiveRefs(tx, input.serviceItemId);
      const summary = counts.filter((c) => c.count > 0).map((c) => `${c.count} ${lowerTr(c.label)}`).join(", ");
      throw AppError.conflict(
        `"${cur.name}" hizmet kartı pasife alınamaz: üstünde canlı kayıt var (${summary}). Kayıtları kaldırın ya da 'Tükenene kadar' seçin.`,
        { code: "ITEM_HAS_LIVE_REFERENCES", references },
      );
    }
  }
  const claim = await tx.serviceItem.updateMany({
    where: { id: input.serviceItemId, lifecycleStatus: cur.status },
    data: itemLifecycleWriteData(input.to, input.userId, input.reason?.trim() || null),
  });
  if (claim.count === 0) {
    const fresh = await tx.serviceItem.findUnique({ where: { id: input.serviceItemId }, select: { lifecycleStatus: true } });
    if (fresh?.lifecycleStatus === input.to) return { ...base, idempotent: true };
    throw AppError.conflict("Kartın durumu bu sırada değişti — tekrar deneyin.", { code: "ITEM_LIFECYCLE_CHANGED" });
  }
  return { ...base, idempotent: false };
}

/** Geçiş + audit (tx DIŞINDA, best-effort); idempotent tekrar audit yazmaz. */
export async function transitionServiceItemLifecycle(input: ServiceItemTransitionInput): Promise<ServiceItemTransitionResult> {
  const result = await prisma.$transaction((tx) => transitionServiceItemLifecycleTx(tx, input));
  if (!result.idempotent) {
    await AuditService.log({
      userId: input.userId ?? undefined,
      action: "UPDATE",
      tableName: SERVICE_ITEM_TABLE,
      recordId: input.serviceItemId,
      oldData: { lifecycleStatus: result.from },
      newData: {
        lifecycleStatus: result.to,
        isActive: result.to !== ItemLifecycleStatus.ARCHIVED,
        ...(input.reason ? { lifecycleReason: input.reason } : {}),
      },
    });
  }
  return result;
}
