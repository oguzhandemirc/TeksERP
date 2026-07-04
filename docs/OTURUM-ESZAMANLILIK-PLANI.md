# Oturum & Eşzamanlılık Sertleştirme Planı

Kullanıcı kararlarına göre kilitlenmiş kapsam (2026-07-04). Tüm ayarlar
`system_settings` (SystemSetting key-value) üzerinden yönetilir; enforcement notları
her maddede belirtilmiştir.

## Kararlar (özet)

- **Idle kilidi (mobil):** default AÇIK, tamamen kapatılabilir. Süre default **10 dk**, ayarlanabilir. Zaman aşımında **kilit ekranı** (work session açık kalır); geri sayım + "Devam et" uyarısı. Arka plana alınınca da kilitlenir.
- **Server WorkSession idle-sweep:** default **20 dk** (eski 600), ayarlanabilir. Sade açıklama: *"Bir tablet bu kadar dakika hiç kullanılmazsa oradaki iş oturumu otomatik kapanır ve makine yeniden boşa düşer."*
- **Hızlı geçiş:** farklı operatör kart/PIN okutunca **doğrudan geç** (önceki work session otomatik kapanır + devir audit'i). Erişim: her ekrandaki **operatör bandından** ve kilit ekranından.
- **Operatör bandı:** isim + istasyon/yer + operatöre özgü renk; üst barın altında sabit satır.
- **Same-identity / cihaz tipi politikası:** default **aynı tip engelli** (1 Electron + 1 mobil serbest; 2. mobil / 2. Electron engellenir). Çakışmada default **eskiyi düşür, yeni kazanır**. Modlar ayarlanabilir: `kick` | `notify` | `off`.
- **Token süresi dolunca otomatik logout:** default AÇIK (mobil + Electron), kapatılabilir. Token süreleri cihaz başına bağımsız.
- **Electron çıkışı:** `/auth/logout` çağırır + audit; ayrıca kendi oturumunu registry'de iptal eder.
- **Offline kuyruk:** kullanıcı değişiminde/çıkışta önce **mevcut token ile flush**; okuma cache'i temizlenir.

## Backend sözleşmesi (Teks-Erp)

### Yeni ayar anahtarları (SystemSetting + FeatureFlags)
| key | tip | default | enforcement |
|---|---|---|---|
| `auth.sameTypeSessionPolicy` | `'kick'\|'notify'\|'off'` | `'kick'` | backend (login) |
| `auth.autoLogoutOnExpiry` | boolean | `true` | client (mobil+electron) |
| `auth.mobileIdleLockEnabled` | boolean | `true` | client (mobil) |
| `auth.mobileIdleLockMinutes` | number (1..120) | `10` | client (mobil) |
| `auth.workSessionIdleTimeoutMinutes` | number | **20** (eski default 600) | backend lazy sweep |

Hepsi `/api/feature-flags` (auth-only) blob'una eklenir; mobil `FeatureFlags` arayüzü de bu alanları taşır.

### Session registry
- Prisma `model Session` (RBAC bölümü), `enum ClientType { ELECTRON MOBILE }`.
  - Alanlar: `id uuid pk`, `userId uuid`, `deviceType ClientType`, `jti uuid @unique`,
    `deviceId String?` (serbest VARCHAR — **FK DEĞİL**, kayıtsız client login yapabilmeli),
    `createdAt`, `expiresAt`, `revokedAt DateTime?`, `revokeReason String?`, `lastSeenAt DateTime?`.
  - `sessions Session[]` relation → User; `@@index([userId])`. `jti` @unique.
  - **Partial-unique (userId,deviceType) YOK** — politika `off`/`notify` çoklu aktif same-type gerektirir; teklik uygulama katmanında (`kick`) sağlanır.
- Manuel migration SQL (repo konvansiyonu: psql apply + `prisma migrate resolve --applied`), `work_sessions` migration'ı şablon.

### JWT + login
- `issueToken` (auth.service.ts:228) jti üretir (`crypto.randomUUID()`), `jwt.sign(payload, secret, { expiresIn, jwtid })`.
- `JwtPayload` (api.types.ts:41) → `jti: string` eklenir.
- `loginSchema` → `clientType: z.enum(['electron','mobile']).optional()` (yoksa `'mobile'`).
- Login akışı issueToken'dan önce/sonra **SessionRegistryService.openLoginSession**:
  - `kick`: tx içinde aynı (userId,deviceType) aktif oturumları `revokedAt=now, reason='NEW_LOGIN'` yap, sonra yeni satır oluştur.
  - `notify`: aktif same-type varsa ve `confirmKick!=true` → `409 SESSION_EXISTS` (mevcut oturum bilgisiyle); `confirmKick=true` → ikisi de açık kalır (yeni satır).
  - `off`: sessizce yeni satır.
- `login`/`login-card`/`login-quick-pin` hepsi clientType + deviceId (x-device-id) + confirmKick taşır.

### Middleware
- `auth.middleware.ts:37` — mevcut User findUnique'ten sonra `Session` lookup (jti); yoksa/`revokedAt` set ise `401`. `lastSeenAt` throttle güncelle (fire-and-forget). Fail-closed.

### Logout & tokenVersion kompozisyonu
- `auth.controller.ts:335` logout → `req.user.jti` oturumunu `revokedAt=now, reason='LOGOUT'`.
- `permission-management.service.ts` (resetPassword/deactivate/delete) tokenVersion++ yanında o kullanıcının Session satırlarını da revoke et (reason='PASSWORD_RESET'|'DEACTIVATED'|'DELETED').

### WorkSession "bir operatör = tek yer"
- `work-session.service.ts` open() tx'ine: bu userId'nin **diğer cihazlardaki** açık oturumlarını da kapat (`endedAt=now, endReason='NEW_LOGIN'`). Mevcut same-device (NEW_LOGIN) + same-machine (TAKEOVER) kapanışları korunur.

## Mobil (mobil/)

- **clientType:** login servisleri gövdeye `clientType:'mobile'` ekler.
- **Offline flush + cache clear:** `ScreenChrome.doLogout` ilk adım `await queryClient.resumePausedMutations()` (online ise), sonra closeSession→reset→clearAuth→`queryClient.clear()`. Aynı sıra user-switch için. Offline+pending varsa uyar/engelle. 401 yolunda flush YOK.
- **Auto-logout on expiry:** JWT `exp` decode → süre dolunca (setting açıksa) otomatik logout. Timer + AppState-foreground kontrolü.
- **Idle auto-lock:** kök seviyede touch/PanResponder aktivite izleme + global lock store; PaperProvider'dan SONRA (Toast slotu) lock overlay; `mobileIdleLockMinutes` (feature-flags), geri sayım (20 sn) + "Devam et"; arka plana alınınca kilitle. Setting kapalıysa hiç kilitlenme.
- **Lock ekranı & fast switch:** kart/PIN unlock. Dönen user aynıysa → kilidi aç. Farklıysa → flush → closeSession → reset → setAuth(yeni) → session init (SessionGate yeri yeniden sorar).
- **Operatör bandı:** ScreenChrome header altı sabit satır: `username` + istasyon/yer (PlaceChip mantığı) + operatöre özgü renk (userId hash → palet). `fullName` login sırasında `MobileUser`'dan setAuth'a kalıcılaştırılır.

## Electron (Electron/)

- **clientType:** apiClient login → `clientType:'electron'`.
- **Logout:** `/auth/logout` çağır (registry revoke + audit), sonra yerel temizlik.
- **Auto-logout on expiry:** JWT exp decode → timer; setting açıksa otomatik logout. Mevcut `useIdleLogout` korunur.
- **Signed-in-elsewhere / kick:** login 409 SESSION_EXISTS → "notify" modda kullanıcıya "başka yerde açık, devam edilsin mi?" onayı (confirmKick=true ile tekrar). kick modda sessiz.
- **Ayarlar UI:** `SessionSettingsSection.tsx`'e yeni alanlar (mobileIdleLockEnabled switch, mobileIdleLockMinutes numeric, workSessionIdleTimeoutMinutes numeric — zaten olabilir, sameTypeSessionPolicy select, autoLogoutOnExpiry switch). `featureFlagService` arayüzü + `usePricingEnabled.ts` hook'ları.

## Test
- Backend: `scripts/test_session_registry.ts` (kick/notify/off, revoke, middleware reject, one-per-type), `test_worksession_one_place` genişletme. `run-all-tests`.
- Mobil: jest — flush-then-clear sıra helper'ı, idle reducer, exp hesaplama, operatör renk hash.
- Electron: vitest — exp decode/auto-logout hook, feature-flag hook alanları, session policy select.
