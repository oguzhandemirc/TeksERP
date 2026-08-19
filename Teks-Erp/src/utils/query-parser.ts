// =============================================================================
// TeksERP - Dynamic Query Parser
// =============================================================================
// Converts frontend query params into Prisma-compatible where/orderBy/skip/take.
// Usage: GET /api/items?page=1&pageSize=20&sortBy=name&sortOrder=asc&filter[itemType]=YARN&search=poplin
// =============================================================================

import { Request } from "express";
import { QueryParams } from "../types/api.types";
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
 * Performans notu: range query için `dateField` kolonunda index ŞART. Yoksa
 * büyük tabloda seq scan tetiklenir. Composite `[status, dateField]` ideal.
 */
export function applyDateRange(
  where: Record<string, unknown>,
  params: QueryParams,
  allowedFields: readonly string[]
): void {
  if (!params.dateField || !allowedFields.includes(params.dateField)) return;
  if (!params.dateFrom && !params.dateTo) return;
  const range: { gte?: Date; lte?: Date } = {};
  if (params.dateFrom) range.gte = params.dateFrom;
  if (params.dateTo) range.lte = params.dateTo;
  where[params.dateField] = range;
}

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
function isCodeLikeTerm(term: string): boolean {
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
