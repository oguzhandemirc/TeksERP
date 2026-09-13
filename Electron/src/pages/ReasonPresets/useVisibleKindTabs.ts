// Modül kapılı sekme listesi — `modul` taşıyan sekme yalnız o bayrak AÇIKKEN çizilir.
// Bayrak yüklenene dek KAPALI sayılır (fail-closed): referans profilde (tezgah
// kapalı) `MACHINE_STOP` sekmesi hiç belirmez — "bir an görünüp kaybolan" sekme
// de sıfır fark değildir. Parite bekçisi `KIND_TABS`ta sekmenin VARLIĞINI ister,
// görünürlüğünü değil; ikisi burada ayrılır.
import { useTezgahEnabled } from "@/hooks/usePricingEnabled";
import { KIND_TABS } from "./service";

export function useVisibleKindTabs(): typeof KIND_TABS {
  const tezgahEnabled = useTezgahEnabled();
  return KIND_TABS.filter((t) => !t.modul || (t.modul === "tezgahEnabled" && tezgahEnabled));
}
