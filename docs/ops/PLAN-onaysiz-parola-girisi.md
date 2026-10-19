# PLAN — Onaysız tabletten yalnız parola girişi (`device.unpairedPasswordLogin`)

> Durum: 2026-10-19, dal `feature/unpaired-password-login`. Karar notu `docs/history/arsiv/2026-10.md` § 2026-10-19; kural satırı `docs/kurallar/kesif-cihaz.md` (G21-K satırı).

## 0. Hedef ve sınır

Barındırılan (bulut) kurulumda onaylanmamış tablet, yönetici onayını beklemeden YALNIZ kullanıcı adı + parolayla girebilsin (Play incelemecisi, kapalı test, sunum). Fabrikada da açılabilir; varsayılan KAPALI = bugünkü davranış.

Değişmeyenler (kullanıcı kararı):
- `readDevicePairingRequired` barındırılanda `true` kalır; yeni cihaz PENDING doğar (otomatik onay YOK).
- G21-K: `shortCredentialApprovedDeviceOnly` barındırılanda zorunlu; `PAIRING_FORCED` / `HOSTED_CLASS_FORCED` 409'ları aynen.
- Cihaz kanıtı onaylı cihaz için aynen zorunlu (barındırılanda daima, fabrikada `device.proofRequired`).

## 1. Ölçülen başlangıç (kod okuması)

- `DeviceStatus` = `PENDING | APPROVED`; ayrıca `isActive`. Durumlar:
  - **PENDING + aktif** → hiç onaylanmamış YA DA `revoke` edilmiş cihaz ("onaysız ama yasaklanmamış").
  - **APPROVED + aktif** → onaylı.
  - **pasif (`isActive=false`)** → yöneticinin `deactivate`i; yanıtlarda `INACTIVE` (yasaklanmış).
  - **kayıt yok** → hiç bildirilmemiş ya da sert silinmiş (tablet `announce` ile yeniden PENDING açar).
- `device.middleware`: başlık yoksa geçer (web/panel); onaylı cihaz `req.device` olur (kanıt kuralıyla); onaysız/pasif/yok → eşleştirme zorunluysa 401 `DEVICE_INACTIVE`, değilse `req.device`siz geçer.
- Kapalı kalması istenen dört yüzey bugün `req.device`e bağlı: personel listesi (`!req.device && pairingRequired` → 401 `DEVICE_REQUIRED`), PIN/kart (`rejectUnapprovedDevice`, yalnız kısa kimlik kuralı açıkken), indirme belirteci (`requireApprovedDeviceOrSession`: onaylı cihaz YA DA oturum).
- Çalışma oturumu (`work-session.controller requireDevice`) `req.device` ister → onaysız cihazda 400 `DEVICE_REQUIRED`; damga bağlamı (`getStampContext`) `req.device` yoksa null → makine atfı NULL.

## 2. Tasarım

### Backend
1. Bayrak `device.unpairedPasswordLogin` (API `deviceUnpairedPasswordLogin`), okuyucu `readDeviceUnpairedPasswordLogin(tx?)` kayıt yokken `false`. Barındırılanda ZORLANMAZ (açılıp kapanabilir). Davranış bayrağıdır → profile/seed'e girmez. Panel yüzeyi `DevicePairingSection` (PANEL_EXEMPT `kind:'device'`, yazma yalnız `admin:settings`).
2. `device.middleware`: cihaz çözülemedi + eşleştirme zorunlu + bayrak açık + satır **PENDING ve aktif** → `req.unapprovedDevice = { deviceId }` ile geçer (`req.device` DOĞMAZ → makine atfı NULL, kanıt sorulmaz: sırrı yok). Pasif ya da kayıtsız → 401 `DEVICE_INACTIVE` (bugünkü). Onaylı cihaz yolu değişmez.
3. Onaysız cihaza kapalı (bayraktan BAĞIMSIZ olarak `req.unapprovedDevice` işaretine bağlı):
   - `/api/auth/mobile-users` → 401 `DEVICE_REQUIRED`.
   - `/api/auth/login-quick-pin`, `/api/auth/login-card` → 403 `DEVICE_NOT_APPROVED` (kısa kimlik kuralı kapalı fabrikada da; kilide sayılmaz).
   - `/api/license/indirme-belirteci` → 403 `DEVICE_NOT_APPROVED` (parola oturumu taşısa da).
4. `/api/auth/login-methods` cevabına `unpairedPasswordOnly: boolean` (yalnız `req.unapprovedDevice` varken `true`). `enabled/primary` değişmez.
5. `/api/devices/status` ve `/announce` cevabına `unpairedPasswordLogin: boolean` = eşleştirme zorunlu ∧ bayrak ∧ cihaz PENDING+aktif (UNKNOWN/INACTIVE/APPROVED'da `false`).
6. Parola girişi: değişmez — mevcut kilit (`reserveLoginAttempt`) + hız sınırı; oturuma `deviceId` başlıktan yazılır (kayıtsız istemciyle aynı).

### Tablet (mobil)
- `navigation/pairingGate.ts`: kapı = `required && status !== 'APPROVED' && !(status === 'PENDING' && unpairedPasswordLogin === true)`.
- `LoginScreen`: `login-methods.unpairedPasswordOnly === true` → personel listesi İSTENMEZ; ayrı bileşen `UnpairedPasswordForm` (kullanıcı adı + parola) gösterilir; PIN/kart seçici çizilmez. Kilit kipinde kullanıcı adı oturum sahibinden önceden dolar.
- Durum yoklaması onaysız-girişli cihazda 45 sn (onay beklemediği için hızlı yoklama gereksiz).

### Panel (Electron)
- Genel Ayarlar → Cihaz eşleştirme bölümünde yeni satır "Onaysız tabletler parolayla girebilsin"; açıkken kısa uyarı: onaysız tablet kullanıcı adı + parolayla girer; PIN, kart, personel listesi kapalı; makine atfı boş.

## 3. Senaryo matrisi (beklenen)

Kısaltmalar: P=parola girişi, PIN, K=kart, L=personel listesi, İB=indirme belirteci (kimliksiz / parola oturumlu), LM=`login-methods.unpairedPasswordOnly`, ST=`status.unpairedPasswordLogin`.

**Barındırılan, bayrak KAPALI (bugünkü):**

| Cihaz | P | PIN/K | L | İB | LM | ST |
|---|---|---|---|---|---|---|
| başlık yok | 200 | 403 DEVICE_NOT_APPROVED | 401 | 401 / 200 | false | — |
| kayıt yok | 401 DEVICE_INACTIVE | 401 | 401 | 401 | (401) | UNKNOWN, false |
| PENDING | 401 DEVICE_INACTIVE | 401 | 401 | 401 | (401) | false |
| APPROVED (+kanıt) | 200 | 200 | 200 | 200 | false | false |
| APPROVED kanıtsız | 401 DEVICE_PROOF_INVALID | 401 | 401 | 401 | (401) | — |
| pasif | 401 DEVICE_INACTIVE | 401 | 401 | 401 | (401) | false |

**Barındırılan, bayrak AÇIK:** yalnız PENDING satırı değişir —

| Cihaz | P | PIN/K | L | İB (kimliksiz / oturumlu) | LM | ST |
|---|---|---|---|---|---|---|
| PENDING | **200** | 403 DEVICE_NOT_APPROVED | 401 DEVICE_REQUIRED | 401 / **403 DEVICE_NOT_APPROVED** | **true** | **true** |
| parola oturumuyla mobil uç (ör. `/api/auth/me`, liste uçları) | 200 | — | — | — | — | — |
| çalışma oturumu aç | 400 DEVICE_REQUIRED (makine atfı NULL) | | | | | |
| kayıt yok / pasif / APPROVED kanıtsız | bayrak kapalıyla AYNI | | | | | |

**Fabrika, eşleştirme KAPALI, kısa kimlik kuralı kapalı (varsayılan profil):** bayrak açık/kapalı fark etmez — PENDING cihaz bugün de `req.device`siz geçer; middleware bayrak dalına HİÇ girmez (eşleştirme zorunlu değil) → `unapprovedDevice` işareti doğmaz, LM/ST `false`, PIN/kart/liste bugünkü gibi açık. (Bayrak yalnız eşleştirme etkin zorunluyken anlamlıdır; panel bunu yazar.)

**Fabrika, eşleştirme AÇIK, bayrak AÇIK:** barındırılan "bayrak AÇIK" tablosu; fark: kanıt yalnız `device.proofRequired` açıkken zorunlu, PIN/kart PENDING'e yine 403 (kısa kimlik kuralı kapalı olsa da).

## 4. Güvenlik etkisi (açıkça)

- **Kanıtsız geçiş:** PENDING cihazın sırrı yoktur, kanıt sorulmaz. `x-device-id` bir beyandır; PENDING bir kimliği bilen/uyduran (ya da `announce` ile yeni PENDING açan) herkes "onaysız cihaz" muamelesi görür. Kazandığı tek şey **parola girişi + o parola oturumunun izinleri** — ve bu, bugün de başlığı HİÇ göndermeyen istemciye açıktır (başlıksız istek middleware'i geçer). Yani bayrak yeni bir kimlik yolu açmaz; tableti onay ekranında tutan arayüz engelini kaldırır.
- Onaylı cihaz kimliğini kanıtsız tekrarlamak yine 401 `DEVICE_PROOF_INVALID`; onaysız muameleye DÜŞÜRÜLMEZ (sahte başlık onaylı cihazın PIN/kart/liste kapısını açamaz).
- Kısa kimlikler (PIN 10^6 uzay, kart) onaysız cihaza kapalı kalır: kaba kuvvet yüzeyi büyümez. Personel listesi kapalı: kullanıcı adları sızmaz (kullanıcı adını bilen yazar).
- Parola kaba kuvveti mevcut kilitle sınırlı (IP / ters vekilde `ip|kullanıcı` + `ip` kovaları).
- `announce` tavanları (`MAX_PENDING_DEVICES`, `MAX_DEVICE_ROWS`) aynen; çok testçi PENDING satırı biriktirebilir — yönetici pasifleştirir/siler.
- Yasaklama yolu: **pasifleştir** (deactivate). `revoke` cihazı PENDING'e döndürür → bayrak açıkken o tablet parolayla girmeye devam eder (panel uyarısında yazılı).

## 5. Eski istemci

- **Eski tablet** `status.unpairedPasswordLogin`u tanımaz → kapı `required && status !== 'APPROVED'` → onay ekranında bekler (bugünkü davranış); yönetici onaylarsa girer. `login-methods.unpairedPasswordOnly`u tanımaz; zaten giriş ekranına ulaşmaz. Kırılma yok, `minVersion` GEREKMEZ.
- **Eski panel** yeni alanı görmez; bayrağı yönetemez ama hiçbir şeyi bozmaz (PATCH yalnız gönderdiği alanları yazar).
- **Yeni tablet + eski backend:** alanlar yok → `undefined` → eski davranış.

## 6. Dilimler ve kabul testleri

| Dilim | İçerik | Kabul |
|---|---|---|
| D1 backend | bayrak 10 adım (reçete), middleware, auth/license kapıları, status alanı | YENİ `Teks-Erp/scripts/test_onaysiz_parola_girisi.ts` (HTTP matrisi §3, hosted × bayrak × cihaz durumu); `test_device_pairing_flag` §8 (status/announce alanı); `test_feature_flag_contract`, `test_profil_tamligi`, `test_settings_scopes`, `test_cihaz_kaniti`, `test_kisa_kimlik_ozet`, `test_login_methods` yeşil. Negatif sonda: middleware bayrak dalı bozulunca (pasif cihaz da geçer / PENDING kesilir) ve kapılar kaldırılınca kırmızı. |
| D2 panel | featureFlagService aynası, flag-modules, DevicePairingSection satırı + uyarı | YENİ `DevicePairingSection.unpaired-login.test.tsx` (GeneralSettings dizini) (uyarı yalnız açıkken, PATCH alanı); vitest + typecheck + lint. |
| D3 tablet | pairingGate, LoginScreen kipi, `UnpairedPasswordForm` | `mobil/src/navigation/pairingGate.test.ts` yeni kollar (+ sonda); YENİ `UnpairedPasswordForm.test.tsx` (Auth ekran dizini); jest + tsc. |
| D4 belge | kesif-cihaz kural satırı, arşiv karar notu, bekçi haritası | `check-docs` |

## 6b. Ek kapsam (kullanıcı kararı 2026-10-19, koordinatör iletisi)

**E1 — Tablet sunucu adresi (Play kanalı).** (Tablet ajanı ayrı worktree'de uygular; bu dalın kapsamı dışında.) Play'den inen tablette elle adres girişi açık; varsayılan adres `https://deneme.etkiliyazilim.com`; kullanıcı hiçbir şey yapmazsa doğrudan deneme sunucusuna bağlanır. Elle girilen adres varsayılanı ezer ve kalıcı olur.
- Önce ölç: tablet bugün sunucuyu nasıl buluyor (keşif, kanal/derleme ayarına gömülü ERP adresi — `mobil/CLAUDE.md`: ortak pakette adres boş, ilk ekran "Sunucuyu bul"; `store/baseUrlStore`; elle giriş `components/serverPair/`).
- Sınır: varsayılan YALNIZ Play kanalının derleme ayarına (kanal verisi; kanal kimliği `deploy/kanallar.json`, dağıtım kaydı `deploy/dagitim.json`); müşteri kanallarının keşif davranışı DEĞİŞMEZ; `if (musteri === ...)` yasak.
- Kabul (taslak): Play derleme ayarıyla ilk açılış adresi varsayılandan alır; elle giriş sonrası yeniden başlatmada elle girilen kalır; müşteri kanalı derlemesinde varsayılan BOŞ (bugünkü).
- Dikkat: deneme adı İNTERNET kipine düşmeli (`INTERNET_PARENT_DOMAINS`, `mobil/src/lib/internet-tls.ts`), yalnız şifreli bağlantı kuralı aynen.

**E2 — Parola kilidi (barındırılan sınıf).** Bilerek yanlış parola girerek başkasının hesabını kilitlemek mümkün olmasın: hesap kilidi geçici (birkaç dakika), ek olarak IP başına deneme sınırı.

Ölçüm (2026-10-19, kod okuması + HTTP bekçisi):
- Kova anahtarı DAİMA istemci IP'sini taşır (`resolveLoginLockoutKeys`): fabrikada (`TRUST_PROXY` yok) tek `ip` kovası; vekil arkasında (`TRUST_PROXY`/`LOGIN_LOCKOUT_SCOPE=ip+identity`) `ip|u:kullanıcı` ×1 + `ip` ×5. IP yalnız çözülemezse cihaz kimliği, o da yoksa `unknown`. **IP'den bağımsız hesap kilidi YOK** — kullanıcı tablosunda kilit kolonu yok; `login_lockout_buckets` yalnız kova durumunun kalıcı kopyası (yeniden başlatma sıfırlamasın diye; "kalıcı" = süreç ömrünü aşar, ceza sonsuz değil).
- Ceza süreli: eşik `auth.pinLockoutAttempts` (vars. 5) → `penaltySec` (vars. 60 sn); `escalateAfter` (vars. 3) turdan sonra `longPenaltyMin` (vars. 15 dk, tavan 1440). Tur sayısı boşta `longPenaltyMin` başına bir düşer. Kilit kapatılamaz (O-04).
- Kilitli istek 429 `LOGIN_LOCKED` + `retryAfterSec`; parolası doğru olsa da. Başarılı giriş yalnız KENDİ kovalarını sıfırlar.
- Ayrıca hız sınırı: değişkensiz kurulumda giriş uçları IP başına 60/dk (`RATE_LIMIT_*`, `test_web_hardening`).
- Kilit ve hız sınırı aynı IP kaynağından beslenir (`CLIENT_IP_HEADER` ya da `TRUST_PROXY` hop sayısı).

Sonuç: istenen davranış BUGÜN iki sınıfta da sağlanıyor; yeni bayrak/sınıf kuralı AÇILMADI (yeni bayrak bugünkü davranışı varsayılan alırdı = boş kapı; sınıf kuralı da aynı davranışı yeniden yazardı). Bu dalın işi kabulü bekçiyle MÜHÜRLEMEK: `Teks-Erp/scripts/test_parola_kilidi_ip.ts` (HTTP, barındırılan sınıf, iki kapsam):
- §1/§2 saldırgan IP 5 yanlış → doğru parolayla da 429; AYNI ANDA başka IP'den kurban 200; meşru giriş saldırganın kilidini kaldırmaz; ceza süresi (5 sn) dolunca saldırgan IP doğru parolayla 200.
- §3 IP başına sınır kullanıcı adından bağımsız: 25 farklı (yok) kullanıcı adıyla yanlış → o IP kurbanın doğru parolasında da 429; başka IP 200.
- Negatif sondalar (geri alındı, md5 eşit): k1 `ip` kapsamında anahtar hesaba bağlanır → 2 kırmızı (§2b §2c) · k2 dar kova IP'siz → 2 (§1b §1c) · k3 kalıcı ceza → 2 (§1e §2e) · k4 geniş (IP) kova yok → 1 (§3a).

Bilinen sınırlar (karar kullanıcıda):
- **IP çöküşü:** barındırılan kurulum ters vekil arkasında `TRUST_PROXY`/`CLIENT_IP_HEADER` olmadan koşarsa bütün ziyaretçiler vekilin IP'sine düşer; tek saldırgan 5 denemede HERKESİ geçici kilitler. Bugün açılış yalnız UYARIR (`server.ts`). Açılışı durdurmak (fail-closed) önerilir ama vekilsiz doğrudan yayımlanan barındırılan kurulumu da durdurur ve deneme sunucusunun `.env`i bu dalda ölçülemedi → ayrı karar.
- Aynı NAT arkasındaki saldırgan ve kurban aynı IP'dir: kurban en geç ceza süresi (merdivende 15 dk) dolunca girer. Bu, IP tabanlı her kilidin doğal sınırıdır.

Testçi hesabı (`playinceleme` ortak salt-okuma) bu işin kapsamında değil.

## 7. Açık sorular

- İstasyon ekranları (Tambur/KK1/Dokuma…) çalışma oturumu ister, oturum onaylı cihaz ister → onaysız tablette "Onaylı cihaz gerekli" der. İnceleme/sunumda istasyon ekranı gösterilmek istenirse ayrı karar (PENDING satıra oturum bağlamak makine atfı NULL kuralıyla çelişmez ama oturum defterine onaysız cihaz yazar).
- `revoke` edilen cihaz bayrak açıkken parolayla girmeye devam eder; "kalıcı yasak" için pasifleştirme gerekir.
