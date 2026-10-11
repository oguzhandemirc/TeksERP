# Tezgah Salonu: çoklu seçim, sağ tık menüsü ve tezgaha iş verme (tasarım)

> **Durum: TASARIM — kullanıcı kararları 2026-10-11 işlendi.** Terimler yeni adlarla yazılır: Dokuma İş Emri (`WeavingOrder`), Terbiye İş Emri (`WorkOrder`); kod ve numara adları aynen.


> **Tarih:** 2026-10-11 · **Kod:** yok · **Taban:** `origin/main` `9d1d674ee`
> **Kapsam:** `Electron/src/pages/Operations/WeavingFloor/` + `GET /api/loom-floor`
> **İşaretler:** **[ÖLÇÜLDÜ]** kodda/şemada görüldü (dosya adıyla) · **[VARSAYIM]** ölçülmedi, karar ya da saha bilgisi gerekir · **[YOK]** aranıp bulunamadı

---

## 0 · Önce terim: "tezgaha iş atamak" bugün ne demek? (ÖLÇÜLDÜ)

Kullanıcının dediği "iş emri", bu sistemde **iki ayrı belge** olarak var ve tezgaha yalnız biri bağlanabiliyor:

| Belge | Ne | Tezgaha bağlanır mı |
|---|---|---|
| **Terbiye İş Emri** (`WorkOrder`; eski adı İş emri) | Kumaşın dokumadan SONRAKİ yolculuğu (KK1 → kurşun → tambur …), rota adımları | **HAYIR.** Kural: dokuma topun rotasında bir adım değildir; WEAVING istasyonu rotaya giremez (`dokuma.md` ilk iki madde, `assertStationsRoutable`). |
| **Dokuma İş Emri** (eski adıyla Dokuma İşi, `WeavingOrder`; numara `DK`+GGAAYY+NNNN) | "Şu kumaştan, şu renkte, şu kadar metre dokunacak" | **Evet, ama dolaylı:** Dokuma İş Emrinin kendisinde tezgah alanı YOK. |

Tezgahla Dokuma İş Emri arasındaki tek bağ **koşum**dur (`MachineRun`): "bu tezgahta, şu hatta, şu andan itibaren şu iş dokunuyor". Yani bugün "tezgaha iş vermek" = **o tezgahta o Dokuma İş Emriyle koşum açmak**. Koşum bir **olaydır** (gerçekten başladı), plan değildir.

Ölçülen gerçekler:
- **Planlı/sıradaki iş varlığı YOK.** `WeavingOrder`da `machineId`/`plannedMachine` yok, ayrı bir "tezgah iş planı" tablosu yok (`schema.prisma`da arandı). Tasarım bilerek kuyruksuz: "Dokuma ekranı bir KUYRUK değil bir TEZGAH gösterir" (`dokuma.md` Tablet §).
- **Dolaylı bir "plan" var:** levent bir Dokuma İş Emrine bağlanabilir (`WarpBeam.weavingOrderId`, Z1-Y2); levent tezgaha takılıysa tablet koşum açarken o işi **ön-dolgu** olarak önerir (`GET /machine-runs/tablet-context`). Bu, bugün sahadaki tek "bu tezgahta sıradaki iş bu" bilgisidir.
- **Panelde koşum ekranı YOK.** `loom:run` izni "ekransız" (yalnız API/tablet); koşumu bugün yalnız tablet açar (`dokuma.md`: "panel koşum yüzeyi yok").
- **Koşum kuralları (aynen geçerli kalacak):** hat başına tek açık koşum (DB seddi `machine_runs_one_open_per_prod_line_uq`); dolu hatta açmak 409 `PRODUCTION_LINE_OCCUPIED` (kim koşuyor söylenir), yarış 409 `MACHINE_RUN_RACE`; Dokuma İş Emri `PLANNED`/`IN_PROGRESS` ve `IN_HOUSE` olmalı (fason işe 400 `WEAVING_ORDER_SUBCONTRACTED`, kapalı işe 409 `WEAVING_ORDER_NOT_OPEN`); ilk koşum işi `PLANNED → IN_PROGRESS` yapar; `clientToken` ile tekrar gönderim güvenli (dört durumlu replay); koşumu geri almak **damga** (`revokedAt` + sebep, ayrı izin `loom:run-revoke`); kapatma tek yazar `closeMachineRunTx`. **Advisory kilit yok ve eklenmez** (`dokuma.md` 409 kodları maddesi).
- **Aynı Dokuma İş Emri birden çok tezgahta koşabilir** — engel yok (koşum başına `weavingOrderId`). Ama **işi tezgahlar arasında metreyle bölmek** için alan yok: `plannedM` işin tamamı içindir; koşumda "bu tezgahın payı" kolonu yok.

> **Sonuç:** "İş ata" düğmesinin arkasında iki farklı şey olabilir ve kullanıcının seçmesi gerekir (KARAR: ikisi birden, §E Kararlar 2):
> **(A) Şimdi başlat** = seçili tezgahlarda koşum aç (bugünkü varlık, yeni tablo yok).
> **(B) Sıraya koy / planla** = "bu iş bitince şu tezgahta şu iş" — **yeni bir varlık** gerektirir (§C.13).

### Modül kapısı uyuşmazlığı (ÖLÇÜLDÜ)
- Salon ekranı ve `GET /api/loom-floor`: `tezgahEnabled` + `loom:live-view` (salt okuma).
- Koşum, duruş, Dokuma İş Emri yazma uçları: **`dokumaEnabled`** (`machine-run.routes.ts`, `machine-stop.routes.ts` `router.use(verifyToken, requireDokumaEnabled)`).
- Levent takma/sökme: devere + `devere.mountTracking`.
⇒ Tezgah izleme açık ama dokuma kapalı bir fabrikada salon menüsünde **hiçbir yazma eylemi** çıkamaz (menü yalnız "Detay" ve rapor bağlantısı gösterir). Bu bir hata değil; menü her öğeyi kendi modülüne bağlamalıdır.

---

## A · Seçim etkileşimi

Bugün (ÖLÇÜLDÜ): kart bir `<button>`; tıklamak sağdan detay panelini açar (`LoomCard.tsx`, `WeavingFloorView.tsx` `selectedId`); TV kipinde tıklama etkisiz (`noSelect`). Seçim kavramı yok. Sağ tık menüsü için Radix `@radix-ui/react-context-menu` **zaten bağımlılıkta** (`Electron/package.json`, `components/ui/context-menu.tsx`); sürükle-seç kütüphanesi yok → **yeni paket gerekmeden** kendi küçük hook'umuzla yazılır (yeni paket onay ister; gerek yok).

| Hareket | Davranış |
|---|---|
| **Tek tık** | Bugünkü gibi detayı açar **ve** o tezgahı tek seçili yapar (önceki seçim düşer). Detay açılması seçim çubuğu belirmesini engellemez. |
| **Ctrl+tık** (Windows) / **Cmd+tık** (macOS) | Tezgahı seçime ekler/çıkarır; detay açmaz. |
| **Shift+tık** | Son "çapa" tezgahtan bu tezgaha kadar **aralık** seçer. Aralık = ekrandaki sıra (hol sırası, sonra tezgah numarası) — yalnız **görünen** (süzgeçten geçen) kartlar. Ctrl+Shift = aralığı mevcut seçime ekler. |
| **Sürükle-seç (lasso)** | Kartların **arasındaki boş alanda** (hol başlığı dışı) sol tuşa basılı tutup sürükleyince yarı saydam dikdörtgen çizilir; dikdörtgene **değen** kartlar seçilir. Ctrl/Cmd basılıysa mevcut seçime eklenir, değilse seçim yenilenir. 4 px'ten kısa sürükleme tık sayılır (yanlışlıkla seçim olmasın). Kart üstünden başlayan sürükleme lasso başlatmaz (ileride kartı plana sürüklemek için ayrılır). Sayfa kenarına gelince otomatik kaydırma. |
| **Ctrl/Cmd+A** | Görünen bütün tezgahlar (süzgeç "Duranlar" ise yalnız duranlar). Odak bir yazı kutusundaysa tarayıcı varsayılanı çalışır. |
| **Hol başlığına çift tık** (ya da hol başlığı sağ tık → "Bu holü seç") | O holün görünen tezgahları. |
| **Esc** | Önce açık menüyü/pencereyi kapatır; sonra seçimi bırakır; tam ekranda üçüncü Esc tam ekrandan çıkar (bugünkü davranış korunur). |
| **Klavye** | Kartlar ızgarada ok tuşlarıyla gezilir (tek odak noktası, "roving tabindex"); **Boşluk** seç/bırak, **Shift+ok** aralığı genişlet, **Enter** detay, **Menü tuşu / Shift+F10** sağ tık menüsü. Ekran okuyucuya kart `aria-selected`, ızgara `role="grid"` + `aria-multiselectable`. |
| **Dokunmatik** (dokunmatik monitörlü panel, tablet tarayıcı) | **Uzun bas (~500 ms)** = seçim kipine gir + o kartı seç; seçim kipindeyken tek dokunuş ekle/çıkar; seçim çubuğunda "Bitti". Lasso dokunmatikte YOK (kaydırmayla çakışır). Sağ tık menüsünün karşılığı: seçim çubuğundaki "⋯" düğmesi. |
| **TV kipi** | Seçim, menü, lasso **YOK** (bugünkü "dokunuş detay açmaz" kuralı aynen). TV hesabı zaten salt okur. |
| **Seçim çubuğu** | Seçim ≥1 iken altta (tam ekranda da) yapışık çubuk: **"3 tezgah seçili · İş ver · Duruş bildir · Duruşu kapat · ⋯ · Seçimi bırak"**. Çubuktaki düğmeler sağ tık menüsüyle **aynı listeden** üretilir (tek kaynak; bir yerde görünen eylem öbüründe de görünür). Uygun olmayan tezgah varsa düğmede rozet: "İş ver (2 uygun / 3)". |
| **Canlı tazeleme** | Ekran 5 sn'de bir tazelenir (`useLoomFloorLive`). Seçim **tezgah kimliğiyle** (id) tutulur, kart sırası/durumu değişse de korunur. Tezgah listeden düşerse (pasife alındı) sessizce seçimden çıkar ve çubuk "1 tezgah artık listede yok" der. Süzgeç değişince görünmeyen seçili tezgah **seçimde kalır** ama çubuk "2'si bu süzgeçte görünmüyor" yazar (eylem onlara da uygulanacağı için gizli kalmamalı). Bir eylem penceresi açıkken o pencere **kendi anlık kopyasıyla** çalışır; tazeleme pencerenin listesini değiştirmez, son kararı sunucu verir. |
| **Hat (çift enli tezgah)** | Seçim **tezgah** düzeyindedir; iş verme penceresi `productionLineCount > 1` olan tezgahta hat sorar (hat 1 / hat 2 / ikisi). Tek hatlı tezgahta hat sorusu çizilmez (bugünkü tablet kuralının aynası). |

---

## B · Sağ tık menüsü

Kural: menü **görünen** öğe ile **pasif** öğeyi ayırır.
- Modül kapalı ya da izin yoksa öğe **hiç görünmez** (kapalı modülün yüzeyi olmaz — `test_dokuma_regime_gate §7` ruhu).
- Modül/izin var ama bu tezgah için uygun değilse öğe **pasif + neden** ("Açık duruş yok", "Levent takip kapalı").
- Çoklu seçimde öğe, seçimin **en az birine** uygunsa aktiftir; pencere uygun olmayanları ADIYLA ayrıca listeler (§C.3).
- Son kararı her zaman sunucu verir; menü yalnız önden süzer (izin guard'ı fail-closed, `clientType` güvenlik sınırı değil).

| Öğe | Tek tezgah | Çoklu | İzin (bugün var) | Modül | Not |
|---|---|---|---|---|---|
| **Detay** | ✓ | — | `loom:live-view` | tezgah | Bugünkü sağ panel. |
| **İş ver / Şimdi başlat** (koşum aç) | ✓ | ✓ | `loom:run` | dokuma | Boş hatta. §C. |
| **İşi değiştir** (koşumu kapat + yenisini aç) | ✓ | ✓ | `loom:run` | dokuma | Dolu hatta. Önizlemeli. |
| **İşi bitir** (koşumu kapat) | ✓ | ✓ | `loom:run` | dokuma | Atkı sayacı sorulur, boş = ölçülmedi. Dokuma İş Emrini KAPATMAZ (iş kapanışı ayrı karar). |
| **Koşumu geri al** (yanlış açıldı) | ✓ | — | `loom:run-revoke` | dokuma | Sebep zorunlu; tek tezgah (geri alma toplu yapılmaz — §C.10). |
| **Sıraya koy** (planla) | ✓ | ✓ | **YENİ izin** önerilir (`loom:plan`) | dokuma | Karar 2 gereği; F5. |
| **Duruş bildir** | ✓ | ✓ | `loom:manual-entry` | dokuma | Sebep isteğe bağlı; toplu örnek: elektrik kesintisi, holde bakım. |
| **Duruşu kapat** ("Çalıştı") | ✓ | ✓ | `loom:manual-entry` | dokuma | Yalnız açık duruşu olanlarda aktif. |
| **Sebep ata** | ✓ | ✓ (aynı sebep) | `loom:classify` | dokuma | Sebep bekleyen duruşta. |
| **Planlı bakım başlat** | ✓ | ✓ | `loom:manual-entry` | dokuma | Ayrı varlık değil: sebebi `PLANLI_BAKIM` (kayıp sınıfı PLANNED) olan duruş [ÖLÇÜLDÜ `reason-presets.ts:256`]. "Bakım" ayrı modül [YOK]. |
| **Levent tak / sök** | ✓ | — | `warpbeam:write` | devere + `devere.mountTracking` | Tak tek tezgah + yuva ister; çoklu anlamsız. |
| **Leventi işe bağla** | ✓ | — | `warpbeam:write` | devere | Takılı leventin `weavingOrderId`si — tabletin ön-dolgu kaynağı. |
| **Tezgah karnesi / raporlar** | ✓ | ✓ (seçili tezgahlarla süzülü) | `report:production` | dokuma | `reports/dokuma`ya geçiş. |
| **Duruş listesi** | ✓ | — | `loom:manual-entry` ∨ `loom:classify` | dokuma | `operations/machine-stops?machineId=…`. |
| **Künye / izleme hâli** | ✓ | — | `loom:spec-manage` | dokuma | Tezgah künyesi. |
| **Dokuma İş Emrini aç** | ✓ (iş varsa) | — | `weavingorder:read` | dokuma | Dokuma İş Emirleri ekranında o satır. |
| **Seçimi bırak / Bu holü seç** | ✓ | ✓ | — | — | |

SoD: hiçbir öğe `shipping:invoice`, `shipping:undo-dispatch`, `roll:manual-adjust` gerektirmez. **Yeni izin yalnız (B) planlama için**, reçeteyle (`docs/RECETELER.md` § route + izin; migration yazılmaz, boot uzlaştırması).

---

## C · Toplu iş verme senaryoları

**Genel sözleşme (öneri):** yeni uç `POST /api/machine-runs/bulk` (ve önizlemesi `POST /api/machine-runs/bulk/preview`) — **mevcut tek koşum yolunu satır başına çağırır, ikinci yazar açmaz** (`openMachineRun` / `closeMachineRunTx`). Emsal kurşun dağıtımı `POST /api/kursun-bypass/assign-bulk` [ÖLÇÜLDÜ]: *her satır kendi transaction'ında, sonuç parçalı olabilir, atlanan satır somut sebebiyle döner*. Ters emsal finans `allocations/bulk` hepsi-ya-hiç (satırlar tek dağıtımın parçası olduğu için). Tezgahlar birbirinden bağımsız olduğundan **kurşun emsali** doğrudur. Tavan 100 satır.

| # | Senaryo | Önerilen davranış |
|---|---|---|
| **C.1** | **Boş tezgaha iş verme** (tek ya da çoklu, tek iş) | Pencere: Dokuma İş Emri seç (açık + kendi tezgahımızda dokunan işler; fason işler listede yok — tablet kuralının aynası) → desen/renk işten **ön-dolu, kilitsiz** → hedef devir boş = künye nominali, o da yoksa "performans ölçülmez" → başlangıç saati varsayılan "şimdi" (amir beyanı; aralık dışı ise sunucu uyarır) → **Önizle** → **Başlat**. Her tezgahta bir koşum açılır; Dokuma İş Emri ilk koşumda "Devam ediyor"a geçer. |
| **C.2** | **Dolu tezgaha** (açık koşumu olan hat) | Varsayılan **reddetmez, sorar**, iki seçenek: **"Değiştir"** = mevcut koşumu şimdi kapat + yenisini aç (aynı tx; kapanış atkı sayacı sorulur, boş = ölçülmedi) · **"Sıraya koy"** = yalnız (B) varsa. Sessiz üzerine yazma YOK. Aynı işi zaten koşan tezgah önizlemede "zaten bu işte" diye ayrı satır, varsayılan seçim dışı. Değiştir yıkıcı sayılır → önizleme zorunlu (C.11). |
| **C.3** | **Karışık seçim** (bazısı boş, bazısı dolu, duruşta, bakımda, leventsiz, "veri yok") | Önizleme her tezgahı **ayrı satırda ve adıyla** gösterir, satır başına onay kutusu: ✅ uygun · ⚠️ uygun ama uyarılı (leventsiz/eksik yuva — bugün de yalnız UYARI, `runOpenBeamWarning`; açık duruşta — koşum açılır, duruş açık kalır; "Veri yok" tezgah) · ⛔ uygun değil (pasif tezgah, kapalı hat, mühürlü vardiya değil — koşumda mühür kapısı yok). Dolu tezgah C.2'deki seçimi satır başına sunar. Uyarılı satır **varsayılan seçili**, ⛔ seçilemez. |
| **C.4** | **Tezgah ↔ iş uyumsuzluğu** (en, ağızlık/jakar-armür, tezgah tipi, çözgü) | **Bugün ölçülebilen tek uyum:** takılı leventin çözgü kartı ↔ işin çözgü kartı (devere açıksa) — UYARI, red değil (levent↔iş bağındaki `WARP_SPEC_MISMATCH` emsali). **Ölçülemeyenler [YOK]:** tezgahın tarak eni/azami eni (Machine'de kolon yok), tezgah tipi (hava jetli/kancalı; ekranda `loomType` hep null), kumaşın gerektirdiği ağızlık türü (künyede `shedType` VAR, işte/kumaşta karşılığı YOK), çözgü kartında `reedWidthCm` VAR ama tezgahta karşılığı yok. ⇒ Faz 1'de uyumsuzluk **yalnız çözgü kartı uyarısı**; tam uyum kontrolü ayrı faz (tezgah künyesine en + tip, kumaş kartına ağızlık; yeni kolonlar BaseController'da yazılabilir alan doğurur → açıkça karar). Yeni kontroller her zaman **önce uyarı** (bayrak varsayılanı = bugünkü davranış); sert red istenirse ayrı bayrak. |
| **C.5** | **Bir işi birden çok tezgaha bölme** (metre paylaştırma) | Aynı işle N tezgahta koşum açmak **bugün mümkün**. **Metre paylaştırma için alan YOK.** Seçenekler: (a) paylaştırma yok — iş tek havuz, ilerleme tüm tezgahların toplamı (sıfır şema); (b) koşuma "bu tezgahın hedef metresi" kolonu (bilgi amaçlı, kapanış tetiği değil — `plannedM` gibi "hedef, tetik değil"); (c) işi alt işlere bölmek (N ayrı Dokuma İş Emri). Öneri **(a) Faz 1**, gerekirse (b). (c) belge çoğaltır, reddedilmeli. Önizleme "eşit böl" düğmesi yalnız (b) seçilirse anlamlı. Not: metre↔levent çevrimi take-up ister ve **"bu iş kaç levent eder" hesaplanmaz** (`dokuma.md`). |
| **C.6** | **Birden çok işi birden çok tezgaha** | Pencerede iki sütun: solda seçili tezgahlar, sağda iş seçici; her tezgah satırında iş açılır listesi + "hepsine aynı işi uygula" kısayolu. (B) varsa sürükle-bırak eşleme (dnd-kit zaten bağımlılıkta) ikinci adım. Gönderim tek istek, satır başına bağımsız sonuç. |
| **C.7** | **Kısmi başarı** (5'ten 3'ü oldu) | Sonuç ekranı üç liste: **Başladı** (3, tezgah adıyla) · **Olmadı** (2, tezgah adı + Türkçe sebep: "TZ-07 hat 1'de az önce başka koşum açıldı — tekrar deneyin") · **Uyarılar** (sunucu `warnings` metni olduğu gibi). "Olmayanları yeniden dene" düğmesi yalnız başarısızları yeniden gönderir (aynı satır token'larıyla — C.12). Sessiz kısmi başarı yok (iade toplu ucu emsali `failed/skipped` açık döner). |
| **C.8** | **Eşzamanlı iki kullanıcı** (iki amir aynı tezgaha) | Mevcut sedler yeter: kaybeden satır 409 `PRODUCTION_LINE_OCCUPIED` (önceden görülürse; kimin koşumu olduğu söylenir) ya da `MACHINE_RUN_RACE`. "Değiştir"de kapatma claim'i `WHERE closedTermsAt IS NULL` → ikinci kişi `RUN_ALREADY_CLOSED` alır, yeni koşum açılmaz. Tablet operatörüyle panel amiri yarışı aynı sedde biter. Dokuma İş Emri aynı anda iptal edilirse: koşum açılışı iş satırını claim'le kilitler (mevcut sözleşme) → `WEAVING_ORDER_NOT_OPEN`. |
| **C.9** | **Kilit sırası** | Satır başına ayrı tx (kurşun emsali) ⇒ satırlar arası kilit çakışması yok. "Değiştir" tek tx içinde sıra: **eski koşum kapatma claim'i → (iş varsa) Dokuma İş Emri claim'i → yeni koşum INSERT**. Advisory kilit **eklenmez** (mevcut karar: koşum açılışında advisory kilit yoktur). Satırlar istemcide değil **sunucuda** tezgah koduna göre sıralanır (belirlenimli çıktı). PG 40P01/40001 → satır 409 "tekrar deneyin". `tx.*` çağrıları `Promise.all` ile paralel yapılmaz; satırlar sırayla işlenir. |
| **C.10** | **Geri alma** | Yanlış verilen iş = **koşumu geri alma damgası** (`revokedAt`, sebep zorunlu, `loom:run-revoke`) — satır silinmez, ileri kayıt değişmez. "Değiştir"in geri alınması = yeni koşumu geri al; **kapatılan eski koşum yeniden açılmaz** (kapanış bir olaydır; yeniden başlatmak için yeni koşum açılır). İşi "PLANNED"a döndürme yok (ilk koşum işi IN_PROGRESS yapar, ters yolu kapsam dışı — Dokuma İş Emri deftere yazmaz). Toplu geri alma **önerilmez** (Faz 1'de yok): her geri alma randıman paydasını değiştirir, tek tek sebep istenir. İstenirse sonuç ekranında "bu toplu işlemi geri al" = aynı sebeple N geri alma, önizlemeli. Koşumdan sonra indirme (doff) yazılmışsa geri alma yine mümkün ama önizleme "bu koşuma bağlı N indirme var" diye ADIYLA söyler [VARSAYIM: mevcut geri alma bunu engellemiyor; ölçülecek]. |
| **C.11** | **Önizleme ekranı** (yıkıcı kural) | "Değiştir", "İşi bitir", "Duruş bildir" (toplu) ve geri alma önizlemelidir: sunucu önizleme ucu **her tezgahı adıyla** döner (tezgah · hat · şu anki iş · yeni iş · olacak şey · uyarı/engel), arayüz satır başına seçim sunar; "5 tezgah etkilenecek" gibi soyut sayı yetmez. Boş tezgaha başlatma yıkıcı değildir ama aynı önizleme kullanılır (karışık seçimde zaten gerekli). |
| **C.12** | **Tekrar gönderim güvenliği** (clientToken) | Mevcut `MachineRun.clientToken` yeter, **yeni token tablosu yok**: istemci her satır için **mantıksal deneme başına bir** token üretir; bağlantı koparsa aynı istek aynı token'larla yeniden gider ve açılmış koşumlar **özgün sonuç** olarak döner (replay; geri alınmış koşum `RUN_REVOKED`). Token yalnız belirsiz hatada (ağ/zaman aşımı/5xx) yapışır, kesin 4xx'te yeni deneme yeni token. "Değiştir" için kapatma tarafının token'ı yok (kapanış claim'i doğal olarak tekrar güvenli: ikinci kez `RUN_ALREADY_CLOSED` → satır "zaten yapılmış" sayılır) [VARSAYIM: replay cevabında kapanışı "başarı" saymak için satır tipine özel işleme gerek; tasarım dilimi]. |
| **C.13** | **Sıraya koyma / planlı iş** | Yeni varlık önerisi `LoomJobPlan` ("tezgah iş planı"): tezgah · hat · Dokuma İş Emri · sıra · not · planlayan · `clientToken`; durum PLANNED → STARTED (koşum açılınca, koşum id'siyle) / CANCELLED (soft, sebep). **Kurşun dağıtım tablosunun** (`KursunBypassAssignment`: append-only + soft-cancel + "bir adımda en fazla bir açık atama" partial unique) birebir emsali. Plan deftere yazmaz, stok/rapor sayısı değiştirmez ⇒ durum tablosu; iptal durum geçişi. Tablet **sırayı göstermez**, yalnız "sıradaki önerilen iş"i koşum açarken **ön-dolgu** olarak verir (Z5: öneri kilitlemez) — "kuyruk değil tezgah" kuralı korunur. Sıra değişikliği (yeniden sıralama) aynı tezgahın planlarında; numara/advisory gerekmez [VARSAYIM: sıra yarışı partial unique + claim ile; envanter `test_advisory_lock_namespaces` ölçer]. |
| **C.14** | **Audit** | Her açılan/kapatılan koşum bugünkü gibi kendi audit kaydını yazar (tx dışında, best-effort). Toplu işlemin kendisi için ek olarak **tek özet audit** ("toplu iş verme: 5 istendi, 3 başladı") — iş kararına girmez, yalnız ayak izi; sonuç ekranı audit'ten okunmaz, cevaptan okunur. |
| **C.15** | **Çevrimdışı / bağlantı kopması** | Panelde kuyruk YOK (tablet koşum mutasyonları da online-only — `useRunMutations.ts` kararı). Bağlantı yoksa "İş ver" düğmesi kilitli + neden ("sunucuya ulaşılamıyor"). İstek giderken koparsa: sonuç belirsiz → pencere açık kalır, "Tekrar gönder" aynı token'larla (C.12) — çift koşum imkânsız. Salon zaten "Bağlantı yok — son veri HH:mm:ss" gösteriyor; o durumda bütün yazma eylemleri pasif. |
| **C.16** | **Mühürlü vardiya / geçmiş saat** | Koşum açılışında mühür kapısı yok; geçmiş başlangıç saati 36 sa penceresiyle sınırlı (dışı sunucu saatine düşer + uyarı). Duruş eylemleri mühürlü vardiyada 409 `SHIFT_SEALED` → satır "olmadı" listesine sebebiyle düşer. |
| **C.17** | **Dokuma İş Emri zorunlu ayarı** | `dokuma.runWeavingOrderRequired` açıksa işsiz koşum 400; pencere "işsiz (numune) koşum" seçeneğini bu ayar açıkken çizmez. Kapalıyken numune koşumu meşru. |

---

## D · Ticari üründe ne görmek isteriz

Esin: dokuma izleme/MES salon panoları (Loepfe/Barco tipi salon izleme, Picanol/Tsudakoma tezgah yönetim ekranları, genel MES "andon" panoları). Bunların ortak özellikleri aşağıda; **ürün adlarına dair ayrıntılar bellekten, doğrulanmadı** [VARSAYIM]. "Veri" sütunu bizim sistemde ÖLÇÜLDÜ.

| # | Özellik | Değer | Veri bugün var mı (ÖLÇÜLDÜ) | Maliyet | Bağımlılık |
|---|---|---|---|---|---|
| D1 | **Kartta iş no + kumaş + renk** | Yüksek | VAR (`looms[].job`, yalnız dokuma açıkken; ilk hattın koşumu) | S | — |
| D2 | **Kalan metre / ilerleme çubuğu** (iş bazında) | Yüksek | Plan metre VAR; **üretilen metre YOK** (ekranda `producedM` hep null; iş detayında yalnız top SAYISI — `countRollsOfWeavingOrder`). Doff→top metresi zinciri var, toplanmıyor. | M | Backend toplayıcı (top metresi Σ, iki sayı kuralı: ÜRETİLEN ≠ TEZGAHTA) |
| D3 | **Tahmini bitiş saati** | Yüksek | YOK — hız ölçümü (devir/metre) yok | M→L | D2 + sensör (Faz 2) ya da koşum hedef devir × atkı/cm (tahmini, "tahmini" etiketiyle) |
| D4 | **Anlık devir (RPM) / verim %** | Yüksek | Hedef devir VAR; **anlık devir YOK** (`rpm: null`); "bugün %" (süre payı) VAR | L | Sensör/toplayıcı Faz 2 (`MachineInterval` yok) |
| D5 | **Operatör adı** | Orta | **Ölçülebilir:** tablet oturumu (`WorkSession`: kullanıcı + makine + açık/kapalı) VAR; salon ucu okumuyor | S | — |
| D6 | **Levent kalan metre** | Yüksek | VAR (devere + `mountTracking` açıkken; kart rozeti + detay) | — | Bayrak |
| D7 | **Levent bitiş uyarısı** ("TZ-12 leventi ~3 saatte biter") | Yüksek | Kalan VAR, tüketim hızı YOK | M | D4 ya da doff geçmişinden ortalama |
| D8 | **Süzgeç / gruplama** (hol, durum, iş, kumaş, tip) | Orta | Hol (istasyon) + durum VAR; iş/kumaş VAR; tezgah tipi YOK | S (hol/durum/iş) · M (tip) | Tip için künye kolonu |
| D9 | **Gerçek salon yerleşimi** (sürükleyerek konum) | Orta | YOK; kullanıcı kararı 2026-10-09 "gerçek kat planı YOK" (`DOKUMA-CANLI-EKRAN.md` §8 karar 3) | M | **Karar değişikliği gerekir** (§E Kararlar 5: numara sırası kalır) |
| D10 | **Uyarı/eskalasyon zinciri** (görevli → patron) | Yüksek | Hedef süre + pay VAR, kademe hesaplanıyor; **bildirim gönderimi, görevli ataması YOK** | L | Mobil push + patron bulutu iletimi; tezgah eskalasyon vizyonu (kullanıcı 2026-10-09) |
| D11 | **Vardiya görünümü** (bu vardiya metre/hedef, vardiya değişimi) | Orta | Vardiya adı/saati VAR; vardiya sayaçları YOK (`shift: null`); karne vardiya sonunda VAR | M | Sensör ya da elle koşum kapanışı |
| D12 | **TV rotasyonu** (holler/sayfalar sırayla, 20 sn) | Orta | TV kipi VAR, rotasyon YOK | S | — |
| D13 | **Seçimden rapora geçiş** (seçili tezgahların karnesi/Pareto'su) | Orta | Raporlar VAR (`reports/dokuma`, `machineId` süzgeci tek tezgah) | S (tek) · M (çoklu süzgeç) | Rapor uçlarına çoklu tezgah süzgeci |
| D14 | **Mobil/tablet salon görünümü** (amir telefonu) | Orta | YOK (tablet tezgah ekranı tek tezgah) | M | Mobil ekran reçetesi |
| D15 | **Duruş geçmişi zaman çizelgesi** (Gantt: tezgah × saat) | Yüksek | Duruş + koşum defterleri VAR | M | — |
| D16 | **Planlama panosu** (tezgah × zaman, işleri sürükle) | Yüksek (ticari fark) | YOK (plan varlığı yok) | L | F5 + D3 |
| D17 | **Sebep bekleyen duruş rozeti** | Orta | VAR (`requiresReason`) | S | — |
| D18 | **Toplu duruş bildirimi** (elektrik kesintisi) | Yüksek | Tek tek VAR | S | Bu belge §C sözleşmesi |

Öncelik önerisi: **D1-D5-D17-D18** (ucuz, veri var) → **D2-D15-D12** → **D7-D11-D13** → **D16** → **D3-D4-D10** (sensör/bildirim fazları) → D9 yalnız karar değişirse.

---

## E · Dilimleme ve kararlar

### Fazlar (her faz kendi başına teslim edilir; "backend önce")

| Faz | Teslim | Yeni şema? | Not |
|---|---|---|---|
| **F1 — Seçim + menü iskeleti** | Tık/Ctrl/Shift/lasso/Ctrl+A/Esc/klavye/uzun bas, seçim çubuğu, sağ tık menüsü; eylemler: Detay, raporlara geçiş, duruş listesine geçiş. TV'de kapalı. | Hayır | Salt istemci. Menü öğelerinin görünürlüğü saf yüklemle (bekçi testli). |
| **F2 — Duruş eylemleri (tek + toplu)** | Duruş bildir / kapat / sebep ata / planlı bakım, önizlemeli toplu ([C.3, C.7, C.11]) | Hayır | Mevcut uçlar satır başına; toplu uç ya da istemci döngüsü (karar tasarım diliminde; toplu uç önerilir — tek önizleme kaynağı). |
| **F3 — İş ver (A: şimdi başlat)** | `POST /machine-runs/bulk` + `/bulk/preview`; İş ver / Değiştir / Bitir / Geri al (tek); sonuç ekranı; salon ucuna operatör (D5) ve dolu/boş hat bilgisi | Hayır | Panelde koşum yüzeyi doğar → `loom:run` "ekransız"dan çıkar (dört kapı reçetesi; `test_dokuma_regime_gate §7` allowlist'e yeni istemci dosyası). |
| **F4 — Üretilen metre + kart bilgileri** | İş başına ÜRETİLEN metre (D2), kalan, levent bitiş tahmini (D7, "tahmini" etiketli), D12 TV rotasyonu | Hayır | İki sayı kuralı: ÜRETİLEN (top ölçümü) ile TEZGAHTA (türetilen) toplanmaz. |
| **F5 — Sıraya koy (karar 2)** | `LoomJobPlan` varlığı + izin `loom:plan` + kart üzerinde "sıradaki: DK…" + tablet ön-dolgu | **Evet** | Migration reçetesi, en eski canlı dump'ta prova. |
| **F6 — Uyum kontrolleri** | Tezgah künyesine en + tip, kumaş kartına ağızlık; önizlemede uyarı | **Evet** | Varsayılan uyarı; sert red ayrı bayrak (varsayılan kapalı). |
| **F7 — Planlama panosu** (D16), Gantt (D15) | Tezgah × zaman | F5'e bağlı | |
| Sonra | RPM/verim canlı (D4), eskalasyon bildirimi (D10) | Sensör Faz 2 · bildirim altyapısı | |

### Kararlar (kullanıcı, 2026-10-11)

1. **İsim.** `WeavingOrder` ekranda/belgede **"Dokuma İş Emri"**, `WorkOrder` (KK1 → Kurşun → Tambur → Depo yolu) **"Terbiye İş Emri"**. Yalnız görünen ad değişir; model/kod adları, numaralar (doğuşta materyalize, eski numaralar aynen) ve izin kodları değişmez. Uygulama ayrı dilim.
2. **"İş ver" İKİSİ BİRDEN:** "şimdi başlat" (koşum açar) VE "sıraya koy" (yeni plan varlığı; tablet yalnız ön-dolgu önerisi alır, kuyruk göstermez). Fazlama: önce şimdi başlat (F3), sonra sıraya koy (F5). Böylece F5 artık koşulsuzdur.
3. **Dolu tezgaha iş verilince SORAR** ("eskisini bitirip yenisini başlatayım mı?"), önizlemeli; sessiz üzerine yazma yok.
4. **Bir işi birden çok tezgaha verince metre BÖLÜNMEZ:** iş tek havuz, toplam ilerleme; tezgah başına pay alanı yok.
5. **Yetki (1e, yetki devri):** salonda iş verme = mevcut `loom:run`; sıraya koy için yeni izin `loom:plan` (izin reçetesiyle). Salon dizilimi numara sırası kalır (2026-10-09 kararı geçerli).

## Ek · Ölçüm kaynakları (dosya)
- `Teks-Erp/prisma/schema.prisma`: `WeavingOrder`, `MachineRun` (sedler yorumda), `Machine` (`productionLineCount`, `warpBeamSlots`; en/tip yok), `MachineSpec` (`shedType`, `nominalUnitsPerMin`), `WarpSpec` (`reedWidthCm`), `WorkSession`, `KursunBypassAssignment`
- `Teks-Erp/src/routes/loom-floor.routes.ts`, `services/loom-floor.service.ts`, `helpers/loom-floor.helper.ts`
- `Teks-Erp/src/routes/machine-run.routes.ts`, `services/machine-run.service.ts`, `helpers/machine-run-open.helper.ts`
- `Teks-Erp/src/routes/machine-stop.routes.ts`, `warp-beam-mount.routes.ts`, `kursun-bypass.routes.ts` (assign-bulk), `finance-allocation.routes.ts` (bulk)
- `Teks-Erp/src/constants/permission-catalog.ts` (loom:*, weavingorder:*, warpbeam:*), `constants/reason-presets.ts:256`
- `Electron/src/pages/Operations/WeavingFloor/` (`WeavingFloorView.tsx`, `LoomCard.tsx`, `types.ts`, `fromApi.ts`, `useLoomFloorLive.ts`), `Electron/package.json`
- `docs/kurallar/dokuma.md`, `docs/design/DOKUMA-CANLI-EKRAN.md` §2, §5, §8, `docs/design/DOKUMA-IS-EMRI-VE-TABLET-TASARIMI.md` §2, §3.2
- Okunmadı (bağlam bütçesi): `is-emri.md`'nin tamamı, `defter.md`, `yetki-izin.md`, `modul-bayrak.md` (çekirdek kurallar kök `CLAUDE.md`'den uygulandı); `DOKUMA-TEZGAH-IZLEME-TASARIMI.md` yalnız başlıklar.
