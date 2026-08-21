# Mükerrer Kayıt Paneli v2 — Tasarım (2026-08-22)

**Bağlam:** DB sıfırlama rafa kalktı. Canlıda mükerrer ana veri var (müşteri 1 · kumaş 4 ·
fason 3 · renk 1 grup; test artığı istasyonlar dev'de) ve `nameFold` DB seddi (28. migration,
**yumuşak kapı**) bunlar birleştirilmeden prod'da kurulmuyor. Hedef: mükerrerleri **bulan,
inceleten, birleştiren** ve tekrarını **önleyen** bir panel; ek olarak kullanıcı canlı verinin
kopyası üzerinde SQL ile inceleme yapacak — paneldeki kararlar o çalışmayla köprülenmeli.

**Kullanıcı kararları (2026-08-22):** 28. migration **A — yumuşak kapı** · kapsam **ana veri
4'lü + müşteri şubeleri + toplar (hayalet KK1) + istasyon/makine/kategori** · tespit **kesin ad +
kimlik + bulanık ad** · birleştirme **alan-bazlı survivorship**.

---

## 0) Bugün elimizde ne var (yeniden yazılmayacak)

| Parça | Dosya | Durum |
|---|---|---|
| Birleştirme motoru (müşteri · kumaş · renk · fason) | `src/services/master-data-merge.service.ts` | tombstone (`mergedIntoId`), 42 kurallık FK taşıma (`constants/merge-map.ts`: MOVE / CONFLICT politikaları UNION · SKIP · MERGE_FIELDS · EMPTY_MEANS_ALL · BLOCK), kimlik alanı guard'ı (müşteri tipi, birim), önizleme, advisory kilit + atomik claim, audit, izin `master-data:merge`, **geri alınamaz** |
| Panel | `Electron/src/pages/System/Duplicates/` (+ liste "Mükerrerler" düğmesi, Ctrl+K) | grup listesi → survivor seç → önizleme → onay kapısı (`MergeConfirmGate`) |
| Tespit | `findDuplicates(entity)` | yalnız **kesin** `nameFold` eşitliği (renk: `foldColorNameForCompare`) |
| Önleme | `assertNameNotDuplicate` (+ ikizleri), `findSimilarNames` (kayıt anında uyarı), import `nameGuard` | var; 28. migration seddi (yumuşak kapı) |
| Top mükerreri | `scripts/find_duplicate_rolls.ts` | salt-okunur script; "hareket görmüş top kopya değildir" elemesi; iptalde `MUKERRER` kodu (2026-08-21) |
| Raporlar | `scripts/find_fold_duplicates.ts` | 17 tablo, soy bağı süzgeçli, sedli tablo işaretli |

Eksik olan motor değil: **tespit derinliği · inceleme akışı (kuyruk + kalıcı "mükerrer değil") ·
alan-bazlı birleştirme · kapsam · SQL/çevrimdışı köprü**.

## 1) Sektör referansı (MDM — ne alıyoruz, neyi bilinçli almıyoruz)

| Kavram | Referans | Bizim kararımız |
|---|---|---|
| Eşleştirme kuralları | Salesforce matching rules (exact/fuzzy alan bazlı), SAP MDG match config, Odoo "Merge Duplicate Contacts" (e-posta/ad/şirket grupları) | **Kural motoru**: kesin ad · kimlik çakışması · bulanık ad (skor). Her aday **gerekçeli** ("VKN aynı", "ad benzerliği 0.91") |
| İnceleme kuyruğu | Salesforce "Duplicate Record Set", SAP "cleansing case" | `duplicate_reviews` tablosu: BİRLEŞTİRİLDİ / MÜKERRER DEĞİL / ERTELENDİ; "mükerrer değil" **kalıcı** (aynı çift bir daha çıkmaz, kim/ne zaman/not) |
| Survivorship (altın kayıt) | Dynamics 365 merge (master + alan seçimi), MDM "trust/recency/completeness" kuralları | **Alan-bazlı seçim** + varsayılan kural: dolu olan → en çok referanslı → en yeni; seçimler audit'e |
| Birleştirme | Tüm referanslar yeniden bağlanır, kaynak pasif/yönlendirilmiş, tam audit; **geri alma yok** (SFDC/Dynamics'te de yok) | ✅ mevcut (tombstone + merge-map); geri alma **bilinçli yok** — önizleme + onay kapısı + gece yedeği |
| Önleme | Kayıt anında gerçek-zamanlı uyarı/engel | ✅ mevcut; temizlik sonrası DB seddi enforce (contract) |
| Malzeme (stok) birleştirme | SAP: yok — "takip malzemesi" + bloke | bizimki daha güçlü (tombstone + repoint); **kesim/üretim geçmişi TAŞINIR, kopyalanmaz** |
| İşlem kaydı (top) mükerreri | "birleştirme" değil **hayaleti iptal** (sebep kodu) | `MUKERRER` koduyla iptal; metraj/hareket taşımak YOK (fiziksel tek top) |
| Bulanık eşleştirme altyapısı | DB-tarafı trigram (pg_trgm) / dedicated MDM | ⚠️ canlıda `pg_trgm` **yok** → JS tarafında (Jaro-Winkler + token-set) — tablolar yüzlerce satır, O(n²) kabul |

## 2) Mimari

### 2.1 Tespit motoru (`duplicate-detection.service.ts`)
- Varlık başına **kural seti** (tek kaynak `constants/duplicate-rules.ts`):
  - **EXACT_NAME** — `nameFold` eşitliği (mevcut; renk için `foldColorNameForCompare`).
  - **IDENTITY** — müşteri: `taxNumber`, `phone`, `email`, `exportCode`; fason: `taxNumber`, `phone`; kumaş: `code` harf-ikizi (`foldCodeForCompare`), müşteri alias'ı ≠ kendi ama ad = başka kumaş; renk: `hex` eşit; şube (müşteri içinde): `nameFold`/`code`; istasyon/makine/kategori: `nameFold` (makine istasyon içinde).
  - **FUZZY_NAME** — katlanmış ad üzerinde Jaro-Winkler ≥ 0.90 **veya** token-set oranı ≥ 0.85 (JS); gürültü kelimeleri ("tekstil", "ltd", "şti", "a.ş.", "san.", "tic.") **düşük ağırlık**; skor + gerekçe.
- Çıktı: **aday çift** `{ entity, aId, bId, rules: [{rule, score, evidence}], refCountA, refCountB }`; gruplar çiftlerden türetilir (bağlı bileşen).
- Tarama **isteğe bağlı** (panelde "Tara") — sonuç `duplicate_scan_runs` (kim/ne zaman/kaç aday) ile saklanır; ağır değil (n≈yüzler).

### 2.2 İnceleme kuyruğu — yeni tablo `duplicate_reviews`
| Kolon | Not |
|---|---|
| `entity` (enum: CUSTOMER · ITEM · COLOR · SUBCONTRACTOR · CUSTOMER_BRANCH · STATION · MACHINE · SUBCONTRACTOR_CATEGORY · ROLL) | |
| `pairKey` (text, `min(idA,idB)+':'+max(idA,idB)`) `@@unique([entity, pairKey])` | çift kalıcı anahtar |
| `decision` enum: OPEN · NOT_DUPLICATE · MERGED · CANCELLED_DUPLICATE (top) · DEFERRED | |
| `decidedById`, `decidedAt`, `note`, `rules` (json: tespit gerekçeleri, snapshot) | |
| `createdAt`/`updatedAt` | |
- "MÜKERRER DEĞİL" → sonraki taramalarda **gizli** (filtreyle görülebilir; geri alınabilir).
- Birleştirme yapılınca motor satırı MERGED yazar (`mergedIntoId` zaten iz; bu satır **karar** izi).

### 2.3 Birleştirme v2 (`master-data-merge.service.merge` genişlemesi)
- Girdi: `survivorId`, `sourceIds`, `reason`, `acknowledgedConflicts` (mevcut) + **`fieldPicks: { [field]: value | {fromId} }`**.
- Seçilebilir alanlar varlık başına beyan (`MERGEABLE_FIELDS`): müşteri `name · taxNumber · taxOffice · phone · email · address · documentProfileId · exportCode`; fason `name · taxNumber · phone · address · categories`; kumaş `name · unit · itemType · description`; renk `name · hex`. Kimlik alanları (müşteri tipi, birim) seçilemez — çakışıyorsa BLOCK (mevcut).
- Varsayılan öneri (sunucu hesaplar, ekran gösterir): dolu → en çok referanslı → en yeni.
- Uygulama: mevcut tx sırası (kilit → taze oku → guard → yan etki → çakışma → taşıma → claim) + **survivor alan güncellemesi** (guard: ad seçimi diğer canlı kayıtlarla çakışmamalı — `assertNameNotDuplicate` ikizi). Audit `fieldPicks` + önce/sonra.
- Geri alma **yok** (bilinçli); onay kapısı: özet + "N satır taşınacak" + yazarak onay (mevcut).

### 2.4 Kapsam genişlemeleri
- **Müşteri şubesi** (`customer_branches`, müşteri içinde): merge-map'e `CustomerBranch` bloğu (sipariş `branchId`, sevkiyat, çuval, direkt sevk, iade); kimlik: aynı `customerId` (BLOCK).
- **İstasyon / makine / kategori:** merge-map blokları — istasyon (route_steps.stationId, work_order_steps, machines, station_properties UNION, kursun bypass); makine (work_sessions, roll.createdMachineId/entryStationId?, bypass); kategori (subcontractor_to_category UNION, route_steps.requiredCategoryId). ⚠️ `Station`/`Machine`/`SubcontractorCategory` modellerine `mergedIntoId/mergedAt/mergedById` + partial index (migration) — `modelHasMergeLineage` DMMF'ten otomatik tanır.
- **Toplar (hayalet KK1):** birleştirme DEĞİL. `find_duplicate_rolls.ts` mantığı servise (`duplicate-rolls.service`): aynı operatör/makine/ürün/metraj/en, N sn pencere, **hareket görmemiş** toplar; panelde grup → "asıl" işaretle → diğerleri `softDelete` (`reasonCode: MUKERRER`, onay: etiket basılmışsa `confirmLabelPrinted` zorunlu, çuval/sevkte olan ASLA). Karar `duplicate_reviews` (ROLL).

### 2.5 SQL / çevrimdışı köprü (kullanıcının çalışma biçimi)
- **Dışa:** aday raporu CSV (`;` + BOM, tr-TR — import sözleşmesiyle aynı) `entity, pairKey, aCode, aName, bCode, bName, rules, scores, refCounts`.
- **İçe:** karar dosyası CSV (`entity, survivorCode/Id, sourceCodes/Ids, decision, fieldPicks?, note`) → `scripts/apply_merge_decisions.ts` **dry-run varsayılan**, her kararı önizleyip listeler, `--apply` ile AYNI motordan geçirir (42 kural + audit). ⚠️ Ham SQL ile `UPDATE … customerId` taşımak merge-map'i atlar (alias/çuval/etiket snapshot/çakışma politikaları) — inceleme SQL'de, **uygulama motorda**.
- Prod kopyası (`tekserp_saha` tazeleme) üzerinde önce dry-run, sonra canlıda `--apply` (vardiya dışı, gece yedeği sonrası).

### 2.6 Önleme / contract
- Temizlik sonrası **enforce**: 28. migration dosyası yeniden koşulur (idempotent) → `test_db_invariants` §1 yeşil.
- Kimlik alanlarında DB seddi (VKN unique — fason'da var mı? müşteri?) ayrı karar; `taxNumber` normalizasyonu (boşluk/0) + partial unique `WHERE taxNumber IS NOT NULL AND mergedIntoId IS NULL`.
- Kayıt anında uyarı (`findSimilarNames`) → IDENTITY kurallarını da kullansın (VKN aynı → sert 409 mu? karar).

## 3) Fazlar (tahmin)
| Faz | İş | Süre |
|---|---|---|
| **P0** ✅ | 28. migration yumuşak kapı + doküman | yapıldı (2026-08-22) |
| **P1** | Tespit motoru (3 kural sınıfı) + `duplicate_reviews` + kuyruk ekranı (filtre: varlık/kural/skor; gerekçe; kararlar) + CSV dışa | 2,5 g |
| **P2** | Birleştirme v2: `fieldPicks` + varsayılan öneri + önizlemede alan tablosu + audit; Electron birleştirme diyaloğu | 2 g |
| **P3a** | Müşteri şubesi birleştirme (merge-map + panel) | 0,75 g |
| **P3b** | İstasyon / makine / kategori (migration `mergedIntoId` + merge-map + panel) | 1,5 g |
| **P3c** | Toplar: hayalet tespit servisi + panel + toplu `MUKERRER` iptal | 1 g |
| **P4** | `apply_merge_decisions.ts` (CSV içe, dry-run/apply) + rapor | 0,75 g |
| **P5** | Enforce + kimlik seddi kararı + bekçiler (`test_duplicate_detection`, `test_merge_field_picks`, merge-map kapsama bekçisi genişler) | 1 g |

Her faz: backend ÖNCE (yeni tablo/uç eski istemciyi bozmaz) → Electron. APK yalnız P3c'de
Depo/KK1 ekranına "mükerrer adayı" rozeti istenirse (opsiyonel).

## 4) Açık sorular (P1'e girmeden karar)
1. Bulanık eşik: 0.90/0.85 mi, yoksa panelde ayarlanabilir (SystemSetting) mi? (Öneri: sabit başla, ayar sonra.)
2. "Mükerrer değil" kararı **çift** bazlı mı **grup** bazlı mı? (Öneri: çift; grup = çiftlerin birleşimi.)
3. Müşteri VKN çakışmasında kayıt anında **engel** mi **uyarı** mı? (Bugün ad: engel; VKN fason'da engel, müşteride ?)
4. Top mükerrerinde "asıl" seçimi: en eski mi, etiketi basılı olan mı? (Öneri: etiketi basılan/hareket görenin asıl olması; hiçbiriyse en eski.)
