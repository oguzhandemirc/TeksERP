// =============================================================================
// KİŞİSELLEŞTİRME (T4, 2026-11-11) — görünüm tercihlerinin tek sahibi
// =============================================================================
// Her eksen <html data-*> özniteliğidir; renkleri index.css'teki seçiciler verir. JS yalnız özel
// renkte dört değişken yazar (--custom-h/s/l/fg). Şekil kullanıcı blob'unda (`appearance`) yaşar;
// okurken her alan doğrulanır, bilinmeyen değer varsayılana düşer (eski/bozuk blob ekranı bozmaz).
// =============================================================================
import type { AppPreferences } from "@/types/preferences";
import { formatHslChannels, hexToHsl, hslToHex, parseHslChannels, pickForeground } from "./color";

export const PRESET_KEYS = ["violet", "blue", "teal", "green", "orange", "rose", "graphite"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
export type ThemePreset = PresetKey | "custom";
export type SidebarStyle = "light" | "dark" | "brand";
export type SurfaceTone = "lavender" | "neutral" | "white";
export type RadiusScale = "small" | "medium" | "large";
export type Density = "compact" | "comfortable";
export type FontScale = "small" | "normal" | "large";
export type TileStyle = "color" | "mono";

export interface Appearance {
  preset: ThemePreset;
  /** Özel renk `#rrggbb` — yalnız preset "custom" iken okunur, seçim değişince de saklanır. */
  customColor: string;
  sidebar: SidebarStyle;
  surface: SurfaceTone;
  radius: RadiusScale;
  density: Density;
  font: FontScale;
  tiles: TileStyle;
}

/** Kullanıcı kararı 2026-11-11: mor, açık menü, lavanta, geniş köşe, sıkı liste. */
export const DEFAULT_APPEARANCE: Appearance = {
  preset: "violet",
  customColor: "#6d4ee6",
  sidebar: "light",
  surface: "lavender",
  radius: "large",
  density: "compact",
  font: "normal",
  tiles: "color",
};

const ALLOWED: { [K in Exclude<keyof Appearance, "customColor">]: readonly Appearance[K][] } = {
  preset: [...PRESET_KEYS, "custom"],
  sidebar: ["light", "dark", "brand"],
  surface: ["lavender", "neutral", "white"],
  radius: ["small", "medium", "large"],
  density: ["compact", "comfortable"],
  font: ["small", "normal", "large"],
  tiles: ["color", "mono"],
};

/** Eski `accent` (HSL kanalı) → en yakın hazır tema; eşleşmezse özel renk. */
const LEGACY_ACCENT: Record<string, PresetKey> = {
  "243 75% 59%": "violet",
  "262 83% 58%": "violet",
  "217 91% 60%": "blue",
  "199 89% 48%": "blue",
  "172 66% 45%": "teal",
  "160 84% 39%": "green",
  "38 92% 50%": "orange",
  "25 95% 53%": "orange",
  "350 89% 60%": "rose",
};

function pick<K extends keyof typeof ALLOWED>(key: K, raw: unknown): Appearance[K] {
  return (ALLOWED[key] as readonly unknown[]).includes(raw) ? (raw as Appearance[K]) : DEFAULT_APPEARANCE[key];
}

function legacyPreset(accent: string | null | undefined): Pick<Appearance, "preset" | "customColor"> | null {
  if (!accent) return null;
  const known = LEGACY_ACCENT[accent.trim()];
  if (known) return { preset: known, customColor: DEFAULT_APPEARANCE.customColor };
  const hsl = parseHslChannels(accent);
  return hsl ? { preset: "custom", customColor: hslToHex(hsl) } : null;
}

/**
 * Blob'dan geçerli görünüm. `appearance` yoksa ESKİ alanlardan göç: seçilmiş vurgu rengi korunur;
 * eski yoğunluktan yalnız "compact" taşınır — "comfortable" eski varsayılandı ve her kayıtta
 * blob'a yazıldığından seçim mi varsayılan mı ayırt edilemez (yeni varsayılan sıkı).
 */
export function resolveAppearance(prefs: AppPreferences | null | undefined): Appearance {
  const raw = (prefs?.appearance ?? null) as Partial<Record<keyof Appearance, unknown>> | null;
  if (!raw) {
    const legacy = legacyPreset(prefs?.accent);
    return { ...DEFAULT_APPEARANCE, ...(legacy ?? {}), density: prefs?.density === "compact" ? "compact" : DEFAULT_APPEARANCE.density };
  }
  const color = typeof raw.customColor === "string" && hexToHsl(raw.customColor) ? raw.customColor.toLowerCase() : DEFAULT_APPEARANCE.customColor;
  return {
    preset: pick("preset", raw.preset),
    customColor: color,
    sidebar: pick("sidebar", raw.sidebar),
    surface: pick("surface", raw.surface),
    radius: pick("radius", raw.radius),
    density: pick("density", raw.density),
    font: pick("font", raw.font),
    tiles: pick("tiles", raw.tiles),
  };
}

/** Özel renk değişkenleri — yazı rengi kontrasta göre beyaz/koyu seçilir. */
export function customColorVars(hex: string): Record<string, string> | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  return {
    "--custom-h": String(Math.round(hsl.h)),
    "--custom-s": `${Math.round(hsl.s)}%`,
    "--custom-l": `${Math.round(hsl.l)}%`,
    "--custom-fg": formatHslChannels(pickForeground(hsl)),
  };
}

const CUSTOM_VARS = ["--custom-h", "--custom-s", "--custom-l", "--custom-fg"];
/** Eski accent yazımının bıraktığı satır içi değişkenler — göçte temizlenir. */
const LEGACY_INLINE = ["--primary", "--brand", "--ring"];

/** Görünüm → öznitelikler (kök ya da önizleme kutusu). Varsayılan değerler de açıkça yazılır. */
export function appearanceAttributes(a: Appearance): Record<string, string> {
  return {
    "data-preset": a.preset,
    "data-sidebar": a.sidebar,
    "data-surface": a.surface,
    "data-radius": a.radius,
    "data-density": a.density,
    "data-font": a.font,
    "data-tiles": a.tiles,
  };
}

/** Görünümü elemana uygular (varsayılan: <html>). */
export function applyAppearance(a: Appearance, el: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(appearanceAttributes(a))) el.setAttribute(k, v);
  for (const v of LEGACY_INLINE) el.style.removeProperty(v);
  const vars = a.preset === "custom" ? customColorVars(a.customColor) : null;
  for (const v of CUSTOM_VARS) {
    if (vars?.[v]) el.style.setProperty(v, vars[v]);
    else el.style.removeProperty(v);
  }
}

/** Görünüm yaması → blob yaması: eski alanlar boşaltılır ki göç bir daha koşmasın. */
export function appearancePatch(current: AppPreferences, patch: Partial<Appearance>): Partial<AppPreferences> {
  return { appearance: { ...resolveAppearance(current), ...patch }, accent: null };
}
