// Kusurlu sarım ret diyaloğunun parçaları: sarım seçimi, sebep radyoları, fotoğraf ekleyici, sunucu önizlemesi.
// Önizlemedeki her sayı (metre, dönecek kg, tutan sipariş) ve engel cümlesi sunucudan; burada yalnız biçim.
import { useEffect, useMemo } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { fmtKg, fmtM } from "./order-model";
import { MAX_REJECT_PHOTOS, REJECT_PHOTO_TYPES, type RejectBeamOption } from "./rejection-model";
import type { WarpingBeamRejectionPreview } from "./rejection-types";
import { YarnLabel } from "./YarnLabel";

export function BeamChecklist({ options, selected, onChange }: { options: RejectBeamOption[]; selected: string[]; onChange: (ids: string[]) => void }) {
  if (options.length === 0) return <p className="text-sm text-muted-foreground">Depoda hazır, reddedilebilir sarım yok.</p>;
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Reddedilecek sarımlar">
      {options.map((b) => (
        <li key={b.id}>
          <label className="flex h-full items-center gap-3 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
            <Checkbox checked={selected.includes(b.id)} onCheckedChange={(v) => toggle(b.id, v === true)} aria-label={`${b.beamNo} seç`} />
            <span className="min-w-0">
              <span className="block font-medium">{b.beamNo}</span>
              <span className="block text-xs text-muted-foreground">
                {b.lengthM ? `${fmtM(b.lengthM)} m` : "—"}{b.bodyNo ? ` · gövde ${b.bodyNo}` : ""}{b.deliveryNoteNo ? ` · irs. ${b.deliveryNoteNo}` : ""}
              </span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function ReasonRadios({ options, value, onChange }: { options: Array<{ code: string; label: string }>; value: string; onChange: (code: string) => void }) {
  if (options.length === 0) return <p className="text-sm text-destructive">Sebep listesi boş — Tanımlar › Hazır Sebepler › “Kusurlu Levent Reddi” sekmesinde sebep açın.</p>;
  return (
    <div role="radiogroup" aria-label="Ret sebebi" className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.code} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="radio" name="beam-reject-reason" checked={value === o.code} onChange={() => onChange(o.code)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

const MODES = [[true, "Yeniden sarılsın"], [false, "İptal, iplik deverecide kalsın"]] as const;

export function ModeRadios({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div role="radiogroup" aria-label="Ret kipi" className="flex flex-wrap gap-2">
      {MODES.map(([v, label]) => (
        <label key={String(v)} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="radio" name="beam-reject-mode" checked={value === v} onChange={() => onChange(v)} /> {label}
        </label>
      ))}
    </div>
  );
}

export interface PickedPhoto { key: string; file: File }

function Thumb({ p, onRemove }: { p: PickedPhoto; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(p.file), [p.file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <li className="relative h-24 w-24 overflow-hidden rounded-md border bg-muted">
      <img src={url} alt={p.file.name} className="h-full w-full object-cover" />
      <Button type="button" size="sm" variant="secondary" className="absolute right-1 top-1 h-6 w-6 p-0" aria-label={`${p.file.name} kaldır`} onClick={onRemove}><X className="h-3.5 w-3.5" /></Button>
    </li>
  );
}

export function PhotoPicker({ photos, onAdd, onRemove, required }: { photos: PickedPhoto[]; onAdd: (files: File[]) => void; onRemove: (key: string) => void; required: boolean }) {
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-2" aria-label="Eklenen fotoğraflar">
        {photos.map((p) => <Thumb key={p.key} p={p} onRemove={() => onRemove(p.key)} />)}
        {photos.length < MAX_REJECT_PHOTOS && (
          <li>
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted/50">
              <ImagePlus className="h-5 w-5" /> Fotoğraf ekle
              <input type="file" className="sr-only" accept={REJECT_PHOTO_TYPES.join(",")} multiple aria-label="Fotoğraf ekle"
                onChange={(e) => { onAdd(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </label>
          </li>
        )}
      </ul>
      <p className="text-xs text-muted-foreground">En çok {MAX_REJECT_PHOTOS} fotoğraf, JPEG/PNG, her biri en çok 5 MB.{required ? " Bu kurulumda en az bir fotoğraf zorunlu." : ""}</p>
    </div>
  );
}

export function RejectPreviewView({ p }: { p: WarpingBeamRejectionPreview }) {
  return (
    <div className="space-y-3 text-sm" aria-label="Ret önizlemesi">
      <ul className="divide-y rounded-md border" aria-label="Etkilenen sarımlar">
        {p.beams.map((b) => (
          <li key={b.id} className="px-3 py-1.5">
            <b>{b.beamNo}</b> · {b.lengthM ? `${fmtM(b.lengthM)} m` : "—"}{b.bodyNo ? ` · gövde ${b.bodyNo}` : ""}
            <span className="text-xs text-muted-foreground">{b.deliveryNoteNo ? ` · irs. ${b.deliveryNoteNo}` : ""}{b.receivedAt ? ` · ${fmtFactoryDateTime(b.receivedAt)}` : ""}</span>
            {b.blocker ? <span className="text-destructive"> — {b.blocker}</span> : <span className="text-muted-foreground"> → Reddedildi</span>}
          </li>
        ))}
      </ul>
      {p.returnedYarn.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Deverecinin bakiyesine dönecek iplik</p>
          <ul className="space-y-0.5 rounded-md border p-3 text-xs" aria-label="Dönecek iplik">
            {p.returnedYarn.map((y) => (
              <li key={`${y.dispatchItemId}|${y.holderWarpingOrderId}`}>
                <YarnLabel name={y.name} code={y.code} /> — <b>{fmtKg(y.kg)} kg</b> · {y.dispatchNo}{y.lotNo ? ` (lot ${y.lotNo})` : ""} · tutan {y.holderOrderNo}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>Toplam <b>{p.totals.beamCount} levent · {fmtM(p.totals.lengthM)} m</b>{Number(p.totals.returnedKg) > 0 ? <> · dönecek <b>{fmtKg(p.totals.returnedKg)} kg</b></> : null}</p>
      {p.beams.some((b) => b.invoiceDocNo) && (
        <Callout tone="warning">Kabulü faturalı sarım var ({[...new Set(p.beams.map((b) => b.invoiceDocNo).filter(Boolean))].join(", ")}).</Callout>
      )}
      {p.warnings.length > 0 && <Callout tone="warning"><ul className="list-disc pl-4">{p.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Callout>}
      {p.blockers.length > 0 && (
        <Callout tone="danger" title="Gönderilemez">
          <ul className="list-disc pl-4" aria-label="Engeller">{p.blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul>
        </Callout>
      )}
    </div>
  );
}
