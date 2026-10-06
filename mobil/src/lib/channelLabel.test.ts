import { licenseClassLabel } from './channelLabel';

describe('licenseClassLabel — ortak pakette etiket lisans sınıfından (O8)', () => {
  const d = (sinif: string | null) => ({ ayrinti: true, sinif } as never);
  it('TEST / DEMO işaretlenir; URETIM, DR, BAYI, BARINDIRILAN, null, ayrıntısız → null', () => {
    expect(licenseClassLabel(d('TEST'))).toBe('TEST KURULUMU');
    expect(licenseClassLabel(d('DEMO'))).toBe('DEMO KURULUMU');
    for (const s of ['URETIM', 'DR', 'BAYI', 'BARINDIRILAN', null]) expect(licenseClassLabel(d(s))).toBeNull();
    expect(licenseClassLabel({ ayrinti: false } as never)).toBeNull();
    expect(licenseClassLabel(undefined)).toBeNull();
  });
});
