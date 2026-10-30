// BEKÇİ — D4-F4 müşteri barkodu saf yüklemleri: düğme görünürlüğü (izin · emanet · sunucu yeteneği · eski backend
// 404 · emanet top), 409 çevirileri, aday ayrıştırma.
import { canBindCustomerCode, describeBindError, isEndpointMissing, parseAmbiguousScan, CUSTOMER_CODE_BIND_PERMISSIONS } from './customerCodeLogic';

const base = {
  has: (c: string) => c === 'roll:customer-code',
  emanetEnabled: true,
  serverKnowsCustomerCode: true,
  endpointMissing: false,
  ownerCustomerId: 'cust-1',
};

describe('canBindCustomerCode', () => {
  it('dört koşul tamam → görünür', () => expect(canBindCustomerCode(base)).toBe(true));
  it('izin yoksa düğme yok (koşulsuz 403 çağrısı atılmaz)', () =>
    expect(canBindCustomerCode({ ...base, has: () => false })).toBe(false));
  it('backend kümesinin her üyesi tek başına yeter (geri uyum: roll:write, mobile:tambur)', () => {
    for (const p of CUSTOMER_CODE_BIND_PERMISSIONS) expect(canBindCustomerCode({ ...base, has: (c) => c === p })).toBe(true);
    expect([...CUSTOMER_CODE_BIND_PERMISSIONS].sort()).toEqual(['mobile:tambur', 'roll:customer-code', 'roll:write']);
  });
  it('eski backend: bayrak alanı yok → gizli', () =>
    expect(canBindCustomerCode({ ...base, serverKnowsCustomerCode: false })).toBe(false));
  it('eski backend: uç 404 verdi → gizli', () => expect(canBindCustomerCode({ ...base, endpointMissing: true })).toBe(false));
  it('emanet modülü kapalı → gizli (403 MODULE_DISABLED çağrısı atılmaz)', () =>
    expect(canBindCustomerCode({ ...base, emanetEnabled: false })).toBe(false));
  it('sahipsiz top → gizli', () => expect(canBindCustomerCode({ ...base, ownerCustomerId: null })).toBe(false));
});

describe('isEndpointMissing', () => {
  it('rota yok (details.code yok) → true', () => expect(isEndpointMissing({ status: 404, message: 'Endpoint bulunamadı' })).toBe(true));
  it('top bulunamadı (kodlu 404) → false', () => expect(isEndpointMissing({ status: 404, details: { code: 'ROLL_NOT_FOUND' } })).toBe(false));
  it('ağ hatası → false', () => expect(isEndpointMissing(new Error('Network Error'))).toBe(false));
});

describe('describeBindError', () => {
  it('ROLL_CUSTOMER_CODE_EXISTS → değiştir önerisi', () =>
    expect(describeBindError({ status: 409, details: { code: 'ROLL_CUSTOMER_CODE_EXISTS' } }).kind).toBe('replace'));
  it('TAKEN / COLLIDES → Türkçe mesaj', () => {
    expect(describeBindError({ status: 409, details: { code: 'CUSTOMER_CODE_TAKEN' } })).toMatchObject({ kind: 'message', title: 'Bu kod başka bir topta' });
    expect(describeBindError({ status: 409, details: { code: 'CUSTOMER_CODE_COLLIDES' } })).toMatchObject({ kind: 'message', title: 'Bu bizim barkodumuz' });
  });
});

describe('parseAmbiguousScan', () => {
  const err = {
    status: 409,
    details: {
      code: 'CUSTOMER_CODE_AMBIGUOUS',
      scannedCode: 'MK1',
      candidates: [
        { rollId: 'r1', barcode: 'H1', customerId: 'a', customerName: 'A', code: 'MK1', currentQty: 41.5 },
        { rollId: 'r2', barcode: 'H2', customerId: 'b', customerName: 'B', code: 'MK1' },
      ],
    },
  };
  it('adayları döner', () => expect(parseAmbiguousScan(err)?.candidates.map((c) => c.barcode)).toEqual(['H1', 'H2']));
  it('başka 409 → null (bugünkü hata yolu)', () =>
    expect(parseAmbiguousScan({ status: 409, details: { code: 'CUSTOMER_CODE_TAKEN' } })).toBeNull());
});
