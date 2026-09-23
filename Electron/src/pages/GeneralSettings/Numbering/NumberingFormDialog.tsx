import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { NumberingFields } from "./NumberingFields";
import { NumberingCounterFields } from "./NumberingCounterFields";
import { numberingService } from "./service";
import type { NumberSeriesRow, SeriesCounterInput, SeriesExhaustion, SeriesFormatInput } from "./types";


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

interface Props {
  row: NumberSeriesRow | null;
  /** `null` = bu seride sayım kaynağı yok ⇒ CÜMLEDE SAYI YAZILMAZ. */
  etkiSayisi: number | null;
  birim: string;
  exhaustion: SeriesExhaustion | null;
  onClose: () => void;
  onSaved: () => void;
}

export function NumberingFormDialog({ row, etkiSayisi, birim, exhaustion, onClose, onSaved }: Props) {
  const [fmt, setFmt] = useState<SeriesFormatInput | null>(null);
  const [counter, setCounter] = useState<SeriesCounterInput>({ startValue: null, step: null, maxValue: null });
  const [onizleme, setOnizleme] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    if (!row) return;
    setFmt({ prefix: row.prefix, dateSegment: row.dateSegment, digits: row.digits, separator: row.separator });
    setCounter({ startValue: row.startValue, step: row.step, maxValue: row.maxValue });
    setOnizleme(row.preview);
    setHata(null);
  }, [row]);

  // ⚠️ ÖNİZLEME yalnız BİÇİM değiştiğinde anlamlı: sayaç ayarı kodun ŞEKLİNİ
  // değiştirmez (yalnız hangi sayıdan devam edileceğini), bu yüzden önizleme
  // sorgusu sayaç alanlarına bağlı DEĞİL.
  // ⚠️ ÖNİZLEME SUNUCUDAN: panel kendi biçimlendiricisini YAZMAZ. Aday biçim
  // geçersizse (karakter · hane · ayraç · ÖN EK ÇAKIŞMASI) hata buradan gelir,
  // yani kullanıcı "Kaydet"e basmadan ÖNCE görür.
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
  }, [row, fmt]);

  if (!row || !fmt) return null;

  const formatChanged =
    fmt.prefix !== row.prefix || fmt.dateSegment !== row.dateSegment ||
    fmt.digits !== row.digits || fmt.separator !== row.separator;
  const counterChanged =
    counter.startValue !== row.startValue || counter.step !== row.step || counter.maxValue !== row.maxValue;

  const kaydet = async (): Promise<void> => {
    setKaydediliyor(true);
    try {
      // İKİ UÇ, İKİ KİLİT: yalnız AÇIK olan ve GERÇEKTEN değişen bölüm gönderilir.
      // Kapalı bölümü göndermek, kullanıcının dokunmadığı bir alan yüzünden 400
      // almasına yol açardı.
      if (row.editable && formatChanged) await numberingService.update(row.key, fmt);
      if (row.counter.startValue && counterChanged) await numberingService.updateCounter(row.key, counter);
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

        <NumberingCounterFields row={row} counter={counter} exhaustion={exhaustion} onChange={setCounter} />

        <EtkiCumlesi etkiSayisi={etkiSayisi} birim={birim} />

        {hata && <p className="text-sm font-medium text-destructive">{hata}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button
            onClick={() => void kaydet()}
            disabled={kaydediliyor || hata !== null || (!formatChanged && !counterChanged)}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
