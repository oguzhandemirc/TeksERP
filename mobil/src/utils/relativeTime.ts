// Kısa "ne zamandır bekliyor" formatlayıcı — fabrika operatör listelerinde
// kullanılır. Örnek çıktılar: "3 dk", "2s 15dk", "1 gün", "şimdi", "—".
// dayjs/relativeTime plugin bağımlılığı olmadan, küçük tutuldu.

export function formatRelativeWait(
  iso: string | Date | null | undefined,
): string {
  if (!iso) return '—';
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  if (Number.isNaN(t)) return '—';
  const ms = Date.now() - t;
  if (ms < 60_000) return 'şimdi';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem > 0 ? `${hours}s ${rem}dk` : `${hours}s`;
  }
  const days = Math.floor(hours / 24);
  return `${days} gün`;
}
