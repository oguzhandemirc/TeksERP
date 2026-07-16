// btClassic.transport: paylaşılan BT-Classic transport — native modül setup.ts'te
// mock'lu (jest.fn). Her test mock dönüşlerini ayarlar.
import {
  isBtSupported,
  listBonded,
  discoverDevices,
  isBonded,
  pairByMac,
  writeRaw,
  readResponse,
  testConnection,
  btClassicTransport,
  decodeCommand,
  splitFrames,
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
    mod.startDiscovery.mockResolvedValue([]);
    mod.pairDevice.mockResolvedValue({});
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

  it('writeRaw timeoutMs: askıda kalan connect zaman aşımıyla NET hata verir (kuyruk donmaz)', async () => {
    // Yazıcı kapalı / HC-06 başka cihazda → native connect hiç çözülmez (askıda).
    mod.isDeviceConnected.mockResolvedValue(false);
    mod.connectToDevice.mockImplementation(() => new Promise(() => {}));
    mod.disconnectFromDevice = jest.fn().mockResolvedValue(true);
    await expect(
      writeRaw('AA:11', 'X', 'latin1', { retry: true, timeoutMs: 50 }),
    ).rejects.toThrow(/zaman aşımı/);
    // Askıdaki soketi koparma denenir (best-effort).
    expect(mod.disconnectFromDevice).toHaveBeenCalledWith('AA:11');
  });

  it('writeRaw timeoutMs: hızlı yazım zaman aşımına takılmaz', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    await writeRaw('AA:11', 'HELLO', 'latin1', { timeoutMs: 5000 });
    expect(mod.writeToDevice).toHaveBeenCalledWith('AA:11', 'HELLO', 'latin1');
  });

  it('readResponse POLL: komut TAM gönderilir (otomatik CR/LF YOK), çerçeve döner', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    mod.availableFromDevice.mockResolvedValueOnce(8);
    mod.readFromDevice.mockResolvedValueOnce('42.5\r\n');
    const raw = await readResponse('AA:11', { readMode: 'POLL', pollCommand: 'TTTTTT' });
    expect(mod.clearFromDevice).toHaveBeenCalledWith('AA:11');
    // Escape'siz komut aynen 6 bayt gider — eskiden 'TTTTTT\r\n' oluyordu.
    expect(mod.writeToDevice).toHaveBeenCalledWith('AA:11', 'TTTTTT', 'ascii');
    expect(raw).toBe('42.5'); // temiz çerçeve (CR/LF kırpılır)
  });

  it('readResponse POLL: escape dizileri çözülür (\\r → CR)', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    mod.availableFromDevice.mockResolvedValueOnce(6);
    mod.readFromDevice.mockResolvedValueOnce('7.0\r\n');
    await readResponse('AA:11', { readMode: 'POLL', pollCommand: 'R\\r' });
    expect(mod.writeToDevice).toHaveBeenCalledWith('AA:11', 'R\r', 'ascii');
  });

  it('readResponse STREAM: komut YOLLAMAZ; framePattern ile SON kararlı (B) çerçeveyi alır', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    // İlk çerçeve (yarım-başlangıç guard) atlanır; '@' (hareketli) çerçeve desene uymaz.
    mod.availableFromDevice.mockResolvedValueOnce(40);
    mod.readFromDevice.mockResolvedValueOnce('10.0B0\r\n77.7@0\r\n25.85B0\r\n25.85B0\r\n');
    const raw = await readResponse('AA:11', {
      readMode: 'STREAM',
      framePattern: '(\\d+(?:\\.\\d+)?)B',
    });
    expect(mod.writeToDevice).not.toHaveBeenCalled(); // yayın: komut yok
    expect(raw).toBe('25.85B0');
  });

  it('decodeCommand: düz metin aynen, escape çözülür', () => {
    expect(decodeCommand('TTTTTT')).toBe('TTTTTT');
    expect(decodeCommand('R\\r\\n')).toBe('R\r\n');
    expect(decodeCommand('\\x02R\\x03')).toBe('\x02R\x03');
  });

  it('splitFrames: tam çerçeveleri böler, ayraçsız kuyruğu rest bırakır', () => {
    expect(splitFrames('25.85B0\r\n26.70@0\r\n2')).toEqual({
      frames: ['25.85B0', '26.70@0'],
      rest: '2',
    });
  });

  it('isBonded MAC normalize eder (büyük/küçük harf + boşluk)', async () => {
    mod.getBondedDevices.mockResolvedValue([{ address: 'aa:bb:cc', name: 'Kantar' }]);
    expect(await isBonded('  AA:BB:CC ')).toBe(true);
    expect(await isBonded('DD:EE:FF')).toBe(false);
  });

  it('pairByMac eşleşmemişse pairDevice çağırır', async () => {
    mod.getBondedDevices.mockResolvedValue([]);
    await pairByMac('AA:11');
    expect(mod.pairDevice).toHaveBeenCalledWith('AA:11');
  });

  it('pairByMac zaten eşleşmişse pairDevice çağırmaz (idempotent)', async () => {
    mod.getBondedDevices.mockResolvedValue([{ address: 'AA:11', name: 'Kantar' }]);
    await pairByMac('aa:11');
    expect(mod.pairDevice).not.toHaveBeenCalled();
  });

  it('discoverDevices keşfedilen cihazları adı boşsa adresle döner', async () => {
    mod.startDiscovery.mockResolvedValue([
      { address: 'CC:33', name: 'Argox' },
      { address: 'DD:44', name: null },
    ]);
    expect(await discoverDevices()).toEqual([
      { address: 'CC:33', name: 'Argox' },
      { address: 'DD:44', name: 'DD:44' },
    ]);
  });

  it('btClassicTransport.read terminator ile çerçeveyi döner', async () => {
    mod.isDeviceConnected.mockResolvedValue(true);
    mod.availableFromDevice.mockResolvedValueOnce(3);
    mod.readFromDevice.mockResolvedValueOnce('7.0\n');
    const t = btClassicTransport('AA:11');
    expect(await t.read({ terminator: '\n' })).toBe('7.0');
  });

  it('aynı MAC eşzamanlı okumalar serileşir (tampon çakışmaz)', async () => {
    // Tek kabloyla 2-KAT + 4-KAT metre → iki cihaz kaydı AYNI MAC. İki okuma
    // çakışırsa readResponse'ın clear→write→read döngüsü birbirinin tamponunu
    // bozardı; MAC kilidi ikinci okumayı ilki bitene dek sıraya sokmalı.
    mod.isDeviceConnected.mockResolvedValue(true);
    mod.availableFromDevice.mockResolvedValue(12);
    mod.readFromDevice.mockResolvedValue('1.0\r\n1.0\r\n'); // 2 çerçeve → tek okumada döner
    const events: string[] = [];
    mod.clearFromDevice.mockImplementation(async () => {
      events.push('clear');
      return true;
    });
    mod.writeToDevice.mockImplementation(async (_addr: string, msg: string) => {
      events.push(`w:${msg}`);
      return true;
    });

    await Promise.all([
      readResponse('AA:11', { pollCommand: 'CMD1' }),
      readResponse('AA:11', { pollCommand: 'CMD2' }),
    ]);

    // Komutlar sırayla gitti (biri bitmeden diğeri yazmadı).
    expect(events.filter((e) => e.startsWith('w:'))).toEqual(['w:CMD1', 'w:CMD2']);
    // Serileşme kanıtı: 2. okumanın 'clear'ı 1. komut yazımından SONRA gelir —
    // kilit olmasa iki 'clear' en başta arka arkaya gelirdi.
    const clears = events.map((e, i) => (e === 'clear' ? i : -1)).filter((i) => i >= 0);
    expect(clears).toHaveLength(2);
    expect(clears[1]).toBeGreaterThan(events.indexOf('w:CMD1'));
  });
});
