import { useState } from "react";
import { apiErrorMessage } from "@/services/apiClient";
import { numberingService } from "./service";
import type { NumberSeriesRow, NumberSourceMode, SeriesCounterInput, SeriesFormatInput } from "./types";

/**
 * KAYDET ve İPTAL — diyaloğun İKİ yazma eylemi (2026-09-23'te bileşenden ayrıldı,
 * boyut tavanı). Ayrım rastgele değil: yukarısı "ne çiziliyor", burası "ne yazılıyor".
 *
 * ⚠️ HATA HANGİ BÖLÜMDEN geldiyse ORAYA yazılır: yalnız biçim gönderildiyse biçim
 * kovasına, aksi hâlde genel kovaya. Tek kova varken bir önizleme hatası Kaydet'i
 * tamamen kapatıyor ve ilgisiz bölümler (sayaç · numara kaynağı) kaydedilemiyordu.
 */
export function useNumberingActions(args: {
  /** `null` olabilir: kanca ERKEN DÖNÜŞTEN ÖNCE çağrılır (hook sırası kuralı). */
  row: NumberSeriesRow | null;
  fmt: SeriesFormatInput | null;
  counter: SeriesCounterInput;
  source: NumberSourceMode;
  effectiveFrom: string;
  changed: { formatChanged: boolean; counterChanged: boolean; sourceChanged: boolean };
  onSaved: () => void;
  setBicimHatasi: (v: string | null) => void;
  setGenelHata: (v: string | null) => void;
}): { kaydediliyor: boolean; kaydet: () => Promise<void>; iptalEt: () => Promise<void> } {
  const { row, fmt, counter, source, effectiveFrom, changed, onSaved, setBicimHatasi, setGenelHata } = args;
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const kaydet = async (): Promise<void> => {
    if (!row || !fmt) return;
    setKaydediliyor(true);
    try {
      await numberingService.saveChanges(row, { fmt, counter, source, effectiveFrom }, changed);
      onSaved();
    } catch (e) {
      const m = apiErrorMessage(e, "Kaydedilemedi.");
      if (changed.formatChanged && !changed.counterChanged && !changed.sourceChanged) setBicimHatasi(m);
      else setGenelHata(m);
    } finally {
      setKaydediliyor(false);
    }
  };

  /** Bekleyen (vadesi gelmemiş) değişikliğin iptali — sunucu tarafında TASLAK silme. */
  const iptalEt = async (): Promise<void> => {
    if (!row) return;
    setKaydediliyor(true);
    try {
      await numberingService.cancelPending(row.key);
      onSaved();
    } catch (e) {
      setGenelHata(apiErrorMessage(e, "Bekleyen değişiklik iptal edilemedi."));
    } finally {
      setKaydediliyor(false);
    }
  };

  return { kaydediliyor, kaydet, iptalEt };
}
