import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { counterFieldError, type CounterFieldError } from "./counterRules";
import type { NumberSeriesRow, SeriesCounterInput, SeriesExhaustion } from "./types";

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
/** Tükenme satırı — ölçülemediyse yüzde YAZILMAZ, gerekçe yazılır. */
function Tukenme({ exhaustion }: { exhaustion: SeriesExhaustion | null }) {
  if (!exhaustion) return null;
  if (exhaustion.percent === null) {
    return <p className="text-xs text-muted-foreground">{exhaustion.reason}</p>;
  }
  const yuzde = Math.round(exhaustion.percent * 100);
  return (
    <p className={`text-xs ${exhaustion.warn ? "font-medium text-destructive" : "text-muted-foreground"}`}>
      Yürürlükteki dönemde {exhaustion.used?.toLocaleString("tr-TR")} /{" "}
      {exhaustion.limit?.toLocaleString("tr-TR")} kullanıldı (%{yuzde})
      {exhaustion.warn ? " — sınıra yaklaşıldı." : "."}
    </p>
  );
}

/**
 * Tek sayaç alanı — BOŞ KUTU = "ayarlanmamış" (`null`), "0" değil. Hata mesajı
 * alanın hemen altında durur; kullanıcı sebebi aradığı yerde bulur (K5/K10).
 */
function CounterField({
  id, etiket, yer, deger, hata, onChange,
}: {
  id: string;
  etiket: string;
  yer: string;
  deger: number | null;
  hata: string | null;
  onChange: (v: number | null) => void;
}) {
  const readInt = (v: string): number | null => {
    const n = Number(v.trim());
    return v.trim() === "" || !Number.isFinite(n) ? null : Math.trunc(n);
  };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{etiket}</Label>
      <Input
        id={id}
        inputMode="numeric"
        placeholder={yer}
        value={deger ?? ""}
        aria-invalid={hata !== null}
        onChange={(e) => onChange(readInt(e.target.value))}
      />
      {hata && <p className="text-xs font-medium text-destructive">{hata}</p>}
    </div>
  );
}

export function NumberingCounterFields({
  row,
  counter,
  exhaustion,
  onChange,
  hatalar = [],
}: {
  row: NumberSeriesRow;
  counter: SeriesCounterInput;
  /** `null` = henüz okunmadı; `percent === null` = ÖLÇÜLEMEDİ (yüzde yazılmaz). */
  exhaustion: SeriesExhaustion | null;
  onChange: (a: SeriesCounterInput) => void;
  /** Değer hataları — ALANIN YANINDA gösterilir, Kaydet'i de bağlar (K10). */
  hatalar?: CounterFieldError[];
}) {
  const locked = !row.counter.startValue;

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="text-sm font-medium">Sayaç</div>

      {/* ⚠️ TÜKENME KİLİTTEN BAĞIMSIZ ÇİZİLİR: top barkodunun sayaç AYARLARI
          kapalı ama günlük kapasitesi (9.999) gerçek ve dolduğunda üretim durur. */}
      <Tukenme exhaustion={exhaustion} />

      {locked ? (
        <p className="text-sm text-muted-foreground">{row.counter.lockedReason}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <CounterField
              id="ns-start" etiket="Başlangıç" yer="1"
              deger={counter.startValue} hata={counterFieldError(hatalar, "startValue")}
              onChange={(v) => onChange({ ...counter, startValue: v })}
            />
            <CounterField
              id="ns-step" etiket="Artış adımı" yer="1"
              deger={counter.step} hata={counterFieldError(hatalar, "step")}
              onChange={(v) => onChange({ ...counter, step: v })}
            />
            <CounterField
              id="ns-max" etiket="Üst sınır" yer="yok"
              deger={counter.maxValue} hata={counterFieldError(hatalar, "maxValue")}
              onChange={(v) => onChange({ ...counter, maxValue: v })}
            />
          </div>

          {/* ⚠️ SARMA YALNIZ ÜST SINIR DOLUYKEN ÇİZİLİR: sınırsız bir seride
              "başa dön" çıkışsız bir kapıdır (açık görünür, hiçbir şey yapmaz).
              Alanı hep çizip devre dışı bırakmak yerine hiç çizmemek seçildi —
              kullanıcı önce sınırı girer, kutu o zaman belirir. */}
          {counter.maxValue !== null && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={counter.wrap}
                onChange={(e) => onChange({ ...counter, wrap: e.target.checked })}
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Üst sınıra varınca başa dön
                <span className="block text-xs text-muted-foreground">
                  Numara {counter.startValue ?? 1}'den yeniden başlar ve TEKRAR EDER — fabrikanın
                  numaralı plaka seti gibi. Kapalıyken sınırda numara üretimi durur ve hata verir.
                </span>
              </span>
            </label>
          )}
          {counterFieldError(hatalar, "wrap") && (
            <p className="text-xs font-medium text-destructive">{counterFieldError(hatalar, "wrap")}</p>
          )}

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
