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
import { Prisma, PriceKind, Currency } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { buildWhereClause, buildTurkishSearch, isEnumMember, readIdCondition } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";
import { assertItemUsable, assertItemUsableTx } from "./helpers/item-usage.helper";
import { ACTIVE_ITEM_PRICE, ITEM_PRICE_REVOKE_REASON, itemPriceValidAt } from "./helpers/item-price-validity.helper";


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
}

export interface ResolveItemPriceParams {
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
  itemId: string;
  /** `null`/atlanmış = KART VARSAYILANI. */
  customerId?: string | null;
  kind: PriceKind;
  currency: Currency;
  price: Prisma.Decimal.Value;
}

/**
 * `Decimal(14,4)` sınırı — 14 basamağın 4'ü ondalık, yani **10 tam hane**:
 * `9999999999.9999`.
 *
 * Sınırı BURADA kontrol etmenin sebebi: aşan değer DB'de `numeric field
 * overflow` ile düşer ve kullanıcı "22P03" gibi bir mesaj görür. Ondalık
 * fazlası ise sessizce YUVARLANIR — o yüzden yuvarlamayı da biz yapıp
 * kaydedilen değerin ne olduğunu deterministik hale getiriyoruz.
 *
 * ⚠️ SABİT KOLONUN GERÇEK SINIRI OLMALI, "yeterince büyük" bir sayı değil.
 * İlk yazımda bir hane eksikti (`999999999.9999`) ve guard, DB'nin KABUL
 * EDECEĞİ bir değeri 400 ile reddediyordu: kullanıcıya "çok büyük" denen ama
 * aslında sığan bir fiyat, sebebi hiçbir yerde yazmayan bir sahte hatadır.
 * Kolonun hassasiyeti değişirse (migration) burası da değişir.
 */
const MAX_PRICE = new Prisma.Decimal("9999999999.9999");

/**
 * Girilen fiyatı doğrular ve kolon hassasiyetine indirger.
 *
 * ⚠️ SIFIR MEŞRUDUR (promosyon/numune satırı) — DB CHECK'i de yalnız negatifi
 * reddeder (`item_prices_price_nonneg`). Sıfırı burada engellemek, gerçekten
 * bedava verilen numunenin fiyatını "bilinmiyor" gibi göstermeye zorlardı.
 */
function normalizePrice(value: Prisma.Decimal.Value): Prisma.Decimal {
  let d: Prisma.Decimal;
  try {
    d = new Prisma.Decimal(value);
  } catch {
    throw AppError.badRequest("Fiyat sayı olmalı.");
  }
  if (!d.isFinite()) throw AppError.badRequest("Fiyat sayı olmalı.");
  if (d.lt(0)) throw AppError.badRequest("Fiyat negatif olamaz.");
  // ⚠️ SIRA: önce YUVARLA, sonra sınırı ölç. Ters sırada, sınırın hemen altındaki
  // bir değer (ör. `9999999999.99995`) kontrolü geçer, yuvarlama onu sınırın
  // ÜSTÜNE taşır ve kullanıcı anlaşılır 400 yerine ham `numeric field overflow`
  // görürdü — guard'ın var oluş sebebi tam olarak o mesajı engellemekti.
  const rounded = d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  if (rounded.gt(MAX_PRICE)) throw AppError.badRequest(`Fiyat çok büyük (en fazla ${MAX_PRICE.toString()}).`);
  return rounded;
}

/** Satır seçimi — liste ve çözümleme AYNI şekli döner (ayrışırsa panel iki yerde iki şey görür). */
const ROW_SELECT = {
  id: true,
  itemId: true,
  customerId: true,
  kind: true,
  currency: true,
  price: true,
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
  rows: Array<{ id: string; customerId: string | null; price: Prisma.Decimal }>,
  customerId: string | null,
): ResolvedItemPrice | null {
  if (customerId) {
    const exact = rows.find((r) => r.customerId === customerId);
    if (exact) return { id: exact.id, price: exact.price, source: "CUSTOMER", customerId: exact.customerId };
  }
  const fallback = rows.find((r) => r.customerId === null);
  if (fallback) return { id: fallback.id, price: fallback.price, source: "DEFAULT", customerId: null };
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

  // Damgalı satır ya bugün (aktif) ya o tarihte (pencere) süzülür — ikinci bir yüklem YAZILMAZ.
  const validity: Prisma.ItemPriceWhereInput = params.asOf ? itemPriceValidAt(params.asOf) : ACTIVE_ITEM_PRICE;

  // ⚠️ `customerId` AÇIKÇA yazılır. Prisma'nın `itemId_kind_currency` compound
  // unique'i burada kullanılamaz (dosya başlığındaki "Prisma yalan söyler" notu).
  const rows = await db.itemPrice.findMany({
    where: {
      AND: [
        validity,
        {
          itemId: { in: ids },
          kind: params.kind,
          currency: params.currency,
          ...(customerId ? { OR: [{ customerId }, { customerId: null }] } : { customerId: null }),
        },
      ],
    },
    select: { id: true, itemId: true, customerId: true, price: true },
    // As-of penceresinde aynı anahtara birden çok aday düşebilir: en yeni sürüm
    // kazanır (`pickPrice` ilk eşleşeni alır); `id` eşitlik bozucu ŞART.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const byItem = new Map<string, Array<{ id: string; customerId: string | null; price: Prisma.Decimal }>>();
  for (const r of rows) {
    const list = byItem.get(r.itemId);
    if (list) list.push(r);
    else byItem.set(r.itemId, [r]);
  }
  for (const [itemId, list] of byItem) {
    const picked = pickPrice(list, customerId);
    if (picked) out.set(itemId, picked);
  }
  return out;
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
  }): Promise<{ rows: unknown[]; total: number }> {
    const { itemId, customerId, kind, currency, ...rest } = params.filters;
    const where: Prisma.ItemPriceWhereInput = buildWhereClause(rest as Record<string, string | string[]>);

    const itemCond = readIdCondition(itemId);
    if (itemCond) where.itemId = itemCond;

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
      where.OR = buildTurkishSearch<Prisma.ItemPriceWhereInput>(params.search, ["item.code", "item.name"]);
    }
    const scoped: Prisma.ItemPriceWhereInput = params.includeRevoked ? where : { AND: [where, ACTIVE_ITEM_PRICE] };

    const [rows, total] = await Promise.all([
      prisma.itemPrice.findMany({
        where: scoped,
        select: {
          ...ROW_SELECT,
          item: { select: { id: true, code: true, name: true, unit: true } },
          customer: { select: { id: true, code: true, name: true } },
        },
        // Kart varsayılanı ÖNCE, sonra müşteri istisnaları — ekranda "temel
        // fiyat + sapmalar" olarak okunur. `customerId` nulls-first bunu verir.
        // Geçmişte aynı anahtarın sürümleri yeniden eskiye; `id` sayfa sınırında eşitlik bozucu.
        orderBy: [
          { itemId: "asc" },
          { customerId: { sort: "asc", nulls: "first" } },
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
    return { rows, total };
  }

  /** Çözümleme ucu — panelin fatura/mal kabul satırında çağırdığı yüzey. */
  async resolve(params: {
    itemId: string;
    kind: PriceKind;
    currency: Currency;
    customerId?: string | null;
  }): Promise<ApiResponse<ResolvedItemPrice | null>> {
    const item = await prisma.item.findUnique({ where: { id: params.itemId }, select: { id: true } });
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
  async upsert(input: ItemPriceUpsertInput, userId?: string): Promise<ApiResponse<ResolvedItemPrice & { created: boolean }>> {
    const price = normalizePrice(input.price);
    const customerId = input.customerId ?? null;

    // ── Dış referanslar: var mı + AKTİF mi ────────────────────────────────
    // Fiyat karta yeni TANIM ekler (B) — "Tükenene kadar"/Pasif kartta kapalı.
    await assertItemUsable(prisma, input.itemId, "DEFINITION");

    if (customerId) {
      const cust = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, isActive: true } });
      if (!cust) throw AppError.badRequest("Cari kart bulunamadı.");
      if (!cust.isActive) throw AppError.badRequest(`"${cust.name}" pasif durumda — fiyat istisnası tanımlanamaz.`);
    }

    // Eski sürümün damgası ile yeni sürümün doğumu AYNI an: "şu tarih itibarıyla" her
    // anda en çok bir sürüm geçerli kalsın (pencere `[createdAt, revokedAt)`).
    const at = new Date();
    type Outcome = { row: { id: string; price: Prisma.Decimal }; previous: { id: string; price: Prisma.Decimal } | null; wrote: boolean };
    let outcome: Outcome;
    try {
      outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
        // Müşterili hizmet fiyatı D1 canlı referansıdır: kart FOR SHARE altında yeniden doğrulanır,
        // eşzamanlı pasife alma ya bu satırı sayar ya da bu yazım 409 alır (K3c).
        await assertItemUsableTx(tx, input.itemId, "DEFINITION");
        const current = await tx.itemPrice.findFirst({
          where: { itemId: input.itemId, kind: input.kind, currency: input.currency, customerId, ...ACTIVE_ITEM_PRICE },
          select: { id: true, price: true },
        });
        // Aynı fiyat: sürüm yazılmaz (geçmiş anlamsız tekrarla şişmesin).
        if (current && current.price.equals(price)) return { row: current, previous: current, wrote: false };
        if (current) {
          const claim = await tx.itemPrice.updateMany({
            where: { id: current.id, ...ACTIVE_ITEM_PRICE },
            data: { revokedAt: at, revokedById: userId ?? null, revokeReason: ITEM_PRICE_REVOKE_REASON.CHANGED },
          });
          if (claim.count === 0) {
            throw AppError.conflict("Fiyat aynı anda başka bir işlemle değişti — listeyi yenileyip tekrar deneyin.");
          }
        }
        const row = await tx.itemPrice.create({
          data: { itemId: input.itemId, customerId, kind: input.kind, currency: input.currency, price, createdAt: at },
          select: { id: true, price: true },
        });
        return { row, previous: current, wrote: true };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw AppError.conflict("Bu kalem/müşteri/yön/para birimi için fiyat aynı anda başka bir işlemle yazıldı — listeyi yenileyip tekrar deneyin.");
      }
      // Servis dışından gelen negatif değer DB CHECK'ine takılır (savunma katmanı).
      if (e instanceof Error && /item_prices_price_nonneg/.test(e.message)) {
        throw AppError.badRequest("Fiyat negatif olamaz.");
      }
      throw e;
    }

    const { row, previous, wrote } = outcome;
    const created = previous === null;
    const priceStr = price.toFixed(4);
    const key = { itemId: input.itemId, customerId, kind: input.kind, currency: input.currency };
    if (wrote && previous) {
      void AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ITEM_PRICE",
        recordId: previous.id,
        oldData: { revokeReason: null },
        newData: { ...key, price: previous.price.toFixed(4), revokeReason: ITEM_PRICE_REVOKE_REASON.CHANGED },
      });
    }
    if (wrote) {
      void AuditService.log({
        userId,
        action: "CREATE",
        tableName: "ITEM_PRICE",
        recordId: row.id,
        oldData: previous ? { price: previous.price.toFixed(4) } : null,
        newData: { ...key, price: priceStr },
      });
    }

    return {
      success: true,
      data: {
        id: row.id,
        price: new Prisma.Decimal(row.price),
        source: customerId ? "CUSTOMER" : "DEFAULT",
        customerId,
        created,
      },
      message: created ? "Fiyat tanımlandı." : wrote ? "Fiyat güncellendi." : "Fiyat zaten bu değerde — değişiklik yapılmadı.",
    };
  }

  /**
   * FİYATI KALDIR — satır silinmez, DAMGALANIR (`revokedAt`); geçmiş tarih
   * itibarıyla okunmaya devam eder. Müşteri istisnası kaldırılınca o müşteri
   * KART VARSAYILANINA döner; varsayılan kaldırılınca fiyat "bilinmiyor" olur ve
   * satır BOŞ gelir — sıfıra düşmez.
   */
  async remove(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    // `revokedAt` SÜZÜLMEZ — satırın kendisi okunur: yoksa 404, zaten damgalıysa 409.
    const row = await prisma.itemPrice.findUnique({ where: { id }, select: ROW_SELECT });
    if (!row) throw AppError.notFound("Fiyat satırı bulunamadı.");
    if (row.revokedAt) throw AppError.conflict("Bu fiyat satırı zaten kaldırılmış.");

    const claim = await prisma.itemPrice.updateMany({
      where: { id, ...ACTIVE_ITEM_PRICE },
      data: { revokedAt: new Date(), revokedById: userId ?? null, revokeReason: ITEM_PRICE_REVOKE_REASON.REMOVED },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Fiyat satırı aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin.");
    }

    void AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ITEM_PRICE",
      recordId: id,
      oldData: { revokeReason: null },
      newData: {
        itemId: row.itemId,
        customerId: row.customerId,
        kind: row.kind,
        currency: row.currency,
        price: row.price.toString(),
        revokeReason: ITEM_PRICE_REVOKE_REASON.REMOVED,
      },
    });

    return { success: true, data: { id }, message: "Fiyat satırı kaldırıldı." };
  }
}

export const itemPriceService = new ItemPriceService();
