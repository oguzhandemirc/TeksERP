import { useSyncExternalStore } from 'react';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { usePermissions } from '../../hooks/usePermission';
import { canBindCustomerCode } from './customerCodeLogic';

// Oturum boyu: bağla ucu 404 verdiyse (eski backend) düğme bir daha çizilmez.
let endpointMissing = false;
const listeners = new Set<() => void>();
export function markCustomerCodeEndpointMissing(): void {
  endpointMissing = true;
  listeners.forEach((l) => l());
}
/** Yalnız testler için. */
export function resetCustomerCodeEndpointMissing(): void {
  endpointMissing = false;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Bu top için "Müşteri etiketini okut" düğmesi çizilsin mi (izin · emanet · sunucu yeteneği · emanet top)? */
export function useCustomerCodeBindable(ownerCustomerId: string | null | undefined): boolean {
  const { has } = usePermissions();
  const flags = useFeatureFlags().data;
  const missing = useSyncExternalStore(subscribe, () => endpointMissing);
  return canBindCustomerCode({
    has,
    emanetEnabled: flags?.emanetEnabled === true,
    serverKnowsCustomerCode: typeof flags?.scanCustomerCodeLookupEnabled === 'boolean',
    endpointMissing: missing,
    ownerCustomerId,
  });
}
