// =============================================================================
// TeksERP Mobil — dinamik Expo yapılandırması
// =============================================================================
// TEK ORTAK PAKET (O7, docs/design/TEK-ORTAK-PAKET.md §2.2): kimlik (paket adı · görünen ad ·
// runtimeVersion · OTA sertifikası + kid · güncelleme adresi) dağıtım kaydından
// `scripts/lib/ortak-kimlik.cjs` ile uygulanır. Güncelleme adresi grup-nötr Worker takma adıdır
// (`https://indir…/ota/<rv>/manifest`; Worker belirtecin grubuna yönlendirir). ERP adresi
// GÖMÜLMEZ — tablet sunucuyu çalışma anında bulur. Eski kanal derlemesi (`TEKSERP_KANAL`) emekli:
// `eski-kanal-son` etiketi.
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

  // Eski kanal alışkanlığı (`TEKSERP_KANAL=<kod> npx expo prebuild`) sessizce ortak kimlikle
  // derlenmesin: eski kanal derlemesi yalnız `eski-kanal-son` etiketinden yapılır.
  const eskiKanal = String(process.env.TEKSERP_KANAL ?? '').trim();
  if (eskiKanal) {
    throw new Error(
      `EMEKLİ ESKİ KANAL ORTAMI: TEKSERP_KANAL=${eskiKanal} — bu ağaç yalnız tek ortak paketi derler. ` +
        'Eski kanal derlemesi: docs/ops/ESKI-KANAL-ACIL.md (eski-kanal-son etiketi).',
    );
  }

  const { ortakYapilandirmasi } = require('./scripts/lib/ortak-kimlik.cjs');
  return ortakYapilandirmasi(config);
};
