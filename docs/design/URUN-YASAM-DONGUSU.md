# ÜRÜN KARTI YAŞAM DÖNGÜSÜ ve ANA VERİ ARŞİV KAPISI

> **Durum:** ONAYLI 2026-09-25 (kullanıcı işi dağıttı) — kod YOK, uygulama S0…S8 dilimleriyle 9b'de. Kararlar kullanıcıdan (2026-09-25, §14'teki sekiz
> karar); açık soru yok (§15), S2+S3 dilim tanımı 1e onayından geçmeden şema açılmaz. Kural satırları uygulama dilimleriyle iner (§13) — bu belge
> GEREKÇE, ÖLÇÜM ve SÖZLEŞME taşır. Bu belgeyi okuyup "kodda da böyledir" diye varsaymayın: §2 BUGÜNÜ,
> §3 ve sonrası HEDEFİ anlatır.
>
> Çerçeve: `docs/standart/MASTER-VERI-TASARIMI.md` (MV-01…05) + kök `CLAUDE.md` defter doktrini ve
> "yıkıcı işlemde etkilenen her kayıt listelenir" kuralı.

## 1. Olay — 2026-09-25 mesai (SAHINSRV, backend 2.10.0)

- 24 Eylül 17:19–17:21 panelden 12 ürün kartı "Sil" ile pasife alındı (ACTİVO / KRİSTAL ailesi);
  25 Eylül 11:38'de bir kart daha (STK-000032). Kullanıcı aynı dakikalarda benzer adlı YENİ kartlar
  açtı — niyet "kartları yeniden düzenlemek"ti, stoğu durdurmak değil.
- Sonuç (erişim günlüğünden, yanıt gövdesi boyutu koddaki tek mesajla eşlendi):
  - tablet hızlı iş emri 11:12–11:22 arası **34 kez** üst üste 400 — "Hedef ürün bulunamadı veya
    pasif"; operatör ~10 dk takıldı.
  - panel sipariş kaydı **11 kez** 400 — "Sipariş kaleminde bulunmayan veya pasif ürün var".
- Aynı gün salt okumayla ölçülen durum: pasif **10** kartta **174 canlı top** (106 depoda · 57 stokta
  · 6 fasonda · 5 üretimde), **6 açık iş emri**, **32 açık sipariş satırı**. Pasif renk ve pasif
  müşteride canlı referans 0.
- IE2509260007 11:26'da STK-000032 ile açıldı; kart 12 dk sonra pasife alındı ⇒ bugün pasif karta
  bağlı açık iş emri var.
- Sunucu hatası (5xx) yoktu; kod regresyonu değil. Koruma tasarlandığı gibi çalıştı — sorun
  korumanın **yanlış yerde** olması: pasife almada değil, stoğun kullanıldığı yerde ısırdı.

## 2. Kök neden — BUGÜN (ölçüldü 2026-09-25)

1. **Pasife almada kapı yok.** `BaseService.softDelete` canlı bağımlılığı sayar
   (o günkü `deactivate-impact.helper` — S4'te silindi) ama bilerek engellemez
   (`Teks-Erp/src/services/base.service.ts`, "ENGELLEMİYOR — bilinçli"); uyarı yalnız yanıtın
   `message`/`warnings` alanına yazılır. İkinci yol (`PATCH {isActive:false}`, ürün formundaki
   "Aktif" kutusu — `Electron/src/pages/Items/ItemFormDialog.tsx`) sayımı hiç yapmaz ve audit'e
   UPDATE olarak düşer. Önizleme ucu yok.
2. **Panel uyarıyı yutar.** `Electron/src/hooks/useCrudMutations.ts` silme başarısında yanıtı okumaz,
   her zaman "silindi" basar — bütün CRUD sayfalarında. Helper başlığındaki "panel uyarıyı gösteriyor"
   cümlesi koda uymuyor (bayat).
3. **Tek boolean iki anlam taşıyor.** `isActive=false` hem "yeni işte kullanma" hem "hiçbir şey
   yapma" diye okunuyor; 20+ yerde dağınık kontrol var ve tutarsız: iş emri açma, sipariş, KK1 girişi
   engelliyor; tambur kesim/finalize, çuval/sevk, fason sevk/kabul, split, kartela engellemiyor. Aynı
   top bir adımda akıyor, bir sonrakinde duruyor.
4. **Tablet hatayı geç ve çiğ verir.** `mobil/src/screens/Modules/HizliIsEmri/scanClassify.ts`
   okutulan topun kartını kontrol etmez; hata ancak "Başlat"ta sunucu metniyle gelir ve ne
   yapılacağını söylemez.
5. **Yan bulgular (aynı sınıf):**
   - müşteri kartı `DELETE`te açık siparişe 409 verir ama `PATCH {isActive:false}` kapıyı atlar
     (`Teks-Erp/src/services/customer.service.ts`);
   - depo yalnız sert silmede top sayar, pasife almada saymaz; kumaş özelliği ve fasoncu pasife
     almada hiç saymaz;
   - birleştirmede hedef (survivor) kartın aktif olduğu kontrol edilmez;
   - pasife alma ile yeni referans yazımı arasında kilit yok: sayım ile güncelleme arasında doğan
     top görünmez (TOCTOU).

## 3. Hedef model — üç durum (SAP malzeme durumu / Oracle item status kalıbı, sadeleştirilmiş)

| Durum (kod) | Ekranda | Anlamı |
|---|---|---|
| `ACTIVE` | Aktif | Her şey açık |
| `PHASE_OUT` | Tükenene kadar | Karta YENİ talep/stok eklenmez; üstündeki mal ve açık işler sonuna kadar akar |
| `ARCHIVED` | Pasif | Karta hiçbir yeni kayıt bağlanamaz; **üstünde canlı referans OLAMAZ** |

- Ekranda `ARCHIVED` için "Pasif" kelimesi korunur (kullanıcı dili; eğitim gerektirmez).
- Birleştirilmiş kart (`mergedIntoId` dolu) `ARCHIVED` + mezar taşıdır; bugünkü davranış aynen kalır.
- `pendingReview` ayrı eksendir, bu belge ona dokunmaz.

### 3.1 Değişmezler

- **D1 — Pasif kartta canlı referans yoktur.** Canlı referans: ölü kümede olmayan top
  (`K18_DEAD_STATUSES` + sevk edilmiş + fire), açık iş emri (PLANNED/IN_PROGRESS), açık sipariş
  satırı, açık alış siparişi satırı, açık dokuma işi, açık (kapanmamış, geri alınmamış) tezgah
  koşumu, açık fason iplik sevk kalemi, sıfırdan farklı iplik bakiyesi (`yarn_stocks.balanceKg ≠ 0`,
  eksi bakiye de canlıdır — son ikisi 1e kararı 2026-09-25). Tanım TEK helper'da yaşar
  (`item-lifecycle.helper` → `ITEM_LIVE_REF_KINDS`); SQL ikizi yalnız göç migration'ındadır ve
  ikisinin aynı kartları saydığı `test_item_lifecycle_migration` ile ölçülür. Fason iplik kalemi
  için "açık" = sevk iptal değil ∧ `remainderClosedAt` boş (`OUTSTANDING_ITEM` rollsuz iplik
  kalemini eşleyemez; dar tanım bilerek fazla sayar — fail-closed).
- **D2 — Durumu tek yazar değiştirir** (yaşam döngüsü yazıcısı). `DELETE`, `PATCH isActive`,
  birleştirme ve geri alma bu yazıcıyı çağırır; hiçbir yol `isActive`i doğrudan yazmaz.
- **D3 — `isActive` türetilir:** `isActive = (lifecycleStatus <> 'ARCHIVED')`, DB `CHECK` seddiyle
  (çift yüklem kuralı). Eski okuyucular ve `nameFold` partial unique'i (WHERE `mergedIntoId IS NULL`)
  etkilenmez.
- **D4 — Birleştirme ASLA otomatik değildir** (kullanıcı kararı 2026-09-25). Göç yalnız durum
  değiştirir; hiçbir diyalog varsayılanı birleştirmeyi seçmez.

### 3.2 Geçişler

| Geçiş | Koşul | Not |
|---|---|---|
| Aktif → Tükenene kadar | her an | önizleme neyin akmaya devam edeceğini listeler |
| Aktif / Tükenene kadar → Pasif | **canlı referans = 0** | değilse 409 `ITEM_HAS_LIVE_REFERENCES` + kayıt listesi |
| Tükenene kadar → Aktif | her an | |
| Pasif → Aktif | birleştirilmemişse | ad çakışması bugünkü gibi kullanıcıya sorulur |
| Kaynak → birleştirildi | hedef `ACTIVE` olmalı | yeni kapı (§2.5) |

- Tükenene kadar → Pasif **elle** yapılır: kart listesinde "Pasife hazır" rozeti çıkar (kalan 0).
  Otomatik arşiv reddedildi (§16).
- Her geçiş kartın kalıcı kolonlarına (`lifecycleChangedAt`/`ById`/`Reason`) ve audit'e yazılır.
  Ayrı defter tablosu açılmaz: *satır silinince raporlanan hiçbir sayı değişmiyor* ⇒ defter testi
  bunu DENETİM sınıfına koyar (kök `CLAUDE.md` defter doktrini); son geçiş kalıcı kolonda donar.

## 4. Kullanım kuralı — tek kaynak (`assertItemUsable`)

Ölçüt tek cümle: ***işlem kartın üstünde ZATEN VAR OLAN bir malı ya da açık bir belgeyi mi yürütüyor,
yoksa karta YENİ bir talep, stok ya da tanım mı ekliyor?***

| Sınıf | Örnek | Aktif | Tükenene kadar | Pasif |
|---|---|---|---|---|
| **A1 — Yeni sipariş** | yeni sipariş satırı · toplardan hızlı sipariş | ✔ | ayara bağlı (§4.1) — varsayılan: yalnız okutulan toplar kadar | ✖ |
| **A2 — Açık satırda miktar** | açık sipariş satırında artırma/azaltma | ✔ | ayara bağlı (§4.1) — varsayılan: serbest + uyarı | ✖ |
| **A3 — Yeni üretim planı** | topsuz ve siparişsiz iş emri · iş emrinde hedef ürünü bu karta çevirme · yeni dokuma işi | ✔ | ayara bağlı (§4.1) — varsayılan: açık | ✖ |
| **A4 — Yeni alım** | alış siparişi satırı | ✔ | ✖ | ✖ |
| **B — Yeni tanım** | reçete · fiyat · müşteri ürün adı · izinli renk/özellik · çözgü kartı | ✔ | ✖ | ✖ |
| **C — Dışarıdan yeni stok** | belgesiz KK1/elle giriş · açılış stoğu · iplik lotu | ✔ | ✖ | ✖ |
| **C′ — Açık belgeyi tamamlayan giriş** | açık alış siparişine mal kabul · açık dokuma işine kabul · fason dokuma kabulü | ✔ | ✔ | ✖ (D1 gereği olamaz) |
| **E — Mevcut malı yürüten** | hızlı iş emri (okutulan toplar) · mevcut sipariş satırına iş emri · tambur kesim/finalize · fason sevk/kabul · split · kartela · çuval/sevk · iade · etiket · iptal/fire/düzeltme | ✔ | ✔ | ✖ (D1 gereği olamaz) |
| **R — Okuma** | liste · rapor · arama · belge yeniden basımı | ✔ | ✔ | ✔ |

- Her kontrol noktası `assertItemUsable(db, itemId, sınıf)` çağırır (referans yazan tx'te
  `assertItemUsableTx`); hata kodları `details.code` altında: `ITEM_PHASE_OUT` (A/B/C'de) ·
  `ITEM_INACTIVE` (Pasif — bugünkü kod KORUNUR, sözleşme değişmez; ekrandaki "Pasif" ile aynı ada
  düşer) · `ITEM_MERGED` (bugünkü). Ayrı bir `ITEM_ARCHIVED` kodu doğmaz (1e kararı 2026-09-25).
- Mesaj operatöre NE YAPACAĞINI söyler: kart adı + durumu + yol ("Bu kumaş 'tükenene kadar'
  modunda — yeni sipariş açılamaz; mevcut stoktan sevk edebilirsiniz").
- Bugünkü dağınık `isActive` kontrolü bu helper'a taşınır; AST bekçisi Item üzerinde çıplak
  `isActive` kontrolünü yasaklar (§10). Ölçülen taban: **20 nokta** (AST, `97e9d8a1`) → bu sürümde 0.
  A1 `OKUTULAN_TOPLAR` modunda satır miktarını SUNUCU okutulan topların metrajından hesaplar;
  istemcinin gönderdiği miktara güvenilmez. Taşıma öncesi envanter: iş emri `create`/`update`/`replace` + `quickStart`, sipariş `validateLineItems`,
  `createInitialEntry` (KK1 · elle giriş · mal kabul · tambur elle top · fason dokuma kabulü),
  mal kabul ön kontrolü, alış siparişi, iplik hareketi/lotu, fason iplik sevki, çözgü kartı, dokuma
  işi, tezgah koşumu, reçete, fiyat, müşteri adı, izinli renk/özellik.
- ⚠️ Tambur `createManualRoll`/`produceFinishedRoll` ve fason dokuma kabulü bugün
  `createInitialEntry` üstünden ÇIPLAK KK1 kapısından geçiyor — hedefte E/C′ sınıfıyla çağrılır,
  yoksa "Tükenene kadar" kartın üretimi tamburda durur (bugünkü olayın aynısı, bir adım sonra).

### 4.1 Ayarlanabilir davranış — üç ayar (kullanıcı kararı 2026-09-25)

"Tükenene kadar" kartın A1–A3 davranışı fabrikadan fabrikaya değişir (her-senaryo doktrini: her
seçeneği uygulayan firma gerçektir) ⇒ üç **kurulum ayarı**; varsayılanlar kullanıcının seçtiği
şıklardır. Ayarlar bayrak reçetesiyle doğar (`docs/RECETELER.md` § Yeni feature flag / sistem ayarı),
profile konmaz, yazımı ayar kapısından (`flagWriteGuard`) geçer; panelde "Ayarlar → Ürün yaşam
döngüsü" altında TEK grup.

| Ayar | Seçenekler | Varsayılan |
|---|---|---|
| **Yeni sipariş** | `OKUTULAN_TOPLAR` — yalnız toplardan hızlı sipariş, miktar okutulan toplardan gelir · `KAPALI` — hiç yeni sipariş satırı yok · `SERBEST` — normal sipariş gibi | `OKUTULAN_TOPLAR` |
| **Açık satırda miktar** | `SERBEST_UYARILI` — artırma ve azaltma serbest, kısa uyarı · `AZALTMA_SERBEST` — artırma reddedilir · `KILITLI` — miktar değişmez | `SERBEST_UYARILI` |
| **Yeni üretim planı** | açık · kapalı | açık |

- **Uyarı metni** (`SERBEST_UYARILI`, `ApiResponse.warnings` ile; panelde gösterim S1'e bağlı):
  *"Bu ürün tükenene kadar satılıyor. Stokta yeterli top olduğunu kontrol edin."*
- "Yeni üretim planı açık" iken yeni iş emri yalnız MEVCUT stoğu tüketebilir: belgesiz stok girişi
  (C) kapalı kalır. Kartı yeniden doldurmak isteyen fabrika kartı Aktif'e döndürür.
- **Çıkışsız kapı denetimi:** katı seçenekler (`KAPALI` · `KILITLI` · plan kapalı) açılmadan önce
  "mal bu karttan başka hangi yoldan çıkar" ölçülür (açık siparişe sevk · siparişsiz sevk). Ölçüm
  yeşil olmadan o seçenek panelde seçilebilir DOĞMAZ (kök `CLAUDE.md`: çıkışsız kapı üreten bayrak
  yazılır ama açılmaz).
  KAPALI + sevkte sipariş zorunlu birleşiminde çıkış 'Siparişsiz devam et' beyanıdır; ayar kaydında
  uyarı verilir, çıkışı matris bekçisi ölçer (`test_item_lifecycle_exit_gate`: 54 birleşimin
  her birinde çıkış gerçek yüklemlerle — `assertItemUsable` + `assertOrderLinkAllowed` — sayılır;
  `KILITLI` ve plan kapalı çıkışı etkilemez).
- **"Varsayılan = bugünkü davranış" kuralıyla ilişki (ölçüldü):** "Tükenene kadar" yeni bir durumdur;
  bugün bu durumda bir davranış YOKTUR, yani ayarların varsayılanı kimsenin bugününü değiştirmez.
  Bugün pasif olan ve göçle Tükenene kadar'a geçecek kartlar (adnansahin'de 10) bugün TAMAMEN
  kilitlidir; onların gevşemesi ayarın değil göçün sonucudur ve kullanıcı kararıyla (§14/3)
  bilerek yapılır. Her kurulumda aynı göç koşar ⇒ sürüm notu bu değişikliği ve etkilenen kartları
  ADIYLA söyler.
- Temel değişmez (D1 — pasif kartta canlı kayıt olamaz) ayara BAĞLANMAZ; çekirdektir.

## 5. Pasife alma akışı (backend)

1. **Önizleme:** `GET /api/items/:id/lifecycle-preview?to=PHASE_OUT|ARCHIVED` — canlı referansları
   **tek tek** döner: toplar (barkod · durum · konum), açık iş emirleri (no · durum), açık sipariş
   satırları (sipariş no · müşteri · kalan), açık alış/dokuma/fason kalemleri. Yanıtta
   `canArchive` ve benzer adlı AKTİF kart adayları (mükerrer eşlemesinden; yalnız BİLGİ).
2. **Geçiş:** `POST /api/items/:id/lifecycle` `{ to, reason }`. Arşivde D1 ihlali →
   409 `ITEM_HAS_LIVE_REFERENCES`, `details.references` önizlemeyle aynı biçimde. `clientToken`
   YOKTUR: geçiş kayıt yaratmaz ve hedef-durum idempotenttir — atomik claim
   (`updateMany WHERE {id, lifecycleStatus: <tx içinde okunan>}`), count 0 ise taze okuma: kart
   zaten hedefteyse 200 + `idempotent:true` (yazım/audit yok), değilse 409 "durum bu sırada değişti".
3. **Kilit:** her yolda aynı sıra — **8030 SHARED → kart satırı** (1e düzeltmesi 2026-09-25).
   Yazıcı: tx'in ilk ifadesi 8030 SHARED, sonra kart `FOR UPDATE`; referans doğuran her yol
   `assertItemUsableTx` içinde 8030 SHARED + kart `FOR SHARE` ⇒ sayım ile yazım arası TOCTOU
   kapanır. Birleştirme 8030 EXCLUSIVE tuttuğu için döngü kurulamaz; yolun kendi advisory kilidi
   varsa (8027 alış · 8032 dokuma no) ondan SONRA, satır claim'lerinden (iş emri, dokuma işi)
   ÖNCE alınır. Yeni advisory uzayı açılmaz. Ölçüm: `test_item_lifecycle_race` (FOR SHARE
   kaldırılınca 24 turun 3'ünde Pasif kartta canlı top doğdu).
4. **Eski uçlar aynı yazıcıya bağlanır** (sözleşme korunur): `DELETE /api/items/:id` = "Pasif'e
   geç" (kapılı) · `PATCH {isActive:false}` = aynı · `PATCH {isActive:true}` = "Aktif'e dön".
   `isActive` genel güncellemenin skaler geçişinden çıkarılır (BaseController'da yeni skaler =
   yeni yazılabilir alan kuralı).
5. **Birleştirme/geri alma:** kaynak `ARCHIVED` yazılır; hedef `ACTIVE` değilse 409. Geri alma
   kaynağın ÖNCEKİ durumunu geri koyar — birleştirme operasyonu kaynağın `lifecycleBefore`ını
   saklar; eski operasyonlarda alan yok ⇒ `isActiveBefore`dan eşlenir (true→ACTIVE, false→ARCHIVED).

## 6. Diğer ana veriler — kapı hepsine, üç durum yalnız üründe

Renk · kumaş özelliği · müşteri · depo · fasoncu için `DELETE` ve `PATCH {isActive:false}` aynı
kapıdan geçer: canlı referans varsa 409 + kayıt listesi; çıkış yolu birleştirme (renk, müşteri,
fasoncu desteklenir) ya da açık kayıtları kapatmak. Canlı referans tanımı varlık başına TEK haritada
(bugünkü birleştirme haritasının MOVE satırları + canlılık süzgeci; depo ve özellik için yeni satır).
Müşteride mevcut "açık sipariş" kapısı ve cari hesaptaki bakiye kapısı bu haritaya katlanır, ikinci
kopya kalmaz.

**Uygulama (S4, 1e kararları 2026-09-25):**
- Hata `409 MASTER_DATA_HAS_LIVE_REFERENCES` + `details.entity` + `details.references` (ürünle aynı
  biçim, kayıtlar tek tek); ürün `ITEM_HAS_LIVE_REFERENCES`te kalır. Tanım varlık başına
  `helpers/archive-gate/<varlık>-archive.helper.ts`, ortak "açık/canlı" yüklemleri `live-ref-where.helper`.
- **Aktif rotanın planı ENGELLER (Q1 revize):** aktif rota adımının planlı rengi, planlı özelliği ve
  planlı fasoncusu canlı referanstır; rota·adım listelenir, çıkış rotayı düzeltmek ya da pasife
  almak. Gerekçe: bugünkü olayın dersi — yıkıcı değişiklik KAYNAKTA durur, kullanıldığı yerde değil
  (yoksa yükü tabletteki operatör taşır). İş emri açılışında otomatik uygulanan başka yapılandırma
  YOK (ölçüldü: reçete 2026-08-02'de kaldırıldı; müşteri rotası seçicide yalnız öne çıkar).
- **Yalnız uyarı:** ürünün izinli renk/özellik listesi, aktif reçete, müşteri rotası — pasif kayıt
  seçilemediği için operasyonu kırmaz; başarı yanıtının `warnings`inde KAYIT ADIYLA listelenir.
- **Eski veri:** kapıdan önce bozulmuş rota (pasif planlı renk/özellik) iş emri açılışında ENGELLENMEZ,
  açık uyarı verir ("Rota 'X' adım N pasif rengi (Y) planlıyor — fason kabulünde uygulanan rengi
  seçin; rotayı düzeltmesi için yöneticinize bildirin."). Açılışta engellemek yayından sonra sahada
  bugünkü olayın aynısını üretirdi. Fasoncu için mevcut engel aynen kalır.
- Tarihçe/defter tabloları (fason kabul, iade, mal kabul fişi, kartela kabul, levent/lot tedarikçisi)
  arşivi ENGELLEMEZ (Q3).
- Birleştirmenin hedefi pasif olamaz (`409 MERGE_TARGET_INACTIVE`, dört varlık).
- Zaten pasif kayıtta düzenleme kapıdan geçmez (form `isActive:false`ı yeniden gönderir).
- **Bilinen sınır (Q2):** kilit EN İYİ ÇABADIR — tx içinde ana veri satırı `FOR UPDATE` + sayım;
  üründeki gibi referans yazan yollar ana veri satırını `FOR SHARE` almaz, sayım ile pasife alma
  arasında doğan referans kaçabilir. İzleme: S8 health sayacı beş varlığı da kapsar ("arşivlenmiş ana
  veride canlı referans", beklenen 0).

## 7. Şema ve göç

- Enum `ItemLifecycleStatus { ACTIVE, PHASE_OUT, ARCHIVED }` (enum reçetesi, `docs/RECETELER.md`).
- `items`: `lifecycleStatus NOT NULL DEFAULT 'ACTIVE'`, `lifecycleChangedAt timestamptz`,
  `lifecycleChangedById uuid`, `lifecycleReason text`; `CHECK (("lifecycleStatus" = 'ARCHIVED') = (NOT "isActive"))`.
- Birleştirme operasyonu kaynak satırına `lifecycleBefore` (nullable).
- **Backfill (tek migration, dry-run listesi sürüm notunda):**
  `isActive=true` → ACTIVE · `mergedIntoId` dolu → ARCHIVED · `isActive=false` ve canlı referans > 0
  → **PHASE_OUT** (bugün 10 kart; `isActive` true'ya döner) · kalan pasifler → ARCHIVED.
- ⚠️ **Sıra şartı:** PHASE_OUT kartlarda `isActive` true'ya döndüğü için eski çıplak kontroller
  onlara YENİ sipariş açtırır ⇒ §4'teki taşıma aynı backend sürümünde tamamlanmış olmalı; AST
  bekçisi taşınmamış kontrol kalırken sürümü durdurur.
- **DB seddi (S5, 1e kararı (b) 2026-09-25):** migration `20260925200000_urun_arsiv_db_seddi`.
  - `rolls`: `BEFORE INSERT OR UPDATE OF "itemId", "status"` → yeni satır CANLI ve kartı ARCHIVED ise
    RAISE. Ölü top (K18 + SHIPPED + SCRAP; TS ikizi `DEAD_ROLL_STATUSES`) geçer — tarihçedir.
    Kart değişmeyen canlı→canlı güncelleme kart okumadan geçer (sıcak yol).
  - `order_lines`: `BEFORE INSERT OR UPDATE OF "itemId", "cancelledAt"` → kalem iptal değil, kart
    ARCHIVED ve sipariş açıksa (`OPEN_ORDER` kümesi) RAISE.
  - Neden `status` da: (a) yalnız `itemId` dirilmeyi (ölü → canlı: iptal geri alma, sevk geri alma,
    iade, tambur/fason/kartela/sayım geri alması) görmez; Pasif kartta canlı top doğurmanın asıl
    kapısız yolu dirilmedir.
  - Hata SQLSTATE 23514 + kısıt adı → `error.middleware` 409 + Türkçe:
    **"Bu topun kartı Pasif — geri almak için kartı önce 'Tükenene kadar'a alın."**
  - Uygulama katmanı birinci hattır: her dirilme yolu `assertRollsRevivable` (sınıf E, aynı mesaj,
    `ITEM_INACTIVE`) çağırır; bugün 11 yol (envanter iptal geri alma · sayım geri alma · sevk geri
    alma · iade · tambur tekli/tam geri alma · fason kalan açma/kabul iptali/transfer geri alma ·
    kartela kabul iptali · kurşun adım yeniden açma). `roll-finalize` ve `roll-step` canlı→canlı
    geçiştir, dirilme değil. Cırcır: `test_item_usage_single_source` §3.
  - Geri alma sırası: `master-data-unmerge` mezar taşını satırları geri yazmadan ÖNCE kaldırır.
  - Bilinen sınırlar: tetikleyici mevcut satırları yeniden denetlemez (ADDITIVE); sipariş statüsü
    kapalıdan açığa dönerse kalem tetikleyicisi koşmaz. İkisini de S8 health sayacı izler.
  - **Prova (tekserp_prova9b_test, 23 Eylül dökümü, 2026-09-25):** ① ilk uygulama temiz, ikinci
    uygulama idempotent · ② 8.381 top / 610 kalemin hiçbiri tetikleyiciye takılmaz; D1 ihlali 0 ·
    ③ gerçek kartta birleştirme (275 top) 180 ms, geri alma 74 ms, kaynak ACTIVE'e döner · ④ maliyet
    (EXPLAIN ANALYZE): canlı→canlı statü ~3 µs/satır · kart değişimi ~1,7 µs · dirilme ve INSERT
    ~15 µs/satır (EXISTS okuması) · kalem ~1,5 µs; aynı işlemlerde K-A3 AFTER tetikleyicisi
    ~2–20 kat daha pahalı. Yan bulgu: 2 top NOT VALID `rolls_qty_le_initial`i ihlal ediyor
    (bu dilimle ilgisiz, öncesinden).
- **Prova:** fabrikanın son dump'ının kopyasında restore → `migrate deploy` → 10 kartın PHASE_OUT'a
  geçtiği ve "Pasif kartta canlı referans = 0" sorgusu → bekçiler → profil boot. Canlı DB'de değil.

## 8. Panel

- Ürünler: "Sil" düğmesi **"Kullanımdan kaldır"** olur. Diyalog önizlemeyi çağırır, kayıtları sınıf
  sınıf ve tek tek listeler (topları duruma göre katlanır), iki seçenek sunar:
  **Tükenene kadar** (varsayılan, seçili gelir) · **Pasif** (yalnız canlı referans 0 ise açık).
  Benzer adlı aktif kart varsa altta yalnız bilgi satırı: "Bu kart aslında X'in kopyasıysa Birleştir
  kullanın" — birleştirme ayrı ekranda, ayrı onayla (D4).
- Liste: durum süzgecine "Tükenene kadar" eklenir; rozet "Tükenene kadar · 51 top kaldı" /
  "Pasife hazır".
- Seçiciler: A/B/C sınıfı formlarda (sipariş kalemi, alış siparişi, KK1/elle giriş, topsuz iş emri)
  yalnız izin verilen durumlar — §4.1 ayarlarına göre (ör. "Yeni üretim planı açık" ise iş emri
  seçicisi Tükenene kadar kartları da gösterir, rozetiyle); süzgeç/rapor seçicilerinde hepsi.
- Ayarlar → Ürün yaşam döngüsü: §4.1'deki üç ayar tek grupta, her seçeneğin altında bir cümlelik
  sade açıklama; çıkışsız kapı ölçümü yeşil olmayan seçenek pasif ve gerekçesi yazılı.
- Sipariş formunda A2 uyarısı satırın yanında sarı tek satır (§4.1 metni).
- **Genel düzeltme (ayrı dilim, bağımsız inebilir):** `useCrudMutations` sunucunun
  `warnings`/`message` alanını gösterir — bütün CRUD sayfaları.
- Diğer ana veri sayfaları: 409 kayıt listesini okunur diyalogda gösterir.
- **Uygulama (S6):**
  - "Kullanımdan kaldır" diyaloğu (`ItemLifecycleDialog`) Aktif ve Tükenene kadar satırda açılır.
    Pasif satırda "Aktifleştir" kalır.
  - Ürün formundaki "Aktif" onay kutusu kalktı; form `isActive` göndermez. Durum yalnız diyalog ve
    Aktifleştir ile değişir.
  - Durum süzgeci: "Aktif" bugünkü gibi kullanımdaki kartlardır (Tükenene kadar dahil, rozetle
    ayrılır); "Tükenene kadar" yalnız o durumdur.
  - Rozet sayısı `GET /items/lifecycle-summary?ids=` ucundan gelir.
  - Seçici kapsamı `pickableLifecycle`:
    - sipariş kalemi: ayar "Serbest" ise Tükenene kadar kart da listelenir
    - iş emri hedefi ve dokuma işi: yeni plan ayarına bağlı
    - alış, elle giriş, reçete, çözgü ipliği: yalnız Aktif
    - mal kabul: süzülmez, çünkü PO satırlı kabul C′ sınıfıdır ve sunucu karar verir
  - Arşiv 409'u (`ITEM_HAS_LIVE_REFERENCES` / `MASTER_DATA_HAS_LIVE_REFERENCES`) genel toast yerine
    App düzeyindeki tek diyalogda kayıt kayıt gösterilir; bu, bütün ana veri sayfalarını kapsar.
  - Ayarlar grubu seçenekleri alt alta, her birinin altında tek cümleyle çizilir. Kaydetteki
    sunucu uyarısını (KAPALI + sipariş zorunlu) `apiClient` yanıt interceptor'ı basar.

## 9. Tablet

- Top okutma yanıtı kartın durumunu taşır (ekleyen alan); `scanClassify` okutma ANINDA karar verir:
  PHASE_OUT → akar (küçük bilgi etiketi); ARCHIVED → kırmızı, açık metin (D1 gereği beklenmez ama
  fail-closed).
- KK1 ürün seçicisi yalnız `ACTIVE`; hata metinleri `details.code`'dan Türkçe ve eylem söyler.
- **Uygulama (S7):**
  - Seçiciler `usePickableLifecycle`:
    - KK1: yalnız Aktif
    - sipariş kalemi: "Yeni sipariş" ayarına bağlı
    - işsiz tezgah koşumu: "Yeni üretim planı" ayarına bağlı
    - Tambur manuel: süzülmez (sınıf E), rozetle
  - Hızlı iş emri kilit çipi Tükenene kadar kartı okutma anında gösterir; Pasif kartın topu
    `classifyScannedRoll`da red.
  - Sunucu hata metni zaten Türkçe ve eylem söylediği için olduğu gibi gösterilir; ayrı kod
    eşlemesi eklenmedi.
  - Mobil `ItemLifecycleStatus` ayna bekçisinde (`test_mobil_enum_aynasi`).

## 10. Gözlem ve bekçiler

- `/api/admin/health` → `masterData.archivedWithLiveRefs` (beklenen 0) ve PHASE_OUT kartların
  kalan referans sayısı. Sayaç DB seddinin göremediği iki yolu da kapsar (§7): tetikleyiciden önce
  doğmuş satır ve kapalıdan açığa dönen siparişin Pasif karttaki kalemi (1e 2026-09-25).
- Bekçiler (yeni; iki sonda kuralıyla):
  1. **kullanım politikası** — sınıf × durum × §4.1 ayar seçeneği tablosu, servis çağrılarıyla
     (DB'li); her ayar değişikliği `try` içinde, geri alma `finally`de.
  2. **çıplak kontrol cırcırı** — Item üzerinde `assertItemUsable` dışı `isActive` kontrolü; taban
     bugünkü sayı, aynı sürümde 0'a iner (negatif: ekle → artar · pozitif: taşı → düşer).
  3. **arşiv kapısı** — her ana veri için `DELETE` ve `PATCH {isActive:false}` canlı referansla 409.
  4. **yarış** — eşzamanlı "Pasif'e geç" ile top girişi: biri kazanır, D1 hiç çiğnenmez.
  5. **göç sondası** — prova DB'sinde backfill sonrası D1 sorgusu 0.
  6. **tek yazar** — `items."isActive"`e yaşam döngüsü yazıcısı dışında yazan yol yok (AST).
  7. **DB seddi** — `test_item_archive_db_guard`: Pasif kartta canlı top/açık kalem DB'de 409;
     ölü top ve kapalı kalem geçer; dirilme uygulama katmanında aynı mesajla durur; ölü küme
     TS ↔ SQL ikizi.
- Uçtan uca: panel diyaloğu (gerçek Electron) ve tablet okutması (gerçek cihaz), senaryoya
  "kullanımdan kaldır → stok akar → pasife hazır → pasif" dalı eklenir.

## 11. Sözleşme ve dağıtım — eski istemci ne yapar

- Sıra: backend önce (mesai dışı), sonra panel ve tablet. `minVersion` gerekmez.
- **Eski panel:** "Sil" → canlı referans varsa 409 → genel hata tostu mesajı gösterir (bugün
  "silindi" diyordu; artık durdurur — kasıtlı). Canlı referans yoksa bugünkü gibi pasif.
  "Aktifleştir" / "Geri al" (`PATCH {isActive:true}`) çalışmaya devam eder. `isActive:true` yalnız
  Pasif kartı Aktif'e döndürür; form her kayıtta `true` gönderdiği için Tükenene kadar kartta
  yazmaz (karar yazıcının kilidi altında, `onlyFrom`) — ad düzeltmesi kartı Aktif'e döndürmez. Eski panel
  "Tükenene kadar"ı seçemez; PHASE_OUT kartları yeni sipariş seçicisinde görür, kayıtta sunucu açık
  mesajla reddeder.
- **Eski tablet:** PHASE_OUT kartın topuyla hızlı iş emri artık çalışır (sunucu gevşer); KK1
  seçicisinde PHASE_OUT kart görünebilir, kayıtta açık mesajla reddedilir.
- Sürüm notu: davranış değişikliği ("canlı kaydı olan kart pasife alınamaz") ve göçün etkilediği 10
  kart adıyla listelenir.

## 12. Ana veri beş kapısının cevapları

- **MV-01 kimlik/rol:** yaşam döngüsü kimliğin DURUMUDUR, rol değil; kart tek kalır.
- **MV-02 finans kimliği:** değişmez; cari hesap bakiye kapısı §6 haritasına katlanır.
- **MV-03 operasyon verisi:** toplar ve belgeler karta bağlı kalır, durum geçişi hiçbirini taşımaz;
  taşıma yalnız birleştirmededir (ayrı, elle, geri alınabilir).
- **MV-04 kod/ad tekilliği:** değişmez (`nameFold` partial unique `mergedIntoId`e bakar).
- **MV-05 geriye dönüklük:** §11. `isActive` kolonu KALIR ve türetilir; kaldırılması ayrı karardır
  (koşul: hiçbir istemci ve rapor `isActive` okumuyor — ölçülerek).
- **Önerilen MV-06:** "Canlı referansı olan ana veri pasife alınamaz; çıkış yolu ya durum (üründe
  Tükenene kadar) ya da birleştirmedir — uyarı kapı değildir." Kural satırı uygulama dilimiyle, bekçi
  alanıyla birlikte iner.

## 13. Dilimler

| # | Dilim | Bağımlılık |
|---|---|---|
| S1 | Panel: sunucu uyarılarını göster (`useCrudMutations`) | yok — önce inebilir |
| S2 | Backend şema: enum + kolonlar + CHECK + backfill + yaşam döngüsü yazıcısı + önizleme/geçiş ucu + kilit + eski uçların eşlenmesi | Faz 0 |
| S3 | Backend: `assertItemUsable` + 20+ noktanın taşınması + çıplak kontrol cırcırı + §4.1 üç ayar (reçeteyle) + A2 uyarısı | S2 ile AYNI sürüm |
| S4 | Backend: diğer ana verilerde arşiv kapısı + PATCH açıkları + birleştirmede hedef kontrolü | S2 |
| S5 | Backend: DB seddi tetikleyicisi + geri alma sırası | S2, prova ölçümü |
| S6 | Panel: Kullanımdan kaldır diyaloğu · süzgeç/rozet · seçiciler · Ayarlar → Ürün yaşam döngüsü · A2 uyarısı | S1, S2, S3 |
| S7 | Tablet: okutma anında durum · mesajlar · KK1 seçicisi | S2 |
| S8 | Health sayacı · uçtan uca senaryo · kural satırları (MV-06 + alan dosyası) · bayat belge düzeltmeleri | hepsi |

## 14. Kullanıcı kararları (2026-09-25)

1. Tükenene kadar kartın mevcut malı iş emri, tambur, fason ve sevkte akar; o karta belgesiz yeni
   stok girişi ve yeni alım açılamaz. Yeni sipariş, açık satırda miktar ve yeni üretim planı §4.1
   ayarlarına bağlıdır (karar 5–7).
2. Kapı ÇEKİRDEK, bayraksız, her kurulumda. Bugünkü "uyar ama bırak" bilerek değişir; kapının çıkışı
   olduğu için (Tükenene kadar / birleştirme) çıkışsız kapı değildir.
3. Bugünkü 10 kart göçle Tükenene kadar'a geçer; ACTİVO kopyaları kullanıcı isterse, elle, mesai
   dışında, yedekten sonra, yalnız "kesin aynı kumaş" çiftlerinde birleştirilir. Birleştirme asla
   otomatik değildir.
4. Kapsam: arşiv kapısı bütün ana verilere; üç durum şimdilik yalnız ürün kartına.
5. **Yeni sipariş:** varsayılan yalnız toplardan hızlı sipariş, miktar okutulan toplar kadar; diğer
   seçenekler (hiç / serbest) ayarla.
6. **Açık satırda miktar:** varsayılan artırma ve azaltma serbest ama kısa, sade bir uyarıyla
   (§4.1 metni); diğer seçenekler (yalnız azaltma / kilitli) ayarla.
7. **Yeni üretim planı:** varsayılan açık (topsuz ve siparişsiz iş emri açılabilir); kapalı seçeneği
   ayarla.
8. **Ekran adları:** "Tükenene kadar" / "Pasif" / düğme "Kullanımdan kaldır" — ayara bağlanmaz.

## 15. Faz 0 kapısı

Açık kullanıcı sorusu kalmadı. Faz 0 = bu belgenin kullanıcı onayı. Uygulama sırasında ölçülecek iki
iş karar değil GÖREVdir ve ilgili dilimde yapılır: §4'teki taşıma listesinin kesinleşmesi (S3) ve
katı seçeneklerin çıkışsız kapı ölçümü (§4.1, S3).

## 16. Reddedilenler

- **Otomatik birleştirme** — yanlış çift iki kumaşın stok ve geçmişini karıştırır; sistem aynı kumaş
  olduğunu bilemez (D4).
- **Yalnız uyarı** — bugünkü durum; 2026-09-25 olayını üretti.
- **Bayrakla açılan kapı** — sıkışan stok hiçbir fabrikada istenen durum değil; çekirdek.
- **Otomatik arşiv (son top bitince)** — sessiz durum değişikliği; "Pasife hazır" rozeti + tek tık
  daha basit ve görünür.
- **Pasif kartta da mevcut stoğu akıtmak** — D1'i gevşetir; "pasif" yine iki anlama gelir.
- **Yeni advisory uzayı** — satır kilidi (`FOR UPDATE`/`FOR SHARE`) yeterli ve daha dar.
- **Ekran adlarını ayara bağlamak** — ad davranış değildir; TR-only bilinçli, her kurulumda aynı dil
  destek ve eğitimi sade tutar.
- **Ayarları profile koymak** — davranış ayarı kurulum verisidir, profil yalnız modül seçimidir
  (kök `CLAUDE.md` yasak listesi).
- **Her soru için ayrı boolean yığını** — seçenekler birbirini dışlar; tek seçimli ayar (enum) üç
  anlamsız birleşimi baştan imkânsız kılar.

## 17. Belge borcu (S8'de kapanır)

- ~~`deactivate-impact.helper.ts` başlığı bayat~~ — S4'te helper silindi (uyar-ama-bırak kalktı).
- `docs/design/MUKERRER-PANELI-TASARIM.md`: "geri alma bilinçli yok" cümlesi bayat (geri alma var).
- `docs/standart/MASTER-VERI-TASARIMI.md`: MV-06.
