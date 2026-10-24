# İzlenebilirlik (yazdırma geçmişi + audit günlük dil) ve cihaz eşleme v2: dilimli plan

**Durum: TASLAK 2026-10-24** · Yazan: plan yazarı ajanı · Girdiler: `scratchpad/izlenebilirlik/{KARARLAR,I-R1}.md`, `scratchpad/cihaz/{KARARLAR,C-R1}.md` · Ana dal `main` @ `6e1962f60`.

> Kod YAZILMADI. Bu belge dilimlerin sözleşmesidir; her dilimin ajan istemi `scratchpad/izlenebilirlik/istemler/<KOD>.md`dedir, oradaki sözleşme buradakinin kopyasıdır (çelişirse BURASI kazanır; BURASI iki `KARARLAR.md` ile çelişirse KARAR kazanır).

## 0 · İstekler ve kapsam

Kullanıcının üç isteği (aynen):

1. "yazıcıdan kimin ne çıkardığını görmek , varsa hata bunları görmek istiyorum. yazıcı hareketleri tablosu olabilir. sen karar ver çözümü. web ve electron gibi arayüzlerden de erişilebilir olmalı."
2. "audit gibi sistemdeki hareket kayıtlarında kimin ne yaptığını anlamak çok zor, teknik diye bir açılır yer var fakat orada da kim hangi enpointe ne atmış, db ye ne yazmış ayrıca bunların günlük dildeki karışlılığı ne gibi şeyleri anlayabilmemiz lazım."
3. "erp deki cihaz eşlemesi güncellemelerden sonra tekrar düşebiliyor bunu sıfırdna yeni bir mimariyle yapabiliriz. eşleşen cihazın donanımından veya başka bir değişmmeyen koduyla kayıt edilebilir birkez. yani şu an kayıtlarda olan birçok cihaz aslnıda geçrekte bir cihazın farklı zamanlarda tekrar giriş yapmasıyla oluşmuş."

**Kapsam:**
- **(A)** Panel (Electron + web aynı kod), tablet ve sunucudaki her basım yolunun sonucunu tek tabloya yazmak ve "Yazdırma geçmişi" sayfasında göstermek.
- **(B)** Her isteğe bir başlık kaydı eklemek (yöntem, uç, durum, süre, cihaz, sürüm). Audit satırlarını okuma anında Türkçe cümleye çevirmek ve bir "Kaydet" tuşunu tek iş eylemi olarak göstermek.
- **(C)** Cihazı değişmeyen donanım kimliğiyle bir kez tanımak; yeniden kurulumda yeni satır açmak yerine aynı kayda yeniden bağlamak; geçmişteki tekrar kayıtları insan onayıyla birleştirmek.

**Kapsam dışı:**
- Patron bulutu `PushDevice` tekrarları.
- Asimetrik cihaz anahtarı (C-R1 §4.2 opsiyonel).
- `yazici.tekrarlayan-hata` KOŞUL türü (v2).
- Serbest metinle anlatı araması.
- iOS.

## 1 · Teşhis

### 1A · Yazıcı
- On basım yolundan sunucu yalnız kullanılmayan `print-native`in sonucunu biliyor. Panel HTML basımı (`Electron/src/lib/print.ts`, 31 çağrı dosyası) sonucu bilmiyor (`afterprint` iptalde de tetikleniyor); hata yalnız toast'ta, tablet BT hatası yalnız cihazdaki `printQueue`da kalıyor.
- Belge, rapor, bordro, fason çekisi, kimlik kartı ve **toplu top etiketi** iz bırakmıyor. `BulkRollLabelButton` `labelPrintedAt` damgalamıyor; iptal guard'ı bu damgayı okuduğu için etiketi basılmış top sessizce iptal edilebilir (KARAR: hata).
- Geçmişi audit'ten (`LABEL_PRINT_EVENT`) türetmek "audit yalnız ayak izi" kuralına aykırı (`test_audit_okuma_kaynagi`) ⇒ kendi tablosu gerekir.

### 1B · Audit
- Satır tablo diliyle konuşuyor ("Top kaydını düzenledi" + ham UUID); tek "Kaydet" 3–20 ayrı satır üretiyor, `requestId` (ALS, `src/lib/request-context.ts`) bağlıyor ama liste gruplamıyor.
- "Ham veri (teknik)"te yöntem/uç/durum/süre/sürüm yok; reddedilen istek (403/409) hiçbir yerde yok; yanıtta `X-Request-Id` yok. `TABLE_LABELS`/`ENUM_LABELS` yalnız Electron'da, backend cümle kuramıyor.
- `system_logs`'a kolon eklemek hash zincirinin (`audit_zincir_ozet` sabit kolon kümesi) dışında kalır ⇒ başlık ayrı tabloya.

### 1C · Cihaz
- **Kök neden:** kimlik uygulama deposundaki rastgele UUID (tablet SecureStore, panel `secure.json`); kaldır-kur depoyu siler, sunucu cihazı başka bilgiyle tanıyamaz ⇒ yeni `Device` satırı, eski satırın ataması/donanım bağları/onayı öksüz. Kaldır-kuru zorlayan kanıtlı olaylar: imza değişimi (debug→release, Windows derlemesi, deneme→Play), `versionCode` düşüşü (09-04 vc58→57), paket adı değişimi. Auto Backup kurtarmıyor (Keystore anahtarı yedeklenmez, `expo-secure-store` geri yüklenen değeri siler). Panelde okuma arızası kimliği ezer; `productName` değişimi `userData`'yı değiştirdi.
- **Ölçüm (deneme DB, salt okuma):** 21 tablet/telefon satırının ≥6'sı tekrar, 6'sı hayalet; ardıllık sezgisi en az bir yanlış pozitif verdi (emulator ↔ samsun a9) ⇒ otomatik birleştirme yok.
- **Yan bulgular:** announce `deviceId max(80)` ↔ kolon `VarChar(64)` · PENDING doğuşu audit'siz · `MAX_DEVICE_ROWS` pasif kopyaları sayıyor · halka kaybında `keyring.ts` sessizce yeni halka üretiyor (kanıt zorunlu kurulumda bütün cihazlar 503) · `device.middleware.ts:96` ölü PairingCode mesajı · eşzamanlı announce/status'ta aynı saniyede dört `DEVICE_PROOF_SECRET_ISSUED`.

## 2 · Kararlar (bağlayıcı; tam metin iki `KARARLAR.md`)

| # | Karar |
|---|---|
| K-A1 | `print_jobs` **telemetridir**, 180 günde budanır (`printLog.retentionDays`). Okuma izni `system:print-history`. Durumlar `ILETILDI`/`HATA`/`IPTAL`/`BELIRSIZ`/`SIMULE`. Tek yazar `recordPrintJob`; üç yazım yolu var: sunucu ham basımı, mevcut print-event uçları, yeni `POST /api/print-jobs` (`clientToken`). |
| K-A2 | "Yazdırma geçmişi" sayfası web ve Electron'da aynı koddur. Bildirim türü `yazici.hata`, bildirim kataloğuna sonraki dalgada eklenir. |
| K-A3 | PDF'e kaydetme geçmişe **ayrı tür** olarak girer (çıktı "PDF") ve süzülebilir. |
| K-A4 | Sessiz basımın varsayılanı **bugünkü davranıştır** (diyalog açılır). Bilgisayar/istasyon başına açılabilir. |
| K-A5 | Toplu top etiketi `labelPrintedAt` damgalar. Düzeltme A dilimindedir ve bekçilidir. |
| K-B1 | `request_traces` telemetridir, **90 günde** budanır. Kolonlar: yöntem, uç, durum, süre, sürüm, cihaz. **Gövde saklanmaz.** Yanıtlara `X-Request-Id` eklenir. Reddedilen istek de iz bırakır. `system_logs` hash zincirine **dokunulmaz**. |
| K-B2 | Anlatıcı okuma anında, backend'de çalışır. Şablon anahtarı `tablo+olay`dır. Tek "Kaydet" tek iş eylemidir (`requestId` gruplaması). `audit-okuma-beyan.ts` yeni satırları **ONAYLIDIR** (DENETIM_EKRANI, yalnız görüntü). |
| K-B3 | Sıra: A1 → B1 → A2+B2 → A3+B3 → A4 → B4. B3 (Aktivite/Etkinlik dosyaları) bildirim **N0-ETK sonrasında** gelir. |
| K-C1 | Tanıma kimliği şöyle seçilir: Android `ANDROID_ID` (`expo-application`, veto listesinde), Windows `MachineGuid`, macOS `IOPlatformUUID`, Linux `machine-id`. Sunucuya kurulum kimliğiyle **tuzlanmış özet** gider. |
| K-C2 | Mevcut cihaz kanıtı korunur. Bilinen donanım yeni yerel kimlikle gelirse **yeni kayıt açılmaz**, yeniden bağlanır: eşleştirme kapalıysa otomatik, zorunluysa yönetici onayıyla. Onay **panelden ya da tablette yerinde** yönetici girişiyle verilir ve audit'e yazılır. |
| K-C3 | Tablet `allowBackup:false`. |
| K-C4 | Birleştirme otomatik değildir. Akış: dry-run betik + panel önizleme + kayıt kayıt seçim. Kaynak pasife alınır, "birleşti → X" işareti alır, olay defterine yazılır ve geri alınabilir. Oturum/log kayıtlarına dokunulmaz. Ortak pakete geçişte `ANDROID_ID` bir kez değişir; bu tek seferlik elle birleştirmeyi fabrika yöneticisi yapar (Adnan Şahin'e biz dokunmayız). |
| K-C5 | Anahtar halkası kaybında **sessiz yeniden üretim yoktur**. Yönetici uyarısı (bildirim türü) ve donanım kimliğiyle toplu yeniden bağlama akışı vardır. |
| K-C6 | Yan bulgular düzeltilir: 80↔64 uyumsuzluğu, PENDING doğuşunun audit'e yazılması. Lisans cihazı koltuk saymaz; 500 tavanı **aktif sayımla** hesaplanır. |
| K-C7 | Dilimler: D1 sunucu+tanıma · D2 tablet (yeni Play paketi; yayın kullanıcı onayıyla) · D3 panel · D4 birleştirme · D5 halka + kurallar. |

**K-C5 okuması (plan yorumu, §9'da veto edilebilir):** Halka dosyası hiç yokken DB'de halkaya bağlı bir iz de yoksa (`proofSalt`, kısa kimlik özeti ya da `enc1:` TOTP kid'i yok), bu bir ilk kurulumdur ve halka bugünkü gibi üretilir. İz varsa bu **kayıptır**. O durumda yeni halka yine üretilir, çünkü fabrika durmamalı ve emanetten dönen eski anahtarın `addKeyToRing` ile eklenebilmesi için etkin bir anahtar gerekir. Ama bu üretim asla sessiz olmaz:
- Sağlık alanı `halkaKaybi` dolar.
- Sistem olayı audit'e yazılır (`SHORT_CREDENTIAL_RING_LOST`).
- Panelde bant görünür.
- Bildirim türü `cihaz.halka-kaybi` oluşur (katalog indikten sonra).
- Toplu yeniden bağlama önizlemesi açılır.

"Hiç üretme" isteniyorsa D5'in kapsamı değişir.

## 3 · A mimarisi: yazdırma geçmişi

### 3.1 Tablo `print_jobs` (model `PrintJob`, sınıf TELEMETRİ)

Tablo UUID PK, `createdAt`/`updatedAt` `@db.Timestamptz` taşır. Model başlığında `///` ile "telemetri, iş kararı okumaz" yazılır.

| Kolon | Tür | Not |
|---|---|---|
| `clientToken` | `String? @unique @db.Uuid` | İstemci raporu. Mantıksal deneme başına üretilir. Replay `helpers/token-replay.helper.ts`'ten geçer. Sunucuda doğan satırda null olur. |
| `requestId` | `uuid?` | ALS kimliği. Audit ve `request_traces` ile bağ kurar. |
| `userId` | `uuid?` FK Restrict | Token'dan alınır, gövdeden **okunmaz**. Künye FK olduğu için indeks yoktur; erişim `(userId, createdAt)` bileşik indeksiyle olur. |
| `deviceRefId` | `uuid?` FK `devices` SetNull | Tablette `x-device-id`, panelde `X-Client-Instance` ile çözülür (yalnız görüntü içindir, güvenlik sınırı değildir). |
| `source` | `VarChar(16)` | `PANEL_MASAUSTU` · `PANEL_WEB` · `TABLET` · `TELEFON` · `SUNUCU`. Yalnız etikettir. |
| `outputKind` | `VarChar(8)` CHECK `PRINTER`/`PDF`, varsayılan `PRINTER` | K-A3 "ayrı tür": PDF kaydı süzülebilir. |
| `appVersion` | `VarChar(32)?` | Eski istemci ayrımı için. |
| `stationId` / `machineId` | `uuid?` | Oturumdan alınır. |
| `subjectKind` | `VarChar(40)` | TS katalog `src/constants/print-subject-catalog.ts`: `ETIKET_TOP`, `ETIKET_CUVAL`, `ETIKET_NUMUNE`, `ETIKET_TEZGAH`, `ETIKET_LEVENT`, `ETIKET_SERBEST`, `ETIKET_TOPLU`, `BELGE`, `REFAKAT_KARTI`, `CEKI_LISTESI`, `FASON_CEKI`, `SERBEST_BELGE`, `RAPOR`, `LISTE`, `KIMLIK_KARTI`, `TEST`. DB CHECK yoktur (yeni tür migration istemesin); bilinmeyen tür 400 alır, bekçi katalog dışı değeri yakalar. |
| `docType` | `PrintedDocType?` | Yalnız `BELGE` için. |
| `subjectTable` / `subjectId` | `VarChar(48)?` / `uuid?` | Polimorfik bağdır, FK yoktur (`PrintedDocument.sourceId` emsali). |
| `subjectIds` | `uuid[]` | Toplu basım için. CHECK `cardinality ≤ 200`. |
| `subjectNo` | `VarChar(64)?` | Barkod / belge no / CL no, basım anındaki hâliyle. |
| `printedDocumentId` / `docVersion` | `uuid?` / `int?` | Basılan donmuş sürüm. |
| `itemCount` / `copies` | `int` CHECK `≥ 1` | |
| `isReprint` | `bool?` | Yalnız gösterim içindir, karar girdisi değildir. |
| `transport` | `VarChar(16)?` | `SISTEM_PENCERESI` · `SESSIZ_OS` · `SERI` · `TCP_9100` · `CUPS` · `WINSPOOL` · `BLUETOOTH` · `SUNUCU_TCP` · `PDF_DOSYA` |
| `peripheralDeviceId` | `uuid?` FK SetNull | Kayıtlı yazıcı. |
| `printerName` / `printerAddress` / `language` | `VarChar(120)?` / `VarChar(128)?` / `PrinterLanguage?` | |
| `status` | `VarChar(12)` CHECK | `ILETILDI`/`HATA`/`IPTAL`/`BELIRSIZ`/`SIMULE` |
| `errorCode` / `errorMessage` | `VarChar(60)?` / `VarChar(300)?` | CHECK `status <> 'HATA' OR "errorCode" IS NOT NULL`. Mesaj Türkçedir, kısaltılır, sır taşımaz. |
| `startedAt` / `finishedAt` / `durationMs` / `bytes` | | |
| `meta` | `jsonb?` (≤2 KB) | Şablon adı/varyant, sayfa boyutu, tek seferlik ezmeler. |

**İndeksler:**
- `(createdAt)`
- `(userId, createdAt)`
- `(peripheralDeviceId, createdAt)`
- `(deviceRefId, createdAt)`
- `(subjectTable, subjectId)`
- GIN `(subjectIds)`
- kısmi `(createdAt) WHERE status='HATA'`

Şema dışı nesneler (CHECK, kısmi indeks, GIN) **aynı commit'te** `test_db_invariants.ts` envanterine yazılır.

**Durumlar:** Durumlar ölçülebilen gerçeğe göre konmuştur.
- `ILETILDI`: baytları spooler ya da yazıcı kabul etti. Kâğıt sıkışmasını hiçbir yol göremez, bu yüzden ad "basıldı" değildir. PDF için ekranda "Kaydedildi" diye görünür.
- `HATA`
- `IPTAL`: kullanıcı pencereyi kapattı.
- `BELIRSIZ`: tarayıcı/iframe yolunda tek dürüst cevap budur.
- `SIMULE`: `label.nativeSendEnabled` kapalıdır. Başarı **sayılmaz** (`kesif-cihaz.md` SIMULATED kuralının ikizi).

`KUYRUKTA` ancak kuyruk sunucuya taşınırsa reçeteyle eklenir.

### 3.2 Tek yazar: `Teks-Erp:src/services/print-job.service.ts#recordPrintJob`

- Tx dışında çalışır. Best-effort'tur ama sayaçlıdır (`getHealth().printJobs.{yazilan,dusen}`, `AuditService.getHealth` emsali). İş sonucunu asla bozmaz.
- `print_jobs`'a yazan, okuyan ve budayan **tek dosyadır**. AST bekçisi `prisma.printJob` erişimini bu dosya dışında yasaklar (defter.md telemetri kuralı ④).
- **Üç yazım yolu:**
  1. **Sunucu kendi sonucunu yazar:** `label.service.ts#printRollNative` / `#testNativeSend`. Eşleme: `delivered` → `ILETILDI`, `simulated` → `SIMULE`, `error` → `HATA`. Hedef cihaz adı yönlendirmeden gelir.
  2. **Mevcut iş uçları satır doğurur** (eski istemci de görünsün diye): `POST /labels/rolls/:id/print`, `/labels/sacks/:id/print-event`, `/labels/machines/:id/print-event`, `/labels/warp-beams/:id/print-event`, `/traveler-cards/:id/print-event`, `/shipping/sack-search/pick-list/print`.
     - Gövdeye **isteğe bağlı** `printJob` alt nesnesi eklenir: `clientToken`, `transport`, `printerName`, `printerAddress`, `peripheralId`, `durationMs`, `copies`.
     - Alan yoksa satır `ILETILDI` + `transport=null` olarak doğar ("eski istemci, yazıcı bilinmiyor").
     - İstemci gövde katmanı sessiz allowlist olduğu için alan **iki uçta** eklenir (Zod + istemci tipi).
  3. **Yeni `POST /api/print-jobs`:** İş ucu olmayan basımlar (belge, serbest belge, rapor, bordro, fason çekisi, kimlik kartı, PDF) ile **bütün hatalar ve iptaller** buradan gelir.
     - `clientToken` zorunludur. Replay dört durumludur ve tek boğazdan geçer.
     - `userId` ve `deviceRefId` token/başlıktan çözülür.
     - Bilinmeyen `subjectKind` 400 alır (fail-closed). `subjectId` verilmişse varlığı doğrulanır; yoksa 400.
     - Gövde ≤8 KB'tır ve hız sınırlıdır.
     - İzin: `verifyToken` (kişi **kendi** basımını bildirir). `clientType` güvenlik sınırı değildir.
- **Kimlik kartı:** Satıra yalnız "Kimlik kartı basıldı · kullanıcı X" yazılır. İçerik, PIN ve parola **asla** yazılmaz. Sunucu `KIMLIK_KARTI` türünde `meta`yı tamamen düşürür (bekçi sondası).

### 3.3 Toplu top etiketi damgası (K-A5)

- Yeni uç: `POST /api/labels/rolls/bulk-print-event`, gövde `{rollIds: uuid[] (1..200), printJob?}`, izin `label:print`.
- Damga mantığı bugün `recordPrintEvent` içindedir ("TEK YAZMA NOKTASI" yorumu). Bu mantık `stampRollLabelPrinted(rollIds)` helper'ına çıkarılır: `updateMany {labelDirty:false, labelPrintedAt:now}` + top başına snapshot. Tekil ve toplu yol bu helper'ı çağırır; tek yazma noktası korunur.
- Audit top başına `LABEL_PRINT_EVENT` (`logMany`) yazar. Toplu iş tek `print_jobs` satırıdır (`subjectKind=ETIKET_TOPLU`, `subjectIds`).
- Panel `BulkRollLabelButton` (sevkiyat belge diyaloğu + mal kabul) basım `ok` dönünce bu ucu çağırır (A2). Backend ucu A1'dedir.
- **Bekçi:** `test_print_jobs §toplu`
  - 3 top → üçünde de `labelPrintedAt` dolu, `labelDirty=false`, tek job satırı.
  - Negatif sonda: helper'dan damga çıkarılınca kırmızı.
  - Vitest: `BulkRollLabelButton` başarıda ucu çağırır.

### 3.4 Panel ve web istemcisi

- **Tek boğaz `printTracked({subject, html|root, outputKind})`, `Electron/src/lib/print.ts` içinde.** 31 çağrı dosyası buraya taşınır. Vitest AST bekçisi `printHtmlString`/`printDocumentArea`'nın boğaz dışında çağrılmasını yasaklar.
- **Electron:**
  - YENİ Electron:electron/ipc/print.ipc.ts: gizli `BrowserWindow` + `webContents.print({silent, deviceName}, (success, failureReason) => …)`. Güvenlik duruşu `pdf.ipc.ts` ile aynıdır; `trusted-ipc` kapısı uygulanır.
  - Sonuç eşlemesi: `success` → `ILETILDI`, `failureReason==='cancelled'` → `IPTAL`, diğerleri → `HATA`.
  - Yazıcı listesi `getPrintersAsync` ile alınır.
- **Web:** iframe yolu → `BELIRSIZ`. Web PDF (`web-pdf.ts`, yazdırma penceresi) → `outputKind=PDF` + `BELIRSIZ`.
- **Electron PDF (`pdf.ipc.ts` `printToPDF`):** `ILETILDI`/`IPTAL`/`HATA` + `outputKind=PDF`, `transport=PDF_DOSYA`.
- **Etiket (`useLabelPrinter#send`):** `{ok, bytes, error}` ve hedef (`cfg.path`, `peripheralId`) aynen raporlanır. Başarıda iş ucuna `printJob` alt nesnesi eklenir; hata ya da iptalde `POST /print-jobs` çağrılır.
- **Rapor çağrısı:** `suppressErrorToast` taşır (`print-event-toast.test.ts` genişler). 404 (eski backend) sessizce yutulur.
- **Sessiz basım (K-A4):** "Bu Bilgisayar" yüzeyinde (`/system/workstation`) YENİ Electron:src/pages/GeneralSettings/DocumentPrinterDeviceSettings.tsx eklenir. `LabelPrinterDeviceSettings` desenini izler: `useDeviceDraft("documentPrinter")`, bilgisayara özel yerel tercih.
  - Alanlar `silent` (varsayılan **false** = bugünkü diyalog) ve `deviceName` (OS yazıcı listesinden).
  - Sessiz basım yalnız `deviceName` doluyken açılabilir.
  - Tablet: BT etiketi zaten diyalogsuzdur; HTML basımında Android sistem penceresi zorunludur, bu yüzden tablette ayar yoktur.
  - Sunucu bayrağı yoktur, `test_feature_flag_contract` etkilenmez.

### 3.5 Tablet istemcisi (A4)

- YENİ mobil:src/services/printJob.service.ts: rapor kuyruğu. AsyncStorage, `failedOps` deseni, 48 saat TTL, ≤200 kayıt.
- `LabelPrinter.tsx`, `labels/SackLabelPrinter.tsx`, `labels/StandaloneLabelPrinter.tsx`, `screens/Modules/Devere/WarpBeamLabelPrinter.tsx`, `services/fasonCekiPrint.ts`, `services/workOrderDocuments.ts` ve `services/printHtml.ts` sonucu kuyruğa yazar.
- Hatalarda BT MAC adresi ve `PeripheralDevice.name` gönderilir. Kuyruk çevrimiçi olunca boşaltılır; `clientToken` sayesinde mükerrer satır doğmaz.
- Değişiklik yalnız JS'tir (OTA ile gidebilir).

### 3.6 Okuma, izin, saklama

- **Okuma uçları:**
  - `GET /api/print-jobs`: cursor ile. Süzgeçler: `userId`, `peripheralDeviceId`, `printerName`, `deviceRefId`, `stationId`, `subjectKind`, `status`, `source`, `outputKind`, `subjectId` (`subjectIds @>` dahil), fabrika günü aralığı (`src/constants/time.ts`). Süzme sunucudadır; id filtreleri `readIdCondition`/`readFilterList` ile kurulur.
  - Özet şeridi (`?ozet=1`) **aynı where**'den gelir.
  - `GET /api/print-jobs/:id`
- **İzin:**
  - `system:print-history` → `permission-catalog.ts` tek satır.
  - Rol şablonu: Süpervizör + Sevkiyat sorumlusu.
  - `screen-catalog.ts` ekran girdisi.
  - Panel karo ↔ route aynı liste: `[admin:settings, system:print-history]` (`admin:settings` şemsiyedir).
  - Migration **yok**; boot uzlaştırması yazar.
- **Saklama:**
  - `printLog.retentionDays` (varsayılan 180, `0` = budama yok); ayar reçetesine göre eklenir.
  - Budama `src/jobs/maintenance.job.ts` gece penceresinden (02:00–05:00) `print-job.service.ts#prunePrintJobs` çağrılarak yapılır; yüklem yalnız yaşa bağlıdır.
  - Beyanlar:
    - `defter-beyan.ts` TELEMETRİ, `silen: ["src/services/print-job.service.ts"]`, `kararUfku: "YOK — iptal guard'ı labelPrintedAt okur; print_jobs hiçbir karara girmez"`
    - `audit-muafiyeti.ts` TELEMETRİ
- **Bildirim (A4, katalog indikten sonra):** `yazici.hata`
  - Sınıf/alt tür: BİLDİRİM/OLAY. Konu: yazıcı (`peripheralDeviceId ?? printerName`). Pencere 600 sn.
  - İzin `[system:print-history]`. Derin bağlantı `/system/print-history?printer=…&status=HATA`.
  - `recordPrintJob` HATA satırını yazdıktan sonra `emitNotification` çağrılır.
  - Katalog (`Teks-Erp/src/constants/notification-catalog.ts`, bildirim N0-KAT) yoksa A4 bu parçayı **yapmaz** ve devir notuna yazar.

### 3.7 Eski istemci

| Durum | Davranış |
|---|---|
| Eski panel/tablet + yeni backend | Print-event uçlarından `ILETILDI` satırları doğar (yazıcı bilinmez); hata satırı doğmaz. Sayfada `appVersion` ile "eski istemci" rozeti görünür. |
| Yeni panel + eski backend | `POST /print-jobs` 404 alır ve sessiz yutulur. `printJob` alanı eski Zod'da elenir. `bulk-print-event` 404 alır ve sessiz yutulur (bugünkü davranış). |

Kırılma yoktur, `minVersion` değişmez. Sıra: backend → panel → tablet.

## 4 · B mimarisi: istek başlığı ve anlatıcı

### 4.1 Tablo `request_traces` (model `RequestTrace`, TELEMETRİ, 90 gün)

- **Kolonlar:**
  - `id` = requestId (uuid PK)
  - `userId?`
  - `deviceRefId?` (FK SetNull; çözümü print_jobs ile aynı)
  - `deviceLocalId VarChar(64)?`
  - `clientType VarChar(16)?`
  - `appVersion VarChar(32)?`
  - `ip VarChar(64)?`
  - `method VarChar(8)`
  - `routeKey VarChar(160)`: `latency.middleware.ts#normalizeKeyPath` dışa alınır ve aynı normalleştirme uygulanır; UUID ya da sayı sızmaz.
  - `status smallint`
  - `durationMs int`
  - `errorCode VarChar(60)?` (`details.code`)
  - `auditCount int` (varsayılan 0)
  - `createdAt` / `updatedAt`
- **İndeksler:** `(createdAt)`, `(userId, createdAt)`, kısmi `(createdAt) WHERE status >= 400`.
- **Gövde, sorgu dizesi, başlık değerleri SAKLANMAZ** (PIN, parola, ayar şifresi riski).
- **Yazım:** YENİ `src/middlewares/request-trace.middleware.ts`, `app.ts:360` `runWithRequestContext` satırının hemen arkasına bağlanır.
  - Yanıta `X-Request-Id` başlığı eklenir; CORS `exposedHeaders`'a da girer.
  - `res.on('finish')` anında tek INSERT yapılır: fire-and-forget, tx dışında, `request-trace.service.ts#recordTrace` (tek yazar, tek budayıcı).
  - ALS bağlamına `auditCount` eklenir; `AuditService.log/logMany/logEvent` bu sayacı artırır.
- **Yazım koşulu:**
  - (POST/PUT/PATCH/DELETE ∧ (`auditCount>0` ∨ `status≥400`)) ∨ (GET ∧ `status=403`).
  - 401 oturum düşmesi GET'te yazılmaz (gürültü).
  - Beyanlı dışlama listesi `src/constants/request-trace-haric.ts`: `/api/devices/announce`, `/api/devices/status`, heartbeat'ler, `/health`, SSE/yoklama.
  - Süreç başı jeton kovası (≥50/sn), taşma `getHealth().requestTraces.dusen` ile sayılır.
- **Saklama:** `requestTrace.retentionDays` (varsayılan **90**), budama gece penceresinde. Beyanlar TELEMETRİ, `kararUfku: "YOK"`.
- **Hash zinciri:** `system_logs` ve `audit_zincir_ozet` **değişmez**; `test_audit_hash_zinciri` yeşil kalır.

### 4.2 Anlatıcı: `Teks-Erp/src/services/audit-narrative/`

- **İlke:** Cümle okuma anında backend'de kurulur, hiçbir yere yazılmaz. Şablon değişirse geçmiş satır yeni cümleyle okunur; ham veri "Teknik ayrıntı"da aynen durur.
- **Yanıt:** Liste ve detay yanıtlarına **ek** alan `anlati: {parcalar: Parca[], metin: string}` gelir (geri uyumlu). Parça biçimi `{t:'kisi'|'kayit'|'deger'|'metin', text, ref?: {table,id}}`.
- **Şablon kataloğu `sablonlar.ts`:**
  - Anahtar önceliği `"<tableName>:<event>"` > `"<tableName>:<action>"` > yedek.
  - Şablon saf işlevdir: `(satir, cozulmus) → Parca[]`.
  - Kapsama sırası: en sık 30 çift önce gelir. Kapsama oranı cırcır olarak tutulur; çürüme kolu `curumeKolu()` ile ayrılır.
- **İsim çekimi `src/constants/audit-isimler.ts`:**
  - `terim.ts` `TermCases` deseniyle model → hâl eklerini tutar.
  - Hâl eki numaraya değil isme gelir ("SP-2026-0148 **siparişinin**"), böylece kesme ve ünlü uyumu sorunu doğmaz.
  - İş emri adları `TERIM`'den alınır.
- **Alan sözlüğü tek kaynağı:** Alan etiketleri zaten backend'dedir (`audit-field-labels.ts`). `TABLE_LABELS` ve `ENUM_LABELS` backend'e taşınır (`src/constants/audit-tablo-etiketleri.ts`, `audit-enum-etiketleri.ts`). Electron `lib/audit-labels.ts` bunların **bayt-eşit aynası** olur; `test_audit_labels` genişler. Ayna, eski backend'e bağlanan yeni panelin yedeğidir.
- **Kayıt no çözücü `src/services/helpers/audit-kayit-cozucu.ts`:**
  - `(table, id)` → numara (tablo başına tek sorgu, fail-open, `audit-value-resolver.ts` deseni).
  - Tersine, `q` (SP-…, barkod, CV…, CL…, iş emri no) → numaralı modellerin **unique** kolonlarında arama → `(table, id)`.
- **Gruplama (`gorunum=islem`):**
  - Trace'li dönemde `request_traces` okunur (`request-trace.service.ts` üzerinden; telemetri okuyan tek dosya kuralı), ardından `system_logs WHERE requestId IN (…)`.
  - Eski dönemde `GROUP BY requestId`; `requestId` null olan satır tek başına grup olur.
- **Başlık cümlesi:**
  - Önce uç→eylem katalogu `src/constants/route-eylem-katalogu.ts`'ten gelir (`POST /api/shipping/shipments/:id/dispatch` → `{fiil:'sevkiyatı onayladı', deneme:'sevkiyatı onaylamaya çalıştı'}`).
  - Katalogda yoksa kök kaydın anlatısı kullanılır (öncelik: sipariş > sevkiyat > iş emri > çuval > top …). Altına "ve N kayıt daha etkilendi" eklenir.
- **Reddedilen istek:** "Ahmet sevkiyatı onaylamaya çalıştı — reddedildi: kayıt başka biri tarafından değiştirilmiş (409)". Hata kodu→Türkçe metin eşlemesi `route-eylem-katalogu.ts` yanında durur.
- **Bilinmeyen tür yedeği (`yedek.ts`):** "{kişi}, {kayıt no ya da kısa kimlik} {modül etiketi ya da ham tableName} kaydını {oluşturdu/düzenledi/sildi}" + varsa "(olay: …)" + tek alan farkı varsa onun cümlesi. **Hiçbir satır yalnız UUID kalmaz** (bekçi).
- **Okuma beyanı:** `scripts/lib/audit-okuma-beyan.ts`'e yeni satırlar eklenir, sınıf DENETIM_EKRANI/KAYIT_GECMISI (K-B2 ile ONAYLI):
  - `audit-narrative/index.ts#anlatSatirlar`
  - `system-log.service.ts#SystemLogService.listIslemler`
  - `#findIslem`
  - `#listByRecordQuery`

  Gerekçe sütununa "yalnız görüntü; sayı/karar türetilmez" yazılır.

### 4.3 Uçlar (`routes/admin.routes.ts`, Zod allowlist iki uçta)

- `GET /api/admin/system-logs`: ek `anlati`; yeni parametreler `gorunum=satir|islem`, `q`, `gun=bugun|dun|hafta` (fabrika günü).
- `GET /api/admin/system-logs/islem/:requestId`: tek işlem. Trace başlığı (yöntem, uç, durum, süre, IP, cihaz **adı**, uygulama + sürüm) + etkilenen kayıtlar (modül, numara, işlem, alan farkları) + ham JSON.
- İzin bugünkü Aktivite kapısıdır (`admin:settings ∨ system:activity`). Yeni izin yoktur.

## 5 · C mimarisi: cihaz eşleme v2

**İlke:** Fiziksel cihaz = KİMLİK (`devices.id`, kalıcı). Uygulama kurulumu = ANAHTAR (`devices.deviceId`, artık "**etkin** kurulum anahtarı"; yalnız yeniden bağlamayla değişir). Bağlama olayları = DEFTER.

### 5.1 Tanıma kimliği

- **İstemci gönderimi:** `hw = {v:1, kaynak, ozet}`.
  - `ozet = HMAC-SHA256(anahtar = installationId, "tekserp/cihaz-donanim/v1\n" + kaynak + "\n" + ham)`, küçük harf hex.
  - Kaynaklar: `ANDROID_ID` · `WIN_MACHINE_GUID` · `MAC_PLATFORM_UUID` · `LINUX_MACHINE_ID`.
- Ham değer cihazdan çıkmaz. Özet kuruluma özgüdür (iki fabrika aynı tableti ilişkilendiremez).
- Sunucu özeti **olduğu gibi** saklar; halkayla ikinci HMAC yapılmaz (halka değişince tanıma ölmesin diye).
- **Okuma yolları:**
  - Android: `expo-application` `getAndroidId()` (yeni doğrudan bağımlılık, veto §9).
  - Masaüstü: ana süreçte `execFile`, kabuk yok, `Teks-Erp/src/lib/license/fingerprint-os.ts` emsali.
- **Kimlik doğrulama için KULLANILMAZ.** Yalnız "bu cihazı tanıyor muyum" sorusunu cevaplar. Kimlik `x-device-proof` ile kanıtlanır (korunur).
- Görünür ad Android'de `Platform.constants.Model`/`Manufacturer` ile gelir ("Samsung SM-X200"); paket gerekmez.
- Play Veri Güvenliği formu (`docs/ops/PLAY-KONSOL-FORMLARI.md`) "rastgele UUID" yerine "cihaz kimliği (kuruluma özgü özet)" der.

### 5.2 Şema (D1; tamamı ekleme, null olabilir)

**`devices` tablosuna eklenenler:**
- `hwDigest VarChar(64)?`, `hwSource VarChar(16)?`
- `mergedIntoId Uuid?` öz FK RESTRICT, `mergedAt Timestamptz?`
- Kısmi UNIQUE `(hwDigest) WHERE hwDigest IS NOT NULL AND mergedIntoId IS NULL`
- CHECK `mergedIntoId <> id`
- CHECK `mergedIntoId IS NULL OR isActive = false`
- Zincir yasağı (hedef birleşmiş olamaz): serviste atomik WHERE + trigger `devices_merge_no_chain`

**DEFTER `device_binding_events`** (append-only, yalnız `createdAt`):
- Kolonlar: `deviceRefId` FK **SetNull** (hard delete edilen hayalet için), `localId VarChar(64)`, `deviceName VarChar(120)` anlık, `event VarChar(24)`, `actorId?`, `reason VarChar(300)?`, `hwDigest?`, `meta jsonb?`.
- Olaylar: `REGISTERED` · `REBIND_REQUESTED` · `REBOUND` · `REBIND_REJECTED` · `REVOKED` · `MERGED` · `UNMERGED` · `PROOF_RESET` · `PURGED`.
- `defter-beyan.ts`: ters yol `KARSI_OLAY` (MERGED↔UNMERGED, REBOUND ters kaydı = yeni REBOUND).
- Kalıcı silme ucu (`/:id/permanent`) satırı silmeden önce aynı tx'te `PURGED` yazar; defter satırı kalır.

**DURUM `device_rebind_requests`:**
- Kolonlar: `targetDeviceId` FK, `localId VarChar(64) @unique`, `kind`, `model VarChar(120)?`, `hwDigest`, `status VarChar(10)` CHECK `OPEN|APPROVED|REJECTED`, `decidedById?`, `decidedAt?`, `createdAt`/`updatedAt`.
- Bekleyen talep `devices`'a satır açmaz. Tavan 200 OPEN (`MAX_PENDING_DEVICES` ikizi).

### 5.3 Announce karar tablosu (`device.service.ts#announce`)

| Gelen | Koşul | Davranış |
|---|---|---|
| `localId` biliniyor | — | Bugünkü gibi canlılık. `hwDigest` boşsa ve çakışma yoksa **öğrenilir** (`updateMany WHERE {id, hwDigest:null}`). Çakışma varsa yazılmaz, `meta.cakisma` ile `REGISTERED` olmayan bir uyarı olayı tutulur. |
| `localId` bilinmiyor, `hw` yok (eski istemci) | — | **Bugünkü davranış** (yeni satır), bayt-eşit. Defter: `REGISTERED`. Audit: PENDING doğuşta `DEVICE_REGISTERED_PENDING` (K-C6), otomatik onayda bugünkü `DEVICE_AUTO_APPROVED`. |
| `localId` bilinmiyor, `hw` aktif + birleşmemiş cihazla eşleşiyor | eşleştirme **kapalı** | **Otomatik yeniden bağlama:** `updateMany({where:{id, deviceId: eskiLocalId, hwDigest, mergedIntoId:null, isActive:true}, data:{deviceId: yeniLocalId, proofSalt:null, proofIssuedAt:null, proofConfirmedAt:null}})`; `count===0` → 409. `REBOUND` olayı yazılır. Makine ataması ve donanım bağları korunur. |
| aynı | eşleştirme **zorunlu** (barındırılanda daima) | Talep açılır (localId unique; varsa tazelenir). Yanıt `status:"REBIND_PENDING"` + `targetName`. Defter: `REBIND_REQUESTED`. |
| `hw` pasif/revoke edilmiş cihazla eşleşiyor | — | Otomatik bağlama YOK → talep açılır (public uç yönetici kararını geri alamaz). |

- `DeviceStatus` enum'una değer eklenmez. `REBIND_PENDING` yalnız yanıt katmanındadır; `pairingGate.ts` onu "onay bekleniyor" kümesine alır.
- **Onay:**
  - Kanıt alanları sıfırlanır ve yeni kuruluma yeni sır verilir; eski kurulumun sırrı ölür.
  - Talep claim'i `updateMany WHERE {id, status:'OPEN'}` ile, cihaz claim'i `WHERE {id, deviceId: eski}` ile yapılır; ikisi tek tx'tedir.
- **Reddetme seçenekleri:** "Ayrı cihazdır" (klon `MachineGuid`) seçilirse yeni `Device` satırı `hwDigest=null` ile açılır ve olay `REBIND_REJECTED reason=AYRI_CIHAZ` yazılır. Düz red seçilirse talep `REJECTED` olur.
- **Tavanlar:**
  - `MAX_DEVICE_ROWS` sayımı `isActive AND mergedIntoId IS NULL`'dur (aktif sayım). `reactivate` da tavana bakar.
  - `MAX_PENDING_DEVICES` aynı süzgeçle sayılır.
  - Lisans koltuk saymaz. İleride sayarsa tek kaynak `device-identity.helper.ts#countSeatDevices` olur.
- **Yan bulgular:**
  - `announceSchema.deviceId max(80)` → `max(64)`.
  - `device.middleware.ts:96` mesajı "yönetici onayı isteyin" olarak düzeltilir.
  - Eşzamanlı announce/status sır tekrarı: `issueProofSecretIfDue` claim'i `WHERE {id, proofIssuedAt: null}` ile tek kazanana düşürülür (D1).

### 5.4 Yeniden bağlama onay yolları

- **Panel (D3):** Cihazlar sayfasında "Yeniden bağlama talepleri" bölümü. Satırda hedef cihaz adı, yeni kurulumun modeli, zaman ve iki eşleşme kanıtı (aynı donanım özeti + son görülme) görünür. Düğmeler: Onayla / Ayrı cihazdır / Reddet. Uçlar `/api/admin/devices/rebind-requests[/:id/approve|reject]`, izin `admin:settings`. Statik yollar `/:id`'den **önce** kaydedilir.
- **Tablette yerinde (D1 uç + D2 ekran):** `POST /api/devices/rebind-requests/onsite-approve` (PUBLIC beyanlı, `test_route_auth_coverage`'a kayıt).
  - Gövde `{localId, username, password, totp?}`.
  - Kimlik doğrulama giriş servisinin **aynı** doğrulayıcısıyla yapılır: aynı kilit sayacı, 2FA, sistem hesabı mühür yüklemi.
  - İzin `admin:settings` aranır.
  - JWT **verilmez**. Hız sınırı IP + localId başınadır.
  - Audit `DEVICE_REBIND_APPROVED_ONSITE` (actorId); parola/TOTP log'a ve audit'e girmez.
  - Defter `REBOUND` `meta.yol='YERINDE'`.

### 5.5 Kalıcılık kuralları (D2/D3, kural satırı D5)

1. Android paket adı ve mühür sabittir (`com.etkiliyazilim.tekserp` + Play App Signing). Üretim tabletine başka mühürlü APK kurulmaz.
2. `versionCode` asla düşmez. `mobil/scripts/build-apk.mjs` önceki yayına karşı denetler.
3. Tablet `android.allowBackup:false` (K-C3). Native değişikliktir, yeni AAB ister.
4. Panel `productName`/`appId` sabittir. Değişirse eski `userData`'dan `config.deviceId` taşınır.
5. "Değer yok" ile "okunamadı" ayrılır. Okunamayan kimlik **üstüne yazılmaz**; oturum geçici kimlikle sürer, donanım özeti tanır (panel `Electron/src/lib/deviceId.ts`, tablet `mobil/src/utils/deviceId.ts`).

### 5.6 Birleştirme (D4)

- **Betik Teks-Erp:scripts/cihaz-birlestir.ts:** Dry-run varsayılandır ve yalnız rapor verir: gruplar, gerekçe (ardıllık, istasyon/makine/kullanıcı kesişimi, sürüm sırası), önerilen ana kayıt, güven puanı. `--apply` YOKTUR; uygulama yalnız panel/uçtan yapılır. Sezgi helper'ı betik ve önizleme ucunda ortaktır.
- **Adaylar `GET /api/admin/devices/merge/candidates`:** sezgi grupları (betikle aynı helper).
- **Önizleme `POST /api/admin/devices/merge/preview` `{targetId, sourceIds[]}`:** Kaynak başına etkilenen **her** kaydı listeler:
  - `work_sessions` (yerinde kalır, sayı + son 5)
  - `DevicePeripheral` (taşınır)
  - `PeripheralDevice.deviceId` (taşınır)
  - açık oturum (engeller → 409 nedeni)
  - makine ataması çakışması
  - sezgi önerileri
- **Uygula `POST /api/admin/devices/merge`, tek tx:**
  - Advisory kilit tx'in ilk ifadesidir; yeni uzay `device-merge` envanteri `helpers/period-guard.helper.ts` başlığında ve `test_advisory_lock_namespaces`'te tutulur.
  - Kaynaklar id sırasıyla `updateMany WHERE {id, mergedIntoId:null}` ile claim edilir, `{isActive:false, mergedIntoId, mergedAt}` yazılır. Hedef `WHERE {id, mergedIntoId:null, isActive:true}` ile doğrulanır; `count` uyuşmazsa 409.
  - Pivot taşıma: `DevicePeripheral` (saf yapılandırma pivotu: hedefte yoksa eklenir, kaynakta silinir) ve `PeripheralDevice.deviceId`.
  - Defter ve ayak izi **taşınmaz**: `WorkSession`, `Session`, `SystemLog`, `WorkOrderEvent` … değişmez.
  - Kaynak başına `MERGED` olayı yazılır; audit tx dışındadır.
- **Geri al `POST /api/admin/devices/merge/:sourceId/undo`:** `UNMERGED` karşı olayı yazılır; kaynak pasif ve bağsız döner. İleri kayıt silinmez; taşınan pivotlar geri taşınmaz (önizlemede söylenir).
- **Okuyucular:** "Hangi fiziksel cihaz" sorusu tek helper `src/services/helpers/device-identity.helper.ts`'tedir: `physicalDeviceId = COALESCE(mergedIntoId, id)` ve `localId → device` çözümü (defterden; eski metin kimlikler `SystemLog.deviceId` vb. için). AST bekçisi `mergedIntoId`'nin bu dosya dışında okunmasını yasaklar. `client-registry.service.ts` ve `DeviceService.detail` ("geçmiş kurulumlar") bu helper'ı kullanır.

### 5.7 Halka kaybı (D5)

- Halka yoksa ama DB'de iz varsa (§2 okuması) sessiz üretim yerine görünür durum yaşanır:
  - `getHealth().shortCredential.halkaKaybi={tespit, kayipKidler}`
  - `logEvent SYSTEM SHORT_CREDENTIAL_RING_LOST`
  - Panel bandı
  - Bildirim `cihaz.halka-kaybi` (katalog indiyse)
- **Panel "Kanıtı doğrulanamayan cihazlar" önizlemesi:** `kid`'i halkada olmayan `proofSalt` taşıyan cihazlar kayıt kayıt listelenir. İlk öneri her zaman "emanetten geri yükle" olur (mevcut akış; cihazlar kendiliğinden iyileşir).
- **Toplu yeniden bağlama:** Seçilen cihazlarda kanıt alanları sıfırlanır (`PROOF_RESET` olayı, `meta.beklenenHw`). Sonraki announce'ta **aynı `localId` ve aynı `hwDigest`** gelirse yeni sır verilir. `hwDigest` uyuşmaz ya da yoksa (eski istemci) talep açılır.
- `test_kisa_kimlik_ozet` ve `test_kimlik_totp_sifreleme` yeşil kalmalıdır.

### 5.8 Eski istemci, `minVersion`, Play

- **Eski tablet/panel** `hw` göndermez → bugünkü davranış. `minVersion` gerekmez.
- **Yeni istemci + eski backend:** `hw` alanı katı olmayan şemada atılır. `REBIND_PENDING` yalnız yeni backend'den gelir.
- **Geçiş:**
  - Yeni AAB ilk açılışta mevcut `localId` ile announce eder ve `hwDigest` öğrenilir.
  - Tanıma ilk sonraki kaldır-kurda işe yarar.
  - Play mührüne geçişte `ANDROID_ID` bir kez değişir; bu tek seferlik elle birleştirmeyle (D4) kapanır. Fabrikada bu işi fabrika yöneticisi yapar.
- **Sıra:** backend → panel → tablet (Play'e yeni AAB; yayın **kullanıcı onayıyla**).

## 6 · UI/UX

### 6.1 Sistem → Yazdırma geçmişi (`/system/print-history`)

```
┌ Yazdırma geçmişi ───────────────────────────────────────────────────────────┐
│ [Bugün][Dün][Bu hafta][Tarih…]  Kişi ▾  Yazıcı ▾  Cihaz ▾  Tür ▾  Durum ▾  Çıktı: Yazıcı|PDF │
│ ── Bugün 412 baskı · 7 hata · 3 belirsiz · 18 PDF · en çok hata: Sevkiyat Argox (5) ──      │
│ 14:32  Ahmet Y.   Sevkiyat PC     T120726F0001 top etiketi   Sevkiyat Argox  1  ● İletildi │
│ 14:31  Ahmet Y.   Sevkiyat PC     12 top etiketi (toplu)     Sevkiyat Argox 12  ● İletildi │
│ 14:20  Mehmet K.  Tambur-1 Tablet T120726F0007 top etiketi   BT 00:11:..:4F  1  ● HATA     │
│        └ Yazıcıya bağlanılamadı — yazıcı kapalı ya da eşleşme düşmüş. Tanımlar → Donanım     │
│ 14:05  Ayşe D.    Web             SP-2026-0148 irsaliyesi v2 (sistem penceresi)  ◐ Belirsiz │
│ 13:58  Ayşe D.    Muhasebe PC     Çek bordrosu B-0042        PDF  ▣ Kaydedildi              │
│ 13:40  Kaan T.    KK1 Tablet      eski istemci · yazıcı bilinmiyor  ● İletildi              │
└──────────────────────────────────────────────── [Daha fazla] ─────────────────────┘
```

- Satır tıklanınca detay sayfası açılır: kim, ne, nereden, yazıcı adresi, süre, bayt, hata kodu, kayda git, işlem no (Etkinlik'e bağlantı).
- Top, çuval, sevkiyat, iş emri ve belge detaylarında "Baskı geçmişi" bağlantısı görünür (`?subjectId=`); aynı izinle gösterilir.
- Durum renkleri: İletildi yeşil · Hata kırmızı · İptal gri · Belirsiz amber · Simüle mor + "SİMÜLASYON".

### 6.2 Etkinlik → İşlemler görünümü (B3)

```
┌ Etkinlik ─────────────── Görünüm: (●) İşlemler ( ) Tüm satırlar ──────────────┐
│ [Bugün][Dün][Bu hafta]  Kişi: Ahmet Y. ▾  Ara: [SP-2026-0148      ] [Reddedilenler] │
│ 15:02  Ahmet Y. SP-2026-0148 siparişinin Termin tarihini 18.10 → 25.10 yaptı       │
│ 14:47  Ahmet Y. SV-2026-0311 sevkiyatını onayladı · ve 12 kayıt daha etkilendi  ▸  │
│ 14:40  Ahmet Y. sevkiyatı onaylamaya çalıştı — reddedildi: kayıt başka biri        │
│                 tarafından değiştirilmiş (409)                                     │
└───────────────────────────────────────────────────────────────────────────────┘
 ▾ Teknik ayrıntı (katlı)
   POST /api/shipping/shipments/:id/dispatch · 200 · 184 ms · İşlem no 7f3a…  [kopyala]
   Sevkiyat PC (Masaüstü) · TeksERP Panel 1.6.7 · 192.168.1.42
   ┌ Modül      │ Kayıt         │ İşlem   │ Değişenler                       ┐
   │ Sevkiyat   │ SV-2026-0311  │ düzenle │ Durum: Hazırlanıyor → Sevk edildi │
   │ Çuval      │ CV2410260012  │ düzenle │ Durum: Depoda → Sevk edildi       │
   └──── … ──────────────────────────────────────────────────────────────────┘
   ▸ Ham veri (adli inceleme)
```

- Kayıt sayfasındaki ⓘ "Geçmiş" aynı `AuditNarrativeRow` bileşeniyle zaman çizelgesi basar: "aynı işlemde" gruplu, Teknik ayrıntı katlı. Kendi defteri olan yerde (iş emri hareketleri) o defter birincil kalır.
- Dışa aktarmaya (`userActivityExport`, `systemLogSummaryExport`) "Açıklama" kolonu eklenir.

### 6.3 Cihazlar: talep, kopya ve birleştirme önizlemesi (D3/D4)

```
┌ Cihazlar ──────────────────────────────────────────────────────────────────────┐
│ ⚠ Yeniden bağlama talepleri (1)                                                   │
│   Samsung SM-X200 · 09:34 · "Tambur-1 Tablet" ile AYNI DONANIM (son görülme 09:20) │
│   [Onayla] [Ayrı cihazdır] [Reddet]                                                │
│ ⓘ Kopya olabilecek kayıtlar (3 grup)                                   [İncele]    │
│ Ad              Tür     Durum   Makine     Son görülme   Kurulumlar                │
│ Tambur-1 Tablet Tablet  Onaylı  TAMBUR-M1  09:20         5 geçmiş kurulum ▸        │
└───────────────────────────────────────────────────────────────────────────────┘
┌ Birleştirme önizlemesi — hedef: Tambur-1 Tablet ───────────────────────────────┐
│ [x] Tablet cihaz-1   (07-31 20:26 → 07-31 20:49) güven: yüksek · ardıllık 1 dk    │
│     · 14 iş oturumu YERİNDE KALIR · 1 donanım bağı taşınır · açık oturum yok      │
│ [x] Tablet cihaz-2   …                                                            │
│ [ ] Tablet cihaz-3   güven: düşük · ⚠ ayrı cihaz olabilir (adı "samsun a9")       │
│ Geri alınabilir; taşınan donanım bağları geri taşınmaz.   [Vazgeç] [2 kaydı birleştir] │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 6.4 Tablet: yeniden bağlama bekleniyor + yerinde yönetici onayı (D2)

```
┌──────────────────────────────────────────────────────────────┐
│  Bu tablet daha önce "Tambur-1 Tablet" olarak kayıtlı.        │
│  Yeniden bağlanması için yönetici onayı gerekiyor.            │
│  Panelden onaylanınca bu ekran kendiliğinden kapanır.         │
│           [ Yönetici olarak burada onayla ]                    │
│  ┌ Kullanıcı adı [__________]  Parola [________]  (2FA [____]) │
│  └ [İptal]  [Onayla]   — onay kaydı yöneticinin adına yazılır  │
└──────────────────────────────────────────────────────────────┘
```

## 7 · Dilimler

Ortak koşullar her dilim istemindedir: worktree, test DB, `--create-only`, PR → CI yeşil → merge, Opus high. Büyüklük: S ≤1 gün, M 1–2 gün, L 2–3 gün. Her yeni bekçi negatif sondayla doğrulanır ve **üç dosya birden doğar** (bekçi + `docs/kurallar/<alan>.md` satırı + `Teks-Erp/docs/BEKCI-HARITASI.md`).

### A1 · `print_jobs` + tek yazar + uçlar + toplu damga (backend) — Opus high, L
- **Hedef:** §3.1, §3.2, §3.3 backend, §3.6.
- **Dosyalar:**
  - `Teks-Erp/prisma/schema.prisma` + migration `prisma/migrations/<damga>_print_jobs/` (`--create-only`, `DropForeignKey` satırları silinir, idempotent)
  - YENİ `src/services/print-job.service.ts`, `src/controllers/print-job.controller.ts`, `src/routes/print-job.routes.ts` (+ `app.ts` mount), `src/constants/print-subject-catalog.ts`
  - `src/services/label.service.ts` (`printRollNative`, `testNativeSend`, `recordPrintEvent`, `recordSackPrintEvent`, makine/levent print-event, YENİ `stampRollLabelPrinted` + `recordBulkRollPrintEvent`)
  - `src/routes/label.routes.ts`, `src/controllers/label.controller.ts`
  - `src/services/traveler-card.service.ts`, `src/routes/traveler-card.routes.ts`
  - `src/services/sack-search.service.ts`
  - `src/constants/permission-catalog.ts`, `role-template-catalog.ts`, `screen-catalog.ts`
  - `src/services/system-setting.service.ts` (+ ayar reçetesi yerleri)
  - `src/jobs/maintenance.job.ts`
  - `scripts/lib/defter-beyan.ts`, `scripts/lib/audit-muafiyeti.ts`
  - `scripts/test_db_invariants.ts`
  - `docs/kurallar/belge-etiket.md` (2 kural satırı), `docs/history/arsiv/2026-10.md`
- **Paket:** yok.
- **Bekçiler:**
  - YENİ `scripts/test_print_jobs.ts` (§1 replay dört durum · §2 bilinmeyen tür 400 · §3 kullanıcı token'dan · §4 liste/özet tek where · §5 budama yalnız yaş · §6 SIMULE ≠ ILETILDI · §7 kimlik kartı meta düşer · §8 toplu damga · §9 eski gövdeyle print-event bayt-eşit · §10 AST tek dosya). Sondalar: §4 özet ayrı where, §8 damga kaldırma, §10 başka dosyadan `prisma.printJob`.
  - Ayrıca: `test_telemetri_defter_degil`, `test_defter_ters_yol`, `test_audit_muafiyeti`, `test_permission_catalog`, `test_role_template_catalog`, `test_screen_catalog`, `test_feature_flag_contract`, `test_bakim_isleri`, `test_route_auth_coverage`, `test_route_mount_reachability`, `test_swagger_spec`, `test_schema_drift`, `test_db_invariants`, `test_migration_hygiene`, `test_timestamptz_contract`, `test_traveler_card_stale`, `test_ceki_listesi_no`, `test_label_copies_source`.
- **Kabul:**
  - Eski gövdeyle tablet top etiketi → `ILETILDI` satırı doğar; audit ve `labelPrintedAt` bugünkü gibi davranır.
  - `print-native` simülasyonda → `SIMULE`.
  - Aynı token tek satır bırakır.
  - Toplu uç üç topu damgalar.
- **Risk:** Best-effort yazım iş sonucunu bozmamalıdır (yazım hatası iş yanıtını değiştirmez; sonda). Allowlist tek uçta kalırsa alan kaybolur.
- **Bağımlılık:** yok.

### A2 · Panel basım boğazı + sonuç raporu + sessiz basım (Electron/web) — Opus high, L
- **Hedef:** §3.4.
- **Dosyalar:**
  - `Electron/src/lib/print.ts`, `Electron/src/lib/web-pdf.ts`
  - YENİ Electron:electron/ipc/print.ipc.ts, `Electron/electron/ipc/pdf.ipc.ts`, `Electron/shared/ipc-contract.ts`, preload köprüsü, `Electron/electron/security/trusted-ipc.ts` kapsamı
  - `Electron/src/hooks/useLabelPrinter.ts`
  - YENİ Electron:src/services/printJobService.ts
  - `Electron/src/components/print/BulkRollLabelButton.tsx` (→ `bulk-print-event`)
  - 31 çağrı dosyası (`git grep -l -E "printHtmlString|printDocumentArea" Electron/src`)
  - YENİ Electron:src/pages/GeneralSettings/DocumentPrinterDeviceSettings.tsx + workstation yüzeyi kaydı
- **Paket:** yok.
- **Bekçiler (vitest):**
  - `print-boğaz` AST: boğaz dışı çağrı yasak; sonda: bir dosyada doğrudan çağrı → kırmızı.
  - `print-event-toast.test.ts` genişler.
  - Web → `BELIRSIZ`.
  - Kimlik kartı yükünde içerik yok.
  - `BulkRollLabelButton` başarıda toplu ucu çağırır.
  - `iframe-sandbox.test.ts` yeşil.
  - `settings-surface.test.ts` yeşil.
- **Kabul:**
  - Electron'da iptal → `IPTAL`.
  - Kapalı TCP yazıcı → `HATA` + Türkçe mesaj.
  - Web → `BELIRSIZ`.
  - PDF → `outputKind=PDF`.
  - Sessiz basım kapalıyken diyalog bugünkü gibi açılır.
  - Ekran görüntüsü (Bu Bilgisayar bölümü).
- **Risk:** `webContents.print` sayfa boyutunu değiştirebilir (`@page`, A5/A4). Donmuş belge ve etiket üzerinde önce/sonra PDF'i karşılaştırılarak ölçülür. 31 dosya taşıması mekaniktir ama geniştir.
- **Bağımlılık:** A1 indi.

### A3 · Yazdırma geçmişi sayfası + kayıt bağlantıları — Opus high, M
- **Hedef:** §6.1.
- **Dosyalar:**
  - YENİ `Electron/src/pages/System/PrintHistory/{PrintHistoryPage,PrintHistoryFilters,PrintJobDetailSheet}.tsx`
  - `Electron/src/pages/System/tile-config.ts`, `Electron/src/routes/content-routes.tsx`, `Electron/src/lib/permissions.ts` (`SYSTEM_PRINT_HISTORY_ACCESS`)
  - YENİ Electron:src/lib/print-error-hints.ts
  - top/çuval/sevkiyat/iş emri/belge detaylarına bağlantı
- **Paket:** yok.
- **Bekçiler:**
  - `tile-route-permission.test.ts` (karo ↔ route)
  - vitest süzgeç → sorgu parametresi
  - hata ipucu katalogu ↔ backend `errorCode` listesi eşitliği (sonda: bir kod sil → kırmızı)
  - `test_screen_catalog`
- **Kabul:** Süzgeçler sunucuda çalışır; özet şeridi listeyle tutarlıdır; hata satırı kırmızıdır; kayıttan doğru süzgeçle açılır; web + Electron ekran görüntüsü.
- **Risk:** Düşük.
- **Bağımlılık:** A2 indi.

### A4 · Tablet rapor kuyruğu + `yazici.hata` — Opus high, M
- **Hedef:** §3.5, §3.6 bildirim.
- **Dosyalar:**
  - YENİ mobil:src/services/printJob.service.ts
  - `mobil/src/offline/printQueue.ts`, `mobil/src/components/LabelPrinter.tsx`, `mobil/src/components/labels/{SackLabelPrinter,StandaloneLabelPrinter}.tsx`, `mobil/src/screens/Modules/Devere/WarpBeamLabelPrinter.tsx`, `mobil/src/services/{fasonCekiPrint,workOrderDocuments,printHtml}.ts`
  - (koşullu) `Teks-Erp/src/constants/notification-catalog.ts` + `print-job.service.ts` emit
- **Paket:** yok.
- **Bekçiler:**
  - jest `printJob.service.test.ts` (çevrimdışı birikim → tek token ile boşalma, TTL, tavan; sonda: token her denemede yeniden üretilince mükerrer → kırmızı)
  - `printQueue.test.ts`
  - (koşullu) `test_bildirim_katalogu`
- **Kabul:** BT hatası panelde cihaz adı + MAC ile görünür; çevrimdışı hata bağlantı gelince tek satır düşer.
- **Risk:** Eski tablet hata göndermez (kabul edildi).
- **Bağımlılık:** A1 indi; bildirim parçası N0-KAT + N1-MOTOR'a bağlı.

### B1 · `request_traces` + `X-Request-Id` (backend) — Opus high, M
- **Hedef:** §4.1.
- **Dosyalar:**
  - `schema.prisma` + migration `<damga>_request_traces`
  - `src/lib/request-context.ts`
  - YENİ `src/middlewares/request-trace.middleware.ts`, `src/services/request-trace.service.ts`, `src/constants/request-trace-haric.ts`
  - `src/app.ts` (`:360` sonrası + CORS `exposedHeaders`)
  - `src/services/audit.service.ts` (sayaç)
  - `src/middlewares/latency.middleware.ts` (`normalizeKeyPath` dışa)
  - `src/services/system-setting.service.ts` (`requestTrace.retentionDays`)
  - `src/jobs/maintenance.job.ts`
  - `scripts/lib/{defter-beyan,audit-muafiyeti}.ts`, `scripts/test_db_invariants.ts`
  - `docs/kurallar/defter.md` (1 satır), arşiv
- **Paket:** yok.
- **Bekçiler:**
  - YENİ `scripts/test_request_trace.ts` (yalnız koşullu yazım · gövde/sorgu yok · routeKey'de UUID yok · `X-Request-Id` = audit `requestId` · 409 denemesi `errorCode` ile · dışlama listesi · kova taşması sayaçlı). Sondalar: koşul `true`ya çevrilince GET 200 satır doğar → kırmızı; gövde alanı eklenince → kırmızı.
  - Ayrıca: `test_audit_hash_zinciri`, `test_telemetri_defter_degil`, `test_bakim_isleri`, `test_audit_depth`, `test_latency_persist`, `test_feature_flag_contract`.
- **Kabul:** Sevkiyat onayı tek trace + N audit üretir; 409 trace'te görünür; zincir doğrulaması yeşildir.
- **Risk:** Sıcak yolda `finish` yazımı yapılır. Hacim test DB'de 1.000 istekle ölçülür ve PR'a yazılır.
- **Bağımlılık:** A1 indi (sıra kararı; `defter-beyan`/`maintenance.job` çakışma bölgesi).

### B2 · Anlatıcı çekirdeği + sözlük taşıma (backend) — Opus high, L
- **Hedef:** §4.2, §4.3.
- **Dosyalar:**
  - YENİ `src/services/audit-narrative/{index,sablonlar,yedek}.ts`, `src/constants/{audit-isimler,route-eylem-katalogu,audit-tablo-etiketleri,audit-enum-etiketleri}.ts`, `src/services/helpers/audit-kayit-cozucu.ts`
  - `src/services/system-log.service.ts`, `src/routes/admin.routes.ts` (Zod)
  - `src/services/request-trace.service.ts` (okuma işlevleri)
  - `Electron/src/lib/audit-labels.ts` (ayna, yalnız sözlük)
  - `scripts/lib/audit-okuma-beyan.ts`
  - `docs/kurallar/defter.md` (1 satır)
- **Paket:** yok.
- **Bekçiler:**
  - YENİ `scripts/test_audit_anlati.ts` (her şablonun altın cümlesi · yedekte UUID-yalnız satır yok · kapsama cırcırı iki kollu · yer tutucu ↔ satır alanı · `q` çözümü · islem gruplaması eski/yeni dönem). Sondalar: yedekten numara çözümünü kaldır → kırmızı; cırcır iki sonda.
  - Ayrıca: `test_audit_labels` (ayna genişler), `test_audit_okuma_kaynagi`, `test_terim_eski_ad`, `test_swagger_spec`.
- **Kabul:** En sık 30 çift şablonludur; eski panel `anlati`yı yok sayar.
- **Risk:** ~650 enum satırı taşınır; ayna kayması bekçiyle yakalanır.
- **Bağımlılık:** B1 indi.

### B3 · Panel: İşlemler, Teknik ayrıntı, Geçmiş, arama — Opus high, L
- **Hedef:** §6.2.
- **Dosyalar:**
  - `Electron/src/pages/System/Activity/{ActivityPage,ActivityFeed,ActivityDetailSheet,ActivityFilters}.tsx`
  - YENİ `Electron/src/components/audit/{AuditNarrativeRow,AuditTechnicalDetail}.tsx`
  - `Electron/src/components/RecordHistoryDialog.tsx`
  - `Electron/src/pages/Reports/Audit/{userActivityExport,systemLogSummaryExport}.ts`
  - `Electron/src/services/systemLogService.ts`, `Electron/src/types/systemLog.ts`
- **Paket:** yok.
- **Bekçiler (vitest):**
  - anlatı yoksa eski satıra düşüş
  - Teknik'te gövde alanı yok
  - Geçmiş ↔ Aktivite aynı bileşen (sonda: kopya bileşen → kırmızı)
  - `test_audit_okuma_kaynagi`
- **Kabul:** "Ahmet + Dün" iş eylemi listesi verir; Teknik'te uç/süre/cihaz adı/etkilenen kayıtlar görünür; ⓘ aynı cümleleri basar; `SP-…` araması kayıt ve kardeşlerini getirir; ekran görüntüsü.
- **Risk:** Etkinlik dosyalarına N0-ETK de dokunur.
- **Bağımlılık:** B2 indi **ve N0-ETK indi**.

### B4 · Reddedilenler süzgeci + uç→eylem kapsaması — Opus high, S
- **Hedef:** Aktivite'de "Reddedilenler" (yalnız trace ≥400) + `route-eylem-katalogu` ↔ route envanteri kapsama cırcırı (eksik uç uyarı, çürüme kolu).
- **Dosyalar:** `system-log.service.ts`, `ActivityFilters.tsx`, `scripts/test_audit_anlati.ts §kapsama`.
- **Kabul:** 403/409 denemeleri tek süzgeçle listelenir.
- **Bağımlılık:** B3, A4 indi.

### D1 · Sunucu: donanım özeti + bağlama defteri + yeniden bağlama — Opus high, L
- **Hedef:** §5.2, §5.3, §5.4 uçları, yan bulgular.
- **Dosyalar:**
  - `Teks-Erp/prisma/schema.prisma` + migration `<damga>_cihaz_baglama` (kısmi UNIQUE, CHECK, trigger ham SQL)
  - `src/services/device.service.ts`, `src/controllers/device.controller.ts`, `src/routes/device.routes.ts`
  - `src/middlewares/device.middleware.ts` (`:96` mesajı)
  - YENİ `src/services/helpers/device-identity.helper.ts` (`localId`→cihaz çözümü, `countSeatDevices`; `mergedIntoId` okuyucusu yalnız burada)
  - `src/services/auth.service.ts` (yerinde onay için doğrulayıcının dışa açılması; davranış değişmez)
  - `scripts/lib/defter-beyan.ts`, `scripts/test_db_invariants.ts`, `docs/kurallar/kesif-cihaz.md`, arşiv
- **Paket:** yok.
- **Bekçiler:**
  - YENİ `scripts/test_cihaz_yeniden_baglama.ts`. Sondalar (C-R1 D1 i–v + vi): (i) kısmi UNIQUE kaldırılınca eşzamanlı iki announce iki satır açar · (ii) barındırılanda otomatik bağlama · (iii) kanıt sıfırlanmazsa eski sır geçer · (iv) pasif cihaza otomatik bağlama · (v) `hw`'siz bayt-eşitlik · (vi) yerinde onayda yanlış parola kilit sayacını artırır ve JWT dönmez.
  - Ayrıca: `test_device_pairing_flag`, `test_cihaz_kaniti`, `test_device_assignment`, `test_onaysiz_parola_girisi`, `test_kisa_kimlik_ozet`, `test_route_auth_coverage`, `test_defter_ters_yol`, `test_client_registry`, `test_device_activity`.
- **Kabul:** Bayrak kapalıyken yeniden kurulan tablet aynı satıra döner; barındırılanda talep açılır ve onayla aynı satıra bağlanır; tavan aktif sayımla hesaplanır; PENDING doğuşu audit'tedir.
- **Risk:** Özet uydurulabilir. Bayrak kapalıyken bugünkü otomatik onaydan zayıf değildir; zorunluyken onaya bağlıdır.
- **Bağımlılık:** yok.

### D2 · Tablet: `ANDROID_ID` özeti + bekleme/yerinde onay ekranı + kalıcılık — Opus high, M
- **Hedef:** §5.1 Android, §5.4 tablet, §5.5 madde 1–3, 5.
- **Dosyalar:**
  - YENİ mobil:src/utils/hardwareId.ts
  - `mobil/src/services/device.service.ts`, `mobil/src/utils/deviceId.ts`, `mobil/src/navigation/pairingGate.ts`
  - onay ekranı (`git grep -l pairingGate mobil/src/screens`)
  - `mobil/app.json` (`android.allowBackup:false`), `mobil/scripts/build-apk.mjs`
  - `mobil/package.json` + kilit
  - `docs/standart/KUTUPHANELER-TABLO.md` §2.3 satırı, `docs/ops/PLAY-KONSOL-FORMLARI.md`
- **Paket:** `expo-application` (Expo 54 uyumlu sürüm, `npx expo install`). **Veto listesinde; kullanıcı onayı olmadan PR merge edilmez.** KUTUPHANELER kaydı yazılır: ihtiyaç "kararlı donanım kimliği", reddedilen "yerel Kotlin modülü".
- **Bekçiler (jest):**
  - `hardwareId.test.ts`: özet backend ikiziyle bayt-eşit (sabit vektör `scripts/test_cihaz_yeniden_baglama.ts` ile ortak); `installationId` yoksa `hw` gönderilmez.
  - `pairingGate.test.ts`: `REBIND_PENDING` kapıda; `??` sondası korunur.
  - `deviceId.test.ts`: okuma hatasında yazma yok; sonda.
  - Derleme denetimi manifestte `allowBackup=false` arar.
- **Kabul:** Prova cihazında/emülatörde kaldır-kur sonrası aynı satır (bayrak kapalı) ya da "Tambur-1 Tablet olarak kayıtlı" ekranı (zorunlu); yerinde onay çalışır; ekran görüntüsü.
- **Risk:** Native değişiklik, yeni AAB ister. **Play yayını kullanıcı onayıyla** yapılır; dilim yayın YAPMAZ.
- **Bağımlılık:** D1 indi.

### D3 · Panel: makine kimliği + ezme düzeltmesi + talep yönetimi — Opus high, M
- **Hedef:** §5.1 masaüstü, §5.4 panel, §5.5 madde 4–5.
- **Dosyalar:**
  - YENİ Electron:electron/ipc/machine-id.ipc.ts, `Electron/shared/ipc-contract.ts`, preload, `Electron/electron/security/trusted-ipc.ts`
  - `Electron/src/lib/deviceId.ts`, `Electron/src/hooks/useDeviceAnnounce.ts`
  - `Electron/src/pages/Devices/{DevicesPage,DeviceRow,service}.tsx|ts`, YENİ `RebindRequestsPanel.tsx`
- **Paket:** yok.
- **Bekçiler (vitest):**
  - `machine-id.test.ts` (üç işletim sistemi ayrıştırıcısı)
  - `deviceId.test.ts` (sonda: hata dalında yazma → kırmızı)
  - trusted-ipc kapsaması
- **Kabul:** Panel yeniden kurulunca aynı satıra döner; klon `MachineGuid` talep açar ve "Ayrı cihazdır" yolu çalışır; ekran görüntüsü.
- **Risk:** Klon imajlar.
- **Bağımlılık:** D1 indi.

### D4 · Birleştirme: betik + önizleme + panel + geri alma — Opus high, L
- **Hedef:** §5.6, §6.3 alt yarı.
- **Dosyalar:**
  - YENİ Teks-Erp:scripts/cihaz-birlestir.ts, `src/services/device-merge.service.ts`
  - `src/services/helpers/device-identity.helper.ts`, `src/services/helpers/period-guard.helper.ts` (uzay)
  - `src/routes/device.routes.ts`, `src/services/client-registry.service.ts`, `device.service.ts#detail`
  - YENİ `Electron/src/pages/Devices/{MergeDialog,DuplicateCandidates}.tsx`
  - `docs/kurallar/kesif-cihaz.md`
- **Paket:** yok.
- **Bekçiler:**
  - YENİ `scripts/test_cihaz_birlestirme.ts` (work_sessions sayı/satır önce=sonra · zincir yasağı · açık oturum 409 · eşzamanlı iki birleştirme tek kazanan · undo karşı olay · önizleme her kaydı listeler). Sondalar: `WorkSession` taşıyan sürüm → kırmızı; zincir kontrolü kaldırılınca → kırmızı.
  - Ayrıca: `test_advisory_lock_namespaces`, `test_defter_ters_yol`, `test_script_guards` (betik dry-run).
- **Kabul:** Sentetik Tambur zinciri fixture'ı (6 satır) tek kayda iner; rapor sayıları değişmez; kayıt kayıt seçim çalışır; ekran görüntüsü.
- **Risk:** Sezgi yanlış pozitif üretebilir; yalnız insan onayıyla uygulanır.
- **Bağımlılık:** D1 + D3 indi.

### D5 · Halka kaybı görünürlüğü + toplu yeniden bağlama + kurallar — Opus high, M
- **Hedef:** §5.7, §5.5 kural satırları.
- **Dosyalar:**
  - `Teks-Erp/src/lib/short-credential/keyring.ts` (kayıp tespiti), `src/middlewares/device.middleware.ts` (sayaç), `device.service.ts` (`PROOF_RESET` + hw şartlı yeniden sır)
  - sağlık ucu, panel bandı + Electron:src/pages/Devices/ProofLostPanel.tsx
  - (koşullu) `notification-catalog.ts` `cihaz.halka-kaybi`
  - `docs/kurallar/{kesif-cihaz,surum-yayin,superadmin}.md`, arşiv
- **Paket:** yok.
- **Bekçiler:**
  - `test_cihaz_kaniti §halka-kaybi`. Sondalar: sessiz üretim (iz varken audit/sağlık yok) → kırmızı; hw uyuşmayan cihaza yeniden sır → kırmızı.
  - Ayrıca: `test_kisa_kimlik_ozet`, `test_kimlik_totp_sifreleme`, `test_sistem_hesabi_muhru`.
- **Kabul:** Halka dosyası silinmiş prova kurulumunda bant + önizleme + toplu yeniden bağlama çalışır; ilk kurulum bugünkü gibidir.
- **Risk:** PIN/kart/TOTP akışına dokunur.
- **Bağımlılık:** D1, D3 indi.

### 7.1 Dalga planı (≤3 paralel)

| Dalga | Dilimler | Not |
|---|---|---|
| 1 | **A1** · **D1** | İkisi de migration'lıdır. İniş sırası A1 → D1; ikinci dilim `git merge origin/main` yapar. |
| 2 | **B1** · **A2** · **D3** | B1 A1'den sonra (K-B3). |
| 3 | **B2** · **A3** · **D2** | D2 yeni AAB'yi hazırlar; yayın kullanıcı onayıyla. |
| 4 | **B3** · **D4** | B3 N0-ETK inmeden başlamaz; inmemişse dalga D4 ile tek koşar. |
| 5 | **A4** · **D5** | Bildirim parçaları katalog varsa yapılır. |
| 6 | **B4** | İsteğe bağlı. |

**Sürüm:** Backend dilimleri (A1, B1, B2, D1, D4, D5 backend yarısı) tek backend sürümünde toplanabilir. Panel A2/A3/B3/D3/D4 ayrı panel sürümüdür. Tablet D2 (+A4) tek AAB'dir. Sürüm commit'leri ve notları 1e'nindir.

### 7.2 Çakışma bölgeleri

- **Şema/beyan:** `schema.prisma`, `scripts/lib/defter-beyan.ts`, `scripts/lib/audit-muafiyeti.ts`, `scripts/test_db_invariants.ts`, `src/jobs/maintenance.job.ts`, `src/services/system-setting.service.ts` (A1, B1, D1). Ayrı bloklara eklenir; çatışma `git merge origin/main` ile çözülür.
- **Bildirim:** `Electron/src/pages/System/Activity/*`, `Topbar.tsx`, `audit-okuma-beyan.ts` (B3 ↔ N0-ETK/N1-PANEL); `notification-catalog.ts` (A4/D5 ↔ N0-KAT).
- **Belge/basım yolu:** `Electron/src/lib/print.ts`, `print-merge.ts`, `PrintedDocToolbar`, `useLabelPrinter.ts`, `label.service.ts` print-event bölgesi (A1/A2 ↔ belge şablonu tasarımcısı planı ve etiket adedi işleri).
- **Electron IPC sözleşmesi:** `Electron/shared/ipc-contract.ts` + preload (A2 ↔ D3, aynı dalga). Ayrı anahtar adları kullanılır; ikinci inen merge eder.
- **Cihaz:** `device.service.ts`, `device.routes.ts` (D1 → D4 → D5 sıralı); `Electron/src/pages/Devices/*` (D3 → D4 → D5).
- **Arşiv:** `docs/history/arsiv/2026-10.md` (her dilim kendi başlığını dosya SONUNA ekler).

## 8 · Riskler ve geri alma

| Risk | Önlem / geri alma |
|---|---|
| Telemetri yazımı iş yanıtını bozar | `recordPrintJob`/`recordTrace` tx dışında ve yutucu çalışır; sonda: yazım hatası iş yanıtını değiştirmez. Geri alma: çağrı satırı kaldırılır, tablo kalır (ekleme migration'ı). |
| `request_traces` hacmi | Koşullu yazım, kova, 90 gün. Ölçüm B1 PR'ındadır; gerekirse dışlama listesi büyür. |
| `webContents.print` belge düzenini değiştirir | Önce/sonra PDF karşılaştırması A2 kabulündedir. Sessiz basım varsayılan kapalıdır. |
| Anlatı yanlış cümle kurar | Ham veri ve Teknik ayrıntı her zaman yanındadır. Şablon kodda olduğu için düzeltme sürümle geçmişi de düzeltir (anlatı saklanmaz). |
| Özet uydurmayla başka cihaza bağlanma | Bayrak kapalıyken bugünkü otomatik onay düzeyindedir; zorunluyken onaya bağlıdır. Pasif cihaza otomatik bağlama yoktur. |
| Yanlış birleştirme | Otomatik değildir. Önizleme + kayıt kayıt seçim + `UNMERGED` geri alma. Defter/ayak izi taşınmadığı için rapor değişmez. |
| `ANDROID_ID` mühürle değişir | Tek seferlik elle birleştirme (fabrikada yönetici). |
| Halka davranışı PIN/TOTP'yi etkiler | D5'te üç kimlik bekçisi zorunludur; ilk kurulum yolu bayt-eşit kalır. |
| Migration'lar | Hepsi eklemelidir, en eski canlı dumpta provadan geçer. Geri alma yeni migration'la yapılır; hiçbiri veri silmez. |

## 9 · Veto listesi (kullanıcı)

1. **`expo-application`** mobil doğrudan bağımlılığı (D2). Alternatif: yerel Kotlin modülü, paket yok.
2. **Tablet Play paketi yayını** (D2 [+A4]): AAB hazırlanır, **yükleme/yayın kullanıcı onayıyla**. Veri Güvenliği formu güncellenir.
3. **Fabrikada birleştirme yöneticidedir:** Betik ve panel hazır olur; Adnan Şahin kurulumunda birleştirmeyi biz koşmayız, deneme sunucusuna yalnız salt okuma.
4. §2 K-C5 okuması: halka kaybında üretim **görünür** sürer. "Hiç üretme" istenirse D5 değişir.
5. `system:print-history` varsayılan rol ataması (Süpervizör + Sevkiyat sorumlusu). İzin kataloğu koddadır, atama panelde değiştirilebilir.
6. Yerinde yönetici onayı kapısının `admin:settings` olması (ayrı `device:approve` izni açılmadı).
