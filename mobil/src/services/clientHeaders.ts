// İstemci başlıklarının TEK kurucusu: axios interceptor'ı ve zil akışı (`expo/fetch`, axios dışı) aynı
// başlıkları buradan alır — Bearer, `x-device-id`, cihaz kanıtı, istemci künyesi (plan §3.10).
import Constants from 'expo-constants';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { DEVICE_PROOF_HEADER, deviceProofFor } from './deviceProof';

/** Kimlik dışı başlıklar; hata yutulur (başlık yoksa backend normal çalışır). */
export async function buildDeviceHeaders(method: string | undefined, fullUrl: string): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  try {
    const deviceId = await getOrCreateDeviceId();
    if (deviceId) h['x-device-id'] = deviceId;
    // Cihaz kanıtı: kimliğin sahibi olduğumuzu sunucunun verdiği sırla imzalar (B3).
    const proof = deviceId ? await deviceProofFor(method, fullUrl) : null;
    if (proof) h[DEVICE_PROOF_HEADER] = proof;
    // İSTEMCİ KÜNYESİ — BİLGİLENDİRME, kimlik kanıtı DEĞİL (backend `constants/client-info.ts`).
    h['X-Client-Kind'] = 'mobil';
    // Paketten okunur: uzaktan güncelleme sürümü native'e dokunmadan değiştirir.
    const version = Constants.expoConfig?.version;
    if (typeof version === 'string' && version) h['X-Client-Version'] = version;
    if (deviceId) h['X-Client-Instance'] = deviceId;
  } catch {
    // header yoksa backend normal çalışmaya devam eder
  }
  return h;
}
