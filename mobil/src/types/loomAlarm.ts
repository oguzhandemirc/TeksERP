// =============================================================================
// TEZGAH ALARMI — tel tipleri (`/api/loom-alarms`)
// =============================================================================
// Backend `services/loom-alarm-read.service.ts` + panel `pages/Operations/LoomAlarms/types.ts` aynası
// (istemciler kod paylaşmaz); tarihler ISO metin. Tanınmayan durum/olay türü jenerik çizilir.
// =============================================================================
export type LoomAlarmState = "OPEN" | "ACKED" | "RESOLVED" | "CANCELLED";
export type LoomAlarmScope = "active" | "history" | "all";
export type LoomAlarmEventKind =
  | "RAISED"
  | "TIER_SKIPPED"
  | "ACK"
  | "ACK_RELEASE"
  | "SNOOZE"
  | "UNSNOOZE"
  | "NOTE"
  | "NOTE_RETRACT"
  | "RESOLVED"
  | "CANCELLED";

export interface LoomAlarmPerson {
  id: string;
  name: string;
}

export interface LoomAlarmItem {
  id: string;
  kind: string;
  state: LoomAlarmState;
  /** 1 = görevli kademesi, 2 = üst kademe (patron). */
  tier: number;
  machine: { id: string; code: string; name: string; hallId: string; hallName: string };
  stop: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    reasonCode: string | null;
    reasonLabel: string | null;
    lossClass: string | null;
    source: string;
  };
  targetMinutes: number | null;
  graceMinutes: number;
  k1DueAt: string;
  k2DueAt: string | null;
  ackedBy: LoomAlarmPerson | null;
  ackedAt: string | null;
  snoozedBy: LoomAlarmPerson | null;
  snoozedUntil: string | null;
  closedAt: string | null;
  totalSec: number | null;
  overdueSec: number | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface LoomAlarmSummary {
  total: number;
  open: number;
  acked: number;
  resolved: number;
  cancelled: number;
  escalated: number;
}

export interface LoomAlarmListResult {
  items: LoomAlarmItem[];
  nextCursor: string | null;
  summary: LoomAlarmSummary;
}

export interface LoomAlarmListParams {
  scope: LoomAlarmScope;
  /** Tablet Tezgah şeridi: yalnız bu tezgah. */
  machineId?: string;
  /** "Benim alarmlarım" (sorumlu ataması) — sunucu tanımıyorsa istemci parametresiz geri düşer. */
  mine?: boolean;
  cursor?: string;
  limit?: number;
}

/** Listenin hangi kapsamla geldiği: `mine` = sunucu süzdü · `all` = izne göre hepsi (süzgeç yok/tanınmadı). */
export type LoomAlarmAudience = 'mine' | 'all';

export interface LoomAlarmTimelineEntry {
  id: string;
  kind: LoomAlarmEventKind;
  at: string;
  tier: number | null;
  user: LoomAlarmPerson | null;
  snoozedUntil: string | null;
  note: string | null;
  code: string | null;
  retractsEventId: string | null;
  /** Yalnız NOTE: sonradan geri çekildi (metin durur, üstü çizilir). */
  retracted: boolean;
}

export interface LoomAlarmStopStat {
  count: number;
  closedCount: number;
  totalSec: number;
  avgSec: number | null;
}

export interface LoomAlarmRecentStop {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  reasonCode: string | null;
  reasonLabel: string | null;
  lossClass: string | null;
}

export interface LoomAlarmDetail {
  alarm: LoomAlarmItem;
  /** Canlı alarmda henüz çalmamış üst kademenin vadesi. */
  nextDueAt: string | null;
  timeline: LoomAlarmTimelineEntry[];
  context: { job: { weavingOrderNumber: string; itemName: string; colorName: string | null } | null };
  similar: {
    reasonCode: string;
    machine7d: LoomAlarmStopStat;
    machine30d: LoomAlarmStopStat;
    floor30d: LoomAlarmStopStat;
  } | null;
  recentStops: LoomAlarmRecentStop[];
  /** "Kime bildirildi" — sorumlu ataması (A4) indikten sonra gelir; eski sunucu göndermez → bölüm gizlenir. */
  notifications?: LoomAlarmNotificationRecord[];
}

/** Kademe çalma kaydının alıcıları: izne göre (herkes) ya da atanan kişi listesi. */
export interface LoomAlarmNotificationRecord {
  tier: number;
  at: string;
  mode: 'BY_PERMISSION' | 'LISTED' | string;
  recipients: { id: string; name: string; source: string }[];
}

export interface LoomAlarmActionResult {
  alarmId: string;
  eventId: string;
  kind: LoomAlarmEventKind;
  state: LoomAlarmState;
  ackedById: string | null;
  ackedAt: string | null;
  snoozedUntil: string | null;
}

export type SnoozeMinutes = 15 | 30 | 60;
export const SNOOZE_MINUTES: readonly SnoozeMinutes[] = [15, 30, 60];
