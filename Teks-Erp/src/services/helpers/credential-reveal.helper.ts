// Yeni verilen PIN/kartın DÜZ değeri yalnız bellekte, kısa bir basım penceresi boyunca tutulur:
// DB'de düz değer yoktur; eski panel değeri POST cevabından değil `credentials` okumasından aldığı
// için pencere olmadan yeni PIN'i hiç göremezdi. Süreç yeniden başlarsa pencere kaybolur (güvenli yön).
const REVEAL_TTL_MS = 10 * 60 * 1000;

interface Entry { value: string; until: number }
const pins = new Map<string, Entry>();
const cards = new Map<string, Entry>();

function read(map: Map<string, Entry>, userId: string, now: number): Entry | null {
  const e = map.get(userId);
  if (!e) return null;
  if (e.until <= now) {
    map.delete(userId);
    return null;
  }
  return e;
}

export function rememberIssuedPin(userId: string, pin: string, now = Date.now()): void {
  pins.set(userId, { value: pin, until: now + REVEAL_TTL_MS });
}

export function rememberIssuedCard(userId: string, cardCode: string, now = Date.now()): void {
  cards.set(userId, { value: cardCode, until: now + REVEAL_TTL_MS });
}

export function forgetIssuedPin(userId: string): void {
  pins.delete(userId);
}

export function forgetIssuedCard(userId: string): void {
  cards.delete(userId);
}

export function readIssued(userId: string, now = Date.now()): {
  pin: Entry | null;
  card: Entry | null;
} {
  return { pin: read(pins, userId, now), card: read(cards, userId, now) };
}
