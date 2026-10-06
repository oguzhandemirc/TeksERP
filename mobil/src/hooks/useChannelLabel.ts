import Constants from 'expo-constants';

import { resolveVisibleLabel } from '../lib/channelLabel';
import { useLicenseStatus } from './useLicenseStatus';

/** Görünür etiket (derleme → lisans sınıfı); şerit ile lisans bandı aynı değeri okusun diye tek hook. */
export function useChannelLabel(config: { extra?: unknown } | null | undefined = Constants.expoConfig): string | null {
  const { data } = useLicenseStatus();
  return resolveVisibleLabel(config, data);
}
