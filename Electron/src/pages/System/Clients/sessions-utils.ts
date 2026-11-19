/**
 * Açık oturumlar sekmesinin saf yardımcıları (React'ten bağımsız, birim test edilir).
 */
import { compareVersions } from "@/lib/version-compare";
import type { OpenSession, SessionDeviceType } from "./sessions-service";

/** Backend `TYPE_SEARCH_LABELS` ilk değerleriyle aynı — arama bu adlarla da eşleşir. */
export const SESSION_TYPE_LABELS: Record<SessionDeviceType, string> = {
  ELECTRON: "Masaüstü panel",
  MOBILE: "Tablet",
  WEB: "Tarayıcı",
  PATRON: "Patron telefonu",
};

export function sessionTypeLabel(t: string): string {
  return SESSION_TYPE_LABELS[t as SessionDeviceType] ?? t;
}

/** Cihaz adı > "Tanımsız (öneki)" > tür adı (cihaz kimliği göndermeyen panel/tarayıcı). */
export function sessionDeviceTitle(s: Pick<OpenSession, "deviceName" | "deviceIdPrefix" | "deviceType">): string {
  if (s.deviceName) return s.deviceName;
  if (s.deviceIdPrefix) return `Tanımsız (${s.deviceIdPrefix})`;
  return "—";
}

export interface VersionStripItem {
  deviceType: SessionDeviceType;
  version: string | null;
  count: number;
  /** Yayındaki sürümden geride mi (ileride olan geride sayılmaz). */
  outdated: boolean;
}

/** Tür + sürüm başına oturum sayısı; tür sırası sabit, türde yeni sürüm önce, ölçülemeyen sonda. */
export function versionStrip(sessions: OpenSession[]): VersionStripItem[] {
  const map = new Map<string, VersionStripItem>();
  for (const s of sessions) {
    const key = `${s.deviceType}|${s.clientVersion ?? ""}`;
    const cur = map.get(key);
    if (cur) cur.count++;
    else {
      const outdated = !!s.clientVersion && !!s.expectedVersion && compareVersions(s.clientVersion, s.expectedVersion) < 0;
      map.set(key, { deviceType: s.deviceType, version: s.clientVersion, count: 1, outdated });
    }
  }
  const order = Object.keys(SESSION_TYPE_LABELS);
  return [...map.values()].sort((a, b) => {
    const t = order.indexOf(a.deviceType) - order.indexOf(b.deviceType);
    if (t !== 0) return t;
    if (a.version === null) return 1;
    if (b.version === null) return -1;
    return compareVersions(b.version, a.version);
  });
}
