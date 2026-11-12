// Ürün maliyetleri — tablo sütunları (ortak DataTable). Sunum dövizi ayarlıysa döviz birincil, TL ikincil (ikisi de sunucu sayısı).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { fmtFactoryDate } from "@/lib/factory-time";
import { fmtDec } from "../shared/format";
import { STRUCTURE_STATUS_LABEL } from "../shared/labels";
import { presentationAmount } from "../shared/PresentationNote";
import type { CostItemRow } from "./service";

const STATUS_CLASS: Record<string, string> = {
  TAM: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  VARSAYILAN: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  YAPI_EKSIK: "bg-destructive/15 text-destructive",
};

function costText(r: CostItemRow): string {
  const v = r.aktifSurum;
  if (!v) return "—";
  const tl = `${fmtDec(v.standartTlM)} TL/m`;
  return v.sunumDovizi ? `${presentationAmount(v, v.standartDovizM)} · ${tl}` : tl;
}

export const COST_ITEM_COLUMNS: ColumnDef<CostItemRow>[] = [
  {
    id: "item",
    header: "Ürün",
    meta: { label: "Ürün", exportValue: (r) => `${r.kod} ${r.ad}` },
    accessorFn: (r) => r.kod,
    cell: ({ row: { original: r } }) => <span><span className="font-medium">{r.kod}</span> <span className="text-muted-foreground">{r.ad}</span></span>,
  },
  {
    id: "cost",
    header: "Std. maliyet",
    meta: { label: "Std. maliyet", align: "right", exportValue: costText },
    cell: ({ row: { original: r } }) => {
      const v = r.aktifSurum;
      if (!v?.sunumDovizi) return costText(r);
      return (
        <span>
          {presentationAmount(v, v.standartDovizM)}
          <span className="ml-1.5 text-xs text-muted-foreground">{fmtDec(v.standartTlM)} TL/m</span>
        </span>
      );
    },
  },
  { id: "version", header: "Sürüm", meta: { label: "Sürüm" }, accessorFn: (r) => (r.aktifSurum ? `v${r.aktifSurum.surumNo}` : "—") },
  { id: "computedAt", header: "Tarih", meta: { label: "Tarih", exportValue: (r) => (r.aktifSurum ? fmtFactoryDate(r.aktifSurum.hesaplananAt) : "—") }, accessorFn: (r) => r.aktifSurum?.hesaplananAt ?? null, cell: ({ row: { original: r } }) => (r.aktifSurum ? fmtFactoryDate(r.aktifSurum.hesaplananAt) : "—") },
  {
    id: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => [STRUCTURE_STATUS_LABEL[r.yapiDurumu] ?? r.yapiDurumu, r.girdiDegisti ? "Girdi değişti" : null].filter(Boolean).join(" · ") },
    accessorFn: (r) => r.yapiDurumu,
    cell: ({ row: { original: r } }) => (
      <span className="space-x-1 whitespace-nowrap">
        <Badge variant="muted" className={STATUS_CLASS[r.yapiDurumu]}>{STRUCTURE_STATUS_LABEL[r.yapiDurumu] ?? r.yapiDurumu}</Badge>
        {r.girdiDegisti && <Badge variant="muted" className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Girdi değişti</Badge>}
      </span>
    ),
  },
];
