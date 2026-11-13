# Patron bildirimleri — canlı gönderim denemesi (runbook)

> Kural kaynağı: `docs/kurallar/patron-bulutu.md` § Bildirimler (B5) · sunucu: `docs/kurallar/patron-bulutu.md` § Patron sunucusu — Bildirimler (B5).
> Yerelde gerçek gönderim DENENMEZ (bekçiler sahte taşıyıcıyla koşar). Bu runbook yalnız şu ön koşullar tamamken koşulur:
> Apple/Google mağaza hesapları + Expo projesi (EAS) · patron bulutu VDS kurulumu · kullanıcının "canlı dene" cümlesi.

## Ön koşul

1. Patron uygulaması EAS ile derlenmiş (iOS/Android push izni `expo-notifications`; Expo proje kimliği `app.json` → `extra.eas.projectId`).
2. VDS'teki patron sunucusu `ANAHTAR_DIZINI` 0700; `patron-vapid.json` ilk açılışta üretilir (0600) — ÜSTÜNE YAZILMAZ, yedeklenir (kaybı = bütün web aboneliklerinin yenilenmesi).
3. `.env` (0600): `BILDIRIM_KIPI=gercek` · `BILDIRIM_VAPID_KONU=mailto:<destek adresi>` · isteğe bağlı Expo erişim belirteci sırrı (`EXPO_ERISIM_BELIRTECI_DOSYASI_HOST`, `PATRON-BULUTU-KURULUM.md` §4c; günlüğe yazılmaz).

## Adımlar

1. Önce `BILDIRIM_KIPI=sahte` ile aç: `PATRON_BILDIRIM kip=sahte` satırı · `GET /api/bildirim/ayarlar` → `gonderim: "sahte"`, `webPushAnahtari` dolu.
2. Test tesisinde (URETIM + `patron-bulut`) bir hesapla telefondan giriş → Profil → Bildirimler → izin ver; `GET /api/cihazlar` cihazı gösterir.
3. `BILDIRIM_KIPI=gercek`e al, sunucuyu yeniden başlat; tesis ayarında geciken sipariş eşiğini 0 yap, fabrikadan termini geçmiş bir kalemle eşitleme gelsin.
4. Beklenen: bir tur içinde (`BILDIRIM_ARALIGI_SN`) telefonda "Geciken sipariş"; dokununca Siparişler ekranı. `notifications` satırı `GONDERILDI`, `deliveries` `OK`.
5. Sessiz saat: pencereyi şimdiye kur → satır `BEKLIYOR` ve `next_attempt_at` = bitiş; bitişte gider.
6. Web: tarayıcıda (iOS'ta 16.4+ ve ana ekrana eklenmiş) aynı akış.
7. Deneme bildirimi: Profil → Bildirimler → "Deneme bildirimi gönder" → telefonda "Deneme bildirimi"; dakikada bir (ikinci dokunuş 429 "… sn sonra"). Kayıtsız cihaz pasife düşer, yanıt cihaz başına sonucu gösterir.
8. Makbuz (Expo ikinci aşama): gönderimden 15 dk sonra tur makbuzu yoklar — `deliveries[].bilet` dolu, `makbuz` `OK` olur; uygulaması silinmiş telefonda `GECERSIZ_CIHAZ:EXPO_CIHAZ_KAYITSIZ` ve cihaz `active=false`. Hazır olmayan makbuz 15 dk'da bir yeniden sorulur, 24 saatte `ZAMAN_ASIMI`.

## Geri alma

`BILDIRIM_KIPI=kapali` + yeniden başlat: iş kurulmaz, kuyruk birikmez; mevcut satırlar 90 günde budanır.

## Telefon push (F5) — açma adımları (kullanıcı kararı; varsayılan KAPALI)

Telefon yükü İÇERİKSİZDİR (başlık = katalog etiketi, `data` = `{bildirimId, rota, tesisId}`, gövde yok); içerik uygulama içinden oturumla çekilir. Hiçbir adım atılmazsa bugünkü davranış birebir sürer.

1. **Firebase projesi** (kullanıcı hesabıyla): Android uygulaması `com.etkiliyazilim.tekserp.yonetim`; indirilen `google-services.json` yalnız derleme makinesinde `patron/uygulama/` altına konur — REPOYA GİRMEZ (`.gitignore`; biçim örneği `google-services.example.json`). FCM sunucu kimliği Expo/EAS proje ayarına yüklenir, patron sunucusuna DEĞİL.
2. **Uygulama derlemesi (P4, kodda hazır):** `google-services.json` uygulama KÖKÜNE (`patron/uygulama/google-services.json`) konur; derleme `PATRON_NATIVE_PUSH=1 PATRON_EAS_PROJECT_ID=<EAS proje UUID'si> [EXPO_OWNER=<sahip>] npm run build:aab` ile koşulur. Değerler REPO DIŞINDA `~/.tekserp/patron-push/eas-proje.env` dosyasındadır (`PATRON_EAS_PROJECT_ID`, `EXPO_OWNER`, `EXPO_SLUG`; slug app.json `slug`ıyla aynı olmalı) — repoya sabit yazılmaz; kapı kapalı derlemede `extra.eas` ve `owner` pakete girmez. `app.config.js` (`pushKapisi`) üçü birden yoksa tek satır uyarıyla KAPALI derler; `build-aab` açık kapıda package.json Android dışlamasını derleme süresince kaldırır (çıkışta aynen geri), izin kümesine `POST_NOTIFICATIONS`/c2dm/`WAKE_LOCK` ekler ve `expo.modules.notifications` bileşeninin pakette OLDUĞUNU doğrular. Uygulama native modül bağlı değilse kapıyı kapalı sayar. İzin istemi: bulut kipinde "Profil → Bildirimler → Bu cihazda bildirimleri aç", ERP kipinde Bildirimler ekranı → "Telefon bildirimlerini aç".
3. **Gizlilik metni + Play veri güvenliği formu** güncellenir (mağaza adımı).
4. **Patron VDS:** ERP kipi (push köprüsü) için yalnız `.env` `BILDIRIM_NATIVE_PUSH=acik` + `EXPO_ERISIM_BELIRTECI_DOSYASI_HOST` (docker secret `expo_erisim_belirteci`; adımlar `PATRON-BULUTU-KURULUM.md` §4c) — `BILDIRIM_KIPI` `kapali` kalır, günlükte `PATRON_KOPRU gonderim=gercek kip=kapali birlesim=yalniz-kopru`. Bulut kipi telefon bildirimleri ayrıca `BILDIRIM_KIPI=gercek` ister (yukarıdaki adımlar). Belirteç yoksa `PATRON_KOPRU gonderim=kapali … (EXPO_ERISIM_BELIRTECI yok)` (gercek kipte ayrıca `PATRON_BILDIRIM native=kapali (…)`) ve telefona istek atılmaz.
5. Geri alma: `BILDIRIM_NATIVE_PUSH=kapali` + yeniden başlat — köprü `gonderim:"kapali"` döner (belirteç silinmez); `gercek` kipte telefon hedefi `KALICI:NATIVE_PUSH_KAPALI` olur, web push sürer.
