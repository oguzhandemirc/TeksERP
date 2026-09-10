# Yarı mamul

> Alan kural dosyası — bu alana dokunmadan ÖNCE okunur. Kaynak: anlama turu 2026-09-05 (kök `CLAUDE.md` + `docs/history/CLAUDE-NOT-ARSIVI.md` notlarından ayrıştırıldı). Hikâye, ölçüm ve gerekçe arşivde; burada yalnız bugün geçerli kural. Sınıf: **[ÇEKİRDEK]** her kurulumda aynı · **[PROFİL]** bu fabrikanın seçimi.

> Hakem notu: 5 üye (3 kök karar notu + 2 ikincil: Fason dönüş domain kuralı, mobil sayfalama). Üçü de 2026-08-26→08-27 arasında ardışık turlar; hiçbiri ölü değil ama 2026-08-26'nın 'ayrımı bilinçli takip ETMEYEN yüzeyler' listesi (Kanban · mobil Depo · Ürün Dengesi/freeStock) ertesi günkü iki turla ÜÇ maddede de bayatladı — koddan teyitli, kısmi ezilme. Bugün canlı çelişki yok. En riskli nokta ezilme değil TUZAK: RAW_STOCK birleşiminin daraltılması (mobil Hızlı İş Emri'nin tek kaynağı, NewWorkOrderView.tsx:365) ve 'altıncı enum değeri unutuldu' sınıfı (beş vaka). Doğrulanamayan iki şey: 'Yarı Mamul (Kurşun+Tambur)' rotasının kurulup kurulmadığı ve 'prod'da SEMI_FINISHED sıfır' ölçümünün bugünkü değeri (DB yasak).


## Ortak (backend + panel + tablet)


### Değişmezler

- **[ÇEKİRDEK]** `Roll` YALNIZ kumaş kaleminden doğar: `createInitialEntry` kapısı FAIL-CLOSED'dur ("`FABRIC` ise geç", "`CONSUMABLE` değilse geç" DEĞİL) — enuma dördüncü tür eklendiği gün sessizce barkodlu top doğmasın. İplik kg defterine gider (`YarnMovement`); kapı serviste olduğu için dört çağıranı (mal kabul · elle ekleme · tambur manuel ×2) birden kapatır. · bekçi: `test_goods_receipt.ts` §A10 <sub>(arşiv:2026-09-11)</sub>
- **[ÇEKİRDEK]** `rollScope` FAIL-CLOSED: tanınmayan kapsam 400 atar. `delete where.rollScope` koşulsuz koştuğu ve istemci `status:'ALL'` gönderdiği için sessiz kalmak CANCELLED/SHIPPED/SCRAP dahil TÜM tabloyu döndürür — hata yok, log yok. <sub>(CLAUDE.md:92)</sub>
- **[ÇEKİRDEK]** Yarı mamul rafta duran, üretime sokulabilir maldır: ARZDAN DÜŞÜLMEZ, ayrı GÖSTERİLİR. `malzemeAcigi = max(0, uretilecek − (ham + yariMamul))` — ikisi birden düşülür. Arzdan düşmek olmayan bir kumaş açığı uydurur (negatif sonda: 400 m talepte 200 m sahte açık). · bekçi: `Teks-Erp/scripts/test_semi_finished_surfaces.ts §4 ("toplam korunuyor")` <sub>(CLAUDE.md:90)</sub>
- **[ÇEKİRDEK]** Aynı stok sorusuna bakan üç yüzey TEK rakam basar: Stok Karnesi ↔ Envanter rozeti ↔ Kanban kolonu. Kanban stok kolonu bu yüzden `currentStepId: null` koşulunu taşır ve kapsam tanımları Envanter `rollScope` zinciriyle BİREBİRDİR; ayrışırlarsa aynı soruya iki rakam doğar. · bekçi: `Teks-Erp/scripts/test_production_flow_columns.ts (kolon toplamı ↔ Envanter kapsa` <sub>(CLAUDE.md:91)</sub>
- **[ÇEKİRDEK]** Envanter ekranında bir kova ayrıldıysa RAPOR da aynı turda ayrılır (Stok Karnesi `semiQty`/`semiCount`, aynı `rollScope` ayrımıyla) — yoksa 'ekran 800 / rapor 950' çelişkisini biz üretiriz. Yaş kovaları, ölü stok ve `byItem` yalnız `finished` üzerinde çalıştığı için dokunulmaz. <sub>(CLAUDE.md:92)</sub>
- **[ÇEKİRDEK]** `STOCK` bir STATÜdür; topun hangi envanter sekmesinde görüneceğini `entrySource` belirler. Kullanıcı-görünür metni statüden türetme: kapanış dispozisyonu etiketi 'Ham stok' değil 'Stoğa geri', iptal geri alma mesajı yarı mamul topu için 'yarı mamul stoğunda' der. · bekçi: `Electron .../WorkOrderCompleteDialog.test.tsx:151-162` <sub>(CLAUDE.md:90)</sub>
- **[ÇEKİRDEK]** Fason kabulünde orijinal rulolar `SUBCONTRACTOR_CONSUMED` ile emekliye ayrılır; makbuz üzerinden `parentReceiptId`'li YENİ açık-kumaş Roll'lar doğar (`entrySource=SUBCONTRACTOR_RETURN`, barcode null). Kabulde metraj ZORUNLU, ağırlık opsiyonel; kesin ölçüm sonraki istasyonun `FINISH`'inde damgalanır. <sub>(CLAUDE.md:178)</sub>

### Yasaklar

- **[ÇEKİRDEK]** `rollScope=RAW_STOCK` ham + yarı mamulün BİRLEŞİMİDİR ve DARALTILMAZ: mobil Hızlı İş Emri top seçicisinin tek kaynağıdır, tablette üçüncü sekme yoktur — daraltmak o topların üretime alınmasının sahadaki tek yolunu kapatır. · bekçi: `Teks-Erp/scripts/test_semi_finished_entry.ts §5 (birleşim = dar kapsamların topl` <sub>(CLAUDE.md:92, CLAUDE.md:91)</sub>

### Kararlar

- **[PROFİL]** Yarı mamul için ayrı DEPO açılmaz — değişen yalnız GÖRÜNÜMdür (ayrı sekme/kolon); statü, `entrySource` ve stok mekaniği ham stokla aynı kalır. Fabrikada ayrı deponun fiziksel karşılığı yok. <sub>(CLAUDE.md:92)</sub>

## Panel (Electron)


### Yasaklar

- **[ÇEKİRDEK]** Sekmeye bağlı aksiyonlar AÇIK sekme listesiyle yazılır; 'X değilse göster' gibi negatif koşul, aynı gövdeyi kullanan Kartela ve Top Arşivi sayfalarına buton sızdırır. <sub>(CLAUDE.md:92)</sub>

### Tuzaklar

- **[ÇEKİRDEK]** `ROLL_TABS`'a sekme eklenip `buildRollForceFilters`'a dal yazılmaması TİP HATASI VERMEZ ve kapsamsız liste doğurur; ayrıca 'Ham Stok' sekmesi birleşik `RAW_STOCK` kapsamını KULLANMAZ (dar ikizi gönderir). · bekçi: `Electron/src/pages/Operations/Rolls/service.test.ts` <sub>(CLAUDE.md:92)</sub>

### Reçeteler

- **[ÇEKİRDEK]** Sipariş karşılamada `netGap` DEĞİŞMEZ (ham havuzu zaten sayılmıyordu); yalnız bilgi alanı `freeSemiFinished` eklenir. Electron onu OPSİYONEL okur (`?? 0`) ve backend ÖNCE deploy edilir, yoksa ipucu sessizce kaybolur. · bekçi: `test_semi_finished_surfaces.ts:131-150` <sub>(CLAUDE.md:90)</sub>
- **[PROFİL]** Manuel Giriş'te renk seçili + yarı mamul kutusu işaretsizse AMBER UYARI çıkar (engel DEĞİL — renkli bitmiş mal girmek meşru); Yarı Mamul sekmesinden açılınca kutu ön-işaretli gelir ama GÖRÜNÜR kalır. <sub>(CLAUDE.md:92)</sub>
- **[PROFİL]** Stok Karnesi'nde beşli kart sırası yalnız 1280px'ten itibaren açılır (`lg:grid-cols-3 xl:grid-cols-5`); 1024px'te 5 kart sıkışıp rakamı iki satıra kırıyordu. <sub>(CLAUDE.md:91)</sub>

### Kararlar

- **[ÇEKİRDEK]** 'Üretime Al' düğmesi Ham Stok ve Yarı Mamul sekmelerinde de çizilir; backend `quickStart` baştan beri STOCK/WAREHOUSE/A1_STOCK kabul ediyordu, yeni izin kodu açılmadı (`workorder:write` yeter). <sub>(CLAUDE.md:92)</sub>

## Tablet (mobil)


### Değişmezler

- **[ÇEKİRDEK]** Liste sayfalamada VARSAYILAN cursor (keyset) + infinite scroll'dur; offset/`page`+`pageSize` yalnız açıkça istenirse ya da kalıcı küçük tablolarda. `Roll`/`RollMovement`/`RollOperation` ve log geçmişleri HER ZAMAN cursor — offset `MAX_OFFSET=10000`'de 400 verir, her sayfada COUNT(*) tazeler. <sub>(CLAUDE.md:424)</sub>

### Reçeteler

- **[PROFİL]** Mobil Depo 'Ham'/'Yarı Mamul' sekmeleri `rollScope=RAW_STOCK_PURE`/`SEMI_FINISHED` + `status:'ALL'` gönderir, düz `status:'STOCK'` GÖNDERMEZ; 'Tümü' sekmesi bilerek statü tabanlı kalır. Ham Stok ve Yarı Mamul kolon/sekme renkleri AYRI tondadır (komşu kolonlarda sayaçlar karışır). <sub>(CLAUDE.md:91)</sub>
- **[ÇEKİRDEK]** Cursor sözleşmesi: `GET /rolls?mode=cursor&limit=N&cursor=...&withTotal=true`; toplam YALNIZ ilk sayfada ve YAKLAŞIKtır. Benzer uçlarda aynı `mode=cursor` sözleşmesi izlenir (`utils/cursor.ts`, `rollService.getAllCursor`). <sub>(CLAUDE.md:424)</sub>

## Geçersiz kılınan kurallar — bunlara UYMA

- **TAM** `docs/history/FABRIKA-TALEP-2026-08-17.md §9 (kök notta alıntılı)` → `R:2026-08-26__2026-08-26-yari-mamul-kendi`: Yarı mamulün Ham Stok listesinde FİLTREYLE süzülmesi kararı düştü; yerine ayrı SEKME kuruldu (ayrı DEPO yine yok). Kodda üç ayrı kapsam dalı var: inventory.service.ts:1466/1482/1492 ve Electron buildRollForceFilters RAW_STOCK sekmesine RAW_STOCK_PURE gönderiyor. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-26__2026-08-26-yari-mamul-kendi` → `R:2026-08-27__2026-08-27-2-tur-yari`: Kanban 'hamStok' kolonunun ayrımı takip ETMEMESİ (bilinçli sayılan) kararı kalktı: kolon ikiye ayrıldı (hamStok/yariMamul) ve eski `currentStepId` boşluğu da kapandı — kolon artık Envanter rollScope zinciriyle birebir. ✅ çürütmeden geçti
- **KISMI** `R:2026-08-26__2026-08-26-yari-mamul-kendi` → `R:2026-08-27__2026-08-27-2-tur-yari`: Mobil Depo 'Ham' sekmesinin düz `status:STOCK` göndermesi ve bunun 'APK işi' diye ertelenmesi geçersiz: sekme ikiye ayrıldı, rollScope kullanıyor ve dağıtım OTA ile yapıldı (saf JS, native parmak izi değişmedi). ✅ çürütmeden geçti
- **KISMI** `R:2026-08-26__2026-08-26-yari-mamul-kendi` → `R:2026-08-27__2026-08-27-3-tur-yari`: 'Ürün Dengesi ve sipariş freeStock dokunulmadı' maddesi bayat: ikisine de yarı mamul kovası eklendi (yariMamul, freeSemiFinished). ⚠️ Ezilen şey yalnız GÖSTERİM; arz davranışı DEĞİŞMEDİ — eski notun gerekçesi ('yarı mamul gerçekten arzdır') 3. turda kural mertebesine yükseldi. ✅ çürütmeden geçti

## Açık sorular

- Panelden 'Yarı Mamul (Kurşun + Tambur)' rotasının kurulup kurulmadığı ve `mobile:kk1-yari-mamul` izninin atanıp atanmadığı doğrulanamadı (DB'ye dokunmak yasak) — kurulum kontrol listesinde AÇIK madde sayılmalı.
- 2026-08-26 ve 3. turun 'prod'da SEMI_FINISHED kaydı SIFIR' ölçümü bugün geçerli mi bilinmiyor; yüzeyler o günden sonra açıldı, sayı değişmiş olabilir.
- 2026-08-26'nın 'tablette üçüncü bir sekme YOK' gerekçesi kısmen bayat: mobil DEPO'ya Yarı Mamul sekmesi eklendi (DepoScreen.tsx:78), ama Hızlı İş Emri top seçicisi hâlâ birleşik RAW_STOCK kullanıyor (NewWorkOrderView.tsx:365) — yani DARALTMA yasağı aynen geçerli, gerekçe cümlesi güncellenmeli.

## Bekçiler — bu alana dokununca koş (3 backend · 0 istemci)

`cd Teks-Erp && npx tsx scripts/run-all-tests.ts <ad-parçası>` (tek testte tip kapısı atlanır) · Electron `npx vitest run <yol>` · mobil `npx jest <yol>`.

**Ne ölçtükleri, DB gerektirip gerektirmedikleri ve bayatlık işaretleri: `Teks-Erp/docs/BEKCI-HARITASI.md` → bu alanın bölümü.** ⚠️ = orada gerekçesi yazılı bayatlık şüphesi.

Backend: `test_production_flow_columns`, `test_semi_finished_entry`, `test_semi_finished_surfaces`

## Arşiv notları (tam metin, gerekçe ve ölçüm)

- 2026-08-26 · 2026-08-26 — Yarı mamul: filtre yetmedi, sekme oldu · ham stoktan iş emri açılamıyordu — `CLAUDE-NOT-ARSIVI.md:1011-1116`
- 2026-08-27 · 2026-08-27 (ikinci tur) — Yarı mamul ayrımı Kanban'a ve tablete taşındı + Kanban'ın ESKİ sapması — `CLAUDE-NOT-ARSIVI.md:1656-1729`