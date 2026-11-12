import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Segmented } from "@/components/layout/appearance/appearance-parts";
import type { Option } from "@/components/layout/appearance/appearance-options";
import { readTabOpenMode, type TabOpenMode } from "@/components/layout/tabs/tab-open-mode";
import { usePreferences } from "@/providers/PreferencesProvider";
import { TERIM } from "@/lib/terim";

type SubcontractorDefault = "favorite" | "lastUsed";

// Uzun açıklamalar seçeneğin ipucunda (üzerine gelince) — kart yalnız etiket + seçim gösterir.
const TAB_MODES: Option<TabOpenMode>[] = [
  { value: "newTab", label: "Yeni sekmede", hint: "Menüden açılan ekran yeni sekmede açılır (açıksa ona geçilir)." },
  { value: "sameTab", label: "Aynı sekmede", hint: "Her tık açık sekmede açar; yeni sekme için Ctrl/⌘/Shift + tık ya da orta tık. Önceki ekranın süzgeç/kaydırma konumu korunmayabilir." },
];
const SUBCONTRACTOR_DEFAULTS: Option<SubcontractorDefault>[] = [
  { value: "favorite", label: "Kategorinin favorisi", hint: "⭐ işaretli firma hazır gelir." },
  { value: "lastUsed", label: "En son seçtiğim", hint: "O kategoride en son kullandığın firma gelir; geçmiş yoksa favoriye düşer. Favori yıldızı listede yine görünür." },
];

/** Kişisel çalışma tercihleri — yalnız bu kullanıcıyı etkiler (`UserPreference` blob'u); görünümden ayrı. */
export function WorkPreferencesCard() {
  const { prefs, setPreference } = usePreferences();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Çalışma tercihleri</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div data-testid="tab-open-mode">
          <Field label="Ekranlar nerede açılsın?">
            <Segmented
              label="Sekme davranışı"
              options={TAB_MODES}
              value={readTabOpenMode(prefs)}
              onChange={(openMode) => setPreference({ tabs: { ...(prefs.tabs ?? {}), openMode } })}
            />
          </Field>
        </div>
        <Field label={`${TERIM.terbiyeIsEmri.cumleBasi.bulunma} hazır gelen fason firma`}>
          <Segmented
            label="Fason firma varsayılanı"
            options={SUBCONTRACTOR_DEFAULTS}
            value={prefs.workOrders?.subcontractorDefault ?? "favorite"}
            onChange={(subcontractorDefault) =>
              setPreference({ workOrders: { ...(prefs.workOrders ?? {}), subcontractorDefault } })
            }
          />
        </Field>
      </CardContent>
    </Card>
  );
}
