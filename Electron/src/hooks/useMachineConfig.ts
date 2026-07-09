import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  EMPTY_MACHINE_CONFIG,
  MACHINE_CONFIG_QUERY_KEY,
  getStoredMachineConfig,
  setStoredMachineConfig,
  type MachineConfig,
} from "@/lib/machine-config";

const PERSIST_DEBOUNCE_MS = 300;

/**
 * Modül-seviyesi debounce: tek bir COM/baud düzenlemesinde her tuşta şifreli
 * disk yazmasın. Timer + bekleyen değer modülde tekil — birden çok bileşen aynı
 * anda yazsa da son merge'lenmiş blob tek yazımda coalesce olur.
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pending: MachineConfig | null = null;

function schedulePersist(next: MachineConfig): void {
  pending = next;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const toSave = pending;
    pending = null;
    persistTimer = null;
    if (toSave)
      void setStoredMachineConfig(toSave).catch(() =>
        toast.error("Bu bilgisayarın ayarı kaydedilemedi.", { id: "machine-config-save-error" }),
      );
  }, PERSIST_DEBOUNCE_MS);
}

export interface UseMachineConfigResult {
  config: MachineConfig;
  setConfig: (patch: Partial<MachineConfig>) => void;
  ready: boolean;
}

/**
 * Bu bilgisayara özel donanım ayarlarına (etiket yazıcısı / kantar / tabanca)
 * reaktif erişim. `UserPreference` blob'unun aksine KULLANICIYA değil MAKİNEYE
 * bağlıdır — secure-store'dan okunur (`@/lib/machine-config`), oturum açan
 * kullanıcı değişse de aynı kalır. react-query cache'i tek kaynak: `setConfig`
 * anında UI'ı günceller, debounce'lu tek yazımla yerel depoya işler.
 *
 * QueryClientProvider gerektirir (uygulama genelinde mevcut). Provider yok
 * (context değil) — her çağıran aynı `["machine-config"]` cache'ini paylaşır.
 */
export function useMachineConfig(): UseMachineConfigResult {
  const queryClient = useQueryClient();

  const { data, isFetched } = useQuery({
    queryKey: MACHINE_CONFIG_QUERY_KEY,
    queryFn: getStoredMachineConfig,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const config = data ?? EMPTY_MACHINE_CONFIG;

  const setConfig = useCallback(
    (patch: Partial<MachineConfig>) => {
      const current =
        queryClient.getQueryData<MachineConfig>(MACHINE_CONFIG_QUERY_KEY) ?? EMPTY_MACHINE_CONFIG;
      const next = { ...current, ...patch };
      queryClient.setQueryData(MACHINE_CONFIG_QUERY_KEY, next); // anında UI
      schedulePersist(next);
    },
    [queryClient],
  );

  return { config, setConfig, ready: isFetched };
}
