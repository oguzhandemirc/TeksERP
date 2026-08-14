# Ticaret Dalı — Eksik Envanteri ve Yol Haritası (2026-08-14)

> **Nasıl çıkarıldı:** A–E planı (`~/.claude/plans/plan-haz-rla-magical-shell.md`) +
> sağlamlık paketi backlog'u baz alınarak 4 paralel SALT-OKUNUR tarama ajanı worktree'yi
> ölçtü. Her bulgu **dosya:satır kanıtlı** — tahmin yok. Kapsam: `feature/depo-mal-kabul`
> dalı, muhasebe + depo. Fabrika sunucusu ve main bu planın DIŞINDA.

## 1) Bitti — ölçümle DOĞRULANDI (özet)

Şüpheye yer kalmasın diye "bitti sanılan"lar da tarandı; şunlar gerçekten tam:

- **B5** sevkiyattan satış faturası (Faturala düğmesi + ön-yükleme + bekçisi) · **B8** fatura/tahsilat
  makbuzu çıktısı (INVOICE_INTERNAL + PAYMENT_RECEIPT, Belge Şablonları dahil) · **Kasa & Banka
  Defteri raporu** (üç yazar + yürüyen bakiye + Excel/PDF) · **B7** sipariş ekranı rejim süzgeci ·
  **PO modeli + "ne ısmarladım ne geldi" detayı + iptal↔kabul etkileşimi** · **B9 Hızlı Sevk**
  (listeden seçim + miktar modu, FIFO `statusChangedAt`) · **B9b** transfer + iade "listeden seç" ·
  **İplik**: kg defteri ekranı, ADJUST yüzeyi, Excel fiyat kolonu · **TCMB cron** ·
  **Fatura Kapama ekranı** (FIFO önerisi + elle düzeltme) · **verilen çek (PAY) akışı** ·
  finance bekçileri + dist-web docker imajı.

## 2) KRİTİK bulgular — akışı fiilen kıran 6 madde

| # | Bulgu | Kanıt (özet) | Efor |
|---|---|---|---|
| K1 | **Vade zinciri panelden girilEMİYOR** — ne fatura `dueDate` ne cari `paymentTermDays`; her fatura aging'de "vadesiz" kovasına düşüyor | backend PATCH uçları VAR (`finance.routes.ts:470,:125`); `InvoiceFormDialog`'da `dueDate` grep'i 0; panelde cari düzenleme diyaloğu yok | 1g |
| K2 | **Satış fiyatı ön-dolumu HİÇ yok** — `PriceKind.SALE` tüketicisi 0; fatura satırı kalem (item) bile seçtirmiyor → D2'nin satış yarısı ölü | iki `resolveItemPricesFor` çağrısı da PURCHASE | 1,5g |
| K3 | **Kasa hareketi (masraf/gelir/virman) panel yüzeyi HİÇ yok** — backend 4 uç hazır, operatör besleyemiyor; kasa defteri raporu fiilen boş kalır | `grep cash-transactions Electron/src` = 0; Finance hub 8 karoda yok | 2g |
| K4 | **Mal kabul ↔ alış siparişi panel dikişi KOPUK** — `GoodsReceiptOrderSection` + `PurchaseOrderSyncBand` YAZILMIŞ ama hiçbir yerden import edilmiyor (kesik oturum kalıntısı); fiş detayı bağlı PO'yu göstermiyor | import grep'i 0; `GoodsReceiptFormDialog` `purchaseOrderId` göndermiyor | 1,25g |
| K5 | **`resolveStatementOpening` ölü kod** — cari ekstre devri C3 mührünü KULLANMIYOR (düz aggregate); kapanışın değeri hiçbir okuma yolunda yok | tek çağıran bekçi; `cari.service.ts:566` düz SUM | 0,75g |
| K6 | **GR `addLines` ‖ `cancel` penceresi** — iptal, kontrol ile satır doğumu arasına sızarsa CANCELLED fişe canlı top/iplik yazılır (Sınıf 4'ün kalan üyesi) | status kontrolü tx dışı; satırlar ayrı tx | 1,5g |

## 3) Paketler

### F — Muhasebe akışının kayıp yarısı (~6,5 gün) — ✅ TAMAMLANDI (2026-08-14 akşam)

> Commit'ler: `0b552add` (mühür okuma) · `83e200d3` (cari kart) · `010d0a9c`
> (fiyat zinciri) · `c5efca98` (kasa hareketleri). Tarama: backend 232 kontrol +
> Electron 897 test yeşil. Ek bulgular: W3 bin-kat seddi (`Number("1.250")=1,25`
> tuzağı) · W2 "okunamayan alan yazdırılmaz" kuralı (notes okuma yolu açıldı) ·
> ShipmentInvoiceDraft'a `lines[].itemId` taşımak SNAPSHOT sözleşmesine dokunur
> (dispatch raporu DISPATCHED'ta donmuş belgeden okur) → J'ye not düştü, F'de
> yapılmadı.

| İş | İçerik | Efor |
|---|---|---|
| F1 | **Vade + cari kart düzenleme** (K1): `InvoiceFormDialog`'a vade alanı (boşsa cari vade gününden ÖNERİ, formda türet); `CariEditDialog` (paymentTermDays · riskLimit · taxOffice · defaultCurrency) — uçlar hazır, yeni uç yok | 1g |
| F2 | **Satış fiyat zinciri** (K2): fatura satırına kalem seçici + `resolveItemPrice(SALE)` ön-dolumu; `OrderLine`/`PurchaseOrderLine` editörlerine aynı öneri kancası (ortak hook; boş bırakılan ezilmez, çözülmezse 0 + confirm seddi) | 2g |
| F3 | **Kasa Hareketleri sayfası** (K3): karo + liste + masraf/gelir fişi + virman + iptal; kapalı-dönem 409 mesajı aynen ekranda | 2g |
| F4 | **Mühür okuma yolu** (K5 + kasa ikizi): cari statement devri `resolveStatementOpening`'e bağlanır (`carriedFrom` yanıta + panele); kasa defteri için `resolveCashBookOpening` yazılır ("X'e kadar mühürlü" notu) | 1,5g |

### G — Depo / alış dikişleri (~6,25 gün) — G1+G2 ✅ · G5 ✅kısmen bekliyor · G3/G4 açık

> **G1+G2 TAMAMLANDI (2026-08-14 gece):** mal kabul↔PO dikişi (yazılmış-ama-bağlanmamış
> bileşenler monte + senkron bandı kalıcı + fiş detayında PO satırı) · short-close
> (migration `20260814120000`, sync EZMEZ, sebep zorunlu, geri açılabilir) · resync ucu ·
> tekil top iptali senkron tetiği · liste "kalanı gelmeyecek" ipucu. Kalan G maddeleri
> (G3 iplik çıkışı → artık BAYRAKLI tasarım, aşağıdaki bayrak bölümüne taşındı; G4 metraj
> düzeltme; G5 depo hareket defteri) açık.

| İş | İçerik | Efor |
|---|---|---|
| G1 | **Mal kabul ↔ PO dikişi** (K4): `GoodsReceiptOrderSection` monte + sync uyarı bandı (fazla kabul / siparişte olmayan ürün) + fiş detayında PO satırı | 1,25g |
| G2 | **PO yaşam döngüsü**: `POST /:id/resync` + tekil top iptalinde senkron tetikleyici (bugün `receivedQty` bayat kalıyor); **short-close** ("kalanı gelmeyecek": `shortClosedAt` bayrağı, `deriveStatus` ezmez) | 1g |
| G3 | **İplik çıkışı + transferi**: satış faturası onayında iplik OUT (`invoiceId` çıpası, stornoda ters) ⚠️ *karar noktası: otomatik düşüm mü, uyarı+kısayol mu*; `POST /api/yarn/transfer` (tek tx, bugün iki ayrı ADJUST gerekiyor ve defterde "düzeltme" gibi görünüyor) | 1,75g |
| G4 | **Kumaş metraj düzeltme**: `PATCH /rolls/:id/qty` (roll:manual-adjust + zorunlu sebep + varyans izi) — bugün elle giriş/iptal var, metraj düzeltme YOK; tam sayım belgesi J'de | 1,5g |
| G5 | **Depo hareket defteri okuma yüzeyi**: defter yazılıyor ama hiçbir uç/ekran okumuyor → `GET /api/warehouses/movements` + depo detay dökümü (iplik defterinin ikizi) | 0,75g |

### H — Görünürlük + raporlar (~8,75 gün)

| İş | İçerik | Efor |
|---|---|---|
| H1 | Fatura listesi: `paidTotal` → **Kapanan/Açık kolonu + AÇIK/KISMİ/KAPALI rozeti** (türetme, kolon değil) + **vadesi geçti rozeti** (yüklem `allocationMath`'te hazır) | 0,75g |
| H2 | Cari listede **vadesi geçen toplam** — aging'in FIFO yüklemi `_shared`'a çıkarılıp TEK kaynaktan (ayrı hesap ayrışır); bekçiyle aging'e eşitlenir | 0,75g |
| H3 | **Ekstre + çek listesi Excel/PDF** (`ReportExportSpec` — altyapı hazır, iki emsal var) | 1g |
| H4 | **Çek vade takvimi**: özet kartlarına "vadesi yaklaşan (7g) / geçmiş" kovaları + Reports altında vade takvimi raporu (veri + sıralama hazır) | 1,5g |
| H5 | **KDV dönem özeti** raporu (satış/alış ayrı, oran kırılımlı matrah+KDV+tevkifat; beyanname DEĞİL, muhasebeciye özet) | 1,5g |
| H6 | **Çek teslim bordrosu** (PrintedDocType — çekte bugün tek baskı yüzeyi yok) | 1g |
| H7 | Kasa defteri raporuna **kategori kırılımı** bloğu (serbest metin GROUP BY; katalog kararı veri birikince) | 0,75g |
| H8 | Fatura üretim kısayolları: `financeAutoDraftFromShipment` bayrağı (dört kapı) + **iade → satış-iade faturası** düğmesi (backend bağı hazır; fason kabul tevkifat gerektirdiği için ayrı) | 1,5g |

### I — Sağlamlık kalanları + ops (~6,5 gün) — ✅ TAMAMLANDI (2026-08-15'e bağlanan gece)

> **I1** GR addLines‖cancel penceresi kapandı (K6 — satır tx'inin ilk işi fiş-claim,
> `createInitialEntry.txGate` F221 deseni; cancel tx-içi TAZE top kümesiyle; KK1
> fabrika yolu bayt-bayt) · **I2** 5 uçta eşzamanlı clientToken PO desenine bağlı
> (cached yanıt şekil paritesi; kilit-altı deterministik replay bekçileri) ·
> **I3** ekstre satırları ters-kayıt bağı taşıyor (statementDevir KESİN yol +
> eski-backend sezgisel fallback; ajan yarıda ölünce ana oturum tamamladı) ·
> **I4** invoice/cheque detay select daraltıldı (clientToken + iç FK'ler dışarıda)
> · **I5** demo seed zenginleşti (çek ×4 · devir zinciri · mühürlü dönem ×2 ·
> kategorili kasa · PO ×3 · vade zinciri · iade+iade faturası; MÜKERRER TARAMASI
> eklendi — "0 yeni" sayacı tek başına yetersiz çıktı, ölçüldü) + `demo-reset.sh`
> (sertleştirilmiş: sabit DB + argüman allowlist + TTY onayı + ön-yedek; İLK
> sürümü bir argüman testinde canlı demoyu sıfırladı — ders runbook §10'da) ·
> **I6** `TICARET-KURULUM.md` + veri üretmeyen `setup-ticaret.ts` (`npm run
> setup:ticaret`). Kasa guard'ına kablolama taraması (test_cash_negative_guard
> §9) da eklendi.

| İş | İçerik | Efor |
|---|---|---|
| I1 | **GR addLines‖cancel kapatma** (K6) + bekçi — en ucuz yol: satır yazımından önce `updateMany WHERE status=ACTIVE` claim'i (iplik tx'i hazır; kumaş tarafı `createInitialEntry` tx client geçirme işi) | 1,5g |
| I2 | **clientToken eşzamanlı çift-gönderim** — `withBarcodeRetry`'a `!isClientTokenP2002` yüklemi + tx dışı catch→findUnique (PO deseni); ⚠️ AYNI açık 5 uçta: cheque · invoice.createDraft · payment · cash-transaction ×2 | 0,75g |
| I3 | Ekstre satırına `reversesTxnId`/`reversedBy` → panelin aktif-devir tespiti sezgiselden KESİNE iner (`statementDevir` sadeleşir) | 0,5g |
| I4 | `DETAIL_SELECT` daraltma (invoice/cheque findById include→select) + doküman düzeltmeleri (şema `receivedQty` yorumu, tasarım `_count` notu, kesim notu rejim etiketi) | 0,75g |
| I5 | **Demo zenginleştirme**: seed'e çek (portföyde+tahsil edilmiş) + kasa dönem kapanışı + devir-iptal örneği; `demo-reset.sh` (drop→migrate→seed'ler; önce elle-tetikli, cron sonra) | 1,75g |
| I6 | **`docs/ops/TICARET-KURULUM.md`** (finance bayrakları + WEB_TRADE ataması + depo/kasa/kur/devir; bugün üç yere dağınık) + veri ÜRETMEYEN `scripts/setup-ticaret.ts` bootstrap (bayrak + şablon merge + varsayılan depo/kasa) | 1,25g |

### H durumu (2026-08-14 gece): H1+H2+H3 ✅ TAMAMLANDI

> Fatura listesi Kapanan/Açık + AÇIK·KISMİ·KAPALI + vadesi geçti rozetleri (kuruş
> aritmetiği, yalnız CONFIRMED) · cari listede "Gecikmiş" kolonu (aging çekirdeği
> `collectAgingRows` ile TEK kaynak — bekçi birebir eşitliği kilitler) · ekstre + çek
> Excel/PDF exportları (paylaşılan katmana PDF tr-TR sayı biçimi + `orientation`
> eklendi — tüm rapor PDF'leri düzeldi).
>
> **H4–H8 de TAMAMLANDI (2026-08-15'e bağlanan gece):** H4 çek vade takvimi
> (kovalar+hafta/ay tek sorgudan; ENDORSED takvim dışı — alacak ciroya geçti;
> özet kartlarında 5. kart listeye süzgeç yazar) · H5 KDV dönem özeti (oran
> kırılımı SATIR seviyesinden; TL kendi kur damgasından, kuruş kalıntısı
> mutabakat bekçili; beyanname DEĞİL) · H6 çek teslim bordrosu (ANLIK çıktı —
> bordro grubunu sahiplenen kaynak model yok, donmuş PrintedDoc sürümü J kararı;
> aynı-yön kuralı İKİ katmanda) · H7 kasa defteri kategori kırılımı (virman
> kendi kovasında — TransferInput kategori almaz; kırılım özethesabıyla AYNI
> hareket kümesinden) · H8 iadeden satış-iade faturası (InvoicePrefill type+
> returnGroupId dikişi + listReturns invoiceDocNo besleyicisi eklendi — düğme
> faturalanmış grupta çıkmaz). **G4** metraj düzeltme (FREE_STOCK+çuvalsız dar
> kapsam, CAS claim, WAREHOUSE_QTY_ADJUST varyans izi kataloğa alındı,
> labelDirty; panel yalnız ticaret rejiminde) ve **G5** depo hareket defteri
> okuma yüzeyi (yön SUNUCUDA bakan depoya göre; rejim kapısı BİLİNÇLİ yok —
> defter fabrika olaylarını da taşır; defter başlangıcı 2026-08-14, backfill
> yok) da tamam. Kalan: G3 (bayraklı tasarım, bayrak bölümünde) · I paketi · J.

### BAYRAKLAR (2026-08-14 sektör-standardı analizi — 4 tarama ajanı + uygulama)

**Uygulandı (varsayılanlar mevcut davranışı birebir korur):**
- ✅ `finance.blockNegativeCashEnabled` (varsayılan KAPALI) — kasa (fiziksel nakit)
  eksiye düşecekse 4 İLERİ yolda 409 (ödeme·masraf·virman çıkan bacak·çek ödemesi);
  BANKA muaf (kredili mevduat) · TERS yollar (storno/iptal) muaf — muafiyet bekçinin
  asıl negatif sondası. Sektör: Logo kasa eksi bakiye kontrolü / SAP B1 negative block.
- ✅ `finance.defaultVatRate` (varsayılan 20) — iki hardcode (panel `emptyLine` +
  mal-kabulden alış taslağı) tek ayara bağlandı. `test_feature_flag_contract` artık
  SAYISAL anahtarları da denetliyor (eski kör nokta kapandı).

**Bayrak adayları (backlog — analiz kanıtlı, efor dahil):**
`finance.riskLimitBlockEnabled` (~1g; H1/H2 görünürlüğü geldi, sıradaki doğal adım) ·
`finance.autoDraftFromShipment` (~1,5g; taslak üretimi dispatch TX'İ DIŞINDA) ·
`finance.autoAllocateOnPaymentEnabled` (~1,25g) · `finance.yarnOutOnInvoiceEnabled`
(~1,75g; G3'ün bayraklı hali — depo çözümü ön koşul) · `yarn.blockNegativeBalanceEnabled`
(~0,5g) · `purchase.blockOverReceiptEnabled` (~0,5g) · `goodsReceipt.requirePriceEnabled`
(~0,5g) · `finance.allowZeroPriceLineEnabled` (~0,25g) · `finance.futureDatedDocumentBlocked`
(~0,4g; çek keşide/vade tarihi MUAF — Sınıf 1).

**Bayrak OLMAYACAKLAR (analiz RED listesi, gerekçeler kayıtlı):** çek defter anı ·
append-only/storno kuralları · Hızlı Sevk onay adımı (`shipping.confirmationEnabled`
ZATEN kapsıyor — ikinci bayrak ikinci kaynak) · kur kaynağı (VUK md.280 mevzuat) ·
belge no önekleri (bayrak değil numaralama-şablonu modeli) · iade faturası zorunluluğu ·
dönem kapanışı zorunluluğu · transfer IN_TRANSIT (bayrak değil ikinci yaşam döngüsü) ·
çok-depo bayrağı (veriden türetiliyor) · aging kova günleri (rapor sözleşmesi) ·
kapama yön kuralı (ekonomik anlam).

### J — Kararlar VERİLDİ (2026-08-15'e bağlanan gece, kullanıcı seçimi)

> **Yapılacak (onaylı):** tam stok sayımı belgesi · mutabakat mektubu + donmuş
> çek bordrosu · fatura detay sayfası · top→sipariş kalemi izi · kur farkı
> (öne alındı) · bayrak backlog'unun 4 grubu da (J1 dalgasında uygulanıyor).
> **TR-only KARARI:** arayüz bilinçli Türkçe kalır — hedef pazar Türk tekstil
> firmaları; yabancı müşteri doğarsa sınırlı ticaret sözlüğü o gün planlanır
> (bkz. aşağıdaki i18n maddesi, artık KARAR VERİLDİ durumunda).
> **Beklemede:** mobil mal kabul (plan gereği) · e-Belge/dış muhasebe (SaaS
> ufkuyla). Model düzeni: J yazıcıları OPUS (kullanıcının oturum-limiti
> uyarısı); Fable yalnız ana oturum orkestrasyon + hassas diff incelemesi.

### J — Karar bekleyenler (ARŞİV — kararlar yukarıda)

- **i18n** — TR sabit (grep: 0 i18n). Yabancı demo yakın değilse "TR-only, bilinçli" notu (0,25g); gerekiyorsa önce YALNIZ ticaret yüzeyleri sözlüğe (~5g+ ve sürekli bakım borcu).
- **Kur farkı** (dövizli kapama) — bilinçli kapsam dışı, üç katmanda belgeli; dövizli tahsilat hacmi doğunca ~2-3g.
- **`Roll.purchaseOrderLineId`** — aynı üründen iki terminli sipariş GERÇEK ihtiyaç mı? Değilse FIFO varsayımı kalıcı sınır olarak belgelenir.
- **Tam stok sayımı belgesi** (sayım listesi + fark fişi + toplu mutabakat) ~3g — G4 hafif sürümü önce.
- **Resmi mutabakat mektubu** (donmuş PrintedDoc; H3 ekstre exportu ihtiyacın çoğunu kapatır) ~1,5g.
- **Fatura detay sayfası** (bugün liste + baskı diyaloğu var).
- **Mobil mal kabul** — plan gereği sonraya; ilk iş `test_single_warehouse_parity` §5c güncellemesi olur.
- **e-Belge / dış muhasebe entegrasyonu** — SaaS ufku ile birlikte.

## 4) Önerilen sıra

**F → G1-G2 → H1-H3 → kalan H → G3-G5 → I** (F+G çekirdek akış, H görünürlük, I sertleştirme).
F4 hariç F maddeleri birbirinden bağımsız — paralelleştirilebilir. H1, K1 kapanmadan görünür
sonuç vermez (vade girilemiyorken rozet hep boş). Toplam ~28 gün efor; paket sınırlarında
commit + bekçi + (istenirse) demo deploy.

## 5) Değişmez kurallar (bu plana da aynen uygulanır)

Additive migration · fabrika sıfır-fark (`finance.enabled` rejimi) · append-only defter + storno ·
atomik claim · **her yeni davranışa bekçi + negatif sonda** · beş sağlamlık sınıfı (kök CLAUDE.md) ·
paylaşılan dosyada dikiş ana oturumda.
