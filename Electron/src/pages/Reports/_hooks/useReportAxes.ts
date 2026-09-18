// =============================================================================
// EKSEN SÜZGEÇLERİ — URL durumu (React yarısı; saf yarı `reportAxisFilters.ts`)
// =============================================================================
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { axisNotes, axisParams, parseCsv, toCsv, type AxisKey, type Destination } from "./reportAxisFilters";
import type { ReportSecenekler, ReportSuzgec } from "../_services/types";

export interface ReportAxesState {
  /** Seçili değerler; boş dizi = "Tümü". */
  sel: Record<AxisKey, string[]> & { destination: Destination | "" };
  /** İsteğe eklenecek parametreler — boş eksen HİÇ gitmez. */
  params: Record<string, string>;
  set: (key: AxisKey, ids: string[]) => void;
  setDestination: (d: Destination | "") => void;
  /** Herhangi bir eksen seçili mi (ekranda "süzgeç açık" rozetine bağlanır). */
  any: boolean;
}

const AXES: AxisKey[] = ["customerId", "itemId", "colorId", "subcontractorId", "reasonCode", "cariId"];

/** Eksen durumu URL'de yaşar: paylaşılan bağlantı aynı süzgeci açar. */
export function useReportAxes(): ReportAxesState {
  const [sp, setSp] = useSearchParams();
  const sel = useMemo(() => {
    const out = {} as Record<AxisKey, string[]> & { destination: Destination | "" };
    for (const a of AXES) out[a] = parseCsv(sp.get(a));
    const d = sp.get("destination");
    out.destination = d === "DOMESTIC" || d === "EXPORT" ? d : "";
    return out;
  }, [sp]);

  const yaz = useCallback(
    (key: string, value: string | null) =>
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (value) n.set(key, value);
          else n.delete(key);
          return n;
        },
        { replace: true },
      ),
    [setSp],
  );

  return {
    sel,
    params: axisParams(sel),
    set: useCallback((key: AxisKey, ids: string[]) => yaz(key, toCsv(ids)), [yaz]),
    setDestination: useCallback((d: Destination | "") => yaz("destination", d || null), [yaz]),
    any: AXES.some((a) => sel[a].length > 0) || sel.destination !== "",
  };
}

/**
 * Yanıttan seçici kaynağı + süzgeç şerhleri. Sayfa bunu TEK satırda alır ki
 * "şerhi yazmayı unutan sayfa" diye bir şey olmasın: seçenek listesi ile ekrana
 * ve kâğıda giden cümle aynı yerden doğar.
 */
export function useAxisNotes(
  data: { meta?: { secenekler?: ReportSecenekler }; suzgec?: ReportSuzgec } | undefined,
  sel: ReportAxesState["sel"],
  eksenler: readonly AxisKey[],
  opts: { destination?: boolean; ek?: string[] } = {},
): { secenekler: ReportSecenekler | undefined; notes: string[] } {
  const secenekler = data?.meta?.secenekler;
  const suzgec = data?.suzgec;
  const { destination, ek } = opts;
  const notes = useMemo(
    () => axisNotes({ eksenler, destination, secenekler, sel, dusenSatir: suzgec?.dusenSatir, ek, uygulanan: data ? (suzgec ?? null) : undefined }),
    [eksenler, destination, secenekler, sel, suzgec, ek, data],
  );
  return { secenekler, notes };
}
