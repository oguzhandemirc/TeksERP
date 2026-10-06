import { licenseClassLabel } from '../lib/channelLabel';
import { useLicenseStatus } from './useLicenseStatus';

/** Görünür etiket (lisans sınıfı); şerit ile lisans bandı aynı değeri okusun diye tek hook. */
export function useChannelLabel(): string | null {
  const { data } = useLicenseStatus();
  return licenseClassLabel(data);
}
