import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/services/apiClient";
import { numberingService } from "./service";
import type { NumberSeriesRow, NumberSourceMode, SeriesCounterInput, SeriesFormatInput } from "./types";

/**
 * ⚠️ ÖNİZLEME SUNUCUDAN: panel kendi biçimlendiricisini YAZMAZ. Aday biçim
 * geçersizse (karakter · hane · ayraç · ÖN EK ÇAKIŞMASI · KOLONA SIĞMAMA) hata
 * buradan gelir, yani kullanıcı "Kaydet"e basmadan ÖNCE görür.
 *
 * ⚠️ Yalnız BİÇİME bağlı: sayaç ve kaynak ayarları kodun ŞEKLİNİ değiştirmez,
 * bu yüzden onlar değişince önizleme yeniden sorulmaz.
 */
function useOnizleme(
  row: NumberSeriesRow | null,
  /** YALNIZ bu satıra ait taslak; anahtar uyuşmuyorsa `null` gelir. */
  fmt: SeriesFormatInput | null,
  /** Sonuç yazıcıları TEK NESNEDE: üç ayrı parametre sınırı aşıyordu. */
  yaz: {
    setOnizleme: (v: string) => void;
    setSiradaki: (v: string | null) => void;
    setBicimHatasi: (v: string | null) => void;
  },
): void {
  const { setOnizleme, setSiradaki, setBicimHatasi } = yaz;
  useEffect(() => {
    if (!row || !fmt) return;
    // ⚠️ KİLİTLİ SERİDE ÖNİZLEME İSTENMEZ (2026-09-23, d3 ölçtü): uç biçim
    // kilidini de doğruluyor, yani kilitli bir satırı AÇMAK tek başına 400
    // döndürüyordu; o hata bütün diyaloğu kilitleyip SAYAÇ ve KAYNAK kaydını da
    // engelliyordu. Kilitli satırda değişebilecek bir biçim yok, dolayısıyla
    // sorulacak bir soru da yok — örnek zaten satırla geldi.
    if (!row.editable) return;
    let iptal = false;
    void numberingService
      .preview(row.key, fmt)
      .then((p) => { if (!iptal) { setOnizleme(p.preview); setSiradaki(p.next); setBicimHatasi(null); } })
      .catch((e: unknown) => {
        if (iptal) return;
        // ⚠️ ALAN MESAJI KAYBOLMASIN: `message` tek başına "Validasyon hatası"
        // diyor, asıl cümle `errors[0].message`te ("Hane sayısı en fazla 8
        // olabilir."). Okuma TEK KAYNAKTAN (`apiErrorMessage`).
        // ⚠️ BAYAT ÖRNEK GÖSTERME: hata anında eski örnek ekranda kalırsa
        // kullanıcı reddedilen biçimin çalıştığını sanır. Örnek "—" olur.
        setOnizleme("");
        setSiradaki(null);
        setBicimHatasi(apiErrorMessage(e, "Bu biçim kullanılamıyor."));
      });
    return () => { iptal = true; };
    // `useState` setter'ları KARARLIDIR; bağımlılığa eklemek susturmadan daha
    // dürüst — susturma, kuralın bir gün gerçekten bir şey yakalamasını da engeller.
  }, [row, fmt, setOnizleme, setSiradaki, setBicimHatasi]);
}

/**
 * Formun TASLAK durumu — satır değişince sıfırlanır.
 *
 * Bileşenden AYRILDI (2026-09-23): durum kurulumu ile çizim aynı fonksiyonda
 * büyüyüp boyut tavanını aştı. Ayrım rastgele değil: burası "ne düzenleniyor",
 * aşağısı "nasıl çiziliyor" — ikisi ayrı hızda değişir.
 */
export function useNumberingDraft(row: NumberSeriesRow | null) {
  /**
   * ⚠️ TASLAK KENDİ ANAHTARINI TAŞIR (2026-09-23, d3 ölçtü) — bu bir süsleme
   * değil, BAYAT İSTEK kapısı: diyalog sayfada sürekli bağlı kaldığı için `row`
   * değiştiğinde sıfırlama effect'i ile önizleme effect'i AYNI commit'te koşuyor
   * ve önizleme YENİ serinin anahtarıyla ESKİ serinin biçimini gönderiyordu.
   * Sonuç kullanıcının gördüğü hayalet mesajlardı: çuval açılınca "IE … iş emri
   * ile çakışıyor", kartela kabul açılınca "KS …". Anahtar taslağın İÇİNDE
   * durunca uyuşmayan istek hiç atılmaz.
   */
  const [taslak, setTaslak] = useState<{ key: string; fmt: SeriesFormatInput } | null>(null);
  const fmt = taslak && row && taslak.key === row.key ? taslak.fmt : null;
  const setFmt = (next: SeriesFormatInput): void => {
    if (row) setTaslak({ key: row.key, fmt: next });
  };
  const [counter, setCounter] = useState<SeriesCounterInput>({ startValue: null, step: null, maxValue: null, wrap: false });
  const [source, setSource] = useState<NumberSourceMode>("FREE");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [onizleme, setOnizleme] = useState("");
  /** "Sıradaki numara" — sunucudan, sayacı tüketmeden; ölçülemezse `null` (—). */
  const [siradaki, setSiradaki] = useState<string | null>(null);
  // ⚠️ İKİ AYRI HATA KOVASI: biçim hatası yalnız BİÇİM bölümünü bağlar. Tek kova
  // varken önizlemeden gelen bir hata Kaydet'i tamamen kapatıyor ve kullanıcı
  // ilgisiz bir bölümü (sayaç · numara kaynağı) kaydedemiyordu.
  const [bicimHatasi, setBicimHatasi] = useState<string | null>(null);
  const [genelHata, setGenelHata] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setTaslak({
      key: row.key,
      fmt: {
        prefix: row.prefix,
        dateSegment: row.dateSegment,
        digits: row.digits,
        separator: row.separator,
        separator2: row.separator2,
      },
    });
    setCounter({ startValue: row.startValue, step: row.step, maxValue: row.maxValue, wrap: row.wrap });
    setSource(row.source.value);
    setEffectiveFrom("");
    setOnizleme(row.preview);
    setSiradaki(null);
    setBicimHatasi(null);
    setGenelHata(null);
  }, [row]);

  useOnizleme(row, fmt, { setOnizleme, setSiradaki, setBicimHatasi });
  return {
    fmt, setFmt, counter, setCounter, source, setSource, effectiveFrom, setEffectiveFrom,
    onizleme, siradaki, bicimHatasi, setBicimHatasi, genelHata, setGenelHata,
  };
}
