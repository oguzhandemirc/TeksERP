# Fabrika saat dilimi — tek kaynak, tarihli dönemler

> Durum: TZ-B + TZ-İ + I9 indi (tek değerli `company.timezone`) · **TZ-D (bu belge): tarihli dönemler** dalda `fabrika/saat-dilimi-donemleri`.
> Kararlar: kullanıcı 2026-09-30 — *"tek kaynaktan olsun ama her fabrikaya göre seçilebilir olsun saat dilimi"* ve *"programdaki şeyler saat diliminden etkilenmeyecekse saat dilimi ne işe yarayacak? geçmiş kayıtlar etkilenmesin, saat dilimi değiştirildikten sonraki kayıtları etkilesin"*.

## 0. Sınıflandırma

- **[ÇEKİRDEK]** Fabrika günü ve BÜTÜN görüntü/basım saatleri (panel, tablet, PDF/Excel, patron bulutu) fabrikanın saat diliminden ve TEK kaynaktan gelir — istemcinin bilgisayar saat diliminden DEĞİL.
- **[ÇEKİRDEK]** Saat dilimi bir **DÖNEM DEFTERİDİR**: bir kaydın saati, günü, vardiyası ve rapor günü **kaydın ANINDAKİ** dilimle yorumlanır. Değişiklik yalnız yürürlüğe girdiği andan SONRAKİ kayıtları etkiler; geçmiş kayıtların saati/günü asla kaymaz. "Bugün" şimdiki dilimde bugündür.
- **[PROFİL]** Hangi dilim(ler) olduğu fabrikanın seçimidir. Satır yoksa bütün zaman `Europe/Istanbul` = bugünkü davranış (çıktı, SQL metni ve plan birebir).
- Değişiklik bir kurulum kararıdır: `admin:settings` + ayar şifresi, önizleme, atomik yazım, audit.

## 1. Veri modeli

`factory_timezone_periods` (`FactoryTimezonePeriod`) — ekleme-yalnız: `id` UUID · `timeZone` IANA · `validFrom` timestamptz · `reason?` · `reversesPeriodId?` (@unique, ters bağ) · `createdById?` (künye, NULL'lanabilir kolon; yazan her zaman doldurur) · `createdAt`.

- **Çözümleme** (`resolveFactoryTimezonePeriods`, time.ts): ters kayıt çifti (`reversesPeriodId` ↔ hedefi) birbirini **söndürür**; kalanlarda aynı `validFrom`da en son satır (createdAt, sonra id) kazanır; geçersiz dilimli satır o dönemde varsayılanla yorumlanır; ardışık aynı dilimler birleşir.
- **tzAt(an)** = `validFrom ≤ an` olan son etkin dönemin dilimi; yoksa taban (varsayılan).
- **Kronoloji:** `createdAt` yazımda `GREATEST(clock_timestamp(), son satır + 1 ms)` — aynı `validFrom`da sıra belirlenimli.
- **Eski tek değerli ayar** (`company.timezone`, TZ-B): hiçbir sürüme/etikete çıkmadı (ölçüldü 2026-09-30: `0f4108bf`/`0887690e`/`a16c4471` main'de ve etikette YOK) ⇒ göç script'i yok. Satır yine de varsa geçerliyse **taban** (ilk dönemden önceki dilim) olarak YORUMLANIR; geçersizse varsayılan + uyarı, yazma yolu onu varsayılana çeker (hiçbir anın dilimi değişmez). Anahtar rezerve kalır.

## 2. Değişiklik — yürürlük anı

- Yeni dilim **bir sonraki gün başından** geçerli olur: E = yeni dilimde şimdiden sonraki ilk yerel gece yarısı (`factoryTimezoneChangeStart`). Gün bölünmez: E'yi içine alan gün eski ve yeni dilimde sürer, **uzar ya da kısalır** (İstanbul→Berlin 25 sa · Berlin→İstanbul 23 sa · İstanbul→New York 31 sa · New York→İstanbul 17 sa). Eski günün E'den hemen önceki anahtarı yeni günden ileride olamaz ve gün atlanamaz; ikisi arası 24 saati aşan tarih çizgisi geçişinde ilk gece yarısı alınır (bir takvim günü iki kez yaşanır — fiziksel gerçek).
- **Bekleyen değişiklik** (E henüz gelmedi) ekranda görünür ve **iptal edilebilir**; iptal SİLME değil ters kayıttır (aynı `validFrom`da önceki dilimle yeni satır, `reversesPeriodId`). Yürürlüğe girmiş dönem iptal edilmez (geçmiş değişmez) — geri dönmek yeni bir değişikliktir.
- Bekleyen varken ikinci değişiklik yazılmaz (409 `FACTORY_TIMEZONE_PENDING`); aynı değişikliğin tekrarı idempotenttir.

## 3. Uç sözleşmesi

- **Okuma:** `GET /api/feature-flags` → `factoryTimezone` (şimdiki) · `factoryTimezoneBase` · `factoryTimezonePeriods: [{ validFrom, timeZone }]` · `factoryTimezonePending: { id, timeZone, validFrom, previousTimeZone } | null`. Dönem alanları bayrak değil DURUMDUR: route süreç değerinden ekler (30 sn önbelleği beklemez; bekleyen değişiklik vaktinde yürürlüğe girer).
- **Önizleme:** `GET /api/feature-flags/factory-timezone/preview?timeZone=` (`admin:settings`) — yazmaz; `{ current, proposed, changed, storedInvalid, pending, currentOffset, proposedOffset, todayCurrent, effectiveFrom, effectiveFromCurrentLocal, effectiveFromProposedLocal, transitionDays[{day,hours}], warnings[] }`; uyarılar "Geçmiş kayıtlar DEĞİŞMEZ" ile başlar.
- **Planlama:** `PUT /api/feature-flags/factory-timezone` `{ timeZone, expectedCurrent, reason? }` — `admin:settings` + ayar şifresi. 409 `FACTORY_TIMEZONE_CHANGED` · `FACTORY_TIMEZONE_PENDING`; 400 `FACTORY_TIMEZONE_INVALID`. Yanıt `{ timeZone, changed, effectiveFrom, pending }`.
- **İptal:** `POST /api/feature-flags/factory-timezone/cancel` `{ periodId, reason? }` — aynı izin + şifre; 409 `FACTORY_TIMEZONE_NOT_PENDING`.
- **Defter:** `GET /api/feature-flags/factory-timezone/periods` (`admin:settings`) — en yeni önce, durumla (Yürürlükte · Bekliyor · Geçmiş · İptal edildi · İptal kaydı · Etkisiz) ve kaydedenle.
- **Eşzamanlılık:** yazan iki uç da advisory **8037** (`FACTORY_TIMEZONE_LOCK_NS`, tek anahtar) tx'in İLK ifadesi; kilitten sonra defter taze okunur. Audit `FACTORY_TIMEZONE_PERIOD / CREATE`.
- **Eski istemci:** yeni alanları tanımaz, `factoryTimezone`u (şimdiki) tek dilim sanar — dönem yokken fark yok; dönem varken yalnız geçmiş kayıtları yeni dilimle basar. Sözleşme kıran değişiklik YOK (yalnız alan eklendi).

## 4. Çalışma zamanı (backend)

- `time.ts` tek kaynaktır: dönem listesi bellek içi (`applyFactoryTimezonePeriods`), `factoryTimezoneAt(an)` senkron (tx içinde güvenli). Açılışta `listen`den ÖNCE `bootFactoryTimezone()`; ayar önbelleği her kurulduğunda defterle hizalanır; yazma/iptal commit sonrası tazeler.
- Gün/saat işlevleri (`factoryDayStart/End/Ymd/DateTr/DateTimeTr/MinuteOfDay/Weekday/DayKeyUtcMidnight`, `resolveRange*`, `factoryDayStartOfKey/EndOfKey`) anın KENDİ dilimiyle; uzamış günün başı ilk parçanın başıdır.
- **SQL:** ham `AT TIME ZONE` YALNIZ `factoryLocalTimestampSqlText` içinde. Dönem yokken `col AT TIME ZONE 'Europe/Istanbul'` (bugünkü metin; `sl_day_exact` istatistiği eşleşir); dönem varsa `CASE WHEN col < TIMESTAMPTZ '<t1>' THEN col AT TIME ZONE 'Z0' … ELSE col AT TIME ZONE 'Zn' END`. `factoryDaySql`/`factoryMonthSql` bunun `DATE_TRUNC`ıdır.
- Geçersiz kayıtlı dilim (I9 şık 2): o dönem varsayılanla yorumlanır; yürürlükteki/bekleyen dönem ya da eski ayar geçersizse `FACTORY_TIMEZONE_INVALID_STORED` (sağlık + ayar yanıtı). Geçmiş geçersiz dönem yalnız yorumlanır.
- Bekçi/script süreçleri boot etmez → varsayılan dilim; fabrika verisinde tarih basan script `loadFactoryTimezoneAtBoot()` çağırır.

## 5. Şıklar — kararlar

1. Yazma izni: (a) `admin:settings` + ayar şifresi — **kullanıcı (I9)**; iptal de aynı.
2. Geçersiz kayıtlı dilimde açılış: (b) varsayılanla aç + uyarı — **kullanıcı (I9)**; dönemlerde "o dönem varsayılanla".
3. Yedek dosya adı: (a) sunucu yerel saati — yönetici.
4. Bulut bildirim/sessiz saat: (a) tesisin o andaki dilimi — yönetici.
5. `sl_day_exact`: (b) ops adımı — yönetici; dönem eklenince ifade CASE olur, istatistik o metinle yeniden kurulur (DEPLOY-RUNBOOK §12). Sonuç doğruluğu istatistikten bağımsızdır.
6. Takvim günü alanları: hibrit kural DEĞİŞMEDİ — tam UTC gece yarısı UTC parçasından, başka an kaydın anındaki dilimden (`calendarDayZone`, `fmtCalendarDate`).
7. Açık istemcide dilim değişince kabuk/ekran yığını yeniden kurulur — anahtar ŞİMDİKİ dilimdir; bekleyen değişiklik yürürlüğe girdiği an istemci zamanlayıcısı dinleyicileri uyandırır.
8. Giriş ekranı: varsayılan dilim.
9. **Dönem modeli (TZ-D, yönetici):** yürürlük ertesi gün başı · bekleyen değişiklik tek · iptal = ters kayıt, çift söner · eşzamanlılık 8037.

## 6. İstemciler ve bulut

- **Tek biçimleyici iki dosyadır:** `src/lib/factory-time.ts` (biçim/gün) + `src/lib/factory-time-zone.ts` (taban + dönemler, `factoryTimezoneAt`, dinleyiciler) — Electron · mobil · patron/uygulama'da BAYT-EŞİT. Her an kendi dönemindeki dilimle basılır; `factoryDateTimeFormat` her `format` çağrısında anın dilimini seçer. Sunucu yanıtı `applyServerFactoryTimezone` ile uygulanır (dönem listesi yoksa eski sunucu → tek dilim); bozuk liste bütünüyle reddedilir.
- **Ayar ekranı:** Genel Ayarlar → Şirket Bilgileri → Saat dilimi: şimdiki dilim · bekleyen değişiklik (iki dilimde yürürlük anı + "Değişikliği iptal et") · yeni değişiklik (arama + önizleme: yürürlük anı iki dilimde, geçiş günü süresi, uyarılar) · dönem geçmişi tablosu (yönetici defterin tamamını, diğerleri etkin dönemleri görür).
- **Belge/Excel:** backend belge çözücüleri time.ts'ten; Excel metni istemci biçimleyicisinden — ikisi de kaydın anındaki dilim.
- **Patron bulutu:** ANLIK `tesis` = `{ saatDilimi, tabanDilim, donemler: [{ gecerliBaslangic, saatDilimi }] }` (tel şeması `TesisVerisiSchema`, tek kaynak `patron/sunucu/src/wire/esitleme.ts` + fabrika aynası). Bulut bildirim gün anahtarı ve sessiz saat `facilityTimeZoneAt(veri, an)`; uygulama dönemleri `applyServerFactoryTimezone` ile uygular. Eski paket (yalnız `saatDilimi`) tek dilim sayılır. Katalog özeti değişmedi (projeksiyon adı/izni aynı).

## 7. Bekçiler

- `Teks-Erp/scripts/test_saat_dilimi_donemleri.ts` — §1 geçmiş değişmezlik · §2 geçiş günü süreklilik/süre · §3 dönemsiz altın · §4 SQL CASE ↔ JS (DB, dört yön) · §5 eşzamanlı tek kazanan + çift söner · §6 istemci ↔ backend; her bölümde negatif sonda.
- `test_fabrika_saat_dilimi` (statik tek kaynak, doğrulama, önizleme/planlama/iptal, geçersiz kayıt, HTTP) · `test_istemci_saat_dilimi` (iki dosya ayna · dönem vektörleri üç istemcide aynı · ham API · bağ) · `test_defter_ters_yol` (TERS_BAG `reversesPeriodId`) · `test_advisory_lock_namespaces` (8037) · bulut `test_tesis_saati` §3' · istemci `factory-time-periods.test.ts` (üç projede aynı gövde).
