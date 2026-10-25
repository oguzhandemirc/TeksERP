// =============================================================================
// Tablet local deviceId — kalıcı UUID, ilk açılışta üretilir (SecureStore).
// Değer süreç ömründe DEĞİŞMEZ → modülde memoize edilir (istek başına Keystore turu
// gereksiz vergiydi); Promise cache'lenir ki eşzamanlı ilk istekler tek okumaya binsin.
//
// Eşleme v2 (§5.5 md. 5): "değer YOK" ile "OKUNAMADI" ayrıdır. Okuma hatasında kalıcı
// değer YAZILMAZ — yazılsaydı Keystore anlık arızası tabletin kimliğini kalıcı ezerdi.
// Oturum bellekte geçici kimlikle sürer; donanım özeti sunucuda aynı satırı tanır.
// =============================================================================

import { storage } from './storage';

const STORAGE_KEY = 'device_local_id';

let cachedDeviceId: Promise<string> | null = null;
let ephemeral = false;

/**
 * RN ortamında crypto.randomUUID güvenli değil; basit UUID v4 yeterli.
 * Bu ID sadece backend'in cihazı tanıması için kullanılır — kriptografik amaçlı değil.
 */
function generateUuidV4(): string {
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[(Math.floor(Math.random() * 4) + 8) | 0];
    } else {
      uuid += hex[Math.floor(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

/** Bu oturumun kimliği geçici mi (depo okunamadı)? Tanı/ayar ekranı için. */
export function isEphemeralDeviceId(): boolean {
  return ephemeral;
}

export function getOrCreateDeviceId(): Promise<string> {
  if (!cachedDeviceId) {
    cachedDeviceId = (async () => {
      let existing: string | null;
      try {
        existing = await storage.getItem(STORAGE_KEY);
      } catch {
        // OKUNAMADI: kalıcı değere dokunma; oturum boyu tek geçici kimlik (memoize edilir).
        ephemeral = true;
        return generateUuidV4();
      }
      if (existing && existing.length >= 8) return existing;
      // YOK: ilk kurulum — üret ve yaz.
      const fresh = generateUuidV4();
      await storage.setItem(STORAGE_KEY, fresh);
      return fresh;
    })().catch((err) => {
      // Yazma hatasında cache'i bırakma — sonraki çağrı yeniden denesin.
      cachedDeviceId = null;
      throw err;
    });
  }
  return cachedDeviceId;
}

/** Yalnız testler: modül önbelleğini sıfırlar. */
export function __resetDeviceIdForTest(): void {
  cachedDeviceId = null;
  ephemeral = false;
}
