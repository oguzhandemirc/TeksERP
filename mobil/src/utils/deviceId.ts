// =============================================================================
// Tablet local deviceId — kalıcı UUID, ilk açılışta üretilir.
// SecureStore'da saklanır. Tablet sıfırlanmadıkça değişmez.
// =============================================================================

import { storage } from './storage';

const STORAGE_KEY = 'device_local_id';

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

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await storage.getItem(STORAGE_KEY);
  if (existing && existing.length >= 8) return existing;
  const fresh = generateUuidV4();
  await storage.setItem(STORAGE_KEY, fresh);
  return fresh;
}
