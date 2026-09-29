// Fabrika günü İSTANBUL'dur (kök kural: tek kaynak saat dilimi). Bulutta gün anahtarı (bildirim kimliği) ve
// sessiz saat hesabı bu iki yardımcıdan geçer; çıplak UTC günü kullanılmaz.
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** İstanbul takvim günü `YYYY-AA-GG`. */
export function istanbulDay(ms: number): string {
  return DAY.format(new Date(ms));
}

/** İstanbul'da günün dakikası (0–1439). */
export function istanbulMinute(ms: number): number {
  const [h, m] = CLOCK.format(new Date(ms)).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function clockMinute(text: string): number {
  const [h, m] = text.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Sessiz penceredeyse pencerenin BİTİŞ anı (ms), değilse null. Başlangıç = bitiş → pencere yok. */
export function quietUntil(q: { acik: boolean; baslangic: string; bitis: string }, ms: number): number | null {
  if (!q.acik) return null;
  const start = clockMinute(q.baslangic);
  const end = clockMinute(q.bitis);
  if (start === end) return null;
  const now = istanbulMinute(ms);
  const inside = start < end ? now >= start && now < end : now >= start || now < end;
  if (!inside) return null;
  const minutesLeft = (end - now + 1440) % 1440;
  return Math.floor(ms / 60_000) * 60_000 + minutesLeft * 60_000;
}
