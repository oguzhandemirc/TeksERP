import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Seçici değeri: "" = sınıflandırılmamış (ücretli, bugünkü) · "true" = müşteri talebi · "false" = bizim hatamız. */
export type ReworkBillableChoice = "" | "true" | "false";

const NONE = "NONE";
const OPTIONS: { value: ReworkBillableChoice; label: string; hint: string }[] = [
  { value: "", label: "Belirtilmemiş", hint: "ücretli (bugünkü gibi)" },
  { value: "true", label: "Müşteri talebi", hint: "ücretli" },
  { value: "false", label: "Bizim hatamız", hint: "faturaya girmez" },
];

export function toReworkBillableChoice(v: boolean | null | undefined): ReworkBillableChoice {
  return v === true ? "true" : v === false ? "false" : "";
}

export function fromReworkBillableChoice(c: ReworkBillableChoice): boolean | null {
  return c === "true" ? true : c === "false" ? false : null;
}

/**
 * Yeniden işlem sebebinin ÜCRET SINIFI — yalnız yeniden işlem sekmesinde çizilir. Sınıf iş emri açılırken
 * sebepten kopyalanıp donar; burada değiştirmek açılmış iş emirlerini ve faturalarını değiştirmez.
 */
export function ReworkBillableField({
  value,
  onChange,
}: {
  value: ReworkBillableChoice;
  onChange: (v: ReworkBillableChoice) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="rp-billable">Ücret sınıfı</Label>
      <Select value={value === "" ? NONE : value} onValueChange={(v) => onChange(v === NONE ? "" : (v as ReworkBillableChoice))}>
        <SelectTrigger id="rp-billable">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPTIONS.map((o) => (
            <SelectItem key={o.label} value={o.value === "" ? NONE : o.value}>
              {o.label} — <span className="text-muted-foreground">{o.hint}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Callout tone="info">
        &quot;Bizim hatamız&quot; seçilen sebeple açılan iş emrindeki boya, apre, bayrak ve kurşun işi müşteriye
        <b> faturalanmaz</b>. Sınıf iş emri <b>açılırken</b> donar: burada değiştirmek geçmiş iş emirlerini
        değiştirmez, yalnız yenilerini etkiler.
      </Callout>
    </div>
  );
}

/** Liste satırındaki sınıf rozeti (yalnız sınıflandırılmış satırda çizilir). */
export function ReworkBillableBadge({ value }: { value: boolean | null | undefined }) {
  if (value == null) return null;
  return <Badge variant={value ? "secondary" : "outline"}>{value ? "Müşteri talebi" : "Bizim hatamız · ücretsiz"}</Badge>;
}
