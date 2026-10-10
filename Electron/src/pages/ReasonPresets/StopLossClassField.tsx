import { Badge } from "@/components/ui/badge";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STOP_LOSS_CLASS_OPTIONS, parseStopTarget, type StopLossClass } from "./service";

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

/**
 * Hedef müdahale süresi (dk) — yalnız tezgah izleme açıkken ve sınıf "çalışma dışı"
 * DEĞİLKEN çizilir (sunucu `STOP_TARGET_NOT_TRACKED`). Değer duruşa sebep kararında donar.
 */
export function StopTargetField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const invalid = parseStopTarget(value) === undefined;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="rp-target">Hedef süre (dk)</Label>
      <Input
        id="rp-target"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Boş = süre izlenmez"
        aria-invalid={invalid}
        className="w-40"
      />
      {invalid ? (
        <p className="text-xs text-destructive">1 ile 1440 arasında tam dakika girin ya da boş bırakın.</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Tezgah Salonu bu süreyi aşan duruşu öne çıkarır. Değer duruşa sebep verildiği anda donar; burada
          değiştirmek geçmiş duruşları değiştirmez.
        </p>
      )}
    </div>
  );
}

/** Liste satırındaki hedef süre rozeti. */
export function StopTargetBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  return <Badge variant="outline">hedef {value} dk</Badge>;
}
