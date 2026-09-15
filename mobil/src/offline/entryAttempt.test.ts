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
  decideSubmit,
  entryFingerprint,
  freshEntryIdentity,
  isAmbiguousFailure,
  isRetrying,
  onAttemptDetached,
  onAttemptFailed,
  onAttemptSettled,
  onAttemptStarted,
  onAttemptSucceeded,
  onCollisionResolvedAsNew,
  tokenForSubmit,
  type EntryAttemptState,
  type EntryIdentity,
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

  // ===========================================================================
  // UÇUŞ PENCERESİ (2026-08-05) — saha vakasının KAPANMAMIŞ yarısı
  // ===========================================================================
  // Yukarıdaki yapışkanlık ancak `onError` KOŞTUKTAN sonra kurulur; stationRetry
  // zinciri sürerken (~5-47 sn) durum hâlâ idle'dır. Kısa bir pm2 restart'ında o
  // pencere boyunca her basış TAZE token alır ve sunucu dönünce hepsi yazılır.
  // Aşağıdaki testler o pencereyi kapatır — ve kapatırken offline seri girişi
  // BOZMADIĞINI da kanıtlar (iki test birlikte sözleşmeyi kilitler).
  // ===========================================================================
  describe('uçuş penceresi', () => {
    const FP_A = entryFingerprint({ itemId: 'urun-1', initialQty: 140, width: 150 });
    const FP_B = entryFingerprint({ itemId: 'urun-1', initialQty: 88, width: 150 });
    const idA: EntryIdentity = { clientToken: 't1', clientEnteredAt: '2026-08-05T10:00:00.000Z' };

    it('SAHA VAKASI (kısa restart): uçuşta aynı yükle 3 basış → TEK kimlik', () => {
      let state: EntryAttemptState = IDLE_ATTEMPT;
      // Basış #1: online, istek uçtu (retry zinciri sürüyor, henüz onError YOK).
      expect(decideSubmit(state, FP_A)).toBe('send-new');
      state = onAttemptStarted(state, idA, FP_A, { queued: false });

      // Basış #2 ve #3: etiket çıkmadı, operatör tekrar basıyor. Aynı top.
      expect(decideSubmit(state, FP_A)).toBe('reuse-inflight');
      expect(state.inFlight?.identity).toEqual(idA);
      state = onAttemptStarted(state, idA, FP_A, { queued: false });
      expect(decideSubmit(state, FP_A)).toBe('reuse-inflight');
      // Damga da yeniden kullanılıyor — tazelenirse backend'in penceresi kaçar.
      expect(state.inFlight?.identity.clientEnteredAt).toBe(idA.clientEnteredAt);
    });

    it('FARKLI YÜK uçuşta bile YENİ toptur — gerçek top kaybolmaz', () => {
      let state: EntryAttemptState = IDLE_ATTEMPT;
      state = onAttemptStarted(state, idA, FP_A, { queued: false });
      // Operatör sıradaki topu girdi (farklı metraj) — collapse EDİLMEMELİ.
      expect(decideSubmit(state, FP_B)).toBe('send-new');
    });

    it('AYNADAKİ REGRESYON: offline (paused) basışlar uçuş kaydı AÇMAZ', () => {
      let state: EntryAttemptState = IDLE_ATTEMPT;
      for (let i = 0; i < 5; i++) {
        expect(decideSubmit(state, FP_A)).toBe('send-new'); // hep yeni top
        state = onAttemptStarted(state, { clientToken: `t${i}`, clientEnteredAt: 'x' }, FP_A, {
          queued: true,
        });
        expect(state.inFlight).toBeNull();
      }
    });

    it('onSettled yalnız BEKLENEN token’ı kapatır', () => {
      let state: EntryAttemptState = IDLE_ATTEMPT;
      state = onAttemptStarted(state, idA, FP_A, { queued: false });
      state = onAttemptSettled(state, 'baska-token'); // gecikmiş/ilgisiz yanıt
      expect(state.inFlight).not.toBeNull();
      state = onAttemptSettled(state, 't1');
      expect(state.inFlight).toBeNull();
      expect(decideSubmit(state, FP_A)).toBe('send-new');
    });

    it('ağ düşünce uçuş DEVREDİLİR (offline seri giriş kilitlenmez)', () => {
      let state: EntryAttemptState = IDLE_ATTEMPT;
      state = onAttemptStarted(state, idA, FP_A, { queued: false });
      state = onAttemptDetached(state);
      expect(state.inFlight).toBeNull();
      expect(decideSubmit(state, FP_A)).toBe('send-new');
    });

    it('düşmüş deneme uçuş penceresinden ÖNCE gelir (retry spam’i çoğalmaz)', () => {
      let state: EntryAttemptState = IDLE_ATTEMPT;
      state = onAttemptFailed(state, 't1');
      state = onAttemptStarted(state, idA, FP_A, { queued: false }); // "Tekrar Dene"
      // İkisi de dolu; retry dalı kazanmalı (o zaten aynı token'ı taşıyor).
      expect(decideSubmit(state, FP_A)).toBe('resend-failed');
      expect(isRetrying(state)).toBe(true);
    });

    it('freshEntryIdentity token ve damgayı BİRLİKTE üretir', () => {
      const gen = seqGen();
      const a = freshEntryIdentity(gen, () => '2026-08-05T10:00:00.000Z');
      const b = freshEntryIdentity(gen, () => '2026-08-05T10:01:00.000Z');
      expect(a).toEqual({ clientToken: 't1', clientEnteredAt: '2026-08-05T10:00:00.000Z' });
      expect(b.clientToken).toBe('t2');
      expect(b.clientEnteredAt).not.toBe(a.clientEnteredAt);
    });

    it('parmak izi DB hassasiyetine yuvarlanır (makine gürültüsü ayrı top sayılmaz)', () => {
      expect(entryFingerprint({ itemId: 'x', initialQty: 140.0001, width: 150.0002 })).toBe(
        entryFingerprint({ itemId: 'x', initialQty: 140.0004, width: 150.0001 }),
      );
      // Ama gerçek fark ayrı toptur.
      expect(entryFingerprint({ itemId: 'x', initialQty: 140, width: 150 })).not.toBe(
        entryFingerprint({ itemId: 'x', initialQty: 141, width: 150 }),
      );
      // Emanet sahibi (G3t): yalnız sahipte ayrılan iki giriş AYRI toptur; sahipsiz eski parmak iziyle aynı kalır.
      expect(entryFingerprint({ itemId: 'x', initialQty: 140, width: 150, ownerCustomerId: 'c1' })).not.toBe(
        entryFingerprint({ itemId: 'x', initialQty: 140, width: 150, ownerCustomerId: 'c2' }),
      );
      expect(entryFingerprint({ itemId: 'x', initialQty: 140, width: 150, ownerCustomerId: null })).toBe(
        entryFingerprint({ itemId: 'x', initialQty: 140, width: 150 }),
      );
      // ve "en yok" ile "en 0" karışmaz.
      expect(entryFingerprint({ itemId: 'x', initialQty: 140, width: null })).not.toBe(
        entryFingerprint({ itemId: 'x', initialQty: 140, width: 0 }),
      );
    });
  });
});
