# Patron push köprüsü — fabrika ↔ bulut sözleşmesi (P1, 2026-11-13)

> Bulut tarafı `patron/sunucu` (uçlar `src/http/factory-routes.ts`, kapı `src/services/push-bridge-auth.ts`, servis
> `src/services/push-bridge.ts`); tel şemaları `patron/sunucu/src/wire/esitleme.ts` ↔ fabrika aynası
> `Teks-Erp/src/cloud-sync/wire/esitleme.ts` (bayt-eşit, `test_bulut_tel_aynasi`). Bekçiler `test_bildirim_koprusu`,
> `test_bildirim_koprusu_sertlik` (inceleme düzeltmeleri 2026-11-13).
> Plan ve kararlar: arşiv `docs/history/arsiv/2026-11.md` § "Patron push köprüsü P1". Fabrika tarafı P2/P3'te yazılır.

## 1. Model

Fabrika, patron telefonunun Expo belirtecini kendi DB'sinde tutar; bildirimi kendisi seçer (alıcı, tür, tercih, sessiz
saat) ve buluttan yalnız İLETMESİNİ ister. Bulut kişiyi tanımaz: tek bildiği (kurulum, belirteç ÖZETİ) bağıdır.
Ham belirteç yalnız dürt isteğinde gelir, saklanmaz. Başlık ve gövde yalnız iletilir: DB'ye, günlüğe, bilete girmez.
Bulut aboneliği ARANMAZ; lisansı geçerli her kurulum kullanır. Tesis DB'si açılmaz, yönlendirme bağı yazılmaz.

**Güvence (dar):** bir kurulum yalnız KENDİ bağladığı özetlere gönderir. Bağ sahiplik kanıtı DEĞİLDİR: ham belirteci
bilen herhangi bir geçerli kurulum onu kendine bağlayıp o telefona metin gönderebilir (bekçi `test_bildirim_koprusu_sertlik`
§14 bu sınırı bilinçli olarak sabitler). Bu yüzden ham belirteç gizli tutulmalıdır: fabrika ham belirteci şifreli saklar
(P2); bağı telefonun kanıtlaması P3'te değerlendirilir.

## 2. İstek zarfı (üç uç için ortak)

- Hepsi `POST`, `Content-Type: application/json`, sıkıştırma YOK (`Content-Encoding` varsa 400), gövde ≤ 64 KB (aşarsa 413).
- Başlık `X-TKL-Istek`: kurulum anahtarıyla imzalı istek, **amaç `bildir`** (`esitle` imzası 401 `ISTEK_AMAC`),
  `yol` = ucun tam yolu, ZORUNLU (ör. `/v1/bildirim/durt`; yolsuz imza ya da başka uç 401 `ISTEK_YOL`), gövde özeti ham
  bayttan, nonce tek kullanımlık (merkezde tutulur, 10 dk; hak ve hız denetiminden SONRA yazılır), saat sapması ≤ 10 dk (aşarsa 401 `ISTEK_ZAMAN` + `details.sunucuSaati`; bir kez düzelt, yeniden imzala).
- Gövde katı şemadır: bilinmeyen alan 400 `GOVDE_GECERSIZ`. Her gövde `v: 1` taşır.
- **Özet** = `sha256(utf8(ham Expo belirteci))`, küçük harf hex, 64 karakter (`^[0-9a-f]{64}$`).
- Belirteç biçimi `^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$`.

## 3. Uçlar

### `POST /v1/bildirim/kaydet`
İstek `{ v: 1, ozetler: Ozet[1..20] }` → `200 { v: 1, bagli: Ozet[] }`.
Bağı kurar ya da tazeler; idempotent (aynı özet iki kez → tek satır, aynı yanıt); önceki "geçersiz" işaretini kaldırır.
Kurulum başına 200 bağ tavanı: aşılırsa 409 `BAG_TAVANI` (kullanılmayanı bırak).

### `POST /v1/bildirim/birak`
İstek aynı gövde → `200 { v: 1, birakilan: n }`. Bağ silinir (yalnız bu kurulumunki); olmayan özet hata değildir.
Fabrika belirteci sildiğinde (çıkış, parola değişimi, kullanıcı pasif) çağırır.

### `POST /v1/bildirim/durt`
İstek:
```
{ v: 1, belirtecler: ExpoToken[1..20], baslik: string(1..400), govde: string(0..4000),
  data: { bildirimId: uuid, rota: "/…" | null } }
```
`rota` uygulamanın `safeRoute` desenindedir: `/bolum` ya da `/bolum/kimlik` (`^/[a-z-]+(/[A-Za-z0-9-]{1,64})?$`);
`//`, `..`, `%`, ters bölü, şema ve sorgu 400. Yanıt `200`:
```
{ v: 1, gonderim: "acik" | "kapali",
  sonuclar: [{ ozet, sonuc, kod? }], gecersiz: Ozet[] }
```
Bulut başlığı 80, gövdeyi 400 kod noktasına kırpar; C0/C1 denetim, çift yönlü denetim (U+200E/F, U+202A–202E,
U+2066–2069, U+061C), sıfır genişlikli (U+200B–200D, U+FEFF) ve satır/paragraf ayırıcı (U+2028/2029) karakterlerini siler. Telefona giden yük yalnız
başlık + gövde + ses + öncelik + `data {bildirimId, rota}` taşır (`BRIDGE_PAYLOAD_KEYS`).

| `sonuc` | Anlamı | Fabrika ne yapar |
|---|---|---|
| `GONDERILDI` | Expo bileti alındı (teslim makbuzda) | Hiçbir şey |
| `KAPALI` | Bulutta gönderim kapalı (`gonderim:"kapali"`), istek atılmadı | Belirteci SİLMEZ |
| `BAGSIZ` | Özet bu kuruluma bağlı değil, gönderilmedi | `kaydet` ile yeniden bağla |
| `GECERSIZ` | Cihaz kayıtsız (`DeviceNotRegistered`), bağ silindi | Belirteci siler |
| `GECICI` | Yeniden denenebilir (`kod` gerekçe; `SURE_DOLDU` = süre tavanı, `GONDERIM_SURUYOR` = aynı ileti şu an gidiyor) | Sonra yeniden dene (aynı `bildirimId` ile) |
| `KALICI` | Bu ileti gönderilemez (`kod` gerekçe) | Yeniden deneme |

`gecersiz` listesi bilette ve önceki makbuz turunda kayıtsız çıkan özetleri taşır; fabrika hepsini siler.

**Gönderim süresi ve yineleme.** Bulut belirteçleri tek toplu Expo isteğinde gönderir (taşıyıcı toplu değilse sıralı);
tek dürtün gönderim süresi `KOPRU_DURT_SURE_SN` (20 sn) ile sınırlıdır, dolunca kalanlar `GECICI SURE_DOLDU`. Aynı
(kurulum, `bildirimId`, özet) 10 dk içinde ikinci kez GÖNDERİLMEZ, sonuç `GONDERILDI` — fabrika yeniden denemeyi aynı
`bildirimId` ile yapar. Yineleme belleği SÜREÇ İÇİDİR (en çok 50 000 kayıt, en eskisi düşer): bulut yeniden başlarsa
ya da kayıt düşerse yineleme yeniden gönderir (çift bildirim olasılığı kabul; ileti teslim garantili değildir).

## 4. Hata kodları (`details.code`; `body.code` yok)

| HTTP | Kod | Durum |
|---|---|---|
| 400 | `GOVDE_GECERSIZ` | Şema dışı gövde, 20'den çok belirteç/özet, sıkıştırılmış gövde |
| 413 | `PAKET_BUYUK` | Gövde 64 KB üstü |
| 401 | `ISTEK_GECERSIZ` · `ISTEK_AMAC` · `ISTEK_YOL` · `ISTEK_ZAMAN` · `ISTEK_KID` · `ISTEK_GOVDE_OZETI` | İmza zarfı |
| 401 | `KURULUM_BILINMIYOR` | Kurulum ya da anahtar dizinde yok (yalnız satıcının cevabı; bütçe/erişim sorunu 503) |
| 403 | `LISANS_GECERSIZ` | Lisans geçerli değil (bkz. §5) |
| 403 | `SINIF_GONDEREMEZ` | Lisans sınıfı gönderemez (TEST · DR · BAYİ) |
| 409 | `ISTEK_TEKRAR` | Aynı nonce ikinci kez — yeni nonce ile yeniden imzala |
| 409 | `BAG_TAVANI` | Kurulum başına 200 bağ doldu |
| 429 | `HIZ_SINIRI` | Dakikalık tavan aşıldı; `details.retryAfterSn` kadar bekle |
| 503 | `TEKRAR_DENEYIN` | Lisans sunucusuna ulaşılamıyor, köprünün satıcı sorgu bütçesi doldu ya da bellek kaydı `KOPRU_BAYAT_AZAMI_SAAT`ten yaşlı; belirsiz hata, aynı mantıksal deneme yeni imzayla tekrarlanır |

## 5. Lisans ve sınırlar

- **Lisans geçerli** = satıcı kaydında `aktif` ∧ `durum = ETKIN` ∧ devredilmemiş ∧ sınıf üretim / barındırılan / demo.
  Bitiş tarihi bakılmaz (satıcı `durum`u tek kaynaktır; lisans kapısı fabrikayı aniden durdurmaz).
- Hız: kurulum başına dakikada 120 dürt (`KOPRU_DURT_DK`), kaydet + bırak dakikada 60; istekte en çok 20 belirteç/özet.
  Tavan imza + hak denetiminden sonra, nonce'tan önce sayılır: gövdesi bozuk (400) istek de tavandan düşer.
- Kurulum dizini: köprünün satıcı sorgu bütçesi eşitlemeden AYRIDIR (`KOPRU_SORGU_BUTCE_DK`, 60/dk); dolunca 503.
  Satıcıya ulaşılamazken bellek kaydı en çok `KOPRU_BAYAT_AZAMI_SAAT` (24 sa) kullanılır, sonra 503.
- Bağ: kurulum başına 200; bağlar yaşa göre budanmaz (fabrikanın `birak`ı ve kayıtsız cihaz siler). Eşzamanlı `kaydet`ler
  kurulumun var olan bağlarını kilitleyerek sıraya girer; sıfır bağdan başlayan eşzamanlı yarış tavanı en çok
  (eşzamanlı istek × 20) aşabilir — dakikalık 60 tavanıyla sınırlı, bir kez (sonraki her kaydet 409).
- Nonce 10 dk; dakikalık bakım tikinde budanır. Bilet (makbuz yoklaması) sonuçlanınca ya da 2 gün sonra budanır.
- Kilit ekranında tam metin kullanıcı kararıdır; metin Expo/Google'dan geçer, bulut saklamaz.

## 6. Fabrika tarafı (P2, 2026-11-13)

- Uçlar `POST/DELETE /api/bildirim/cihaz` (`Teks-Erp/src/routes/patron-push.routes.ts`): yalnız patron oturumu
  (`clientType: "patron"`) + `patron-app:login`, yalnız kendi adına. Tablo `patron_push_tokens`; ham belirteç kısa
  kimlik halkasıyla sarılı (`ptk1:`), halka yoksa 503 `PUSH_ANAHTAR_YOK`; yanıt/günlük/audit ham ya da özet taşımaz.
- Kapı: `bildirim.patronPushEnabled` ∧ `bildirim.gelenKutusuEnabled` (`patronPushGateOpen`); kapalıyken POST 409
  `PATRON_PUSH_KAPALI`, `/auth/me` `patronPush` 0, iş dışarı istek atmaz. DELETE kapıdan bağımsız başarılıdır.
- Kayıt `clientToken` taşımaz: belirteç özeti UNIQUE doğal anahtardır, aynı belirteç tekrar gelirse aynı satır güncellenir.
- Kullanıcı başına 10 canlı cihaz; aşan EN ESKİ (son görülme) bırakılır. Belirteç oturumuyla yaşar (çıkış, parola,
  pasif, süre dolumu → bırakılır). `kaydet`/`birak` yalnız 30 sn'lik işte (`jobs/patron-push.job.ts`), hata geri çekilir.
