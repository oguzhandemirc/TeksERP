import {
  consumeSuppressedBackground,
  isSystemDialogPending,
  noteSuppressedBackground,
  SYSTEM_DIALOG_SUPPRESS_MAX_MS,
  SYSTEM_DIALOG_TRAILING_MS,
  useLockStore,
  withSystemDialog,
} from './lockStore';

// withSystemDialog: uygulamanın kendi açtığı sistem diyaloğu (BT izin/aç/PIN,
// yazdırma, kamera izni) sürerken AppState-kilidi bastırılır. Pencere üç
// parçalı: pending sayaç + settle sonrası KUYRUK (Print.printAsync Android'de
// pencere görünür olur olmaz çözülür — 'background' event'i sonradan gelir) +
// askıda kalan promise'e karşı TAVAN. Zaman Date.now spy'ı ile sürülür;
// modül-yerel kalıntılar (lastDialogSettledAt) testler arası taşınmasın diye
// her test büyük bir zaman sıçramasıyla başlar.

let now = 1_000_000_000;
const advance = (ms: number) => {
  now += ms;
};

beforeEach(() => {
  now += 60 * 60_000; // önceki testin kuyruk/tavan kalıntıları çok geride kalsın
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('withSystemDialog — bastırma penceresi', () => {
  it('çağrı pending iken true; resolve sonrası KUYRUK boyunca true, sonra false', async () => {
    let release!: () => void;
    const p = withSystemDialog(() => new Promise<void>((r) => (release = r)));
    expect(isSystemDialogPending()).toBe(true);
    release();
    await p;
    expect(isSystemDialogPending()).toBe(true); // kuyruk: geciken background eventi yarışı
    advance(SYSTEM_DIALOG_TRAILING_MS + 1);
    expect(isSystemDialogPending()).toBe(false);
  });

  it('REJECT de sayacı düşürür (reddedilen izin / iptal) ve hata aynen yayılır', async () => {
    let fail!: (e: Error) => void;
    const p = withSystemDialog(() => new Promise<void>((_r, rj) => (fail = rj)));
    expect(isSystemDialogPending()).toBe(true);
    fail(new Error('izin verilmedi'));
    await expect(p).rejects.toThrow('izin verilmedi');
    advance(SYSTEM_DIALOG_TRAILING_MS + 1);
    expect(isSystemDialogPending()).toBe(false);
  });

  it('iç içe/ardışık diyaloglar (izin → BT-aç zinciri): ikisi de bitene dek true', async () => {
    let r1!: () => void;
    let r2!: () => void;
    const p1 = withSystemDialog(() => new Promise<void>((r) => (r1 = r)));
    const p2 = withSystemDialog(() => new Promise<void>((r) => (r2 = r)));
    r1();
    await p1;
    advance(SYSTEM_DIALOG_TRAILING_MS + 1); // kuyruk geçti — ikincisi hâlâ pending
    expect(isSystemDialogPending()).toBe(true);
    r2();
    await p2;
    advance(SYSTEM_DIALOG_TRAILING_MS + 1);
    expect(isSystemDialogPending()).toBe(false);
  });

  it('TAVAN: askıda kalan promise bastırmayı süresiz açık tutamaz', () => {
    void withSystemDialog(() => new Promise<never>(() => {})); // hiç çözülmez (yetim)
    expect(isSystemDialogPending()).toBe(true);
    advance(SYSTEM_DIALOG_SUPPRESS_MAX_MS + 1);
    expect(isSystemDialogPending()).toBe(false); // gerçek arka plan kilidi geri geldi
  });

  it('sarılan fonksiyonun dönüş değeri aynen geçer', async () => {
    await expect(withSystemDialog(() => Promise.resolve('granted'))).resolves.toBe('granted');
  });
});

describe('bastırılmış background damgası (dönüş-grace için)', () => {
  it('note → consume geçen süreyi döner ve damgayı tüketir', () => {
    noteSuppressedBackground();
    advance(1234);
    expect(consumeSuppressedBackground()).toBe(1234);
    expect(consumeSuppressedBackground()).toBe(0); // tüketildi
  });
});

describe('lockStore — kilit bayrağı', () => {
  it('lock/unlock temel akışı', () => {
    useLockStore.getState().lock();
    expect(useLockStore.getState().locked).toBe(true);
    useLockStore.getState().unlock();
    expect(useLockStore.getState().locked).toBe(false);
  });
});
