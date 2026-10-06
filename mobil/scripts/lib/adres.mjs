// =============================================================================
// TeksERP Mobil — bundle'daki ERP adresi ölçümü (TEK KAYNAK)
// =============================================================================
// `build-apk.mjs` (kurulum dosyası), `ortak-ota.mjs` (OTA üretimi) ve
// `deploy/mobil-grup-yayinla.mjs` (yayın kapısı) bu dosyayı kullanır.
//
// ⚠️ NEDEN TEK KAYNAK: üç yüzey farklı yüklemle ölçseydi APK'nın geçtiği kapıdan
// OTA paketi geçemez (ya da tersi) ve fabrika adresi gömülü bir paket sessizce
// sahaya çıkabilirdi. Ortak paket ERP adresi GÖMMEZ; tablet sunucuyu çalışma
// anında bulur.
// =============================================================================

/**
 * Bir JS bundle'ının (Hermes; `latin1` okunmuş) taşıdığı `/api` adresleri.
 *
 * ⚠️ Hermes dizeleri UÇ UCA paketler (sonlandırıcı yok): "/api'den sonra harf
 * gelmesin" sondajı gerçek adresi bile eler — bu yüzden lookahead YOK.
 * ⚠️ Yalnız ASCII aranır (Türkçe karakterli dizeler UTF-16 tablosuna gider).
 */
function bundleAdresleri(metin) {
  return [...new Set(metin.match(/https?:\/\/[A-Za-z0-9._-]+(?::\d{2,5})?\/api/g) ?? [])];
}

/**
 * Ortak paketin bundle'ında ERP adresi YOK: sayısal IP'li, portlu ya da tailnet (`.ts.net`) bir `/api`
 * adresi = bir fabrikanın sunucusu gömülmüş (bayat .env, ortam sızıntısı). Yerel geri dönüş
 * (localhost) bugün koddadır ve sunucu bulma ekranı gelene dek (O8) bilgi olarak geçer.
 */
const YEREL_HOSTLAR = new Set(['localhost', '127.0.0.1', '0.0.0.0', '10.0.2.2']);
export function ortakBundleAdresleri(metin) {
  const bulunanlar = bundleAdresleri(metin);
  const gomulu = bulunanlar.filter((u) => {
    const m = /^https?:\/\/([A-Za-z0-9._-]+)(:\d{2,5})?\/api$/.exec(u);
    if (!m || YEREL_HOSTLAR.has(m[1].toLowerCase())) return false;
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(m[1]) || Boolean(m[2]) || /\.ts\.net$/i.test(m[1]);
  });
  return { gomulu, diger: bulunanlar.filter((u) => !gomulu.includes(u)) };
}
