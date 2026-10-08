// Sunucu ekleme (kullanıcı kararı 2026-10-08): QR ya da doğrulama koduyla verilen sabit önce yazılır, sonra
// uygulamanın KENDİ ağ istemcisiyle (native sabit katmanı) kimlik ucu okunur — okunamazsa ya da kurulum kimliği
// tutmazsa sabit geri alınır ve adres değişmez. Sonuç her iki yolda da sabitlenmiş şifreli bağlantıdır.
import { parseIdentityPayload } from '../lib/discovery';
import type { TlsPin } from '../lib/lan-tls';
import { setPinnedInstallationId, useBaseUrlStore } from '../store/baseUrlStore';
import { addTlsPin, getTlsPins, lanTlsNativeAvailable, pushNativePinState, restoreTlsPins } from './lanTlsPins';
import { NATIVE_MISSING_REASON } from './tlsProbe';

const VERIFY_TIMEOUT_MS = 6000;

export type PairResult = { ok: true } | { ok: false; reason: string };

async function readIdentityOverPinnedChannel(baseUrl: string): Promise<{ installationId: string | null } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/api/discovery/identity`, { signal: ctrl.signal });
    if (res.status !== 200) return null;
    return parseIdentityPayload(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function completePairing(decision: { pin: TlsPin; baseUrl: string }): Promise<PairResult> {
  if (!lanTlsNativeAvailable()) return { ok: false, reason: NATIVE_MISSING_REASON };
  const before = await getTlsPins();
  await addTlsPin(decision.pin);
  const identity = await readIdentityOverPinnedChannel(decision.baseUrl);
  const expected = decision.pin.installationId;
  const reason = !identity
    ? 'Şifreli bağlantı kurulamadı — sunucu sertifikası doğrulanan kodla açılmadı. Sunucu açık mı, adres doğru mu?'
    : expected && identity.installationId !== expected
      ? 'Bağlanılan sunucu doğrulanan sunucu değil — bağlanılmadı.'
      : null;
  if (reason) {
    await restoreTlsPins(before);
    return { ok: false, reason };
  }
  if (!expected && identity?.installationId) {
    await restoreTlsPins(before);
    await addTlsPin({ ...decision.pin, installationId: identity.installationId });
  }
  // Kod/QR ile doğrulanmış açık bir insan kararı: keşfin aradığı kimlik bu sunucununki olur.
  const iid = expected ?? identity?.installationId ?? null;
  if (iid) await setPinnedInstallationId(iid);
  await useBaseUrlStore.getState().setCustomUrl(decision.baseUrl);
  await pushNativePinState();
  return { ok: true };
}
