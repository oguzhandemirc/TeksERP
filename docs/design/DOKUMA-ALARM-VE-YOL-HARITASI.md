# Dokuma — Alarm/Bildirim Tasarımı, Eksik Listesi ve Yol Haritası

> **Durum: A1 uygulandı (backend: A1a motor + A1b uçlar/kişi eylemleri/izinler); A2a panel (zil · liste · sayfa · salon) ve A2b (şerit · ses · OS bildirimi · TV sesi · ayar satırları · hedef süre sütunu) uygulandı; A2 bitirişi (uçtan uca prova + ekran görüntüleri) sırada; S2–S5 1e varsayılanları kullanıcı onayı bekliyor.** 1e kararı 2026-10-11: vadesi eşit kademeler birlikte çalar (pay 0 → K1 ve K2), yalnız daha önce geçmiş alttaki atlanır. 1e varsayılanları (2026-10-11, yetki devri; hepsi ayar/faz ile geri döndürülebilir): Soru 2 = (a) üstlenilse de süre dolunca üst kademeye gider (ayar `tezgah.alarm.escalateWhenAcked`, varsayılan AÇIK; kapatılırsa (b)) · Soru 3 = `tezgah.alarm.unclassifiedTargetMinutes` varsayılan BOŞ (bugünkü davranış; öneri 15 dk) · Soru 4 = (a) yetkiye göre (`loom:alarm-*`) · Soru 5 = (a) vardiya dışı alarm doğmaz · `tezgah.alarmEnabled` varsayılan KAPALI. Görünen adlar: "Dokuma İş Emri" (WeavingOrder), "Terbiye İş Emri" (WorkOrder).

> **Tarih:** 2026-10-11 · **Kaynak ağaç:** `origin/main` @ `9d1d674ee` (ana ağaç eski commit'te; bütün ölçümler `git show/grep origin/main` ile)
> **Okuyucu:** ürünü satan kişi (karar verecek). Kod yok; tasarım + plan.
> **Bağlam:** Tezgah Salonu çoklu seçim/iş verme planı ayrı belgede (`docs/design/TEZGAH-SALONU-SECIM-IS-VERME.md`, maddeleri burada **D1…D18** diye anılır, tekrarlanmaz). Canlı ekran tasarımı `docs/design/DOKUMA-CANLI-EKRAN.md` (§5 uyarı zinciri), tezgah izleme `docs/design/DOKUMA-TEZGAH-IZLEME-TASARIMI.md`.
> **İşaretler:** **[ÖLÇÜLDÜ]** kodda görüldü (dosya yazılı) · **[YOK]** arandı, bulunamadı · **[ÖLÇÜLMEDİ]** bakılmadı · **[VARSAYIM]** rakip ürünler/sektör bilgisi, doğrulanmadı.

---

## 0 · Kısa özet

- **Bugün sistem duruşun "hedef süresini aştığını" BİLİYOR ama KİMSEYE SÖYLEMİYOR.** Sebep kataloğunda hedef süre, fabrika ayarında iletim payı var; ikisi duruşa donuyor; Tezgah Salonu ekranı kademeyi (süre içinde / aştı) renkle gösteriyor. Bildirim, sorumlu kişi, "üstlendim", patrona iletim **yok** — ekrana bakan görür, bakmayan görmez.
- **En değerli ve dış altyapı gerektirmeyen ilk adım:** fabrika sunucusunda çalışan bir **alarm motoru** + panelde **alarm zili, sesli uyarı, kırmızı şerit** + tıklayınca açılan **"durumu anlatan" alarm sayfası**. İnternet, mağaza hesabı, yeni paket istemez; bugünkü elle duruş kayıtlarıyla çalışır (operatör tabletten "Duruş bildir"e bastığı an süre başlar).
- **Telefona/saate bildirim ikinci adımdır** ve bir kullanıcı kararı ister (internet üzerinden mi, yalnız fabrika Wi-Fi'ında mı). **Patron telefonu** için altyapının büyük kısmı patron bulutunda zaten yazılı (Expo push, web push, tekrar önleme, sessiz saat); eksik olan fabrikanın alarmı buluta taşıması.
- **Satışı etkileyen en büyük üç eksik (alarm dışında):** ① bir dokumacının birden çok tezgaha baktığı gerçekliğe uygun **hol tableti** (bugün tablet tek tezgaha kilitli) · ② **dokuma hatasının tezgaha/dokumacıya bağlanması** ve kumaş puanlama · ③ **otomatik veri toplama** (sensör, Faz 2 — bugün hiç kodu yok).

---

## 1 · Ölçüm — bugün kodda ne var

### 1.1 Bildirim altyapısı

| Kanal | Durum | Kanıt |
|---|---|---|
| **Panel zili** | **[ÖLÇÜLDÜ] VAR ama alarm DEĞİL:** "Son Aktivite" — audit kaydını (`SystemLog`, DOMAIN) 60 sn'de bir okur, yalnız `admin:settings` iznine görünür. Kök kural gereği (audit yalnız ayak izi) **alarm bunun üstüne kurulamaz**; ayrı bir zil gerekir. | `NotificationBell.tsx` (2026-10-24 kaldırıldı → sayaçsız Etkinlik sayfası `/system/activity`) |
| Panel sesi / işletim sistemi bildirimi | **[YOK]** — `new Audio`, `Notification` çağrısı yok. Windows bildirimi için ön koşul hazır: `app.setAppUserModelId` çağrılıyor. | `Electron/electron/main.ts:121` |
| Panel canlılığı | **[ÖLÇÜLDÜ]** WebSocket/SSE yok; ekranlar **yoklama** ile tazelenir (Tezgah Salonu 5 sn, react-query). | `DOKUMA-CANLI-EKRAN.md` §6, `useLoomFloorLive.ts` |
| **Tablet/telefon (saha uygulaması)** | **[YOK]** bildirim paketi (`expo-notifications` mobilde yok). **[ÖLÇÜLDÜ]** `expo-audio` ve `expo-haptics` kurulu (ses + titreşim uygulama açıkken kullanılabilir). Dokuma ekranında yoklama yok. | `mobil/package.json:35,39` |
| **Patron uygulaması push** | **[ÖLÇÜLDÜ] VAR (kodda):** `expo-notifications` + Expo push + web push (VAPID), tekrar önleme (`dedup_key` UNIQUE), sessiz saat, makbuz yoklaması, bildirime dokununca yalnız uygulama içi yol (`safeRoute`). 7 tür: gelen kutusu, stok eşiği, geciken sipariş, günlük üretim, eşitleme gecikti, yedek, çek vadesi. **Dokuma/tezgah türü YOK.** Varsayılan kip `kapali`; `gercek` yalnız mağaza hesapları + patron VDS kurulumundan sonra (`patron-bulutu.md` B5). | `patron/sunucu/src/catalog/notifications.ts`, `patron/uygulama/src/push/` |
| Fabrikadan buluta veri | **[ÖLÇÜLDÜ]** imzalı çıkan eşitleme; aralık kiradan 1–60 dk (varsayılan 5); "zil" ile anlık tur (iki tur arası ≥30 sn). Tezgah duruşları ve koşumlar **projeksiyon dışı** ("isteğe bağlı rapor"). Bulut bildirim tarayıcısı 30 sn'de bir döner. | `Teks-Erp/src/jobs/cloud-sync.job.ts:28-31`, `cloud-sync/projections.ts:187-188`, `patron/sunucu/src/config.ts:73` |
| Telegram / e-posta | **[ÖLÇÜLDÜ]** yalnız **satıcı sunucusunda** (bize gelen olaylar: `EPOSTA`, `TELEGRAM`). Fabrika sunucusunda e-posta/Telegram yok. | `satici/sunucu/src/notifications/catalog.ts:33` |
| Arka plan işleri | **[ÖLÇÜLDÜ]** `setInterval` kalıbı (node-cron yasak), tek süreç; örnek `machine-shift-close.job.ts` (30 dk, `dokuma.enabled` kapalıyken "disabled", test için `now` enjeksiyonu). | `Teks-Erp/src/jobs/` |

**Çevrimdışı fabrika:** sunucu internete çıkamıyorsa bugün yalnız fabrika içi yüzeyler (panel, tablet, TV) çalışır; patron push'u ancak eşitleme döndüğünde ve yalnız hâlâ geçerliyse gitmelidir (§A.8).

### 1.2 Eskalasyon hesabı

- **[ÖLÇÜLDÜ]** Sebep kataloğu satırında `ReasonPreset.targetMinutes` (1–1440, panelden düzenlenir: `Electron/src/pages/ReasonPresets/ReasonPresetDialog.tsx`). **Sistem sebeplerinin hiçbirinde varsayılan hedef yok** (`constants/reason-presets.ts`te `targetMinutes` 0 kez) → fabrika girmedikçe süre izlenmez.
- **[ÖLÇÜLDÜ]** İletim payı fabrika ayarı `tezgah.escalationGraceMinutes` (0–1440, varsayılan 0; izin kapsamı `settings:dokuma`).
- **[ÖLÇÜLDÜ] Duruşa donar:** `machine_stop_events.targetMinutes` + `escalationGraceMinutes`, tek yazar `freezeStopEscalation` (aç · sınıfla · yeniden sınıfla). Hedef sebep değişince yeniden kopyalanır; pay bir kez donar.
- **[ÖLÇÜLDÜ] Kademe yalnız OKUMADA hesaplanır:** backend `loomStopTier` → `UNTRACKED | WITHIN | OVERDUE` ("patrona İLETİM bu dilimde yok"), `escalationDueAt` = başlangıç + hedef + pay. Panelin `ESCALATED` kademesi gerçek veride **hiç kullanılmaz** (yalnız örnek veri). Plan dışı (`NON_SCHEDULED`) ve hedefsiz duruş izlenmez.
- **⚠️ Bulgu:** operatör sebep seçmeden "Duruş bildir" derse (izinli: `requiresReason` borcu) hedef **NULL** kalır → bu duruş **hiçbir zaman** "aştı" olmaz. Alarm tasarımı bunu kapatmalı (§A.2).
- Kaynak: `Teks-Erp/src/services/helpers/loom-floor.helper.ts:16-39`, `helpers/machine-stop-context.helper.ts:114-130`, `loom-floor.service.ts:193`.

### 1.3 Sorumlu / görevli

- **[YOK]** hol, vardiya, tezgah ya da sebebe bağlı "sorumlu" (ustabaşı, bakımcı) kavramı. `ShiftDefinition`da amir alanı yok; kullanıcıda hol/istasyon kapsamı yok. Canlı ekranda görevli/patron adları "—" (`DOKUMA-CANLI-EKRAN.md` §6).
- **[YOK]** duruşu **kim bildirdi / kim kapattı**: `MachineStopEvent`te yalnız `classifiedById` (sebebi kim atadı) var. Koşumu açan kullanıcı da tutulmuyor. Dolaylı iz: tablet oturumu (`WorkSession`: kullanıcı + makine + zaman).
- **[ÖLÇÜLDÜ]** "Hol" = tezgahın bağlı olduğu istasyon (`loom.station`). Rol şablonları: Üretim Süpervizörü (`loom:*` izinlerinin hepsi), Üretim Planlama, Kalite, mobil operatör şablonları; dokumacıya özel mobil şablon yok.

### 1.4 Dokuma modülünün yüzeyleri (özet envanter)

| Alan | Bugün | Kaynak |
|---|---|---|
| Panel ekranları | Dokuma İşleri · Leventler · Çözgü Kartları · Tezgah Duruşları · Vardiya Tanımları · **Tezgah Salonu** (+ TV kipi `#/tezgah-tv`) · İplik Stoğu · Dokuma Raporları | `Teks-Erp/src/constants/screen-catalog.ts:204-349` |
| Tablet | **Tezgah** (top indir, koşum aç/kapa, duruş bildir/kapat/sebep, levent paneli) · Levent Sarım · Fason Dokuma Kabul | `mobil/src/screens/Modules/Dokuma/` |
| Raporlar | Randıman (kullanılabilirlik ve performans ayrı) · Duruş Pareto · Vardiya Karnesi (mühürlü) · Üretim zinciri (levent→iş→top) | `routes/reports/dokuma.report.routes.ts` |
| Dokuma işi | Planla → aç → kapat/iptal (`DK…` no); koşum işe bağlanır; sipariş satırı pivotu opsiyonel | `dokuma.md` Kararlar |
| Levent/devere | Plan → sar (iplik brüt çıkar, dip ayrı döner) → hazır → tezgaha tak → otomatik tüketim; fason çevrimi; raşel takımı | `dokuma.md` levent maddeleri |
| Doff | İndirme olayı; top KK1'de doğar (`entrySource=WEAVING`); geri alma | `dokuma.md` |
| Kalite | KK1'de **hata metresi** (`RollError.startMeter`, hata türü) VAR; top → doff → tezgah zinciri VAR; **tezgaha göre hata raporu YOK**, **puanlama (4 puan vb.) YOK** | `schema.prisma` `RollError`, `reports/quality-scorecard.report.service.ts` (makine atfı yok) |
| İplik | Çözgü çıkışı/iadesi, lot, karantina; **atkı ipliği tüketimi YOK** (`YarnMovementKind`da atkı çıkışı yok) | `schema.prisma` `YarnMovementKind` |
| Tezgah künyesi | Backend `/api/machine-specs` (ağızlık tipi, nominal devir, gölge mod) VAR; **panel ekranı YOK** ("Devreye Alma" ayrı dilim) | `screen-catalog.ts:466` |
| Sensör/toplayıcı | **[YOK]** — `kenar/` dizini yok, ingest ucu yok, `MachineInterval`/`MachineLiveState` modeli yok; `MachineCollector` tablosu boş iskelet | repo kökü, `routes/` listesi |
| Bakım · yedek parça · operatör performansı · prim | **[YOK]** — şemada model yok | `schema.prisma` arama |
| Patron uygulamasında dokuma | **[YOK]** — tezgah tabloları projeksiyon dışı | `cloud-sync/projections.ts:187` |

---

## A · Alarm / bildirim tasarımı

### A.1 Amaç ve kapsam

*"Bir tezgah, sebebine göre kabul edilebilir süreden uzun duruyorsa, doğru kişi telefonuna/ekranına bakmadan haberdar olsun; o kişi çözmezse bir üst kişi haberdar olsun; herkes tek dokunuşla durumu anlatan sayfaya gitsin."*

Kullanıcının örneği: *ip atlama* (katalogda yok — fabrika panelden sebep ekler, hedef 10 dk girer). Hedef 10 dk, pay 10 dk → 10. dakikada ustabaşı, 20. dakikada patron.

**İlk sürüm yalnız TEZGAH DURUŞU alarmını** kapsar. Motor, ileride başka türlere açık kurulur (levent bitiyor, sebep bekleyen duruş birikti, açık koşumu olmayan çalışan tezgah, iplik lotu karantinada).

### A.2 Kural modeli

**Kademe tanımı** — her kademe "ne zaman" ve "kime" sorusunu cevaplar:

| Kademe | Ne zaman (varsayılan biçim) | Kime (ilk sürüm: yetkiye göre) | Not |
|---|---|---|---|
| **K0 — Tezgah durdu** (opsiyonel) | duruş açıldığı an | tezgahın holünün görevlisi | Vizyondaki "tezgah durdu → görevlinin saatine". Gürültülü olabilir; varsayılan **kapalı**, sebep başına açılır (ör. yalnız `MEKANIK_ARIZA`). |
| **K1 — Hedef aşıldı** | başlangıç + **sebebin hedef süresi** | `loom:alarm-view` sahibi herkes (usta/amir) | Bugünkü `OVERDUE` anı. |
| **K2 — Üst kademe** | başlangıç + hedef + **iletim payı** | ayrıca `loom:alarm-escalation` sahipleri (müdür/patron) | Bugünkü `escalationDueAt`. |
| K3 (ileride) | + ikinci pay | patron telefonu (bulut) | Profil verisi; ilk sürümde K2 = patron. |

**Kurallar (değişmez kısım):**
1. **Hedefin kaynağı sebep satırıdır** (karar 2026-10-09; zaten indi). Kademe süreleri **profil verisidir**, kodda sayı yoktur.
2. **Kademe planı alarm doğduğunda alarma DONAR** (sebep etiketinin donması emsali); ayar değişikliği açık alarmı değiştirmez, geçmişi hiç değiştirmez. Sebep sonradan değişirse (sınıflandırma) hedef bugünkü gibi yeniden kopyalanır ve **henüz çalmamış** kademelerin zamanı yeniden hesaplanır; çalmış kademe "ne oldu"dur, silinmez.
3. **Plan dışı duruş (`NON_SCHEDULED`: sipariş yok, tezgah kapalı) alarm doğurmaz** (bugünkü `UNTRACKED` kuralı). Planlı duruş (mola, planlı bakım) yalnız sebebine hedef girildiyse alarm doğurur ("mola 30 dk'yı aştı").
4. **Sebepsiz bildirilen duruş** için yeni fabrika ayarı `tezgah.alarm.unclassifiedTargetMinutes` (ör. 15). **Varsayılan boş = bugünkü davranış** (sebepsiz duruş izlenmez). Doluysa sebep seçilene kadar bu hedef kullanılır; sebep seçilince sebebinkine geçer. **2026-10-12:** açma/kapama ayrı anahtardır (`tezgah.alarm.unclassifiedEnabled`; satır yoksa süreden türer), kapatmak süreyi silmez.
5. **Vardiya dışı:** duruş anını kapsayan aktif vardiya yoksa (`shiftInstanceId` boş ya da vardiya iptal) duruş o an alarm doğurmaz — tezgah zaten planlı çalışmıyordur. Duruş açık kalıp bir vardiyaya TAŞARSA hedef saati taştığı ilk canlı vardiyanın başından işler ve alarm o vardiya sürerken doğar (backend 2.15.5, `alarmClockStart`); hiç vardiyaya değmeyen duruş alarm doğurmaz. Doğmuş alarm vardiya bitince kapanmaz. (Soru 5 bunu değiştirebilir.) **2026-10-12:** fabrika `tezgah.alarm.noShiftMode` ile seçer — `WARN` (bu madde, varsayılan) · `ALWAYS` (vardiyaya bakılmaz) · `REQUIRE_SHIFT` (vardiya tanımı yokken alarm açılamaz); §A.10. Patron telefonunda bulutun **sessiz saat** ayarı ayrıca geçerlidir (zaten var).
6. **Geç girilen kayıt:** operatör geçmiş saatli duruş girerse (≤36 sa beyan penceresi) motor vadesi geçmiş **bütün** kademeleri tek tek çaldırmaz; **yalnız en yüksek vadesi geçmiş kademeyi** bir kez çaldırır, alttakileri "atlandı" yazar (sağanak önleme). Sunucu yeniden başladığında da aynı kural.
7. **Sensörsüz tezgahta süre, kaydın beyan edilen başlangıcından sayılır** ve alarm sayfası kaynağı yazar ("Elle kayıt — süre operatörün bildirdiği andan"). Sensör (Faz 2) geldiğinde motor değişmez; yalnız duruşun kaynağı `MACHINE` olur.

### A.3 Alarmın yaşam döngüsü

```
           (motor, vade geldi)        (kişi "Üstlendim")          (tezgah çalıştı / duruş kapandı)
 DURUŞ ──► AÇIK (K1 çaldı) ──► ÜSTLENİLDİ (kim, ne zaman) ──► ÇÖZÜLDÜ (kendiliğinden)
              │   ▲  (+pay)          │                              ▲
              │   └── K2 çaldı ◄─────┘ (üstlenmek K2'yi DURDURMAZ*)  │
              ├── SUSTURULDU (kişi, X dk; yalnız tekrar-çalmayı keser, üst kademeyi değil)
              └── İPTAL (duruş geri alındı · plan dışına sınıflandı)
```
\* 2026-10-09 kararı: *"Görevlinin tezgaha gelmesi zinciri durdurmaz — ölçülen müdahale değil ÇÖZÜM süresidir."* Bu varsayılan; fabrika isterse değiştirebilsin mi → Soru 2.

- ~~**Görüldü**~~ — **A1'den ÇIKARILDI (1e, 2026-10-11):** "görüldü" raporlanan hiçbir sayıyı değiştirmez ⇒ defter değildir (silinince sayı değişmiyorsa defter değil); üstlenme (ACK) zaten zaman çizgisinde. İhtiyaç doğarsa defter dışı (telemetri) olarak ayrı tasarlanır.
- **Üstlen / Bırak:** tek kişi üstlenir (atomik claim; ikinci kişiye 409 "Ahmet Usta 14:32'de üstlendi"); "Bırak" karşı olaydır (ters mekanizma).
- **Tekrar çalma:** üstlenilmemiş ve susturulmamış alarm `tezgah.alarm.renotifyMinutes` (varsayılan 10) aralıkla yeniden ses/bildirim verir. Panel ve tablet tarafında bu bir **görüntü kararıdır** (yeni satır yazmaz); telefon push'unda her tekrar kendi tekrar-önleme anahtarını taşır (`alarm:<id>:k<n>:r<m>`).
- **Susturma:** 15/30/60 dk seçenekli, sebep notu opsiyonel; defterde "kim, ne kadar". **Üst kademe susturmayla durmaz** — alarm saklanamaz.
- **Kapanış kendiliğindendir:** duruş kapanınca (`endedAt`) alarm ÇÖZÜLDÜ; toplam süre ve "hedefi kaç dk aştı" kapanış anında alarma donar (rapor bunu okur, yeniden hesaplamaz).

### A.4 Kayıt sınıfı (kök kurallara göre)

Kök testi: *"bir satır silindiğinde raporlanan bir sayı değişiyor mu?"* — Alarm zinciri ("hedefi aşan duruş sayısı", "ortalama üstlenme süresi", "patrona giden alarm sayısı") **rapora girecek** ⇒ **DEFTER**. `DOKUMA-CANLI-EKRAN.md` §5.4/4 zaten hükmetmiş: *zincir damgaları duruşun kendi hareket satırlarında durur, audit'ten türetilmez.*

| Tablo (öneri ad) | Sınıf | İçerik |
|---|---|---|
| `LoomAlarm` | **DURUM** ("şu an ne") | `stopEventId` (unique, FK), `kind` (enum, ilk değer `STOP_OVERDUE`), `state` (OPEN · ACKED · RESOLVED · CANCELLED), `ackedById/At`, `snoozedUntil`, donmuş kademe planı, kapanışta donan `overdueSec`/`totalSec`. Yeni tür = yeni nullable FK + XOR CHECK (fason kalemi ROLL\|WARP_BEAM emsali). |
| `LoomAlarmEvent` | **DEFTER** (append-only, yalnız `createdAt`) | `RAISED(k)` · `TIER_SKIPPED(k)` · `ACK(user)` · `ACK_RELEASE(user)` · `SNOOZE(user, until)` · `UNSNOOZE` · `NOTE(user, metin)` · `NOTE_RETRACT(user, retractsEventId)` · `PUSH_QUEUED(k)` (buluta iletildi; A5) · `RESOLVED` · `CANCELLED(sebep)`. Ters mekanizmalar `scripts/lib/defter-beyan.ts`te beyan (tipli enum çifti): ACK↔ACK_RELEASE, SNOOZE↔UNSNOOZE, NOTE↔NOTE_RETRACT (not silinmez/değişmez; geri çekme ayrı satır, not başına bir kez), RAISED/TIER_SKIPPED↔CANCELLED; RESOLVED terminal. Aynı tx'te çok satırda kronoloji DB saati + 1 ms kuralı; "en son" okuyucusu eşitlik bozucuyla (`test_esitlik_bozucu`). |
| (telefon teslim denemeleri) | **TELEMETRİ** | Fabrikada tutulmaz: patron tarafında bulutun `notifications` tablosu zaten telemetri. Saha telefonu yolu (Faz A6) gerekirse beyanlı budanır. |

- **Audit:** kişi eylemleri (üstlen, bırak, sustur, not) `AuditService.log()`; motorun yazdıkları `SISTEM_ISI` muafiyetiyle beyan (`scripts/lib/audit-muafiyeti.ts`, `ShiftInstance` emsali). Alarm ekranları **audit okumaz** (`test_audit_okuma_kaynagi`).
- **Silme yok:** alarm ve olayları hiç silinmez; duruş geri alınırsa alarm `CANCELLED` olur (durum geçişi + defter satırı).

### A.5 Motor (sunucu, tek süreç)

- `jobs/loom-alarm.job.ts` — `setInterval` 30 sn (archive-scheduler kalıbı), ilk ifade `if (!tezgahEnabled || !alarmEnabled) return "disabled"`. Ayrıca duruş **açılış/sınıflandırma/kapanış** servisleri commit **sonrası** motoru "şimdi bak" diye dürter (gecikme ≈ 0; doğruluk yine job'dadır, dürtme kaybolsa 30 sn içinde yakalanır).
- **Tek kaynak:** vade hesabı bugünkü `loom-floor.helper.ts`'in (`loomStopTier`, `escalationDueAt`) genişletilmesidir — ikinci bir "hedef aşıldı mı" yüklemi yazılmaz (ayrışan yüzey sınıfı; AST bekçisi). Ekran ile motor aynı fonksiyonu çağırır, böylece "kart kırmızı ama alarm yok" ayrışması yapısal olarak imkânsızdır.
- **Saat:** `now` = DB saati (`readDbNow`); test `now` enjekte eder (`runShiftCloseOnce` emsali).
- **İdempotency / çift bildirim:** `LoomAlarm.stopEventId` unique + `LoomAlarmEvent` üzerinde partial unique `(alarmId, kind, tier) WHERE kind IN (RAISED, TIER_SKIPPED)` → aynı kademe ikinci kez doğamaz (`INSERT … ON CONFLICT DO NOTHING`). Advisory kilit **gerekmez** — sed yeter (`MachineRun` emsali, `dokuma.md` "her tekillik sorusu bir kilit istemez").
- **Kullanıcı eylemleri:** `clientToken` (`tokenReplay` boğazı) + atomik claim (`updateMany WHERE {id, state:'OPEN', ackedById:null}` → count 0 → tx içinde taze okuma → 409 kim üstlendi).
- **Yük:** açık duruş sayısı küçüktür (tezgah sayısı kadar); tick başına tek sorgu.

### A.6 Kanallar ve önceliklendirme

| Kanal | Ne görür/duyar | Faz | Dış bağımlılık |
|---|---|---|---|
| **Panel — alarm zili** (üst çubuk, mevcut "Son Aktivite"den AYRI) | sayı rozeti; açılır liste (tezgah · sebep · süre/hedef · kademe) | A2 | yok |
| **Panel — kırmızı şerit** | ekranın üstünde en eski açık alarm: *"TZ-12 · İp atlama · 23 dk (hedef 10) · [Üstlen] [Aç]"*; birden çoksa "+3" | A2 | yok |
| **Panel — ses** | kademe başına farklı kısa ton; kullanıcı tercihi (aç/kapa, sessiz saat) `UserPreference`'ta | A2 | yok (ses dosyası pakete gömülür) |
| **Panel — Windows bildirimi** | pencere arkadayken işletim sistemi bildirimi; tıklayınca alarm sayfası | A2 | yok (`Notification` API; AUMID zaten ayarlı) |
| **Tezgah Salonu / TV** | `ESCALATED` kademesi gerçek veriden (kart çerçevesi + yavaş nefes, bugün yalnız örnek veride); "hedefi aşanlar" şeridi zaten var; TV'de ses opsiyonu (salon andonu) | A2 | yok |
| **Tablet (tezgah başı)** | kendi tezgahının alarmı: tam genişlik şerit + ses + titreşim (uygulama açıkken) | A3 | yok (`expo-audio`, `expo-haptics` var) |
| **Usta/amir telefonu — uygulama açıkken** | yeni mobil ekran "Uyarılar": aktif alarm listesi, üstlen, detay | A3 | yok (fabrika Wi-Fi) |
| **Usta telefonu — kilit ekranında / saatte** | işletim sistemi bildirimi; **akıllı saat** telefon bildiriminin yansımasıdır, ayrı kanal değil | A6 | **yeni paket** (`expo-notifications`) + Soru 1 |
| **Patron uygulaması push** | "TZ-12 · 21 dk duruyor (hedef 10) · üstlenen: Ahmet Usta" → dokununca uygulamada alarm ekranı | A5 | patron bulutu canlı + bildirim kipi `gercek` + mağaza |

**Patron push'u nasıl gider (kök kurallara uygun yol):**
1. Fabrika alarmı hesaplar (bulut **hesap yapmaz**).
2. K2 çaldığında motor yerel "şimdi eşitle" tetiğini çeker (bugünkü zil kalıbı, iki tur arası ≥30 sn); yeni projeksiyon **`alarmlar`** (açık alarmlar + son 48 saatin kapananları; yalnız tezgah kodu, hol adı, sebep etiketi, başlangıç, kademe, üstlenen adı, durum) **çıkan imzalı kanaldan** buluta gider. **Fabrikaya gelen port açılmaz.**
3. Bulutta yeni bildirim türü **`tezgah-alarmi`** (kural tek kaynak `catalog/notifications.ts`; okuma izni `bulut:uretim:oku`'yu kapsar): bulut yalnız *"bu alarm açık mı ve kademesi hesabın eşiğine ≥ mi"* diye **karşılaştırır**; tekrar-önleme anahtarı `alarm:<id>:k<n>`.
4. **Bayat alarm gönderilmez:** son pakette kapanmış ya da başlangıcı X saatten eski alarm `ATLANDI` doğar (internet kesintisinden dönüşte patrona eski alarm yağmuru gitmez).
5. Gecikme hedefi: K2 anından itibaren ≤ ~1 dk (≤30 sn eşitleme + ≤30 sn bulut taraması + Expo).

### A.7 "Durumu anlatan yer" — alarm sayfası (derin bağlantı)

Panel yolu `operations/loom-alarms/:id` (Windows bildirimi, zil, şerit, Tezgah Salonu kartı buraya açar); patron uygulamasında aynı içeriğin salt-okunur sürümü (`safeRoute` izinli bölüm); tablet/telefonda mobil ekran.

Sayfa yukarıdan aşağı:
1. **Başlık:** tezgah kodu + hol · sebep (simgesiyle) · **canlı sayaç** "23:41 / hedef 10 dk" · kademe rozeti · kaynak ("Elle kayıt" / "Ölçülen").
2. **Eylemler** (izne göre): Üstlen / Bırak · Sustur (15/30/60) · Not ekle · Sebep ata (`loom:classify`) · Duruşu kapat (`loom:manual-entry`) · Tezgah Salonunda göster.
3. **Zaman çizgisi** (defterden): 14:20 duruş bildirildi (kim — §B-3 inene kadar "tablet oturumu: Mehmet") · 14:30 K1 → usta grubuna · 14:32 Ahmet Usta gördü · 14:33 üstlendi · 14:40 K2 → patron · beklenen sonraki adım `~HH:mm`. Saatler fabrika diliminden.
4. **Bağlam:** tezgahta koşan dokuma işi (no, kumaş, renk), takılı levent ve kalanı, tezgahın bugünkü çalışma oranı.
5. **Geçmiş benzer duruşlar:** bu tezgahta bu sebeple son 7/30 gün — adet, toplam süre, ortalama çözüm süresi; aynı sebebin bütün salondaki sıklığı (mevcut Pareto helper'ından). *"Bu tezgah bu ay 9. kez ip atlamadan duruyor"* — satışta en çok etkileyen cümle budur.
6. **Son 5 duruş** (her sebep) ve bağlantı: "Duruş Pareto raporunda aç".

Ayrıca **Alarmlar listesi** (aktif + geçmiş; süzgeç: hol, sebep, kademe, tarih; cursor + özet şeridi tek where'den).

### A.8 Çevrimdışı fabrika ve internetsiz kurulum

- A1–A4 **internetsiz tam çalışır** (fabrika ağı içinde panel, TV, tablet, telefon uygulaması açıkken).
- Patron push'u yalnız patron bulutu aboneliği + internet varken. Bulut ön koşulu yoksa alarm sayfası **dürüstçe yazar**: *"Patron bildirimi gönderilemedi — bulut bağlantısı yok"* (`PUSH_QUEUED` satırı yok). Sağlık sayacı `/api/admin/health`'e "iletilemeyen K2 alarmı" eklenir.
- Telefon kilit ekranı bildirimi internetsiz istenirse tek yol: uygulamanın fabrika Wi-Fi'ında arka planda kalıcı çalışması (Soru 1-b).
- Arka uç seri port/GSM modem **sürmez** (donanım backend'e girmez) — SMS istenirse ileride bulut tarafında.

### A.9 İzinler ve abonelik (kim hangi alarmı alır)

| İzin (yeni, katalog kodda) | Ne açar | Önerilen şablon |
|---|---|---|
| `loom:alarm-view` | alarm zili, şerit, liste, alarm sayfası; K1 bildirimleri | Üretim Süpervizörü (+ usta rolü fabrika açar) |
| `loom:alarm-ack` | üstlen, bırak, sustur, not | Üretim Süpervizörü |
| `loom:alarm-escalation` | K2 (üst kademe) bildirimi — yalnız görmek değil **duymak** | yalnız müdür/patron rolleri (fabrika panelden atar) |
| `mobile:tezgah-uyari` | mobil "Uyarılar" ekranı | — (dar mobil rol) |
| kademe/kural ayarı | mevcut `loom:spec-manage` + ayar kapsamı `settings:dokuma` | — |

- İlk sürüm (A1–A3) **yetkiye göre** dağıtır: izni olan herkes duyar. Bu, "hol A gündüz Ahmet, gece Veli" ayrımını yapmaz.
- **A4 — sorumlu ataması:** `HallShiftResponsible` (hol × vardiya tanımı → kişi(ler), sıra = kademe), "bugün nöbetçi değişti" geçersiz kılması; kademe kuralında alıcı = *rol · kişi · holün vardiya sorumlusu*. Alıcı listesi kademe çaldığı an çözülür ve `RAISED` satırına donar ("kime bildirildi" sonradan değişmez). → Soru 4.
- Kullanıcı başına abonelik ince ayarı (ses aç/kapa, sessiz saat, hangi holler) `UserPreference`'ta; yetkiyi genişletemez, yalnız daraltır.
- Patron hesabı: bulutta tür başına aç/kapa + sessiz saat zaten var.

### A.10 Ayarlar ve bayraklar

| Anahtar | Varsayılan | Not |
|---|---|---|
| `tezgah.alarmEnabled` (yeni davranış bayrağı) | **false = bugünkü davranış** (hiçbir alarm satırı doğmaz, zil görünmez). Ölçüm: bugün gerçek veride bildirim yok, `ESCALATED` hiç üretilmiyor. | `tezgahEnabled` (Tezgah Salonu ile aynı modül, §8 karar 6 emsali) arkasında; `test_module_flag_off`, `test_feature_flag_contract`. |
| `tezgah.escalationGraceMinutes` (VAR) | 0 | K2 ofseti olarak anlamı korunur. |
| `tezgah.alarm.unclassifiedTargetMinutes` | boş | §A.2/4. |
| `tezgah.alarm.unclassifiedEnabled` (2026-10-12) | satır yok → süreden türer (süre dolu = açık; bugünkü davranış) | sebepsiz duruş alarmının anahtarı; açıkken süre zorunlu (400 `TEZGAH_ALARM_UNCLASSIFIED_MINUTES_REQUIRED`); motor + salon tek `resolveTezgahAlarmUnclassifiedTarget`. |
| `tezgah.alarm.noShiftMode` (2026-10-12) | `WARN` = bugünkü davranış (Soru 5 = (a)) | `ALWAYS` vardiyaya bakmaz (7/24, saat açılıştan) · `REQUIRE_SHIFT` aktif vardiya tanımı yokken alarm açılamaz (400 `TEZGAH_ALARM_SHIFT_REQUIRED`, yalnız geçişte); `WARN`/`REQUIRE_SHIFT` vardiyasız anda ayar ekranı + Tezgah Salonu şeridi (`alarmShiftNotice`). §A.2/5. |
| `tezgah.alarm.renotifyMinutes` | 10 | yalnız görüntü/push tekrarı. |
| `tezgah.alarm.stopStartNotify` (K0) | kapalı | sebep satırında opsiyonel bayrakla da açılabilir (ileride). |
| Sebep satırı `targetMinutes` (VAR) | boş | fabrika girer; **kurulum sihirbazında örnek değerler önerilir** (ör. atkı kopuşu 5, çözgü kopuşu 15, mekanik arıza 30) — profil verisi, kodda varsayılan değil. |

Profil = veri; `if (musteri === …)` yok. Bayrak kapalı kurulumda (adnansahin) DB'ye yalnız katalog satırları düşer.

### A.11 Test planı

- **Saf motor (DB'siz):** vade/kademe tablosu (`NON_SCHEDULED` → yok · hedefsiz → yok · sebepsiz + ayar → var · vardiya dışı → yok · geç kayıt → yalnız en yüksek kademe · sebep değişimi → çalmamış kademe yeniden hesap). Ekran yüklemiyle **aynı** fonksiyon olduğunun AST bekçisi (negatif sonda: motorda kopya yüklem → kırmızı).
- **`test_loom_alarm` (DB):** iki eşzamanlı tick → tek `RAISED` (sed) · üstlen yarışı → bir 200 bir 409 (kimi söyler) · duruş geri alındı → `CANCELLED` · duruş kapandı → `RESOLVED` + donmuş süreler · bayrak kapalı → sıfır satır · replay dört durum.
- **Defter bekçileri:** `test_defter_ters_yol` (yeni beyanlar), `test_esitlik_bozucu`, `test_audit_muafiyeti` (SISTEM_ISI), `test_audit_okuma_kaynagi`, `test_db_invariants` (partial unique, CHECK), `test_timestamptz_contract`, `test_screen_catalog`, `test_module_flag_off` (4101 ayakta, atlandı=0).
- **Panel (vitest):** şerit/zil görünürlük yüklemi, ses tercihi, derin bağlantı yolu; Tezgah Salonu `ESCALATED` gerçek veriden.
- **Uçtan uca prova:** `_test` DB'de simüle duruş (`source:'SIMULATED'`) + enjekte saat → panelde zil/ses/şerit → üstlen → K2 → kapan; patron yolu bulutun `sahte` kipiyle (gerçek push yerelde denenmez — `patron-bulutu.md`).
- Belge çıktısı yok (alarm PDF/Excel üretmez); liste dışa aktarımı eklenirse PDF/Excel birebir kuralı.

### A.12 İnternet push (A6b) — tasarım

**Neden ayrı dilim:** A6a ölçümü — uygulama arka plandayken Android JS'i durdurur; yalnız önceden zamanlanmış yerel hatırlatma çalar. Arka planda YENİ doğan alarmın kilit ekranına/saate ulaşması yalnız işletim sisteminin push kanalıyla (FCM / APNs) olur.

**Yol (kök kurallara uygun):**
1. Fabrika alarmı hesaplar (bulut hesap yapmaz). Kademe çaldığında motor, alıcı kişileri (A4 `notifications` kaydı) ve kısa yükü hazırlar.
2. Yük fabrikanın **çıkan imzalı kanalından** buluta gider (patron eşitlemesinin kanalı ya da aynı imzalı yeni uç); **fabrikaya gelen port açılmaz**.
3. **Röle = patron bulutu bildirim tarayıcısı** (A5 ile aynı makine): bulut yalnız iletir/karşılaştırır, hesap yapmaz; tekrar-önleme anahtarı `alarm:<id>:k<n>`; bayat alarm (kapanmış / X saatten eski) `ATLANDI` doğar.
4. Bulut → FCM (Android) / APNs (iOS) → cihaz. Yük yalnız insan cümlesi + alarm kimliği: *"Tezgah 3 · 20 dk duruyor"* — iş verisi (müşteri, sipariş, metraj) taşımaz.
5. Dokunma → mevcut derin bağlantı (`lib/loomAlarm/deepLink.ts`: tanınmayan veri yok sayılır, UUID değilse liste açılır).

**Cihaz kaydı:** uygulama girişte push belirtecini (Expo/FCM token) **fabrika sunucusuna** yazar (kullanıcı + cihaz, `clientToken`'lı; çıkışta `revokedAt`); fabrika belirteci imzalı kanalla buluta taşır — telefon buluta doğrudan kimlik açmaz. Belirteç sır değildir ama kişisel veridir: log/audit yüküne düz yazılmaz.

**Gereken hesaplar (kullanıcı kararı):** Firebase projesi + `google-services.json` (Android push), Apple geliştirici hesabında APNs anahtarı (`.p8`, iOS push), röle olarak patron bulutunun canlıya çıkması (`BILDIRIM_KIPI=gercek`).

**Dağıtım:** `expo-notifications` A6a ile APK'ya girdi; push için `google-services.json` derlemeye girer ⇒ yine APK turu. Bayrak kapalıyken (varsayılan) belirteç toplanmaz, yük gitmez — bugünkü davranış.

**Test:** saf yük kurucu (iş verisi sızmaz — allowlist), tekrar-önleme ve bayatlık bulut tarafında `sahte` kiple; cihazda uçtan uca yalnız gerçek hesaplarla.

---

## B · Eksik / geliştirme listesi (satın alma kararını etkileyenler)

Emek: **S** ≤1 gece tek ajan · **M** 1–2 gece · **L** çok fazlı. "Bugün" sütunu §1'deki ölçümlere dayanır.

| # | Ne | Müşteri neden ister | Bugün | Emek | Bağımlılık |
|---|---|---|---|---|---|
| B1 | **Alarm + eskalasyon** (bu belge §A) | "Tezgah durdu, kimse bilmiyor" kaybını bitirir; satış demosunun en güçlü anı | Hedef/pay/kademe hesabı VAR; bildirim, üstlenme, iletim YOK | L (A1–A6) | — |
| B2 | **Sorumlu/nöbet ataması** (hol × vardiya → usta, bakımcı) | Alarmı "herkese" değil doğru kişiye; vardiya amirinin hesap verebilirliği | YOK | M | B1 |
| B3 ✓ 2026-10-12 | **Duruşu kim bildirdi / kim kapattı** kolonları | Müdahale süresi kişiye/ekibe bağlanır; tartışma biter | VAR (`openedById`/`closedById`; yalnız elle açma/kapama yazar, eski satır "bilinmiyor") | S | — |
| B4 | **Müdahale/çözüm süresi raporu** (sebep · hol · vardiya · usta başına ortalama üstlenme ve çözüm süresi, hedef aşım oranı) | Bakım ekibinin performansı; "hangi arıza bizi en çok bekletiyor" | YOK (Pareto süre/adet VAR) | M | B1, B3 |
| B5 | **Hol tableti / çok tezgahlı dokumacı ekranı** | Gerçekte bir dokumacı 6–12 tezgaha bakar; tezgah başına tablet satılamaz | Tablet oturumu tek tezgaha kilitli, makine seçtirilmez [ÖLÇÜLDÜ `dokuma.md` Tablet] | M–L | oturum modeli kararı |
| B6 | **Amir telefonu salon görünümü** | Salonda yürürken tüm tezgahları görmek | YOK (D14) | M | A3 ile birleşebilir |
| B7 | **Toplu duruş** (elektrik/hava kesintisi tek dokunuş) | Kesintide 40 tezgahı tek tek girmek gerçekçi değil | Tek tek VAR (D18) | S | — |
| B8 | **Otomatik veri toplama** (sensör/kenar ajanı: çalış/dur, atkı sayacı, devir) | Elle kayıt güvenilmez; rakipler bununla satar [VARSAYIM] | YOK — tasarım VAR (Faz 2), kod yok | L | donanım seçimi, saha |
| B9 | **Dokuma hatası → tezgah/dokumacı karnesi** | "Hangi tezgah hatalı kumaş dokuyor" — kalite maliyetinin kaynağı | Hata metresi + top→doff→tezgah zinciri VAR; rapor YOK | M | — |
| B10 | **Kumaş puanlama** (4 puan / 10 puan, 100 m²'de puan, A/B/C sınıfı) | İhracat müşterileri puan ister [VARSAYIM: ASTM D5430 4-puan yaygın] | YOK (`RollError`da puan yok) | M | B9 ile aynı dilim olabilir |
| B11 | **Atkı ipliği tüketimi** (atkı sıklığı × en × metre ya da tartı) | İplik maliyeti; çözgü var atkı yok = yarım maliyet | YOK (`YarnMovementKind`da atkı çıkışı yok) | M–L | kumaş teknik kartı (B13) |
| B12 | **Üretilen metre / ilerleme / tahmini bitiş** | Planlamacı "bu iş ne zaman biter" sorar | Plan metre VAR, üretilen toplanmıyor (D2, D3) | M | — |
| B13 | **Kumaş teknik kartı** (atkı sıklığı, tarak no, tahar, çekme/take-up) | Tezgah ayarı, metre↔levent çevrimi, maliyet | `WarpSpec` VAR; `unitsPerCm` koşumda elle, kalıcı evi belirsiz; take-up YOK [`dokuma.md` açık sorular] | M | — |
| B14 | **Levent bitiş tahmini + alarmı** | Levent bitince tezgah saatlerce boş kalır; devere önceden hazırlanmalı | Kalan VAR, hız YOK (D7) | M | B12; alarm motoru yeni tür |
| B15 | **Planlı bakım takvimi** (tezgah başına süre/atkı sayısı periyodu, arıza iş emri, bakım geçmişi) | Arıza duruşunu azaltır; denetimlerde istenir | YOK (yalnız "Planlı bakım" duruş sebebi) | M–L | — |
| B16 | **Yedek parça/sarf** (tarak, gücü teli, lamel, makas) | Bakım maliyeti ve stok | YOK | L | B15 |
| B17 | **Dokumacı performansı + prim/akord** | Fabrikalar dokumacıya metre/randıman primi öder [VARSAYIM yaygın] | YOK (`WorkSession` VAR; koşum/duruş kişiye bağlı değil) | M–L | B3, B5; "ekran insanı yarıştırmaz" ilkesi rapora taşınmaz ama hassas |
| B18 | **Tezgah künyesi panel ekranı** (ağızlık tipi, en, nominal devir, devreye alma) | Kurulumda ilk iş; bugün API'den başka yolu yok | Backend VAR, ekran YOK | S–M | — |
| B19 | **Vardiya devir notu** (amirden amire serbest not + açık sorunlar) | Gece vardiyasının sorunu sabaha kaybolmasın | YOK | S | — |
| B20 | **Patron uygulamasında dokuma özeti** (duran tezgah, bugünkü çalışma oranı, metre) | Patron her an salonu görmek ister | YOK (projeksiyon dışı) | M | patron bulutu canlı |
| B21 | **Dokuma maliyeti** (metre başına iplik + tezgah saati + fire) | Fiyat teklifinin dayanağı | YOK | L | B11, B13 |
| B22 | **Planlama panosu / iş sırası** | Tezgah × zaman | YOK (D16, Salon planı F5/F7) | L | Salon planı Soru 1 |
| B23 | **Haftalık otomatik yönetici özeti** (PDF/e-posta ya da patron uygulamasında) | Patron rapor açmaz, özet okur | YOK (fabrikada e-posta yok) | M | patron bulutu |
| B24 | **Enerji/basınçlı hava izleme** | Enerji maliyeti büyük kalem [VARSAYIM] | YOK | L | B8 |

**Rakip notu [VARSAYIM, doğrulanmadı]:** dokuma MES'lerinin (tezgah üreticilerinin izleme yazılımları ve bağımsız MES'ler) ortak paketinde andon/salon panosu, tezgah başı duruş kodu terminali, otomatik devir/atkı sayımı, bakım modülü ve kumaş muayene/puanlama bulunur. Bizim farkımız: ERP ile tek gövde (sipariş → levent → dokuma → KK1 → sevk zinciri) ve sensörsüz tezgahta bile elle kayıtla çalışan ekran + alarm.

---

## C · Yol haritası

İlke: her faz **bağımsız teslim edilir**, backend önce; her biri bir gecede bir-iki ajan boyutunda (backend dilimi / istemci dilimi / bitiriş). Bayrak kapalıyken davranış bugünküyle aynı.

### Faz A1 — Alarm motoru (backend) · **bu gece başlatılabilir**
- **Şema (migration reçetesi, en eski canlı dump'ta prova):** `LoomAlarm` (durum), `LoomAlarmEvent` (defter), enum'lar (enum değeri kendi dosyasında — 55P04), partial unique'ler, CHECK'ler; `test_db_invariants` envanteri.
- **Motor:** `jobs/loom-alarm.job.ts` (30 sn + servis dürtmesi), vade hesabı `loom-floor.helper.ts` genişletmesi (tek kaynak), "geç kayıt → yalnız en yüksek kademe", vardiya dışı süzgeci, sebepsiz hedef ayarı.
- **Uçlar** (`/api/loom-alarms`, kapı `verifyToken → requireTezgahEnabled → bayrak → izin`): liste (aktif/geçmiş, cursor + özet şeridi tek where), detay DTO (§A.7'nin bütün blokları tek uçtan), `ack` · `release` · `snooze` · `unsnooze` · `notes` · `notes/:eventId/retract` (`clientToken`); `seen` YOK (A1a kararı: "görüldü" defter değil).
- `GET /api/loom-floor`: `tier` artık `ESCALATED` de döner (K2 çaldıysa) + `alarmId`.
- Bayrak `tezgah.alarmEnabled` + 2 ayar (route+izin ve bayrak reçeteleri, `docs/RECETELER.md`); izinler `loom:alarm-view/ack/escalation`; rol şablonu satırları.
- Defter beyanları, audit muafiyeti, bekçiler (§A.11). **Kabul:** bayrak kapalı → sıfır satır ölçüldü; negatif sondalar kırmızı görüldü.

### Faz A2 — Panel (istemci) · A1'den sonra, aynı ya da ertesi gece
- Üst çubukta **Alarm zili** (mevcut "Son Aktivite" zilinden ayrı) + **kırmızı şerit** + **ses** (kullanıcı tercihi) + **Windows bildirimi** (pencere arkadayken).
- **Alarm sayfası** `operations/loom-alarms/:id` ve **Alarmlar listesi** (Electron sayfası reçetesi, dört kapı: route · karo · `SCREEN_CATALOG` · `ROUTE_MODULE`).
- Tezgah Salonu: `ESCALATED` gerçek; kart/şerit/detaydan alarma bağlantı; TV kipinde opsiyonel ses.
- Genel Ayarlar'da bayrak + iki sayı; sebep kataloğu ekranında hedef süre sütunu görünür ("hedef girilmemiş N sebep" uyarısı).
- **Bitiriş:** uçtan uca prova (simüle duruş + saat), ekran görüntüleri, kural satırı `docs/kurallar/dokuma.md`, arşiv notu, bekçi haritası.

### Faz A3 — Tablet + telefon (uygulama açıkken, fabrika Wi-Fi) · ✓ 2026-10-11
- Tezgah ekranında kendi tezgahının alarm şeridi + ses + titreşim; "Üstlendim" düğmesi.
- Yeni mobil ekran **"Uyarılar"** (usta/amir telefonu, dikey + yatay): aktif alarmlar, üstlen, detay (§A.7'nin mobil sürümü); 10–15 sn yoklama.
- Mobil ekran reçetesi (`SCREEN_MODULE` aynası, `useVisibleScreens`, izin `mobile:tezgah-uyari`). ~~Tablet OTA turu~~ → A6a ile aynı teslimde `expo-notifications` girdiği için **APK turu** (`runtimeVersion` artışı yayın işidir).
- ✓ Yapılan: `mobil/src/screens/Modules/Uyarilar/` (telefon dikey liste → `UyariDetay`; tablet yatay liste + detay), Tezgah ekranı şeridi `components/alarm/LoomAlarmStrip.tsx` (okuma `mobile:dokuma` ile de açık, "Üstlendim" yalnız eylem izninde), uçlar `mobile:tezgah-uyari`yi kabul eder (`routes/loom-alarm.routes.ts`), "Benim alarmlarım" `mine=1` (tanımayan sunucuda 400 → parametresiz geri düşüş, kapsam satırı "İzninize göre tümü" der).

### Faz A4 — Sorumlu ataması ve kademe kuralları · ✓ 2026-10-12
- `HallShiftResponsible` + nöbet değişikliği; kademe kuralı tablosu (alıcı = rol/kişi/hol sorumlusu); alıcı listesi `RAISED`'a donar; B3 (bildiren/kapatan kolonları) aynı fazda.
- ✓ Yapılan: A4-1 backend (`7f937535e`; "rol" alıcısı = izin kodu), A4-2 panel "Alarm Sorumluları" ekranı + alarm sayfasında "Kime bildirildi" (`cb82c8b75`), B3 açan/kapatan kolonları + Tezgah Salonu detayında "Bildiren", alarm sayfasında "Bildiren / Kapatan" (eski kayıt "bilinmiyor").

### Faz A5 — Patron uygulamasına push · **altyapı durumuna bağlı (karar değil)**
- Fabrika: `alarmlar` projeksiyonu + K2'de anlık eşitleme tetiği. Bulut: `tezgah-alarmi` türü (katalog + izin kapsaması + bayat alarm kuralı), tel tipleri `patron/sunucu/src/wire/api.ts` ↔ uygulama aynası. Uygulama: alarm ekranı (salt-okunur) + `safeRoute`.
- **Ön koşul:** patron bulutu VDS'te canlı + `BILDIRIM_KIPI=gercek` + mağaza yayını. Bunlar hazır değilse faz kodda biter, `sahte` kiple prova edilir, canlıya açılması bekler.

### Faz A6 — Telefon kilit ekranı / akıllı saat
- **A6a ✓ 2026-10-11 — yerel bildirim (fabrika Wi-Fi):** `expo-notifications` (onaylı) yalnız YEREL: ön planda 15 sn yoklama → ses + titreşim + uygulama içi uyarı; arka plana geçişte açık-üstlenilmemiş alarm varsa TEK zamanlanmış hatırlatma ("HH:mm itibarıyla N açık alarm"), ön plana dönüşte iptal; dokununca alarm sayfası. Ölçüm: arka planda JS durur (RN 0.81 `JavaTimerManager.onHostPause`) ⇒ arka planda YENİ doğan alarm bu yolla bildirilemez — A6b'nin işi.
- **A6b — internet push (kilit ekranı, saat):** tasarım §A.12; hesap/karar bekler.

### Sonraki fazlar (alarm bittikten sonra, önerilen sıra)
1. **B3 ✓ 2026-10-12 + B4** — kim bildirdi/kapattı (indi) + müdahale süresi raporu (alarm defterini okuyan ilk rapor). M.
2. **B7** toplu duruş · **B18** künye ekranı · **B19** vardiya devir notu — S'ler, bir gecede ikisi-üçü.
3. **B9 + B10** — kalite → tezgah karnesi + puanlama. M.
4. **B5** — hol tableti (oturum modeli tasarımı önce). M–L.
5. **B12 + B14** — üretilen metre, levent bitiş tahmini ve alarmı (motorun ikinci türü). M.
6. **B15** bakım → **B16** yedek parça. 
7. **B8** sensör Faz 2 (donanım kararıyla), **B11/B13/B21** maliyet zinciri, **B17** prim.

### Makine kaynaklı duruş (kart) — alarm hazırlığı · D1 ✓ 2026-10-12

Kullanıcı kararı 2026-10-12: duruşu ve sebebini ileride tezgaha takılan kart OTOMATİK bildirir, insan yalnız müdahale eder. ⇒ makine yolu BİRİNCİL, insan bildirimi ikincil; ikisi aynı yazma boğazından ve aynı alarm motorundan geçer. Ölçüm: `source` (`MachineDataSource`), `rawStopCode`, `signalKind`, `collectorId`, `endSource` kolonları P2b-1'den beri VAR (yazarsız); panelde "Üstlenilmiş alarm da patrona iletilsin" ve "Sebepsiz duruşta alarm" + süre satırları VAR (A2b-2 ve vardiyasız dilim) — yeni enum, kolon ve panel işi gerekmedi.

- **D1 ✓** tek boğaz (`openStopCore` · `closeStopCore`), servis düzeyinde makine girişi (`machine-stop-signal.service`), kapanışta önce gelen kalır (makine insanın kapanışını ezmez), alarm dürtmesi birleşir (2 sn / 5 sn tavan) + tx dışı uygunluk ön-süzgeci (perf B-02 madde 1 ve 3). Migration ve uç YOK. Bekçiler `test_makine_durus_bogazi`, `test_loom_alarm_durtme`.
- **D2 — İNDİ (2026-10-12)** ham kod → sebep eşlemesi [PROFİL]: `MachineStopCodeMap` (kimlik KART TİPİ `collectorType` + `rawStopCode` → `stopReasonId` (`ReasonPreset`, `MACHINE_STOP`); `machineId` dolu satır tezgah üst-yazımı, genel satırı ezer; tezgah markası alanı YOK; emeklilik `isActive:false`, partial unique canlı satırda NULLS NOT DISTINCT). Kart tipi `MachineCollector.collectorType`ta (yazarı D3a). Çözücü `resolveMachineStopCode` (tezgah > kart tipi > null; yalnız canlı eşleme + kullanılabilir sebep). Eşleşmede sebep MAKİNE kararı olarak donar (`reasonSource = MACHINE`, `classifiedById` NULL — telemetri sınıfı, hedef süre dahil), eşleşmezse sebepsiz yol → sebepsiz alarm. Yazma ucu `/api/machine-stop-code-maps` (`requireTezgahEnabled` + `loom:spec-manage`), audit BaseService yolundan; panel ekranı D5.
- **D3a — İNDİ (2026-10-12)** kart kimliği: panel/API kaydı (`/api/machine-collectors`: ad · `collectorType` · bağlı tezgahlar; `requireTezgahEnabled` + `loom:spec-manage`), duyuru/onay akışı YOK (kart yönetici kaydıyla ONAYLI doğar). Sır DB'de yok: 32 bayt tohum `<kid>:<hex>`, sır = HMAC(kısa kimlik halkası, kimlik+tohum), yalnız kayıt/yenileme cevabında bir kez; yenileme/iptal (`revokedAt`, bağlar çözülür). bcrypt yerine türetme seçildi — kart her isteği HMAC'le imzaladığı için sunucu sırrı yeniden üretebilmeli.
- **D3b — İNDİ (2026-10-12)** kart duruş ucu: `POST /api/machine-signals/stop` · `/end` (tekil kalem; toplu ingest ileriki dilim), kimlik `verifyCollectorSignature` (protokol `docs/design/MAKINE-KART-PROTOKOLU.md`), kapsam = karta bağlı tezgah (403), kaynak sabit `MACHINE` (SIMULATED çapraz kontrolü ve `monitoringState` kapsamı kart ucuna girmedi — açık), K1 sahiplenme (`claimOpenStopForSignal`, kartın anahtarı `signalStopKey`). Backend'e donanım/seri port kodu girmez.
- **D4** watchdog (`tezgah.maxOpenStopHours`, geçici kapanış `WATCHDOG` + `provisionalEndedAt`, gerçek kapanış tek kez düzeltir). **D5** panel: toplayıcı onayı, kod eşleme ekranı, duruş listesinde kaynak rozeti.
- Kararlar (1e, 2026-10-12): (K1) kart insanın açık duruşunu SAHİPLENİR (D3b; o dilime dek sed 409 `STOP_ALREADY_OPEN`) · (K2) eşleme KART TİPİ başına + isteğe bağlı tezgah üst-yazımı, marka alanı yok (D2'de indi) · (K3) izin mevcut `loom:spec-manage` · (K4) "Sebepsiz duruşta alarm" varsayılanı değişmez, kart devreye alma ekranı (D5) ayar kapalıysa uyarır.

### Kullanıcı kararı isteyen sorular (sade dil, önerili)

1. **Ustanın telefonuna bildirim hangi yoldan gitsin?**
   (a) İnternet üzerinden: telefon kilitliyken de, saatte de çalar; fabrika sunucusu internete çıkabilmeli ve bulut aboneliği gerekir. 
   (b) Yalnız fabrika Wi-Fi'ında: internetsiz çalışır ama uygulama telefonda sürekli açık kalmalı (pil yer, bazı telefonlar uygulamayı kapatır).
   (c) İkisi de (önce a).
   *Önerim: (a) — güvenilir olan bu; (b)'yi internetsiz müşteri çıkarsa ekleriz.*
2. **Usta "üstlendim" dedikten sonra süre yine dolarsa patrona gitsin mi?**
   (a) Evet, gitsin — ölçtüğümüz şey "tezgah ne zaman çalıştı" (Ekim'de böyle demiştiniz).
   (b) Hayır, üstlenildiyse patrona gitmesin.
   *Önerim: (a) varsayılan; fabrika isterse ayardan (b)'ye çevirebilsin.*
3. **Operatör sebep seçmeden "duruş bildir" derse alarm çalsın mı?**
   (a) Evet, fabrikanın gireceği ortak bir süreyle (ör. 15 dk).
   (b) Hayır, sebep seçilene kadar alarm yok.
   *Önerim: (a) — yoksa sebep seçmemek alarmı susturmanın yolu olur.*
4. **Alarm kime gitsin?**
   (a) Yetkiye göre: panelde "tezgah uyarılarını alır" yetkisi verdiğiniz herkes (hızlı, ilk sürüm).
   (b) Hol ve vardiyaya göre kişi: "A holü gündüz Ahmet Usta, gece Veli Usta" (daha doğru, ek iş).
   *Önerim: önce (a), hemen arkasından (b).*
5. **Vardiya olmayan saatte (gece/hafta sonu çalışılmıyorsa) tezgah durursa?**
   (a) Alarm hiç doğmasın (tezgah zaten çalışmıyor).
   (b) Doğsun ama yalnız ekranda kalsın, telefona gitmesin.
   *Önerim: (a).*

### 1e'nin bu gece karar verip başlatabileceği dilimler

- **A1 (backend)** — sorulara bağlı değil: Soru 2 için Ekim kararı (a) varsayılan, Soru 3 ve 5 için ayar/varsayılan bugünkü davranış (sebepsiz hedef boş, vardiya dışı alarm yok), Soru 4 için yetkiye göre dağıtım. Hepsi sonradan ayar/faz ile değişebilir; hiçbiri geri dönüşsüz değil.
- **A2 (panel)** — A1 bittikten sonra ikinci ajan.
- Paralel küçük dilim: **B7 toplu duruş** ya da **B18 künye ekranı** (alarm dosyalarına dokunmaz).
- A4 ✓ 2026-10-12; A6b (Soru 1 + paket onayı) bekler; A5 kodlanabilir ama canlıya açılması patron bulutunun canlı + bildirim kipi `gercek` olmasını bekler.
