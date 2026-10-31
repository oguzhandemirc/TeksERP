// Rapor isteği: istenebilir liste fabrikanın `rapor-katalogu` anlık kaydından okunur; anahtar → izin
// eşlemesi bulut kataloğunun aynasıdır (ayna bekçisi `patron/sunucu/src/catalog/reports.ts` ile ölçer).
// Parametreler fabrikanın kendi şemasıyla yeniden doğrulanır; uygulama yalnız tarih aralığı + ek alan toplar.
import type { RaporSunumu } from "../api/wire";
import { trDateToIso } from "./forms";

export const REPORT_KEY_PERMISSION: Readonly<Record<string, string>> = {
  "sales/order-intake": "bulut:siparis:oku",
  "sales/shipment-scorecard": "bulut:sevkiyat:oku",
  "customer/scorecard": "bulut:siparis:oku",
  "quality/scorecard": "bulut:uretim:oku",
  "subcontract/scorecard": "bulut:uretim:oku",
  "inventory/scorecard": "bulut:stok:oku",
  "finance/aging": "bulut:cari-bakiye:oku",
  "finance/cheque-due": "bulut:cek:oku",
  // Raporlar v2 temel raporları (R1-BULUT)
  "sales/siparis-talep": "bulut:siparis:oku",
  "sales/sevkiyat": "bulut:sevkiyat:oku",
  "sales/termin": "bulut:sevkiyat:oku",
  "sales/acik-siparisler": "bulut:siparis:oku",
  "sales/vazgecilen-is": "bulut:siparis:oku",
  "quality/kalite": "bulut:uretim:oku",
  "quality/kayip": "bulut:uretim:oku",
  "inventory/depo": "bulut:stok:oku",
  "subcontract/fasoncular": "bulut:uretim:oku",
  "dokuma/tezgah-randimani": "bulut:uretim:oku",
  "dokuma/duruslar": "bulut:uretim:oku",
  "dokuma/levent-dengesi": "bulut:uretim:oku",
  "production/makine-duruslari": "bulut:uretim:oku",
  "finance/alacaklar": "bulut:cari-bakiye:oku",
  "maliyet/karlilik": "bulut:maliyet:oku",
};

export const REPORTS_NOT_IN_CLOUD: readonly string[] = ["audit/*", "production/operator-performance", "production/uretim-akisi"];

/**
 * Sonucu `RaporSunumu` olan (v2) anahtarlar — uygulama bunları `SunumGorunumu` ile basar. Uygulamanın TANIMADIĞI
 * anahtar listede çizilmez (`requestable` eşlemesi); eski uygulama yeni anahtarı görmez.
 */
export const PRESENTATION_REPORT_KEYS: readonly string[] = [
  "sales/siparis-talep",
  "sales/sevkiyat",
  "sales/termin",
  "sales/acik-siparisler",
  "sales/vazgecilen-is",
  "quality/kalite",
  "quality/kayip",
  "inventory/depo",
  "subcontract/fasoncular",
  "dokuma/tezgah-randimani",
  "dokuma/duruslar",
  "dokuma/levent-dengesi",
  "production/makine-duruslari",
  "finance/alacaklar",
  "maliyet/karlilik",
];

export function isPresentationKey(key: string): boolean {
  return PRESENTATION_REPORT_KEYS.includes(key);
}

/** Sonuç fabrikanın kurduğu sunum zarfı mı (biçim yoksa jenerik görünüme düşülür — çökme yok). */
export function isPresentation(veri: unknown): veri is RaporSunumu {
  if (typeof veri !== "object" || veri === null) return false;
  const v = veri as Partial<Record<keyof RaporSunumu, unknown>>;
  const ana = v.anaSayi as { olcu?: unknown; ad?: unknown } | null | undefined;
  return typeof v.anahtar === "string" && typeof ana?.ad === "string" && Array.isArray(v.anlati) && Array.isArray(v.yanSayilar);
}

/** Aralık parametresinin adları: ISO raporlar `dateFrom/dateTo`, gün telli (dokuma) raporlar `from/to`; yoksa null. */
export function rangeParamNames(parametreler: unknown): readonly [string, string] | null {
  if (!Array.isArray(parametreler)) return null;
  if (parametreler.includes("dateFrom") || parametreler.includes("dateTo")) return ["dateFrom", "dateTo"];
  if (parametreler.includes("from") && parametreler.includes("to")) return ["from", "to"];
  return null;
}

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

/** Hesap bu raporu isteyebilir mi — izin RAPOR BAŞINA (fail-closed: bilinmeyen anahtar = hayır). */
export function requestable(key: string, perms: readonly string[]): boolean {
  if (!perms.includes("bulut:rapor:oku")) return false;
  const family = key.split("/")[0] ?? "";
  if (REPORTS_NOT_IN_CLOUD.includes(key) || REPORTS_NOT_IN_CLOUD.includes(`${family}/*`)) return false;
  const p = Object.prototype.hasOwnProperty.call(REPORT_KEY_PERMISSION, key) ? REPORT_KEY_PERMISSION[key] : undefined;
  return p !== undefined && perms.includes(p);
}

/** Katalog girdisinin tarih dışı parametre adları (nesne anahtarları ya da ad dizisi). */
export function extraParamNames(parametreler: unknown): string[] {
  const names = Array.isArray(parametreler)
    ? parametreler.map((p) => (typeof p === "string" ? p : typeof p?.ad === "string" ? p.ad : null))
    : typeof parametreler === "object" && parametreler !== null
      ? Object.keys(parametreler)
      : [];
  const range = rangeParamNames(parametreler) ?? ["dateFrom", "dateTo"];
  return names.filter((n): n is string => typeof n === "string" && n !== "dateFrom" && n !== "dateTo" && !range.includes(n));
}

export type BuiltParams = { ok: true; params: Record<string, string> } | { ok: false; error: string };

/**
 * Özel aralık: GG.AA.YYYY → fabrika günü (YYYY-MM-DD), raporun aralık adlarıyla (`dateFrom`/`dateTo` ya da `from`/`to`);
 * boş aralık = raporun varsayılanı. Gün sınırını fabrika çözer (uygulama tarih aritmetiği yapmaz).
 */
export function buildReportParams(
  from: string,
  to: string,
  extra: Readonly<Record<string, string>>,
  names: readonly [string, string] = ["dateFrom", "dateTo"],
): BuiltParams {
  const a = trDateToIso(from);
  const b = trDateToIso(to);
  if (a === null || b === null) return { ok: false, error: "Tarih GG.AA.YYYY biçiminde olmalı" };
  if (a && b && a > b) return { ok: false, error: "Başlangıç bitişten sonra olamaz" };
  const params: Record<string, string> = {};
  if (a) params[names[0]] = a;
  if (b) params[names[1]] = b;
  for (const [k, v] of Object.entries(extra)) if (v.trim() !== "") params[k] = v.trim();
  return { ok: true, params };
}
