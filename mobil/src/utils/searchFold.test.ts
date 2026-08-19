import {
  foldSearchText,
  foldSearchTerm,
  foldSearchTokens,
  foldedIncludes,
} from './searchFold';

describe('arama katlaması (mobil)', () => {
  it('canakkale ≡ çanakkale', () => {
    expect(foldedIncludes('ÇANAKKALE TEKSTİL', 'canakkale')).toBe(true);
    expect(foldedIncludes('Canakkale', 'çanakkale')).toBe(true);
  });

  it('PickerModal eksiği: tr-küçültme tek başına YETMİYORDU', () => {
    // Eski davranış: 'ÇANAKKALE'.toLocaleLowerCase('tr') → 'çanakkale'
    // ve 'canakkale' ile eşleşmiyordu. Kaybın kanıtı:
    expect('ÇANAKKALE'.toLocaleLowerCase('tr').includes('canakkale')).toBe(false);
    expect(foldedIncludes('ÇANAKKALE', 'canakkale')).toBe(true);
  });

  it('tüm Türkçe harfler iner', () => {
    expect(foldSearchText('ÇĞIİÖŞÜ')).toBe('cgiiosu');
  });

  it('boş arama süzmez, alakasız terim eşleşmez', () => {
    expect(foldedIncludes('x', '  ')).toBe(true);
    expect(foldedIncludes('ÇANAKKALE', 'bursa')).toBe(false);
  });

  it('REGRESYON SINIFI: iğneye ön işlem uygulamak katlamayı boşa düşürür', () => {
    expect(foldedIncludes('ŞAHİN TEKSTİL', 'ŞAHİN')).toBe(true);
    expect(foldedIncludes('ŞAHİN TEKSTİL', 'ŞAHİN'.toLowerCase())).toBe(true);
  });

  it('sunucudaki tr_fold ile aynı karşılıklar', () => {
    expect(foldSearchText('Großmann')).toBe(foldSearchText('GROSSMANN'));
    expect(foldSearchText('Ø')).toBe('o');
    expect(foldSearchText('  ÖZ   ŞAHİN  ')).toBe('oz sahin');
  });

  it('token ayrıştırma + joker temizliği', () => {
    expect(foldSearchTokens(' ŞAHİN  tekstil ')).toEqual(['sahin', 'tekstil']);
    expect(foldSearchTerm('%öz_şahin')).toBe('ozsahin');
  });
});
