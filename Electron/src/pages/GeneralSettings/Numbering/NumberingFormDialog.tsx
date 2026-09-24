import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { NumberingFields } from "./NumberingFields";
import { NumberingPendingBlock } from "./NumberingPendingBlock";
import { NumberingPreviewBoxes } from "./NumberingPreviewBoxes";
import { NumberingCounterFields } from "./NumberingCounterFields";
import { NumberingSourceField } from "./NumberingSourceField";
import { NumberingEffectiveFromField } from "./NumberingEffectiveFromField";
import { useNumberingActions } from "./useNumberingActions";
import { useNumberingDraft } from "./useNumberingDraft";
import { counterErrors } from "./counterRules";
import { Badge } from "@/components/ui/badge";
import { lockBadge, lockSentence, userCanResolve } from "./lockText";
import { LockInfo } from "./LockInfo";
import type {
  NumberSeriesRow,
  NumberSourceMode,
  SeriesCounterInput,
  SeriesExhaustion,
  SeriesFormatInput,
} from "./types";


/** Kilit rozeti + ⓘ — cümle SUNUCUDAN, tooltip'te (satırı taşırmasın). */
function LockRow({ row }: { row: NumberSeriesRow }) {
  if (!row.lockKind) return null;
  return (
    <div className="flex items-center gap-1.5">
      <Badge
        variant={userCanResolve(row) ? "default" : "secondary"}
        className="shrink-0 whitespace-nowrap"
      >
        {lockBadge(row.lockKind)}
      </Badge>
      <LockInfo text={lockSentence(row)} />
    </div>
  );
}

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
    onizleme, siradaki, bicimHatasi, setBicimHatasi, genelHata, setGenelHata,
  } = d;

  const { kaydediliyor, kaydet, iptalEt } = useNumberingActions({
    row, fmt, counter, source, effectiveFrom,
    changed: row && fmt ? degisenBolumler(row, { fmt, counter, source }) : { formatChanged: false, counterChanged: false, sourceChanged: false },
    onSaved, setBicimHatasi, setGenelHata,
  });

  if (!row || !fmt) return null;

  const { formatChanged, counterChanged, sourceChanged } = degisenBolumler(row, { fmt, counter, source });
  const counterErrorList = counterErrors(counter);

  // ⚠️ KAYDET YALNIZ DEĞİŞEN BÖLÜMÜN HATASIYLA KAPANIR: biçim hatası varken bile
  // sayaç/kaynak kaydedilebilir (d3 ölçümü 2026-09-23 — önizleme hatası bütün
  // diyaloğu kilitliyordu). Sayaç değer hatası ise sayaç değiştiyse bağlar.
  const degisiklikVar = formatChanged || counterChanged || sourceChanged;
  const engel =
    (formatChanged && bicimHatasi !== null) || (counterChanged && counterErrorList.length > 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* ⚠️ AÇIKLAMA ZORUNLU (K12): `aria-describedby` olmadan Radix her açılışta
            uyarı basıyordu (d3 turunda 213 kez) ve ekran okuyucu diyaloğun ne
            yaptığını söylemiyordu. Cümle sözleşmeyi taşır: değişiklik GEÇMİŞE
            dokunmaz. */}
        <DialogHeader>
          <DialogTitle>{row.label}</DialogTitle>
          <DialogDescription>
            Numara biçimi, sayacı ve numara kaynağı. Değişiklik yalnız bundan sonra açılacak
            kayıtları etkiler; geçmiş numaralar aynı kalır.
          </DialogDescription>
        </DialogHeader>

        {/* Önizleme EN ÜSTTE ve BÜYÜK — kullanıcı ne üreteceğini önce görür. */}
        <NumberingPreviewBoxes preview={onizleme} next={siradaki} />

        <NumberingPendingBlock row={row} busy={kaydediliyor} onCancel={() => void iptalEt()} />

        {/* ⚠️ KİLİTLİ SERİDE ALANLAR GİZLENMEZ, PASİFLEŞİR (d3/1e kararı
            2026-09-23): kullanıcı bugünkü biçimi ve neyin ne zaman açılacağını
            görmeli. Cümle SUNUCUDAN gelir — panel kendi gerekçesini yazmaz.
            ⚠️ KISMİ KİLİTTE DE GÖSTERİLİR (K25, 2026-09-23): eksen kilidinde
            satır `editable` olduğu için cümle HİÇ çizilmiyordu — kullanıcı pasif
            bir alan görüyor, sebebini yalnız TABLO rozetinde bulabiliyordu.
            Sebebin alanın YANINDA olması, hata mesajının alanın yanında olmasıyla
            aynı kuraldır. */}
        {row.lockKind && (!row.editable || (row.lockedAxes?.length ?? 0) > 0) && (
          <LockRow row={row} />
        )}
        <NumberingFields
          fmt={fmt}
          onChange={setFmt}
          disabled={!row.editable}
          lockedAxes={row.lockedAxes}
          hata={bicimHatasi}
        />

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
