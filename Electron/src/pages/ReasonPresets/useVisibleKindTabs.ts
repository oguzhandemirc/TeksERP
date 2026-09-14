import { useDevereEnabled, useTezgahEnabled } from "@/hooks/usePricingEnabled";
import { KIND_TABS } from "./service";

/** Modüle bağlı sekme yalnız o modül AÇIKKEN çizilir ("kapalı modülün bayrağı çizilmez"). */
export function useVisibleKindTabs(): typeof KIND_TABS {
  const flags = { tezgahEnabled: useTezgahEnabled(), devereEnabled: useDevereEnabled() };
  return KIND_TABS.filter((t) => !t.modul || flags[t.modul]);
}
