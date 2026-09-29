# Patron bildirimleri — canlı gönderim denemesi (runbook)

> Kural kaynağı: `docs/kurallar/patron-bulutu.md` § Bildirimler (B5) · sunucu: `patron/sunucu/CLAUDE.md` § Bildirimler.
> Yerelde gerçek gönderim DENENMEZ (bekçiler sahte taşıyıcıyla koşar). Bu runbook yalnız şu ön koşullar tamamken koşulur:
> Apple/Google mağaza hesapları + Expo projesi (EAS) · patron bulutu VDS kurulumu · kullanıcının "canlı dene" cümlesi.

## Ön koşul

1. Patron uygulaması EAS ile derlenmiş (iOS/Android push izni `expo-notifications`; Expo proje kimliği `app.json` → `extra.eas.projectId`).
2. VDS'teki patron sunucusu `ANAHTAR_DIZINI` 0700; `patron-vapid.json` ilk açılışta üretilir (0600) — ÜSTÜNE YAZILMAZ, yedeklenir (kaybı = bütün web aboneliklerinin yenilenmesi).
3. `.env` (0600): `BILDIRIM_KIPI=gercek` · `BILDIRIM_VAPID_KONU=mailto:<destek adresi>` · isteğe bağlı `EXPO_ERISIM_BELIRTECI` (sır; günlüğe yazılmaz).

## Adımlar

1. Önce `BILDIRIM_KIPI=sahte` ile aç: `PATRON_BILDIRIM kip=sahte` satırı · `GET /api/bildirim/ayarlar` → `gonderim: "sahte"`, `webPushAnahtari` dolu.
2. Test tesisinde (URETIM + `patron-bulut`) bir hesapla telefondan giriş → Profil → Bildirimler → izin ver; `GET /api/cihazlar` cihazı gösterir.
3. `BILDIRIM_KIPI=gercek`e al, sunucuyu yeniden başlat; tesis ayarında geciken sipariş eşiğini 0 yap, fabrikadan termini geçmiş bir kalemle eşitleme gelsin.
4. Beklenen: bir tur içinde (`BILDIRIM_ARALIGI_SN`) telefonda "Geciken sipariş"; dokununca Siparişler ekranı. `notifications` satırı `GONDERILDI`, `deliveries` `OK`.
5. Sessiz saat: pencereyi şimdiye kur → satır `BEKLIYOR` ve `next_attempt_at` = bitiş; bitişte gider.
6. Web: tarayıcıda (iOS'ta 16.4+ ve ana ekrana eklenmiş) aynı akış.

## Geri alma

`BILDIRIM_KIPI=kapali` + yeniden başlat: iş kurulmaz, kuyruk birikmez; mevcut satırlar 90 günde budanır.
