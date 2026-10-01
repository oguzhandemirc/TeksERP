// Depo arayüzü + tarayıcı deposu (`Storage`) sarmalayıcısı — saf; yerel modül yüklemez (jest ve web aynı kodu koşar).
export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ListedStore extends KeyValue {
  keys(): Promise<readonly string[]>;
  removeMany(keys: readonly string[]): Promise<void>;
}

/** Tarayıcı deposu (`Storage`) üstünde anahtar-değer; depo yoksa (eski tarayıcı, gizli kip kısıtı) boş davranır. */
export function browserStore(s: Storage | undefined): ListedStore {
  return {
    get: async (k) => s?.getItem(k) ?? null,
    set: async (k, v) => s?.setItem(k, v),
    remove: async (k) => s?.removeItem(k),
    keys: async () => {
      if (!s) return [];
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    },
    removeMany: async (keys) => {
      for (const k of keys) s?.removeItem(k);
    },
  };
}
