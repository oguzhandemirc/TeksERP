// Kimlik yazısı gücü (backend `motor/kimlik-gucu.ts` aynası): genel etiket zayıf, başlık / firma adı güçlü; yalnız-zayıf seçim uyarır.
import { DISTINCTIVE_IDENTIFIER_WARNING, identityWarning, isStrongIdentifier } from './identityStrength';

describe('identityStrength', () => {
  it('genel alan etiketleri ve "X No" zayıf (bitişik OCR "PartiNo" dahil)', () => {
    for (const k of ['Tarih', 'Müşteri KG', 'Müşteri MT', 'Sevk Tarihi', 'Cinsi', 'Mamül En', 'Açıklama', 'FIŞ NO', 'FAT/IRSALIYE NO', 'Sira No Top No', 'Miktar 1', 'Ham PartiNo', 'GİRİŞ TOPLAM MT']) {
      expect([k, isStrongIdentifier(k)]).toEqual([k, false]);
    }
  });
  it('belge başlığı ve firma adı güçlü', () => {
    for (const k of ['Çıkış Çeki Listesi', 'KUMAŞ ÇEKİ LİSTESİ', 'ÜRÜN SEVK FİŞİ', 'KESİM TAKİP FORMU', 'GÜLEÇSOY BOYA', 'İrsaliye']) {
      expect([k, isStrongIdentifier(k)]).toEqual([k, true]);
    }
  });
  it('⭐ uyarı yalnız seçimin hepsi zayıfken; boş seçim zaten engel (teachIssues), uyarı yok', () => {
    expect(identityWarning(['Tarih', 'Cinsi', 'Açıklama'])).toBe(DISTINCTIVE_IDENTIFIER_WARNING);
    expect(identityWarning(['Tarih', 'Çıkış Çeki Listesi'])).toBeNull();
    expect(identityWarning([])).toBeNull();
    expect(DISTINCTIVE_IDENTIFIER_WARNING).toMatch(/^Belgeyi ayırt eden bir yazı seçin: başlık ya da firma adı/);
  });
});
