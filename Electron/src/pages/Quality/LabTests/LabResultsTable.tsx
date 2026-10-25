// Sonuç tablosu — değer (gri ölçek 4,5 → "4-5"), sınır kaynağı rozeti (müşteri/tür), hüküm ve kaynağı.
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LabResult, LabTestType } from "./service";
import { VERDICT_LABEL, resultValueText, specRangeText, specSource, withinSpec } from "./labTestRules";

interface Props { results: LabResult[]; types: LabTestType[]; onDelete?: (testTypeId: string) => void; busy?: boolean }

export function LabResultsTable({ results, types, onDelete, busy }: Props) {
  if (results.length === 0) return <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Henüz sonuç girilmedi.</p>;
  const typeById = new Map(types.map((t) => [t.id, t]));
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="p-2 text-left">Test</th>
            <th className="p-2 text-left">Sonuç</th>
            <th className="p-2 text-left">Spesifikasyon</th>
            <th className="p-2 text-left">Hüküm</th>
            {onDelete && <th className="p-2" />}
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const range = specRangeText(r.specMin, r.specMax, r.resultKind);
            const src = specSource(r, typeById.get(r.testTypeId));
            const inside = withinSpec(r);
            return (
              <tr key={r.id} className="border-t align-top">
                <td className="p-2">
                  <div className="font-medium">{r.testType.name}</div>
                  <div className="text-xs text-muted-foreground">{[r.testType.code, r.testType.method].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="p-2 tabular-nums">{resultValueText(r)}{r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}</td>
                <td className="p-2">
                  {range ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="tabular-nums">{range}</span>
                      <Badge variant={src === "CUSTOMER" ? "secondary" : "muted"}>{src === "CUSTOMER" ? "Müşteri sınırı" : "Tür sınırı"}</Badge>
                      {inside !== null && <Badge variant={inside ? "outline" : "destructive"}>{inside ? "Sınır içinde" : "Sınır dışında"}</Badge>}
                    </div>
                  ) : <span className="text-xs text-muted-foreground">Sınır yok</span>}
                </td>
                <td className="p-2">
                  <Badge variant={r.verdict === "PASS" ? "outline" : "destructive"}>{VERDICT_LABEL[r.verdict]}</Badge>
                  <div className="text-[11px] text-muted-foreground">{r.verdictSource === "AUTO" ? "sınırdan otomatik" : "elle verildi"}</div>
                </td>
                {onDelete && (
                  <td className="p-2 text-right">
                    <Button variant="ghost" size="icon" aria-label={`${r.testType.name} sonucunu sil`} disabled={busy} onClick={() => onDelete(r.testTypeId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
