import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STOP_LOSS_CLASS_OPTIONS, type StopLossClass } from "./service";

/**
 * Tezgah duruşu sebebinin KAYIP SINIFI seçicisi — yalnız `MACHINE_STOP` sekmesinde
 * çizilir. Sınıf duruş açılırken sebepten kopyalanıp donar; burada değiştirmek
 * geçmiş duruşları değiştirmez. `MINOR` listede yok: süre sınıfıdır, sebep değil.
 */
export function StopLossClassField({
  value,
  onChange,
}: {
  value: StopLossClass | "";
  onChange: (v: StopLossClass) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="rp-class">Kayıp sınıfı</Label>
      <Select value={value} onValueChange={(v) => onChange(v as StopLossClass)}>
        <SelectTrigger id="rp-class">
          <SelectValue placeholder="Seçin — zorunlu" />
        </SelectTrigger>
        <SelectContent>
          {STOP_LOSS_CLASS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label} — <span className="text-muted-foreground">{o.hint}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Callout tone="info">
        Randıman raporu duruşu bu sınıfa göre gruplar. Sınıf <b>duruş açılırken</b> sebepten kopyalanıp
        donar: burada değiştirmek geçmiş duruşları değiştirmez, yalnız yenilerini etkiler. Kısa kopuşlar
        (mikro) sebebe bağlanmaz — süre sınıfıdır.
      </Callout>
    </div>
  );
}

/** Liste satırındaki sınıf rozeti (yalnız dolu olan satırda çizilir). */
export function StopLossClassBadge({ value }: { value: StopLossClass | "MINOR" | null | undefined }) {
  if (!value) return null;
  return (
    <Badge variant="secondary">{STOP_LOSS_CLASS_OPTIONS.find((o) => o.value === value)?.label ?? value}</Badge>
  );
}
