# Makine kartı protokolü — duruş bildirimi (donanım ekibi için)

> Sözleşme kaynağı: `Teks-Erp/src/middlewares/collector-auth.middleware.ts` (imza doğrulayıcısı),
> `Teks-Erp/src/services/helpers/collector-secret.helper.ts` (imza girdisi), `Teks-Erp/src/routes/machine-signal.routes.ts`
> (uçlar). Bekçi: `Teks-Erp/scripts/test_makine_durus_kart.ts`. Bu belge ile kod ayrışırsa KOD esastır; belge düzeltilir.

## 1. Ağ

- Kart fabrika LAN'ında sunucuya **HTTPS 4443** üzerinden konuşur (sabitli LAN TLS: sunucu sertifikasının SHA-256
  parmak izi karta kurulumda yazılır, kart başka sertifikayı kabul etmez). Fabrikaya dışarıdan GELEN port yoktur;
  kart yalnız istek gönderir.
- Kart oturum açmaz, kullanıcı değildir. Her istek kendi imzasını taşır.

## 2. Kimlik — kayıt

- Kart panelde (Tezgah → makine kartları; bugün uç `POST /api/machine-collectors`, izin `loom:spec-manage`)
  kaydedilir: ad, kart tipi (`collectorType`, örn. `TEKS-ESP32-V1` — ham kodların anlamı buna bağlıdır), bağlı
  tezgahlar. Bir tezgah yalnız TEK karta bağlanır.
- Kayıt cevabı `collector.id` (UUID) ve `secret` (64 onaltılık karakter = 32 bayt) döner. **Sır yalnız bu cevapta
  gösterilir**; kaybolursa `POST /api/machine-collectors/{id}/rotate-secret` yeni sır üretir ve eskisi o an geçersiz
  olur. Kart iptali: `POST /api/machine-collectors/{id}/revoke`.
- Sunucu sırrı saklamaz: yalnız rastgele bir tohum saklar ve sırrı kendi anahtar halkasıyla yeniden türetir.

## 3. İstek imzası

Dört başlık, hepsi zorunlu:

| Başlık | Değer |
|---|---|
| `x-collector-id` | kartın `collector.id` UUID'si |
| `x-collector-timestamp` | Unix zamanı, **saniye** (tam sayı). Sunucu saatinden en çok ±300 sn sapabilir |
| `x-collector-nonce` | her istekte YENİ, 16–64 karakter `[A-Za-z0-9_-]` (örn. 32 hex). Aynı nonce 10 dk içinde ikinci kez kabul edilmez |
| `x-collector-signature` | aşağıdaki girdinin HMAC-SHA256'sı, küçük harf hex (64 karakter) |

İmza anahtarı: `secret`in hex çözülmüş 32 baytı. İmzalanan girdi, satır sonu (`\n`, 0x0A) ile birleştirilmiş beş
parça:

```
POST
/api/machine-signals/stop
<x-collector-timestamp>
<x-collector-nonce>
<gövdenin ham baytlarının SHA-256'sı, küçük harf hex>
```

- Yol sorgu dizgesi içermez. Gövde, telden giden baytların AYNISI olmalıdır (imzadan sonra yeniden biçimlendirme
  imzayı bozar). `Content-Type: application/json`.
- Saat: kart NTP ile ya da sunucunun `401 COLLECTOR_CLOCK_SKEW` cevabındaki `details.serverTime` (Unix sn) ile
  saatini düzeltir.

## 4. Uçlar

### `POST /api/machine-signals/stop` — duruş başladı

```json
{ "machineId": "<tezgah UUID>", "stopKey": "<kartın ürettiği UUID>", "rawStopCode": "E-17",
  "signalKind": "WARP_STOP", "startedAt": "2026-10-12T08:15:00Z" }
```

- `stopKey` duruşun kimliğidir: kart duruşu ilk gördüğünde üretir, açılış, tekrar ve kapanışta AYNI değer gider.
  Cevap gelmezse (ağ hatası, zaman aşımı, 5xx) aynı `stopKey` ile yeniden gönderilir — ikinci satır doğmaz. Kesin
  4xx cevabında yeniden gönderilmez.
- `rawStopCode` (≤32, isteğe bağlı) kontrolcünün ham kodudur, çevrilmeden saklanır; kart tipi + kod eşlemesi varsa
  sebep sunucuda yazılır, yoksa duruş sebepsiz açılır ve operatör sebebi girer. `signalKind` isteğe bağlı
  (`WARP_STOP`, `WEFT_STOP`, `RUN_CONTACT`… — `MachineSignalKind`).
- Kaynak gövdeden ALINMAZ (`source` alanı 400); kart duruşları daima `MACHINE` yazılır.
- Cevaplar: `201` açıldı · `200` aynı `stopKey` tekrarı ya da operatörün açık duruşu karta geçti (aşağıda) ·
  `409 STOP_ALREADY_OPEN` tezgahta kartın kendi başka açık duruşu var · `409 CLIENT_TOKEN_COLLISION` aynı `stopKey`
  başka yükle.
- **Operatör önce bildirdiyse:** tezgahta operatörün açtığı açık duruş varsa kart onu SAHİPLENİR — başlangıç
  operatörünki kalır, kart kodu ve (eşleşirse) sebep yazılır, kapanışı kart yapar. Operatörün girdiği sebep varsa
  o kalır.

### `POST /api/machine-signals/end` — duruş bitti

```json
{ "machineId": "<tezgah UUID>", "stopKey": "<açılıştaki UUID>", "endedAt": "2026-10-12T08:43:00Z" }
```

- `200` kapandı ya da aynı bitişin tekrarı · `409 STOP_CLOSED_BY_OPERATOR` operatör "Çalıştı" demiş, kapanışı
  korunur (kart bunu bilgi olarak alır, yeniden denemez) · `409 STOP_END_CONFLICT` başka bir bitişle kapanmış ·
  `404 STOP_NOT_FOUND` bu anahtarla açılış yok · `400 STOP_END_BEFORE_START`.

### `POST /api/machine-signals/heartbeat` — nabız

Gövde `{}` (alan taşımaz). Kart duruş olmasa da en çok birkaç dakikada bir gönderir; sunucu `tezgah.collectorSilenceMinutes`
(varsayılan 10 dk) boyunca hiçbir geçerli istek görmezse kartı "sessiz" sayar (uyarı — duruş açılmaz). Her geçerli imzalı
istek (duruş, bitiş, nabız) kartı canlı sayar. Cevap `200 { data: { serverTime } }` (Unix sn).

### Uzun açık duruş (watchdog)

Kartın açtığı duruş `tezgah.maxOpenStopHours` (varsayılan 12 sa) içinde kapanmazsa sunucu onu GEÇİCİ kapatır
(`endSource: WATCHDOG`, bitiş = başlangıç + eşik). Kartın sonradan gönderdiği `end` bunu BİR KEZ düzeltir (`200`); aynı
bitişin tekrarı `200`, başka bitiş `409 STOP_END_CONFLICT`. Vardiya karnesi mühürlüyse `409 SHIFT_SEALED`
(`details.lateEndQueued: true`): bitiş sunucuda bekletilir, mühür açılınca uygulanır — kart yeniden göndermez. Gerçek
bitiş tezgahta sonradan açılmış başka bir duruşa taşıyorsa `409 STOP_OVERLAP`.

### Ortak hata cevapları

| Kod | Anlam | Kart ne yapar |
|---|---|---|
| `401 COLLECTOR_AUTH_HEADERS` | başlık eksik/biçimsiz | yazılım hatası — yeniden denemez |
| `401 COLLECTOR_CLOCK_SKEW` | damga ±5 dk dışı | saati `serverTime` ile düzeltir, yeni nonce ile yeniden imzalar |
| `401 COLLECTOR_NONCE_REPLAY` | nonce daha önce kullanılmış | yeni nonce ile yeniden imzalar |
| `401 COLLECTOR_AUTH_FAILED` | kart tanınmıyor / iptal / sır yanlış / imza tutmuyor | durur, yöneticiye bildirir |
| `403 MACHINE_NOT_IN_SCOPE` | tezgah bu karta bağlı değil | yapılandırma hatası — durur |
| `403 MODULE_DISABLED` | tezgah izleme modülü kapalı | bekler |
| `429 COLLECTOR_RATE_LIMITED` | kart başına dakikada 600 istek aşıldı | geri çekilir |
| `400` (Zod) | gövdede tanınmayan alan / biçim / damga aralık dışı (`STOP_STAMP_OUT_OF_RANGE`: 36 sa geri · 5 dk ileri) | yazılım hatası |

Ağ hatası, zaman aşımı ve 5xx'te kart aynı gövdeyi (aynı `stopKey`) **yeni zaman damgası ve yeni nonce** ile
yeniden imzalayıp gönderir.

## 5. Örnek (sınama vektörü)

Örnek değerler — gerçek kurulumda kullanılmaz:

- `secret` = `000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
- `x-collector-timestamp` = `1791620100` · `x-collector-nonce` = `a1b2c3d4e5f60718293a4b5c6d7e8f90`
- gövde (tek satır, boşluksuz):
  `{"machineId":"7b0c2f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f","stopKey":"3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c","rawStopCode":"E-17","signalKind":"WARP_STOP","startedAt":"2026-10-12T08:15:00Z"}`
- gövde SHA-256 = `62ca44c8911f0f7cb4686070f84e76589a9a3192fb7a7548c99b94b1af054bbe`
- imza = `d11b7c7c3f59095453c9eb76d06e93c4e1e545830d31a6fe09dae535ff6e0a51`

```
POST /api/machine-signals/stop HTTP/1.1
Host: <sunucu>:4443
Content-Type: application/json
x-collector-id: <collector.id>
x-collector-timestamp: 1791620100
x-collector-nonce: a1b2c3d4e5f60718293a4b5c6d7e8f90
x-collector-signature: d11b7c7c3f59095453c9eb76d06e93c4e1e545830d31a6fe09dae535ff6e0a51

{"machineId":"7b0c2f4e-…","stopKey":"3f2a1b0c-…", …}
```

## 6. Kapsam dışı (sonraki dilimler)

- Panel ekranları: kart kaydı, kod eşleme, kaynak
  rozeti, "Sebepsiz duruşta alarm" kapalıysa devreye alma uyarısı (D5) · toplu (çok kalemli) gönderim · sayaç
  telemetrisi. Backend'e seri port / donanım kodu girmez; kartın donanım tarafı bu belgenin dışındadır.
