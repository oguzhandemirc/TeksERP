# Token replay kilidi — kilitsiz ön-okuma sınıfı ve kapatma planı

> **Durum:** KARARLANDI (kullanıcı, 2026-09-26 sabah): planın TAMAMI — §6 S1–S5 hepsi (A). Uygulama sırası D1 → D2 → D3 → D4, her dilim ayrı tren. **D1 İNDİ** (tren 22: #6 levent tüketimi R + tek kilitli kalan okuyucu · #10 hızlı sipariş K · #11 elle sipariş no R); **D2 ve D3 İNDİ** (tek boğaz + 12 kalan yol); D4 istemci dilimi.
> **Ölçüm tabanı:** origin `c7e5c059`, statik okuma. Üç ölçüm ajanı 19 yolun sunucu + panel + tablet
> akışını okudu; kritik iddialar elle doğrulandı (#6, #10, #11, §5'in 1–2. maddeleri). Satır
> numaraları bu tabandadır.
> **İlk vaka kapandı:** çek teslim bordrosu. Kaybeden `ALREADY_IN_ACTIVE_NOTE` alıyordu, panel token'ı
> bırakıyor ve onay bandından ikinci BRD kesilebiliyordu. Tren 20'de `lockClientTokenTx` ile kapanıyor
> (advisory 8036, `services/helpers/token-replay.helper.ts`); bekçisi `test_cek_bordro_taslak_token` ③c.

## 1. Sınıf

Aynı `clientToken`lı ikinci deneme, yani zaman aşımı tekrarı ya da çift dokunuş, replay cevabı yerine
iş kuralı 4xx'i alır. Replay cevabı iki biçimdir: aynı gövdede önceki kayıt, farklı gövdede 409
`CLIENT_TOKEN_COLLISION`. Üç bileşen birlikte gerekir:

1. **Kilitsiz ön-okuma.** Token tx dışında okunur, ya da tx içinde ama aynı token'lı denemeleri
   serileştiren bir kilitten/claim'den ÖNCE okunur. READ COMMITTED'da her ifade yeni anlık görüntü
   alır; kazanan henüz commit etmemişse okuma boş döner.
2. **Kazananın commit'ine bağlı iş kuralı.** Okuma ile insert arasında, kazananın yazdığı satırları
   okuyan bir kontrol ya da claim çalışır ve kaybeden onu görüp düşer.
3. **Dar catch.** Catch yalnız token P2002'sinde yeniden okur, ya da hiç catch yoktur. İş kuralı
   hatası istemciye olduğu gibi gider.

Sınıfın iki uç biçimi:
- **Sıralı biçim (#11).** Kural token işleminden önce koşar. Yarış bile gerekmez; sıradan tekrar da düşer.
- **İki-tx biçimi (#10).** Kazananın kurala giren yazımı, token satırından ÖNCE ayrı bir tx'te commit
  olur. Bu biçimde "hatada token'ı yeniden oku" kalıbı pencereyi kaçırır (§3).

**Sınıf dışı (ölçüldü):**
- Token satırı tx'in ilk yazımı: kartela `reduceStock`.
- Token önce claim edilir: import `apply`.
- Hiç ön-okuma yok, P2002 yeniden okur: KK1 ilk giriş ve açık kumaş.
- Her hatada yeniden okur: fason kabul (`subcontractor.service.ts:2556`).
- Kural kazananın satırıyla düşemez: Doff, Payment, Cheque, PurchaseOrder, WarpBeam, WorkOrder.create.

## 2. Zarar ölçeği — yol başına

- **(a)** Yalnız yanıltıcı bir 4xx; mükerrer kayda giden yol yok. Kural aynı veriyi zaten reddeder,
  ya da istemci token'ı koruduğu için sonraki basış replay alır.
- **(b)** 4xx → istemci yeni token üretir (ya da ekran yeniden kurulur) → kullanıcı ısrar eder →
  aynı mantıksal denemeden İKİNCİ kayıt/etki çıkar. Bordro (b) idi.

Sahada üç istemci token politikası var:
- **P1 — panel `tokenAfterFailure`:** kesin 4xx'te yeni token.
- **P2 — tablet `entryAttempt`:** yalnız belirsiz hatada (ağ/5xx) 90 sn parmak iziyle yapışır; her
  4xx'te yeni token (`mobil/src/offline/entryAttempt.ts:254`).
- **P3 — diyalog/ekran başına token:** hatada korunur, yalnız başarıda ya da yeniden açılışta döner.

| # | Yol · ön-okuma | Kaybedenin cevabı | İstemci | Zarar |
|---|---|---|---|---|
| 6 | levent `consumeBeam` · `warp-beam-consume.service.ts:51` (tx dışı) | yakalanmayan token P2002 → kodsuz 409 "Bu 'clientToken' değeri zaten mevcut"; ya da `WARP_BEAM_REMAINING_EXCEEDED` | tablet P2, modal açık kalır (`useBeamPanel.ts:89`); panel P3 | **(b)** Kodsuz 409'dan sonra Kaydet'e tekrar basılır, yeni token gider ve levent İKİ KEZ düşer. "Metreyi düşürün" mesajında ise kısaltılmış İKİNCİ düşüm yazılır. Panelde yalnız kapat-aç ile. |
| 10 | hızlı sipariş `quickOrderFromRolls` · ön-okuma yok; top claim'i AYRI tx (`order.service.ts:2320`), sipariş+token sonra (`:2348`) | 409 "…hızlı sipariş açılmadı, tekrar okutup deneyin". Mesaj YANLIŞ: sipariş var. | tablet P3 (`HizliSiparisScreen.tsx:48`) | **(b)** Ekran yeniden açılır, yeni token gider. WAREHOUSE toplar okutulabildiği için claim atlanır ve aynı satırlı İKİNCİ sipariş açılır. |
| 11 | sipariş `create`, elle numara · `order.service.ts:2074` clash kontrolü token'dan ÖNCE | SIRALI tekrarda da 409 "'X' numaralı sipariş zaten var" | panel P3, 409 alan hatasına döner (`OrderFormDialog.tsx:137`) | **(b)** Kapat-aç + yeni numara ikinci siparişi açar. Diyalog içinde yeni numara + aynı token eski siparişi sessizce döndürür ve "oluşturuldu" der. |
| 8 | top kesimi `cutWarehouseRoll` · `tambur.service.ts:2180` (tx dışı) | 400 `TAMBUR_CONSUMED` / aşım; 409 `ROLL_CHANGED_DURING_CUT` | tablet P3 (`recutTokenRef`) | (a), zayıf (b): ekran yeniden kurulursa ve aşım bayrağı açıksa ikinci kesim. |
| 9 | açık kumaş kesimi `cutOpenFabric` · `tambur.service.ts:3062` | 400 aşım / 409 `ROLL_CHANGED_DURING_CUT` | tablet P3 (`cutTokenRef`) | #8 ile aynı. |
| 18 | kasa hareketi `create` (açılış; negatif kasa bayrağıyla gider) · `cash-transaction.service.ts:188` | 409 "açılış zaten girilmiş" / bakiye 409 | panel P3 | (a), zayıf (b): mesaj "tutarı düzeltin" diyor; kapat-aç + düzeltilmiş tutar ikinci gideri yazar. |
| 19 | kasa virmanı · `cash-transaction.service.ts:323` | bakiye 409 | panel P3 | #18 ile aynı. |
| 1 | sevkiyat `createShipment` · `shipping.service.ts:2292` (tx dışı) | 409 "Çuvallardan biri zaten bir sevkiyatta" (`:1963`, kodsuz) | panel P3; tablet `shipTokenRef` yalnız başarıda döner | (a): çuval havuzdan çıktı; aynı token replay alır. |
| 2 | hızlı sevk `createShipmentFromRolls` · `shipping.service.ts:2712` | 400 "zaten bir sevkiyatta"; tx içi claim 409 | panel **her tıklamada yeni token** (`QuickShipDialog.tsx:119`) | (a), yarış bugün ulaşılamaz; mükerreri kural engelliyor. |
| 3 | levent takma `mountBeam` · `warp-beam-mount.service.ts:66` | 409 `WARP_BEAM_STATE` / `WARP_SLOT_BUSY` | panel P3; tablet P2 | (a): levent MOUNTED. |
| 4 | levent sarım `windWarpBeam` · `warp-beam-wind.service.ts:110` | 409 `WARP_BEAM_STATE` (claim) | panel P3; tablet P2 | (a): levent READY. |
| 5 | levent iadesi `returnWarpBeam` · `subcontractor-beam.service.ts:164` (tx içi, kilitsiz) | 409 `WARP_BEAM_STATE` | panel P3; tablet **her dokunuşta yeni token** (`useFasonDokuma.ts:69`) | (a) |
| 7 | tezgah koşumu `openMachineRun` · `machine-run.service.ts:145` | 409 `PRODUCTION_LINE_OCCUPIED` (tx öncesi `:160`) | tablet P3, liste tazelenir | (a) |
| 12 | `quickStart` · `workorder.service.ts:1432` | 400 "Yalnız envanterdeki…" (dar pencere) | panel + tablet P3 | (a); token korunduğu için kendini onarır. |
| 13 | parti ekle `addBatch` · `workorder-batch-add.service.ts:211` | iş emri satır kilidinden sonra deterministik 400 `BATCH_ADD_REJECTED` | panel + tablet P1 | (a): toplar üretimde. |
| 14 | paketleme grubu `createWithSacks` · `packing-group.service.ts:189` (8034 okumadan sonra) | elle ad: 409 `PACKING_GROUP_NAME_TAKEN`; otomatik ad: yakalanmayan P2002 | panel P3 | (a): düzeltilmiş ad + aynı token kazananı döndürür. |
| 15 | çuval aç `openSack` (lot + elle ambalaj no) · `shipping.service.ts:516` (8033 okumadan sonra) | 409 `PACKAGE_NO_TAKEN` | panel P3 | (a) |
| 16 | depo transferi `create` · `warehouse-transfer.service.ts:106` | predicate'siz retry token P2002'sini 400'e çevirir | panel **her tıklamada yeni token** (`TransferFormDialog.tsx:80`) | (a), ulaşılamaz. |
| 17 | fatura taslağı (kaynak/fiş) · `invoice.service.ts:332` | 409 "zaten fatura var" / `GOODS_RECEIPT_ALREADY_INVOICED` | panel **her tıklamada yeni token** (`InvoiceFormDialog.tsx:525`); fiş yolu token'sız | (a), ulaşılamaz. |

**Özet:**
- Bordrodan sonra üç gerçek (b): #6, #10, #11.
- Dört zayıf (b): #8, #9, #18, #19.
- On iki (a). Bunların üçünde yarış bugün ulaşılamaz: istemci token'ı her tıklamada ürettiği için korunacak bir token yok. Bu, ayrı bir kusur (§5).
- Yolların hepsi replay cevabını bugünkü başarı biçiminde (200/201, ayrı `replayed` bayrağı yok) dönüyor ve ölçülen bütün istemciler onu başarı olarak işliyor. Yani 4xx'i replay'e çevirmek eski istemciyi kırmaz.

## 3. İki kalıp

**K — kilit (bordro kalıbı).** Tx'in ilk ifadesi `lockClientTokenTx(tx, token)`, yani
`pg_advisory_xact_lock(8036, hashtext(token))`. Ardından token okunur, sonra iş kuralı, claim ve
insert gelir. Değişkeni **K′**: aynı anahtarlı bir kilit ya da satır claim'i zaten varsa (#13, #14,
#15, #17-fiş, #18, #19), token okumasını onun ARKASINA taşımak yeter.

**R — hatada yeniden oku (fason kabul kalıbı).** Çağrının tamamı sarılır. HER hatada token taze
okunur; kayıt varsa replay kararı döner (aynı gövde → önceki kayıt · farklı gövde → 409 · iptal edilmiş
→ `*_CANCELLED`), yoksa hata yeniden fırlatılır.

| Ölçüt | K | R |
|---|---|---|
| Tx öncesi kurallar (#1, #2, #7, #8, #9, #11, #12) | Kapatmaz; kural tx'e taşınmalı | Kapatır |
| Sıralı biçim (#11) | Kapatmaz; ayrıca sıra değişmeli | Kapatır |
| İki-tx biçimi (#10) | Claim ile sipariş TEK tx'e birleştirilirse kapatır | **Kapatmaz**: claim commit'lendi, token satırı henüz yok |
| Doğruluk şartı | Kural tx içinde, kilitten sonra | Kazananın token satırı ile kurala giren yazımı AYNI tx'te commit olmalı; #10 dışında hepsinde ölçüldü |
| Boşa iş | Yok; kaybeden bekler | Kaybeden kuralı koşup düşer |
| Kilit envanteri | 8036 (başka uzayla sıra ARTAN, 8036 en son) | Yok |
| Tek boğaz / bekçi | Yardımcı var; çağrı yeri AST'le aranabilir | Sarmalayıcı AST'le aranabilir |

R'nin bugünkü tek örneğinin kusuru: fason kabul (`subcontractor.service.ts:2556`) gövdeyi
KARŞILAŞTIRMIYOR. Aynı token + başka gövde "başarılı" döner. Ortak yardımcıya taşınırken gövde
kapısı ZORUNLU olmalı.

**Öneri:**
- **Varsayılan R.** Ortak sarmalayıcı `withTokenReplay(token, run, findPrior, resolve)`
  `token-replay.helper.ts`'e girer; `resolve` dört durumu ve gövde kapısını taşır.
- **#10'da K.** Claim ile sipariş tek tx olur, 8036 ilk ifadedir.
- **K′ fırsat olarak.** Kilit zaten varsa yalnız sıra değişir.

R'nin gerekçesi: yedi yolun kuralı tx dışında ve #11 sıralı. K bunları ancak yeniden yapılandırmayla
kapatır; R tek sarmalayıcıyla ve gelecekteki kurallar dahil kapatır.

## 4. Dilim sırası (etkiye göre)

Her dilimin bekçisi ③c tarzı **zorlanmış sıra** testidir: B token'ı okuyup ilk kural okumasında
bekletilir, A koşar; kapı A bitince ya da A PG kilidinde beklerken açılır. Bekçi yükten bağımsız,
belirlenimli kırmızı verir. Bordroda eski yük testi aynı hatayı 10 koşumda 0 kez yakaladı. Negatif
sonda: düzeltme geri alınınca kırmızı. Kapının kendisi `test_cek_bordro_taslak_token.ts`'ten
`scripts/lib/`e ortak yardımcı olarak çıkarılır (D1).

**Eski istemci:** her dilimde sunucu, 4xx yerine bugünkü başarı biçiminde replay döner. Ölçülen bütün
istemciler bunu işliyor. Sözleşme kırılmaz: backend önce çıkar, `minVersion` gerekmez.

| Dilim | Kapsam | Kalıp | Not |
|---|---|---|---|
| **D1** | (b) yolları: #6 levent tüketimi · #10 hızlı sipariş · #11 elle sipariş no | #6: R + token P2002 yakalama + gövde kapısı (`lengthM`) · #10: K, tek tx · #11: token ön-okuması clash kontrolünün ÖNÜNE + R | #11 için yarış gerekmez, sıralı bekçi yeter. #10'un yanlış mesajı düzelir. §5-6 ve §5-7 aynı dosyalarda. |
| **D2** | Ortak boğaz + zayıf (b): `withTokenReplay`, AST bekçisi ("`clientToken` alan her create yolu bu boğazdan geçer"), fason kabul ona taşınır (gövde kapısı eklenir) · #8 · #9 · #18 · #19 | R | Kasa replay'ine iptal kapısı eklenir (§5-4). |
| **D3** | Kalan (a): #1 · #2 · #3 · #4 · #5 · #7 · #12 · #13 · #14 · #15 · #16 · #17 | R; kilidi olanlarda K′ | Mekanik; yol başına bir zorlanmış sıra bekçisi. |
| **D4** | §5'in istemci ve retry kalemleri: her tıklamada token üreten 8 site (panel 7 · tablet 1) | tek yardımcı `Electron/src/lib/attemptToken.ts` (`useAttemptToken`, mal kabul satırları `keyed`); tablet mevcut `tokenFor` | Bekçi `test_istemci_token_uretimi`: sert kol taban 0 + P3 borç cırcırı (29: token tutup kesin 4xx'te yenilemeyen birim, beyan `scripts/lib/istemci-token-beyan.ts`). **D4b (isteğe bağlı):** P3 birimlerinin yardımcıya taşınması. |
| **D5** | 4. durum eksikleri (Payment · PurchaseOrder · GoodsReceipt'in CANCELLED'ı replay'de görülmüyor; fatura, depo transferi ve iş emri D3'te kapandı) · yarışta ham P2002 (`createWarpBeam`, fason dokuma kabulü, dokuma işi) · predicate'siz retry (§5-2: mal kabul; depo transferi D3'te kapandı) · kalan token yollarının boğaza taşınması (KK1 ilk giriş, açık kumaş, Tambur elle top, toplama listesi) · **hızlı iş emri telafisi (D3 bulgusu):** sıfır top bağlanınca `hardDelete` token'ı null'luyor ve arşiv ucu aynı yolu kullanıyor — arşivlenmiş iş emrinin tekrarı replay değil YENİ iş emri açar, 4. durum orada ölçülemez | R (boğaz) | D2 envanterinden (24 model, ~56 birim); beyan `scripts/lib/token-replay-beyan.ts`te `borc: "D5"` (D3 sonunda 16), cırcır `test_token_replay_bogaz` §6. |

## 5. Yan bulgular (sınıf dışı ya da sınıfa eşlik eden)

1. **Token P2002'si yakalanmıyor.** Hata `error.middleware.ts:582`'ye düşer ve kaybeden kodsuz 409
   "Bu 'clientToken' değeri zaten mevcut" alır. Geçtiği yerler: dokuma işi
   (`weaving-order.service.ts:213` retry yalnız numarayı ele alıyor, catch yok) · fason dokuma kabulü
   (`subcontractor-weaving.service.ts:237`) · levent tüketimi (#6) · paketleme grubu otomatik ad (#14).
   Levent takma/sarım/iade (#3–5) catch taşımıyor; bugün claim önce düştüğü için görünmüyor.
2. **Predicate'siz `withBarcodeRetry`.** Mal kabul (`goods-receipt.service.ts:741`) token P2002'sini beş
   kez dener ve "Barkod üretimi 5 denemede başarısız oldu" 409'unu döner. Depo transferinde (`:147`)
   retry kaybedeni 400'e çevirir.
3. **Replay gövde kapısı eksik ya da dar:**
   - Hiç kapı yok: sevkiyat (`shipping.service.ts:2252`; tablet `shipTokenRef` yapışkan, değişen çuval
     kümesi eski sevkiyatı alabilir) · kasa virmanı (`cash-transaction.service.ts:157`) · fason kabul.
   - Karşılaştırılmayan alan: paketleme grubunda ad · çuvalda ambalaj no · levent takmada makine/yuva ·
     tüketimde `lengthM`.
   - Hızlı sipariş yalnız cari + şube + satır SAYISINA bakıyor.
4. **Kasa replay'i iptali görmüyor.** `cash-transaction.service.ts:193` iptal edilmiş hareketi
   "zaten oluşturulmuş" diye döndürüyor; idempotency'nin 4. durumu eksik.
5. **İstemci token'ı her tıklamada üretiyor.** Bu, `docs/kurallar/kk1.md`'deki "mantıksal deneme başına
   bir kez" kuralına aykırı:
   - `QuickShipDialog.tsx:119`
   - `TransferFormDialog.tsx:80`
   - `InvoiceFormDialog.tsx:525` (kaynaksız taslak tekrarında mükerrer açılabilir)
   - tablet `useFasonDokuma.ts:69`
   - `PackingLotListView.tsx:67` (tekrar tıklama ikinci boş lot)

   Zaman aşımı tekrarında token koruması hiç yok.
6. **Levent tüketiminde kalan kontrolü claim'den önce.** `remainingMTx` (`warp-beam-consume.service.ts:61`)
   satır kilidi olmadan okunuyor, claim sonra geliyor. Farklı token'lı iki eşzamanlı tüketim kalanı
   aşabilir. Statik okuma, ÖLÇÜLMEDİ; kilit sırası sınıfı.
7. **Hızlı siparişte atomiklik yok.** Claim ile sipariş ayrı tx'te. Sipariş oluşturma düşerse toplar
   siparişsiz WAREHOUSE'da kalır.

## 6. Kullanıcıya sorular

**S1 — Varsayılan kalıp?**
- **(A) Önerilen:** R ortak boğaz; #10'da K, kilit zaten olan yerde K′. Tek sarmalayıcı yedi tx-öncesi
  yolu ve sıralı #11'i de kapatır.
- (B) Her yolda K. Tx öncesi kurallar tx içine taşınır; daha büyük yeniden yapılandırma.
- (C) Ortak boğaz yok, yol yol karar. Bir sonraki token'lı uç yine kalıpsız doğar.

**S2 — Kapsam ve takvim?**
- **(A) Önerilen:** D1 hemen (üç gerçek (b)), D2–D4 sonraki trenlerde.
- (B) Hepsi tek trende.
- (C) Yalnız D1; kalanı borç listesine.

**S3 — İstemci token politikası?**
- **(A) Önerilen:** Sunucu düzeltmesi yeter, istemci 4xx politikası değişmez. Her tıklamada token
  üreten beş form "mantıksal deneme başına" düzene çekilir (D4).
- (B) İstemciler 409'da token'ı korusun. `kk1.md`'deki "kesin 4xx'te yapışmaz" kuralını tersine
  çevirir, önerilmez.
- (C) İstemciye dokunma.

**S4 — Gövde kapısı?**
- **(A) Önerilen:** Ortak boğaz gövde kapısını ZORUNLU kılar; kapısız replay yazılamaz. Farklı
  gövde → 409 `CLIENT_TOKEN_COLLISION`. Bugün "başarılı" dönen farklı-gövde tekrarları 409'a döner:
  eski istemci bunu toast ile gösterir.
- (B) Mevcut kapılar olduğu gibi kalır.

**S5 — §5-6 (tüketim kalanı) ve §5-7 (hızlı sipariş atomikliği)?**
- **(A) Önerilen:** D1'e dahil; aynı dosyalar, aynı bekçi.
- (B) Ayrı iş.
