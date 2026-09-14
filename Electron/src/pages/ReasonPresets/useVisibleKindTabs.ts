import { useDevereEnabled, useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { KIND_TABS } from "./service";

/** Modüle bağlı sekme yalnız o modül AÇIKKEN çizilir ("kapalı modülün bayrağı çizilmez"). İplik ETKİN değerdir (ticaret ∧ iplik — zincir tek yerde çözülür). */
export function useVisibleKindTabs(): typeof KIND_TABS {
  const { iplikEnabled } = useOperationsVisibilityContext();
  const flags = { dokumaEnabled: useDokumaEnabled(), devereEnabled: useDevereEnabled(), iplikEnabled };
  return KIND_TABS.filter((t) => !t.modul || flags[t.modul]);
}
