// =============================================================================
// Bekçi: KK1 mükerrer top koruması (2026-08-03 saha vakası)
// =============================================================================
// 1) Saha vakasını birebir canlandırır: sunucu restart'ında 4 basış → TEK token.
// 2) Aynadaki hatayı da bekler: offline seri girişte 5 basış → 5 FARKLI token
//    (yapışkan token bu senaryoda topları sessizce yutardı).
// Bu iki test birlikte "ne çok yapışkan ne de hiç yapışkan olmayan" sözleşmeyi
// kilitler — birini kaldıran bir değişiklik diğerini kırar.
// =============================================================================

import {
  IDLE_ATTEMPT,
  isAmbiguousFailure,
  isRetrying,
  onAttemptFailed,
  onAttemptSucceeded,
  onCollisionResolvedAsNew,
  tokenForSubmit,
  type EntryAttemptState,
} from './entryAttempt';

/** Deterministik token üretici — sırayla t1, t2, ... verir. */
function seqGen() {
  let n = 0;
  return () => `t${++n}`;
}

describe('entryAttempt', () => {
  it('SAHA VAKASI: sunucu restartında 4 basış → tek kimlik gider', () => {
    const gen = seqGen();
    let state: EntryAttemptState = IDLE_ATTEMPT;
    const sent: string[] = [];

    // Basış #1 — sunucu ölü, stationRetry'ın denemeleri de tükendi.
    const first = tokenForSubmit(state, gen);
    sent.push(first);
    state = onAttemptFailed(state, first);

    // Basış #2, #3, #4 — operatör etiket çıkmadığı için üst üste basıyor.
    for (let i = 0; i < 3; i++) {
      const t = tokenForSubmit(state, gen);
      sent.push(t);
      state = onAttemptFailed(state, t);
    }

    expect(sent).toEqual(['t1', 't1', 't1', 't1']);
    // Sunucu tek kimlik gördü → clientToken @unique tek top doğurur.
    expect(new Set(sent).size).toBe(1);
  });

  it('REGRESYON: offline seri girişte her basış AYRI kimlik alır', () => {
    const gen = seqGen();
    const state: EntryAttemptState = IDLE_ATTEMPT;
    // Offline'da mutation *paused* olur → onError tetiklenmez → durum idle kalır.
    const sent = Array.from({ length: 5 }, () => tokenForSubmit(state, gen));

    expect(sent).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(new Set(sent).size).toBe(5);
  });

  it('başarı yapışkanlığı bırakır — sıradaki gerçek top taze kimlik alır', () => {
    const gen = seqGen();
    let state: EntryAttemptState = IDLE_ATTEMPT;

    const failed = tokenForSubmit(state, gen); // t1
    state = onAttemptFailed(state, failed);
    expect(isRetrying(state)).toBe(true);

    const retried = tokenForSubmit(state, gen); // t1 (tekrar)
    expect(retried).toBe('t1');
    state = onAttemptSucceeded(state, retried);
    expect(isRetrying(state)).toBe(false);

    expect(tokenForSubmit(state, gen)).toBe('t2'); // sıradaki top
  });

  it('tokenForSubmit durumu DEĞİŞTİRMEZ (saf okuma)', () => {
    const gen = seqGen();
    const state: EntryAttemptState = IDLE_ATTEMPT;
    tokenForSubmit(state, gen);
    expect(state).toEqual(IDLE_ATTEMPT);
  });

  it('ilgisiz/gecikmiş başarı yanıtı bekleyen denemeyi düşürmez', () => {
    let state: EntryAttemptState = IDLE_ATTEMPT;
    state = onAttemptFailed(state, 'tA');
    state = onAttemptSucceeded(state, 'tB'); // başka bir denemenin yanıtı
    expect(state.failedToken).toBe('tA');
  });

  it('409 çakışması "yeni top" olarak çözülünce taze kimliğe döner', () => {
    const gen = seqGen();
    let state: EntryAttemptState = IDLE_ATTEMPT;
    const t = tokenForSubmit(state, gen); // t1
    state = onAttemptFailed(state, t);

    state = onCollisionResolvedAsNew();
    expect(isRetrying(state)).toBe(false);
    expect(tokenForSubmit(state, gen)).toBe('t2');
  });

  describe('isAmbiguousFailure — yapışkanlığın tek meşru sebebi', () => {
    it('ağ hatası / zaman aşımı (status yok) BELİRSİZDİR → yapışır', () => {
      expect(isAmbiguousFailure(new Error('Network Error'))).toBe(true);
      expect(isAmbiguousFailure({ status: undefined })).toBe(true);
      expect(isAmbiguousFailure(null)).toBe(true);
    });

    it('5xx BELİRSİZDİR → yapışır', () => {
      expect(isAmbiguousFailure({ status: 500 })).toBe(true);
      expect(isAmbiguousFailure({ status: 503 })).toBe(true);
    });

    it('kesin 4xx yazmamıştır → YAPIŞMAZ (sonsuz "Tekrar Dene" döngüsü olmaz)', () => {
      expect(isAmbiguousFailure({ status: 400 })).toBe(false);
      expect(isAmbiguousFailure({ status: 403 })).toBe(false);
      expect(isAmbiguousFailure({ status: 404 })).toBe(false);
      expect(isAmbiguousFailure({ status: 409 })).toBe(false);
    });
  });

  it('yapışkan durumda eşzamanlı basışlar da aynı kimliği paylaşır', () => {
    const gen = seqGen();
    let state: EntryAttemptState = IDLE_ATTEMPT;
    state = onAttemptFailed(state, tokenForSubmit(state, gen)); // t1

    // Operatör tuşa üst üste basıyor; ikisi de uçuşta.
    const a = tokenForSubmit(state, gen);
    const b = tokenForSubmit(state, gen);
    expect(a).toBe(b);
  });
});
