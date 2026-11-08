// =============================================================================
// KALEM FİYATI — KART VARSAYILANI + MÜŞTERİ İSTİSNASI (Paket D · D2)
// =============================================================================
// NEDEN VAR: Fatura/mal kabul satırında fiyatı her seferinde elle yazmak iki
// şey üretir — sürtünme ve HATA. Müşteriye özel anlaşmalı fiyat ise elle
// yazıldığında "geçen ay 42 yazmıştık, bu ay 45 yazdık" tipiyle sessizce
// kayar ve kimse fark etmez. Fiyat bir AYARDIR: kartın varsayılanı vardır,
// bazı müşterilerin istisnası vardır.
//
// ── ÇÖZÜM SIRASI — TEK KAYNAK, KOPYALANMAZ ───────────────────────────────────
//   müşteri istisnası  >  kart varsayılanı  >  **null**
//
// ⚠️ NULL DÖNMEK MEŞRUDUR ve çağıran onu BOŞ BIRAKIR. Sıfıra ya da uydurma bir
//    değere düşmek YASAK: sıfır fiyat "fiyat bilinmiyor" ile "bedava" arasındaki
//    farkı yok eder ve fatura sessizce sıfır tutarla onaylanabilir hale gelir
//    (`InvoiceService.confirm` sıfır fiyatlı satırı reddediyor — o sed tam da
//    bu yüzden var; buradan sıfır uydurursak sed anlamsız bir hata mesajına
//    dönüşür: "fiyat girin" der ama fiyat GİRİLMİŞ görünür).
//
// ⚠️ Sırayı KOPYALAMA. Tüketiciler `resolveItemPrice` / `resolveItemPricesFor`
//    çağırır. İkinci bir yerde "önce müşteriye bak, yoksa varsayılana" yazmak,
//    ilerideki bir kural değişikliğinde (örn. tarih aralıklı fiyat) iki farklı
//    fiyat üreten iki yüzey demektir ve hangisinin doğru olduğu belge basılana
//    kadar anlaşılmaz.
//
// ── ⚠️⚠️ PRISMA'NIN COMPOUND UNIQUE'İ BURADA YALAN SÖYLER ────────────────────
// Şemada iki `@@unique` var ve Prisma bunlardan `itemId_kind_currency` adlı bir
// "unique lookup" üretir. DB'de o index PARTIAL'dır (`WHERE customerId IS NULL`)
// ama Prisma predicate'i bilmez ve `findUnique({ itemId_kind_currency })`
// sorgusunu `WHERE itemId=? AND kind=? AND currency=?` olarak kurar — yani
// MÜŞTERİYE ÖZEL bir satırı da eşleyebilir. Kart varsayılanını sorarken müşteri
// istisnası dönerdi: hata yok, log yok, yalnız yanlış fiyat.
//
// Bu yüzden bu dosyada okuma her zaman `customerId`i AÇIKÇA yazar
// (`customerId: null` / eşitlik) ve Prisma `upsert`/`findUnique` compound
// lookup'ı KULLANILMAZ (partial index'te `ON CONFLICT` da predicate ister).
//
// ── DAMGALI SÜRÜM (MAL-0b, 2026-10-24 — defter.md ③a) ───────────────────────
// Fiyat satırı silinmez, yerinde ezilmez: değişim = eski satırın `revokedAt`
// damgası + yeni satır, kaldırma = damga; maliyet/teklif fiyatı "şu tarih
// itibarıyla" okur. Okuma yüklemi tek kaynak: `helpers/item-price-validity.helper`.
// =============================================================================
import { Prisma, PriceKind, Currency, type ServiceQtyUnit } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildWhereClause, buildTurkishSearch, isEnumMember, readIdCondition } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";
import {
  assertPriceSubjectUsable, assertTierWritable, normalizePrice, priceSubjectId, removeItemPrice, resolvePriceSubject, writeItemPriceVersionTx, type ItemPriceKey,
} from "./helpers/item-price-write.helper";
import { ACTIVE_ITEM_PRICE, isItemPriceValidAt, itemPriceNow, itemPriceValidAt } from "./helpers/item-price-validity.helper";
import { logItemPriceVersionWrite, requestedPriceUnit } from "./helpers/item-price-audit.helper";


type Db = Prisma.TransactionClient | typeof prisma;

/** Fiyatın nereden geldiği — çağıran bunu kullanıcıya SÖYLEYEBİLSİN diye döner. */
export type PriceSource = "CUSTOMER" | "DEFAULT";

export interface ResolvedItemPrice {
  /** Fiyat satırının id'si — panelin "bu istisnayı düzelt/kaldır" bağı. */
  id: string;
  price: Prisma.Decimal;
  source: PriceSource;
  /** İstisna satırının müşterisi; kart varsayılanında `null`. */
  customerId: string | null;
  /** Hizmet fiyatının birimi; NULL = metre (bugünkü satırlar). Hizmet çözücüsü işin birimiyle karşılaştırır. */
  priceUnit: ServiceQtyUnit | null;
}

export interface ResolveItemPriceParams {
  /** Fiyat konusu: ürün ya da hizmet kartı id'si (UUID ortak uzay; iki kolon birlikte okunur). */
  itemId: string;
  kind: PriceKind;
  currency: Currency;
  /** Yoksa/`null` ise yalnız kart varsayılanı aranır. */
  customerId?: string | null;
  /**
   * "Fiyat şu tarih itibarıyla" — verilirse o anda geçerli sürüm (`itemPriceValidAt`),
   * verilmezse bugün geçerli olan (`ACTIVE_ITEM_PRICE`). Çözüm sırası İKİSİNDE de aynı.
   */
  asOf?: Date;
  /** Transaction içinden çağrılacaksa `tx`; verilmezse global client. */
  db?: Db;
}

export interface ItemPriceUpsertInput {
  /** Fiyat konusu: ürün ya da hizmet kartı id'si — `resolvePriceSubject` hangi kolona yazılacağını çözer. */
  itemId: string;
  /** `null`/atlanmış = KART VARSAYILANI. */
  customerId?: string | null;
  kind: PriceKind;
  currency: Currency;
  price: Prisma.Decimal.Value;
  /** Hizmet fiyatının birimi (brode: METER/PIECE/STITCH); atlanmış = metre. */
  priceUnit?: ServiceQtyUnit | null;
  /** Hizmet kademesi (çeşit değeri); null/atlanmış = kalem geneli. Yalnız SERVICE + SALE + eşli değer. */
  propertyValueId?: string | null;
  /** İleri tarihli fiyatın başlangıcı (K4); null/atlanmış = hemen geçerli. */
  validFrom?: Date | null;
  /** İdempotency (hizmet fiyat tablosu ucu); replay kararı çağıranın `tokenReplay`indedir. */
  clientToken?: string | null;
}

// Fiyat normalizasyonu (`Decimal(14,4)` sınırı) ve yazım tx'i: `helpers/item-price-write.helper`.

/** Satır seçimi — liste ve çözümleme AYNI şekli döner (ayrışırsa panel iki yerde iki şey görür). */
const ROW_SELECT = {
  id: true,
  itemId: true,
  serviceItemId: true,
  customerId: true,
  kind: true,
  currency: true,
  price: true,
  priceUnit: true,
  propertyValueId: true,
  validFrom: true,
  revokedAt: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * ÇÖZÜM SIRASININ TEK UYGULAMA NOKTASI.
 *
 * Saf fonksiyon: aday satırlardan hangisinin kazandığına karar verir. Tekil ve
 * toplu çözümleyici İKİSİ DE burayı çağırır — ayrı yazılsalardı biri müşteri
 * istisnasını, diğeri varsayılanı öne alabilir ve fark yalnız belge basıldığında
 * görülürdü.
 *
 * ⚠️ BEKÇİNİN ERİŞEMEDİĞİ İKİ NOKTA — silmeden önce yerine ne koyduğunu bil
 * (2026-08-14'te negatif sondayla ölçüldü, ikisi de bilinçli derinlik savunması):
 *   ① Aşağıdaki son `return null` bugünkü çağrı yolundan ULAŞILAMAZ:
 *      `resolveItemPricesFor`in WHERE'i yalnız "bu müşteri" ve "varsayılan"
 *      satırlarını getirir, yani eşleşmeyen satır kümesi hiç doğmaz. Burayı
 *      sıfır döndürecek şekilde bozan bir sonda YEŞİL kalır — asıl güvence
 *      "kalem haritada HİÇ YER ALMAZ" davranışındadır.
 *   ② Müşteri kimliği eşleşmesi (`r.customerId === customerId`) ile sorgudaki
 *      `customerId` süzgeci AYNI sızıntıyı iki kez kapatır (başka müşterinin
 *      anlaşmalı fiyatı bu müşteriye uygulanmasın). Tek katmanı bozmak kırmızı
 *      VERMEZ, çünkü diğeri hâlâ doğru cevabı üretir; ikisi birden bozulunca
 *      bekçi 6 kontrolde kırmızı verir.
 */
function pickPrice(
  rows: Array<{ id: string; customerId: string | null; price: Prisma.Decimal; priceUnit: ServiceQtyUnit | null }>,
  customerId: string | null,
): ResolvedItemPrice | null {
  if (customerId) {
    const exact = rows.find((r) => r.customerId === customerId);
    if (exact) return { id: exact.id, price: exact.price, source: "CUSTOMER", customerId: exact.customerId, priceUnit: exact.priceUnit };
  }
  const fallback = rows.find((r) => r.customerId === null);
  if (fallback) return { id: fallback.id, price: fallback.price, source: "DEFAULT", customerId: null, priceUnit: fallback.priceUnit };
  // ⚠️ null: "fiyat bilinmiyor". Sıfır DÖNDÜRME (dosya başlığındaki gerekçe).
  return null;
}

/**
 * Bir kalemin fiyatını çözer. Bulunamazsa **null** döner.
 *
 * Tek sorgu: hem istisna hem varsayılan satırı birlikte çekilir (iki ayrı
 * round-trip yapmak, çağıranın döngü içinde olduğu durumda sorgu sayısını
 * ikiye katlardı).
 */
export async function resolveItemPrice(params: ResolveItemPriceParams): Promise<ResolvedItemPrice | null> {
  const map = await resolveItemPricesFor({
    itemIds: [params.itemId],
    kind: params.kind,
    currency: params.currency,
    customerId: params.customerId ?? null,
    asOf: params.asOf,
    db: params.db,
  });
  return map.get(params.itemId) ?? null;
}

/**
 * TOPLU çözümleme — N kalem için TEK sorgu.
 *
 * ⚠️ Döngü içinde `resolveItemPrice` çağırmak yerine bunu kullan: 20 satırlık
 * bir mal kabul fişi 20 sorgu yerine 1 sorgu koşar (perf kuralı 8/9 ailesi).
 * Fiyatı bulunamayan kalem haritada HİÇ YER ALMAZ — `map.get(id)` `undefined`
 * döner ve çağıran alanı boş bırakır.
 */
export async function resolveItemPricesFor(params: {
  itemIds: string[];
  kind: PriceKind;
  currency: Currency;
  customerId?: string | null;
  /** Bkz. `ResolveItemPriceParams.asOf`. */
  asOf?: Date;
  db?: Db;
}): Promise<Map<string, ResolvedItemPrice>> {
  const out = new Map<string, ResolvedItemPrice>();
  const ids = [...new Set(params.itemIds)].filter(Boolean);
  if (ids.length === 0) return out;

  const db = params.db ?? prisma;
  const customerId = params.customerId ?? null;

  // Damgalı satır ya bugün ya o tarihte (pencere) süzülür — ikinci bir yüklem YAZILMAZ.
  // Bekleyen ileri tarihli satır AÇIKTIR ama yürürlükte değildir: "şu an" da pencereyle okunur.
  const validity: Prisma.ItemPriceWhereInput = params.asOf ? itemPriceValidAt(params.asOf) : itemPriceNow();

  // ⚠️ `customerId` AÇIKÇA yazılır. Prisma'nın `itemId_kind_currency` compound
  // unique'i burada kullanılamaz (dosya başlığındaki "Prisma yalan söyler" notu).
  const rows = await db.itemPrice.findMany({
    where: {
      AND: [
        validity,
        {
          // Konu ürün ya da hizmet kartı: id uzayı ortak, iki kolon birlikte okunur.
          OR: [{ itemId: { in: ids } }, { serviceItemId: { in: ids } }],
          // Kalem geneli: kademe satırı (hizmet fiyat tablosu) yalnız hizmet çözücüsünden okunur.
          propertyValueId: null,
          kind: params.kind,
          currency: params.currency,
        },
        customerId ? { OR: [{ customerId }, { customerId: null }] } : { customerId: null },
      ],
    },
    select: { id: true, itemId: true, serviceItemId: true, customerId: true, price: true, priceUnit: true },
    // As-of penceresinde aynı anahtara birden çok aday düşebilir: en yeni sürüm
    // kazanır (`pickPrice` ilk eşleşeni alır); `id` eşitlik bozucu ŞART.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const byItem = new Map<string, Array<{ id: string; customerId: string | null; price: Prisma.Decimal; priceUnit: ServiceQtyUnit | null }>>();
  for (const r of rows) {
    const subject = priceSubjectId(r);
    const list = byItem.get(subject);
    if (list) list.push(r);
    else byItem.set(subject, [r]);
  }
  for (const [itemId, list] of byItem) {
    const picked = pickPrice(list, customerId);
    if (picked) out.set(itemId, picked);
  }
  return out;
}

/**
 * ÇOK ANLI TOPLU çözüm — N kalem × M an için TEK sorgu (fiyat sürümü her anın KENDİ penceresinden):
 * satırlar anların herhangi birinde geçerli olanlardır; seçim bellekte `isItemPriceValidAt` (Prisma
 * `itemPriceValidAt`in boğaz-ikizi) + `pickPrice` ile, `resolveItemPricesFor`la aynı sıra. Bulunamayan → null.
 */
export async function resolveItemPricesAtMany(params: {
  itemIds: string[];
  kind: PriceKind;
  currency: Currency;
  customerId?: string | null;
  ats: Date[];
  db?: Db;
}): Promise<(itemId: string, at: Date) => ResolvedItemPrice | null> {
  const ids = [...new Set(params.itemIds)].filter(Boolean);
  const ats = [...new Map(params.ats.map((a) => [a.getTime(), a])).values()];
  if (ids.length === 0 || ats.length === 0) return () => null;
  const customerId = params.customerId ?? null;
  const rows = await (params.db ?? prisma).itemPrice.findMany({
    where: {
      AND: [
        { OR: ats.map((a) => itemPriceValidAt(a)) },
        { OR: [{ itemId: { in: ids } }, { serviceItemId: { in: ids } }], propertyValueId: null, kind: params.kind, currency: params.currency },
        customerId ? { OR: [{ customerId }, { customerId: null }] } : { customerId: null },
      ],
    },
    select: { id: true, itemId: true, serviceItemId: true, customerId: true, price: true, priceUnit: true, createdAt: true, validFrom: true, revokedAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return (itemId, at) => pickPrice(rows.filter((r) => priceSubjectId(r) === itemId && isItemPriceValidAt(r, at)), customerId);
}

export class ItemPriceService {
  /**
   * Fiyat listesi. Filtreler jenerik `buildWhereClause` yolundan geçer; id
   * filtreleri `readIdCondition` ile okunur (CSV çoklu seçim → `in`; ham CSV
   * uuid kolonuna giderse P2007/400 üretirdi — 2026-08-06 kuralı).
   *
   * Varsayılan YALNIZ aktif satırlar (eski istemci aynı listeyi görür);
   * `includeRevoked` damgalı geçmişi de getirir — satırlar, sayım ve sayfa AYNI where'den.
   */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
    includeRevoked?: boolean;
    /** Kademe (hizmet fiyat tablosu) satırları da gelsin; varsayılan YALNIZ kalem geneli (eski panel bozulmasın). */
    includeTiers?: boolean;
  }): Promise<{ rows: unknown[]; total: number }> {
    const { itemId, customerId, kind, currency, propertyValueId, ...rest } = params.filters;
    const where: Prisma.ItemPriceWhereInput = buildWhereClause(rest as Record<string, string | string[]>);

    // `filter[itemId]` konu kimliğidir (ürün ya da hizmet) — iki kolon birlikte süzülür.
    const itemCond = readIdCondition(itemId);
    const subjectWhere: Prisma.ItemPriceWhereInput | null = itemCond ? { OR: [{ itemId: itemCond }, { serviceItemId: itemCond }] } : null;

    // ⚠️ `customerId=null` (metin) = "kart varsayılanları" filtresi. Jenerik yol
    // bunu "null" STRİNGİ olarak uuid kolonuna gönderir ve P2007/400 verirdi.
    if (typeof customerId === "string" && (customerId === "null" || customerId === "default")) {
      where.customerId = null;
    } else {
      const custCond = readIdCondition(customerId);
      if (custCond) where.customerId = custCond;
    }

    // ⚠️ `kind in PriceKind` YAZMA — `in` prototip zincirini tarar ve
    // `filter[kind]=toString` bu ALLOWLIST'i geçip `where.kind = "toString"`
    // olarak Prisma'ya giderdi (jenerik "Geçersiz veri yapısı" 400'ü).
    if (typeof kind === "string" && isEnumMember(PriceKind, kind)) where.kind = kind;
    if (typeof currency === "string" && isEnumMember(Currency, currency)) where.currency = currency;

    // ⚠️ Düz `mode:"insensitive"` (ILIKE) Türkçe çiftlerini KATLAMAZ — adlar
    // BÜYÜK saklandığı için "patos" araması sessizce boş dönerdi. Ortak yardımcı
    // ASCII + Türkçe varyantlarını birlikte kurar.
    if (params.search?.trim()) {
      where.OR = buildTurkishSearch<Prisma.ItemPriceWhereInput>(params.search, ["item.code", "item.name", "serviceItem.code", "serviceItem.name"]);
    }
    const pvCond = params.includeTiers ? readIdCondition(propertyValueId) : undefined;
    if (!params.includeTiers) where.propertyValueId = null;
    else if (pvCond) where.propertyValueId = pvCond;
    // Varsayılan "şu an yürürlükte" (bekleyen ileri tarihli satır değil); `includeRevoked` hepsini döner.
    const base: Prisma.ItemPriceWhereInput = subjectWhere ? { AND: [where, subjectWhere] } : where;
    const scoped: Prisma.ItemPriceWhereInput = params.includeRevoked ? base : { AND: [base, itemPriceNow()] };

    const [rows, total] = await Promise.all([
      prisma.itemPrice.findMany({
        where: scoped,
        select: {
          ...ROW_SELECT,
          item: { select: { id: true, code: true, name: true, unit: true } },
          serviceItem: { select: { id: true, code: true, name: true, unit: true } },
          customer: { select: { id: true, code: true, name: true } },
        },
        // Kart varsayılanı ÖNCE, sonra müşteri istisnaları — ekranda "temel
        // fiyat + sapmalar" olarak okunur. `customerId` nulls-first bunu verir.
        // Geçmişte aynı anahtarın sürümleri yeniden eskiye; `id` sayfa sınırında eşitlik bozucu.
        orderBy: [
          { itemId: { sort: "asc", nulls: "last" } },
          { serviceItemId: { sort: "asc", nulls: "last" } },
          { customerId: { sort: "asc", nulls: "first" } },
          { propertyValueId: { sort: "asc", nulls: "first" } },
          { kind: "asc" },
          { currency: "asc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.itemPrice.count({ where: scoped }),
    ]);
    // Liste şekli korunur: `itemId`/`item` konu kartıdır (hizmette `service_items` satırı); `serviceItemId` ayrıca döner.
    return { rows: rows.map(({ serviceItem, ...r }) => ({ ...r, itemId: priceSubjectId(r), item: r.item ?? serviceItem })), total };
  }

  /** Çözümleme ucu — panelin fatura/mal kabul satırında çağırdığı yüzey. */
  async resolve(params: {
    itemId: string;
    kind: PriceKind;
    currency: Currency;
    customerId?: string | null;
  }): Promise<ApiResponse<ResolvedItemPrice | null>> {
    const item = (await prisma.item.findUnique({ where: { id: params.itemId }, select: { id: true } }))
      ?? (await prisma.serviceItem.findUnique({ where: { id: params.itemId }, select: { id: true } }));
    if (!item) throw AppError.notFound("Kalem bulunamadı.");

    const hit = await resolveItemPrice(params);
    return {
      success: true,
      data: hit,
      // ⚠️ Mesaj "0 TL" DEMEZ — bulunamadı bulunamadıdır.
      message: hit
        ? hit.source === "CUSTOMER"
          ? "Müşteriye özel fiyat uygulandı."
          : "Kart varsayılanı uygulandı."
        : "Tanımlı fiyat yok — fiyatı elle girin.",
    };
  }

  /**
   * FİYAT DEĞİŞTİR — aktif sürüm yoksa açar, aynı fiyatsa dokunmaz, farklıysa
   * eski sürümü DAMGALAR ve yeni sürümü yazar (TEK tx; yerinde ezme YOK).
   *
   * ⚠️ Prisma `upsert` YOK: lookup compound unique ister ve iki index DB'de
   * PARTIAL'dır (dosya başlığı). Eşzamanlılık iki sedle kapalı: eski sürümün
   * damgası atomik claim'dir (`updateMany WHERE {id, revokedAt: null}`,
   * `count===0 → 409`) ve aynı anahtara ikinci AKTİF satır partial unique'e
   * çarpar (P2002 → 409). P2002 YUTULMAZ — sessizce yenmek iki varsayılanın
   * yaşadığı duruma göz yummak olurdu.
   */
  async upsert(input: ItemPriceUpsertInput, userId?: string): Promise<ApiResponse<ResolvedItemPrice & { created: boolean; propertyValueId: string | null; validFrom: Date | null }>> {
    const price = normalizePrice(input.price);
    const customerId = input.customerId ?? null;
    const propertyValueId = input.propertyValueId ?? null;
    const validFrom = input.validFrom ?? null;
    const requestedUnit = requestedPriceUnit(input.priceUnit); // undefined = mevcut sürümün birimi korunur

    // ── Dış referanslar: var mı + AKTİF mi ────────────────────────────────
    // Fiyat karta yeni TANIM ekler (B) — "Tükenene kadar"/Pasif kartta kapalı.
    const subject = await resolvePriceSubject(prisma, input.itemId);
    await assertPriceSubjectUsable(prisma, subject, "DEFINITION");
    if (customerId) {
      const cust = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, isActive: true } });
      if (!cust) throw AppError.badRequest("Cari kart bulunamadı.");
      if (!cust.isActive) throw AppError.badRequest(`"${cust.name}" pasif durumda — fiyat istisnası tanımlanamaz.`);
    }
    // Eski sürümün damgası ile yeni sürümün doğumu AYNI an (pencereler örtüşmez).
    const at = new Date();
    await assertTierWritable(prisma, { ...subject, propertyValueId, kind: input.kind, validFrom }, at);
    const key: ItemPriceKey = { ...subject, customerId, propertyValueId, kind: input.kind, currency: input.currency };
    let outcome: Awaited<ReturnType<typeof writeItemPriceVersionTx>>;
    try {
      outcome = await prisma.$transaction((tx) => writeItemPriceVersionTx(tx, { key, price, requestedUnit, validFrom, at, userId, clientToken: input.clientToken }));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw AppError.conflict("Bu kalem/müşteri/yön/para birimi için fiyat aynı anda başka bir işlemle yazıldı — listeyi yenileyip tekrar deneyin.");
      }
      // Servis dışından gelen negatif değer DB CHECK'ine takılır (savunma katmanı).
      if (e instanceof Error && /item_prices_price_nonneg/.test(e.message)) throw AppError.badRequest("Fiyat negatif olamaz.");
      throw e;
    }

    const { row, previous, replacedPending, priceUnit, wrote } = outcome;
    const created = previous === null && replacedPending === null;
    if (wrote) logItemPriceVersionWrite({ userId, key, rowId: row.id, previous, replacedPending, price, priceUnit, validFrom });
    return {
      success: true,
      data: { id: row.id, price: new Prisma.Decimal(row.price), source: customerId ? "CUSTOMER" : "DEFAULT", customerId, priceUnit, created, propertyValueId, validFrom },
      message: !wrote ? "Fiyat zaten bu değerde — değişiklik yapılmadı." : validFrom ? "İleri tarihli fiyat kaydedildi." : created ? "Fiyat tanımlandı." : "Fiyat güncellendi.",
    };
  }

  /**
   * FİYATI KALDIR — satır silinmez, DAMGALANIR (`revokedAt`); geçmiş tarih
   * itibarıyla okunmaya devam eder. Müşteri istisnası kaldırılınca o müşteri
   * KART VARSAYILANINA döner; varsayılan kaldırılınca fiyat "bilinmiyor" olur ve
   * satır BOŞ gelir — sıfıra düşmez.
   */
  async remove(id: string, userId?: string): Promise<ApiResponse<{ id: string; restoredId: string | null }>> {
    const { restoredId } = await removeItemPrice(id, userId);
    return { success: true, data: { id, restoredId }, message: restoredId ? "İleri tarihli fiyat kaldırıldı; önceki fiyat geçerli kalır." : "Fiyat satırı kaldırıldı." };
  }

  /** Toplu açılış aktarımı okuyucuları — `itemPrice` delegesinin tek sahibi bu dosya (`test_item_price_surum` §7e). */
  findActiveSale(key: { serviceItemId: string; customerId: string; currency: Currency }) {
    return prisma.itemPrice.findFirst({ where: { AND: [{ ...key, propertyValueId: null, kind: PriceKind.SALE }, itemPriceNow()] }, select: { id: true, price: true } });
  }
  listActiveCustomerServicePrices() {
    const select = { price: true, currency: true, customer: { select: { code: true } }, serviceItem: { select: { code: true, unit: true } } };
    return prisma.itemPrice.findMany({
      where: { AND: [{ kind: PriceKind.SALE, customerId: { not: null }, propertyValueId: null, serviceItemId: { not: null } }, itemPriceNow()] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select,
    });
  }
  /** Aktif sürüm anahtarı; damgalı (sonradan değişmiş/kaldırılmış) ya da yok → null. */
  findActiveKey(id: string) {
    return prisma.itemPrice
      .findFirst({ where: { id, ...ACTIVE_ITEM_PRICE }, select: { itemId: true, serviceItemId: true, customerId: true, currency: true } })
      .then((r) => (r ? { itemId: priceSubjectId(r), customerId: r.customerId, currency: r.currency } : null));
  }
}

export const itemPriceService = new ItemPriceService();
