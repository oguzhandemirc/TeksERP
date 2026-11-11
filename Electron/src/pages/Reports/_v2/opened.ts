// Kişinin rapor açılış kaydı — `UserPreference.preferences.raporlar.opened` (kişisel, ayrı tablo YOK).
// Rapor Merkezi "Son açtıklarım" ve "Sık açtıklarım" buradan okur. Fabrika geneli kullanım istatistiği
// DEĞİLDİR (öyle bir kaynak yok; SystemLog'dan sayı türetilmez). Kapanan rapor çizimde düşer, kayıtta kalır.
import { useCallback, useEffect, useMemo } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";
import type { ReportOpenRecord } from "@/types/preferences";

export const MAX_OPENED_RECORDS = 20;

/** Açılışı kayda işler: varsa sayaç +1 ve zaman tazelenir; yoksa eklenir; sınır aşılırsa EN ESKİ açılan düşer. */
export function recordOpen(list: readonly ReportOpenRecord[], key: string, at: string, max = MAX_OPENED_RECORDS): ReportOpenRecord[] {
  const prev = list.find((r) => r.key === key);
  const next = [{ key, count: (prev?.count ?? 0) + 1, lastAt: at }, ...list.filter((r) => r.key !== key)];
  return sortByRecent(next).slice(0, max);
}

/** En son açılan önce. */
export function sortByRecent(list: readonly ReportOpenRecord[]): ReportOpenRecord[] {
  return [...list].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** En çok açılan önce; eşitlikte en son açılan (belirlenimli sıra). */
export function sortByCount(list: readonly ReportOpenRecord[]): ReportOpenRecord[] {
  return [...list].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** Geçersiz blob satırını (eski sürüm, elle bozulmuş) okurken atar — fail-closed. */
function validRecords(raw: unknown): ReportOpenRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ReportOpenRecord =>
      typeof r === "object" && r !== null && typeof r.key === "string" && typeof r.count === "number" && typeof r.lastAt === "string",
  );
}

export function useOpenedReports() {
  const { prefs, setPreference } = usePreferences();
  const opened = useMemo(() => validRecords(prefs.raporlar?.opened), [prefs.raporlar?.opened]);
  const markOpened = useCallback(
    (key: string) =>
      setPreference((cur) => ({
        raporlar: { ...cur.raporlar, opened: recordOpen(validRecords(cur.raporlar?.opened), key, new Date().toISOString()) },
      })),
    [setPreference],
  );
  return { opened, markOpened };
}

/** Rapor yaprağı açıldığında bir kez kayda işler (aynı sekmede parametre değişimi yeni açılış sayılmaz). */
export function useTrackReportOpen(key: string): void {
  const { markOpened } = useOpenedReports();
  useEffect(() => {
    markOpened(key);
  }, [key, markOpened]);
}
