// Özet şeridi: sunucu özeti listeyle AYNI where'den gelir (süzgeç değişince birlikte değişir).
import { BandStats } from "@/components/layout/ListPage";
import { fmtDiff } from "./deviation-labels";
import type { MeterDeviationSummary } from "./types";

export function SummaryStrip({ summary }: { summary: MeterDeviationSummary | null }) {
  const s = summary;
  return (
    <BandStats
      label="Sapma özeti"
      items={[
        { key: "total", label: "Sapma sayısı", value: s ? s.total : "—" },
        { key: "unsigned", label: "Onaysız (toplam)", value: s ? s.unsigned : "—", title: "Onay imzası olmayan tüm sapmalar: imzasız + imza bekleyen." },
        { key: "pending", label: "İmza bekleyen", value: s ? s.pending : "—", title: "Onaylanmadan adımı kapatmayan sapmalar." },
        { key: "avg", label: "Ortalama fark", value: s ? fmtDiff(s.avgDiffMeters) : "—", title: s?.avgAbsDiffMeters != null ? `Mutlak ortalama ${fmtDiff(s.avgAbsDiffMeters)}` : undefined },
      ]}
    />
  );
}
