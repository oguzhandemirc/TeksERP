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
import type { CanvasRotation, LabelElement } from "@/types/label-canvas";
import { elementTypeLabels, skippedLanguages } from "@/types/label-canvas";
import type { UnifiedCatalogField } from "@/services/labelTemplateService";
import { achievedTextStyleMm, BC_BASE_MM, FONT_MM } from "./canvas-model";

interface Props {
  element: LabelElement | null;
  /** Seçili eleman sayısı — >1 iken panel yerine çoklu-seçim bilgisi gösterilir. */
  multiCount?: number;
  catalog: UnifiedCatalogField[];
  onChange: (patch: Partial<LabelElement>) => void;
  onRemove: () => void;
}

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
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Yükseklik (mm)" min={1} max={30} step={0.5}
              value={el.hMm ?? FONT_MM[el.font ?? "md"].h * (el.bold ? 2 : 1)}
              onChange={(v) => onChange({ hMm: Math.max(1, Math.min(30, v)) } as Partial<LabelElement>)} />
            <NumField label="Genişlik oranı" min={0.25} max={4} step={0.05}
              value={el.wr ?? 1}
              onChange={(v) => onChange({ wr: Math.max(0.25, Math.min(4, v)), ...(el.hMm == null ? { hMm: FONT_MM[el.font ?? "md"].h * (el.bold ? 2 : 1) } : {}) } as Partial<LabelElement>)} />
          </div>
          {el.hMm != null && (() => {
            const a = achievedTextStyleMm(el.hMm, el.wr ?? 1);
            return (
              <p className="rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
                Fiilen basılacak: <strong>≈{a.hMm.toFixed(1)}mm</strong> × oran{" "}
                <strong>{a.scaleX.toFixed(2)}</strong> — DÖRT DİLDE AYNI (ortak payda).
              </p>
            );
          })()}
          <div className="grid grid-cols-2 items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Dönüş</Label>
              <Select value={String(el.rot ?? 0)} onValueChange={(v) => onChange({ rot: Number(v) as CanvasRotation } as Partial<LabelElement>)}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROTS.map((r) => <SelectItem key={r} value={String(r)} className="text-xs">{r}°</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Kalın: serbest boyutta gerçek kalın (native çift-vuruş + HTML font-weight,
                dört dilde), eski kademeli modda 2× çarpan. Boyutu değiştirmez. */}
            <label className="flex h-7 items-center gap-1.5 text-xs">
              <Checkbox checked={el.bold ?? false} onCheckedChange={(v) => onChange({ bold: v === true } as Partial<LabelElement>)} />
              Kalın
            </label>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            ORTAK PAYDA: dört dil (PPLA/PPLB/ZPL/HTML) AYNI boyut kombinasyonunu ve
            AYNI metni (Türkçe→ASCII) basar — eleman dilden dile farklı görünmez.
            Genişlik oranı dar/geniş; "kalın" görünümü de oran verir. Köşe tutamacı:
            dikey=yükseklik, yatay=oran.
          </p>
        </>
      )}

      {el.type === "qr" && (
        <NumField label="QR ölçeği (2-15 · modül/dot)" value={el.scale ?? 5} min={2} max={15} step={1}
          onChange={(v) => onChange({ scale: Math.round(v) } as Partial<LabelElement>)} />
      )}

      {el.type === "code128" && (
        <div className="grid grid-cols-2 items-end gap-2">
          <NumField label="Bar yüksekliği (mm)" value={el.hMm ?? 9} min={3} max={40}
            onChange={(v) => onChange({ hMm: v } as Partial<LabelElement>)} />
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Kalınlık (modül)</Label>
            <Select value={String(el.mw ?? 2)}
              onValueChange={(v) => onChange({ mw: Number(v) } as Partial<LabelElement>)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((m) => (
                  <SelectItem key={m} value={String(m)} className="text-xs">
                    {m} dot — ≈{BC_BASE_MM * m} mm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="col-span-2 flex h-7 items-center gap-1.5 text-xs">
            <Checkbox checked={el.human !== false} onCheckedChange={(v) => onChange({ human: v === true } as Partial<LabelElement>)} />
            Gömülü okunur satır (barkoda bağlı)
          </label>
          <p className="col-span-2 text-[10px] leading-snug text-muted-foreground">
            Barkod eklerken kod, altında AYRI ve bağımsız bir öğe olarak da gelir
            (tuvalde tek başına seçilip taşınır). Bu kutu ise koda barkoda GÖMÜLÜ,
            barkodla birlikte hareket eden bir satır ekler — ikisi birden açık olursa
            kod iki kez görünür.
          </p>
          {el.human !== false && (
            <div className="col-span-2 grid grid-cols-2 gap-2 rounded bg-muted/30 p-2">
              <NumField label="Kod yüksekliği (mm)" value={el.humanHMm} min={1} max={20} step={0.5}
                onChange={(v) => onChange({ humanHMm: Math.max(1, Math.min(20, v)) } as Partial<LabelElement>)} />
              <p className="flex items-end text-[10px] leading-snug text-muted-foreground">
                Boş = küçük varsayılan. Kod barkoda göre ortalanır.
              </p>
              <NumField label="Kodu kaydır X (mm)" value={el.humanDx ?? 0} min={-100} max={100} step={0.5}
                onChange={(v) => onChange({ humanDx: v } as Partial<LabelElement>)} />
              <NumField label="Kodu kaydır Y (mm)" value={el.humanDy ?? 0} min={-100} max={100} step={0.5}
                onChange={(v) => onChange({ humanDy: v } as Partial<LabelElement>)} />
            </div>
          )}
          <p className="col-span-2 text-[10px] leading-snug text-muted-foreground">
            Ara değer (örn. 2.5) BASILAMAZ: termal kafa sabit nokta ızgarasıdır — çubuk
            genişliği çubuk başına TAM SAYI dot'tur (203dpi'da 1 dot=0.125mm). Kademeler
            barkodu orantılı genişletir; mm değerleri örnek barkod uzunluğuna göre yaklaşıktır.
          </p>
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
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Bant genişliği (mm)" value={el.wMm ?? 9} onChange={(v) => onChange({ wMm: v } as Partial<LabelElement>)} />
            <NumField label="Bant boyu (mm)" value={el.hMm ?? 40} onChange={(v) => onChange({ hMm: v } as Partial<LabelElement>)} />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Değer dönüşü</Label>
            <Select value={String(el.rot ?? 90)} onValueChange={(v) => onChange({ rot: Number(v) as CanvasRotation } as Partial<LabelElement>)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROTS.map((r) => (
                  <SelectItem key={r} value={String(r)} className="text-xs">
                    {r}°{r === 90 ? " (dikey ↑)" : r === 0 ? " (yatay →)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Dikey bant için dar+uzun (örn. 9×40), yatay bant için geniş+kısa (örn. 40×9)
              boyut + uygun dönüşü seçin.
            </p>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            PPLB (saha yazıcınız) / ZPL / HTML: <strong>siyah zemin + beyaz değer</strong>.
            PPLA (Datamax): ters-renk DPL'de güvenilmez → çerçeveli (kutu + siyah dikey
            değer, her zaman okunur). Fark önizlemede dil seçerek görülür.
          </p>
        </>
      )}
    </div>
  );
}
