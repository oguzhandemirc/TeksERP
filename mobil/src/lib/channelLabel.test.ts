import { licenseClassLabel, resolveChannelLabel, resolveVisibleLabel } from './channelLabel';

describe('resolveChannelLabel — görünür kanal etiketi', () => {
  it('üretim kanalı (extra yok) → null: bugünkü görünüm birebir', () => {
    expect(resolveChannelLabel({})).toBeNull();
    expect(resolveChannelLabel(null)).toBeNull();
    expect(resolveChannelLabel(undefined)).toBeNull();
    expect(resolveChannelLabel({ extra: {} })).toBeNull();
  });

  it('hazırlık kanalı → etiket (kırpılmış)', () => {
    expect(resolveChannelLabel({ extra: { gorunurEtiket: 'TEST FABRİKA' } })).toBe('TEST FABRİKA');
    expect(resolveChannelLabel({ extra: { gorunurEtiket: '  TEST  ' } })).toBe('TEST');
  });

  it('boş ya da metin olmayan değer etiket SAYILMAZ', () => {
    expect(resolveChannelLabel({ extra: { gorunurEtiket: '   ' } })).toBeNull();
    expect(resolveChannelLabel({ extra: { gorunurEtiket: 1 } })).toBeNull();
    expect(resolveChannelLabel({ extra: 'x' })).toBeNull();
  });
});

describe('licenseClassLabel / resolveVisibleLabel — ortak pakette etiket lisans sınıfından (O8)', () => {
  const d = (sinif: string | null) => ({ ayrinti: true, sinif } as never);
  it('TEST / DEMO işaretlenir; URETIM, DR, BAYI, BARINDIRILAN, null, ayrıntısız → null', () => {
    expect(licenseClassLabel(d('TEST'))).toBe('TEST KURULUMU');
    expect(licenseClassLabel(d('DEMO'))).toBe('DEMO KURULUMU');
    for (const s of ['URETIM', 'DR', 'BAYI', 'BARINDIRILAN', null]) expect(licenseClassLabel(d(s))).toBeNull();
    expect(licenseClassLabel({ ayrinti: false })).toBeNull();
    expect(licenseClassLabel(undefined)).toBeNull();
  });
  it('derleme etiketi önce; yoksa lisans sınıfı', () => {
    expect(resolveVisibleLabel({ extra: { gorunurEtiket: 'TEST FABRİKA' } }, d('DEMO'))).toBe('TEST FABRİKA');
    expect(resolveVisibleLabel({}, d('TEST'))).toBe('TEST KURULUMU');
    expect(resolveVisibleLabel({}, d('URETIM'))).toBeNull();
  });
});
