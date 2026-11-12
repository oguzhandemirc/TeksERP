# Genel · Konvansiyon
> Kısa kural dosyası; gerekçe, ölçüm ve 2026-11-03 öncesi tam metin: `docs/kurallar/ayrinti/genel.md`.

> Alan kural dosyası — dokunmadan ÖNCE okunur. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi. Hakem notu: modül kapısı 403'tür (404 değil); "tünelde 404" cümlesine uyma.

## Ortak (backend + panel + tablet)

### Değişmezler

- **[ÇEKİRDEK]** Kök `CLAUDE.md` yalnız tek cümle emir kipinde çekirdek kural taşır (tavan 12 KB, `check-docs.mjs`); gerekçe arşive, alan ayrıntısı `docs/kurallar/<alan>.md`'ye. Ajan yalnız alanının bekçilerini koşar, tam set CI'da; iş kapanınca `/clear`; model Opus/Fable, Sonnet yok.
- **[ÇEKİRDEK]** Alt proje `CLAUDE.md`'leri yalnız o projenin çalışma düzenini kısa kural cümleleriyle taşır, 10 KB tavanlı (`check-docs.mjs`, cırcır); ayrıntı alan/standart dosyasına, gerekçe arşive.
- **[ÇEKİRDEK]** İstemci envanteri künyesini bildiremeyeni de listeler: `X-Client-*` yoksa sürüm User-Agent'tan çıkarılır (yalnız Electron; `okhttp` kütüphane sürümüdür) ve satır `declared:false` taşır. · bekçi: `scripts/test_client_registry.ts §5`
- **[ÇEKİRDEK]** Künye başlığı (`X-Client-*`) hiçbir kapıya girmez; üç kollu ölçülür (başlık adı · `CLIENT_INFO_HEADERS` sabiti · tek fonksiyonun beyanlı okuyucuları, değer koşula/atmaya girmez). Değer `Session.clientVersion`a gözlem olarak yazılabilir; NULL = ölçülemedi.
- **[ÇEKİRDEK]** `Session.clientVersion` login anında yazılır, sonra yalnız NULL'dan doluya tamamlanır; dolu satır ikinci sürümle DEĞİŞMEZ. · bekçi: `scripts/test_client_registry.ts §1/§1b/§1c/§4b`, `scripts/test_session_registry.ts §9`
- **[ÇEKİRDEK]** Kapanış 5 sn'lik zorla-çıkışa düşerse log FAZI ve AÇIK BAĞLANTI SAYISINI basar; tek cümlelik "tamamlanmadı" yetmez.
- **[ÇEKİRDEK]** Komut kapısı (`scripts/claude-hooks/bash-guard.mjs`) yasağı ÇALIŞTIRILACAK KOMUTTA arar; heredoc yalnız alıcısı çalıştırmıyorsa veri (`psql <<EOF`, `bash <<EOF` beyaz listede DEĞİL); yazılıp çalıştırılan script kapsam dışı, kapı bunu basar. · bekçi: `Teks-Erp/scripts/test_bash_guard_scope.ts`
- **[ÇEKİRDEK]** Oturum test DB'si yalnız `node scripts/test-db.mjs ac|sil|liste` ile açılır/silinir: ad `tekserp_[a-z0-9]+_test`; silme kayıt/sahip ağaç/canlı `.env`/bağlı oturum ölçer (FORCE yok); klon kaynağı `rolls` > 0 ya da ölçülemezse red; silme SQL'i kabuğa yazılmaz. · bekçi: `scripts/test_test_db_araci.mjs`
- **[ÇEKİRDEK]** Kanca yolu kabuğun dizininden bağımsız olur (mutlak ya da `${CLAUDE_PROJECT_DIR}` çapalı); göreli yol kancayı sessizce öldürür; yapılandırmanın doğruluğu ölçülür. · bekçi: `Teks-Erp/scripts/test_hook_config.ts`
- **[ÇEKİRDEK]** Her CUD `AuditService.log()` ile `SystemLog`a yazılır; istisna `AUDIT_EXEMPT_MODELS`te beyanlı, sınıf kümesi KAPALI (`KULLANICI_TERCIHI` · `TELEMETRI` · `KIMLIK_AKISI` · `EBEVEYN_EYLEMDE` · `SISTEM_ISI`); beyansız sessizlik kırmızı; denetim yazma yolunda aranır.
- **[ÇEKİRDEK]** `EBEVEYN_EYLEMDE` iddiadır ve ölçülür: yazan yardımcının en az bir çağıranı audit taşır. · bekçi: `test_audit_muafiyeti.ts` (§2 · §3 · §4 · §5 · §7) + `test_audit_depth.ts`
- **[ÇEKİRDEK]** Audit best-effort: yazım hatası isteği düşürmez, çağrı tx DIŞINDA. Hata sayacı `/api/admin/health`te (`auditWriteFailures`); `/health` alan kümesi DONDURULMUŞ, yeni operasyonel metrik `buildRichHealth`e eklenir.
- **[ÇEKİRDEK]** Validation hata mesajları Türkçe yazılır.
- **[ÇEKİRDEK]** Hızlı PIN ve QR kart kodu DB'de yalnız geri çevrilemez özet (`"<kid>:<HMAC-SHA256>"`; anahtar LICENSE_DIR halkasında, emaneti DB'de mühürlü); düz değer yalnız verildiği an döner; PIN `@unique` özetle kimlik belirler; düz kolon dönüşüme dek salt okunur.
- **[ÇEKİRDEK]** PIN/kart repoya, log'a, sürüm notuna, audit yüküne girmez. · bekçi: `scripts/test_kisa_kimlik_ozet.ts` (§1 · §2 · §8), `scripts/test_audit_depth.ts`, `scripts/test_user_credentials_guard.ts`
- **[ÇEKİRDEK]** Kısa kimlik anahtarı yeni makineye dönüşte kaybolmaz: emanet `.tkenc` mühürlü DB satırı; geri koyma yalnız yedek parolası/kâğıt anahtarla (`kisa-kimlik anahtar-geri-yukle`); uyuşmazlıkta 401 `SHORT_CREDENTIAL_KEY_MISMATCH` + toplu PIN sıfırlama.
- **[ÇEKİRDEK]** Düz → özet dönüşümü migration'da DEĞİL: başarılı girişte tembel (atomik claim) + `kisa-kimlik donustur` (kuru → onay → --apply → ikinci koşum 0). · bekçi: `scripts/test_kisa_kimlik_ozet.ts §3 · §4 · §7`
- **[ÇEKİRDEK]** Satırda düz PIN/kart doluysa özet BAYATTIR (`liveDigest`): giriş düzü esas alır; aynı PIN bir kişide özet, başkasında düz eşleşirse kimse açılmaz (401 `QUICK_PIN_AMBIGUOUS`). · bekçi: `scripts/test_kisa_kimlik_ozet.ts §9`
- **[ÇEKİRDEK]** Giriş deneme kilidi yeniden başlatmada sıfırlanmaz: bellek haritası otorite, değişiklik SHA-256 anahtarla `login_lockout_buckets`a yazılır, açılışta yüklenir (düz IP/kullanıcı/cihaz yok); kart yolunda kullanıcı kovası dağıtılmış denemeyi sayar; kilit anında `LOGIN_LOCKED` yazılır.
- **[ÇEKİRDEK]** Giriş kilidi bekçileri: `scripts/test_kisa_kimlik_ozet.ts §5`, `scripts/test_login_lockout.ts`, `scripts/test_p2_infra.ts`.
- **[ÇEKİRDEK]** TOTP kurulumunun TEK yolu yöneticinin açtığı 15 dk'lık tek kullanımlık penceredir (TOFU yok). 2FA isteğe bağlı; açık kullanıcıya her PAROLALI girişte `issueToken`den önce sorulur: kodsuz 409 `TOTP_REQUIRED`, yanlış 401 `TOTP_INVALID` (kilit yalnız 401'i sayar).
- **[ÇEKİRDEK]** PIN/kart girişinde TOTP sorulmaz; "açık" = şu anki sır kurulum penceresinde kanıtlandı, tek kaynak `TotpAccountService.readActive`. · bekçi: `scripts/test_totp.ts`
- **[ÇEKİRDEK]** İçe aktarım şablonu dondurulmuş sözleşmedir: Excel başlığı/sütun adı değişmez (sürüm kırıcı, `minVersion` uygulanamaz); bilgi yeni sütun/yardım metniyle eklenir.

- **[ÇEKİRDEK]** Müşteri adı koda gömülmez: ağda/girişte görünen ad HAK'ın `musteri.ad`ından (`lib/license/licensee-name.ts`), belge/etiket/panel unvanı `company.name`den; unvanın ilk değeri lisans adı (bir kez, audit'li); okunamazsa nötr "TeksERP" (`constants/company.ts` + iki istemci aynası).
- **[ÇEKİRDEK]** Müşteriye özgü görünüm kanal kaydında ya da veride yaşar. · bekçi: `scripts/test_musteri_adi_kodda_yok.ts`, `scripts/test_firma_adi_dondur.ts`, `scripts/test_lisans_adi.ts`

- **[ÇEKİRDEK]** Tek işletim sisteminde ölçülebilen bekçiyi CI'da o sistemin işinde koş; başka koşucudan çıkarma beyanlı olur ve iş ci.yml'de yoksa KIRMIZI; platforma göre sessiz atlama/gevşetme yasak. · bekçi: `satici/sunucu/scripts/run-all-tests.ts` (`scripts/lib/ci-mac-isi.ts`)

- **[ÇEKİRDEK]** Görünen iş emri adı `TERIM`den OKUMA ANINDA çözülür: `WeavingOrder` = "Dokuma İş Emri", `WorkOrder` = dokuma rejimi açıksa "Terbiye İş Emri", değilse "İş Emri" (`terimDokumaAyarla`, getter). BAYT-EŞİT ayna: backend `src/constants/terim.ts`, panel/tablet/patron `src/lib/terim.ts`.
- **[ÇEKİRDEK]** Eski ad ("Dokuma işi…", önünde Terbiye/Dokuma olmayan "iş emri") görünen metne giremez, taban yalnız düşer (`--yaz`); kod/model adı, izin kodu, numara, sürüm notu, migration değişmez. · bekçi: `test_terim_eski_ad.ts`

- **[ÇEKİRDEK]** `TERIM`le DB'ye kalıcı metin yazan açılış tohumu (izin/rol şablonu/sebep) yazmadan ÖNCE rejimi DB'den çözer (`reconcileCatalogsOnce` → `refreshTermRegime`); rejim job'uyla sırasız koşturma. · bekçi: `test_terim_katalog_tohum.ts`

- **[ÇEKİRDEK]** Sayı biçimi birim sınıfına göre, her yüzeyde (kart, liste, özet bandı, rapor tablosu, grafik, kayıt sayfası, PDF/Excel, sunucu rapor cümlesi): para binlik ayırıcılı 2 hane ("325.684,90 TRY"), metre/kg/top/adet/yüzde ayırıcısız ("14700 m"); panelde yalnız `lib/format` (`formatAmount`/`formatMoney` · `formatQty`/`formatDisplay`), rapor biçiminde virgül = para (`lib/number-format`), sunucuda `anlati/sayi-bicim`; basılı müşteri belgeleri ayrı karar (`test_yerel_ayar_bagimliligi` §5).

### Yasaklar

- **[ÇEKİRDEK]** `CLIENT_IP_HEADER` yalnız beyanlı ters vekil arkasında verilir (demo) ve her isteğe uygulanır; LAN kurulumunda VERİLMEZ. `REMOTE_PORT` .env'de duruyorsa başlık yok sayılır ve uyarılır; `TRUST_PROXY` app-wide AYARLANMAZ. · bekçi: `scripts/test_web_hardening.ts §CI-11..13`

## Backend
- **[ÇEKİRDEK]** P2002 kolonu YALNIZ `src/utils/p2002.ts` ile okunur (`p2002OnField` · `p2002TargetParts` · `p2002UniqueColumn` · `p2002Mentions`); `meta.target` doğrudan okunmaz (pg adaptörü vermez). · bekçi: `test_p2002_hedef_tek_kaynak` + `test_numara_yarisi_levent_dokuma` ①


### Değişmezler

- **[ÇEKİRDEK]** bonjour-service sürümü SABİT `1.4.4` (`^` YOK); kullanım tek dosyada tembel `require` + try/catch.
- **[ÇEKİRDEK]** ÖLÜ KUMANDA YASAK: etkisiz ayar panelde gizlenmez, sebebiyle devre dışı gösterilir (`BACKUP_SCHEDULE_ENABLED=false` → `GET /backups.scheduleEnabled`); uç ve zamanlayıcı aynı yüklem (`=== "false"` kapalı, tanımsız AÇIK). · bekçi: `scripts/test_backup.ts §S` + `Electron BackupScheduleCard.test.tsx`
- **[ÇEKİRDEK]** Offsite hedefi GÖRELİ olamaz (`ad:` ya da tam yol; UNC/mutlak meşru); kural `isAcceptableTarget` tek kaynağında, yazarken 400, OKURKEN `configured:false`; bu makinedeki hedef engellenmez, `remoteIsLocalPath` ile işaretlenir. · bekçi: `scripts/test_offsite_sweep.ts §3`
- **[ÇEKİRDEK]** Açılışta tahmine dayalı felaket uyarısı basılmaz; iş koşunca bilinen kontrol uyarısını o koşumdan basar (offsite süpürücü emsali). · bekçi: `scripts/test_offsite_sweep.ts`
- **[ÇEKİRDEK]** Node süreç uyarıları yığın iziyle log'a düşer (`lib/process-warnings.ts`, boot'ta; `logger.yiginIzi`, etiketsiz; imza çağrı yerini içerir); `util.deprecate` süreç başına bir kez basar, log'dan sıklık okunmaz. · bekçi: `scripts/test_process_warnings.ts`
- **[ÇEKİRDEK]** Tx içinde aynı düzeyde ≥2 ilişki yükleyen Prisma çağrısı (include/select, create/update dahil) `sequentialTx(tx)` üzerinden; çıplak `tx.x.op` ilişki SQL'lerini tek bağlantıya paralel gönderir (pg@9'da hata). · bekçi: `scripts/test_pg_eszamanli_sorgu.ts` <sub>(arşiv:2026-11-03 S15a)</sub>
- **[ÇEKİRDEK]** helmet İKİ AYRI ÖRNEK kurulur (HSTS/CSP-upgrade LAN'a sızmaz) ve dispatcher'ın fonksiyon adı `helmetMiddleware` OLMAK ZORUNDA (isimsiz arrow yasak). · bekçi: `scripts/test_middleware_order.ts`
- **[ÇEKİRDEK]** `licenseGate` app düzeyinde, `/api` altında, İLK router'dan önce; yöntem+yol ile; kapalı yolda KİMLİK önce (oturumsuz 401; kimliksiz uçta `LICENSE_GATE`); açık yollar `constants/license-routes.ts`.
- **[ÇEKİRDEK]** Lisans kademeleri: KISITLI'da yazma, DURDURULMUŞ'ta her şey RED; gözlem kipinde sıfır fark; motor hazır değilse fail-open.
- **[ÇEKİRDEK]** Lisans kapısı bekçileri: `scripts/test_lisans_kapisi.ts`, `scripts/test_middleware_order.ts`.
- **[ÇEKİRDEK]** İstek kimliğini yalnız `request-id.middleware` (morgan'dan önce) üret ve `X-Request-Id`e yaz; audit kimliği hep sunucu UUID'si; erişim satırı `<ms>ms rid= uid= code=` biçimini ve yavaş istek (≥500 ms) halka künyesini ve UYARI satırı hız sınırını (60 sn'de 20 + tek özet) koru, Authorization/sır parametresi loga girmez, yavaş istek DB'ye yazılmaz; erişim ms'i ile halka ms'i birkaç ms ayrışabilir, eşleme `rid` iledir. · bekçi: `test_istek_log`

### Yasaklar

- **[ÇEKİRDEK]** Backend'de yalnız izinli paket listesindeki paketler kullanılır; önce "kendin yaz" denenir (node-cron→setInterval, CSV paketi→hiç); belge şablon tasarımcısında `liquidjs` 10.30.0 SABİT izinli (RAW_HTML kendi motorunda).
- **[ÇEKİRDEK]** Betik/bekçi `process.exit(` ile bitmez: sonuç `process.exitCode`a, açık handle'lar kapatılır; istisna `scripts/lib/process-exit-istisnalari.json`da beyanlı (`test_process_exit_kalibi`).

### Kararlar


## Panel (Electron)

### Değişmezler

- **[ÇEKİRDEK]** Tıklamayla hedef açan her yüzey sekme kararını yalnız `tabs/use-tab-target.ts decideTabOpen`dan alır, `prefs.tabs.openMode`a (varsayılan `newTab`) uyar; bilinçli yeni-sekme eylemleri muaf. · bekçi: `Electron/src/components/layout/tabs/use-tab-target.test.tsx`
- **[ÇEKİRDEK]** Başlık altına açıklama satırı çizme: `PageHeader.description`/`ScreenChrome.subtitle` ⓘ ipucuna; görünür tek satır kayıt bağlamı (`statusLine`; tablette `hidePlaceChip`). · bekçi: `Electron/src/components/layout/PageHeader.test.tsx` K24, `mobil/src/components/ScreenChrome.aciklama.test.tsx`
- **[ÇEKİRDEK]** Mobil istasyon 2. kat aksiyonlarını tek `StationAction[]` dizisiyle `StationActionBar`a ver: dar (<600 dp) genişlikte öncelikli en çok 3 aksiyon tam etiketle çubukta, gerisi "Diğer" alt sayfasında (birincil tekrarlanmaz, görünmez aksiyon hiçbir yerde); geniş genişlikte hepsi satırda; ekran başına ayrı chip satırı yazma. · bekçi: `mobil/src/components/stationActions/StationActionBar.test.tsx`, `stationActionLayout.test.ts`

### Tuzaklar

- **[ÇEKİRDEK]** Route haritası `src/router.tsx`te DEĞİL `src/routes/content-routes.tsx`tedir; `src/` altında data/, providers/, routes/, test/ de vardır.

### Reçeteler

- **[ÇEKİRDEK]** Electron yerleşimi: `electron/` main (main/preload/menu + `ipc/` domain başına bir dosya), `shared/` main↔renderer sözleşmeleri, `src/` renderer; her modül `pages/<Modul>/` altında küçük dosyalara bölünür.

## Geçersiz kılınan kurallar — bunlara UYMA

- **KISMI** "Binlik ayracı YOK — tüm program" (`lib/format.ts`) → 2026-11-12 para için GEÇERSİZ: para binlik ayırıcılı; ölçü/sayım/yüzde ayırıcısız kalır.
- **TAM** `users.quickPin` düz metin → 2026-10-01 G21-K: PIN/kart yalnız HMAC özeti; `/credentials` düz değeri yalnız basım penceresinde döner.
- **TAM** Uzaktan erişim tüneli (cloudflared, `REMOTE_PORT`, Cloudflare Access JWT, uzakta 404, `assertNotRemote`, uzak-yalnız TOTP, `clientIpHeaderRemoteOnly`, `/api/boss/overview`, BossShell, `WEB_BOSS`) KALDIRILDI → 2026-09-30 B6; patron, patron bulutundan izler; tek dinleyici, tek process.
- **KISMI** Audit hata sayacı `/health`te değil `/api/admin/health`te (`buildRichHealth`); "best-effort + tx dışında" geçerli.

## Çözülmüş çelişkiler


## Açık sorular

- Tarihsiz sözleşme üyeleri (izinli paketler · Electron ağacı · audit · TR mesaj) kök dizinde satır gerektirmez.

## Bekçiler — bu alana dokununca koş

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`. Ayrıntı: `Teks-Erp/docs/BEKCI-HARITASI.md`.

Backend: `test_process_exit_kalibi`, `test_istek_log`, `test_kisa_kimlik_ozet`, `test_terim_eski_ad`, `test_lisans_kapisi`, `test_pg_eszamanli_sorgu`, `test_audit_depth`, `test_audit_labels`, `test_device_activity`, `test_device_pairing_flag`, `test_discovery_identity`, `test_dispatch_allocation_fresh`, `test_identity_ledger`, `test_label_snapshot_audit_split`, `test_manual_attributes_reason`, `test_merge_field_picks`, `test_o19_operator_trace`, `test_observability_cache`, `test_observability_contract`, `test_period_close`, `test_permission_grant_source`, `test_phase0_quickwins`, `test_process_warnings`, `test_record_provenance`, `test_report_day_boundary`, `test_reports`, `test_roll_entry_station`, `test_sack_notes`, `test_settings_password`, `test_shipment_invoice`, `test_superadmin`, `test_superadmin_provision`, `test_superadmin_visible`, `test_system_log`, `test_system_log_query_gate`, `test_totp`, `test_user_credentials_guard`, `test_web_hardening`, `test_work_session_close_all`, `test_work_session_stamping`, `test_mobil_enum_aynasi`, `test_musteri_adi_kodda_yok`, `test_firma_adi_dondur`, `test_lisans_adi`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- [ÇEKİRDEK] `arsiv/2026-11.md`: §2026-11-03 K20 iş emri adı · §2026-11-03 K24
- [ÇEKİRDEK] `arsiv/2026-10.md`: §2026-10-11 terim · §2026-10-09 CI kırmızıları · §2026-10-05 PIN bayat özet · §2026-10-01 G21-K · §2026-10-30 Sekme davranışı
- [ÇEKİRDEK] `arsiv/2026-09.md`: §2026-09-30 B6 · §2026-09-10 · §2026-09-10 künyesiz · §2026-09-17 oturum sürümü · §2026-09-28 firma adı · 2026-09-01 patron modülü (GEÇERSİZ)
