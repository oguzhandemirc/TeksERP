// =============================================================================
// Tablet local deviceId — kalıcı UUID, ilk açılışta üretilir.
// SecureStore'da saklanır. Tablet sıfırlanmadıkça değişmez.
// Değer süreç ömründe DEĞİŞMEZ → modülde memoize edilir: her API isteği bu
// fonksiyonu çağırıyor ve Keystore köprü turu istek başına gereksiz vergiydi.
// Promise cache'lenir ki açılıştaki eşzamanlı ilk istekler tek okumaya binsin
// (yarışta iki UUID üretilmesin).
// =============================================================================

import { storage } from './storage';

const STORAGE_KEY = 'device_local_id';

let cachedDeviceId: Promise<string> | null = null;

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

export function getOrCreateDeviceId(): Promise<string> {
  if (!cachedDeviceId) {
    cachedDeviceId = (async () => {
      const existing = await storage.getItem(STORAGE_KEY);
      if (existing && existing.length >= 8) return existing;
      const fresh = generateUuidV4();
      await storage.setItem(STORAGE_KEY, fresh);
      return fresh;
    })().catch((err) => {
      // Okuma/yazma hatasında cache'i bırakma — sonraki çağrı yeniden denesin
      // (kalıcı boş deviceId'yle sıkışmayalım).
      cachedDeviceId = null;
      throw err;
    });
  }
  return cachedDeviceId;
}
