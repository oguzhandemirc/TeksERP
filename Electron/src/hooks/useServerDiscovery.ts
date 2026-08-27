import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscoveredServer, DiscoveryState } from "@shared/ipc-contract";

/**
 * Sunucu keşfi durumunu main process'ten okur.
 *
 * ⚠️ YOKLAMALI (polling), abonelik DEĞİL. `useUpdater`den ayrıldığı tek nokta bu
 * ve bilinçli: splash penceresi renderer'a `loadFile`→`loadURL` ile geçiyor, bu
 * geçiş `webContents.send` dinleyicilerini DÜŞÜRÜYOR. Bir "push" kanalı burada
 * sessizce hiç ateşlemeyen bir bildirim üretirdi. Yoklama yalnız tur koşarken
 * çalışır, bitince durur — boşta maliyeti sıfır.
 *
 * `window.api.discovery` yoksa (tarayıcı derlemesi, birim testi) hook sessizce
 * `null` döner.
 */
export function useServerDiscovery() {
  const [state, setState] = useState<DiscoveryState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pull = useCallback(async () => {
    const api = window.api?.discovery;
    if (!api) return null;
    try {
      const s = await api.state();
      setState(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  // Koşarken 500 ms'de bir yokla; terminal duruma gelince DUR.
  useEffect(() => {
    let active = true;
    const tick = async (): Promise<void> => {
      const s = await pull();
      if (!active) return;
      if (s?.status === "running") timer.current = setTimeout(() => void tick(), 500);
    };
    void tick();
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pull]);

  const start = useCallback(
    async (timeoutMs?: number) => {
      const api = window.api?.discovery;
      if (!api) return null;
      setState((prev) => (prev ? { ...prev, status: "running" } : prev));
      const s = await api.start(timeoutMs ? { timeoutMs } : undefined);
      setState(s);
      return s;
    },
    [],
  );

  const probe = useCallback(async (baseUrl: string): Promise<DiscoveredServer | null> => {
    const api = window.api?.discovery;
    if (!api) return null;
    return api.probe(baseUrl);
  }, []);

  const pin = useCallback(async (installationId: string | null) => {
    await window.api?.discovery?.pin(installationId);
  }, []);

  return { state, refresh: pull, start, probe, pin };
}
