// Muayene süzgeçleri — her değişiklik sorgu parametresine gider (süzme sunucuda). Seçiciler DOĞRUDAN modal.
import { useState } from "react";
import { Package, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { stationService } from "@/pages/Stations/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import type { Station } from "@/pages/Stations/types";
import type { QualityGrade } from "@/pages/QualityGrades/types";
import { cn } from "@/lib/utils";
import { EMPTY_INSPECTION_FILTERS, PHASE_LABEL, isInspectionFilterDirty, type InspectionFilterState } from "./inspectionRules";

interface Props { f: InspectionFilterState; onChange: (next: InspectionFilterState) => void }

const TRIGGER = "h-9 w-full sm:w-48";
const FABRIC_ONLY = ["FABRIC"] as const;

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} className="h-9" onClick={onClick}>{children}</Button>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-9 items-center gap-1 rounded-md border bg-muted/40 px-2 text-xs">
      {label}
      <button type="button" aria-label={`${label} süzgecini kaldır`} className="rounded p-0.5 hover:bg-muted" onClick={onClear}><X className="h-3.5 w-3.5" /></button>
    </span>
  );
}

export function InspectionFilters({ f, onChange }: Props) {
  const [itemOpen, setItemOpen] = useState(false);
  const set = <K extends keyof InspectionFilterState>(k: K, v: InspectionFilterState[K]) => onChange({ ...f, [k]: v });
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="inspection-filters">
      <div className="relative w-full sm:w-60">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Top barkodu…" aria-label="Top barkodu" value={f.q} onChange={(e) => set("q", e.target.value)} />
      </div>
      <DateRangeInput from={f.from} to={f.to} onFrom={(v) => set("from", v)} onTo={(v) => set("to", v)} inputClassName="h-9 w-[9.5rem]" />
      <Button type="button" variant="outline" className={cn(TRIGGER, "justify-start")} onClick={() => setItemOpen(true)}>
        <Package className="mr-2 h-4 w-4 shrink-0" /><span className="truncate">{f.itemLabel || "Tüm kumaşlar"}</span>
      </Button>
      {f.itemId && <Chip label="Kumaş" onClear={() => onChange({ ...f, itemId: "", itemLabel: "" })} />}
      <EntityPickerModal<QualityGrade>
        value={f.gradeId || null} onChange={(id) => set("gradeId", id ?? "")} service={qualityGradeService} queryKey="inspection-filter-grade"
        getLabel={(g) => `${g.code} · ${g.name}`} nullable noneLabel="Tüm dereceler" placeholder="Tüm dereceler" title="Önerilen derece" triggerClassName={TRIGGER}
      />
      <EntityPickerModal<Station>
        value={f.stationId || null} onChange={(id) => set("stationId", id ?? "")} service={stationService} queryKey="inspection-filter-station"
        getLabel={(s) => s.name} getSubLabel={(s) => s.code} nullable noneLabel="Tüm istasyonlar" placeholder="Tüm istasyonlar" title="İstasyon" triggerClassName={TRIGGER}
      />
      <div className="flex gap-1" role="group" aria-label="Aşama">
        <Toggle on={f.phase === ""} onClick={() => set("phase", "")}>Tüm aşamalar</Toggle>
        {(["RAW", "FINAL"] as const).map((p) => <Toggle key={p} on={f.phase === p} onClick={() => set("phase", p)}>{PHASE_LABEL[p]}</Toggle>)}
      </div>
      <div className="flex items-center gap-1">
        <Input className="h-9 w-24" inputMode="decimal" placeholder="Puan ≥" aria-label="En düşük puan" value={f.minScore} onChange={(e) => set("minScore", e.target.value)} />
        <Input className="h-9 w-24" inputMode="decimal" placeholder="Puan ≤" aria-label="En yüksek puan" value={f.maxScore} onChange={(e) => set("maxScore", e.target.value)} />
      </div>
      <Toggle on={f.widthUnknown} onClick={() => set("widthUnknown", !f.widthUnknown)}>En yok</Toggle>
      <Toggle on={f.mismatch} onClick={() => set("mismatch", !f.mismatch)}>Uyumsuz</Toggle>
      <Toggle on={f.includeHistory} onClick={() => set("includeHistory", !f.includeHistory)}>Düzeltilen/iptal dahil</Toggle>
      {f.inspectedById && <Chip label={`Operatör: ${f.inspectedByLabel || "seçili"}`} onClear={() => onChange({ ...f, inspectedById: "", inspectedByLabel: "" })} />}
      {f.rollId && <Chip label={`Top: ${f.rollLabel || "seçili"}`} onClear={() => onChange({ ...f, rollId: "", rollLabel: "" })} />}
      {f.batchId && <Chip label={`Parti: ${f.batchLabel || "seçili"}`} onClear={() => onChange({ ...f, batchId: "", batchLabel: "" })} />}
      {isInspectionFilterDirty(f) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_INSPECTION_FILTERS)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Süzgeçleri temizle</Button>
      )}
      <ItemPickerModal open={itemOpen} allowedTypes={FABRIC_ONLY} onOpenChange={setItemOpen} onPick={(row) => { onChange({ ...f, itemId: row.id, itemLabel: `${row.code} · ${row.name}` }); setItemOpen(false); }} />
    </div>
  );
}
