import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/providers/PreferencesProvider";
import { ACCENT_PRESETS, type DensityPref, type ThemePref } from "@/types/preferences";

const THEMES: { key: ThemePref; label: string; icon: LucideIcon }[] = [
  { key: "light", label: "Açık", icon: Sun },
  { key: "dark", label: "Koyu", icon: Moon },
  { key: "system", label: "Sistem", icon: Monitor },
];

const DENSITIES: { key: DensityPref; label: string; hint: string }[] = [
  { key: "comfortable", label: "Rahat", hint: "Geniş aralık" },
  { key: "compact", label: "Sıkışık", hint: "Daha çok satır" },
];

const RAINBOW =
  "conic-gradient(from 180deg, hsl(243 75% 59%), hsl(199 89% 48%), hsl(160 84% 39%), hsl(38 92% 50%), hsl(350 89% 60%), hsl(243 75% 59%))";

/** Tema + vurgu rengi + yoğunluk kontrolleri — hem Görünüm popover'ı hem de
 *  Ayarlar sayfası kullanır. Seçimler usePreferences ile anında uygulanır. */
export function AppearanceControls() {
  const { prefs, setPreference } = usePreferences();
  const { setTheme } = useTheme();

  const chooseTheme = (t: ThemePref) => {
    setTheme(t);
    setPreference({ theme: t });
  };

  return (
    <div className="space-y-4">
      <Section title="Tema">
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(({ key, label, icon: Icon }) => (
            <Choice key={key} active={prefs.theme === key} onClick={() => chooseTheme(key)}>
              <Icon className="h-4 w-4" />
              {label}
            </Choice>
          ))}
        </div>
      </Section>

      <Section title="Vurgu Rengi">
        <div className="flex flex-wrap gap-2">
          <Swatch
            active={!prefs.accent}
            onClick={() => setPreference({ accent: null })}
            title="Varsayılan"
            background={RAINBOW}
          />
          {ACCENT_PRESETS.map((p) => (
            <Swatch
              key={p.key}
              active={prefs.accent === p.value}
              onClick={() => setPreference({ accent: p.value })}
              title={p.label}
              background={`hsl(${p.value})`}
            />
          ))}
        </div>
      </Section>

      <Section title="Yoğunluk">
        <div className="grid grid-cols-2 gap-2">
          {DENSITIES.map((d) => (
            <Choice
              key={d.key}
              active={prefs.density === d.key}
              onClick={() => setPreference({ density: d.key })}
            >
              <span className="font-medium">{d.label}</span>
              <span className="text-[10px] opacity-70">{d.hint}</span>
            </Choice>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-md border p-2 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Swatch({
  active,
  onClick,
  title,
  background,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  background: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "relative h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
        active && "ring-2 ring-ring",
      )}
      style={{ background }}
    >
      {active && (
        <Check className="absolute inset-0 m-auto h-3.5 w-3.5 text-white drop-shadow" strokeWidth={3} />
      )}
    </button>
  );
}
