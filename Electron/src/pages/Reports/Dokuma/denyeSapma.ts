// =============================================================================
// DENYE SAPMASI (Devere F2) — HTTP istemcisi + TEK kolon kurucusu (ekran tablosu ve Excel/PDF aynı listeden)
// =============================================================================
// Uç `/api/reports/dokuma/denye-sapma` (v2 katalog satırı; devere kapısı, `warpspec:read`); [Uygula] F1 ucunda
// (`/api/warp-specs/denier-deviation/apply`). İstemci HESAP YAPMAZ: sayılar sunucunun ondalık metinleri, burada yalnız biçimlenir.
// =============================================================================
import axios from "axios";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { formatDisplay } from "@/lib/format";
import type { ReportColumn, ReportExportSpec } from "../_components/reportExport";

export type DenierStatus = "SUGGEST" | "WITHIN_THRESHOLD" | "INSUFFICIENT";

export interface DenierRow {
  yarnItemId: string;
  code: string;
  name: string;
  beamCount: number;
  /** F6: darası gövde kartından alınan levent sayısı (eski sunucuda yok). */
  bodyTareBeamCount?: number;
  lengthM: string;
  nominalKg: string;
  weighedNetKg: string;
  deviationPct: string | null;
  copiedDenier: string | null;
  weighedDenier: string | null;
  cardDenier: string | null;
  cardDeviationPct: string | null;
  status: DenierStatus;
  suggestedDenier: string | null;
}

export interface DenierMixed {
  beamCount: number;
  bodyTareBeamCount?: number;
  lengthM: string;
  nominalKg: string;
  weighedNetKg: string;
  deviationPct: string | null;
  yarnItemIds: string[];
}

export interface DenierReport {
  range: { from: string; to: string };
  settings: { minBeams: number; thresholdPct: number };
  rows: DenierRow[];
  mixed: DenierMixed | null;
}

export interface DenierQuery { from?: string; to?: string; yarnItemId?: string; subcontractorId?: string }
export interface DenierApplyBody { yarnItemId: string; expectedDenier: string | null; newDenier: string }
export interface DenierApplyResult { yarnItemId: string; oldDenier: string | null; newDenier: string; unchanged: boolean }

const qs = (p: DenierQuery): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const denyeSapmaApi = {
  // Hata sayfada kalıcı kutuda gösterilir (toast kaybolur) — genel toast bastırılır.
  report: async (p: DenierQuery) =>
    (await apiClient.get<ApiResponse<DenierReport>>(`/api/reports/dokuma/denye-sapma${qs(p)}`, { suppressErrorToast: true })).data,
  apply: async (body: DenierApplyBody) =>
    (await apiClient.post<ApiResponse<DenierApplyResult>>("/api/warp-specs/denier-deviation/apply", body, { suppressErrorToast: true })).data,
};

/** Sunucu hata kodu (`details.code`; `body.code` hep boştur). */
export function denierErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof code === "string" ? code : null;
}

// ── Satır modeli: iplik satırları + (varsa) tek "karma" satırı ────────────────
export type DenyeLine =
  | { kind: "yarn"; row: DenierRow }
  | { kind: "mixed"; mixed: DenierMixed };

export function denyeLines(r: DenierReport | undefined): DenyeLine[] {
  if (!r) return [];
  return [...r.rows.map((row) => ({ kind: "yarn" as const, row })), ...(r.mixed ? [{ kind: "mixed" as const, mixed: r.mixed }] : [])];
}

const num = (v: string | null | undefined): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const signedPct = (v: string | null): string => {
  const n = num(v);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}%${formatDisplay(n, 1)}`;
};

/** Öneri hücresinin metni (ekranda düğme ayrıca çizilir). */
export function suggestionText(line: DenyeLine, settings: DenierReport["settings"] | undefined): string {
  if (line.kind === "mixed") return "Çok iplikli — öneri yok";
  const r = line.row;
  if (r.status === "SUGGEST") return r.suggestedDenier ? `${formatDisplay(num(r.suggestedDenier), 2)} den` : "—";
  if (r.status === "INSUFFICIENT") return settings ? `Yetersiz örnek (en az ${settings.minBeams} levent)` : "Yetersiz örnek";
  return "Eşik içinde";
}

/**
 * TEK kolon kurucusu (F9): her kolonun başlığı, Excel biçimi ve değeri bir kez yazılır; ekran tablosu
 * `display`, Excel/PDF `value` okur. Öneri kolonu ekranda [Uygula] düğmesini ayrıca taşır.
 */
export interface DenyeColumn extends ReportColumn {
  value: (line: DenyeLine, settings: DenierReport["settings"] | undefined) => string | number | null;
  display: (line: DenyeLine, settings: DenierReport["settings"] | undefined) => string;
}

const KG = "#,##0.00";
const INT = "0";
const yarn = (l: DenyeLine): DenierRow | null => (l.kind === "yarn" ? l.row : null);
const both = <K extends "beamCount" | "lengthM" | "nominalKg" | "weighedNetKg" | "deviationPct">(l: DenyeLine, k: K) =>
  l.kind === "yarn" ? l.row[k] : l.mixed[k];

/** F6 dara kaynağı etiketi: kabulde tartılan dara mı, gövde kartındaki yedek dara mı (kısmen ise sayısı). */
export function tareSourceText(l: DenyeLine): string {
  const total = both(l, "beamCount");
  const body = (l.kind === "yarn" ? l.row.bodyTareBeamCount : l.mixed.bodyTareBeamCount) ?? 0;
  if (body === 0) return "Tartılan";
  if (body >= total) return "Gövde kartından";
  return `Gövde kartından (${body}/${total})`;
}

export const DENYE_COLUMNS: DenyeColumn[] = [
  { header: "İplik", key: "iplik", width: 30,
    value: (l) => (l.kind === "yarn" ? `${l.row.name}${l.row.code ? ` (${l.row.code})` : ""}` : "Karma (çok iplikli leventler)"),
    display: (l) => (l.kind === "yarn" ? l.row.name || l.row.code : "Karma (çok iplikli leventler)") },
  { header: "Levent", key: "levent", width: 8, numFmt: INT, align: "right",
    value: (l) => both(l, "beamCount"), display: (l) => formatDisplay(both(l, "beamCount"), 0) },
  { header: "Nominal (kg)", key: "nominal", width: 13, numFmt: KG, align: "right",
    value: (l) => num(both(l, "nominalKg")), display: (l) => formatDisplay(num(both(l, "nominalKg")), 1) },
  { header: "Tartı neti (kg)", key: "net", width: 13, numFmt: KG, align: "right",
    value: (l) => num(both(l, "weighedNetKg")), display: (l) => formatDisplay(num(both(l, "weighedNetKg")), 1) },
  { header: "Dara", key: "dara", width: 16,
    value: (l) => tareSourceText(l), display: (l) => tareSourceText(l) },
  { header: "Sapma", key: "sapma", width: 10, align: "right",
    value: (l) => signedPct(both(l, "deviationPct")), display: (l) => signedPct(both(l, "deviationPct")) },
  { header: "Kart denyesi", key: "kart", width: 12, align: "right",
    value: (l) => yarn(l)?.cardDenier ? formatDisplay(num(yarn(l)!.cardDenier), 2) : "—",
    display: (l) => (yarn(l)?.cardDenier ? formatDisplay(num(yarn(l)!.cardDenier), 2) : "—") },
  { header: "Tartı denyesi", key: "tarti", width: 12, align: "right",
    value: (l) => (yarn(l)?.weighedDenier ? formatDisplay(num(yarn(l)!.weighedDenier), 2) : "—"),
    display: (l) => (yarn(l)?.weighedDenier ? formatDisplay(num(yarn(l)!.weighedDenier), 2) : "—") },
  { header: "Karta göre", key: "kartSapma", width: 10, align: "right",
    value: (l) => signedPct(yarn(l)?.cardDeviationPct ?? null), display: (l) => signedPct(yarn(l)?.cardDeviationPct ?? null) },
  { header: "Öneri", key: "oneri", width: 28,
    value: (l, s) => suggestionText(l, s), display: (l, s) => suggestionText(l, s) },
];

export function buildDenyeExport(opts: { report: DenierReport; filterNotes: string[] }): ReportExportSpec {
  const { report, filterNotes } = opts;
  const lines = denyeLines(report);
  return {
    title: "Denye Sapması",
    subtitle: `Kabul günü ${report.range.from} – ${report.range.to} · tartılı fason devere leventleri`,
    orientation: "landscape",
    meta: [
      `Öneri koşulu: en az ${report.settings.minBeams} levent ve karta göre sapma %${formatDisplay(report.settings.thresholdPct, 2)} üstü`,
      ...filterNotes,
    ],
    tables: [{
      name: "Denye sapması",
      columns: DENYE_COLUMNS.map(({ header, key, width, numFmt, align }) => ({ header, key, width, numFmt, align })),
      rows: lines.map((l) => Object.fromEntries(DENYE_COLUMNS.map((c) => [c.key, c.value(l, report.settings) ?? "—"]))),
      notes: ["Öneri iplik kartını kendiliğinden değiştirmez; geçmiş sarımlar değişmez.", "Dara kabulde tartılmadıysa levent gövdesi kartındaki dara kullanılır (Dara kolonu)."],
    }],
  };
}
