// =============================================================================
// btPrinter.service — ISINMA + PARÇALAMA disiplini (2026-08-19 saha vakası)
// =============================================================================
// SAHA: Tambur etiketlerinde BAŞTAKİ alanlar (QR, ürün adı, metraj, barkod)
// basılmıyordu. Üretilen PPLB akışı bayt bayt karşılaştırıldı: eksik alanlar
// akışın kesintisiz bir ÖN EKİNE denk geliyordu (T190826F0143: ilk 220/314
// bayt) — yani yazıcı komutları yanlış çizmiyor, akışın BAŞINI hiç almıyordu.
// Ölçüm: hata oranı son baskıdan bu yana geçen süreye bağlı bir BASAMAK
// (<30 sn %2, >60 sn %15 ve düz); aynı kodu koşan KK1 yazıcısında 195 baskıda
// 0 hata. Çare: soğuk hatta İLK giden şey asıl yük olmasın.
//
// ⚠️ Her test AYRI MAC kullanır: `macLastWrite`/`lastJobEndAt` modül-seviyesi
// durumdur ve sıfırlama API'si YOKTUR (üretimde sıfırlanmasının anlamı da yok).
// Aynı MAC'i paylaşan iki test birbirinin "hat sıcak mı" durumunu kirletir.
// =============================================================================

import { printPpla, printRawBytes, printTuning } from './btPrinter.service';
import { btTiming, readResponse } from './hal/btClassic.transport';

const mod = require('react-native-bluetooth-classic').default as Record<string, jest.Mock>;

/** Bu MAC'e giden yazma çağrılarının içerikleri (sırayla). */
function writes(address: string): string[] {
  return mod.writeToDevice.mock.calls
    .filter((c) => c[0] === address)
    .map((c) => c[1] as string);
}

beforeEach(() => {
  mod.isBluetoothEnabled.mockReset().mockResolvedValue(true);
  mod.getBondedDevices.mockReset().mockResolvedValue([{ address: 'AA:11', name: 'P' }]);
  mod.isDeviceConnected.mockReset().mockResolvedValue(true);
  mod.connectToDevice.mockReset().mockResolvedValue(true);
  mod.disconnectFromDevice.mockReset().mockResolvedValue(true);
  mod.writeToDevice.mockReset().mockResolvedValue(true);
  mod.availableFromDevice.mockReset().mockResolvedValue(0);
  mod.readFromDevice.mockReset().mockResolvedValue(null);
  mod.clearFromDevice.mockReset().mockResolvedValue(true);
  mod.pairDevice.mockReset().mockResolvedValue(true);
  // Gerçek beklemeler saha ayarıdır; testte davranışı ölçüyoruz, süreyi değil.
  printTuning.warmupSettleMs = 1;
  printTuning.chunkDelayMs = 1;
  printTuning.minJobSpacingMs = 0;
  printTuning.coldAfterMs = 20_000;
  printTuning.chunkBytes = 256;
  btTiming.connectSettleMs = 0;
});

describe('soğuk hat ısınması', () => {
  it('soğuk hatta ÖNCE ısınma baytı, SONRA yük yazılır', async () => {
    const mac = 'C0:00:00:00:00:01';
    await printPpla(mac, 'N\r\nq799\r\nP2\r\n');
    const seq = writes(mac);
    // İlk yazma ısınma: yük değil, zararsız satır sonu. Kaybolursa etiketin
    // BAŞI değil bu bayt yenir — düzeltmenin tamamı bu satıra dayanıyor.
    expect(seq[0]).toBe('\r\n');
    expect(seq[1]).toBe('N\r\nq799\r\nP2\r\n');
    expect(seq).toHaveLength(2);
  });

  it('hat SICAKKEN ısınma yazılmaz (her baskıya bedel bindirmez)', async () => {
    const mac = 'C0:00:00:00:00:02';
    await printPpla(mac, 'ILK');
    mod.writeToDevice.mockClear();
    await printPpla(mac, 'IKINCI');
    // Az önce başarılı yazma oldu → coldAfterMs dolmadı → yalnız yük gider.
    expect(writes(mac)).toEqual(['IKINCI']);
  });

  it('coldAfterMs dolmuşsa yeniden ısınır', async () => {
    const mac = 'C0:00:00:00:00:03';
    await printPpla(mac, 'ILK');
    mod.writeToDevice.mockClear();
    printTuning.coldAfterMs = 0; // "her şey soğuk" — geçen süreyi beklemeden ölç
    await printPpla(mac, 'IKINCI');
    expect(writes(mac)).toEqual(['\r\n', 'IKINCI']);
  });

  it('raster (GW bitmap) yolu da ısınır — ilk parçası da soğuk hatta gidiyordu', async () => {
    const mac = 'C0:00:00:00:00:04';
    await printRawBytes(mac, 'RASTER');
    expect(writes(mac)).toEqual(['\r\n', 'RASTER']);
  });
});

describe('parçalama', () => {
  it('komut yolu chunkBytes sınırında bölünür (HC-06 buffer taşmasın)', async () => {
    const mac = 'C0:00:00:00:00:05';
    printTuning.chunkBytes = 4;
    // NOT: hiç yazılmamış MAC her zaman SOĞUKTUR (msSinceLastWrite → null),
    // `coldAfterMs` ne olursa olsun — bu yüzden ısınma baytı beklentide.
    await printPpla(mac, 'ABCDEFGHIJ'); // 10 bayt → 4+4+2
    expect(writes(mac)).toEqual(['\r\n', 'ABCD', 'EFGH', 'IJ']);
  });

  it('parça ortasında reconnet YOK — düşen iş baştan gönderilir', async () => {
    const mac = 'C0:00:00:00:00:06';
    printTuning.chunkBytes = 4;
    // ısınma(ok) → 'ABCD'(ok) → 'EFGH'(DÜŞER) → dış catch → ısınma + baştan.
    mod.writeToDevice
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('koptu'))
      .mockResolvedValue(true);
    await printPpla(mac, 'ABCDEFGH');
    // İkinci parça retry KAPALI gider: hata anında forceDisconnect+connect
    // OLMAZ (olsaydı yazıcı yarım akışın üstüne yeni akış alır, etiket bölünürdü).
    expect(mod.connectToDevice).not.toHaveBeenCalled();
    // Yeniden deneme ISINMA İLE başlar — o CR/LF yarım kalmış satırı da kapatır.
    expect(writes(mac)).toEqual(['\r\n', 'ABCD', 'EFGH', '\r\n', 'ABCD', 'EFGH']);
  });
});

describe('sınırlar', () => {
  it('boş içerik yazıcıya HİÇ gitmez', async () => {
    const mac = 'C0:00:00:00:00:07';
    await expect(printPpla(mac, '')).rejects.toThrow('Etiket verisi boş');
    expect(writes(mac)).toEqual([]);
  });

  it('ısınma METRE/KANTAR okuma yoluna BULAŞMAZ (yalnız yazıcı katmanı)', async () => {
    // Negatif sonda: `readResponse` poll komutunu doğrudan yazar (writeRaw'dan
    // geçmez). Isınma oraya sızarsa metre cihazına çöp bayt gider ve okuma
    // sessizce bozulur — bu testin varlık sebebi o sızıntıyı yakalamak.
    const mac = 'C0:00:00:00:00:08';
    mod.readFromDevice.mockResolvedValue('12.5\r\n');
    await readResponse(mac, { readMode: 'POLL', pollCommand: 'Q', timeoutMs: 200 });
    expect(writes(mac)).toEqual(['Q']);
  });
});
