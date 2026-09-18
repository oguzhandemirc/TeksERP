# Çıkarım — Tanımlar (B) · Alış zinciri (C) · Finans (J) · Raporlar (L)

9b · 2026-09-18 · kullanıcı isteği 03:58: "test ederken çıkarım yap, sektörle karşılaştır, eksiği tamamla; hedef daima daha kolay yol".
**Kaynak:** güzergâh `kullanici-testi.html` (B · C · J · L adımları; 1e "L/M" dedi — dosyada finans **J**, raporlar **L**, M süperadmin kapsam dışı) ·
şema ölçümü (`schema.prisma`: Customer/CariAccount/PurchaseOrder/GoodsReceipt/YarnLot/Invoice/Payment/Cheque) · `docs/design/URETIM-BELGE-ZINCIRI.md` §1/§9 (`811727e3`) ·
web: SAP MM üçlü eşleme/tolerans [1][2], SAP QM giriş muayenesi (01 tipi, kalite stoğu, kullanım kararı) [3][4], Datatex NOW satın alma/kalite/lot [5][6].
**Okuma kuralı:** ② sütunundaki "EKSİK" iddiadır, sektör kaynağı pazarlama metnidir; **bizdeki yokluk** ise şemadan ölçüldü (kolon/model yok). "ölçülmedi" yazan yer kod okunmadan yazılmadı.

| Adım | ① Sahadaki kişi için sürtünme ("daha kolay yol var mı?") | ② Sektör aynı adımı nasıl yapar → bizde EKSİK | ③ Bizde FAZLA karmaşıklık → sadeleştirme |
|---|---|---|---|
| **B1** Yeni Cari | 4 dokunuş derinlik (Tanımlar → İş Ortakları → Cariler → Yeni); "Sevk varsayılanı" kart açılırken sorulur (ilk sevkte sorulabilir) | SAP vendor master: ödeme koşulu · para birimi · banka/IBAN · vergi dairesi KARTTA doğar [1]. Bizde bu alanlar `CariAccount`ta ve o kayıt **ilk fatura/ödemeyle** doğuyor (C6) → vade/para birimi kart açılırken YOK | Rol üç kutu (`isCustomerRole/isSupplierRole/isSubcontractorRole`) **ve** `type CompanyType` — aynı bilgi iki kolonda; tek küme kalsın |
| **B2** Yeni Ürün | Kod otomatik, birim tipten — iyi; "Yeni Ürün" diyaloğu tür değişince alan gizler (iyi) | Malzeme ana verisi: alternatif birim (kg ↔ bobin), min stok / yeniden sipariş seviyesi, tedarikçi malzeme kodu. Bizde bobin yalnız hareket kolonu (`YarnMovement.bobbinCount`), min stok YOK | — |
| **B3** Çözgü kartı | Tel adedi · take-up · tarak — uzman alanı, tamam | Çözgü kg/m (tel × denye ÷ 9.000) kartta türetilmiş gösterilir (Datatex ara seviye hesabı [6]); bizde hesap yalnız levent sarımda | — |
| **B4** Makine | Önce istasyon kartı bulunmalı; "Makine ekle" istasyonun içinde (bağlam doğru) | İş merkezi: hedef devir + vardiya kapasitesi — bizde `MachineSpec` var (ölçülmedi: alanlar) | — |
| **C0** Tedarikçi kartı (tekrar) | Diyalog başlığı **"Yeni Müşteri"** tedarikçi için de aynı → anlaşılmaz metin; B1 ile aynı kart iki adımda | — | Güzergâhta iki kez tanım (B1 + C0): tek giriş noktası; başlık rolü söylesin |
| **C1** Alış siparişi | Tedarikçi + ürün modalları iyi; birim fiyat elle; beklenen tarih SİPARİŞ başına | SAP PO: fiyat **info record**/son alıştan gelir, ödeme koşulu tedarikçiden kopyalanır, teslim tarihi **kalem** başına [1]. Bizde `PurchaseOrder`da vade YOK, `PurchaseOrderLine`da tarih YOK, son fiyat önerisi YOK (`ItemPrice` satış tarafı) | Onay/release adımı yok — küçük fabrika için DOĞRU, eklenmesin |
| **C2** İrsaliyeli mal kabul | Siparişten otomatik doldurma iyi; lot + bobin satırda; lot hatası satırda kırmızı (erken) iyi; "Top sınıfı" segmenti kumaşta | SAP GR: **fazla teslim toleransı** + QM **01 muayene partisi → kalite stoğu → kullanım kararı** [3][4]; Datatex "quarantine inspection" [5]. Bizde iplik doğrudan kullanılabilir stoğa düşer: kalite kabul/karantina statüsü YOK (`YarnLot` isActive tek); tedarikçi lotu = bizim lot (iç lot no + tedarikçi lotu ayrımı yok) | Fiş düzeyi "ham stok" kutusu kalkmış (iyi). Kalan: irsaliye no fişte tek alan, iyi |
| **C3** İkinci kabul | "0 satır eklendi" — doğru davranış | PO tam teslimde otomatik kapanır; bizde `CLOSED` `receivedQty`den — aynı | Boş diyalogu elle iptal: sipariş kapalıysa "Yeni Mal Kabul"da seçilmesin |
| **C4** İplik Stoğu | Üç görünüm tutarlı | Lot izlenebilirliği "iplik lotu → levent → top" tek raporda (Datatex lot trace [5]); bizde `production/batch-trace` TOP partisi; iplik lotundan başlayan iz **ölçülmedi** | — |
| **C5** Fişten alış faturası | 1 fiş → 1 fatura tek tıkla iyi; onay için Muhasebe → Faturalar'a gidiş | SAP MIRO: **n irsaliye → 1 fatura**, fiyat/miktar **tolerans** dışında otomatik **bloke** (MRBR) [1][2]. Bizde `Invoice.goodsReceiptId` tekil (n:1 YOK), PO fiyatı ↔ fatura fiyatı farkı denetimi YOK | "Onayla" fiş detayından da verilsin (bağlam değişmesin) |
| **C6** Onay + Cari Hesap | Cari hesap faturayla **kendiliğinden doğuyor**, vade sonra düzeltiliyor → o faturanın `dueDate`i vadesiz | Vade tedarikçi kartından faturaya iner [1]; bizde `paymentTermDays` hesapta ama hesap geç doğuyor | **Cariler ↔ Cari Hesaplar** iki ekran, iki kimlik (`Customer` + `CariAccount kind`): finans alanları Cariler kartına sekme; hesap kartla doğsun |
| **C7** Ödeme | "Cari türü **Müşteri** → TEST Tedarikçi" (`CariKind` CUSTOMER tedarikçiyi de kapsıyor) → anlaşılmaz metin; kasa yoksa Kasa & Banka'ya gidiş; eşleme **ayrı ekranda** (Fatura Kapama) | SAP F-53 / Logo: ödeme girerken **açık kalemler listelenir**, seçilir/FIFO kapanır — tek ekran. Bizde `PaymentAllocation` var, ama giriş anında değil | Ödeme diyaloğuna "açık faturalar" listesi + varsayılan FIFO; "Cari türü" seçimi kalksın (karttan türer) |
| **C8** Lot zorunlu | Sunucu satırı **sessizce düşürür**, fiş SATIRSIZ doğar → iptal gerekir; toast geç | Doğrulama kaydı BLOKE eder (SAP: zorunlu alan eksikse belge kaydedilmez) | Satır düşürme yerine fişi reddet (fail-closed) ya da düğmeyi kapat (satır kırmızı zaten var) |
| **J1** Sevkten fatura | Tür/cari türü **sorulur** ama sevkten türer | — | Türetilebilen alan sorulmaz: tür=satış, cari=sevk müşterisi ön-dolu ve kilitli |
| **J2** Onay + yazdır | İki adım (taslak → onay) doğru | TR: **e-Fatura/e-Arşiv** (GİB UBL) çıkışı — bizde YOK; bilinçli karar ister | — |
| **J3** Tahsilat | C7 ile aynı: eşleme ayrı ekran; "Makbuz" iyi | Açık kalem seçimi girişte [1] | C7 ile ortak sadeleştirme |
| **J4** Yaşlandırma → ekstre | İyi; "Belge tipi yalnız dökümü daraltır" şerhi gerekli | Yaşlandırma kovaları `dueDate` ister → C6 vade eksiği burada görünür | — |
| **J5** Kasa defteri · KDV | İyi; Excel meta satırı iyi | Dönem kapanışı var (`CashPeriodClose` · `CariPeriodClose`) — sektörle aynı | — |
| **L1** Randıman | Lot kutusuna yazıp Enter; seçenekler daralmıyor (bilinçli) | Rapor **varyantı/kayıtlı süzgeç** (SAP variant) — bizde YOK | — |
| **L2** Excel/PDF/Yazdır | İyi (dosya adında pencere, başlıkta süzgeç) | Zamanlanmış gönderim — küçük fabrika için gereksiz | — |
| **L3** Pareto · Karne · Mühür | Mühür satır menüsünde (⋯) gizli | — | Mühür düğmesi satırda görünür olsun (tek dokunuş) |
| **L4** Sipariş karneleri | "müşteri varsayılanı" niteleyicisi iyi | — | — |
| **L5** Hub · Top İzleme | "Bu rapor neyi cevaplar" cümlesi iyi | — | — |

## Eksikler (bizde yok → aday)

- **büyük** — Tedarikçi fatura eşleme: n irsaliye → 1 fatura + fiyat/miktar toleransı, fark varsa fatura **bloke** (C5). Şema: `Invoice.goodsReceiptId` tekil → pivot ya da fatura satırı ↔ fiş satırı bağı.
- **büyük** — Kalite kabul / karantina: iplik lotu kabulde `KALİTE BEKLİYOR` statüsü, kullanım kararıyla stoğa (C2). Bugün `YarnLot` yalnız `isActive`; kabul edilen mal anında sarılabilir.
- **orta** — Ödeme koşulu (vade günü) ve para birimi **kartta** doğsun, PO ve faturaya insin; `dueDate` otomatik (B1 · C1 · C6 · J4).
- **orta** — Ödeme/tahsilat girişinde açık fatura listesi + varsayılan FIFO eşleme (C7 · J3). `PaymentAllocation` var; UI tek ekrana taşınır.
- **orta** — PO kalemine teslim tarihi + son alış fiyatı önerisi (C1).
- **orta** — Fazla teslim toleransı: `receivedQty > qty` denetimi **ölçülmedi** (C2) — önce ölç.
- **küçük** — İç lot no ↔ tedarikçi lot no ayrımı (C2); iplik lotundan başlayan izlenebilirlik raporu (C4, **ölçülmedi**).
- **küçük** — Alternatif birim / min stok (B2); çözgü kg/m türetilmiş alan (B3); kayıtlı rapor süzgeci (L1).
- **bilinçli karar** — e-Fatura/e-Arşiv (J2): TR zorunluluğu, kapsam kararı kullanıcıya.

## Sadeleştirmeler (bizde fazla → kaldır/birleştir)

- **büyük** — Cariler + Cari Hesaplar tek kart: finans alanları Cariler'e sekme, hesap kartla doğar; `CariKind`/"Cari türü" seçimi arayüzden kalkar (C6 · C7 · J3). Kök: `Customer.type` + üç rol boolean + `CariAccount.kind` — aynı sorunun üç cevabı (B1).
- **orta** — C8 sessiz satır düşürme yerine fail-closed: lot zorunluysa fiş oluşmaz, hata satırda.
- **küçük** — Diyalog başlıkları rolü söylesin ("Yeni Tedarikçi"), C0/B1 tek giriş; J1'de türetilebilen alanlar sorulmasın; kapalı PO "Yeni Mal Kabul"da listelenmesin (C3); "Onayla" fiş detayından (C5); mühür satırda görünür (L3).
- **koru** — PO onay/release adımı, zamanlanmış rapor: sektörde var, burada gereksiz; eklenmesin.

## Kaynaklar

[1] SAP MM MIRO / üçlü eşleme — https://medium.com/@kaurgurpreetsap/miro-in-sap-mm-where-procurement-ends-and-financial-accountability-begins-dde979df9b63 · https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/sap-threeway-match-functionality-amp-configuration/ba-p/12948178
[2] Tolerans anahtarları ve bloke — https://community.sap.com/t5/enterprise-resource-planning-blog-posts-by-members/invoice-tolerance-keys-an-insight-part-1/ba-p/13085884 · https://www.doxis.com/en/blog/goods-receipt-checks
[3] SAP QM giriş muayenesi (01) — https://learning.sap.com/learning-journeys/configuring-sap-s-4hana-quality-management/describing-quality-management-at-goods-receipt
[4] Kullanım kararı / kalite stoğu — https://www.tutorialspoint.com/sap_qm/sap_qm_usage_decision.htm · https://www.guru99.com/incoming-inspection-material-sap-qm.html
[5] Datatex NOW satın alma (lot/kalem kabul, fazla teslim, kalite, karantina, fatura eşleme) — https://datatex.com/portfolio-items/purchase-digital-textiles/ · https://datatex.com/portfolio-items/inventory/
[6] Datatex NOW kalite modülü + çok seviyeli yapı — https://datatex.com/ensuring-excellence-quality-management-with-datatex-now-erp/ · `URETIM-BELGE-ZINCIRI.md` §1.2/§9 (`811727e3`)
