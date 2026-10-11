// =============================================================================
// TEZGAH ALARMI — bildirim verisi ↔ uygulama içi hedef (derin bağlantı; saf)
// =============================================================================
// Bildirim yalnız UYGULAMA İÇİ bir yol taşır (patron `safeRoute` emsali): tanınmayan/eksik veri yok
// sayılır, dışarıdan URL açılmaz. Alarm kimliği UUID biçiminde değilse liste açılır (uydurulmaz).
// =============================================================================

/** Bildirim içeriğinin `data` alanı. */
export interface AlarmNotificationData {
  kind: 'loom-alarm';
  /** Tek alarm → alarm sayfası; yoksa Uyarılar listesi. */
  alarmId?: string;
}

export type AlarmTarget = { screen: 'UyariDetay'; alarmId: string } | { screen: 'Uyarilar' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function alarmNotificationData(alarmId: string | null): AlarmNotificationData {
  return alarmId ? { kind: 'loom-alarm', alarmId } : { kind: 'loom-alarm' };
}

/** Dokunulan bildirimin hedefi; bizim bildirimimiz değilse null. */
export function alarmTargetOf(data: unknown): AlarmTarget | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { kind?: unknown; alarmId?: unknown };
  if (d.kind !== 'loom-alarm') return null;
  if (typeof d.alarmId === 'string' && UUID.test(d.alarmId)) return { screen: 'UyariDetay', alarmId: d.alarmId };
  return { screen: 'Uyarilar' };
}
