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
// Bu yüzden bu dosyada:
//   • okuma her zaman `customerId`i AÇIKÇA yazar (`customerId: null` / eşitlik),
//   • yazma Prisma `upsert` DEĞİL, doğru partial index'i TANIMIYLA (predicate
//     ile) çıkaran ham SQL `ON CONFLICT (...) WHERE ...` ile yapılır — `upsert`
//     metodunun başındaki uzun nota bak.
//
// ── SOFT DELETE YOK, BİLİNÇLİ ────────────────────────────────────────────────
// `ItemPrice`'ta `isActive` kolonu YOKTUR ve eklenmedi. Fiyat satırı bir DEFTER
// KAYDI değil bir AYARDIR; geçmiş belgeler etkilenmez çünkü fatura satırı
// fiyatı KENDİ kolonunda (`InvoiceLine.unitPrice`) dondurur ve mal kabul topu
// `Roll.purchasePrice`e yazar. Pasif fiyat satırı "var ama uygulanmıyor" gibi
// üçüncü bir durum yaratır ve yukarıdaki iki adımlık çözüm sırasını üçe
// çıkarırdı. Silme bu yüzden FİZİKSELDİR (CLAUDE.md'nin bilinçli istisnaları).
// =============================================================================
import { Prisma, PriceKind, Currency } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { buildWhereClause, buildTurkishSearch, isEnumMember, readIdCondition } from "../utils/query-parser";
import type { ApiResponse } from "../types/api.types";

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
  db?: Db;
}): Promise<Map<string, ResolvedItemPrice>> {
  const out = new Map<string, ResolvedItemPrice>();
  const ids = [...new Set(params.itemIds)].filter(Boolean);
  if (ids.length === 0) return out;

  const db = params.db ?? prisma;
  const customerId = params.customerId ?? null;

  // ⚠️ `customerId` AÇIKÇA yazılır. Prisma'nın `itemId_kind_currency` compound
  // unique'i burada kullanılamaz (dosya başlığındaki "Prisma yalan söyler" notu).
  const rows = await db.itemPrice.findMany({
    where: {
      itemId: { in: ids },
      kind: params.kind,
      currency: params.currency,
      ...(customerId ? { OR: [{ customerId }, { customerId: null }] } : { customerId: null }),
    },
    select: { id: true, itemId: true, customerId: true, price: true },
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
   */
  async list(params: {
    page: number;
    pageSize: number;
    filters: Record<string, string | string[]>;
    search?: string;
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

    const [rows, total] = await Promise.all([
      prisma.itemPrice.findMany({
        where,
        select: {
          ...ROW_SELECT,
          item: { select: { id: true, code: true, name: true, unit: true } },
          customer: { select: { id: true, code: true, name: true } },
        },
        // Kart varsayılanı ÖNCE, sonra müşteri istisnaları — ekranda "temel
        // fiyat + sapmalar" olarak okunur. `customerId` nulls-first bunu verir.
        orderBy: [{ itemId: "asc" }, { customerId: { sort: "asc", nulls: "first" } }, { kind: "asc" }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.itemPrice.count({ where }),
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
   * Fiyat satırını YAZAR (yoksa açar, varsa günceller).
   *
   * ── ⚠️ NEDEN PRISMA `upsert` DEĞİL, HAM SQL ─────────────────────────────────
   * Prisma'nın `upsert`i bir unique lookup ister ve elimizdeki iki unique DB'de
   * PARTIAL'dır. Prisma predicate'i bilmediği için `itemId_kind_currency`
   * lookup'ı müşteriye özel bir satırı da eşleyebilir → kart varsayılanını
   * yazarken müşteri istisnasının ÜSTÜNE yazardık (hata yok, log yok).
   *
   * `INSERT ... ON CONFLICT (kolonlar) WHERE <index_predicate> DO UPDATE`
   * doğru partial index'i ADIYLA değil TANIMIYLA çıkarır ve işlemi TEK ifadede
   * atomik yapar — `findFirst → if → create/update` (check-then-act) iki
   * eşzamanlı yazımda P2002'ye düşerdi.
   *
   * ⚠️ P2002/23505 YUTULMAZ: buraya düşen bir çakışma "beklenmedik ikinci
   * satır" demektir ve sessizce yenmek, iki varsayılanın DB'de yaşadığı
   * duruma göz yummak olurdu. Anlamlı 409'a çevrilir.
   */
  async upsert(input: ItemPriceUpsertInput, userId?: string): Promise<ApiResponse<ResolvedItemPrice & { created: boolean }>> {
    const price = normalizePrice(input.price);
    const customerId = input.customerId ?? null;

    // ── Dış referanslar: var mı + AKTİF mi ────────────────────────────────
    const item = await prisma.item.findUnique({ where: { id: input.itemId }, select: { id: true, name: true, isActive: true } });
    if (!item) throw AppError.badRequest("Kalem bulunamadı.");
    if (!item.isActive) throw AppError.badRequest(`"${item.name}" pasif durumda — fiyat tanımlanamaz.`);

    if (customerId) {
      const cust = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, isActive: true } });
      if (!cust) throw AppError.badRequest("Cari kart bulunamadı.");
      if (!cust.isActive) throw AppError.badRequest(`"${cust.name}" pasif durumda — fiyat istisnası tanımlanamaz.`);
    }

    // Audit `oldData` için önceki değer. ⚠️ Bu bir check-then-act DEĞİLDİR:
    // kararı aşağıdaki tek atomik ifade verir, burası yalnız "neydi" bilgisidir.
    const before = await prisma.itemPrice.findFirst({
      where: { itemId: input.itemId, kind: input.kind, currency: input.currency, customerId },
      select: { id: true, price: true },
    });

    const id = randomUUID();
    const priceStr = price.toFixed(4);

    // ⚠️ `price` HAM SQL'den `Prisma.Decimal` OLARAK GELMEYEBİLİR (sürücü
    // `numeric`i string döndürebilir) — bu yüzden tip `unknown` ve dönüşüm
    // `String(...)` üzerinden yapılır. `Prisma.Decimal` diye tiplemek derlemede
    // yeşil, çalışma zamanında `.plus is not a function` demekti.
    type RawUpsertRow = { id: string; price: unknown; inserted: boolean };
    let rows: RawUpsertRow[];
    try {
      rows = customerId
        ? await prisma.$queryRaw<RawUpsertRow[]>`
            INSERT INTO "item_prices" ("id", "itemId", "customerId", "kind", "currency", "price", "createdAt", "updatedAt")
            VALUES (
              ${id}::uuid, ${input.itemId}::uuid, ${customerId}::uuid,
              ${input.kind}::text::"PriceKind", ${input.currency}::text::"Currency",
              ${priceStr}::numeric, now(), now() -- tz-ok: item_prices.createdAt/updatedAt timestamptz, oturum UTC
            )
            ON CONFLICT ("itemId", "customerId", "kind", "currency") WHERE "customerId" IS NOT NULL
            DO UPDATE SET "price" = EXCLUDED."price", "updatedAt" = now() -- tz-ok: item_prices.updatedAt timestamptz, oturum UTC
            RETURNING "id", "price", ("item_prices".xmax = 0) AS inserted
          `
        : await prisma.$queryRaw<RawUpsertRow[]>`
            INSERT INTO "item_prices" ("id", "itemId", "customerId", "kind", "currency", "price", "createdAt", "updatedAt")
            VALUES (
              ${id}::uuid, ${input.itemId}::uuid, NULL,
              ${input.kind}::text::"PriceKind", ${input.currency}::text::"Currency",
              ${priceStr}::numeric, now(), now() -- tz-ok: item_prices.createdAt/updatedAt timestamptz, oturum UTC
            )
            ON CONFLICT ("itemId", "kind", "currency") WHERE "customerId" IS NULL
            DO UPDATE SET "price" = EXCLUDED."price", "updatedAt" = now() -- tz-ok: item_prices.updatedAt timestamptz, oturum UTC
            RETURNING "id", "price", ("item_prices".xmax = 0) AS inserted
          `;
    } catch (e) {
      // ⚠️ HAM SORGUDA HATA KODU P2002 GELMEZ. Prisma, $queryRaw içinden çıkan
      // DB hatalarını P2010 ("Raw query failed") ile sarar ve gerçek SQLSTATE'i
      // yalnız MESAJA yazar (ölçüldü: "Raw query failed. Code: 23505"). Yalnız
      // P2002'ye bakan bir dal bu yüzden ÖLÜDÜR — buradaki niyet ("çakışma
      // anlamlı 409'a çevrilir") sessizce çalışmaz ve kullanıcı ham 500 görürdü.
      // İki koşul birlikte tutulur: ORM yoluna dönülürse P2002 de yakalanır.
      const msg = e instanceof Error ? e.message : "";
      if (
        (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") ||
        /\b23505\b|duplicate key|item_price_(default|customer)_uq/.test(msg)
      ) {
        throw AppError.conflict("Bu kalem/müşteri/yön/para birimi için zaten bir fiyat satırı var.");
      }
      // Ham SQL yolunda negatif fiyat DB CHECK'ine takılır (savunma katmanı:
      // `normalizePrice` zaten reddediyor, ama servis dışından çağrı olabilir).
      if (/item_prices_price_nonneg/.test(msg)) {
        throw AppError.badRequest("Fiyat negatif olamaz.");
      }
      throw e;
    }

    const row = rows[0];
    if (!row) throw AppError.internal("Fiyat satırı yazılamadı.");

    // `xmax = 0` → satır bu ifadede DOĞDU (Postgres deyimi). ON CONFLICT DO
    // UPDATE dalında xmax kilitleyen transaction'ın xid'idir, yani sıfır değil.
    // Audit eylemini önceki okumadan türetmek yarışa açıktı; kaynak buradaki
    // ifadenin KENDİ sonucudur.
    const created = row.inserted === true;
    const writtenPrice = new Prisma.Decimal(String(row.price));

    void AuditService.log({
      userId,
      action: created ? "CREATE" : "UPDATE",
      tableName: "ITEM_PRICE",
      recordId: row.id,
      oldData: before ? { price: before.price.toString() } : null,
      newData: {
        itemId: input.itemId,
        customerId,
        kind: input.kind,
        currency: input.currency,
        price: priceStr,
      },
    });

    return {
      success: true,
      data: {
        id: row.id,
        price: writtenPrice,
        source: customerId ? "CUSTOMER" : "DEFAULT",
        customerId,
        created,
      },
      message: created ? "Fiyat tanımlandı." : "Fiyat güncellendi.",
    };
  }

  /**
   * Fiyat satırını KALDIRIR (fiziksel).
   *
   * ⚠️ Geçmiş belgeler etkilenmez — fatura satırı fiyatı kendi kolonunda
   * dondurur (dosya başlığındaki "soft delete yok" notu). Müşteri istisnası
   * kaldırıldığında o müşteri KART VARSAYILANINA döner; varsayılan
   * kaldırıldığında fiyat "bilinmiyor" olur ve satır BOŞ gelir — sıfıra
   * düşmez.
   */
  async remove(id: string, userId?: string): Promise<ApiResponse<{ id: string }>> {
    const row = await prisma.itemPrice.findUnique({ where: { id }, select: ROW_SELECT });
    if (!row) throw AppError.notFound("Fiyat satırı bulunamadı.");

    await prisma.itemPrice.delete({ where: { id } });

    void AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ITEM_PRICE",
      recordId: id,
      oldData: {
        itemId: row.itemId,
        customerId: row.customerId,
        kind: row.kind,
        currency: row.currency,
        price: row.price.toString(),
      },
    });

    return { success: true, data: { id }, message: "Fiyat satırı kaldırıldı." };
  }
}

export const itemPriceService = new ItemPriceService();
