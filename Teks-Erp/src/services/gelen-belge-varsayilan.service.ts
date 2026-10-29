// =============================================================================
// TeksERP — Gelen belge SAHİBE ÖZEL VARSAYILAN ÜRÜN (E4; E3 kalanı, TASARIM-KARARI §8 HİZMET EKSENİ (1))
// =============================================================================
// Ürünü seçilmemiş satırın onay ürünü sırası: satırın itemId'si > sahibin müşteri varsayılanı (bu tablo) > fabrika
// ayarı `gelenBelge.defaultItemId` > bugünkü 400 UNRESOLVED. Customer master'ına kolon DEĞİL (kimlik/rol ayrımı):
// saf yapılandırma tablosu, kaldırma sert silme. Ürün kapısı fabrika ayarıyla AYNI (`itemProblem`); onay anında
// kullanılamayan varsayılan sessizce fabrikaya düşmez → 409 (kaynak details'te). Yazar `gelen-belge:template`.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { defaultItemUnusable, itemProblem, readFactoryDefaultItemId } from "./gelen-belge-ayar.service";

const TABLE = "DELIVERY_NOTE_CUSTOMER_DEFAULT";

export type DefaultItemSource = "CUSTOMER" | "FACTORY";

const ROW_SELECT = {
  id: true, customerId: true, defaultItemId: true, updatedAt: true,
  customer: { select: { id: true, code: true, name: true, isActive: true } },
  defaultItem: { select: { id: true, code: true, name: true } },
} satisfies Prisma.DeliveryNoteCustomerDefaultSelect;

type Row = Prisma.DeliveryNoteCustomerDefaultGetPayload<{ select: typeof ROW_SELECT }>;

export interface CustomerDefaultView {
  customerId: string;
  customer: Row["customer"];
  item: Row["defaultItem"];
  /** null = top doğurabilir; dolu = onayda 409 verecek sebep (pasif, birleşmiş, tür …). */
  problem: string | null;
  updatedAt: Date;
}

const view = async (r: Row): Promise<CustomerDefaultView> => ({
  customerId: r.customerId, customer: r.customer, item: r.defaultItem, problem: (await itemProblem(r.defaultItemId)).problem, updatedAt: r.updatedAt,
});

/** Liste — müşteri adına göre; ayar kümesi küçüktür (sahip başına tek satır), sayfalama gerekmez. */
export async function listCustomerDefaults(): Promise<CustomerDefaultView[]> {
  const rows = await prisma.deliveryNoteCustomerDefault.findMany({ select: ROW_SELECT, orderBy: { customer: { name: "asc" } } });
  const out: CustomerDefaultView[] = [];
  for (const r of rows) out.push(await view(r));
  return out;
}

const changed = () => AppError.conflict("Müşterinin varsayılan ürünü bu arada değişti; yenileyip tekrar deneyin.", { code: "GELEN_BELGE_CUSTOMER_DEFAULT_CHANGED" });

/**
 * Yaz (yoksa doğar): müşteri var + aktif (400 `GELEN_BELGE_CUSTOMER_INVALID`), ürün top doğurabilir (400
 * `GELEN_BELGE_DEFAULT_ITEM_INVALID`, fabrika ayarıyla aynı kapı). Koşullu atomik: güncelleme okunan eski ürüne bağlı
 * `updateMany`, doğuş `customerId @unique` (P2002) — araya giren yazım 409.
 */
export async function setCustomerDefault(customerId: string, defaultItemId: string, userId: string): Promise<CustomerDefaultView> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { isActive: true } });
  if (!customer) throw AppError.badRequest("Müşteri bulunamadı.", { code: "GELEN_BELGE_CUSTOMER_INVALID" });
  if (!customer.isActive) throw AppError.badRequest("Müşteri pasif; varsayılan ürün yazılamaz.", { code: "GELEN_BELGE_CUSTOMER_INVALID" });
  const { problem } = await itemProblem(defaultItemId);
  if (problem) throw AppError.badRequest(`Varsayılan ürün olarak kaydedilemez: ${problem}`, { code: "GELEN_BELGE_DEFAULT_ITEM_INVALID" });
  const before = await prisma.deliveryNoteCustomerDefault.findUnique({ where: { customerId }, select: { id: true, defaultItemId: true } });
  let id: string;
  if (!before) {
    const row = await prisma.deliveryNoteCustomerDefault
      .create({ data: { customerId, defaultItemId, createdById: userId, updatedById: userId }, select: { id: true } })
      .catch((err: unknown) => { throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" ? changed() : err; });
    id = row.id;
    await AuditService.log({ userId, action: "CREATE", tableName: TABLE, recordId: id, newData: { customerId, defaultItemId } });
  } else {
    const c = await prisma.deliveryNoteCustomerDefault.updateMany({ where: { id: before.id, defaultItemId: before.defaultItemId }, data: { defaultItemId, updatedById: userId } });
    if (c.count === 0) throw changed();
    id = before.id;
    await AuditService.log({ userId, action: "UPDATE", tableName: TABLE, recordId: id, oldData: { defaultItemId: before.defaultItemId }, newData: { customerId, defaultItemId } });
  }
  return view(await prisma.deliveryNoteCustomerDefault.findUniqueOrThrow({ where: { id }, select: ROW_SELECT }));
}

/** Kaldır — saf yapılandırma pivotu SERT SİLMESİ (defter değil; onaydaki top kendi defterinde doğar). Okunan satıra bağlı. */
export async function removeCustomerDefault(customerId: string, userId: string): Promise<{ customerId: string }> {
  const before = await prisma.deliveryNoteCustomerDefault.findUnique({ where: { customerId }, select: { id: true, defaultItemId: true } });
  if (!before) throw AppError.notFound("Müşterinin varsayılan ürünü yok.", { code: "GELEN_BELGE_CUSTOMER_DEFAULT_NOT_FOUND" });
  const c = await prisma.deliveryNoteCustomerDefault.deleteMany({ where: { id: before.id, defaultItemId: before.defaultItemId } });
  if (c.count === 0) throw changed();
  await AuditService.log({ userId, action: "DELETE", tableName: TABLE, recordId: before.id, oldData: { customerId, defaultItemId: before.defaultItemId } });
  return { customerId };
}

/** Sahibin ETKİN varsayılanı — panel ipucu/ön kontrolü bunu okur (istemci kendi kuralını uydurmaz). */
export interface EffectiveDefaultItem {
  itemId: string | null;
  name: string | null;
  /** CUSTOMER: sahibin varsayılanı · FACTORY: fabrika ayarı · null: ikisi de yok (ürünsüz satır 400 UNRESOLVED). */
  source: DefaultItemSource | null;
  /** false + itemId dolu → onay 409 GELEN_BELGE_DEFAULT_ITEM_UNUSABLE (fabrikaya DÜŞMEZ). */
  usable: boolean;
  problem: string | null;
}

export async function resolveEffectiveDefaultItem(ownerCustomerId: string | null): Promise<EffectiveDefaultItem> {
  const own = ownerCustomerId ? await prisma.deliveryNoteCustomerDefault.findUnique({ where: { customerId: ownerCustomerId }, select: { defaultItemId: true } }) : null;
  const itemId = own?.defaultItemId ?? (await readFactoryDefaultItemId());
  if (!itemId) return { itemId: null, name: null, source: null, usable: false, problem: null };
  const { row, problem } = await itemProblem(itemId);
  return { itemId, name: row?.name ?? null, source: own ? "CUSTOMER" : "FACTORY", usable: !problem, problem };
}

/**
 * Onay ön kontrolü: etkin varsayılan yoksa null; varsa o AN top doğurabilmeli — kullanılamayan ürün 409
 * `GELEN_BELGE_DEFAULT_ITEM_UNUSABLE` (details.source), sahibin bozuk varsayılanı fabrikaya sessizce DÜŞMEZ.
 */
export async function resolveDefaultItemForApproval(ownerCustomerId: string | null): Promise<{ id: string; name: string; source: DefaultItemSource } | null> {
  const eff = await resolveEffectiveDefaultItem(ownerCustomerId);
  if (!eff.itemId || !eff.source) return null;
  if (!eff.usable || !eff.name) throw defaultItemUnusable(eff.source, eff.itemId, eff.problem);
  return { id: eff.itemId, name: eff.name, source: eff.source };
}
