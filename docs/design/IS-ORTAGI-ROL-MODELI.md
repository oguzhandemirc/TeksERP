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

## 3. Saha güvencesi — bu fazın değişmezleri

- **Şema yalnız EKLER.** Bayrak kolonları eklenir; `type` kalır; `subcontractorId` kolonu kalır.
- **Varsayılan = BUGÜNKÜ DAVRANIŞ.** Backfill tipten bayrağa birebir; bağsız fason aynen çalışır.
- **Göç script'i veriyi kendi başına değiştirmez:** dry-run varsayılan, `--apply` ayrı, etkilenen her
  kayıt tek tek listelenir ve **kullanıcı koşar** (canlıda).
- **Eski istemci kırılmaz** — `type` hâlâ dolu ve doğru.
- **Prova kapısı** (§6) geçilmeden paket çıkmaz.

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

## 7. Sonraki faz (bu fazın DIŞI)

- `CariAccount.subcontractorId` kolonu ve iki CHECK (`cari_accounts_party_xor`,
  `cari_accounts_kind_matches_party`) KALDIRILIR — ancak bu fazın göçü sahada koşup hesaplar tek
  tarafa toplandıktan SONRA.
- `Subcontractor.customerId` NOT NULL'a çekilir (bu fazda bağsız profil hâlâ meşru).
- Kod öneki sorusu (`MUS…` tip bazlı önek) AYRI karardır; bu faz kod üretimine dokunmaz.
