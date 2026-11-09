import { useDevereEnabled, useKaliteGuvenceEnabled } from "@/hooks/usePricingEnabled";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { KIND_TABS } from "./service";

/** Modüle bağlı sekme yalnız o modül AÇIKKEN çizilir ("kapalı modülün bayrağı çizilmez"). İplik ETKİN değerdir (ticaret ∧ iplik — zincir tek yerde çözülür). */
export function useVisibleKindTabs(): typeof KIND_TABS {
  // Duruş sekmesi duruş REJİMİNİ okur (dokuma ∨ üretim ∧ makine duruşu takibi) — tek çözüm bağlamda.
  const { iplikEnabled, machineStopEnabled } = useOperationsVisibilityContext();
  const flags = { machineStopEnabled, devereEnabled: useDevereEnabled(), iplikEnabled, kaliteGuvenceEnabled: useKaliteGuvenceEnabled() };
  return KIND_TABS.filter((t) => !t.modul || flags[t.modul]);
}
