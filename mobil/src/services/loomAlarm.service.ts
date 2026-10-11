// =============================================================================
// TEZGAH ALARMI API İSTEMCİSİ — `/api/loom-alarms` (Uyarılar ekranı · Tezgah şeridi · bildirim)
// =============================================================================
// Kapı: tezgah modülü ∧ `tezgah.alarmEnabled` (kapalı → 403 `LOOM_ALARM_DISABLED`) ∧ izin.
// "Benim alarmlarım" (`mine=1`): sorgu şeması `.strict()` — tanımayan sunucu parametreyi SİLMEZ,
// 400 "Unrecognized key" döner. O 400'de parametresiz yeniden istenir ve süreç boyunca hatırlanır.
// Eylemler `clientToken` taşır (deneme başına bir kez; yapışma kuralı çağıranda — `attemptToken`).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type {
  LoomAlarmActionResult,
  LoomAlarmAudience,
  LoomAlarmDetail,
  LoomAlarmListParams,
  LoomAlarmListResult,
  SnoozeMinutes,
} from '../types/loomAlarm';

const BASE = '/loom-alarms';
/** Sorumlu süzgecinin parametre adı — sunucu sözleşmesiyle TEK yerde. */
export const ALARM_MINE_PARAM = 'mine';

export function loomAlarmListQuery(p: LoomAlarmListParams, withMine: boolean): string {
  const parts: string[] = [`scope=${encodeURIComponent(p.scope)}`];
  if (p.machineId) parts.push(`machineId=${encodeURIComponent(p.machineId)}`);
  if (withMine && p.mine) parts.push(`${ALARM_MINE_PARAM}=1`);
  if (p.cursor) parts.push(`cursor=${encodeURIComponent(p.cursor)}`);
  if (p.limit !== undefined) parts.push(`limit=${p.limit}`);
  return parts.join('&');
}

interface ValidationBody {
  message?: string;
  errors?: { field?: string; message?: string }[];
}

/** 400 gövdesi "bu sunucu `mine`ı tanımıyor" mu diyor (yalnız o anahtar için; başka doğrulama hatası düşmez). */
export function isMineUnsupported(status: number, body: unknown): boolean {
  if (status !== 400) return false;
  const errs = (body as ValidationBody | null)?.errors;
  if (!Array.isArray(errs)) return false;
  return errs.some((e) => typeof e?.message === 'string' && e.message.includes(`"${ALARM_MINE_PARAM}"`));
}

// Süreç boyunca: null = denenmedi · true = sunucu süzüyor · false = tanımıyor (izne göre hepsi).
let mineSupport: boolean | null = null;
/** Test ve oturum değişimi için (yeni sunucu sürümü süzgeci kazanmış olabilir). */
export function resetMineSupport(): void {
  mineSupport = null;
}

export interface LoomAlarmList extends LoomAlarmListResult {
  audience: LoomAlarmAudience;
}

function rejectionOf(status: number, body: unknown): Error & { status: number } {
  const msg = (body as ValidationBody | null)?.message || 'Validasyon hatası';
  return Object.assign(new Error(msg), { status });
}

async function getList(p: LoomAlarmListParams, withMine: boolean) {
  // Yalnız 400 interceptor'a girmeden döner (gövdeyi okumak için); diğer hatalar ortak yoldan.
  return apiClient.get<ApiResponse<LoomAlarmListResult> & ValidationBody>(`${BASE}?${loomAlarmListQuery(p, withMine)}`, {
    validateStatus: (s) => (s >= 200 && s < 300) || s === 400,
  });
}

export const loomAlarmService = {
  list: async (p: LoomAlarmListParams): Promise<LoomAlarmList> => {
    let filtered = p.mine === true && mineSupport !== false;
    let r = await getList(p, filtered);
    if (filtered && isMineUnsupported(r.status, r.data)) {
      mineSupport = false;
      filtered = false;
      r = await getList(p, false);
    }
    if (r.status === 400) throw rejectionOf(r.status, r.data);
    if (filtered) mineSupport = true;
    return { ...r.data.data, audience: filtered ? 'mine' : 'all' };
  },
  detail: (id: string): Promise<LoomAlarmDetail> =>
    apiClient.get<ApiResponse<LoomAlarmDetail>>(`${BASE}/${id}`).then((r) => r.data.data),
  ack: (id: string, clientToken: string) => post(`${BASE}/${id}/ack`, { clientToken }),
  release: (id: string, clientToken: string) => post(`${BASE}/${id}/release`, { clientToken }),
  snooze: (id: string, minutes: SnoozeMinutes, clientToken: string) => post(`${BASE}/${id}/snooze`, { minutes, clientToken }),
  unsnooze: (id: string, clientToken: string) => post(`${BASE}/${id}/unsnooze`, { clientToken }),
  note: (id: string, note: string, clientToken: string) => post(`${BASE}/${id}/notes`, { note, clientToken }),
  retractNote: (id: string, eventId: string, clientToken: string) =>
    post(`${BASE}/${id}/notes/${eventId}/retract`, { clientToken }),
};

function post(path: string, body: object): Promise<LoomAlarmActionResult> {
  return apiClient.post<ApiResponse<LoomAlarmActionResult>>(path, body).then((r) => r.data.data);
}
