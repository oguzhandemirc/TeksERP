// =============================================================================
// OKUTMA SERİ TABLOSU — tablet biçim BİLMEZ (2026-09-22, Faz B)
// =============================================================================
// Fabrikanın kuralı zaten yazılıydı: "numarayı sunucu üretir, tablet hiç
// hesaplamaz" (`featureFlag.service.ts`, paketleme grubu numarası). Okutma
// tarafı bu kuraldan muaf kalmıştı: üç ekranda ön ek REGEX olarak sabitti
// (`/^CV\d{10}$/` · `/^KRT/` · `/^T\d/` · `/^(IE|RK)/`). Ön ek bir gün
// değişirse eski tablet 400/404 vermez, SESSİZCE yanlış dala düşerdi.
//
// ⚠️ ÇEVRİMDIŞI: tablo React Query ile çekilir ve anahtarı BOOTSTRAP listesinde
// olduğu için AsyncStorage'a persist edilir — ağsız açılışta son bilinen tablo
// kullanılır. Hiç tablo yoksa YEDEK (bugünkü biçim) devreye girer; okutma yolu
// fail-closed DEĞİLDİR, çünkü "tablo yok" diye okutmayı kesmek sahayı durdurur.
// =============================================================================
import { apiClient } from './api';

export type ScanKind =
  | 'ROLL'
  | 'TRAVELER_CARD'
  | 'SWATCH'
  | 'SACK'
  | 'SHIPMENT'
  | 'DISPATCH_DOC';

export type ScanDateSegment = 'NONE' | 'DDMMYY' | 'YYMM' | 'YYYYMM' | 'YY' | 'YYYY';

/** `GET /api/scan/series` satırı — backend `SeriesClassifierRow` aynası. */
export interface ScanSeriesRow {
  key: string;
  kind: ScanKind;
  /** Yürürlükteki ön ek ÖNCE, emekliler sonra. */
  prefixes: string[];
  dateSegment: ScanDateSegment;
  digits: number;
  separator: string;
  /** Tarih ile sıra ARASINDAKİ sabit parça (top barkodunun faz harfi `[HF]`). */
  infix?: string;
}

/** Sunucuya hiç ulaşılamadığında kullanılan bugünkü biçim (backend tohumlarının aynası). */
export const FALLBACK_SCAN_SERIES: readonly ScanSeriesRow[] = [
  { key: 'roll', kind: 'ROLL', prefixes: ['T'], dateSegment: 'DDMMYY', digits: 4, separator: '', infix: '[HF]' },
  { key: 'workOrder', kind: 'TRAVELER_CARD', prefixes: ['IE', 'RK'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
  { key: 'swatch', kind: 'SWATCH', prefixes: ['KRT'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
  { key: 'sack', kind: 'SACK', prefixes: ['CV'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
  { key: 'shipment', kind: 'SHIPMENT', prefixes: ['SVK'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
  { key: 'subcontractorDispatch', kind: 'DISPATCH_DOC', prefixes: ['FS'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
  { key: 'subcontractorReceipt', kind: 'DISPATCH_DOC', prefixes: ['FK'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
  { key: 'kartelaDispatch', kind: 'DISPATCH_DOC', prefixes: ['KS'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
  { key: 'kartelaReceipt', kind: 'DISPATCH_DOC', prefixes: ['KK'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
];

const DATE_LEN: Record<ScanDateSegment, number> = {
  NONE: 0,
  DDMMYY: 6,
  YYMM: 4,
  YYYYMM: 6,
  YY: 2,
  YYYY: 4,
};

function isRow(v: unknown): v is ScanSeriesRow {
  const r = v as Partial<ScanSeriesRow> | null;
  return (
    !!r &&
    typeof r.key === 'string' &&
    typeof r.kind === 'string' &&
    Array.isArray(r.prefixes) &&
    r.prefixes.length > 0 &&
    r.prefixes.every((p) => typeof p === 'string' && p.length > 0) &&
    typeof r.digits === 'number' &&
    r.digits >= 1 &&
    typeof r.separator === 'string' &&
    typeof r.dateSegment === 'string' &&
    r.dateSegment in DATE_LEN
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Gevşek ön ek çapası: ön ekten SONRA ya ayraç ya rakam gelmeli.
 * Tek-iki harfli ön ek (`T`) olmasa "TEKSTİL BEYAZ" gibi bir metni barkod sayardı.
 */
function prefixAnchor(row: ScanSeriesRow, prefix: string): RegExp {
  const next = row.separator === '' ? '\\d' : `(?:${escapeRe(row.separator)}|\\d)`;
  return new RegExp(`^${escapeRe(prefix)}${next}`, 'i');
}

/** Tam-format regex'i — hane ESNEK (`\d{digits,}`): 9999'u aşan gün kodu da geçer. */
function fullFormat(row: ScanSeriesRow, prefix: string): RegExp {
  const sep = row.separator === '' ? '' : escapeRe(row.separator);
  const len = DATE_LEN[row.dateSegment];
  const head = len === 0 ? `${escapeRe(prefix)}${sep}` : `${escapeRe(prefix)}${sep}\\d{${len}}${sep}`;
  return new RegExp(`^${head}${row.infix ?? ''}\\d{${row.digits},}$`, 'i');
}

export interface ScanClassification {
  kind: ScanKind | 'UNKNOWN';
  key: string | null;
  /** Normalize edilmiş kod (trim + büyük harf). */
  code: string;
}

/** Ön ek çapalı sınıflandırma — uzun ön ek ÖNCE (KRT ↔ KK/KS karışmasın). */
export function classifyWithTable(rows: readonly ScanSeriesRow[], raw: string): ScanClassification {
  const code = raw.trim().toUpperCase();
  const sorted = [...rows].sort(
    (a, b) => Math.max(...b.prefixes.map((p) => p.length)) - Math.max(...a.prefixes.map((p) => p.length)),
  );
  for (const row of sorted) {
    for (const prefix of row.prefixes) {
      if (prefixAnchor(row, prefix).test(code)) return { kind: row.kind, key: row.key, code };
    }
  }
  return { kind: 'UNKNOWN', key: null, code };
}

/** Kod, türünün TAM formatına uyuyor mu? (Gevşek çapadan AYRI soru.) */
export function matchesFullFormatWithTable(
  rows: readonly ScanSeriesRow[],
  kind: ScanKind,
  raw: string,
): boolean {
  const code = raw.trim().toUpperCase();
  for (const row of rows) {
    if (row.kind !== kind) continue;
    for (const prefix of row.prefixes) {
      if (fullFormat(row, prefix).test(code)) return true;
    }
  }
  return false;
}

export const scanSeriesService = {
  /** Tabloyu çek. Bozuk/boş yanıt YEDEĞE düşer — okutma yolu kapanmaz. */
  async get(): Promise<ScanSeriesRow[]> {
    const res = await apiClient.get<{ success: boolean; data: ScanSeriesRow[] }>('/api/scan/series');
    const rows = res.data?.data;
    if (Array.isArray(rows) && rows.length > 0 && rows.every(isRow)) return rows;
    return [...FALLBACK_SCAN_SERIES];
  },

  /**
   * Tablo tanımadığında son adım — sunucuya TEK KOD sor. Ağ yoksa UNKNOWN;
   * tablet TAHMİN YÜRÜTMEZ (yanlış dal, gürültülü hatadan pahalıdır).
   */
  async resolve(raw: string): Promise<ScanClassification> {
    const code = raw.trim().toUpperCase();
    try {
      const res = await apiClient.get<{ data: { code: string; kind: ScanKind | 'UNKNOWN'; key: string | null } }>(
        '/api/scan/resolve',
        { params: { code } },
      );
      const d = res.data?.data;
      if (d && typeof d.kind === 'string') return { kind: d.kind, key: d.key ?? null, code: d.code ?? code };
    } catch {
      /* ağ — aşağıda UNKNOWN */
    }
    return { kind: 'UNKNOWN', key: null, code };
  },
};
