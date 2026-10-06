// =============================================================================
// TeksERP Mobil — dinamik Expo yapılandırması
// =============================================================================
// İKİ DERLEME KİMLİĞİ (tek ortak paket O7, docs/design/TEK-ORTAK-PAKET.md §2.2):
//
// • ARGÜMANSIZ (ortamda `TEKSERP_KANAL` yok) = TEK ORTAK PAKET. Kimlik (paket adı · görünen ad ·
//   runtimeVersion · OTA sertifikası + kid · güncelleme adresi) dağıtım kaydından
//   `scripts/lib/ortak-kimlik.cjs` ile uygulanır. Güncelleme adresi grup-nötr Worker takma adıdır
//   (`https://indir…/ota/<rv>/manifest`; Worker belirtecin grubuna yönlendirir). ERP adresi
//   GÖMÜLMEZ — tablet sunucuyu çalışma anında bulur.
//
// • `TEKSERP_KANAL=<kod>` = ESKİ KANAL DERLEMESİ (adnansahin, bayt-donuk). Kanalın kimliği
//   `deploy/kanallar.json`dan (`scripts/lib/kanal.cjs`). `app.json` bu kanalın dinlenme kimliğini
//   taşır ve kanal için YAZILMAZ (native parmak izi girdisi); eski kanal yolu O15'te emekli olur.
//
// ⚠️ GÜNCELLEME ADRESİ, API ADRESİNDEN BAĞIMSIZDIR (2026-08-26 kararı): ERP fabrika ağından,
// güncelleme internetten gelir; hiçbir kod birini diğerinden türetmez.
//
// ⚠️ Adres derleme anında AndroidManifest'e gömülür, tabletten DEĞİŞTİRİLEMEZ. Yanlış giderse
// çözüm DNS'tir — bu yüzden `disableAntiBrickingMeasures` açmaya gerek yok.
// =============================================================================

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

  const kanalKodu = String(process.env.TEKSERP_KANAL ?? '').trim();
  if (kanalKodu) {
    // Tembel yükleme: dinlenmede yapılandırmanın yüklediği modül kümesi (Expo
    // parmak izinin kaynağı) değişmesin.
    const { kanalYapilandirmasi } = require('./scripts/lib/kanal.cjs');
    return kanalYapilandirmasi(config, kanalKodu, runtimeVersion);
  }

  // Tembel yükleme: eski kanal derlemesinin yüklediği modül kümesi değişmesin.
  const { ortakYapilandirmasi } = require('./scripts/lib/ortak-kimlik.cjs');
  return ortakYapilandirmasi(config);
};
