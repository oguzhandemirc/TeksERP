// Tahar türü (K1) + tahar notu — yalnız çerçeveli mekanizmada (Eksantrik/Armür); Jakar'da çizilmez
// (sunucu Jakar'da türü 400 ile reddeder, saklı değer silinmez). Oluşturma diyaloğu not alanını çizmez.
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { EnumSelect } from "@/components/forms/EnumSelect";
import { DRAWING_IN_HINT, DRAWING_IN_LABEL, DRAWING_IN_TYPES, isDrawingInType, type DrawingInType } from "@/components/weave/weave-drawing-in";
import type { ShedMechanism } from "./weave-class";

/** Radix Select boş değer taşımaz → "belirtilmedi" belirteci. */
const NONE = "NONE";
const TYPE_LABELS = { [NONE]: "Belirtilmedi", ...Object.fromEntries(DRAWING_IN_TYPES.map((t) => [t, DRAWING_IN_LABEL[t]])) } as Record<DrawingInType | typeof NONE, string>;

const TYPE_INFO = "Çözgü tellerinin çerçevelere geçiş sırası. Kumaş görünümü Düz, Sivri ve Atlamalı taharı çizer; Özel ya da boş tür düz tahar varsayar. Desen kartı basımında \"Tahar\" satırı olarak çıkar.";
const NOTE_INFO = "Tellerin hangi çerçeveden ve tarağın hangi dişinden geçtiği (tahar ve tarak taharı). Desen kartı basımında türün yanında çıkar; hesaba girmez. Boş bırakılabilir.";

export const drawingInApplies = (m: ShedMechanism): boolean => m === "CAM" || m === "DOBBY";

export function DrawingInFields({ idPrefix, mechanism, type, onType, note, onNote, disabled, fieldClassName }: {
  idPrefix: string;
  /** Tür seçicisinin ızgara hücresi (desen bilgileri sekmesinin geniş ekran ızgarası). */
  fieldClassName?: string;
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
      <FormField className={fieldClassName} label="Tahar türü" htmlFor={`${idPrefix}-drawingInType`} info={TYPE_INFO} hint={type ? DRAWING_IN_HINT[type] : undefined}>
        <EnumSelect<DrawingInType | typeof NONE> id={`${idPrefix}-drawingInType`} value={type ?? NONE} labels={TYPE_LABELS} disabled={disabled}
          onChange={(v) => onType(isDrawingInType(v) ? v : null)} />
      </FormField>
      {onNote && (
        <FormField className="sm:col-span-2 lg:col-span-2 2xl:col-span-4" htmlFor={`${idPrefix}-drawingInNote`} info={NOTE_INFO}
          label={custom ? <span className="font-semibold">Tahar düzeni (özel taharı buraya yazın)</span> : "Tahar notu"}>
          <Input id={`${idPrefix}-drawingInNote`} value={note ?? ""} maxLength={300} placeholder="ör. 1-2-3-4 düz, kenar 2'li, döner 1-2"
            disabled={disabled} onChange={(e) => onNote(e.target.value)} />
        </FormField>
      )}
    </>
  );
}
