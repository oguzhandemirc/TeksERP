// =============================================================================
// TEL TESTİ — damga karar noktasına GERÇEKTEN ulaşıyor mu (BULGU-T3-001)
// =============================================================================
// ⚠️ NEDEN AYRI BİR DOSYA VE NEDEN "SAF KARAR" TESTİ YETMİYOR:
//
// T3-001'in düzeltmesi ÜÇ parçadan oluşuyor ve her parçanın kendi testi vardı:
//   ① `persistPolicy.revivePendingStationMutations` damgayı basar    → test VAR
//   ② `announceFailure.shouldAnnounceFailure` damgalıyken duyurur     → test VAR
//   ③ `queryClient`in MutationCache.onError'ı damgayı ②'ye TAŞIR      → test YOKTU
//
// Üçüncüsü "tel"dir ve içinde denenmemiş bir varsayım taşır: mutation `meta`sı
// dehydrate/hydrate turundan geçer ve `mutation.meta` üzerinden okunabilir.
// O varsayım yanlış olsaydı ya da biri `announceStationFailure`in ÜÇÜNCÜ
// argümanını düşürseydi düzeltme ÖLÜR, ① ve ② YEŞİL KALIRDI.
//
// Bu, bu denetim turunda İKİ KEZ ısıran hata sınıfının aynısı: bekçinin kör
// noktası kusurla aynı yerde (`test_check_violation_mapping` ürünü değil kendi
// kopyasını ölçüyordu; sevkiyat §3'ü kodu değil bir YORUM satırını eşliyordu).
// Bu yüzden burada saf fonksiyon değil, GERÇEK `queryClient` koşturulur:
// mutation gerçekten düşer, onError gerçekten tetiklenir, Toast gerçekten
// ölçülür.
// =============================================================================
jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

import Toast from 'react-native-toast-message';
import { queryClient } from './queryClient';
import { EKRANSIZ_META } from './persistPolicy';

const show = Toast.show as unknown as jest.Mock;

/** Sunucunun "aynı top mu, ayrı top mu" sorusu — ekranı olan kayıtta MODAL sorar. */
const CAKISMA_409 = Object.assign(new Error('Bu top az önce girilmiş olabilir'), {
  details: { code: 'POSSIBLE_DUPLICATE' },
});
/** Ekranı olsun olmasın her zaman duyurulan kalıcı düşüş. */
const AG_HATASI = new Error('Network request failed');

/** İstasyon kaydını gerçekten koştur ve düşür — onError zinciri aynen işlesin. */
async function dusenIstasyonKaydi(hata: unknown, meta?: Record<string, unknown>): Promise<void> {
  const m = queryClient.getMutationCache().build(queryClient, {
    mutationKey: ['station', 'kk1-create-entry'],
    mutationFn: async () => {
      throw hata;
    },
    retry: 0,
    networkMode: 'always',
    ...(meta ? { meta } : {}),
  });
  await m.execute(undefined).catch(() => undefined);
}

beforeEach(() => {
  show.mockClear();
  queryClient.getMutationCache().clear();
});

describe('MutationCache.onError → announceStationFailure teli (T3-001)', () => {
  it('KÖRLÜK ZEMİNİ: ağ hatası her hâlükârda duyurulur (tel ve Toast canlı)', async () => {
    // Bu geçmezse aşağıdaki iki kontrol de anlamını yitirir: "duyurulmadı"
    // ile "hiçbir şey koşmadı" aynı yeşile çıkardı.
    await dusenIstasyonKaydi(AG_HATASI);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('EKRAN VARKEN çakışma 409u toast BASMAZ (tek yüzey ekranın modalı)', async () => {
    await dusenIstasyonKaydi(CAKISMA_409);
    expect(show).not.toHaveBeenCalled();
  });

  it('⭐ EKRANSIZ diriltilen kayıtta çakışma 409u DUYURULUR (asıl tel)', async () => {
    // Damga `revivePendingStationMutations` tarafından basılır ve
    // dehydrate/hydrate turundan geçerek `mutation.meta`ya ulaşır.
    // ⚠️ Bu kontrol, `queryClient`teki onError üçüncü argümanı (`mutation.meta`)
    // düşürülürse KIRMIZI verir — düzeltmenin ölü olduğu tek yer orası.
    await dusenIstasyonKaydi(CAKISMA_409, { [EKRANSIZ_META]: true });
    expect(show).toHaveBeenCalledTimes(1);
    const arg = show.mock.calls[0]![0] as { type: string; text1: string; text2: string };
    expect(arg.type).toBe('error');
    // Operatöre NE YAPACAĞINI söylemeli — boş/teknik metin işe yaramaz.
    expect(`${arg.text1} ${arg.text2}`.length).toBeGreaterThan(20);
  });

  it('istasyon-DIŞI mutation hiçbir hâlde duyurulmaz (kapsam dar kalır)', async () => {
    const m = queryClient.getMutationCache().build(queryClient, {
      mutationKey: ['orders', 'create'],
      mutationFn: async () => {
        throw AG_HATASI;
      },
      retry: 0,
      networkMode: 'always',
      meta: { [EKRANSIZ_META]: true },
    });
    await m.execute(undefined).catch(() => undefined);
    expect(show).not.toHaveBeenCalled();
  });
});
