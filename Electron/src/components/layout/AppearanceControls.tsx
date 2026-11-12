import { useTheme } from "next-themes";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import { useAppearance } from "@/lib/theme/use-appearance";
import type { ThemePref } from "@/types/preferences";
import {
  DENSITIES,
  FONTS,
  RADII,
  SIDEBARS,
  SURFACES,
  THEME_MODES,
  TILES,
} from "./appearance/appearance-options";
import { Field, PresetSwatches, Segmented } from "./appearance/appearance-parts";
import { TypefacePicker } from "./appearance/TypefacePicker";

const MODE_ICONS = Object.fromEntries(THEME_MODES.map((m) => [m.value, <m.icon key={m.value} className="h-3.5 w-3.5" />]));

// Seçenek döşemeleri: her biri kendi data-* kapsamında çizilir (sabit renk yok; @theme inline sayesinde çözülür).
const chip = "inline-block h-4 w-5 shrink-0 border border-card-border";
const SIDEBAR_ICONS = Object.fromEntries(
  SIDEBARS.map((o) => [o.value, <span key={o.value} data-sidebar={o.value} className={`${chip} rounded-[3px] bg-sidebar`} />]),
);
const SURFACE_ICONS = Object.fromEntries(
  SURFACES.map((o) => [o.value, <span key={o.value} data-surface={o.value} className={`${chip} rounded-[3px] bg-background`} />]),
);
const RADIUS_ICONS = { small: "rounded-[1px]", medium: "rounded-[3px]", large: "rounded-[6px]" } as const;
const RADIUS_TILES = Object.fromEntries(
  RADII.map((o) => [o.value, <span key={o.value} className={`inline-block h-4 w-4 border-2 border-current ${RADIUS_ICONS[o.value]}`} />]),
);
const FONT_SIZES = { small: "text-[11px]", normal: "text-[13px]", large: "text-[15px]" } as const;
const FONT_ICONS = Object.fromEntries(FONTS.map((o) => [o.value, <span key={o.value} className={`font-bold leading-none ${FONT_SIZES[o.value]}`}>A</span>]));
const DENSITY_ICONS = Object.fromEntries(
  DENSITIES.map((o) => [
    o.value,
    <span key={o.value} className={`flex w-4 flex-col ${o.value === "compact" ? "gap-[2px]" : "gap-[4px]"}`}>
      {[0, 1, 2].map((i) => <span key={i} className="h-[2px] rounded bg-current" />)}
    </span>,
  ]),
);
const TILE_ICONS = Object.fromEntries(
  TILES.map((o) => [
    o.value,
    <span key={o.value} data-tiles={o.value} className="flex gap-0.5">
      <span className="icon-tile tile-blue h-3 w-3 rounded-[3px]" />
      <span className="icon-tile tile-orange h-3 w-3 rounded-[3px]" />
    </span>,
  ]),
);

/**
 * Görünüm kontrolleri — `quick` (üst çubuk popover'ı: kip, tema rengi, yoğunluk) ya da `full`
 * (Ayarlar › Görünüm: bütün eksenler). Seçim anında uygulanır, kullanıcı tercihine kaydedilir.
 */
export function AppearanceControls({ variant = "full" }: { variant?: "quick" | "full" }) {
  const prefs = useOptionalPreferences();
  const { theme, setTheme } = useTheme();
  const { appearance: a, setAppearance } = useAppearance();
  const mode = (prefs?.prefs.theme ?? theme ?? "system") as ThemePref;
  const chooseMode = (t: ThemePref) => {
    setTheme(t);
    prefs?.setPreference({ theme: t });
  };

  return (
    <div className="space-y-4">
      <Field label="Kip">
        <Segmented label="Kip" options={THEME_MODES} value={mode} onChange={chooseMode} icons={MODE_ICONS} />
      </Field>
      <Field label="Tema rengi">
        <PresetSwatches
          value={a.preset}
          customColor={a.customColor}
          onPreset={(preset) => setAppearance({ preset })}
          onCustom={(customColor) => setAppearance({ preset: "custom", customColor })}
        />
      </Field>
      <Field label="Liste yoğunluğu">
        <Segmented label="Liste yoğunluğu" options={DENSITIES} value={a.density} onChange={(density) => setAppearance({ density })} icons={DENSITY_ICONS} />
      </Field>
      {variant === "full" && (
        <>
          <Field label="Menü stili">
            <Segmented label="Menü stili" options={SIDEBARS} value={a.sidebar} onChange={(sidebar) => setAppearance({ sidebar })} icons={SIDEBAR_ICONS} />
          </Field>
          <Field label="Zemin">
            <Segmented label="Zemin" options={SURFACES} value={a.surface} onChange={(surface) => setAppearance({ surface })} icons={SURFACE_ICONS} />
          </Field>
          <Field label="Köşe yuvarlaklığı">
            <Segmented label="Köşe yuvarlaklığı" options={RADII} value={a.radius} onChange={(radius) => setAppearance({ radius })} icons={RADIUS_TILES} />
          </Field>
          <Field label="Yazı tipi">
            <TypefacePicker value={a.typeface} onChange={(typeface) => setAppearance({ typeface })} />
          </Field>
          <Field label="Yazı boyutu">
            <Segmented label="Yazı boyutu" options={FONTS} value={a.font} onChange={(font) => setAppearance({ font })} icons={FONT_ICONS} />
          </Field>
          <Field label="Simge kareleri">
            <Segmented label="Simge kareleri" options={TILES} value={a.tiles} onChange={(tiles) => setAppearance({ tiles })} icons={TILE_ICONS} />
          </Field>
        </>
      )}
    </div>
  );
}
