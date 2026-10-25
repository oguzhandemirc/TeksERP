// Tablet kimliğinin kalıcılık kapıları (cihaz eşleme v2 §5.5 md. 2–3) — TEK KAYNAK; bağımlılık taşımaz.
// versionCode düşüşü Android'de kurulumu reddettirir → kaldır-kur → yerel kimlik ve offline kuyruk silinir.
// allowBackup açıkken geri yüklenen SecureStore değeri Keystore anahtarı olmadan çözülemez (K-C3).

/** `git log -p -- mobil/app.json` metninden geçmişte yayın kaydına girmiş EN BÜYÜK versionCode; yoksa null. */
function enBuyukGecmisVersionCode(gitLogMetni) {
  let enBuyuk = null;
  for (const m of String(gitLogMetni ?? '').matchAll(/^[+ -]\s*"versionCode"\s*:\s*(\d+)/gm)) {
    const n = Number(m[1]);
    if (enBuyuk === null || n > enBuyuk) enBuyuk = n;
  }
  return enBuyuk;
}

/** Üç sonuç: 'yesil' · 'kirmizi' (düşüş) · 'olculemedi' (ikisinden biri okunamadı — o da DURDURUR). */
function versionCodeDususu(mevcut, onceki) {
  const m = Number(mevcut);
  if (mevcut == null || !Number.isInteger(m) || onceki == null || !Number.isInteger(Number(onceki))) {
    return { sonuc: 'olculemedi', satirlar: [`versionCode ölçülemedi (paket: ${mevcut ?? '?'}, önceki yayın: ${onceki ?? '?'})`] };
  }
  if (m < Number(onceki)) {
    return {
      sonuc: 'kirmizi',
      satirlar: [
        `Paketin versionCode'u ${m}, önceki yayın ${onceki} — versionCode DÜŞEMEZ.`,
        'Android eski sürümü kurmaz; tablet kaldır-kur ister ve yerel cihaz kimliği ile offline kuyruk silinir.',
        "Yapılacak: app.json ve android/app/build.gradle versionCode'unu önceki yayından büyük yap (sürüm commit'i).",
      ],
    };
  }
  return { sonuc: 'yesil', satirlar: [`versionCode ${m} ≥ önceki yayın ${onceki}`] };
}

/** Kaynak AndroidManifest.xml (metin) `<application android:allowBackup="false">` taşıyor mu? */
function kaynakManifestYedekKapali(xml) {
  const m = /<application\b[^>]*>/s.exec(String(xml ?? ''));
  return !!m && /android:allowBackup\s*=\s*"false"/.test(m[0]);
}

/** Paket manifest öğelerinden (`[{ ad, oznitelik }]`) yedek sorunu; yoksa boş dizi. */
function yedekSorunlari(ogeler) {
  const uygulama = (ogeler ?? []).find((o) => o.ad === 'application');
  const deger = uygulama?.oznitelik?.allowBackup ?? null;
  return deger === 'false'
    ? []
    : [`application allowBackup=${deger ?? '(yok)'} — tablet yedeği kapalı olmalı (K-C3; app.json android.allowBackup:false)`];
}

module.exports = { enBuyukGecmisVersionCode, versionCodeDususu, kaynakManifestYedekKapali, yedekSorunlari };
