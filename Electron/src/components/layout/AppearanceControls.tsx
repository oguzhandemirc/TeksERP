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

const MODE_ICONS = Object.fromEntries(THEME_MODES.map((m) => [m.value, <m.icon key={m.value} className="h-3.5 w-3.5" />]));

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
        <Segmented label="Liste yoğunluğu" options={DENSITIES} value={a.density} onChange={(density) => setAppearance({ density })} />
      </Field>
      {variant === "full" && (
        <>
          <Field label="Menü stili">
            <Segmented label="Menü stili" options={SIDEBARS} value={a.sidebar} onChange={(sidebar) => setAppearance({ sidebar })} />
          </Field>
          <Field label="Zemin">
            <Segmented label="Zemin" options={SURFACES} value={a.surface} onChange={(surface) => setAppearance({ surface })} />
          </Field>
          <Field label="Köşe yuvarlaklığı">
            <Segmented label="Köşe yuvarlaklığı" options={RADII} value={a.radius} onChange={(radius) => setAppearance({ radius })} />
          </Field>
          <Field label="Yazı boyutu">
            <Segmented label="Yazı boyutu" options={FONTS} value={a.font} onChange={(font) => setAppearance({ font })} />
          </Field>
          <Field label="Simge kareleri">
            <Segmented label="Simge kareleri" options={TILES} value={a.tiles} onChange={(tiles) => setAppearance({ tiles })} />
          </Field>
        </>
      )}
    </div>
  );
}
