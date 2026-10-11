// =============================================================================
// TEZGAH ALARMI API İSTEMCİSİ — `/api/loom-alarms`
// =============================================================================
// ⚠️ YOLLAR TAM YAZILIR ("/api/…") — `apiClient.baseURL` `/api` İÇERMEZ.
// Kapı: tezgah modülü ∧ `tezgah.alarmEnabled` (kapalı → 403 `LOOM_ALARM_DISABLED`) ∧ izin.
// Eylemlerde genel toast bastırılır: 403/409 kodları (başkası üstlendi · kapandı) yetki
// sorunu değildir; cümleyi `useLoomAlarmActions` backend mesajından basar.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  LoomAlarmActionResult,
  LoomAlarmDetail,
  LoomAlarmListParams,
  LoomAlarmListResult,
  MountedBeam,
  SnoozeMinutes,
} from "./types";

const BASE = "/api/loom-alarms";

export function loomAlarmListQuery(p: LoomAlarmListParams): string {
  const sp = new URLSearchParams();
  sp.set("scope", p.scope);
  if (p.stationId) sp.set("stationId", p.stationId);
  if (p.reasonCode) sp.set("reasonCode", p.reasonCode);
  if (p.tier !== undefined) sp.set("tier", String(p.tier));
  if (p.from) sp.set("from", p.from);
  if (p.to) sp.set("to", p.to);
  if (p.cursor) sp.set("cursor", p.cursor);
  if (p.limit !== undefined) sp.set("limit", String(p.limit));
  return sp.toString();
}

type Action = Promise<ApiResponse<LoomAlarmActionResult>>;
const post = (path: string, body: object): Action =>
  apiClient.post<ApiResponse<LoomAlarmActionResult>>(path, body, { suppressErrorToast: true }).then((r) => r.data);

export const loomAlarmService = {
  /** `quiet`: zil yoklaması ve liste sayfası — kapalı bayrak/izin ve ağ hatası toast basmaz (sayfa kendisi anlatır). */
  list: (p: LoomAlarmListParams, quiet = false): Promise<LoomAlarmListResult> =>
    apiClient
      .get<ApiResponse<LoomAlarmListResult>>(`${BASE}?${loomAlarmListQuery(p)}`, { suppressErrorToast: quiet })
      .then((r) => r.data.data),
  detail: (id: string): Promise<LoomAlarmDetail> =>
    apiClient.get<ApiResponse<LoomAlarmDetail>>(`${BASE}/${id}`, { suppressErrorToast: true }).then((r) => r.data.data),
  /** Tezgahta takılı leventler (devere bağ defteri) — alarm sayfasının bağlam bloğu; hata sessiz. */
  mountedBeams: (machineId: string): Promise<MountedBeam[]> =>
    apiClient
      .get<ApiResponse<MountedBeam[]>>(`/api/warp-beams/mounted/${machineId}`, { suppressErrorToast: true })
      .then((r) => r.data.data ?? []),
  ack: (id: string, clientToken: string): Action => post(`${BASE}/${id}/ack`, { clientToken }),
  release: (id: string, clientToken: string): Action => post(`${BASE}/${id}/release`, { clientToken }),
  snooze: (id: string, minutes: SnoozeMinutes, clientToken: string): Action => post(`${BASE}/${id}/snooze`, { minutes, clientToken }),
  unsnooze: (id: string, clientToken: string): Action => post(`${BASE}/${id}/unsnooze`, { clientToken }),
  note: (id: string, note: string, clientToken: string): Action => post(`${BASE}/${id}/notes`, { note, clientToken }),
  retractNote: (id: string, eventId: string, clientToken: string): Action =>
    post(`${BASE}/${id}/notes/${eventId}/retract`, { clientToken }),
};
