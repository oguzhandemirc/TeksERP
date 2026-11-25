// Tahar türü (K1) + tahar notu — yalnız çerçeveli mekanizmada (Eksantrik/Armür); Jakar'da çizilmez
// (sunucu Jakar'da türü 400 ile reddeder, saklı değer silinmez). Oluşturma diyaloğu not alanını çizmez.
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoPopover } from "@/components/ui/info-popover";
import { DRAWING_IN_HINT, DRAWING_IN_LABEL, DRAWING_IN_TYPES, isDrawingInType, type DrawingInType } from "@/components/weave/weave-drawing-in";
import type { ShedMechanism } from "./weave-class";
import { NATIVE_SELECT_CLASS } from "./WeaveClassFields";

const TYPE_INFO = "Çözgü tellerinin çerçevelere geçiş sırası. Kumaş görünümü Düz, Sivri ve Atlamalı taharı çizer; Özel ya da boş tür düz tahar varsayar. Desen kartı basımında \"Tahar\" satırı olarak çıkar.";
const NOTE_INFO = "Tellerin hangi çerçeveden ve tarağın hangi dişinden geçtiği (tahar ve tarak taharı). Desen kartı basımında türün yanında çıkar; hesaba girmez. Boş bırakılabilir.";

export const drawingInApplies = (m: ShedMechanism): boolean => m === "CAM" || m === "DOBBY";

export function DrawingInFields({ idPrefix, mechanism, type, onType, note, onNote, disabled }: {
  idPrefix: string;
  mechanism: ShedMechanism;
  type: DrawingInType | null;
  onType: (t: DrawingInType | null) => void;
  note?: string;
  onNote?: (v: string) => void;
  disabled?: boolean;
}) {
  if (!drawingInApplies(mechanism)) return null;
  const custom = type === "CUSTOM";
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <Label htmlFor={`${idPrefix}-drawingInType`}>Tahar türü</Label>
          <InfoPopover desc={TYPE_INFO} label="Tahar türü açıklaması" />
        </div>
        <select id={`${idPrefix}-drawingInType`} className={NATIVE_SELECT_CLASS} value={type ?? ""} disabled={disabled}
          onChange={(e) => onType(isDrawingInType(e.target.value) ? e.target.value : null)}>
          <option value="">Belirtilmedi</option>
          {DRAWING_IN_TYPES.map((t) => <option key={t} value={t}>{DRAWING_IN_LABEL[t]}</option>)}
        </select>
        {type && <p className="text-xs text-muted-foreground">{DRAWING_IN_HINT[type]}</p>}
      </div>
      {onNote && (
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor={`${idPrefix}-drawingInNote`} className={custom ? "font-semibold" : undefined}>
              {custom ? "Tahar düzeni (özel taharı buraya yazın)" : "Tahar notu"}
            </Label>
            <InfoPopover desc={NOTE_INFO} label="Tahar notu açıklaması" />
          </div>
          <Input id={`${idPrefix}-drawingInNote`} value={note ?? ""} maxLength={300} placeholder="ör. 1-2-3-4 düz, kenar 2'li, döner 1-2"
            disabled={disabled} onChange={(e) => onNote(e.target.value)} />
        </div>
      )}
    </>
  );
}
