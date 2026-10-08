// Tabletin şifreli bağlantı sabit deposu (docs/design/LAN-TLS.md §6). Sabit cihazın güvenli deposunda
// (expo-secure-store) durur ve GERÇEĞİN KAYNAĞIDIR. Bağlantıyı ZORLAYAN katman native'dir (D5: OkHttp'a
// parmak izi denetleyen TrustManager, `lanTlsNative.ts`); o katman yoksa sabit yazılmaz — bkz. decideQrPin.
// Native kendi kalıcı kopyasını açılışta JS'ten önce yükler (ilk istek de sabitle gider); JS her açılışta,
// her sabit değişikliğinde ve her adres değişikliğinde güncel kümeyi yeniden iter.
import { storage } from '../utils/storage';
import { TLS_PINS_KEY, nativePinState, parseTlsPins, withPin, type TlsPin } from '../lib/lan-tls';
import { parseUrlParts, useBaseUrlStore } from '../store/baseUrlStore';
import { lanTlsNative } from './lanTlsNative';

export function lanTlsNativeAvailable(): boolean {
  return lanTlsNative() !== null;
}

export async function getTlsPins(): Promise<TlsPin[]> {
  try {
    return parseTlsPins(await storage.getItem(TLS_PINS_KEY));
  } catch {
    return [];
  }
}

// İtmeler sıraya girer ve her biri o anki depo + adresi okur: geç kalan eski bir itme yenisini ezemez.
let pushChain: Promise<void> = Promise.resolve();

/** Güncel sabit kümesini native katmana iter. Native yoksa hiçbir şey yapmaz. */
export function pushNativePinState(): Promise<void> {
  const run = async () => {
    const native = lanTlsNative();
    if (!native) return;
    const state = nativePinState(await getTlsPins(), parseUrlParts(useBaseUrlStore.getState().baseUrl));
    await native.setPinState(state.fingerprints, state.endpoints);
  };
  const next = pushChain.then(run, run);
  pushChain = next.catch(() => undefined);
  return next;
}

async function writePins(pins: TlsPin[]): Promise<void> {
  if (pins.length === 0) await storage.deleteItem(TLS_PINS_KEY);
  else await storage.setItem(TLS_PINS_KEY, JSON.stringify(pins));
  await pushNativePinState();
}

/** Aynı kurulumun eski sabiti yerini yeniye bırakır. */
export async function addTlsPin(pin: TlsPin): Promise<TlsPin[]> {
  const next = withPin(await getTlsPins(), pin);
  await writePins(next);
  return next;
}

/** Bir denemenin öncesine dönüş: sabit kümesini verilen anlık görüntüyle değiştirir. */
export async function restoreTlsPins(pins: TlsPin[]): Promise<void> {
  await writePins(pins);
}

export async function removeTlsPins(installationId: string | null): Promise<TlsPin[]> {
  const next = (await getTlsPins()).filter((p) => p.installationId !== installationId);
  await writePins(next);
  return next;
}

let syncStarted = false;

/**
 * Açılışta bir kez: adres deposu yüklenince kümeyi iter, sonra her adres değişikliğinde yeniden iter.
 * Adres yüklenmeden itilmez (boş adres sabitli ucu geçici olarak düşürürdü). Native yoksa etkisiz.
 */
export function startLanTlsNativeSync(): void {
  if (syncStarted || !lanTlsNative()) return;
  syncStarted = true;
  const push = () => {
    pushNativePinState().catch((e: unknown) => {
      console.warn('[lan-tls] sabit kümesi native katmana iletilemedi', e);
    });
  };
  let last: string | null = null;
  const onState = (s: { isLoaded: boolean; baseUrl: string }) => {
    if (!s.isLoaded || s.baseUrl === last) return;
    last = s.baseUrl;
    push();
    // İnternet kipinde kurulum kimliği kayıtla aynı mı (değiştiyse adres kullanılamaz; döngüsüz tembel yük).
    void import('./internetServers').then((m) => m.verifyInternetIdentity()).catch(() => undefined);
  };
  useBaseUrlStore.subscribe(onState);
  onState(useBaseUrlStore.getState());
}

/** Yalnız testler için: modül düzeyi durumu sıfırlar. */
export function __resetLanTlsSyncForTests(): void {
  syncStarted = false;
  pushChain = Promise.resolve();
}
