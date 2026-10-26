// Bildirim sesi tekilliği: aynı satır (id + sayaç) iki kez çalmaz — çekmece, şerit ve birden çok ekranın
// başlığı aynı sorguyu okusa da. İlk okuma yalnız "görüldü" işaretler (açılışta eski satırlar çalmaz).
// Karar sunucudan: `sesli` (= kanalTablet ∧ kişinin ses ayarı; sessiz saat dağıtımda çözülmüş).
import type { InboxItem } from './types';

const seen = new Set<string>();
let primed = false;

const keyOf = (i: InboxItem) => `${i.id}:${i.sayac}`;

/** Yeni ve `sesli` satırlar. Kaynak okunmamış sekmesidir (ALARM içermez: alarm sesi tezgah alarmı yolunda). */
export function takeSoundCandidates(items: readonly InboxItem[]): InboxItem[] {
  const fresh = items.filter((i) => !seen.has(keyOf(i)));
  fresh.forEach((i) => seen.add(keyOf(i)));
  if (!primed) {
    primed = true;
    return [];
  }
  return fresh.filter((i) => i.sesli === true);
}

/** Yalnız test ve oturum değişimi için. */
export function resetSoundGate(): void {
  seen.clear();
  primed = false;
}
