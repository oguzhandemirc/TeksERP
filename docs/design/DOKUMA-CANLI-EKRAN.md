# Tezgah Salonu — dokuma tezgahlarının canlı ekranı

> **Tarih:** 2026-10-09 · **Kararlar:** kullanıcı 2026-10-09 sabah + 2026-10-10 (§8) · **Durum:** GERÇEK VERİ (2026-10-10) — route `operations/weaving-floor` + karo + `GET /api/loom-floor` (`tezgahEnabled` + `loom:live-view`) canlıdır; örnek veri yalnız geliştirme önizlemesindedir (bekçi `previewOnly.test.ts`). Bildirim GÖNDERMEZ (kademe ESCALATED kullanılmaz). TV bağlantısı ve TV hesabı ayrı sonraki dilimdir (§9 madde 4–5).
> **Kod:** `Electron/src/pages/Operations/WeavingFloor/` · veri sözleşmesi `Electron/src/pages/Operations/WeavingFloor/types.ts` · tek veri kapısı `Electron/src/pages/Operations/WeavingFloor/useLoomFloorLive.ts` · önizleme `Electron/preview-weaving-floor.html` + araçlar `Electron/onizleme/` · görüntüler `docs/design/dokuma-canli-ekran/`.
> **Bağlam:** tezgah izlemenin asıl tasarımı `docs/design/DOKUMA-TEZGAH-IZLEME-TASARIMI.md` (telemetri, duruş defteri, vardiya karnesi); dokuma kuralları `docs/kurallar/dokuma.md`.

## 1 · Amaç

Salona bakan biri (vardiya amiri, patron, salondaki TV) **tek bakışta** üç soruyu cevaplasın:

1. Hangi tezgah duruyor, **neden**?
2. ✓ **Kaç dakikadır** müdahale bekliyor — hedef süreyi aştı mı?
3. Salon bu vardiya ne üretti, hedefin neresinde?

İlke: az yazı, çok şekil. Her tezgah küçük, canlı bir makine; duran makine donar ve ortasında sebebin simgesi belirir. Yazı yalnız sayılarda, anahtar satırında ve detay panelinde.

## 2 · Ekran anatomisi

```
┌ Başlık: Tezgah Salonu [Örnek veri]            [Göster: Tümü] [Tam ekran] ┐
├ Özet: ● 26/36 çalışıyor │ ⯃ 10 (●5 ◆3 ■1 ◌1) │ ◔ ŞU AN %72 │ 891 m ▬▬▬ hedef │ 02:07 ┤
├ Hedefi aşan 3:  [35 ⟂ 14 dk /10 dk ♛] [22 👤✕ 9 dk /5 dk ♛] …           ┤
├ Hol A 11/14 ▬▬ bugün %90 🏆 ───────────────────────────────────────────── ┤
│ [01][02][03][04][05⯃][06]…   her kart: no · zincir/şekil · figür · alt şerit (bugün %) │
├ Hol B … / Hol C …                                                         ┤
└ Anahtar: ● Çalışıyor ⯃ Arıza/kopuş ◆ Ayar ■ Planlı ◌ Plan dışı           ┘
```

- **Özet şeridi** — çalışan/toplam; duran sayısı + sınıf kırılımı (şekillerle); **"şu an %"** = şu an çalışan tezgah ADEDİ / toplam (etiket: "ŞU AN %72 · Çalışan tezgah payı (adet)"); vardiya metresi ve hedef çubuğu; fabrika saati + vardiyanın kalanı.
- **Hedefi aşanlar şeridi** — yalnız varsa görünür; en uzun bekleyen başta; her öğe detayı açar.
- **Hol bölümü** — hol (salon) adı, çalışan/toplam, holün **"bugün %"**i (holdeki tezgahların bugünkü çalışılan / planlı süresi); tezgahlar **tezgah numarası sırasıyla ızgarada** — gerçek kat planı yok (§8 karar 3).
- **Tezgah kartı** — numara; sağ üstte çalışırken durum şekli, dururken **kompakt uyarı zinciri**; ortada canlı figür (dururken solar ve üstüne sebep simgesi biner); altta çalışırken **"bugün %"** çubuğu + etiketi, dururken **hedef halkası + sayaç** ve "bugün %" figürün sağ alt köşesinde (sayaç ezilmesin). "bugün %" = o tezgahın fabrika günü başından beri çalışılan / planlı süresi (plan dışı duruş paydadan düşer); vardiya metresi karttan çıktı, özet şeridinde ve detayda kalır.
- **Üç yüzde, üç ölçü — karıştırılmaz (2026-10-10):** kart/hol **"bugün %"** = SÜRE payı (bugün çalışılan / planlı süre) · üst şerit **"şu an %"** = ADET payı (şu an çalışan tezgah / tüm tezgah) · detayda **"Vardiya çalışma"** = bu vardiyanın süre payı. Kartların ortalaması üst şeritle tutmaz ve tutması da gerekmez (biri günün geçmişini, öteki bu anı sayar); anahtar satırı iki tanımı açıkça yazar, başlık/ipucu metinleri birimi söyler.
- **Detay paneli** (karta tıklayınca sağdan) — büyük figür; açık duruş kartı (sebep, kademe, sayaç, hedef) ve uyarı zinciri zaman çizgisi; vardiya rakamları (üretim · atkı · çalışma · hız — randıman tek sayıya çökertilmez); sebebe göre duruş çubukları; dokuma işi ve levent (kalan iplik); son olaylar. Saatler fabrika diliminden (`formatFactory`).
- **Göster seçici** — modal (combobox değil): Tümü · Duranlar · Hedefi aşanlar.
- **Tam ekran** — sayfa pencereyi kaplar; anahtar başlığa taşınır; bütün holler aynı kolon ızgarasına (en kalabalık holün adedi = 14) dizilir ⇒ 36 tezgah 1920×1080'e **kaydırmasız** sığar. Esc ya da düğme çıkarır.
- **TV kipi** (§8 karar 2) — ayrı bağlantı; açılışta tam ekran, **menü yok, düğme yok, çıkış yok**, Esc kapatmaz, karta dokunmak detay açmaz; başlıkta "● Canlı · HH:mm:ss" son tazeleme damgası (ekranın donmadığı görülsün). Tarayıcı gerçek tam ekranı kullanıcı dokunuşu olmadan vermediği için sayfa pencereyi CSS ile kaplar ve gerçek tam ekranı ilk dokunuşta/tuşta yeniden dener (TV cihazında tarayıcının kiosk kipi beklenir). Mock'ta yalnız önizlemede: `preview-weaving-floor.html?kip=tv` (`WeavingFloorPage tv`); uygulamadaki menüsüz bağlantı sonraki dilim (§9).
- **Dar pencere** — panelin en dar penceresi 1100 px; kartlar `minmax(7.5em, 1fr)` ile akar, sayaç kart daraldıkça küçülür, **kesilmez**.

## 3 · Renk · şekil · simge sözlüğü

Renk tek başına anlam taşımaz: her durumun **renkten bağımsız bir şekli** var (renk körlüğünde de ayrışır).

| Durum | Kayıp sınıfı | Şekil | Renk |
|---|---|---|---|
| Çalışıyor | — | dolu daire | yeşil |
| Arıza / kopuş | `UNPLANNED` | sekizgen (dur levhası) | kırmızı |
| Ayar / hazırlık | `SETUP` | eşkenar dörtgen | mor |
| Planlı duruş | `PLANNED` | yuvarlak kare | mavi |
| Plan dışı | `NON_SCHEDULED` | kesik çizgili daire (içi boş) | gri |

**Sebep simgeleri** sunucunun 23 sebeplik kataloğunun (`MACHINE_STOP_REASONS`, `Teks-Erp/src/constants/reason-presets.ts`) aynasıdır. Lucide'de "yatay iplik / dikey iplik koptu" ayrımı olmadığından üç özel simge çizildi: **atkı kopuşu YATAY**, **çözgü kopuşu DİKEY** kırık iplik, **kenar kopuşu** kenarda kırık iplik.

**Sayaç kademeleri** (renk + halka):

| Kademe | Anlam | Sayaç rengi |
|---|---|---|
| `WITHIN` | hedef süre içinde | mürekkep (nötr) |
| `OVERDUE` | hedef aşıldı, iletim payı işliyor | kehribar |
| `ESCALATED` | patrona iletildi | koyu kırmızı + kart çerçevesi + yavaş nefes |
| `UNTRACKED` | plan dışı, süre izlenmez | gri, halka yok |

Halka hedefin tüketilen kısmını gösterir ve hedefte dolar. Sayaç bir saatin altında `DD:SS` akar; üstünde `1 sa 35 dk` (kartta birimler küçük, rakamlar büyük).

**Figür:** levent kalınlığı = kalan iplik; dokunan bezin rengi = kumaşın rengi; mekik hızı = devir (göz yormayan aralıkta sınırlı). Durunca bütün hareket aynı karede donar.

## 4 · Oyunsu öğeler (ölçülü)

- **Canlı makineler:** mekik gider gelir, çerçeveler ağızlık açar, tarak vurur, bez akar.
- **Vardiya hedef çubukları:** kartta ve özette dolan çubuk.
- **⭐ Vardiyanın yıldızı:** çalışma oranı en yüksek tek tezgah (eşitlikte metre).
- **🏆 En iyi hol:** çalışma oranı en yüksek hol.
- **Yeni duran tezgah** tek seferlik kısa bir sıçrama yapar; **patrona iletilen** kart 4,5 sn'de bir yavaşça "nefes alır" — yanıp sönme yok.
- **Puan, sıralama tablosu, kişi karşılaştırması YOK** — ekran makineyi gösterir, insanı yarıştırmaz.
- `prefers-reduced-motion` bütün animasyonları kapatır.

## 5 · Uyarı zinciri (eskalasyon)

### 5.1 Kademeler

```
duruş başladı ──► görevliye bildirildi ──► görevli tezgahta ──► (hedef + pay dolduysa) patrona iletildi
     │                  🔔                       ✋                          ♛
     └── sayaç işler; halka hedefe doğru dolar; hedef dolunca sayaç rengi değişir
```

- **Kartta** üç küçük halka (🔔 ✋ ♛) yazısız gösterir: gerçekleşen yanar, bekleyen soluk.
- **Detayda** aynı zincir zaman çizgisidir: kişi, gerçekleştiği saat; bekleyen patron adımı için **beklenen saat** (`~HH:mm`).
- **İletim kuralı:** duruşun yaşı ≥ sebebin hedef süresi + iletim payı ⇒ patrona iletilir. Görevlinin tezgaha gelmesi zinciri durdurmaz — ölçülen müdahale değil **çözüm** süresidir (tezgah çalışınca zincir kapanır).
- **Kullanıcının senaryosu:** atkı kopuşu, hedef 5 dk, aşılınca patrona ⇒ mock'ta **pay = 0**.

### 5.2 Hedef süre ve pay = profil/ayar verisi

- **Sebep başına hedef süre** (`targetMin`) ve **iletim payı** (`graceMin`) KODDA DEĞİL fabrika ayarında yaşar ([PROFİL]: her fabrika kendi sürelerini seçer). **Karar (kullanıcı 2026-10-09):** hedef süreyi **fabrika yöneticisi panelden, sebep kataloğu satırında** ayarlar; [PROFİL] verisidir, kodda sabit değildir. Mock'ta `Electron/src/pages/Operations/WeavingFloor/stopReasons.ts` içinde örnek değerler: atkı 5 · çözgü 10 · kenar 8 · levent bağlama 30 · tahar 120 · planlı bakım 60 dk …; plan dışı sebeplerde süre **izlenmez** (`null`).
- Gerçek veride yeri: sebep kataloğu `ReasonPreset(kind = MACHINE_STOP)` satırına bir **hedef süre** kolonu (karar gereği satırda; ayrı ayar tablosu seçeneği düştü) + fabrika ayarında tek bir **iletim payı** (pay biçimi açık — §8). Değişiklik geçmişi etkilemez: açık duruş, başladığı andaki hedefle değerlendirilir (ayar değişikliği defterine yazılır).
- Varsayılan = bugünkü davranış kuralı: ayar satırı yoksa **süre izlenmez, kimseye iletilmez** (bayrak kuralı — çıkışsız kapı üretmez).

### 5.3 Kanallar

| Kademe | Kime | Kanal |
|---|---|---|
| Bildirim | holün/vardiyanın görevlisi | **görevli telefonu — mobil uygulama** bildirimi; **kol saati** ayrı bir kanal değil, telefon bildiriminin saate yansımasıdır |
| Müdahale | (görevliden geri) | mobil uygulamada "tezgahtayım" dokunuşu ya da tezgah telemetrisinin kendisi |
| İletim | patron | **patron uygulaması** + panel |

**Çekirdek kısıt:** fabrika sunucusuna dışarıdan **GELEN port açılmaz**. Patron bildirimi fabrikanın **çıkan, kurulum anahtarıyla imzalı kanalı** üzerinden **patron bulutuna** gider; patron uygulaması bildirimi buluttan alır (`docs/kurallar/patron-bulutu.md`, `docs/design/PATRON-BULUTU.md`). Saha telefonu fabrika ağındadır, bildirimini fabrika sunucusundan alır.

### 5.4 Gerçek veriye geçişte gerekenler

1. ✓ **Tezgah telemetrisi** — duruşun başladığı an ve tezgahın tekrar çalıştığı an makineden gelmeli; elle girişle "kaç dakikadır" güvenilmez.
2. **Sorumlu ataması** — hol/vardiya → görevli eşlemesi (bugün yok).
3. ✓ **Bildirim altyapısı** — mobil push (saha) + patron bulutu iletimi (patron); ikisi de bu dilimde YAZILMADI.
4. **Zincir defteri** — bildirim/müdahale/iletim damgaları "ne oldu" bilgisidir ⇒ duruş olayının kendi hareket satırlarında durur (audit'ten türetilmez).

## 6 · Mock → gerçek veri eşlemesi

Bileşenler yalnız `types.ts` şekline bağlıdır; geçişte yalnız `useLoomFloorLive` gövdesi değişir (sorgu + canlı akış), dönüş şekli sabit kalır.

| Ekrandaki alan | Mock (bugün) | Gerçek kaynak |
|---|---|---|
| "bugün %" (kart, hol) | `today.runSec / today.plannedSec` — günün önceki vardiyaları hol başına uydurma oran | günün `MachineShiftStat` satırları + açık vardiya telemetrisi (kullanılabilirlik; fabrika günü `factoryDayStart`) |
| "şu an %" (üst şerit) | çalışan / toplam | açık duruşu olmayan tezgah / izlenen tezgah |
| durum / açık duruş (`openStop`) | `mock/stepFloor.ts` rastgele | `MachineStopEvent` + tezgah telemetrisi (Faz 2, `MachineSpec.monitoringState = LIVE`) |
| devir, atkı, metre | devir × süre / atkı sıklığı | `MachineRun` + telemetri kovaları |
| vardiya, kalan süre | fabrika gününü 00/08/16 diye böler | `ShiftInstance` / `ShiftDefinition` |
| çalışma oranı, hız | `availabilityPct` · `performancePct` (ayrı) | `MachineShiftStat` terimleri (`computeShiftTermsPure`, `Teks-Erp/src/services/helpers/loom-shift-terms.helper.ts`) — kullanılabilirlik ve performans AYRI kalır |
| dokuma işi, plan/üretilen | uydurma `DK…` | `WeavingOrder` (`plannedM`; ÜRETİLEN ≠ TEZGAHTA — `docs/kurallar/dokuma.md`) |
| levent, kalan iplik | uydurma `LV-…` | **BAĞLANDI (2026-10-10):** `looms[].beams` = `mountedBeamViewsTx` (`GET /api/warp-beams/mounted/:id` ile AYNI helper; yuva sırası, kalan levent defterinden, oranın paydası plan uzunluğu); yalnız devere + `devere.mountTracking` açıkken dizi, kapalıyken `null` (`beamTracking:false`). Kart: figürün sol altında ilk bitecek leventin kalanı (+N, numara ipucunda); detay: her levent ayrı satır (yuva · çözgü · plan) |
| sebep, sınıf, simge | `stopReasons.ts` aynası | `ReasonPreset(MACHINE_STOP)` |
| hedef süre, iletim payı | `targetMin`, `ESCALATION_SETTINGS` | **BAĞLANDI:** sebep kataloğu `targetMinutes` + fabrika ayarı `tezgah.escalationGraceMinutes`; ikisi duruş satırına DONAR (`machine_stop_events.targetMinutes`/`escalationGraceMinutes`) |
| görevli, patron | uydurma adlar | sorumlu ataması + patron hesabı (yok) — gerçek ekranda "—" (ölçülmeyen değer uydurulmaz) |
| `source` | `"SIMULATED"` | `"MACHINE"` — uydurulmuş değer beyanla gider |

Gerçek ekran `useLoomFloorLive` (react-query, 5 sn yoklama, saat sunucu `asOf`a hizalı) ile `GET /api/loom-floor`u okur; "bugün %"/"şu an %" sunucuda tek helper'dan türer. Mock yalnız `mock/useLoomFloorMock.ts` (önizleme).

Mock deterministiktir (`mulberry32`, tohum dışarıda): aynı tohum + an ⇒ aynı salon; simülasyon adımı saftır (test: `mock/floorMock.test.ts`).

## 7 · Yer ve izin

- **Bugün (gerçek veri):** route `operations/weaving-floor` (`ProtectedRoute loom:live-view`) + karo (aynı izin, `visibleWhen` tezgah) + `SCREEN_CATALOG` satırı (`modul: tezgahEnabled`) + `ROUTE_MODULE` aynası vardır; canlı veri ucu `verifyToken` → `requireTezgahEnabled` → `loom:live-view`. Örnek veri (mock) yalnız önizlemeden açılır; `previewOnly.test.ts` mock'u içe aktaranları önizleme + `content-routes.tsx` ile sınırlar. Dal dönemindeki `operations/weaving-orders/salon` yolu + `weavingorder:read` + dokuma kapısı main'e İNMEDİ (§8 karar 6).
- **Karar (kullanıcı 2026-10-09):** ekran ayrı bir **"dokuma canlı izleme"** izniyle açılır; hangi rolün göreceğini fabrika panelden atar (izin kataloğu kodda, atama panelde — kök `CLAUDE.md`). TV için **salt-okur ayrı hesap** açılır. Geçiş sonraki dilimdir (§9).
- **Modül (karar 2026-10-10, §8 karar 6):** ekran **`tezgahEnabled`** ("Tezgah izleme") arkasında doğar, `dokumaEnabled` arkasında DEĞİL.
- `reports/dokuma/*` yolu elendi: backend rapor kataloğu girdisi ister, katalog dışı anahtar kapalı sayılır.
- Geliştirme önizlemesi `Electron/preview-weaving-floor.html` yalnız Vite geliştirme sunucusunda açılır; derleme girdisi değildir (electron-vite girdisi yalnız `index.html`), giriş modülü üretimde hata fırlatır.

## 8 · Kararlar ve açık kalanlar

Kullanıcı 2026-10-09 sabah beş soruyu kapattı; kaynak her satırda "kullanıcı 2026-10-09".

| # | Soru | Karar (kullanıcı 2026-10-09) | Bu dalda |
|---|---|---|---|
| 1 | Hedef süreleri kim ayarlar? | **Fabrika yöneticisi, panelden, sebep kataloğu satırında** ([PROFİL] verisi; kodda sabit değil). | Belge (§5.2); mock örnek değerleri `stopReasons.ts`te kalır. Kolon sonraki dilim. |
| 2 | TV'de tam ekran kendiliğinden mi? | **Ayrı bağlantı; menü yok, açılınca tam ekran, kendini tazeler.** | Mock: `tv` kipi (önizleme `?kip=tv`, `docs/design/dokuma-canli-ekran/06-tv-kipi-koyu.png`). Menüsüz bağlantı sonraki dilim. |
| 3 | Dizilim gerçek salon planından mı? | **Hayır — salon (hol) + tezgah numarası ızgarası; gerçek kat planı YOK.** | Bugünkü ızgara zaten böyle; değişiklik yok. |
| 4 | Yüzdeler ne anlatır? | **Kartta "bugün %"** (o tezgahın bugünkü çalışma oranı), **üst şeritte "şu an %"** (şu an çalışan tezgah oranı); ikisi de açık etiketli. | Mock uyarlandı (§2); hol başlığı da "bugün %". |
| 5 | Hangi roller görür? | **Ayrı "dokuma canlı izleme" izni**; rol ataması fabrikanın panelinde; TV için salt-okur ayrı hesap. | Sonraki dilim (§9). |

Kalan iki soru 2026-10-10'da 1e tarafından "yüzlerce farklı fabrikaya satılacak ürün" ölçütüyle kapatıldı (kullanıcı yetkisi 2026-10-09: soru sorma, karar ver):

| # | Soru | Karar (1e 2026-10-10) | Gerekçe |
|---|---|---|---|
| 6 | Modül anahtarı `dokumaEnabled` mı `tezgahEnabled` mı? | **`tezgahEnabled`** — ekran, canlı veri ucu ve "dokuma canlı izleme" izninin `SCREEN_CATALOG` satırı (`modul: "tezgahEnabled"`) tezgah izleme modülüne bağlanır; dokuma işi bloğu yalnız `dokumaEnabled`, levent bloğu yalnız devere + levent tezgah bağı defteri açıksa çizilir (kapalı modülün verisi görünmez). Ekran yalnız izlenen tezgahları (`MachineSpec.monitoringState = LIVE`) "çalışıyor/duruyor" diye sayar; izlenmeyen tezgah gri "izlenmiyor" kalır. | Ekranın cevapladığı soru ("şu an duruyor mu, kaç dakikadır") yalnız canlı tezgah izlemesiyle doğrudur. Dokuma modülü (dokuma işi, koşum, doff, elle duruş, karne) izlemesiz de satılır ve fabrikaların çoğunda izleme olmayacak; ekran dokumaya bağlansa izlemesiz fabrikada sayaç elle girişten türer ve yanlış söyler. İki modül kardeştir (ikisi de `productionEnabled`a bağlı, biri ötekinin ön koşulu değil). Yeni bayrak yok: `tezgahEnabled` var ve varsayılanı KAPALI = bugünkü davranış (ekran yok). |
| 7 | İletim payı tek değer mi, sebep başına mı? | **Fabrika genelinde TEK değer** ([PROFİL] sayısal ayar, dakika; varsayılan 0 = hedef dolunca patrona). Sebep satırına ikinci kolon AÇILMAZ. | Sebebin aciliyeti zaten sebep satırındaki hedef sürededir (karar 1); pay "patron ne kadar tolerans tanır" sorusudur, sebebin değil kademenin özelliğidir. İletimi yalnız hedef + pay TOPLAMI belirler, yani sebep başına pay hedef süreyle aynı serbestliği ikinci kez açar ve her fabrikaya 23 sebep × 2 ayar yükler. Varsayılan 0 davranışı değiştirmez: hedef süre boşken (`null`, varsayılan) hiçbir duruş izlenmez ve kimseye iletilmez. Açık duruş başladığı andaki hedef + payla değerlendirilir. Sahada sebep başına istisna gerekirse sebep satırına boş geçilebilir bir pay kolonu (`null` = fabrika payı) geriye uyumlu eklenir; bugün açılmaz. |

**Bugünkü durum (2026-10-10):** karar 1, 4, 5 (izin kısmı), 6 ve 7 gerçek veriyle uygulandı; `tezgahEnabled` `EKRANSIZ_MODULLER`den çıktı. Pay tek fabrika ayarıdır ve duruş açılırken donar; hedef süre sebep KARARI anında donar (açılışta/sınıflandırmada/yeniden sınıflandırmada). Sınır: yeniden sınıflandırmanın ters kaydı "from" sebebin O ANKİ katalog hedefini yazar, orijinal donmuş değeri değil. Karar 2 (menüsüz TV bağlantısı) ve TV hesabı AYRI sonraki dilimdir.

## 9 · Gerçek uygulama dilimleri

Madde 1–3 ve 6 2026-10-10'da indi (✓); madde 4–5 (TV bağlantısı, TV hesabı) AYRI sonraki dilimdir.

1. **Sebep kataloğuna hedef süre kolonu** — `ReasonPreset` + `targetMinutes Int?` (yalnız `MACHINE_STOP`ta anlamlı; başka kind'de dolu → 400, `stopLossClass` deseniyle simetrik servis kapısı + DB CHECK). `null` = süre izlenmez, kimseye iletilmez (bugünkü davranış = varsayılan). Reçeteler: `docs/RECETELER.md` § Yeni migration · § Yeni Prisma modeli (kolon); alan kuralları `docs/kurallar/sebep-katalogu.md`. Yazma yolu yalnız sebep kataloğu ucu; değişiklik audit'e yazılır, açık duruş başladığı andaki hedefle değerlendirilir (duruş satırına donar — geçmiş etkilenmez). Panel: Sebep Kataloğu → Tezgah duruşu sekmesinde satır başına "hedef süre (dk)" alanı.
2. **İletim payı ayarı** — §8 karar 7: TEK fabrika ayarı (dakika, varsayılan 0; `docs/RECETELER.md` § Yeni feature flag / sistem ayarı — sayısal ayar, davranış bayrağı değil), panelde Tezgah izleme kategorisinde; sebep satırına kolon açılmaz. Değeri açık duruş satırına başladığı anda donar.
3. **"Dokuma canlı izleme" izni** — `docs/RECETELER.md` § Yeni backend route + izin kodu, 17 adım: kod `PERMISSION_CATALOG`a (tek iki nokta, `mobile:` ön eki DEĞİL — masaüstü/TV ekranı), en az bir dar rol şablonu ya da gerekçeli muaf, `SCREEN_CATALOG` girdisi + `modul: "tezgahEnabled"` (§8 karar 6; aynı commit'te `EKRANSIZ_MODULLER`deki `tezgahEnabled` muafı silinir ve ayar panelindeki Tezgah izleme satırı eklenir — `test_screen_catalog §10b`), Electron `content-routes.tsx` `ProtectedRoute` ile karo `tile-config.ts` AYNI izinle, canlı veri ucu `verifyToken` + izin + adlandırılmış modül kapısı (`requireTezgahEnabled`). `previewOnly.test.ts` bu dilimde route'u tanıyacak biçimde değişir. Atama panelden; migration YAZILMAZ (boot uzlaştırması).
4. **TV bağlantısı (menüsüz)** — App kökünde kabuk-dışı bir yol (2FA kurulum sayfasının deseni: `App.tsx` `Root` kapısı), sekme/menü kabuğu çizilmeden `WeavingFloorPage tv`; açılışta tam ekran, oturum düşerse kendiliğinden yeniden bağlanır, veri akışı kesilirse "Canlı" damgası bayatlar ve ekranda görünür uyarı verir.
5. **TV hesabı** — salt-okur ayrı kullanıcı: yalnız "dokuma canlı izleme" izni (yazma izni yok); iki adımlı giriş kararı (kullanıcı 2026-09-30: herkese TOTP) TV cihazında nasıl karşılanır ayrıca ölçülür; parola/PIN sır hijyeni kurallarıyla.
6. ✓ **Canlı veri** — `useLoomFloorLive` gövdesi sorgu + akışa döner (§6 tablosu); "bugün %" ve "şu an %" sunucuda tek helper'dan türer (ayrışan yüzey kuralı), istemci yalnız gösterir.
7. ✓ **Levent alanı** (2026-10-10) — `looms[].beams` + üstte `beamTracking`; kaynak `mountedBeamViewsTx` (`GET /warp-beams/mounted` ile aynı helper), yalnız devere + `devere.mountTracking` açıkken; kart rozeti + detay satırları (§6 tablosu). Bekçi `test_loom_floor` §6, `fromApi.test.ts`, `LoomCard.test.tsx`.
