# Saha Dayanıklılığı Faz 2 — Electron + Backend Gözlemlenebilirlik

> Branch: `perf/mobil-saha-dayaniklilik` (Faz 1 = mobil paket, `mobil/SAHA-AG-DAYANIKLILIK.md`) · Tarih: 2026-07-07
> Kapsam: (E) Electron yönetim panelinde mobildekiyle aynı dayanıklılık desenleri;
> (B) backend'e kalıcı per-endpoint gecikme ölçümü — "hangi endpoint yavaş?"
> sorusunun üretimde her zaman cevaplanabilir olması.

## 1. Neden

- Faz 1 teşhisi: sunucu uçları hızlı; algılanan yavaşlık istemci bekleme politikalarında.
  Electron'da aynı iki desen duruyor: logout'un 15sn'e kadar bekleyebilen `await`'i
  (store/auth.ts) ve her istekte IPC + safeStorage decrypt ile token okuma (apiClient).
- Üretimde veri hacmi büyüyünce sunucu tarafı da yavaşlayabilir; bugün morgan konsola
  yazıyor ama kimse TOPLAMIYOR. Kalıcı, sıfır-bağımlılıklı istatistik gerekli.

## 2. İş Maddeleri

### E — Electron (`Electron/src`)

**E1. Local-first logout** — `store/auth.ts` (+ çağıranlar değişmez):
Sıra ters çevrilir: token İLK okunup yakalanır → yerel temizlik hemen (tokenStore.clear
+ setUser(null) → router anında login'e düşer) → sunucu revoke POST'u ARKA PLANDA,
yakalanan token'la açık `Authorization` header'ı + **3sn** timeout + suppressErrorToast
ile best-effort gider. DİKKAT: token önce silinip sonra POST atılırsa istek 401 alır —
o yüzden token yakalama şart. Revoke başarısızsa sunucudaki oturum expiry/kick ile
düşer (bugünkü best-effort semantiği korunur; LAN-only duruşta token iptali önemli —
başarı yolu değişmiyor, yalnız UI beklemesi kalkıyor).

**E2. Token bellek cache'i** — `lib/secure-token.ts`:
Modül içi cache: `get()` prime edilmişse IPC'siz döner; `set`/`clear` cache'i günceller;
ilk `get` (AuthHydrator) IPC'den okuyup prime eder. Kazanç: istek başına IPC + DPAPI
decrypt (~0.5-3ms, AV taramasında spike) kalkar. tokenStore tek geçit (başka yerden
secureStore.get('auth.token') çağrısı yok — doğrulanacak).

**E3. İstek süresi ölçümü** — `services/netStats.ts` (yeni) + `services/apiClient.ts`:
Mobildekiyle aynı desen: her isteğin süresi (başarı+hata+timeout) ring buffer'a (100)
yazılır; >3sn `console.warn("YAVAŞ İSTEK: ...")`. `getNetStats()` dışa açık; UI yok.

**E4. 401 temizlik tekilleştirme** — `services/apiClient.ts`:
Oturum düşünce paralel isteklerin 401 yağmuru her biri için `await tokenStore.clear()`
(IPC + disk yazımı) koşturuyor. Tek-uçuş guard'ı: temizlik zaten yapıldıysa/sürüyorsa
atla (toast dedupe'u zaten var, korunur).

**Kapsam dışı (bilinçli):** AbortSignal/istek iptali (Chromium 6-soket kuyruğu bulgusu) —
logout artık UI'ı beklettiği için etki arka plana indi; ayrı iş. Query retry'a jitter —
tek panel, sürü etkisi yok.

### B — Backend (`Teks-Erp/src`)

**B1. Gecikme toplayıcı** — `services/latency-stats.service.ts` (yeni; prisma YOK):
- `record(method, routeKey, status, ms)`: route başına `{count, errCount(≥500),
  logaritmik bucket histogramı, maxMs, lastAt}`. Bucket sınırları:
  1,2,5,10,25,50,100,250,500,1sn,2.5sn,5sn,10sn,30sn,60sn,+∞ (ms).
- `snapshot()`: route başına count/errCount/p50/p95/max/lastAt (persentiller bucket
  üst sınırından — yaklaşık ama karşılaştırma için yeterli) + toplam istek + başlangıç
  zamanı. p95'e göre sıralı.
- Yavaş-istek defteri: ≥1sn istekler son-50 ring buffer'da (at, method, route, status, ms).
- **Kardinalite guard'ı:** anahtar sayısı tavanı (500) — tavana gelinince yeni route'lar
  `(diğer)` kovasına düşer; 404/eşleşmeyen path'ler tek `(eşleşmeyen)` kovasında
  (ham URL asla anahtar olmaz — ID'li path'ler route pattern'iyle `:id` olarak anahtarlanır).
- Sabit bellek, kilit yok, istek başına O(1).

**B2. Middleware** — `middlewares/latency.middleware.ts` (yeni):
`process.hrtime.bigint()` ile başlangıç; `res.on('finish')` + `res.on('close')`
(recorded-guard'lı) → `record(...)`. **İstemci abort'u** (finish gelmez) 499 ile
ölçülür — client timeout'una takılan en yavaş istekler defter dışı kalmaz.
Route anahtarı `req.baseUrl + req.route.path` HEDEFLİdir ama iki Express gerçeği
düzeltilir (denetimde çıktı): (1) `req.baseUrl` pattern değil eşleşen GERÇEK
string'dir — parametreli iç mount'larda (`/:customerId/branches`) UUID sızar →
anahtar her durumda **segment normalizasyonundan** geçer (UUID/sayı/uzun-opak →
`:id`); (2) hata yolunda (`next(error)`) Express baseUrl'i geri sarar → önek
originalUrl'den segment aritmetiğiyle yeniden kurulur; kök route'ta ('/') tüm
path önektir ('GET /' çöküşü yok). Route eşleşmemişse `(eşleşmeyen)`.
`app.ts`'te morgan'dan hemen sonra, resolveDevice'tan ÖNCE mount → statik/health/
swagger dahil ölçülür (CORS preflight ve body-parse 400'leri mount'tan önce
kısa devre olur — bilinçli kapsam dışı).

**B3. Admin ucu** — `routes/admin.routes.ts` içine (ince-read istisnası, controller'sız):
- `GET /api/admin/perf` → `verifyToken` + `requirePermission("admin:settings")`
  (seed'de VAR olan kod — yeni permission YOK) → snapshot + yavaş-istek defteri.
- `POST /api/admin/perf/reset` → aynı yetki → sayaçları sıfırla + `AuditService.log`
  (state değişikliği). Swagger JSDoc iki uca da.
- Route dosyasında prisma import YOK (konvansiyon).

**B4. Test** — `scripts/test_latency_stats.ts` (birim: bucket/persentil, ring
tavanı + en-eski-düşer, kardinalite guard'ı, reset+sinceAt, err sayacı) ve
`scripts/test_latency_middleware.ts` (GERÇEK Express harness: parametreli iç
mount'ta UUID sızmaz, kök-route hata anahtarı, 404/statik kovaları, abort→499,
5xx atribüsyonu). İkisi de sözleşmeye uygun (✅/❌ + exit code; DB gerekmez).

**Kapsam dışı:** `pg_stat_statements` (üretim kutusuna manuel kurulum — operasyonel iş,
kod değil); Electron'a perf görüntüleme sayfası (uç hazır olunca ayrı küçük UI işi);
`sessions` tablosu purge ucu (ayrı bakım işi, backlog).

## 3. KONTROL LİSTESİ (bağımsız denetçi için)

> Denetçi talimatı: her maddeyi worktree kodundan SIFIRDAN doğrula; dosya:satır kanıtı;
> kütüphane davranışı kritikse kaynağından doğrula. Kod değiştirme.

- [ ] **F1** Electron logout local-first: UI beklemeden login'e düşüyor; revoke POST'u token silinmeden YAKALANMIŞ token'la, 3sn timeout'la arka planda gidiyor (401 almıyor); hata sessiz + unhandled rejection yok; çift tıklama güvenli; `#/login` yönlendirmesi (Topbar/CommandPalette `.then(...)`) hâlâ çalışıyor.
- [ ] **F2** Logout/kullanıcı değişiminde React Query cache temizliği (CacheUserGuard) bozulmadı — eski kullanıcının verisi yeni oturumda görünmüyor.
- [ ] **F3** Token bellek cache: normal istekte IPC çağrısı YOK (prime sonrası); `set`/`clear` cache'i güncelliyor; hydrate öncesi ilk istek IPC fallback'iyle doğru token'ı alıyor; 401 yolunda hem cache hem disk temizleniyor; tokenStore dışında secureStore token erişimi yok.
- [ ] **F4** Electron netStats: başarı + hata + timeout yollarında ölçüm; ring 100 sınırlı; >3sn warn; interceptor hata yolunda config undefined ise crash yok; vitest birim testi var.
- [ ] **F5** 401 yağmuru: paralel N×401'de tokenStore.clear/setUser tekilleşiyor; toast dedupe korunmuş; login-request 401'i (yanlış şifre) etkilenmiyor.
- [ ] **F6** Electron `npm run typecheck` + vitest + lint temiz; process boundary ihlali yok (renderer'a Node API girmedi); dosya boyutu kuralları aşılmadı.
- [ ] **F7** Backend middleware: her istek O(1) ölçülüyor; route anahtarı pattern bazlı (`/api/rolls/:id` — gerçek UUID anahtara SIZMIYOR); 404'ler `(eşleşmeyen)` tek kovada; anahtar tavanı çalışıyor (tavan üstü `(diğer)`); mount sırası statik/health dahil kapsıyor; hrtime kullanımı doğru.
- [ ] **F8** Persentil/istatistik doğruluğu: bilinen örnek setiyle p50/p95/max/count/errCount beklenen bucket üst sınırlarını veriyor; reset sonrası temiz.
- [ ] **F9** Yavaş-istek defteri: ≥1sn kayıtlar ring-50'de, tavan aşımında en eskisi düşüyor.
- [ ] **F10** Admin uçları: `verifyToken` + `requirePermission("admin:settings")` (seed'de mevcut kod), Swagger JSDoc, route'ta prisma import yok, reset `AuditService.log` çağırıyor (best-effort, tx dışı), `admin` dışı kullanıcı 403 alıyor.
- [ ] **F11** Backend `npx tsc --noEmit` + `npx tsx scripts/test_latency_stats.ts` geçiyor; canlı smoke (PORT=4010): birkaç istek sonrası `GET /api/admin/perf` gerçek istatistik döndürüyor, `POST .../reset` sıfırlıyor.
- [ ] **F12** Konvansiyon uyumu: latency-stats.service'te DB/audit yok (saf bellek); yeni timer kurulmadı (/health "yeni timer yok" ilkesi — ölçüm istek-güdümlü); `any` yok; mevcut yorum diline uyum.

## 3.5 Bilinen Minörler (denetimden — bilinçli bırakıldı)

- CORS preflight (OPTIONS) ve `express.json` parse-hatası 400'leri latency mount'undan önce kısa devre olur → ölçüm dışı; gövde okuma süresi ms'e dahil değil (ölçüm middleware-sonrasıdır).
- Perf reset audit'i `tableName: 'latency_stats'` ile DOMAIN kategorisine düşer — Aktivite Günlüğü tablo filtresinde sanal bir ad görünür (kayıt izi bilinçli tercih).
- Electron: logout→aynı milisaniyede re-login yarışına karşı preset-Authorization koruması eklendi; ilk `tokenStore.get`'te in-flight IPC dedupe yok (eşzamanlı ilk okumalar zararsız çift IPC yapabilir).
- Electron AuthHydrator'da süresi-dolmuş-token temizliği reject ederse hydrate takılır — önceden var olan davranış, Faz-2 kapsamı dışı.

## 4. Doğrulama Sonrası (kullanıcı)

1. Electron: çıkış yap → login sayfası ANINDA gelmeli (sunucu kapalıyken bile); tekrar giriş sorunsuz.
2. Backend: admin ile `GET /api/admin/perf` → biraz gezinme sonrası route listesinde p50/p95 görünmeli; `>1sn` bir rapor koşup yavaş-istek defterine düştüğünü görmek.
3. Üretim kutusuna kurulumda ek adım YOK (migration yok, yeni paket yok).
