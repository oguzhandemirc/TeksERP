// Belgeden iş emri: son kullanılan müşteriler (cihaz başına, seçicide üstte). Okunamazsa boş liste — yalnız kolaylık.
import { storage } from '../../../../utils/storage';
import { pushRecent } from './woFromDoc';

const KEY = 'gelen_belge_recent_owners';

export async function loadRecentOwners(): Promise<string[]> {
  try {
    const raw = await storage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function rememberOwner(current: readonly string[], id: string): Promise<string[]> {
  const next = pushRecent(current, id);
  try {
    await storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Kalıcı olmaz; oturum içinde yine üstte görünür.
  }
  return next;
}
