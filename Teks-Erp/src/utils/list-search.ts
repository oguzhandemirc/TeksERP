// =============================================================================
// Liste ucu metin araması — TEK boğaz (2026-11-12, "liste arama" turu).
//
// Neden ayrı dosya: arama eklenen otuza yakın uç aynı üç soruyu soruyordu —
// (1) parametre nasıl okunur (uzunluk sınırı, boş = yok), (2) Prisma yaprakları
// nasıl kurulur (katlanmış gölge ↔ kod ↔ gölgesiz eski yol), (3) sunucuda
// toplanmış satır bellekte nasıl süzülür. Her uç bunu kendi yazsaydı aynı
// sorunun otuz cevabı olurdu; motor `query-parser`daki iki emsaldir.
// =============================================================================
import { z } from "zod";
import { AppError } from "./app-error";
import { buildTextSearch, buildTurkishSearch } from "./query-parser";
import { foldSearchText, foldSearchTokens } from "./search-fold";

/** Liste araması en çok bu kadar karakter (emsal: sevkiyat/iplik `max(100)`). */
export const LIST_SEARCH_MAX = 100;

/** Zod parçası — `.strict()` sorgu şemalarına eklenir; boş/yalnız boşluk = arama yok. */
export const listSearchParam = z
  .string()
  .trim()
  .max(LIST_SEARCH_MAX, `Arama en çok ${LIST_SEARCH_MAX} karakter`)
  .optional()
  .transform((v) => (v ? v : undefined));

/** Zod'suz okuyan uçlar için aynı sözleşme: dizi/obje 400, uzun 400, boş → undefined. */
export function readListSearch(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") throw AppError.badRequest("Arama tek metin olmalı.", { code: "LIST_SEARCH_INVALID" });
  const v = raw.trim();
  if (v.length > LIST_SEARCH_MAX) {
    throw AppError.badRequest(`Arama en çok ${LIST_SEARCH_MAX} karakter`, { code: "LIST_SEARCH_TOO_LONG" });
  }
  return v || undefined;
}

/**
 * Aranacak yollar — kova AYRIMI çağıranın bilinçli kararıdır (bkz. `buildTextSearch`):
 * - `text`: `<kolon>Fold` gölgesi OLAN metin yolları (katlanmamış yazılır).
 * - `code`: BÜYÜK ASCII saklanan kod kolonları (yalnız kod biçimli terimde).
 * - `plain`: gölgesi OLMAYAN metin kolonları — Türkçe varyantlı ILIKE (eski yol;
 *   yalnız küçük tablolarda ya da dar süzgecin arkasında kullan).
 */
export interface ListSearchPaths {
  text?: readonly string[];
  code?: readonly string[];
  plain?: readonly string[];
}

/**
 * Prisma parçası `{ OR: [...] }` ya da `undefined` (arama yok). Çağıran where'ine
 * `AND` ile ekler; liste, cursor ve özet aynı where'den beslendiği için arama
 * özeti de süzer.
 */
export function listSearchWhere<T = Record<string, unknown>>(
  search: string | undefined,
  paths: ListSearchPaths
): { OR: T[] } | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  const leaves: T[] = [
    ...buildTextSearch<T>(term, { text: paths.text, code: paths.code }),
    ...(paths.plain?.length ? buildTurkishSearch<T>(term, paths.plain) : []),
  ];
  // Boş `OR: []` Prisma'da "hiçbir kayıt" demektir; terim yalnız jokerden ibaretse süzgeç yok sayılır (emsal).
  return leaves.length > 0 ? { OR: leaves } : undefined;
}

/**
 * Bellek-içi ikiz — sunucuda TOPLANMIŞ satırlar için (kokpit/özet uçları).
 * Her kelime değerlerden en az birinde katlanmış hâliyle geçmeli (AND); Prisma
 * yolu `buildTextSearch`in çok kelime davranışıyla aynı.
 */
export function matchesListSearch(search: string | undefined, values: ReadonlyArray<string | null | undefined>): boolean {
  const tokens = search ? foldSearchTokens(search) : [];
  if (tokens.length === 0) return true;
  const hay = values.filter((v): v is string => typeof v === "string" && v.length > 0).map(foldSearchText);
  return tokens.every((t) => hay.some((h) => h.includes(t)));
}

/**
 * Metin kolonu OLMAYAN enum alanı için: terime uyan enum değerleri (kod ya da
 * ekranda görünen etiket). Arama varken boş dizi = "eşleşen yok" (`in: []`).
 */
export function matchingEnumValues<E extends string>(search: string | undefined, labels: Readonly<Record<E, readonly string[]>>): E[] {
  return (Object.keys(labels) as E[]).filter((v) => matchesListSearch(search, [v, ...labels[v]]));
}
