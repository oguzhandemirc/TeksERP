// =============================================================================
// Etiket Stüdyosu — bakım sembolü (icon) özellik bloğu
// =============================================================================
// PropertiesPanel'den ayrık dosya (300 satır sınırı). Sembol listesi backend
// ikon kataloğundan (Türkçe etiketler, kategori başlıklı).

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { CanvasRotation, IconElement, LabelElement } from "@/types/label-canvas";
import { ICON_DEFAULT_MM, ICON_MAX_MM, ICON_MIN_MM } from "./canvas-model";
import { useIconCatalog } from "./useIconCatalog";

interface Props {
  element: IconElement;
  onChange: (patch: Partial<LabelElement>) => void;
}

const ROTS: CanvasRotation[] = [0, 90, 180, 270];

export function IconPropsSection({ element: el, onChange }: Props) {
  const { categories, icons, byKey } = useIconCatalog();
  const current = byKey.get(el.icon);

  return (
    <>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Sembol</Label>
        <Select value={el.icon} onValueChange={(v) => onChange({ icon: v } as Partial<LabelElement>)}>
          <SelectTrigger className="h-7 text-xs">
            {/* Katalog gelmeden/anahtar bilinmiyorken ham anahtar gösterilir. */}
            <SelectValue placeholder={el.icon}>{current?.label ?? el.icon}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => {
              const group = icons.filter((i) => i.category === cat.key);
              if (group.length === 0) return null;
              return (
                <div key={cat.key}>
                  {/* ui/select'te SelectGroup yok — kategori başlığı düz satır. */}
                  <div className="px-2 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase text-muted-foreground">
                    {cat.label}
                  </div>
                  {group.map((ic) => (
                    <SelectItem key={ic.key} value={ic.key} className="text-xs">
                      {ic.label}
                    </SelectItem>
                  ))}
                </div>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Boyut (mm)</Label>
          <Input
            type="number"
            className="h-7 text-xs"
            min={ICON_MIN_MM}
            max={ICON_MAX_MM}
            step={0.5}
            value={el.hMm ?? ICON_DEFAULT_MM}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                onChange({ hMm: Math.max(ICON_MIN_MM, Math.min(ICON_MAX_MM, n)) } as Partial<LabelElement>);
              }
            }}
          />
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
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        Kare sembol: genişlik = yükseklik ({ICON_MIN_MM}-{ICON_MAX_MM} mm). ZPL + HTML
        basar; PPLA/PPLB dilinde atlanır — raster baskılı cihaz her zaman basar.
      </p>
    </>
  );
}
