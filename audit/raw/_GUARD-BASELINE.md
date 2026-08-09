# Guard Kapsama Tabanı (ana oturumda mekanik olarak DOĞRULANDI)

Tarih: 2026-08-09. Yöntem: `src/routes/**/*.ts` içindeki her `<router>.<metod>(...)` çağrısı
parantez-dengeli ayrıştırıldı; dosya içi `const X = ...` middleware sabitleri (dizi, spread,
fonksiyon çağrısı) çözülüp bloğa yerleştirildi. **Sekiz farklı router değişken adı** tarandı.

Bu dosya sonraki oturumların **başlangıç doğrusudur**. Sayı değişmişse route eklenmiştir.

## Sayılar (iki bağımsız yöntemle uzlaştırıldı)

| Ölçü | Değer |
|---|---|
| **Toplam route handler** | **500** |
| `router.` / `r.` ile tanımlı | 449 |
| Diğer 8 router değişkeniyle tanımlı | 51 |
| Metod dağılımı (449'luk alt küme) | GET 220 · POST 150 · DELETE 37 · PATCH 29 · PUT 13 |
| `app.ts` içinde `/api/*` mount | 47 |
| **`verifyToken` YOK** | **8** |
| **`verifyToken` var, izin guard'ı YOK** | **14** |
| Auth + izin guard'lı | **478** |

Diğer router değişkenleri ve uç sayıları: `peripheralRouter` 11 · `deviceAdminRouter` 9 ·
`machineRouter` 8 · `travelerCardRouter` 7 · `categoryRouter` 5 · `subcontractorRouter` 5 ·
`devicePublicRouter` 3 · `workOrderTravelerRouter` 3.

**Çapraz doğrulama:** paralel çalışan üç route-envanteri ajanı bağımsız olarak
141 + 165 + 194 = **500** saydı. İki yöntem birebir uyuştu.

**CLAUDE.md uzlaştırması:** doküman "496 uçtan 473'ü guard'lı, guard'sız 23" diyor.
Ölçülen: 500 uç, 22'si gerekçe gerektiriyor. Doküman **esasen doğru**, hafif drift var
(4 uç eklenmiş). Denetimde doküman güncellenmeli ama bu bir bulgu değil.

## Yöntem uyarısı — dört yanlış pozitif sınıfı (DERS)

İlk tarama 25 korumasız + 71 izinsiz uç raporladı. Dördü de yöntem hatasıydı:

1. `router.get("/x", ...guard, handler)` — spread edilmiş dizi sabiti
   (`const guard = [verifyToken, requirePermission("report:production")]`).
   `reports/` altındaki **20 uç** yanlışlıkla "korumasız" göründü.
2. `router.post("/x", verifyToken, WRITE, handler)` — büyük harfli middleware sabiti
   (`const WRITE = requireAnyPermission("shipping:write", ...)`).
   `shipping.routes.ts`'in **40+ ucu** yanlışlıkla "izinsiz" göründü.
3. Çok satırlı `requireAnyPermission(` çağrısı (`customer-branch-list.routes.ts`).
4. **`router` dışındaki router değişkenleri** — 51 uç taramanın tamamen dışında kaldı
   (cihaz, çevre birim, makine, kategori uçları).

**Denetim sırasında aynı hatayı yapma:** guard araması düz `grep` ile yapılamaz.
Route dosyalarında middleware referansı dolaylıdır ve router değişkeni her zaman `router` değildir.

## `verifyToken` olmayan 8 uç

**Giriş uçları (5) — meşru:**

| Uç | Gerekçe |
|---|---|
| `POST /api/auth/login` | Token üreten uç; token isteyemez |
| `POST /api/auth/login-card` | Kart ile giriş |
| `POST /api/auth/login-quick-pin` | PIN ile giriş |
| `GET /api/auth/login-methods` | İstemci hangi giriş yöntemleri açık öğrenir |
| `GET /api/auth/mobile-users` | Mobil giriş ekranı kullanıcı listesi |

**Cihaz el sıkışması (3) — meşru ama doğrulanmalı:**
`POST /api/devices/announce` · `GET /api/devices/status` · `GET /api/devices/pairing-required`
(`devicePublicRouter`). Cihaz eşleşmeden önce token alamaz, yani kimlik doğrulamasız olmaları
tasarım gereğidir. Denetim sorusu: bu üç uç eşleşmemiş bir cihaza ne kadar bilgi veriyor
ve `announce` ile kayıt oluşturulabiliyor mu (kaynak tüketimi / sahte cihaz kaydı)?

**Dikkat — `GET /api/auth/mobile-users`:** kimlik doğrulamasız kullanıcı listesi döndürüyor.
Giriş ekranının ihtiyacı olabilir ama bu bir **kullanıcı numaralandırma (enumeration) yüzeyidir**
ve `login-lockout.ts` ile birlikte değerlendirilmelidir. KIM.guvenlik hücresine ait.

## İzin guard'ı olmayan 14 uç — üç sınıf

**Sınıf A — self-servis (4), meşru:**
`GET /api/auth/me`, `POST /api/auth/logout`, `GET|PUT /api/auth/preferences`.
Kullanıcı kendi kaydına erişir; izin kodu anlamsız.

**Sınıf B — salt-okuma lookup (5), doğrulanmalı:**
`GET /api/currencies`, `GET /api/document-profiles`, `GET /api/document-profiles/:id`,
`GET /api/feature-flags`, `GET /api/feature-flags/documents-logo`.
`GET /api/feature-flags` dikkat ister: sistemin TÜM ayarlarını mı döndürüyor, yoksa istemciye
gerekli alt kümeyi mi? Yedek saati, oturum politikası, DB bağlantı ipuçları sızıyorsa
bilgi ifşasıdır. **OPS.guvenlik hücresinde doğrulanacak.**

**Sınıf C — dinamik izin, guard controller'da (5), asıl hedef:**
`GET /api/printed-documents/:docType/:sourceId/current` · `/html` · `/versions` ·
`/versions/:version` ve **`POST /:docType/:sourceId/reissue`**.
İzin `docType`'a göre çalışma zamanında çözülüyor (`DOC_PERMISSIONS`). Desen meşrudur ama
guard route'ta görünmez, yani her dalda uygulandığı mekanik olarak görülemez.
`reissue` bir YAZMA işlemidir (resmi belgeyi revize eder, versiyon artırır).
Denetim sorusu: bilinmeyen/yeni bir `docType` geldiğinde fail-open mu fail-closed mu?
**BLG.guvenlik hücresinin birinci maddesi.**
