// =============================================================================
// HİZMET FİYAT TABLOSU — okuma projeksiyonu + yazım girişi (2026-11-06, D4)
// =============================================================================
// Tek ekranda bir hizmetin kademeleri (çeşit değerleri), genel ve müşteriye özel fiyatı, bekleyen ileri
// tarihli fiyatı ve "şu an hangi fiyat uygulanır" kaynağı. Kaynak `pickServicePrice`ten (fatura ile aynı
// sıra — ikinci kopya yok); yazım `itemPriceService` üzerinden (kapılar + zamanlanmış damga orada).
// =============================================================================
import { ItemLifecycleStatus, PriceKind, Prisma, type Currency, type ServiceQtyUnit } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { itemPriceService, type ItemPriceUpsertInput } from "./item-price.service";
import { isItemPricePending, isItemPriceValidAt } from "./helpers/item-price-validity.helper";
import { countServiceTierRows, pickServicePrice, type ServicePriceSource } from "./helpers/service-price-pick.helper";
import { pickServiceItemId } from "./helpers/service-item-pick.helper";
import { priceSubjectId } from "./helpers/item-price-write.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { ITEM_PRICE_REVOKE_REASON } from "./helpers/item-price-validity.helper";
import { kursunMeterPrice, loadCurrentGramPrices } from "./helpers/kursun-gram-price.helper";

export type ServicePriceWriteInput = Omit<ItemPriceUpsertInput, "kind" | "clientToken"> & { clientToken: string };

const ROW = {
  id: true, itemId: true, serviceItemId: true, customerId: true, propertyValueId: true, kind: true, currency: true, price: true, priceUnit: true,
  validFrom: true, createdAt: true, revokedAt: true, revokeReason: true, clientToken: true,
} as const;
type Row = Prisma.ItemPriceGetPayload<{ select: typeof ROW }>;

export interface PriceCell { id: string; price: string; priceUnit: ServiceQtyUnit | null; since: string; until: string | null }
export interface PendingCell { id: string; price: string; priceUnit: ServiceQtyUnit | null; validFrom: string }
export interface PriceSlot { current: PriceCell | null; pending: PendingCell | null }

export interface ServicePriceTierRow {
  valueId: string;
  code: string;
  name: string;
  /** Kurşun gr/m; gramajsız çeşitte null. */
  amount: string | null;
  isActive: boolean;
  /** Değer bugün bu hizmete eşli mi; false = eşleme değişti, satır geçmişten kalıyor (çözücü okumaz). */
  mapped: boolean;
  general: PriceSlot;
  customer: PriceSlot | null;
  /** Bu kademede müşteriye özel güncel fiyat sayısı (genel görünüm). */
  customerOverrideCount: number;
  /** Şu an (gram fiyatı varsa ilk istasyonunkiyle) uygulanacak birim fiyat + kaynağı; fatura çözücüsüyle aynı sıra. */
  effective: { price: string | null; source: ServicePriceSource | null; tierMissing: boolean; gramFormula: string | null };
}

export interface ServicePriceTable {
  /** Kart durumu yalnız GÖSTERİM içindir; kullanılabilirlik kararı `assertItemUsable`da. */
  item: { id: string; code: string; name: string; unit: string; lifecycleStatus: ItemLifecycleStatus };
  currency: Currency;
  customerId: string | null;
  itemPrice: { general: PriceSlot; customer: PriceSlot | null };
  gram: { customer: string | null; stations: Array<{ id: string; name: string; price: string }> };
  hasTiers: boolean;
  tiers: ServicePriceTierRow[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
function slotOf(rows: Row[], now: Date): PriceSlot {
  const cur = rows.find((r) => isItemPriceValidAt(r, now));
  const pen = rows.find((r) => isItemPricePending(r, now));
  return {
    current: cur ? { id: cur.id, price: cur.price.toString(), priceUnit: cur.priceUnit, since: (cur.validFrom ?? cur.createdAt).toISOString(), until: iso(cur.revokedAt) } : null,
    pending: pen ? { id: pen.id, price: pen.price.toString(), priceUnit: pen.priceUnit, validFrom: pen.validFrom!.toISOString() } : null,
  };
}

/** Hizmete eşli değerler: değer → özellik → ana bayrak sırası (`pickServiceItemId` ile aynı), tek sorgu. */
function mappedValueWhere(itemId: string): Prisma.FabricPropertyValueWhereInput {
  return {
    OR: [
      { serviceItemId: itemId },
      { serviceItemId: null, property: { serviceItemId: itemId } },
      { serviceItemId: null, property: { serviceItemId: null, variantOf: { serviceItemId: itemId } } },
    ],
  };
}

export class ServicePriceService {
  /** Sol liste: hizmet kalemleri + güncel kademe satırı sayısı. */
  async listServices(): Promise<ApiResponse<Array<{ id: string; code: string; name: string; unit: string; lifecycleStatus: ItemLifecycleStatus; tierRowCount: number }>>> {
    // Pasif (ARCHIVED) kartlar listenin sonunda; durum yalnız gösterim.
    const rows = await prisma.serviceItem.findMany({ select: { id: true, code: true, name: true, unit: true, lifecycleStatus: true }, orderBy: { code: "asc" } });
    const items = [...rows].sort((a, b) => Number(a.lifecycleStatus === ItemLifecycleStatus.ARCHIVED) - Number(b.lifecycleStatus === ItemLifecycleStatus.ARCHIVED));
    const byItem = await countServiceTierRows(items.map((i) => i.id), new Date());
    return { success: true, data: items.map((i) => ({ ...i, tierRowCount: byItem.get(i.id) ?? 0 })) };
  }

  async table(params: { itemId: string; currency: Currency; customerId: string | null }): Promise<ApiResponse<ServicePriceTable>> {
    const now = new Date();
    const item = await prisma.serviceItem.findUnique({ where: { id: params.itemId }, select: { id: true, code: true, name: true, unit: true, lifecycleStatus: true } });
    // Ürün kartı id'si: tablo yalnız hizmet içindir (400); iki tabloda da yoksa 404.
    if (!item && (await prisma.item.findUnique({ where: { id: params.itemId }, select: { id: true } }))) throw AppError.badRequest("Hizmet fiyat tablosu yalnız hizmet kalemleri içindir.", { code: "SERVICE_TIER_NOT_SERVICE" });
    if (!item) throw AppError.notFound("Hizmet bulunamadı.");
    // `revokedAt` SÜZÜLMEZ — güncel + bekleyen ayrımı bellekte `isItemPriceValidAt` / `isItemPricePending` ile (tek yüklem ikizi).
    const rows = await prisma.itemPrice.findMany({
      where: { serviceItemId: item.id, kind: PriceKind.SALE, currency: params.currency, OR: [{ revokedAt: null }, { revokedAt: { gt: now } }] },
      select: ROW,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const values = await prisma.fabricPropertyValue.findMany({
      where: { OR: [mappedValueWhere(item.id), { id: { in: [...new Set(rows.map((r) => r.propertyValueId).filter((v): v is string => !!v))] } }] },
      select: { id: true, code: true, name: true, amount: true, isActive: true, sortOrder: true, serviceItemId: true, property: { select: { serviceItemId: true, variantOf: { select: { serviceItemId: true } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const { customer: customerGram, stations } = await loadCurrentGramPrices(params.customerId, params.currency);
    const of = (pv: string | null, customer: boolean) => rows.filter((r) => r.propertyValueId === pv && (customer ? r.customerId === params.customerId : r.customerId === null));
    const itemGeneral = slotOf(of(null, false), now);
    const itemCustomer = params.customerId ? slotOf(of(null, true), now) : null;
    const itemPriceNow = itemCustomer?.current ?? itemGeneral.current;
    const hasTiers = rows.some((r) => r.propertyValueId && isItemPriceValidAt(r, now));
    const unit = (u: ServiceQtyUnit | null | undefined) => u ?? "METER";
    const tiers = values.map((v): ServicePriceTierRow => {
      const general = slotOf(of(v.id, false), now);
      const customer = params.customerId ? slotOf(of(v.id, true), now) : null;
      const gramPrice = v.amount ? customerGram ?? stations[0]?.price ?? null : null;
      const gram = v.amount && gramPrice ? { unitPrice: kursunMeterPrice(v.amount, gramPrice), amount: v.amount, owner: customerGram ? ("CUSTOMER" as const) : ("STATION" as const), late: false } : null;
      // Tablo metre işini gösterir: birimi metre olmayan tarife satırı (brode adet/vuruş) yine kendi biriminde fiyattır.
      const pick = pickServicePrice({
        customerTier: customer?.current ? new Prisma.Decimal(customer.current.price) : null,
        generalTier: general.current ? new Prisma.Decimal(general.current.price) : null,
        gram: unit(customer?.current?.priceUnit ?? general.current?.priceUnit) === "METER" ? gram : null,
        item: itemPriceNow ? new Prisma.Decimal(itemPriceNow.price) : null,
        itemHasTiers: hasTiers,
        valueInTable: !!(general.current || customer?.current),
      });
      return {
        valueId: v.id, code: v.code, name: v.name, amount: v.amount?.toString() ?? null, isActive: v.isActive,
        mapped: pickServiceItemId({ value: v.serviceItemId, property: v.property.serviceItemId, parentFlag: v.property.variantOf?.serviceItemId }) === item.id,
        general, customer,
        customerOverrideCount: rows.filter((r) => r.propertyValueId === v.id && r.customerId !== null && isItemPriceValidAt(r, now)).length,
        effective: {
          price: pick.unitPrice?.toString() ?? null, source: pick.source, tierMissing: pick.tierMissing,
          gramFormula: pick.gram && gramPrice ? `${v.amount!.toString()} × ${gramPrice.toString()}` : null,
        },
      };
    });
    return {
      success: true,
      data: {
        item: { id: item.id, code: item.code, name: item.name, unit: item.unit, lifecycleStatus: item.lifecycleStatus },
        currency: params.currency, customerId: params.customerId,
        itemPrice: { general: itemGeneral, customer: itemCustomer },
        gram: { customer: customerGram?.toString() ?? null, stations: stations.map((s) => ({ id: s.id, name: s.name, price: s.price.toString() })) },
        hasTiers, tiers,
      },
    };
  }

  /** Geçmiş çekmecesi: bir hizmetin (isteğe bağlı kademe/müşteri) bütün sürümleri, yeniden eskiye. */
  async history(params: { itemId: string; currency: Currency; customerId?: string | null; propertyValueId?: string | null }) {
    // `revokedAt` SÜZÜLMEZ — geçmiş görünümü damgalı sürümleri de listeler.
    const rows = await prisma.itemPrice.findMany({
      where: {
        serviceItemId: params.itemId, kind: PriceKind.SALE, currency: params.currency,
        ...(params.customerId !== undefined ? { customerId: params.customerId } : {}),
        ...(params.propertyValueId !== undefined ? { propertyValueId: params.propertyValueId } : {}),
      },
      select: { ...ROW, propertyValue: { select: { name: true } }, customer: { select: { code: true, name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });
    const now = new Date();
    return {
      success: true,
      data: rows.map((r) => ({
        id: r.id, price: r.price.toString(), priceUnit: r.priceUnit, propertyValueId: r.propertyValueId, tierName: r.propertyValue?.name ?? null,
        customerId: r.customerId, customerName: r.customer?.name ?? null,
        validFrom: (r.validFrom ?? r.createdAt).toISOString(), until: iso(r.revokedAt), revokeReason: r.revokeReason, createdAt: r.createdAt.toISOString(),
        state: isItemPricePending(r, now) ? "PENDING" : isItemPriceValidAt(r, now) ? (r.revokedAt ? "SCHEDULED" : "ACTIVE") : "CLOSED",
      })),
    };
  }

  /** Yazım girişi — idempotent (R kipi): aynı token aynı yükle yeniden gelirse ilk kayıt döner. */
  async write(input: ServicePriceWriteInput, userId?: string) {
    return writeReplay(input).run(input.clientToken, () => itemPriceService.upsert({ ...input, kind: PriceKind.SALE }, userId));
  }

  async revoke(id: string, userId?: string) {
    return itemPriceService.remove(id, userId);
  }
}

const writeReplay = (input: ServicePriceWriteInput) =>
  tokenReplay<Row, Awaited<ReturnType<typeof itemPriceService.upsert>>>({
    // `revokedAt` SÜZÜLMEZ — token'ın kaydı hangi durumda olursa olsun okunur (4. durum `alive`da).
    find: (db, clientToken) => db.itemPrice.findUnique({ where: { clientToken }, select: ROW }),
    alive: (prior) => {
      if (prior.revokeReason !== ITEM_PRICE_REVOKE_REASON.REMOVED) return;
      throw AppError.conflict("Bu fiyat kaydedilmiş ama sonra KALDIRILMIŞ — yeniden girmek için tabloyu yenileyin.", { code: "ITEM_PRICE_REMOVED", id: prior.id });
    },
    identity: (prior) => [
      { ad: "itemId", mevcut: priceSubjectId(prior), gelen: input.itemId },
      { ad: "customerId", mevcut: prior.customerId, gelen: input.customerId ?? null },
      { ad: "propertyValueId", mevcut: prior.propertyValueId, gelen: input.propertyValueId ?? null },
      { ad: "currency", mevcut: prior.currency, gelen: input.currency },
      { ad: "price", mevcut: prior.price.toString(), gelen: new Prisma.Decimal(input.price).toDecimalPlaces(4).toString() },
      { ad: "validFrom", mevcut: iso(prior.validFrom), gelen: iso(input.validFrom ?? null) },
    ],
    collision: "Bu istemci anahtarı FARKLI bir fiyat için kullanılmış. Tabloyu yenileyip yeniden girin.",
    collisionEk: (prior) => ({ id: prior.id }),
    respond: (prior) => ({
      success: true,
      data: {
        id: prior.id, price: prior.price, source: prior.customerId ? "CUSTOMER" : "DEFAULT", customerId: prior.customerId, priceUnit: prior.priceUnit,
        created: false, propertyValueId: prior.propertyValueId, validFrom: prior.validFrom,
      },
      message: "Fiyat zaten kaydedilmiş.",
    }),
  });

export const servicePriceService = new ServicePriceService();
