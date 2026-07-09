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

describe('meterPeripheralFor (Tambur 2/4-kat)', () => {
  const rows = [
    dev({ code: '2K', role: '2-KAT' }),
    dev({ code: '4K', role: '4-KAT' }),
  ];

  it('4-KAT foldType → 4-KAT cihazı', () => {
    expect(meterPeripheralFor(rows, '4-KAT')?.code).toBe('4K');
  });
  it('2-KAT foldType → 2-KAT cihazı', () => {
    expect(meterPeripheralFor(rows, '2-KAT')?.code).toBe('2K');
  });
  it('null/undefined foldType → 2-KAT varsayılan', () => {
    expect(meterPeripheralFor(rows, null)?.code).toBe('2K');
    expect(meterPeripheralFor(rows, undefined)?.code).toBe('2K');
  });
  it('eşleşen role yok ama rolesiz var → rolesiz fallback', () => {
    const r = [dev({ code: 'ANY', role: null })];
    expect(meterPeripheralFor(r, '4-KAT')?.code).toBe('ANY');
  });
  it('eşleşen role ve rolesiz yok → null', () => {
    const r = [dev({ code: 'X', role: '4-KAT' })];
    expect(meterPeripheralFor(r, '2-KAT')).toBeNull();
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
