import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NumberSeriesRow, SeriesCounterInput } from "./types";

/**
 * SAYAÇ AYARLARI — başlangıç · artış adımı · üst sınır.
 *
 * ⚠️ BİÇİMDEN AYRI BİR BÖLÜM ve ayrı bir kilide tabi: biçimi yapısal olarak
 * kilitli bir serinin (iş emri no) sayacı ayarlanabilir. İkisini tek kilide
 * bağlamak, çözülebilir bir ayarı çözülemez bir gerekçeyle kapatırdı.
 *
 * ⚠️ BOŞ KUTU = AYARLANMAMIŞ, "0" değil: sunucuda `null` bugünkü davranıştır
 * (başlangıç 1, adım 1, sınır yok). Bu yüzden kutular boşken gönderilen değer
 * de `null`dur — "1 yazmak" ile "boş bırakmak" aynı sonucu verir ama niyet
 * farklıdır ve ekran ikisini ayırt eder.
 */
export function NumberingCounterFields({
  row,
  counter,
  onChange,
}: {
  row: NumberSeriesRow;
  counter: SeriesCounterInput;
  onChange: (a: SeriesCounterInput) => void;
}) {
  const locked = !row.counter.startValue;
  const readInt = (v: string): number | null => {
    const n = Number(v.trim());
    return v.trim() === "" || !Number.isFinite(n) ? null : Math.trunc(n);
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="text-sm font-medium">Sayaç</div>

      {locked ? (
        <p className="text-sm text-muted-foreground">{row.counter.lockedReason}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ns-start" className="text-xs">Başlangıç</Label>
              <Input
                id="ns-start"
                inputMode="numeric"
                placeholder="1"
                value={counter.startValue ?? ""}
                onChange={(e) => onChange({ ...counter, startValue: readInt(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-step" className="text-xs">Artış adımı</Label>
              <Input
                id="ns-step"
                inputMode="numeric"
                placeholder="1"
                value={counter.step ?? ""}
                onChange={(e) => onChange({ ...counter, step: readInt(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-max" className="text-xs">Üst sınır</Label>
              <Input
                id="ns-max"
                inputMode="numeric"
                placeholder="yok"
                value={counter.maxValue ?? ""}
                onChange={(e) => onChange({ ...counter, maxValue: readInt(e.target.value) })}
              />
            </div>
          </div>

          {/* ⚠️ Q3 BEYANI — kullanıcı "4 hane" görüp 9999'da duracağını sanmasın. */}
          <p className="text-xs text-muted-foreground">
            Hane sayısı yalnız GÖRÜNÜMDÜR (dolgu); sayacı durduran tek şey üst sınırdır.
            Sınır yoksa numara 9999'u aştığında hane genişler, başa sarmaz.
          </p>

          {/* SIFIRLAMA: yok değil, GEREKÇESİYLE kapalı. */}
          <p className="text-xs text-muted-foreground">{row.counter.resetReason}</p>
        </>
      )}
    </div>
  );
}
