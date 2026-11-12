// Rapor ekran görünüm tercihi — `UserPreference.preferences.raporlar.charts[raporAnahtarı]` (kişisel).
// Yalnız GÖRÜNÜŞ: grafik türü, veri etiketi, grafik/tablo yerleşimi, gizli tablo kolonları. Rapor ucuna
// giden parametre DEĞİLDİR (ön ayarlara yazılmaz: ön ayar parametreleri strict uca gider).
import { useCallback, useMemo, useState } from "react";
import { useOptionalPreferences } from "@/providers/PreferencesProvider";
import type { AppPreferences } from "@/types/preferences";
import { CHART_KINDS, type ChartKind } from "../grafik/ekran/gorunum";

export type ReportLayout = "side" | "stacked";

export interface ReportViewPref {
  kind?: ChartKind;
  labels?: boolean;
  layout?: ReportLayout;
  hiddenColumns?: string[];
}

const MAX_HIDDEN = 40;

/** Blob'dan gelen ham değeri süzer: bilinmeyen alan/değer düşer (eski/bozuk tercih ekranı kırmaz). */
export function readViewPref(raw: unknown): ReportViewPref {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: ReportViewPref = {};
  if (typeof r.kind === "string" && (CHART_KINDS as readonly string[]).includes(r.kind)) out.kind = r.kind as ChartKind;
  if (typeof r.labels === "boolean") out.labels = r.labels;
  if (r.layout === "side" || r.layout === "stacked") out.layout = r.layout;
  if (Array.isArray(r.hiddenColumns)) out.hiddenColumns = r.hiddenColumns.filter((c): c is string => typeof c === "string").slice(0, MAX_HIDDEN);
  return out;
}

/** Tek raporun tercihini yamalar; diğer raporların tercihi ve `raporlar`ın öbür alanları (favoriler…) korunur. */
export function patchViewPref(prefs: AppPreferences, reportKey: string, patch: ReportViewPref): Pick<AppPreferences, "raporlar"> {
  const charts = { ...(prefs.raporlar?.charts ?? {}) };
  charts[reportKey] = { ...readViewPref(charts[reportKey]), ...patch };
  return { raporlar: { ...prefs.raporlar, charts } };
}

/**
 * Rapor başına görünüm tercihi. `reportKey` yoksa (gömülü tablo/analiz kartı) ya da tercih sağlayıcısı
 * yoksa seçim yalnız bileşen durumunda yaşar (kaydedilmez).
 */
export function useReportViewPref(reportKey: string | undefined) {
  const ctx = useOptionalPreferences();
  const [local, setLocal] = useState<ReportViewPref>({});
  const persistent = Boolean(reportKey && ctx);
  const raw = persistent ? ctx!.prefs.raporlar?.charts?.[reportKey!] : undefined;
  const stored = useMemo(() => readViewPref(raw), [raw]);
  const setPreference = ctx?.setPreference;
  const update = useCallback(
    (patch: ReportViewPref) => {
      if (reportKey && setPreference) setPreference((current) => patchViewPref(current, reportKey, patch));
      else setLocal((cur) => ({ ...cur, ...patch }));
    },
    [reportKey, setPreference],
  );
  return { pref: persistent ? stored : local, update, persistent };
}
