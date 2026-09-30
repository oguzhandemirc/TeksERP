# Fabrika saat dilimi — tek kaynak, fabrikaya göre seçilebilir

> Durum: TZ-B (sözleşme + backend + bulut teli) İNDİ · TZ-P (panel) · TZ-T (tablet) · TZ-İ (patron uygulaması) sırada.
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
| Excel | ÜRETİMİ PANELDE (`Electron/src/lib/xlsx-export.ts` · `table-export.ts` · `reportExport.ts` …) | TZ-P: PDF ile AYNI çözücü (`pdf-excel-tek-cozucu`) |
| Yedek dosya adı (`backup-naming.helper`) | sunucunun yerel saati, bekçide BEYANLI meşru | değişmedi (dosya adı ↔ `rebuildStamp` çifti) |
| Bulut teli | dönem pencereleri (`cloud-sync/periods.ts`) time.ts'ten; tesis dilimi GİTMİYORDU | yeni ANLIK projeksiyon `tesis` → `{ saatDilimi }` |
| Bulut sunucusu | `patron/sunucu/src/lib/istanbul.ts` (bildirim gün anahtarı + sessiz saat) sabit İstanbul | TZ-İ: `tesis.saatDilimi` okunur |
| Bekçiler | `test_report_day_boundary` · `test_gun_anahtari_kaynagi` (süreç dilimi cırcırı 39) · `test_doc_fmt_date` · `test_timestamptz_contract` | + `test_fabrika_saat_dilimi`; cırcır 39 → 32 ölçüldü (sabiti yönetici indirir) |

## 2. Sözleşme

- **Ayar anahtarı:** `company.timezone` (`SETTING_KEYS.COMPANY_TIMEZONE`), değer JSON string, IANA adı; doğrulama `Intl.supportedValuesOf('timeZone')` ∪ `UTC` + güvenli karakter deseni. Satır yoksa `Europe/Istanbul`.
- **Ham ayar ucundan YAZILAMAZ:** `RESERVED_SETTING_KEYS` (`FACTORY_TIMEZONE_SETTING_KEY`), `PUT /api/admin/settings/company.timezone` → 400 `SETTING_KEY_RESERVED`. `PATCH /api/feature-flags` şemasında YOK (bekçi: `test_feature_flag_contract` özel-uç ayağı).
- **Okuma:** `GET /api/feature-flags` → `data.factoryTimezone` (panel ve tablet girişten sonra aynı alanı okur). Değer sunucunun FİİLEN kullandığı dilimdir.
- **Önizleme:** `GET /api/feature-flags/factory-timezone/preview?timeZone=<IANA>` — `admin:settings`. Hiçbir şey yazmaz; `{ current, proposed, changed, currentOffset, proposedOffset, todayCurrent, todayProposed, recentRollsShifted, recentShipmentsShifted, windowDays, warnings[] }`.
- **Yazma (tek yol):** `PUT /api/feature-flags/factory-timezone` gövde `{ timeZone, expectedCurrent }` — `admin:settings` + ayar şifresi. Atomik claim: `updateMany WHERE key AND value = expectedCurrent`; satır yoksa ve beklenen varsayılansa `create` (yarış P2002 → 409). 409 `FACTORY_TIMEZONE_CHANGED` (tanı taze okumayla), 400 `FACTORY_TIMEZONE_INVALID`. Audit `SYSTEM_SETTING / company.timezone`. `settings:company` bu ucu AÇMAZ.
- **Eski istemci:** alanı tanımaz, yok sayar; kendi bilgisayar dilimiyle göstermeyi sürdürür (fabrika dilimi varsayılan kaldıkça fark yok). Sözleşme kıran değişiklik YOK.

## 3. Çalışma zamanı

- Süreç içi değer: `listen`den ÖNCE `bootFactoryTimezone()` (en çok 10 sn). Kayıtlı değer geçersizse sunucu AÇILMAZ (fail-closed: yanlış güne yazmaktansa dur). DB'ye ulaşılamazsa dinleyici bugünkü gibi açılır, yükleme 5 sn arayla arka planda sürer.
- Tazeleme: yazma ucu `applyFactoryTimezone` + önbellek geçersizleme; ayar önbelleği her yeniden kurulduğunda satırla hizalar (geçersiz satır → son geçerli dilimde kalır, uyarı basar).
- tx içinde okuma senkron ve güvenli (`getFactoryTimezone()` bellek içi değer). `PG_SESSION_OPTIONS` (`-c timezone=UTC`) AYNEN kalır.
- Bekçi/script süreçleri boot etmez → varsayılan dilimle koşar (bugünkü davranış); fabrika verisinde tarih basan script dilimi yüklemek isterse `loadFactoryTimezoneAtBoot()` çağırır.

## 4. Bulut

- Yeni ANLIK projeksiyon `tesis` = `{ saatDilimi }`, izin `bulut:oturum`, sıklık `HER_TUR` (özet aynıysa gönderilmez).
- Tel: katalog fabrika `cloud-sync/projections.ts` + `snapshots.ts` tel şeması; bulut `patron/sunucu/src/catalog/projections.ts` + `katalog-ozeti.json` (`--yaz`). **Bulut ÖNCE yayınlanır** (bilinmeyen projeksiyon `PROJEKSIYON_BILINMIYOR` ile reddedilir; fabrika tekrar dener).
- Uygulama gösterimi istemci diliminde kalır (TZ-İ kararı); bildirim gün anahtarı ve sessiz saat `tesis.saatDilimi`ye TZ-İ'de bağlanır.

## 5. Şıklar — açık kararlar (kullanıcı onayı bekleyen)

1. **Yazma izni:** (a) yalnız `admin:settings` [UYGULANDI] · (b) `settings:company` da açsın · (c) yalnız süperadmin.
2. **Geçersiz kayıtlı dilimde açılış:** (a) sunucu açılmaz [UYGULANDI] · (b) varsayılanla açılır + sağlık uyarısı.
3. **Yedek dosya adı:** (a) sunucu yerel saati kalır [UYGULANDI] · (b) fabrika dilimine geçer (`rebuildStamp` ile birlikte).
4. **Bulut bildirim/sessiz saat dilimi (TZ-İ):** (a) tesisin dilimi · (b) hesabın cihaz dilimi.
5. **`sl_day_exact` istatistiği:** (a) dokunma, varsayılan dışı kurulumda plan yavaşlığı kabul [UYGULANDI] · (b) dilim değişince istatistiği yeniden kuran ops adımı.
