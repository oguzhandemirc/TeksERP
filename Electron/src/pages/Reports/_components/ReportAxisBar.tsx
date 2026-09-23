// =============================================================================
// SÜZGEÇ ŞERİDİ — tarih + eksen seçicileri TEK YERDEN
// =============================================================================
// Sekiz rapor aynı şeridi çiziyor; her sayfada elle kurmak "aynı süzgeç, farklı
// etiket" demektir. Sayfa yalnız HANGİ eksenleri taşıdığını söyler; etiket, boş
// ipucu ve şerh eksenin sözlüğünden gelir (`reportAxisFilters`).
// =============================================================================
import type { ReportKey } from "@/lib/report-catalog";
import type { ReportSecenekler } from "../_services/types";
import { AXIS_EMPTY_HINTS, AXIS_LABELS, type AxisKey, type DestinationAxis } from "../_hooks/reportAxisFilters";
import type { ReportAxesState } from "../_hooks/useReportAxes";
import { DestinationSelect } from "./DestinationSelect";
import { ReportDateFilter } from "./ReportDateFilter";
import { ReportMultiSelect } from "./ReportMultiSelect";

interface Props {
  reportKey: ReportKey;
  showCompare?: boolean;
  axes: ReportAxesState;
  secenekler: ReportSecenekler | undefined;
  eksenler: readonly AxisKey[];
  /** Yön seçicisi: `true` sipariş raporu ("Cari/şube yönü (bugünkü)") · `"shipment"` sevk raporu (donmuş yön). */
  destination?: DestinationAxis;
}

export function ReportAxisBar({ reportKey, showCompare, axes, secenekler, eksenler, destination }: Props) {
  const id = reportKey.replace("/", "-");
  return (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey={reportKey} showCompare={showCompare} bare />
      {eksenler.map((a) => (
        <ReportMultiSelect
          key={a}
          id={`${id}-${a}`}
          label={AXIS_LABELS[a]}
          options={secenekler?.[a]}
          value={axes.sel[a]}
          onChange={(v) => axes.set(a, v)}
          emptyHint={AXIS_EMPTY_HINTS[a]}
        />
      ))}
      {destination ? <DestinationSelect id={`${id}-destination`} value={axes.sel.destination} onChange={axes.setDestination} variant={destination === "shipment" ? "shipment" : "order"} /> : null}
    </div>
  );
}
