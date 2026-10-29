// İster 2.8: Tambur listesi tabletin OTURUM istasyonuna göre süzülür. Yalnız oturum
// istasyonu TAMBUR türündeyse gönderilir — başka türde backend 400 verir ve liste boşa düşerdi.
import type { ActiveWorkSession } from '../../../services/workSession.service';

export function resolveTamburListStationId(
  session: Pick<ActiveWorkSession, 'stationId' | 'station'> | null | undefined,
): string | null {
  if (!session?.stationId || session.station?.kind !== 'TAMBUR') return null;
  return session.stationId;
}
