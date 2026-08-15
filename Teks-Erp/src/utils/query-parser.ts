// =============================================================================
// TeksERP - Dynamic Query Parser
// =============================================================================
// Converts frontend query params into Prisma-compatible where/orderBy/skip/take.
// Usage: GET /api/items?page=1&pageSize=20&sortBy=name&sortOrder=asc&filter[itemType]=YARN&search=poplin
// =============================================================================

import { Request } from "express";
import { QueryParams } from "../types/api.types";
import { factoryDayKeyUtcMidnight } from "../constants/time";
import { AppError } from "./app-error";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
// 500: Electron tarafındaki master data picker'ları (renk seçici, özellik
// seçici, izinli ürün listesi, istasyon yetenekleri, vb.) "tümünü çek" davranışı
// kullanır; 500 tipik fabrika master data hacmini karşılar. Daha büyük listeler
// için cursor mode (?mode=cursor). DoS koruması (501+ → 400) korunur.
const MAX_PAGE_SIZE = 500;
// Yıllar süren operasyonda derin offset (skip) sorguları PostgreSQL'i her sayfada
// O(n) tarama yapmaya zorlar. UI'da hiç kimse 5K satırdan sonrasına gitmez —
// gidiyorsa filtre eksiktir. Erken hata fırlatıp kullanıcıyı filtre kullanmaya yönlendir.
const MAX_OFFSET = 10000;

// F35: parseCursorParams (+ CursorParams) KALDIRILDI — repo genelinde hiç çağıran
// yoktu ve limit sözleşmesi (>500→400) gerçek cursor yollarından sapıyordu.

/**
 * İstemci cursor mode istediği mi? `?cursor=...` veya `?mode=cursor` parametre.
 */
export function isCursorRequested(req: Request): boolean {
  return req.query.cursor !== undefined || req.query.mode === "cursor";
}

/**
 * Parse query parameters from the Express request.
 *
 * `pageSize` üst sınırı (`MAX_PAGE_SIZE`) ile clamp ETMİYOR — aşan istek 400.
 * Sessiz clamp yanıltıcıdır: istemci `pageSize=99999` istese 100 alır, eksik
 * kayıt görür, "kayıp veri" sanır. Açık hata ile sayfa boyutu küçültmeye
 * yönlendirilir. Çok büyük listeler için cursor pagination (`?mode=cursor`)
 * kullanılmalı.
 */
export function parseQueryParams(req: Request): QueryParams {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || DEFAULT_PAGE);
  const rawPageSize = parseInt(req.query.pageSize as string, 10) || DEFAULT_PAGE_SIZE;
  if (rawPageSize > MAX_PAGE_SIZE) {
    throw AppError.badRequest(
      `Sayfa boyutu (pageSize=${rawPageSize}) en fazla ${MAX_PAGE_SIZE} olabilir. ` +
        `Daha büyük listeler için cursor pagination kullanın (?mode=cursor).`
    );
  }
  const pageSize = Math.max(1, rawPageSize);

  const sortBy = (req.query.sortBy as string) || "createdAt";
  const sortOrder = (req.query.sortOrder as string)?.toLowerCase() === "asc" ? "asc" : "desc";

  const search = req.query.search as string | undefined;

  // Parse filter[fieldName]=value from query
  const filters: Record<string, string | string[]> = {};
  for (const key of Object.keys(req.query)) {
    const match = key.match(/^filter\[(.+)]$/);
    if (match) {
      const fieldName = match[1];
      const value = req.query[key];
      if (typeof value === "string") {
        filters[fieldName] = value;
      } else if (Array.isArray(value)) {
        filters[fieldName] = value.filter((v): v is string => typeof v === "string");
      }
    }
  }

  const dateField = req.query.dateField as string | undefined;
  const dateFrom = parseIsoDate(req.query.dateFrom);
  // F293 GERİ ALINDI: yalnız-tarih dateTo'yu UTC gün-sonuna genişletmek, UTC+3
  // (Europe/Istanbul) kurulumunda ertesi yerel günün ilk ~3 saatini fazladan
  // dahil ediyordu (adversarial review bulgusu). Canlı hiçbir tüketici date-only
  // dateTo yollamadığından (tüm frontend'ler gün-sonu ISO yolluyor) savunmacı
  // fix'in değeri yoktu; kaldırıldı. dateFrom ile aynı UTC konvansiyonu korunur.
  const dateTo = parseIsoDate(req.query.dateTo);

  return { page, pageSize, sortBy, sortOrder, filters, search, dateField, dateFrom, dateTo };
}

function parseIsoDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Tarih aralığı koşulunu `where`'a ekler — service kendi whitelist'ini sağlar.
 * Whitelist dışındaki dateField sessizce yok sayılır (404 değil; UI hatasız).
 *
 * ⚠️ `dateField` GÖNDERİLMEZSE ARALIK SESSİZCE YOK SAYILIR (ilk satır). Yani
 * yalnız `dateFrom`/`dateTo` yollayan bir istemci, filtresi çalışıyor sanır ve
 * tam liste görür. İstemci sözleşmesi: üç parametre BİRLİKTE gider.
 *
 * ⚠️ Parametre tipi bilinçli olarak DAR (`Pick<…>`): tam `QueryParams`
 * istenirse `page/pageSize/sortBy` taşımayan çağıranlar (servis `list`
 * imzaları) ya sahte alan uydurmak ya da `as` cast yazmak zorunda kalır —
 * ikisi de tip güvenliğini tam bu noktada kaybettirir.
 *
 * Performans notu: range query için `dateField` kolonunda index ŞART. Yoksa
 * büyük tabloda seq scan tetiklenir. Composite `[status, dateField]` ideal.
 */
export function applyDateRange(
  where: Record<string, unknown>,
  params: Pick<QueryParams, "dateField" | "dateFrom" | "dateTo">,
  allowedFields: readonly string[]
): void {
  if (!params.dateField || !allowedFields.includes(params.dateField)) return;
  if (!params.dateFrom && !params.dateTo) return;
  const dateOnly = DATE_ONLY_COLUMNS.has(params.dateField);
  const range: { gte?: Date; lte?: Date } = {};
  if (params.dateFrom) range.gte = dateOnly ? factoryDayKeyUtcMidnight(params.dateFrom) : params.dateFrom;
  if (params.dateTo) range.lte = dateOnly ? factoryDayKeyUtcMidnight(params.dateTo) : params.dateTo;
  where[params.dateField] = range;
}

// ── `@db.Date` KOLONLARI — GÜN-YALNIZ SINIR ÇEVİRİMİ (2026-08-15) ────────────
// SORUN. Liste filtrelerinin geri kalanı `timestamptz` kolonlara bakar ve orada
// istemcinin gönderdiği MUTLAK AN aynen kullanılır ("backend ekstra yuvarlama
// yapmaz" sözleşmesi — panelin `dayStartIso`/`useReportDateRange` kalıbı YEREL
// gece yarısını yollar ve bu doğrudur). `@db.Date` kolonda aynı sözleşme
// SESSİZCE BİR GÜN KAYDIRIR: Prisma bir `@db.Date` karşılaştırmasını UTC
// gün-parçasına indirger, Istanbul'un yerel gece yarısı ise UTC'de bir ÖNCEKİ
// günün 21:00'idir → alt sınır bir gün geriye açılır.
//   Ölçüldü (2026-08-15, gerçek servis): D ve D+1'e yazılmış iki kur satırında
//   `dateFrom = (D+1) yerel 00:00` sorgusu İKİSİNİ birden döndürdü; aynı sorgu
//   UTC gece yarısıyla yalnız D+1'i döndürüyor. Muhasebeci "1–31 Ağustos"
//   seçince listede 31 Temmuz kuru da çıkıyordu — hata yok, log yok.
// ÇÖZÜM. Gün-yalnız kolonlarda istemcinin ANI, FABRİKA takvim gününe indirgenir
// (`factoryDayKeyUtcMidnight` — aynı kolona YAZARKEN de kullanılan fonksiyon;
// okuma ile yazma aynı gün tanımını paylaşmak zorunda).
//
// ⚠️ LİSTE SERVİS BAZLI DEĞİL ŞEMA BAZLIDIR: hangi kolonun `@db.Date` olduğu
// bir servis tercihi değil bir ŞEMA gerçeğidir. Servis config'ine dağıtılsaydı
// aynı kolonu whitelist'ine ekleyen ikinci bir servis (ör. bir rapor ucu) bunu
// yazmayı unutur ve hata YALNIZ orada geri gelirdi.
// ⚠️ AD ÇAKIŞMASI YASAK: burada listelenen ad, şemadaki HER modelde `@db.Date`
// olmalı — aynı adı taşıyan bir `timestamptz` kolon olsaydı onun filtresi
// sessizce gün çözünürlüğüne inerdi. Bekçi (`test_ticaret_links_and_filters`
// §5c) bunu `schema.prisma` üzerinden mekanik doğrular: liste ⊆ `@db.Date`
// alanları VE liste ⊇ (filtrelenebilir `@db.Date` alanları).
export const DATE_ONLY_COLUMNS: ReadonlySet<string> = new Set([
  // ExchangeRate.rateDate — "15 Temmuz'daki EUR kuru" takvim günüdür, an değil.
  "rateDate",
  // EndpointLatencyDaily.day — rollup anahtarı; bugün filtrelenmiyor ama aynı
  // sınıf (ad çakışması denetimi bu satır sayesinde `day`i de kapsar).
  "day",
  // CashPeriodClose.periodEnd + CariPeriodClose.periodEnd — "2025 Aralık
  // kapanışı" takvim günüdür. Bugün `dateFields` whitelist'inde DEĞİL (yani
  // liste bu kolonu süzmüyor); yine de burada durur, çünkü liste ŞEMAYI
  // aynalar — kolon filtrelenebilir hâle geldiği gün hata sessizce geri
  // gelirdi. Bekçi §5d2 bu tam-kapsamı mekanik doğrular.
  "periodEnd",
]);

/**
 * Filtre değerini temiz bir liste hâline getirir. FilterBar çoklu seçimi
 * `filter[x]=a,b` (CSV) olarak yollar; Express tekrarlı anahtarda dizi verir.
 * Her iki biçim de aynı listeye indirgenir.
 */
export function readFilterList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((v) => v.trim()).filter(Boolean);
  if (typeof value === "string" && value.length > 0) {
    return value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Çoklu-seçim filtre değerini Prisma koşuluna çevirir:
 *   hiç değer → `null` (filtre uygulanmaz) · tek değer → düz eşitlik · N değer → `{ in: [...] }`
 *
 * ⚠️ NEDEN GEREKLİ. `buildWhereClause` CSV'yi zaten `in`'e çevirir, ama filtreyi
 * ELLE okuyan servisler (inventory `buildRollWhere`, order `extraWhere`, kartela,
 * production-balance) `typeof v === "string"` kontrolüyle okuyordu — **CSV de bir
 * string'dir**. Ham geçirmenin ÜÇ ayrı arıza modu var; hangisinin çıkacağı kolonun
 * tipine bağlı (üçü de `scripts/test_filter_multi_select.ts` sondalarıyla ölçüldü):
 *
 *   1. **uuid kolon** (itemId/colorId/customerId/subcontractorId…): Postgres
 *      `invalid input syntax for type uuid` → Prisma **P2007** → error middleware
 *      onu **HTTP 400** + *"Geçersiz veri formatı (örn. hatalı ID)"* mesajına
 *      çevirir. Liste tamamen boş/hatalı döner. ⚠️ Servisi DOĞRUDAN çağıran
 *      bekçilerde ham `PrismaClientKnownRequestError` görülür (middleware devrede
 *      değildir) — "500" sanma, sahadaki karşılığı bu 400 mesajıdır.
 *   2. **uuid OLMAYAN string kolon** (`foldType` emsali): **0 satır, hata yok,
 *      log yok** — operatör "bu kumaştan hiç yok" sanır.
 *   3. **ön-süzgeçli alan** (`currentStationId`, UUID regex'inden geçer): CSV
 *      regex'e takılır, filtre **sessizce DÜŞER** ve liste filtresizmiş gibi
 *      döner. En tehlikelisi: boş liste değil **YANLIŞ liste**, hiçbir uyarı yok
 *      (ölçüm: iki istasyon seçilince 2 yerine 6 satır).
 *
 * Elle okunan HER id filtresi bu yardımcıdan geçmeli.
 *
 * Tek değerde `in` yerine düz eşitlik üretilir: sorgu planı aynı, ama mevcut
 * `where` şekli (ve onu okuyan bekçiler) bayt-bayt korunur.
 */
export function readIdCondition(
  value: string | string[] | undefined
): string | { in: string[] } | null {
  const list = readFilterList(value);
  if (list.length === 0) return null;
  return list.length === 1 ? (list[0] as string) : { in: list };
}

/**
 * Bir istemci değerinin gerçekten enum ÜYESİ olup olmadığı.
 *
 * ⚠️⚠️ `deger in EnumNesnesi` YAZMA — `in` operatörü PROTOTİP ZİNCİRİNİ de tarar.
 * Prisma'nın ürettiği enum nesneleri düz `Object` literalleridir (ölçüldü:
 * `Object.getPrototypeOf(PaymentMethod) === Object.prototype`), dolayısıyla
 * `"toString" in PaymentMethod` → **true**, aynısı `"__proto__"`, `"constructor"`,
 * `"valueOf"`, `"hasOwnProperty"` için de geçerli. Sonuç: istemciden gelen
 * `?method=toString` enum kapısını GEÇER, `where.method = "toString"` Prisma'ya
 * gider ve `PrismaClientValidationError` → error middleware'de **jenerik**
 * *"Geçersiz veri yapısı"* 400'üne düşer. Yani kapının var oluş sebebi (hangi
 * alanın yanlış olduğunu ADIYLA söyleyen 400) tam da bu değerlerde kaybolur.
 *
 * `Object.prototype.hasOwnProperty.call` yalnız kendi anahtarlarına bakar; nesne
 * `Object.create(null)` ile kurulmuş olsa bile `.hasOwnProperty` çağrısı üzerinden
 * değil `Object.prototype`ten yapıldığı için güvenlidir.
 *
 * Bekçi: `scripts/test_payment_allocation.ts` §18 (prototip anahtarı sondaları).
 */
export function isEnumMember<T extends Record<string, string>>(
  enumObj: T,
  value: string
): value is T[keyof T] {
  return Object.prototype.hasOwnProperty.call(enumObj, value);
}

/**
 * Build Prisma `where` clause from parsed filters.
 * Supports: exact match, enum match, comma-separated IN, boolean.
 */
export function buildWhereClause(
  filters: Record<string, string | string[]>,
  searchFields?: string[],
  search?: string
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      where[field] = { in: value };
    } else if (value.includes(",")) {
      where[field] = { in: value.split(",").map((v) => v.trim()) };
    } else if (value === "true" || value === "false") {
      where[field] = value === "true";
    } else {
      where[field] = value;
    }
  }

  // Full-text search — Türkçe-duyarlı (ILIKE noktalı/noktasız i'yi katlamaz;
  // tam gerekçe ve iki katmanın anlatımı aşağıdaki blokta).
  if (search && searchFields && searchFields.length > 0) {
    where.OR = buildTurkishSearch(search, searchFields);
  }

  return where;
}

// ── Türkçe-duyarlı arama ──────────────────────────────────────────────────────
// ILIKE (`mode:"insensitive"`) küçük/BÜYÜK katlamasını `lower()` ile yapar ve
// SONUÇ VERİTABANININ COLLATION'INA BAĞLIDIR:
//   • C-locale  → yalnız ASCII a-z↔A-Z katlanır; Türkçe'nin HİÇBİR çifti eşleşmez.
//   • en_US.UTF-8 (bu kurulum, 2026-08-15'te psql ile ölçüldü) → ş/ğ/ö/ü/ç
//     çiftleri ZATEN katlanır; katlanmayan TEK aile **noktalı/noktasız i**dir:
//       lower('İ') = 'i̇' (İKİ kod noktası) ≠ lower('i') = 'i'  ·  lower('ı') = 'ı'
//     yani ILIKE'ın kovaları {i,I} · {İ} · {ı} olur; Türkçe'nin istediği ise
//     {i,İ} · {ı,I}.
//
// BU YÜZDEN İKİ KATMAN VAR ve İKİSİ DE GEREKLİ:
//   ① KANONİK YAZIMLAR — terim + tr-BÜYÜK + tr-küçük + **tr-BAŞLIK DÜZENİ**.
//      Eski hâlde BAŞLIK DÜZENİ YOKTU ve kırık olan yarı tam olarak oydu:
//      `Item.name` gibi yollar adı TOPTAN büyük saklar (`normalizeItemName`) ve
//      o kısım çalışıyordu, ama `Customer.name` normalize EDİLMEZ (bu DB'de 49
//      müşterinin 22'si başlık düzeninde) ve çek keşideci/banka adı, kasa
//      açıklaması serbest metindir. Ölçüldü:
//        'T. İş Bankası'  ILIKE '%iş bankası%'  → f   (düz yaprak)
//                          LIKE  '%İŞ BANKASI%' → f   (tr-BÜYÜK)
//                          LIKE  '%iş bankası%' → f   (tr-küçük)
//                         ILIKE '%İş Bankası%'  → t   (tr-BAŞLIK) ✅
//      Yani muhasebeci kasa defterinde "işçi avansı" arayınca 0 satır alıyor ve
//      gideri İKİNCİ KEZ giriyordu.
//   ② i-AİLESİ ÇARPIMI — terimdeki her i/İ/ı/I konumu iki yazımıyla denenir.
//      ①'in kapsamadığı KARIŞIK yazımlar içindir ("AKİF ticaret" gibi, i-ailesi
//      kelime ortasında BÜYÜK ama gerisi küçük). Nadir ama gerçek.
//
// ⚠️ ÇARPIM ÜSTELDİR (2^n) → `TR_MAX_I_POSITIONS` ile SINIRLI ve sınır BİLİNÇLİ
// OLARAK DÜŞÜK (3 → en fazla 8 desen; toplam ≤ 12 yaprak). Sebep maliyet: bu
// yapraklar `contains` (ön-jokerli LIKE) olduğu için indeks kullanamaz ve
// `orders` gibi İLİŞKİ üzerinden arayan servislerde her yaprak AYRI bir EXISTS
// alt sorgusu doğurur (`lines.some.item.name`). Sınırı büyütmeden önce o
// çarpanı ölç.
// ⚠️ Sınırı aşan terimde ② atlanır, ① yürürlükte kalır — ve ① başlık düzenini
// de içerdiği için gerçek dünyadaki yazımların hepsi hâlâ karşılanır
// (kaybedilen yalnız KARIŞIK yazım). Yani degradasyon sessiz değil, DAR.
// ⚠️ i-ailesi TAŞIMAYAN terimde ② hiç koşmaz; ASCII terimde tek yaprak üretilir
// ve sorgu bugünküyle bayt-bayt aynı kalır.
const TR_FOLD = /[iıİIçÇğĞöÖşŞüÜ]/;
const TR_MAX_I_POSITIONS = 3;

/**
 * tr-BAŞLIK DÜZENİ: her kelimenin ilk harfi tr-BÜYÜK, gerisi tr-küçük.
 *
 * ⚠️ `toLocaleUpperCase("tr-TR")` ZORUNLU (ASCII `toUpperCase` DEĞİL): "işçi"
 * → ASCII'de "Işçi" (NOKTASIZ I) üretilir ve DB'deki "İşçi" ile eşleşmez —
 * yani düzeltilmek istenen hatanın ta kendisi geri gelir.
 * Kelime sınırı: harf/rakam OLMAYAN her karakter (boşluk, nokta, tire, "&").
 */
function trTitleCase(term: string): string {
  const lower = term.toLocaleLowerCase("tr-TR");
  let out = "";
  let atWordStart = true;
  for (const ch of lower) {
    const isWordChar = /[0-9a-zçğıöşü]/.test(ch);
    out += atWordStart && isWordChar ? ch.toLocaleUpperCase("tr-TR") : ch;
    atWordStart = !isWordChar;
  }
  return out;
}

/**
 * Bir i-ailesi karakterinin, ILIKE altında AYRI kovalara düşen iki yazımı.
 *
 * ⚠️ NOKTALI ile NOKTASIZ AİLE BİRBİRİNE KATLANMAZ: Türkçe'de "işçi" ile "ışçı"
 * FARKLI kelimelerdir. Katlamak hem aramayı gürültülendirir hem desen sayısını
 * ikiye katlardı. (ASCII 'i' yazıp 'ı' arayan kullanıcı yine de 'I' kovası
 * üzerinden kısmen karşılanır — pattern 'i' DB'de {i,I} eşler.)
 */
function iFamilyVariants(ch: string): readonly [string, string] | null {
  if (ch === "i" || ch === "İ") return ["i", "İ"];
  if (ch === "ı" || ch === "I") return ["ı", "I"];
  return null;
}

/** "a.b.c" → { a: { b: { c: leaf } } } (list-relation `some` dahil düz iç içe). */
function nestPath(path: string, leaf: unknown): Record<string, unknown> {
  const segs = path.split(".");
  let node: unknown = leaf;
  for (let i = segs.length - 1; i >= 0; i--) node = { [segs[i]]: node };
  return node as Record<string, unknown>;
}

/**
 * Terimin ILIKE ile denenecek TÜM yazımları (tekilleştirilmiş, sıra kararlı).
 * Ayrı export: bekçi desen kümesini DB'ye gitmeden de ölçebilsin.
 */
export function turkishSearchPatterns(search: string): string[] {
  const term = search.trim();
  if (!term) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string): void => {
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  push(term);
  if (TR_FOLD.test(term)) {
    push(term.toLocaleUpperCase("tr-TR"));
    push(term.toLocaleLowerCase("tr-TR"));
    // ⭐ BAŞLIK DÜZENİ — sistemin normalize EDİLMEYEN yarısının olağan yazımı
    // ("Ege Kumaş İthalat", "T. İş Bankası", "Perde Dünyası Mağazacılık").
    push(trTitleCase(term));
  }
  const chars = [...term];
  const positions: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (iFamilyVariants(chars[i] as string)) positions.push(i);
  }
  if (positions.length > 0 && positions.length <= TR_MAX_I_POSITIONS) {
    const combos = 1 << positions.length;
    for (let mask = 0; mask < combos; mask++) {
      const out2 = [...chars];
      positions.forEach((pos, bit) => {
        const pair = iFamilyVariants(chars[pos] as string);
        if (pair) out2[pos] = (mask >> bit) & 1 ? pair[1] : pair[0];
      });
      push(out2.join(""));
    }
  }
  return out;
}

/**
 * Türkçe-duyarlı `contains` OR koşulları üretir. paths nokta-notasyonu ile nested
 * relation destekler ("customer.name", "sacks.some.sackNo").
 * DİKKAT: boş term/paths → [] döner; boş [] doğrudan `.OR`'a atanırsa Prisma HİÇBİR
 * kaydı eşlemez → çağıran mutlaka `if (search)` guard'ını korumalı.
 *
 * ⚠️ TÜM YAPRAKLAR `mode:"insensitive"`: eskiden ①'in iki varyantı BÜYÜK/küçük
 * DUYARLI `contains` idi ve bu, "İŞÇİ AVANSI" ile "İşçi Avansı"yı ayırıyordu.
 * Duyarsıza çevirmek kümeyi yalnız GENİŞLETİR (duyarlı eşleşen her satır
 * duyarsız da eşleşir) — hiçbir mevcut sonuç kaybolmaz.
 */
export function buildTurkishSearch<T = Record<string, unknown>>(
  search: string,
  paths: readonly string[]
): T[] {
  const term = search.trim();
  if (!term || paths.length === 0) return [];
  const patterns = turkishSearchPatterns(term);
  const clauses: Record<string, unknown>[] = [];
  for (const path of paths) {
    for (const p of patterns) clauses.push(nestPath(path, { contains: p, mode: "insensitive" }));
  }
  return clauses as unknown as T[];
}

/**
 * Build Prisma `orderBy` clause.
 */
export function buildOrderByClause(
  sortBy: string,
  sortOrder: "asc" | "desc"
): Record<string, string> {
  return { [sortBy]: sortOrder };
}

/**
 * sortBy güvenlik süzgeci — istemciden gelen sortBy yalnız whitelist'teyse kullanılır,
 * değilse `fallback`'e düşer. İki sorunu birden engeller:
 *   1) Bilinmeyen kolon → Prisma `PrismaClientValidationError` (HTTP 500). İstemci
 *      `?sortBy=garbage` gönderince endpoint patlardı.
 *   2) İndekssiz kolona keyfi sıralama → büyük tabloda seq scan + sort (ölçüldü:
 *      indeksli 0.8ms vs indekssiz 20-31ms @300k; keyset cursor da bozulur).
 * Whitelist = UI'ın sıralanabilir sunduğu kolonlar + createdAt/id (kararlı tie-break).
 */
export function resolveSortBy(
  requested: string | undefined,
  allowed: readonly string[],
  fallback = "createdAt"
): string {
  return requested && allowed.includes(requested) ? requested : fallback;
}

/**
 * Calculate Prisma skip/take from page & pageSize.
 * MAX_OFFSET guard: skip > 10K → 400 fırlat (filtre kullanmaya zorla).
 */
export function buildPagination(page: number, pageSize: number): { skip: number; take: number } {
  const skip = (page - 1) * pageSize;
  if (skip > MAX_OFFSET) {
    throw AppError.badRequest(
      `Sayfa derinliği aşıldı (skip=${skip}). Lütfen filtre daraltın veya tarih aralığı kullanın.`
    );
  }
  return { skip, take: pageSize };
}
