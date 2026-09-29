// Rapor isteği: istenebilir liste fabrikanın `rapor-katalogu` anlık kaydından okunur; aile → izin
// eşlemesi bulut kataloğunun aynasıdır (ayna bekçisi `patron/sunucu/src/catalog/reports.ts` ile ölçer).
// Parametreler fabrikanın kendi şemasıyla yeniden doğrulanır; uygulama yalnız tarih aralığı + ek alan toplar.
import { trDateToIso } from "./forms";

export const REPORT_FAMILY_PERMISSION: Readonly<Record<string, string>> = {
  sales: "bulut:siparis:oku",
  customer: "bulut:siparis:oku",
  inventory: "bulut:stok:oku",
  production: "bulut:uretim:oku",
  quality: "bulut:uretim:oku",
  dokuma: "bulut:uretim:oku",
  subcontract: "bulut:uretim:oku",
  finance: "bulut:cari-bakiye:oku",
};

export const REPORTS_NOT_IN_CLOUD: readonly string[] = ["audit/*", "production/operator-performance"];

export interface CatalogEntry {
  readonly anahtar: string;
  readonly baslik: string;
  readonly aile: string;
  readonly parametreler: unknown;
}

export function catalogEntries(veri: unknown): CatalogEntry[] {
  const list = (veri as { raporlar?: unknown } | null)?.raporlar;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is CatalogEntry => typeof e?.anahtar === "string" && typeof e?.baslik === "string");
}

/** Hesap bu raporu isteyebilir mi (fail-closed: bilinmeyen aile = hayır). */
export function requestable(key: string, perms: readonly string[]): boolean {
  if (!perms.includes("bulut:rapor:oku")) return false;
  const family = key.split("/")[0] ?? "";
  if (REPORTS_NOT_IN_CLOUD.includes(key) || REPORTS_NOT_IN_CLOUD.includes(`${family}/*`)) return false;
  const p = REPORT_FAMILY_PERMISSION[family];
  return p !== undefined && perms.includes(p);
}

/** Katalog girdisinin tarih dışı parametre adları (nesne anahtarları ya da ad dizisi). */
export function extraParamNames(parametreler: unknown): string[] {
  const names = Array.isArray(parametreler)
    ? parametreler.map((p) => (typeof p === "string" ? p : typeof p?.ad === "string" ? p.ad : null))
    : typeof parametreler === "object" && parametreler !== null
      ? Object.keys(parametreler)
      : [];
  return names.filter((n): n is string => typeof n === "string" && n !== "dateFrom" && n !== "dateTo");
}

export type BuiltParams = { ok: true; params: Record<string, string> } | { ok: false; error: string };

/** Özel aralık: GG.AA.YYYY → fabrikanın `dateFrom`/`dateTo` (YYYY-MM-DD); boş aralık = raporun varsayılanı. */
export function buildReportParams(from: string, to: string, extra: Readonly<Record<string, string>>): BuiltParams {
  const a = trDateToIso(from);
  const b = trDateToIso(to);
  if (a === null || b === null) return { ok: false, error: "Tarih GG.AA.YYYY biçiminde olmalı" };
  if (a && b && a > b) return { ok: false, error: "Başlangıç bitişten sonra olamaz" };
  const params: Record<string, string> = {};
  if (a) params.dateFrom = a;
  if (b) params.dateTo = b;
  for (const [k, v] of Object.entries(extra)) if (v.trim() !== "") params[k] = v.trim();
  return { ok: true, params };
}
