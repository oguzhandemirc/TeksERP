// Sipariş formu "Leventler" kartının hedef alanları: "Levent adedi belli değil" anahtarı · toplam metre ·
// adet × boy satırları. Hangisinin gövdeye gideceğine `order-model.targetBody` karar verir.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { MAX_BEAM_LINES, type WarpingOrderFormState } from "./order-model";

interface Props {
  s: WarpingOrderFormState;
  up: (patch: Partial<WarpingOrderFormState>) => void;
}

/** "Levent adedi belli değil" anahtarı: seçiliyse yalnız toplam metre girilir, adet kabulde çıkar. */
export function BeamCountOpenToggle({ s, up }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Checkbox
          checked={s.beamCountOpen}
          onCheckedChange={(v) => up({ beamCountOpen: v === true })}
          aria-label="Levent adedi belli değil"
        />
        Levent adedi belli değil
      </label>
      <InfoPopover
        label="Levent adedi belli değil"
        desc="Kaç levent geleceğini bilmiyorsanız yalnız toplam metreyi yazın; adedi devereci belirler, kabulde ortaya çıkar. İplik planı ve mutabakat toplam metreden hesaplanır."
      />
    </div>
  );
}

/** Açık adet: tek "Toplam metre" alanı. */
export function OpenTargetInput({ s, up }: Props) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="wo-open-target" className="text-sm text-muted-foreground">
        Toplam metre
      </label>
      <Input
        id="wo-open-target"
        className="w-36"
        inputMode="decimal"
        aria-label="Toplam metre"
        placeholder="ör. 1500"
        value={s.openTargetLengthM}
        onChange={(e) => up({ openTargetLengthM: e.target.value })}
      />
      <span className="text-sm text-muted-foreground">m</span>
    </div>
  );
}

/** Levent adedi × boy satırları (farklı boy için satır eklenir). */
export function BeamLineRows({ s, up }: Props) {
  const setLine = (i: number, patch: Partial<WarpingOrderFormState["beamLines"][number]>) =>
    up({ beamLines: s.beamLines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  return (
    <>
      {s.beamLines.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="w-24"
            inputMode="numeric"
            aria-label={`${i + 1}. satır levent adedi`}
            value={l.beamCount}
            onChange={(e) => setLine(i, { beamCount: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">levent ×</span>
          <Input
            className="w-32"
            inputMode="decimal"
            aria-label={`${i + 1}. satır levent boyu (m)`}
            placeholder="boy"
            value={l.beamLengthM}
            onChange={(e) => setLine(i, { beamLengthM: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">m</span>
          {s.beamLines.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`${i + 1}. levent satırını sil`}
              onClick={() => up({ beamLines: s.beamLines.filter((_, k) => k !== i) })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {s.beamLines.length < MAX_BEAM_LINES && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => up({ beamLines: [...s.beamLines, { beamCount: "1", beamLengthM: "" }] })}
        >
          <Plus className="mr-1 h-4 w-4" /> Farklı boyda levent ekle
        </Button>
      )}
    </>
  );
}
