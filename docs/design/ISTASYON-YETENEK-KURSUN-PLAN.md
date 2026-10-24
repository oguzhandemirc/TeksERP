# İstasyon yeteneği (kalite muayenesi) + Kurşun gramajı: dilimli plan (KQ)

**Durum: TASLAK 2026-10-24** · Patron oturumu · Yazan: plan yazarı ajanı · Girdiler: `scratchpad/kalite-kursun/{KARARLAR,KQ-R1}.md`, `docs/design/KALITE-4PUAN-PLAN.md` (K4P) · Taban `origin/main` @ `6d59c9116`.

> Kod YAZILMADI. Bu belge dilimlerin sözleşmesidir. Her dilimin ajan istemi `scratchpad/kalite-kursun/istemler/<KOD>.md`dedir ve buradakinin kopyasıdır. İkisi çelişirse BURASI kazanır; BURASI `KARARLAR.md` ile çelişirse KARAR kazanır. Satır numaraları `6e1962f60`/`6d59c9116` tabanındandır, dilim ajanı yeniden ölçer.

## 0 · İstekler ve kapsam

**Kullanıcı istekleri (aynen):**

1. "kalite kontrol istasyonu bazen tamburla bazen bizim şu anki gibi kurşunla bazen başka istasyonla birlikte bazen de tamamen bağımsız olabiliyor. buna çözümü nasıl üretebiliriz. hepsinin yaptığı iş aynı şuanki ekranda olduğu gibi elindeki kumaşın hangi metrelerinde hangi hata var bunu sisteme girip sonraki ilgili istasyonu bilgilendirmek."
2. "bizim kurşun istasyonunda şu an sadece kalite kontrol ekranı var, oradan geçen kumaş kurşun yapıldı özelliğini alıyor. ama kurşun kaç gr yapıldı gibi şeyler yok bundan dolayı eğer kurşun ekranı tamamen ayrılırsa bir işletmede. yani kurşun ayrı kalite kontrol ayrı bir ekran olursa kurşun istasyonunda hangi tuşların/özelliklerin olacağını belirleyebilmeliyiz. kurşun istasyonunda birkaç çeşit gramaj uygulanıyor, ama bunlar işletmeye göre değişiklik gösterebilir bu yüzden bunun yetkili tarafından eklenebiliyor olması önemli. örneğin sisteme 25gr 50gr ve 100 gr olarak 3 tane girilirse kurşuncunun ekranında 3 tanesi de çıkar o hangisini bastıysa iş emrine partiye kumaşa gibi hangilerine gerekiyorsa işlenir."

"bu ikisi artık benim sana vereceğim son görevlerdi iyi çalış, planlamanı detaylı yap araştırmanı iyi yap ve uygula, karar verme işi sende."

**Kapsam (v1):**
- Kalite muayenesi istasyon TÜRÜ olmaktan çıkar, istasyonun YETENEĞİ olur (`Station.inspectionEnabled`).
- Dört düzen tek gövdeden kurulur: yalnız kalite · yalnız kurşun · kurşun + kalite (bugünkü) · tambur + kalite.
- Kart okutma oturum istasyonunun adımını bulur.
- Tek hata giriş bileşeni kullanılır. Önceki adımların hataları sonraki istasyonda gri ve salt-okunur görünür, kartta rozet çıkar.
- Tambursuz rotada hata kararını sonraki karar veren istasyon verir. Böyle istasyon yoksa hata bilgisi kaybolmaz.
- Yetkili tanımlı kurşun gramajı tablette düğme olur. Basılan gramaj topa defter kaydı olarak işlenir; parti, iş emri ve raporda toplanır. İş emrine hedef gramaj verilebilir. Kâğıt dağıtımında gramaj isteğe bağlıdır.

**Kapsam dışı:**
- 4 puan muayenesinin süreç konaklarında saklanması (K4P §4.7 Faz 2).
- Bildirim türü `kalite.hatali-top-geldi` (bildirim kataloğunun v2 dalgası).
- Kurşun tüketimi kg (`numericValue`).
- Patron bulutu projeksiyonu.
- Kurşuncu ve kaliteciye ayrı mobil izin.
- Tambur'un yetenekleşmesi (Faz B R10).

## 1 · Teşhis (kod kanıtı)

| # | Bulgu | Kanıt |
|---|---|---|
| T1 | "Kalite" ikizi aslında AKIŞ sorusunu cevaplıyor ("bu adım KursunQc kart akışında mı yürür / kurşun dağıtım hedefi mi"). Toplam ~30 çağrı yeri var, hepsi akış ya da dağıtım sorusu soruyor. | `Teks-Erp/src/services/helpers/quality-station.helper.ts` (`kind === PROCESS_QC \|\| appliesQuality`); çağıranlar `kursun-qc.service.ts` (11), `kursun-bypass.service.ts` (8), `kursun-bypass-guard.helper.ts:118`, `kursun-bypass-eligibility.helper.ts:226`, `inventory.service.ts` :2002/:4994/:5444/:5449, `order-line-scope.helper.ts:40`, `station-capability.service.ts:155` |
| T2 | Kurşun dağıtım makine listesi "kalite istasyonu makineleri"dir. Kabul yolu ise ek olarak `KURSUN` özelliğinde `AUTO` arıyor, yani liste ile kabul ayrışık. Tambur'a `appliesQuality` verilirse Tambur makineleri listeye düşer. | `kursun-bypass.service.ts:523-526` liste; `:940-956` kabulde AUTO şartı |
| T3 | Kart çözümü İLK PROCESS_QC adımına bakıyor. Kurşun→KK→Tambur rotasında KK tableti kurşun adımına düşer ve 400 alır. | `kursun-qc.service.ts:240-262` → `roll-step.helper.ts` `assertWoAtStepKind` |
| T4 | Açık kartlar istasyona göre süzülmüyor; KK tableti kurşun kartlarını da görür. | `kursun-qc.service.ts:306` |
| T5 | Hata girişi akışa örtük bağlı. Tambur'da tür karşılaştırmasıyla açılıyor. Üç ayrı yazar var. | `kursun-qc.service.ts:653`, `tambur.service.ts:1896` (`kind !== TAMBUR → 400`) ve `:1949`, `inventory.service.ts:5589` |
| T6 | "Kurşun yapıldı" kararı iki yerde kopya ve `code === "KURSUN"` koda gömülü. Gramajın kurşunla bağı yok. Defter satırında (`RollOperation`) değer alanı yok. | `kursun-qc.service.ts:436-440`, `inventory.service.ts:5551-5555`; `schema.prisma` `model RollOperation` |
| T7 | SEÇİM tipli özellik (değer listesi) zaten var: panelden eklenir, pasife alınır, tablette çip olarak çizilir. | `FabricPropertyValue`, `PropertyValuesField.tsx`, `KursunQcScreen.tsx:1472-1546` |
| T8 | KK2 ekranı yalnız KENDİ adımının hatalarını çiziyor. Önceki adımın hatası ara istasyonda görünmüyor. | `kursun-qc.service.ts:1449-1450` (`detectedAtStepId: stepId`) |
| T9 | Karar istasyonu (Tambur) olmayan rotada açık hatayı kapatan ya da taşıyan yol yok. | `finalizeRollsAtLastStep` hatalara dokunmuyor |
| T10 | İş emri hedef özelliği (`WorkOrderTargetProperty`) toplara yayılıyor ve SEÇİM tipini reddediyor. Hedef gramaj bu tabloya konamaz. | `order.service.ts:1071-1075` `assertTargetablePropertyIds`; `workorder.controller.ts:1191` "bağlı Roll.properties senkron" |
| T11 | Kâğıt (bypass) rejimi `RollOperation` yazmıyor. Gramaj bu rejimde hiç bilinmiyor. | `kalite.md` "bypass'ta bu satırlar YAZILMAZ"; `model KursunBypassAssignment` |
| T12 | Bypass uygunluğu "sonraki adım TAMBUR" türüne bakıyor (Faz B R3). Kurşun→KK→Tambur rotasında kâğıt rejimi sessizce kapanıyor. | `kursun-bypass-eligibility.helper.ts:181` |

Ayrılmayı engelleyen asıl üçlü **T1, T3 ve T4**'tür; diğerleri yüzey işidir.

## 2 · Kararlar (bağlayıcı; tam metin `KARARLAR.md`)

| # | Karar | Plan karşılığı |
|---|---|---|
| K1 | **İki soru, iki kaynak.** Akış sorusu `stepRunsStepFlow` (istasyon türü), kalite sorusu `stepCanApplyQuality` (yalnız muayene yeteneği). İkisi aynı dosyada durur ve AST bekçisiyle korunur. K4P'nin `stationCanInspect`'i bu kalite fonksiyonunun KENDİSİDİR. Tambur kurşun dağıtım listesine düşmez (bekçiyle ölçülür). | §3.1, D1 |
| K2 | **V1 ölçümsüz:** yeni kolon `Station.inspectionEnabled`, migration'da her istasyonun BUGÜNKÜ ETKİN davranışından SQL ile türetilir. Fabrika DB'sine sorgu atılmaz. `appliesQuality` true olsa bile türetme dışında kalan istasyon false alır. `appliesQuality`'nin diğer kullanımlarına dokunulmaz. | §3.2, D1 |
| K3 | Kart okutma adımı oturum istasyonundan çözer. Oturum istasyonu olmayan istek bugünkü davranışla çalışır. | §3.3, D2 |
| K4 | EKRAN istasyon türünden seçilir (bugünkü gibi), ekranın İÇİNDEKİ paneller yetenekten kurulur. Yeni davranış bayrağı açılmaz; varsayılan veriyle korunur. | §3.7, §4, D3/D5/D7 |
| K5 | Gramaj için yeni ana veri tablosu açılmaz. Mevcut özellik tipi + `FabricProperty.variantOfPropertyId` + `RollOperation.propertyValueId` kullanılır. Düzeltme = eski kayıt damgalanır + yeni kayıt yazılır. Parti ve iş emri görünümünde toplam gösterilir. | §3.4, §3.5, D4/D6 |
| K6 (V2) | TEK hata giriş bileşeni. K4P 4 puan modu açıksa bileşen boyut sınıfını da sorar. İki ayrı hata ekranı olmaz. | §3.7, D3 |
| K7 (V3) | Tambursuz rota: kararı rotada sonraki ilk "karar veren" yetenekli istasyon verir. Böyle istasyon yoksa hatalar bilgi olarak topun etiketine ve sevk belgesine taşınır. | §3.8, D8 |
| K8 (V4) | Kâğıt dağıtımında gramaj panelde İSTEĞE BAĞLI girilir. Girilmezse "gramaj bilinmiyor" görünür. | §3.5, D6 |
| K9 (V5) | İş emrine isteğe bağlı "hedef kurşun gramajı" girilebilir. Tablet hedef düğmeyi vurgular ve sapmayı işaretler, ENGELLEMEZ. | §3.6, D5/D6 |
| K10 | Önceki adım hataları sonraki istasyonda gri ve salt-okunur görünür, kartta hata sayısı rozeti çıkar. Bildirim türü bildirim kataloğunun v2 dalgasına bırakılır. | §3.7, D7 |
| K11 | Sıra: D1 → (D2 ∥ D4 ∥ K4P-KK1) → (D3 ∥ D6) → (D5 ∥ D7) → D8. D1, K4P'nin KK1 diliminden ÖNCE iner. | §5 |

**V6–V10 (patron kararı: rapor önerisi):**
- **V6 (bildirim):** v2 dalgasına bırakıldı (K10).
- **V7 (izin):** tablet oturumu ekran ailesi izninde kalır (`mobile:kk2-kursun`); ayrı `mobile:kursun`/`mobile:kalite` izni AÇILMAZ.
- **V8 (patron bulutu):** v1'de projeksiyon yok.
- **V9 (çevrimdışı kuyrukta pasifleşmiş gramaj):** K4P ilkesi uygulanır, "dokunulduğu an aktifti → KABUL". Kabul yalnız bağlı çeşit özelliğinin kendi değerleri için geçerlidir; yabancı değer 400 alır.
- **V10 (İE hedef gramajı):** v1'e alındı (K9), D6'da.

## 3 · Mimari

### 3.1 İki soru, iki ikiz: `quality-station.helper.ts`

| Soru | Bellek ikizi | Prisma ikizi | select | Gövde | Tüketici |
|---|---|---|---|---|---|
| **Akış:** "Bu adım ara-istasyon kart akışında mı yürür (kart → top başına tamamla → adımı kapat)? Kurşun kuyruğu ya da dağıtım adayı mı?" | `stepRunsStepFlow(s)` | `STEP_FLOW_WHERE` | `STEP_FLOW_SELECT {kind, appliesQuality}` | Bugünküyle BAYT-EŞİT: `kind === PROCESS_QC \|\| appliesQuality` | bugünkü ~30 çağrı yeri (mekanik yeniden adlandırma) |
| **Kalite:** "Bu istasyonda kalite paneli (hata kaydı / muayene) açılır mı?" | `stepCanApplyQuality(s)` (+ `export const stationCanInspect = stepCanApplyQuality`) | `QUALITY_STATION_WHERE = {inspectionEnabled: true}` | `STEP_QUALITY_SELECT {inspectionEnabled}` | `s.inspectionEnabled` | KK2 hata yaz/sil, `kursunFinish` hata yolu, Tambur hata yazma, panel DTO, StepSummary/oturum `canInspect`, K4P |

- **Akış gövdesi neden değişmiyor:** KARAR K2 "ölçümsüz" der. `appliesQuality` kolu Faz A köprüsüdür ve bu planın dışında kalır. Düşürülmesi ölçüm ister (§7 V-c). Tambur'a kalite yeni kolonla verildiği için Tambur akışa girmez (T1 kapanır).
- **Kurşun dağıtım hedefi** üçüncü bir yüklem değildir. Akış ikizi ile `KURSUN` özelliğinin `AUTO` modda olması birleştirilir: `KURSUN_DISPATCH_STATION_WHERE = { AND: [{...STEP_FLOW_WHERE}, {propertyCapabilities: {some: {mode: AUTO, property: {code: 'KURSUN'}}}}] }`. `listDistribution` makine listesi ve `assign` kabulü bu tek parçadan beslenir (T2: bugün liste daha geniş, kabul 400 veriyor; birleşim yalnız zaten reddedilecek makineleri listeden düşürür). `code === 'KURSUN'` okuması tek sabite iner: `KURSUN_PROPERTY_CODE` (helper'da).
- **Yeniden adlandırma tuzağı:** bugünkü `QUALITY_STATION_WHERE`/`stepCanApplyQuality` adları AKIŞ çağrılarında duruyor ve D1 bu adların ANLAMINI değiştiriyor. Unutulan bir çağrı yeri sessizce "muayene" sorusuna döner. Önlem:
  1. D1 iki commit'tir. (a) mekanik yeniden adlandırma (davranış aynı), (b) yeni kalite gövdesi.
  2. Bekçi §11 her kalite tüketicisini `scripts/lib/kalite-tuketici-beyan.ts`te dosya + fonksiyon olarak beyan eder. Beyan iki yönlü tutulur: beyansız kullanım kırmızı, ölü beyan kırmızı.
- **Karar ikizi (D8):** `stepDecidesDefects(s)` ↔ `DEFECT_DECISION_STATION_WHERE` (`kind === TAMBUR`) aynı dosyada durur. Soru: "Açık hataya CUT/NO_CUT kararını bu adım verir mi?" Bugün tek karar veren Tambur ekran ailesidir. Tür okuması bu ikizde ve akış ikizinde serbesttir, başka her yerde yasaktır (§4 bekçisi).

### 3.2 `Station.inspectionEnabled` ve ölçümsüz türetme

- **Şema:** `inspectionEnabled Boolean @default(false)`. `appliesQuality`'nin yanına yazılır, notu "muayene yeteneği; akış sorusuna KATILMAZ" der.
- **Migration** (`--create-only`, elle tamamlanır, idempotent):
  ```sql
  ALTER TABLE "stations" ADD COLUMN IF NOT EXISTS "inspectionEnabled" BOOLEAN NOT NULL DEFAULT false;
  -- BUGÜNKÜ ETKİN davranış: hata kaydını fiilen açan iki ekran ailesi (KK2: PROCESS_QC, Tambur: TAMBUR).
  UPDATE "stations" SET "inspectionEnabled" = ("kind" IN ('PROCESS_QC','TAMBUR')) WHERE "inspectionEnabled" IS DISTINCT FROM ("kind" IN ('PROCESS_QC','TAMBUR'));
  ```
  `WHERE` yalnız ilk koşumda iş görür: kolon migration ile doğar ve migration bir kez koşar. Yeniden koşum da aynı sonucu üretir.
- **Neden bu küme:**
  - KK1 (RAW_QC) bugün `RollError` YAZMAZ (`rollError.create` yalnız üç yerde).
  - OTHER/SHIPPING/… oturum açamaz ya da kart çözümü PROCESS_QC türü ister. Bu istasyonlarda `appliesQuality=true` bugün çıkışsız kapıdır (T1).
  - Bilinen tek etki: böyle bir istasyonun adımında panel `kursunFinish` hata listesi 400 alır. KARAR K2'nin bilinçli sonucudur (§7 V-c).
- **Doğuşta varsayılan (yeni kayıt):** tek helper `inspectionDefaultForKind(kind)` (aynı dosyada, aynı küme). Kullanım yerleri:
  - `station.service.ts` create: alan GELMEZSE helper'dan türetilir (eski panel alanı göndermez).
  - `import/adapters/station.adapter.ts`.
  - `prisma/seed.ts`: AÇIK `inspectionEnabled: true` yazılır (2026-08-10 tuzağı: seed boş tabloda koşar).
  - Electron `stationKindDefaults.ts` öneri tablosu.
- **Doğrulama sorgusu bekçide:** `test_station_quality_capability §7`, migration dosyasındaki `UPDATE` ifadesini okur. Test DB'de tek tx içinde her `StationKind` × `appliesQuality∈{t,f}` fikstürüne uygular, `inspectionDefaultForKind` doğruluk tablosuyla karşılaştırır ve ROLLBACK eder. Böylece SQL ile TS aynı kümeyi söyler.
- **BaseController:** yeni skaler kolon yazılabilir alan olur ve bu İSTENİR. Electron `schema.ts`, `stationPayload.ts` ve `types.ts`'e iki uçta eklenir.

### 3.3 Kart okutmada oturum istasyonu

- YENİ Teks-Erp:src/services/helpers/station-step-resolve.helper.ts → `resolveWoStepForStation(workOrderId, stationId | null)`. Sıra:
  1. `stationId` doluysa ve İE'nin bu istasyonda akış adımı varsa: açık topu olan adım seçilir. Yoksa tamamlanmamış ilk adım seçilir. Hiçbiri yoksa ve hepsi COMPLETED ise son adım seçilir (yeniden açma özeti).
  2. `stationId` yoksa ya da İE'nin bu istasyonda adımı yoksa: BUGÜNKÜ davranış uygulanır (ilk akış adımı, "mevcut konum" metinleriyle).
- `getByCardBarcode(cardBarcode, stationId?)` ve `listOpenCards(stationId?)` bu bilgiyi kullanır. Controller `getStampContext(req)` (enforce YOK) sonucundan `stationId`'yi alır.
- Eski APK zaten `x-device-id` + oturumla gelir, yani sunucu çözümü ona da uygulanır. Tek akış istasyonlu fabrikada sonuç aynıdır: oturum istasyonu = o istasyon.
- `assertWoAtStepKind` DOKUNULMAZ; Tambur onu kullanmaya devam eder. KursunQc artık onu çağırmaz, bu yüzden bekçideki `KIND_MUAF` satırı silinir (sayı 1 → 0).
- `listQueue` (panel kurşun sırası) DEĞİŞMEZ. Filtreyi daraltmak veriye bağlı olurdu (ölçümsüz kural).

### 3.4 Gramaj modeli

- `FabricProperty.variantOfPropertyId String? @db.Uuid`: "bu SEÇİM özelliği şu BAYRAK özelliğinin çeşididir".
  - Self-FK `Restrict`.
  - Partial unique `(variantOfPropertyId) WHERE NOT NULL`: bir bayrağın en fazla bir çeşidi olur.
  - Servis doğrulaması: kendisi CHOICE olmalı, hedef FLAG olmalı, hedef kendisi çeşit olmamalı. Çeşit bir istasyona bağlanırken ana bayrak da aynı istasyonda bağlı olmalıdır (`station-capability.service.ts`, 400).
- `RollOperation.propertyValueId String? @db.Uuid`: FK `fabric_property_values` `Restrict` + index + DB CHECK `"propertyValueId" IS NULL OR "operationType" = 'KURSUN_APPLIED'`. Satırda kim, ne zaman ve hangi makine bilgisi zaten vardır.
- **Tek karar:** `resolveProcessApplications(caps, selections)` → `[{flagPropertyId, applied, valueId|null}]`, yeri `station-capability-transfer.helper.ts`. Kurallar:
  - AUTO bayrak uygulanır.
  - OPTIONAL ya da REQUIRED bayrak operatör seçtiyse uygulanır.
  - Çeşit değeri seçildiyse bayrak HER ZAMAN uygulanır ve `valueId` = seçilen değer olur.
  - Çeşit REQUIRED ise ve bayrak uygulanıyorsa değer zorunludur.

  `completeQc2` (`kursun-qc.service.ts:409+`) ve `kursunFinish` (`inventory.service.ts:5546+`) bu tek fonksiyondan beslenir. `code === "KURSUN"` yalnız helper sabitinde kalır (AST bekçisi).
- **Yazma sırası:** tx'in ilk ifadesi `assertKursunTabletMayWrite`. Ardından `QC2_COMPLETED` upsert, `KURSUN_APPLIED` upsert (`propertyValueId` ile) ve `copyStationCapabilitiesToRoll` (bayrak + değer, aynı karardan) gelir. Audit yüküne `valueCode` eklenir.
- **Düzeltme (defter değişmez):** aynı topa farklı değer gelirse ATOMİK CLAIM uygulanır:
  1. `updateMany WHERE {id, revokedAt: null, propertyValueId: eski}` → `revokedAt/revokedById/revokeReason='gramaj düzeltme'`. `count===0` ise 409.
  2. Yeni satır yazılır. Partial unique `roll_operations_active_triple_uq ... WHERE "revokedAt" IS NULL` buna izin verir (migration `20260911170000`). Eşzamanlı ikinci düzeltme P2002 alır ve 409'a çevrilir.
  3. `RollProperty` `setRollPropertyValueTx` ile sürümlenir (bugünkü yol).

  Aynı değerin replay'i no-op'tur. Çevrimdışı kuyruk sıralı aktığı için son basış kazanır.
- **Miras:** Tambur çocuk kopyası (`tambur.service.ts:2363-2374`, `:3245-3259`) `propertyValueId`'yi de taşır. Raporlar mirası bugünkü gibi `inheritedFromParentRollId IS NULL` ile dışlar.
- **Geri alma:** `workorder-manual-move.service.ts` ve "Konumu Düzelt" `KURSUN_APPLIED` satırını zaten damgalıyor. Değer satırla birlikte geri alınır, ek iş gerekmez.
- **Varsayılan = bugün:** hiçbir özelliğin `variantOfPropertyId`'si dolu değilse davranış birebir aynıdır. Migration backfill yapmaz.
- **Defter beyanı:** `scripts/lib/defter-beyan.ts` `RollOperation` satırı. Ters mekanizma DAMGA (`revokedAt`), aynen kalır; yeni kolon ileri kaydın parçasıdır.

### 3.5 Parti / iş emri gramaj görünümü ve kâğıt rejimi

- YENİ Teks-Erp:src/services/helpers/process-summary.helper.ts → `summarizeKursunApplications(where)` → `[{valueId|null, valueName, source: 'TABLET'|'KAGIT', rollCount, meters, deviatesFromTarget}]`.
  - Satırlar aktif ve mirassız `KURSUN_APPLIED` kayıtlarıdır. Kâğıt satırları `KursunBypassAssignment` (tamamlanmış) kaydından gelir.
  - Metraj, o adımın hareket satırından alınır (`qtyOut ?? qtyIn`). Kaynak D6'da test DB'de ölçülerek sabitlenir.
  - Tek where İE'den (`step.workOrderId`) ya da partiden (`roll.batchId`) türer. Rapor ile özet AYNI helper'ı kullanır, sonuçları bayt-eşittir.
- **Kâğıt rejimi:** `KursunBypassAssignment.propertyValueId String? @db.Uuid` (FK Restrict).
  - Atama ya da tamamlama diyalogunda İSTEĞE BAĞLI seçilir. Tamamlanana kadar atomik claim ile değiştirilebilir (`WHERE {id, completedAt: null, cancelledAt: null}`), tamamlanınca donar.
  - Boşsa özette "Kâğıt · gramaj bilinmiyor" satırı çıkar.
  - Bypass rejiminin "RollOperation yazılmaz" kuralı DEĞİŞMEZ.

### 3.6 Hedef gramaj (iş emri)

- `WorkOrderTargetProperty` KULLANILMAZ (T10: hedef toplara yayılır, "hedef" ile "uygulandı" karışır).
- YENİ küçük tablo `WorkOrderTargetValue`. Kolonlar:
  - `id`, `workOrderId` FK Cascade, `propertyId` FK, `valueId` FK Restrict
  - `revokedAt/revokedById/revokeReason`, `createdAt/updatedAt`
  - Partial unique `(workOrderId, propertyId) WHERE revokedAt IS NULL`.
  - Servis şartları: `propertyId` bir çeşit özelliği olmalı, `valueId` o özelliğe ait olmalı.
- Ana veri değildir; iş emrinin plan alanıdır. Yazımı İE form/detay ucundandır; değişim eski satırı damgalar ve yenisini yazar. Audit edilir. `workorder-clone.helper.ts` aktif hedefi kopyalar.
- **Sapma YAZILMAZ, türetilir:** uygulanan `propertyValueId` ≠ aktif hedef ise özet satırında `deviatesFromTarget=true` olur, tablette turuncu şerit çıkar. Yazma ENGELLENMEZ.

### 3.7 Tek hata giriş bileşeni ve sonraki istasyona akış

- **Bileşen:** mobil:src/components/inspection/InspectionPanel.tsx. K4P TABLET dilimiyle AYNI yer ve AYNI ad; bu plandaki adı `QualityPanel` değildir.
  - Hangisi önce inerse dosyayı açar, öteki genişletir.
  - Sözleşme: `props {defectTypes, ownDefects, priorDefects, meterInput, sizeClassMode?: boolean, readOnly?, onDefect({meter|null, defectTypeId, sizeClass?}), onDelete(id)}`.
  - Bileşen KAYDETMEZ; kaydetmeyi KONAK yapar (K4P §4.1 konak sözleşmesi). KursunQc ve Tambur konakları her dokunuşta yazar. K4P KK1 konağı taslak biriktirir.
  - `sizeClassMode` K4P modülü açıkken true olur. Süreç konaklarında saklama K4P Faz 2'dir.
  - Bileşende `kind`/ekran adı karşılaştırması YOKTUR (K4P jest bekçisiyle aynı).
- **Cetvel ve liste:** topun bütün açık hatalarını çizer.
  - Bu adımın hataları kırmızıdır ve silinebilir.
  - Önceki adımların hataları GRİ, salt-okunur ve künyelidir ("KK Masa 2 · Ayşe · 13:40").
  - Aynı metre + tip yeniden girilirse bugünkü 409 `DUPLICATE_ROLL_ERROR` "zaten kayıtlı" olarak gösterilir.
  - Backend: `buildStepSummary` `RollSummary.priorDefects[]` ve `priorOpenErrorCount` taşır (T8).
- **Rozet:** açık kart listesi ve top satırında `openErrorCount` görünür (önceki adımlardan). Tablet zaten 5 sn'de bir yokluyor; yeni bağlantı açılmaz.
- **Tek yazma boğazı (D7):** YENİ Teks-Erp:src/services/helpers/roll-defect.helper.ts → `recordRollDefectTx`. İçeriği:
  - kalite ikizi kapısı
  - adımda olma
  - pasif tip reddi
  - mükerrer → P2002 → 409
  - audit tx dışında

  KK2, Tambur ve `kursunFinish` bu helper'a bağlanır. K4P `RollError.origin` göçünü yapınca alan bu helper'a eklenir.

### 3.8 Tambursuz rota: hata kararı

- **Karar sahibi:** rotada kalite adımından sonraki ilk `stepDecidesDefects` adımı. Bugün yalnız Tambur bu kümededir; Tambur hatayı bugünkü gibi rehberinde görür ve karar verir.
- **Böyle adım yoksa** (kalite son adımda ya da Tambur'dan sonra):
  1. Rota şablonu kaydında ve İE oluşturmada `ApiResponse.warnings` döner: "Kalite adımından sonra hata kararı veren adım yok; hatalar bilgi olarak etikete/sevk belgesine taşınır". Yazma engellenmez (`rota-renk.md` kapsama uyarı deseni).
  2. Finalize hatalara dokunmaz (bugünkü gibi). Hatalar açık kalır.
  3. Etiket alanı `openDefects` eklenir (`config/label-fields.ts` mamul top etiketi + `helpers/label-field-values.ts`). Örnek değer: "12,5 m Leke · 40 m Delik", ilk 4 hata + "+N". Mevcut şablonlarda görünmez doğar (opt-in).
  4. Sevk irsaliyesi satırına "Hata notu" sütunu eklenir: müşteri belgesinde iç kolon OPT-IN kuralıyla belge ayarından açılır, varsayılan KAPALI, PDF = Excel. Belge tasarımcısı T0 sözleşme kataloğu inmişse alan oraya da eklenir.

### 3.9 Eski istemci ne yapar

| İstemci | Sunucu | Sonuç |
|---|---|---|
| Eski APK | D1/D2 | Sözleşme değişmez. Kart çözümü oturumdan yapılır; tek akış istasyonlu fabrikada sonuç aynıdır. |
| Eski APK | D4 | SEÇİM çiplerini 2026-08-11'den beri çiziyor ve `properties[{propertyId,valueCode}]` gönderiyor. Sunucu kurşunu bundan türetir, yani birleşik istasyonda gramaj eski APK ile de çalışır. |
| Eski APK | yeni yapılandırma (yalnız kurşun / Tambur'da muayene kapalı) | Eski APK hata panelini koşulsuz çizer. Yazarsa 400 "Bu istasyonda kalite muayenesi kapalı" alır (fail-closed). Panel bu yapılandırmayı kaydederken `warnings` ile "tablet ≥ <D3 sürümü> ister" uyarısı verir. `minVersion` ARTMAZ, çünkü mevcut yapılandırma kırılmaz. |
| Eski panel | D1 | `inspectionEnabled` göndermez. Update dokunmaz; create alanı türden türetir. |
| Eski panel | D4/D6 | Çeşit alanı ve hedef gramajı görmez; davranış bugünküdür. |
| Patron uygulaması | — | Etkilenmez. |

Dağıtım sırası: backend ÖNCE, panel + APK sonra. Yeni düzen yalnız yönetici yapılandırmayı değiştirdiğinde devreye girer.

## 4 · UI/UX

### 4.1 Tablet: dört düzen (yatay, endüstriyel dil)

Ortak dil:
- Dokunma hedefi ≥ 64 dp; gramaj ve tamamla düğmeleri ≥ 96 dp yükseklikte.
- Yüksek kontrast, ikon + metin, tek renk anlamı: kırmızı hata, gri önceki, turuncu sapma, yeşil tamam.
- Başlık oturum istasyonunun ADI; "Tambur'a" metni `nextStepName`'den gelir.
- Panel bileşimi saf fonksiyondan kurulur: mobil:src/screens/Modules/KursunQc/stationPanels.ts → `composeStationPanels({inspectionEnabled, process[]})` → `{qualityPanel, processPanel, completion: 'TAP_VALUE'|'BUTTON', completeLabel}`.

```
(a) YALNIZ KALİTE — PROCESS_QC · inspectionEnabled · işlem özelliği yok
┌ KK Masa 2 · Kart P07 · İE-1234 ─────────────────────────────────┬──────────────┐
│ T240926H0012 · 118,0 m · TÜL-280 · Beyaz        ⚠ önceki 2 hata │ [P07 ⚠2][P09]│
│ Cetvel: ──●gri(Kurşun·Ali)──────●KIRMIZI(bu adım)─────────       │ ▸ T…0012  ✓  │
│ Metre [ 64,5 ]  [Leke] [Kaçık] [Delik] [Yağ] [Boya]  (≥64 dp)    │ ▸ T…0013 ⚠1  │
│ ┌──────────────────────────────┐                     numpad      │ ▸ T…0014     │
│ │  KK TAMAMLA  (1 hata)        │  ← tek büyük düğme              │              │
└─┴──────────────────────────────┴─────────────────────────────────┴──────────────┘

(b) YALNIZ KURŞUN — PROCESS_QC · inspectionEnabled=false · KURSUN + "Kurşun gramajı" çeşidi
┌ Kurşun 1 · Kart P07 · İE-1234 · HEDEF 50 gr ────────────────────┬──────────────┐
│ T240926H0012 · 118,0 m                         ⚠ önceki 2 hata  │ top listesi  │
│  ┌──────────┐  ┌══════════┐  ┌──────────┐                       │ ▸ T…0011 50  │
│  │  25 gr   │  ║  50 gr ★ ║  │  100 gr  │  ← tek dokunuş = top   │ ▸ T…0012     │
│  └──────────┘  └══════════┘  └──────────┘     bitti, sıradakine  │ ▸ T…0013     │
│  ★ = iş emri hedefi (kalın çerçeve)                              │              │
│  [ Kurşunsuz geç ]   (yalnız KURSUN OPTIONAL ise)                │              │
│  Son: T…0011 · 50 gr · Ali · 14:02   [ DÜZELT ]                  │              │
└─────────────────────────────────────────────────────────────────┴──────────────┘
  Hedef dışı basış → düğme turuncu yanıp söner + "Hedef 50 gr, 25 gr işlendi" şeridi (engellemez).

(c) KURŞUN + KALİTE — bugünkü birleşik (varsayılan; yapı değişmez)
┌ Kurşun + KK2 · Kart P07 ────────────────────────────────────────┬──────────────┐
│ InspectionPanel: cetvel + metre + hata tuşları                  │ top listesi  │
│ Kurşun gramajı:  (25 gr) (●50 gr ★) (100 gr)  ← seçim, bitirmez │              │
│ ┌──────────────────────────────────────┐                        │              │
│ │ TAMAMLA  (50 gr · 2 hata)            │ ← zorunlu gramaj yoksa │              │
│ └──────────────────────────────────────┘   kilitli + sebep      │              │
└─────────────────────────────────────────────────────────────────┴──────────────┘

(d) TAMBUR + KALİTE — TAMBUR · inspectionEnabled (bugünkü ekran + çekmece)
┌ Tambur 1 — bugünkü kesim ekranı ────────────────┬──── [ HATA GİR ] çekmece ─────┐
│ hata rehberi (gri: önceki adımlar, karar burada) │ InspectionPanel              │
│ kesim noktaları · kalite · [ KES ]               │ Metre [__] [Leke][Kaçık]…    │
└──────────────────────────────────────────────────┴──────────────────────────────┘
  Muayene kapalı Tambur: çekmece düğmesi çizilmez; rehber (karar) aynen kalır.
```

- (b)'de "tek dokunuş = tamam" yalnız kalite paneli YOKKEN geçerlidir. Panel varsa değer düğmesi seçimdir.
- "DÜZELT" son topun gramajını değiştirir (§3.4 düzeltme). Çevrimdışı ise kuyruğa girer.
- Bugünkü ekran yapısı (c) için ekran görüntüsü karşılaştırmasıyla korunur.

### 4.2 Panel

- **İstasyon formu** (`Electron/src/pages/Stations/StationFormDialog.tsx`, "Yetenekler"):
  - Yeni kutu **"Kalite muayenesi (hata girişi)"** → `inspectionEnabled`.
  - Eski "Kalite kontrol" kutusunun etiketi **"Ara istasyon kart akışı (Kurşun/KK2 ekranı)"** olur; ipucu "Yalnız Ara istasyon türünde etkili" der. Kolon ve davranış değişmez.
  - Türe göre ipuçları (D8): KK1 "oturum ekranında muayene (4 puan modülü)", OTHER/SUBCONTRACTOR/SHIPPING "tablet ekranı yok — etkisiz".
  - `PROCESS_QC` görünen adı "Ara istasyon (işlem/kontrol)".
- **İstasyon Yetenekleri** (`StationCapabilities/CapabilitiesEditSheet.tsx`): kurşun istasyonunda "Kurşun" (AUTO/OPTIONAL) + "Kurşun gramajı" (REQUIRED/OPTIONAL). Çeşit eklenip ana bayrak eklenmezse sunucu 400 verir.
- **Gramaj değer listesi** (`FabricProperties/FabricPropertyFormDialog.tsx` + `PropertyValuesField.tsx`):
  - SEÇİM tipinde yeni alan "Şunun çeşidi: [Kurşunlu ▾]" (FLAG özellikler).
  - Değerler 25/50/100 gr. Yetkili ekler, sıralar ve pasife alır.
  - Canlı referanslı değer silinmez, pasifleşir (bugünkü `fabric-property.service.ts:181-210`).
- **İş emri:**
  - Formda (`Operations/WorkOrders/WorkOrderFormView.tsx`) isteğe bağlı "Hedef kurşun gramajı" seçici. Seçici doğrudan modal açar (UI tercihi).
  - Detayda (`detail-v3/`) YENİ `ProcessSummaryCard.tsx`: "Kurşun · hedef 50 gr — 50 gr 14 top 1.640 m · 25 gr 3 top 360 m (sapma) · Kâğıt · bilinmiyor 2 adım".
- **Parti izi** (`Reports/Production/BatchTracePage.tsx`): aynı özet.
- **Rapor:** YENİ `Reports/Production/KursunGramajPage.tsx`. Gün × gramaj × kumaş × makine × operatör; Excel; liste + özet şeridi tek where'den.
- **Kurşun dağıtım** (`Operations/KursunDagitim/` atama + `KursunDagitimCompleteDialog.tsx`): isteğe bağlı gramaj seçici.

## 5 · Dilimler

Ortak (tam metin istemlerde):
- Worktree `/Users/demirci/Documents/Projeler/Teks-Erp-wt/<kod>`, dal `feature/kq-<kod>`, test DB `tekserp_kq<kod>_test`.
- Migration yalnız `npx prisma migrate dev --create-only`; `DropForeignKey` satırları silinir.
- Önce PLAN yazılır (senaryo → adım → kabul testi). Yalnız alan bekçileri koşulur (kalite · kurşun · tambur · rota-renk), tam set CI'da.
- Yeni bekçi negatif sondayla doğrulanır.
- PR → CI TÜM SUCCESS → squash merge.
- Model **Opus high**.

### D1 — İki ikiz + `inspectionEnabled` (backend + panel kutusu) · M
- **Hedef:** §3.1 (akış/kalite ikizleri, dağıtım parçası, `KURSUN_PROPERTY_CODE`), §3.2 (kolon, türetme, doğuş varsayılanı), panel kutusu ve etiket.
- **Dosyalar:**
  - `Teks-Erp/prisma/schema.prisma`; YENİ migration `…_station_inspection_enabled`
  - `src/services/helpers/quality-station.helper.ts`
  - `kursun-qc.service.ts`, `kursun-bypass.service.ts`, `helpers/kursun-bypass-guard.helper.ts`, `helpers/kursun-bypass-eligibility.helper.ts`, `inventory.service.ts`, `helpers/order-line-scope.helper.ts`
  - `station-capability.service.ts` (DTO'ya `inspectionEnabled`; `canApplyQuality` bugünkü değeriyle kalır)
  - `tambur.service.ts:1896` (tür kontrolü ekran ailesi için kalır + kalite ikizi kapısı eklenir)
  - `station.service.ts`, `import/adapters/station.adapter.ts`, `prisma/seed.ts`, `routes/station.routes.ts` (Swagger)
  - Electron `pages/Stations/{StationFormDialog.tsx, schema.ts, stationPayload.ts, types.ts, stationKindDefaults.ts(+test), StationListRow.tsx, ProductionStationsPage.tsx}`
  - YENİ `scripts/lib/kalite-tuketici-beyan.ts`
- **Commit düzeni:** (1) mekanik yeniden adlandırma; (2) kolon + migration + kalite gövdesi + tüketiciler; (3) panel.
- **Bekçi:** `test_station_quality_capability` yeniden yazılır.
  - §2 iki doğruluk tablosu.
  - §3 iki ikizin canlı DB eşdeğerliği.
  - §4 `kind` okuması yalnız akış/karar ikizinde (KIND_MUAF 1 kalır, D2 siler).
  - §5 select sözleşmeleri.
  - §7 migration SQL ↔ `inspectionDefaultForKind` (tx + ROLLBACK) + seed ölçümü.
  - §9 akış gövdesi `inspectionEnabled` okumaz; kalite gövdesi `kind`/`appliesQuality` okumaz.
  - §10 `stationCanInspect === stepCanApplyQuality`.
  - §11 kalite tüketici beyanı iki yönlü.
  - §12 (DB) `inspectionEnabled=true, appliesQuality=false` TAMBUR makinesi `listDistribution`'da YOK; KURSUN AUTO'suz PROCESS_QC makinesi listede YOK ve `assign` 400 (liste = kabul).
  - Electron `stationKindDefaults.test`.
- **Negatif sondalar:**
  - S6: akış gövdesine `inspectionEnabled` → §9 kırmızı.
  - S7: kalite gövdesine `kind` → §9 kırmızı.
  - S8: `listDistribution` eski `QUALITY_STATION_WHERE`'e dönerse §12 kırmızı.
  - S9: migration'da `'TAMBUR'` silinirse §7 kırmızı.
  - S10: beyansız yeni `stepCanApplyQuality` çağrısı → §11 kırmızı.
- **Regresyon:** `test_e2e_full_flow`, `test_kursun_bypass`, `test_kursun_regime_lock`, `test_qc2_idempotency`, `test_kursun_unassigned_close`, `test_kursun_machine_order`, `test_p2_kk2reopen`, `test_kursun_bulk`, `test_phase6_reporterror_concurrency`, `test_station_property_mode`, `test_schema_drift`, `test_audit_muafiyeti`.
- **Kabul:** regresyon yeşil. Taze seed'de PROCESS_QC/TAMBUR `inspectionEnabled=true`. Panelde kutu kaydedilip okunuyor.
- **Risk:** yeniden adlandırmada unutulan çağrı (§11 yakalar); K4P-KK1 aynı dosyaya dokunur (§5.2).
- **Bağımlılık:** yok. K4P-KK1'den ÖNCE.

### D2 — Adım çözümü oturum istasyonundan (backend) · M
- **Hedef:** §3.3.
- **Dosyalar:** YENİ `helpers/station-step-resolve.helper.ts`; `kursun-qc.service.ts` (`getByCardBarcode`, `listOpenCards`); `controllers/kursun-qc.controller.ts`; `test_station_quality_capability` (KIND_MUAF satırı silinir).
- **Bekçi:** YENİ `test_station_step_resolution` (DB):
  - Kurşun→KK→Tambur rotasında KK oturumu KK adımını, Kurşun oturumu kurşun adımını çözer.
  - Oturumsuz çağrı bugünkü ilk adımı döner.
  - Rotada olmayan istasyonun oturumu bugünkü davranışa düşer.
  - Açık kartlar istasyona göre süzülür.
  - Aynı istasyona iki kez uğrayan rotada açık hareketli adım seçilir.
  - COMPLETED adım yeniden açma özetine gider.
- **Negatif sonda:** çözümü "ilk akış adımı"na döndür → en az 2 kırmızı; `KIND_MUAF` satırını geri koy → §4 "ölü muaf" kırmızı.
- **Regresyon:** D1 seti + `test_kursun_regime_lock`.
- **Kabul:** üçlü rota test DB'de kart okutarak uçtan uca yürür. `listOpenCards` `EXPLAIN` ölçümü PR'a yazılır.
- **Risk:** 5 sn yoklamada ek sorgu.
- **Bağımlılık:** D1.

### D3 — Tablet bileşimi + `InspectionPanel` çıkarımı (backend alanları + APK) · L
- **Hedef:** §3.7 bileşen + §4.1 (a)(c); başlık ve metinler istasyondan.
- **Dosyalar:**
  - Backend: `kursun-qc.service.ts` `buildStepSummary` (`inspectionEnabled`, `properties[].variantOfPropertyId`, `nextStepName`); KK2 `reportError`/`deleteError` kalite ikizi 400 (D1'de yoksa).
  - Mobil: YENİ mobil:src/components/inspection/InspectionPanel.tsx (K4P ile ortak; varsa genişletilir); YENİ mobil:src/screens/Modules/KursunQc/stationPanels.ts (+ `.test.ts`); `KursunQcScreen.tsx`; `mobil/src/types/models.ts`.
- **Bekçi:**
  - `stationPanels.test`: dört düzen tablosu + alan yoksa (eski backend) bugünkü ekran.
  - `stationScreens.test` değişmeden yeşil.
  - Bileşen kaynağında `kind ===`/`StationKind` yok (jest).
  - Backend `test_kursun_regime_lock` + YENİ dal: "muayene kapalı istasyonda hata yazma 400".
- **Negatif sonda:** bileşimde `inspectionEnabled` görmezden gelinirse tablo kırmızı.
- **Kabul:**
  - Varsayılan istasyonda ekran bugünküyle aynı (önce/sonra ekran görüntüsü + Read ile inceleme).
  - Yalnız kalite istasyonunda gramaj alanı yok.
  - Çevrimdışı kuyruk anahtarları (`STATION_MUT`) korunur.
- **Risk:** 3201 satırlık ekranda taşıma regresyonu.
- **Bağımlılık:** D1; D2 ve D4 inmiş olmalı (dalga 3).

### D4 — Gramaj: çeşit bağı + defter değeri + tek karar (backend + panel) · M
- **Hedef:** §3.4.
- **Migration** `…_kursun_gramaj_cesit`:
  - `fabric_properties."variantOfPropertyId"` + FK Restrict + partial unique
  - `roll_operations."propertyValueId"` + FK Restrict + index + CHECK
- **Dosyalar:**
  - `helpers/station-capability-transfer.helper.ts` (`resolveProcessApplications`, `KURSUN_PROPERTY_CODE` kullanımı)
  - `kursun-qc.service.ts:409+`, `inventory.service.ts:5546+`, `tambur.service.ts:2363/:3245`
  - `fabric-property.service.ts` (doğrulama), `station-capability.service.ts` (çeşit ↔ ana bayrak)
  - Electron `FabricProperties/{FabricPropertyFormDialog.tsx, schema.ts, types.ts}` (alan iki uçta)
  - `audit-field-labels` dosyası; `scripts/lib/defter-beyan.ts` notu
- **Bekçi:** YENİ `test_kursun_gramaj` (DB):
  - Değer basılınca `KURSUN_APPLIED.propertyValueId` dolar + `RollProperty` KURSUN + GRAMAJ yazılır.
  - Çeşit yoksa bugünkü AUTO davranışı birebir.
  - Düzeltmede eski satır damgalı, yenisi aktif; eşzamanlı iki düzeltmeden biri 409.
  - Replay no-op.
  - Tambur çocuğu değeri miras alır.
  - Pasif değer replay'de KABUL (V9); yabancı değer 400.
  - DB CHECK ihlali reddedilir.
- **AST:** `code === "KURSUN"`/`"KURSUN"` literal'i yalnız helper'da.
- **Negatif sondalar:** düzeltmede revoke atlanırsa kırmızı; `completeQc2`'de eski kopya karar geri gelirse AST kırmızı.
- **Regresyon:** `test_property_value_selection`, `test_station_property_mode`, `test_qc2_idempotency`, `test_manual_move_qc_reversal`, `test_tambur_undo`, `test_kursun_bulk`, `test_schema_drift`, `test_db_invariants`, `test_defter_ters_yol`.
- **Kabul:** eski APK gövdesiyle (`properties[{propertyId,valueCode}]`) birleşik istasyonda gramaj uçtan uca yazılır.
- **Bağımlılık:** D1. D2 ile paralel.

### D5 — Yalnız-kurşun düzeni + hedef vurgusu (APK) · M
- **Hedef:** §4.1 (b): `TAP_VALUE` tamamlama, "Kurşunsuz geç", son işlem şeridi + DÜZELT, hedef ★ ve sapma şeridi (D6'nın `targetValues` alanı).
- **Dosyalar:** `stationPanels.ts`, `KursunQcScreen.tsx`, `mobil/src/types/models.ts`.
- **Bekçi:**
  - `stationPanels.test`: `TAP_VALUE` yalnız kalite paneli yokken.
  - Render testi: değer dokunuşu `completeQc2`'yi tek kez çağırır.
  - Hedef dışı basış engellenmez.
- **Negatif sonda:** kalite paneli varken `TAP_VALUE` dönerse kırmızı.
- **Kabul:** test DB'de 10 top < 30 dokunuşla biter. Ekran görüntüleri: hedefli, hedefsiz, sapma.
- **Bağımlılık:** D3 + D4 + D6.

### D6 — Özet, rapor, hedef gramaj, kâğıt gramajı (backend + panel) · L
- **Hedef:** §3.5, §3.6.
- **Migration** `…_kursun_gramaj_hedef_kagit`:
  - `work_order_target_values` (partial unique, FK'ler)
  - `kursun_bypass_assignments."propertyValueId"`
- **Dosyalar (backend):**
  - YENİ `helpers/process-summary.helper.ts`
  - `GET /api/work-orders/:id/process-summary` (`workorder:read`), `GET /api/batches/:id/process-summary` (`batch.routes.ts` okuma izni)
  - İE hedef yazımı (`workorder.controller.ts` + servis, zod), `workorder-clone.helper.ts`
  - `kursun-bypass.service.ts` (atama/tamamlama/değiştir: atomik claim)
  - `buildStepSummary.targetValues`
  - YENİ `services/reports/kursun-gramaj.report.service.ts` + `routes/reports/production.routes.ts` + `constants/report-catalog.ts` + `constants/screen-catalog.ts` (reçete: route + izin; fabrika günü `constants/time.ts`)
- **Dosyalar (Electron):** `detail-v3/ProcessSummaryCard.tsx`, `WorkOrderFormView.tsx`, `BatchTracePage.tsx`, YENİ `Reports/Production/KursunGramajPage.tsx` + Excel + karo, `KursunDagitim/` diyalogları.
- **Bekçi:** YENİ `test_process_summary` (DB):
  - İE özeti = parti özetleri toplamı.
  - Rapor ↔ özet bayt-eşit.
  - Geri alınan ve miras satırlar dışarıda.
  - Kâğıt bilinmiyor satırı.
  - Sapma türetilir.
  - Fabrika günü sınırı.
  - Hedef değişimi eskiyi damgalar.
  - Tamamlanmış atamada gramaj değişimi 409.
- **Negatif sonda:** `revokedAt` süzgecini kaldır → kırmızı.
- **Regresyon:** `test_screen_catalog`, `test_route_auth_coverage`, `test_route_mount_reachability`, `test_kursun_bypass`, `test_kursun_bypass_repoint`, rapor bekçileri (`BEKCI-HARITASI.md` raporlar satırı).
- **Bağımlılık:** D4.

### D7 — Tambur + kalite çekmecesi, tek hata boğazı, önceki adım hataları (backend + APK) · L
- **Hedef:** §3.7 (boğaz, `priorDefects`, rozet) + §4.1 (d).
- **Dosyalar:**
  - YENİ `helpers/roll-defect.helper.ts`
  - `kursun-qc.service.ts` (`reportError`, `buildStepSummary`, `listOpenCards.openErrorCount`), `tambur.service.ts` (`reportError` → helper; özet `inspectionEnabled`), `inventory.service.ts:5589`
  - Mobil `Tambur/TamburScreen.tsx` (çekmece; mevcut "hata ekle" yolunun YERİNE geçer), `InspectionPanel.tsx` (gri önceki), `KursunQcScreen.tsx` (rozet)
- **Bekçi:**
  - YENİ `test_roll_defect_single_gateway`: AST ile `rollError.create*` yalnız helper'da; DB ile üç yazar aynı kurallar.
  - `test_phase6_reporterror_concurrency`.
  - Tambur hata bekçileri.
  - YENİ dal: muayene kapalı Tambur'da hata 400, karar rehberi çalışır.
  - Jest: çekmece görünürlüğü `inspectionEnabled`'dan.
- **Negatif sondalar:** Tambur kapısı `kind`'a dönerse `test_station_quality_capability §4` kırmızı; ikinci `rollError.create` → gateway kırmızı.
- **Kabul:** KK→Kurşun rotasında Kurşun tableti KK hatalarını gri görür, kartta ⚠ rozeti çıkar. Ekran görüntüleri.
- **Risk:** Tambur ekranı 9477 satır; K4P SEMA/KAPSAM ile `RollError` çakışması (§5.2).
- **Bağımlılık:** D3 (+ D1 canlı).

### D8 — Tambursuz rota, etiket/sevk bilgi, panel ipuçları, kurallar, sürüm notu · M
- **Hedef:** §3.8, §4.2 ipuçları, karar ikizi `stepDecidesDefects`.
- **Dosyalar:**
  - `quality-station.helper.ts` (karar ikizi), `route.service.ts` + İE oluşturma (`warnings`)
  - `config/label-fields.ts` + `helpers/label-field-values.ts` (`openDefects`)
  - `document-render/shipment-dispatch.html.ts` + Excel ikizi + belge ayarı (opt-in sütun)
  - Electron istasyon formu ipuçları, `PROCESS_QC` görünen adı
- **Kural/arşiv:**
  - `docs/kurallar/kalite.md`: "Kurşun→KK→Tambur kurulmaz" → "kurulabilir; bypass yalnız sonraki adım Tambur iken". Eklenecek satırlar: "ekran türden, panel yetenekten", "iki ikiz", "KK1'de `inspectionEnabled` oturum ekranında muayene açar". Faz B tablosu: R1 kısmi (KursunQc), R4 karar, R5 karar.
  - `kursun.md` (gramaj, kâğıt gramajı, dağıtım parçası), `tambur.md` (çekmece), `rota-renk.md` (karar uyarısı)
  - Arşiv `docs/history/arsiv/2026-10.md`
  - Sürüm notu taslağı
- **Bekçi:** `test_route_skip_warning` kalıbında YENİ `test_rota_hata_karari_uyarisi`; `test_label_*` alan kataloğu bekçileri; `test_sevk_belge_altin` + `test_sevk_belge_excel_esit` (varsayılan kapalı altın kopya değişmez, açık kombinasyon yeni altın); `visibleStationKinds.test`.
- **Negatif sonda:** uyarı koşulu ters çevrilirse kırmızı; varsayılan sütun açık doğarsa altın kırmızı.
- **Bağımlılık:** D1–D7.

### 5.1 Dalga planı (≤3 paralel)

| Dalga | Dilimler | Not |
|---|---|---|
| 1 | **D1** | Tek başına; K4P-KK1 bekler |
| 2 | **D2 ∥ D4 ∥ K4P-KK1** | Üçü de D1'i merge eder |
| 3 | **D3 ∥ D6** | D3 `kursun-qc.service.ts` `buildStepSummary`'ye D6 ile birlikte dokunur, sonra inen merge eder |
| 4 | **D5 ∥ D7** | İkisi de `KursunQcScreen.tsx`'e dokunur: D5 kurşun paneli, D7 rozet; sonra inen merge eder |
| 5 | **D8** | Kapanış |

### 5.2 Çakışma bölgeleri

| Bölge | Dilimler | Kural |
|---|---|---|
| `quality-station.helper.ts` | D1, D8, K4P-KK1 | D1 önce. K4P-KK1 `stationCanInspect`'i AÇMAZ, D1'in alias'ını kullanır. K4P KK1 fikstürleri KK1 istasyonuna `inspectionEnabled: true` yazar (KK1 türetmede false). |
| `kursun-qc.service.ts` | D1, D2, D3, D4, D6, D7 | Dalga sırası; her dilim `git merge origin/main` |
| `KursunQcScreen.tsx` | D3, D5, D7 | D3 yapıyı böler, D5/D7 kendi panellerine yazar |
| mobil:src/components/inspection/InspectionPanel.tsx | D3, D7, K4P-TABLET | İlk inen dosyayı açar; prop sözleşmesi §3.7. Koordinatör K4P TABLET istemine bu sözleşmeyi ekler. |
| `RollError` | D7, K4P-SEMA/KAPSAM | D7'nin `roll-defect.helper`'ı önce inerse K4P `origin`'i helper'a ekler; K4P önce inerse D7 helper `origin: PROCESS` yazar ve K4P `roll-error-kapsam` beyanına kaydolur. |
| `schema.prisma` + migration | D1, D4, D6, K4P-SEMA | Migration adları zaman damgalı; çakışmada sonra inen yeniden `--create-only` üretmez, dosyasını korur ve `migrate deploy` sırasını test DB'de doğrular |
| Bildirim | — | `kalite.hatali-top-geldi` BILDIRIM-SISTEMI v2 kataloğuna; bu plan yalnız `priorOpenErrorCount` verisini hazırlar |
| Belge tasarımcısı | D8 | T0 inmişse sevk alanı sözleşme kataloğuna da yazılır |

## 6 · Riskler ve geri alma

| Risk | Önlem | Geri alma |
|---|---|---|
| Yeniden adlandırmada akış çağrısı kalite ikizinde kalır (sessiz anlam kayması) | D1 iki commit; §11 beyan; §12 DB parite | Commit (b) revert; kolon kalır (zararsız) |
| `inspectionEnabled` türetmesi bir fabrikada beklenmeyen istasyonu kapatır | Türetme = bugünkü hata yazan ekran aileleri; tek bilinen fark OTHER+appliesQuality'de panel `kursunFinish` hata listesi (T1 çıkışsız kapı) | Panelden kutu açılır (veri) |
| Dağıtım listesi daralır | Yalnız `assign`'ın zaten reddettiği makineler düşer (parite) | — |
| Oturum çözümü çok PROCESS_QC'li fabrikada farklı adım seçer | Yalnız İE'nin oturum istasyonunda adımı varsa; yoksa bugünkü davranış | D2 revert (şemasız) |
| Gramaj düzeltme yarışı | atomik claim + partial unique → 409 | — |
| Eski APK + yeni düzen | 400 fail-closed + panel `warnings` | Yapılandırmayı geri al |
| `KursunQcScreen`/`TamburScreen` regresyonu | ekran görüntüsü karşılaştırması, jest | APK önceki sürüm (OTA geri) |
| Migration geri alınamaz | Üç migration da ekleyici (kolon/tablo); veri `UPDATE` yalnız yeni kolonda | Kolonlar kullanılmadan kalır; kod revert yeter |

## 7 · Veto listesi (kullanıcıya ait olanlar)

- **V-a — Kurşun tüketimi (kg):** gramaj değerine sayısal karşılık (`numericValue` + birim) eklenip kg tüketim raporu çıkarılsın mı? v1'de yok, şema buna açık.
- **V-b — Patron bulutuna günlük gramaj özeti** (opt-in, fabrika hesaplar, imzalı gider): istenirse ayrı dilim.
- **V-c — Eski `appliesQuality` kolu:** akış ikizinin `appliesQuality` kolu (OTHER/TAMBUR'da işaretli eski kutular) ölçümsüz bırakıldı. Kalıcı temizlik için fabrika verisinde `appliesQuality=true ∧ kind<>'PROCESS_QC'` sayımı gerekir. Bu sayım ancak kullanıcı izniyle yapılır; izin verilirse kol düşer ve panel kutusu emekliye ayrılır.
- **V-d — Hata notunun müşteriye gitmesi:** tambursuz rotada açık hataların sevk irsaliyesinde görünmesi varsayılan KAPALI (opt-in). Fabrika bazında açmak kullanıcı/müşteri kararıdır.
