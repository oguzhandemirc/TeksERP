# Etkili Destek entegrasyonu — patron BULUTU: yapılandırma, dağıtım ve uç sözleşmesi

> Patron telefon uygulaması dilimi YALNIZ bu belgeye bakarak yazılabilsin diye yazıldı. Sır içermez: API anahtarı, webhook
> sırrı ve merkez adresi kurulum kılavuzundadır, repoya girmez. Fabrika (panel + saha) sözleşmesi: fabrika destek belgesi (DESTEK-ENTEGRASYONU, backend + panel dilimiyle gelir).
> Kod: `patron/sunucu/src/http/destek-routes.ts` · `src/services/destek/` (`config` · `destek.service` · `webhook.service` ·
> `transport` · `attachments` · `codes` · `dedupe`) · hazır istemci kopyası `src/integrations/destek/` (fabrikayla bayt-eşit,
> `KAYNAK.md`). Bekçi: `patron/sunucu/scripts/test_destek_bulut.ts` (+ dağıtım: `test_compose_sirlari.ts`).

## 1. Akış

```
Patron uygulaması ──(patron oturumu, Bearer)──▶ bulut /api/destek/*  ── kimlik OTURUMDAN ──▶ Etkili Destek merkezi
                                                                       (imzalı HTTPS, doğrudan fetch)
Etkili Destek merkezi ──(imzalı webhook)──▶ bulut POST /api/destek/webhook ──▶ push "Destek yanıtı" (tesisin hesapları)
```

- Uygulama merkeze doğrudan gitmez; anahtar yalnız bulut kapsayıcısındaki sır dosyasındadır.
- Talepler merkezde durur; bulutta tablo/kopya YOK, **göç YOK** (bulut hesap yapmaz, yalnız aktarır).
- Talep açma / yanıt / kapatma `account_audit`e iz bırakır (`DESTEK_TALEP_ACILDI` · `DESTEK_YANIT_YAZILDI` ·
  `DESTEK_TALEP_KAPATILDI`; yükte talep no / tür / durum — mesaj metni ve dosya YOK).
- Webhook YALNIZ bulutta vardır (fabrikaya gelen port açılmaz); fabrika istemcileri rozet yoklamasıyla çalışır.

## 2. Yapılandırma (kapatma düğmesi)

| Değişken | Kaynak (VDS) | Anlamı |
|---|---|---|
| `DESTEK_API_URL` | `/opt/stack/apps/tekserp-patron-uretim/.env` → compose ortamı | Merkez taban adresi, HTTPS zorunlu (düz HTTP yalnız `127.0.0.1`/`localhost`/`[::1]` test merkezi) |
| `DESTEK_API_KEY_DOSYASI` | sır `destek_api_anahtari` → `patron-baslat.sh` | `dst_live_…`/`dst_test_…` biçimli anahtar dosyası (0440/0400) |
| `DESTEK_WEBHOOK_SECRET_DOSYASI` | sır `destek_webhook_sirri` → `patron-baslat.sh` | `whsec_…` biçimli webhook sırrı dosyası |

- Varsayılan KAPALI (= bugünkü davranış). Adres + anahtar geçerliyse destek uçları AÇIK; değilse `/api/destek/*`
  403 `MODULE_DISABLED` ve merkeze HİÇBİR istek gitmez (açılışta da ping yok). Webhook sırrı yoksa webhook 404.
- Biçimsiz/boş/herkese okunur değer açılışı DURDURMAZ: özellik kapalı sayılır, açılış günlüğüne tek satır neden yazılır
  (`[patron] destek: uçlar KAPALI (DESTEK_API_URL yok) · webhook KAPALI (…)`); sırrın kendisi hiçbir çıktıya girmez.
- Ortamdan doğrudan değer (`DESTEK_API_KEY`, `DESTEK_WEBHOOK_SECRET`) yalnız yerel geliştirmede; değer ile `_DOSYASI`
  birlikte verilirse belirsiz → KAPALI.
- Merkez kimliği: firma = lisans HAK'ındaki tesis kimliği (`hak.tesis.id`; bulutta oturumun `tesisId`'si, `services/destek/config.ts`
  `supportTenantId`). Müşteri sabiti DEĞİL; fabrika backend'i aynı değeri kendi lisansından okur → panelden ve telefondan açılan
  talepler aynı firmadadır. Tesis başına ayrı DB mimarisiyle birebir: her tesis merkezde ayrı firma.
- Zaman aşımları: normal 15 sn · ekli istek 60 sn · rozet 5 sn. Merkez erişilemezken yalnız destek uçları hata döner.

## 3. VDS dağıtım adımları (her komut ÖNCE kullanıcıya gösterilir)

Göç YOK, kenar (Traefik/Cloudflare) değişikliği YOK (`/api/*` zaten geçer). Yeni imaj gerekir (kod bu imajla gelir).

1. Yeni imaj (`deploy/patron/imaj-derle.sh`) → `docker load`. Sırlar olmadan `docker compose up -d patron`:
   compose iki sırrı `/dev/null`a bağlar → günlükte `destek: uçlar KAPALI … · webhook KAPALI …`, api bugünkü gibi.
2. Sır dosyaları (değer kılavuzdan, ekrana/geçmişe basmadan):
   `/opt/stack/apps/tekserp-patron-uretim/sirlar/destek-api-anahtari` ve `/opt/stack/apps/tekserp-patron-uretim/sirlar/destek-webhook-sirri` →
   `sudo chown root:<SIR_GID> … && sudo chmod 0440 …`.
3. `/opt/stack/apps/tekserp-patron-uretim/.env`e (yalnız adres ve yol; sır değil):
   ```
   DESTEK_API_URL=https://<destek merkezi>/api/v1/integration
   DESTEK_API_ANAHTARI_DOSYASI_HOST=/opt/stack/apps/tekserp-patron-uretim/sirlar/destek-api-anahtari
   DESTEK_WEBHOOK_SIRRI_DOSYASI_HOST=/opt/stack/apps/tekserp-patron-uretim/sirlar/destek-webhook-sirri
   ```
4. `docker compose up -d patron` → `docker compose logs patron | grep destek` → `destek: uçlar AÇIK · webhook AÇIK`.
5. Merkez paneline webhook adresi: **`https://{bulut alan adı}/api/destek/webhook`**; panelden "ping" gönder →
   200 `{alindi:true, tur:"ping"}` (push üretmez).
6. Push'un gerçekten gitmesi için ayrıca bkz. §9 (`BILDIRIM_KIPI` varsayılanı `kapali`).
7. Geri dönüş: `.env`ten üç satırı sil → `docker compose up -d patron` (tek ayar; silinecek veri yok).

## 4. Ortak kurallar (istemci için)

- **Taban:** `https://{bulut alan adı}/api/destek`. Bütün uçlar mevcut patron oturumuyla çağrılır:
  `Authorization: Bearer <oturum belirteci>` (`POST /api/oturum/ac` ile alınan; biçim `<22>.<43>` base64url). Çerez yok.
  Oturumsuz/düşmüş → 401 `OTURUM_YOK` (mevcut 401 akışı). İzin kodu YOK: her patron hesabı firma yöneticisidir.
- **Yazma** (POST) her zaman `Content-Type: application/json` taşır; gövdesi olmayan uçlar da `{}` gönderir
  (başlıksız yazma 400 `GOVDE_GECERSIZ`).
- **Kimlik gövdeden ALINMAZ.** Merkeze giden kimlik: `user.id` = bulut hesabının kimliği (bulut hesabı UUID'si; fabrika
  `users.id`'den AYRI — patron firma yöneticisi olduğundan paneldeki talepleri de `scope=tenant` ile görür), `name` = hesabın görünen adı, `role` = `Yönetici`, `isTenantAdmin` = true;
  firma = tesis kimliği + tesis adı. Gövde KATIdır: `user`, `tenant` gibi tanınmayan alan 400 `GOVDE_GECERSIZ` (merkeze gidilmez).
- **Sunucunun eklediği bağlam:** `context.productVersion` = fabrikanın son eşitlenen sürümü; `context.technical.clientKind`
  = `"patron"`. İstemcinin `productVersion`/`appVersion`ı kabul edilir ama yok sayılır; uygulama sürümü
  `context.client.appVersion` alanında gönderilir. IP gönderilmez.
- **Zarf:** başarı `{ "success": true, "data": … }`. Hata `{ "success": false, "message": "<Türkçe>", "details": { "code": "<KOD>", … } }`
  — kod HER ZAMAN `details.code` altında. Doğrulama hatası da aynı zarftır: 400 `GOVDE_GECERSIZ`, mesaj alanı söyler
  (`errors[]` dizisi YOK).
- **`message`** 4xx'te kullanıcıya gösterilebilir Türkçedir (merkezin kendi mesajı aynen taşınır); karar `details.code` ile.
- **Tarihler** ISO 8601 UTC. **Kimlikler** (`:id`) UUID; UUID olmayan değer merkeze gitmeden **404 `BULUNAMADI`**.
- **Genel hız sınırı:** `/api` IP başına 600/dk → 429 `HIZ_SINIRI` (merkezin 429'u ayrıdır: `RATE_LIMITED`).

### Ekler (dosya)

Multipart YOK; ekler JSON içinde base64:

```json
"files": [ { "name": "ekran.png", "contentType": "image/png", "dataBase64": "iVBORw0KGgo..." } ]
```

- En çok 5 dosya, dosya başına 10 MB (çözülmüş bayt); tür `image/png` · `image/jpeg` · `image/webp` · `image/gif` · `application/pdf`.
- `dataBase64` düz base64 (`data:` öneki YOK; boşluk/satır sonu temizlenir). İlk baytlar bildirilen türle karşılaştırılır.
  Dosya adındaki klasör yolu ve denetim karakterleri atılır.
- Ekli iki uçta (talep aç · yanıt yaz) gövde sınırı 70 MB, **aynı anda tek ekli istek** okunur: ikinci eşzamanlı ekli istek
  429 `RATE_LIMITED` + `Retry-After: 10` (`retryAfterSec: 10`). Diğer uçlarda genel 256 KB sınırı.
- Merkez görselleri küçültüp çoğunlukla WebP'ye çevirir: yanıttaki ekin `name`/`mime`/`size`ı farklı olabilir.

| Hata | HTTP | `details.code` |
|---|---|---|
| Tür izinsiz / base64 bozuk / içerik türle uyuşmuyor / boş | 400 | `ATTACHMENT_INVALID` (+ `index`, 0 tabanlı) |
| Dosya 10 MB'tan büyük | 400 | `ATTACHMENT_TOO_LARGE` (+ `index`) |
| 6+ dosya | 400 | `GOVDE_GECERSIZ` (mesaj `files`) |
| Gövde 70 MB'ı (ekli olmayan uçta 256 KB'ı) aştı | 413 | `PAKET_BUYUK` |

## 5. Hata eşlemesi (bütün uçlar)

| Durum | HTTP | `details.code` | İstemci ne yapar |
|---|---|---|---|
| Özellik kapalı | 403 | `MODULE_DISABLED` (`modul: "destek"`) | Destek girişini gizle (`/durum` ile önceden bilinir) |
| Oturum yok/düşmüş | 401 | `OTURUM_YOK` | Mevcut 401 akışı |
| Gövde/sorgu sözleşmeye uymuyor | 400 | `GOVDE_GECERSIZ` | `message`'ı göster |
| `:id` UUID değil | 404 | `BULUNAMADI` | "Talep bulunamadı" |
| Merkez doğrulama hatası | 400 | merkezin kodu: `VALIDATION_FAILED` · `MESSAGE_EMPTY` · `SUBJECT_EMPTY` · `MESSAGE_TOO_LONG` · `TICKET_TYPE_INVALID` · `IDENTITY_INVALID` · `CONTEXT_INVALID` · `CONTEXT_TOO_LARGE` · `ATTACHMENT_INVALID` · `ATTACHMENT_TOO_LARGE` · `TOO_MANY_ATTACHMENTS` | `message`'ı göster |
| Merkez erişim reddi | 403 | `FORBIDDEN` | "Bu talebe erişiminiz yok" |
| Talep/ek yok | 404 | `NOT_FOUND` | "Talep bulunamadı" |
| Kapanıştan 14 gün geçmiş talebe yanıt | 409 | `REOPEN_WINDOW_EXPIRED` | "Yeni talep aç" öner |
| Ekin saklama süresi doldu | 410 | `ATTACHMENT_EXPIRED` | "Ek süresi dolduğu için silindi · ad · boyut" |
| Merkez gövde sınırı | 413 | `PAYLOAD_TOO_LARGE` | Daha küçük dosya |
| Merkez hız sınırı / eşzamanlı ekli istek | 429 + `Retry-After` (sn) | `RATE_LIMITED` (+ `retryAfterSec`) | Belirtilen süre bekle |
| Merkez 5xx / ağ hatası / `REPLAYED` | 502 | `DESTEK_ULASILAMADI` (+ `merkezKodu`) | "Destek merkezine ulaşılamadı"; tekrar denenebilir |
| Merkez zaman aşımı | 504 | `DESTEK_ZAMAN_ASIMI` | Aynı; talep açmada AYNI `clientToken` ile tekrar dene |
| Merkez anahtarı/imzayı reddetti (401, `INSTALLATION_INACTIVE`) | 502 | `DESTEK_YAPILANDIRMA` (+ `merkezKodu`) | "Sistem yöneticinize bildirin"; oturumu KAPATMA |
| Merkezin tanımadığımız 4xx kodu | merkezin 4xx'i | `DESTEK_HATASI` (+ `merkezKodu`) | `message`'ı göster |

Rozet ucunda (`/okunmamis`) 502/504/429 sessizce yutulabilir: rozet eski değerinde kalır.

## 6. Uçlar

Talep türleri: `BUG` (Hata) · `QUESTION` (Soru) · `REQUEST` (İstek). Durumlar: `NEW` Yeni · `IN_PROGRESS` İnceleniyor ·
`WAITING_CUSTOMER` Sizden bilgi bekleniyor · `ANSWERED` Yanıtlandı · `CLOSED` Kapandı. Mesaj türleri (`kind`): `CUSTOMER`
(sağda) · `AGENT_REPLY` (ekip, solda) · `SYSTEM` (ortada küçük).

Talep görünümü (aşağıda **TALEP**):

```json
{
  "id": "5f0c2a1e-8d4b-4c61-9a57-1d2e3f4a5b6c",
  "number": "DST-2026-000123",
  "type": "BUG",
  "status": "NEW",
  "subject": "Sipariş listesi açılmıyor",
  "createdAt": "2026-11-16T09:12:44.120Z",
  "updatedAt": "2026-11-16T09:12:44.120Z",
  "closedAt": null,
  "messages": [
    { "id": "…", "kind": "SYSTEM", "body": "Talep alındı.", "authorName": null, "authorExternalUserId": null, "createdAt": "…", "attachments": [] },
    { "id": "…", "kind": "CUSTOMER", "body": "Siparişler ekranı boş geliyor.", "authorName": "Ayşe Yılmaz", "authorExternalUserId": "<hesap UUID>", "createdAt": "…",
      "attachments": [ { "id": "a3e1c2d4-…", "name": "ekran.webp", "mime": "image/webp", "size": 48213, "createdAt": "…", "hasThumb": true, "deleted": false, "deletedAt": null } ] }
  ]
}
```

### 6.1 `GET /api/destek/durum`

Özellik açık mı. Kapının ÖNÜNDEDİR (kapalıyken de 200), dış istek yapmaz. Yanıt: `{ "success": true, "data": { "etkin": true } }`.
Hatalar: 401 `OTURUM_YOK`.

### 6.2 `POST /api/destek/talepler` — talep aç

| Alan | Tip | Kural |
|---|---|---|
| `type` | `BUG` \| `QUESTION` \| `REQUEST` | zorunlu |
| `subject` | string | zorunlu, kırpılır, 1–200 |
| `message` | string | zorunlu, kırpılır, 1–20 000 |
| `clientToken` | string | zorunlu, `[A-Za-z0-9_.:-]{1,100}` (UUID önerilir); merkeze `Idempotency-Key` olarak gider. Form açılışında / mantıksal deneme başına BİR KEZ üretilir; ağ hatası/zaman aşımında aynı token ile tekrar (aynı talep döner); başarı ya da kesin 4xx sonrası yenilenir. 24 saat geçerli. |
| `context` | nesne | isteğe bağlı, KATI: `screen` (≤200), `path` (≤500), `relatedRecord {type ≤50, ref ≤100, url? ≤500}`, `client {userAgent? ≤500, browser? ≤100, os? ≤100, device? ≤100, appVersion? ≤50, locale? ≤20}`, `technical` (serbest JSON nesnesi). `productVersion`/`appVersion` kabul edilir, yok sayılır. Toplam ≤ 16 KB (400 `CONTEXT_TOO_LARGE`). |
| `files` | dizi | isteğe bağlı, §4 Ekler |

```json
{
  "type": "BUG",
  "subject": "Sipariş listesi açılmıyor",
  "message": "Siparişler ekranı boş geliyor.",
  "clientToken": "0b9c8f3e-6f1d-4a43-9d6e-2f7f3b1c9a10",
  "context": { "screen": "Siparişler", "path": "/siparisler", "client": { "os": "iOS 19", "device": "iPhone", "appVersion": "1.0.0" } },
  "files": [ { "name": "ekran.png", "contentType": "image/png", "dataBase64": "iVBORw0KGgo..." } ]
}
```

Yanıt: yeni talep **201**; aynı `clientToken` tekrarı **200** + başlık `Idempotent-Replay: true` (ikinci talep açılmaz).
`data` = TALEP + `"idempotentReplay": false|true`.
Hatalar: 400 (`GOVDE_GECERSIZ` / ek / bağlam / merkez), 403 `MODULE_DISABLED`, 413, 429, 502, 504.

### 6.3 `GET /api/destek/talepler` — liste

| Sorgu | Varsayılan | Kural |
|---|---|---|
| `scope` | `mine` | `mine` (kendi talepleri) \| `tenant` (firmanın bütün talepleri — patron hesabında HER ZAMAN izinli) |
| `status` | — | virgüllü durum listesi, ör. `NEW,IN_PROGRESS,ANSWERED`; bilinmeyen değer 400 `GOVDE_GECERSIZ` (merkeze gitmez) |
| `page` | 1 | ≥ 1 |
| `limit` | 20 | 1–100 |

Tekrarlı parametre (`?scope=a&scope=b`) 400. Sıra: son hareket, yeniden eskiye.

```json
{ "success": true, "data": { "items": [ {
  "id": "5f0c2a1e-…", "number": "DST-2026-000123", "type": "BUG", "status": "ANSWERED", "subject": "Sipariş listesi açılmıyor",
  "requester": { "id": "<hesap UUID>", "name": "Ayşe Yılmaz" }, "unreadReplies": 1,
  "lastActivityAt": "2026-11-16T10:03:10.000Z", "closedAt": null,
  "createdAt": "2026-11-16T09:12:44.120Z", "updatedAt": "2026-11-16T10:03:10.000Z" } ],
  "total": 1, "page": 1, "limit": 20 } }
```

`requester` talebi açanı gösterir (panelden açan fabrika kullanıcısı da olabilir).

### 6.4 `GET /api/destek/talepler/:id` — ayrıntı

Yanıt **200**: `data` = TALEP. İç not, öncelik, atanan dönmez. Ayrıntı açılınca 6.7 çağrılır.
Hatalar: 404 `BULUNAMADI` (UUID değil) / `NOT_FOUND` (merkezde yok).

### 6.5 `POST /api/destek/talepler/:id/mesajlar` — yanıt yaz

Gövde (KATI): `{ "message": "Ekran görüntüsünü ekledim.", "files": [ … ] }` (`message` 1–20 000, `files` §4).
Yanıt **201**: `data` = güncel TALEP. Yanıtlanmış/bilgi beklenen talep `IN_PROGRESS` olur; kapalı talep kapanıştan sonraki
14 gün içinde yeniden açılır, sonra 409 `REOPEN_WINDOW_EXPIRED`. İşlem kimliği YOK: gönderirken düğmeyi kilitle, ağ
hatasında talebi yeniden oku (çift gönderimi kendin engelle).

### 6.6 `POST /api/destek/talepler/:id/kapat` — "Çözüldü, kapat"

Gövde `{}` (başka alan 400). Yanıt **200**: `data` = TALEP (`status: "CLOSED"`). Kapalı talepte tekrar çağrı bir şey değiştirmez.

### 6.7 `POST /api/destek/talepler/:id/okundu`

Gövde `{}`. Yanıt **200**: `{ "success": true, "data": { "lastReadAt": "2026-11-16T10:05:00.000Z" } }`. Okuma damgası
talep × hesap başınadır.

### 6.8 `GET /api/destek/okunmamis?scope=mine|tenant` — rozet

Varsayılan `mine`; zaman aşımı 5 sn. Yanıt: `{ "success": true, "data": { "count": 3, "tickets": 2 } }` — `count` okunmamış
ekip yanıtı, `tickets` bunların dağıldığı talep sayısı (rozette `tickets`). Öneri: uygulama öne gelince ve push gelince
yeniden oku; açıkken 60 sn yoklama yeter (push zaten haber verir).

### 6.9 `GET /api/destek/ekler/:id/baglanti?variant=original|thumb` — ek bağlantısı

`variant` varsayılan `original`; `thumb` ≤ 320 px WebP önizleme (`hasThumb: false` ise asıl dosya döner). `deleted: true`
ekte ÇAĞIRMA. Yanıt: `{ "success": true, "data": { "url": "https://<merkez>/api/attachments/…/download?token=…", "expiresAt": "…" } }`.
Bağlantı 5 dk geçerli, oturum istemez (doğrudan `Image` kaynağı / tarayıcı). Hatalar: 404, 410 `ATTACHMENT_EXPIRED`.

### 6.10 `POST /api/destek/webhook` — merkez → bulut (uygulama ÇAĞIRMAZ)

Oturumsuz; kimlik doğrulama merkez imzasıyla: `X-Destek-Timestamp` (unix sn) + `X-Destek-Signature`
= hex(HMAC-SHA256(webhook sırrı, `${timestamp}.${sha256hex(HAM gövde)}`)), sabit zamanlı karşılaştırma.

| Durum | Yanıt |
|---|---|
| Sır yok (özellik kapalı) | 404 `BULUNAMADI` (gövde okunmaz) |
| İmza başlığı eksik / yanlış / gövde değişmiş | 401 `INVALID_SIGNATURE` |
| Zaman damgası ±300 sn dışı | 401 `TIMESTAMP_OUT_OF_RANGE` |
| İmza doğru, gövde JSON değil | 400 `INVALID_PAYLOAD` |
| Gövde > 256 KB | 413 `PAKET_BUYUK` |
| Kabul | 200 `{ "success": true, "data": { "alindi": true, "yinelenen": false, "tur": "ticket.replied" } }` |
| Aynı `eventId` ikinci kez | 200 `yinelenen: true`, işlenmez |

Hız sınırı IP başına `V1_HIZ_DK` (600/dk). Yanıt push'u beklemez; push hatası yanıtı etkilemez.

## 7. Push bildirimi (uygulamanın karşılaması)

- Yalnız `ticket.replied` (ekip yanıtı) push üretir ve YALNIZ `externalTenantId` = bu bulutta hazır bir tesisin kimliğiyse,
  o tesisin hesaplarına gider; `ticket.status_changed`, `ping`, UUID olmayan ya da bu bulutta olmayan firma yalnız onaylanır.
- Alıcı: tesisin AKTİF patron hesaplarının etkin cihazları; hesabın bildirim tercihi kapalıysa ya da sessiz saatteyse
  gönderilmez (kuyruğa da girmez). Geçersiz cihaz belirteci pasife çekilir.
- **Native (Expo)** yük içeriksiz: `title: "Destek yanıtı"`, `data: { "bildirimId": "<uuid>", "rota": "/destek/<ticketId>", "tesisId": "<uuid>" }`.
  Uygulama `rota` `/destek/` ile başlıyorsa talep ayrıntısını (6.4) açar ve rozeti (6.8) tazeler.
- **Web push**: `{ "baslik": "Destek yanıtı", "metin": "DST-2026-000123 · <konu>\n<yanıt özeti ≤100>", "bildirimId", "rota", "tesisId" }`.
- Bildirim türü kataloğunda (`NOTIFICATION_KINDS`) destek türü YOKTUR; bildirim tercih ekranına yeni anahtar gerekmez,
  genel "bildirimler açık" + sessiz saat uygulanır.

## 8. Fabrika sözleşmesinden farklar

| Konu | Fabrika (`DESTEK-ENTEGRASYONU.md`) | Bulut |
|---|---|---|
| Doğrulama hatası | 400 `Validasyon hatası` + `errors[]` | 400 `GOVDE_GECERSIZ` + `details.code`, mesaj alanı söyler |
| Gövde | bilinmeyen alan sessiz | KATI: bilinmeyen alan (ör. `user`, `tenant`) 400 |
| UUID olmayan `:id` | 400 | 404 `BULUNAMADI` (merkeze gitmez) |
| `kapat` / `okundu` gövdesi | yok | `{}` + `Content-Type: application/json` zorunlu |
| `scope=tenant` | yalnız `admin:settings`; değilse 403 `FORBIDDEN` | her patron hesabı firma yöneticisi → her zaman izinli |
| Kullanıcı rolü | `Yönetici`/`Kullanıcı`/`Sistem hesabı` | hep `Yönetici`, `isTenantAdmin: true` |
| Firma adı | `company.name` ayarı | tesis adı (`tesis-ac --ad`) |
| `productVersion` | backend sürümü | fabrikanın son eşitlenen sürümü (`sync_state.appVersion`) |
| İstemci künyesi | `X-Client-Kind`/`X-Client-Version` başlıkları | başlık okunmaz; `context.client.appVersion` gövdeden, `clientKind` = `patron` |
| Oturum hatası | mevcut oturum kodları | 401 `OTURUM_YOK` |
| Gövde sınırı aşımı | 413 (kodsuz) | 413 `PAKET_BUYUK`; eşzamanlı ekli istek 1 (aşan 429 `RATE_LIMITED`) |
| Webhook | YOK (yoklama) | `POST /api/destek/webhook` + push |
| Kurumsal vekil | `HTTPS_PROXY` (http-egress) | yok; doğrudan `fetch` |
| Audit | `destek_talepleri` | `account_audit` (`DESTEK_*` olayları) |

## 9. Bilinen açık noktalar

- **Push varsayılan kapalı:** `deploy/patron/docker-compose.yml`de `BILDIRIM_KIPI` varsayılanı `kapali`. Push için `gercek` kip + `BILDIRIM_VAPID_KONU`
  (+ native için `BILDIRIM_NATIVE_PUSH=acik` ve `EXPO_ERISIM_BELIRTECI`) ayrıca açılmalı; o güne kadar yanıt yalnız rozet
  yoklamasıyla görünür. Native push yalnız başlık taşır.
- **Ortak hız sınırı:** fabrika ve bulut aynı API anahtarını/kurulumu paylaşır → merkezin dakikada 120 istek sınırı ikisine
  ORTAKTIR; rozet yoklama aralığını kısa tutma.
- **Bellek:** patron kapsayıcısının bellek tavanı; ekli istek base64+JSON ile ~1,4 × dosya yer kaplar → aynı anda tek ekli istek okunur,
  ikincisi 429 alır.
- **Firma adı ikiliği:** merkezde firma adı panelden gelen taleplerde `company.name`, telefondan gelende tesis adı; iki değer
  farklıysa merkezde gidip gelebilir (tesis adı `company.name` ile aynı tutulmalı).
- **Tekilleştirme bellekte:** `eventId` kümesi (24 sa, tavan 5000) yeniden başlatmada boşalır → en kötü ihtimalle bir
  yanıt için ikinci push.
- **`/dev/null` sır bağlaması** `compose-denetle.mjs` (`docker compose config`) ile doğrulandı; gerçek `up` VDS'te ilk dağıtımda gözlenmeli
  (günlükte `destek: uçlar KAPALI (DESTEK_API_URL yok) · webhook KAPALI (DESTEK_WEBHOOK_SECRET_DOSYASI boş)`).


## 10. Uygulama notları (patron telefon uygulaması, `patron/uygulama`)

- **Kod:** saf mantık `src/destek/` (`gorunurluk` · `form` · `cizim` · `baglam` · `metin` · `taslak` · `yakala` · `kancalar`),
  tel tipleri `src/api/destek-wire.ts` (`wire.ts` sunucuyla bayt-eşit olduğundan AYRI dosya), uçlar `src/api/endpoints.ts`
  (`support*`; ayna bekçisi `__tests__/mirror.test.ts` sunucu rota tablosuyla karşılaştırır), ekranlar `app/(app)/destek/`
  (`index` Taleplerim · `[id]` ayrıntı · `yeni` form · `ciz` çizim), bileşenler `src/ui/destek/`. Bekçi: `__tests__/destek.test.tsx`.
- **Görünürlük:** oturum hazır olunca bir kez `/destek/durum`; `etkin:false`, 404 (eski bulut) ya da her hata → KAPALI; öne
  gelişte yeniden sorulur. Kapalıyken menüde/rayda Destek satırı, başlıkta "Sorun bildir" simgesi ve rozet ÇİZİLMEZ, başka
  destek isteği atılmaz. Herhangi bir uçtan 403 `MODULE_DISABLED` girişi hemen gizler.
- **Girişler:** Menü (☰) "Yardım → Destek" satırı + okunmamış rozeti (pano ☰ simgesinde de; ret rozeti öncelikli); geniş
  ekranda rayda aynı satır; her ekranın başlığında küçük "Sorun bildir" simgesi (destek ekranlarında yok).
- **Rozet:** `GET /destek/okunmamis?scope=mine`, uygulama öndeyken 120 sn'de bir + öne gelişte + push dokunuşunda + talep
  açılınca (`okundu` sonrası). 502/504/429/ağ hatası yutulur, rozet eski değerinde kalır. Merkezin dakikalık sınırı fabrikayla
  ortak olduğundan §6.8'deki 60 sn yerine 120 sn seçildi.
- **Sorun bildir:** önce `captureScreen` (JPEG, uzun kenar ≤ 1920 px), sonra form; çizim (`PanResponder` + `react-native-svg`;
  kalem · ok · çerçeve · karartma, 4 renk, geri al/temizle) "Bitti"de `captureRef` ile tek JPEG olur. Web'de ve
  `react-native-view-shot` yerel modülü olmayan eski derlemede görüntü adımı atlanır (yalnız metinli talep).
- **clientToken:** form açılınca bir kez (`newId`, UUID); ağ/5xx/429'da aynı, kesin 4xx'te yeni; çift dokunuş kilitli.
  Ekli talep 60 sn, eksiz 20 sn zaman aşımı. Yanıt yazmada belirsiz hatada talep yeniden okunur, yanıt işlenmişse kutu temizlenir.
- **Bağlam:** `screen` (Türkçe ekran adı) · `path` (sorgusuz yol) · `client {os, device, appVersion "sürüm (yapı)", locale}` ·
  `technical {uygulama, platform, yapiNumarasi}`; parola/belirteç/sorgu/cihaz kimliği girmez.
- **Bildirim:** `data.rota` `/destek/<UUID>` → `safeRoute` destek yolunu ayrıca tanır (modül tablosunda değil), ayrıntı açılır
  ve rozet tazelenir; başka tesis / UUID olmayan kimlik açılmaz.
- **Ek önizlemesi:** `variant=thumb` bağlantısı doğrudan `Image` kaynağıdır → görsel MERKEZİN alan adından indirilir (bulut
  aracılık etmez); silinmiş ekte bağlantı istenmez.
- **Derleme:** `react-native-view-shot` yerel modüldür → yeni iOS/Android derlemesi gerekir (OTA yok). Paket yalnız bu dilimde
  eklendi; galeri/dosya seçici yok.
