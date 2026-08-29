// =============================================================================
// Bekçi: announceFailure — "kalıcı düşüşü ANINDA söyle, hiçbir yere yazma"
// =============================================================================
// Bu kural bir `if`ten ibaret olduğu için bekçisiz bırakılırsa tersine
// çevrilmesi HİÇBİR testi kırmaz. Kilitlenen üç şey:
//   • çakışma 409'u toast BASMAZ (ekran modalla soruyor — çift soru olurdu),
//   • istasyon-DIŞI mutation ve `noAuth` kapsam dışı,
//   • metin "kayıt oluşmadı" diye KESİN konuşmaz (timeout belirsizdir).
// =============================================================================

import { failureToastText, isStationMutationKey, shouldAnnounceFailure } from './announceFailure';

const KK1 = ['station', 'kk1-create-entry'] as const;

function err(
  message: string,
  extra: Record<string, unknown> = {},
): Error & Record<string, unknown> {
  return Object.assign(new Error(message), extra);
}

describe('shouldAnnounceFailure', () => {
  it('istasyon kaydının ağ hatası DUYURULUR', () => {
    expect(shouldAnnounceFailure(KK1, err('Sunucuya ulaşılamadı'))).toBe(true);
  });

  it('⭐ çakışma 409ları DUYURULMAZ — ekran zaten modalla soruyor', () => {
    // Toast basmak aynı kararı ikinci kez, üstelik cevaplanamaz biçimde
    // sordururdu; kutu döneminin asıl karışıklığı buydu.
    for (const code of ['POSSIBLE_DUPLICATE', 'CLIENT_TOKEN_COLLISION']) {
      expect(
        shouldAnnounceFailure(KK1, err('Bu top az önce girilmiş olabilir', {
          status: 409,
          details: { code },
        })),
      ).toBe(false);
    }
  });

  it('çakışma DIŞI 409 duyurulur (örn. WORK_SESSION_REQUIRED)', () => {
    // Bu tam da eskiden TAM SESSİZ kaybolan sınıftı — muafiyet listesi dar olmalı.
    expect(
      shouldAnnounceFailure(KK1, err('Çalışma oturumu gerekiyor', {
        status: 409,
        details: { code: 'WORK_SESSION_REQUIRED' },
      })),
    ).toBe(true);
  });

  it('istasyon-DIŞI mutation kapsam dışı', () => {
    expect(shouldAnnounceFailure(['orders', 'create'], err('hata'))).toBe(false);
  });

  it('noAuth düşüş DEĞİL, bekleyiştir — duyurulmaz', () => {
    expect(shouldAnnounceFailure(KK1, err('Oturum yok', { noAuth: true }))).toBe(false);
  });

  it('bozuk/eksik hata nesnesi çökertmez', () => {
    expect(shouldAnnounceFailure(KK1, null)).toBe(true);
    expect(shouldAnnounceFailure(undefined, null)).toBe(false);
  });
});

describe('isStationMutationKey', () => {
  it('yalnız "station" ile başlayan dizi', () => {
    expect(isStationMutationKey(KK1)).toBe(true);
    expect(isStationMutationKey(['orders', 'create'])).toBe(false);
    expect(isStationMutationKey('station')).toBe(false);
  });
});

describe('failureToastText', () => {
  it('hangi iş + sunucunun sebebi birlikte basılır', () => {
    const { text1, text2 } = failureToastText(err('Sunucuya ulaşılamadı'), 'Ham Giriş');
    expect(text1).toBe('Ham Giriş — KAYIT GİTMEDİ');
    expect(text2).toContain('Sunucuya ulaşılamadı');
  });

  it('⭐ "kayıt oluşmadı" diye KESİN konuşmaz — timeout belirsizdir', () => {
    // Sunucu isteği almış ve COMMIT etmiş olabilir. Kesin yokluk iddiası,
    // gerçekten yazılmış bir topu operatöre ikinci kez girdirirdi.
    const { text2 } = failureToastText(err('zaman aşımı'), 'Ham Giriş');
    expect(text2).not.toMatch(/OLUŞMADI|oluşmadı|kaydedilmedi/);
    expect(text2).toContain('Listede yoksa');
  });

  it('mesajsız hata da okunur metin üretir', () => {
    expect(failureToastText(null, 'Fason Sevk').text2).toContain('Bilinmeyen hata');
  });
});

// =============================================================================
// BULGU-T3-001 (S1) — EKRANSIZ ÇAKIŞMA DUYURULUR
// =============================================================================
// Çakışma 409'unun tek yüzeyi ekranın modalıdır; ama o modal yalnız kaydı YAPAN
// ekran ayaktayken çizilebilir. Uygulama kapanıp açıldığında kuyruktan replay
// edilen kaydın ekranı yoktur → 409 hiçbir yerde görünmeden düşüyordu ve
// fiziksel top sistemde hiç doğmuyordu. Damgayı `persistPolicy` yazar
// (`EKRANSIZ_META`), `queryClient` onu `mutation.meta`dan okur.
describe('shouldAnnounceFailure — ekransız çakışma (BULGU-T3-001)', () => {
  const conflict = err('Bu top az önce girilmiş olabilir', {
    details: { code: 'POSSIBLE_DUPLICATE' },
  });

  it('ekran VARKEN çakışma duyurulmaz (modal soruyor — eski sözleşme korunur)', () => {
    expect(shouldAnnounceFailure(KK1, conflict)).toBe(false);
    expect(shouldAnnounceFailure(KK1, conflict, false)).toBe(false);
  });

  it('ekran YOKKEN çakışma DUYURULUR (soruyu soracak modal yok)', () => {
    expect(shouldAnnounceFailure(KK1, conflict, true)).toBe(true);
  });

  it('ekransızlık, istasyon-dışı ve noAuth kurallarını EZMEZ', () => {
    expect(shouldAnnounceFailure(['orders'], conflict, true)).toBe(false);
    const noAuth = err('oturum yok', { noAuth: true, details: { code: 'POSSIBLE_DUPLICATE' } });
    expect(shouldAnnounceFailure(KK1, noAuth, true)).toBe(false);
  });

  it('ekransız çakışmanın toast metni "kayıt gitmedi" DEMEZ — önce baktırır', () => {
    const { text1, text2 } = failureToastText(conflict, 'KK1 ham giriş');
    expect(text1).toContain('BEKLEMEDE');
    expect(text1).not.toContain('GİTMEDİ');
    expect(text2).toContain('Listede yoksa');
  });

  it('çakışma OLMAYAN düşüşün metni değişmedi (regresyon)', () => {
    const { text1 } = failureToastText(err('Sunucuya ulaşılamadı'), 'KK1 ham giriş');
    expect(text1).toContain('GİTMEDİ');
  });
});
