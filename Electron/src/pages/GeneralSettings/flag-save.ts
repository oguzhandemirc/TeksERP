// Kaydet sonrası doğrulama — sunucunun cevabında HİÇ bulunmayan gönderilmiş anahtar, sunucunun o
// alanı tanımadığını söyler (eski backend / sözleşme kayması). Değeri farklı dönen anahtar bu
// listeye girmez: sunucu kendi doğrusunu döndürmüştür ve taslak ondan yeniden kurulur.
export function unsavedFlagKeys(patch: object, saved: object): string[] {
  return Object.keys(patch).filter((k) => !Object.prototype.hasOwnProperty.call(saved, k));
}
