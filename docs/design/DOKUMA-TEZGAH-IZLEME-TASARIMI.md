# Dokuma Tezgah İzleme — Birleşik Tasarım (denetlenmiş)

> **Tarih:** 2026-09-12 (tasarım turu 2026-09-11'de koştu) · **Durum: tasarım — denetlendi, UYGULANMADI** (kod yok, migration yok, DB'ye yazılmadı) · **Kapsam:** dokuma tezgahlarından duruş nedeni · randıman · devir · çalışma saati.
>
> **Kaynaklar:** `docs/design/MODUL-BAYRAK-TASARIM.md` §8 (mimari karar zaten alınmıştı), `docs/design/DOKUMA-DEVERE-SAHA-KAYNAGI.md` (gerçek dokumacı belgeleri), `docs/design/SEKTOR-YOL-HARITASI.md` (boşluk kataloğu), `docs/design/DEVERE-LEVENT-TARAMASI.md` (levent defterinin sahibi — §7). Defter doktrini `docs/kurallar/defter.md`, modül kalıbı `docs/kurallar/modul-bayrak.md`, eşzamanlılık `docs/standart/ESZAMANLILIK.md`.
>
> **Yöntem:** 5 paralel tasarım ajanı → 5 çürütme ajanı → sentez; sonra **İKİ BAĞIMSIZ DENETİM** (**§11**):
> **① Opus — altı mercek** (kabul şartları/bayrak · defter doktrini/telemetri · çekirdek mimari · çürütme izi · kod gerçekliği · ölçek/fazlandırma): 92 bulgu, 88 işlendi, 4 gerekçeyle reddedildi.
> **② Fable — düşmanca denetim (2026-09-12):** belgenin YAZILMASINDAN ÖNCEKİ sentez metnini ayrıca denetledi; ana hükmü *"bu hâliyle şemaya dökülemez"* idi ve dört FİZİKSEL ENGEL saydı (PG 55P04 · P1012 karşılıksız ilişkiler · hedefsiz levent kolonu · `perde-dokuma` ad çakışması) + levent çelişkisi. Hükümler önce belgeyle EŞLENDİ (çoğu zaten karşılanmıştı), karşılanmayanlar §11b'de sayılarak işlendi.
> Her kod iddiası `dosya:satır` olarak ölçüldü; **satır numarası kayan tablolarda çapa ADA çevrildi** (§6.2).
>
> **Kararları ajan verdi** (ölçüt: ① sektör standardı ② bizim ölçeğimiz — tek fabrika canlı, perde sektörü hedef, küçük ekip ③ mevcut kod deseni) ve **itiraza açıktır**. **ÜÇ ONAY KALEMİ + İKİ SAHİPSİZ İŞ KALEMİ dışında** kullanıcıya açık soru bırakılmadı; sahada ölçülmesi gerekenler "saha doğrulaması" olarak işaretlendi ve her birinin varsayılan kararı yazıldı (**§10**).
>
> **ONAY KALEMLERİ — kullanıcı karar verir, belge kendiliğinden yazmaz:** ① kök `CLAUDE.md`'ye girecek **«Telemetri ≠ defter»** cümlesi (§4, §11b borç ①) · ② **`AUDIT_EXEMPT_MODELS`** sabiti + kök `CLAUDE.md`'nin *"tek istisna `UserPreference`"* cümlesinin değişmesi (§10/#8, §11b borç ②) · ③ **K2'den sapma:** `dokuma → devere` zinciri KURULMUYOR (§7.1, §11a).
> **SAHİPSİZ İŞ KALEMLERİ — belgede "istenirse" diye duruyor, sahibi yok:** ④ `deploy/kur.ps1`e **NTP adımı** (§3.5 — bugün `w32tm`/NTP sıfır geçiş) · ⑤ koşucuya **`TEKSERP_STRICT=1`** modu, atlanan kontrol varsa exit ≠ 0 (§8.1 K3-2).
>
> **Bağlayıcı kullanıcı kararları:** **(K1)** hard delete yok, izlenebilirlik defterle, geri alma ters kayıt/`revokedAt` — telemetri defter değildir, budanabilir, ama iş kararına giren bilgi defterdedir. **(K2)** dokuma/devere yıkıcı olmayacak: ayrı bayraklar, varsayılan kapalı, adlandırılmış kapı, `Item.name` ASLA ayrıştırılmaz, fork yok. **(K3)** kapalıyken adnansahin'in hiçbir ekranında yeni alan/zorunluluk/adım görünmez; migration yalnız kolon/tablo ekler. **(K4)** soru sorma, karar ver.

---

## 0 · Yöneticiye özet

- **Bu dilim `Machine`'e tek bir skaler kolon eklemez**, `Item`e hiç dokunmaz, `WorkSession`'a hiç dokunmaz. Kapalıyken (adnansahin) DB'ye düşen tek şey **İKİ boot uzlaştırıcısının satırlarıdır** — 23 sistem sebebi + dört `loom:*` izin kodu (~2 KB) — ve hiçbiri hiçbir yüzeyde görünmez (§8.1 K3-7).
- **Modül anahtarı zaten var:** `tezgah.enabled` / `tezgahEnabled`, varsayılan **false**, bağımlılığı `productionEnabled` (`src/constants/module-flags.ts:40,52,78` — 2026-09-12'de `devereEnabled` araya girdi ve eski `:40,51,69` çapaları kaydı; bu dosyada satır numarası ölçülmeden yazılmaz). Yeni modül anahtarı açılmıyor; açılacak olan **yüzeydir**. K2'nin "yeni modüller aç/kapat olacak" şartı bu dilimde mevcut anahtarla karşılanıyor (§7.1).
- **En küçük satılabilir dilim Faz 1a:** hiç donanım yok, 6 tablo, **3 migration** (A · B1 enum · B2 kolon+CHECK — enum kendi dosyasında, §9), 2 panel sayfası + 1 rapor, 4 izin, 2 bayrak, **advisory kilit yok**, 4 yeni bekçi. Kullanıcının dört sorusunun dördünü de cevaplar: duruş nedeni · randıman · devir · çalışma saati (§9).
- **Telemetri ile defter aynı cümlede ayrışır:** ham örnek silindiğinde raporlanan hiçbir sayı değişmiyorsa o satır telemetridir — ve bunu insan vicdanı değil bir bekçi ölçer (§1, §4). **Telemetri bir hard-delete SINIFI DEĞİLDİR**, defter-olmayan satırın yaşam döngüsüdür; `defter.md`ye üçüncü sınıf açılmaz, açılan şey bir **bölüm + budamayı ölçen manifest bekçisidir** (§4).
- **Zamanın ve gölge modun tek cümlesi:** *zamanı ajan ölçer, sunucu **DOĞRULAR** ve uydurmaz; kimlik saat değil **token**'dır; mühürden sonra hiçbir telemetri sessizce değişmez; geçici değer geçici olduğunu **kolonda** söyler* (§3.5, §5.1). Devreye alma da bir cümle değil bir kolondur: `MachineSpec.monitoringState` **OFF → SHADOW → LIVE** ve varsayılan **OFF = bugünkü davranış** (§2.3).
- **Ham 10 sn örnek DB'ye HİÇ girmez** (20 tezgahta 63 M satır/yıl). Bedeli bir "yedek penceresi" değil **KURULUM KAPISIDIR**: `kur.ps1` her sürümden önce `pg_dump -Fc` alır, `pg_restore --list` ile doğrular ve ikisinden biri düşerse **kurulumu İPTAL eder** (`deploy/kur.ps1:448-451`) — şişen tablo yedeği yavaşlatır, başarısız yedek güncelleme yolunu tümüyle kapatır. Kalıcı büyüme ≈ 240 MB/yıl, budanan tavan ≈ 570 MB — ilk yıl toplam < 1 GB (§4).
- **Randıman = A × P** (kalite hariç), oranlar asla ortalanmaz, terimler toplanır; formül tek helper'da yaşar ve mühür anında donar (§5).
- **Toplayıcı ajan ayrı bir gövdedir** (`kenar/`, headless Windows servisi, salon başına bir mini-PC). Electron "Toplayıcı Modu" **yazılmaz** — panelin main process'i HTTP başlatamaz ve `electron-updater` kurulumu **operatörün başlattığı** bir yeniden başlatmadır (vardiya ortasında basılabilir), yani toplayıcı kapanmasına insanın karar verdiği bir sürecin içinde yaşayamaz (§3.1, §10/#2).
- **Levent bu belgenin işi değildir.** `WarpBeam` ailesi `docs/design/DEVERE-LEVENT-TARAMASI.md`'nindir; tezgah tarafı yalnız okuyucudur ve bu okuma bir KOLON DEĞİL, `beamsMountedDuring(machineId, from, to)` **türetmesidir** — `MachineRun`da levent FK'sı YOK (§7.3).
- **Denetimin en sert dört bulgusu:** ① budama defter satırı silebiliyordu → DB trigger seddi + **«Telemetri ≠ defter» bölümü** + budamayı ÖLÇEN manifest bekçisi (**üçüncü hard-delete sınıfı AÇILMAZ**, §4); ② geri alınmış duruş ajanın kuyruğundan sessizce yeniden doğuyordu → dört durumlu replay; ③ duruşun kapanışı kendi idempotency kuralına çarpıyordu → dar kimlik + geçiş alanı; ④ `MINOR` kaybı sebepten türüyordu, 45 dakikalık kopuş kullanılabilirliği şişiriyordu → `MINOR` yalnız süreden türer (§11).

---

## 1 · Tek cümlelik mimari

> Fabrika LAN'ındaki **kenar toplayıcı ajan** tezgahın *donanım* sayaçlarını ve kontaklarını okur, kenarda indirger ve backend'e HTTPS ile toplu basar; backend **hiçbir porta bağlanmaz**, gelen paketi sınıflara ayırır — **ham örnek hiç yazılmaz** (kenarda ölür), **`MachineInterval` kovası ve İNSAN KARARI ALMAMIŞ duruş TELEMETRİDİR** (`updatedAt` var, tavanlı, budanır, yeniden yazılabilir), **insan kararı almış duruş · koşum · sayaç kararı · mühür defteri DEFTERDİR** (budanmaz, geri alma ters kayıt/`revokedAt`) — ve randıman yalnız mühürlü karnenin **terimlerinden** tek helper'da hesaplanır, ham telemetriden değil.

Ayrım çizgisi tek cümleyle: **ham örnek silindiğinde raporlanan hiçbir sayı değişmiyorsa o satır telemetridir.** Bunu bir bekçi ölçer (`scripts/test_machine_prune_safety.ts`, §4).

> **ZAMANIN VE KİMLİĞİN TEK CÜMLESİ (Faz 2 sözleşmesi, 2026-09-12):** **zamanı ajan ölçer, sunucu DOĞRULAR ve uydurmaz** (hizasız kova 400, snap yok) · **kimlik saat değil TOKEN'dır** (`stopKey` UUID; `startedAt` veridir) · **mühürden sonra hiçbir telemetri sessizce değişmez** (yeniden yazma yalnız mühürsüz pencerede, mühürlüde 409 `SHIFT_SEALED`) · **geçici değer geçici olduğunu KOLONDA söyler** (`provisionalEndedAt` · `endSource = WATCHDOG` · `restateCount`). Dört ilkenin şemadaki karşılığı §2.6/§2.7'de, kapıları §3.5'tedir.

Emsal gerçektir ve ölçüldü: `EndpointLatencyDaily` + `src/services/latency-persist.service.ts:19-20` — *"fiziksel DELETE — operasyonel özet verisi, domain kaydı değil; tablo TAVANLI kalır"*, `RETENTION_DAYS = 90` (`:34`), budama `deleteMany` (`:172`).

---

## 2 · Veri modeli

### 2.0 · Sınıflar — şema imzası sınıfı BEYAN EDER

| Sınıf | `createdAt` | `updatedAt` | Budanır | Geri alma |
|---|---|---|---|---|
| **DEFTER** (append-only) | ✅ | ❌ **YOK** | ❌ asla | üstüne yazan yeni satır (ters kayıt) |
| **DEFTER** (span: açılır/kapanır) | ✅ | ✅ | ❌ | `revokedAt` damgası |
| **ÖZET / MATERYALİZE KARNE** | ✅ | ✅ | ❌ | durum geçişi + kendi olay defteri |
| **TELEMETRİ** | ✅ | ✅ | ✅ tavanlı | yeniden yazılır (`restateCount` + son `restatedAt`) — **yalnız MÜHÜRSÜZ pencerede**; mühürlüde 409 `SHIFT_SEALED` |
| **DURUM** | ✅ | ✅ | — | üstüne yazılır |

> **Denetim düzeltmesi (doktrin merceği B6).** Sentez `MachineShiftStat`ı "DEFTER (append-only)" ilan edip `updatedAt` veriyordu; `docs/kurallar/defter.md` bunu adıyla yasaklıyor (*"append-only defter satırı GÜNCELLENMEZ ve SİLİNMEZ; bu yüzden `updatedAt` almaz… bir tablo hem defter hem durum kaynağı OLAMAZ"*). Karne artık **ÖZET/MATERYALİZE KARNE** sınıfındadır: güncel gerçeği o taşır, **geçmişi `MachineShiftStatSeal` defteri taşır** (§2.10). `Shipment.status ↔ ShipmentEvent` ikilisinin aynısı.

### 2.1 · Mevcut modellere EKLER

Bu dilim `Machine`'e **tek bir skaler kolon eklemez** — yalnız ters ilişki alanları. Tezgah künyesi `MachineSpec`'te yaşar; referans profilde (adnansahin) o tablo BOŞTUR ve `Machine` bugünkü hâliyle kalır.

```prisma
model Machine {
  // ... mevcut alanlar DEĞİŞMEZ (skaler kolon eklenmiyor)
  machineSpec         MachineSpec?
  machineIntervals    MachineInterval[]
  machineStops        MachineStopEvent[]
  machineRuns         MachineRun[]
  machineLiveState    MachineLiveState?
  machineShiftStats   MachineShiftStat[]
  machineCounterEvents MachineCounterEvent[]     // ← denetim: eksik karşı-ilişki
  collectorLinks   MachineCollectorLink[]
}

model ShiftInstance {          // §2.5'te tanımlanıyor
  stops MachineStopEvent[]        // ← denetim: eksik karşı-ilişki
}

model User {
  machineStopsClassified   MachineStopEvent[]     @relation("MachineStopClassifiedBy")
  machineStopReclasses     MachineStopReclass[]   @relation("MachineStopReclassBy")
  // ↓ KARŞI-İLİŞKİ ENVANTERİ (aşağıdaki kutu) — sekizi User'da
  machineSpecsCreated      MachineSpec[]          @relation("MachineSpecCreatedBy")
  machineSpecsUpdated      MachineSpec[]          @relation("MachineSpecUpdatedBy")
  machineCollectorsCreated MachineCollector[]     @relation("MachineCollectorCreatedBy")
  machineCollectorsUpdated MachineCollector[]     @relation("MachineCollectorUpdatedBy")
  shiftDefsCreated      ShiftDefinition[]   @relation("ShiftDefinitionCreatedBy")
  shiftDefsUpdated      ShiftDefinition[]   @relation("ShiftDefinitionUpdatedBy")
  machineShiftStatsSealed  MachineShiftStat[]     @relation("MachineShiftStatSealedBy")
  machineShiftSealsActed   MachineShiftStatSeal[] @relation("MachineShiftSealBy")
}

model MachineCollector {          // §2.4'te tanımlanıyor
  intervals MachineInterval[]     // ← MachineInterval.collector'ın karşılığı
  stops     MachineStopEvent[]    // ← MachineStopEvent.collector'ın karşılığı
}

// MachineRun'un üç opsiyonel bağının karşılıkları (§2.8) — FAZ 2:
model WorkOrderStep { machineRuns MachineRun[] }
model Item          { machineRuns MachineRun[] }
model Color         { machineRuns MachineRun[] }

model PeripheralDevice {
  /// UYGULAMA PROTOKOLÜ (`connectionType` TAŞIYICIYI söyler, bu KONUŞULAN DİLİ):
  /// "modbus-tcp" | "modbus-rtu" | "opcua" | "ascii-line". Enum DEĞİL — küme
  /// büyümeye açık ve `ConnectionType`a değer eklemek yazıcı/kantar yollarını da
  /// ilgilendirirdi. Tanınmayan değer → fail-closed 400, yerleşiğe SAPMA YOK.
  protocol String? @db.VarChar(24)
  signals  PeripheralSignal[]
}

model ReasonPreset {
  /// YALNIZ `kind = MACHINE_STOP`ta anlamlı. NULL = sınıflandırılmamış → rapor
  /// UNPLANNED sayar. ⚠️ `stopPlanned` diye İKİNCİ kolon YOK (planlı/plansız
  /// bundan türetilir, tek helper); ⚠️ `MINOR` buraya ASLA yazılmaz (§5.2).
  stopLossClass MachineStopLossClass?
}
// ŞEMA-DIŞI CHECK (ham SQL + test_db_invariants envanteri):
//   reason_presets_machine_class_chk:
//   CHECK (kind <> 'MACHINE_STOP' OR ("stopLossClass" IS NOT NULL
//                                   AND "stopLossClass" <> 'MINOR'))
// ⚠️ CHECK + `constants/reason-presets.ts` + `reason-preset-catalog.job.ts`
//    AYNI COMMIT'te değişir. Job yeni kolonu yazmazsa INSERT **23514** (CHECK
//    ihlali) ile düşer — ve hata YUTULMAZ, GÜRÜLTÜLÜDÜR: uzlaştırma
//    `permission-catalog.job.ts`in izin→rol→sebep ZİNCİRİNDEDİR (`:36` import,
//    `:157` çağrı) ve 5 denemeden sonra `hata()` + `PERMISSION_CATALOG_RECONCILE_FAILED`
//    audit satırı basar (`:177`, `:184`). Zarar "katalog sessizce boş" DEĞİL,
//    "MACHINE_STOP satırları ve sonraki kind'lar hiç doğmaz + boot zinciri ortasında
//    düştüğü için o turda ROL ŞABLONLARI da yazılmaz"dır; boş kind'da sunucu ve
//    tablet gömülü kataloğa düşer.
//    (`runReasonPresetReconciliation` ÖLÜ KODDUR — repoda yalnız kendi tanımında
//     geçer; canlı yol yukarıdaki zincirdir.)
```

`WorkSession`'a **hiç dokunulmaz** (gerekçe §2.5). `Item`e, `ProductRecipe`ye ve stok kartı adına **bu dilimde hiç dokunulmaz** (K2).

> **KARŞI-İLİŞKİ ENVANTERİ — 13 alan, `prisma validate` KAPISI.** Prisma tek yönlü ilişki kabul etmez: bu belgede `@relation` yazan her alan karşı tarafını da beyan etmezse `npx prisma validate` **P1012** ile düşer ve şemaya dökme işi ilk adımda durur. Envanter: **User'da 8** (`MachineSpecCreatedBy` · `MachineSpecUpdatedBy` · `MachineCollectorCreatedBy` · `MachineCollectorUpdatedBy` · `ShiftDefinitionCreatedBy` · `ShiftDefinitionUpdatedBy` · `MachineShiftStatSealedBy` · `MachineShiftSealBy`), **MachineCollector'da 2** (`intervals` ← `MachineInterval.collector`, `stops` ← `MachineStopEvent.collector`), **WorkOrderStep · Item · Color'da birer `machineRuns`** (§2.8). Bunlara zaten yazılı olan `Machine` ters ilişkileri, `ShiftInstance.stops` ve iki `User` duruş ilişkisi eklenir.
> **Kural:** *bu belgede `@relation` yazan her alan, karşı tarafını AYNI bölümde beyan eder; beyan edilmemiş ilişki tasarım hatası sayılır.* Faz kabul kapısında `npx prisma validate` **temiz** çıkmalıdır (§9).

> **⚠️ RESTRICT FK YAZAN HER FAZ, AYNI COMMIT'TE KALICI SİLME YÜZEYİNİ BÜYÜTÜR.** `Machine`in kalıcı silinmesi `MACHINE_DELETE_GUARDS` adlı **SABİT** bir listeden geçer (`src/services/helpers/guarded-hard-remove.ts:236-273`; bugün **altı sayaç**: `rollOperationCount` · `rollMovementCount` · `rollCreatedCount` · `workSessionCount` · `deviceCount` · `kursunBypassCount` — ölçüldü 2026-09-12; eski *"beş sayaç / `:236-279`"* ölçümü `kursunBypassCount` eklenince bayatladı) ve **önizlemedeki `deletable` de aynı listeden doğar** — yani listeye yazılmayan bir Restrict FK, panelde "kalıcı silinecek" der, `DELETE` P2003'e düşer ve kullanıcı generic 400 görür. "409 + sayı" kalıbı ile *"önizleme etkilenen HER kaydı listeler"* kuralı birlikte kırılır.
> **Yol:** Faz 1a → `machineShiftStatCount`; Faz 1b → `machineStopCount`; Faz 2 → `machineRunCount` + `machineCounterEventCount`. **Guard eklenmeden FK yazılmaz.** Panel açıklaması (`Electron/src/pages/Stations/machineDeleteDescription.ts`) ve önizleme aynı listeden doğduğu için kendiliğinden hizalanır.

**`ReasonPresetKind` enum'una tek değer: `MACHINE_STOP`.** Reçeteli iş (`docs/RECETELER.md` § Prisma enum'una yeni değer), kendi migration'ında, **`ALTER TYPE … ADD VALUE IF NOT EXISTS`** ile. Aynı commit'te dokunulacaklar: `KIND_STORES_TEXT.MACHINE_STOP = false` (satıra **kod** yazılır, metin değil — `as const satisfies Record<ReasonPresetKind, boolean>` olduğu için derleyici zaten zorlar), `KIND_LABELS`, `REASON_PRESET_CATALOG.MACHINE_STOP`, Electron `types/enums.ts` + `ENUM_LABELS` (bekçi `test_audit_labels §4` şemadaki HER enum değerini arar), mobil `src/services/reasonPreset.service.ts` kind union'ı + iki `Record` (union güncellenmezse tablet yeni kind'ı hiç tanımaz ve **derleme patlamaz**).

**Sessiz tüketici listesi eksikti — iki dosya daha aynı commit'te değişir:** `Electron/src/pages/ReasonPresets/service.ts` (kind union'ı **elle** yazılmıştır, `:11`; `KIND_TABS` ayrı bir liste) ve `mobil/src/hooks/useReasonPresets.ts` (BUILTIN `Record` + `switch`). Emsal ÖLÇÜLMÜŞ bir geçmiştir: `ORDER_CANCEL` (2026-08-26) mobil union'a hiç girmedi, derleme ve bekçiler **yeşil geçti**. Bu yüzden Faz 1a'ya **yeni bir parite bekçisi** yazılır — `scripts/test_reason_preset_kind_parity.ts`: *sunucu `ReasonPresetKind` ↔ Electron union + `KIND_TABS` ↔ mobil union + `KIND_STORES_TEXT`/`KIND_LABELS` + BUILTIN `switch` **birebir***. Negatif sonda: `ORDER_CANCEL`ı mobil union'dan düşür → kırmızı. ⚠️ Bekçi **ilk koşumda bugünkü gerçek kusuru yakalayacaktır** (`ORDER_CANCEL` mobilde yok); o eksik aynı commit'te kapatılır.

> **⚠️ Kapalı kurulumda ne oluyor (K3 ölçümü).** `jobs/reason-preset-catalog.job.ts` her boot'ta `REASON_PRESET_KINDS` üzerinde döner ve eksik sistem satırlarını **koşulsuz** yaratır — modül bayrağına BAKMAZ. Yani 23 `MACHINE_STOP` satırı adnansahin'in canlı DB'sine de düşer. **Bu bilinçlidir:** izin kataloğu denklemi (katalog koda, uzlaştırma boot'ta), ~2 KB, ve hiçbir yüzeyde görünmez. Görünürlük kapısı paneldedir: Hazır Sebepler ekranının `KIND_TABS` dizisi (`Electron/src/pages/ReasonPresets/service.ts:54`) elle yazılmış bir listedir, sekme kendiliğinden belirmez — **`MACHINE_STOP` sekmesi oraya yalnız `tezgahEnabled` açıkken çizilecek biçimde eklenir.** Reçeteyi körlemesine uygulayıp sekmeyi koşulsuz eklemek, tezgahı kapalı fabrikada beşinci bir sekme doğurur ve K3'ü ihlal eder.
>
> **Aynı boot turunda İKİNCİ bir uzlaştırıcı daha yazar:** `jobs/permission-catalog.job.ts` Faz 1a'nın **dört `loom:*` izin kodunu** (Faz 2 ile toplam **yedi izin kodu: altı `loom:*` + bir `mobile:*`** — §6.4) kapalı kurulumun `permissions` tablosuna da düşürür (§6.4). İkisi birlikte ~2 KB'dir ve görünmezlik ayrıca ölçülür (§8.1 K3-7).
>
> **⚠️ Tabletin kapısı da ELLEDİR ve panelinkinden ZAYIFTIR.** `mobil/src/services/reasonPreset.service.ts` uca `?kind=` **göndermez** (`list()` yalnız `includeInactive` taşır) — yani `MACHINE_STOP` satırları kapalı kurulumda da **cihaza iner**; görünmezlik tümüyle ekranların kendi kind'larıyla süzmesine bağlıdır. Backend süzgeci zaten destekliyor (`routes/reason-preset.routes.ts:75` `req.query.kind`). Faz 2'de tablet sınıflandırma kuyruğu yazılırken çağrı `?kind=`li yapılır — ancak o zaman "kapalı modül iz bırakmaz" cümlesi tablette de kurulmuş olur.

### 2.2 · Enumlar

```prisma
/// MAKİNE SINIFI — YALNIZ SUNUM/RAPOR ETİKETİ. Levent tüketen makine dokuma
/// tezgahıyla sınırlı değildir (`DEVERE-LEVENT-TARAMASI.md` §9.5): raşel (çözgülü
/// örme) de levent tüketir, kılavuz barı başına bir levent.
///
/// ⚠️⚠️ DAVRANIŞ BU ALANDAN DALLANMAZ. Ne sayacın birimi, ne randımanın paydası,
/// ne metre formülü buraya bakar. Sebep iki tane ve ikisi de kural:
///   (1) `kind`-dispatch yasağı — kök `CLAUDE.md`: "yeni `kind === ...` karşılaştırması"
///       yasaktır ve bu alan üstünde dallanan her formül tam olarak odur;
///   (2) ÇİFT YÜKLEM — sinyal `PICK_COUNTER` derken sınıf `WARP_KNIT` derse hangisi
///       kazanır? Cevabı olmayan soru sorulmaz: birim SİNYALDE yaşar, sıklık KOŞUMDA.
/// Bu yüzden alan ZORUNLU DEĞİLDİR ve NULL kalabilir: "ağızlıksız makine" bilgisini
/// `shedType IS NULL` zaten söyler (2026-09-12 düşmanca denetimi, §10/#22).
///
/// ⚠️ VERİ alanıdır, bayrak değil: aynı fabrikada hem tezgah hem raşel olur.
enum MachineClass {
  LOOM       // dokuma tezgahı
  WARP_KNIT  // raşel / çözgülü örme
  WARPER     // devere / çözgü makinesi — kumaş üretmez, levent üretir
}

/// ÜRETİM HATTI — "kaç kumaş". ⚠️ LEVENT SAYISINDAN BAĞIMSIZ EKSEN (§10/#23):
/// raşel N levent tüketir ama TEK kumaş örer (bütün kılavuz barları aynı örgüyü besler,
/// tek sıra sayacı); çift enli tezgah 1–2 levent tüketir ama İKİ ayrı kumaş dokur.
/// İkisini tek sayıya bindiren model birini MUTLAKA yanlış anlatır — ve bir uçta doğru
/// çalıştığı için yanlışlık SESSİZ kalır (test edilen uç, çalışan uçtur).
///   GİRDİ = `Machine.warpBeamSlots`  ·  ÇIKTI = `Machine.productionLineCount`
///
/// `Machine.productionLineCount Int @default(1) @db.SmallInt`  — CHECK `>= 1`
///   ⚠️ CHECK YÖNÜ ÖLÇÜYLE DEĞİL TERSİNE ÇEVRİLEBİLİRLİKLE seçildi: karşı senaryo
///   arandı (izlenen ama üretmeyen ekipman — ölçüm masası, kazan, kompresör) ve
///   BULUNAMADI, çünkü "sayacı yok" hâli zaten `productionLineNo` NULL ile ifade ediliyor.
///   Karşı örnek yokken ucuz yönde yanılırız: `>= 1` → gevşetmek TEK İFADELİ migration;
///   `>= 0` → sıkmak veri temizliği ister. **Bilinen gevşetme yolu:** böyle bir ekipman
///   izleme kapsamına girerse CHECK `>= 0`a iner ve o makinede metre/randıman raporları
///   "üretim ölçülmez" der; tablo ve varsayılan değişmez.
///   ⚠️ `warpBeamSlots`taki `>= 0` kararıyla ÇELİŞMEZ: orada karşı örnek BULUNMUŞTU
///   (cağlıktan beslenen çözgü makinesinde yuva gerçekten 0). Karşı örnek varsa ölçüm
///   kazanır; yoksa tersine çevrilebilirlik kazanır.
///
/// `MachineRun.productionLineNo` · `MachineInterval.productionLineNo` · `MachineShiftStat.productionLineNo`
///   hepsi `Int @default(1)`; kısıtlar §2.x'te genişler (aşağıda).
/// `PeripheralSignal.productionLineNo Int?` — bu kanal HANGİ hattı ölçüyor; NULL = üretim gerçeği
///   DEĞİL (karşılaştırma/tanı kanalı) ve metreye/randımana GİRMEZ.
/// `PeripheralSignal.beamSlot Int?` — bu kanal hangi levent yuvasının kopuşunu izliyor
///   (§5.4 kırılımı); NULL = bilinmiyor.

/// Ağızlık düzeni — SUNUM + KAPASİTE alanı, davranış dispatch'i DEĞİL.
/// ⚠️ NULLABLE: çözgülü örme makinesi ağızlık AÇMAZ. Eski NOT NULL hâli raşeli
/// şemadan yapısal olarak dışlıyordu — `MachineSpec` satırı açılamayan makine izleme
/// kapsamına hiç giremiyordu (2026-09-12 kararı, §10/#22).
enum LoomShedType { ARMUR  JAKAR  KAM }

/// Atkı atma sistemi — bakım sınıfı ve tipik devir aralığının çıpası.
/// ⚠️ NULLABLE: çözgülü örmede atkı YOKTUR; beş değerin hiçbiri karşılamaz.
enum LoomWeftInsertion { RAPIER  AIRJET  WATERJET  PROJECTILE  SHUTTLE }

/// Sinyalin ANLAMI (marka bağımsız). Taşıma `PeripheralDevice.protocol`ta.
enum MachineSignalKind {
  RUN_CONTACT    // çalışıyor/duruyor kontağı veya durum word'ü biti
  PICK_COUNTER   // KÜMÜLATİF atkı sayacı — dokumada TERCİH EDİLEN yol
  COURSE_COUNTER // KÜMÜLATİF sıra (course) sayacı — çözgülü örmede atkının karşılığı
  RACK_COUNTER   // KÜMÜLATİF rack sayacı (1 rack = 480 sıra) — çevrim `scale`de, ayrı formül YOK
  RUN_SECONDS    // makinenin kendi kümülatif çalışma saati sayacı
  INSTANT_RPM    // doğrudan devir okunabiliyorsa
  WARP_STOP      // çözgü kopuş sinyali
  WEFT_STOP      // atkı kopuş sinyali
  OPERATOR_STOP  // elle durdurma
  STOP_CODE      // marka ham duruş kodu register'ı
  FABRIC_LENGTH  // makinenin kendi kümülatif metre sayacı
}

/// Tezgahın ŞU ANKİ hâli. SEMI E10'un sadeleştirilmişi.
enum MachineRunState { RUNNING  STOPPED  SETUP  OFF  UNKNOWN }

/// Rakam NEREDEN geldi. ⚠️ `@default` VERİLMEZ — her yazar açıkça beyan eder.
/// INFERRED: sayaç durağanlığından ÇIKARILDI (röle/kontak yok). Güvenilirliği
/// MACHINE'den düşüktür ve rapor bunu ayrı beyan eder — `MACHINE` damgası
/// altında gizlenmesi yasak.
enum MachineDataSource { MACHINE  INFERRED  OPERATOR  SUPERVISOR  SIMULATED }

/// Sayaç farkının NİTELİĞİ — uydurulmuş fark yazılmaz, nitelenir.
enum MachineDeltaQuality { OK  WRAPPED  RESET  GAP  ANOMALY }

/// Duruşun randıman muhasebesindeki kovası (ISO 22400-2 zaman modeli +
/// SEMI E10 durum sınıfları + Nakajima altı büyük kayıp).
/// ⚠️ MINOR bir SEBEP SINIFI DEĞİL, bir SÜRE SINIFIDIR: yalnız
/// `tezgah.stopEventMinSeconds` altındaki duruşlardan türer ve
/// `ReasonPreset.stopLossClass`a ASLA yazılamaz (CHECK ile zorlanır, §5.2).
enum MachineStopLossClass {
  UNPLANNED      // arıza, kopuş sonrası bekleme, operatör yok
  PLANNED        // planlı bakım, temizlik, mola
  SETUP          // levent bağlama · tahar · tarak · desen değişimi
  MINOR          // mikro duruş — PERFORMANS kaybı, kullanılabilirlik DEĞİL
  NON_SCHEDULED  // sipariş yok / vardiya planlı değil — HİÇBİR paydada yok
}

enum MachineStopEndSource { MACHINE  OPERATOR  MANUAL  WATCHDOG }

/// Vardiya karnesinin mühür DURUMU. `sealedAt` bir damgadır, durum değil.
enum MachineSealState { OPEN  SEALED }

/// Mühür defterinin eylem türü — serbest metin DEĞİL (dördüncü bir değer
/// sessizce kabul edilemez, §2.10).
enum MachineSealAction { SEAL  UNSEAL  RESEAL }

/// Bir tezgahın İZLEME OLGUNLUĞU — kanal kabul testinin KODLA zorlanan hâli.
/// ⚠️ ÜÇ DEĞER ve varsayılan **OFF**: "yeni davranış bayrağının varsayılanı =
/// BUGÜNKÜ davranış" kuralı `SHADOW` varsayılanıyla kırılırdı (künye satırı
/// doğan her makine kendiliğinden izlemeye girerdi). Emsal `DeviceStatus`
/// PENDING → APPROVED.
///   OFF    : ingest **403 `MACHINE_NOT_IN_SCOPE`**; kova/duruş HİÇ yazılmaz.
///   SHADOW : kova ve duruş yazılır, karne normal MÜHÜRLENİR — ama DEFTER
///            raporları (R1–R5) bu tezgahı varsayılan olarak SÜZER; gölge karne
///            yalnız "Devreye Alma" sekmesinde ve dışa aktarımda GÖLGE damgalı.
///   LIVE   : kabul kapısı geçildi, rakam yayınlanabilir (§2.3, §5.3).
enum MachineMonitoringState { OFF  SHADOW  LIVE }
```

### 2.3 · Makine künyesi ve sinyal haritası

```prisma
/// DURUM / MASTER DATA — tezgahın teknik künyesi. Satırın VARLIĞI "bu makine
/// bir tezgahtır" demektir; `Machine.kind` enum'u AÇILMADI (kind-dispatch
/// yasağı). Ayrı tablo: alanlar `Machine`e girseydi adnansahin'in kurşun
/// makinesinde ölü kolon olurdu.
/// ⚠️ SATIRIN VARLIĞI "bu makine İZLENİYOR" demektir — "bu makine bir DOKUMA
/// TEZGAHIDIR" DEĞİL — ne olduğu `Machine.machineClass` etiketinden okunur, ve o etiket
/// zorunlu bile değildir: "ağızlıksız makine" bilgisini `shedType IS NULL` zaten söyler.
model MachineSpec {
  id        String  @id @default(uuid()) @db.Uuid
  machineId String  @unique @db.Uuid
  machine   Machine @relation(fields: [machineId], references: [id], onDelete: Cascade)

  /// ⚠️ NULLABLE — ağızlık açmayan makinede (çözgülü örme) boştur. Sınıfa bağlı CHECK
  /// YAZILMAZ: sınıf üstünde dallanmak `kind`-dispatch olurdu ve etiket zorunlu değil.
  shedType      LoomShedType?
  /// ⚠️ `isMonitored Boolean` KALDIRILDI (Fable denetimi): tek boolean, kabul
  /// testinden BAĞIMSIZ açılabiliyordu ve "gölge mod" yalnız bir reçete cümlesiydi
  /// — NC/NO rölesi ters bağlı bir tezgah %100 randımanla MÜHÜRLENİRDİ, mühür de
  /// kalıcıdır. **Gölge mod artık bir REÇETE CÜMLESİ DEĞİL, bir KOLON + KAPIDIR**
  /// ve tek kaynaktır (iki kolon "çift yüklem" sınıfıdır): izleniyor mu sorusunun
  /// cevabı `monitoringState`tir.
  /// ⚠️ **`OFF` DOĞAR** — varsayılan = bugünkü davranış (§2.2). `OFF → SHADOW`
  /// `loom:spec-manage` ister ve ingest kapsamını açar; `SHADOW → LIVE` üç kapı
  /// arar (`POST /api/tezgah/specs/:id/go-live`, atomik claim `WHERE monitoringState='SHADOW'`):
  ///   ① kapsamdaki HER aktif `PeripheralSignal` kabul damgalı — eksikse
  ///      **409 `SIGNAL_NOT_ACCEPTED`** + eksik sinyaller ADIYLA listelenir;
  ///   ② ≥ `tezgah.shadowMinShifts` (15) MÜHÜRLÜ gölge vardiya — **409
  ///      `SHADOW_TOO_SHORT`** ("14/15");
  ///   ③ anomali oranı ≤ `tezgah.acceptanceMaxAnomalyPct` (5) — **409 `SHADOW_ANOMALY`**.
  /// LIVE'dan geri dönüş SEBEPLİ DEMOTE'tur (`demoteReason` zorunlu); `acceptedAt`
  /// ASLA null'lanmaz (ileri damga null'lanmaz kuralı), demote ayrı damga yazar.
  monitoringState MachineMonitoringState @default(OFF)
  acceptedAt      DateTime? @db.Timestamptz
  acceptedById    String?   @db.Uuid
  acceptedNote    String?   @db.VarChar(300)
  /// SEBEPLİ GERİ ALMA — LIVE → SHADOW. Kanal değiştirmek isteyen operatörün
  /// tek yolu budur: LIVE makinede kanal değişikliği **409 `CHANNEL_CHANGE_REQUIRES_SHADOW`**.
  demotedAt    DateTime? @db.Timestamptz
  demotedById  String?   @db.Uuid
  demoteReason String?   @db.VarChar(300)

  /// Koşum hedefi girilmemişse performans paydası için YEDEK. NULL ise
  /// performans HESAPLANMAZ (null) — uydurulmaz.
  nominalPicksPerMin Int?

  /// ERP'den ÖNCEKİ çalışma saati bakiyesi. ⚠️ ARTAN SAYAÇ KOLONU DEĞİL — toplam
  /// saat TÜRETİLİR: `baselineRunHours + Σ(karne aptSec, baselineAt sonrası)`.
  /// Artan kolon İKİNCİ YAZAR olurdu ("çift yüklem" sınıfı).
  baselineRunHours Decimal?  @db.Decimal(12, 2)
  baselineAt       DateTime? @db.Timestamptz
  notes            String?   @db.VarChar(500)

  // ── FAZ 2 ALANLARI (Faz 1a'da YAZILMAZ, §9) ──────────────────────────────
  // frameCount · hookCount · weftInsertion · manufacturer · modelName ·
  // serialNo · commissionedAt · reedWidthCm · picksPerRev @default(1)
  //
  /// FİZİKSEL üst DEVİR (**devir/dk**) — OLABİLİRLİK TAVANI'nın girdisi (§3.4),
  /// randıman paydası DEĞİL. ⚠️ ADI `maxPicksPerMin` DEĞİLDİR: atkı/dk ile devir/dk
  /// aynı büyüklük değildir ve eski ad `picksPerRev = 2` olan tezgahta tavanı
  /// 2 katına gevşetip kontrolcü çöpünü `OK` damgalıyordu (Fable D1). Atkıya çevrim
  /// `× picksPerRev`tir ve `picksPerRev` YALNIZ tavana girer, PAYDAYA ASLA.
  /// ⚠️ NULLABLE ve Faz 2'de doğar: NOT NULL olsaydı Faz 1a'da kullanıcı uydururdu
  /// ve uydurulan değer Faz 2'de LOAD-BEARING olurdu.
  /// NULL iken tavan UYGULANMAZ, kalem `ANOMALY` damgalanır (fail-closed).
  // maxRevPerMin Int?

  createdAt   DateTime @default(now()) @db.Timestamptz
  updatedAt   DateTime @updatedAt @db.Timestamptz
  createdById String?  @db.Uuid
  updatedById String?  @db.Uuid
  createdBy   User?    @relation("MachineSpecCreatedBy", fields: [createdById], references: [id])
  updatedBy   User?    @relation("MachineSpecUpdatedBy", fields: [updatedById], references: [id])

  @@map("machine_specs")
}

/// MASTER DATA — bir çevre cihazının OKUNABİLİR NOKTALARI. (FAZ 2)
/// Bir tezgah ÇOK sinyal verir; `PeripheralDevice.role` ile tezgah başına 5
/// satır açmak IP değişince 5 kez düzenlemek demekti → tek BAĞLANTI + N SİNYAL.
/// ⚠️ `SIGNAL_SOURCE` kind'ında çarpan YALNIZ burada yaşar; o cihaz tipinde
/// `PeripheralDevice.scale` KULLANILMAZ (ikiz kolon olurdu).
model PeripheralSignal {
  id           String           @id @default(uuid()) @db.Uuid
  peripheralId String           @db.Uuid   // ⚠️ NOT NULL — kanal fiziksel uç noktasız var olamaz
  peripheral   PeripheralDevice @relation(fields: [peripheralId], references: [id], onDelete: Cascade)

  kind     MachineSignalKind
  /// YER: Modbus register no · OPC-UA NodeId · DI kanalı ("DI3") · regex grubu.
  /// ANLAM `kind`te, YER burada.
  pointRef String @db.VarChar(64)
  dataType String @db.VarChar(16)   // "u16" | "u32" | "i32" | "bool" | "float32"
  bitIndex Int?
  /// true = kontak KAPALIYKEN "aktif" (NC röle). Retrofitin EN SIK sessiz hatası.
  invert     Boolean  @default(false)
  scale      Decimal? @db.Decimal(12, 6)
  debounceMs Int      @default(50)   // kuru kontakta ZORUNLU
  /// Sayaç taşma modülü (16-bit register → 65536). SİNYALİN özelliğidir,
  /// makinenin değil — `MachineSpec`te İKİZİ YOK.
  /// ⚠️ NULL DOĞAR ve sarma yorumu KAPALIDIR: her negatif sıçrama RESET/ANOMALY
  /// olur. Modülüs yalnız kanal kabul testinde ÖLÇÜLEREK girilir (§10/#17).
  counterModulus Decimal? @db.Decimal(18, 0)
  /// Çift levent / iki renkli atkı: aynı `kind`tan İKİ kanal meşrudur (jakar
  /// başlığı ayrı kontrolcüdür). ⚠️ `slot = 1` KANONİKTİR: metre YALNIZ slot
  /// 1'in `PICK_COUNTER`ından türetilir, ikinci kanal karşılaştırma içindir.
  slot Int @default(1)

  /// KANAL KABUL DAMGASI — `MachineSpec` LIVE kapısının ① numaralı ön koşulu.
  /// ⚠️ Damgayı "elle tetikledim" BEYANI yazdırmaz: `POST /api/tezgah/signals/:id/accept`
  /// sunucunun son 60 sn'de o kanaldan GÖRDÜĞÜ değişimi arar, yoksa
  /// **409 `SIGNAL_NOT_OBSERVED`** (ters NC/NO kabul ekranının sorusuyla
  /// `invert`e sabitlenir — retrofitin en sık sessiz hatası burada ölçülür).
  /// ⚠️ TEK YAZAR NULL'LAR: `pointRef`/`dataType`/`bitIndex`/`invert`/`scale`/
  /// `counterModulus`/`slot` alanlarından biri değişirse kabul damgası aynı
  /// serviste NULL'lanır — kanal tanımı değişti, eski gözlem o kanalın kanıtı
  /// değildir. (`MachineSpec.acceptedAt` null'lanmaz; bu kolon DAMGA değil KANIT.)
  acceptedAt   DateTime? @db.Timestamptz
  acceptedById String?   @db.Uuid

  isActive Boolean @default(true)

  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  @@unique([peripheralId, kind, slot])
  @@map("peripheral_signals")
}
```

> **⚠️ Yazma yolu `/api/machines` altına GİRMEZ.** `src/middlewares/module.middleware.ts:25-42` `/api/stations · /api/machines · /api/work-sessions` yollarını **bilinçli kapısız** (çekirdek) sayar. `MachineSpec` ve `PeripheralSignal` CRUD'u oraya eklenseydi **tezgah modülü kapalıyken yazılabilirdi**. İkisi de kendi router'ında (`/api/tezgah/specs`, `/api/tezgah/signals`) `requireTezgahEnabled` arkasında doğar.
>
> **⚠️ Panelde `protocol` alanı.** `PeripheralDeviceFormDialog` bugün `connectionType`/`readMode`/`scale`/`simulate` alanlarını çiziyor. Kolon nullable doğduğu için şema tarafı K2'ye uygundur; **form alanı koşulsuz eklenirse adnansahin'in çevre birimi formunda yeni bir "protokol" seçicisi belirir → K3 ihlali.** Alan panelde yalnız `kind === SIGNAL_SOURCE` **ve** `tezgahEnabled` iken çizilir; zorunluluk yalnız modül açıkken ingest doğrulamasında uygulanır.
>
> **⚠️ Silinmiş cihazın aktif sinyali — asıl sed YÜKLEMDEDİR, Cascade değil.** `PeripheralDevice` fiziksel olarak SİLİNMEZ, **mezar taşı alır** (`peripheral.service.ts:204-224`: *"KALICI silme — fiziksel DELETE DEĞİL… `deletedAt` damgalanır"*). Dolayısıyla `PeripheralSignal.peripheral … onDelete: Cascade` pratikte **ölü bir yoldur** ve yalnız son hat olarak durur; gerçek risk, silinmiş cihazın sinyalinin ingest kapsamında yaşamaya devam etmesidir. Kapsam çözümü `signal.isActive AND peripheral.deletedAt IS NULL` koşulunu **TEK helper'da** taşır (boğaz-ikizi Prisma parçasıyla birlikte değişir, §3.3/7): silinmiş cihazın aktif sinyali kapsamda görünmez, kalem **403 `MACHINE_NOT_IN_SCOPE`** alır.
>
> **⚠️ `MachineSpec` Cascade'i KALIR ama önizleme künyeyi ADIYLA listeler.** `Machine` bugün `test_hard_delete_guard_coverage`in `WATCHED` kümesinde **yok** (`:32` — yalnız `Item`, `Customer`, `Device`), yani tezgahın Cascade çocukları eksiksizlik taramasına hiç girmiyor. İki satır: **(1)** `WATCHED`a `"Machine"` eklenir ve `EXPECTED` envanterine her Cascade kendi gerekçesiyle yazılır (Faz 1a'da yalnız `Machine <- MachineSpec.machine : Cascade` — *"cascade-intended: künye makinesiz anlamsız"*). **(2)** Silme önizlemesi tezgah künyesini adıyla listeler; `baselineRunHours` DOLUYSA satır bir **GUARD**'dır (ERP öncesi çalışma saati bakiyesi **elle girilmiş** veridir, sessizce ölemez) → 409 + *"önce bakiyeyi not alın"*. Audit `oldData` yalnız `Machine` skalarlarını taşır (`guarded-hard-remove.ts:269`), yani iz oraya bırakılamaz.

### 2.4 · Toplayıcı kimliği (FAZ 2)

```prisma
/// MASTER DATA + SIR — fabrika LAN'ında koşan kenar toplayıcı ajan.
/// `Device` (tablet) allowlist kalıbının SIRLI kardeşi: tablet yalnız KİMLİK
/// taşır (`x-device-id`, sır değil), toplayıcı 7/24 deftere yazdığı için KİMLİK
/// BİLGİSİ taşır. `Device`a `kind=COLLECTOR`+`tokenHash` eklemek tablet yoluna
/// sır sokardı — reddedildi.
model MachineCollector {
  id           String       @id @default(uuid()) @db.Uuid
  /// Ajanın ilk açılışta üretip diskte tuttuğu yerel UUID (`Device.deviceId` emsali).
  collectorKey String       @unique @db.VarChar(64)
  name         String       @db.VarChar(100)
  /// ⚠️ GENERATED ALWAYS AS (public.tr_fold("name")) STORED — ham SQL migration'ı
  /// gerektirir; Prisma `dbgenerated()` yalnız defteri tutar (§9 Faz 2 migration).
  /// ⚠️ Ham SQL'de kolon **NOT NULL** doğar: nullable bir fold + `@@unique`,
  /// PG'nin NULLS DISTINCT davranışı yüzünden sınırsız "adsız" satır kabul ederdi
  /// (aynı sınıf §2.10 breakdown'da ölçüldü). Prisma tarafındaki `String?` yalnız
  /// generated kolonun defterini tutar.
  nameFold     String?      @default(dbgenerated())
  hostname     String?      @db.VarChar(128)
  agentVersion String?      @db.VarChar(32)
  status       DeviceStatus @default(PENDING)   // mevcut enum

  /// ⚠️ SIR — yalnız bcrypt hash (`bcryptjs@3` zaten bağımlı, yeni paket YOK).
  /// Düz token onay cevabında BİR KEZ döner; log'a, audit yüküne, sürüm notuna
  /// GİRMEZ ve bu bir bekçiyle ölçülür, politika cümlesiyle değil.
  /// ⚠️ KALICI hash bcrypt kalır, ama HER İSTEKTE bcrypt KOŞULMAZ: 20 tezgahlık
  /// kurulumda 5 sn'lik nabız ≈ 4 istek/sn'dir ve backend TEK PROCESS'tir —
  /// doğrulama maliyeti ana iş parçacığına yazılır. Eşleme önbelleği ve ölçüm
  /// sözleşmesi §3.3'te.
  tokenHash      String?   @db.VarChar(72)
  tokenIssuedAt  DateTime? @db.Timestamptz
  tokenRotatedAt DateTime? @db.Timestamptz
  revokedAt      DateTime? @db.Timestamptz
  revokedById    String?   @db.Uuid

  /// Bu toplayıcı YALNIZ bu kuruluma basar — yedekten dönmüş kopyaya canlı veri
  /// basma sınıfını kapatır (`installation-identity.job` + `discovery-txt` `iid`).
  installationId String? @db.VarChar(64)

  clockSkewMs Int?
  /// Kalem sırası — `ackSeq`in kalıcı ikizi. `Int` yeter (912 k kalem/yıl).
  /// ⚠️ YAZIM KADANSI: `lastSeq` YALNIZ kabul edilen PARTİ tx'inde, kalem
  /// kabulüyle AYNI UPDATE'te yazılır; heartbeat ona DOKUNMAZ. Parti başına tek
  /// yazım olduğu için throttle gerekmez (nabzın 5 sn'lik kadansı yalnız
  /// `lastSeenAt`i ilgilendirir — aşağıdaki ölü-tuple gerekçesi).
  lastSeq     Int  @default(0)
  /// 60 sn throttle (`WorkSession.lastActivityAt` emsali) — 5 sn'de bir UPDATE
  /// ölü tuple fırtınası demekti.
  lastSeenAt  DateTime? @db.Timestamptz

  isActive Boolean @default(true)
  machines MachineCollectorLink[]

  createdAt   DateTime @default(now()) @db.Timestamptz
  updatedAt   DateTime @updatedAt @db.Timestamptz
  createdById String?  @db.Uuid
  updatedById String?  @db.Uuid
  createdBy   User?    @relation("MachineCollectorCreatedBy", fields: [createdById], references: [id])
  updatedBy   User?    @relation("MachineCollectorUpdatedBy", fields: [updatedById], references: [id])

  @@unique([nameFold])
  @@index([status])
  @@map("machine_collectors")
}

/// YAZMA KAPSAMI — fail-closed. ⚠️ `machineId` UNIQUE: bir makinenin TEK yazarı
/// olur. İki toplayıcı aynı tezgaha basarsa upsert'ler birbirini sessizce ezer
/// ve açık-duruş seddi ajana SONSUZ 409 olarak görünürdü; bu bir yapılandırma
/// hatasıdır → 409 MACHINE_ALREADY_CLAIMED, onay ekranında.
model MachineCollectorLink {
  collectorId String        @db.Uuid
  machineId   String        @unique @db.Uuid
  collector   MachineCollector @relation(fields: [collectorId], references: [id], onDelete: Cascade)
  machine     Machine       @relation(fields: [machineId], references: [id], onDelete: Cascade)
  createdAt   DateTime      @default(now()) @db.Timestamptz   // M:N pivot → updatedAt YOK

  @@id([collectorId, machineId])
  @@map("machine_collector_machines")
}
```

**Künye alanları FK'lidir** (`MachineCreatedBy` / `PeripheralDeviceCreatedBy` konvansiyonu, `schema.prisma:932`, `:1082`). `collectorId` taşıyan her tabloda da **gerçek `@relation`** kurulur (`onDelete: Restrict`) — toplayıcı hard delete edilmez, `revokedAt` alır, dolayısıyla FK ölçümü kilitlemez.

### 2.5 · Vardiya (FAZ 1a)

```prisma
/// MASTER DATA — vardiya kataloğu ("A vardiyası 08:00'de başlar, 8 saat").
model ShiftDefinition {
  id   String @id @default(uuid()) @db.Uuid
  /// Rapor anahtarı — ASLA düzenlenmez (`ReasonPreset.code` emsali).
  code String @unique @db.VarChar(8)      // "A" | "B" | "C" | "EK"
  name String @db.VarChar(100)

  /// Fabrika saat diliminde başlangıç, gece yarısından DAKİKA (0..1439).
  /// ⚠️ `@db.Time` / `DateTime` DEĞİL: bu MUTLAK AN değil TAKVİM KURALIDIR;
  /// `constants/time.ts` (Europe/Istanbul) mutlak ana ÇEVİRİR.
  startMinute         Int
  durationMinutes     Int
  /// PLANLI mola — POT'tan düşülür mü, `tezgah.breakOutOfPot` karar verir.
  plannedBreakMinutes Int @default(0)

  /// Hangi haftagünlerinde geçerli (0=Pazar..6=Cumartesi). BOŞ = HER GÜN —
  /// sihirli değer, gerekçesi bu yorumun KENDİSİDİR: boş dizi "kısıt yok" demektir,
  /// "hiçbiri" değil; yedi elemanlı dizi yazmak aynı bilgiyi iki biçimde tutardı.
  /// ⚠️ `ReasonPreset.legacyTexts` EMSALİ KALDIRILDI (ölçüldü, `schema.prisma:3488`):
  /// orada boş dizi "ESKİ AD YOK" demektir, "her metin" değil — ters emsal.
  activeWeekdays Int[]   @default([])
  sortOrder      Int     @default(0)
  isActive       Boolean @default(true)

  instances ShiftInstance[]
  /// ⚠️ GENERATED STORED, ham SQL'de **NOT NULL** (bkz. MachineCollector.nameFold notu).
  nameFold  String? @default(dbgenerated())

  createdAt   DateTime @default(now()) @db.Timestamptz
  updatedAt   DateTime @updatedAt @db.Timestamptz
  createdById String?  @db.Uuid
  updatedById String?  @db.Uuid
  createdBy   User?    @relation("ShiftDefinitionCreatedBy", fields: [createdById], references: [id])
  updatedBy   User?    @relation("ShiftDefinitionUpdatedBy", fields: [updatedById], references: [id])

  @@unique([nameFold])
  @@index([isActive, sortOrder])
  @@map("shift_definitions")
}

/// DURUM / TAKVİM — (tanım × fabrika günü) somut penceresi, MATERYALİZE.
/// Neden satır, neden "okumada hesapla" değil: (a) İPTAL/TATİL vardiyasının evi
/// (`isCancelled` → payda 0, satır silinmez); (b) MAKİNESİZ planlı süre —
/// kullanılabilirlik paydası makineden bağımsızdır; (c) kararlı gruplama
/// anahtarı. Ek/mesai vardiyası AYRI bir `ShiftDefinition`dır ("EK") — bu yüzden
/// `@@unique` ikilisi yeterli.
model ShiftInstance {
  id                String   @id @default(uuid()) @db.Uuid
  shiftDefinitionId String   @db.Uuid
  /// `factoryDayKeyUtcMidnight()` — çıplak DATE_TRUNC yasak. Gece yarısını
  /// geçen vardiya BAŞLADIĞI güne yazılır (`tezgah.shiftDayAttribution`).
  factoryDayKey     DateTime @db.Timestamptz

  startsAt DateTime @db.Timestamptz
  endsAt   DateTime @db.Timestamptz

  isCancelled  Boolean @default(false)
  cancelReason String? @db.VarChar(300)

  shiftDefinition ShiftDefinition @relation(fields: [shiftDefinitionId], references: [id], onDelete: Restrict)
  machineStats    MachineShiftStat[]
  stops           MachineStopEvent[]

  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  /// Job iki kez koşarsa ikinci satır DOĞMAZ → advisory kilit GEREKMEZ.
  @@unique([shiftDefinitionId, factoryDayKey])
  @@index([startsAt])
  @@map("shift_instances")
}
```

> **⚠️ TANIM DEĞİŞİRSE MATERYALİZE PENCERELER BAYAT KALIR.** `@@unique` job'ı idempotent yapar — ve tam bu yüzden ikinci koşum bayat satırı **DÜZELTMEZ**: `startMinute`/`durationMinutes`/`activeWeekdays` değiştiğinde üretilmiş gelecek pencereler eski kuralla kalır ve POT yanlış paydadan doğar.
> **Kural:** `ShiftDefinition` güncellendiğinde job, **bugünden sonraki ve karnesi MÜHÜRLENMEMİŞ** `ShiftInstance` pencerelerini yeniden hesaplar (`startsAt`/`endsAt` üstüne yazılır, **satır silinmez**); geçmiş ve mühürlü pencereler DEĞİŞMEZ — mühürlü karnenin paydası donmuştur. `isCancelled` satırları korunur. Aynı güne ikinci bir ek mesai bloğu AYRI bir `ShiftDefinition`dır ("EK2"): katalog büyür, bu bilinçlidir — tanım başına çoklu pencere modeli `@@unique([shiftDefinitionId, factoryDayKey])` anahtarını çökertirdi.

**`WorkSession` ile ilişki: FK YOK, zaman örtüşmesi var.** Üç gerekçe: (1) bir oturum iki vardiyayı aşar — FK koymak ya sahte `LOGOUT` üretmeyi ya atfı yanlış vardiyaya yazmayı gerektirirdi; (2) tezgahın çoğu zaman hiç oturumu yoktur (tablet yok) — karne `userId` taşımaz, taşısaydı tabletsiz tezgah raporsuz kalırdı; (3) `WorkSessionEndReason.NEW_LOGIN` yorumu bugün *"(vardiya değişimi)"* diyor — vardiya bugün bir **login olayıdır**, modellenmiş kavram değil. "A vardiyasında 3 no'lu tezgahta kim vardı" sorusu mevcut `@@index([machineId, startedAt])` üzerinden aralık kesişimiyle cevaplanır.

**Vardiya EKİBİ bu tasarımda YOK ve Faz 1–3 kapsamı dışıdır** (karar §10/#4): karne `userId` taşımaz. Prim ihtiyacı doğarsa `ShiftTeam` + `ShiftTeamAssignment` **eklemeli** olarak açılır; bugün açılmaz (tek fabrika, küçük ekip).

### 2.6 · Telemetri — kova (FAZ 2)

```prisma
/// ⚠️ TELEMETRİ — DEFTER DEĞİL. Sınıfı kolonları beyan eder: `updatedAt`
/// VARDIR, satır YENİDEN YAZILABİLİR ve BUDANIR (`tezgah.sampleRetentionDays`).
/// `EndpointLatencyDaily` + `latency-persist.service` ile AYNI SINIF.
/// Defter olamaz: defterin TERS YOLU olmak zorundadır, kovanınki ise "yeniden
/// yaz"dır. Ham 10 sn örneğin neden hiç yazılmadığı: §4.
model MachineInterval {
  machineId     String   @db.Uuid
  /// `tezgah.bucketMinutes`e HİZALI — vardiya sınırı bunun katı olmak ZORUNDA
  /// (400 ile doğrulanır), böylece kova iki vardiyaya hiç bölünmez.
  /// ⚠️ HİZANIN KENDİSİ de sunucuda doğrulanır: ızgara dışı `bucketStart`
  /// (10:00 ve 10:02 gibi 13 dk ÖRTÜŞEN iki kova) PK'yı ihlal ETMEZ ve
  /// mutabakatı sessizce kırardı → 400 `BUCKET_MISALIGNED` (§3.5).
  bucketStart   DateTime @db.Timestamptz
  bucketMinutes Int      @default(15)

  /// HAM SAYAÇ — kovanın başı ve sonu ("ham değer buharlaşıyor" boşluğu).
  /// ⚠️ `BigInt` DEĞİL `Decimal(18,0)`: şemada SIFIR BigInt var ve
  /// `json-replacer.ts` yalnız Decimal'i yamalıyor — `res.json` TypeError atardı.
  pickCounterStart   Decimal? @db.Decimal(18, 0)
  pickCounterEnd     Decimal? @db.Decimal(18, 0)
  runSecCounterStart Decimal? @db.Decimal(18, 0)
  runSecCounterEnd   Decimal? @db.Decimal(18, 0)

  /// TÜRETİLMİŞ FARK — `deltaQuality != OK` ise NULL. 0 ile KARIŞTIRILMAZ.
  pickDelta Int?
  runSec    Int?
  /// ⚠️ Duruş span'inin BU KOVAYA PAY EDİLMİŞ saniyesi (§5.1) — karne terimleri
  /// buradan toplanır, ham `durationSec`ten DEĞİL.
  stopSec   Int?
  /// ⚠️ Ajan bu kovanın kaç saniyesini GÖREBİLDİ. Eksik veri %100 randıman gibi
  /// GÖRÜNEMEZ — izleme sistemlerinin en sık sessiz yalanı budur.
  /// ⚠️ SATIR İÇİ DB CHECK (`machine_intervals_observed_chk`, ham SQL + envanter):
  ///   `runSec + stopSec + minorStopSec <= observedSec`  **VE**
  ///   `observedSec <= bucketMinutes * 60`
  /// — "kova içi terimler kova boyunu aşamaz" değişmezi mutabakat bekçisini
  /// beklemez, satır yazılırken zorlanır (§5.1).
  observedSec Int

  /// Eşik ALTI duruşlar burada SAYI olarak yaşar (ayrı defter satırı açılmaz).
  /// ⚠️ AD TEKTİR: `minorStop*` — karnenin (`MachineShiftStat.minorStopSec`, §2.10)
  /// ve `MachineStopLossClass.MINOR`ın adıyla BİREBİR. Eski `microStop*` adı AYNI
  /// büyüklüğe ikinci bir ad veriyordu ve terim iki tabloda karşılaştırılamıyordu;
  /// "mikro duruş" yalnız KONUŞMA DİLİDİR, kolon adı değildir.
  minorStopCount Int @default(0)
  minorStopSec   Int @default(0)
  /// Makinenin BEYAN ETTİĞİ sinyale göre kopuş adedi (insan sınıflandırması
  /// DEĞİL — §5.4 kopuş/10⁵ atkı KPI'ının payı budur).
  /// ⚠️ NULLABLE ve bu `pickDelta`nın 0/null ayrımının AYNISIDIR: `0` = kanal VAR,
  /// o kovada kopuş yok; `NULL` = kanal YOK ya da okunamadı. Tek "durdu" kontağı
  /// olan retrofitte `@default(0)` "bu tezgahta çözgü kopuşu yok" YALANINI üretirdi
  /// ve migration geri alınamaz. NOT NULL'a çevirmek AYRI bir karardır.
  warpStopCount  Int?
  weftStopCount  Int?
  otherStopCount Int?

  /// ⚠️ İkisi de **ATKI/DK**tır ve bu kovada GÖZLENEN değerlerdir — `MachineSpec`in
  /// fiziksel tavanı (`maxRevPerMin`, **devir/dk**) ile karıştırılmaz (§3.4 birim seddi).
  avgPicksPerMin Int?
  maxPicksPerMin Int?

  deltaQuality MachineDeltaQuality
  source       MachineDataSource
  collectorId  String?          @db.Uuid
  collector    MachineCollector?   @relation(fields: [collectorId], references: [id], onDelete: Restrict)
  /// SON yeniden yazımın izi — "her yeniden yazımın izi" DEĞİL (tam sayım
  /// `restateCount`ta). ⚠️ YALNIZ GERÇEKTEN DEĞİŞEN satırda dolar: yazım tek ham
  /// `ON CONFLICT … DO UPDATE … WHERE <satır EXCLUDED'dan FARKLI>` ifadesidir
  /// (§3.5). Prisma `upsert` koşulsuz yazdığı için `restatedAt` HER kovada dolar
  /// ve terim anlamsızlaşırdı.
  /// ⚠️ **YENİDEN YAZMA YALNIZ MÜHÜRSÜZ PENCEREDE.** Aynı `ON CONFLICT`
  /// ifadesinin WHERE'i `NOT EXISTS (<mühürlü pencere>)` yüklemini de taşır;
  /// satır dönmezse kalem **409 `SHIFT_SEALED`** alır (sessiz yeniden hesap YOK).
  /// Yüklem `SEALED_WINDOW_SQL` ↔ `isSealedWindow()` **boğaz-ikizidir** (§3.5).
  restatedAt   DateTime?        @db.Timestamptz
  restateCount Int              @default(0)

  machine   Machine  @relation(fields: [machineId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  /// DOĞAL ANAHTAR = İDEMPOTENCY ANAHTARI. Aynı yük → no-op; FARKLI yük →
  /// üstüne yaz + `restatedAt` (duruş span'inde kural TERSİDİR, §3.5).
  /// ⚠️ PK'ya `productionLineNo` GİRER (2026-09-12, §10/#23): çift enli makinede iki hat iki ayrı
  /// kumaş üretir ve `unitDelta` hat başınadır. Tek hatlı makinede `productionLineNo=1` sabit
  /// olduğu için satır kümesi DEĞİŞMEZ — PK'ya sabit bir kolon eklemek satır üretmez.
  /// Bugün bedava; tablo doğduktan sonra aynı iş TABLO YENİDEN YAZIMIDIR.
  @@id([machineId, productionLineNo, bucketStart])
  @@index([bucketStart])
  @@map("machine_intervals")
}
// ŞEMA-DIŞI PARTIAL INDEX (anomali kuyruğu — satırların ~%99'u OK):
//   machine_intervals_anomaly_idx (machineId, bucketStart)
//     WHERE "deltaQuality" <> 'OK'
//
// ŞEMA-DIŞI CHECK (ham SQL + test_db_invariants envanteri):
//   machine_intervals_bucket_chk:
//     CHECK ("bucketMinutes" IN (<izin verilen kova boyları>))
//   ⚠️ Küme migration'da YAZILIDIR ve `tezgah.bucketMinutes` bayrağının kabul
//      ettiği değerlerle BİREBİRDİR (§3.5): bayat bir ajan ızgara dışı kova boyu
//      yollarsa 400 `BUCKET_SIZE_MISMATCH` alır, seddin son hattı ise burasıdır.
//      Küme büyürse CHECK + bayrak doğrulaması AYNI commit'te değişir (boğaz-ikiz).
```

> **[DB-12] notu:** `@@id([machineId, bucketStart])` `machineId` önekini zaten kapsıyor — ayrı `@@index([machineId])` YAZILMAZ.

### 2.7 · Duruş (FAZ 1b)

> ⚠️ **Tablo FAZ 1b'de doğar** (§9): duruşları önce vardiya amiri ELLE girer, donanım yoktur. Makine kaynaklı alanlar (`stopKey` · `runId` · `collectorId` · `signalKind` · `rawStopCode` · `provisionalEndedAt`/`endSource`) KOLON olarak Faz 1b'de doğar ama **YAZARLARI Faz 2'dedir**; ingest sözleşmesi (§3.5) ve watchdog Faz 2'nindir.

```prisma
/// SPAN — açılır/kapanır, bu yüzden `updatedAt` TAŞIR (`RollMovement` emsali).
///
/// ⚠️ İKİ YAŞAM SINIFI TEK TABLODA — BİLİNÇLİ İSTİSNA, beş sedle korunur (§4).
/// Sınırı İNSAN KARARIDIR (sebep değil): bir insan karar vermiş duruş DEFTERDİR
/// (budanmaz, geri alma `revokedAt`, değişim `MachineStopReclass`); makineden türeyen
/// sınıflandırma ya da sınıflandırılmamış + vardiyası MÜHÜRLÜ duruş TELEMETRİDİR
/// (rakamı karnede donmuştur, kovayla birlikte düşer). Sınırın "sebep var mı"
/// olması, Faz 2'nin otomatik sınıflamasıyla birlikte her şeyi kalıcılaştırırdı.
model MachineStopEvent {
  id        String  @id @default(uuid()) @db.Uuid
  machineId String  @db.Uuid
  runId     String? @db.Uuid

  /// ⚠️ **KİMLİK SAAT DEĞİL TOKEN'DIR.** `stopKey` ajanın duruşu ilk gördüğünde
  /// ürettiği UUID'dir (`clientToken` kalıbı) ve kalemin ömrü boyunca DEĞİŞMEZ;
  /// açılış, kapanış ve yeniden gönderim AYNI anahtarla gelir. Eski tasarım
  /// kimliği `(machineId, startedAt, source)` üçlüsünden kuruyordu ve saat
  /// kaymasına karşı `date_trunc('second')` kuantizasyonuyla yamanıyordu —
  /// **o yol kalktı** (kuantizasyon bir kimlik çözümü değil, bir semptom
  /// bastırıcıydı: 1 sn kayan tekrar gönderim yine ikinci satır açabiliyordu).
  stopKey String @db.Uuid

  /// İKİ TARİH: `startedAt` ajan saatidir ve SÜRE bundan hesaplanır;
  /// `createdAt` sunucu gerçeğidir ve DEFTERİN KRONOLOJİSİDİR.
  /// ⚠️ `startedAt` **KİMLİK DEĞİL VERİDİR** (ham ajan damgası). Sunucu gerçeği
  /// `startedAtServer = startedAt + clockSkewMs` ile TÜRETİLİR ve raporlar onu
  /// okur; ham değer düzeltilmeden saklanır (iki tarih sınıfı).
  startedAt   DateTime  @db.Timestamptz
  endedAt     DateTime? @db.Timestamptz
  /// ⚠️ WATCHDOG'un yazdığı GEÇİCİ kapanışın izi — gerçek kapanış gelip
  /// `endedAt`i düzeltince bile KALIR: "geçici değer geçici olduğunu kolonda
  /// söyler". Dolu olması, bu duruşun süresinin bir dönem TAHMİN olduğunu
  /// ve persentillerden dışlandığını beyan eder (§3.5).
  provisionalEndedAt DateTime? @db.Timestamptz
  durationSec Int?
  clockSkewMs Int?      // süre şüphesinin TEK izi — KİMLİĞİN PARÇASI DEĞİL
  /// WATCHDOG = ajan sustu → süre GÜVENİLMEZ, persentillerden DIŞLANIR.
  /// ⚠️ WATCHDOG bir TAHMİNDİR, iş kararı değil: sonradan gelen GERÇEK kapanış
  /// bir ÇELİŞKİ değil bir DÜZELTMEDİR ve `endCorrectedAt` ile damgalanır
  /// (ileri damga null'lanmaz, yeni damga eklenir — §3.5).
  endSource       MachineStopEndSource?
  endCorrectedAt  DateTime? @db.Timestamptz

  /// BU DURUŞ HANGİ LEVENT YUVASINDA DOĞDU? NULL = atanmamış (bilinmiyor).
  /// ⚠️ Kırılım BURADA yaşar; `warpStopCount` ÇOĞULLAŞTIRILMAZ (§5.4 gerekçesi).
  /// İki kaynak, ikisi de var olan yüzeye biner:
  ///   • kablolu  → kanalın `PeripheralSignal.beamSlot`u          (VERİ)
  ///   • kablosuz → operatör sınıflandırma ekranında seçer        (AKSİYON ANINDA SEÇİM)
  /// İkisi de yoksa NULL kalır ve Pareto onu "atanmamış" kovasında AYRI gösterir —
  /// tahminle bir levende YAZMAZ (fail-closed).
  /// `warpBeamSlots <= 1` olan makinede alan hiç çizilmez.
  beamSlot    Int?

  /// MAKİNE GERÇEĞİ — ayrı `MachineDetectedCause` enum'u AÇILMADI (marka enum'u
  /// büyütmek fork'un ilk sinyali); ham kod ÇEVRİLMEDEN saklanır.
  signalKind  MachineSignalKind?
  rawStopCode String?         @db.VarChar(32)

  /// SINIFLANDIRMA — NULL = KARAR YOK. ⚠️ `SINIFLANDIRILMAMIS` preset'i YOKTUR
  /// (olsaydı kuyruk onunla temizlenirdi); `TESPIT_EDILEMEDI` bir KARARDIR.
  reasonCode     String?            @db.VarChar(64)   // ReasonPreset.code, FK'sız (Roll.cancelReasonCode emsali)
  /// Preset'ten KOPYALANIR ve DONAR — katalog değişse geçmiş rapor değişmez.
  lossClass      MachineStopLossClass?
  reasonNote     String?            @db.VarChar(300)
  reasonSource   MachineDataSource?
  classifiedById String?            @db.Uuid
  classifiedAt   DateTime?          @db.Timestamptz

  /// SINIFLANDIRMA BORCU — kapanışta tek helper yazar; BOĞAZ-İKİZİ
  /// `CLASSIFICATION_QUEUE_WHERE`, AST bekçisiyle birlikte değişir.
  requiresReason Boolean @default(false)

  /// BAĞLAM — doğuşta DONDURULUR (raporun group-by eksenleri).
  shiftInstanceId String?  @db.Uuid
  factoryDay      DateTime @db.Date          // @db.Date muafı → test_timestamptz_contract envanteri
  pickCounter     Decimal? @db.Decimal(18, 0)   // kova budansa bile üretim çıpası

  source      MachineDataSource
  collectorId String?        @db.Uuid

  /// GERİ ALMA — hayalet duruş SİLİNMEZ, damgalanır (`RollOperation.revokedAt`).
  revokedAt    DateTime? @db.Timestamptz
  revokedById  String?   @db.Uuid
  revokeReason String?   @db.VarChar(300)

  machine       Machine        @relation(fields: [machineId], references: [id], onDelete: Restrict)
  run           MachineRun?       @relation(fields: [runId], references: [id])
  shiftInstance ShiftInstance? @relation(fields: [shiftInstanceId], references: [id])
  classifiedBy  User?          @relation("MachineStopClassifiedBy", fields: [classifiedById], references: [id])
  collector     MachineCollector? @relation(fields: [collectorId], references: [id], onDelete: Restrict)
  reclasses     MachineStopReclass[]

  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  @@index([machineId, startedAt])
  @@index([factoryDay, machineId])
  @@index([reasonCode, startedAt])
  @@index([shiftInstanceId])
  @@index([runId])
  @@map("machine_stop_events")
}
// ŞEMA-DIŞI PARTIAL INDEXLER (ham SQL + test_db_invariants envanteri):
//   machine_stops_one_open_per_machine_uq (machineId)
//     WHERE "endedAt" IS NULL AND "revokedAt" IS NULL          ← tek açık duruş seddi
//   machine_stops_key_uq (machineId, stopKey)
//     WHERE "revokedAt" IS NULL                                ← replay seddi
//     ⚠️ ANAHTAR AJAN ÜRETİMİ TOKEN'DIR, SAAT DEĞİL. Eski
//        `(machineId, startedAt, source)` + saniye kuantizasyonu KALKTI:
//        kuantizasyon 1 sn kayan tekrar gönderimi ancak kısmen kapatıyordu ve
//        kopya KAPALI geldiğinde `one_open_per_machine_uq`e de görünmeden
//        breakdown'da iki kez sayılabiliyordu. `stopKey` ile aynı duruş, saat
//        ne kadar kayarsa kaysın TEK satırdır.
//     ⚠️ PARTIAL yüklemi (`revokedAt IS NULL`) şarttır — geri alınmış duruş
//        sedde yer işgal etmez; yeniden gönderim 409 `STOP_REVOKED` alır (§3.5b).
//   machine_stops_duty_idx (startedAt)
//     WHERE "requiresReason" AND "reasonCode" IS NULL AND "revokedAt" IS NULL
//
// ŞEMA-DIŞI TRIGGER (§4 — budamanın DB seddi):
//   machine_stop_events_block_classified_delete  BEFORE DELETE
//     RAISE EXCEPTION WHEN "classifiedById" IS NOT NULL
//                       OR "reasonSource" IN ('OPERATOR','SUPERVISOR')
//     ⚠️ Yüklem İNSAN KARARINA daraltıldı (§4): makineden türeyen sınıflandırma
//        (`reasonSource IN ('MACHINE','INFERRED') AND classifiedById IS NULL`)
//        TELEMETRİDİR ve budanır — aksi hâlde Faz 2'nin otomatik sınıflaması
//        duruşların ÇOĞUNU kalıcılaştırır (dokumada duruşların çoğu kopuştur).

/// DEFTER (append-only, `updatedAt` YOK) — duruş sebebinin DEĞİŞİM geçmişi.
/// ⚠️ İlk sınıflandırma (NULL → değer) boş bırakılmış kararı doldurur, yerinde
/// yapılır; DEĞİŞTİRME (değer → değer) kayıtlı gerçeği değiştirir ve defter
/// doktrini bunu yerinde yapmayı yasaklar. İz audit'e bırakılamaz (6 ayda
/// arşivlenir, "iş kaynağı OLARAK OKUNAMAZ"). `Shipment.status ↔ ShipmentEvent`
/// ikilisinin aynısı; yazar tek servis kapısıdır, ikinci yazar doğmaz.
model MachineStopReclass {
  id            String   @id @default(uuid()) @db.Uuid
  stopEventId   String   @db.Uuid
  fromReasonCode String? @db.VarChar(64)
  toReasonCode   String? @db.VarChar(64)
  fromLossClass  MachineStopLossClass?
  toLossClass    MachineStopLossClass?
  reason         String? @db.VarChar(300)
  actedById      String? @db.Uuid

  stopEvent MachineStopEvent @relation(fields: [stopEventId], references: [id], onDelete: Restrict)
  actedBy   User?         @relation("MachineStopReclassBy", fields: [actedById], references: [id])
  createdAt DateTime      @default(now()) @db.Timestamptz

  @@index([stopEventId, createdAt])
  @@map("machine_stop_reclasses")
}
```

**İlk sınıflandırma da atomik claim'dir:** `updateMany WHERE { id, reasonCode: null, revokedAt: null }` + `count === 0 → 409` (taze okumayla tanı). `findUnique → if → update` YASAK.

> **⚠️ GERİ ALMA DA MÜHÜR SINIRINA TABİDİR.** Mühür sınırı sentezde yalnız iki yolda kuruluydu (geç gelen ingest kalemi · geriye dönük SINIFLANDIRMA); duruşun `revokedAt` ile geri alınması kapısızdı — defter *"geri alındı"* derken karne **hayaleti saymaya devam ederdi.**
> **Kural:** `sealState = SEALED` vardiyaya düşen bir duruşun `revokedAt`i doğrudan yazılamaz → **409 `SHIFT_SEALED`**. Yol tektir: `loom:shift-unseal` → revoke (defter satırı) → yeniden hesap → **yeni `sealGeneration`** ile yeniden mühür (`MachineShiftStatSeal` `RESEAL`). *Revoke defteri değiştirir, karneyi TEK BAŞINA değiştiremez.* Bekçi: `test_machine_shift_seal`e iki ayak — "mühürlü vardiyada revoke → 409" ve "unseal sonrası revoke → breakdown YENİ kuşakta düşer".

**Sistem sebep kataloğu** (`constants/reason-presets.ts` → `REASON_PRESET_CATALOG.MACHINE_STOP`, `isSystem: true`):

| code | stopLossClass |
|---|---|
| `COZGU_KOPUSU` · `ATKI_KOPUSU` · `KENAR_KOPUSU` · `IPLIK_BITTI` | **`UNPLANNED`** ⚠️ (aşağıdaki kutu) |
| `MEKANIK_ARIZA` · `ELEKTRIK_ARIZA` · `ELEKTRIK_KESINTISI` · `HAVA_BASINCI` · `JAKAR_ARIZA` · `OPERATOR_YOK` · `KUMAS_TAMIR` · `TESPIT_EDILEMEDI` | `UNPLANNED` |
| `LEVENT_BAGLAMA` · `TAHAR` · `TARAK_DEGISIMI` · `DESEN_DEGISIMI` · `TOP_ALMA` | `SETUP` |
| `PLANLI_BAKIM` · `TEMIZLIK` · `MOLA` · `VARDIYA_DEVRI` | `PLANNED` |
| `SIPARIS_YOK` · `TEZGAH_KAPALI` | `NON_SCHEDULED` |

> **⚠️ Denetim düzeltmesi (ölçek merceği B2 — KRİTİK).** Sentez dört kopuş sebebini **süreden bağımsız** `MINOR` sayıyordu. `MINOR` ise APT'den DÜŞÜLMEZ (§5.2) — yani **45 dakikalık bir çözgü kopuşu kullanılabilirliği hiç düşürmeyecek, kayıp yalnız performansta erimiş görünecekti.** Belgenin kendi kapanışı bunu fark etmişti (*"45 dakikalık bir çözgü kopuşunun gerçek hikâyesi artık `OPERATOR_YOK`tur"*) ama sınıf atamasını düzeltmemişti. Karar: **`MINOR` bir SÜRE sınıfıdır, sebep sınıfı değil.** Yalnız `tezgah.stopEventMinSeconds` altındaki duruşlardan türer, tek helper'da (`loom-efficiency.helper`) yaşar, `ReasonPreset.stopLossClass`a yazılamaz (CHECK, §2.1) ve zaten eşik altı duruş **defter satırı bile olmaz** — kovada sayı olarak yaşar (§2.6). Bekçi sondası: 45 dk'lık `COZGU_KOPUSU` → `A` düşmeli.

> ⭐ `LEVENT_BAGLAMA`/`TAHAR`/`TARAK_DEGISIMI` ile `DESEN_DEGISIMI`nin **ayrı kodlar** olması saha kaynağının ana bulgusunun karşılığıdır: *"Bir levent → çok desen. Atkı değişimi ucuz, levent değişimi pahalı. Kurulum defteri ikisini AYIRMAK zorunda."* Ayrı bir `MachineSetupEvent` tablosu AÇILMIYOR — ayrım sebep kodunda + `MachineRun` span sınırlarında yaşıyor; kimlik ayağı devere tarafındaki `WarpBeamEvent.MOUNTED`tadır (§7.3).

> **⚠️ `LEVENT_BAGLAMA` SINIRI — iki kaynak riski adıyla kapatılır.** Duruş defterindeki `LEVENT_BAGLAMA` süresi **YALNIZ randıman paydasını** (SETUP kovası) besler. Kurulum **SÜRESİ ve YÖNTEMİ** raporu (düğüm · tahar · takım kıyası) **yalnız `WarpBeamEvent.MOUNTED`** okur (`setupStartedAt` → `createdAt`, `mountMethod`; levent belgesi). **Hiçbiri diğerinden KOPYALANMAZ**; mutabakat bekçisi ikisini karşılaştırır ve `|Δ|` eşiği aşarsa **uyarı satırı** yazar (rakamı düzeltmez — iki defterin iki farklı soruya cevap vermesi normaldir).

### 2.8 · Koşum (FAZ 2)

```prisma
/// SPAN / DEFTER — bir desen/parti tezgahta ne zamandan ne zamana koştu.
/// Randımanın PAYDASI buradan doğar: teorik devir TEZGAHIN değil İŞİN
/// özelliğidir. Atıf örneklem satırlarına DAMGALANMAZ — aralık defteri ucuz,
/// doğru ve kova budandıktan sonra da yaşar.
model MachineRun {
  id        String    @id @default(uuid()) @db.Uuid
  machineId String    @db.Uuid
  startedAt DateTime  @db.Timestamptz
  endedAt   DateTime? @db.Timestamptz

  /// Bağ OPSİYONEL: iş emirsiz koşum meşrudur (numune, deneme).
  workOrderStepId String? @db.Uuid
  itemId          String? @db.Uuid
  colorId         String? @db.Uuid
  /// ⚠️ LEVENT BAĞI **KOLON DEĞİLDİR** — `warpBeamId` (ve `mountId`/`mountedEventId`)
  /// SİLİNDİ. "Koşum sırasında hangi levent(ler) bağlıydı" sorusu
  /// `beamsMountedDuring(machineId, from, to)` ile türetilir: aktif
  /// MOUNTED/DISMOUNTED aralıklarının `[startedAt, endedAt)` ile KESİŞİMİ.
  /// Gerekçe: bağ levent defterinde ZATEN yazılıdır (FK ikinci kaynak olur ve
  /// MOUNT_CANCEL'de sarkar — "tek kaynak satır" sınıfı); çift leventli tezgahta
  /// tek FK yetmez; WorkSession↔vardiya kararıyla aynı ilke (§7.3).

  /// HEDEF DEVİR (atkı/dk) — randımanın paydası. DEĞİŞİRSE KOŞUM KAPANIR,
  /// yenisi açılır; tek satırda iki devir tutmak paydayı belirsizleştirir.
  /// NULL → `MachineSpec.nominalPicksPerMin` yedeği; o da NULL → PERFORMANS
  /// HESAPLANMAZ (uydurulmaz, rapor "P: ölçülemedi" der).
  targetPicksPerMin Int?
  /// DONMUŞ ATKI SIKLIĞI — **TEZGAH ÜSTÜ (HAM) atkı/cm**, mamul DEĞİL.
  /// `metre = atkı ÷ (hamAtkıPerCm × 100)` ve bu ÇÖZGÜ/HAM metredir; mamul
  /// (bitim sonrası) metre `× (1 − takeUp)` ile AYRI bir büyüklüktür, bu belgede
  /// HESAPLANMAZ (take-up kumaş teknik kartının işi — levent belgesi §4.8).
  /// ⚠️ İki anlam aynı kolonda yaşayamaz; mamul metre gerekirse ayrı kolon +
  /// ayrı helper açılır. Faz 1-2'de ELLE girilir (kalıcı evi §10/#9) ve DONAR;
  /// NULL meşrudur → metre üretilmez, randıman yine hesaplanır.
  /// ⚠️ TÜRETİLEN METRE ASLA STOK YAZMAZ — tek miktar gerçeği `Roll` ölçümüdür.
  unitsPerCm Decimal? @db.Decimal(8, 3)

  // ── KAPANIŞTA DONAN ÜRETİM TERİMLERİ (tek yazar: koşumu kapatan) ──────────
  /// ⚠️ Koşum "BUDANMAZ" ilan edilmişti ama içinde ÜRETİM TERİMİ YOKTU: metre
  /// `MachineInterval.pickDelta`dan doğuyor, karne taneciği ise vardiya×makine
  /// (`runId` taşımaz) — retention penceresinden sonra "bu iş emri adımında kaç
  /// atkı/metre üretildi" CEVAPSIZ kalır, `MachineRun` boş kabuk olarak yaşardı.
  /// `workOrderStepId` taşıyan kayıt tanımı gereği İŞ KARARI verisidir.
  /// KURAL: koşum kapanırken üretim terimleri satıra DONAR; kova budandıktan
  /// sonra KOŞUM EKSENİ bu terimlerden cevaplanır, kovadan değil.
  picksAtClose      Int?
  producedM         Decimal? @db.Decimal(12, 3)
  observedSecAtClose Int?
  /// ⚠️ DURUŞ TERİMLERİ DE DONAR (budama bekçisi sözleşmesi, §4): sebepsiz duruş
  /// budandığında KOŞUM DÜZEYİ duruş sayısı/süresi de ölürdü — "bu iş emri
  /// adımında kaç saat durduk" retention penceresinden sonra cevapsız kalırdı.
  /// Karne ekseni vardiya×makine olduğu için o soruyu karne cevaplayamaz.
  stopSecAtClose    Int?
  stopCountAtClose  Int?
  /// TEK YAZAR `closeMachineRunTx`, atomik claim `WHERE closedTermsAt IS NULL`.
  closedTermsAt     DateTime? @db.Timestamptz

  /// GERİ ALMA — yanlış açılmış koşum randımanın PAYDASINI taşır; tersi olmayan
  /// ileri olay geri alınamayan bir iş demektir. Duruşların `runId`si DEĞİŞMEZ;
  /// rapor aktif yüklemi tek helper'dan alır.
  revokedAt    DateTime? @db.Timestamptz
  revokedById  String?   @db.Uuid
  revokeReason String?   @db.VarChar(300)

  /// ⚠️ ÜÇ OPSİYONEL BAĞ DA `onDelete: Restrict` TAŞIR. Prisma'nın varsayılanı
  /// opsiyonel ilişkide `SetNull`dır ve o, gerçekleşmiş bir koşumun BAĞLAMINI
  /// sessizce siler — yani ileri kaydı DEĞİŞTİRMEK olur (doktrin yasağı).
  machine       Machine        @relation(fields: [machineId], references: [id], onDelete: Restrict)
  workOrderStep WorkOrderStep? @relation(fields: [workOrderStepId], references: [id], onDelete: Restrict)
  item          Item?          @relation(fields: [itemId], references: [id], onDelete: Restrict)
  color         Color?         @relation(fields: [colorId], references: [id], onDelete: Restrict)
  stops         MachineStopEvent[]

  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  @@index([machineId, startedAt])
  @@index([workOrderStepId])
  @@map("machine_runs")
}
// ŞEMA-DIŞI PARTIAL UNIQUE (⚠️ revokedAt yüklemi ŞART — geri alınmış koşum
// sedde YER İŞGAL ETMEZ, yoksa yeni koşum açılamaz):
//   machine_runs_one_open_per_prod_line_uq (machineId, "productionLineNo")
//     WHERE "endedAt" IS NULL AND "revokedAt" IS NULL
//     ⚠️ ADI VE KAPSAMI DEĞİŞTİ (2026-09-12, §10/#23): eski hâli (machineId) yalnızdı ve
//     "bir makine aynı anda TEK iş koşar" diyordu — çift enli tezgahta yan yana iki ayrı
//     kumaşı YAPISAL OLARAK İMKÂNSIZ kılıyordu. Tek hatlı makinede productionLineNo=1 sabit olduğu
//     için sed BUGÜNKÜ İLE AYNI KÜMEYİ reddeder: davranış birebir korunur.
//   machine_runs_natural_uq (machineId, "productionLineNo", startedAt)
//     WHERE "revokedAt" IS NULL                    ← §2.11'in DOĞAL ANAHTARI
//     ⚠️ Beyan edilen doğal anahtarın sedde karşılığı olmazsa aynı makinede aynı
//        ana İKİ koşum açılır ve karnenin donmuş paydasının hangisinden geldiği
//        belirsizleşir. PARTIAL yüklemi burada da ŞART: geri alınmış koşum yer
//        işgal etmez, aynı an meşru biçimde yeniden açılabilir.
```

> **⚠️ `WorkOrderStep` GERÇEKTEN hard delete ediliyor ve `MachineRun` o silmenin guard'ında yok.** Ölçüldü: `workorder.service.ts:5697` `await tx.workOrderStep.delete({ where: { id: old.id } })`, guard ise aynı bloktaki `old._count` toplamından kuruluyor (`:5691-5696`) — `machineRuns` o sayıma girmiyor. Restrict FK'sı olmasa bağ sessizce kopar, Restrict FK'sı olunca **P2003 → generic 400** düşer.
> **Faz 2 iş kalemi (aynı commit):** `_count` kümesine `machineRuns` eklenir ve 409 mesajına *"bu adıma bağlı tezgah koşumu var"* satırı girer · `MACHINE_DELETE_GUARDS` bu fazda **İKİ sayaç** daha alır — `machineRunCount` + `machineCounterEventCount` (fazlama **TEK KAYNAK §2.1'dedir:** Faz 1a → `machineShiftStatCount` · Faz 1b → `machineStopCount` · Faz 2 → bu ikisi), böylece liste Faz 2 sonunda **dört** tezgah Restrict FK'sını (`MachineShiftStat` · `MachineStopEvent` · `MachineRun` · `MachineCounterEvent`) adıyla sayar · panel önizlemesi bunları listeler · `test_hard_delete_guard_coverage`in `EXPECTED` envanterine Faz 2'nin Cascade çocukları yazılır (`WATCHED`a `"Machine"` **Faz 1a'da** eklendi, §2.3).

### 2.9 · Durum ve sayaç kararı (FAZ 2)

```prisma
/// DURUM — makine başına TEK satır, yerinde güncellenir. DEFTER DEĞİLDİR:
/// geçmiş tutmaz, geri alınmaz, raporlanmaz. Canlı pano tek sorguyla okur.
/// ⚠️ `Machine`in kolonu DEĞİL: `Machine` her CUD'da audit alır, saniyelik
/// status upsert'i audit'i çöpe çevirirdi.
/// ⚠️ PK `machineId @id` (`MachineSpec`in kalıbından BİLEREK farklı): bu tablo bir
/// VARLIK değil, makinenin ANLIK AYNASIDIR.
/// ⚠️ `@@index([state])` YOK — 20 satırlık tabloda ölü ağaç. Migration'da
/// `fillfactor=70` + tablo-özel autovacuum eşiği verilir.
model MachineLiveState {
  machineId          String       @id @db.Uuid
  state              MachineRunState @default(UNKNOWN)
  stateSince         DateTime?    @db.Timestamptz
  /// ANLIK devir — YALNIZ burada yaşar, TARİHÇEYE GİRMEZ.
  instantPicksPerMin Int?
  lastPickCounter    Decimal?     @db.Decimal(18, 0)
  lastSeenAt         DateTime?    @db.Timestamptz
  openStopId         String?      @db.Uuid
  currentRunId       String?      @db.Uuid
  collectorId        String?      @db.Uuid
  source             MachineDataSource

  machine   Machine  @relation(fields: [machineId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  @@map("machine_live_states")
}

/// DEFTER (append-only, `updatedAt` YOK) — sayaç taşma/sıfırlama/anomali
/// KARARI. Nadir ve kalıcı. Emsal `RollVariance`: sapmanın kendisi ayrı
/// satırdır, JSON'a gömülmez.
model MachineCounterEvent {
  id         String   @id @default(uuid()) @db.Uuid
  machineId  String   @db.Uuid
  signalKind MachineSignalKind
  occurredAt DateTime @db.Timestamptz
  quality    MachineDeltaQuality
  prevValue  Decimal? @db.Decimal(18, 0)
  nextValue  Decimal? @db.Decimal(18, 0)
  /// Kabul edilen fark. NULL = fark ÜRETİLMEDİ (uydurulmadı).
  acceptedDelta Int?
  /// ⚠️ KARARIN SAHİBİ İKİ KOLONLA yazılır: "SYSTEM" bir uuid DEĞİLDİR, kolona
  /// yazılamaz ve NULL hem "sistem" hem "bilinmiyor" demeye gelirdi.
  /// MACHINE = otomatik kural; SUPERVISOR/OPERATOR = insan kararı.
  decisionSource MachineDataSource
  /// YALNIZ insan kararında dolar.
  decidedById    String? @db.Uuid
  /// KOVA/PENCERE BAĞI — kararın hangi kovaya ait olduğu, kova BUDANSA BİLE
  /// yazılı kalır; mutabakat (§2.11) bunu okur.
  bucketStart    DateTime? @db.Timestamptz
  note           String?   @db.VarChar(300)

  /// TERS KAYIT = ÜSTÜNE YAZAN YENİ KARAR SATIRI. `acceptedDelta` karneye giren
  /// üretim rakamını belirleyen bir KARARDIR; `RESET` sanılan bir sarma kararı
  /// düzeltilebilmeli, ama satır DEĞİŞTİRİLMEMELİ. Okuma helper'ı yalnız
  /// süpersede EDİLMEMİŞ satırı alır.
  supersededByEventId String? @db.Uuid
  supersededBy MachineCounterEvent? @relation("MachineCounterSupersede", fields: [supersededByEventId], references: [id])
  supersedes   MachineCounterEvent[] @relation("MachineCounterSupersede")

  machine   Machine  @relation(fields: [machineId], references: [id], onDelete: Restrict)
  createdAt DateTime @default(now()) @db.Timestamptz

  @@index([machineId, occurredAt])
  @@index([quality, occurredAt])
  @@map("machine_counter_events")
}
// ŞEMA-DIŞI PARTIAL UNIQUE (doğal anahtar = idempotency anahtarı):
//   machine_counter_events_natural_uq (machineId, signalKind, occurredAt)
//     WHERE "supersededByEventId" IS NULL
//   ⚠️ Bu sed olmadan partinin yeniden gönderimi MÜKERRER anomali satırı doğurur;
//      satırların varlığı §2.10'un `anomalyAck` mühür ön koşulunu beslediği için
//      mükerrer satır MÜHÜRÜ DE KİLİTLER. Aynı yük → no-op; farklı yük →
//      409 `COUNTER_EVENT_CONFLICT` (§3.5 tablosunda kendi satırı var).
```

### 2.10 · Vardiya karnesi — mühürlü özet + mühür defteri (FAZ 1a)

```prisma
/// ÖZET / MATERYALİZE KARNE (DURUM) — vardiya × makine kapanış karnesi.
/// İŞ VERİSİDİR: budanmaz. Mühürlü satır yeniden HESAPLANMAZ; gerekçe
/// `services/helpers/period-guard.helper.ts:7-16` ("kapanmış dönem RESMİ bir
/// rakamdır… SESSİZ YENİDEN HESAP en kötüsü"), emsal `CashPeriodClose`.
/// ⚠️ `updatedAt` VAR ve bu sınıf beyanıdır: güncel gerçeği bu satır, GEÇMİŞİ
/// `MachineShiftStatSeal` defteri taşır (tek tabloda defter+durum olmaz).
/// ⚠️ BU TABLO, KOVANIN VE SEBEPSİZ DURUŞUN BUDANABİLMESİNİN TEK SEBEBİDİR.
model MachineShiftStat {
  id              String   @id @default(uuid()) @db.Uuid
  machineId       String   @db.Uuid
  shiftInstanceId String   @db.Uuid
  /// Rapor ekseni — `ShiftInstance.factoryDayKey`ten KOPYALANIR ve DONAR.
  /// ⚠️ Bu kolonun TEK YAZARI MÜHÜRLEYİCİDİR; ikinci bir yazma yolu açmak
  /// (servis içinden doğrudan yazım dahil) "tek kaynak satır" sağlamlık sınıfını
  /// kırar ve bekçi bunu AST ile ölçer. (`Sack.weightKg` EMSAL DEĞİL UYARIDIR:
  /// orada çuval oluşturma yolu bugün defter satırı yazmadan kg yazabiliyor —
  /// `shipping.service.ts:461-469`, kullanılmayan ama AÇIK yol.)
  /// @db.Date muafı → test_timestamptz_contract envanteri.
  factoryDay      DateTime @db.Date

  // ── TERİMLER (saniye) — ORAN DEĞİL. Rapor bunları TOPLAR. ──
  calendarSec      Int @default(0)   // ShiftInstance penceresi
  /// GÖZLENMEMİŞ süre — ajan sustu. Ne çalışma ne duruştur; POT'a GİRMEZ ve
  /// raporda AYRI basılır. "Bilinmeyeni çalışmıyor say" fail-open olurdu.
  unobservedSec    Int @default(0)
  nonScheduledSec  Int @default(0)
  plannedBreakSec  Int @default(0)
  potSec           Int @default(0)   // Planlanan Üretim Süresi
  aptSec           Int @default(0)   // fiili çalışma
  setupSec         Int @default(0)
  plannedDownSec   Int @default(0)
  unplannedDownSec Int @default(0)
  minorStopSec     Int @default(0)   // APT içinde kalır, P'de erir
  minorStopCount   Int @default(0)

  stopCount     Int @default(0)
  /// ⚠️ NULLABLE (§2.6 ile aynı gerekçe): `0` = kanal var, kopuş yok; `NULL` =
  /// ÖLÇÜLMEDİ. Faz 1a'da (hiç makine sinyali yok) bu sayaçlar **NULL** yazılır,
  /// 0 DEĞİL — `@default(0)` canlı tabloya "kopuş yok" yalanını kalıcı yazardı.
  warpStopCount Int?
  weftStopCount Int?
  /// Sınıflandırılmamış duruş süresi — "bu sayı tam mı"nın tek cevabı.
  /// >0 ise rapor `ApiResponse.warnings` şeridi çizer.
  unclassifiedSec Int @default(0)

  picksActual Int @default(0)
  /// ⚠️ COLLECTOR_GAP'in atkısı — ajan sustuğu pencerede sayaç ilerledi ve ilk
  /// kovada SIÇRAMA olarak geldi. **METRE bunu İÇERİR** (kumaş gerçekten
  /// dokundu), **randımanın PAYINDAN DÜŞÜLÜR ve PAYDASINA HİÇ GİRMEZ**
  /// (`picksActual − gapPicks`; o sürenin karşılığı `unobservedSec`tir ve
  /// POT'tan zaten düşüldüğü için paydada hiç doğmaz — sıçramayı P'nin payına
  /// koymak gözlenmemiş süreyi ödüllendirirdi, §5.1/§5.2).
  gapPicks Int @default(0)
  /// ⚠️ WATCHDOG'la GEÇİCİ kapanmış duruşların bu vardiyaya düşen saniyesi.
  /// Terim AYRI basılır: karne "şu kadarı tahmindir" demeden mühürlenemez.
  watchdogSec Int @default(0)

  // ── DONMUŞ PAYDALAR — sonradan değişse bu satırın randımanı DEĞİŞMEZ ──
  /// ⚠️ ASIL PAYDALAR BUNLARDIR (atkı cinsinden kapasite). Bir vardiyada İKİ KOŞUM
  /// normaldir (§2.8 "hedef değişirse koşum kapanır" + `DESEN_DEGISIMI` = SETUP) ve
  /// tek bir `targetPicksPerMin` donduran karne hangi paydayı seçerse seçsin P'yi
  /// yanlış üretirdi; iki hedefi ORTALAMAK ise §5.3/4'ün kendi yasağıdır.
  /// ⚠️ İKİ TERİM ŞART: tek terim P'yi E'ye ÇÖKERTİR (aynı paydayla bölünen iki
  /// oran aynı sayıdır). `…Apt` P'nin paydası, `…Pot` E'nin paydasıdır (§5.2).
  targetPickCapacityApt Int @default(0)   // Σ(target_i × o koşumun APT dakikası)
  targetPickCapacityPot Int @default(0)   // Σ(target_i × o koşumun POT dakikası)
  /// Yalnız TEK koşumlu vardiyada raporda gösterilecek ETİKET; birden çok hedef
  /// varsa NULL (payda yine `targetPickCapacity`tir).
  targetPicksPerMin Int?
  /// Mikro duruş eşiği değişimi geçmişle kıyaslanamaz seri üretir; eşik karneye
  /// DONAR ve raporun üstüne BASILIR.
  stopThresholdSec  Int
  /// Tek koşumlu vardiyada donar; BİRDEN ÇOK koşum varsa **NULL** yazılır ve
  /// metre koşum bazında türetilip toplanır (§5.6).
  unitsPerCmAtClose Decimal? @db.Decimal(8, 3)
  producedM         Decimal? @db.Decimal(12, 3)   // ölçek kataloğu: metraj (12,3)

  // ── MÜHÜR ANINDA `loom-efficiency.helper` YAZAR, başka hiçbir yol yazmaz ──
  availabilityPct  Decimal? @db.Decimal(5, 2)
  performancePct   Decimal? @db.Decimal(5, 2)
  effectivenessPct Decimal? @db.Decimal(5, 2)   // RANDIMAN = A × P
  formulaVersion   Int?
  /// ⚠️ KALİTE (Q) ve OEE burada YOK: kalite kararı Tambur'da, vardiyadan
  /// GÜNLER sonra verilir. Mühür anında Q hesaplanamaz.

  source     MachineDataSource
  /// ⚠️ MÜHÜRDE KOPYALANIR ve DONAR (`MachineSpec.monitoringState`ten). Gölge
  /// karne ASLA LIVE'a terfi etmez: tezgah sonradan LIVE'a geçse bile o
  /// vardiyanın rakamı gölge koşullarda üretilmiştir ve DEFTER raporları onu
  /// süzmeye devam eder. Canlı kolondan süzmek, geçmişi geriye dönük
  /// "yayınlanmış" yapardı (§5.3/8).
  monitoringState MachineMonitoringState
  /// Anomali (RESET/GAP/ANOMALY) içeren vardiya ONAYSIZ mühürlenemez → **409**.
  /// ⚠️ KOLON Faz 1a'da doğar, KAPI Faz 2'de yürürlüğe girer: anomalinin tek
  /// kaynağı `MachineCounterEvent` ve `MachineInterval.deltaQuality`tir, ikisi de Faz
  /// 2'dedir. Faz 1a'da elle girilen karnede anomali KAYNAĞI YOKTUR; alan
  /// `false` kalır ve mührü bloke etmez (§9 — "kaynağı olmayan kapı" sınıfı).
  anomalyAck Boolean @default(false)

  /// GÜNCEL MÜHÜR DURUMU. ⚠️ `sealedAt` ASLA null'lanmaz — anlamı "EN SON ne
  /// zaman mühürlendi"dir; ileri damgayı null'lamak ters kayıt DEĞİLDİR ve
  /// yasaktır (`dispatchedAt`/`invoicedAt` sınıfı). Mühür/aç/yeniden-mühür
  /// tekrarlanabilir bir çevrimdir ve TEK KOLONA SIĞMAZ: durum `sealState`,
  /// çevrim sayacı `sealGeneration`, geçmiş `MachineShiftStatSeal`dedir.
  sealState      MachineSealState @default(OPEN)
  sealGeneration Int           @default(0)
  /// ⚠️ Ad tuzağı: KALDIRILAN `Sack` mühürleme kolonlarıyla ilgisi YOK.
  sealedAt       DateTime?     @db.Timestamptz
  sealedById     String?       @db.Uuid

  machine       Machine       @relation(fields: [machineId], references: [id], onDelete: Restrict)
  shiftInstance ShiftInstance @relation(fields: [shiftInstanceId], references: [id], onDelete: Restrict)
  sealedBy      User?         @relation("MachineShiftStatSealedBy", fields: [sealedById], references: [id])   // kaldırılan Sack alanı DEĞİL
  breakdown     MachineShiftStopBreakdown[]
  seals         MachineShiftStatSeal[]

  createdAt DateTime @default(now()) @db.Timestamptz
  updatedAt DateTime @updatedAt @db.Timestamptz

  /// ⚠️ `productionLineNo` UNIQUE'E GİRER (§10/#23) — ve bu MÜHÜR TANECİĞİNİ BÖLER: bir
  /// vardiya×makine artık N karne satırıdır, mühür ise satır başınadır ⇒ N bağımsız mühür.
  /// Bu yüzden mühür VARDİYA×MAKİNE düzeyinde ATOMİKTİR (§4 "kısmi mühür yok").
  @@unique([machineId, shiftInstanceId, productionLineNo])
  @@index([factoryDay, machineId])
  @@index([sealedAt])   // kaldırılan Sack.sealedAt ile ilgisi YOK
  @@map("machine_shift_stats")
}

/// DEFTER (append-only) — vardiya karnesinin SEBEP KIRILIMI; Pareto burada
/// yaşar. ⚠️ Bu tablo olmadan 1 NUMARALI GEREKSİNİM retention penceresinden
/// sonra KAYBOLUR. ~175.000 satır/yıl (~45 MB), kalıcı.
/// ⚠️ MÜHÜR KUŞAĞI: yeniden hesapta satırlar GÜNCELLENMEZ ve SİLİNMEZ (ikisi de
/// defter yasağı) — YENİ KUŞAK yazılır, eskiler durur; okuma tek helper'dan.
model MachineShiftStopBreakdown {
  id             String  @id @default(uuid()) @db.Uuid
  statId         String  @db.Uuid
  sealGeneration Int
  /// NULL = sınıflandırılmamış kova (rapor bunu UNPLANNED sayar).
  reasonCode String? @db.VarChar(64)
  lossClass  MachineStopLossClass?
  stopCount  Int
  stopSec    Int

  /// ⚠️ Cascade DEĞİL Restrict: defter satırı sessizce yok olamaz.
  stat      MachineShiftStat @relation(fields: [statId], references: [id], onDelete: Restrict)
  createdAt DateTime      @default(now()) @db.Timestamptz

  /// ⚠️ Prisma `@@unique`i yalnız DEFTERİ TUTAR — gerçek sed ham SQL'dedir
  /// (aşağıdaki kutu): `reasonCode` NULL kalabildiği ve PG 16 varsayılanı
  /// NULLS DISTINCT olduğu için, korunması EN GEREKEN satır (sınıflandırılmamış
  /// kova) korumasız kalırdı.
  @@unique([statId, sealGeneration, reasonCode])
  @@index([reasonCode])
  @@map("machine_shift_stop_breakdowns")
}
// ŞEMA-DIŞI UNIQUE (ham SQL + test_db_invariants `EXPRESSION_UNIQUES` envanteri):
//   machine_shift_stop_breakdowns_uq:
//     UNIQUE NULLS NOT DISTINCT ("statId","sealGeneration","reasonCode")
//   (Prisma NULLS NOT DISTINCT üretmez. Alternatif: COALESCE("reasonCode",'')
//    ifade index'i.) Saha PG 16.9 — `docs/ops/KURULUM.md`.
//   NEGATİF SONDA: aynı kuşakta iki NULL `reasonCode` satırı → kırmızı.

/// DEFTER (append-only) — mühür / mühür açma izi ve DÜZELTME TERS KAYDI.
/// Kapanmış vardiyaya geç gelen veri karneyi SESSİZCE değiştiremez: mühür
/// `loom:shift-unseal` ile AÇILIR, yeniden hesaplanır, yeniden mühürlenir ve
/// her adım burada satır bırakır.
model MachineShiftStatSeal {
  id             String   @id @default(uuid()) @db.Uuid
  statId         String   @db.Uuid
  /// ⚠️ ENUM — serbest metin dördüncü bir değeri SESSİZCE kabul ederdi.
  /// (Enum yerine CHECK seçilirse `machine_shift_stat_seals_action_chk` +
  ///  `test_db_invariants` envanteri ZORUNLUDUR.)
  action         MachineSealAction
  sealGeneration Int
  /// ⚠️ `terms` yalnız tam terim fotoğrafının ARŞİVİDİR (SORGULANMAZ, GIN yok) ve
  /// tek okuyucusu helper'dır. "Geçen ayın basılmış karnesini AYNEN yeniden bas"
  /// sözleşmesi SQL'den okunur: `formulaVersion` + `MachineShiftStopBreakdown`
  /// (`sealGeneration`) + aşağıdaki BEŞ KOLON.
  terms          Json
  potSec                Int
  aptSec                Int
  picksActual           Int
  targetPickCapacityPot Int
  effectivenessPct      Decimal? @db.Decimal(5, 2)
  formulaVersion Int
  reason         String?  @db.VarChar(300)
  actedById      String?  @db.Uuid

  stat      MachineShiftStat @relation(fields: [statId], references: [id], onDelete: Restrict)
  actedBy   User?         @relation("MachineShiftSealBy", fields: [actedById], references: [id])
  createdAt DateTime      @default(now()) @db.Timestamptz

  /// DOĞAL ANAHTAR (§2.11) — bir KUŞAKTA her eylemden EN ÇOK BİR satır olur:
  /// mühür/aç/yeniden-mühür tekrarlanabilir bir çevrimdir ve her tekrar
  /// `sealGeneration`ı artırır. Beyan edilen anahtarın sedde karşılığı olmazsa
  /// mükerrer bir `SEAL` satırı §2.11'in *"son kuşağın terimleri ↔ karnenin
  /// güncel kolonları BİREBİR"* mutabakatını belirsizleştirirdi.
  @@unique([statId, sealGeneration, action])
  @@index([statId, createdAt])
  @@map("machine_shift_stat_seals")
}
```

**Mühür geçişleri ATOMİK CLAIM'dir** (üçü de): `updateMany WHERE { id, sealState: <beklenen> }` + `count === 0 → 409` (taze okumayla tanı). "Mühürlü mü" sorusunun tek cevabı `isShiftSealed` helper'ıdır; §3.5'in `SHIFT_SEALED` kapısı da onu çağırır.

> **⚠️ MÜHRÜN YAZARI KİM — Faz 2 kararı.** Faz 1a'da mührü İNSAN atar (`loom:manual-entry`). **Faz 2'de mührü `loom-shift-close.job` atar:** `sealedById = NULL` = **SİSTEM mührü** (`MachineShiftStatSeal.actedById` da NULL, `action = SEAL`). **Anomali içeren vardiyayı job MÜHÜRLEMEZ** (`RESET`/`GAP`/`ANOMALY`): karne `OPEN` kalır, `anomalyAck` kuyruğuna düşer ve yetkili onaylayınca job bir sonraki turda mühürler. Açık kalan vardiya **budanmaz** (budamanın mühür ön koşulu, §4) — bu bilinçli bir birikmedir, sayacı `/api/admin/health`tedir ve rapor *"N vardiya onay bekliyor"* şeridi çizer. Aksi hâlde anomalili vardiya süresiz açık kalır ve budayıcı o pencerede hiç çalışmaz.

### 2.11 · Sekiz soru × altı tablo — defterin kendi kontrol listesi

`docs/kurallar/defter.md` her YENİ defter için sekiz soruyu sorar; sentez bunu üç tabloda hiç cevaplamamıştı. Uygulanmış hâli:

| Tablo | Sınıf | Doğal anahtar | Ters yol | Kova/pencere bağı | Silme sınıfı | Okuma helper'ı | Mutabakat | Bekçi |
|---|---|---|---|---|---|---|---|---|
| `MachineInterval` | TELEMETRİ | `(machineId, bucketStart)` | yeniden yaz (`restateCount`, yalnız mühürsüz) | kendisi kova | **telemetri budaması** (hard-delete sınıfı DEĞİL) | `loom-retention.helper` | Σ `observedSec` + `unobservedSec` = takvim | `test_machine_prune_safety` |
| `MachineStopEvent` | SPAN (sebeple DEFTER) | **`(machineId, stopKey)`** (PARTIAL, `revokedAt IS NULL`) | `revokedAt` + `MachineStopReclass` | `shiftInstanceId` + `factoryDay` | **telemetri budaması**, yalnız İNSAN kararsız satırda | `CLASSIFICATION_QUEUE_WHERE` | Σ breakdown + minor ≤ POT | `test_machine_prune_safety` · `test_machine_reclass` |
| `MachineRun` | SPAN / DEFTER | `(machineId, startedAt)` + tek-açık seddi | `revokedAt` | kapanışta donan terimler | budanmaz | `beamsMountedDuring` (levent) | **Σ(koşum ∩ vardiya) ≤ `potSec`** ve karnenin donmuş paydası açık koşumdan mı geliyor | `test_machine_shift_terms` · `test_machine_run_beam_overlap` |
| `MachineCounterEvent` | DEFTER (append-only) | `(machineId, signalKind, occurredAt)` WHERE aktif | `supersededByEventId` | `bucketStart` | budanmaz | süpersede-edilmemiş yüklemi | **Σ `acceptedDelta` (aktif) ↔ `picksActual` sapması** | `test_machine_counter_delta` |
| `MachineShiftStat` | ÖZET / KARNE (DURUM) | `(machineId, shiftInstanceId)` | mühür çevrimi + `sealGeneration` | `shiftInstanceId` | budanmaz | `loom-efficiency.helper` | terimler ↔ kova/span toplamı | `test_machine_shift_terms` |
| `MachineShiftStatSeal` | DEFTER (append-only) | `(statId, sealGeneration, action)` | yok (defter kapanıştır) | `statId` | budanmaz | son-kuşak helper'ı | **son kuşağın terimleri ↔ `MachineShiftStat`ın güncel kolonları BİREBİR** | `test_machine_shift_seal` |

**Eksik üç mutabakat `test_consistency`ye satır olarak yazılır** (kalın yazılanlar): (a) mühürlü vardiyada Σ `acceptedDelta` sapması `picksActual` ile tutarlı mı; (b) Σ(`MachineRun` ∩ vardiya penceresi) ≤ `potSec`; (c) defter ↔ durum ayrışamaz — son kuşağın terimleri güncel kolonlarla birebir.

---

## 3 · Toplama akışı

### 3.1 · Yol ve ajanın gövdesi

```
Tezgah PLC / kuru kontak / jakar kontrolcüsü (ayrı kutu)
   │  Modbus TCP · RS-485 · röle + DONANIM darbe sayacı · (ileride OPC-UA)
   ▼
KENAR TOPLAYICI AJAN — fabrika LAN'ında, tablet gibi bir İSTEMCİ
   • 1 Hz okur, RAM'de indirger; ham örnek 7 günlük halka tamponda, DB'ye ASLA
   • duruşu KENARDA, tam çözünürlükte yakalar (20 sn'lik kopuş kaybolmaz)
   • kovayı kapatır (hizalı sınırda); çevrimdışıyken DOSYA-TABANLI JSONL
     kuyruğunda tamponlar (SQLite DEĞİL — §10/#3)
   ▼  HTTPS toplu POST
Backend (Express — YENİ SÜREÇ YOK, YENİ SOKET YOK)
   POST /api/tezgah/ingest/intervals   (≤200 kova)
   POST /api/tezgah/ingest/stops       (≤500 olay)
   POST /api/tezgah/ingest/heartbeat   (canlı durum + anlık devir)
   • verifyCollectorToken → requireTezgahEnabled → kapsam kontrolü
   • saat sapması · olabilirlik tavanı · SIMULATED kararını BACKEND verir
   ▼
loom-shift-close.job (setInterval — `archive-scheduler` emsali, I/O değil DB işi)
loom-retention.job → kova + sebepsiz duruş budaması (§4)
   ▼
Tablet: açık/yeni duruşa SEBEP atama   ·   Panel: canlı pano + karne + rapor
```

**Backend hiçbir porta bağlanmaz.** Tek zamanlayıcısı vardiya kapanışı ve "ajan sustu → `OFFLINE`" watchdog'udur; ikisi de DB işidir. `docs/design/MODUL-BAYRAK-TASARIM.md:215` bu kararı zaten vermişti — burada yalnız **sözleşmesi** yazılıyor.

**Neden tezgah kendisi POST atmaz:** modern tezgahların ağ yüzeyi **sunucu** tarafıdır (OPC-UA sunucusu, Modbus TCP slave) ya da üreticinin bulutuna gider. Okumak **client olmayı** gerektirir → backend olamaz → ajan **zorunludur**.

**Neden tablet yapamaz:** tablet operatöre bağlıdır (`WorkSession` vardiya sonunda kapanır), uyur, ve 20 tezgahlık RS-485 zincirinde 20 ayrı master çakışma demektir. Tabletin işi **açık bir duruşa sebep atamaktır.**

> **⚠️ KARAR — ajan TEK GÖVDEDİR ve Electron "Toplayıcı Modu" YAZILMAZ** (çekirdek mimari merceği, KRİTİK). Sentez pilot olarak Electron'u öneriyordu; üç ölçülmüş engel var: ① `docs/kurallar/kesif-cihaz.md` panel yasağı — *"Renderer `electron`/`fs`/`net` import ETMEZ… Main process HTTP BAŞLATMAZ, tek geçit `apiClient.ts`"*; ② `electron-updater` her sürümde uygulamayı yeniden başlatır → **kova ortası `GAP` mühürlü karneye `unobservedSec` olarak kalıcı yazılır**; ③ iki ingest istemcisi = ayrışan yüzey. Yasağın kapsamı da yazılı: `docs/kurallar/genel.md` "ikinci Node süreci" yasağı **ERP kutusuna** aittir; `kesif-cihaz.md` *"fabrika LAN'ında AYRI bir toplayıcı ajan okur ve API'den basar (tablet gibi bir istemci); backend tek-process kalır"* diyor — yani ayrı kutudaki ajan meşrudur.
>
> **Gövde:** yeni `kenar/` alt projesi, headless Node, Windows'ta NSSM/`sc.exe` ile servis, boot-start + watchdog. Geliştirme/demo ihtiyacı aynı gövdenin `--sim` bayrağıyla karşılanır. Ajan backend paketine GİRMEZ (kendi kurulum paketi; `docs/kurallar/surum-yayin.md`'ye dördüncü kanal satırı). "Ajan ERP kutusuna kurulmaz" kuralı hem kodla (§3.3/9) hem `kur.ps1` kurulum adımıyla zorlanır.

### 3.2 · ⚠️ Donanım kısıtı — atkı darbesi YAZILIMLA sayılmaz

400 atkı/dk = 150 ms periyot; 800'de 75 ms. Ajanın yazılım döngüsü ve seri hat gidiş-dönüşü kenarları kaçırır ve üretim **sistematik olarak eksik** ölçülür (hep aşağı yönlü, fark edilmesi zor).

> **Atkı darbesi I/O modülünün DONANIM sayacına sayılır; ajan yalnız KÜMÜLATİF değeri okur.** "Yüksek hızlı sayaç girişi" bir şartname maddesidir.

Aynı karar boşluk dayanıklılığını da verir: ajan ölse bile bir sonraki okumada sayaç sıçraması üretimi geri getirir. İki bağımsız gerekçenin aynı tasarıma çıkması bunu değişmez yapıyor.

### 3.3 · Kimlik, yetki, ağ sınırı

1. Ajan ilk açılışta `collectorKey` üretir, diske yazar.
2. `POST /api/tezgah/collectors/announce` (PUBLIC, JWT yok) → satır `PENDING` doğar.
3. Panelde onay (`loom:collector-admin`) → sunucu `tksrp_col_<rastgele>` üretir, **düz hâlini bir kez** döner, DB'ye yalnız bcrypt hash'i yazar.
4. Ajan `Authorization: Bearer <token>` ile basar. **`verifyToken` DEĞİL** — toplayıcı bir `User` değildir, JWT taşımaz, `req.user` doğmaz, `session-registry`ye kaydolmaz (aksi hâlde bir insanın `'kick'` politikalı girişi ajanı vardiya ortasında sessizce düşürürdü).
5. Token yalnız üç ingest ucunda ve `/api/tezgah/collector/config`te geçerli; başka yolda 401. Middleware başka route'a mount EDİLMEZ.
6. `installationId` uyuşmazlığı → **409 `INSTALLATION_MISMATCH`**.
7. Kapsam: `MachineCollectorLink` + **`MachineSpec.monitoringState IN ('SHADOW','LIVE')`** + **`signal.isActive AND peripheral.deletedAt IS NULL`**. Üçü TEK helper'da yaşar (boğaz-ikizi Prisma parçasıyla birlikte değişir): silinmiş cihaz mezar taşı aldığı için Cascade hiç tetiklenmez ve onun aktif sinyali kapsamda kalırdı. Kapsam dışı makine → **403 `MACHINE_NOT_IN_SCOPE`**; **`monitoringState = OFF` olan makine de kapsam dışıdır** (aynı 403, aynı helper — ingest'in gölge moda sokulmamış tezgaha yazmasının yolu yoktur, §2.3).
8. `revokedAt` + `rotate-token`. Token güncellenmez, **yenisi üretilir**.
9. Ajan sunucuyu mevcut mDNS ile bulur (`jobs/mdns-advertiser.job.ts`) — yeni keşif mekanizması yok. Ajan açılışta yerel `:4000`'de TeksERP bulursa **reddeder** ve kurulum hatası basar.
10. **Doğrulama MALİYETİ ölçülür.** Token rastgele 256-bit üretildiği için sözlük saldırısı yüzeyi yoktur; bcrypt'i HER istekte koşmak (20 tezgah × 5 sn nabız ≈ 4 istek/sn, `bcryptjs` saf JS) **tek-process** backend'in ana iş parçacığını gereksiz meşgul eder. Kalıcı hash bcrypt KALIR (sır hijyeni), ama doğrulanmış token → `collectorId` eşlemesi **bellek içi TTL'li önbellekte** tutulur (60 sn; `revokedAt`/`rotate-token` anında düşürür). Alternatif: `tokenHash`i SHA-256 + sabit-zaman karşılaştırmaya çevirmek. ⚠️ Sayı BUGÜN ÖLÇÜLMEDİ — pilotta `/api/admin/health` gecikme sayacıyla **ölçülür ve karar ölçümle verilir**.

> **⚠️ Denetim eklemesi — UZAK/LAN SINIFLANDIRMASI (çekirdek mimari merceği, KRİTİK).** Sentez bu konuyu hiç açmamıştı. `src/middlewares/remote-access.middleware.ts:185-190` `REMOTE_DENIED_PREFIX = ["/api/devices","/api/discovery","/api/mobile","/api-docs"]` ve gerekçesi birebir bizim ucumuzu tarif ediyor: *"`POST /announce` KİMLİKSİZ PENDING cihaz yaratır ve tavan 200'dür; internete açık olsaydı tablet eşleştirmesi DoS'lanabilirdi."*
> **Karar:** `"/api/tezgah/ingest"` + `"/api/tezgah/collectors"` bu listeye eklenir (ajan tanımı gereği LAN'dadır; uzakta **404**, 403 değil — 403 varlığı doğrular). Pano/karne/rapor uçları AYRI önekte kalır (`/api/tezgah/reports`, `/api/tezgah/dashboard`) ki patron uzaktan izleyebilsin. Bekçi: `test_remote_access_guard`e iki yol satırı.
>
> **⚠️ `verifyToken` taşımayan dört uç `scripts/test_route_auth_coverage.ts:51` `EXEMPT` sözlüğüne gerekçesiyle yazılır** (gerekçe >10 karakter kontrolü `:345`); beyansız public uç bekçiyi kırmızıya düşürür ve deploy'u durdurur. Gerekçe metni: *"toplayıcı ajan bir `User` değildir; koruma `verifyCollectorToken` (bcrypt hash + `installationId` + kapsam), oturum kaydı YOK."*
>
> **⚠️ Hata kodları `details.code` altındadır** (`module.middleware.ts:70-75`: *"`code` TOP-LEVEL DEĞİL"*). **Ajan `body.code` OKUMAZ** — okursa sessizce hep `undefined` alır (sahte yeşil).

### 3.4 · Sayaç farkı — taşma / sıfırlama / boşluk

`src/services/helpers/loom-counter.helper.ts` — **TEK kaynak**, AST tripwire ile korunur.

```ts
export function deriveCounterDelta(i: {
  prev: Prisma.Decimal | null; cur: Prisma.Decimal;
  elapsedSec: number; maxRevPerMin: number | null; picksPerRev: number;
  modulus: Prisma.Decimal | null; tolerance?: number;   // vars. 0.10
}): { delta: number | null; quality: MachineDeltaQuality } { /* … */ }
```

1. **Asla fark uydurma.** `ANOMALY` → `pickDelta = null`. Kova 0 üretim GÖSTERMEZ, **"bilinmiyor"** gösterir. `0` ile `null` raporda ayrı kovalardır.
2. **Tavan = fizik.** `maxRevPerMin × picksPerRev × geçen_dk × 1.1`. `maxRevPerMin` NULL ise **tavan uygulanmaz ve kalem `ANOMALY` damgalanır** — uydurulmuş bir tavan sessiz kabul üretirdi.
   > **⚠️ BİRİM SEDDİ (Fable D1, KRİTİK).** Tavan **devir/dk** okur, randıman paydası **atkı/dk** okur ve sentez ikisine de `maxPicksPerMin` diyordu: `picksPerRev = 2` olan bir tezgahta tavan sessizce **2,2 katına** gevşer, kontrolcü çöpü `OK` damgalanıp doğrudan `picksActual`a girerdi. Adlar ayrıldı: **`maxRevPerMin` = devir/dk** (§2.3) · **`targetPicksPerMin`/`nominalPicksPerMin` = atkı/dk** (§2.8, §2.10). **`picksPerRev` YALNIZ tavana girer, PAYDAYA ASLA** — AST tripwire `picksPerRev` ile `targetPicksPerMin`in aynı ifadede geçmesini yasaklar.
3. **`WRAPPED` ile `RESET` ayrımının tek ayırt edicisi olabilirlik tavanıdır.** `RESET` **dürüsttür ama EKSİKTİR**: sıfırlama öncesi atkılar kayıptır. Satır `RESET` damgalanır, `MachineCounterEvent` yazılır, onay olmadan vardiya mühürlenemez. 16-bit sarma ile operatörün doff'ta sayacı sıfırlaması **ayırt edilemeyebilir** — bu yüzden negatif sıçrama sarma diye YORUMLANMAZ (modülüs NULL doğar, §2.3), insana bırakılır.
4. **Süreklilik ajanda yaşar.** `prev` backend'den okunup yazılmaz (TOCTOU); ajan kovayı kaparken `pickCounterStart` ve `pickCounterEnd`i BİRLİKTE yollar. Ajan yeniden başladığında `prev` yoktur → ilk kova `GAP`, ve `MachineLiveState.lastPickCounter` farkı bir **`MachineCounterEvent` satırı** doğurur: `quality = GAP`, `signalKind = PICK_COUNTER`, `prevValue = MachineLiveState.lastPickCounter`, `nextValue = ilk yeni okuma`, `acceptedDelta = null` (fark ÜRETİLMEZ), `decisionSource = MACHINE`, `decidedById = null` — *"şu andan şu ana görülmedi, aradaki N atkı bu kovaya sığdırılamaz."* ⚠️ Ayrı bir `COLLECTOR_GAP` enum değeri ya da tablosu **AÇILMAZ**; o ad, `GAP` niteliğinin toplayıcı kaynaklı hâli için kullanılan konuşma dilidir.

### 3.5 · İdempotency, sıra, saat

| Sınıf | Anahtar | Aynı yük | Farklı yük |
|---|---|---|---|
| **Kova** (telemetri) | `@@id([machineId, bucketStart])` | no-op | **üstüne yaz + `restatedAt`/`restateCount`** — mühürlü pencerede **409 `SHIFT_SEALED`** |
| **Duruş AÇILIŞI** (defter) | **`machine_stops_key_uq (machineId, stopKey)`** (PARTIAL, `revokedAt IS NULL`) | no-op | **409 `STOP_PAYLOAD_CONFLICT`** |
| **Duruş KAPANIŞI** (geçiş) | `updateMany WHERE {id, endedAt:null, revokedAt:null}` | aynı `endedAt` → no-op | farklı `endedAt` → **409 `STOP_END_CONFLICT`** |
| **Geri alınmış duruş** | doğal anahtar REVOKED satıra düşer | — | **409 `STOP_REVOKED`** (ajan kalemi kuyruktan DÜŞÜRÜR) |
| **Elle giriş / düzeltme** | `clientToken @unique @db.Uuid` | `token-replay.helper` dört durumu | ③ 409 `CLIENT_TOKEN_COLLISION` |
| **Sayaç kararı** (defter) | `machine_counter_events_natural_uq` (PARTIAL, süpersede-edilmemiş) | no-op | **409 `COUNTER_EVENT_CONFLICT`** |
| **Parti** | `MachineCollector.lastSeq` | `ackSeq`e kadar buda | — |

> **⚠️ Üç denetim düzeltmesi bu tabloda.**
> **(a) Kimlik DAR olmalı** (`idempotent-replay.helper` başlığı: *"gövdenin tamamı aynı mı DEĞİL"*). Duruş bir SPAN'dir; ajan aynı kalemi iki kez yollar — açılışta `endedAt: null`, kapanışta dolu. Sentezin "aynı anahtar + farklı yük → 409" kuralı **meşru kapanışı sistematik olarak reddediyordu**; duruş `maxOpenStopHours` sonunda WATCHDOG'la kapanır ve süresi persentillerden dışlanırdı. Kimlik **DAR ve SAATTEN BAĞIMSIZDIR** — `(machineId, stopKey)` (aşağıdaki karar; sentezin `machineId + startedAt + source` üçlüsü KALKTI); `endedAt`/`durationSec`/`endSource` **geçiş alanıdır** ve atomik claim ile yazılır (`WHERE {id, …}` — `machineId` yüklemiyle kapatmak TOCTOU'yu geri getirir; açık duruşun id'si `MachineLiveState.openStopId`den okunur). Sınıflandırma alanları ingest yükünde HİÇ kabul edilmez (ajan sebep atamaz).
> **Anahtarın KENDİSİ de kırılgandı ve ARTIK SAATTEN KOPARILDI (Faz 2 sözleşmesi, 2026-09-12).** ±120 sn saat sapması kabul edilirken replay seddi ajan saatinin **milisaniye eşitliğine** bağlıydı — 1 sn kayan bir tekrar gönderim İKİNCİ satır açar, kopya KAPALI geldiği için `one_open_per_machine_uq` görmez ve aynı duruş breakdown'da iki kez sayılıp randımanı düşürürdü. Ara çözüm olan **saniyeye kuantizasyon** (`date_trunc('second')`) ve `tezgah.stopMatchToleranceSec` toleransı bir kimlik çözümü değil semptom bastırıcıydı: tolerans ne seçilirse seçilsin, sınırın iki yanında iki farklı yanlış cevap veriyordu (dar tolerans → mükerrer satır, geniş tolerans → iki ayrı duruşun birleşmesi).
> **Karar: kimlik ajan üretimi bir TOKEN'dır.** `MachineStopEvent.stopKey` (UUID, `clientToken` kalıbı) ajan duruşu ilk gördüğünde üretilir ve kalemin ömrü boyunca DEĞİŞMEZ; sed **PARTIAL UNIQUE `(machineId, stopKey) WHERE revokedAt IS NULL`**tir. `startedAt` **kimlik değil VERİDİR** (ham ajan damgası; sunucu gerçeği `startedAtServer = startedAt + clockSkewMs` ile türetilir), `clockSkewMs` süre şüphesinin izidir ve **kimliğin parçası DEĞİLDİR**. Aynı `stopKey` + FARKLI kimlik yükü (`machineId`/`source`/`startedAt` oynamış) → **409 `STOP_PAYLOAD_CONFLICT`**; sıra dışı açılış (açık duruş dururken farklı `stopKey` ile ikinci açılış) → **409 `STOP_OUT_OF_ORDER`**. `tezgah.stopMatchToleranceSec` bayrağı bu kararla **DÜŞTÜ** (§6.3'ten çıkarıldı) — tolerans penceresi artık gereksizdir.
> **(b) Replay'in DÖRDÜNCÜ durumu.** Sed PARTIAL olduğu için geri alınmış satır yer işgal etmez: süpervizör hayalet duruşu `revokedAt` ile geri alır, ajan aynı kalemi yeniden yollar, **yeni aktif duruş doğar ve geri alma sessizce iptal olur.** Bu tam olarak `services/helpers/token-replay.helper.ts` başlığındaki ④ durumudur (*"yazıldı, sonra İPTAL EDİLDİ → cached kaydı dönmek YANLIŞ CEVAPTIR"*). Ingest doğal anahtar aramasında geri alınmışları da GÖRÜR → 409 `STOP_REVOKED`.
> **(c) İnsan yolunun `clientToken`ı.** Makine yolunun tekilliği doğal anahtardır ve orada `clientToken` KULLANILMAZ; ama Faz 1a'nın tek yazma yüzeyi **elle vardiya girişidir** ve çift tıklama insan hatasıdır. Elle giriş ve duruş düzeltme uçları `clientToken @unique @db.Uuid` taşır (kök kural: *"kayıt yaratan uçlar `clientToken` taşır"*; bugün şemada 17 satır — kök `CLAUDE.md`'nin "15 model" ölçümü bayat, tazelenmeli).

> **⚠️ MEKANİZMA YAZILMADAN BU TABLO UYGULANAMAZ** (Fable C2/C3/C6). Tablo SONUCU söylüyordu, nasıl ayırt edileceğini değil; iki satırın naif uygulaması doktrine çarpıyor.
>
> **(1) Kova yazımı TEK HAM İFADEDİR.** Prisma `upsert` **koşullu update yapamaz** (her çağrıda koşulsuz yazar → `restatedAt` her kovada dolar ve terim anlamsızlaşır), oku-yaz ise yasak. Yazım:
> `INSERT … ON CONFLICT ("machineId","bucketStart") DO UPDATE SET …, "restateCount" = machine_intervals."restateCount" + 1, "restatedAt" = now() WHERE (machine_intervals.* IS DISTINCT FROM EXCLUDED.*) AND NOT EXISTS (<mühürlü pencere>) RETURNING (xmax = 0) AS inserted` — `restatedAt`/`restateCount` yalnız **gerçekten değişen** satırda artar, aynı yük DB'ye hiç yazmaz (ölü tuple üretmez). Emsal ölçüldü: `item-price.service.ts:383` (`ON CONFLICT … WHERE <index predicate> DO UPDATE … RETURNING (xmax = 0)`). Ham yolda `updatedAt` ELLE yazılır (`@updatedAt` ham SQL'de çalışmaz).
> **⚠️ MÜHÜR YÜKLEMİ AYNI İFADENİN İÇİNDEDİR** (Faz 2 sözleşmesi): `NOT EXISTS (<mühürlü pencere>)` düşerse satır DÖNMEZ ve kalem **409 `SHIFT_SEALED`** alır — mühür kontrolünü ayrı bir `SELECT`e almak check-then-act olurdu (§3.5 sonundaki advisory kilit kararı bunun ikinci yarısıdır). Yüklem **`SEALED_WINDOW_SQL` ↔ `isSealedWindow()` boğaz-ikizidir**: saf yüklem WHERE'e giremez, Prisma parçası ile SQL parçası AYNI commit'te değişir ve AST tripwire ikisini birlikte ölçer. **Mühürden sonra hiçbir telemetri sessizce değişmez.**
>
> **(2) Duruş AÇILIŞI da tek ifadedir — `P2002` YAKALANMAZ.** Unique ihlali tx'i **abort eder** (SAVEPOINT yok) ve "makine başına tek tx" kuralıyla birleşince bir kalemin çakışması TÜM paketi düşürür — kalem bazlı cevap sözleşmesi de çökerdi; ayrıca ham sorguda Prisma **P2010** döner, P2002 değil. Yazım:
> `INSERT … ON CONFLICT ("machineId","stopKey") WHERE "revokedAt" IS NULL DO UPDATE SET "updatedAt" = now() WHERE <kimlik alanları EXCLUDED ile aynı> RETURNING id, (xmax = 0) AS inserted` — satır dönerse no-op/kabul; **DÖNMEZSE** çakışan yük vardır ve kalem `rejected[{key, code:'STOP_PAYLOAD_CONFLICT'}]`e yazılır, **tx düşmez**. Çakışma anahtarı `stopKey`tir: aynı token + farklı `machineId`/`source`/`startedAt` bir çelişkidir, aynı token + aynı yük bir tekrardır.
>
> **(3) WATCHDOG GEÇİCİ BİR KAPANIŞTIR ve geçici olduğunu KOLONDA söyler.** `tezgah.maxOpenStopHours` aşılınca duruş kapatılır ama kapanış **uydurulmuş bir an değil, beyan edilmiş bir tahmindir**: `endedAt = startedAt + maxOpenStopHours`, `endSource = WATCHDOG`, `provisionalEndedAt` **aynı değerle damgalanır** ve karnede süre `watchdogSec` terimiyle AYRI basılır (§2.10). Karne "şu kadarı tahmindir" demeden mühürlenmez.
> **Gerçek kapanış bir ÇELİŞKİ değil bir DÜZELTMEDİR** ("farklı yük → 409" burada gerçeği reddederdi; aksi hâlde 12 saatlik tahmin mühre kalıcılaşır ve ajan kuyruğu sonsuz 409 üretirdi). Düzeltme **mühürsüz vardiyada TEK KEZ** uygulanır: atomik claim `updateMany WHERE { id, endSource: 'WATCHDOG' }` → `endedAt`/`durationSec`/`endSource` yeniden yazılır, **`endCorrectedAt` damgalanır** ve **`provisionalEndedAt` İZİ KALIR** (ileri damga null'lanmaz; o duruşun bir dönem tahmin olduğu ve persentillerden dışlandığı sonsuza kadar okunabilir). Claim `count === 0` ise ikinci bir watchdog düzeltmesi denenmiştir → 409; yön **tek yönlüdür**: `WATCHDOG → gerçek`.
> Vardiya **MÜHÜRLÜYSE** düzeltme uygulanmaz: kalem **409 `SHIFT_SEALED`** alır ve panelin **"geciken kapanışlar" kuyruğuna** düşer (sayacı `/api/admin/health`te); süpervizör `loom:shift-unseal` → düzeltme → yeniden mühür yolunu bilerek yürür. Kuyruk olmadan bu kalemler ajanın kuyruğunda ölür ve gerçek kapanış sessizce kaybolurdu.

- **Cevap KALEM BAZLIDIR:** `{ accepted[], duplicates[], rejected[{key,code}], ackSeq, serverTime }`. **Opak 500 + "hepsini tekrar dene" yasak.** 409 alan kalem ajan kuyruğunda ölür, retry edilmez, panele "çelişen kalem" olarak düşer ve sayacı `/api/admin/health`tedir.
- **Paket içi sıra:** bir pakette aynı makinenin kalemleri `startedAt` **ARTAN** sırada işlenir (sunucu sıralar, istemciye güvenmez); makine başına tek tx; açık-duruş seddine takılan AÇILIŞ **no-op EDİLMEZ** → 409 `STOP_OUT_OF_ORDER`.
- **Saat sapması — iki ayrı cümle:** **(1)** Ajan saatinin **TEK KAYNAĞI sunucudur**: sunucunun `Date` başlığından ölçtüğü ofseti KENDİ damgalarına uygular ve ham ofseti `clockSkewMs` olarak beyan eder — işletim sistemi NTP'si gerekmez. **(2)** `tezgah.maxClockSkewSec` (120) kapısı ofsetin **ÖLÇÜLEMEDİĞİ** durum içindir (başlık yok / ardışık ölçümler tutarsız) ve **PAKETİ değil KALEMİ** düşürür (`rejected[]`). ⚠️ *"Sunucu NTP kaynağı yapılır, `kur.ps1` kurulum adımıdır"* cümlesi **ÖLÇÜLDÜ ve YANLIŞTI**: `deploy/kur.ps1`de `w32tm`/NTP/`Set-Date` **sıfır geçiş**. İstenirse bu Faz 2'nin AYRI bir iş kalemidir (yeni `kur.ps1` adımı + sürüm notu), var olan bir adım değil.
- **Geç gelen veri:** mühürlü vardiyaya düşen kalemler **409 `SHIFT_SEALED`** alır; panelde "N kalem mühürlü vardiyaya geldi" uyarısı çıkar, süpervizör `loom:shift-unseal` ile mührü açıp yeniden hesaplatır. **Sessiz yeniden hesap YOK.**
- **Kapanmayan duruş:** `tezgah.maxOpenStopHours` (12) aşılınca **tembel kapatma** (`resolveActiveSession` emsali, ayrı process yok) → `endSource = WATCHDOG`.
- **Kova boyu TEK KAYNAKTAN okunur ve İLERİYE DÖNÜK değişir.** Boyun tek kaynağı **`GET /api/tezgah/collector/config`**tur: sunucu yürürlükteki `bucketMinutes`i **`effectiveFrom` damgasıyla** döner, ajan onu kullanır ve kalemde tekrar beyan eder. Beyan ile yürürlükteki değer uyuşmazsa kalem **400 `BUCKET_SIZE_MISMATCH`** alır (ajan config'i tazeleyip yeniden dener) — eski `409 BUCKET_SIZE_CONFLICT` adı bu tek-kaynak kuralıyla değiştirildi: çakışma bir yarış değil, **bayat yapılandırmadır**. Satır içi DB CHECK (`machine_intervals_bucket_chk`) `bucketMinutes`i yürürlükteki kümeyle sınırlar, yani bayat bir ajan seddi DB'de de bulur. 60→15 çekilirse eski kova PK'da çakışıp ezilir ve o saat **çift sayılır**; bu yüzden değişim ANI `SystemSetting`e damgalanır, budayıcı/mühürleyici o andan öncesini eski kova boyuyla okur ve **eski kovalara DOKUNULMAZ**. Değişim **hem kova hem VARDİYA sınırına hizalı** bir anda yürürlüğe girer (vardiya ortasında boy değişirse o vardiyanın terimleri iki farklı ızgaradan toplanır ve mutabakat kalıcı olarak kırmızı kalırdı). **Hizanın kendisi de doğrulanır:** ingest, `bucketStart`i fabrika gününün başlangıcından itibaren `bucketMinutes` ızgarasına göre ölçer; hizasız kalem **400 `BUCKET_MISALIGNED`** alır ve sunucu **sessizce kuantize ETMEZ** (kuantizasyon ajanın hatasını gizler ve iki kovayı birleştirir; 10:00 ile 10:02 başlangıçlı iki 15 dk'lık kova PK'yı ihlal etmez ama 13 dk ÖRTÜŞÜR). Izgara kontrolü `shift-resolve.helper` ile aynı takvim kaynağını kullanır.
- **Simülasyon — İKİ SİNYAL, çapraz kontrol.** `source: SIMULATED` yalnız `tezgah.simulatedDataEnabled` AÇIKKEN kabul edilir (varsayılan kapalıda 400). **Ek olarak:** kapsamdaki cihazın `PeripheralDevice.simulate` değeri true iken `source: MACHINE` beyan eden kalem **400 `SOURCE_MISMATCH`** alır — emsalin gerçek biçimi iki sinyallidir (`test_sack_weigh_source` başlığı: *"İki sinyal: istemci beyanı VE sunucunun cihazı kendi çözüp `simulate`i çapraz kontrol etmesi"*; `shipping.service.ts:1497-1534`). Tek beyana bakmak, simüle cihazın `MACHINE` damgasıyla deftere yazmasına izin verirdi.
- **Advisory kilit — HAYALET KOVA GERÇEKTİ (Fable C1, KRİTİK).** Sentez *"ingest kilit ALMAZ"* diyordu ve `work_sessions_active_machine_uq` emsalini gösteriyordu; **emsal yanlış sınıf**: o sed bir TEKİLLİK değişmezini korur, bir **SAYIM FOTOĞRAFINI** değil. Kilitsiz kurgu şu yarışı açık bırakıyordu: ingest `sealedAt = null` okur → mühür sayar ve commit eder → ingest commit eder; `409 SHIFT_SEALED` kapısı da aynı kilitsiz okumaya dayandığı için **check-then-act**tir. Taze okuma tek başına YETMEZ — ölçüldü: döneme YAZAN her yol kapanışla aynı uzayı alıyor (`period-guard.helper.ts:165-166`, `assertPeriodOpenTx`in İLK ifadesi kilittir) ve paylaşımlı kalıbın emsali hazır (`master-data-live.helper.ts:68` `pg_advisory_xact_lock_shared`; bekçi regex'i `_shared`i tanır, `test_advisory_lock_namespaces.ts:78`).
  **Karar:** **mühür** tx'inin İLK ifadesi `pg_advisory_xact_lock(8032, hashtext(shiftInstanceId))` (**EXCLUSIVE**); **ingest** tx'inin İLK ifadesi aynı anahtarda **`pg_advisory_xact_lock_shared`**. Kalemin `shiftInstanceId`si tx'ten ÖNCE `shift-resolve.helper` ile çözülür (takvim hesabı, kilit sırasını bozmaz); bir pakette birden çok vardiya varsa kilitler `shiftInstanceId` **artan sırada** alınır (deterministik sıra kuralı). Faz 1a'da mührün tek yazarı insandır ve `MachineInterval` yoktur — uzay **Faz 2'de** doğar (§9).

```
// period-guard.helper.ts ENVANTERİNE TEK SATIR (FAZ 2'de eklenir):
//   8032  MACHINE_SHIFT_SEAL_LOCK_NS  services/loom-shift.service.ts  tezgah vardiya mühürü
//         (anahtar: hashtext(shiftInstanceId); EXCLUSIVE sahip = mühürleyici,
//          `_shared` = ingest — 8030 / `master-data-live.helper.ts:68` emsali)
```

**Uzayın TEK SAHİBİ mühür servisidir; ingest yalnız PAYLAŞIMLI alır ve uzayı BÜYÜTMEZ.** [ES-14] "tek sahip" kuralı satırda açıkça yazılır — 8030 emsalinde de sahip `master-data-merge.service.ts`, paylaşımlı kilidi alan ise `master-data-live.helper.ts`tir ve bekçi ikisini de sayar.

Envanter bugün 8021→8031'de bitiyor (`src/services/helpers/period-guard.helper.ts:46-56`) ve 8032 boştur; satır biçimi bekçinin ayrıştırdığı makine-okur biçimdir. **Devere tarafı ölçerse 8033'e gider** (§7.3).

---

## 4 · Saklama, budama ve iki sınıfın tek tablodaki bedeli

**Varsayım:** 20 tezgah, 24 sa/gün, 365 gün. Satır boyutları ölçülmüş bandın üst ucundan (heap + tüm indexler).

| Katman | Çözünürlük | Satır/yıl | Saklama | Yıllık/tavan boyut |
|---|---|---|---|---|
| Ham örnek | 10 sn | *63,07 M* | **DB'ye HİÇ girmez** — kenarda 7 günlük halka tampon | **0** |
| `MachineInterval` | 15 dk | 700.800 | `tezgah.sampleRetentionDays` = **180** | **~120 MB TAVAN (sabit)** |
| `MachineStopEvent` **insan kararsız** | olay | ~1,12 M ⚠️ | kova ile birlikte budanır (vardiya mühürlüyse) | ~450 MB tavan |
| `MachineStopEvent` **insan kararlı** | olay | ~280 K ⚠️ | **BUDANMAZ** | ~180 MB/yıl |
| `MachineShiftStopBreakdown` | vardiya×sebep×kuşak | 175.200 | **BUDANMAZ** | ~45 MB/yıl |
| `MachineShiftStat` | vardiya×makine | 21.900 | **BUDANMAZ** | ~7 MB/yıl |
| `MachineRun` · `MachineCounterEvent` · `ShiftInstance` | — | ~24.000 | **BUDANMAZ** | ~6 MB/yıl |

**Bir yıl sonra:** kalıcı büyüme ≈ **240 MB/yıl**, budanan tavan ≈ **570 MB**; ilk yıl toplam **< 1 GB**. ⚠️ Satır boyu bandının **alt ve üst ucu** ayrı yazılır; aynı tabloya iki farklı boy verilmez (yukarıdaki iki satır aynı tablodur ve boy farkı yalnız DOLU kolon sayısından gelir). Bu tavanın asıl bedeli bir "yedek penceresi" DEĞİL, **KURULUM KAPISIDIR:** `deploy/kur.ps1:448-451` her sürümden önce `pg_dump -Fc` alır, `pg_restore --list` ile doğrular ve ikisinden biri düşerse **kurulumu İPTAL eder** (*"Yedek ALINAMADI -> kurulum IPTAL"* / *"Yedek DOGRULANAMADI (bozuk dump) -> kurulum IPTAL"*); zaman sınırı/pencere YOKTUR. Tablo büyümesi yedeği yavaşlatır, **başarısız bir yedek güncelleme yolunu tümüyle kapatır** — retention tavanı bu yüzden bir depolama kararı değil, bir **DAĞITIM** kararıdır. "En eski canlı dump'ta şema provası" kuralı korunur. 120 tezgahta ×6 → o ölçekte partition kararı yeniden açılır (bugün açılmaz; **tetik yazılı:** tablo 20 M satırı VEYA kurulum 60 tezgahı geçerse, ve prova **boş tabloda** yapılır — sayaç `/api/admin/health`te).

⚠️ **Duruş sıklığı ölçülmedi.** 8 duruş/saat/tezgah bir varsayımdır (band 3–15). **Saha doğrulaması** — pilotta ölçülür; 10× yanılsa bile mimari değişmez, yalnız retention penceresi kısalır.

### Budama — dört sed

1. **BUDAMA TESTİ (bekçi).** Raporlanabilir her sayı budamadan sonra da aynı değeri vermelidir. `scripts/test_machine_prune_safety.ts` **dört ayaklıdır**: ① **pozitif sed sondası** — budama penceresinin İÇİNE sebepli + `classifiedById` dolu + geri alınmış üç duruş konur, budamadan sonra üçü de DURUYOR olmalı; ② **gerçek negatif sonda** — budayıcının WHERE'inden sebep yüklemi kaldırılır → kırmızı; ③ **yüzey envanteri** — `machine_stop_events`/`machine_intervals` okuyan dosyaların AST listesi sabitlenir; listeye yeni dosya girerse kırmızı (yeni bir rapor, budama güvenliği yeniden ölçülmeden doğamaz); ④ **koşum terimi sondası** — budamadan önce ve sonra `MachineRun`ın üretim VE duruş terimleri AYNI (aşağıdaki *"Koşum ekseni kovadan bağımsızdır"* paragrafı). "Oku → buda → yeniden oku → fark 0" kalır ama **tek başına güvence sayılmaz**: bugün var olmayan bir raporun okuduğu kolonu ölçemez.
2. **Mühür ön koşulu.** Budayıcı yalnız `sealState = SEALED` olan vardiyanın penceresine dokunur.
3. **Sebep seddi (uygulama) — yüklem İNSAN KARARINA daraltıldı.** Budanmayan duruş = **insan kararı taşıyan** duruştur: `classifiedById IS NOT NULL OR reasonSource IN ('OPERATOR','SUPERVISOR')`. Makineden türeyen sınıflandırma (`reasonSource IN ('MACHINE','INFERRED')` **ve** `classifiedById IS NULL`) **TELEMETRİDİR**: kovayla birlikte budanır, rakamı karnede ve `MachineShiftStopBreakdown`ta zaten donmuştur. Yüklem `src/services/helpers/loom-retention.helper.ts`te TEK kaynaktır ve AST tripwire ile korunur.
   > **Neden daraltıldı (Fable D4, KRİTİK):** eski yüklem (`reasonCode IS NOT NULL OR …`) §10/#11'in *"sinyalden çözülen kısa kopuş otomatik sınıflanır"* kararıyla çarpışıyordu — dokumada duruşların ÇOĞU kopuştur, yani otomatik sınıflama budanan 1,12 M satırı kalıcı 1,12 M satıra çevirir ve *"ilk yıl < 1 GB"* bütçesini **tek tabloyla** aşardı. Sınır artık "sebep var mı" değil, **"bir insan karar verdi mi"**dir.
4. **Sebep seddi (DB).** ⚠️ `machine_stop_events_block_classified_delete` **BEFORE DELETE trigger**'ı **aynı yüklemi birebir** DB'de zorlar (`RAISE EXCEPTION`) — üçü (helper · trigger · `machine_stops_duty_idx`) **boğaz-ikizdir** ve birlikte değişir. Gerekçe: yüklemdeki tek hata defter satırını geri dönüşsüz siler; `scripts/test_db_invariants.ts:543` trigger envanteri zaten var ve *"trigger kaybı diğerlerinden DAHA KRİTİK"* diyor.
5. **Takvimle kapanan borç BEYAN EDİLİR (sed değil, ÖLÇÜM).** `machine_stops_duty_idx` yüklemi (sınıflandırma kuyruğu) ile budama yüklemi **tümleyendir**: budayıcı koştuğunda kuyrukta bekleyen borç satırları sessizce yok olur — yani sınıflandırma borcunu insan kararı değil **TAKVİM** kapatır. Bu yüzden budayıcı her koşumda sildiği pencerede kaç **SINIFLANDIRILMAMIŞ** duruş bulunduğunu sayar; sayı `/api/admin/health`e ve audit'e yazılır. Sayacın sıfırdan büyük olması bir kusur değil bir **ölçümdür**: sınıflandırma kuyruğunun kronik temizlenmediğini gösterir ve `shiftCloseRequiresClassification` kararının girdisidir.

> **⚠️ DOKTRİN BORCU — ve ÜÇÜNCÜ HARD-DELETE SINIFI AÇILMAYACAK (yönetici kararı, 2026-09-12).** `MachineStopEvent` tek tabloda iki yaşam sınıfı taşıyor ve budayıcı ondan fiziksel `DELETE` yapıyor. `docs/kurallar/defter.md` iki meşru hard-delete sınıfı tanıyor (③b saf yapılandırma pivotu · ④ deftere hiç yazmamış taslak) ve *"yeni bir `delete` yolu açmak KARARDIR: iki sınıftan birine girmiyorsa yazılmaz"* diyor.
> **Önceki tasarım turu buradan bir ⑤ sınıfı öneriyordu — REDDEDİLDİ.** Gerekçe: sınıf listesi *"bir defter satırını hangi koşulda fiziksel silebilirsin"* sorusunun cevabıdır; telemetri satırı **defter satırı değildir**, dolayısıyla o listeye girmesi kategori hatasıdır. Üçüncü bir sınıf açmak, listeyi "silinebilir şeyler" listesine çevirir ve bir sonraki tasarımcı kendi tablosunu oraya yazmak için gerekçe arar — doktrinin aşınma yolu tam olarak budur.
> **Karar: `defter.md`ye SINIF değil BÖLÜM eklenir — "Telemetri ≠ defter" — ve budama izni bir BEKÇİYLE ölçülür.** Altı çekirdek kural: **①** telemetri bir hard-delete sınıfı DEĞİL, **defter-olmayan satırın yaşam döngüsüdür** (`updatedAt` taşır, yeniden yazılır, tavanlıdır, budanır); **②** deftere/iş kararına giren her sayı **budamadan ÖNCE kalıcı kolona DONAR** (karne terimleri · `MachineShiftStopBreakdown` · koşumun kapanış terimleri); **③** budama izni **manifest bekçisiyle ÖLÇÜLEREK** verilir — bekçi yeşil değilken retention job sürüme çıkmaz; **④** telemetri okuyan yol **tek dosyada** yaşar ve AST tripwire ile sabitlenir; **⑤** aynı tabloda defter + telemetri varsa **yüklem TEK helper'dadır** ve DB seddiyle ikizdir; **⑥** retention **açık koşuma, açık vardiyaya ve mühürsüz pencereye DOKUNMAZ**.
> Bu bir `/karar-notu` işidir: tam metin arşive, `docs/kurallar/defter.md`ye bölüm + tek kural satırı. **Budayıcı bu bölüm yazılmadan ve bekçisi yeşil görülmeden sürüme çıkmaz** (Faz 2 kabul kapısı, §9). Kök `CLAUDE.md`'ye tek cümle eklenip eklenmeyeceği **kullanıcı onayındadır** — bu belge onu kendiliğinden yazmaz.
> Alternatif ① (tabloyu ikiye ayırmak, sınıflandırmada satır taşımak) ölçüldü ve reddedildi: taşıma sırasında id değişir, `MachineStopReclass`/`MachineShiftStopBreakdown` atıfları kırılır ve "tek açık duruş" seddi iki tabloya bölünür.

### Budama bekçisinin SÖZLEŞMESİ — okuma kümesi bir MANİFESTTİR (2026-09-12)

*"Oku → buda → yeniden oku → fark 0"* cümlesi bir bekçi değildir: **hangi uçların okunacağı** yazılmadıkça bekçi, yazarının o gün hatırladığı yüzeyleri ölçer ve yarın doğan rapor budama güvenliği hiç ölçülmeden canlıya çıkar. Sözleşme dört madde:

**① OKUMA KÜMESİ ELLE LİSTE DEĞİL, MANİFESTTİR.** `scripts/test_machine_prune_safety.ts` Express router'ından **`/api/tezgah/**` altındaki HER `GET` ucunu toplar** ve `src/constants/loom-read-surfaces.ts` manifestiyle karşılaştırır; **manifestte olmayan bir uç varsa bekçi KIRMIZI** (yeni rapor, sınıfı beyan edilmeden doğamaz). Manifest her ucu iki sınıftan birine yazar:

| Sınıf | Uçlar | Budama sonrası sözleşme |
|---|---|---|
| **DEFTER** (budama öncesi/sonrası **BİREBİR**) | **R1** `shift-stats` · **R2** `efficiency` · **R3** `stop-pareto` · **R4** `runs` · **R5** `run-hours` · **R6** `stops?classified=1` · **R7** `seals` | tek bir alan bile değişirse kırmızı |
| **TELEMETRİ** (değişebilir, ama **DÜRÜSTÇE**) | **T1** `intervals` · **T2** `dashboard` · **T3** `stops?classified=0` | cevap `ApiResponse.warnings` taşır ve **budanmış pencerede `null` döner, `0` DEĞİL** — "veri yok" ile "sıfırdı" aynı sayıya çökerse kullanıcı boş pencereyi %0 randıman sanar |

**② AST TRIPWIRE — `scripts/loom-telemetry-ast-tarama.ts`, dört kural.** ⓐ `prisma.machineInterval` delegate'i **yalnız beş dosyada** geçebilir (ingest servisi · mühürleyici · retention helper · pano servisi · bekçinin kendisi); ⓑ sebepsiz duruş yüklemi **yalnız üç dosyada**; ⓒ `PRUNABLE_STOP_WHERE` (Prisma parçası) ↔ `isPrunableStop()` (bellek-içi yüklem) **boğaz-ikizdir** ve birlikte değişir; ⓓ rapor servisleri (R1–R7) allowlist DIŞINDADIR — bir defter raporu telemetri delegate'ine dokunamaz. **Envanter İKİ YÖNLÜDÜR:** listede olup artık var olmayan dosya da kırmızıdır (ölü muaf, gerçek ihlali sessizce kapsam dışında tutar).

**③ RETENTION'IN DOKUNAMAYACAKLARI.** Budayıcı **açık koşumun** penceresine, **açık vardiyaya** ve **mühürsüz pencereye** DOKUNMAZ. Açık koşum süresiz bir budama muafiyeti üretmesin diye kardeş kural: **`tezgah.maxOpenRunDays` (7) aşan koşum watchdog ile kapanır** (`endedAt` beyan edilir, terimler donar) — aksi hâlde unutulmuş tek bir açık koşum, kendi penceresini sonsuza kadar budanmaz kılardı.

**③b MÜHÜR VARDİYA×MAKİNE DÜZEYİNDE ATOMİKTİR — kısmi mühür YOKTUR** (2026-09-12, §10/#23). `MachineShiftStat`ın unique'ine `productionLineNo` girdiği için bir vardiya×makine artık **N karne satırıdır** ve mühür satır başına verildiğinden **N bağımsız mühür** doğar. Hat 1 mühürlenip hat 2 mühürsüz kalırsa ③'ün *"mühürsüz pencereye dokunmaz"* kuralı o pencerenin **yarısını korur, yarısını budar** — sonra hat 2'nin karnesi yeniden hesaplandığında **değişir.** Tam kaçınmak istediğimiz sürüklenme, yalnız hat ekseninde. Bu yüzden:
- Mühürleyici (Faz 1a insan, Faz 2 `machine-shift-close.job`) bir vardiya×makinenin **bütün hat satırlarını TEK TX'te** mühürler.
- **Budayıcının yüklemi hat başına değil PENCERE başına sorar:** *"bu (machineId, shiftInstanceId) penceresinin HER hattı mühürlü mü?"*

> ⚠️ **Bu boşluk `productionLineNo` olmadan YOKTU — tasarımın kendi ürünüdür.** Genel kural (2026-09-12): **bir tasarım bir TANECİĞİ ya da bir ANLAMI böldüğünde, ona dayanan HER yüklem ve HER formül yeniden sorulur.** `productionLineNo` bir unique'i böldü; mühür yüklemi de onunla bölündü ve bu **sessiz** olurdu.

**④ NEGATİF SONDALAR — sekizi de KIRMIZI GÖRÜLEREK yazılır.** **N1** breakdown satırı silinir → kırmızı · **N2** budama yükleminden mühür koşulu düşürülür → kırmızı · **N3** yüklemden sebep/insan-kararı koşulu düşürülür → kırmızı · **N4** koşum kapanışı atlanır (terimler donmaz) → kırmızı · **N5** açık koşumun penceresi budanır → kırmızı · **N6** manifestte olmayan bir `GET` ucu eklenir → kırmızı · **N7** T1 cevabından `warnings` kaldırılır (ya da boş pencerede `0` döndürülür) → kırmızı · **N8** allowlist dışı bir dosyaya `machineInterval` delegate'i konur **ve** listeye ölü bir muaf bırakılır → kırmızı · **N9** iki hatlı makinede yalnız BİR hat mühürlenir, budayıcı koşturulur → kırmızı ("kısmi mühürlü pencere budandı").

> ⚠️ **N9'UN GEREKÇESİ ÖLÇÜLMEDİ ve bu başlığa yazılır.** *"Bu sonda doğduğu gün gerçek bir kusur yakalıyor mu?"* sorusunun cevabı **HAYIR** (ölçüldü 2026-09-12): `productionLineCount` varsayılanı 1, sahada çok hatlı makine yok, tezgah altyapısı tümüyle kâğıtta ⇒ tüm makineler tek hatlıyken vardiya×makine başına **tam bir** karne satırı olur ⇒ *"kısmi mühürlü pencere"* durumu **ERİŞİLEMEZ** ve satır-kapsamlı ile pencere-kapsamlı yüklemler **aynı davranır**. **N9 yine de SİLİNMEZ:** bir sondayı "bugün bir şey yakalamıyor" diye silmek, **yarının kusurunu bugünün sessizliğiyle takas etmektir.**
>
> **Ama N9 tek başına bırakılmaz.** Kusurun doğuş sırası şudur: budayıcı Faz 2'de **doğal olan** satır-kapsamlı yüklemle yazılır, kusur ancak Faz N'de ikinci hat gelince doğar, ve o gün bu kararı kimse hatırlamaz — N9 o güne kadar **uyur**. Ve bir sonda koruduğu şey henüz doğmamışken uyuyorsa, **doğduğu gün de uyuyor olabilir**, çünkü aradaki zamanda kimse onu ölçmemiştir.
>
> **P-YAPI (N9'un tamamlayıcısı, BUGÜN silahlanır):** budayıcının yüklemi mühürlülüğü **(machineId, shiftInstanceId) PENCERESİ** düzeyinde sorar — satır düzeyinde değil — ve bekçi bunu **yüklemin ŞEKLİNDEN** ölçer (gruplama / `NOT EXISTS` kalıbı), veri davranışından değil. Budayıcı **yazıldığı AN silahlanır** ve tek hatlı dünyada da kırmızı verebilir.
> **İş bölümü: P-yapı yanlış yüklemin YAZILMASINI, N9 DAVRANIŞINI yakalar.** İlki bugün, ikincisi ikinci hat geldiği gün.
>
> **P-yapının İKİ ŞARTI** (ikisi de yapısal sondaların kendi zaafına karşı):
> 1. **P-yapının KENDİ negatif sondası olur** — yüklem bilerek satır-kapsamlı yazılır, P-yapının kırmızı verdiği ölçülür, geri alınır. Gerekçe: **yapısal sondalar (AST/desen tabanlı) sessizce silahsızlanmaya en yatkın türdür**; deseni eşleşmeyen bir tripwire kırmızı vermeden korumayı bırakır (emsal: §3.4 birim seddi). P-yapı, N9'un *uyuma* riskini kapatırken kendi *sessiz ölüm* riskini getirir — ikisi birbirinin panzehiri değildir.
> 2. **P-yapı NEYİ KABUL ETTİĞİNİ başlığına yazar:** *"bu kalıp dışında bir doğru çözüm bulursan sondayı GÜNCELLE, SUSTURMA."* Aksi hâlde biri doğru bir refactor yapar, sonda kırmızı verir ve **sonda kaldırılır** — kapının birinci ölüm biçimi.
>
> ⚠️ **Yapısal sondanın bedeli açıkça yazılır:** davranışsal sonda *sonucu* ölçer, biçime kayıtsızdır; yapısal sonda *biçimi* ölçer ve bu yüzden **meşru varyantları da reddeder.** Aldığımız erken silahlanma, verdiğimiz biçim özgürlüğü. Bu yüzden kural dardır: **yapısal sonda her yerde değil, yalnız davranışın bugün ölçülemediği yerde kurulur.**

**Mutabakat bekçisi kapsamı:** değişmez **`Σ observedSec + unobservedSec = calendarSec`**tir — eski *"Σ kova süresi = takvim"* biçimi `unobservedSec > 0` olan **her** vardiyada tanımı gereği kırmızı verirdi (§5.1). Eşitlik yalnız **retention penceresi içindeki** vardiyalar için ölçülür ve körlük zemini basılır (kaç vardiya ölçüldü — *"0 bulgu ≠ hiç bakılmadı"*). Pencere dışı için kovadan bağımsız ikinci değişmez: `Σ MachineShiftStopBreakdown.stopSec + minorStopSec ≤ potSec`.

**Koşum ekseni kovadan bağımsızdır:** `MachineRun` budanmaz ama içinde üretim terimi yoksa boş kabuktur — bu yüzden koşum kapanışında `picksAtClose`/`producedM`/`observedSecAtClose` **ve `stopSecAtClose`/`stopCountAtClose`** donar (§2.8). Duruş terimleri sonradan eklendi ve gerekçesi ölçülmüştür: sebepsiz duruş budandığında **koşum düzeyi duruş da ölüyordu** — karne ekseni vardiya×makine olduğu için *"bu iş emri adımında kaç kez, kaç saat durduk"* sorusunu karne cevaplayamaz. Tek yazar `closeMachineRunTx`, atomik claim `WHERE closedTermsAt IS NULL`. Retention penceresinden sonra koşum ekseninin HER sorusu **koşumun kendi terimlerinden** cevaplanır, kovadan değil. `test_machine_prune_safety`nin **DÖRDÜNCÜ AYAĞI** tam olarak budur: **budamadan önce ve sonra koşum üretimi VE duruş terimleri AYNI** (§4 madde ① ④).

---

## 5 · Randıman

### 5.1 · Zaman modeli ve duruşun vardiyaya PAY EDİLMESİ

```
takvim (ShiftInstance penceresi)
 ├─ unobservedSec      ajan sustu, GÖZLENMEDİ            → POT DIŞI, AYRI raporlanır
 ├─ NON_SCHEDULED      sipariş yok / vardiya planlı değil → POT DIŞI
 ├─ plannedBreakSec    planlı mola (bayrağa göre)         → POT DIŞI/İÇİ
 └─ POT = Planlanan Üretim Süresi
      ├─ SETUP             levent bağlama · tahar · tarak · desen değişimi
      ├─ PLANNED down      planlı bakım, temizlik
      ├─ UNPLANNED down    arıza, kopuş sonrası bekleme, operatör yok
      └─ APT = fiili çalışma   ← MİKRO DURUŞ BURADA KALIR
```

> **⚠️ Denetim düzeltmesi (çürütme izi merceği, KRİTİK).** Sentez kovanın iki vardiyaya bölünmemesini garantiliyordu ama **duruş span'i için hiçbir kırpma kuralı yoktu**: 23:50'de başlayan 12 saatlik bir duruş tümüyle ilk güne yazılır, o günün duruş toplamı 24 saati aşar ve **kullanılabilirlik negatif çıkar.** Tasarım turunun kendi kararı sentezde düşmüştü.
> **Kural:** `MachineStopEvent` **olayın gerçeğini** tek satırda tutar (`startedAt`/`durationSec` kırpılmaz, `factoryDay` doğuşta donar); **karne terimleri span'den değil, vardiya penceresine KIRPILMIŞ saniyeden toplanır.** Faz 2'de taşıyıcı `MachineInterval.stopSec`tir (kova zaten vardiya sınırının katı, §2.6); Faz 1a'da (kovasız) kırpmayı mühürleyici yapar ve `shift-resolve.helper`in ikizi olarak **tek helper'da** yaşar. Değişmez: `Σ(kova/karne stopSec) = Σ(span durationSec ∩ vardiya penceresi)` — bekçi `scripts/test_machine_shift_terms.ts`.

> **⚠️ `unobservedSec`in TÜRETME KURALI (Fable D3, KRİTİK).** Dört ayrı bölüm bu terimin *ne olduğunu* söylüyordu, hiçbiri *nasıl hesaplandığını* söylemiyordu — ve ajan sustuğunda kova satırı da doğmadığı için toplanacak `observedSec` hiç yoktur.
> **Kural:** `unobservedSec = calendarSec − Σ(MachineInterval.observedSec ∩ vardiya penceresi)` — **ARTIK yöntemiyle** hesaplanır, heartbeat aralığından DEĞİL; hiç kova doğmamış pencere bu farkta kendiliğinden görünür. **Heartbeat bir KAYNAK DEĞİLDİR**: nabız ajanın canlılığını söyler, kovanın gözlenmişliğini değil; ikisini karıştırmak "ajan ayaktaydı, demek ki ölçüyordu" yalanını üretir.
> **Kova içi tutarlılık satır yazılırken zorlanır** (DB CHECK, §2.6): `runSec + stopSec + minorStopSec ≤ observedSec ≤ bucketMinutes × 60`. Üst sınır olmadan bir ajan hatası kovaya kova boyundan uzun gözlem yazar ve `unobservedSec` **negatife** düşerdi.
> **MUTABAKATIN DOĞRU BİÇİMİ `Σ observedSec + unobservedSec = calendarSec`tir**, *"Σ kova = takvim"* DEĞİL — ikincisi `unobservedSec > 0` olan her vardiyada tanımı gereği kırmızı verir (§4).
> **COLLECTOR_GAP'in iki yüzü ve `gapPicks`:** ajan sustuktan sonraki ilk kova `GAP` damgalanır; sayaç o sürede ilerlemiştir ve fark ilk kovada **sıçrama** olarak gelir. Karar **terimi ikiye ayırmaktır**: sıçrayan atkı `gapPicks` kolonuna yazılır (§2.10) ve **metre onu İÇERİR** (kumaş gerçekten dokundu, `Roll` bir gün o metreyi gösterecek), **randımanın PAYINDAN DÜŞÜLÜR, PAYDAYA HİÇ GİRMEZ** (`picksActual − gapPicks`; o sürenin karşılığı `unobservedSec`tir ve POT'tan zaten düşüldüğü için paydada hiç doğmaz — sıçramayı P'ye saymak gözlenmemiş süreyi ödüllendirir, saymamak ise üretimi yok sayar; tek sayı ikisini birden yapamaz).
> **Faz 1a'da `unobservedSec = 0`dır ve bu bir BEYANDIR:** telemetri yoktur, gözlemci İNSANDIR ve elle girilen karnede gözlem eksikliği değil **vardiya beyanı** vardır (`source` kolonu ayrımı zaten taşır). Aksi hâlde takvim kadar `unobservedSec` yazılır ve **POT = 0** çıkardı.

### 5.2 · Formül

```
POT = takvim − unobservedSec − NON_SCHEDULED − (breakOutOfPot ? plannedBreakSec : 0)
APT = POT − SETUP − PLANNED − UNPLANNED            ← MINOR DÜŞÜLMEZ

A (Kullanılabilirlik) = aptSec / potSec
P (Performans)        = (picksActual − gapPicks) / targetPickCapacityApt   ← mikro duruş burada erir
RANDIMAN (E)          = (picksActual − gapPicks) / targetPickCapacityPot

  ⚠️ gapPicks = ajan susmuşken sayacın ilerlediği, ilk kovada SIÇRAMA olarak gelen
     atkı. PAYDAN DÜŞÜLÜR, PAYDAYA HİÇ GİRMEZ (karşılığı unobservedSec'tir ve
     POT'tan zaten düşülmüştür); METREYE DAHİLDİR (§5.6 — kumaş gerçekten dokundu).

  targetPickCapacityApt = Σ(koşum_i.targetPicksPerMin × koşum_i'nin APT dakikası)
  targetPickCapacityPot = Σ(koşum_i.targetPicksPerMin × koşum_i'nin POT dakikası)

teknikRandıman        = APT / (APT + UNPLANNED)    ← tezgah panolarının "efficiency"si
Q, OEE                = AYRI ve SONRADAN (kalite kararı Tambur'da, günler sonra)
```

**Sektörde "randıman" = A × P'dir, OEE değil** ve klasik dokuma tanımı (gerçekleşen atkı ÷ teorik atkı) de tam olarak budur.

> **⚠️ PAYDA VARDİYA İÇİNDE DEĞİŞEBİLİR (Fable D2, KRİTİK).** Karne taneciği vardiya×makine, ama §2.8 *"hedef değişirse koşum kapanır"* diyor ve `DESEN_DEGISIMI` bir SETUP kodudur — yani **bir vardiyada iki koşum NORMALDİR**. Tek bir `targetPicksPerMin` donduran karne hangi hedefi seçerse seçsin P'yi yanlış üretirdi; ikisini ortalamak ise §5.3/4'ün kendi yasağı ("oranlar ortalanmaz, helper yüzde dizisi kabul etmez").
> **Karar:** payda bir ORAN değil bir **TERİMDİR** ve toplanır (`targetPickCapacity…`, §2.10); `targetPicksPerMin` yalnız TEK koşumlu vardiyada raporda gösterilecek **etikettir** (birden çok hedefte NULL).
> **Kimlik sınırı dürüstçe yazılır:** `E = A × P` **tek hedefli** vardiyada birebirdir (bekçi bunu ölçer: tek hedefli fixture'da `|E − A×P| = 0`). Birden çok hedefte fark, hedeflerin POT ağırlıklı dağılımından doğar; rapor E'yi **kendi tanımından** (`picksActual / targetPickCapacityPot`) okur, **çarpımdan değil**. Tek terim kullanmak P'yi E'ye çökertirdi — aynı paydayla bölünen iki oran aynı sayıdır.

> **⚠️ Standart etiketi düzeltildi (ölçek merceği B6).** Sentez *"ISO 22400-2'deki adı **Effectiveness**"* diyordu; ISO 22400-2'de `OEE = Availability × Effectiveness × Quality` ve **Effectiveness performans bileşenidir (≈ bizim P'miz), A×P değil.** Çürütme ajanı da aynı hatayı "sağlam" diye onaylamıştı. Rapor başlığına basılacak doğru cümle: *"Randıman = A × P (kalite hariç). ISO 22400-2 karşılığı: OEE = A × E × Q; bizim P ≈ ISO Effectiveness, bizim E ≠ ISO Effectiveness."* **Sayı doğru, yalnız etiket yanlıştı.**

Dokumada `P` tipik olarak 0,97–1,00 bandındadır (tezgah durunca atkı atmaz → her duruş A'ya düşer) — **saha doğrulaması**, bant pilotta ölçülür. **`P > 1` bir hata değil, bir VERİ HATASI SİNYALİDİR** — `targetPicksPerMin` yanlış girilmiştir; rapor `warnings` basar, otomatik düzeltme YAPMAZ.

### 5.3 · Nerede hesaplanır

> **Terimler SAKLANIR, oran TEK helper'da TÜRETİLİR, mühür anında oran DENORMALİZE edilir.**

1. `MachineShiftStat` yalnız **terimleri** tutar (saniye ve atkı).
2. `src/services/helpers/loom-efficiency.helper.ts` → `computeMachineKpis(terms)` **TEK yazar ve TEK okuyucudur.** AST tripwire: `src/` içinde `picksActual /` ya da `aptSec /` aritmetiği başka dosyada geçemez.
3. Mühür anında oranlar + `formulaVersion` satıra yazılır. Denormalize güncel değer meşrudur, **koşulu TEK YAZAR olmasıdır**; ikinci bir yazma yolu açmak (servis içinden doğrudan yazım dahil) "tek kaynak satır" sınıfını kırar ve bekçi bunu AST ile ölçer. *(`Sack.weightKg ↔ SackWeighing` EMSAL DEĞİL UYARIDIR — §2.10.)*
4. **ORANLAR ASLA ORTALANMAZ.** Haftalık/tezgah-üstü randıman `avg(effectivenessPct)` **değil** `Σpicks / Σ(target × POT)`. Helper **yüzde dizisi KABUL ETMEZ**.
5. `formulaVersion` değişirse **geçmiş mühür DEĞİŞMEZ**; yeni sürüm yeni vardiyalardan geçerlidir.
6. **Sınıflandırılmamış süre `UNPLANNED` sayılır** (fail-closed: bilinmeyen rakamı şişirmez, düşürür) **ve** `unclassifiedSec` ayrıca döner + `warnings` yazılır. `stopLossClass IS NULL` de aynı muameleyi görür — yüklem `IS NOT TRUE`/`COALESCE` ile **kötümser** kurulur.
   > **İSTİSNA — "gözlendi ama hiç üretim yok" ≠ "gözlenmedi".** `SIPARIS_YOK` bir SEBEP KODUDUR ve sınıflandırılmadan `UNPLANNED` sayılır: 8 saat boş duran bir tezgah, vardiya bitmeden sınıflandırılmazsa **%0 randımanla mühürlenir** ve düzeltmesi `loom:shift-unseal` ister — amire her vardiyada, her boş tezgah için zorunluluk çıkar. **Kural:** `observedSec ≈ calendarSec` **VE** `picksActual = 0` **VE** vardiyada hiç açık koşum yoksa, mühürleyici süreyi `nonScheduledSec`e yazar ve `source = INFERRED` damgalar (tezgahın boş durduğu **ÖLÇÜLMÜŞTÜR**, varsayılmamıştır); rapor bunu ayrı satırda beyan eder ve amir mühür öncesi tek tıkla `UNPLANNED`a çevirebilir. Ajan susmuşsa (`observedSec ≈ 0`) bu kural **UYGULANMAZ** — o süre `unobservedSec`tir.
7. **SIFIR PAYDA SÖZLEŞMESİ: `computeMachineKpis` sıfır döndürmez, `null` döndürür.** `POT = 0` (iptal vardiya) → `A = P = E = null`; `APT = 0` (tam duruş) → `P = null`, `A = 0` (gerçek: hiç çalışmadı). `null` "ölçülemedi"dir ve toplamada **PAYDAN DA PAYDADAN DA** dışlanır; toplayıcı kaç vardiyanın dışlandığını döner ve rapor bunu körlük zemini olarak basar (*"N vardiya ölçülemedi"*). Yüzde dizisi kabul edilmediği gibi, **`null`ı 0 sayan çağrı da AST tripwire ile yasaklanır** — aksi hâlde iptal vardiyalar haftalık randımanı sessizce aşağı çeker.
8. **GÖLGE MOD BİR KOLON + KAPIDIR, bir reçete cümlesi değil.** Kolon `MachineSpec.monitoringState` (**OFF → SHADOW → LIVE**, varsayılan OFF = bugünkü davranış, §2.3); kapı `POST /specs/:id/go-live`ın üç şartıdır. **`SHADOW` tezgahın kovası ve duruşu YAZILIR ve karnesi NORMAL MÜHÜRLENİR** — mühürlememek, gölge dönemi ölçülemez kılar ve kabul kapısının ② numaralı şartını (*"15 mühürlü gölge vardiya"*) imkânsızlaştırırdı. Ayrım YAYINDA yapılır: **DEFTER raporları (R1–R5) varsayılan olarak `monitoringState = LIVE` süzer**; gölge karneler yalnız **"Devreye Alma" sekmesinde** (`loom:spec-manage`) görünür ve dışa aktarımda her satır **GÖLGE damgası** taşır. Süzme karnenin **DONMUŞ** `MachineShiftStat.monitoringState` kolonundan yapılır, canlı künyeden değil (§2.10): gölge karne LIVE'a asla terfi etmez. Yüklem `loom-efficiency.helper`in **boğaz-ikizi** olarak TEK helper'da yaşar ve AST tripwire ile korunur. Bekçi **`test_machine_shadow_mode`** (§9).

### 5.4 · Devir ve kopuş KPI'ı

| | Nerede | Neden |
|---|---|---|
| **Anlık devir** | `MachineLiveState.instantPicksPerMin` — tarihçe YOK | 10 sn'lik anlık devir gürültüdür; yılda 63 M satır eder |
| **Ortalama (çalışırken)** | türetilir: `(picksActual − gapPicks) / APT_dk` | sayaçtan çıkar, örnekleme hatası yok, toplanabilir; `gapPicks` **paydan düşülür** (§5.2) |
| **Ortalama (genel)** | türetilir: `(picksActual − gapPicks) / POT_dk` | **Kimlik: `randıman = avgOverallPicksPerMin / targetPicksPerMin`** (ikisi de **atkı/dk**; `Rpm` adı devir/dk ile karışıyordu — §3.4 birim seddi). ⚠️ **Kimlik YALNIZ TEK HEDEFLİ vardiyada birebirdir:** birden çok koşum/hedef varsa `targetPicksPerMin` **NULL**'dur (§2.10) ve E bu kimlikten DEĞİL **kendi tanımından** okunur — `(picksActual − gapPicks) / targetPickCapacityPot` (§5.2) |
| **Hedef** | `MachineRun.targetPicksPerMin` — SAKLANIR | randımanın paydası; işin özelliği, tezgahın değil |
| **Kopuş yoğunluğu** | `kopuş/10⁵ atkı = (warpStopCount \| weftStopCount) × 100000 / picksActual` | ⚠️ payda ATKIDIR, saat değil — saat bazlı sayım yavaş koşan tezgahı ödüllendirir. **Pay ya da payda NULL ise KPI HESAPLANMAZ** ve rapor "ölçülemedi" der (kanalsız retrofitte sayaç NULL'dır, 0 değil — §2.6) |

> ⚠️ **SAYAÇ TÜM SLOTLARI TOPLAR — ve bu düzeltilmiş bir GİZLİ HATADIR** (2026-09-12). `MachineInterval.warpStopCount` *"makinenin beyan ettiği kopuş adedi"* diye tanımlıydı ama **hangi slotlardan toplandığını söylemiyordu**, üstelik aynı belgede `slot = 1 kanoniktir` yazıyordu. İki `WARP_STOP` kanallı bir makinede (zemin + hav çözgüsü) bu ikisi birlikte okunursa **ikinci kanal sessizce sayılmaz: eksik sayım.** **Yeni kural:** *`slot` kanonikliği YALNIZ üretim sayacına aitti ve o da `productionLineNo`ya devredildi (§2.2b); kopuş ve duruş sayaçları aynı `kind`ın TÜM slotlarını TOPLAR.*
>
> ⚠️ **KIRILIM İÇİN KOLON ÇİFTİ AÇILMAZ.** *"İki çözgü varsa duruş hangisine yazılır"* sorusunun cevabı `warpStopCount1/2` DEĞİLDİR: tekil sayaç **makinenin toplamı** olarak kalır ve kırılım `MachineStopEvent.beamSlot`tan okunur (§2.7). Gerekçe ölçüldü — `warpStopCount`/`weftStopCount`un **dört okuyucusu** var: ① `MachineInterval` (ingest yazar) → ② `MachineShiftStat` (vardiya toplamı) → ③ bu KPI → ④ §11 gerekçe metni. Çoğullaştırsaydık ② ve ③ **toplam yerine birinciyi** okur, KPI **sessizce düşük** çıkardı — kırmızı vermeden yanlış sayı. Tekili bozmayıp kırılımı deftere koymak bu dördünden **hiçbirini değiştirmez**: tuzak yapısal olarak doğmaz. **N=1 birebir:** `beamSlot` her yerde NULL doğar, Pareto bugünkü gibi kırılımsız çizilir, formül harfi harfine aynı kalır.

> Kopuş KPI'ı denetimde geri getirildi (çürütme izi merceği, KRİTİK 4): 1 numaralı gereksinimin sektör ölçüsüdür ve terimleri karnede zaten var. **`ReasonPreset.stopCountsAsBreak` kolonu ise REDDEDİLDİ** — kopuş sayacı **makine sinyalinden** doğar (`MachineSignalKind.WARP_STOP`/`WEFT_STOP` → `MachineInterval.warpStopCount`), insan sınıflandırmasından değil; ikinci bir sayım yolu açmak aynı soruya iki cevap veren "çift yüklem" sınıfını üretirdi (§11).

### 5.5 · Çalışma saati

`baselineRunHours + Σ(MachineShiftStat.aptSec, baselineAt sonrası)`. **Artan sayaç kolonu YOK** — ikinci yazar olurdu. Formül defterin tam olmasına bağlıdır: ajan saatlerce susarsa eksik çıkardı — bu yüzden `unobservedSec` **ayrı** raporlanır ve "bilinmeyen, sıfır değil" olarak gösterilir.

> **⚠️ TOPLAM ÇALIŞMA SAATİ GERİYE DÖNÜK KAYABİLİR — bu bilinçlidir.** Sayı TÜRETİLMİŞTİR ve mühürlü kuşakların toplamıdır: bir vardiya **yeniden mühürlenirse toplam da DEĞİŞİR**, çünkü doğru rakam son kuşaktır ve değişimin izi `MachineShiftStatSeal`de durur. **Bu yüzden bakım periyodu / garanti eşiği bu türetilmiş sayıya BAĞLANMAZ**; eşik gerektiğinde o anın değeri ayrı bir damga satırına yazılır (Faz 3 kararı) ve rapor *"şu ana kadarki mühürlü gerçeğe göre"* ibaresini basar.

### 5.6 · Metre

**Metre TEK HELPER'dan ve TEK FORMÜLDEN doğar; makine sınıfına göre DALLANMAZ** (`machineRunLengthM` ↔ boğaz-ikizi `MACHINE_RUN_LENGTH_SQL`; 2026-09-12 düşmanca denetimi, §10/#22):

```
metre = sayaçDeltası ÷ (MachineRun.unitsPerCm × 100)
```

Birim iki yerde yaşar ve **ikisi de `machineClass` DEĞİLDİR**:
- **BİRİM SİNYALDE.** Sayacın ne saydığını `MachineSignalKind` söyler: `PICK_COUNTER` (atkı) · `COURSE_COUNTER` (sıra) · `RACK_COUNTER` (rack; 1 rack = 480 sıra çevrimi kanalın `scale`indedir, ayrı formül DEĞİL) · `FABRIC_LENGTH` (zaten metre, dönüşüm yok).
- **SIKLIK KOŞUMDA.** `MachineRun.unitsPerCm` — dokumada tezgah üstü HAM atkı/cm, örmede sıra/cm. **Kolon adı birimi söylemez, çünkü formül birimden bağımsızdır.**

⚠️ **Sınıf üstünde dallanmama kararı bilinçlidir:** `if (machineClass === WARP_KNIT)` bir `kind`-dispatch'tir (kök `CLAUDE.md` yasağı) ve sinyal ile sınıf ayrışırsa *"hangisi kazanır"* sorusunu doğurur — çift yüklem sınıfı. Tek yüklem: **sayaç ne diyorsa o.**

⚠️ **`FABRIC_LENGTH` enum'da baştan beri VARDI ama hiçbir formülde kullanılmıyordu** (ölçüldü 2026-09-12). Makinenin kendi metre sayacı varsa **birinci tercih odur**: dönüşüm yapmaz, dolayısıyla sıklık sapmasını metreye yazmaz. `unitsPerCm` NULL ise **metre üretilmez**, randıman yine hesaplanır (eski `unitsPerCm` NULL kuralı aynen geçerli, yalnız adı genelleşti).

Ve türetilen bu metre **ÇÖZGÜ/HAM metredir**, mamul değil. ⚠️ **Metre `gapPicks`i İÇERİR** (randıman onu dışlar, §5.2): ajan susmuşken dokunan kumaş gerçektir ve bir gün `Roll` ölçümünde görünecektir; metreden düşmek, sayaç ile top arasındaki farkı yapay olarak büyütürdü. `unitsPerCm` **TEZGAH ÜSTÜ (HAM) atkı/cm**'dir; mamul (bitim sonrası) metre `× (1 − takeUp)` ile AYRI bir büyüklüktür ve **bu belgede HESAPLANMAZ** (take-up kumaş teknik kartının işi — `docs/design/DEVERE-LEVENT-TARAMASI.md` §4.8: *"Leventin metresi çözgü metresidir, kumaş değil. Aynı kolonda iki anlam yaşayamaz"*). İki anlam aynı kolonda yaşayamaz; mamul metre gerektiğinde ayrı kolon + ayrı helper açılır. `unitsPerCm` NULL ise **metre üretilmez**, randıman yine hesaplanır. Vardiyada **birden çok koşum** varsa metre koşum bazında türetilip toplanır (`unitsPerCmAtClose` NULL kalır, §2.10).

> ⚠️ **SAYAÇ ASLA STOK YAZMAZ.** Türetilen metre bir TAHMİNDİR; tek miktar gerçeği `Roll` ölçümüdür. Sayaçtan türeyen metre ile ölçülen `Roll` metresi asla birebir tutmaz (çekme, atkı sıklığı sapması, kenar fire — **saha doğrulaması**: %2–5 bandı pilotta ölçülür). Bu kural yazılı olmazsa birileri "sayaçtan otomatik top açalım" der ve tek-kaynak disiplini çöker.
>
> ⚠️ **`unitsPerCm`in evi bugün YOK** (kod gerçekliği merceği O4): `ProductRecipe`te atkı/cm kolonu yoktur (`schema.prisma:1332` — alanlar `code · name · itemId · colorId · width · foldType · routeId · isActive`) ve `FabricProperty` **SEÇİM** kataloğudur, sayısal değer taşıyamaz (*"SEÇİM tipli özelliğin değeri `RollProperty`ye YAZILMAZ… değer kaydın KENDİ kolonunda durur"*).
> **Kalıcı ev `ProductRecipe` DEĞİLDİR** — kardeş belge bunu ölçerek reddetti (`DEVERE-LEVENT-TARAMASI.md` §3.4: sıklık **renge/desene** bağlıdır, reçeteye konursa kopya doğar). Faz 1-2'de değer yalnız `MachineRun.unitsPerCm`e **elle** girilir; kalıcı ev açıldığında kaynağı **çözgü/desen kartıdır** (`WarpSpec` ailesi, devere belgesi) ve **SERT bağımlılık yine EKLENMEZ**: NULL ise metre üretilmez, randıman hesaplanır. Karar §10/#9.

---

## 6 · Bayraklar, kapı, izinler, panel zinciri

### 6.1 · Modül anahtarı ve adlandırılmış kapı

**Anahtar zaten var ve açılmıyor:** `tezgah.enabled` / `tezgahEnabled` (`src/constants/module-flags.ts:40,52`), varsayılan **false**, bağımlılığı `productionEnabled` (`:78`). `if (musteri === 'X')` gerekmiyor.

**"Varsayılan = bugünkü davranış" ÖLÇÜMÜ (K2/K3 şartı) — iki bağımsız yoldan:**
- **Profil yolu:** `tezgah.enabled` **ALTI** yerleşik profilin **DÖRDÜNDE kapalı** (`basit` · `standart` · `perde` · **`perde-dokuma`**), **İKİSİNDE açık** (`dokuma` · `tam`) — `src/constants/module-profiles.ts:32` (profil kimlikleri), `:125-199`. *(Sentez "üç profilden ikisi" diyordu; sonra "beş profilin üçü" yazıldı — ikisi de bayat: `perde-dokuma` 2026-09-12'de doğdu ve tezgah izleme orada bilinçli olarak KAPALIDIR, §7.2.)*
- **Canlı kurulum yolu — asıl kanıt:** profiller yalnız TAZE kurulumda koşar (`jobs/module-profile.job.ts`: `TEKSERP_PROFIL` yoksa hiç yazmaz, satır varsa dokunmaz). adnansahin'de değer profilden değil **grandfathering damgasından** gelir ve `false`'tur: `prisma/migrations/20260902230000_modul_anahtarlari_grandfathering/migration.sql:63` → `('tezgah.enabled','false'::jsonb, …)`. Satır silinse bile `readTezgahEnabled` `asBoolean` ile **false** döner (`system-setting.service.ts:57-61`, `:3602`).

**Adlandırılmış kapı:** `requireTezgahEnabled` (`module.middleware.ts` — `requireIplikEnabled`ın bağımlılık dalıyla aynı şekilde `tezgah → production` ön koşulunu ölçer). Jenerik `requireModule("tezgah")` **YASAK** (`:19-23`).

> **⚠️ Denetim düzeltmesi (kod gerçekliği O2).** Sentez *"aynı dosyadaki BİLİNÇLİ KAPISIZ listesi de dokunulur, yoksa `test_production_regime_gate` ölü satır sayar"* diyordu — **yanlış bekçi.** O liste **üretim kapısının** defteridir (`module.middleware.ts:25-42`, `test_production_regime_gate.ts:77`); `/api/tezgah/*` router'ları kendi kapısını taşır, o listeye satır eklemez ve hiçbir satırı öldürmez — **o listeye DOKUNULMAZ.** Yeni kapının kaydedileceği yer `scripts/test_feature_flag_contract.ts:789` `REGIME_GATES`tir: `{ middleware: "requireTezgahEnabled", selfGate: "readTezgahEnabled(" }`. Satır yazılmazsa §14 rejimi hiç ölçmez ve ölü-satır kontrolü **tek yönlü** olduğu için (tablodaki her middleware bir route'ta geçmeli; tersi ölçülmez) **hiçbir bekçi eksikliği görmez.**

### 6.2 · Yer tutucu emekliliği — modülü AÇAN yol (K3'ün doğrudan konusu)

`tezgahEnabled` bugün **altı yerde** yer tutucu olarak donmuş. Faz 1a bittiğinde bayrak panelden açılabilmelidir; aksi hâlde K3'ün "aç kapat olacak" şartı karşılanmaz. **Altısı AYNI COMMIT'te değişir** (biri eksikse `tsc` TS2741/TS2322 ya da bekçi kırmızısı).

> **⚠️ BU TABLO SATIR NUMARASIYLA DEĞİL ANAHTAR ADIYLA OKUNUR.** Yer tutucu listeleri büyüyor (`devereEnabled` 2026-09-12'de araya girdi) ve numaralar tek commit'te kayıyor; çapa kayması bu tablonun **kronik** kusurudur. Harfiyen uygulanan bayat bir satır numarası **YANLIŞ satırı siler**: eski tablo `test_feature_flag_contract.ts:115`i gösteriyordu, oysa orası `kumasTeknikEnabled` muafıdır — uygulansa `kumasTeknik` muafı kalkar ve bekçi kırmızıya döner.
> **Bugünkü ölçüm (2026-09-12, doğrulama için — TALİMAT YİNE ADADIR):** `test_feature_flag_contract.ts` `PANEL_EXEMPT` bloğu `:101-118`, içinde **`:115` = `kumasTeknikEnabled`** (DOKUNULMAZ) ve **`:116` = `tezgahEnabled`** (silinecek satır). `screen-catalog.ts` `EKRANSIZ_MODULLER` `:384`te başlar; **kumasTeknik nesnesi `:385-390`**, **tezgah nesnesi `:391-396`** (silinecek olan bu). İki numara da tek commit'te kayar; çakıştığında **ada bak, numaraya değil**.

| # | Dosya → **anahtar/ad çapası** | Bugün | Faz 1a'da |
|---|---|---|---|
| 1 | `src/constants/screen-catalog.ts` → `EKRANSIZ_MODULLER` içindeki **`modul: "tezgahEnabled"` nesnesinin tamamı** *(ölçüm: `:391-396`; komşu kumasTeknik `:385-390`)* | muaf | **SİLİNİR** (ekran doğdu) |
| 2 | `scripts/test_feature_flag_contract.ts` → `PANEL_EXEMPT` içindeki **`tezgahEnabled:` anahtarlı satır** *(ölçüm: `:116`; `:115` kumasTeknik)* | muaf | **SİLİNİR** — komşu `kumasTeknikEnabled` satırına **DOKUNULMAZ** |
| 3 | `Electron/src/lib/module-flags.ts` → `MODULE_PLACEHOLDERS` *(ölçüm: `:90-93`)* | **iki eleman** (`kumasTeknikEnabled`, `tezgahEnabled` — ölçüldü 2026-09-12; `devereEnabled` bu listeye GİRMEMİŞ) | **tek elemana iner** |
| 4 | `Electron/src/lib/module-flags.test.ts` → `MODULE_PLACEHOLDERS` beklentisi | `[…,"tezgahEnabled"]` | beklenti `["kumasTeknikEnabled"]` |
| 5 | `Electron/src/pages/GeneralSettings/flag-modules.ts` → `HideableModule`ın `Exclude`'u *(ölçüm: `:65-68`)* | **ÜÇ anahtar**: `kumasTeknikEnabled \| tezgahEnabled \| devereEnabled` (ölçüldü 2026-09-12) | yalnız **`tezgahEnabled` çıkarılır**, diğer ikisi KALIR |
| 6 | `Electron/src/pages/GeneralSettings/settings-config.ts` → `SettingsModuleKey` | beş anahtar | **altıncı anahtar** + `modules` kategorisine toggle satırı (`defaultOn: false`, açıklamada `productionEnabled` bağımlılığı yazılı) |

Ek olarak: `settings-groups.ts` `SettingsModuleState`/`resolveSettingsModuleState` genişler; tezgah ayar kategorisi `moduleKey: "tezgahEnabled"` alır (**`regime` alanına ASLA** — `docs/kurallar/modul-bayrak.md`: *"`regime` yalnız `productionEnabled|financeEnabled` içindir, modül anahtarlarına genişletilmez, §14 kırmızı verir"*).

> **⚠️ İKİ AİDİYET KARIŞTIRILMAZ (yoksa 16 düğme adnansahin'in ayar ekranında belirir).** Modül **ŞALTERİNİN** kendi `FLAG_MODULE` aidiyeti **`"cekirdek"` KALIR** — bir şalter kendi modülüne ait sayılırsa kapatıldığı an **kendi satırını gizler** ve bir daha açılamaz (`flag-modules.ts` `FLAG_MODULE` bloğu). `cekirdek` olan **yalnız `tezgahEnabled` satırıdır**; §6.3'ün **16 DAVRANIŞ bayrağının** sahibi ise `tezgahEnabled`dir (eksikse TS2741) — sayı §6.3 tablosuyla birebirdir: üç bayrak eklendi, `stopMatchToleranceSec` DÜŞTÜ, **14 → 16** (§11c). Yani: şalter çekirdeğe ait, şalterin arkasındaki bayraklar modüle ait.

### 6.3 · Davranış bayrakları

> **⚠️ VARSAYILANIN EVİ OKUYUCUDUR** (`readTezgahXxx` içindeki `?? <varsayılan>` / `DEFAULT_` sabiti). `prisma/seed.ts` yalnız TAZE kurulumun fabrika farkını yazar ve **saha kurulumunda HİÇ koşmaz** (`kur.ps1` yalnız `migrate deploy`). Bu, iki boolean'ın adını tersine çevirmekten daha geniş bir kuraldır: aşağıdaki tabloda varsayılanı `false` OLMAYAN **on** bayrak var (`shiftDayAttribution` · `bucketMinutes` · `sampleRetentionDays` · `maxClockSkewSec` · `maxOpenStopHours` · `maxOpenRunDays` · `longStopThresholdSec` · `stopEventMinSeconds` · `shadowMinShifts` · `acceptanceMaxAnomalyPct`) ve satır yoksa `asNumber/asEnum(undefined)` **null** döner, bayrak sessizce 0/kapalı davranır. **Sayısal ve enum bayrakların fabrika değerleri OKUYUCUDA sabit olarak yazılır** (emsal `system-setting.service.ts:4473-4482 readFasonShrinkWarnEnabled`).

Bayraklar `prisma/seed.ts`in bayrak bloğuna da yazılır, **`MODULE_PROFILES.bayraklar`a GİRMEZ** (iki yazar olurdu; bugün altı profilde de boş — `module-profiles.ts:17-22`). Her biri `docs/RECETELER.md` § *Yeni feature flag / sistem ayarı* reçetesiyle açılır — **dosyanın listesi 18 maddelidir; skaler bir bayrakta gerçek adım ~8'dir** (`docs/RECETELER.md:85`), yani **16 bayrak ≈ 128 mekanik dokunuş**. **Faz 2/3 bayrakları AÇILANA KADAR YAZILMAZ.**

Alt reçeteler (sentezde eksikti): **enum bayrak** üçlü ister (type + değer dizisi + `DEFAULT_` sabiti + okuyucuda `includes` sigortası, adım 12); **sayısal bayrak** `numberFlags`/`defaultValue` satırı ve `<=0 → null` mı `null → fabrika varsayılanı` mı kararını taşır (adım 13); **modül altı her bayrak** `resolveTezgahXxx = tezgahAçık && bayrak` tek resolver'ından okunur (`docs/design/MODUL-BAYRAK-TASARIM.md` §3.6; `system-setting.service.ts` resolver bloğu); **tablet okuyacaksa** mobil ayna elle taşınır (adım 11, **mekanik bekçi YOK**).

| Anahtar | Faz | Varsayılan | Not |
|---|---|---|---|
| `tezgah.shiftDayAttribution` | **1a** | **START** (enum) | gece vardiyası BAŞLADIĞI güne (`time.ts` "01:30'da okutulan top BUGÜNDÜR" gerekçesi) |
| `tezgah.breakOutOfPot` | **1a** | **false** | mola POT'ta kalır → randıman düşer (muhafazakâr yön) |
| `tezgah.stopEventMinSeconds` | **1b** | **20** | eşik altı duruş defter satırı olmaz, kovada+karnede SAYILIR. ⚠️ Faz 1a'da YAZILMAZ: eşikleyeceği tablo (`MachineStopEvent`) **Faz 1b'de** doğuyor (§2.7, §9) — bayrak tablosuyla AYNI fazda açılır |
| `tezgah.sealAllowsUnackedAnomaly` | 2 | **false** | ⚠️ ad TERSİNE ÇEVRİLDİ (aşağıdaki kutu) |
| `tezgah.collectorPairingOptional` | 2 | **false** | ⚠️ ad TERSİNE ÇEVRİLDİ; `device.pairingRequired`in TERSİ davranış, bilinçli: tablet okur, toplayıcı DEFTERE YAZAR |
| `tezgah.bucketMinutes` | 2 | **15** | değişimi ileriye dönük (§3.5). ⚠️ **YAZIMI KAPILIDIR:** yeni değer AKTİF her `ShiftDefinition`ın `startMinute` ve `durationMinutes`ini bölmüyorsa **400** döner ve ihlal eden HER tanımı adıyla listeler (yıkıcı işlemde "etkilenen her kaydı listele"). Aynı doğrulama TERS yönde de koşar (`ShiftDefinition` yazımı yürürlükteki `bucketMinutes`e göre ölçülür); tek kaynak `assertBucketAlignment(bucketMinutes, definitions)` — iki yazar da onu çağırır (boğaz-ikiz). Tek yönlü doğrulama, bayrak 15→20 olunca "klipleme hiç doğmaz" değişmezini sessizce düşürürdü |
| ~~`tezgah.stopMatchToleranceSec`~~ | — | — | ⚠️ **DÜŞTÜ (2026-09-12):** duruş kimliği artık ajan üretimi `stopKey` token'ıdır, saat değil — tolerans penceresi gereksizdir ve her iki yönde de yanlış cevap veriyordu (§3.5a) |
| `tezgah.sampleRetentionDays` | 2 | **180** | budama penceresi — kısaltmak geri alınamaz, uzatmak serbest |
| `tezgah.simulatedDataEnabled` | 2 | **false** | kapalıyken `SIMULATED` kalem 400 |
| `tezgah.maxClockSkewSec` | 2 | **120** | ⚠️ **PAKETİ DEĞİL KALEMİ düşürür:** aşan kalem 400 `CLOCK_SKEW` ile `rejected[]`e yazılır, paketin kalanı işlenmeye devam eder (§3.5 — kalem bazlı cevap sözleşmesi) |
| `tezgah.maxOpenStopHours` | 2 | **12** | watchdog **GEÇİCİ** kapatması: `endedAt = startedAt + bu değer`, `endSource=WATCHDOG`, `provisionalEndedAt` damgalanır, karnede `watchdogSec` (§3.5) |
| `tezgah.maxOpenRunDays` | 2 | **7** | aşan **koşum** watchdog ile kapanır ve terimleri donar — açık koşum kendi penceresini süresiz budanmaz kılamaz (§4 madde ③) |
| `tezgah.shadowMinShifts` | 2 | **15** | `SHADOW → LIVE` kapısı ②: bu kadar MÜHÜRLÜ gölge vardiya yoksa **409 `SHADOW_TOO_SHORT`** ("14/15") |
| `tezgah.acceptanceMaxAnomalyPct` | 2 | **5** | `SHADOW → LIVE` kapısı ③: gölge dönemin anomali oranı bunu aşarsa **409 `SHADOW_ANOMALY`** |
| `tezgah.longStopThresholdSec` | 2 | **300** | üstü otomatik sınıflansa bile kuyruğa düşer |
| `tezgah.fineWindowUntil` | 2 | **null** | makine başına, KENDİLİĞİNDEN SÖNEN **TANI penceresi**: devreye almada 10 sn ham örnek kenarda tutulur ve panelde canlı gösterilir, **DB'ye yine yazılmaz**. ⚠️ **KABUL KAPISI DEĞİLDİR** — kapı `monitoringState` + üç şarttır (§2.3); bu bayrak yalnız kabul sırasında kanalı gözle görmenin aracıdır |
| `tezgah.shiftCloseRequiresClassification` | 3 | **false** | açıkken mühür, vardiyada **sınıflandırılmamış duruş varken** 409 + **etkilenen HER duruşu listeler**. ⚠️ Oran eşiği (`minClassificationPct` gibi İKİNCİ bir sayısal bayrak) **YAZILMAZ** — bu tablo 16 bayrağın tamamıdır ve çıkışsız bir kapıyı ikiye katlamak onu iki kez açılmaz kılardı. "Çıkışsız kapı üreten bayrak yazılır ama AÇILMAZ" — önce kuyruk ekranı doğar |

> **⚠️ Denetim düzeltmesi — fail-open iki bayrak (kabul/bayrak merceği, KRİTİK).** Sentez `sealRequiresAnomalyAck = true (fail-closed)` ve `collectorPairingRequired = true` yazıyordu. Ama `asBoolean(undefined) → false` (`system-setting.service.ts:57-61`) ve **saha kurulumunda seed HİÇ koşmaz** (grandfathering migration başlığı: *"`deploy/kur.ps1` seed'i HİÇ çağırmaz — yalnız `prisma migrate deploy`"*), davranış bayrakları profile de girmez. Sonuç: satır yok → `false` → **anomalili vardiya onaysız mühürlenir, toplayıcı eşleştirmesiz yazar.** Tam tersi.
> **Karar: ikisinin de adı tersine çevrilir ve varsayılanı `false` olur** — böylece "satır yok" hâli fail-closed'a düşer ve özel okuyucu sigortası gerekmez. `readProductionEnabled`ın açık `?? true` sigortası (`module.middleware.ts:150-159`) meşru bir emsaldir ama istisnadır; ad tersine çevirmek "bayrak adı yaptığı işi söyler" kuralıyla da hizalıdır. Panel `defaultOn` rozeti ile birebirliği `test_feature_flag_contract §12/§16` ölçer.

### 6.4 · İzinler

`permission-catalog.ts`e satır; **migration YAZILMAZ**, `jobs/permission-catalog.job.ts` uzlaştırır.

**İzin satırı ile rol şablonu satırı AYNI COMMIT'te yazılır**; yazılmazsa `test_role_template_catalog` §2 (*"her izin, Admin (Tam Yetki) DIŞINDA en az bir DAR rolde"*) anında kırmızı verir. Bu yüzden **dar rol sütunu boş bırakılmaz:**

| Kod | Kategori | Faz | Ne | **Dar rol (aynı commit)** |
|---|---|---|---|---|
| `loom:read` | web | 1a | pano · karne · randıman raporu | `WEB_PRODUCTION_SUPERVISOR` (+ varsa patron/görüntüleme şablonu) |
| `loom:manual-entry` | web | 1a | elle vardiya üretim/duruş girişi (mühür **ve `anomalyAck` onayı** dahil) | `WEB_PRODUCTION_SUPERVISOR` |
| `loom:spec-manage` | web | 1a | `MachineSpec` · vardiya kataloğu · **`OFF → SHADOW` ve `SHADOW → LIVE` geçişleri** · sebepli **demote** · (Faz 2: `PeripheralSignal` + `POST /signals/:id/accept`) · "Devreye Alma" sekmesindeki **gölge karneler** | master-data/yönetim şablonu |
| **`loom:shift-unseal`** | web | 1a | mühür açma — geçmiş rakamı değiştirir | `WEB_PRODUCTION_SUPERVISOR` (`roll:manual-adjust` ile aynı aile) |
| `loom:classify` | web | 2 | duruşa sebep atama (panel) | `WEB_PRODUCTION_SUPERVISOR` |
| `mobile:tezgah-durus` | mobile | 2 | duruşa sebep atama (tablet) | mobil operatör şablonu; yoksa **gerekçeli** `ROLE_COVERAGE_EXEMPT` |
| **`loom:collector-admin`** | web | 2 | toplayıcı onayı / token | yalnız `admin:*` taşıyan yönetim rolü |

> **⚠️ İki denetim düzeltmesi.**
> **(a) "SoD adayı" ibaresi KALKTI.** SoD üçlüsü (`shipping:invoice`, `shipping:undo-dispatch`, `roll:manual-adjust`) **sabit bir listedir** (kök `CLAUDE.md`, `docs/kurallar/yetki-izin.md`, `role-template-catalog.ts:326`, `test_boss_overview.ts:226`) ve bu tasarım ona dokunmaz. Karar: `loom:shift-unseal` → `WEB_PRODUCTION_SUPERVISOR` şablonuna (`roll:manual-adjust` ile aynı aile); `loom:collector-admin` → yalnız `admin:*` taşıyan yönetim rolüne (token dağıtmak altyapı yetkisidir).
> **(b) `loom:classify` "mobile + web" OLAMAZ.** `permission-catalog.ts` `category` alanı tekildir ve Prisma `PermissionCategory` enum'udur (`web|mobile|admin`); kataloğun mobil kalıbı ekran-kapsamlı ayrı kodlardır (`mobile:kk1`… `:208-243`, 19 satır) ve uçta `requireAnyPermission('<web>', '<mobile>')` ile birleşir. Mobil izin union'ı (`mobil` → `src/types/permissions.ts`) **elle** taşınır — mekanik bekçisi yoktur.

**Her yeni izin üç kalem ister:** `permission-catalog.ts` satırı · dar rol şablonu ya da gerekçeli `ROLE_COVERAGE_EXEMPT` (`test_role_template_catalog`: *"her izin en az bir DAR rolde"* + ölü-muaf kontrolü) · `screen-catalog.ts` ekran girdisi ya da gerekçeli `SCREENLESS_PERMISSIONS` (`test_screen_catalog.ts:443` *"ekranı beyan edilmeyen izin yok"*, `:447` ölü muaf).

### 6.5 · Panel yüzeyi (Electron) — dokunuş listesi

Sentezde hiç yoktu; kardeş belge (`docs/design/DEVERE-LEVENT-TARAMASI.md` §5) bunu doğru yapıyor.

- **Dokunulacak DOSYALAR (Faz 1a, iplik emsalinde sekiz dosya — "ekran" düzeyi yetmez):** `Electron/src/routes/content-routes.tsx` (route satırı) · `Electron/src/pages/Operations/tile-config.ts` (karo + bağlam alanı) · `Electron/src/components/layout/nav-config.ts` (`featureFlag` union'ı) · `Electron/src/pages/GeneralSettings/settings-config.ts` (toggle) · `Electron/src/lib/module-flags.ts` (`MODULE_PLACEHOLDERS`) · **`pages/MachineMonitor/machine-regime.ts`** (saf yüklem — iplikteki `Yarn/yarn-regime.ts` kalıbı; YENİ dosya) · sayfa bileşenleri · `Electron/src/types/enums.ts` + `ENUM_LABELS`.
- **Ekranlar (Faz 1a):** vardiya kataloğu · elle vardiya girişi · randıman raporu. **Tezgah künyesi AYRI EKRAN DEĞİL** — mevcut Makine formuna "Tezgah" bölümü olarak girer (palet/`def:station-capabilities` kalıbı), yeni route+karo+izin üçlüsü doğmaz.
- **`SCREEN_CATALOG` girdisi** her ekran için zorunlu (`modul: "tezgahEnabled"`, `requires: ["loom:read"]`, `capabilities: ["loom:manual-entry","loom:spec-manage","loom:shift-unseal"]`) — `ScreenEntry.modul` derlemede zorunlu alandır.
- **Karo `visibleWhen: tezgahEnabled`** ve manifesto `modul` alanı birebir (`test_screen_catalog §9c/§9e` iki yönlü). Karo döngüsü DIŞINDAKİ palet girdileri modül kapısını ELLE taşır.
- **Hazır Sebepler:** `KIND_TABS`e `MACHINE_STOP` sekmesi **yalnız `tezgahEnabled` açıkken** (§2.1).
- **Enum etiketleri:** `types/enums.ts` + `ENUM_LABELS` (bekçi şemadaki her enum değerini arar).
- **Mobil (Faz 2):** `reasonPreset.service.ts` kind union'ı + iki `Record` **ve `list()` çağrısının `?kind=` ile daraltılması** (§2.1 — bugün süzgeçsiz çekiyor, kapalı modülün kataloğu tablete iniyor); `mobil/src/hooks/useReasonPresets.ts` BUILTIN `Record` + `switch`; `featureFlag.service.ts` `tezgahEnabled` + `DEFAULT_FEATURE_FLAGS` yönü **fail-closed**; kuyruk ekranı `mobile:tezgah-durus` **ve** bayrak kapalıyken çizilmez (tablette `MODULE_DISABLED`ın kullanıcı yüzü hâlâ yok — `docs/kurallar/modul-bayrak.md`'nin açık maddesi; bu yüzden kapı istemcide de gerekir).
- **Bayat metin:** `modulKapali()` bugün *"Genel Ayarlar → Modüller bölümünden açılabilir"* diyor (`module.middleware.ts:80`) — oysa modül anahtarlarının tek evi 2026-09-04'ten beri **Sistem → Modüller**. Yeni kapı bu bayat adresi çoğaltacağı için metin aynı commit'te düzeltilir (alan dosyasındaki açık soru kapanır).

**Yetenek "VAR" sayılmak için üçü birden:** motor + en az bir çıkış yüzeyi + izin ataması. Faz 1a üçünü de taşır; ingest motoru tek başına "tezgah izleme geldi" diye duyurulamaz.

---

## 7 · Modül ilişkisi — `tezgah.enabled` ↔ `dokuma.enabled` / `devere.enabled`

### 7.1 · Üç anahtarın karar tablosu ve ad uzlaşması

Sentez bu soruyu hiç kurmamıştı (belgede `dokuma.enabled`/`devere` sıfır geçiş). K2 iki yeni bayrağı ve `devere→iplik`, `dokuma→devere` zincirini bağlayıcı sayıyor. Karar tablosu:

| Anahtar | Durum | Ebeveyn | Gerekçe |
|---|---|---|---|
| **`tezgah.enabled`** | **VAR** — bu tasarımın tek anahtarı | `productionEnabled` (**DEĞİŞMEZ**) | Tezgah izleme bir **MES/OEE katmanıdır**, dokuma üretiminin alt yeteneği değil: hazır levent alan bir perdeci tezgahını izleyebilir, donanımsız bir dokumacı izleme almadan dokuyabilir. Kodun kendi cümlesi de bu (`module-flags.ts:62-63`: *"Tezgah izleme üretimin bir alt yüzeyidir"* — ölçüldü 2026-09-12; eski `:60-61` çapası kaydı). |
| **`dokuma.enabled`** | **BU DİLİMDE AÇILMAZ** | (doğduğunda) `productionEnabled` | Dokuma ÜRETİM AKIŞI (rota/istasyon) bugün mevcut rota şablonuyla karşılanıyor — *"devere/çözgü/haşıl yeni mimari istemez; istasyon kataloğuna istasyon, rotaya adım eklenir"*. Yüzeyi olmayan anahtar **çıkışsız kapıdır**: yazılır ama AÇILMAZ. |
| **`devere.enabled`** | **DEVERE BELGESİNİN** | `iplikEnabled` (K2 aynen) | Çözgü hazırlama iplik kg defterini gerçekten tüketir. Ama tezgahın **kardeşidir**, ebeveyni değil: dokumacı devere yapmayabilir (hazır levent alır). |

**K2'den ölçülmüş sapma — `dokuma → devere` zinciri KURULMAZ.** `MODULE_DEPENDENCIES` bugün tek-ebeveynlidir ve `iplikEnabled: "ticaretEnabled"` (`module-flags.ts:77`; `tezgahEnabled → productionEnabled` `:78`, `devereEnabled → iplikEnabled` `:79` — ölçüldü 2026-09-12, eski `:68` çapası kaydı). `dokuma → devere → iplik → ticaret` zinciri yazılsaydı, **dokumayı açan her müşteriye ticaret modülü (alış siparişi · mal kabul · fiyat listesi · stok sayımı) zorla açılırdı** — bu K3'ün "onları zorlamayacak" şartını hedef müşteride ihlal eder. Zincir teknik olarak destekleniyor (`test_module_flag_off.ts:304-315` `bayraklariUygula` bağımlılık sırasını yürüyor — ölçüldü 2026-09-12); sorun teknik değil, **ticaretin sürüklenmesidir**. Bu yüzden `dokuma.enabled` doğduğu gün ebeveyni `productionEnabled` olur; iplik defteri gerekiyorsa `devere.enabled` AYRICA açılır ve ticareti o sürükler — açıkça, kullanıcının seçimiyle.

**Ad uzlaşması:** `tezgah.enabled` = **tezgah izleme** (telemetri/randıman, `MODULE_LABELS` metni bugün "Tezgah izleme"). `dokuma.enabled` = **dokuma üretim akışı**. İkisi aynı şey değildir ve K2'nin "dokuma bayrağı" dediği yetenek **bu dilimde `tezgah.enabled`tir** — yani bu dilim yeni anahtar borcu doğurmaz, K2'nin "ayrı bayraklar, varsayılan kapalı" şartı mevcut anahtarla zaten karşılanıyor.

### 7.2 · Hedef müşteri profili — KARAR KAPALI

**Bu tasarım profil içeriğini DEĞİŞTİRMEZ.**

⚠️ Sentez *"yeni `perde-dokuma` profili = production + finance + kumasTeknik + tezgah, `MODULE_PROFILES` 5 → 6"* diyordu. **Ölçüldü ve bayat:** profil **repoda ZATEN VAR ve commit'li** (`src/constants/module-profiles.ts:32` kimlik listesi, `:159` tanım; 2026-09-12) — içeriği `production` + `finance` + **`ticaret`** + **`iplik`** + `kumasTeknik` + **`devere`** ve başlığındaki yorum aynen şunu diyor: *"Tezgah izleme BU profilde KAPALI: 'top tezgahtan doğar' motoru **Faz 4**'te gelir."* Yani aynı ada iki uyuşmaz içerik ve tezgah bayrağı iki belgede ters yazılıydı.

**Karar:** `perde-dokuma`nın modül kümesi **BU BELGEDEN DEĞİŞTİRİLMEZ** — canlı bir profilin içeriğini değiştirmek sessiz bir davranış değişikliğidir. Tezgah izleme o profilde **bayrakla, kurulum başına** açılır ve profil satırına eklenmesi **AYRI bir karar notudur** (Faz 4). `MODULE_PROFILES` sayısı **6 olarak KALIR**; `test_module_profile` beklentisi de **6 profil**tir. Tezgahlı ayrı bir hedef satırı istenirse **YENİ AD** açılır (ör. `perde-dokuma-izleme`) — aynı ada ikinci içerik yazılmaz. Profil satırı **SEKİZ anahtarı da açıkça yazar** (`MODULE_SETTING_KEYS` bugün sekiz anahtardır — `production · finance · ticaret · iplik · depo.multi · kumasTeknik · tezgah · devere`; eski "yedi anahtar" ölçümü de bayattır), `bayraklar` bloğu BOŞ kalır (§2c) ve bağımlılık saf yüklemden geçer.

### 7.3 · Levent sahipliği — KARAR

Sentezin §2.11'i (`WarpBeam` · `WarpBeamMount` · `WarpBeamMovement` · `WarpBeamYarn` · `RollEntrySource.LOOM_DOFF`) ile `docs/design/DEVERE-LEVENT-TARAMASI.md` **aynı defteri iki kez tasarlıyordu.** Sekiz kalemde çakışma ölçüldü; yedisinde DEVERE belgesi kazanıyor (ölçülmüş CHECK/claim tablosu var, `WarpSpec` çözgü kartı sentezde hiç yok, kalan metre kolon değil türetilmiş).

> **KARAR: levent ve tüm defteri `docs/design/DEVERE-LEVENT-TARAMASI.md`'ye aittir; tezgah tasarımı levente yalnız OKUYUCUDUR.** Sentezin §2.11'i bu belgede **silindi**. Gerekçe ①: çözgü hazırlama sektörde ayrı departman ve ayrı varlık ömrü; ②: tek defteri iki tasarımın yazması "tek kaynak satır" sağlamlık sınıfıdır; ③: DEVERE belgesi repoyu ölçmüş, sentez ölçmemişti.
>
> **Levent defteri OLAY DEFTERİDİR** (yönetici kararı, 2026-09-12): `WarpBeamEvent` `MOUNTED`/`DISMOUNTED` + tipli `MOUNT_CANCEL`/`DISMOUNT_CANCEL` (append-only, `reversesEventId @unique`, LIFO yalnız durum olaylarında) + "şu an" DURUM KOLONLARINDA (`WarpBeam.status` / `currentMachineId` / `currentPosition`). `WarpBeamMount` **span tablosu REDDEDİLDİ**; `MachineRun.mountId`/`mountedEventId`/**`warpBeamId` AÇILMAZ**; yuva sayısının tek kaynağı **`Machine.warpBeamSlots`**tir ve **`MachineSpec.beamSlots` yazılmaz** (yuva, leventin yuva alanının tanım kümesidir; `MachineSpec` tezgah künyesidir ve levent tüketen makine tezgahla sınırlı değildir — raşel).

**Okuma yüzeyi TEK KAYNAKTIR.** *"Koşum sırasında hangi levent(ler) bağlıydı"* sorusu `beamsMountedDuring(machineId, from, to)` helper'ı ve boğaz-ikizi `BEAMS_MOUNTED_DURING_SQL` ile cevaplanır — **ikisi de levent belgesinindir**; tezgah raporları YALNIZ onu çağırır, kendi yüklemini kurmaz (AST tripwire). Aralık kesişimi aktif MOUNTED/DISMOUNTED olaylarının operasyonel penceresi (`setupStartedAt ?? createdAt`) ile `MachineRun.[startedAt, endedAt)` arasındadır; **çift levent desteklenir** ve `MOUNT_CANCEL` sonrası türetme kendiliğinden değişir. Bekçi: **`test_machine_run_beam_overlap`** (tezgah Faz 2) — helper ↔ SQL ikizi eşitliği, üç fixture (tek levent · çift levent · koşum ortasında levent değişimi), negatif sonda: yüklem düşürülünce kırmızı.

> **İKİ YÖNLÜ KAPI (levent Faz 3 ile AYNI sürümde çıkar):**
> **(1)** `DISMOUNTED` yazılırken o makinede `endedAt IS NULL AND revokedAt IS NULL` **açık koşum varsa 409** *"önce koşumu kapat"* — sorgunun sahibi tezgah tarafıdır ve yüklem `machine_runs_one_open_per_prod_line_uq` ile **aynı helper'dan** okunur. Tezgah modülü kapalıysa `MachineRun` yoktur, kapı uygulanmaz.
> **(2)** Koşum açılırken `WarpBeam.status = MOUNTED ∧ currentMachineId = run.machineId` yoksa **`ApiResponse.warnings`** — **400 DEĞİL**: levent modülü kapalı kurulumda leventsiz koşum meşrudur.
>
> ⚠️ **(1) DÜZELTİLDİ — tek levent varsayımı kalktı, kapı İKİ EŞİKLE TÜRETİLİR** (2026-09-12 kararı, §10/#23). Eski hâli *"bir leventin inmesi makinenin işinin bitmesidir"* varsayıyordu; raşelde bu **kenar durum değil garanti ihlalidir**, çünkü barıların kaçıklıkları farklı olduğu için leventler farklı zamanlarda biter ve biri değişirken makine koşmaya devam eder.
>
> ```
> sökümden SONRA o makinede bağlı kalan aktif levent sayısı = n
>   n == 0  ve açık koşum var        → 409  (defter yalanı: koşum leventsiz süremez)
>   0 < n < Machine.warpBeamSlots    → UYARI (ApiResponse.warnings), 400 DEĞİL
>   n == warpBeamSlots               → sessiz
> ```
>
> `n` **yeni bir kolondan değil** `beamsMountedDuring(machineId, from, to)`den okunur — zaten tasarlanmış helper ve boğaz-ikizi. **Yeni kolon, yeni sorgu, yeni kapı YOK.**
> **Orta eşik neden SERT DEĞİL:** `warpBeamSlots` KAPASİTEDİR, *deseni koşmak için kaç levent gerektiği* değil; gereken sayı çözgü kartının bilgisidir ve bugün yok. Sert yapmak **elimizde olmayan veriye dayanan bir kapı** olurdu (emsal: rota kapsaması kategori düzeyinde reddetmez, uyarır). Çözgü kartına `requiredBeamCount` eklenirse sert kapıya terfi edebilir (Faz N).
> **N=1 BİREBİR:** `warpBeamSlots = 1` olan makinede tek leventi sökmek ⇒ `n = 0` ⇒ **bugünkü 409, aynı koşul ve aynı mesaj**; uyarı dalı `0 < n < 1` boş küme olduğu için hiç tetiklenmez. `warpBeamSlots = 0` (cağlıktan beslenen makine) ⇒ sökülecek levent yok, kapı hiç çalışmaz.
>
> ⚠️ **(2) hâlâ AÇIK:** koşum açılırken *"gereken N yuvanın kaçı dolu"* kontrolü yoktur, yani 6 barlı raşelde tek levent takılıyken koşum sessizce meşru görünür. Sert kapıya çevirmek aynı eksik veriye (`requiredBeamCount`) bağlıdır; bugün yalnız `warnings` düzeyinde kalır.

**Geri alınamaz üç kalem — ikisi şimdi karara bağlanır, biri devere belgesine bırakılır:**

| Kalem | Karar | Neden geri alınamaz |
|---|---|---|
| Enum değeri | **`RollEntrySource.WEAVING`** (sentezin `LOOM_DOFF`u DEĞİL) | PostgreSQL'de enum değeri **düşürülemez**; iki belge sürüme çıkarsa kalıcı çift değer kalır |
| Yuva sayısı | **`Machine.warpBeamSlots`** (`MachineSpec.beamSlots` DEĞİL) | raşel/örme de levent tüketir; tezgah modülüne bağlanamaz. Varsayılanlı tek kolon → adnansahin'de sıfır fark |
| Advisory uzay | **8032 = tezgah vardiya mührü** (Faz 2; EXCLUSIVE sahibi mühürleyici, ingest `_shared` — §3.5); devere ölçerse **8033** | uzay numarası envanterde tek kaynaktır, iki alt sistem aynı numaraya oturamaz |
| Koşum↔levent bağı | **kolon YOK** — `beamsMountedDuring` türetmesi | enum/kolon geri alınamaz; FK ikinci kaynak olur ve `MOUNT_CANCEL`de sarkar, çift leventte yetmez |

---

## 8 · Kabul şartları (kullanıcı) — K2 + K3

Bu bölüm sözleşmedir: **her fazın kabul kapısı bu maddelerin ölçülmüş hâlidir.** "Ölçüldü" demek, bekçinin yeşil çıktısı demektir — cümle değil.

### 8.1 · Kapalıyken SIFIR FARK (K3)

| # | Şart | Nasıl ölçülür |
|---|---|---|
| K3-1 | Bayrak kapalıyken adnansahin'in hiçbir ekranında **yeni alan / zorunluluk / adım / sekme** görünmez | `test_screen_catalog` (karo `visibleWhen` ↔ manifesto `modul` iki yönlü) · `flag-modules.test.ts` · panelde `KIND_TABS` bayrak süzgeci · `PeripheralDevice.protocol` alanı `kind===SIGNAL_SOURCE && tezgahEnabled` koşullu |
| K3-2 | **Bayrak kapalıyken değişmezlik bekçisi SUNUCU AYAKTA koşulur** | `PORT=4101 npx tsx src/server.ts` ayakta → `npx tsx scripts/test_module_flag_off.ts` → **`atlandı = 0`** görülür. ⚠️ Sunucusuz koşumda **18 HTTP kontrolü** *(ölçüldü 2026-09-12; eski "14" ölçümü `devere` satırıyla bayatladı)* **sessizce atlanıyor** (`:551-552` — `httpKontrolSayisi` formülü; sayı TABLODAN türer: `MODULLER.length (5) + onKosul taşıyan (2) + 1 + 5 + 5`, yani `MODULLER`e satır eklendikçe kendiliğinden büyür. ⚠️ Üçüncü turda yazılan `:524-528` çapası YANLIŞTI — o aralık profil damgası yorumudur, §11d) — yani sunucusuz yeşil, K3'ün kanıtı DEĞİLDİR. ⚠️⚠️ **Bu şart `npm test` ile SAĞLANMAZ:** koşucu 4101'i KALDIRMAZ ve "atlanan kontrol" satırı exit kodunu **düşürmez** (`run-all-tests.ts:393-405` — *"yeşil ≠ kapsandı"*). Kabul kapısı bu satırı `npm test` çıktısından değil **AYRI komuttan** okur ve komut `Teks-Erp/docs/BEKCI-HARITASI.md`ye tezgah satırı olarak yazılır. Kalıcı çözüm tercihi (Faz 1a iş kalemi): koşucuya **`TEKSERP_STRICT=1`** modu — atlanan kontrol varsa exit ≠ 0 |
| K3-3 | `MODULLER` tablosunda tezgahın **kendi satırı** var | Bugün `tezgahEnabled` yalnız `MODULE_DEPENDENCIES`ten türeyen bir **yer tutucu**dur (`YONETILEN` türetme bloğu `:216-222`), `MODULLER` tablosunda satırı **yoktur** (`:136-204`, **BEŞ satır**: `ticaret · iplik · devere · depoMulti · production` — ölçüldü 2026-09-12; eski *"`:136-190`, dört satır"* ölçümü `devere` satırı eklenince bayatladı). `requireTezgahEnabled` yazıldığı an 403 gövdesi (`details.code`/`modul`), önbeleksizlik, kapı-`verifyToken` sırası ve bağımlılık dalı **hiç ölçülmez**. **Satırın UNUTULMAMASI da ölçülür:** `test_module_flag_off`a TERS kontrol eklenir — *"`MODULE_SETTING_KEYS`teki (sekiz) her anahtar ya `MODULLER`de bir satırdır ya GEREKÇELİ muaf listesindedir"* (bugün `kumasTeknik` · `tezgah` · `devere` muaf, gerekçe *"backend kapısı yok"*). `requireTezgahEnabled`in export edildiği commit'te tezgah muaftan satıra geçer; geçmezse bekçi kırmızı verir |
| K3-4 | **Negatif sonda kırmızı görülerek yazılır** | `requireTezgahEnabled` içinde `readTezgahEnabled()` → `readProductionEnabled()` takası yapılır ve §1h kırmızı verdiği ÖLÇÜLÜR (SONDA-20 kalıbı); kapı `verifyToken`dan öne alınır → kırmızı |
| K3-5 | Migration **yalnız kolon/tablo ekler**, veri yeniden yazılmaz | Yeni kolonların hepsi nullable ya da `@default`lu; CHECK yalnız yeni kind'ı bağlar (`kind <> 'MACHINE_STOP' OR …`) → mevcut satırlar doğrulamayı geçer. `UPDATE`/backfill ifadesi **YOK** |
| K3-6 | Canlı kurulumda değer `false` damgalı | `test_module_grandfathering` (SQL VALUES ayrıştırma) — `20260902230000` migration'ı `tezgah.enabled = false` yazıyor |
| **K3-7** | **Kapalı modülde doğan KATALOG SATIRLARI hiçbir yüzeyde görünmez** | İki boot uzlaştırıcısı yazıyor: 23 sistem sebebi (§2.1) + dört `loom:*` izin kodu (§6.4). İzin atama ağacı `loom:*` kodlarını `tezgahEnabled` kapalıyken **çizmez**; ölçüm: `test_module_flag_off`un panel/izin ayağı + `test_screen_catalog` izin↔ekran kapsaması. Tabletin sebep kataloğu ayağı için §2.1 (`?kind=` daraltması, Faz 2) |

### 8.2 · Yıkıcı olmama (K2)

| # | Şart | Bu tasarımda |
|---|---|---|
| K2-1 | `Item.name` **ASLA ayrıştırılmaz/taşınmaz** | Belgede `Item` referansı yalnız `MachineRun.itemId` FK'sıdır; ad ayrıştırma, backfill, toplu `UPDATE` **yok**. `unitsPerCm` elle girilir (§5.6) |
| K2-2 | Yapılandırılmış alanlar **nullable** eklenir, zorunluluk yalnız modül açıkken | `protocol String?` · `stopLossClass MachineStopLossClass?` · **`MachineSpec.monitoringState @default(OFF)`** (varsayılan = bugünkü davranış: künye satırı doğsa bile izleme başlamaz) · `maxRevPerMin Int?` · kopuş sayaçları `Int?` (§2.6/§2.10 — `@default(0)` "kopuş yok" yalanı üretirdi) |
| K2-3 | `Machine`e **skaler kolon eklenmez** | Yalnız ters ilişki alanları (§2.1). Faz 3'ün `Machine.warpBeamSlots`u devere belgesinindir ve varsayılanlıdır |
| K2-4 | **Adlandırılmış kapı**, jenerik `requireModule` yok | `requireTezgahEnabled` (§6.1) |
| K2-5 | **Fork yok** | `if (musteri === 'X')` hiçbir yerde; fark yalnız bayrak profilinde |
| K2-6 | Mevcut akış bozulmaz | Rota şablonuna istasyon eklenir; iş emri motoru, `RollStatus` akışı, sevkiyat **dokunulmaz** |
| K2-7 | Bayraklar ayrı ve varsayılan kapalı | `tezgah.enabled` false; `dokuma.enabled`/`devere.enabled` ayrı ve bu dilimde açılmıyor (§7.1) |

### 8.3 · Defter doktrini (K1)

Telemetri budanabilir (`MachineInterval`, insan kararı almamış + mühürlü duruş); **iş kararına giren her bilgi kalıcı kolondadır** (`MachineShiftStat` terimleri, `MachineShiftStopBreakdown`, `unclassifiedSec`). Geri alma her yerde ters kayıt/`revokedAt`: duruş `revokedAt`, koşum `revokedAt`, sayaç kararı `supersededByEventId`, mühür `MachineShiftStatSeal`, sebep değişimi `MachineStopReclass`. **İleri damga null'lanmaz** (`sealedAt`, `provisionalEndedAt`, `acceptedAt`). Budama dört sedle korunur; **üçüncü bir hard-delete sınıfı AÇILMAZ** — `defter.md`ye **«Telemetri ≠ defter» bölümü** (altı kural) yazılmadan ve **budama manifest bekçisi yeşil görülmeden** budayıcı sürüme çıkmaz (§4).

---

## 9 · Fazlandırma

> Sentezin "Faz 1"i en küçük anlamlı adım değil, **en küçük eksiksiz mimariydi**: 7 tablo + 2 migration + job + 2 AST-korumalı helper + 4 ekran + 7 izin + 4 bayrak + advisory uzay + 5 bekçi — repoda bugün 128 model var, yani tek dilimde %5,5 büyüme, hiç yüzeyi olmayan bir modül için. Üstelik içinde **kaynağı olmayan parçalar** vardı: `stopEventMinSeconds` Faz 1'de ama eşikleyeceği tablo Faz 2'de; `anomalyAck` kapısı Faz 1'de ama anomali kaynağı Faz 2'de. Ölçek merceğinin kesimi uygulandı ve **iki parça kaynağıyla HİZALANDI:** `stopEventMinSeconds` eşikleyeceği tabloyla (`MachineStopEvent`) birlikte **Faz 1b**'ye taşındı (§2.7, §6.3); `anomalyAck` **kolonu** Faz 1a'da doğar ama **kapısı** anomali kaynağıyla birlikte **Faz 2**'de yürürlüğe girer (§2.10).

### FAZ 1a — "Elle vardiya girişi" · **en küçük satılabilir dilim**

**Hiç donanım, hiç toplayıcı, hiç telemetri yok.** `MODUL-BAYRAK-TASARIM.md` §8'in kademe ③'ü: *"hiç bağlantı yokken bile randıman raporu çıkar."* Hem satılabilir bir yetenek, hem Faz 2'nin tüm hesap katmanını (karne, formül, mühür, sebep kataloğu) **donanım riski olmadan** doğrulayan iskele. Kullanıcının dört sorusunun dördünü de cevaplar.

**Tablolar (6):** `ShiftDefinition` · `ShiftInstance` · `MachineShiftStat` · `MachineShiftStopBreakdown` · `MachineShiftStatSeal` · `MachineSpec` (kırpılmış: `machineId` · `shedType` · **`monitoringState @default(OFF)`**/`acceptedAt`/`acceptedById`/`acceptedNote`/`demotedAt`/`demotedById`/`demoteReason` · `nominalPicksPerMin` · `baselineRunHours`/`baselineAt` · `notes` + künye). ⚠️ Faz 1a'da elle girilen karne **`monitoringState`i kopyalar** (§2.10) ve elle giriş yüzeyi `OFF` makineye karne yazmaz — gölge/yayın ayrımı Faz 2'de değil, ilk günden şemadadır.
**`MachineRun` Faz 2'ye itildi:** Faz 1a'da koşum yok, donmuş payda zaten `MachineShiftStat.targetPicksPerMin`te; sonradan eklenmesi saf ekleme.

**Migration A:** altı tablo + ham SQL (`ShiftDefinition.nameFold` **GENERATED ALWAYS AS (public.tr_fold("name")) STORED** — Prisma `dbgenerated()` kolonu yaratmaz, yalnız defteri tutar; `@@unique([nameFold])` + `test_db_invariants` `EXPRESSION_UNIQUES`/fold envanteri aynı commit'te; **uygulama bekçisi `assertNameNotDuplicate` KALDIRILMAZ** — anlaşılır 409'u o verir, DB seddi sessiz son hattır).
**Migration B1 (enum — dosyada TEK ifade):** `ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'MACHINE_STOP';`
> ⚠️ **55P04 — enum değeri kendi commit'inde ve KENDİ DOSYASINDA doğar; aynı tx'te KULLANILAMAZ.** PostgreSQL *"unsafe use of new value of enum type"* der ve `migrate deploy` **ortada kalır**; sürüm gecesi backend ÖNCE dağıtıldığı için bu doğrudan müşteri zararıdır. Repo emsali bu dersi taşıyor: `prisma/migrations/20260826130000_reason_preset_order_cancel_kind/migration.sql:13` *"bilerek TEK ifadedir"* (`docs/RECETELER.md:103,119`).

**Migration B2 (kolon + CHECK):** `ReasonPreset.stopLossClass` + `reason_presets_machine_class_chk` + `test_db_invariants` envanter satırı. **B1 ile B2 aynı commit'te, B1 ÖNCE**; `constants/reason-presets.ts` ve `reason-preset-catalog.job.ts` de **AYNI COMMIT'te.**

**Kod:** `requireTezgahEnabled` + `REGIME_GATES` satırı · 4 izin **+ dar rol şablonu satırları** (§6.4) · `MACHINE_DELETE_GUARDS`a `machineShiftStatCount` (§2.1 — Restrict FK ile AYNI commit) · `jobs/shift-calendar.job.ts` — **her koşumun İLK ifadesi `if (!(await readTezgahEnabled())) return "disabled";`** (`exchange-rate.job.ts:295` emsali: `if (!(await readFinanceEnabled())) return "disabled";`); kapalı kurulumda `ShiftInstance` **materyalize ETMEZ** ve sayacı `/api/admin/health`te *"disabled"* görünür (boot + günlük, 30 gün ileri; `@@unique` sayesinde kilit gerekmez) · `helpers/shift-resolve.helper.ts` (`resolveShiftInstanceId(at)` TEK KAYNAK, AST bekçili) · `helpers/loom-efficiency.helper.ts` (`computeMachineKpis`) · duruş span kırpma helper'ı (§5.1) · **§6.2'nin altı yer tutucu satırı** · panel: vardiya kataloğu + elle giriş + randıman raporu + Makine formuna "Tezgah" bölümü.

**Advisory kilit YOK, `MachineStopEvent` YOK, ajan YOK, `clientToken` yalnız elle giriş ucunda.**

> **⚠️ KAPI İLE EKRANIN SIRASI — "kapı fazın başında, ekran fazın sonunda" ÖLÇÜLMÜŞ KIRMIZI üretir.** `requireTezgahEnabled` export'u ile en az bir `SCREEN_CATALOG` tezgah ekranı (`modul: "tezgahEnabled"`) **AYNI COMMIT'te** doğar. Gerekçe ölçüldü: `test_screen_catalog` §10b'nin kaynağı doğrudan `src/middlewares/*.ts` içindeki `export async function require<Alan>Enabled` taramasıdır ve **`EKRANSIZ_MODULLER`e HİÇ BAKMAZ** (muaf yalnız §8'i kapatır) — yani kapı yazıldığı an ekran beyan edilmemişse bekçi kırmızı verir ve **commit kapısı durur**. *(Bekçi bugün yeşildir çünkü `requireDevereEnabled` repoda yok — devere anahtarı bilerek "kapısız" commit'lendi; tuzak tezgah için aynen duruyor.)* Aynı commit'te `EKRANSIZ_MODULLER`daki tezgah girdisi silinir (§6.2/#1).

**Vardiya boşluk politikası:** kapsayan örnek yoksa `shiftInstanceId = NULL` kabul edilir ve satır YİNE yazılır (ingest reddi ajanın kuyruğunu kilitlerdi), ama **NULL bir değer değil bir BOŞLUKTUR**: `/api/admin/health` sayacına düşer, `MachineShiftStat` üretmez ve raporda "vardiya atanmamış N kayıt" şeridiyle beyan edilir. Bu, fail-closed varsayılanından **bilinçli bir sapmadır** ve gerekçesi ingest'in geri basınç üretmemesidir. *(Sentezin `variance-reasons.ts:203` emsali ters okunmuştu: o cümlenin fail-closed dalı `undefined`dır — emsal kaldırıldı, karar kendi gerekçesiyle duruyor.)*

**Bekçiler (4 yeni + 10 mevcut):**
- `scripts/test_machine_efficiency_formula.ts` — A×P kimliği · yüzde ortalaması yasağının AST'si · `formulaVersion` donuyor mu · **45 dk'lık `COZGU_KOPUSU` → A düşmeli** (§5.2)
- `scripts/test_machine_shift_seal.ts` — mühür/aç/yeniden-mühür **atomik claim** mi · `sealedAt` null'lanmıyor mu · `sealGeneration` artıyor mu · anomalili vardiya onaysız mühürlenemiyor mu → **409** *(⚠️ bu ayak Faz 2'de koşar: anomali kaynağı `MachineCounterEvent`/`deltaQuality` orada doğar; Faz 1a'da yalnız kolon + atomik claim ölçülür — §2.10)*
- `scripts/test_machine_shift_terms.ts` — vardiya sınırında **kırpma** (§5.1) · `Σ MachineShiftStopBreakdown.stopSec + minorStopSec ≤ potSec` (§4). ⚠️ `Σ observedSec + unobservedSec = calendarSec` eşitliği **Faz 1a'da KOŞULMAZ**: kova (`MachineInterval`) Faz 2'de doğar ve Faz 1a `unobservedSec = 0` BEYAN eder (§5.1) — ayak bu fazda doğuşta kırmızı verirdi. İkinci ayak **Faz 2'de** eklenir
- `scripts/test_reason_preset_kind_parity.ts` — sunucu `ReasonPresetKind` ↔ Electron union + `KIND_TABS` ↔ mobil union + iki `Record` + BUILTIN `switch` **birebir** (§2.1). ⚠️ İlk koşumda bugünkü `ORDER_CANCEL` eksiğini yakalar; o eksik aynı commit'te kapatılır
- Mevcut: **`test_module_flag_off` (sunucu 4101 AYAKTA, `atlandı=0`, negatif sonda + `MODULE_SETTING_KEYS` ters kontrolü)** · `test_feature_flag_contract` (PANEL_EXEMPT'teki `tezgahEnabled` ANAHTARI silinir, `REGIME_GATES` satırı) · `test_screen_catalog` (§10b kapı↔ekran sırası + ölü muaf + izin↔ekran kapsaması) · `test_module_profile` (§2 tamlık; profil sayısı **6 KALIR**, sekiz anahtar) · `test_role_template_catalog` (§2: dört iznin dördü de bir dar rolde) · `test_timestamptz_contract` (**tek** yeni `@db.Date` muafı: `MachineShiftStat.factoryDay`; ikincisi Faz 1b'de) · `test_module_flags` · **`test_hard_delete_guard_coverage`** (`WATCHED`a `"Machine"` + `EXPECTED`e `Machine <- MachineSpec.machine : Cascade` — §2.3; Faz 2 yalnız envanteri büyütür) · Electron `flag-modules.test.ts` + `module-flags.test.ts`
- **`npx prisma validate` TEMİZ** — §2.1'deki **karşı-ilişki envanterinin HER alanı** yazılmış olmalı (13 alan); biri eksikse **P1012** ile düşer ve şemaya dökme ilk adımda durur

**Kabul kapısı:** ① bekçiler yeşil **ve `test_module_flag_off` AYRI KOMUTTAN ölçüldü** — `PORT=4101 npx tsx src/server.ts` ayakta iken `npx tsx scripts/test_module_flag_off.ts` → **`atlandı = 0`**; `npm test` çıktısı bu şartın kanıtı DEĞİLDİR (§8.1 K3-2) · ② dört yeni bekçi negatif sondayla **kırmızı görülerek** yazıldı · ③ bayrak panelden açılıp kapanıyor (§6.2 altı yer tutucu emekli) · ④ kapalıyken adnansahin'in ekranlarında sıfır fark (§8.1) · ⑤ **`npx prisma validate` temiz** (13 karşı-ilişki) · ⑥ `npm test` tam paket yeşil (~6,5 dk).

### FAZ 1b — Sebep kırılımı + elle duruş girişi

`MachineStopEvent` (üç partial index + **BEFORE DELETE trigger**) · `MachineStopReclass` · `loom:classify` · `tezgah.stopEventMinSeconds` · panelde duruş girişi/düzeltme ekranı · `MachineShiftStopBreakdown`ın gerçek dolumu. **Hâlâ donanım yok** — duruşları vardiya amiri girer. `factoryDay` ikinci `@db.Date` muafı burada doğar.

**Bekçiler:** `test_machine_prune_safety` iskeleti (henüz budayıcı yok ama sed sondaları yazılır) · `test_db_invariants` (partial index + trigger + CHECK envanteri) · `test_machine_reclass` (ilk sınıflandırma atomik claim mi, değiştirme defter satırı yazıyor mu, yerinde güncelleme yok mu).
**Kabul kapısı:** sebepli duruş `DELETE` denemesi DB'de `RAISE EXCEPTION` alıyor (pozitif sed sondası) · yeniden sınıflandırma audit'e değil deftere düşüyor.

### FAZ 2 — Otomatik toplama

`MachineCollector` + `MachineCollectorLink` + `verifyCollectorToken` · `PeripheralDevice.protocol` + `PeripheralSignal` · `MachineInterval` · `MachineRun` · `MachineLiveState` · `MachineCounterEvent` · üç ingest ucu · `loom-retention.job` · `loom-counter.helper` · **ajanın kendisi (`kenar/`)** · canlı pano · tablet sınıflandırma kuyruğu (uç **`?kind=`li** çağrılır) · advisory **8032** (mühür EXCLUSIVE / ingest `_shared`) · `MACHINE_DELETE_GUARDS`a **iki sayaç** (`machineRunCount` + `machineCounterEventCount` — §2.1'in yolu) + `workorder.service.ts` adım silme guard'ına `machineRuns` (§2.8) · `loom-read-surfaces.ts` **okuma manifesti** + `loom-telemetry-ast-tarama.ts` (§4) · kalan **12 bayrak** · *(istenirse)* `kur.ps1`e NTP adımı — **bugün yok, ayrı iş kalemi** (§3.5).

**Bekçiler:** `test_machine_prune_safety` (**dört ayak**, §4) · **`test_machine_shift_terms`in İKİNCİ AYAĞI** — `Σ observedSec + unobservedSec = calendarSec` (kova bu fazda doğduğu için eşitlik ancak burada anlamlıdır; §4/§5.1) · `test_machine_counter_delta` (taşma/sıfırlama/anomali matrisi) · `test_machine_ingest_contract` (**dört durumlu replay + `STOP_REVOKED` + span kapanışı + sıra dışı 409 + saat sapması 400 + `SOURCE_MISMATCH` 400 + kapsam dışı 403 + uzak istekte 404**) · `test_machine_secret_hygiene` (token log/audit/sürüm notuna sızmıyor mu — kodla ölçülür) · `test_advisory_lock_namespaces` (8032, `_shared` dahil) · `test_remote_access_guard` (iki yeni önek) · `test_route_auth_coverage` (dört `EXEMPT` satırı) · `test_db_invariants` (kalan envanter + `NULLS NOT DISTINCT` breakdown seddi + `machine_counter_events_natural_uq`) · **`test_machine_shadow_mode`** — **S1** `OFF` makineye ingest → 403 · **S2** `SHADOW` karnesi mühürlenir ama DEFTER raporlarında (R1–R5) GÖRÜNMEZ · **S3** `go-live` kabulsüz sinyalle → 409 `SIGNAL_NOT_ACCEPTED` + eksik liste · **S4** 14 gölge vardiyada → 409 `SHADOW_TOO_SHORT` · **S5** anomali oranı aşınca → 409 `SHADOW_ANOMALY` · **S6** LIVE makinede kanal değişikliği → 409 `CHANNEL_CHANGE_REQUIRES_SHADOW`; **beş negatif sonda** (rapor süzgecini kaldır · karnenin donmuş `monitoringState`i yerine canlı künyeden süz · `go-live` kapılarından birini düşür · `signals/:id/accept`in gözlem şartını kaldır (409 `SIGNAL_NOT_OBSERVED` düşer) · kanal alanı değişince kabul damgasını null'lama → hepsi kırmızı vermelidir) · **`test_machine_run_beam_overlap`** (helper ↔ SQL ikizi, üç fixture — §7.3) · `test_hard_delete_guard_coverage` (`EXPECTED`e Faz 2'nin Cascade çocukları; `WATCHED`a `"Machine"` **Faz 1a'da** eklendi — §2.3) · `test_consistency` (§2.11'in eksik üç mutabakatı).

**Kabul kapısı — üçü birden:**
1. **«Telemetri ≠ defter» bölümü yazıldı VE budama bekçisi yeşil ölçüldü.** Üçüncü bir hard-delete sınıfı AÇILMAZ (§4): `/karar-notu` ile arşive tam metin + `docs/kurallar/defter.md`ye **bölüm (altı kural) + tek kural satırı**; kök `CLAUDE.md` cümlesi **kullanıcı onayına** bırakılır. Kapının ölçülen yarısı `test_machine_prune_safety`nin **manifest ayağıdır** (`/api/tezgah/**` GET uçları ↔ `loom-read-surfaces.ts`, R1–R7 birebir / T1–T3 `warnings`li) + `loom-telemetry-ast-tarama.ts`nin dört kuralı + **N1–N8 negatif sondaları kırmızı görülerek**. Bölüm yazılmadan ve bekçi yeşil görülmeden **retention job sürüme çıkmaz**.
2. **Audit muafiyeti kodlandı ve ölçüldü:** `AUDIT_EXEMPT_MODELS` sabiti (⚠️ **bugün repoda YOKTUR, yaratılacaktır**) + iki yönlü bekçi (ölü muaf da kırmızı) + kök `CLAUDE.md`'nin *"tek istisna `UserPreference`"* cümlesinin `/karar-notu` ile güncellenmesi.
3. **Kanal kabul testi + gölge mod KODA BAĞLANDI — reçete cümlesi yetmez: KOLON + KAPI.** Kolon `MachineSpec.monitoringState` (**OFF → SHADOW → LIVE**, varsayılan OFF) + `acceptedAt`/`acceptedById` + `demotedAt`/`demotedById`/`demoteReason`, kanal tarafında `PeripheralSignal.acceptedAt`/`acceptedById`, karnede **donmuş** `MachineShiftStat.monitoringState` (§2.3, §2.10). Kapı `POST /specs/:id/go-live`ın **üç şartıdır** (`SIGNAL_NOT_ACCEPTED` · `SHADOW_TOO_SHORT` · `SHADOW_ANOMALY`) ve kanal damgası `POST /signals/:id/accept`in **gözlem şartıdır** (`SIGNAL_NOT_OBSERVED` — "elle tetikledim" beyanı sunucu gözlemiyle kanıtlanır). LIVE makinede kanal değişikliği **409 `CHANNEL_CHANGE_REQUIRES_SHADOW`** → önce sebepli demote. Bekçi **`test_machine_shadow_mode`** (S1–S6 + beş negatif sonda, kırmızı görülerek yazılır). Süreç önlemi kalkmadı: kanal kabul testi + **en az 5 iş günü gölge mod** kurulum reçetesinde ZORUNLU madde olarak kalır ve `tezgah.fineWindowUntil` onun **tanı aracıdır** (kabul kapısı DEĞİL). *NC/NO rölesi ters bağlanmış bir tezgah "hep çalışıyor" görünür, randıman %100 çıkar ve kimse şikâyet etmez çünkü rakam güzeldir — ve mühür kalıcıdır; bu yüzden kapı bir boolean'ın yanındaki yorum olamaz.*

### FAZ 3 — Marka sürücüleri, doff, kalite ayağı

`MachineModel` + `MachineStopCodeMap` (otomatik sınıflandırma — budama yüklemi İNSAN kararına bakar, §4) · `RollEntrySource.WEAVING` + `DoffEvent` · `Q`/OEE · `tezgah.shiftCloseRequiresClassification` · `unitsPerCm`in kalıcı evi (kaynak: çözgü/desen kartı — `WarpSpec` ailesi; **sert bağımlılık EKLENMEZ**, §10/#9) · **levent bağı: KOLON YOK, `beamsMountedDuring` türetmesi** (§7.3) ve `Machine.warpBeamSlots` levent belgesinin migration'ında doğar. Levent defterinin kendisi DEVERE belgesinindir; tezgah izlemenin `perde-dokuma` profiline eklenmesi **ayrı bir karar notudur** (§7.2).

> **⚠️ FAZ 3'ÜN TEK PARÇALI SÜRÜM KURALI — beş kalem AYNI sürümde çıkar.** Levent tarafı üç ayrı yazara bölünebilir bir iştir ve bölünürse **yarım bir defter canlıya çıkar**: olay defteri yazılıp durum kolonları yazılmazsa "şu an hangi levent takılı" sorusu olayları tarayarak cevaplanır (ikinci okuma yolu, ayrışan yüzey); durum kolonları yazılıp sed yazılmazsa iki makine aynı leventi MOUNTED gösterir; `beamsMountedDuring` yazılmazsa tezgah raporları kendi yüklemini kurar ve tek kaynak çöker. **Aynı sürüm:** ① `WarpBeamEvent` olay defteri (append-only, tipli `*_CANCEL`, `reversesEventId @unique`) · ② `WarpBeam.status`/`currentMachineId`/`currentPosition` durum kolonları · ③ partial unique sed (bir levent aynı anda tek makinede) + `Machine.warpBeamSlots` · ④ `beamsMountedDuring` helper'ı **ve** boğaz-ikizi `BEAMS_MOUNTED_DURING_SQL` · ⑤ mutabakat bekçisi. Beşi aynı commit'te olmak zorunda değildir, **aynı SÜRÜMDE olmak zorundadır** (§7.3).

**Bekçiler (Faz 3):**
- **`scripts/test_machine_run_beam_overlap.ts`** (Faz 2'de iskeleti doğar, Faz 3'te gerçek defterle koşar) — helper ↔ SQL ikizi **birebir**; üç fixture: tek levent · çift levent · koşum ortasında levent değişimi. Negatif sonda: kesişim yüklemini düşür → kırmızı.
- **`scripts/test_warp_beam_ledger.ts`** (levent belgesinin bekçisi, tezgah tarafından ÇAĞRILIR) — olay ↔ durum mutabakatı: `WarpBeam.status`/`currentMachineId`, olay defterinin son geçerli satırından **türetilenle birebir**; `MOUNT_CANCEL` sonrası durum kendiliğinden geri döner. Negatif sonda: bir `DISMOUNTED` olayını gizle → durum ayrışır → kırmızı.
- **`scripts/test_machine_doff_source.ts`** — `RollEntrySource.WEAVING` ile doğan topun kaynağı ve `DoffEvent` bağı; **türetilen metrenin stok yazmadığı** (§5.6) AST ile ölçülür: `producedM` ile `Roll` miktar yazan yol aynı ifadede geçemez.
- **`scripts/test_machine_stop_code_map.ts`** — marka ham kodu → `ReasonPreset` eşlemesi; eşlenen duruş `reasonSource = MACHINE`, **`classifiedById = NULL`** yazar (yani budama yüklemi onu TELEMETRİ saymaya devam eder, §4). Negatif sonda: eşleyici `classifiedById` yazsın → budama bekçisi kırmızı (otomatik sınıflama kalıcılaşma tuzağı).
- **Mevcut:** `test_db_invariants` (yeni partial unique + `WEAVING` enum envanteri) · `test_machine_prune_safety` (okuma manifestine Faz 3 uçları eklendi mi — manifest dışı uç kırmızı, §4) · `test_consistency` (levent ↔ koşum kesişimi) · `test_timestamptz_contract`.

**Kabul kapısı — beşi birden:**
1. **Tek parçalı sürüm ölçüldü:** ①–⑤ kalemlerinin beşi de aynı sürüm etiketinde; `npx prisma validate` **temiz** ve levent tarafının karşı-ilişkileri beyan edilmiş (P1012 duvarı, §2.1).
2. **`RollEntrySource.WEAVING` kendi migration dosyasında TEK ifade** (`ALTER TYPE … ADD VALUE IF NOT EXISTS`) ve onu KULLANAN kolon/CHECK **ayrı dosyada, sonra** — PG **55P04** kuralı (§9 Faz 1a/B1 emsali).
3. **Dört yeni bekçi negatif sondayla KIRMIZI görülerek yazıldı** (yukarıdaki dört sonda tek tek koşturulup kırmızı görüldü, sonra düzeltildi).
4. **Mutabakat yeşil:** `beamsMountedDuring` ile `WarpBeamEvent` defteri aynı cevabı veriyor (üç fixture) **ve** levent↔koşum kapısının iki yönü ölçüldü — `DISMOUNTED` açık koşumda **409**, koşum açılışında leventsizlik **`warnings`** (400 DEĞİL, §7.3).
5. **Budama güvenliği yeniden ölçüldü:** Faz 3'ün yeni okuma uçları `loom-read-surfaces.ts` manifestine **sınıfıyla** yazıldı (DEFTER mi TELEMETRİ mi) ve `test_machine_prune_safety` yeşil; `npm test` tam paket yeşil (~6,5 dk).

---

## 10 · Alınan kararlar

> Her madde: **KARAR** + tek cümle gerekçe (ölçüt ① sektör ② ölçeğimiz ③ kod deseni) + **itiraz edilebilir**. **Üç onay kalemi + iki sahipsiz iş kalemi dışında** kullanıcıya açık soru bırakılmadı — beşi adıyla §0'ın başlığındadır: «Telemetri ≠ defter» cümlesi · `AUDIT_EXEMPT_MODELS` + *"tek istisna `UserPreference`"* · K2 sapması (`dokuma → devere`) · `kur.ps1` NTP adımı · `TEKSERP_STRICT` koşucu. Sahada ölçülmesi gerekenler **saha doğrulaması** olarak işaretlendi ve varsayılan kararları yazıldı.

1. **Toplayıcı kutusu → ayrı mini-PC/RPi, salon başına bir adet, ÜRÜNE DAHİL ("tezgah izleme kiti").** ② Tek standart kutu = tek sürücü matrisi; müşterinin kendi aldığı kutu destek maliyetini fiyatın dışına taşır ama bize geri döner. *(itiraz edilebilir)*
2. **Gövde → tek gövde, headless Windows servisi (`kenar/` + NSSM); Electron "Toplayıcı Modu" pilotta bile YAZILMAZ.** ③ Panelin main process'i HTTP başlatamaz (`kesif-cihaz.md`) ve toplayıcı, **kapanmasına insanın karar verdiği** bir sürecin içinde yaşayamaz: `electron-updater` kendiliğinden yeniden başlatmaz (`updater.ipc.ts:198` `autoInstallOnAppQuit = false`; `quitAndInstall` yalnız `updater:install` IPC'sinde) ama kurulumu **OPERATÖR** başlatır ve bunu vardiya ortasında yapabilir. *(Eski gerekçe — "her sürümde kendiliğinden yeniden başlatır" — ÖLÇÜLDÜ ve yanlıştı; karar değişmez, üçüncü engel de duruyor: iki ingest istemcisi = ayrışan yüzey.)* *(itiraz edilebilir)*
3. **`modbus-serial` ONAYLANDI — yalnız ajan paketine** (backend `package.json`a ve `deploy/` altına girmez); `docs/standart/KUTUPHANELER.md`ye "Kenar toplayıcı" tablosu + 6 satırlık karar kaydı (reddedilen alternatif `jsmodbus`). **HTTP paketsiz** (Node `fetch`), **kuyruk paketsiz dosya-tabanlı JSONL** — `better-sqlite3` REDDEDİLDİ (native derleme ajan kurulumunu ağırlaştırır; sentezdeki "SQLite/WAL" ifadesi buna göre düzeltildi). OPC-UA Faz 3. ②③ *(itiraz edilebilir)*
4. **Gece vardiyası BAŞLADIĞI güne yazılır** (`shiftDayAttribution = START`). ③ `constants/time.ts`in kendi gerekçesi ("01:30'da okutulan top BUGÜNDÜR"). **Vardiya sayısı (2×12 / 3×8 / hafta sonu) karara bağlanmaz: PROFİL verisidir**, fabrika katalogdan girer, seed canlıya vardiya yazmaz. **Ekip rotasyonu Faz 1–3'te YOK** (karne `userId` taşımaz); gerekirse `ShiftTeam` eklemeli açılır. ② *(itiraz edilebilir)*
5. **Birincil sayı `E = A × P`; ikincil `teknikRandıman = APT/(APT+UNPLANNED)` ayrı adla.** Rapor başlığına tanım + bileşenler basılır; **"ISO 22400-2 Effectiveness" ibaresi KULLANILMAZ** (§5.2). Satış cümlesi açıkça söylenir: *"tezgah terminaliyle birebir tutmaz — tanım, vardiya sınırı ve sayaç sıfırlaması farklı."* ① *(itiraz edilebilir)*
6. **POT: `NON_SCHEDULED` düşülür · mola POT'ta KALIR (`breakOutOfPot=false`) · planlı bakım ve SETUP POT'ta kalır · `TOP_ALMA` ve `LEVENT_BAGLAMA` = `SETUP`.** ①③ Muhafazakâr yön + fail-closed; bu üç karar aynı fabrikanın randımanını %8–15 oynatır, `formulaVersion` geçmişi korur. *(itiraz edilebilir)*
7. **Mikro duruş eşiği = 20 sn**, ama **`MINOR` sebepten değil SÜREDEN türer** (§5.2). ① Yol haritasının kendi ölçüsü (*"bir kopuş 20 saniye sürer"*); eşik `formulaVersion` olayı gibi ele alınır ve karneye donar. **Saha doğrulaması** — pilotta ölçülür; varsayılan 20 sn. *(itiraz edilebilir)*
8. **Audit sapması: EVET, dar ve adıyla — ama FAZ 2 kararıdır.** Faz 1a/1b'de makine yazarı yok, muafiyet gerekmez. Faz 2'de makine kaynaklı yazımlar (`MachineInterval` upsert · `MachineLiveState` nabzı · duruş aç/kapat) `AuditService.log()` **çağırmaz**; muafiyet `AUDIT_EXEMPT_MODELS` ile **kodlanır** (⚠️ bugün yoktur) ve iki yönlü bekçiyle ölçülür; listeye satır eklemek karar notu gerektirir. İnsan dokunuşları (sebep atama, yeniden sınıflandırma, mühür/aç, token, elle giriş, revoke) normal audit'lenir. ②③ Kabul edilmezse tek duruşun ömrü ~2 KB audit demektir — `MachineStopEvent`in kendisinin üç katı. *(itiraz edilebilir; kök `CLAUDE.md` cümlesini değiştirir)*
9. **`kumasTeknik`e SERT bağımlılık EKLENMEZ.** `unitsPerCm` NULL → metre üretilmez, randıman hesaplanır, rapor beyan eder. Faz 1–2'de değer **yalnız `MachineRun.unitsPerCm`e elle girilir**. ⚠️ **Kalıcı ev `ProductRecipe` DEĞİLDİR** — kardeş belge bunu ölçerek reddetti (`DEVERE-LEVENT-TARAMASI.md` §3.4: sıklık renge/desene bağlıdır, reçeteye konursa **kopya** doğar). Ev açıldığında kaynağı **çözgü/desen kartıdır** (`WarpSpec` ailesi, devere belgesi) ve bağımlılık `kumasTeknik` değil **`devere`** tarafındadır; **sert bağımlılık yine EKLENMEZ**: NULL → metre üretilmez, randıman hesaplanır, rapor beyan eder. ② Teknik kart istemeyen dokumacıyı zorlamaz. *(itiraz edilebilir)*
10. **KARAR KAPALI — `perde-dokuma` profili repoda ZATEN VAR ve bu belge onu DEĞİŞTİRMEZ.** Profil 2026-09-12'de **devere içeriğiyle** doğdu (`module-profiles.ts:159`) ve tezgah izleme orada **bilinçli olarak KAPALIDIR** (Faz 4). Canlı bir profilin modül kümesini değiştirmek sessiz bir davranış değişikliğidir; tezgah izleme o profilde **bayrakla, kurulum başına** açılır ve profile eklenmesi AYRI bir karar notudur. `MODULE_PROFILES` sayısı **6 KALIR** (sentezin "5 → 6" cümlesi bayattı). ②③ *(itiraz edilebilir)*
11. **Sebebi ikisi de atar, varsayılan yüzey TABLET;** izinler ayrı kodlardır (`loom:classify` web + `mobile:tezgah-durus`). Eşik altı hiç sorulmaz; sinyalden çözülen kısa kopuş otomatik sınıflanır (`reasonSource = MACHINE|INFERRED`, `classifiedById = NULL`) — ⚠️ **ve bu yüzden budama seddi "sebep var mı"ya değil "İNSAN karar verdi mi"ye bakar** (§4): aksi hâlde otomatik sınıflama budanan ~1,12 M satırı kalıcıya çevirir ve yıllık bütçeyi tek tabloyla aşardı. `longStopThresholdSec` (300) üstü otomatik sınıflansa bile kuyruğa düşer. **Tamamı Faz 2.** ①③ *(itiraz edilebilir)*
12. **Sistem sebebinin anlamı KOD SAHİPLİ — fabrika değiştiremez;** fabrika yalnız kendi eklediği sebebin sınıfını seçer. ② `ELEKTRIK_KESINTISI`ni "planlı" yapan bir fabrika kendi rakamını kandırır; `MOLA` meşru bir fabrika kararıdır ve o zaten `breakOutOfPot` bayrağıyla yönetiliyor. *(itiraz edilebilir)*
13. **Geriye dönük sınıflandırma penceresi = MÜHÜR SINIRI.** Mühürlenmemişte serbest, mühürlüde `loom:shift-unseal` + `MachineShiftStatSeal` satırı + (değişiklikse) `MachineStopReclass`. **Duruşun `revokedAt` ile geri alınması da bu sınıra tabidir** (§2.7): mühürlüyse doğrudan yazılamaz → 409 `SHIFT_SEALED`. ⚠️ **Pencere fiilen `min(mühür sınırı, sampleRetentionDays)`tır:** budanmış bir duruş, mühür açılsa da **GERİ GELMEZ**. Karnenin `unclassifiedSec` terimi donduğu için **RAKAM korunur**, kaybolan **KALEM LİSTESİDİR**; unseal ekranı ve rapor bunu *"N sn sınıflandırılmamış — kalemleri budandı, yeniden sınıflandırılamaz"* diye beyan eder. `sampleRetentionDays`i kısaltmak bu pencereyi de kısaltır ve geri alınamaz (#16). ③ *(itiraz edilebilir)*
14. **Marka sürücüsü Faz 2'de YAZILMAZ; devreye alma bir REÇETE MADDESİ DEĞİL, bir KAPIDIR.** Varsayılan ve tek birinci-sınıf yol **kuru kontak + donanım darbe sayacı retrofiti**; marka entegrasyonu yalnız ölçülmüş bir tezgahta ve Faz 3'te. **Doğrulanmamış ürün adları belgeden ÇIKARILDI** — satış cümlesine sızma riski. **Saha doğrulaması:** *"tezgahlar hangi marka/model, veri çıkışı var mı, duruş sebebini operatör bugün nereye giriyor?"* (saha kaynağının 8. açık sorusu) **Faz 2'nin ön koşuludur, Faz 1a'nın değil** — Faz 1a tam da bu belirsizliği beklememek için seçildi. ②③
15. **Retrofit yanlış yorumu → REÇETE CÜMLESİ DEĞİL, KOLON + KAPI (+ süreç).** `MachineSpec.monitoringState` **`OFF` doğar** (varsayılan = bugünkü davranış); `OFF → SHADOW` ingest kapsamını açar; `SHADOW` tezgahın verisi yazılır ve karnesi **normal mühürlenir** ama **DEFTER raporları onu süzer** ve dışa aktarımda GÖLGE damgası taşır (§2.3, §5.3/8) — `SHADOW → LIVE` üç kapılıdır (`SIGNAL_NOT_ACCEPTED` · `SHADOW_TOO_SHORT` · `SHADOW_ANOMALY`), geri dönüş sebepli demote'tur, bekçisi **`test_machine_shadow_mode`**. Kanal kabul testi + **en az 5 iş günü gölge mod** kurulum reçetesinde ZORUNLU madde olarak KALIR (süreç önlemi kalkmadı, üstüne kolon ve kapı eklendi). `observedSec` düşükse rapor uyarır ama **mühürü bloke etmez**. ② *(itiraz edilebilir)*
16. **`sampleRetentionDays` 180'de kalır.** ② Kısaltmak geri alınamaz, uzatmak serbest; **saha doğrulaması** duruş frekansı pilotta ölçülür. *(itiraz edilebilir)*
17. **`counterModulus` NULL doğar ve sarma yorumu KAPALIDIR** — her negatif sıçrama `RESET`/`ANOMALY`. Modülüs yalnız kanal kabul testinde **ÖLÇÜLEREK** girilir. ③ Uydurulmuş değer yazılmaz. *(itiraz edilebilir)*
18. **`machine_stop_events` partition bugün açılmaz, tetiği yazılıdır:** tablo 20 M satırı VEYA kurulum 60 tezgahı geçerse karar yeniden açılır ve **boş tabloda** prova edilir; sayaç `/api/admin/health`te. ② *(itiraz edilebilir)*
19. **~~`slot = 1` kanonik üretim sayacıdır~~ → GEÇERSİZ, #23 ile değiştirildi (2026-09-12).** Kural kanalın ANLAMINI **konumundan** okuyordu ve iki yönden yanlıştı: ① aynı makine modeli iki türlü kablolanır (slot 2 = jakar başlığının ikinci ölçümü mü, ikinci yolun sayacı mı?) — konum bunu söyleyemez; ② kurulumcu karşılaştırma kanalını slot 1'e takarsa kural **sessizce yanlış metre** üretir. Yerine: **anlam `PeripheralSignal.productionLineNo`da taşınır** — metre ve randıman `productionLineNo` DOLU kanallardan türetilir, `productionLineNo` NULL kanal (karşılaştırma/tanı) rapora hiç girmez. ③
20. **`minVersion` YÜKSELTİLMEZ:** yeni enum değerleri ve uçlar yalnız yeni yüzeylerde okunuyor, sahadaki istemciyi etkilemiyor. ③ *(itiraz edilebilir)*
21. **`MachineInterval` PK'sı `@@id([machineId,bucketStart])`, `MachineLiveState` PK'sı `machineId @id`, `MachineSpec` PK'sı `id` + `machineId @unique`** — üç farklı kalıp bilinçlidir ve gerekçesi `///` ile yazılıdır (§2.3, §2.6, §2.9): varlık olan `id` alır, makinenin aynası olan almaz. ③ *(itiraz edilebilir)*
22. **İZLENEN MAKİNE DOKUMA TEZGAHIYLA SINIRLI DEĞİLDİR — künye nullable, ad nötr, birim sinyalde** (2026-09-12; `DEVERE-LEVENT-TARAMASI.md` §9.5 kararının şemaya uygulanması, §9.7e). Üç parça:
    - **(a) Künye nullable.** `LoomShedType` ve `LoomWeftInsertion` **NULL olabilir**: çözgülü örme (raşel) ağızlık açmaz ve atkı atmaz. Eski NOT NULL hâli raşeli şemadan yapısal olarak dışlıyordu — `MachineSpec` satırı açılamayan makine izleme kapsamına hiç giremiyordu. **İki enumun ADI `Loom*` KALIR** ve bu bilinçlidir: ağızlık düzeni ile atkı atma sistemi **gerçekten dokumaya özgü fiziktir**; nötr ada çevirmek "her makinenin ağızlığı var" ima ederdi. NULL olmaları tam olarak "bu makine o sınıftan değil"i söyler. ③
    - **(b) Ad ailesi nötr: `MachineSpec` / `MachineRun` / `Machine*` / `machine_*` / `test_machine_*`.** `Loom*` adları raşel kapsama girince yanlış ad olur. **Şemada bugün HİÇBİRİ YOK** (ölçüldü 2026-09-12: `MachineSpec`/`MachineRun`/`MachineInterval` → 0 eşleşme; `Machine*` ad uzayı ve `machine_*` tablo öneki boş, yalnız `machines` dolu) ⇒ **bugün bir belge düzeltmesi, yarın migration + kod turu.** ⚠️ DB bayrak anahtarı `tezgah.enabled` **DEĞİŞMEZ** (§9.2: anahtar kimliktir), yani ad asimetrisi bilinçlidir: modeller nötr, bayrak tarihsel. ③
    - **(c) Birim SİNYALDE, sıklık KOŞUMDA, sınıf yalnız ETİKET.** Metre tek formülden doğar (`sayaçDeltası ÷ (unitsPerCm × 100)`, §5.6) ve `machineClass` üstünde **DALLANMAZ**: dallanmak bir `kind`-dispatch olurdu (kök `CLAUDE.md` yasağı) ve sinyal `PICK_COUNTER` derken sınıf `WARP_KNIT` derse *"hangisi kazanır"* sorusunu doğururdu — çift yüklem. Bu yüzden `machineClass` **zorunlu değildir**. ③
    - ⚠️ **AÇIK KALAN:** randımanın paydası hâlâ atkı temellidir (`targetPicksPerMin`, `kopuş/10⁵ atkı`) ve çözgülü örmede/kaplama hattında yapısal olarak null kalır — *"ölçülemedi"* değil, **"model uymuyor"**. Ad turu (`pick*` → `unit*`) borç olarak yazıldı, bkz. #24.

23. **ÜRETİLEN KUMAŞ SAYISI, TÜKETİLEN LEVENT SAYISINDAN BAĞIMSIZ BİR EKSENDİR** (2026-09-12; #19'u ezer). **Sınıf: BİRLEŞTİRİLMİŞ EKSEN** — iki bağımsız gerçek tek sayıya bindirilirse model her iki uçta da **sessizce** yanlış olur, çünkü bir uçta doğru çalışır ve **test edilen uç odur.** Ölçüm: raşel **N levent → 1 kumaş → 1 sayaç**; çift enli tezgah **1–2 levent → 2 kumaş → 2 sayaç.** Dört parça:
    - **(a) `Machine.productionLineCount`** (ÇIKTI) `Machine.warpBeamSlots`tan (GİRDİ) ayrıdır; CHECK `>= 1` ve yönü **tersine çevrilebilirlikle** seçildi (karşı örnek arandı, bulunamadı; gevşetmek tek ifadeli migration, sıkmak veri temizliği). Bilinen gevşetme yolu §2.2b'de yazılı. ②
    - **(b) `productionLineNo` üç tabloya girer** (`MachineRun` · `MachineInterval` PK'sı · `MachineShiftStat` unique'i) ve `machine_runs_one_open_per_machine_uq` → **`machine_runs_one_open_per_prod_line_uq (machineId, productionLineNo)`** olur. **Tek hatlı makinede productionLineNo=1 sabit olduğu için satır kümesi ve reddedilen küme DEĞİŞMEZ — davranış birebir.** Tablolar bugün YOK; aynı iş sonra yapılırsa **tablo yeniden yazımıdır.** ②③
    - **(c) Kanalın anlamı `PeripheralSignal.productionLineNo`da**, konumda değil — ve değeri **kanal kabul testinde BEYAN edilir** (③ aksiyon anında seçim), çünkü türetilemez. Kolon varsayılanı **VERİLMEZ**: `1` karşılaştırma kanalını üretim sayardı (çift sayım), `NULL` tek kanallı kurulumda metreyi öldürürdü — **doğru varsayılan konuma bağlı olduğu için formun işidir** (`slot==1 ? 1 : null` ön-dolu, kilitli değil). ③
    - **(d) Mühür vardiya×makine düzeyinde ATOMİKTİR** ve budayıcı yüklemi pencere başına sorar (§4 ③b) — `productionLineNo` bir unique'i böldüğü için mühür yüklemi de onunla bölündü. **Genel kural: bir tasarım bir TANECİĞİ ya da bir ANLAMI böldüğünde, ona dayanan HER yüklem ve HER formül yeniden sorulur.** ①
    - ⚠️ Kopuş kırılımı `MachineStopEvent.beamSlot`ta; **sayaç kolonları ÇOĞULLAŞTIRILMAZ** (dört okuyucu ölçüldü, §5.4).

24. **BORÇ — ad turu `pick*` → `unit*`, CI YEŞİLE DÖNDÜKTEN SONRA, TEK COMMIT** (2026-09-12). `unitsPerCm` yapıldı ama hız/kapasite terimleri atkı adında kaldı: `picksActual` · `gapPicks` · `targetPicksPerMin` · `targetPickCapacityApt|Pot` · `pickDelta` · `nominalPicksPerMin` · `avg|maxPicksPerMin` → `unitsActual` · `gapUnits` · `targetUnitsPerMin` · `targetUnitCapacity*` · `unitDelta` · `nominalUnitsPerMin` · `avg|maxUnitsPerMin`. **Neden ertelendi:** CI kırmızıyken 78 geçişlik ad turu inerse sonraki her kırmızıda *"bu turdan mı, öncekilerden mi"* sorusu cevapsız kalır — **kontrol grubu kirli** sınıfı, üstelik önceden görülebilir hâlde.
    > ⚠️ **SESSİZ KAPI ÖLÜMÜ RİSKİ — asıl tehlike iş yükü değil budur.** §3.4'ün **birim seddi** bir AST tripwire'dır: *"`picksPerRev` ile `targetPicksPerMin` aynı ifadede geçemez"*. **İkisinden yalnız birini yeniden adlandırırsak desen artık eşleşmez ve bekçi KIRMIZI VERMEDEN korumayı bırakır** — kapı duruyor, yeşil veriyor, hiçbir şey ölçmüyor. `picksPerRev → unitsPerRev` **aynı commit'te**; **`maxRevPerMin` DEĞİŞMEZ** (gerçekten devir/dk'dır ve seddin diğer ucudur — ikisi de `unit*` olsaydı sed kendi iki ucunu ayırt edemezdi).
    > **İNİŞ ŞARTI:** yeniden adlandırmadan sonra tripwire'ın hâlâ SİLAHLI olduğu **negatif sondayla kanıtlanır** — bilerek ihlalli ifade yazılır, kırmızı görülür, geri alınır. **Yeşil koşum bu turda kanıt DEĞİLDİR**, çünkü sorun zaten "yanlışlıkla hep yeşil" olmasıdır.

---

## 11 · Denetim izi

### 11a · Opus — altı mercek (birinci tur)

**Altı mercek · 92 bulgu (26 KRİTİK · 42 ORTA · 24 DÜŞÜK) → 88 işlendi · 4 gerekçeyle reddedildi.**

| Mercek | K/O/D | İşlendi | Reddedildi | Bu belgede nerede |
|---|---|---|---|---|
| **Kabul şartları + bayrak (K2/K3)** | 4/8/3 | 15 | — | §6.2 yer tutucu emekliliği · §6.3 fail-open iki bayrağın adı · §7.1 modül ilişkisi · §8 kabul şartları · §2.1 kapalı kurulum ölçümü |
| **Defter doktrini + telemetri (K1)** | 6/6/3 | 15 | — | §2.7 `MachineStopReclass` · §3.5 dört durumlu replay + span kapanışı · §4 trigger + «Telemetri ≠ defter» bölümü · §2.10 `sealState`/`sealGeneration` · §2.8 koşum `revokedAt` · §2.9 `supersededByEventId` |
| **Çekirdek mimari** | 4/8/6 | 17 | 1 | §3.1 ajan gövdesi · §3.3 uzak/LAN 404 + `EXEMPT` · §6.4 SoD + izin kategorisi · §6.5 panel/mobil ayna · §3.5 `SOURCE_MISMATCH` |
| **Çürütme izi** | 4/8/5 | 15 | 2 | §5.1 duruşun pay edilmesi · §2.1 üç karşı-ilişki · §5.4 kopuş/10⁵ · §3.5 sıra + `bucketMinutes` · §2.4 `lastSeq` |
| **Kod gerçekliği** | 3/7/4 | 14 | — | §6.2 panel tip zinciri · §6.1 `REGIME_GATES` düzeltmesi · §5.6 `unitsPerCm` evi yok · §9 `variance-reasons` emsalinin kaldırılması · tüm `dosya:satır` düzeltmeleri |
| **Ölçek + fazlandırma** | 5/5/3 | 12 | 1 | §9 Faz 1a/1b/2/3 · §5.2 `MINOR` düzeltmesi · §5.2 ISO etiketi · §7.3 levent sahipliği · §2.3 `maxPicksPerMin` nullable |

**Reddedilen dört bulgu:**

| # | Bulgu | Red gerekçesi |
|---|---|---|
| 1 | `ReasonPreset.stopCountsAsBreak` kolonunun geri getirilmesi (çürütme izi, KRİTİK 4'ün ikinci yarısı) | Kopuş sayacı **makine sinyalinden** doğar (`WARP_STOP`/`WEFT_STOP` → `MachineInterval.warpStopCount`), insan sınıflandırmasından değil; ikinci sayım yolu aynı soruya iki cevap veren "çift yüklem" sınıfını üretirdi. Bulgunun kendi şartı gereği red gerekçesi buraya yazıldı; **KPI'ın kendisi (kopuş/10⁵ atkı) İŞLENDİ** (§5.4). |
| 2 | `MachineSampleHold` — budama muafiyeti / "altı ay sonra bu topun dokuma gecesini göster" (çürütme izi, DÜŞÜK 16) | İhtiyaç **ölçülmedi** ve kova zaten 180 gün duruyor; muafiyet tablosu budama seddini delen ikinci bir yüklem açardı. ② Tek fabrika ölçeğinde bugün karşılığı yok. Kardeşi **`tezgah.fineWindowUntil` İŞLENDİ** (§6.3). |
| 3 | `MachineShiftStat.factoryDay`in kaldırılması / `Timestamptz`e çevrilmesi (çekirdek mimari, ORTA 7'nin ikinci yarısı) | Kolon **donmuş rapor eksenidir**, tek yazarı mühürleyicidir ve `unitsPerCmAtClose` ile aynı sınıftadır; her rapor için `ShiftInstance` join'i ödemek pahalıdır. *(Bu satırdaki `Sack.weightKg ↔ SackWeighing` EMSALİ Fable turunda KALDIRILDI — ölçüldü: `shipping.service.ts:461-469` çuval oluşturma yolu defter satırı yazmadan kg yazabiliyor, yani kalıp bir örnek değil bir uyarıdır. Red kararı ayakta; yalnız gerekçesindeki emsal düştü.)* `@db.Date` seçimi `ExchangeRate.rateDate` gerekçesiyle aynıdır (takvim günü anahtarı, an değil). **Muaf sayısı düzeltmesi (Faz 1a'da bir, Faz 1b'de bir) İŞLENDİ.** |
| 4 | Makine ingest yoluna da `clientToken` eklenmesi (çekirdek mimari, ORTA 12'nin ilk seçeneği) | Makine yolunun tekilliği **doğal anahtardır** ve kalem başına token üretmek ajanın kuyruğuna ikinci bir kimlik ekseni sokardı. Bulgunun ikinci seçeneği (409 alan kalem kuyrukta ölür, retry edilmez, sayacı `/api/admin/health`te) İŞLENDİ (§3.5); **insan yolunun `clientToken`ı ise EKLENDİ.** |

**K2'den bilinçli sapma (kullanıcı onayına açık):** K2 `dokuma → devere` bağımlılığını bağlayıcı sayıyor; bu belge onu **kurmuyor** (§7). Ölçüm: `module-flags.ts:77` `iplikEnabled → ticaretEnabled` zinciri gerçektir (`:78` tezgah, `:79` devere — eski `:68` çapası 2026-09-12'de kaydı), dolayısıyla `dokuma→devere→iplik→ticaret` dokumayı açan her müşteriye ticareti zorla açardı ve **K3'ün "zorlamayacak" şartıyla çelişirdi.** Sapma bu dilimde pratik sonuç doğurmuyor (`dokuma.enabled` açılmıyor); karar, anahtar doğduğu gün geçerlidir ve itiraza açıktır.

**Sentezden silinen/düzeltilen atıflar (kod gerçekliği merceği):** `module-flags.ts:43,52` → `:40,51` → **(Fable turunda yeniden ölçüldü) `:40,52,78`** · *"üç yerleşik profilden ikisinde kapalı"* → *"beş profilin üçünde"* → **(yeniden ölçüldü) ALTI profilin DÖRDÜNDE** *(`devereEnabled` ve `perde-dokuma` 2026-09-12'de araya girdi — bu satırın kendisi çapaların ne kadar hızlı bayatladığının kanıtıdır, §6.2)* · *"`test_production_regime_gate` ölü satır sayar"* → **`REGIME_GATES`** · *"`variance-reasons.ts:203` emsali"* → **kaldırıldı** (o cümlenin fail-closed dalı tersiydi) · *"kapanmış dönem RESMİ bir rakamdır" alıntısı `CashPeriodClose`ta*→ **`services/helpers/period-guard.helper.ts:7-16`** · *"8 adımlı reçete"* → **18 maddelik liste, skalerde ~8 gerçek adım** · *"`AUDIT_EXEMPT_MODELS` sabitiyle kodlanır"* → **⚠️ bugün YOKTUR, yaratılacaktır** · `helpers/period-guard.helper.ts` → **`src/services/helpers/…`** · `RollEntrySource.LOOM_DOFF` → **`WEAVING`** · doğrulanmamış marka ürün adları → **çıkarıldı**.

### 11b · Fable düşmanca denetimi (2026-09-12) — ikinci tur

Ayrı bir düşmanca denetim, belgenin **yazılmasından önceki sentez metnini** okudu; ana hükmü *"bu hâliyle şemaya dökülemez"* idi. Hükümler önce belgeyle **EŞLENDİ** (çoğu Opus turunda zaten karşılanmıştı), kalan **63 karşılanmamış hüküm** işlendi: **5 ENGEL · 19 KRİTİK · 34 ORTA · 5 DÜŞÜK**. **63'ü işlendi; iki ALT İDDİA ölçümle reddedildi** (aşağıda). Bu tur bir kural daha doğurdu: *satır numarası çapaları ölçülmeden yazılmaz, kayan listelerde çapa ADA çevrilir* (§6.2).

**Şemaya dökmeyi fiziksel olarak durduran beş ENGEL — hepsi kapatıldı:**

| # | Engel | Nerede kapandı |
|---|---|---|
| 1 | **PG 55P04** — `ADD VALUE` + kolon + CHECK tek dosyadaydı; `migrate deploy` sürüm gecesi ortada kalırdı | §9 Faz 1a: **B1 (enum, dosyada tek ifade) + B2 (kolon+CHECK)**, B1 önce, aynı commit |
| 2 | **P1012** — 13 karşı-ilişki beyan edilmemişti; `prisma validate` ilk duvardı | §2.1 **KARŞI-İLİŞKİ ENVANTERİ** + kural cümlesi; kabul kapısına `prisma validate` |
| 3 | **Hedefsiz levent kolonu** — `MachineRun.warpBeamId` var olmayan tabloya bakıyordu ve yönetici kararına aykırıydı | §2.8'den **SİLİNDİ**; §7.3 `beamsMountedDuring` türetmesi + iki yönlü kapı; §9 Faz 3 |
| 4 | **`perde-dokuma` ad çakışması** — profil repoda VAR, içeriği farklı, tezgah orada KAPALI | §7.2 **KARAR KAPALI** · §6.1 altı profil/dördü kapalı · §10/#10 · profil sayısı **6 KALIR** |
| 5 | **`warpStopCount/weftStopCount NOT NULL`** — tek kontaklı retrofitte *"kopuş yok"* yalanı canlı tabloya Faz 1a'da girerdi | §2.6 · §2.10 **`Int?`** · §5.4 "pay ya da payda NULL → KPI hesaplanmaz" |

**En sert KRİTİK düzeltmeler:** hayalet kova yarışı (ingest artık `_shared`, mühür EXCLUSIVE — §3.5) · kova/duruş yazımının **ON CONFLICT mekanizması** (Prisma `upsert` ve `P2002` yakalama yolu kapatıldı) · **WATCHDOG düzeltmesi** (tahmin mühre kalıcılaşmıyor) · `startedAt`in **saniyeye kuantizasyonu** · **birim seddi** (`maxRevPerMin` ≠ atkı/dk) · vardiya içi **iki koşum paydası** · `unobservedSec`in türetme kuralı · budama yükleminin **insan kararına** daraltılması · mühürlü vardiyada revoke kapısı · `NULLS NOT DISTINCT` · gölge modun **koda** bağlanması.

**Reddedilen iki alt iddia — gerekçe ölçüme dayanıyor:**

| # | Alt iddia | Red gerekçesi (ölçüm) |
|---|---|---|
| 1 | *"`MODULE_PLACEHOLDERS` artık ÜÇ elemandır (kumasTeknik·tezgah·devere); belgenin «tek elemana iner» cümlesi yanlış, İKİ eleman kalır"* | **Ölçüldü: bugün İKİ eleman var** (`Electron/src/lib/module-flags.ts:90-93` → `kumasTeknikEnabled`, `tezgahEnabled`); `devereEnabled` bu listeye GİRMEMİŞ. Tezgah emekli olunca **tek eleman kalır** — belgenin mevcut cümlesi ve #4 beklentisi (`["kumasTeknikEnabled"]`) **DOĞRUYDU**. Yalnız çapa biçimi düzeltildi (satır → ad). Hükmün kardeş yarısı (`flag-modules.ts` `Exclude`'unun ÜÇ anahtar taşıdığı) doğrudur ve **işlendi**. |
| 2 | *"§2.10'a tek `targetPickCapacity` terimi eklenir; `P = picksActual / targetPickCapacity`"* | Tek terim **P'yi E'ye çökertir**: aynı paydayla bölünen iki oran aynı sayıdır ve `A × P = E` kimliği anlamsızlaşır. Hüküm **DÜZELTİLEREK işlendi** — iki terim (`targetPickCapacityApt` P için, `targetPickCapacityPot` E için, §2.10/§5.2) ve kimliğin **tek hedefli vardiyada birebir** olduğu, çok hedefli vardiyada E'nin **kendi tanımından** okunduğu açıkça yazıldı. |

**Belge dışına taşan iki borç** (bu belge tek başına kapatamaz, `/karar-notu` işidir):
1. `docs/kurallar/defter.md`ye **«Telemetri ≠ defter» BÖLÜMÜ** (altı kural) — **üçüncü hard-delete sınıfı DEĞİL** (§4); kök `CLAUDE.md` cümlesi kullanıcı onayında. Faz 2 kabul kapısı, bekçisiyle birlikte.
2. Kök `CLAUDE.md`'nin *"tek istisna `UserPreference`"* cümlesi → `AUDIT_EXEMPT_MODELS` (§10/#8) — Faz 2 kabul kapısı. Ayrıca `docs/design/SEKTOR-YOL-HARITASI.md`'nin *"kopuş AYRI defterdir"* cümlesi Faz 1b'de silinir ve arşive **"GEÇERSİZ → 2026-09-12: kopuş ile duruş tek tabloda, ayrım `stopEventMinSeconds` eşiği + `lossClass`tadır"** notu düşer; kök `CLAUDE.md`'nin `clientToken` sayacı (15) bugün **17** ölçüldü, tazelenmeli.

---

### 11c · Üçüncü tur — sözleşmeler (2026-09-12)

Bu tur **denetim değil, SÖZLEŞME turudur**: ikinci turun açık bıraktığı dört hüküm yönetici onayıyla belgeye işlendi ve beş bayat ölçüm repoda yeniden ölçülerek düzeltildi. Turun kendi kuralı §11b'den devralındı — *satır numarası çapaları ölçülmeden yazılmaz* — ve bu kez ölçüm sonuçları **değerleriyle** yazıldı.

**İşlenen dört sözleşme (dördü de KABUL, tamamı işlendi):**

| # | Sözleşme | Belgede nerede |
|---|---|---|
| 1 | **Telemetri hükmü** — `defter.md`ye ÜÇÜNCÜ hard-delete sınıfı AÇILMAYACAK | §4 doktrin kutusu (yeniden yazıldı) · §0 · §1 · §2.11 · §8.3 · §9 Faz 2 kapısı ① · §11a tablosu · §11b borç ① |
| 2 | **Budama bekçisi sözleşmesi** — okuma kümesi MANİFEST | §4 *"Budama bekçisinin SÖZLEŞMESİ"* (yeni alt bölüm: R1–R7 / T1–T3 · dört AST kuralı · N1–N8) · §2.8 `stopSecAtClose`/`stopCountAtClose` · §4 koşum ekseni · §6.3 `maxOpenRunDays` · §9 Faz 2 |
| 3 | **Faz 2 zaman/eşzamanlılık sözleşmesi** | §1 (ortak cümle) · §2.6 (`restateCount` + observed CHECK) · §2.7 (`stopKey` · `provisionalEndedAt`) · §2.10 (`gapPicks` · `watchdogSec`) · §3.5 (kimlik · ON CONFLICT ×2 · watchdog · kova boyu) · §5.1 · §5.2 · §5.6 |
| 4 | **Gölge mod: reçete değil KOLON + KAPI** | §2.2 (enum üç değerli) · §2.3 (`OFF` varsayılan + demote + üç kapı) · §2.3 `PeripheralSignal.acceptedAt` · §2.10 (donmuş `monitoringState`) · §3.3/7 · §5.3/8 · §6.3 (iki yeni bayrak) · §6.4 · §9 Faz 1a/Faz 2 · §10/#14, #15 · §12 |

**Tersine çevrilen iki cümle:**
1. *"Üçüncü bir hard-delete sınıfı (⑤ telemetri budaması) açılır"* → **AÇILMAZ.** Telemetri bir silme sınıfı değil, **defter-olmayan satırın yaşam döngüsüdür**; `defter.md`ye sınıf değil **bölüm** girer ve budama izni bir **bekçiyle ölçülerek** verilir. Gerekçe §4'te: sınıf listesi bir gün "silinebilir şeyler listesi"ne dönüşür.
2. *"Ingest advisory kilit ALMAZ"* → **ALIR.** Mühür `pg_advisory_xact_lock` (**EXCLUSIVE**, uzay 8032), ingest aynı anahtarda **`pg_advisory_xact_lock_shared`**; emsal `master-data-live.helper.ts:68`. Bu çevirme §11b (Fable C1) turunda yapılmıştı ve bu turda **doğrulandı** — §3.5'in sonundaki karar ile §2.6'nın `NOT EXISTS (<mühürlü pencere>)` yüklemi artık aynı cümlenin iki yarısıdır (kilit yarışı kapatır, yüklem check-then-act'i kapatır).

**Yeniden ölçülen beş çapa (ESKİ → YENİ, ölçüm 2026-09-12):**

| # | Nerede | Eski (bayat) | Yeni (ölçülen) |
|---|---|---|---|
| 1 | `guarded-hard-remove.ts` `MACHINE_DELETE_GUARDS` (§2.1) | `:236-279`, **beş** sayaç | **`:236-273`, ALTI sayaç** — `rollOperationCount · rollMovementCount · rollCreatedCount · workSessionCount · deviceCount · kursunBypassCount` |
| 2 | `test_module_flag_off.ts` `MODULLER` (§8.1 K3-3) | `:136-190`, **dört** satır · türetme `:196-207` | **`:136-204`, BEŞ satır** (`ticaret · iplik · devere · depoMulti · production`) · türetme bloğu **`:216-222`** |
| 3 | Aynı bekçide sessizce atlanan HTTP kontrolü (§8.1 K3-2) | **14** (`:517-521`) | **18** — sayı tablodan türer: `5 + 2 + 1 + 5 + 5`. ⚠️ Bu turda yazılan `:524-528` çapası YANLIŞTI (orası profil damgası yorumu); doğrusu **`:551-552`** (`httpKontrolSayisi` formülü) ve dördüncü turda düzeltildi — §11d |
| 4 | `screen-catalog.ts` · `test_feature_flag_contract.ts` (§6.2) | `screen-catalog.ts:387` · `…contract.ts:115` (**yanlış modül**: 115 `kumasTeknik`) | **tezgah nesnesi `:391-396`** (kumasTeknik `:385-390`) · **`:116` `tezgahEnabled`**, `:115` `kumasTeknikEnabled` — talimat yine **ADA** bağlı, numaralar yalnız doğrulama içindir |
| 5 | `MODULE_PLACEHOLDERS` · `flag-modules.ts` `Exclude` (§6.2/#3, #5) | çapasız | **`module-flags.ts:90-93`, İKİ eleman** · **`flag-modules.ts:65-68`, ÜÇ anahtar** — iki ölçüm de belgenin cümlesini DOĞRULADI, yalnız çapa eklendi |

**Ek olarak düzeltilen üç çapa (aynı bayatlama sınıfı):** `module-flags.ts:60-61` → **`:62-63`** · `module-flags.ts:68` → **`:77`** (`:78` tezgah, `:79` devere) · `test_module_flag_off.ts:302-310` → **`:304-315`**.

**Eklenen kapı:** **Faz 3'ün kabul kapısı ve bekçi listesi YOKTU** (Faz 1a, 1b ve 2'de vardı) — §9'da diğer fazların kalıbıyla yazıldı: levent olay defteri + durum kolonları + sed + `beamsMountedDuring` + mutabakat bekçisi **AYNI sürümde** çıkar.

**Bu turda düşen bir bayrak:** `tezgah.stopMatchToleranceSec` (§6.3) — duruş kimliği `stopKey`e taşınınca tolerans penceresi gereksizleşti; bayrak sayısı **14 → 16** (üç eklendi, biri düştü).

---

### 11d · Dördüncü tur — tutarlılık (2026-09-12)

Bu tur **yeni karar üretmedi**: bağımsız bir doğrulayıcı belgeyi baştan sona okudu, mimariyi ve sözleşmeleri **yerinde** buldu (sulanma yok) ve yalnız **belge içi çelişkileri** saydı. Bulgular **6 ağır + 17 küçük**; ağır olanların ölçütü *"harfiyen uygulanınca YANLIŞ SONUÇ üretir"*.

| # | Ağır çelişki | Ne değişti |
|---|---|---|
| 1 | §2.7 başlığı "(FAZ 2)" diyordu, §9 `MachineStopEvent`i **Faz 1b**'de doğuruyordu | Başlık **FAZ 1b** oldu; makine kaynaklı alanların "KOLON 1b / YAZAR 2" ayrımı başlığın altına yazıldı |
| 2 | `stopEventMinSeconds` "Faz 2" ve *"eşikleyeceği tablo Faz 2'de doğuyor"* diyordu | Bayrak **Faz 1b** — eşiklediği tabloyla AYNI fazda (§6.3); §9 Faz 2'nin bayrak sayısı **13 → 12** |
| 3 | `CLOCK_SKEW` bir yerde *"aşan PAKET 400"*, başka yerde *"PAKETİ değil KALEMİ düşürür"* | Tek doğru bırakıldı: **kalem düşer, `rejected[]` ile döner**; §6.3'teki paket cümlesi düzeltildi |
| 4 | §5.4 kimliği `gapPicks`siz yazılmıştı ve çok koşumlu vardiyada `targetPicksPerMin` NULL olabiliyordu | Kimlik `gapPicks`li hâle getirildi + **"yalnız TEK HEDEFLİ vardiyada birebir"** şerhi; çok hedefli vardiyada E **kendi tanımından** okunur |
| 5 | Guard fazlaması üç yerde üç farklı sayı veriyordu (1a:1 · 1b:1 · 2:2 ↔ *"dört Restrict adıyla"* ↔ *"üç sayaç"*) | **§2.1'in yolu TEK KAYNAK** ilan edildi; §2.8 ve §9 Faz 2 ona hizalandı (**iki sayaç** eklenir, toplam dört) |
| 6 | Faz 1a bekçi listesinde `Σ observedSec + unobservedSec = calendarSec` vardı — ama Faz 1a'da **kova YOK** ve `unobservedSec = 0` BEYAN ediliyor | Bekçi doğuşta kırmızı verirdi: eşitlik **Faz 2 ayağına** taşındı, Faz 1a'da **kırpma + `Σ breakdown ≤ POT`** kaldı |

**On yedi küçük hizalamanın hepsi kapandı:** eski duruş kimliği (`machineId + startedAt + source`) düzeltmenin içinden temizlendi → **`(machineId, stopKey)`** · bayrak sayısı tek sayıya (**16**) indi ve `stopMatchToleranceSec`in düştüğü not edildi · `minClassificationPct` metinden çıkarıldı (tablo 16 bayrağın tamamıdır) · `gapPicks` üç yerde **"paydan düşülür, paydaya girmez"** oldu · `test_hard_delete_guard_coverage` Faz 1a bekçi listesine eklendi · `anomalyAck` **kolon 1a / kapı 2** olarak hizalandı · *"onaysız mühür 400"* → **409** · `prune_safety` **dört ayak** · Faz 1a bekçi sayımı listeye göre **4 yeni + 10 mevcut** · `machine_intervals_bucket_chk` §2.6 envanterine yazıldı · `MachineShiftStatSeal`e **`@@unique([statId, sealGeneration, action])`** · `MachineRun`a **`machine_runs_natural_uq`** partial unique · `microStop*` → **`minorStop*`** (tek ad) · bölüm numaraları bitişik yapıldı (**§7.1/§7.2/§7.3** ve **§11a–§11d**) ve atıflar hizalandı · izin sayımı *"yedi `loom:*`"* → **altı `loom:*` + bir `mobile:*`**.

**Düzeltilen çapalar (bu turun tek kod ölçümü):** ① `test_module_flag_off.ts`in 18 HTTP kontrolünü türeten formül **`:551-552`**tedir (`httpKontrolSayisi`); üçüncü turda yazılan **`:524-528` YANLIŞTI** — o aralık profil damgası yorumudur (§8.1 K3-2, §11c tablosu #3). **Sayının kendisi (18) doğruydu.** ② §11a'daki bayat `module-flags.ts:68` → **`:77`** (`:78` tezgah, `:79` devere) — §11c'nin zaten düzelttiği çapa, §11a'da bayat kalmıştı.

**"Açık soru yok" cümlesi neye çevrildi:** belge İKİ yerde *"kullanıcıya açık soru bırakılmadı"* diyordu, oysa **üç ONAY KALEMİ** (kök `CLAUDE.md`'ye girecek «Telemetri ≠ defter» cümlesi · `AUDIT_EXEMPT_MODELS` + *"tek istisna `UserPreference`"* değişimi · K2 sapması `dokuma → devere`) ve **iki SAHİPSİZ İŞ KALEMİ** (`kur.ps1` NTP adımı · `TEKSERP_STRICT` koşucu) açıktı. İki cümle de **"üç onay kalemi + iki sahipsiz iş kalemi dışında"** biçimine çevrildi; beşi §0'ın başlığında **adıyla** listelendi (onay kalemleri ayrı, iş kalemleri ayrı), §10 başlığı oraya atıf veriyor.

---

## 12 · Tasarımın kendi zayıf noktaları — saklanmadan

- **Retrofit sinyalinin sessiz yanlış yorumu** en büyük risktir. Sentez bunu *"teknik değil süreç önlemi"* diye bırakıyordu — **düzeltildi ve önlem artık ÜÇ KATMANLIDIR: KOLON + KAPI + SÜREÇ.** Kolon `monitoringState` (OFF/SHADOW/LIVE) ve kanal kabul damgaları; kapı `go-live`ın üç şartı + `signals/:id/accept`in gözlem şartı + `CHANNEL_CHANGE_REQUIRES_SHADOW`; süreç ise kanal kabul testi + en az 5 iş günü gölge mod + `observedSec` beyanı (§2.3/§5.3, bekçi `test_machine_shadow_mode`). Risk azalır ama **sıfırlanmaz**: üç kapıyı da geçen bir kurulumda LIVE'a basan insan, sinyali gerçekten anlamadan da basabilir — kapı gözlemi zorunlu kılar, doğru yorumu değil.
- **Duruş frekansı ölçülmedi** — budanmayan kısmın boyutu buna bağlı.
- **Sayaç sıfırlaması ile 16-bit sarma ayırt edilemeyebilir**; tasarım bunu uydurmuyor (`RESET` + onay) ama karne "eksik" olabilir ve rapor `warnings` şeridini çizmezse kullanıcı eksik sayıyı tam sanar.
- **`MachineStopEvent` iki yaşam sınıfını tek tabloda taşıyor.** Dört sedle korunuyor (§4) ama bu, doktrinin bilinçli bir istisnasıdır ve bedeli yazılıdır: sınıf satır bazlı ve **çalışma zamanında değişiyor** (sebep atanınca telemetri deftere terfi ediyor).
- **Faz 1a'nın verisi insandan geliyor.** Elle girilen bir vardiya karnesi, telemetriden gelen karneyle aynı tabloda yaşar ve ayrımı yalnız `source` kolonu taşır — rapor bunu beyan etmezse kullanıcı ikisini karıştırır.
