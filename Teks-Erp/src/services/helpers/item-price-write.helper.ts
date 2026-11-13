// =============================================================================
// KALEM FİYATI YAZIMI — kademe kapısı + ZAMANLANMIŞ DAMGA (hizmet fiyat tablosu, 2026-11-06)
// =============================================================================
// Tek yazar `itemPriceService` (upsert/remove) buraya iner. Anahtar:
// (itemId | serviceItemId, customerId, propertyValueId, kind, currency); anahtar başına AÇIK satır tektir.
// Fiyatın KONUSU ürün (`items`) ya da hizmet (`service_items`) kartıdır — tam biri dolu (DB CHECK).
// İleri tarihli fiyat (K4): yürürlükteki R'nin `revokedAt`ı yeni satırın `validFrom`una kurulur
// (gerekçe `SCHEDULED`); bekleyen satır anahtarın açık satırıdır. Pencereler örtüşmez.
// Eşzamanlılık: tx'te kalem FOR SHARE → anahtarın açık satırı FOR UPDATE → durum TAZE okunur;
// her damga atomik claim (`count===0 → 409`), ikinci açık satır partial unique'e çarpar (P2002 → 409).
// =============================================================================
import { Prisma, PriceKind, type Currency, type ServiceQtyUnit } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { assertItemUsable, assertItemUsableTx, assertServiceItemUsable, assertServiceItemUsableTx, type ItemUsage } from "./item-usage.helper";
import { ACTIVE_ITEM_PRICE, ITEM_PRICE_REVOKE_REASON } from "./item-price-validity.helper";
import { pickServiceItemId } from "./service-item-pick.helper";
import { assertRowVersion } from "./stale-record.helper";

type Tx = Prisma.TransactionClient;

/** Fiyat konusu: ürün kartı XOR hizmet kartı (`item_prices` exactly-one CHECK'inin ikizi). */
export interface ItemPriceSubject {
  itemId: string | null;
  serviceItemId: string | null;
}

export interface ItemPriceKey extends ItemPriceSubject {
  customerId: string | null;
  propertyValueId: string | null;
  kind: PriceKind;
  currency: Currency;
}

/** Satırın konu kimliği — dış sözleşmede (`itemId` alanı) ürün ya da hizmet id'si aynı alandan gider. */
export function priceSubjectId(r: ItemPriceSubject): string {
  if (r.itemId) return r.itemId;
  return r.serviceItemId as string;
}

/** Konu kimliği iki uzaydan birinde (UUID ortak uzay): hizmet kartı ise `serviceItemId`, değilse ürün. Yoksa 400. */
export async function resolvePriceSubject(db: Tx | Prisma.DefaultPrismaClient, id: string): Promise<ItemPriceSubject> {
  const svc = await db.serviceItem.findUnique({ where: { id }, select: { id: true } });
  if (svc) return { itemId: null, serviceItemId: svc.id };
  const item = await db.item.findUnique({ where: { id }, select: { id: true } });
  if (!item) throw AppError.badRequest("Kalem bulunamadı.", { code: "ITEM_NOT_FOUND" });
  return { itemId: item.id, serviceItemId: null };
}

/** Konunun kullanım kapısı (ürün → `items`, hizmet → `service_items`); tx'te kart FOR SHARE. */
export async function assertPriceSubjectUsable(db: Tx | Prisma.DefaultPrismaClient, s: ItemPriceSubject, usage: ItemUsage, tx?: Tx): Promise<void> {
  if (tx) {
    if (s.serviceItemId) await assertServiceItemUsableTx(tx, s.serviceItemId, usage);
    else await assertItemUsableTx(tx, s.itemId as string, usage);
    return;
  }
  if (s.serviceItemId) await assertServiceItemUsable(db, s.serviceItemId, usage);
  else await assertItemUsable(db, s.itemId as string, usage);
}

/** `Decimal(14,4)` kolonunun GERÇEK sınırı (10 tam hane) — kolon değişirse burası da değişir. */
const MAX_PRICE = new Prisma.Decimal("9999999999.9999");

/**
 * Girilen fiyatı doğrular ve kolon hassasiyetine indirger. Sıfır meşrudur (numune); negatif 400.
 * SIRA: önce yuvarla, sonra sınırı ölç — ters sırada sınır altı değer yuvarlanınca taşar (ham overflow).
 */
export function normalizePrice(value: Prisma.Decimal.Value): Prisma.Decimal {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(value);
  } catch {
    throw AppError.badRequest("Fiyat sayı olmalı.");
  }
  if (!d.isFinite()) throw AppError.badRequest("Fiyat sayı olmalı.");
  if (d.lt(0)) throw AppError.badRequest("Fiyat negatif olamaz.");
  const rounded = d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  if (rounded.gt(MAX_PRICE)) throw AppError.badRequest(`Fiyat çok büyük (en fazla ${MAX_PRICE.toString()}).`);
  return rounded;
}

/**
 * Kademe / ileri tarih kapıları (yalnız alan doluysa): kademe satırı SERVICE + SALE + değer bu
 * hizmete eşli (`pickServiceItemId`) + değer aktif; ileri tarih yalnız SALE ve gelecekte.
 */
export async function assertTierWritable(
  db: Tx | Prisma.DefaultPrismaClient,
  input: ItemPriceSubject & { propertyValueId: string | null; kind: PriceKind; validFrom: Date | null },
  now: Date,
): Promise<void> {
  if (input.validFrom) {
    if (input.kind !== PriceKind.SALE) throw AppError.badRequest("İleri tarihli fiyat yalnız satış fiyatında girilebilir.", { code: "ITEM_PRICE_FUTURE_SALE_ONLY" });
    if (input.validFrom.getTime() <= now.getTime()) throw AppError.badRequest("Geçerlilik başlangıcı ileri bir tarih olmalı (bugünden geçerli fiyat için boş bırakın).", { code: "ITEM_PRICE_VALID_FROM_PAST" });
  }
  if (!input.propertyValueId) return;
  if (input.kind !== PriceKind.SALE) throw AppError.badRequest("Kademe fiyatı yalnız satış fiyatıdır.", { code: "SERVICE_TIER_SALE_ONLY" });
  // Kademe yalnız hizmet kartına: konu `service_items`'ta değilse (ürün kartı) reddedilir.
  if (!input.serviceItemId) throw AppError.badRequest("Kademe fiyatı yalnız hizmet kalemine girilir.", { code: "SERVICE_TIER_NOT_SERVICE" });
  const value = await db.fabricPropertyValue.findUnique({
    where: { id: input.propertyValueId },
    select: { name: true, isActive: true, serviceItemId: true, property: { select: { serviceItemId: true, variantOf: { select: { serviceItemId: true } } } } },
  });
  if (!value) throw AppError.badRequest("Kademe (özellik değeri) bulunamadı.");
  if (!value.isActive) throw AppError.badRequest(`"${value.name}" pasif — bu kademeye yeni fiyat girilemez.`, { code: "SERVICE_TIER_INACTIVE" });
  const mapped = pickServiceItemId({ value: value.serviceItemId, property: value.property.serviceItemId, parentFlag: value.property.variantOf?.serviceItemId });
  if (mapped !== input.serviceItemId) {
    throw AppError.badRequest(`"${value.name}" bu hizmete eşli değil — kademe başka bir hizmet kalemine bağlı.`, { code: "SERVICE_TIER_ITEM_MISMATCH" });
  }
}

type Row = { id: string; price: Prisma.Decimal; priceUnit: ServiceQtyUnit | null; validFrom: Date | null; revokedAt: Date | null; updatedAt: Date };
const SEL = { id: true, price: true, priceUnit: true, validFrom: true, revokedAt: true, updatedAt: true } as const;

/** Anahtarın AÇIK satırını kilitler ve anahtar durumunu TAZE okur: yürürlükteki R + bekleyen P. */
async function lockKeyState(tx: Tx, key: ItemPriceKey, now: Date): Promise<{ current: Row | null; pending: Row | null }> {
  await tx.$queryRaw`SELECT id FROM item_prices
    WHERE "itemId" IS NOT DISTINCT FROM ${key.itemId}::uuid AND "serviceItemId" IS NOT DISTINCT FROM ${key.serviceItemId}::uuid
      AND "customerId" IS NOT DISTINCT FROM ${key.customerId}::uuid
      AND "propertyValueId" IS NOT DISTINCT FROM ${key.propertyValueId}::uuid
      AND kind::text = ${key.kind} AND currency::text = ${key.currency} AND "revokedAt" IS NULL
    FOR UPDATE`;
  const open = await tx.itemPrice.findFirst({ where: { ...key, ...ACTIVE_ITEM_PRICE }, select: SEL });
  if (!open || !open.validFrom || open.validFrom.getTime() <= now.getTime()) return { current: open, pending: null };
  // Bekleyen var: yürürlükteki satır, damgası bekleyenin başlangıcına kurulmuş olandır.
  // `revokedAt` SÜZÜLMEZ — zamanlanmış damga eşitliğiyle okunur.
  const current = await tx.itemPrice.findFirst({
    where: { ...key, revokedAt: open.validFrom, revokeReason: ITEM_PRICE_REVOKE_REASON.SCHEDULED },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SEL,
  });
  return { current, pending: open };
}

/** Atomik damga: satır beklenen damgadaysa yeni damgaya geçer, değilse 409. */
async function claimStamp(tx: Tx, id: string, expected: Date | null, data: { revokedAt: Date | null; revokeReason: string | null; revokedById: string | null }): Promise<void> {
  // `revokedAt` SÜZÜLMEZ — beklenen damga (açık ya da zamanlanmış) WHERE'in kendisidir.
  const r = await tx.itemPrice.updateMany({ where: { id, revokedAt: expected }, data });
  if (r.count === 0) throw AppError.conflict("Fiyat aynı anda başka bir işlemle değişti — listeyi yenileyip tekrar deneyin.");
}

export interface PriceWriteOutcome {
  row: { id: string; price: Prisma.Decimal };
  /** Damgalanan (değişen) sürüm; ilk tanımda null. */
  previous: { id: string; price: Prisma.Decimal; priceUnit: ServiceQtyUnit | null } | null;
  /** Yerine geçen bekleyen satır (ileri tarihli fiyat değişti/öne çekildi). */
  replacedPending: { id: string; price: Prisma.Decimal } | null;
  priceUnit: ServiceQtyUnit | null;
  wrote: boolean;
}

/**
 * Yeni sürüm yazar (tx içinde). `validFrom` null = hemen geçerli; dolu = ileri tarihli (K4).
 * `requestedUnit === undefined` → birim mevcut sürümden korunur.
 */
export async function writeItemPriceVersionTx(
  tx: Tx,
  args: { key: ItemPriceKey; price: Prisma.Decimal; requestedUnit: ServiceQtyUnit | null | undefined; validFrom: Date | null; at: Date; userId?: string; clientToken?: string | null; expectedUpdatedAt?: Date | null },
): Promise<PriceWriteOutcome> {
  const { key, price, validFrom, at } = args;
  const by = args.userId ?? null;
  await assertPriceSubjectUsable(tx, key, "DEFINITION", tx);
  const { current, pending } = await lockKeyState(tx, key, at);
  // Bayat veri (V5c): sürüm = kilitli yürürlükteki satır; değişim yeni satır/damga olduğundan sürüm ilerler.
  if (args.expectedUpdatedAt) assertRowVersion(current, args.expectedUpdatedAt);
  const priceUnit = args.requestedUnit === undefined ? (pending ?? current)?.priceUnit ?? null : args.requestedUnit;
  const same = (r: Row | null) => !!r && r.price.equals(price) && r.priceUnit === priceUnit;

  if (!validFrom) {
    // Hemen geçerli: bugünkü yol; bekleyen varsa yeni sürüm onun başlangıcında kapanır (zamanlanmış damga).
    if (same(current)) return { row: current!, previous: current, replacedPending: null, priceUnit, wrote: false };
    if (current) {
      await claimStamp(tx, current.id, current.revokedAt, { revokedAt: at, revokeReason: ITEM_PRICE_REVOKE_REASON.CHANGED, revokedById: by });
    }
    const row = await tx.itemPrice.create({
      data: {
        ...key, price, priceUnit, createdAt: at, clientToken: args.clientToken ?? null,
        ...(pending ? { revokedAt: pending.validFrom, revokeReason: ITEM_PRICE_REVOKE_REASON.SCHEDULED } : {}),
      },
      select: { id: true, price: true },
    });
    return { row, previous: current, replacedPending: null, priceUnit, wrote: true };
  }

  // İleri tarihli: aynı başlangıç + aynı fiyattaki bekleyen ya da (bekleyen yokken) aynı fiyattaki yürürlükteki → no-op.
  if (pending ? same(pending) && pending.validFrom!.getTime() === validFrom.getTime() : same(current)) {
    const r = (pending ?? current)!;
    return { row: r, previous: r, replacedPending: null, priceUnit, wrote: false };
  }
  if (pending) {
    // Eski bekleyen hiç yürürlüğe girmeden kapanır: [validFrom, şimdi) boş pencere.
    await claimStamp(tx, pending.id, null, { revokedAt: at, revokeReason: ITEM_PRICE_REVOKE_REASON.CHANGED, revokedById: by });
  }
  if (current) {
    await claimStamp(tx, current.id, current.revokedAt, { revokedAt: validFrom, revokeReason: ITEM_PRICE_REVOKE_REASON.SCHEDULED, revokedById: by });
  }
  const row = await tx.itemPrice.create({ data: { ...key, price, priceUnit, createdAt: at, validFrom, clientToken: args.clientToken ?? null }, select: { id: true, price: true } });
  return { row, previous: current, replacedPending: pending, priceUnit, wrote: true };
}

/**
 * Kaldırma (tx içinde). Bekleyen kaldırılınca önceki sürümün zamanlanmış damgası GERİ ALINIR
 * (henüz olmamış bir niyetti); yürürlükteki zamanlanmış satır kaldırılınca damgası bugüne çekilir.
 * Dönen `restoredId`: damgası geri alınan sürüm.
 */
async function removeItemPriceTx(tx: Tx, id: string, at: Date, userId?: string): Promise<{ row: Row & ItemPriceKey; restoredId: string | null }> {
  // `revokedAt` SÜZÜLMEZ — satırın kendisi okunur: yoksa 404, geçmişte damgalıysa 409.
  const row = await tx.itemPrice.findUnique({ where: { id }, select: { ...SEL, itemId: true, serviceItemId: true, customerId: true, propertyValueId: true, kind: true, currency: true } });
  if (!row) throw AppError.notFound("Fiyat satırı bulunamadı.");
  if (row.revokedAt && row.revokedAt.getTime() <= at.getTime()) throw AppError.conflict("Bu fiyat satırı zaten kaldırılmış.");
  const key: ItemPriceKey = { itemId: row.itemId, serviceItemId: row.serviceItemId, customerId: row.customerId, propertyValueId: row.propertyValueId, kind: row.kind, currency: row.currency };
  const { current, pending } = await lockKeyState(tx, key, at);
  const stamp = { revokedAt: at, revokeReason: ITEM_PRICE_REVOKE_REASON.REMOVED, revokedById: userId ?? null };
  if (pending && pending.id === id) {
    await claimStamp(tx, id, null, stamp);
    if (current) await claimStamp(tx, current.id, pending.validFrom, { revokedAt: null, revokeReason: null, revokedById: null });
    return { row, restoredId: current?.id ?? null };
  }
  if (current?.id !== id) throw AppError.conflict("Fiyat satırı aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin.");
  await claimStamp(tx, id, current.revokedAt, stamp);
  return { row, restoredId: null };
}

/** Kaldırma: tx + audit (tx DIŞINDA, ayak izi). Dönen `restoredId`: zamanlanmış damgası geri alınan sürüm. */
export async function removeItemPrice(id: string, userId?: string): Promise<{ restoredId: string | null }> {
  const { row, restoredId } = await prisma.$transaction((tx) => removeItemPriceTx(tx, id, new Date(), userId));
  void AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "ITEM_PRICE",
    recordId: id,
    oldData: { revokeReason: null },
    newData: {
      itemId: row.itemId,
      ...(row.serviceItemId ? { serviceItemId: row.serviceItemId } : {}),
      customerId: row.customerId,
      propertyValueId: row.propertyValueId,
      kind: row.kind,
      currency: row.currency,
      price: row.price.toString(),
      revokeReason: ITEM_PRICE_REVOKE_REASON.REMOVED,
      ...(restoredId ? { restoredId } : {}),
    },
  });
  return { restoredId };
}
