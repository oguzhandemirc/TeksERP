// =============================================================================
// TeksERP - Dynamic Query Parser
// =============================================================================
// Converts frontend query params into Prisma-compatible where/orderBy/skip/take.
// Usage: GET /api/items?page=1&pageSize=20&sortBy=name&sortOrder=asc&filter[itemType]=YARN&search=poplin
// =============================================================================

import { Request } from "express";
import { QueryParams } from "../types/api.types";
import { AppError } from "./app-error";
import { decodeCursor } from "./cursor";
import type { Cursor } from "./cursor";

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

export interface CursorParams {
  cursor: Cursor | null;
  limit: number;
}

/**
 * Cursor pagination parametrelerini parse et.
 * `?cursor=<base64>&limit=50` formatı.
 * Cursor yoksa null (ilk sayfa). Limit MAX_PAGE_SIZE ile sınırlı.
 */
export function parseCursorParams(req: Request): CursorParams {
  const cursor = decodeCursor(req.query.cursor as string | undefined);
  const rawLimit = parseInt(req.query.limit as string, 10) || DEFAULT_PAGE_SIZE;
  if (rawLimit > MAX_PAGE_SIZE) {
    throw AppError.badRequest(
      `Limit (limit=${rawLimit}) en fazla ${MAX_PAGE_SIZE} olabilir.`
    );
  }
  const limit = Math.max(1, rawLimit);
  return { cursor, limit };
}

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

  // Full-text search — Türkçe-duyarlı (Y-2/Y-3: C-locale ILIKE İ/ı/ğ/ş katlamaz).
  if (search && searchFields && searchFields.length > 0) {
    where.OR = buildTurkishSearch(search, searchFields);
  }

  return where;
}

// ── Türkçe-duyarlı arama (C-locale ILIKE İ/ı/ğ/ş/ç/ö/ü KATLAMAZ) ──────────────
// PG C-locale'de mode:"insensitive" (ILIKE) YALNIZ ASCII a-z↔A-Z katlar; Türkçe
// çiftlerini (i↔İ, ı↔I, ç↔Ç, ğ↔Ğ, ö↔Ö, ş↔Ş, ü↔Ü) eşlemez. Adlar BÜYÜK saklanır
// (name-normalize.helper) → küçük harfli arama sessizce boş döner. Çözüm: her alan
// için ILIKE (ASCII fold) + Türkçe BÜYÜK ve KÜÇÜK case-sensitive varyantları.
const TR_FOLD = /[iıİIçÇğĞöÖşŞüÜ]/;

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
  if (TR_FOLD.test(term)) {
    const upper = term.toLocaleUpperCase("tr-TR");
    if (upper !== term) leaves.push({ contains: upper });
    const lower = term.toLocaleLowerCase("tr-TR");
    if (lower !== term && lower !== upper) leaves.push({ contains: lower });
  }
  const clauses: Record<string, unknown>[] = [];
  for (const path of paths) {
    for (const leaf of leaves) clauses.push(nestPath(path, leaf));
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
