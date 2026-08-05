// Offline-first için reactive helper'lar.
// - useIsOnline: NetInfo subscription'ını component scope'una taşır
// - usePendingStationOps: kuyrukta bekleyen tüm istasyon mutation'ları
//   (QC2_COMPLETE + KURSUN_FINISH + ileride Tambur PASS/FAIL vb.)

import { useEffect, useState } from 'react';
import { onlineManager, useMutationState } from '@tanstack/react-query';
import { offlineReason, subscribeOfflineReason, type OfflineReason } from './serverReachability';

export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(onlineManager.isOnline());
  useEffect(() => {
    return onlineManager.subscribe(() => {
      setOnline(onlineManager.isOnline());
    });
  }, []);
  return online;
}

/**
 * Çevrimdışıysak NEDEN? `'link'` (ağ bağlantısı yok) · `'server'` (ağ var ama
 * sunucuya ulaşılamıyor) · `null` (çevrimiçi).
 *
 * İkisi operatöre AYRI anlatılır — "wifi'yi aç" ile "sunucu kapalı, IT'ye haber
 * ver" farklı işlerdir — ve `entryAttempt` de ikisinde farklı davranır
 * (bkz. `onAttemptDetached`).
 */
export function useOfflineReason(): OfflineReason {
  const [reason, setReason] = useState<OfflineReason>(offlineReason());
  useEffect(() => subscribeOfflineReason(() => setReason(offlineReason())), []);
  return reason;
}

export interface PendingStationOp {
  key: readonly unknown[];
  variables: unknown;
  isPaused: boolean;
}

export function usePendingStationOps(): PendingStationOp[] {
  return useMutationState<PendingStationOp>({
    filters: {
      status: 'pending',
      predicate: (mut) => {
        const key = mut.options.mutationKey;
        return Array.isArray(key) && key[0] === 'station';
      },
    },
    select: (mut) => ({
      key: (mut.options.mutationKey as readonly unknown[] | undefined) ?? [],
      variables: mut.state.variables,
      isPaused: mut.state.isPaused,
    }),
  });
}
