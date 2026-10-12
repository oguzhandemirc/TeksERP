// B3 — panel ile BAYT-EŞİT saf modül (ayna bekçisi: Teks-Erp/scripts/test_sunucu_kesintisi.ts): şerit metinleri,
// duyuru eşiği, bekletme yüklemi ve bekletici tablette de aynı davranır.
import {
  OUTAGE_TEXT_ONGOING,
  OUTAGE_TEXT_SOON,
  REQUEST_HOLD_MAX_MS,
  createRequestHold,
  outageStrip,
  outageTarget,
  setOutageTarget,
  shouldHoldRequests,
} from './sunucu-kesintisi';

const T0 = 1_000_000;
const target = (kalanSn: number, suruyor = false) => outageTarget({ planlanan: null, kalanSn, suruyor }, T0);

describe('sunucu-kesintisi (tablet)', () => {
  it('5 dk kala uyarı · son dakika birazdan · kesintide yeniden bağlanıyor · uzak an yok', () => {
    expect(outageStrip(target(300), T0, false)?.text).toBe('Sunucu 5 dk sonra yaklaşık 1 dk güncellenecek — kaydedilmemiş işinizi kaydedin');
    expect(outageStrip(target(20), T0, false)?.text).toBe(OUTAGE_TEXT_SOON);
    expect(outageStrip(target(20), T0, true)).toEqual({ kind: 'outage', text: OUTAGE_TEXT_ONGOING });
    expect(outageStrip(target(301), T0, false)).toBeNull();
  });

  it('bekletme yalnız duyuru etkin ve sunucu yanıtsızken; 15 dk bayat duyuruda yok', () => {
    expect(shouldHoldRequests(target(60), T0, true)).toBe(true);
    expect(shouldHoldRequests(target(60), T0, false)).toBe(false);
    expect(shouldHoldRequests(target(0), T0 + 16 * 60_000, true)).toBe(false);
  });

  it('bekletici üst sınırda (3 dk) bırakır', async () => {
    setOutageTarget(target(60));
    let now = T0;
    await createRequestHold({
      unreachable: () => true,
      probeHealth: async () => false,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    })('/rolls');
    expect(now - T0).toBeGreaterThanOrEqual(REQUEST_HOLD_MAX_MS);
    setOutageTarget(null);
  });
});
