// Düzenlenebilir hata tablosu (düzelt + kâğıttan giriş ortak). Tür seçici DOĞRUDAN modal; boyut düğme grubu;
// metre boşsa hata konumsuzdur ve `null` gider (0 değil).
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { defectTypeService } from "@/pages/DefectTypes/service";
import type { DefectType } from "@/pages/DefectTypes/types";
import { SIZE_LABEL, SIZE_ORDER, SIZE_POINTS, defectRowProblem, newDefectRow, type DefectRow } from "./inspectionRules";

interface Props { rows: DefectRow[]; onChange: (rows: DefectRow[]) => void }

export function DefectTableEditor({ rows, onChange }: Props) {
  const patch = (key: string, p: Partial<DefectRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  return (
    <div className="space-y-2" data-testid="defect-editor">
      {rows.length === 0 && <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">Hata yok — temiz top olarak kaydedilir.</p>}
      {rows.map((r, i) => {
        const problem = defectRowProblem(r);
        return (
          <div key={r.key} className="rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <div className="min-w-[12rem] flex-1">
                <EntityPickerModal<DefectType>
                  value={r.defectTypeId || null} onChange={(id) => patch(r.key, { defectTypeId: id ?? "" })} service={defectTypeService}
                  queryKey="inspection-defect-type" getLabel={(t) => t.name} getSubLabel={(t) => t.code} placeholder="Hata türü seç" title="Hata türü" triggerClassName="h-9 w-full"
                />
              </div>
              <Input className="h-9 w-28" inputMode="decimal" placeholder="Metre" aria-label={`${i + 1}. hata metresi`} value={r.startMeter} onChange={(e) => patch(r.key, { startMeter: e.target.value })} />
              <Button type="button" size="icon" variant="ghost" aria-label={`${i + 1}. hatayı kaldır`} onClick={() => onChange(rows.filter((x) => x.key !== r.key))}><Trash2 className="h-4 w-4" /></Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1 pl-8" role="group" aria-label={`${i + 1}. hata boyutu`}>
              {SIZE_ORDER.map((s) => (
                <Button key={s} type="button" size="sm" variant={r.sizeClass === s ? "default" : "outline"} aria-pressed={r.sizeClass === s} className="h-8"
                  onClick={() => patch(r.key, { sizeClass: s })}>{SIZE_LABEL[s]} · {SIZE_POINTS[s]}p</Button>
              ))}
              <Button type="button" size="sm" variant={r.sizeClass === null ? "default" : "outline"} aria-pressed={r.sizeClass === null} className="h-8"
                title="Hata türünün sabit puanı kullanılır" onClick={() => patch(r.key, { sizeClass: null })}>Sabit puan</Button>
            </div>
            {problem && <p className="mt-1 pl-8 text-xs text-destructive">{problem}</p>}
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, newDefectRow()])}><Plus className="mr-1 h-4 w-4" />Hata ekle</Button>
    </div>
  );
}
