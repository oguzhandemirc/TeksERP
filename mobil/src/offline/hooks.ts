// Offline-first için reactive helper'lar.
// - useIsOnline: NetInfo subscription'ını component scope'una taşır
// - usePendingStationOps: kuyrukta bekleyen tüm istasyon mutation'ları
//   (QC2_COMPLETE + KURSUN_FINISH + ileride Tambur PASS/FAIL vb.)

import { useEffect, useState } from 'react';
import { onlineManager, useMutationState } from '@tanstack/react-query';

export function useIsOnline(): boolean {
  const [online, setOnline] = useState<boolean>(onlineManager.isOnline());
  useEffect(() => {
    return onlineManager.subscribe(() => {
      setOnline(onlineManager.isOnline());
    });
  }, []);
  return online;
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
