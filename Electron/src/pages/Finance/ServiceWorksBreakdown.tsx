// "Satır neden bu miktar" — hizmet taslağının iş kırılımı (adım / levent / dokuma / kurşun / özellik). Kapalı
// açılır (taslak satırları hizmet kartı başına toplu kalır); hariç (yeniden işlem) satırlar soluk + rozetli.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { money, type Currency } from "./service";
import { basisLabel, sortServiceWorks, sourceLabel, subjectKindLabel, summarizeServiceWorks, unitLabel, type ServiceDraftWorkRow } from "./serviceWorks";

const qtyText = (r: ServiceDraftWorkRow) =>
  `${Number(r.qty).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} ${unitLabel(r.unit)}`.trim();

export function ServiceWorksBreakdown({ rows, currency }: { rows: readonly ServiceDraftWorkRow[] | undefined; currency: Currency }) {
  const [open, setOpen] = useState(false);
  if (!rows || rows.length === 0) return null;
  const sum = summarizeServiceWorks(rows);
  return (
    <div className="rounded-md border text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1 px-3 py-2 text-left font-medium hover:bg-muted/50"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        İş kırılımı — {sum.billed} iş
        {sum.excluded > 0 && <span className="font-normal text-muted-foreground"> · {sum.excluded} iş faturasız (bizim hatamız)</span>}
      </button>
      {open && (
        <div className="max-h-64 overflow-auto border-t">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr>
                <th className="px-2 py-1">İş</th>
                <th className="px-2 py-1">Süreç</th>
                <th className="px-2 py-1">Top / levent</th>
                <th className="px-2 py-1 text-right">Miktar</th>
                <th className="px-2 py-1 text-right whitespace-nowrap">Birim fiyat</th>
              </tr>
            </thead>
            <tbody>
              {sortServiceWorks(rows).map((r) => (
                <tr key={`${r.source}:${r.subjectId}:${r.serviceItemId}:${r.workOrderStepId ?? ""}`} className={cn("border-t", r.excludedReason && "text-muted-foreground")}>
                  <td className="px-2 py-1 whitespace-nowrap">{sourceLabel(r.source)}</td>
                  <td className="px-2 py-1">
                    {r.processLabel}
                    {r.excludedReason && <Badge variant="muted" className="ml-1 text-[10px]">Faturasız — yeniden işlem</Badge>}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <span className="text-muted-foreground">{subjectKindLabel(r.subjectKind)}</span> <span className="font-mono">{r.subjectCode}</span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap" title={r.unit === "METER" ? basisLabel(r.meterBasis) : undefined}>
                    {qtyText(r)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(r.unitPrice, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
