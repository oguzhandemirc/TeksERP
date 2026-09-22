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
/** Liste sözlüğü — bu adlar süzgeç DEĞİL, sayfalama/sıralama/arama/tarih/cursor bayraklarıdır; çıplak gelmeleri meşru. */
export const LIST_QUERY_RESERVED: ReadonlySet<string> = new Set([
  "page", "pageSize", "sortBy", "sortOrder", "search", "dateField", "dateFrom", "dateTo",
  "cursor", "limit", "mode", "withTotal", "withSummary", "withArchived", "withOrderDetail", "includeInactive",
]);

/**
 * ÇIPLAK SÜZGEÇ FAIL-CLOSED (kullanıcı bulgusu 2026-09-18, d9 sürücüsü): `?status=OPEN` gibi TANINAN bir süzgeç adı
 * `filter[status]` yerine çıplak gelirse liste sessizce HEPSİNİ dönüyordu — yanlış süzülmüş liste, hiç süzülmemişten
 * kötüdür (operatör daraltılmış sanır). Tanınan ad (`recognized`: modelin skaler alanları ya da ucun okuduğu süzgeç
 * adları) çıplak gelirse 400 `BARE_FILTER_PARAM`, mesaj doğru yazımı söyler. Sözlükteki (`LIST_QUERY_RESERVED`) ve
 * ucun kendi okuduğu (`bareAllowed`) adlar serbest.
 */
export function assertNoBareFilterParams(req: Request, recognized: Iterable<string>, bareAllowed: Iterable<string> = []): void {
  const known = new Set(recognized);
  const allowed = new Set(bareAllowed);
  const bare = Object.keys(req.query).filter((k) => !k.startsWith("filter[") && !LIST_QUERY_RESERVED.has(k) && !allowed.has(k) && known.has(k));
  if (bare.length === 0) return;
  throw AppError.badRequest(
    `Süzgeç çıplak gönderilemez: ${bare.map((k) => `\`${k}\``).join(", ")} — \`filter[${bare[0]}]=…\` biçimini kullanın (çıplak ad sessizce yok sayılırdı).`,
    { code: "BARE_FILTER_PARAM", params: bare, hint: bare.map((k) => `filter[${k}]`) },
  );
}

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
 * Performans notu: range query için `dateField` kolonunda index ŞART. Yoksa
 * büyük tabloda seq scan tetiklenir. Composite `[status, dateField]` ideal.
 */
export function applyDateRange(
  where: Record<string, unknown>,
  // ⚠️ Tip BİLEREK dar (merge, 2026-09-01): bu yardımcı yalnız üç tarih alanını
  // okur. Tam `QueryParams` istemek, sayfalama dışında sıralama TAŞIMAYAN
  // servisleri (ticaret listeleri) sahte `sortBy/sortOrder` uydurmaya zorluyordu.
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
// yapmaz" sözleşmesi). `@db.Date` kolonda aynı sözleşme SESSİZCE BİR GÜN
// KAYDIRIR: Prisma bir `@db.Date` karşılaştırmasını UTC gün-parçasına indirger,
// Istanbul'un yerel gece yarısı ise UTC'de bir ÖNCEKİ günün 21:00'idir.
//   Ölçüldü (2026-08-15): muhasebeci "1–31 Ağustos" seçince listede 31 Temmuz
//   kuru da çıkıyordu — hata yok, log yok.
// ÇÖZÜM. Gün-yalnız kolonlarda istemcinin ANI, FABRİKA takvim gününe indirgenir
// (`factoryDayKeyUtcMidnight` — aynı kolona YAZARKEN de kullanılan fonksiyon).
//
// ⚠️ LİSTE SERVİS BAZLI DEĞİL ŞEMA BAZLIDIR: hangi kolonun `@db.Date` olduğu
// bir servis tercihi değil bir ŞEMA gerçeğidir.
// ⚠️ AD ÇAKIŞMASI YASAK: burada listelenen ad, şemadaki HER modelde `@db.Date`
// olmalı. Bekçi (`test_ticaret_links_and_filters` §5c) mekanik doğrular.
export const DATE_ONLY_COLUMNS: ReadonlySet<string> = new Set([
  // ExchangeRate.rateDate — "15 Temmuz'daki EUR kuru" takvim günüdür, an değil.
  "rateDate",
  // EndpointLatencyDaily.day — rollup anahtarı; bugün filtrelenmiyor ama aynı
  // sınıf (ad çakışması denetimi bu satır sayesinde `day`i de kapsar).
  "day",
  // CashPeriodClose.periodEnd + CariPeriodClose.periodEnd — "2025 Aralık
  // kapanışı" takvim günüdür. Bugün `dateFields` whitelist'inde DEĞİL; yine de
  // burada durur, çünkü liste ŞEMAYI aynalar.
  "periodEnd",
  // MachineStopEvent.factoryDay (dokuma P2b-1, 2026-09-13) — duruşun FABRİKA GÜNÜ:
  // gece vardiyası BAŞLADIĞI güne yazılır, raporun group-by ekseni, doğuşta donar.
  // Mutlak an ayrı kolonlarda (`startedAt`/`endedAt`, timestamptz). Bugün filtre
  // whitelist'inde DEĞİL; burada durur çünkü liste ŞEMAYI aynalar.
  // ⚠️ Aynı alan `test_timestamptz_contract`ın DATE_ONLY_FIELDS'inde de beyanlı —
  // İKİ kapı aynı alanı FARKLI listeden okur; birine beyan etmek ötekine beyan
  // etmek değildir (P2b-1'de bu satır eksik kaldı, CI §5d2 ile yakaladı).
  "factoryDay",
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
 * Build Prisma `where` clause from parsed filters.
 * Supports: exact match, enum match, comma-separated IN, boolean.
 */
export function buildWhereClause(
  filters: Record<string, string | string[]>,
  searchFields?: string[],
  search?: string,
  /**
   * KOD ALANLARI — katlanmaz, `<kolon>Fold` gölgesi ARANMAZ; yalnız terim KOD
   * BİÇİMİNDEYSE (boşluksuz, ASCII) aramaya katılır.
   *
   * Neden ayrı: bu alanlar tipik olarak derin ilişkilerin ucundadır (siparişten
   * iş emri numarasına gitmek order_lines + pivot + work_orders üzerinden bir
   * semi-join ister). Ölçüldü (2026-08-17, EXPLAIN ANALYZE): PostgreSQL bunu
   * satır başına değil TEK GEÇİŞTE çözüyor (`hashed SubPlan`) — yani maliyet
   * eklenir, çarpılmaz. Yine de bir müşteri adı araması için bu ilişki taramasını
   * ödemenin anlamı yok.
   *
   * ⚠️ `searchFields` KATLANMAMIŞ yol yazar ("customer.name"); motor `Fold`
   * ekini kendisi koyar. Bir KOD kolonunu oraya yazarsan var olmayan bir
   * `<kolon>Fold` alanına sorulur ve Prisma 500 verir — kova ayrımı bilinçlidir.
   */
  codeSearchFields?: string[]
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

  // Serbest metin araması — katlanmış gölge kolonlar üzerinden (bkz. buildTextSearch).
  if (search && ((searchFields?.length ?? 0) > 0 || (codeSearchFields?.length ?? 0) > 0)) {
    const leaves = buildTextSearch(search, { text: searchFields, code: codeSearchFields });
    // ⚠️ Boş yaprak dizisini `.OR`'a ATAMA: Prisma `OR: []` gördüğünde HİÇBİR
    // kaydı eşlemez, yani "hiç sonuç yok" sessiz yanlışı doğar (terim yalnız
    // joker karakterden ibaretse veya kod-dışı bir terimde yalnız kod alanı
    // tanımlıysa bu gerçekten olur).
    if (leaves.length > 0) where.OR = leaves;
  }

  return where;
}

// ── ARAMA MOTORU — katlanmış gölge kolon üzerinden (2026-08-19) ──────────────
// ESKİ YOL (kaldırıldı): terim Türkçe varyantlarına açılıyordu ("gumus" → 31 dal)
// ve her varyant × her alan bir ILIKE üretiyordu — tek aramada ~200 koşul, plan
// daima Seq Scan. Ölçüm (200 bin satır, dev DB): 583 ms.
//
// YENİ YOL: aranan her metin kolonunun yanında DB'nin ürettiği `<kolon>Fold`
// gölgesi var (`GENERATED ALWAYS AS (public.tr_fold(...)) STORED`, migration
// `20260819060000_search_fold`). Terim de aynı katlamadan geçer → TEK `contains`.
// Aynı ölçüm: 6,3 ms, Bitmap Index Scan (trigram GIN). Varyant üretimi, dallanma
// tavanı (`TR_MAX_FOLD_POSITIONS`) ve onun sessiz daralması tamamen kalktı.
//
// ⚠️ `mode: "insensitive"` KULLANILMAZ ve kullanılmamalı: katlanmış kolon zaten
// küçük ASCII'dir. `insensitive` Prisma'da ILIKE üretir; ILIKE'ın davranışı
// veritabanının locale'ine bağlıdır (dev ICU en-US ↔ saha C locale) ve trigram
// index'ini de her zaman kullanamaz. Katlama tam olarak bu belirsizliği ortadan
// kaldırmak için var.
//
// ⚠️ METİN ve KOD yolları AYRI verilir — otomatik ayırt etme YOK. Bir kod kolonu
// (`orderNumber`, `sackNo`, `code`) katlanmaz: ASCII ve BÜYÜK saklanır, gölgesi
// yoktur. Yanlış kovaya konan yol ya var olmayan bir kolona sorar (500) ya da
// sessizce hiç eşleşmez. Ayrım çağıranın bilinçli kararıdır.
import { foldSearchTokens } from "./search-fold";
import { foldCodeForCompare } from "./code-format";
import { lowerTr, upperTr } from "./tr-case";

/** "a.b.c" → { a: { b: { c: leaf } } } (list-relation `some` dahil düz iç içe). */
function nestPath(path: string, leaf: unknown): Record<string, unknown> {
  const segs = path.split(".");
  let node: unknown = leaf;
  for (let i = segs.length - 1; i >= 0; i--) node = { [segs[i]]: node };
  return node as Record<string, unknown>;
}

/**
 * Metin yolunu katlanmış gölgesine çevirir: "customer.name" → "customer.nameFold".
 * Çağıran yolu KATLANMAMIŞ hâliyle yazar (okunur kalsın); eşleme tek yerde durur.
 */
function toFoldPath(path: string): string {
  const segs = path.split(".");
  segs[segs.length - 1] = `${segs[segs.length - 1]}Fold`;
  return segs.join(".");
}

/**
 * Terim KOD biçiminde mi? (boşluksuz + yalnız ASCII harf/rakam/ayraç)
 *
 * ⚠️ Eskiden burada bir RAKAM ŞARTI vardı ve iki yönlü hata üretiyordu:
 *   • rakamsız bir belge öneki hiç aranmıyordu (sessiz boş sonuç);
 *   • "AKTOS2" gibi RAKAMLI BİR ÜRÜN ADI kod hızlı yoluna girip Türkçe katlamayı
 *     ATLIYORDU — yani "aktos2" araması "AKTOŞ2"yu bulamıyordu. Tekstilde
 *     rakamlı ürün adı kuraldır ("PATOS 300" yalnız boşluğu sayesinde kurtuluyordu).
 * Artık rakam şartı yok ve kod-biçimli terim HEM kod HEM metin yollarına gider.
 */
export function isCodeLikeTerm(term: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(term);
}

/**
 * Prisma `OR` yaprakları üretir — katlanmış metin kolonları + (varsa) kod kolonları.
 *
 * @param search  ham arama terimi (istemciden geldiği gibi; katlama burada yapılır)
 * @param paths.text  KATLANMAMIŞ metin yolları ("customer.name") — `Fold` eklenir
 * @param paths.code  kod yolları ("orderNumber") — olduğu gibi kullanılır
 *
 * ÇOK KELİMELİ TERİM: kelimeler AND'lenir, yani "şahin tekstil" ile
 * "tekstil şahin" AYNI kaydı bulur. Her kelime ayrı bir `contains` olduğu için
 * hepsi trigram index'inden beslenir.
 *
 * DİKKAT: boş term/paths → [] döner; boş [] doğrudan `.OR`'a atanırsa Prisma
 * HİÇBİR kaydı eşlemez → çağıran `if (search)` guard'ını korumalı.
 */
export function buildTextSearch<T = Record<string, unknown>>(
  search: string,
  paths: { text?: readonly string[]; code?: readonly string[] }
): T[] {
  const term = search.trim();
  if (!term) return [];
  const textPaths = paths.text ?? [];
  const codePaths = paths.code ?? [];
  const clauses: Record<string, unknown>[] = [];

  const tokens = foldSearchTokens(term);
  if (tokens.length > 0) {
    for (const path of textPaths) {
      const foldPath = toFoldPath(path);
      if (tokens.length === 1) {
        clauses.push(nestPath(foldPath, { contains: tokens[0] }));
      } else {
        // Aynı alanda iki `contains` tek nesneye sığmaz → yol başına AND bloğu.
        // İlişki listelerinde (`lines.some.…`) bu, kelimelerin FARKLI satırlarda
        // bulunmasına izin verir; sipariş araması için istenen davranış budur.
        clauses.push({
          AND: tokens.map((t) => nestPath(foldPath, { contains: t })),
        });
      }
    }
  }

  if (codePaths.length > 0 && isCodeLikeTerm(term)) {
    // `foldCodeForCompare`: BÜYÜK + i-ailesi ASCII'ye (`İE…` yazan Türkçe klavye
    // de `IE…` kayıtlarını bulsun). Kod kolonları ASCII BÜYÜK saklanır.
    const codeTerm = foldCodeForCompare(term);
    for (const path of codePaths) clauses.push(nestPath(path, { contains: codeTerm }));
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

/**
 * Değer bu enum'un bir üyesi mi? (tip daraltmalı)
 *
 * ⚠️ Merge notu (2026-09-01): `adnansahin` dalında kullanan kalmadığı için
 * düşmüştü; ticaret servisleri (`purchase-order.service`) kullanıyor.
 */
export function isEnumMember<T extends Record<string, string>>(
  enumObj: T,
  value: string
): value is T[keyof T] {
  return Object.prototype.hasOwnProperty.call(enumObj, value);
}

// ─────────────────────────────────────────────────────────────────────────────
// ESKİ YOL — ILIKE VARYANT ARAMASI (yalnız TİCARET tabloları için)
// =============================================================================
// ⚠️ BU KOD BİLİNÇLİ OLARAK YAŞIYOR; "buildTextSearch varken bu neden duruyor?"
// sorusunun cevabı ŞEMADADIR, tercihte değil.
//
// `buildTextSearch` (yukarıda) her metin kolonunun yanında DB'nin ürettiği
// `<kolon>Fold` gölgesinin BULUNDUĞUNU varsayar — o gölgeler migration
// `20260819060000_search_fold` ile geldi ve YALNIZ o tarihte var olan üretim
// tablolarını kapsıyor. Ticaret paketinin tabloları (cari_accounts · invoices ·
// payments · cheques · cash_transactions · yarn_stocks · item_prices ·
// purchase_orders · cheque_delivery_notes) o migration'dan SONRA, ayrı bir
// dalda doğdu ve fold kolonu TAŞIMIYOR. Onlarda `buildTextSearch` çağırmak
// var olmayan bir kolona sorar → arama 500 verir (sessiz değil ama ölümcül).
//
// Bu yüzden iki yol yan yana duruyor ve SINIR NETTİR:
//   • fold kolonu OLAN tablo  → `buildTextSearch` (trigram index, ~6 ms)
//   • ticaret tabloları       → `buildTurkishSearch` (ILIKE varyantları)
//
// KALICI ÇÖZÜM (yapılmadı, bilinçli): ticaret tablolarına da fold kolonu +
// trigram index ekleyen bir migration yazmak ve çağrıları çevirmek. Bu bir
// MERGE kararı değil, ölçülüp planlanacak ayrı bir iştir — `test_db_invariants`
// envanterine ~10 yeni partial/GIN index satırı da eklenmesi gerekir.
// ─────────────────────────────────────────────────────────────────────────────

const TR_FOLD = /[iıİIçÇğĞöÖşŞüÜ]/;
/** ⚠️ Çarpım ÜSTELDİR (2^n) — sınır bilinçli olarak düşük (en fazla 8 desen). */
const TR_MAX_I_POSITIONS = 3;

/**
 * tr-BAŞLIK DÜZENİ: her kelimenin ilk harfi tr-BÜYÜK, gerisi tr-küçük.
 *
 * ⚠️ `toLocaleUpperCase("tr-TR")` ZORUNLU (ASCII `toUpperCase` DEĞİL): "işçi"
 * → ASCII'de "Işçi" (NOKTASIZ I) üretilir ve DB'deki "İşçi" ile eşleşmez.
 */
function trTitleCase(term: string): string {
  const lower = lowerTr(term);
  let out = "";
  let atWordStart = true;
  for (const ch of lower) {
    const isWordChar = /[0-9a-zçğıöşü]/.test(ch);
    out += atWordStart && isWordChar ? upperTr(ch) : ch;
    atWordStart = !isWordChar;
  }
  return out;
}

/**
 * Bir i-ailesi karakterinin, ILIKE altında AYRI kovalara düşen iki yazımı.
 *
 * ⚠️ NOKTALI ile NOKTASIZ AİLE BİRBİRİNE KATLANMAZ: Türkçe'de "işçi" ile "ışçı"
 * FARKLI kelimelerdir.
 */
function iFamilyVariants(ch: string): readonly [string, string] | null {
  if (ch === "i" || ch === "İ") return ["i", "İ"];
  if (ch === "ı" || ch === "I") return ["ı", "I"];
  return null;
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
    push(upperTr(term));
    push(lowerTr(term));
    // ⭐ BAŞLIK DÜZENİ — normalize EDİLMEYEN yarının olağan yazımı
    // ("Ege Kumaş İthalat", "T. İş Bankası").
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
 * Türkçe-duyarlı `contains` OR koşulları üretir (ESKİ YOL — bkz. yukarıdaki blok).
 * paths nokta-notasyonu ile nested relation destekler ("customer.name").
 *
 * DİKKAT: boş term/paths → [] döner; boş [] doğrudan `.OR`'a atanırsa Prisma
 * HİÇBİR kaydı eşlemez → çağıran mutlaka `if (search)` guard'ını korumalı.
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
