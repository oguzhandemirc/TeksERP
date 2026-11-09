// İE oluşturma form başlığı: "Fason İş Emri" ibaresi yalnız Fason (müşteri malı) türünde.
import { createFormTitle } from './createEntry';

describe('createFormTitle', () => {
  it('⭐ Fason türde "Fason … · kip", kendi üretimde / tür seçilmemişken yalnız terim', () => {
    expect(createFormTitle('CUSTOMER_GOODS', true)).toMatch(/^Fason .+ · Elle oluştur$/);
    expect(createFormTitle('CUSTOMER_GOODS', false)).toMatch(/^Fason .+ · Belge okut$/);
    expect(createFormTitle('STANDARD', true)).not.toMatch(/Fason/);
    expect(createFormTitle(null, false)).not.toMatch(/Fason/);
    expect(createFormTitle('STANDARD', false)).toMatch(/ · Belge okut$/);
  });
  it('⭐ dar ekranda yalnız kısa kip (tür eki yok, kesilmez)', () => {
    expect(createFormTitle('CUSTOMER_GOODS', false, true)).toBe('Belge okut');
    expect(createFormTitle('CUSTOMER_GOODS', true, true)).toBe('Elle oluştur');
    expect(createFormTitle(null, false, true)).toBe('Belge okut');
  });
});
