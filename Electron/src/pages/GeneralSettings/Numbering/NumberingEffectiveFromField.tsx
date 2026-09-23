import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { Label } from "@/components/ui/label";

/**
 * İLERİ TARİHLİ GEÇİŞ — "1 Ocak'tan itibaren şu biçim" (D4③).
 *
 * ⚠️ BOŞ = HEMEN, ve bu varsayılan BUGÜNKÜ davranıştır: alan eklenmeden önce her
 * kaydetme anında yürürlüğe giriyordu. Doldurulduğunda bugünkü numaralar
 * ETKİLENMEZ; satır yazılır ve o tarihte kendiliğinden devreye girer.
 *
 * ⚠️ GEÇMİŞ TARİH YAZILAMAZ (sunucu 400 döner) — biçim geçmişi bir DEFTERDİR:
 * o tarihte üretilmiş numaraların hangi biçimde doğduğu düzeltilmez. Alanın
 * `min`i bugündür, ama KAPI SUNUCUDA; buradaki `min` yalnız kolaylıktır.
 */
export function NumberingEffectiveFromField({
  value,
  onChange,
}: {
  /** ISO tarih (yyyy-aa-gg) ya da boş. */
  value: string;
  onChange: (v: string) => void;
}) {
  const bugun = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <Label htmlFor="ns-effective" className="text-sm font-medium">
        Yürürlük tarihi
      </Label>
      {/* ⚠️ YERLEŞİK `type="date"` KULLANILMAZ: bu depoda o kullanım cırcırlı bir
          tabandadır (TABAN 0) ve yeni bir tane eklemek tabanı yükseltirdi. Ortak
          bileşen ayrıca TR biçimini (GG.AA.YYYY) ve klavye girişini getiriyor. */}
      <DatePickerInput
        id="ns-effective"
        min={bugun}
        value={value}
        onChange={onChange}
      />
      <p className="text-xs text-muted-foreground">
        {value
          ? "Biçim bu tarihten itibaren geçerli olacak; bugünkü numaralar etkilenmez."
          : "Boş bırakılırsa değişiklik HEMEN yürürlüğe girer (bugünkü davranış)."}
      </p>
    </div>
  );
}
