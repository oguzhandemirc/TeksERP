# Genel · Uzak erişim · Konvansiyon

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 6 üye: 1 tarihli not (2026-09-01 patron/uzak erişim, CANLI ve koddan doğrulandı) + 5 tarihsiz sözleşme satırı (izinli npm paketleri, yeni-uç kontrol listesi maddesi, Electron dizin ağacı, audit sözleşmesi, TR mesaj kuralı). Küme tematik değil ARTIK kümesidir; ortak konu yok, bu yüzden ezilme zinciri de yok. İki bayatlık ölçüldü: ① audit satırındaki '/health sayacına düşer' — sayaç /api/admin/health'e taşınmış (app.ts:606-608, 722, 922); ② Electron ağacında route haritası router.tsx'te değil src/routes/content-routes.tsx'te. EN RİSKLİ ÇELİŞKİ: backend kontrol listesindeki 'tünelde 404' cümlesi — modül kapısı KODDA koşulsuz 403 (module.middleware.ts:76-81 '403 (404 değil)') ve bekçi de 403 bekliyor; cümle yeni uç yazan kişiyi yanlış davranışa iter, silinmeli.


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** İstemci envanteri künyesini BİLDİREMEYENİ de listeler: `X-Client-*` yoksa sürüm User-Agent'tan çıkarılır (yalnız Electron; `okhttp` KÜTÜPHANE sürümüdür, uygulama sanılmaz) ve satır `declared:false` damgası taşır — ekran çıkarımı beyan gibi göstermez. Görülmesi en gereken istemci, kendini tanıtamayacak kadar eski olandır. · bekçi: `scripts/test_client_registry.ts §5` <sub>(arşiv:2026-09-10 künyesiz istemci)</sub>
- **[ÇEKİRDEK]** Kapanış 5sn'lik zorla-çıkışa düşerse log FAZI ve AÇIK BAĞLANTI SAYISINI basar (bağlantı > 0 → asılı istek, 0 → zincir fazın kendisinde durmuş); tek cümlelik "tamamlanmadı" YETMEZ. Sebep erişim log'undan ÇIKARILAMAZ — o, isteği yalnız BİTTİĞİNDE yazar, asılı istek hiç iz bırakmaz. <sub>(arşiv:2026-09-10 prod log ③)</sub>
- **[ÇEKİRDEK]** Komut kapısı (`scripts/claude-hooks/bash-guard.mjs`) yasağı ÇALIŞTIRILACAK KOMUTTA arar, yazılan/aranan METİNDE değil: komut ayıraçlara (tırnak farkındalıklı) bölünür, tamamı metin aracı olan boru hatları atlanır, heredoc gövdesi ancak ALICISI onu çalıştırmıyorsa (`cat`/`tee`/`git commit`/yorumlayıcı) veri sayılır — `psql <<EOF` ve `bash <<EOF` beyaz listede DEĞİLDİR. ⚠️ KAPSAM: kabuk komutu incelenir, PROGRAM DAVRANIŞI incelenmez; bir dosyaya yazılıp sonra çalıştırılan script kapsam DIŞIDIR ve kapı bu sınırı reddederken ÇIKTIYA basar. · bekçi: `Teks-Erp/scripts/test_bash_guard_scope.ts` <sub>(arşiv:2026-09-13 ölü kapı)</sub>
- **[ÇEKİRDEK]** Kancanın yolu KABUĞUN DİZİNİNDEN bağımsız olur (mutlak ya da `${CLAUDE_PROJECT_DIR}` çapalı): göreli yol, kabuk kökten çıktığı her an kancayı SESSİZCE öldürür ve Claude Code bunu non-blocking sayar (ölçüldü 2026-09-13: 4.962 ölü-kapı olayı, 24 ayrı dizin). Başlatılamayan bir kancayı engelleyici yapan bir ayar YOKTUR — tek kalıcı koruma yapılandırmanın doğruluğunu ÖLÇMEKTİR. · bekçi: `Teks-Erp/scripts/test_hook_config.ts` <sub>(arşiv:2026-09-13 ölü kapı)</sub>
- **[ÇEKİRDEK]** Her CUD operasyonu `AuditService.log()` ile `SystemLog`a yazılır; tek istisna `UserPreference` (kişisel UI blob'u). · bekçi: `Teks-Erp/scripts/test_audit_depth.ts (kapsam kısmi)` <sub>(CLAUDE.md:285)</sub>
- **[ÇEKİRDEK]** Audit best-effort'tur: yazım hatası isteği DÜŞÜRMEZ ve çağrı transaction DIŞINDA yapılır. Başarısızlık sayacı `/health`te DEĞİL `/api/admin/health`tedir (`auditWriteFailures`) — `/health`in alan kümesi DONDURULMUŞ, yeni operasyonel metrik `buildRichHealth`e eklenir. <sub>(CLAUDE.md:285)</sub>
- **[ÇEKİRDEK]** Validation hata mesajları Türkçe yazılır. <sub>(CLAUDE.md:297)</sub>
- **[ÇEKİRDEK]** Uzak/LAN ayrımı SOKETTEN çözülür (`req.socket.localPort` === REMOTE_PORT); `clientType` gövdeden gelir ve GÜVENLİK SINIRI DEĞİLDİR. Soket okunamazsa istek LAN sayılır — fail-closed yönü budur (LAN kuralları zaten dar). · bekçi: `scripts/test_remote_access_guard.ts` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** Uzak `/api` isteğinde Cloudflare Access JWT ikinci katmandır ve FAIL-CLOSED'dır (politika panelden kalkarsa sessiz açık değil gürültülü arıza). JWKS önbelleğinde TTL TAZELİKTİR geçerlilik değil: bayat anahtar döner + arka planda tazelenir; önbellek HİÇ dolmadıysa fail-closed KALIR. · bekçi: `scripts/test_remote_access_guard.ts (Access JWT negatif sondası)` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** `users.quickPin` 6 hane, DÜZ METİN ve sistem genelinde `@unique` — PIN tek başına kimliği belirler. PIN/kart uçları internete açılmaz; PIN repoya, log'a, sürüm notuna ve audit diff'ine girmez. · bekçi: `scripts/test_remote_access_guard.ts (denylist sondası)` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** İki dinleyici İKİ PROCESS DEĞİLDİR: presence Map'i, feature-flag cache'i ve zamanlayıcı bayrakları process-local'dir; aynı `app`i ikinci bir sokette dinletmek invariantı bozmaz — İKİNCİ BİR NODE SÜRECİ hâlâ YASAK. <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** TOTP kurulumunun TEK yolu yöneticinin açtığı 15 dk'lık tek kullanımlık penceredir (TOFU REDDEDİLDİ: parola sızmışsa saldırgan 2FA'yı kendi telefonuna bağlar); ikinci faktör `issueToken`den ÖNCE koşar; üç hata üç ayrı statü (403/409/401) ve giriş kilidi yalnız 401'i sayar. · bekçi: `scripts/test_totp.ts (RFC 4226/6238 dış vektörleri)` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** Kullanıcının indirdiği içe aktarım şablonu bir SÖZLEŞMENİN DONDURULMUŞ KOPYASIDIR: panel Excel başlığını etiketle eşler, başlık/sütun adı değişikliği sürüm kırıcıdır ve `minVersion` uygulanamaz — mevcut başlık korunur, bilgi yeni sütunla/yardım metniyle eklenir ("Miktar (m)" + "Birim" emsali). <sub>(arşiv:2026-09-13)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Tünel dinleyicisi YALNIZ `127.0.0.1`e bağlanır; uzak port `0.0.0.0`a AÇILMAZ (açılırsa uzak/LAN ayrımı komple çöker, iki yönde de kural seti sessizce yanlış uygulanır) ve `HOST` env'i bu dinleyicide bilerek onurlandırılmaz. · bekçi: `scripts/test_remote_access_guard.ts` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** Uzakta kapalı yollar 404 döner, 403 DEĞİL (403 'burada bir şey var' der, keşfe davet eder): login-card · login-quick-pin · mobile-users + /api/devices, /api/discovery, /api/mobile, /api-docs. Liste YOL bazlıdır; servis katmanında ikinci hat `assertNotRemote` vardır. · bekçi: `scripts/test_remote_access_guard.ts` <sub>(CLAUDE.md:95)</sub>
- **[ÇEKİRDEK]** `CLIENT_IP_HEADER` app-wide OKUNMAZ — yalnız uzak istekte geçerlidir (`clientIpHeaderRemoteOnly`, `REMOTE_PORT`ten türer); `TRUST_PROXY` de app-wide AYARLANMAZ. Aksi hâlde LAN'daki biri `CF-Connecting-IP` uydurup giriş kilidini VE hız sınırını etkisizleştirir (her denemede farklı kova). · bekçi: `scripts/test_remote_access_guard.ts (IP başlığı negatif sondası)` <sub>(CLAUDE.md:95)</sub>

## Backend


### Değişmezler

- **[ÇEKİRDEK]** bonjour-service bilinçli istisnadır: sürüm SABİT (`1.4.4`, `^` YOK — sonraki ana sürümler ESM-only olup `require()` yolunu sessizce kırar) ve kullanım tek dosyada tembel `require` + try/catch (paket kaybolsa da sunucu ayakta kalır). <sub>(CLAUDE.md:152)</sub>
- **[ÇEKİRDEK]** ÖLÜ KUMANDA YASAK: bir ayar o kurulumda hiçbir şey yapmıyorsa panel onu düzenlenebilir göstermez — DEVRE DIŞI bırakır ve SEBEBİNİ yazar (gizlemek "böyle bir ayar yok" derdi; ayar var, başka yerden yönetiliyor). Emsal: `BACKUP_SCHEDULE_ENABLED=false` kurulumunda "Otomatik yedek saati" (`GET /backups.scheduleEnabled`). Uç ile zamanlayıcı AYNI yüklemi kullanır (`=== "false"` → kapalı, tanımsız = AÇIK); iki farklı yüklem panelin yanlış kumandayı açması demektir. · bekçi: `scripts/test_backup.ts §S` + `Electron BackupScheduleCard.test.tsx` <sub>(arşiv:2026-09-10 O-1)</sub>
- **[ÇEKİRDEK]** Offsite hedefi GÖRELİ olamaz: `gdrive` (iki noktasız) rclone'da yerel yola çözülür ve tüm yedekler DB ile aynı diske gider — üstelik `copy` ve `lsf` aynı yanlış yere gittiği için gösterge YEŞİL kalır. Kural `isAcceptableTarget` tek kaynağında (`ad:` ya da tam yol; UNC/mutlak MEŞRU) ve İKİ KAPIDA uygulanır — yazarken 400, **OKURKEN** `configured:false`. İkincisi asıl olan: zaten kayıtlı yanlışı yalnız o görünür kılar. Geçerli ama bu makinede olan hedef ENGELLENMEZ, `remoteIsLocalPath` ile İŞARETLENİR ("başarılı" ≠ "yeterli"). · bekçi: `scripts/test_offsite_sweep.ts §3` <sub>(arşiv:2026-09-10 K-1)</sub>
- **[ÇEKİRDEK]** Açılışta TAHMİNE dayalı felaket uyarısı basılmaz: hedefi/durumu ancak iş KOŞUNCA bilinen bir kontrol, uyarısını da o koşumdan basar (offsite süpürücü emsali — boot'ta env'e bakıp "yedekler aynı diskte OLABİLİR" demek, hedefi panelden tanımlı fabrikada her açılışta YANLIŞ ALARM'dı). Sinyal silinmez, ölçüldüğü ana TAŞINIR; uyarı körlüğü gerçek felaketi de gizler. · bekçi: `scripts/test_offsite_sweep.ts` <sub>(arşiv:2026-09-10 offsite yanlış alarmı)</sub>
- **[ÇEKİRDEK]** Node süreç uyarıları YIĞIN İZİYLE log'a düşer (`lib/process-warnings.ts`, boot'ta kurulur): Node'un önerdiği `--trace-deprecation` canlıda YENİDEN BAŞLATMA demek, oysa `warning` olayının `w.stack`i çağrı yerini BAYRAKSIZ DA taşır. İz ETİKETSİZ basılır (`logger.yiginIzi`), imza çağrı yerini içerir (aynı metin başka yerden gelirse ayrı sorundur). ⚠️ `util.deprecate` uyarıları SÜREÇ BAŞINA BİR KEZ basar — log'dan SIKLIK okunamaz. · bekçi: `scripts/test_process_warnings.ts` <sub>(arşiv:2026-09-07 D-2)</sub>
- **[ÇEKİRDEK]** helmet İKİ AYRI ÖRNEK kurulur (HSTS/CSP-upgrade LAN'a sızarsa panel kullanıcının HSTS önbelleğinde kilitlenir; geri dönüş sunucuda değil tarayıcıdadır) ve dispatcher'ın FONKSİYON ADI `helmetMiddleware` OLMAK ZORUNDA — Express katman adını fonksiyondan alır, isimsiz arrow sıra bekçisini kör eder. · bekçi: `scripts/test_middleware_order.ts` <sub>(CLAUDE.md:95)</sub>

### Yasaklar

- **[ÇEKİRDEK]** Backend'de yalnız izinli paket listesindeki paketler kullanılır; yeni ihtiyaçta önce 'kendin yaz' denenir (node-cron→setInterval, handlebars→kendi şablon motoru, CSV paketi→hiç). <sub>(CLAUDE.md:152)</sub>

### Kararlar

- **[PROFİL]** `GET /api/boss/overview` beş bölümü TEK uçtan döner, izin süzmesi SERVİSTE yapılır (yetkisiz bölümün sorgusu HİÇ koşmaz) ve YENİ İZİN KODU AÇILMAZ; patron üretim kartı ADET basar — metraj ikinci bir 'üretilen' tanımı doğururdu. · bekçi: `scripts/test_boss_overview.ts` <sub>(CLAUDE.md:95)</sub>

## Panel (Electron)


### Tuzaklar

- **[ÇEKİRDEK]** Route haritası `src/router.tsx`te DEĞİL `src/routes/content-routes.tsx`tedir (router.tsx 39 satır: yalnız login/forbidden/totp/AuthLanding); `src/` altında ağaçta yazmayan data/, providers/, routes/, test/ de vardır. <sub>(CLAUDE.md:31)</sub>
- **[PROFİL]** `BossShell` sekme sistemini bypass eder ama router altyapısını KULLANIR — kendi memory router'ını kurma (sayfalar useTabId/TabPortalProvider/history-depth'e bağlı; PageHeader geri oku sessizce ölür, modaller yanlış portallanır). Hash `useHashPath` ile REAKTİF okunur. · bekçi: `Electron/src/test/boss-shell.test.ts` <sub>(CLAUDE.md:95)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Electron yerleşimi sabittir: `electron/` main süreci (main/preload/menu + `ipc/` DOMAİN BAŞINA BİR DOSYA), `shared/` main↔renderer sözleşmeleri, `src/` renderer; her modül kendi `pages/<Modul>/` klasörüne yazılır ve küçük dosyalara bölünür. <sub>(CLAUDE.md:31)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** `R:undated__her-cud-operasyonu-tablosu-istisna-kisisel` → `kök CLAUDE.md 2026-08-25 notu ('Prod'un üç dev'de yapılacaklar notu', CLAUDE.md:84) — küme dışı`: Audit best-effort sayacının adresi: eski satır 'yazım hatası … /health sayacına düşer' der; 2026-08-25 notu '/health'te auditGuard YOK (/api/admin/health)' diyerek operasyonel alanların taşındığını kaydeder. /health'in alan kümesi DONDURULMUŞ; auditWriteFailures buildRichHealth() içinde, yalnız /api/admin/health'ten okunur. Kuralın 'best-effort + tx dışında' kısmı geçerli; değişen ADRES. ✅ çürütmeden geçti

## Çözülmüş çelişkiler

- `B:undated__uc-bir-module-aitse-router-adlandirilmis` ↔ `R:2026-09-01__2026-09-01-patron-modulu-fabrikaya`: Kod patron notunu uyguluyor: uzakta 404 YALNIZ sabit yol denylist'idir (login-card/login-quick-pin/mobile-users + /api/devices,/api/discovery,/api/mobile,/api-docs). Modül kapısı uzak/LAN ayrımına HİÇ bakmaz, her zaman 403 + details.code döner ve bekçi de bunu ölçer. Kontrol listesindeki 'tünelde 404' cümlesi hatalıdır, SİLİNMELİ.

## Açık sorular

- Tarihsiz dört sözleşme üyesinin (izinli paketler · Electron ağacı · audit · TR mesaj) kök dizinde SATIRI YOK ve olmamalı — bunlar alt-CLAUDE / Ortak Konvansiyonlar metinleridir; archiveOnly listesi 'dizin satırı gerekmez' anlamındadır, 'arşive taşı' değil.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_audit_depth`, `test_audit_labels`, `test_boss_overview`, `test_device_activity`, `test_device_pairing_flag`, `test_discovery_identity`, `test_dispatch_allocation_fresh`, `test_identity_ledger`, `test_label_snapshot_audit_split`, `test_manual_attributes_reason`, `test_merge_field_picks`, `test_o19_operator_trace`, `test_observability_cache`, `test_observability_contract`, `test_period_close`, `test_permission_grant_source`, `test_phase0_quickwins`, `test_process_warnings`, `test_record_provenance`, `test_remote_access_guard`, `test_report_day_boundary`, `test_reports`, `test_roll_entry_station`, `test_sack_notes`, `test_settings_password`, `test_shipment_invoice`, `test_superadmin`, `test_superadmin_provision`, `test_superadmin_visible`, `test_system_log`, `test_system_log_query_gate`, `test_totp`, `test_user_credentials_guard`, `test_web_hardening`, `test_work_session_close_all`, `test_work_session_stamping`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-09-01 · 2026-09-01 — Patron modülü: fabrikaya GELEN PORT AÇMADAN uzaktan takip — `CLAUDE-NOT-ARSIVI.md:1791-2032`
- 2026-09-10 · 2026-09-10 — Fabrika prod log'undan üç bulgu (kapanış teşhisi ③) [ÇEKİRDEK] — `CLAUDE-NOT-ARSIVI.md` §2026-09-10
- 2026-09-10 · 2026-09-10 — Künyesiz istemci görünmezdi: sürüm UA'dan okunuyor [ÇEKİRDEK] — `CLAUDE-NOT-ARSIVI.md` §2026-09-10 künyesiz
