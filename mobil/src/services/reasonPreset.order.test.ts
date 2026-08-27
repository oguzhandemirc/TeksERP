// =============================================================================
// Bekçi: mergeVisibleOrder — sürüklenen sıra TAM listeye nasıl çevrilir
// =============================================================================
// Sunucu `PATCH /reason-presets/reorder` o kind'ın TÜM id'lerini sırasıyla
// ister ve eksik listeyi 400'le reddeder (kısmi sıralama, gönderilmeyen
// satırları sessizce listenin başına toplardı). Operatör ekranı ise yalnız
// AKTİF satırları çizer — yani sürüklenen sıra tanımı gereği KISMİDİR.
//
// Bu fonksiyon aradaki köprüdür: gizli satır TAM listede işgal ettiği yuvada
// KALIR, yalnız görünen satırların yuvalarına yeni sıra yazılır. Naif çözüm
// (görünenler önce, gizliler sona) pasif satırları her sürüklemede listenin
// dibine toplardı ve bu masaüstü düzenleme ekranında görünür bir yan etkidir.
// =============================================================================

import { mergeVisibleOrder } from './reasonPreset.service';

describe('mergeVisibleOrder', () => {
  it('gizli satır yoksa sıra birebir görünen sıradır', () => {
    expect(mergeVisibleOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  it('gizli satır KENDİ yuvasında kalır, görünenler kendi yuvalarına yazılır', () => {
    // Tam sıra: a(görünür) h(gizli) b(görünür) c(görünür)
    // Operatör c'yi başa çekti → görünen sıra: c a b
    // Beklenen: c h a b  — h ikinci yuvada KALDI.
    expect(mergeVisibleOrder(['a', 'h', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'h', 'a', 'b']);
  });

  it('gizli satır BAŞTAYSA da yerini korur', () => {
    expect(mergeVisibleOrder(['h', 'a', 'b'], ['b', 'a'])).toEqual(['h', 'b', 'a']);
  });

  it('birden fazla gizli satır ayrı ayrı korunur', () => {
    expect(mergeVisibleOrder(['h1', 'a', 'h2', 'b', 'c'], ['c', 'b', 'a'])).toEqual([
      'h1',
      'c',
      'h2',
      'b',
      'a',
    ]);
  });

  it('çıktı uzunluğu HER ZAMAN tam listenin uzunluğudur (sunucu eksik listeyi 400 yapar)', () => {
    const all = ['a', 'h', 'b', 'c', 'h2'];
    expect(mergeVisibleOrder(all, ['c', 'a', 'b'])).toHaveLength(all.length);
  });

  it('çıktı tam listenin AYNI kümesidir — id ne kaybolur ne çoğalır', () => {
    const all = ['a', 'h', 'b', 'c'];
    const out = mergeVisibleOrder(all, ['b', 'c', 'a']);
    expect([...out].sort()).toEqual([...all].sort());
  });

  it('görünen liste boşsa tam sıra DEĞİŞMEZ (sürükleyecek bir şey yoktu)', () => {
    expect(mergeVisibleOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });

  it('görünen listede tam listede olmayan id varsa yuva sayısı taşmaz', () => {
    // Savunma: istemci bayat bir satır gönderirse fazlalık YUTULUR, yuva
    // sayısı korunur. (Sunucu yabancı id'yi zaten reddeder; burada onu 400'e
    // düşürecek bir liste ÜRETMEMEK isteniyor.)
    const out = mergeVisibleOrder(['a', 'b'], ['x', 'y', 'z']);
    expect(out).toHaveLength(2);
  });
});
