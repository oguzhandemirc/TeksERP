// =============================================================================
// useLoomFloorLive — Tezgah Salonu'nun gerçek veri kapısı (`GET /api/loom-floor`)
// =============================================================================
// Yoklama 5 sn (TV arka planda da tazelenir), sayaç saati 1 sn. "Şimdi" SUNUCU
// saatine hizalanır (`asOf` − alındığı an): istemci saati kaymışsa sayaç eksi/fazla akmaz.
// =============================================================================
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fromApi } from "./fromApi";
import { loomFloorService } from "./service";
import type { FloorState } from "./types";

export const LOOM_FLOOR_QUERY_KEY = ["loom-floor"] as const;

export interface LoomFloorLiveOptions {
  /** Sunucu yoklama aralığı (ms). */
  pollMs?: number;
  /** Sayaçların akış aralığı (ms). */
  clockMs?: number;
}

/** Son başarılı tazelemeden bu kadar yoklama sonra veri bayat sayılır (istek askıda kalsa da). */
export const STALE_AFTER_POLLS = 3;

/**
 * Bayat mı: son tazeleme hata verdi ve eldeki eski veri gösteriliyor YA DA son başarılı
 * tazelemenin üzerinden `STALE_AFTER_POLLS` yoklama geçti (askıda istek hata vermez).
 */
export function isFloorStale(i: { hasData: boolean; failed: boolean; ageMs: number; pollMs: number }): boolean {
  if (!i.hasData) return false;
  return i.failed || i.ageMs > STALE_AFTER_POLLS * i.pollMs;
}

export interface LoomFloorLive {
  /** İlk cevap gelene dek null. */
  floor: FloorState | null;
  now: number;
  sampleData: false;
  isLoading: boolean;
  error: Error | null;
  /** Eldeki veri gösteriliyor ama tazelenemiyor (hata ya da askıda kalan yoklama). */
  stale: boolean;
}

export function useLoomFloorLive(options: LoomFloorLiveOptions = {}): LoomFloorLive {
  const { pollMs = 5_000, clockMs = 1_000 } = options;
  const q = useQuery({
    queryKey: LOOM_FLOOR_QUERY_KEY,
    queryFn: loomFloorService.get,
    refetchInterval: pollMs,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const floor = useMemo(() => (q.data ? fromApi(q.data) : null), [q.data]);
  const offset = floor ? floor.updatedAt - q.dataUpdatedAt : 0;
  const [clientNow, setClientNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClientNow(Date.now()), clockMs);
    return () => window.clearInterval(id);
  }, [clockMs]);
  return {
    floor,
    now: clientNow + offset,
    sampleData: false,
    isLoading: q.isPending,
    error: q.error,
    stale: isFloorStale({ hasData: q.data !== undefined, failed: q.isError, ageMs: clientNow - q.dataUpdatedAt, pollMs }),
  };
}
