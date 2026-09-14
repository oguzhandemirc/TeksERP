# Backend `2.10.0`

**Paket:** _(paketleme doldurur)_
**SHA256:** _(paketleme doldurur)_
**Commit:** _(paketleme doldurur)_
**Önceki saha sürümü:** **2.9.8** (etiket `backend-v2.9.8` = `97d891c2`, 2026-09-07;
kurulum 2026-09-07 07:51). **2.9.9 hiç sahaya çıkmadı** — bu belgenin ilk hâli o
numarayla yazılmıştı (`7910da55`); o sekiz düzeltme aşağıda §2'nin ilk bölümüdür,
ayrı belge yaşamaz. Küçük hane ELLE artırıldı (yönetici oturum hükmü, 2026-09-13):
yama = düzeltme, küçük hane = yeni yetenek; bu turda yeni tablolar, yeni enum
değerleri, yeni uçlar ve 42 migration var — 2.9.9 bunu bir yama gibi gösterirdi.
Paketleme anında: `node scripts/backend-surum.mjs --surum 2.10.0 --uygula`
(`package.json`a ŞİMDİ dokunulmadı).

## 1. Özet

Stok defteri artık üretim, fason, kartela, transfer, kesim, sayım ve elle düzeltme
hareketlerinin hepsini bağlı ters kayıtlarıyla tutuyor; on bir "yanlış işlem"
yolu geri alınabilir oldu (çek, sayım, kartela düşümü, toplu aktarım, fason kabulü,
tahsilat kapaması…); sipariş kalemine birim geldi; dokuma alanının şeması ve yazma
yüzeyi (dokuma işi · tezgah koşumu · duruş · doff · çözgü kartı) indi — ekranı
henüz yok, bayrağı kapalı. Panel 1.3.2 / tablet 1.0.7 ile AYNI turda çıkar.

Ölçüm (git, `backend-v2.9.8..HEAD`, 2026-09-13 23:48): backend'e dokunan **323**
commit (tümü 543) · **42** yeni migration (toplam 280) · **19** yeni model ·
**13** yeni enum · mevcut 5 enum'a **15** yeni değer · **4** yeni route dosyası
(+35 uç, kaldırılan 0) · **8** yeni izin kodu (kaldırılan 0) · **1** yeni modül
anahtarı (`devere.enabled`, KAPALI doğar).

## 2. Ne değişti

### 2a. Saha turu düzeltmeleri (eski "2.9.9" içeriği, 2026-09-07 → 09-10)

- `b18af0d0` — muhasebe sevk fişi Excel'i ad rejimini uyguluyor (`docNameMode`
  alanı fiş ucuna girdi; karar tek helper `resolveDocNameMode`).
- `90d7c482` — `POST /printed-documents/:docType/sample-html` izni
  `admin:settings` → `DOCUMENT_DESIGN_READ` (GENİŞLEDİ; kimse yetki kaybetmez).
- `7693cfa8` — mobil etiket "Bas" audit izi (`LABEL_PRINTED`) düşmüyordu.
- `a55ab875` — kapanış 5 sn'yi doldurunca hangi fazda takıldığını log'a yazıyor.
- `4d1a2ebf` — süreç uyarıları yığın iziyle log'a (pg DeprecationWarning teşhisi).
- `d508bb60` — `kur.ps1` `[5/9]` dosya kilidi yarışı: taşıma 5 kez ısrar ediyor.
- `7b84d5ea` — offsite hedefi göreli yazılınca sessiz yerel kopya (K-1) · "Otomatik
  yedek saati" ölü kumanda (O-1, `GET /backups.scheduleEnabled`) · `[offsite]`
  açılış yanlış alarmı kalktı.
- `3bc2c092` — yedekte PostgreSQL istemci↔sunucu sürüm kapısı ÜÇ sonuçlu
  (uyumlu / uyumsuz / ölçülemedi); `3460dba7` bu kapının karşılıklı dışlamayı
  kırdığı hatayı düzeltir.

### 2b. Stok defteri (WarehouseMovement) — tam kapsam

- `f8423048` — altyapı: taşıyıcı kolonlar (`from/to` uç, `reversesMovementId`,
  `transformGroupId`), DB seddi (CHECK ×2, `20260912150200/150300`), tek yazım kapısı.
- `WarehouseEventType` +6: `PRODUCTION` · `EXTERNAL` · `TRANSFORM` · `ADJUST` ·
  `OPENING_BALANCE` · `CANCEL_REVERSAL` (`20260912150100`).
- Deftere bağlanan yollar: üretimden depoya giriş (`15410b07`), tambur finalize
  çocuğu (`bb709bd9`), üretime alma çıkışı (`0963d3d7`), iş emrinden çıkarma
  (`d4c07035`), adım yeniden açma (`b67ed2e7`), tambur geri alma tersi (`7f8e432a`),
  iptal/iptal geri alma (`3c15208c`), iade + tersi (`ac428cd3`), sevk + storno
  (`d78bbd22`), fason kabul (`d07248e8`), fason sevk (`463efd03`) ve iptali
  (`510081bf`), fason kabul ters yolu (`b27ac459`), transfer ×2 (`3c9caf7c`),
  kartela ×2 (`572b2594`), kesim = TRANSFORM çift satır (`40a7f10a`) ve geri
  alınışı (`c2a10e88`), sayım stornosu (`1985f63c`, kanıt yoksa 409 `6c8c0cb5`),
  elle metraj düzeltmesi `MANUAL_ADJUST` (`fd33f205`), raftan üretime giren üç
  satırsız yol (`75b1eb0d`).
- Deposuz top: stok kümesinden çıkan yol deposuz topta 409 (`e765c832`); on terfi
  yolu ve dispozisyon motoru depo damgalıyor (`dd68039d` `9837222a` `73b31e8b`);
  varsayılan depo bulunamazsa işlem durur, barkodları sayar; deploy günlüğü
  deposuz sayısını UYARIR, veri yazmaz (`5d85db5f`, `20260913120000_deposuz_…`).
- `20260912190000_rolls_qty_le_initial_validate` — `rolls_qty_le_initial` KOŞULLU
  doğrulanır: ihlal satırı yoksa `VALIDATE`, varsa `NOT VALID` kalır ve deploy
  DÜŞMEZ (`249d8681`; canlıda iki ihlal satırı olduğu ölçülmüştü).
- `scripts/consistency-check.sql` §29 "stok kümesinde deposuz top" eklendi.

### 2c. Geri alınabilir işlemler (defter-öncelikli doktrin, hard delete kalktı)

- Çek: `BOUNCE/RETURN/ENDORSE/PAY` tipli storno (`2532fdca`; `ChequeEventType` +4,
  `CariTxnSource` +3; route `cheque-reversal.routes.ts`).
- Stok sayımı stornosu (`88ebf3bb` → `fbb67de8` → `6c8c0cb5`; `StockCount` ters
  yolu `20260912100100`).
- Kartela düşümü geri alınır, silinmez (`6844d714`; `SwatchStockReductionItem`).
- Toplu aktarım geri sarma: `ImportRunLine` defteri + atomik claim (`ac474d10`
  `c2431cb0`; `ImportLineAction` enum).
- Master-data birleştirme geri alınabilir (`03d7b9b2` `7cdc5295`; `MergeOperation`
  ×3 model, `GET /merges`).
- Tahsilat kapaması `revokedAt` damgalar (`ec594c63`); top operasyon/hareket izi
  damgalanır, silinmez (`c45f8b28` `c2c6cdbd`); sevk damgası geri almada
  silinmez, `ShipmentEvent` + `SackWeighing` olay defterleri (`af0f09ff`).
- Plan sapması onayı geri almada damgalanır, karne yalnız yürürlükteki onayı sayar
  (`4b666d33`, `20260913160000`).
- Fason kabulü iptal edilebilir (`b27ac459`); fasondan doğrudan sevk kaydı olan
  fason sevki iptal EDİLEMEZ, hangi kayıt yüzünden olduğunu söyler (`f54e1b03` `fb0ad67e`).
- İstasyon/makine kalıcı silme çalışma-oturumu geçmişiyle ENGELLENİR (`bde1d57e`).

### 2d. Sipariş · kalite · cari

- `OrderLine.unit` (`b334a09e`, `20260913020000`): `MT` varsayılanıyla eklenir,
  `items.unit`ten backfill; MT-dışı satırda karşılama ölçülmez, sipariş kendiliğinden
  kapanmaz; metre Σ talep KG/ADET kalemi görmez (`26721839`). Fatura satırında
  birim ZORUNLU (`79a3241b` — bkz. §3).
- `QualityGrade.role` (`c599bfdf` `f6a7d0c5`; enum `QualityGradeRole`): "1. kalite"
  koddan değil rolden çözülür; `QualityGrade.skipCustomerName` (`3e8087ae`).
- `Customer.defaultDestination` (`d5668ac1`, `20260913140000`) — varsayılan, kilit değil.
- Toplu sipariş şablonuna "Birim" sütunu (`7b8fad3c`).
- Fason kısmi doğrudan sevk `initialQty` düşürmüyor; sarf kalemi top doğurmuyor
  (`5980ff06`); fasoncu karnesi müşteriye giden metreyi teslim sayıyor (`94b00d40`).

### 2e. Dokuma alanı — şema + yazma yüzeyi, EKRANSIZ

- Modeller: `WeavingOrder` (`77b69da9` `1677bc87`, XOR CHECK `836e2ade`),
  `MachineRun` (`c07396e6`, koşum aç/kapa/geri al `71c6acbe` `f43ad746`),
  `MachineStopEvent` + `MachineStopReclass` + `ShiftDefinition/Instance` +
  `MachineCollector(Link)` (`d4cc3ea0` `bd830f32`), `DoffEvent` + `Roll.doffEventId`
  + `RollEntrySource.WEAVING` (`44b34d23` `20fb880d` `a218f68c`), `MachineSpec`
  (`91011a63`), `Machine.productionLineCount` (`397a99f1`), `WarpSpec` (devere,
  `e62d8ea7` `aa8cb8a1` `e57efdc1`).
- Uçlar: `/api/weaving-orders` · `/api/machine-runs` · `/api/machine-doffs` ·
  `/api/warp-specs`. İzinler: `weavingorder:read/write` · `loom:run/run-revoke` ·
  `loom:doff/doff-revoke` · `warpspec:read/write` (uzlaştırma boot'ta kataloğa
  girer, ATAMAZ; `d927ab01` `warpspec:*` kodlarını sistem rol ŞABLONLARINA ekledi —
  `role-template-catalog.ts`, boot uzlaştırması "yalnız ekle": var olan şablona eksik
  izni ekler, kullanıcıya/mevcut role atama YAZMAZ, izin çıkarmaz; ölçüldü 2026-09-14).
- `ReasonPresetKind.MACHINE_STOP` + 23 sebep kaydı boot uzlaştırmasıyla doğar.
- Modül anahtarı `devere.enabled` KAPALI doğar (`90c17cca` `2e0145a2`); kapalıyken
  çözgü uçları 403 `MODULE_DISABLED`. Dokuma ekranı ve bayrağı ayrı dilim (9b).

### 2f. Diğer

- Paketleme grubu (`PackingGroup`, `4c005cf5` `8df57256` `8feb4956`; ayar KAPALI
  doğar) · sevk irsaliyesi liste sayfalarına kimlik şeridi (`1af0cfd8`, KAPALI
  doğar) · künyesini bildirmeyen istemci envanterde (`258b4509`) · cihaz birimi
  seçici + gerçekçilik eşiği (`4e716d91`) · sistem olayı adları beyan edilmiş
  birlik, 7 etiket (`595208b7`) · `kur.ps1` ve `paketle.ps1` sürüm belgesi kapısı
  (`7910da55` `df1cf64d`) · üretim kodunda tanımlayıcılar İngilizce (`5c668a9e`,
  davranış değişmedi).

**`dist-web` DEĞİŞTİ.** Panel kaynağı bu turda geniş çapta değişti (1.3.1 → 1.3.2);
web arayüzü paketi yeniden derlenir. Patron modülünü kullanan kurulumlarda arayüz
güncellenir.

## 3. Sözleşme

- **Kırıldı mı:** **EVET — bir noktada, panel için.** `WarehouseEventType`e altı
  yeni değer girdi ve **1.3.1 panelin Depo Hareketleri ekranı tanımadığı türde boş
  sayfaya düşer** (1.3.2'nin kendi sürüm notu bu kusuru söylüyor; ölçüldü
  2026-09-13). Yeni backend'in ilk üretim/fason/kesim hareketinden itibaren o
  ekran eski panelde açılmaz. ⇒ **backend + panel 1.3.2 AYNI PENCEREDE** — panel
  güncellemesi dakikalar içinde kendiliğinden iner (15 dk kontrol, zorunlu
  güncelleme şeridi), ama pencere bilerek kısa tutulur.
- **Eski istemci ne yapar (altı tetik):**
  - *Uç kaldırma:* YOK (35 uç eklendi, 0 kalktı).
  - *Alan adı:* YOK; kaldırılan kolon YOK (`PeripheralDevice.unit` DURUYOR —
    memory'deki "önce tolerans, sonra düşür" sırası bu turda konu değil).
  - *Tip/birim:* `OrderLine.unit` EKLEME; eski tablet 1.0.6 kg/adet kalemi "m"
    etiketiyle gösterir, rakam doğrudur. Fatura satırında `unit` artık ZORUNLU
    (`min(1)`); 1.3.1 panel varsayılan `"m"` gönderir, yalnız kutu elle boşaltılırsa
    400 "Satır birimi gerekli." alır — mesaj ekranda görünür, kilitlenmez.
  - *Zorunlu parametre:* yukarıdaki `unit` dışında YOK.
  - *Enum:* `WarehouseEventType` +6 (panel: yukarıdaki kırılma) · `RollEntrySource.
    WEAVING` (yazan istemci 0 — Electron/mobil'de doff çağrısı yok ⇒ sahada
    WEAVING'li top doğmaz; eski tablet zaten `PURCHASE_RECEIPT`/`SEMI_FINISHED`i
    tanımadan çalışıyor) · `ChequeEventType`/`CariTxnSource` `*_CANCEL` (yalnız
    yeni uçlar yazar) · `ReasonPresetKind.MACHINE_STOP` (eski istemci listeyi
    süzer, yeni kind'ı görmez).
  - *İzin:* 8 yeni kod, 0 kalkan, 1 genişleyen (`sample-html`). Kimse yetki kaybetmez.
- **`minVersion` dokunuldu mu:** **HAYIR.** Panel için 1.3.2 eşiği ancak 1.3.2
  SAHADAYKEN konabilir (sahadakinden büyük olamaz) — **sonraki tur adayı**; tablet
  için gerekçe yok.
- **Tablet gecikebilir:** 1.0.6 tabletin yeni backend'de tek görünür farkı "m"
  etiketi; fason kabul iptali yeni uç, eski tablet çağırmaz.

## 4. Migration

- **Var mı:** **EVET — 42 adet** (`20260910120000_paketleme_grubu` …
  `20260913252000_roll_variance_source_roll`).
- **Toplam migration:** **280** (2.9.8'de 238). Kuran `[7/9]`da **42 migration
  uygulandığını** görmelidir; "No pending migrations" görürse yanlış paket ya da
  yanlış DB'dir → DUR.
- **Koşullu olanlar (deploy'u DÜŞÜRMEZ, günlüğe yazar):**
  `20260912190000_rolls_qty_le_initial_validate` (ihlal varsa `NOT VALID` kalır,
  NOTICE basar) · `20260913020000_order_line_unit` (MT-dışı ve `shippedQty>0`
  satır sayısını NOTICE basar, rakama DOKUNMAZ) · `20260913120000_deposuz_stok_
  topu_uyarisi` (deposuz top sayısını NOTICE basar, veri yazmaz).
  **Bu üç NOTICE satırı kurulum raporuna AYNEN kopyalanır** (§7).
- **Geri alınabilir mi:** HAYIR — bu depoda migration geri alınamaz; rollback =
  yedekten restore. 42 migration'ın ilki geçtikten sonra `kur.ps1 -GeriAl` KOD'u
  geri alır, ŞEMAYI geri almaz.
- **Şema provası bu belge yazılırken KOŞULMADI.** Kural: paketten önce en eski
  canlı dump'ta `restore → migrate deploy → bekçiler → profil boot`; sonucu
  (42/42 · üç NOTICE) paketleyen buraya yazar. Kuran provayı tekrar koşmaz, yalnız
  `[7/9]` çıktısını raporlar.

## 5. Kurulum notu

- **Beklenen kesinti:** ölçülmedi — 2.9.8'de 23 sn + 42 migration. Migration'lar
  ADD COLUMN / CREATE TABLE / CHECK ağırlıklı, tek uzun tarama `rolls_qty_le_initial`
  VALIDATE'i (tablo boyutuyla orantılı). ~1 dk planla.
- **Sıra:** **backend ÖNCE, panel 1.3.2 hemen ardından AYNI PENCEREDE** (§3). Tablet
  1.0.7 OTA sonra, gecikebilir. Paketleme anında tablet kanalı `npm run
  yayinla:check -- --musteri=…` ile kesinleşir (native değişiklik ölçüldü: 0).
- **Bu sürüme özel:**
  - `paketle.ps1` bu belgeyi arar (`docs/surumler/backend-2.10.0.md`); dosya adı
    ve başlık sürümü tutmalı. `package.json` sürümü paketleme anında
    `backend-surum.mjs --surum 2.10.0 --uygula` ile yazılır, etiket `backend-v2.10.0`.
  - Boot uzlaştırmaları bu turda ÇOK: izin kataloğu (+8), sebep kataloğu
    (+23 `MACHINE_STOP`), sistem olayı etiketleri, modül profili (`devere` kapalı).
    İlk açılış log'unda bu uzlaştırma satırları BEKLENİR; hata değildir.
  - Deposuz top NOTICE'i 0 değilse: **kurulum durmaz**, ama ilk sevk/iade 409
    verir. Onarım `scripts/backfill_roll_warehouse.ts` (dry-run varsayılan,
    `--apply` ÜRETİMDE KULLANICI KARARI — kurulumun adımı DEĞİLDİR).
  - Aynı sınıfta bekleyen onarım script'leri (hepsi dry-run varsayılan, hepsi
    `--apply`da iz bırakır): `acilis_fotografi_stok_defteri.ts` (OPENING_BALANCE),
    `fix_fason_directship_initialqty.ts`, `fix_tambur_undo_full_asim.ts`,
    `onarim_fason_donus_entry.ts`. Hiçbiri bu kurulumda koşmaz.
  - `kur.ps1` içindeki `[5/9]` düzeltmesi (`d508bb60`) bu pakette; paketin içindeki
    `kur.ps1` ile yanına konan gevşek `kur.ps1` AYNI olmalı, SHA256 karşılaştırılmadan
    kurulum başlatılmaz.
- **Sınırlar (her sürümde geçerli):** `migrate reset`/reseed/DB drop YOK ·
  uygulanmış migration'a dokunma · postgres/node süreçlerini `Stop-Process` ile
  durdurma · `C:\Etkili-Yazilim` ve junction'lara dokunma (`C:\TeksERP\pgsql\bin`
  oraya bakan bir junction, pm2 daemon ikilisi de orada) · `-GeriAl` ile `-Zorla`
  birlikte KULLANMA · başarısız kurulumu TEKRAR DENEME ·
  **`[7/9]` eşiğinden sonra herhangi bir hata → DUR, düzeltme, insana rapor et**

## 6. Geri alma

`C:\TeksERP\kur.ps1 -GeriAl`. Eşik ÖNCESİ hata: script kendini toplar,
`app.eski-*` oluşmaz, mevcut kurulum yeniden başlar. Eşik SONRASI (`[7/9]`
migration'ların herhangi biri uygulandıysa): **kod geri alınsa da şema 2.10.0'da
kalır ve 2.9.8 kodu yeni CHECK/kolonlarla ÇALIŞMAYABİLİR** → yedekten restore.
Yedek `[3/9]`da alınır (`premigrate_*`); raporda yedek dosyası ve boyutu yazılır.

## 7. Doğrulama — kurulumdan sonra rapor edilecekler

- yeni sürüm + `pm2 list` (online mı, restart sayısı)
- `/health` (api + db + version = 2.10.0) — `/api/admin/health` kimlik ister, `/health` yeter
- `[7/9]` satırı: **42 migration uygulandı** mı; **üç NOTICE satırı aynen** (MT-dışı
  sevkli satır sayısı · deposuz top sayısı · `rolls_qty_le_initial` doğrulandı mı /
  `NOT VALID` mi kaldı)
- `backend-err.log` son 30 satır — yeni hata var mı; açılış log'unda uzlaştırma
  satırları (izin +8 · sebep +23 · `devere` kapalı)
- panel 1.3.2 indi mi: bir makinede Sistem → Bağlı İstemciler'de sürüm sütunu;
  1.3.1 kalan makine varsa Depo Hareketleri ekranı o makinede açılmaz (§3)
- Depolar → bir depo → Hareketler: yeni türlü bir satır (üretim/fason) düzgün çiziliyor mu
- `[offsite]` açılış uyarısı ÇIKMAMALI; çıkıyorsa hedef gerçekten tanımsızdır
- ölçülen kesinti (bu sürüm için ilk ölçüm — bir sonraki belgeye taban olur)
