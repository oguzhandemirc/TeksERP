# D-G — Güvenlik & Yetkilendirme (② BULMA, TUR 1)

**Denetçi:** D-G [P2] · **Mercek:** kod merkezli (alan denetçisi + kritik yazma yolu 8-soru)
**HEAD:** `ce8681d1` (dal `adnansahin`, 2026-08-28) · **Kapsam:** `Teks-Erp/src` (367 dosya), `prisma/`, `deploy/`, `docs/ops/`
**Veri kaynakları:** `audit/tools/sql-saha.sh` (prod kopyası `tekserp_saha_0825`, 2026-08-25, 190/195 migration) ve `sql-dev.sh` — ikisi de salt-okunur. Canlı prod'a erişim YOK.
**Saldırgan modeli (her bulguda sabit):** ① fabrika LAN'ındaki bir tablet/PC (fiziksel erişim var, kablosuz ağda), ② yetkisi DAR bir kimlikli kullanıcı (ör. prod'daki `Ha***` = tek izin `mobile:kk1`, `Os***` = 8 izin), ③ `admin:users` taşıyan ama `admin:*` taşımayan bir büro kullanıcısı. Dış internet saldırganı kapsam DIŞI (sunucu LAN'da, HTTP).

**Kişisel veri / sır kuralı:** hiçbir sır, PIN, kart kodu, vergi no, JWT secret veya bağlantı dizesi bu rapora kopyalanmadı; yalnız yerleri ve ölçüm SAYILARI verildi. Kullanıcı adları `xx***` maskeli.

**Önceki defterle uzlaştırma:** `F-CORE-GUV-005` (CORS `*`) ve `F-KIM-GUV-002` **reddedilmişti — yeniden AÇILMADI**; CORS yalnız D-G-02'nin *büyütücüsü* olarak, kendi başına bulgu olmadan anıldı. `F-OPS-VER-008` (db-copy tek izin) **GEÇERSİZ** olarak işaretliydi — bu raporda hiçbir yerde tekrarlanmadı (D-G-16 tamamen FARKLI bir uçtaki allowlist eksikliğidir, izin zinciriyle ilgisi yoktur). `F-OPS-VER-001` HÂLÂ AÇIK → D-G-05 onun teyididir, yeni bulgu olarak değil.

---

## 0. Bir sayfada tablo

| id | Şiddet | Başlık | Kanıt | Öncelik |
|---|---|---|---|---|
| D-G-01 | **S1** | `admin:users` başkasının düz PIN'ini izsiz okur → kimliğe bürünme | K2 | P1 |
| D-G-02 | **S1** | 6 haneli PIN tek başına kimlik + IP-anahtarlı bellek kilidi → alt ağdan doygunluk; 3 admin hesabının PIN'i var | K2 | P1 |
| D-G-03 | S2 | 30 gün token · sınırsız paralel oturum · idle yok · düz HTTP (121 canlı oturum) | K2 | P2 |
| D-G-04 | S2 | Son-admin bekçisi ÜYELİĞE bakar, GEÇERLİLİK PENCERESİNE bakmaz; `grantPermission`'da bekçi hiç yok | K1 | P2 |
| D-G-05 | S2 | `.env` git'te — `JWT_SECRET` + `DATABASE_URL`; rotasyon commit'i sırrı repoya yazdı | K2 | P1 |
| D-G-06 | S2 | Mobil rol şablonları `web` kategorili izin taşıyor → masaüstü kapısı delinir; sahada tambur operatöründe `label-template:write` | K2 | P2 |
| D-G-07 | S2 | Audit değiştirilemezlik trigger'ı varsayılan KAPALI; prod'da açıldığına dair kanıt yok | K1 | P2 |
| D-G-08 | S2 | Uygulama DB kimliği süper yetkili (dev'de ÖLÇÜLDÜ) + uygulama içinden `CREATE/DROP DATABASE` | K2 (dev) | P3 |
| D-G-09 | S3 | Arama `resolveExact` izin süzgecinden muaf → çuval no ile müşteri adı herkese | K1 | P4 |
| D-G-10 | S3 | `GET /api/feature-flags` 54 ayarı (kilit parametreleri, giriş yöntemleri, künye) her kimlikli kullanıcıya | K1 | P4 |
| D-G-11 | S3 | Cihaz kapısı başlık göndermeyene HİÇ uygulanmaz + cihaz kimliği sırsız; `closeForDevice` kullanıcı eşleşmesi aramaz | K1 | P3 |
| D-G-12 | S3 | `STATION_KIND_PERM` eksik anahtarda **fail-open** (kontrol sessizce atlanır) | K1 | P4 |
| D-G-13 | S3 | `PUT /admin/settings/:key` anahtar allowlist'siz + `asBoolean` "true" dışını false sayar → güvenlik anahtarı sessizce KAPANIR | K1 | P3 |
| D-G-14 | S3 | `GET /import/:entity/export` `data:import` istemez, tavansız ve **audit YAZMAZ** | K2 | P4 |
| D-G-15 | S3 | `POST /labels/test-native` keyfi IP:port'a RAW TCP (SSRF) — bayrak gerektirir | K1 | P4 |
| D-G-16 | S3 | `POST /admin/db-copies/:name/verify` allowlist'siz → cluster'daki herhangi bir DB | K1 | P4 |
| D-G-17 | S3 | rclone uzak adı doğrulamasız pozisyonel argüman (bayrak / `:backend:` enjeksiyonu) | K1 | P5 |
| D-G-18 | S3 | `test_route_auth_coverage` HEAD'de KIRMIZI → kimlik kapsamasının tek mekanik bekçisi sinyal veremiyor | K1 | P3 |
| D-G-19 | S3 | Hız sınırı hiç yok: kimliksiz `announce` PENDING tavanını doldurup tablet devreye almayı kilitler | K1 | P5 |
| D-G-20 | S4 | Masaüstü kapısı gövdeden gelen `clientType`'a bakar → güvenlik sınırı değil | K1 | P6 |
| D-G-21 | S4 | Audit `oldData/newData` maskesiz; bugün 1 satırda vergi no (kişisel alanlar sahada boş) | K2 | P6 |
| D-G-22 | S4 | Swagger kapısı `NODE_ENV`, morgan `APP_ENV ?? NODE_ENV` — aynı soruya iki bayrak | K1 | P6 |
| D-G-23 | S4 | `requirePermission(undefined)` → 403 değil **500**; üretici yol bugün yok, bekçi de yok | K0 | P6 |

**SQL enjeksiyonu: 19 `$queryRawUnsafe/$executeRawUnsafe` çağrısının 19'u da temiz çıktı** — bulgu YAZILMADI, gerekçe §2'de.

---

## 1. BULGULAR

### [D-G-01] `admin:users` tek başına HER kullanıcının düz hızlı-PIN'ini ve kart kodunu okur; okuma audit'e HİÇ düşmez — taşıyan kişi tam yetkili yöneticinin kimliğine bürünebilir

| Şiddet | S1 | Kategori | G (fonksiyon seviyesi yetki + kimlik) | Öncelik | P1 | Modül | KIM | Kanıt seviyesi | K2 |

**Özet.** Panelde "Kullanıcılar" ekranını açabilen (`admin:users`) bir kişi, `GET /api/admin/users/:id/credentials` ile **başka bir kullanıcının 6 haneli hızlı PIN'ini ve QR kart kodunu düz metin olarak** alır. PIN sahada birincil giriş yöntemidir (`auth.loginMethods.primary = "pin"`) ve **tek başına kimliktir** — kullanıcı adı bile sorulmaz. Yani okuma, o kullanıcı olarak giriş yapmaya eşdeğerdir. Uç bir GET'tir ve **hiçbir audit satırı yazmaz**; oysa aynı sırları taşıyan yedek indirmesi hem ÇİFT izin (`admin:settings` **VE** `admin:users`) ister hem de `BACKUP_DOWNLOAD` audit'i yazar. Aynı sırın iki farklı eşiği vardır ve zayıf olanı izsizdir.

**Kanıt.**
- `Teks-Erp/src/routes/admin.routes.ts:520-533` — tek guard, audit yok:
  ```ts
  router.get(
    "/users/:id/credentials",
    verifyToken,
    requirePermission("admin:users"),
    async (req, res, next) => {
      const data = await AuthService.getUserCredentials(req.params.id as string);
      res.status(200).json({ success: true, data });
  ```
- `Teks-Erp/src/services/auth.service.ts:235-247` — düz döner:
  ```ts
  return { quickPin: user.quickPin,
           cardCode: user.cardToken ? `TEKSU:${user.id}:${user.cardToken}` : null };
  ```
- `Teks-Erp/prisma/schema.prisma:362-371` — `cardToken`/`quickPin` **düz saklanır** (`@unique`, hash yok; şema yorumu bunu bilinçli bir karar olarak yazıyor).
- `Teks-Erp/src/services/auth.service.ts:117-137` — `loginWithQuickPin`: `findFirst({ where: { quickPin: normalized, isActive: true } })` → kullanıcı adı YOK.
- Karşıt eşik (aynı sır, iki farklı kapı): `Teks-Erp/src/routes/admin.routes.ts:1223-1233` ve `:1256-1262` — `requirePermission("admin:settings")` **+** `requirePermission("admin:users")` zinciri, gerekçesi yorumda ("F287: pg_dump .dump TÜM kullanıcıların düz quickPin/cardToken'ını içerir") ve `:1271-1278` `BACKUP_DOWNLOAD` audit'i.
- **Koruma kontrolü (nereye bakıldı, yok):** route satırında ikinci `requirePermission` YOK · handler'da `AuditService` çağrısı YOK · serviste kendi-kaydı kısıtı YOK (`getUserCredentials` herhangi bir `userId`'yi kabul eder) · `PermissionManagementService` son-admin/self koruması bu okuma yolunda çağrılmaz · `system_logs`'ta `USER_CREDENTIALS` benzeri bir `tableName` yok (prod kopyasında `tableName ILIKE 'USER%'` dağılımı: `USER_PERMISSION_SET` 36 · `USER_PERMISSION` 24 · `USER_QUICK_PIN` 19 · `users` 10 · `USER_PASSWORD` 3 — **okuma izi yok**).

**failure_mode.** `En***` (aktif, `admin:users` + `admin:settings`, `admin:*` YOK) `GET /api/admin/users/<Ah***-id>/credentials` çağırır → yanıtta `Ah***`'ın 6 haneli PIN'i. `POST /api/auth/login-quick-pin {"pin":"<o PIN>"}` ile `Ah***` olarak token alır (`Ah***`: 54 izin, **`admin:*` dahil**). Bundan sonra yaptığı her sevk stornosu / fire kaydı / izin değişikliği `system_logs.userId = Ah***` olarak yazılır. Denetim izinde `En***`'in bu işi yaptığını gösteren **tek bir satır bile yoktur** — `LOGIN_SUCCESS` satırı `payload.method="quick-pin"`, `userId=Ah***` der; kimlik okuması hiç loglanmamıştır.

**Veride fiili ihlal (K2).**
```sql
-- PIN sahibi + admin yetkisi kesişimi (prod kopyası, 2026-08-25)
SELECT left(u.username,2)||'***', p.code FROM users u
  JOIN user_permissions up ON up."userId"=u.id
  JOIN permissions p ON p.id=up."permissionId"
 WHERE u."quickPin" IS NOT NULL AND u."isActive"
   AND p.code IN ('admin:*','admin:users','admin:settings');
```
→ `Ah***` (admin:*, admin:settings, admin:users) · `Be***` (admin:*, admin:settings, admin:users) · `En***` (admin:settings, admin:users). **Yani `admin:*` taşıyan 3 hesabın 2'sinin PIN'i vardır ve `admin:users` taşıyan 4 kişinin hepsi o PIN'i okuyabilir.** Ayrıca `SELECT value FROM system_settings WHERE key='auth.loginMethods'` → `{"enabled":["list","pin"],"primary":"pin"}` (PIN girişi AÇIK) ve `count(*) FILTER (WHERE "quickPin" IS NOT NULL)` = 8/9.
Okuma izi araması: `SELECT count(*) FROM system_logs WHERE "newData"::text ~* 'quickPin|cardToken'` → **0**.

**İş etkisi.** Sevkiyat stornosu (`shipping:undo-dispatch`), fatura işaretleme (`shipping:invoice`) ve elle top düzeltmesi (`roll:manual-adjust`) gibi SoD amacıyla ayrılmış yetkiler, kimliğe bürünme mümkün olduğu sürece hiçbir ayrım üretmez: "kim yaptı" sorusunun cevabı yanlış olur. Bir sevkiyat iptali tartışmasında denetim izi savunulamaz.

**Öneri (2. tur için).**
- Kısa vade (kod, migration YOK): ① `GET /users/:id/credentials`'ı yedek indirmesiyle **aynı AND zincirine** al (`admin:settings` + `admin:users`) ve **audit yaz** (`USER_CREDENTIAL_READ`, `recordId = hedef userId`) — okumanın izsiz olması asıl kusurdur; ② PIN'i **yalnız üretildiği anda bir kez** göster (`setQuickPin` yanıtı zaten PIN'i döner, `auth.service.ts:182,194`), ekranda kalıcı gösterimi kaldır → uç tamamen ölür.
- Orta vade: `quickPin`'i hash'le (bcrypt maliyeti PIN yolunda kabul edilebilir değilse HMAC + sunucu anahtarı) ve girişte `quickPinLookupHash` üzerinden `findUnique` yap. `cardToken` için aynısı. Bu, hem bu ucu hem yedek dump'ını hem de D-G-08'i (superuser DB kimliği) aynı anda zararsızlaştırır. **Migration gerektirir → `[PROD'DA ÇALIŞTIRMA]`; geri alma: kolonlar ek olarak eklenir, eski kolon bir sürüm boyunca korunur, çift-yazma penceresinde geri dönülür.**

**Kabul kriteri.** ① `admin:users` taşıyıp `admin:settings` taşımayan bir kullanıcı `GET /users/:id/credentials` çağırınca 403. ② Başarılı her çağrı için `system_logs`'ta aktör + hedef kullanıcıyı taşıyan bir satır. ③ Bekçi: `scripts/test_user_credentials_guard.ts` — negatif sondayla (AND zincirinden `admin:settings` düşürülünce kırmızı, audit çağrısı silinince kırmızı).
**Efor.** 1 gün (kısa vade) · 3 gün (hash'leme + istemci turu).
**Önceki defter.** Yeni. `audit/00-map/K1a` H16 ("aynı sırların iki farklı eşiği, A-R11 sürüyor") aynı yeri işaret ediyordu; buradaki ek, **okumanın audit'siz olması** ve **PIN'in tek başına kimlik olması**dır.

---

### [D-G-02] Hızlı PIN tek başına kimliktir (10⁶ uzay, kullanıcı adı yok) ve tek savunma IP-anahtarlı bellek-içi kilittir; alt ağdaki çok-IP'li bir istemci PIN uzayını doyurabilir — sahada 3 yönetici hesabının PIN'i vardır

| Şiddet | S1 | Kategori | G (brute force / JWT-oturum) | Öncelik | P1 | Modül | KIM | Kanıt seviyesi | K2 |

**Özet.** `POST /api/auth/login-quick-pin` kimlik doğrulamasızdır, gövdesi yalnız 6 haneli bir sayıdır ve **hangi kullanıcı olduğunu sormaz** — PIN sistem genelinde benzersiz olduğu için tek başına kimliği belirler. Deneme kilidi `req.ip` başına bellek-içi bir `Map`'tir; `trust proxy` bilinçli olarak kapalı, yani anahtar **soket IP'sidir**. Fabrika LAN'ında bir makine kendi arayüzüne yüzlerce ikincil IP bağlayabilir ve her IP kendi deneme bütçesini alır. Kilit süreç yeniden başlatılınca sıfırlanır. Deneme başına bcrypt YOKTUR (PIN yolu indexli bir `findFirst`), yani deneme maliyeti ~ağ turu kadardır.

**Kanıt.**
- `Teks-Erp/src/routes/auth.routes.ts:15` — `router.post("/login-quick-pin", AuthController.loginQuickPin)` (kimlik guard'ı yok; bekçinin EXEMPT listesinde gerekçeli: `scripts/test_route_auth_coverage.ts:48`).
- `Teks-Erp/src/services/auth.service.ts:117-137`:
  ```ts
  if (!/^\d{6}$/.test(normalized)) throw AppError.unauthorized("Geçersiz PIN");
  const user = await prisma.user.findFirst({
    where: { quickPin: normalized, isActive: true },
    select: { id: true, username: true, tokenVersion: true },
  });
  ```
- `Teks-Erp/src/middlewares/login-lockout.ts:24-41` — depo ve anahtar:
  ```ts
  const failCounts = new Map<string, FailEntry>();   // :24 modül seviyesi, restart'ta sıfır
  export function resolveLoginLockoutKey(req: Request): string {
    const ip = req.ip;                                // :34 trust proxy YOK → soket IP
    if (typeof ip === "string" && ip.trim()) return ip.trim();
  ```
- `Teks-Erp/src/middlewares/login-lockout.ts:82-89` — ceza merdiveni: `attempts` (5) denemede blok; `penaltyRounds < escalateAfter` (3) iken `penaltySec` (60 sn), sonrasında `longPenaltyMin` (15 dk). `:75-79` — merdiven **boşta çürür** (`decayMs = longPenaltyMin*60_000` başına 1 tur düşer).
- Genel hız sınırı: `grep -rn "rate-limit|rateLimit|express-rate-limit|slowDown" src package.json` → **0 vuruş**.
- Kullanıcı listesi kimliksiz: `Teks-Erp/src/controllers/auth.controller.ts:377-386` — `if (!req.device && (await readDevicePairingRequired()))` → prod'da bayrak **false**, yani kapı hiç kapanmaz; `auth.service.ts:405-430` `id + username + fullName`, `take: 500`.
- **Büyütücü (kendi başına bulgu DEĞİL — `F-CORE-GUV-005` reddedildi, yeniden açılmıyor):** `app.ts:114` `cors({ exposedHeaders: [...] })` → `Access-Control-Allow-Origin: *`. Bu, LAN'daki herhangi bir makinede açılan bir tarayıcı sekmesinin (reklam, dahili wiki, e-posta önizlemesi) `fetch("http://<sunucu>:4000/api/auth/login-quick-pin", …)` ile denemeyi **kurbanın IP'sinden** koşturabilmesi demektir; sonucu da okuyabilir (`*` + credentials yok). Reddin gerekçesi "CORS `*` yalnız zaten kimliksiz uçları açar (onlar 002/003)" idi; 002/003 `/health` ve `announce`'tı — **kimlik bilgisi üreten bu uç o kapsamda değildi**.
- **Koruma kontrolü (nereye bakıldı, yok):** IP başına değil KULLANICI başına kilit YOK (bilinçli, `auth.controller.ts:108-112` password-spraying gerekçesi) · CAPTCHA/gecikme YOK · genel `express-rate-limit` YOK · fail2ban türü dış katman repoda YOK · `LOGIN_FAILED` audit'i yazılıyor ama **hiçbir alarm/eşik işi yok** (`src/jobs/` altında auth anomali işi yok) · PIN uzunluğu/karmaşıklığı sabit 6 hane (`schema.prisma:371` `VarChar(12)`, uygulama `^\d{6}$`).

**failure_mode.** Fabrika ağına (kablosuz dahil) erişebilen bir cihaz, `GET /api/auth/mobile-users` ile 8 aktif kullanıcının adını **kimliksiz** alır (aslında gerekmez bile — PIN kullanıcı adı istemez), `GET /api/feature-flags`'i bir kez okuyup kilit bütçesini öğrenir (D-G-10), sonra 200 ikincil IP'den paralel PIN denemesi koşturur. Bütçe: IP başına ilk 15 deneme ~2 dk içinde, sonra **her 15 dakikada 5 deneme**. 200 IP → ~4.000 deneme/saat → ~96.000 deneme/gün. Sistemde 8 geçerli PIN olduğu için "herhangi bir hesaba düşme" olasılığı ~%50'ye **ln2 · 10⁶/8 ≈ 86.600 denemede** ulaşır → **~1 gün**. Düşülen hesap `Ah***` ya da `Be***` ise saldırgan `admin:*` alır: kullanıcı yaratma, yedek indirme (tüm PIN'ler, D-G-01), DB kopyası, ayar değiştirme. Süreç yeniden başlatılırsa (deploy, pm2 restart) tüm kilit durumu sıfırlanır ve sayaç baştan başlar.

**Veride fiili ihlal (K2).** *Fiili bir saldırı izi arandı, bulunmadı*: prod kopyasında son 30 günde `LOGIN_FAILED` **62**, `LOGIN_SUCCESS` **184** — normal aralık. İhlal DEĞİL, **maruziyet** ölçüldü:
```sql
SELECT count(*) FILTER (WHERE "quickPin" IS NOT NULL) FROM users WHERE "isActive"; -- 8/8
SELECT value FROM system_settings WHERE key='auth.loginMethods';
-- {"enabled": ["list","pin"], "primary": "pin"}
SELECT key,value FROM system_settings WHERE key LIKE 'auth.pinLockout%';
-- yalnız EscalateAfter=3, LongPenaltyMin=15 var; Enabled/Attempts/PenaltySec SATIRI YOK → kod varsayılanı (true/5/60)
SELECT value FROM system_settings WHERE key='device.pairingRequired'; -- false → mobile-users kimliksiz
```

**İş etkisi.** Fabrikanın tüm ERP'si (siparişler, sevkiyatlar, cari kartlar, yedekler) tek bir 6 haneli sayının tahmin edilmesine bağlıdır ve tahminin maliyeti bir günlük LAN erişimidir. Ele geçirilen hesap `admin:*` ise veri kaybı ve mevzuat (denetim izi) etkisi kritiktir.

**Öneri (2. tur için).**
1. **Kilidi IP'den ayır (asıl düzeltme):** PIN yolunda IP anahtarına ek olarak **genel (sistem geneli) bir PIN-deneme bütçesi** tut — "son 10 dakikada başarısız PIN denemesi > N ise PIN girişini geçici kapat, panelde kırmızı bant". PIN kullanıcı adı taşımadığı için hedef-bazlı kilit zaten mümkün değil; doğru birim SİSTEM'dir. Bellek-içi kalabilir (tek-process invariant), ama restart'ta sıfırlanmaması için `system_settings`'e bir damga yazılmalı.
2. PIN uzayını büyüt (8 hane) **veya** PIN'i kullanıcı seçimiyle eşleştir (liste + PIN) — `auth.loginMethods.enabled` zaten `list`i içeriyor; `primary`yi `list`e çekmek tek başına saldırı maliyetini 8× artırmaz ama hedef seçimini zorunlu kılar.
3. **`admin:*` / `admin:users` / `admin:settings` taşıyan hesaplarda PIN'i YASAKLA** (kod kuralı: `setQuickPin` yönetici izinli kullanıcıda 400). Bu tek kural, en kötü sonucu (yönetici düşmesi) ortadan kaldırır ve saha operasyonunu hiç etkilemez — PIN saha tabletleri içindir.
4. `LOGIN_FAILED` için eşik alarmı (`/api/admin/health` sayacı + panelde bant). Bugün 62 başarısız da 62.000 başarısız da aynı şekilde sessizdir.
5. CORS'a `origin` allowlist'i (LAN kabulüyle bile) — tarayıcı üzerinden koşturulan denemeyi keser. **Bu, `F-CORE-GUV-005`'in yeniden açılması DEĞİLDİR**; orada gerekçe "yalnız kimliksiz uçlar açılıyor" idi, burada o kimliksiz uçlardan biri kimlik bilgisi üretiyor.

**Kabul kriteri.** ① `admin:*`/`admin:users`/`admin:settings` taşıyan bir kullanıcıya PIN atanamıyor (400) ve mevcut PIN'leri temizleyen bir dry-run script'i var. ② 200 farklı kaynak IP'den 10 dakikada 1.000 yanlış PIN gönderen bir sonda, ilk N denemeden sonra 429 alıyor. ③ Bekçi `scripts/test_login_lockout_global.ts` negatif sondayla (genel bütçe kaldırılınca kırmızı).
**Efor.** 2 gün (1+3+4) · +1 gün (2, APK turu ister).
**Önceki defter.** `F-KIM-GUV-001` (yuksek, `duzeltildi`) — defterin kendi beyanı "KISMEN"di ve `K12` uzlaştırması artık riski açıkça açık bırakıyor: *"Tek-IP kilidi var; alt ağ genelinden çok-IP doygunluğu kapatılmadı; global bcrypt tavanı yok."* Bu bulgu **o artık riskin somut failure_mode'u + saha ölçümüdür**, kapanmış kısmı yeniden açmaz. **Klasik şifre yolunun DoS ayağı da hâlâ açık:** `bcryptjs` (saf JS, maliyet 10) tek event loop'ta koşar ve genel eşzamanlılık tavanı yoktur — N IP'den her biri 5 ücretsiz `bcrypt.compare` alır (`auth.service.ts:73`, `auth.controller.ts:118-128` sırası doğru ama bütçe IP başınadır).

---

### [D-G-03] Sahada token 30 gün geçerlidir, aynı tipte sınırsız paralel oturum açıktır, boşta kilit yoktur ve taşıma düz HTTP'dir — kopyalanan bir token bir ay boyunca kimseye görünmeden çalışır

| Şiddet | S2 | Kategori | G (JWT süresi / iptali) | Öncelik | P2 | Modül | KIM | Kanıt seviyesi | K2 |

**Özet.** Prod ayarları `auth.autoLogoutOnExpiry=false` + `auth.absoluteSessionCapDays=30` + `auth.sameTypeSessionPolicy="off"` + `auth.idleTimeoutMinutes=0` + `auth.mobileIdleLockEnabled=false` kombinasyonundadır. Sonuç: her giriş **30 gün geçerli** bir token üretir, aynı kullanıcı için aynı tipte açık oturum sayısı sınırsızdır (yeni giriş eskisini düşürmez) ve boşta kalan tablet kilitlenmez. Sunucu HTTP dinler (HTTPS yok, bilinçli LAN kararı), yani token her istekte düz metin gider. İzinler **JWT payload'ında** taşınır; bir yetki geri alınırsa `tokenVersion` artışıyla oturum düşer, ama kart/PIN rotasyonu `tokenVersion` artırmaz — yani "kartı iptal ettim" işlemi o kartla açılmış oturumu kapatmaz.

**Kanıt.**
- `Teks-Erp/src/services/auth.service.ts:283-305` — süre çözümü; `timeoutEnabled=false && capDays>0` dalı `now + capDays gün`.
- `Teks-Erp/src/services/auth.service.ts:344-357` — `openLoginSession(policy)`; `session-registry.service.ts:107-108` — `"off"` dalı **hiçbir oturumu düşürmez**.
- `Teks-Erp/src/middlewares/auth.middleware.ts:88-102` — `Session` okunur ama **`expiresAt` OKUNMAZ**; süre yalnız JWT `exp`'ine bağlıdır (`select: { revokedAt: true, revokeReason: true }`).
- `Teks-Erp/src/app.ts:96-101` — HTTP-only LAN kararı; `strictTransportSecurity: false`, `upgradeInsecureRequests: null`.
- `Teks-Erp/src/services/auth.service.ts:145-227` — `setQuickPin` / `rotateCardToken` yollarında `tokenVersion` artışı YOK (bilinçli olduğu yorumda yazılı).
- **Koruma kontrolü (nereye bakıldı, yok):** idle timeout sunucuda ENFORCE edilmiyor (`readIdleTimeoutMinutes` yorumu: "Frontend (Electron AppShell) bunu okuyup idle logout sayacını kurar") · IP/cihaz bağlama (token'ı çıkaran IP'ye/cihaza kilitleme) YOK · refresh-token / kısa erişim token'ı deseni YOK · `purgeDeadSessions` yalnız **revoke edilmiş ya da süresi geçmiş** satırları siler (`session-registry.service.ts:168-176`) — canlı oturumu budamaz · panelde "oturumlarım" self-servis yüzeyi YOK (`/api/work-sessions/active` admin'e ait, `admin:settings`).

**failure_mode.** Bir tabletin WPA2-PSK ağ trafiğini yakalayan (ya da tableti 30 saniye eline alan) biri `Authorization: Bearer …` değerini alır. Kendi dizüstünde `curl` ile o token'ı 30 gün boyunca kullanır: sevkiyat oluşturur, sipariş okur, etiket bastırır. Kurbanın oturumu **düşmez** (`policy="off"`), tablet kilitlenmez, `Session.lastSeenAt` iki cihazdan da tazelenir ve panelde "bu hesapta iki aktif oturum var" diyen bir yüzey yoktur. Fark edilmesinin tek yolu, birinin `admin:settings` ile `/api/work-sessions/active`'e bakıp cihaz sayısını saymasıdır.

**Veride fiili ihlal (K2).**
```sql
SELECT count(*) AS canli, min("createdAt")::date, max("expiresAt")::date,
       count(*) FILTER (WHERE "deviceId" IS NULL) AS cihazsiz
  FROM sessions WHERE "revokedAt" IS NULL AND "expiresAt" > now();
```
→ **121 canlı oturum** (8 aktif kullanıcı ⇒ kullanıcı başına ~15), en eskisi **2026-08-01** doğmuş, en uzak sona erme **2026-09-24**, **26'sı cihaz kimliği taşımıyor**. Toplam `sessions` 214 (MOBILE 115 / ELECTRON 99); 10 satır süresi geçmiş ama `revokedAt IS NULL` (ölü satır, tokenları da süresi dolduğu için tehlike değil — hijyen).

**İş etkisi.** Yetki geri alındığında (personel işten çıktı, rol daraldı) koruma `tokenVersion` bump'ına bağlıdır ve o yalnız izin/şifre yollarında çalışır: kart/PIN iptali oturumu kapatmaz. 121 canlı token'ın hangisinin kime ait cihazda durduğu izlenmiyor.

**Öneri (2. tur için).**
- Ayar tarafı (kod değişikliği YOK, **feature-flag DEĞİŞTİRME — bu bir öneri**): `auth.autoLogoutOnExpiry=true` + `sessionDurationMinutes` = vardiya süresi (ör. 720) ve `absoluteSessionCapDays` tavanı olarak kalsın; `sameTypeSessionPolicy="kick"` (kod zaten destekliyor, `session-registry.service.ts:109-114`); mobilde `mobileIdleLockEnabled=true`.
- Kod tarafı: ① `verifyToken`'da `Session.expiresAt` DE okunsun (bugün yalnız JWT `exp`'ine güveniliyor — iki kaynağın ayrışabildiği tek yer `absoluteSessionCapDays=0` yapılandırmasıdır ve orada token **exp'siz** imzalanır, yani sonsuza kadar yaşar); ② kart/PIN rotasyonu `tokenVersion++` yapsın ya da en azından o kullanıcının MOBILE oturumlarını revoke etsin; ③ `/api/auth/me` yanıtına "bu hesapta N aktif oturum" ekle (self-servis görünürlük, yeni izin gerekmez).
**Kabul kriteri.** `absoluteSessionCapDays=0` ayarında bile `exp` claim'i konuyor (ya da `expiresAt` middleware'de kontrol ediliyor); kart rotasyonundan sonra eski kartla açılmış oturum 401 alıyor; bekçi `scripts/test_session_duration_minutes.ts`'e negatif sonda ekleniyor.
**Efor.** 1,5 gün (kod) + ayar kararı (iş).
**Önceki defter.** Yeni. `K5` H8 aynı yeri işaret ediyordu ("kabul edilen risk mi, belgeli mi?"); repoda bu kombinasyonu kabul eden yazılı bir karar bulunamadı — `docs/history/CLAUDE-NOT-ARSIVI.md` ve `docs/ops/*` içinde 30 gün/`off` kombinasyonuna dair gerekçe yok.

---

### [D-G-04] Son-yönetici bekçisi izin **üyeliğine** bakar, izin **geçerlilik penceresine** bakmaz; `grantPermission`'da bekçi hiç koşmaz — tek yöneticinin `admin:users`'ına gelecek tarihli bir `validFrom` yazmak sistemi kalıcı olarak yöneticisiz bırakır

| Şiddet | S2 | Kategori | G (fonksiyon seviyesi yetki) + E (değişmez) | Öncelik | P2 | Modül | KIM | Kanıt seviyesi | K1 |

**Özet.** Sistemde daima en az bir efektif `admin:users` kalmasını garanti eden üç bekçi var (`assertAdminCoverageAfterChange`, `assertNotLastActiveAdmin`, advisory kilit `8025`). Efektiflik **zaman penceresiyle** tanımlanır (`validFrom <= now` ve `validUntil >= now`). Ama bekçiyi TETİKLEYEN koşul zamana değil **listede olup olmamaya** bakar: `setUserPermissions` yalnız `removesAdmin = currentHasAdmin && !targetHasAdmin` olduğunda bekçiyi çağırır; `grantPermission` **hiç çağırmaz**. Sonuç: `admin:users` listede KALIR ama penceresi kapatılırsa hiçbir bekçi koşmaz ve o yetki efektif olarak yok olur.

**Kanıt.**
- `Teks-Erp/src/services/permission-management.service.ts:586-595` — efektiflik penceresi:
  ```ts
  private static effectiveAdminWindow(now: Date) { return {
    permission: { code: { in: [...this.ADMIN_CODES] } },
    AND: [ { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
           { OR: [{ validUntil: null }, { validUntil: { gte: now } }] } ] }; }
  ```
- `Teks-Erp/src/services/permission-management.service.ts:298-308` — tetikleyici koşul **üyelik**:
  ```ts
  const removesAdmin = currentHasAdmin && !targetHasAdmin;
  await prisma.$transaction(async (tx) => {
    if (removesAdmin) { await …acquireAdminGuardLock(tx);
                        await …assertAdminCoverageAfterChange(tx, userId, false); }
  ```
  → `targetHasAdmin` yalnız `permissionIds.some(...)` ile hesaplanır (`:301`), **tarihe bakmaz**.
- `Teks-Erp/src/services/permission-management.service.ts:174-235` — `grantPermission`: `upsert`'ün `update` dalı `validFrom`/`validUntil`'i **ezer** ve tx içinde **hiçbir admin bekçisi yoktur** (`acquireAdminGuardLock` / `assertAdminCoverageAfterChange` çağrısı yok; yalnız koşullu `tokenVersion++`).
- Zod kapısı yarım: `Teks-Erp/src/routes/admin.routes.ts:339-341` ve `:384-386` — `validUntil > new Date()` refine'ı var, **`validFrom` için hiçbir kısıt yok** (yalnız `validUntil > validFrom`).
- Etki noktası: `Teks-Erp/src/services/auth.service.ts:450-465` — `getEffectivePermissions` aynı pencereyi uygular, yani yeni token'da `admin:users` hiç görünmez. `grantPermission` `changed` olduğu için `tokenVersion++` yapar → mevcut oturum da **anında düşer**.
- **Koruma kontrolü (nereye bakıldı, yok):** route Zod'unda `validFrom` geçmişte olmalı kuralı YOK · serviste kendi-kaydına-dokunma kısıtı YOK (`assertNotSelfDeactivation` yalnız `deactivateUser`'da, `:568-574`) · boot uzlaştırması izin ATAMAZ (`permission-catalog.ts:25-27`) yani otomatik kurtarma yok · `role-template-catalog` uzlaştırması da ATAMAZ · panelde "son admin" uyarısı yalnız silme/pasifleştirme akışında.

**failure_mode.** Sistemde tek efektif yönetici `ad***` olsun. `admin:users` taşıyan bir kullanıcı (ya da `ad***`ın kendisi, yanlışlıkla) panelde `ad***`ın `admin:users` satırına **başlangıç tarihi = yarın** yazar → `POST /api/admin/users/<ad***>/permissions {"permissionId":"<admin:users>","validFrom":"2026-08-29T00:00:00Z"}`. Zod geçer (`validUntil` yok), `grantPermission` bekçisiz koşar, `tokenVersion++` ile `ad***`ın oturumu düşer. `ad***` yeniden giriş yapar; `getEffectivePermissions` `validFrom > now` olduğu için `admin:users`'ı **vermez**. Artık `/api/admin/users*` uçlarının hepsi 403'tür — düzeltmenin tek yolu da o uçlardır. Sistem, tarih gelene kadar (ya da elle SQL'e girilene kadar) **kullanıcı/yetki yönetimi olmadan** çalışır. Aynı sonucu `setUserPermissions` ile de üretebilirsiniz: listede `admin:users` **durur** (`removesAdmin=false` → bekçi atlanır) ama `validFrom` gelecektir.

**Veride fiili ihlal (K2).** *Arandı, 0.*
```sql
SELECT count(*) FILTER (WHERE "validFrom" IS NOT NULL) AS vf,
       count(*) FILTER (WHERE "validUntil" IS NOT NULL) AS vu, count(*) FROM user_permissions;
-- 0 | 0 | 353   → sahada hiç süreli izin yok
SELECT count(DISTINCT u.id) FROM users u JOIN user_permissions up ON up."userId"=u.id
  JOIN permissions p ON p.id=up."permissionId"
 WHERE u."isActive" AND p.code IN ('admin:users','admin:*')
   AND (up."validFrom" IS NULL OR up."validFrom"<=now())
   AND (up."validUntil" IS NULL OR up."validUntil">=now());   -- 4
```
Bugün 4 efektif yönetici var ve hiç süreli izin kullanılmıyor → **kilitlenme için 4 ayrı işlem gerekir, yani bugünkü olasılık düşük**. Ama özellik panelde açıktır ve tek yöneticiye düşmek (personel ayrılması) olağan bir durumdur.

**İş etkisi.** Kurtarma yolu yok: ne boot uzlaştırması izin atar, ne bir "kurtarma admin" mekanizması var. Çözüm doğrudan DB'ye `UPDATE user_permissions SET "validFrom"=NULL` yazmaktır — yani canlı üretimde elle SQL, üstelik denetim izi olmadan.

**Öneri (2. tur için).**
1. Bekçiyi ÜYELİKTEN EFEKTİFLİĞE taşı: `setUserPermissions`'ta `targetHasAdmin`'i `effectiveAdminWindow` semantiğiyle hesapla (`validFrom` gelecekte ya da `validUntil` geçmişte ⇒ admin SAYILMAZ).
2. `grantPermission`'ı da aynı tx/kilit deseninden geçir: `ADMIN_CODES`'tan biri yazılıyorsa `acquireAdminGuardLock` + `assertAdminCoverageAfterChange` çağır.
3. Zod: `validFrom` verilirse `<= now` olsun (gelecek tarihli açılışa gerçekten ihtiyaç varsa, `ADMIN_CODES` için yasakla).
4. Bekçi: `scripts/test_timed_permissions.ts`'e §"son admin'e gelecek validFrom yazılamaz" ekle; **negatif sonda**: bekçiyi üyelik-tabanlı hâline geri alınca kırmızı.
Migration YOK, izin YOK, APK YOK.
**Kabul kriteri.** Tek efektif yöneticinin `admin:users`'ına gelecek `validFrom` yazma denemesi 409 döner; iki eşzamanlı deneme kilidin altında serileşir ve yalnız biri geçer (diğeri 409).
**Efor.** 0,5 gün.
**Önceki defter.** İlgili: `F-KIM-GUV-002` (**reddedildi** — `applyTemplate replace` devri; yeniden AÇILMIYOR). Bu bulgu farklı bir kusurdur: devir değil, bekçinin TETİKLEYİCİ KOŞULU. `K3b` "H-3 `validUntil` ile son-admin sönmesi" notu aynı sınıfı işaret ediyordu; burada `validUntil`ın Zod ile kapalı, `validFrom`ın **açık** olduğu ve `grantPermission`'ın bekçisiz olduğu ölçüldü.

---

### [D-G-05] `Teks-Erp/.env` git ile izleniyor — `JWT_SECRET` ve `DATABASE_URL` depo geçmişinde; "secret rotasyonu" commit'i yeni sırrı da depoya yazdı

| Şiddet | S2 | Kategori | G (sırlar) | Öncelik | P1 | Modül | OPS/KIM | Kanıt seviyesi | K2 |

**Özet.** Bu bulgu **`F-OPS-VER-001`'in teyididir, yeni bir bulgu değildir** — defterde `dogrulandi`/açık durumda ve `K12` uzlaştırması "HÂLÂ AÇIK" diyor. TUR 1'de güncel durum yeniden ölçüldü: dosya **hâlâ izleniyor**, `.env.example` **hâlâ yok**, ve rotasyon commit'i (`76f9967b`, 2026-07-30, *"chore(env): yedek dizinleri + JWT secret rotasyonu"*) **yeni sırrı da aynı izlenen dosyaya yazmış** — yani rotasyon, sırrı depodan çıkarmadı, depoya bir tane daha ekledi. Dosyanın geçmişinde 3 sürüm var.

**Kanıt.** (İçerik kopyalanmadı; yalnız anahtar ADLARI.)
```
$ git ls-files | grep -E '(^|/)\.env'
Electron/.env.example
Electron/.env.production
Teks-Erp/.env                      ← 332 bayt, İZLENİYOR
Teks-Erp/.env.docker.example
mobil/.env.example
$ git check-ignore -v Teks-Erp/.env ; echo $?     → 1  (.gitignore:3 index'teki dosyaya ETKİSİZ)
$ git log --oneline --follow -- Teks-Erp/.env | wc -l   → 3
$ git show HEAD:Teks-Erp/.env | sed 's/=.*/=<gizlendi>/'
PORT=<gizlendi>
DATABASE_URL=<gizlendi>
JWT_SECRET=<gizlendi>
BACKUP_DIR=<gizlendi>
BACKUP_OFFSITE_DIR=<gizlendi>
```
- `Teks-Erp/.gitignore:3` `.env` (etkisiz — dosya index'te), `:10-13` `.env.bak*` (bu doğru çalışıyor: `.env.bak-1785369087` izlenmiyor).
- `docs/ops/KURULUM.md:16` "sırlar; git'e girmez" — **belge kodun tersini söylüyor**; `:188` "`.env` tek sır kaynağı (`DATABASE_URL` + `JWT_SECRET`)".
- Tüketim noktası: `Teks-Erp/src/services/auth.service.ts:35-45` (`JWT_SECRET`, <32 karakter → boot'ta throw) ve `src/server.ts:1` `dotenv/config`.
- **Koruma kontrolü (nereye bakıldı, yok):** `Teks-Erp/.env.example` YOK (dev'in kendi dosyasını üretmesi için şablon yok, bu da "kopyala-yapıştır" alışkanlığını besliyor) · pre-commit hook / `git-secrets` / `gitleaks` izi repoda YOK (`.husky`, `.github/workflows` altında sır taraması yok) · `ecosystem.config.js:22-23` sırrı içermiyor (doğru) ve `docs/ops/DEPLOY-RUNBOOK.md:98` şablonu maskeli (doğru).

**failure_mode.** Depoya okuma erişimi olan herkes (bir taşeron geliştirici, klonlanmış bir dizüstü, bir yedek disk) `git show <commit>:Teks-Erp/.env` ile `JWT_SECRET`'ı alır. **Prod'un `.env`'i bununla aynıysa** (doğrulanamadı → aşağıdaki [VARSAYIM]) saldırgan `{userId, username, permissions:["*"], tokenVersion:<n>, jti:<uuid>}` içeren bir token imzalar. `verifyToken` DB'den `tokenVersion` ve `Session(jti)` doğruladığı için sahte jti 401 alır — yani **tek başına forge yetmez**; ama meşru bir jti ele geçirmiş (D-G-03) saldırgan aynı jti ile izinleri `"*"`e yükselten bir token imzalayabilir ve `matchesPermission` `rbac.middleware.ts:39`'da `"*"`ı kabul eder. Yani sır + herhangi bir canlı oturumun jti'si = **tam yetki**.

**[VARSAYIM]** Sahadaki `.env`'in dev'dekiyle aynı `JWT_SECRET`'ı taşıyıp taşımadığı **doğrulanamadı** (canlı sunucuya erişim yok, sır rapora girmez). `DATABASE_URL`'deki DB adları farklı (`adnansahin_db` vs `tekserp`), bu da iki ayrı dosya olduğunu düşündürür ama secret'ın kopyalanmış olması ayrı bir sorudur. **Ops'a sorulacak tek soru:** "sunucudaki `JWT_SECRET`, repodaki dosyadaki değerle aynı mı?"

**İş etkisi.** Aynıysa: depo erişimi = fabrika ERP'sinde tam yetki. Değilse: dev ortamının sırrı ve dev DB bağlantısı açıkta (düşük), ama disiplin kırığı sürüyor ve bir sonraki rotasyon yine depoya yazılacak.

**Öneri (2. tur için).**
1. `git rm --cached Teks-Erp/.env` + `Teks-Erp/.env.example` (anahtar adları, değer yok) ekle. Geçmişten temizleme (`filter-repo`) **isteğe bağlı** ve tehlikelidir (paylaşımlı ağaç, `adnansahin` yayın dalı) — asıl adım rotasyondur.
2. **Sırrı sahada döndür** ve yeni değeri depoya YAZMA. Rotasyon 121 canlı oturumu düşürür (herkes yeniden giriş yapar) — vardiya dışında yapılmalı.
3. Pre-commit sır taraması (`gitleaks` ya da basit bir hook: `.env` staged ise reddet). Bekçi olarak `scripts/test_env_not_tracked.ts` — `git ls-files` çıktısında `.env` görürse kırmızı; bu, "tekrar eklenmesini" mekanik olarak engeller (`K5` §12 "bekçisi görünmeyen mekanizmalar" listesindeki `.env` maddesi).
**Kabul kriteri.** `git ls-files | grep -c 'Teks-Erp/.env$'` = 0; `Teks-Erp/.env.example` var; bekçi kırmızı-yeşil doğrulandı; ops "sahadaki secret değişti" teyidi.
**Efor.** 0,5 gün (repo) + rotasyon penceresi (ops).
**Önceki defter.** **`F-OPS-VER-001`** (yuksek, `dogrulandi` → K12: HÂLÂ AÇIK). Yeni kanıt: rotasyon commit'inin sırrı depoya yazdığı ve `.env.example`'ın hâlâ olmadığı bu turda teyit edildi.

---

### [D-G-06] Mobil rol şablonları `web` kategorili izin taşıyor → "yalnız mobil hesap masaüstüne giremez" kapısı delinir; sahadaki Tambur operatörü etiket şablonu stüdyosunu yazabiliyor

| Şiddet | S2 | Kategori | G (en az yetki / fonksiyon seviyesi yetki) | Öncelik | P2 | Modül | KIM/BLG | Kanıt seviyesi | K2 |

**Özet.** Masaüstü kapısı tek bir yüklemdir: "kullanıcının `mobile:` ile başlamayan en az bir izni var mı". Kapı bu yüzden **izin kategorisine değil, kod ön ekine** bakar. İki mobil rol şablonu (`MOBILE_PRODUCTION_OPERATOR`, `MOBILE_TAMBUR`) `label:edit` ve `customer-alias:write` taşır — ikisi de `web` kategorisindedir. Yani bu şablonla açılan bir tablet operatörü **Electron paneline girebilir**. Sahada bu, ölçülebilir bir gerçeğe dönüşmüş: Tambur operatörü `Os***` beş `web` izni taşıyor ve bunlardan biri `label-template:write` — yani fabrikanın TÜM etiket şablonlarını değiştirme yetkisi.

**Kanıt.**
- Kapı: `Teks-Erp/src/services/auth.service.ts:266-273`
  ```ts
  if (ctx?.clientType === "electron" &&
      !permissions.some((p) => !p.startsWith("mobile:"))) {
    throw AppError.forbidden("Bu hesabın masaüstü paneline erişimi yok. …");
  }
  ```
  Aynası: `Electron/src/types/auth.ts:85-88` (`canEnterApp`).
- Şablonlar: `Teks-Erp/src/constants/role-template-catalog.ts:285-297` (`MOBILE_PRODUCTION_OPERATOR` → `label:edit`, `customer-alias:write`) ve `:301-308` (`MOBILE_TAMBUR` → `mobile:tambur`, `label:edit`, `customer-alias:write`).
- Kategori: `Teks-Erp/src/constants/permission-catalog.ts` — `label:*` ve `customer-alias:*` `web`; `label-template:read/write` de `web`.
- Yazma yüzeyi: `Teks-Erp/src/routes/label.routes.ts:8` ve `:576` — `PATCH /api/labels/order-lines/:id` (`label:edit`) → **sipariş kalemine yazar** (etiket domain'inden sipariş domain'ine).
- **Koruma kontrolü (nereye bakıldı, yok):** `hasAdminAccess` (`Electron/src/types/auth.ts:57,81-83`) yalnız "Yönetim" menüsünü gizler, uygulamaya girişi engellemez · route guard'ları `label-template:write`i sorgular ve operatör onu taşır → 403 gelmez · `role-template-catalog.job.ts` şablona izin **EKLER** ama fazlasını SİLMEZ (`:167-180`), yani bir kez fazla verilen izin şablon düzeltilse bile kullanıcıda kalır · `test_role_template_catalog.ts` rol↔izin kataloğu hizasını ölçer, **kategori disiplinini ölçmez**.

**failure_mode.** Tambur operatörü `Os***` telefonundaki/tabletindeki hesabıyla masaüstü paneline (ya da doğrudan API'ye) girer, `PUT /api/label-templates/:id` ile fabrikanın varsayılan top etiketi şablonunu değiştirir. Ertesi vardiyada basılan **tüm** etiketler yeni şablonla çıkar; barkod alanı kayarsa ya da müşteri adı düşerse depo/sevkiyat okutması durur. Değişiklik audit'e düşer ama kimse bakmaz ve yetki "operatörde vardı" olduğu için hiçbir kapı 403 vermez. İkinci yüzey: `label:edit` ile bir sipariş kaleminin müşteri-ad override'ını değiştirmek → müşteri irsaliyesinde yanlış ürün adı.

**Veride fiili ihlal (K2).**
```sql
SELECT left(u.username,2)||'***', string_agg(p.code, ',' ORDER BY p.code)
  FROM users u JOIN user_permissions up ON up."userId"=u.id
  JOIN permissions p ON p.id=up."permissionId"
 WHERE u."isActive" AND (SELECT count(*) FROM user_permissions x WHERE x."userId"=u.id) < 12
 GROUP BY 1;
```
→
```
Ha***  mobile:kk1                                                        ← kapı DOĞRU çalışıyor (masaüstüne giremez)
Os***  label-template:read, label-template:write, label:edit, label:print,
       label:read, mobile:kumas, mobile:tambur, mobile:tambur-duzelt      ← 5 web izni
```
`label-template:write` şablonda YOKTUR (elle atanmış) — yani hem mekanizma (şablonun `web` izni taşıması) hem de operasyon (elle fazla atama) aynı yönde hata veriyor.

**İş etkisi.** "Tablet operatörü yalnız kendi ekranını görür" varsayımı sahada yanlıştır; etiket tasarımı ve sipariş kalemi alanları saha operatörüne açıktır.

**Öneri (2. tur için).**
1. Kapıyı ön ekten **kategoriye** çevir: `permission-catalog`'tan izin→kategori haritası çözülsün, masaüstü kapısı "en az bir `web` ya da `admin` kategorili izin" sorsun. `label:edit` `web` olduğu için tek başına yine geçirir → asıl düzeltme (2)'dir.
2. `label:edit` / `customer-alias:write` için **mobil ikizler** aç (`mobile:etiket-duzelt`, `mobile:musteri-adi`) ve şablonlardan `web` kodları çıkar; uçlar `requireAnyPermission("label:edit","mobile:etiket-duzelt")` deseniyle ikisini de kabul etsin (repo bu deseni zaten 49 imzada kullanıyor). Yeni izin kodu gerekir → katalog + rol şablonu + boot uzlaştırması; **atama elle yapılır** (`permission-catalog.ts:25-27`).
3. Bekçi: `scripts/test_role_template_catalog.ts`'e "mobil şablon `web`/`admin` kategorili kod TAŞIYAMAZ" kontrolü + istisna listesi (bugünkü ikisi geçici olarak listeye, TODO ile).
4. Operasyon: `Os***`'un `label-template:read/write` atamaları gözden geçirilsin (iş kararı — kod değil).
**Kabul kriteri.** Bekçi negatif sondayla kırmızı veriyor (`MOBILE_TAMBUR`'a bir `web` kodu geri konunca); `MOBILE_TAMBUR` şablonuyla açılan bir hesap `clientType=electron` ile 403 alıyor.
**Efor.** 2 gün (backend + Electron + APK turu).
**Önceki defter.** Yeni. `K5` H14 ve `K1a` H20 aynı adresi işaret ediyordu; buradaki ek, **saha ölçümü** (`Os***`) ve `label:edit`in sipariş kalemine yazdığıdır.

---

### [D-G-07] Denetim kaydının değiştirilemezliği bir GUC'a bağlıdır ve varsayılan KAPALIDIR; prod'da açıldığına dair kanıt yok, deploy kontrol listesindeki kutu boş

| Şiddet | S2 | Kategori | G (KVKK/ISO — denetim izi bütünlüğü) | Öncelik | P2 | Modül | OPS/CORE | Kanıt seviyesi | K1 + [VARSAYIM] |

**Özet.** `system_logs` ve `system_log_archives` üzerinde UPDATE/DELETE/TRUNCATE engelleyen trigger'lar kurulu ve etkin. Ama trigger gövdesi **yalnız `teks.audit_guard = 'on'` iken** exception atar; ayar verilmemişse (varsayılan) hiçbir şey yapmaz. Ayar migration'da değil, elle koşulacak bir ops adımındadır (`ALTER DATABASE … SET`) ve `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:1080` içindeki kutu **işaretlenmemiştir**. Yani ISO 27001 A.8.15 için kurulan tek koruma, muhtemelen sahada devre dışıdır.

**Kanıt.**
- Trigger gövdesi (prod kopyasından `pg_proc.prosrc` ile okundu):
  ```sql
  IF coalesce(current_setting('teks.audit_guard', true), '') = 'on'
     AND coalesce(current_setting('teks.audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Audit kaydı değiştirilemez veya silinemez …';
  END IF;
  ```
  → **fail-open**: GUC yoksa koruma yok.
- Trigger'lar mevcut ve etkin: `SELECT tgname, tgenabled FROM pg_trigger …` → `system_logs_block_tamper|O`, `system_log_archives_block_tamper|O`.
- Migration bunu bilinçli olarak açıklıyor: `Teks-Erp/prisma/migrations/20260819161000_audit_tamper_guard/migration.sql:17-24` — "Varsayılan KAPALI ve bu bilinçli bir karardır: 79 test dosyası + 4 fixture cleanup'ta audit satırı siler ZORUNDA".
- Ops adımı: `docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md:635` (`ALTER DATABASE tekserp SET teks.audit_guard = 'on';`), `:1080-1081` — kontrol listesi satırı **`☐`** (işaretsiz).
- Görünürlük VAR (bu, düzeltmeyi kolaylaştırır): `Teks-Erp/src/server.ts:48-68` boot uyarısı ve `src/app.ts:350,375,409,453` — `GET /api/admin/health` yanıtında `auditGuard: "on"|"off"|null`.
- **Koruma kontrolü (nereye bakıldı, yok):** ikinci bir uygulama-katmanı koruması YOK (`AuditService`'te update/delete yolu yok ama DB kimliği doğrudan yazabilir) · `system_logs` üzerinde REVOKE UPDATE/DELETE tarzı GRANT disiplini YOK · zincirleme hash / imza YOK · boot uyarısı yalnız `console` (`server.ts:68`), audit'e ya da alarma düşmüyor.

**[VARSAYIM] — sınır açıkça yazılıyor.** Prod kopyasında `current_setting('teks.audit_guard', true)` **boş** döndü, ama bu **kanıt değildir**: `ALTER DATABASE … SET` ayarları `pg_db_role_setting`'te veritabanı OID'sine bağlıdır ve `pg_restore` ile yeni bir veritabanına **taşınmaz**. Kopyadaki boşluk beklenen davranıştır. Gerçek kanıt yalnız canlı sunucuda `SHOW teks.audit_guard;` ya da `GET /api/admin/health` yanıtındaki `auditGuard` alanıdır. Repo tarafındaki kanıt, **kontrol listesi kutusunun işaretsiz olması** ve `K8`'in "SAHA'da KAPALI" ölçümüdür.

**failure_mode.** Uygulamanın DB kimliğine (D-G-08: dev'de superuser) ya da sunucuya erişebilen biri `DELETE FROM system_logs WHERE "userId" = '<kendisi>' AND "createdAt" > '…'` koşar; hiçbir hata almaz, hiçbir iz kalmaz. Bir sevkiyat stornosu ya da izin değişikliği tartışmasında "kim yaptı" sorusunun cevabı silinmiş olur. Aynı yolla `newData` alanı değiştirilip **sahte bir geçmiş** yazılabilir.

**Veride fiili ihlal (K2).** Kopyada `system_logs` 10.485 satır; silme/değiştirme izi aranamaz (audit'in audit'i yok — kusurun kendisi bu). Trigger varlığı doğrulandı, GUC değeri **prod için doğrulanamadı**.

**İş etkisi.** Denetim izinin hukuki/operasyonel değeri "sonradan oynanamaz" olmasına bağlıdır; bugün bu garanti muhtemelen yoktur.

**Öneri (2. tur için).**
1. **Ops (kod değil):** canlıda `ALTER DATABASE tekserp SET teks.audit_guard = 'on';` + backend restart + `GET /api/admin/health` ile `auditGuard:"on"` teyidi. Geri alma: `ALTER DATABASE tekserp RESET teks.audit_guard;`. **[PROD'DA ÇALIŞTIRMA — bu denetimin işi değil]**
2. Kod: boot'ta `auditGuard` kapalıysa yalnız `console.warn` değil, **audit'e `SYSTEM/AUDIT_GUARD_OFF` olayı** yaz ve `/api/admin/health`'i "degraded" say. Sessiz bir uyarı, hiç uyarı değildir (aynı sınıf: `K9` H-5).
3. Bekçi: `scripts/test_db_invariants.ts`'e "canlıya karşı koşulduğunda `audit_guard='on'`" kontrolü (dev'de bilerek kırmızı olan §'ler kalıbıyla, açıkça etiketli).
**Kabul kriteri.** Canlıda `SHOW teks.audit_guard` = `on`; 0 satırlık bir `DELETE FROM system_logs WHERE false` bile `insufficient_privilege` ile reddediliyor (statement-level trigger 0 satırda da ateşlenir — migration yorumu bunu garanti ediyor); arşivleme işi hâlâ çalışıyor (`SET LOCAL teks.audit_purge='on'`).
**Efor.** 0,5 gün (kod) + ops penceresi.
**Önceki defter.** Yeni bulgu değil, **açık ops maddesi**: `MEMORY.md → audit-kunye-yol-haritasi` "ZORUNLU ops §7b (audit_guard AÇ)"; `K8` "audit_guard SAHA'da KAPALI".

---

### [D-G-08] Uygulama tek bir DB kimliğiyle koşuyor ve o kimlik süper yetkili (dev'de ölçüldü); DDL (CREATE/DROP DATABASE) uygulama içinden çalıştırılıyor — en az yetki ilkesi hiçbir katmanda uygulanmıyor

| Şiddet | S2 | Kategori | G (DB kullanıcısı süper yetkili mi) | Öncelik | P3 | Modül | OPS/CORE | Kanıt seviyesi | K2 (dev) + [VARSAYIM] (prod) |

**Özet.** Backend, `DATABASE_URL`'deki tek kimlikle hem sıradan CRUD yapar hem de — `BACKUP_PG_USER` override'ı verilmemişse aynı kimlikle — `CREATE DATABASE`, `DROP DATABASE`, `ALTER DATABASE … SET` çalıştırır. Dev'de bu kimlik ölçüldü: **`rolsuper = true`**. Prod'un kimliği görülemiyor, ama mimari bunu zorluyor: DB kopyası özelliği çalışıyorsa (panelde var) kimliğin en az `CREATEDB` + hedef DB üzerinde tam hak taşıması gerekir.

**Kanıt.**
- Ölçüm (dev): `audit/tools/sql-dev.sh -Atc "SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user"` → `oad|t|t|t`. Uygulamanın bağlantı kimliği aynıdır: `git show HEAD:Teks-Erp/.env` → `DATABASE_URL="postgresql://oad@localhost:5432/adnansahin_db?schema=public"` (şifre yok, `trust`/`peer`).
- DDL uygulama içinden: `Teks-Erp/src/services/db-copy.service.ts:300-345` (`CREATE DATABASE`), `:500,716` (`DROP DATABASE … WITH (FORCE)`), `:606-630` (`ALTER DATABASE … SET`), `:583-591` (`pg_restore -d`).
- Kimlik seçimi: `Teks-Erp/src/services/helpers/pg-admin-client.ts:34-42`
  ```ts
  function adminOverride() { return { user: process.env.BACKUP_PG_USER, password: process.env.BACKUP_PG_PASSWORD }; }
  export function liveConn() { return parseDatabaseUrl(process.env.DATABASE_URL, adminOverride()); }
  ```
  `pg-conn.helper.ts:43-48` — override verilmezse **URL'deki kullanıcı** kullanılır.
- Sahadaki `.env`'in `BACKUP_PG_USER` taşıyıp taşımadığı görülemiyor; `docs/ops/DEPLOY-RUNBOOK.md:122-131` "`owner` ile `DATABASE_URL`'deki kullanıcı aynıysa override gerekmez" diyor → **çoğu kurulumda override yok**.
- **Koruma kontrolü (nereye bakıldı, yok):** ayrı bir "app" rolü (yalnız DML) ile "maintenance" rolü ayrımı YOK · row-level security YOK (tek tenant, gerekmiyor) · `system_logs` üzerinde REVOKE UPDATE/DELETE YOK (D-G-07 ile birleşir) · `docs/ops/KURULUM.md` DB rolü oluştururken yetki daraltmasını anlatmıyor.

**failure_mode.** Uygulamada bir kod çalıştırma ya da SQL enjeksiyonu (bugün yok — §2) olsaydı, ya da `.env` ele geçse (D-G-05), saldırgan yalnız fabrika verisine değil **cluster'ın tamamına** (diğer veritabanları: kopyada `adnansahin_ticaret`, `adnansahin_db_old_*`, `*_restore_*`) erişirdi ve superuser olarak `COPY … FROM PROGRAM` ile işletim sistemi komutu çalıştırabilirdi. Ayrıca `teks.audit_guard` açılsa bile superuser onu `SET`leyerek atlayabilir — yani D-G-07'nin düzeltmesi de bu kimliğe karşı zayıftır.

**Veride fiili ihlal (K2).** Dev: `rolsuper=true` (ölçüldü). Prod: **[VARSAYIM]** — canlıya erişim yok. Ops'a sorulacak: `SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = <DATABASE_URL kullanıcısı>` ve `BACKUP_PG_USER` set mi?

**Öneri (2. tur için).** Uygulama için `NOSUPERUSER NOCREATEDB` bir rol; DDL yolu (`db-copy`, yedek) için `BACKUP_PG_USER/PASSWORD` çiftini **zorunlu** kıl (verilmemişse `probeCapabilities` zaten fail-closed yoklama yapıyor — `pg-admin-client.ts` "Yetenek yoklaması — fail-closed" bölümü; oradaki mesaj "yükseltilmiş kimlik gerekli" olsun). `system_logs` üzerinde uygulama rolüne yalnız INSERT + SELECT ver (D-G-07'yi GRANT katmanında da kilitler). **Migration DEĞİL, ops adımı** — geri alma: eski rolle bağlanmaya dönmek.
**Kabul kriteri.** Canlıda uygulama rolü `rolsuper=false`; DB kopyası özelliği `BACKUP_PG_USER` ile hâlâ çalışıyor; `test_db_copy.ts` (`TEST_DB_COPY=1`) yeşil.
**Efor.** 1 gün (ops + doküman) + 0,5 gün (fail-closed mesaj).
**Önceki defter.** Yeni. `K9` §12 (S6-S10) DDL noktalarını listeliyordu; kimliğin yetkisi burada ilk kez ölçüldü.

---

### [D-G-09] Arama motorunun "tam kod" hızlı yolu izin süzgecinin ÖNÜNDEDİR — `mobile:kk1` taşıyan operatör çuval numarasıyla müşteri adını okuyabilir

| Şiddet | S3 | Kategori | G (alan seviyesi yetki) | Öncelik | P4 | Modül | ARAMA | Kanıt seviyesi | K1 |

**Özet.** `GET /api/search` kovaları izinle eler (`SEARCH_ENTITIES[i].permissions`) ama terim tam bir barkod/kod biçimine uyuyorsa **önce** `resolveExact` koşar ve o fonksiyon izin parametresi bile almaz. Çuval kovası kural gereği `shipping:read|write` ister; `resolveExact` aynı çuvalı `sackNo + müşteri adı` olarak **her kimlikli kullanıcıya** döndürür.

**Kanıt.**
- `Teks-Erp/src/services/search.service.ts:146` — `async function resolveExact(term: string)` → **izin argümanı yok**.
- `:218-219` — sıra:
  ```ts
  const exact = await resolveExact(term);
  if (exact) return { term, exact, groups: [] };
  const buckets = SEARCH_ENTITIES.filter((e) => visible(e, opts.permissions) && …);
  ```
- `:164-176` — çuval dalı `customer: { select: { name: true } }` seçer ve `subtitle`'a koyar.
- `:180-207` — kartela (`item.name`) ve iş emri (`targetItem.name`) dalları aynı sınıf; `:148-162` top dalı `status + item.name`.
- Kova kuralı: `Teks-Erp/src/constants/search-entities.ts:141-144` — çuval `shipping:read|write`.
- Route: `Teks-Erp/src/routes/search.routes.ts:46` — `router.get("/", verifyToken, …)` (çıplak zincir; süzme serviste).
- **Koruma kontrolü (nereye bakıldı, yok):** `resolveExact` içinde `visible()` çağrısı YOK · route'ta ek guard YOK · dönen alan kümesi daraltılmamış (müşteri adı dahil) · bekçi yok (`K5` §12 "bekçisi görünmeyen mekanizmalar" listesinde).

**failure_mode.** `Ha***` (tek izin `mobile:kk1`) mobil/masaüstü aramaya `CV2508260001` yazar → yanıt `{ exact: { entity:"sack", row: { title:"CV2508260001", subtitle:"<müşteri ünvanı>" } } }`. Aynı kullanıcı `SEARCH_ENTITIES` kuralına göre çuval kovasında **hiçbir sonuç görmemeliydi**. İş emri numarasıyla (`IE2508260002`) hedef kumaş adını, top barkoduyla topun statüsünü ve kumaş adını da alır.

**Veride fiili ihlal (K2).** Aranmadı — bu bir yetki mantığı kusuru, veri ihlali değil; sorgu izi tutulmuyor (`search` audit yazmaz).

**İş etkisi.** Tek tenant fabrikada etki dar (müşteri adı zaten irsaliyede görünür) ama "kova izni" sözleşmesi kâğıt üzerindedir: yeni bir kova (ör. fiyatlı sipariş) eklendiğinde aynı kaçak otomatik olarak onu da kapsar.

**Öneri (2. tur için).** `resolveExact(term, permissions)` imzasına geç; her dal, ilgili `SEARCH_ENTITIES` girdisinin `permissions`ını `visible()` ile kontrol etsin (kova kataloğu tek kaynak kalsın — ikinci bir izin listesi yazma). Bekçi: `scripts/test_search_permissions.ts` — `mobile:kk1` izinli bağlamda tam formatlı çuval no için `exact === null`; negatif sonda: kontrolü kaldırınca kırmızı.
**Kabul kriteri.** İzinsiz kullanıcıda `exact` null döner ve fan-out da boş kalır (yanlış "bulunamadı" değil, "yetkiniz yok" demek gerekmez — palet zaten boş sonuç gösteriyor).
**Efor.** 0,5 gün.
**Önceki defter.** Yeni (`K5` H9).

---

### [D-G-10] `GET /api/feature-flags` sistemin 54 ayarını — giriş yöntemleri, kilit parametreleri, oturum politikası, firma künyesi — tek izinli bir saha operatörüne döner

| Şiddet | S3 | Kategori | G (alan seviyesi yetki / bilgi ifşası) | Öncelik | P4 | Modül | CORE | Kanıt seviyesi | K1 |

**Özet.** Uç bilinçli olarak "auth-only, tüm kullanıcılar"dır (UI rehberi). Ama yanıt zamanla bir UI bayrağı listesinden **güvenlik yapılandırmasının tamamına** dönüşmüş: `loginMethods`, `pinLockoutEnabled/Attempts/PenaltySec/EscalateAfter/LongPenaltyMin`, `sessionDurationMinutes`, `absoluteSessionCapDays`, `autoLogoutOnExpiry`, `sameTypeSessionPolicy`, `idleTimeoutMinutes`, `devicePairingRequired`, `backupHour`, `companyLetterhead` (vergi bilgisi dahil).

**Kanıt.**
- `Teks-Erp/src/routes/feature-flag.routes.ts:391-402` — `router.get("/", verifyToken, …)`; dosya yorumu `:4-5` "Her kullanıcının erişimi var (auth-only)".
- Yanıt kümesi: `Teks-Erp/src/services/system-setting.service.ts:1176-1235` (54 alan; yukarıdaki güvenlik alanları `:1213-1232`, `companyLetterhead` `:1198`).
- `:462` — `GET /documents-logo` da yalnız `verifyToken`.
- **Koruma kontrolü (nereye bakıldı, yok):** alan bazlı daraltma YOK (tek `getFeatureFlags`, tüm tüketiciler aynı yükü alır) · izin bazlı görünüm YOK · Electron/mobil ayrı uç kullanmıyor.

**failure_mode.** `Ha***` (tek izin `mobile:kk1`) tokenıyla `GET /api/feature-flags` çağırır ve tam olarak D-G-02'yi planlamak için gereken üç sayıyı öğrenir: kaç yanlış denemede kilit gelir (5), ceza kaç saniye (60), kaç turdan sonra uzun ceza başlar (3) ve ne kadar sürer (15 dk). Ayrıca "PIN girişi açık mı" (evet), "cihaz onayı zorunlu mu" (hayır) ve firmanın vergi künyesini alır.

**Veride fiili ihlal (K2).** Prod kopyasında `system_settings` 34 satır; yanıtın geri kalanı kod varsayılanlarından türer. Bu ucun çağrı izi tutulmuyor (audit yazmaz).

**Öneri (2. tur için).** Yanıtı iki kümeye böl: **UI bayrakları** (herkes) ve **güvenlik/işletim ayarları** (`admin:settings`). Tek `getFeatureFlags` korunsun ama `getFeatureFlags(scope)` ile alan kümesi süzülsün; Electron/mobil bugün zaten yalnız UI bayraklarını okuyor mu — istemci turu ile doğrulanmalı. Bekçi: `test_feature_flag_contract.ts`'e "izinsiz çağrıda güvenlik alanları YOK" kontrolü + **negatif sonda**.
**Kabul kriteri.** `mobile:kk1`-only bir token ile çağrıda yanıt `pinLockout*`, `loginMethods`, `absoluteSessionCapDays`, `backupHour`, `companyLetterhead.taxInfo` içermiyor; panel ekranları bozulmuyor.
**Efor.** 1 gün (backend + istemci turu).
**Önceki defter.** Yeni (`K5` H11, `K1a` H4).

---

### [D-G-11] Cihaz kapısı başlık göndermeyen istemciye HİÇ uygulanmaz ve cihaz kimliği sırsızdır; `POST /work-sessions/close` başka bir cihazın tüm açık oturumlarını kullanıcı eşleşmesi aramadan kapatır

| Şiddet | S3 | Kategori | G (IDOR / nesne kapsamı) | Öncelik | P3 | Modül | KIM/URT | Kanıt seviyesi | K1 |

**Özet.** İki ayrı kusur, aynı kökten: `req.device` tamamen istemcinin gönderdiği `x-device-id` başlığıyla belirlenir ve o başlık bir sır DEĞİLDİR (`Device` modelinde token/secret kolonu yok).
① `resolveDevice`, başlık **hiç yoksa** doğrudan `next()` der — `device.pairingRequired=true` olsa bile. Yani "onaysız cihaz giremez" güvencesi, başlığı göndermeyen istemciye uygulanmaz.
② `WorkSessionController.close`, `req.device.id` ile `closeForDevice` çağırır ve o fonksiyon `updateMany({ where: { deviceId, endedAt: null } })` yapar — **kullanıcı eşleşmesi aranmaz**.

**Kanıt.**
- `Teks-Erp/src/middlewares/device.middleware.ts:38-42`
  ```ts
  const deviceId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!deviceId || typeof deviceId !== "string") {
    return next();          // ← pairingRequired'a HİÇ bakılmaz
  }
  ```
- `:96-104` — `req.device` doğrudan başlıktan çözülen kayıttan kurulur; doğrulayıcı sır yok.
- `Teks-Erp/prisma/schema.prisma:800-824` — `Device` modelinde `token`/`secret` kolonu YOK.
- `mobil/src/utils/deviceId.ts:17-34` — `deviceId` istemcide `Math.random` tabanlı UUID v4 (SecureStore'da saklanır ama sunucuya düz gider).
- `Teks-Erp/src/controllers/work-session.controller.ts:66-74` → `Teks-Erp/src/services/work-session.service.ts:349-368`:
  ```ts
  const res = await prisma.workSession.updateMany({
    where: { deviceId: deviceRowId, endedAt: null },
    data: { endedAt: new Date(), endReason: reason },
  });
  ```
- Route guard: `Teks-Erp/src/routes/work-session.routes.ts:46` — `requireAnyPermission(...MOBILE_SESSION_PERMS)` (dört mobil ekran izninden biri yeter).
- **Koruma kontrolü (nereye bakıldı, yok):** cihaz başına paylaşılan sır / HMAC YOK · `closeForDevice`'ta `userId` filtresi YOK (yorum bunu bilinçli anlatıyor: "Logout = cihaz temiz") · `resolveDevice`'ta "pairing zorunluyken başlık ZORUNLU" dalı YOK · `getStampContext` `req.device` yoksa `null` döner (`work-session.helper.ts:90`), yani `enforceForMobile` de devreye girmez.

**failure_mode.** ① Fabrika cihaz onayını açar (`device.pairingRequired=true`) ve "artık onaysız tablet giremez" varsayar. Onaysız/kişisel bir tablet, geçerli bir operatör tokenıyla `x-device-id` **göndermeden** KK1 ham girişi yapar, Tambur kesimi kaydeder, etiket bastırır — hiçbir kapı kapanmaz; tek fark `machineId=null` atfıdır (izlenebilirlik sessizce boşalır). ② Herhangi bir mobil oturum izni taşıyan kullanıcı, komşu tabletin `deviceId`'sini (fiziksel erişimle ya da onun bir isteğini görerek) öğrenip `POST /api/work-sessions/close` + `x-device-id: <komşu>` gönderir → komşu operatörün açık iş oturumu kapanır. Komşunun bir sonraki Tambur okutması `enforceForMobile` kapısında **409 `WORK_SESSION_REQUIRED`** alır ve vardiya ortasında oturum ekranına düşer; oturum zorlamayan uçlarda (`tambur.controller.ts:287,308,328`, `label.controller.ts:109,533`) ise kayıt `machineId=null` ile sessizce yazılır ve "Bu makine" süzgeci o topları göstermez.

**Veride fiili ihlal (K2).** Prod: 28 cihaz, **28 APPROVED / 0 PENDING**, `machineId` dolu **0**, `device.pairingRequired=false` → bugün ① fiilen zaten kapalı (kapı hiç kullanılmıyor), ② için 106 iş oturumu / 3 açık.

**Öneri (2. tur için).** ① `resolveDevice`: başlık yoksa **ve** `pairingRequired` ise, `/api/*` yolunda 401 `DEVICE_REQUIRED` (statik/public muaf yollar hariç) — kapının anlamı ancak böyle doğru olur; Electron'un başlık göndermemesi bilinçliyse `clientType`/UA ile değil, **onaylı bir DESKTOP cihaz kaydıyla** çözülmeli. ② `closeForDevice`'a `userId` filtresi ekle (`where: { deviceId, endedAt: null, userId }`) — "cihaz temiz" gerekçesi için ayrı bir admin ucu zaten var (`POST /work-sessions/:id/force-close`, `admin:settings`). ③ Orta vade: cihaz kaydına `pairingSecret` ekle, `x-device-id` yerine `x-device-id` + `x-device-token` iste. **Migration gerekir (③) → `[PROD'DA ÇALIŞTIRMA]`, geri alma: kolon nullable, doğrulama bayrakla açılır.**
**Kabul kriteri.** `pairingRequired=true` iken başlıksız `/api/rolls/initial-entry` isteği 401; başka cihazın `deviceId`'siyle `close` çağrısı o cihazın oturumunu kapatmıyor. Bekçi: `test_work_session*.ts` + `test_device_transport.ts` negatif sondayla.
**Efor.** 1 gün (①+②) · 3 gün (③, APK ister).
**Önceki defter.** Yeni (`K5` H4/H12, `K1a` H10).

---

### [D-G-12] `STATION_KIND_PERM` haritasında olmayan bir istasyon türü, izin kontrolünü **sessizce atlar** (fail-open); bugün 4↔4 hizalı ama eşitliği ölçen bekçi yok

| Şiddet | S3 | Kategori | G (fonksiyon seviyesi yetki) + OCP fail-open | Öncelik | P4 | Modül | URT | Kanıt seviyesi | K1 |

**Özet.** İş oturumu açılabilen istasyon türleri (`SESSIONABLE_STATION_KINDS`) ve tür→izin haritası (`STATION_KIND_PERM`) **iki ayrı sabittir**. Kontrol `needM && !matchesPermission(...)` biçimindedir: harita bir türü taşımıyorsa `needM` `undefined` olur, `&&` kısa devre yapar ve **kontrol hiç koşmaz**. Yeni bir tür yalnız birinci listeye eklenirse (derleme hatası vermez, `Record<string,string>` tipi bunu yakalamaz) o istasyon herkese açılır.

**Kanıt.**
- `Teks-Erp/src/services/work-session.service.ts:33` — `SESSIONABLE_STATION_KINDS = ["RAW_QC","PROCESS_QC","TAMBUR","SHIPPING"]`
- `:38-43` — `const STATION_KIND_PERM: Record<string, string> = { RAW_QC:…, PROCESS_QC:…, TAMBUR:…, SHIPPING:… }` (**`Record<string,string>` — `StationKind` ile tip düzeyinde bağlı DEĞİL**)
- `:204-207` (makine dalı) ve `:244-247` (istasyon dalı):
  ```ts
  const needM = STATION_KIND_PERM[machine.station.kind];
  if (input.permissions !== undefined && needM && !matchesPermission(input.permissions, needM)) {
    throw AppError.forbidden("Bu istasyon türünde oturum açma yetkiniz yok");
  }
  ```
- Route kapısı geniş: `Teks-Erp/src/routes/work-session.routes.ts:35` — `requireAnyPermission(...MOBILE_SESSION_PERMS)` (dört izinden **biri** yeter).
- **Koruma kontrolü (nereye bakıldı, yok):** tip düzeyinde exhaustive zorlama YOK (`Record<StationKind, string>` değil, `Record<string,string>`) · `default: throw` dalı YOK · `test_permission_catalog.ts:106-107` yalnız kodların katalogda olduğunu ölçer, **iki listenin eşitliğini ölçmez** · başka bir bekçide `SESSIONABLE_STATION_KINDS` ↔ `STATION_KIND_PERM` karşılaştırması bulunamadı.

**failure_mode.** `StationKind`'a `PACKING` eklenip `SESSIONABLE_STATION_KINDS`'e yazılır, `STATION_KIND_PERM` unutulur (bugüne kadar bu sınıf hatadan **beş vaka** yaşanmış — CLAUDE.md 2026-08-26 "altıncı enum değeri unutuldu"). Sonuç: yalnız `mobile:kk1` taşıyan ham giriş operatörü Paketleme makinesinde iş oturumu **açar ve devralır** (`confirmTakeover` ile başkasının oturumunu kapatarak). Hata mesajı yoktur, 403 yoktur; kod "izin gerekmiyor" gibi davranır.

**Veride fiili ihlal (K2).** Arandı, 0: bugün iki liste de 4 üye ve prod'da `SESSIONABLE_STATION_KINDS` dışında oturum kaydı yok.

**Öneri (2. tur için).** ① Haritayı `Record<(typeof SESSIONABLE_STATION_KINDS)[number], string>` olarak tiple → eksik üye **derleme hatası**. ② Çalışma zamanında da fail-closed yap: `const need = STATION_KIND_PERM[kind]; if (input.permissions !== undefined) { if (!need) throw AppError.forbidden("Bu istasyon türü için oturum izni tanımlı değil"); … }`. ③ Bekçi: `test_permission_catalog.ts`'e iki listenin **birebir** eşitliği + negatif sonda.
**Kabul kriteri.** Haritadan bir üye silinince TypeScript derlemesi kırılıyor; sahte bir kind ile servis çağrısı 403 döndürüyor.
**Efor.** 0,25 gün.
**Önceki defter.** Yeni (`K5` H3).

---

### [D-G-13] `PUT /api/admin/settings/:key` anahtar allowlist'i ve değer şeması taşımaz; boole okuyucular "true" dışındaki her şeyi **false** sayar — bir güvenlik anahtarı açık sanılırken kapalı kalır

| Şiddet | S3 | Kategori | G (konfigürasyon bütünlüğü) | Öncelik | P3 | Modül | CORE | Kanıt seviyesi | K1 |

**Özet.** Genel ayar ucu herhangi bir anahtara ≤2000 karakterlik **düz string** yazar; yalnız üç yapılandırılmış JSON anahtarı reddedilir. Tipli ekranın (`PATCH /api/feature-flags`) Zod sınırları (ör. `pinLockoutAttempts` 1..20, `backupHour` 0..23, `sessionDurationMinutes` 1..43200) bu ikinci kapıdan atlanabilir. Daha kötüsü: `asBoolean` **yalnız tam `"true"` stringini** doğru sayar; `"True"`, `"1"`, `"evet"` → **false**. Yani bir güvenlik bayrağını "açmak" için yanlış yazılan bir değer onu sessizce KAPATIR ve `GET /api/admin/settings` ekranda ham stringi ("True") gösterdiği için yönetici açık sanır.

**Kanıt.**
- `Teks-Erp/src/routes/admin.routes.ts:1081-1084` — `settingUpsertSchema = z.object({ value: z.string().max(2000), description: z.string().max(500).optional() })`.
- `:1144-1168` — handler: yalnız `STRUCTURED_SETTING_KEYS` (3 anahtar) reddedilir; `:1089-1094` o küme (`travelerCardConfig`, `documentsConfig`, `auth.loginMethods`). **`:key` için allowlist YOK.**
- `Teks-Erp/src/services/system-setting.service.ts:49-53`
  ```ts
  function asBoolean(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value === "true";
    return false;
  }
  ```
- Tüketiciler: `readDevicePairingRequired` (`:2338-2347`), `readPinLockoutEnabled` (`:3336-3345`), `readAutoLogoutOnExpiry` (`:3050-3060`), `readKk1DuplicateGuardEnabled`, `readSimulatedWeightEnabled`… — hepsi `asBoolean`.
- Yansıma: `Teks-Erp/src/routes/admin.routes.ts:1105-1109` → `system-setting.service.ts:1012-1018` ham `value` döner (yönetici "True" görür).
- **Koruma kontrolü (nereye bakıldı, yok):** anahtar allowlist'i YOK · anahtar başına tip/aralık şeması YOK · `set()`'te değer normalizasyonu YOK (`system-setting.service.ts:1032-1070` — doğrudan `upsert`) · yazımdan sonra "okunan efektif değer" geri döndürülmüyor (yalnız kaydedilen ham satır) · sayısal okuyucular **iyi** korunuyor (clamp + `null → default`, `readAbsoluteSessionCapDays:3119-3131`), sorun yalnız boole tarafında.
- Hafifletici: Electron yalnız üç sayısal anahtarı bu uçla yazıyor (`Electron/src/services/systemSettingService.ts:14-18,24-33`), yani bugünkü panel yüzeyi dar.

**failure_mode.** Yönetici (ya da bir kurulum script'i) `PUT /api/admin/settings/device.pairingRequired {"value":"True"}` gönderir. `readDevicePairingRequired()` **false** döner → cihaz onayı fiilen kapalı kalır; `GET /api/devices/pairing-required` de `false` döndüğü için tablet hiç şikâyet etmez; `GET /api/admin/settings` ekranında satır **"True"** görünür. Fabrika "cihaz onayını açtık" der, hiçbir şey değişmemiştir. Aynı desen `auth.pinLockoutEnabled` için de geçerlidir: `"1"` yazmak giriş kilidini **kapatır** ve bu, D-G-02'yi tek satırlık bir yazım hatasına indirger.

**Veride fiili ihlal (K2).** Prod kopyasında `system_settings` boole satırları kontrol edildi: `device.pairingRequired = false` (geçerli literal), `label.nativeSendEnabled = false`, `auth.autoLogoutOnExpiry = false` — **bozuk değer bulunamadı**. Mekanizma açık, ihlal yok.

**Öneri (2. tur için).** ① `SETTING_KEYS` üzerinden bir allowlist + anahtar başına Zod şeması (`SETTING_SCHEMAS: Record<string, ZodType>`); bilinmeyen anahtar → 400. ② `asBoolean`'ı **fail-loud** yap: bilinen doğruluk literalleri (`true/false/1/0/on/off`) dışında bir string gelirse kaydetme anında 400 ver (okuma anında hâlâ `false`'a düşsün — fail-closed doğru yön, ama YAZIM engellenmeli). ③ `set()` yanıtına "efektif okunan değer"i ekle, panel onu göstersin. **Migration YOK.**
**Kabul kriteri.** `PUT /admin/settings/device.pairingRequired {"value":"True"}` → 400; bilinmeyen anahtar → 400; bekçi `test_feature_flag_contract.ts`'e §"generic PUT tipli kapıyı atlayamaz" + negatif sonda.
**Efor.** 1 gün.
**Önceki defter.** Yeni (`K1a` H3).

---

### [D-G-14] `GET /api/import/:entity/export` toplu ana veri dökümünü `data:import` istemeden, tavansız ve **audit yazmadan** verir

| Şiddet | S3 | Kategori | G (toplu dışa aktarma + loglama) | Öncelik | P4 | Modül | ICE | Kanıt seviyesi | K2 |

**Özet.** İçe aktarım uçları iki katmanlı yetki ister (`data:import` **VE** varlığın write izni). Dışa aktarım için karar D6 ile yalnız varlığın **read** izni bırakılmış. Sonuç: `customer:read` taşıyan biri tüm cari kartların içe-aktarım şablonundaki **tüm sütunlarını** (vergi no, adres, yetkili adı, telefon, e-posta, not) tek istekte indirir. `limit` verilmezse tavan yoktur (kod yorumu bunu bilerek yazıyor) ve **hiçbir audit satırı yazılmaz** — oysa aynı sınıftaki yedek indirmesi `BACKUP_DOWNLOAD` yazıyor.

**Kanıt.**
- `Teks-Erp/src/routes/import.routes.ts:309-326` — `router.get("/:entity/export", verifyToken, requireEntityRead, …)`; **`requirePermission("data:import")` YOK** (yazma uçlarında var: `:100,130,161,188,216,240,277`), handler'da `AuditService` çağrısı YOK.
- `:50-64` — `requireEntityRead` yalnız `adapter.readPermission`.
- `Teks-Erp/src/services/import/import.service.ts:685-708` — `exportRows`: `const all = await adapter.exportRows();` → `limit` yoksa tümü; yorum `:680-683` "indirme yolu limitsiz çağırır".
- Sütunlar: `Teks-Erp/src/services/import/adapters/customer.adapter.ts:20-50` — `code, name, type, taxNumber, exportCode, address, city, district, country, contactName, contactPhone, email, notes, isActive`; `:58` `readPermission: "customer:read"`.
- Diğer read izinleri (ölçüldü, 17 adaptör): `order:read`, `item:read`, `subcontractor:read`, `station:read`, `quality:read`, `property:read`, `customer-alias:read`, `return:read`.
- **Koruma kontrolü (nereye bakıldı, yok):** ikinci izin YOK · satır tavanı YOK · audit YOK · hız sınırı YOK · alan maskesi YOK.

**failure_mode.** `customer:read` taşıyan 6 aktif kullanıcıdan biri (ya da tokenı ele geçirilmiş biri — D-G-03) `GET /api/import/customer/export` çağırır ve tüm cari kartları JSON olarak indirir. `GET /api/import/order/export` ile tüm siparişler. Olay `system_logs`'ta **hiç görünmez**; `morgan` erişim log'unda bir satır kalır ama o pm2 dosyasına yazılır ve panelden okunamaz.

**Veride fiili ihlal (K2) — maruziyet ölçüldü, bugün DÜŞÜK.**
```sql
SELECT count(*) AS musteri, count("taxNumber") AS vkn, count("contactPhone") AS tel,
       count(email) AS eposta, count("contactName") AS yetkili, count(address) AS adres
  FROM customers;                                   -- 27 | 0 | 0 | 0 | 0 | 0
SELECT count(DISTINCT u.id) FROM users u JOIN user_permissions up ON up."userId"=u.id
  JOIN permissions p ON p.id=up."permissionId"
 WHERE u."isActive" AND p.code IN ('customer:read','*');   -- 6
SELECT count(*) FROM import_runs;                   -- 0 (özellik sahada hiç kullanılmamış)
```
→ **Bugün cari kartlarda hiç kişisel veri yok** (27 cari, tüm PII alanları boş). Yani sızacak şey bugün yalnız ünvan listesidir. Ön muhasebe/ticaret paketi devreye girince (bkz. `MEMORY.md → on-muhasebe-paketi`) bu alanlar dolacak ve aynı uç KVKK kapsamına girecek.

**Öneri (2. tur için).** ① Dışa aktarıma da `data:import` ekle (D6 kararının gerekçesi "ek izin yok"tu — kararın maliyeti şimdi ölçüldü: izsiz toplu döküm). ② **Audit ZORUNLU**: `IMPORT_EXPORT` olayı (varlık, satır sayısı, aktör) — bu, izin kararından bağımsız olarak yapılmalı; "kim ne indirdi" sorusunun cevabı olmalı. ③ İndirme yoluna tavan (`MAX_EXPORT_ROWS`) ve aşımda 413/parçalı sözleşme.
**Kabul kriteri.** `customer:read` var / `data:import` yok → 403; her başarılı export için `system_logs`'ta bir satır; 10.001 satırlık varlıkta tavan davranışı bekçide.
**Efor.** 0,5 gün.
**Önceki defter.** Yeni (`K1a` H13). D6 kararı bilinçliydi; bu bulgu kararı değil, **izsizliği** hedefliyor.

---

### [D-G-15] `POST /api/labels/test-native` gövdeden gelen keyfi IP:port'a ham TCP baytı yazar (SSRF sınıfı) — bugün bayrakla kapalı

| Şiddet | S3 | Kategori | G (SSRF / dış çağrı) | Öncelik | P4 | Modül | BLG | Kanıt seviyesi | K1 |

**Özet.** "Test Et" ucu `printerIp` (3-64 karakter, biçim doğrulaması yok) ve `port` (1-65535) alır; `label.nativeSendEnabled` açıkken sunucu o adrese **ham TCP** bağlanır ve etiket baytlarını yazar. Hedef için hiçbir allowlist / özel-ağ kısıtı yoktur ve yanıt `delivered` + hata metnini döndürdüğü için açık/kapalı port ayırt edilebilir. Bayrak prod'da **false**, yani yüzey bugün kapalı.

**Kanıt.**
- `Teks-Erp/src/controllers/label.controller.ts:78-84` — `testNativeSchema`: `printerIp: z.string().trim().min(3).max(64)`, `port: z.number().int().min(1).max(65535)`.
- `Teks-Erp/src/routes/label.routes.ts:239-243` — `requireAnyPermission("label:print", "station:write")`.
- `Teks-Erp/src/services/helpers/device-transport.ts:32-58` — `sendOverTcp`: `socket.connect(port, host, …)` → **host doğrulaması yok**; `:71-84` `tcpTransport.test()` sadece bağlanır (port tarayıcı).
- Bayrak kapısı: `Teks-Erp/src/services/label.service.ts:951-972` `dispatchOrGuard` + `readLabelNativeSendEnabled()`.
- Prod: `SELECT value FROM system_settings WHERE key='label.nativeSendEnabled'` → **false**; `peripheral_devices` içinde `NETWORK_TCP` **0** kayıt.
- **Koruma kontrolü (nereye bakıldı, yok):** IP/CIDR allowlist YOK · loopback/link-local/özel ağ reddi YOK · DNS adı yasağı YOK · yalnızca kayıtlı `PeripheralDevice.address`e izin verme YOK (gövdeden serbest IP kabul ediliyor) · zaman aşımı VAR (5 sn, `DEFAULT_TIMEOUT_MS`) — DoS'u sınırlar.

**failure_mode.** `label:print` taşıyan 7 kullanıcıdan biri (ya da tokenı ele geçirilmiş biri), bayrak açıldığı gün `POST /api/labels/test-native {"printerIp":"127.0.0.1","port":5432}` gönderir → PostgreSQL'e etiket baytları yazılır; yanıttaki hata metni ("ECONNREFUSED" vs zaman aşımı vs başarı) ile sunucunun **iç port haritası** çıkarılır. `printerIp` bir LAN adresi olduğunda aynı yolla fabrikadaki başka bir cihaza (PLC, kamera, yönlendirici yönetim portu) bayt gönderilebilir — sunucu, ağ içindeki bir proxy'ye dönüşür.

**Veride fiili ihlal (K2).** Arandı, 0: `system_logs`'ta `PERIPHERAL_TEST` **0** kayıt (prod kopyası).

**Öneri (2. tur için).** ① Hedefi **kayıtlı cihazlarla sınırla**: gövdeden `printerIp` almak yerine `peripheralId` iste ve adresi DB'den çöz (`PeripheralDevice.address`, yazma izni `station:write`). Serbest IP gerçekten gerekiyorsa ② bir CIDR allowlist ayarı (`label.allowedPrinterCidrs`) ve loopback/link-local/multicast reddi ekle. ③ Yanıttan ham hata metnini kaldır (`ok/hata` yeter) — port oracle'ını kapatır.
**Kabul kriteri.** `printerIp=127.0.0.1` → 400; kayıtlı olmayan bir adrese gönderim 400; bekçi `test_peripheral_for_device.ts`'e negatif sonda.
**Efor.** 0,5 gün. **Not: bayrak gerektirir** — bugünkü davranış ancak `label.nativeSendEnabled=true` iken gözlenir; bu denetimde bayrak DEĞİŞTİRİLMEDİ.
**Önceki defter.** Yeni (`K1a` H6, `K9` S21).

---

### [D-G-16] `POST /api/admin/db-copies/:name/verify` kardeş uçlardaki ad allowlist'ini uygulamaz — cluster'daki herhangi bir veritabanına bağlanıp sayım yapar ve sahte bir "kopya" kaydı yazar

| Şiddet | S3 | Kategori | G (fonksiyon seviyesi yetki / IDOR) | Öncelik | P4 | Modül | OPS | Kanıt seviyesi | K1 |

**Özet.** DB kopyası ailesindeki üç uçtan ikisi (`dropCopy`, `getSwapCommands`) `isRestoreCopyName(live, name)` allowlist'ini uygular; **`reverifyCopy` uygulamaz**. Sonuç: yükseltilmiş kimlikle (D-G-08) cluster'daki herhangi bir veritabanına bağlanılır, 12 tabloda `count(*)` koşulur ve `dbRestore.copies[<ad>]` altına `state:"ready"` kaydı yazılır — canlı veritabanının adı dahil.

**Kanıt.**
- `Teks-Erp/src/services/db-copy.service.ts:798-830` — `reverifyCopy(copyName)`: **ilk satırdan itibaren hiçbir ad kontrolü yok**, doğrudan `verifyCopy(copyName)`.
- Karşılaştırma: `:665-680` `dropCopy` → `if (!isRestoreCopyName(live, name)) return {...}` + `if (name === live) return {...}`; `:739-746` `getSwapCommands` → aynı allowlist.
- `Teks-Erp/src/services/db-copy-verify.service.ts:376,381,383,392` — `copyName` doğrudan `pg_database_size`, `readLocaleProps`, `readDbGuc` ve `toClientConfig(withDatabase(base, copyName))`e gider (bağlantı hedefi olur).
- `:462-471` — `prismaCount`: `SELECT count(*)::bigint FROM "<table>"` (tablo adı `COUNTED_TABLES` sabitinden, tırnak kaçırmalı — enjeksiyon yok).
- `:820` — `writeCopyRecords(records, await listExistingDbNames())` → `pg_database`'de var olan adlar korunur, yani **canlı DB adı kayıtta kalıcı olur**.
- Route: `Teks-Erp/src/routes/db-copy.routes.ts:108-118` — `verifyToken` + `admin:settings` + `admin:users` (çift guard; `F-OPS-VER-008`'in "tek izin" iddiası **geçersizdi**, burada tekrarlanmıyor). `:name` için Zod/format kontrolü YOK.
- **Koruma kontrolü (nereye bakıldı, yok):** route'ta `:name` şeması YOK · serviste allowlist YOK · `verifyCopy` içinde "canlı DB olamaz" kontrolü YOK · `writeCopyRecords` yalnız var-olmayan DB'leri budar, meşruiyeti sorgulamaz.

**failure_mode.** `admin:settings` + `admin:users` taşıyan bir kullanıcı `POST /api/admin/db-copies/tekserp/verify` çağırır. Sunucu **canlı veritabanına** bakım bağlantısı açar, 12 tabloda `count(*)` koşar (uzun tablolarda kilit değil ama I/O yükü) ve `dbRestore.copies["tekserp"] = { state:"ready", … }` yazar. Bundan sonra "DB Kopyaları" ekranı canlı veritabanını bir **geri yükleme kopyası** olarak listeler. Takas komutu üretimi allowlist'e takıldığı için kazayla canlıya geçilmez, ama ekran yanlış bir gerçeklik gösterir ve bir sonraki operatör "hangisi canlı" sorusunda yanılabilir. Aynı yolla `adnansahin_ticaret` gibi başka bir müşteri/ürün veritabanının satır sayıları öğrenilir.

**Veride fiili ihlal (K2).** Prod kopyasında `dbRestore.copies` ayarı **yok** (özellik 2026-08-26 sonrası); `DB_COPY_*` audit olayı **0**. Yani hiç kullanılmamış.

**Öneri (2. tur için).** `reverifyCopy`'nin ilk satırına `isRestoreCopyName(live, copyName)` kapısını koy (kardeşleriyle birebir aynı mesaj); route'ta `:name` için `z.string().regex(/^[A-Za-z0-9_]{1,63}$/)`. Bekçi: `test_db_copy.ts`'e §"verify canlı DB adını reddeder" + negatif sonda (kapı kaldırılınca kırmızı).
**Kabul kriteri.** `POST /api/admin/db-copies/<canlı>/verify` → 400 "geri yükleme kopyası değil"; `dbRestore.copies` içinde canlı DB adı hiç oluşmuyor.
**Efor.** 0,25 gün.
**Önceki defter.** Yeni (`K9` H-3). ⚠️ `F-OPS-VER-008` (geçersiz) ile karıştırılmamalı — o, izin zinciriyle ilgiliydi ve iddiası yanlıştı; bu, ad allowlist'idir ve doğrulandı.

---

### [D-G-17] rclone uzak hedefi doğrulanmadan pozisyonel argüman olarak geçiliyor — `-`/`--` ile başlayan değer bayrak olarak yorumlanır, `:backend:` biçimi ise yapılandırmasız bir hedefe yönlendirir

| Şiddet | S3 | Kategori | G (argüman enjeksiyonu / veri sızması) | Öncelik | P5 | Modül | OPS | Kanıt seviyesi | K1 |

**Özet.** Offsite yedek hedefi (`backup.offsiteRemote`) panelden yazılan serbest bir stringtir (`max(200)`) ve doğrudan `rclone copy <dir> <remote> …` çağrısına pozisyonel argüman olarak verilir. Aynı dosyada **token adı için** sıkı bir regex varken (`/^[A-Za-z0-9_-]{1,32}$/`) hedef adı için hiçbir kontrol yoktur. Shell YOKTUR (`spawn(file, args[])`) — bu bir **komut** enjeksiyonu değil, **argüman** enjeksiyonudur.

**Kanıt.**
- `Teks-Erp/src/services/helpers/offsite-backup.helper.ts:197-212` — `runProcess(RCLONE_BIN(), ["copy", dir, remote, ...includeArgs, ...configArgs(), "--immutable", …])`; `:125` `["lsf", remote, …]`; `:297` `["lsd", remote, …]`.
- Doğrulama asimetrisi: `:331-345` — `writeRcloneDriveToken`: `if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) return { ok:false, … }` → **hedef adı için böyle bir kontrol yok**.
- Girdi: `Teks-Erp/src/routes/admin.routes.ts:1391-1400` — `remote: z.string().trim().max(200)`; izin `admin:settings` + `admin:users`.
- Shell yok: `Teks-Erp/src/services/helpers/pg-tool.helper.ts:105-110` — `spawn(file, args, { windowsHide:true, env, timeout, killSignal:"SIGKILL" })` (`shell:true` YOK) — **doğru yapılan**.
- **Koruma kontrolü (nereye bakıldı, yok):** `remote` için regex YOK · `--` ayırıcısı (argüman sonu işareti) kullanılmıyor · başarısızlıkta kullanıcıya kapanan bir kapı yok: `src/jobs/offsite-sweeper.ts:53-59` "hedef yok" durumunu yalnız `console.warn` ile geçiyor (`K9` H-5'in akrabası).

**failure_mode.** ① **Sessiz başarısızlık:** yönetici hedefi `--dry-run gdrive:yedek` gibi yapıştırırsa (ya da baştaki tireli bir seçenekle) rclone tek pozisyonel argüman görür ve hata verir; sweeper hatayı yalnız `console.warn` ile geçer, panel "offsite ayarlı" gösterir → **yedekler aylarca dışarı çıkmaz ve kimse fark etmez**. ② **Yönlendirme:** rclone'un "connection string" biçimi (`:sftp,host=…,user=…,pass=…:/yol`) yapılandırma dosyası gerektirmez; `admin:settings`+`admin:users` taşıyan biri hedefi böyle bir değere çevirirse gecelik yedek — **tüm kullanıcıların düz PIN'lerini içeren dump** (D-G-01) — dışarıdaki bir sunucuya kopyalanır. Bu kişi zaten yedeği indirebilir, yani yetki artışı değil; ama **kalıcı, otomatik ve sessiz** bir sızma kanalıdır.

**Veride fiili ihlal (K2).** Prod kopyasında `backup.offsiteRemote` anahtarı **yok** (özellik kurulmamış); `OFFSITE_*` audit olayı 0; `F-OPS-VER-003` (offsite yapılandırma boş) hâlâ açık.

**Öneri (2. tur için).** `remote` için regex (`^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9._/-]{0,160}$` — yani `<yapılandırılmış-hedef>:<yol>`), `:`-ile-başlayan connection-string biçimini **reddet**, argüman listesine `--` ayırıcısı ekle. `offsite-sweeper`'ın "hedef çözülemedi" dalı `JOB_FAILED:OFFSITE` audit'i yazsın (bugün yalnız console).
**Kabul kriteri.** `--dry-run …` ve `:sftp,…:` değerleri 400; geçerli `gdrive:teks-yedek` kabul; bekçi `test_offsite_sweep.ts`'e argüman sondası (bugün sahte rclone ile argümanları ölçmüyor).
**Efor.** 0,5 gün.
**Önceki defter.** Yeni (`K9` H-6). İlgili açık: `F-OPS-VER-003`.

---

### [D-G-18] Kimlik kapsamasının TEK mekanik bekçisi HEAD'de kırmızı — yeni bir kimliksiz uç eklendiğinde sinyal gürültüye karışır

| Şiddet | S3 | Kategori | G (güvenlik kontrolünün kendisi) + K (bekçi) | Öncelik | P3 | Modül | CORE | Kanıt seviyesi | K1 |

**Özet.** "Hiçbir uç `verifyToken`suz yayına çıkmaz" invariant'ının tek koruması `scripts/test_route_auth_coverage.ts`'tir; muaf uçların gerekçeli bir listede olmasını zorlar. 2026-08-28'de eklenen `GET /api/client-policy/` bu listede **yoktur** → bekçi bugün kırmızıdır. Kırmızı bir bekçi, bir sonraki gerçek kimliksiz uç eklendiğinde "zaten kırmızıydı" diye görmezden gelinir.

**Kanıt.**
- Uç: `Teks-Erp/src/routes/client-policy.routes.ts:59` — `router.get("/", (_req, res) => { … })` (guard yok); mount `src/app.ts:587`.
- Muaf listesi: `Teks-Erp/scripts/test_route_auth_coverage.ts:34-75` — `"GET /:istemci"` VAR (`:73`), **`"GET /"` YOK** (`grep '"GET /"'` → 0 vuruş).
- Kontrol: `:185-187` — `const unexpected = unauth.filter((r) => !(r.key in EXEMPT)); check("muaf listesi dışında kimlik doğrulamasız uç YOK", …)`.
- Bekçi statiktir (`readFileSync` + `import app`), DB'ye yazmaz — bu denetimde **koşulmadı** (salt-okunur kuralı), tespit kaynak okumasıyla yapıldı.
- **Koruma kontrolü:** başka bir mekanik kimlik kapsaması bekçisi yok (`grep -rl "verifyToken" scripts/` → yalnız bu dosya invariant'ı zorluyor).

**failure_mode.** CI/koşucu bu bekçiyi kırmızı raporlar; ekip "client-policy yüzünden" diye geçer. Bir hafta sonra biri `POST /api/orders/quick` ucunu `verifyToken`sız ekler; bekçi yine kırmızıdır ve mesaj iki satırlıktır — ikinci satır fark edilmez. Kimliksiz bir yazma ucu üretime çıkar.

**Veride fiili ihlal (K2).** Yok (kod durumu). Ucun kendi ifşası zararsız: iki sürüm numarası, DB'ye dokunmuyor.

**Öneri (2. tur için).** `EXEMPT`'e `"GET /"` girdisini gerekçesiyle ekle (dosyadaki `client-policy.routes.ts:8-11` yorumu zaten gerekçeyi yazıyor: panel giriş öncesi sürüm künyesini sorar). Ayrıca bekçiyi CI'da **bloklayıcı** yap (bugün `run-all-tests.ts` sıralı koşuyor ama kırmızıyla devam ediyor).
**Kabul kriteri.** `npx tsx scripts/test_route_auth_coverage.ts` yeşil; muaf girdisi gerekçe metni taşıyor (bekçi `:185-207` iki yönlü denetimi zaten zorluyor).
**Efor.** 0,1 gün.
**Önceki defter.** `F-CORE-GUV-001` (`duzeltildi` — bekçi yazıldı). Bu, kapanmış bulgunun **yeniden açılması değil**, bekçinin bugünkü kırmızı durumudur (`K1a` H2).

---

### [D-G-19] Sistemde hiç hız sınırı yok; kimliksiz `POST /api/devices/announce` 200 PENDING tavanını doldurup yeni tablet devreye almayı kilitleyebilir

| Şiddet | S3 | Kategori | G (rate limit / DoS) | Öncelik | P5 | Modül | CORE | Kanıt seviyesi | K1 |

**Özet.** Repoda `express-rate-limit` benzeri hiçbir kütüphane/kod yoktur; tek sayısal kapı `announce` ucundaki `MAX_PENDING_DEVICES = 200`'dür. Bu kapı, önlemek istediği şeyin (görünürlük kaybı) **tersini** üretebilecek bir kaldıraç da yaratır: kimliksiz bir istemci 200 rastgele `deviceId` bildirirse tavan dolar ve **meşru yeni tablet 429 alır**. Temizlik satır satır hard-delete'tir (toplu purge ucu yok).

**Kanıt.**
- `grep -rn "rate-limit|rateLimit|express-rate-limit|slowDown" src package.json` → **0**.
- `Teks-Erp/src/routes/device.routes.ts:26` — `devicePublicRouter.post("/announce", DeviceController.announce)` (kimliksiz).
- `Teks-Erp/src/controllers/device.controller.ts:14-18` — `deviceId: z.string().min(8).max(80)` (biçim serbest, ör. rastgele 20 karakter).
- `Teks-Erp/src/services/device.service.ts:22,175-186` — `MAX_PENDING_DEVICES=200`; yeni kayıt eşiği aşarsa `AppError.tooManyRequests(… PENDING_DEVICE_LIMIT)`.
- Aynı yorum (`:163-174`) zararı doğru teşhis ediyor ("admin gerçek tableti binlerce sahte kayıt arasında bulamaz") ve temizliğin satır satır olduğunu yazıyor.
- Diğer kimliksiz uçlar: `/health` (`app.ts:479`, `SELECT 1`), `GET /api/auth/mobile-users`, `GET /api/auth/login-methods`, `GET /api/devices/status`, `/api/mobile/updates/*`, `/api/client-policy/*` — hiçbirinde sınır yok.
- **Koruma kontrolü (nereye bakıldı, yok):** global/uç bazlı hız sınırı YOK · `deviceId` için "cihaz üreticisi/format" doğrulaması YOK · PENDING toplu temizleme ucu YOK (`device.routes.ts:59-115` dokuz admin ucu içinde toplu purge yok) · PENDING kayıtların otomatik yaşlanma/temizlenme işi YOK (`src/jobs/` altında yok).

**failure_mode.** Fabrika ağındaki bir cihaz 200 kez `POST /api/devices/announce {"deviceId":"<rastgele>"}` gönderir (kimlik gerekmez). Ertesi gün alınan yeni tablet açılışta `announce` çağırır → **429 `PENDING_DEVICE_LIMIT`** → tablet eşleşme ekranından çıkamaz. Yönetici Cihazlar ekranında 200 sahte satır arasında yeni tableti bulamaz ve her birini tek tek silmek zorunda kalır. Aynı sırada `/health` ve `mobile-users` uçları da sınırsız çağrılabildiği için bir istek seli tek-process backend'i (PM2 fork, `instances:1`) meşgul edebilir.

**Veride fiili ihlal (K2).** Prod: 28 cihaz, **0 PENDING** — hiç yaşanmamış. (Önceki denetimin ölçümü 27 cihaz / 9 PENDING idi.)

**Öneri (2. tur için).** ① Kimliksiz uçlara IP başına basit bir sayaç (bellek-içi, `login-lockout.ts` deseninin ikizi; tek-process invariant zaten yazılı): `announce` için dakikada 5, `/health` için saniyede 10. ② Admin tarafına "bekleyen cihazları temizle" toplu ucu (yaş süzgeciyle) + `lastSeenAt` 30 günden eski PENDING kayıtları budayan bir job. ③ PENDING tavanı aşıldığında `SYSTEM/DEVICE_PENDING_LIMIT` audit'i (bugün yalnız 429 dönüyor, iz kalmıyor).
**Kabul kriteri.** 200 sahte announce sonrası meşru bir announce hâlâ çalışıyor (eskiler yaşlandığı/budandığı için) ve sel audit'e düşüyor.
**Efor.** 1 gün.
**Önceki defter.** `F-CORE-GUV-003` (`duzeltildi` — tavan eklendi). **Yeniden açılmıyor**; bu, tavanın kendisinin ürettiği yeni failure_mode'dur ve önceki bulguda "IP başına hız sınırı hâlâ yok (bilinçli)" olarak zaten not düşülmüştü.

---

### [D-G-20] Masaüstü erişim kapısı gövdeden gelen `clientType`'a bakar — bu bir güvenlik sınırı değil, istemci nezaketidir; kod ve arayüz aksini söylüyor

| Şiddet | S4 | Kategori | G (fonksiyon seviyesi yetki — yanlış güvence) | Öncelik | P6 | Modül | KIM | Kanıt seviyesi | K1 |

**Özet.** "Yalnız mobil izinli hesap masaüstü paneline giremez" kuralı, giriş isteğinin **gövdesindeki** `clientType` alanına bakar. Alan opsiyoneldir ve verilmezse `mobile` varsayılır; sunucu istemci türünü hiçbir şekilde doğrulamaz. Aynı hesap `clientType` göndermeden token alır ve o token panelde/`curl`'de birebir çalışır — üretilen token'da istemci türü bilgisi yoktur.

**Kanıt.**
- `Teks-Erp/src/controllers/auth.controller.ts:24` — `const clientTypeSchema = z.enum(["electron","mobile"]).optional();` (üç login şemasında da gövdede).
- `Teks-Erp/src/services/auth.service.ts:266-273` — kapı yalnız `ctx?.clientType === "electron"` iken çalışır.
- `:361-367` — imzalanan payload: `{ userId, username, permissions, tokenVersion }` — **`clientType` YOK**, yani sonraki isteklerde tür bilinmiyor.
- `:345-350` — `deviceType` yalnız oturum kaydına yazılır (`ClientType.ELECTRON|MOBILE`) ve `sameTypeSessionPolicy` için kullanılır (prod'da `"off"` → etkisiz).
- **Koruma kontrolü (nereye bakıldı, yok):** User-Agent/origin doğrulaması YOK · cihaz `kind` ile eşleştirme YOK (`req.device.kind` varken kullanılmıyor) · token'da tür claim'i YOK · route katmanında "bu uç yalnız masaüstü" kontrolü YOK.

**failure_mode.** Yalnız `mobile:` izinli bir hesap (prod'da `Ha***`) `POST /api/auth/login {"username":…, "password":…}` (clientType YOK) ile token alır; Electron paneli açıldığında `canEnterApp` **istemci tarafında** onu keser, ama `curl`/Postman kesmez. Yetki artışı YOKTUR (izinleri ne ise o kadar iş yapar) — kusur, **var olmayan bir sınırın var sanılmasıdır**: "bu hesap panele giremez" cümlesi bir güvenlik güvencesi olarak kullanılırsa (ör. D-G-06'nın düzeltmesinde) yanlış temele oturur.

**Veride fiili ihlal (K2).** İlgisiz (mekanizma kusuru).

**Öneri (2. tur için).** Kapıyı ya gerçek bir sınıra çevir (token'a `clientType` claim'i koy + masaüstü uçlarını o claim ile koru — ağır) ya da **belgede/UI metninde "istemci yönlendirmesi, güvenlik sınırı değil" diye açıkça yaz** ve yetki tasarımı bu kapıya dayanmasın. En düşük maliyetli doğru hamle ikincisidir.
**Kabul kriteri.** `auth.service.ts:266-273` üzerindeki yorum ve `Electron/src/types/auth.ts:85-88` yorumu bu ayrımı söylüyor; D-G-06'nın düzeltmesi bu kapıya dayanmıyor.
**Efor.** 0,1 gün (belgeleme) · 2 gün (gerçek sınır).
**Önceki defter.** Yeni (`K5` H11'in ikinci yarısı).

---

### [D-G-21] Audit `oldData/newData` alanları maskesiz yazılır; ticari kimlik bilgileri denetim iznine, arşive ve her yedeğe düz metin girer

| Şiddet | S4 | Kategori | G (KVKK / kişisel veri envanteri) | Öncelik | P6 | Modül | CORE | Kanıt seviyesi | K2 |

**Özet.** `AuditService` çağıranın verdiği `oldData`/`newData` nesnelerini olduğu gibi JSON'a yazar; alan bazlı maske/redaksiyon yoktur. Bugün **sırlar temizdir** (PIN/kart/şifre hiçbir audit satırında yok — ölçüldü, aşağıda) ve müşteri kişisel alanları sahada **boştur**; ama cari/fason kartların ticari kimlik alanları (vergi no) audit'e girmektedir ve ön muhasebe paketi devreye girince telefon/e-posta/yetkili adı da girecektir.

**Kanıt.**
- `Teks-Erp/src/services/audit.service.ts:95-103,144-150,186-190` — `oldData`/`newData`/`payload` doğrudan `JsonValue` olarak yazılır; `grep 'redact|mask|SENSITIVE|passwordHash|quickPin|cardToken' src/services/audit.service.ts` → **0**.
- Doğru yapılanlar (bilinçli): `permission-management.service.ts:43-49` `USER_SELECT` sır kolonu içermez; `auth.service.ts:158-161,178-181,190-193,219-225` PIN/kart audit'i **yalnız `{ username, rotated|cleared }`** yazar, sırrı yazmaz.
- **Ölçüm (prod kopyası):**
  ```sql
  SELECT count(*) FILTER (WHERE "newData"::text ~* 'passwordHash|quickPin|cardToken|"pin"') AS sir,
         count(*) FILTER (WHERE "newData"::text ~* 'taxNumber|contactPhone|"email"') AS kisisel,
         count(*) FROM system_logs;
  -- 0 | 37 | 10485
  SELECT count(*) FROM system_logs
   WHERE ("newData"->>'taxNumber') IS NOT NULL OR ("newData"->>'contactPhone') IS NOT NULL
      OR ("newData"->>'email') IS NOT NULL;                                    -- 1
  SELECT "tableName", action, ("newData"->>'taxNumber') IS NOT NULL AS vkn FROM … ;
  -- SUBCONTRACTOR | UPDATE | t   (2026-07-16)
  ```
  → **Sır sızıntısı 0.** 37 satır bu anahtarları taşıyor ama yalnız **1** satırda gerçekten dolu bir değer var (bir fason firmanın vergi numarası). Kişisel veri (gerçek kişi telefonu/e-postası) bugün **0**.
- **Koruma kontrolü (nereye bakıldı, yok):** alan bazlı maske YOK · veri sınıflandırma listesi (`docs/` altında "kişisel veri envanteri") YOK · silme talebi (KVKK md.7) için audit'ten kişisel veri çıkarma yolu YOK — üstelik D-G-07 düzeltilirse trigger `UPDATE/DELETE`i **engelleyecek** (arşiv yolu `SET LOCAL teks.audit_purge='on'` ile açılıyor, yani yol var ama süreç yazılı değil).

**failure_mode.** Ticaret/ön muhasebe paketi açıldığında cari kartlara yetkili adı + telefon + e-posta girilir. Her `PATCH /api/customers/:id` audit'e eski ve yeni değeri **düz metin** yazar. `report:audit` ya da `admin:settings` taşıyan herkes bunları okur; `system_log_archives` 6 ay sonra aynısını taşır; her gecelik `pg_dump` (offsite dahil, D-G-17) aynısını dışarı taşır. Bir silme talebi geldiğinde kişinin verisi `customers` tablosundan silinse bile audit'te ve tüm yedeklerde kalır.

**Öneri (2. tur için).** ① Bir **kişisel veri alan listesi** (`constants/pii-fields.ts`) ve `AuditService`te tek geçit: listedeki alanlar `"***"` ile yazılır ya da hash'lenir (değişikliğin OLDUĞU görünür, değeri görünmez). ② `docs/` altına kişisel veri envanteri (hangi tablo/kolon, saklama süresi, silme yolu). ③ Silme talebi reçetesi: `customers` anonimleştirme + audit'te ilgili satırların `oldData/newData`'sının maskelenmesi (`teks.audit_purge` penceresiyle, izli).
**Kabul kriteri.** `taxNumber`/`contactPhone`/`email` içeren yeni bir müşteri güncellemesi sonrası `system_logs`'ta değerler maskeli; bekçi `test_audit_pii_mask.ts` negatif sondayla.
**Efor.** 1 gün (kod) + 0,5 gün (belge).
**Önceki defter.** Yeni. **Not:** bugünkü durum sağlıklıdır — bu bulgu, ticaret paketiyle birlikte gelecek maruziyeti şimdi kapatmak içindir.

---

### [D-G-22] Swagger kapısı `NODE_ENV`, morgan aynı soruyu `APP_ENV ?? NODE_ENV` ile soruyor — pm2 dışı bir başlatmada `/api-docs` kimliksiz açık kalır

| Şiddet | S4 | Kategori | G (yüzey / konfigürasyon) | Öncelik | P6 | Modül | CORE | Kanıt seviyesi | K1 |

**Özet.** "Üretimde miyiz" sorusunun iki farklı cevabı var. `setupSwagger` yalnız `NODE_ENV`'e bakar; erişim log formatı `APP_ENV ?? NODE_ENV`'e. `ecosystem.config.js` ikisini de veriyor, yani pm2 ile başlatıldığında sorun yok — ama başka bir yolla (elle `node dist/server.js`, bir servis sarmalayıcı, bir kurtarma senaryosu) yalnız `APP_ENV=production` set edilirse tüm API şeması `/api-docs` altında **kimliksiz** yayınlanır.

**Kanıt.**
- `Teks-Erp/src/config/swagger.ts:68-71` — `if (process.env.NODE_ENV === "production") return;`
- `Teks-Erp/src/app.ts:120` — `const isProd = (process.env.APP_ENV ?? process.env.NODE_ENV) === "production";`
- `Teks-Erp/ecosystem.config.js:75-77` — bugün ikisi de `production`.
- İçerik: `swagger.ts:46-51` — `routes/**` + `controllers/**` taranıyor, yani 580 ucun tamamının yolu, gövde şeması ve izin notu. (⚠️ `K1b` H15: router satırı olmayan üç `@openapi` bloğu da spec'e giriyor — "hayalet uçlar"; ayrı konu.)
- **Koruma kontrolü (nereye bakıldı, yok):** `/api-docs` için guard YOK (mount ya var ya yok) · tek bir "ortam" yardımcısı YOK (iki ayrı ifade) · bekçi YOK.

**failure_mode.** Sunucu bir kurtarma sırasında pm2 olmadan başlatılır ve yalnız `APP_ENV` set edilir. LAN'daki herkes `http://<sunucu>:4000/api-docs` ile tüm uç envanterini, gövde şemalarını ve hangi iznin hangi ucu açtığını okur. Doğrudan bir yetki artışı değildir; keşif süresini kısaltır.

**Veride fiili ihlal (K2).** İlgisiz.

**Öneri (2. tur için).** Tek bir `lib/env.ts` → `export const IS_PROD = (process.env.APP_ENV ?? process.env.NODE_ENV) === "production"` ve her iki yer onu kullansın. `grep -rn 'NODE_ENV' src` ile başka ayrışma var mı taransın. Bekçi: `scripts/test_env_flags.ts` — `NODE_ENV`in doğrudan okunduğu yer sayısı sabit.
**Kabul kriteri.** `APP_ENV=production node dist/server.js` ile `/api-docs` 404.
**Efor.** 0,25 gün.
**Önceki defter.** Yeni (`K1a` H17).

---

### [D-G-23] `requirePermission(undefined)` 403 değil **500** üretir; bugün bu değeri üretebilen bir yol yok ama davranışı ölçen bekçi de yok

| Şiddet | S4 | Kategori | G (guard zinciri — gelecek tuzağı) | Öncelik | P6 | Modül | CORE | Kanıt seviyesi | K0 |

**Özet.** Beceri paketi §7.8'in altıncı kaynağı (handler içinde dinamik izin çözümü) için sınır davranışı okundu. `requirePermission(undefined)` fail-closed'dır ama **403 değil 500** verir: `required.indexOf(":")` `TypeError` atar, Express hata zinciri jenerik "Sunucu hatası oluştu." döndürür. `requireAnyPermission()` (boş liste) ise doğru şekilde 403 verir. Bugün `undefined` üretebilen bir çağrı yeri **yoktur** — dinamik kapıların hepsi eksik anahtarda guard'dan ÖNCE 400 ile kesiyor.

**Kanıt.**
- `Teks-Erp/src/middlewares/rbac.middleware.ts:38-46`:
  ```ts
  if (userPermissions.includes("*")) return true;            // :39
  if (userPermissions.includes(required)) return true;       // :40
  const colon = required.indexOf(":");                       // :41  ← undefined → TypeError
  ```
  ⚠️ **`:39` load-bearing:** `"*"` taşıyan bir kullanıcı `undefined` gereksinimden de **geçerdi**. Katalogda `"*"` kodu yok (prod DB'de de yok, ölçüldü) → bugün ölü dal.
- `:80-89` — `requireAnyPermission` boş listede `[].some(...)` → `false` → **403** (doğru).
- Dinamik kaynakların hepsi önceden kesiyor: `printed-document.routes.ts:100-104` (400) · `record-info.routes.ts:83-85` (400) · `config-bundle.routes.ts:67-68` (400) · `import.routes.ts:33-37` (adaptör yok → 404) · `master-data-merge.routes.ts:39-46` (400) · `feature-flag.routes.ts:38-46` (fail-closed geniş dal).
- **Koruma kontrolü:** bu davranışı ölçen sonda aranmadı → bulunmadı (`grep -rn 'requirePermission(undefined' scripts/` → 0).

**failure_mode.** Bugün üretilemez. Yarın biri "haritada yoksa `undefined` geçir, guard nasılsa reddeder" kalıbıyla yeni bir dinamik kapı eklerse (`DOC_PERMISSIONS` deseninin naif kopyası) sonuç kullanıcıya 500 "Sunucu hatası" olarak görünür; operatör "sistem bozuk" der, gerçek sebep (yetkisiz) hiçbir yerde yazmaz ve destek turu boşa gider. Ters yönde: eğer bir gün `"*"` kodu katalogda doğarsa aynı kalıp **fail-open**'a döner.

**Öneri (2. tur için).** `requirePermission`'ın başına `if (typeof requiredPermission !== "string" || !requiredPermission) → AppError.forbidden(...)` (fabrika çağrıldığı anda ya da middleware içinde). Bekçi: `scripts/test_rbac_edge.ts` — `undefined`/`""`/boş liste üç durumu; negatif sonda ile.
**Kabul kriteri.** `requirePermission(undefined as unknown as string)` middleware'i 403 döndürüyor; `"*"` sahibi de geçemiyor.
**Efor.** 0,1 gün.
**Önceki defter.** Yeni (`K5` H2).

---

## 2. SQL ENJEKSİYONU — 19 ham SQL çağrısının tamamı denetlendi, BULGU YOK

Bu, "bakılmadı" değil "bakıldı ve temiz" sonucudur; kanıtıyla bırakılıyor ki 2. tur bunu yeniden türetmesin.

`grep -rn '\$queryRawUnsafe|\$executeRawUnsafe' src --include='*.ts'` → **19** çağrı, 3 dosya: `master-data-merge.service.ts` (17), `base.service.ts` (1), `db-copy-verify.service.ts` (1).

| Konum | Tanımlayıcı (tablo/kolon) nereden | Kullanıcı girdisi nerede | Karar |
|---|---|---|---|
| `base.service.ts:923-932` (`findSimilarNames`) | `table` ← Prisma **DMMF** (`tableNameFor`, `:112-121`); `field/codeField/scopeField` ← servis config sabitleri; hepsi `q()` ile `"` ikilemeli kaçırma (`:861`); `LIMIT ${limit}` ← `Math.min(Math.max(opts.limit ?? 5,1),20)` **sayısal clamp** | Kullanıcı adı yalnız `$1` (katlanmış); `scopeValue`, `excludeId`, eşik, LIKE deseni `$n` | **Temiz** |
| `db-copy-verify.service.ts:462-471` (`prismaCount`) | `table` ← sabit `COUNTED_TABLES`; `.replace(/"/g,'""')` | yok | **Temiz** |
| `master-data-merge.service.ts:441-448` | `META[entity].table`; `entity` ← `assertEntity` allowlist (route `:39-41` `MERGE_ENTITIES`) | yok | **Temiz** |
| `:629-634, :795-803, :834-852, :866-896, :921-949, :966-1021` (14 çağrı) | `MERGE_MAP` sabit kural listesi (`constants/merge-map.ts`) — `rule.table/column/uniqueOn`; `rollColumn ∈ {itemId,colorId}`, `woCol ∈ {targetItemId,targetColorId}` koddan | `survivorId`, `sourceIds` (route Zod `uuid`) yalnız `$1/$2` | **Temiz** |
| `:1043-1052` (`describeConflict`) | **Dinamik `ORDER BY`** ama kolonlar `rule.uniqueOn` sabitinden ve `"` ile sarılı | `$1/$2` | **Temiz** |

**Ek — `Prisma.raw` (tagged template içinde ham parça), 5 nokta:** `constants/time.ts:71,90` (`columnExpr` + `timeZone`), `subcontractor.service.ts:342` (enum sabitleri), `helpers/audit-value-resolver.ts:111-112` (`FIELD_SOURCES` sabit haritası). Bunların hiçbirinde istemci girdisi yok. **[VARSAYIM]** `constants/time.ts`'in 9 çağıranı bu turda tek tek okunmadı (K5 de okumamıştı) — `columnExpr` bir string literal olarak geçiyorsa temiz; **2. tur bunu doğrulasın** (K5 `KAPSANMAYAN` listesinde de açık).

**Dinamik `ORDER BY` / filtre (Prisma tarafı, raw değil):** `BaseService.safeSortBy` istemci `sortBy`'ını DMMF alan kümesiyle süzer (`base.service.ts:171`, `:358` `relationSortMap`) ve boot bekçisi `assertBaseServiceGuards` fail-closed'dır (`:191-200`, `server.ts:39`). Buradaki risk enjeksiyon değil, **filtre allowlist'inin modelin TÜM skaler kolonları olması**dır — o `F-CORE-GUV-006` (bilgi, açık, bekçi yazılmadı) ve **bu turda yeniden açılmadı**.

---

## 3. Uygulanan kontrol listesi (Bölüm 3-G, madde madde)

| Madde | Durum |
|---|---|
| **IDOR/BOLA — nesne sahipliği** | **Uygulandı.** Tek tenant olduğu için kapsam kullanıcı/cihaz/oturum nesneleriyle sınırlı. `UserPreference` self-scoped ✓ (`user-preference.controller.ts:40-45,72-78` — `userId` yalnız `req.user`'dan, gövdede id yok) · logout kendi `jti`'si ✓ (`auth.controller.ts:465`) · `WorkSession.open` `userId`/`deviceRowId` gövdeden alınmıyor ✓ · **`WorkSession.close` cihaz kapsamlı ve kullanıcı eşleşmesi aramıyor → D-G-11** · `Device` kullanıcıya bağlı değil, sahiplik sırsız başlıkla → D-G-11. |
| **Fonksiyon seviyesi yetki (onay, maliyet, dönem kapatma)** | **Uygulandı.** 268 `requirePermission` + 235 `requireAnyPermission`; altı guard kaynağının hepsi çözüldü (§7.8): route satırı, dizi sabiti (7 rapor dosyası), tekil sabit (10), `router.use` (YOK), mount (yalnız `app.ts:562-569`), handler-içi dinamik (11 nokta). Bulgular: D-G-01, D-G-04, D-G-06, D-G-12, D-G-14, D-G-16. SoD üçlüsü (`shipping:invoice`, `shipping:undo-dispatch`, `roll:manual-adjust`) → §4'te "sınır ötesi". |
| **Alan seviyesi yetki** | **Uygulandı.** D-G-09 (`resolveExact` kova süzgecinden muaf), D-G-10 (54 ayar herkese), `GET /api/admin/settings` ham 34 satır (aynı izin, bulgu değil). Maliyet/kâr marjı **N/A** — ERP maliyet katmanı taşımıyor (KUNYE). |
| **SQL injection (`$queryRawUnsafe`/`$executeRawUnsafe`, dinamik ORDER BY)** | **Uygulandı — 19/19 temiz.** §2, tablo ile. Somut payload denendi (zihinsel): tanımlayıcı konumuna kullanıcı girdisi giren tek bir nokta bulunamadı. **Hiçbir sorgu çalıştırılmadı.** |
| **Sırlar (repo, git geçmişi)** | **Uygulandı.** D-G-05 (`.env` izleniyor, 3 sürüm, rotasyon commit'i dahil). `ecosystem.config.js` sır taşımıyor ✓; `system_settings`'te `token|secret|password|rclone` adlı satır **0** ✓; `Electron/.env.production` izleniyor ama sır taşımıyor (yayın adresi). |
| **Toplu dışa aktarma + loglama** | **Uygulandı.** D-G-14 (`/import/:entity/export` — izinsiz+izsiz+tavansız). Rapor CSV export'ları `report:*` izinleriyle korunuyor; muhasebe export'u `shipping:accounting` — bunlar audit yazmıyor (aynı sınıf, D-G-14 önerisi ikisini de kapsar). |
| **KVKK (kişisel veri envanteri, loglarda TCKN/telefon, silme talebi)** | **Uygulandı.** D-G-21. Ölçüm: audit'te sır **0**, dolu kişisel/ticari alan **1** (fason vergi no); müşteri tablosunda PII **0**. Kişisel veri envanteri belgesi **yok**; silme talebi reçetesi **yok**. |
| **DB kullanıcısı süper yetkili mi** | **Uygulandı.** D-G-08 — dev'de `rolsuper=true` ÖLÇÜLDÜ; prod **[VARSAYIM]** (canlıya erişim yok). |
| **Dosya yükleme (tip/boyut/traversal/erişim)** | **Uygulandı — bulgu yok.** Sunucuya dosya YÜKLENMİYOR (multipart yok; içe aktarım JSON satır dizisi). Dosya OKUMA yolları: `backup.service.ts:490-500` (`basename` + `.dump$` + kök prefix, resolve-sonrası ✓), `mobile-update.service.ts:66-99` (resolve-sonrası prefix ✓, dizin listeleme yok, bekçi `test_mobile_update §6`), `express.static(public)` = 3 dosya (`index.html`, `logo.png`, `status.js` — ölçüldü). ⚠️ Gövde tavanı: global `express.json({limit:"1mb"})` route-level 10 MB parser'ları gölgeliyor — bu `K9` H-1, **doğruluk/ops alanı**, güvenlik değil (sınır ötesi). |
| **Rate limit / brute force / JWT süresi & iptali** | **Uygulandı.** D-G-02 (brute force), D-G-03 (JWT süresi/iptali), D-G-19 (rate limit yokluğu), D-G-23 (guard sınır davranışı). |
| **Ek: `.env`/git dışı sır yüzeyi (backup, rclone config)** | **Uygulandı.** D-G-17; `writeRcloneDriveToken` `0o600` + yedek dizini dışı + token loglanmıyor ✓ (doğru yapılan). |
| **Ek: audit değiştirilemezliği** | **Uygulandı.** D-G-07. |
| **Ek: shell/DDL enjeksiyonu** | **Uygulandı — komut enjeksiyonu YOK.** `spawn(file, args[])`, `shell:true` hiçbir yerde yok; şifre `PGPASSWORD` env ile (`pg-tool.helper.ts:105-110`); DDL tanımlayıcıları `quoteIdent`/`quoteLiteral` (`pg-conn.helper.ts:103-108`). Kalan: argüman enjeksiyonu (D-G-17) ve ad allowlist'i (D-G-16). |
| **Ek: CORS / helmet / HTTPS** | **Uygulandı — yeni bulgu YAZILMADI.** `F-CORE-GUV-005` reddi geçerli (cookie yok → CSRF yok); CORS `*` yalnız D-G-02'nin büyütücüsü olarak anıldı. helmet CSP varsayılan + `upgradeInsecureRequests:null` + HSTS kapalı — **bilinçli HTTP-only LAN kararı** (`app.ts:96-101`), D-G-03'ün gerekçesine dahil edildi. |
| Fiyat/maliyet/dönem kapatma yetkileri | **Kapsam dışı — sebep:** ERP fatura kesmiyor, maliyet katmanı ve muhasebe dönemi yok (KUNYE + kök CLAUDE.md). `finance.pricingEnabled` bayrağı var ama uçları bu turda kapsam dışı (ön muhasebe paketi ayrı dalda). |
| Çok kiracılı veri izolasyonu | **Kapsam dışı — sebep:** DB-per-müşteri; `companyId`/tenant kolonu yok. `Order.branchId` ölçüldü: **kullanıcı↔şube bağı YOK** (`User` modelinde ve JWT payload'ında şube alanı yok, `schema.prisma:353-380` / `types/api.types.ts:47-59`) → satır düzeyi kapsam mevcut değil, yetki tamamen fonksiyonel. Bu, tek-tenant için **doğru** bir tasarımdır; bulgu yazılmadı, ama ikinci bir şube gerçek bir yetki sınırı olacaksa (ör. şube müdürü yalnız kendi siparişlerini görsün) bugün hiçbir mekanizma yoktur — 2. tur için not. |
| Prod `.env` içeriği / `JWT_SECRET` eşitliği | **Kapsam dışı — sebep:** canlıya erişim yok, sır rapora girmez. D-G-05'te [VARSAYIM] olarak işaretli, ops sorusu yazıldı. |
| Prod `teks.audit_guard` değeri | **Kapsam dışı — sebep:** per-DB GUC `pg_restore` ile kopyaya taşınmaz; kopyadan doğrulanamaz. D-G-07'de [VARSAYIM] + doğrulama komutu yazıldı. |
| `constants/time.ts` `Prisma.raw` 9 çağıranı | **Kapsam dışı — sebep:** bu turda tek tek okunmadı (K5 de okumamıştı); §2'de [VARSAYIM] ile işaretli, 2. tura devredildi. |
| Electron/mobil istemci tarafı izin uygulaması | **Kapsam dışı — sebep:** istemci alanı. Yalnız aynalar doğrulandı: `Electron/src/types/auth.ts:66-77` (`matchesPermission` birebir kopya), `:85-88` (`canEnterApp`), `Electron/src/lib/permissions.ts:25-32` ↔ `constants/document-design.ts:37-44` (bekçili). |

---

## 4. Doğru yapılanlar (korunması gerekenler)

1. **Anahtar-kapsamlı guard deseni ve FAIL-CLOSED disiplini.** `PATCH /api/feature-flags` (`feature-flag.routes.ts:38-46`) gövdedeki anahtarlar tam olarak `{documentsConfig, travelerCardConfig}` alt kümesiyse dar izne düşer, **tek yabancı anahtar ya da boş gövde geniş izne çıkar**; `config-bundle.routes.ts:45-59` aynı dersi paketteki her tür için ayrı ayrı uygular ve `PERMISSION_TEMPLATE`i belge tasarımından ayırıp `admin:users`a bağlar; `printed-document.routes.ts:98-107` bilinmeyen `docType`'ı guard'a **hiç geçirmeden** 400 ile keser. Üçü de üç negatif sondalı bekçi taşıyor (`test_document_template_permission.ts`). Bu, beceri §7.8'in altıncı kaynağının doğru uygulanışıdır — **düz OR'a çevirmeyin.**
2. **Anında iptal edilebilir oturum.** `verifyToken` her istekte hem `User.tokenVersion` hem `Session(jti).revokedAt` okur (`auth.middleware.ts:74-102`), jti'siz eski token'ı **fail-closed** reddeder ve `revokeReason`a göre operatöre doğru Türkçe mesajı verir. İzin/şifre değişiminde `tokenVersion++` mutasyonla **AYNI tx'te** koşar (`permission-management.service.ts:217-219,333-335,394`). JWT'de `algorithms:["HS256"]` sabitlenmiş (algoritma karışıklığı/`none` kapalı, `auth.service.ts:388`) ve secret <32 karakterse süreç boot'ta ölür.
3. **Son-admin bekçisinin kilit disiplini.** `acquireAdminGuardLock` (`permission-management.service.ts:598-610`) **tx içinde ve korunan okumadan ÖNCE** 2-argümanlı `pg_advisory_xact_lock(8025,…)` alır; yorumda TOCTOU vakası yazılı. Namespace ayrımı (8021 mükerrer / 8022 parti / 8024 oturum / 8025 izin / 8026 kod / 8027 merge) `F-KIM-GUV-003` sonrası temiz. Kusur bekçinin **tetikleyicisindedir** (D-G-04), mekanizmasında değil — kilit deseni aynen korunmalı.
4. **Çocuk süreç ve dosya yolu hijyeni.** Tek `spawn` kapısı (`pg-tool.helper.ts:98-138`): `shell` yok, argümanlar dizi, şifre yalnız env, `timeout` + `SIGKILL`, stdout/stderr 64 KB tavanlı, `windowsHide`. Yol doğrulamaları **resolve-SONRASI** prefix kontrolü yapıyor (`mobile-update.service.ts:66-76`, `backup.service.ts:490-500`) — kodlanmış/karışık ayırıcılı yolları kaçıran "önce kontrol et" hatasına düşmemişler.
5. **Sırların audit'e sızmaması.** `USER_SELECT` sır kolonu içermiyor (`permission-management.service.ts:43-49`); PIN/kart rotasyonu audit'e yalnız `{username, rotated|cleared}` yazıyor (`auth.service.ts:158-193,219-225`). Ölçüldü: **10.485 audit satırının 0'ında** `passwordHash|quickPin|cardToken` geçiyor. Yedek indirmesi çift izin + `BACKUP_DOWNLOAD` audit'i taşıyor (`admin.routes.ts:1256-1278`). Bu disiplin D-G-01'in düzeltmesinde **aynen** `credentials` ucuna taşınmalı.
6. **Mass-assignment kapısı ve boot fail-closed'ı.** `BaseController.sanitizeWriteData` DMMF tabanlı; `assertBaseServiceGuards()` `server.ts:39`'da boot'ta koşuyor ve süzgeç bozulursa süreç açılmıyor. `grep 'data: req.body|...req.body'` → **0**.

---

## 5. Sınır ötesi notlar

| Gözlem | Yer | Hangi alana |
|---|---|---|
| **SoD tasarımı sahada uygulanmamış (İŞ KARARI, kod kusuru değil).** `role-template-catalog.ts:84-88,237-238` "üç tehlikeli yetki yalnız Muhasebe/Süpervizör rollerinde" der; prod ölçümü: `shipping:undo-dispatch` **6/8** aktif kullanıcıda, `roll:manual-adjust` **6/8**, `admin:*` 3/8. Ayrıca `INVOICE_WRITE = requireAnyPermission("shipping:invoice","shipping:write")` (`shipping.routes.ts:15-18`) — sevkiyatçı da fatura işaretleyebilir (bilinçli, yorumda yazılı; **tek yönlü SoD**). | prod `user_permissions` | Konfig/operasyon (iş kararı) — D-G bulgusu YAZILMADI, kod doğru davranıyor |
| `GET /api/admin/settings` 34 satırı ham döner (`updatedBy` dahil) — aynı izin, bulgu değil ama yanıt kapsamı geniş | `admin.routes.ts:1105-1109` | K1 (yanıt kapsamı) |
| Global `express.json({limit:"1mb"})` route-level 10 MB parser'ları gölgeliyor → içe aktarım fiilen 1 MB (ölçülmüş: 1,98 MB → 413) | `app.ts:141`, `import.routes.ts:28` | **D-F (API/Express)** ve **doğruluk** — güvenlik değil |
| `describeConflict` (`master-data-merge.service.ts:1043-1052`) `SELECT s.*` ile ilgili tablonun **tüm kolonlarını** merge önizlemesine döker; `catch { count = 0 }` hatayı yutuyor | aynı | D-I (gözlemlenebilirlik) + D-F (yanıt kapsamı) |
| `printed-document.service.ts:357-433` `getCurrent` — **GET üzerinde yazma** ve audit'te `userId: undefined` (kimliksiz audit satırı) | aynı | D-D (tx sınırları) + D-I |
| `work-session.controller.ts:77-85` `GET /current` öz-onarım YAZIMI yapıyor (NEW_LOGIN kapanışı) — GET yan etkili | aynı | D-A (eşzamanlılık) |
| `verifyToken` her kimlikli istekte **2 DB okuması** + `lastSeenWrites` Map; 121 aktif oturum × yoklama | `auth.middleware.ts:16-43,74-102` | D-H (performans) |
| `bcryptjs` (saf JS, maliyet 10) tek event loop'ta; genel eşzamanlı-bcrypt tavanı yok; kilit bcrypt'ten ÖNCE (doğru sıra) | `auth.service.ts:73`, `auth.controller.ts:104-128` | D-A (CPU-bound, tek process) — D-G-02'de DoS ayağı olarak anıldı |
| `login-lockout`, `presence`, `featureFlagsCache`, `isCopyJobRunning` bellek-içi; tek-process invariant **yazılı** ama lockout için mekanik bekçi yok | `login-lockout.ts:24`, `ecosystem.config.js:42-48` | D-A / D-K (bekçi) |
| `sessions` tablosu 214 satır, 121 aktif; purge yalnız elle admin ucu (`sameTypeSessionPolicy=off` ile büyüme sınırsız); 10 satır süresi geçmiş + `revokedAt NULL` | `session-registry.service.ts:168-176` | D-C (veri hijyeni) |
| `parseKinds` boş `?kinds=` için TÜM türleri döner ve `assertKindPermissions` hepsini arar → yorum "boş = izinli tüm türler" der ama davranış "boş = hepsinin izni gerekli" (fail-closed, **belge↔kod ayrışması**) | `config-bundle.routes.ts:61-72` | D-L (kod kalitesi / belge) |
| `DOC_PERMISSIONS.TRAVELER_CARD.write` listede ama uç 400 döndürüyor (`SELF_MANAGED_DOC_TYPES`) | `printed-document.routes.ts:76-94` | D-F / OCP kayıt defteri |
| `K1b` H14: `printed-document.routes.ts:135-140` `sample-html` SABİT `admin:settings` iken kardeşi `traveler-card.routes.ts:124-129` `DOCUMENT_DESIGN_READ` — Belge Şablonları ekranı `document-template:read` ile açılıyorsa önizleme sessiz 403 | aynı | D-F + Electron turu |
| `label-renderer.registry.ts:59-72,87` — bilinmeyen `PrinterLanguage` `RASTER_HTML`e düşüyor (**OCP fail-open**), `CONTENT_TYPES` ise tam `Record` (derleme hatası) — iki tablo farklı disiplinde | aynı | D-L (mimari/OCP) |
| Mobil OTA public uçları kimliksiz ve **bilinçli**; koruma kimlik değil **kod imzalama** (`test_mobile_update.ts`). Bu turda imza doğrulamasının istemci tarafı okunmadı | `mobile-update.routes.ts:44-83` | D-K (bekçi) / mobil |
| `device.pairingRequired` prod'da `false` ve `GET /api/devices/status` **herhangi bir** `deviceId` için makine/istasyon atfını döner (bilinmeyen → `UNKNOWN`) — cihaz kimliğini bilen biri hangi makineye bağlı olduğunu öğrenir | `device.service.ts:209-213` | D-G-11'e dahil; ayrıca D-I (izlenebilirlik) |
| `req.device.machineId` prod'da **hep NULL** (28 cihazın 0'ında atama var) → statik makine atfı hiç kurulmamış; enforce'suz 9 uçta `machineId=null` sessizce yazılıyor | prod `devices`, `K5` §5.3 | D-I (izlenebilirlik) — D-G-11'in ikinci yarısıyla akraba |

---

## 6. KAPSANMAYAN / ERİŞİLEMEYEN

| Madde | Sebep |
|---|---|
| Canlı prod sunucusu (`.env` içeriği, `JWT_SECRET`, `teks.audit_guard`, DB rolünün `rolsuper` durumu, `BACKUP_PG_USER` set mi) | Erişim yok. Üçü de [VARSAYIM] olarak işaretlendi ve **ops'a sorulacak somut komut** her bulguda yazıldı. |
| Prod kopyasının son 5 migration'ı (190/195) | `duplicate_reviews`, `roll_plan_deviations`, `order_lines.cancelledAt` gibi tablolar/kolonlar kopyada yok; bu turda yetki/oturum/cihaz tablolarında kolon farkı gözlenmedi, tüm sorgular çalıştı. |
| `constants/time.ts` `Prisma.raw` 9 çağıranının `columnExpr` kaynağı | Okunmadı; §2'de [VARSAYIM]. |
| Herhangi bir bekçinin ÇALIŞTIRILMASI (`test_route_auth_coverage`, `test_permission_catalog` …) | Salt-okunur kuralı: bekçiler `src/app.ts`i import ediyor ve bir kısmı dev DB'ye yazıyor. Tespitler kaynak okumasıyla yapıldı; D-G-18 statik olarak doğrulandı. |
| Uçların ÇALIŞTIRILARAK doğrulanması (403/500/429 gözlemi) | Denetim salt-okunurdur; hiçbir istek gönderilmedi. `requirePermission(undefined)` → 500 sonucu JS semantiğinden çıkarıldı (K0 olarak işaretlendi). |
| Electron/mobil istemcilerin izin uygulaması, `Electron/src/pages/*` kart/route izin listeleri | İstemci alanı; yalnız ayna mekanizmaları ve bekçileri doğrulandı. |
| Fabrika ağının topolojisi (kablosuz güvenliği, VLAN, sunucunun hangi arayüzlerde dinlediği) | Erişim yok. D-G-02/D-G-03'ün "LAN'da sniff/çok-IP" varsayımı `app.listen(HOST="0.0.0.0")` (`server.ts:17-20,79`) ve HTTP-only kararına dayanıyor; ağ segmentasyonu varsa olasılık düşer, **şiddet değişmez**. |
| Git geçmişindeki diğer sır adayları (`.env` dışında) | Yalnız `git ls-files | grep .env` taraması yapıldı; tam bir `gitleaks` taraması koşulmadı (araç yok, ayrıca çıktısı sır içerir). 2. tura önerildi (D-G-05 önerisi 3). |
| `report:*` uçlarının alan seviyesi yetkisi (hangi rapor hangi kolonu döner) | D-G alanında yalnız izin kapıları denetlendi; rapor içeriğinin hassasiyeti K7b/D-H alanı. |
| Muhasebe/ticaret dalındaki (`feature/depo-mal-kabul`) ön muhasebe uçları | Bu dalda (`adnansahin`, HEAD `ce8681d1`) yok. D-G-21 o paketin geleceğini hesaba katarak yazıldı. |
