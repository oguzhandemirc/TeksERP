/**
 * Sayfa ayarı (`pageSettings`) — backend `motor/sayfa.ts` `normalizePageSettings`
 * aynası. Üst/alt bilgi ve sayfa no HTML'e değil buraya yazılır (`@page` kenar
 * kutuları); sol-alt kutu künyeye ayrıldığı için alt bilgide "sol" YOKTUR.
 */
import type { Orientation, PaperSize } from "../editor/pageCanvas";

export type PageNumberPosition = "alt-sag" | "alt-orta" | "yok";

export interface PageSettings {
  kagit: PaperSize;
  yon: "dikey" | "yatay";
  kenar: { ust: number; sag: number; alt: number; sol: number };
  ustBilgi: { sol: string; orta: string; sag: string };
  altBilgi: { orta: string; sag: string };
  sayfaNo: { konum: PageNumberPosition; bicim: string };
  ilkSayfaFarkli: boolean;
}

export const PAGE_MARGIN_MAX_MM = 50;
export const HEADER_TEXT_MAX = 200;

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  kagit: "A4",
  yon: "dikey",
  kenar: { ust: 15, sag: 15, alt: 15, sol: 15 },
  ustBilgi: { sol: "", orta: "", sag: "" },
  altBilgi: { orta: "", sag: "" },
  sayfaNo: { konum: "yok", bicim: "Sayfa {n} / {N}" },
  ilkSayfaFarkli: false,
};

export const PAGE_NUMBER_POSITIONS: ReadonlyArray<{ value: PageNumberPosition; label: string }> = [
  { value: "yok", label: "Yok" },
  { value: "alt-orta", label: "Alt orta" },
  { value: "alt-sag", label: "Alt sağ" },
];

/** Kenar 0–50 mm; sayı değilse 0. */
export function clampMargin(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(PAGE_MARGIN_MAX_MM, Math.max(0, Math.round(v * 10) / 10));
}

/** Kaynak JSON (eksik/yanlış olabilir) → eksiksiz sayfa ayarı; tanınmayan değer varsayılana düşer. */
export function normalizePageSettings(raw: unknown): PageSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | unknown>;
  const obj = (k: string): Record<string, unknown> => (r[k] && typeof r[k] === "object" ? (r[k] as Record<string, unknown>) : {});
  const str = (v: unknown): string => (typeof v === "string" ? v.slice(0, HEADER_TEXT_MAX) : "");
  const num = (v: unknown, d: number): number => (typeof v === "number" ? clampMargin(v) : d);
  const k = obj("kenar");
  const ub = obj("ustBilgi");
  const ab = obj("altBilgi");
  const sn = obj("sayfaNo");
  const d = DEFAULT_PAGE_SETTINGS;
  return {
    kagit: r.kagit === "A5" || r.kagit === "LETTER" ? r.kagit : "A4",
    yon: r.yon === "yatay" ? "yatay" : "dikey",
    kenar: { ust: num(k.ust, d.kenar.ust), sag: num(k.sag, d.kenar.sag), alt: num(k.alt, d.kenar.alt), sol: num(k.sol, d.kenar.sol) },
    ustBilgi: { sol: str(ub.sol), orta: str(ub.orta), sag: str(ub.sag) },
    altBilgi: { orta: str(ab.orta), sag: str(ab.sag) },
    sayfaNo: {
      konum: sn.konum === "alt-sag" || sn.konum === "alt-orta" ? sn.konum : "yok",
      bicim: typeof sn.bicim === "string" ? sn.bicim.slice(0, HEADER_TEXT_MAX) : d.sayfaNo.bicim,
    },
    ilkSayfaFarkli: r.ilkSayfaFarkli === true,
  };
}

/** Backend'in reddedeceği çakışmalar (sayfa no ile aynı alt kutu dolu). */
export function pageSettingsIssues(s: PageSettings): string[] {
  const out: string[] = [];
  if (s.sayfaNo.konum === "alt-sag" && s.altBilgi.sag) out.push("Sayfa numarası sağ-altta iken alt bilgi sağ kutusu boş olmalı");
  if (s.sayfaNo.konum === "alt-orta" && s.altBilgi.orta) out.push("Sayfa numarası ortada iken alt bilgi orta kutusu boş olmalı");
  return out;
}

export function toCanvasPaper(s: PageSettings): { paper: PaperSize; orientation: Orientation } {
  return { paper: s.kagit, orientation: s.yon === "yatay" ? "landscape" : "portrait" };
}

/** "Sayfa {n} / {N}" → kanvas temsili ("Sayfa 1 / 3"). */
export function pageNumberPreview(format: string, n = 1, total = 3): string {
  return format.replace(/\{n\}/g, String(n)).replace(/\{N\}/g, String(total));
}

/** Kanvasın üst/alt kenar şeritlerinde gösterilen temsil metinleri. */
export function regionPreview(s: PageSettings): { header: string; footer: string } {
  const header = [s.ustBilgi.sol, s.ustBilgi.orta, s.ustBilgi.sag].filter(Boolean).join("   ·   ");
  const pageNo = s.sayfaNo.konum === "yok" ? "" : pageNumberPreview(s.sayfaNo.bicim);
  const footer = [s.altBilgi.orta, s.altBilgi.sag, pageNo].filter(Boolean).join("   ·   ");
  return { header, footer };
}
