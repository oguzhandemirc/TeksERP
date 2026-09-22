import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { NumberingFields } from "./NumberingFields";
import { numberingService } from "./service";
import type { NumberSeriesRow, SeriesFormatInput } from "./types";


interface Props {
  row: NumberSeriesRow | null;
  /** `null` = bu seride sayım kaynağı yok ⇒ CÜMLEDE SAYI YAZILMAZ. */
  etkiSayisi: number | null;
  birim: string;
  onClose: () => void;
  onSaved: () => void;
}

export function NumberingFormDialog({ row, etkiSayisi, birim, onClose, onSaved }: Props) {
  const [fmt, setFmt] = useState<SeriesFormatInput | null>(null);
  const [onizleme, setOnizleme] = useState("");
  const [hata, setHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    if (!row) return;
    setFmt({ prefix: row.prefix, dateSegment: row.dateSegment, digits: row.digits, separator: row.separator });
    setOnizleme(row.preview);
    setHata(null);
  }, [row]);

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

  const kaydet = async (): Promise<void> => {
    setKaydediliyor(true);
    try {
      await numberingService.update(row.key, fmt);
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

        <NumberingFields fmt={fmt} onChange={setFmt} />

        {/* ETKİ CÜMLESİ HER ZAMAN GÖRÜNÜR. Sayı ÖLÇÜLÜR; kaynağı yoksa YAZILMAZ
            ("0" demek, ölçülmemiş bir şeye sıfır demek olurdu). */}
        <p className="text-sm text-muted-foreground">
          Yalnız bundan sonra açılacak kayıtları etkiler.{" "}
          {etkiSayisi === null
            ? "Bugüne kadarki kayıtların numarası değişmez"
            : `Bugüne kadarki ${etkiSayisi.toLocaleString("tr-TR")} ${birim} numarası değişmez`}
          , eski etiketler okunmaya devam eder.
        </p>

        {hata && <p className="text-sm font-medium text-destructive">{hata}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button onClick={() => void kaydet()} disabled={kaydediliyor || hata !== null}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
