// =============================================================================
// Bekçi: asgari meşguliyet süresi + unmount temizliği
// =============================================================================
// KİLİTLENEN SÖZLEŞME (2026-09-04, kullanıcı isteği):
//   1) İş 0 ms sürse bile spinner EN AZ 2 sn döner (düğme yanıp sönmesin),
//   2) asgari süre TAVAN DEĞİLDİR — iş 5 sn sürerse 5 sn döner,
//   3) sonuç asgari süre DOLMADAN basılmaz (cevap spinner'ın önüne geçmesin),
//   4) ekrandan çıkılırsa timer SIZMAZ ve geri çağrı ÇAĞRILMAZ,
//   5) meşgulken ikinci basış yutulur (çift koşum yok).
//
// ⚠️ (2) olmadan doğru uygulama ile "sabit `setTimeout(2000)` gecikmesi"
// birbirinden ayırt edilemez — negatif sondanın yakaladığı fark tam orası.
// =============================================================================

import { act, renderHook } from '@testing-library/react-native';
import { useBusyAction } from './useBusyAction';

/** Kontrollü promise: testin istediği anda çözülür. */
function kapi<T>() {
  let coz!: (v: T) => void;
  let kir!: (e: unknown) => void;
  const p = new Promise<T>((r, j) => {
    coz = r;
    kir = j;
  });
  return { p, coz, kir };
}

/** Mikrotask kuyruğunu boşalt (fake timer'lar mikrotask'ı beklemez). */
async function mikrotaskAkit() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function ilerlet(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('useBusyAction — asgari süre', () => {
  it('§1 iş ANINDA bitse bile busy 2 sn boyunca TRUE kalır', async () => {
    const bitince = jest.fn();
    const { result } = renderHook(() =>
      useBusyAction(async () => 'ok', { bitince }),
    );

    act(() => result.current.tetikle());
    expect(result.current.busy).toBe(true);

    await mikrotaskAkit();
    // İş bitti ama asgari süre dolmadı → hâlâ dönüyor, sonuç HENÜZ basılmadı.
    expect(result.current.busy).toBe(true);
    expect(bitince).not.toHaveBeenCalled();

    await ilerlet(1999);
    expect(result.current.busy).toBe(true);
    expect(bitince).not.toHaveBeenCalled();

    await ilerlet(1);
    expect(result.current.busy).toBe(false);
    expect(bitince).toHaveBeenCalledWith('ok');
  });

  it('§2 asgari süre TAVAN DEĞİL — iş 5 sn sürerse 5 sn döner', async () => {
    const bitince = jest.fn();
    const g = kapi<string>();
    const { result } = renderHook(() => useBusyAction(() => g.p, { bitince }));

    act(() => result.current.tetikle());
    await ilerlet(2000);
    // Asgari süre doldu ama İŞ bitmedi → dönmeye devam.
    expect(result.current.busy).toBe(true);
    expect(bitince).not.toHaveBeenCalled();

    await ilerlet(3000);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      g.coz('gec-cevap');
      await Promise.resolve();
    });
    // İş asgari süreden UZUN sürdüyse ek bekleme YOK — sonuç hemen basılır.
    expect(result.current.busy).toBe(false);
    expect(bitince).toHaveBeenCalledWith('gec-cevap');
  });

  it('§3 hata dalında da asgari süre koşar ve `hataOlunca` çağrılır', async () => {
    const hataOlunca = jest.fn();
    const bitince = jest.fn();
    const { result } = renderHook(() =>
      useBusyAction(
        async () => {
          throw new Error('ağ yok');
        },
        { bitince, hataOlunca },
      ),
    );

    act(() => result.current.tetikle());
    await mikrotaskAkit();
    expect(result.current.busy).toBe(true);
    expect(hataOlunca).not.toHaveBeenCalled();

    await ilerlet(2000);
    expect(result.current.busy).toBe(false);
    expect(hataOlunca).toHaveBeenCalled();
    expect(bitince).not.toHaveBeenCalled();
  });

  it('§4 meşgulken ikinci basış YUTULUR (çift koşum yok)', async () => {
    const calis = jest.fn(async () => 'ok');
    const { result } = renderHook(() => useBusyAction(calis));

    act(() => result.current.tetikle());
    act(() => result.current.tetikle());
    act(() => result.current.tetikle());
    await mikrotaskAkit();
    expect(calis).toHaveBeenCalledTimes(1);

    await ilerlet(2000);
    // Bittikten sonra tekrar basılabilir.
    act(() => result.current.tetikle());
    await mikrotaskAkit();
    expect(calis).toHaveBeenCalledTimes(2);
  });

  it('§5 UNMOUNT: timer sızmaz ve sonuç geri çağrısı ÇAĞRILMAZ', async () => {
    const bitince = jest.fn();
    const { result, unmount } = renderHook(() =>
      useBusyAction(async () => 'ok', { bitince }),
    );

    act(() => result.current.tetikle());
    await mikrotaskAkit();
    // Asgari süre timer'ı kuruldu. (Sayım React'in kendi zamanlayıcılarını da
    // içerir — bu yüzden mutlak sayı değil, unmount'taki DÜŞÜŞ ölçülür.)
    const mesgulkenSayim = jest.getTimerCount();
    expect(mesgulkenSayim).toBeGreaterThan(0);

    unmount();

    // ① Bizim timer'ımız SÖNDÜ (clearTimeout kalkarsa bu satır kırmızı).
    expect(jest.getTimerCount()).toBeLessThan(mesgulkenSayim);

    // ② Ve zaman ilerlese de sonuç basılmaz (canlılık bayrağı).
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(bitince).not.toHaveBeenCalled();
  });

  it('§6 `asgariMs: 0` verilirse taban yok (dahili çağrılar için kaçış)', async () => {
    const bitince = jest.fn();
    const { result } = renderHook(() =>
      useBusyAction(async () => 1, { bitince, asgariMs: 0 }),
    );
    act(() => result.current.tetikle());
    await mikrotaskAkit();
    expect(result.current.busy).toBe(false);
    expect(bitince).toHaveBeenCalledWith(1);
  });
});
