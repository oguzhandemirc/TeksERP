// btClassic.transport: paylaşılan BT-Classic transport — native modül setup.ts'te
// mock'lu (jest.fn). Her test mock dönüşlerini ayarlar.
import {
  isBtSupported,
  listBonded,
  writeRaw,
  readResponse,
  testConnection,
  btClassicTransport,
} from './btClassic.transport';

// setup.ts global mock'undaki default nesne (jest.fn'ler).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mod = require('react-native-bluetooth-classic').default as Record<string, jest.Mock>;

describe('btClassic.transport', () => {
  beforeEach(() => {
    for (const k of Object.keys(mod)) mod[k].mockReset();
    mod.isBluetoothEnabled.mockResolvedValue(true);
    mod.requestBluetoothEnabled.mockResolvedValue(true);
    mod.getBondedDevices.mockResolvedValue([]);
    mod.isDeviceConnected.mockResolvedValue(false);
    mod.connectToDevice.mockResolvedValue({});
    mod.writeToDevice.mockResolvedValue(true);
    mod.availableFromDevice.mockResolvedValue(0);
    mod.readFromDevice.mockResolvedValue(null);
    mod.clearFromDevice.mockResolvedValue(true);
  });

  it('isBtSupported → true (mock var)', () => {
    expect(isBtSupported()).toBe(true);
  });

  it('listBonded adı boş cihaza adresi yazar', async () => {
    mod.getBondedDevices.mockResolvedValue([
      { address: 'AA:11', name: '2-Kat' },
      { address: 'BB:22', name: null },
    ]);
    expect(await listBonded()).toEqual([
      { address: 'AA:11', name: '2-Kat' },
      { address: 'BB:22', name: 'BB:22' },
    ]);
  });

  it('testConnection bağlı değilse bağlanır', async () => {
    await testConnection('AA:11');
    expect(mod.connectToDevice).toHaveBeenCalledWith('AA:11');
  });

  it('writeRaw latin1 yazar; zaten bağlıysa yeniden bağlanmaz', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    await writeRaw('AA:11', 'HELLO', 'latin1');
    expect(mod.connectToDevice).not.toHaveBeenCalled();
    expect(mod.writeToDevice).toHaveBeenCalledWith('AA:11', 'HELLO', 'latin1');
  });

  it('writeRaw soket düşerse bir kez yeniden bağlanıp yazar', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    mod.writeToDevice.mockRejectedValueOnce(new Error('broken')).mockResolvedValueOnce(true);
    await writeRaw('AA:11', 'X', 'latin1');
    expect(mod.connectToDevice).toHaveBeenCalledTimes(1); // yalnız retry'da reconnect
    expect(mod.writeToDevice).toHaveBeenCalledTimes(2);
  });

  it('readResponse: pollCommand ascii + CR/LF eklenir, yanıt döner', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    mod.availableFromDevice.mockResolvedValueOnce(6);
    mod.readFromDevice.mockResolvedValueOnce('42.5\r\n');
    const raw = await readResponse('AA:11', { pollCommand: 'R' });
    expect(mod.clearFromDevice).toHaveBeenCalledWith('AA:11');
    expect(mod.writeToDevice).toHaveBeenCalledWith('AA:11', 'R\r\n', 'ascii');
    expect(raw).toBe('42.5\r\n');
  });

  it('btClassicTransport.read terminator ile erken döner', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    mod.availableFromDevice.mockResolvedValueOnce(3);
    mod.readFromDevice.mockResolvedValueOnce('7.0\n');
    const t = btClassicTransport('AA:11');
    expect(await t.read({ terminator: '\n' })).toBe('7.0\n');
  });
});
