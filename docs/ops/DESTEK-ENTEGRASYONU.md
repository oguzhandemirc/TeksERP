# Etkili Destek entegrasyonu — yapılandırma ve uç sözleşmesi

> Panel (Electron) ve saha uygulaması (mobil) dilimleri YALNIZ bu belgeye bakarak yazılabilsin diye yazıldı. Sır içermez: API anahtarı ve adres kurulum kılavuzundadır, repoya girmez.
> Kod: `Teks-Erp/src/routes/destek.routes.ts` · `src/services/destek.service.ts` · `src/services/helpers/destek-{transport,attachment}.helper.ts` · `src/middlewares/destek.middleware.ts` · hazır istemci kopyası `src/integrations/destek/` (`KAYNAK.md`). Bekçi: `scripts/test_destek_entegrasyonu.ts`. Kural satırı: `docs/kurallar/genel.md`.
> **TeksERP farkları (2026-11-20, Adnan kopyasından):** uç öneki `/api/etkili-destek` (`/api/destek` satıcıya giden eski destek talebinindir, 3d-2 — ona dokunulmaz); firma kimliği lisans HAK'ındaki tesis kimliği (`tesis.id`, küçük harf; patron bulutu da aynısını gönderir) — lisanssız kurulumda özellik kapalı; uçlar lisans kapısının her kademesinde açık (kurtarma yolu). Her fabrika Etkili Destek panelinde KENDİ kurulumunu ve anahtarını alır — başka kurulumun anahtarı kullanılmaz (merkez her sorguyu anahtarın kurulumuyla sınırlar).

## 1. Akış

```
Panel / saha uygulaması ──(mevcut oturum, Bearer)──▶ fabrika backend /api/etkili-destek/*
                                                      │  kimlik OTURUMDAN kurulur
                                                      ▼  imzalı giden HTTPS (http-egress)
                                               Etkili Destek merkezi
```

- İstemciler merkeze doğrudan gitmez; API anahtarı yalnız backend `.env`indedir.
- Fabrikaya gelen port AÇILMAZ → webhook ucu YOK. Yeni yanıt bildirimi `GET /api/etkili-destek/okunmamis` yoklamasıyla gelir (öneri: menü rozeti için sayfa değişiminde + 60 sn'de bir; "Taleplerim" ekranı açıkken liste 30 sn'de bir).
- Talepler merkezde durur; backend'de tablo yok. Talep açma, yanıt ve kapatma `destek_talepleri` adıyla denetim kaydına (audit) düşer — yükte yalnız talep no / tür / durum / olay vardır, mesaj metni ve dosya YOKTUR.

## 2. Yapılandırma ve kapatma

`Teks-Erp/.env` (sunucuda, repoya girmez):

```
DESTEK_API_URL=https://<destek merkezi>/api/v1/integration
DESTEK_API_KEY=<kılavuzdaki anahtar>
```

- İkisi de doluysa ve adres HTTPS ise özellik AÇIK. Biri eksik, adres bozuk ya da düz HTTP ise (yalnız `127.0.0.1`/`localhost` test sunucusuna izin var) özellik KAPALI; açılışta ve çalışırken dış istek YAPILMAZ.
- Açmak/kapatmak: `.env` satırlarını ekle/sil, backend'i yeniden başlat. Varsayılan (satır yok) = bugünkü davranış.
- Kurumsal proxy varsa `HTTPS_PROXY`/`NO_PROXY` ortamdan okunur (patron bulutuyla aynı çıkış; Node 22.21+ / 24.5+ gerekir).
- Anahtar hiçbir log satırına, hata gövdesine ya da audit yüküne girmez. Merkez anahtarı reddederse (anahtar yenilendi/kurulum pasif) istemci 502 `DESTEK_YAPILANDIRMA` görür ve sunucu log'unda `destek` alanında tek satır uyarı çıkar.
- Merkez erişilemezken yalnız bu uçlar hata döner (istek başına zaman aşımı: 15 sn; ekli istek 60 sn; rozet 5 sn). Fabrikanın başka hiçbir yolu bu servise uğramaz.

## 3. Ortak kurallar (istemci için)

- **Kimlik:** Her uç mevcut oturumla çağrılır (`Authorization: Bearer <token>`); izin kodu YOK, giriş yapmış herkes kendi taleplerini görür. Parola değişimi zorunlu kısıtlı oturum 403 `PASSWORD_CHANGE_REQUIRED` alır (bütün uçlar gibi).
- **Kimlik gövdeden ALINMAZ:** `user`, `tenant`, `isTenantAdmin` gönderilse de yok sayılır. Merkeze giden kimlik: `user.id` = kullanıcının UUID'si, `name` = görünen ad (`fullName`), `role` = `Yönetici` | `Kullanıcı` | `Sistem hesabı`; firma = lisans tesis kimliği (HAK `tesis.id`, küçük harf; sabit müşteri adı yok) + `company.name` ayarı. Kullanıcı modelinde e-posta/telefon olmadığı için gönderilmez (merkez ekip yanıtında e-posta atamaz; bildirim rozetten gelir).
- **Firma yöneticisi** (`scope=tenant`, başkasının talebini görme/yanıtlama): `admin:settings` izni (ya da `*`/`admin:*`) veya sistem hesabı. İstemci bu kararı kendisi ÇIKARMAZ: `GET /api/etkili-destek/durum` yanıtındaki `firmaYoneticisi` alanına göre "Firmanın" sekmesini gösterir (sunucu aynı helper'la karar verir); izinsiz kullanıcı `scope=tenant` isterse 403 `FORBIDDEN` (merkeze gidilmez).
- **İstemci künyesi:** mevcut `X-Client-Kind` / `X-Client-Version` başlıkları (apiClient zaten gönderiyor) talep açarken `context.client.appVersion` ve `context.technical.clientKind` olarak eklenir. `context.productVersion` = backend sürümü (istemcinin yazdığı yok sayılır). Kullanıcı IP'si gönderilmez.
- **Zarf:** başarılı yanıt `{ "success": true, "data": … }`. Hata `{ "success": false, "message": "<Türkçe>", "details": { "code": "<KOD>", … } }` — kod HER ZAMAN `details.code` altında (`body.code` yok). Zod doğrulama hatası: 400 `{ success:false, message:"Validasyon hatası", errors:[{field, message}] }` (`details` yok).
- **Mesajı göster:** 4xx'te `message` kullanıcıya gösterilebilir Türkçe metindir (merkezin kendi Türkçe mesajı aynen taşınır). Karar `details.code` ile verilir.
- **Tarihler** ISO 8601 UTC metni.
- **Kimlikler** (`:id`) UUID'dir; UUID olmayan değer merkeze gitmeden 400.

### Ekler (dosya)

Yeni npm paketi olmadığı için multipart YOK; ekler JSON içinde base64 gider:

```json
"files": [ { "name": "ekran.png", "contentType": "image/png", "dataBase64": "iVBORw0KGgo..." } ]
```

- En çok 5 dosya, dosya başına 10 MB (çözülmüş bayt), tür: `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`.
- `dataBase64` düz base64'tür (`data:` öneki YOK; satır sonu/boşluk temizlenir).
- Sunucu dosyanın ilk baytlarını bildirilen türle karşılaştırır (uzantısı değiştirilmiş dosya reddedilir). Dosya adındaki klasör yolu atılır.
- Ekli iki uçta (talep aç, yanıt yaz) gövde sınırı 70 MB; diğer uçlar gövde okumaz.
- Base64 yalnız istemci → fabrika arasındadır: backend dosyaları çözüp merkeze **multipart/form-data** ile iletir (merkezin 1 MB JSON sınırına takılmaz; bekçi §5 multipart + imza + bayt eşitliğini ölçer).
- Merkez görselleri küçültüp çoğunlukla WebP'ye çevirir: yanıttaki ekin `name`/`mime`/`size`ı yüklenenden farklı olabilir.

| Hata | HTTP | `details.code` |
|---|---|---|
| Tür izinsiz / base64 bozuk / içerik türle uyuşmuyor / boş | 400 | `ATTACHMENT_INVALID` (+ `index`: 0 tabanlı sıra) |
| Dosya 10 MB'tan büyük | 400 | `ATTACHMENT_TOO_LARGE` (+ `index`) |
| 6+ dosya | 400 | Zod doğrulaması (`errors[].field = "files"`) |
| Gövde 70 MB'ı aştı | 413 | — (mesaj sınırı söyler) |

## 4. Hata eşlemesi (bütün uçlar)

| Durum | İstemcinin gördüğü | `details.code` | İstemci ne yapar |
|---|---|---|---|
| Özellik kapalı (env yok) | 403 | `MODULE_DISABLED` (`modul: "destek"`) | Destek girişini gizle (`/durum` ile önceden bilinir) |
| Kimliksiz / oturum düşmüş | 401 | mevcut oturum kodları | Mevcut 401 akışı |
| Yetkisiz `scope=tenant` | 403 | `FORBIDDEN` | "Firmanın" sekmesini gösterme |
| Merkez doğrulama hatası (400) | 400 | merkezin kodu (`VALIDATION_FAILED`, `MESSAGE_EMPTY`, `SUBJECT_EMPTY`, `MESSAGE_TOO_LONG`, `TICKET_TYPE_INVALID`, `CONTEXT_INVALID`, `CONTEXT_TOO_LARGE`, `ATTACHMENT_*`, `TOO_MANY_ATTACHMENTS`) | `message`'ı göster |
| Talep/ek yok ya da erişilemiyor | 404 | `NOT_FOUND` | "Talep bulunamadı" |
| Kapanıştan 14 gün geçmiş talebe yanıt | 409 | `REOPEN_WINDOW_EXPIRED` | "Yeni talep aç" öner |
| Ekin saklama süresi doldu | 410 | `ATTACHMENT_EXPIRED` | "Ek süresi dolduğu için silindi · ad · boyut" |
| Merkez gövde sınırı | 413 | `PAYLOAD_TOO_LARGE` | Daha küçük dosya |
| Merkez hız sınırı | 429 + `Retry-After` (sn) | `RATE_LIMITED` (+ `retryAfterSec`) | Belirtilen süre bekle |
| Merkez 5xx / ağ hatası | 502 | `DESTEK_ULASILAMADI` (+ `merkezKodu`) | "Destek merkezine ulaşılamadı, tekrar deneyin"; tekrar denenebilir |
| Merkez zaman aşımı | 504 | `DESTEK_ZAMAN_ASIMI` | Aynı; talep açmada AYNI `clientToken` ile tekrar dene |
| Merkez anahtarı/imzayı reddetti (401, `INSTALLATION_INACTIVE`) | 502 | `DESTEK_YAPILANDIRMA` (+ `merkezKodu`) | "Sistem yöneticinize bildirin"; oturumu KAPATMA (bilerek 401 değil) |

Rozet ucunda (`/okunmamis`) 502/504/429 sessizce yutulabilir: rozet eski değerinde kalır, toast basılmaz.

## 5. Uçlar

Taban: `http(s)://<fabrika sunucusu>/api/etkili-destek`. Talep türleri: `BUG` (Hata) · `QUESTION` (Soru) · `REQUEST` (İstek). Durumlar: `NEW` Yeni · `IN_PROGRESS` İnceleniyor · `WAITING_CUSTOMER` Sizden bilgi bekleniyor · `ANSWERED` Yanıtlandı · `CLOSED` Kapandı. Mesaj türleri (`kind`): `CUSTOMER` (müşteri, sağda) · `AGENT_REPLY` (ekip, solda) · `SYSTEM` (ortada küçük).

### 5.1 `GET /api/etkili-destek/durum`

Özellik açık mı. Destek kapısının ÖNÜNDEDİR: kapalıyken de 200 döner. Dış istek yapmaz.

```json
{ "success": true, "data": { "etkin": false } }
{ "success": true, "data": { "etkin": true, "firmaYoneticisi": false } }
```

- Kapalıyken yalnız `{ "etkin": false }` döner (`firmaYoneticisi` YOK).
- Açıkken `firmaYoneticisi` oturumdaki kullanıcı için `scope=tenant` kararının AYNISIDIR (sunucuda tek helper, §3). "Firmanın" sekmesi ve `scope=tenant` rozeti yalnız `true` iken gösterilir/yoklanır.

Hatalar: 401 (oturum yok).

### 5.2 `POST /api/etkili-destek/talepler` — talep aç

Gövde (JSON):

| Alan | Tip | Kural |
|---|---|---|
| `type` | `BUG` \| `QUESTION` \| `REQUEST` | zorunlu |
| `subject` | string | zorunlu, kırpılır, 1–200 |
| `message` | string | zorunlu, kırpılır, 1–20 000 |
| `clientToken` | string | zorunlu, `[A-Za-z0-9_.:-]{1,100}` (UUID önerilir). Merkeze `Idempotency-Key` olarak gider. **Form açıldığında / mantıksal deneme başına BİR KEZ üretilir**; ağ hatası/zaman aşımında aynı token ile tekrar denenir (aynı talep döner), başarı ya da kesin 4xx sonrası yenilenir. 24 saat geçerli. |
| `context` | nesne | isteğe bağlı, katı (bilinmeyen alan → 400): `screen` (≤200), `path` (≤500), `relatedRecord {type ≤50, ref ≤100, url? ≤500}`, `client {userAgent?, browser?, os?, device?, appVersion?, locale?}`, `technical` (serbest JSON, ≤6 düzey). `productVersion`/`appVersion` kabul edilir ama yok sayılır. Toplam bağlam ≤ 16 KB (`CONTEXT_TOO_LARGE`). |
| `files` | dizi | isteğe bağlı, §3 Ekler |

Örnek:

```json
{
  "type": "BUG",
  "subject": "İrsaliye yazdırılmıyor",
  "message": "SVK-2026-0042 irsaliyesinde Yazdır'a basınca boş sayfa çıkıyor.",
  "clientToken": "0b9c8f3e-6f1d-4a43-9d6e-2f7f3b1c9a10",
  "context": {
    "screen": "Sevkiyat detayı",
    "path": "/sevkiyat/SVK-2026-0042",
    "relatedRecord": { "type": "shipment", "ref": "SVK-2026-0042" },
    "client": { "os": "Windows 11", "device": "Masaüstü" },
    "technical": { "lastError": "PrintError: timeout" }
  },
  "files": [ { "name": "ekran.png", "contentType": "image/png", "dataBase64": "iVBORw0KGgo..." } ]
}
```

Yanıt: yeni talep **201**, aynı `clientToken` tekrarı **200** (`idempotentReplay: true`, ikinci talep açılmaz):

```json
{
  "success": true,
  "data": {
    "id": "5f0c2a1e-8d4b-4c61-9a57-1d2e3f4a5b6c",
    "number": "DST-2026-000123",
    "type": "BUG",
    "status": "NEW",
    "subject": "İrsaliye yazdırılmıyor",
    "createdAt": "2026-11-15T09:12:44.120Z",
    "updatedAt": "2026-11-15T09:12:44.120Z",
    "closedAt": null,
    "messages": [
      { "id": "…", "kind": "SYSTEM", "body": "Talep alındı.", "authorName": null, "authorExternalUserId": null, "createdAt": "…", "attachments": [] },
      { "id": "…", "kind": "CUSTOMER", "body": "SVK-2026-0042 irsaliyesinde…", "authorName": "Ayşe Yılmaz", "authorExternalUserId": "<kullanıcı UUID>", "createdAt": "…",
        "attachments": [ { "id": "a3e1…", "name": "ekran.webp", "mime": "image/webp", "size": 48213, "createdAt": "…", "hasThumb": true, "deleted": false, "deletedAt": null } ] }
    ],
    "idempotentReplay": false
  }
}
```

Hatalar: 400 (Zod / ek / bağlam), 403 `MODULE_DISABLED`, 413, 429, 502, 504.

### 5.3 `GET /api/etkili-destek/talepler` — Taleplerim listesi

Sorgu:

| Parametre | Varsayılan | Kural |
|---|---|---|
| `scope` | `mine` | `mine` (kendi talepleri) \| `tenant` (firmanın bütün talepleri, yalnız yönetici; değilse 403 `FORBIDDEN`) |
| `status` | — | virgüllü durum listesi, ör. `NEW,IN_PROGRESS,ANSWERED`; bilinmeyen değer 400 |
| `page` | 1 | ≥ 1 |
| `limit` | 20 | 1–100 |

Sıra: son hareket, yeniden eskiye.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "5f0c2a1e-…", "number": "DST-2026-000123", "type": "BUG", "status": "ANSWERED",
        "subject": "İrsaliye yazdırılmıyor",
        "requester": { "id": "<kullanıcı UUID>", "name": "Ayşe Yılmaz" },
        "unreadReplies": 1,
        "lastActivityAt": "2026-11-15T10:03:10.000Z", "closedAt": null,
        "createdAt": "2026-11-15T09:12:44.120Z", "updatedAt": "2026-11-15T10:03:10.000Z"
      }
    ],
    "total": 1, "page": 1, "limit": 20
  }
}
```

`unreadReplies` > 0 ise satırda okunmamış noktası. `requester` firmanın sekmesinde talebi açanı gösterir.

### 5.4 `GET /api/etkili-destek/talepler/:id` — ayrıntı

Yanıt: 5.2'deki talep görünümü (`idempotentReplay` yok). Yönetici başkasının talebini de görür. İç notlar, öncelik, atanan hiçbir zaman dönmez; ekip yanıtında `authorName` yalnız ekip üyesinin görünen adıdır. Ayrıntı açılınca 5.7 (`okundu`) çağrılır.

Hatalar: 400 (UUID değil), 404 `NOT_FOUND`.

### 5.5 `POST /api/etkili-destek/talepler/:id/mesajlar` — yanıt yaz

Gövde: `{ "message": "Ekran görüntüsünü ekledim.", "files": [ … ] }` (`message` 1–20 000, `files` §3).

Yanıt **201**: güncel talep görünümü. Yanıtlanmış/bilgi beklenen talep `IN_PROGRESS` olur; kapalı talep kapanıştan sonraki 14 gün içinde yeniden açılır, sonra 409 `REOPEN_WINDOW_EXPIRED`.

### 5.6 `POST /api/etkili-destek/talepler/:id/kapat` — "Çözüldü, kapat"

Gövde yok. Yanıt **200**: talep görünümü (`status: "CLOSED"`). Kapalı talepte tekrar çağrı bir şey değiştirmez.

### 5.7 `POST /api/etkili-destek/talepler/:id/okundu` — okundu

Gövde yok. Yanıt **200**: `{ "success": true, "data": { "lastReadAt": "2026-11-15T10:05:00.000Z" } }`. Okuma kaydı talep × kullanıcı başınadır; başkasının okuması bu kullanıcının rozetini değiştirmez.

### 5.8 `GET /api/etkili-destek/okunmamis?scope=mine|tenant` — rozet

Varsayılan `scope=mine`; `tenant` yalnız yönetici (değilse 403 `FORBIDDEN`). Zaman aşımı 5 sn.

```json
{ "success": true, "data": { "count": 3, "tickets": 2 } }
```

`count`: okunmamış ekip yanıtı sayısı; `tickets`: bu yanıtların dağıldığı talep sayısı. Rozette çoğunlukla `tickets` gösterilir; yöneticide "Benim" sekmesi `mine`, "Firmanın" sekmesi `tenant`.

### 5.9 `GET /api/etkili-destek/ekler/:id/baglanti?variant=original|thumb` — ek bağlantısı

`variant` varsayılan `original`; `thumb` uzun kenarı ≤ 320 px WebP önizlemedir (listede ve yazışmada bunu göster, tıklanınca `original` iste). `hasThumb: false` ekte `thumb` asıl dosyayı verir. `deleted: true` olan ek için ÇAĞIRMA ("Ek süresi dolduğu için silindi · ad · boyut" yaz).

```json
{ "success": true, "data": { "url": "https://<destek merkezi>/api/attachments/a3e1…/download?token=…", "expiresAt": "2026-11-15T10:10:00.000Z" } }
```

Bağlantı 5 dk geçerlidir, oturum istemez: doğrudan `<img src>` / `Image` kaynağı ya da tarayıcıda açılacak adres olarak verilir. Süresi dolunca yeniden istenir. Hatalar: 404 `NOT_FOUND`, 410 `ATTACHMENT_EXPIRED`.

> Panel bu adresi `<img src>` olarak KULLANAMAZ (CSP `img-src 'self' data: blob:`, merkez alan adı izinli değil): panel 5.10'u kullanır. Bu uç durur (mobil ve dış tarayıcıda açma için).

### 5.10 `GET /api/etkili-destek/ekler/:id/icerik?variant=original|thumb` — ek içeriği (vekil)

Sunucu 5.9'daki bağlantıyı merkezden alır, dosyayı fabrikanın dış çıkışından indirir ve baytları oturumlu kullanıcıya aynen verir. İstemci `fetch` + `Authorization: Bearer` ile alır, `blob:` adresi olarak gösterir (işi bitince `URL.revokeObjectURL`). `deleted: true` ekte ÇAĞIRMA.

Yanıt **200**, gövde = dosya baytları (zarf YOK):

| Başlık | Değer |
|---|---|
| `Content-Type` | `image/png` · `image/jpeg` · `image/webp` · `image/gif` · `application/pdf` (başka tür gelmez) |
| `Content-Disposition` | görselde `inline`, PDF'te `attachment` (`filename="ek-<id>.<uzantı>"`; gerçek adı istemci talep görünümündeki `name`'den yazar) |
| `Cache-Control` | `private, max-age=300` |

- Güvenlik: indirme YALNIZ `DESTEK_API_URL` ile aynı kökene (şema + host + port) yapılır; başka adres verilirse istek atılmaz. Yönlendirme izlenmez. İndirmeye anahtar/imza başlığı eklenmez (bağlantı kendi belirtecini taşır). İlk baytlar türle uyuşmalı. Boyut tavanı 10 MB + 512 KB. Zaman aşımı 60 sn.
- Hatalar (JSON zarfla): 400 (UUID değil), 403 `MODULE_DISABLED` (kapalı; dış istek yok), 404 `NOT_FOUND`, 410 `ATTACHMENT_EXPIRED`, 502 `DESTEK_ULASILAMADI` (`merkezKodu`: `FOREIGN_HOST` · `MIME_NOT_ALLOWED` · `HTTP_<durum>` · `EGRESS_TOO_LARGE` · ağ kodu), 504 `DESTEK_ZAMAN_ASIMI`; 429/`DESTEK_YAPILANDIRMA` 5.9'daki gibi.
- İstemci 4xx/5xx'te önizleme yerine dosya adını gösterir.

## 6. Arayüz önerileri (kılavuzdan)

- Yeni talep formu: tür, konu, mesaj, ek (≤ 5, görsel/PDF, ≤ 10 MB). Bağlamı kullanıcıya sorma; ekran adı, yol, ilgili kayıt, cihaz/OS istemci tarafından otomatik doldurulur. Gönder düğmesi istek sürerken kilitli; `clientToken` form açılışında üretilir.
- Kapalı talep: 14 gün içinde yanıt yazılabilir; sonra "Yeni talep aç".
- Aydınlatma metni: "Destek talepleri Etkili Yazılım destek sisteminde işlenir."
- Özellik görünürlüğü: oturum açılışında `GET /api/etkili-destek/durum`; `etkin: false` ise menüde destek girişi yok, rozet yoklaması yok.

## 7. Bilinen sınırlar

- E-posta/telefon gönderilmez (modelde yok); ekip yanıtında kullanıcıya e-posta gitmez.
- Webhook yok: yeni yanıt en geç bir yoklama aralığı sonra görünür.
- Ekli talepte base64 + JSON ayrıştırma sunucu belleğinde ~1,4 × dosya boyutu yer kaplar (en kötü durumda ~70 MB tek istek için).
