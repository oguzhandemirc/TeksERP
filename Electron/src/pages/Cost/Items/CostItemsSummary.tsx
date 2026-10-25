// Özet şeridi — sayılar sunucunun `ozet`i (durum süzgecinden ÖNCEKİ küme); tıklamak süzgeci sunucuya taşır.
import { Button } from "@/components/ui/button";
import type { StructureStatus } from "../shared/cost-types";
import type { CostItemFilter, CostItemSummary } from "./service";

interface Props { summary: CostItemSummary; filter: CostItemFilter; onChange: (f: CostItemFilter) => void }

export function CostItemsSummary({ summary, filter, onChange }: Props) {
  const chip = (label: string, n: number, active: boolean, next: CostItemFilter) => (
    <Button key={label} size="sm" variant={active ? "default" : "outline"} onClick={() => onChange(next)}>
      {label} <span className="ml-1 tabular-nums opacity-80">{n}</span>
    </Button>
  );
  const byStatus = (d: StructureStatus | "") => ({ ...filter, durum: d, girdiDegisti: false });
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Durum">
      {chip("Hepsi", summary.toplam, filter.durum === "" && !filter.girdiDegisti, byStatus(""))}
      {chip("Yapı eksik", summary.YAPI_EKSIK, filter.durum === "YAPI_EKSIK", byStatus("YAPI_EKSIK"))}
      {chip("Varsayılanla", summary.VARSAYILAN, filter.durum === "VARSAYILAN", byStatus("VARSAYILAN"))}
      {chip("Tam yapı", summary.TAM, filter.durum === "TAM", byStatus("TAM"))}
      {chip("Girdi değişti", summary.girdiDegisti, filter.girdiDegisti, { ...filter, durum: "", girdiDegisti: true })}
    </div>
  );
}
