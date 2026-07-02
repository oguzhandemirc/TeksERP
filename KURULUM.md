# TeksERP — Fabrika Sıfırdan Temiz Kurulum RUNBOOK'u

> Saha: tek sunucu (Xeon), sevkiyatta Electron PC'ler, istasyonlarda Android tabletler, tüm yazıcılar Argox OS-214 PPLA (BT modüllü), kantar/metre cihazları. Bu runbook yalnızca koda dayalı doğrulanmış bulguları içerir. "Doğrulamak gerek" notları, kodda kesin kanıt bulunmayan yerlerdir.

---

## A. SUNUCU (Backend + PostgreSQL)

İki yol var: **Windows installer (fabrika için ÖNERİLEN)** veya **Linux/manuel**.

### A0. Ön koşullar (her iki yol)
1. **Node.js 22.x** (CI 22.19; installer'a gömülü 22.13.1) ve **PostgreSQL 16.x** (gömülü 16.6) kur. `package.json`'da `engines` yok — sürüm operasyonel gerekliliktir.
2. Boş bir PostgreSQL veritabanı + login rolü oluştur. **Rol CREATEDB yetkili olmalı** — Prisma 7 `migrate deploy` bağlanınca DB'yi oluşturmayı dener; yetki yoksa "permission denied to create database" ile patlar.

### A1. Windows installer yolu (ÖNERİLEN)
3. Build makinesinde `setup.exe` üret: `powershell -File installer\windows\build.ps1` (gömülü: Node 22.13.1, PostgreSQL 16.6-1, NSSM 2.24).
4. Saha sunucusunda: `.\manage.ps1 -Action install`. Bu tek komut otomatik yapar:
   - PostgreSQL'i **TeksErpDB** servisi yapar (**port 5433**, sadece `127.0.0.1`)
   - **TeksErpDb** DB + **tekserp** rolü (rastgele şifre)
   - `migrate deploy`
   - İLK kurulumsa (`.seeded` bayrağı yoksa) **seed** çalıştırır → **DİKKAT: demo veri de girer, bkz. A4/C-uyarı**
   - Backend'i **NSSM ile TeksErpBackend** servisi (port 4000, firewall açık)
   - `statement_timeout = 50s`
   - Gece 03:00 otomatik yedek görevi
   - Secret'lar `C:\ProgramData\TeksERP\secret.json`'da rastgele üretilir → **bu dosyayı yedekle; kaybolursa DB'ye bağlanılamaz**.
5. Yönetim: `.\manage.ps1 -Action status|start|stop|restart|backup|restore|studio`.
6. Güncelleme: aynı `setup.exe`'yi çalıştır → veri korunur, `migrate deploy` koşar, **seed atlanır** (`.seeded` var).

### A2. Linux/manuel yol — ENV hazırla (`Teks-Erp/.env`)
7. Üç değişkeni yaz (`example-env.txt` şablon):
   ```
   PORT=4000
   DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<db>?schema=public"
   JWT_SECRET="<en az 32 karakter rastgele>"
   ```
   - `DATABASE_URL` set değilse açılışta throw (`src/lib/prisma.ts`).
   - `JWT_SECRET` yok veya <32 karakter ise **backend AÇILMAZ** (`auth.service.ts`, modül-yükleme anında throw). `example-env.txt`'teki demo değeri prod'da kullanma — rastgele ≥32 hex üret.
   - `PORT` (default 4000) ve `HOST` (default `0.0.0.0` = tüm LAN) opsiyonel.

### A3. Şemayı kur (migration — Linux yolunda manuel)
8. Sırasıyla:
   ```
   npm ci
   npm run prisma:generate     # = npx prisma generate (her kurulum+güncellemede ZORUNLU)
   npm run prisma:migrate      # = npx prisma migrate deploy (boş DB'ye migration'lar, idempotent)
   ```
   - `migrate deploy` boş DB'de hatasız doğrulanmış (`MIGRATION-DEPLOY.md`).
   - **`migrate dev`'i ASLA prod'da çalıştırma** — reset riski. Sıfırdan kurulumda `migrate deploy` yeterli (reset etmez).
   - `migrate deploy` geri alınmaz; tek rollback = yedekten restore.
9. DB-level (migration ile DEĞİL, manuel, önerilir):
   ```
   ALTER DATABASE <db> SET statement_timeout = '50s';
   ```
   (+ `idle_in_transaction_session_timeout=5min`, `log_min_duration_statement=500ms` — `ARCHITECTURE.md`).

### A4. Seed (yalnızca İLK kurulumda) — DEMO içerir
10. `npm run seed` (= `npx prisma db seed`).
    - **Tek `main()`, `create` ile yazar → ikinci kez çalıştırılamaz** (unique hatası). Güncellemelerde ASLA.
    - **Bootstrap (prod-temel, gerekli):** 54 permission, 14 permission template, 1 kullanıcı (yalnız admin/123123), 3 kalite sınıfı (1.KALITE/A1/FIRE), 6 iade nedeni, 2 etiket format profili (ARGOX + DEFAULT), 3 label template default.
    - **AYNI ZAMANDA DEMO master-data (NODE_ENV guard'ı YOK):** 4 müşteri, 6 renk, 7 özellik, 3 fason kategori + 3 fason firma, 6 istasyon, 4 makine, peripheral'lar, 3 rota, Patos ürünü, alias'lar, 3 şube.
    - **Temiz fabrika kararı:** Seed pratikte zorunlu (bootstrap olmadan sistem açılmaz). İki seçenek:
      - (a) Seed çalıştır → demo satırlarını Tanımlar UI'sından veya SQL ile **elle sil**, gerçeklerini gir.
      - (b) Tam temiz: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → `migrate deploy` → `seed` → demo temizle.
    - **Seed'i tamamen atlama önerilmez** — izin/kalite/etiket template gelmez, sistem açılmaz.

### A5. Derle + çalıştır (tek-process)
11. ```
    npm run build              # = tsc -> dist/
    node dist/src/server.js    # tek-process prod
    ```
    - `package.json`'da `start`/`prod` script'i **YOK** — elle çalıştır.
    - **TEK-PROCESS invariant:** PM2 **cluster** / `cluster` modülü / 2. replica EKLEME — presence sayımı + feature-flag cache + archive-scheduler sessizce bozulur. systemd / pm2 **fork modu** / nohup ile sarmala (cluster DEĞİL).

### A6. Sağlık doğrulama
12. `curl -s http://localhost:4000/health` → **200 + `db:"UP"`**. Endpoint **`GET /health`**, `/api/health` DEĞİL.

---

## B. İlk Admin + Temel Sistem Ayarları

13. **İlk giriş:** `admin` / `123123` (tam yetki). Uygulamaya giriş için en az 1 izin şart (`canEnterApp`).
14. **Admin şifresini değiştir** — demo değer, prod'da değiştirilmeli. (Kesin menü yolu: doğrulamak gerek.)
15. **Firma adı:** Genel Ayarlar → "Şirket Bilgileri" → `company.name`.
16. **Künye + belge içeriği:** Tanımlar → Sistem → Belge Şablonları (irsaliye + refakat kartı bölüm aç-kapa, başlık/künye/imza, canlı önizleme).
17. **Etiket dili = PPLA:** Genel Ayarlar → Etiket → "Etiket yazıcı dili". **Default zaten PPLA** — ekstra gerekmez.
18. **Kopya adedi + top adı şablonu:** Aynı ekranda.
19. **"Doğrudan yazıcıya gönder (native)"** toggle'ı default KAPALI (backend TCP gönderim; diyalogsuz seri/BT baskı için D/E'ye bak — bu toggle'dan bağımsız).

---

## C. Master-Data Girişi (DOĞRU SIRAYLA — FK bağımlılıkları)

**Seed'in zaten kurdukları (tekrar GİRME):** 54 izin, 14 izin template, admin kullanıcısı, 3 kalite sınıfı (UI'da salt-okunur), 6 iade nedeni, DEFAULT + ARGOX format profili, 3 label template default.

> **C-uyarı (DEMO seed):** Seed "MASTER DEMO" bölümü gerçek fabrikaya ait OLMAYAN sahte müşteri/renk/özellik/istasyon/makine/rota/Patos/alias/şube üretir; bootstrap ile aynı `main()` içinde, ayrım yok. **Gerçek fabrikada bu demo satırları silinmeli.** Kalite sınıfları hariç (salt-okunur sistem sabiti).

20. **ADIM 1 — Kullanıcı yetkileri.** admin ile gir; operatörlere `/admin/users/:id/permissions` üzerinden izin ata (template'lerden toplu). İzinsiz operatör hiçbir akışı yürütemez.
21. **ADIM 2 — Bağımsız leaf kataloglar (FK yok, paralel):** Renkler · Kumaş Özellikleri (KURSUN/ZIMPARALI dahil) · Hata Tipleri (en az GENEL) · İade Nedenleri · Müşteriler · Fason Kategorileri · Etiket Format Profilleri.
22. **ADIM 3 — Ürünler (Item).** Bağımlılık: renk + özellik. **`Roll.itemId` NOT NULL → en az 1 FABRIC Item zorunlu.** İzinli renk/özellik boş = "tüm aktif serbest".
23. **ADIM 4 — (KALDIRILDI, 2026-07).** Yazıcı modeli kataloğu yok — yazıcı dili/profili doğrudan Cihaz Kaydı'nda (ADIM 8) seçilir.
24. **ADIM 5 — Fason Firmalar (Subcontractor).** Bağımlılık: SubcontractorCategory önce.
25. **ADIM 6 — İstasyonlar (Station).** Zorunlu kind'ler: **RAW_QC=KK1** (giriş, adım picker'ında çıkmaz), **PROCESS_QC=Kurşun+KK2**, **TAMBUR**, **SUBCONTRACTOR/EXTERNAL=fason**, **OTHER=Sevkiyat/Paketleme**. EXTERNAL `defaultCategoryId` → kategori.
26. **ADIM 7 — Makineler (Machine).** Bağımlılık: `stationId`. Her istasyona makine.
27. **ADIM 8 — Cihaz Kaydı (PeripheralDevice).** Bağımlılık: machineId (+ opsiyonel formatProfileId). Yazıcıda **dil (languageOverride) ZORUNLU**. KK1/KK2/Tambur → yazıcı; Sevkiyat → SCALE. (Detay = F.)
28. **ADIM 9 — İstasyon Yetenekleri (StationColor + StationProperty).** Fason boyahane hangi renk/özelliği uygular; Kurşun=KURSUN, Zımpara=ZIMPARALI.
29. **ADIM 10 — Üretim Rotaları (Route + RouteStep).** Bağımlılık: `RouteStep.stationId` ZORUNLU. Tipik: Boya → Kurşun+KK2 → Tambur. Akış adımları rotadan türer.
30. **ADIM 11 — İş Emri Şablonları (ProductRecipe) — OPSİYONEL.**
31. **ADIM 12 — Müşteri Şubeleri (CustomerBranch) — çok-şubelide.** Müşteri sayfası altında alt-kaynak (ayrı kart yok). `Order.branchId` opsiyonel.
32. **ADIM 13 — Alias'lar (OPSİYONEL).** CustomerItemAlias + CustomerColorAlias — müşteri bağlamında.
33. **ADIM 14 — Etiket Standartları (LabelTemplate).** Seed her LabelKind için 1 default kurdu (silinmesin). Görünüm buradan düzenlenir.

> **FK sırası:** Item←Color+Property · Route←Station · EXTERNAL Station←Category · PeripheralDevice←Machine(+FormatProfile).

---

## D. Electron PC Kurulumu (her sevkiyat PC'si)

34. **Bağımlılıklar + native rebuild:**
    ```
    npm install
    npm run electron:rebuild     # = electron-rebuild -f -w serialport,node-hid
    ```
    - **electron:rebuild ZORUNLU** her COM cihazlı (etiket yazıcısı / kantar / seri-HID tarayıcı) PC'de. Atlanırsa COM cihaz **sessizce devre dışı** (çökme yok). Electron yükseltme + `npm install` sonrası tekrar.
35. **Installer üret:** `npm run build:win` → NSIS → `release/<version>/...Setup.exe`. **TUZAK:** NSIS sidebar `build/installerSidebar.bmp`'ye işaret ediyor ama `build/` klasörü yok olabilir → build:win patlayabilir. Saha öncesi bir kez dene. (doğrulamak gerek)
36. **Kur, aç.** İlk açılışta API adresi default `localhost:4000` — düzeltmelisin.
37. **API adresini gir:** Login → sağ-üst **dişli** → **ApiEndpointDialog** → `http://192.168.1.50:4000` (**`/api` SUFFIX'i YAZILMAZ**) → "Bağlantıyı Test Et" (GET /health) → "Kaydet". Secure-store'a yazılır, **restart gerekmez**, makineye özeldir.
38. **Diyalogsuz etiket yazıcısı:** Electron → Genel Ayarlar → Cihazlar → "Diyalogsuz seri/COM baskı (Argox)" → **"Portları Tara"** → COM seç → Baud (9600) → **"Bağlantıyı Test Et"** (zararsız CR). serialport eksikse → ADIM 34. Yerel/per-PC tercih (`prefs.labelPrinter`). BT modüllü Argox = sanal COM; USB de COM.

---

## E. Android Tablet Kurulumu (her istasyon)

39. **Bağımlılıklar:** `npm install`. **`overrides` korunmalı** (`expo-font: ~14.0.11` pinli — bozulursa release APK çöker).
40. **NATIVE BUILD ZORUNLU** (BLE Expo Go'da çalışmaz):
    - Test: `npx expo run:android`
    - Release: `cd android && ./gradlew assembleRelease` → `android/app/build/outputs/apk/release/`
41. **API_URL** (mobilde **`/api` SUFFIX'i DAHİL**):
    - Build-time: `.env.local` → `EXPO_PUBLIC_API_URL=http://192.168.1.50:4000/api`
    - Runtime: uygulama içi SettingsScreen → özel URL (restart gerekmez).
    - **TUZAK:** Release APK build-time IP'yi gömer; her saha farklı IP → build öncesi `.env.local` değiştir veya operatör override etsin. Tablet ↔ sunucu aynı LAN.
42. **İzinler (runtime):** CAMERA, BLUETOOTH/ADMIN/CONNECT/SCAN, **ACCESS_FINE_LOCATION + COARSE** (BLE taraması için ZORUNLU). Konum reddedilirse BT cihaz bağlanmaz.
43. **Cihaz onay / allowlist + makineye atama** (PairingCode KALDIRILDI):
    1. Tablet boot'ta UUID üretir + otomatik `POST /api/devices/announce` → backend Device tablosuna **status=PENDING** upsert. Elle Device girmek gerekmez.
    2. Admin Electron → **Cihazlar sayfası** → tablet "Onay bekliyor".
    3. **"Onayla & Ata"** → makine seç (boş = atamasız) → status=APPROVED + machineId (**admin:settings izni**).
    4. Tablet `/api/devices/status` poll'lar; APPROVED olunca devam. `devicePairingRequired` default **KAPALI** → tablet beklemeden login olur (ama makine atfı NULL → raporda makine kırılımı yok; iz isteniyorsa flag aç/ata).
    - **STALE UI:** Electron `DevicePairingSection` hâlâ "6 haneli kod" diyor — **eski, kullanma**; Cihazlar sayfasını kullan.
44. **BT yazıcı seçimi (tablet):** Mobil → Genel Ayarlar → "Etiket Yazıcısı (Bluetooth)" → **ÖNCE Android BT ayarlarından Argox'u pair et** → "Yazıcıları Tara" → seç → Test. Seçim yoksa HTML/expo-print fallback. Dil global PPLA'dan.

---

## F. Donanım

### F1. Yazıcı (Argox OS-214 PPLA)
45. **Zorunlu minimum:** Seed ARGOX/DEFAULT profilleri + istasyon yazıcılarını (dil=PPLA cihaz üstünde) kurar. Global dil ayarı YOK — dil yalnız cihaz kaydından; cihaz eşleşmeyen istek native üretmez (HTML'e düşer, istemci "cihaz seçin" der).
46. **Opsiyonel:** ek format profili, per-PC COM (D38), per-tablet BT (E44), native TCP (`nativeSendEnabled`).
47. **⚠️ YANLIŞ dil:** Dil YALNIZ cihaz kaydında ve yazıcıda ZORUNLU (global varsayılan kaldırıldı). Fiziksel yazıcının gerçekten konuştuğu dili seç (Argox=PPLA/PPLB firmware'ine göre); yanlış dil = boş/bozuk etiket. Native basan her Electron PC'de Genel Ayarlar → Bu Bilgisayar'dan cihaz seçilmeli.
48. **Sahiplik tam-biri:** PeripheralDevice ya machineId YA deviceId taşır (ikisi/hiçbiri → yönlendirme bozulur). Ağ yazıcı=makine, BT yazıcı=tablet.
49. **Marka/protokol değişimi = sıfır kod:** Argox→Zebra → cihazın languageOverride'ını değiştir; yeni boyut → format profili. 4 dil hazır (PPLA/PPLB/ZPL/RASTER_HTML).

### F2. Kantar / Metre — simulate ile başla, gerçeğe geç
50. **Seed = SİMÜLE BAŞLAR:** Tüm METER/SCALE cihazları `simulate=true` (sahte okur). Seed MAC'leri örnektir.
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
62. **Çuval/Sevkiyat:** SCALE ile çuval tart → PREPARING→READY→AT_DOOR→DISPATCHED. Stok yalnız DISPATCH'te SHIPPED.

---

## ⚠️ KRİTİK TUZAKLAR

- **Migration/generate sırası:** `install → prisma:generate → migrate deploy → (ilk) seed → build → node dist/src/server.js`. `prisma generate` atlanırsa derlenmez; `migrate` atlanırsa P2022. **`migrate dev` prod'da ASLA** (reset).
- **electron:rebuild:** COM cihazlı her PC'de ZORUNLU; atlanırsa cihaz **sessizce** devre dışı. Electron yükseltme + `npm install` sonrası tekrar.
- **Yazıcı dili:** Cihaz Kaydı'nda dil ZORUNLU — fiziksel yazıcının firmware diliyle (PPLA/PPLB/ZPL) eşleşmeli. En sık hata: yanlış dil seçmek.
- **DEMO seed:** bootstrap + demo birlikte yazılır (guard yok); installer ilk kurulumda da. Gerçek fabrikada demo satırlarını temizle. Tam reset = `DROP SCHEMA public CASCADE` → migrate → seed.
- **JWT_SECRET <32:** Backend açılmaz; rastgele ≥32 üret.
- **TEK-PROCESS:** cluster/2. replica EKLEME — presence + cache + scheduler bozulur. Fork modu.
- **/health (alias yok):** `GET /health`.
- **secret.json (Windows):** `C:\ProgramData\TeksERP\secret.json` yedekle; kaybolursa DB'ye bağlanılamaz. DB portu **5433**, 127.0.0.1.
- **simulate→false:** Fiziksel donanım gerçekten bağlı olmalı; yoksa NET HATA.
- **STALE UI:** `DevicePairingSection` "6 haneli kod" eski; gerçek akış = announce→PENDING→Onayla&Ata→APPROVED.

**Doğrulanması gereken (kodda kesin kanıt yok):** (1) admin şifre değiştirme ekranının kesin menü yolu; (2) `build:win` NSIS sidebar tuzağının saha build'inde gerçekten patlatıp patlatmadığı — kurulum öncesi bir kez build:win denenmeli.
