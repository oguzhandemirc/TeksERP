// =============================================================================
// TEZGAH ALARMI — kim neyi görür/yapar (saf; izin + bayrak çözümü tek yerde)
// =============================================================================
// Bayrak: tezgah izleme (etkin = üretim ∧ tezgah) ∧ `tezgahAlarmEnabled`; kapalıyken hiçbir yüzey
// yoklamaz (uç 403 `LOOM_ALARM_DISABLED` verirdi). `mobile:tezgah-uyari` görme + üstlenme dar ikizi;
// tablet Tezgah şeridi `mobile:dokuma` ile yalnız LİSTEYİ okur. Asıl kapı sunucudadır.
// =============================================================================
import { resolveMobileModuleState } from '../../constants/screenModules';
import type { FeatureFlags } from '../../services/featureFlag.service';
import type { LoomAlarmAccess } from './policy';

export interface LoomAlarmAccessFull extends LoomAlarmAccess {
  /** Alarm bayrağı etkin (modül zinciri dahil). */
  flagOn: boolean;
  /** Tablet Tezgah şeridi kendi tezgahının alarmını okuyabilir. */
  canSeeLoomStrip: boolean;
  /** Tekrar çalma aralığı (dk). */
  renotifyMinutes: number;
}

type Flags = Partial<Pick<FeatureFlags, 'productionEnabled' | 'tezgahEnabled' | 'tezgahAlarmEnabled' | 'tezgahAlarmRenotifyMinutes'>>;

export function loomAlarmAccessOf(has: (code: string) => boolean, flags: Flags | null | undefined): LoomAlarmAccessFull {
  const flagOn = resolveMobileModuleState(flags).tezgahEnabled && flags?.tezgahAlarmEnabled === true;
  const screen = has('mobile:tezgah-uyari');
  const canView = flagOn && (screen || has('loom:alarm-view'));
  const canAct = flagOn && (screen || has('loom:alarm-ack'));
  const r = flags?.tezgahAlarmRenotifyMinutes;
  return {
    flagOn,
    canView,
    canAct,
    canReleaseOthers: canAct && has('loom:alarm-escalation'),
    canSeeLoomStrip: flagOn && (canView || has('mobile:dokuma')),
    renotifyMinutes: typeof r === 'number' && r >= 1 ? r : 10,
  };
}
