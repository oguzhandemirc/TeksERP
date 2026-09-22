// =============================================================================
// Barkod türü sınıflandırıcı — tablo SUNUCUDAN gelir (2026-09-22, Faz B)
// =============================================================================
// ESKİDEN: 12 regex bu dosyada SABİTTİ ve backend `search.service`te elle
// yazılmış bir ikizi vardı. Ön ek bir gün değişirse eski panel 400/404 vermez,
// SESSİZCE yanlış dala düşerdi — çuval kodunu top sanıp "Top bulunamadı" derdi.
// ARTIK: biçim `GET /api/scan/series`ten gelir; bu dosya yalnız tabloyu
// UYGULAR, biçimi BİLMEZ.
//
// ⚠️ ÜÇ KATMAN, FAIL-SAFE (fail-closed DEĞİL, ve bu BEYANLI bir karardır):
//     ① sunucu tablosu (giriş sonrası çekilir)
//     ② yerel kopya (`localStorage`, son başarılı tablo)
//     ③ YEDEK: aşağıdaki sabit tablo (= bugünkü davranış)
//   Okutma yolu fail-closed YAPILMAZ. "Tablo gelmedi" hâlinde okutmayı
//   reddetmek, ağ bir saniye takıldığında bütün fabrikayı durdururdu; yedek
//   ise bugünkü davranıştır. Kesin kararı zaten backend lookup ucu (404) verir.
//
// Sınıflandırma PREFIX-ÇAPALI (gevşek): format bozuk olsa da doğru türe
// yönlenir. Tam-format testi ayrı fonksiyondur (`matchesFullFormat`).
// =============================================================================
import apiClient from "@/services/apiClient";

export type BarcodeKind =
  | "ROLL"
  | "TRAVELER_CARD"
  | "SWATCH"
  | "SACK"
  | "SHIPMENT"
  | "DISPATCH_DOC"
  | "UNKNOWN";

/** `GET /api/scan/series` satırı — backend `SeriesClassifierRow` aynası. */
export interface ScanSeriesRow {
  key: string;
  kind: Exclude<BarcodeKind, "UNKNOWN">;
  /** Yürürlükteki ön ek ÖNCE, emekliler sonra. */
  prefixes: string[];
  dateSegment: "NONE" | "DDMMYY" | "YYMM" | "YYYYMM" | "YY" | "YYYY";
  digits: number;
  separator: string;
  /** Tarih ile sıra ARASINDAKİ sabit parça (top barkodunun faz harfi `[HF]`). */
  infix?: string;
}

/**
 * ③ YEDEK TABLO — sunucuya hiç ulaşılamadığında kullanılan, bugünkü biçim.
 * Backend `number-series-catalog.ts` tohumlarının aynası; `barcode-kind.test.ts`
 * iki tarafı METİN olarak birebirler (ayna sessizce bayatlamasın).
 */
export const FALLBACK_SERIES: readonly ScanSeriesRow[] = [
  { key: "roll", kind: "ROLL", prefixes: ["T"], dateSegment: "DDMMYY", digits: 4, separator: "", infix: "[HF]" },
  { key: "workOrder", kind: "TRAVELER_CARD", prefixes: ["IE", "RK"], dateSegment: "DDMMYY", digits: 4, separator: "" },
  { key: "swatch", kind: "SWATCH", prefixes: ["KRT"], dateSegment: "DDMMYY", digits: 4, separator: "" },
  { key: "sack", kind: "SACK", prefixes: ["CV"], dateSegment: "DDMMYY", digits: 4, separator: "" },
  { key: "shipment", kind: "SHIPMENT", prefixes: ["SVK"], dateSegment: "DDMMYY", digits: 4, separator: "" },
  { key: "subcontractorDispatch", kind: "DISPATCH_DOC", prefixes: ["FS"], dateSegment: "DDMMYY", digits: 4, separator: "" },
  { key: "subcontractorReceipt", kind: "DISPATCH_DOC", prefixes: ["FK"], dateSegment: "DDMMYY", digits: 4, separator: "" },
  { key: "kartelaDispatch", kind: "DISPATCH_DOC", prefixes: ["KS"], dateSegment: "DDMMYY", digits: 4, separator: "" },
  { key: "kartelaReceipt", kind: "DISPATCH_DOC", prefixes: ["KK"], dateSegment: "DDMMYY", digits: 4, separator: "" },
];

const STORAGE_KEY = "tekserp.scanSeries.v1";
const DATE_LEN: Record<ScanSeriesRow["dateSegment"], number> = {
  NONE: 0,
  DDMMYY: 6,
  YYMM: 4,
  YYYYMM: 6,
  YY: 2,
  YYYY: 4,
};

export type ScanSeriesSource = "server" | "cache" | "fallback";

let table: readonly ScanSeriesRow[] = FALLBACK_SERIES;
let source: ScanSeriesSource = "fallback";

function isRow(v: unknown): v is ScanSeriesRow {
  const r = v as Partial<ScanSeriesRow> | null;
  return (
    !!r &&
    typeof r.key === "string" &&
    typeof r.kind === "string" &&
    Array.isArray(r.prefixes) &&
    r.prefixes.length > 0 &&
    r.prefixes.every((p) => typeof p === "string" && p.length > 0) &&
    typeof r.digits === "number" &&
    r.digits >= 1 &&
    typeof r.separator === "string" &&
    typeof r.dateSegment === "string" &&
    r.dateSegment in DATE_LEN
  );
}

/** ② Yerel kopya — okuma da yazma da best-effort; bozuk kayıt sessizce atlanır. */
function readCache(): readonly ScanSeriesRow[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isRow)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(rows: readonly ScanSeriesRow[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    /* kota/özel pencere — tablo bellekte zaten var, yazamamak okutmayı durdurmaz */
  }
}

const cached = readCache();
if (cached) {
  table = cached;
  source = "cache";
}

/**
 * ① Sunucu tablosunu çek. Giriş SONRASI çağrılır (uç `verifyToken` ister).
 * Düşerse sessizce mevcut katmanda kalınır — okutma yolu kapanmaz.
 */
export async function loadScanSeries(): Promise<ScanSeriesSource> {
  try {
    const res = await apiClient.get<{ success: boolean; data: ScanSeriesRow[] }>("/api/scan/series");
    const rows = res.data?.data;
    if (Array.isArray(rows) && rows.length > 0 && rows.every(isRow)) {
      table = rows;
      source = "server";
      writeCache(rows);
    }
  } catch {
    /* ağ/401 — yedek ya da yerel kopya yerinde kalır */
  }
  return source;
}

/** Hangi katman kullanılıyor — tanı ekranı ve bekçi için. */
export function scanSeriesSource(): ScanSeriesSource {
  return source;
}

/** Test/oturum kapanışı kaçışı — bir sonraki okuma yedeğe düşer. */
export function resetScanSeries(): void {
  table = FALLBACK_SERIES;
  source = "fallback";
}

export function scanSeriesTable(): readonly ScanSeriesRow[] {
  return table;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Gevşek ön ek çapası: ön ekten SONRA ya ayraç ya rakam gelmeli.
 *
 * ⚠️ Eski tabloda bu koruma yalnız `T` ve `IE` için vardı (`/^T\d/`, `/^IE\d/`),
 * çünkü tek-iki harfli ön ek "TEKSTİL BEYAZ" gibi bir metni barkod sayardı.
 * Tabloyla gelen bir ön ek için elle istisna yazılamaz, bu yüzden koruma
 * HEPSİNE uygulanır — sonuç yalnız YANLIŞ eşleşmeyi azaltır (gerçek kodların
 * hepsinde ön ekten sonra tarih rakamı ya da ayraç vardır).
 */
function prefixAnchor(row: ScanSeriesRow, prefix: string): RegExp {
  const next = row.separator === "" ? "\\d" : `(?:${escapeRe(row.separator)}|\\d)`;
  return new RegExp(`^${escapeRe(prefix)}${next}`);
}

/** Tam-format regex'i — hane ESNEK (`\d{digits,}`): 9999'u aşan gün kodu da geçer. */
function fullFormat(row: ScanSeriesRow, prefix: string): RegExp {
  const sep = row.separator === "" ? "" : escapeRe(row.separator);
  const len = DATE_LEN[row.dateSegment];
  const head = len === 0 ? `${escapeRe(prefix)}${sep}` : `${escapeRe(prefix)}${sep}\\d{${len}}${sep}`;
  return new RegExp(`^${head}${row.infix ?? ""}\\d{${row.digits},}$`);
}

export interface ClassifiedBarcode {
  kind: BarcodeKind;
  /** Normalize edilmiş kod (trim + uppercase). */
  code: string;
  /** Eşleşen serinin anahtarı (`sack`, `workOrder` …); tanınmazsa null. */
  key: string | null;
}

/** Ham taranan string'i türe ayır. Bilinmeyen ön ek → UNKNOWN. */
export function classifyBarcode(raw: string): ClassifiedBarcode {
  const code = raw.trim().toUpperCase();
  // Uzun/özgül ön ek ÖNCE: `KRT` ile `K…` karışmasın. Sunucu kapısı
  // (`assertSeriesFormatAllowed ③`) iki ön ekin birbirinin başlangıcı olmasını
  // zaten reddeder; sıralama o kapı bir gün gevşerse diye savunma katmanıdır.
  const rows = [...table].sort((a, b) => maxPrefixLen(b) - maxPrefixLen(a));
  for (const row of rows) {
    for (const prefix of row.prefixes) {
      if (prefixAnchor(row, prefix).test(code)) return { kind: row.kind, code, key: row.key };
    }
  }
  return { kind: "UNKNOWN", code, key: null };
}

function maxPrefixLen(row: ScanSeriesRow): number {
  return Math.max(...row.prefixes.map((p) => p.length));
}

/**
 * Kod, türünün TAM formatına uyuyor mu? (`BARCODE_FORMATS.X.test()` yerine.)
 * Gevşek sınıflandırmanın aksine burada hane/tarih de doğrulanır — "TEKSTİL
 * BEYAZ" gibi bir metnin yanlışlıkla detay açması böyle engellenir.
 */
export function matchesFullFormat(kind: Exclude<BarcodeKind, "UNKNOWN">, code: string): boolean {
  const normalized = code.trim().toUpperCase();
  for (const row of table) {
    if (row.kind !== kind) continue;
    for (const prefix of row.prefixes) {
      if (fullFormat(row, prefix).test(normalized)) return true;
    }
  }
  return false;
}

/**
 * Sunucuya TEK KOD sor — tablo tanımadığında son adım (ör. panel açıkken
 * emekliye ayrılmış bir ön ek). Düşerse UNKNOWN; TAHMİN YÜRÜTÜLMEZ.
 */
export async function resolveBarcodeOnServer(code: string): Promise<ClassifiedBarcode> {
  const normalized = code.trim().toUpperCase();
  try {
    const res = await apiClient.get<{ data: { code: string; kind: BarcodeKind; key: string | null } }>(
      "/api/scan/resolve",
      { params: { code: normalized } },
    );
    const d = res.data?.data;
    if (d && typeof d.kind === "string") return { kind: d.kind, code: d.code ?? normalized, key: d.key ?? null };
  } catch {
    /* ağ — aşağıda UNKNOWN */
  }
  return { kind: "UNKNOWN", code: normalized, key: null };
}
