// =============================================================================
// BEKÇİ — kabul iptali engelinde ENGELLEYEN KARTELALAR listelenebilir olmalı
// =============================================================================
// İKİ YÖNLÜ ölçer:
//   ① KORUMA — `SWATCHES_DOWNSTREAM` dalında künyeler çıkar (dialog açılabilir).
//      Bu yön eksikse operatör yine "N kartela" soyut sayısıyla kalır.
//   ② AYNADAKİ İKİZ — başka hata / liste yok / künye boş durumlarında `null`
//      döner ve çağıran Toast'a düşer. Bu yön eksikse ekran BOŞ bir dialog açar
//      ve operatör "engel yokmuş" diye okur — soyut sayıdan daha kötüsü.
//
// Körlük zemini: her vaka AYRI bekler; hepsi `null` dönen bir uygulama ①'de,
// hepsi liste dönen bir uygulama ②'de kırmızı verir.
// =============================================================================
import {
  blockedSwatchCardNumbers,
  SWATCHES_DOWNSTREAM_CODE,
} from './blockedSwatches.helper';

const err = (details: unknown): Error & { details?: unknown } =>
  Object.assign(new Error('engellendi'), { details });

describe('blockedSwatchCardNumbers', () => {
  it('① backend dalında künyeleri SIRASIYLA döner', () => {
    const out = blockedSwatchCardNumbers(
      err({ code: SWATCHES_DOWNSTREAM_CODE, blocked: ['KRT-0003', 'KRT-0001'] }),
    );
    expect(out).toEqual(['KRT-0003', 'KRT-0001']);
  });

  it('② başka hata kodunda null (Toast yolunda kalır)', () => {
    expect(blockedSwatchCardNumbers(err({ code: 'SWATCH_RACE' }))).toBeNull();
  });

  it('② kodsuz/details’siz hatada null', () => {
    expect(blockedSwatchCardNumbers(new Error('ağ hatası'))).toBeNull();
    expect(blockedSwatchCardNumbers(err(undefined))).toBeNull();
  });

  it('② liste dizi değilse ya da boşsa null (boş dialog açılmaz)', () => {
    expect(blockedSwatchCardNumbers(err({ code: SWATCHES_DOWNSTREAM_CODE, blocked: 'KRT-1' }))).toBeNull();
    expect(blockedSwatchCardNumbers(err({ code: SWATCHES_DOWNSTREAM_CODE, blocked: [] }))).toBeNull();
  });

  it('② künye olmayan öğeler atılır, kalanı listelenir', () => {
    const out = blockedSwatchCardNumbers(
      err({ code: SWATCHES_DOWNSTREAM_CODE, blocked: ['KRT-0007', null, '', 42, '  ', 'KRT-0008'] }),
    );
    expect(out).toEqual(['KRT-0007', 'KRT-0008']);
  });

  it('② hepsi künyesizse null (uydurma etiket basılmaz)', () => {
    expect(blockedSwatchCardNumbers(err({ code: SWATCHES_DOWNSTREAM_CODE, blocked: [null, 7] }))).toBeNull();
  });
});
