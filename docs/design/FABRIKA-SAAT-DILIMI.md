# Fabrika saat dilimi — tek kaynak, fabrikaya göre seçilebilir

> Durum: TZ-B (sözleşme + backend + bulut teli) İNDİ · TZ-İ (istemciler: panel + ayar ekranı · tablet · patron uygulaması · bulut bildirim saati) dalda `fabrika/saat-dilimi-istemci` (§6).
> Karar: kullanıcı 2026-09-30 — *"tek kaynaktan olsun ama her fabrikaya göre seçilebilir olsun saat dilimi"*.

## 0. Sınıflandırma

- **[ÇEKİRDEK]** Fabrika günü ve BÜTÜN görüntü/basım saatleri (panel, tablet, PDF/Excel, patron bulutu) fabrikanın saat diliminden ve TEK kaynaktan gelir — istemcinin bilgisayar saat diliminden DEĞİL.
- **[PROFİL]** Hangi dilim olduğu fabrikanın seçimidir: `company.timezone` (IANA adı). Varsayılan `Europe/Istanbul` = bugünkü davranış; ayar satırı olmayan hiçbir kurulumda çıktı değişmez.
- Dilim değişikliği gün anahtarlarını kaydırır → **kurulum değeri** gibi ele alınır: yönetici izni, önizleme/uyarı, atomik yazım, audit.

## 1. Envanter (ölçüldü 2026-09-30, taban `47b9d825`)

| Yer | Durum (öncesi) | TZ-B sonrası |
|---|---|---|
| `Teks-Erp/src/constants/time.ts` | `FACTORY_TIMEZONE` sabiti; 44 src + 32 script dosyası içe aktarır | `DEFAULT_FACTORY_TIMEZONE` tek literal; `getFactoryTimezone()` / `applyFactoryTimezone()` / `isValidFactoryTimezone()` |
| `FACTORY_TIMEZONE` doğrudan tüketen | `inventory.service` · `import-coerce` · `future-date-guard.helper` + 9 script | `getFactoryTimezone()` |
| Ham SQL `AT TIME ZONE` / `DATE_TRUNC` | yalnız `factoryDaySql` / `factoryMonthSql` (time.ts) | varsayılan dilim ayardan; SQL'e gömmeden önce IANA listesine karşı doğrulanır |
| DB nesnesi | `sl_day_exact` ifade istatistiği (`system_logs`, İstanbul literal'i) | DOKUNULMADI — varsayılan dışı dilimde sonuç doğru, plan yavaş olabilir |
| Migration literal'leri | `20260922210000_roll_return_number` · `20260922120000_packing_group_code` (tek seferlik backfill) | tarihsel, DOKUNULMAZ (migration değişmez) |
| Belge çözücüleri (`document-render/fmt-date.ts`) | zaten time.ts'ten | aynı (artık seçilen dilimden) |
| Süreç diliminden biçimleyen | etiket `formatDate` (`label-html.shared`) · belge basım damgası (`printed-document`) · serbest belge `printedAtText` · kur/numara serisi mesajları (5 servis + `number-series.routes`) | `factoryDateTimeTr` / `factoryDateTr` |
| Excel | ÜRETİMİ PANELDE (`Electron/src/lib/xlsx-export.ts` · `table-export.ts` · `reportExport.ts` …) | TZ-İ: hücreler metin; metni üreten biçimleyiciler (`safeFormat` · `factoryLocale*` · `cellText`) fabrika diliminden — PDF ile aynı gün/saat |
| Yedek dosya adı (`backup-naming.helper`) | sunucunun yerel saati, bekçide BEYANLI meşru | değişmedi (dosya adı ↔ `rebuildStamp` çifti) |
| Bulut teli | dönem pencereleri (`cloud-sync/periods.ts`) time.ts'ten; tesis dilimi GİTMİYORDU | yeni ANLIK projeksiyon `tesis` → `{ saatDilimi }` |
| Bulut sunucusu | `patron/sunucu/src/lib/istanbul.ts` (bildirim gün anahtarı + sessiz saat) sabit İstanbul | TZ-İ: `lib/facility-clock.ts` — olay üretimi ve gönderim `tesis.saatDilimi`ni okur |
| Bekçiler | `test_report_day_boundary` · `test_gun_anahtari_kaynagi` (süreç dilimi cırcırı 39) · `test_doc_fmt_date` · `test_timestamptz_contract` | + `test_fabrika_saat_dilimi`; cırcır 39 → 32 ölçüldü (sabiti yönetici indirir) |

## 2. Sözleşme

- **Ayar anahtarı:** `company.timezone` (`SETTING_KEYS.COMPANY_TIMEZONE`), değer JSON string, IANA adı; doğrulama `Intl.supportedValuesOf('timeZone')` ∪ `UTC` + güvenli karakter deseni. Satır yoksa `Europe/Istanbul`.
- **Ham ayar ucundan YAZILAMAZ:** `RESERVED_SETTING_KEYS` (`FACTORY_TIMEZONE_SETTING_KEY`), `PUT /api/admin/settings/company.timezone` → 400 `SETTING_KEY_RESERVED`. `PATCH /api/feature-flags` şemasında YOK (bekçi: `test_feature_flag_contract` özel-uç ayağı).
- **Okuma:** `GET /api/feature-flags` → `data.factoryTimezone` (panel ve tablet girişten sonra aynı alanı okur). Değer sunucunun FİİLEN kullandığı dilimdir.
- **Önizleme:** `GET /api/feature-flags/factory-timezone/preview?timeZone=<IANA>` — `admin:settings`. Hiçbir şey yazmaz; `{ current, proposed, changed, currentOffset, proposedOffset, todayCurrent, todayProposed, recentRollsShifted, recentShipmentsShifted, windowDays, warnings[] }`.
- **Yazma (tek yol):** `PUT /api/feature-flags/factory-timezone` gövde `{ timeZone, expectedCurrent }` — `admin:settings` + ayar şifresi. Atomik claim: `updateMany WHERE key AND value = expectedCurrent`; satır yoksa ve beklenen varsayılansa `create` (yarış P2002 → 409). 409 `FACTORY_TIMEZONE_CHANGED` (tanı taze okumayla), 400 `FACTORY_TIMEZONE_INVALID`. Audit `SYSTEM_SETTING / company.timezone`. `settings:company` bu ucu AÇMAZ.
- **Eski istemci:** alanı tanımaz, yok sayar; kendi bilgisayar dilimiyle göstermeyi sürdürür (fabrika dilimi varsayılan kaldıkça fark yok). Sözleşme kıran değişiklik YOK.

## 3. Çalışma zamanı

- Süreç içi değer: `listen`den ÖNCE `bootFactoryTimezone()` (en çok 10 sn). Kayıtlı değer geçersizse sunucu varsayılan dilimle AÇILIR ve `FACTORY_TIMEZONE_INVALID_STORED` uyarır (şık 2). DB'ye ulaşılamazsa dinleyici bugünkü gibi açılır, yükleme 5 sn arayla arka planda sürer.
- Tazeleme: yazma ucu `applyFactoryTimezone` + önbellek geçersizleme; ayar önbelleği her yeniden kurulduğunda satırla hizalar (geçersiz satır → son geçerli dilimde kalır, uyarı basar).
- tx içinde okuma senkron ve güvenli (`getFactoryTimezone()` bellek içi değer). `PG_SESSION_OPTIONS` (`-c timezone=UTC`) AYNEN kalır.
- Bekçi/script süreçleri boot etmez → varsayılan dilimle koşar (bugünkü davranış); fabrika verisinde tarih basan script dilimi yüklemek isterse `loadFactoryTimezoneAtBoot()` çağırır.

## 4. Bulut

- Yeni ANLIK projeksiyon `tesis` = `{ saatDilimi }`, izin `bulut:oturum`, sıklık `HER_TUR` (özet aynıysa gönderilmez).
- Tel: katalog fabrika `cloud-sync/projections.ts` + `snapshots.ts` tel şeması; bulut `patron/sunucu/src/catalog/projections.ts` + `katalog-ozeti.json` (`--yaz`). **Bulut ÖNCE yayınlanır** (bilinmeyen projeksiyon `PROJEKSIYON_BILINMIYOR` ile reddedilir; fabrika tekrar dener).
- Uygulama gösterimi TESİSİN diliminden (TZ-İ; oturum `anlik:tesis`i okur, önbellekle çevrimdışı da); bildirim gün anahtarı ve sessiz saat `tesis.saatDilimi`nden (`facility-clock.ts`; projeksiyon yoksa varsayılan).

## 5. Şıklar — kararlar (2026-09-30, I9)

1. **Yazma izni:** (a) yalnız `admin:settings` + ayar şifresi · (b) `settings:company` da açsın · (c) yalnız süperadmin. **KARAR: (a) — kullanıcı seçti (bugünkü hâl).**
2. **Geçersiz kayıtlı dilimde açılış:** (a) sunucu açılmaz · (b) varsayılanla açılır + sağlık uyarısı. **KARAR: (b) — kullanıcı seçti.** Sunucu `Europe/Istanbul` ile açılır; `/api/admin/health` → `factoryTimezone.warning` ve ayar yanıtı `factoryTimezoneWarning` (yalnız sorun varken gönderilir) `FACTORY_TIMEZONE_INVALID_STORED` kodunu ve "Kayıtlı saat dilimi geçersiz; İstanbul kullanılıyor — Şirket Bilgileri → Saat dilimi'den düzeltin" metnini taşır; panel küresel şerit + ekran uyarısı + sunucu durumu alarmı gösterir. Düzeltme yürürlükteki dilimi seçip kaydetmektir: önizleme `storedInvalid` + `changed` döner, yazım ham geçersiz değeri claim eder. Çalışırken geçersizleşen satırda son geçerli dilim kalır, uyarı o dilimi adıyla söyler. Bekçi `test_fabrika_saat_dilimi` §8.
3. **Yedek dosya adı:** (a) sunucu yerel saati kalır · (b) fabrika dilimine geçer. **KARAR: (a) — yönetici.**
4. **Bulut bildirim/sessiz saat dilimi:** (a) tesisin dilimi · (b) hesabın cihaz dilimi. **KARAR: (a) — yönetici (uygulandı, TZ-İ).**
5. **`sl_day_exact` istatistiği:** (a) dokunma, varsayılan dışı kurulumda plan yavaşlığı kabul · (b) dilim değişince istatistiği yeniden kuran ops adımı. **KARAR: (b) — yönetici.** Adım `docs/ops/DEPLOY-RUNBOOK.md` §12; önizleme uyarısı dilim değişiminde tek cümleyle hatırlatır. Sonuç doğruluğu istatistikten bağımsızdır, yalnız plan hızı etkilenir.
6. **Takvim günü alanları (vade · termin · planlanan tarih · kur günü) negatif ofsetli dilimde:** (a) AN olarak fabrika diliminde · (b) takvim günü olarak UTC parçalarından; backend `fmt-date` ile AYNI kural. **KARAR: (b) — yönetici; ölçümle HİBRİT uygulandı.** Ölçüm: bu alanların çoğu `@db.Date` değil `Timestamptz` ve İKİ saklama biçimi var — "YYYY-MM-DD" girdisi `new Date()` ile tam UTC gece yarısına yazılır (fatura vadesi formu, sipariş termini, iş emri planlanan tarihleri; gerçek `@db.Date`: kur günü, dönem sonu), ama cari vade gününden TÜRETİLEN fatura vadesi bir ANdır (düzenleme anı + N gün) ve çek/kasa tarihleri fabrika günü başı anıdır. Saf UTC parçası türetilmiş vadeyi İstanbul'da gece 00:00–03:00 arasında bir gün GERİ basardı. Kural: değer tam UTC gece yarısıysa UTC parçaları (dilim değişse de gün kaymaz), değilse fabrika günü — her iki saklamada doğru. Yüzey: istemci `calendarDayZone` · `formatCalendarDay` · `fmtCalendarDay` · `calendarLocaleDateString` · `calendarDaysFromToday` (üç ayna), backend `fmtCalendarDate`. Fatura tarihi ve ödeme tarihi ölçüldü: AN olarak saklanıyor, fabrika gününde basım zaten doğru — çağrı noktası değişmedi. Bekçiler: `test_doc_fmt_date` §3, istemci `factory-time.test.ts` takvim bloğu (America/New_York).
7. **Açık istemcide dilim değişince:** (a) panel kabuğu / tablet ekran yığını yeniden kurulur · (b) yalnız yeni çizilen ekranlar. **KARAR: (a) — yönetici (uygulandı).**
8. **Giriş ekranı (oturum öncesi):** (a) varsayılan dilim · (b) son bilinen dilim cihazda saklanır. **KARAR: (a) — yönetici (uygulandı).**

## 6. İstemciler (TZ-İ)

- **Tek biçimleyici:** `src/lib/factory-time.ts` — Electron · mobil · patron/uygulama'da BAYT-EŞİT (bağımlılıksız TS). Intl `formatToParts` + fabrika dilimi; Intl'in dilim desteği olmayan motorda varsayılan dilim sabit UTC+3 ile yine doğru. Yüzey: `factoryLocaleString/DateString/TimeString` (yerleşik `toLocale*String`in ECMA-402 varsayılan kuralıyla birebir, dilim eklenmiş) · `factoryDateTimeFormat` · `formatFactory(an, "dd.MM.yyyy HH:mm")` (date-fns belirteçleri) · `fmtFactoryDate/Time/DateTime/Stamp` · `factoryDayKey` · `factoryDayDiff` · `factoryDayStart[Iso]`/`factoryDayEndIso`/`factoryBackWindowIso` · `toFactoryDateTimeInput`/`fromFactoryDateTimeInput` · `fmtDayKey` (takvim günü, dilimsiz).
- **Dilimin geldiği yer:** panel ve tablet `GET /api/feature-flags` → `factoryTimezone` (servis katmanı uygular; tablet kalıcı önbellekteki değeri de uygular); patron uygulaması oturumda ANLIK `tesis` → `saatDilimi`. Geçersiz değer yok sayılır, son geçerli dilim kalır. Dilim değişince panel kabuğu / tablet ekran yığını yeniden kurulur (şık 7).
- **An ↔ takvim ayrımı:** bir AN (createdAt, dispatchedAt…) fabrika diliminde basılır; bir TAKVİM GÜNÜ (seçicinin yyyy-MM-dd'si, sürüm notu kimliği) dilimsiz basılır; takvim günü ALANI (vade, termin, planlanan tarih) şık 6 kuralıyla (`formatCalendarDay`). Tarih seçicisi/takvim ızgarası takvim modelidir; ana çeviri yalnız sorgu sınırında (`factoryDayStartIso`/`factoryDayEndIso`) yapılır. "Bugün" daima fabrikanın bugünüdür (`factoryDayKey()`).
- **Ayar ekranı:** Genel Ayarlar → Şirket Bilgileri → Saat dilimi (`FactoryTimezoneField`): arama + liste, seçim önizleme ucunu çağırır ("gün sınırları kayar" uyarısı, ofset, bugün, son 30 günde günü değişecek top/sevkiyat, uyarılar), `expectedCurrent = preview.current` ile PUT (ayar şifresi); 409'da önizleme yenilenir. Yazma yalnız `admin:settings`; diğerleri geçerli dilimi salt-okunur görür.
- **Bekçiler:** `Teks-Erp/scripts/test_istemci_saat_dilimi.ts` (ayna · ham API yasağı AST'li · bağ; beyanlı sayılı istisna iki yönlü) · `patron/sunucu/scripts/test_tesis_saati.ts` (bulut gün anahtarı/sessiz saat dilimden) · istemci birim testleri (`factory-time.test.ts` üç projede; süreç dilimi UTC / America/New_York / Asia/Tokyo'da aynı çıktı).
