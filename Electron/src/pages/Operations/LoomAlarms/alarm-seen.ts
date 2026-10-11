// =============================================================================
// TEZGAH ALARMI — "çalındı" / "şerit kapatıldı" anahtarlarının oturum belleği
// =============================================================================
// sessionStorage: sayfa yenilense de aynı alarm/kademe yeniden çalmaz; uygulama kapanınca
// unutulur (yeniden açılışta açık alarm bir kez daha duyurulur). Kullanıcı başına ayrı
// anahtar: aynı pencerede başka hesap açılırsa kendi uyarısını alır. Depolama yoksa bellek.
// =============================================================================

const CAP = 400;

export interface KeySet {
  has: (key: string) => boolean;
  addAll: (keys: readonly string[]) => void;
}

export function sessionKeySet(name: string, storage: Storage | null = safeSession()): KeySet {
  let mem: string[] = [];
  const load = (): string[] => {
    if (!storage) return mem;
    try {
      const raw = JSON.parse(storage.getItem(name) ?? "[]") as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const save = (list: string[]) => {
    mem = list;
    if (!storage) return;
    try {
      storage.setItem(name, JSON.stringify(list));
    } catch {
      // Depolama dolu/kapalı: bellek kopyası yeter.
    }
  };
  return {
    has: (key) => load().includes(key),
    addAll: (keys) => {
      const cur = load();
      const next = [...cur, ...keys.filter((k) => !cur.includes(k))];
      save(next.slice(-CAP));
    },
  };
}

function safeSession(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
