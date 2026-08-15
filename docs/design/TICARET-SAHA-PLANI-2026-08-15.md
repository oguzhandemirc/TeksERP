# Ticaret Dalı — Saha Test Notları Çözüm Planı (2026-08-15)

Kullanıcının 12 test notu + aynı sınıftaki benzer sorunların taraması. Karar
ölçütü (kullanıcı talimatı): **yazılım sektör standartlarında, tüm perde/tekstil
endüstrisine dağıtılacak** — kararlar buna göre otonom verildi ve gerekçeleri
yazıldı; itiraz edilen karar tek satırla geri çevrilebilir.

## A) HATA — hemen düzeltilecek

### A1. "Ağırlık (kg) girişi bu istasyonda kapalı" — 10 satır reddi ✅KÖK BULUNDU
`inventory.service.ts:763`: KK1 İSTASYON politikası olan `kk1.weightEntryEnabled`
bayrağı (varsayılan KAPALI) tek choke-point `createInitialEntry`de koşuyor ve
Mal Kabul yolu `weightKg`'yi geçirdiği için (goods-receipt.service:871) kg'li
her satır KK1 mesajıyla reddediliyor. **Karar:** bayrak KK1 istasyonuna aittir;
mal kabul yolu açık gerekçeli muafiyet alır (F221 `opts` deseni — çağıran
politikayı bilerek kapatır), mesaj da bağlam taşır. Sektör: mal kabulde kg
girişi standarttır (kumaş kg+metre çift birim), istasyon politikasıyla
kapılanamaz. + bekçi (negatif sonda: muafiyet düşünce GR satırı reddedilir).

## B) HIZLI KAZANIMLAR (bu gece kodlanacak)

### B1. Ham enum gösterimleri Türkçeleştirme
Kanıt: `GoodsReceiptDetailSheet.tsx:177` → `{roll.status}` ham "WAREHOUSE".
Sözlük zaten var (`rollStatusLabels`). Tarama aynı sınıfı diğer yüzeylerde de
arayacak (fişte PO durumu etiketli, roll.status etiketsiz — asimetri).

### B2. "Alış Faturası Oluştur" → taslak OTOMATİK açılır
Bugün yalnız toast (`GoodsReceiptDetailSheet.tsx:45-52`). Bu gece yazılan
`InvoiceDetailDialog` (f9ca516b) doğan id ile açılır. Sektör: belge üreten
eylem belgeyi gösterir.

### B3. Fatura taslak görüntüleme — ✅ BU GECE KAPANDI
`f9ca516b` + `e2cee460`: her satırda göz düğmesi, her statüde detay diyaloğu
(satırlar + kapamalar + kaynak bağları). Not kapandı sayılır.

### B4. Tahsilat/Ödeme ekranına filtreler
`PaymentsPage.tsx` filtresiz (ölçüldü: 0). Eklenecek: yön (IN/OUT) · cari ·
yöntem · durum (İptaller) · tarih aralığı. Mevcut Finance filtre desenleri
(Faturalar sayfası + CashBookFilterBar) emsal.

### B5. Mal kabul sonrası "nereye düştü" görünürlüğü
Toplar `WAREHOUSE` statüsüyle doğar → Envanter'de **Bitmiş Depo** sekmesi,
`updatedAt desc` ile EN ÜSTTE (davranış doğru; beklenti "yeni giren" diye ayrı
bir yer arıyor). **Karar:** yeni kavram/sekme AÇILMAZ (ikinci "yeni girenler"
listesi, mevcut sekme sözleşmesiyle yarışır); başarı geri bildirimi
zenginleştirilir: fiş kaydında/faturada toast + detay sheet zaten dökümü
gösteriyor; Envanter yönlendirme metni eklenir. (C2 kabul edilirse "Ham stok
olarak al" seçeneği hangi sekmeye düştüğünü de değiştirir — metin dinamik.)

## C) ÖZELLİKLER (bu gece sırayla; büyükten önce küçük)

### C1. Sipariş birim fiyatı → fatura ön-dolumu (çifte giriş biter)
Kanıt: `OrderLine.unitPrice` şemada VAR ("for future finance module") ama fatura
ön-dolum zinciri (D2: satır > müşteri istisnası > kart) onu HİÇ okumuyor.
**Karar (sektör):** sipariş fiyatı SÖZLEŞME fiyatıdır ve zincirin EN ÖNÜNE
girer: sevkiyattan taslak (otomatik kanca + panel diyaloğu) sevkiyatın bağlı
sipariş kalemlerinden ürün başına fiyat çözer — TEK tutarlı fiyat varsa onu
kullanır; aynı ürüne FARKLI sipariş fiyatları düşüyorsa UYDURMAZ (ortalama
yasak), D2'ye düşer ve satır notunda söyler. Sipariş tarafı fiyatsızsa D2.
GR→alış faturası tarafında PO fiyatı zaten `fillLinesFromOrder` ile akıyor.

### C2. Mal kabulde "ham mı bitmiş mi" işareti
**Karar (sektör):** ürün niteliği ürün kartındadır; topun RAF durumu ise
statüdür. Perde/tekstil ticaretinde iki meşru alım var: satılacak BİTMİŞ mal
(bugünkü tek yol: `WAREHOUSE`) ve işlenmek üzere alınan HAM mal (fasona
gidecek → `STOCK`). Fiş SEVİYESİNDE `targetShelf: WAREHOUSE|STOCK` seçeneği
(varsayılan WAREHOUSE — bugünkü davranış bayt-bayt) eklenir; satır seviyesi
AÇILMAZ (karışık fiş, "fiş bir kaptır" okumasını bozar; ikinci fiş açılır).
`createInitialEntry` zaten statü hedefini opts ile alabiliyor — küçük dikiş.

### C3. Hızlı ürün/renk ekleme (mal kabul formunda)
Picker'da sonuç yoksa "➕ Yeni ürün/renk tanımla" — mevcut Tanımlar
diyaloglarının ince sarmalayıcısı, kayıt sonrası seçili gelir. Emsal: rota
adımındaki "yeni özellik tanımla" (bağlamdan bilir, bağlı doğar). Zorunlu alan
azlığı ticaret personasında kabul edilebilir (kod türetiliyor — BaseService
autoCode).

### C4. Tedarikçi = fason birleşimi (en büyük parça)
Kanıt: `GoodsReceipt.supplierId → Customer` (şema: "ayrı tedarikçi modeli
açılmadı"); fasonlar `Subcontractor` tablosunda → mal kabul/alış siparişi fason
firmadan YAPILAMIYOR. Oysa fatura/tahsilat/cari katman İKİSİNİ de destekliyor
(CariAccount customerId XOR subcontractorId). **Karar (sektör):** alış HER
cariden yapılabilir (Logo/Mikro/SAP BP standardı). Tam BP birleşmesi (tek cari
tablosu) AYRI ve büyük bir iştir (cari-kart-birlestirme kararı: ileride);
bu gece köprü kurulur: `GoodsReceipt.subcontractorId?` + `PurchaseOrder.
subcontractorId?` (XOR guard; nullable → metadata-only migration), tedarikçi
seçici İKİ kaynaktan birleşik arar, GR→alış faturası fason tarafında
`invoice.subcontractorId` ile doğar (fatura katmanı hazır). Fabrika sıfır-fark:
yeni kolonlar fabrika yollarında hiç yazılmaz.

### C5. Sipariş/sevkiyat sonrası adım rehberi
**Karar (sektör):** tam otomasyon DEĞİL "öneri veren yarı-otomatik" (kullanıcı
sorusundaki ikinci şık; SAP/Logo'da da belge zinciri önerilir, kesilmez).
Zaten kurulanlar: sevk→fatura taslağı (`finance.autoDraftFromShipmentEnabled`),
tahsilatta FIFO kapama (`finance.autoAllocateOnPaymentEnabled`), fiş→alış
taslağı. Eksik olan GÖRÜNÜRLÜK: sevk/fatura başarı mesajlarına "sıradaki adım"
cümlesi + Ayarlar>Muhasebe>Otomasyon'a işaret. Ağır akış motoru (BPM) bilinçli
reddedildi — bakım borcu, sektör küçük/orta ölçekte istemiyor.

### C6. Satış faturası ↔ envanter (soru cevabı — koda gerek yok)
Kumaş stoğu SEVKTE düşer (sevk irsaliyesi = malın çıkışı; fatura mali belge).
Tek istisna: `finance.yarnOutOnInvoiceEnabled` (iplik kg'sini SALES onayında
düşürür; varsayılan KAPALI; sevkten de düşen kurulumda açılırsa ÇİFTE düşüm —
bayrak JSDoc'unda uyarı). Bu cevap kullanım kılavuzuna/CLAUDE.md'ye yazılır.

## D) BENZER SORUN TARAMASI — SONUÇLAR (6 mercek, 2026-08-15 04:30; tam rapor
## workflow çıktısında, burada uygulanacak damıtım)

### D-Yüksek (kodlanacak — dalga SF1 backend / SF2 panel)

**SF1 (backend):**
- **Türkçe-duyarsız arama 8 ticaret servisinde** — yarn(⭐ kesin kırık: ad
  BÜYÜK saklanıyor, küçük arama asla bulamaz) · cari · purchase-order · invoice
  · cheque · cash-transaction · cheque-delivery-note · payment → hepsi
  `buildTurkishSearch`e (fabrika servislerindeki desen).
- **Backend ROLL_STATUS_TR sözlüğü** (`constants/status-labels.ts`) + 4 kullanım:
  stok sayım tutanağı `outOfScopeReason` (⭐ DONMUŞ belgeye ham enum yazılıyor —
  stock-count:1028; panel ikizi stockCountRules:204 AYNI anda) · depo transferi
  ön-kontrol/geri-alma (geri-almada mesaj dört sebepten hangisi olursa olsun
  `status` basıyor — sebep-başına cümleye çevrilecek) · payment-allocation çek
  reddi (cheque.service STATUS_LABEL'ı export edilip kullanılacak) ·
  purchase-order revizyon reddi (PO_STATUS_LABEL'ın backend eşi).
- **GR↔PO para birimi**: sipariş seçilince currency devri (panel) + tedarikçi
  guard'ının ikizi para birimi guard'ı (backend) — USD siparişten TRY fiş sessiz
  ve büyük.
- **Alış faturasında PO fiyat katmanı** — C1'in alış ikizi:
  `createDraftFromGoodsReceipt` `PurchaseOrderLine.unitPrice`i hiç okumuyor;
  çelişkide uydurma yok (orderConflicts deseni).
- **Ekstre satırına `invoice.id`/`payment.id`** (belgeye tıkla-git'in ön koşulu).
- **listShipments iç fatura bağı** (`invoices {id,docNo,status}`) — "Faturala"
  düğmesi dış-muhasebe izi `invoiceNo`ya bakıyor: taslak varken düğme çıkıp 409
  yediriyor, dış-nolu sevkiyatta hiç çıkmıyor.
- Küçük: GR + depo transferi listelerine `applyDateRange` çağrısı ·
  `exchangeRate` servisine `dateFields`.

**SF2 (panel):**
- **isError SINIFI (en yaygın kusur)**: `DataTable`/`CrudPage` isError tanımıyor
  (14 tanım sayfası hatada "Kayıt bulunamadı" basıyor) · `FilterBar` 3 lookup
  varyantı (2026-08-12 vakasının sınıfı hâlâ açık) · 7 ticaret listesi (Cari/
  Faturalar/Tahsilat/Kurlar/Kasa&Banka/MalKabul/Transfer — hatalı metinler
  yanlış eyleme YÖNLENDİRİYOR: "kuru girin"→mükerrer kur) · Cari Ekstre `!q.data`
  = yalnız hata dalı ("Kayıt bulunamadı" yalanı → sıfır bakiyeli mutabakat
  mektubu riski) · GR detay sheet `!r → null` (boş çekmece) · kasa/banka "tanım
  yok" zinciri (dört yüzey; hata → mükerrer kasa) · Excel içe aktarma `ready`
  hata okumuyor (18 satırın 18'i "Kumaş bulunamadı"). Emsaller kod içinde hazır:
  ReportErrorCard · CashPeriodSection iki-katman · LockStatusCard.
- **Fatura TASLAĞI düzenleme** — PATCH ucu var, panel çağırmıyor; 0-fiyatlı
  otomatik taslak ONAYLANAMIYOR + DÜZELTİLEMİYOR = kilitlenme. InvoiceFormDialog
  edit modu + DRAFT satırına "Düzenle".
- **InvoiceFormDialog `defaultCurrency` ön-dolumu** — USD müşteriye sessiz TRY
  fatura → kur 1 → defter ~30 kat yanlış (usePartyTermDays zaten cari satırını
  çekiyor).
- **5 listede 100-satır sessiz kırpması** → kırpma bandı (norm aynı klasörde 4
  sayfada yazılı ve uygulanmış).
- **Audit sözlükleri**: TABLE_LABELS +17 ticaret tablosu · FIELD_LABELS +16 alan
  · ENUM_LABELS +9 ticaret enum'u (IN/OUT bağlamsız en kötüsü).
- **CarilerPage 500+ kayıtta boşalıyor** (ticaret rejiminde TEK cari kapısı!) →
  sunucu taraflı arama+sayfalama; ara adım isError kartı.
- **Pasif kayıt/pasif cari seçim sınıfı**: seçili pasif kayda "(pasif)" rozeti
  (ReferenceSelect ortak düzeltme) · Tahsilat/Çek/Fatura formları pasif carinin
  açık bakiyesi için `cariPickerService`e (mahsup ekranının yazılı kararı).
- **Tıkla-git bağları**: fatura detay Kaynak satırları · GR↔PO çift yön · ekstre
  satırı → belge diyaloğu · PO detay "fişleri açın" bandı.
- Küçük TR'ler: BatchCorrectModal roll.status · OrderCancelDialog shipment
  status · SackContentEdit tooltip · sevk-oto-taslak görünürlüğü (Faturalar
  karosuna "N taslak" rozeti — karar: rozet, kalıcı işaret değil).

### D-Karar/ertelenen (plana not)
- `supplierId → cariId` kalıcı birleşmesi (L; C4 köprüsü bu gece kuruldu).
- Vade fallback ayrışması (settlementOf yalnız dueDate ↔ aging paymentTermDays
  fallback'li) — sözleşme kararı: taslaklara vade ön-dolumu (defaultCurrency
  ile aynı dalgada) + rozet mantığı aging'le hizalanır.
- Sevk-oto-taslağın tablet görünürlüğü (mobil Faturalar yüzeyi yok) — mobil işi,
  beklemede (plan gereği).

## E) BAYRAK PAKETİ 2 (kullanıcı talimatı, 2026-08-15 gece)

① Eksik bayraklar: J1 analizindeki RED/backlog listesi yeniden taranır + saha
planından doğan adaylar değerlendirilir (örn. C2 `targetShelf` bir bayrak mı
fiş alanı mı — fiş alanı seçildi; A1 muafiyeti bayrak DEĞİL mimari karar).
② **Ayarlar ekranı yeniden düzenlenir** — bugün bayraklar tek yığında ve
karışık. Sektör standardı: modül bazlı gruplar (Üretim/KK1 · Depo & Satın Alma
· Muhasebe · Sevkiyat · Sistem), her satırda tek cümle açıklama + varsayılan
rozeti + "kimi etkiler" notu; arama kutusu. Dört-kapı sözleşmesi
(`test_feature_flag_contract`) aynen korunur — değişen yalnız SUNUM
(settings-config.ts örgütlenmesi), anahtar adları DEĞİŞMEZ.

## Sıra

A1 → B1+B2+B4+B5 (tek dalga) → C1 → C3 → C2 → C4 → C5 metinleri → D taraması
plana işlenir → E bayrak paketi 2; her dalga: bekçi + typecheck + commit + push.
