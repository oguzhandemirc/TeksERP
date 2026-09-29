// Kapı zili KONU dağıtımı — tek SSE aboneliği (`license-doorbell.job`) birden çok işi dürter.
// Zil içerik taşımaz, yalnız "şimdi bak" der: sahte zil fazladan bir tur yaptırır, fazlası
// değil. `lisans` konusu lisans yoklamasının kendi dalıdır; diğer konular buradan dağılır.
import { DOORBELL_TOPICS } from "../lib/license/protocol";
import { uyari } from "../lib/logger";

export type DoorbellTopic = (typeof DOORBELL_TOPICS)[number];
type Handler = () => void;

const handlers = new Map<DoorbellTopic, Set<Handler>>();

/** Konuya dinleyici ekler; dönen fonksiyon kaydı siler. */
export function onDoorbellTopic(topic: Exclude<DoorbellTopic, "lisans">, handler: Handler): () => void {
  let set = handlers.get(topic);
  if (!set) {
    set = new Set();
    handlers.set(topic, set);
  }
  set.add(handler);
  return () => set.delete(handler);
}

/** Zil geldi: konunun dinleyicilerini çağırır. Dinleyici hatası zil akışını DÜŞÜRMEZ. Dinleyici sayısı döner. */
export function dispatchDoorbellTopic(topic: string): number {
  const set = handlers.get(topic as DoorbellTopic);
  if (!set) return 0;
  for (const h of set) {
    try {
      h();
    } catch (err) {
      uyari("zil", `"${topic}" konusunun dinleyicisi hata verdi`, err instanceof Error ? err.message : err);
    }
  }
  return set.size;
}

/** Test-only. */
export function __resetDoorbellTopicsForTests(): void {
  handlers.clear();
}
