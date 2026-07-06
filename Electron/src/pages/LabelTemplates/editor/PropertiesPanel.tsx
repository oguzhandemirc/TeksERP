// =============================================================================
// Etiket Stüdyosu — seçili eleman özellik paneli
// =============================================================================

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { CanvasFontSize, CanvasRotation, LabelElement } from "@/types/label-canvas";
import { elementTypeLabels, skippedLanguages } from "@/types/label-canvas";
import type { UnifiedCatalogField } from "@/services/labelTemplateService";

interface Props {
  element: LabelElement | null;
  /** Seçili eleman sayısı — >1 iken panel yerine çoklu-seçim bilgisi gösterilir. */
  multiCount?: number;
  catalog: UnifiedCatalogField[];
  onChange: (patch: Partial<LabelElement>) => void;
  onRemove: () => void;
}

const FONTS: CanvasFontSize[] = ["sm", "md", "lg", "xl"];
const ROTS: CanvasRotation[] = [0, 90, 180, 270];

function NumField({ label, value, onChange, min = 0, max = 500, step = 0.5 }: {
  label: string; value: number | undefined; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        className="h-7 text-xs"
        value={value ?? ""}
        min={min} max={max} step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

export function PropertiesPanel({ element: el, multiCount = 0, catalog, onChange, onRemove }: Props) {
  if (!el) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
        {multiCount > 1 ? (
          <>
            <strong>{multiCount} eleman seçili.</strong> Tuval üstündeki araç çubuğuyla
            hizala / boşlukları eşitle; birlikte sürükle veya ok tuşlarıyla it;
            Delete hepsini siler. Tekil özellik için tek eleman seç.
          </>
        ) : (
          <>Eleman seçin — özellikleri burada düzenlenir. Ctrl+tık ile çoklu seçim.</>
        )}
      </div>
    );
  }
  const skipped = skippedLanguages(el.type);
  const isText = el.type === "field" || el.type === "text";

  return (
    <div className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">{elementTypeLabels[el.type]}</span>
        <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive"
          onClick={onRemove} title="Elemanı sil (Delete)">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {skipped.length > 0 && (
        <p className="rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {skipped.join(", ")} dilinde basılmaz — o yazıcılarda bu eleman atlanır.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <NumField label="X (mm)" value={el.x} onChange={(v) => onChange({ x: v } as Partial<LabelElement>)} />
        <NumField label="Y (mm)" value={el.y} onChange={(v) => onChange({ y: v } as Partial<LabelElement>)} />
      </div>

      {el.type === "field" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Veri alanı</Label>
          <Select value={el.bind} onValueChange={(v) => onChange({ bind: v } as Partial<LabelElement>)}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {catalog.map((f) => (
                <SelectItem key={f.key} value={f.key} className="text-xs">
                  {f.defaultLabel} <span className="font-mono text-[9px] text-muted-foreground">({f.key})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="text-[10px] text-muted-foreground">Başlık (boş = yalnız değer)</Label>
          <Input className="h-7 text-xs" value={el.label ?? ""} placeholder="örn. Müşteri"
            onChange={(e) => onChange({ label: e.target.value } as Partial<LabelElement>)} />
        </div>
      )}

      {el.type === "text" && (
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Metin</Label>
          <Input className="h-7 text-xs" value={el.text}
            onChange={(e) => onChange({ text: e.target.value } as Partial<LabelElement>)} />
        </div>
      )}

      {isText && (
        <div className="grid grid-cols-3 items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Font</Label>
            <Select value={el.font ?? "md"} onValueChange={(v) => onChange({ font: v as CanvasFontSize } as Partial<LabelElement>)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Dönüş</Label>
            <Select value={String(el.rot ?? 0)} onValueChange={(v) => onChange({ rot: Number(v) as CanvasRotation } as Partial<LabelElement>)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROTS.map((r) => <SelectItem key={r} value={String(r)} className="text-xs">{r}°</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex h-7 items-center gap-1.5 text-xs">
            <Checkbox checked={el.bold ?? false} onCheckedChange={(v) => onChange({ bold: v === true } as Partial<LabelElement>)} />
            Kalın
          </label>
        </div>
      )}

      {el.type === "qr" && (
        <NumField label="QR ölçeği (2-15 · modül/dot)" value={el.scale ?? 5} min={2} max={15} step={1}
          onChange={(v) => onChange({ scale: Math.round(v) } as Partial<LabelElement>)} />
      )}

      {el.type === "code128" && (
        <div className="grid grid-cols-2 items-end gap-2">
          <NumField label="Bar yüksekliği (mm)" value={el.hMm ?? 9} min={3} max={40}
            onChange={(v) => onChange({ hMm: v } as Partial<LabelElement>)} />
          <label className="flex h-7 items-center gap-1.5 text-xs">
            <Checkbox checked={el.human !== false} onCheckedChange={(v) => onChange({ human: v === true } as Partial<LabelElement>)} />
            Okunur satır
          </label>
        </div>
      )}

      {(el.type === "line" || el.type === "box") && (
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Genişlik (mm)" value={el.wMm} onChange={(v) => onChange({ wMm: v } as Partial<LabelElement>)} />
          <NumField label="Yükseklik (mm)" value={el.hMm} onChange={(v) => onChange({ hMm: v } as Partial<LabelElement>)} />
          {el.type === "box" && (
            <NumField label="Kalınlık (mm)" value={el.thickMm ?? 0.5} min={0.2} max={20}
              onChange={(v) => onChange({ thickMm: v } as Partial<LabelElement>)} />
          )}
        </div>
      )}

      {el.type === "lengthBanner" && (
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Bant genişliği (mm)" value={el.wMm ?? 9} onChange={(v) => onChange({ wMm: v } as Partial<LabelElement>)} />
          <NumField label="Bant boyu (mm)" value={el.hMm ?? 40} onChange={(v) => onChange({ hMm: v } as Partial<LabelElement>)} />
        </div>
      )}
    </div>
  );
}
