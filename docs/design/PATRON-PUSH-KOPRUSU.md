# Patron push köprüsü — fabrika ↔ bulut sözleşmesi (P1, 2026-11-13)

> Bulut tarafı `patron/sunucu` (uçlar `src/http/factory-routes.ts`, kapı `src/services/push-bridge-auth.ts`, servis
> `src/services/push-bridge.ts`); tel şemaları `patron/sunucu/src/wire/esitleme.ts` ↔ fabrika aynası
> `Teks-Erp/src/cloud-sync/wire/esitleme.ts` (bayt-eşit, `test_bulut_tel_aynasi`). Bekçi `test_bildirim_koprusu`.
> Plan ve kararlar: arşiv `docs/history/arsiv/2026-11.md` § "Patron push köprüsü P1". Fabrika tarafı P2/P3'te yazılır.

## 1. Model

Fabrika, patron telefonunun Expo belirtecini kendi DB'sinde tutar; bildirimi kendisi seçer (alıcı, tür, tercih, sessiz
saat) ve buluttan yalnız İLETMESİNİ ister. Bulut kişiyi tanımaz: tek bildiği (kurulum, belirteç ÖZETİ) bağıdır.
Ham belirteç yalnız dürt isteğinde gelir, saklanmaz. Başlık ve gövde yalnız iletilir: DB'ye, günlüğe, bilete girmez.
Bulut aboneliği ARANMAZ; lisansı geçerli her kurulum kullanır. Tesis DB'si açılmaz, yönlendirme bağı yazılmaz.

## 2. İstek zarfı (üç uç için ortak)

- Hepsi `POST`, `Content-Type: application/json`, sıkıştırma YOK (`Content-Encoding` varsa 400), gövde ≤ 64 KB (aşarsa 413).
- Başlık `X-TKL-Istek`: kurulum anahtarıyla imzalı istek, **amaç `bildir`** (`esitle` imzası 401 `ISTEK_AMAC`),
  `yol` = ucun tam yolu (ör. `/v1/bildirim/durt`; başka uç 401 `ISTEK_YOL`), gövde özeti ham bayttan, nonce tek kullanımlık
  (merkezde tutulur, 10 dk), saat sapması ≤ 10 dk (aşarsa 401 `ISTEK_ZAMAN` + `details.sunucuSaati`; bir kez düzelt, yeniden imzala).
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
`rota` tek `/` ile başlar, `//` ve dış adres yok, ≤ 200 karakter. Yanıt `200`:
```
{ v: 1, gonderim: "acik" | "kapali",
  sonuclar: [{ ozet, sonuc, kod? }], gecersiz: Ozet[] }
```
Bulut başlığı 80, gövdeyi 400 kod noktasına kırpar; denetim ve yön karakterlerini siler. Telefona giden yük yalnız
başlık + gövde + ses + öncelik + `data {bildirimId, rota}` taşır (`BRIDGE_PAYLOAD_KEYS`).

| `sonuc` | Anlamı | Fabrika ne yapar |
|---|---|---|
| `GONDERILDI` | Expo bileti alındı (teslim makbuzda) | Hiçbir şey |
| `KAPALI` | Bulutta gönderim kapalı (`gonderim:"kapali"`), istek atılmadı | Belirteci SİLMEZ |
| `BAGSIZ` | Özet bu kuruluma bağlı değil, gönderilmedi | `kaydet` ile yeniden bağla |
| `GECERSIZ` | Cihaz kayıtsız (`DeviceNotRegistered`), bağ silindi | Belirteci siler |
| `GECICI` | Yeniden denenebilir (`kod` gerekçe) | Sonra yeniden dene |
| `KALICI` | Bu ileti gönderilemez (`kod` gerekçe) | Yeniden deneme |

`gecersiz` listesi bilette ve önceki makbuz turunda kayıtsız çıkan özetleri taşır; fabrika hepsini siler.

## 4. Hata kodları (`details.code`; `body.code` yok)

| HTTP | Kod | Durum |
|---|---|---|
| 400 | `GOVDE_GECERSIZ` | Şema dışı gövde, 20'den çok belirteç/özet, sıkıştırılmış gövde |
| 413 | `PAKET_BUYUK` | Gövde 64 KB üstü |
| 401 | `ISTEK_GECERSIZ` · `ISTEK_AMAC` · `ISTEK_YOL` · `ISTEK_ZAMAN` · `ISTEK_KID` · `ISTEK_GOVDE_OZETI` | İmza zarfı |
| 401 | `KURULUM_BILINMIYOR` | Kurulum ya da anahtar dizinde yok |
| 403 | `LISANS_GECERSIZ` | Lisans geçerli değil (bkz. §5) |
| 403 | `SINIF_GONDEREMEZ` | Lisans sınıfı gönderemez (TEST · DR · BAYİ) |
| 409 | `ISTEK_TEKRAR` | Aynı nonce ikinci kez — yeni nonce ile yeniden imzala |
| 409 | `BAG_TAVANI` | Kurulum başına 200 bağ doldu |
| 429 | `HIZ_SINIRI` | Dakikalık tavan aşıldı; `details.retryAfterSn` kadar bekle |
| 503 | `TEKRAR_DENEYIN` | Lisans sunucusuna ulaşılamıyor; belirsiz hata, aynı mantıksal deneme yeni imzayla tekrarlanır |

## 5. Lisans ve sınırlar

- **Lisans geçerli** = satıcı kaydında `aktif` ∧ `durum = ETKIN` ∧ devredilmemiş ∧ sınıf üretim / barındırılan / demo.
  Bitiş tarihi bakılmaz (satıcı `durum`u tek kaynaktır; lisans kapısı fabrikayı aniden durdurmaz).
- Hız: kurulum başına dakikada 120 dürt (`KOPRU_DURT_DK`), kaydet + bırak dakikada 60; istekte en çok 20 belirteç/özet.
- Bağ: kurulum başına 200; bağlar yaşa göre budanmaz (fabrikanın `birak`ı ve kayıtsız cihaz siler).
- Nonce 10 dk, bilet (makbuz yoklaması) sonuçlanınca ya da 2 gün sonra budanır.
- Kilit ekranında tam metin kullanıcı kararıdır; metin Expo/Google'dan geçer, bulut saklamaz.
