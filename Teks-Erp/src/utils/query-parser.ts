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
   * KOD ALANLARI — yalnız terim KOD BİÇİMİNDEYSE aramaya katılır ve Türkçe
   * denklik varyantlarına AÇILMAZ (bkz. `buildCodeSearch`).
   *
   * Neden ayrı: bu alanlar tipik olarak derin ilişkilerin ucundadır (siparişten
   * iş emri numarasına gitmek order_lines + pivot + work_orders üzerinden bir
   * semi-join ister). Ölçüldü (2026-08-17, EXPLAIN ANALYZE): PostgreSQL bunu
   * satır başına değil TEK GEÇİŞTE çözüyor (`hashed SubPlan`) — yani maliyet
   * eklenir, çarpılmaz. Ama her Türkçe varyant AYRI bir semi-join doğurur;
   * "gülşen" gibi bir müşteri aramasında ~20 varyant × ilişki taraması boşuna
   * ödenirdi. Kod alanları bu yüzden yalnız kod-biçimli terimde koşar.
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

  // Full-text search — Türkçe-duyarlı (Y-2/Y-3: C-locale ILIKE İ/ı/ğ/ş katlamaz).
  if (search && searchFields && searchFields.length > 0) {
    const leaves = buildTurkishSearch(search, searchFields);
    if (codeSearchFields && codeSearchFields.length > 0) {
      leaves.push(...buildCodeSearch(search, codeSearchFields));
    }
    where.OR = leaves;
  }

  return where;
}

// ── Türkçe-duyarlı arama (C-locale ILIKE İ/ı/ğ/ş/ç/ö/ü KATLAMAZ) ──────────────
// PG C-locale'de mode:"insensitive" (ILIKE) YALNIZ ASCII a-z↔A-Z katlar; Türkçe
// çiftlerini (i↔İ, ı↔I, ç↔Ç, ğ↔Ğ, ö↔Ö, ş↔Ş, ü↔Ü) eşlemez. Adlar BÜYÜK saklanır
// (name-normalize.helper) → küçük harfli arama sessizce boş döner. Çözüm: her alan
// için ILIKE (ASCII fold) + Türkçe BÜYÜK ve KÜÇÜK case-sensitive varyantları.
const TR_FOLD = /[iıİIçÇğĞöÖşŞüÜ]/;

// ── Türkçe harf DENKLİĞİ (2026-08-17 saha talebi) ────────────────────────────
// "cisem" · "CISEM" · "ÇİSEM" · "çisem" AYNI sonucu vermeli. Yukarıdaki case
// katlaması bunu çözmez: o yalnız BÜYÜK/küçük farkını kapatır, `c` ile `ç`yi
// AYRI harf saymaya devam eder.
//
// Sütunu katlayamıyoruz (Prisma `contains` bir ILIKE üretir; `translate()`/
// `unaccent()` gibi ifadeler where cümlesine giremez), o yüzden TERİMİ
// varyantlarına açıyoruz. Kalıcı çözüm PostgreSQL `unaccent` + ifade index'i
// ve aramanın raw SQL'e taşınmasıdır (~40 çağrı noktası) — bugünkü hacimde
// gerekmiyor, gerektiğinde buradaki sözleşme korunarak değiştirilebilir.
//
// Seçenekler neden BÜYÜK Türkçe harf: adlar/kodlar DB'ye BÜYÜK yazılıyor
// (name-normalize.helper), ASCII seçeneği de `mode:"insensitive"` sayesinde
// hem `c` hem `C`yi yakalıyor. Küçük Türkçe (ç, ğ, ı…) yazımı için ayrıca tek
// bir "tümü küçük" varyantı eklenir — kombinasyona sokulmaz, çünkü maliyeti
// ikiye katlar ve pratikte serbest metin alanlarında karşılığı olur.
const TR_EQUIV: Record<string, string> = {
  c: "Ç",
  g: "Ğ",
  i: "İ",
  o: "Ö",
  s: "Ş",
  u: "Ü",
};
/** Küçük yazım karşılıkları — `i` → `ı` (dotsuz), `İ` → `i` DEĞİL. */
const TR_EQUIV_LOWER: Record<string, string> = {
  c: "ç",
  g: "ğ",
  i: "ı",
  o: "ö",
  s: "ş",
  u: "ü",
};
/** Türkçe harfi ASCII karşılığına indirger (varyant üretiminin ortak anahtarı). */
const TR_TO_ASCII: Record<string, string> = {
  ç: "c", Ç: "c",
  ğ: "g", Ğ: "g",
  ı: "i", İ: "i", I: "i",
  ö: "o", Ö: "o",
  ş: "s", Ş: "s",
  ü: "u", Ü: "u",
};
/**
 * Kaç konumda dallanılacağı. 4 → en fazla 16 varyant; her varyant her alan için
 * bir ILIKE demek, yani 6 alanlı bir aramada ~100 koşul. Sınır AŞILIRSA fazlası
 * dallanmaz (ASCII hâliyle kalır) — sonuç daralır ama sorgu patlamaz. Sessiz
 * değil: bilinçli ve belgeli bir azalma.
 */
const TR_MAX_FOLD_POSITIONS = 4;
/**
 * Aile başına varyant tavanı. Üst sınır: 2 aile × 2^4 + 2 (tam katlama) + 2
 * (Türkçe büyük/küçük) + 1 (terimin kendisi) = 39 yaprak; altı alanlı bir
 * aramada ~230 ILIKE koşulu. Sorgu planı seq scan olduğu için maliyet
 * doğrusaldır ve bu hacimde ölçülebilir bir gecikme üretmiyor.
 */
const TR_MAX_VARIANTS = 32;

/** Terimi Türkçe denklik varyantlarına açar (kendisi HARİÇ). */
function turkishEquivalents(term: string): string[] {
  const chars = [...term];
  // Dallanılacak konumlar: ASCII karşılığı TR_EQUIV'de olan her harf.
  const positions: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ascii = TR_TO_ASCII[chars[i]] ?? chars[i].toLowerCase();
    if (TR_EQUIV[ascii]) positions.push(i);
  }
  if (positions.length === 0) return [];
  const folded = positions.slice(0, TR_MAX_FOLD_POSITIONS);

  // ASCII tabanı: her katlanabilir harf ASCII'ye indirgenir (ILIKE büyük/küçüğü
  // zaten kapatır), sonra seçili konumlar tek tek Türkçe harfe çevrilir.
  const base = chars.map((c) => TR_TO_ASCII[c] ?? c);

  /**
   * Bir konumun seçenekleri. `i` ÜÇ seçenek alır (ASCII + `İ` + `ı`): tekstil
   * verisinde en sık karışan çift budur ve dotsuz `ı` yalnız "tümü küçük"
   * varyantında kalsaydı "isitma" → "ISITMA"yı bulur, "cısem"i bulamazdı.
   * Diğer harflerde BÜYÜK Türkçe yeter (adlar/kodlar büyük saklanıyor);
   * küçük yazımı aşağıdaki tek "tümü küçük" varyantı karşılar.
   */
  /**
   * Türkçe karşılık. ⚠️ Anahtar KÜÇÜK harf olmalı: `TR_TO_ASCII` yalnız Türkçe
   * harfleri çevirir, `"C"` gibi BÜYÜK ASCII harfler olduğu gibi kalır ve
   * `TR_EQUIV["C"]` undefined döner → o konum varyantta SİLİNİRDİ ("CISEM" →
   * "iSEM"). Sessiz ve zehirli bir hata: arama daha ÇOK sonuç bulur, sebebi
   * hiçbir yerde görünmez.
   */
  const equivAt = (idx: number, upper: boolean): string | null => {
    const key = base[idx].toLocaleLowerCase("tr-TR");
    return (upper ? TR_EQUIV[key] : TR_EQUIV_LOWER[key]) ?? null;
  };

  const out = new Set<string>();

  // İKİ AİLE: "tümü BÜYÜK Türkçe" ve "tümü küçük Türkçe". Aynı konumda hem `Ç`
  // hem `ç` denemek kombinasyonu üçe katlardı; oysa gerçek veride yazım kendi
  // içinde tutarlıdır (adlar/kodlar BÜYÜK normalize edilir, serbest metin
  // küçük yazılır). Karışık yazım ("Çişem") bilinçli olarak kapsam dışı.
  for (const upper of [true, false]) {
    let combos: string[][] = [[...base]];
    for (const idx of folded) {
      const eq = equivAt(idx, upper);
      if (!eq) continue;
      const next: string[][] = [];
      for (const combo of combos) {
        next.push(combo);
        const v = [...combo];
        v[idx] = eq;
        next.push(v);
      }
      combos = next;
      if (combos.length >= TR_MAX_VARIANTS) break;
    }
    for (const combo of combos) out.add(combo.join(""));
  }

  // Sınırı aşan uzun kelimeler için TÜM konumları katlanmış iki varyant daha
  // ("gümüşoğlu" gibi baştan sona Türkçe yazımlar dallanma tavanına takılıp
  // hiç üretilmezdi — bu iki satır onları doğrusal maliyetle kurtarır).
  if (positions.length > folded.length) {
    for (const upper of [true, false]) {
      const v = [...base];
      for (const idx of positions) {
        const eq = equivAt(idx, upper);
        if (eq) v[idx] = eq;
      }
      out.add(v.join(""));
    }
  }
  out.delete(term);
  return [...out];
}

/** "a.b.c" → { a: { b: { c: leaf } } } (list-relation `some` dahil düz iç içe). */
function nestPath(path: string, leaf: unknown): Record<string, unknown> {
  const segs = path.split(".");
  let node: unknown = leaf;
  for (let i = segs.length - 1; i >= 0; i--) node = { [segs[i]]: node };
  return node as Record<string, unknown>;
}

/**
 * Türkçe-duyarlı `contains` OR koşulları üretir. paths nokta-notasyonu ile nested
 * relation destekler ("customer.name", "sacks.some.sackNo").
 * DİKKAT: boş term/paths → [] döner; boş [] doğrudan `.OR`'a atanırsa Prisma HİÇBİR
 * kaydı eşlemez → çağıran mutlaka `if (search)` guard'ını korumalı.
 */
export function buildTurkishSearch<T = Record<string, unknown>>(
  search: string,
  paths: readonly string[]
): T[] {
  const term = search.trim();
  if (!term || paths.length === 0) return [];
  const leaves: Record<string, unknown>[] = [{ contains: term, mode: "insensitive" }];
  // KOD BİÇİMLİ TERİMDE VARYANT ÜRETME. Belge numaralarımızın hiçbirinde Türkçe
  // harf yok (İE/SIP/CV/RK/FS/P + tarih + sıra) — onlar için varyant üretmek
  // sorguyu boşuna kabartır. Ölçüldü (2026-08-17): "IE2007260001" araması 20 OR
  // dalından 5'e iner. Süzgeç DAR: boşluksuz + rakam içeren + yalnız
  // ASCII harf/rakam/ayraç. "PATOS 300" gibi karışık bir terim BU DALA GİRMEZ
  // (boşluk var) → adın Türkçe varyantları üretilmeye devam eder.
  if (/^[A-Za-z0-9._/-]+$/.test(term) && /\d/.test(term)) {
    const clauses: Record<string, unknown>[] = [];
    for (const path of paths) clauses.push(nestPath(path, leaves[0]));
    return clauses as unknown as T[];
  }
  const seen = new Set<string>([term]);
  const push = (v: string, insensitive: boolean) => {
    if (seen.has(v)) return;
    seen.add(v);
    leaves.push(insensitive ? { contains: v, mode: "insensitive" } : { contains: v });
  };
  if (TR_FOLD.test(term)) {
    // Türkçe BÜYÜK/küçük katlaması (C-locale ILIKE bunu yapmaz).
    push(term.toLocaleUpperCase("tr-TR"), false);
    push(term.toLocaleLowerCase("tr-TR"), false);
  }
  // Türkçe harf DENKLİĞİ — `c`↔`ç`, `s`↔`ş`, `i`↔`ı`… Varyantlar `insensitive`
  // ile eklenir: içlerindeki ASCII harfler yine büyük/küçük bağımsız eşleşsin.
  for (const v of turkishEquivalents(term)) push(v, true);
  const clauses: Record<string, unknown>[] = [];
  for (const path of paths) {
    for (const leaf of leaves) clauses.push(nestPath(path, leaf));
  }
  return clauses as unknown as T[];
}

/**
 * KOD ARAMASI — belge/kayıt numaraları için dar ve ucuz eşleşme.
 *
 * İki farkı var ve ikisi de bilinçli:
 *   1. Terim KOD BİÇİMİNDE değilse HİÇ koşmaz (boş dizi). Kod biçimi = en az
 *      bir RAKAM içeriyor. Numaralarımızın tamamı (İE/SIP/CV/RK/FS/P + tarih +
 *      sıra) rakam taşır; "gülşen" gibi bir ad taşımaz. Böylece ad araması,
 *      derin ilişki taramasının bedelini ödemez.
 *   2. Türkçe DENKLİK varyantına açılmaz — kodlarda ç/ş/ğ yok. Yalnız
 *      `mode:"insensitive"` (ASCII büyük/küçük) uygulanır. Bu, tek bir
 *      semi-join demektir; varyant başına bir tane değil.
 */
export function buildCodeSearch<T = Record<string, unknown>>(
  search: string,
  paths: readonly string[]
): T[] {
  const term = search.trim();
  if (!term || paths.length === 0) return [];
  if (!/\d/.test(term)) return [];
  return paths.map(
    (path) => nestPath(path, { contains: term, mode: "insensitive" }) as unknown as T
  );
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
