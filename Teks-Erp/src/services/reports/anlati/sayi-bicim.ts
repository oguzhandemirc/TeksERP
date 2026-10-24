// =============================================================================
// Anlatı sayı biçimi — binlik nokta, ondalık virgül (Electron `lib/number-format` karşılığı)
// =============================================================================
// Backend'deki tek sayı biçimleyicisi (`label-html.shared formatNumber`) etiket kuralıdır ve
// binlik ayırıcı KOYMAZ; rapor cümlesi panel kartıyla aynı metni basmalı ("42.300 m"), bu
// yüzden ayrı ve ICU'dan bağımsız (belirlenimli) yazıldı. Ek motoru eki BU metne göre seçer.

import { BIRIM_METNI, PARA_BIRIMLERI, type Birim } from "../sunum/sunum.types";

/** `n`i en çok `ondalik` haneyle yazar; sondaki sıfırlar atılır ("12,5", "42.300"). */
export function sayiMetni(n: number, ondalik = 1): string {
  if (!Number.isFinite(n)) return "—";
  const k = 10 ** ondalik;
  const olcekli = Math.round(Math.abs(n) * k);
  const tam = Math.floor(olcekli / k);
  const kesir = olcekli - tam * k;
  const tamMetin = String(tam).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const kesirMetin = kesir > 0 ? "," + String(kesir).padStart(ondalik, "0").replace(/0+$/, "") : "";
  const sign = n < 0 && olcekli > 0 ? "-" : "";
  return sign + tamMetin + kesirMetin;
}

/** Oran: "%12", "%12,5" (en çok 1 ondalık). */
export function oranMetni(n: number): string {
  return "%" + sayiMetni(n, 1);
}

export function paraBirimiMi(birim: Birim): boolean {
  return PARA_BIRIMLERI.includes(birim);
}

/** Sayının birimle görünen metni: oran "%78", para "1.200 TL" (0 ondalık), diğeri "42.300 m". */
export function formatValue(n: number, birim: Birim): string {
  if (birim === "yuzde") return oranMetni(n);
  if (paraBirimiMi(birim)) return `${sayiMetni(n, 0)} ${BIRIM_METNI[birim]}`;
  return `${sayiMetni(n, 1)} ${BIRIM_METNI[birim]}`;
}
