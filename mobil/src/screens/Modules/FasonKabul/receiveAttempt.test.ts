// =============================================================================
// BEKÇİ — fason kabulünde replay kimliği (BULGU-T2-007)
// =============================================================================
// İKİ YÖNLÜ ölçer, çünkü bu düzeltmenin iki ayrı düşme yönü var:
//
//   ① KORUMA — aynı teslimat yeniden gönderilirse AYNI token (ikinci makbuz
//      doğmaz). Bu yön eksikse bulgunun kendisi geri gelir.
//   ② AYNADAKİ İKİZ — farklı/sonraki teslimat YENİ token almalı. Bu yön
//      eksikse düzeltme, kopyadan daha kötü bir hata üretir: ikinci gerçek
//      teslimat sunucudan cached makbuzu alır ve SESSİZCE kaybolur (eksik stok).
//
// ⚠️ Sunucu tarafında bu ikinci yönü kapatan bir ağ YOK: fason token kapısı
// eşleşince yükü karşılaştırmadan cached makbuzu döner (KK1'in
// CLIENT_TOKEN_COLLISION'ı fasonda yok). Yani ② yalnız BURADAKİ iki sınırla
// (parmak izi + pencere) korunuyor — bu dosyanın en kritik bölümü odur.
// =============================================================================
import {
  FASON_RETRY_WINDOW_MS,
  onReceiveFailed,
  onReceiveSucceeded,
  receiveFingerprint,
  tokenForReceive,
  type ReceiveAttempt,
} from './receiveAttempt';

const T0 = 1_800_000_000_000;
const yuk = (over: Partial<Parameters<typeof receiveFingerprint>[0]> = {}) => ({
  workOrderId: 'wo1',
  stepId: 's1',
  subcontractorId: 'boyahane',
  returns: [{ rollId: 'r1', receivedQty: 30 }],
  newRolls: [{ qty: 30 }],
  ...over,
});
/** Sunucuya hiç ulaşmamış olabilir — timeout/ağ (status YOK). */
const BELIRSIZ = new Error('Network request failed');
const sunucuHatasi = Object.assign(new Error('Internal'), { status: 500 });
const kesin409 = Object.assign(new Error('İş emrinin rengi değişti'), {
  status: 409,
  details: { code: 'TARGET_COLOR_CHANGED' },
});

describe('receiveFingerprint — teslimatın kimliği', () => {
  it("satır SIRASI kimliği değiştirmez (ekran state'ine göre oynar)", () => {
    const a = receiveFingerprint(
      yuk({ returns: [{ rollId: 'r1', receivedQty: 30 }, { rollId: 'r2', receivedQty: 40 }] }),
    );
    const b = receiveFingerprint(
      yuk({ returns: [{ rollId: 'r2', receivedQty: 40 }, { rollId: 'r1', receivedQty: 30 }] }),
    );
    expect(a).toBe(b);
  });

  it('METRAJ farkı kimliği DEĞİŞTİRİR (30 m teslimat ≠ 40 m teslimat)', () => {
    expect(receiveFingerprint(yuk())).not.toBe(
      receiveFingerprint(yuk({ returns: [{ rollId: 'r1', receivedQty: 40 }] })),
    );
  });

  it('⭐ renk/en/not kimliğe GİRMEZ — düzeltip yeniden göndermek aynı teslimattır', () => {
    // Operatör eni 150 yerine 15 yazıp düzeltir: bu HÂLÂ aynı fiziksel teslimat.
    // Parmak izine girselerdi her düzeltme yeni token üretir, koruma tam da en
    // çok gerektiği anda düşerdi.
    const a = receiveFingerprint({ ...yuk(), appliedWidth: 15 } as never);
    const b = receiveFingerprint({ ...yuk(), appliedWidth: 150, notes: 'ıslak' } as never);
    expect(a).toBe(b);
  });

  it('TAM kabul (receivedQty yok) ile kısmi kabul ayrışır', () => {
    expect(receiveFingerprint(yuk({ returns: [{ rollId: 'r1' }] }))).not.toBe(
      receiveFingerprint(yuk()),
    );
  });
});

describe('① KORUMA — aynı teslimatın tekrarı aynı token', () => {
  it('düşmüş deneme yokken taze token', () => {
    expect(tokenForReceive(null, 'fp', T0, () => 'YENİ')).toBe('YENİ');
  });

  it('⭐ SAHA SENARYOSU: timeout → operatör yeniden girer → AYNI token', () => {
    const fp = receiveFingerprint(yuk());
    const ilk = tokenForReceive(null, fp, T0, () => 'TOKEN-1');
    // Uzun fason kabul tx'i zaman aşımına uğradı — yazıldı mı bilinmiyor.
    const dusmus = onReceiveFailed(ilk, fp, BELIRSIZ, T0);
    expect(dusmus).not.toBeNull();
    // Operatör formu yeniden doldurup 2 dk sonra basar (onMutate formu temizler).
    const ikinci = tokenForReceive(dusmus, fp, T0 + 120_000, () => 'TOKEN-2');
    expect(ikinci).toBe('TOKEN-1'); // ← ikinci makbuz DOĞMAZ
  });

  it('5xx de belirsizdir (sunucu tx"i kapatmış olabilir)', () => {
    const a = onReceiveFailed('T', 'fp', sunucuHatasi, T0);
    expect(a?.token).toBe('T');
  });

  it('KESİN 4xx"te yapışmaz — aynı yükü sonsuza dek gönderen döngü kurulmaz', () => {
    expect(onReceiveFailed('T', 'fp', kesin409, T0)).toBeNull();
  });
});

describe('② AYNADAKİ İKİZ — yeni teslimat sessizce yutulmaz', () => {
  const dusmus = (fp: string): ReceiveAttempt => ({ token: 'ESKİ', fingerprint: fp, at: T0 });

  it('⭐ FARKLI teslimat (başka metraj) taze token alır', () => {
    const eski = dusmus(receiveFingerprint(yuk()));
    const yeniFp = receiveFingerprint(yuk({ returns: [{ rollId: 'r1', receivedQty: 45 }] }));
    expect(tokenForReceive(eski, yeniFp, T0 + 60_000, () => 'YENİ')).toBe('YENİ');
  });

  it('⭐ AYNI rakamlar ama PENCERE dolmuş → taze token (yarınki teslimat)', () => {
    // Boyahane 30 m bugün, 30 m yarın gönderebilir — parmak izi BİREBİR aynıdır.
    // Pencere olmasaydı ikinci teslimat cached makbuzu alır, stok 30 m eksik kalırdı.
    const eski = dusmus(receiveFingerprint(yuk()));
    const t = tokenForReceive(
      eski,
      receiveFingerprint(yuk()),
      T0 + FASON_RETRY_WINDOW_MS + 1,
      () => 'YENİ',
    );
    expect(t).toBe('YENİ');
  });

  it('pencerenin TAM sınırında hâlâ korur (kapsayıcı)', () => {
    const eski = dusmus(receiveFingerprint(yuk()));
    expect(
      tokenForReceive(eski, receiveFingerprint(yuk()), T0 + FASON_RETRY_WINDOW_MS, () => 'YENİ'),
    ).toBe('ESKİ');
  });

  it('⭐ BAŞARIDAN SONRA yapışkanlık BİTER (ikinci teslimat kendi token"ıyla)', () => {
    expect(onReceiveSucceeded()).toBeNull();
    expect(tokenForReceive(onReceiveSucceeded(), 'fp', T0, () => 'YENİ')).toBe('YENİ');
  });

  it('pencere makul: form yeniden doldurmaya yeter, ertesi teslimata yetmez', () => {
    // Körlük zemini: sabit sıfırlanır/saçmalarsa iki yön de anlamını yitirir.
    expect(FASON_RETRY_WINDOW_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(FASON_RETRY_WINDOW_MS).toBeLessThanOrEqual(30 * 60_000);
  });
});
