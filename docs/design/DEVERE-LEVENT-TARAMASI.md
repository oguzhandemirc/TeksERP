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
- **En küçük anlamlı ilk adım (Faz 1): "Levent doğar, iplik ona düşer, hazır levent stoğu görünür."** Bunun için dört parça gerekir: çözgü kartı (`WarpSpec`), levent (`WarpBeam`, durum tablosu — **kökeniyle birlikte**, §3.9), levent olay defteri (`WarpBeamEvent`, Faz 1'de yalnız `WOUND`/`WOUND_CANCEL`) ve iplik defterinde **brüt çıkış + ayrı iade**: `WARP_ISSUE`/`WARP_ISSUE_REVERSAL` ve `WARP_RETURN`/`WARP_RETURN_REVERSAL` (§3.7). Bunlara `devere.enabled` eklenir. Tezgaha bağlama, kalan metre, lot ve top bağı sonraki fazlarda. Faz 1 tek sürüm için büyük olduğundan **1a (defter yazmayan katalog) / 1b (levent doğar)** diye ikiye bölündü; kesme yeri ve gerekçesi §7'de.
- **Şema dokunuşu GEREKİR.** Şemasız anlamlı bir adım yok: iplik çıkışını serbest metne "LV-12 için" yazmak, doktrinin yasakladığı şeydir (iş kararı metinden okunamaz). Faz 1 tamamen EKLEMELİ: **3 yeni tablo · 3 yeni pg enum tipi (`WarpBeamStatus` · `WarpBeamOrigin` · `WarpKgSource`) · `YarnMovementKind`'a 4 değer · 5 nullable ya da varsayılanlı kolon · 1 modül anahtarı**; enum değerleri kendi tek ifadeli dosyalarında. **1a bu listenin bir bölümünü CANLI ŞEMAYA koydu** (ölçüldü 2026-09-12: `20260912120000_devere_modul_anahtari` · `..120100_devere_warp_spec` · `..160100_devere_sed` — `warp_specs`, `Item.linearDensityDen`, `Item.warpSpecId`, `Station.producesWarpBeam`, `devere.enabled`); kalan her şey **henüz yazılmamıştır** (`grep -c "warpBeam" src/ prisma/schema.prisma` → 0), yani bu belgedeki kısıt kararları hâlâ bedava değiştirilebilir. adnansahin'de sıfır fark (§6). Şema dışında üç mekanik kapı da Faz 1'e dahildir ve atlanırsa sessiz kırılır: **izin kataloğu + ekran `requires`** (§5), **birleştirme haritası** (yeni `Item`/`Customer` FK'ları, §5), **içe aktarma adaptörleri** (§5). Ayrıca iki mevcut sayım yolu işaret fonksiyonuna bağlanmalı, yoksa yeni ters kayıt türü sessizce yanlış sayılır (§4.9).
- **Faz 1'i bloke eden dokumacı sorusu YOK ve kapsamı kilitleyen soru da KALMADI** (2026-09-12 çerçeve kararı, §9.7). Formüldeki bölen sorusu (#1) fizikle çözüldü (§1.2); sıralama sorusu (#2) sonucu etkilemez (çarpma değişmeli). Kapsamı kilitleyen üçlü — **#11** (bobin tartımı ve dipler), **#20** (devere nerede yapılır), **#21** (dokuma mı raşel mi) — artık **cevabı beklenen soru değil, veri modelinin taşıdığı eksen**dir: üçünün de her cevabı aynı şemada kayıtlıdır (`WarpBeam.originKind` · `WARP_RETURN` çifti + sebep kataloğu · `Machine.machineClass` + `warpBeamSlots`). Saha cevabı artık **hangi satırların doğacağını** belirler, hangi kolonların yazılacağını değil. #5 (desen kodu ↔ ürün kodu) yalnız 1a'nın ekran varsayılanını belirler. Faz 3 #13/#14/#16'ya, Faz 4 #8'e bağlı.
- **ÇERÇEVE: tek senaryoya bağlanmaz — ve varyasyonun yeri DÖRT MEKANİZMADAN biridir, sırayla denenir** (2026-09-12 doktrini, §9.7):

  | # | Mekanizma | Ölçüt | Bu belgede |
  |---|---|---|---|
  | 1 | **[ÇEKİRDEK]** | Seçenek YOK — her kurulumda aynı | Brüt çıkış + ayrı iade (§3.7) · ters yol · atomik claim |
  | 2 | **VERİ** | Aynı kod yolu, farklı gerçek | `WarpBeam.originKind` · `Machine.machineClass` · `beamRole` |
  | 3 | **AKSİYON ANINDA SEÇİM** | **Aynı fabrikada iki kez farklı olabiliyorsa** — operatör o anda seçer | Dip kaderi (`WARP_RETURN` sebep kodu) · her leventin kökeni · koşumdaki levent sayısı |
  | 4 | **[PROFİL] BAYRAK** | **EN SON ÇARE** — yalnız gerçekten bir kod yolu açılıp kapanıyorsa | `devere.enabled` (canlı) · Faz 4'te `dokuma.enabled` |

  Ayırt edici cümle: **bayrak KOD YOLUNU açıp kapatır · veri AYNI kod yolunda farklı gerçekleri taşır · aksiyon anındaki seçim, aynı kod yolunda AYNI ANDA iki farklı gerçeği mümkün kılar.** Üç saha sorusunun hiçbiri "bu kod çalışsın mı" sorusu değildir — üçü de kaydın İÇERİĞİDİR ("bu levent nereden geldi" · "bu iplik nereye gitti" · "bu makine neyi sayar"). Bayrağa çevrilseydi, aynı fabrikada iki makine tipi ya da iki tedarik yolu olduğu anda bayrak çökerdi. **Üç eksen için sıfır yeni modül anahtarı.**
- **2 ile 3'ü ayıran soru: "bu değer kurulumda bir kez mi belirlenir, yoksa her kayıtta değişebilir mi?"** Değişebiliyorsa alan vardır AMA **formda seçim olarak görünmek zorundadır** — varsayılanı olabilir, kilitli olamaz. Üç örnek: fabrika aynı anda hem içeride sarıp hem hazır levent alabilir (köken her leventte seçilir) · dipleri bir gün depoya iade edip ertesi gün atkıya aktarabilir (sebep her sarımda seçilir) · aynı makinede bir koşum tek, sonraki çift leventle dönebilir (yuva doluluğu her koşumda girilir).
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
| 2 | Cağlık / bobin | İrsaliyede bobin adedi + lot + kg | Kalba başına tel kadar bobin. Bobin metrajı < kalba × boy ise **lot kalba ortasında değişir**. Bobin dipleri stoğa döner | `YarnMovement` kg; bobin ve lot yok | **Brüt çıkış, ayrı iade** (§3.7): cağlığa yüklenen `WARP_ISSUE`, dönen dip `WARP_RETURN` + sebep kodu. Tartmayan fabrikada iade satırı doğmaz — yokluk cevaptır. Lot ve "bobin yeter mi" kontrolü Faz 2 |
| 3 | Levent doğuşu | tel · metre · denye | + makine, operatör, lot(lar), kalba düzeni, kopuş, başlangıç | Yok | `WarpBeamEvent.WOUND` (doğuş gerçekleri append-only satırda) + aynı tx'te `WARP_ISSUE` hareketleri. **Doğuş yeri kayıtlıdır** (`WarpBeam.originKind`): içeride sarım makineyi, fason sarım fason firmayı, satın alınan levent tedarikçiyi taşır (§3.9) |
| 4 | Levent stoğu | Tezgah yanında bekleyen leventler | "Levent stok ambarı": tam ve **yarım** levent. Yarım levent **yarı mamuldür**, fire değil | Yok | `status = READY`; "yarım" türetilir (tüketim > 0). Konum Faz 5 |
| 5 | Tezgaha bağlama | Levent değişimi saatler, atkı değişimi dakikalar | Üç yol: **düğüm** (aynı tel/tahar/tarak) · **tahar** · **takım**. Yarım levent yalnız uyumlu (model/en) tezgaha, takımıyla ya da aynı taharla geçer. Bağlama ve sökümde sayaç okunur | Yok | Faz 3: `MOUNTED` olayı (`machineId`, `mountPosition`, `mountMethod`, `setupStartedAt`, `machineCounter`). Yöntem **önerilir** (önceki levent aynı `WarpSpec` ise düğüm), kullanıcı beyan eder |
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
| 🟡 | **İplik numarası** (`Item.yarnCountSystem` + `yarnCountValue`) | Formülün girdisi yalnız stok kartı ADINDA metin ("70 DN"); hesap yapılamaz. Ayrıca **denye tek sistem değil**: pamukluda Ne kullanılır ve TERS sistemdir (§3.8b) | `Item.name` | `Item` | Hayır: 1 enum + 1 nullable kolon; denye TÜRETİLİR. **Ad ayrıştırılmaz**, değer elle girilir | 1 |
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

### 3.7 Tüketim BRÜT yazılır, dönen dip AYRI satırla kapanır (Faz 1)

Sektör tüketimi `cağlık yüklemesi − bobin dipleri − tartılı fire` diye yazar ve **bu çıkarmanın iki ucu da ölçülmüş birer gerçektir**. Defter ikisini de tutar:

- **`WARP_ISSUE` = cağlığa yüklenen brüt kg.** Ne kadar iplik çıktığı sonradan düzeltilmez.
- **`WARP_RETURN` = dönen bobin dibi**, kendi satırında, **`ReasonPreset` kodu ZORUNLU**: `DEPOYA_IADE` (tartılıp aynı kaleme geri) · `ATKILIK_AKTARIM` (aynı iplik, kullanım sınıfı değişti) · `TELEF` (fire kararı). Üç saha senaryosu üç bayrak değil, **bir katalogda üç satırdır**.
- **Tartmayan fabrikada iade satırı hiç doğmaz.** "Bobinleri tartarak mı çıkarıyorsunuz" (#11) sorusunun cevabı, satırın VARLIĞIDIR; bayrak gerekmez. Yokluk zaten cevaptır.
- `WOUND.kgSource` KALIR ama anlamı daralır: "**sarım kg'ı nasıl bilindi**" (`WEIGHED` tartıldı | `THEORETICAL` nominal kabul edildi). "Brüt mü net mi" sorusu artık beyandan değil **satır sayısından** okunur.

**ÇEKİRDEK GEREKÇE — eski "net tek satır" kararı bu yüzden GEÇERSİZDİR.** Tek bir "gerçekleşen kg" satırı, fabrikanın ölçtüğü iki sayıdan birini (cağlığa ne yüklendiğini) deftere hiç yazmaz ve kalıcı olarak kaybeder. Bu, kök `CLAUDE.md`'nin çekirdek cümlesinin ihlalidir: *"Sevk rakamı HER yüzeyde BRÜT; iade ayrı belgeyle kapanır, çıkış belgesi düzeltilmez."* İplik çıkışı da bir çıkıştır. **Bu bir defter şekli kararıdır [ÇEKİRDEK], profil seçimi değildir**; hangi senaryonun satır doğuracağı [PROFİL]'dir.

Ters yol ileri yolla birlikte doğar: `WARP_RETURN_REVERSAL` (`defter.md:56`, "ters yol yazılmadan ileri yol sürüme çıkmaz").

### 3.8 İplik ters kaydı tipli: `WARP_ISSUE_REVERSAL`, `ADJUST_IN` değil

Bugünkü iplik stornoları `ADJUST_IN/OUT` yazar (fiş/fatura iptali, `yarn.service.ts:279-281`). Devere iptali bu desene uymaz. Doktrin tipli ters değer ister (`defter.md`), ve `ADJUST_IN` sayım fazlasıyla aynı kovadır: `SEKTOR`'ün "fire/kayıt düzeltmesi ayrımı yok" şikâyetinin ta kendisi. Bedeli ölçüldü: elle yazılmış iki yön listesi yeni "artıran" türü yanlış sayar (§4.9). Bu listeler Faz 1'de işaret fonksiyonuna bağlanır.

### 3.8b İPLİK NUMARA SİSTEMİ — denye tek sistem DEĞİLDİR (`yarnCountSystem`, ② VERİ)

`Item.linearDensityDen` (CANLI, `schema.prisma:1492`) yalnız **denye** tutar ve formül `tel × denye × metre / 9.000.000`. Pamuklu dokumacı ise **Ne** kullanır ve Ne **TERS** sistemdir (Ne 30 ince, denye 30 kalın). Operatör Ne değerini denye alanına yazarsa levent kilosu yanlış çıkar ve o değer `WOUND` satırına **kopyalanıp donar** (§1.2) — hata düzeltilse bile geçmiş levent yanlış kalır.

⚠️ **Hata büyüklüğü SABİT DEĞİL, ve bir yerde SIFIRA iniyor:** girilen `N`, doğru `5315/N` ⇒ **hata çarpanı `5315/N²`.** Ne 10 → 53,2× az · Ne 17 → 18,4× az · Ne 30 → 5,9× az · **Ne ≈ 73 → HATA YOK** · Ne 100 → 1,9× **fazla (yön döndü)**. **Sonuç mekanizma seçimini belirliyor:** *"makul aralık"* doğrulaması bu hatayı **yapısal olarak yakalayamaz** — eşik nereye konsa geçiş noktasının çevresi görünmez kalır ve yön sabit olmadığı için "çok küçük" kontrolü de çalışmaz. **Sistemi sormak, değeri denetlemekten daha güvenlidir.**

```prisma
/// KAPALI küme, pg enum. Aynı fabrika hem denye hem Ne iplik kullanır → KURULUM
/// anahtarı DEĞİL, KALEM alanı. Bayrağa çevrilseydi ikinci iplik kaleminde çökerdi.
enum YarnCountSystem { DEN  DTEX  NE  NM }   // DEN/DTEX doğru sistem, NE/NM ters
```

**KARAR: A′ — `linearDensityDen` DÜŞER, denye TÜRETİLİR** (yönetici 2026-09-12). Saklanan `yarnCountSystem` + `yarnCountValue`; denye tek helper `resolveDenier(system, value)` ile türetilir ve panel/tablet ön hesabı **aynı fonksiyonun aynasıdır**. Gerekçe: `Item`ta hem gireni hem türetileni tutmak **aynı gerçeğin ikinci kaydıdır** ve bu kalıp §9.6'da `remainingLengthM` için zaten reddedildi (iki yazar = "tek kaynak satır" sınıfı). Geçmişin dondurulması `Item` kolonuna değil `WOUND` satırına bağlıdır.

**Sözleşme kıran değişikliğin "eski istemci ne yapar" cevabı — ÖLÇÜLDÜ, ve eski istemci YOK:**

| Ölçüm | Sonuç |
|---|---|
| **Veri** — 35 `tekserp*` DB'sinin tamamı | Kolonun bulunduğu 18 DB'de `count("linearDensityDen") = 0`; kalan 17'de kolon HİÇ YOK (`tekserp_demo` dahil). fabrikanın dev kopyası: 245 item, 0 dolu denye |
| **Sözleşme** — alan adıyla arama | **DOLU:** Electron 7 dosya (form + Zod + WarpSpecs) · `item.service.ts` create/update · `warp-spec.routes.ts:27` API cevabı · `item.adapter.ts` round-trip. mobil 0 |
| **Sahadaki panel** | `linearDensityDen`in Electron'a girdiği commit **1.3.1'in ATASI DEĞİL** (`merge-base --is-ancestor` → HAYIR); `package.json` bugün 1.3.1, 1.3.2 hiç yayınlanmadı ⇒ **7 dosya sahada YOK** |

⇒ *"eski panel gönderir, Zod sessizce siler"* senaryosunun **istemcisi mevcut değildir**; backfill yok, geçiş dönemi yok, iki yazar yok. Kademeli yolun tek kazancı olan geçiş dönemi burada **boş bir dönemdir**.

⚠️ **Tek şart, ve yeri SÜRÜM NOTU DEĞİL PAKETLEME ADIMIDIR:** backend + panel **aynı pencerede** çıkar (bekleyen paketin kuralı zaten bu). Sürüm notu maddesi **gerekmez** — kullanıcının gördüğü hiçbir şey değişmiyor.

⚠️ **Aynı commit'te tazelenecek bayat metinler:** `warp-spec.service.ts:10` (yorum, *"kg = tel × denye × metre / 9.000.000"*) ve `:53` (Türkçe hata mesajı, *"kaleminin denye değeri boş"* → "numara değeri boş" + sistem adı). ⚠️ `prisma/migrations/20260912120100_devere_warp_spec/migration.sql:76` **DOKUNULMAZ** — migration geçmişi yeniden yazılmaz (checksum); bayatlığı yeni migration'ın başlığında açıklanır. **Kat iplikte** SONUÇ numarası girilir (Ne 30/2 → Ne 15); ad ayrıştırılmaz (§1.2 kuralı aynen).

### 3.9 Levent KÖKENİ bir veri boyutudur — devere içeride yapılmak ZORUNDA değildir

Saha sorusu #20'nin cevapları meşrudur ve **hepsi aynı tabloda yaşar**. ⚠️ **KÖKEN ile AKIBET ayrı eksenlerdir** — "başkasına levent verdik" bir köken değil bir akıbettir (`SHIPPED_OUT`) ve karıştırılırsa "dört köken" diye sayılır; köken **ÜÇ** (+ biri fazlandırılmış).

| Köken | `originKind` | Taraf kolonu | İplik tüketimi | Faz |
|---|---|---|---|---|
| İçeride sarıldı | `IN_HOUSE` | yok — `WOUND.machineId` dolu, taraf kolonlarının ÜÇÜ de NULL | `WARP_ISSUE` kendi stoğumuzdan | 1b |
| Fasona sardırıldı | `SUBCONTRACT` | `subcontractorId` | İplik fasona çıkar, levent geri gelir (⚠️ sevk kalemi borcu aşağıda) | 1b |
| Hazır satın alındı | `PURCHASED` | **`supplierId` XOR `subcontractorId` — tam biri** | **HİÇ YOK** — levent bir mal kabul kalemidir | 1b |
| **Müşterinin gönderdiği levent** (fason dokuma) | **`CONSIGNED`** | **`ownerCustomerId`** | HİÇ YOK — mal bizim değil | **Faz N**, `MaterialOwnership` ile |

**Akıbet ekseni (köken DEĞİL):** `SHIPPED_OUT` + ters yolu `SHIP_OUT_CANCEL` — levent başka dokumacıya ya da fasona verildi. **F1 İNDİ 2026-09-14 (hüküm 1e):** olay adı `SHIP_OUT` (durum `SHIPPED_OUT`), **terminal DEĞİL** — minimal dönüş `RETURNED_IN` (SHIPPED_OUT → READY, `lengthM` = dönen ≤ giden; haşıl verisi F2) + tersi `RETURNED_IN_CANCEL`; her fason satırı sevk kalemine bağlı (`dispatchItemId`). Gerekçe: terminal kalsaydı fasona giden levent F2'ye kadar askıda kalır, yarım defter canlıya çıkardı.

#### Taraf kolonunun TİPİ de kökene bağlı bir veri kararıdır

- **`PURCHASED ⇒ Customer` YANLIŞTI ve düzeltildi** (2026-09-12 düşmanca denetimi). Gerçek vaka: **fason devereci kendi ipliğiyle sarıp leventi faturalar** — köken `PURCHASED`, taraf bir **`Subcontractor`**. Tek tipe (`Customer`) zorlamak aynı firmaya **ikinci bir cari kart** açtırır ve mükerrer cari + birleştirme yükü üretir. Kodun kendi alış doktrini bunu zaten söylüyor (`supplier-party.helper`, C4): *"alış HER cariden yapılabilir"*, `Customer XOR Subcontractor`. Şekil o kalıptan alınır (`resolveSupplierParty`).
- **`CONSIGNED ⇒ ownerCustomerId`, `supplierId` DEĞİL.** Gerekçe tek cümle: **aynı kolon iki anlam taşıyamaz.** `supplierId` *"kimden ALDIK"* sorusunun cevabıdır; `CONSIGNED`de mal satın alınmıyor, **kimin malı olduğu** kaydediliyor. İkisi tek kolona bindirilse alış raporu ile mülkiyet sorusu aynı alandan okunur ve biri diğerini kirletir.
- **`CONSIGNED` bugün ENUM'A GİRMİYOR** (fazı var), ama **tabloya satır olarak ŞİMDİ yazılıyor.** Sebep: yazılmazsa biri o senaryoyu `PURCHASED`a saklar — ve o an **alış raporuna yalan girer** (satın alınmamış mal alış gibi görünür), `SHIPPED_OUT` iadesi de *"bizim leventi verdik"* diye okunur.
- **XOR'un yeri TEK KAPIDIR, CHECK ikinci hattır.** `resolveSupplierParty` kalıbı XOR'u helper'da tutar ve şemada bilinçli olarak CHECK yazmaz — gerekçesi *"23514 kullanıcıya çıplak kısıt adı basar"*. Burada CHECK **ikinci hat olarak yazılır** (elle SQL / içe aktarım yolları için), ama **birincil doğrulama ve Türkçe mesaj helper'dadır**; CHECK'e düşmek bir hata değil bir sed ihlalidir.

- **`WOUND` CHECK'i makineye DEĞİL, kökene bağlanır** (§4.6): `machineId NOT NULL` yerine köken-taraf XOR'u. Eski kısıt "her levent bir makinede doğar" diyordu ve fason ya da satın alınan leventi **DB düzeyinde kaydedilemez** kılıyordu.
- **`PURCHASED` levent iplik tüketmez.** Bu yüzden modül bağımlılığı `devere → iplik` **kaldırıldı** ve kapı yerini değiştirdi (§5): hazır levent alan dokumacı iplik ve ticaret modüllerini açmak zorunda değildir.
- **Fason için YENİ ALAN AÇILMAZ.** `Subcontractor` alanı canlı ve zengindir (`SubcontractorDispatch/Item`, `SubcontractorReceipt/Item`, `SubcontractorCategory`). ⚠️ Tek engel ölçüldü: **`SubcontractorDispatchItem.rollId` NOT NULL'dur** (`schema.prisma:3887`) — fasona giden tek şey yapısal olarak TOPtur; iplik, levent ya da tarak/tahar takımı gönderilemez. Polimorfik sevk kalemi (top | levent | iplik) **bu belgenin kapsamı dışında AYRI bir dilimdir** (yönetici 2026-09-12) ve zaten bağımsız olarak tespit edilmiş bir borçtur (`SEKTOR-YOL-HARITASI.md:153`: "fasona iplik gönderildiğinde hiçbir iz doğmuyor, elle `ADJUST_OUT`"). Fason devere o borcu ödetir, yeni alan açmaz.
- **Emanet iplik (müşteri/fason ipliğiyle devere) kapsam dışıdır** — `SEKTOR-YOL-HARITASI.md:152` `MaterialOwnership` boşluğuyla aynı sınıftır ve onunla birlikte çözülür (saha sorusu #26).

---

## 4 · Önerilen veri modeli

> Karşı ilişkiler (`User`/`Machine`/`Item`/`Roll`/`Customer` üzerindeki diziler) ve künye ilişki adları kısaltıldı; künye kalıbı `Station` modelidir. Miktarlar `Decimal`, pozitif; yön `kind`'den gelir (`YarnMovement` emsali). **Başlıktaki etiket: DURUM = "şu an ne", güncellenir · DEFTER = append-only, `updatedAt` YOK.**

### 4.1 Tür kümeleri

```prisma
/// LEVENT DURUMU — KAPALI küme (yaşam döngüsü), pg enum. Geçiş = atomik claim + aynı tx'te olay satırı.
/// Haşıl gelirse DURUM eklenmez: READY kalır, "haşıllandı" olaydan türetilir.
enum WarpBeamStatus {
  PLANNED     // çözgü emri — deftere hiç yazmadı (④ taslak: claim'li silinebilir)
  READY       // sarıldı ya da teslim alındı, tezgah bekliyor — tam ya da yarım (yarım = türetilir)
  MOUNTED     // tezgahta / raşelde (Faz 3)
  EXHAUSTED   // bitti — terminal; artık EXHAUSTED satırında fire (Faz 3)
  SCRAPPED    // gerçek fire — çözgü kullanılamaz; terminal (Faz 3)
  SHIPPED_OUT // başka dokumacıya/fasona VERİLDİ — F1 İNDİ 2026-09-14: terminal DEĞİL (RETURNED_IN → READY); ters yolu SHIP_OUT_CANCEL
  CANCELLED   // yanlış giriş — hiç sarılmamış sayılır; iplik ters kayıtla döner
}

/// LEVENT KÖKENİ — KAPALI küme (§3.9), pg enum. Devere İÇERİDE yapılmak zorunda değildir:
/// CHECK makineye değil KÖKENE bağlanır, yoksa fason/satın alınan levent kaydedilemez.
enum WarpBeamOrigin {
  IN_HOUSE     // kendi devere makinemizde sarıldı — WOUND.machineId dolu, taraf kolonları NULL
  SUBCONTRACT  // fason sardı — subcontractorId
  PURCHASED    // hazır levent satın alındı — supplierId XOR subcontractorId; İPLİK TÜKETİMİ YOK
  // CONSIGNED — müşterinin gönderdiği levent (fason dokuma): ownerCustomerId. FAZ N,
  //   `MaterialOwnership` ile birlikte doğar; BUGÜN EKLENMEZ ama §3.9 tablosunda yazılıdır
  //   ki kimse o senaryoyu PURCHASED'a saklamasın (alış raporuna yalan girer).
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
//   F1 İNDİ (2026-09-14): SHIP_OUT · SHIP_OUT_CANCEL · RETURNED_IN · RETURNED_IN_CANCEL (levent fasona gider/döner — §3.9; kaleme bağlı)
//   Faz 5: SIZED · SIZE_CANCEL (haşıl)
```

Mevcut pg enum'lara ekler (SONA; her biri **tek ifadeli, ayrı migration** `ADD VALUE IF NOT EXISTS`, PG 55P04; `docs/RECETELER.md` enum reçetesi 13 adım):
- `YarnMovementKind += WARP_ISSUE, WARP_ISSUE_REVERSAL, WARP_RETURN, WARP_RETURN_REVERSAL` [Faz 1]. Dört değer, iki ileri-geri çifti: çıkış BRÜT, dönen dip ayrı satır (§3.7). Mevcut enum'dur, VarChar'a çevirmek bu işin kapsamı dışında.
- `ReasonPresetKind += WARP_RETURN` [Faz 1]: `DEPOYA_IADE` · `ATKILIK_AKTARIM` · `TELEF` — bobin dibinin üç kaderi (§3.7); `WARP_RETURN` satırında sunucuda ZORUNLU.
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
  yarnItemId   String   @db.Uuid                 // ItemType.YARN + iplik numarası dolu (servis 400)
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

  /// KÖKEN — §3.9. ⚠️ AKSİYON ANINDA SEÇİLİR, kurulumda değil: aynı fabrika hem içeride
  /// sarıp hem hazır levent alabilir. Sarım/plan formunda SEÇİM olarak görünür (varsayılanı
  /// olabilir, KİLİTLİ OLAMAZ).
  /// ⚠️ Taraf kolonunun TİPİ kökene bağlıdır ve tek kapı `resolveSupplierParty` kalıbıdır:
  ///   IN_HOUSE    → üçü de NULL (WOUND.machineId dolu)
  ///   SUBCONTRACT → subcontractorId
  ///   PURCHASED   → supplierId XOR subcontractorId, TAM BİRİ  ← fason devereci kendi
  ///                 ipliğiyle sarıp faturalayabilir; Customer'a zorlamak ikinci cari açtırır
  originKind       WarpBeamOrigin @default(IN_HOUSE)
  subcontractorId  String?        @db.Uuid                 // SUBCONTRACT · ya da PURCHASED'ın fason tarafı
  supplierId       String?        @db.Uuid                 // PURCHASED'ın cari tarafı (Customer, CompanyType.SUPPLIER)
  // ownerCustomerId — CONSIGNED'ın taraf kolonu. FAZ N: `supplierId`e BİNDİRİLMEZ,
  //   çünkü "kimden aldık" ile "kimin malı" aynı kolonda yaşayamaz (§3.9).

  warpSpec       WarpSpec        @relation(fields: [warpSpecId], references: [id], onDelete: Restrict)
  currentMachine Machine?        @relation("WarpBeamCurrentMachine", fields: [currentMachineId], references: [id], onDelete: Restrict)
  subcontractor  Subcontractor?  @relation("WarpBeamSubcontractor", fields: [subcontractorId], references: [id], onDelete: Restrict)
  supplier       Customer?       @relation("WarpBeamSupplier", fields: [supplierId], references: [id], onDelete: Restrict)
  events         WarpBeamEvent[]
  yarnMovements  YarnMovement[]

  createdAt   DateTime @default(now()) @db.Timestamptz
  updatedAt   DateTime @updatedAt @db.Timestamptz
  createdById String?  @db.Uuid
  updatedById String?  @db.Uuid

  @@index([status, warpSpecId])       // "bu çözgüden hazır leventler"
  @@index([warpSpecId])
  @@index([currentMachineId])
  @@index([subcontractorId])
  @@index([supplierId])
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
  /// YUVA ROLÜ — yuvalar birbirinin AYNI DEĞİLDİR (zemin · hav/pile · dolgu leventi).
  /// Salt yuva sayısı "hangi barıya hangi levent" sorusunu cevaplayamaz. Küçük katalog
  /// (`ReasonPreset` kalıbı), makine sınıfından bağımsız; boş bırakılabilir.
  beamRole        String?         @db.VarChar(32)
  mountMethod     WarpBeamMountMethod?
  setupStartedAt  DateTime?       @db.Timestamptz
  machineCounter     Decimal?        @db.Decimal(12, 3) // bağlama/sökümde tezgah sayacı (metraj ölçeği)

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

⚠️ **TEZGAH TARAFI LEVENT FK'SI AÇMAZ** (2026-09-12 kararı, §9.6). Dokuma koşumu/olayı hangi leventle çalıştığını KENDİ kolonunda taşımaz; kesişim tek helper'dan okunur: `beamsMountedDuring(machineId, from, to)` (↔ `BEAMS_MOUNTED_DURING_SQL`, boğaz-ikiz). Sebep: levent ↔ makine ilişkisi ZAMAN ARALIĞIDIR ve tek kaynağı bu defterdir; koşuma FK koymak aynı gerçeği ikinci kez, üstelik kopabilecek biçimde yazardı (çift levent ve koşum ortasında levent değişimi ikisini ayrıştırırdı).

İşaret tablosu: tek kaynak `warpBeamLengthSign`. `yarnMovementSign` emsali; exhaustive `switch`, yeni değer derlemede kırılır (`yarn.service.ts:104-113` TS2366 ile ölçüldü).

| + | − | 0 |
|---|---|---|
| `WOUND` · `CONSUMED_CANCEL` · `ADJUST_IN` · `EXHAUST_CANCEL` · `SCRAP_CANCEL` · `SHIP_OUT_CANCEL` | `WOUND_CANCEL` · `CONSUMED` · `ADJUST_OUT` · `EXHAUSTED` · `SCRAPPED` · `SHIPPED_OUT` | `MOUNTED` · `MOUNT_CANCEL` · `DISMOUNTED` · `DISMOUNT_CANCEL` |

### 4.5 Mevcut modellere eklemeler

```prisma
model Item {
  // … mevcut alanlar DEĞİŞMEZ; ad ASLA ayrıştırılmaz
  /// İPLİK NUMARASI — devere formülünün girdisi. Elle girilir; adındaki "70 DN" okunmaz.
  /// ⚠️ `linearDensityDen` DÜŞER (§3.8b, karar A′): denye TÜRETİLİR (`resolveDenier`),
  /// saklanan şey OPERATÖRÜN GİRDİĞİDİR. Ölçüldü: kolon 35 DB'nin hepsinde boş ve
  /// sahadaki panel (1.3.1) onu hiç tanımıyor ⇒ backfill ve geçiş dönemi yok.  [Faz 1]
  yarnCountSystem  YarnCountSystem @default(DEN)
  yarnCountValue   Decimal?        @db.Decimal(10, 4)
  /// KUMAŞ → çözgü kartı (N:1). Yalnız FABRIC (servis 400). Devere kapalıyken yazılmaz/çizilmez.  [Faz 1]
  warpSpecId       String?   @db.Uuid
  warpSpec         WarpSpec? @relation("ItemWarpSpec", fields: [warpSpecId], references: [id], onDelete: Restrict)
  @@index([warpSpecId])
}

model YarnMovement {
  // … mevcut alanlar DEĞİŞMEZ
  /// Tipli belge bağı: devereye çıkış, dip iadesi ve tersleri.
  /// kind ∈ {WARP_ISSUE, WARP_ISSUE_REVERSAL, WARP_RETURN, WARP_RETURN_REVERSAL} ⇔ dolu (CHECK).
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
  /// Aynı anda bağlanabilecek levent sayısı (çift levent tezgah = 2, raşel = kılavuz barı kadar).    [Faz 1b]
  /// ⚠️ FAZ 3'TEN ÖNE ÇEKİLDİ (2026-09-12, §9.7): "tül dokumada mı raşelde mi" sorusu cevap
  /// BEKLENEN bir soru olmaktan çıkıp veri ekseni olunca, sayının Faz 1b'de var olması gerekir.
  /// Bu bir SAYI alanıdır, bayrak değil: 1 yazan tek leventle çalışır, 6 yazan raşeldir.
  ///
  /// ⚠️ VARSAYILAN 1, CHECK `>= 0` (canlı şema 2026-09-14, §9.7h). Senaryoyu kapatan
  /// CHECK'ti, o `>= 0`: cağlıktan beslenen çözgü makinesi (elastan raşel, iğneli dar
  /// dokuma) çözgü tüketir ama LEVENT BAĞLANMAZ, yuvası 0'dır ve AÇIKÇA yazılır. Tezgahın
  /// tek yuvası olağan durumdur; kurşun/tambur makinesinde sayı okunmaz, çünkü yuva kapısı
  /// bu sayı değil `Station.consumesWarpBeam`tir — sayı yalnız ÜST SINIRDIR.
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
| `warp_beam_events_wound_facts_ck` | CHECK | `kind='WOUND'` ⇒ `lengthM, endsCount, denier, theoreticalKg, kgSource` NOT NULL (`kgSource` enum olduğu için değer listesi CHECK'te tekrarlanmaz). ⚠️ **`machineId` BU LİSTEDE DEĞİLDİR** — makine zorunluluğu kökene bağlıdır, aşağıdaki XOR seddi taşır (§3.9). Eski "`machineId` NOT NULL" hâli fason ve satın alınan leventi DB düzeyinde imkânsız kılıyordu | 1 |
| `warp_beams_origin_party_ck` | CHECK — **İKİNCİ HAT** | **KÖKEN XOR'u:** `IN_HOUSE` ⇒ taraf kolonlarının hepsi NULL · `SUBCONTRACT` ⇒ yalnız `subcontractorId` · `PURCHASED` ⇒ `supplierId` ile `subcontractorId`den **TAM BİRİ** (§3.9). ⚠️ Birincil doğrulama ve Türkçe mesaj `resolveSupplierParty` kalıbındaki TEK KAPIDADIR; o kalıp şemada bilinçli CHECK yazmaz (*"23514 çıplak kısıt adı basar"*). Buradaki CHECK yalnız elle SQL / içe aktarım yolları için seddir, kullanıcı yüzeyi değildir | 1 |
| `warp_beam_events_wound_inhouse_ck` | CHECK | `kind='WOUND'` ∧ leventin kökeni `IN_HOUSE` ⇒ `machineId IS NOT NULL`. ⚠️ Köken `warp_beams`tedir, CHECK tek satırdan okuyamaz: **bu kural servis + bekçi + mutabakat §4.9(9) üçlüsüyle taşınır**, tabloda CHECK olarak YAZILMAZ (satır-dışı yüklem taşıyan CHECK yasağı) | 1 |
| `warp_beam_events_one_wound_uq` | partial UNIQUE | `("beamId") WHERE kind='WOUND'`: bir levent bir kez doğar. ⚠️ Bu kısıt "aktif" yüklemi TAŞIMAZ ve taşımamalıdır — iptal edilen levent yeniden sarılmaz, **yeni levent açılır**. `WOUND_CANCEL`in durumu PLANNED'a değil CANCELLED'a taşımasının sebebi budur (§4.7) | 1 |
| `yarn_movements_warp_link_ck` | CHECK | `kind IN ('WARP_ISSUE','WARP_ISSUE_REVERSAL','WARP_RETURN','WARP_RETURN_REVERSAL')` ⇔ `"warpBeamId" IS NOT NULL` (bugün `kind`'a bağlı CHECK yok; yalnız `qtyKg > 0` var) | 1 |
| `yarn_movements_warp_return_reason_ck` | CHECK | `kind IN ('WARP_RETURN','WARP_RETURN_REVERSAL')` ⇒ `"reasonCode" IS NOT NULL`: dip nereye gitti sorusu **her satırda** cevaplanır (§3.7). Kod değerinin `ReasonPreset`te var ve aktif olduğu SUNUCUDA doğrulanır, CHECK yalnız boşluğu kapatır | 1 |
| `machines_warp_beam_slots_nonneg` | CHECK | `"warpBeamSlots" >= 0` — yuva sayısının TEK kaynağı bu kolondur (ayrı bir `MachineSpec.beamSlots` reddedildi, §9.6). ⚠️ **`>= 1` DEĞİL:** cağlıktan beslenen çözgü makinesinde (elastan raşel, iğneli dar dokuma) yuva 0'dır ve `>= 1` o fabrikayı kayıttan dışlardı; varsayılan `1` (tek yuva olağan; 0 yalnız çözgü makinesinde açıkça yazılır, §9.7h). Kolonla birlikte **Faz 3'ten 1b'ye çekildi** | 1 |
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
| PLANNED → READY (`IN_HOUSE`) | `WOUND` | `updateMany({id, status:PLANNED})` | Aynı tx'te iplik satırları `applyYarnMovementTx(kind:WARP_ISSUE, warpBeamId)` — **BRÜT, cağlığa yüklenen**. Dönen dip varsa aynı tx'te `WARP_RETURN` + `reasonCode` (§3.7). Tek yazar olduğu için iplik modül kapısı da içeride koşar. Çok satırlı çıkış **kanonik `(itemId, warehouseId)` sırasıyla** yazılır: eksi bakiye kapısının `FOR UPDATE` serileştiricisi çağıranın sırasına güvenir (`yarn-balance-guard.helper.ts:99-103`) | makine `producesWarpBeam` değil → 400; iplik denye'siz → 400; `WARP_RETURN` sebepsiz → 400 |
| PLANNED → READY (`SUBCONTRACT` / `PURCHASED`) | `WOUND` | aynı claim | **İplik kapısı KOŞMAZ, `WARP_ISSUE` YAZILMAZ** (§3.9): satın alınan levent iplik tüketmez, fason sarımda iplik fason sevkiyle çıkar. `machineId` boş, karşı taraf (`subcontractorId`/`supplierId`) dolu; `theoreticalKg` beyandır | taraf alanı boş → 400 (`warp_beams_origin_party_ck` seddi); `IN_HOUSE`'ta makine boş → 400 |
| READY → CANCELLED | `WOUND_CANCEL` | `updateMany({id, status:READY})` | **Net iplik** (kalem × depo × lot) `WARP_ISSUE_REVERSAL` ile döner — net, çünkü `WARP_RETURN` satırları da terslenir (`WARP_RETURN_REVERSAL`); `reverseGoodsReceiptYarnTx` net + idempotent emsali. `IN_HOUSE` olmayan leventte iplik satırı yoktur, ters kayıt da doğmaz | aktif (terslenmemiş) `MOUNTED`/`CONSUMED` varsa 409 |
| READY → MOUNTED | `MOUNTED` | `updateMany({id, status:READY})` + yuva seddi; P2002 → 409 | Yarım levent başka makineye bağlanıyorsa UYARI ("uyum: model/en/takım") | makine `consumesWarpBeam` değil → 400; yuva > `warpBeamSlots` → 400 |
| MOUNTED → READY | `DISMOUNTED` | `updateMany({id, status:MOUNTED, currentMachineId})` | Kalan ölçüm girildiyse fark önce `CONSUMED`/`ADJUST_IN` | O makinede AÇIK dokuma koşumu varsa **409** (koşum sürerken levent sökülmez); koşum leventsiz açılmışsa bu **UYARI**dır, 400 değil — saha kaydı eksik olabilir, iş durdurulmaz |
| MOUNTED/READY → EXHAUSTED | `EXHAUSTED` | claim | Ölçülen artık ≠ türetilen kalan ise fark önce `CONSUMED`/`ADJUST_IN`, sonra `EXHAUSTED(lengthM = artık)` → kalan 0 | — |
| READY/MOUNTED → SCRAPPED | `SCRAPPED` | claim | `lengthM` = kalan; `reasonCode` zorunlu (sunucuda) | — |
| READY → SHIPPED_OUT | `SHIP_OUT` (**F1 İNDİ 2026-09-14** — ad `SHIP_OUT`, terminal DEĞİL: `RETURNED_IN` READY'ye döndürür; fiziksel çıkış belgesi `SubcontractorDispatch` kalemi `kind=WARP_BEAM`, bekçi `test_subcontractor_dispatch_beam`) | `updateMany({id, status:READY})` | Levent başka dokumacıya/fasona VERİLDİ (§3.9): `lengthM` = çıkan kalan, karşı taraf zorunlu. Terminal; ters yolu `SHIP_OUT_CANCEL`. ⚠️ Malın fiziksel çıkış belgesi bu satır DEĞİLDİR — o, polimorfik fason sevk kalemi dilimine bağlıdır ve o dilime kadar levent çıkışı yalnız levent defterinde görünür | MOUNTED'ken 409 (önce sök) |
| (durum değişmez) | `ADJUST_IN` / `ADJUST_OUT` | `updateMany({id, status})` — durum aynı kalır, claim yalnız yarışı keser | Ölçüm düzeltmesi: `lengthM` > 0, `reasonCode` ZORUNLU (`ReasonPresetKind.WARP_BEAM_ADJUST`). Yanlış yazılan düzeltme KARŞI ADJUST ile kapanır ve `reversesEventId` ile orijinaline bağlanır | kalan metreyi eksiye düşürüyorsa 409; terminal durumda 409 |
| `*_CANCEL` | ters | claim: durum, terslenen olayın `fromStatus`una döner | — | **İSTİSNA — `WOUND_CANCEL`:** doğuşun stornosudur, `fromStatus` (PLANNED) kuralına GİRMEZ; durumu **CANCELLED**'a (terminal) taşır. Aksi hâlde levent PLANNED'a dönerdi ama `warp_beam_events_one_wound_uq` yüzünden bir daha sarılamazdı (tekrarlanamaz iş, `defter.md:22` tuzağı) ve §4.9 #5 mutabakatı yalan alarm verirdi |

- **LIFO'nun kapsamı.** "En yeni aktif ileri olay" kuralı yalnız **DURUM DEĞİŞTİREN** olaylar için geçerlidir (`WOUND` · `MOUNTED` · `DISMOUNTED` · `EXHAUSTED` · `SCRAPPED`). Yalnız miktar yazan olaylar (`CONSUMED`, `ADJUST_*`) zinciri kilitlemez: her biri kendi ters satırıyla (`CONSUMED_CANCEL`, karşı `ADJUST`) hedefini `reversesEventId` ile göstererek kapanır. Aksi hâlde bir ölçüm düzeltmesi, kendinden önceki her stornoyu kalıcı 409'a düşürürdü. Yüklem TEK helper'dadır: `activeForwardStatusEvent` (↔ `ACTIVE_FORWARD_EVENT_WHERE`, boğaz-ikiz).
- **Kilit.** Yeni advisory uzayı GEREKMEZ: yuva ve gövde tekilliğini partial UNIQUE seddi, durumu claim korur. `beamNo` sayacı **kilitsiz sayaç emsallerini** izler (`shipmentNo`/`nextSackNo`, `shipping.service.ts:444-446`) — `workOrderNumber` emsal DEĞİLDİR (kendi döngüsü var, sayacı tx dışında okur). Advisory KULLANAN sayaçlar (8022 parti no, 8031 paketleme grubu) çakışması iş akışını durduran numaralar oldukları için farklıdır; levent numarası çakışması yalnız retry ister. ⚠️ `withBarcodeRetry(fn, 5, (e) => !isClientTokenP2002(e))`: predicate verilmezse TÜM P2002 retry edilir ve `clientToken` çakışması beş tur aynı token'ı yazıp replay'i atlar, kullanıcıya "Barkod üretimi 5 denemede başarısız" 409'u döner (`utils/p2002.ts:30-35`).
- **Eksi bakiye kapısı.** Bugün yalnız `OUT`'u kapılar (`yarn-balance-guard.helper.ts:113`). Kapılanan küme **`WARP_ISSUE` ve `WARP_RETURN_REVERSAL`**'i içerecek şekilde genişler (ikisi de bakiyeyi DÜŞÜRÜR); `WARP_ISSUE_REVERSAL` ve `WARP_RETURN` muaftır (ikisi de artırır). ⚠️ Ölçüt "storno mu" değil **"bakiyeyi düşürüyor mu"**dur: `WARP_RETURN_REVERSAL` bir stornodur ama düşürür, ve iade edilen iplik arada tüketilmişse bakiyeyi eksiye çekebilir. Muafiyet listesi elle değil **`yarnMovementSign` işaret fonksiyonundan** türetilir — elle yazılmış liste tam olarak §4.9'un ölçtüğü hata sınıfıdır. Bayrak metinleri "OUT" diyor, "iplik çıkışı" olarak güncellenir. ⚠️ Kapının `FOR UPDATE` kilidi yalnız VAR OLAN `yarn_stocks` satırında oluşur (satır yoksa bakiye 0 kabul edilir, kilit alınmaz): ilk kez hareket gören (kalem × depo) çiftinde kanonik sıra yarışı serileştirmez. **KARAR (Faz 1b, yönetici 2026-09-12 — "serileşmiyorsa kapı değildir"):** kapı, kendi içinde ve bakiyeyi okumadan ÖNCE `yarn_stocks` satırını `INSERT … ON CONFLICT DO NOTHING` ile doğurur; böylece `FOR UPDATE` daima gerçek bir satırı kilitler. Advisory uzayı AÇILMAZ: kilitlenecek doğal satır ve `(itemId, warehouseId)` UNIQUE'i zaten var, advisory yalnız yeni bir kilit sırası sorusu getirirdi. Sıfır bakiyeli satır zararsızdır — hareket zaten aynı tx'te `ON CONFLICT` ile o satırı yazacaktı. Çok satırlı `WOUND` çıkışı ayrıca kanonik `(itemId, warehouseId)` sırasıyla yazılır (kilit sırası determinizmi).
- **İdempotency.** `WarpBeam.clientToken` (plan ya da doğrudan sarım) ve `WarpBeamEvent.clientToken` (tabletten tüketim girişi saf INSERT'tir) dört durumlu replay kullanır (`helpers/token-replay.helper.ts`). `clientToken`'lı model sayısı 15'ten 17'ye çıkar.
- **Modül kapısı TEK YAZARIN İÇİNDE.** `applyWarpBeamEventTx`in ilk ifadesi devere zincirini ölçer (`applyYarnMovementTx` iplik kapısı emsali, `yarn.service.ts:171-177`). Route'ta ayrıca adlandırılmış `requireDevereEnabled` durur.
- **Elle iplik hareketi yolu kapalı kalır.** `POST /api/yarn/movements` Zod'u dört `WARP_*` türünü de kabul ETMEZ (`yarn.routes.ts:205` literal enum). Aksi halde `warpBeamId`'siz devere çıkışı ya da sebepsiz dip iadesi doğar ve levent iptalinin net ters kaydı onları bulamaz. GET filtre Zod'u (`:160`) genişler.
- **Yıkıcı işlem önizlemesi.** `WOUND_CANCEL` ve `SCRAPPED` için preview ucu: dönecek iplik satırları (kalem · depo · lot · kg) ve etkilenen levent listelenir.

### 4.8 Türetilmiş değerler — tek helper + SQL ikizi

| Değer | Formül | Helper |
|---|---|---|
| Kalan metre | `Σ warpBeamLengthSign(kind) × lengthM` — **`remainingLengthM` KOLONU YOKTUR** (§9.6) | `warpBeamRemainingM` ↔ `WARP_BEAM_REMAINING_SQL` |
| "Bu tezgahta şu aralıkta hangi leventler bağlıydı" | `MOUNTED`/`DISMOUNTED` çiftlerinin zaman aralığı (aktif satırlar) | `beamsMountedDuring(machineId, from, to)` ↔ `BEAMS_MOUNTED_DURING_SQL` |
| Yarım levent | `status='READY'` ∧ aktif `CONSUMED` var | aynı helper |
| Teorik (nominal) kg | `endsCount × denier × lengthM / 9_000_000` (Decimal, 3 hane) | `warpTheoreticalKg`; panel/tablet ön hesabı AYNI fonksiyonun aynası |
| Devere firesi kg | `Σ net WARP_ISSUE(beam) − Σ net WARP_RETURN(beam) − WOUND.theoreticalKg`; yalnız `kgSource='WEIGHED'` **ve** kökeni `IN_HOUSE` olan leventte anlamlı. ⚠️ Brüt çıkış ile iade AYRI toplandığı için "cağlığa ne yüklendi" ve "ne döndü" ayrı ayrı da raporlanır — net tek satır bunu veremiyordu (§3.7) | `warpingWasteKg` |
| Dip kaderi dağılımı | `Σ WARP_RETURN.qtyKg` × `reasonCode` (`DEPOYA_IADE` · `ATKILIK_AKTARIM` · `TELEF`) | rapor — fabrikanın hangi senaryoyu ne sıklıkta uyguladığı ÖLÇÜLÜR, varsayılmaz |
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
4. `CANCELLED` levent ⇒ `Σ net WARP_ISSUE` = 0 **ve** `Σ net WARP_RETURN` = 0 (kalem × depo × lot). İki toplam ayrı ayrı sıfırlanır; birbirini götürmeleri kabul edilmez, yoksa eksik ters kayıt görünmez olur.
5. `PLANNED` levent ⇒ hiç olay ve iplik satırı yok.
6. `status='MOUNTED'` ⇒ son aktif DURUM olayı `MOUNTED`'dır **ve** o satırın `machineId`/`mountPosition` değerleri `currentMachineId`/`currentPosition` ile birebir aynıdır (durum kolonu ile defter ayrışamaz).
7. `status ≠ 'MOUNTED'` ⇒ son aktif durum olayı `MOUNTED` DEĞİLDİR (ve `currentMachineId`/`currentPosition` NULL — `warp_beams_mounted_ck`'nin defter tarafındaki ikizi).
8. Her aktif `MOUNTED` satırı ya bir `DISMOUNTED`/`EXHAUSTED`/`SCRAPPED`/`SHIPPED_OUT` ile kapanmıştır ya da levent hâlâ `status='MOUNTED'`tır — açık kalmış, kapanmamış bağlama satırı yoktur.
9. **KÖKEN ↔ DEFTER TUTARLILIĞI** (§3.9; CHECK taşıyamaz, satır-dışı yüklem): `originKind='IN_HOUSE'` ⇒ aktif `WOUND` satırının `machineId`'si DOLU **ve** o leventte en az bir `WARP_ISSUE` var. `originKind IN ('SUBCONTRACT','PURCHASED')` ⇒ `WOUND.machineId` NULL **ve** o leventte HİÇ `WARP_ISSUE`/`WARP_RETURN` satırı yok. Negatif sondası: köken alanı elle `PURCHASED`'a çevrilmiş, iplik satırı duran levent fixture'ı.
   > ⚠️ **ŞERH — bu maddenin `IN_HOUSE` yönü Faz 5'te GENİŞLEYECEK, bekçiye SERT girmemeli.** Haşıl / direkt çözgüde **N ara levent → 1 dokuma levendi** birleşir (§2 tablosu, Faz 5): o levent `IN_HOUSE` doğar ama **iplik ONA değil ara leventlere düştüğü için hiç `WARP_ISSUE`'su olmaz** ve bugünkü yüklem yalancı alarm verir. Faz 5'te soy bağı gelince yön *"`WARP_ISSUE` VEYA ana levent bağı vardır"* olur. Bugün sert yazılırsa Faz 5 bu bekçiyi kırmak zorunda kalır ve kıran kişi muhtemelen maddeyi tümden söker.
10. Her aktif `WARP_RETURN` satırının `reasonCode`'u `ReasonPreset`te VAR (kod silinmiş ya da hiç yazılmamış satır yakalanır — `ReasonPreset.code` asla değişmez kuralının defter tarafındaki ikizi).

---

## 5 · Modül bayrağı

- **Anahtar.** DB `devere.enabled` · API `devereEnabled` · etiket "Devere / levent". **Varsayılan KAPALI**; okuyucu `asBoolean` varsayılanı `false`. Üretim modülündeki "satır yok → true" sigortası BURAYA KOPYALANMAZ.
- **Bağımlılık: `MODULE_DEPENDENCIES.devereEnabled = "iplikEnabled"` KALDIRILIR — ve yerine HİÇBİR ŞEY YAZILMAZ** (2026-09-12 kararı + aynı gün düşmanca denetimi, §9.7d).
  - **Neden kalkıyor:** bugünkü hâli `src/constants/module-flags.ts:74`te CANLIDIR ve *"devere her zaman kendi iplik stoğunu tüketir"* varsayımını taşır. Bu varsayım §3.9 ile düştü: **`PURCHASED` levent iplik tüketmez.** Hazır levent alan bir dokumacı devereyi ancak iplik ve ticaret modüllerini de açarak kullanabiliyordu — yani tasarım, desteklemek istediğimiz kurulumu modül tablosunda yasaklıyordu.
  - **Neden kapı TAŞINMIYOR** (önceki "kapıyı `applyWarpBeamEventTx`e taşı" talimatı GERİ ALINDI): ölçüldü — `tx.yarnMovement.create` src'de **tek yerdedir** ve iplik kapısı zaten **o tek yazarın ilk iş ifadesidir** (`yarn.service.ts:171-177`). Bağımlılığı kaldırmak delik AÇMIYOR: iplik kapalıyken `WARP_ISSUE` yazmayı deneyen `IN_HOUSE` sarımı o kapıdan zaten 403 alır. Kapıyı bir de devere servisine yazmak **ikinci kopya** olurdu ve `yarn.service` bunu adıyla yasaklıyor: *"ikinci kopya bir gün ayrışır."*
  - Route'taki adlandırılmış `requireDevereEnabled` KALIR ama artık **tek seviyelidir** (yalnız `devere.enabled`); üç seviyeli zincir mesajı kalkar.
  - ⚠️ **ASIL DELİK ŞEMADA DEĞİL, BU BÖLÜMÜN GÖRÜNÜRLÜK CÜMLESİNDEYDİ** — aşağıda "Yüzeyler kapalıyken" maddesinde düzeltildi: *"denye yalnız `iplikEnabled` iken görünür"* uygulanırsa, 2. kararın var olma sebebi olan kurulum (iplik KAPALI + devere AÇIK, yalnız hazır levent) çözgü kartı açamaz ve **hiçbir levent doğamaz**. Karar bir cümleyle kendini iptal ediyordu.
  - ⚠️ **Panel önizleme borcu:** bağımlılık kalkınca devere açıkken iplik KAPATILABİLİR hâle gelir. Modül kapatma önizlemesi bunu uyarmalı: *"N içeride sarılmış levendin iplik stornosu kilitlenir"* — `WOUND_CANCEL` net ters kaydını yazamayacağı için.
  - ⚠️ **Bekçi borcu:** `test_devere_regime_gate` "üç seviyeli zincir mesajı" yerine **iki dalı** ölçer — `IN_HOUSE` + iplik kapalı → 403 (kapı iplik servisinden gelir); `PURCHASED` + iplik kapalı → 200. İkinci dal negatif sonda olmadan yazılamaz (geçmesi gereken senaryo bugün 403 alır).
  - `effectiveModuleValue` switch'ine `devereEnabled` case'i ZORUNLU. Eksik kalırsa iplik'e dokunan HER PATCH 400 "Bilinmeyen modül anahtarı" alır (`system-setting.service.ts:1894-1911`). Bunu statik bir bekçi yakalamaz.
- **Dokuma ile ilişki.** Devere dokumadan bağımsızdır: fason devere atölyesi olabilir, **raşel (çözgülü örme) tül** de levent tüketir. Faz 3 bağlama/söküm/elle tüketim **devere** modülündedir (tezgah ya da raşel = `Machine`). Faz 4'te top çıkışından otomatik tüketim **dokuma** bayrağının kapsamındadır. Repoda `dokuma.enabled` YOK; dokuma tarafının tek yer tutucusu `tezgah.enabled`, o da "Dokuma tezgah izleme" (monitörizasyon), üretime bağlı ve yüzeysiz. Ad uzlaşması §9'da.
- **Profiller** `taban()`/`acik()` ile üretilir: `taban()` YEDİ anahtarın hepsini açıkça `false` yazar, yani kural dosyasındaki "her profilde açıkça yazılır" TAMLIK kuralı bugün de geçerlidir — yalnız uygulanışı yardımcı fonksiyona taşınmıştır (`module-profiles.ts:95-99`). Devere eklenince `taban()` sekizinciyi kendiliğinden yazar; elle değişecek tek yer `test_module_profile §1b`'deki `7` sayısıdır. `tam` spread ile devere'yi **kendiliğinden açık** alır. `dokuma` profiline elle eklenir. **Mevcut `perde` profili DEĞİŞMEZ** (kumaşı hazır alan kurulum); hedef kitle için AYRI bir **`perde-dokuma`** profili doğar (ticaret + iplik + devere açık; tezgah Faz 4'te) — yönetici kararı §9.4. `basit` (adnansahin) ve `standart` kapalı kalır. ⚠️ Bağımlılık kalkınca **ikinci bir şekil daha mümkün olur**: devere açık + iplik KAPALI = "hazır levent alan dokumacı" (§3.9). Bu bir ŞEMA sorusu değil profil sorusudur; yeni profil yazılıp yazılmayacağına ilk böyle bir müşteride karar verilir — şimdiden profil üretmek, karşılığı olmayan bir kimlik yaratmaktır.
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
- **Yüzeyler kapalıyken.** Menü/karo çizilmez, route 403. Çözgü kartı alanı ve `Station` formundaki iki yetenek kutusu yalnız `devereEnabled` iken görünür.
  - ⚠️ **İplik numarası alanlarının (`yarnCountSystem`/`yarnCountValue`) görünürlüğü `iplikEnabled || devereEnabled`dır** — yalnız `iplikEnabled` DEĞİL (2026-09-12 düşmanca denetimi, §9.7d). Eski cümle 2. kararı sessizce iptal ediyordu: bağımlılık kalkınca "iplik KAPALI + devere AÇIK" kurulumu meşrudur, ama numara alanı görünmezse `WarpSpec` açılamaz (servis numarayı DOLU ister) ve **hiçbir levent doğamaz** — karar bir cümleyle kendini iptal ediyordu. Alternatif ve daha yalın okuma: görünürlüğü bayrağa hiç bağlamamak, **kalem tipine** bağlamak (`ItemType.YARN` ise göster) — iplik numarası ipliğin fiziksel özelliğidir, bir modülün mülkü değil.
  - ⚠️ **AYNI TUZAK içe aktarma adaptörü cümlesindedir:** `item.adapter.ts`teki numara sütunları "modül kapalıyken şablondan düşürülür" kararı `iplikEnabled`e bağlanırsa aynı kurulumda numara toplu girilemez. Sütun ölçütü de `iplikEnabled || devereEnabled` (ya da bayraksız) olur.

## 6 · adnansahin sıfır-fark kanıtı (Faz 1)

| Dokunuş | adnansahin'de etkisi |
|---|---|
| 3 yeni tablo | Boş kalır; hiçbir mevcut sorgu okumaz |
| `Item.yarnCountSystem`/`yarnCountValue`, `Item.warpSpecId`, `YarnMovement.warpBeamId` | Nullable ya da varsayılanlı, boş kalır. Ad kolonu okunmaz, yazılmaz, taşınmaz |
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
| **1a′ — numara sistemi düzeltmesi** (1a ŞEMADA, bu onun devamı) | `YarnCountSystem` enum + `Item.yarnCountSystem`/`yarnCountValue` · `Item.linearDensityDen` DÜŞER · `resolveDenier` tek helper + panel/tablet aynası · 7 panel + 4 backend dosyası + `item.adapter.ts` **AYNI TURDA** · `warp-spec.service.ts:10`/`:53` bayat metinleri tazelenir | Pamuklu dokumacı (Ne) kayıttan düşmez; hata çarpanı `5315/N²` ve Ne≈73'te sıfırlandığı için aralık denetimiyle yakalanamıyordu (§3.8b) | 1 enum tipi · 2 kolon · 1 kolon kaldırma. **Backfill YOK** (35 DB'de ölçülmüş sıfır veri), eski istemci YOK (alan 1.3.1'in atası değil) | 1a · ⚠️ backend+panel **aynı pencerede** (paketleme adımı, sürüm notu maddesi DEĞİL) |
| **1a — Katalog ve kimlik** (defter YAZMAZ) | `devere.enabled` + grandfathering migration + `requireDevereEnabled` + bayrak dokunuşları (§5) · **izin kodları + ekran `requires`** · `Item.linearDensityDen` · `WarpSpec` CRUD + `Item.warpSpecId` (⚠️ **BEKLEYEN, ÖLÜ DEĞİL:** kolon 1a'da FK + kısmi index'iyle hazır bırakıldı, ama yazma yüzeyi **1b'de doğar** — o güne kadar tüketicisi yoktur; ölçüldü 2026-09-12: backend 0 · panel 0 · içe aktarım 0 referans) · `Station.producesWarpBeam` · **birleştirme haritası + içe aktarma adaptörleri + kalıcı silme kapıları** · panel "Çözgü Kartları" ekranı (teorik kg hesaplayıcısı dahil) | Çözgü kartları ve denye verisi girilmeye başlanır — 1b'nin veri ön koşulu. **Hiçbir defter satırı doğmaz**, dolayısıyla ters yol borcu da doğmaz | 1 tablo · 3 kolon · 2 şema-dışı nesne · 3 izin kodu | — |
| **1b — Levent doğar** (EN KÜÇÜK ANLAMLI ÇALIŞAN ADIM) | `WarpBeam` + `WarpBeamEvent` · `WOUND`/`WOUND_CANCEL` (önizlemeli) · **köken üçlüsü** (`originKind` + taraf alanları + XOR seddi, §3.9) · **brüt çıkış + ayrı iade** `WARP_ISSUE`/`WARP_ISSUE_REVERSAL`/`WARP_RETURN`/`WARP_RETURN_REVERSAL` + `YarnMovement.warpBeamId` + `ReasonPresetKind.WARP_RETURN` kataloğu (§3.7) · sarım kg + `kgSource` · **`Machine.warpBeamSlots`** (Faz 3'ten çekildi) · iplik kapısının `applyWarpBeamEventTx`e taşınması (§5) · levent planı · hazır levent listesi (çözgü kartına göre gruplu) · §4.9 sayım düzeltmeleri · bekçiler | "İplik nereye gitti", "hangi leventler hazır", "bu levent nereden geldi" ve "dip nereye gitti" ilk kez cevaplanır; tartılan sarımda devere firesi kg görünür | 2 tablo · 2 yeni pg enum tipi (`WarpBeamStatus`, `WarpBeamOrigin`) · `YarnMovementKind`'a 4 değer · `ReasonPresetKind`'a 1 değer · 4 kolon (`YarnMovement.warpBeamId` · `Machine.warpBeamSlots` · `WarpBeam` taraf alanları) · 11 şema-dışı nesne | 1a |
| **2 — Lot** | `YarnLot` · mal kabul iplik satırına lot + bobin adedi · sarımda lot seçimi · karışık/lotsuz lot uyarısı · "bobin metrajı kalbaya yeter mi" uyarısı · türetilen lot bakiyesi · levent → lot → irsaliye geri izleme | Çözgü yolu / ton farkının kök nedeni izlenir | 1 tablo · 2 kolon | İlk dokuma müşterisinde **Faz 1 ile aynı sürümde** önerilir: lotsuz sarılan levent kalıcı olarak lotsuz kalır |
| **3 — Tezgah ve kalan metre** | `MOUNTED`/`DISMOUNTED`/`CONSUMED`(elle)/`ADJUST_*`/`EXHAUSTED`/`SCRAPPED`/**`SHIPPED_OUT`** + tersleri · durum kolonları (`status`/`currentMachineId`/`currentPosition`, olayla AYNI tx) · `Station.consumesWarpBeam` · **`beamRole` küçük kataloğu** (zemin · hav · dolgu) · `beamsMountedDuring` helper + SQL ikizi · iki sebep kataloğu · levent kartı etiketi · tablet ekranı (yeni oturum türü) | Hangi tezgahta ne bağlı, kalan metre, levent dibi firesi, düğüm/tahar/takım süresi, dışarı verilen levent | CHECK genişlemesi · 2 enum değeri · 2 kolon (`Station.consumesWarpBeam` · `WarpBeamEvent.beamRole`) · 3 şema-dışı nesne (`warp_beams_machine_position_uq` · `warp_beams_mounted_ck` · `warp_beam_events_mounted_ck`) | #13, #14, #15, #16 |
| **4 — Top tezgahtan doğar** (dokuma bayrağıyla) | Rotada Dokuma adımı + tezgah çıkışı motoru (iş emri İÇİNDE doğum) · `RollEntrySource.WEAVING` · top çıkışında `CONSUMED(rollId)` otomatik (çift levent → iki satır) · take-up · atkı sayacı → metre | Top → levent → lot → tedarikçi geri izleme; randıman | enum değeri + tezgah defterleri (`SEKTOR` dokuma bulguları) | #8 · take-up verisi · `kumasTeknik` Dilim 3 |
| **5 — Gerekirse** | haşıl olayı · ara levent/direkt çözgü birleştirme · levent demirbaş kartı (dara → tartıdan kalan metre) · tezgah teknik kartı ve uyum kontrolü · ayrı lot bakiye tablosu · çok iplikli/renk raporlu çözgü · tahar planı yapılandırması · levent konumu · **bobin TEKİL kimliği** (kon/masura barkodu) | Sektör genişliği | ölçüme göre | #9, #10, #22 |
| **AYRI DİLİM — F1 İNDİ 2026-09-14** (levent; iplik `YARN` F3, haşıl verisi F2) | **Polimorfik fason sevk kalemi** (top \| levent \| iplik): ~~`SubcontractorDispatchItem.rollId` NOT NULL'dur ve fasona yalnız TOP gönderilmesine izin verir~~ **GEÇERSİZ → 2026-09-14**: kalem `kind` (ROLL \| WARP_BEAM) + `warpBeamId` + XOR CHECK; levent SHIP_OUT → RETURNED_IN çevrimi; ROLL yolu bayt bayt aynı (bekçi `test_subcontractor_dispatch_beam`) | Fason devere ve fason haşıl deftere yazar; `SEKTOR-YOL-HARITASI.md:153`'ün bağımsız tespit ettiği borç kapanır | 1 enum + 3 kolon + 2 CHECK + 1 partial unique (migration 170000/171000) | İNDİ (01, hüküm 1e) |

**Migration bandı:** `20260912120000` ve üstü (yönetici tahsisi; 6e `110000` bandını kullanıyor).

**Faz 1 bekçileri** (yazılacak, negatif sondalı):
- `test_devere_regime_gate`: iplik emsali; kapalı modülde 403, tek yazar kapısı, üç seviyeli zincir mesajı.
- `test_warp_beam_lifecycle`: claim yarışı; `WOUND_CANCEL` net ters kayıt + idempotent ikinci çağrı (aynı `clientToken` → cached yanıt, "Barkod üretimi…" 409'u DÖNMEZ); LIFO'nun yalnız durum olaylarını kapsaması; çift iptal seddi; işaret tablosu; formül fixture'ı 816,67 kg.
- Mekanik kapılar: `test_permission_catalog` · `test_role_template_catalog` · `test_master_data_merge_fk_coverage` (yeni `Item`/`Customer` FK'ları haritada) · `test_import_framework` (round-trip) · `test_screen_catalog`.

**Faz 3 bekçileri:** `test_warp_beam_mount` (bağla/sök claim'i, yuva seddi P2002 → 409, açık koşumda söküm 409, leventsiz koşum UYARI, `*_CANCEL` LIFO) · `test_machine_run_beam_overlap` (`beamsMountedDuring` ↔ SQL ikizi; çift levent ve koşum ortası levent değişimi) · `test_consistency` yeni maddeler (§4.9 6–8) · `test_db_invariants` dört yeni nesne (`warp_beams_machine_position_uq` · `warp_beams_mounted_ck` · `warp_beam_events_mounted_ck` · `machines_warp_beam_slots_nonneg`).
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
| 11 | Bobinleri depodan tartarak mı çıkarıyorsunuz? Sarım bitince bobin dipleri ne oluyor: tartılıp depoya mı dönüyor, atkıya mı gidiyor, telef mi? | — | **KAPSAMI ARTIK KİLİTLEMEZ** (§9.7): dördü de destekleniyor. Brüt `WARP_ISSUE` + ayrı `WARP_RETURN` + sebep kodu (`DEPOYA_IADE` · `ATKILIK_AKTARIM` · `TELEF`). Tartmayan fabrikada iade satırı doğmaz. Cevap **aksiyon anında** verilir, kurulumda değil: aynı fabrika bir gün depoya iade edip ertesi gün atkıya aktarabilir. Soru yalnız **ekran varsayılanını** belirler |
| 12 | Bir levende tek lot şartı var mı? Bobin metrajı kalbaya yetmeyince ortada lot değişiyor mu? | Lot uyarısının sertliği (Faz 2) | Hayır |
| 13 | Metal leventleriniz numaralı mı, kaç tane, darası biliniyor mu? Çift levent tezgahınız var mı? | `physicalBeamNo`, `warpBeamSlots`, tartıdan kalan metre | Faz 3 |
| 14 | Leventte kalan metreyi bugün nasıl biliyorsunuz: tezgah ekranı, çap ölçümü, tartı, tahmin? | Faz 3 elle tüketim ekranının biçimi | Faz 3 |
| 15 | Levent bitince dipte ne kadar kalıyor (m ya da kg), o artık ne oluyor? | Levent dibi fire kaydı | Faz 3 |
| 16 | Düğüm makineniz var mı? Tahar dairesinde takım hazırlıyor musunuz? Tahar / düğüm / takım değişimi tipik kaç saat, kim yapıyor? | Bağlama yöntemi ve süre alanlarının anlamı | Faz 3 |
| 17 | Çözgü boyunu neye göre veriyorsunuz: sipariş metresi + kısalma payı mı, levent kapasitesi mi? Kısalma yüzdesi kartta yazıyor mu, nasıl ölçülüyor? | Plan ekranı; Faz 4 take-up | Hayır |
| 18 | "600 KAR İPİ"deki 600 nedir (büküm tur/m, kod, başka)? | İplik kartı alanları: ad ayrıştırılmaz, doğru alan elle doldurulur | Hayır |
| 19 | Devere kopuşlarını sayıyor musunuz, fireyi tartıyor musunuz? | `breakCount` ve `kgSource`'un saha karşılığı | Hayır |
| 20 | Devereyi hep içeride mi yapıyorsunuz? Fason devere yaptırdığınız, levent satın aldığınız ya da başka dokumacıya levent verdiğiniz oluyor mu? | — | **KAPSAMI ARTIK KİLİTLEMEZ** (§9.7): dördü de destekleniyor. `WarpBeam.originKind` + taraf alanları + `SHIPPED_OUT` (§3.9). Köken **her leventte seçilir**, kurulumda değil — aynı fabrika hem içeride sarıp hem hazır levent alabilir. Soru yalnız formun varsayılanını belirler. ⚠️ Fason devereNİN DEFTERİ ayrı dilime bağlı (polimorfik sevk kalemi) |
| 21 | Tül perdeyi dokuma tezgahında mı, raşel (çözgülü örme) makinesinde mi üretiyorsunuz? | — | **KAPSAMI ARTIK KİLİTLEMEZ** (§9.7): ikisi de, birlikte de destekleniyor. `Machine.machineClass` (tezgah izleme tasarımında) + `Machine.warpBeamSlots` **Faz 1b'ye çekildi** + `beamRole`. Soru yalnız hangi makine sınıfının kurulacağını belirler |
| 22 | Tezgah tipiniz ne: su jeti, hava jeti, rapier (kancalı), jakar/armür? | Haşıl ihtiyacı, levent tipi/uyum | Hayır |
| 23 | Raşelde barı başına levent AYRI AYRI mı sarılıyor, yoksa takım hâlinde mi (aynı çözgü kartından N levent aynı anda)? | `WOUND` tek satır mı N satır mı; sarım formunun şekli | Hayır — ama 1b ekranını etkiler |
| 24 | Yuvalar rollü mü (zemin leventi · hav/pile leventi · dolgu)? Rol adlarınız neler? | `beamRole` kataloğunun içeriği; gerekli mi | Hayır (Faz 3) |
| 25 | Hazır levent alıyorsanız fatura satırı NE üzerinden: adet, kg, metre? | `PURCHASED` levent mal kabul kalemi olarak nasıl doğar | Hayır — ama §3.9'un ticaret tarafını belirler |
| 26 | Fasona verilen ipliğin mülkiyeti kimde kalıyor? Fason devereci kendi ipliğini mi kullanıyor? | Emanet iplik — `SEKTOR-YOL-HARITASI.md:152` `MaterialOwnership` boşluğuyla AYNI sınıf, onunla birlikte çözülür | Hayır (kapsam dışı) |

## 9 · Yönetici kararları (2026-09-12)

Taramanın açık bıraktığı beş çelişki `teks-erp-1e` tarafından karara bağlandı. Kararlar aşağıda; gerekçeler ölçüt sırasına göre (① sektör standardı ② ölçeğimiz ③ kod deseni). **Uygulama sırası yöneticidedir; bu belge hâlâ ÖNERİDİR.**

| # | Konu | KARAR | Gerekçe | Belgedeki karşılığı |
|---|---|---|---|---|
| 9.1 | Rota ↔ devere adımı | **Öneri kabul.** Dokuma rotada ADIM + topun giriş noktası (Faz 4, tezgah çıkışı motoruyla). Devere yalnız istasyon KATALOĞUNDA (makine, oturum, yetenek); iş emri adımı değil. Levent kendi tablosunu ve defterini alır | ① çözgü/leventleme top doğmadan önceki hazırlıktır, top rotasının adımı değildir ② çekirdek adım kodu (recompute + quickStart) canlı fabrikanın bütün akışını taşıyor; levent için ona dokunmak orantısız risk ③ recompute topsuz adımı PENDING bırakıyor (ölçüldü, §3.3) | §3.3 · §7 Faz 4 |
| 9.2 | Bayrak adı | **Öneri kabul.** `tezgah.enabled` monitörizasyon olarak KALIR; `dokuma.enabled` Faz 4'te doğar (üretime bağlı). Var olan anahtarın anlamı genişletilmez — DB anahtarı kimliktir | ③ mevcut anahtarın kapsamı kodda ve bekçilerde yazılı | §5 "Dokuma ile ilişki" |
| 9.3 | Grandfathering kural satırı | **Daraltılacak:** "dünkü davranışı olmayan (yeni doğan) modülde değer = false". Kural satırı `docs/kurallar/modul-bayrak.md`'ye yazılır, ezilen eski cümle `GEÇERSİZ → 2026-09-12` diye işaretlenir, gerekçe arşive girer | ③ kod ve bekçi yer tutucular için zaten sabit `false` yazıyor (`20260902230000` migration'ı); kural satırı düz okununca bunu yasaklıyor görünüyordu | §5 "Grandfathering" |
| 9.4 | Profil | **Mevcut `perde` profili DEĞİŞMEZ** (kumaşı hazır alan kurulum). Hedef kitle için AYRI profil doğar: **`perde-dokuma`** (ticaret + iplik + devere açık; tezgah Faz 4'te). `tam` devere'yi kendiliğinden açık almaya devam eder | ② profil de kimliktir; canlı kurulumun profil içeriğini değiştirmek sessiz davranış değişikliğidir | §5 "Profiller" |
| 9.5 | Tül / raşel | **Raşel ayrı modül DEĞİL.** `Station.consumesWarpBeam` + `Machine.warpBeamSlots` yeterlidir; levent tüketen makine dokuma tezgahıyla sınırlanmaz. Saha sorusu #21 açık kalır, tasarım iki cevaba da hazırdır | ① raşel (çözgülü örme) da levent tüketir, kılavuz barı başına bir levent ③ yetenek bayrağı kalıbı (`appliesQuality` emsali) makine türünden bağımsızdır | §4.5 · §8 #21 |

### 9.6 · Levent ↔ tezgah kesişimi: reddedilen üç alternatif (2026-09-12)

Tezgah izleme tasarımıyla kesişim ölçüldü ve **TEK DEFTER** kararı verildi: levent olay defteri. Reddedilenler, altı ay sonra yeniden açılmasınlar diye gerekçeleriyle:

| Reddedilen | Neden reddedildi |
|---|---|
| **`WarpBeamMount` span tablosu** (bağlama aralığını satır olarak tutan ikinci tablo) | Aynı gerçeğin İKİNCİ kaydı olurdu: aralık zaten `MOUNTED`/`DISMOUNTED` çiftinden türer. İki kaynak bir gün ayrışır ve "hangisi doğru" sorusu doğar; üstelik span satırı defterin ters kayıt disiplininin dışında kalırdı (span güncellenir, defter güncellenmez) |
| **Dokuma koşumuna levent FK'sı** (`MachineRun.warpBeamId`) | Levent ↔ makine bağı bir ZAMAN ARALIĞIDIR: çift levent tezgahta aynı anda iki levent vardır ve koşumun ORTASINDA levent değişebilir. Tek FK bu ikisini temsil edemez; kesişim `beamsMountedDuring(machineId, from, to)` helper'ından okunur (§4.4) |
| **`MachineSpec.beamSlots`** (yuva sayısı için ayrı model) | Yuva sayısının tek kaynağı `Machine.warpBeamSlots`tır (+ `machines_warp_beam_slots_nonneg` CHECK). İkinci bir yer, iki sayının ayrışması demekti |
| **`WarpBeam.remainingLengthM` kolonu** | Durum ↔ sayaç çifti açardı (iki yazar + çift yüklem + CHECK). Kalan metre `Σ işaret(kind) × lengthM` ile türetilir (§4.8); levent başına olay sayısı onlar–yüzler mertebesindedir |

"Şu an ne" sorusunun cevabı yine de durum kolonlarındadır (`status` · `currentMachineId` · `currentPosition`) ve olayla **aynı transaction'da** yazılır; tekillik seddi `warp_beams_machine_position_uq`, emsali `work_sessions_active_machine_uq`. Mutabakat maddeleri §4.9 (6)–(8) durum ile defterin ayrışmasını mekanik olarak yakalar.

### 9.7 · ÇERÇEVE KARARI: tek senaryoya bağlanmaz — dört mekanizma, sırayla (2026-09-12)

Kullanıcı çerçeve kararı verdi: *"Her seçeneği uygulayan firma gerçek hayatta mevcut, biz hepsine hitap ediyoruz. Tüm senaryolar çalışmalı; duruma göre bayrağa bağlamalıyım veya aksiyon anında seçeneğe bağlamalıyım."* Üç saha sorusunun (#11 · #20 · #21) üçüne de cevap **"hepsini destekle"**dir.

**Varyasyonun yeri dört mekanizmadan biridir ve SIRAYLA denenir** (tam tablo §0):
`[ÇEKİRDEK]` → `VERİ` → `AKSİYON ANINDA SEÇİM` → `[PROFİL] BAYRAK` (en son çare).

Ayırt edici cümle: **bayrak KOD YOLUNU açıp kapatır · veri AYNI kod yolunda farklı gerçekleri taşır · aksiyon anındaki seçim, aynı kod yolunda AYNI ANDA iki farklı gerçeği mümkün kılar.**

| # | Konu | KARAR | Gerekçe |
|---|---|---|---|
| 9.7a | Üç eksen kaç bayrak eder | **SIFIR yeni modül anahtarı.** Üç soru da "bu kod çalışsın mı" değil, kaydın İÇERİĞİ ("bu levent nereden geldi" · "bu iplik nereye gitti" · "bu makine neyi sayar") | Bayrağa çevrilseydi, aynı fabrikada iki makine tipi ya da iki tedarik yolu olduğu anda bayrak çökerdi. Bayrak enflasyonu da tek-senaryo kadar ciddi bir tuzaktır |
| 9.7b | Bobin/dip (#11) | **`WARP_ISSUE` BRÜT + ayrı `WARP_RETURN` + `ReasonPreset` ZORUNLU** (§3.7). Eski "net tek satır, iade türü gerekmez" kararı **GEÇERSİZ** | ① Çekirdek kural: *"sevk rakamı HER yüzeyde BRÜT; iade ayrı belgeyle kapanır"* — iplik çıkışı da bir çıkıştır. Net satır, ölçülen iki sayıdan birini kalıcı kaybeder ② Dip kaderi fabrika sabiti DEĞİL: aynı fabrika bir gün depoya iade edip ertesi gün atkıya aktarabilir → 3. mekanizma ③ Tartmayan fabrikada satır doğmaz; **yokluk zaten cevaptır**, bayrak gerekmez |
| 9.7c | Devere nerede (#20) | **`WarpBeam.originKind` + taraf kolonları + `SHIPPED_OUT`** (§3.9). **`wound_facts_ck`'deki `machineId NOT NULL` KALDIRILDI**, yerine köken XOR'u. ⚠️ Taraf TİPİ de kökene bağlıdır: `PURCHASED ⇒ supplierId XOR subcontractorId`; `CONSIGNED ⇒ ownerCustomerId` (Faz N, enum'a bugün girmez, tabloya satır girer) | ① Fason devere, hazır levent alımı, müşteri levendiyle fason dokuma ve levent satışı sektörde yaygın ② Eski CHECK bunları **DB düzeyinde imkânsız** kılıyordu ③ **Bugün bedava** — `warp_beam_events` henüz yazılmadı (ölçüldü: grep 0); yarın backfill + kısıt düşürme olurdu ④ Köken her leventte seçilir → formda SEÇİM, kilitli değil ⑤ `PURCHASED`ı `Customer`a zorlamak fason devereciye **ikinci cari kart** açtırırdı; `CONSIGNED`i `supplierId`e bindirmek **alış raporuna yalan** yazdırırdı — aynı kolon iki anlam taşımaz |
| 9.7d | Modül bağımlılığı | **`MODULE_DEPENDENCIES.devereEnabled = "iplikEnabled"` KALDIRILIR ve yerine HİÇBİR ŞEY YAZILMAZ.** ⚠️ Asıl düzeltme §5'in görünürlük cümlesindedir: denye `iplikEnabled \|\| devereEnabled` (ya da bayraksız, kalem tipinden) | ① `PURCHASED` levent iplik tüketmez; bağımlılık "hazır levent alan dokumacı" kurulumunu modül tablosunda yasaklıyordu ② **"Kapıyı taşı" talimatı GERİ ALINDI** — ölçüldü: `tx.yarnMovement.create` tek yerde, kapı zaten o tek yazarın ilk ifadesi; taşımak **ikinci kopya** olurdu ve `yarn.service` bunu adıyla yasaklıyor ③ Eski görünürlük cümlesi kararı tek başına iptal ediyordu: denye görünmezse `WarpSpec` açılamaz, levent doğamaz |
| 9.7e | Dokuma/raşel (#21) | **Tezgah izleme şeması §9.5 kararına UYDURULUR** (ayrı belge): `LoomShedType`/`LoomWeftInsertion` **nullable**; **nötr ad ailesi** `MachineSpec`/`MachineRun`/`Machine*`; `Machine.warpBeamSlots` Faz 3'ten **1b'ye çekilir**; `beamRole` eklenir. ⚠️ **"Sayaç türü sınıftan" talimatı GERİ ALINDI**: birim **SİNYALDE** (`COURSE_COUNTER`/`RACK_COUNTER`), sıklık **KOŞUMDA** (`unitsPerCm`), metre helper'ı sınıfa göre **DALLANMAZ**; `machineClass` yalnız sunum/rapor etiketidir ve zorunlu değildir | ① §9.5 zaten "raşel ayrı modül değil" demişti — **karar doğruydu, ŞEMA o karara uymuyordu**: `LoomShedType` NOT NULL raşeli yapısal olarak dışlıyordu ② Tezgah izleme **tamamen kâğıtta** (ölçüldü: `MachineSpec`/`MachineRun` şemada 0) — ad ve tip düzeltmesi bugün bedava, sonra migration + kod turu ③ Sınıf üstünde dallanmak bir `kind`-dispatch'tir (kök kural yasağı) ve sinyal ile sınıf ayrışırsa **çift yüklem** doğar; `shedType IS NULL` "ağızlıksız"ı zaten söyler |
| 9.7h | Yuva sayısı | **`machines_warp_beam_slots_nonneg`: CHECK `>= 0`, varsayılan `1`, 0 serbest (cağlık)** — `>= 1` DEĞİL. **GEÇERSİZ → 2026-09-14:** "varsayılan 0" hükmü (canlı şema `91e24e3b` `DEFAULT 1` ile indi, 1e ölçtü) | ① `>= 1` bir senaryo kapatıyordu: cağlıktan beslenen çözgü makineleri (elastan raşel, iğneli dar dokuma) çözgü tüketir ama **levent bağlanmaz**, yuva 0'dır — senaryoyu kapatan CHECK'ti, varsayılan değil ② Kurulum değeri soru değildir, ama tezgahın 1 yuvası olağan durumdur; 0 yalnız çözgü makinesinde AÇIKÇA yazılır. Kurşun/tambur makinesinde sayı okunmaz: yuva kapısı sayı değil `Station.consumesWarpBeam`tir, sayı yalnız üst sınırdır ③ Bugünkü davranış korunur: alan sorulmaz, `beamSlot` yalnız `> 1` makinede istenir (`assertBeamSlotValid`) |
| 9.7f | Bobin tekil kimliği | **AÇILMAZ** — Faz 5'e bırakıldı | Gerçek bayrak/alan enflasyonu riski buradadır: lot + `bobbinCount` (Faz 2) soruların hepsini cevaplıyor; tekil kon barkodu karşılığı olmayan bir kimlik üretir |
| 9.7g | Fason sevk kalemi | **AYRI DİLİM** — bu belgenin kapsamı dışında | `SubcontractorDispatchItem.rollId` NOT NULL'dur (ölçüldü, `schema.prisma:3887`): fasona yalnız TOP gidebilir. Polimorfik kalem (top \| levent \| iplik) 1b'den büyüktür ve zaten bağımsız bir borçtur (`SEKTOR-YOL-HARITASI.md:153`) |

⚠️ **Kök `CLAUDE.md`'ye ve `MODUL-BAYRAK-TASARIM.md §5.2`'ye DOKUNULMADI.** Oradaki "devere/çözgü/haşıl yeni mimari istemez — istasyona istasyon, rotaya adım" cümlesi 9.1 kararıyla **daralıyor**: top rotası için doğru, levent için eksik. Kök dosyanın düzeltilmesi kullanıcı onayına bırakıldı (yöneticinin listesinde).

### Faz 1a / 1b ayrımı — karar ve kesme yerinin gerekçesi

Faz 1 tek sürüm için büyüktü (3 tablo + 2 enum değeri + 4 kolon + 9 şema-dışı nesne + panel ekranı). Kesme yeri **"defter yazıyor mu"** çizgisine kondu, "tablo sayısı" çizgisine değil:

- **1a hiçbir defter satırı doğurmaz** (katalog + kolon + bayrak). Ters yol borcu doğmaz, geri alma yüzeyi gerekmez, bekçi yükü küçüktür; yanlış giderse modül kapatılır ve geride yalnız boş katalog kalır.
- **1b defteri ileri VE geri yoluyla birlikte getirir** (`WOUND` + `WOUND_CANCEL` + `WARP_ISSUE` + `WARP_ISSUE_REVERSAL`). Doktrin bunu zaten şart koşuyor: "ters yol yazılmadan ileri yol sürüme çıkmaz" (`defter.md:56`).
- **Neden `WOUND` 1a'ya alınmadı:** iplik çıkışı olmadan doğan levent, sonradan kapatılamayan bir boşluk bırakır — o leventlerin ipliği hiçbir zaman deftere bağlanamaz (lot ile aynı sınıf hata, §7 Faz 2 notu). Levent doğuşu ile iplik tüketimi **aynı transaction ve aynı sürümde** kalmalıdır.
- **Sıra ön koşuludur, opsiyon değil:** 1b'nin sarım formu çözgü kartını ve denye'yi ister; 1a bu veriyi toplamaya başlatır.

### 1b İNDİ — 2026-09-14 (0c; hüküm 1e) ve "beş kalem" kuralının 1b'ye uygulanışı

- **[ÇEKİRDEK] Tezgah tasarımının "beş kalem aynı sürümde" kuralı (`DOKUMA-TEZGAH-IZLEME-TASARIMI.md` §9 Faz 3) Faz 3'ün BAĞLAMA defterine aittir ve 1b'yi bölmeyi YASAKLAMAZ: 1b o beşten hiçbirini açmaz (MOUNTED olayı · `currentMachineId/currentPosition` · yuva seddi · `beamsMountedDuring` · mutabakat). 1b KENDİ BEŞLİSİYLE tam defterdir — tablo + olay defteri + iplik çifti (brüt çıkış / ayrı iade + tersleri) + storno/dip iadesi + bekçi — AYNI SÜRÜMDE çıkar, commit'e bölünebilir** (c1 enum değerleri · c2 tablo+servis+panel+izin+bekçi · c3 belge). Faz 3 kolonları 1b'de AÇILMADI (yazıcısız kolon yalan söyler); `Machine.warpBeamSlots` 6e'nin F4 kolonudur (`91e24e3b`), 1b onu yaratmaz.
- **Denye sıralama bağımlılığı şemayla değil helper'la kalktı:** `resolveDenier(item)` tek kaynak (bugün `linearDensityDen`); 1a′ (YarnCountSystem) yalnız o fonksiyona dokunur, WOUND yazıcısına değil.
- **#13 bloklamadı:** `physicalBeamNo` NULL doğar, yuva sayısı 6e'nin kolonunda varsayılan 0, dara Faz 5. **#23 (raşel takımı):** N ayrı levent = N ayrı WOUND (form "N adet" sayacı — panel borcu, ilk raşel müşterisinde).
- **Tablet devere ekranı = AYRI DİLİM** (borç): 1b yalnız panel yüzeyi getirdi; `ReasonPresetKind.WARP_RETURN` tablet zemini bilerek boş.
- Ölçüm: `test_warp_beam_lifecycle` (§0–§9, iki negatif sonda diskte) · `test_db_invariants` +10 nesne · `test_defter_ters_yol` beyanı (`WarpBeamEvent` TERS_BAG · `YarnMovement` +2 çift) · `test_yarn_stock` · `test_consistency §27` işaret tek kaynak · `test_reason_preset_kind_parity` (13 ayna) · `test_audit_labels` (WEIGHED/IN_HOUSE ortak beyanı) · katalog/rol/ekran bekçileri · `test_devere_regime_gate §6` (üç model + servis deseni).

## 10 · Çelişmeli doğrulama — Faz 1b c1 · c2 · onarımlar (2026-09-14, 47; 1e hükmü A–D)

**Sonuç: 1e hükmü A–D ayakta; c1 enum dilimi ve c2 tablo/servis/panel dilimi tasarımla (§3.7 · §3.8 · §4.3–§4.8 · §5 · §9.7) birebir, sapmalar kalem olarak 0c'ye gitti ve hüküm alındı — K1 (migration idempotent) ve K3 (devere → iplik bağımlılığı) origin'de kapandı ve yeniden ölçüldü; K2 (§4.9 mutabakat) ve K4/K5/K6 0c'de sırada.** Yöntem İŞ 6 biçimi: klon DB'de bekçiler (tek ağır koşum, `agir-is` sarmalayıcısı), en eski canlı dump provası (`tekserp_47prova_test`), sondalar `scripts/` dışından, statik okuma; kod kusuru yazılmadı, sahibine adıyla gitti.

**c1 (`137509df`, enum değerleri) — ölçüm 2026-09-14 (47):** 5 migration dosyası tek ifade (`ADD VALUE IF NOT EXISTS`, dosya başına 1 `;`; 55P04 emsali), klon DB deploy 7/7; bekçiler `migration_enum_add_value` · `reason_preset_kind_parity` (13 ayna) · `audit_labels` · `yarn_stock` · `swagger_spec` · `mobil_enum_aynasi` · `defter_ters_yol` · `db_invariants` · `timestamptz_contract` · `reason_presets` yeşil, backend `tsc` 0. `yarn.routes` create şeması 4 tür (WARP_* reddi), liste süzgeci 8; `yarnMovementSign` +4 (çıkış −, tersi +, dip +, tersi −) — `test_yarn_stock` bakiyeyi bu fonksiyonla topluyor; `assertYarnBalanceCoversTx` OUT + WARP_ISSUE (tersler/ADJUST muaf, §10 sözleşmesi); `WARP_RETURN_REASONS` 3 satır (DEPOYA_IADE · ATKILIK_AKTARIM · TELEF), KIND_STORES_TEXT=false; panel sekmesi `devereEnabled` bayrağıyla (`useVisibleKindTabs` harita), mobil zemin bilerek boş. Electron `types/enums.ts` ve mobil `YarnMovementKind` aynası taşımaz (union `Yarn/service.ts`te) — reçete 7/11 n/a.
- **K1 (0c, küçük):** `purchase-order.service.ts:273` `inbound = IN || ADJUST_IN` iki-yön listesi `yarnMovementSign`a bağlanmadı — §4.9/2 "gizli mayın, Faz 1'de bağlanır" demişti; bugün etkisiz (fiş bağı süzgeci, WARP satırı `goodsReceiptId` taşımaz).
- **K2 (0c/1e, orta — c2 sürüm kararı):** RECETELER enum adımı 13 cevapsız: eski panel `YarnMovementsSheet.tsx:206` `YARN_KIND_META[m.kind]` bilinmeyen türde TypeError (`kindBadgeClass` → `m.adjustment`), iplik hareketleri paneli çöker; satır c2 yazıcısıyla doğar, backend önce çıkar → **HÜKÜM (1e, 2026-09-14): minVersion YÜKSELTİLMEZ** — WARP_* satırı yalnız c2 yazıcısıyla ve `devere.enabled` AÇIK kurulumda doğar; referans fabrikada bayrak kapalı ⇒ 1.3.1 panel satırı hiç görmez (kural: minVersion yalnız gerçek kırılmada). Bilinmeyen türde TypeError yine "altıncı enum değeri" kusur sınıfı → 0c c2'de `YarnMovementsSheet`e bilinmeyen tür zemini (ham kod/"?", çökmez).
- **c2 borcu:** `defter-beyan.ts` YarnMovement KARSI_OLAY çiftleri yalnız [ADJUST_IN, ADJUST_OUT] · [IN, OUT]; `[WARP_ISSUE, WARP_ISSUE_REVERSAL]` · `[WARP_RETURN, WARP_RETURN_REVERSAL]` eklenmeli. `defter_ters_yol` §3 yalnız beyanlı çiftlerin şemada olduğunu ölçer, enum değerlerinin çift kapsamasını ölçmez → eksik beyan SESSİZ yeşil (kapı sahibi 82'ye kalem).

**c2 (`16dd775a`, tablo + servis + panel) — ölçüm 2026-09-14 (47):** canlı dump provası (`tekserp_47prova_test`, 2026-09-11 dump'ı → c1+c2 7 migration deploy yeşil; `warp_beams`/`warp_beam_events` + 9 CHECK + `one_wound_uq` + `physical_live_uq` (tr_fold) + `yarn_movements.warpBeamId/reasonCode`); 20 bekçi yeşil — `warp_beam_lifecycle` 32 · `devere_regime_gate` (§6 üç model + servis deseni) · `db_invariants` · `defter_ters_yol` (WARP çiftleri +2, `WarpBeamEvent` TERS_BAG) · `consistency` · `yarn_stock` · `screen_catalog` · `route_auth_coverage` · `swagger_spec` · `audit_labels` · `master_data_merge_fk_coverage` · `advisory_lock_namespaces` · `timestamptz_contract` · `migration_hygiene` · `token_replay` · `guarded_hard_remove` · `reason_preset_kind_parity` · `permission_catalog` + `role_template` (klon DB uzlaştırıldıktan sonra) · backend `tsc` 0; beş sonda `scripts/` dışından; statik okuma (Electron diff dahil).

| hüküm / tasarım maddesi | sonuç | nasıl |
|---|---|---|
| (A) `WarpBeam` durum + `WarpBeamEvent` append-only (`updatedAt` yok), WOUND/WOUND_CANCEL + WARP_ISSUE/RETURN çiftleri, köken üçlüsü XOR, iptal önizlemesi; `currentMachineId/Position` AÇILMAZ; `warpBeamSlots` 6e'nin | ✅ | şema/migration §4.3–§4.6 ile birebir (Faz 3 kolonları yalnız yorumda; `physical_live_uq` yalnız READY); `§0b` iki serviste update/delete 0; `resolveOriginParty` tek kapı + `warp_beams_origin_party_ck` ikinci hat + panel `superRefine` aynası; `GET /:id/cancel-preview` (kalem × depo, × sebep) |
| (B) beş-kalem/LIFO kuralı Faz 3'ün; 1b ileri + geri aynı sürüm | ✅ | WOUND ↔ WOUND_CANCEL (`reversesEventId @unique`, `cancel_link_ck`), WARP_ISSUE ↔ _REVERSAL, WARP_RETURN ↔ _REVERSAL aynı commit; CANCELLED terminal (PLANNED'a dönmez — `one_wound_uq` gerekçesi) |
| (C) 1a′ RED → WOUND denyesi `resolveDenier(item)` tek helper | ✅ | `constants/warp-beam.ts`; `windWarpBeam` yalnız oradan okur, boşsa 400 `WARP_DENIER_MISSING` |
| (D) N levent = N WOUND, `beamNo` 8029 uzayı, tablet yüzeyi yok | ✅ | `one_wound_uq`; `nextBeamNoTx` → `lockCodeScopeTx(tx,"warpBeam",prefix)` ilk ifade (yeni advisory uzayı yok, bekçi yeşil); c2'de `mobil/` dokunuşu 0 |
| tek yazar `applyWarpBeamEventTx`: ilk ifade devere kapısı, claim `updateMany WHERE status=from`, count 0 → taze okuma → 409 `WARP_BEAM_STATE`; iplik satırları aynı tx | ✅ | statik + lifecycle §4a/§9 + sonda P4 (iki paralel iptal → TAM BİRİ, tek WOUND_CANCEL, tek ters iplik satırı) |
| replay: plan `WarpBeam.clientToken` + sarım `WarpBeamEvent.clientToken`, 4 durum, `assertWarpBeamReplayAlive` (5. okuyucu) | ✅ | lifecycle §2b/§4b/§5g; sonda P5 (silinen taslağın token'ı YENİ levent açar) |
| 3 izin (`warpbeam:read/write/cancel`, PRODUCTION) + rol şablonları + `SCREEN_CATALOG operations/warp-beams` (devereEnabled) + CAP_LABEL; panel dört kapı | ✅ | manifesto · karo `permission: "warpbeam:read"` + saf `isWarpBeamsVisible` · `ProtectedRoute requirePermission="warpbeam:read"` · `ROUTE_MODULE["operations/warp-beams"] = "devereEnabled"`; `route_auth_coverage` · `screen_catalog` yeşil |
| eksi-bakiye kümesi OUT + WARP_ISSUE + WARP_RETURN_REVERSAL; işaret tek modül `yarn-sign.helper.ts` (`yarnInboundKinds` → §27 SQL + purchase-order) | ✅ | `GATED_KINDS`; c1 K1 kapandı; `test_consistency` §27 elle liste gitti |
| hard-remove makine guard'ı · merge-map (customer.supplierId · subcontractor.subcontractorId MOVE) | ✅ | `guarded_hard_remove` · `merge_fk_coverage` yeşil; `WarpSpec`in kalıcı silme ucu yok (n/a) |
| §4.7 çok satırlı çıkış KANONİK `(itemId, warehouseId)` sırasıyla | ❌ K4 | sonda P1: ters depo sıralı iki paralel sarım ×15 → 15/15 turda biri P2010 (FOR UPDATE deadlock 40P01 sınıfı → middleware 409 geçici) |
| §4.9 yeni mutabakat bölümleri (1b: #1–#5, #9, #10) | ❌ K2 | `test_consistency` `warp_beam` atfı 0 (yalnız #1–#3 işaret düzeltmesi) |
| §5/§9.7d `MODULE_DEPENDENCIES.devereEnabled` kaldırılır | ❌ K3 (hüküm) | `module-flags.ts:84` `devereEnabled: "iplikEnabled"` canlı; arşiv 7704 "GEÇERSİZ (kaldırılır)" |
| RECETELER migration adımı 11 / [DB-23] idempotent SQL | ❌ K1 | ikinci koşum `type "WarpBeamStatus" already exists` (ilk ifade); WOTOL/isDefault emsalleri IF NOT EXISTS |

- **K1 (0c, orta):** migration `20260914125000` çıplak `CREATE TYPE/TABLE/INDEX`, `ADD CONSTRAINT/COLUMN` — `apply-migration.ts` defter satırı varken SQL'i yine koşar ([DB-23]); yeniden koşulabilir yazılmalı (`DO $$ IF NOT EXISTS (pg_type/pg_constraint)`, `IF NOT EXISTS`).
- **K2 (0c, orta):** §4.9 mutabakat bölümleri eksik — CANCELLED ⇒ kalan 0 ∧ Σ net ISSUE = 0 ∧ Σ net RETURN = 0 (ayrı ayrı) · READY ⇒ kalan > 0 ∧ tam bir WOUND · PLANNED ⇒ olay/iplik yok · son olay `toStatus` = `status` · köken↔defter (#9, Faz 5 şerhiyle yumuşak) · `WARP_RETURN.reasonCode` katalogda (#10). Lifecycle bekçisi davranışı ölçer, mutabakat veriyi.
- **K3 (hüküm 1e, orta):** `MODULE_DEPENDENCIES.devereEnabled = "iplikEnabled"` canlı — PURCHASED levent iplik tüketmez; "iplik KAPALI + devere AÇIK" kurulumu modül tablosunda yasak; §5 eşlik listesi (`test_devere_regime_gate` iki dal · modül kapatma önizlemesi "N içeride sarılmış levendin stornosu kilitlenir") de yok. 1a borcu mu, 1b mi, ayrı dilim mi?
- **K4 (0c, küçük):** `issues`/`returns` `warehouseId` sırasına dizilmeden yazılıyor — `yarn-balance-guard.helper.ts:74` başlığı kanonik sırayı her yazardan ister.
- **K5 (0c, küçük):** aynı `physicalBeamNo` (tr_fold) ikinci READY → ham Prisma P2002 (ifade indeksi; middleware kolon adı yerine `tr_fold` basar); tx geri alınıyor (PLANNED kalır) ✓ ama Türkçe ön kontrol yok.
- **K6 (0c, küçük):** dip iadesi brüt çıkışı aşabiliyor (sonda: iade 50 > çıkış 10 kabul; sarım net iplik ARTIRDI) — `Σ returns ≤ Σ issues` (kalem bazında) 400.
- Notlar: `windWarpBeam` replay okuması tx dışında (token @unique DB seddi; ikinci gönderim tx içinde P2002 → ?) — lifecycle §4b sıralı ölçüyor, paralel aynı-token sarım ölçülmedi · `cancelWound` `beam.events[0]`ı tx dışında okur, claim içeride (READY ⇒ WOUND var) ✓ · audit tx dışında ✓ · `listWarpBeams` cursor `createdAt desc, id desc` ✓ · `WarpSpec` pasifken plan 400 ✓ · Prova DB `tekserp_47prova_test` DROP listesinde (1e aldı).

**Hüküm (1e, 2026-09-14) ve kalemlerin son durumu:** K1 migration idempotent — yerinde, inişten ÖNCE (#64 bekler) · **K3 `MODULE_DEPENDENCIES.devereEnabled → iplikEnabled` KALDIRILIR** (tasarım §9.7d/arşiv zaten geçersiz saymıştı; her-senaryo: hazır levent alan fabrika iplik tutmaz) — yerine IN_HOUSE sarım yolunda aksiyon anında `iplik.enabled` kapalıysa 403 `MODULE_DISABLED`, PURCHASED/SUBCONTRACT serbest; 1b'de, aynı trene · K4/K5/K6 tek sha · K2 §4.9 mutabakat `test_consistency` ayrı sha (#65). Onarım sha'larının doğrulaması İŞ 13 (K3'ün üç kapısı, K1'in ikinci koşumu).
**İŞ 13 — K3 + K1 onarımlarının origin'deki hâli (`b845f76b` · `d2307f41`), ölçüm 2026-09-14 (47):**
- **K1 ✅ canlı dump'ta:** `20260914125000` (19 `IF NOT EXISTS` + 19 `DO … duplicate_object`) `tekserp_47prova_test`te ikinci ve üçüncü kez koşuldu — hata 0, uyarı 18 (skipping), nesne kümesi sabit (25 kısıt · 15 indeks).
- **K3 ✅ üç kapı (statik):** backend `MODULE_DEPENDENCIES.devereEnabled` satırı YOK · `requireDevereEnabled` yalnız `readDevereEnabled` (ticaret/iplik dalları ve üç seviyeli mesaj gitti) · panel `lib/module-flags` aynası (satır düştü), `modulesThatDependOn("ticaretEnabled") = ["iplikEnabled"]`, `("iplikEnabled") = []`, `ModuleProfilePage` §1b (2 ters / 3 düz, Ticaret satırı Devere'yi anmaz), `useOperationsVisibility` devere ham bayrak (belirsizken false).
- **K3 ✅ uçtan uca (sonda, klon DB — iplik KAPALI + ticaret KAPALI + devere AÇIK):** fason levent plan + sarım READY, iplik satırı 0 · hazır alım (tedarikçi) sarım READY, iplik satırı 0 · **içeride sarım → 403 `MODULE_DISABLED` `modul: iplik`, levent PLANNED kaldı, olay 0, iplik 0 (tx geri alındı)** · fason sarım iptali CANCELLED (iplik defterine dokunmaz) · iplik açılınca aynı PLANNED levent sarılır (READY, WARP_ISSUE 1).
- **Bekçiler:** `iplik_regime_gate` 13/0 · `devere_regime_gate` 20/0 · `module_flags` · `module_profile` · `feature_flag_contract` · `warp_beam_lifecycle` 34/0 (§10a/§10b) · `db_invariants` · `migration_hygiene` · `defter_ters_yol` · `screen_catalog` · `search_field_config` yeşil; backend `tsc` 0; Electron vitest (ModuleProfile · useOperationsVisibility · tile-visibility · lib) yeşil. `module_flag_off §3` kırmızısı ORTAM (klon DB'de grandfathering satırları yok — beş anahtar satırsız), K3'e bağlı değil.
- **`iplik_regime_gate` muafının negatif sondaları (dosya sha256 ile geri yüklendi):** MUAF'tan `routes/warp-beam.routes.ts` düşürüldü → §2 ❌ "KAPISIZ: routes/warp-beam.routes.ts (→ yarnMovement)" · `DEFTER_YAZARLARI`ndan `warp-beam-wind.service.ts` düşürüldü → §4a ❌ "LİSTEDE OLMAYAN yazar" — iki muaf da gerçekten ölçülüyor.
- **Kalan (0c):** K2 §4.9 mutabakat bölümleri (#65) · K4/K5/K6 tek sha (sırada) → İŞ 14'te ölçüldü, aşağıda.

**İŞ 14 — K4–K6 (`8d2349b9`) + K2 mutabakat (`9fb69d29`) + §13 teardown onarımı (`fe1410da`), origin `e32a7fe0`; ölçüm 2026-09-14 (47):**
- **K4 ✅ kanonik kilit sırası:** `issuesSorted`/`returnsSorted` (depo → sebep) tx içinde bu sırayla yazılıyor; İŞ 12'nin aynı sondası (ters depo sıralı iki paralel çok-satırlı sarım ×15) → **30/30 ok, deadlock 0** (önce 15/15 P2010).
- **K5 ✅ gövde ön kontrolü:** `assertPhysicalBeamFree` claim ÖNCESİ `public.tr_fold` ile; küçük-harf varyantı → **409 `WARP_BEAM_PHYSICAL_BUSY`**, meşgul levent ADIYLA (`busyBeamNo`), levent PLANNED kaldı; `physical_live_uq` ikinci hat.
- **K6 ✅ Σ iade ≤ Σ çıkış:** iade 50 > çıkış 10 → **400 `WARP_RETURN_EXCEEDS_ISSUE`**, iki toplam gövdede; kalem sabit (çözgü kartının ipliği).
- **K2 §34–§39 SQL ikizi:** `test_consistency` ↔ `consistency-check.sql` altı bölüm **birebir** (yalnız `::text` sunum farkı), bölüm numaraları aynı.
- Sondalar P4/P5 (paralel iptal TAM BİRİ; taslak token'ı) yine ✅.
- **K2 ✅ §34–§39 kapsam sayaçlı mutabakat (sonda, klon DB):** fikstürlü koşum (READY IN_HOUSE çıkış+dip · CANCELLED · PLANNED · SUBCONTRACT READY) → altı bölüm ÖLÇÜLDÜ (⏭ yok), drift 0 · drift enjeksiyonu (ham SQL, kendi fikstürüne: CANCELLED durum kolonu READY'ye · IN_HOUSE WOUND.machineId NULL · WARP_RETURN sebep kodu katalog dışı · PLANNED levente WARP_ISSUE satırı) → **§35 §36 §37 §38 §39 KIRMIZI**, WOUND_CANCEL satırı düşünce **§34 KIRMIZI** ("1 DRIFT SATIRI") · fikstür silinince altı bölüm **⏭ kapsam 0** (sessiz yeşil değil).
- **Bekçiler:** `consistency` (2 dosya) · `defter_ters_yol` · `db_invariants` · `yarn_stock` · `devere_regime_gate` · `iplik_regime_gate` · `warp_beam_lifecycle` (§11–§13 dahil) yeşil; backend `tsc` 0, scripts `tsc` 0. Kalem yok — Faz 1b'nin İŞ 12 kalemleri K1–K6 tamamen kapandı.

## 11 · Tablet devere ekranı — DİLİM TANIMI (2026-09-14, 6e; hüküm 1e — kod hükümden SONRA)

> Bu bölüm bir TANIMDIR, kod değil. Biçim `DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md` §3.9'un tablet ikizi (⓪–K). Kullanan: sahadaki devere elemanı; panel "Leventler" (yönetici/süpervizör) origin'de (`e32a7fe0`, §10). Referans fabrikada `devere.enabled` KAPALI ⇒ bu dilim kapalıyken sıfır fark üretir.

### ⓪ Ön koşullar (hepsi origin'de, ölçüldü)
- Backend Faz 1b tam: `POST /api/warp-beams` (plan, `WarpBeam.clientToken`) · `POST /:id/wind` (`WarpBeamEvent.clientToken`) · `GET /:id/cancel-preview` · `POST /:id/cancel` · `DELETE /:id` (④ taslak) · `GET /devere-machines`; tek yazar `applyWarpBeamEventTx` ilk ifadesi devere kapısı; IN_HOUSE + iplik kapalı → aksiyon anında 403 (K3). Tablet dilimi **şema açmaz, servis mantığı değiştirmez** — yalnız kapı genişletir ve yüzey ekler.
- Devere makinesi bir `StationKind` DEĞİL, `Station.producesWarpBeam` yeteneğidir (§3.x, `schema.prisma:876-883`). Tablet oturum haritası (`stationScreens.ts` / `SESSIONABLE_STATION_KINDS`) `StationKind` anahtarlıdır ⇒ **bu ekran OTURUMSUZDUR** (kimlik JWT'den, makine her sarımda seçilir). Faz 3'ün "tablet ekranı (yeni oturum türü)" satırı (§7) BU dilim değil — yuvaya takma/sökme gelince açılır. → **Hüküm D4.**
- Mobil zemin bilerek boş bırakılmış yerler: `useReasonPresets.ts:88-90` (`WARP_RETURN` zemini) · `FeatureFlags.devereEnabled` YOK · `screenModules.ts` `MobileModuleFlag` iki değer · `permissions.ts` union'da `mobile:devere` yok — hepsi bu dilimde dolar.

### A · Ekran (`Devere`, etiket "Levent Sarım", yatay tablet; telefonda dikey liste + tam ekran form)
1. **Liste** — sekme: *Planlı* (PLANNED, `createdAt asc`) · *Bugün sarılan* (READY, `wound.createdAt` fabrika günü). Satır: `beamNo` · çözgü kartı `code — name` · planlanan m · köken etiketi (`WARP_BEAM_ORIGIN_LABEL` aynası) · `physicalBeamNo` varsa. Süzme sunucuda (`status`, `search`), cursor + `FlashList`. Salt-okunur detay (olaylar + iplik satırları) `GET /:id`.
2. **Plan** (buton: "Yeni levent") — alan alan `createSchema` ile birebir: `warpSpecId` (seçici: aktif çözgü kartları; kart pasifse seçilemez) · `plannedLengthM` · `originKind` (üç köken; **D1**) · SUBCONTRACT → fasoncu seçici · PURCHASED → tedarikçi XOR fasoncu · `physicalBeamNo` (opsiyonel, ≤32) · `notes` · `clientToken`. Kaydet → 201, listede Planlı'ya düşer. Planı DÜZENLEME tablette YOK (PATCH panelde): yanlış plan → **taslak sil** (`DELETE /:id`, yalnız PLANNED, onay modalı "hiç olayı yok, silinir") → yeniden plan.
3. **Sar** (Planlı satırdan) — `windSchema` ile birebir: `lengthM` (varsayılan `plannedLengthM`) · `kgSource` (IN_HOUSE varsayılan WEIGHED, diğerleri THEORETICAL; nominal kg ön hesabı `theoreticalKg` panelle AYNI formülün aynası, `resolveDenier` boşsa sunucu 400 `WARP_DENIER_MISSING` — form denye yoksa "kartta denye yok" uyarısı, kaydet kilitli değil) · IN_HOUSE: `machineId` (yalnız devere makineleri, ZORUNLU) · **brüt iplik çıkışı** satırları (`warehouseId`, `qtyKg`; ≥1) · **dip iadesi** satırları (`warehouseId`, `qtyKg`, `reasonCode` — `ReasonPresetPicker` kind `WARP_RETURN`, beş kapı) · `breakCount` · `sectionCount`/`endsPerSection` (ikinci sayfa, opsiyonel) · `startedAt` (varsayılan şimdi; geçmiş tarih yalnız "başlangıç saati" alanından, sunucu kırpıyorsa `warnings` toast) · `clientToken`. SUBCONTRACT/PURCHASED: makine ve iplik satırı ÇİZİLMEZ (sunucu 400 verir; form hiç göndermez). Depo seçici: bağlam ucu (D2) 1 depo döndürüyorsa gizli ve o depo yazılır, >1 ise zorunlu seçici (panel `multiWarehouse` deseni).
4. **İptal** (Bugün sarılan satırından; yetenek izni `mobile:devere-iptal`, **D3**) — önce `GET /:id/cancel-preview` çizilir (dönecek çıkış satırları depo ADIYLA, iade satırları sebep ADIYLA, `lengthM`), gerekçe ≥3, buton önizleme gelmeden kilitli (panel `CancelDialog` aynası). Sonuç CANCELLED; PLANNED'a dönüş YOK (terminal) — ekran bunu yazar: "iptal sonrası yeniden sarım için yeni plan".
5. **Hata → eylem haritası** (`details.code`, `classifyStopFailure` deseni): `WARP_BEAM_STATE` → listeyi tazele ("başkası sardı/iptal etti") · `WARP_BEAM_PHYSICAL_BUSY {busyBeamNo}` → alan hatası, meşgul levent adıyla · `WARP_RETURN_EXCEEDS_ISSUE {issueKg,returnKg}` → iade satırı hatası iki toplamla · `WARP_DENIER_MISSING` → karta yönlendir · `WARP_BEAM_MACHINE_NOT_DEVERE` → makine alanı · `REASON_CODE_INVALID` → sebep alanı, katalog tazele · `MODULE_DISABLED {modul}` → `modul:"devere"` ekran kapanır (bayrak tazele), `modul:"iplik"` "içeride sarım için iplik modülü kapalı — fason/hazır seçin" · `CLIENT_TOKEN_COLLISION` / `WARP_BEAM_CANCELLED` → 409 modalı (kk1 emsali) · eksi bakiye 409 (kodsuz) → mesaj aynen.
6. **Raşel takımı (#23)** "N adet" sayacı BU dilimde YOK — panelde de yok, ilk raşel müşterisinde iki yüzeye birlikte (borç satırı kalır).

### B · Kaydet — alan alan (route Zod ile birebir; istemci katmanı sessiz allowlist'tir, alan iki uçta da yazılır)
| alan | plan | sar | kaynak/sözleşme |
|---|---|---|---|
| `clientToken` | uuid | uuid | `generateClientUuid`; MANTIKSAL deneme başına bir, yalnız belirsiz hatada yapışır (`entryAttempt.ts` deseni, doff `tokenForDoff` ikizi `devereAttempt.ts`) |
| `warpSpecId` · `plannedLengthM` · `originKind` · `subcontractorId` · `supplierId` · `physicalBeamNo` · `notes` | ✓ | — | `createSchema .strict()`; köken XOR istemcide de `superRefine` aynası (panel `schema.ts`) |
| `lengthM` · `kgSource` · `machineId` · `yarnIssues[]` · `yarnReturns[]{+reasonCode}` · `breakCount` · `sectionCount` · `endsPerSection` · `startedAt` | — | ✓ | `windSchema .strict()`; satır ≤50 |
| `reason` (3..300) | — | iptal | `cancelSchema` |

### C · Idempotency ve eşzamanlılık (çekirdek, aynen)
- Plan ve sarım token'lı (dört durumlu replay sunucuda); iptal/taslak-sil token'sız — iptal `reversesEventId @unique` ile DB'de tek, ikinci basış 409 `WARP_BEAM_STATE`; taslak-sil ikinci basış 409 `WARP_BEAM_NOT_PLANNED` → listeyi tazele.
- Formda "Kaydet" tek basışlık (`isPending` kilidi + 90 sn `INFLIGHT_REUSE_WINDOW_MS` deseni).

### D · Çevrimdışı — KUYRUK YOK (kk1.md:65/:114, dokuma.md:89 kararı bu dilimde de aynı)
Bütün mutasyonlar `networkMode:'always'`; ağ/sunucu yokken Plan/Sar/İptal kilitli, sebebi ayrı yazılır (ağ yok / sunucu yok); kalıcı düşüş anlık toast; `STATION_MUT`/`setMutationDefaults`/`stationLabels` üçlüsüne GİRMEZ. Gerekçe: iplik çıkışı deftere yazar ve eksi-bakiye kapısı sunucudadır — kuyrukta bekleyen sarım, arada başka bir çıkışla bakiyeyi aşar ve kuyruk boşalırken sessiz 409 üretir.

### E · Bayrak — tablet eşi ("kapalıyken sıfır fark")
- `FeatureFlags.devereEnabled` (mobil tip) + `DEFAULT_FEATURE_FLAGS.devereEnabled = false` (fail-closed, `dokumaEnabled` emsali) + `useDevereEnabled()`.
- `screenModules.ts`: `MobileModuleFlag` union +`'devereEnabled'`, `SCREEN_MODULE.Devere = 'devereEnabled'`, `resolveMobileModuleState` devere = HAM bayrak (production zincirine BAĞLI DEĞİL — panel `useOperationsVisibility.ts:44-47` aynası; hazır levent alan fabrika üretim modülü olmadan da devere açabilir). `conditionalScreens` +Devere. `test_screen_catalog §3b` bu dosyayı metin okur → katalog satırı `modul: "devereEnabled"` ile iki yönlü birebir.
- Kapalıyken: kart yok · navigator yok · doğrudan uç 403 `MODULE_DISABLED {modul:"devere"}` (route-level `requireDevereEnabled` zaten var) · `WARP_RETURN` sebep kataloğu kapalıyken de listelenir ama tüketicisi yok (sebep kataloğu bayrağa bakmaz — bugünkü davranış, değişmez).

### F · Enum aynası
Mobil union'lar `WarpBeamStatus` (PLANNED/READY/CANCELLED) · `WarpBeamOrigin` (IN_HOUSE/SUBCONTRACT/PURCHASED) · `WarpKgSource` (WEIGHED/THEORETICAL) · olay `kind` (WOUND/WOUND_CANCEL) → d9'un `test_mobil_enum_aynasi` `MOBILDE_BEKLENEN` beyanına girer (bugün beklenen-eksik/dışında; dilimle birlikte beyan güncellenir, yoksa girdi bayat → ❌). `ReasonPresetKind.WARP_RETURN` mobil union'da ZATEN var (`reasonPreset.service.ts:34`).

### G · Dört kapı — tablet envanteri
| kapı | dosya : sembol | ölçen bekçi | emsal |
|---|---|---|---|
| ① route + izin | `warp-beam.routes.ts`: GET list/:id/devere-machines + **`GET /tablet-context`** (D2) → `requireAnyPermission("warpbeam:read", ...MOBILE_DEVERE)`; POST plan · POST wind · DELETE taslak → `requireAnyPermission("warpbeam:write", ...MOBILE_DEVERE)`; GET cancel-preview · POST cancel → `requireAnyPermission("warpbeam:cancel", ...MOBILE_DEVERE_IPTAL)`; PATCH (düzenle) tablet izni ALMAZ | `test_route_auth_coverage` · `test_devere_regime_gate` (uç listesi genişler) · `test_mobile_screen_permissions` | `machine-stop.routes.ts:23-24` `MOBILE_DOKUMA` |
| izin kataloğu | `permission-catalog.ts`: `mobile:devere` (ekran, MOBILE) + `mobile:devere-iptal` (yetenek, `ROLE_COVERAGE_EXEMPT` gerekçeli: "sarımı iptal deftere ters kayıt yazar, operatör paketine girmez"); `role-template-catalog.ts`: süpervizör +ikisi; tek-ekran şablonu `MOBILE_DEVERE` (`codes: ["mobile:devere"]`); `MOBILE_ALL` wildcard'la kendiliğinden; migration YOK (uzlaştırma boot'ta) | `test_permission_catalog` · `test_role_template_catalog` · `test_role_coverage` | `mobile:dokuma-geri-al` (:636) |
| ② `SCREEN_CATALOG` | mobil satır `Devere`: `modul: "devereEnabled"`, `requires: ["mobile:devere"]`, `capabilities: [{code:"mobile:devere-iptal", label:"Sarım iptali"}]`; `SCREENLESS_PERMISSIONS`'a girmez | `test_screen_catalog` (§3b metin aynası) | Dokuma satırı :345 |
| ③ kart · navigator · palet | `permissions.ts` `MobileScreenKey`+`MOBILE_SCREENS` (`{key:'Devere', permission:'mobile:devere', label:'Levent Sarım', icon:'…'}`), `MobilePermission` union +2 · `MainNavigator.tsx` `SCREEN_LOADERS.Devere` (lazy; `withWorkSession` DEĞİL) · `theme/tokens.ts` `moduleAccents.Devere` · `useVisibleScreens` (izinli ∖ modülü kapalı — kart ve navigator aynı liste) · `stationScreens.ts` iki haritaya GİRMEZ (oturumsuz, ⓪) | mobil jest: `useVisibleScreens` + ekran rejim testi ("bayrak kapalı → kart yok, izin yok → kart yok") | Dokuma (`MainNavigator.tsx:35`) |
| ④ bayrak | E bölümü | `test_screen_catalog §3b` · `test_feature_flag_contract` (yeni alan sözleşmede) · mobil `featureFlag` varsayılan testi | `dokumaEnabled` |

### H · Reçete ile çelişki ölçümü (`RECETELER.md` "Yeni mobil ekran" 23 madde)
Uygulanmayan adımlar beyanla: **6** (`stationScreens` iki harita — ekran oturumsuz, ⓪) · **12–13** (kuyruk — D) · **23** (SIMULATED — tartı okumaz, `kgSource=WEIGHED` operatör girdisidir, cihaz yok). Adım **14** (`ReasonPresetPicker` beş kapı) `WARP_RETURN` zemini bu dilimde dolar. Adım **9** anyPermission genişletmesi DELETE'i de kapsar (④ sınıfı silme; hard delete envanteri `defter.md` değişmez — yeni silme yolu değil, mevcut yolun ikinci izni).

### I · Kapanış ölçütü — TEK sha (backend kapı genişletmesi + mobil yüzey; "backend önce" dağıtım sırasıdır, commit sırası değil — 0c panel dilimi emsali 47 dosya tek commit)
1. G'nin dört kapısı + izin kataloğu aynı commit'te; `check-docs` · `test_screen_catalog` · `test_route_auth_coverage` · `test_mobile_screen_permissions` · `test_devere_regime_gate` · `test_mobil_enum_aynasi` · `test_reason_preset_kind_parity` · `test_feature_flag_contract` · `test_role_coverage` yeşil; mobil `tsc` 0 + jest (ekran · `devereAttempt` · rejim); backend `tsc` 0.
2. Uçtan uca (klon DB, bayrak açık, `mobile:devere` tek izinli kullanıcı): plan → sar (IN_HOUSE, çıkış+dip) → READY, `WARP_ISSUE`/`WARP_RETURN` satırları; aynı kullanıcı iptal → 403 (yetenek yok); `mobile:devere-iptal` ile önizleme → iptal → CANCELLED, ters satırlar; bayrak kapalı → 403 `MODULE_DISABLED`; taslak sil ikinci basış 409.
3. Negatif sondalar iki yönlü, mekanizma adıyla: (a) `MOBILE_DEVERE` bir uçtan düşürülünce `test_devere_regime_gate` tablet kolu KIRMIZI · (b) `SCREEN_MODULE.Devere` satırı silinince `test_screen_catalog §3b` KIRMIZI · (c) `DEFAULT_FEATURE_FLAGS.devereEnabled = true` yazılınca mobil varsayılan testi KIRMIZI · (d) token her basışta yenilenince `devereAttempt` testi KIRMIZI.
4. `minVersion` HAYIR: yeni ekran bayrakla kapalı doğar, eski tablet hiçbir şey görmez; enum değerleri (WARP_*) eski tablette görünen bir liste beslemez (iplik hareketleri ekranı tablette yok).
5. Sürüm notu maddesi 5e'ye (operatör dili) sha inince; `dokuma.md:51` borç satırı "İNDİ" satırına döner; bu bölüme `## İNDİ — <tarih>` eklenir; 47 çelişmeli doğrulama (K).

### J · HÜKÜM SORULARI (1e) — öneri önde
- **D1 Plan kökenleri tablette:** (a) **üçü de** (öneri — her seçeneği uygulayan firma gerçek; fasoncu/tedarikçi seçici mobilde zaten var: fason sevk ekranı) · (b) yalnız IN_HOUSE+SUBCONTRACT, PURCHASED panelde. (a) seçilirse tedarikçi seçici `Customer` listesinden (supplier = Customer modeli) → `customer:read` yerine bağlam ucu (D2) "tedarikçi adayları"nı taşır.
- **D2 Form bağlamı tek uçtan:** (a) **`GET /api/warp-beams/tablet-context`** → `{ warpSpecs[], machines[], warehouses[{id,name}], subcontractors[], suppliers[] }`, `requireAnyPermission("warpbeam:read", "mobile:devere")` (öneri: operatöre `warpspec:read`/`warehouse:read`/`customer:read` dağıtmadan tek izin, fail-closed, tek gidiş; panel bunu KULLANMAZ — kendi uçları kalır) · (b) dört mevcut GET'in `requireAnyPermission`ına `mobile:devere` eklemek (dört dosya, dört bekçi listesi, operatöre depo/cari listesi açılır).
- **D3 İptal tablette:** (a) **VAR, yetenek izni `mobile:devere-iptal` ile, önizleme zorunlu** (öneri — aynı vardiyada yanlış girilen sarımı saha düzeltir; süpervizör şablonunda, operatör paketinde değil) · (b) yalnız panel.
- **D4 Oturum:** (a) **oturumsuz** (öneri; devere StationKind değil, Faz 3 "yeni oturum türü" yuvaya takmayla gelir) · (b) `StationKind.DEVERE` açmak — şema + rota şablonu kapısı ("rota şablonuna giremez" sınıfı), bu dilimde RED önerisi.
- **D5 Taslak sil tablette:** (a) **VAR** (④ sınıfı, kendi yanlış planını düzeltme; `mobile:devere` ile) · (b) yalnız panel.
- **D6 Telefon:** (a) **tablet + telefon** (dikey: liste, form tam ekran) · (b) yalnız tablet (`useDeviceType` ile telefonda kart gizli).
- **D7 Tek sha mı iki sha mı:** (a) **tek** (I) · (b) backend kapı + mobil yüzey ayrı, aynı tren.

### İNDİ — 2026-09-14 (6e; hüküm 1e D1–D7 hepsi ÖNERİLEN (a) + üç ek şart)
- **Hükümler:** D1 üçü de (tedarikçi adayları bağlam ucundan, `customer:read` dağıtılmaz) · D2 tek uç `GET /api/warp-beams/tablet-context` tek izinle, panel kullanmaz · D3 iptal VAR, `mobile:devere-iptal` + önizleme zorunlu, gerekçe ≥3, süpervizör şablonunda (ROLE_COVERAGE_EXEMPT'e GİRMEZ — dar rolde olan muaf edilmez, bekçi ısırdı) · D4 oturumsuz · D5 taslak sil VAR · D6 tablet + telefon · D7 tek sha. Ek: ① `devereEnabled` DEFAULT false + "kapalıyken sıfır fark" negatif sondayla (mobil `screenModules.test`/`useVisibleScreens.test`: DEFAULT true yazılınca 2 ❌, `SCREEN_MODULE.Devere` silinince 2 ❌) · ② bağlam ucu OPT-IN allowlist — allowlist `map`tir, `select` değil (`test_warp_beam_tablet §2`, sonda: map'e `taxNumber` → 2 ❌) · ③ `minVersion` HAYIR; sürüm maddesi tablet 1.0.7 turunda (2026-09-13 turu, panel Leventler maddesinin ardında), kopyalar + `check-surum-notlari` 16/16 aynı sha'da.
- **İniş:** backend `warp-beam.routes.ts` (`MOBILE_DEVERE`/`MOBILE_DEVERE_IPTAL`, `/tablet-context`) · `warp-beam-tablet.service.ts::getWarpBeamTabletContext` (ayrı dosya: 300 satır tavanı) · izin kataloğu +2 · rol şablonu (süpervizör +2, tek-ekran `MOBILE_DEVERE`) · `SCREEN_CATALOG` Devere · mobil `screens/Modules/Devere/` (kabuk + `useDevereScreen` + `useBeamForms` + `useBeamMutations` + saf `beamPayload`/`devereAttempt` + BeamList/PlanModal/WindModal/YarnLinesEditor/BeamActionModals) · `FeatureFlags.devereEnabled` · `SCREEN_MODULE.Devere` · `MOBILE_SCREENS`/union/navigator/palet · `types/models.ts` üç union (`test_mobil_enum_aynasi` beyanı) · `test_mobile_screen_permissions` iki muaf (önizleme+iptal). Sapmalar tanımdan: A1 "bugün sarılan" sekmesi READY listesinin cihaz gününe süzülmüş hâli (sunucu tarih süzgeci yok) · `startedAt`/`sectionCount`/`endsPerSection` tablet formunda YOK (sunucu varsayılanı; ikinci sayfa gelmedi) · `WARP_RETURN` zemini BOŞ kaldı (online-only ekranda zemin karar korumaz).
- **Ölçüm (6e, sonda DB `tekserp_6e4_test`):** `test_warp_beam_tablet` 29/0 (+3 sonda) · `warp_beam_lifecycle` 37/0 · `screen_catalog` 37 · `route_auth_coverage` 15 · `mobile_screen_permissions` 6 · `devere_regime_gate` 20 · `permission_catalog` 24 · `role_template_catalog` 21 · `swagger_spec` 12 · `feature_flag_contract` 78 · `kimlik_sizintisi` 4 · `mobil_enum_aynasi` 42 · mobil jest Devere/screenModules/useVisibleScreens 40/40 (+6 sonda) · üç `tsc` 0.

### K · Çelişmeli doğrulama — (47, iniş sonrası)

## 12 · Faz 2 — İPLİK LOTU A1 (şema + servis) İNDİ — 2026-09-14 (6e; hüküm 1e L1–L5 hepsi (a) + üç ek şart)

- **Şema (§4 aynen):** `yarn_lots` (`[itemId, lotNo]` tekil, `supplierId` NULL olabilir, `isActive`, damgalar) + `yarn_movements.lotId` (Restrict) + `bobbinCount` (CHECK `> 0` null değilse) + `(lotId, createdAt)` indeksi; migration `20260914160000_yarn_lots` idempotent, veri migrasyonu YOK (mevcut hareketler lotsuz kalır — §7 "lotsuz sarılan levent lotsuz kalır").
- **Bakiye türetilir** (§3.5): `yarnLotBalanceTx` (lot × depo / lot toplamı), liste `yarnLotBalancesTx` tek sorgu; SQL işareti `yarnInboundKinds()`tan (elle liste yok).
- **Hükümler:** L1 (a) lot etiketli çıkış lot × depo bakiyesini aşamaz → 409 `YARN_LOT_BALANCE_EXCEEDED`, **eksi-bakiye bayrağından BAĞIMSIZ** (depo bakiyesi fabrika tercihi, lot etiketi BEYANDIR; okuma depo satırı FOR UPDATE'inden SONRA) · L2 (a) mal kabul iplik satırında `lotNo` metin → `ensureYarnLotTx` upsert, 8029 `yarnLot` kilidi ilk ifade, tedarikçi yalnız ilk doğuşta · L3 (a) izin yok (`yarn:write` / `warehouse:read`) · L5 (a) dip iadesi lotu çıkış lotlarından değilse uyarı. Ek ① `normalizeLotNo` TRIM + boş → null, normalize YOK · ② `supplierId` NULL meşru (elle lot) · ③ `devere.lotRequired` satır-yok ↔ `false` yanıtı BİREBİR ölçüldü (`test_yarn_lot §7`).
- **Yazıcılar:** `applyYarnMovementTx` allowlist +`lotId`/`bobbinCount` (kimlik `assertLotMatchesItemTx` önce, guard sonra) · mal kabul `addYarnLine` (lot + bobin; `lotRequired` açıkken lotsuz satır `failed[]`e düşer) · `reverseGoodsReceiptYarnTx` net kalem × depo × LOT · sarım `yarnIssues[].lotId` / `yarnReturns[].lotId`, sıralama depo → lot (→ sebep), uyarılar (lotsuz · karışık · iade lot dışı), `lotRequired` açıkken lotsuz çıkış 400 `YARN_LOT_REQUIRED` · `groupYarnLinesTx` anahtarı depo × lot (× sebep) ⇒ WOUND_CANCEL ters kayıt LOT BAZINDA · elle hareket `lotId?` · sayım/fatura yolları lot-agnostik (dokunulmadı).
- **Okuma:** `GET/POST/PATCH /api/yarn/lots` (`yarn-lot.service`; silme yok, pasif) · `GET /yarn/movements?lotId` + satırda lot · levent detayı `yarnLines[].lot` · iptal önizlemesi kalem × depo × lot · fiş dökümü `lot`/`bobbinCount`.
- **Bayrak:** `devere.lotRequired` [PROFİL] davranış bayrağı — `SETTING_KEYS` + `FeatureFlags.devereLotRequired` + okuyucu + PATCH + Electron tip aynası; profillere/modül tablosuna GİRMEZ; panel satırı A2 (devere kategorisi + `HideableModule` genişlemesi) — `test_feature_flag_contract` PANEL_EXEMPT gerekçeli, A2 inince silinir.
- **Merge/koruma:** `YarnLot.itemId` CONFLICT (BLOCK, `[itemId, lotNo]`) · `YarnLot.supplierId` MOVE · Restrict FK'lar (hard-delete guard'ı gerekmez) · audit `YARN_LOT`.
- **Ölçüm:** `test_yarn_lot` 39/0 (dört sonda: allowlist `lotId` düşür → §0a/§1c… · guard lot dalı → §3 · grup anahtarı → §4e · okuyucu sabit true → §1f/§3a/§4b) · `test_consistency` §40/§41 (+ SQL ikizi) · `db_invariants` 212 · `defter_ters_yol` 241 · `merge_fk_coverage` 27 · `feature_flag_contract` 78 · `module_profile` 58 · yarn_stock 87 · warp_beam_lifecycle 37 · goods_receipt 89 · stock_count 104 · finance_invoice 46 · swagger 12 · audit_labels 22 · Electron vitest 588 · tsc ×3.
- **A2 PANEL İNDİ — 2026-09-14 (6e; hüküm 1e H-A2a `section:"production"`, H-A2b sekme):** mal kabul iplik satırı `lotNo` (irsaliye metni) + `bobbinCount` (kumaş satırında çizilmez/gönderilmez; `expandLines` allowlist) · detay "Lot / Bobin" kolonu ("Lot yok" açık) · Leventler: sarım formunda satır başına lot seçici (aday `GET /yarn/lots?itemId=<çözgü ipliği>&isActive=true`, bakiyeyle; "Lot yok" seçeneği yalnız `lotRequired` kapalıyken), iptal önizlemesi depo × lot, liste "Lot" kolonu (`lotSummary`: sarılmamış — · lotsuz sarım **"Lot yok"** · tek lot adı · N lot) — backend `WarpBeamDto.lots: string[]` (düz alan, allowlist: yalnız lotNo) · İplik sayfası **"Lotlar" sekmesi** (`YarnLotsPanel`: sunucu süzgeci kalem/arama/aktiflik, cursor, türetilen bakiye, elle aç, pasife al; yeni route YOK) · hareket dökümü "Lot" kolonu + elle hareket lot seçici (opsiyonel) · Ayarlar: `devere` kategorisi (`section:"production"`, `moduleKey:"devereEnabled"`) satır `devereLotRequired` defaultOn false; `HideableModule`/`SettingsModuleState`/`SettingsModuleKey` +devereEnabled (HAM, üretime zincirlenmez), `FLAG_MODULE.devereLotRequired = "devereEnabled"`, `test_feature_flag_contract` PANEL_EXEMPT satırı SİLİNDİ + `REGIME_GATES.devereEnabled`. Sayım/fatura lot-agnostik BORÇ `dokuma.md`ye yazıldı (ek şart ④). Bekçi: vitest `receiptLineRows.test` ①② · `warp-beam-regime.test` lot özeti · `settings-groups.test` devere kategorisi ①②③; beş negatif sonda ölçüldü (TRIM yok · payload lot yok · lotsuz sarım "—" · `moduleKey` düşür · devere üretime zincirle). Sürüm maddesi panel 2026-09-13 turu.
- **A3 TABLET İNDİ — 2026-09-14 (6e; A2 ile AYNI TREN — 5e ölçtü: `windWarpBeam` tek uç iki yüzeye, `devere.lotRequired` açılınca tablet A3 inmeden 400 alırdı; mal kabul kapısı panel-only, tablette mal kabul yüzeyi yok ⇒ A2+A3 birlikte inince bayrağın kapattığı HER yol lot taşır):** `GET /warp-beams/tablet-context` +`yarnLots[{id,lotNo,itemId,balanceKg}]` (yalnız çözgü kartı olan ipliklerin AKTİF lotları, türetilen bakiyeyle; allowlist `map` — `test_warp_beam_tablet §2` ALLOW +yarnLots, §4a–c; sonda: map'e `notes` → §2b ❌) + `lotRequired` (SUNUCUDAN; alan yoksa false). Mobil `YarnLinesEditor` satır başına lot seçici (`PickerModal`, kartın ipliğine süzülmüş, **"Lot yok" açık seçenek** — `lotRequired` açıkken çizilmez; `yarnLots` yoksa (eski sunucu) seçici HİÇ çizilmez = form birebir eski), `beamPayload` `lotId` allowlist + `validateWind(…, lotRequired)` erken kapı (sunucu 400 zaten verir), `useBeamForms` lotRequired bağlamdan. Bekçi: mobil `beamPayload.test` ⑧⑨⑩ (sonda: yükten lotId düşür 2 ❌ · lotRequired dalı sil 1 ❌ · kapalıyken de reddet 4 ❌). Sürüm maddesi tablet 1.0.7 turu ("sarımda lot seçimi; 'lot zorunlu' açıkken tablette de lotsuz çıkış kabul edilmez" — mal kabul cümlesi tablette YOK).

## 13 · Faz 3 — TEZGAH BAĞI E1 (şema + servis) İNDİ — 2026-09-14/15 (6e; hüküm 1e: plan onaylı, "her ihtimali bayrak ve seçeneklere bağlı uygula"; E1 tek başına iner — kapalı bayrak yüzey istemez, E2 panel · E3 tablet ayrı sha)

- **Şema (§4 aynen):** `WarpBeamStatus += MOUNTED · EXHAUSTED · SCRAPPED` · yeni pg tipleri `WarpBeamMountMethod` (TYING_IN · DRAWING_IN · HARNESS_CHANGE) ve `WarpLengthSource` (LOOM_COUNTER · DIAMETER · WEIGHED · ESTIMATED) · `ReasonPresetKind += WARP_BEAM_ADJUST · WARP_BEAM_SCRAP` (katalog: SAYAC_DUZELTME · OLCUM_FARKI · KAYIT_HATASI / DIP_TELEF · DIP_ATKILIK · KOPUK_COZGU · YANLIS_SARIM) · `WarpBeam.currentMachineId/currentPosition` (+ `warp_beams_mounted_ck` ⇔, partial `warp_beams_machine_position_uq` yalnız MOUNTED, `physical_live_uq` MOUNTED'ı da işgal sayar) · `Station.consumesWarpBeam` (DEFAULT false — yuva kapısı BUDUR, §9.7h) · `WarpBeamEvent` +10 kolon (mountPosition · beamRole · mountMethod · setupStartedAt · setupMinutes · machineCounter · lengthSource · grossKg · tareKg · fabricLengthM) + `kind_ck` 18 tür + `mounted_ck` + iki aralık CHECK'i. Migration üçlüsü `20260914180000/180100/180200` (enum ADD VALUE tek ifade, yapısal idempotent).
- **Defter (§4.7):** +12 tür — MOUNTED/DISMOUNTED/EXHAUSTED/SCRAPPED + tipli `*_CANCEL` (**LIFO**: `activeForwardStatusEventTx` ↔ `ACTIVE_FORWARD_EVENT_SQL`), CONSUMED↔CONSUMED_CANCEL (LIFO dışı), ADJUST_IN/ADJUST_OUT (sebep zorunlu, karşı düzeltmeyle kapanır). İşaret tablosu `warpBeamLengthSign` (+: WOUND · SHIP_OUT_CANCEL · RETURNED_IN · CONSUMED_CANCEL · ADJUST_IN · EXHAUST_CANCEL · SCRAP_CANCEL; −: tersleri; 0: mount ailesi); bekçi §0a her çiftin toplamı 0. "Şu an ne" kolonu olayla AYNI claim'de (`applyWarpBeamEventTx` `place` + `whereMachineId`).
- **Kapılar:** bayrak `devere.mountTracking` (409 `WARP_MOUNT_TRACKING_OFF`, yetki değil durum) · makine `Station.consumesWarpBeam` + yuva 1..`warpBeamSlots` (400) · yuva dolu 409 `WARP_SLOT_BUSY` (ön kontrol adıyla, yarışta P2002 → F61 `p2002Mentions`) · `mountTrackingRequired` → yöntem + başlangıç 400 · kalan eksiye düşemez tek kapı `assertCoversRemaining` (409 `WARP_BEAM_REMAINING_EXCEEDED`; CONSUMED · ADJUST_OUT · EXHAUSTED) · söküm/bitiş/hurda/MOUNT_CANCEL koşum kapısı `assertDismountAllowedTx` (tezgah §7.3 düzeltilmiş (1): açık koşumda n=0 → 409 `WARP_DISMOUNT_OPEN_RUN`, 0<n<yuva → uyarı; dokuma kapalıysa uygulanmaz) · koşum açılışı `runOpenBeamWarning` (uyarır, reddetmez).
- **Ölçüm yolları (#13/#14 cevapsız → HEPSİ veri):** `lengthSource` beyanı · `closeToMeasuredTx` (ölçülen kalan ≠ türetilen: R>M → CONSUMED, R<M → ADJUST_IN `OLCUM_FARKI`) · `warpLengthFromWeight` (brüt−dara)÷(tel×denye÷9e6), dara yoksa ESTIMATED 0 + uyarı · EXHAUSTED `lengthM` = artık (0 → null), SCRAPPED `lengthM` = kalan · terminalde kalan 0 (§44).
- **Uçlar (`warp-beam-mount.routes.ts`, `warp-beam.routes`in alt yönlendiricisi — aynı üç kapı):** `GET /mounted/:machineId` · `POST /:id/mount` · `/dismount` · `/consume` · `/adjust` · `/exhaust` · `GET /:id/scrap-preview` · `POST /:id/scrap` · `/:id/events/:eventId/cancel` (LIFO) · `/:id/consumed/:eventId/cancel`. İzin yeni kod yok: tak/düzelt `warpbeam:write`|`mobile:devere`; sök/tüket/bitir + `mobile:dokuma`; hurda/geri almalar `warpbeam:cancel`|`mobile:devere-iptal`. DTO +`currentMachineId/currentPosition/currentMachine`, olay DTO +10 alan (`helpers/warp-beam-dto.helper`).
- **Koşum penceresi (§4.8 · 9.6):** `beamsMountedDuring` ↔ `BEAMS_MOUNTED_DURING_SQL` tek kaynak (mountedAt = `setupStartedAt ?? createdAt`, kapatıcı = ilk aktif DISMOUNTED/EXHAUSTED/SCRAPPED/SHIP_OUT; geri alınmış bağlama görünmez); tezgah raporları yalnız helper'ı çağırır — `test_machine_run_beam_overlap §0` AST tripwire.
- **Bayraklar [PROFİL]:** `devere.mountTracking` DEFAULT false = bugün (**ölçüldü:** satır yok → tak/tüket 409, levent READY kalır) · `devere.mountTrackingRequired` DEFAULT false. `FeatureFlags` + okuyucu + PATCH + Electron tip aynası; panel satırı E2 (`test_feature_flag_contract` PANEL_EXEMPT 2 satır gerekçeli, E2 inince silinir).
- **Ölçüm:** `test_warp_beam_mount` 47/0 (dört sonda: `assertCoversRemaining` → §4b/§4e/§4f/§4g/§5d/§8a · `assertSlotFreeTx` düşür → §2e · `assertMountTrackingOnTx` → §1b/§1c/§2a/§2b · LIFO orderBy asc → §6b HATA) · `test_machine_run_beam_overlap` 8/0 (iki sonda) · `test_consistency §42–§44` (+ SQL ikizi; sonda 3/3 ısırdı) · `db_invariants` 220 (+5 nesne) · `defter_ters_yol` 273 · `mobil_enum_aynasi` 44 (üç union + iki tip beyanı) · `iplik_regime_gate` 13 (alt router salt-okuma beyanı) · lifecycle 37 · tablet 34 · yarn_lot 39 · dispatch_beam 48 · audit_labels · kind_parity · feature_flag_contract 78 · module_flag_off 111 · permission/role catalog. Mobil dokunuş: yalnız enum aynası + `STATUS_LABEL` üç etiket (Tezgahta · Bitti · Hurda); minVersion HAYIR (yeni durumlar eski tablette yalnız rozetsiz görünür, eylemler kapalı).
- **E2 PANEL / E3 TABLET — SIRADA (ayrı sha'lar):** Leventler satır menüsü Tak/Sök/Tüket/Düzelt/Bitir/Hurda/Geri al + Tezgah/yuva + Kalan m kolonları + ayar satırları (PANEL_EXEMPT düşer) + istasyon `consumesWarpBeam` / makine `warpBeamSlots` yazma yüzeyi (BaseController skaler tuzağı — açık allowlist) + sebep kataloğu sekmeleri; tablet Devere "Tezgahta" sekmesi (Tak) + Dokuma "Levent" paneli (Sök/Tüket/Bitir) + tablet-context `loomMachines` + iki bayrak.

