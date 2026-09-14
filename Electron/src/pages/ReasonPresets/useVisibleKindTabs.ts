import { useDevereEnabled, useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { KIND_TABS } from "./service";

/** Modüle bağlı sekme yalnız o modül AÇIKKEN çizilir ("kapalı modülün bayrağı çizilmez"). */
export function useVisibleKindTabs(): typeof KIND_TABS {
  const flags = { dokumaEnabled: useDokumaEnabled(), devereEnabled: useDevereEnabled() };
  return KIND_TABS.filter((t) => !t.modul || flags[t.modul]);
}
