import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { NumberSourceMode } from "./types";

/**
 * NUMARA KAYNAĞI — sistem üretir · elle zorunlu · serbest.
 *
 * ⚠️ ÜÇ SEÇENEK, iki değil: bugünkü davranış "sistem üretir AMA elle geleni de
 * kabul eder"dir ve iki değerli bir ayar bunu İFADE EDEMEZ. Varsayılan
 * "Serbest" = bugünkü davranış; "Yalnız sistem" bir DAVRANIŞ DEĞİŞİKLİĞİDİR
 * (eski istemci elle numara göndermeye devam ederse 400 alır) ve bu yüzden
 * seçeneğin altında açık cümlesi durur.
 *
 * ⚠️ Bu alan YALNIZ elle yolu olan seride çizilir (bugün 4 seri). Yeteneği
 * olmayan seride pasif bile çizilmez: kimsenin değiştiremeyeceği bir kutuyu 48
 * kez göstermek gürültüdür.
 */
const DESCRIPTIONS: Record<NumberSourceMode, string> = {
  FREE: "Numarayı sistem üretir; kullanıcı elle bir numara yazarsa o kullanılır.",
  SYSTEM: "Numarayı yalnız sistem üretir; elle yazılan numara reddedilir.",
  MANUAL: "Numara elle girilir; boş bırakılamaz ve sistem üretmez.",
};

export function NumberingSourceField({
  value,
  onChange,
}: {
  value: NumberSourceMode;
  onChange: (v: NumberSourceMode) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor="ns-source" className="text-sm font-medium">Numara kaynağı</Label>
      <Select value={value} onValueChange={(v) => onChange(v as NumberSourceMode)}>
        <SelectTrigger id="ns-source"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="FREE">Serbest (sistem üretir, elle yazılabilir)</SelectItem>
          <SelectItem value="SYSTEM">Yalnız sistem</SelectItem>
          <SelectItem value="MANUAL">Yalnız elle</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{DESCRIPTIONS[value]}</p>
    </div>
  );
}
