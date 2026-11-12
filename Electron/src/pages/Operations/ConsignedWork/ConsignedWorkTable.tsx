// İçerideki İşler toplam şeridi — liste standardı: şerit üst bantta; tablo sütunları `consignedColumns.tsx`te.
import { formatMeasure } from "@/lib/format";
import { BandStats } from "@/components/layout/ListPage";
import { TERIM } from "@/lib/terim";
import type { ConsignedBucket, ConsignedWorkSummary } from "./service";

export type { ReadinessStatus } from "./consignedColumns";

export function TotalsStrip({ totals }: { totals: ConsignedWorkSummary["totals"] }) {
  const cells: Array<[string, ConsignedBucket, string?]> = [
    ["İçeride (toplam)", totals.total],
    [
      "Bekliyor",
      { count: totals.waiting.count + totals.waitingSemi.count, qty: totals.waiting.qty + totals.waitingSemi.qty },
      "Rotaya girmemiş emanet (Ham Stok + Yarı Mamul)",
    ],
    ["İşlemde", totals.inProcess, `Bir ${TERIM.terbiyeIsEmri.tekilKucuk} adımında (Üretimde)`],
    ["Sevke hazır", totals.ready, "Depoda — Bitmiş Depo"],
  ];
  return (
    <BandStats
      label="İçerideki işler özeti"
      items={cells.map(([label, b, hint]) => ({ key: label, label, value: b.count, unit: "top", hint: formatMeasure(b.qty, "m"), title: hint }))}
    />
  );
}
