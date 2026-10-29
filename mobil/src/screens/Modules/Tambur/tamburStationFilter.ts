// İster 2.8: fabrika ayarı açıksa Tambur listesi tabletin OTURUM istasyonuna göre süzülür.
// Yalnız oturum istasyonu TAMBUR türündeyse gönderilir — başka türde backend 400 verirdi.
import type { ActiveWorkSession } from '../../../services/workSession.service';

export function resolveTamburListStationId(
  session: Pick<ActiveWorkSession, 'stationId' | 'station'> | null | undefined,
  enabled: boolean,
): string | null {
  if (!enabled || !session?.stationId || session.station?.kind !== 'TAMBUR') return null;
  return session.stationId;
}
