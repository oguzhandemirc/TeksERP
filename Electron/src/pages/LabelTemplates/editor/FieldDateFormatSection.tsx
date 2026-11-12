// Etiket Stüdyosu — tarih alanının biçim seçicisi (yalnız printedAt/woundAt; değer sunucuda biçimlenir).
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FieldElement, LabelElement } from "@/types/label-canvas";
import { DATE_FORMAT_OPTIONS, FIELD_DATE_BINDS, dateFormatChoice, fmtForDateChoice, type DateFormatChoice } from "./field-date-format";

export function FieldDateFormatSection({ element: el, onChange }: { element: FieldElement; onChange: (patch: Partial<LabelElement>) => void }) {
  if (!FIELD_DATE_BINDS.includes(el.bind)) return null;
  return (
    <>
      <Label className="text-[10px] text-muted-foreground">Tarih biçimi</Label>
      <Select value={dateFormatChoice(el.fmt)}
        onValueChange={(v) => onChange({ fmt: fmtForDateChoice(v as DateFormatChoice) } as Partial<LabelElement>)}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {DATE_FORMAT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
