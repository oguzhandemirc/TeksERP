// =============================================================================
// Anlatı sayı biçimi — ondalık virgül; birim sınıfı (Electron `lib/format` + `lib/number-format` karşılığı)
// =============================================================================
// Sayı biçimi kuralı (kullanıcı 2026-11-12): ölçü/sayım/yüzde AYIRICISIZ ("14700 m"), para binlik
// ayırıcılı ve 2 haneli ("325.684,90 TL"). Rapor cümlesi panel kartıyla aynı metni basmalı; ICU'dan
// bağımsız (belirlenimli) yazıldı. Ek motoru eki BU metne göre seçer.

import { BIRIM_METNI, PARA_BIRIMLERI, type Birim } from "../sunum/sunum.types";

function parcala(n: number, ondalik: number): { sign: string; tam: number; kesir: number } {
  const k = 10 ** ondalik;
  const olcekli = Math.round(Math.abs(n) * k);
  const tam = Math.floor(olcekli / k);
  return { sign: n < 0 && olcekli > 0 ? "-" : "", tam, kesir: olcekli - tam * k };
}

/** Ölçü/sayım: `n`i en çok `ondalik` haneyle, AYIRICISIZ yazar; sondaki sıfırlar atılır ("12,5", "42300"). */
export function sayiMetni(n: number, ondalik = 1): string {
  if (!Number.isFinite(n)) return "—";
  const { sign, tam, kesir } = parcala(n, ondalik);
  const kesirMetin = kesir > 0 ? "," + String(kesir).padStart(ondalik, "0").replace(/0+$/, "") : "";
  return sign + String(tam) + kesirMetin;
}

/** Para: binlik noktalı, SABİT 2 hane ("325.684,90", "0,00"). */
export function paraMetni(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const { sign, tam, kesir } = parcala(n, 2);
  return sign + String(tam).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + String(kesir).padStart(2, "0");
}

/** Oran: "%12", "%12,5" (en çok 1 ondalık). */
export function oranMetni(n: number): string {
  return "%" + sayiMetni(n, 1);
}

export function paraBirimiMi(birim: Birim): boolean {
  return PARA_BIRIMLERI.includes(birim);
}

/** Sayının birimle görünen metni: oran "%78", para "1.200,00 TL", diğeri "42300 m". */
export function formatValue(n: number, birim: Birim): string {
  if (birim === "yuzde") return oranMetni(n);
  if (paraBirimiMi(birim)) return `${paraMetni(n)} ${BIRIM_METNI[birim]}`;
  return `${sayiMetni(n, 1)} ${BIRIM_METNI[birim]}`;
}
