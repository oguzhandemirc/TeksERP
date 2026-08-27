// =============================================================================
// TeksERP Mobil — dinamik Expo yapılandırması
// =============================================================================
// `app.json` STATİK gerçekleri taşır (ad, paket adı, izinler, runtimeVersion,
// kod imzalama sertifikası). Bu dosya tek bir şeyi enjekte eder: uygulamanın
// GÜNCELLEMEYİ alacağı adres.
//
// ⚠️ GÜNCELLEME ADRESİ, API ADRESİNDEN BAĞIMSIZDIR (2026-08-26 kararı).
// Uygulama ERP'ye fabrika ağından bağlanır (`EXPO_PUBLIC_API_URL`,
// `192.168.1.250:4000`) ama güncellemeyi İNTERNETTEN, masaüstü panelinin de
// kullandığı sunucudan alır. Tabletlerin wifi + LAN üzerinden internet erişimi
// her zaman var; iki ayrı güncelleme kanalı işletmenin karşılığı yoktu.
//
// ⚠️ BU, AYNI GÜN VERİLEN "TEK KAYNAK `EXPO_PUBLIC_API_URL`" KARARININ
// BİLİNÇLİ OLARAK TERSİNE ÇEVRİLMESİDİR. Burada gördüğün iki ayrı adres bir
// tutarsızlık değil: artık İKİ kanal var ve her biri kendi tek kaynağından
// gelir (`scripts/lib/feed.cjs` ↔ `EXPO_PUBLIC_API_URL`). Hiçbir kod birini
// diğerinden türetmez, dolayısıyla ayrışabilecek bir şey de yoktur.
// "Bunu birleştireyim" diye düşünüyorsan önce şunu sor: fabrika sunucusu
// kapalıyken ya da tablet başka bir ağdayken güncelleme nasıl gelecek?
//
// ⚠️ Adres derleme anında AndroidManifest'e gömülür, tabletten
// DEĞİŞTİRİLEMEZ. Yanlış giderse çözüm DNS'tir (alan adı bizim
// kontrolümüzde) — bu yüzden `disableAntiBrickingMeasures` açmaya gerek yok.
// =============================================================================

const { guncellemeAdresiCoz, manifestUrl } = require('./scripts/lib/feed.cjs');

module.exports = ({ config }) => {
  const runtimeVersion = String(config.runtimeVersion ?? '').trim();
  if (!runtimeVersion) {
    // Sessizce devam etmek, güncelleme adresini `…/ota//manifest` yapar ve
    // sunucuda 404 üretir — yani güncelleme sessizce hiç gelmez. Gürültülü dur.
    throw new Error(
      'app.json → expo.runtimeVersion tanımlı değil. Güncelleme adresi bu ' +
        'değeri içerir (her APK yalnız kendi paketini görsün diye).',
    );
  }

  const { deger: feed } = guncellemeAdresiCoz(process.env.EXPO_PUBLIC_UPDATE_URL);

  return {
    ...config,
    updates: {
      ...(config.updates ?? {}),
      url: manifestUrl(feed, runtimeVersion),
    },
  };
};
