// İstasyon türü seçeneklerinin GÖRÜNÜRLÜĞÜ — enum aynası üzerinde süzgeç.
// `WEAVING` yalnız `dokuma.enabled` açıkken çizilir ("kapalı modülün bayrağı
// çizilmez"in istasyon-türü ayağı, 1e 2026-09-14). Ayna DOKUNULMAZ: tip ve etiket
// tam kalır (denetim ekranı, liste, kart okur); yalnız FORM seçeneği süzülür.
// ⚠️ Mevcut değer korunur: bayrak kapalıyken WEAVING bir istasyon düzenleniyorsa
// seçeneği gizlemek formu sessizce OTHER'a düşürürdü (SHIPPING vakası, 2026-09-03).
import { StationKind, stationKindLabels } from "@/types/enums";

/** Bayrağa bağlı istasyon türleri — türün adı → onu çizen bayrak. */
export const FLAG_GATED_STATION_KINDS: Partial<Record<StationKind, "dokumaEnabled">> = {
  [StationKind.WEAVING]: "dokumaEnabled",
};

export function visibleStationKindLabels(
  flags: { dokumaEnabled: boolean },
  current: StationKind | null | undefined,
  labels: Record<StationKind, string> = stationKindLabels,
): Partial<Record<StationKind, string>> {
  const out: Partial<Record<StationKind, string>> = {};
  for (const [kind, label] of Object.entries(labels) as [StationKind, string][]) {
    const gate = FLAG_GATED_STATION_KINDS[kind];
    if (gate && !flags[gate] && kind !== current) continue;
    out[kind] = label;
  }
  return out;
}
