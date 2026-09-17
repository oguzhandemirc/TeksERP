# İŞ ORTAĞI ROL MODELİ (SAP BP kalıbı, sadeleştirilmiş)

> **Durum:** PLAN + inen dilimler karışık. Her bölüm neyin BUGÜN doğru, neyin HEDEF olduğunu
> kendi başlığında söyler — bu belgeyi okuyup "öyleyse kodda da böyledir" diye varsaymayın.
> Kural satırları `docs/kurallar/fason.md` ve `docs/kurallar/finans.md`de; burada GEREKÇE ve ÖLÇÜM var.
> Faz kararı: kullanıcı, 2026-09-17. Faz kapısı aşağıda (§6) — **saha dump'ının taze kopyasında
> prova yeşil olmadan paket YOK.**

## 1. Sorun — bugünkü model neyi kaybediyor

Fabrika aynı firmayla üç ilişki kurabiliyor: ondan mal alıyor (tedarikçi), ona mal satıyor
(müşteri), ona iş yaptırıyor (fason). Bugün bunların ilk ikisi `Customer.type`
(`CUSTOMER`/`SUPPLIER`/`BOTH`) ile bir KART üzerinde, üçüncüsü ayrı bir tabloda (`Subcontractor`)
yaşıyor. Sonuç:

- **Tek firma iki kimlik.** Aynı firmanın cari kartı ile fason kaydı ayrı satırlar; ad çakışması
  denetimi bile aynı tablo içinde çalışıyor (master-data birleştirme tek model üzerinde).
- **İki cari hesap riski.** `CariAccount` hem `customerId` hem `subcontractorId` taşıyabiliyor (XOR,
  iki DB CHECK) ve `ensureCariAccountTx` hesabı ihtiyaç anında doğuruyor. Bağlı bir fason profilinin
  hesabı, kartın hesabıyla BİRLEŞMİYOR: aynı firmanın borcu iki satırda görünebiliyor. **Fazın asıl
  hedefi budur.**
- **`type` bir DUVAR sanılıyor ama değil** (ölçüldü 2026-09-17): satış, alış, sevk ve fatura yolları
  tipe BAKMIYOR. Tipi bugün yalnız iki yer okuyor — fason profili bağı (`CUSTOMER` → 400) ve
  birleştirme kimlik kapısı (farklı tipler birleşmez). Yani `type` bir ETİKETTİR; rol modeli onu
  kaldırmaz, ARKASINA gerçek bir kaynak koyar.

## 2. Hedef model

1. **Kart = `Customer`** (tablo adı değişmez; konuşurken "iş ortağı kartı"). Roller kartta ÜÇ BAYRAK:
   `isCustomerRole` · `isSupplierRole` · `isSubcontractorRole` (Boolean, varsayılan `false`).
2. **`type` KALIR ve TÜRETİLİR** — ilk iki bayraktan (`CUSTOMER`/`SUPPLIER`/`BOTH`), tek yazarı olan
   bir çözücü üzerinden. Gerekçe: eski istemci ve eski rapor `type` okuyor; alanı boşaltmak
   sözleşmeyi kırardı. **Yeni kod rolleri okur, `type`a yazmaz.**
3. **Fason rolü = bayrak + profil.** `Subcontractor` tablosu KALIR ve "fason profili" olur
   (`categories`, `isFavorite` + 12 operasyon ilişkisi). Profil kimliği (`Subcontractor.id`)
   DEĞİŞMEZ ⇒ fason sevk/kabul, levent, dokuma ve kartela geçmişi dokunulmaz.
4. **Cari hesap TEKTİR:** `CariAccount` yalnız `customerId`ye bağlanır. `subcontractorId` kolonu ve
   iki CHECK bu fazda KALIR (yalnız NULL'a çekilir) — kolonu düşürmek ayrı fazın işidir (§7).

### 2.1 Hesap taşımanın ÖLÇÜLMÜŞ üç tuzağı (d9, 2026-09-17)

- **Bakiye REPOINT EDİLEMEZ, TOPLANIR.** `CariBalance`ın PK'sı `(cariId, currency)`: hedef kartın
  aynı para biriminde satırı varsa `cariId`yi çevirmek PK ihlalidir ⇒ göç, para birimi BAŞINA
  TOPLAR. Bu, "çocuk satırları yeni ebeveyne bağla" refleksinin çalışmadığı tek çocuk.
- **Hesabın tarafını çevirmek TEK UPDATE'tir.** `customerId` yazıp `subcontractorId`yi ayrı ifadede
  `null`lamak, iki CHECK'in (`cari_accounts_party_xor`, `cari_accounts_kind_matches_party`) arada
  ihlal edildiği bir ara durum üretir ⇒ üç alan (`customerId` · `subcontractorId=null` · `kind`)
  AYNI UPDATE'te yazılır.
- **Tombstone profile kart ÜRETİLMEZ.** `mergedIntoId` dolu profil bir birleştirme artığıdır; ona
  kart açmak, birleştirmeyle kapatılmış bir kimliği geri diriltirdi.

### 2.2 HESABIN TEK YAZARI — ölçülen açık delik (faz 2, dilim A)

Göç hesapları karta topluyor; ama hesabı DOĞURAN yol hâlâ fason bacağını kabul ediyor.
`ensureCariAccountTx` (`services/helpers/finance.helper.ts`) `subcontractorId` aldığında
`kind: SUBCONTRACTOR` ile YENİ hesap açıyor ve bu yol beş çağrı noktasından ulaşılabilir
(doğrulandı 2026-09-17: `invoice.service` ×3 — alış/mal kabul faturası · `payment.service`
· `cheque.service` ×2 — karşı taraf ve ciro).

⇒ **Göçten sonra bağlı bir fasona kesilen İLK fatura ikinci hesabı yeniden doğurur** ve "tek cari
hesap" vaadi sessizce bozulur. Göç bunu ONARAMAZ: göç geçmişi toplar, geleceği kapatmaz.

**Kural (dilim A, 1.3.2'ye ZORUNLU):** hesap açan tek yazar, tarafı ÖNCE ÇÖZER — gelen
`subcontractorId` profilin kartına (`customerId`) çevrilir ve hesap KARTA açılır/bulunur
(`kind: CUSTOMER`). Profil bağsızsa (göç koşmamış kurulum) eski yol aynen çalışır: varsayılan =
bugünkü davranış. XOR CHECK'lere dokunulmaz; ekstre, yaşlandırma ve raporlar `cariId` ile
çalıştığı için değişmez.

**İNDİ** (`1f3b9995`): çözücü `resolveAccountPartyTx` (`helpers/finance.helper.ts`), bekçi
`scripts/test_cari_hesap_tek_yazar.ts` — bağlı fasona fatura + ödeme + çek kesilir, hesap KARTTA
doğar, `subcontractorId` null ve ikinci hesap DOĞMAZ; negatif sonda: çözücü çağrısı kaldırılınca
kırmızı.

## 3. Saha güvencesi — bu fazın değişmezleri

- **Şema yalnız EKLER.** Bayrak kolonları eklenir; `type` kalır; `subcontractorId` kolonu kalır.
- **Varsayılan = BUGÜNKÜ DAVRANIŞ.** Backfill tipten bayrağa birebir; bağsız fason aynen çalışır.
- **Göç script'i veriyi kendi başına değiştirmez:** dry-run varsayılan, `--apply` ayrı, etkilenen her
  kayıt tek tek listelenir ve **kullanıcı koşar** (canlıda).
- **Eski istemci kırılmaz** — `type` hâlâ dolu ve doğru.
- **Prova kapısı** (§6) geçilmeden paket çıkmaz.
- **Kolon/tablo/CHECK KALDIRMA bu sürümde YOK.** Faz 2'nin kuralı "yeni yazım kapatılır, okuma
  kalır": yazma yolu fail-closed olur, okuyan her şey geriye dönük çalışmaya devam eder. Kaldırma
  ayrı fazdır ve koşulu ÖLÇÜLÜR (§7).

## 4. Ölçülen zemin (saha dump'ı, 15 Eylül kopyası)

| Ölçüm | Değer |
|---|---|
| Cari kartı | 37 (hepsi `type=CUSTOMER`) |
| Fason kaydı | 11 (8 aktif) |
| Ad çakışması (cari ↔ fason) | 0 |
| Cari hesap (fasona bağlı) | 1 — HAREKETSİZ (fatura 0, ödeme 0) |
| Alış siparişi / mal kabul | 0 / 0 |
| Fason sevk / kabul | 398 / 329 (profil kimliğine bağlı, dokunulmaz) |
| Sipariş / sipariş veren müşteri | 488 / 23 |

⇒ **Veri göçü küçük, risk KOD ve EKRAN tarafında.** Script yine de genel yazılır: başka kurulumda
bağsız profil ve hareketli hesap bulunabilir.

### 4.1 PROVA SONUCU — 2026-09-17, İKİ KOPYADA YEŞİL (1e koştu)

| Koşum | Sonuç |
|---|---|
| Temiz saha kopyası | **5 kart üretildi**, **3 tombstone profil ATLANDI**; ikinci koşum **0 değişiklik** |
| Fikstürlü kopya (hesaplı/çakışmalı senaryolar) | **8 kart**, **1 cari hesap kartın tarafına çevrildi** |
| Tip ↔ bayrak tutarsızlığı (her iki kopyada) | **0** |

⚠️ **Şerh (prova çıktısından):** üretilen kartın ADI servis kanoniğinde, yani BÜYÜK HARFLE yazılır —
profildeki yazım birebir taşınmaz. Bu bir kusur değil, kart adı kuralının fason profiline de
uygulanmasıdır; ama listeyi okuyan "ad değişmiş" diye okumasın diye burada yazılı.

## 5. Dilimler

| Dilim | Sahip | Kapsam |
|---|---|---|
| D1 backend şema + servis | 01 | Üç bayrak + migration (backfill: tip → iki bayrak; `customerId` dolu profilde `isSubcontractorRole`) · `type` türetme TEK YAZAR · `filter[role]` (CSV → bayrak OR) · swagger enum düzeltmesi · `test_subcontractor_customer_profile §2` yüklemi "tip" yerine ROL · db_invariants / schema_drift / hard_delete / merge_fk allowlist'leri ÖLÇEREK güncellenir |
| D2 göç script'i | d9 | `scripts/migrate_partner_roles.ts`: (a) bağsız profil → yeni kart (ad çakışmasında ÖNERİ, otomatik bağlamaz; **tombstone profile kart yok**) · (b) fasona bağlı hesap → kartın hesabına taşı/birleştir (defter satırı SİLİNMEZ; harekete birleştirme izi + audit; **bakiye para birimi başına TOPLANIR**, taraf çevirme TEK UPDATE — §2.1) · (c) etkilenen her kayıt raporu. Bekçi: üç senaryo + **idempotent ikinci koşum 0 değişiklik** |
| D3 panel | 01 | Tip seçimi yerine üç onay kutusu; Cariler şeridinde İKİ süzgeç (ticari yön · fason) — süzme SUNUCUDA |
| D4 mobil | 0c/d5 | `CompanyType` union drift düzeltmesi + enum ayna kolu |
| D5 belge + prova | 5e + 1e | Bu belge · kural satırları · sürüm notu · prova reçetesi (§6) |

## 6. Prova reçetesi — faz kapısı (1e koşar, taslak)

Sıra bağlayıcıdır; her adım bir ÖNCEKİNİN çıktısına bakar.

1. **Kopya** — 15 Eylül saha dump'ının TAZE kopyası ayrı bir veritabanına restore edilir. Canlıya ve
   fabrikanın dev yedeğine DOKUNULMAZ.
2. `npx prisma migrate deploy` — yalnız ekleyen migration'lar; `applied_steps_count` ile değil,
   kolonun VARLIĞIYLA doğrulanır.
3. **D2 dry-run** — `npx tsx scripts/migrate_partner_roles.ts`. Beklenen (§4'ten): bağsız profil
   sayısı kadar "yeni kart" önerisi, 1 hesap taşıma, ad çakışması 0 ⇒ öneri satırı 0. Çıktı SAKLANIR.
4. **`--apply`** — yalnız dry-run çıktısı okunduktan sonra.
5. **İkinci koşum** — aynı komut yeniden: **0 değişiklik** (idempotency kanıtı).
6. **Bekçiler** — `BEKCI_HEDEF_ONAY=1` YALNIZ bu kopyada; hedef DB adı basılarak.
7. **Profil boot** — fabrikanın profiliyle backend açılır; açılış kapıları yeşil.

Herhangi bir adım kırmızıysa faz durur; paket çıkmaz.

**Durum: PROVA GEÇTİ** (2026-09-17, iki kopya — sayılar §4.1). Yayın günü aynı sıra CANLIDA
tekrarlanır: `migrate deploy` → dry-run (çıktı saklanır) → kullanıcı onayı → `--apply` → ikinci koşum
0 değişiklik → panel/tablet paketi. Koşan KULLANICIDIR; reçete `docs/kurallar/surum-yayin.md`,
runbook `docs/ops/IS-ORTAGI-ROL-GOCU.md`.

## 7. KALDIRMA FAZI (sonraki sürüm, 1.3.3+) — koşulu ÖLÇÜLÜR

Bu fazda hiçbir kolon, tablo ya da CHECK KALDIRILMAZ. Kaldırma ayrı bir sürümün işidir ve
**açılış koşulu bir karar değil bir ÖLÇÜMDÜR.**

### 7.1 Açılış koşulu — dört yeşil (hepsi aynı koşumda)

`scripts/test_rol_modeli_kalinti.ts` (d9 yazacak; DB'li, ÜÇ SONUÇLU) fabrikanın dump KOPYASINDA
koşar ve dördünü birden ölçer:

1. **Bağsız fason profili = 0** (tombstone hariç — birleştirme artığına kart üretilmiyor, §2.1).
2. **`cari_accounts.subcontractorId IS NOT NULL` = 0** — fason tarafına bağlı hesap kalmamış.
3. **`Customer.type ≠ resolveCompanyType(roller)` = 0** — türetme ile saklanan değer ayrışmamış.
4. **Sahada eski istemci = 0** — son 30 günde panel < 1.3.2 ya da tablet < 1.0.7 görülmemiş.
   **AÇILDI 2026-09-17:** `Session.clientVersion` (migration `20260917090000_session_client_version`)
   giriş anında istemcinin künye başlığından yazılır; kol artık üç sonucu da üretebilir. Eşikler
   bekçide beyanlıdır (ELECTRON/WEB ≥ 1.3.2 · MOBILE ≥ 1.0.7) ve `minVersion` POLİTİKASI DEĞİLDİR —
   sahayı kilitlemez, yalnız "kaldırma açılabilir mi" sorusunu cevaplar.
   ⚠️ **Ölçüm penceresi alanın EKLENDİĞİ ANDA başlar** ve başlangıç migration'ın KLASÖR ADINDAN
   okunur (elle sabit tarih yazılmaz). O damgadan önceki her oturum NULL'dur; 30 gün dolmadan
   hiçbir hüküm verilemez ve kol ⏭ *"alan N gün önce eklendi, pencere henüz dolmadı"* der.
   ⚠️ ÖLÇÜLEMEDİ üç sebepten doğar: ① pencere dolmadı · ② pencerede hiç oturum yok (körlük zemini:
   "kimse girmemiş" ≠ "eski istemci yok") · ③ oturumların bir kısmı sürümsüz ya da sürüm etiketi
   çözülemiyor. Üçünde de **kaldırma fazı AÇILMAZ**: "görülmedi" ile "yok" aynı şey değildir.
   ⚠️ Yazım login ANIYLA SINIRLI DEĞİL: panel sürümünü main process'ten asenkron okuduğu için ilk
   istek (login) sürümsüz gidebiliyor; `lastSeenAt` dokunuş yolunda satır YALNIZ NULL'dan doluya
   tamamlanır (`revokedAt IS NULL` koşullu). Dolu satır ikinci bir sürümle DEĞİŞMEZ — bir oturum tek
   istemciye aittir ve değişebilseydi uydurulabilir bir başlık kapının gördüğü değeri çevirirdi.
   ⚠️ Künye başlığı UYDURULABİLİR ve bu bilinçli olarak kabul edilmiştir: değer hiçbir yetki/kapı
   kararına girmez, yalnız bir İNSAN kararını besler — ve *eksiklik güvenli yöndedir*, çünkü
   başlığı göndermeyen eski istemci NULL bırakır ve kol "temiz" DEMEZ.

Dördü yeşil değilse faz açılmaz; üç yeşil + bir ölçülemedi de AÇMAZ.

### 7.1b AYNI SINIFTAKİ ÜÇ BORÇ DAHA — "bir firma, iki adres" (MV-02)

`CariAccount` bu kalıbın tek örneği DEĞİL. Şemada `Customer` ve `Subcontractor`a AYNI ANDA bağlanan
dört model var (tarandı 2026-09-17); `Customer`/`Subcontractor`ın kendi satırları (profil bağı ve
tombstone) sayılmaz:

| Model | Çift bağ | Kapı türü | Saha | Kaldırma koşulu |
|---|---|---|---|---|
| `CariAccount` | `customerId` XOR `subcontractorId` | İKİ DB CHECK | 1 hesap (göçle karta taşındı) | §7.1 ①②; yazım kapısı İNDİ (`resolveAccountPartyTx`) |
| `WarpBeam` (PURCHASED) | `supplierId` XOR `subcontractorId` | yalnız şema yorumu (`///`) — DB CHECK YOK | levent 0 (devere kapalı) | bağsız profil 0 + eski istemci 0; yazım kapısı: 01 dilim E |
| `PurchaseOrder` | `supplierId` XOR `subcontractorId` | yalnız SERVİS (`helpers/supplier-party.helper`) | alış siparişi 0 | aynı; yazım kapısı: 01 dilim E |
| `GoodsReceipt` | `supplierId` XOR `subcontractorId` | yalnız SERVİS (aynı helper) | mal kabul 0 | aynı; yazım kapısı: 01 dilim E |

Son üçü bir tasarım hatası DEĞİL, 2026-08-15 "alış her cariden yapılabilir" kararının (C4) sonucudur
ve o karar hâlâ geçerli — değişen şey, artık firmanın TEK KARTI olması: bağlı bir fasona kesilen alış
siparişi/mal kabulü ya da planlanan satın alma leventi `subcontractorId` yazarsa, kartı dururken
**ikinci adres** doğar. `ensureCariAccountTx` ile birebir aynı sınıf ⇒ aynı çare: **yazımda taraf
önce ÇÖZÜLÜR** (bağlı profil → kartın `supplierId`si), **okuma her ikisini de kabul eder**
(geriye dönük). Bu yazım kapısı **01 dilim E**'nin işidir (1.3.2); sha inince bekçi adı buraya yazılır.

⚠️ `WarpBeam.ownerCustomerId ↔ subcontractorId` çifti bu listeye GİRMEZ: "malın sahibi" ile "işi
yapan" İKİ AYRI EKSENDİR ve aynı anda dolu olmaları meşrudur (şema yorumu: kolon `supplierId`e
bindirilmez). MV-02 "aynı ROLÜN iki adresi"ni yasaklar, iki farklı rolü değil.

### 7.2 Migration sırası — üç AYRI migration, her biri kopyada prova

Sıra bağlayıcıdır; her adım bir öncekinin bıraktığı durumu varsayar. Her migration
`migrate dev --create-only` ile üretilir, çıktıdaki `DropForeignKey` satırları SİLİNİR ve fabrika
dump'ının TAZE kopyasında prova edilir (restore → deploy → bekçiler → profil boot).

| # | Adım | Eski istemci ne yapar |
|---|---|---|
| 1 | `cari_accounts`: önce `customerId NOT NULL`, sonra iki CHECK (`cari_accounts_party_xor`, `cari_accounts_kind_matches_party`) kaldırılır ve `subcontractorId` kolonu DROP | Hesabı `cariId` ile okuyan her istemci etkilenmez; yalnız `subcontractorId` alanını GÖNDEREN bir yazıcı kalmışsa 400 alır — koşul ②, böyle bir yazıcının sahada olmadığını ölçer |
| 2 | `Customer.type` kolonu DROP + `CompanyType` enum DROP | ⚠️ EN RİSKLİ ADIM: `type` okuyan eski panel/tablet alanı `undefined` görür ve rozet/etiket boş kalır. Bu yüzden ÖN KOŞUL yalnız ④ değil, **panel ve mobilin `type` okumayı BIRAKTIĞININ ölçülmesidir** (faz 2 dilim C) |
| 3 | `Subcontractor.customerId NOT NULL` | Bağsız profil yaratmaya çalışan eski istemci 400 alır; koşul ①, sahada bağsız profil kalmadığını ölçer |
| 4 | `WarpBeam` · `PurchaseOrder` · `GoodsReceipt`: `subcontractorId` kolonları DROP (§7.1b) — her biri AYRI migration, sırası kendi içinde serbest | Bu alanları GÖNDEREN eski istemci 400 alır; okuma yolları zaten kartı çözdüğü için listeler ve belgeler etkilenmez. Ön koşul: dilim E'nin yazım kapısı sahada en az bir sürüm boyunca koşmuş olmalı |

### 7.3 Kaldırılmayacak olan

**`Subcontractor` tablosu KALIR.** Tam birleşme (profili `Customer`a eritmek) KULLANICI TARAFINDAN
REDDEDİLDİ (2026-09-17): profil 12 operasyon ilişkisi taşıyor ve 27 panel + 27 mobil dosya okuyor;
kimliği değiştirmek fason sevk/kabul geçmişini ve levent/dokuma/kartela bağlarını yeniden yazmak
demekti. Rol modeli bunu zaten gerektirmiyor — kart KİMLİK, profil ROL VERİSİDİR.

Kod öneki sorusu (`MUS…` tip bazlı önek) AYRI karardır; bu faz da kod üretimine dokunmaz.
