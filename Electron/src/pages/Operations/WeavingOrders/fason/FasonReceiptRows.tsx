// =============================================================================
// FASON DOKUMA — makbuz satır editörü (metre · en · kg · kalite)
// =============================================================================
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";
import { EMPTY_ROW, validateReceiptRow } from "./fason-summary";
import type { FasonReceiptRow } from "./types";

interface Props {
  rows: FasonReceiptRow[];
  onChange: (rows: FasonReceiptRow[]) => void;
}

export function FasonReceiptRows({ rows, onChange }: Props) {
  const set = (i: number, patch: Partial<FasonReceiptRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const problems = rows.map(validateReceiptRow);
  const first = problems.find((p): p is { ok: false; message: string } => !p.ok);
  const num = (i: number, key: keyof FasonReceiptRow, step: string, invalid = false) => (
    <Input type="number" min={0} step={step} value={rows[i]?.[key] ?? ""} onChange={(e) => set(i, { [key]: e.target.value })} aria-invalid={invalid} />
  );
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto] gap-2 text-xs font-medium text-muted-foreground">
        <span>Metre *</span>
        <span>En (cm)</span>
        <span>Kg</span>
        <span>Kalite</span>
        <span>Renk (boş = işin rengi)</span>
        <span />
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto] items-center gap-2">
          {num(i, "initialQty", "0.01", problems[i]?.ok === false)}
          {num(i, "width", "0.1")}
          {num(i, "weightKg", "0.01")}
          <Input value={r.qualityGrade} onChange={(e) => set(i, { qualityGrade: e.target.value })} maxLength={16} placeholder="A" />
          <ReferenceSelect<Color> value={r.colorId} onChange={(v) => set(i, { colorId: v })} service={colorService} queryKey="colors" getLabel={(c) => c.name} placeholder="İşin rengi" />
          <Button variant="ghost" size="icon" aria-label="Satırı sil" disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, k) => k !== i))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...rows, { ...EMPTY_ROW }])}>
        <Plus className="mr-1 size-4" /> Satır
      </Button>
      {first && <p className="text-xs text-destructive">{first.message}</p>}
    </div>
  );
}
