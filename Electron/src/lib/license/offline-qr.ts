import { splitIntoQrParts } from "./qr-parca";

/**
 * Tek QR'da ekrandan rahat okunabilen üst sınır (≈ sürüm 25, düzeltme L). Üstündeki istek
 * sıralı parçalara bölünür: çevrimdışı yenileme isteği ≈ 2,7 KB ölçüldü, tek QR'da sürüm ~38
 * olur ve telefon kamerası monitörden okuyamaz.
 */
export const SINGLE_QR_MAX_CHARS = 1200;

/**
 * Çevrimdışı istek QR'larının değerleri — her biri telefonda satıcının /q sayfasını açan adres.
 * Sığıyorsa tek `…/q#<zarf>`; sığmıyorsa `…/q#<TKLQ1 parçası>` dizisi (sayfa parçaları sekmeler
 * arasında biriktirip birleştirir). Satıcı adresi yoksa ya da parçalara da sığmıyorsa null →
 * yalnız "metni kopyala" yolu kalır.
 */
export function offlineRequestQrValues(qrAdresi: string | null): string[] | null {
  if (!qrAdresi) return null;
  if (qrAdresi.length <= SINGLE_QR_MAX_CHARS) return [qrAdresi];
  const at = qrAdresi.indexOf("#");
  if (at < 0) return null;
  const parts = splitIntoQrParts(qrAdresi.slice(at + 1));
  if (!parts) return null;
  const base = qrAdresi.slice(0, at);
  return parts.map((p) => `${base}#${encodeURIComponent(p)}`);
}
