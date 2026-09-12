# Tek senaryoya çakılı varsayım — TARAMA (backend + mobil)

> **Ne bu belge:** 2026-09-12 gecesi yapılan iki turluk taramanın ham bulguları.
> Kaynağı `teks-erp-9b` (Fable) oturumu; salt okuma, kod/şema DOKUNULMADI.
> **Kararlar ayrı belgede:** `CAKILI-VARSAYIM-KARAR.md`.
>
> **Neden var:** kullanıcının doktrini — *"her seçeneği uygulayan firma gerçek
> hayatta mevcut, biz hepsine hitap ediyoruz"*. Bu tarama, kodda **saha gerçeği
> sabitlenmiş ama hiçbir mekanizma sunulmamış** yerleri arıyor. Meşru üç kardeşi
> ([ÇEKİRDEK] · VERİ · BAYRAK/AKSİYON) listeye **girmez**.
>
> ⚠️ **Bu bir RİSK listesidir, ARIZA listesi DEĞİL.** Bir madde ancak *bu
> kurulumda tetiklendiği ölçülerek* arızaya dönüşür. Mobil turda iki madde tam
> bu ölçümle daraldı.

---

# "Tek senaryoya çakılı varsayım" taraması — en tehlikeli 10 (2026-09-12 gece, Fable)

> **Bu bir ENVANTER DEĞİL, TARAMADIR.** Kapsam en sonda; kapsanmayan alanlar adıyla yazılı. Dört bağımsız tarama (tek-lik · sıra/ön koşul · birim/biçim/zaman · panel+tablet) 71 aday üretti; birleştirme sonrası 22 kök; ilk 10'un her satırı kaynaktan **elle doğrulandı** (dosya:satır okundu), yalnız ajan beyanına dayanmadı. Sıralama = kırılma maliyeti × karşı-fabrika olasılığı. Kod/şema DOKUNULMADI; tarama salt okuma.
>
> Sınıflandırma: ② VERİ · ③ AKSİYON ANINDA · ④ BAYRAK. "ÇEKİRDEK sayılıp dışarıda bırakılanlar" bölümü negatif sondadır: karşı senaryo kurulamayan aday listeye girmedi.

## İlk 10

### 1. Kalite kodu STRING LİTERAL — `"FIRE"` / `"A1"` / `"1.KALITE"` (8 site, 3 kod tabanı)
- `Teks-Erp/src/services/inventory.service.ts:1483` (liste süzgeci `qualityGrade != "FIRE"`) · `:2259` (raw SQL özet, aynı literal) · `tambur.service.ts:2673-2677`, `:3093-3095`, `:3523-3524` (çocuk top doğuşu kod literaliyle) · `sack-search.service.ts:347` (`qualityCodes.includes("A1")`) · `helpers/sack-content-mismatch.helper.ts:226` (`qualityGrade === "A1"`) · `mobil/src/screens/Modules/Tambur/TamburScreen.tsx:203` + `:1932-1945` (`DEFAULT_QUALITY_CODE='1.KALITE'`, katalogda yoksa `targetStatus` **WAREHOUSE'a düşer**) · `mobil/.../shortCutQuality.ts:28` (`'A1'`).
- **Varsayım:** fabrikanın kalite kataloğunda tam bu üç kod vardır.
- **Karşı-fabrika:** kataloğu `1K / 2K / HURDA` (ya da `1.KALİTE / 2.KALİTE / ÇÜRÜK`, iki fire kademesi `FIRE + 2.FIRE`) olan her fabrika — kod ALANI serbest metindir (`quality-grade.adapter.ts:29` "Kodu SİZ yazarsınız"), `schema.prisma:2944` "Kod gömmek reddedildi" der ve tam bu süzgeci örnek verir.
- **Mekanizma:** **② VERİ — zaten var, kullanılmıyor:** `QualityGrade.targetStatus` + `loadProducedBuckets().fireCodes/a1Codes` (`roll-finalize.helper.ts:73-98`; `workorder.service.ts:1925` doğru kullanıyor). Tablet için `targetStatus === SCRAP/A1_STOCK` ile katalogdan çözme; "varsayılan kalite" için katalogda `isDefault` (veri).
- **Kırılma:** SESSİZ YANLIŞ VERİ, para: tambur fire kesimi `FIRE` kodu katalogda yoksa `qualityGradeId=null` → `resolveCutStatus` WAREHOUSE → **fire satılabilir stok ve iyi üretim metrajı sayılır**; envanter özeti ile iş emri ekranı aynı fabrikada iki farklı toplam basar; tablet kesimi hiç var olmayan kodla WAREHOUSE'a yazar.
- **Olasılık:** YÜKSEK (ikinci müşteride kesin).

### 2. Miktar zinciri METRE'ye kaynaklı, `Item.unit` (MT/KG/ADET) mal kabul dışında hiç okunmuyor
- `Teks-Erp/prisma/schema.prisma:2439` (`OrderLine.quantity // meters`), `:2443` (`shippedQty` Σ `SackAllocation.qty` ← `Roll.currentQty` metre) · `helpers/shipment-auto-draft.helper.ts:87` ("MİKTARIN BİRİMİ DEFTERİN BİRİMİDİR 'm', kalem kartının unit'i DEĞİL") · `invoice.service.ts:399`/`:815` `unit: l.unit ?? "m"` · `shipping.service.ts:5528` · `Electron/.../invoiceDraftLines.ts:72` `unit: l.unit || "m"`.
- **Varsayım:** kumaş her yerde metreyle alınıp satılır.
- **Karşı-fabrika:** örme (süprem/interlok/polar) kumaşı **kiloyla** satan her örmeci — Türkiye örme ticaretinin normu; ayrıca havlu/battaniye **adet**.
- **Mekanizma:** **② VERİ** — `OrderLine.unit` (kalem kartından miras, `ItemUnit` zaten var) + karşılama Σ'sının birim ölçüsünü `Roll.currentQty` (m) yerine ilgili büyüklükten alması. Bayrak değil: aynı fabrika kumaşı metre, ipliği kilo satar (satır bazında değişir).
- **Kırılma:** SESSİZ YANLIŞ VERİ + para: 1000 kg'lık sipariş ~1000 m sevkte KAPANIR; fatura taslağı kg miktarına metre fiyatı çarpar, "m" basar.
- **Olasılık:** YÜKSEK (örmeci profili); dokumacıda düşük.

### 3. Kantar/metre cihazının "Birim" alanı YAZILIYOR, HİÇBİR YERDE OKUNMUYOR — her okuma kg/m sayılıyor
- `Teks-Erp/prisma/schema.prisma` `PeripheralDevice.unit VarChar(8) // "m" / "kg"` · form `Electron/src/pages/PeripheralDevices/PeripheralDeviceFormDialog.tsx:273` (`label="Birim"`, placeholder "m / kg") · `Electron/src/hooks/useMachineScale.ts:71` (`unit: "kg"` sabit) · `Electron/src/lib/scale-read.ts:68-74` (yalnız `decimals`/`scale`; `{ kg: v }`) · `mobil/src/hooks/usePeripheralIO.ts:44-49` (codec `decimals`/`scale`/`pattern`; `unit` düşürülür). grep: iki istemci + backend'de `unit` tüketicisi 0.
- **Varsayım:** her kantar kg, her metre cihazı m basar; alan süs.
- **Karşı-fabrika:** ham çıktısı **gram** olan sevkiyat kantarı (çuval ölçeğinde yaygın modeller), **cm** basan tambur metre sayacı. Kurulumcu etiketli "Birim" kutusuna `g` yazar, "Ölçek"i 1 bırakır (iki alan aynı şeymiş gibi durur).
- **Mekanizma:** **② VERİ** — ya `unit` okunup `scale`a çevrilir, ya alan kaldırılıp yalnız `scale` kalır (tek yüklem). Bugünkü hâl "çift yüklem"in en kötü türü: biri okunuyor, biri sahne dekoru.
- **Kırılma:** SESSİZ YANLIŞ VERİ, yasal belge: 14,5 kg çuval `weighSack({weightKg: 14500})` kabul, irsaliye/çeki listesinde **14,5 ton**. Düzeltme bir satır.
- **Olasılık:** ORTA (cihaz çeşidine bağlı) — ama maliyet en yüksek sınıfta, düzeltme en ucuz.

### 4. "Rotada bir kind'dan EN FAZLA BİR adım vardır; ilki 'o' adımdır" — kart okutma sequence'ta ilkine gider
- `Teks-Erp/src/services/helpers/roll-step.helper.ts:365-369` (`assertWoAtStepKind`: `findFirst({station:{kind}}, orderBy stepSequence asc)`) · `kursun-qc.service.ts:245-252` (ilk `QUALITY_STATION_WHERE` adımı COMPLETED ise özet döner → tablet "yeniden aç?" sorar) · `tambur.service.ts:3943` (boş kart kurtarma: ilk TAMBUR adımı) · panelde uyarı yalnız KAYNAK YORUMUNDA: `Electron/src/pages/Stations/StationFormDialog.tsx:136-139`.
- **Varsayım:** bir iş emrinde tek KK, tek Tambur.
- **Karşı-fabrika:** boya ÖNCESİ ham KK + boya SONRASI son KK (standart); iki tambur geçişi (`Tambur → Boyahane → Tambur`). Kod tabanı ikinci KK istasyonunu tanımlamak İÇİN `QUALITY_STATION_WHERE` yazdı (`quality-station.helper.ts:100`), route.service yalnız `sequence` çakışmasını reddeder → panelden bugün kurulabilir.
- **Mekanizma:** **② VERİ — oturumun istasyonu:** adım `kind`tan değil `step.stationId === session.stationId` ile seçilir (`tambur-manual.service.ts:281` zaten böyle yapıyor). Bayrak değil: aynı fabrika bir rotada tek, ötekinde iki KK kullanır.
- **Kırılma:** ikinci istasyonda yanıltıcı 400 ("yanlış istasyonda okuttunuz") + **sessiz yanlış adım**: ilk adımda açık hareket varken ikinci istasyonun kesimi/KK'sı **ilk adıma yazılır**; kurtarma yolu topu yanlış adıma taşır; kurşun bypass sessizce kapanır (StationFormDialog yorumu).
- **Olasılık:** YÜKSEK.

### 5. "Rengi olan top mamul, renksiz top hamdır" — doğuş statüsü ve barkod sınıfı `colorId`den
- `Teks-Erp/src/services/inventory.service.ts:988-989` (`colorId != null ? WAREHOUSE : STOCK` + `F`/`H` barkod) · `workorder.service.ts:6299` (detach: `colorId == null ? STOCK : final`) · `dashboard.service.ts:137` (`"colorId" IS NULL` ham giriş sayacı, üstelik istasyona korelasyonsuz join).
- **Varsayım:** ham kumaş her zaman renksiz gelir.
- **Karşı-fabrika:** iplik boyalı / renkli ham alan fabrika (denim, ekose gömleklik, renkli ham üstüne zımpara-kaplama rotası), boyalı ham alıp yalnız apre yapan işletme.
- **Mekanizma:** **③ AKSİYON ANINDA** — girişte "ham / mamul" seçimi (controller zaten `semiFinished` alıyor ama servise geçirmiyor: `inventory.controller.ts:282,302`), varsayılanı kalem kartından (② `ItemType`/`isRaw`). Bayrak değil: aynı fabrika bir gün renkli ham, bir gün mamul alır.
- **Kırılma:** SESSİZ YANLIŞ VERİ: renkli ham `WAREHOUSE` + kalıcı `F` barkodla doğar, ham stok yüzeyinden kaybolur, mamul envanterine girer; attach→detach turu geri dönüşsüz (renkli ham iş emrinden çıkınca satılabilir mamule düşer).
- **Olasılık:** YÜKSEK.

### 6. `depo.multiEnabled` satılıyor ama dört yol onu görmüyor — mal hep "varsayılan"a / "son"a / `[0]`a düşer
- `Teks-Erp/src/services/subcontractor.service.ts:3212` (fason dönüşü hep `resolveTargetWarehouseId(tx)` = varsayılan; yorum "çok depolu fason gerçek ihtiyaç olursa sevkin çıktığı depoyu damgala") · `return.service.ts:351-363` (iade girdisinde `warehouseId` YOK; `:580` hep topun son deposu) · `Electron/src/pages/Operations/Yarn/YarnMovementDialog.tsx:94` (`warehouses[0]` = ada göre ilk, `isDefault` değil; kardeşleri `useDefaultWarehouse()` kullanıyor) · `mobil/src` tümü: `warehouseId` 0 geçiş, `depoMultiEnabled` bayrağı tablette hiç yok — Tambur kesimi, KK1, fason kabul, iade girişi hepsi backend varsayılanına düşer.
- **Varsayım:** tek depo var.
- **Karşı-fabrika:** modülü satın alan iki depolu fabrika (boyahane yanı depo + yükleme deposu; iplik deposu + kumaş deposu; iade/karantina deposu).
- **Mekanizma:** **② VERİ** (fason sevkine kaynak depo damgası; iade hedefi kalite kartından/`returnTargetStatus` gibi) + **③ AKSİYON ANINDA** (tablet oturumu istasyon→depo bağı, iade formunda depo seçimi). Bayrak ZATEN var — sorun bayrağın çıkışsız olması.
- **Kırılma:** SESSİZ YANLIŞ DEFTER KONUMU: mal fiziksel olarak hiç girmediği depoda "girdi" olarak yazılır (yeni stok defteri bunu Σ'ya taşır); iplik bakiyesi yanlış depoda; tablet kullanan çok depolu fabrikada her top sonradan transferle onarılır.
- **Olasılık:** ORTA (modül satılınca kesin).

### 7. Mal yalnız ÇUVAL içinde çıkar — çuvalsız/paletli sevk kurulamaz
- `Teks-Erp/src/services/shipping.service.ts:2190` ("En az bir çuval seçilmeli") · `:3388` ("Boş sevkiyat sevk edilemez") · tek kaçış `createShipmentFromRolls` (gizli çuval üretir) `:2521`de ihracatta ve `shipping.weighRequiredEnabled` açıkken KAPALI (`WEIGH_REQUIRED`).
- **Varsayım:** kumaş çuvalla sevk edilir (perde/tül pratiği).
- **Karşı-fabrika:** ağır/enli kumaşı **rulo halinde palete/tıra** yükleyen denim, döşemelik, brandacı; ihracatçı → hiçbir yol yok.
- **Mekanizma:** **② VERİ** — ambalaj türü kataloğu (`ÇUVAL | PALET | AÇIK RULO`), çuval bir ambalaj türü olur; tartı kapısı ambalaj türüne göre (palet tartılır, açık rulo tartılmaz). Bayrak değil: aynı fabrika tülü çuvalla, brandayı paletle yollar.
- **Kırılma:** BLOKE (400) — ya da sahte çuval üretme alışkanlığı → çuval sayısı/kg raporları yalan.
- **Olasılık:** YÜKSEK (perde dışı her segment).

### 8. İplik numarası YALNIZ denye; devere formülünde 9.000.000 kaynaklı — Ne/Nm/dtex yok
- `Teks-Erp/prisma/schema.prisma:1487-1492` (`Item.linearDensityDen`, formül yorumu) · `warp-spec.service.ts:10,53`.
- **Varsayım:** çözgü ipliği filament denye ile tanımlanır (perde/tül doğru).
- **Karşı-fabrika:** pamuklu dokumacı (**Ne**, ters sistem: Ne 30 ince, den 30 kalın), Avrupa filament (**dtex**), yün (**Nm**). Ne 30'u "denye" kutusuna yazan fabrikada levent kg ~18× yanlış ve **WOUND satırına kopyalanıp iplik defterine donar**.
- **Mekanizma:** **② VERİ** — `Item.yarnCountSystem` enum (DEN/DTEX/NE/NM) + tek çevrim helper'ı (`toDenier`); formül tek yerde. Bayrak değil: aynı fabrika pamuk çözgü + polyester atkı alır.
- **Kırılma:** SESSİZ YANLIŞ VERİ (kg defteri) — bugün LATENT (devere Faz 1a, levent yok) ama **şema şu an yazılıyor**: en ucuz an bu.
- **Olasılık:** YÜKSEK (pamuklu dokuma Türkiye'de çoğunluk).

### 9. Top barkodu tek biçim `T+GGAAYY+[HF]+4 hane`, gün/tip başına 9.999; istemciler regex dışını SESSİZCE reddediyor
- `Teks-Erp/src/services/helpers/roll-barcode.helper.ts:19-25` · `Electron/src/pages/Operations/Rolls/RollsPage.tsx:114` (`if (!BARCODE_FORMATS.ROLL.test(...)) return;` — toast yok) · `Electron/src/lib/scanner/barcode-kind.ts:36-45` (ön ek tablosu; bilinmeyen = arama yok, `scan-resolvers.ts:225` bilinçli) · `RollScanBar.tsx:50`.
- **Varsayım:** fabrikanın tek barkod şeması bu ve günde ≤9.999 top.
- **Karşı-fabrika:** müşterisi GS1-128/SSCC dayatan büyük konfeksiyon tedarikçisi; 8.000 eski etiketli topla canlıya geçen fabrika; tüp örmede günde 10.000+ top sayan örmeci (`MAX_ROLL_SEQ` → 409 "yarın 0001'den başlar" = ÜRETİM DURUR).
- **Mekanizma:** **② VERİ** — kurulum düzeyinde barkod şeması kaydı (ön ek, hane, kapasite) tek kaynaktan iki istemciye servis edilir; "bilinmeyen ön ek → yine de lookup dene" dalı. Bayrak değil, kimlik verisi.
- **Kırılma:** BLOKE (409, üretim durur) + SESSİZ NO-OP (panel açmaz, hiçbir şey demez). Kolon `VarChar(64)`, DB izin veriyor.
- **Olasılık:** ORTA-YÜKSEK.

### 10. `OrderLine.unitPrice Decimal(12,2)` — satış fiyatı 2 haneye SESSİZCE yuvarlanır; fatura satırı `Decimal(14,4)`
- `Teks-Erp/prisma/schema.prisma:2444` · `:6987` (`InvoiceLine.unitPrice 14,4`) · tüketici `shipment-auto-draft.helper.ts:157`, `shipping.service.ts:5520`.
- **Varsayım:** birim fiyat kuruş hassasiyetindedir.
- **Karşı-fabrika:** EUR/USD ile 3-4 haneli fiyat veren ihracatçı (2,4567 €/m), kuruş-altı TL fiyatlı ucuz astarlık satan toptancı.
- **Mekanizma:** **② VERİ** (ölçek 14,4'e; finans modülü zaten 4 hane) — migration, ama sıradan `ALTER TYPE`.
- **Kırılma:** SESSİZ PARA KAYBI: PostgreSQL INSERT'te uyarısız yuvarlar; sözleşme fiyatı taslağa ve basılı belgeye yuvarlanmış gider, sipariş boyunca birikir.
- **Olasılık:** ORTA-YÜKSEK (ihracatçı).

## İkinci kademe (doğrulandı ya da ajan beyanı; sıralamaya girmedi)
- Oturum açılabilir istasyon türü KAPALI liste (`work-session.service.ts:33`, 4 kind) — içeride boyahane/ram olan fabrikada `OTHER` istasyonda oturum, cihaz eşleme, giriş-istasyonu izi yok. Mekanizma ② `isSessionable` yetenek kolonu (`appliesQuality` emsali). Kırılma: iz eksikliği + kullanışsızlık.
- Kat tipi üç yüzeyde `foldValues[0]` varsayılanı (WorkOrderFormView:210, ReworkRollsDialog:128, useQuickWorkOrder:305) — 2-KAT önce sıralanan fabrikada 4-KAT sipariş 2-KAT gider ve yanlış metre cihazı okunur. ② katalog `isDefault`.
- Excel mal kabul içe aktarımı kumaş adı çakışınca HATA, renk adı çakışınca `[0]` (receiptImport.ts:166). Sessiz yanlış renk; simetri ② (hata).
- Fason kabul iptali/açık kumaş doğumu: fason ara adımda doğan top barkodsuz + `IN_PRODUCTION` (subcontractor.service.ts:3189-3201) — boyahaneden gelen malı raftan geçiren fabrikada raf ile sistem ayrışır; `label.service.ts:273` barkodsuz topa etiket YASAK (politika cümlesi). ③ kabulde "depoya al" seçimi.
- Kurşun bypass "sonraki adım Tambur" şartı (`kursun-bypass.service.ts:900` ×3) — satın alınan bayrak rota şekline kilitli. ② `closesBypass` istasyon yeteneği.
- Fason taslak çeki "önceki adım fasondur" (`subcontractor.service.ts:1855`) — `fason → KK → fason` rotasında SESSİZ BOŞ belge. ② "önceki DIŞ adım" araması (`:886-895` zaten var).
- Makine başına tek etiket yazıcı / tek kantar (`label-format.resolver.ts:76` newest, `shipping.service.ts:1500` oldest `simulate`; mobil üç yazıcı bileşeni `role`suz `find`; `machine-config.ts:89-93` tekil) — iki yazıcılı tezgahta yanlış medya, iki kantarlı istasyonda simüle bayrağı yanlış cihazdan. ② `role` (kantar/metre için ZATEN uygulandı, yazıcıya değil).
- Rota ilk adımından giriş + `producedInStepId` ezme (`workorder.service.ts:4686`) — yarı işlenmiş mal alan fabrika. ③ attach'te giriş adımı.
- Tambur-dışı son adım çıktısı zorla `form=ACIK` (`roll-finalize.helper.ts:208`) — sarma/ikileme son adımlı fabrika. ② istasyon yeteneği.
- Tablet gün sınırı cihaz saatinden (`rollHistoryFilter.ts:15`), backend Europe/Istanbul — gece vardiyası listesi kayar. ② sunucudan `today`.
- Para birimi kapalı enum ×3 yer + TCMB tek kaynak (`config/currencies.ts`, `exchange-rate.job.ts:45`) — CNY/CHF 400; bankası kuruyla çalışan firma. ② master-data.
- En toleransı tavanı 10 cm (`system-setting.service.ts:827`, okuma `Math.min` ile SESSİZ kırpar) + `TAMBUR_PLAN_WIDTH_TOLERANCE_CM=10` (dar dokuma/havlu). ② ayar.
- Kısa parti `P01..P99` sarımı (`code-format.ts:216-219`) — 250 plakalı fabrika `P150` çözülmez, sayaç başa döner, `@unique` kalktığı için iki canlı parti aynı numara. ② aralık ayarı.
- Fatura no günlük sıfırlanan `SF+tarih+4` vs e-Fatura sürekli seri (`finance.helper.ts:23-48`; `externalNo` kısmi mekanizma) · yaşlandırma 30/60/90 (`finance-aging.report.ts:117`) · audit 6 ay sabit (`archive-scheduler.ts:22`; manuel yol parametreli) · KK1 mükerrer penceresi 90 sn (`duplicate-guard.helper.ts:17`; on/off var, süre yok) · paketleme grubu `P` ön eki (parti ile çakışır, bilinçli).
- BT yazıcı tanımlıysa HTML fallback kalıcı kapalı (`mobil LabelPrinter.tsx:165`) — pil bitince KK1 etiket basamaz. ③ cihaz ayarı (emsal `kk1ManualEntry`).
- Mobil ana menü + Electron LoginHero `"Adnan Şahin Tekstil"` literal (`ModuleSelectScreen.tsx:103,123`, `LoginHero.tsx:29`) — `companyName` bayrağı VAR, okunmuyor. Kozmetik ama ikinci müşteride ilk ekranda görünür.

## ÇEKİRDEK sayılıp listeye ALINMAYANLAR (negatif sonda — karşı senaryo kurulamadı ya da bilinçli)
- Fabrika günü Europe/Istanbul, TR-only metin, TRY defter para birimi (VUK) — kullanıcı kararı, seçenek yok.
- Sevk BRÜT, storno ≠ iade, atomik claim, fail-closed kapılar, defter append-only — doktrin.
- "Tek iade belgesi tek sevkiyata aittir" (`return.service.ts:427`) ve "tek sevkiyat tek depodan çıkar" (`shipping.service.ts:2561`) — açık 400 + gerekçe yazılı; karşı fabrika (üç sevkten bir palet iade) yalnız üç belge açar, veri bozulmaz → kullanışsızlık, çakılı değil.
- Varsayılan depo (`ensureDefaultWarehouse` + partial unique + boot uzlaştırması) — mekanizma var; "deposuz fabrika" dejenere senaryo (bu gece K9).
- Tek çeki no / kartela no / tarih ön ekleri (`SVK`, `CV`, `IE`…) — sözlük tercihi; iki tesis tek DB paylaşmadıkça veri bozmaz.
- Rezervasyon YOK, `SackAllocation` sevk anında — profil kararı, MODUL-BAYRAK #6'da kayıtlı.

## KAPSAM (tamlık iddiası DEĞİL)
**Bakıldı:** `Teks-Erp/src/**` (483 dosya; services/helpers/reports/boss/import/document-render, jobs, constants, routes/controllers/middlewares/lib yalnız `[0]`/`findFirst`/`=== 1`/`take:1` süpürmesi), `prisma/schema.prisma` (tam), `SETTING_KEYS` kataloğu ve `module-flags.ts` (mekanizma envanteri), `Electron/src/**` ve `mobil/src/**` desen aileleri bazında (`[0]`/`isDefault`/`kind ===`/HAL-cihaz yığını/oryantasyon/barkod sınıflandırıcı/kalite-kat-depo-birim literalleri). İlk 10'un her satırı elle okundu.
**Bakılmadı:** `scripts/` (bekçi/araç katmanı), `prisma/migrations`, `deploy/`, `Electron/electron/` (main/preload), `Electron/src/pages/Finance/**` aritmetiği (KDV/tevkifat/mahsup), `Reports/**` içerikleri, `LabelTemplates/**` ve `TravelerCardStudio` canvas'ı, `System/**`, `mobil/src/offline/**` kuyruk semantiği; en büyük dört mobil ekran (`TamburScreen` 9.4k, `FasonKabulScreen` 4.7k, `KK1Screen` 4.2k, `KursunQcScreen` 3.2k satır) desenle tarandı, satır satır OKUNMADI — 1/4/8 ailelerinde ek bulgu olasılığı yüksek. Canlı veride sıklık ölçülmedi (olasılık sütunu sektör bilgisi, veri değil). Sıralama 8 saatlik gece taramasının hükmüdür; ilk 10 dışındaki maddelerin dosya:satır'ları ajan beyanıdır, elle doğrulanmadı.


---

# Çakılı varsayım — MOBİL İKİNCİ TUR: dört büyük ekran satır satır (2026-09-12 gece, Fable; salt okuma)

> Dört ekran tam okundu (TamburScreen 9.422 · FasonKabulScreen 4.656 · KK1Screen 4.209 · KursunQcScreen 3.198 satır; parçalı ama atlamasız, kapsam beyanı her ajanda). 57 aday; ilk 10'un her satırı kaynaktan **elle doğrulandı**. Sıralama = kırılma maliyeti × karşı-fabrika olasılığı. Karşı senaryo kurulamayan aday listeye girmedi.
>
> **Aile ①'e (kalite kodu) etkisi — kararın kapsamı 8 siteden 12'ye çıkıyor**, bir sitede kod DEĞİL AD regex'i var. FasonKabul ve KursunQc'de aile ① literal yok; FasonKabul'de kalite HİÇ sorulmuyor (ayrı bulgu).

## İlk 10

### 1. `Tambur/TamburScreen.tsx:1839` — hata tipi seçilmediyse KATALOĞUN İLK SATIRI yazılır
```
// Hata tipi seçilmediyse listenin ilkini kullan (admin "default" eklemeli)
const defectTypeId = work.errorEntry.defectTypeId || defectTypes[0]?.id;
```
- **Varsayım:** kataloğun ilk satırı zararsız bir varsayılandır.
- **Karşı-fabrika:** hata kataloğu koda göre sıralanınca ilk satırı `DELİK` (CRITICAL) olan her fabrika. Operatör "34" yazıp ekler; nokta delik olarak kaydolur, kesim kılavuzu ve "N kritik" rozeti (`:4133`) topu kritik sayar — **kalite verisi liste sırasından uydurulur.**
- **Mekanizma:** ② VERİ — `DefectType.isDefault` (partial unique) ya da hiç varsayılan yok → tip seçilmeden ekleme **400** (③ operatör seçer). Yorum bile mekanizmanın eksikliğini itiraf ediyor. Aynı aile: `KursunQc:250` `code === 'GENEL'` terfisi (kod `DIGER`/`MISC` olan fabrikada sessiz no-op) — aynı `isDefault` çözer.
- **Kırılma:** SESSİZ YANLIŞ VERİ (kalite). Olasılık YÜKSEK.

### 2. KursunQc — "bu kart bu istasyonun" hiç sorgulanmıyor (4 site + 1 harita)
- `KursunQc/KursunQcScreen.tsx:397` `getByCardBarcode` ne dönerse açılır, `activeSession.station` ile KARŞILAŞTIRILMAZ (özet `stationId` taşıyor) · `:447` iş kimliği `cardId: barcode // barkod yeterli` — aynı kart ikinci geçişte "Kart zaten açık" der, eski adımın sekmesine düşürür · `:408` `status === 'COMPLETED'` → "Yeniden Aç" teklifi (backend `findFirst stepSequence asc` ile İLK KK'yı döndüğü için ikinci KK operatörüne BAŞKASININ bitmiş adımı) · `:189` `listOpenCards()` istasyon filtresiz — TÜM kalite istasyonlarının kartları, ACİL rozeti (`:195-227`, haptik + kırmızı toast) öteki istasyonun birikiminden · `constants/stationScreens.ts` `KursunQc ↔ 'PROCESS_QC'` 1:1 — `appliesQuality` ile tanımlanmış ikinci KK istasyonu bu ekranı **hiç açamaz**.
- **Karşı-fabrika:** boya öncesi + boya sonrası KK (standart). Backend `QUALITY_STATION_WHERE` tam bunun için yazılmış; tablet hâlâ tek KK varsayıyor.
- **Mekanizma:** ② VERİ — oturumun istasyonu (`step.stationId === session.station.id`; uyuşmazlık banner + 409), iş kimliği `workOrderStepId`, `listOpenCards(stationId)`, `SessionGate` kind yerine yetenek. Backend tarafı bu gecenin karar #4'ü; bu tablet ikizi.
- **Kırılma:** SESSİZ yanlış adıma KK2/hata yazımı + yanlış istasyona "yeniden aç" (Tambur'dan top geri çeker) + sahte ACİL. Olasılık YÜKSEK.

### 3. Aile ① — dört yeni mobil site (karar ① kapsamı 8 → 12)
- `KK1/KK1Screen.tsx:733` **`code === '1.KALITE' || /1\s*\.?\s*kalite/i.test(name)`** — bulunursa dokunulmayan HER topa damgalanır; ad regex'i "1. Kalite" adlı MAMUL kalitesini ham girişe de basar; kataloğu `A/B/ISKARTA` olan fabrikada hiç ön seçim yok.
- `Tambur/TamburScreen.tsx:694` `useState('1.KALITE')` + `setRecutQualityGrade('1.KALITE')` `:1711/:2996/:4540` — "Top Kesme" formu katalogda olmayan kodla gönderir (truthy → `kesDisabled` false); ana akış `DEFAULT_QUALITY_CODE`ten geçiyor, bu dört site geçmiyor.
- `Tambur/TamburScreen.tsx:7351` kalan-kumaş modalı yalnız iki tohum kaliteyi sunar (`keep_1kalite` · `keep_a1`), katalog modala hiç verilmiyor; **tel sözleşmesi** `types/models.ts:1156 TamburFinalizeRemainingAction` aynı iki adı taşır. Kesim yolu katalogdan B kalite yazabilirken aynı topun kalanı B olamaz.
- `Tambur/TamburScreen.tsx:5152` ve `:5809` rozet rengi `=== 'FIRE'` / `=== 'A1'` — katalogun `color` alanı 1.200 satır yukarıda kullanılıyor, burada değil; kataloğu `ÇÜRÜK/B/A` olan fabrikada fire satırı YEŞİL görünür, etiket basılır.
- **Mekanizma:** karar ① (rol: FIRST/SECOND/SCRAP + kova: targetStatus): KK1 ön seçimi = FIRST rolü (regex silinir); recut varsayılanı = FIRST; kalan modalı katalogu listeler, `remainingGradeId` gönderir (eski `remainingAction` korunur); rozet rengi `QualityGrade.color`.
- **Kırılma:** SESSİZ (KK1 damgası, recut 400/hayalet kod, fire yeşil). Olasılık YÜKSEK.

### 4. `FasonKabul/FasonKabulScreen.tsx:958` — `appliesColor` hem rengi hem ÖZELLİKLERİ yönetiyor
```
const appliesColor = !!selectedGroup?.step.requiredCategory?.appliesColor;
// :856 her parti yüklemesinde koşulsuz: setAppliedProperties(g.workOrder.targetProperties ?? [])
// receivePayload.helper.ts:313-327: appliesColor ise appliedPropertyIds da gider
```
Backend `subcontractor.service.ts:2646-2650`: `data.appliedPropertyIds !== undefined ? data.appliedPropertyIds : appliesProperty ? … : []` — gelen override OTORİTE.
- **Karşı-fabrika:** boyahane (`appliesColor` ✓, `appliesProperty` ✗) + ayrı apre/ram/sanfor evi (`appliesColor` ✗, `appliesProperty` ✓). Boya kabulünde doğan her top "sanforlu/fikseli" damgalanır — apre evi daha dokunmamışken; apre kabulünde blok görünmez, operatör düzeltemez.
- **Mekanizma:** ② VERİ — `requiredCategory.appliesProperty` ZATEN telde (`types/models.ts:143`), ekran okumuyor; dosya başlığı (1-20) TODO olarak erteliyor. Bayrak değil.
- **Kırılma:** SESSİZ YANLIŞ ÖZELLİK (belge/etiket/eşleşme). Olasılık ORTA-YÜKSEK.

### 5. Tambur kat (fold) kümesi — üç site, aynı kök
- `Tambur/TamburScreen.tsx:2543` manuel modda ölçüm cihazı `measureFromMachine` → `meterPeripheralFor(meterPeripherals, work.foldType)` (`:1996`) ile KARTIN katından seçilir; kayıt ise `foldType: manualFoldType` (`:2517`) ile OPERATÖRÜN katıyla yazılır. Yorum bayat ("manuel modda kat seçimi gösterilmiyor" — `:774/:2427` gösteriyor ve zorunlu).
- `:4064` başlık kutusu `plannedFoldType === '4-KAT' ? '4 Kat' : '2 Kat'` — 6-KAT/TÜP planı ve plansız iş "2 Kat" gösterir; operatör çipi kutuya göre seçer.
- `:930` plansız işte `foldValues[0]?.code` — kataloğu `TÜP` ile başlayan fabrikada her plansız top TÜP doğar ve TÜP metresinden ölçülür.
- **Karşı-fabrika:** 2-kat + 4-kat iki metre cihazlı her istasyon (`meterPeripheralFor` bunun için var); 6-KAT/TÜP eklemiş fabrika (aynı dosyada iki kez düzeltilmiş üçlü ders).
- **Mekanizma:** `:2543` düzeltme değil, yanlış değişken (`manualFoldType` geçirilir); `:4064` katalog adı; `:930` `FabricPropertyValue.isDefault` (② veri) — `useQuickWorkOrder` bulgusuyla aynı.
- **Kırılma:** SESSİZ — bitmiş stokta yanlış kat + yanlış metraj (iki kat / yarım). Olasılık ORTA-YÜKSEK.

### 6. `KursunQc/KursunQcScreen.tsx:1586` — "Kumaşı Bitir" ZORUNLU istasyon özelliklerini göndermiyor
```
onPress={() => footerThrottled(() => kursunFinishMutation.mutate(selectedRoll.rollId))}
// offline/mutations.ts:182: rollService.kursunFinish(rollId, {})  ← boş gövde
```
`:1472` çipler çizilir, `:1539` "Zorunlu: GRAMAJ — işaretlemeden KK2 tamamlanamaz" basılır; `missingRequiredProps` yalnız `handleCompleteQc2`te (`:950`) sorulur. Backend `inventory.service.ts:5267` `properties` alır ve yorumu "iki tablet yolu aynı özelliği farklı kurallarla uygularsa…" der — bugün tam o.
- **Karşı-fabrika:** fason dönüşü açık kumaş + Kurşun'da `REQUIRED` CHOICE özellik (GRAMAJ) — **bu fabrikanın kendi akışı**; özellik tanımlıysa bugün canlı.
- **Mekanizma:** eksik parametre (`propertySelections` kapsamda, `:1591`); zorunluluk kontrolü iki yola tek helper. Yeni mekanizma yok.
- **Kırılma:** SESSİZ eksik özellik (yeşil toast, RollProperty yok). Olasılık YÜKSEK.

### 7. `FasonKabul/FasonKabulScreen.tsx:855` — PLANLANAN en "ÖLÇÜLDÜ" diye yazılır ve iş emrine geri yansır
```
setAppliedWidth(g.workOrder.width != null ? String(g.workOrder.width) : '');
```
`:1694-1702` giden topun eni bilerek ön-doldurulmuyor ("ölçülmemiş sayıyı ölçülmüş yazma") — ama `workOrder.width` de ölçülmemiş. Backend `:3440` "Kabulde ÖLÇÜLEN en iş emrine de yansır". Panel ön-dolu geldiği için kapalı (`:1263`).
- **Karşı-fabrika:** planlamacı nominal 150 yazar, boyahane 146 döndürür → her doğan top 150, iş emri 150, sonraki fason çekisi 150.
- **Mekanizma:** ③ AKSİYON ANINDA — ön-dolum yok, "ölçülmedi" seçeneği (`parseAppliedWidth` boşluğu zaten taşıyor; `:1255` zorunluluğu kaldırılır ya da `fason.widthRequired` — mevcut `rawWidthEnabled`in fason ikizi, ④ ama KK1'de emsali var).
- **Kırılma:** SESSİZ YANLIŞ EN (belge + sipariş eşleşmesi `allocWidthTolerance`). Olasılık YÜKSEK (her kabul).

### 8. `FasonKabul/FasonKabulScreen.tsx:811-822` + `:1289` — parti yoksa TÜM toplar SON sevkin firmasına
```
syntheticParty: subcontractorId: g.lastDispatch?.subcontractorId ?? null
const subId = selectedParty?.subcontractorId ?? selectedGroup.lastDispatch?.subcontractorId;
```
- **Karşı-fabrika:** bir adımın partisini iki boyahaneye bölen fabrika (A dolu → B), `parties` gelmezse (eski sunucu / bölünmemiş grup) B firması A'nın 200 m'sini de alır: çekme sapması, karne, fason faturası yanlış firmada; başlık bandı (`:1602`) tek adı gösterir.
- **Mekanizma:** ② VERİ — top başına `dispatchId → subcontractorId` çözümü (veri telde), firma ekranda ONAYLANIR (③).
- **Kırılma:** SESSİZ YANLIŞ FİRMA (finans). Olasılık ORTA.

### 9. `KursunQc/KursunQcScreen.tsx:2291` (+`:1374`, `:2444`) — hata şiddeti AD eşleşmesiyle
```
const isCritical = (e) => defectTypes.find((d) => d.name === e.errorType)?.severity === 'CRITICAL';
```
`KursunRollDefectSummary.defectTypeId` (`types/models.ts:774`) var, kullanılmıyor. Aynı ailede `:243` katalog `pageSize:100` — 100'ü aşan katalogda kalanlar kaybolur ve şiddet `undefined`.
- **Karşı-fabrika:** "Leke → Yağ Lekesi" yeniden adlandıran ya da 100+ hata tipli (örme+dokuma+baskı) fabrika: eski kritik işaretler gri olur, "N kritik" 0'a düşer, Tambur yanlış keser.
- **Mekanizma:** id ile eşleme (veri zaten var); katalog `useInfiniteQuery`.
- **Kırılma:** SESSİZ. Olasılık ORTA-YÜKSEK (yeniden adlandırma olağan).

### 10. KK1 kalite kalıcılığı + fire etiket politikası
- `KK1/KK1Screen.tsx:928` "Form'daki her alan KALICI (ürün, en, kalite)" — 7. topu 2. kalite işaretleyen operatörün 8-40. topu 2. kalite gider; Tambur'da bunun kolu var (`deviceSettingsStore.tamburResetQualityAfterCut`), KK1'de YOK.
- `:964` her kabul edilen topa etiket (`enqueuePrint`); `QualityGrade.skipLabel` + `scrapGradeLabelEnabled` yalnız `TamburScreen:829-832`de uygulanıyor (grep: KK1'de tüketici yok) — fire/ıskarta girişine etiket basılır, `kk1LabelScanVerifyEnabled` açıksa o etiketin okutulması bir SONRAKİ topu bloklar.
- **Mekanizma:** ③ cihaz ayarı `kk1ResetQualityAfterSave` (Tambur ikizi) · mevcut bayrak+katalog KK1'de OKUNUR (çıkışsız kapı, aynı desen).
- **Kırılma:** SESSİZ yanlış kalite serisi; gereksiz etiket + blok. Olasılık ORTA.

## İkinci kademe (ajan beyanı; ilk 10 dışı elle doğrulanmadı)
- **Aile ② (birim):** KK1 `:3377` "mt" literal, `:1350` metre zorunlu; FasonKabul `:303` ağırlık HİÇ alınmıyor (`ReceiveNewRollInput.weightKg`, controller, ledger `weightIn`, `ReceiptDetailModal` kg hepsi hazır, tek giriş noktası bu ekran); KK1 `:1770` kg yalnız MANUEL modda (`kk1WeightEntryEnabled` otomatik modda İNERT; `useMachinePeripherals('SCALE')` çağrılmıyor).
- **Aile ⑤ (renk=mamul):** KK1 `:1415` renk ⇔ `semiFinished` kenetli — boyalı ham renk alamaz, ekru yarı mamul kaydedilemez; Tambur `:4888` etiket türü `colorId == null → ROLL_RAW`, `:2110` recut yalnız WAREHOUSE / renksiz STOCK (A1_STOCK, RETURNED_FROM_SUBCONTRACTOR kesilemez).
- **Bloklar:** FasonKabul `:1255` en her kabulde zorunlu (backend opsiyonel — politika tek istemci boolean'ında), `:1273` kabul HER ZAMAN yeni parça doğurur (aynı barkodla dönen top kimliği ölür; backend `min(1)` ile ortak borç), `:931-951` tek kabul = tek parti (aynı tırla gelen iki parti iki makbuz); KursunQc `:983` `currentQty` üstünde hata metresi hard-blok + `:1579` KK2'de ölçüm yok (boyahane eksik beyan etmişse çıkış yok; backend `totalMeters` alıyor), `:995` aynı metrede aynı tip ikinci hata reddedilir (4-nokta sayım sistemi imkânsız); Tambur `:2427/2446` manuel mod kat + tam sayı cm en zorunlu (kat kataloğu boş → yol ÖLÜ; 152,4 cm yazılamaz); KK1 `:685` yalnız FABRIC, `:688/435` 500 kayıt tek sayfa (2.400 desende bulunamayan → mükerrer "Yeni Desen").
- **Sabitler:** Tambur `:1880/:2217` `Math.floor(x*10)/10` kalan kesme, `:1969/:1888/:4283` 0,1 m / 0,001 / 0,05 eşikleri (kısa parça/kartela kesiminde her kesimde "tamamı kesilecek" diyaloğu → operatör tıklamayı öğrenir); Fason `:1833` 7 gün "eski", `:134` 8 saat taslak (12 saat vardiya); KursunQc `:941` 700 ms sessiz basış yutma, `:801 vs :570` "sonraki top" iki yolda farklı; KK1 `:1239` simülasyon 100-500 m, `:773/:2733` `entrySource` CSV'de `PURCHASE_RECEIPT` yok (alım-satım firmasında liste boş).
- **Bug sınıfı (senaryo değil ama aynı `=== "…"` deseni):** KK1 `:3379` `isInactive = status === 'SCRAP'` — ekranın kendi "Sil"i `CANCELLED` üretir, iptal edilen top yeniden çekmede canlı görünür, etiketi basılır.
- **Yalnız metin:** KursunQc altı yerde "Tambur'a" sabit metin (rota Tambur'la bitmeyince yanlış cümle, veri değil).

## Kapsam
- **Okundu (tam):** dört ekran 1'den son satıra, parçalı; açılan yardımcılar her ajanda listeli (featureFlag.service · deviceSettingsStore · useMachinePeripherals · useFoldValues · meter.codec · offline/mutations · offline/entryAttempt · receivePayload/newRolls/receiveAttempt · stationScreens · SessionGate · types/models; backend çapraz kontrol: inventory.controller initialEntrySchema · subcontractor.controller/service · kursun-qc.service · quality-station.helper · inventory.service kursunFinish).
- **Bakılmadı:** dört ekranın dışındaki mobil ekranlar (TartıPaket, Sevkiyat, Depo, İade, Kartela*, HızlıİşEmri gövdeleri — ilk turda desenle tarandı), `mobil/src/offline/**` semantiği, stil/izin/Türkçe metin. Canlı veride sıklık ölçülmedi.
- **Aile ① toplamı (iki tur):** backend 5 site + panel 0 + mobil 7 site (ilk tur 3: `DEFAULT_QUALITY_CODE`, fallback, `shortCutQuality`; bu tur 4) = **12 site** → karar ①'in AST tripwire'ı iki istemciyi de taramalı (`qualityGrade` ile string literal, `code === '…'`, `/kalite/i` ad regex'i).
