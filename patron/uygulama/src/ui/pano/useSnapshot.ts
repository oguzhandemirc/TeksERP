// Anlık kancası: `anlik:<projeksiyon>` anahtarı → değişim akışındaki projeksiyon adıyla AYNI etiket (`ozet.stok`,
// `saglik`…), böylece fabrika paketi gelince yalnız ilgili kutu tazelenir. İzinsizken anahtar `null` (istek yok).
import type { Snapshot } from "../../api/wire";
import { useSession } from "../../state/session";
import { useRemote, type Remote } from "../../state/useRemote";

export function useSnapshot(projection: string, enabled = true): Remote<Snapshot> {
  const { api } = useSession();
  return useRemote<Snapshot>(enabled ? `anlik:${projection}` : null, () => api.snapshot(projection), { tags: [projection] });
}

/** Birden çok kancanın ortak durumu (aşağı çek göstergesi + hepsini yenile). */
export function combine(list: readonly Remote<unknown>[]): { refreshing: boolean; reload: () => void } {
  return {
    refreshing: list.some((r) => r.refreshing),
    reload: () => list.forEach((r) => r.reload()),
  };
}
