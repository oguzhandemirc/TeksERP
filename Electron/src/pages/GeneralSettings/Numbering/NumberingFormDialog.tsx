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
  fmt: SeriesFormatInput | null,
  setOnizleme: (v: string) => void,
  setHata: (v: string | null) => void,
): void {
  useEffect(() => {
    if (!row || !fmt) return;
    let iptal = false;
    void numberingService
      .preview(row.key, fmt)
      .then((p) => { if (!iptal) { setOnizleme(p); setHata(null); } })
      .catch((e: unknown) => {
        if (iptal) return;
        const m = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
        setHata(m ?? "Bu biçim kullanılamıyor.");
      });
    return () => { iptal = true; };
    // `useState` setter'ları KARARLIDIR; bağımlılığa eklemek susturmadan daha
    // dürüst — susturma, kuralın bir gün gerçekten bir şey yakalamasını da engeller.
  }, [row, fmt, setOnizleme, setHata]);
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
  const [fmt, setFmt] = useState<SeriesFormatInput | null>(null);
  const [counter, setCounter] = useState<SeriesCounterInput>({ startValue: null, step: null, maxValue: null });
  const [source, setSource] = useState<NumberSourceMode>("FREE");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [onizleme, setOnizleme] = useState("");
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setFmt({
      prefix: row.prefix,
      dateSegment: row.dateSegment,
      digits: row.digits,
      separator: row.separator,
      separator2: row.separator2,
    });
    setCounter({ startValue: row.startValue, step: row.step, maxValue: row.maxValue });
    setSource(row.source.value);
    setEffectiveFrom("");
    setOnizleme(row.preview);
    setHata(null);
  }, [row]);

  useOnizleme(row, fmt, setOnizleme, setHata);
  return { fmt, setFmt, counter, setCounter, source, setSource, effectiveFrom, setEffectiveFrom, onizleme, hata, setHata };
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
  const { fmt, setFmt, counter, setCounter, source, setSource, effectiveFrom, setEffectiveFrom, onizleme, hata, setHata } = d;
  const [kaydediliyor, setKaydediliyor] = useState(false);

  if (!row || !fmt) return null;

  const { formatChanged, counterChanged, sourceChanged } = degisenBolumler(row, { fmt, counter, source });

  const kaydet = async (): Promise<void> => {
    setKaydediliyor(true);
    try {
      await numberingService.saveChanges(row, { fmt, counter, source, effectiveFrom }, { formatChanged, counterChanged, sourceChanged });
      onSaved();
    } catch (e) {
      const m = (e as { response?: { data?: { message?: string } } }).response?.data?.message;
      setHata(m ?? "Kaydedilemedi.");
    } finally {
      setKaydediliyor(false);
    }
  };

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
        {row.editable ? (
          <NumberingFields fmt={fmt} onChange={setFmt} />
        ) : (
          <p className="rounded-md border p-3 text-sm text-muted-foreground">
            Biçim bu seride değiştirilemez. {row.lockedReason}
          </p>
        )}

        {row.editable && (
          <NumberingEffectiveFromField value={effectiveFrom} onChange={setEffectiveFrom} />
        )}

        <NumberingCounterFields row={row} counter={counter} exhaustion={exhaustion} onChange={setCounter} />

        {/* ⚠️ YALNIZ elle yolu olan seride çizilir — 48 seride pasif kutu YOK. */}
        {row.source.editable && <NumberingSourceField value={source} onChange={setSource} />}

        <EtkiCumlesi etkiSayisi={etkiSayisi} birim={birim} />

        {hata && <p className="text-sm font-medium text-destructive">{hata}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button
            onClick={() => void kaydet()}
            disabled={kaydediliyor || hata !== null || (!formatChanged && !counterChanged && !sourceChanged)}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
