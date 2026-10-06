// D5 native zorlama katmanına tek erişim noktası (mobil/modules/teks-erp-lan-tls, docs/design/LAN-TLS.md §6).
// Modül yoksa, beklenen işlevi taşımıyorsa ya da ağ istemcisine kurulamamışsa `null`: bu sürüm şifreli
// bağlantıyı ZORLAYAMAZ ve sabit yazılmaz.
import { requireOptionalNativeModule } from 'expo';

export interface LanTlsNative {
  setPinState: (fingerprints: string[], endpoints: string[]) => Promise<void>;
  getPinState: () => { installed: boolean; fingerprints: string[]; endpoints: string[] };
}

export function lanTlsNative(): LanTlsNative | null {
  let m: Partial<LanTlsNative> | null;
  try {
    m = requireOptionalNativeModule<Partial<LanTlsNative>>('TeksErpLanTls');
  } catch {
    return null;
  }
  if (!m || typeof m.setPinState !== 'function' || typeof m.getPinState !== 'function') return null;
  try {
    return m.getPinState().installed === true ? (m as LanTlsNative) : null;
  } catch {
    return null;
  }
}
