// Muayene süzgeçleri — tek satır; her değişiklik sorgu parametresine gider (süzme sunucuda). Seçiciler DOĞRUDAN modal.
import { useState } from "react";
import { ChevronDown, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { DayRangeChip, SelectChip } from "@/components/data-table/filter-row/SelectChip";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { stationService } from "@/pages/Stations/service";
import { qualityGradeService } from "@/pages/QualityGrades/service";
import type { Station } from "@/pages/Stations/types";
import type { QualityGrade } from "@/pages/QualityGrades/types";
import { cn } from "@/lib/utils";
import { EMPTY_INSPECTION_FILTERS, PHASE_LABEL, isInspectionFilterDirty, type InspectionFilterState } from "./inspectionRules";

interface Props { f: InspectionFilterState; onChange: (next: InspectionFilterState) => void }

/** Modal açan seçici tetiği çip görünümünde ("Derece: Tümü") — süzgeç satırının diğer kutularıyla aynı boy. */
const CHIP = "h-8 w-auto max-w-56 gap-1 px-2.5 text-xs font-normal";
/** Seçici tetiği: etiket soluk, değer düz ("Derece: Tümü") — SelectChip ile aynı okunuş. */
const PICKER = cn(CHIP, "min-h-8 py-0 [&>span:first-child]:font-normal [&>span:first-child]:text-muted-foreground");
const FABRIC_ONLY = ["FABRIC"] as const;
const PHASE_OPTIONS = (["RAW", "FINAL"] as const).map((p) => ({ value: p, label: PHASE_LABEL[p] }));

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-md border bg-muted/40 px-2 text-xs">
      {label}
      <button type="button" aria-label={`${label} filtresini kaldır`} className="rounded p-0.5 hover:bg-muted" onClick={onClear}><X className="h-3.5 w-3.5" /></button>
    </span>
  );
}

/** Seyrek kullanılan süzgeçler — satırı uzatmasın diye "Diğer" balonunda; etkin olan sayısı tetikte. */
function MoreFilters({ f, set }: { f: InspectionFilterState; set: <K extends keyof InspectionFilterState>(k: K, v: InspectionFilterState[K]) => void }) {
  const active = [f.minScore, f.maxScore].filter(Boolean).length + [f.widthUnknown, f.includeHistory].filter(Boolean).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn(CHIP, active > 0 && "border-primary/50 bg-primary/5")}>
          <SlidersHorizontal className="h-3.5 w-3.5" />Diğer{active > 0 ? ` (${active})` : ""}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Puan / 100 m²</div>
          <div className="flex items-center gap-1">
            <Input className="h-8 text-xs" inputMode="decimal" placeholder="En az" aria-label="En düşük puan" value={f.minScore} onChange={(e) => set("minScore", e.target.value)} />
            <Input className="h-8 text-xs" inputMode="decimal" placeholder="En çok" aria-label="En yüksek puan" value={f.maxScore} onChange={(e) => set("maxScore", e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <ToolbarToggle checked={f.widthUnknown} onCheckedChange={(v) => set("widthUnknown", v)} label="En yok" title="Eni bilinmeyen (puan/100 m² hesaplanamayan) muayeneler" />
          <ToolbarToggle checked={f.includeHistory} onCheckedChange={(v) => set("includeHistory", v)} label="Düzeltilen/iptal dahil" />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function InspectionFilters({ f, onChange }: Props) {
  const [itemOpen, setItemOpen] = useState(false);
  const set = <K extends keyof InspectionFilterState>(k: K, v: InspectionFilterState[K]) => onChange({ ...f, [k]: v });
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="inspection-filters">
      <ListSearchBox value={f.q} onSearchChange={(v) => set("q", v)} searchHint="Top barkodu" placeholder="Top barkodu…" className="sm:w-44" />
      <DayRangeChip id="inspection-date" label="Tarih" from={f.from} to={f.to} onChange={({ from, to }) => onChange({ ...f, from, to })} />
      <SelectChip id="inspection-phase" label="Aşama" value={f.phase || null} options={PHASE_OPTIONS} onChange={(v) => set("phase", v ?? "")} />
      <span className="inline-flex items-center">
        <Button type="button" variant="outline" size="sm" className={cn(CHIP, f.itemId && "border-primary/50 bg-primary/5")} onClick={() => setItemOpen(true)}>
          <span className="text-muted-foreground">Kumaş:</span><span className="truncate">{f.itemLabel || "Tümü"}</span>
        </Button>
        {f.itemId && (
          <button type="button" aria-label="Kumaş filtresini kaldır" className="ml-0.5 rounded p-0.5 hover:bg-muted" onClick={() => onChange({ ...f, itemId: "", itemLabel: "" })}><X className="h-3.5 w-3.5" /></button>
        )}
      </span>
      <EntityPickerModal<QualityGrade>
        value={f.gradeId || null} onChange={(id) => set("gradeId", id ?? "")} service={qualityGradeService} queryKey="inspection-filter-grade"
        getLabel={(g) => `${g.code} · ${g.name}`} nullable noneLabel="Tüm dereceler" label="Derece:" placeholder="Tümü" title="Önerilen derece" triggerClassName={PICKER} placeholderClassName="text-foreground" hideChevron
      />
      <EntityPickerModal<Station>
        value={f.stationId || null} onChange={(id) => set("stationId", id ?? "")} service={stationService} queryKey="inspection-filter-station"
        getLabel={(s) => s.name} getSubLabel={(s) => s.code} nullable noneLabel="Tüm istasyonlar" label="İstasyon:" placeholder="Tümü" title="İstasyon" triggerClassName={PICKER} placeholderClassName="text-foreground" hideChevron
      />
      <ToolbarToggle checked={f.mismatch} onCheckedChange={(v) => set("mismatch", v)} label="Uyumsuz" title="Önerilen derece ile topun derecesi uyuşmayanlar" />
      <MoreFilters f={f} set={set} />
      {f.inspectedById && <Chip label={`Operatör: ${f.inspectedByLabel || "seçili"}`} onClear={() => onChange({ ...f, inspectedById: "", inspectedByLabel: "" })} />}
      {f.rollId && <Chip label={`Top: ${f.rollLabel || "seçili"}`} onClear={() => onChange({ ...f, rollId: "", rollLabel: "" })} />}
      {f.batchId && <Chip label={`Parti: ${f.batchLabel || "seçili"}`} onClear={() => onChange({ ...f, batchId: "", batchLabel: "" })} />}
      {isInspectionFilterDirty(f) && (
        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onChange(EMPTY_INSPECTION_FILTERS)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Temizle</Button>
      )}
      <ItemPickerModal open={itemOpen} allowedTypes={FABRIC_ONLY} onOpenChange={setItemOpen} onPick={(row) => { onChange({ ...f, itemId: row.id, itemLabel: `${row.code} · ${row.name}` }); setItemOpen(false); }} />
    </div>
  );
}
