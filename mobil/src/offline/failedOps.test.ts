// =============================================================================
// Bekçi: ölü mektup kutusu (kalıcı düşen istasyon kayıtları)
// =============================================================================
// Kapattığı delik: kuyruktaki bir kayıt kalıcı düştüğünde hata YALNIZ ilgili
// ekranın component `onError`'ına düşüyordu. Ekran mount değilse (kuyruk ana
// menüde flush oldu) ya da mutation restore edilmişse (observer YOK) hiçbir yere
// düşmüyordu; üstelik `error` durumu persist edilmediği için app restart'ta kayıt
// tamamen kayboluyordu. 409 `WORK_SESSION_REQUIRED` bu yoldan TAM SESSİZ gidiyordu.
// =============================================================================

import {
  clearStationFailure,
  opIdFor,
  recordStationFailure,
  useFailedOps,
  type FailedOp,
} from './failedOps';

const KK1 = ['station', 'kk1-create-entry'] as const;
const VARS = { itemId: 'urun-1', initialQty: 140, clientToken: 'tok-1' };

function err(message: string, status?: number, code?: string, barcode?: string) {
  return Object.assign(new Error(message), {
    status,
    details: code ? { code, barcode } : undefined,
  });
}

beforeEach(() => {
  useFailedOps.setState({ rows: [], hydrated: true });
});

describe('failedOps — ölü mektup kutusu', () => {
  it('EKRAN-BAĞIMSIZ: kalıcı düşüş kutuya yazılır (hiçbir component gerekmez)', () => {
    recordStationFailure(KK1, VARS, err('Bu top az önce girilmiş olabilir', 409, 'POSSIBLE_DUPLICATE', 'T050826H0001'));
    const rows = useFailedOps.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('POSSIBLE_DUPLICATE');
    expect(rows[0].barcode).toBe('T050826H0001');
    expect(rows[0].status).toBe(409);
  });

  it('SESSİZ KAYIP: WORK_SESSION_REQUIRED da yakalanır (muafiyet listesi BOŞ)', () => {
    // stationRetry TÜM 4xx'i fail-fast düşürür; bu 409 bugüne kadar hiçbir yerde
    // görünmüyordu. Muafiyet eklemek onu tekrar sessizleştirirdi.
    recordStationFailure(KK1, VARS, err('Çalışma oturumu gerekiyor', 409, 'WORK_SESSION_REQUIRED'));
    expect(useFailedOps.getState().rows).toHaveLength(1);
  });

  it('NoAuthError yazılmaz — kalıcı düşmez, kuyrukta süresiz bekler', () => {
    recordStationFailure(KK1, VARS, Object.assign(new Error('Oturum yok'), { noAuth: true }));
    expect(useFailedOps.getState().rows).toHaveLength(0);
  });

  it('istasyon-DIŞI mutation kutuya girmez', () => {
    recordStationFailure(['orders', 'create'], VARS, err('hata'));
    expect(useFailedOps.getState().rows).toHaveLength(0);
  });

  it('AYNI payload iki kez düşerse TEK satır kalır (retry gürültüsü)', () => {
    recordStationFailure(KK1, VARS, err('ilk'));
    recordStationFailure(KK1, VARS, err('ikinci'));
    const rows = useFailedOps.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe('ikinci'); // en son hata gösterilir
  });

  it('⭐ BAŞARI satırı kendiliğinden siler (opId determinizmi)', () => {
    recordStationFailure(KK1, VARS, err('ağ hatası'));
    expect(useFailedOps.getState().rows).toHaveLength(1);
    // "Tekrar Gönder" aynı vars'ı gönderdi ve bu kez geçti.
    clearStationFailure(KK1, VARS);
    expect(useFailedOps.getState().rows).toHaveLength(0);
  });

  it('opId ALAN SIRASINDAN bağımsız (aynı payload = aynı kimlik)', () => {
    expect(opIdFor(KK1, { a: 1, b: 2 })).toBe(opIdFor(KK1, { b: 2, a: 1 }));
    // ama farklı payload farklı kimlik
    expect(opIdFor(KK1, { a: 1 })).not.toBe(opIdFor(KK1, { a: 2 }));
    // ve farklı istasyon farklı kimlik
    expect(opIdFor(KK1, VARS)).not.toBe(opIdFor(['station', 'kk1-scrap'], VARS));
  });

  it('markRetrying satırı YENİ kimliğe taşır (payload değişti → başarı onu silsin)', () => {
    recordStationFailure(KK1, VARS, err('dup', 409, 'POSSIBLE_DUPLICATE'));
    const before = useFailedOps.getState().rows[0];
    const nextVars = { ...VARS, confirmDuplicate: true };
    useFailedOps.getState().markRetrying(before.id, opIdFor(KK1, nextVars));
    // Onay ile gönderim başarılı olunca satır düşmeli.
    clearStationFailure(KK1, nextVars);
    expect(useFailedOps.getState().rows).toHaveLength(0);
  });

  it('tavan aşılmaz (kutu okunmaz hâle gelmesin)', () => {
    for (let i = 0; i < 60; i++) {
      recordStationFailure(KK1, { ...VARS, clientToken: `tok-${i}` }, err(`hata ${i}`));
    }
    expect(useFailedOps.getState().rows.length).toBeLessThanOrEqual(50);
    // En yenileri korunur.
    const last = useFailedOps.getState().rows.at(-1) as FailedOp;
    expect(last.message).toBe('hata 59');
  });

  it('7 günden eski satırlar hydrate/prune ile düşer', () => {
    recordStationFailure(KK1, VARS, err('taze'));
    const stale: FailedOp = {
      ...useFailedOps.getState().rows[0],
      id: 'eski',
      failedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    useFailedOps.setState({ rows: [stale, ...useFailedOps.getState().rows] });
    // Yeni bir kayıt prune tetikler.
    recordStationFailure(KK1, { ...VARS, clientToken: 'tok-2' }, err('yeni'));
    expect(useFailedOps.getState().rows.find((r) => r.id === 'eski')).toBeUndefined();
  });
});
