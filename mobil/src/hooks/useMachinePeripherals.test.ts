// Saf seçiciler: makineye-bağlı METER cihaz listesinden doğru cihazı seçme.
// (Hook'un kendisi react-query → unit edilmez; yalnız pure fonksiyonlar.)
import { meterPeripheralFor, primaryMeterFor } from './useMachinePeripherals';
import type { DevicePeripheral } from '../services/peripheral.service';

const dev = (over: Partial<DevicePeripheral>): DevicePeripheral => ({
  id: 'id',
  code: 'C',
  name: 'N',
  kind: 'METER',
  connectionType: 'BLUETOOTH_SPP',
  address: '00:00:00:00:00:00',
  port: null,
  readMode: 'POLL',
  pollCommand: null,
  terminator: '\r\n',
  identifyPattern: null,
  decimals: 1,
  scale: null,
  unit: 'm',
  timeoutMs: 2500,
  role: null,
  simulate: true,
  ...over,
});

// =============================================================================
// meterPeripheralFor — BİREBİR ROL EŞLEŞMESİ, SAPMA YOK (2026-08-10)
// =============================================================================
// Eski hâli `foldType === '4-KAT' ? '4-KAT' : '2-KAT'` idi: ÜÇLÜ bir kararı
// ikiliye indiriyordu. Kat kataloğa taşınıp fabrika "6-KAT" ekleyince 6 katlı
// top **2-KAT metresiyle** ölçülürdü — hata yok, log yok, YANLIŞ METRAJ.
// Rolsüz cihaza düşme dalı da kaldırıldı: kat ayrımı olan bir istasyonda
// "rolsüz metre" hangi kata ait olduğu bilinmeyen cihazdır.
describe('meterPeripheralFor (kat → metre, birebir rol)', () => {
  const rows = [
    dev({ code: '2K', role: '2-KAT' }),
    dev({ code: '4K', role: '4-KAT' }),
    dev({ code: '6K', role: '6-KAT' }),
  ];

  it('4-KAT → 4-KAT cihazı', () => {
    expect(meterPeripheralFor(rows, '4-KAT')?.code).toBe('4K');
  });
  it('2-KAT → 2-KAT cihazı', () => {
    expect(meterPeripheralFor(rows, '2-KAT')?.code).toBe('2K');
  });
  it('KATALOG DEĞERİ: 6-KAT → 6-KAT cihazı (2-KAT\'a SAPMAZ)', () => {
    expect(meterPeripheralFor(rows, '6-KAT')?.code).toBe('6K');
  });
  it('metresi OLMAYAN kat → null (başka kata sapmaz, elle girişe düşülür)', () => {
    const r = [dev({ code: '2K', role: '2-KAT' }), dev({ code: '4K', role: '4-KAT' })];
    expect(meterPeripheralFor(r, '6-KAT')).toBeNull();
    expect(meterPeripheralFor(r, 'TUP')).toBeNull();
  });
  it('null/undefined/boş kat → null (varsayılan cihaz SEÇİLMEZ)', () => {
    expect(meterPeripheralFor(rows, null)).toBeNull();
    expect(meterPeripheralFor(rows, undefined)).toBeNull();
    expect(meterPeripheralFor(rows, '   ')).toBeNull();
  });
  it('ROLSÜZ cihaza DÜŞMEZ — hangi kata ait olduğu bilinmiyor', () => {
    const r = [dev({ code: 'ANY', role: null })];
    expect(meterPeripheralFor(r, '4-KAT')).toBeNull();
  });
  it('karşılaştırma büyük/küçük harf duyarsız (locale-bağımsız)', () => {
    const r = [dev({ code: 'T', role: 'TUP' })];
    expect(meterPeripheralFor(r, 'tup')?.code).toBe('T');
    expect(meterPeripheralFor(r, ' TuP ')?.code).toBe('T');
  });
  it('boş liste → null', () => {
    expect(meterPeripheralFor([], '2-KAT')).toBeNull();
  });
});

describe('primaryMeterFor (KK1 tek-metre)', () => {
  it('PRIMARY önceliklidir (ilk değilse bile)', () => {
    const rows = [
      dev({ code: 'A', role: '2-KAT' }),
      dev({ code: 'B', role: 'PRIMARY' }),
      dev({ code: 'C', role: null }),
    ];
    expect(primaryMeterFor(rows)?.code).toBe('B');
  });
  it('PRIMARY yoksa rolesiz cihaz', () => {
    const rows = [
      dev({ code: 'A', role: '2-KAT' }),
      dev({ code: 'B', role: null }),
    ];
    expect(primaryMeterFor(rows)?.code).toBe('B');
  });
  it('PRIMARY ve rolesiz yoksa ilk satır', () => {
    const rows = [
      dev({ code: 'A', role: '2-KAT' }),
      dev({ code: 'B', role: '4-KAT' }),
    ];
    expect(primaryMeterFor(rows)?.code).toBe('A');
  });
  it('boş liste → null', () => {
    expect(primaryMeterFor([])).toBeNull();
  });
});
