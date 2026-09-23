import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { NumberingFields } from "./NumberingFields";
import { NumberingCounterFields } from "./NumberingCounterFields";
import { NumberingSourceField } from "./NumberingSourceField";
import { NumberingEffectiveFromField } from "./NumberingEffectiveFromField";
import { numberingService } from "./service";
import { counterErrors } from "./counterRules";
import { lockSentence } from "./lockText";
import type {
  NumberSeriesRow,
  NumberSourceMode,
  SeriesCounterInput,
  SeriesExhaustion,
  SeriesFormatInput,
} from "./types";


/**
 * ETKİ CÜMLESİ — HER ZAMAN görünür. Sayı SUNUCUDA ölçülür; kaynağı yoksa
 * YAZILMAZ ("0" demek, ölçülmemiş bir şeye sıfır demek olurdu).
 */
function EtkiCumlesi({ etkiSayisi, birim }: { etkiSayisi: number | null; birim: string }) {
  return (
    <p className="text-sm text-muted-foreground">
      Yalnız bundan sonra açılacak kayıtları etkiler.{" "}
      {etkiSayisi === null
        ? "Bugüne kadarki kayıtların numarası değişmez"
        : `Bugüne kadarki ${etkiSayisi.toLocaleString("tr-TR")} ${birim} numarası değişmez`}
      , eski etiketler okunmaya devam eder.
    </p>
  );
}

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
  setOnizleme: (v: string) => void,
  setBicimHatasi: (v: string | null) => void,
): void {
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
      .then((p) => { if (!iptal) { setOnizleme(p); setBicimHatasi(null); } })
      .catch((e: unknown) => {
        if (iptal) return;
        const m = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
        // ⚠️ BAYAT ÖRNEK GÖSTERME: hata anında eski örnek ekranda kalırsa
        // kullanıcı reddedilen biçimin çalıştığını sanır. Örnek "—" olur.
        setOnizleme("");
        setBicimHatasi(m ?? "Bu biçim kullanılamıyor.");
      });
    return () => { iptal = true; };
    // `useState` setter'ları KARARLIDIR; bağımlılığa eklemek susturmadan daha
    // dürüst — susturma, kuralın bir gün gerçekten bir şey yakalamasını da engeller.
  }, [row, fmt, setOnizleme, setBicimHatasi]);
}

interface Props {
  row: NumberSeriesRow | null;
  /** `null` = bu seride sayım kaynağı yok ⇒ CÜMLEDE SAYI YAZILMAZ. */
  etkiSayisi: number | null;
  birim: string;
  exhaustion: SeriesExhaustion | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Formun TASLAK durumu — satır değişince sıfırlanır.
 *
 * Bileşenden AYRILDI (2026-09-23): durum kurulumu ile çizim aynı fonksiyonda
 * büyüyüp boyut tavanını aştı. Ayrım rastgele değil: burası "ne düzenleniyor",
 * aşağısı "nasıl çiziliyor" — ikisi ayrı hızda değişir.
 */
function useNumberingDraft(row: NumberSeriesRow | null) {
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
  const [counter, setCounter] = useState<SeriesCounterInput>({ startValue: null, step: null, maxValue: null });
  const [source, setSource] = useState<NumberSourceMode>("FREE");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [onizleme, setOnizleme] = useState("");
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
    setCounter({ startValue: row.startValue, step: row.step, maxValue: row.maxValue });
    setSource(row.source.value);
    setEffectiveFrom("");
    setOnizleme(row.preview);
    setBicimHatasi(null);
    setGenelHata(null);
  }, [row]);

  useOnizleme(row, fmt, setOnizleme, setBicimHatasi);
  return {
    fmt, setFmt, counter, setCounter, source, setSource, effectiveFrom, setEffectiveFrom,
    onizleme, bicimHatasi, setBicimHatasi, genelHata, setGenelHata,
  };
}

/**
 * HANGİ BÖLÜM DEĞİŞTİ — üç ayrı uca üç ayrı istek gider, bu yüzden üç ayrı soru.
 *
 * ⚠️ YENİ ALAN BU KARŞILAŞTIRMAYA DA GİRER: eksik kalırsa kullanıcı alanı
 * değiştirir, Kaydet hiçbir şey göndermez ve ekran "kaydedildi" der — sessiz
 * bir kayıp. `separator2` D5②'de buraya eklendi.
 */
export function degisenBolumler(
  row: NumberSeriesRow,
  draft: { fmt: SeriesFormatInput; counter: SeriesCounterInput; source: NumberSourceMode },
): { formatChanged: boolean; counterChanged: boolean; sourceChanged: boolean } {
  const { fmt, counter, source } = draft;
  return {
    formatChanged:
      fmt.prefix !== row.prefix || fmt.dateSegment !== row.dateSegment ||
      fmt.digits !== row.digits || fmt.separator !== row.separator ||
      fmt.separator2 !== row.separator2,
    counterChanged:
      counter.startValue !== row.startValue || counter.step !== row.step || counter.maxValue !== row.maxValue,
    sourceChanged: source !== row.source.value,
  };
}

export function NumberingFormDialog({ row, etkiSayisi, birim, exhaustion, onClose, onSaved }: Props) {
  const d = useNumberingDraft(row);
  const {
    fmt, setFmt, counter, setCounter, source, setSource, effectiveFrom, setEffectiveFrom,
    onizleme, bicimHatasi, setBicimHatasi, genelHata, setGenelHata,
  } = d;
  const [kaydediliyor, setKaydediliyor] = useState(false);

  if (!row || !fmt) return null;

  const { formatChanged, counterChanged, sourceChanged } = degisenBolumler(row, { fmt, counter, source });
  const counterErrorList = counterErrors(counter);

  const kaydet = async (): Promise<void> => {
    setKaydediliyor(true);
    try {
      await numberingService.saveChanges(row, { fmt, counter, source, effectiveFrom }, { formatChanged, counterChanged, sourceChanged });
      onSaved();
    } catch (e) {
      const m = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      // Kaydetme hatası HANGİ bölümden geldiyse oraya yazılır: yalnız biçim
      // gönderildiyse biçim kovasına, aksi hâlde genel kovaya.
      if (formatChanged && !counterChanged && !sourceChanged) setBicimHatasi(m ?? "Kaydedilemedi.");
      else setGenelHata(m ?? "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

  // ⚠️ KAYDET YALNIZ DEĞİŞEN BÖLÜMÜN HATASIYLA KAPANIR: biçim hatası varken bile
  // sayaç/kaynak kaydedilebilir (d3 ölçümü 2026-09-23 — önizleme hatası bütün
  // diyaloğu kilitliyordu). Sayaç değer hatası ise sayaç değiştiyse bağlar.
  const degisiklikVar = formatChanged || counterChanged || sourceChanged;
  const engel =
    (formatChanged && bicimHatasi !== null) || (counterChanged && counterErrorList.length > 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{row.label}</DialogTitle></DialogHeader>

        {/* Önizleme EN ÜSTTE ve BÜYÜK — kullanıcı ne üreteceğini önce görür. */}
        <div className="rounded-md border bg-muted/40 p-4 text-center">
          <div className="text-xs text-muted-foreground">Örnek</div>
          <div className="font-mono text-2xl font-semibold tracking-wide">{onizleme || "—"}</div>
        </div>

        {/* Biçim bölümü KİLİTLİYSE çizilir ama yazılamaz — "neden kilitli?"
            sorusunun ekranda cevabı olmalı ("neden yok?" sorusununki olmaz). */}
        {/* ⚠️ KİLİTLİ SERİDE ALANLAR GİZLENMEZ, PASİFLEŞİR (d3/1e kararı
            2026-09-23): kullanıcı bugünkü biçimi ve neyin ne zaman açılacağını
            görmeli. Cümle SUNUCUDAN gelir — panel kendi gerekçesini yazmaz. */}
        {!row.editable && row.lockKind && (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">{lockSentence(row)}</p>
        )}
        <NumberingFields fmt={fmt} onChange={setFmt} disabled={!row.editable} hata={bicimHatasi} />

        {row.editable && (
          <NumberingEffectiveFromField value={effectiveFrom} onChange={setEffectiveFrom} />
        )}

        <NumberingCounterFields
          row={row}
          counter={counter}
          exhaustion={exhaustion}
          onChange={setCounter}
          hatalar={counterErrorList}
        />

        {/* ⚠️ YALNIZ elle yolu olan seride çizilir — 48 seride pasif kutu YOK. */}
        {row.source.editable && <NumberingSourceField value={source} onChange={setSource} />}

        <EtkiCumlesi etkiSayisi={etkiSayisi} birim={birim} />

        {/* Genel şerit YALNIZ beklenmeyen hata içindir; alan hataları kendi
            bölümlerinde durur (K5) — kullanıcı sebebi aradığı yerde bulsun. */}
        {genelHata && <p className="text-sm font-medium text-destructive">{genelHata}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button
            onClick={() => void kaydet()}
            disabled={kaydediliyor || engel || !degisiklikVar}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
