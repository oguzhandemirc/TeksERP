import { renderHook, act } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useIdleLock } from './useIdleLock';
import { useAuthStore } from '../store/authStore';
import {
  SYSTEM_DIALOG_TRAILING_MS,
  useLockStore,
  withSystemDialog,
} from '../store/lockStore';
import { SUPPRESSED_BACKGROUND_GRACE_MS } from '../utils/idleLock';
import type { JwtPayload } from '../types/auth';

// Regresyon: uygulamanın KENDİ açtığı sistem diyaloğu (BT izin/aç/PIN,
// yazdırma, kamera izni) Android'de activity'yi pause edip AppState
// 'background' yayar — bu blip "operatör uygulamadan ayrıldı" DEĞİLDİR ve
// kilitlememeli (ilk etiket basımında operatör kilit ekranına atılıyordu).
// Gerçek arka plan (home/ekran kapama) ise ANINDA kilitlemeye devam etmeli;
// diyalogda uzun süre kalınmışsa dönüşte grace kontrolü kilitlemeli.

jest.mock('./useFeatureFlags', () => ({
  useMobileIdleLockEnabled: () => true,
  useMobileIdleLockMinutes: () => 10,
  useMobileLockOnBackground: () => true,
}));

let now = 5_000_000_000;
const advance = (ms: number) => {
  now += ms;
};

describe('useIdleLock — AppState kilidi ve sistem diyaloğu muafiyeti', () => {
  let appStateHandler: ((s: AppStateStatus) => void) | undefined;
  const emit = (s: AppStateStatus) => act(() => appStateHandler!(s));

  beforeEach(() => {
    now += 60 * 60_000; // önceki testin kuyruk/damga kalıntıları geride kalsın
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    appStateHandler = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      appStateHandler = fn;
      return { remove: jest.fn() } as never;
    });
    useAuthStore.setState({ user: { userId: 'u1', username: 'op' } as JwtPayload });
    useLockStore.setState({ locked: false });
  });

  afterEach(() => {
    // act: mounted HookContainer'a store güncellemesi — RNTL cleanup'ından önce
    // koşuyor; sarılmazsa her testte "not wrapped in act" gürültüsü basılır.
    act(() => {
      useAuthStore.setState({ user: null });
      useLockStore.setState({ locked: false });
    });
    jest.restoreAllMocks();
  });

  it('gerçek arka plana geçiş (home/ekran kapama) ANINDA kilitler', () => {
    renderHook(() => useIdleLock());
    expect(appStateHandler).toBeDefined();
    emit('background');
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('sistem diyaloğu pending iken background blip\'i KİLİTLEMEZ; hızlı dönüşte de kilit yok', async () => {
    renderHook(() => useIdleLock());
    let release!: () => void;
    const dialog = withSystemDialog(() => new Promise<void>((r) => (release = r)));

    emit('background'); // diyalog açıldı → activity pause
    expect(useLockStore.getState().locked).toBe(false);

    release();
    await dialog;
    advance(3_000); // operatör diyaloğu saniyeler içinde cevapladı
    emit('active');
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('KUYRUK: erken çözülen printAsync sonrası geciken background eventi de bastırılır', async () => {
    renderHook(() => useIdleLock());
    await withSystemDialog(() => Promise.resolve()); // Android: pencere görünür olunca çözülür
    advance(SYSTEM_DIALOG_TRAILING_MS - 1);
    emit('background'); // event köprüden promise'ten SONRA geldi
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('diyalog bittikten (kuyruk geçtikten) SONRAKİ gerçek arka plan yine kilitler', async () => {
    renderHook(() => useIdleLock());
    await withSystemDialog(() => Promise.resolve());
    advance(SYSTEM_DIALOG_TRAILING_MS + 1);
    emit('background');
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('DÖNÜŞ-GRACE: diyalogda/arka planda grace\'ten uzun kalındıysa dönüşte kilitler', async () => {
    renderHook(() => useIdleLock());
    let release!: () => void;
    const dialog = withSystemDialog(() => new Promise<void>((r) => (release = r)));
    emit('background'); // bastırıldı + damgalandı
    expect(useLockStore.getState().locked).toBe(false);

    advance(SUPPRESSED_BACKGROUND_GRACE_MS + 1_000); // operatör çekip gitti
    release();
    await dialog;
    emit('active'); // dönen kişi başkası olabilir
    expect(useLockStore.getState().locked).toBe(true);
  });

  it("'active' geçişi (bastırılmış arka plan yokken) hiçbir zaman kilitlemez", () => {
    renderHook(() => useIdleLock());
    emit('active');
    expect(useLockStore.getState().locked).toBe(false);
  });
});
