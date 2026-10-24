// =============================================================================
// Sayfa ayarları (`pageSettings` JSON) → `@page` (+ `:first`) + temel baskı CSS'i
// =============================================================================
// Şablon `@page` kenarını ve `@bottom-left` kutusunu kendisi yazamaz (overlay.ts
// doğrulayıcısı reddeder): kenar ve üst/alt bilgi YALNIZ buradan gelir, sol-alt kutu
// künyeye ayrılmıştır. Anahtarlar tel sözleşmesidir (Türkçe; plan §4 "Sayfa ayarları");
// tanınmayan anahtar ya da değer FAIL-CLOSED hata verir — sessizce yok sayılmaz.

import { cssFixed } from "../../document-render/fmt-num";
import { cssString } from "./filtreler";

export type PaperSize = "A4" | "A5" | "LETTER";
export type Orientation = "dikey" | "yatay";
export type PageNumberPosition = "alt-sag" | "alt-orta" | "yok";

/** Normalize edilmiş sayfa ayarı (bütün alanlar dolu). */
export interface PageSettings {
  readonly kagit: PaperSize;
  readonly yon: Orientation;
  readonly kenar: { readonly ust: number; readonly sag: number; readonly alt: number; readonly sol: number };
  readonly ustBilgi: { readonly sol: string; readonly orta: string; readonly sag: string };
  readonly altBilgi: { readonly orta: string; readonly sag: string };
  readonly sayfaNo: { readonly konum: PageNumberPosition; readonly bicim: string };
  readonly ilkSayfaFarkli: boolean;
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  kagit: "A4",
  yon: "dikey",
  kenar: { ust: 15, sag: 15, alt: 15, sol: 15 },
  ustBilgi: { sol: "", orta: "", sag: "" },
  altBilgi: { orta: "", sag: "" },
  sayfaNo: { konum: "yok", bicim: "Sayfa {n} / {N}" },
  ilkSayfaFarkli: false,
};

export const PAGE_MARGIN_MAX_MM = 50;
const HEADER_TEXT_MAX = 200;

/** Sayfa ayarı doğrulama hatası — Türkçe mesaj listesi. */
export class PageSettingsError extends Error {
  constructor(readonly messages: readonly string[]) {
    super(messages.join("; "));
    this.name = "PageSettingsError";
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Ham JSON → tam ayar. Eksik alan varsayılandan; bilinmeyen anahtar/değer hata. */
export function normalizePageSettings(raw: unknown): PageSettings {
  const errors: string[] = [];
  if (raw === null || raw === undefined) return DEFAULT_PAGE_SETTINGS;
  if (!isObj(raw)) throw new PageSettingsError(["Sayfa ayarı bir nesne olmalı"]);

  const unknownKeys = (o: Obj, allowed: readonly string[], where: string): void => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) errors.push(`Sayfa ayarında bilinmeyen alan: ${where}${k}`);
  };
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T, label: string): T => {
    if (v === undefined) return fallback;
    if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
    errors.push(`Sayfa ayarı '${label}' şunlardan biri olmalı: ${allowed.join(", ")}`);
    return fallback;
  };
  const text = (v: unknown, label: string): string => {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") {
      errors.push(`Sayfa ayarı '${label}' metin olmalı`);
      return "";
    }
    if (v.length > HEADER_TEXT_MAX) errors.push(`Sayfa ayarı '${label}' en çok ${HEADER_TEXT_MAX} karakter olabilir`);
    return v;
  };
  const group = (v: unknown, label: string): Obj => {
    if (v === undefined) return {};
    if (isObj(v)) return v;
    errors.push(`Sayfa ayarı '${label}' bir nesne olmalı`);
    return {};
  };

  unknownKeys(raw, ["kagit", "yon", "kenar", "ustBilgi", "altBilgi", "sayfaNo", "ilkSayfaFarkli"], "");
  const kagit = pick(raw.kagit, ["A4", "A5", "LETTER"] as const, DEFAULT_PAGE_SETTINGS.kagit, "kagit");
  const yon = pick(raw.yon, ["dikey", "yatay"] as const, DEFAULT_PAGE_SETTINGS.yon, "yon");

  const k = group(raw.kenar, "kenar");
  unknownKeys(k, ["ust", "sag", "alt", "sol"], "kenar.");
  const margin = (side: "ust" | "sag" | "alt" | "sol"): number => {
    const v = k[side];
    if (v === undefined) return DEFAULT_PAGE_SETTINGS.kenar[side];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > PAGE_MARGIN_MAX_MM) {
      errors.push(`Sayfa kenarı 'kenar.${side}' 0–${PAGE_MARGIN_MAX_MM} mm arası sayı olmalı`);
      return DEFAULT_PAGE_SETTINGS.kenar[side];
    }
    return v;
  };
  const kenar = { ust: margin("ust"), sag: margin("sag"), alt: margin("alt"), sol: margin("sol") };

  const ub = group(raw.ustBilgi, "ustBilgi");
  unknownKeys(ub, ["sol", "orta", "sag"], "ustBilgi.");
  const header = { sol: text(ub.sol, "ustBilgi.sol"), orta: text(ub.orta, "ustBilgi.orta"), sag: text(ub.sag, "ustBilgi.sag") };

  const ab = group(raw.altBilgi, "altBilgi");
  // `sol` YOK: sol-alt kutu künyeye ayrılmıştır.
  unknownKeys(ab, ["orta", "sag"], "altBilgi.");
  const footer = { orta: text(ab.orta, "altBilgi.orta"), sag: text(ab.sag, "altBilgi.sag") };

  const sn = group(raw.sayfaNo, "sayfaNo");
  unknownKeys(sn, ["konum", "bicim"], "sayfaNo.");
  const konum = pick(sn.konum, ["alt-sag", "alt-orta", "yok"] as const, DEFAULT_PAGE_SETTINGS.sayfaNo.konum, "sayfaNo.konum");
  const bicim = sn.bicim === undefined ? DEFAULT_PAGE_SETTINGS.sayfaNo.bicim : text(sn.bicim, "sayfaNo.bicim");
  if (konum === "alt-sag" && footer.sag) errors.push("Sayfa numarası sağ-altta iken 'altBilgi.sag' boş olmalı");
  if (konum === "alt-orta" && footer.orta) errors.push("Sayfa numarası orta-altta iken 'altBilgi.orta' boş olmalı");

  let firstPageDifferent = DEFAULT_PAGE_SETTINGS.ilkSayfaFarkli;
  if (raw.ilkSayfaFarkli !== undefined) {
    if (typeof raw.ilkSayfaFarkli === "boolean") firstPageDifferent = raw.ilkSayfaFarkli;
    else errors.push("Sayfa ayarı 'ilkSayfaFarkli' true/false olmalı");
  }

  if (errors.length) throw new PageSettingsError(errors);
  return { kagit, yon, kenar, ustBilgi: header, altBilgi: footer, sayfaNo: { konum, bicim }, ilkSayfaFarkli: firstPageDifferent };
}

/** "Sayfa {n} / {N}" → `"Sayfa " counter(page) " / " counter(pages)`; metin parçaları CSS dizesi. */
export function pageNumberContent(format: string): string {
  const parts: string[] = [];
  for (const piece of format.split(/(\{n\}|\{N\})/)) {
    if (piece === "{n}") parts.push("counter(page)");
    else if (piece === "{N}") parts.push("counter(pages)");
    else if (piece !== "") parts.push(cssString(piece));
  }
  return parts.length ? parts.join(" ") : "counter(page)";
}

/** Tablo başlığı her sayfada tekrarlanır, satır sayfa sınırında bölünmez. */
export const BASE_PRINT_CSS = "thead{display:table-header-group}tr{break-inside:avoid}";

/** Normalize edilmiş ayar → `@page` CSS'i (kenar kutuları dahil; `@bottom-left` hariç). */
export function pageCss(s: PageSettings): string {
  const mm = (n: number): string => `${cssFixed(n, 1)}mm`;
  const boxes: Array<[string, string]> = [];
  if (s.ustBilgi.sol) boxes.push(["top-left", cssString(s.ustBilgi.sol)]);
  if (s.ustBilgi.orta) boxes.push(["top-center", cssString(s.ustBilgi.orta)]);
  if (s.ustBilgi.sag) boxes.push(["top-right", cssString(s.ustBilgi.sag)]);
  if (s.altBilgi.orta) boxes.push(["bottom-center", cssString(s.altBilgi.orta)]);
  if (s.altBilgi.sag) boxes.push(["bottom-right", cssString(s.altBilgi.sag)]);
  if (s.sayfaNo.konum === "alt-sag") boxes.push(["bottom-right", pageNumberContent(s.sayfaNo.bicim)]);
  if (s.sayfaNo.konum === "alt-orta") boxes.push(["bottom-center", pageNumberContent(s.sayfaNo.bicim)]);

  const size = `${s.kagit}${s.yon === "yatay" ? " landscape" : ""}`;
  const margin = `${mm(s.kenar.ust)} ${mm(s.kenar.sag)} ${mm(s.kenar.alt)} ${mm(s.kenar.sol)}`;
  let css = `@page{size:${size};margin:${margin};${boxes.map(([b, c]) => `@${b}{content:${c}}`).join("")}}`;
  if (s.ilkSayfaFarkli && boxes.length) {
    css += `@page :first{${boxes.map(([b]) => `@${b}{content:none}`).join("")}}`;
  }
  return css;
}
