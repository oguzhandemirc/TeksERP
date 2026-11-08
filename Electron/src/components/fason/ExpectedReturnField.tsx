// "Beklenen dönüş" alanı — fason sevk formlarının ortak parçası (masaüstü toplu sevk, dokuma fason sevki).
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { Checkbox } from "@/components/ui/checkbox";
import { isPastExpectedReturn, minExpectedReturnDay, type ExpectedReturnChoice } from "./expectedReturn";

export function ExpectedReturnField({ value, onChange }: { value: ExpectedReturnChoice; onChange: (c: ExpectedReturnChoice) => void }) {
  const none = value.mode === "NONE";
  const day = value.mode === "DATE" ? value.day : "";
  const past = isPastExpectedReturn(value);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium">Beklenen dönüş</span>
        <DatePickerInput
          value={day}
          onChange={(v) => onChange(v ? { mode: "DATE", day: v } : { mode: "DEFAULT" })}
          disabled={none}
          min={minExpectedReturnDay()}
          invalid={past}
          aria-label="Beklenen dönüş günü"
          className="h-8 w-36"
        />
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={none} onCheckedChange={(v) => onChange(v ? { mode: "NONE" } : { mode: "DEFAULT" })} aria-label="Termin yok" />
          Termin yok
        </label>
      </div>
      <p className={past ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>
        {past
          ? "Geçmiş bir gün seçilemez."
          : none
            ? "Bu sevk için dönüş tarihi izlenmez."
            : day
              ? "Fason Kokpiti bu güne göre gecikmeyi gösterir."
              : "Boş bırakılırsa firmanın ya da süreç türünün dönüş süresi uygulanır."}
      </p>
    </div>
  );
}
