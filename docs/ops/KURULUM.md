# TeksERP — Fabrika Sıfırdan Temiz Kurulum RUNBOOK'u

> Saha: tek sunucu (Xeon), sevkiyatta Electron PC'ler, istasyonlarda Android tabletler, tüm yazıcılar Argox OS-214 PPLA (BT modüllü), kantar/metre cihazları. Bu runbook yalnızca koda dayalı doğrulanmış bulguları içerir. "Doğrulamak gerek" notları, kodda kesin kanıt bulunmayan yerlerdir.

> ⚠️ **Bu runbook'un REFERANS PROFİLİ işlemeci/apreci fabrikadır** (kumaş hazır gelir; KK1 → Kurşun+KK2 → Tambur rotası). A/B/D/E/F bölümleri (sunucu · ilk admin · panel · tablet · donanım) **her fabrikada aynıdır — çekirdek**. C bölümündeki istasyon/makine/rota adımları (ADIM 5-11) o profilin **kurulum seçimidir**, sistemin kısıtı değil: farklı topolojili fabrika (dokuma/örme, ayrı KK istasyonu, çoklu depo) aynı adımları kendi istasyon kataloğuyla doldurur. Modül aç/kapa ve profil seçimi: `docs/design/MODUL-BAYRAK-TASARIM.md`. Ticaret (üretimsiz) kurulumu için `docs/ops/TICARET-KURULUM.md`.

---

> **Alım-satım (ticaret) kurulumu için:** bu runbook'un sunucu/panel bölümlerini uygula,
> sonra `docs/ops/TICARET-KURULUM.md` reçetesine geç (finance bayrakları + WEB_TRADE
> ataması + kasa/kur/devir). C bölümündeki istasyon/makine/rota adımları ticaret
> kurulumunda GEREKMEZ. Mekanik kısım: `npm run setup:ticaret` (dry-run varsayılan).

## A. SUNUCU (Backend + PostgreSQL)

**Tek yol: elle kurulum + pm2.** (2026-07-30: Inno Setup/NSSM installer'ı — `setup.exe`, `manage.ps1` — **tamamen kaldırıldı**. Ayrıntılı runbook: `DEPLOY-RUNBOOK.md`.)

### A0. Ön koşullar
1. **Node.js 22.x** (CI: `node-version: 22`), **PostgreSQL 16.x** (2026-09-04 ÖLÇÜMÜ: saha `SAHINSRV` **16.9**, geliştirme konteyneri **16.15** — parite ana sürümde. ⚠️ Burada uzun süre "18.x (dev 18.4 ile parite)" yazıyordu; ne saha ne dev 18'di ve bu satıra güvenen biri sahaya yükleyemeyeceği bir dump üretirdi: `pg_restore` GERİYE çalışmaz, 18'in dump'ı 16'ya yüklenmez. Sürümü değiştirmeden önce İKİSİNİ DE ölç.) ve **pm2** (`npm i -g pm2`) kur. `package.json`'da `engines` yok — sürüm operasyonel gerekliliktir.
2. Boş bir PostgreSQL veritabanı + login rolü oluştur. **Rol CREATEDB yetkili olmalı** — Prisma 7 `migrate deploy` bağlanınca DB'yi oluşturmayı dener; yetki yoksa "permission denied to create database" ile patlar.
3. **`postgresql.conf` TeksERP ayarlarını uygula** — `listen_addresses='127.0.0.1'`, `statement_timeout='50s'`, `log_min_duration_statement=500`, timezone ve bellek tuning'i. Bu değerlerin **tek kalan kaydı** `DEPLOY-RUNBOOK.md §6`'dır (installer'dan taşındı); atlanırsa default `work_mem=4MB`/`shared_buffers=128MB` ile yıllık raporlar `statement_timeout`'a takılır.

### A1. ENV hazırla (`Teks-Erp/.env` — sırlar; git'e girmez)
4. İki değişkeni yaz:
   ```
   DATABASE_URL="postgresql://<user>:<pass>@127.0.0.1:<port>/<db>?schema=public"
   JWT_SECRET="<en az 32 karakter rastgele>"
   ```
   - **`DATABASE_URL` yedeklemenin de kaynağıdır** — `backup.service.ts` host/port/user/db/şifreyi buradan çözer.
   - Eski `secret.json` **artık yok**; tek sır kaynağı `.env` → **yedekle**.
   - `DATABASE_URL` set değilse açılışta throw (`src/lib/prisma.ts`).
   - `JWT_SECRET` yok veya <32 karakter ise **backend AÇILMAZ** (`auth.service.ts`, modül-yükleme anında throw). `example-env.txt`'teki demo değeri prod'da kullanma — rastgele ≥32 hex üret.
   - `PORT` (default 4000) ve `HOST` (default `0.0.0.0` = tüm LAN) opsiyonel.
   - **`TEKSERP_PROFIL` — müşteri hangi profili aldı** (`basit | standart | perde | dokuma | tam`).
     İlk açılışta modül anahtarlarını (Üretim / Ön muhasebe / Ticaret / İplik / Çoklu depo /
     Kumaş teknik kartı / Tezgah izleme) bu profilden yazar. Profil tablosu:
     `docs/design/MODUL-BAYRAK-TASARIM.md §10`.
     - **Verilmezse hiçbir satır yazılmaz** ve kod varsayılanları geçerli olur
       (üretim AÇIK, diğer altısı KAPALI). Bilinçli: profili yazmadan sunucuyu bir kez
       açmak yanlış bir profili KALICI damgalamasın.
     - **Sonradan değiştirmek mevcut anahtarları DEĞİŞTİRMEZ** — modül açıp kapatma
       Sistem Profili ekranından (`PATCH /api/feature-flags`) yapılır.
     - Yükseltilen (mevcut) kurulumda satırlar zaten var → job tam **no-op**.
   - ⚠️ **2026-09-03 — satıcı (süperadmin) hesabı `.env`de DEĞİLDİR.** Eski `SUPERADMIN_*` satırları **KALDIRILDI**; hesap artık A3b'deki script ile kurulur. `.env`e yazmayın — orada durursa hiçbir işe yaramaz ve sırrı diskte kalıcılaştırır.

### A2. Ortam ayarları (`Teks-Erp/ecosystem.config.js` — sır DEĞİL; git'te)
5. Yedekleme ve port ayarları burada durur. **`BACKUP_DIR` tanımsızsa gece yedeği ÇALIŞMAZ** — deploy sonrası backend log'unda `[backup] BACKUP_DIR tanımsız` satırının **olmadığını** teyit et. Diğerleri: `BACKUP_OFFSITE_DIR` (makine dışı kopya; boşsa yedekler DB ile aynı diskte), `BACKUP_HOUR` (default 3), `PG_BIN_DIR` (`pg_dump`/`pg_restore` konumu — Windows'ta PATH'te olmaz).

### A3. Şemayı kur (migration)
6. Sırasıyla:
   ```
   npm ci
   npm run prisma:generate     # = npx prisma generate (her kurulum+güncellemede ZORUNLU)
   npm run prisma:migrate      # = npx prisma migrate deploy (boş DB'ye migration'lar, idempotent)
   ```
   - `migrate deploy` boş DB'de hatasız doğrulanmış (`MIGRATION-DEPLOY.md`).
   - **`migrate dev`'i ASLA prod'da çalıştırma** — reset riski. Sıfırdan kurulumda `migrate deploy` yeterli (reset etmez).
   - `migrate deploy` geri alınmaz; tek rollback = yedekten restore.
   - **`npm ci --omit=dev` kullanıyorsan:** `prisma.config.ts` yüklenmesi `ts-node`'a (devDependency) bağlı → `migrate deploy` patlar. Çözüm: `copy deploy\prisma.config.prod.js prisma.config.js`. devDeps kuruluysa kopyalama.

### A3b. Satıcı (süperadmin) hesabını kur

> Modül anahtarlarını (Ticaret / İplik / Çoklu depo / Üretim …) **yalnız bu hesap**
> değiştirebilir. Fabrikanın hiçbir yüzeyinde görünmez; audit'e "Sistem Bakımı"
> adıyla yazılır. Panelden ne atanabilir ne silinebilir.

```powershell
cd C:\Etkili-Yazilim\app
npm run superadmin:kur                # kurulum (idempotent)
npm run superadmin:kur -- --rotate    # parola + PIN + TOTP yenile
```

> ⚠️ **GERÇEK TERMİNAL ŞART — uzaktan koşuyorsan `-t` VER.** Script parolayı
> maskeleyerek sorar; girdi boru/dosya olduğunda hiçbir soru cevaplanamaz ve
> **süreç hata vermeden, zaman aşımına düşmeden bekler**. Doğrusu:
> `ssh -t sunucu 'cd C:\Etkili-Yazilim\app && npm run superadmin:kur'`,
> `docker exec -it <konteyner> npm run superadmin:kur` ya da doğrudan sunucu
> konsolu. `-t` unutulursa script artık **gürültülü hata verip çıkar**
> ("etkileşimli terminal ister") — eskiden sessizce donuyordu, yani kurulum
> tamamlanmamış olur ve kimse fark etmezdi. Kurulum betiğinden / pm2 / CI
> içinden çağırmayın.

Script kullanıcı adını (öneri `bakim`), parolayı (**iki kez, ekrana basılmaz**) ve
6 haneli hızlı giriş PIN'ini sorar (boş bırakılırsa üretilir); iki adımlı
doğrulama sırrını üretip **QR olarak BİR KEZ** basar.

- ⚠️ **Çıktı bir daha gösterilmez.** PIN + TOTP sırrı **parola yöneticisine**
  kaydedilir, **fabrikaya VERİLMEZ**. Hiçbir dosyaya, log'a ya da audit kaydına
  yazılmaz (audit'e yalnız "kuruldu / yenilendi" izi düşer).
- ⚠️ **Var olan bir kullanıcı YÜKSELTİLEMEZ** — script mevcut bir kullanıcı adı
  verilirse hata verir. Gizli hesap görünür bir hesaptan türetilemez: o
  kullanıcının geçmişi, oturumları ve audit satırları maskeli hesaba taşınamaz.
- ⚠️ **İkinci koşum hiçbir şeyi değiştirmez** ("zaten kurulu"). Parola/PIN
  yenilemenin tek yolu `--rotate`'tır ve o **açık oturumları düşürür**.
- ⚠️ **Hesap kurulmazsa** modül anahtarları bugünkü gibi `admin:settings` ile
  yazılmaya devam eder (emniyet supabı — kimse kilitlenmez). Hesap doğduğu AN
  kilit mutlaktır ve **restart GEREKMEZ** (kilit defteri ilk istekte tazelenir).
- ⚠️ `kur.ps1` mevcut `.env`i olduğu gibi taşır; bu adım **`.env`e bağlı
  olmadığı için** güncellemelerde kaybolmaz — ama yeni kurulumda **atlanırsa
  hesap hiç doğmaz** ve kimse fark etmez.

Ayrıntı + uzaktan erişim bağlamı: [`UZAK-ERISIM-KURULUM.md`](./UZAK-ERISIM-KURULUM.md) §5.

7. DB-level (migration ile DEĞİL, manuel, önerilir):
   ```
   ALTER DATABASE <db> SET statement_timeout = '50s';
   ```
   (+ `idle_in_transaction_session_timeout=5min`, `log_min_duration_statement=500ms` — `ARCHITECTURE.md`).

### A4. Seed (yalnızca İLK kurulumda) — DEMO içerir
8. `npm run seed` (= `npx prisma db seed`).
    - **Tek `main()`, `create` ile yazar → ikinci kez çalıştırılamaz** (unique hatası). Güncellemelerde ASLA.
    - **Bootstrap (prod-temel, gerekli):** 86 permission, 29 permission template (⚠️ 2026-09-03 ölçümü — **sayıyı sabitleme**: kanonik sayı `src/constants/permission-catalog.ts` + `role-template-catalog.ts`'tedir, seed listeyi taşımaz, boot uzlaştırması getirir), 1 kullanıcı (yalnız admin/123123), 3 kalite sınıfı (1.KALITE/A1/FIRE), 6 iade nedeni, 3 hata tipi, sistem varsayılan etiket medyası (`label.defaultMedia` = 100×58, 203dpi — ayrı "format profili" kataloğu YOK), 3 label template default (ROLL_RAW/ROLL_FINISHED/SWATCH).
    - **AYNI ZAMANDA DEMO master-data (NODE_ENV guard'ı YOK):** 4 müşteri, 6 renk, 7 özellik, 3 fason kategori (BOYA/ZIMPARA/KARTELA) + 3 fason firma, 6 istasyon, 3 makine, peripheral'lar (ağ yazıcıları + metre/kantar), 3 rota, Patos ürünü, alias'lar, 3 şube.
    - **Temiz fabrika kararı:** Seed pratikte zorunlu (bootstrap olmadan sistem açılmaz). İki seçenek:
      - (a) Seed çalıştır → demo satırlarını Tanımlar UI'sından veya SQL ile **elle sil**, gerçeklerini gir.
      - (b) Tam temiz: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → `migrate deploy` → `seed` → demo temizle.
    - **Seed'i tamamen atlama önerilmez** — izin/kalite/etiket template gelmez, sistem açılmaz.

> **A4b. İlk açılışta modül anahtarları (profil).** `pm2 start` sonrası açılıştan ~3 sn
> sonra `pm2 logs tekserp-backend` çıktısında `[module-profile]` satırını doğrula:
> - `"<profil>" profili uygulandı — N satır yazıldı` → taze kurulum, anahtarlar yazıldı.
> - `Modül anahtarlarının 7/7 satırı zaten var — dokunulmadı` → yükseltilen kurulum (beklenen).
> - `TEKSERP_PROFIL tanımlı değil — modül anahtarları YAZILMADI` → `.env`de profil yok;
>   taze kurulumda bu genelde bir UNUTMADIR (satırı ekle, pm2 restart et — satır
>   olmadığı için job ikinci açılışta yazar).
> - `JOB_FAILED:module-profile` → profil adı yanlış yazılmış; hiçbir satır yazılmadı.
>
> ⚠️ İlk birkaç saniyede (job koşmadan önce) ticaret/iplik uçları 403 dönebilir —
> modül kapıları cache'siz okur ve satır henüz yoktur. Kendiliğinden geçer.

### A5. Derle + pm2 ile çalıştır (tek-process)
9. `npm run build` (= `tsc` → `dist/`). `package.json`'da `start`/`prod` script'i **YOK**; süreci pm2 yönetir.
10. `pm2 start ecosystem.config.js` → `pm2 status` ile `online` teyit et, `pm2 logs tekserp-backend` ile açılış bannerını gör.
    - **TEK-PROCESS invariant:** PM2 **cluster** / `cluster` modülü / 2. replica EKLEME — presence sayımı + feature-flag cache + archive-scheduler + backup-scheduler sessizce bozulur (çift arşiv, çift gece yedeği). `ecosystem.config.js` `exec_mode: "fork"` + `instances: 1` ile gelir; **değiştirme**.
    - **Log rotasyonu pm2'de otomatik DEĞİL:** `pm2 install pm2-logrotate` + `max_size 10M` / `retain 14`. Kurulmazsa log dosyası sınırsız büyür (NSSM bunu kendisi yapıyordu).
11. **Reboot kalıcılığı:** `pm2 save` (her deploy sonrası tekrar). `pm2 startup` **Windows'u desteklemez** — listeyi geri yükleyecek ayrı bir tetikleyici (pm2-installer / Görev Zamanlayıcı `pm2 resurrect`) gerekir. Bu sunucuda çalışan mekanizmanın tespiti: `DEPLOY-RUNBOOK.md §7`.

### A6. Sağlık doğrulama
12. `curl -s http://localhost:4000/health` → **200 + `db:"UP"`**. Endpoint **`GET /health`**, `/api/health` DEĞİL. Yanıttaki **`lastBackup` null ise yedekleme yapılandırması bozuktur** (A2).

---

## B. İlk Admin + Temel Sistem Ayarları

13. **İlk giriş:** `admin` / `123123` (tam yetki). Uygulamaya giriş için en az 1 izin şart (`canEnterApp`).
14. **Admin şifresini değiştir** — demo değer, prod'da değiştirilmeli. (Kesin menü yolu: doğrulamak gerek.)
15. **Firma adı:** Genel Ayarlar → "Şirket Bilgileri" → `company.name`.
16. **Künye + belge içeriği:** Tanımlar → Sistem → Belge Şablonları (irsaliye + refakat kartı bölüm aç-kapa, başlık/künye/imza, canlı önizleme).
17. **Etiket dili = PPLA (cihaz bazlı):** Global "etiket yazıcı dili" ayarı **YOK** — dil her yazıcıda ayrı (`PeripheralDevice.languageOverride`, Tanımlar → Cihazlar / ADIM 8). Seed'lenen tüm yazıcılar PPLA geldiğinden ekstra gerekmez; farklı firmware'de (Zebra=ZPL) cihaz kaydından değiştir.
18. **Kopya adedi + varsayılan etiket medyası:** Genel Ayarlar → Etiket (aynı ekranda: etiket kopya adedi, varsayılan medya, "Doğrudan yazıcıya gönder (native)" toggle).
19. **"Doğrudan yazıcıya gönder (native)"** toggle'ı default KAPALI (backend TCP gönderim; diyalogsuz seri/BT baskı için D/E'ye bak — bu toggle'dan bağımsız).

---

## C. Master-Data Girişi (DOĞRU SIRAYLA — FK bağımlılıkları)

**Seed'in zaten kurdukları (tekrar GİRME):** 55 izin, 15 izin template, admin kullanıcısı, 3 kalite sınıfı (UI'da salt-okunur), 6 iade nedeni, 3 hata tipi, sistem varsayılan etiket medyası (`label.defaultMedia`), 3 label template default.

> **C-uyarı (DEMO seed):** Seed "MASTER DEMO" bölümü gerçek fabrikaya ait OLMAYAN sahte müşteri/renk/özellik/istasyon/makine/rota/Patos/alias/şube üretir; bootstrap ile aynı `main()` içinde, ayrım yok. **Gerçek fabrikada bu demo satırları silinmeli.** Kalite sınıfları hariç (salt-okunur sistem sabiti).

20. **ADIM 1 — Kullanıcı yetkileri.** admin ile gir; operatörlere `/admin/users/:id/permissions` üzerinden izin ata (template'lerden toplu). İzinsiz operatör hiçbir akışı yürütemez.
21. **ADIM 2 — Bağımsız leaf kataloglar (FK yok, paralel):** Renkler · Kumaş Özellikleri (KURSUN/ZIMPARALI dahil) · Hata Tipleri (en az GENEL) · İade Nedenleri · Müşteriler · Fason Kategorileri. (Ayrı "Etiket Format Profili" kataloğu YOK — medya/dil doğrudan cihaz kaydında, ADIM 8.)
22. **ADIM 3 — Ürünler (Item).** Bağımlılık: renk + özellik. **`Roll.itemId` NOT NULL → en az 1 FABRIC Item zorunlu.** İzinli renk/özellik boş = "tüm aktif serbest".
23. **ADIM 4 — (KALDIRILDI, 2026-07).** Yazıcı modeli / format profili kataloğu yok — yazıcı dili (`languageOverride`) ve medyası (`labelWidthMm` vd.) doğrudan Cihaz Kaydı'nda (ADIM 8) girilir.
24. **ADIM 5 — Fason Firmalar (Subcontractor).** Bağımlılık: SubcontractorCategory önce.
25. **ADIM 6 — İstasyonlar (Station).** Zorunlu kind'ler (`StationKind` enum): **RAW_QC=KK1** (giriş, adım picker'ında çıkmaz), **PROCESS_QC=Kurşun+KK2**, **TAMBUR**, **SUBCONTRACTOR=fason** (bu istasyonlar StationType `EXTERNAL` + `defaultCategoryId` → kategori), **SHIPPING=Sevkiyat/Paketleme** (makinesiz). (`OTHER` = diğer/özel, seed kullanmaz.)
    - ⚠️ Profil gerçeği — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §5.1: **"Kurşun + KK2 = tek istasyon" bu fabrikanın topolojisidir, sistemin kuralı değil.** Kimi fabrika kaliteyi kurşunla birlikte yapar (buradaki `PROCESS_QC` çifti), kimi ayrı istasyonda, kimi başka istasyonla birlikte. ⚠️ 2026-09-03: kalite artık bir **istasyon yeteneğidir** (`Station.appliesQuality`, P4 Faz A indi — ikiz boğaz `stepCanApplyQuality` + `QUALITY_STATION_WHERE`); Faz B bitince bu adım "fabrikanın istasyonlarını gir" cümlesine iner.
26. **ADIM 7 — Makineler (Machine).** Bağımlılık: `stationId`. Her istasyona makine.
27. **ADIM 8 — Cihaz Kaydı (PeripheralDevice).** Bağımlılık: **machineId** (üretim makinesine bağlı yazıcı/metre) **VEYA stationId** (makinesiz SHIPPING istasyonuna bağlı kantar). Ayrı `formatProfileId` **YOK** — medya (`labelWidthMm` vd.) ve dil doğrudan cihazda. Yazıcıda **dil (`languageOverride`) ZORUNLU**. KK1/KK2/Tambur → yazıcı (machineId); Sevkiyat → SCALE (stationId). (Detay = F.)
28. **ADIM 9 — İstasyon Yetenekleri (StationColor + StationProperty).** Fason boyahane hangi renk/özelliği uygular; Kurşun=KURSUN, Zımpara=ZIMPARALI.
    - ⚠️ **2026-08-02 düzeltmesi — renk artık istasyon kısıtı DEĞİL.** Boyahane fiziksel olarak her rengi boyar; rota adımının renk seçicisi tüm aktif renk kataloğunu gösterir ve yeni tanımlanan renk hiçbir yere işaretlenmeden anında kullanılabilir. `StationColor` satırları geriye dönük uyum için duruyor ama **hiçbir yer onu filtre olarak kullanmaz** (`src/services/station-capability.service.ts`; renk kilidi `requiredCategory.appliesColor` ile çözülür — `src/services/helpers/workorder-locks.helper.ts`). Bu adımda girilecek olan **yalnız `StationProperty`**'dir (gerçek proses kısıtı + "buradan geçen top bunu otomatik kazanır"): Kurşun=KURSUN, Zımpara=ZIMPARALI. Sahada tam bu yüzden 58 aktif renkten 8'i rota adımında görünmüyordu.
29. **ADIM 10 — Üretim Rotaları (Route + RouteStep).** Bağımlılık: `RouteStep.stationId` ZORUNLU. Tipik: Boya → Kurşun+KK2 → Tambur. Akış adımları rotadan türer.
30. **ADIM 11 — İş Emri Şablonları (ProductRecipe) — OPSİYONEL.**
31. **ADIM 12 — Müşteri Şubeleri (CustomerBranch) — çok-şubelide.** Müşteri sayfası altında alt-kaynak (ayrı kart yok). `Order.branchId` opsiyonel.
32. **ADIM 13 — Alias'lar (OPSİYONEL).** CustomerItemAlias + CustomerColorAlias — müşteri bağlamında.
33. **ADIM 14 — Etiket Standartları (LabelTemplate).** Seed her LabelKind için 1 default kurdu (silinmesin). Görünüm buradan düzenlenir.

> **FK sırası:** Item←Color+Property · Route←Station · EXTERNAL Station←Category · PeripheralDevice←Machine **veya** Station.

---

## D. Electron PC Kurulumu (her sevkiyat PC'si)

34. **Bağımlılıklar + native rebuild:**
    ```
    npm install
    npm run electron:rebuild     # = electron-rebuild -f -w serialport,node-hid
    ```
    - **electron:rebuild ZORUNLU** her COM cihazlı (etiket yazıcısı / kantar / seri-HID tarayıcı) PC'de. Atlanırsa COM cihaz **sessizce devre dışı** (çökme yok). Electron yükseltme + `npm install` sonrası tekrar.
35. **Installer üret:** `npm run build:win` → NSIS → `release/<version>/...Setup.exe`. **Windows'ta üretilmeli** — `serialport`/`node-hid` native modülleri macOS/Linux'tan çapraz derlenemez (`node-gyp does not support cross-compiling`), yapılandırma doğru olsa bile orada durur.
    - ⚠️ **Ham `npm run build:win` KULLANMA** (2026-08-26'dan beri; çok müşteride kritik). Yayın adresi pakete **derleme anında** gömülür — `package.json`da hangi müşteri yazılıysa onunla derler ve yanlış müşteri kodu taşıyan paket **başka bir fabrikanın güncellemesini indirip kurar**; hata SESSİZDİR (dosyalar kendi aralarında tutarlı kalır). Doğru komut: `./deploy/electron-paketle.sh <müşteri>` — müşteri kodunu `shared/musteri.json` ve `package.json > build.publish` içine birlikte yazar, derler ve derlemeden SONRA paketin içindeki gömülü adresi argümanla kıyaslayarak kapı kurar. Ayrıntı: `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`.
    - **Eski "NSIS sidebar tuzağı" uyarısı KALDIRILDI** — `build.nsis` içinde `installerSidebar` anahtarı yok, electron-builder'da o alan zaten opsiyonel. Uyarı doğrulanmamış bir tahmindi.
    - **GERÇEK TUZAK (2026-07-31, doğrulandı):** `build.nsis` (ve genel olarak `build`) bloğuna **tanınmayan anahtar eklenemez** — electron-builder şemayı katı doğrular ve derleme daha başlamadan `Invalid configuration object … has an unknown property` ile düşer. Yani **`package.json`'a yorum amaçlı `_note` alanı koymayın**; gerekçeyi bu dokümana yazın. (Bir kez `_perMachine_note` eklendi ve `build:win`'i tamamen kırdı — kırık hâli `72e79fb` ile origin/main'e de gitmişti.)
    - **`perMachine: true` bilinçli:** kurulum `Program Files`'a gider ve PC'deki **tüm Windows hesaplarına** görünür. Per-user (`false`) olsaydı yalnız kurulumu yapan hesap görürdü — admin hesabıyla kurup operatör başka hesapla girince uygulama ortada olmazdı. Bedeli: kurulum UAC ister (elden kurulumda sorun değil) ve ileride `electron-updater` eklenirse her güncelleme de UAC ister. Değiştirmek her PC'de kaldır+yeniden kur demektir.
36. **Kur, aç.** İlk açılışta API adresi default `localhost:4000` — düzeltmelisin.
37. **API adresini gir:** Login → sağ-üst **dişli** → **ApiEndpointDialog** → `http://192.168.1.250:4000` (**`/api` SUFFIX'i YAZILMAZ**) → "Bağlantıyı Test Et" (GET /health) → "Kaydet". Secure-store'a yazılır, **restart gerekmez**, makineye özeldir.
    - **Adres tek kaynak:** `DEPLOY-RUNBOOK.md` → "SAHADAKİ KURULUM — yetkili değerler" (SAHINSRV **192.168.1.250**). Bu dokümandaki örnekler oradan kopyalanır; çelişki görürsen runbook geçerlidir. (2026-08-01'e kadar burada bayat bir `192.168.1.50` yazıyordu ve bir APK ölü adrese gömülü derlendi.)
38. **Diyalogsuz etiket yazıcısı:** Electron → Genel Ayarlar → Cihazlar → "Diyalogsuz seri/COM baskı (Argox)" → **"Portları Tara"** → COM seç → Baud (9600) → **"Bağlantıyı Test Et"** (zararsız CR). serialport eksikse → ADIM 34. Yerel/per-PC tercih (`prefs.labelPrinter`). BT modüllü Argox = sanal COM; USB de COM.

---

## E. Android Tablet Kurulumu (her istasyon)

39. **Bağımlılıklar:** `npm install`. **`overrides` korunmalı** (`expo-font: ~14.0.11` pinli — bozulursa release APK çöker).
40. **NATIVE BUILD ZORUNLU** (BLE Expo Go'da çalışmaz):
    - Test: `npx expo run:android`
    - **Release: `EXPO_PUBLIC_API_URL=http://192.168.1.250:4000/api npm run build:apk`** (mobil/ içinde) → `android/app/build/outputs/apk/release/app-release.apk`
    - **`./gradlew assembleRelease` ELLE ÇAĞIRMA.** Script adresi doğrular, bundle önbelleklerini siler, derler ve **üretilen APK'nın içindeki gömülü adresi tekrar okuyup** doğrular; düşerse exit 1 + paketi `app-release.DOGRULANMADI.apk` adına taşır. Ayrıntı: `mobil/CLAUDE.md` → "APK derleme".
41. **API_URL** (mobilde **`/api` SUFFIX'i DAHİL**):
    - Build-time: `EXPO_PUBLIC_API_URL` (yukarıdaki komut). Yetkili değer `DEPLOY-RUNBOOK.md` → "SAHADAKİ KURULUM" (**192.168.1.250**).
    - Runtime: uygulama içi SettingsScreen → özel URL (restart gerekmez) — ama **yalnız o tek cihazı** düzeltir.
    - **TUZAK:** Release APK build-time IP'yi gömer; her saha farklı IP. `.env.local` **USB geliştirme içindir** (`localhost` + `adb reverse`) ve sahaya giden pakette anlamsızdır — `build:apk` localhost'u reddeder. İki büyük sessiz tuzak (bayat adres + bayat bundle) ve bekçileri: `mobil/CLAUDE.md` → "APK derleme". Tablet ↔ sunucu aynı LAN.
42. **İzinler (runtime):** CAMERA, BLUETOOTH/ADMIN/CONNECT/SCAN, **ACCESS_FINE_LOCATION + COARSE** (BLE taraması için ZORUNLU). Konum reddedilirse BT cihaz bağlanmaz.
43. **Cihaz onay / allowlist + makineye atama** (PairingCode KALDIRILDI):
    1. Tablet boot'ta UUID üretir + otomatik `POST /api/devices/announce` → backend Device tablosuna **status=PENDING** upsert. Elle Device girmek gerekmez.
    2. Admin Electron → **Cihazlar sayfası** → tablet "Onay bekliyor".
    3. **"Onayla & Ata"** → makine seç (boş = atamasız) → status=APPROVED + machineId (**admin:settings izni**).
    4. Tablet `/api/devices/status` poll'lar; APPROVED olunca devam. `devicePairingRequired` default **KAPALI** → tablet beklemeden login olur (ama makine atfı NULL → raporda makine kırılımı yok; iz isteniyorsa flag aç/ata).
    - **Eşleştirme aç/kapa:** Electron Genel Ayarlar → Cihazlar → `DevicePairingSection` yalnız `devicePairingRequired` bayrağını aç/kapar (eski "6 haneli kod" akışı KALKTI, artık o metin yok). Fiili onay/atama **Cihazlar sayfasından** "Onayla"/"Onayla & Ata" ile yapılır.
44. **BT yazıcı seçimi (tablet):** Mobil → Genel Ayarlar → "Etiket Yazıcısı (Bluetooth)" → **ÖNCE Android BT ayarlarından Argox'u pair et** → "Yazıcıları Tara" → seç → Test. Seçim yoksa HTML/expo-print fallback. Dil global PPLA'dan.

---

## F. Donanım

### F1. Yazıcı (Argox OS-214 PPLA)
45. **Zorunlu minimum:** Seed sistem varsayılan etiket medyasını (`label.defaultMedia`) + istasyon yazıcılarını (dil=PPLA cihaz üstünde) kurar. Global dil ayarı YOK — dil yalnız cihaz kaydından; cihaz eşleşmeyen istek native üretmez (HTML'e düşer, istemci "cihaz seçin" der).
46. **Opsiyonel:** per-cihaz medya (`labelWidthMm` vd.), per-PC COM (D38), per-tablet BT (E44), native TCP (`nativeSendEnabled`).
47. **⚠️ YANLIŞ dil:** Dil YALNIZ cihaz kaydında ve yazıcıda ZORUNLU (global varsayılan kaldırıldı). Fiziksel yazıcının gerçekten konuştuğu dili seç (Argox=PPLA/PPLB firmware'ine göre); yanlış dil = boş/bozuk etiket. Native basan her Electron PC'de Genel Ayarlar → Bu Bilgisayar'dan cihaz seçilmeli.
48. **Sahiplik tam-biri:** PeripheralDevice ya machineId YA deviceId taşır (ikisi/hiçbiri → yönlendirme bozulur). Ağ yazıcı=makine, BT yazıcı=tablet.
49. **Marka/protokol değişimi = sıfır kod:** Argox→Zebra → cihazın languageOverride'ını değiştir; yeni boyut → cihazın medyası (`labelWidthMm`/`labelHeightMm`/`labelDpi`/`labelGapMm`). 4 dil hazır (`PrinterLanguage` enum: PPLA/PPLB/ZPL/RASTER_HTML).

### F2. Kantar / Metre — simulate ile başla, gerçeğe geç
50. **Seed = METRE'ler SİMÜLE, KANTAR GERÇEK.** `METER` cihazları `simulate=true` doğar (sahte okur); **`SCALE` (SEVK-KANTAR) `simulate=false`** doğar. Ayrım bilinçli: metre değeri İÇ üretim verisidir ve yeniden ölçülebilir, **kantar kg'si sevk irsaliyesine ve çeki listesine BASILIR** (müşteri/gümrük belgesi). Ayrıca backend ENFORCE eder: `shipping.simulatedWeightEnabled` kapalıyken (varsayılan) simüle kantardan gelen tartı **400** ile reddedilir — elle giriş (⋮ → "Elle kg gir") muaftır. Demo/eğitim kurulumunda hem cihazın `simulate`'ini hem bayrağı açın. Seed MAC'leri örnektir.
51. **Gerçeğe geçiş:** Admin → Tanımlar → "Cihaz Kaydı" → cihazın `simulate`'ini KAPAT + gerçek `address` + port + protokol (pollCommand/terminator/decimals/scale/unit/role).
52. **simulate dallandırır:** mobil `if (simulate) return sim()`. simulate=false sonrası cihaz gerçekten bağlı olmalı; yoksa **NET HATA** (sessiz sahte yok).
53. **BT metre/kantar:** Expo Go'da çalışmaz; önce bonded edilmeli.
54. **İki diyalogsuz baskı katmanı karışmasın:** (a) backend native TCP 9100 = `nativeSendEnabled` (kapalı, makineye IP gerekli); (b) Electron per-PC seri/COM = `prefs.labelPrinter` (yerel, PPLA şart).

---

## G. Doğrulama (Uçtan Uca Smoke Test)

55. **/health:** 200 + `db:"UP"`.
56. **Electron giriş:** Sevkiyat PC'sinde admin ile gir; API adresi doğru.
57. **Tablet giriş:** Operatör login; Cihazlar'da APPROVED + makineye atanmış.
58. **Stok topu → Hızlı İş Emri:** Tabletten okut → WO başlat.
59. **KK1:** RAW_QC'de topu okut, giriş (en az 1 FABRIC Item + kalite mevcut).
60. **Akış:** [Fason Sevk/Kabul] → Kurşun+KK2 → Tambur (metre: simulate/gerçek) → Depo.
61. **Etiket DİYALOGSUZ:** OS yazdırma ekranı ÇIKMADAN çıkıyor mu? Electron per-PC COM (D38) veya tablette BT (E44). Çıkmıyorsa: profil / cihazın dili (F47) + diyalogsuz seçim kontrol.
62. **Çuval/Sevkiyat:** SCALE ile çuval tart → depodan çuval + sipariş seç → sevk (varsayılan doğrudan DISPATCHED; onay ayarı açıksa PLANNED→DISPATCHED). Stok yalnız DISPATCH'te SHIPPED.

---

## ⚠️ KRİTİK TUZAKLAR

- **Migration/generate sırası:** `install → prisma:generate → build → migrate deploy → (ilk) seed → pm2 start ecosystem.config.js`. `prisma generate` atlanırsa derlenmez; `migrate` atlanırsa P2022. **`migrate dev` prod'da ASLA** (reset). **`build` neden `migrate`'ten ÖNCE:** `migrate deploy` GERİ ALINAMAZ (rollback = yedekten restore), `build` ise DB'ye dokunmaz ve tsc hatasıyla patlaması normaldir — ters sırada "DB göç etti ama deploy edilebilir kod yok" çıkmazı doğar. Kanonik sıra: `Teks-Erp/MIGRATION-DEPLOY.md` (2026-07-30'da üç doküman arasındaki çelişki bu yönde giderildi).
- **electron:rebuild:** COM cihazlı her PC'de ZORUNLU; atlanırsa cihaz **sessizce** devre dışı. Electron yükseltme + `npm install` sonrası tekrar.
- **Yazıcı dili:** Cihaz Kaydı'nda dil ZORUNLU — fiziksel yazıcının firmware diliyle (PPLA/PPLB/ZPL) eşleşmeli. En sık hata: yanlış dil seçmek.
- **DEMO seed:** bootstrap + demo birlikte yazılır (guard yok). Gerçek fabrikada demo satırlarını temizle. Tam reset = `DROP SCHEMA public CASCADE` → migrate → seed. **Eskiden installer `.seeded` bayrağıyla ikinci seed'i otomatik engelliyordu; pm2 yolunda bu koruma YOK** — güncellemede `npm run seed` çalıştırmamak operatör disiplinine bağlı.
- **JWT_SECRET <32:** Backend açılmaz; rastgele ≥32 üret.
- **TEK-PROCESS:** cluster/2. replica EKLEME — presence + cache + scheduler bozulur. Fork modu.
- **/health (alias yok):** `GET /health`.
- **`.env` yedekle:** Tek sır kaynağı (`DATABASE_URL` + `JWT_SECRET`); kaybolursa DB'ye bağlanılamaz ve geri yükleme yapılamaz. Eski `secret.json` **kaldırıldı**. DB `127.0.0.1` dinler (installer **5433** kullanıyordu — sunucudaki gerçek portu `.env`'den teyit et).
- **`BACKUP_DIR` (pm2):** Tanımsızsa gece yedeği sessizce çalışmaz. Panel → Sistem → Yedekler bunu kırmızı kutuyla bildirir; `/health` → `lastBackup` null olur.
- **simulate→false:** Fiziksel donanım gerçekten bağlı olmalı; yoksa NET HATA.
- **Cihaz eşleştirme akışı:** announce→PENDING→(Cihazlar sayfası) Onayla&Ata→APPROVED. PairingCode / 6-haneli kod akışı KALDIRILDI; `DevicePairingSection` yalnız `devicePairingRequired` zorunluluk bayrağını aç/kapar.

**Doğrulanması gereken (kodda kesin kanıt yok):** (1) admin şifre değiştirme ekranının kesin menü yolu; (2) `build:win` NSIS sidebar tuzağının saha build'inde gerçekten patlatıp patlatmadığı — kurulum öncesi bir kez build:win denenmeli.
