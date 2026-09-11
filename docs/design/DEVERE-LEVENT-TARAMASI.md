# Devere · Levent — tarama ve tasarım önerisi

> **Durum: ÖNERİ** — kod yok, migration yok, uygulama sırası yöneticide. 2026-09-11 `SEKTOR-YOL-HARITASI.md` taramasının kapatmadığı boşluğu kapatır ("`WarpBeam` yaşam döngüsü hiç incelenmedi"). Tasarım kararlarını ajan verdi (ölçüt: ① sektör standardı ② ölçeğimiz ③ kod deseni) ve **itiraza açıktır**; belgenin açık bıraktığı beş çelişki 2026-09-12'de karara bağlandı (**§9**). Arşiv notu sıra beklemektedir (`docs/history/CLAUDE-NOT-ARSIVI.md` tek yazarlıdır ve şu an başka bir oturumun commit'siz bloğunu taşıyor).
>
> **Yöntem:** şema ve kod elle okundu; dört soru paralel ajanlarla kanıtlandı (iş emri motorunda top geçmeyen adım · sektör iddialarının çürütme denemesi, web kaynaklı · modül anahtarı dokunuşları · `YarnMovementKind` etki alanı). Kanıt satırları metinde `dosya:satır` olarak geçer.
>
> **Okuma sırası:** saha gerçeği `DOKUMA-DEVERE-SAHA-KAYNAGI.md` → bu belge. Defter doktrini `docs/kurallar/defter.md`; modül kalıbı `docs/kurallar/modul-bayrak.md`.
>
> **Bağlayıcı yıkıcı-olmayan kurallar** (yönetici): `devere.enabled` ve dokuma bayrağı AYRI, varsayılan KAPALI · adlandırılmış kapı, jenerik `requireModule` yok · adnansahin'in stok kartı adı ASLA ayrıştırılmaz/taşınmaz · fork yok · rota şablonuna iki istasyon eklenir, mevcut akış bozulmaz.

## 0 · Özet — yöneticiye

- **Levent bugün sistemde HİÇ yok** (`warpBeam` şema/kod/istemci taramasında 0 eşleşme) ve mevcut hiçbir modele sığmıyor. `Roll` metre + kumaş dünyasıdır, `WorkOrder` top işler, `YarnMovement` iplik kg'ının nereye gittiğini söylemez. Devere **topun doğuşundan ÖNCE** çalışır: içinden top geçmez, iplik girer, levent çıkar.
- **En küçük anlamlı ilk adım (Faz 1): "Levent doğar, iplik ona düşer, hazır levent stoğu görünür."** Bunun için dört parça gerekir: çözgü kartı (`WarpSpec`), levent (`WarpBeam`, durum tablosu), levent olay defteri (`WarpBeamEvent`, Faz 1'de yalnız `WOUND`/`WOUND_CANCEL`) ve iplik defterinde `WARP_ISSUE`/`WARP_ISSUE_REVERSAL`. Bunlara `devere.enabled` eklenir. Tezgaha bağlama, kalan metre, lot ve top bağı sonraki fazlarda. Faz 1 tek sürüm için büyük olduğundan **1a (defter yazmayan katalog) / 1b (levent doğar)** diye ikiye bölündü; kesme yeri ve gerekçesi §7'de.
- **Şema dokunuşu GEREKİR.** Şemasız anlamlı bir adım yok: iplik çıkışını serbest metne "LV-12 için" yazmak, doktrinin yasakladığı şeydir (iş kararı metinden okunamaz). Faz 1 tamamen EKLEMELİ: **3 yeni tablo · 1 yeni pg enum tipi (`WarpBeamStatus`) · mevcut enuma 2 değer · 4 nullable ya da varsayılanlı kolon · 9 şema-dışı nesne · 1 modül anahtarı**; pratikte ~5 migration dosyası (enum değerleri kendi tek ifadeli dosyalarında). adnansahin'de sıfır fark (§6). Şema dışında üç mekanik kapı da Faz 1'e dahildir ve atlanırsa sessiz kırılır: **izin kataloğu + ekran `requires`** (§5), **birleştirme haritası** (yeni `Item`/`Customer` FK'ları, §5), **içe aktarma adaptörleri** (§5). Ayrıca iki mevcut sayım yolu işaret fonksiyonuna bağlanmalı, yoksa yeni ters kayıt türü sessizce yanlış sayılır (§4.9).
- **Faz 1'i BAŞLATMAYI bloke eden dokumacı sorusu YOK, ama KAPSAMINI kilitleyen üç soru var.** Formüldeki bölen sorusu (#1) fizikle çözüldü (§1.2); sıralama sorusu (#2) sonucu etkilemez (çarpma değişmeli). Kapsamı değiştirebilecek üçlü: **#11** (bobinler tartılı mı çıkıyor, dipleri depoya dönüyor mu), **#20** (devere fasona mı veriliyor), **#21** (tül dokuma mı raşel örme mi). Her biri Faz 1'e birer kolon ya da tür ekler, tasarımı devirmez — ama cevap gelmeden Faz 1b'nin kapsamı KİLİTLENMEZ. #5 (desen kodu ↔ ürün kodu) yalnız 1a'nın ekran varsayılanını belirler. Faz 3 #13/#14/#16'ya, Faz 4 #8'e bağlı.
- **İlk sürümün dürüst ölçeği: 1a → 1b, ve ilk dokuma müşterisinde 1b ile Faz 2 (lot) BİRLİKTE.** Lotsuz sarılan levent kalıcı olarak lotsuz kalır (§7), yani ilk gerçek kurulumda ölçek 3 değil **4 tablo**, 4 değil **6 kolon**dur. "En küçük anlamlı adım" 1b'dir; Faz 2'yi ayırmak ancak müşteri lot izlemeyi istemiyorsa meşrudur.
- **Ölçülmüş çelişkiler 2026-09-12'de karara bağlandı (§9).** "Rota şablonuna iki istasyon eklenir" kuralı DOKUMA için uygulanır. DEVERE ise yalnız istasyon KATALOĞUNA girer. Devere iş emri adımı yapılırsa iş emri **kendiliğinden hiç kapanmaz**: recompute top geçmeyen adımı PENDING bırakır (`roll-step.helper.ts:140-151`, `:202-221`). Ayrıca quickStart topları ilk adıma, yani Devere'ye sokar (`workorder.service.ts:4672-4677`). Bunu aşmanın tek yolu çekirdek adım koduna dokunmaktır.

---

## 1 · Levent yaşam döngüsü — saha gerçeği + sektör standardı

### 1.1 Terimler ve üç ad tuzağı

| Saha dili | Sektör karşılığı | Not |
|---|---|---|
| Devere | Konik (seksiyonel) çözgü makinesi — Bursa tabiri | Filament ve kesik elyafla çalışır; renkli çözgü raporunda yaygın |
| Direkt (düz/seri) çözgü | Ara leventlere tam en sarım → haşılda tek dokuma levendinde birleşme | Kesik elyaf + haşıl hattında yaygın |
| Cağlık | Creel — bobin sehpası | Konik çözgüde bobin adedi = **kalba başına tel**; magazin cağlıkta yer sayısı = 2 × tel |
| Kalba | Section — tambura yan yana sarılan şerit | Toplam tel = kalba × kalba başı tel (+ kenar; son kalba eksik olabilir) |
| Leventleme / aktarma | Beaming-off — tamburdan dokuma levendine | |
| Levent (lüvert, livert) | Weaver's beam | **İki anlamı var:** tezgah üreticisine özgü metal gövde (demirbaş: no, flanş çapı, iş eni, dara) ve üstündeki çözgü yükü |
| Haşıl | Sizing | Punto'lu (intermingle) ya da bükümlü filamentte çoğunlukla yok. **Su jetinde düşük bükümlü filament haşıl ister.** Haşıl alma %1–10 kg ekler |
| Tahar | Drawing-in — tel tel lamel, gücü, tarak | Elle saatler |
| Takım | Tahar dairesinde önceden taharlanmış çerçeve + tarak + lamel | Leventle birlikte tezgaha gider: üçüncü bağlama yolu |
| Düğüm(leme) | Tying-in — biten levendin tellerine yenisini bağlama | Aynı tel sayısı, tahar ve tarak şart; renk/lot değişebilir |
| Levent dibi | Beam remnant | Fire; sert telef olarak düşük fiyatla satılır |
| Kısalma | Take-up (iplik boyuna göre) / crimp (kumaş boyuna göre) | İki tanım %10'da ~%1 ayrışır; sistem **take-up** saklar (§4.8) |

⚠️ **Ad tuzakları.** Arayüzde, sesli iletişimde ve aramada karışıklık yaratırlar:
1. **Tambur.** Konik çözgünün tamburu (drum) ile TeksERP'nin **Tambur istasyonu** (son karar/kesim) aynı kelimedir. Devere ekranlarında yalnız "çözgü tamburu" yazılır. Bu kavram için kodda tip ya da alan açılmaz.
2. **Parti.** Sahada "iplik partisi" tedarikçi lotudur; TeksERP'de "Parti" = `Batch` (P01…P99). İplikte arayüz dili **"lot"** olur, "parti" kullanılmaz.
3. **Refakat kartı.** Sahada "çözgü refakat kartı" leventle gezen föydür; TeksERP'de refakat kartı iş emriyle doğar. Levent belgesinin adı **"levent kartı"** olur.

### 1.2 Devere formülü — ölçek sorusu çözüldü, değer NOMİNAL

Denye, 9.000 m ipliğin **gram** ağırlığıdır. Levent üstündeki toplam iplik boyu `tel × metre` olduğu için:

```
gram = tel × denye × metre / 9.000
kg   = tel × denye × metre / 9.000.000     (dtex: / 10.000.000 · Ne: denye = 5315 / Ne · kat iplikte SONUÇ numarası: Ne 30/2 → Ne 15)
```

- Kâğıttaki `/9000` **gram** verir; "kg" etiketi dokumacının zihinden bine bölmesidir. Örnek: `3500 × 300 × 7000 / 9000 = 816.666,7 g = 816,67 kg`. Makul mü diye bakıldı: iş eni 300 cm, sarım yoğunluğu 0,4 g/cm³ (pamuk örnek değeri; filamentte ölçülmeli) ve boru Ø20 cm varsayımıyla levent çapı ≈ 95 cm çıkar. Bu, 1000–1100 mm flanşa sığar; dara ile yaklaşık 1 ton eder. Bekçi fixture'ı bu örnektir.
- **Sıra sorusu (#2) sonucu etkilemez**, çarpma değişmelidir. Soru yalnız kayıtta hangi sayının tel, denye ya da metre olduğu için sorulur.
- **Formül NOMİNALDİR.** Haşıl alma, yağ ve numara toleransı içinde yoktur. Stok defteri formülden değil **gerçekleşen kg**'dan beslenir: cağlığa yüklenen − dönen bobin dipleri. Formül ön-dolum ve fire hesabının referansıdır. Tartılmadıysa bu, kayda **beyan edilir** (`kgSource`, §4.4). Böylece "fire 0" ile "fire ölçülmedi" ayrışır (`Sack.weightSource` emsali).
- "150/48" yazımında ikinci sayı filament adedidir. Ad ayrıştırılmaz; alan elle girilir.
- Denye iplik kartından okunur ama `WOUND` satırına **kopyalanır**. Kart sonradan düzeltilirse geçmiş leventin kg'ı değişmez (geçmişe etki eden değer yasağı).

### 1.3 Aşama aşama

| # | Aşama | Saha gerçeği | Sektör standardı | TeksERP bugün | Öneri |
|---|---|---|---|---|---|
| 1 | Çözgü emri / planı | Desen kartı "ÇÖZGÜ: 600 KAR İPİ 70 DN"; `200 m` notu | Dokuma planından çözgü emri. Çözgü boyu = hedef kumaş ÷ (1 − take-up) + tezgah payı; levent kapasitesiyle sınırlı | Yok | `WarpBeam` **PLANNED** satırı = çözgü emri. Siparişe FK YOK (top↔sipariş bağı yok doktrini); sipariş yalnız plan ekranında bilgi |
| 2 | Cağlık / bobin | İrsaliyede bobin adedi + lot + kg | Kalba başına tel kadar bobin. Bobin metrajı < kalba × boy ise **lot kalba ortasında değişir**. Bobin dipleri stoğa döner | `YarnMovement` kg; bobin ve lot yok | Faz 1: tüketim gerçekleşen kg (teorik ön-dolu, `kgSource` beyanlı). Veride dipler stoktan hiç çıkmamış olur. Lot ve "bobin yeter mi" kontrolü Faz 2 |
| 3 | Levent doğuşu | tel · metre · denye | + makine, operatör, lot(lar), kalba düzeni, kopuş, başlangıç | Yok | `WarpBeamEvent.WOUND` (doğuş gerçekleri append-only satırda) + aynı tx'te `WARP_ISSUE` hareketleri |
| 4 | Levent stoğu | Tezgah yanında bekleyen leventler | "Levent stok ambarı": tam ve **yarım** levent. Yarım levent **yarı mamuldür**, fire değil | Yok | `status = READY`; "yarım" türetilir (tüketim > 0). Konum Faz 5 |
| 5 | Tezgaha bağlama | Levent değişimi saatler, atkı değişimi dakikalar | Üç yol: **düğüm** (aynı tel/tahar/tarak) · **tahar** · **takım**. Yarım levent yalnız uyumlu (model/en) tezgaha, takımıyla ya da aynı taharla geçer. Bağlama ve sökümde sayaç okunur | Yok | Faz 3: `MOUNTED` olayı (`machineId`, `mountPosition`, `mountMethod`, `setupStartedAt`, `loomCounter`). Yöntem **önerilir** (önceki levent aynı `WarpSpec` ise düğüm), kullanıcı beyan eder |
| 6 | Tüketim / kalan metre | — (#14) | Dört yol: tezgah çözgü sayacı · çap ölçümü (numara, tel, boru ve flanş çapı) · atkı sayısı ÷ (ham atkı/cm × 100) ÷ (1 − take-up) · tartı: (brüt − dara) ÷ (tel × denye ÷ 9000) | Yok | **Kolon değil, türetilir:** `Σ işaret(kind) × lengthM`. Faz 3'te elle `CONSUMED`/`ADJUST_*`, Faz 4'te top çıkışından otomatik. Ölçüm yolu fabrikanın PROFİL verisidir |
| 7 | Boşalma / levent dibi | — (#15) | Levent sonu firesi kaçınılmaz, düğüm firesi %0,3–0,5; telef satılır | Yok | `EXHAUSTED` olayı, `lengthM` = artık (fire). Türetilen kalan ≠ ölçülen artık ise fark önce `CONSUMED`/`ADJUST_IN` ile kapanır. Telef satışı kapsam dışı (`WasteDisposal` bulgusu) |
| 8 | Levent ↔ top | Akış: Devere → Dokuma → Kurşun → Tambur | Top doğum damgası: tezgah + levent(ler) + sayaç aralığı → geri izleme lot'a kadar | `Roll.createdMachineId` + `entryStationId` VAR, levent bağı yok | Faz 4: `CONSUMED.rollId`. `Roll`'a levent kolonu AÇILMAZ: çift levent N:M'dir, tek kaynak olay satırıdır |
| 9 | Haşıl | — (#10) | Filamentte punto/büküm varsa gerekmez; su jetinde düşük bükümlü filament haşıl ister; kesik elyafta şart | Yok | Faz 1–4'te modellenmez; yükseltme yolu `SIZED`↔`SIZE_CANCEL` olayı + haşıl alma %. **#10 + #22 cevabı önceliği değiştirebilir** |
| 10 | Devere firesi / kopuş | — (#19) | Kopuş / milyon m (iplik ve lot kalitesi göstergesi); fire = yükleme − dipler − tartılı fire | Yok | `WOUND.breakCount`. Fire kg = Σ net `WARP_ISSUE` − `WOUND.theoreticalKg`; yalnız `kgSource='WEIGHED'` satırlarda anlamlıdır (türetilir) |

---

## 2 · Eksik varlık / defter listesi

Ciddiyet ölçeği `SEKTOR-YOL-HARITASI.md` ile aynı: 🔴 defter yalanı · 🟠 veri kaybı · 🟡 raporlama kaybı · 🔵 yeni yetenek. **Kim için: hepsi sektör geneli** (adnansahin çözgü yapmaz).

| ! | Varlık / defter | İzsiz değişen | Bugün nerede | Bağlandığı mevcut model | Yeni tablo? | Faz |
|---|---|---|---|---|---|---|
| 🟠 | **`WarpBeamEvent`** — levent olay defteri | Leventin doğuşu, tezgaha giriş/çıkışı, tüketimi, bitişi, fire kararı | Hiç yok | `Machine` (devere makinesi/tezgah), `Roll` (Faz 4), `User` | **EVET.** "Ne oldu" defteri durumdan ayrı tablo olmak ZORUNDA (`defter.md`: bir tablo hem defter hem durum olamaz). Tekrar eden bağla/sök çevrimi tek kolona sığmaz (`ShipmentEvent` emsali) | 1 (doğuş) · 3 · 4 |
| 🔵 | **`WarpBeam`** — levent kimliği + durumu | "Şu an hangi leventler hazır, hangisi hangi tezgahta" | Hiç yok | `WarpSpec`, `Machine` | **EVET.** `Roll`'a gömme reddedildi (§3.1) | 1 |
| 🔵 | **`WarpSpec`** — çözgü kartı (çözgü föyü) | "Bu levent hangi desenleri besler" (UA6007 ↔ UA6007A); tel/kenar/tarak | Kâğıt kartta el yazısı "Çözgü = UA6007" | `Item` (iplik: `yarnItemId`; kumaş: `Item.warpSpecId`) | **EVET.** N desen tek çözgüyü paylaşır; `ProductRecipe` renge bağlı, `Item` öz-referansı zayıf (§3.4) | 1 |
| 🟠 | **Devereye iplik çıkışı** (`WARP_ISSUE` + `warpBeamId`) | İplik stoktan düşer ama nereye gittiği yazılmaz. Tüketim, satış ve sayım farkı yalnız kaynak sütunundan ayrışır; iplik tüketim raporu yok | `YarnMovement` `OUT` (bugün yalnız satış faturası ve elle giriş yazar) + serbest `reason` | `YarnMovement` (tipli belge bağı; `goodsReceiptId`/`stockCountId` emsali) | Hayır: enum + nullable FK | 1 |
| 🟡 | **Denye** (`Item.linearDensityDen`) | Formülün girdisi yalnız stok kartı ADINDA metin ("70 DN"); hesap yapılamaz | `Item.name` | `Item` | Hayır: nullable kolon. **Ad ayrıştırılmaz**, değer elle girilir | 1 |
| 🔵 | **İstasyon yeteneği** "levent doğar" / "levent tüketilir" | Hangi makine devere, hangisi tezgah ya da raşel | `Station.department` serbest metin ("DEVERE") | `Station` (`appliesQuality` yetenek emsali), `Machine` | Hayır: iki boolean + `Machine.warpBeamSlots` | 1 (doğar) · 3 (tüketilir) |
| 🟠 | **`YarnLot`** + `YarnMovement.lotId` + `bobbinCount` | Leventte hangi lot(lar) var; levent içi lot farkı → **boyuna çözgü yolu**; ardışık leventte lot değişimi → geçişte ton farkı; lot geri çağırması imkânsız | İrsaliyede var; mal kabul satırı lot/bobin alanını reddediyor (`goods-receipt.service.ts:84-99`) | `YarnMovement` (şema notundaki yükseltme yolu, `schema.prisma:7565-7569`) | **EVET.** Şemanın kendi notu `YarnLot`'u öngörüyor; lot bakiyesi Faz 2'de TÜRETİLİR | 2 |
| 🟠 | **Kalan metre** | Levent bitmeden plan yapılamaz; yarım leventin değeri bilinmez | Hiç yok | `WarpBeamEvent` | Hayır: türetilir, kolon açılmaz | 3 |
| 🟡 | **Bağlama yöntemi + süresi + sayaç** (düğüm/tahar/takım) | Levent değişim süresi randımandan düşülemez | Hiç yok | `WarpBeamEvent.MOUNTED` | Hayır. Levent DIŞI kurulumlar (atkı, tarak, armür kartı) tezgah defterinin (`MachineSetupEvent`) işidir; iki kaynak olmaz | 3 |
| 🟡 | **Tezgah uyumu** (iş eni, levent tipi, flanş) | Yarım levent uyumsuz tezgaha "bağlandı" diye kayda geçer | Hiç yok (`Machine` = kod/ad/istasyon) | `Machine` teknik kartı | Faz 3'te yalnız UYARI; teknik kart `SEKTOR` "[demirbas]" + tezgah modülüyle | 3 · 5 |
| 🟡 | **Levent dibi / levent hurdası** | Çözgü firesi metre/kg olarak hiç görünmez | Hiç yok | `WarpBeamEvent.EXHAUSTED`/`SCRAPPED` + `ReasonPreset` | Hayır: iki `ReasonPresetKind` değeri | 3 |
| 🟠 | **Levent ↔ top** | "Bu top hangi leventten, hangi lot ipliğinden"; geri izleme ve geri çağırma | `Roll.createdMachineId` var, levent yok | `WarpBeamEvent.CONSUMED.rollId`, `RollEntrySource` | Hayır. `SEKTOR` `DoffEvent` bulgusunun levent yarısıdır; tezgah defteriyle birlikte gelir | 4 |
| 🟡 | **Fiziksel levent (demirbaş)** | Metal gövde numarası, darası, iki çözgünün aynı gövdede görünmesi | Hiç yok | `WarpBeam.physicalBeamNo` | Hayır (Faz 1: metin + canlı-tekil sed). Demirbaş kartı (dara ile tartıdan kalan metre) `SEKTOR` "[demirbas]" ile | 1 (metin) · 5 |
| 🔵 | **Haşıl** | Haşıl alma %, haşıl firesi, kimyasal | Hiç yok | `WarpBeamEvent` | Faz 5 (su jeti/kesik elyaf müşterisinde öne çekilir) | 5 |
| 🔵 | **Ara levent / direkt çözgü birleştirme (N→1)** · **çok iplikli / renk raporlu çözgü** | Hangi ara leventler hangi dokuma levendine girdi; renk sırası | Hiç yok | `WarpBeam` soy bağı · `WarpSpecYarn` | Faz 5 | 5 |

---

## 3 · Mimari kararlar ve reddedilen alternatifler

### 3.1 Levent bir `Roll` DEĞİLDİR, ayrı tablodur

`Roll`'u levent için yeniden kullanmak (barkod, durum, `currentQty` metre, depo, hareket defteri) cazip, ama **reddedildi**:

- `Roll` kumaş dünyasının merkezidir: `K18_DEAD_STATUSES`, çuval/sevkiyat, `SackAllocation`, Tambur finalize, kalite, renk/en, envanter ekranları, mutabakat. Levent satırı her okumaya **süzülmesi gereken sahte bir top** olarak girerdi. Yüzlerce sorguya `itemType ≠ …` yazmak "ayrışan yüzey" sınıfının kendisidir: biri unutulur ve fabrikaya olmayan kumaş stoğu gösterilir.
- Emsal karar aynıdır: `yarn.service.ts:4-8` ipliği `Roll` yapmayı aynı gerekçeyle reddetti ("sahte barkod, sahte metraj").
- Leventin metresi **çözgü** metresidir, kumaş değil (take-up). Aynı kolonda iki anlam yaşayamaz.

### 3.2 Çözgü emri bir `WorkOrder` DEĞİLDİR, `WarpBeam.PLANNED`'dır

`WorkOrder` adımları top işler (`RollMovement`, giriş noktası, refakat kartı, parti) ve `WorkOrderType` sipariş bağının aynasıdır. Oysa bir levent **tek iş emrine ait değildir**: 7.000 m'lik levent haftalarca birden çok desene ve siparişe dokunur. Bu yüzden çözgü emri, `PLANNED` durumdaki levent satırıdır. Deftere hiç yazmadığı için ④ taslak sınıfıyla atomik claim'li silinebilir (`invoice.service.ts` DRAFT emsali). Sektör karşılığı: levent, kumaş üretim emrinin **bileşeni** olan ayrı bir yarı mamuldür ve kendi çözgü emriyle doğar. İki emir vardır, aralarında bir bağ.

### 3.3 "Rota şablonuna iki istasyon": Dokuma adım olur, Devere katalogda kalır (ÖLÇÜLDÜ)

Fiziksel akış `Devere → Dokuma → Kurşun → Tambur`'dur ama VERİ akışı iki koldur: **iplik → levent** (devere) ve **levent + atkı → top** (dokuma). Top tezgahta doğar; devere adımından hiçbir top geçmez.

**Devere'yi iş emri ADIMI yapmanın ölçülen sonuçları:**
1. Top geçmeyen adım **PENDING'de kalır**. recompute açık ve kapalı hareket 0 iken PENDING döner, kendisi hiç SKIPPED yazmaz (`roll-step.helper.ts:13,51-52,140-151`).
2. İş emri ancak her adım COMPLETED/SKIPPED iken kendiliğinden kapanır (`roll-step.helper.ts:202-221`). Yani Devere adımlı her iş emri **sonsuza dek IN_PROGRESS kalır**. Tek çıkış elle kapatmadır: `POST /:id/complete`, kalan adımları `SKIPPED(MANUAL_COMPLETE)` yapar. Adıma elle COMPLETED yazılsa bile sonraki recompute onu PENDING'e çeker (`workorder.service.ts:5690-5694`).
3. quickStart topları **daima `wo.steps[0]`'a** bağlar (`workorder.service.ts:1397, 4672-4677`). Devere 1. adımsa kumaş topu Devere'ye girer.
4. `allowAsWorkOrderStep=false` backend'de **uygulanmaz**: yalnız Electron'daki üç seçicide süzgeçtir (`RouteDesignerStepRow.tsx:106`, `RouteStepDetail.tsx:177`, `RouteStepEditor.tsx:221`). Rota servisi yalnız istasyonun var ve aktif olduğuna bakar (`route.service.ts:162-171`).

**Karar.**
- **Devere** istasyon KATALOĞUNA girer, `allowAsWorkOrderStep=false` (KK1/SEVK_1 emsali). Devere makineleri onun altında `Machine`dır; operatör oturumu (`WorkSession`) ve yetenek bayrağı olduğu gibi çalışır. İş emriyle bağı levent → tezgah → top zinciriyle kurulur (Faz 4).
- **Dokuma** rotaya ADIM olarak ve topun **giriş noktası** olarak girer. Mevcut akış uzar, bozulmaz. Ancak topun iş emri İÇİNDE, Dokuma adımında doğması **yeni kod ister**: tezgah çıkışı motoru (`createOpenFabric` emsali: IN_PRODUCTION + o adımda açık hareket), yeni oturum türü ve ekranı, Dokuma adımını kapatıp sonrakini açan bitiş yolu. Bugün tablet oturumu yalnız RAW_QC/PROCESS_QC/TAMBUR/SHIPPING'de açılır (`work-session.service.ts:33-43`). Bu iş Faz 4'tür.
- **KK1 motorunu tezgah çıkışı için yeniden kullanmak REDDEDİLDİ.** `StationKind.RAW_QC`'nin "dokuma çıkışı" yorumunun arkasında kod yok (ilk şema commit'i). Top iş emrisiz STOCK doğar ve `entrySource=SUPPLIER_RECEIPT` olur, yani kayıtta tedarikçi mal kabulü görünür (yanlış kayıt). Üstelik `kk1.*` bayrakları, `mobile:kk1` izni ve KK1 sayacı bu topa da uygulanır.

**Reddedilen çekirdek seçenekleri** (kural "Devere = adım" diye korunacak olsaydı):
- (A) Top taşımayan adımı iş emri açılışında SKIPPED damgalamak ve attachRolls'u ilk top taşıyan adıma yöneltmek. Yapılmış işi "atlandı" diye anlatır: defter yalanı.
- (B) recompute, tamamlama ve `test_consistency §20` SQL'ine birlikte değişen yeni bir "topsuz adım" koşulu. adnansahin'in canlı üretim çekirdeğine dokunur. Sektörde de karşılığı yoktur: çözgü, kumaş emrinin operasyonu değil, levendin kendi emridir.

### 3.4 Çözgü kartı ayrı tablodur; `ProductRecipe` ve `Item` öz-referansı reddedildi

- `ProductRecipe` = kalem + **renk** + en + katlama + rota. Desen kartında renk yok; çözgü genelde ham/beyazdır ve renk sonra gelir (fason boyahane). Çözgüyü reçeteye koymak her renk için kopya çözgü üretirdi.
- `Item.warpSourceItemId`, "Çözgü = UA6007"nin harfi harfine karşılığıdır, ama çözgü tanımını bir **kumaşın** kolonlarına hapseder. Kaynak desen pasife alınınca ya da birleşince çözgü de gider; "bu çözgü kaç desene gidiyor" sorusu öz-referans zincirine döner.
- **Karar:** `WarpSpec` küçük bir ana veri tablosu (sahadaki "çözgü föyü"), `Item.warpSpecId` ile N kumaş → 1 çözgü. Sektörde çözgü föyü kumaş deseninden ayrı belgedir.
- Faz 1'de çözgü **tek iplikli**dir (saha kartı böyle). Kenar ipliği farklıysa ya da renk raporu varsa `WarpSpecYarn` satırları eklenir; `WarpBeam` ve defter değişmez.
- **Maliyeti açıkça yazıyorum:** Faz 1a'yı pahalı yapan tek parça `WarpSpec`tir — ikinci bir ana veri CRUD'u, `nameFold` sed rejimi, birleştirme haritası satırı, izin çifti ve `Item` formuna bir alan. Levent, tel/denye değerlerini `WOUND` satırına zaten kopyaladığı için "iplik nereye gitti" ve "hangi leventler hazır" soruları `WarpSpec` OLMADAN da cevaplanır; kaybedilen tek şey **"bu levent hangi desenleri besler"** gruplamasıdır — ki saha kaynağının ⭐ birinci bulgusu (bir levent çok desen) tam olarak odur ve levent stoğu listesini işe yarar kılan da odur. **Karar: `WarpSpec` 1a'da KALIR.** Yönetici daha küçük bir 1a isterse seçenek (B) hazırdır: levent doğrudan `yarnItemId` + `endsCount` ile doğar, hazır levent listesi iplik kalemine göre gruplanır, `WarpSpec` + `Item.warpSpecId` Faz 2'ye kayar (1a: 1 tablo → 0 tablo, `Item`'a dokunuş ikiden bire iner). Bu seçilirse saha sorusu #5 Faz 2'ye taşınır.
- `kumasTeknik.enabled` (en/gramaj/kompozisyon/atkı sıklığı/take-up) ile **bağımlılık kurulmaz**. `MODULE_DEPENDENCIES` tek ön koşul taşır ve levent take-up'a Faz 4'e kadar ihtiyaç duymaz.

### 3.5 Lot: şemanın kendi notundaki yol

`YarnStock` notu şöyle der: "Lot geldiğinde `YarnLot` + `YarnMovement.lotId` (nullable) eklenir … BU tablo toplam olarak doğru kalmaya devam eder." Bu yol aynen izlenir; kodda buna hazırlık yok, yalnız yorum var. Tek sapma: lot **bakiyesi** Faz 2'de ayrı tabloya inmez, `Σ yarnMovementSign × qtyKg WHERE lotId` ile **türetilir**. Ölçek küçük ve `YarnStock` tek yazar kuralı dokunulmadan kalır. Hacim ölçülüp gerekirse ayrı bakiye tablosu sonra açılır.

- Lot **zorunlu değil**. Lot izlemesinden önce giren iplik lotsuzdur ve çıkabilmelidir; aksi çıkışsız kapı olur. Lotsuz ya da birden çok lotlu levent **uyarı** üretir (`ApiResponse.warnings`), reddedilmez (rota kapsaması emsali).
- Hata dili doğru kurulur: levent içi lot karışımı **çözgü yolu** (boyuna), ardışık leventte lot değişimi **geçişte ton farkı** üretir. **Barre (enine) atkı lotuyla ilgilidir**, çözgü lotuyla değil. Sebep kataloğunda "bariyer" çözgü lotuna bağlanırsa kök neden yanlış atanır.
- `lotNo` **ayrıştırılmaz** ("YAN 1029-K" tedarikçi önekini içerse bile).

### 3.6 Kalan metre KOLON değil, türetilir

Durum ↔ sayaç çifti açmak (`WarpBeam.remainingM`) iki yazar, çift yüklem ve CHECK ister. Levent başına olay sayısı küçüktür (onlarca–yüzlerce), bu yüzden her okumada toplamak ucuzdur. Tek helper + SQL ikizi (boğaz-ikiz kuralı).

### 3.7 Tüketim: gerçekleşen kg, beyanlı kaynak, iade türü yok (Faz 1)

Sektör tüketimi `cağlık yüklemesi − bobin dipleri − tartılı fire` diye yazar. Küçük ekip için aynı sonuç tek satırla elde edilir: `WOUND` formu teorik kg'ı ön-doldurur, operatör gerçekleşeni girer ve kaynağı beyan eder (`WEIGHED` | `THEORETICAL`). Dipler veride stoktan hiç çıkmamış olur, **iade türü gerekmez**. Dokumacı bobinleri tartılı çıkarıp dipleri tartılı iade ediyorsa (#11) `WARP_RETURN`↔`WARP_RETURN_REVERSAL` eklenir; Faz 1'i devirmez.

### 3.8 İplik ters kaydı tipli: `WARP_ISSUE_REVERSAL`, `ADJUST_IN` değil

Bugünkü iplik stornoları `ADJUST_IN/OUT` yazar (fiş/fatura iptali, `yarn.service.ts:279-281`). Devere iptali bu desene uymaz. Doktrin tipli ters değer ister (`defter.md`), ve `ADJUST_IN` sayım fazlasıyla aynı kovadır: `SEKTOR`'ün "fire/kayıt düzeltmesi ayrımı yok" şikâyetinin ta kendisi. Bedeli ölçüldü: elle yazılmış iki yön listesi yeni "artıran" türü yanlış sayar (§4.9). Bu listeler Faz 1'de işaret fonksiyonuna bağlanır.

---

## 4 · Önerilen veri modeli

> Karşı ilişkiler (`User`/`Machine`/`Item`/`Roll`/`Customer` üzerindeki diziler) ve künye ilişki adları kısaltıldı; künye kalıbı `Station` modelidir. Miktarlar `Decimal`, pozitif; yön `kind`'den gelir (`YarnMovement` emsali). **Başlıktaki etiket: DURUM = "şu an ne", güncellenir · DEFTER = append-only, `updatedAt` YOK.**

### 4.1 Tür kümeleri

```prisma
/// LEVENT DURUMU — KAPALI küme (yaşam döngüsü), pg enum. Geçiş = atomik claim + aynı tx'te olay satırı.
/// Haşıl gelirse DURUM eklenmez: READY kalır, "haşıllandı" olaydan türetilir.
enum WarpBeamStatus {
  PLANNED    // çözgü emri — deftere hiç yazmadı (④ taslak: claim'li silinebilir)
  READY      // sarıldı, tezgah bekliyor — tam ya da yarım (yarım = türetilir)
  MOUNTED    // tezgahta / raşelde (Faz 3)
  EXHAUSTED  // bitti — terminal; artık EXHAUSTED satırında fire (Faz 3)
  SCRAPPED   // gerçek fire — çözgü kullanılamaz; terminal (Faz 3)
  CANCELLED  // yanlış giriş — hiç sarılmamış sayılır; iplik ters kayıtla döner
}

/// Sarım kg'ının kaynağı — KAPALI küme, bu yüzden pg enum ([DB-15] VarChar'ı yalnız büyümeye
/// açık kümeye ayırır). `SackWeightSource` emsali; ayrı CHECK'e gerek kalmaz.
enum WarpKgSource {
  WEIGHED      // tartıldı (cağlık yüklemesi − dipler)
  THEORETICAL  // formülün nominal değeri kabul edildi — "fire 0" DEĞİL, "fire ölçülmedi"
}

/// Bağlama yolu — KAPALI küme (fiziksel olarak üç yol). ⚠️ TİP DE Faz 3'te doğar,
/// `mountMethod` kolonuyla birlikte: Faz 1'de yazarı olmayan bir enum tipi yaratmayız.
enum WarpBeamMountMethod {
  TYING_IN        // düğüm — aynı tel/tahar/tarak
  DRAWING_IN      // tahar — tezgahta tel tel
  HARNESS_CHANGE  // takım — tahar dairesinde hazırlanmış çerçeve+tarak+lamel ile
}
```

**Olay türü pg enum DEĞİL** ([DB-15]: küme fazlarla büyüyor, Faz 1 → 3 → 5). `WarpBeamEvent.kind String @db.VarChar(32)` + DB CHECK + TS tek kaynak. **Tuple da faz faz büyür** — CHECK ile TS tuple'ı BİREBİR eşit kalır, böylece iki yönlü bekçi gerçekten koşar ve `warpBeamLengthSign`'da yazarı olmayan ölü dal (negatif sondası yazılamayan dal) kalmaz:

```ts
// src/constants/warp-beam.ts — tek kaynak; CHECK listesi ve işaret tablosu bu tuple'dan türer.
// BEKÇİ İKİ YÖNLÜ ve EŞİTLİK: CHECK listesi === tuple. Faz 3/4 değerleri o fazın migration'ında
// tuple'a VE CHECK'e birlikte eklenir; yazarı olmayan değer hiçbir yerde açılmaz.
export const WARP_BEAM_EVENT_KINDS = ["WOUND", "WOUND_CANCEL"] as const; // Faz 1

// Yol haritası (koda GİRMEZ, fazında eklenir):
//   Faz 3: MOUNTED · MOUNT_CANCEL · DISMOUNTED · DISMOUNT_CANCEL · CONSUMED · CONSUMED_CANCEL
//          ADJUST_IN · ADJUST_OUT · EXHAUSTED · EXHAUST_CANCEL · SCRAPPED · SCRAP_CANCEL
//   Faz 5: SIZED · SIZE_CANCEL (haşıl)
```

Mevcut pg enum'lara ekler (SONA; her biri **tek ifadeli, ayrı migration** `ADD VALUE IF NOT EXISTS`, PG 55P04; `docs/RECETELER.md` enum reçetesi 13 adım):
- `YarnMovementKind += WARP_ISSUE, WARP_ISSUE_REVERSAL` [Faz 1]. Mevcut enum'dur, VarChar'a çevirmek bu işin kapsamı dışında.
- `ReasonPresetKind += WARP_BEAM_ADJUST, WARP_BEAM_SCRAP` [Faz 3]
- `LabelKind += WARP_BEAM` [Faz 3]: levent kartı, barkod = `beamNo`
- `RollEntrySource += WEAVING` [Faz 4]: tezgah çıkışı

### 4.2 `WarpSpec` — DURUM (ana veri / katalog)

```prisma
/// ÇÖZGÜ KARTI (çözgü föyü) — bir çözgü tanımı N kumaş desenini besler (saha: "Çözgü = UA6007").
/// Leventler doğuşta tel/denye değerini KOPYALAR; kart düzeltmesi geçmiş leventi değiştirmez.
model WarpSpec {
  id           String   @id @default(uuid()) @db.Uuid
  code         String   @unique @db.VarChar(32)
  name         String   @db.VarChar(100)
  yarnItemId   String   @db.Uuid                 // ItemType.YARN + linearDensityDen dolu (servis 400)
  endsCount    Int                               // toplam tel, kenar dahil (CHECK > 0)
  selvedgeEnds Int?                              // kenar teli — bilgi
  reedNo       Decimal? @db.Decimal(6, 2)        // tarak no — birimi (diş/cm | diş/10 cm) PROFİL; hesaba girmez
  endsPerDent  Int?                              // dişe tel
  reedWidthCm  Decimal? @db.Decimal(6, 2)        // tarak eni ([DB-33] mevcut ölçek)
  notes        String?  @db.VarChar(500)         // tahar planı / jakar koşumu serbest (yapılandırma Faz 5)
  isActive     Boolean  @default(true)

  yarnItem    Item       @relation("WarpSpecYarn", fields: [yarnItemId], references: [id], onDelete: Restrict)
  fabricItems Item[]     @relation("ItemWarpSpec")
  beams       WarpBeam[]

  createdAt   DateTime @default(now()) @db.Timestamptz
  updatedAt   DateTime @updatedAt @db.Timestamptz
  nameFold    String?  @default(dbgenerated())    // tr_fold(name) — Station emsali
  createdById String?  @db.Uuid
  updatedById String?  @db.Uuid

  @@unique([nameFold])
  @@index([yarnItemId])
  @@map("warp_specs")
}
```

### 4.3 `WarpBeam` — DURUM

```prisma
/// LEVENT — "şu an ne". Doğuş gerçekleri BURADA DEĞİL, WOUND olay satırındadır (append-only =
/// değişmezliği DB verir). Kalan metre KOLON DEĞİL: WarpBeamEvent'ten türetilir.
model WarpBeam {
  id               String         @id @default(uuid()) @db.Uuid
  beamNo           String         @unique @db.VarChar(32)  // LV+GGAAYY+NNNN — barkod = kod
  clientToken      String?        @unique @db.Uuid
  warpSpecId       String         @db.Uuid
  status           WarpBeamStatus @default(PLANNED)
  plannedLengthM   Decimal        @db.Decimal(12, 3)       // yalnız PLANNED'da düzenlenir
  physicalBeamNo   String?        @db.VarChar(32)          // metal gövde no — demirbaş kartı YOK (Faz 5)
  currentMachineId String?        @db.Uuid                 // yalnız MOUNTED (CHECK)
  currentPosition  Int?           @db.SmallInt             // 1..Machine.warpBeamSlots
  notes            String?        @db.VarChar(500)

  warpSpec       WarpSpec        @relation(fields: [warpSpecId], references: [id], onDelete: Restrict)
  currentMachine Machine?        @relation("WarpBeamCurrentMachine", fields: [currentMachineId], references: [id], onDelete: Restrict)
  events         WarpBeamEvent[]
  yarnMovements  YarnMovement[]

  createdAt   DateTime @default(now()) @db.Timestamptz
  updatedAt   DateTime @updatedAt @db.Timestamptz
  createdById String?  @db.Uuid
  updatedById String?  @db.Uuid

  @@index([status, warpSpecId])       // "bu çözgüden hazır leventler"
  @@index([warpSpecId])
  @@index([currentMachineId])
  @@map("warp_beams")
}
```

### 4.4 `WarpBeamEvent` — DEFTER (append-only, `updatedAt` YOK)

```prisma
/// LEVENT OLAY DEFTERİ — "ne oldu"nun tek kaynağı. Satır GÜNCELLENMEZ/SİLİNMEZ.
/// Ters kayıt tipli *_CANCEL satırıdır; orijinaline reversesEventId ile bağlanır, bugüne yazılır.
/// Yalnız o leventin EN YENİ aktif ileri olayı terslenebilir (LIFO — ChequeEvent emsali).
/// Kalan metre = Σ warpBeamLengthSign(kind) × lengthM (tek kaynak helper).
model WarpBeamEvent {
  id              String          @id @default(uuid()) @db.Uuid
  beamId          String          @db.Uuid
  kind            String          @db.VarChar(32)    // WARP_BEAM_EVENT_KINDS — CHECK
  clientToken     String?         @unique @db.Uuid
  reversesEventId String?         @unique @db.Uuid   // tek ters: çift iptal DB'de imkânsız
  fromStatus      WarpBeamStatus
  toStatus        WarpBeamStatus

  lengthM         Decimal?        @db.Decimal(12, 3) // çözgü metresi; > 0 (CHECK)
  machineId       String?         @db.Uuid           // WOUND: devere makinesi · diğerleri: tezgah/raşel

  // WOUND — doğuş gerçekleri (bir daha değişmez)
  endsCount       Int?
  denier          Decimal?        @db.Decimal(10, 4) // iplik kartından kopya ([DB-33] mevcut ölçek)
  theoreticalKg   Decimal?        @db.Decimal(14, 3) // endsCount × denier × lengthM / 9_000_000 (nominal)
  kgSource        WarpKgSource?                      // "fire 0" ≠ "fire ölçülmedi"
  sectionCount    Int?                               // kalba sayısı — bilgi
  endsPerSection  Int?                               // kalba başı tel — bilgi
  breakCount      Int?                               // devere kopuşu
  startedAt       DateTime?       @db.Timestamptz    // kullanıcı girdisi; kronoloji createdAt

  // MOUNTED / DISMOUNTED (Faz 3)
  mountPosition   Int?            @db.SmallInt
  mountMethod     WarpBeamMountMethod?
  setupStartedAt  DateTime?       @db.Timestamptz
  loomCounter     Decimal?        @db.Decimal(12, 3) // bağlama/sökümde tezgah sayacı (metraj ölçeği)

  // CONSUMED (Faz 3 elle · Faz 4 top)
  fabricLengthM   Decimal?        @db.Decimal(12, 3) // dokunan kumaş — bilgi
  rollId          String?         @db.Uuid

  reasonCode      String?         @db.VarChar(64)    // ADJUST_* / SCRAPPED — ReasonPreset kodu (sunucuda doğrulanır)
  reason          String?         @db.VarChar(300)   // kolona yazılır, audit'e değil
  createdById     String?         @db.Uuid
  createdAt       DateTime        @default(now()) @db.Timestamptz

  beam     WarpBeam       @relation(fields: [beamId], references: [id], onDelete: Restrict)
  reverses WarpBeamEvent? @relation("WarpBeamEventReversal", fields: [reversesEventId], references: [id], onDelete: Restrict)
  reversal WarpBeamEvent? @relation("WarpBeamEventReversal")
  machine  Machine?       @relation("WarpBeamEventMachine", fields: [machineId], references: [id], onDelete: Restrict)
  roll     Roll?          @relation(fields: [rollId], references: [id], onDelete: Restrict)

  @@index([beamId, createdAt])
  @@index([machineId, createdAt])
  @@index([kind, createdAt])
  @@index([rollId])
  @@map("warp_beam_events")
}
```

İşaret tablosu: tek kaynak `warpBeamLengthSign`. `yarnMovementSign` emsali; exhaustive `switch`, yeni değer derlemede kırılır (`yarn.service.ts:104-113` TS2366 ile ölçüldü).

| + | − | 0 |
|---|---|---|
| `WOUND` · `CONSUMED_CANCEL` · `ADJUST_IN` · `EXHAUST_CANCEL` · `SCRAP_CANCEL` | `WOUND_CANCEL` · `CONSUMED` · `ADJUST_OUT` · `EXHAUSTED` · `SCRAPPED` | `MOUNTED` · `MOUNT_CANCEL` · `DISMOUNTED` · `DISMOUNT_CANCEL` |

### 4.5 Mevcut modellere eklemeler

```prisma
model Item {
  // … mevcut alanlar DEĞİŞMEZ; ad ASLA ayrıştırılmaz
  /// İPLİK denye'si — devere formülünün girdisi. Elle girilir; adındaki "70 DN" okunmaz.  [Faz 1]
  linearDensityDen Decimal?  @db.Decimal(10, 2)
  /// KUMAŞ → çözgü kartı (N:1). Yalnız FABRIC (servis 400). Devere kapalıyken yazılmaz/çizilmez.  [Faz 1]
  warpSpecId       String?   @db.Uuid
  warpSpec         WarpSpec? @relation("ItemWarpSpec", fields: [warpSpecId], references: [id], onDelete: Restrict)
  @@index([warpSpecId])
}

model YarnMovement {
  // … mevcut alanlar DEĞİŞMEZ
  /// Tipli belge bağı: devereye çıkış ve tersi. kind ∈ {WARP_ISSUE, WARP_ISSUE_REVERSAL} ⇔ dolu (CHECK).
  /// ⚠️ YarnMovementTxInput + create data ALLOWLIST'tir (yarn.service.ts:208-210): ikisine birden yazılır.
  warpBeamId  String?   @db.Uuid                                                  // [Faz 1]
  warpBeam    WarpBeam? @relation(fields: [warpBeamId], references: [id], onDelete: Restrict)
  lotId       String?   @db.Uuid                                                  // [Faz 2]
  lot         YarnLot?  @relation(fields: [lotId], references: [id], onDelete: Restrict)
  bobbinCount Int?                                                                // [Faz 2] bilgi, bakiye değil
  @@index([warpBeamId])
  @@index([lotId, createdAt])
}

model Station {
  /// Bu istasyonun makinelerinde LEVENT DOĞAR (devere). VARSAYILAN FALSE = bugün.                 [Faz 1]
  producesWarpBeam Boolean @default(false)
  /// Bu istasyonun makinelerine levent BAĞLANIR (dokuma tezgahı / raşel). VARSAYILAN FALSE = bugün. [Faz 3]
  consumesWarpBeam Boolean @default(false)
}

model Machine {
  /// Aynı anda bağlanabilecek levent sayısı (çift levent tezgah = 2, raşel = kılavuz barı kadar).     [Faz 3]
  warpBeamSlots Int @default(1) @db.SmallInt
}

/// TEDARİKÇİ LOTU — DURUM (ana veri). Bakiye TÜRETİLİR (Σ YarnMovement WHERE lotId).               [Faz 2]
model YarnLot {
  id          String    @id @default(uuid()) @db.Uuid
  itemId      String    @db.Uuid
  lotNo       String    @db.VarChar(64)                // "YAN 1029-K" — AYRIŞTIRILMAZ
  supplierId  String?   @db.Uuid                       // Customer (CompanyType.SUPPLIER) — GoodsReceipt emsali
  notes       String?   @db.VarChar(300)
  isActive    Boolean   @default(true)
  item        Item      @relation(fields: [itemId], references: [id], onDelete: Restrict)
  supplier    Customer? @relation("YarnLotSupplier", fields: [supplierId], references: [id], onDelete: Restrict)
  movements   YarnMovement[]
  createdAt   DateTime  @default(now()) @db.Timestamptz
  updatedAt   DateTime  @updatedAt @db.Timestamptz
  createdById String?   @db.Uuid
  updatedById String?   @db.Uuid
  @@unique([itemId, lotNo])
  @@index([supplierId])
  @@map("yarn_lots")
}
```

### 4.6 Şema-dışı nesneler (ham SQL migration + `test_db_invariants.ts` envanteri)

| Nesne | Tür | İfade | Faz |
|---|---|---|---|
| `warp_beam_events_kind_ck` | CHECK | `kind IN (…)` — liste `WARP_BEAM_EVENT_KINDS` ile **BİREBİR EŞİT** (Faz 1'de iki değer); bekçi iki yönlü eşitlik ölçer | 1 (+3) |
| `warp_beam_events_length_positive` | CHECK | `"lengthM" IS NULL OR "lengthM" > 0` | 1 |
| `warp_beam_events_cancel_link_ck` | CHECK | **TEK YÖNLÜ:** `kind` `_CANCEL` ile bitiyor ⇒ `"reversesEventId" IS NOT NULL`. Çift yönlü yazılamaz: `ADJUST_OUT` bir `ADJUST_IN`'in tersi olarak yazıldığında da bağ taşır (§4.7) | 1 |
| `warp_beam_events_wound_facts_ck` | CHECK | `kind='WOUND'` ⇒ `lengthM, endsCount, denier, theoreticalKg, kgSource, machineId` NOT NULL (`kgSource` enum olduğu için değer listesi CHECK'te tekrarlanmaz) | 1 |
| `warp_beam_events_one_wound_uq` | partial UNIQUE | `("beamId") WHERE kind='WOUND'`: bir levent bir kez doğar. ⚠️ Bu kısıt "aktif" yüklemi TAŞIMAZ ve taşımamalıdır — iptal edilen levent yeniden sarılmaz, **yeni levent açılır**. `WOUND_CANCEL`in durumu PLANNED'a değil CANCELLED'a taşımasının sebebi budur (§4.7) | 1 |
| `yarn_movements_warp_link_ck` | CHECK | `kind IN ('WARP_ISSUE','WARP_ISSUE_REVERSAL')` ⇔ `"warpBeamId" IS NOT NULL` (bugün `kind`'a bağlı CHECK yok; yalnız `qtyKg > 0` var) | 1 |
| `warp_specs_ends_positive` | CHECK | `"endsCount" > 0` | 1 |
| `warp_beams_mounted_ck` | CHECK | `(status='MOUNTED') = ("currentMachineId" IS NOT NULL AND "currentPosition" IS NOT NULL)` | 1 |
| `warp_beams_physical_live_uq` | partial UNIQUE | `(tr_fold("physicalBeamNo")) WHERE status IN ('READY','MOUNTED') AND "physicalBeamNo" IS NOT NULL`: bir gövdede iki canlı çözgü olmaz | 1 |
| `warp_beams_machine_position_uq` | partial UNIQUE | `("currentMachineId","currentPosition") WHERE status='MOUNTED'`: iki levent aynı yuvada olmaz | 3 |
| `warp_beam_events_mounted_ck` | CHECK | `kind='MOUNTED'` ⇒ `machineId, mountPosition, mountMethod` NOT NULL | 3 |

### 4.7 Durum geçişleri

Her geçiş: atomik claim + aynı tx'te olay satırı + audit tx DIŞINDA.

| Geçiş | Olay | Claim | Ek yan etki | Red |
|---|---|---|---|---|
| (yok) → PLANNED | — (taslak) | `clientToken` | — | çözgü kartı pasif → 400 |
| PLANNED → silindi | — | `deleteMany({id, status:PLANNED})`; count 0 → taze okuma → 409 | — | ④ sınıfı, kod yorumunda adıyla |
| PLANNED → READY | `WOUND` | `updateMany({id, status:PLANNED})` | Aynı tx'te iplik satırları `applyYarnMovementTx(kind:WARP_ISSUE, warpBeamId)`. Tek yazar olduğu için iplik modül kapısı da içeride koşar. Çok satırlı çıkış **kanonik `(itemId, warehouseId)` sırasıyla** yazılır: eksi bakiye kapısının `FOR UPDATE` serileştiricisi çağıranın sırasına güvenir (`yarn-balance-guard.helper.ts:99-103`) | makine `producesWarpBeam` değil → 400; iplik denye'siz → 400 |
| READY → CANCELLED | `WOUND_CANCEL` | `updateMany({id, status:READY})` | Net iplik (kalem × depo × lot) `WARP_ISSUE_REVERSAL` ile döner; `reverseGoodsReceiptYarnTx` net + idempotent emsali | aktif (terslenmemiş) `MOUNTED`/`CONSUMED` varsa 409 |
| READY → MOUNTED | `MOUNTED` | `updateMany({id, status:READY})` + yuva seddi; P2002 → 409 | Yarım levent başka makineye bağlanıyorsa UYARI ("uyum: model/en/takım") | makine `consumesWarpBeam` değil → 400; yuva > `warpBeamSlots` → 400 |
| MOUNTED → READY | `DISMOUNTED` | `updateMany({id, status:MOUNTED, currentMachineId})` | Kalan ölçüm girildiyse fark önce `CONSUMED`/`ADJUST_IN` | — |
| MOUNTED/READY → EXHAUSTED | `EXHAUSTED` | claim | Ölçülen artık ≠ türetilen kalan ise fark önce `CONSUMED`/`ADJUST_IN`, sonra `EXHAUSTED(lengthM = artık)` → kalan 0 | — |
| READY/MOUNTED → SCRAPPED | `SCRAPPED` | claim | `lengthM` = kalan; `reasonCode` zorunlu (sunucuda) | — |
| (durum değişmez) | `ADJUST_IN` / `ADJUST_OUT` | `updateMany({id, status})` — durum aynı kalır, claim yalnız yarışı keser | Ölçüm düzeltmesi: `lengthM` > 0, `reasonCode` ZORUNLU (`ReasonPresetKind.WARP_BEAM_ADJUST`). Yanlış yazılan düzeltme KARŞI ADJUST ile kapanır ve `reversesEventId` ile orijinaline bağlanır | kalan metreyi eksiye düşürüyorsa 409; terminal durumda 409 |
| `*_CANCEL` | ters | claim: durum, terslenen olayın `fromStatus`una döner | — | **İSTİSNA — `WOUND_CANCEL`:** doğuşun stornosudur, `fromStatus` (PLANNED) kuralına GİRMEZ; durumu **CANCELLED**'a (terminal) taşır. Aksi hâlde levent PLANNED'a dönerdi ama `warp_beam_events_one_wound_uq` yüzünden bir daha sarılamazdı (tekrarlanamaz iş, `defter.md:22` tuzağı) ve §4.9 #5 mutabakatı yalan alarm verirdi |

- **LIFO'nun kapsamı.** "En yeni aktif ileri olay" kuralı yalnız **DURUM DEĞİŞTİREN** olaylar için geçerlidir (`WOUND` · `MOUNTED` · `DISMOUNTED` · `EXHAUSTED` · `SCRAPPED`). Yalnız miktar yazan olaylar (`CONSUMED`, `ADJUST_*`) zinciri kilitlemez: her biri kendi ters satırıyla (`CONSUMED_CANCEL`, karşı `ADJUST`) hedefini `reversesEventId` ile göstererek kapanır. Aksi hâlde bir ölçüm düzeltmesi, kendinden önceki her stornoyu kalıcı 409'a düşürürdü. Yüklem TEK helper'dadır: `activeForwardStatusEvent` (↔ `ACTIVE_FORWARD_EVENT_WHERE`, boğaz-ikiz).
- **Kilit.** Yeni advisory uzayı GEREKMEZ: yuva ve gövde tekilliğini partial UNIQUE seddi, durumu claim korur. `beamNo` sayacı **kilitsiz sayaç emsallerini** izler (`shipmentNo`/`nextSackNo`, `shipping.service.ts:444-446`) — `workOrderNumber` emsal DEĞİLDİR (kendi döngüsü var, sayacı tx dışında okur). Advisory KULLANAN sayaçlar (8022 parti no, 8031 paketleme grubu) çakışması iş akışını durduran numaralar oldukları için farklıdır; levent numarası çakışması yalnız retry ister. ⚠️ `withBarcodeRetry(fn, 5, (e) => !isClientTokenP2002(e))`: predicate verilmezse TÜM P2002 retry edilir ve `clientToken` çakışması beş tur aynı token'ı yazıp replay'i atlar, kullanıcıya "Barkod üretimi 5 denemede başarısız" 409'u döner (`utils/p2002.ts:30-35`).
- **Eksi bakiye kapısı.** Bugün yalnız `OUT`'u kapılar (`yarn-balance-guard.helper.ts:113`). Kapılanan küme `WARP_ISSUE`'yu içerecek şekilde genişler, `WARP_ISSUE_REVERSAL` muaf kalır (storno). Bayrak metinleri "OUT" diyor, "iplik çıkışı" olarak güncellenir. ⚠️ Kapının `FOR UPDATE` kilidi yalnız VAR OLAN `yarn_stocks` satırında oluşur (satır yoksa bakiye 0 kabul edilir, kilit alınmaz): ilk kez hareket gören (kalem × depo) çiftinde kanonik sıra yarışı serileştirmez. **KARAR (Faz 1b, yönetici 2026-09-12 — "serileşmiyorsa kapı değildir"):** kapı, kendi içinde ve bakiyeyi okumadan ÖNCE `yarn_stocks` satırını `INSERT … ON CONFLICT DO NOTHING` ile doğurur; böylece `FOR UPDATE` daima gerçek bir satırı kilitler. Advisory uzayı AÇILMAZ: kilitlenecek doğal satır ve `(itemId, warehouseId)` UNIQUE'i zaten var, advisory yalnız yeni bir kilit sırası sorusu getirirdi. Sıfır bakiyeli satır zararsızdır — hareket zaten aynı tx'te `ON CONFLICT` ile o satırı yazacaktı. Çok satırlı `WOUND` çıkışı ayrıca kanonik `(itemId, warehouseId)` sırasıyla yazılır (kilit sırası determinizmi).
- **İdempotency.** `WarpBeam.clientToken` (plan ya da doğrudan sarım) ve `WarpBeamEvent.clientToken` (tabletten tüketim girişi saf INSERT'tir) dört durumlu replay kullanır (`helpers/token-replay.helper.ts`). `clientToken`'lı model sayısı 15'ten 17'ye çıkar.
- **Modül kapısı TEK YAZARIN İÇİNDE.** `applyWarpBeamEventTx`in ilk ifadesi devere zincirini ölçer (`applyYarnMovementTx` iplik kapısı emsali, `yarn.service.ts:171-177`). Route'ta ayrıca adlandırılmış `requireDevereEnabled` durur.
- **Elle iplik hareketi yolu kapalı kalır.** `POST /api/yarn/movements` Zod'u `WARP_*` kabul ETMEZ (`yarn.routes.ts:205` literal enum). Aksi halde `warpBeamId`'siz devere çıkışı doğar ve levent iptalinin net ters kaydı onu bulamaz. GET filtre Zod'u (`:160`) genişler.
- **Yıkıcı işlem önizlemesi.** `WOUND_CANCEL` ve `SCRAPPED` için preview ucu: dönecek iplik satırları (kalem · depo · lot · kg) ve etkilenen levent listelenir.

### 4.8 Türetilmiş değerler — tek helper + SQL ikizi

| Değer | Formül | Helper |
|---|---|---|
| Kalan metre | `Σ warpBeamLengthSign(kind) × lengthM` | `warpBeamRemainingM` ↔ `WARP_BEAM_REMAINING_SQL` |
| Yarım levent | `status='READY'` ∧ aktif `CONSUMED` var | aynı helper |
| Teorik (nominal) kg | `endsCount × denier × lengthM / 9_000_000` (Decimal, 3 hane) | `warpTheoreticalKg`; panel/tablet ön hesabı AYNI fonksiyonun aynası |
| Devere firesi kg | `Σ net WARP_ISSUE(beam) − WOUND.theoreticalKg`; yalnız `kgSource='WEIGHED'` | `warpingWasteKg` |
| Kopuş / milyon m | `breakCount × 1e6 / (endsCount × lengthM)` | rapor |
| Levent dibi / hurda m | aktif `EXHAUSTED.lengthM` / `SCRAPPED.lengthM` | rapor |
| Lot bakiyesi (Faz 2) | `Σ yarnMovementSign × qtyKg WHERE lotId` | `yarnLotBalance` |
| Kumaş metre ← çözgü (Faz 4) | `kumaş = çözgü × (1 − takeUp)`; take-up% = (çözgü − kumaş) / çözgü. **Crimp% (kumaş boyuna göre) SAKLANMAZ**, gerekirse gösterimde çevrilir | take-up kumaş teknik kartından; ölçüm (levent, desen, tezgah) üçlüsüne bağlanır, sabit değildir |
| Kalan metre, tartıdan (Faz 5) | `(brüt − dara) / (endsCount × denier / 9000)` | levent demirbaş kartındaki darayı ister |

### 4.9 Mutabakat ve ölçülmüş sessiz sayım tuzakları

Faz 1 ile birlikte **zorunlu** düzeltmeler (yapılmazsa ilk levent iptalinden sonra sahte fark çıkar):
1. `scripts/test_consistency.ts:742,751` (§27) iplik mutabakat SQL'i `kind IN ('IN','ADJUST_IN')` dışındaki her şeyi eksi sayıyor. `WARP_ISSUE_REVERSAL` eksi sayılır. İşaret tek kaynaktan türetilecek şekilde düzeltilir; negatif sondası: iptal edilmiş levent fixture'ı.
2. `purchase-order.service.ts:261-270` aynı ikili ayrımı yapıyor. Bugün fiş bağıyla süzüldüğü için etkisi yok (gizli mayın); `yarnMovementSign`'a bağlanır.
3. `consistency-check.sql`'de iplik bölümü **hiç yok**; mutabakat yalnız `test_consistency` §27/§28'de.

Yeni mutabakat bölümleri:
1. `status IN ('EXHAUSTED','SCRAPPED','CANCELLED')` ⇒ kalan metre = 0.
2. `status IN ('READY','MOUNTED')` ⇒ kalan metre > 0 ve tam bir aktif `WOUND`.
3. Son olayın `toStatus`u = `WarpBeam.status` (`ChequeEvent` emsali).
4. `CANCELLED` levent ⇒ `Σ net WARP_ISSUE` = 0 (kalem × depo × lot).
5. `PLANNED` levent ⇒ hiç olay ve iplik satırı yok.

---

## 5 · Modül bayrağı

- **Anahtar.** DB `devere.enabled` · API `devereEnabled` · etiket "Devere / levent". **Varsayılan KAPALI**; okuyucu `asBoolean` varsayılanı `false`. Üretim modülündeki "satır yok → true" sigortası BURAYA KOPYALANMAZ.
- **Bağımlılık.** `MODULE_DEPENDENCIES.devereEnabled = "iplikEnabled"`; zincir iplik → ticaret. Levent iplik stoğunu tüketir ve iplik mal kabulle girer, yani dokumacının ticaret modülü zaten gerekir.
  - Yazma doğrulaması iki yönlüdür (`system-setting.service.ts:1927-1953`): iplik kapatılırken devere açıksa 400 `MODULE_DEPENDENCY` "önce Devere modülünü kapatın". Ama gövdenin dokunmadığı çift atlanır. Bu yüzden **okuma kapısı zinciri elle ölçer**: `requireDevereEnabled` ticaret → iplik → devere sırasıyla okur ve eksik OLANI söyler (`{ code:"MODULE_DISABLED", modul:"iplik", dependent:"devere" }`). `requireIplikEnabled` bugün tek seviyelidir (`module.middleware.ts:111-133`).
  - `effectiveModuleValue` switch'ine `devereEnabled` case'i ZORUNLU. Eksik kalırsa iplik'e dokunan HER PATCH 400 "Bilinmeyen modül anahtarı" alır (`system-setting.service.ts:1894-1911`). Bunu statik bir bekçi yakalamaz.
- **Dokuma ile ilişki.** Devere dokumadan bağımsızdır: fason devere atölyesi olabilir, **raşel (çözgülü örme) tül** de levent tüketir. Faz 3 bağlama/söküm/elle tüketim **devere** modülündedir (tezgah ya da raşel = `Machine`). Faz 4'te top çıkışından otomatik tüketim **dokuma** bayrağının kapsamındadır. Repoda `dokuma.enabled` YOK; dokuma tarafının tek yer tutucusu `tezgah.enabled`, o da "Dokuma tezgah izleme" (monitörizasyon), üretime bağlı ve yüzeysiz. Ad uzlaşması §9'da.
- **Profiller** `taban()`/`acik()` ile üretilir: `taban()` YEDİ anahtarın hepsini açıkça `false` yazar, yani kural dosyasındaki "her profilde açıkça yazılır" TAMLIK kuralı bugün de geçerlidir — yalnız uygulanışı yardımcı fonksiyona taşınmıştır (`module-profiles.ts:95-99`). Devere eklenince `taban()` sekizinciyi kendiliğinden yazar; elle değişecek tek yer `test_module_profile §1b`'deki `7` sayısıdır. `tam` spread ile devere'yi **kendiliğinden açık** alır. `dokuma` profiline elle eklenir. **Mevcut `perde` profili DEĞİŞMEZ** (kumaşı hazır alan kurulum); hedef kitle için AYRI bir **`perde-dokuma`** profili doğar (ticaret + iplik + devere açık; tezgah Faz 4'te) — yönetici kararı §9.4. `basit` (adnansahin) ve `standart` kapalı kalır.
- **Grandfathering (karar).** Devere, grandfathering migration'ından (`20260902230000`) SONRA doğan ilk modüldür; eski migration değiştirilemez. Karar: **yeni migration** `devere.enabled = false` yazar (`ON CONFLICT DO NOTHING`). "Sabit false yasağı"nı çiğnemez: kural dünkü davranışı yazmayı emreder, dünkü davranış "devere yok"tur, ve kumasTeknik/tezgah için aynı gerekçeyle sabit false yazıldı (`migration.sql:38-44`). Tek dosyaya sabit üç bekçi dosya LİSTESİNE genişletilir: `test_module_flags §6c`, `test_module_profile §6c/§6d`, `test_module_grandfathering`. `MIGRASYON_DISI` yolu reddedildi; migration başlığı finance'ı olumsuz emsal sayıyor. Kural satırı (`modul-bayrak.md:52`) "yeni doğan modülde dünkü davranış = false" diye daraltılmalı (§9).
- **Dokunuş listesi (ölçüldü).**
  - Backend: `module-flags.ts` 4 tablo · `system-setting.service.ts` (SETTING_KEYS, FeatureFlags, getFeatureFlags, setFeatureFlags dalı, `readDevereEnabled`, `effectiveModuleValue`) · `feature-flag.routes.ts` strictObject · `module-profiles.ts` (alan eşlemesi + üç yazarlı açıklama) · `screen-catalog.ts` (ModulKey, EKRAN_MODUL_DEGERLERI; yüzey Faz 1'de doğduğu için EKRANSIZ'a GİRMEZ) · `module.middleware.ts` `requireDevereEnabled`.
  - **İzin — kapıladığı yetenekle AYNI fazda doğar** (yönetici kararı 2026-09-12; çıkışsız izin katalogda ölü satırdır). **1a:** `warpspec:read` · `warpspec:write` (Çözgü Kartları ekranı). **1b:** `warpbeam:read` · `warpbeam:write` + yıkıcı uçlar için ayrı **`warpbeam:cancel`** (`WOUND_CANCEL`, Faz 3 `SCRAPPED`) — yalnız Süpervizör/Muhasebe rolüne atanır, bugünkü SoD üçlüsüyle (`shipping:invoice` · `shipping:undo-dispatch` · `roll:manual-adjust`) aynı sınıfta. `screen-catalog.ts` girdisinde `requires` ZORUNLU alandır; migration YAZILMAZ (katalog + boot uzlaştırması). Bekçiler: `test_permission_catalog` · `test_role_template_catalog` · `tile-route-permission.test`.
  - **Birleştirme haritası (atlanırsa SESSİZ).** `merge-map.ts`e: `WarpSpec.yarnItemId` → `MOVE` (Faz 1a, `YarnMovement.itemId` emsali); Faz 2'de `YarnLot.itemId` → `MOVE` ve `YarnLot.supplierId` → `MOVE`. `YarnLot`ta `@@unique([itemId, lotNo])` birleşmede çakışabilir → `CONFLICT` politikası gerekçesiyle yazılır. Bekçi `test_master_data_merge_fk_coverage` şema metninden `Item`/`Customer` FK'larını türetip haritada olmayanı DÜŞÜRÜR, yani bu satır unutulursa Faz 1a kırmızı verir.
  - **İçe aktarma adaptörleri.** `import/adapters/station.adapter.ts` (yeni bool sütun + `validateRow` + `exportRows` round-trip + `toServicePayload` allowlist) ve `item.adapter.ts` (`linearDensityDen` sayı sütunu; denye toplu girilecek tipik alandır). Modül kapalıyken sütunun şablondan düşürülüp düşürülmeyeceği kararı aynı commit'te yazılır.
  - **Kalıcı silme kapıları.** `/permanent` uçları bağımlılığı FK'dan değil ELLE yazılmış guard listesinden okur: `MACHINE_DELETE_GUARDS` + `machineDeletePreview` + istasyon guard'ına `warpBeamCount` / `warpBeamEventCount` satırları eklenir (geri alınmış `*_CANCEL` satırları DAHİL sayılır — `defter.md:25`, `workSessionCount` emsali). `WarpSpec` için de `beams` sayısı → Türkçe 409; eklenmezse ham P2003 döner.
  - Electron: `lib/module-flags.ts` 5 tablo · `featureFlagService.ts` · `flag-modules.ts` (`HideableModule` Exclude'a eklenmezse TS7053) · `moduleProfile.helpers.ts` `modulesThatDependOn` yalnız DOĞRUDAN bağımlıyı döner, geçişli kapanışa çevrilir (yoksa "Ticaret kapanırsa" önizlemesi Devere'yi göstermez; `moduleProfile.helpers.test.ts:104` kırmızı).
  - Mobil: modül alanı yok, dokunuş yok.
  - Bekçiler: `test_module_profile §1b` (===7 → 8) · `test_feature_flag_contract` PANEL_EXEMPT + §15 elle liste (eklenmezse sessiz kapsam boşluğu) · `test_module_flag_off` ALAN_DB_ANAHTARI + §1e/§1h/§7 **tek seviyeye kilitli**, geçişli zincire genişletilir · `test_module_flags §3b/§6c/§9` · `test_screen_catalog` · yeni `test_devere_regime_gate`. `400 MODULE_DEPENDENCY`'yi doğrudan ölçen bekçi bugün YOK; devere ile yazılır.
- **Yüzeyler kapalıyken.** Menü/karo çizilmez, route 403. `Item` formunda denye yalnız `iplikEnabled`, çözgü kartı alanı yalnız `devereEnabled` iken görünür. `Station` formundaki iki yetenek kutusu yalnız `devereEnabled` iken görünür.

## 6 · adnansahin sıfır-fark kanıtı (Faz 1)

| Dokunuş | adnansahin'de etkisi |
|---|---|
| 3 yeni tablo | Boş kalır; hiçbir mevcut sorgu okumaz |
| `Item.linearDensityDen`, `Item.warpSpecId`, `YarnMovement.warpBeamId` | Nullable, NULL kalır. Ad kolonu okunmaz, yazılmaz, taşınmaz |
| `Station.producesWarpBeam` | `@default(false)`; mevcut satırlar false. Zod'a opsiyonel eklenir (gövde allowlist dersi: iki uçta da sözleşmeye) |
| `YarnMovementKind` +2 | adnansahin'de iplik KAPALI, satır doğmaz. Derlemede yalnız `yarnMovementSign` kırılır (iyi). Sessiz yanlış sayan iki liste §4.9'da düzeltilir. Electron `YARN_KIND_META[m.kind]` tanımadığı türde **TypeError ile çöker** (`YarnMovementsSheet.tsx:206-217`): aynı sürümde bilinmeyen tür için geri düşüş etiketi eklenir. `YARN_KINDS` filtre ile elle hareket diyaloğunun ORTAK listesidir (`YarnMovementDialog.tsx:169-173`); `WARP_*` yalnız filtreye girer. Kaynak sütunu `warpBeamId`'yi tanır (bugün `stockCountId`'yi bile tanımıyor, "Elle giriş" basıyor) |
| `devere.enabled` | `false`; iplik + ticaret kapalıyken açılamaz (400) |
| Grandfathering migration | `devere.enabled=false` satırı; davranış değişmez |
| İzin kodları (`warpbeam:read/write/cancel`) | Katalog koda girer, boot uzlaştırması DB'ye getirir ama KİMSEYE ATAMAZ; adnansahin'de hiçbir kullanıcı bu kodları almaz, hiçbir ekran çizilmez |
| Birleştirme haritası + içe aktarma sütunları | Yalnız devere tablolarını/alanlarını kapsar; mevcut birleştirme ve şablon davranışı değişmez (yeni sütun modül kapalıyken şablondan düşürülür) |
| Migration genel | Tamamen eklemeli; enum değeri ayrı migration'da; CHECK ve partial index ham SQL + envanter. `items`'a iki nullable kolon (tablo yeniden yazımı yok); `yarn_movements` fabrikada boş |
| Eski istemci | Eski panel yeni uçları çağırmaz. Yeni türler yalnız devere AÇIK kurulumda doğar, açmak da yeni panel ister; bu yüzden `minVersion` yükseltilmez. Süperadmin devereyi panel güncellemesinden SONRA açar (runbook adımı) |
| `test_iplik_regime_gate` DEFTER_YAZARLARI | Levent servisi `applyYarnMovementTx` çağıranı olarak listeye gerekçeyle yazılır. ⚠️ Bekçi **bugün zaten kırmızı**: başka oturumun commit'lenmemiş `stock-count-reversal.service.ts` dosyası yüzünden (ölçüldü, exit=1) |

## 7 · Fazlandırma

| Faz | Kapsam | Değer | Şema | Ön koşul |
|---|---|---|---|---|
| **1a — Katalog ve kimlik** (defter YAZMAZ) | `devere.enabled` + grandfathering migration + `requireDevereEnabled` + bayrak dokunuşları (§5) · **izin kodları + ekran `requires`** · `Item.linearDensityDen` · `WarpSpec` CRUD + `Item.warpSpecId` · `Station.producesWarpBeam` · **birleştirme haritası + içe aktarma adaptörleri + kalıcı silme kapıları** · panel "Çözgü Kartları" ekranı (teorik kg hesaplayıcısı dahil) | Çözgü kartları ve denye verisi girilmeye başlanır — 1b'nin veri ön koşulu. **Hiçbir defter satırı doğmaz**, dolayısıyla ters yol borcu da doğmaz | 1 tablo · 3 kolon · 2 şema-dışı nesne · 3 izin kodu | — |
| **1b — Levent doğar** (EN KÜÇÜK ANLAMLI ÇALIŞAN ADIM) | `WarpBeam` + `WarpBeamEvent` · `WOUND`/`WOUND_CANCEL` (önizlemeli) · `WARP_ISSUE`/`WARP_ISSUE_REVERSAL` + `YarnMovement.warpBeamId` · gerçekleşen kg + `kgSource` · levent planı · hazır levent listesi (çözgü kartına göre gruplu) · §4.9 sayım düzeltmeleri · bekçiler | "İplik nereye gitti" ve "hangi leventler hazır" ilk kez cevaplanır; tartılan sarımda devere firesi kg görünür | 2 tablo · 2 enum değeri · 1 kolon · 7 şema-dışı nesne | 1a |
| **2 — Lot** | `YarnLot` · mal kabul iplik satırına lot + bobin adedi · sarımda lot seçimi · karışık/lotsuz lot uyarısı · "bobin metrajı kalbaya yeter mi" uyarısı · türetilen lot bakiyesi · levent → lot → irsaliye geri izleme | Çözgü yolu / ton farkının kök nedeni izlenir | 1 tablo · 2 kolon | İlk dokuma müşterisinde **Faz 1 ile aynı sürümde** önerilir: lotsuz sarılan levent kalıcı olarak lotsuz kalır |
| **3 — Tezgah ve kalan metre** | `MOUNTED`/`DISMOUNTED`/`CONSUMED`(elle)/`ADJUST_*`/`EXHAUSTED`/`SCRAPPED` + tersleri · `Station.consumesWarpBeam` · `Machine.warpBeamSlots` · iki sebep kataloğu · levent kartı etiketi · tablet ekranı (yeni oturum türü) | Hangi tezgahta ne bağlı, kalan metre, levent dibi firesi, düğüm/tahar/takım süresi | CHECK genişlemesi · 2 enum değeri · 2 kolon · 2 şema-dışı nesne | #13, #14, #15, #16 |
| **4 — Top tezgahtan doğar** (dokuma bayrağıyla) | Rotada Dokuma adımı + tezgah çıkışı motoru (iş emri İÇİNDE doğum) · `RollEntrySource.WEAVING` · top çıkışında `CONSUMED(rollId)` otomatik (çift levent → iki satır) · take-up · atkı sayacı → metre | Top → levent → lot → tedarikçi geri izleme; randıman | enum değeri + tezgah defterleri (`SEKTOR` dokuma bulguları) | #8 · take-up verisi · `kumasTeknik` Dilim 3 |
| **5 — Gerekirse** | haşıl olayı · ara levent/direkt çözgü birleştirme · levent demirbaş kartı (dara → tartıdan kalan metre) · tezgah teknik kartı ve uyum kontrolü · ayrı lot bakiye tablosu · çok iplikli/renk raporlu çözgü · tahar planı yapılandırması · levent konumu · fason devere · bobin dipleri iadesi | Sektör genişliği | ölçüme göre | #9, #10, #11, #20, #22 |

**Migration bandı:** `20260912120000` ve üstü (yönetici tahsisi; 6e `110000` bandını kullanıyor).

**Faz 1 bekçileri** (yazılacak, negatif sondalı):
- `test_devere_regime_gate`: iplik emsali; kapalı modülde 403, tek yazar kapısı, üç seviyeli zincir mesajı.
- `test_warp_beam_lifecycle`: claim yarışı; `WOUND_CANCEL` net ters kayıt + idempotent ikinci çağrı (aynı `clientToken` → cached yanıt, "Barkod üretimi…" 409'u DÖNMEZ); LIFO'nun yalnız durum olaylarını kapsaması; çift iptal seddi; işaret tablosu; formül fixture'ı 816,67 kg.
- Mekanik kapılar: `test_permission_catalog` · `test_role_template_catalog` · `test_master_data_merge_fk_coverage` (yeni `Item`/`Customer` FK'ları haritada) · `test_import_framework` (round-trip) · `test_screen_catalog`.
- `test_yarn_stock` genişlemesi: yeni türler bakiye / eksi kapı §10 / kanonik sıra.
- `test_consistency §27` işaret-tabanlı; iptal edilmiş levent sondası.
- `test_db_invariants` envanteri · `test_audit_labels §4` (ENUM_LABELS) · modül bekçileri (§5).
- AST: `warpBeamEvent` üzerinde `update*`/`delete*` çağrısı YOK; `WARP_BEAM_EVENT_KINDS` ↔ CHECK iki yönlü.

## 8 · Dokumacıya sorulacaklar

### Saha kaynağındaki sekiz — bu taramadan sonra durumları

| # | Soru | Durum |
|---|---|---|
| 1 | Bölen 9000 mi 9.000.000 mu | **Fizikle çözüldü** (§1.2): `/9000` gram verir. Yalnız teyit; bloke etmez |
| 2 | `3500 × 300 × 7000` sırası | Sonucu etkilemez; kayıt için sorulur. Bloke etmez |
| 3 | Atkı tüketim formülü | Devere kapsamı dışı (atkı dokumada tüketilir), Faz 4 |
| 4 | Desen kartı sol/orta blok | Dokuma kapsamı; levendi etkilemez |
| 5 | `UA6007` ↔ `A800` ilişkisi | `Item.warpSpecId` hangi koda bağlanacak (teknik desen mi, ticari ürün mü). N:1 olduğu için şemayı değiştirmez; Faz 1 ekran varsayılanını belirler |
| 6 | "Uğur" tezgah mı operatör mü | Faz 3 (bağlama olayında makine/operatör) |
| 7 | Levent tipik metresi | Faz 1 plan varsayılanı; bloke etmez |
| 8 | Tezgah marka/veri çıkışı | **Faz 4'ü bloke eder** |

### Yeni sorular (9–22)

| # | Soru | Neyi belirler | Bloke? |
|---|---|---|---|
| 9 | Çözgüyü konik (devere) makinede mi hazırlıyorsunuz, direkt çözgü + haşıl hattı da var mı? Cağlık kaç bobinlik, magazin cağlık mı? Kaç kalba, kalba başı kaç tel? | Ara levent (Faz 5); kalba alanları | Hayır |
| 10 | Haşıl yapıyor musunuz? Hangi iplikte, içeride mi fasonda mı? Haşıl alma yüzdesi? | Haşıl olayı; nominal/gerçek kg farkı | Hayır (su jetinde öne çekilir) |
| 11 | Bobinleri depodan tartarak mı çıkarıyorsunuz? Sarım bitince bobin dipleri ne oluyor: tartılıp depoya mı dönüyor, atkıya mı gidiyor, telef mi? | Tüketim yöntemi (§3.7); `WARP_RETURN` türü | **Faz 1 kapsamını değiştirebilir** (bir tür çifti) |
| 12 | Bir levende tek lot şartı var mı? Bobin metrajı kalbaya yetmeyince ortada lot değişiyor mu? | Lot uyarısının sertliği (Faz 2) | Hayır |
| 13 | Metal leventleriniz numaralı mı, kaç tane, darası biliniyor mu? Çift levent tezgahınız var mı? | `physicalBeamNo`, `warpBeamSlots`, tartıdan kalan metre | Faz 3 |
| 14 | Leventte kalan metreyi bugün nasıl biliyorsunuz: tezgah ekranı, çap ölçümü, tartı, tahmin? | Faz 3 elle tüketim ekranının biçimi | Faz 3 |
| 15 | Levent bitince dipte ne kadar kalıyor (m ya da kg), o artık ne oluyor? | Levent dibi fire kaydı | Faz 3 |
| 16 | Düğüm makineniz var mı? Tahar dairesinde takım hazırlıyor musunuz? Tahar / düğüm / takım değişimi tipik kaç saat, kim yapıyor? | Bağlama yöntemi ve süre alanlarının anlamı | Faz 3 |
| 17 | Çözgü boyunu neye göre veriyorsunuz: sipariş metresi + kısalma payı mı, levent kapasitesi mi? Kısalma yüzdesi kartta yazıyor mu, nasıl ölçülüyor? | Plan ekranı; Faz 4 take-up | Hayır |
| 18 | "600 KAR İPİ"deki 600 nedir (büküm tur/m, kod, başka)? | İplik kartı alanları: ad ayrıştırılmaz, doğru alan elle doldurulur | Hayır |
| 19 | Devere kopuşlarını sayıyor musunuz, fireyi tartıyor musunuz? | `breakCount` ve `kgSource`'un saha karşılığı | Hayır |
| 20 | Devereyi hep içeride mi yapıyorsunuz? Fason devere yaptırdığınız, levent satın aldığınız ya da başka dokumacıya levent verdiğiniz oluyor mu? | Fason devere: `WOUND`'da makine yerine fason firma + ipliğin fasona çıkışı | **Faz 1 kapsamını değiştirebilir** |
| 21 | Tül perdeyi dokuma tezgahında mı, raşel (çözgülü örme) makinesinde mi üretiyorsunuz? | Levent tüketen makine türü; raşelde çok levent/kılavuz barı | **Faz 1 kapsamını değiştirebilir** (yetenek adı/`warpBeamSlots` Faz 1'e çekilir) |
| 22 | Tezgah tipiniz ne: su jeti, hava jeti, rapier (kancalı), jakar/armür? | Haşıl ihtiyacı, levent tipi/uyum | Hayır |

## 9 · Yönetici kararları (2026-09-12)

Taramanın açık bıraktığı beş çelişki `teks-erp-1e` tarafından karara bağlandı. Kararlar aşağıda; gerekçeler ölçüt sırasına göre (① sektör standardı ② ölçeğimiz ③ kod deseni). **Uygulama sırası yöneticidedir; bu belge hâlâ ÖNERİDİR.**

| # | Konu | KARAR | Gerekçe | Belgedeki karşılığı |
|---|---|---|---|---|
| 9.1 | Rota ↔ devere adımı | **Öneri kabul.** Dokuma rotada ADIM + topun giriş noktası (Faz 4, tezgah çıkışı motoruyla). Devere yalnız istasyon KATALOĞUNDA (makine, oturum, yetenek); iş emri adımı değil. Levent kendi tablosunu ve defterini alır | ① çözgü/leventleme top doğmadan önceki hazırlıktır, top rotasının adımı değildir ② çekirdek adım kodu (recompute + quickStart) canlı fabrikanın bütün akışını taşıyor; levent için ona dokunmak orantısız risk ③ recompute topsuz adımı PENDING bırakıyor (ölçüldü, §3.3) | §3.3 · §7 Faz 4 |
| 9.2 | Bayrak adı | **Öneri kabul.** `tezgah.enabled` monitörizasyon olarak KALIR; `dokuma.enabled` Faz 4'te doğar (üretime bağlı). Var olan anahtarın anlamı genişletilmez — DB anahtarı kimliktir | ③ mevcut anahtarın kapsamı kodda ve bekçilerde yazılı | §5 "Dokuma ile ilişki" |
| 9.3 | Grandfathering kural satırı | **Daraltılacak:** "dünkü davranışı olmayan (yeni doğan) modülde değer = false". Kural satırı `docs/kurallar/modul-bayrak.md`'ye yazılır, ezilen eski cümle `GEÇERSİZ → 2026-09-12` diye işaretlenir, gerekçe arşive girer | ③ kod ve bekçi yer tutucular için zaten sabit `false` yazıyor (`20260902230000` migration'ı); kural satırı düz okununca bunu yasaklıyor görünüyordu | §5 "Grandfathering" |
| 9.4 | Profil | **Mevcut `perde` profili DEĞİŞMEZ** (kumaşı hazır alan kurulum). Hedef kitle için AYRI profil doğar: **`perde-dokuma`** (ticaret + iplik + devere açık; tezgah Faz 4'te). `tam` devere'yi kendiliğinden açık almaya devam eder | ② profil de kimliktir; canlı kurulumun profil içeriğini değiştirmek sessiz davranış değişikliğidir | §5 "Profiller" |
| 9.5 | Tül / raşel | **Raşel ayrı modül DEĞİL.** `Station.consumesWarpBeam` + `Machine.warpBeamSlots` yeterlidir; levent tüketen makine dokuma tezgahıyla sınırlanmaz. Saha sorusu #21 açık kalır, tasarım iki cevaba da hazırdır | ① raşel (çözgülü örme) da levent tüketir, kılavuz barı başına bir levent ③ yetenek bayrağı kalıbı (`appliesQuality` emsali) makine türünden bağımsızdır | §4.5 · §8 #21 |

⚠️ **Kök `CLAUDE.md`'ye ve `MODUL-BAYRAK-TASARIM.md §5.2`'ye DOKUNULMADI.** Oradaki "devere/çözgü/haşıl yeni mimari istemez — istasyona istasyon, rotaya adım" cümlesi 9.1 kararıyla **daralıyor**: top rotası için doğru, levent için eksik. Kök dosyanın düzeltilmesi kullanıcı onayına bırakıldı (yöneticinin listesinde).

### Faz 1a / 1b ayrımı — karar ve kesme yerinin gerekçesi

Faz 1 tek sürüm için büyüktü (3 tablo + 2 enum değeri + 4 kolon + 9 şema-dışı nesne + panel ekranı). Kesme yeri **"defter yazıyor mu"** çizgisine kondu, "tablo sayısı" çizgisine değil:

- **1a hiçbir defter satırı doğurmaz** (katalog + kolon + bayrak). Ters yol borcu doğmaz, geri alma yüzeyi gerekmez, bekçi yükü küçüktür; yanlış giderse modül kapatılır ve geride yalnız boş katalog kalır.
- **1b defteri ileri VE geri yoluyla birlikte getirir** (`WOUND` + `WOUND_CANCEL` + `WARP_ISSUE` + `WARP_ISSUE_REVERSAL`). Doktrin bunu zaten şart koşuyor: "ters yol yazılmadan ileri yol sürüme çıkmaz" (`defter.md:56`).
- **Neden `WOUND` 1a'ya alınmadı:** iplik çıkışı olmadan doğan levent, sonradan kapatılamayan bir boşluk bırakır — o leventlerin ipliği hiçbir zaman deftere bağlanamaz (lot ile aynı sınıf hata, §7 Faz 2 notu). Levent doğuşu ile iplik tüketimi **aynı transaction ve aynı sürümde** kalmalıdır.
- **Sıra ön koşuludur, opsiyon değil:** 1b'nin sarım formu çözgü kartını ve denye'yi ister; 1a bu veriyi toplamaya başlatır.
