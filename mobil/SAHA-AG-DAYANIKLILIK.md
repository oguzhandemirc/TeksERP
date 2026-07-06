# Mobil Saha Ağı Dayanıklılığı — Tasarım + Denetim Kontrol Listesi

> Branch: `perf/mobil-saha-dayaniklilik` · Tarih: 2026-07-07
> Semptom: parazitli saha ağında logout→login akışı ve bazı ekranlar "inanılmaz uzun" bekliyor;
> fazla bekleme = timeout algısı + retry'larla sunucu şişmesi riski.
> Ölçüm özeti: backend uçları izole ölçümde hızlı (login 80-120ms, diğerleri <52ms);
> kötü-ağ simülasyonunda (250ms RTT ± jitter) ham akışlar ≤1.6sn. Saniyeler/dakikalar süren
> vakaların tamamı İSTEMCİ bekleme politikalarından geliyor (aşağıdaki S1-S3).

## 1. Tasarım İlkeleri (sektör standartları)

| İlke | Standart / desen | Uygulandığı yer |
|---|---|---|
| Auth geçişleri yerel-öncelikli: UI asla ağa kilitlenmez | local-first auth, bounded wait | S1, S3 |
| Kuyruk = dayanıklı outbox; en-az-bir-kez teslim + idempotent sunucu | durable outbox / store-and-forward | S1 (mevcut altyapı korunur, delikler kapanır) |
| Her kullanıcı-görünür beklemeye tavan | deadline/budget pattern | S1 (flush 5sn, close 4sn), S2-S3 (GET 5sn) |
| Önce son bilinen veriyle çiz, arkada tazele | stale-while-revalidate (RFC 5861 ruhu) | S2, S3 |
| Retry'da tam-jitter üstel geri çekilme | AWS full-jitter backoff | S5 |
| Başarısız poll seyrekleşir | adaptive polling / circuit-breaker hafifi | S5 |
| Pahalı kimlik okumaları bellekte | keychain/IPC minimizasyonu | S4 |
| Diske yazılan cache açıkça sınırlı | explicit cache scoping | S6 |
| İstemci gecikmesi ölçülür | client-side RUM | S7 |

## 2. İş Maddeleri

### S1 — Sınırlı süreli logout + güvenli outbox
**Dosyalar:** `src/offline/flushThenLogout.ts`, `src/offline/deadline.ts` (yeni), `src/offline/sessionSwitch.ts`, `src/offline/mutations.ts`, `src/offline/queryClient.ts`, `src/components/ScreenChrome.tsx`, `src/components/lock/LockScreen.tsx`, `src/navigation/RootNavigator.tsx`, `src/hooks/useAutoLogout.ts`, `App.tsx`

- `flushThenLogout`/`flushThenSwitch`: kuyruk flush'ı **5sn**, work-session close **4sn** tavanla (`withDeadline` — asla reject etmez, `timedOut` bayrağı döner). Tavan dolunca akış devam eder; sonuç `{pendingCount}` döner.
- ScreenChrome + LockScreen çıkışı: flush sürerken kapatılamaz "Kayıtlar gönderiliyor… (N)" göstergesi; tavan dolarsa toast: "N kayıt bekletildi — girişten sonra otomatik gönderilir"; hata yolunda Türkçe toast + re-entrancy guard (çift dokunuş tek akış).
- **Veri kaybı deliği kapanır:** token silindikten sonra ateşlenen kuyruk kaydı 401 alıp KALICI düşüyordu. Yeni: her istasyon mutationFn'i token yoksa HTTP'ye ÇIKMADAN `NoAuthError` fırlatır; retry politikası bu hatayı **sonsuz + 15sn sabit aralıkla** yeniden dener (sunucuya istek gitmez, kayıt yaşar; giriş yapılınca akar). **Uçuş sırasında logout yarışı da kapalı:** sunucudan 401 dönüp bellekte token YOKSA bu da "oturum yok" beklemesi sayılır (kalıcı düşürme değil); token bellekteyken gelen 401 (kick) eski fail-fast kuralında kalır. Girişten sonra `nudgeOutbox()` bekletilenleri hemen tetikler.
- **Persist deliği kapanır:** TanStack default'u yalnız `isPaused` mutation'ları diske yazar; aktif-retry'daki (`pending`) istasyon kaydı app kill'de kaybolurdu. `shouldDehydrateMutation` genişletilir: paused **veya** (pending ve `mutationKey[0]==='station'`). Tüm istasyon mutation'ları idempotent (client-key + P2002) → replay güvenli.
- **Restore zombisi kapanır (denetimde çıktı):** `hydrate()` state'i aynen kurar — pending+`isPaused:false` yazılmış kayıt restore'da paused OLMAZ ve `resumePausedMutations` onu asla görmezdi. Persister `deserialize`'ı `revivePendingStationMutations` ile bu kayıtları okuma anında paused'a çevirir.
- **KRİTİK sıra düzeltmesi:** `queryClient.clear()` mutation cache'i de siliyordu — tavanla çıkışta bekletilen kuyruğu YOK EDERDİ. TÜM çıkış yolları (normal logout, 401 istemsiz çıkış, token-süresi-dolumu) artık yalnız query'leri seçici temizler (`clearUserScopedQueries`), mutation cache'e DOKUNMAZ.

**Bilinçli kabuller:** (1) Bekletilen kayıt, bir SONRAKİ girişte kimin token'ı varsa onunla gider (bugünkü app-restart davranışıyla aynı); operatör-atıf sunucu tarafında deviceId/WorkSession damgasıyla kısmen korunur, tam kimlik bağlama kapsam dışı. (2) `PERSIST_BUSTER` bump'ı (v9→v10) güncelleme anında diskte bekleyen ESKİ persist kayıtlarını (varsa eski paused outbox dahil) geçersiz kılar — güncellemeyi kuyruk boşken yapmak yeterli; sonraki bump'larda da aynı dikkat.

### S2 — Login ekranı stale-while-revalidate
**Dosyalar:** `src/screens/Auth/LoginScreen.tsx`, `src/services/auth.service.ts`, `src/offline/sessionSwitch.ts` (seçici temizlik), `src/hooks/useFeatureFlags.ts`

- `mobile-users` sorgusu: `staleTime: 0` + `refetchOnMount: 'always'` → ekran son bilinen listeyle ANINDA çizilir (anında çizim cache'in KORUNMASINDAN gelir: seçici logout temizliği + `gcTime: 24sa` — default 5dk gcTime uzun vardiyada cache'i boşaltıp vaadi bozuyordu), her açılışta taze çekilir ("değişikliğimi göremiyorum" derdi biter: 5dk bayatlık penceresi kalkar).
- `login-methods` + `mobile-users` servis çağrılarına **5sn** özel timeout (global 10sn mutasyonlar için kalır). `login-methods` ağ hatasında artık default'a DÜŞMEZ (hata fırlatır → query son bilinen konfigürasyonu korur); yalnız bozuk-ama-başarılı cevapta default devreye girer.
- Logout'taki cache temizliği SEÇİCİ olur: public bootstrap anahtarları (`['auth','mobile-users']`, `['auth','login-methods']`, `['feature-flags']`, `['device','status']`, `['device','assignment-required']`) KORUNUR — logout sonrası login ekranı cache'ten anında çizilir; kullanıcıya-özel tüm query'ler silinir.
- `useFeatureFlags`: `enabled: !!token` — logout sonrası token'sız 401 çifti ve sahte "Oturum süresi doldu" toast'ı biter; son bilinen flag verisi cache'te kalır (idle-lock offline davranışı korunur).

### S3 — Giriş sonrası oturum kapısı (spinner tavanı + son-yer cache'i)
**Dosyalar:** `src/store/sessionStore.ts`, `src/services/workSession.service.ts`

- `GET /work-sessions/current` çağrısına **5sn** timeout → tam ekran spinner tavanı 10sn'den ~5sn'e iner; hata/timeout'ta `isLoaded: true` (mevcut fail-open davranış korunur).
- `lastPlace` AsyncStorage'a snapshot'lanır (`session_last_place_v1`, okurken şekil doğrulamalı); ağ hatasında öneri ("Sarım-2'desiniz, doğru mu?") kaybolmaz. `active` ASLA snapshot'tan gelmez (hayalet oturum riski yok — sunucu tek kaynak, 409 guard'ı zaten var).

### S4 — token/deviceId bellek cache'i
**Dosyalar:** `src/services/api.ts`, `src/utils/deviceId.ts`

- Request interceptor token'ı `useAuthStore.getState()` belleğinden okur; store hydrate olmadıysa (cold start) SecureStore fallback. setAuth/clearAuth zaten store'u günceller → cache tutarlı.
- `getOrCreateDeviceId` modül-içi memoize (değişmez değer) + eşzamanlı çağrı tekilleştirme.
- Kazanç: istek başına 2 seri Keystore köprü turu (5-30ms, zayıf cihazda 200-300ms) kalkar.

### S5 — Timeout/retry/jitter/poll bütçeleri
**Dosyalar:** `src/offline/queryClient.ts`, `src/offline/mutations.ts`, `src/navigation/RootNavigator.tsx`

- Query default `retryDelay`: ±%30 jitter'lı üstel backoff (`min(1000·2^n, 30sn) × rand[0.7,1.3]`, efektif üst 39sn) — vardiya başında tüm tabletlerin senkron retry dalgası (thundering herd) kırılır.
- `OFFLINE_AWARE.retryDelay`: aynı jitter; `NoAuthError` ve token'sız-401 dalında sabit 15sn.
- Cihaz durum poll'u (`['device','status']`): hata halinde 5-15sn → **30sn**'e geriler (ölü sunucuda soket birikmesi/şişirme önlenir), toparlanınca normale döner. Cihaz announce döngüsü de ardışık hatada 5sn→60sn üstel geri çekilir (öne gelişte sıfırlanır).

### S6 — Persister kapsam daraltma
**Dosyalar:** `App.tsx`, `src/offline/persistPolicy.ts` (yeni), `src/offline/queryClient.ts`

- `dehydrateOptions.shouldDehydrateQuery`: YALNIZ beyaz-liste (S2'deki bootstrap anahtarları + `['preferences']`) diske yazılır. Üretim ekran verileri artık persist edilmez → app restart'ta "hayalet dünkü veri" biter.
- `shouldDehydrateMutation`: S1'deki genişletme (paused ∪ pending-station).
- `PERSIST_BUSTER` → `tekserp-v10`.

### S7 — İstemci gecikme ölçümü (RUM-hafif)
**Dosyalar:** `src/services/netStats.ts` (yeni), `src/services/api.ts`

- Her isteğin süresi ölçülür; son 100 kayıt ring buffer'da (`getNetStats()`); eşik üstü (>3sn) `console.warn` ("YAVAŞ İSTEK: POST /x 4820ms") — adb logcat/Metro'dan sahada okunur. UI eklenmez (ileride Ayarlar'a dökülebilir).

## 3. Kapsam Dışı (bilinçli)

- Backend değişikliği yok (bcryptjs, ayar cache'leri — ayrı iş; şifreli login sahada nadir, PIN/kart bcrypt'siz).
- Electron logout await'i — ayrı küçük iş.
- Tam kimlik-bağlı outbox (kayıt-başına token) — S1 kabulünde açıklandı.
- Fiziksel cihazda saha testi — kullanıcı yapar (aşağıda senaryolar).

## 4. KONTROL LİSTESİ (bağımsız denetçi için)

> Denetçi talimatı: Her maddeyi worktree kodundan SIFIRDAN doğrula (bu dokümana değil koda güven).
> Her madde için: geçti/kaldı + dosya:satır kanıtı + (varsa) kaçırılan kenar durum.

- [ ] **C1** `flushThenLogout`: flush ve closeSession tavanlı; tavan dolunca akış clearAuth'a İLERLİYOR ve sonuç pendingCount döndürüyor. Deadline helper'ı asla reject etmiyor (unhandled rejection yok).
- [ ] **C2** Tavanla çıkış SONRASI bekletilen mutation'lar token'sız HTTP isteği ATMIYOR (guard HTTP öncesi devrede) ve KALICI FAİL olmuyor (NoAuth + token'sız-401 dalında retry sonsuz, aralık ~15sn). App kill + restore'da pending-istasyon kaydı `deserialize` revive'ı ile paused'a çevrilip resume ediliyor (zombi yok).
- [ ] **C3** TÜM çıkış yollarındaki (normal logout, 401 istemsiz çıkış, token-süresi-dolumu) cache temizliği mutation cache'ine dokunmuyor (paused/pending kuyruk yaşıyor) ve public bootstrap query'leri koruyor; kullanıcıya-özel query'ler (tercihler dahil) siliniyor.
- [ ] **C4** `shouldDehydrateMutation`: paused VEYA pending-station persist ediliyor; pending ama station-olmayan ve tamamlanmış mutation'lar persist EDİLMİYOR. Restore sonrası station mutation'ların fn'i registry'den çözülüyor (mevcut setMutationDefaults düzeni bozulmamış).
- [ ] **C5** ScreenChrome çıkışı: flush sırasında kapatılamaz ilerleme göstergesi; pendingCount>0 bitişinde bilgilendirme toast'ı; mevcut offline+pending ön-onayı korunmuş. Paper/AppModal konvansiyonlarına uygun (Card+onPress yok, raw hex yok).
- [ ] **C6** LoginScreen `mobile-users`: placeholder + her açılışta taze çekim; 5sn timeout; logout→login döngüsünde liste ANINDA görünüyor (cache korunduğu için) ve arkada tazeleniyor.
- [ ] **C7** `useFeatureFlags` token'sızken istek atmıyor; login ekranında 401/`Oturum süresi doldu` toast'ı üretmiyor; cache'teki son değer okunabiliyor.
- [ ] **C8** `sessionStore.init`: 5sn üstünde spinner'da KALMIYOR; lastPlace snapshot'ı yazılıyor/okunuyor; `active` snapshot'tan ASLA restore edilmiyor.
- [ ] **C9** api.ts token'ı bellekten okuyor; cold-start (store hydrate öncesi) fallback çalışıyor; logout sonrası bellekte token kalmıyor (Authorization header'ı eklenmiyor).
- [ ] **C10** deviceId memoize: SecureStore'a süreç ömründe ≤1 okuma; eşzamanlı ilk çağrılar tek okumaya biniyor.
- [ ] **C11** retryDelay'ler jitter'lı (deterministik senkron dalga yok); sınırlar doğru (jitter-öncesi tavan 30sn, efektif üst 39sn; NoAuth 15sn sabit).
- [ ] **C12** Cihaz durum poll'u hata halinde 30sn'e geriliyor, düzelince 5/15sn'e dönüyor.
- [ ] **C13** Persister beyaz-listesi: listede olmayan hiçbir query diske yazılmıyor (ör. rolls/iş listeleri); BUSTER v10.
- [ ] **C14** netStats: her istek ölçülüyor, ring buffer sınırlı (bellek sızıntısı yok), eşik uyarısı çalışıyor; interceptor hata yolunda da süre kaydediyor.
- [ ] **C15** Genel: `npx tsc --noEmit` temiz; jest testleri geçiyor; yeni davranışların testi var (deadline, guard, persist policy, seçici temizlik); değişen dosyalarda mevcut yorum/konvansiyon diline uyulmuş; import döngüsü yaratılmamış (api.ts ↔ store'lar).

## 5. Saha Testi (kullanıcı — fiziksel cihaz)

1. Uçak modu AÇIKKEN 2 KK1 kaydı gir → çıkış → "bekletildi" bilgisi → Wi-Fi aç → aynı kullanıcıyla gir → kayıtların gittiğini panelden doğrula.
2. Sunucuyu durdur → logout → login ekranı ≤6sn içinde gelmeli (eski davranış: 20-60sn).
3. Sunucu kapalıyken login ekranı: kullanıcı listesi son halinden görünmeli; sunucu açılınca liste tazelenmeli.
4. Panelden yeni mobil kullanıcı ekle → tablete dön, logout/login → liste ANINDA eski + 1-2sn içinde yeni kullanıcı görünmeli.
