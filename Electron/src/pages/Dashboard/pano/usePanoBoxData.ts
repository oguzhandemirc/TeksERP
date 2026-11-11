import { useQueries } from "@tanstack/react-query";
import type { PanoBoxDef } from "./box-types";
import { requestBox } from "./pano-batch";
import { LOCAL_BOX_KEYS } from "./pano-layout";
import type { PanoDonem } from "./types";

export interface BoxState {
  data: unknown;
  loading: boolean;
  error: boolean;
  /** Arka planda yenileniyor (ör. ajanda günü değişti; eski veri ekranda). */
  fetching: boolean;
  refetch: () => void;
}

export interface AgendaParams { gun?: string; ay?: string }

/** Dönemsiz kutu dönem değişiminde yeniden istenmez (anahtarında dönem yok). */
export function boxQueryKey(box: Pick<PanoBoxDef, "anahtar" | "donemli">, donem: PanoDonem, agenda: AgendaParams): unknown[] {
  const base = ["dashboard", "pano", box.donemli ? donem : "*", box.anahtar];
  return box.anahtar === "ajanda" ? [...base, agenda.gun ?? null, agenda.ay ?? null] : base;
}

/**
 * Ekli katalog kutularının verisi — kutu başına sorgu, aynı tikte başlayanlar tek istekte (`pano-batch`).
 * `enabled:false` (düzenleme kipi / izin yok) iken istek atılmaz.
 */
export function usePanoBoxData(boxes: readonly PanoBoxDef[], donem: PanoDonem, agenda: AgendaParams, enabled: boolean): Record<string, BoxState> {
  const remote = boxes.filter((b) => !LOCAL_BOX_KEYS.has(b.anahtar));
  const results = useQueries({
    queries: remote.map((b) => ({
      queryKey: boxQueryKey(b, donem, agenda),
      queryFn: () =>
        requestBox({ key: b.anahtar, donem, periodic: b.donemli, ...(b.anahtar === "ajanda" ? agenda : {}) }),
      enabled,
      staleTime: 60_000,
      // Gün değişince eski ajanda verisi kalır (kutu titremesin); diğer kutular için zararsız.
      placeholderData: b.anahtar === "ajanda" ? (prev: unknown) => prev : undefined,
    })),
  });
  const out: Record<string, BoxState> = {};
  remote.forEach((b, i) => {
    const r = results[i]!;
    out[b.anahtar] = {
      data: r.data,
      loading: r.data === undefined && (r.isLoading || r.isPending),
      error: r.isError && r.data === undefined,
      fetching: r.isFetching,
      refetch: () => void r.refetch(),
    };
  });
  return out;
}
