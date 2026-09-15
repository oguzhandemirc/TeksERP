import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { REPORT_BY_KEY, type ReportKey } from "@/lib/report-catalog";
import { forwardWindowParams, shiftYmd } from "../_lib/report-date";

/**
 * `ileri-pencere` — bugünden İLERİ bakan pencere (vade takvimi). URL anahtarları
 * bilerek AYRI (`dueFrom`/`dueTo`): geriye bakan raporların `dateFrom/dateTo`su
 * buraya sızmasın. URL boşken HİÇ parametre gitmez; varsayılan pencereyi backend
 * uygular ve `window` ile geri söyler — ön ayarların çıpası da backend'in "bugün"üdür
 * (istemcide `new Date()` ile gün kesmek sunucunun kestiği günden kayabilir).
 */
export function useForwardWindow(reportKey: ReportKey) {
  const entry = REPORT_BY_KEY.get(reportKey);
  if (!entry) throw new Error(`Rapor kataloğunda yok: ${reportKey}`);
  if (entry.tarih !== "ileri-pencere") {
    throw new Error(`${reportKey}: tarih sözleşmesi '${entry.tarih}', ileri-pencere hook'u kullanılamaz`);
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get("dueFrom") ?? "";
  const to = searchParams.get("dueTo") ?? "";
  const hasWindow = Boolean(from && to);

  const setWindow = (nextFrom: string, nextTo: string) => {
    const sp = new URLSearchParams(searchParams);
    if (nextFrom) sp.set("dueFrom", nextFrom);
    else sp.delete("dueFrom");
    if (nextTo) sp.set("dueTo", nextTo);
    else sp.delete("dueTo");
    setSearchParams(sp, { replace: true });
  };

  /** Ön ayar: `anchorToday` (backend'in günü) → +days. Çıpa yoksa hiçbir şey yapmaz. */
  const applyPreset = (anchorToday: string | null | undefined, days: number) => {
    if (!anchorToday) return;
    setWindow(anchorToday, shiftYmd(anchorToday, days));
  };

  const params = useMemo(() => forwardWindowParams(from, to), [from, to]);

  return { from, to, hasWindow, setWindow, applyPreset, params };
}
