// Ekran odaklanınca `ozet` zili (S47): içerik taşımaz, yalnız fabrikaya "anlık tur" dürtmesi. Hata sessizdir —
// tazeleme en iyi çabadır, ekranın verisi zaten önbellekten/son eşitlemeden gelir. Zil çaldıysa fabrikanın birkaç
// saniye sonra gönderdiği paket AYNI ekranda görünsün diye 3/6/10 sn'de `GET /oturum`; damga değişince bütün
// veri kancaları geçersizleşir (zil TÜM projeksiyonları tazeler) ve takip biter.
import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import type { SnapshotRefresh } from "../api/wire";
import { openRefreshGate } from "../lib/refresh";
import { ALL_TAGS, invalidate } from "./changes";
import { useSession } from "./session";

/** Zil sonrası damga yoklaması (zilden itibaren ms). */
export const AFTER_DOORBELL_MS: readonly number[] = [3_000, 6_000, 10_000];

/**
 * Zil sonrası takip: her adımda `check()` yeni damgayı döner; `before`dan farklıysa `onChanged` bir kez çağrılır ve
 * kalan adımlar iptal edilir. Dönen fonksiyon odak kaybında bekleyenleri iptal eder.
 */
export function followDoorbell(before: string | null, check: () => Promise<string | null>, onChanged: () => void): () => void {
  let done = false;
  const timers = AFTER_DOORBELL_MS.map((ms) =>
    setTimeout(() => {
      if (done) return;
      void check()
        .then((now) => {
          if (done || now === null || now === before) return;
          done = true;
          onChanged();
        })
        .catch(() => undefined);
    }, ms),
  );
  return () => {
    done = true;
    timers.forEach(clearTimeout);
  };
}

export function useOpenRefresh(): void {
  const { api, refresh, factoryStamp } = useSession();
  const live = useRef({ refresh, factoryStamp });
  live.current = { refresh, factoryStamp };
  useFocusEffect(
    useCallback(() => {
      let cancel: (() => void) | null = null;
      let gone = false;
      let rang: SnapshotRefresh | null = null;
      const before = live.current.factoryStamp;
      void openRefreshGate
        .request(Date.now(), () => api.refresh().then((r) => (rang = r)))
        .then(() => {
          if (gone || !rang?.zil) return;
          cancel = followDoorbell(
            before,
            async () => (await live.current.refresh())?.esitleme?.ufuk ?? null,
            () => invalidate([ALL_TAGS]),
          );
        });
      return () => {
        gone = true;
        cancel?.();
      };
    }, [api]),
  );
}
