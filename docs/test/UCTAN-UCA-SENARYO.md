# Uçtan Uca Test Senaryosu — güzergâh, dallar, backend doğrulaması, çıkarım

> **Ne:** kullanıcı testi güzergâhının (`kullanici-testi.html`, 2026-09-15 yayını, A–M) genişletilmiş ve makineleşmiş hâli. Her adımın DÖRT kolonu var: **Yap** (ekranda nereye, ne) · **Bekle** (ekranda ne görünmeli) · **Backend doğrulaması** (hangi uç/tablo, beklenen sayı) · **Çıkarım** (① saha sürtünmesi → "daha kolay yol var mı?" · ② sektör → bizde eksik · ③ bizde fazla → sadeleştir).
> **Neden dört kolon:** kullanıcı kuralı 2026-09-18 — *"test ederken çıkarım yapacak mısın? Amacımız işi de geliştirmek; çözüm yollarımızı her zaman daha kolay sunmak hedefimiz."* "N yeşil / M kırmızı" tek başına eksik rapordur; "K çıkarım, E sektör eksiği, S sadeleştirme" olmadan test bitmiş sayılmaz.
> **Sürücüler:** panel adımları `Electron/e2e/guzergah/adimlar.mjs` (koşum `node e2e/guzergah/guzergah.mjs <id…>`), tablet adımları d5'in sürücüsünde — **aynı id, aynı `dogrula` şeması**. Bir adımın sürücü durumu: ✅ otomatik koşuyor · ⏳ yazılacak · ✋ elle (insan gözü gerekir: belge önizlemesi, yazıcı, Wi-Fi).
> **Ortam:** `cd Teks-Erp && npx tsx scripts/e2e-ortam.ts kur` (fabrika dump kopyası `tekserp_d9e2e_test` + migrate + fixture) · `… sunucu` (backend :4110) — kullanıcının 4000/Electron'una DOKUNULMAZ. Roller: **P** panel-yönetici (`e2e-yonetici`) · **M** muhasebe · **S** sistem hesabı (parola yalnız koşum belleğinde) · **T** tablet operatörü.
> **Adlar:** her kayıt `TEST` önekli (`E2E_ONEK` ile değişir, aynı DB'de yeniden koşum için). ⚠️ Sunucu master-data adını **Türkçe BÜYÜTEREK** saklar: "TEST Müşteri" listede **TEST MÜŞTERİ** görünür — kırmızı değil, kural (`name_uppercase_storage`).

Çıkarım kaynakları: 9b [`CIKARIM-TANIM-ALIS-FINANS.md`](CIKARIM-TANIM-ALIS-FINANS.md) (B · C · J · L, 2026-09-18) · 6e [`CIKARIM-DEVERE-DOKUMA.md`](CIKARIM-DEVERE-DOKUMA.md) (D · F · G · K, 2026-09-18) · d9 sürücü koşumları (2026-09-18). Sektör atıfları: SAP MM/QM/PP, Datatex NOW, BMSvision/WeaveMaster; `docs/design/URETIM-BELGE-ZINCIRI.md` §1.2/§1.3/§4/§6 (5e). Etiket: **B** büyük · **O** orta · **K** küçük.

---

## 0 · Okuma kuralları

- **Sıra önemli:** adımlar birbirinin verisini kullanır (`gerektirir`). Ön koşulu düşen adım **kırmızı değil ATLANDI**dır ve sebebi yazılır — "ölçemedim" ile "bozuk" aynı satıra düşmez.
- **Backend doğrulaması ekrandan bağımsızdır:** ekran yeşil ama tablo yanlışsa adım KIRMIZI. Tablo adları `schema.prisma` `@@map`; uçlar `/api/…`. "ölçülecek" yazan hücre henüz doğrulanmamış bir iddiadır, kodu okumadan doldurulmadı.
- **Seçici modalları 50'şer yükler:** TEST kayıtları ilk sayfada değildir — tedarikçi/ürün/müşteri modalında ÖNCE arama kutusuna ("Kod, ad…" / "Ad / kod / vergi no ara…") adı yaz, sonra satıra tıkla. Güzergâhın eski metninde bu adım yoktu; kullanıcı da yaşadı (1e).
- **Sürücü ön koşulu ÜÇ SONUÇLU:** koşucu başlamadan E2E DB'sinin ağaçtaki migration'larla hizalı olduğunu ölçer; geri kalmışsa koşum "kırmızı" değil **ÖLÇÜLEMEZ** der ve durur (ölçüldü 2026-09-18: `StationKind.WARPING` e2e DB'de yoktu, D0 sessizce 400 aldı — ürün hatası sanılabilirdi). Çare `e2e-ortam.ts kur` (idempotent).
- **"Bilinen ve beklenen"** (kırmızı DEĞİL, not): çuval etiketinde iç not bu sürümde hâlâ basılır · panelde levent olay/tüketim satırları için ayrı ekran yok (yalnız "Tezgah kaydını geri al" listesinde).

---

## 1 · Ana zincir (A–M)

### A · Hazırlık

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **A1** · S · Sistem → Yapılandırma → Modüller ✅ | Sistem hesabıyla gir; Modüller ve Raporlar bölümlerine bak. | Başlık "Modüller"; on modül açık; Raporlar bölümünde 30 satır, her birinde Basit/Gelişmiş rozeti. | `GET /api/feature-flags` → on modül anahtarı `true`, `reportsClosedKeys` boş. | ① Sistem hesabı ayrı giriş; yönetici bu sayfayı göremez (doğru: kimlik kilidi). ③ — |
| **A2** · S · Özellik Anahtarları → Devere / Levent ⏳ | "Levent tezgah bağı defteri" AÇ · "Tezgahtan inen top leventten otomatik düşsün" AÇ · kaydet (ayar şifresi). | İki satır açık; yenilenince değişmez. | `system_settings` → `devere.mountTracking`/`devere.autoConsume` (anahtar adları ölçülecek) `true`. | ① Ayar şifresi her kaydette; ③ — |
| **A3** · T · Ayarlar → Güncelleme · API Sunucusu ✋/⏳ | Sürümü oku; API adresini gör; operatör hesabıyla gir. | "Çalışan sürüm" 1.0.7 · Native 54.3; Bölüm Seçimi'nde 8 karo. | `GET /api/client-policy/mobil` → `minVersion` sahadakinden küçük; `sessions` → operatörün oturumu `deviceType=MOBILE`, `clientVersion` dolu (2026-09-17'den beri). | ① Adres elle. ⚠️ **K** (d5 ölçtü) tablet şifre alanı `number-pad`: ALFANÜMERİK parolalı operatör tablete UI'dan HİÇ giremez; kullanıcı formunda "tablet parolası sayısal olmalı" ipucu/doğrulaması yok — fixture bu yüzden operatöre sayısal parola üretir. |

### B · Tanımlar

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **B1** · P · Tanımlar → İş Ortakları → Cariler → **Yeni Cari** ✅ | ① Ad "TEST Müşteri", Roller ☑ Müşteri, Sevk varsayılanı Yurtiçi → Kaydet. ② Ad "TEST Tedarikçi", ☑ Tedarikçi → Kaydet. Listede bulmak için arama kutusuna yaz. | İki satır, Rol sütununda rozet (Müşteri / Tedarikçi); "Yön: Tedarikçi" yalnız tedarikçiyi, "Fason: Fason yapan" göçle gelen fason kartlarını gösterir; "Yeni Fason" düğmesi YOK. | `customers` → 2 satır: `isCustomerRole/isSupplierRole` doğru, `defaultDestination=DOMESTIC` (müşteride); `subcontractors` → 0 (fason profili doğmadı); `cari_accounts` → 0 (hesap ilk belgeyle açılır — C6). | ① 4 dokunuş derinlik; "Sevk varsayılanı" kart açılırken sorulur (ilk sevkte sorulabilir). ② **O** SAP vendor master: ödeme koşulu · para birimi · IBAN · vergi dairesi KARTTA doğar; bizde bunlar `cari_accounts`ta ve o kayıt ilk fatura/ödemeyle doğuyor → vade/para birimi kart açılırken YOK. ③ **B** üç rol kutusu + `type` (türetilmiş) + `CariAccount.kind` — aynı sorunun üç cevabı; kaldırma fazı planlı (`IS-ORTAGI-ROL-MODELI.md` §7). |
| **B2** · P · Tanımlar → Ürün Kataloğu → Ürünler → **Yeni** ✅ | Ad "TEST İplik", Tip İplik, Denye 150, "Elle gir" → Stok Kodu TEST-IP → Oluştur. İkinci: Tip Kumaş, TEST-KM, "TEST Kumaş". | Birim ipliğe otomatik KG; "Tür: İplik" yalnız ipliği gösterir, Renk/Özellik süzgeçleri gizlenir. **Not:** güzergâh "Yeni Ürün" der, düğme **"Yeni"** (diyalog başlığı "Yeni Ürün"). | `items` → `TEST-IP: YARN/KG/150`, `TEST-KM: FABRIC/MT`. | ① Kod otomatik, birim tipten — iyi. ② **K** alternatif birim (kg ↔ bobin), min stok / yeniden sipariş seviyesi, tedarikçi malzeme kodu — bizde bobin yalnız hareket kolonu, min stok YOK. ③ — |
| **B3** · P · Üretim & Kalite → Çözgü Kartları → Yeni ✅ | Kod TEST-CK1, ad "TEST Çözgü", iplik → TEST İplik, Tel 2000, Take-up 8 → kaydet. | Listede satır; take-up görünür. | `warp_specs` → 1 satır, `yarnItemId` = TEST-IP, `takeUpPct=8`. | ② **K** çözgü kg/m (tel × denye ÷ 9.000) kartta türetilmiş gösterilsin; bizde hesap yalnız sarımda. |
| **B4** · P · Üretim İstasyonları → dokuma istasyonu → Makine ekle ✅ | Ad "TEST-TZ1", levent yuva 1 → kaydet (dokuma istasyonu yoksa önce aç — sürücü belirleyici olsun diye "TEST DOKUMA" istasyonunu açar). **Not:** üst düğme "İstasyon" (belge "Yeni İstasyon" der; diyalog başlığı öyle); liste görünümünde satır düğmesi "+ Makine", kart görünümünde "Makine ekle". | İstasyon satırında/kartında TEST-TZ1 · Aktif. | `machines` → 1 satır `warpBeamSlots=1`, `stationId` dokuma istasyonu. | ① Önce istasyon kartı bulunmalı (bağlam doğru). ② **K** iş merkezi: hedef devir + vardiya kapasitesi — `MachineSpec` var, alanları ölçülecek. |

### C · İplik geldi — alış zinciri

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **C0** · P · Cariler → Yeni Cari (tedarikçi) ✅ (B1 ile) | B1'in ikinci kartı. Vergi No 1234567890. | Rol "Tedarikçi"; Muhasebe → Cari Hesaplar'da HENÜZ yok. | `cari_accounts` → 0 (C6'da 1). | ③ **K** Güzergâhta iki kez tanım (B1 + C0): tek giriş; diyalog başlığı rolü söylesin ("Yeni Tedarikçi"). |
| **C1** · P · Depo & Paketleme → Alış Siparişleri → Yeni Sipariş ✅ | Tedarikçi kutusu → modal → **ara** → TEST Tedarikçi; TRY; beklenen +3 gün; Not "TEST-AS1"; kalem: Ürün kutusu → modal → **ara** → TEST İplik, 120, 85, "1. parti" → "Siparişi aç (1 kalem)". | Listede "Bekliyor"; "Ne bekliyorum?" 120 / 0 / 120. **Not:** "Not (opsiyonel)" etiketi kutuya bağlı değil; birim fiyat kutusunun erişilebilir adı yok (yalnız "—") — erişilebilirlik borcu (K). | `purchase_orders` → `OPEN`, `TRY`; `purchase_order_lines` → `qty=120`, `unitPrice=85`; `goods_receipts` → 0. | ① Birim fiyat elle; beklenen tarih sipariş başına. ② **O** SAP PO: fiyat info record/son alıştan, ödeme koşulu tedarikçiden, teslim tarihi KALEM başına — bizde PO'da vade YOK, kalemde tarih YOK, son fiyat önerisi YOK. ③ **koru** onay/release adımı yok — küçük fabrika için doğru. |
| **C2** · P · Mal Kabul → Yeni Mal Kabul ✅ | Alış siparişi → TEST siparişi (tedarikçi kilitlenir, kalemler dolar: 120 kg × 85). Depo seç. İrsaliye IRS-TEST-1. Lot ÖNCE boş bırak → "Fişi Oluştur" kapalı/kırmızı olmalı (lot zorunlu açıksa); sonra Lot TEST-L1, Bobin 24 → Fişi Oluştur. | Fiş oluşunca detay paneli kendiliğinden açılır: irsaliye · "0 top · 0 m + 120 kg iplik" · "AS… tamamlandı — tüm kalemler karşılandı". **Not:** düğme "Fişi Oluştur (1 iplik)" (belge "(… + 120 kg iplik)" der); lot boş → düğme kapalı yalnız "lot zorunlu" anahtarı açıksa. | `goods_receipts` → 1 (`purchaseOrderId` dolu, `supplierRef=IRS-TEST-1`); `yarn_lots` → TEST-L1 `supplierId` dolu; `yarn_movements` → +120 kg (kaynak mal kabul); `purchase_orders.status=CLOSED`. | ① Siparişten doldurma iyi; lot hatası satırda kırmızı (erken) iyi. ② **B** SAP GR: fazla teslim toleransı + QM 01 muayene → kalite stoğu → kullanım kararı; Datatex karantina. Bizde iplik doğrudan kullanılabilir stoğa düşer: kalite kabul/karantina statüsü YOK (`YarnLot` yalnız `isActive`); iç lot ↔ tedarikçi lotu ayrımı yok (**K**). Fazla teslim denetimi (`receivedQty > qty`) **ölçülecek**. |
| **C3** · P · Mal Kabul → ikinci kez ✅ | Aynı siparişi seç → "Kalemleri siparişten doldur". | Ekran bunu bir adım ÖNCE çözer: kapanmış sipariş listede HİÇ yok (`OPEN,PARTIAL`). ~~C2'den 30 sn içinde açılırsa seçici bayat önbellekten siparişi gösteriyordu~~ → **KAPANDI `fdb8cc13`** (fiş kaydı sipariş sorgularını tazeler, seçici `staleTime 0`); TESTL koşumunda C2'nin hemen ardından YEŞİL (ölçüldü 2026-09-18). | `goods_receipts` → hâlâ 1; `GET /api/purchase-orders?filter[status]=OPEN,PARTIAL` → sipariş YOK. | ③ **K** kapalı sipariş listelenmiyor ✓ (9b'nin önerisi zaten uygulanmış). ① **O** (d9) fiş kaydedilince sipariş seçicisinin önbelleği ANINDA geçersizlenmeli (`invalidateQueries(["purchase-orders"])`); fazla teslimi sunucu keser mi → O8. ③ **K** (d9) `status=` çıplak sorgu parametresi sunucuda SESSİZCE yok sayılıyor (`filter[status]` gerekir) — fail-closed kuralı "tanınmayan kapsam 400" der. |
| **C4** · P · İplik Stoğu → Stok · Lotlar ✅ | Stok: TEST İplik 120 kg → hareket dökümü; Lotlar: TEST-L1. | Üç görünüm tutarlı; lot satırında tedarikçi dolu. | `GET /api/yarn-stock…` (uç adı ölçülecek) bakiye 120 = `yarn_movements` toplamı. | ② **K** iplik lotundan başlayan izlenebilirlik (lot → levent → top) tek raporda — bizde `batch-trace` TOP partisinden; iplikten başlayan iz **ölçülecek**. |
| **C5** · P · Mal Kabul → fiş → Görüntüle / Bas · Alış Faturası Oluştur ✅ (belge önizlemesi ✋) | Belgeyi önizle; "Alış Faturası Oluştur" → doğan taslak fatura detayı AÇILIR; Muhasebe → Faturalar. | Fatura detayı "AF… — Alış Faturası", Taslak; listede TUTAR **KDV dahil** (12.240,00 = 10.200 + %20 — belge "10.200 + KDV" der). İkinci "Alış Faturası Oluştur" → 409 (1 fiş → 1 fatura, tekil). | `invoices` → 1 (`type` alış, `status=DRAFT`, `goodsReceiptId` dolu); `invoice_lines` → 1. | ② **B** SAP MIRO: n irsaliye → 1 fatura, fiyat/miktar toleransı, fark varsa BLOKE — bizde `Invoice.goodsReceiptId` tekil (n:1 YOK), PO↔fatura fiyat denetimi YOK. ③ **K** "Onayla" fiş detayından da verilsin. |
| **C6** · M · Faturalar → Onayla · Cari Hesaplar → Düzenle → Ekstre ✅ | Onayla; TEST Tedarikçi artık listede → TRY, vade 30 → Kaydet; Ekstre. | Fatura Onaylı; hesap kendiliğinden açılmış; bakiye NEGATİF; ekstrede fatura satırı. | `invoices.status=APPROVED`; `cari_accounts` → 1 (`kind`, `paymentTermDays=30`); `cari_transactions` → 1 fatura satırı, `dueDate` (vadesiz açıldıysa NULL — **çıkarım**). | ① Hesap faturayla doğuyor, vade sonra düzeltiliyor → o faturanın `dueDate`i vadesiz. ② **O** vade tedarikçi kartından faturaya iner. ③ **B** Cariler ↔ Cari Hesaplar iki ekran, iki kimlik: finans alanları Cariler kartına sekme; hesap kartla doğsun. |
| **C7** · M · Tahsilat / Ödeme → Ödeme ✅ (makbuz ✋) | Kasa yoksa Kasa & Banka → "Kasa ekle" → "TEST Kasa" (fabrika kopyasında kasa/banka YOK). Ödeme → "Yeni Ödeme": **Cari** seçici (modal, ara — "Cari türü" sorusu artık YOK), Kasa / Banka, Yöntem Havale/EFT, Tutar 6.120 (12.240'ın yarısı), Açıklama "Dekont TEST-1" → "Ödeme Kaydet (…)". Fatura Kapama: Yön "Ödeme → Alış faturası", Cari hesap, ödemeyi seç, faturada "sığan en büyük tutarı yaz" → "Faturaları kapat (1 · …)". | Listede Yön "Ödeme", kasa, 6.120,00 ₺ (liste dekontu GÖSTERMEZ — belge no · yön · cari · yöntem · kasa · tutar); ekstre bakiyesi yarıya; kapama sonrası açık tutar yarıya. | `payments` → OUT/BANK_TRANSFER/6120, `reference`=dekont; `cash_boxes.balance` → −6.120 (carili ödeme `cash_transactions`a satır YAZMAZ — bakiye iki yazarlı, kasa defteri ekranı ikisini toplar); `payment_allocations` → 6.120; `cari_transactions` Σ → −6.120. | ① Eşleme AYRI ekranda (Fatura Kapama); "Cari türü" seçimi KALKMIŞ ✓ (9b ③'ün yarısı uygulanmış). ② **O** SAP F-53/Logo: ödeme girerken açık kalemler listelenir, FIFO kapanır — tek ekran. ③ **O** ödeme diyaloğuna açık fatura listesi + varsayılan FIFO. |
| **C8** · S · Özellik Anahtarları → Devere / Levent → "İplik lotu zorunlu olsun" AÇ → Mal Kabul lot boş → anahtarı KAPAT ✅ | Anahtarı aç (sistem hesabı ayar şifresini ATLAR) → Kaydet; Mal Kabul → Yeni Mal Kabul → "İplik satırı ekle" → iplik seç, 5 kg, lot BOŞ. Sürücü aynı gövdeyi UI'yi ATLAYARAK da gönderir (`POST /api/goods-receipts`). Sonra anahtarı kapat. | Ekranda lot satırı KIRMIZI ve "Fişi Oluştur" KAPALI; sunucu **400 `RECEIPT_LINES_INVALID`** (`details.lines[]`) — fiş DOĞMAZ. Belgenin eski "toast 1 satır atlandı, fiş satırsız" davranışı ARTIK YOK (9b ön-uçuşu, fail-closed). | `goods_receipts` sayısı DEĞİŞMEDİ; `GET /api/feature-flags` anahtar geri `false`. | ③ **KAPANDI** — sessiz satır düşürme fail-closed'a çevrildi; belgenin C8 satırı buna göre düzeltildi (v9). |

### D · Levent sarımı ve tezgaha takma (tablet)

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **D0** · P · Üretim İstasyonları → İstasyon (DEVERE) ✅ | Ad DEVERE, tür Devere (WARPING; yetenek ön-dolar) → Kaydet; Makine ekle DV1. | Tablette Levent Sarım başlığı "1 devere makinesi"; D2 seçicisinde DV1. | `stations` → 1 (`producesWarpBeam=true`); `machines` → DV1. | ① İki form, ~9 dokunuş. ② **K** "istasyon + ilk makine" tek adımda. ③ **K** türe göre ilgisiz yetenek kutuları "Gelişmiş" altına. |
| **D1** · T · Levent Sarım → Yeni levent ⏳(d5) | Çözgü TEST Çözgü, 500 m, köken IN_HOUSE, metal no TEST-M1 → Planla. | "Planlı (1)". | `warp_beams` → 1 `status=PLANNED`, `plannedMeters=500`. | ① Her açılış boş form; son kart hatırlanmıyor; ~6 dokunuş. ② **B** (5e Y2) `WarpBeam.weavingOrderId?` — iş seçilince kart + metre ön-dolar (+0 dokunuş); **K** son kullanılan çözgü kartı ön-dolu. ③ **K** köken varsayılan IN_HOUSE ve katlanır. |
| **D2** · T · Planlı → SAR ⏳(d5) | 500 m, adet 1, iplik çıkışı: depo, TEST-L1, 30 kg; dip 1 kg (sebep); devere makinesi → Sarımı Kaydet. | "Bugün sarılan"; panelde TEST-L1 kalan 91 kg. | `warp_beams.status=READY`; `yarn_movements` → −30 (çıkış) + 1 (dip iadesi); lot bakiyesi 91; `warp_beam_events` → WOUND. | ① Makine seçici ön-dolu değil; dip iadesi sebep zorunlu; ~10 dokunuş. ② **O** son sarımın lot/depo/kg'sini ön-doldur. ③ **K** tek makine ön-seç; tek sebepli katalogda sebep sorulmasın. |
| **D3** · T · Yeni levent → SAR (raşel takımı) ⏳(d5) | 300 m plan; SAR: adet 3, önek TEST-R, 300 m, 45 kg TEST-L1, dip 3 → kaydet. | Üç levent (TEST-R-1/2/3), her biri 15 kg + 1 kg dip payı; lot kalanı 49. | `warp_beams` → +3, `bodyNo` TEST-R-1..3; lot bakiyesi 49. | ② eksik yok. ③ **K** önek boşsa gövde no türet. |
| **D4** · T · Tezgahta → TAK ⏳(d5) | Tezgah TEST-TZ1, sayaç boş → TAK. | "Tezgahta (1)"; panelde Leventler: TEST-TZ1 · yuva 1 · TAKILI. | `warp_beams` → `status=MOUNTED`, `currentMachineId`=TEST-TZ1, `slot=1`; `warp_beam_events` → MOUNTED. | ① Takma devere tabletinden; fiziksel iş tezgah başında. ② **O** tezgah tabletinde "TAK". ③ **K** yöntem satırı bayrak kapalıyken gizli. |
| **D5** · P · Leventler → TEST-R-2 → Planı düzenle → gövde TEST-R-1 ⏳ | Dolu gövde yaz → kaydet; tablette bu leventi SAR. | Plan KABUL + amber uyarı "gövdesinde … canlı"; sarımda 409 "gövdesinde canlı bir çözgü var". | `warp_beams` → plan kaydedildi; SAR → HTTP 409, `warp_beam_events` değişmedi. | ② **K** uyarının listede kalıcı rozeti (toast kaçarsa iz yok). |

### E · Sipariş → iş emri

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **E1** · P · Satış & Planlama → Siparişler → Yeni Sipariş ✅ | Müşteri kutusu → modal → **ara** → TEST Müşteri; Sipariş No kutusuna tıkla (elle girişe döner) TEST-S1; kalem (form bir boş satırla açılır, "Sipariş Kalemi Ekle" ikinci satır olur): "Kumaş seç" → modal başlığı **"Kumaş seç"** → ara → TEST Kumaş, 100, birim m → Sipariş Oluştur. | Listede TEST-S1; "Sevk İlerlemesi 0". | `orders` → 1; `order_lines` → 1 (`unit=METER` zorunlu). | — |
| **E2** · P · Sipariş detayı → kalemi seç ("Kalemi iş emri için seç") → "İş emri oluştur (1)" ✅ | Yeni İş Emri sayfası (kendi sekmesi): Hedef Kumaş + "Sipariş: 1 kalem" ön-dolu; "Kayıtlı rota seç…" → modal "Rota Şablonu Seç" → şablon → "İş Emri Oluştur". | İş emri no (IE…); listede Tip "Siparişe Özel", Müşteri "TEST MÜŞTERİ", **Sipariş kolonu bağlı MİKTAR** ("100 m" — belge "TEST-S1" der; no arama kutusundan bulunur). **Not:** "Hedef 100 m" alanı bayrağa bağlı (`targetQuantityEnabled`), kapalıysa ekranda YOK. Fabrika şablonlarında dokuma adımı yok — "KURŞUN+TAMBUR" seçilir. | `work_orders` → `ORDER_PRODUCTION:PLANNED`; `work_order_to_order_lines` → 1; `work_order_steps` ≥ 1. | ① Rota ZORUNLU ve boş başlar; şablon modalı arama+liste, iyi. |
| **E3** · P · İş emri detayı → "Sipariş Bağla" → gerçek bir müşteri → Bağla ✅ | Diyalog yalnız UYUMLU (aynı kumaş) açık kalemleri listeler → TEST kumaşı başka siparişte yok → **"Uyumlu açık sipariş yok."** → diyalogun kendi yolu "+ Yeni Sipariş Oluştur" (hızlı form: Müşteri = gerçek bir kart, Metraj 50) → "Oluştur ve Bağla". | Listede Müşteri **"<yeni bağlanan> +1"** ve Sipariş 150 m — belge "TEST Müşteri +1" der; **asıl (ilk) müşteri rozetin arkasına düşüyor** (çıkarım K). | `work_order_to_order_lines` → 2 satır, 2 farklı müşteri; `orders` → +1 (`orderNumber` otomatik). | ① Uyumlu sipariş yoksa hızlı sipariş formu tek diyalogda — iyi. ③ **K** (d9) çoklu bağda listenin gösterdiği "birincil" müşteri ilk bağlanan (iş emrini doğuran) olmalı, sonradan eklenen değil. |

### F · Dokuma — koşum, duruş, indirme, otomatik çözgü tüketimi

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **F1** · P · Dokuma İşleri → Yeni Dokuma İşi ✅ | "Kumaş seç" → modal (ara) → TEST Kumaş; renk yok; "Çözgü kartı seç" → modal (başlığı yalnız "Seç") → TEST Çözgü; Kim dokuyor "Kendi tezgahımızda" (varsayılan); Hedef metre 100 → Kaydet. | Dokuma No (DK…); rozet **"Planlandı"** (belge "planlı/hazır" der); Hedef 100 m. | `weaving_orders` → 1. | ① Çözgü kartı kumaştan türemiyor; sipariş bağı YOK; ~6 dokunuş. ② **B** (5e Y1) siparişten "dokuma işi aç" (kumaş + hedef + termin ön-dolu); **O** kumaş kartına varsayılan çözgü kartı. ③ **K** plan tarihleri katlanır. |
| **F2** · T · Tezgah → TEST-TZ1 → Koşum Aç ⏳(d5) | İş emrine bağlı koşum; levent panelinde TEST-M1 · kalan 500. | Koşum açık · saat; levent satırı doğru. | `machine_runs` → 1 açık (`endedAt` NULL), `weavingOrderId` dolu. | ① Liste tüm açık işler; atkı sıklığı/devir elle, boşsa metre türemez (sessiz). ② **O** atkı sıklığı kumaş kartından, hedef devir `MachineSpec`ten ön-dolu; **B** takılı leventin işi ön-seçili. ③ **K** açık iş listesi tezgahın çözgüsüne göre sıralı. |
| **F3** · T · Duruş paneli ⏳(d5) | Duruş Bildir → 10 dk → Çalıştı → Sebep ata. | Panelde Tezgah Duruşları: TEST-TZ1, süre, sebep, Kaynak "tablet". | `machine_stop_events` → 1 (`reasonCode` dolu, `source=TABLET`). | ① Bildir: modal + onay (2 dokunuş). ② **O** duruş anında hızlı sebep düğmeleri (`quickPick`). ③ **K** "Duruş Bildir" modalsız başlasın. |
| **F4** · T · İndirme → Ham Giriş (doff bağı) ⏳(d5) | Hat 1, parça 1, sayaç 40 → indir; Ham Giriş → "dokuma mı? Evet" → indirmeyi seç → Desen TEST Kumaş, 40 m → Kaydet ve Etiket Bas. | Kayıt + mavi toast "çözgü tüketimi ≈ 43,5 m"; Leventler → TEST-M1 kalan ≈ 456,5. | `doff_events` → 1; `rolls` → 1 (`entrySource=WEAVING`, `doffEventId` dolu); levent tüketim defteri (`warp_beam_events` CONSUMED) → 43,5; `warp_beams.remainingMeters` ≈ 456,5. | ① ~12 dokunuş, iki ekran; koşum çipi tek koşumda bile elle; desen elle (doff→koşum→iş biliniyor). ② **O** KK1'de doff seçilince desen/renk ön-dolu; **K** doff listesi bu tezgah önce; `autoConsume` kapalıyken "tüketim yazılmadı" bilgisi. ③ **O** tezgah ekranında "İndir ve topu doğur" kısa yolu; **K** tek koşum ön-seçili, parça varsayılan 1. |
| **F5** · T · Wi-Fi kapalı → 20 m top → Wi-Fi açık ✋ | Aynı yol. | Toast barkodla gelir (kuyruktan); levent kalanı ≈ 434,8. | `rolls` → +1 (`clientToken` tek, replay yok); levent kalanı. | ② eksik yok. |
| **F6** · P · Kumaş Stoğu → Ham Stok → Manuel Top Ekle · tablette Sök ⏳ | 30 m/150 en ekle; tablette leventi Sök (kalan boş); tekrar 10 m ekle. | İlk eklemede tüketim toast'ı (≈32,6); sökme sonrası "bağlı levent yok, tüketim yazılmadı" uyarısı. | `warp_beam_events` → CONSUMED 32,6 + UNMOUNTED; ikinci topta CONSUMED yok. | ③ **K** Sök'te kalan boşsa kaynak sorulmasın. |
| **F7** · P · 40 m topu Stoktan Kaldır (CANCEL) → İptali Geri Al ⏳ | Önizleme → "1 topu stoktan kaldır"; Top Detayı → İptali Geri Al. | İptalde ters tüketim (CONSUMED_CANCEL); geri almada yeniden tüketim; kalan her adımda tutarlı. | `rolls.status` CANCELLED → ACTIVE; `warp_beam_events` → CONSUMED, CONSUMED_CANCEL, CONSUMED (üç satır, hiçbiri silinmez); `remainingMeters` başa döner. | ③ **K** geri alma iki yol (top detayı / levent menüsü) — tek kapı + yardım metni. |

### G · Emanet

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **G1** · P · Leventler → Yeni Levent (emanet) ✅ | Köken "Müşterinin emanet leventi" → sahibi TEST Müşteri, TEST Çözgü, 200 m. | "Emanet" rozeti; tedarikçi/fasoncu alanları kapalıydı. | `warp_beams` → `origin=CONSIGNED`, `ownerCustomerId` dolu, `supplierId`/`subcontractorId` NULL. | ② eksik yok. |
| **G2** · T · Ham Giriş (dışarıdan) → emanet sahibi ⏳(d5) | Sahibi TEST Müşteri, TEST Kumaş 25 m; ikinci top sahipsiz 15 m. | Seçici yalnız müşterileri listeler; ilk top emanet rozetli. | `rolls` → 2: `ownerCustomerId` dolu / NULL. | ② **K** doff'a bağlı topta sahip işten türesin. |

### H · Kurşun ve tambur (tablet)

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **H1** · P · Kurşun Planlama → Havuz → makine sekmesi ⏳ | TEST işini bir kurşun makinesine taşı. | İş makine sekmesinde; havuzdan düşer. | `work_orders`/planlama tablosu (ad ölçülecek) → `machineId` dolu. | — |
| **H2** · T · Kurşun → Tara ⏳(d5) | F4 topunun barkodu; hata metresi 2 → kaydet. | KK2 geçti; panelde "Tambur Bekleyen". | `roll_operations` → PROCESS_QC; `roll_errors` → 2 m; `rolls.status` tambur bekliyor. | — |
| **H3** · T · Tambur → Açık İşler → Kes → Geri Al → Kes → Bitir ⏳(d5) | 40 m, TEST Müşteri, Kalite 1 → Kes (Depoya Ekle); "Tambur İşlemini Geri Al" (önizle) → tekrar Kes → Bitir. | Geri almada önizleme etkilenen topu listeler; defter satırı silinmez; "Tüm toplar finalize"; Bitmiş Depo'da 40 m top. | `rolls.status=WAREHOUSE`, `finalizedAt` trigger yazdı; `roll_operations` → CUT, CUT ters kaydı, CUT (silme yok); `roll_movements` depo girişi. | — |
| **H4** · T · Tambur → Manuel Ekle → Geri Al ⏳(d5) | 12 m, sebep, aynı parti → ekle; "Elle Eklenen Topu Geri Al". | Bitmiş Depo'da 12 m ikinci top; geri alınca durum geçişi. | `rolls` → +1 (`entrySource` manuel), geri almada `status=CANCELLED` (hard delete YOK). | — |

### I · Çuval, sevkiyat, irsaliye, iade

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **I1** · T · Sevkiyat (tartı/paket) → Açık Siparişler ⏳(d5) | TEST-S1 seç → Paketlemeye Geç. | "Çuvallar (0)". | — | — |
| **I2** · T · Yeni Çuval → Top Okut → Elle kg 38 → Etiket bas ⏳(d5)/✋ | H3 topu; kantar yoksa "Elle kg gir" 38. | Çuval dolu; etiket önizlemesinde iç not HÂLÂ var (beklenen). | `sacks` → 1 (`weightKg=38`, `weightSource=MANUAL`); top çuvalda. | ① Elle kg aksiyon menüsünde. |
| **I3** · T · Hemen Sevk Et (1) ⏳(d5) | Sevkiyat kurulur. | Sevk Çıkışı'nda "Planlı". | `shipments` → 1 `PLANNED`; `sack_allocations` → sevk anında (I5'te). | — |
| **I4** · P · Kumaş Stoğu → Ham Stok → **Manuel Top Ekle** (Sahibi: TEST Müşteri, 25 m) → Paketleme / Çuvallar → **Yeni Çuval** (müşterisiz) → barkod okut → **Sevk Et** → BAŞKA gerçek müşteri ✅ | Emanet top panelden doğar (G2'nin tablet ikizi; `rolls.ownerCustomerId`). Çuval **müşterisiz** açılır — müşterili çuvalda diyalog cariyi KİLİTLER, "başka müşteri" seçilemez. "Sevk Et" → 409 toast; aynı diyalogda TEST Müşteri → tekrar "Sevk Et". | Toast: "1 top başka müşterinin emanet malı — sevkiyat … bu müşteriye açılamaz: <barkod> (TESTK MÜŞTERİ)". **Önizleme paneli çatışmayı GÖSTERMEZ** (yalnız sipariş uyarıları) — red ilk kez "Sevk Et"te görülür (çıkarım). İkinci deneme `shipping.confirmationEnabled=false` ⇒ doğrudan DISPATCHED. Tekrar koşumda "Bu top az önce girilmiş olabilir" mükerrer uyarısı çıkar → "yine de kaydet" (ürün davranışı, iyi). | HTTP 409 `details.code=OWNER_MISMATCH`, `details.rolls[{barcode, owner}]`; başka müşteride `shipments` farkı 0; TEST Müşteri'de +1 `DISPATCHED`; `rolls.status=SHIPPED`, sahip korunur. | ① Kapı `performDispatchTx`te — `POST /shipments/preview` sahiplik kapısını çağırmıyor; operatör çatışmayı önizlemede değil redde görür. ③ **K** (sevkiyat) önizleme `assertOwnerMatchesTx`i de koşsun (uyarı satırı: "N top başka müşterinin emanet malı"), red sürpriz olmasın. |
| **I5** · T · Sevk Çıkışı → Sevk Et → Çıkışı Onayla ⏳(d5) | Onay sayfası → Çıkışı Onayla. | Toast "Çıkış verildi — stok bina dışı"; geçmişte satır. | `shipments.status=DISPATCHED`, `dispatchedAt` dolu; `shipment_events` → DISPATCHED; `sack_allocations` → 1; `rolls.status=SHIPPED`; stok defteri çıkış satırı. | — |
| **I6** · P · Sevkiyatlar → satır → belge ✋ | "Sevk İrsaliyesi" önizlemesi. | Şeritte firma · irsaliye no · tarih; rakamlar BRÜT. | `GET /api/printed-documents/…` (uç ölçülecek) → `printed_documents` 1. | — |
| **I7** · P · Operasyon → İade Takibi → **Yeni İade** → barkod → **Sorgula** → İade Nedeni → **İade Al** ✅ | I4'te sevk edilen emanet top (25 m). **Kısmi metraj alanı YOK** — iade TOP bazlıdır, top bütün döner (güzergâhın "10 m"si panelde yok; kısmi iade = önce kesim, ayrı karar). Siparişsiz sevkte "Sipariş" alanı çizilmez. | Listede satır: TESTK MÜŞTERİ · barkod · 25 · Hasarlı · Teslim Alan; toast "İade alındı — top Hazır Depo'ya eklendi". "İade İrsaliyesi" ✋ (belge). | `roll_returns` → 1 (qty 25, `fromShipmentId`, `reasonId`); `rolls.status=WAREHOUSE`, sevk/çuval bağı NULL, **`ownerCustomerId` korunur**; `GET /shipments/:id` `summary.totalMeters` 25→25 (BRÜT), `returnedMeters` 0→25 ayrı sayaç; `shipment_events` SABİT (PLANNED, DISPATCHED) — iade kendi defterinde, sevk olay defterine yazılmaz. | ① Sevk rakamı brüt, iade ayrı sayaçta — doğru. ② **K** kısmi iade (top yarım geri gelir) — bugün yolu yok; sektörde iade satırı miktar taşır. |

### J · Muhasebe

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **J1** · M · Operasyon → Sevkiyatlar (Muhasebe) → arama kutusuna sevk no → satırda **Faturala** → "Yeni Fatura (Taslak)" → Birim Fiyat 40 → **Taslağı Oluştur** ✅ | Zincirde J1 **I7'den ÖNCE** koşar (fatura sevkte, iade sonra — gerçek sıra; iade sonrası taslak N6'da ölçülür). Tür "Satış Faturası" ve Cari (TEST Müşteri) ÖN-DOLU gelir; satır 1: kumaş · 25 m · birim "m" · fiyat 0 (`finance.pricingEnabled=false`, kart fiyatı yok) → elle 40. | Toast "Taslak oluşturuldu"; satırda "Faturala" yerine taslağa bağ. | `invoices` → +1 (`shipmentId` dolu, `SALES`, `DRAFT`, `cariId` → TEST Müşteri); `invoice_lines` → 1 (qty 25, unit `m`, unitPrice 40). | ① Tür + cari + satırlar sevkten ön-dolu — iyi. ③ **K** cari alanı KİLİTLİ DEĞİL (ölçüldü: `disabled` yalnız düzenlemede) — sevkten doğan fatura başka cariye yazılabilir; kaynak sevkiyatı olan taslakta cari kilitlenmeli. |
| **J2** · M · Muhasebe → Faturalar → arama (belge no) → satırda **Onayla** → "Onayla ve deftere işle" → satırda **Detay** → **Belgeyi aç** ✅ (yazdırma ✋) | Onay diyaloğu tutarı ve "BİR DAHA DÜZENLENEMEZ" uyarısını gösterir. Belge önizlemesi iframe'de açılır (fatura no + 25 m belgede — ölçüldü). | Fatura no değişmez (`docNo` taslakta doğar, `SF…`); onayda `confirmedAt`; belge "ONAY anında dondu". | `invoices.status=CONFIRMED`, `confirmedAt` dolu, `grandTotal` 1.200 (25 × 40 + %20 KDV); `invoice_lines.unit` NOT NULL (`m`); `cari_transactions` → 1 satır `sourceType=INVOICE`, debit 1.200 (müşteri borçlu). | ① Belge no taslakta doğuyor, onayda değişmiyor — numaralama bilinçli (ölçüldü). ② **bilinçli karar** e-Fatura/e-Arşiv (GİB UBL) — bizde YOK. |
| **J3** · M · Muhasebe → Tahsilat / Ödeme → **Tahsilat** → Cari seç (liste) → kasa → Nakit → 600 → **Tahsilat Kaydet** → satırda **Makbuzu yazdır / önizle** → Fatura Kapama (Yön "Tahsilat → Satış faturası") ✅ | Makbuz kayıt anında donar, satırdan önizlenir (600 makbuzda — ölçüldü). Kapama ayrı ekranda (C7 ile aynı yol). | Toast; ekstre bakiyesi 1.200 → 600. | `payments` → +1 (`IN`, `CASH`, 600, `cashBoxId` dolu); **`cash_transactions` YAZILMAZ** — cari tahsilatı yalnız `cash_boxes.balance`ı günceller (+600; C7 bulgusuyla aynı iki-yazarlı denormalize); `cari_transactions` Σ = 600; `payment_allocations` → 600. | ③ C7 ile ortak: açık kalem seçimi girişte değil ayrı ekranda. ② **K** (finans borcu) cari tahsilat/ödeme kasa defterine satır yazmıyor — kasa defteri ile kasa bakiyesi iki kaynak. |
| **J4** · M · Raporlar → Cari Yaşlandırma → "Ekranda ara" → satırda **Cari ekstresi** → Cari Ekstre → Belge tipi süzgeci ✅ | TEST Müşteri satırı; ekstrede Fatura (1.200 borç) + Tahsilat / Ödeme (600 alacak); "Dönem toplamı" kapanış 600. Belge tipi = Tahsilat → döküm 1 satıra iner, kapanış AYNI kalır (şerh: "yalnız dökümü daraltır"). | Bakiye = fatura − tahsilat = 600 ✓. | `GET /api/reports/finance/aging?cariId=` → `openTotal` 600, **hepsi `noDueDate` (Vadesiz) kovasında**, `ledgerBalance = storedBalance`, `reconDiff` 0; `cari_transactions` Σ = 600. | ② **doğrulandı:** vade yazılmayınca (fatura `dueDate` boş + cari `paymentTermDays` boş) bakiye "Vadesiz"e düşer — yaşlandırma raporu vade disiplinini görünür kılıyor, C6/J1'de vade girilmeli. ① Süzgeç şerhi ve "toplam değişmez" kuralı ekranda yazılı — iyi. |
| **J5** · M · Raporlar → Kasa & Banka Defteri (Cari: TEST Müşteri · Yön: Yalnız giriş) · KDV Dönem Özeti (Yön: Satış · Oran: %20) ✅ (Excel ✋) | Şerhler ekranda: "SÜZGEÇ — Cari: … · SÜZGEÇ — Yön: Yalnız giriş · Bu süzgeçler YALNIZ hareket dökümünü daraltır"; sayfa hesap ÖZETİ çizer (satır = kasa/banka hesabı), TEST Kasa satırında 600 giriş. KDV: "SÜZGEÇ — Yön: Satış · KDV oranı: %20"; **cari seçici YOK** (ölçüldü 0). | Excel meta ✋ (dosya insan gözü). | `GET /api/reports/finance/cash-book?…&cariId&yon=IN` → `meta.secenekler.cariId` TEST Müşteri'yi listeler, `totals.totalIn` ≥ 600 (toplamlar dönemin tamamı — süzgeç dökümü daraltır); `GET …/vat-summary?yon=SALES&oran=20.00` → %20 satırı KDV = matrah × 0,20, `meta.secenekler.oran` dolu; şema `.strict()` — `cariId` 400 (fail-closed). | ① Tarih parametresi ISO datetime ister (`2026-09-01` 400) — panel doğru gönderiyor, elle API kullanan için not. |

### K · Fason dokuma ve fasona iplik

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **K1** · P · Yeni Dokuma İşi (fasoncu) → Fason (sevk · kabul) → Sevk et ⏳ | Levent TEST-R-3 + iplik TEST İplik, TEST-L1, 20 kg → sevk. | "Sevkler (1)"; FasonYarnStrip giden 20 kg; lot kalanı 29. | `subcontractor_dispatches` → 1; `subcontractor_dispatch_items` → 2 (levent + iplik); `yarn_movements` → −20; `warp_beams.status=SHIPPED_OUT`. | ② **K** sevk edilen leventlerin gövde/durum rozeti. |
| **K2** · T · Fason Dokuma Kabul → iş → 35 m kabul ⏳(d5) | 1 satır 35 m → kabul. | "Makbuzlar (1)", "Doğan top 1"; Ham Stok'ta top (kaynak fason), sahibi boş. | `subcontractor_receipts` → 1; `rolls` → +1 (`entrySource` fason/dokuma, `ownerCustomerId` NULL). | ② **K** kabulde desen işten ön-dolu (ölçülecek). |
| **K3** · P · sevk satırı → İplik döndü → Dönüşü geri al ⏳ | 5 kg, sebep → kaydet (önizleme); sonra geri al (gerekçe). | "5 kg → depo; fasonda kalan 20 → 15"; storno sonrası 20; defterde iki satır. | `yarn_movements` → +5 (dönüş) ve −5 (storno) — iki satır, silme yok; fasonda kalan 20. | — |

### L · Raporlar

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **L1** · P · Dokuma → Randıman ⏳ | Son 7 gün; Tezgah TEST-TZ1; Levent TEST-M1; lot TEST-L1 (Enter). | Seçenekler pencerede geçen leventler; seçince liste daralmaz; "n satır kapsam dışı" notu; Kaynak ölçüldü/elle. | `GET /api/reports/weaving/efficiency?…` `meta.secenekler` + `meta.dusenSatir`. | ② **K** kayıtlı rapor süzgeci (SAP variant). |
| **L2** · P · Randıman → Excel · PDF · Yazdır ✋ | Üçünü al. | Dosya adında tarih penceresi; başlıkta süzgeç satırı; "ölçülemedi" metin. | — | — |
| **L3** · P · Duruş Pareto · Vardiya Karnesi · Karne Listesi ve Mühür ⏳ | Pareto tezgah süzgeci; karnede gün + vardiya; ⋯ → Mühürle. | F3 duruşu Pareto'da; mühür sonrası "Mühürlü" +1, satır donar. | `machine_shift_stat_seals` → +1; mühürlü satır `PATCH` → 409. | ③ **K** mühür düğmesi satırda görünür (tek dokunuş). |
| **L4** · P · Sipariş Karnesi · Sipariş İptal Karnesi ⏳ | Müşteri çoklu seçici; hedef Yurtiçi; iptal karnesinde sebep. Seçimi temizle. | "müşteri varsayılanı" niteleyicisi; "sebep yalnız payı süzer" şerhi; temizleyince adres çubuğunda anahtar kalmaz. | `meta.secenekler` ve `meta.varsayilan` (ad ölçülecek). | — |
| **L5** · P · Raporlar hub · Top İzleme ✋ | Kategori sayfaları; her yaprakta "bu rapor neyi cevaplar". | Bölümleme karo gizlemez; özet şeridi tablodan önce. | `REPORT_CATALOG` 30 satır = ekrandaki karo sayısı. | — |

### M · Süperadmin — görünürlük ve modül kapatma

| Adım | Yap | Bekle | Backend doğrulaması | Çıkarım |
|---|---|---|---|---|
| **M1** · S+P · Modüller → Raporlar → "Kalite Karnesi" kapat ⏳ | Kaydet (ayar şifresi); yönetici: Raporlar → Kalite; ⌘K "Kalite Karnesi"; adres `/reports/quality/scorecard`. | Karo yok, palette çıkmaz, doğrudan adres yetkisiz sayfası; tekrar aç → döner. | `system_settings.reports.closedKeys` = `["quality/scorecard"]`; ilgili uç → 403 `REPORT_DISABLED`; açınca 200. | — |
| **M2** · S+P+T · "Dokuma" modülünü kapat → Raporlar → tekrar aç ⏳ | Dokuma rapor satırları; tablette Bölüm Seçimi. | Satırlar kilit bandıyla pasif; tablette Tezgah/Levent Sarım karoları kaybolur, açılınca döner. | `dokuma.enabled=false` → dokuma uçları 403 `MODULE_DISABLED`; `GET /api/feature-flags` tablet için aynı. | — |
| **M3** · S+P+T · "Emanet" modülünü kapat → sahip seçicileri → tekrar aç ⏳ | Panel Manuel Top Ekle; tablet Ham Giriş. | Seçiciler kaybolur; G2 emanet topu rozetiyle durur; I4 sevk kapısı yine çalışır. | `emanet.enabled=false`; emanet sevk kapısı (I4) yine 409 — kapalı modül kapıyı KALDIRMAZ. | — |

---

## 2 · Dallar — güzergâhta olmayan, sistemin sözünü ölçen adımlar

Her dal ana zincirin verisine dayanır (`gerektirir`). Kod harfleri N–T; sürücü hepsini ⏳ (yazılacak) sayar.

### N · İptal ve geri alma — storno ≠ iade, ters kayıt siler mi?

| Adım | Yap | Bekle | Backend doğrulaması |
|---|---|---|---|
| **N1** · P · D2 leventinin sarımını geri al (WOUND_CANCEL) | Leventler → satır menüsü → "Sarımı geri al" (gerekçe). | Levent PLANNED'a döner; iplik lotu kalanı +30 −1 (dip iadesi geri). | `warp_beam_events` → WOUND, WOUND_CANCEL (iki satır); `yarn_movements` → ters satırlar (silme yok); lot bakiyesi 120. |
| **N2** · P · I5 sevkini geri al (`shipping:undo-dispatch`) | Sevkiyatlar → satır → "Sevki geri al" (SoD: yalnız Muhasebe/Süpervizör). | Sevk PLANNED'a döner; toplar depoya; irsaliye no korunur. | `shipments.status=PLANNED`, `dispatchedAt` NULL'lanMAZ (ters kayıt bugüne); `shipment_events` → UNDO satırı; `sack_allocations` geri; `rolls.status=WAREHOUSE`. |
| **N3** · M · J2 faturasını iptal (storno) | Faturalar → satır → "İptal". | Fatura `VOIDED`; cari bakiye eski hâline; sevk rakamı değişmez. | `invoices.status=VOIDED`; `cari_transactions` → ters satır (+1, silme yok); `shipments` aynı. |
| **N4** · T · H3 kesimini ikinci kez geri al (LIFO) | Tambur → "Tambur İşlemini Geri Al". | Yalnız EN SON işlem geri alınır; önizleme etkilenen topu listeler. | `roll_operations` → ters kayıt bugüne; sıra LIFO; `finalizedAt` trigger'ı tutarlı. |
| **N5** · P · İade sonrası sevk rakamı ✅ | I7 ölçtü (`GET /shipments/:id` summary önce/sonra). | BRÜT değişmedi (25→25); iade ayrı sayaç (`returnedMeters` 25). | `roll_returns` → 1; sevk özeti sabit. |
| **N6** · M · İade SONRASI sevkiyattan fatura taslağı önizlemesi ❌ **İHLAL** | API: `GET /api/finance/shipments/:id/invoice-draft-lines` (I7'nin sevkiyatı). | Satırlar BRÜT (25 m) — sevk belgesiyle aynı küme. | **Ölçüldü:** taslak 0 satır / 0 m, aynı sevkiyatın `summary.totalMeters` 25 m. `collectShipmentInvoiceDraftLines` (`shipment-auto-draft.helper.ts`) `roll WHERE shipmentId` okur; iade `shipmentId`yi NULL'lar → top taslaktan düşer. Resmi belge (`collectShipmentDocContent`) `RollReturn` ile BRÜTLEŞTİRİR, taslak kurucu brütleştirmez — helper'ın "resmi belgeyle aynı küme" yorumu yanlış. İade satış iadesi faturasıyla (`SALES_RETURN`) kapanmalı, satış faturası 25 m kalmalı. |

### O · Hata yolları — 409 claim, zorunlu alan, gövde dolu, kapalı modül

| Adım | Yap | Bekle | Backend doğrulaması |
|---|---|---|---|
| **O1** · P+T · Aynı topu iki tabletten aynı anda KK2'ye al | İki oturumda aynı barkod → kaydet. | Biri kaydeder, öteki 409 "tekrar deneyin / zaten geçti". | `roll_operations` → tek PROCESS_QC satırı (atomik claim, count===0 → 409). |
| **O2** · P · Lot zorunlu açıkken lot boş mal kabul (C8 ile birleşti) ✅ | C8 ile aynı — UI + API. | Fiş OLUŞMAZ, satır kırmızı, sunucu 400 `RECEIPT_LINES_INVALID`. | `goods_receipts` değişmedi. |
| **O3** · T · Dolu gövdeye sarım (D5) | Gövdesi dolu leventi SAR. | 409 "gövdesinde canlı bir çözgü var". | `warp_beam_events` değişmedi. |
| **O4** · P · Kapalı modülün ucu (M2 açıkken dokuma) | Dokuma İşleri'ne doğrudan git; `POST /api/weaving-orders`. | Karo yok; uç 403 `MODULE_DISABLED` (`details.code`). | HTTP 403, `details.code=MODULE_DISABLED`; `weaving_orders` değişmedi. |
| **O5** · T · Çevrimdışıyken aynı kaydı iki kez gönder (F5) | Kuyruk iki kez tetiklensin. | Tek top; ikinci deneme replay (aynı `clientToken`). | `rolls` → 1; token dört durumlu replay (`token-replay.helper`). |
| **O6** · P · Emanet topu başka müşteriye sevk (I4) ✅ | I4. | 409 + etkilenen kayıt listesi (barkod + sahip) — toast'ta; önizlemede DEĞİL (I4 çıkarımı). | `details.code=OWNER_MISMATCH`, `details.rolls`; `shipments` farkı 0. |
| **O7** · P · Sipariş kalemi birimsiz kaydetme | E1'de birimi boş bırak. | 400 Türkçe mesaj, alan adı. | `order_lines` değişmedi. |
| **O8** · P · Kapanmış siparişten ikinci fiş (bayat önbellek, C3) | C2'den 30 sn içinde Yeni Mal Kabul → aynı sipariş (listede hâlâ) → kalemler dolar → lot ver → Fişi Oluştur. | **Beklenen (fail-closed):** sunucu fazla teslimi keser (4xx, satır adıyla). Bugün ÖLÇÜLMEDİ. | `goods_receipts` → 1 kalır; `yarn_movements` → +120 YOK; `purchase_orders.receivedQty ≤ qty`. |

### P · Yetki — SoD üçlüsü, kapalı izin

| Adım | Yap | Bekle | Backend doğrulaması |
|---|---|---|---|
| **P1** · P (operatör izinli yönetici DEĞİL) · `shipping:invoice` olmadan Faturala | J1'i yetkisiz kullanıcıyla dene. | Düğme yok / 403. | HTTP 403 `PERMISSION_DENIED` (kod ölçülecek); `invoices` değişmedi. |
| **P2** · P · `shipping:undo-dispatch` olmadan sevk geri al | N2'yi yetkisiz dene. | 403. | `shipments` değişmedi. |
| **P3** · P · `roll:manual-adjust` olmadan Manuel Top Ekle | F6'yı yetkisiz dene. | 403. | `rolls` değişmedi. |
| **P4** · P · İzin çıkarıldıktan sonra AÇIK oturum | Yetkilendirme'de e2e-yonetici'den `customer:write`i al; açık oturumda B1'i dene. | Anında 403 (JWT `tokenVersion` bump → yeniden giriş ya da 401). | `users.tokenVersion` +1; `sessions` iptal/yenileme; `customers` değişmedi. |
| **P5** · S · Sistem hesabı panelden atanamaz | Yetkilendirme'de sistem hesabına rol ata. | Görünür ama kimlik teslim edilmez; atama reddedilir. | `user_permissions` değişmedi. |

### Q · Çoklu kullanıcı — iki tablet, aynı kaynak

| Adım | Yap | Bekle | Backend doğrulaması |
|---|---|---|---|
| **Q1** · T×2 · Aynı operatör iki tablette giriş | İkinci giriş. | Politikaya göre kick (ilk tablet 401 "başka cihazdan giriş") ya da notify 409 `SESSION_EXISTS`. | `sessions` → eski `revokedAt`+`NEW_LOGIN` (kick) / iki aktif (confirmKick). |
| **Q2** · T×2 · İki tablet aynı leventi TAK | D4'ü iki tabletten. | Biri MOUNTED, öteki 409. | `warp_beams` tek `currentMachineId`; `warp_beam_events` tek MOUNTED. |
| **Q3** · T×2 · Aynı top iki çuvala | I2'yi iki tabletten. | İkinci 409 "top zaten çuvalda". | `rolls.sackId` tek. |
| **Q4** · P+T · Panel topu iptal ederken tablet KK2 alıyor | F7 + H2 aynı anda. | Biri kazanır; öteki 409; defter tutarlı. | `roll_operations`/`rolls.status` çelişkisiz; atomik claim. |

### R · Çevrimdışı / yeniden bağlanma (tablet)

| Adım | Yap | Bekle | Backend doğrulaması |
|---|---|---|---|
| **R1** · T · Wi-Fi kapalı → 3 top gir → aç | Ham Giriş ×3. | Üçü kuyruktan gider; toast barkodlarla; sıra korunur. | `rolls` → +3, `clientEnteredAt` iki yönlü (gönderim değil giriş zamanı). |
| **R2** · T · Kuyrukta kesin 4xx | Geçersiz desenle kuyruğa al → aç. | Kayıt düşer, kullanıcıya NEDEN gösterilir; token yapışmaz. | `rolls` değişmedi; ikinci deneme YENİ token. |
| **R3** · T · Sunucu 5xx/zaman aşımı sonrası tekrar | Backend'i kısa süre durdur → gönder → başlat. | Aynı token ile tekrar; tek kayıt. | `rolls` → 1 (replay). |

### S · Rapor doğrulamaları — sayılar defterle tutarlı mı?

| Adım | Yap | Bekle | Backend doğrulaması |
|---|---|---|---|
| **S1** · P · Randıman (L1) metre toplamı | TEST-TZ1, bugün. | Rapor metresi = indirilen toplar toplamı. | `Σ rolls.initialQty (entrySource=WEAVING, tezgah TEST-TZ1, bugün)` = rapor satırı; kaynak "ölçüldü/elle" bayrağı doff'tan. |
| **S2** · P · Top İzleme (L5) | F4 topunun barkodu. | Doğum (KK1) → KK2 → Tambur → çuval → sevk → iade zinciri tam. | `roll_operations` + `roll_movements` + `shipment_events` + `roll_returns` sırası = ekrandaki zaman çizelgesi. |
| **S3** · M · Cari ekstre (J4) | TEST Müşteri. | Bakiye = Σ fatura − Σ tahsilat ± storno. | `Σ cari_transactions` (VOIDED hariç değil — ters satır var) = ekstre bakiyesi. |
| **S4** · P · İplik lotu izi (C4 → D2 → D3 → K1) | TEST-L1. | 120 − 30 + 1 − 45 + 3 − 20 + 5 − 5 = 29 kg. | `Σ yarn_movements (lot TEST-L1)` = 29; her hareketin kaynağı (mal kabul · sarım · dip · fason sevk · dönüş · storno). |
| **S5** · P · Sipariş karnesi (L4) sevk ilerlemesi | TEST-S1. | Sevk edilen 40 m (BRÜT), iade 10 m ayrı kolon. | `sack_allocations` = 40; `roll_returns` = 10; karne brütü değiştirmez. |
| **S6** · P · Vardiya karnesi (L3) duruş süresi | TEST-TZ1, bugün. | F3 duruşu süresiyle; mühürlü satır değişmez. | `machine_stop_events` toplamı = karne; mühür sonrası `PATCH` 409. |

### T · Sürüm / OTA — eski istemci ne yapar?

| Adım | Yap | Bekle | Backend doğrulaması |
|---|---|---|---|
| **T1** · S · `minVersion`i sahadakinin ÜSTÜNE yazma denemesi | `client-policy` sabitini kod incelemesinde oku. | Kural: minVersion sahadakinden BÜYÜK OLAMAZ; kod yolu review'dan geçer (panelde ayar YOK). | `GET /api/client-policy/electron` `minVersion` ≤ `sessions.clientVersion` min (son 30 gün). |
| **T2** · T · Eski JS paketiyle tablet (`minPaketTarihi`) | Eski paketi yükle, backend'i yeni tut. | Kilit yalnız güncelleme GERÇEKTEN kurulabilirse; çevrimdışıysa kilitlenmez. | `client-policy/mobil.minPaketTarihi` ↔ `Updates.createdAt`. |
| **T3** · P · Panel ilk açılış "neler değişti" | Taze profil ile aç. | Diyalog bir kez; Tamam sonrası tekrar gelmez. | `surum-notlari.json` son tur = diyalog içeriği. |
| **T4** · S · Kaldırma fazı kapısı | `test_rol_modeli_kalinti` kurulum kopyasında. | ④ kolu: pencere dolmadan ÖLÇÜLEMEDİ; 2026-10-17'den önce "AÇILABİLİR" yok. | `sessions.clientVersion` NULL sayısı son 30 gün. |

---

## 3 · Kapanış — eksikler, sadeleştirmeler, korunacaklar

Her madde bir DİLİM adayıdır; 1e iş mantığı önceliğiyle sıralar. Davranış değişikliği **bayrağın arkasında** doğar, bayrağın varsayılanı = bugünkü davranış (kullanıcı 2026-09-18: *"birden fazla yol koyarız, flag'lerle seçtiririz"*).

### 3.1 Eksikler — sektörde var, bizde yok

| Etiket | Eksik | Adım | Kaynak |
|---|---|---|---|
| **B** | Talep → icra zinciri: `WeavingOrder.orderLineId?` (Y1) + `WarpBeam.weavingOrderId?` (Y2), ikisi de opsiyonel ön-dolum kaynağı — D1/F1/F2'de +0 dokunuşla iş bağı; "bu sipariş için kaç metre dokundu" | D1 · F1 · F2 | 6e · 5e §3.1/§8 |
| **B** | Tedarikçi fatura eşleme: n irsaliye → 1 fatura + fiyat/miktar toleransı, fark varsa BLOKE (`Invoice.goodsReceiptId` tekil → pivot ya da satır bağı) | C5 | 9b [1][2] |
| **B** | Kalite kabul / karantina: iplik lotu kabulde `KALİTE BEKLİYOR`, kullanım kararıyla stoğa (`YarnLot` yalnız `isActive`) | C2 | 9b [3][4][5] |
| **K** | Sevkiyat önizlemesi emanet sahiplik çatışmasını göstermiyor: `POST /shipping/shipments/preview` `assertOwnerMatchesTx`i çağırmaz, kapı yalnız `performDispatchTx`te — operatör çatışmayı önizlemede değil "Sevk Et" reddinde (409 toast) görür; çözüm önizlemeye uyarı satırı | I4 · O6 | d9 |
| **K** | Kısmi iade yok: panel/tablet iade girişi top bazlı (`RollReturn.qty` = topun `currentQty`), "10 m geri geldi" için yol yok — sektörde iade satırı miktar taşır (kesim + iade iki adım, ya da iade satırında metraj) | I7 | d9 |
| **K** | **BRÜT ihlali:** iade sonrası sevkiyattan fatura taslağı NET çıkıyor (0 satır) — `collectShipmentInvoiceDraftLines` `roll.shipmentId`den okur, iade bağı NULL'lar; resmi belge `RollReturn` ile brütleştiriyor, taslak kurucu brütleştirmiyor (çıkış yüzeyleri ayrıştı). Çare: taslak kurucu da `RollReturn(fromShipmentId, cancelledAt NULL)` satırlarını geri eklesin; iade `SALES_RETURN` faturasıyla kapanır | N6 · J1 | d9 |
| **K** | Sevkten doğan fatura taslağında cari kilitli değil (`disabled` yalnız düzenlemede) — kaynak sevkiyatı olan taslakta cari sevk müşterisine kilitlenmeli (tür de) | J1 | d9 |
| **K** | Panel girişi: erişilebilirlik sondası yalnız açılışta koşar (`useServerReachability` mount); ⚙ diyalogdan adres kaydedilince YENİDEN SONDALANMAZ → "Sunucuya ulaşılamadı" paneli kalır, kullanıcı "Sunucuyu Ara"ya basmak zorunda — adres kaydı `recheck()` tetiklemeli | Giriş (sürücü ölçtü) | d9 |
| **O** | KK1 doff bağında desen/renk/sahip ön-dolu (doff → koşum → iş; `DOFF_SELECT` genişler) — en büyük dokunuş kazancı (F4 −3) | F4 · G2 | 6e |
| **O** | Ödeme koşulu (vade) ve para birimi KARTTA doğsun, PO ve faturaya insin; `dueDate` otomatik | B1 · C1 · C6 · J4 | 9b |
| **O** | Ödeme/tahsilat girişinde açık fatura listesi + varsayılan FIFO (`PaymentAllocation` var, UI tek ekrana) | C7 · J3 | 9b |
| **O** | PO kalemine teslim tarihi + son alış fiyatı önerisi | C1 | 9b |
| **O** | Koşum açılışında atkı sıklığı (kumaş kartı) + hedef devir (`MachineSpec`) ekranda ön-dolu; metre türetimi sessiz kalmasın | F2 | 6e |
| **O** | Kumaş kartına varsayılan çözgü kartı | F1 | 6e |
| **O** | Tezgah tabletinde "TAK" (levent paneli) | D4 | 6e |
| **O** | Son sarımdan iplik lot/depo/kg ön-dolumu | D2 | 6e |
| **O** | Duruş anında hızlı sebep düğmeleri (`quickPick`), bildirimde modal yok | F3 | 6e |
| **O** | Fazla teslim toleransı — `receivedQty > qty` denetimi **önce ölç** | C2 | 9b |
| **K** | İç lot ↔ tedarikçi lot no ayrımı; iplik lotundan başlayan izlenebilirlik raporu (**ölçülecek**) | C2 · C4 | 9b |
| **K** | Alternatif birim / min stok; çözgü kg/m türetilmiş alan; kayıtlı rapor süzgeci | B2 · B3 · L1 | 9b |
| **K** | D5 uyarısının listede kalıcı rozeti · D1 son çözgü kartı · F4 tek koşum ön-seçili + parça 1 · `autoConsume` kapalı bilgisi · doff listesi tezgaha göre · G2 sahip işten · K1 levent rozeti | D1 · D5 · F4 · G2 · K1 | 6e |
| **K** | Erişilebilirlik: PO formunda "Not" etiketi bağsız, birim fiyat kutusu adsız (sürücü yer tutucuyla buluyor) | C1 | d9 |
| **O** | Fiş kaydedilince sipariş seçicisinin önbelleği anında geçersizlensin (`staleTime` 30 sn içinde kapanmış sipariş listede kalıyor, "Gelen 0 kg" gösteriyor) | C3 · O8 | d9 |
| **K** | Tanınmayan sorgu parametresi (`status=` yerine `filter[status]`) sessizce yok sayılıyor — fail-closed kuralı 400 der; en azından liste uçlarında ölç | C3 | d9 |
| **K** | Tablet operatörü parolası sayısal olmak zorunda (number-pad) — kullanıcı formunda ipucu/doğrulama yok; yönetici alfanümerik verir, operatör giremez | A3 | d5 |
| **K** | "Saha operatörü (tüm tablet karoları)" izin şablonu yok — varsayılan operatör izinleri yalnız KK1/KK2/Tambur; devere/dokuma/sevkiyat açan fabrikada her operatöre tek tek eklenir | A3 | d5 · d9 |
| **K** | Çoklu sipariş bağında İş Emirleri listesi "birincil" müşteri olarak son bağlananı gösteriyor; iş emrini doğuran ilk müşteri rozetin arkasında kalıyor | E3 | d9 |
| **bilinçli karar** | e-Fatura/e-Arşiv (GİB UBL) — TR zorunluluğu, kapsam kullanıcıya | J2 | 9b |

### 3.2 Sadeleştirmeler — bizde fazla

| Etiket | Sadeleştirme | Adım | Kaynak |
|---|---|---|---|
| **B** | Cariler + Cari Hesaplar TEK kart: finans alanları Cariler'e sekme, hesap kartla doğar; "Cari türü" seçimi arayüzden kalkar. Kök: `Customer.type` + üç rol + `CariAccount.kind` — aynı sorunun üç cevabı (kaldırma fazı `IS-ORTAGI-ROL-MODELI.md` §7) | B1 · C6 · C7 · J3 | 9b |
| ~~**O**~~ | ~~C8 sessiz satır düşürme yerine FAIL-CLOSED~~ — **KAPANDI 2026-09-18** (sunucu 400 `RECEIPT_LINES_INVALID`, ölçüldü C8 ✅) | C8 · O2 | 9b |
| **O** | F4 tek fiziksel olay iki ekran → tezgah ekranında "İndir ve topu doğur" kısa yolu (KK1 alanları varsayılanla, sonradan düzeltilebilir) | F4 | 6e |
| **K** | Diyalog başlıkları rolü söylesin ("Yeni Tedarikçi"); B1/C0 tek giriş; J1'de türetilebilen alanlar sorulmasın; kapalı PO "Yeni Mal Kabul"da listelenmesin; "Onayla" fiş detayından; mühür satırda görünür | C0 · J1 · C3 · C5 · L3 | 9b |
| **K** | D0 türe göre ilgisiz yetenek kutuları "Gelişmiş"; D4 yöntem satırı bayrak kapalıyken gizli; F1 plan tarihleri katlanır; D2 tek makine ön-seç + tek sebepli katalogda sebep sorulmasın; D3 önek boşsa gövde no türet; F3 "Duruş Bildir" modalsız; F6 kalan boşsa kaynak sorulmasın; F7 geri alma tek kapı; F2 açık iş listesi tezgahın çözgüsüne göre | D0 · D2 · D3 · D4 · F1 · F2 · F3 · F6 · F7 | 6e |
| **K** | Güzergâh metni ekranla hizalansın: B2 düğmesi "Yeni" (belge "Yeni Ürün" diyor); adların BÜYÜK saklandığı not; seçici modallarında "arama kutusuna yaz" adımı | B2 · B1 · C1 | d9 |

### 3.3 Koru — sektörde var, burada gereksiz (eklenmesin)

PO onay/release adımı · zamanlanmış rapor gönderimi · backflush (otomatik iplik düşümü — parti başına değişen tüketim, §1.3) · ters kayıt doktrini (sektörün üstünde, dokunulmaz).

---

## 4 · Sürücü kapsamı ve ölçüm durumu

| Kapsam | Adım sayısı | Otomatik ✅ | Yazılacak ⏳ | Elle ✋ |
|---|---|---|---|---|
| Ana zincir A–M (panel) | 43 | 26 (A1 · B1–B4 · C1–C8 · D0 · E1–E3 · F1 · G1 · I4 · J1 · I7 · J2–J5 — ~7 dk; roller S · P · M; koşum sırası I4 → J1 → I7 → N6 → J2 → J3 → J4 → J5; **TESTL tam koşum 2026-09-18: 24 yeşil · 1 kırmızı (N6 = İHLAL); J4/J5 ayrıca yeşil**) | 8 | 9 (belge önizleme, yazıcı, Wi-Fi, Excel/PDF) |
| Ana zincir (tablet, d5) | 17 | 0 | 17 | — |
| Dallar N–T | 31 | 3 (N5 · O6 — I7/I4 içinde ölçülür; N6 — ayrı adım, ❌ İHLAL ölçüyor) | 25 | 3 |

**Sayılar ölçülecektir:** bu tablo belge yazıldığı andaki plandır (2026-09-18); sürücü her koşumda `sonuc.json` üretir ve gerçek kapsam ORADAN okunur — bir koşumun çıktısından kapsam iddiası türetilmez, popülasyonu bu belge tanımlar.

**Kabul ölçütü (test bitti demek için):** ① A–M ana zincir yeşil ya da her kırmızının sınıfı yazılı (ürün hatası / ortam / belge farkı) · ② N–T dallarından en az O · P · S tam · ③ kapanış listesi (3.1–3.3) 1e tarafından dilimlere çevrilmiş · ④ tablet ve panel `sonuc.json`ları aynı DB'de, aynı gün.
