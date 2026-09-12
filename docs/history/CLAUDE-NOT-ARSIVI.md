# CLAUDE.md Karar Notları Arşivi

> **Bu dosya nedir:** Kök `CLAUDE.md`'deki tarihli karar notlarının TAM METNİ.
> 2026-08-17'de taşındı — CLAUDE.md her oturumun bağlamına otomatik yüklendiği
> için 150k karakter sınırını aşmıştı (186k). İçerik SİLİNMEDİ, buraya birebir
> taşındı; CLAUDE.md'de her not için kısa bir tetik satırı duruyor.
>
> **Kullanım:** CLAUDE.md'deki dizin satırı hangi alana dokunacaksan o notu
> işaret eder — o alanda çalışmadan önce buradaki TAM notu oku. Notlar
> kronolojik değil, CLAUDE.md'deki orijinal sırasıyla durur.
>
> **⚠️ Yeni not kuralı (dosya yeniden şişmesin):** Yeni tarihli karar notu
> ARTIK CLAUDE.md'ye değil BU DOSYAYA yazılır; CLAUDE.md'deki "Karar Notları
> Dizini"ne yalnız 1-4 satırlık özet + tetik eklenir.
>
> **⚠️ Sınıf etiketi kuralı (2026-09-03):** Bundan sonra her yeni karar notu başlığında `[ÇEKİRDEK]` (her fabrikada değişmez: defter semantiği, brüt sevk, idempotency, kilit sırası, fail-closed kapılar, sır hijyeni, veri bütünlüğü) ya da `[PROFİL]` (bu kurulumun seçimi) etiketi taşır; karışık notta profil-bağımlı cümle satır içinde ⚠️ ile işaretlenir — bkz. `docs/design/MODUL-BAYRAK-TASARIM.md` §0/§11.
>
> **Okuma kuralı:** "adnansahin'de yok" = "bayrağı kapalı". Hiçbir eski not `if (musteri === 'X')` gerekçesi olarak kullanılamaz.

> **2026-09-05 yeniden yapılandırma:** kök `CLAUDE.md` kural kitabına indi (~6k token); tarihli notların dizin satırları kaldırıldı — bu dosya artık TEK tam-metin kaynağıdır. Canlı kural özeti alan dosyalarında (`docs/kurallar/<alan>.md`), teknik desenler `docs/KOD-KURALLARI.md`. Ezilen notlar aşağıda `⚠️ GEÇERSİZ/KISMEN` bloğu taşır; kökte tam metni olmayan 37 not dosya sonuna "Kökten taşınan tam metinler" başlığıyla eklendi.

---

## 2026-09-06 (2) — §1d'nin gerçek sebebi ölçüldü: dört tahmin de yanlıştı [ÇEKİRDEK]

Kullanıcı "bu siparişlerin gerçek sorununu nokta atışı tespit etmeliyiz" dedi. Teşhis aracı
yazıldı (`scripts/tahsis_teshis.ts`, salt-okunur: motorun KENDİ yüklemlerini her top için
sırayla koşturur) ve **dört tahmin de çürüdü**:

| Tahmin | Ölçüm |
|---|---|
| "Sipariş seçilmemiş" | 42'sinde de **seçilmiş** (89 sevkiyatın 88'inde sipariş var) |
| "Fazla mal gönderilmiş" | Fazla sevk edilmiş kalem **SIFIR** |
| "Şube tutmuyor" | 64 çiftin **64'ü** eşleşiyor |
| "En/renk tutmuyor" | Yalnız 950 m + 968 m — küçük kalem |

GERÇEK DAĞILIM: **15.905 m bugün YAZILABİLİRDİ** (spec de kapasite de uygun → sebep sevk
anındaki durum: kapasite doluydu ya da sipariş sonradan büyüdü) · **15.723 m kapasite dolu** ·
4.480 m kumaş kalemde yok · 968 m renk · 950 m en.

⚠️ Yol üstünde KENDİ AÇIKLAMAMI düzelttim: "tahsis top bazlıdır, top bölünmez" dedim ve
YANLIŞTI — `distributeSacksToLines` `min(ihtiyaç, mevcut)` ile metraj bazlı böler.

**KULLANICI KARARLARI ve uygulananlar:**
- **En toleransı** (`shipping.allocWidthToleranceEnabled` + `…Cm`) — ⚠️ yalnız EN gevşer;
  kumaş ve renk KESİN kalır ve bekçi bunu ayrıca ölçer. Varsayılan kapalı; bu fabrikada
  **5 cm ile açıldı** (kullanıcı kararı).
- **Fazla sevk deftere yazılsın** (`shipping.allowOverAllocation`, varsayılan kapalı) —
  açıkken fazlalık eşleşen satıra yazılır, `shippedQty` ısmarlananı geçebilir.
- **Onarım modülü** — yeni izin `shipping:repair-allocation` (`shipping:write` YETMEZ),
  yeni ekran (Operasyon → Siparişe Yazılamayanlar) + Siparişler ekranından kısa yol butonu.
  Motor `setShipmentOrders`: sipariş kümesi DEĞİŞMEZ, yalnız tahsis bugünün verisiyle
  yeniden kurulur ve irsaliye v+1 donar. Onaydan önce ne değişeceği gösterilir.
- **Görünürlük** — sevkiyat detayı artık `defterBoslugu` taşıyor ve panel rozetle gösteriyor.
  Bu sayı bugüne kadar YALNIZ audit izindeydi; hiçbir ekranda yoktu.

Bekçi: `test_allocation_repair` (17 kontrol, dört negatif sonda ölçüldü).

⚠️ AÇIK KALAN: 15.905 m'lik onarılabilir küme **onarılmadı** — ekran hazır, düğmeye kullanıcı
basar. Hangi sevkiyatın onarılacağı iş kararıdır.

---

## 2026-09-06 — Sevkiyat turu: kapsama ekseni, çeki rejimi, ekran↔kâğıt hizası, toplu dağıtma [ÇEKİRDEK]

Kullanıcı iş gerçeğini söyledi: *"fabrika düzensiz çalışıyor; elemanlar sipariş OLSA BİLE
siparişi işaretlemeden sevk ediyor."* Bu, §1d'yi (42 sevkiyat / 11.384,7 m deftere girmeyen
metraj) bir KOD HATASI olmaktan çıkarıp bir İŞ AKIŞI gerçeği yapıyor — çözüm "kapıyı sıkılaştır"
değil, "rejimi bayrakla seç, serbest rejimde teşvik et". Beş ajanlı salt-okunur keşif:
`docs/history/sevkiyat-2026-09-06/`.

**① Kademeli rejim ZATEN VARDI ama yanlış yarımı ölçüyordu.** `shipping.orderRequirement`
(off/warn/block) 2026-09-03'te yazılmış. Ölçüm: 89 sevk edilmiş sevkiyatın **88'inde sipariş
zaten seçilmişti** — yani `block` açık olsaydı 42 boşluklu sevkiyatın **hiçbirini** durdurmazdı.
Helper'ın kendi başlığı bunu itiraf ediyor: *"kapı NİYETİ ölçer, SONUCU değil."*
Çözüm: İKİNCİ VE DİK EKSEN `shipping.orderCoverage` (off/warn/block, varsayılan `off`).
Tek merdivene indirmek "bağ sıkılığı arttıkça kapsama da sıkılaşır" diye yanlış bir sözleşme
kurar ve bugün meşru olan "sipariş seçilsin ama fazla mal serbest kalsın" düzenini ifade
edilemez kılardı. Kapı YALNIZ kurulumda; `dispatchShipment`e KONMAZ — sevk anında `throw`
malı bina içinde kilitler (aynı gerekçe `orderRequirement` için de yazılı).

**② Çeki listesine ayrı ad rejimi** (`shipping.docCekiNameMode`, varsayılan `devral`). Tek global
rejimi `ikisi` yapmak çekiye iki adı getirirdi AMA aynı anda müşteriye giden ürün listesine de
"Stok adı" kolonunu geri koyardı — fabrika onu bilerek kapatmış. Çeki listesi tek başına da
basılıyor ve ambar kontrol listesi olarak kullanılıyor; iki ad ORADA anlamlı.

**③ Ekran ile kâğıt AYRIŞIYORDU** — kök CLAUDE.md'nin "türetilmiş alan / ayrışan yüzey" sınıfı.
Sevkiyat detayı ve sipariş seçim ekranı yalnız `OrderLine` override'ını taşıyordu; belge master
alias kademesini de çözüyordu. Ölçüm: 1.778 topun **424'ünde (%24)** master alias var, override
yok → irsaliyede müşteri adı basılıyor, elemanın ekranında hiç görünmüyordu (renkte 152 top).
İki projeksiyon da artık `customer-name.helper` kademesini kullanıyor; karşılığı yoksa `null`
döner (bizim adımız "müşterideki ad" diye basılmaz). Tablet aynı ucu kullandığı için düzeltmeyi
BEDAVA alıyor — APK gerekmedi.

**④ (D) zaten yapılmıştı.** Kullanıcı "müşteri RENK sütununu yapmadık sanırım" dedi; ölçüm
sütunun dört katmanda da VAR olduğunu gösterdi. Sorun kod değil VERİ: fabrikada 8 renk alias'ı
var (62 kumaş alias'ına karşı), sevk edilen 1.778 topun yalnız %12'sinde müşteri renk adı
çözülüyor; kalanında sistem fail-open davranıp bizim adımızı basıyor.

**⑤ Çuval filtre hatası — sunucuda değil, bayat kapanışta.** `useDataTable`'ın arama debounce'u
mount anındaki FİLTRESİZ URL kopyasını 300 ms sonra geri yazıp `filter[customerId]`i siliyordu.
Kapıdan cari seçmek filtreyi yazıp AYNI tıkta listeyi mount ettiği için tam o akışta ısırıyordu.
⚠️ `setSearchParams`ın fonksiyonel biçimi bunu ÇÖZMEZ (setter `prev`i kendi kapanışından verir).

**⑥ Toplu çuval dağıtma** — yıkıcı işlem olduğu için önizleme ucu ZORUNLU: etkilenen HER top
satır satır dönüyor, engelli çuval (sevkiyata atanmış) sebebiyle gösteriliyor ve uygulamada
ATLANIYOR. "Silme" fiili DAĞITMADIR: çuval kaydı korunur.

⚠️ ÖLÇÜM İKİ KEZ KENDİ YÜKLEMİMİ ÇÜRÜTTÜ: (a) `useDataTable` için yazdığım "mount'ta hiç yazma"
koruması sondada ısırmadı → ölçülmemiş davranış değişikliği bırakılmadı, çıkarıldı;
(b) negatif sonda ölçümünde `grep "^❌"` kullandım, bekçinin kırmızı satırları GİRİNTİLİ olduğu
için üç sonda da "ısırmıyor" göründü — yüklem yanlıştı, bekçi değil.

---

## 2026-09-06 — Fabrika yedeği üzerinde prova: defterde büyüyen boşluk, index kararı, fixture çarpışması [ÇEKİRDEK]

Kullanıcı fabrikanın 2026-09-05 yedeğini getirdi. Reponun zorunlu ritüeli (restore → `migrate deploy`
→ bekçiler) ilk kez sonuna kadar koştu ve üç şey çıktı. Ölçümlerin tamamı
`docs/history/test-ortami-2026-09-06/FABRIKA-KOPYASI.md`.

**① Yedek `idx_scan` TAŞIMAZ.** Tarama sayaçları çalışma zamanı istatistiğidir, dump'a girmez;
restore sonrası sıfırlanır. "Fabrikada hangi index kullanılıyor" sorusu yedekle cevaplanamaz —
sunucuda tek satırlık salt-okunur sorgu ister. Yedeğin verdiği şey gerçek VERİ HACMİ (4.556 top).

**② `rolls` index kararı: HİÇBİRİ DÜŞMÜYOR — ve "0 tarama" ölü demek değil.**
458 bekçi fabrika verisinde koşturuldu, sonra sıfır/az taramalı her index kendi hedef sorgusuyla
EXPLAIN'lendi. `rolls_status_currentQty_idx` bekçi koşumunda **0 tarama** aldı ama panelin top
listesindeki "Metre" sütunu sıralanabilir (`columns.tsx:222`) ve planlayıcı o sorguda index'i
SEÇİYOR. Aynısı benim perf turunda eklediğim iki kısmi index için de geçerli (0 ve 2 tarama, ama
ikisi de kendi sekmesinde seçiliyor). **Ders: bekçi paketi bir KOD YOLU ENVANTERİDİR, kullanım
profili değildir** — UI sıralamasını hiç denemez. Yazma maliyeti gerçek (HOT %0,5) ama çaresi index
silmek değil: `updatedAt` dört index'te ve her güncellemede değişiyor, HOT hiçbir `fillfactor` ile
mümkün değil. Bedel ölçüldü ve küçük (tablo 4,7 MB / index 2,2 MB) → aksiyon yok.

**③ En değerli bulgu — canlı defterde BÜYÜYEN boşluk.** `test_consistency` bozulmamış fabrika
kopyasında (test artığı: 0) dört bölümde düştü. En ağırı §1d: **42 sevkiyat · 11.384,7 m** çıkmış
ama sipariş defterine yazılmamış (17 Ağu – 4 Eyl). 2026-08-31 ölçümü 23 sevkiyat / 7.200,6 m'ydi —
beş günde neredeyse iki katına çıktı. Mal çıktı, irsaliye basıldı, brüt rapor görüyor; görünmeyen
tek şey sipariş defteri, o yüzden planlamacı aynı metrajı yeniden üretime verebilir. Ayrıca §1c
5 satır, §20 bir iş emri `COMPLETED` ama hiç adımı yok. §13'ün 2 satırı bilinen ve bilerek bırakılmış.
⚠️ Onarım toplu UPDATE ile YAPILMAZ — hangi kaleme yazılacağı İŞ KARARIDIR.

**④ Provayı kıran hata düzeltildi.** `seed:fixtures` fabrika verisinde `nameFold` seddine çarpıp
düşüyordu: fixture müşterisi "Moda Tekstil" ↔ fabrikanın gerçek "MODA TEKSTİL" (`MUS1707260010`).
Bu `[TD-16]`'nın seed'in KENDİSİNDE ihlaliydi ve öngörülebilirdi (`name-normalize.helper.ts:73`
zaten o ölçümü taşıyor). Fixture adları damgalandı; 12 bekçi bu müşterileri kodla çözüyor, adı
kimse aramıyor. Yeni kural `[DB-29d]`. **`[DB-29b]` de kapandı:** 6 migration <1 sn.

**⑤ Fabrika verisinde 13 bekçi kırmızı** (445/458) ve küme temiz-DB koşumundan FARKLI — ortak
yalnız üç dosya. Sınıflar: `seed` koşulmadığı için seed makine kodlarını sabitleyenler · katalog
varsayımı (`'TUP'` kat değeri fabrikada yok) · altyapı. **Fabrika verisinde test artığı: 0** —
çöp tamamen dev DB'ye özgü.

---

## 2026-09-06 — Test ortamı: paralelleştirme ölçüldü ve ERTELENDİ, kapsam görünürlüğü onarıldı [ÇEKİRDEK]

**Soru:** "test ortamımız nasıl olmalı." Yöntem reponun kendi ölçütü: ölç, sonra karar ver.

**İki deney.** ① Tam paket, sıfırdan kurulmuş temiz DB'de: `migrate deploy` 4 sn, paket 333 sn,
**446/457**. Yani bekçilerin %97,6'sı gerçekten veriden bağımsız. ② DB-per-worker paralel koşum:
6 işçi DB'si paralel 15 sn'de kuruldu, paket **144 sn (2,3×)**; ikinci koşum aynı 12 kırmızıyı
verdi → deterministik.

**Hüküm: paralelleştirme ŞİMDİ DEĞİL.** Kazanç gerçek (~3 dk) ama (a) tam paket PR/push başına
koşuyor, kimseyi bekletmiyor; (b) koşucu bizim olduğu için işçi havuzu / çıktı tamponlama /
N+1 kapı doğrulaması ~150-200 satır ELLE yazılır; (c) **kalıntı sorununu çözmez** — 458/6 ≈ 76
bekçi hâlâ aynı DB'de ardışık koşar, `TEST-` damgası ve `finally` temizliği aynen gerekir;
(d) önce 12 ortam-bağımlı bekçi düzelmeli. "Paralelleştirirsek temizlikten kurtuluruz" ÖLÇÜMLE yanlış.

**Deneyin asıl ürünü iki ölçüm.** ① Temiz DB'de kırmızı veren 12 bekçi ADIYLA listelendi
(`docs/standart/TEST-VE-DERLEME.md` §7) — bu `[TD-17]`'nin ölçülmüş hâli: kırmızı/yeşil ayrımı
koddan değil ortamdan doğuyor. ② İşçi/test DB adı `_test` ile BİTMELİ: `db-guard.ts` izin listesini
`endsWith` ile eşliyor, `tekserp_test_w1` reddedildi / `tekserp_w1_test` geçti.

**Onarılan kapsam körlüğü.** Koşucunun "N atlandı" sayacı serbest regex'ti ve üç dosyada HAYALET
sayı üretiyordu (`test_label_bulk_seed` hiçbir şey atlamadan "3"); `Sonuç:` satırına demirlendi,
iki dosyaya gerçek sayaç kondu. Üç bekçi koşucunun tanımadığı özet formatını basıyordu
(iki tanesi İngilizce `N passed, M failed`, biri "düştü") ve **46 kontrol görünmüyordu**;
düzeltildi ve sözleşmenin kapısı kuruldu (`test_bekci_sozlesmesi.ts`, negatif sonda ✓).

**Kural boşluğu kapatıldı.** 457 bekçinin 173'ü hiçbir kural dosyası yüklemiyordu (istemci tarafında
bu boşluk yoktu: 213/213 ve 86/86). `.claude/rules/bekci-standart.md` eklendi.

**`[TD-07]`'nin gerekçesi düzeltildi (karar DEĞİŞMEDİ).** "vitest bunu koşamaz" doğru değil —
koşardı (`fileParallelism:false` + `globalSetup` + `pool:'forks'`). Doğru gerekçe dönüşüm bedeli:
458 dosya / ~134k satır ve mock kültürü riski. Kazancın kaynağı framework'süzlük değil MOCK YOKLUĞU;
test edilen şeylerin ağırlığı (DEFERRABLE FK, partial UNIQUE sed, advisory kilit, DB CHECK, trigger
damgası) mock'lanamaz.

**Ölçüm çürüttü, kural YAZILMADI:** "kontrol atlayan bekçi sayıyı özet satırında beyan etmeli"
metinden ölçülemiyor — aday yüklem 458 dosyanın 52'sini işaretledi, çoğu bir check ETİKETİNDE geçen
kelimeydi. Gerekçe bekçinin başlığına yazıldı.

Ölçümlerin tamamı: `docs/history/test-ortami-2026-09-06/` (PLAN.md + üç ham JSON).

> ⚠️ **PROFİL GERÇEĞİ:** "Rezerv YOK" · "mühür YOK" · `Sack.customerId` opsiyonel · tek depo — dördü de referans profilin (adnansahin, basit usul işlemeci) seçimidir; rezervasyon altyapısı `shipping.reservationEnabled` ile ayrı dilimde gelecek, çoklu depo `depo.multiEnabled` arkasında. Notun **stok yalnız DISPATCH'te düşer / `SackAllocation` sevk ANINDA yazılır / PLANNED tahsis sayılmaz** kısmı ÇEKİRDEK defter semantiğidir ve bayraklanmaz — bkz. MODUL-BAYRAK-TASARIM §4 karar #6, §9, §11.

> **NOT:** Tartı / paket / sevkiyat modülü **2026-07'de çuval depo modeline** geçti (`/api/shipping`, Shipment / Sack / **SackAllocation** / ShipmentOrder). Çuval bir **depo nesnesidir**; `Sack.customerId` **opsiyonel** (açılışta atanabilir, yoksa sevkte atanır), **mühür yok**. Akış: aç→okut→(opsiyonel tart) → çuval DEPODA (`shipmentId=null`, her an düzenlenebilir). **Rezerv yok** — `OrderLine.packedQty`/`Order.packedQty` ve `rebalanceCustomerPool` kaldırıldı; sipariş görünümü **İstenen | Sevk | Açık** (`Açık = quantity − shippedQty`). Sevkiyat depodan **çuval seçilerek** kurulur (`createShipment({ sackIds, customerId, orderIds? })`); sevk onayı (`shipping.confirmationEnabled`, varsayılan **kapalı**) → çuvallar **doğrudan sevk** edilir (`DISPATCHED`, yanıtta `dispatched=true`), onay **açık** → sevkiyat `PLANNED` kalır ve çıkış ayrıca `dispatchShipment` ile onaylanır — kapı önü ara adımı YOK (`PLANNED → DISPATCHED`). `SackAllocation` **sevk anında** seçilen siparişlere spec+şube FIFO ile yazılır (`distributeSacksToLines`). Stok yalnız DISPATCH'te `SHIPPED` düşer ve tahsis **dispatch'te** `shippedQty`'ye terfi eder (PLANNED tahsis sayılmaz). İptalde tahsis silinir, çuval depoya döner. Top→sipariş bağı yok. Tasarım: `docs/design/CUVAL-HAVUZU-TASARIM.md` (eski `docs/history/SEVKIYAT-LOOSE-TASARIM.md` superseded).

> ⚠️ **PROFİL GERÇEĞİ:** Çuval notunun üç yüzeydeki opt-in gösterimi, SACK etiketi alan seti ve "tek dokunuş tartı" bu kurulumun paketleme/sevkiyat tercihidir; **FAIL-CLOSED baskı** (şablon çözülemezse 400, başka `LabelKind`'a SAPMAZ) ve "blocklist yeni kolonu müşteri belgesine sızdırır" kuralı ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `KOD (commit 96de7f80, 2026-08-01 — bundle'da notu yok)`: 'LabelKind genişletirken 4 literal z.enum elle güncellenir' ayağı düştü: backend Zod z.nativeEnum(LabelKind) (Prisma enum'unu otomatik izler). Elle kalanlar Electron (labelTemplateService LabelKind+labelKindLabels, KINDS, ROUTE_KINDS) + mobil types/models.ts union.
> - KISMİ → `R:2026-08-21__2026-08-21-aksam-tutarlilik-taramasi`: Çuval içerik guard'ının adı/kapsamı değişti: resetSackWeightsTx → markSackContentChangedTx (kg sıfırlama + labelDirty ayrı updateMany). Sack.notes istisnası aynen KALIR.
>

> **NOT (2026-07-30 — çuval notu + çuval etiketi + tek dokunuş tartı):**
> • **`Sack.notes`** (VarChar 500) = çuvalın İÇ serbest notu ("kendimiz için"). **Annotation'dır:** durumdan bağımsız her an yazılır (sevk edilmiş çuvala da), donmuş belgeye girmez, `resetSackWeightsTx` silmez, `touchWarehouseSackTx` guard'ı **uygulanmaz** (bkz. `Teks-Erp/CLAUDE.md` kontrol listesi istisnası — guard'ı ekleme). Uçlar: `GET/POST /api/shipping/sacks/:id/notes`.
> • **Gösterimi üç yerde de OPSİYONEL + varsayılan KAPALI:** (a) çuval etiketinde `sackNote` alanı (şablona sürüklenmezse basılmaz), (b) sevk irsaliyesi ÇUVAL LİSTESİ'nde "AÇIKLAMA" kolonu, (c) iç ekranlar. Belge kolonu **opt-in**: `DocCol.defaultHidden` + `DocumentConfig.columns[tablo].shown` (allowlist) — `hidden` blocklist'i o kolonda YOK SAYILIR, çünkü blocklist yeni kolonu varsayılan GÖRÜNÜR doğurur ve iç not müşteriye giden irsaliyeye sızar. Baskı diyaloğundaki tek-seferlik `?rowNotes=1` bayrağı kalıcı ayarı **EZER** (pure OR) ve hiçbir yere yazılmaz. Satır notları `BuilderEntry.resolveLiveRowNotes` ile **her baskıda canlı** çözülür.
> • **`LabelKind.SACK`** = çuval etiketi. Barkod + QR = **`Sack.sackNo`** (CV+GGAAYY+NNNN) — Sack'e ayrı `barcode` kolonu EKLENMEDİ ("tek kod" kuralı, `utils/code-format.ts`). Katalogda **ürün/renk alanı YOK** (çuval karışık içerikli → tek ürün adı sessizce yanlış olur); toplam metraj/kg/top adedi + müşteri/şube + not basılır. Baskı **FAIL-CLOSED**: SACK şablonu çözülemezse 400 (roll/swatch'a SAPMAZ — `label-html-landscape.helper` bilinmeyen kind'ı `ROLL_FINISHED`'a düşürüp tire dolu top etiketi basardı). Çuval kodu top alanına okutulursa `scanIntoSack`/`locateRoll` anlamlı 400 döner; mobil Paketleme ekranı kodu tanıyıp o çuvalı **aktif** yapar.
> • **Tartı tek dokunuş** (mobil): ⚖ → kantardan oku → **doğrudan kaydet** (modal yok). Elle giriş çuval kartının **⋮** menüsünde. `LabelKind` genişletmesi Electron/mobil'de **derleme hatası vermez** (ikisi de kendi bağımsız union'ını taşır) — yeni bağlam eklerken `labelTemplateService.ts`, `KINDS` dizileri, `PeripheralDevices` tipleri ve 4 literal `z.enum` elle güncellenmeli.

> ✅ **ÇEKİRDEK:** "değer `code`'dur ad değil" · `toLocaleUpperCase("tr")` yasağı · kalitesiz topta fail-closed · tek uygulama noktası `prepareElements` — dördü de fabrikadan bağımsız; bayraklanmaz (MODUL-BAYRAK-TASARIM §11).

> **NOT (2026-08-02 — koşullu etiket elemanı, `showIf`):** Etiket Stüdyosu'ndaki her eleman (veri alanı, sabit metin damgası, çerçeve…) **kaliteye göre koşullanabilir**: *"kaliteyi YALNIZ 2. kalitede bas"* ya da tersi. Koşul PAYLOAD'da değil **ELEMANDA** yaşar (`LabelElement.showIf = { field:"qualityGrade", op:"in"|"notIn", values:[kod…] }`) — aynı top, farklı şablon → farklı görünürlük.
> • **Değer `QualityGrade.code`'dur, ad DEĞİL** (`Roll.qualityGrade` snapshot'ı da koddur). UI kaliteleri ADIYLA listeler, JSON'a KODU yazar; karşılaştırma **yerel-bağımsız** büyük harfle yapılır — `toLocaleUpperCase("tr")` "1.kalite"yi "1.KAL**İ**TE" yapıp eşleşmeyi sessizce bozardı (kod kimliktir, görüntü metni değil).
> • **Kalitesi belirlenmemiş topta koşullu eleman BASILMAZ** (op fark etmez, fail-closed): koşul kaliteye soru sorar, kalite yoksa cevap yoktur. Aksi halde `notIn` ile kurulmuş bir "1. KALİTE" damgası fason dönüşü / açık kumaş topunun üstüne basılırdı.
> • **Tek uygulama noktası `config/label-elements.prepareElements`** — beş render yolu (kanvas HTML, PPLA, PPLB, ZPL, raster) onu çağırır. Yeni bir emitter yazarken `expandMultilineText`'i DOĞRUDAN çağırma: koşul o dilde sessizce çalışmaz. Koşulsuz şablonda dizi aynen geçer (bugünkü çıktı bayt-bayt aynı). Legacy akış-modeli (varyantsız şablon) koşul TAŞIMAZ — özellik yalnız kanvas varyantlarında.
> • **Koşullu alan bağlam KİMLİĞİ sayılmaz** (`collectBoundKeys` onu atlar): koşullu `sackNo` taşıyan şablon çuval bağlamına atanamaz, çünkü kimliği yalnız bazı baskılarda basar.
> • Stüdyo: tuvalde huni rozeti + özellik panelinde "Koşullu basım (kalite)" + önizlemede **"Örnek: <kalite>"** seçici (yalnız koşullu eleman varsa çıkar — yoksa istek/çıktı bugünküyle birebir). Kalite kataloğu `GET /api/quality-grades`'ten okunur; liste ucu artık `label-template:read`'i de kabul eder (tasarımcının ayrıca `quality:read` yetkisi olmasın diye; yazma uçları dokunulmadı). Bekçi: `scripts/test_label_element_condition.ts` (üç negatif sondayla kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** Brüt sevk · donmuş belge · "iade AYRI belgeyle kapanır" · "Güncel rozeti = son versiyon, içerik güncel DEĞİL" — MODUL-BAYRAK-TASARIM §11'in ilk maddesi (defter semantiği bayraklanmaz): iki müşterinin raporu aynı kelimeyle farklı şey söyleyemez.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `A:2026-08-05__2026-08-05-belge-yolu-da`: 'Donmuş snapshot tek koruma' varsayımı düştü: üretici collectShipmentDocContent de RollReturn.prevSackId ile brüt kurar — reissue + lazy-init sevkten SONRA da onu çağırır. 'Fiş donmuş snapshot'tan okur' KALIR.
> - KISMİ → `R:2026-08-05__2026-08-05-belge-yolu-da`: 'collectShipmentDocContent hâlâ canlı okur — sevk anı garantisini freeze adımı verir' cümlesi geçersiz: belge üreticisi reissue + lazy-init ile sevkten SONRA da koşuyor; artık iptal edilmemiş RollReturn'ü prevSackId ile geri ekleyen BRÜT üretir.
>

> **NOT (2026-08-02 — sevk rakamı BRÜT'tür; iade onu geriye dönük değiştiremez):** Sevk edilmiş bir sevkiyatın metrajı **canlı çuval sorgusundan ÜRETİLMEZ**. Sebep saha vakası (SVK2007260001): sevkten 6 dk sonra 49 m'lik top iade alındı, `RollReturn` topun `sackId`'sini boşalttı ve aynı sevkiyat üç ekranda üç şey söyledi — PDF 501 m (donmuş belge), liste + muhasebe Excel'i 452 m (canlı). Muhasebe fişi aynı belge numarasıyla geçen ay 501, bugün 452 basıyordu. **Sektör standardı:** fatura sevk irsaliyesinden kesilir, iade AYRI belgeyle (iade irsaliyesi + iade faturası) kapanır; çıkış belgesi asla düzeltilmez. Uygulaması:
> • **`getDispatchReport` donmuş `PrintedDocument.snapshot`'tan okur** — fiş ile irsaliye tanım gereği BİREBİR. Donmuş belge yoksa (PLANNED) canlıya düşer ve `frozen:false` işaretlenir. Yanıt ayrıca `returns {count, meters}` taşır: **düşmek için değil, dipnot basmak için**. `collectShipmentDocContent` hâlâ canlı okur — "sevk anı" garantisini veren şey **freeze adımıdır**; yeni bir sevk-içeriği yüzeyi eklerken aynı kuralı uygula.
> • **Toplu muhasebe export'unda sevk satırları BRÜT** (`RollReturn`'den geri-ekleme; snapshot değil, çünkü 2000 sevkiyat × çeki satırı = perf kuralı 13 ihlali). Eskiden satırlar canlı=net idi **ve** ayrıca "İade" sayfası vardı → muhasebeci "sevk − iade" yapınca aynı metraj **iki kez** düşüyordu. Artık "sevk − iade = net" doğru. İki kümenin kapsamı bilinçli farklı: sevk satırları *dönemde sevk edilen*, iade satırları *dönemde iade alınan*.
> • **İade irsaliyesi (`RETURN_DISPATCH`) iade ANINDA donar** (tx içinde), iptalde `voidForSource` ile VOIDED'e çekilir. Eskiden yalnız biri ekranı açtığında lazy-init ile doğuyordu → hiç açılmayan iadenin resmi kaydı hiç oluşmuyordu.
> • **Ekranda sessizlik yok:** irsaliye diyaloğunda "sevk sonrası N top (M m) iade alınmıştır" bandı, Excel'de aynı bilgi dipnot olarak (rakamla aynı dosyada dursun diye — `SheetSpec.notes`), sevkiyat detayı → İadeler satırından iade irsaliyesine tıkla-git. Versiyon rozetindeki **"Güncel" = "en son versiyon, hiç revize edilmedi"** demektir, "içerik güncel" DEĞİL. Bekçi: `scripts/test_dispatch_report_gross.ts` (negatif sondayla kırmızı verdiği doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** "Sevkiyatlar (Muhasebe)" ekranı + `invoiceNo` fatura izi, muhasebecisi AYRI program kullanan kurulumun **dış muhasebe köprüsü**dür ve çekirdek sevkiyatın parçasıdır; `finance.enabled` açık kurulumda aynı ekran terfi eder ve çakışma `shipping.invoiceMode = dis|ic|ikisi` ile çözülür. `attachTotals`'ın BRÜT olması ve `dispatchedAt` union'ında iki tarafın alan adının farklı olması ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §6.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `A:2026-08-02__2026-08-02-brut-kurali-liste (2026-09-03 GÜNCELLEME paragrafı, arşiv satır 58) + R:2026-09-03 Dilim 2 (CLAUDE.md:106 `invoiceMode`)`: "ERP fatura KESMEZ" cümlesi artık yalnız finans modülü KAPALI kurulumda doğru. `finance.enabled` açıkken iç fatura ERP içinde kesilir (Invoice modeli, sevk sonrası taslak kancası) ve iç onay `invoiceNo`yu damgalar; elle iz ↔ iç fatura çakışması `shipping.invoiceMode` (dis|ic|ikisi) ile yönetilir. Kök dizin satırı 46 hâlâ niteliksiz.
> - KISMİ → `R:2026-09-03__2026-09-03-dilim-2-davranis`: 'ERP fatura KESMEZ' yalnız finance.enabled KAPALIYKEN doğru: finans açık kurulumda sevk sonrası taslak fatura ERP içinde doğar (maybeAutoDraftInvoiceAfterDispatch, üç dispatch yolunun ortak kancası); invoiceNo dış izi ile iç faturanın çakışması shipping.invoiceMode (dis|ic|ikisi) ile yönetilir.
>

> **NOT (2026-08-02 — brüt kuralı LİSTE yüzeyine de uzandı + muhasebe ekranı tamamlandı):** Yukarıdaki brüt kuralı fişi/irsaliyeyi/Excel'i kapsıyordu ama **liste** hâlâ canlıydı: `RollReturn` topun `shipmentId`'sini NULL'ladığı için (`return.service.ts:324-325`) `_count.rolls` NET okunuyordu — donmuş irsaliye "2 top" derken liste "1 top" diyordu (metrajda çözülen sorunun adet ikizi). Muhasebe ekranında metraj **hiç yoktu**; canlı toplanarak eklenseydi SVK2007260001 vakası bu kez listede doğardı.
> • **`listShipments.attachTotals`** metraj + top adedini BRÜT üretir: canlı + iptal edilmemiş `RollReturn` geri-eklemesi. Snapshot OKUNMAZ (perf kuralı 13) — `accounting-export.service.ts:255` de aynı tercihi yapmıştı. **Kg geri-ekleme İSTEMEZ** (iade `Sack.weightKg`'a dokunmaz). `attachBadges` ile aynı yerleşim: merge/slice sonrası, yalnız sayfadaki id'ler; DIRECT satırlar sorguya girmez (`DirectShipment.totalQty` denormalize). Bu **operasyon Sevkiyatlar ekranını da** brüte çeker — bilinçli; "N iade" rozeti (artık ortak `components/operations/ReturnsBadge`) farkı söyler.
> • **`dispatchedAt` ile sıralama açıldı** — `cursor.ts` `sortNullable` (nulls-last) + Prisma `nulls: "last"`. ⚠️ Union'ın iki tarafında **alan adı farklı** (`Shipment.dispatchedAt` ↔ `DirectShipment.shippedAt`): direct dalı için `orderBy` VE cursor `where`'i ayrı kurulur — aynı `cw` nesnesini paylaşmak DirectShipment'ta olmayan alana filtre yazmaktı. Muhasebe listesinin varsayılanı `dispatchedAt desc`.
> • **Fatura izi:** `Shipment`/`DirectShipment`'a `invoiceNo` + `invoicedAt` + `invoicedById`. **ERP fatura KESMEZ** — bu yalnız dış muhasebe programındaki belgenin izidir (tutar/KDV YOK; muhasebe yüzeyi miktar-odaklı). Yalnız `DISPATCHED` işaretlenir (atomik claim); `invoiceNo: null` işareti kaldırır **ve tarihi de temizler** (yarım durum yok). Yeni izin **`shipping:invoice`** — muhasebeciye `shipping:write` vermek onu sevkiyat iptal edebilir yapardı.
> ⚠️ **2026-09-03 GÜNCELLEME:** "ERP fatura KESMEZ" cümlesi **finans modülü kapalıyken** doğrudur. `finance.enabled` açık kurulumda sevk sonrası taslak fatura ERP'nin kendi içinde doğar (`shipping.service.ts` → `maybeAutoDraftInvoiceAfterDispatch` → `helpers/shipment-auto-draft.helper`) ve `Invoice.shipmentId` + `invoices_one_active_per_shipment` partial unique'i şemada HAZIRDIR; `invoiceNo` elle izi ile iç faturanın çakışması `shipping.invoiceMode` ile yönetilir — bkz. MODUL-BAYRAK-TASARIM §6 / karar #10.
> • Ekran ayrımı korunuyor: **Sevkiyatlar** (operasyon, tüm statüler, iptal) ve **Sevkiyatlar (Muhasebe)** (salt-okunur DISPATCHED + fiş + dönem Excel + fatura) ayrı kişilerce kullanılıyor; **izinle ayrılmadı** (sevkiyatçının da belgelere erişimi gerekiyor). Muhasebe ekranı filtreleri: müşteri · şube · yön · fatura · iade · tarih; üstte dönem bandı (`?withSummary=true` — bayrak yoksa aggregate koşmaz). Bekçiler: `scripts/test_shipment_list_gross.ts`, `test_shipment_invoice.ts`, `test_shipment_list_sort.ts` (üçü de negatif sondayla kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** Tek kaynak (`RollReturn`, snapshot DEĞİL) · tx'siz iki sorguda dedup · `totalKg` değişmez · "mobil istemci brütü elle kurmaz" — dördü de fabrikadan bağımsız; MODUL-BAYRAK-TASARIM §11.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-05__2026-08-05-belge-yolu-da`: 'Kapsam DIŞI: reissue + lazy-init yolları' açık maddesi kapatıldı (arşivde üstü çizili). sack-search / çuval etiketi yeniden basımının canlı sack.rolls okuması kapsam dışı KALIR.
>

> **NOT (2026-08-03 — brüt kuralı ÇUVAL İÇERİĞİ yüzeyine de uzandı; üçüncü ve son yüzey):** Yukarıdaki iki not fişi/irsaliyeyi/Excel'i ve listeyi kapsıyordu; **sevkiyat DETAYI** hâlâ canlıydı. Saha vakası SVK0308260001: sevk edildi, 4 top (212 m) iade alındı, detay ekranı iki çuvalı da **"Eşleşen top yok · 0 top"**, üst sayaçları **"Top 0 · Toplam Metraj 0 m"** gösterdi — aynı sevkiyatın irsaliyesi 4 top diyordu. Sebep aynı tek satır: iade `Roll.sackId` **VE** `shipmentId`'yi NULL'lar (`return.service.ts:322-325`); önceki düzeltmeler yalnız `shipmentId` tarafını telafi etmişti, **çuval kırılımı hiç telafi edilmemişti**.
> • **`getShipmentById` artık BRÜT** — `RollReturn`'den (`prevSackId`) çuval bazında geri-ekleme yapar. Kaynak **snapshot DEĞİL**: `attachTotals` ve `accounting-export` aynı kaynağı seçti; üçüncü bir kaynak üçüncü bir rakam demekti. Ayrıca `PrintedDocument.snapshot` bu iş için **yetersiz ve güvenilmez** — `cekiRows` kalite taşımıyor, eski snapshot'larda `width` yok, ve `reissue`/lazy-init yolları belgeyi **canlıdan** kurduğu için iadeden sonra doğan snapshot zaten NET olur. **Ek sorgu YOK** (`rollReturn.findMany` zaten koşuyordu, yalnız yukarı taşındı + select genişledi).
> • **İade satırı ÇUVALDA KALIR ve `returned` ile işaretlenir** (soluk satır + amber "İade" rozeti + tarih/sebep tooltip'i). Metraj **üstü çizili DEĞİL** — üstü çizgi "bu sayı geçersiz" der, oysa metraj brüt toplama dahildir ve irsaliyede durur. Satır **salt-okunur** (top zaten çuvalda değil). Ayrı "BU SEVKİYATTAN İADE EDİLENLER" kartı **aynen kalır** — sektör standardındaki ayrı iade defteri; çuvaldaki rozet onun yerine geçmez, **konumunu** söyler (ürün kararı, 2026-08-03).
> • **Üç tuzak, üçü de bekçide kilitli:** (1) `sacks[].rolls` ile `summary` AYRI toplanırsa çift sayım olur → tek `grossRolls` kaynağından türetilir; (2) `shipment.findUnique` ile iade sorgusu **ayrı sorgulardır (tx yok)** — arada bir iade commit olursa aynı top iki kez sayılır → canlı id kümesiyle **dedup**; (3) sentetik satır `sackId = prevSackId` **taşımalı**, yoksa `undefined == null` ile hem çuvalda hem "çuvalsız" kümesinde görünür. `status` alanına "iade" anlamı **YÜKLENMEZ** (o alan hayalet-top/`SACK_ABSENT` sözleşmesine ait).
> • **`totalKg` DEĞİŞMEZ** (iade `Sack.weightKg`'a dokunmaz → zaten brüt; geri-ekleme çift sayardı). **PLANNED sevkiyatta hiçbir şey değişmez** ve `if (DISPATCHED)` dalı da **EKLENMEDİ**: iade `roll.status=SHIPPED` istediği için PLANNED'da `RollReturn` doğamaz, sorgu doğal olarak boş döner. **İade iptali kendiliğinden toparlar** (`cancelledAt: null` süzgeci) — ek kod yok.
> • **Mobil ZORUNLU değişti:** `ShipmentDetailView` brüt rakamı istemcide elle kuruyordu (`rollCount + returnedCount`) → backend brütleşince **çift sayardı**. O satır kaldırıldı, yerine dipnot geldi. Mobil çuval kartı per-top satır basmadığı için işaret oraya **`sack.returnedCount`** ile konur ("N iade") — onsuz şişmiş rakam işaretsiz kalırdı. **Backend + Electron + APK aynı pencerede deploy edilmeli.**
> • **Kapsam DIŞI (bilinçli, ayrı iş):** `sack-search`/çuval etiketi yeniden basımı hâlâ canlı `sack.rolls` okuyor. ~~Ve daha öncelikli bir açık: `reissue` + lazy-init yolları…~~ → **2026-08-05'te KAPATILDI**, aşağıdaki nota bak. Bekçi: `scripts/test_shipment_detail_gross.ts` (33 kontrol; negatif sondayla 10 kontrolde kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** "Freeze tek koruma" varsayımının çürütülmesi ve "yeni sevk-içeriği yüzeyi eklerken sor: sevkten SONRA da koşar mı?" sorusu her kurulumda geçerlidir — MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-05 — BELGE YOLU da brütleşti; "canlı okuyor" ≠ "net üretiyor" ayrımı):** 2026-08-02/03 notları fişi, listeyi, Excel'i ve sevkiyat detayını brüte çekmişti; **belge ÜRETİCİSİ** (`shipping.service.collectShipmentDocContent`) hâlâ canlı okuyordu. "Freeze tek koruma" varsayımı YANLIŞTI: aynı üreticiyi **`reissue`** (gerekçeli revizyon) ve **lazy-init** (donmuş belgesi olmayan eski kayıt ilk açıldığında) sevkten SONRA da çağırır. Sonuç: iadeden sonra üretilen "donmuş" resmi belge **NET** doğuyordu (saha vakasının rakamlarıyla: 501 yerine 452). Ekran düzelmişti, kâğıt düzelmemişti.
> • Düzeltme, ekran tarafındakiyle **aynı kaynağı** kullanır: iptal edilmemiş `RollReturn` satırları `prevSackId` ile çuvallarına geri eklenir. Snapshot OKUNMAZ — `attachTotals`, `accounting-export` ve `getShipmentById` de `RollReturn`'ü seçti; dördüncü bir kaynak dördüncü bir rakam demekti.
> • **Diğer çağıranlarda NO-OP:** freeze sevk tx'inin İÇİNDE koşar (henüz iade yok), TASLAK önizleme PLANNED sevkiyat içindir ve iade `roll.status=SHIPPED` istediği için orada `RollReturn` doğamaz. Yani çalışan yollar bayt-bayt aynı kaldı.
> • **Üç tuzak, üçü de bekçide:** (1) çuval satırı + ürün özeti + çeki satırları **tek** `sacksGross` kaynağından türetilir (ayrı toplamak çift sayardı); (2) `shipment.findUnique` ile iade sorgusu **ayrı sorgulardır (tx yok)** → canlı id kümesiyle **dedup**; (3) **`totalKg` DEĞİŞMEZ** — iade `Sack.weightKg`'a dokunmaz, geri-ekleme kg'yi çift sayardı. `prevSackId` taşımayan eski iadeler (kolon 2026-06'da eklendi) **atlanır** — uydurma çuvala yazmaktansa eksik bırakılır.
> • Bekçi: `scripts/test_dispatch_report_gross.ts` **§2b** (34 kontrol; negatif sondayla 7 kontrolde kırmızı verdiği — ve tam olarak 452/1 top ürettiği — doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** "Kat 2 değerli, o yüzden index eklenmedi" ve kat kataloğunun içeriği (2-KAT/4-KAT/TUP) bu kurulumun ürün karakteristiğidir (`production.enabled`); **kanoniklik zorunluluğu** (ham değer filtrede sessizce 0 satır döndürür), **sebep audit'ten değil KOLONDAN okunur** ve **parti üç dalı (tek açık→bağla · çok→400 · hiç→null)** ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §5.2, §11.

> **NOT (2026-08-04 — topun KALICI alanları: kat + giriş sebebi; ve elle eklenen top artık PARTİLİ):** Elle top ekleme (Tambur "Düzelt → Manuel Top Ekle" + "Manuel Mod") sahada üç sessiz boşluk açıyordu; üçü de topun **kendi satırında** kapatıldı — migration `20260804210000_roll_fold_type_and_entry_reason`.
> • **`Roll.foldType` (VarChar 64) — kat topun KALICI özelliğidir.** Eskiden kat yalnız `WorkOrderStep.stepData` ve `RollOperation.metadata` JSON'larında yaşıyordu: indekslenemez, filtrelenemez, raporlanamaz. Kat **MİRAS ALINMAZ** — kesimde doğan çocuk ebeveyninin katını körlemesine devralmaz, **o kesimde SEÇİLEN** değer yazılır (kullanıcı kararı: *"o top kesilerek yeni bir kat değeri kazanabilir"*). Alan hiç GÖNDERİLMEZSE (eski APK) parent → iş emri planı sırası uygulanır; bu **miras değil**, sözleşme boşluğunun doldurulmasıdır — ikisi karıştırılırsa asıl kural sessizce bozulur. Beş yazma yolu: `cutOpenFabric` çocuğu · `cutWarehouseRoll` kesim çocuğu · yeniden-kesim artığı · `finalizeOpenFabric` çocuğu · elle giriş. **Kanoniklik ZORUNLU** (`normalizeFoldType`, kanonik "4-KAT"; TÜP/özel değer aynen geçer): `buildWhereClause` tanımadığı filtre anahtarını **HAM geçirir**, yani DB'de "4-KAT" varken istemci "4 kat" ararsa sorgu **0 satır döner ve hata/log ÇIKMAZ** — operatör "bu kumaştan hiç yok" sanır. Index **bilinçli EKLENMEDİ**: `rolls` zaten 18 index taşıyor, kat 2 değerli ve her zaman `status` ile birlikte süzülüyor.
> • **`Roll.entryReason` (VarChar 500) — sebep audit'ten DEĞİL kolondan okunur.** Sebep önce yalnız `SystemLog`'a yazılıyordu; `archive-scheduler` **6 ayda bir** (`MONTHS_TO_KEEP=6`) satırları `system_log_archives`'e **TAŞIR** → altı ay sonra "bu top nereden geldi" sorusunun cevabı sessizce kaybolurdu. Sektör standardı da budur: kaydın *kendi* satırındaki gerekçe alanı (SAP `MSEG-SGTXT`) denetim log'undan ayrıdır — audit *kim ne zaman değiştirdi* sorusuna bakar, gerekçe *verinin bir parçasıdır*. Audit yazımı **kaldırılmadı** (iki soru ayrı); okuma kolonu tercih eder, kolon boşsa eski kayıtlar için audit'e düşer. Geri doldurma: `scripts/backfill_roll_fold_and_reason.ts` (**dry-run varsayılan**, `--apply` öncesi her kaydı listeler).
> • **Nullable kolon eklemek PG11+'ta metadata-only'dir** — tablo yeniden yazılmaz (ölçüldü: dolu `rolls` üzerinde 6 ms; dev PG18, saha PG16.9). "Canlı tabloya kolon eklemek pahalı" sezgisi **DEFAULT'lu** kolonlar içindir; ikisi karıştırılıp kolon yerine JSON seçilmemeli.
> • **Elle eklenen top artık PARTİSİZ doğmaz.** Parti izlenebilirliğin birimidir ("üretime aynı anda giren top grubu") ve etki kümesini o tanımlar; ayrıca Electron iş emri detayı topları partiye göre grupladığı için partisiz top **PARTİSİZ kutusuna** düşüp mobil listede hiç görünmüyordu → operatör topu ekliyor, bulamıyor, **tekrar** ekliyordu. Sektör standardı (SAP "batch determination"): parti yönetimli malzemede sistem partiyi sessizce boş bırakamaz — ya türetir ya sorar. Üç dal: **tek açık parti → SORMADAN bağla** · **birden fazla → 400 `BATCH_REQUIRED` + seçenek listesi** · **hiç yok → NULL meşru**. "Açık" tanımı listeye değil **veriye** dayanır (partide canlı top var mı) ve ölü kümesi **tek kaynaktan** gelir: `K18_DEAD_STATUSES`. ⚠️ **`SCRAP` partiyi KAPATMAZ** — fire *gerçek bir karardır*, mal vardı ve üretildi; K18'e SCRAP eklemek burayı düzeltirken onlarca liste/lane filtresini de değiştirirdi (bekçi bu ayrımı kilitler). Seçenek listesi **her zaman reddeden tarafın ağzından** gelir: mobil partileri önden yüklemez, "gönder → sorulursa cevapla" akışını izler; aksi halde ekranda görünen parti backend'ce kapanmış sayılıp reddedilirdi. Parti kararı yanıtta **geri söylenir** (`batchId`/`batchNumber` + mesaj) — sessiz doğru cevap ≠ görünmez cevap. Audit `batchSource` (`OPERATOR`/`AUTO_SINGLE`/`NONE`) ile kararın sahibini yazar.
> • **SIRA sözleşmesi:** payload'ın KENDİ tutarlılığı (ürün/renk) **önce**, bağlam çözümü (parti) **sonra**. Parti kontrolü öne alınsaydı yanlış ürün gönderen istemci `ITEM_MISMATCH` yerine `BATCH_REQUIRED` alır, partiyi seçer, sonra asıl hatasını **iki tur sonra** öğrenirdi.
> • **Ürün/renk/en operatöre SORULMAZ** — iş emrinden gelir ve değiştirilemez (`ITEM_MISMATCH`/`COLOR_MISMATCH` hard guard). En de miras alınır: iş emrinin eni sabittir, tekrar sordurmak hem sürtünme hem çelişki riskidir. Kalite Tambur kararında belirlenir.
> • **Sebep artık HAZIR KATALOĞDAN seçilir** (`mobil/src/constants/manualReasons.ts`, iki ekran ORTAK). Serbest yazım kaldırılmadı, "Diğer"in altına alındı: eldivenli operatör vardiya ortasında `"aaa"` / `"."` gibi doldurmalar üretiyordu ve o, **boş bırakmaktan daha kötüdür** (denetimde cevap varmış gibi görünür, hiçbir şey söylemez). Kategori aynı zamanda veriyi **sayılabilir** yapar. ⚠️ Sahada sürekli "Diğer" seçiliyorsa **katalog yanlıştır**; gerçek serbest metinlere bakıp seçenekleri güncelle, listeyi büyütme.
> • Bekçiler: `scripts/test_roll_fold_and_reason.ts` · `scripts/test_tambur_manual_batch.ts` (ikisi de negatif sondayla kırmızı verdiği doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** "Renkte `hasDefaultCategory` DE aranır, yoksa Tambur adımına renk yazılır" cümlesi, boya işini yalnız FASON firmanın yaptığı bu kurulumun topolojisinden doğar; iç boyahaneli kurulumda kural `stepCanApplyColor` üzerinden aynı kalır ama "kategorisiz istasyon = renk veremez" varsayımı geçersizdir. "Hedef ÖNERİDİR, kilit değil" · "istemci sözleşmesi DÜZ ID dizisi" · "istasyon değişince hedef sıfırlanır" ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §5.1/§5.2.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: Rota adımının renk yeteneği bileşik `hasDefaultCategory && canApplyColor` koşulundan tek yüklem `stepCanApplyColor(station, stepCat)`'a indi; 'yoksa Tambur adımına renk yazılır' fallback'i o bileşiğin ürünüydü, kalktı. Notun diğer kuralları (öneri≠kilit, son renk veren adım kazanır, düz ID dizisi, istasyon değişince sıfırlama) canlı.
> - KISMİ → `R:2026-08-10__2026-08-10-11-uretim-karakteristigi`: Renk yeteneği bileşik koşulu (`hasDefaultCategory && canApplyColor`) kalktı; yetenek `Station.appliesColor` alanına taşındı, tek yüklem `stepCanApplyColor(station, stepCat)`. 08-06 kök satırındaki 'renkte hasDefaultCategory DE aranır (yoksa Tambur adımına renk yazılır)' cümlesi bayat.
>

> **NOT (2026-08-06 — ROTA ŞABLONU artık HEDEF de saklar: adım başına renk + özellik):** Saha sorusu: *"rota oluştururken boyahane ekleyince orada alabileceği özellikleri göremiyorum ve seçemiyorum; bu kayıtlı rota kolay seçim işime yarayacak."* Yetenek chip'leri **vardı ama yanlış ekrandaydı**: iş emri formunun rota editörü (`RouteStepDetail`) onları çiziyordu, Tanımlar → Üretim Rotaları ekranındaki editör (`RouteStepEditor`) ise istasyon + not + fason firmadan ibaretti. Üstelik chip'lerde yapılan seçim **iş emrine** yazılıyordu, rotaya değil — yani şablon renk/özellik TAŞIMIYORDU. Migration `20260806000818_route_step_targets` (`RouteStep.plannedColorId` + `RouteStepProperty` pivotu; ikisi de nullable/yeni tablo → metadata-only).
> • **HEDEF BİR ÖNERİDİR, kilit DEĞİL.** Rota iş emrine uygulanınca istemci hedef alanları ön-doldurur, operatör değiştirebilir. `WorkOrder.targetColorId`/`WorkOrderTargetProperty` ile karıştırma: orası üretimin gerçek hedefi (sipariş kalemi kilitleyebilir), burası şablon varsayılanı. Adım tüketilirken hiçbir yere kopyalanmaz — kopyalayan tek yer istemcinin "rotayı uygula" adımıdır (`useDesignerSteps.seedFromRoute` → `WorkOrderFormView.applyRouteTarget`; mobil `useQuickWorkOrder.chooseRoute`). **Sipariş bağlı iş emrinde renge DOKUNULMAZ** — orada renk siparişin şartıdır.
> • **Çeviri kuralı: adım başına ↔ düz.** Rota hedefi adım bazında saklanır, iş emri hedefi tek/düzdür. Rotadan iş emrine: renk için **SON renk veren adım kazanır** (yeniden boyama varsa nihai renk odur), özellikler **birleşir**. İş emrinden rotaya ("Rotayı Kaydet"): `deriveStepTargets` düz hedefi adımlara **istasyon yeteneğiyle süzerek** dağıtır — ekranda chip'leri kapsayan kuralın aynısı, ayrı yazılırsa kaydedilen şablon backend'e takılır (400) ya da daha kötüsü hiçbir istasyonun uygulayamayacağı bir hedef taşır.
> • ⚠️ **RENKTE `hasDefaultCategory` DE ARANIR** (`route.service.applyStepTargets`). `deriveCapabilityFlags` kategorisiz istasyonda `canApplyColor: true` üretir — bu "bilinmiyor → serbest" demektir, "renk uygular" değil. Yalnız `canApplyColor`'a bakmak **Tambur adımına renk yazılmasına** izin verirdi. Panel, rota kapsama uyarısı ve mobil `routeApplyCaps` de bileşik koşulu kullanır. Özellik ise gerçek proses kısıtıdır → istasyonun `StationProperty` listesiyle sınırlıdır (renk kısıtı istasyon listesinden OKUNMAZ — 2026-08-02 kuralı, tüm katalog gösterilir).
> • ⚠️ **İstemci sözleşmesi DÜZ ID DİZİSİDİR** (`plannedPropertyIds`), ham Prisma nested write DEĞİL. `RouteService.ALLOWED_STEP_KEYS` `plannedProperties`'i **reddeder**; çeviriyi servis yapar. "İstemci zaten nested yazsın" diye gevşetmek, generic CRUD üzerinden ilişki manipülasyonunu kapatan F209 seddini (`connect`/`deleteMany` dahil) yeniden açardı.
> • ⚠️ **İstasyon değişince adımın hedefi SIFIRLANIR** (panel). Eski istasyonun özelliği yenisinde geçersizdir ve sessizce taşınırsa hata "Kaydet"e basınca, hiç dokunulmamış bir alandan gelirdi. Adım güncellemesi `deleteMany` + `create` olduğu için pivot satırları **CASCADE** ile düşer (aksi halde her kayıtta FK ihlali).
> • **Hedefsiz rota yolu bayt-bayt korunur:** hedef yoksa ek sorgu koşmaz, pivot satırı doğurmaz, `routeStepsToCreatePayload` alanları hiç göndermez. Reçetenin KENDİ rotası da hedefsiz kalır — hedef zaten `ProductRecipe`'te saklanıyor, ikinci kopya yaratmak iki kaynak demekti.
> • **Migration + backend + Electron aynı pencerede; APK ZORUNLU DEĞİL** (eski APK yeni alanları görmez → ön-doldurma olmaz, davranış bugünküyle aynı). Bekçi: `scripts/test_route_step_targets.ts` (20 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — `hasDefaultCategory` düşünce 1, allowlist gevşeyince 1, özellik yetenek kümesi körleşince 1; üçü de ayrıca "yarım kayıt bırakmaz" kontrolünü düşürdü).

> ⚠️ **PROFİL GERÇEĞİ:** Bu notun tamamı `production.enabled` altındaki **kurşun + KK2 tek fiziksel istasyon** (`StationKind.PROCESS_QC`) topolojisini varsayar — kaliteyi ayrı istasyonda yapan fabrikada ekran, rejim anahtarı ve "sonraki adım TAMBUR olmalı" şartı yeniden değerlendirilir (Faz B). Taşınabilir olan kısım: **tek kapı / tek yüklem** disiplini (`assertKursunTabletMayWrite`) ve "toplu sonuç PARÇALI, atlanan satır sebebiyle döner" kuralı — bkz. MODUL-BAYRAK-TASARIM §5.1, UYGULAMA-PLANI "Faz B" (R3).
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-09-02/03 — Modül anahtarları P1 + R:2026-09-03 Panel modül kapıları P5 (küme dışı)`: 'Karo bayraktan BAĞIMSIZ, yalnız izinle süzülür' artık yalnız REJİM bayrağı (`production.kursunBypassEnabled`) için doğru: karoya MODÜL kapısı eklendi (`visibleWhen: isKursunPlanningVisible` → `production.enabled`), backend ikizi `router.use(verifyToken, requireProductionEnabled)`.
> - KISMİ → `R:2026-08-06__2026-08-06-dagitim-on-kosul`: Rejim kilidi (tablet bayrak açıkken salt-okunur) KALDI ama fiilen ürettiği 'dağıtım yapılmadan iş ilerlemez' ön koşulu kalktı: Tambur okutması dağıtılmamış kurşun adımını da kapatır (`resolveUnassignedTamburClosure`), atama satırı gerekmez.
>

> **NOT (2026-08-05 — KURŞUN PLANLAMA: iki ekran birleşti + bayrak artık REJİM anahtarı):** Saha sorusu: *"bypass açıkken operasyon menüsünde hem Kurşun Sırası hem Kurşun Dağıtım görünüyor, normal mi?"* Normaldi (2026-08-02 kuralı: *sırası* `!flag || tabletRegimeCount>0`, *dağıtım* `flag || pendingAssignmentCount>0` — ikisi de "işi kaldıysa dur"), ama **kuralın kendisi yanlıştı**: iki ekran AYNI iş emirlerini gösteriyordu ve planlamacı aynı işi iki menüde arıyordu.
> • **TEK EKRAN: "Kurşun Planlama"** (`/operations/kursun-dagitim`; `kursun-queue` route'u ona YÖNLENDİRİLİR — kayıtlı sekme/adres boşa düşmesin). Birleştirmenin dayanağı veri: `distribution` payload'ındaki **`waiting` listesi kuyruğun ta kendisi** ve `listQueue` ile **AYNI `orderBy`**'ı taşıyor (acil → urgentMarkedAt → priority → startedAt). İki bölüm üst üste: **Kurşun Sırası (bekleyen)** — sürükle-sırala + acil + [bayrak açıksa] makine seçici/Ata — ve **Makinelerde** (yalnız satır varsa çizilir). `KursunQueue/` klasörü, `KursunQueueRouteGate`, iki `visibleWhen` yüklemi ve `useKursunVisibility` **silindi**.
> • **KARO BAYRAKTAN BAĞIMSIZ** (Electron **ve** mobil): yalnız izinle süzülür (`quality:write` | `workorder:distribute`; mobilde `mobile:kursun-dagitim`). Bayrak artık **görünürlük** değil **REJİM** anahtarıdır. `GET /kursun-bypass/visibility` ucu **duruyor ama hiçbir yeni istemci çağırmıyor** — sahadaki ESKİ APK'lar onu hâlâ yokluyor, silmek deploy penceresinde 404 üretirdi.
> • **Sıralama izni GENİŞLEDİ:** `PATCH /kursun-qc/queue/reorder` artık `quality:write` **|** `workorder:distribute` **|** `mobile:kursun-dagitim` (eskiden yalnız ilki). Eski dar gerekçe "priority TABLET akışının sırasıdır, dağıtımcının sıralayacak şeyi yok" idi; birleşik ekranda bekleyen liste ile dağıtım listesi AYNI liste olduğu için düştü.
> • **SIRALAMA İKİ YERDE: bekleyen kuyruk VE makine İÇİ.** İkisi de aynı ucu ve aynı alanı (`WorkOrderStep.priority`) kullanır; çakışma yok çünkü bir adım aynı anda ya bekleyendir ya bir makinededir ya da tablet `open-cards`'ındadır — **üçü birbirini dışlar** ve yeniden numaralama yalnız kendi kümesine dokunur. ⚠️ Makine içi sıra `listDistribution`'da **JS ile** sıralanır (`sortByPlanOrder`), `orderBy` ile DEĞİL: kaynak atama satırı (`assignedAt asc` yüklenir), sıralama anahtarları ise adımdadır. Bu satır düşerse sürükleme priority'yi yazar, DB doğru olur ve **EKRAN HİÇ DEĞİŞMEZ** — hata yok, log yok; sahadan gelen tek belirti "sürüklüyorum, geri zıplıyor" olur. Son eşitlik bozucu `waiting`'de `startedAt`, `assigned`'da `assignedAt`'tir. **Her makine grubunun KENDİ `DndContext`'i vardır** — satırın makineler arası sürüklenmesi yapısal olarak imkânsız; makine değiştirmek bir yeniden ATAMA'dır (kaldır → tekrar ata) ve kazara sürüklemeyle yapılmamalıdır. Bekçi: `scripts/test_kursun_machine_order.ts` (12 kontrol; sıralama satırı kaldırılınca **4 kontrolde kırmızı** verdiği doğrulandı).
> • **YERLEŞİM = SEKME: havuz + makine başına bir sekme.** Önce iki bölüm üst üsteydi; makine sayısı arttıkça sayfa uzuyor ve **toplu seçim iki makineye birden taşabiliyordu**. Sekme bunu YAPISAL olarak çözer — ekranda tek liste vardır, "seçtiklerim nereye ait" sorusu doğmaz. Kaybedilen "hangi makine ne kadar dolu" görünürlüğü **sekme şeridine** taşındı (her sekmede iş adedi + metraj + bayat rozeti); sekmeye geçmeden yükü görmek dağıtım kararının ön koşuludur. ⚠️ Sekmeler **makine listesinden** doğar, dağıtılmış satırlardan DEĞİL: işi olmayan makinenin de sekmesi vardır ("boş mu, sekmesi mi yok?" sorusu operatörü durdurur ve boş makine tam da iş verilecek yerdir). Pasifleşmiş ama üstünde açık iş kalan makine için de sekme üretilir (`(pasif)` etiketiyle) — yoksa o işlere ulaşılamaz, havuza döndürülemezlerdi. Bekçi: `machine-tabs.test.ts`.
> • **TOPLU İŞLEM: `POST /kursun-bypass/assign-bulk` + `cancel-bulk`** (ikisi de `workorder:distribute`, en fazla 100 satır). Havuzdan toplu dağıtım ile makineler arası toplu TAŞIMA **aynı uçtur** — `assign` yeniden-atamayı taşıma olarak ele alıyor. **Seçim kimliği her yerde `workOrderStepId`** (`selection.ts`): havuzda ve makinede satırın tek benzersiz anahtarı odur; uçlara giden `workOrderId`/`assignmentId` seçili satırlardan TÜRETİLİR. Seçim sekme değişince TEMİZLENİR, ayrıca paneller `visibleSelection` ile ekrandaki satırlarla kesiştirir (ikinci hat).
> • ⚠️ **TOPLU SONUÇ PARÇALIDIR ve bu BİLİNÇLİDİR.** Tek transaction DEĞİL: (a) `assign` iş emri satırını kilitler, 50 satırı tek tx'te tutmak perf kuralı 10 ihlali + deadlock riskidir; (b) hepsi-ya-hiç yanlış semantiktir — listedeki bir iş bu arada uygunluğunu yitirdiyse diğerlerinin dağıtımını geri almak planlamacının niyetine aykırıdır (dağıtım zaten geri alınabilir). Karşılığında **atlanan her satır somut sebebiyle döner** (`failed[]`) ve arayüz onu uyarı toast'ında gösterir; havuz çubuğu ayrıca **seçim anında** "N tanesi dağıtıma uygun değil, atlanacak" der. *"42 atandı"* deyip 8'inin neden atlandığını yutmak en kötü davranıştır. Bekçi: `scripts/test_kursun_bulk.ts` (28 kontrol; satır hatası fırlatacak şekilde "hepsi-ya-hiç"e çevrilince kırmızı verdiği doğrulandı).
> • **Ekran deneme verisi:** `scripts/demo_kursun_planlama.ts` (`--apply` / `--cleanup`, varsayılan kuru anlatım). `DEMO-KRS-*` iş emirleri üretir — 5 bekleyen (biri acil) + 4 dağıtılmış (biri tek başına, üçü aynı makinede ki makine içi sıralama denenebilsin). **Canlı fabrika DB'sinde koşturulmaz.**
> • **KURŞUN TABLETİ BAYRAK AÇIKKEN SALT-OKUNUR** — ama **"her adım" DEĞİL, "dağıtıma UYGUN adım"**. Kör bir bayrak kilidi **ÇIKMAZ** üretirdi: kurşundan sonra **Tambur GELMEYEN** rotada (kurşun → zımpara → tambur) bypass kapanışını yapacak istasyon yoktur, yani iş ne tablette işlenebilir ne dağıtılabilirdi — hata yok, log yok, mal istasyonda kalır. Uygunluk kuralı zaten tam olarak *"bu adımı bypass rejimi taşıyabilir mi"* sorusunu yanıtlıyor; kilidi ona bağlamak tek tutarlı yanıttır.
> • **Tek kapı `helpers/kursun-bypass-eligibility.assertKursunTabletMayWrite`** — eski `assertStepNotBypassAssigned`'ın YERİNE geçti ve BEŞ tablet yazma yolunu da kapsar (KK2 tamamlama · hata kaydı · tablet adım kapatma · açık kumaş açma · kurşun bitirme). Üç dal: dağıtılmış → 409 (**ATAMA mesajı**, makine adıyla — daha somut olan önce sorulur) · bayrak açık + uygun → 409 (rejim mesajı) · aksi → serbest. **Bayrak kapalıyken maliyet tek ek sorgudur** (ayar okuması); uygunluk yüklemesi yalnız rejim açıkken koşar. Guard **UI'ya güvenmez ve güvenemez**: tablet offline kuyruk taşır, bayrak çevrildikten sonra flush edilen istek ekranı hiç görmeden gelir.
> • **Uygunluk kuralı artık TEK KAYNAK** (`resolveBypassBlockReason` + `loadBypassEligibilitySignals`): `listDistribution` toplu, tablet tekil çağırır. Kopyalansaydı ekran "Ata" derken tablet de yazabilir (ya da tersi) duruma düşerdi. `RouteStepRef`/`nextNonSkippedStep` de oraya taşındı.
> • **Mobil ZORUNLU değişti:** `KursunStepSummary.tabletReadOnly` (+ `bypassAssignment`) eklendi ve KursunQc ekranı kart açılınca yazma yüzeyini hiç çizmeyip mavi bilgi paneli basıyor. Alan eskiden **hiç okunmuyordu** — operatör dağıtılmış kartı okutup her butonda ham 409 yiyordu. Salt-okunur kararı ile guard **aynı fonksiyondan** beslenir. **Backend + Electron + APK aynı pencerede deploy edilmeli** (eski APK alanı görmez → yazmaya çalışır → 409).
> • **`listOpenCards` filtresi GENİŞLETİLMEDİ** (bilinçli): uygunluk hesabı rota + üç iz sorgusu ister, o uç ise tablet tarafından **5 saniyede bir** yoklanıyor; ayrıca uygun OLMAYAN adımlar listede KALMALI. Eski "sessiz 409" derdi kaynağında (bilgi paneliyle) çözüldü.
> • Bekçi: `scripts/test_kursun_regime_lock.ts` (21 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — rejim kilidi kaldırılınca 7, uygunluk süzgeci kaldırılınca (kör kilit) 2, salt-okunur bandı null'lanınca 2). `test_kursun_bypass.ts` 148/148 korundu.

> ⚠️ **PROFİL GERÇEĞİ:** "Tambur kilometre taşıdır" ve "bayrak AÇIK + adım bypass'a UYGUN" kapsamı bu kurulumun kurşun/tambur rotasına aittir (`production.enabled`); Tambur'suz rotalı fabrikada kilometre taşını rota belirler. Taşınabilir çekirdek: **milestone confirmation deseni**, "makine atfı UYDURULMAZ (`machineId=null` + görünür bant)" ve marker ön ek uyumu — bkz. MODUL-BAYRAK-TASARIM §5.1.

> **NOT (2026-08-06 — DAĞITIM ARTIK İŞİN ÖN KOŞULU DEĞİL: Tambur okutması kurşunu dağıtımsız da kapatır):** Saha sorusu: *"tambur kartı kurşundaki bir kartı okuttuğunda, henüz kurşun dağıtılmamış bile olsa kurşun tamamlandı sayılabilir; dağıtım çok önemli bir işlem değil, personel unutabiliyor."* Ölçüldü ve **gerçek bir KİLİTLENME** çıktı: bayrak açık + kurşun adımı dağıtılmamış olduğunda Tambur okutması `400 "Bu iş emrinin Tambur adımında şu an açık top yok… Tabletinizi yanlış istasyonda okutmuş olabilirsiniz"` veriyor, kurşun tableti ise rejim kilidi yüzünden salt-okunur (`"Kurşun dağıtımı açık — tablette işlem yapılmaz"`). **İki taraf da kapalı**; tek çıkış planlamacının dağıtım yapmasıydı ve mal o sırada Tambur'un önünde bekliyordu. Mesaj ayrıca **yanıltıcıydı** — operatör doğru istasyondaydı.
> • **Sektör karşılığı *milestone confirmation*** (SAP PP *Meilenstein-Rückmeldung*): kilometre taşı operasyonu onaylandığında öncesindeki onaylanmamış operasyonlar otomatik onaylanır. Tambur burada kilometre taşıdır. **Mekanizmanın tamamı zaten vardı** (`bypassPending` → sessiz kapanış → kart açılır); eksik olan tek şey mekanizmanın `KursunBypassAssignment` **satırına bağlı** olmasıydı. **Yeni kavram, yeni izin, yeni ekran, migration YOK.**
> • **Dağıtım artık MAKİNE ATFI için bir planlama kolaylığıdır**, işin ilerlemesinin ön koşulu değil. `findPendingForTambur` atama yoksa **SANAL bekleyen** üretir (`source: "UNASSIGNED"`), `completeFromTambur` ikinci dalıyla kapatır.
> • ⚠️ **KAPSAM: "her dağıtılmamış adım" DEĞİL — "bayrak AÇIK **ve** adım bypass'a UYGUN".** Tek kapı `resolveUnassignedTamburClosure`; yüklem kurşun tabletini kilitleyen `assertKursunTabletMayWrite` ile **AYNI kaynaktan** (`resolveBypassBlockReason` + `nextNonSkippedStep`) beslenir — ayrışsalardı "tablet yazamıyor ama Tambur da kapatamıyor" çıkmazı geri gelirdi. **Bayrak koşulu load-bearing:** kapalıyken kurşun tableti normal dijital akışta çalışıyor ve onu sessizce atlamak KK2 kalite verisini hiç girilmemiş bırakırdı. Okuma yolu (önizleme) ile yazma yolu (tx içi tazeleme) aynı fonksiyonu çağırır.
> • ⚠️ **MAKİNE ATFI UYDURULMAZ: `RollMovement.machineId = null`.** Varsayılan bir makineye yazmak makine bazlı hacim raporunu **sistematik olarak** yanlışlardı; boşluk dürüsttür. Bedeli bilinçli — o iş makine raporunda görünmez — ve **görünür kılınır**: `listDistribution.unassignedClosures` + Kurşun Planlama ekranındaki amber bant ("son 7 günde N iş dağıtılmadan kapandı"). Sayacın kaynağı **movement marker'ıdır, `SystemLog` DEĞİL** (`archive-scheduler` audit'i 6 ayda bir taşır — `Roll.entryReason` emsali). Yetenekler adımın **KENDİ** istasyonundan kopyalanır (tek PROCESS_QC istasyonu → atanmış yolla aynı satır).
> • ⚠️ **Marker `KURSUN_BYPASS_FINISHED:UNASSIGNED:<uuid>` — BASE ön ekle BAŞLAMAK ZORUNDA.** `hasBypassClosureOnProcessQcTx` (inventory) ve `loadBypassEligibilitySignals.closedNonBypass` bu satırları `startsWith(KURSUN_BYPASS_MARKER_PREFIX)` ile tanıyor; uyum koparsa çok-partili işin **İKİNCİ turu** "bypass dışı kapanmış hareket var" diye uygunluğunu kaybeder ve iş yeniden çıkmaza düşer (bekçide kilitli).
> • **Atomik claim EKLENMEDİ ve gerekmiyor:** atama satırı yok, claim'in işini `closeBypassMovementsTx`'in `exitedAt IS NULL` guard'ı + kapsam paritesi görüyor (3 paralel okutmadan yalnız biri kapatıyor — ölçüldü). İdempotent tekrarın izi de marker'dır (`findCompletedUnassignedClosure`) — o dal olmadan offline replay 404 alır ve operatör kendi bitirdiği işi "yok" diye görürdü.
> • ⚠️ **`completeUnassignedFromTambur`'un tx İÇİ tazelemesine BEKÇİ ERİŞEMEZ** — tek iş parçacıklı testte tx dışı ön kontrol her zaman önce reddediyor (körleştirilince test yeşil kalıyor, ölçüldü). Orası derinlik savunmasıdır; silmeden önce yerine ne koyduğunu bil. Testin ölçtüğü eşzamanlılık özelliği ayrıdır (N paralel okutma → 1 kapanış).
> • **Hata mesajı da düzeltildi:** 400 artık *"yanlış istasyonda okutmuş olabilirsiniz"* demiyor, somut sebebi söylüyor (`explainTamburScanBlock`). Zenginleştirme **yalnız gerçekten fırlatılacak dalda** koşar — `bypassPending` dolu olduğunda hata zaten yutuluyor ve sebep sorgusu bypass rejiminin EN SIK yolunda boşa koşardı.
> • **Migration YOK · izin YOK · APK ZORUNLU DEĞİL** (eski istemci yalnız `bypassPending.rolls` okuyor → yeni backend'le doğru çalışır; kaybedilen tek şey bilgi toast'ının ayrıntısı). **Backend + Electron aynı pencerede.** Bekçi: `scripts/test_kursun_unassigned_close.ts` (53 kontrol; **dört negatif sondayla** kırmızı verdiği doğrulandı — bayrak koşulu düşünce 4, marker ön ek uyumu kopunca 1, atıf uydurulunca 1; tx içi tazeleme sondası **yeşil kaldı ve bu bilinçli olarak yukarıda yazıldı**). `test_kursun_bypass.ts` 148/148 · `test_kursun_regime_lock.ts` 21/21 · `test_kursun_bulk.ts` 28/28 · `test_kursun_machine_order.ts` 12/12 korundu.

> ⚠️ **PROFİL GERÇEĞİ:** Tambur ekranı, "Son Çıkan Toplar" ve `mobile:tambur-duzelt` izni `production.enabled` yüzeyleridir; **`qtyOut=0` storno ≠ `qtyOut=qtyIn` dispozisyon**, "iptal edilen `clientToken` REPLAY EDİLEMEZ (409)", "barkod topun KİMLİĞİdir, koruma STATÜDEDİR" ve "alan eklemek yetmez, hangi YANITTA döndüğünü doğrula" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-12__2026-08-12-giris-izlenebilirligi-kim`: 'İstasyon' (currentStationId) filtresi 2026-08-05'te base liste şeridine eklendi; 2026-08-12'de base listeden ÇIKARILDI — yalnız Üretimde/Kurşun Bekleyen/Tambur Bekleyen sekmelerinde çizilir (Ham Stok/Depo'da top istasyonda durmaz, filtre daima boş liste döndürüp 'bozuk' görünüyordu).
> - KISMİ → `kök dizin 2026-08-25 ②b 'İptal ettim, arşivde göremedim' (kümede değil)`: Arşiv sekmesi DÖRT emekli statüden ALTIya çıktı (CANCELLED + SCRAP eklendi), sayfaya ARAMA + 'Kayıt Türü' daraltması (`statusIn`) geldi; konum (Sistem → Top Arşivi) ve admin:settings kapısı değişmedi.
> - KISMİ → `R:2026-08-25__2026-08-25-saha-deploy-sonrasi`: Top Arşivi statü kümesi DÖRT tüketilmiş statüden ALTIya çıktı (CANCELLED + SCRAP eklendi) + sayfaya arama + 'Kayıt Türü' (statusIn). 'Sistem → Top Arşivi, admin:settings' kararı ve STATUS_GROUPS.ARCHIVE anahtarı duruyor.
>

> **NOT (2026-08-05 — elle eklenen topu GERİ ALMA + topun izlenebilirlik yüzeyleri):** Saha yedi madde bildirdi; ikisi soruydu, beşi eksik. Çıkan ortak desen: *arka uç doğru, yüzey yok ya da yanlış yere bağlı.*
> • **GERİ ALMA — ikinci bir iptal motoru YAZILMADI.** Doğru semantik zaten `InventoryService.softDelete`'te yaşıyordu: `CANCELLED` + açık hareket **`qtyOut = 0`** ile kapanır ("mal bu istasyondan HİÇ geçmedi" = sektördeki *storno*). Bu, `rescueStuckRoll`/WO-kapanış dispozisyonunun **`qtyOut = qtyIn`** semantiğinden BİLİNÇLİ olarak farklıdır — orada mal gerçekten vardı ve çıktı, burada kayıt baştan hatalıydı; ikisi karıştırılırsa hiç var olmamış metraj istasyon iş hacmine yazılır. `TamburUndoService`'e **`MANUAL`** modu eklendi ve o motoru ÇAĞIRIR. Operatörün butonu zaten doğru yerdeydi ("Son Çıkan Toplar" satırındaki Geri Al) ve elle eklenen topta **görünüyor ama 400 veriyordu** — yani operatör "Geri Al" yazan modalda çıkmaza giriyordu. Yeni ekran/izin kodu doğmadı; undo route'ları `mobile:tambur-duzelt`'i de kabul ediyor (**karar: ekleyen kendisi geri alır** — yaratma ve iptal izinleri ayrı kümelerde kalsaydı hata yapan kişi vardiya ortasında birini beklerdi).
> • **Kapsam DAR ve blockReason ÇIKMAZ BIRAKMAZ:** yalnız elle eklenmiş + **hiç işlem görmemiş** top (kesilmemiş · `RollOperation` yok · tek hareket · çuval/sevkiyat yok). İhlalde mesaj *"süpervizöre başvurun"* der; sessiz 409, yanlış işlem yaptırmaktan sonra en kötüsüdür. Parti bağı iptalde **topta KALIR** (`softDelete` `batchId`'ye dokunmaz) — "hangi partiye yanlış top yazılmıştı" izi.
> • **`softDelete` artık hareket notunu EZMİYOR.** Eskiden `notes` körlemesine `"CANCELLED"` yazılıyordu ve elle eklemenin `TAMBUR_MANUAL_ROLL: <sebep>` izi siliniyordu; `entryReason` + audit kalsa da hareket geçmişi "bu top neden vardı" sorusunu cevaplayamaz oluyordu — tam da iptal edilmiş bir kaydı incelerken en gereken bilgi. Artık `CANCELLED (<eski not>)`.
> • **İptal edilmiş topun `clientToken`'ı REPLAY EDİLEMEZ** (409 `ENTRY_CANCELLED`). `produceFinishedRoll`'da bu dal yoktu: token tekrar gönderilince uç **`success: true` + iptal edilmiş topun barkodunu** dönüyordu — operatör "eklendi" görür, envanterde top YOKTUR. 409'dan kötüdür çünkü **sessizce yanlış** bir cevaptır. Mantıksal deneme iptalle KAPANIR; yeni top yeni token ister.
> • **BARKOD ERKEN DOĞMUYOR — sorun değil (soru cevaplandı).** Bu sistemde barkod "bitmiş ürün işareti" değil topun **kimliği**dir ve doğduğu an verilir; KK1 ham girişi de aynısını yapar (üstelik etiketi de bastırır, önünde tüm üretim varken). Erken barkodun sanılan riskleri (yanlışlıkla çuvala okutma / sevke girme) kodun her yerinde barkodun varlığıyla değil **STATÜ** ile kapatılmıştır (`IN_PRODUCTION` ∈ `NON_SACKABLE_STATUSES`). Barkod anlamını değiştirmeye kalkma; bu kural buraya yazıldı ki soru üçüncü kez sorulmasın.
> • **"Ekleme Nedeni" hiç çalışmamıştı** (regresyon DEĞİL): panel alanı **liste satırından** (`roll`) okuyordu, oysa `manualReason` **yalnız detay ucunda** döner. Özellik yazıldı, test edildi, commit edildi ve kullanıcıya **hiç ulaşmadı**. Ayrıca audit fallback'i `findFirst(orderBy: asc)` ile **en eski CREATE'i** seçiyordu — elle ekleme iki audit kaydı doğurur ve sebep İKİNCİDEDİR, yani fallback pratikte ölüydü. Ve kodun kendi yorumları üç dosyada *"şemada kolon değil, audit'ten okunur"* diyordu; **yanlış** (kolon `Roll.entryReason`, migration `20260804210000`). Ders: alanı eklemek yetmez, **hangi yanıtta döndüğünü** doğrula.
> • **"Kat" başlığı sıralanabilir görünüyordu ama `ROLL_SORTABLE_FIELDS`'te YOKTU** → tıklayınca sıralama olmuyor **ve** `query-parser` bilinmeyen alanı fallback'e düşürdüğü için sekmenin `updatedAt desc` varsayılanı sessizce `createdAt`'e kayıyordu ("Buraya geliş ≠ oluşturma" kuralının ihlali). `foldType` listeye eklendi. **İlişki üzerinden sıralama desteklenmiyor** — yeni "İstasyon" kolonuna bilerek `SortableHeader` KONMADI.
> • **Kat iki uçta da Zod'da YOKTU:** mobil "Manuel Mod" katı operatöre ZORUNLU soruyor ve gönderiyordu, `z.object` tanımadığı anahtarı **sessizce siliyordu** — operatör zorunlu alanı dolduruyor, veri hiçbir yere ulaşmıyordu. İki şemaya `foldTypeSchema` eklendi (kanonikleştirmeyi `.transform` kendisi yapar) ve "Manuel Top Ekle" de artık **kat soruyor** (kullanıcı kararı) — varsayılan ön seçim YOK, çünkü yanlış kat değeri boş değerden zararlıdır.
> • **Yeni izin `roll:history`** — top detayındaki **yaşam döngüsü** bölümü. Bölüm eskiden `RollOperation` okuyordu; o tablo bir yaşam döngüsü günlüğü DEĞİL, **istasyon işlem log'u**dur (5 enum + `workOrderStepId` NOT NULL) → depo/ham stok/elle eklenen/kesim-çocuğu toplarda **tanım gereği kalıcı boş** (ölçüm: 72 topun 45'i). Doğru veriyi üreten `GET /rolls/:id/history` **zaten vardı** ve mobil onu kullanıyordu; Electron hiç çağırmıyordu. **İzin yoksa bölüm HİÇ ÇİZİLMEZ** (boş kutu = "geçmiş yok" yalanı). ⚠️ Boot uzlaştırması izni DB'ye getirir ama **kullanıcılara atama elle yapılır**.
> • **İstasyon görünürlüğü:** liste yanıtı `currentStep → station` taşımıyordu, yani "Üretimde" sekmesinde kolon **yazılamazdı**. `ROLL_LIST_INCLUDE` + `findRollById` aynı şekli döner (ayrışırsa satır ile panel aynı top için farklı şey söyler). Filtre **istasyon KİMLİĞİ** (`currentStationId`) — mevcut `currentStepKind` TÜR sorar ve iki boyahaneyi tek seçenekte birleştirir; ikisi birlikte gelirse koşullar **birleştirilir**, üstüne yazılmaz.
> • **Arşiv → Sistem → Top Arşivi** (`/system/roll-archive`, `admin:settings`). Sekme **silinmedi taşındı**: o dört emekli statünün Electron'daki TEK liste yüzeyiydi ve bir kısmı barkodsuz olduğu için okutmayla da bulunamazdı — "zor bulunsun" ile "erişilemesin" farklı şeyler. `STATUS_GROUPS.ARCHIVE` anahtarı **duruyor** (yeni sayfa onu kullanır; silinirse tek kaynak kaybolur). ⚠️ Yan etki bilinçli: eskiden `roll:read` ile bakabilen depo/üretim personeli artık bakamaz.
> ⚠️ **2026-08-25'te GÜNCELLENDİ:** Arşiv artık DÖRT değil ALTI statü taşır — `CANCELLED` ve `SCRAP` eklendi (`Electron/src/pages/Operations/Rolls/service.ts`, `STATUS_GROUPS.ARCHIVE`); gerekçe ve sayfa araması için aşağıdaki 2026-08-25 ②b notuna bak.
> • Bekçi: `scripts/test_manual_roll_undo.ts` (24 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — not koruması kaldırılınca 1, MANUAL dalı kapatılınca çökerek exit 1, `ENTRY_CANCELLED` guard'ı kaldırılınca 2).

> ✅ **ÇEKİRDEK:** Giriş MOTORU (Roll doğuran servis + guard'lar) kapatılamaz çekirdektir — advisory kilit sırası, `clientEnteredAt` penceresi, `shouldReleaseInFlight` ve "5xx ulaşılamıyor DEĞİLDİR" her kurulumda geçerli. ⚠️ Değişebilen tek şey SUNUM: "KK1 istasyon ekranı" `production.enabled` altındadır, toptancı profilinde aynı motorun üstüne sade "Mal Girişi" ekranı gelir — bkz. MODUL-BAYRAK-TASARIM §4 karar #2, §12 kural 4.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-12__2026-08-12-kayit-kuyrugu-kaldirildi`: Kalıcı düşüşün VARIŞ NOKTASI değişti: 08-05'te MutationCache köprüsü kalıcı 'ölü mektup kutusuna' (failedOps + OutboxModal + retryFailedOp) yazıyordu; kutu SİLİNDİ, yerine anlık toast (announceFailure) geçti. Köprünün kendisi (MutationCache.onError) DURUYOR — setMutationDefaults'a taşınamaz kuralı da aynen geçerli.
>

> **NOT (2026-08-05 — KK1 mükerrer top koruması TAMAMLANDI: guard atomik + pencere OPERATÖRÜN saatiyle + "sunucu ölü" artık çevrimdışı):** 2026-08-03 vakası (sunucu restart → etiket çıkmadı → operatör defalarca bastı → N kopya) için kurulan iki hat **sahada çürütüldü**: tablette wifi kapatılıp aynı top peş peşe girildi, bağlantı gelince 46 ms içinde 5 kayıt yazıldı ve **bayrak AÇIK olmasına rağmen** hiçbiri 409 almadı. İki kök neden, ikisi de kapatıldı — migration `20260805090000_roll_client_entered_at`.
> • **Tuzak ATOMİK DEĞİLDİ (TOCTOU).** İkiz sorgusu tx DIŞINDA ve kilitsizdi (`prisma.roll.findFirst`), insert ayrı `$transaction`'daydı; mobil kuyruk ise bekleyenleri `Promise.all` ile **paralel** boşaltıyor ve KK1 mutation'ı `scope` taşımıyor → 5 sorgu da hiçbirinin commit'ini görmeden geçti. Commit'ler 7-17 ms arayla sıralıydı (barkod sayacı satır kilidi): **tx'ler sıralandı, guard sorguları sıralanmadı.** Artık sorgu tx içinde ve tx'in **İLK ifadesi** `pg_advisory_xact_lock(8021, hashtext(anahtar))`. ⚠️ **SIRA LOAD-BEARING**: kilit `findFirst`'ten ÖNCE (sonra alınırsa hiçbir şey kazanılmaz) ve `generateRollBarcode`'dan da ÖNCE (ters sıra ABBA deadlock + global sayaç kilidini guard boyunca tutmak). 2-argümanlı form bilinçli — 1-arg uzayı `session-registry`/`permission-management` ile paylaşılıyor ve KK1 anahtarı binlerce değer üretiyor. Saf parçalar `services/helpers/duplicate-guard.helper.ts`'te (kilit anahtarı Decimal'leri **DB hassasiyetine yuvarlar**; yuvarlamazsa `140.0001` ile `140.0004` ayrı kilit alır ve yarış tam da düzeltilen yerde açık kalır).
> • **Pencere SUNUCU saatiyle ölçülüyordu.** Offline kuyruk tek flush'ta boşaldığı için her kaydın `createdAt`'i milisaniyelerle ayrılır → **her flush DAİMA 90 sn penceresinin içindedir**. Guard atomik yapılsaydı bu kez tekstilde olağan olan "aynı partiden eşit metrajlı arka arkaya toplar" 409 fırtınası üretecekti. Yeni `Roll.clientEnteredAt` (nullable timestamptz) operatörün **bastığı anı** taşır; pencere iki yönlüdür (tek yönlü `gte` ile saati ileri kaymış cihazın satırları sonsuza dek ikiz görünürdü). Saat kayması ihmal edilebilir: guard zaten `createdById` **VE** `createdMachineId` eşitliği arıyor → iki damga **aynı cihazın aynı saatinden** gelir, sabit ofset farkta sadeleşir. Makul aralık dışı beyan (−36 sa / +5 dk) **saklanmaz** ve sunucu saatine düşülür — kolon doluysa "bu damgaya güvenildi" demektir. **400 DÖNMEZ**: bozuk RTC'li tablet üretimi durdurmamalı. **Index EKLENMEDİ** — çıpa `createdAt`'te kaldı (`duplicateGuardCreatedAtFloor`, sağlamlık ispatı orada); `rolls` zaten en çok indeksli tablo.
> • **İstemci: uçuş penceresi.** Yapışkan token yalnız `onError` sonrası kuruluyordu, o da `stationRetry` (4 deneme, ~5-47 sn) tükenince → kısa pm2 restart'ında her basış TAZE token alıyordu. Kural artık: **uçuşta AYNI yük → uçuştaki KİMLİĞİ (token + damga) yeniden kullan; FARKLI yük → yeni top.** Körü körüne collapse etmek 47 sn'lik pencerede sıradaki GERÇEK topu düşürürdü (eksik stok, kopyadan kötü). Parmak izi backend'in kimlik alanlarıdır; **kalite bilerek dışarıda** (iki basış arasında kalite düzeltilirse aynı top ikinci kez yazılırdı). Pencere `INFLIGHT_REUSE_WINDOW_MS = 90_000` — **backend penceresiyle bilerek AYNI**, iki katman aynı şeyi söylesin.
> • **B6 — "wifi var, sunucu ölü" artık ÇEVRİMDIŞI** (`offline/serverReachability.ts`). Eski tanım (`NetInfo.isConnected`) uygulamanın "online"ını *ağ linki var* diye kuruyordu; sunucu ölüyken istekler HTTP'ye çıkıp düşüyor, kuyruk hiç devreye girmiyordu. Sinyal artık **link AND erişilebilirlik**. Kanıt tabanlı: sağlıklı durumda ek istek YOK; hüküm gerçek bir isteğin **YANITSIZ** düşmesiyle verilir (`api.ts` interceptor'ı bildirir) ve ancak o zaman jitter'lı `/health` yoklaması başlar. ⚠️ **5xx "ulaşılamıyor" DEĞİLDİR** — sunucu cevap vermiştir; aksi hâlde tek bir hatalı uç tüm kuyruğu durdururdu.
>   - ⚠️⚠️ **B6 TEK BAŞINA YAPILSAYDI SAHA VAKASINI KUYRUK ÜZERİNDEN GERİ GETİRİRDİ**: sunucu ölüyken her panik basışı ayrı kayıt olarak kuyruğa girer, sunucu dönünce N kopya olarak akardı. Ayrım `shouldReleaseInFlight(reason)` ile **saf katmanda** yaşar (ekrandaki bir `if`'te kalsaydı tersine çevrilmesi hiçbir testi kırmazdı): **`'link'` → uçuş kimliğini BIRAK** (operatör çevrimdışı olduğunu biliyor, basışlar ayrı toplardır) · **`'server'` → KORU** (kesinti yeni fark ediliyor, basışlar panik olabilir). Koruma 90 sn ile sınırlı — 20 dakikalık kesintide sıradaki gerçek top yutulmaz.
> • **UI artık YALAN SÖYLEMİYOR.** `onMutate` koşulsuz yeşil "Top kaydedildi" basıyordu — operatörü tam da tekrar basmaya davet eden şey buydu. Online'da nötr "Kaydediliyor… bekle, tekrar basma"; yeşil `onSuccess`'e taşındı ve yalnız operatörün BEKLEDİĞİ deneme onaylanınca basılır. Kalıcı düşen kayıt ekrandan bağımsız bir `MutationCache` köprüsüyle yakalanır; bu delik `WORK_SESSION_REQUIRED` 409'unu da yutuyordu. ⚠️ Köprü `setMutationDefaults`'a **KONULAMAZ** — component `onError` onu EZER (query-core option sırası), kayıt "bazen" yakalanırdı. ⚠️ **KÖPRÜNÜN VARIŞ NOKTASI 2026-08-12'de DEĞİŞTİ**: kalıcı bir "ölü mektup kutusu" (`failedOps` + `OutboxModal`) yerine artık **anlık toast** (`offline/announceFailure.ts`) — bkz. aşağıdaki NOT. Buton **rengi sonucu söyler**: amber = yeni stok kaydı doğurur · marka = tekrar dener · mavi = yalnız kâğıt basar · kırmızı = kaydı yok eder.
> • **Bayrak panelden AÇILAMIYORDU** (`kk1DuplicateGuardEnabled` `feature-flag.routes.ts` `strictObject`'inde yoktu → PATCH 400). Asıl tehlike açamamak değil **KAPATAMAMAK**tı: yanlış pozitif dalgasında tek geri dönüş yolu odur. Üç-yer sözleşmesi artık mekanik (`scripts/test_feature_flag_contract.ts` — dört anahtar kümesi + körlük zemini + muaf bayatlığı); eski testler bayrağı servisten set ettiği için route'u hiç geçmiyordu, hata tam o boşluktan geçti.
> • Bekçiler (hepsi negatif sondayla kırmızı verdiği doğrulandı): `scripts/test_kk1_duplicate_guard.ts` (24 kontrol — 5 eşzamanlı birebir giriş → **1 geçer + 4×409**; kilit silinince 3 geçiyor) · `scripts/test_feature_flag_contract.ts` · mobil `entryAttempt` · `serverReachability` · `mutations` (kutu kaldırılınca `failedOps`/`OutboxModal` bekçileri `announceFailure` + `SyncStatusChip`'e devredildi). ⚠️ `test_kk1_duplicate_guard`'daki `Promise.allSettled` **MEŞRU** (perf kuralı 11 tek tx client'ı paylaşmaya ilişkindir; burada beş ayrı tx var) — "düzeltip" sıralı hale getirirsen bekçi sessizce ölür.

> ⚠️ **PROFİL GERÇEĞİ:** "ÖLÇEK TETİĞİ" maddesindeki rakamlar (87 giriş/30 gün, tek ham giriş istasyonu) bu fabrikanın hacmidir — başka kurulumda eşik ilk günden aşılabilir, o yüzden tetik kuralını (500+ giriş/gün ya da 4+ eşzamanlı istasyon → `pg_locks` ölçümü) kuruluma göre YENİDEN ölç. `readIdCondition`'sız elle id okuma → P2007, `kk1.historyAllEntriesEnabled` dört kapı ve `forcedCreatorFilter`'ın SAF katmanda olması ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-12 — GİRİŞ İZLENEBİLİRLİĞİ: "kim, nereden girdi" + kişiye özel listeler):** Ölçekleme sorusu ("yeni ham giriş istasyonları gelebilir, hangi personelin hangi kumaşı girdiği bulunmak istenir") üzerine kuruldu. **Veri modeli zaten hazırdı** (`createdById`/`createdMachineId`/`entryStationId` kolonlu + indeksli, `ROLL_LIST_INCLUDE` üçünü de taşıyor); eksik olan yalnız YÜZEYdi. ⚠️ **Elektron'daki mevcut iki filtreyle TEKRAR DEĞİL:** "İstasyon" = `currentStationId` (top ŞU AN nerede), "Giriş Kaynağı" = `entrySource` (girişin TÜRÜ); yeni eklenenler `createdById` (KİM) ve `entryStationId` (kalıcı köken — NEREDEN). Dördü farklı soru.
> • **İki hafif lookup ucu: `GET /rolls/entry-users` + `/rolls/entry-stations`** (`roll:read | MOBILE_ROLL_READ`) — kataloğu değil GERÇEK veriyi döner (top girmiş kullanıcı/istasyon; `groupBy` indeksli tekil kolonda). Gerekçe: kullanıcı listesi `admin:users` arkasında ve Rolls sayfası kullanıcılarının çoğunda o izin yok; ad zaten roll:read'in gördüğü satırlarda basılıyor — yeni bilgi sızmaz. ⚠️ Route'lar `/:id`'den ÖNCE (`/stats` emsali).
> • **Filtreler backend'de SIFIR işle çalıştı:** `createdById`/`entryStationId` generic `buildWhereClause` yolundan geçer (CSV→`in` otomatik). Bekçi `test_filter_multi_select` **§2b** bunu KİLİTLER: biri ileride bu anahtarları `buildRollWhere`'de elle okumaya başlar ve `readIdCondition`'ı atlarsa CSV uuid kolonuna ham gider (P2007). Canlı ölçüm: 100→2 satır, CSV 3 satır, lookup'lar 6 kullanıcı/1 istasyon döndü.
> • **Electron:** Rolls filtre şeridine "Ekleyen" + "Giriş İstasyonu" (multi-lookup, kaynak yeni uçlar) ve listeye "Giriş İstasyonu" kolonu (izlenebilirlik standardı gereği **varsayılan GİZLİ**, `initialVisibility`). ⚠️ `FilterBar` lookup varyantlarının `service` tipi `Pick<CrudService,"getAll">`e DARALTILDI — FilterBar yalnız onu çağırır; hafif lookup servisleri tam CrudService stub'u yazmak zorunda kalmaz. ⚠️ **Electron servis yolları TAM yazılır (`"/api/rolls/..."`)** — `apiClient.baseURL` `/api` İÇERMEZ (`createCrudService("/api/stations")` emsali); öneksiz yol 404 alır ve FilterBar hatayı yutup **"Sonuç yok."** gösterir (sahada yakalandı — filtre "boş" değil, istek yanlış kapıya gidiyordu). ⚠️ **"İstasyon" (currentStationId) filtresi base listeden çıkarıldı, yalnız Üretimde/Kurşun Bekleyen/Tambur Bekleyen sekmelerinde eklenir:** Ham Stok/Bitmiş Depo'daki toplar hiçbir istasyonda DURMAZ (currentStep yok) → filtre o sekmelerde daima boş liste döndürüp "bozuk" görünüyordu (2026-08-12 saha bulgusu). "Nereden girdi" sorusunun cevabı Giriş İstasyonu filtresidir.
> • **Yeni bayrak `kk1.historyAllEntriesEnabled` (varsayılan KAPALI) — dört kapı tam:** system-setting (SETTING_KEYS+interface+builder+update+read helper) · feature-flag.routes · Electron featureFlagService+settings-config ("KK1 / Kalite") · mobil featureFlag.service+useFeatureFlags. Bekçi `test_feature_flag_contract` 15/15.
> • **Mobil kapsam kuralları (saha kararı):** sağdaki **"Son Kayıtlar" HER ZAMAN kişiye özeldir** (`filter[createdById]=ben`, bayraktan bağımsız); **"Tüm Girişler"** bayrak KAPALIYKEN yalnız kendi kayıtları (başlıkta "· yalnız senin girişlerin" yazar — dar listeye bakan operatör "kayıtlar silinmiş" sanmasın) ve **Personel çipi HİÇ ÇİZİLMEZ** (ölü filtre "bastım, olmadı" üretir), AÇIKKEN herkes + Personel çipi. ⚠️ Zorlama **saf katmanda**: `rollHistoryFilter.forcedCreatorFilter` — ekrandaki bir `if`te yaşasaydı tersine çevrilmesi hiçbir testi kırmazdı; KK1 bunu filters'a **EN SON** yayar (çipten sızabilecek createdById'yi de ezer). Kimlik yüklenmemişse filtre üretilmez — boş string listeyi sessizce boşaltırdı. Bu bir YETKİ DUVARI DEĞİL ekran sadeleştirmesi (panel aynı veriyi görür); bayrak yüklenemezse DAR kapsama düşülür.
> • **Giriş istasyonu görünürlüğü:** mobil satırda operatör çipinin altına istasyon adı (veri varsa; 2026-08-05 öncesi toplar taşımaz → tek satır). "Giriş İstasyonu" filtre çipi mobilde **yalnız 2+ istasyon varken** belirir — tek istasyonda ayırt edeceği şey yok, seçenek listesi veriden geldiği için ikinci istasyon açıldığı gün kendiliğinden doğar.
> • **"Bu oturum" kovası artık İSTASYON KİMLİĞİ taşır** (`sessionBucketKey(kind, stationId)`): ikinci ham giriş istasyonu açıldığında iki istasyonun oturum listeleri karışmaz; stationId yokken tür tek başına (bugünkü davranışla birebir). Store persist edilmediği için göç yok.
> • **ÖLÇEK TETİĞİ (E, yazılı karar):** barkod sayacı advisory-lock ile serileşiyor ve tüm istasyonlar aynı günlük sayacı paylaşıyor — bugünkü hacimde (87 giriş/30 gün) sorun değil. **Günde 500+ giriş YA DA 4+ eşzamanlı ham giriş istasyonu** görüldüğünde kilit bekleme süresi ölçülmeli (`pg_locks` + giriş ucu latency'si) ve `/rolls` liste sorgusu EXPLAIN'lenmeli; o güne kadar ölçüm ekleme.
> • **Deploy: backend + Electron + APK aynı pencerede.** Migration YOK, yeni izin YOK. Eski APK + yeni backend zararsız (bayrağı görmez, eski davranış); yeni APK + eski backend → lookup 404 (çip seçeneksiz) + Son Kayıtlar filtresiz — kabul edilemez. Bekçiler: `test_filter_multi_select` 37/37 (§2b) · `test_feature_flag_contract` 15/15 · mobil `rollHistoryFilter.test` (+7, kapsam kuralı körleştirilince kırmızı verdiği doğrulandı) · `sessionEntriesStore.test` (+2). Tablette uçtan uca doğrulandı: bayrak kapalı → "yalnız senin girişlerin" + çip yok; bayrak açık → 36→47 kayıt + Personel çipi süzüyor (Eda→0).

> ⚠️ **PROFİL GERÇEĞİ:** "KK1 ve Tambur ekranları" `production.enabled` yüzeyleridir; toptancı/dokuma profilinde aynı bileşen başka ekran çiftine bağlanır. Taşınabilir çekirdek: **süzme SUNUCUDA** (cursor'lu listede istemci süzmesi yanlış "kayıt yok" üretir), `dateField` gönderilmezse aralık SESSİZCE yok sayılır, `last7` bugünü içerir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-12 — TOP LİSTESİ FİLTRESİ: zaman + kumaş, KK1 ile Tambur ORTAK):** Saha isteği: *"tüm girişler modalında zamana ve kumaşa göre arama yapabilelim, kısa tuşlar da olsun, sade UI, filtre backend'den gelsin."* İki modal da kapsandı (kullanıcı kararı): **KK1 → "Tüm Girişler"** (hiç filtresi yoktu) ve **Tambur → "Son Çıkan Toplar"** (arama vardı, tarih/kumaş yoktu).
> • **TEK BİLEŞEN, İKİ EKRAN:** `components/filters/RollFilterBar.tsx` (şerit) + `DateRangeSheet.tsx` (takvim) + **saf katman `rollHistoryFilter.ts`** (kısa yol → aralık çevirimi, sorgu parametresi üretimi, query anahtarı). Ayrı yazılsalardı "aynı düğme iki listede farklı aralık" kaçınılmazdı. Şerit: `Tümü · Bugün · Dün · Son 7 gün · Tarih seç · Kumaş (+ Temizle)`.
> • ⚠️ **SÜZME SUNUCUDA, İSTEMCİDE DEĞİL.** Listeler cursor'lu sonsuz kaydırma: istemcide süzmek yalnız O ANKİ SAYFAYI süzer ve operatör "kayıt yok" sanar — oysa kayıt bir sonraki sayfadadır. Doğrulandı: kumaş seçilince toplam sayaç da düşüyor (33 → 11).
> • ⚠️ **`dateField` GÖNDERİLMEK ZORUNDA.** `applyDateRange` alan adı yoksa aralığı **sessizce yok sayar** (`if (!params.dateField || !allowed.includes(...)) return`) — filtre seçili görünür, liste süzülmez. Bekçide kilitli.
> • **Backend zaten hazırdı, tek eksik kumaştı:** `/rolls` (KK1) `filter[itemId]` + `dateField/dateFrom/dateTo` destekliyordu; `/tambur/recent-output-rolls` tarihi destekliyor ama **`itemId` YOKTU** → eklendi (Zod `.uuid()` ile; ham CSV/serbest metin P2007 → 400 üretirdi). Yeni migration/izin YOK.
> • ⚠️ **YENİ PAKET EKLENMEDİ** — tarih seçici kütüphanesi yok ve eklemek riskli (`expo-audio` peer'ı bir kez `expo-asset`i köke çekip APK'yı açılışta çökertmişti). Takvim ızgarası elle yazıldı, sıfır bağımlılık.
> • **Sözleşme ayrıntıları:** `last7` **BUGÜNÜ İÇERİR** (bugün girilen topu düşürmek filtreyi "bozuk" gösterir) · özel aralık kısa yolu **EZER** (iki aralık aynı anda iddia edilmez) · query anahtarı `itemLabel`den ve `now`dan **bağımsızdır** (ad düzeltmesi ya da her render yeniden çekmesin) · gün sınırı **cihazın yerel günü**dür ve backend onu mutlak an olarak alır (Electron `useReportDateRange` ile aynı sözleşme) · **filtre yoksa tek parametre üretilmez** (mevcut istek bayt bayt korunur) · Tambur'da modal kapanınca filtre **sıfırlanır** (dün "Bugün" seçip kapatan operatör ertesi gün boş liste bulmasın).
> • **GÖRSEL (aynı gün, saha geri bildirimi):** ① **Seçici çipleri ayrıştı** — "Tarih seç" / "Kumaş Seç" beyaz zemin + kalın koyu kenarlık + sağda **▾** taşır; kısa yollar (Bugün/Dün/…) eski açık-gri hâlinde kaldı. Gerekçe: biri tek dokunuşta SONUÇ verir, diğeri bir EKRAN AÇAR; aynı görünürlerse operatör "bastım, bir şey olmadı" der. Aktif hâl ikisinde de dolu mavi (filtre uygulanıyor mesajı türden bağımsız). ② **Liste satırının kırpılan gölgesi:** satır `Surface elevation={1}` ile çiziliyordu; Android'de elevation gölgeyi kartın DIŞINA taşırır ve satır tam genişlikte olduğu için gölgenin sol/sağ ucu liste sınırında kesiliyor, ekranda "yarıda kesilmiş çerçeve" olarak görünüyordu. `elevation={0}` + **kenarlık** (`borderWidth:1 #e2e8f0`) + listeye 2px yatay nefes payı. Kenarlık kırpılmaz ve kartın sınırını daha net gösterir — yeni bir liste kartı yazarken gölge yerine kenarlık tercih et.
> • **AŞIM KESİMİ 0'DA TIKANIYORDU (2026-08-12 saha vakası, düzeltildi):** 500 m kayıtlı kumaş fiziksel 550 m çıkabilir ve fazlalık TEK kesimde bitmeyebilir (50 m → 3 top). `tambur.overQuantityEnabled` açıkken İLK aşım kesimi kalanı 0'a çekiyor; iki aşım dalının claim'i `currentQty: { gt: 0 }` şartı taşıdığı için 0'a inmiş topta İKİNCİ kesim **P2025'e düşüp "bu sırada değişti" YARIŞ mesajı** basıyordu — oysa yarış yok, mal fiziksel elde. Şart iki daldan da (cutOpenFabric + cutWarehouseRoll) kaldırıldı: **çifte-harcama koruması 0'ın altında anlamsızdır** (inilecek gerçek stok yok); her sıfır-üstü kesim çocuk + **sapma defteri** satırı üretir (iz kaybolmaz), KK2-reopen/statü/çuval guard'ları AYNEN durur. Normal dalın `gte` guard'ına DOKUNULMADI. Bekçi: `test_tambur_over_quantity` 10→13 (0'da 2. ve 3. kesim + her birinin sapma satırı; `gt:0` geri konunca 409'la çöktüğü doğrulandı). Backend-only — APK gerekmez.
> • **TAMBUR "SON ÇIKAN" FİLTRELERİ (2026-08-12 akşam, saha isteği):** Liste TÜM makinelerin kesimlerini gösterir (varsayılan bilinçli korundu) + üç yeni süzgeç: **"Bu makine"** tek-dokunuş tuşu (oturumun makinesi; makinesiz oturumda çizilmez) · **Personel** çipi (entry-users lookup'ı, 2+ seçenek varsa) · şerit hizası arama kutusuyla eşitlendi (searchRow'un 12px iç boşluğu şeride de verildi — `RollFilterBar` artık `style` ve `extraChips` prop'ları alıyor; ekran-özel tuşlar ayrı satır açmadan şeride girer). Backend: `recent-output-rolls`e `createdMachineId` + `createdById` (Zod `.uuid()`).
> • ⚠️ **KESİM ÇOCUKLARI MAKİNE DAMGASI ALMIYORDU** (bulgu filtreyi denerken çıktı): dört TAMBUR_SPLIT doğum yolu `createdById` yazıyor ama `createdMachineId` YAZMIYORDU → "Bu makine" süzgeci kesimleri hiç göremiyor, yalnız TAMBUR_MANUEL kayıtları buluyordu. Dördü de damgalandı (cutWarehouseRoll · finalizeWarehouseCut · cutOpenFabric · finalizeOpenFabric — sonuncusu zaten `machineId` parametresi alıyordu, yalnız doğuma yazılmıyordu; controller'lar `stamp?.machineId ?? req.device?.machineId` geçirir). **Eski kesimler geriye doldurulmadı** (emsal: entryStationId kararı) — süzgeçte görünmezler, bu dürüst. Bekçi: `test_tambur_cut_idempotency` +1 kontrol (damga) · `test_tambur_recent_output_filter` +2 (makine/personel süzgeci).
> • **YAN DÜZELTME — MANUEL GİRİŞTE NUMPAD ÖLÜ KALIYORDU (aynı gün, saha isteği):** `NumpadHost` `disabled = !target` ile çalışıyor ve KK1'de **metraj alanı hedefi hiç almıyordu** (`autoActivate` yalnız EN'de vardı) → manuel giriş açıkken tuşlar GRİ ve tıklanamaz; operatör önce metraj kutusuna dokunmak zorundaydı. EN girişi bayrakla kapalıysa ekranda hedef alacak başka alan da yok, yani numpad **tamamen** ölüydü. Düzeltme: metraj `autoActivate={!compact && manualMode}`, EN `autoActivate={!compact && !manualMode}`. ⚠️ **İkisini birden `autoActivate` yapma** — kazananı MOUNT SIRASI belirlerdi (EN sonra mount olduğu için o kazanır) ve operatör metraj beklerken tuşlar sessizce EN'i değiştirirdi. Ayrıca hedef bir şekilde boşalırsa (bugün `closeTarget`ı kimse çağırmıyor; tek satırlık bir değişiklik bunu bozabilir) manuel modda metraja **geri dönen** bir effect var — numpad bir daha ölü kalmasın. Tablette doğrulandı: kutuya hiç dokunmadan tuşlara basıldı, metraj yazdı; desen seçici açılıp kapandıktan sonra da yazmaya devam etti.
> • Bekçiler: mobil `rollHistoryFilter.test.ts` (16 kontrol) · backend `test_tambur_recent_output_filter.ts` (7 → 10; kumaş filtresi körleştirilince **2 kırmızı** verdiği doğrulandı). Backend ayrıca canlı veriyle sondalandı (filtresiz 24 → kumaşla 13, hepsi doğru kumaş). **Migration YOK · izin YOK; backend + APK aynı pencerede** (eski backend + yeni APK = Tambur'da kumaş filtresi sessizce yok sayılır).

> ⚠️ **PROFİL GERÇEĞİ:** "Kat" alanı ve Tambur kesim yolu `production.enabled`/`kumasTeknik.enabled` bağlamıdır; **"gövdeyi elle kuran her katman sessiz bir allowlist'tir"** (Zod dersinin istemci ikizi), "etikete katalog KODU basılır, ad değil" ve `present:false` sözleşmesi ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-13 — KESİMDE KAT SESSİZCE DÜŞÜYORDU: mutationFn gövdesi alanı geçirmiyordu):** Saha: *"kat sayısı 6 yaptım ve kaydettim, Electron'da göremedim."* Teşhis üç katmandı ve ikisi tuzaktı: ① Electron tarafı SAĞLAMDI (Kat kolonu listede varsayılan görünür + detay paneli basar) — görünmeyen şey hiç YAZILMAMIŞ değerdi; ② backend SAĞLAMDI (servis + HTTP uçtan uca `TUP`/`2-KAT` yazdı, canlı ölçüldü); ③ asıl hata MOBİLDE: `cutOpenFabricMutation.mutationFn` istek gövdesini ELLE kurarken `foldType`'ı geçirmiyordu — ekran gönderiyor (satır ~1647), tipin alanı var (~1074), gövde düşürüyor (~1082). **2026-08-05 "Zod sessizce siliyordu" dersinin istemci-tarafı ikizi: gövdeyi elle kuran her katman, tıpkı `z.object` gibi, sessiz bir allowlist'tir.** Tanı yöntemi de kayda değer: aynı isteği (a) servis katmanından (b) HTTP'den (c) tabletten atınca yalnız (c) NULL yazdı → fark istemcideydi. `finalizeOpenFabric` yolu SAĞLAMDI (offline `mutations.ts` gövdesinde alan + "bu satır unutulursa" uyarısı zaten vardı — aynı uyarı kesim yolunda yoktu). Depo kesimi (`cutWarehouseRoll`) mobilde kat SORMAZ ve bu bilinçli: alan gönderilmeyince backend parent katını miras uygular (yeniden-kesimde doğru varsayılan).
> • **DEVAMI (2026-08-13, aynı gün): KAT artık PANELDEN DÜZELTİLİR + ETİKETE BASILIR.** İki saha isteği: *"düzelt diyaloğuna kat alanını ekle"* ve *"etiketlerde de kat tipi ekleyebilelim"*.
>   - **Düzelt (`applyManualProperties`):** `foldType` alanı eklendi — üçlü sözleşme (`undefined` DOKUNMA · `null` TEMİZLE · kod YAZ) `foldTypeSchema` ile birebir. ⚠️ **Kanoniklik burada da `resolveFoldTypeForWrite`'tan geçer**, elle karşılaştırma yapma: ham "6 kat" kaydedilirse envanterin kat filtresi o topu **bulamaz ve hata/log çıkmaz**. ⚠️ **Kat, yukarıdaki "CHOICE satırları bu uçtan yönetilmez" (F1) kuralının İSTİSNASIDIR** çünkü pivotta değil `Roll.foldType` KOLONUNDA yaşar — Düzelt'teki salt-okunur GRAMAJ çipiyle karıştırma. Kat değişimi **`labelDirty`** işaretler (kat artık kâğıda basılıyor); aynı değer tekrar yazılırsa tetiklenmez. `relabel-context` katı döner, audit `oldData/newData`'ya girer (kanonik değerle).
>   - **Etiket:** `label-fields.ts` **ROLL_RAW + ROLL_FINISHED**'e `foldType` ("Kat") eklendi → Etiket Stüdyosu paleti backend katalogundan beslendiği için **Electron'da ek kod gerekmedi**. `LabelPayload.foldType` + `label-field-values.ts` case'i (HTML/PPLA/PPLB/ZPL **ortak** tek eşleme noktası — yeni emitter yazarken oradan geç). ⚠️ **Etikete katalog KODU basılır** ("6-KAT"), görünen ad DEĞİL: kod topun kimliğidir, ad panelden değişirse geçmiş baskılarla ayrışırdı; ayrıca ada çevirmek her etikete DB okuması eklerdi. Kat girilmemiş topta `present:false` → **şablonda alan dursa bile baskıda atlanır** (`sackNote` emsali), yani kanvas modelinde sürüklenmemişse hiç basılmaz — eski şablonlar bayt-bayt korunur. **ÇUVAL etiketinde YOK** (karışık içerik → tek kat sessizce yanlış olur; ürün/renk alanının olmama gerekçesiyle aynı).
>   - Migration YOK · izin YOK · APK YOK — **backend + Electron aynı pencerede**. Bekçi: `scripts/test_fold_edit_and_label.ts` (16 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — kanoniklik körleşince 4, `labelDirty` bağı kopunca 1, değer haritası silinince 2).
>   - ⚠️ **İKİ BEKÇİ FABRİKA VERİSİ DEV'E ÇEKİLİNCE ÇÖKTÜ — ikisi de bekçi kusuruydu, kod değil** (teşhis yöntemi: şablonu pasifleştirip testi tekrar koş; geçiyorsa hata VERİDEN doğuyor demektir): ① `test_fold_catalog` sondasını sabit `"6-KAT"` koduyla kuruyordu ve fabrika kataloğuna gerçekten 6-KAT eklendiği gün "bu değer katalogda YOK" varsayımını kaybedip **P2002 ile çöktü** — ölçtüğü kural doğru çalışırken. Kural: *"bu değer katalogda yok" diyen bir sonda, kataloğa eklenebilecek GERÇEK bir kodu kullanamaz* (artık `${PROBE}-KAT`). ② `test_label_canvas_equivalence` native çıktıyı **her dilde `asciiFold` ile** arıyordu; oysa **PPLB bilinçli olarak `cleanCtlCp1254` kullanır** (EPL2 header'ı `I8,E` → yazıcı GERÇEK Türkçe basar, "Şube"→"Þube" baytı). Fabrikanın çuval şablonu dev'e gelince Türkçe değerli iki alan (`branchName`, `sackNote`) ilk kez PPLB'den geçti ve bekçi "veri düştü" diye **sahte kırmızı** verdi. Beklenti artık emitter'ın kendi dönüşümüyle kurulur — yoksa Türkçe içeren HER yeni alan aynı yanlış alarmı üretir.
> • **İkinci bulgu — katalog kimliği:** kullanıcı "6 Kat" eklemek isterken panelden **`TUP` satırını yeniden adlandırmıştı** (kod TUP, ad "6 Kat") — kod KİMLİKTİR; tablet 6 Kat tuşuyla `TUP` gönderecek, filtre/metre eşleşmesi sessizce şaşacaktı. Düzeltme: TUP adı "Tüp"e geri döndü (sortOrder 50), **gerçek `6-KAT` değeri eklendi** (sortOrder 30). Ders: katalog UI'sinde ad değişikliği ile yeni değer ekleme ayrımı kullanıcıya net değil — değer YENİDEN ADLANDIRILIRKEN kodun değişmediğini söyleyen bir ipucu düşünülebilir.
> • Migration YOK · izin YOK · **yalnız yeni APK** (backend/Electron değişmedi). Deneme kesimleri (F0005-F0007) tekil geri almayla temizlendi; kullanıcının NULL katlı eski topları (F0001-F0004, F0008) geriye doldurulmadı — istenirse Electron "Düzelt" ile kat yazılabilir.

> ⚠️ **PROFİL GERÇEĞİ:** Tambur geri-alma modları ve modal metinleri `production.enabled` yüzeyidir; **"restore-toplamına giren HER kaynak `applyFull` terslemesine de eklenir, yoksa çift sayım"** senkron sözleşmesi ve **"genel 'stoktan kaldır' tuşu bilinçli RED — sebebi söyleyen TİPLİ olay yazılır"** kuralı ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-22__2026-08-22-mutabakat-kapisinin-kirmizisi`: 'Metraj geri koyma: üretim dalı yalnız currentQty' kuralına AŞIM KORUMASI eklendi: tekil geri almanın cutOpenFabric dalında restore sonrası currentQty > initialQty ise initialQty yukarı çekilir ve deftere OVERAGE (source TAMBUR_UNDO_RESTORE) yazılır — arşiv ikizi/applyFull ile ayna.
> - KISMİ → `R:2026-08-25__2026-08-25-saha-deploy-sonrasi`: 08-12 'Depo Stoktan Kaldır tek tipli çıkış yeterli, eksik olan adlandırmaydı' → 08-25 o tuş İKİYE ayrıldı: İptal (CANCELLED, qtyOut=0) · Fire (SCRAP, qtyOut=qtyIn, POST /rolls/:id/scrap, roll:manual-adjust). 'Genel X tuşu YASAK' ilkesi aynen duruyor.
>

> **NOT (2026-08-12 gece — TEKİL CANLANDIRMA (`SINGLE_RESTORE`) + F0402 sıfır-çocuk düzeltmesi + geri alma modalı sadeleşti):** Saha sorusu iki aşamada geldi: *"modal çok kalabalık, bu topu iptal et / sadece bu topu iş emrine geri al tuşu koy — diğer topları canlandırmak zorunluluk mu?"* ve *"iş emri bitmiş TEK topu canlandırmak mümkün değil o zaman?"* İkincisi gerçek bir boşluktu: kaynak arşivdeyken tekil geri alma yalnız **kayıt düzeltmesi** yazabiliyordu (metraj kaybolur, iş emri kapalı kalır) — "kumaş elimde, kaydı yanlış" gerçeğinin YOLU YOKTU; tek çıkış FULL'dü ve o kardeşleri de iptal ediyordu.
> • **Yeni mod `SINGLE_RESTORE` ("İş Emrine Geri Al")** = FULL'ün dirilme makinesi, TEK topun metrajıyla: çocuk iptal, metrajı kaynak topa geri konur, kaynak Tambur adımına (depo kesiminde kapanış-öncesi rafına) dirilir, kapalı iş emri + refakat kartı yeniden açılır, **kardeşlere dokunulmaz**. Ek izin/sebep İSTEMEZ (operatörün günlük düzeltmesi; FULL'ün `roll:manual-adjust` kapısı "geçmişi toptan yeniden yazma" içindi ve DURUYOR). FULL'den üç bilinçli fark: kapanışın sapma satırları TERSLENMEZ (kalan-metraj kararı ayakta) · `RollError` yeniden açılmaz · `TAMBUR_PROCESSED` izi yine silinir (iş yeniden açık; iz kalsa rapor çift sayardı). Aynı-gün ayarı (`tamburUndoFullSameDayOnly`) BUNA UYGULANMAZ — ayar adıyla FULL'ü kapılar.
> • ⚠️ **Metraj geri koyma İKİ DALDA FARKLI — `applySingle`ın canlı-kaynak dallarının aynası:** üretim akışı yalnız `currentQty` geri koyar (kesim yalnız onu düşmüştü, aşımda `initialQty` bump + `TAMBUR_UNDO_RESTORE` kaynaklı OVERAGE satırı); depo kesimi **ikisini birden** geri koyar (`cutWarehouseRoll` ikisini birden düşer — tek taraf yazılsaydı sahte AŞIM doğardı).
> • **F0402 çıkmazı kapandı:** tüm çocukları TEK TEK iptal edilmiş kapanışta FULL "iptal edilebilir çocuğu kalmamış" ile reddediyordu ve tekil iptallerin sapmaya yazdığı metraj (saha: 208 m) sonsuza dek kayıptı. `computeRestoredQty` artık **çocuk-kapsamlı `TAMBUR_UNDO_SINGLE` düzeltmelerini de sayar** (satırlar ÇOCUĞUN rollId'sinde — `roll: { parentRollId }` ile bulunur) ve sıfır-çocuk + `restored > 0` durumunda FULL çalışır. ⚠️ **SENKRON SÖZLEŞMESİ:** restore-toplamına giren HER kaynak `applyFull` 5b terslemesine de eklenir — yoksa metraj geri konur, sapma satırı canlı kalır, dönem raporu aynı metrajı İKİ KEZ görür (bekçide kilitli).
> • **Modal tek-eylem/iki-kart kurgusuna indi + METİN SETİ (kullanıcı kararı):** tuş yaptığı işin adını taşır — **Kesimi Geri Al** (canlı kaynak) · **Topu İptal Et** (arşiv, kayıt düzeltmesi) · **İş Emrine Geri Al** (canlandırma) · **Tümden Geri Al** · **Kaydı İptal Et** (manuel). Arşivli kaynakta iki tekil yol **seçim kartı** olarak çıkar, **ön seçim YOKTUR** (hangi gerçeğin doğru olduğunu yalnız operatör bilir; seçilmeden onay kapalı — "Önce seçim yapın"). "Tüm işlemi geri al (N top)" düz metin bağlantıdan **çerçeveli butona** çevrildi (saha: "tıklanabilir hissi vermiyor"); yetkisizde de görünür, engel sebebi o görünümde söylenir (kullanıcı kararı: gizleme). SINGLE görünümünde ayrı "Kaynak top"/"İptal edilecek parçalar" blokları BASILMAZ (tek kayıt zaten açıklama cümlesinde barkod+metrajla adlı — yıkıcı-işlem kuralı böyle sağlanır); backend'in arşiv uyarısı da düşürüldü (`warnings[]` yalnız description'da OLMAYAN bilgiyi taşır).
> • **Genel "X / stoktan kaldır" tuşu BİLİNÇLİ REDDEDİLDİ** (kullanıcı onayı): sektör standardında stok kaydı silinmez, sebebi söyleyen TİPLİ olay yazılır (storno / sayım farkı / fire / tersleme) ve buton o olayın adını taşır; genel X bu ayrımı yutar, üstelik "neden" sormak zorunda kalıp aynı menüye dönüşür. Mevcut istasyon-bazlı tipli çıkışlar (Depo "Stoktan Kaldır" · KK1 iptal · Tambur modalı · WO kapanış dispozisyonu) yeterli — eksik olan adlandırmaydı, o da düzeltildi.
> • **Yan düzeltme:** "Bu işten çıkanlar" paneli yeni-en-üstte sıralı ama ScrollView piksel ofsetini koruyordu — operatör aşağı kaydırdıysa yeni kesim görünmeden ekleniyordu; en üstteki topun KİMLİĞİ değişince liste başa döner (sabit aralıklı refetch'te kimlik değişmez, kaydırılan yer durur).
> • **Migration YOK · izin YOK · backend + APK aynı pencerede** (eski APK yeni modu göndermez → `defaultMode=SINGLE`'a düşer, bugünkü davranış; yeni APK + eski backend → `SINGLE_RESTORE` Zod'da yok, 400). Bekçi: `test_tambur_undo` 36 → **53 kontrol** (§9 canlandırma + §10 F0402; **üç negatif sondayla** kırmızı verdiği doğrulandı — tekil-kayıp sayımı körelince 2, çocuk-kapsamlı tersleme koparılınca 1, canlandırma kardeşleri iptal eder hâle getirilince 1).

> ⚠️ **PROFİL GERÇEĞİ:** "KK1'de tek kırmızı yüzey" ve yazıcı kuyruğu kararları bu kurulumun saha ergonomisidir; **"toast 'kayıt oluşmadı' DİYEMEZ — timeout ≠ yazılmadı"**, "çakışma 409'unun TEK yüzeyi modaldır" ve "köprü `setMutationDefaults`'a taşınamaz" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §11.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `KOD 68486d3b (2026-08-29) — mobil/src/offline/announceFailure.ts`: 'Çakışma 409'ları (POSSIBLE_DUPLICATE/CLIENT_TOKEN_COLLISION) toast BASMAZ — tek yüzey modal' kuralı DARALTILDI: modal yalnız kaydı yapan ekran ayaktayken çizilebilir; uygulama kapanıp açılınca kuyruktan replay edilen kaydın ekranı yoktur → çakışma da DUYURULUR (ekranYok). Belirsizlikte duyur. Kök CLAUDE.md:59 hâlâ eski mutlak hâli yazıyor.
>

> **NOT (2026-08-12 — KAYIT KUYRUĞU KALDIRILDI: kalıcı düşüş artık DUYURULUR, saklanmaz + KK1'de tek kırmızı yüzey):** Saha gözlemi: KK1 header'ında aynı anda **iki kırmızı çip** ("4 KAYIT GİTMEDİ" + "3 ETİKET HATALI") ve altta **üçüncü bir kırmızı bant** duruyordu; operatörden üçünü ayırt etmesi bekleniyordu ve ikisi aynı şeyi söylüyordu. Kullanıcı kararı: *"backende istek gitmediyse o an sadece hata versin, bir yere yazmaya gerek yok."*
> • **ÖLÜ MEKTUP KUTUSU (`offline/failedOps.ts` + `components/outbox/OutboxModal.tsx` + `offline/retryFailedOp.ts`) SİLİNDİ.** Kök kusur *karışıklık değil YANLIŞLIK*tı: kutu iki bambaşka olayı tek başlıkta topluyordu — (a) istek **ULAŞMADI** (ağ/timeout) · (b) istek **ULAŞTI, sunucu 409 ile SORU SORDU** ("bu top az önce girilmiş olabilir") — ve başlık ikisine birden *"bilgisayara ULAŞMADI — sistemde kaydı YOK"* diyordu. (b) için bu yanlıştır ve operatörü ağ aramaya yönlendirir. Üstelik KK1'de aynı 409 **hem modal hem kutu satırı** doğuruyordu (çift muhasebe); modal cevapsız kapatılırsa satır kutuda çürüyordu (sahada gözlendi: 4 satır, 1 saatlik, ilgili toplar zaten sistemdeydi).
> • **YERİNE `offline/announceFailure.ts`:** `MutationCache.onError` köprüsü KALDI (observer'sız/restore edilmiş mutation'ları da kapsayan tek nokta — `setMutationDefaults`'a taşınamaz, component `onError` onu EZER), yalnız **varış noktası** değişti: kalıcı düşüş **anlık toast** basar ve hiçbir yere yazılmaz. Kayıp riski üç mevcut mekanizmayla karşılanır: KK1 online-only rejimi (çevrimdışıyken kayıt hiç denenmez) · sunucudaki **atomik mükerrer tuzağı** (belirsiz timeout sonrası yeniden giriş yakalanır) · yazıcı kuyruğu ("top KAYITLI, etiketi çıkmadı" ayrı ve kalıcı yüzey).
> • ⚠️ **ÇAKIŞMA 409'LARI TOAST BASMAZ** (`POSSIBLE_DUPLICATE` / `CLIENT_TOKEN_COLLISION`): onların TEK yüzeyi ekranın kendi modalıdır. Toast basmak aynı kararı ikinci kez, üstelik **cevaplanamaz** biçimde sordururdu — kutu döneminin asıl hatası buydu. Muafiyet listesi bilinçli DAR: `WORK_SESSION_REQUIRED` gibi çakışma-dışı 409'lar duyurulur (eskiden TAM SESSİZ kaybolan sınıf).
> • ⚠️ **TOAST "KAYIT OLUŞMADI" DEMEZ, DİYEMEZ.** Zaman aşımında sunucu COMMIT etmiş olabilir (*timeout "yazılmadı" demek DEĞİLDİR*); kesin yokluk iddiası, gerçekten yazılmış bir topu operatöre ikinci kez girdirirdi. Metin önce DOĞRULATIR: *"… · Listede yoksa tekrar girin."*
> • **KK1'DE TEK KIRMIZI YÜZEY:** header'daki **"N ETİKET HATALI"** çipi kaldırıldı, tek işi olan detay listesi **footer bandına** bağlandı (banda dokun → yazıcı kuyruğu; "Tekrar Bas" dışarıda kalır, %90 durumda istenen odur). Çipin **basım** göstergesi KALDI — anlıktır, nötr renktir ve "şu an bir şey oluyor" bilgisini başka hiçbir yüzey vermez. **Yazıcı kuyruğunun kendisi KALDI** (kaldırma önerilmedi): 07.08 vakasının panzehiri odur, "top KAYITLI, yeniden girme" der.
> • ⚠️ **İÇE AKTARMA DÖNGÜSÜ:** etiket sözlüğü `offline/stationLabels.ts`e taşındı çünkü `mutations.ts` → `queryClient.ts` import ediyor ve toast etiketi `queryClient`ten okunuyor; `mutations.ts` ikisini de **re-export** eder (çağrı yerleri değişmedi). Yeni `STATION_MUT` anahtarı eklerken etiketi oraya da yaz (bekçi: `mutations.test.ts`).
> • ⚠️ **AYNI GÜN BULUNAN KALICI KİLİTLENME (aynı pakette düzeltildi):** API kapatılıp geri açılınca uygulama ASLA çevrimiçiye dönmüyordu (yeniden başlatmak gerekiyordu). İki parça birlikte kilit üretiyordu: ① `serverReachability.healthUrl()` **DERLEME ZAMANI** `API_URL` sabitini yokluyordu, oysa gerçek istekler operatörün Ayarlar'dan girdiği adrese gidiyor (`api.ts` → `getCurrentBaseUrl()`) → yoklama **başka bir sunucuyu** soruyor ve adres düzeltilse bile asla tutmuyor; ② çevrimdışıyken TanStack Query sorguları duraklattığı için **hiçbir gerçek istek çıkmıyor** → `reportServerReachable`ın tek tetikleyicisi yoklama kalıyor. Yani ① kırılınca çıkış yolu YOK. Düzeltme: yoklama adresi **her çağrıda canlı okunur** · `revalidateServer()` (elle "Şimdi dene", çevrimdışı bandında) · **adres değişince otomatik yeniden değerlendirme** (`useBaseUrlStore.subscribe` — abonelik BU YÖNDE, tersi içe aktarma döngüsü olurdu) · backoff tavanı **30 → 10 sn** (yoklama zaten yalnız kesinti sürerken koşar, sağlıklı durumda tek ek istek bile atılmaz). Bekçi: `serverReachability.test.ts` (+5 kontrol; asıl hata geri konunca 2 kırmızı verdiği doğrulandı). Sahada doğrulandı: backend düşürüldü → kilitlendi → backend geri kaldırıldı → **tablete dokunmadan** çevrimiçiye döndü.
> • **Migration YOK · izin YOK · backend DEĞİŞMEDİ — saf mobil; YENİ APK ister.** Diskteki eski `TEKSERP_FAILED_OPS_V1` anahtarı okuyansız kalır (birkaç KB, `PERSIST_BUSTER` bump'ı **YAPILMADI** — o, kuyrukta bekleyen saha kayıtlarını silerdi). Bekçiler: `announceFailure.test.ts` (12 kontrol) · `SyncStatusChip.test.ts` (5) · `mutations.test.ts` köprü bloğu — **dört negatif sondayla** kırmızı verdiği doğrulandı (çakışma muafiyeti kalkınca 2, metin kesinleşince 1, kutu metni sunucu dalına sızınca 2, rozet dokunulabilir olunca 1). ⚠️ Sonda dersi: ilk yazımda rozet bekçisi **KÖR**dü — `setOnline(false)` yalnız *link* dalını çalıştırıyor, *sunucu* dalına sızan metin görülmüyordu; `reportServerUnreachable()` ile o dal da kurulmalı. `queryByRole('button')` de yetmez (sarmalayıcı `Animated.View`da rol yakalanmıyor) → basılabilir düğüm sayısına bakılır.

> ✅ **ÇEKİRDEK:** "Giriş noktası = en erken hareketin adım sırası", "çözülemezse bekleyen say (erken COMPLETED geç olandan kötü)" ve "bekçi ile ürün kodu AYNI kuralı söylemeli" — rota topolojisinden bağımsız; MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-04 — "GİRİŞ NOKTASI" kuralı: iş emrine AŞAĞIDAN katılan top yukarıdaki adımları bekletemez):** `recomputeStepStatus`'un bekleyen-top sorgusu naif hâliyle *"bu adımda hareketi yok + hâlâ üretimde"* diyordu. Bu, iş emrine **ortadan katılan** her topu yukarıdaki adımlar için **sonsuza dek** bekleyen sayıyordu. İki gerçek vaka: **fason dönüşü çocuğu** (kabulde orijinal emekliye ayrılır, makbuzdan yeni toplar doğar — bunlar fason adımının ÇIKTISIDIR, o adıma hiç girmediler ve giremezler) ve **elle eklenen top** (doğrudan Tambur adımına yazılır, üstteki Kurşun/Boyahane'ye hiç uğramaz). Sonuç ikisinde de aynıydı: kapanmış adım `closedCount>0 && pendingRolls>0` dalına düşüp **COMPLETED'tan ACTIVE'e geri dönüyor**, `ensureWorkOrderInProgress` iş emrini IN_PROGRESS'e çekiyor ve `completeWorkOrderIfStepsDone` o iş emrini **bir daha asla kapatamıyordu** — hata yok, log yok. Genel kural özel yamaların yerini aldı: topun **giriş noktası** = bu iş emrindeki EN ERKEN hareketinin adım sırası; o sıra bu adımdan büyükse top aşağıdan katılmıştır ve bu adım için hiç bekleme yaşamamıştır. Aynı top, henüz **ulaşmadığı** aşağı adımlar için hâlâ bekleyendir. Giriş noktası çözülemezse (veri tuhaflığı) **eski davranış**: bekleyen say — adımı erken COMPLETED yapmak, geç yapmaktan kötüdür. ⚠️ **Bekçi ile ürün kodu AYNI kuralı söylemeli**: `scripts/test_consistency.ts` §20 bu sorgunun aynasıdır; biri değişip diğeri kalırsa bekçi ya yanlış alarm verir ya gerçek drift'i kaçırır. `scripts/test_helpers.ts`'teki sahte `tx` de `roll.findMany` sözleşmesini taşır (birim testi durum makinesinin dallarını ölçer, kuralı değil — kural gerçek veri üzerinde §20 ve `test_fason_wrong_station_guidance` S1c ile doğrulanır).

> ⚠️ **PROFİL GERÇEĞİ:** Fason çeki / kabul makbuzu yüzeyleri fason modülü altındadır ve "fasona giden belgede parti varsayılan AÇIK" bu kurulumun boyahane ilişkisidir; **"`sections`/`columns.hidden` BLOCKLIST'tir → naif kolon müşteri belgesinde varsayılan GÖRÜNÜR doğar"**, "fazla işaretlemek güvenli, eksik hata" ve "GET bayrağı TEMİZLEMEZ" ÇEKİRDEK'tir — bkz. MODUL-BAYRAK-TASARIM §2/§11.

> **NOT (2026-08-05 — PARTİ NO KÂĞIDA BASILIR + refakat kartı "bayat" bayrağı):** Saha sorusu: *"Mobilden hızlı iş emri açınca parti no karta yazılıyor, bilgisayardan açıp fason sevk yapınca belgede yazmıyor."* İnceleme **iki ayrı kök neden** gösterdi ve ikisi de kapatıldı — migration `20260804213714_traveler_card_content_dirty`.
> • **Fason sevk irsaliyesinde parti no HİÇ YOKTU** — "belge önceden donmuş" sorunu DEĞİL: `SubcontractorDispatch.batchId` **NOT NULL** (K10 "bir sevk = bir parti") ve belge tam o create tx'inde donuyor, yani parti donarken zaten biliniyordu; payload'a hiç konulmamıştı. Dört yüzeye eklendi: **fason çeki** (`assembleFasonCekiDoc`, tekil `batchNumber`) · **fason kabul makbuzu** (`batchNumbers` — **ÇOĞUL**, çünkü bir kabul birden fazla sevki kapsayabilir; tekil alan sessizce yanlış olurdu) · **fasondan doğrudan sevk** · **müşteri sevk irsaliyesinin çeki tablosu** (kolon; parti **ÇUVAL değil TOP başına** taşınır — çuval karışık içerikli).
> • **Görünürlük varsayılanı bilinçli olarak İKİYE ayrıldı.** Fasona giden belgeler (çeki + makbuz) **varsayılan AÇIK** — boyahanenin operasyonel ihtiyacı. Müşteriye gidenler (doğrudan sevk + çeki tablosu) **opt-in**: `sections`/`columns.hidden` birer **BLOCKLIST**'tir, yani naif eklenen kolon canlı müşteri irsaliyelerinde **varsayılan GÖRÜNÜR** doğar ve sahadaki her belgenin yerleşimi sormadan değişirdi. Renderer'da `cfg.sections?.batchInfo === true` / `DocCol.defaultHidden` (allowlist). ⚠️ Panel tarafı da güncellenmeli: `Electron/documentConfig.resolveDocConfig` bölümleri "kayıtlı değer yoksa AÇIK" diye çözüyordu → **`DocSectionDef.defaultHidden`** eklendi; yalnız bir tarafı işaretlemek "panel açık der, belge boş çıkar" (ya da tersi) yalanını üretir.
> • **Eski donmuş belgeler DEĞİŞMEZ.** Alanlar `batchNumber?` (opsiyonel) → 2026-08-05 öncesi snapshot'larda yok, satır/kolon **basılmaz** ve çıktı bayt-bayt korunur (`fason-ceki.html` satırı "Tarih"in SONUNA eklenir — kendi satırında `${…}` bırakmak boş satır sokup parmak izini bozardı). Geriye dönük doldurma **YAPILMAZ**; `reissue` ile tazelenen belge yeni alanı alır (gerçek veriyle doğrulandı: FS0408260001 donmuş hâlde basmıyor, reissue sonrası basıyor).
> • **`TravelerCard.contentDirty`** — kart **iş emri açılışında** doğar/basılabilir, parti ise `attachRolls`'ta doğar; ayrıca kısmi sevkte kalanlar YENİ parti alır (`splitRemainder`) ve çok partili sevkte K11 merge kaynakları yutar. Üçünde de basılı kâğıt sessizce yanlışlanıyordu. Sistem bunu **top etiketi için zaten çözmüştü** (`Roll.labelDirty`/`Sack.labelDirty`); kartta karşılığı yoktu. Tek yazma noktası **`helpers/traveler-card-dirty.helper.markTravelerCardDirtyTx`**, 9 çağrı noktası: parti (`createBatchTx` — `splitBatch`/`splitRemainder` de buradan geçer · `mergeBatches` · `moveRolls`), fason sevk (oluştur · iptal · aktarım geri alma), WO içeriği (`update` · `replace` · `updateTargetProperties` · `updateStepPlanning`). Yön kuralı: **fazla işaretlemek güvenli, eksik işaretlemek hata.**
> • ⚠️ **K18 KURALI KARTA KOPYALANMAZ.** Rol etiketinde "ilk parti ataması bayraklanmaz" denir (etiket henüz parti numarasıyla basılmamıştır); **kartta TERSİ** geçerlidir — kart parti doğmadan basılabildiği için ilk doğuş tam da bayatlatan olaydır. Bekçi bu asimetriyi kilitler.
> • ⚠️ **`GET /traveler-cards/:id/html` bayrağı TEMİZLEMEZ** — o uç önizlemeyi de besler ("HTML almak" ≠ "basmak") ve GET'in yan etkisi olmamalı. Temizleyen: yeni **`POST /api/traveler-cards/:id/print-event`** (audit-only, versiyon ARTIRMAZ, snapshot'a dokunmaz — emsal `POST /api/labels/rolls/:id/print`) ve `reprint`. İstemciler baskı BAŞARIYLA döndükten sonra çağırır; iptal edilen baskı bayrağı temizlemez. Bildirim hatası yutulur (kâğıt çıktı, baskıyı hata ile kesme).
> • ⚠️ **ROZET YÜZEYLERİ 2026-08-06'da TAMAMEN KALDIRILDI (kullanıcı kararı) — backend DURUYOR.** Dört yüzey de silindi: Electron Belgeler diyaloğu ("Güncel değil") · Electron kart önizleme bandı · mobil Hızlı İş Emri detayındaki dokunulabilir bant (onu besleyen `traveler-card-active` sorgusu da düştü) · mobil Belgeler kartındaki "GÜNCEL DEĞİL". Gerekçe: işaret *sahadaki kâğıdın* eskidiğini söylüyordu, **ekrandaki belgenin değil** — ama operatör onu tam da bastığı belgenin yanında görüp "ekrandaki eski" diye okuyordu ve **içerik 2026-08-05'ten beri her baskıda canlı çözüldüğü için bu okuma HER ZAMAN yanlıştı**. Üstelik canlı bir iş emrinde işaret sürekli yanıyordu (parti doğumu / fason sevki / WO düzenlemesi işaretler, yalnız baskı olayı temizler) → gürültü sinyali yuttu. **Kolon, `markTravelerCardDirtyTx`, `print-event` temizliği ve audit `wasDirty` AYNEN duruyor** — backend'e tek satır dokunulmadı, kaybedilen tek şey gösterim. Bilinçli bedel: sahada dolaşan bayat kâğıdı tazeleme dürtüsü artık hiçbir ekranda yok. Geri istenirse çözüm bandı geri koymak DEĞİL, işareti gerçek karşılaştırmaya bağlamaktır (`planKey` + basılan parti parmak izi snapshot'a yazılır → "kartın basmadığı bir alanı düzenledim, rozet yandı" sınıfı yanlış pozitifler biter). Bekçiler: `scripts/test_traveler_card_stale.ts` · `test_shipment_doc_batch_column.ts` · `test_fason_ceki_html.ts` §10 (üçü de negatif sondayla kırmızı verdiği doğrulandı).

> ⚠️ **PROFİL GERÇEĞİ:** Birleştirilen dört kaynağın ikisi (`SUBCONTRACTOR_RECEIPT`, `SUBCONTRACTOR_DIRECT_SHIP`) fason modülüne aittir — fason kapalı kurulumda liste iki kaynakla doğar. **"Liste izni ↔ baskı izni HİZALI olmalı, ayrışma = görünen satır + sessiz 403"** ve "iptal belge listede KALIR" ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §3 madde 4.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-05__2026-08-05-parti-no-k`: N22'nin 'Kart bayatsa detaydaki uyarı bandı DOKUNULABİLİR ve kartı doğrudan basar' (mobil) + 'kart için contentDirty rozeti' → N21'in 2026-08-06 bendi: rozet YÜZEYLERİ dört yerde de kaldırıldı (backend alanı duruyor).
> - KISMİ → `R:2026-08-05__2026-08-05-is-emri-belgeleri`: Aynı notun eski cümlesi ('Electron'un ESKİ Belgeler diyaloğu iptalleri gizliyor ve kendi listesini wo.steps[].dispatches'ten kuruyor — bilinçli, geçici ayrışma') notun kendi 2026-08-06 bendi ve kodla kapandı: diyalog tek uçtan okur, iptal İPTAL rozetiyle listede.
>

> **NOT (2026-08-05 — İŞ EMRİNİN BELGELERİ TEK UÇTAN: `GET /work-orders/:id/documents`):** Bir iş emrinin belgeleri **dört ayrı kaynakta** yaşıyor (`TravelerCard` + üç `PrintedDocType`) ve `findById` yalnız `steps[].dispatches`'i taşıyordu. Sonuç: **fason kabul makbuzu** ve **fasondan doğrudan sevk irsaliyesi** hiçbir istemciden iş emri üzerinden ULAŞILAMIYORDU — belge vardı, kapısı yoktu; mobilde ise belge listesi hiç yoktu (tek "Çıktı" butonu yalnız refakat kartını basıyordu). Yeni uç dört kaynağı tek listede döner (`docType` · `sourceId` · `documentNo` · `date` · `group` · `title`/`subtitle` · `cancelled` · kart için `contentDirty`); istemciler artık **kendi listelerini kurmaz** — yeni belge tipi eklenince tek yer güncellenir.
> • **Baskı iki uçtan:** `TRAVELER_CARD` → `/traveler-cards/:id/html` (+ `print-event`), diğerleri → `/printed-documents/:docType/:sourceId/html`. Mobil dallanma tek yerde (`services/workOrderDocuments.printDocument`).
> • ⚠️ **ELECTRON'DA HER SATIR ÖNİZLEME AÇAR (2026-08-06 düzeltmesi).** Diyalog kurulurken belge tipleri ikiye ayrılmıştı: kendi zengin diyaloğu olan ikisi (refakat kartı, fason sevk) önizleme açıyor, kalan ikisi (**fason kabul makbuzu**, **fasondan doğrudan sevk**) `printHtmlString` ile **doğrudan yazıcı diyaloğuna** gidiyordu — operatör ne bastığını göremiyordu ve bu iki belgede versiyon geçmişi / revizyon / baskı notu / PDF ekranda hiç yoktu (uçlar vardı). Oysa docType-agnostik `components/print/PrintedDocDialog` **zaten mevcuttu** ve aynı makbuz `FasonReceiveInline`'dan **onunla** açılıyordu; yani aynı belge bir kapıdan önizlemeli, diğerinden önizlemesiz çıkıyordu. Artık **varsayılan dal generik önizlemedir** — backend listeye yeni bir belge tipi eklerse sessizce "önizlemesiz" doğmaz. Revizyon izni `workorder:write` (DOC_PERMISSIONS write kümesiyle hizalı; ayrışırsa "Revize Et" görünür ama uç 403 verir). Mobil bilinçli olarak **doğrudan basmaya devam eder** (tablette önizleme adımı fazladan dokunuş). Saf Electron: migration/izin/APK yok.
> • ⚠️ **LİSTE İZNİ ile BASKI İZNİ HİZALI OLMALI.** Liste tek uçtan geliyor, baskı ise belge-tipi bazlı `DOC_PERMISSIONS` ile kapılı: ayrışırlarsa operatör satırı **görür**, basar, **hiçbir şey olmaz** (sessiz 403) ve sebebi hiçbir yerde yazmaz. Bu yüzden `SUBCONTRACTOR_RECEIPT` ve `SUBCONTRACTOR_DIRECT_SHIP` read listelerine `mobile:hizli-is-emri` (+ makbuza `mobile:fason-sevk`) eklendi. Bekçi bu hizayı **mekanik** doğrular (`DOC_PERMISSIONS` bu yüzden export edildi) — yeni belge tipi eklerken listeye de yaz.
> • **İPTAL EDİLMİŞ belge listede KALIR** (`cancelled: true`) — donmuş belge silinmez, VOIDED'e çekilip İPTAL filigranıyla basılır; dosyaya bakan kişi onu yeniden basabilmeli. İstemci rozetle ayırır. ⚠️ Electron'un **eski** Belgeler diyaloğu iptalleri gizliyor ve kendi listesini `wo.steps[].dispatches`'ten kuruyor — bilinçli, geçici ayrışma; o diyalog bu uca taşındığında davranış birleşir (kabul makbuzu + doğrudan sevk de orada görünür).
> • Sıralama sözleşmesi: **kart önce** (iş emri belgesi), sonra fason belgeleri **tarih DESC** — sahada aranan "en son basılan"dır. İstemci yeniden sıralamaz.
> • Mobilde giriş noktası: Hızlı İş Emri → iş emri detayı → **"Belgeler"** (eski "Çıktı" butonunun yerine; kart listenin ilk satırı, yani hâlâ tek dokunuş). Kart bayatsa detaydaki uyarı bandı **dokunulabilir** ve kartı doğrudan basar — uyarıyı gören operatörün düzeltmesi liste gezmeden olmalı. Bekçi: `scripts/test_workorder_documents.ts` (27 kontrol; listedeki HER satırın gerçekten render edildiğini de doğrular — "listede var ama basılamıyor" sınıfı; iki negatif sondayla kırmızı verdiği doğrulandı).

> ✅ **ÇEKİRDEK:** Storno ≠ iade (SAP VL09), `preShipStatus` ile rafın korunması, `freezeForSource` `max+1`, "tahsis SİLİNMEZ, `shippedQty` defterden türer", `documentSourceId` ile belge çözümü ve `shipping:undo-dispatch` görev ayrılığı — hepsi defter semantiği, bayraklanmaz (MODUL-BAYRAK-TASARIM §11).
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-22__2026-08-22-sevk-kapisi-bayragin`: Faz 0 yan düzeltmesi 'Sevk Kapısı karosu: bayrak açık VEYA çıkış bekleyen PLANNED sevkiyat var' KALDIRILDI → karo SAF bayrak, sack-store/board?limit=1 sondası kalktı. Kapalı rejimde PLANNED'ın çözümü storno releaseSacks ve Sevkiyatlar detayındaki 'Sevk Et'. Paketleme kilit uyarısı metni de değişti.
>

> **NOT (2026-08-05 — SEVKİ GERİ AL (STORNO) ≠ İADE + çuval bazlı TOPLU İADE tek belgeyle):** Saha üç soru sordu: *"sevk edileni depoya geri çekebiliyor muyuz?"* · *"sevkiyattan tek çuvalı iade alabilir miyiz?"* · *"araç hâlâ kapıda, çuvaldan 2 top çıkarmamız lazım — nasıl?"* Üçünün de cevabı **iade**ydi ve iade bu iş için YANLIŞ araçtır. Migration `20260805100000_shipment_undo_and_return_group` (iki nullable kolon; metadata-only).
> • **AYRIM SEKTÖREL, keyfî değil:** *İade (RMA)* = mal müşteriye ULAŞTI ve geri geldi → çıkış belgesi **düzeltilmez** (brüt kuralı), ayrı iade irsaliyesi kesilir, iade defterine yazılır. *Storno* = mal **hiç çıkmadı**, kayıt erken/hatalı → çıkış belgesi **İPTAL** edilir, stok geri döner, iade defterine **GİRMEZ**. SAP karşılığı VL09 (*reverse goods issue*). Hiç çıkmamış malı iade yazmak yalnız olayı yanlış anlatmakla kalmaz, **iade nedeni zorunlu** olduğu için kalite geri-besleme verisini de kirletir. Projedeki emsal aynı ayrım: `softDelete` (`qtyOut=0`) ↔ WO-kapanış dispozisyonu (`qtyOut=qtyIn`).
> • **`Roll.preShipStatus` — sevk, topun önceki rafını YOK EDİYORDU.** `performDispatchTx` tek `updateMany` ile hepsini `SHIPPED` yapıyordu; çuvalda hem `WAREHOUSE` hem `A1_STOCK` (2. kalite) top bulunabildiği için geri almada hepsini WAREHOUSE'a döndürmek **2. kalite topu sessizce 1. kalite rafına** yazardı. Artık statüye göre gruplanıp her grup kendi snapshot'ıyla yazılır; storno okuyup NULL'lar. Emsal: `RollReturn.prevSackId/prevQualityGrade`.
> • **`freezeForSource` `version: 1` SABİT yazıyordu** — bir kaynağın İKİNCİ kez dondurulması hiç düşünülmemişti. Storno sonrası yeniden sevk `docType_sourceId_version` unique'ine çarpıp **500** verirdi, hem de tam sevk anında tx'i geri sararak. Artık `max+1` (ilk dondurmada davranış birebir aynı: kayıt yok → 1).
> • **Tahsis SİLİNMEZ:** `shippedQty` defterden türetilir ve yalnız DISPATCHED sevkiyattaki tahsisleri sayar → sevkiyat PLANNED'a dönünce karşılanma kendiliğinden düşer. Yapılan tek şey `recomputeOrderStatusForOrders` + `ShipmentOrder.isActive=true` (şemada "PLANNED mı" denormu). Kilit protokolü `performDispatchTx` ile simetrik.
> • **Kapsam DAR ve sebebi SÖYLENİR** (`resolveUndoBlockReason` TEK KAYNAK — önizleme ve mutasyon aynı yüklemi çağırır, yoksa ekran "yapılabilir" derken uç 409 verir): faturalanmış (dış muhasebede belge kesilmiş) · bu sevkiyattan iade alınmış (iki motor aynı topa dokunur) · **ayar açıksa** aynı gün değil. **Yeni ayar `shipping.undoDispatchSameDayOnly` varsayılan KAPALI** (tarih sınırı yok) — "aynı gün" TAKVİM günüdür, `factoryDayStart()` ile çözülür. Plaka/şoför **KORUNUR** (ürün kararı; yeniden sevkte zaten üzerine yazılır). **Yeni izin `shipping:undo-dispatch`** — `shipping:write` KAPSAMAZ: sevk eden herkes resmi çıkış belgesini iptal edip defteri geri saramamalı. ⚠️ Boot uzlaştırması izni DB'ye getirir, **kullanıcılara atama elle yapılır**.
> • **ÇOK KALEMLİ İADE — defter satır bazlı KALIR, BELGE grup bazına geçer.** `RollReturn.returnGroupId` (= grup LİDERİNİN id'si) eklendi; `POST /api/returns` artık `rollIds[]` de kabul ediyor (`rollId` **aynen çalışıyor** → mobil APK'ya dokunulmadı). N top = N defter satırı (brüt kuralı, `prevSackId` geri-ekleme ve iade raporları buna dayanıyor) ama **TEK irsaliye** (sektör standardı). Yeni uç `GET /api/returns/lookup-sack?sackCode=` — `lookupForReturn`in çuval kardeşi.
> • ⚠️ **ÜYE id'siyle belge çözülmez** (`buildReturnDispatchDoc` bilinçli `null` döner): aksi halde `getCurrent` lazy-init ile aynı grubun **İKİNCİ resmi kopyasını** farklı bir `sourceId` altında dondurur ve tek iade olayı iki belgeyle görünürdü (negatif sondayla gözlendi). İstemciler yanıttaki **`documentSourceId`** (`returnGroupId ?? id`) alanını kullanır — türetilmiş alan olmadan her istemci aynı `?? id` kuralını kopyalamak zorunda kalır ve kopyalamayan istemcide "irsaliye yok" sessizliği doğar. ⚠️ Alanı `select`'ten düşürmek de aynı sessizliği üretir (`getReturnById`'da tam bu oldu, bekçi yakaladı).
> • **Grup iptalinde belge VOID DEĞİL REVİZE:** bir kalem iptal → `reissueForSourceTx` ile v+1 (iptal edilen satır düşer, kalanlar için belge geçerli kalır); **son** aktif kalem de iptal → VOIDED. Tümünü void etmek, iadesi DURAN topların resmi kaydını sessizce yok ederdi. `reissueForSourceTx` public `reissue`den farklı olarak **kendi tx'ini açmaz** — kaynak mutasyonu ile belge revizyonu ya birlikte olur ya hiç.
> • **Renderer tek satırda çok kalemliye açıldı** (`rows: doc.lines ?? [doc.line]`): tablo zaten `buildDocTable` ile çiziliyordu. `lines` YALNIZ çok kalemlide yazılır, toplam satırı `footLabel` ile yalnız o durumda basılır → **tekil ve eski donmuş belgeler bayt-bayt aynı** çıkar.
> • **Yan düzeltme (Faz 0):** "Sevk Kapısı" karosu bayrak kapatılınca gizleniyor ama açık PLANNED sevkiyatların çıkış onayı YALNIZ o ekrandan yapılıyordu → mal kapıda, ekran yok. `visibleWhen` artık "bayrak açık **VEYA** çıkış bekleyen sevkiyat var". Ayrıca Paketleme/Çuvallar'da boş sonuçta **"sevk edilmiş olabilir"** ipucu (varsayılan kapsam DEĞİŞMEDİ — "depoda ne var" sorusu bulanmasın).
> ⚠️ **BU CÜMLE 2026-08-22'de GERİ ALINDI:** karo kuralı saf bayrağa indi — `Electron/src/pages/Operations/tile-config.ts` bugün `visibleWhen: (ctx) => ctx.shipmentConfirmationEnabled`; "VEYA çıkış bekleyen PLANNED" dalı ve `sack-store/board?limit=1` sondası KALDIRILDI. Kapalı rejimde PLANNED sevkiyatın çözümü storno'nun `releaseSacks` seçeneği ve Sevkiyatlar detayındaki "Sevk Et" düğmesidir — aşağıdaki 2026-08-22 "SEVK KAPISI = BAYRAĞIN EKRANI" notuna bak.
> • **Mobil DEĞİŞMEDİ** (tekil iade sözleşmesi korunuyor, mobil RETURN_DISPATCH belgesi açmıyor) → **backend + Electron aynı pencerede**, APK gerekmez. Bekçiler: `scripts/test_shipment_undo_dispatch.ts` (36 kontrol) · `scripts/test_return_bulk_group.ts` (29 kontrol) — **üç negatif sondayla** kırmızı verdiği doğrulandı: `version:1` sabitlenince yeniden sevk çöktü (exit 1), `preShipStatus` yazımı kaldırılınca 5 kontrol (2. kalite topu WAREHOUSE'a döndü), üye-id kapısı kaldırılınca 2 kontrol (ikinci belge doğdu).

> ⚠️ **PROFİL GERÇEĞİ:** Sayfa boyu (A5), fason çeki grid'i ve "sayfa başına 50 top" bu fabrikanın kâğıt düzenidir — belge şablonu/ayar seviyesinde her kurulumda farklıdır. **DÖRT KAPI birlikte güncellenir yoksa ayar sessizce kaybolur**, `calc()`/`var()` yasağı ve şablon literalinde backtick yasağı ÇEKİRDEK — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-05 — BELGE YERLEŞİMİ: A5 yoğunluk profili + ALAN BAZLI punto/kalınlık):** Panel her belge için **A5 seçtiriyordu ama belgeler A4'e sabitlenmiş px ile yazılmıştı** — yani ayar vardı, karşılığı yoktu. Ölçüldü (headless Chrome, örnek veri): fason çeki A5'te **%105 → imza bloğu ikinci kâğıda düşüyordu** (sahanın "üste dayamıyor, alta dayıyor" şikâyeti; birinci kâğıdın dibinde boşluk, ikincisinde tek satır), **fasondan sevk 149px YATAY taşıyordu** (kâğıdın sağı kesilir), sevk irsaliyesi yazı ölçeği 1.4'te **%131 / iki sayfa / 48px taşma**. Çözüm refakat kartındaki (2026-08-03) kanıtlanmış paternin yayılmasıdır.
> • **İKİ YOĞUNLUK PROFİLİ, ÜÇ DOSYA:** `doc-density.ts` (altı belge ORTAK: sevk · fasondan sevk · fason kabul · kartela · kalite sertifikası · iade) + `fason-ceki.density.ts` (100 hücreli grid kendine özgü) + mevcut `traveler-card.density.ts`. Ortaklaştırma **ölçümle** meşru: altı belgenin CSS'i ortak seçicilerde BİREBİR aynı değerleri taşıyordu (`.company` 16 · `.title` 18 · `.sec` 3px 6px/11 · `.sign` gap 24/üst 28); tek fark `.box .row` etiket sütunuydu (72/64/56) → parametre. **A4 sütunu bugünkü sabitlerin aynısıdır** ve altı belgenin A4 çıktısı (gövde HTML'i dahil) dönüşüm sonrası **birebir aynı ölçüldü**.
> • ⚠️ **İKİ FARKLI ORAN, tek `scale()` DEĞİL:** genişlikler ~0.68 (geometrik zorunluluk), yazı boyları ~0.85 (okunabilirlik tabanı — fabrika kâğıdı elle okunuyor). Belgeye özel ölçüler ortak arayüze eklenmez; belge kendi A4 sayısını verir, `scaleW`/`scaleF` oranı uygular.
> • **YATAY TAŞMANIN KÖKÜ flex'ti, punto değil:** `.hr` (başlık sağ bloğu) ve `.box` (bilgi kutuları) `min-width: auto` + sabit genişlikli içerik yüzünden **küçülemiyordu**. `min-width: 0` + `.info { flex-wrap: wrap }` + `overflow-wrap: anywhere`. A4'te üçü zaten sığdığı için sarma hiç tetiklenmez → çıktı değişmez. Aynı kök neden fason çekinin "yazılar büyüyünce ekrana sığmıyor" şikâyetiydi.
> • **ALAN BAZLI PUNTO/KALINLIK** (`DocumentConfig.fields`): belge geneli `fontScale`/`fontWeight` TEK kolu çevirirdi; artık her alan ayrı (fason çekide 24, diğerlerinde 15–18). Saha isteği birebir buydu: *"metre ve cm verilerinin büyüklüğü kalınlığı ayrıca belirlenemiyor."* **ÜÇ KURAL, üçü de bekçide:** ① override yoksa **tek bayt CSS basılmaz** (ayara dokunmamış belge birebir korunur); ② **`calc()`/`var()` YASAK** — `scaleDocCss` yazı ölçeğini `font-size:\s*([\d.]+)px` regex'iyle uyguluyor, `calc()` o desene takılmaz ve genel ölçek tam da elle ayarlanmış alanlarda **sessizce ölürdü**; ③ her seçici **`.sheet ` ile öneklenir** → ortak chrome'dan her zaman daha özgül, CSS sırasından bağımsız kazanır.
> • ⚠️ **BELGEYE ÖZEL KURAL ORTAK KATMANDAN SONRA BASILIR** (eşit özgüllük → sonra gelen kazanır). Sıra bozulursa belgeler sessizce birbirine benzer. Korunanlar: sevk irsaliyesinde liste başlığı 12px + açıklama hücresi 10px + `.pgb`, kalite sertifikasında `.decl` + kendi `.tbl-cap` boşluğu, iade irsaliyesinde `.box`un **flex çocuğu olmaması**. **`totRow: false` iade irsaliyesine özeldir:** o belgede toplam satırı vurgusu HİÇ YOKTU; ortak katman uğruna canlı bir resmi belgenin görünümü sormadan değiştirilmedi (hizalamak istenirse bilinçli bir ürün kararıdır, refactor yan etkisi değil).
> • **`DOC_PAGINATION_CSS` altı belgeden yalnız sevk irsaliyesindeydi** → artık ortak katmanda. Tercih değil doğru baskının koşulu: çok sayfalı tabloda ikinci sayfa kolon adları olmayan çıplak sayı bloğu olarak basılıyordu.
> • **Fason çekiye özel dört yerleşim isteği** (saha): parti no **sol/sağ** (`placements.batchInfo`, varsayılan sağ) · **hesap no OPT-IN** (`sections.accountNo`, varsayılan KAPALI — istek "kaldır"dı; ⚠️ eski donmuş çekiler de yeniden basılınca bu satırı artık BASMAZ, bilinçli) · **kumaş adı + TÜM renkler üst bloğu** (`sections.fabricHeader`, OPT-IN; payload DEĞİŞMEDİ, alanlar snapshot'ta zaten vardı) · **grid grup sayısı 3/4/5** (`gridGroups`, varsayılan 5 = fiziksel form; A5'te punto büyütmenin tek yapısal yolu — 15 kolon 132mm'ye sığmıyor). Ayrıca panelde **kenar boşluğu artık kenar kenar** (üst/sağ/alt/sol) ve önizlemede **sayfaya sığma göstergesi** var.
> • ⚠️ **DÖRT KAPI BİRLİKTE GÜNCELLENİR, yoksa ayar SESSİZCE kaybolur:** ① `system-setting.DocumentConfig` tipi · ② `sanitizeDocumentsConfig` kayıt kapısı · ③ **`printed-document.controller.docConfigSchema`** (bir `z.object`tir, tanımadığı anahtarı hata vermeden ATAR → ayar kaydedilir, GERÇEK BASKIDA görünür, ama Belge Şablonları ekranının canlı önizlemesinde GÖRÜNMEZ; "önizleme = gerçek baskı" sözleşmesi ayarı yapan kişinin gözü önünde bozulur) · ④ Electron `documentConfig.ts` aynası. Bu iş sırasında ③ gerçekten atlanmıştı ve mekanik bekçiye bağlandı; aynı boşluktan geçmiş `columns.shown` da kapatıldı.
> • ⚠️ **Şablon literali içinde BACKTICK kullanma** (CSS yorumlarında bile) — JS template literal'ını ortadan böler, dosya derlenmez. Projede yazılı bir kural; bu iş sırasında iki kez ısırdı.
> • **Migration YOK · izin YOK · APK YOK** (mobil aynı backend HTML'ini basar) — **backend + Electron aynı pencerede**. Bekçiler: `scripts/test_doc_density_fields.ts` (107 kontrol, **altı negatif sondayla** kırmızı verdiği doğrulandı) · `scripts/test_fason_ceki_html.ts` (51 → **150 kontrol**, **yedi negatif sonda**).
> • **SAYFA BAŞINA TOP ADEDİ AYARLANIR — varsayılan 100 → 50 (2026-08-06, kullanıcı kararı).** Grid `5 grup × 20 satır = 100` ile sabitti; artık `gridRows` (1–40) de ayarlanıyor ve **sayfa başına top = `gridGroups × gridRows`** (varsayılan 5 × 10). Gerekçe: hücreler VERİ değil, **elle doldurulan boş kutulardır** ve tipik bir sevkte 100 kutunun çoğu boş basılıyordu. Panel tek kutu değil **sonucu** gösterir ("= sayfa başına 50 top"), çünkü kullanıcının önemsediği sayı odur. **Sözleşme:** sayı olan değer aralığa KIRPILIR, sayı olmayan değer varsayılana düşer — ikisi de baskı yolunu düşürmez.
>   - ⚠️ **ESKİ DONMUŞ ÇEKİLER DE ETKİLENİR** (anahtar taşımayan snapshot varsayılana düşer): 2026-08-06 öncesi bir çeki yeniden basılınca 100 değil 50 kutu çizilir ve 60+ toplu sevk iki sayfa olur. Bilinçli — topların kendisi, metrajı ve toplamı birebir aynı basılır; değişen yalnız boş kutu sayısıdır. Geçmiş görünümü birebir isteniyorsa çözüm varsayılanı geri almak değil, o belge için `gridRows: 20` yazmaktır.
>   - ⚠️ **KAYIT KAPISI BEKÇİSİZDİ:** `sanitizeDocumentsConfig`'ten `fields`/`placements`/`gridRows` silinse **hiçbir test kırmızı vermiyordu** (negatif sondayla ölçüldü) — yani "dört kapı" kuralının saklama ayağı yazılıydı ama korunmuyordu. `test_fason_ceki_html` §18 o kapıyı artık gerçek round-trip ile doğrular. Yeni bir `DocumentConfig` alanı eklerken §17 (önizleme şeması) ve §18 (kayıt kapısı) İKİSİ de genişletilir.
>   - ⚠️ **Slot kontrolleri `hasSlot` ile KESİN eşleşir:** düz `includes(">100<")` metraj hücresinden de eşleşiyordu ve "slot 100 var" testi varsayılan 50'ye indiği hâlde **yanlış sebeple yeşil** kalmıştı. Grid slot numarası yalnız `c-top` hücresinde durur.

> ⚠️ **PROFİL GERÇEĞİ:** Kaldırma bu kurulumun kullanıcı kararıdır, ürün kısıtı değil; başka fabrikada yeniden istenirse karar yeniden verilir. Taşınabilir olan tek şey tuzak: `findInPage` seçeneğindeki `findNext` "SONRAKİ eşleşme" değil "YENİ OTURUM BAŞLAT" demektir.

> **NOT (2026-08-06 — SAYFA İÇİ ARAMA (Ctrl+F) KALDIRILDI):** Uygulama içi metin araması (Chromium `findInPage` + arama çubuğu) yazıldı ve **aynı gün tamamen geri alındı** (kullanıcı kararı). Kayıt aramak için listenin kendi arama kutusu kullanılır — o sunucuya sorar ve TÜM kayıtlara bakar; sayfa içi arama yalnız o an DOM'da olan satırları görebildiği için zaten kısmi cevap veriyordu. Yeniden denenirse bilinmesi gereken tuzak: **Electron'un `findInPage` seçeneğindeki `findNext`, "sonraki eşleşme" DEĞİL "YENİ OTURUM BAŞLAT" demektir** (belge: *true for initial requests, false for follow-up*) — ters yazılınca hata vermez, `found-in-page` olayı hiç doğmaz ve çubuk ekranda duran kelimeye bile "0/0" der.

> **NOT (2026-08-06 — YETKİ DENETİMİ: rol şablonları da KODA taşındı; "izin DB'ye gelir ama kimseye ATANMAZ" boşluğu artık görünür):** Yetkilendirme baştan sona denetlendi. **Mekanik taraf temizdi**: katalog 67 ↔ DB 67 (ölü izin yok, kodda geçip katalogda olmayan yok) ve 496 uçtan 473'ü izin guard'lı — guard'sız 23'ün hepsi meşru (login/self-servis, cihaz el sıkışması, dinamik `DOC_PERMISSIONS`, anahtar-kapsamlı `flagWriteGuard`). Kırık olan **İÇERİK** tarafıydı ve iki ayrı yerden kanıyordu.
> • **Şablonlar `seed.ts`'te yaşıyordu ve seed yalnız ilk kurulumda koşar** — izin kataloğunun 2026-08-01'de kapattığı deliğin birebir ikizi. Ölçüm: canlı fabrikada **"Admin (Tam Yetki)" 55 izin, katalog 67** → o şablonla açılan yeni yönetici 12 yetkiyi ALMIYOR ve bunu hiçbir yerde göremiyordu. Çözüm aynı üç parça: **tek kaynak `constants/role-template-catalog.ts` → boot uzlaştırma `jobs/role-template-catalog.job.ts` (izinlerden SONRA, aynı zincirde — FK sırası) → bekçi `scripts/test_role_template_catalog.ts`**. Detay + tuzaklar: `Teks-Erp/CLAUDE.md`.
> • **Masaüstü rolü HİÇ YOKTU** (16 şablonun 15'i tek-ekran mobil) → üç büro kullanıcısı **birebir aynı 40 izinle** fiilen süper kullanıcıydı. Sekiz rol eklendi: Üretim Planlama · Depo & Sevkiyat · Muhasebe · Satış/Sipariş · Kalite · Belge & Etiket Tasarımı · **Üretim Süpervizörü** · Sistem Yöneticisi. **Görev ayrılığı (SoD) kodda ZATEN vardı ama kimse kullanmıyordu** — `shipping:write` (sevk eden) ≠ `shipping:invoice` (faturalayan) ≠ `shipping:undo-dispatch` (resmi çıkış belgesini iptal eden), ve `roll:manual-adjust` günlük iş değil süpervizör yetkisi. Bu üçü bilinçli olarak yalnız Muhasebe/Süpervizör rollerinde.
> • ⚠️ **Uzlaştırma İZNİ getirir, ATAMAZ** — kural değişmedi (*katalog koda, atama panele*) ve tam da bu yüzden sessizdi: canlıda **7 izin hiçbir kullanıcıda yoktu** (`document-template:read/write`, `settings:workstation`, `roll:history`, `shipping:undo-dispatch`, `mobile:kumas`, `mobile:siparis`) — yani o ekranlar deploy edilmiş ama **kimse açamıyordu**, `admin` dahil. Boşluğu gösteren tek yüzey artık **Yetki Kataloğu ekranındaki "N yetki hiçbir kullanıcıda yok" bandı** + satır başına kullanıcı/rol sayacı (`listPermissions` → `userCount`/`templateCount`). Yeni bir izin eklerken bu bandı kontrol et; atama hâlâ bilinçli bir karardır.
> • ⚠️ **Sistem rolü SİLİNMEZ, PASİFLEŞTİRİLİR** — sert silme bir sonraki `pm2 restart`'ta **diriliş** demekti. Kimlik `permission_templates.code`'dur (ad DEĞİL: fabrika yeniden adlandırırsa ada bakan uzlaştırma ikizini doğururdu); `code = null` fabrikanın kendi şablonudur ve uzlaştırma ona hiç dokunmaz. Migration `20260806040111_permission_template_code` (nullable kolon → metadata-only).
> • **Mevcut kullanıcıların yetkilerine DOKUNULMADI** (ürün kararı): canlı fabrikada daraltma ayrı ve bilinçli bir adımdır. Roller hazır duruyor; kimin hangi rolü alacağı panelden verilir.

> ✅ **ÇEKİRDEK:** `readIdCondition`/`readFilterList` tek kaynağı, üç arıza modu (P2007 · sessiz 0 satır · **filtre sessizce DÜŞER → YANLIŞ liste**), "backend ÖNCE" deploy sırası ve "iki değerli NOT NULL enum'da çoklu seçim gürültüdür" — hepsi fabrikadan bağımsız; MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-06 — FİLTRELERDE ÇOKLU SEÇİM: "CSV de bir string'dir" ve üç ayrı arıza modu):** Electron `FilterBar` çoklu seçimi `filter[colorId]=a,b` (CSV) olarak yollar. Jenerik yol (`buildWhereClause`) CSV'yi zaten `{ in: [...] }`'e çevirir — **ama büyük liste servisleri filtreyi ELLE okur** ve hepsi `typeof v === "string"` diyordu; CSV de bir string olduğu için ham geçiyordu. Tek kaynak artık **`utils/query-parser.readIdCondition`** (+ `readFilterList`): hiç değer → `null` · tek değer → **düz eşitlik** (mevcut `where` şekli bayt-bayt korunur) · N değer → `{ in: [...] }`. Elle okunan HER id filtresi oradan geçmeli.
> • ⚠️ **ARIZA MODU KOLON TİPİNE BAĞLI — "sessizce boş liste döner" diye genelleme YANLIŞ** (üçü de negatif sondayla ölçüldü): ① **uuid kolon** (itemId/colorId/customerId/subcontractorId…) → Postgres `invalid input syntax for type uuid` → Prisma **P2007** → `error.middleware` bunu **HTTP 400 + "Geçersiz veri formatı (örn. hatalı ID). Gönderilen değerleri kontrol edin."** mesajına çevirir (⚠️ servisi doğrudan çağıran bekçilerde ham Prisma hatası görülür, middleware devrede değildir — "500" sanma); ② **uuid olmayan string kolon** → **sessiz 0 satır** (`foldType` emsali, kendi bekçisinde); ③ **ön-süzgeçli alan** (`currentStationId`, UUID regex'inden geçiyor) → regex Prisma'dan ÖNCE çalıştığı için CSV elenir ve filtre **sessizce DÜŞER**, liste **filtresizmiş gibi** döner. Üçüncüsü en tehlikelisi: boş liste değil **YANLIŞ liste**, hata yok, log yok (ölçüm: iki istasyon seçilince 2 yerine **6 satır**).
> • ⚠️ **DEPLOY SIRASI PAZARLIK DIŞI — bu ①'in sahadaki tam karşılığıdır.** Yeni panel + ESKİ backend = çoklu seçilen HER lookup filtresinde *"Geçersiz veri formatı (örn. hatalı ID)"* 400'ü (2026-08-06'da canlı sunucuya karşı gözlendi). Backend ÖNCE deploy edilir; panel sonra. Tersi çalışır (eski panel CSV göndermez), aynı anda da çalışır — kabul edilemez olan yalnız "panel önde, backend geride" hâlidir.
> • Dokunulan yerler: `inventory.buildRollWhere` (itemId · colorId · currentStationId · subcontractorId · subcontractorCategoryId) · `order.extraWhere` (itemId · colorId — çoklu seçimde de **TEK `lines.some` bloğu** kalır, yani kumaş ∈ seçilenler VE renk ∈ seçilenler AYNI kalemde eşleşir) · `kartela` (liste `subcontractorId`, `getStock` itemId/colorId) · `production-balance.getBalance` (itemId). **İş Emirleri · Sevkiyatlar/Muhasebe · İadeler ek backend işi İSTEMEDİ** — o alanlar zaten `buildWhereClause` yolundan geçiyordu.
> • ⚠️ **ÇOKLU SEÇİM HER FİLTREYE UYMAZ; bilinçli TEKİL bırakılanları geri çevirmeden önce gerekçeyi çürüt.** **`destination`** (Sevkiyatlar + Muhasebe): NOT NULL + iki değerli → ikisini seçmek "filtre yok" ile aynıdır, yani hiçbir şey kazandırmaz; üstelik **zararlıdır** — `listShipments` "destination filtresi aktif mi" sorusuna `!= null` ile bakıp **DirectShipment'ları union'dan DÜŞÜRÜR** (o tabloda bu kolon yok), yani "ikisini de seç" diyen kullanıcı fasondan doğrudan sevkleri sessizce kaybederdi. **`WorkOrder.type`** aynı gerekçeyle tekil. **Kontrast — `foldType` ÇOKLU:** kat NULL olabildiği için "2-KAT + 4-KAT" gerçekten *"katı belirlenmiş toplar"* demektir. Kural: **iki değerli NOT NULL enum'da çoklu seçim gürültüdür; nullable alanda anlamlıdır.**
> • **Kapsam anahtarlarına DOKUNULMAZ:** `processingStatus` · `rollScope` · `shipmentScope` · `rollKind` · Çuvallar `scope` · Kartela `status` · Ürün Dengesi `status` · `invoiced` · `hasReturns`. Bunlar birbirini **DIŞLAYAN** if/else dallarıdır, OR semantiği yoktur; çoklu seçim kullanıcıya anlamsız kombinasyon vaat eder.
> • `dependent-lookup` (Şube) üst filtresi çoklu olabilir ve **ek kod GEREKMEDİ**: ham CSV `fetchOptions`'a aynen geçer, `/api/customer-branches` BaseService üzerinden `in`'e çevirir. Ama tekil id çözen yardımcılar kırılır — `useFasonScopeLabel` CSV'de `find(id)` ile `undefined` bulup rozeti filtre AKTİFKEN sessizce "Fasonda"ya düşürüyordu (artık tek seçimde AD, çok seçimde "N firma"; react-query anahtarı da `filter-lookup-multi` ile hizalandı, ayrışırsa aynı veri iki kez çekilir).
> • Migration YOK · izin YOK · APK YOK (mobil dokunulmadı) — **backend + Electron aynı pencerede** gitmeli (eski backend + yeni panel = uuid 500'leri). Bekçi: `scripts/test_filter_multi_select.ts` (28 kontrol; **iki negatif sondayla** kırmızı verdiği doğrulandı — `readIdCondition` eski hâline çevrilince P2007 ile çöktü, istasyon süzgeci tek-string'e çevrilince 2 yerine 6 satır döndü). Yeni bir liste yüzeyi eklerken bekçiye de satır ekle.

> ⚠️ **PROFİL GERÇEĞİ:** "Bugün fabrikada içeride yapılan bir proses yok" (KAPSAM DIŞI maddesi) ve `appliesColor=false` göçü bu kurulumun topolojisidir — iç boyahaneli/dokuma profilinde bu varsayım düşer. **Bu not aynı zamanda kalite-yetenek dönüşümünün (§5.1) ÖNCÜLÜDÜR:** renk ve özellik istasyon TÜRÜnden YETENEĞE taşındı, kalite üçüncüsü oldu — `Station.appliesQuality` **2026-09-03'te indi** (P4 Faz A; ikiz boğaz `stepCanApplyQuality` + `QUALITY_STATION_WHERE`), Faz B açık — bkz. MODUL-BAYRAK-TASARIM §5.1, UYGULAMA-PLANI P4.

> **NOT (2026-08-10 — ÜRETİM KARAKTERİSTİĞİ: kat KATALOĞA taşındı + istasyon-özellik DAVRANIŞ MODU + istasyon yeteneği kategoriden ayrıldı):** İki saha isteği tek modelde birleşti: *"2/4-KAT yerine 6/8-KAT gelince bunu üretim özelliğinden seçebilelim, Tambur'un önüne o iki seçenek gelsin"* ve *"bir özelliğin uygulanıp uygulanmadığı istasyon ekranında olsun — basması gereksin, gerekmesin ya da otomatik basılmış sayılsın"*. Sektör karşılığı SAP **Classification** (karakteristik + değer kümesi) ve rota operasyonundaki **Control Key** (onay zorunlu/opsiyonel/otomatik). Migration'lar: `20260809232529_property_value_type_and_station_mode` + `20260810010330_station_capability_flags`.
> • **KAT ARTIK KATALOG SATIRIDIR.** `FabricProperty.valueType` (BAYRAK|SEÇİM) + yeni `FabricPropertyValue` tablosu. Kat = `code:"KAT"`, tip SEÇİM, değerleri `2-KAT`/`4-KAT`/`TUP`. Fabrika `6-KAT`'ı panelden ekler; **sürüm gerekmez** (ilk dağıtımdan sonra). Öncesinde izin verilen değerler **dokuz yerde literal diziydi** ve `tambur.controller` `z.enum` ile 2/4-KAT'a kilitliydi.
> • ⚠️ **DEĞER KOLONDA SAKLANIR, PİVOTTA DEĞİL.** `Roll.foldType` / `WorkOrder.foldType` / `ProductRecipe.foldType` **aynen kalır**; katalog yalnız *"hangi değer geçerli + hangi istasyon sorar"* der. `RollProperty` bir **KÜME** modelidir (`@@unique([rollId,propertyId])`, değer kolonu yok) ve bir topa hem 2-KAT hem 4-KAT yazılmasını engelleyemez. İkinci bir SEÇİM tipli özellik doğduğunda ya kendi kolonunu ister ya pivota `valueId` eklenir.
> • ⚠️ **KOD ASCII OLMALI** (`TUP`, `TÜP` DEĞİL; görünen ad "Tüp" kalır). Türkçe karakterli kod, ASCII yazan her istemciyi sessizce reddettirir — ölçüldü: `test_recipe` "TUP" gönderip "TÜP" koduna takıldı. Karşılaştırma `toUpperCase()` ile, **`toLocaleUpperCase("tr")` DEĞİL** (2026-08-02 etiket `showIf` dersinin aynısı). Backend + panel + bekçi üçü de kuralı uygular.
> • ⚠️ **BİÇİM ile GEÇERLİLİK AYRI FONKSİYON.** `normalizeFoldType` (senkron, Zod içinde) yalnız `"4 kat" → "4-KAT"` yapar; `resolveFoldTypeForWrite` (asenkron, serviste) katalogla doğrular. Regex `[24]` → `\d+` genelleştirildi — yoksa katalog 6-KAT'ı öğrense bile `"6 kat"` normalleşmez, eşleşme kaçar ve değer ham geçerdi. **Katalog boşsa FAIL-OPEN** (göç koşmamış kurulumda iş emri açmak ve Tambur finalize durmasın). **Pasif değer yazmada KABUL EDİLİR** (katalogdan kaldırılan katı taşıyan eski iş emri düzenlenebilsin), seçici listesinde görünmez.
> • ⚠️ **SEÇİM tipli özellik HEDEF-ÖZELLİK seçicilerinden SÜZÜLÜR** (`isTargetableProperty` tek kaynak): rota adımı chip'leri, WO hedefleri, ürün izinli listesi, sipariş satırı. Sızsaydı planlamacı "Kat"ı işaretler (hangi kat?) ve `workorder.service`'in kapsama guard'ı iş emrini reddederdi. Panelde react-query anahtarı da ayrıldı (`fabric-properties/targetable`) — süzülmüş liste, ham liste bekleyen `RouteEditor`/`CapabilitiesEditSheet` ile aynı anahtarı paylaşıyordu.
> • ⚠️ **METRE SAPMASI KAPATILDI (en tehlikelisi).** `meterPeripheralFor` şöyleydi: `foldType === '4-KAT' ? '4-KAT' : '2-KAT'` — üçlü bir kararı ikiliye indiriyordu. 6-KAT eklendiği an 6 katlı top **2-KAT metresiyle** ölçülürdü: hata yok, log yok, yalnız yanlış metraj (aynı sapma bugün "TÜP"te de vardı). Artık rol **birebir** eşleşir; eşleşme yoksa **başka cihaza SAPMAZ**, `null` döner ve ekran "elle girin" der. Rolsüz cihaza düşme dalı da kaldırıldı. Yeni kat = katalog satırı **+ cihaz satırı**; ikincisi unutulursa özellik yarım çalışır ve ekran bunu söyler.
> • **İSTASYON-ÖZELLİK MODU (`StationProperty.mode`): AUTO | OPTIONAL | REQUIRED.** AUTO → operatöre sorulmaz, adım kapanınca yazılır · OPSİYONEL → tuş çıkar, işaretlenirse yazılır · ZORUNLU → işaretlenmeden adım kapanmaz. **Varsayılan OPSİYONEL** ve bu, şemanın kendi uyarısını kapatır: eskiden istasyona eklenen her özellik oradan geçen HER TOPA sessizce yazılıyordu.
> • ⚠️ **MOD ÇALIŞMA ZAMANINA AİT, PLANLAMAYA DEĞİL.** *"Bu istasyon bu özelliği VEREBİLİR mi"* sorusunun cevabı satırın **VARLIĞI**dır; mod yalnız *"nasıl teyit edilir"* der. OPTIONAL satırı kapsama dışı saymak, rotada zımpara adımı dururken ZIMPARALI hedefli iş emirlerini 409'a düşürürdü.
> • ⚠️ **KURŞUN BYPASS ATAMASI ARTIK `AUTO` ARAR** — satırın varlığı yetmez. Bypass'ta tablet salt-okunurdur, işaretleyecek operatör YOKTUR; OPTIONAL bir KURSUN satırı kapanışta topa hiç yazılmaz ve `computeWorkOrderLocks` "bu özelliği veren adım tamamlandı" derdi (kilit modeli sessizce yalan söylerdi). Göç `KURSUN_KK2/KURSUN`'u AUTO'ya çeker; **atlanırsa kurşun özelliği toplara yazılmayı bırakır.** Fason istasyonlarının satırları bilinçli OPSİYONEL kalır (o yolda `copyStationCapabilitiesToRoll` hiç çağrılmıyor; toplu AUTO işaretlemek iç boyahane akışı yazıldığı gün 7 özelliği sessizce yazdırırdı).
> • **İSTASYON YETENEĞİ KATEGORİDEN AYRILDI** — `Station.appliesColor` / `appliesProperty`. Eskiden bu yalnız `defaultCategory`'den türetiliyordu, yani **kategorisi olmayan bir İÇ istasyon tanım gereği "renk veremez"di**; iç boyahane/iç zımpara senaryosunun önündeki asıl engel buydu. ⚠️ Göçte **iç istasyonlara `appliesColor=FALSE`** yazıldı: eski kural `hasDefaultCategory && canApplyColor` bileşiğiydi ve kategorisiz istasyonda sonucu **false**'tu; `true` yazmak Tambur/Kurşun adımına renk yazılmasına izin verirdi (2026-08-06 uyarısı). Bayrak dürüstleşince bileşik koşul **dört dosyada** tek bayrağa indi.
> • ⚠️ **TEK YÜKLEM `stepCanApplyColor` / `stepCanApplyProperty`** (`helpers/step-capability.helper`): *adım verebilir ⇔ İSTASYON verir VEYA o adımda seçilen FASON HİZMETİ verir*. Rota adımı hedefi, WO kapsama guard'ı ve renk kilidi ONU paylaşır. `workorder.service`'teki guard artık *"rotada fason kategorisi var mı"* değil *"renk/özellik VEREBİLEN adım var mı"* diye sorar — tümü-iç rotalı hedefli iş emri artık **açılır** (eskiden 400). Guard create + replace'te **kopyalanmıştı**, tek fonksiyona indi.
> • ⚠️ **FASON KABUL KATEGORİDEN OKUMAYA DEVAM EDER** (`subcontractor.service`). İki ayrı soru: istasyon bayrağı *planlama* ("bu adım renk verebilir mi"), kategori bayrağı *çalışma zamanı* ("satın alınan bu hizmet renk uyguladı mı"). Birleştirme; bekçi ayrımı kaynak taramasıyla kilitler.
> • **KAPSAM DIŞI (bilinçli, ayrı iş):** iç istasyonun **operatör akışı** — tablet ekranı, adım başlat/bitir, topun ilerlemesi, yeni `RollOperationType`, yeni `mobile:*` izni. Bugün fabrikada içeride yapılan bir proses yok (kullanıcı kararı); model kuruldu, akış yazılmadı. Referans: `KursunQcScreen` 3.024 satır, `TamburScreen` 8.236 satır — genelleştirme ayrı bir iştir.
> • **DEĞER TAŞIYAN ÖZELLİK (2026-08-11) — kat artık tek örnek değil.** Saha isteği: *"kurşuna 25/50/75 gr tuşları koyalım, operatör '50 yaptım' desin"*. `RollProperty.valueId` (nullable FK → `FabricPropertyValue`) eklendi; `@@unique([rollId, propertyId])` KORUNUYOR ve **dışlayıcılığın kendisi odur** — bir topa aynı özellikten iki değer yazılamaz, düzeltme ÜSTÜNE yazar. Sözleşme `propertyIds: string[]` → **`properties: [{propertyId, valueCode?}]`** (branch sahaya çıkmadığı için geriye uyum yükü yok). Dört kural, dördü de bekçide: SEÇİM'de değer ZORUNLU · katalog dışı/pasif değer 400 · BAYRAK'a değer 400 (sessizce yutulmaz) · **SEÇİM özelliği AUTO moda ALINAMAZ** (AUTO "sorulmaz" demek; sistem 25 mi 50 mi olduğunu kendi seçemez). Değer taşımayan çağrı MEVCUT değeri SİLMEZ (bypass kapanışı emsali). FK **RESTRICT**: kullanılan değer satırı silinemez (zaten pasifleştiriliyor). Panel rozetinde değer BASILIR ("Gramaj: 50 gr") — hem listede hem detayda; yoksa operatörün tablette yaptığı seçim panelde okunamaz kalırdı. ⚠️ Kat bu yolu KULLANMAZ: değeri `Roll.foldType` kolonunda, çünkü filtrelenip sıralanıyor. Bekçi: `scripts/test_property_value_selection.ts` (27 kontrol; ALTI negatif sondayla kırmızı verdiği doğrulandı — değer yazımı körleşince 5, BAYRAK kontrolü kalkınca 1, Düzelt/hedef replace'leri körleşince 4, kesim mirası değere körleşince 1, Zod alanı silinince 2).
> • **SEKTÖR DENETİMİ (2026-08-11, aynı branch) — 24 doğrulanmış bulgu, hepsi kapatıldı.** 5 mercekli çapraz-doğrulamalı denetim; altı kök neden:
>   - ⚠️ **REPLACE'LER DEĞER-FARKINDA OLDU (F1 — en kritik).** "Roll.properties = hedef listesinin kopyası" varsayımı değer modeliyle bozuldu: SEÇİM satırını (GRAMAJ=50GR) İSTASYON OPERATÖRÜ yazar, hedef listesi değil. Düzelt (`applyManualProperties`) ve `updateTargetProperties` artık **yalnız BAYRAK satırlarını** replace eder (`property: { valueType: "FLAG" }` süzgüsü + create tarafında `partitionTargetableIds`); koşulsuz replace, planlamacı hedefe her dokunduğunda operatör seçimini sessizce silerdi. `propertyIds=[]` bile CHOICE satırına dokunmaz.
>   - **CHOICE HEDEF OLAMAZ — İKİ KATMAN.** Aktif seçim yapan 9 kapı (`WO create/replace/updateTargetProperties` · KK1 girişi · sipariş kalemi · rota adımı · ürün izinli ×2 · fason kabul) `assertTargetablePropertyIds` ile **adıyla 400**; mevcut listeyi geri yollayan echo uçları `partitionTargetableIds` ile **sessizce böler** (echo'yu 400'lemek, GRAMAJ'lı topun renk düzeltmesini imkânsız yapardı). İstemci süzgüleri: Electron `isTargetableProperty` + `PropertyChipsField valueType:"FLAG"` · mobil `useQuickWorkOrder` picker süzgüsü + `chooseRoute` planProps süzgüsü (rota select'i `valueType` döner; eski backend alanı göndermez → süzgü devreye girmez).
>   - **TİP GEÇİŞ KİLİTLERİ (F5/SEK-3):** `KAT` sistem karakteristiğidir, tipi HİÇ değiştirilemez · CHOICE→FLAG değer listesi/kullanım varken 400 · FLAG→CHOICE AUTO bağı varken (istasyon adıyla) / hedef pivotlarında kullanılırken / values'suz 400. `assertChoiceHasValues` sayacı yazma yolunun `isActive ?? true` varsayımıyla hizalandı (isActive'siz gönderen istemci sahte 400 yiyordu).
>   - **SOYAĞACI valueId TAŞIR (F6):** Tambur kesim çocukları (4 yol) + finalize + undo geri-kurulumu + fason kısmi sevk çocuğu — hepsi `valueId`'yi kopyalar; düşürülseydi çocuk "gramajı belirsiz" doğardı.
>   - **GÖRÜNÜRLÜK (VAL-02/03/04):** relabel-context `properties[].value` taşır → Düzelt diyaloğu SEÇİM'i salt-okunur çip basar ("GRAMAJ: 50 gr", değer istasyonda seçilir); mobil Tambur karar başlığı + Depo kartı çipleri değeri basar. `CapabilitiesEditSheet`'te CHOICE satırının AUTO tuşu disabled (backend zaten 400 — kilit hatayı Kaydet'e saklamamak için).
>   - ⚠️ **TAMBUR_1/KAT MODU OPTIONAL (SEK-5) — REQUIRED yalancı beyandı:** Tambur akışı capability kapısını HİÇ çağırmıyor (kat kolon-projeksiyon istisnası; UI zorunlu sorar, backend eski-APK sözleşmesi gereği null fallback kabul eder). Seed'ler OPTIONAL yazar; eski seed'le koşmuş kurulumda tek seferlik UPDATE (deploy dokümanı §11). **Yazılı ayrım:** *İSTASYON ekranı yeteneği adım payload'ından (Kurşun/QC2 → open-cards `stepSummary.properties`), PLANLAMA ekranı katalogdan (Tambur kat tuşları + Hızlı İş Emri → `code=KAT`) okur.* `GET /station-capabilities/for-session` bugün İSTEMCİSİZ — yorum + Swagger bunu açıkça söyler, "buradan çiziliyor" diye okuma.
>   - **Cila:** completeQc2 tekrar-basışta FARKLI seçim gönderilirse artık audit'lenir (`UPDATE` + `reappliedSelections` — değer düzeltmesi kayıtsız kalmaz); kursunFinish audit'i `selections` taşır; üç ucun Swagger'ı mod+değer sözleşmesini anlatır; `schema.prisma`'nın "kat serbest metin" / "değer RollOperation metadata'ya yazılır" bayat yorumları düzeltildi.
>   - Bekçiler: `scripts/test_property_targetable.ts` (22 kontrol — 9 kapının kaynak taraması körlük zeminli + WO/rota/ürün işlevsel 400'ler + geçiş kilitleri; **iki negatif sondayla** kırmızı verdiği doğrulandı: item kapısı silinince 3, KAT kilidi kalkınca 1) · `test_property_value_selection.ts` genişletmesi (yukarıda). ⚠️ Sipariş kalemi / fason kabul / KK1 kapıları işlevsel olarak DEĞİL kaynak taramasıyla kilitli (fixture maliyeti); kapı taşınırsa sayaç güncellenmeli.
> • **Migration + veri göçü + backend + Electron + APK aynı pencerede.** Veri göçü: `scripts/seed_fold_catalog_and_modes.ts` (dry-run varsayılan). Yeni izin YOK (`station-capabilities/for-session` mevcut `MOBILE_SESSION_PERMS`'i kullanır). ⚠️ *"Değer eklemek artık sürüm istemiyor"* vaadi **bu sürümden SONRASI** için geçerli — eski APK sabit iki tuşu göstermeye devam eder. Bekçiler: `scripts/test_fold_catalog.ts` (24) · `test_station_property_mode.ts` (19) · `test_station_capability_flags.ts` (17) — üçü de negatif sondayla kırmızı verdiği doğrulandı; mobil `useMachinePeripherals.test.ts` 6→12 kontrol.

> **NOT (2026-08-09 — RAPOR TEMELİ: topun ÜRETİM ZAMANI artık şemada; Kalite Karnesi):** Rapor denetiminde çıkan kök sorun: **her dönem-bazlı rapor "bu top ne zaman bitti" sorar ve bu bilgi şemada HİÇ YOKTU.** `Roll` yalnız `createdAt`/`updatedAt`/`cancelledAt`/`labelPrintedAt` taşıyordu; `finalizeRollsAtLastStep` topu WAREHOUSE'a çekerken hiçbir damga yazmıyordu; hareketten türetmek de **çalışmıyordu** (ölçüm: bitmiş topların HİÇBİRİNDE kapanmış `RollMovement` yok — Tambur kesim çocuğu ve elle eklenen top hiç hareket görmez, ebeveyni görür). Geriye tek seçenek `updatedAt` kalıyordu ve o **yasaklı** ("Buraya geliş ≠ oluşturma" notu: etiket yeniden basımı / not düzenlemesi de günceller). Fire raporu bugüne kadar tam o kumun üstündeydi. Migration `20260809090000_roll_production_timestamps` (iki nullable timestamptz → metadata-only).
> • **`Roll.finalizedAt`** = topun üretimden çıkıp nihai rafına girdiği an — kalite/fire/fason karnelerinin dönem çıpası. **`Roll.statusChangedAt`** = her statü geçişinde tazelenir; stok yaşlandırma/FIFO'nun (CLAUDE.md'nin "ayrı kolon gerekir" dediği şey) çıpası. **İkisini karıştırma:** yaşlandırma *"kaç gündür bu rafta"*, karne *"ne zaman üretildi"* sorar. `statusChangedAt`'e index BİLİNÇLİ eklenmedi (tüketicisi Stok Karnesi henüz yazılmadı; `rolls` zaten en çok indeksli tablo).
> • ⚠️ **YAZAN BİR TRIGGER'DIR, uygulama kodu DEĞİL** (`roll_stamp_production_timestamps`, BEFORE INSERT OR UPDATE). Gerekçe: `Roll.status`'e yazan **40+ çağrı noktası** var; birini atlamak raporda **sessiz eksik** demek (hata yok, log yok, o toplar hiçbir dönemde görünmez). Trigger atlanamaz — ham SQL bile geçemez — ve tek satır uygulama kodu değiştirmediği için mevcut yolların hepsi bayt-bayt aynı kaldı. Envanter + bekçi: `scripts/test_db_invariants.ts` **§6** (yeni bölüm; Prisma trigger'ı şemada temsil edemez → diğer şema-dışı nesnelerden farkı: partial index kaybolursa sorgu yavaşlar, **trigger kaybolursa veri hiç yazılmaz**).
> • ⚠️ **KAYNAK STATÜ LİSTESİ LOAD-BEARING.** Damga yalnız üretim tarafı statüden (`IN_PRODUCTION`/`STOCK`/`AT_SUBCONTRACTOR`/`RETURNED_FROM_SUBCONTRACTOR`) final statüye (`WAREHOUSE`/`A1_STOCK`/`SCRAP`) geçişte yazılır. **`SHIPPED` ve `CANCELLED` bilerek DIŞARIDA:** `SHIPPED → WAREHOUSE` sevk storno/iadesidir ve içeride olsaydı bir storno, aylar önce üretilmiş topu **BUGÜNÜN** karnesine sokup iki dönemi birden yanlışlardı. Doğrulandı (negatif sonda: SHIPPED listeye eklenince bekçi kırmızı).
> • ⚠️ **DAMGA ÜZERİNE YAZILIR (write-once DEĞİL).** Depo topu yeni bir iş emrine girip tekrar finalize olursa tazelenir — çünkü `qualityGradeId` de tazelenir. Sabitlenseydi top **ESKİ tarihle YENİ kaliteyi** taşırdı. Invariant: *`finalizedAt` her zaman mevcut `qualityGradeId` ile AYNI olaydan gelir.*
> • **Geçmiş `system_logs`'tan kurtarıldı:** `scripts/backfill_roll_production_timestamps.ts` (dry-run varsayılan, idempotent, **ham SQL ile yazar** — Prisma `update` `updatedAt`'i tazeler ve envanter sekmelerinin "Son İşlem" sıralaması tam o kolondan çözüldüğü için script SAHADAKİ HER LİSTEYİ yeniden sıralardı). Kuralı trigger ile **birebir aynı** olmak zorunda; ayrışırsa rapor backfill'in bittiği gün sessizce zıplar. İzi bulunamayan toplar tek tek **listelenir** (gizlenmez).
> • **KALİTE KARNESİ** (`GET /api/reports/quality/scorecard`, `report:quality`) — metraj ağırlıklı kalite dağılımı; kırılım kumaş × renk × fason × gün; dönem karşılaştırmalı. **Ölçü METREDİR, adet değil** (1000 m 1. kalite ile 5 m 2. kaliteyi 1'e 1 saymak oranı anlamsız yapar). Kapsam `K18_DEAD_STATUSES` dışlar (tüketilmiş ebeveyn metrajını çocuklarına devretti → ikisini de saymak aynı kumaşı iki kez saymak) ama **`SCRAP` DIŞLAMAZ** (fire gerçek bir üretim sonucudur ve karnenin ölçmesi gereken şeydir).
> • ⚠️ **"1. KALİTE" KODA GÖMÜLMEZ.** Başlık metriği *"katalogda en üst sıradaki kalitenin payı"*dır ve `quality_grades.sortOrder`'dan çözülür; ekran başlığını da o addan yazar. `code === "1.KALITE"` araması bu fabrikada çalışır, kaliteyi yeniden adlandıran fabrikada **sessizce boş karne** üretirdi. Bekçi bunu kaynak taramasıyla mekanik doğrular.
> • ⚠️ **FASON ATFI ÜÇ KOVALIDIR.** Ölçüm: fason dönüşünde doğmuş 21 topun yalnız 6'sında `parentReceiptId` dolu. Yalnız JOIN'e bakılsaydı kalan 15 top **"Fabrika içi"** satırına yazılırdı — eksik veri değil **YANLIŞ ATIF**: fasonun ürettiği kaliteyi fabrikanın hanesine yazmak, raporun var oluş sebebi olan sorunun (hangi boyahane iyi çalışıyor) tam tersini söyler. Üçüncü kova (`Fason (firma belirsiz)`) bu yüzden var; `entrySource` sorguda **load-bearing**.
> • **GERİYE DÖNÜK DÜZELTME (restatement) BİLİNÇLİDİR:** depo topu sonradan kesilirse ebeveyn üretildiği dönemin karnesinden düşer (metrajı artık çocuklarında); kalite sonradan "Düzelt" ile değişirse eski dönem yeni kaliteyle okunur. İkisi de sektör pratiği; alternatif (aynı kumaşı iki dönemde saymak) açıkça yanlıştır. Metraj `currentQty`'dir — finalize anındaki değer saklanmıyor.
> • **DÖNEM KARŞILAŞTIRMA ortak katmanda** (`reports/_shared.resolveCompareRange`): `prev` (aynı uzunlukta hemen önceki pencere — takvim ayı DEĞİL, çünkü kullanıcı 12 günlük aralık seçebiliyor) · `prevYear` (**takvim** yılı kaydırması, 365 gün değil) · `custom`. `prev`'in bitişi ana dönemin başlangıcından **1 ms önce** — iki pencere bitişik ama çakışmaz; çakışsaydı tam da ölçülen fark bozulurdu. Karşılaştırma istenmezse ikinci sorgu **hiç koşmaz**.
> • **EXPORT: TEK SPEC → ÜÇ ÇIKTI** (`Reports/_components/reportExport.ts`). Excel · PDF · Yazdır aynı `ReportExportSpec`'ten türer; ayrı ayrı yazmak "aynı başlık altında farklı rakam" demekti (bu projede bir kez yaşandı). Bekçi kolon kümesi eşitliğini **mekanik** doğrular (`reportExport.test.ts`). Rapor PDF'i `document-render/` dünyasına **girmez** — orası müşteriye giden resmi belgelerin (donmuş snapshot/versiyon/revizyon) alanı; karıştırılırsa ikisi de zarar görür.
> • **DÖRT KARNE DAHA + MENÜ SADELEŞTİRMESİ (aynı gün, ikinci tur).** Rapor menüsü **20 → 13**'e indi (17 kaldırıldı, 8 yeni yüzey eklendi). Yeni karneler ve her birinin kilitlediği kural:
>   - **Fire Karnesi** (`quality/scrap-scorecard`) — hurda metrajı + nedeni. **Kalite Karnesi ile AYNI evren**: `producedQty` ↔ `totalQty` birebir (bekçide kilitli), yoksa aynı ay için iki "üretim" rakamı dolaşıma girerdi. ⚠️ **İKİ ÇIPA, İKİ BİRİM**: hurda `finalizedAt` + METRE, hata tespiti `RollError.detectedAt` + ADET. Farklı birim bilinçli — toplanmaması gereken iki sayı aynı birimde basılmaz. ⚠️ Hata bağı `LATERAL … LIMIT 1`: düz JOIN, iki hatalı 100 m'lik topu **200 m hurda** gösterirdi. ⚠️ **"Kesim kaybı" metriği BİLİNÇLİ OLARAK YOK** — ölçüldü: tüketilen ebeveynin `currentQty`'si sıfırlanıyor, naif `Σ(initial−current)` **2522 m'lik hayali kayıp** raporluyordu; ebeveyn↔çocuk dengesi de tutarsız (0 metrajlı ebeveynler, açıklanamayan ±200/−50 m). Kesim-olayı kaydı doğana kadar yazılmayacak.
>   - **İade Karnesi** (`sales/return-scorecard`) — `RollReturn` verisinin Raporlar'daki İLK yüzeyi. ⚠️ **Payda BRÜT** (brüt kuralının 5. tüketicisi): net paydayla oran şişer ve **tam da en çok iade alınan dönemde en çok şişer**. ⚠️ Sebep ÜÇ DURUMLU (katalog / serbest metin / boş) ve serbest metinler TEK kovada — sayının kendisi *"katalog eksik"* sinyalidir. ⚠️ Oran KOHORT DEĞİL (bu ay gelen iade geçen ayın malı olabilir) ve bu hem ekranda hem Excel'de yazılı.
>   - **Fason Karnesi** (`subcontract/scorecard`) — sahada tartışılan rakam: **fason firesi**. ⚠️ Fire yalnız **KAPANMIŞ** kalemlerden hesaplanır; açık kalem paydaya girseydi dün sevk edilen parti %100 fire görünürdü (bekçide: %4 ↔ %68). ⚠️ Dönen metraj **TÜM** kabul satırlarının toplamıdır — mevcut `subcontract.report.service`'in `DISTINCT ON`'u orada doğruydu (bool + süre) ama metrajda 100 m'lik topun 2×48 dönüşünü 48 sayıp **52 m sahte fire** yazardı. ⚠️ Doğrudan sevk + iptal kapsam dışı. ⚠️ **KISMEN GEÇERSİZ (2026-09-11)** — doğrudan sevk artık başarılı teslim olarak kapsamda (iptal dışarıda kalır) → bkz. "2026-09-11 — Fasoncu karnesi: müşteriye giden metre BAŞARILI TESLİM…".
>   - **Sevk & Termin (OTIF)** (`sales/shipment-scorecard`) — sevk hacmi + zamanında teslim. ⚠️ **Terminsiz sipariş orana GİRMEZ ama gizlenmez**: "zamanında" saymak oranı sahte yükseltir, "geç" saymak haksız düşürür; doğru olan paydadan çıkarıp sayıyı ayrıca göstermektir (bekçide %66,7 ↔ %50).
>   - ⚠️ **"DÖNEMDE SEVK EDİLEN METRAJ" TEK TANIM: `reports/_shipped.ts`.** İade Karnesi'nin PAYDASI ile OTIF'in BAŞLIK metriği aynı sorudur; ayrı yazılsalardı biri doğrudan sevkleri, diğeri iade geri-eklemesini unuturdu. Doğrudan sevkte metraj **denormalize `totalQty`**'dir (Sevkiyatlar ekranı onu kullanır) ama kırılım topları ister → fark, kumaşı bilinmeyen bir **mutabakat satırı** olarak eklenir: toplam ekranla birebir kalır, kırılım uydurma kumaşa yazılmaz.
>   - ⚠️ **`_shipped.ts`'teki `status = 'DISPATCHED'` süzgecinin kaybını BEKÇİ GÖREMEZ** (ölçüldü, yeşil kalıyor): storno `dispatchedAt`'i NULL'ladığı için aralık süzgeci PLANNED'ı zaten eliyor. Süzgeç o invariant'a *güvenmemek* için duruyor — silmeden önce onu kimin koruduğunu bil.
>   - **Kaldırılanlar ve gerekçeleri** (tile-config dosyalarında da yazılı): Hata Türü Dağılımı · İstasyon Hata Oranı · QC2 Kararları (→ Fire Karnesi) · Kurşun Uygulama Oranı (yönetim sorusu değil; iki bağımsız sayacı oranlıyordu) · Sipariş Gerçekleşme · Geç Teslimat (→ OTIF; eskisi tarih aralığı ALMIYORDU) · Fasoncu Performansı · Açık Fason Sevkleri (→ Fason Karnesi) · Fire & Hurda (→ Fire Karnesi; eskisi günü `rolls.updatedAt`'ten alıyordu) · Makine Kullanımı (veri kapsamı ~%31 ve bu bilinçli) · Hareket Geçmişi · Alias Eşleştirme (veri hijyeni sayacı, karar değiştirmiyor). "Operatör Performansı" → **"Operatör İş Hacmi"** (sıralama/performans ölçüsü olarak sunulmuyor). Ölü servisler/uçlar/sayfalar da silindi; `test_reports.ts` kalan dört rapora daraltıldı (fixture kurulumu bilinçli olarak korundu — bölüm bazlı kesim zinciri koparıyordu).
> • **ÜÇÜNCÜ TUR — kalan üç yüzey de yazıldı (aynı gün):** menü **20 → 13**, kaldırılan toplam **17**.
>   - **Nerede Takıldı (WIP)** (`production/wip`) — İstasyon Verimliliği'nin yerine. ⚠️ **İKİ ZAMAN ANLAYIŞI TEK EKRANDA:** *bekleyen* ANLIK SNAPSHOT'tır (tarih filtresi onu ETKİLEMEZ — "şu an nerede takılı" sorusunu filtrelemek planlamacıyı yanıltırdı), *geçen* dönemseldir. ⚠️ İstasyon listesi **iki kümenin BİRLEŞİMİ**: dönemde iş geçirmiş ama şu an boş istasyon da satır alır ("boş mu, hiç mi çalışmadı" sorusu operatörü durdurur — Kurşun Planlama sekme dersinin aynısı). ⚠️ Ortalama bekleme **TOP AĞIRLIKLI** (1 toplu ile 50 toplu istasyonu eşit saymaz). ⚠️ Eski raporun `qtyIn/qtyOut` fark kolonu **HİÇ BASILMAZ** — `qtyOut = qtyIn` tasarım gereğidir.
>   - **Stok & Ölü Stok** (`inventory/scorecard`) — Rulo Yaşlandırma + Stok Dağılımı birleşti. Çıpa **`Roll.statusChangedAt`**. ⚠️ **ÖLÜ STOK = ESKİ **VE** SİPARİŞSİZ**; ikisinden biri tek başına sorun değildir ve raporun tüm değeri KESİŞİMDEDİR (bekçi: yalnız eskiye baksa +400, yalnız siparişsize baksa +500, doğrusu +300). ⚠️ Siparişsizlik **SPEC bazındadır** — hangi FİZİKSEL topun karşılıksız olduğu iddia edilmez (edilseydi keyfi olurdu). ⚠️ Çıpası olmayan top yaş kovalarına **DAĞITILMAZ** ama metrajı toplama girer ve sayısı ayrıca basılır: *"yaşı bilinmiyor" ≠ "yeni"*, ikincisine yuvarlamak ölü stoğu sistematik olarak gizlerdi. Talep tanımı `production-balance` ile birebir. ⚠️ **`[status, statusChangedAt]` index'i EKLENMEDİ** — 99 satırda EXPLAIN seq-scan cezası göstermiyor ve `rolls` 19 indeksli; TETİKLEYİCİ dosya başlığında yazılı (~50k satır ya da EXPLAIN'de Seq Scan).
>   - **Parti İzleme** (`production/batch-trace`) — İZLEME ÇİFT YÖNLÜ oldu: Top İzleme İLERİ (top → istasyonlar), bu GERİ (parti → hangi müşteriye ne gitti). Şikâyet geldiğinde etki kümesini bulmanın tek yolu buydu ve hiçbir ekranda yoktu. ⚠️ **PARTİ NUMARASI BENZERSİZ DEĞİL** (P01…P99 döner, `@unique` kalktı) → arama **DAİMA aday listesi** döner, izleme `batchId` ile yapılır; tek sonuç varsaymak aynı numaralı BAŞKA partinin müşterilerini göstermek olurdu. ⚠️ **İADE EDİLMİŞ TOP MÜŞTERİ LİSTESİNDEN DÜŞMEZ** — iade `Roll.shipmentId`'yi NULL'lar, yalnız canlı bağa bakmak malı iade eden müşteriyi siler ve o, şikâyet araştırmasında **en çok aranan** müşteridir (`RollReturn.fromShipmentId` ile geri eklenir — brüt kuralının izleme karşılığı). ⚠️ Kesim çocuğu partiyi miras alır → tek `batchId` sorgusu yeter; ayrı soyağacı gezintisi çocukları iki kez sayardı.
>   - Bekçiler: `test_wip_scorecard` (19) · `test_stock_scorecard` (13) · `test_batch_trace` (15) — üçü de negatif sondayla kırmızı verdiği doğrulandı. ⚠️ İki sonda ilk yazımda **yeşil kaldı ve fixture düzeltildi**: WIP'te ağırlıklı ortalama (fixture'da ağırlık farkı yoktu) ve Stok'ta ölü stok eşiği (mutlak eşik gevşekti → temel ölçüp FARK kontrol edildi). Ayrıca WIP fixture'ı **geçmişe** kurulur, diğer karneler gibi geleceğe değil: ana metrik YAŞ ve gelecek tarihli hareket negatif yaş üretiyordu.
>   - **DURANLAR:** Top İzleme · Operatör İş Hacmi · Müşteri Sipariş Profili · iki Denetim raporu. Denetim ikilisi Sistem'e taşınacak (ayrı iş); diğerleri bilinçli olarak duruyor.
> • **Migration + backend + Electron aynı pencerede; APK gerekmez** (mobil dokunulmadı). **Deploy reçetesi: `docs/history/SURUM-2026-08-09-RAPORLAR-DEPLOY.md`.** ⚠️ Sahada **`backfill` script'i migration'dan sonra koşulmalı** — atlanırsa Kalite · Fire · Stok karneleri geçmişsiz başlar (diğer beş yüzey etkilenmez) ve bunu ekrandaki uyarı bandı söyler, yani sessiz değildir. **Aciliyet ölçüldü ve düşük:** script idempotent, yalnız NULL doldurur, istendiği zaman koşulabilir; gerçek son tarih audit arşivlemesidir (`MONTHS_TO_KEEP=6`, en eski ROLL kaydı 2026-07-16 → ~2027-01). Bekçiler: `scripts/test_quality_scorecard.ts` (30 kontrol — rapor + trigger birlikte; **dört negatif sondayla** kırmızı verdiği doğrulandı: K18 dışlaması kalkınca 6, fason kovası kalkınca 3, metraj yerine adet sayılınca 12, trigger'a SHIPPED eklenince 1) · `test_db_invariants.ts §6` · Electron `reportExport.test.ts` (9 kontrol, iki negatif sonda).
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-07-13__2026-07-13-her-rota-final (arşiv 2026-09-03 DÜZELTMESİ)`: 07-13 'kaliteyi yalnız kalite istasyonları (KK1, KK2/Kurşun, Tambur) belirler' → PROCESS_QC kalite NOTU YAZMAZ; kalite iki kapıda doğar: KK1 girişi + Tambur finalize. Kalan cümleler (son adım finalize, form otomatik, qualityGrade nullable) geçerli.
>

> **NOT (2026-07-13 — "her rota final üretir"):** Fabrika jenerik bir operasyon servisi — bir WO herhangi bir işlem dizisidir, **son adımın çıktısı her zaman final ürün** (`finalizeRollsAtLastStep`). **Tambur zorunlu değil:** rota Kurşun/QC2 ile bitebilir (→ açık kumaş final) veya **fason (boyahane) ile bitebilir** (fason kabulü finalize eder — doğan açık-kumaş toplar `WAREHOUSE` + barkod, `form=ACIK`; eski STOCK-orphan limbosu kalktı). **top ⟺ Tambur; açık kumaş ⟺ diğer istasyonlar.** **`Roll.form` (TOP|ACIK)** otomatik. **`Roll.qualityGrade` NULLABLE** — kaliteyi yalnız kalite istasyonları (KK1 opsiyonel giriş, KK2/Kurşun, Tambur) belirler; kalitesiz top UI'da "—", istatistikte "Belirsiz". **WO artık `WAREHOUSE`/`A1_STOCK` topu da tüketir** (bir depo topu yeni WO'ya sokulabilir — örn. zımpara ya da WAREHOUSE açık kumaşı Tambur'a; finalize geri döndürür; detach: renksiz→STOCK, renkli→kalite/WAREHOUSE; çuval/sevkteki top bağlanamaz). Süpervizör **"Durum Düzelt" + "recover-to-production" KALDIRILDI** → yerine **IN_PRODUCTION-stuck "Kurtar"** (istasyonda takılı topu güvenle depoya al: açık movement kapanır, barkod üretilir, adım/WO recompute; `roll:manual-adjust`).
> ⚠️ **2026-09-03 DÜZELTMESİ:** Bu notun "kaliteyi yalnız kalite istasyonları (KK1 opsiyonel giriş, **KK2/Kurşun**, Tambur) belirler" cümlesi bugün YANLIŞTIR: `PROCESS_QC` kalite NOTU YAZMAZ — `Teks-Erp/src/services/kursun-qc.service.ts` içinde `qualityGrade` hiç geçmez (0 eşleşme); o istasyonun işi hata toplamak ve `QC2_COMPLETED` izi bırakmaktır. Kalite bugün İKİ kapıda doğar: KK1 girişi (`inventory.service`) ve Tambur finalize. ⚠️ Ayrıca "Tambur zorunlu değil / son adım finalize eder" kuralı ÇEKİRDEK'tir; "fabrika çözgü/dokuma yapmaz" ise PROFİL — bkz. MODUL-BAYRAK-TASARIM §5.1/§5.2.

> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-21__2026-08-21-uretim-rengi-tek`: 'Top başına BİR soru' kapısına muafiyet: fason kabulünde `planColorAction=ROLLS_ONLY` ile onaylanmış renk sapması (`RollPlanDeviation source=fason-receipt`, aynı rollValue/planValue) Tambur plan kapısında TEKRAR SORULMAZ.
>

> **NOT (2026-08-19 — Tambur plan-gerçek sapma kapısı + "Sipariş Bağla" [v1+v2] + planlamacı dağılım bandı):** Saha senaryosu: İE MAVİ açıldı, mal boyandı, tamburda beklerken müşteri "gri olacaktı" dedi; planlamacı hedefi GRİ'ye çevirdi (`changeTargetColor` sebep+izli) ama **elinde 12 topun ZATEN MAVİ boyandığını ekranda görmüyordu** ve tambur operatörü mavi topu tek kelime uyarı görmeden depoya indiriyordu — eski `colorWarning` yalnız yanıt `message`'ına yazılıyordu ve **tablet o alanı hiç okumuyordu** (ölü uyarı), üstelik yalnız "renksiz" topu kapsıyordu. Yanlış, en pahalı yerde (sevkiyatta) patlıyordu. Üç parça:
> • **TAMBUR ONAYLI DEVAM (blok değil — SAP "usage decision" karşılığı):** Üç depo-indiriş yolu TEK ortak yüklemden geçer (`helpers/tambur-plan-gate.helper.assertRollMatchesPlan`; kopyalanırsa biri ayrışır): `finalize` (kart cuts modeli) + `cutOpenFabric` (**per-cut modelde çocuk KESİM ANINDA depoya iner — kapı bitirmeyi bekleyemez**) + `finalizeOpenFabric` (yalnız `keep_*`; **scrap/discard kapı DIŞI** — fire satılabilir stok üretmez, sormak gürültü). Sapma varsa 409 `PLAN_MISMATCH` (`details.mismatches[]` insan-okur satırlar); operatör tablette onaylarsa AYNI istek `confirmMismatch:true` ile gider ve **imzalı karar audit'e düşer** (`TAMBUR_PLAN_MISMATCH_CONFIRMED`, `source` alanıyla hangi yoldan). Onay **TOP başına BİR KEZ** (`planMismatchConfirmedRef`) — seri kesimde her parçada sormak operatöre uyarıyı okumamayı öğretirdi. **Onay topun kaydını DEĞİŞTİRMEZ** (mal neyse o iner; düzeltme ayrı bilinçli işlem).
> • **Kapsam (kullanıcı kararı): renk + EŞİKLİ en.** Renk: hedeften farklı **VEYA** hedef varken renksiz. **Ters yön BİLİNÇLİ KAPSAM DIŞI** (hedef renksiz + top boyalı = zımpara WO'suna giren boyalı depo topu, meşru). En: `|fark| > TAMBUR_PLAN_WIDTH_TOLERANCE_CM` (=10; **eşit fark sapma DEĞİL**; `constants/tambur-plan-gate.ts` — panelden ayar istenirse DÖRT KAPI kuralıyla). Kalite bilinçli dışarıda (kalite kararını ZATEN tambur verir). ⚠️ Zod tanımadığı anahtarı sessizce siler — `confirmMismatch` üç şemaya da eklendi (`finalizeSchema`/`cutOpenFabricSchema`/`finalizeOpenFabricSchema`; `finalizeWarehouseCutSchema`'ya BİLEREK eklenmedi, o yolda WO yok) ve **offline kuyruk mutationFn'i elle gövde kurar** — `offline/mutations.ts`'e alan eklendi + `mutations.test.ts` sözleşme testi (varianceReason dersinin ikizi; sonda: satır düşünce kırmızı). Idempotent-retry erken dönüşleri kapıdan ÖNCE — onaylanmış işin replay'i kapıya çarpmaz.
> • **TAMBUR "SİPARİŞ BAĞLA" (üst şerit tuşu, yalnız `workorder:write` taşıyanda — 403'lük gri buton çizilmez):** `TamburOrderLinkSheet` iki sekme: **Uygun** (`GET /:id/linkable-order-lines` — kumaş+renk backend süzer, en farkı uyarı çipi) + **Tümü** (`/orders/order-lines/available` cursor'lu, 800ms debounce arama + müşteri/kumaş/renk filtresi [`OrderLineFilterSheet` yeniden kullanıldı] + En input'u; `width` parametresi mobil cursor helper'a eklendi). Uyumsuz satır GRİ + sebep çipi; **uyumsuz seçim YETKİYLE açılır, soruyla değil** (mükerrer-modal dersi: acele eden operatör onay ekranını okumaz): `roll:manual-adjust` taşımayana satır ölü, taşıyan süpervizör seçince "elindeki GERÇEKTEN bu mu?" soruları + zorunlu sebep. İki guard genişletildi ("yazabilen okuyabilir"): `linkable-order-lines` + `order-lines/available` any-listesine `workorder:write` eklendi.
> • **OVERRIDE ZİNCİRİ `POST /:id/order-links/override` (kullanıcı kararı: top + WO hedefi + bağ TEK uçta):** sırayla ① plan düzelt (`changeTargetColor`/`changeWidth` — kendi sebep+audit'leriyle) ② iş emrinin düzeltilebilir TÜM toplarını eşitle (`applyAttributeToRolls` → tekil motor; kısmi başarı bilinçli, fasondaki/sevkteki top `rollsFailed[]`e düşer ve tablet bunu toast'la yüzüne söyler) ③ bağı kur. **KUMAŞ (cins) FARKI HER ZAMAN 400** — topun cinsi hiçbir yoldan değiştirilemez (`applyManualProperties`'te alan bilinçli yok); zaten-uyumlu satır da 400 ("yanlış kapı" — normal bağla). **ÇİFT yetki kapısı route'ta AND** (`workorder:write` + `roll:manual-adjust` iki ayrı `requirePermission`) + F221 çift emniyeti (permissions tekil motora da geçer). ⚠️ **TEK TX DEĞİL — BİLİNÇLİ:** her adım kendi başına meşru; sıra öyle ki sonraki adımın düşmesi öncekini yanlışlamaz (plan düzeltmesi bağ kurulamasa da doğrudur — gerçek buydu diye onaylandı).
> • **PLANLAMACI DAĞILIM BANDI (Electron `ChangeTargetDialog`):** "Rengi/Eni Değiştir" açılınca amber bant: "Bu iş emrinde şu an: **12 top MAVİ · 3 top renksiz**" (+renk modunda "boyanmış mal için renk değişikliği kâğıt işi değildir — redye ya da stok" hatırlatması). Veri zaten `roll-attribute-targets`'tan iniyordu, yalnız özetlenmedi; saf panel işi.
> • Bekçi: `scripts/test_tambur_plan_gate.ts` (28 kontrol; **dört negatif sondayla** kırmızı verdiği doğrulandı — kapı throw'u kalkınca 8+, eşik `>=` olunca 1, kumaş sert engeli kalkınca 1, cut kapısı kalkınca 1) + mobil `mutations.test.ts` kuyruk sözleşmesi (1 sonda). Migration YOK, izin kataloğuna yeni kod YOK (mevcut kodlar); **backend + Electron + APK birlikte gitmeli** (eski APK kapıya çarpınca `confirmMismatch` gönderemez — ham 409 mesajı görür, akış kilitlenmez ama onaylayamaz; bu yüzden bayraksız kademeli değil, pencere birlikte).

> ✅ **ÇEKİRDEK:** "`code` rapor anahtarıdır ve ASLA değişmez, `label` serbest", üç kademeli okuma (sunucu → cihaz → APK zemini; boş liste operatörü kilitler), "silme yok/son aktif satır gizlenemez", uzlaştırma YALNIZ EKLER — kataloğun SAHİBİNİ fabrikaya vermek tam olarak çok-fabrika tasarımının istediği şeydir; yeni kind eklerken beş kapı birlikte güncellenir.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-21__2026-08-21-namefold-db-seddi`: 'Metin saklayan İKİ kind kayda kod DEĞİL METİN yazar' kuralının yarısı düştü: satır 2026-08-21'den beri KOD DA taşıyor (Roll.entryReasonCode/cancelReasonCode, VARCHAR 64) ve kodu sunucu metinden türetiyor. Bayrağın 'metin saklanır' anlamı KALIR, 'kod saklanmaz' anlamı DÜŞTÜ — dolayısıyla etiket düzenlemesi artık raporu bölmez.
> - KISMİ → `R:2026-08-26__2026-08-26-fabrikanin-ekledigi-sebep`: 'Doğrulama senkron önbellekten beslenir' kuralının uygulaması değişti: eskiden TTL dolunca cachedRows null dönüp KOD kataloğuna düşüyordu (fabrikanın panelden eklediği sebep 60 sn dışında reddediliyordu). Artık bayat liste DE döner ve arka planda tazeleme tetiklenir; kod kataloğuna düşme yalnız önbellek HİÇ dolmadıysa (fail-closed) kalır.
> - KISMİ → `kök CLAUDE.md:78 (2026-08-21 nameFold + sebep KODU)`: 08-19 'metin saklayan iki kind (elle ekleme, iptal) kayda kod DEĞİL metin yazar; kolonu Roll'a eklemek ertelendi' → 08-21 Roll.entryReasonCode/cancelReasonCode eklendi, kodu SUNUCU türetir (resolveReasonCode). KIND_STORES_TEXT bayrağı kalır, 'kod saklanmaz' anlamı düştü.
>

> **NOT (2026-08-19 — "Top başı" + hazır sebep katalogları KODDAN DB'ye):** Saha isteği iki cümleydi: *"tamburda fire girerken çıkan hazır mesajların en başına **top başı**nı koy"* ve ardından *"bu mesajları tambur isterse **kendi düzenleyebilsin** — her birinin yanına düzenleme ve çoğaltma tuşu, elle yazacaksa input **en altta değil en üstte** olsun"*. İkisi ayrı büyüklükte işlerdi: birincisi iki satırlık katalog düzenlemesi, ikincisi katalogun **sahibini değiştirmek**.
> • **DÖRT LİSTE TEK TABLODA (`ReasonPreset`, migration `20260819170000`):** fire (`ROLL_SCRAP`) · kayıt düzeltmesi (`ROLL_RECORD_CORRECTION`) · elle top ekleme (`ROLL_MANUAL_ENTRY`) · top iptali (`ROLL_CANCEL`). Öncesinde dördü de **kodda** yaşıyordu (`constants/variance-reasons.ts` + mobil `manualReasons.ts` / `cancelReasons.ts`) ve fabrikanın kendi diliyle sebep eklemesi **her seferinde bizim deploy'umuza** bağlıydı.
> • **KOD ≠ ETİKET, bu tablonun VAR OLMA sebebi:** `code` doğuşta yazılır, **ASLA düzenlenmez** (düzenleme ucu alanı hiç kabul etmez) — `RollVariance.reasonCode` satırda saklı olduğu için etiketi düzeltmek geçmiş raporu BOZMAZ, kodu düzeltmek altı aylık fire kırılımını ikiye bölerdi. **İKİ KİND İSTİSNADIR** (`KIND_STORES_TEXT`): elle ekleme ve iptal, kayda kod değil METİN yazar (`Roll.entryReason` / `Roll.cancelReason` serbest metin kolonları) → orada gruplama metne dayanır ve metni düzenlemek geçmişi eski metinle bırakır; **her iki düzenleme yüzeyi de bunu operatöre açıkça söyler** (kolonu `Roll`a eklemek + backfill bilinçli olarak ertelendi).
> • **ÜÇ KADEMELİ OKUMA, sırası load-bearing:** sunucu → cihazdaki son liste (AsyncStorage) → **APK'ya gömülü zemin**. Üçüncüsü kaldırılamaz: Tambur çevrimdışı çalışıyor ve fire kararında sebep ZORUNLU, yani boş liste "operatör Kaydet'e hiç basamaz" = malın tamburda kilitlenmesi demek. ⚠️ Her kademe **kararlı referans** döndürür (`?? []` YASAK — 2026-08-15 saha çökmesinin kök nedeni; bkz. `useFoldValues` notu). Bekçi: `mobil/src/hooks/useReasonPresets.test.tsx` (3 kontrol, negatif sondayla kırmızı verdiği doğrulandı).
> • **DOĞRULAMA DİNAMİK AMA HÂLÂ SENKRON:** `validateVarianceReason` tx İÇİNDE ve senkron çağrılıyor (`roll-variance.helper`), bu yüzden DB'ye async gitmek yerine servis kendi **modül önbelleğini** `registerReasonCatalogSource` ile sabitlere KAYDETTİRİR (bağımlılık yönü korunur: services → constants, tersi değil). Önbellek her yazmada tazelenir, TTL 60 sn ikinci bir yazara karşı; önbellek boş/bayatsa **kod kataloğuna düşer**. ⚠️ **GİZLENMİŞ kod da geçerli sayılır** — bayat liste taşıyan bir tablet vardiya ortasında 400 almamalı (LEGACY_REASON_CODE ile aynı gerekçe); gizleme bir GÖRÜNÜRLÜK kararıdır, geçerlilik kararı değil. Uydurma kod hâlâ fail-closed reddedilir.
> • **SİLME YOK, GİZLEME VAR** + **son aktif satır gizlenemez** (400): liste boşalırsa fire kararında "Kaydet" sonsuza dek kapalı kalırdı. Sistem satırı (`isSystem`) her boot'ta uzlaştırılır (`jobs/reason-preset-catalog.job.ts`, izin/rol kataloglarının üçüncü fazı olarak AYNI zincirde — soğuk açılış yeniden-deneme politikası ortak); uzlaştırma **YALNIZ EKLER**, fabrikanın düzenlediği etiketi/sırayı/gizliliğini EZMEZ. Sert silme bir sonraki `pm2 restart`'ta DİRİLİŞ olurdu (rol şablonu dersi).
> • **İZİN FORMÜLÜ — yeni kod ÜRETİLMEDİ (bilinçli):** okuma yalnız `verifyToken` (liste zaten her operatör ekranında çiziliyor; ayrı okuma izni, atanmadığı her tablette Tambur'un sebep adımını 403'e düşürürdü), yazma `roll:manual-adjust` **VEYA** `mobile:tambur-duzelt` — ikisi de zaten "veriyi elle düzeltebilen güvenilir kişi" demek ve zaten atanmış. Yeni bir `reason-catalog:write`, sahada **atanması unutulacak bir adım daha** olurdu (2026-08-01 kurşun bypass vakası). Tambur ekranı bu formülü zaten `canFieldFix` olarak taşıyordu.
> • **YERLEŞİM (saha isteğinin özü):** fire/kayıt-düzeltmesi adımında serbest metin kutusu artık **listenin ÜSTÜNDE** ve her zaman görünür; yazmaya başlamak "Diğer"i **kendiliğinden seçer** (eskiden kutu listenin ALTINDAYDI ve yalnız "Diğer" seçilince beliriyordu → operatör sekiz satırı geçip dibe iniyor, sonra kutuyu bulmak için ikinci kez kaydırıyordu). Her satırın yanında **düzenle + çoğalt**; kopya kaynağın **hemen altına** düşer ve anında seçili gelir.
> • ⚠️ **İPTAL EKRANINDA SATIR İÇİ KALEM YOK, gerekçesi yıkıcılık:** o chip'ler 2026-08-06 kararıyla **dokununca topu iptal eder**; yıkıcı bir aksiyonun 4 mm yanına düzenleme tuşu koymak, ıskalanan her dokunuşu iptal edilmiş bir top yapardı. Orada tek bir "Sebepleri düzenle" tuşu var, düzenleme ayrı yüzeyde (`ReasonPresetManagerSheet`). Fire ekranında seçim yıkıcı değil (ayrı "Kaydet" var) → satır içi tuşlar güvenli.
> • **ELECTRON: TEK KART, DÖRT SEKME** (Tanımlar → Üretim & Kalite → **Hazır Sebepler**). Dört ayrı kart menüyü kalabalıklaştırırdı ve dördü aynı şeyin (operatöre gösterilen hazır mesaj) bağlamlarıdır. Kart ve route AYNI izni taşır (`roll:read`; ayrışma = görünen kart + `/forbidden`), düzenleme tuşları `roll:manual-adjust` yoksa **çizilmez** (gri buton olmayan bir yolu vaat eder). Sıralama ok tuşlarıyla; `PickerModal` seçenek kartlarına opsiyonel `optionActions` eklendi (verilmezse hiç çizilmez — diğer picker'ların yerleşimi aynen korundu).
> • Bekçi: `scripts/test_reason_presets.ts` (25 kontrol — uzlaştırma idempotentliği + fabrika düzenlemesinin ezilmemesi + kod sabitliği + son-aktif guard'ı + dinamik doğrulama + **mobil çevrimdışı zemininin birebir aynası**; iki negatif sondayla kırmızı verdiği doğrulandı). **Migration + backend + Electron + APK aynı pencerede; backend ÖNCE** (yeni sebep kodu gönderen tablet, katalogu tanımayan bir sunucuda "Geçersiz sebep kodu" alır).

> ⚠️ **PROFİL GERÇEĞİ:** Bu notun tamamı fason modülü (hizmet ALAN yön) altındadır ve fason kapalı kurulumda hiçbir yüzeyi yoktur; boyahane profilinde (hizmet VEREN yön) aynı akışın AYNASI ayrı tasarım işidir. **Çekirdek olan:** `clientToken @unique` replay kimliği, "kalem yalnız TAM satırla kapanır — 21 filtre noktası", LIFO iptal ve "karne dönen metrajı DEFTERDEN okur" — bkz. MODUL-BAYRAK-TASARIM §2, §10.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-21__2026-08-21-fason-kabulu-cekme`: Mobil kısmi kabul modeli değişti: satır başına 'Gelen (m)' girişi (düşürmek = kısmi) yerine TEK soru 'Fasonda kalan var mı?' + tek metraj; dağıtımı resolveReturns büyük toptan yapar. Satır başına 'Gelen (m)' yalnız kaçış kapısı olarak kaldı; Electron FasonReceiveDialog satır bazlı 'Gelen' modelini korudu.
> - KISMİ → `R:2026-08-21__2026-08-21-fason-kabulu-cekme`: Karne 'dönen' tanımı genişledi: 08-19 dönen metrajı kabul DEFTERİNDEN okutup 'fire artık gerçek' dedi; 08-21 ölçtü — TAM kabulde defter satırı kalanın kendisi olduğundan fark HEP 0 kalıyordu. Gerçek dönen = defter + sapma defteri (SUBCONTRACTOR_RETURN: SCRAP −, OVERAGE +); çekme openQty'ye girmez.
>

> **NOT (2026-08-19 — Fason KISMİ KABUL + kalan-kapama + parti kuralı):** Saha vakası: boyahaneye giden 100 m topun 51 m'si geldi, 49 m sonra gelecek. Eski model top bazındaydı — kabul topu TÜKETİYORDU (`SUBCONTRACTOR_CONSUMED`), "yarısı geldi" diye bir yol yoktu; operatör ya bekliyor ya 49 m'yi sessizce buharlaştırıyordu. Yeni model SAP fason kısmi mal girişinin karşılığı: **her teslimat AYRI makbuz, sevk kalemi metraj defteri taşır.**
> • **ÇEKİRDEK: kısmi kabulde top TÜKETİLMEZ** — `AT_SUBCONTRACTOR` kalır, `currentQty` atomik decrement ile kalana iner (kısmi SEVK'teki orijinal-decrement deseninin dönüş aynası; sınıflandırma tam/kısmi kararı WO kilidi ALTINDA taze metrajla verilir). `returns[].receivedQty` verilmez ya da kalanı aşar/eşitlerse **TAM kabul — eski APK davranışı birebir korunur** (clamp: deftere kalan yazılır). Adım kapanışı değişmedi: `stillAtSubcontractor > 0` olduğu sürece adım ACTIVE, kart okutulabilir, WO fason hard-block'u doğru şekilde devrede.
> • **DEFTER: `SubcontractorReceiptItem.receivedQty` + `isPartial`** (migration `20260819200000`, additive). NULL = eski satır ("tamamı kabul edildi"; raporda `COALESCE(receivedQty, roll.currentQty)` — tüketim anında currentQty = kabul edilen kalan olduğundan iki rejim aynı sayıyı verir). ⚠️ **Kalem yalnız TAM (isPartial=false) aktif makbuz satırıyla "dönmüş" sayılır** — TÜM outstanding filtreleri `none: { isPartial: false, receipt: { cancelledAt: null } }` okur (21 kullanım noktası güncellendi: isBatchLockedTx, listPendingReturns, firma çözümü F74, quick-receive, traveler-card uyarısı, envanter "Fason Bilgisi", split/merge/surgery helpers…). Bu güncelleme atlanırsa kısmen dönmüş sevk "kapandı" görünür ve İKİNCİ teslimatın firma çözümü "kaynak sevk bulunamadı" ile düşer.
> • **İDEMPOTENCY DEĞİŞTİ: `SubcontractorReceipt.clientToken @unique`.** Eski küme-eşitliği guard'ı ("aynı top kümesi → cached makbuz") kısmi teslimatta İKİNCİ gelişi yutardı — aynı top iki teslimatta MEŞRU olarak tekrar gelir. Kural: token varsa replay kimliği ODUR (iptal edilmiş makbuzun token'ı 409 `RECEIPT_CANCELLED` — KK1 emsali); küme-eşitliği guard'ı yalnız **tam-tüketimli** makbuzlar için devrede (`prior.items.some(isPartial) → continue`). Yeni istemciler (APK/Electron) her mantıksal denemede yeni token üretir, retry aynısını taşır.
> • **PARTİ KURALI (sektör: her mal girişi kendi lotu / boya lotu ayrımı):** ilk teslimat giden partiyi SÜRDÜRÜR; aynı sevkin **ikinci+ teslimatında doğan toplar YENİ parti alır** (`createBatchTx`, `splitFromId` = kaynak parti — K5 kalan-böl kuralının dönüş aynası). Tespit sevk-kapsamlı: kaynak sevkte önceki aktif makbuz satırı var mı (kendi makbuzumuz yazılmadan ÖNCE sayılır — sıra load-bearing). Tek seferde tam dönüşte hiçbir şey değişmez.
> • **MOVEMENT SÖZLEŞMESİ:** kısmi kabulde movement AÇIK kalır; SON teslimatta kapanır ve `qtyOut = COALESCE(qtyIn, currentQty)` (sevk edilen TOPLAM — kalanı yazmak istasyon hacmini eksik gösterirdi; tek-teslimat yolunda qtyIn==currentQty olduğundan davranış birebir aynı). RollOperation `SUBCONTRACTOR_RETURNED` unique'i (rollId, stepId, opType) yüzünden ikinci teslimatın satırı skipDuplicates ile düşer — teslimat teslimat iz MAKBUZ KALEMLERİNDEDİR, op "ilk dönüş olayı"nın izi olarak kalır.
> • **KALAN-KAPAMA (`POST /api/subcontractor/close-remainder`):** "kalan gelmeyecek" → top `SUBCONTRACTOR_CONSUMED`, kalan metraj **sapma defterine FİRE** (`RollVariance` SCRAP, yeni source `SUBCONTRACTOR_REMAINDER`, sebep ReasonPreset **ROLL_SCRAP** kataloğundan — yeni kind AÇILMADI, fabrika aynı listeyi düzenler; geçersiz kod 400 fail-closed) + sevk kalemi **`SubcontractorDispatchItem.remainderClosedAt`** damgası (damgasız + tam-makbuzsuz kalem outstanding filtrelerinde SONSUZA DEK açık kalır ve parti kilidi hiç açılmazdı). Kapama ELLE ve sebep zorunlu; otomatik zaman aşımı YOK — bekleyen listesi yaş bandı basar ("N gündür fasonda", 7+ gün amber). İzin formülü mevcut: `workorder:write` ∨ `mobile:fason-kabul`.
> • **İPTAL LIFO:** aynı topa dokunan daha YENİ aktif makbuz varken eski makbuz iptal edilemez (409 `RECEIPT_NOT_LATEST`; önizleme `laterReceipts` döner). Geri sarma iki dallı: TAM kalem statüyü geri çeker (metraja dokunmaz), KISMİ kalem metrajı atomik increment ile GERİ KOYAR (statü zaten AT_SUB; kalan-kapama araya girdiyse claim 409). Sıra: sondan başa.
> • **KARNE DÜZELTMESİ (eski kod fire'ı HEP %0 basıyordu):** `subcontract-scorecard` dönen metrajı **defterden** okur (`SUM(COALESCE(receivedQty, currentQty))`) — eski kaynak `initialQty` giden metrajın kendisini "döndü" sayıyordu (canlı kopyada doğrulandı: giden=dönen birebir). "Kapandı" = tam makbuz VAR ∨ `remainderClosedAt`; kısmi satırlar kalemi AÇIK bırakır ve açık bakiye = giden − kısmen dönen. Kalan-kapamayla kapanan kalemin süresi ölçülmez (dönüş yok — kapama tarihi teslim süresi değildir).
> • **YÜZEYLER:** Mobil Fason Kabul — her işaretli satırda "Gelen (m)" girişi (varsayılan = kalan; düşürmek = kısmi), YARIM rozeti (`kalan/sevk m`) + yaş bandı, 🔥 kalan-kapama modalı (serbest metin üstte + fire chip'leri — Tambur kalan-karar deseni), onay modalında kısmi özeti; `clientToken` payload kurulumunda üretilir (offline replay aynı token). Electron — İş emri detayı + yan panelde **"Fason Kabul"** butonu → `FasonReceiveDialog` (sevk başına kart: top bazlı checkbox + gelen m + parçalar + renk + irsaliye/not + satır içi 🔥 kapama); kapatma diyaloğundaki hızlı panel ile Konumu Düzelt inline kabulü DEĞİŞMEDİ (hep tam kabul gönderir — kısmi oradan yapılmaz, ince ayar diyaloğa taşındı).
> • **Bekleyen listesi zenginleşti:** `pending-returns` toplarına `dispatchedQty` + `dispatchedAt` iliştirilir (`attachOpenDispatchInfo`) — yarım-kalan rozeti ve yaş bandının veri kaynağı; alanlar yoksa (eski backend) istemci rozet çizmez.
> • Bekçi: `scripts/test_fason_partial_receive.ts` (43 kontrol; P1 kısmi decrement · P2 takip teslimatı + yeni parti · P3 token replay · P4 movement qtyOut=qtyIn · P5 LIFO iptal + metraj geri koyma · P6 kalan-kapama + variance + damga · P7 fazla dönen clamp · P8 bekleyen listesi zenginleştirme · P9 karne gerçek fire). **Üç negatif sondayla kırmızı verdiği doğrulandı:** küme-guard'ının kısmi-atlaması kaldırılınca 10, karne `initialQty`'ye dönünce 2, yeni-parti dalı kapatılınca 2. **Deploy: migration + backend ÖNCE** (eski APK'lar tam kabulle çalışmaya devam eder), Electron + APK (2.9.1/vc48) sonra.

> ⚠️ **PROFİL GERÇEĞİ:** M1 ("Boyahaneye Geri Gönder") ve M4 (tabletten bağ sökme) üretim+fason yüzeyleridir; M3'ün kısa-kesim eşiği bu fabrikanın kesim pratiğidir. Taşınabilir çekirdek: **kanonik yüklem `stepCanApplyColor`** (moveService'in dar `colorStep`'i DEĞİL), `RollPlanDeviation`'ın `confirmationId` çift-sayım kilidi ve "birleştirme TEK yerde (`resolveShortCutConfig`)" — bkz. MODUL-BAYRAK-TASARIM §12 kural 4.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - TAM → `R:2026-08-21__2026-08-21-is-emri-tipi`: M4 tabletten bağ sökmedeki 'ORDER_PRODUCTION son bağ 400' kuralı kalktı: siparişe özel iş emrinin son bağı kalkınca iş emri STOK'a döner; tek 400 hedef kumaşsız WO. Aynı notun 2. turundaki 'Tersi BİLİNÇLİ OLARAK YOK' cümlesi de 3. turda geri alındı; mobil ayna `canUnlinkOrderLine` artık `becomesStock` üretir.
> - KISMİ → `R:2026-08-21 — İş emri TİPİ bağın aynası (küme dışı, CLAUDE.md:79)`: 2. paketin ④ maddesi 'son-bağ kuralı istemci aynası (son bağ reddedilir)' değişti: son bağ artık reddedilmez, iş emri ORDER_PRODUCTION'dan STOK'a döner; mobil ayna `canUnlinkOrderLine` → `becomesStock`.
> - KISMİ → `R:2026-08-21__2026-08-21-uretim-rengi-tek`: 'moveService'in dar colorStep'i yalnız requiredCategory okur, iç boyahaneyi görmez' tespiti 08-21'de kapandı: manuel taşıma ve parti ayırma da `stepCanApplyColor` kullanır. 'send-to-dye hedefi kanonik yüklemle çözülür' kuralı geçerli; 'dar colorStep' karşıtlığı tarihsel.
> - KISMİ → `2026-08-21 — İş emri TİPİ bağın aynası (kök CLAUDE.md:76; bu kümede üye değil)`: ④ 'tabletten bağ sökmede son bağ reddedilir' kuralı: son bağ artık reddedilmez, iş emri STOK'a döner (`canUnlinkOrderLine` → `becomesStock`). Notun kendi metninde işaretli.
>

> **NOT (2026-08-19 — TAMBUR PAKETİ 2: sektör boşluklarının kapatılması; dördü de MEVCUT yetkiye bağlı, yetkisizde UI HİÇ çizilmez):** 2026-08-19'un ilk paketi (plan-sapma kapısı + Sipariş Bağla + kısa-kesim-A1) sektör standartlarına göre dört yeri bilinçli açık bırakmıştı; kullanıcı kararıyla dördü de kapatıldı. **Yeni izin kodu YOK** (kurşun bypass dersi: yeni kod = sahada unutulabilir atama) — hepsi `roll:manual-adjust`/`mobile:tambur-duzelt`/`workorder:write`/`report:quality`/`admin:settings` üzerinden.
> • **M1 — "BOYAHANEYE GERİ GÖNDER" (plan-sapma kararının REWORK kolu):** onay modalının 3. tuşu; `POST /tambur/manual/send-to-dye(-preview)` (bring çiftiyle AYNI izin). ⚠️ **HEDEFİ İSTEMCİ SEÇMEZ, SUNUCU ÇÖZER** — tablette rota yok (`GET /work-orders/:id` `mobile:tambur`u kapsamıyor) ve olsaydı bile yüklem ikinci kez yazılırdı. Çözüm **KANONİK** `stepCanApplyColor` (istasyon bayrağı VEYA fason hizmeti) — moveService'in kendi `colorStep`'i YALNIZ `requiredCategory` okur, İÇ boyahaneyi görmez; bekçinin en kritik senaryosu bu (yanlış çözümleyici kullanılırsa §2 kırmızı). **Çoklu boya adımında mevcut adımdan ÖNCEKİ en yakını** (max stepSequence): daha erkene dönmek aradaki adımları gereksiz diriltir ve QC-VOID kapsamını büyütür; SONRAKİ boya adımı hedef DEĞİL (ileri atlama "geri gönderme" değildir) → 400 `NO_DYE_STEP_IN_ROUTE`. Taşımanın tamamı `manualMove`e delege (QC/kurşun VOID, CUT hard-stop, SKIPPED→PENDING, WO diriltme); 2. audit `TAMBUR_SEND_TO_DYE`. **AT_SUBCONTRACTOR YAZILMAZ** — mal fason adımında ÜRETİMDE bekler, çıkış ayrıca Fason Sevk'ten (taşınan top o listede `dispatchableForStepId` ikinci dalıyla kendiliğinden görünür). ⚠️ Toast hedef istasyon adını MUTLAKA taşır: top Tambur listesinden düşer, operatör nereye gittiğini görmezse "kayboldu" der. Önizlemesiz uygulama YOK (TamburBringRollModal sözleşmesi), sebep ≥3 zorunlu.
> • **M2 — KALICI SAPMA DEFTERİ `RollPlanDeviation` + Plan-Sapma Karnesi (MİGRATION VAR):** bugünkü tek iz audit'teydi ve rapor için iki kez elverişsizdi (6 ayda arşive taşınır + **rapor katmanı arşivi HİÇ okumaz**; `newData` JSON indekssiz; `recordId` PARENT). Metadata/enum yolları elendi: `TAMBUR_PROCESSED` cut anında YOK + upsert `update:{}` + `@@unique` adım başına tek satır; enum genişletme şema notuyla emsalen reddedilmiş. **Granülerlik = onaylı kapı-geçişi × sapan alan**, `confirmationId` geçişi gruplar (`finalize`: geçiş başına, childRollId=null, qtyM=topun TÜM metrajı — çocuk başına satır "onay sayısı"nı kesim adedi kadar şişirirdi; `cut`: kesim başına + çocuk; `finalize-open-fabric`: kalan çocuk + **tx-içi TAZE** kalan, yalnız `wantChild` dalında). **`field` pg enum DEĞİL string** (tek kaynak TS union; üçüncü alan gelince ALTER TYPE churn'ü yok — `RollVariance.source` emsali). `assertRollMatchesPlan` artık `PlanMismatchItem[]` DÖNER (audit best-effort tx-DIŞI aynen kalır) ve üç çağıran **kendi tx'inde** `recordPlanDeviationTx` yazar → aynı `clientToken` replay'inde P2002 rollback defter satırını da geri sarar (bekçi C6 bunu ölçer). **Karne** `GET /api/reports/quality/plan-deviation-scorecard` (`report:quality`, yeni izin yok): ⚠️ **onay sayısı `COUNT(DISTINCT confirmationId)`, metraj imza başına TEK `qtyM`** — naif `SUM` renk+en sapan topu ÇİFT sayar (bekçi negatif sondayla kanıtladı: 140 ↔ 240). Alan kırılımı SATIR bazlıdır (aynı imzada iki olay gerçekten iki olaydır) ve ekranda "onay" ile "olay" AYRI adlandırılır. Gün serisi `factoryDaySql` (gece vardiyası doğru güne).
> • **M3 — KISA-KESİM EŞİĞİ MERKEZE + 3 DURUMLU CİHAZ OVERRIDE:** bayrak+eşik artık fabrika ayarı (`tambur.shortCutA1Enabled` / `...ThresholdM`, dört kapı: SETTING_KEYS + FeatureFlags + reader + getFeatureFlags + setFeatureFlags + `feature-flag.routes` strictObject + Electron tipi + panel + mobil arayüz/hook). Backend **ENFORCE ETMEZ** (kural istemcide; sunucuda ikinci kural çift kaynak olurdu). Eşiği temizleme `null` → depoda **0** yazılır (set() `InputJsonValue` null kabul etmez; okuma `<=0 → null` ile aynı "girilmemiş"e çözer). Cihazda artık bayrak+eşik değil **`tamburShortCutA1Override: 'server'|'on'|'off'`** — iki durumlu modelde "girilmemiş" ile "sunucuyu izle" aynı değere düşerdi; bilinmeyen disk değeri 'server'a düşer (cihaz sessizce fabrikadan AYRILMAZ). Birleştirme TEK yerde: `resolveShortCutConfig` ('on'da eşik CİHAZINKİdir, **fabrika eşiğine SIZMAZ** — operatörün görmediği bir sayıyla kesim yapılmaz). Override yetkisi **süpervizör çifti** (`roll:manual-adjust || mobile:tambur-duzelt`); sıradan operatör fabrika ayarını salt-okunur görür. Electron'da `FlagDef.numberField` genişletmesi — ⚠️ iç alan adı **`numberKey:`**, `key:` OLAMAZ (sözleşme bekçisi panel kümesini satır başı `key:` regex'iyle okur; sızarsa boolean kontrolü yanlış şey ölçer). Bekçiye **SAYISAL AYAK** eklendi (A+B+C üç-yer; sözleşmenin bu tarafı bugüne dek hiç ölçülmüyordu).
> • **M4 — TABLETTEN BAĞ SÖKME:** `TamburOrderLinkSheet`e **3. sekme "Bağlı (N)"** (üstte kompakt liste DEĞİL: FlashList'li gövdede scroll çakışması + sekmeleri itme riski; görünürlük sekme sayacıyla). Veri mevcut `woQ`dan (ek istek YOK). Backend ucu hazırdı (`workorder:write`; FROZEN 409; **ORDER_PRODUCTION son bağ 400**) — istemci aynası saf `canUnlinkOrderLine` ile ÖNDEN gösterilir (son sözü yine backend söyler). Kaldırma `ConfirmDialog` ile onaylanır ("karşılanma tablosu ve refakat kartı etkilenir").
> • **Bekçiler + negatif sondalar (hepsi kırmızı verdiği ölçülerek):** `test_tambur_plan_gate` 48 kontrol (C1-C10; sondalar: cut defteri silinince 4, confirmationId satır başına olunca 1, qtyM yanlış bağlanınca 1, C10 yerleşimi bozulunca 1) · `test_tambur_send_to_dye` 22 kontrol (sondalar: kanonik yüklem yerine requiredCategory → §2 patlar, "önceki" kuralı kalkınca §5) · `test_plan_deviation_scorecard` 12 kontrol (sondalar: naif SUM → 240, kırılım satır bazlı olunca) · `test_feature_flag_contract` +4 sayısal kontrol (sonda: şemadan düşünce 2 kırmızı) · mobil `resolveShortCutConfig.test` (sondalar: öncelik tersi, server eşiğine sızma) + `canUnlinkOrderLine.test` + `deviceSettingsStore.test` 3-durum yeniden yazımı. ⚠️ **C9 KÖR ÇIKTI ve dürüstçe yeniden adlandırıldı**: "kalan 0'ken satır yazılmaz" kontrolü aslında KAPININ `currentQty>0` şartını ölçüyor, yazımın `wantChild` dalında olmasını DEĞİL (defter dal dışına taşınınca yeşil kaldı — kapı hiç açılmadığı için mismatches boştu); yerleşim ayrıca **C10 yapısal kontrolüyle** kilitlendi (`child.id` yalnız o dalda kapsamda → TS + kontrol birlikte).
> • **Deploy:** backend ÖNCE (yeni uç/anahtar/tablo eski istemciyi bozmaz) → Electron + APK birlikte. Migration `20260819190000_roll_plan_deviations` (salt CREATE TABLE, additive, vardiya içinde uygulanabilir; prosedür: git add → db execute → resolve → `\d` doğrulaması). ⚠️ RESTRICT FK: top silen HER test cleanup'ı `rollPlanDeviation.deleteMany` içermeli.

> ⚠️ **PROFİL GERÇEĞİ:** "Stok üretimi" kavramının varlığı `workorder.stockProductionEnabled` ile bayraklanacak (varsayılan AÇIK); siparişsiz üretime izin vermeyen bir kurulumda bu notun STOK↔ORDER simetrisi tek yönlü kalır. **Çekirdek:** "tip HİÇBİR yerde beyan değil BAĞDAN TÜRER", atomik `updateMany WHERE type=STOCK` ve "liste/künye/kart ile detay ayrışmamalı" (türetilmiş alan sınıfı) — bkz. MODUL-BAYRAK-TASARIM §9.

> **NOT (2026-08-21 — İş emri TİPİ bağın AYNASIDIR: "Sipariş Bağla" STOK → SİPARİŞE ÖZEL çevirir):** Saha bildirimi: iş emri siparişe bağlı olduğu hâlde **listede "Stok"** yazıyor; detay paneli ve yan panel siparişi gösteriyor. 2026-08-21 10:33 yedeği (`tekserp_saha`) ile yeniden kuruldu: **13 iş emri** `type=STOCK_PRODUCTION` ama `work_order_to_order_lines` dolu — hepsi aynı sırayla: Eda iş emrini stok için açıyor (08:39–08:56), ~1 saat sonra "Sipariş Bağla" (`POST /work-orders/:id/order-links`, audit `ORDER_LINK_ADDED`) ile bağlıyor; `updatedAt` açılış saatinde kalmış, yani bağ yolu iş emri satırına hiç dokunmamış. **Kök neden:** `workorder-link.service.linkOrderLines` pivot satırını yazıp `WorkOrder.type`'a DOKUNMUYORDU; oysa tip sistemin her yerinde BEYAN değil BAĞDAN TÜRER — panel formu `buildPayload` (`hasLines ? ORDER : STOCK`), Hızlı İş Emri `createFromRolls`, `unlinkOrderLine`'ın "son bağ kaldırılamaz — tipini yalanlar" kuralı. Liste "Tip" kolonu · künye · yan panel başlığı · refakat kartı `type`'ı basar, detay paneli ise `orderLinks`'e bakar → iki yüzey ayrıştı. Bu yolun tek özel tarafı buydu (`update` PATCH bağ taşımaz, `replace` PUT tipi istemciden türetilmiş alır).
> • **Düzeltme:** ① `linkOrderLines` aynı tx'te `tx.workOrder.updateMany({ where: { id, type: STOCK }, data: { type: ORDER } })` — ATOMİK (yarışta iki çağrı da güvenle geçer, ikincisi `count=0`); yanıt `typeChanged`, mesaj "… İş emri artık Siparişe Özel.", audit `typeChanged` + `oldData.type→newData.type` (künyede "Ne değişti" satırı üretir); `linkOrderLineWithOverride` aynı yoldan geçer. ② **Tersi BİLİNÇLİ OLARAK YOK** — son bağ kalkınca STOK'a dönüş yazılmadı: `unlinkOrderLine` son bağı zaten reddediyor (mobil aynası `canUnlinkOrderLine` + test); ORDER→STOCK'un meşru yolları Düzenle formu (replace, satırsız payload → STOCK, `targetItemId` şart) ve sipariş iptalinde `CONVERT_TO_STOCK`. Açık soru olarak bırakıldı: stok iş emrine YANLIŞ sipariş bağlanırsa tablet "Sipariş Bağla" sekmesinden geri alınamaz hâle gelir (tip artık ORDER) — çıkış Düzenle formu. Simetrik model istenirse (son bağ → STOK, `targetItemId` yoksa red) üç yer birlikte: servis + `canUnlinkOrderLine` aynası + test. ③ Geçmiş kayıtlar **MIGRATION ile DEĞİL** — dry-run varsayılan `scripts/fix_workorder_type_from_links.ts --apply` (her iş emrini açılış/ilk bağ/siparişleriyle fabrika saatiyle listeler; CANCELLED/SUPERSEDED dışarıda; idempotent; audit `TYPE_DERIVED_FROM_LINKS` + `source`); fire-grade emsali: canlı veriye dokunan düzeltme listeleyip onaylatılır. Provada 13 satır, vardiya içinde koşulabilir.
> • **Bekçi:** `test_workorder_order_link` +6 kontrol (ilk bağda tip/`typeChanged`/mesaj/audit, tekrar bağlamada ve zaten-ORDER'da `typeChanged=false`, son bağdan önce tip ORDER); **negatif sonda:** flip `if (false && …)` yapılınca 7 kırmızı (50→43), dosya `cmp` ile birebir geri yüklendi. İstemci yanıt tipi `typeChanged?: boolean` (Electron + mobil) — yalnız tip; davranış değişikliği yok (Electron toast `res.message` basar ve `["work-orders"]` invalidate eder, liste kendiliğinden düzelir).
> • **Deploy:** backend tek başına yeter (ek yanıt alanı eski istemciyi bozmaz; APK/Electron bekletilmez) → sonra script `--apply` (`docs/ops/SURUM-2.9.0-VERI-AKTARIMI-DEPLOY.md §5b`). Migration YOK, izin YOK.
> • **Diğer yazma yolları da kapatıldı (aynı gün, 2. tur):** `WorkOrderService.create()` ve `replace()` sipariş satırı geldiğinde tipi STOK bırakıyordu (bağı yazıyor, üstelik `type === ORDER` koşullu sipariş-satırı doğrulamalarını — kumaş/renk/iptal — da atlıyordu); panel formu tipi satırdan türettiği için sahada görünmemişti ama kural istemci disiplinine aitti. Artık ikisinde de `allocations.length > 0 && type === STOCK → ORDER` (sunucu çevirir, sonra ORDER doğrulamaları koşar). Bekçi: `test_workorder_order_link` §2c (+2 kontrol; negatif sonda 2 kırmızı). **Kalan teorik boşluk (bilerek dokunulmadı):** sipariş iptali `UNLINK_ONLY` aksiyonu tek-siparişli PLANNED (tek izinli aksiyon) ve COMPLETED iş emrinde bağı silip tipi ORDER bırakır → "Siparişe Özel ama siparişsiz" (ters yön). Yedekte 0 kayıt; kapatılacaksa önizleme metni + apply tx birlikte değişir.
> • **3. tur — SİMETRİ + iptal akışı (aynı gün, kullanıcı kararı "3. ve 4. maddeyi ele alalım"):** ① `unlinkOrderLine`: siparişe özel iş emrinin SON bağı artık REDDEDİLMEZ — aynı tx'te taze bağ sayımı 0 ise `updateMany WHERE type=ORDER → STOCK`, yanıt `typeChanged`, mesaj "… İş emri artık Stok üretimi.", audit `oldData.type/newData.type`. Tek 400 kaldı: hedef kumaşı NULL olan siparişe özel iş emri (STOK'un değişmezi; `create` ORDER'da kumaşı siparişten türettiği için pratikte boş yok — yedekte 0/114). Eski "son bağ kaldırılamaz — tipini yalanlar" gerekçesi, tip bağı izlediği için ortadan kalktı. ② Sipariş iptali `cancelWithActions`: `UNLINK_ONLY` sonrası tx içinde kalan bağ 0 ise `type ORDER → STOCK` (`targetItemId NOT NULL`, terminal statü hariç) — PLANNED iş emrinde tek izinli aksiyon UNLINK_ONLY olduğu için "Siparişe Özel ama siparişsiz" yalnız oradan doğuyordu; `CONVERT_TO_STOCK` ile tek-siparişli WO'da artık aynı sonucu verir, fark niyet etiketi. Electron iptal diyaloğu tek-siparişli satırda "Stok üretimine döner" rozeti + UNLINK_ONLY açıklaması. ③ Mobil ayna `canUnlinkOrderLine(type, linkCount, hasTargetItem=true)` → `{allowed, reason, becomesStock}`; Tambur sheet son bağda satır notu + onay metnine "iş emri Stok üretimine dönecek"; `hasTargetItem` bilinmiyorsa engellemez (son söz backend). **Deploy sırası:** backend önce GÜVENLİ (eski APK aynası yalnız fazladan engeller: son bağı tabletten kaldıramaz, Düzenle/Electron'dan kaldırılır); APK ile açılır. Bekçiler: `test_workorder_order_link` 61 kontrol (+9: 5b simetri/hedef-kumaşsız red/gidiş-dönüş, §9 iptal UNLINK_ONLY→STOK); **iki negatif sonda:** unlink dönüşümü kapatılınca 4 kırmızı, iptal dönüşümü kapatılınca 1 kırmızı; mobil jest 6/6.

> ⚠️ **PROFİL GERÇEĞİ:** "bugün prod'da iç boyahane yok (aktif `appliesColor=true` tek istasyon 'Boyahane (Fason)')" cümlesi bu kurulumun ölçümüdür — iç boyahaneli profilde `kursunFinish` 3c dalı ilk günden canlıdır. **Çekirdek:** tek bekçi (`assertTargetColorChange`), "kilit ADIMA değil MALA bakar", üç sonuç (SERBEST / `COLOR_PARTIAL_CONFIRM` / `COLOR_DYED_BLOCKED`) ve "kumaş farkı HER ZAMAN red" — bkz. MODUL-BAYRAK-TASARIM §5.1.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-27__2026-08-27-rota-kapsamasi-hedef`: 2026-08-21 'rota kapsaması UYARI' yalnız 'Rengi Değiştir' yolundaydı; create/replace hâlâ 400 (`assertRouteCoversTargets`) veriyordu. 2026-08-27 üç yolu tek kurala aldı: `collectRouteCoverageWarnings` → `ApiResponse.warnings`; `assertRouteCoversTargets` koddan kalktı (yalnız yorumlarda), goods muafiyeti eklendi.
> - TAM → `R:2026-08-27__2026-08-27-rota-kapsamasi-hedef`: 08-21 arşivi 'açılışta `assertRouteCoversTargets` 400 vermeye devam eder' diyordu; 08-27'de oluşturma (create) ve replace yolu da uyarıya çevrildi; `assertRouteCoversTargets` adı yalnız yorumlarda kaldı.
>

> **NOT (2026-08-21 — Üretim rengi değişikliği TEK BEKÇİ + kısmi-boya onayı + fason kabul taze renk + sipariş kalemi rengi):** Kullanıcı sorusu *"bitmiş iş emri düzenlenebiliyor mu, renk değişince fasondaki/üretilmiş toplar etkileniyor mu?"* incelemesinde beş zafiyet bulundu ve kullanıcı kararıyla hepsi kapatıldı. Kök bulgu: renk değişikliğinin İKİ kapısı vardı (`PATCH /work-orders/:id` "Düzenle" ↔ `PATCH …/target-color` "Rengi Değiştir") ve **aynı izinle (`workorder:write`) farklı kural** uyguluyorlardı — ikincisi terminal statüyü, boya-bitti kilidini ve izinli renk listesini atlıyor, bitmiş iş emrinin planını bile değiştiriyordu.
> • **TEK BEKÇİ `helpers/workorder-target-color.helper.assertTargetColorChange`** — iki kapı da ondan geçer, sıra: ① terminal statü (COMPLETED/CANCELLED/SUPERSEDED → 409 `WO_PLAN_FROZEN`; *bitmiş iş emrinin planını geriye dönük değiştirmenin meşru ihtiyacı yok — toplar yanlışsa yol "Düzelt"*) ② renk aktif ③ `Item.allowedColors` ④ boya-bitti kilidi (`computeWorkOrderLocks.targetColor` → 409 `COLOR_LOCKED`) ⑤ **kısmi boya**: iş emrinin canlı toplarından biri ZATEN mevcut hedef renkteyse (fasondan döndü / iç istasyonda boyandı) ama kilit devrede değilse (kısmi kabul penceresi) → onaysız 409 `COLOR_PARTIAL_CONFIRM` ("N top zaten KIRMIZI boyandı; kalan M top MAVİ gelecek… Tebdil ile ayırın"); `confirmPartial:true` ile geçer, audit `partialConfirmed`; toplara DOKUNULMAZ (kilit yalnız HEPSİ döndüğünde — mevcut kural korundu; "telefonla renk değişti" senaryosu çalışır, iki renk bilinçli olur) ⑥ rota kapsaması: renk veren adım yoksa **REDDETME, UYAR** (`warnings[]`; açılışta `assertRouteCoversTargets` 400 vermeye devam eder). `ApiResponse.warnings?` alanı üç katmanda da eklendi (backend/Electron/mobil). Top kapsamı tek tanım: `helpers/workorder-rolls.helper.whereRollsOfWorkOrder` (link servisinden taşındı, aynı adla re-export).
> • **COMPLETED kapatma kümesi İKİ AYRI LİSTE:** `PLAN_CHANGE_FROZEN_STATUSES` (renk / en / uyumsuz-bağ override → COMPLETED dahil) ↔ link servisinin `FROZEN_STATUSES` (bağla / bağı kaldır / toplara uygula → yalnız CANCELLED+SUPERSEDED). **COMPLETED'da uyumlu "Sipariş Bağla" BİLEREK AÇIK** (stok için üretildi, sonra sipariş geldi). Electron başlık + yan panel `canChangePlan` ile Rengi/Eni Değiştir düğmelerini bitmiş iş emrinde çizmez; backend 409 tek gerçek kapı. Override zinciri (`linkOrderLineWithOverride`) `changeTargetColor`'ı **`confirmPartial:true`** ile çağırır — öncülü zaten "elimdeki mal siparişin renginde" beyanı + ② adımda topları eşitliyor; onayı tekrar sormak cevabı verilmiş soruyu sormaktı.
> • **Fason kabulde hedef renk KİLİT ALTINDA taze okunur** (`subcontractor.service.receive`): pre-tx okunan `wo.targetColorId` bayatlayabiliyordu ve tablet `appliedColorId`yi DAİMA gönderdiği için (override yolu) eski renk sessizce yazılırdı — pencere birkaç saniye değil, ekranın açık kaldığı tüm süreydi. İki koruma: (a) override yoksa renk taze hedeften; (b) istemci `expectedTargetColorId` (ekranı açarken gördüğü hedef, null=hedefsiz) gönderirse ve taze hedef farklıysa **409 `TARGET_COLOR_CHANGED`** (`currentColorName` details'te); alan yoksa kontrol yok (eski APK fail-open). Mobil `buildReceivePayload` alanı grup nesnesinden kendisi türetir (yeni arg yok, jest 44/44); `FasonKabulScreen` bu kodda `pending-returns`'ü tazeler + özel toast.
> • **"Renk veren adım" TEK YÜKLEM `stepCanApplyColor`** artık manuel taşıma backflush sentezi (`workorder-manual-move`) ve parti ayırma (`workorder-split.colorStep`) için de geçerli (eskiden yalnız `requiredCategory.appliesColor`). **`kursunFinish` 3c:** adım renk verebiliyorsa (istasyon bayrağı / fason hizmeti) ve top renksizse WO hedef rengi yazılır — fason kabulün iç-istasyon aynası; bugün prod'da iç boyahane yok (aktif `appliesColor=true` tek istasyon "Boyahane (Fason)"), tanımlandığı gün kendiliğinden çalışır.
> • **Sipariş kalemi rengi dar uç `PATCH /orders/:id/lines/:lineId/color`** (`OrderService.changeLineColor`, `order:write`, sebep ≥3 + audit `ORDER_LINE_COLOR_CHANGED`): genel `update`'in "iş emri açılmış siparişin kalemleri değiştirilemez" kuralı KORUNUR; yalnız renk alanı gevşetildi (müşteri telefonla rengi değiştirdiğinde plan + sözleşme birlikte düzelsin). Kumaş/metraj/en değişmez; iptal/tamamlanmış siparişte 409; kurallar WO hedef rengiyle aynı (aktif + müşteriye atanabilir + `allowedColors`).
> • **Electron `ChangeTargetDialog` (kullanıcı: "sade/özet"):** bant DURUMA GÖRE — *"N top boyahanede → kabulde yeni rengi alır"* (eski genel "boyanmış mal için kâğıt işi değildir" cümlesi 5 renksiz fason topunda YANLIŞ okunuyordu: sistem doğru şeyi yapıyordu, ekran tersini söylüyordu) · *"N top zaten X boyanmış → aşağıdan seç / Tebdil"* · *"N top değişmez (sevk/kesim)"*; sipariş uyumsuzluğu **ÖNCEDEN** listelenir, satır başına karar `Bağ kalsın (uyarı) · Bağı kopar · Siparişi de X yap`; 409 `COLOR_PARTIAL_CONFIRM` sunucu metniyle gösterilir, "Yine de değiştir" aynı isteği `confirmPartial` ile tekrarlar. Tebdil sihirbazı (`/work-orders/:id/split`: REDYE_SAME_COLOR / NEW_COLOR / UNDYED_MOVE) bu senaryonun ("bir kısmı eski renk, bir kısmı yeni renge → yeni iş emri") zaten var olan yoluydu — diyalogdan görünmüyordu.
> • **Bekçi:** `scripts/test_wo_target_color_guard.ts` (44 kontrol: §1 COMPLETED, §2 kilit iki kapıda, §3 izinli liste, §4 uyarı iki kapıda, §5 kısmi onay + audit + ölü top sayılmaz, §6 kabul 409/taze renk/eski APK, §7 kalem rengi, §8 iç istasyon renk yazar / vermeyen yazmaz). Komşular yeşil: `test_workorder_order_link` 61, `test_helpers` 61, `test_fason_partial_receive` 53, `test_kursun_bypass` 149, `test_tambur_plan_gate` 48. ⚠️ Negatif sonda (bekçiyi kasten kırıp kırmızı görmek) bu turda YAPILMADI — paylaşımlı ağaçta eşzamanlı ikinci oturum aynı dosyaları düzenliyordu, geçici src mutasyonu riskliydi; ilk fırsatta §1/§2/§5 için yapılmalı. **Migration YOK, izin YOK.** Deploy: backend ÖNCE güvenli (eski APK `expectedTargetColorId` göndermez → kontrol yok; eski Electron yalnız bitmiş iş emrinde 409 metni görür); Electron + APK sonra.
> • **2. TUR (aynı gün — kullanıcı: "planlamacı iş emrinin TÜM açık kumaşlarının rengini düzeltebilsin, Tambur renkle uğraşmasın"):** İlk turun "boya adımı COMPLETED → kilit" kuralı iki şeyi yanlışlıyordu: (a) boya bitmiş ama toplar renksizse de kilitliyordu; (b) asıl istenen düzeltmeyi — *"beyaz diye kaydedilmiş mal aslında ekru; plan + tüm açık kumaşlar ekruya"* — boya bittiği için engelliyordu ve **Tambur süpervizör zinciri** (`linkOrderLineWithOverride`, boya bittikten sonra çalışmak için yapılmıştı) aynı yüzden kırılmıştı. **KİLİT ARTIK ADIMA DEĞİL MALA BAKAR:** `mismatch` = canlı, boyanmış ve yeni renkte olmayan toplar (bu istekle düzeltilecekler `recolorRollIds` HARİÇ; fasondakiler hariç) · `pending` = henüz boyanmamış (renksiz+yolda ya da fasonda) → `mismatch=0` SERBEST (kayıt düzeltmesi — plan gerçeğe yetişir) · `mismatch>0 && pending>0` 409 `COLOR_PARTIAL_CONFIRM` (onayla geç) · `mismatch>0 && pending=0` 409 **`COLOR_DYED_BLOCKED`** ("mal zaten X boyandı, boyanacak top kalmadı — bu iş emri X biter → Tebdil / yeni iş emri / topları da düzelt"). `computeWorkOrderLocks.targetColor` yalnız Düzenle formunun alanını pasifleştirir (metni "Rengi Değiştir ile düzeltilir" diyor). Override zinciri `editableIds`'i plan yazımından ÖNCE çözüp `recolorRollIds` olarak geçer → yeniden çalışır. **Planlamacı yetkisi:** `POST …/apply-attribute-to-rolls` `requireAnyPermission("roll:manual-adjust","workorder:write")`; servis `workorder:write` taşıyan (süpervizör olmayan) kullanıcı için tekil motora izin listesi VERMEZ (= dahili çağrı; ALWAYS_BLOCKED + sebep yine motorda) — iş emri kapsamlı toplu düzeltme PLANLAMA işidir; tekil Düzelt / Tambur "Düzelt" eski kuralla (süpervizör) kalır. ⚠️ SoD notu (2026-08-06 "roll:manual-adjust yalnız Muhasebe/Süpervizör") bu kapsamda bilinçli genişletildi.
> • **Kabulde plandan farklı renk → TEK SORU (`planColorAction`):** tablet (`FasonKabulScreen`, ConfirmDialog) kaydetmeden önce sorar: **"İş emri de X olsun"** (`APPLY_TO_PLAN` → kabul tx'i sonrası best-effort `changeTargetColor(confirmPartial:true)`; tek bekçi reddederse kabul geçerli kalır, yanıt `warnings` ile söyler) · **"Sadece bu toplar"** (`ROLLS_ONLY` → doğan her top için `RollPlanDeviation` satırı tx İÇİNDE, `source="fason-receipt"` (`FASON_RECEIPT_DEVIATION_SOURCE`); **Tambur kapısı aynı top+alan+değerlerle satır görürse renk sorusunu TEKRAR SORMAZ** — plan sonradan değişirse değerler tutmaz, kapı yine sorar) · Vazgeç. Alan gönderilmezse eski davranış (Tambur yakalar). Electron `FasonReceiveDialog` renk seçtirmez (yalnız hedefsiz WO'da `colorRequired`) → orada soru yok. Mobil `buildReceivePayload` yalnız gerçekten farklıysa yazar (jest 44/44).
> • **Electron `ChangeTargetDialog`:** "Tümünü seç" (planlamacı düzeltmesi tek hamle), `recolorRollIds` ile plan isteği, `COLOR_DYED_BLOCKED` → kutu + düğmeler: *Tebdil — yeniden boya* (diyalog içinden `TebdilWizard`, boyanmış top içeren ilk parti) · *Yeni iş emri aç* (`/operations/work-orders/new`) · *Kayıt yanlış — tüm topları X yap* (Tümünü seç). Bekçi `test_wo_target_color_guard` **59** kontrol (§2 mal–plan: hepsi düzeltiliyor → serbest, yarısı → kapalı, boya bitmiş+renksiz → serbest; §9 kabul kararı ROLLS_ONLY/APPLY_TO_PLAN + kapı muafiyeti + plan değişince kapı yine sorar; §10 planlamacı toplu düzeltme / `roll:read` ile değil). Komşular yeşil: order_link 61 · plan_gate 48 · helpers 61 · fason_partial 53. Negatif sonda hâlâ yapılmadı (paylaşımlı ağaç).

> ⚠️ **PROFİL GERÇEĞİ:** Fason modülü yüzeyi; `fason.shrinkTolerancePct` varsayılanı (%10) bu fabrikanın boyahane deneyimidir, kumaş cinsine/kuruluma göre değişir. **Çekirdek:** "fark DEFTERE yazılır (`RollVariance`, `SUBCONTRACTOR_RETURN`)", `sourceRefId` terslemenin ADRESİDİR, "⚠️ toleransta `<=0 → null` kalıbı YASAK (0 = tolerans yok, null = varsayılan)" ve "RESTRICT FK: fason kabulü yapan HER test cleanup'ı `rollVariance.deleteMany` içermeli" — bkz. MODUL-BAYRAK-TASARIM §11.

> **NOT (2026-08-21 — FASON KABULÜ: "çekme" bir HATA DEĞİL, ÖLÇÜLEN BİR GERÇEK; kısmi kabul TEK soruya indi):** Saha vakası: 5 parça (30/40/50/60/70 m) boyahaneye gitti, **220 m** döndü. Operatör ekranda tıkandı — ve tıkanmasının iki ayrı sebebi vardı. **(1) Ekran normal işi hata sanıyordu:** ön-dolu "dönen" satırı 250 m geliyor, 220 yazılınca **"EKSİK DÖNEN −30 m"** bandı + turuncu buton + kırmızı **"Giden / gelen uyuşmuyor — Yine de Kabul Et?"** modalı çıkıyordu. Oysa boyahanede kumaş **çeker**; 250→220 (%12) tekstilde rutindir. **(2) Kısmi kabul yanlış soruyu soruyordu:** "bu toptan kaç metre geldi?" — boyahane parçaları **dikip tek parça boyadığı** için bu sorunun fiziksel cevabı YOKTUR. Operatör 5 alanı kafadan bölüştürmeye çalışıyor, her düşürdüğü satır ayrı bir **yarım top** doğuruyor (5 hayalet, adım ACTIVE, WO fason hard-block'u devrede) ve fiziksel olarak **yok olan** 30 m "fasonda bekleyen mal" diye kayda geçiyordu. **(3) Üstüne, o 30 m hiçbir yere yazılmıyordu:** makbuz kalemi "kalanın tamamı kabul edildi" diyor, doğan toplar 220 m taşıyor; fark yalnız iki tabloyu yan yana koyan birinin görebileceği bir çıkarma işlemiydi — bu yüzden **Fason Karnesi her firmaya %0 fire basıyordu** (`subcontract-scorecard` dönen metrajı defterden okur, defter TAM kabulde kalanın kendisidir → fark **yapısal olarak** sıfır).
> • **SORU DEĞİŞTİ — kalan TEK sayıdır, dağıtımı sistem yapar:** satır başına "Gelen (m)" varsayılan **GİZLİ** (kaçış kapısı "Top bazlı gir" — etiketi korunmuş parça / tek toplu kabul). Yerine **"Fasonda kalan var mı?"** anahtarı (varsayılan HAYIR) + tek "Kalan (m)" kutusu. Dağıtım **BÜYÜK TOPTAN** başlar (`resolveReturns`): kalan mümkün olan **EN AZ** topa yığılır — orantılı bölüştürme beş topun beşini birden yarım bırakır ve kalan geldiğinde beş ayrı ikinci kabul isterdi. Tamamı kalan top dönüş listesine **HİÇ GİRMEZ** ("0 metre kabul ettim" diye bir kayıt yoktur). Sıra **deterministik** (eşit metrajda `rollId` ikinci anahtar) — yoksa aynı ekran aynı girdiyle farklı payload üretir ve offline replay aynı token'la FARKLI içerik gönderir. Dağıtım bir **KURGUDUR** ve öyle olmak zorundadır (hangi metrenin hangi topta kaldığı bilinmiyor); doğru olan tek şey TOPLAMDIR ve o korunur. Kalan ≥ işaretli toplam → 400 değil ARAYÜZ engeli ("hiç gelmediyse topları işaretten çıkarın").
> • **FARKIN ADI KONDU: ÇEKME.** Bant artık `ÇEKME 30 m (%12)` / `FAZLA DÖNEN +N m` yazar; rengi **NÖTR** (mavi), **yalnız fabrikanın belirlediği toleransın üstünde** amber olur ve onay modalı çıkar. Onay modalı iki duruma indi: **işaretsiz top** ∨ **tolerans aşımı**. Beyan edilen kalan modal ÇIKARMAZ — operatörün bilerek yaptığı işi hata gibi göstermek, tam da kaldırılan sürtünmedir. Buton tolerans İÇİNDEKİ çekmede **sararmaz** (normal işi uyarı rengiyle boyamak uyarının anlamını tüketir).
> • **YENİ AYAR (dört kapı):** `fason.shrinkWarnEnabled` (default **TRUE**) + `fason.shrinkTolerancePct` (default **10**). Yön gerekçesi `readTamburShortCutA1Enabled`'ın TERSİ ve bilinçli: bu bayrak operatörün kararını DEĞİŞTİRMEZ, görünür bir gerçeği gösterir → görünürlük varsayılan açık doğar. ⚠️ Toleransta `<= 0 → null` kalıbı **KULLANILMAZ**: kısa-kesim eşiğinde 0 "girilmemiş" (kural inert), burada 0 "hiç tolerans yok" (kural HER farkta ateşler) — zıt davranışlar. `null` (alanı temizle) → **varsayılana** döner, 0'a değil; susturmanın yolu eşik değil BAYRAKtır. Backend **ENFORCE ETMEZ** — kural sunum katmanındadır, eşiğin altındaki fark da deftere aynen yazılır.
> • **ÇEKME ARTIK DEFTERDE:** `RollVariance`, yeni kaynak **`SUBCONTRACTOR_RETURN`**; eksi yön **SCRAP** (mal vardı, metre gitti — RECORD_CORRECTION DEĞİL: sistemdeki sayı yanlış değildi, kumaş gerçekten çekti), artı yön **OVERAGE**. Sebep **sistem kodudur** (`SHRINK_REASON_CODE = "FASON_CEKME"`) ve `SCRAP_REASONS`'a **EKLENMEDİ** — o liste operatörün Tambur fire ekranında gördüğü listedir; oraya "Fason çekmesi" koymak tamburda kesilen bir topun firesini yanlış kovaya yazmanın yolunu açardı. `validateVarianceReason` kodu **kabul eder**, `reasonsForKind` **döndürmez** (`LEGACY_REASON_CODE` ile birebir aynı desen). Kısmi kabulde de yazılır ve bu DOĞRUDUR (o teslimatta 51 düşülüp 48 geldiyse 3 m çekmiştir; fasonda bekleyen kalan hesabın DIŞINDADIR). Çok toplu kabulde fark **tüketilen metrajla orantılı** dağıtılır (`allocateShrink`) ve **yuvarlama artığı SON satıra biner** — satır satır yuvarlanan dağıtım defter toplamını sapmanın kendisinden farklı bırakır.
> • **MİGRATION VAR — `RollVariance.sourceRefId`** (`20260821120000_roll_variance_source_ref`, salt ADD COLUMN + index, additive, vardiya içinde uygulanabilir). **Terslemenin ADRESİDİR:** makbuz iptalinde satırlar SİLİNMEZ, `reversedAt` alır (append-only defter). ⚠️ `rollId + source + step` ile aramak YETMEZ ve bu load-bearing: kısmi teslimatta AYNI top AYNI adımda birden çok makbuzda sapma üretir, iptal ise **LIFO** olduğu için yalnız SONUNCUSUNU kaldırır — adres olmadan iptal, önceki teslimatın **meşru** sapmasını da sessizce terslerdi.
> • **KARNE DÜZELDİ:** `collectDispatchItems`'a `adj` LATERAL'i eklendi — dönen metraj = defter (düşülen) **+** çekme/fazla satırları (`SCRAP` eksi, `OVERAGE` artı, `reversedAt IS NULL`). ⚠️ **Açık bakiyeye (`openQty`) GİRMEZ** ve bu bilinçli: fasonda bekleyen bakiye onun hesabından DÜŞÜLMEMİŞ metrajdır; çekme düşülen kısımda yaşandı, bakiyeden de indirmek gelmemiş malı gelmiş saymak olurdu. Bekçideki eski beklenti (160/40) "defter = fiziksel dönen" varsayımını kodluyordu — fire'ı yapısal olarak 0'a çiviteyen şey tam olarak oydu; artık 164/36.
> • **ARAYÜZ HATASI DA KAPANDI (sessiz metraj ikizlenmesi):** Tek Parça modunda operatör 250→220 yazar (satır "manuel" olur), sonra gelmeyen bir topu işaretten çıkarırsa `rebuildPrefilledNewRolls` ön-dolu satırı manuelin **YANINA** ekliyor ve dönen metraj **220 + 180 = 400** oluyordu. Yeni kural: **TEK PARÇA MODUNDA SATIR SAYISI HER ZAMAN 1**; operatör sayıyı bir kez yazdıysa toplam ONUNDUR (işaret değişse de dokunulmaz — ölçtüğü metre, hangi topların geldiğine göre değişmez). "Parça Ekle" yalnız PER_ROLL'da görünür. Mod geçişi ayrı fonksiyona alındı (`switchReceiveMode`): parça→tek toplanır (notlar birleşir), tek→parça **dokunulmamışsa** açılır, yazılmışsa korunur (ön-dolu EKLENMEZ). "Tek Parça / Adet Adet Geldi" anahtarı **DURUYOR** — o "gelen kaç parça?" sorusudur, çekme ise "kaç metre?"; ikisi bağımsız.
> • **Kalan beyanı ön-dolguyu da düşürür** (`expectedQtysFor`): ham `currentQty` yazmak, operatörün kendi söylediği sayıyı yok sayıp her seferinde sahte bir 30 m'lik çekme göstermek olurdu. Ayrıca **"ölçtünüz mü?" sondası**: tek parça modunda sayı hâlâ otomatik (dokunulmamış) ve gidenle birebir aynıysa tek satırlık hatırlatma — engel değil (eski kırmızı modalın yerine geçen, bu kez GERÇEK olan uyarı).
> • **⚠️ RESTRICT FK YAN ETKİSİ (yakalandı ve kapatıldı):** sapma defteri satırı duran top SİLİNEMEZ → fason kabulü yapan test cleanup'ları `23001` ile **yarıda kalıyor** ve arkasında hayalet kayıt bırakıyordu (`test_wo_input_attach_window` düştü; bir koşum 49 orphan sevk + 60 orphan top bıraktı). **23 test dosyasına** `rollVariance.deleteMany` eklendi; ölçüldü: düzeltmeden sonra tam paket koşumu sayaçları **değiştirmiyor** (60/6/49 → 60/6/49). Yeni fason kabulü yapan test yazarken bu satır ZORUNLU.
> • **Bekçiler:** backend `test_fason_partial_receive` **53** kontrol (P10 çekme defteri + sistem sebebi + `sourceRefId` + iptal terslemesi + karneye girmeme · P11 çok toplu dağıtımda toplamın korunması); mobil jest **68** (`resolveReturns` 6 senaryo — 30/70/100 m kalan, determinizm, işaretsiz top; `shrinkInfo`/tolerans 5; `switchReceiveMode` 5; payload 3). **Altı negatif sonda ile kırmızı verdiği doğrulandı:** dağıtım küçükten büyüğe → 6 · SINGLE'da ön-dolu geri eklenince → 1 · tolerans bayrağı yok sayılınca → 1 · çekme yazımı kapatılınca → 10 · karne düzeltmesi kalkınca → 2 · tersleme adresi bozulunca → 2. Dosyalar `cmp` ile birebir geri yüklendi.
> • **Deploy:** **backend ÖNCE** (yeni uç yok; ek alan/ayar eski istemciyi bozmaz — eski APK kalan beyanı göndermez, tam kabul çalışmaya devam eder) → Electron + APK birlikte. Migration VAR, **yeni izin YOK**. ⚠️ `prisma db execute` bu turda sessizce düştü ama `migrate resolve --applied` yine de "uygulandı" dedi (D-23); kolon `\d roll_variances` ile doğrulanıp psql ile koşuldu — **resolve sonrası doğrulama opsiyonel değildir**.

> ✅ **ÇEKİRDEK:** Partial UNIQUE seddi (tombstone predicate'iyle), "uygulama bekçisi KALIR — mesajı o verir, DB sessiz son hat", "kodu SUNUCU türetir, serbest metne kod UYDURULMAZ" ve `legacyTexts` eski-ad sözlüğü — veri bütünlüğü sınıfı, bayraklanmaz. ⚠️ Yalnız KAPSAM profil: hangi tabloların sedli olduğu (bugün 3) kurulumun ana-veri hacmine göre genişler; yeni tabloya sed eklemeden önce `find_fold_duplicates.ts`.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-22__2026-08-22-mukerrer-paneli-v2`: Sed migration'ının kapısı: 'mükerrer varsa RAISE EXCEPTION, deploy DÜŞER' → 'yumuşak kapı: o tablonun index'i ATLANIR + NOTICE, deploy geçer; temizlik sonrası aynı dosya yeniden koşulur (idempotent enforce)'. Sebep: sıfırlama rafa kalkınca kısıt prod'daki her deploy'u bloke ederdi (expand→backfill→contract).
> - KISMİ → `R:2026-08-25__2026-08-25-prod-un-uc`: 'Renk BİLİNÇLİ HARİÇ (renge sed yok)' → renge sed KURULDU, ama düz nameFold üzerinde değil `tr_fold_color(name)` İFADESİ üzerinde partial UNIQUE (`colors_nameFoldColor_key`, mergedIntoId IS NULL, yumuşak kapı). 'Düz nameFold renkte zayıf' gerekçesi korundu, sonucu tersine döndü.
> - KISMİ → `KOD:20260831120000_namefold_sed_kalan_tablolar + 20260901130000_name_fold_sed_depo_finans (nota yazılmamış)`: Sed kapsamı '3 tablo (customers·items·subcontractors)' değil: 2026-08-31'de defect_types·fabric_properties·peripheral_devices·product_recipes·quality_grades·return_reasons·routes + machines (KAPSAMLI: stationId,nameFold), 2026-09-01'de warehouses·cash_boxes·bank_accounts (mergedIntoId YOK → DÜZ unique) eklendi. Envanter bekçisi §10 doğdu.
>

> **NOT (2026-08-21 — SIFIRLAMA PENCERESİ: nameFold DB SEDDİ (3 tablo) + sebep KODU topun satırında):** Fabrika DB'si 2026-08-22'de sıfırlanıyor; "şimdiden revize edelim mi, ileride backfill'le uğraşmayalım" sorusu ölçüldü. Ticaret dalının (`feature/depo-mal-kabul`, 25 migration) mevcut tablolara dokunuşu küçük ve tamamı nullable (`rolls` 4 kolon, `sacks` 1, enum değerleri) → **pencere onun için değersiz**. Pencerenin tek gerçek işi, bugün canlıda mükerrer kayıtlar durduğu için konulamayan DB kısıtıydı (şemada dört yerde "Faz B6, kısıt HENÜZ YOK" yazıyordu; `20260819060000_search_fold §6` "sıfırlamadan sonra 5 satırlık risksiz migration" demişti). İkinci iş (b) pencereye bağlı değil ama erken yapılınca backfill sıfır.
> • **(a) KAPSAM KARARI (kullanıcı): 3 tablo** — `customers · items · subcontractors`. Yalnız bunlarda gerçek mükerrer vardı (pencere SADECE burada değerli), tombstone predicate'i (`mergedIntoId IS NULL`) yalnız bunlarda var, test etkisi küçük. Tasarım matrisi (`ARAMA-KATLAMA-SIRALAMA-TASARIM.md §2.2`, 16 tablo) ileride backfill'siz eklenebilir — diğer 12 `nameFold` tablosu uygulama bekçisiyle temiz kalır. **RENK BİLİNÇLİ HARİÇ:** `foldColorNameForCompare` ayraç + token-sırası bağımsız ("055-BEYAZ" ≡ "BEYAZ 055"); düz `nameFold` üzerine kısıt uygulama kuralından ZAYIF olur ve yanlış güven verir (`color.service.ts` notu).
> • **Migration `20260821150000_name_fold_unique_live`:** ön kontrol DO bloğu (sedli üç tabloda `mergedIntoId IS NULL` grupları; varsa `RAISE EXCEPTION` + düzeltme adresi) + `CREATE UNIQUE INDEX IF NOT EXISTS "<tablo>_nameFold_key" … WHERE "mergedIntoId" IS NULL`. **Mükerrer varken DÜŞER — BİLİNÇLİ** (sıfırlama ertelenirse önce Sistem → Mükerrer Kayıtlar). Ad Prisma varsayılanı: şemadaki `@@unique([nameFold])` `map:`siz aynı adı üretir (drift yok — `@@unique` + `@default(dbgenerated())` kombinasyonu `migrate diff`te ÖLÇÜLDÜ, 4/4 yeşil) ve `error.middleware`in `_<kolon>_key` regex'i kolonu doğru çıkarır (`_live_key` gibi ek "live" döndürürdü). `@@index([nameFold])` KALIR (GIN/btree arama yolu). Şema yorumları dörtte de güncellendi (Item/Customer/Subcontractor "kısıt VAR", Color "bilinçli yok").
> • **Neye karşı (uygulama bekçisi check-then-act'tir):** ① yarış (iki SELECT boş, iki INSERT) ② `duplicateNameField` verilmeyen yeni servis sessizce guard'sız ③ import adaptörü `nameGuard` beyan etmezse kontrol koşmaz (fail-open) ④ script/elle SQL/geri yükleme. **Bekçi KALDIRILMAZ:** Türkçe, kod bilgili 409'u ("zaten var" ↔ "PASİF, aktifleştirin") o verir; DB seddi sessiz son hat. P2002 dalına `UNIQUE_COLUMN_LABELS` (`nameFold`→"ad"): "Bu ad zaten kayıtlı (büyük/küçük harf ve Türkçe karakter farkı sayılmaz)."
> • **Yan dokunuşlar:** `find_fold_duplicates.ts` soy bağlı tablolarda tombstone süzer (rapor kısıttan pesimist olmasın) + sedli tabloyu ⛔ işaretler · `import-name-guard` soy bağlı modelde `mergedIntoId:null` (önizleme ↔ DB aynı şeyi söyler) · `test_consistency §18` + `consistency-check.sql`: customers'a `mergedIntoId IS NULL` (ölçüldü: dev'deki ilk müşteri birleştirmesi §18'i KIRMIZI yaptı — her merge bunu yapardı) + metin güncel · `test_db_invariants` PARTIAL_INDEXES +3 (`uniq:true`, predicate `("mergedIntoId" IS NULL)`; 88/88) · `test_master_data_name_dup` **§9 DB seddi** (servis atlanarak `prisma.create` fold-eş → P2002; tombstone'a çevrilince aynı ad SERBEST; tombstone + canlı varken ikinci canlı yine P2002; items/subcontractors aynı; 22/22) · sabit adlı fixture'lar damgalı (`test_printed_documents` "Test Müşteri/Kumaş/Kartela Fason", `test_document_customization`, `test_masterdata_guards` — artık kalan ad 2. koşumu P2002'ye düşürür; `test_master_data_name_dup §8` istasyon üzerinde, sed dışı, dokunulmadı).
> • **Dev DB temizliği:** 8 grup (müşteri 1 · kumaş 4 · fason 3) `MasterDataMergeService.merge` ile (tombstone, FK-güvenli; hard-delete DEĞİL) birleştirildi — yalnız dev; prod boş doğar; `tekserp_saha`/`adnansahin_ticaret`'e migration koşulmaz. Kalan `colors` 1 + `stations` 3 test artığı sed dışı.
> • **(b) `Roll.entryReasonCode` / `cancelReasonCode`** (`20260821150100_roll_reason_codes`, VARCHAR(64) nullable, index yok, metadata-only). METİN görünen kayıt, KOD rapor anahtarı (`RollVariance.reasonCode` sözleşmesi). **Kodu sunucu çözer — `reason-preset.service.resolveReasonCode`:** açık `reasonCode` geldiyse katalogda doğrulanır (GİZLİ satır kabul; bilinmeyen → 400 `REASON_CODE_INVALID`; metin boşsa preset metniyle dolar — kod dolu/metin NULL olmasın); yoksa metin label VEYA fullText ile `foldNameForCompare` eşlenir ("yanlış metraj girildi" ≡ "Yanlış metraj girildi" → `YANLIS_METRAJ`); serbest metne kod UYDURULMAZ (NULL). **Async, tx DIŞINDA** (önbellek bayatsa DB'ye gider; `applyRollDispositionsTx` tx içinde katalog okumaz → çağıran `reasonCode` geçirir). Mobil bugün yalnız metin gönderiyor (`fullText ?? label`) → APK değişmeden ilk günden dolar. **Yazma yolları (tam):** entry tek satır `createInitialEntry` (`opts.entryReasonCode`) ← `tambur-manual` ×2 (Zod `reasonCode` opsiyonel — `z.object` strip tuzağı) · cancel: `inventory.softDelete` (query `?reasonCode=`; **yan düzeltme** `cancelReason` 500 kırpması yoktu) + `roll-disposition.helper` (`args.reasonCode`) ← WO cancel/close/batch-drop (Zod + input tipleri). Audit `newData.reasonCode`; restore kodu da NULL'lar; `getRollHistory` CREATED `manualReasonCode`; liste/detay/barkod `include:` → otomatik. Dokunulmayanlar (CANCELLED yazıp iz yazmayanlar): `tambur-undo` ×3, `hardDelete`, `subcontractor.service` ×2. `KIND_STORES_TEXT` bayrağı KALIR (fullText saklama kararı), "kod saklanmaz" anlamı düştü; Electron ReasonPresets uyarıları `warning`→`info` ("kod aynı, rapor bölünmez"); mobil aynaları **sonraki APK** (açık kod gönderimi: `RollCancelModal`, `TamburScreen`, `TamburManualRollModal` sabit diziden `useReasonPresets`'e; çevrimdışı `BUILTIN_*` kodları GÖNDERİLMEZ, sunucu türetir).
> • **Bekçiler:** `test_reason_presets` **§5** (38: label/fullText/katlanmış İ-ı/kind karışmaz/serbest→null/gizli satır/uydurma kod/açık kod+boş metin/açık kod+metin ezilmez) · `test_roll_cancel_undo` 48 (katlanmış eşleşme → kod; kısa doldurma → kod null; restore → null; serbest metin okutma yanıtında null) · `test_batch_drop` 33 · `test_roll_fold_and_reason` 15 · `test_tambur_manual_roll` 70 + `_produce` 78 (preset → `SAYIM_FARKI`; serbest → null; uydurma kod → 400). typecheck/typecheck:scripts/lint/check:migrations/migration_hygiene/schema_drift yeşil; Electron typecheck 0.
> • **Deploy:** ikisi de **backend ÖNCE**, istemci bekletilmez (ek Zod alanları opsiyonel; eski APK metin gönderir → kod türetilir). 28. migration sıfırlanmış DB'de risksiz; ertelenirse §10 reçetesi (`SURUM-2.9.0…md`). İzin YOK.

> ⚠️ **PROFİL GERÇEĞİ:** §21-§26 bekçilerinin bir kısmı fason/üretim varlıklarını sorgular — modül kapalı kurulumda o bölümler tanım gereği boş döner ve bu bir arıza DEĞİLDİR (bölüm kaldırılmaz, sıfır satır beklenir). **Çekirdek:** "TEK KAYNAK + AST bekçisi" deseni, `repointPendingBypassAssignmentsTx` sırası ve "üretilen metraj kalite kovası KATALOGDAN" — bkz. MODUL-BAYRAK-TASARIM §3 madde 8, §12 kural 9.

> **NOT (2026-08-21 akşam — Tutarlılık taraması: "türetilmiş alan / ayrışan yüzey" sınıfı kapatıldı):** `WorkOrder.type` hatasının (74d92085) sınıfından başka hata var mı diye 5 keşif ajanı + saha yedeği (`tekserp_saha`) tarandı (rapor `docs/history/TUTARLILIK-TARAMA-2026-08-21.md`), bulgular koddan teyit edilip 4 Opus ajanıyla uygulandı. **Kesin hatalar:** ① **Fason "açık+outstanding sevk" koşulu 22 yerde kopyaydı, 4'ünde `directShippedAt IS NULL` ve `receipt.cancelledAt IS NULL` YOKTU** (Fason Sevk picker `excludeWithOpenDispatch`, WO iptalinde açık sevk kapatma, mobil `hasOpenDispatch`, Hızlı Kabul preview) → kabul iptali (LIFO) sonrası sevk "kapalı", tam doğrudan-sevk sonrası "açık" sanılıyordu. TEK KAYNAK `helpers/fason-open-dispatch.helper.ts` (`OUTSTANDING_ITEM` · `OPEN_OUTSTANDING` · `outstandingItemOfOpenDispatch(extra)`; `as const` YOK, hep spread); 22 site helper'a bağlandı; AST bekçisi `test_fason_open_dispatch_single_source.ts` (kalıp `receiptItems→none→isPartial` yalnız helper'da; `cancelledAt:null + items.some` taşıyıp `directShippedAt` taşımayan dispatch where'i ihlal — `remainderClosedAt` ile model ayrımı) + davranış testi `test_fason_open_dispatch_semantics.ts`. ⚠️ **Davranış değişti:** kabul iptali sonrası WO Fason Sevk listesinden GİZLENİR (istenen); `subcontractor.service` sevk-iptali "başka açık sevk var mı" sayacı doğrudan-sevk edilmiş kardeşi artık açık saymaz (adım COMPLETED'a dönebilir — fiziksel gerçek). ② **`repointRollsTx` kurşun bypass atamasını taşımıyordu** → TRANSFER'da aynı tx'in sonundaki force-void atamayı iptal ediyor (makine atfı kayıp, Tambur "dağıtılmadan kapanış"), Tebdil/split'te SUPERSEDED WO'da öksüz atama. Çözüm: `kursun-bypass-guard.helper.repointPendingBypassAssignmentsTx` (workOrderId DENORMALİZE → ikisi birlikte; yalnız taşınan topların adımları; `repointRollsTx`'ten sonra, force-void'den ÖNCE — void kaynak WO id'siyle, repoint edilmiş satırı görmez); split'te hedef WO'ya atama TAŞINMAZ (toplar boyahaneye sarılır, planlamacı yeniden dağıtır) — recompute sonrası non-force `SPLIT_SOURCE` void + `supersedeEmptiedSourceWorkOrderTx`'te force `WO_SUPERSEDED` void. Bekçi `test_kursun_bypass_repoint.ts` (27). ③ **Kartelalık işareti değişince `Roll.labelDirty` yazılmıyordu** (etikette `kartelaMark` basılıyor): `setRollMarkedForKartela` atomik claim + `labelPrintedAt IS NOT NULL` ise her iki yönde bayat (basılmamış etiket bayatlamaz — sahte uyarı körleştirir). ④ **Sipariş iptali (`cancelWithActions` + legacy `softDelete`) kartı bayat işaretlemiyordu** → `markTravelerCardDirtyTx`; legacy `softDelete` artık yalnız PLANNED değil CANCELLED/SUPERSEDED dışı TÜM bağları siler + son bağı kalkan ORDER_PRODUCTION'ı STOCK'a çevirir (tip bağın aynası; `targetItemId` NULL ise çevirmez). ⑤ Electron `TravelerCardPrintDialog` ölü anahtar `["work-order"]` → `["work-order-detail"]`+`["work-order-branches"]` (2026-08-17 LinkOrderDialog dersinin ikinci vakası); ⑥ `BranchLanes` parti birleştirme `["work-orders"]` tazeler (transfer ile simetrik, onSettled). **Kararlar:** **D1** "üretilen metraj": liste `producedMeters` ve detay `producedRolls` artık AYNI tanım = 1. kalite + **A1** (fire hariç) ve kalite kovası KATALOGDAN (`roll-finalize.helper.loadProducedBuckets`: `QualityGrade.targetStatus` SCRAP→fire, A1_STOCK→a1, diğer/null/bilinmeyen→warehouse; isActive süzgeci YOK — pasif eski kod topun üstünde durur; `notIn: []` üretilmez; `unknownCodes` raporlanır); `"FIRE"/"A1"` gömülü kodlar kaldırıldı (şema 2467 ilkesi). Bekçi `test_produced_buckets.ts`. **D2** `Sack.labelDirty` artık üç yazma noktası: şablon değişimi · **içerik** (`markSackContentChangedTx` — eski `resetSackWeightsTx`; labelDirty AYRI updateMany — kg koşuluna bağlanırsa tartılmamış çuvalda hiç yazılmaz, ölçüldü) · **not** yalnız etkin şablon `sackNote` basıyorsa (`sackNoteAppearsOnLabel`, `CustomerTemplateRoute ?? LabelContextDefault` + `collectBoundKeys`). `repair_sack_ghost_rolls.ts`'teki elle kopyaya da eklendi. Bekçiler `test_label_dirty_sources.ts`, `test_order_cancel_card_dirty.ts`. **Küçükler:** `getCompletePreview.orderLinked` = `type===ORDER_PRODUCTION` (ikinci kaynak kalktı); Electron `RollDetailSheet` tek gösterim kaynağı `detail ?? roll`; "kalan metraj" üç kopya → `order-fulfillment.lineOpen` (clamp'li; davranış değişmiyor — tüketiciler `>0` süzüyor); mobil `PendingReturnGroup.workOrder.batchNumber` = İş Emri No yorumu. **Yeni bekçi çifti** `scripts/consistency-check-derived.sql` + `scripts/test_consistency_derived.ts` (test_consistency'ye DOKUNULMADI — eşzamanlı oturum düzenliyordu): §21 WO.type↔bağ (iki yönlü; `onDelete: Cascade` ile sessiz düşen bağ için), §22 IN_PROGRESS ama adımlar bitti, §23 açık bypass+terminal WO, §24a tek tam makbuzu iptal edilmiş "kapalı" kalem, §24b doğrudan-sevk + top hâlâ fasonda (spec'ten bilinçli sapma: `AT_SUBCONTRACTOR` süzgeci yoksa her meşru doğrudan-sevk drift sayılırdı), §25 kartela damgası baskıdan sonra değişmiş (audit `EXISTS`, 6 ay sınırı yazılı), §26 renk≠plan Tambur çıktısı — **bilgi modu** (saha'da 4 gerçek satır, 17 Ağu; kapı 19 Ağu) + §26b tarih eşikli gerçek check (`PLAN_GATE_SINCE`, varsayılan 2026-08-20; `roll_plan_deviations` sahada BOŞ → körlük zemini basılıyor). `--probe` aynı dosyada (ayrı test dosyası her `npm test`'te dev DB'ye bozuk satır yazardı), geri alınan tx içinde baseline farkıyla, 10/10 kırmızı→yeşil; gürültü filtresi eklenmedi (dev'de 501 fixture WO'da bile 0). **Doğrulama:** backend typecheck + typecheck:scripts + eslint temiz; 23 test yeşil (yeni 7 + komşular); Electron typecheck + vitest 128; mobil tsc. Negatif sondalar: I1 5, I2 10, I4 10 — hepsi kırmızı verdi, md5/sha ile geri yüklendi. **Migration/izin YOK; APK gerekmez** (mobil yalnız yorum); backend ÖNCE (K1 davranış değişikliği → operatöre not), Electron sonra. **Saha verisi (bu turda YAPILMADI, kullanıcı kararı):** IE1008260014 4 top EKRU↔BEYAZ · depoda FIRE 4 top · 2 top currentQty>initialQty · 3 mükerrer tanım · `fix_workorder_type_from_links.ts --apply` prod'da bekliyor. ⚠️ Paylaşımlı ağaç: eşzamanlı oturumun commit'leri (c3f6d118) ajanların bazı yeni dosyalarını yarım süpürdü (`test_fason_open_dispatch_single_source.ts` HEAD'de, helper'ı değil → HEAD'de o bekçi kırmızı) — bu paket commit edilince tutarlılık geri gelir.
> • **ANOMALİ TARAMASI (aynı gün, ikinci tur) — üç bulgu, üçü teyitli ve kapalı:** ① **Etiket düzenlenince eski metin koda çözülmüyordu** (taze-DB sondasında ölçüldü: `update()` eski label/fullText'i hiçbir yere yazmıyor; mobil `reason_presets_v1` önbelleği + `BUILTIN_*` zemini eski metni göndermeye devam eder → `Roll.*ReasonCode` NULL). Çözüm sektör kalıbı — stabil anahtar + ESKİ-AD SÖZLÜĞÜ: `reason_presets.legacyTexts TEXT[]` (`20260821220000_reason_preset_legacy_texts`), `ReasonPresetService.update` tek yazar (`nextLegacyTexts` saf: eskiler eklenir, güncel label/fullText'e eşit olanlar ve tekrarlar temizlenir, en yeni 20 kalır), çözücü sırası **güncel → eski adlar → null** (güncel ad eski ada karşı öncelikli: B'nin bugünkü adı A'nın dünkü adıysa B kazanır; iki satırda aynı eski ad → belirsiz → kod UYDURULMAZ). DTO'da salt-okunur (`legacyTexts`), Electron tipi opsiyonel, API'den düzenlenmez. Bekçi `test_reason_presets §6` (54). ② `workorder.routes.ts` `roll-attribute-targets` Swagger bloğunda `summary: "Toplara da uygula" için …` tırnaklı değer ardından metin → YAML parse düşüyor, uç Swagger'dan SESSİZCE kayboluyordu (sabahki `fc7a5034`'ten). Tırnak düzeltildi + **yeni bekçi `test_swagger_spec.ts`**: `swagger-jsdoc` aynı seçeneklerle `failOnErrors:true` (bozuk blok → kırmızı, dosya adı mesajda) + yol sayısı körlük zemini (≥120; bugün 382 yol / 469 işlem). `swagger.ts` `swaggerOptions`'ı export eder. Negatif sonda: blok bozulunca 3 kırmızı. ③ `seed-fixtures` upsert'i birleştirilmiş (tombstone) MUS-002'yi `isActive:true` ile DİRİLTİYORDU (dev DB'de ölçüldü) → `isMergedTombstone` yardımcısı: kod bulunur + `mergedIntoId` doluysa ATLA ve logla (ürün/renk/müşteri). Taze/CI DB'de davranış değişmez. Kapılar: typecheck/scripts/lint/drift/invariants/Electron typecheck yeşil.

> ✅ **ÇEKİRDEK:** **expand → backfill → contract** (kısıt veri temizlenmeden aynı sürümde gelmez) ve "prod'da `test_db_invariants` §1 kırmızı = enforce bekliyor, bilerek" — her müşteri kurulumunda aynen geçerli; yeni fabrikaya kurulumda taze DB sed'i ANINDA alır, göç edilen DB'de yumuşak kapı devreye girer.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `KOD:bba838ce 2026-09-01 duplicate-detection.service (nota yazılmamış)`: Kimlik kuralı artık her eşit değeri aday çift saymıyor: bir kimlik DEĞERİ IDENTITY_MAX_GROUP(=4) kayıttan fazlasında geçiyorsa YER TUTUCU sayılır ve çift ÜRETMEZ; bastırılan değer `suppressedIdentities` ile raporlanır. 'Kuyruğa aday düşer, yazma engellenmez' cümlesi bu kapsamda daraldı.
> - TAM → `R:2026-08-22__2026-08-22-mukerrer-paneli-v2`: Aynı notun arşiv metni içinde: 1-3. turun 'string-similarity.ts (Jaro-Winkler, token-SORT…)' kod tarifi 4. turda geçersiz — JW KALDIRILDI, skor sıralı KELİME hizalaması oldu (FIRM ortalama / PRODUCT en düşük çift). Arşivi okuyan JW'yi canlı sanabilir.
>

> **NOT (2026-08-22 — SIFIRLAMA RAFA KALKTI: nameFold seddi YUMUŞAK KAPIYA çevrildi; mükerrer paneli tasarımı):** Dünkü 28. migration "mükerrer varken RAISE EXCEPTION" idi (plan boş DB'ydi). Sıfırlama ertelenince bu, prod'daki HER deploy'u (29/30 ve sonrası) 9 mükerrer grup birleştirilene dek bloke ederdi — ve birleştirme iş kararı. Sektör kuralı **expand → backfill → contract**: kısıt veri temizlenmeden aynı sürümde gelmez. Dosya prod'a hiç uygulanmadığı için düzenlendi (`search_fold` emsali): tablo tablo bakar, **mükerrer yoksa index kurulur, varsa NOTICE ile atlanır**; temizlik sonrası aynı dosya yeniden koşulur (idempotent enforce). Şema `@@unique` KALIR (dev/CI/taze kurulumda sed anında); prod'da o güne dek `test_db_invariants` §1 kırmızı = "enforce bekliyor" (bilerek, unutulmasın). Dev checksum'ı `_prisma_migrations` satırı silinip `migrate resolve --applied` ile yenilendi. Taze-DB + mükerrerli-DB sondaları: temizde 3 index kuruldu, mükerrerlide NOTICE + deploy geçti, temizlik sonrası yeniden koşumda kuruldu. Karar (kullanıcı): A yumuşak kapı · panel kapsamı ana veri 4'lü + müşteri şubeleri + toplar (hayalet KK1) + istasyon/makine/kategori · tespit kesin ad + kimlik + bulanık ad · birleştirmede alan-bazlı survivorship. Tasarım: `docs/design/MUKERRER-PANELI-TASARIM.md`.

> ⚠️ **PROFİL GERÇEĞİ:** `shipping.confirmationEnabled` bu kurulumda KAPALI (`readShipmentConfirmationEnabled` varsayılanı `false`) — not "kapalı rejim" davranışını anlatır; açık rejimli fabrikada PLANNED doğal durumdur ve storno varsayılanı işaretsiz gelir. **Çekirdek:** "karo `visibleWhen` SAF bayrak", "iptal gövdesi TEK KAYNAK (`cancelPlannedShipmentTx`)" ve "route bayrağa bakmaz — derin bağlantı açılır, yalnız menüde çizilmez" — bkz. MODUL-BAYRAK-TASARIM §3 madde 3.

> **NOT (2026-08-22 — SEVK KAPISI = BAYRAĞIN EKRANI; storno kapalı rejimde sevkiyatı KAPATIR):** Saha sorusu (prod yedeği `tekserp_20260822_013613.dump`): sevk onayı bayrağı KAPALI fabrikada Operasyon hub'ında "Sevk Kapısı" karosu beklenmedik şekilde belirdi. Sebep: `SVK2008260008` 2026-08-20'de doğrudan sevk edilmiş, 2026-08-21'de **storno** ("Boyer'de böyle bir sipariş yok") ile `DISPATCHED → PLANNED`'a düşmüştü; karo kuralı 2026-08-05'ten beri "bayrak açık **VEYA** çıkış bekleyen PLANNED varsa" idi (storno işi bayrağı aç-kapa edilebilir yaptığı için eklenmişti — yoksa çıkış onayı yalnız o ekranda olduğundan mal kapıda, ekran yok). Kullanıcı itirazı haklıydı: **bayrak kapalıysa çözüm Sevk Kapısı menüsünden geçmemeli.** Ölçülen boşluk iki parçaydı: (a) storno sonrası sevkiyat PLANNED'da **çuvalları üstünde kilitli** bekliyordu (Paketleme "önce Sevk Kapısı'nda çıkarın" diyordu, çuval bir gün kilitli kaldı) ve kapalı rejimde "planlı sevkiyat" kavramının karşılığı yoktu; (b) geri alma penceresi "sonra ne olacak"ı söylemiyordu. İptal yolu zaten menüsüz çalışıyordu (Sevkiyatlar → İptal Et).
> • **Karar: 1 + 2 birlikte (kullanıcı onayı).** ① Geri alma penceresine **"Sevkiyatı da kapat — çuvallar depoya dönsün"** seçeneği: backend `undoDispatch(…, { releaseSacks })` storno gövdesinin ardından **AYNI tx'te** `cancelPlannedShipmentTx` çağırır (CANCELLED; çuval `shipmentId/seq` null, top `shipmentId` null ama **`sackId` KORUNUR** — depoya dönen şey çuvaldır; tahsis silinir, `ShipmentOrder.isActive=false`, `shippedQty` 0, tüm irsaliye sürümleri VOIDED; iade defterine yine yazmaz). İptal gövdesi **TEK KAYNAK** oldu: `cancelShipment` de aynı helper'ı çağırır (ikinci kopya, storno kapanışının çuvalı üstünde unutmasıyla ayrışırdı). **Varsayılan İSTEMCİDE** ve önizlemedeki yeni `confirmationEnabled` alanından kurulur: kapalı rejim → işaretli (PLANNED beklemenin karşılığı yok), açık rejim → işaretsiz (PLANNED doğal durum); kullanıcı iki rejimde de değiştirir. Bedel: yeniden çıkış Paketleme'den **YENİ sevkiyat / yeni sevk no** (eski irsaliye zaten VOIDED). **Storno izni (`shipping:undo-dispatch`) kapanışı da kapsar** — aynı kararın parçası, ayrıca `shipping:write` aranmaz. Seçenek işaretsizken metin "planlı durumda bekler; Sevkiyatlar'dan **Sevk Et** (açık rejimde + Sevk Kapısı)" der; işaretliyken "sevkiyat iptal olur, yeniden göndermek için Paketleme'den yeni sevkiyat". Düğme adı seçime göre "Sevki Geri Al" / "Geri Al ve Kapat". ② **Sevkiyatlar detayı (sheet + tam sayfa) PLANNED sevkiyata "Sevk Et"** verir — Sevk Kapısı'nın ORTAK `DispatchConfirmDialog`'u (çuvallar canlı listelenir, irsaliye başarı panelinden basılır; `shipping:write`). Böylece bayrak açıkken kurulup sonra bayrağı kapatılmış eski PLANNED sevkiyatlar da Sevkiyatlar'dan çözülür (① bunları kapsamaz). ③ **Karo kuralı saf bayrağa indi**: `visibleWhen: ctx => ctx.shipmentConfirmationEnabled`; `OperationsVisibilityContext` tek alan (`pendingPlannedShipments` + `sack-store/board?limit=1` sondası KALKTI; `useOperationsVisibilityContext` artık yalnız bayrağı okur). Route (`/operations/sack-store`) bayrağa bakmaz — eski sekme/okutma hedefi ("Sevk Kapısı'nda aç") yine açılır, yalnız menüde/palette çizilmez. ④ Metinler: Paketleme kilit uyarısı "Sevkiyatlar'dan iptal edin (çuvallar depoya döner) ya da — sevk onayı açıksa — Sevk Kapısı'nda çıkarın"; Genel Ayarlar bayrak açıklaması ekranın yalnız açıkken göründüğünü ve storno varsayılanını söyler.
> • **Reddedilen seçenek:** "kapalı rejimde storno HER ZAMAN kapatsın (sorusuz)" — aynı araca yeniden yükleme senaryosunu (plaka/şoför bilinçli korunuyor) ve açık-rejimden kalan PLANNED'ları kapsamazdı; seçenek + Sevkiyatlar'da Sevk Et ikisini de karşılıyor. "Yalnız yönlendirme mesajı" da reddedildi — Sevk Kapısı bağımlılığını çözmez.
> • **Geriye uyumluluk / deploy:** migration YOK, izin YOK, APK YOK (mobilde storno yok; tablet "Sevk Çıkışı" izin kapılı, bayrağa bakmıyor — değişmedi). **Backend ÖNCE**: eski Electron `releaseSacks` göndermez → sunucu `false` sayar → eski PLANNED davranışı. Yeni Electron eski backend'e düşerse `releaseSacks` Zod'da bilinmeyen alan olarak yutulur (strip) → yine PLANNED; kullanıcıya "kapatıldı" demez çünkü mesaj sunucudan gelir. Prod'daki `SVK2008260008` hâlâ PLANNED — deploy sonrası Sevkiyatlar'dan **İptal Et** (sipariş yok) ile kapatılır.
> • **Bekçiler:** backend `test_shipment_undo_dispatch` **§10** (50 kontrol: `released/freedSacks`, CANCELLED, çuval havuza, toplar rafına + ÇUVALDA, tahsis 0, isActive false, shippedQty 0, 3 sürüm VOIDED, iade defteri boş, iptal sonrası storno/iptal idempotent; önizleme `confirmationEnabled` boolean). ⚠️ Testte `/iptal/i` **"İptal"** ile EŞLEŞMEZ (JS `i` bayrağı U+0130'u katlamaz) → `/[İi]ptal/`. Electron `tile-visibility.test` (bayrak kapalı → gizli; ctx anahtar listesi kilitli — sayaç geri eklenirse derlenmez), CommandPalette mock'ları sadeleşti, Shipments + SackStore vitest 38 yeşil; iki taraf typecheck + lint temiz. `test_swagger_spec` yeşil (YAML bloğuna `releaseSacks` eklendi).

> ⚠️ **PROFİL GERÇEĞİ:** Bulanık eşleştirme profilleri (FIRM/PRODUCT gürültü kelimeleri, eşik %90) **bu fabrikanın canlı kopyasıyla kalibre edildi** (9 yanlış pozitif → 1 gerçek); yeni fabrikada ad yapısı farklıdır → eşik ve gürültü listesi kurulum başına yeniden ölçülür (`duplicatesFuzzyThresholdPct` zaten panelde). **Çekirdek:** "birim KELİME, karakter DEĞİL", "`token_set_ratio` KULLANILMAZ", "kimlik alanına DB seddi BİLİNÇLİ YOK" ve "inceleme SQL'de, UYGULAMA MOTORDA" — bkz. MODUL-BAYRAK-TASARIM §11.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `KOD:bba838ce 2026-09-01 duplicate-detection.service (nota yazılmamış)`: Kimlik kuralı artık her eşit değeri aday çift saymıyor: bir kimlik DEĞERİ IDENTITY_MAX_GROUP(=4) kayıttan fazlasında geçiyorsa YER TUTUCU sayılır ve çift ÜRETMEZ; bastırılan değer `suppressedIdentities` ile raporlanır. 'Kuyruğa aday düşer, yazma engellenmez' cümlesi bu kapsamda daraldı.
> - TAM → `R:2026-08-22__2026-08-22-mukerrer-paneli-v2`: Aynı notun arşiv metni içinde: 1-3. turun 'string-similarity.ts (Jaro-Winkler, token-SORT…)' kod tarifi 4. turda geçersiz — JW KALDIRILDI, skor sıralı KELİME hizalaması oldu (FIRM ortalama / PRODUCT en düşük çift). Arşivi okuyan JW'yi canlı sanabilir.
>

> **NOT (2026-08-22 — MÜKERRER PANELİ v2 P1 UYGULANDI):** Kullanıcı kararları: kapsam ana veri 4'lü + şube + toplar + istasyon/makine/kategori (P1'de yalnız 4'lü — motor desteği olmayan varlık kuyruğa girmez) · tespit kesin ad + kimlik + bulanık · eşik panelden · karar çift bazlı · hayalet topta asıl = etiketi basılan/hareket gören. **Kod:** `constants/duplicate-rules.ts` (kimlik kuralları: müşteri VKN/ihracat kodu/e-posta/telefon, fason VKN/telefon, kumaş kod harf-ikizi; renk hex BİLİNÇLİ YOK — canlıda `#ffffff` 7 meşru beyaz; gürültü kelimeleri; `FUZZY_PROFILE` FIRM/PRODUCT) · `utils/string-similarity.ts` (Jaro-Winkler, token-SORT, numerik token koruması, `compactKey`, `firmNameSimilarity`/`productNameSimilarity`) · `duplicate-detection.service` (tarama, union-find gruplama, referans sayısı, CSV) · `duplicate-review.service` (+ `DuplicateReview` tablosu, migration `20260822120000`) · merge hook MERGED · uçlar `/api/master-data/duplicates/candidates[.csv] | /reviews` · Electron `DuplicatesPage` (gerekçeli gruplar, çift başına Ertele/Mükerrer değil/Geri aç, CSV) · ayar dört kapı · bekçi `test_duplicate_detection` (55). **Canlı kopyada (2026-08-22 dump) üç tur ölçüm, her tur kuralı düzeltti:** ① `token_set_ratio` alt-küme adları %100 sayıyordu ("MODA" ⊂ "MODA ANKARA") → token-sort; ② kumaş/renkte gürültü listesi tek harfli ön ekleri ("A.GRİ", "S.BEYAZ") siliyor, Jaro-Winkler ön ek bonusu varyant ailelerini ("KRİSTAL GÜMÜŞ-EKRU/-GRİ", "ACTİVO SİYAH-(KREM/BEYAZ …)") %93-95'e çıkarıyordu → PRODUCT profili (gürültü yok, token sayısı eşit, JW yok); ③ birleşik token-sort oranı uzun ortak token'larla tek farklı kelimeyi sulandırıyordu (tag'li fixture'da "ekru"↔"gri" %90) → sıralı token çiftlerinin EN DÜŞÜK oranı. Sonuç: kumaş bulanık 9 yanlış pozitif grup → 1 gerçek (MIKROCANVAS/MİKRO CANVAS), renk 9 → 2 (kelime sırası; insan incelesin), müşteri 1 (BOYER EMRE/BOYER %90). Ders: bulanık kural **kayıt ailesinin yapısına** göre profillenmeli; tek genel skor ya gürültü ya da körlük üretir.
> • **4. TUR — KARŞILAŞTIRMA BİRİMİ KARAKTER DEĞİL KELİME (aynı gün, saha kararı):** Canlı kopyada müşteri tarafındaki tek bulanık aday `BOYER EMRE | BOYER` idi; kullanıcı **"farklı firma"** dedi. Ölçüldü: Jaro-Winkler **0.900** (tam eşikte), token-sort **0.500** — skoru eşiğe taşıyan şey JW'nin ORTAK ÖN EK BONUSU, yani adın sonuna eklenen ANLAMLI kelimeyi ("EMRE") yok sayması ("MODA" ↔ "MODA ANKARA" da aynı yoldan gelirdi). **JW kaldırıldı**; skor artık SIRALI KELİME HİZALAMASI (kelimeler sıralanır, karşılıklı eşlenir, eşi olmayan 0 alır): FIRM = çiftlerin ortalaması (gürültü kelimeleri düşülmüş), PRODUCT = en düşük çift + kelime sayısı eşitliği; iki profilde de sıkıştırılmış metin eşitse 1. Yan kazanç: eşik OKUNABİLİR bir ölçek oldu (%100 yazım/boşluk · %90 neredeyse aynı · %80 tek harf hatası) ve "fazladan anlamlı kelime" sınıfı HİÇBİR eşikte gelmiyor (0.50) — eskiden %80'e inince de geliyordu. Canlı kopyada eşik %90 ve %80 AYNI sonucu veriyor: müşteri 0 · kumaş 8 grup (1 bulanık: MIKROCANVAS/MİKRO CANVAS %100) · renk 5 (2 bulanık: kelime sırası) · fason 3. Bekçi 60 kontrol. **Ders:** bulanık eşleştirmede karakter benzerliği (JW/trigram) İSİM ALANLARINDA yanıltıcıdır — insan "kelime ekledi mi" diye bakar, algoritma da öyle bakmalı.
> • **P2–P5 UYGULANDI (2026-08-22 gecesi, kullanıcı "planı bitir" dedi):** ① **P2 alan-bazlı survivorship** — `merge-fields.ts` kataloğu (müşteri 12 · fason 5 · renk 3 · kumaş 1); `code` HİÇBİR varlıkta seçilemez (belgeye basılır + `@unique`; kaynağın kodunu taşımak tombstone'un kimliğini bozar), kimlik alanları zaten blocker. Seçim **DEĞER değil KAYIT** üzerinden (`fieldPicks[alan]=kayıtId`) — serbest metin alınsaydı uç, birleştirme kılığında sınırsız bir alan düzenleme API'si olurdu. Öneri kuralı MDM standardı (completeness → trust → recency). **⚠️ SIRA LOAD-BEARING:** survivor alan yazımı ATOMİK CLAIM'DEN SONRA — kaynaklar tombstone olduktan sonra partial UNIQUE onları dışlar; önce yazsaydık en sık senaryo ("kaynağın adını hedefe taşı") P2002 verirdi. Ad seçiminde grup dışı canlı eş → 409. İki ayrı audit satırı (kaynakta MERGE, survivor'da MERGE_FIELDS). Bekçi 54. ② **P3 kapsamı ÖLÇÜMLE önceliklendirildi:** canlıda şube 0 · istasyon/makine/kategori 0 · **top 6 küme / 8 fazla** → yalnız **P3c** yapıldı, diğerleri reçetesiyle ertelendi (sıfır ihtiyaç için üretim-kritik FK'lara yeni yazma yolu açmak yanlış). P3c'de fiil BİRLEŞTİRME DEĞİL İPTAL (top işlem kaydıdır; iki kaydı birleştirmek metrajı toplamak olurdu) — `MUKERRER` koduyla, topun KENDİ ucundan (`DELETE /api/rolls/:id`), toplu iptal ucu BİLİNÇLİ YOK ki etiket/çuval/sevk guard'ları atlanmasın; "asıl" = etiketi BASILAN top (sahadaki kâğıt onu gösteriyor); tespit `duplicate-rolls.service`e taşındı ve `find_duplicate_rolls.ts` artık yalnız YAZICI (script↔panel ayrışması yapısal olarak imkânsız). Bekçi 16. ③ **P4 CSV köprüsü** `apply_merge_decisions.ts` (dry-run varsayılan): dosya hataları TOPLU raporlanır ve hiçbir şey uygulanmaz, her satır önizlemeden geçer, `--apply`da düşen satır diğerlerini durdurmaz. **İnceleme SQL'de, uygulama MOTORDA** — ham UPDATE 42 kurallık FK haritasını, çakışma politikalarını, etiket/kart bayatlatmasını, advisory kilidi ve audit'i atlar. Canlı kopyada uçtan uca denendi (fason birleştirme + renk "mükerrer değil" → tarama 3→2 grup, çift gizlendi). ④ **P5:** enforce komutunu `find_fold_duplicates` temiz çıktıda kendisi yazdırıyor; kimlik alanına (VKN) DB seddi **bilinçli konulmadı** — aynı tüzel kişiye ikinci cari kart meşru bir iş kararı olabilir; kimlik alanı sektörde *eşleştirme sinyalidir*, tekillik kısıtı değil.

### 2026-08-22 — §13 kök nedeni: tekil geri almada AŞIM KORUMASI canlı dalda yoktu (ayna kırıktı)

> ⚠️ **PROFİL GERÇEĞİ:** §13'ün "canlıdaki 2 satır BİLEREK düzeltilmedi" ve §18'in "kumaş 5 · fason 2 grup" ölçümleri **bu fabrikanın verisidir** — yeni kurulumda mutabakat kapısı temiz doğar, o yüzden kırmızı satır "bilinen borç" değil GERÇEK bir sapma sayılır. **Çekirdek ve taşınabilir olan ders:** bir mutabakat kırmızısı üç ayrı şey demek olabilir — kod hatası (§13) · iş kararı bekleyen veri (§18) · sorgunun kör noktası (§20); üçünü ayırmadan "drift düzelt" demek ikisini yanlış yerden onarır.

Mükerrer paneli bitince, kullanıcının kararını bekleyen iki canlı-veri bulgusu (`§13`, `§20`)
**prod kopyasına karşı** ölçüldü (`tekserp_saha_0822`; `test_consistency` salt-okunurdur ve canlı
DB'ye karşı koşulabilecek şekilde yazılmıştır — asıl değeri orada). Sonuç: 22 bölümün **19'u
temiz**, üç sapma var ve üçünün de niteliği farklı.

**§13 (`currentQty > initialQty`) — 2 satır, KÖK NEDEN BULUNDU ve KOD TARAFI KAPANDI.**
İki topun ikisi de `SUBCONTRACTOR_RETURN`, ikisinde de `TAMBUR_UNDO_REOPEN` hareketi var, ikisinin
de TÜM çocukları `CANCELLED` ve birinde `currentQty` çocukların toplamına **birebir eşit** (698,9).
Yani metraj bir geri almayla geri konmuş. `tambur-undo.applySingle` üç dala ayrılıyor:

| Dal | Ne yapar | Aşım koruması |
|---|---|---|
| `parentArchived` | metraj geri DÖNMEZ, `RECORD_CORRECTION` yazılır | — (konu dışı) |
| `producedInStepId != null` → **`cutOpenFabric` (ÜRETİM)** | yalnız `currentQty` geri | **YOKTU** |
| else → `cutWarehouseRoll` (DEPO) | `currentQty` **ve** `initialQty` geri | yapısal olarak gereksiz |

Arşiv ikizi (`applySingleFromArchive`) ve `applyFull` ise `initialBump` hesaplayıp `initialQty`'yi
yukarı çekiyor **ve** deftere `OVERAGE`/`TAMBUR_UNDO_RESTORE` yazıyor. Üstelik arşiv dalının kendi
yorumu iki yolun *"birebir aynası"* olduğunu ve *"ayna bozulursa aynı kesimin canlı/arşiv geri alması
farklı muhasebe üretir"* dediğini söylüyordu — **ayna tam burada kırıktı.**

**Erişilebilirlik doğrulandı, varsayılmadı:** `tambur.overQuantityEnabled` **varsayılan AÇIK** ve canlı
DB'de bu anahtarın satırı **hiç yok** → üretimde açık. Senaryo sonda ile üretildi: 100 m kayıtlı topa
40+40+40 kesilir (aşım kesim anında deftere yazılır, `currentQty` 0'a tıkanır), parçalar tek tek geri
alınır → **üçüncüsünde** `currentQty(120) > initialQty(100)` ve deftere **hiç** satır düşmez.

    öncesi:  init=100 cur=120 · OVERAGE=1  ⛔
    sonrası: init=120 cur=120 · OVERAGE=2  ✅

Düzeltme arşiv ikizinin kalıbının **birebir aynısı** — yeni semantik yok: `TAMBUR_UNDO_RESTORE`
kaynağı 5b terslemesinin zaten kapsamı dışında (tersleme süzgeci bilerek dar: yalnız
`TAMBUR_FINALIZE`/`TAMBUR_WAREHOUSE_FINALIZE`; kesim anı aşımı da kapsam dışı, çünkü *kesimler
gerçekten yapıldı*).

- **Bekçi `test_tambur_undo §11`** (4 kontrol). §5 bu invariantı yalnız **FULL + DEPO kesiminde**
  ölçüyordu; üretim akışının kendi dalı **ölçüsüzdü** — bekçinin kör noktası, hatanın kendisiyle
  aynı yerdeydi. Negatif sondayla kırmızı verdiği kanıtlandı (koruma devre dışı → 3 kontrol düştü),
  dosya `md5` ile birebir geri yüklendi.
- ⚠️ **Canlıdaki 2 satır BİLEREK düzeltilmedi.** İkisi de 2026-08-08 / 08-11 tarihli, yani sapma
  defteri (`RollVariance`, 2026-08-19) gelmeden önce doğdular. Toplu `UPDATE` §13'ün kendi uyarısının
  ihlali olurdu ("geçmiş satırları toplu UPDATE ile düzeltmek kök nedeni gizler"); kapı onları
  görünür tutar ve düzeltmek bir **iş kararıdır**. Bölümü DARALTMA — düzeltilirse kendiliğinden
  yeşile döner.

**§18 (ad mükerreri) — 3 satır, doğrudan yeni panelin işi.** `items: BGR 150 ŞEFFAF` ·
`colors: 1195-GRİ` · `colors: ALTIN-EKRU`. Katlanmış ada göre bakınca (`find_fold_duplicates`,
prod kopyası): **kumaş 5 grup · renk 3 · fason 2**. Kumaş ve fason **sedli tablolar** → yumuşak kapı
o iki tabloda index'i ATLIYOR; birleştirilince migration yeniden koşulup enforce edilir. Renk sedsiz
(gözlem). Yani "sed neden eksik" sorusunun cevabı artık **panelin ekranında**.

**§20 (`WorkOrderStep.status`) — 1 satır, ZARARSIZ ve yapısal.** `IE0608260004` / Kurşun+KK2 adımı
`COMPLETED`, ama adımın tek topu (`T080826F0001`) sonradan iptal edildi → türetilen değer
`PENDING`'e çöküyor. Adım durumu **tarihsel bir olgudur** (2026-08-06'da gerçekten tamamlandı);
`recomputeStepStatus` ölü topları saymadığı için mutabakat onu sapma sanıyor. Veri bozuk DEĞİL,
mutabakat sorgusunun kör noktası — düzeltme gerekirse §20'ye "adımın tüm topları ölü statüdeyse
`COMPLETED` meşrudur" süzgeci eklenir, veriye dokunulmaz.

**Ders:** bir mutabakat kapısının kırmızısı üç ayrı şey demek olabilir — *kod hatası* (§13),
*iş kararı bekleyen veri* (§18), *sorgunun kör noktası* (§20). Üçünü ayırmadan "drift düzelt"
demek, ikisini yanlış yerden onarır.

---
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `kod:94b937c0 (2026-08-29, BULGU-T1-011 — NOTU YOK)`: 08-25 'kalan BEŞ kural' → 2026-08-29'da ALTINCI sinyal: Tambur geri almasıyla iptal edilen parça (cancelReasonCode=TAMBUR_GERI_ALMA ∨ audit izi) diriltilemez — metrajı kaynak topa iade edildiği için dirilme çift sayım üretiyordu. Parça satırına iz + currentQty=0 yazılır. HİÇBİR NOTA GİRMEMİŞ.
>

## 2026-08-25 — Saha deploy sonrası üç arıza: "kutu var, uç yok" · "soru var, süreç yok" · "ölçek var, sınır yok"

> ⚠️ **PROFİL GERÇEĞİ:** ②'nin ölçümü ("230 iptal / 1 fire, sebepli 24 iptalin hepsi kayıt hatası") ve ②c'nin "parti engeli kaldırıldı" kararı bu fabrikanın kullanımına dayanır. **Çekirdek:** İptal (`CANCELLED`, stok düşmez, `qtyOut=0`) ↔ Fire (`SCRAP`, stok düşer, `qtyOut=qtyIn`) ayrımı ve iki sebep kataloğunun İKİ FARKLI kapıdan geçmesi (`resolveReasonCode` ↔ `validateVarianceReason`) defter semantiğidir; ③'ün `SegmentedButtons` kuralı ve "yerleşim hatasında tahmin değil ÖLÇÜM" dersi de her kurulumda geçerli.

Fabrikaya backend+Electron+APK deploy edildikten sonra üç şikâyet geldi. Üçü de farklı sınıf
ve üçü de **yeni kodun ilk kez sahaya inmesiyle** görünür oldu. Teşhis, sunucunun 25.08 02:00
yedeği (`tekserp_saha_0825`, 2431 top / 209 iş emri) üzerinde yapıldı — 189 migration'ın hepsi
uygulanmıştı, yani hiçbiri veri/deploy arızası değildi.

### ① "Fasona renksiz gitsin" — YEDİ katmanda sessiz düşüş

`WorkOrderStep.dispatchWithoutColor` (2026-08-17 "ekru" kuralı) panelde işaretlenebiliyor,
kaydediliyor, çekide renk **yine basılıyordu**. Ölçüm: canlıda **623 iş emri adımının hiçbirinde**
işaretli değil; `route_steps`'te de sıfır. Yani özellik 8 gündür vardı ve **bir kez bile** üretime
yansımamıştı.

Sebep tek bir hata değil, aynı alanın yedi ayrı yerde düşmesiydi:

| # | Katman | Etki |
|---|---|---|
| 1-4 | `workorder.controller` Zod şemaları (`create.steps` · `create.stepPlanning` · `replace.steps` · `replace.stepPlanning`) | Zod bilinmeyen anahtarı **sessizce siler** — istek 200 döner, alan yoktur |
| 5-7 | `workorder.service`'in üç Prisma adım-yazımı (create nested `steps.create` · replace `update` · replace `create`) | `finalSteps` alanı taşıyordu ama DB'ye hiç ulaşmıyordu |
| + | `RouteService.ALLOWED_STEP_KEYS` | Şablona kaydetmek 400 verirdi → "şablondan miras" yolu da hiç kurulamadı |

⚠️ **Servis katmanı BAŞTAN DOĞRUYDU** (`overlay?.dispatchWithoutColor ?? s.dispatchWithoutColor ?? false`
üç yerde de duruyordu). Bu yüzden servisi doğrudan çağıran bir test **yeşil kalırdı** — bekçinin §1'i
bilerek METİN üzerinden koşar ve dört Zod bloğunu + üç yazım noktasını + allowlist'i ayrı ayrı arar.

Electron'un ana iş emri formu alanı **zaten gönderiyordu** (`stepsToCustom` taşıyor, F0813 "kesimde
kat düşüyordu" dersinin uygulanmış hâli); düşüş tamamen backend'deydi. Şablon yolları (
`buildFasonPlans` · `routeStepsToCreatePayload` · `workOrderPayload.stepPlanning`) taşımıyordu →
onlar da eklendi. ⚠️ `stepPlanning` süzgecine `dispatchWithoutColor` DA girer: yalnız o kutuyu
işaretleyip firma/kategori/not girmeyen adım aksi halde tamamen düşerdi.

Mobil Hızlı İş Emri'ne kutu eklendi (rota adımları ekranı, fason adımlarında). Değer **her fason adımı
için AÇIKÇA gönderilir (true de false da)**: yalnız true'yu göndermek, şablonda işaretli bir adımı
operatörün kapatma niyetini sessizce yutardı.

Bekçi: `scripts/test_dispatch_without_color.ts` (18 kontrol). İki negatif sondayla kırmızı verdiği
doğrulandı (Zod alanı silinince 1, create yazımı silinince 4 kontrol düştü); dosyalar `md5` ile
birebir geri yüklendi.

### ② Ölü etiket onayı KALDIRILDI — ve "stoktan kaldır" ikiye ayrıldı

Masaüstünde etiketi basılmış hiçbir top iptal edilemiyordu: `BulkCancelRollsDialog` düz
`DELETE /api/rolls/:id` çağırıyor, `confirmLabelPrinted`'i **hiç göndermiyordu** → 409 `LABEL_PRINTED`.
Üstelik hata `catch {}` ile yutulup yalnız "0 başarılı, 1 başarısız" yazılıyordu, yani operatör sebebi
hiçbir yerden öğrenemiyordu. (Aynı guard mobilde bağlıydı ve çalışıyordu — yüzeyler ayrışmıştı.)

**Kullanıcı kararı: guard kalksın.** Gerekçe kabul edildi çünkü doğrudur: onay bir sektör standardı
DEĞİLDİ — 2026-08-05'teki tek bir olaydan sonra eklenmiş yerel bir korumaydı ve karşılığında bir
"ölü etiket toplama" süreci hiçbir zaman kurulmadı. Kimsenin kullanmadığı bir liste uğruna operatörü
durduran onay, sıfır kazanç karşılığında yol kesiyordu. ⚠️ **KOLON DURUYOR**: `labelPrintedAt` baskı
anında otomatik yazılır, kimseye iş çıkarmaz ve soru bir gün sorulursa cevabı orada. Kaldırılan şey
veri değil, **soru**. `confirmLabelPrinted` sözleşme uyumu için kabul edilmeye devam eder (sahadaki
APK'lar gönderiyor) ama hiçbir kapı açmaz — geri koyarken bunu da hatırla, yalnız 409'u geri koymak
bayrağı göndermeyen istemcileri sessizce kilitler.

**Asıl kazanım ayrımın kendisi.** Kullanıcı "silme sektör standardına aykırıysa doğrusu ne" diye
sordu; cevap: fiziksel silme hiçbir ERP'de yok (geçmiş rapor bugün değişir, basılmış belgeler
sahipsiz kalır) ama **iki ayrı eylem** standarttır ve sistemde zaten ikisi de vardı:

| | Anlam | Stok | Fire raporu | SAP karşılığı |
|---|---|---|---|---|
| **İptal** (`CANCELLED`) | "Bu kayıt hiç olmamalıydı" | Düşmez (mal zaten yoktu) | Girmez | ters kayıt / MBST |
| **Fire** (`SCRAP`) | "Mal vardı, artık yok" | Gerçekten düşer | Girer | fire mal çıkışı / 551 |

Canlı veri kararı doğruladı: **230 iptal / 1 fire**, ve sebep yazılmış 24 iptalin tamamı
("Yanlış ürün/renk", "Mükerrer giriş", "Yanlış metraj", "Top fiziksel olarak yok") gerçekten kayıt
hatası. Yani saha zaten doğru kutuyu kullanıyor; eksik olan fire kutusunun masaüstünde hiç olmamasıydı.

Uygulama: `softDelete`'e `mode: "CANCEL" | "SCRAP"` eklendi + yeni uç
`POST /api/rolls/:id/scrap` (izin **`roll:manual-adjust`** — `roll:write` yetmez, fire gerçek bir
stok değeri kararıdır; iş emri kapanış dispozisyonlarıyla aynı çizgi). Farklar:

- **Hareket kapanışı:** iptal `qtyOut = 0` (storno — mal o istasyondan hiç geçmedi), fire
  `qtyOut = qtyIn` (mal geçti, sonra fire oldu). 0 yazmak istasyonun iş hacminden metrajı geriye
  dönük siler ve üretim raporunda hayalet kayıp yaratır.
- **Sebep kataloğu AYRI ve iki FARKLI kapıdan geçer** (`KIND_STORES_TEXT` ayrımı): `ROLL_CANCEL`
  metin saklar → `resolveReasonCode` (async); `ROLL_SCRAP` saklamaz → `validateVarianceReason`
  (senkron). ⚠️ `resolveReasonCode` bunu **tip düzeyinde** reddeder (`TextReasonKind`) — zorlama.
  Kodsuz fire'da kod **uydurulmaz**: `validateVarianceReason`'un `LEGACY_*` kovası sapma defterine
  aittir, topun satırına değil.
- **Çıkış izi kolonları PAYLAŞILIR** (`cancelledAt/ById/Reason/ReasonCode/preCancelStatus`). Adları
  "cancel" olsa da anlamları "defterden düşme izi"dir; hangi mod olduğu `status` ile okunur ve ayrım
  tek+kesin. Ayrı `scrapReason*` kolonları **açılmadı**: canlı DB'ye migration eklemenin karşılığı
  yalnız kolon adının hoşluğu olurdu. Geri alma yalnız `CANCELLED`'ta çalışır
  (`resolveRollRestoreBlockReason` ilk ifadesi statüye bakar) → fire geri alınamaz, doğrusu da bu.

Masaüstü penceresi yeniden yazıldı: her top için `cancel-preview` (uç 2026-08-05'ten beri vardı,
masaüstünden **hiç çağrılmıyordu**), engelli toplar denenmez ve backend'in KENDİ cümlesiyle listelenir,
başarısızların sebebi artık yutulmaz, etiket bilgisi satırda **bilgi** olarak durur, fire şıkkı
izinsiz kullanıcıya **çizilmez** (tıklayıp 403 almasın — kart↔route hizası kuralının aynısı).

Bekçiler: `test_roll_cancel_undo` §2/§2b **tersine çevrildi** (46→53 kontrol; §7 fire ayrımı eklendi)
+ `BulkCancelRollsDialog.test.tsx` (5 kontrol — iki modun ayrı uçlara gitmesi, engelli topun
denenmemesi, etiketin engel OLMAMASI).

#### ②b "İptal ettim, top arşivinde göremedim" — kayıt korunuyordu ama ULAŞILAMIYORDU

İlk iptal denemesinin hemen ardından çıktı ve ② ile aynı sınıf: **söz veri düzeyinde
tutuluyor, yüzeyde tutulmuyor.** `STATUS_GROUPS.ARCHIVE` yalnız dört "tüketilmiş" statüyü
taşıyordu (`RETURNED_FROM_SUBCONTRACTOR` · `TAMBUR_CONSUMED` · `SUBCONTRACTOR_CONSUMED` ·
`KARTELA_CONSUMED`); envanter sekmelerinin hiçbiri ölü statü listelemez. Sonuç: iptal edilen
ya da fire edilen bir top **hiçbir Electron yüzeyinde görünmüyordu**. Barkodla aramak da çare
değildi — iptal edilenlerin bir kısmı barkodsuz açık kumaştır. Canlı kopyada **231 CANCELLED
+ 1 SCRAP** kayıt böyle görünmezdi.

Düzeltme üç parça: ① `ARCHIVE` kümesine `CANCELLED,SCRAP` eklendi; ② sayfaya **arama kutusu**
kondu (200+ satırlık arşivde barkodu bilinen kaydı gözle taramak gerçek kullanım değil —
backend zaten barkodu TAM eşleştiriyor, kumaş/renk/alias `contains`); ③ **"Kayıt Türü"**
daraltma filtresi eklendi. ⚠️ Filtre anahtarı bilerek `statusIn`, `status` DEĞİL: backend
önceliği `statusIn[] > status > varsayılan` olduğu için sayfanın zorunlu kümesini EZER ve
seçenekler arşiv kümesinin alt kümesi olduğundan ezmek zararsızdır; `status` kullanılsaydı
aynı alana iki değer yazılır ve hangisinin kazandığı belirsiz kalırdı.

Ölçüldü (canlı kopya, gerçek liste yolundan): eski kümeyle barkod araması **0 satır**, yeni
kümeyle `T240826F0035/CANCELLED`. İptal penceresinin başarı bildirimi artık nereye gittiğini
de söylüyor ("Sistem → Top Arşivi'nde barkodla aranabilir") — arşiv 2026-08-05'te bilinçli
olarak "zor bulunsun" diye Sistem hub'ına taşınmıştı, o karar duruyor ama artık çıkmaz değil.
⚠️ Yan etki DEVAM EDİYOR: arşiv `admin:settings` arkasında, yani depo/üretim personeli iptal
edilen topu göremez. Bekçi: `Rolls/service.test.ts` — arşiv kümesi iptal+fire içerir, dört
tüketilmiş statüyü korur ve CANLI statü sızdırmaz.

#### ②c "Partiye kayıtlı" engeli KALDIRILDI — kullanıcı kararı: "SAP'taki gibi yap"

İptali geri alma yüklemi (`resolveRollRestoreBlockReason`) `batchId` dolu olan her topu
reddediyordu. Sektör karşılaştırması yapıldı ve karar buna dayandı:

**Standarda UYAN taraf.** "İptalin iptali" gerçek bir ERP kavramıdır (SAP: ters kaydın ters
kaydı) ve kapsamı somut ölçütlerle daraltmak da standarttır — SAP bir mal hareketinin iptalini
*sonrasında hareket olduysa · mal tüketildiyse · sevk edildiyse · dönem kapandıysa* reddeder.
Bizim kuralların dördü bunun birebir karşılığı (`movementCount` · `childCount` ·
`sackId/shipmentId` · `dispatchItemCount/kartelaItemCount`), beşincisi (`currentStepId`) de
"süreç emrine bağlı" karşılığı. Ters kaydın İZLİ olması da standarttır ve bizde var
(`CANCEL_RESTORED` audit'i, kim/ne zaman/neden).

**Standarda UYMAYAN taraf.** SAP'ta parti (Charge/Batch) bir ANA VERİ nesnesidir; bir belgenin
partili olması ters kaydı engellemez — engelleyen şey partinin sonradan hareket etmesi ya da
tüketilmesidir, ki onu ayrı kural zaten yakalıyor. Ölçüm (canlı kopya): 231 iptalin **86'sı
YALNIZ bu kural yüzünden** kilitliydi ve **85'i Tambur çıktısıydı** — sıfır hareket, sıfır
istasyon işlemi, sıfır çocuk. Parti kaydı onların üretimden geçtiğini değil, hangi grupta
DOĞDUKLARINI söylüyordu.

⚠️ Kuralın gerekçesi olarak gösterilen "adım durumu geri sarılmalı" riski burada YOK:
`recomputeStepStatus` partiye **hiç bakmaz** (üç sayacı da hareket üzerinden çalışır), yani
hareketsiz bir topu diriltmek hiçbir adım sayacını değiştiremez. O riski taşıyan tek kural
`movementCount > 0` ve o BUNDAN ÖNCE kontrol ediliyor. Geri koymadan önce bu paragrafı çürüt.

Sonuç (ölçüldü, canlı kopyada gerçek yüklem yolundan): geri alınabilir iptal **130 → 216/231**.
Kalan 15'in 11'i hareket görmüş, 4'ü istasyon işlemi almış — SAP'ın da reddedeceği durumlar.

⚠️ **AÇIK KALAN İKİ NOKTA (bilinçli, iş kararı bekliyor).**
① *Eski kayıtların rafı:* geri alma topu `preCancelStatus`'a döndürür; 05.08 öncesi 84 iptalde
o kolon NULL ve fallback `STOCK`'tur → bitmiş depo malı Ham Stok'a döner. Blokla çözmek
REGRESYON olurdu: bugün geri alınabilen 42 topun rafı da bilinmiyor. Doğru çözüm rafı topun
kendi verisinden (kalite `targetStatus`) türetmek, ama bu yeni bir yüklem demek — ölçülüp ayrı
karar verilmeli.
② *İz temizliği:* `restoreCancelledRoll` `cancelledAt/Reason/Code/preCancelStatus` kolonlarını
TEMİZLER, geçmiş yalnız audit'te kalır. SAP'ta orijinal belge durur. Kolonda kalıcı iz tutmak
migration ister; geri alma artık çok daha sık kullanılabilir olduğu için bu tercih yeniden
değerlendirilebilir (kök CLAUDE.md kuralı: "sebep audit'ten değil KOLONDAN okunur").

### ③ Fason Kabul'de "devasa dikey boşluk" — SegmentedButtons satırın tamamını alıyor, başlık SIFIR genişlikte

⚠️ **İlk teşhis YANLIŞTI ve düzeltildi.** İlk turda sebep "cihazın yazı ölçeği + sınırsız sarma +
dikey ortalama" sanıldı; `numberOfLines` ve `flex-start` yamasıyla APK 2.9.4 çıktı. Sahada boşluk
**sürdü** (bu kez düğmelerin ALTINDA). Bu kez tahmin yerine **tabletteki gerçek yerleşim ölçüldü**
(`adb exec-out screencap` + `uiautomator dump` → her kutunun piksel sınırları):

- Hayır/Evet düğmeleri satırın **tamamını** kaplıyor (x 55–1095 = 1040 px).
- "Fasonda kalan var mı?" başlığı ve açıklaması **hiç çizilmiyor** (görünüm ağacında yok).
- Düğmelerin altında ~380 px boşluk.

**Mekanizma:** RN Paper `SegmentedButtons`'ın her düğmesi `flex: 1`dir. Yoga, flex-grow çocuğu olan
bir kabı "at-most" ölçümünde **mevcut genişliğin tamamına** açar (non-legacy stretch:
`totalFlexGrowFactors ≠ 0` → `availableInnerMainDim` daraltılmaz) → SegmentedButtons = satır
genişliği → yanındaki `flex: 1` başlık kutusu **sıfır genişlik** alır → sıfır genişlikte metin
**karakter karakter alt alta sarılır**: başlık 21 karakter × ~18 px ≈ **380 px görünmez yükseklik**.
İlk sürümde açıklama (~100 karakter, `numberOfLines`sız) da aynı şekilde sarılıyordu → asıl
"devasa" boşluk; `alignItems: center` düğmeleri o bandın ortasına park ediyordu (operatörün tarifi
birebir: "uzun boşluk, ortasında evet/hayır, altında yine boşluk"). `numberOfLines={3}` açıklamayı
kısalttı ama başlık serbest kaldı → 2.9.4'teki ~380 px.

Bu aynı zamanda **"neyin evet/hayır'ı belli değil"** şikâyetinin cevabı: soru ekrana hiç çıkmıyordu.

**Düzeltme (2.9.5):** kart DİKEY — soru, cevap, detay alt alta; SegmentedButtons kendi satırında tam
genişlik; seçenekler kendini anlatır (**"Hepsi geldi" / "Bir kısmı fasonda kaldı"**, ikonlu —
başlık okunmasa da karar düğmeden belli). Top-bazlı giriş açıkken soru gizlenir ("iki dil aynı anda
okunmaz" kuralı). `newRollHeader`'daki `flex-start` yaması geri alındı (orada sorun yoktu — RN Paper
Button içerik genişliğinde kalır, flex:1 çocuğu yok).

**Genel kural:** `SegmentedButtons` bir `flexDirection:'row'` kabının doğrudan çocuğu OLAMAZ; yanına
bir şey konacaksa ona AÇIK `width` verilir (`minWidth` YETMEZ — 2.9.4'te `minWidth: 150` vardı ve
işe yaramadı). Bekçi: `mobil/src/test/segmented-buttons-row.guard.test.ts` (TS AST; sarmalayan
elemanın `style`ını `StyleSheet.create` anahtarından/satır içinden çözer; körlük zemini ≥3 kullanım;
negatif sondayla kırmızı verdiği doğrulandı — satıra sarılınca `FasonKabulScreen.tsx:1915`).

**Ders:** yerleşim hatasında tahmin değil ÖLÇÜM — tablet USB'deyken `uiautomator dump` her kutunun
sınırını verir; "hangi kutu 380 px" sorusu 30 saniyede cevaplanır. İlk turda ekran görüntüsü
istemeden koddan teşhis koymak tam olarak yanlış yere yama yazdırdı.

---
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `A:2026-08-26__2026-08-26-yari-mamul-filtre`: 'Yeniden Üretime Al' yalnız Bitmiş Depo'da, 'Ham Stok'ta GÖSTERİLMEZ' kararı döndü: buton Ham Stok + Yarı Mamul + Bitmiş Depo üç sekmede (ham/yarı mamulde 'Üretime Al' başlığıyla, `reworkMode`). Diyalog, quick-start yolu, fason firma kuralı ve ölü etiket uyarısı değişmedi.
> - KISMİ → `A:2026-08-25__2026-08-25-aksam-mobil-yeniden`: Sabah notunun 'AÇIK: tablet hâlâ bitmiş topu okutamıyor' kalemi aynı akşam kapandı: `status !== 'STOCK'` elemesi kaldırıldı, karar saf yüklem `scanClassify`a taşındı; `ATTACHABLE_STATUSES` backend `quickStart.attachable` ile birebir. Sabah notunun diğer kuralları yürürlükte.
> - TAM → `R:2026-08-25__2026-08-25-aksam-mobil-hizli`: Arşiv notunun 'AÇIK: tablet hâlâ bitmiş topu okutamıyor (status !== STOCK elemesi duruyor)' maddesi aynı gün kapandı: eleme kaldırıldı, karar saf yükleme (scanClassify) taşındı ve Hızlı İş Emri WAREHOUSE/A1_STOCK topu da kabul ediyor.
>

## 2026-08-25 — "Bitmiş kumaş tekrar iş emrine bağlanabiliyor mu?" — evet, ama HİÇBİR istemciden yapılamıyordu

> ⚠️ **PROFİL GERÇEĞİ:** "Ölçüm: 980 topun 4'ü iki WO'dan geçmiş" ve "sahadaki iki rotada da planlı firma yok" bu kurulumun verisidir. **Çekirdek ve çok-fabrikada tam da aranan ders:** *backend destekliyordu ama HİÇBİR istemci kullanamıyordu* — bir yeteneğin "var" sayılması için motor + en az bir çıkış yüzeyi + izin ataması ÜÇÜNÜN birden olması gerekir (aynı sınıf: modül anahtarı açık ama ekran yok). ⚠️ "Fason firma seçicisi LOAD-BEARING" uyarısı fason modülüne bağımlıdır.

Saha sorusu: bitmiş, final stoğa girmiş bir ürün tekrar boyahaneye gönderilebilir mi?

**Backend 2026'dan beri destekliyordu.** `attachRolls` ve `quickStart` kabul listesi
`STOCK / WAREHOUSE / A1_STOCK` — "her işlem final üretir" modelinin doğrudan sonucu: bir depo
topu yeni bir iş emrine sokulur, bitince finalize onu depoya geri indirir (`test_wo_warehouse_attach`
bunu 2026'dan beri doğruluyordu).

**Ama hiçbir istemci kullanamıyordu — İKİ ayrı kopukluk:**
1. **Masaüstünde ekran yoktu.** `PATCH /:id/attach-rolls` 2026-06-12'de kaldırılmıştı (hiçbir
   istemci çağırmıyordu) ve `quick-start`'ın Electron istemcisi hiç yazılmamıştı.
2. **Tablet okutmada eliyordu:** `useQuickWorkOrder.addRolls` içinde
   `if (roll.status !== 'STOCK') → "Stokta değil"`. Yani Hızlı İş Emri bitmiş topu kabul etmiyordu.

Ölçüm bunu doğruluyor: canlıda 980 topun **4'ü** iki iş emrinden geçmiş ve dördü de HAM
top (fasonda tüketilen normal akış). Bitmiş malı geri üretime alma yolu sahada **hiç
kullanılmamış** — çünkü kullanılamıyordu.

**Yapılan:** Envanter → Bitmiş Depo'da satır seçince çıkan **"Yeniden Üretime Al"**
(`ReworkRollsDialog`) → mevcut `POST /api/work-orders/quick-start`. Yeni uç YOK, migration YOK,
yeni izin YOK (`workorder:write` zaten kabul ediliyor). Ham Stok'ta GÖSTERİLMEZ: oradaki top
zaten üretime girmemiş, "yeniden" diye bir şey yok.

⚠️ **FASON FİRMA SEÇİCİSİ LOAD-BEARING.** İlk hâlinde yoktu ve "Fasona gönder" anahtarı
**sessiz bir no-op**tu: backend sevki ancak adımın firması çözülebiliyorsa yapar ve sahadaki iki
rotanın da adımlarında planlı firma YOK (ölçüldü) → anahtar açık kalır, çeki listesi hiç doğmazdı.
Firma `stepPlanning` overlay'iyle gider (mobil Hızlı İş Emri'yle aynı yol). Bekçi ayrıca buton
metninin de aynı yüklemden (`willDispatch`) beslendiğini kilitler — ayrıştığında buton olmayacak
bir sevki vaat ediyordu.

⚠️ **ÖLÜ ETİKET UYARISI — burada KESİN, o yüzden var.** Fason kabulünde orijinal top TERMINAL'e
çekilir (`SUBCONTRACTOR_CONSUMED`) ve makbuzdan YENİ kayıt doğar; koddaki gerekçe aynen: *"Top
fasona gittiyse mutlaka açıldı — boyahane/zımpara fark etmez, KİMLİĞİNİ KAYBEDER."* Yani bitmiş,
etiketi basılı bir topun barkodu bu yolculukta kesin olarak geçersizleşir ve mal YENİ barkodla
döner. Bu, aynı gün KALDIRILAN genel iptal onayından farklıdır: orada geçersizleşme bir
OLASILIKTI (kâğıt henüz yapıştırılmamış olabilir), burada KESİN. Yine de **engel değil bilgi**.
Koşul dar tutuldu (etiketli top **ve** ilk adım fason) — geniş tutmak uyarıyı gürültüye çevirirdi.

**Uçtan uca ölçüm (canlı kopya, gerçek servis yolundan):**
`T240826F0034` WAREHOUSE → iş emri `IE2508260002` · parti `P90` · fason çekisi `FS2508260001` →
top `AT_SUBCONTRACTOR`. Firma seçilmeyen ikinci denemede sevk beklendiği gibi atlandı
(iş emri açıldı, top `IN_PRODUCTION`).

**AÇIK:** tablet hâlâ bitmiş topu okutamıyor (`status !== 'STOCK'` elemesi duruyor). Masaüstü
yolu açıldığı için akış artık mümkün; tabletin de açılması AYRI bir karar (APK gerektirir).

> ⚠️ **BU AÇIK AYNI GÜN KAPANDI (2026-08-25 akşam):** eleme kaldırıldı ve karar saf yükleme taşındı — `mobil/src/screens/Modules/HizliIsEmri/scanClassify.ts` (dosya başlığı bu satırın kaldırıldığını açıkça yazar) + `useQuickWorkOrder.ts`; sıra kuralı da orada: iptal → statü → çuval/sevkiyat → kumaş kilidi. Ayrıntı için aşağıdaki "Mobil 'Yeniden Üretime Al'" notuna bak.

Bekçi: `ReworkRollsDialog.test.tsx` (7 kontrol — sözleşme gövdesi · dar uyarı koşulu · farklı
kumaş/çuval ön-engeli · firmasız sevk vaadi yasağı).
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `KOD:20260830090000_items_ad_kod_seddi + scripts/fix_kumas_kod_cakismasi.ts (nota yazılmamış)`: 'V-1430 kaldı → items seddi dev'de atlanır (dev'in tek kırmızısı)' bitti: 6 sıfır-kullanımlı kayıt temizlik script'iyle silindi, ardından items'a HEM ad (items_nameFold_key) HEM harf-duyarsız KOD seddi (items_code_fold_key ON upper(code)) sert olarak kuruldu.
>

## 2026-08-25 — Prod oturumunun üç "dev'de yapılacaklar" notu teyit edildi ve uygulandı (kur.ps1 · renk seddi · deploy notu)

> ⚠️ **PROFİL GERÇEĞİ:** `kur.ps1`, renk seddi ve `SURUM-2.9.0` bu fabrikanın kurulum/sunucu gerçeğidir; çok-fabrika döneminde `kur.ps1` ve deploy reçetesi **müşteri başına** doğrulanır (yayın adresi pakete derleme anında gömülür). **Çekirdek ders:** "prod notunun TEŞHİSİ tutar, 'repoda şu var / şu bekçi yeter' cümleleri VARSAYIMDIR" — 6'sı ölçümle düzeltildi; ayrıca "beklenen değeri gerçek değerle AYNI kaynaktan alan kapı, o kaynağın yanlış olmasını yakalayamaz".

Fabrika sunucusundaki Claude oturumu 24-25 Ağustos'ta üç not yazdı (`docs/history/*-DEV-YAPILACAKLAR.md`, her birinin başında "uygulandı — şu düzeltmelerle" damgası). Üçü de **teşhiste doğru, teslimatta/bekçide hatalıydı** — sınıf olarak: prod tarafı kodu göremez, "repoda böyle" varsayımlarını ölçemez. Her iddia repo + `tekserp_saha_0825` (prod'un temizlik-öncesi kopyası) ile ölçüldü.

### ① `kur.ps1` — otomatik geri alma çalışan kurulumu siliyordu (`deploy/kur.ps1`)
- **Açık gerçek:** `GeriAlOtomatik` "sil"e HEDEFE (`app\` var mı), "geri koy"a KAYNAĞA (`app.eski-*` var mı) bakıyordu. `[5/9]`'daki ilk `Move-Item` takılınca (açık Explorer/terminal/editor) `app.eski` hiç oluşmaz ama `app\` silinirdi. **Harness ile kanıtlandı:** orijinal script sahte klasörlerde `app\`'ı siliyor (`deploy/test/run-harness.sh docs/history/kur.ps1.2026-08-24.orig` → S1 4 kırmızı), onarılmış sürüm 12/12.
- **Onarım:** `app.eski` yoksa hiçbir şey silinmez + mevcut `app\` **pm2 ile geri kaldırılır** (notun yaması yalnız komut basıyordu → fabrika kapalı kalırdı); `Remove-Item`/`Move-Item` `-ErrorAction Stop` + try/catch (yarım silinmiş `app\` üzerine `Move-Item` düşmez, **içine taşır** — not "düşer" diyordu); `ecosystem.config.js` yoksa `Push-Location`'a girilmez; `KokeDon` (cwd `app\` içinde bırakılmaz) `GeriAlOtomatik`'in **ilk satırında** ([6/9] çağrıları `Set-Location $appDir` sonrası koşuyor — not yalnız script sonunu öneriyordu) + `Fail` + tüm çıkışlar; `-GeriAl` modunda aynı sınıf açık kapatıldı.
- **Yama 3 (kilit sondası) reddedildi:** `pm2 delete` sonrasına düşmek zorunda → `Fail` fabrikayı kapalı bırakırdı; Yama 1 + pm2 restart aynı sonucu fazladan taşıma riski olmadan verir.
- **Teslimat:** dosya repoda YOKTU (installer klasörü `ea478488`'de silinmiş; `git log --all -- "*kur.ps1"` boş) ve **script kendini güncelleyemez** (paket `app\` altına iner, script bir üst dizinde) → `deploy/kur.ps1` kaynak, sunucuya **elle kopya** (`deploy/README.md`). `paketle.ps1` hâlâ yalnız sunucuda — açık iş. pwsh Mac'te kurulu değil (brew cask pkg sudo ister); Microsoft tarball'ı `PWSH=` ile yeter.

### ② Renk ad seddi — uygulama kuralının SQL ikizi üzerinde (`20260825120000_color_name_unique_live`)
- Diğer 3 tablonun seddi 4 yolu kapatıyordu (yarış · `duplicateNameField` unutması · içe aktarım fail-open · elle SQL); renkte dördü açıktı. Düz `nameFold` renkte ZAYIF (ayraç + sayı-sırası bağımsız kural) → `public.tr_fold_color(name)` ifadesi üzerinde partial UNIQUE `colors_nameFoldColor_key` (`mergedIntoId IS NULL`), yumuşak kapı + `IF NOT EXISTS` (re-run = enforce).
- **Ayırıcı sınıfı AÇIK yazıldı, `\s` değil:** JS `foldColorNameForCompare` JS `\s` ile böler (NBSP/U+2028… dahil), PG `\s` ASCII-dışında ctype'a bağlı (dev ICU ↔ saha C) → `[\t\n\v\f\r    -     　﻿-]+`. **Tüm BMP + korpusta JS≡SQL** (`test_fold_contract` §2b, 40/0 — aynı dosyada, "tek bekçi" kuralı türeve de uygulanır).
- **Notun iki yanlış iddiası:** (a) "Prisma ifade-UNIQUE'i DROP etmek ister → drift allowlist" — **ölçüldü, drift YOK** (`users_username_lower_uq` emsali; `test_schema_drift` 4/0 index canlıdayken); şema notu buna göre yazıldı. (b) "§8 parmak izi — önerilir" — asıl zorunlu olan **§5 `EXPRESSION_UNIQUES` girdisi** (kapı iki yönlü, envanter-dışı index KIRMIZI; dev'de index kurulmadığı için sinsi — kırmızı ilk CI/prod'da çıkardı). Bölüme `predicate` desteği eklendi.
- **Yan düzeltmeler:** `find_fold_duplicates` renk grubunu düz `nameFold` ile kuruyordu (seddin yakaladığı çiftleri KAÇIRIR, "temiz" der, migration ATLANDI der) → JS renk kuralı; + iki **keskin tarama** (noktalama-sız ad, harf-duyarsız kod — prod'da 4 mükerrer bunlardan kaçmıştı; dev'de 3 kod çakışması buldu). `ColorService.assertNameAvailable` tombstone'u DIŞLAR (base.service ile hizalı — eskiden "PASİF var, aktifleştirin" deyip birleşmişi diriltmeye davet ediyordu). `error.middleware` `nameFoldColor`→"ad". `test_color_name_dup` +2, `test_master_data_name_dup` §9 renk sondası.
- **Sonda kendi kendini çürüttü (ders):** `Test Sed Renk ${suffix} 055` ↔ `055-… ${suffix}` — suffix salt rakam olduğu için kuralda **rakam blokları kendi sırasını korur** → eşit DEĞİL; sed doğruydu, sonda yanlıştı. Rakamlı fixture'ı harfe yapıştır (`X${suffix}`).
- Migration/izin YOK dışında: **migration VAR**, prod'da 0 grup ölçülmüş → ilk deploy'da kurulur (NOTICE `index kuruldu`).

### ③ Deploy notu düzeltmeleri (`SURUM-2.9.0` damgalandı + 12 madde · runbook §3/§9 paket akışı)
- İki 🔴: `SURUM §3` **ve** `DEPLOY-RUNBOOK §3` `git pull → build` anlatıyordu (fabrika paketle kuruluyor); `/health | findstr auditGuard` **hiç geçemez** (alan `/api/admin/health`, `admin:settings`). Prod notu yalnız runbook'u görmüştü — aynı bayat akış `MIGRATION-DEPLOY.md`, `URETIM-KONTROL-LISTESI.md`, `PM2-GECIS-DEVIR-NOTU.md`'de de vardı → tarihsel bandı. Runbook'un "migration öncesi otomatik yedek YOK" notu da bayattı (`kur.ps1` adım 3 `premigrate_` alır).
- Notun yanlışı: "swagger uyarısını not zaten söylüyor" → söylemiyordu; eklendi. Doğrulananlar: 4 fire migration'ı tabloda yoktu (eklendi), `import_runs` 17→16 kolon, `*_nameFold_key` "0 satır" ↔ "customers kurulur" çelişkisi (canlı: 1 → temizlik sonrası 3), boot log'u (`master-data:merge` + `WEB_SALES`), 13→35 iş emri, bekçi rakamları.
- **CSV:** prod'un sonradan birleştirdiği 4 grup `mukerrer-kararlari-2026-08-22.csv`'ye eklendi (kodlar dev kopyasından — prod'un temizlik-öncesi verisiyle birebir); V-1430 EKLENMEDİ (prod hangisini bıraktı yazmamış). ⚠️ CSV ayırıcısı `;` — gerekçe içinde `;` kullanılmaz (ilk yazımda iki satır bozuldu).
- **Dev DB prod'a eşitlendi:** 13 karar dev'de uygulandı (`--apply`), iki migration dosyası yeniden koşuldu → `colors` + `customers` + `subcontractors` sedleri dev'de kurulu; `items` V-1430 yüzünden atlanıyor (dev'in tek kırmızısı: `test_db_invariants` 90/1). Drift 4/0.

**Genel ders — prod'dan gelen "yapılacaklar" notu:** teşhis ölçümle gelir ve tutar; "repoda şu var / şuraya yaz / şu bekçi yeter" cümleleri ise **varsayımdır** — uygulamadan önce her biri ölçülür (bu turda 6 böyle cümle çıktı, 6'sı da düzeltildi). Notlar `docs/history`'de damgalı: nerede yanıldıkları da yazılı kalsın ki aynı sınıf bir daha tanınsın.

---
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `A:2026-08-25__2026-08-25-aksam-mobil-yeniden`: 'AÇIK: tablet hâlâ bitmiş topu okutamıyor (ayrı karar, APK ister)' kapandı: mobil Hızlı İş Emri okutması saf scanClassify yüklemine alındı ve WAREHOUSE/A1_STOCK topu da kabul eder (APK 2.9.6/vc53). Masaüstü ReworkRollsDialog ve fason firma seçicisi kuralı değişmedi.
>

## 2026-08-25 (akşam) — Mobil "Yeniden Üretime Al" + Fason Kabul boşluğunun GERÇEK sebebi

> ⚠️ **PROFİL GERÇEĞİ:** "ham+bitmiş aynı WO'da SERBEST · hedef renk BOŞ gelir · sebep İSTEĞE BAĞLI · 2. kalite DAHİL" dört karar da bu kurulumun tercihi (`production.enabled`); `WORK_ORDER_REWORK` kataloğunun içeriği de fabrikaya aittir. **Çekirdek:** yeni `ReasonPresetKind` eklerken **beş kapı birlikte** (şema+migration · backend katalog · Electron KIND_TABS · mobil union · mobil zemin) ve "mobil zemin GERÇEK kodları taşır" kuralı.

### A. Fason Kabul "devasa boşluk" — ikinci tur, bu kez ölçülerek

İlk tur yanlış teşhis koydu (yazı ölçeği) ve APK 2.9.4 boşuna çıktı. Tablet USB'deyken
`uiautomator dump` gerçek sebebi 30 saniyede verdi — ayrıntı ③ bölümünde. Ders kalıcı:
**mobil yerleşim şikâyetinde koddan tahmin yok, cihazdan ölçüm var.**

### B. Mobil Hızlı İş Emri artık BİTMİŞ topu da alıyor

Backend 2026'dan beri `STOCK / WAREHOUSE / A1_STOCK` kabul ediyordu ama iki istemci de
kapalıydı: masaüstünde ekran yoktu (aynı gün `ReworkRollsDialog` ile açıldı), tablette ise
okutma `if (roll.status !== 'STOCK') reject` ile eliyordu. Yani "bitmiş kumaşı tekrar
boyahaneye gönder" **hiçbir yerden yapılamıyordu** — 980 topun 4'ü iki WO'dan geçmiş, dördü de
ham top.

**Kullanıcı kararları:** ham+bitmiş aynı WO'da serbest (rozetle) · hedef renk boş gelir ·
sebep isteğe bağlı (hazır metinler + serbest kutu) · 2. kalite dahil.

**Uygulama:**
- `scanClassify.ts` — okutma kararı SAF yükleme alındı (satır içi `if` zinciri kaldırıldı).
  ⚠️ Sıra load-bearing: statü kontrolü çuval kontrolünden ÖNCE. `SHIPPED` bir topa "çuvaldan
  çıkarın" demek malın müşteride olduğunu gizler; bekçide ayrı kontrol var.
- `RollPickerModal.scopeTabs` — "Ham Stok / Bitmiş Depo" sekmesi. Sekme anahtarı sorgu
  anahtarına `effectiveFilters` üzerinden girer; girmezse sekme değişince liste tazelenmez.
  Prop verilmeyen beş çağıran (Kartela/Paket/Fason/İade) etkilenmez.
- `reworkPayload.ts` — sebep İKİ hedefe: metin → 1. adım notu → **fason çekisine talimat**;
  kod+metin → `WorkOrder.parameters.rework` (rapor anahtarı). Migration YOK: `parameters`
  zaten JSON kolon ve `quick-start` Zod şeması onu kabul ediyor.
  ⚠️ Kod UYDURULMAZ — bu kind metin saklamaz, sunucu koddan türetmez; katalogda olmayan kod
  bile rapora GİDER (bayat listeli tablet), ama kâğıda kod BASILMAZ.
- Yeni `ReasonPresetKind.WORK_ORDER_REWORK` (migration `20260825140000`) + 6 sistem satırı.
  **Beş kapı birlikte:** şema · backend katalog · Electron `KIND_TABS` · mobil union ·
  mobil çevrimdışı zemin. Mobil zemin GERÇEK kodları taşır (`BUILTIN_*` DEĞİL) — diğer iki
  metin-saklayan listeden farkı bu; uydurma kod rapor anahtarını çöpe çevirirdi.
- `ReasonPresetPicker` — serbest metin ÜSTTE + chip'ler altında deseni (2026-08-19 fire
  ekranından) üç kopyadan TEK bileşene alındı.
- Ölü etiket uyarısı onay adımında, koşul DAR (etiketli **ve** ilk adım fason). Burada
  geçersizleşme KESİN (fason kabulünde top `SUBCONTRACTOR_CONSUMED` olur, mal yeni barkodla
  döner) — aynı gün kaldırılan genel iptal onayından farkı budur.

**Bekçiler:** `scanClassify.test.ts` (12) · `reworkPayload.test.ts` (8) ·
`ReasonPresetPicker.test.tsx` (6) · `segmented-buttons-row.guard.test.ts` (2). Dördü de
negatif sondayla kırmızı verdi (eleme geri konunca 4 kontrol, çeki talimatı susunca 4 kontrol),
dosyalar `shasum` ile birebir geri yüklendi.

**AÇIK:** mevcut bir iş emrine sonradan top EKLEME hâlâ yok (`attach-rolls` ucu 2026-06-12'de
kaldırıldı) — her iki istemci de YENİ iş emri açar. SAP'ta da rework ayrı emirdir; kapatılan
boşluk bu değil.

## 2026-08-26 — Fabrikanın kendi eklediği sebep 60 saniyelik bir pencerede yaşıyordu ("taze ya da hiç" yanlış takas)

> ✅ **ÇEKİRDEK — çok-fabrikada BİRİNCİ SINIF:** "TTL'in işi TAZELİK'tir GEÇERLİLİK değil" (bayat liste döner + arka planda tazeler), "bayatlık ≠ boşluk — önbellek HİÇ dolmadıysa fail-closed KALIR", tek-uçuş yalnız ARKA PLANA ait (yazmalar kendi yazdığını görmek zorunda) ve "geçersiz kod `AppError` 400, düz `Error` 500'e düşer ve mobil kuyruk 5xx'i geçici sanar". Fabrikanın kendi kataloğunu düzenleyebilmesi tam olarak tek-gövde/çok-fabrika modelinin çalışma koşuludur.

**Saha bulgusu:** Tambur → "Bitir" → en alttaki **"Kayıt düzeltmesi"** → hazır seçeneklerden
biriyle sorunsuz, ama fabrikanın panelden/tabletten **kendi eklediği** sebeple: önce iyimser
"Tambur tamamlandı", sonra `1 sync`, sonra **"tamamlanmadı — sunucu hatası"**.

**Kök neden — bekçinin kör noktası hatanın kendisiyle aynı yerdeydi.** Sapma doğrulaması
(`validateVarianceReason`) transaction İÇİNDE ve SENKRON koşuyor, bu yüzden katalogu modül
düzeyi bir önbellekten okuyor (`reason-preset.service.cachedRows`). Önbelleğin 60 sn TTL'i
vardı ve dolduğunda fonksiyon **`null` dönüyordu** → doğrulama `constants/variance-reasons.ts`
KOD kataloğuna düşüyordu. Orada yalnız **sistem** satırları var. Yani:

* sistem kodu (`OLCUM_HATASI`, `TOP_BASI`…) her koşulda geçiyor,
* fabrikanın eklediği kod yalnız **bir yazma işleminden sonraki 60 saniye** içinde geçiyor.

Önbelleği tazeleyen tek şey boot ve katalog YAZMALARI olduğu için o pencere pratikte hiç açık
olmuyordu: sebebi ekleyen kişi bir dakika içinde denerse çalışıyor, operatör ertesi gün
denerse çalışmıyordu. **Ölçüldü** (dev DB, gerçek 61 sn beklemeyle): taze önbellekte KABUL,
61 sn sonra `Geçersiz sebep kodu: … (geçerli: OLCUM_HATASI, GIRIS_FAZLA, MUKERRER_KAYIT,
YANLIS_TOP, DIGER)`. `test_reason_presets §3` bunu göremezdi çünkü doğrulamadan hemen ÖNCE
`refreshReasonPresetCache()` çağırıyor, yani ölçümünü hep taze pencerede yapıyordu.

**Karar: TTL'in işi TAZELİK'tir, GEÇERLİLİK değil.** 60 sn önce okunmuş bir liste, hiç
okunmamış bir listeden her koşulda daha doğrudur. `cachedRows` artık **bayat listeyi de
döndürür** ve bayatlık okumayı düşürmek yerine arka planda bir tazeleme TETİKLER
(`scheduleBackgroundRefresh` — çağıranı bekletmez, tek-uçuş, DB düşerse 5 sn geri çekilir ve
ELDEKİ liste korunur). Aynı dayanıklılık async metin-kind yolunda da var (`rowsForTextKind`
artık başarısız tazelemeyi yutup bayat listeyle devam eder).

⚠️ **Bayatlık ≠ boşluk, ayrım bilinçli:** önbellek HİÇ dolmadıysa (boot uzlaştırması henüz
koşmadı) hâlâ kod kataloğuna düşülür ve fabrika kodu reddedilir — elde doğrulanacak bir şey
yokken fail-closed doğrudur. `expireReasonPresetCacheForTest()` (bayatlatır, satırları
KORUR) ile `invalidateReasonPresetCache()` (satırları da düşürür) bu yüzden ayrı iki
fonksiyondur; bekçi ikisini karıştırırsa düzeltmeyi değil başka bir şeyi ölçer.

⚠️ **Tek-uçuş tekilleştirmesi YALNIZ arka plan tazelemesine ait.** `refreshReasonPresetCache`
o kapıdan geçirilmedi: `create`/`update`/`duplicate`/`reorder` kendi yazdığını GÖRMEK zorunda,
uçuştaki (yazmadan ÖNCE başlamış) bir okumaya iliştirilemez — iliştirilseydi hata daha dar
ama aynı sınıftan geri gelirdi.

**İkinci kusur — "sunucu hatası" mesajının kendisi.** `validateVarianceReason` düz `Error`
atıyordu; `error.middleware` onu **500**'e çeviriyordu. Sonuç iki katmanlı: operatör sebebi
söylemeyen bir mesaj görüyor, mobil kuyruk da 5xx'i geçici sanıp **üç kez daha deniyor**
(`offline/mutations.ts`: 4xx fail-fast, 5xx üç deneme). Geçersiz sebep kodu bir İSTEMCİ
hatasıdır → artık `AppError.badRequest` + `details.code` (`REASON_CODE_INVALID` /
`REASON_TEXT_REQUIRED`), yani `resolveReasonCode`'un metin-kind tarafıyla aynı sözleşme.
`subcontractor.service` "kalan kapama"daki elle try/catch sarmalayıcısı kaldırıldı — kural
artık kapının kendisinde ve sarmalayıcı `details.code`'u yutuyordu.

**Bekçi:** `test_reason_presets` §3b (bayat önbellek) · §3c (400, 500 değil) · §3d (soğuk
önbellek bilinçli fail-closed) — 66 kontrol. **Dört negatif sondayla kırmızı verdiği
doğrulandı:** ① bayat→`null` geri konunca 4 kontrol, ② arka plan tazelemesi silinince 1,
③ 400 yerine düz `Error` atılınca 2, ④ `expireForTest` satırları da silseydi 3.
⚠️ "Kendini onarır" kontrolünün İLK yazımı **etkisiz sondaydı** — "kod kabul edildi mi" diye
soruyordu ve bayat liste de EVET der (② sondası yeşil kaldı). Dürüst ölçüm: önbelleğin
GÖRMEDİĞİ bir satır (servisle değil **doğrudan prisma ile** yazılır, yoksa create kendi
tazeler) bayat okumadan sonra görünür oluyor mu.

**Migration YOK · izin YOK · APK YOK.** Yalnız backend; deploy edilince sahadaki tabletler
değişmeden düzelir. Kapsam dışı bırakılan: geçmişte bu yüzden düşen kayıtlar (operatör
tekrar girdi, sistemde iz yok).

---
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `E:2026-08-26__otomatik-guncelleme-2026-08-26`: Yayın adresi değişti: arşivin ilk yazdığı `https://demo.etkiliyazilim.com/guncelleme/electron/` yerine müşteri segmentli `guncelleme.etkiliyazilim.com/<müşteri>/electron/`. Adres tek kaynağı `shared/update-feed.ts` ↔ `package.json > build.publish`; arşiv metni bunu kendi içinde de işaretliyor.
> - KISMİ → `kod: Electron/shared/update-schedule.ts (commit 2f158434, 2026-09-04) — bu bundle'da notu yok`: Panelin periyodik güncelleme kontrolü 4 saatten 15 dakikaya indi (kullanıcı kararı); açılıştan 30 sn sonra ilk kontrol aynen. Kök notun '4 saatte bir' cümlesi bayat.
>

## 2026-08-26 — Electron dağıtımı: setup elden ele taşınıyordu, güncelleyici KURULUYDU ama hiçbir yere bağlanmamıştı

> ⚠️ **PROFİL/OPS GERÇEĞİ:** Bu not TEK MÜŞTERİ döneminde başladı ve aynı gün çok-müşteriye taşındı — bugünkü geçerli yol düzeni `guncelleme.etkiliyazilim.com/<müşteri>/<ürün>/` (tek kaynak `Electron/shared/update-feed.ts` + `shared/musteri.json`). **Çekirdek:** "yayın adresi pakete DERLEME ANINDA gömülür → yanlış müşteri kodu başka fabrikanın güncellemesini kurar ve hata SESSİZDİR", `latest.yml` EN SON yüklenir, CF proxy AÇIK kalmalı, `add_header … always` YASAK.

**Şikâyet:** "Electron uygulamasını setup haline getirip fabrikada tek tek dağıtıyorum, bu çok yorucu."

**Ölçüm:** `electron-updater@6.8.3` `Electron/package.json` bağımlılıklarında **duruyordu**, ama `electron/` altında tek referansı yoktu (`grep` → 0 sonuç) ve `build.publish` bloğu da yoktu — yani electron-builder `latest.yml`i hiç üretmiyordu. "Yazıldı ama mount edilmedi" sınıfının bir başka örneği: paket kurulu, kablo yok.

**Kurulan akış:** yayın adresi generic provider (`https://demo.etkiliyazilim.com/guncelleme/electron/`); panel açılıştan 30 sn sonra ve 4 saatte bir `latest.yml`e bakar, yeni sürümü arka planda indirir, ekranın üstünde "Yeni sürüm hazır" şeridi çıkarır, kurulum kullanıcı "Yeniden Başlat" dediğinde yapılır. İşletme reçetesi: `docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md`.

> ⚠️ **BU ADRES BAYAT (aynı notun ilerisinde değiştirildi):** yayın bugün `https://guncelleme.etkiliyazilim.com/<müşteri>/<ürün>/` altındadır ve müşteri kodu tek kaynaktan gelir — `Electron/shared/musteri.json` (`kod: "adnansahin"`) + `Electron/shared/update-feed.ts`; `demo.etkiliyazilim.com/guncelleme/electron/` yalnız ilk kurulumun tarihçesidir, yeni paket ASLA o adrese kurulmaz.

**Kararlar ve neden böyle:**

- **Kurulum yeri `perMachine: true` KALDI** (kullanıcı kararı) — uygulama "Program Files"ta olduğu için her kurulumda Windows bir kez izin sorar. ⚠️ **O makinedeki hesap yönetici değilse güncelleme O MAKİNEDE hiç kurulmaz** (panel eski sürümle çalışmaya devam eder — sessiz bir "bazıları güncellendi, bazıları güncellenmedi" durumu doğurur). Ölçülmedi; sahada tek makinede bakılacak. Çıkış yolu tek satır: `nsis.perMachine:false` + bir elle tur daha.
- **`autoInstallOnAppQuit = false`** — kapanışta sessiz kurulum bilerek KAPALI. perMachine kurulumda kurulum yönetici izni ister; kapanışta tetiklenseydi operatör gittikten sonra ekranda cevapsız bir UAC penceresi asılı kalırdı. Kurulum yalnız kullanıcı başındayken, şeritten tetiklenir.
- **`quitAndInstall(true, true)`** — sessiz kurulum + kurulumdan sonra otomatik yeniden açılış. `isSilent=false` NSIS sihirbazını açar ve operatöre "İleri, İleri" yaptırırdı.
- **Şerit YALNIZ `ready` durumunda çıkar.** `downloading` gösterilmez (arka plan işi, gürültü); `error` de gösterilmez — internete çıkamayan bir makine her açılışta kırmızı şerit görürse şerit anlamını yitirir (körleşme). Hata Genel Ayarlar → Bu Bilgisayar → **Güncelleme** sekmesinde, oraya bakan kişiye yazılıdır.
- **Dosya adı ASCII'ye çevrildi** — `artifactName` eskiden `${productName}` kullanıyordu, yani ad "Adnan Şahin ERP-2.7.1-Setup.exe" oluyordu. Bu ad `latest.yml` içinde URL olarak geçer; `Ş` + boşluk aktarımda (FTP / nginx / Windows→Linux kopya) sessizce bozulup 404 üretir. Ürün adı kısayolda AYNEN kalır, değişen yalnız DOSYA adı: `TeksERP-<sürüm>-Setup.exe`.
- **Yayın adresi TEK KAYNAK `shared/update-feed.ts`** ve `package.json > build.publish` ile eşitliği bekçili (`src/test/update-feed-url.test.ts`, 3 kontrol; iki negatif sondayla kırmızı verdiği ölçüldü). Ayrışma arızası SESSİZDİR: uygulama A adresine bakar, Ayarlar ekranı B yazar, "dosyayı koydum ama gelmiyor" denir ve iz kalmaz. Bekçi ayrıca artifact adının ASCII kaldığını da kilitler.
- **Makineye özel adres ezmesi var** (`config.updateFeedUrl`, secure-store) — yayın adresi pakete DERLEME ANINDA gömüldüğü için, adres yanlış gömülürse düzeltmenin tek yolu yeni setup dağıtmak olurdu; yani tam da kaçınılmak istenen elle tur. Bozuk ezme sessizce yok sayılır ve varsayılana dönülür (makineyi güncellemesiz bırakmaktansa).
- **Hata metinleri Türkçeye çevriliyor** (`toTurkishError`) — ham metinler İngilizce ve teknik ("net::ERR_NAME_NOT_RESOLVED"); saha okuyucusu anlamadığı uyarıyı görmezden gelir. Tanınmayan hata ham hâliyle geçer (yutmak teşhisi imkânsız kılardı; tam metin `electron-log`ta zaten var).

**Kaçınılmaz olan:** otomatik güncelleme, makinede zaten güncelleyiciyi taşıyan bir sürüm varsa çalışır → sahadaki kurulumlar için **son bir elle tur** şart. Bundan sonrası kendiliğinden.

**Yan bulgu (bu işle ilgisiz, ortam):** `Electron/node_modules/recharts@3.8.1` diskte YARIM kuruluydu — `es6/util/cursor/` klasörü yoktu ve `electron-vite build` renderer aşamasında düşüyordu (npm tarball'ında dosyalar VAR, yani upstream değil yerel kurulum sorunu). `rm -rf node_modules/recharts && npm install recharts@3.8.1 --no-save` ile onarıldı, build çıkış kodu 0. Bu ağaçtan Windows setup üretmeden önce build'in yeşil olduğunu doğrula.

**Yayın sunucusu AYNI GÜN kuruldu ve doğrulandı.** Sunucuda nginx YOK — ortam **Docker + Traefik v3.5**. Ayrı statik servis eklendi (`/opt/stack/apps/tekserp-guncelleme`, nginx:alpine 64 MB), kural ``Host(`guncelleme.etkiliyazilim.com`)`` — kullanıcı Cloudflare'den A kaydını açtı. İlk kurulum `demo.etkiliyazilim.com` altında `PathPrefix(/guncelleme)` ile yapılmıştı; **kullanıcı ayrı alan adı istedi ve karar daha iyiydi**: demo bir SPA ve bilinmeyen HER yola 200 + `index.html` dönüyor (ölçüldü), yani yayın onun isim alanını paylaşsaydı "404 mü, SPA mı" ayrımı okunmaz olurdu. ⚠️ **TLS Cloudflare Origin CA** (`*.etkiliyazilim.com` wildcard, 2036'ya kadar, `traefik/dynamic/tls.yml` → default store; ACME YOK çünkü alan adı bu CF hesabının zone'unda değil): **Origin CA'ya yalnız Cloudflare Edge güvenir** → kaydın proxy'si (turuncu bulut) AÇIK olmak ZORUNDA; DNS-only'ye çevrilirse istemci sertifikayı reddeder ve güncelleme SESSİZCE durur. Wildcard sayesinde yeni alt alan adı için ek sertifika işi çıkmadı. Dosyalar `tekserp-demo`nun `public/`ine KONULMADI — orası imajın parçası, demo yeniden derlenince yayın silinirdi (fabrika sunucusundaki `kur.ps1` `app\` tuzağının ikizi). Yayın klasörünün sahipliği `oguzhan`a verildi: **`sudo` ile `scp` yapılamaz**. Ölçüm (canlı): `guncelleme.etkiliyazilim.com/electron/…` → 200 + `text/yaml` + `no-cache, must-revalidate`, `ssl_verify=0`, `server: cloudflare`, **`cf-cache-status: DYNAMIC`** (Cloudflare `latest.yml`i önbelleklemiyor — önbelleklese yeni sürüm saatlerce görünmezdi); demo kökü ve `/health` **hâlâ 200** (regresyon yok). Yayınlama `deploy/electron-yayinla.ps1` — asıl işi **sırayı unutturmamak** (`latest.yml` EN SON; ters sırada henüz yüklenmemiş bir `.exe`yi işaret eden yayın kalır).

**macOS'tan Windows paketi ALINABİLİYOR (ölçüldü, ama doğrulanmadı).** Düz `npm run build:win` macOS'ta düşer — `node-gyp does not support cross-compiling native modules from source`. Rebuild adımı atlanınca (`-c.npmRebuild=false`, script `build:win:cross`) 147 MB NSIS installer + blockmap + latest.yml sorunsuz üretildi, **wine bile gerekmedi**. Sebep: `serialport` ve `node-hid` **N-API prebuild** taşıyor (`node-napi-v4.node`) — Electron ABI'sinden bağımsızlar, rebuild gereksiz; Windows binary'lerinin (`PE32+ x86-64`) pakete girdiği tek tek ölçüldü. ⚠️ **"Doğru binary pakete girdi" ≠ "Windows'ta terazi/okuyucu açılıyor"**: bu modüller düşerse uygulama ÇÖKMEZ, sessizce `available:false` der — arıza kendini göstermez, sahada fark edilir. macOS paketi sahaya yayılmadan önce bir Windows makinesinde *Bu Bilgisayar → Yazıcı/Kantar* sekmelerinde cihazlar listelenmeli.

**⚠️ Cloudflare 404 tuzağı (aynı gün yaşandı, kalıcı düzeltildi):** nginx `.exe` başlığı `add_header ... always` ile yazılmıştı; `always` başlığı **hata yanıtlarına da** ekler ve Cloudflare origin'in talimatına uyup **404'ü bir hafta önbelleğe alır**. Paket yüklenmeden önce yapılan tek bir sonda isteği, dosya yüklendikten SONRA bile bir hafta 404 döndürdü (dosya sunucuda 147 MB duruyordu; `?cb=…` ile 200, temiz URL ile 404 — teşhis bu ikiliyle kurulur). Düzeltme: `always` kaldırıldı + `error_page 404 → Cache-Control: no-store` ikinci hattı. Önbellekte kalmış 404 yalnız **Cloudflare panelinden Purge by URL** ile temizlenir. Ders şu sınıfa girer: *bir başlık direktifi, hata yolunu da kapsadığında sessiz bir kalıcılık üretir.* Teşhis yayın script'lerine kalıcı olarak kondu (mobil oturumunun önerisi): temiz URL ↔ `?onbellek-atla=` kıyası "dosya yüklenmemiş" ile "önbellekte kalmış 404"ü AYIRIR — ikisi aynı görünür ama biri yeniden yüklemekle, diğeri yalnız purge ile çözülür; ayrıca `content-length` kıyası yarım yüklemeyi yakalar (200 döner ama eksiktir). Üç dal negatif sondayla ölçüldü. Sunucu yapılandırması artık repoda: `deploy/guncelleme-sunucusu/` (elle kopyalanır — `kur.ps1` ile aynı "servis kendini güncelleyemez" durumu).

**2026-08-27 — iki karar daha (ikisi de sahaya çıkmadan ÖNCE, yani bedava):** ① **Yol şeması müşteri bazlı oldu: `/<müşteri>/<ürün>/`** → `/adnansahin/electron/`, mobil `/adnansahin/mobil/`. Alan adı Etkili Yazılım'ın genel güncelleme sunucusudur; yeni müşteri eklemek yalnız klasör açmaktır (DNS/sertifika/servis YOK). Müşteri başına ALT ALAN ADI bilinçli seçilmedi: wildcard `*.etkiliyazilim.com` **iki seviyeli** adları kapsamaz. ⚠️ Bu kararın zamanlaması load-bearing: **adres pakete derleme anında gömülür**, sahaya çıktıktan sonra değiştirmek her makineyi tek tek gezmek demektir. ② **Güncelleme ZORUNLU** (kullanıcı kararı): şerit + "Sonra" ertelemesi kaldırıldı, yerine iki aşama geldi — inerken ince şerit (*"işinizi kaydedin"*), indikten sonra **kapatılamaz tam ekran kapı + 2 dk geri sayım** (`UpdateGate.tsx`, `GERI_SAYIM_SN`). Geri sayım zorunluluğu yumuşatmaz; güncelleme vardiya ortasında inebildiği için anında kesmek operatörün yarım formunu götürür ve olay *"bilgisayar kendi kendine kapandı"* diye okunurdu. İndirme şeridi de aynı sebeple load-bearing: kapı sürpriz olmasın. `install()` çift çağrılmasın diye ref (stale-closure kilidi) + state (buton kilidi) İKİSİ birden tutulur.

**Geçiş köprüsü (bir hafta sonra silinecek):** 2.8.0 paketi ESKİ adresi (`/electron/`) taşıyordu ve test için indirilmişti. O paketi kurmuş bir makine yalnız oraya bakar → 2.8.1 **her iki yola** kondu. Güncellendikten sonra yeni adrese kendiliğinden geçer. Eski yol boşaltılabilir hale gelince silinir.

**2026-08-27 (2. tur) — kullanıcı sordu: "otomatik denetliyor mu · modal çıkıyor mu · ara ara hatırlatıyor mu · backend hangi sürümü beklediğini söylüyor mu".** İlk ikisi vardı, son ikisi eksikti; ikisi de kapatıldı:

**① Kapı kalıcı kilitlenebiliyordu (gerçek hata).** `kuruldu` tek-atışlık bir kilitti; kurulum başlamazsa (Windows izin penceresine "Hayır" en olası sebep) kapatılamayan ve hiçbir şey yapmayan bir ekran kalıyordu — panel kullanılamaz hale gelirdi. `KURULUM_BEKLEME_MS` (20 sn) bekçisi eklendi: uygulama kapanmadıysa kilit açılır, *"Kurulum başlatılamadı"* yazar ve **5 dk sonra yeniden dener** (ilk geri sayımdan uzun: aynı soruyu iki dakikada bir sormak operatörü "Hayır"a şartlandırır). Kullanıcının "ara ara hatırlatıyor mu" sorusunun karşılığı budur.

**② İstemci sürüm politikası (`GET /api/client-policy/:istemci`, PUBLIC).** Backend "en az şu paneli bekliyorum" der; panel altındaysa **güncelleme inmemiş olsa bile** kapı açılır. Gerekçe deploy sırası: **backend ÖNCE** gider, yani yeni sözleşme çıktığında sahada bir süre eski paneller koşar ve bazı değişiklikler onlarda GÖRÜNÜR hata üretmez — alan sessizce düşer. Kararlar: değer **KODDA sabit** (`src/config/client-version-policy.ts`) — panelde ayar olsaydı yanlış girilen bir sayı sahadaki tüm panelleri kilitlerdi ve "şu API sürümü şu paneli gerektirir" cümlesi backend deploy'undan ayrı bir insan hamlesine bağlanırdı; istemci **FAIL-OPEN** (uç okunamaz/bozuk/404 → kilitleme YOK) — projenin fail-closed eğiliminin bilinçli istisnası, çünkü buradaki "kapalı" taraf tek bozuk yanıtla fabrikanın durması demek; uç **PUBLIC** (panel politikayı giriş öncesi sorar — kimlik aransaydı, sözleşmesi bozulduğu için giriş yapamayan panele "güncelle" diyebilme yolu kapanırdı; muafiyet gerekçesi `test_route_auth_coverage` EXEMPT'te); uç **parametreli** (yeni istemci route'a değil `CLIENT_VERSION_POLICIES` kayıt defterine yazılır). ⚠️ **`minVersion` sahadaki panel sürümünden BÜYÜK OLAMAZ** — olsaydı en güncel panel bile kapıda kalır ve indirecek bir şey olmadığı için ÇIKAMAZDI (kendi kendini kurtaramayan tek arıza biçimi); bekçi `test_client_policy.ts` (12 kontrol, iki negatif sondayla kırmızı). `minVersion` yalnız GERÇEK bir kırılmada yükseltilir; her sürümde artırmak, güncellemeyi indirememiş her makineyi üretim dışı bırakır.

**AÇIK EKSİK — mobilde sürüm kapısı YOK** (mobil oturumu ölçtü, 2026-08-27): istek başlıklarında sürüm yok, backend'de mobil kapısı yok, istemcide kontrol yok, 426 yok. ⚠️ `runtimeVersion` bu deliği KAPATMAZ — o JS↔native uyumunu bağlar, backend sözleşmesi hakkında bir şey söylemez; üstelik runtimeVersion artınca eski APK'lı tabletler hiç OTA almaz ve eski JS yeni backend'e karşı SÜRESİZ koşar (üstelik mobil bilinçli offline yazıyor → sessiz alan düşmesinin en kötü zemini). Uç parametreli olduğu için bağlanmak yalnız kayıt defteri satırı + istemci kodu ister. **Kullanıcı kararı bekliyor.**

**2026-08-27 (3. tur) — ÇOK MÜŞTERİ: "başka fabrikaya kurulum yaptığımda etkilenmemeli".** Yayın YOLU zaten müşteri bazlıydı; açık olan PAKET tarafıydı — adres pakete DERLEME ANINDA gömülüyor ve müşteri kodu elle değiştiriliyordu. Unutulan tek düzenleme "yeni fabrikanın paneli BAŞKA bir fabrikanın güncellemesini indirip kurar" sonucunu verirdi ve **hata sessizdir**: dosyalar kendi aralarında TUTARLI kalır, yalnızca yanlış müşteriyi gösterirler → tek müşteriyle hiç görünmez, ikincisinde patlar. Kurulan üç kademe: ① `shared/musteri.json` TEK KAYNAK (adres türetilir, elle yazılan ikinci kopya yok) · ② bekçi `update-feed-url.test.ts` (musteri.json ↔ package.json ↔ update-feed tutarlılığı — **sınırı dokümanda: üçü de aynı YANLIŞ müşteriyi gösterirse yakalayamaz**) · ③ **paketleme kapısı `deploy/electron-paketle.sh`**, derlemeden SONRA paketin İÇİNDEKİ `app-update.yml`i okuyup **argümanla verilen** müşteriyle kıyaslar.

⚠️ **Kademe ③'ün load-bearing özelliği: DAİRESEL DEĞİL.** Beklenen değer argümandan (bağımsız niyet beyanı), gerçek değer çıktıdan gelir. Beklenen değeri de `musteri.json`dan alsaydı kontrol yanlış müşteri kodunu ASLA yakalayamazdı. Genel kural (mobil oturumunun formülasyonu, kendi kapısı tam bu yüzden dairesel çıkmıştı): **beklenen değeri gerçek değerle AYNI kaynaktan alan bir kapı, o kaynağın yanlış olmasını yakalayamaz** — "bekçinin kör noktası hatanın kendisiyle aynı yerdeydi" desenlerinin genel hali. Ölçüldü: adnansahin paketi "yenifabrika" iddiasıyla sunulunca kapı durdurdu, doğru müşteride sessiz geçti. Ayrıca kapı derlemenin ÖNÜNDE değil ARDINDA durur — mobil tarafında önde duran kapı yüzünden yanlış adresli APK yayına çıkmıştı. Yayın komutu da hedefi paketin KENDİ kimliğinden çözer → "A paketini B klasörüne yükleme" hatası yapısal olarak imkânsız. Yeni fabrika: sunucuda `mkdir` + `electron-paketle.sh <müşteri>` + `electron-yayinla.sh`; DNS/sertifika/servis YOK. Sürüm politikası AYRI EKSEN (her fabrikanın kendi backend'i servis eder).

**Migration YOK · yeni izin YOK · APK YOK.** Sürüm 2.7.0 → 2.8.0 → 2.8.1 → **2.8.2**; yayında. ⚠️ Bu tur **backend deploy'u da gerektiriyor** (yeni uç). Kalan iş: **backend deploy + son elle tur** (§2).

---
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-08-27__2026-08-27-2-tur-yari`: Kanban 'hamStok' kolonunun ayrımı takip ETMEMESİ (bilinçli sayılan) kararı kalktı: kolon ikiye ayrıldı (hamStok/yariMamul) ve eski `currentStepId` boşluğu da kapandı — kolon artık Envanter rollScope zinciriyle birebir.
> - KISMİ → `R:2026-08-27__2026-08-27-2-tur-yari`: Mobil Depo 'Ham' sekmesinin düz `status:STOCK` göndermesi ve bunun 'APK işi' diye ertelenmesi geçersiz: sekme ikiye ayrıldı, rollScope kullanıyor ve dağıtım OTA ile yapıldı (saf JS, native parmak izi değişmedi).
> - KISMİ → `R:2026-08-27__2026-08-27-3-tur-yari`: 'Ürün Dengesi ve sipariş freeStock dokunulmadı' maddesi bayat: ikisine de yarı mamul kovası eklendi (yariMamul, freeSemiFinished). ⚠️ Ezilen şey yalnız GÖSTERİM; arz davranışı DEĞİŞMEDİ — eski notun gerekçesi ('yarı mamul gerçekten arzdır') 3. turda kural mertebesine yükseldi.
>

## 2026-08-26 — Yarı mamul: filtre yetmedi, sekme oldu · ham stoktan iş emri açılamıyordu

> ⚠️ **PROFİL GERÇEĞİ:** "Boyalı gelen kumaşa sadece kurşun+tambur" senaryosu ve "prod'da SEMI_FINISHED SIFIR" ölçümü bu kurulumundur; ayrıca notun sonundaki **"Panelden yapılacak: 'Yarı Mamul (Kurşun+Tambur)' rotası"** maddesi kurulum başına tekrar edilir (rota kod değil VERİdir). **Çekirdek:** üç kapsam ve `RAW_STOCK`'un BİLEREK geniş olması, `rollScope` FAIL-CLOSED, "altıncı enum değeri unutuldu" sınıfı ve "rapor da ayrılmazsa çelişkiyi BİZ üretiriz".

**Saha şikâyeti iki maddeydi, ölçüm tek eksik olduklarını gösterdi.**

**① "Boyalı gelen kumaşa sadece kurşun+tambur yapacağız, bunu Electron'dan çözelim."**
Giriş 2026-08-17'de yapılmıştı (`entrySource=SEMI_FINISHED` + `forcedStatus=STOCK`, Manuel
Giriş'teki kutu). Eksik olan ÇIKIŞtı: o topu masaüstünden bir iş emrine bağlamanın yolu YOKTU.
"Yeniden Üretime Al" yalnız Bitmiş Depo sekmesinde çiziliyordu ve gerekçesi koda yazılmıştı:
*"Ham Stok'ta gösterilmez, oradaki top zaten üretime girmemiş — normal iş emri açma yolu
kullanılır."* **O yol yok:** Yeni İş Emri formu top almıyor, mevcut iş emrine top ekleme ucu
2026-06-12'de kaldırıldı. Yani gizlenen buton, olmayan bir kuralı taklit ediyordu. Backend
baştan beri üçünü de kabul ediyor (`quickStart.attachable` = STOCK/WAREHOUSE/A1_STOCK).

**Ölçüm (prod yedeği 2026-08-25, 2431 top): `SEMI_FINISHED` kaydı SIFIR.** Özellik bir haftadır
hiç kullanılmamış ve sebebi tek değil — 2026-08-17 paketinin ÜÇ ucu birden açık kalmıştı:
rota ("Yarı Mamul = Kurşun+Tambur") hiç oluşturulmamış (prod'da 2 rota var, ikisi de Boyahane
ile başlıyor) · `mobile:kk1-yari-mamul` izni 0 kullanıcıda · masaüstünde iş emri açılamıyor.
İlk ikisi `docs/history/DEVIR-2026-08-17-FABRIKA-TALEP.md` kontrol listesinde madde 5-6 olarak
yazılı ve yapılmamış. **Ders: "backend hazır, arayüz sonra" biten bir iş değildir — çıkışı
olmayan bir giriş kapısı sıfır kullanım üretir ve bunu kimse hata olarak raporlamaz.**

**② "Yarı mamul envanterde ham stok gibi görünüyor, bu yanlış."** — Haklı.

**KARAR DÖNÜŞÜ (bilinçli).** `docs/history/FABRIKA-TALEP-2026-08-17.md §9` şöyle diyordu:
*"Yarı mamül ham stoğa düşer, üzerinde ayırt edici işaret taşır, Ham Stok listesinde FİLTREYLE
süzülür."* Filtre yetmedi: özellikle açılıp seçilmediği sürece yarı mamul ham kumaşın arasında
kayboluyor, stok adedi ve metraj toplamı ikisini tek rakamda topluyordu. **Değişen şey yalnız
GÖRÜNÜM: ayrı DEPO yine açılmıyor** (o kararın gerekçesi duruyor — fabrikada fiziksel karşılığı
yok), ayrı **sekme** açılıyor. Statü, `entrySource` ve stok mekaniği aynı.

**Terim:** "Yarı Mamul" (TDK yazımı; kodda her yerde "mamül" yazıyordu, 12 kullanıcı-görünür
nokta düzeltildi). Tekdüzen hesap planında 151 Yarı Mamuller, SAP'de HALB. Tekstil
alternatifleri bu kovayı adlandırmıyor: "ham bez" zaten boyasız malın adı, "boyalı ham" kendi
içinde çelişik.

### ⚠️ ÜÇ KAPSAM, biri BİLEREK geniş — `RAW_STOCK`'u DARALTMA

| Kapsam | Ne demek | Kim kullanır |
|---|---|---|
| `RAW_STOCK` | üretime girmemiş STOCK topu — **ham + yarı mamul** | **Mobil** Hızlı İş Emri top seçicisi |
| `RAW_STOCK_PURE` | yalnız ham | Masaüstü "Ham Stok" sekmesi |
| `SEMI_FINISHED` | yalnız yarı mamul | Masaüstü "Yarı Mamul" sekmesi |

`RAW_STOCK`'u "yarı mamul hariç" diye daraltmak **tableti bozar**: tablette üçüncü bir sekme
YOK ve o toplar listeden düşer — yani sahada çalışan tek yol kapanır. Bu yüzden birleşim
DOKUNULMADAN kaldı; APK sırası gelince tablet de üçüncü sekmeye geçer, **sunucu değişmeden**.
Negasyon istemciden söylenemez (`buildWhereClause` yalnız eşitlik/CSV-`in`/boolean üretir), o
yüzden ayrım servis katmanında yaşamak zorunda. Bekçi `test_semi_finished_entry §5`
birleşim = dar kapsamların toplamı eşitliğini ölçer — regresyon kapısı odur.

### Yol boyunca çıkan üç SESSİZ hata (hepsi aynı sınıf: "altıncı enum değeri unutuldu")

1. **`entryTitle` switch'i** (`inventory.service`) — `SEMI_FINISHED` case'i yoktu, `default`
   dalına düşüp topun geçmişinde **"Ham Giriş"** yazıyordu. Yorumu "beş değer de artık AÇIK
   case'le eşleniyor" diyordu; altıncı değer sonradan eklenmiş.
2. **Mobil KK1 "Son Kayıtlar" + "Tüm Girişler"** — `entrySource: 'SUPPLIER_RECEIPT,MANUAL_ENTRY'`
   ile süzüyordu, yani **KK1'in kendi yarı mamul modunun yazdığı topu KK1 gizliyordu**.
   Operatör az önce girdiği topu göremiyordu. (Düzeltme kodda; sahaya APK ile iner.)
3. **`entrySource` anahtarına yazan İKİ filtre** (Electron) — base "Giriş Kaynağı" (5 seçenek,
   SEMI_FINISHED yok) + Ham Stok'a eklenmiş "Giriş Türü" (3 seçenek). Aynı URL parametresine
   yazıp birbirlerini eziyorlardı. İkincisi silindi, seçenek tekine taşındı.

**Kalıcı çare:** bu üç yer de `Record<string,string>` / dizi literali / ham SQL olduğu için
derleyici sessiz kalıyordu. Tip-güvenli olan yerlerde (`Record<RollEntrySource, …>`) altıncı
değer zaten vardı. Yeni enum değeri eklerken **tip-güvenli olmayan** yüzeyleri ara.

### Rapor da ayrıldı (yoksa çelişkiyi BİZ üretecektik)

Stok Karnesi'nin "Ham" rakamı (`RAW = ["STOCK"]`) yarı mamulü içeriyordu. Envanteri ayırıp
raporu bırakmak, bugün olmayan bir çelişki doğururdu: ekran 800 der, rapor 950. `summary`'ye
`semiQty`/`semiCount` eklendi; yaş kovaları / ölü stok / `byItem` **yalnız `finished` üzerinde**
çalıştığı için onlara dokunulmadı — ölü stok rakamı etkilenmedi.

**Ayrımı TAKİP ETMEYEN yüzeyler (bilinçli, listelendi):** Kanban `hamStok` kolonu (düz
`status=STOCK`; akış görünümü, stok sayım yüzeyi değil) · mobil Depo "Ham" sekmesi
(`rollScope` kullanmıyor, APK işi) · Ürün Dengesi ve sipariş `freeStock` (**doğru davranış** —
yarı mamul gerçekten kullanılabilir arzdır, dokunulmadı).

**Beklenen ama sahada ilk kez görülecek:** renkli yarı mamul topu iş emrine bağlıyken hedef
renk değiştirilirse `workorder-target-color.helper` onu "zaten boyandı" sayar ve
`COLOR_DYED_BLOCKED` / `COLOR_PARTIAL_CONFIRM` sorar. Doğru semantik.

### Diğer kararlar
- **`rollScope` artık FAIL-CLOSED.** Tanınmayan değer eskiden hiçbir daralma yapmıyordu ve
  liste CANCELLED/SHIPPED dahil TÜM tabloyu döndürüyordu — hata yok, log yok. Değer hiçbir
  kullanıcı girdisinden gelmediği için (istemcilerde sabit) 400 güvenli.
- **Manuel Giriş'teki sessiz tuzak kapatıldı:** Ham Stok'ta renk seçip kutuyu işaretlemeyen
  operatörün topu Bitmiş Depo'ya düşüyordu, hiçbir uyarı yoktu. Artık amber uyarı çıkar
  (engel değil — renkli bitmiş mal girmek meşru). Yarı Mamul sekmesinden açılınca kutu
  ön-işaretli gelir ama GÖRÜNÜR kalır.
- **Sekme listeleri AÇIK yazılır:** `RollsTableBody` gövdesini Kartela ve Top Arşivi sayfaları
  da kullanıyor — "FINISHED_STOCK değilse göster" gibi negatif koşul oralara buton sızdırır.
- **Bekçi açığı kapatıldı:** `ROLL_TABS`'a sekme eklenip `buildRollForceFilters`'a dal
  yazılmayı unutmak **tip hatası vermiyordu**; sekme kapsamsız liste gösteriyordu. Yeni
  `service.test.ts` bölümü bunu ölçer (körlük zemini dahil).

**Migration YOK · yeni izin YOK · APK bu turda YOK.** Sıra: backend ÖNCE, Electron sonra
(eski Electron `RAW_STOCK` göndermeye devam eder — geriye uyumlu). Bekçiler:
`test_semi_finished_entry` (16, iki negatif sonda) · `test_stock_scorecard` (17, bir negatif
sonda) · Electron `Rolls/service.test.ts` (iki negatif sonda).

**Panelden yapılacak (kod değil):** "Yarı Mamul (Kurşun + Tambur)" rotası — bu rota olmadan
yarı mamul topa iş emri açılamaz.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `kod: Electron/shared/update-schedule.ts (commit 2f158434, 2026-09-04) — bu bundle'da notu yok`: Panelin periyodik güncelleme kontrolü 4 saatten 15 dakikaya indi (kullanıcı kararı); açılıştan 30 sn sonra ilk kontrol aynen. Kök notun '4 saatte bir' cümlesi bayat.
>

## 2026-08-26 — Mobil uzaktan güncelleme: APK elden ele taşınıyordu, JS paketi hiç ayrılmamıştı

> ⚠️ **PROFİL/OPS GERÇEĞİ:** Yol `/adnansahin/mobil/` bu müşterinin segmentidir; yeni fabrika = sunucuda `mkdir <müşteri>/mobil` + `--musteri=` ile yayın (DNS/sertifika/servis YOK). **Çekirdek:** "ERP bağlantısı fabrika ağında kalır, güncelleme internetten gelir — İKİ KANAL, hiçbiri diğerinden TÜRETİLMEZ", manifest yayın anında DONDURULUR, `runtimeVersion` filtresi SUNUCUNUN işidir, kod imzalama AÇIK, `add_header … always` YASAK.

**Soru:** *"apk olarak upload ediyorum ve tek tek yüklüyorum tablet/telefonlara; Google Play'e
koyamıyorum, başka nasıl dağıtabiliriz?"*

**Teşhis — sorun dağıtım kanalı değil, AYRIM eksikliğiydi.** `expo-updates` KURULU DEĞİLDİ
(ölçüldü: `package.json`'da yok, `app.json`'da `updates` bloğu ve `runtimeVersion` yok), yani
"ekran metnini düzelttim" ile "yeni Bluetooth modülü ekledim" **aynı** maliyeti taşıyordu: her
ikisi de tam APK turu. Oysa değişikliklerin ~%90'ı JS'tir ve native'e hiç dokunmaz. Kurulan
şey iki KATMAN:

① **Uzaktan güncelleme (OTA)** — `expo-updates` + Expo Updates protokolü v1'i konuşan KENDİ
backend'imiz (`/api/mobile/updates/manifest` + `/assets`). EAS Update (Expo bulutu) BİLİNÇLİ
OLARAK ALINMADI: internet kopunca güncelleme yolu da kopardı ve bundle dış servise giderdi;
fabrika sunucusu zaten tabletlerin bağlı olduğu makinedir. Uçlar **PUBLIC** (JWT yok) —
kimlik aransaydı "açılmayan tablete düzeltme gönderme" yolu, yani kurtarmanın kendisi
kapanırdı.

② **Kurulum dosyası güncelleyicisi** — `/api/mobile/app-version` + `app-download`; tablette
tek dokunuş, Android'in kurulum ekranı açılır. Sessiz kurulum YOK (ancak MDM ile mümkün;
6-15 cihaz için maliyeti karşılığını vermedi — ölçülüp elendi).

**`runtimeVersion` bu paketin taşıyıcı direğidir.** Paket yalnız aynı runtimeVersion'ı taşıyan
APK'ya gider (sunucu tarafında fail-closed). Artırılmadan native değişiklik yayınlanırsa
sahadaki TÜM tabletler açılışta çöker — bu, sistemin tek "hepsini birden öldüren" senaryosu.
Bu yüzden `yayinla-ota.mjs` native girdilerin (bağımlılıklar + plugins + android bloğu) parmak
izini alır, öncekiyle karşılaştırır ve runtimeVersion artmadıysa DURUR.

**"Bayat adres" tuzağının OTA ikizi kapatıldı.** `build-apk.mjs`in başlığındaki iki ölçülmüş
tuzak (Gradle görevinin env değişikliğiyle geçersiz kılınmaması + Metro transform önbelleğinin
env'i anahtarına almaması) `expo export` yolunda da geçerlidir. Orada bedeli **bir cihazdı**;
burada **sahadaki her tablet**tir — yanlış adresli paketi dağıtan şey, güncelleme
mekanizmasının kendisi olurdu. Yayınlama script'i önbelleği siler ve **üretilen bundle'ın
içindeki adresi geri okur**; tutmazsa paket yayınlanmaz. Adres çözümü artık TEK KAYNAK
(`scripts/lib/adres.mjs`) — iki script farklı sırayla çözseydi aynı gün üretilen APK ile paket
farklı sunucuya bakabilirdi.

**Depo `app\` klasörünün DIŞINDA** (`C:\Etkili-Yazilim\mobil-guncelleme`, `MOBILE_UPDATE_DIR`
ile taşınır). İçeride olsaydı `kur.ps1` her backend deploy'unda yayındaki paketi ve geri dönüş
geçmişini silerdi — yani backend'i güncellemek mobil güncellemeyi öldürürdü, sessizce.

**Geri alma dosya silmez:** `updates/<rv>/YAYINDA` işaretçisine eski damga yazılır. İşaretçi
bozuksa sunucu **gürültülü hata** verir, sessizce en yeniye DÜŞMEZ (düşseydi geri alma yapan
kişi eski paketin yayında olduğunu sanırdı). Manifest'teki varlık URL'leri **damgaya
çivilidir** — Expo'nun referans implementasyonunda bu yok ve orada yarış var: manifest
alındıktan sonra yeni yayın yapılırsa varlıklar yeni paketten servis edilir, hash tutmaz.

**Yenileme kuralı (kullanıcı kararı):** indirilir indirilmez hemen yenilenir. Tek istisna veri
kaybı önlemesidir — **gönderilmemiş istasyon kaydı varken yenilemez** (`reloadAsync` JS'i
öldürür, uçuştaki KK1 girişi yarıda kalır); tavan 20 sn, dolarsa yenileme atlanır ve paket bir
sonraki açılışta uygulanır.

**Yolun ortasında çıkan gerçek açık — MÜHÜR.** Release APK Android'in **herkese açık deneme
mührüyle** imzalanıyordu (ölçüldü: `signingConfig signingConfigs.debug`, SHA1
`5E:8F:16:06:...` — standart debug key). İki sonucu vardı: aynı ağdaki biri uygulamanın
üstüne kurulabilen sahte paket hazırlayabilirdi, ve mühür bir gün değişirse (klasör her
derlemede yeniden üretiliyor) tabletlerde tek çare **silip yeniden kurmak** olurdu — kayıtlı
sunucu adresi, oturum, cihaz eşleşmesi ve bekleyen kayıtlar giderdi. Kullanıcı kendi mührünü
seçti (RSA 4096, 2056'ya kadar). ⚠️ İmza `plugins/withReleaseKeystore.js` ile **her
prebuild'de yeniden yazılır** — `android/` git dışı prebuild çıktısı olduğu için elle
düzenleme bir sonraki prebuild'de sessizce kaybolurdu (`usesCleartextTraffic`in 2026-08-15'te
ısırdığı tuzağın birebir aynısı); eklenti bulamadığı yapıyı **atlamaz, hata fırlatır**.
`build:apk` ayrıca üretilen APK'nın parmak izini mühürle karşılaştırır.

**Derleme kapısı ilk gerçek koşumda kendi hatasını yakaladı:** `expo prebuild` koşmadan
derleme yapılsa APK `ENABLED=false` ile, yani uzaktan güncelleme ALMADAN çıkacaktı ve bu
hiçbir yerde görünmeyecekti. ⚠️ Kapı yazılırken kör noktası da ölçüldü: manifest
`runtimeVersion`i **literal değil** `@string/expo_runtime_version` referansı olarak yazar —
düz karşılaştıran bir kapı HER ZAMAN kırmızı verir, bir süre sonra devre dışı bırakılır ve
gerçek sapmada da susar.

**Bekçinin kör noktası hatanın kendisiyle aynı yerdeydi (yine).** Protokol bekçisinin yol
kaçışı sondaları var OLMAYAN dosyaları hedefliyordu (`../../../etc/passwd` paket kökünün üç
üstünde = depo içi, yok) → koruma silindiğinde de 404 dönerdi ve bekçi **52/52 yeşil kaldı**.
Ölçülüp düzeltildi: kaçış sondası, kaçışın BAŞARILI olacağı gerçek bir hedefi denemeli.

**Kapsam dışı bırakılanlar (gerekçeli):** MDM (6-15 cihaz, kurulum maliyeti karşılığını
vermiyor) · kod imzalama (paketler LAN'da düz HTTP ile gelir, API ile aynı güven modeli;
sunucu HTTPS'e geçerse açılmalı) · çalışma anında değiştirilebilir güncelleme adresi
(`disableAntiBrickingMeasures` — yanlış adres uygulamayı kurtarılamaz hale getirir; bunun
yerine ayrışma Ayarlar → Güncelleme ekranında GÖRÜNÜR kılındı).

**Google'ın sideload doğrulaması** (2026-09'da dört ülke, 2027'de küresel; doğrulanmamış
geliştiricide yeniden başlatma + 24 saat bekleme) yalnız KURULUM DOSYASINI etkiler — uzaktan
güncelleme kapsam dışıdır. Türkiye ilk dalgada değil.

Reçete: `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`. Migration YOK, izin YOK.

### ⚠️ AYNI GÜN — KANAL DEĞİŞTİ: güncelleme fabrika sunucusundan İNTERNETE (VPS) alındı

Yukarıdaki her şey kuruldu ve ölçüldü, sonra kullanıcı kanalı değiştirdi: *"tabletler
güncellemeyi internetten alsın, aynı Electron'da olduğu gibi — fabrika ağına bağlılar ama
wifi ve LAN üzerinden internete de her zaman erişiyorlar."* Sahaya çıkmamıştı, dolayısıyla
geri alınan bir şey yok; değişen yalnız KANAL. **ERP bağlantısı aynı kaldı** — OTA
paketinin içindeki JS hâlâ fabrika sunucusuna konuşur.

**Kararı ÜÇ ÖLÇÜM belirledi (`expo-updates` native kaynağından):**

① **İmza gövdenin HAM baytları üzerinden doğrulanır** (`CodeSigningConfiguration.kt:93-96`)
→ manifest yayın anında **DONDURULMAK ZORUNDA**; sunucu her istekte yeniden üretirse
baytlar değişir ve tablet paketi reddeder. Bu kısıt "iki ayrı protokol implementasyonu"
sorusunu kendiliğinden çözdü: **üreten tek yer yayın script'i** (`mobil/scripts/lib/manifest.mjs`),
sunucu yalnız bayt servis eder. Backend'in render eden ~300 satırı SİLİNDİ, yerine statik
dosya servisi geldi ve VPS'teki nginx ile **birebir aynı yol düzenini** kullanıyor.

② **İstemci mükerrer indirmeyi KENDİSİ engeller** — üç kat: `commitTime`
(`LoaderSelectionPolicyFilterAware.kt:57`) → `id` (`Loader.kt:153-169`) → varlık bazında
(`FileDownloader.kt:364`). Bu yüzden VPS'e dinamik servis/yeni konteyner GEREKMEDİ; Electron'un
kullandığı nginx'e tek regex kural yetti (karar zaten kayıtlıydı: *"mobil `/mobil/` olarak
aynı servise eklenir"*).

③ **`runtimeVersion` filtresi SUNUCUNUN işi** — istemci indirme aşamasında BAKMIYOR
(`LoaderSelectionPolicyFilterAware.kt:16-58`); yanlış sürüm gelirse indirir, launcher eler ve
uygulama **sessizce** eski sürümle açılır. Çözüm yapısal: adres sürümü İÇERİR
(`/mobil/ota/54.2/manifest`), her APK yalnız kendi paketini görür.

**Kod imzalama AÇILDI** (kullanıcı kararı) — LAN'da opsiyoneldi, internette anlamı değişti:
paket = tablete kod göndermek, VPS'e sızan biri sahadaki HER tablete istediğini gönderebilirdi.
Özel anahtar `mobil/keystore/ota-keys/` (git dışı) ve **VPS'e GİTMEZ**. İmza geçersizse
istemci güncellemeyi REDDEDER ve eski sürümle çalışmaya devam eder. ⚠️ İmza açıkken **her
yanıt imzalı olmak zorunda** (`allowUnsignedManifests` varsayılan false) → statik kurguda
`noUpdateAvailable` direktifi hiç kullanılmaz, her zaman manifest servis edilir (mükerrer
indirmeyi zaten istemci engelliyor).

**APK arm64'e indirildi** — ölçüldü: 113 MB → **49 MB** (mimari başına sıkıştırılmış:
arm64 22,5 · v7a 15,3 · x86 24,5 · x86_64 23,9 · ortak 26,8). Artık internetten indiği için
anlamlı. ⚠️ Kurulumdan önce sahadaki cihazların arm64 olduğu ölçülmeli.

**Yol boyunca ısıran üç şey:**
- `npx expo-updates codesigning:configure` app.json'a **değerlendirilmiş** yapılandırmayı geri
  yazdı ve `updates.enabled`ı SESSİZCE `false` yaptı. O hâliyle derlenen APK hiç güncelleme
  almazdı ve bu hiçbir yerde görünmezdi → bekçiye alındı (`update-feed-url.test.ts`).
- `withReleaseKeystore` eklentisi **idempotent değildi**: ikinci `prebuild` koşumunda zaten
  uygulanmış hâli "beklediğim satırı bulamadım" diye hata sayıp prebuild'i düşürüyordu.
  Ayrım: ZATEN UYGULANMIŞ olmak başarıdır, BEKLENMEYEN şablon bulmak hatadır. Blok
  eşleştirmesi de regex'ten parantez saymaya çevrildi (tembel regex iç bloğun kapanışında
  duruyordu).
- Ayarlar ekranındaki **"iki adres farklı" uyarısı** kanallar ayrılınca her cihazda kalıcı
  olarak yanacaktı → kaldırıldı, iki bağlantı etiketleriyle bilgi olarak basılıyor. Hep
  bağıran bir uyarı bir süre sonra okunmayan bir uyarıdır ve gerçek sapmada da susar.

**Yeni/değişen bekçiler:** `test_mobile_update.ts` yeniden yazıldı (37 kontrol — donmuş
baytların BOZULMADAN servis edilmesi, imzanın sertifikayla doğrulanması, **backend ↔ mobil ↔
nginx sınırlayıcı tutarlılığı**; dört negatif sonda, *tek baytlık* bozulma dahil) ·
`update-feed-url.test.ts` (7, dört negatif sonda). nginx yapılandırması artık **repoda**
(`deploy/vps/`) — eskiden yalnız VPS'te yaşıyordu ve konteyner yeniden kurulsa kural sessizce
kaybolurdu.

**Yayın sunucusu KURULDU ve doğrulandı (2026-08-27).** Electron'u kuran oturumla konuşuldu ve
onların standardına hizalanıldı — bu, tek başına çalışırken üretilecek üç yanlıştan döndü:

- **Yol müşteri bazlı: `/<musteri>/<urun>/`** (`/adnansahin/mobil/`). Müşteri segmenti alt
  alan adı DEĞİL çünkü Cloudflare Origin CA wildcard'ı (`*.etkiliyazilim.com`) iki seviyeli
  adları kapsamıyor; her müşteri için ayrı sertifika gerekirdi. Kökte açtığım `html/mobil/`
  kaldırıldı.
- **Repo klasörü `deploy/guncelleme-sunucusu/`** (benim açtığım `deploy/vps/` silindi);
  sunucudaki config'e DOĞRUDAN dokunulmaz — repodaki dosya düzenlenip kopyalanır, yoksa
  değişiklik tek kopya olarak sunucuda kalır (`kur.ps1` ile aynı "servis kendini
  güncelleyemez" durumu).
- ⚠️ **Uzun-cache kurallarında `add_header … always` YASAK.** `always` başlığı HATA
  yanıtlarına da ekler ve Cloudflare origin'in talimatına uyup **404'ü de bir hafta**
  önbelleğe alır. Bir gün önce Electron'da birebir yaşanmış: 147 MB'lık paket sunucuda
  dururken adres 404 döndü, ancak CF panelinden "Purge by URL" ile çözüldü. Taslağımda APK
  kuralında tam da o `always` vardı; kaldırıldı. İkinci hat (`error_page 404 → no-store`)
  ölçülerek doğrulandı: yükleme öncesi attığım sondalar önbelleğe girmedi.

nginx değişikliği **yalnız ekleme** oldu (0 silinen / 40 eklenen satır, diff ile kanıtlandı);
`nginx -t` + reload sonrası `/electron/latest.yml` içeriğinin BİREBİR aynı kaldığı kıyaslandı.

**Uçtan uca ölçüm (canlı sunucuya karşı, istemcinin yaptığı iş birebir taklit edilerek):**
manifest 200 + `expo-protocol-version: 1` + doğru sınırlayıcı · imza **APK'ya gömülü
sertifikayla GEÇERLİ** · 43 varlığın 43'ü hash uyumlu indi (11,7 MB) · manifest no-cache,
paket 7 gün · APK sha256'sı künyedekiyle birebir. 14/14.

**Yan bulgu — aynı tuzağın zararsız biçimi yakalandı:** APK'nın içerik tipi ilk istekte
`octet-stream` olarak önbelleğe girmiş, kural düzeltildikten sonra bile temiz URL eski
başlığı döndürüyordu (`?cb=` ile doğru tip geliyor → teşhis: önbellek). Sürüm başına dosya
adı değiştiği için gelecek yayınları etkilemez, ama yayın script'ine **kalıcı bir teşhis**
eklendi: temiz URL ile `?cb=`li URL farklı yanıt veriyorsa gürültülü uyarı + "Purge by URL"
reçetesi. Sessiz bir tuzak, bağıran bir kontrole çevrildi.

Ayrıca `test_route_auth_coverage` kırmızıydı (uçlar kimliksiz, muaf listesinde değil) —
komşu oturum haber verdi, gerekçeli iki satırla kapatıldı: koruma kimlik değil KOD
İMZALAMADIR, uçlar giriş ekranından önce çağrılır.

**⚠️ YAYIN SONRASI YAKALANAN İKİ HATA (2026-08-27, kullanıcı "bitti mi?" diye sorunca):**

**① Yayınlanan APK YANLIŞ adresi taşıyordu.** Yol standardı `/adnansahin/`e taşınmadan
ÖNCE derlenmişti; APK içinde `…/mobil/ota/54.2/manifest` gömülüydü ve o adres 404 veriyor.
O APK kurulan tablet güncelleme sorar, 404 alır ve **bir daha hiç güncelleme almaz** —
üstelik hiçbir yerde görünmez. `build-apk.mjs`in kapısı bunu YAKALIYORDU (sonradan koşulunca
kırmızı verdi), ama derlemeden sonra tekrar koşulmadığı için yayın adımına ulaşamadı.
Ders: **kapı, korumak istediği adımın ÖNÜNDE durmalı.** `deploy/mobil-yayinla.mjs`e yükleme
ÖNCESİ bir kapı eklendi — APK'nın AndroidManifest'inden gömülü adresi okuyup bugünkü feed ile
karşılaştırıyor, tutmazsa yüklemeden duruyor. Bozuk APK sunucudan kaldırıldı.

**② `nativeParmakIzi` sürüm numarasını kapsıyordu — kapının kendisi zarar üretiyordu.**
`android.versionCode` parmak izine giriyordu; her APK sürümü sahte bir "native değişti"
alarmı üretip **gereksiz bir runtimeVersion artışına** zorlardı. Ve runtimeVersion artışı
sahadaki TÜM tabletleri uzaktan güncellemeden koparır (yeni APK kurulana dek paket almazlar)
— yani yanlış kapsamlı bir kapı, korumaya çalıştığı şeyin tam tersini yaptırırdı. Sürüm
numaraları kapsam dışına alındı.

**②b Düzeltmenin KENDİSİ aynı yanlış alarmı üretti — bir kat daha derin ders.** Kapsam
değişince kayıtlı taban ESKİ algoritmayla hesaplanmış kaldı ve karşılaştırma yine "native
değişti" dedi. Ölçümle çürütüldü: `versionCode` 54'e geri sarılınca hash kayıtla **birebir**
eşleşti (`30aca7a9…`), yani fingerprint girdilerinde değişen tek şey oydu. Yani iki hash
farklı kapsamla hesaplandığı için **karşılaştırılamaz**; bunu "değişti" diye okumak yanlış
teşhistir ve sonucu ağırdır (zararlı runtimeVersion artışı). Çözüm: parmak izi kaydına
**algoritma sürümü** (`alg`) yazılıyor; sürüm uyuşmazsa script ayrı ve doğru cümleyi kuruyor
— *"karşılaştırılamıyor, runtimeVersion ARTIRMA, native değişmediğinden eminsen tabanı
yenile"*. Genel kural: **bir kapının kapsamını değiştirmek, o kapının geçmiş kayıtlarını da
geçersizleştirir** — kayda kapsamın sürümü yazılmazsa kapı, ilk koşumunda yanlış bağırır.

**Yeni APK 2.9.8/vc55 olarak yayınlanıyor, aynı ada yeniden yüklenmedi:** APK adresi 7 gün
önbellekli; aynı ada yeniden yüklemek Cloudflare'de bir hafta boyunca BOZUK paketin servis
edilmesi riskiydi. Sürüm artırmak yeni adres demek — önbellek sorunu doğmadan çözülür.

**2026-08-27 (öğleden sonra) — İKİNCİ FABRİKA + SÜRÜM KAPISI.** Kullanıcı ikinci bir
fabrikaya kurulum yapacak; iki iş birlikte alındı.

**① Müşteri bazlı yayın.** Yol düzeni zaten `/<musteri>/<urun>/` idi; eksik olan PAKET
tarafıydı — müşteri kodu elle değiştiriliyordu ve unutulursa yeni fabrikanın tabletleri eski
müşterinin OTA'sını çekerdi. Kod artık `mobil/musteri.json`da TEK KAYNAK, adres ondan türer.
⚠️ **Asıl bulgu, mevcut kapının DAİRESEL olmasıydı:** APK'nın gömülü adresi `feed.cjs`teki
sabitle karşılaştırılıyordu, ama `app.config.js` de adresi AYNI dosyadan türetiyor — müşteri
yanlışsa ikisi de aynı yanlışı söyler ve kapı GEÇERDİ. Tek müşteriyle görünmez, ikincisinde
patlar. **Genel kural: beklenen değeri gerçek değerle AYNI kaynaktan alan bir kapı, o
kaynağın yanlış olmasını yakalayamaz** — beklenen değer bağımsız bir NİYET BEYANINDAN
gelmeli. Derleme ve yayın komutları artık `--musteri` zorunlu alıyor ve kapılar onunla
karşılaştırıyor. ⚠️ İkinci ders ölçümle geldi: yayın kapısının ilk yazımı `yayin.json`daki
`musteri` alanına bakıyordu ve **ateşlemedi** — alanı taşımayan eski bir paket geçti ve
yanlış müşteriye YÜKLENDİ (sunucudan temizlendi). Künye bir BEYANDIR; paketin tabletleri
nereye göndereceğini **manifestteki varlık URL'leri** söyler. Kontrol beyana değil artefakta
bakar.

**② Sürüm kapısı — mobilde İKİ EKSEN.** Komşu oturumun Electron için kurduğu
`client-policy` deseni alındı (`GET /api/client-policy/mobil`, kayıt defteri kodda sabit,
istemci fail-open, tanımsız istemci 404). ⚠️ Ama masaüstünde olmayan bir sorun çıktı:
**mobilde sürüm tek eksen değil.** APK sürümü yalnız kurulum dosyası değişince artar, JS
düzeltmesi ise OTA ile gider ve `versionName`i DEĞİŞTİRMEZ — yani "2.9.9 görünen" bir
tabletin JS'i haftalarca eski olabilir ve `minVersion` bunu ifade EDEMEZ. Politikaya
`minPaketTarihi` eklendi (istemci `Updates.createdAt` ile kıyaslar). ⚠️ `paketTarihi === null`
(hiç OTA almamış tablet) ESKİ SAYILMAZ — gömülü paket APK ile aynı yaşta; aksi hâlde yeni
kurulan her tablet kilitlenirdi. **Kilit KOŞULLU** (Electron'dan bilinçli fark): yalnız
düzeltme GERÇEKTEN kurulabilirken ve gönderilmemiş kayıt yokken kapanır, aksi halde kalıcı
şerit. Gerekçe: interneti kopuk bir tableti kilitlemek, güncellemeyi indiremediği için
**çıkışı olmayan** bir üretim durmasıdır ve mobil bilerek çevrimdışı yazabiliyor. Politika
**kendiliğinden müşteriye özeldir** (her fabrikanın kendi backend'i servis eder); yayın
kanalı ile politika ayrı eksenler.

Bekçiler: `clientPolicy.service.test.ts` (14 — iki zarar yönünü de ölçer) ·
`update-feed-url.test.ts` (10, müşteri türetme dahil) · komşunun `test_client_policy §5`
mobil satırını otomatik kapsıyor. Yayında: **APK 2.9.9/vc56** (keşif + müşteri kanalı +
sürüm kapısı, arm64) + OTA rv 54.2. Kullanıcı kararı **A**: tek APK, hepsi birlikte.

Kalan: **her tablette uygulamayı sil + yeni APK'yı kur** (mühür değişti, ayrıca arm64).
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-09-04__2026-09-04-cihaz-onay-kapisi`: 2026-08-26 kurulum notu 'cihaz kimliği değişince tablet PENDING düştü, yönetici onayı istedi — sahaya çıkarken planlanmalı' o günkü kodu anlatır (her cihaz KOŞULSUZ PENDING doğuyordu). 2026-09-04'ten beri doğuş durumu bayraktan türer: `devicePairingRequired` KAPALIYSA cihaz APPROVED doğar, onay adımı yoktur; planlama adımı yalnız bayrak AÇIK kurulumda geçerli.
>

## 2026-08-26 (akşam) — Sebep listesi büyüyünce Kaydet ekran dışında kalıyordu + sıra artık sürüklenerek KALICI

> ⚠️ **PROFİL GERÇEĞİ:** Tambur sebep adımı `production.enabled` yüzeyidir ve "7. satırda görüldü" ölçümü bu fabrikanın katalog büyüklüğüdür. **Taşınabilir çekirdek:** üç bölge (sabit başlık · KAYAN liste · sabit footer), `mergeVisibleOrder` köprüsü ("sunucu TÜM id'leri ister, ekran yalnız AKTİF satırları çizer — gizli satır KENDİ YUVASINDA kalır") ve "sürükleme yalnız yetkilide, `builtin:` zemin satırlarında KAPALI".

**Saha bulgusu (ekrandan ölçüldü):** fabrika "Kayıt düzeltmesi" listesine kendi
sebeplerini ekledikçe (yedinci satırda görüldü) Tambur → Bitir → sebep adımında
**"Geri" ve "Kaydet" ekranın alt kenarında kesiliyordu** — operatör kararı
tamamlayamıyordu. Sebep yapısaldı: adım 2'nin başlığı, serbest metin kutusu,
sebep listesi ve footer TEK bir `View` içindeydi ve sheet `maxHeight: winH*0.85`
ile kırpılıyordu. Kırpılan taraf her zaman EN ALT, yani karar düğmeleri.

**① Üç bölge (bölünme load-bearing).** Başlık + serbest metin SABİT · sebep
listesi `Animated.ScrollView` içinde KAYAR (`flexShrink: 1` — sheet'in tavanı
aşıldığında kırpılacak tek bölge orası) · Geri/Kaydet SABİT footer (üst çizgili).
Liste büyüyen tek bölge olduğu için footer'ın ondan ayrı yaşaması bir tercih
değil zorunluluk: yeni sebep eklemek listeyi uzatır, footer'ı değil.

**② Sıra sürükle-bırakla KALICI.** Satır **basılı tutulup** sürüklenir
(`react-native-sortables` — projede zaten kuruluydu, `ModuleSelectScreen`
emsali; `Sortable.Touchable` ile tek dokunuş "seç", basılı tutma "sürükle",
ikisi çakışmaz). Bırakınca `PATCH /api/reason-presets/reorder` yazar — uç
2026-08-19'dan beri vardı ama HİÇBİR istemcisi yoktu.

⚠️ **Sunucu o kind'ın TÜM id'lerini ister, operatör ekranı yalnız AKTİF satırları
çizer.** Ham "görünenlerin sırası" gönderilemez (eksik liste → 400). Köprü
`mergeVisibleOrder` (mobil `reasonPreset.service.ts`, saf fonksiyon): gizli satır
TAM listede işgal ettiği YUVADA kalır, yalnız görünenlerin yuvalarına yeni sıra
yazılır. Naif çözüm (görünenler önce, gizliler sona) pasif satırları her
sürüklemede listenin dibine toplardı — masaüstü düzenleme ekranında görünür bir
yan etki. Tam liste **yazma anında** çekilir (`list(true)`), ekranda tutulan bir
kopya başka cihaz araya satır ekleyince bayat olurdu.

⚠️ **Yerel sıra (`localOrder`) başarıda TEMİZLENMEZ** — temizlenirse liste,
yenilenmiş sorgu inene kadar bir kare eski sırayı gösterir (göz kırpması).
Hata durumunda temizlenir (eski sıraya dön) + toast. Sürükleme yalnız
`canEditPresets` (`roll:manual-adjust` ∨ `mobile:tambur-duzelt`) olan kişide
açık; gömülü çevrimdışı zemin satırlarında (`builtin:` sentetik id) KAPALI —
sunucuda karşılığı olmayan satırın sırası yazılamaz.

**Bekçi:** `mobil/src/services/reasonPreset.order.test.ts` (8 kontrol —
`mergeVisibleOrder`'ın yuva korumasını, küme eşitliğini ve uzunluk invariantını
ölçer). Naif uygulamayla **4 kontrol kırmızıya döndü** (negatif sonda).

**Tablette uçtan uca doğrulandı** (APK 2.9.7/vc54, SM-X210): butonlar liste
uzarken görünür kaldı · `input motionevent` ile basılı-tut-sürükle → satır en
üste taşındı, `PATCH /reorder` 200 · `sortOrder` DB'de 0..6 yeniden yazıldı ·
uygulama tamamen kapatılıp açıldıktan sonra sıra KORUNDU · liste kayarken
başlık ve footer yerinde kaldı.

⚠️ **Kurulum notu:** 2.9.7 imza uyuşmazlığı verdi (uzaktan güncelleme paketi
mührü değiştirmiş) → kaldır+yeniden kur gerekti; cihaz kimliği değiştiği için
tablet `PENDING` düştü ve yönetici onayı istedi. Sahaya çıkarken bu iki adım
planlanmalı.

⚠️ **Yan bulgu (bu paketin dışı):** uzun süredir koşan dev backend
`GET /api/reason-presets`'te 400 veriyordu — başka bir oturumun eklediği
`ReasonPresetKind.ORDER_CANCEL` enum değeri DB'ye gelmiş, sürecin Prisma
client'ı eskiydi ve o satırları okurken P2023 atıyordu. `prisma generate` +
restart çözdü. Ders: paylaşımlı ağaçta uzun koşan dev sunucu, başkasının
migration'ıyla sessizce bayatlayabilir; belirti "uç 400 veriyor"dur, sebep
istemci değil ÜRETİLMİŞ CLIENT'tır.

**Migration/izin/backend değişikliği YOK** — yalnız mobil. Sahaya çıkması için
yeni APK gerekir.


---

## 2026-08-27 — "Sipariş bağlarsam hata veriyor, siparişsiz açınca geçiyor" — hedef, plandan değil SİPARİŞTEN türüyordu

> ⚠️ **ÇOK-FABRİKA AÇISINDAN EN ÖNEMLİ NOTLARDAN BİRİ:** "Boyahanesiz rota (kurşun+tambur) dışarıdan boyalı gelen mal için DOĞRUDUR" — yani rota kapsaması **REDDETMEZ, UYARIR** kuralı tam olarak farklı fabrika topolojilerini destekleme kararıdır (`ApiResponse.warnings`); fason kapalı bir kurulumda hedef renk hiçbir zaman uygulanmayabilir ve bu meşrudur. ⚠️ AÇIK kalan asimetri (oluşturma ↔ düzenleme) yeni profil eklenirken yeniden ölçülmeli — bkz. MODUL-BAYRAK-TASARIM §5.2, §11.

**Saha tarifi.** Mobil Hızlı İş Emri'nde sipariş bağlanıp rotada boyahane yoksa
(sadece kurşun+tambur, ya da sadece tambur) iş emri 400 ile düşüyor; aynı toplarla
siparişsiz açılınca sorunsuz geçiyor.

**Sebep.** Sipariş bağlanınca hedef renk **sipariş satırından TÜRETİLİYOR**
(`workorder.service.create` → `resolvedTargetColorId = onlyColorId`) — planlamacı hiç renk
seçmese bile. Hemen ardından `assertRouteCoversTargets` koşuyor ve *"hedef renk var ama rotada
renk veren adım yok"* diye reddediyor. Siparişsizken hedef renk hiç doğmadığı için kontrol de
çalışmıyor. **Aynı tuzak ÖZELLİKTE de vardı:** sipariş satırının `requiredProperties`'i de
otomatik hedefe geçiyor (`create`, `orderLineRequiredProperty` birleşimi) ve "rotada zımpara
yok" diye aynı şekilde 400 veriyordu.

**Kuralın gerekçesi burada geçersizdi.** Kural *"hedef asla uygulanmaz → planlama hatası"*
diyor. Ama dışarıdan boyalı gelen kumaşa yalnız kurşun+tambur yapılacaksa rotada boyahane
**olmaması doğrudur** ve eldeki mal zaten o renktedir — uygulanacak bir şey yoktur. Sipariş
satırındaki renk bir plan beyanı değil, **müşterinin ne istediğidir**.

**⚠️ AYRICA: aynı soruya iki farklı cevap veriliyordu.** 2026-08-21'de "Rengi Değiştir" yolu
yeniden yazılırken karar açıkça verilmiş ve koda yorum olarak da yazılmıştı —
`workorder-target-color.helper.ts`: *"Rota kapsaması — REDDETME, UYAR"* (`ApiResponse.warnings`).
Yani **mevcut** iş emrinin rengini değiştirirken uyarı, **yeni** iş emri açarken sert hata. O
gün düzenleme yolu düzeltilmiş, oluşturma yolu olduğu gibi bırakılmıştı.

### KARAR — İKİ AŞAMALI (aynı gün, ikinci tur kararı ilkini genişletti)

**Önce dar kapı denendi:** kural kalsın, nitelik eldeki topların HEPSİNDE varsa kontrol atlansın.
**Sonra kullanıcı asimetrinin tamamını kapatmayı seçti: KAPSAMA ARTIK REDDETMEZ, UYARIR.**
Üç kapı da (`create` · `replace` · "Rengi Değiştir") tek kuralı söylüyor; yanıt
`ApiResponse.warnings` taşıyor. Sektör dayanağı: rota/iş planı eksikliği ERP'lerde tipik olarak
uyarıdır (SAP PP'de yönlendirme uyarısı üretim emrini durdurmaz), planlamacı bilinçli geçebilir.

⚠️ **KABUL EDİLEN RİSK (kullanıcıya söylendi, kabul etti):** eksik rotayla iş emri açılabilir.
Bedeli uyarı metnine yüklendi — NE eksik olduğunu **ve SONUCUNU** somut söyler
(*"Rotada renk veren adım (boyahane) yok — toplar hedef rengi kendiliğinden ALMAYACAK…"*).
"Rota uygun değil" gibi genel bir cümle planlamacıya ne yapacağını söylemez.

**Dar kapı MANTIĞI DURUYOR, işi değişti:** artık engeli değil UYARIYI bastırıyor. Nitelik
topların hepsinde zaten varsa uyarının cümlesi ("kendiliğinden almayacak") **yanlış** olur ve
okunmayan bir uyarı üretir — okunmayan uyarı, olmayan uyarıdan kötüdür. `replace` mal bilgisini
canlıdan okur (bağlı toplar), `create`'te çağıran verir.

### Uygulama

Uyarıya çevirmek yerine **dar kapı** seçildi: nitelik eldeki topların **HEPSİNDE** zaten varsa
kontrol atlanır.

- `create()` üçüncü bir opsiyonel parametre alır: `goods { colorIds, propertyIdSets }` —
  bağlanacak topların HÂLİHAZIRDA taşıdığı nitelikler. **Yalnız `quickStart` doldurur**
  (tek yol: top okutarak açılan iş emri); `quickStart`'ın ön-doğrulama `select`'ine `colorId`
  + `properties` eklendi.
- **"Hepsi" load-bearing:** bir kısmı eksikse o toplar niteliği hiç kazanamaz → kural orada
  hâlâ gerçek bir planlama hatasını yakalıyor. `some` yazmak kapıyı sessizce açar.
- **Mal bilgisi yoksa muafiyet de yok** (F221 deseni). Masaüstü Yeni İş Emri formu top almaz →
  düz `create` → davranış **birebir eskisi gibi**. Muafiyetin varsayılanı AÇIK olsaydı orası
  sessizce gevşerdi.
- Muafiyet **hedef rengi SİLMEZ** — WO'ya yine siparişin rengi yazılır (belge/rapor/plan-sapma
  kapısı onu okuyor); atlanan şey yalnız rota kapsaması sorusudur.

**Bekçi `test_wo_route_coverage_goods.ts` (7).** Değeri NEGATİF durumlarda: ham mal → hâlâ
reddedilir · karışık küme (boyalı+ham) → hâlâ reddedilir · topsuz `create` → davranış
değişmedi. **İki negatif sondayla kanıtlandı:** `every`→`some` yapılınca karışık küme kontrolü,
`rollCount > 0` koşulu düşünce topsuz-create kontrolü kırmızıya döndü.

**Migration YOK · izin YOK · APK YOK** — düzeltme tamamen sunucuda; tablet aynı isteği
göndermeye devam eder, artık 400 almaz. Ekran tarafında ek bir iş gerekmiyor.

**Asimetri KAPANDI** (ikinci tur): create · replace · "Rengi Değiştir" üçü de uyarıyor.
`quickStart` `create`'in uyarılarını yanıtına taşır — taşımasaydı tablet iş emrini açar ve not
yolda kaybolurdu (uyarıya çevirmenin tüm anlamı o notun görünmesiydi; bekçi bunu ölçüyor).

---

## 2026-08-27 — Sipariş görünürlüğü: şerit + altı rapor + iptal sebebi + kalem iptali

> ✅ **ÇEKİRDEK:** Sipariş & Müşteri kapatılamaz çekirdek bloktur (MODUL-BAYRAK-TASARIM §2). Liste/cursor/özet TEK `where` (`BaseService.buildListWhere` — şerit listeden sapamaz), "iptal kalem `quantity` DEĞİL `shipped` ile sayılır", "açık talep süzgeci TEK KAYNAK `order-line-scope.helper` (`cancelledAt == null` **gevşek**)" ve "karşılanma raporu `getCoverageForLines` KULLANMAZ — havuzu her satıra tam yazar, çift sayım" — hepsi bayraklanmaz.

Saha isteği ikiydi: *"envanterdeki renkli özet şeridinin aynısı sipariş ekranında da olsun"*
ve *"siparişle ilgili kapsamlı raporlar"*. İkisi de yazılırken **ölçüm üç kez planı düzeltti** —
notun asıl değeri o üç düzeltmede.

### Özet şeridi — liste ile sapma YAPISAL olarak imkânsız

Envanterin `RollsStats`i çalışıyordu çünkü liste ve özet `buildRollWhere` ile AYNI where'i
paylaşıyor (o dosyanın yorumu sebebi yazıyor: *"filtre eşleşmediğinde istatistik listeden
sapar"*). `BaseService`te böyle bir metot **yoktu** — dört adım `findAllOffset` ve
`findAllCursor` içinde ayrı ayrı kopyalanmıştı. `buildListWhere` çıkarıldı; liste, cursor ve
yeni `GET /api/orders/stats` üçü de onu çağırır. Bekçi `test_order_stats` (33) şerit sayısını
listenin `withTotal` sayımıyla **her filtre kombinasyonunda** karşılaştırır.

⚠️ **İki kapsam bilinçli olarak FARKLI:** ADET listenin aynasıdır (panel iptalleri gizlediği
için İPTAL kovası yalnız tik açıkken dolar), METRAJ iptalleri HER ZAMAN dışlar — iptal edilmiş
siparişin açık metrajı yoktur. Birini diğerine uydurmak ya şeridin toplamını listenin satır
sayısından ayırır ya da iptal metrajını üretim planına sokar.

⚠️ **Şerit görünümü üç modlu ve tercih HESAPTA** (`prefs.orders.statsView`) — tema/renk gibi
kullanıcıyı takip eder. `UserPreference` "dört kapı" modelinin TERSİDİR: backend Zod'u
`z.record(z.string(), z.unknown())`, hiçbir anahtarı tanımaz/atmaz → **backend'de tek satır
değişmez**. Tuzak: `setPreference` önbellek boşken çağrılırsa `DEFAULT_PREFERENCES + patch`
yazıp 600 ms sonra TÜM blob'u ezer (favoriler, kolon düzeni, `mobileModuleOrder` dahil);
provider `ready` bayrağını üretir ama tüketicilerin hiçbiri kullanmıyordu — mod değiştirme
düğmesi `ready` gelmeden yazmaz.

### 30 günlük pencere kalktı → index BİLEŞİK olmak zorundaydı

Sipariş ekranı varsayılan son 30 günü gösteriyordu, yani *"ABC Tekstil'in 200 siparişi"*
sorusu pencere açıkken cevaplanamıyordu. Pencere kaldırıldı. `orders` üzerinde tek başına
`createdAt` index'i YOKTU: var olan `(status, createdAt DESC)` yalnız `status` EŞİTLİK
predicate'iyle ordering verir, panelin varsayılanı ise `status NOT IN ('CANCELLED')`.

⚠️ **Tekil `(createdAt)` YETMEDİ ve bu ölçümle bulundu:** `BaseService` sıralamaya HER ZAMAN
`id` tie-breaker'ı ekler (offset yolunda `orderBy` dizisi, cursor yolunda keyset koşulu), yani
gerçek sorgu `ORDER BY "createdAt" DESC, id DESC`. Tekil index'le plan `Incremental Sort`
(Presorted Key: createdAt) bırakıyordu. `(createdAt DESC, id DESC) WHERE status <> 'CANCELLED'`
ile hem varsayılan liste hem keyset cursor sayfa-2 temiz `Index Only Scan`'e oturdu.
Yeni bir sıralama index'i eklerken bu tie-breaker hatırlanmalı.

### Altı rapor — hangi soruyu cevapladıkları yazılı

Mevcut karnelerin HEPSİ sevk tarafına bakıyordu; sipariş GİRİŞİ hiç ölçülmüyordu.
Açık Sipariş Karşılanma · Sipariş Karnesi · Müşteri Karnesi (ABC+RFM) · Talep Analizi ·
Sipariş→Teslim Süresi · Sipariş İptal Karnesi.

⚠️ **Karşılanma raporu `order.service.getCoverageForLines` KULLANMAZ.** O motor fungible depo
havuzunu HER SATIRA TAM yazar — ekran içi tek sipariş için doğru, raporda ÇİFT SAYIM. Ölçüldü:
120 m'lik stokla üç sipariş de "sevk edilebilir" görünüyor. Motor `production-balance.service`;
havuz satırlara **aciliyet sırasına** göre bölünür (termin ASC, terminsiz EN SONA — söz
verilmemiş işi söz verilmiş işin önüne geçirmemek için).

⚠️ **Sipariş→Teslim Süresi'nde ana rakam MEDYANDIR**, ortalama yanında durur. Ortalama tek bir
felaket siparişle yukarı çekilir ve ona dayanan termin sözü siparişlerin yarısında tutmaz.
`minSample` (5) altında sayı BASILMAZ — az örneklemle hesaplanan medyan istatistik değil
tesadüftür. Bugün canlıda örneklem 1: ekran "yeterli veri yok" diyor ama "37 gündür bekleyen
açık sipariş" listesi yine işe yarıyor.

⚠️ `factoryMonthSql` `constants/time.ts`'e eklendi (`factoryDaySql` ikizi). Ayın ilk gecesi
(yerel 00:00–03:00) UTC'de HÂLÂ ÖNCEKİ AYDIR; çıplak `DATE_TRUNC('month')` mevsimsellik
serisini kaydırır. Saat dilimi literalini çağıran tarafa kopyalama.

### İptal sebebi: ÖNCE veri, SONRA rapor

İptal Karnesi'nin planı "audit hazır" varsayıyordu. Ölçüm çürüttü: `Order`'da iptal sebebi
kolonu YOKTU, iptal ucu sebep parametresi ALMIYORDU, audit kaydı bile yalnız
`{"status":"CANCELLED","actions":[]}` yazıyordu. Yani *"müşteriler neden vazgeçiyor"* sorusu
veri yokluğundan cevapsızdı. Sıra tersine çevrildi: önce `ReasonPresetKind.ORDER_CANCEL` +
`Order.cancelledAt/cancelReason/cancelReasonCode`, rapor sonra.

**KARAR — "değişiklik geçmişi" yarısı KAPSAM DIŞI (2026-08-27, kullanıcı onayı).**
Raporun planlanan ikinci yarısı ("sipariş sonrası ne değişti") YAZILMADI. Üç ölçüm:
① gerçek siparişlerdeki 29 `ORDER UPDATE` audit kaydının **hepsinde `changes` kolonu NULL** →
alan bazlı değişiklik çıkarılamıyor; ② plan sapmalarının **zaten kendi karnesi var**
(`plan-deviation-scorecard`) → o yarı tekrar olurdu; ③ geriye kalan tek ölçülebilir şey
"75 siparişin 17'si düzenlenmiş" sayacıydı ve iptal oranı **zaten Sipariş Karnesi'nde**.
Boş sütunlu bir rapor yüzeyi eklemek yanıltıcı olurdu (2026-08-09'da tam bu sebeple iki rapor
kaldırılmıştı). İleride istenirse ön koşul: `AuditService`in ORDER UPDATE'te `changes`
doldurması. Rapor `meta`sında ve servis başlığında da yazılı.

⚠️ **Çıpa `cancelledAt`** (iptalin OLDUĞU an), `orderDate` değil: sipariş Ocak'ta alınıp Mart'ta
iptal edilebilir. Sipariş Karnesi'ndeki iptal oranı FARKLI bir soruyu cevaplar ("bu ay ALINAN
siparişlerin kaçı sonradan iptal oldu") ve iki rakamın birbirini tutması GEREKMEZ.
Alan sonradan eklendiği için eski 4 iptalde NULL'dur → dönem raporuna girmezler; geriye dönük
damga UYDURULMADI, sayıları `undatedCancelCount` ile ayrıca döner ve ekranda yazılıdır.

### Sipariş KALEMİ iptali — asıl maliyet kolon değil, yayılım

10 kalemlik siparişin 3 kalemini iptal etmek bugüne dek İMKÂNSIZDI: kalem çıkarmanın tek yolu
hard-delete idi ve aktif iş emri bağı varsa tamamen reddediliyordu. Artık SOFT iptal — kalem
listede üstü çizili kalır, sevk edilmiş metrajı defterde durur, iş emri bağı otomatik kopar
(son bağsa iş emri STOK üretimine döner: "tip = bağın aynası").

⚠️ **Statü aritmetiği işin kalbi:** `recomputeOrderStatus`ta
`totalRequired = Σ(aktif.quantity) + Σ(iptal.shipped)`. İptal kalemin `quantity`si toplamda
kalsaydı sipariş o farkı ASLA kapatamaz, **sonsuza dek PARTIAL_SHIPPED** görünürdü. Son aktif
kalem gidince: sevk varsa COMPLETED, yoksa CANCELLED (kullanıcı kuralı).

⚠️ **`==` vs `===` — sessiz felç.** Süzgeç `cancelledAt == null` (GEVŞEK) yazılır. Alanı
`select`'ine almayan bir çağıran `undefined` gönderir ve KATI `=== null` orada FALSE döner →
TÜM kalemler iptal sayılır → sipariş sevk yokken CANCELLED'a düşer. Ölçüldü: `test_helpers`in
sahte tx'i tam bunu yaptı, dört senaryo birden bozuldu. Eksik bir alan siparişi iptal ettiremez.

⚠️ **Aktif-kalem kuralı TEK KAYNAK** `helpers/order-line-scope.helper.ts` + AST bekçisi
`test_order_line_scope_single_source` (fason `fason-open-dispatch.helper` emsali). Kural tek
cümle: **GELECEK sorusu süzer, GEÇMİŞ sorusu süzmez.** Ham SQL'de gerekçeli
`-- aktif-kalem-muaf:` işareti (`-- tz-ok:` deseninin ikizi) geçmiş sorgularını muaf tutar.
Bekçi, elle taramada KAÇIRILAN üç süzgeci buldu: talep analizinin aylık ham SQL'i, müşteri
sipariş profili, sevk & termin karnesinin `plannedQty`si.

⚠️ **Düzenleme yolu da kapatıldı:** sipariş formu kalemleri toptan gönderir; iptal edilmiş kalem
payload'da yoksa diff onu SİLER (iptal olgusu + sevk metrajı kaybolur), varsa metrajı
DEĞİŞTİRİLEBİLİR. İkisi de sunucuda kapalı, istemci disiplinine bırakılmadı.

**BİLİNEN SINIR (yazılı):** *"iptal anında iş emri açılmış mıydı"* ÖLÇÜLEMİYOR — iptal akışı WO
bağlarını koparır, karar anındaki bağ sonradan okunamaz. Vekil ölçüler `daysToCancel` +
`afterShipmentCount`. Ölçmek istenirse sayı iptal ANINDA dondurulmalı.

### Bekçinin kör noktası hatanın kendisiyle aynı yerdeydi (tekrar)

`test_order_line_cancel`ın ilk hâli aritmetik regresyonunu YAKALAMIYORDU: tek kalemli
senaryoda "hepsi iptal" dalı statüyü doğrudan belirliyor ve `totalRequired` hiç gözlenmiyor.
Negatif sonda ilk turda **yeşil kaldı**. Aritmetik ancak SİPARİŞTE AKTİF KALEM KALIRKEN görünür
(§4b). Bu dosyaya senaryo eklerken aynı tuzak geçerli.

**Migration:** `20260826120000` (orders sıralama index'i) · `20260826130000` (ORDER_CANCEL enum) ·
`20260826130100` (sipariş iptal izi) · `20260827100000` (kalem iptali).
**İzin YOK · APK YOK** (mobil sipariş iptal etmez). Backend ÖNCE deploy.

---

## 2026-08-27 (ikinci tur) — Yarı mamul ayrımı Kanban'a ve tablete taşındı + Kanban'ın ESKİ sapması

> ⚠️ **PROFİL GERÇEĞİ:** Kanban kolonları ve mobil Depo sekmeleri `production.enabled` yüzeyleridir; "bugün fark 0 ama tesadüfen" ölçümü bu kurulumun verisi. **Çekirdek:** "bekçi ANAHTAR değil SAYI SEMANTİĞİ ölçer" (pano=48 ↔ envanter=47 negatif sondası), "altıncı unutulmuş enum" sınıfı ve "üç yüzeyde TEK rakam" ilkesi — bkz. MODUL-BAYRAK-TASARIM §3 madde 8.

2026-08-26'da envanter sekmesi ayrılmış, ayrımı takip ETMEYEN yüzeyler gerekçeleriyle
listelenmişti. Kullanıcı o listeden ikisini kapsama aldı.

### ① Üretim Akışı (Kanban) — iki düzeltme, TEK dokunuş

**Yeni kolon "Yarı Mamul"**, Ham Stok'un yanında. Yan yana ama aynı kova değil: yarı mamul
boyahaneyi **atlar**, akışa Kurşun'dan girer. Renk bilerek AYRI (cyan) — iki kolon komşu ve
aynı aileden, aynı tonda olsalar operatör sayaçları karıştırır; ayrımın görünürlüğü bu paketin
varlık sebebi. Mobil Depo sekmesiyle aynı ton.

**⚠️ Aynı sorguda ESKİ ve BAĞIMSIZ bir sapma da kapandı.** Kolon `rollColumn(STOCK)` ile düz
`{ status }` sorguyordu — `currentStepId` koşulu YOKTU. Yani bir adıma bağlı STOCK topu panoda
sayılıyor, Envanter sekmesinde (`rollScope`) sayılmıyordu: **aynı adı taşıyan iki yüzey farklı
rakam basıyordu ve bu yarı mamulden tamamen bağımsızdı.** Bugün prod'da fark 0 (283 STOCK topun
hepsi adımsız), ama koşul olmadan eşitlik bir invariant değil TESADÜFtü.

**Bekçi genişletildi** (`test_production_flow_columns`): eskiden yalnız kolon ANAHTARLARININ
varlığını ölçüyordu, **sayı semantiğini değil** — panonun Envanter'den sapması bu yüzden yıllarca
görünmedi. Artık her iki kolonun toplamı Envanter kapsamlarıyla karşılaştırılıyor + kolonların
örtüşmediği ölçülüyor. **Negatif sonda:** adıma bağlı bir STOCK topu üretilip `currentStepId`
koşulu kaldırıldı → `pano=48 envanter=47`, kırmızı. Koşul geri konunca 47=47.

### ② Mobil Depo — "Ham" ikiye ayrıldı

`DepoScreen` sekmeleri: Tümü · Depo · Çuvalda · **Ham** · **Yarı Mamul** · Kartela · Kartelalık.
Eski "Ham" sekmesi düz `status:'STOCK'` gönderiyordu (`rollScope` DEĞİL) → yarı mamul ham kumaşla
karışıktı. Artık `rollScope=RAW_STOCK_PURE` / `SEMI_FINISHED`; **"Tümü" sekmesi bilerek statü
tabanlı kalır** (orada ayrım gerekmez, ayrı sekmeler zaten var).

⚠️ `rollScope=RAW_STOCK` (birleşim) Hızlı İş Emri top seçicisinde DOKUNULMADAN kaldı — daraltılsa
yarı mamul oradan düşerdi.

**Dağıtım:** APK GEREKMEZ — ve bu **ölçüldü, varsayılmadı**. Değişiklik saf JS (yeni native
modül/izin yok, `app.json`a dokunmuyor) → uzaktan güncellemeyle gider. `npm run yayinla`'nın native
parmak izi kontrolü: `3a17652b7719adb6` ↔ önceki kayıt `3a17652b7719adb6` (runtimeVersion 54.2),
**birebir aynı** → bağımlılıklar/plugins/`android` bloğunun hiçbirine dokunulmamış. "OTA'ya uygun
mu" sorusunu insan değil script cevaplar; yanlışlıkla native bir şeye dokunulsa script DURUR ve
"runtimeVersion artır + yeni APK" der.

Sıra: kullanıcı elle turu yapar (2.9.9 kurulur — mühür değişikliği yüzünden zaten gerekiyordu) →
sonra `npm run yayinla -- --musteri=adnansahin`. Uzaktan güncelleme yalnız 2.9.9 kurulu tabletlere
gider, o yüzden elle turdan ÖNCE yayınlamak işe yaramaz.

**Bu, uzaktan güncelleme paketinin ilk pratik faydası oldu:** normalde ikinci bir tablet turu
doğuracak bir iş, hiç tur gerektirmeden çıkıyor.

### ③ Görsel tur — gözle bakmasa yakalanamayacak iki bulgu

Playwright + `_electron.launch` ile uygulama gezildi (temiz `--user-data-dir` profili şart:
yoksa önceki turun oturumu geri yüklenir, giriş ekranı hiç çıkmaz ve seçiciler tutmaz).

1. **"Tip" kolonu yarı mamul topu "Bitmiş" gösteriyordu** (`columns.tsx`
   `rollProcessingState`): `status===STOCK ? (colorId ? "bitmis" : "ham")`. Backend'in "renk varsa
   bitmiş" sezgisinin İSTEMCİ İKİZİ — altıncı giriş kaynağını tanımıyordu. **Beşinci** "unutulmuş
   enum" vakası (öncekiler: `entryTitle`, mobil KK1 listesi, iki `entrySource` filtresi,
   `activity-utils` etiketleri). Yeni `yarimamul` durumu eklendi.
2. **Stok Karnesi'nin 5 kartı 1024px'te sıkışıyordu** — "9283,8 m" iki satıra kırılıyordu.
   `lg:grid-cols-3 xl:grid-cols-5` (beşli sıra yalnız 1280px'ten itibaren).

**Doğrulanan eşitlik:** Stok Karnesi "Ham 47 top" ↔ Envanter Ham Stok rozeti 47 ↔ Kanban Ham Stok
kolonu 47. Üç yüzey, tek rakam — paketin varlık sebebi olan invariant.

**Gözle doğrulanamayan:** Manuel Giriş'teki amber uyarı (renk seçili + kutu işaretsiz) — turda o
kombinasyona girilmedi, kullanıcının Windows provasında bakılacak.

**Ders:** birim testi + typecheck yeşilken bile ekrana bakmak iki gerçek hata buldu; ikisi de
"derleyici görmez" sınıfındaydı (biri string haritası, biri CSS breakpoint).

---

## 2026-08-27 (üçüncü tur) — Yarı mamul ayrımı: kalan dört yüzey. AYRIM GÖSTERİMDE, ARZDA DEĞİL

2026-08-26'daki taramada ayrımı takip ETMEYEN yüzeyler gerekçeleriyle listelenmişti; kullanıcı
**hepsini** kapsama aldı. **Gerekçe ölçümdü:** prod'da bugün 0 yarı mamul kaydı var → akış
başlamadan ÖNCE kapatılırsa sapmalar hiç görünmeden çözülür. Sonradan yapılsaydı fabrika önce
yanlış rakamı görür, düzelttiğimizde rakam kayardı ve "sistem tutarsız" izlenimi doğardı.

### ⚠️ PAKETİN TEK KURALI: yarı mamul ARZDIR, düşülmez — ayrı GÖSTERİLİR

Kullanıcı kararı ve sektör dayanağı aynı yerde buluşuyor: SAP'de HALB ayrı bir stok TÜRÜdür
(ayrı raporlanır, ayrı değerlenir) **ama MRP/ATP'de arza girer**. Yarı mamul rafta duran,
üretime sokulabilir maldır; arzdan düşmek olmayan bir "kumaş tedarik et" açığı uydururdu.
Bu kural aşağıdaki her maddede aynı biçimde uygulandı ve `test_semi_finished_surfaces` §2 ile
kilitlendi — **negatif sonda ölçtü:** yarı mamul arzdan düşürülünce 400 m'lik talepte **200 m
sahte kumaş açığı** doğuyor.

### ① Ürün (Kumaş) Dengesi — `production-balance.service`
`supply` groupBy'ına `entrySource` eklendi; `BalanceGroup.ham` daraldı, **yeni `yariMamul`**
alanı geldi. **`malzemeAcigi` İKİSİNİ BİRDEN düşer** (`uretilecek − (ham + yariMamul)`).
Ekranda: HAM kolonunun altında cyan `+ N yarı mamul` satırı (yalnız >0 iken), "İş Emri Aç"
diyaloğunda kumaş açığı uyarısı da **toplam arza** bakar (`spec.ham + spec.yariMamul`) — iki
taraf ayrışsaydı ekran ve backend farklı açık gösterirdi.

### ② Sipariş karşılama — `order.service`
`getCoverageForLines` → `freeSemiFinished` alanı; `matchFree`'ye opsiyonel `semi` süzgeci.
`getSpecAvailability` → aynı ikili. `netGap` DEĞİŞMEDİ (ham havuzu zaten hiç sayılmıyordu —
işlenmemiş girdi, mamul değil). Sipariş formundaki ipuçta artık "Ham: X · Yarı mamul: Y".
⚠️ Electron tarafında alan **opsiyonel** okunur (`?? 0`) — backend ÖNCE deploy edilir ama sıra
ters dönerse ipucu sessizce kaybolmasın.

### ③ İptal geri alma mesajı — `inventory.service.restoreCancelledRoll`
Her STOCK topu için *"tekrar ham stokta"* diyordu. Yarı mamul topu da STOCK'a döner ama
Envanter'de **"Yarı Mamul"** sekmesinde durur → operatörü yanlış sekmede arattırıyordu. Artık
`entrySource`e bakıp *"yarı mamul stoğunda"* diyor (`select`'e `entrySource` eklendi).

### ④ Kapanış dispozisyonu etiketi — üç yüzey birden
`"Ham stok"` → **`"Stoğa geri"`** (`WorkOrderCompleteDispositionList`), kalite hedef statüsü
`"Ham Stok (üretime devam)"` → **`"Stok (üretime devam)"`** (`QualityGrades/columns`), backend
sözleşme yorumu da düzeltildi. Gerekçe aynı: `STOCK` bir STATÜdür; topun hangi sekmede
görüneceğini `entrySource` belirler. Hint artık "(Ham Stok / Yarı Mamul)" diyor.
⚠️ `WorkOrderCompleteDialog.test` etiketi metinle arıyordu — test de güncellendi.

### Bekçi: `scripts/test_semi_finished_surfaces.ts` (10)
Dört yüzeyi de ölçer. **En değerli iki kontrol:**
- **§2** açık hesabı yarı mamulü arz sayıyor mu (negatif sonda: 200 m sahte açık)
- **§4 toplam korunuyor mu** — `ham + yarıMamul` ayırmadan önceki tek rakama eşit olmalı;
  eşit değilse bir yerde metraj DÜŞÜRÜLMÜŞ demektir (ayrım sunumdur, aritmetik değil)

⚠️ Fixture sırası load-bearing: **Ürün Dengesi TALEPTEN doğar**, sipariş kalemi olmayan bir
spec listede HİÇ görünmez. Önce talep, sonra ölçüm — ters sırada test "grup=0" ile düşer.

### Görsel doğrulama
Kumaş Dengesi'nde `ALP GÜMÜŞ · EKRU` satırı ekranda ölçüldü: **HAM 0 · "+ 640 yarı mamul" ·
ham açığı 260** (talep 900). Yarı mamul arza girmeseydi açık 900 çıkardı — kural ekranda da
doğrulanmış oldu.

**Migration YOK · yeni izin YOK · APK YOK.** Backend ÖNCE (Electron `freeSemiFinished`'i
opsiyonel okuduğu için ters sıra da çökmez, yalnız ipucu eksik kalır).

---

## 2026-09-01 — Patron modülü: fabrikaya GELEN PORT AÇMADAN uzaktan takip

> ⚠️ **PROFİL GERÇEĞİ:** `WEB_BOSS` şablonunun `report:finance` taşımaması "alt-ağaç zaten `requireFinanceEnabled` arkasında ve **fabrikada kapalı**" gerekçesine dayanır — `finance.enabled` AÇIK bir kurulumda bu gerekçe düşer ve şablon yeniden değerlendirilir. **Çekirdek:** uzaklık SOKETTEN çözülür (`clientType` güvenlik sınırı DEĞİL), Access JWT FAIL-CLOSED, JWKS TTL = tazelik (geçerlilik değil), `clientIpHeaderRemoteOnly`, helmet İKİ ÖRNEK / TEK PROCESS, uzakta 404 (403 keşfe davet) ve sır hijyeni — bkz. MODUL-BAYRAK-TASARIM §7, §12 kural 8.

**Talep:** patron dışarıdan stoğu/siparişi izlesin; ara sıra sipariş, iş emri ve
müşteri kaydı da açsın. Yani salt-okunur bir ayna DEĞİL, **canlı ve yazabilen dar
bir yüzey**.

### Neden tünel — ve neden ayna DEĞİL

Üç seçenek tartıldı. **Bulut ayna elendi** çünkü tek yönlüdür: yazma gelince ya
iki yönlü senkron yazılacaktı (çatışma çözümü + kuyruk + sıralama — ayrı bir
proje) ya da yazmalar için yine canlı bağlantıya düşülecekti. **Uygulama
seviyesi senkron da elendi**: bu koddaki atomik claim'ler, `pg_advisory_xact_lock`
(8021/8022/8024/8028) ve `clientToken` idempotency'sinin TAMAMI tek DB varsayar.

İlk tasarım WireGuard + kendi VPS'imizdi; **Cloudflare Tunnel + Access'e
çevrildi**. Fark tünelde değil KİMLİKTE: Access, ERP'ye ulaşmadan önce bir
e-posta OTP duvarı koyar ve bu TeksERP'ye tek satır kod yazmadan gelir.
"CF araya girer, trafiği görür" itirazı bu projede geçersiz — turuncu bulut
Origin CA yüzünden zaten zorunlu, yani CF her hâlde TLS'i sonlandırıyor.

### Uzaklık SOKETTEN çözülür — `clientType`ten değil

Aynı process iki dünyaya hizmet ediyor: LAN (`0.0.0.0:4000`) ve tünel
(`127.0.0.1:REMOTE_PORT`). Ayrımın kaynağı `req.socket.localPort`tur.

⚠️ **`clientType` bir güvenlik sınırı DEĞİLDİR** — gövdeden gelir, internetten
gelen biri `clientType:"electron"` yazıp LAN kurallarına (PIN girişi, TOTP
muafiyeti) düşerdi. Tünel dinleyicisi **yalnız `127.0.0.1`e** bağlanır; LAN'dan
erişilemediği için uydurulamaz ve **paylaşılan sır yoktur** (sızacak ya da
rotasyona girecek bir şey yok).

⚠️ **4001 `0.0.0.0`a AÇILAMAZ.** Açılırsa fabrikadaki herhangi biri kendini
"uzak" gösterebilir ya da tersi olur; iki yönde de kural seti sessizce yanlış
uygulanır. `HOST` env'i bilerek onurlandırılmaz — o LAN dinleyicisinin ayarıdır.

### İkinci katman: Access JWT, FAIL-CLOSED

Uzak `/api` isteklerinde `Cf-Access-Jwt-Assertion` RS256 + JWKS ile doğrulanır
(`jsonwebtoken` zaten bağımlılıkta; JWK→PEM `node:crypto`nun kendi `format:"jwk"`
desteğiyle — `jwks-rsa` GEREKMEZ).

Bu yalnız derinlik savunması değil: **Access politikası CF panelinden
yanlışlıkla kaldırılırsa** kimlik duvarı sessizce düşerdi ve bunu hiçbir yerden
göremezdik. Burada uzak erişim DURUR.

⚠️ JWKS önbelleğinde **TTL'in işi TAZELİKTİR, GEÇERLİLİK DEĞİL** (2026-08-26
`ReasonPreset` dersinin birebir aynısı): süre dolunca `null` dönüp fail-closed'a
düşmek, CF'e giden tek bir yavaş isteğin patronu kapıda bırakması demekti. Bayat
anahtarlar da döndürülür + arka planda tazeleme tetiklenir. **Bayatlık ≠ boşluk**:
önbellek HİÇ dolmadıysa fail-closed KALIR (ve bu güvenli — JWKS'e ulaşılamıyorsa
tünel de ayakta değildir, yani gerçek bir uzak istek gelemez).

### Uzakta kapalı yollar — neden 404, neden 403 değil

`login-quick-pin` · `login-card` · `mobile-users` · `/api/devices` ·
`/api/discovery` · `/api/mobile` · `/api-docs`.

En kritiği PIN: **`users.quickPin` 6 HANE, DÜZ METİN ve sistem genelinde
`@unique`** — yani PIN tek başına kimliği belirler. 10^6'lık bir uzayı internete
açmak tüm operatör hesaplarını kaba kuvvete açmaktır. `POST /api/devices/announce`
ise kimliksiz PENDING cihaz yaratır ve tavan 200'dür → tablet eşleştirmesi
DoS'lanabilirdi.

**403 değil 404**: 403 "burada bir şey var ama giremezsin" der ve keşfe davet
eder. Servis katmanında da ikinci hat var (`assertNotRemote`) — kenar denylist'i
bir refactor ya da yanlış mount sırasıyla düşerse devreye girer.

### Sessizce kapanan açık: `CLIENT_IP_HEADER`

Başlık app-wide okunsaydı **karışık modda LAN'daki biri
`CF-Connecting-IP: <rastgele>` yazarak giriş kilidini VE hız sınırını tamamen
etkisizleştirirdi** (her denemede farklı kova). Güven artık
`clientIpHeaderRemoteOnly` ile daraltılıyor ve bayrak `REMOTE_PORT`ten
TÜRETİLİYOR — uzaktan erişim kapalı kurulumlarda (demo dahil) davranış birebir
eskisi gibi.

⚠️ `TRUST_PROXY` app-wide AYARLANMAZ: Express'in `trust proxy`si uygulama
genelidir ve LAN'da da `X-Forwarded-For`a güvenirdi. Zaten `resolveClientIp`in
dokümanı 2026-08-14'te `TRUST_PROXY`nin bu işi çözemediğini canlı demoda
ölçmüştü — asıl mekanizma başlıktır.

### helmet İKİ ÖRNEK, tek process

HSTS + CSP `upgrade-insecure-requests` internette gerekli; **LAN'da AYNI
başlıklar paneli KIRAR** — tarayıcı `http://192.168.1.250:4000` adresini kalıcı
https'e çevirir, sunucu 443 dinlemediği için panel açılmaz ve geri dönüş
SUNUCUDA DEĞİL kullanıcının HSTS önbelleğindedir. Tek bir helmet örneğini
"ortalama" yapılandırmayla kurmak mümkün değil → iki örnek, istek başına seçim.

⚠️ Dispatcher'ın **fonksiyon adı `helmetMiddleware` olmak ZORUNDA**: Express
katman adını fonksiyondan alır ve `test_middleware_order` sırayı ADLA doğrular.
İsimsiz arrow yazıldığında katman "bulunamadı" olur ve sıra sözleşmesi
SESSİZCE ölçülmez hâle gelir (ilk yazımda tam bu oldu).

### İKİ DİNLEYİCİ ≠ İKİ PROCESS

`server.ts`teki tek-process invariantı korunuyor: presence Map'i, feature-flag
cache'i ve zamanlayıcı bayrakları PROCESS-local'dir; tek process içinde ikinci
bir soket açmak onların hiçbirini çoğaltmaz. Bozulan şey ikinci bir NODE SÜRECİ
olurdu — o hâlâ YASAK. (Invariant yorumu "tek `app.listen`" diyordu, düzeltildi.)

### TOTP — kendi kodumuz, dış vektörle doğrulandı

`node:crypto` HMAC-SHA1, yeni paket YOK. Standarda uyum **RFC 4226 + 6238 test
vektörleriyle DIŞARIDAN** doğrulandı; kendi ürettiğini doğrulayan bir tur hatalı
uygulamayı da onaylardı ve Google Authenticator uyumsuzluğu ancak sahada,
girişte görülürdü.

**Kurulumun TEK yolu yöneticinin açtığı 15 dk'lık tek kullanımlık penceredir.**
"Parola doğruysa kullanıcı kendi kursun" (TOFU) reddedildi: parola sızmışsa
saldırgan 2FA'yı KENDİ telefonuna bağlar ve meşru sahibi kilitler — yani 2FA'nın
koruduğu TEK senaryo kapanırdı.

⚠️ **İkinci faktör `issueToken`den ÖNCE koşar.** Sonraya bırakılsaydı yalnız
parolayı ele geçiren biri, TOTP'yi hiç geçemese bile meşru kullanıcıyı
oturumundan atabilirdi (`kick` politikası oturum kaydı açarken diğerlerini
düşürüyor).

**Üç hata kodu, üç farklı statü** ve ayrım keyfi değil — giriş kilidi yalnız
**401**'i kaba kuvvet sayar (`auth.controller` F49): 403 kurulum yok · 409 kod
istendi · 401 kod yanlış. 409'u 401 sanmak meşru kullanıcıyı KOD İSTENDİĞİ İÇİN
kilitler; 401'i 409 sanmak yanlış kod girmeyi sonsuz denemeye çevirir.

Kurtarma kodları **bcrypt** ile saklanır (`quickPin`/`cardToken`tan ayrılan
nokta ve bilinçli): kurtarma kodu parolaya denk bir sırdır, oysa PIN LAN-only
fiziksel bir kolaylıktır.

### `ClientType.WEB`

Web paneli Electron renderer'ının AYNI kodudur ve `clientType:"electron"`
gönderiyordu → patron telefondan girince masaüstü oturumunu DÜŞÜRÜYORDU
(`sameTypeSessionPolicy` varsayılanı `kick`). Artık kendi oturum yuvasını alıyor.

⚠️ `isDesktopClient`te **`!== "mobile"` YAZILMAZ**: `clientType` opsiyoneldir ve
`undefined` tarihsel olarak MOBİL demektir; negatif yazım alanı hiç göndermeyen
eski mobil istemcileri masaüstü sayıp hepsini 403'e düşürürdü.

Aynı dokunuşta **altıncı "unutulmuş enum değeri"** yakalandı:
`describeExistingSession` iki dallıydı ve `web`i sessizce "mobil cihaz" diye
gösteriyordu → `Record` biçimine alındı (dördüncü değer eklenirse TS derlemede
söyler).

### `GET /api/boss/overview` — tek uç, bölüm bazlı izin

Beş bölüm (stok · sipariş · üretim · sevkiyat · fason), **yeni iş mantığı YOK**:
mevcut rapor servisleri compose edilir. Naif çözüm istemcinin altı raporu ayrı
çağırmasıydı; bedeli tünel üzerinden altı gidiş-dönüş değil sadece — her istemci
hangi raporu çağıracağını KENDİ bilirdi ("ayrışan yüzey" sınıfı).

**İzin süzmesi SERVİSTE** (`GET /api/search` deseni) ve **yeni izin kodu YOK**
(2026-08-01 kurşun bypass dersi: yeni kod = sahada atanması unutulacak bir adım
daha). Yetkisiz bölümün SORGUSU HİÇ KOŞMAZ.

⚠️ **Üretim kartı ADET basar, metraj değil.** `getProductionFlow` kolon başına
yalnız sayım döndürüyor; burada metraja çevirmek aynı sorunun İKİNCİ tanımını
doğururdu (2026-08-27: pano 48 / envanter 47).

`WEB_BOSS` rol şablonu bilinçli DAR: `report:finance` YOK (alt-ağaç zaten
`requireFinanceEnabled` arkasında ve fabrikada kapalı — koymak hiçbir şey
açmayan ama "verilmiş" görünen bir izin bırakırdı), SoD üçlüsü YOK,
`report:audit` YOK (denetim takip değil YÖNETİM yüzeyi).

### `BossShell` — sekme sistemi bypass, router altyapısı DEĞİL

`AppShell` "uygulama içinde tarayıcı sekmeleri" modeli; telefonda sekme şeridi
ekranın üçte birini yer ve dokunmatikte kapatma düğmeleri isabet almaz.

⚠️ **Ama kendi memory router'ını KURMA.** `content-routes` sayfaları `useTabId`,
`TabPortalProvider` ve geçmiş defterine (`history-depth`) bağlı — onlarsız
`PageHeader`ın geri oku SESSİZCE ölür ve modaller yanlış yere portallanır. Tek
"boss" sekmesi açıp aynı makineyi kullanmak, detaya inişin bugünkü ekranlarla
çalışmasını sağlıyor.

⚠️ **Hash değişimi React'e hiçbir şey söylemez.** `Root` kapısı düz
`window.location.hash` okuyordu → "Tam panele geç" adresi değiştiriyor ama ekran
patron kabuğunda ASILI KALIYORDU; hata yok, log yok, tepkisiz düğme.
`useHashPath` (`useSyncExternalStore` + `hashchange`/`popstate`).

### Web paneli backend PAKETİNE girer

`deploy/paketle.ps1` `Electron/dist-web`i derleyip pakete koyar; sunucuda
`app\dist-web`. **Sürüm drift'i matematiksel olarak imkânsız** — ayrı kanaldan
yayınlansaydı SPA bir sürümü, API başka bir sürümü konuşabilirdi ve belirtisi
"ekran boş" olurdu.

⚠️ **Eksiklik SESSİZDİR**: `WEB_DIST_DIR` var olmayan bir klasörü gösterirse
`express.static` no-op olur ve kök (/) panelin YERİNE durum sayfasını basar. Bu
yüzden iki kapı: derleme başarısızsa paket ÜRETİLMEZ, derleme 0 dönüp BOŞ klasör
bırakırsa da üretilmez (`index.html` kontrol edilir).

⚠️ PowerShell'de **backtick KAÇIŞ karakteridir** — hata mesajında
`` `npm install` `` yazmak `` `n `` yüzünden satır kırıyordu.

### Bekçiler

| Bekçi | Kontrol | Negatif sonda |
|---|---|---|
| `test_remote_access_guard` | 51 | 4 (denylist · helmet · IP başlığı · Access JWT) |
| `test_totp` | 69 | RFC vektörleri dış referans |
| `test_boss_overview` | 60 | 4 (izin süzmesi · kolon sayımı · matchesPermission · kırılım) |
| `login-totp.test` (Electron) | 14 | 2 |
| `boss-shell.test` (Electron) | 11 | 3 |

⚠️ **`test_remote_access_guard`ın asıl iddiası "LAN yolu değişmedi"** ve bu
gerçek bir HTTP sunucusuyla, İKİ PORT üzerinden ölçülür. Yalnız uzak yolu test
etmek vakumen yeşil kalırdı (uzak yol zaten yeni kod).

⚠️ **`test_boss_overview`da kırılım kontrolü İLK YAZIMDA YOKTU** ve bunu negatif
sonda yakaladı: `byCustomer` alanını değiştirmek DERLENİYOR ve testi GEÇİYORDU.
Sonda seçerken ikinci tuzak: bu veride `openQty === uncoveredQty` (hiçbir sipariş
depodan karşılanmıyor) → o ikisini değiştiren sonda YEŞİL kalır; kırmızı kanıtı
`fromWarehouseQty` ile alınır.

⚠️ **`login-totp.test` ilk yazımda KENDİ YORUMUNU yakaladı** (doküman
bloğundaki `clientType:"electron"` ifadesini kod sandı). Kaynak taraması yapan
her bekçi önce yorumları atmalı — aynı ders `print-merge`te de ölçülmüştü.

### Canlı ölçüm (iki dinleyici, tek process)

LAN `clientType:"web"` girişi kabul · `/api/boss/overview` gerçek veri (ham
31971 · yarı 7660 · bitmiş 30671 m, 69 açık kalem / 78870 m, 23 geciken, 7
kolon, 6 istasyon, fasonda 1200 m) · tünel portunda Access başlığı yokken 403 ·
PIN/cihaz uçları tünelde 404 ama LAN'da 401/400 (erişilebilir) · HSTS + CSP
upgrade yalnız tünelde · `WEB_DIST_DIR` ile kök panel + asset 200.

**Migration:** `20260901173733_uzaktan_erisim_totp` (additive — `ALTER TYPE ADD
VALUE` + iki tablo). ⚠️ Prisma'nın ürettiği iki `DropForeignKey` satırı ELLE
SİLİNDİ (DEFERRABLE composite FK tuzağı, perf kuralı 4) ve `test_schema_drift`
ile doğrulandı. **Yeni izin kodu YOK · APK YOK.**

**AÇIK MADDELER:**
- Uzak TOTP akışı canlı ölçülemedi (tünel portu geçerli Access JWT'si istiyor) —
  gerçek CF kurulumunda bir kez denenmeli (reçete: kabul ölçümü #5).
- Fiziksel LAN regresyonu (tablet PIN + panel) fabrikada yapılmalı.
- **Faz 2 mobil uygulaması Access ile sürtüşecek**: native istemci servis
  token'ı ister, o da APK'ya gömülü paylaşılan bir sır demektir. O gün ya
  `/api/*` Access dışına alınıp yalnız SPA gatelenir, ya mobil için ayrı yol.
- Kesintide patron veri göremez (CF Error 1033). Kalıcı çözüm okuma replikası ve
  o **WireGuard ister** — CF Tunnel PostgreSQL replikasyonunu taşımaz.
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-09-03__2026-09-03-superadmin-p2-satici`: P1'in AÇIK maddesi 'P2 süperadmin (flagWriteGuard üçüncü dal MODULE_FLAG_KEYS.some)' kapandı: dal EN ÖNDE, `.some`, senkron, `MODULE_FLAG_SUPERADMIN_ONLY` + emniyet supabı. P1'in diğer açıkları (mobil MODULE_DISABLED yüzü, /api/rolls uç-bazlı kapı, finance regime) hâlâ açık.
>

### 2026-09-02/03 — Modül anahtarları P1: `finance.enabled` kalıbı beş modüle çoğaldı, üretim kapıya TERFİ etti, grandfathering "dünkü davranış"ı damgalar

> ✅ **ÇEKİRDEK — bu not sınıflamanın KENDİ TEMELİDİR:** tek gövde/çok fabrika altyapısı (7 anahtar · adlandırılmış middleware · tek kaynak `module-flags.ts` · bağımlılık iki yerde · `MODULE_DISABLED` · grandfathering "değer = DÜNKÜ DAVRANIŞ"). Bu dosyadaki eski notlar okunurken kural: **"adnansahin'de yok" = "bayrağı kapalı"**; hiçbir eski not `if (musteri === 'X')` gerekçesi olarak kullanılamaz — bkz. MODUL-BAYRAK-TASARIM §11, §12 kural 6.

**Bağlam:** Tek gövde / çok fabrika kararı (`docs/design/MODUL-BAYRAK-TASARIM.md`, plan `MODUL-BAYRAK-UYGULAMA-PLANI.md` P1). Dilim 0 aynı gün: `main` ff-merge, `adnansahin` + `feature/depo-mal-kabul` emekli (fabrikadaki BUILD klonu hâlâ `adnansahin`'de — sıradaki paketlemeden önce sunucuda `git checkout main`, reçete `deploy/README.md`). Kod `feature/modul-bayrak` dalında; 7 keşif + 6 uygulama/doğrulama + 2 düzeltme/doğrulama ajanı (Opus/Sonnet), spec ve karar ana oturumda.

**Ne yapıldı (backend ÖNCE; Electron aynası dar; APK YOK; izin YOK; migration 1 — additive):**
- **Anahtarlar `finance.enabled` kalıbında** — `ticaret.enabled` · `iplik.enabled` · `depo.multiEnabled` · `kumasTeknik.enabled` · `tezgah.enabled` (+ mevcut `production.enabled`, `finance.enabled`). Tasarımdaki `modul.*` KAVRAMSAL sınıf adıdır, koda girmez. API/Electron alanı camelCase (`ticaretEnabled`…). Dört kapı + sekizinci ayak (middleware) her anahtarda.
- **Middleware adı = `require` + PascalCase(alan)**: `requireTicaretEnabled` · `requireIplikEnabled` · `requireDepoMultiEnabled` · `requireProductionEnabled` — hepsi YENİ dosya `src/middlewares/module.middleware.ts`, `finance.middleware` kalıbı, ARGÜMANSIZ `readXEnabled()` (cache'siz), 403 + **`details.code = "MODULE_DISABLED"` + `details.modul`** (kod TOP-LEVEL değil — `error.middleware` sözleşmesi; `body.code` okuyan istemci hep `undefined` görür). Jenerik `requireModule("x")` YASAK (bekçiler adı AST/metin arar — negatif sondayla ölçüldü: jenerikleştirince router KAPISIZ sayılır). Yer tutucu `kumasTeknik`/`tezgah`: middleware YOK, panel toggle YOK (`PANEL_EXEMPT` gerekçeli) — route'suz kapı `REGIME_GATES`te ölü satır olurdu.
- **Tek kaynak `src/constants/module-flags.ts`**: `MODULE_FLAG_KEYS` (7) · `MODULE_SETTING_KEYS` (7, BİLEREK düz string — `SETTING_KEYS`ten türetmek dairesel import → CommonJS'te `undefined` Set → K7 kapısı sessizce açılırdı) · `MODULE_DEPENDENCIES` (`iplik→ticaret`, `tezgah→production`) · `MODULE_LABELS`. Anahtarlar ortak ön ek taşımadığı için P2'nin "modül anahtarını yalnız süperadmin yazar" guard'ı ad kalıbıyla DEĞİL bu kümeyle yazılacak.
- **Bağımlılık (iplik→ticaret, tezgah→production) İKİ yerde, okuyucular HAM**: ① `requireIplikEnabled` ÖNCE ticareti ölçer (403 `modul:"ticaret", dependent:"iplik"` — operatörü doğru şaltere gönderir), ② `setFeatureFlags` yazma doğrulaması (`assertModuleDependencies`, tüm yazmalardan ÖNCE, tek yüklem "bağımlı açık kalacaksa ön koşul da açık kalmalı"; 400 `MODULE_DEPENDENCY`; tek gövdede ikisini birlikte açmak/kapatmak 200). `readIplikEnabled`/`getFeatureFlags` HAM DB değerini döner (panel toggle kendi yazdığını geri okur); etkin değer Electron ctx'te TEK yerde (`useOperationsVisibility`: `iplikEnabled = ticaret && iplik`), `yarn-regime` zinciri yeniden kurmaz.
- **Route kapıları**: purchase-order · item-price · stock-count → ticaret (finance'ten TAŞINDI); goods-receipt (kapısızdı) → ticaret; yarn → iplik; warehouse-transfer (kapısızdı) → depoMulti; üretim 10 router (route · product-recipe · workorder · production-balance · tambur · kursun-qc · kursun-bypass · traveler-card · batch · station-capability). **Bilinçli KAPISIZ** (başlık yorumunda): `/api/rolls` (karma — KK1 motoru çekirdek; üretim kapalıyken `/open-fabric`, `/:id/kursun-finish`, `/production-flow`, `/subcontractor-summary` AÇIK kalır, uç-bazlı kapı sonraki paket) · stations · machines · work-sessions · subcontractor* (modul.fason Dilim 1 dışı) · kartela/swatches · ortak kataloglar/baskı · traveler-templates · reports/dashboard. `traveler-card.routes` iki router taşır: kapı `travelerCardRouter`da, `workOrderTravelerRouter` kapıyı `workorder.routes`tan MİRAS alır (iki kez takmak her istekte ayar okumasını ikiye katlar). `warehouse.service`/`warehouse.routes` defteri KAPISIZ KALIR (fabrika yolları da yazar) — "kardeş uçlar da rejimsiz" cümlesi düzeltildi.
- **Servis-katmanı iplik kapısı (adversarial bulgu):** route kapısı yetmedi — `goods-receipt.service` ve `stock-count.service` YARN kalemi için `applyYarnMovementTx` çağırıyordu ve ikisi de ticaret kapısındaydı → ticaret AÇIK + iplik KAPALI kurulumda kg defteri doluyordu. Tek-kaynak kontrol `applyYarnMovementTx`in İLK ifadesi (`readIplikEnabled(tx)` → 403 `modul:"iplik"`); çağıranlara ayrıca kontrol YOK. Köprü bayrağı da tek resolver: `resolveYarnOutOnInvoiceEnabled` = finance && ticaret && iplik && altBayrak (`readFinanceYarnOutOnInvoiceEnabled` yalnız orada geçer).
- **Ham ayar ucu açığı kapandı:** `PUT /api/admin/settings/:key` modül anahtarına 400 `MODULE_KEY_RESERVED` — `STRUCTURED_SETTING_KEYS` boolean bayrakları içermiyordu, düz `"true"` string'i `flagWriteGuard`ı (ve P2'nin süperadmin dalını) tamamen atlardı.
- **Grandfathering migration `20260902230000_modul_anahtarlari_grandfathering`** — üç ders: ① **KOŞULLU** (`WHERE EXISTS (SELECT 1 FROM "rolls")`): koşulsuz INSERT taze kurulumu da damgalar ve P6 profil job'unun "satır varsa dokunma" sözleşmesini kalıcı no-op'a çevirir (`kur.ps1` yeni kurulumda da `migrate deploy` koşar); ② **değer = DÜNKÜ DAVRANIŞ, sabit değil**: `production=true`; `ticaret`/`iplik` := `finance.enabled` satırının değeri (dün o dört yüzey finance kapısındaydı — sabit `false` yazmak finance açık + ticaret verili kurulumda (demo) dört yüzeyi sessizce 403'e düşürürdü; Adnan: satır yok → false); `depo.multiEnabled` := `count(*)>1 FROM warehouses WHERE "isActive"` (Electron `useWarehouses` türevinin SQL aynası; `isActive` süzgeci load-bearing) ve koşulu `rolls VEYA aktif depo>1`; ③ `ON CONFLICT DO NOTHING`, DÜZ `now()` (kolonlar timestamptz — `AT TIME ZONE 'UTC'` 3 saat kaydırır), `updatedAt` elle, `description` metinleri `setFeatureFlags` dallarıyla BİREBİR (bekçi karşılaştırır). `readProductionEnabled`ın `if (!setting) return true` sigortası KORUNUR — damga sonrası canlıda ölçülmez, damgasız kopyada (eski dump/dev) sadeleştiren üretimi sessizce kapatır. `finance.enabled` bugün tam bu sınıfın kurbanı: ne migration ne seed ile doğdu, satırı yalnız panel/`setup-ticaret` yazar.
- **Sıfır fark ölçüldü (K13):** fabrika damgasıyla 71 mount'a kimlikli sonda → `MODULE_DISABLED` yalnız 6 mount; 4'ü (item-price · purchase-order · stock-count · yarn) `main`'de zaten `requireFinanceEnabled` ile 403'tü → statü değişmedi; YENİ 403 yalnız goods-receipts + warehouse-transfers (dump: 0 mal kabul · 0 depo · 0 transfer · 0 alış siparişi · 0 iplik hareketi). `production.enabled=false` → 11/11 üretim ucu 403, 22 çekirdek ucun hiçbiri. Dump provası: taze restore → 229 migration → 6 satır doğru; ikinci deploy "No pending"; boş DB → 0 satır; `test_consistency` aynı 4 bilinen bölüm (§1c/§1d/§13/§20); `test_db_invariants` 156/156.
- **`depo.multiEnabled` artık ANLIK DAMGA**: fabrika ikinci depo açınca yüzeyler eskisi gibi kendiliğinden BELİRMEZ — P5'e amber bant + Depolar ekranında ikinci aktif depo kaydında uyarı notu; anahtarı kimin açacağı kullanıcı-karar kuyruğunda.

**Bekçiler (her biri negatif sondalı, sonda tabloları dosya başlıklarında):** `test_module_flags` · `test_module_flag_off` (90; tek dosya, modül tablosuyla parametrik; STATİK ayak asıl güvence, HTTP ayağı ek — sunucu yoksa/giriş kilidiyse ATLANIR ve "N kontrol ölçülmedi" bandı basar; §1h 403'teki modül kodunu AST ile ölçer) · `test_module_grandfathering` · `test_{ticaret,iplik,depo_multi,production}_regime_gate` (ortak AST tarayıcı `scripts/lib/regime-gate-scan.ts`; üretim bekçisi model türetmesi DEĞİL pozitif ad listesi — üretimin "özel modeli" yok) · `test_feature_flag_contract` §15 + "her `REGIME_GATES` middleware'i ≥1 route'ta". Toplam **1036 kontrol yeşil**; 7 kör-nokta + 28 bozulma sondası kırmızı verdi. Commit'ler `c94035cc` (backend+bekçi) · `251767ca` (Electron) · `06e23448` (LoginPage typecheck onarımı). Adversarial turun beş **kör noktası** ve kapanışı: kapı YANLIŞ bayrağı okursa (§1c gövde penceresi 1600 karakterle sonraki fonksiyona taşıyordu; HTTP turu bayrakları hep birlikte oynatıyordu) → pencere sonraki `export`a kadar + iki yönlü çağrı kontrolü + "yalnız bu modül açık" tek-tek turu · 403'teki `modul` alanı doğrulanmıyordu → §4 `details.modul` · "cache" kelimesiz gerçek önbellek konabiliyordu → AST: dosya düzeyi `let`/mutable sabit/`Date.now` YASAK · migration'ın DEĞERLERİ ölçülmüyordu (ON CONFLICT yüzünden bir kez koşmuş DB'de bekçi kendi bozulmasını göremez) → SQL metninden VALUES ayrıştırma · `details.code` bir seviye sarılınca statik ayak kör → AST ikinci argüman doğrudan `code`. Ders: **"bekçi yeşil" ≠ "kapı doğru" — bekçinin ölçtüğü şeyi bozup kırmızıyı görmeden sayma; HTTP ayağı ÇALIŞAN sürecin kodunu ölçer, kaynak bozulunca yeşil kalır.**

**Süreç dersleri:** ① paralel doğrulayıcılar AYNI portu (4100) ve AYNI test DB'sini paylaştı → sahte kırmızılar; ajan başına port + "global durum yazan bekçi eşzamanlı koşmaz" notu. ② `Teks-Erp/.env` 31 Ağu'da izlemeden çıkarılmıştı ve diskte yoktu; peer git geçmişinden kurtardı (`tekserp_demo`yu gösterir) — env vermeden koşan her yazma-bekçisi kullanıcının dev DB'sine gider; `test_module_flag_off` hedef DB adını basar ve `tekserp` (fabrika prod adı) ise `BEKCI_PROD_ONAY=1` olmadan durur. ③ Dört mevcut bekçi route kaynağında `requireFinanceEnabled` METNİNİ arıyordu — kapı taşıma ile bekçi güncellemesi AYNI commit'te gitmek zorunda (`test_stock_count` 10h/10i · `test_item_price` §7b · `test_yarn_stock` 9a/9c · `test_warehouse_movements` §6c).

**AÇIK (sonraki paketler):** P2 süperadmin (`flagWriteGuard` üçüncü dal `MODULE_FLAG_KEYS.some`) · `SettingsRegimeKey`/`regime:` kategorileri DEĞİŞMEDİ — "Depo & Muhasebe" ayar bölümü hâlâ finance rejiminde (P5) · mobilde `MODULE_DISABLED`ın kullanıcı yüzü yok (`useVisibleScreens.conditional` boş; `announceFailure` dalı sonraki paket) · `/api/rolls` uç-bazlı kapı · fason/kartela anahtarları Dilim 1 dışı · 403 gerekçe metni dört yüzeyde finance→ticaret değişti (sürüm notuna: "İplik/Alış siparişi/Fiyat/Sayım ekranlarının kapalı olma SEBEBİ artık Ticaret modülü").
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-09-04__2026-09-04-profil-sistem-hub`: P2 Q5 'Modüller sekmesi fabrika adminine GÖRÜNÜR ama SALT-OKUNUR + bant' geçersiz: Genel Ayarlar → Modüller sekmesi KALDIRILDI; modül anahtarlarının tek evi Sistem → Modüller (`/system/module-profile`). Süperadmin hesabı doğmuşsa fabrika yöneticisi sayfayı hiç AÇAMAZ; hesap yoksa (supap) görür VE yazar.
> - KISMİ → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: P2'nin GİZLİLİK yarısı geri alındı: `visibleUserWhere`/`maskSystemActor`/`VISIBLE_*`/`SQL_ACTOR_*`/`blockSystemAccountTarget` ve 'Sistem Bakımı' takma adı silindi; hesap her yüzeyde gerçek adıyla görünür. YETKİ yarısı (`["*"]`, modül kilidi, supap, sır hijyeni) yürürlükte.
> - KISMİ → `A:2026-09-03__2026-09-03-superadmin-dogusu-p8`: Süperadmin doğuşunda `.env` tohumlama yolu kaldırıldı; tek yol `npm run superadmin:kur` (gerçek TTY zorunlu, fail-loud; idempotent; mevcut kullanıcı yükseltilmez). Boot job'ı hesap yaratmaz, yalnız kilit defterini tazeler + eski `SUPERADMIN_*` satırları için uyarı (yalnız anahtar adı).
> - KISMİ → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: P2'nin GİZLEME yarısı geri alındı: kullanıcı listesi/audit/karne/cihaz süzgeçleri (VISIBLE_*, visibleUserWhere, maskSystemActor, SQL_ACTOR_*), 'Sistem Bakımı' maskesi ve `/users/:id` 404 önek kapısı silindi; yerine yalnız `credentials` ucunda dar 403. Yetki yarısı (`["*"]`, modül kilidi, ayar şifresi muafiyeti) yürürlükte.
> - KISMİ → `R:2026-09-03__2026-09-03-superadmin-dogusu-p8`: Hesabın doğuşu `.env` tohumlaması (readSuperadminEnv, SUPERADMIN_FORCE_SYNC rotasyonu, Q2 'TOTP .env'den') kaldırıldı; tek yol `npm run superadmin:kur` (`--rotate`). Boot job hesap yaratmaz/rotasyonlamaz.
> - KISMİ → `KÖK CLAUDE.md:104 — 2026-09-04 'En yetkili hesap GÖRÜNÜR' (bundle dışı, kök dizin satırı)`: P2'nin GİZLİLİK kısmı geri alındı: VISIBLE_USER/visibleUserWhere/maskSystemActor/SQL_ACTOR_* ve /users/:id* üzerindeki blockSystemAccountTarget 404 kapısı SİLİNDİ; hesap liste/audit/tablet'te gerçek adıyla görünür. YETKİ kısmı (['*'], modül kilidi, supap, sır hijyeni) yürürlükte. Yerine: /users/:id/credentials üstünde dar 403 + protectSystemAccountTarget (GET serbest, yazma 403).
> - KISMİ → `R:2026-09-03__2026-09-03-superadmin-dogusu-p8`: Hesap DOĞUŞU değişti: .env tohumlaması (readSuperadminEnv, SUPERADMIN_USERNAME/PASSWORD_HASH/PIN/TOTP_SECRET, FORCE_SYNC rotasyonu) kaldırıldı; tek yol sunucuda interaktif `npm run superadmin:kur` (--rotate). Boot job hesap yaratmaz, kilit defterini tazeler ve kalan SUPERADMIN_* için yalnız anahtar adını basar.
>

### 2026-09-03 — Süperadmin P2: gizli GERÇEK satır, `["*"]` tam yetki, tek-kaynak gizleme süzgeci, kilitlenme supabı

> ⛔ **AYNI GÜN GEÇERSİZLEŞEN KISIM (2026-09-03 P8):** Bu notun HESAP DOĞUŞUNU
> anlatan her cümlesi (`.env` tohumlaması · `readSuperadminEnv` · `SUPERADMIN_USERNAME/
> PASSWORD_HASH/PIN/TOTP_SECRET` · `SUPERADMIN_FORCE_SYNC` rotasyonu · `.env.example`
> bölümü) **artık yürürlükte DEĞİLDİR** — kodun tamamı kaldırıldı. Hesabın tek doğuş ve
> rotasyon yolu sunucuda elle koşulan `npm run superadmin:kur` (`-- --rotate`); boot job'ı
> yalnız kilit defterini tazeler ve `.env`de KALMIŞ satırları silinsinler diye UYARIR
> (anahtar adı basılır, değer asla). Notun geri kalanı — gizli satır, `["*"]` bypass'ı,
> tek-kaynak süzgeç, takma adlı audit, emniyet supabı, sır hijyeni — AYNEN geçerlidir.
> TAM METİN: aşağıdaki **"Süperadmin doğuşu (P8)"** notu.

> ✅ **ÇEKİRDEK:** Satıcı hesabı, `["*"]` kod bypass'ı, tek-kaynak gizleme süzgeci (`isSystemAccount:false` + AST bekçisi), takma adlı audit, kilitlenme supabı (hesap YOKSA guard dalı devre dışı) ve **sır hijyeni** (parola/PIN/ayar şifresi repoya, log'a, audit diff'ine GİRMEZ) — kuruluma bağlı DEĞİL; her müşteride aynı. ⚠️ Kuruluma bağlı tek şey hesabın KURULMUŞ olması: hesap doğmadan kilit mutlak değildir (doğuş yolu 2026-09-03 P8'den beri `npm run superadmin:kur`; ~~`.env` tohumlaması~~ kaldırıldı) — bkz. MODUL-BAYRAK-TASARIM §7, §12 kural 7/8.

**Bağlam:** Tasarım §7 (satıcı hesabı) + §12 kural 7/8; plan P2. 5 Opus keşif boyutu planı doğruladı ve ÜÇ yeni boşluk buldu: ① mobil `usePermission.has()` global `*`'ı TANIMIYORDU (süperadmin PIN'le girer, "yetkin yok" ekranına düşerdi — plan "tablet OTA opsiyonel" demişti, YANLIŞTI; saf JS, OTA yeter, APK gerekmez) · ② backend'de üç `includes("admin:*")` kapısı (`tambur-undo` GERÇEK kapı — süperadmin "Tümden geri alma"da iş-kuralı reddi alırdı; import/demo gösterim) · ③ audit listesi süperadminin `id`sini basıyor ve `GET /admin/users/:id/credentials` o id'nin DÜZ PIN'ini kontrolsüz veriyordu — id sızıntısı → PIN sızıntısı zinciri. Gizlenecek yüzey 5 değil 12 (+2 rapor HAM SQL ile `users`a JOIN — Prisma helper'ı göremez), 8 nokta gerekçeli süzülmez. Fabrika ölçümü (2 Eyl dump'ının TAZE kopyası): 9 kullanıcı · 16241 audit satırı, **641'i `userId IS NULL` sistem olayı** — NULLABLE tuzağı gerçek (test DB'sindeki 64/1952 rakamı ajan artıklarıyla şişmişti, arşive girmez).

**Beş ürün kararı (peer/kullanıcı onaylı):** Q1 sistem hesabı DB'de YOKSA guard üçüncü dalı DEVRE DIŞI (admin:settings yeter) + audit `SUPERADMIN_ABSENT_MODULE_WRITE`; hesap doğunca kilit mutlak (emniyet supabı dersi; adnansahin `.env` kurulana dek süperadminsiz — sert kilit deploy anında fabrikayı kilitlerdi) · Q2 `SUPERADMIN_TOTP_SECRET` .env'den tohumlanır, yoksa LAN-only; **kurtarma kodu BİLİNÇLİ YOK** (cihaz kaybı iki yollu: LAN + FORCE_SYNC; az yüzey > konfor) · Q3 audit satırları takma adla GÖRÜNÜR (karar #8 tam iz), id uçları **404** (403 varlığı doğrular), username nötr (`.env.example` "bakim") · Q4 yedek/db-copy düz PIN riski kabul + ~~`SUPERADMIN_FORCE_SYNC=true`~~ rotasyon (⛔ P8: `npm run superadmin:kur -- --rotate`) (hash/PIN/TOTP aynı yaşam döngüsü, tokenVersion++; env'de TOTP yoksa TEMİZLER — "env tek gerçek") · Q5 Modüller sekmesi fabrika adminine GÖRÜNÜR ama SALT-OKUNUR + bant. Giriş kilidi süperadmini de kapsar (muafiyet = parolaya sınırsız deneme).

**Uygulama (backend ÖNCE; Electron + mobil OTA; APK YOK; izin kodu YOK; migration 1 additive):**
- `User.isSystemAccount Boolean @default(false)` (`20260903010000_user_is_system_account`; backfill YOK, index YOK). Kimlik JWT'ye GİRMEZ: `verifyToken`ın zaten yaptığı tazelik okumasına tek kolon → `req.isSystemAccount` (ek sorgu sıfır, eski token penceresi yok, guard senkron); `/auth/me` `isSystemAccount` + `systemAccountExists` döner (panel aynı kaynaktan). Sahte JWT (`isSystemAccount:true` / `permissions:["*"]` claim'i) → 403 (kimlik DB'den).
- Tam yetki: `getEffectivePermissions` İLK ifadesi `["*"]` (grant sorgusu koşmaz, `user_permissions` satırı DOĞMAZ — panel izin sayaçları sızdırmaz). Süperadmin ROL DEĞİL (şablon izinleri KOPYALAR; katalogda `code:"*"` yok → panelden atanamaz, bekçi ölçer).
- **Tek kaynak `helpers/system-account.helper.ts`**: `VISIBLE_USER` · `visibleUserWhere(extra)` (süzgeç SONDA spread — çağıran ezemez; fason helper'ının TERSİ) · `VISIBLE_ACTOR` (ilişki zorunlu) · `VISIBLE_ACTOR_OR_SYSTEM` (nullable — bugün kullanılmıyor, sözleşme olarak durur) · `ACTOR_SELECT` + `maskSystemActor` · `SQL_VISIBLE_USER` (`IS NOT TRUE` — `= false` LEFT JOIN'de 641 sistem olayını düşürürdü) · `SQL_ACTOR_USERNAME/FULLNAME` (`Prisma.raw` — `${}` bind parametresi GROUP BY'da `$1/$3` ayrışıp "must appear in GROUP BY" ile düşüyordu, ölçüldü). 12 yüzey süzüldü; 8 nokta gerekçeli muaf (login yolları, devralma/idle, username tekillik, son-admin kapıları, cihaz "son oturum" — süzgeç yalan üretir).
- **Audit takma adı satır düzeyinde**: liste/detay/arşiv satırları KALIR, aktör `{id, username:"sistem", fullName:"Sistem Bakımı"}`, `isSystemAccount` alanı yanıttan DÜŞER (ilk koşumda canlı sızıntı ölçüldü), AUTH satırlarında `recordId` (login adı) da maskelenir (D1/D2 aynı anda buldu: `"recordId":"bakim"` + `"username":"sistem"` yan yana). Aktör DROPDOWN'u süzülür. `?recordId=<ad>` filtresi ham DB'ye bakar — kabul (ad sır değil, parola/PIN sır).
- **id → PIN zinciri**: `router.use("/users/:id", verifyToken, requireAnyPermission("admin:users","admin:settings"), blockSystemAccountTarget)` ÖNEK kapısı — 18 uç (yarınki 19.su dahil) sistem hesabında **404** + `SYSTEM_ACCOUNT_ACCESS_BLOCKED` audit (method+path). ⚠️ Önek izni altındaki rotaların BİRLEŞİMİ olmalı — ilk yazım `admin:users` idi ve `/credentials` (`admin:settings`) ucunu `admin:settings`-only kullanıcıdan çalıyordu (D1 ölçtü; bekçi §M AST ile önek ⊇ alt rotalar). 404 gövdesi/zamanlaması rastgele id ile birebir (orakül yok, n=30).
- **Guard üçüncü dal EN ÖNDE ve `.some`** (belge dalı `.every` — yönler TERS; `{ticaretEnabled, backupHour}` karma gövde ilk dalda kesilir), hata `MODULE_FLAG_SUPERADMIN_ONLY` (K7'nin `MODULE_KEY_RESERVED`inden ayrı: "yanlış kişi" ≠ "yanlış uç"); senkron. **Supap** `SystemAccountRegistry`: bilinmiyor = VAR (fail-closed; boot penceresinde bypass açılmasın), job tazeler, supap dalında TEMBEL DB doğrulaması (boot sonrası/db-copy sonrası doğan hesabı restart'sız görür — yalnız o dal async). Registry ENV'den değil DB'den: `.env`den SUPERADMIN_* silinse de hesap durdukça kilit sürer (ölçüldü).
- **Job `jobs/superadmin.job.ts`** ⛔ *(bu maddenin TAMAMI 2026-09-03 P8 ile kaldırıldı — job artık hesap yaratmaz/rotasyonlamaz; tarihsel kayıt olarak duruyor)*: saf `readSuperadminEnv` (bcrypt biçimi + 6 hane PIN + base32 TOTP doğrulanır; `process.env` mutasyonu yok); üçlü yoksa SESSİZ (tek info), biri yok/bozuksa GÜRÜLTÜLÜ (`reportJobFailure` → kalıcı SystemLog + /health) ve hesap YARATILMAZ ("kimse giremeyen hesap" yerine görünür arıza); varsa DOKUNMAZ; P2002 yarışı (`users_username_key|username_lower_uq|quickPin_key`) create VE update'te; FORCE_SYNC'te ad uyuşmazlığı → ad DEĞİŞMEZ + uyarı + `usernameMismatch`. Audit yükünde hash/PIN/TOTP/username YOK (`fullName` + totp durumu). `.env.example` bölümü + `docs/ops/UZAK-ERISIM-KURULUM.md` adımı (kur.ps1 `.env`i TAŞIR, GÜNCELLEMEZ — unutulabilir adım sınıfı).
- `*` körlükleri: Electron `hasAdminAccess` → `matchesPermission` (Sistem hub'ı + komut paleti kırılıyordu); mobil `has()` ilk satır `if (set.has('*')) return true;` (OTA); `tambur-undo`/`import`/`demo` → `matchesPermission(p, X) || matchesPermission(p, "admin:*")` (mevcut `admin:*` kısayolu KORUNUR — 3 kullanıcı taşıyor, düz çevirme yetki düşürürdü). `src/`de `includes("admin:*")` metni artık HİÇ yok — bekçi koşulsuz yasaklar.
- Electron: `SettingsCategory.superadminOnly` (regime GİZLER, bu KİLİTLER); `FeatureFlagSection.canEdit = hasPermission("admin:settings") && (!superadminOnly || isSystemAccount || !systemAccountExists)` — izin ∧ kimlik çarpımı; bant metni. `/auth/me` bilinmiyor durumunda `systemAccountExists:true` (panel de kilitli — kapıyla ayrışmaz).
- `SECRET_FIELDS`e `totpSecret`, `settingsPasswordHash` (P3), `superadminPin`; başlığa "maskeleme YALNIZ `changes`e uygulanır — oldData/newData/payload HAM yazılır, çağıranın yükü temiz olmak ZORUNDA". Sır grep'i TAM bcrypt gövdesi (53 karakter) ile yapılır — job'un hata metni `$2b$10$…` biçim ipucunu kalıcı log'a yazar, ön ek araması yanlış pozitif verir.

**Sıfır fark (Adnan):** taze dump'ta `isSystemAccount` 9/9 false, sistem hesabı 0; 71 mount hesapsız/hesaplı BİREBİR (37×200 · 21×404 · 13×403; MODULE_DISABLED yine 6); supap: hesapsız kurulumda fabrika admini modül anahtarını BUGÜNKÜ gibi yazar (200 + audit izi); `admin:*` taşıyan 3 kullanıcıda `hasAdminAccess` sonucu aynı. Dump provası: 230 migration, 2. deploy "No pending", `test_consistency` aynı 4 bilinen bölüm, `test_db_invariants` 157 (yeni §10 "sistem hesabı ≤ 1"); boş DB → job env'siz `absent`/geçersiz hash `invalid` (hesap yok, gürültülü)/geçerli `created`/2. koşum `exists`/FORCE_SYNC `synced` (tokenVersion 1→2).

**Bekçiler:** `test_superadmin` (§A–§M: guard 7 anahtar × 4 senaryo döngüsü, karma gövde, senkronluk + dal sırası, supap 4 durum, `["*"]` + grant 0, katalogda `*` yok, saf env okuyucusu, sır hijyeni AST, 404 zinciri, `/auth/me`, HTTP turu, aktör maskesi, önek izin birleşimi) · `test_superadmin_hidden_single_source` (Prisma/ilişki/ham-SQL/`includes("admin:*")`/allowlist/maske AST kolları) · `test_db_invariants §10` · `test_audit_depth` isimleri · Electron `auth.test` + `FeatureFlagSection` · mobil `usePermission.test`. Adversarial tur (Opus + **Fable** güvenlik kapısı): 20+ sonda; guard sağlam (`.some→.every` 4❌ · dal sırası 1❌ · async 39❌ · registry sahte açık 29❌ · JWT claim'den okuma 1❌ · sahte JWT 403/401 · Zod'a `isSystemAccount` sızdırma DB'de false); **üç kör nokta kapandı**: aktör maskesi bekçisiz (liste/detay maskesi silinince 99/0 yeşildi) · "hesap VAR + env YOK → kilit" ölçülmüyordu · `recordId` maskesi. Ders: **"maske aktör nesnesinde" yetmez — aynı satırın başka bir alanı kimliği geri verir; maske SATIR düzeyinde ve bekçi yanıt GÖVDESİNDE gerçek adı arar.**

**Süreç dersleri:** ① `pkill -f "tsx src/server.ts"` kullanıcının :4000 dev sunucusunu düşürdü (iki ajan, iki tur) → tasarım §12-12 kalıcı kural: yalnız kendi PID'in, paralel ajanlara ayrı port; ② spec'e yazılan ölçüm rakamı hangi DB'de ölçüldüğünü söylemeli (test DB artıklarıyla şişmiş sayı arşive girmesin); ③ "Sistem Bakımı" takma adı + süperadminin KENDİ oturumunda Topbar gerçek username'i gösterir (kendi yüzeyi, fabrika yüzeyi değil — bilinçli).

**AÇIK:** P5 Sistem Profili'nde "giriş yöntemlerinde PIN kapalıysa satıcı tablete giremez" bandı; audit dropdown `dropdownCache` + istemci `staleTime` üst üste (deploy sonrası ≤5 dk gecikmeli sızıntı, kabul); P3 ayar şifresi `SECRET_FIELDS`e önden kondu.
**Commit'ler:** `bfddd846` (backend + migration + bekçiler) · `745bf3eb` (Electron + mobil) · docs commit'i. Düzeltme turundan sonra son üç bulgu ana oturumda kapatıldı: `/auth/me` de tembel doğrulama yapar (`resolveSystemAccountLock` — guard ile ORTAK yüklem; hesapsız açılan sunucuda bekçi 137/1 → 138/0), statik §7 dört okuma yolunda elle `maskSystemActor(` yasağı (V sondası X3 `findArchiveById`de iki bekçiyi kör bırakıyordu), defter TEK YÖNDE tazelenir (kaldırma reçetesi restart ister). D1'in "önek kapısı regresyon" teşhisi ÖLÇÜLEREK ÇÜRÜTÜLDÜ (`/credentials` main'de de iki izin istiyordu) — düzeltme yine yapıldı ama gerekçesi "önek alt rotadan dar olamaz" invariantı; ölçüm tablosundaki sayı DB durumuna bağlıdır, kalıcı olan "hangi kontrol kırmızı olur" cümlesidir (bekçi başlığı iki taban yazar). Dev DB `tekserp_demo` 230 migration'a çıkarıldı (damga demo senaryosunu üretti: finance açık → ticaret/iplik açık, 2 depo → çoklu depo açık; sistem hesabı yok → supap açık).
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: Ayar şifresi yönetim uçları süperadmin dışı kimlikte 404 yerine 403 döner ('403 varlığı doğrular' gerekçesi, varlık açılınca düştü); fonksiyon adı `requireSystemAccountOr404` bayat kaldı.
> - KISMİ → `R:2026-09-04__2026-09-04-en-yetkili-hesap`: Ayar şifresi yönetim uçları (`PUT/DELETE /admin/settings-password`) süperadmin dışına 404 değil 403 döner; fonksiyon adı `requireSystemAccountOr404` bayat kaldı.
> - KISMİ → `KÖK CLAUDE.md:104 — 2026-09-04 'En yetkili hesap GÖRÜNÜR'`: Ayar şifresi yönetim uçları (GET/PUT/DELETE /admin/settings-password) süperadmin dışına artık 404 DEĞİL 403 döner. Middleware'in ADI hâlâ requireSystemAccountOr404 ama gövdesi AppError.forbidden — ada bakan yanılır.
>

### 2026-09-03 — Ayar şifresi P3: ikinci kapı BAŞLIKTA, hash `set()` dışında, kilit kovası girişten AYRI, kapsam "ayar yazan HER route"

**Bağlam:** Tasarım §7.2 ("davranış bayrağı ekranı her değişiklikte ikinci şifre sorar — açık kalmış admin oturumu"); gece kararları P3-1…P3-6 (`GECE-KARARLARI-2026-09-03.md`). Spec Fable, kod Opus, güvenlik doğrulaması Fable.

**Ne yapıldı (migration/izin/APK YOK; Adnan sıfır fark — hash satırı yokken hiçbir istek şifre istemez):**
- Hash `SystemSetting["security.settingsPasswordHash"]` (bcrypt 10) ama `systemSettingService.set()` ÜZERİNDEN DEĞİL — doğrudan upsert + ayrı audit (`SETTINGS_PASSWORD_SET/ROTATED/REVOKED {by}`); `security.*` ön eki `GET /admin/settings` listesinden ve `config-bundle`dan dışlanır (ön ek bazlı — yarınki ikinci sır da korunur); `PUT /admin/settings/:key` reserved anahtarı 400 (`constants/reserved-settings.ts` — module-flags gibi düz string, dairesel import → `undefined` Set tuzağı). `settingsPasswordRequired` `FeatureFlags` İÇİNE KONMADI (30 sn önbellek + dört kapıdan yazılabilir olurdu) — `GET /feature-flags` ve `/auth/me` yanıtına eklendi.
- Şifre YALNIZ `X-Settings-Password` başlığında (gövde strictObject; gövde alanı audit `changes`ine sızar; query erişim loguna düşer — ölçüldü). `requireSettingsPassword` (adlandırılmış, ASYNC, `flagWriteGuard`'dan SONRA — senkron guard sözleşmesi bozulmaz): ① süperadmin muaf ② belge-only gövde muaf (`document-template:write` büro personeli) ③ hash yok → uyur ④ kilit `bcrypt.compare`'den ÖNCE → 429 `SETTINGS_PASSWORD_LOCKED` ⑤ başlık yok → 403 `REQUIRED` (audit YOK) ⑥ yanlış → 403 `INVALID` + audit ⑦ doğru → audit `USED {userId, keys, path}`. Yönetim ucu `PUT/DELETE /admin/settings-password` yalnız süperadmin, aksi **404** (`requireSystemAccountOr404`, verifyToken'dan SONRA — kimliksiz 401).
- ⚠️ **Spec'imdeki gerçek hata ölçülerek düzeltildi:** "kilit kimliği `sp:<userId>`" reçetesi `resolveLoginLockoutKeys`in VARSAYILAN kapsamında (`LOGIN_LOCKOUT_SCOPE` yok → `ip`) kimliği DÜŞÜRÜYOR ve ayar şifresi denemeleri o IP'nin GİRİŞ kovasına yazılıyordu: 5 yanlış ayar şifresi → aynı IP'den `POST /auth/login` 429 (bir yönetici herkesi dışarıda bırakırdı). Ayrım artık anahtarın KENDİSİNDE (`resolveSettingsLockoutKeys` → her kovanın key'ine `sp:` ön eki); iki rejimde de ayrı kovalar (ölçüldü: ayar 429 iken login 200).
- **D2 (Fable) bulguları — düzeltme turunda kapatıldı:** ① `PATCH /admin/backups/offsite` + `POST /backups/offsite/authorize` ayar yazıyordu ama kapıda değildi (açık oturum yedek hedefini şifresiz değiştirebilirdi — tam pg_dump saldırgan rclone'a giderdi) → kapı + bekçi tripwire: `src/routes/**`te `systemSettingService.set(`/`setFeatureFlags(` çağıran HER route zincirinde `requireSettingsPassword` (iki yönlü muaf); "üç yüzey" sayısı elle sayılmaz. ② Şifre yalnız uzunluk denetleniyordu; Türkçe karakter/boşluk HTTP başlığında taşınamaz (fetch ByteString TypeError, curl UTF-8 → INVALID, OWS kırpması) → fabrika rotasyona kadar ÜÇ yüzeyden kilitli kalırdı → `^[\x21-\x7E]+$` + 8–**72** (bcrypt 72 bayt sessiz kırpma: 100 karakterlik şifrenin son 28'i sayılmıyordu). ③ Bekçi query-string fallback'ine KÖRDÜ ve USED audit'i `req.originalUrl` (query dahil) yazıyordu → `req.path` + §C davranış kontrolleri (gövde/query/cookie/benzer başlık → 403). ④ Kilitliyken her 429 bir LOCKED audit satırı (60 istek → +60; login kilidi yazmıyordu) → `justLocked` (kilit anında tek satır) — login yolu da hizalandı. ⑤ 429'da `Retry-After` başlığı yoktu → error middleware tek noktadan. ⑥ (P2 eki) oturum jti'si kullanıcıya bağlı değildi — JWT_SECRET bilinirse başka oturumun jti'siyle süperadmin kimliği üretilebiliyordu → `session.userId !== payload.userId` → 401.
- Electron: `withSettingsPassword` sarmalayıcısı (istek önce şifresiz gider; 403 REQUIRED/INVALID → `SettingsPasswordDialog` (App'te bir kez mount) → başlıkla tekrar; iptal → hata; LOCKED → kalan süre); `featureFlagService.update`/`setDocumentsLogo`/admin settings/backup offsite hepsi sarmalayıcıdan; Kaydet yanında kilit ikonu; süperadmin "Ayar şifresi" kartı (Tanımla/Değiştir/Kaldır; ASCII+72 anlık uyarı). Her kayıtta sorulur, oturumda hatırlanmaz.
- `test_document_template_permission` harness'ı `requireSettingsPassword` halkasını ADIYLA atlar (yetki değil NİYET kapısı; asenkron) — kapının kendi bekçisi ayrı.

**Bekçiler:** `test_settings_password` (§A–§L; HTTP ayağı sunucusuz "N kontrol ölçülmedi" bandı) + D2/düzeltme sondaları; adversarial ölçümler: zamanlama orakülü YOK (yanlış 8/72/128 kr ve doğru-ön-ekli hepsi ~59.6 ms, n=30), sahte JWT claim'leri yok sayılır, kilit XFF/CF-Connecting-IP/X-Real-IP uydurmayla atlatılamaz, `system_logs`+arşiv+erişim logu+yanıt gövdeleri+config-bundle'da şifre/hash 0.

**Ders:** "kilit anahtarı = `sp:<userId>`" gibi bir reçete, kilit yardımcısının KAPSAM rejimini bilmeden yazılırsa iki kapı aynı kovaya düşer — anahtar ayrımı kimlikte değil KEY'de yaşamalı. Sır taşıyan başlık için karakter kümesi ŞEMADA sınırlanmalı (RFC 7230 field-value); "her yerde Unicode serbest" refleksi burada kilitlenme üretir. "Üç yazma yüzeyi" gibi elle sayılmış listeler tripwire olmadan bir sonraki yüzeyde delinir.

**Düzeltme turu (aynı gün, D2 + V bulguları):** offsite kapısı + **AST tripwire** (kapsam elle sayılmaz: `src/routes/**` — ÖZYİNELİ, alt dizin zemini; dolaylı yazıcılar ayrı karar kaydı) · şifre `^[\x21-\x7E]+$` + 8–**72** (bcrypt 72 BAYT; `.trim()` yerine RED; servis katmanında ikinci hat) + backend↔Electron **ayna bekçisi** · USED audit yolu **`${req.baseUrl}${req.path}`** — salt `req.path` mount'a görelidir ve `PATCH /api/feature-flags` için `"/"` üretir (sızıntıyı kapatırken denetimin "hangi uçta" cevabı kaybolmuştu; harness artık Express mount'unu modelliyor) · LOCKED audit kilit **başına tek satır** (`justLocked`; login yolu da hizalandı, `LOGIN_LOCKED` artık yazılıyor) · `Retry-After` tek noktadan · oturum **jti ↔ userId** bağı (401 `SESSION_INVALID`, aynı kod/mesaj — orakül yok). Commit: `9f33d0e3` (WIP) + `f948780f` (düzeltme). Bekçi tabanı 134/0/13 (sunucusuz), 140/0 (HTTP'li).

**Ek dersler:** ① "üç yazma yüzeyi" gibi ELLE sayılmış kapsam listeleri bir sonraki yüzeyde delinir — kapsamın yüklemi ekran değil YAZMA'dır ve tripwire ile ölçülür; ② sızıntı kapatan düzeltme kimliği de götürebilir (`originalUrl` → `path` query'yi kesti ama yolu da sildi) — bekçi "ne YAZILMAMALI" kadar "ne YAZILMALI"yı da ölçmeli; ③ iki taraflı sabit (backend↔panel) ayna bekçisi olmadan sessizce ayrışır; ④ bekçi harness'ı çerçevenin semantiğini (Express mount göreliliği) modellemezse gerçek regresyonu göremez.

### 2026-09-03 — Kalite = istasyon YETENEĞİ (P4 Faz A): boğaz TEK DEĞİL İKİZ

**Bağlam:** Tasarım §5.1 + karar #11. "Bu adım kalite kontrol yürütür mü" sorusuna eskiden `step.station.kind === StationKind.PROCESS_QC` diye cevap veriliyordu ve literal 19 karar noktasına ELLE kopyalanmıştı — yani kalite bir YETENEK değil bir TÜR ADIydı: ikinci bir KK istasyonu tanımlamak imkânsızdı, bir kopyanın atlanması sessiz davranış farkı üretirdi.

**Ne yapıldı (davranış BİREBİR; fabrika dump'ında 23 uçta 0 statü kodu farkı, migration UPDATE 1 satır):**
- `Station.appliesQuality` kolonu + backfill (`WHERE kind='PROCESS_QC'`). Yeni tek kaynak `services/helpers/quality-station.helper.ts`.
- ⚠️ **BOĞAZ İKİZ:** saf yüklem `stepCanApplyQuality(station)` (bellek içi 11 nokta) + Prisma where parçası `QUALITY_STATION_WHERE` (13 nokta). Saf yüklem where'e GİREMEZ — sorgu DB'de koşuyor; özellikle `setQueueUrgent`in F167 atomik claim'ini "önce oku, sonra yüklemle kontrol et, sonra update" biçimine çevirmek check-then-act yarışını geri getirirdi. İkisi AYNI kuralı söyler ve BİRLİKTE değişir.
- **Faz A köprüsü:** yüklem `kind === PROCESS_QC || appliesQuality` okur — backfill'e GÜVENMEZ. Seed migration'dan SONRA boş tabloda koşar (2026-08-10 `appliesColor` tuzağının birebir tekrarı olurdu), o yüzden seed'e de açıkça `appliesQuality: true` yazıldı; dal onun İKİNCİ sigortası. Faz B'de dal düşmeden önce seed + prod ölçümü yapılır.
- `assertRollInStep(_, _, expectedKind)` → `assertRollInQualityStep` (argüman düştü); `hasBypassClosureOnProcessQcTx` → `hasBypassClosureOnQualityStepTx` (ad ↔ yüklem ayrışmasın). Kurşun bypass'ta makine LİSTESİ ile atama KABULÜ artık aynı ikizden besleniyor — ayrışsalardı listede görünen makine seçilince 400 alınır, dağıtımcı sebebi anlayamazdı.
- ⚠️ `assertWoAtStepKind(PROCESS_QC)` (kursun-qc) **DOKUNULMADI**: `roll-step.helper` TAMBUR ile PAYLAŞILIYOR, imzasını yetenekleştirmek Tambur kart-okutma yolunu da değiştirirdi. Bekçide gerekçeli muaf, Faz B'ye bırakıldı.
- `QUALITY_STATION_WHERE` `as const` DEĞİL `satisfies` ile yazılır (readonly literal `OR:` konumunda Prisma'nın mutable input tipine oturmaz — `fason-open-dispatch.helper` dersi); spread ile kullanılır ve aynı kapsamda ikinci bir `OR:` YAZILMAZ (biri sessizce kaybolur).
- Panel: "Kalite kontrol uygular" kutusu HER istasyon türünde görünür (gizli kural icat edilmez; yüklem KK1'de zaten etkisiz). ÖNCE `buildStationPayload` drift'i onarıldı — mevcut renk/özellik kutuları payload'a hiç girmiyordu, yani ÖLÜYDÜ.
- "KK1 WO adımı olamaz" kuralı **istemci sözleşmesi** olarak kaldı: backend `allowAsWorkOrderStep`ı HİÇ okumuyor (ölçüldü: 0 okuyucu), guard eklemek davranış değişikliği olurdu.

**Bekçi `test_station_quality_capability` (22):** ikizin CANLI eşdeğerliği dört köşe fixture'ıyla (where sonucu ≡ yüklem sonucu), koddaki `PROCESS_QC` literalleri SAYIM bazlı muafla, `STEP_QUALITY_SELECT` kullanımına TABAN SAYIM. Beş negatif sonda kırmızı verdi.

**Ders (bekçinin kendi kör noktası):** ilk yazımda İKİ kontrol de DOSYA bazlıydı ve sondalar bunu ölçtü — ① muaf dosya bazında olunca o dosyaya eklenen YENİ tür kontrolü sessizce kapsanıyordu; ② "dosyada `STEP_QUALITY_SELECT` geçiyor mu" kontrolü aynı dosyadaki İKİNCİ select'in alanı atlamasını gizliyordu. İkisi de sayım bazlıya çevrildi. Ayrıca "kind seçen her select yüklem içindir" varsayımı ölçümle çürüdü: `currentStepKind` gibi GÖRÜNTÜLEME select'leri de `kind` okur.

### 2026-09-03 — Tamlık bekçisi + kurulum profilleri (P6): profil dosyası pakete HİÇ GİRMİYORDU

**Bağlam:** Tasarım §3 ("her ekran bir modüle ya da çekirdek bloğa eşlenmek ZORUNDA") + §10 profiller.

- `ScreenEntry.modul` **ZORUNLU** alan; 93 ekranın (78 masaüstü + 15 tablet) tamamı eşlendi. Değer kümesi üçlü: `ModulKey` (7 anahtar, bekçi `MODULE_FLAG_KEYS` ile birebirler) · `cekirdek:*` (5 blok, ön ek ZORUNLU ki bir yazım hatasıyla modül adı karışmasın) · `planlanan:fason|kartela` (tasarımda var, kod anahtarı yok → hiza aranmaz ama ölü de sayılmaz). Alan **AİDİYET beyanıdır, GÖRÜNÜRLÜK kuralı değil** — gizleme `visibleWhen`in işi.
- ⚠️ Plandaki `MODULESIZ_EKRANLAR` muafı YAZILMADI: alan zorunlu olunca o liste doğduğu gün ölü olurdu ve "ölü muaf kırmızı" kuralı kendi listesine takılırdı. Muaflar KARO/KAPI eksenine taşındı.
- ⚠️ **Profiller TS sabiti** (`constants/module-profiles.ts`), plandaki `deploy/profiller/*.json` REDDEDİLDİ: `deploy/paketle.ps1` kopya listesi `deploy/`yi pakete HİÇ almıyor (ölçüldü) → job üretimde dosyayı bulamaz ve sessiz no-op'a düşerdi; taze müşteri kurulumu profilsiz doğar, kimse fark etmezdi.
- **Davranış bayrakları profile GİRMEZ:** `prisma/seed.ts` 27 davranış bayrağını `upsert.update` ile EZEREK yazıyor; profil de yazsaydı aynı anahtarın iki yazarı olur ve kazananı koşum sırası belirlerdi.
- Job: `TEKSERP_PROFIL` env'i YOKSA **hiçbir şey yazmaz** (varsayılan profil yazmak, operatör env'i doldurmadan sunucuyu bir kez açtığında yanlış profili KALICI damgalardı — "satır varsa dokunma" ile birleşince geri dönüşü olmazdı). Eksikler tek `createMany skipDuplicates` ifadesiyle (yarış güvenli). Bağımlılık doğrulaması SAF yüklemle: `assertModuleDependencies` private ve DB okuyor, `setFeatureFlags` de `userId` istiyor — job ikisini de çağıramaz, o yüzden üç koruma (bağımlılık · audit · K7 reddi) job'da YENİDEN kuruldu.
- `GET /api/admin/module-profile` salt okuma; fark SUNUCUDA hesaplanır (profil kaynağı istemciye sızmaz). YAZMA UCU YOK — profil uygulama mevcut `PATCH /feature-flags` kapısından geçer, yoksa süperadmin guard'ı + ayar şifresi zinciri ikinci kez kurulurdu (§12.5 kapı çoğaltma yasağı).
> ⚠️ **GEÇERSİZ/KISMEN (anlama turu 2026-09-05)** — bu notun bazı kuralları sonraki kararlarla ezildi; güncel kural için `docs/kurallar/`:
> - KISMİ → `kök CLAUDE.md:103 — 2026-09-04 'Kapalı modülün bayrağı ÇİZİLMEZ' (küme dışı not)`: P5'in 'modül = KİLİT, gizleme DEĞİL' kuralının GİZLEME yarısı geri alındı: Özellik Anahtarları ekranında kapalı modülün SATIRI çizilmez, kategoriden satır kalmazsa sekme de düşer. Kilit bandı (`moduleKey`/`superadminOnly` ikizi, istemci-taraflı) DURUYOR — ezilen yalnız 'gizlemez' cümlesi.
> - KISMİ → `R:2026-09-04__2026-09-04-cekirdek-kapali-modulun`: P5'in 'ayar kategorisinde modül = KİLİT, gizleme DEĞİL' kararı tersine döndü: kapalı modülün bayrak satırı fabrika yöneticisine HİÇ çizilmez (satır bazlı `filterCategoryByModules`), kategoriden satır kalmazsa sekme düşer; kilit bandı yalnız satıcı görünümünde kalır. Gerekçe: modül anahtarları aynı gün kendi ekranına taşındı, geri dönüş yolu orada.
> - KISMİ → `R:2026-09-04__2026-09-04-profil-sistem-hub`: 2026-09-03'ün iki yüklemli satıcı kapısı (yazma supaplı `isSuperadminGateOpen`, görünürlük supapsız `isSystemAccountIdentity`) TEK supaplı yükleme indi; `isSystemAccountIdentity` silindi. 'Sistem Profili' adı 'Modüller' oldu, route path değişmedi.
> - KISMİ → `R:2026-09-04__2026-09-04-cekirdek-kapali-modulun (küme: modul-bayraklari-profiller)`: P5 'modül = KİLİT, gizleme DEĞİL' kısmen ters çevrildi: fabrika görünümünde kapalı modülün satırları HİÇ çizilmez (satırdan türer, `isCategoryModuleVisible`); kilit bandı KALDI, izleyicisi satıcı (supap dahil).
>

### 2026-09-03 — Panel modül kapıları + Sistem Profili (P5): kilit GİZLEME DEĞİLDİR

**Bağlam:** Tasarım §3.3 · §3.5 · §7.3.

- **İki CANLI ayrışma** kapandı (fabrikada görünmüyordu, ilk ticaret müşterisinde patlardı): Mal Kabul karosu çiziliyordu ama uç `requireTicaretEnabled` 403 veriyordu; Kalem Fiyatları karosu `financeEnabled` okuyordu ama uç ticaret kapısındaydı (yön TERS).
- ⚠️ **Ayar kategorilerinde modül = KİLİT, `regime` (gizleme) DEĞİL.** `regime`i modül anahtarlarına açmak §14'ün yasakladığı yol: ölçüldü, üretim/ticaret kategorilerine `regime` konsaydı dört+ okuyucu çekirdek route'lardan hâlâ ulaşılabilir olduğu için bekçi kırmızı verirdi. Yeni `moduleKey` alanı `superadminOnly` deseninin ikizi (o da KİLİTLER). `warehouse` kategorisi ikiye bölündü (ticaret / iplik) çünkü tek kategori iki modül taşıyordu.
- ⚠️ **Kilit İSTEMCİ-TARAFLIDIR:** bant "bu ayarlar dondu" der ama API hâlâ yazar (canlı ölçüldü). Tasarım §3.6 tek resolver bu pakette UYGULANMADI ve bant "etkisiz" DEMİYOR — sözün karşılığı yoksa yazılmaz. §3.6 Dilim 2'de.
- `finance` kategorisinin mevcut GİZLEME davranışı KORUNDU (Adnan'da finance kapalı → kategori bugün gizli; kilide çevirmek görünür fark olurdu). Tasarım §3.5 ile bu tutarsızlık sabah kararına bırakıldı.
- **Süperadmin kapısı TEK KAYNAK** `lib/superadmin-gate.ts` — dört tüketici de ithal ediyor. Üç kopya ayrışsaydı `!systemAccountExists` supabı birinde unutulur ve süperadminsiz kurulumda ekran hiç açılmaz, modüller bir daha yapılandırılamazdı.
- **Palet sızıntıları:** karo döngüsünün DIŞINDA kalan girdiler (`ops:work-order-new`, `def:station-capabilities`) üretim kapalıyken palette kalıyordu — form açılır, her istek 403. İkincisinin karosu hiç yok, yani palet ona giden TEK keşif yolu ve kapıyı ELLE taşımak zorunda. Karo hizası bekçisi bu yolu ölçemez (karo↔manifesto ekseninde çalışır).
- **"Kapatırsan gizlenir" önizlemesi MASAÜSTÜ ile TABLETİ AYRI sayar:** eskisi `app === "desktop"` süzüyordu ve üretim için "gizlenen ekranlar (9)" yazıp beş TABLET ekranını (KK1 · Kurşun · Tambur · Hızlı İş Emri · Kurşun Dağıtım) hiç anmıyordu — oysa hepsi `requireProductionEnabled` arkasında. Satıcı, üretimi kapatınca tabletin DURACAĞINI bu ekrandan öğrenemiyordu. Kapatma kararının bedeli farklı olduğu için sayılar ayrı tutulur.
- Manifesto okunamazsa liste HİÇ çizilmez (boş liste "hiçbir şey gizlenmeyecek" YALANI basardı).


### 2026-09-03 — Süperadmin doğuşu (P8): `.env` yolu kaldırıldı; script gerçek TTY olmadan SESSİZCE donuyordu

**Bağlam:** Tasarım §7.1 · P2 (satıcı hesabı) kapanışı. Kullanıcı kararı (peer üzerinden): "`.env` yolu KALDIRILIYOR — tek doğuş yolu script; iki yol daha fazla yüzey demek."

**Karar ve gerekçesi.** Satıcı hesabının tek doğuş ve rotasyon yolu artık sunucuda elle koşulan `npm run superadmin:kur` (`-- --rotate`). `.env` yolunda parola hash'i, PIN ve TOTP sırrı **diskte kalıcı** duruyordu: yedeğe giriyor, `kur.ps1` onu bir sonraki kuruluma taşıyor, ekran paylaşımında görünüyor ve üstelik "FORCE_SYNC satırını sonra kaldırın" gibi unutulabilir bir adım gerektiriyordu. Script'te sır yalnız süreç belleğinde yaşar ve terminale **bir kez** basılır. Kaldırma **sıfır fark**: sahadaki kurulumda `SUPERADMIN_*` satırları zaten yoktu (boot log'u "tanımlı değil" basıyordu).

- **Katmanlar AYRI, çünkü bekçi TTY sondası yazamaz:** saf `provisionSuperadmin(input, deps)` hiçbir şey **yazdırmaz** (bekçi onu doğrudan çağırır ve stdout'un boş olduğunu ölçer — bir `console.log` sızsaydı sır ekrana iki kez basılırdı); sırlar yalnız **dönüş değerinde** yaşar, dosyaya/log'a/audit yüküne geçmez.
- **İDEMPOTENT** (hesap varsa dokunmaz, çıkış 0): yoksa "bir daha çalıştırayım" refleksi satıcının elindeki parolayı öldürürdü. **MEVCUT KULLANICI YÜKSELTİLMEZ**: audit maskesi **satır düzeyindedir**, yükseltme fabrikanın kendi geçmişini bir anda "Sistem Bakımı" adına geçirirdi. Ad kontrolü büyük/küçük harf **duyarsız** — DB'de şema-dışı `users_username_lower_uq` var, düz eşitlik "BAKIM"ı geçirir ve INSERT ham P2002 ile düşerdi.
- **Boot job'ı artık hesap YARATMAZ.** Kalan iki işi: ① kilit defterini (`SystemAccountRegistry`) tazelemek — silinirse supap her boot'ta açık kalır ve **hiçbir test kırılmaz**; ② yaşam döngüsü audit'i. ⚠️ Audit çağrısı bilerek `src/` altında: `test_audit_labels` §3 yalnız `src/` ağacını tarayıp `logEvent({ action: "LİTERAL" })` literallerini toplar; çağrı `scripts/` altında kalsaydı iki olay da bekçinin **kör noktasında** doğar ve audit ekranında ham İngilizce basardı.

**C1 (MAJOR) — script gerçek TTY olmadan SESSİZCE sonsuza kadar kilitleniyordu.** `readline` TTY olmayan girdide ilk `question()`dan sonra stream'i tüketip `end`e düşüyor; sonraki soru **hiç cevaplanmıyor**, hata yok, zaman aşımı yok, süreç ve Prisma havuzu açık kalıyor. Ölçüm: boru üzerinden 120 sn donma, DB'ye tek satır yazılmadı, süreç ölmedi. Isırdığı yerler: `ssh sunucu 'npm run superadmin:kur'` (`-t` yok), `docker exec` (`-it` yok), pm2, CI. Hesabın **tek** doğuş yolu bu script olduğu için kurulum sessizce hesapsız kalıyor ve kimse fark etmiyordu.

- Düzeltme: `interaktif()`in ilk işi **fail-loud TTY kapısı** — çözümü de söyleyen hata (`ssh -t` / `docker exec -it` / sunucu konsolu), çıkış kodu 1. **`--help` kapının önünde**: yardım metni boruya basılabilmeli ve hiçbir soru sormadığı için donma riski taşımaz.
- Kapı, parola maskesini de **anlamlı kılan** şeydir: `sorGizli` artık maskeyi koşulsuz uygular ve readline `terminal: true` ile kurulur. Kaldırılan yanıltıcı yorum ("TTY yoksa maskelemenin anlamı yok — gizlenecek ekran yok") tam da desteklenmeyen yolu **destekleniyormuş gibi** anlatıyordu.
- Reçete uyarısı `KURULUM.md` A3b + `UZAK-ERISIM-KURULUM.md` §5'e girdi (`-t` unutulursa artık gürültülü hata; kurulum betiği/pm2/CI içinden çağırmayın).
- Bekçi `test_superadmin_provision` §7: çocuk süreç boru stdin'le koşulur, çıkış **25 sn zaman aşımıyla** beklenir. ⚠️ Sonda bilerek zaman aşımlıdır — asıl risk donmadır, hata değil; kapı düşerse bekçi de donsaydı kırmızı yerine **asılı bir koşum** olurdu. Ayrıca `--help`in boruda çalıştığı ölçülür (kapının yeri).

**C2 — `.env`de kalan `SUPERADMIN_*` satırları ölü ama CANLI SIR.** P2 yolunu kullanmış bir kurulumda o satırlar hâlâ çalışan bir parola hash'i, PIN ve TOTP sırrı taşır; sessizce yok saymak kurulumcuya **sırrın da kalktığını** düşündürürdü — kalkmadı, yalnız etkisizleşti. Boot'ta tek dallı uyarı basılır ve **yalnız anahtar adı**; değer asla (pm2 log'u fabrika sunucusunda okunabilir).
- ⚠️ Uygulama kısıtı: job dosyası **tam anahtar adı literali taşıyamaz** ve değeri alan adıyla okuyamaz — `test_superadmin_provision` §6 tam bu iki deseni arayarak `.env` yolunun geri gelmediğini ölçer. Bu yüzden tarama `Object.keys(process.env)` + ön ek ile yapılır. (İlk yazımda gerekçe yorumunun **kendisi** yasak literalleri içeriyordu ve bekçiyi kırdı — yorum da taranan metindir.)
- Bekçi §8: sentinel değerli gerçek bir ortam değişkeniyle uyarı üretilir; anahtar adının basıldığı **ve** değerin basılmadığı ölçülür. Körlük zemini: ortam temizken uyarı **yok** (her boot'ta bağıran uyarı görmezden gelinir hale gelir).

**C3 — bayat belge atıfları (ölü mekanizmayı yürürlükte anlatan beş yüzey).** Kök `CLAUDE.md` P2 satırı (`.env` tohumlaması + `FORCE_SYNC` rotasyonu) · tasarım §7.1 (kurtarma yollarından biri `SUPERADMIN_FORCE_SYNC` idi) · `DOKUMAN-MERCEK-RAPORU-2026-09-03.md` B18 — kaldırılan `.env` bloğunu `KURULUM.md`'ye **eklemeyi reçete ediyordu**, uygulansa sır yüzeyi geri gelirdi (artık "⛔ ÜSTÜ ÇİZİLDİ" şerhli, özet listesindeki 3. madde de) · `test_db_invariants` "sistem hesabı ≤ 1" kırmızı mesajı ölü mekanizmayı adres gösteriyordu · `test_superadmin_hidden_single_source` §1/§6 gerekçeleri ("hesabı YARATAN job", "TEK YAZAR boot job"). Aynı sınıftan dört kod yorumu da düzeltildi (`server.ts`, `system-account.registry.ts`, `feature-flag.routes.ts`, `test_superadmin.ts`).
- ⚠️ §6'nın anlamı değişti ve bu **yazıya geçti**: `isSystemAccount` yazan tek yer artık `src/` ağacında **değil** (`scripts/superadmin-olustur.ts`); dolayısıyla allowlist'in tamamı bugün **okuyucudur** ve `src/` altında yeni bir yazıcı belirirse o, P8'in kapattığı ikinci doğuş yolunun geri gelmesi demektir.

**C4** — `USERNAME_TAKEN` hata metni örnek olarak varsayılanla **aynı** adı (`bakim`) veriyordu: "bakim dolu → bakim seçin" döngüsü. Örnek `satici` / `bakim2` oldu.

### 2026-09-03 — Dilim 2 davranış bayrakları: varsayılan = BUGÜN, ve "çıkışsız kapı" bir tasarım hatasıdır

**Bağlam:** Tasarım §9 (eksik bayraklar) + karar #1/#10. Beş bayrak: `shipping.orderRequirement` (off|warn|block) · `shipping.weighRequiredEnabled` · `shipping.manualWeightRestrictedEnabled` · `shipping.invoiceMode` (dis|ic|ikisi) · `quality.gradeRequiredEnabled` · `batch.autoCreateEnabled`. Migration YOK (`Invoice.externalNo` şemada vardı). Sıfır fark temiz fabrika kopyasında kanıtlandı: aynı 4 bilinen `test_consistency` kırmızısı, yeni bayrak satırı 0.

**ÜÇ ÇIKIŞSIZ KAPI ÖLÇÜLDÜ ve üçü de tasarımı DEĞİŞTİRDİ:**
- `block` bugün açılsa fabrikada HİÇ sevkiyat kurulamazdı: tablet Paketleme ekranı `orderIds` göndermiyor. → Bayrak yazıldı, AÇILMADI; önkoşul PANEL METNİNDE ("tabletlerde sipariş seçici bulunan APK kurulu olmalı") ve bekçi o cümleyi METİNDEN ölçüyor (ölü şerh koruması).
- `manualWeightRestricted` eski istemcileri toplu 403'e düşürürdü (`source` opsiyonel ve MANUAL varsayılıyor). → Aynı muamele: yaz, açma, önkoşulu panele yaz.
- `batch.requiredEnabled` adı REDDEDİLDİ → **`batch.autoCreateEnabled`**. Sistemde parti YARATAN uç yok (`batch.routes` yalnız move/merge/split), yani "zorunlu" operatörü çıkışsız bırakırdı. **Ad yaptığı işi söylemeli:** 0 açık parti varsa sunucu partiyi kendisi açar.

**`warn` REJİMİ ÖNCE ONARILDI — "varsayılan = bugünkü davranış" cümlesi yalan olabilir.** Ölçüm üç boşluk buldu: Hızlı Sevk hiç uyarı üretmiyordu · Electron ve mobil yanıttaki `warnings`i hiç göstermiyordu · panelin `orderless` kutusu ÖLÜYDÜ (state vardı, gövdeye gitmiyordu). Yani bayrağı "bugünkü davranışla" eşitlemek, uygulamada "uyarının çoğu görünmüyor" demekti. Uyarı metni artık ORTAK yardımcıda — iki sevk yolu ayrışamaz. ⚠️ Bunun bedeli iki GÖVDE farkı: Hızlı Sevk artık `warnings` döndürüyor ve tartı hatası makine-okunur kod taşıyor. Statü kodları 20/20 birebir; eski istemciler kırılmıyor (ölçüldü: iki istemci de kendi uyarı cümlesini kendisi üretiyor, sunucunun metnine string bağı YOK) → deploy sırası serbest.

**⚠️ FASON DOĞRUDAN SEVK: aynı muhakeme bir bayrakta yapılıp ikizinde atlanmıştı.** Doğrulama canlı ölçtü: `block` açıkken `POST /subcontractor/dispatches/:id/direct-ship` tahsis göndermeden 200 döndü ve 110 m mal, müşteriye, SIFIR sipariş bağıyla bina dışına çıktı. `subcontractor.service`te rejim yüklemi hiç geçmiyordu. Bu İLAN EDİLMİŞ bir boşluk DEĞİLDİ: helper başlığı kabul edilen tek boşluğu (`dispatchShipment`e kapı konmaz) tek tek yazıyor ama fasondan söz etmiyordu — üstelik AYNI PAKETTEKİ `invoiceMode` doğrudan sevki BİLEREK kapsıyor ve panel metni bunu söylüyordu. Kapı takıldı (`orderless` kaçış alanıyla — yoksa fasonun son-durak akışı kilitlenirdi), Electron modalı hizalandı, bekçi §2.12 dört kontrolle çiviledi ve negatif sonda kırmızı verdi. **Ders: bir kapıyı bir yola takarken "bu malın çıktığı BAŞKA yol var mı" sorusu, kardeş bayrağın kapsam listesine bakılarak sorulur.**

**`quality.gradeRequiredEnabled` DAR kapsam** (KK1 · Tambur kalan-kuyruk · depo kesimi · WO kapanışının yalnız satılabilir dalları). Kapsam DIŞI dört yüzey bekçide NEGATİF sonda ile çivili: fason kabulü gradesiz top doğurmaya DEVAM eder (bilinçli null), son-adım finalize etkilenmez, `cutOpenFabric` etkilenmez, `attachRolls` hâlâ parti doğurur. Kapsam genişlemesi burada "sıfır fark" ihlalidir ve bayrak KAPALIYKEN değil AÇILDIĞI GÜN patlar.

**§3.6 tek resolver — yalnız ebeveyni OLAN bayraklara.** Ticaret/üretim altındaki 7 bayrak `resolveXEnabled` (modülAçık && altBayrak) ile okunur. Çekirdek bayraklar (kk1.* stok-giriş motoru, sevkiyat, ana veri) resolver ALMAZ: motor çekirdek, sunum modülde (karar #2). Sevkiyat bayrakları EBEVEYNSİZ — mekanik uygulayan biri `resolveX(modulAcik && …)` yazarsa ölü bir sabit doğar.

**BEKÇİNİN ÜÇÜNCÜ AYAĞI (`aEnum`):** `test_feature_flag_contract` bugüne kadar yalnız boolean (`aBool`) ve sayısal (`aNum`) anahtarları ölçüyordu; enum/metin anahtarlar HİÇBİR kontrolden geçmiyordu. Mevcut `sameTypeSessionPolicy` ne bir kümede ne bir muaftaydı — dört kapıdan biri düşse (ör. Zod satırı) her kontrol yeşil kalırdı. §16 on iki kontrol getirdi (dört kapı · şemanın KAPALI KÜME olduğu · panel `enumKey` ayağı · panel varsayılanı ↔ backend okuyucu · **çöp-değer kod sigortası**: DB'ye elle yazılmış geçersiz değer sahayı kilitlemez) ve boşluğu RETROAKTİF kapattı; 11 sondanın 11'i kırmızı verdi.

### 2026-09-03 — Süperadmin doğuşu P8: iki yol iki sır yüzeyi; sessiz kilitlenme kabul edilemez

**Karar (kullanıcı):** `.env` tohumlama yolu KALDIRILDI, tek doğuş yolu sunucuda elle koşulan `npm run superadmin:kur`. Gerekçe: ikinci yol ikinci sır yüzeyidir ve `.env` satırları yedeğe, `kur.ps1`in taşıdığı dosyaya, ekran paylaşımına giriyordu. Adnan sıfır fark — fabrikada `SUPERADMIN_*` zaten tanımsız (ölçüldü), script koşulmadıkça hesap doğmaz, emniyet supabı açık kalır.

- İnteraktif: kullanıcı adı · parola (iki kez, ekrana BASILMAZ) · PIN (boş → üretilir, BİR KEZ) · TOTP (üretilir, otpauth URI + terminal QR, BİR KEZ). Ham sırlar hiçbir dosyaya/log'a/audit yüküne girmez; çekirdek `provisionSuperadmin(input, deps)` SESSİZDİR (yazdırma interaktif katmanın işi) ve bekçi bunu stdout yakalayarak 0 bayt diye ölçer.
- ⚠️ **FAIL-LOUD TTY KAPISI — doğrulamanın bulduğu MAJOR.** Script gerçek TTY olmadan (`ssh` `-t`siz, `docker exec` `-it`siz, pm2/CI) ilk sorudan SONRA SESSİZCE SONSUZA KADAR DONUYORDU: hata yok, zaman aşımı yok, süreç ve Prisma havuzu açık. Sebep `readline` `terminal:false` modunda boruyu tek chunk alıp yalnız ilk satırı teslim ediyor. Hesabın TEK doğuş yolu bu script olduğu için kurulum sessizce tamamlanmamış kalır ve operatör "komutu koştum" der; boot logu "hesap yok" demeye devam eder. Artık ilk ifade `process.stdin.isTTY` kapısı + reçetelerde `ssh -t` uyarısı.
- İDEMPOTENT (hesap varsa dokunmaz) · `--rotate` (parola/PIN/TOTP + `tokenVersion++`, kullanıcı adı DEĞİŞMEZ — ad giriş kimliğidir) · **mevcut kullanıcı YÜKSELTİLMEZ** (büyük/küçük harf varyantları da reddedilir; gizli hesap görünür bir hesaptan türetilemez, çünkü o kullanıcının geçmişi/oturumları/audit satırları maskeli hesaba taşınamaz). Panelde düğme, API'de uç YOK — `admin:users` taşıyan herkesin kendini yükseltmesi demek olurdu.
- ⚠️ `.env`de KALAN eski satırlar için boot uyarısı (yalnız ANAHTAR ADI, değer ASLA): P2 yolunu kullanmış bir kurulumda o satırlar CANLI kimlik bilgisidir. Uyarı tespit eder, temizliği operatör yapar (reçetede adım var).
- Bayat belge atıfları düzeltildi; en tehlikelisi mercek raporunun "`.env` bloğunu KURULUM.md'ye EKLE" reçetesiydi — uygulansaydı P8'in kapattığı sır yüzeyi geri gelirdi. **Bu, "şerh yazmadan önce yeniden ölç" kuralının neden var olduğunun kanıtı.**

**Süreç dersi (ikisi de bu turda yaşandı):** ① Bir doğrulayıcı ölçümlerin TAMAMINI yapıp yapılandırılmış çıktıyı beş denemede veremeden düştü — bulgu transcript'ten kurtarıldı; şema alanlarına sınır koymak (findings ≤ 12, kanıt ≤ 2500 karakter) bunu önlüyor. ② Düzeltme turu API 500/529 ile iki kez düştü ama ajanlar işi BİTİRMİŞTİ; "rapor gelmedi" ile "iş yapılmadı" ayrı şeylerdir — ağacın durumu ölçülerek anlaşıldı (kapı takılı mı, bekçi ne diyor), rapora güvenilmedi.


### 2026-09-04 — [PROFİL] Sistem hub'ı üçe bölündü: satıcı anahtarı ≠ fabrika tercihi ≠ makine bakımı

**İSTEK (kullanıcının kendi cümleleri):** *"modül flaglarını ayrı bir yere taşıyalım sistem menüsüne tıklayınca açılan yerde bir yerde olsun. firmadaki yetkilinin düzenleyebileceği flaglar ayrı bir yerde olsun. güncelleme denetleme ayrı bir yerde olsun. geri kalanlar durabilir. demo menüsü de sadece süperadmine gözüksün. ayrıca modüller menüsü de sadece süperadmine gözüksün."*

**Yapılan — Sistem hub'ında üç ayrı karo, kategoriler TEK katalogda kaldı:**
`SettingsCategory`ye ayrı bir `surface` ALANI EKLENMEDİ; yüzey **bölümden türetilir**
(`SECTION_SURFACE`, `categorySurface`). İki yazar olsaydı bir bölümün altındaki
kategorilerden biri başka sayfaya kayar ve sol raydaki başlık yalan söylerdi.
- **Sistem → Modüller** (`/system/module-profile`, eski adı "Sistem Profili"; **route path DEĞİŞMEDİ** — derin bağlantılar ve satıcının telefonda tarif ettiği adres yaşıyor): modül anahtarları + **kurulum beyanı (demo)** + **ayar şifresi kartı**. Karo `superadminOnly`.
- **Sistem → Özellik Anahtarları** (`/system/feature-flags`): fabrikanın DAVRANIŞ bayrakları — 9 kategori (müşteriler · siparişler · sevkiyat · iş emirleri · üretim-saha · kartela · mal kabul · iplik · muhasebe). Kapı `admin:settings`.
- **Sistem → Güncelleme** (`/system/update`): eski "Bu Bilgisayar → Güncelleme" alt-sekmesi. Kapı ÇOKLU (`admin:settings` ∨ `settings:workstation`) — yazıcısını/kantarını kuran personel `admin:settings` taşımaz ve hub'ı göremez, oraya PALETTEN gelir; kapıyı daraltmak onu güncelleme durumundan koparırdı.
- **Genel Ayarlar** = "geri kalanlar": şirket · oturum & güvenlik · cihazlar · etiket baskısı · bu bilgisayar.
Kabuk TEK bileşen (`SettingsSurfacePage`, `surface` parametreli): arama/aktif sekme/kirli taslak onayı gibi ölçülmüş dört kural iki kopyada yaşamaz.

**⚠️⚠️ ASIL BULGU — TAŞIMA GÖRÜNÜRLÜK YÜKLEMİNİ DE DEĞİŞTİRDİ (kilitlenme sınıfı).**
2026-09-03'te satıcı kapısı bilerek İKİ yüklemdi: yazma supaplı (`isSuperadminGateOpen`),
görünürlük supapsız (`isSystemAccountIdentity`) — *"satıcı ekranı hesap yokken de
fabrikaya görünmez"*. O ayrım MEŞRUYDU çünkü modül anahtarlarının **İKİNCİ bir yazma
yolu** vardı: Genel Ayarlar → Modüller sekmesi. Bu turda o sekme kaldırıldı; supapsız
görünürlük o anda bir KİLİTLENME hâline geldi — süperadmin hesabı doğmamış bir
kurulumda karo çizilmez + route 403 verir + geriye yazacak yüzey KALMAZ → **modüller
bir daha AÇILAMAZ.** Karar: `isSystemAccountIdentity` KALDIRILDI, tek yüklem
`isSuperadminGateOpen` (supaplı) ve karo · route (`ProtectedRoute.requireSystemAccount`) ·
palet · `FeatureFlagSection` hepsi ondan besleniyor. Kural tek cümle: **satıcı yüzeyi
satıcıya görünür; satıcı hesabı hiç doğmamışsa (yalnız o zaman) fabrika yöneticisine de
görünür ve yazılabilir** — backend `flagWriteGuard`ın üçüncü dalıyla birebir.
⚠️ Kuralı geri çevirmeden önce modül anahtarlarına İKİNCİ bir yazma yüzeyi kur.

**Demo `superadminOnly` BAYRAĞI ALMADI (bilinçli):** o bayrak bir KİLİT iddiasıdır ve
backend `flagWriteGuard`ın süperadmin dalı YALNIZ `MODULE_FLAG_KEYS`i kapsar —
`demoModeEnabled` onda değil. Kilit çizseydik panel, sunucuda olmayan bir kapıyı varmış
gibi anlatırdı. Demo'yu fabrikadan uzak tutan şey SAYFANIN kimlik kapısıdır.

**Güncelleme karosu WEB'DE DE ÇİZİLİR** (`desktopOnly` denendi, geri alındı): sayfa
tarayıcıda kendi "yalnız masaüstünde çalışır" metnini basıyor, yani başlığın gövdesi VAR
(WorkstationTabs'ın "başlık ile gövdenin kapısı aynı koşuldan beslenir" kuralı). Kabuğa
göre gizlemek ayrıca *"her statik route'un bir palet girişi var"* invariantını
(`command-entries.test`) muafiyet listesine zorluyordu. Emsal: yazıcı/kantar/tabanca
sekmeleri de web'de duruyor.

**Adres TEK KAYNAK `settingsCategoryPath`:** kategoriler üç ekrana bölününce elle yazılmış
`/system/settings?tab=` girişlerinin yarısı OLMAYAN bir sekmeye gidiyordu ve sayfa sessizce
ilk sekmeye düşerdi ("Kurşun Sırası" dersinin ayar ekranındaki ikizi). Palet başlığı da
yüzeyden (`SURFACE_LABEL`) — "Genel Ayarlar · Muhasebe" yazıp başka ekrana atan bir arama
sonucu yalan söyler. Karo başlıkları ↔ `SURFACE_LABEL` ↔ route bekçide birebir.

**Bekçi:** yeni `Electron/src/pages/GeneralSettings/settings-surface.test.ts` (19 kontrol:
üç yüzeyin dağılımı · sızıntı · derin bağlantı · karolar · kilitlenme) +
`SystemHubPage.superadmin.test.tsx` yeniden yazıldı (③ supap artık karoyu AÇAR — beklenti
2026-09-03'ün TAM TERSİ) + `superadmin-gate.test.ts` tüketici listesine `ProtectedRoute`
eklendi (negatif sonda: route supapsız bir kurala çevrildiğinde §2 YEŞİL kalıyordu).
**Negatif sondalar (dördü de kırmızı verdi, birebir geri alındı):** ① `SECTION_SURFACE`te
modül/demo `flags`a çevrildi → 6 ❌ · ② supap kaldırıldı (route + hub) → 2 ❌ ·
③ `settingsCategoryPath` elle `/system/settings`e sabitlendi → 2 ❌ · ④ `ProtectedRoute`
yüklemi elle kopyalandı → gate bekçisi 2 ❌.

**Migration / izin kodu / APK YOK; backend'de yalnız `screen-catalog` üç satır** (yeni iki
ekran + `system/module-profile` başlığı "Modüller"). Tamlık bekçisi 33/33, feature-flag
sözleşmesi 78/78, modül anahtarları 72/72.

### 2026-09-04 — [ÇEKİRDEK] Kapalı modülün bayrağı ÇİZİLMEZ: satış sınırı ekranda görünür olmalı

**İSTEK (kullanıcının kendi cümlesi):** *"biz bu programın modüllerini parayla satacağız,
fabrika sahibinin 'bu modül zaten içinde varmış' demesini istemiyoruz."* Somut vaka:
`iplik.enabled` KAPALI bir kurulumda Özellik Anahtarları ekranında "İplik" sekmesi ve
`yarnBlockNegativeBalanceEnabled` satırı duruyordu.

**⚠️⚠️ BU, P5'İN (2026-09-03) "KİLİT ≠ GİZLEME" KARARININ BİLİNÇLİ TERSİDİR** ve geri
almadan önce çürütülmesi gereken gerekçe şudur: o gün gizlemeye karşı TEK argüman
*"modülü kapatınca ayarın değeri hiçbir yerde okunamaz, geri dönüş yolu kalmaz"* idi.
Aynı gün (2026-09-04, bir önceki not) modül anahtarları **kendi ekranına** taşındı
(Sistem → Modüller, `surface: "vendor"`) ve **o ekran bu kuraldan ETKİLENMEZ** — yani geri
dönüş yolu artık başka bir sayfada duruyor. İkinci sigorta: **satıcı görünümünde hiçbir
satır gizlenmez** (`isSuperadminGateOpen` — supap dahil: sistem hesabı HİÇ doğmamış bir
kurulumda fabrika yöneticisi satıcı sayılır, yoksa süperadminsiz kurulum kendi kapattığı
modülün ayarını bir daha göremezdi). Kilit BANDI kalkmadı, izleyicisi değişti: kapalı
modülün satırı yalnız satıcıya, salt-okunur + bantlı çizilir.

**GÖRÜNÜRLÜK SATIRDAN TÜRER, `moduleKey`den DEĞİL.** Kategori düzeyinde karar verilseydi
karma kategori (bir kısmı çekirdek, bir kısmı modüle ait) ya tümden kaybolur ya hiç
gizlenmezdi. Bugün karma kategori GERÇEK: "Üretim — Saha" sekmesinin KK1/Tambur satırları
üretime, Fason satırları henüz anahtarı olmayan `planlanan:fason`a ait → üretim kapalıyken
sekme AYAKTA kalır, yalnız üretim satırları düşer. Kategoriden geriye satır kalmazsa sekme
de çizilmez (boş başlık "burada bir şey vardı" der).

**TEK KAYNAK + DERLEME KAPISI:** `Electron/src/pages/GeneralSettings/flag-modules.ts` →
`FLAG_MODULE: Record<FlagRowKey | SystemSettingKey, FlagOwner>`. Söz dağarcığı
`screen-catalog.ts`ten (`ScreenEntry.modul`) alındı ve birebir aynı anlamda: modül anahtarı
· `"cekirdek"` · `"planlanan:fason|kartela"`. `Record` tamlığı ölçüldü — bir satır
silinince `tsc` **TS2741** verip eksik anahtarı ADIYLA söylüyor ("unutulmuş enum değeri"
bu depoda tekrar eden arıza sınıfı). ⚠️ Küme BİLEREK geniş (yalnız bugün çizilen satırlar
değil, TÜM skaler `FeatureFlags` alanları): daraltmanın tek yolu `SETTINGS_CATEGORIES`ten
tip türetmekti ve o dizi `as const` olamaz (`icon`/`hint` bileşen taşır).

**AİDİYET = SATIRIN YÖNETTİĞİ YÜZEY, ENFORCEMENT'IN KOŞTUĞU YER DEĞİL.** `kk1DuplicateGuardEnabled`
KK1 ham girişini yönetir ve KK1 ekranı katalogda `productionEnabled`e aittir — oysa
`/api/rolls` BİLİNÇLİ olarak üretim kapısının arkasında DEĞİLDİR. İkisini karıştırmak
tabloyu route mount'larının kopyasına çevirirdi. Aynı ölçüt üç sınır kararını da verdi:
`financeYarnOutOnInvoiceEnabled` → **finans** (kural fatura onayında koşar, iplik yalnız
etkilenen taraf) · `pricingEnabled` → **çekirdek** (`financeEnabled`ten bağımsız olduğu
alan yorumunda yazılı) · fason/kartela → **`planlanan:*`** (üretime asmak YANLIŞ modülü
kapatırdı — `module.middleware.ts` başlığının kararı).

**MODÜL ŞALTERİ KENDİNİ GİZLEYEMEZ:** yedi anahtar da `"cekirdek"`. Kendi modülüne ait
sayılsaydı kapatıldığı an satırını gizler ve bir daha AÇILAMAZDI.

**SÜZGEÇ ÇAĞIRANDA, BİLEŞENDE DEĞİL:** `SettingsSurfacePage` süzülmüş dizileri
`FeatureFlagSection`a geçirir. Yalnız GÖRSEL saklama yapılsaydı taslak/Kaydet gövdesi hâlâ
`flags` dizisinden türeyeceği için kapalı modülün bayrağı her Kaydet'te PATCH'e yazılmaya
devam ederdi (görünmeyen satırı yazan ekran).

**Bekçiler:** yeni `flag-modules.test.ts` (12 kontrol — tamlık · şalter · `moduleKey`↔satır
hizası · kapanma · çekirdek · satıcı · karma · planlanan · fail-open · değer sözlüğü) +
yeni `SettingsSurfacePage.modules.test.tsx` (3 kontrol, kabuğun GERÇEK turu: saf yüklem
çağıranın yanlış listeyi geçmesini engelleyemez). **Negatif sondalar (üçü de kırmızı
verdi, birebir geri alındı):** ① satır süzgeci `return true` → 3 ❌ · ② `kind !== "flags"`
süzgeci kaldırıldı → 2 ❌ · ③ kabuk `rows.*` yerine `cat.*` geçirdi → 3 ❌ (bileşen turu 2 +
rejim bekçisi 1). Güncellenen bekçiler: `settings-groups.test.ts` (eski "her modül
durumunda GÖRÜNÜR" iddiası artık `groupSettingsCategories` modül durumunu OKUMAZ diye
ölçüyor — iki semantiği tek imzada taşımak P5 karışıklığının kaynağıydı) ve
`SettingsSurfacePage.search.test.tsx` rejim bölümü.

**Migration / izin kodu / APK / backend değişikliği YOK** — kural tamamen Electron'da.
Backend kapıları (`requireXEnabled`, `flagWriteGuard`) bu turda hiç ellenmedi; sözleşme
78/78, modül anahtarları 72/72 yeşil.

---

## 2026-09-04 — Cihaz onay kapısı: bayrak kapalıyken de her cihaz PENDING doğuyordu [ÇEKİRDEK]

**Saha ölçümü (çalışan kurulum, sıfırdan kurulmuş paket):** `devicePairingRequired`
KAPALI olmasına rağmen yeni tablet "Cihaz Atama Bekliyor" ekranında kalıyordu.
Backend üç yerden "gerek yok" diyordu (DB bayrağı false · `GET /devices/pairing-required`
`{required:false}` · `device.middleware` yalnız bayrak TRUE iken 401/503) ama
`DeviceService.announce` yeni kaydı **koşulsuz** `PENDING` yaratıyor,
`DeviceService.getStatus` da ham `status` döndürüyordu. Yani kapı kapalıyken bile
her yeni cihaz "onay bekliyor" damgasıyla doğuyordu.

**Neden bugüne dek görünmedi:** sahadaki 28 cihazın hepsi çoktan APPROVED. Kusur
yalnız YENİ cihaz eklenince görünür — yani **yeni müşteri kurulumunda** ve
**arızalı tablet değişiminde** (vardiya ortası, en kötü zamanlama).

**İKİNCİ, SESSİZ ZARAR (ilk raporda yoktu):** `resolveDevice` yalnız APPROVED + aktif
cihaza atıf döner. Bayrak kapalı bir kurulumda tabletin `req.device`'ı bu yüzden HİÇ
dolmuyordu → makine atfı (RollOperation/RollMovement) **ve cihaza bağlı donanım
çözümü** (BT etiket yazıcısı `deviceId`-join'inden gelir) sessizce boşa düşüyordu.
"Onay ekranı" belirtisinin altında duran asıl arıza buydu.

**KARAR — doğuş durumu bayraktan türer:** bayrak AÇIK → `PENDING` (eski davranış),
KAPALI → **`APPROVED`**. `DeviceStatus` enum'una ÜÇÜNCÜ değer eklenmedi ve bu bilinçli:
enum'un anlamı "bu cihaz kapıdan geçebilir mi"dir, bayrak kapalıyken kapı YOKTUR, yani
doğru başlangıç kapının açık karşılığıdır. Yeni bir durum değeri iki zararın hiçbirini
çözmez, üçüncü bir dal daha açardı.

**BAYRAK SONRADAN AÇILIRSA otomatik onaylananlar APPROVED KALIR.** Bayrak ileriye
dönük bir kapıdır ("bundan sonra yeni cihaz onay ister"), geriye dönük bir iptal değil:
28 cihazlık bir fabrikada retroaktif düşürme, ayarı açan yöneticinin vardiya ortasında
TÜM tabletleri kilitlemesi demekti (çıkışsız kapı sınıfı — Dilim 2'nin üç ölçümüyle aynı
gerekçe). Gözden geçirmenin yolu var: otomatik onayın audit izi `DEVICE_AUTO_APPROVED`
(yeni satırda, `tableName="devices"`) + cihaz başına `revoke`.

**MEVCUT PENDING CİHAZ TERFİ ETMEZ** (bayrak kapalıyken bile). "Hiç görülmemiş cihaz"
ile "yöneticinin PENDING'de bıraktığı / `revoke` ettiği cihaz" farklı şeylerdir; public
bir uç bir yönetici kararını geri alamaz (F216'nın aynı gerekçesi). Terfi ettirilseydi
bayrağın bir anlık kapanması tüm revoke kararlarını sessizce siler.

**KARAR SUNUCUDA (devir notunun (b) seçeneği):** `GET /devices/status` **ve**
`POST /devices/announce` cevapları artık `pairingRequired` taşır — onay ekranı koşulu
`pairingRequired && status !== "APPROVED"`. Karar iki uca bölününce her istemci onu
ayrı ayrı kurmak ve ayrı ayrı yanlış yapmak zorunda kalıyordu. Mobil tarafta tek yüklem
`mobil/src/navigation/pairingGate.ts`; içindeki **`??` load-bearing**: sunucunun taşıdığı
karar 5 dk cache'lenen uç bayrağını EZER (`||` yazılsaydı bayat `true` sunucunun
"gerekmiyor"unu yutar, `&&` yazılsaydı tersi olurdu), alan YOKSA (eski backend) davranış
birebir eskisi gibi kalır.

**⚠️ İKİNCİ TAVAN GEREKTİ — `MAX_PENDING_DEVICES` sessizce etkisizleşiyordu.** Bayrak
kapalıyken PENDING sayacı hiç artmaz, yani kimlik doğrulamasız `announce` ucu SINIRSIZ
satır açabilirdi (F-CORE-GUV-003'ün kapattığı zararın kapalı-rejim ikizi) — hem admin
Cihazlar ekranını kullanılamaz kılar hem de bayrak AÇILDIĞINDA o satırlar "onaylı"
sayılırdı. `MAX_DEVICE_ROWS` (= `DEVICE_LIST_LIMIT`, 500) rejimden BAĞIMSIZ koşar;
PENDING tavanı yerinde ve yalnız bayrak açık dalında. Bir kapıyı bayrağa bağlarken
sorulacak soru: *bu bayrak, komşu kapının saydığı şeyi sıfırlıyor mu?*

**İSTEMCİ ÇIKARIMLARI (devir notu 4. bölüm) ÖLÇÜLDÜ — biri yanlıştı:** mobil
`usePermission` global joker dalını (`hasGlobalWildcard`) zaten taşıyor ve bekçisi yeşil
(`usePermission.test.ts` — "global * (satıcı hesabı) her izni açar" + tüm ekranların
açıldığı ikinci kontrol). Yani BULGU A'nın önerdiği "`["*"]` kestirmesini kaldırın"
UYGULANMADI: kestirme 2026-09-03 P2'nin bilinçli kararıdır. Aynı şekilde RootNavigator
kapısı da ham `status`a değil `assignmentRequired && status !== 'APPROVED'`e bağlıydı.
İkisinin de sebebi aynı: **ölçüm o tablette ESKİ BUNDLE'ın koşmasıydı.** Ders: derlenmiş
paket üzerinden yapılan istemci çıkarımı, o paketin YAŞINI ölçmez.

**Bekçiler:** `scripts/test_device_pairing_flag.ts` (18 — dört negatif sondayla kırmızı
verdiği doğrulandı: koşulsuz PENDING doğuşu → 4 ❌ · cevaptan `pairingRequired` düşünce
→ 4 ❌ · toplam tavan silinince → 1 ❌ · mevcut PENDING terfi edince → 1 ❌) +
`mobil/src/navigation/pairingGate.test.ts` (9 — naif `status`-only uygulamada 4 ❌,
`??`→`||` sondasında 1 ❌). `test_device_assignment.ts` artık bayrağı AÇIKÇA kurar:
doğru sonucu ortamın varsayılanından alan örtük varsayım kırıldı.

**Migration / izin kodu YOK; APK gerekir** (mobil kapı JS — uzaktan güncellemeyle de
gider). Deploy sırası backend ÖNCE: eski istemci yeni alanı görmezden gelir, davranışı
değişmez. Doküman: `docs/ops/KURULUM.md` E43 (vaadi artık gerçek) +
`docs/ops/ISTEMCI-BULGULARI-2026-09-04.md` (devir notu + düzeltme başlığı).

---

## 2026-09-04 — Keşif: bir satır = bir SUNUCU (BULGU C); sıralama var, ELEME yok

**Belirti (çalışan kurulumda ölçüldü — `docs/ops/ISTEMCI-BULGULARI-2026-09-04.md` §4):**
tablet ağı tarayınca **iki sunucu** görüyordu (`192.168.1.102` + `192.168.137.1`), aynı
makinedeki Electron ise **üçüncü bir adresi** (`172.20.144.1`) seçiyordu. Dört adresten
`/api/discovery/identity` soruldu, **dördü de aynı `installationId`** döndürdü: tek
süreç (PID 6224, `HOST=0.0.0.0`), yedi IPv4 (Wi-Fi · hotspot · Hyper-V sanal anahtarı ·
Tailscale · üç link-local). Operatöre üç ayrı sunucu varmış gibi görünüyordu.

**① Tekilleştirme ölçütü ADRES DEĞİL KİMLİK.** `groupByInstallation` adayları
`installationId`'ye göre gruplar; liste **sunucu başına tek satır** basar, adresler
grubun içinde durur. Electron'da `dedupeCandidates` zaten vardı ama diğer adresleri
**atıyordu** (kullanıcıya adres seçtirmek imkânsızdı) ve mobilde **hiç yoktu**.

**② `installationId` NULL olan aday BAŞKA HİÇBİR ADAYLA BİRLEŞMEZ** — kendi
`addr:<host>:<port>` anahtarında kalır. Kimliksiz sunucu eski sürüm ya da boot'ta DB'si
hazır olmayan sunucudur (`compareIdentity`'nin `unknown` notuyla aynı gerekçe); iki
kimliksiz adayı "aynı sunucu" saymak için elde kanıt yok ve birleştirmek gerçek ikinci
bir sunucuyu listeden SİLERDİ. Eski (adres bazlı) davranış orada birebir korunur.

**③ Adres tercihi SIRALAMADIR, ELEME DEĞİL.** `addressPreferenceRank`: LAN (192.168/16,
10/8) → ad/sınıflandırılamayan → 172.16/12 (Hyper-V/Docker/WSL) → 100.64/10
(CGNAT/Tailscale) → 127/8 + `localhost` → 169.254/16. Ölçülen kök sebep: Windows arayüz
metriklerinde Hyper-V sanal anahtarı (15) gerçek Wi-Fi kartından (50) ÖNCELİKLİ, tarama
da "ilk cevap verende" duruyordu — `172.20.144.1` yalnız o makineden erişilebilir, yani
ağdaki hiçbir tablet oraya bağlanamaz. ⚠️ **Sanal/overlay aralıklar KÖRLEMESİNE
ELENMEZ**: Docker'da koşan sunucu ya da Tailscale'le bağlı şube o adresten gerçekten
hizmet veriyor olabilir; elemek, çalışan tek yolu olan kurulumu sunucusuz bırakır. Her
aday listede KALIR, yalnız hangisinin önce denendiği değişir. Grup içi sıra: adres
tercihi → `tieBreak` → gecikme → ad (son basamak DETERMİNİZM içindir — eşit adaylarda
sıra turdan tura oynarsa "otomatik seçilen adres" de oynar).

**④ Kural TEK METİNDE, iki dosyada.** Mobil `Electron/shared/discovery.ts`i import
edemez (ayrı proje, `types/permissions.ts` ile aynı durum) ve *"iki istemci aynı hatayı
ayrı ayrı yapar"* bu depoda tekrar eden bir sınıf. Blok `>>> KEŞİF-İKİZ BAŞLANGIÇ` /
`<<< KEŞİF-İKİZ SON` işaretleri arasında ve iki bekçi metni **birebir** kıyaslar
(`mobil/src/lib/discovery.contract.test.ts` + `Electron/src/test/discovery-logic.test.ts`)
— her koşucu kendi tarafından bakar, tek bir CI adımına bağlı kalmayız. Bloğa PROJEYE
ÖZGÜ hiçbir şey girmez: Electron'un kaynak güvenilirliği sırası (`bySourceRank`, mDNS ↔
tarama) blok DIŞINDA yaşar ve `tieBreak` parametresiyle içeri verilir — mobilde `via`
alanı yok.

**⑤ Yan kazanç — otomatik adres uygulama kapısı düzeldi.** `startDiscoveryIfNeeded`
"tek kullanılabilir aday varsa adresi yaz" diyor ama çok adresli sunucu **hiçbir zaman
"tek" görünmüyordu**. Sıra artık ÖNCE tekilleştir, SONRA sırala.

**Bekçiler:** `Electron/src/test/discovery-logic.test.ts` (33) +
`mobil/src/lib/discovery.test.ts` · `discovery.contract.test.ts` (37) — **dört negatif
sondayla** iki koşucuda birden kırmızı verdiği doğrulandı: adres tercihi düzleşince
(172.16/12 → LAN) Electron 2 / mobil 2 ❌ · anahtar kimlik yerine adres olunca 3 / 2 ❌ ·
kimliksiz adaylar tek kovaya birleşince 2 / 1 ❌ · YALNIZ Electron kopyası bir bayt
kayınca ikiz kilidi 1 / 1 ❌.

**Migration / izin / backend değişikliği YOK** (`installationId` cevapta zaten vardı).
Electron + APK/OTA birlikte gider; ayrı gitmeleri de zararsız — kural iki tarafta
bağımsız çalışır. Mobil `ServerDiscoveryList` DOKUNULMADI (başka ajanın işiyle
çakışmasın): tablet artık tek satır görür, adres seçimi `DiscoveryResult.groups`ta
hazır ama henüz yüzeyi yok — masaüstünde "bu sunucunun N adresi var" düğmesiyle açılır.

---

## 2026-09-04 — Sevk belgesinde MÜŞTERİDEKİ ürün adı: veri vardı, belge yolu yoktu [PROFİL/ÇEKİRDEK karma]

**Talep (fabrikadan):** *"sevkiyat yapılınca oluşan belgelerde ürünlerin müşterideki adı
da yazsın. bazen bir seferliğine değişmiş oluyor; eğer bir seferliğine bile değiştiyse o
ismi kullanırız. ve bu flag'e bağlı olsun: istersek sadece bizdeki adı, sadece
müşterideki adı, veya ikisi de basılabilsin. bunların sütun isimlerini de biz
girebilelim."*

**Ölçüm: veri modeli talebi BİREBİR karşılıyordu, eksik olan tek şey belge yoluydu.**
`OrderLine.customerItemName` (sipariş satırı bazlı bir-seferlik override, şema yorumu:
*"dolu ise KİLİT"*) + `CustomerItemAlias` (`@@unique([customerId,itemId])`, müşteri×ürün
master) etiket basımında (`label.service` → `customer-name.helper`) uzun süredir
kullanılıyordu; `collectShipmentDocContent` ise düz `Item.name` basıyordu. Zincir
**ETİKETLE AYNI** tutuldu (`helpers/shipment-customer-name.helper.ts`) — ikinci bir
semantik açmak, aynı topun etiketinde ve irsaliyesinde farklı ad demekti.

**⚠️ TOP → SİPARİŞ SATIRI BAĞI YOK — zincirin anahtarı bu boşlukta.** Çuval tahsisi
(`SackAllocation`) çuval başınadır ve çuval karışık içerikli olabilir; "bu topun order
line'ı" diye bir kayıt yok. Bu yüzden override kümesi **sevkiyat kapsamında** toplanır ve
`(itemId, colorId)` ile eşlenir. Adaylar iki kaynaktan: (a) çuvallara yazılmış tahsisler —
sevkin GERÇEKTEN beslediği satırlar, ama yalnız DISPATCH'ten sonra vardır; (b) sevkiyata
bağlı siparişlerin satırları — **PLANNED taslak önizlemenin TEK kaynağı**; (b) olmasaydı
taslak fiş ile donmuş belge ayrışırdı. (a) önceliklidir. **Sıra DETERMİNİSTİK** (tahsisli
→ `createdAt` asc → `id` asc): sabitlenmezse aynı sevkiyat iki baskıda farklı ad basar ve
`reissue` sahte bir "içerik değişti" üretir. İkinci kademe (`byItem`, renk eşleşmeden)
BİLİNÇLİ GENİŞ — kullanıcının kuralı "bir seferliğine bile değiştiyse o ismi kullanırız".

**⚠️ AD DONAR, REJİM DONMAZ — paketin en kolay karıştırılan ayrımı.** Ad
(`products[].customerName`, `cekiRows[].customerDesen/customerVaryant`) **snapshot'a
yazılır**: irsaliye hukuki kayıttır ve sevk anındaki ad doğru olandır; müşteri kartındaki
karşılığı sonradan düzeltmek eski belgeyi DEĞİŞTİRMEMELİ. Hangi adın basılacağı ise **her
baskıda canlı okunur** (`buildRenderExtras` → `meta.itemNameMode`), çünkü ayarı açtıran
şikâyet ("müşteri okuyamıyor") tam da sahadaki ESKİ belgelere ulaşmak zorundadır —
refakat kartının 2026-08-06 *"içerik donuk, sunum canlı"* kuralının aynısı. İkisi
karışırsa iki ayrı arıza doğar: rejim de donarsa ayar hiçbir mevcut belgeye ulaşmaz; ad
da canlı okunursa alias düzeltmesi geçmiş irsaliyeleri değiştirir. Bekçi §3 **ikisini
birden** ölçer (donmuş belge sonradan değişen alias'tan etkilenmiyor **ve** aynı belge
ayar değişince farklı kolonla basılıyor).

**⚠️ Sevkten SONRA da koşar** (`reissue` + lazy-init, 2026-08-05 dersi) — brütleştirmeyle
geri eklenen iade satırları da `RollReturn.itemId/colorId` üzerinden aynı zincirden
geçer; yalnız `item.name` taşınsaydı iade satırı belgede BİZİM adımızla, kardeşleri
müşterinin adıyla basılırdı.

**⚠️ GRUPLAMA ANAHTARI BİZİM ADIMIZ OLARAK KALDI.** Müşteri adına göre gruplasaydık iki
farklı ürün aynı alias altında birleşir, adet/metraj sessizce toplanırdı. Müşteri adı
gruba TAŞINIR, grubu belirlemez.

**Bayrak `shipping.docItemNameMode`** — `bizdeki` (VARSAYILAN) | `musterideki` | `ikisi`.
Varsayılan rejimde belgeye **tek bayt eklenmez**: rejim verilmeyen render ile `bizdeki`
render BİREBİR aynı bayt (bekçi §1'de ölçülü — "varsayılan = bugünkü davranış" bir
temenni değil, ölçüm). `musterideki` **FAIL-OPEN**: karşılığı olmayan üründe BİZİM adımız
basılır; boş ürün adı taşıyan bir irsaliye hukuken sakattır ve "ayar açık, alias yok" diye
hücreyi boş bırakmak sahayı kâğıtsız bırakmaktan beterdi. Dört kapı + `test_feature_flag_
contract` §16 (`aEnum`) + panel `enumFlags` satırı + Electron değer kümesi aynası.
Kolon ANAHTARLARI ayrı (`name` ↔ `customerName`): tek anahtarla iki içerik basılsaydı
"Stok adı"nı gizleyen fabrika, ayarı değiştirdiği an müşteri adını da gizlemiş olurdu.

**Kolon başlığı özelleştirme** — `DocumentConfig.columns[tablo].labels` (dört kapı: tip ·
`sanitizeDocumentsConfig` · `docConfigSchema` · Electron aynası; `columns.shown`
2026-07-30'da tam bu kapılardan birini atlamıştı). ⚠️ Değer **kullanıcı girdisidir** ve
yerleşik `label`ların aksine HTML olarak güvenli değildir → `applyColumnCfg` **tek
noktada** kaçırır; yeni bir tablo motoru yazan bu kaçırmayı taşımak zorunda. Boş dize =
"varsayılana dön" (punto kutusuyla aynı sözleşme — başlıksız kolon üretilmez), 40
karakterde kırpılır. Panelde kolon satırlarında punto/kalınlık hücrelerinin yerini başlık
kutusu alır (kolonun puntosu zaten tablo başlığı alanından ayarlanıyor).

**RENK DE YAPILDI** (kullanıcı yalnız ürün demişti): belgedeki "stok adı" zaten
`ürün + renk + en` birleşimidir — renk çevrilmeseydi *"AKTOS ANTRASİT 150cm."* gibi yarı
çevrilmiş bir ad basılırdı. `customerColorName` / `CustomerColorAlias` ikizi aynı
zincirden geçer.

**KAPSAM ve BİLİNÇLİ DIŞARIDA BIRAKILANLAR:** sevk irsaliyesi (`SHIPMENT_DISPATCH`) +
aynı snapshot'tan beslenen muhasebe fişi. Fasondan **DOĞRUDAN sevk** irsaliyesi
(`SUBCONTRACTOR_DIRECT_SHIP`) ayrı payload + ayrı renderer taşır → kapsam dışı ve bu ayarın
panel metninde YAZILI (kardeş yüzey, ayrı karar — 2026-09-03 "kapı takarken bu malın
çıktığı BAŞKA yol var mı" dersinin bilinçli cevabı: burada kapı değil GÖRÜNÜM eklendi,
yanlış ad basma riski yok). Muhasebe fişinin **Excel dışa aktarımı** (`accounting-export`)
da dokunulmadı — kendi kolon listesi olan ayrı bir sunum yüzeyi.

**Bekçi:** `scripts/test_shipment_doc_customer_name.ts` (37 kontrol) — **yedi negatif
sondayla** kırmızı verdiği doğrulandı (varsayılan rejim değişince 2 · fail-open kalkınca 1
· override kademesi atlanınca 5 · rejim sabitlenince 2 · başlık kaçırılmayınca 1 ·
`updateSchema` satırı silinince 3 · `docConfigSchema.labels` silinince 1); her sonda md5
ile birebir geri alındı. Electron `docRows.test.ts` +9 kontrol (iki sonda).

**Migration YOK · yeni izin kodu YOK · APK YOK.** Backend ÖNCE (eski panel bayrağı
göndermez → varsayılan `bizdeki`, geriye uyumlu).

---

## 2026-09-04 — Keşif kademeli PORT taraması: mDNS portu ilandan alıyordu, TARAMA tek porta kilitliydi [ÇEKİRDEK]

Kullanıcı isteği: *"test cihazında da mDNS ile gireceğim, elle girmek zorunlu değil. 5000
portunu bulacak. **bulamazsa farklı portları da arar.**"*

**ÖLÇÜM — açık tam olarak neredeydi.** Keşfin iki yolu var ve porta karşı davranışları
FARKLIYDI: mDNS ayağı portu **ilanın içinden** okur (`verify(h, hit.port || …)`) → 5000'i
zaten buluyordu; alt ağ taraması ise `scanSubnet(targets, DISCOVERY_DEFAULT_PORT, …)` ile
**tek porta SABİTLENMİŞTİ** → mDNS'in süzüldüğü ağda (IGMP snooping / client isolation)
sunucu 4000 dışında bir portta duruyorsa HİÇ bulunamıyordu. Eksik olan tek şey buydu.

**KADEMELİ TARAMA — "maliyet sıfır" kuralı tasarımın merkezinde.** Sıra: ① mDNS
(değişmedi, portu ilandan) → ② tarama YALNIZ varsayılan portta (bugünkü davranış, bugünkü
süre) → ③ **yalnız ①+② SIFIR aday döndürdüyse** yedek portlar SIRAYLA, aday bulan İLK
portta DURULARAK. Sunucu bulunduğu anda genişleme HİÇ koşmaz — ölçüldü: `/24` ağda tek
port 1,2 sn ↔ dört port 4,9 sn (253 host, 300 ms soket, eşzamanlılık 64, RFC 5737 ölü ağ).

**PORT LİSTESİ TEK KAYNAK ve varsayılan ONDAN TÜRER** (`DISCOVERY_PORTS = [4000, 5000,
3000, 8080]`, `DISCOVERY_DEFAULT_PORT = DISCOVERY_PORTS[0]`). İki ayrı gerçek olsaydı
arıza SESSİZ olurdu: mDNS portu ilandan aldığı için çalışmaya devam eder, yalnız tarama
yanlış porta bakar — saha tarifi *"bazen buluyor, bazen bulmuyor"*. Liste KISA tutulur,
maliyet host × port ile DOĞRUSAL büyür; üç yedeğin gerekçesi "kurulumu yapan kişi
varsayılanı değiştirdiyse hangi sayıyı yazar": 5000 (açıkça istendi) · 3000 (Node/Express
klasiği) · 8080 (alternatif HTTP).

**FAIL-OPEN SINIRI — yedek portta KİMLİK ZORUNLU** (`identityRequiredForPort`). Varsayılan
portta `/health` UP diyen KİMLİKSİZ sunucu meşru adaydır (kimlik ucu olmayan eski
backend); yedek portta DEĞİLDİR. `{"status":"UP"}` TeksERP'e özgü bir gövde değil (Spring
Boot Actuator birebir aynısını basar) ve yedek portlar kimlik ucuyla BİRLİKTE tarama
kapsamına girdi — orada "eski backend" vakası YOKTUR. Gevşetirsen 8080'de duran rastgele
bir web sunucusu operatöre "sunucu bulundu" diye gösterilir. Sıfır regresyon: tarama
eskiden zaten yalnız 4000'e bakıyordu, yani 5000'deki eski bir backend hiç bulunmuyordu.

**KEŞİF-İKİZ:** kademe kararı ortak `runStagedPortScan` (blok İÇİNDE, iki dosyada BİREBİR
metin); projeye özgü olan her şey blok DIŞINDA kaldı. Masaüstü TCP ön-taramasıyla, mobil
`fetch` ile besler.

**TABLET BÜTÇESİ masaüstünden DAR** (`SCAN_MAX_HOSTS` 512↔1022 ile aynı gerekçe): yedek
portlarda TAM SÜPÜRME yalnız İLK yedekte (5000) koşar, 3000/8080 yalnız öncelik listesini
(tipik sunucu oktetleri) görür. Her tam süpürme turu tablette ~10 sn ve "alışılmadık IP +
alışılmadık port" BİLEŞİK bir olasılıktır; 20 sn'lik bekleme karşılığında alınmaz.
Ayrıca mobilde yedek portlar **opt-in** (`extraPorts`, varsayılan KAPALI) ve YALNIZ
kullanıcının "Ağda Ara" dediği yolda açılır — arka plan kendi kendini onarma turu
(`serverReachability.trySelfHeal`) bunu AÇMAZ: orada aranan sunucu daha önce BİLİNEN bir
portta bulunmuştu (adresi zaten `preferredUrls`te), port avı bir KURULUM sorunudur,
kesinti sorunu değil.

**Aday PORTUNU taşır** — `baseUrl` `http://host:5000`; panel satırı `host:port · vX.Y.Z`
zaten basıyordu, `DiscoveryState.scan.ports` ile hangi portların gerçekten tarandığı da
tanı ekranlarında görünüyor.

**Bekçiler:** Electron `src/test/discovery-logic.test.ts` (44) + mobil
`services/discovery.service.test.ts` (15, gerçek uçtan uca `fetch` mock'u) +
`lib/discovery.contract.test.ts` (11). **Altı negatif sondayla** kırmızı verdiği
doğrulandı: maliyet-sıfır break'i kalkınca 3+2 · yedeklere hiç inilmeyince 11+18 · aday
portu taşımayınca 18 · yedek portta `/health` açılınca 9+1 · ikiz ayrışınca 11+9 ·
varsayılan port listenin ilki olmaktan çıkınca 11+9.

**Migration YOK · yeni izin kodu YOK · backend DEĞİŞMEDİ** (ilan tarafı `mdns-advertiser`
zaten portu ilan ediyordu). Sahaya inmesi için **yeni panel sürümü** + **tablet OTA**
gerekir; mobil taraf tamamen saf JS, yeni native modül/izin YOK.

---

## 2026-09-04 — [ÇEKİRDEK] Prisma'nın İKİ motoru var ve yalnız biri platformdan bağımsız

**Saha bulgusu (fabrika sunucusundaki oturum yakaladı, paketleyen oturum kaçırdı).**
macOS'ta üretilen fabrika paketine `@prisma/engines/` altında **yalnız
`schema-engine-darwin-arm64`** girmişti. `prisma migrate deploy` o ikiliyi
kullanır ve Windows'ta çalışmaz.

**Kök neden bir GENELLEME hatası.** Doğru olan cümle: *Prisma 7'nin **sorgu**
motoru WASM'dir* (`query_compiler_fast_bg.*.wasm` — pakette ölçüldü, hepsi
`.wasm`), dolayısıyla macOS'ta üretilen **istemci** Windows'ta çalışır. Bu cümle
**şema motoruna uzanmaz**: o hâlâ `schema-engine-<platform>` biçiminde NATIVE
bir ikilidir. "Prisma 7'de platform motoru yok" diye genellenince paketleme
kapıları bu boyutu hiç ölçmedi (kapılar dosya sayısı · `.prisma/client` ·
prisma CLI · Node tabanına bakıyordu).

⚠️ **ARIZANIN ÇIKACAĞI YER EN KÖTÜ YER:** `kur.ps1 [7/9]` — geri alınamaz eşik,
ve tek-sunucu geçiş modelinde fabrika o anda **zaten kapalıdır** (eski API 4.
adımda durduruldu).

⚠️ **PROVA BU ARIZAYI GÖRMEZ — ölçüldü.** Ev provasında `migrate deploy` geçti
çünkü Prisma eksik motoru o makinenin `%LOCALAPPDATA%` önbelleğinden sessizce
tamamladı (indirilen ikilinin hash'i canlıdakiyle bayt-bayt aynı çıktı). Yani
**yeşil prova "paket kendi kendine yeter" DEMEK DEĞİLDİR**; önbelleği boş ve
internetsiz bir sunucuda aynı paket düşerdi. Bu yüzden kapı **pakette ve
kurulumda**, provada değil.

**Kurulan üç kapı (üçü de negatif sondayla kırmızı gösterildi):**
1. `paketle.ps1` — `PRISMA_CLI_BINARY_TARGETS=windows` ile `prisma generate`
   (ölçüldü: `schema-engine-windows.exe`, 21 MB, `file` → *PE32+ executable, for
   MS Windows*), sonra **varlık** kapısı.
2. `paketle.ps1` — **MZ imza** kapısı: yarım/boş inen dosya da "var" görünür,
   ilk iki bayt `4D 5A` okunur.
3. `kur.ps1 [1/9]` — pakette Windows motoru yoksa **eşikten ÖNCE** durur ve
   bulduğu motorların adını yazar (eski paketle gelen kurulumu yakalar).

Ayrıca yabancı platform motorları paketten atılır: 24 MB ölü ağırlık ve "bu
paket hangi platform için" sorusunu bulanıklaştırıyordu.

**Ders (sınıf: "doğru cümlenin yanlış genellemesi"):** bir bileşenin bir
boyutta platformdan bağımsız olması, TÜM alt bileşenlerinin öyle olduğunu
göstermez. Yeni bir "bu artık platformdan bağımsız" notu yazarken soru: *bu
iddia hangi ikiliyi kapsıyor, ve aynı paketin başka hangi ikilileri var?*



## Kökten taşınan tam metinler (2026-09-05)

> Kök `CLAUDE.md`'nin Domain Kuralları / Ortak Konvansiyonlar / dizin bölümlerinde durup arşivde tam metni olmayan notlar. Kural özetleri `docs/kurallar/`da; burada gerekçe ve ölçüm korunur. Kaynak satırlar önceki kök sürümüne (git `6695afc2`) aittir.

### Çuval depo modeli (2026-07)
<sub>eski kök `CLAUDE.md:41-42` · bölüm: Üretim Akışı</sub>

- **Çuval depo modeli (2026-07):** Çuval depo nesnesidir — `Sack.customerId` opsiyonel, mühür/rezerv YOK; sevkiyat depodan çuval seçerek kurulur; `SackAllocation` sevk ANINDA yazılır, stok yalnız DISPATCH'te `SHIPPED` düşer (PLANNED tahsis sayılmaz); sipariş görünümü İstenen|Sevk|Açık. Tasarım: `docs/design/CUVAL-HAVUZU-TASARIM.md`.
    - ⚠️ Profil gerçeği — "rezerv YOK" bugünkü kurulumun seçimidir, kalıcı bir domain kuralı değil: rezervasyon **kendi append-only defteriyle** ayrıca kurulacak (`shipping.reservationEnabled`, karar #6) ve `SackAllocation`'a DOKUNULMAYACAK — o sevk muhasebesidir. Yeni rezervasyon yüzeyi yazmadan önce MODUL-BAYRAK-TASARIM karar #6 + §9. (Aynı şerh yukarıdaki Üretim Akışı bloğunun "mühür/rezerv YOK" satırı için de geçerlidir.)

### 2026-08-04 — Roll.foldType + entryReason + manuel top PARTİLİ
<sub>eski kök `CLAUDE.md:49-49` · bölüm: Üretim Akışı</sub>

- **2026-08-04 — Roll.foldType + entryReason + manuel top PARTİLİ:** Kat KALICI kolondur ve MİRAS ALINMAZ (kesimde SEÇİLEN yazılır; alan hiç gönderilmezse parent→plan fallback'i sözleşme boşluğudur, miras değil); kanoniklik ZORUNLU (`normalizeFoldType` — ham değer filtrede sessizce 0 satır döndürür). Sebep audit'ten değil KOLONDAN okunur (audit 6 ayda arşivlenir). Parti: tek açık→sormadan bağla · çok→400 `BATCH_REQUIRED` · hiç→null; `SCRAP` partiyi KAPATMAZ; sıra: payload tutarlılığı ÖNCE, parti SONRA.

### 2026-08-26 — Mobil uzaktan güncelleme, İNTERNET (VPS) kanalından
<sub>eski kök `CLAUDE.md:93-93` · bölüm: Üretim Akışı</sub>

- **2026-08-26 — Mobil uzaktan güncelleme, İNTERNET (VPS) kanalından:** Tabletler güncellemeyi Electron paneliyle AYNI sunucudan alır (`guncelleme.etkiliyazilim.com/adnansahin/mobil/` — yol düzeni `/<musteri>/<urun>/`, Electron ile AYNI konteyner ve standart; müşteri segmenti alt alan adı DEĞİL çünkü wildcard sertifika iki seviyeli adları kapsamıyor); **ERP bağlantısı fabrika ağında kalır** — iki kanal, her biri kendi tek kaynağından (`mobil/scripts/lib/feed.cjs` ↔ `EXPO_PUBLIC_API_URL`), hiçbiri diğerinden türetilmez. Mimariyi ÜÇ ölçüm belirledi: ① imza gövdenin HAM baytları üzerinden doğrulanır → **manifest yayın anında DONDURULUR**, üreten tek yer yayın script'i (`scripts/lib/manifest.mjs`), sunucu yalnız bayt servis eder (backend'in render eden kodu SİLİNDİ; LAN ikizi olarak statik servise indi) · ② istemci mükerrer indirmeyi ÜÇ katta kendisi engeller → statik nginx yeter, yeni konteyner YOK · ③ `runtimeVersion` filtresi SUNUCUNUN işi (istemci indirmede bakmaz, yanlış sürümü indirip SESSİZCE eler) → adres sürümü İÇERİR, her APK yalnız kendi paketini görür. **Kod imzalama AÇIK** (anahtar VPS'te DEĞİL; imza geçersizse tablet paketi reddeder) ve **APK arm64** (ölçüldü 113→49 MB). Isıran üçlü: `codesigning:configure` app.json'daki `updates.enabled`ı sessizce `false` yaptı · mühür eklentisi idempotent değildi (2. prebuild'i düşürdü) · "iki adres farklı" uyarısı kalıcı yanlış alarma dönüşecekti. Bekçiler: `test_mobile_update` (37, tek baytlık bozulma sondası dahil) · `update-feed-url.test` (7); nginx yapılandırması artık REPODA (`deploy/guncelleme-sunucusu/`) ve ⚠️ **uzun-cache kurallarında `add_header … always` YASAK** — `always` başlığı 404'e de ekler, Cloudflare o 404'ü bir hafta tutar (Electron'da 147 MB'lık paket sunucuda dururken adres 404 döndü); yayın script'i artık `?cb=` kalıbıyla bayat önbelleği tespit edip bağırıyor. Reçete `docs/ops/MOBIL-UZAKTAN-GUNCELLEME.md`; migration/izin YOK.

### 2026-09-04 — En yetkili hesap GÖRÜNÜR (P2'nin gizlilik kısmı geri alındı)
<sub>eski kök `CLAUDE.md:104-104` · bölüm: Üretim Akışı</sub>

- **2026-09-04 — En yetkili hesap GÖRÜNÜR (P2'nin gizlilik kısmı geri alındı):** Kullanıcı kararı — en yetkili kişi DB'den görevlendirilen GERÇEK bir kullanıcıdır; kullanıcı listesinde (masaüstü + tablet), audit'te (canlı + arşiv, liste + detay), üretim/audit karnelerinde ve cihaz detayında **gerçek adıyla** görünür. Gerekçe: gizlilik iz sürmeyi de imkânsız kılıyordu ve bir yetkinin kim tarafından kullanıldığı, o yetki EN GENİŞKEN en çok gerekir. Silinenler: `VISIBLE_USER`/`visibleUserWhere`/`VISIBLE_ACTOR`/`maskSystemActor`/`withMaskedActor`/`SYSTEM_ACTOR_*`/`SQL_VISIBLE_USER`/`SQL_ACTOR_*` ve `/users/:id*` 404 kapısı (`blockSystemAccountTarget`); ayar şifresi yönetim uçları **404 → 403** (gerekçe "403 varlığı doğrular" idi, varlık artık açık). **KORUNAN — kaldırılan şey GİZLEME, YETKİ DEĞİL:** `getEffectivePermissions → ["*"]`, modül anahtarı kilidi, ayar şifresi muafiyeti, `isSystemAccount` panelden ATANAMAZ (tek yazar `scripts/superadmin-olustur.ts`, `src/` DIŞINDA — sunucu paketine girmez), `*` körlüğü yasağı. ⚠️ **GÖRÜNÜRLÜK ≠ KİMLİK BİLGİSİNİ TESLİM ETMEK:** kaldırılan 404 kapısının bir işi obscurity DEĞİLDİ — `/users/:id/credentials` **düz 6 haneli PIN** döner ve `login-quick-pin` PIN'i TEK BAŞINA kimlik sayar; `admin:users`+`admin:settings` taşıyan biri (sahada DÖRT hesap) en yetkili kişinin kimliğine bürünür ve modül kilidi dahil her şey düşerdi → o ucun üstüne **dar bir 403 kapısı** kondu. ⚠️ Önek `router.use("/users/:id", verifyToken, requireAnyPermission(...))` **KALIR** (ilk yazımda 404 kapısıyla birlikte silinmişti; bekçi §M yakaladı — o blok gizlilikle ilgili değil, on birinci ucun kapısız doğmasını engelliyor). `isSystemAccount` artık `listUsers`/`getUserById` yanıtlarında: hesabın HİÇ `UserPermission` satırı yoktur (yetki kodda) → panel onu "0 yetki" gösteriyordu; Electron artık **"Tüm yetkiler"** rozeti çiziyor (liste · künye · ayak izi · dışa aktarım). Bekçi: `test_superadmin_hidden_single_source` SİLİNDİ → **`test_superadmin_visible`** (30, gizlemenin GERİ GELMEDİĞİNİ ölçer; negatif sonda kırmızı verdi; eski bekçinin `admin:*` muafiyeti ÖLÜYDÜ — dize yalnız bir yorumda geçiyor). `test_superadmin` §J + HTTP (5)/(6) tersine çevrildi (82/0); `test_settings_password` 404→403 (134/0). Migration YOK; backend + Electron birlikte, APK gerekmez (tablet aynı listeyi okur).

### 2026-09-03 — Süperadmin doğuşu P8 (`.env` yolu KALDIRILDI)
<sub>eski kök `CLAUDE.md:107-107` · bölüm: Üretim Akışı</sub>

- **2026-09-03 — Süperadmin doğuşu P8 (`.env` yolu KALDIRILDI):** Tek doğuş yolu `npm run superadmin:kur` (sunucuda interaktif; idempotent, `--rotate` ile tokenVersion++). İki yol iki sır yüzeyi demekti. **MEVCUT KULLANICI YÜKSELTİLMEZ** (harf varyantları dahil reddedilir; panelde düğme/API'de uç YOK — `admin:users` taşıyan herkesin kendini yükseltmesi olurdu). ⚠️ **FAIL-LOUD TTY KAPISI ZORUNLU**: script gerçek TTY olmadan ilk sorudan sonra SESSİZCE SONSUZA KADAR donuyordu (`readline` `terminal:false` boruyu tek chunk alıp yalnız ilk satırı teslim ediyor) — hesabın TEK doğuş yolunda sessiz kilitlenme, kurulumu tamamlanmamış bırakır. Boot job'u artık `SUPERADMIN_*` OKUMAZ, yalnız kilit defterini tazeler ve `.env`de kalan eski satırlar için uyarı basar (yalnız ANAHTAR ADI — o satırlar CANLI kimlik bilgisi olabilir). Çekirdek `provisionSuperadmin` SESSİZDİR (yazdırma interaktif katmanın işi; bekçi stdout'u 0 bayt diye ölçer).

### Phase 1
<sub>eski kök `CLAUDE.md:117-118` · bölüm: Domain Kuralları</sub>

- **Phase 1:** COM port / donanım entegrasyonları sadece simüle edilir — gerçek donanım kodu yazma.
    - ⚠️ Kural duruyor; ölçek notu: gerçek makine verisi geldiğinde de backend'e seri port/polling GİRMEZ — fabrika LAN'ında **ayrı bir toplayıcı ajan** okur ve API'den basar (tablet gibi bir istemci), tek-process invariantı korunur. Gerçek sürücü ilk dokuma müşterisinin sahasında pilotla gelir. bkz. MODUL-BAYRAK-TASARIM §8 (`tezgah.enabled`).

### ⚠️ PRODUCTION CANLI (gerçek fabrika, gerçek veri).
<sub>eski kök `CLAUDE.md:119-120` · bölüm: Domain Kuralları</sub>

- **⚠️ PRODUCTION CANLI (gerçek fabrika, gerçek veri).** Şema/migration/veri işlerinde **gerçek veriyi koru**: `migrate reset` / reseed / toplu `DELETE` **yasak**; migration'lar geri-alınamaz kabul edilir (rollback = yedekten restore). Toplu veri düzeltmesi yapan script **dry-run varsayılan** olur ve `--apply` öncesi etkilenecek her kaydı somut listeler.
    - ⚠️ Ölçek notu: "production" artık **tekil değildir** — kural kurulum sayısından bağımsız olarak HER canlı kurulum için geçerlidir. Şema/migration işinde ölçüt "bizim fabrika" değil *en eski canlı kurulumun verisi*dir; prova o kurulumun kendi dump'ı üstünde yapılır (kabul testi: dump restore → `migrate deploy` → bekçiler → profil boot). bkz. MODUL-BAYRAK-TASARIM §0.

### Şema tasarımında
<sub>eski kök `CLAUDE.md:121-121` · bölüm: Domain Kuralları</sub>

- **Şema tasarımında** yine uzun vadeli doğruluk için optimize et — **seed satırlarıyla** backwards compat derdine girme (seed yalnız ilk kurulumda koşar). Bu, canlı veriye dokunma izni DEĞİLDİR: ayrım "seed fixture'ı serbestçe değişir" ile "fabrikanın topları/siparişleri korunur" arasındadır.

### İş emri esnekliği
<sub>eski kök `CLAUDE.md:122-122` · bölüm: Domain Kuralları</sub>

- **İş emri esnekliği:** Bir iş emri birden fazla siparişe bağlanabilir veya hiçbir siparişe bağlı olmadan stok için üretilebilir.

### WO kapsamı = sadece üretim
<sub>eski kök `CLAUDE.md:123-123` · bölüm: Domain Kuralları</sub>

- **WO kapsamı = sadece üretim:** `WorkOrder` yalnızca üretimi (istasyonlar, kurşun/QC2, tambur) yönetir. Tartı / paket / sevkiyat ayrı bir domain'dir (`shipping.service.ts`) — WO'ya değil, depoya/çuvala bağlanır.

### WO kapatma = kapanış dispozisyonu (2026-07-30)
<sub>eski kök `CLAUDE.md:124-124` · bölüm: Domain Kuralları</sub>

- **WO kapatma = kapanış dispozisyonu (2026-07-30):** Manuel kapatma artık "işlemde top var" diye **reddetmez** — sektör pratiği (SAP TECO sonrası WIP dispozisyonu): kapatan kişi istasyonda kalan **her top için karar verir** ve karar sebebiyle kayda geçer. Altı karar: `STOCK` (ham stok) · `WAREHOUSE` (bitmiş depo) · `A1_STOCK` (2. kalite) · `SCRAP` (fire — mal vardı) · `CANCELLED` (hatalı kayıt — mal yoktu) · `TRANSFER` (yeni WO klonuna devret; kaynak WO `COMPLETED` kalır, `SUPERSEDED` OLMAZ). Kalite yalnız `WAREHOUSE`/`A1_STOCK`'ta ve **opsiyoneldir**; satılabilir statüde barkodsuz top barkod alır; `Roll.form`'a dokunulmaz. **Hard-block yalnız FASON** (`AT_SUBCONTRACTOR`/`RETURNED_FROM_SUBCONTRACTOR` ya da açık fason sevkine bağlı top) — mal fiziksel olarak dışarıda; ayrıca fason dönüşü top `STOCK`'a çekilemez. Kapsam **birebir** doğrulanır (tx içinde taze in-flight küme ≠ gönderilen liste → 400) ve dispozisyon varsa `workorder:write` **+ `roll:manual-adjust`** aranır. İz: movement `notes='WO_CLOSE_<ACTION>'` + audit `event='WO_CLOSE_DISPOSITION'` (`RollOperationType`'a yeni değer EKLENMEDİ). Tekil `rescueStuckRoll` ("Kurtar") davranışı değişmedi — hâlâ `WAREHOUSE`'a çeker.

### "Buraya geliş" ≠ "oluşturma" (2026-07-30, saha bulgusu)
<sub>eski kök `CLAUDE.md:125-125` · bölüm: Domain Kuralları</sub>

- **"Buraya geliş" ≠ "oluşturma" (2026-07-30, saha bulgusu):** Envanter sekmelerinde topun o statüye GELİŞ anı `createdAt` DEĞİLDİR — kurtarma, kapanış dispozisyonu, fason kabulü ve finalize haftalar önce yaratılmış bir topu bugün depoya alır. `createdAt` sıralı + sayfalı listede o top binlerce satırın altına düşer ve operatör **"depoya gitmedi" sanır** (gerçek olay: 700/1200/800 m toplar 5280 satırlık Bitmiş Depo listesinin 5271-5279. sırasındaydı; statüleri doğruydu). Bu yüzden **Ham Stok DIŞINDAKİ tüm sekmeler `updatedAt desc` sıralar** (`rollTabDefaultSortBy`; Ham Stok'ta oluşturma = KK1 girişi olduğu için `createdAt` doğrudur). Destek index: `Roll @@index([status, updatedAt])` (migration `20260730170000`; ölçüm 205ms → 21ms). Listede **TEK tarih kolonu** görünür ve sıralanan kolonun aynısıdır (envanter listesi standardı): Ham Stok'ta "Giriş" (`createdAt`), diğer sekmelerde "Son İşlem" (`updatedAt`) — ikisi birlikte gösterilmez, operatörü karıştırır; diğeri "Sütunlar" menüsünden açılır ve detay panelinde zaten yazılıdır. **`updatedAt` gerçek "hareket" DEĞİL** (etiket yeniden basımı / not düzenlemesi de günceller) — bu yüzden kolon adı "Son Hareket" değil **"Son İşlem"**. Gerçek stok yaşlandırma / FIFO ("en eski topu önce sevk et") istenirse yalnız statü geçişlerinde damgalanan ayrı bir kolon gerekir; `updatedAt` bunun yerine kullanılmamalı. **Aynı ilke metrajda da geçerli:** liste **yalnız tek sayı** basar — topun ŞU ANKİ metrajı. Giriş metrajı da "kesik/eksilmiş" işareti de listede **GÖSTERİLMEZ** (2026-07-30 saha geri bildirimi: eski `700 / 800` gösterimi "hangisi elimde, 800 hedef mi?" diye okunuyordu; işaretli varyantı da karıştırdı). Giriş metrajı + doluluk yalnız **detay panelinde** ("Başlangıç: N m"). Kural: liste yüzeyi = operatörün anlık kararı için tek okunur değer; izlenebilirlik verisi detay yüzeyinde. Yeni bir "topu şu statüye çek" yolu eklerken sıralama sözleşmesini hatırla — statüyü doğru yazmak yetmez, operatörün onu BULABİLMESİ gerekir.

### Top düzeltme = TEK sözleşme (2026-07-30)
<sub>eski kök `CLAUDE.md:126-126` · bölüm: Domain Kuralları</sub>

- **Top düzeltme = TEK sözleşme (2026-07-30):** Eskiden üç buton vardı ("Etiket Bas/Önizle", "Yeniden Etiketle/Düzenle", "Manuel Düzelt") ve son ikisi **aynı** `applyManualProperties` motorunu iki farklı kapsamla çağırıyordu; kapsamı belirleyen şey **`Boolean(reason)`** idi. Bu iki tuhaflık üretiyordu: süpervizör istasyondaki topun rengini düzeltebiliyor ama **metrajını** düzeltemiyordu, ve kapsamı genişleten şey yetki değil "sebep alanının dolu olması"ydı (koruma örtük — yalnız relabel Zod şemasının `reason`'ı elemesi sayesinde sömürülemezdi). **Yeni kurgu:** kapsam **topun DURUMUNDAN** çözülür — `ALWAYS_BLOCKED` (fason/kartela/emekli/sevk) her yolla red; `FREE_STOCK` (`STOCK`/`WAREHOUSE`/`A1_STOCK`) sebep opsiyonel + ek yetki yok (depo/mobil bozulmaz); gerisi (örn. `IN_PRODUCTION`) **sebep ZORUNLU + `roll:manual-adjust`** (F221 deseni: `opts.permissions` verilmezse enforcement atlanır — dahili çağrı). Audit ayrımı korunur (`reason` → `MANUAL_ATTRIBUTE`, yoksa `RELABEL`; tablo `ROLL_MANUAL_OVERRIDE`). **Arayüz iki butona indi:** *veriyi mi değiştiriyorum, kâğıt mı basıyorum* çizgisi — **"Düzelt"** (renk/metraj/kalite/en/özellik/kartelalık + koşullu sebep; `RollEditDialog`, **rollId** ile açılır ki barkodsuz açık kumaş da düzeltilebilsin → `GET /api/rolls/:id/relabel-context`) ve **"Etiket"** (önizle + bas + **farklı müşteri için bas**; `PrintForCustomerCard` buraya taşındı). `RelabelDialog` ve `ManualAttributesDialog` **silindi**. Referans test: `scripts/test_roll_edit_unified.ts`.

### Manuel taşıma = saha sürekliliği (2026-07-30)
<sub>eski kök `CLAUDE.md:127-127` · bölüm: Domain Kuralları</sub>

- **Manuel taşıma = saha sürekliliği (2026-07-30):** "Konumu Düzelt" topu `IN_PRODUCTION` + `currentStepId=hedef` bırakır, hedef adımı `ACTIVE` yapar, `COMPLETED` WO'yu `IN_PROGRESS`'e diriltip kartı yeniden aktifleştirir — böylece saha personeli kaldığı yerden devam eder. **Fason adımına taşıma `AT_SUBCONTRACTOR` YAPMAZ:** mal içeride üretimde bekler, çıkış ayrıca **Fason Sevk** ile yapılır (kabul doğrudan yapılamaz; önizleme bunu uyarı ile söyler). Fason dönüşü top (`entrySource=SUBCONTRACTOR_RETURN`) geri boyahaneye alınıp **yeniden sevk+kabul edilebilir** — ek engel yok. Geri taşımada hedef-sonrası kalite/kurşun kararları VOID olur (grade → Belirsiz), hayalet movement'lar silinir, `SKIPPED` adımlar `PENDING`'e açılır. **`CANCELLED`/`SUPERSEDED` WO'da taşıma REDDEDİLİR** (409 + önizlemede `woBlocked`): iptalde kartlar `VOIDED` olduğu ve `ensureWorkOrderInProgress` yalnız `PLANNED`'ı dirilttiği için taşınan top "canlı ama kimsenin okutamadığı" çıkmaza düşerdi (kart okutma + Tambur finalize guard'ları reddeder). Doğru yol: topu yeni bir iş emrine bağlamak. Tek kaynak: `workorder-manual-move.service.manualMoveWoBlockReason`.

### Renk istasyon bazlı KISIT DEĞİL (2026-08-02)
<sub>eski kök `CLAUDE.md:128-128` · bölüm: Domain Kuralları</sub>

- **Renk istasyon bazlı KISIT DEĞİL (2026-08-02):** Boyahane fiziksel olarak her rengi boyar — renk bir reçetedir, makine kısıtı değil. Rota adımının renk seçicisi **tüm aktif renk kataloğunu** gösterir; yeni tanımlanan renk hiçbir yere işaretlenmeden anında kullanılabilir. `StationColor` tablosu **deprecated** (satırları duruyor, okuyan kod yok). Sebep: kısıt yalnız panelde yaşıyordu — backend zaten bu tabloya hiç bakmıyordu (WO doğrulaması `Item.allowedColors` + `SubcontractorCategory.appliesColor`, fason kabul `wo.targetColorId`) — ve yeni renk hiçbir istasyonun listesinde olmadığı için rota adımında GÖRÜNMÜYORDU (sahada 58 aktif renkten 8'i tam bu durumdaydı). Yan düzeltme: **renk kilidi** artık `requiredCategory.appliesColor` ile çözülür; eski `StationColor` kaynağıyla, hedef renk hiçbir listede değilse boya adımı tamamlansa bile renk kilitlenmiyordu. "Renk veren adım var mı" sorusunun **tek kaynağı `appliesColor`** — buraya ikinci bir renk filtresi ekleme. `setCapabilities` renk tarafına yalnız `colorIds` **açıkça** gönderilirse dokunur (`[]` hepsini siler, alan yokken dokunmaz). Bekçiler: `scripts/test_helpers.ts` (kilit) + `scripts/test_station_capability.ts` (8b). **Özellik (`StationProperty`) bu kararın DIŞINDA** — orada istasyon yeteneği gerçek bir kısıt ve ayrıca "buradan geçen top bunu otomatik kazanır" işini de görür (`copyStationCapabilitiesToRoll`).

### Özellik istasyon kısıtı KALIR, ama BOŞ DOĞAMAZ (2026-08-02)
<sub>eski kök `CLAUDE.md:129-129` · bölüm: Domain Kuralları</sub>

- **Özellik istasyon kısıtı KALIR, ama BOŞ DOĞAMAZ (2026-08-02):** Renkten farklı olarak `StationProperty` gerçek bir proses kısıtıdır — boyahane zımpara yapamaz, o yüzden kaldırılmadı. Kaldırılan şey kısıtın **boş doğması**: yeni `FabricProperty` artık **`stationIds` ZORUNLU** olarak yaratılır ve bağ aynı insert'te kurulur (`nestedCreateFields`) — iki ayrı yazım olsaydı ikincisi patlayınca tam da önlenmek istenen bağsız kayıt kalırdı. Sebep saha vakası: `ZIMPARALI` 16 Tem'de tanımlandı, hiçbir istasyonun listesine girmedi, iki hafta boyunca **0 iş emri / 0 top** — çünkü panelde özellik seçmenin TEK yolu rota adımındaki istasyon chip'leri (zengin `TargetPropertyPicker` hiçbir yerden import edilmiyordu, **silindi**). `update`'te `stationIds` verilirse replace, verilmezse bağa DOKUNULMAZ (ad düzenlemesi bağı silmesin); boş dizi her iki yolda da 400. **`create`/`replace` asimetrisi kapatıldı** — özellik-başına rota kapsaması eskiden yalnız edit'te vardı, yani API'den ZIMPARALI hedefli WO **açılabiliyor** ama aynı WO'ya sonradan **eklenemiyordu** (409). Kategori kontrolü ("özellik veren adım var mı") ile bu kontrol ("ŞU özelliği veren adım var mı") farklı sorulardır; ikisi de koşar. Rota adımındaki "Yeni özellik tanımla" istasyonu bağlamdan bilir → özellik bağlı doğar ve anında seçili gelir. Ayrıca "Bu istasyon renk/özellik uygulamaz" yalanı ayrıştırıldı: *uygulayamaz* ile *yetenek listesi boş* artık ayrı cümleler. **`StationProperty` İKİ İŞ yapar** (planlama filtresi + `copyStationCapabilitiesToRoll` ile otomatik uygulama) — ayrımı `schema.prisma`'daki nota bakmadan bu tabloya satır ekleme. Bekçi: `scripts/test_property_station_binding.ts` (negatif sondayla kırmızı verdiği doğrulandı).

### Belge tasarımı ayrı bir yetkidir, sistem yönetimi DEĞİL (2026-08-05)
<sub>eski kök `CLAUDE.md:130-134` · bölüm: Domain Kuralları</sub>

- **Belge tasarımı ayrı bir yetkidir, sistem yönetimi DEĞİL (2026-08-05):** Tanımlar → Çıktılar altındaki dört ekran (**Belge Şablonları · Refakat Kartı · Refakat Kartı Şablonları · Serbest Belgeler**) `admin:settings`ten ayrıldı → yeni çift **`document-template:read` / `document-template:write`** (kategori **web**, yani `hasAdminAccess` saymaz: taşıyan kişi "Yönetim" menüsünü ve Sistem hub'ını GÖRMEZ). Gerekçe `settings:workstation` ile aynı: bu ekranlar baskı ÇIKTISININ görünümünü belirler; şablonu düzenleyen büro personeline oturum politikasını, yedek saatini, cihaz onayını ve log arşivini açmak zorunda kalmamak için. **Etiketler kartı bu kapsamın DIŞINDA** — o zaten `label-template:read/write` taşıyor (kartın kendisi hâlâ `station:read` ile süzülüyor; bilinen hiza sorunu).
    - **`admin:settings` DÖRT EKRANI DA AÇMAYA DEVAM EDER** ve kümelerden düşürülmemeli: boot uzlaştırması yeni izin satırını DB'ye getirir ama **kimseye ATAMAZ** (*katalog koda, atama panele*). Sıkı ayrım, deploy anında admin dahil herkesi dışarıda bırakırdı. Kümeler tek kaynakta: `Teks-Erp/src/constants/document-design.ts`.
    - **READ kümesi WRITE kodunu da içerir** — yazabilen okuyabilir. `label-template:read/write` çiftinde bu yapılmamıştı ve orada gerçek bir tuzak var: panelden yalnız "düzenleme" kutusunu işaretleyen admin, ekranı **hiç açamayan** bir kullanıcı üretir ve sebebi hiçbir yerde yazmaz. Salt-okuma gerçek: ekran + canlı önizleme çalışır, Kaydet kapalıdır, stüdyoda yazma aksiyonları **çizilmez** (gri buton olmayan bir yolu vaat eder).
    - ⚠️ **`PATCH /api/feature-flags` guard'ı ANAHTAR-KAPSAMLIDIR — düz OR'a çevirme.** O uç sistemin TÜM ayarlarını taşır (oturum ömrü, yedek saati, kk1 tuzağı…) ama Belge Şablonları + Refakat Kartı da oraya yazar. Kural: gövde **yalnız** `documentsConfig`/`travelerCardConfig` taşıyorsa dar izin yeter; tek yabancı anahtar (ya da boş gövde) → `admin:settings`. FAIL-CLOSED. Küme bilerek dar: `companyName`/`companyLetterhead`/belge logosu firmanın **kimliğidir**, şablon değil — ve onları yazan ekran zaten `admin:settings` arkasında. Yeni anahtar eklerken soru "belge ekranında görünüyor mu" değil, **"yanlış girilirse etkisi belge çıktısıyla SINIRLI mı"**.
    - **Kart ile route AYNI listeyi taşımalı** (`tile-config.permissionAny` ↔ `content-routes.requireAnyPermission`) — ayrışırsa kullanıcı kartı görür, tıklar, `/forbidden`'a düşer. Electron backend'i import edemez, listeyi `Electron/src/lib/permissions.ts`te **aynalar**; bekçi ikisinin birebirliğini mekanik doğrular. Bekçi: `scripts/test_document_template_permission.ts` (81 kontrol; **üç negatif sondayla** kırmızı verdiği doğrulandı — guard düz OR'a çevrilince 7, `admin:settings` READ'ten düşünce 4, kart/route hizası bozulunca 1). ⚠️ İzin DB'ye uzlaştırmayla gelir, **kullanıcılara atama elle yapılır**.

### Şube bazlı planlama
<sub>eski kök `CLAUDE.md:135-135` · bölüm: Domain Kuralları</sub>

- **Şube bazlı planlama:** `Order.branchId` opsiyonel (eski kayıtlar `null`). Yeni siparişler tek bir şubeye yönlendirilir.

### Refakat Kartı (Traveler Card)
<sub>eski kök `CLAUDE.md:136-136` · bölüm: Domain Kuralları</sub>

- **Refakat Kartı (Traveler Card):** İş emri **açılışında** doğan barkodlu kart (2026-07-14 "kart iş emriyle doğar"; bir WO = tek kart, `TravelerCard.workOrderId @unique`, karekod = İş Emri No). Fiziksel olarak malla birlikte hareket eder ve okutulduğunda istasyon süreçlerini tetikler. Parti (Batch) yeni kart üretmez.

### Refakat kartı = A5 varsayılan + parti bloğu CANLI (2026-08-03)
<sub>eski kök `CLAUDE.md:137-143` · bölüm: Domain Kuralları</sub>

- **Refakat kartı = A5 varsayılan + parti bloğu CANLI (2026-08-03):** Kart **A5** basılır (`DEFAULT_TRAVELER_CARD_CONFIG.pageSize`); A4 panelden ya da baskı diyaloğundan seçilir. Sayfaya bağlı HER ölçü (yazı boyu, QR, operasyon satır yüksekliği, sütun genişlikleri) tek kaynakta: **`document-render/traveler-card.density.ts`**. Tek `transform: scale()` yerine sayısal profil, çünkü **iki farklı oran** gerekiyor — genişlikler ~0.68 (A5 yazı alanı 132mm ↔ A4 194mm, geometrik zorunluluk), yazı boyları ~0.85 (okunabilirlik tabanı; 0.68 uygulansaydı taban 6.5px olurdu). A4 sütunu eski sabitlerin **birebir aynısı**, çıktı bayt-bayt korundu.
    - ⚠️ Profil gerçeği — A5 **varsayılanı ve doluluk ölçümü** (WO max 3 adım / 1 sipariş / 2 parti → A5'te %75) bu fabrikanın verisinden çıktı. Sayfa boyutu bir kurulum ayarıdır (`DEFAULT_TRAVELER_CARD_CONFIG.pageSize` + panel + baskı başına ezme); daha çok adım/sipariş/parti taşıyan bir kurulumda varsayılan A4 seçilebilir — kod değişikliği değil profil kararı. Yoğunluk profili (`traveler-card.density.ts`) ve donmuş belge kuralı ÇEKİRDEK kalır.
    - **İki katmanın varsayılanı bilerek FARKLI, tekleştirme:** `resolveConfigPageSize` (ayar) → **A5**; `resolveFrozenPageSize` (donmuş snapshot, alan yoksa) → **A4**. Alanı taşımayan eski bir kart o gün A4 basılmış bir belgedir; varsayılan değişti diye geçmiş belgeyi yeniden ölçeklemek donmuş-belge kuralını bozar.
    - **Partiler snapshot'ta DEĞİL, baskı anında canlı çözülür** (`resolveLiveBatches`, meta ile geçer). Sebep zamanlama: kart WO **açılışında** donar, parti `attachRolls`'ta doğar — Hızlı İş Emri'nde sıra create → attach → dispatch. Snapshot'a yazılsaydı parti kartta **her zaman boş** çıkardı, yani özelliğin en çok istendiği akışta hiç işe yaramazdı. Üç süzgeç: `mergedIntoId != null` parti tarihçedir (basılmaz), sayım/metraj `K18_DEAD_STATUSES`'i dışlar, sevk yalnız iptal edilmemişlerden (en yenisi + öncekiler `(+N)`). "Sevk rakamı brüttür / donmuş belgeden okunur" kuralı **buraya uzanmaz** — o kural para/irsaliye yüzeyine aittir; kart malla gezen operasyon kâğıdıdır.
    - **`GET /traveler-cards/:id/html?pageSize=A4|A5` TEK SEFERLİKTİR** — kalıcı ayarı **ve** kartın donmuş config'ini ezer, hiçbir yere yazılmaz, yeni versiyon doğurmaz (`?rowNotes=1` ile aynı sözleşme). Meşruiyeti: sayfa boyutu **sunum** kararıdır, belgenin içeriği değil. Geçersiz değer sessizce yok sayılır — baskı yolunu yazım hatası yüzünden 400'e düşürmek sahayı kâğıtsız bırakır.
    - **Blok kapalıyken tek bayt basılmaz** (tablo da CSS de koşullu emit) — A4 parmak izi bu sayede korunuyor; `${…}`i kendi satırına koymak boş satır bırakıp parmak izini bozar. Yeni bölüm eklerken aynı deseni uygula. Bekçi: `scripts/test_traveler_card_a5_batches.ts` (7 negatif sondayla kırmızı verdiği doğrulandı).
    - **Ölçüm (gerçek fabrika verisi, 2026-08-03):** WO'ların max'ı 3 adım / 1 sipariş / 2 parti → en ağır kart A5'te **%75 doluluk**. Taşma 8 adım + 6 sipariş + 6 partide başlar (A4 de 12/10/10'da taşar) — bu yüzden Belge Şablonu önizlemesinde **sayfa-sığma göstergesi** var: ayarı yapan kişi kaydetmeden taşmayı görür.

### Refakat kartı: PLAN CANLI, SUNUM DONMUŞ — otomatik revizyon (2026-08-05)
<sub>eski kök `CLAUDE.md:144-151` · bölüm: Domain Kuralları</sub>

- **Refakat kartı: PLAN CANLI, SUNUM DONMUŞ — otomatik revizyon (2026-08-05):** Saha sorusu: *"önizlemedeki bant 'basılı kopya güncel değil' diyor; ben eski hâli mi görüyorum, revize etme nerede?"* Cevap iki parçalıydı ve ikinci parçası **gerçek bir açıktı**: kartın partileri baskı anında canlı çözülüyordu (o taraf güncel), ama İÇERİK kartın doğuşunda donan snapshot'tan basılıyordu. Yani iş emri düzenlemesiyle (`update`/`replace`/`updateTargetProperties`/`updateStepPlanning`) bayatlayan kartta operatör **eski planı** basıyor, `print-event` bayrağı temizliyor ve kâğıt sessizce yanlış kalıyordu — üstelik snapshot'ı tazeleyen `reprint` ucu **hiçbir istemciden çağrılmıyordu** (arayüzde revizyon düğmesi yoktu).
    - **Sektör dayanağı:** kart kontrollü belgedir (ISO 9001 §7.5.3 — geçersiz kopyanın istemsiz kullanımı önlenmeli) ve sahaya inen kâğıt **yürürlükteki planı** göstermelidir. SAP PP karşılığı *değişiklik baskısı* (`Änderungsdruck`): sipariş basıldıktan sonra değişirse yeni baskı siparişin **güncel** hâlini basar, donmuş kopyayı değil. Bizde de artık öyle: ACTIVE kartın önizlemesi + baskısı iş emrinin güncel hâlinden üretilir, `print-event` **basılan planı kaydeder** ve içerik gerçekten değiştiyse **`version++`** (otomatik revizyon). Aynı içeriğin ikinci kopyası revizyon DEĞİLDİR (sürüm şişmez).
    - **AYRIM: içerik ≠ sunum — ama ikisi de CANLI (2026-08-06, "şablon karta donar" kuralı KALDIRILDI).** Ayrım yalnız **sürüm** hesabındadır: revizyon karşılaştırması (`planKey`) `config`/`template`'i **dışlar**, çünkü letterhead/punto düzenlemesi sayılsaydı bir sonraki baskıda sahadaki HER kart sürüm atlar ve numara "içerik değişti" anlamını yitirirdi (aynı asimetri `contentDirty` tarafında zaten var — şablon düzenlemesi kartı bayat İŞARETLEMEZ). **Ama revizyon olmayan bir şeyi dondurmanın işi yoktur:** eskiden sunum kartta donuyordu ve tasarımı değiştirme sebebi genelde *"sahada okunmuyor"* olduğu için düzeltme, tam da düzeltilmesi gereken kâğıtlara ulaşmıyordu (ölçüm 2026-08-06: 30 aktif kartın 11'i bir haftadan eski → haftalarca eski tasarımla basmaya devam ederlerdi; `reprint` ucunun da hiçbir istemcisi yoktu, yani çıkış yolu hiç yoktu). Artık **şablon + sayfa/config her baskıda güncel çözülür**; sayfa boyutu da dahildir (baskı başına A4/A5 ezmesi diyalogda duruyor). Geçersiz kartın (VOIDED/COMPLETED) **İÇERİĞİ** yine donmuş kalır — sunumu güncel gelir, çünkü o belgenin kaydı değil kâğıda nasıl çizildiğidir. ⚠️ Bu, eski `test_traveler_template` **E2** kuralının bilinçli tersidir; geri almadan önce yukarıdaki gerekçeyi çürüt.
    - **TEK KARAR NOKTASI `resolvePrintPlan`** — önizleme, baskı ve versiyon numarası ondan beslenir. Ayrıştırılırsa kâğıda "v2" basılır, DB'ye "v3" yazılır ve revizyon numarası içeriği tanımlamaz olur (kontrolün tamamı bu eşitliğe dayanıyor). Bu yüzden **önizlemedeki `v` numarası kartın mevcut sürümü değil, BU BASKININ alacağı sürümdür**; GET yan etkisizdir, önizleyip kapatan kimse bir şey yazmaz.
    - **Üç sınır, üçü de bekçide:** ① **ACTIVE olmayan kart** (VOIDED/COMPLETED/REPRINTED) hiç revize edilmez — elde olan tarihsel kopyadır, bugünkü planla tazelemek belgeyi geçmişe dönük değiştirmek olurdu; ② **iş emri okunamazsa** eldeki snapshot'a düşülür (baskı yolunu düşürmek, biraz eski kâğıt basmaktan kötüdür); ③ **`snapshot` NULL olan eski kartta sürüm ARTMAZ** — karşılaştırılacak önceki içerik yok, sadece ilk kayıt oluşur.
    - ⚠️ **`buildPlan` dizileri deterministik sıralar** (`targetProperties`, `orderLinks` → `orderBy`). Prisma `orderBy`siz ilişkide satır sırasını garanti etmez; sıra oynadığında `planKey` "içerik değişti" der ve **hiç değişmemiş kart her baskıda sürüm atlar**. `planKey` ayrıca anahtar sırasından bağımsızdır — düz `JSON.stringify` aynı tuzağa düşerdi.
    - ⚠️ **`buildSnapshot` baskı yolunda ÇAĞRILMAZ** (sunumu yeniden çözer → donmuş şablon sessizce değişir). O yalnız kart doğuşu ve `reprint` içindir, yani sunumun MEŞRUEN tazelendiği iki nokta.
    - **Migration YOK, izin YOK, APK YOK** — kolon/sözleşme değişmedi. Metin güncellemeleri dışında istemci davranışı aynı; **backend + Electron aynı pencerede** gitmeli (eski panel metni "önizleme günceldir" derdi, artık doğru ama eksik anlatırdı). Bekçiler: `scripts/test_traveler_card_stale.ts` §6 (26 kontrol) + `test_traveler_template.ts` E2/E4 (30 kontrol) — **dört negatif sondayla** kırmızı verdiği doğrulandı: plan canlı okunmayınca 7, sürüm bumpı kalkınca 4, sunum baskıda taşınırsa (eski donmuş davranış) `stale` 1 + `template` 1. ⚠️ Sunum kontrolü ilk hâlinde **kördü** — fixture'da şablon satırı yok, iki yol da aynı config'i üretiyordu; kartın kayıtlı sayfa boyutu bilerek tersine çevrilerek kırılabilir hâle getirildi. Sonda yazarken `dress()` yardımcısını "base varsa onu koru" diye değiştirmek de **etkisiz sondadır** (base zaten canlı config taşır) — donmuş davranışı `stored?.config ?? …` ile ACTIVE dalında kur.

### Refakat kartı ŞABLONU = ÜÇ KADEME (2026-08-03, Faz 2)
<sub>eski kök `CLAUDE.md:152-160` · bölüm: Domain Kuralları</sub>

- **Refakat kartı ŞABLONU = ÜÇ KADEME (2026-08-03, Faz 2):** `TravelerCardTemplate` — `BUILTIN` (acemi: hiç dokunmaz) · `SECTIONS` (orta: Şablon Stüdyosu'nda bölüm sırası/aç-kapa) · `RAW_HTML` (uzman: kartın TÜM HTML'ini kendi yazar, yerleşik CSS yüklenmez). Çözüm zinciri **açık seçim > varsayılan şablon > sistem ayarı**; tablo boşken kart Faz 2 öncesiyle **birebir aynı** basılır (şablon oluşturmak aktif bir karardır). Tek giriş noktası `renderTravelerCard`.
    - **Şablon KARTA DONAR** (`snapshot.template`): basılmış kart, şablon sonradan düzenlense de aynı çıkar; `reprint` yeni şablonu alır. "Şablonu değiştirdim, sahadaki kartlar niye değişmedi?" sorusunun cevabı tasarım gereği **yeniden bas**tır. Şablon silmek geçmiş kartları etkilemez.
    - **FAIL-CLOSED çözüm:** seçili şablon silinmiş/pasifse baskı **404** verir, sessizce yerleşiğe SAPMAZ (çuval etiketi emsali). İstisna DEĞİL: gövdesi boş bir `RAW_HTML` şablonu yerleşiğe düşer — orada fail-closed'ın karşılığı "boş kâğıt basmak" olurdu.
    - **Uzman modu bir ŞABLON DİLİ DEĞİL, metin ikamesidir:** `{{alan}}` + `{{#liste}}…{{/liste}}`. Koşul/ifade/JS **kasıtlı olarak yok** — ihtiyaç doğarsa çözüm yeni sözdizimi değil **katalogda yeni alan**dır (`config/traveler-card-fields.ts`; değer üretimi bizde kalır). Bilinmeyen anahtar **boş basar, baskıyı durdurmaz** (vardiya bir yazım hatası yüzünden durmasın); stüdyo bunu sarı uyarıyla söyler.
    - **GÜVENLİK İKİ KATMANLI, ikisi de gerekli:** ① `sanitizeTemplateHtml` ŞABLONDAN aktif içeriği ayıklar (script/`on*`/`javascript:`/gömülü çerçeve) — **hem kayıtta hem render'da** koşar (render tarafı, elle DB düzenlemesi / geri yükleme gibi kayıt kapısını atlayan yollara karşı); ② veri değerleri gömülürken kaçırılır (yalnız sunucu-üretimi QR SVG'si ham). Aşırı kesme güvenli yöndür. Dış `<img>`/`<a>` **bilerek serbest** (kart bir belgedir, kum havuzu değil).
    - **⚠️ Baskı iframe'leri artık `sandbox`lı** (`Electron/src/lib/print.ts` + önizlemeler). Ölçüldü: sandbox'sız iframe'de gömülü script Electron renderer'ında **çalışıyordu**. `allow-same-origin allow-modals` ikisi de load-bearing (`doc.write` + `win.print()`); `allow-scripts` YOK. Kırpma.
    - **Bölüm listesi genişletilebilir:** `resolveSectionOrder` tanınmayan anahtarı atar ve **eksik bölümü SONA ekler** — yoksa bugün kaydedilmiş bir sıra, yarın eklenen bölümü sessizce yutardı. Yeni bölüm eklerken `traveler-card.sections.ts` + Electron `TravelerCardStudio/types.ts` birlikte güncellenir (Electron backend'i import edemez — mobil `permissions.ts` ile aynı durum; alan kataloğu için de aynısı geçerli).
    - **İzin AÇILMADI:** stüdyo `admin:settings` ile korunur (Belge Şablonları ile aynı kişi). Yeni izin kodu, sahada atanması unutulabilecek bir adım daha demekti (2026-08-01 kurşun bypass vakası). Ayrı "şablon tasarımcısı" rolü gerçekten doğarsa o zaman ayrılır.
    - Bekçi: `scripts/test_traveler_template.ts` (29 kontrol; 5 negatif sondayla kırmızı verdiği doğrulandı). Şema-dışı partial unique `traveler_card_templates_isDefault_key` **`WHERE isDefault=true`** olmak ZORUNDA — düz unique olsaydı sistemde toplam iki şablon tutulabilirdi; `test_db_invariants` envanterinde kayıtlı.

### İş Emri No ≠ Parti (2026-07-13)
<sub>eski kök `CLAUDE.md:161-169` · bölüm: Domain Kuralları</sub>

- **İş Emri No ≠ Parti (2026-07-13):** `WorkOrder.workOrderNumber` (İE+GGAAYY+NNNN) üretim emridir; `Batch` üretime aynı anda giren top grubudur (bir WO N parti içerir). ⚠️ Parti no'nun BİÇİMİ rejime bağlıdır ve **varsayılan biçim `P01…P99` (kısa, dönen, benzersiz DEĞİL)** — bkz. hemen aşağıdaki madde; `P+GGAAYY+SIRA` yalnız bayrak kapalıyken üretilir. Eski "dal"/`batchSplitId` kavramı kalktı. Tasarım: `docs/design/PARTI-MODELI-TASARIM.md`.
    - **PARTİ NO KISA ve DÖNEN — `P01…P99`, benzersiz DEĞİL (2026-08-05, kullanıcı kararı):** Bayrak **`batch.shortNumberEnabled`, varsayılan AÇIK**. Parti no artık tarih taşımaz: `P01`'den başlar, `P99`'a gider, sonra **`P01`'e sarar** — fabrikadaki numaralı **fiziksel parti plakası** düzeninin birebir karşılığı. Sarma **KÖRLEMESİNE**: numaranın o an başka bir canlı partide olup olmadığına BAKILMAZ (istendi ve açıkça kabul edildi; "boştaki numarayı bul" alternatifi *"99'u da doluysa ne olacak"* sorusuyla üretimi durdurabilecek bir hata yolu açardı). Bayrak **KAPALI** → aşağıdaki eski günlük kalıba düşülür, birebir.
        - ⚠️ Profil gerçeği — `P01…P99` körlemesine sarma, adnansahin'in **fiziksel parti plakası** setinin karşılığıdır ve bir bayrağa bağlıdır (`batch.shortNumberEnabled`, bugün AÇIK). Plakasız/uzun-parti çalışan bir kurulumda bayrak kapalı (günlük kalıp) profille kurulabilir. Ayar değerini **kurulum profili** yazar; koddaki default yalnız satır-yok sigortasıdır. Sarmayı mümkün kılan invariantlar (kimlik = `Batch.id`, `orderBy: batchNumber` YASAK, advisory kilit 8022) her iki rejimde de ÇEKİRDEK.
        - ⚠️ **`batches.batchNumber` üzerindeki `@unique` KALDIRILDI** (migration `20260805120000_batch_short_number`). Partinin kimliği artık **yalnız `Batch.id`**; hiçbir yerde `batchNumber` ile lookup YAPMA (bugün de yapılmıyor — tüm `findUnique/findFirst` id üzerinden). Kısıtın ikinci bir işi daha vardı ve o **sessizce kaybolurdu**: eski günlük kalıbın yarışını `@unique` + `withBarcodeRetry` (P2002 → tekrar dene) çözüyordu. Yerine `generateBatchNumberTx`'in **İLK ifadesi** olan `pg_advisory_xact_lock(8022, 1)` geçti ve **iki rejimi de** kapsıyor. Kilit sonraya alınırsa hiçbir şey kazanılmaz (TOCTOU — KK1 guard'ında birebir yaşandı); namespace KK1'in **8021**'inden ayrı tutulur, yoksa iki alt sistem birbirini sessizce serileştirir.
        - **Sayacın kaynağı saklanan bir sayı DEĞİL, veriden türetilir:** en son doğan **kısa** parti (`createdAt DESC LIMIT 1`, destek index `batches_createdAt_idx`). ⚠️ Sorgunun regex'i (`^P(0[1-9]|[1-9][0-9])$`) **load-bearing**: gevşerse en son satır olarak bir ESKİ günlük kod döner, parse `null` verir ve sayaç **her seferinde P01'e düşer** (canlı P01 dururken ikinci bir P01 doğar). `batchNumber` ile **SIRALAMA YAPILAMAZ** — numara sardığı için en büyük numara "en yeni" demek değildir (P99'dan sonra doğan P01 en yenisidir).
        - **Bedeli bilinçli:** parti no ile arama tanım gereği çok sonuç döndürür (aynı numarayı yıllar içinde onlarca parti almış olur) — bu kararın doğal sonucudur, `contains` artefaktı değil; tam-eşleşmeye çekmek düzeltmez. Gerçek çözüm arama + tarih aralığıdır, ayrı iş. **Ayarı değiştirmek MEVCUT partilerin numarasını değiştirmez** (numara doğuşta yazılır, yeniden hesaplanmaz); bayrak kapatılıp açılırsa sayaç **kaldığı yerden** devam eder (P42 → kapalı dönem → P43), çünkü kaynak en son kısa partidir. Panelde **"Son kullanılan · sıradaki"** göstergesi var (`GET /api/batches/number-state`) — körlemesine sarmada fabrikanın fiziksel plaka setiyle sistemi karşılaştırabileceği tek yüzey; "sıradaki" **ÖNİZLEMEDİR, rezervasyon değil**. **Sayaç sıfırlama düğmesi BİLİNÇLİ OLARAK YOK**: saklanan ikinci bir sayaç gerektirirdi (repo tüm sıraları veriden türetiyor) ve P01–P40 canlıyken sıfırlamak, kabul edilen sarma çakışmasından (~5-10 gün arayla) **daha kötü** bir aynı-hafta çakışma serisi üretirdi.
        - Bekçi: `scripts/test_batch_number_format.ts` (39 kontrol, iki rejimi de ölçer + canlı DB'de kısıtın gerçekten kalktığını doğrular; **dört negatif sondayla** kırmızı verdiği doğrulandı — kilit silinince 4, SQL süzgeci gevşeyince 2, sarma `%` düşünce 2, `@unique` geri gelince 1).
    - **Bayrak KAPALIYKEN — parti no DOLGUSUZDUR, tek kod istisnası (2026-08-05, kullanıcı kararı):** `P0508261`, `P05082619`, `P050826123`… Sıra gün başına 1'den başlar, zero-pad YOK, hane serbest (9999/gün tavanı da düştü). Diğer tüm kodlar (`SIP`/`İE`/`CV`/`RK`/`FS`…) 4 hane dolgulu KALIR — meşruiyet farkı: parti no **okutulmaz** (barkod/QR değil, kâğıda basılan iz), yani sabit uzunluk varsayan tarayıcı/parser yolu yok (`isDailyCode` "P" ile hiç çağrılmıyor). **Eski dolgulu kayıtlar (2026-08-05 öncesi `P0508260019`) OLDUĞU GİBİ DURUR** — geriye dönük düzeltilmez (canlı veri + o numaralar kâğıda basıldı); prefix `P`+GGAAYY sabit 7 karakter olduğu için `nextDailySeq` kuyruğu `parseInt` ile okur ve sayaç aynı gün içinde bile kaldığı yerden devam eder (`P0508260019` → `P05082620`). Migration YOK.
    - ⚠️ **`orderBy: { batchNumber }` HER İKİ REJİMDE DE YASAK — ama sebepleri FARKLI.** Günlük kalıpta dolgusuzluk yüzünden **sözlüksel sıra ≠ sayısal sıra** (`P05082610` < `P0508262`); kısa kalıpta ise numara sabit genişlikte olduğu için sözlüksel=sayısaldır ama **numara SARDIĞI için sayısal sıra da "yenilik" sırası değildir** (P99'dan sonra doğan P01 en yenisidir). Üstelik iki biçim DB'de kalıcı olarak yan yana yaşıyor. Parti listeleyen hiçbir yer `orderBy: { batchNumber }` KULLANMAZ — hepsi `createdAt` ile sıralar (refakat kartının canlı parti bloğu `resolveLiveBatches` dahil; tek ihlal oydu, düzeltildi). Yeni yüzeyde aynısını yap.

### Kartela fason (Swatch)
<sub>eski kök `CLAUDE.md:170-170` · bölüm: Domain Kuralları</sub>

- **Kartela fason (Swatch):** Bitmiş top kartela firmasına gider, fasonda N kartela (`Swatch`) olarak döner (`KartelaDispatch`/`KartelaReceipt`, `AT_KARTELA`/`KARTELA_CONSUMED`). Üretim fasonundan ayrı, WO'suz akış. Tasarım: `docs/design/KARTELA-TASARIM.md`.

### İdempotency (2026-07-14)
<sub>eski kök `CLAUDE.md:171-173` · bölüm: Domain Kuralları</sub>

- **İdempotency (2026-07-14):** Kayıt-yaratan uçlar istemci `clientToken @unique` taşır (Roll, Order, WorkOrder) — timeout-retry'de mükerrer kayıt önlenir. İstemci token'ı **mantıksal deneme başına bir kez** üretir ve tekrar denemede AYNI token'ı gönderir (mutate çağrısı başına yeni token üretmek korumayı boşa düşürür — 2026-07-27 Tambur kesim düzeltmesi, **2026-08-03 KK1 ham giriş düzeltmesi**); sayaç-bazlı kartela düşümü için ayrı `SwatchStockReduction` olay modeli (`clientToken @unique` onda; `KartelaDispatch`'te token YOK). Durum geçişleri **atomik claim** (`updateMany WHERE {id, beklenen-durum}` + `count===0 → 409`; `findUnique→if→update` YASAK).
  - **"Mantıksal deneme"nin SINIRI var — token seri girişe YAPIŞMAZ (2026-08-03).** Sahada sunucu restart edilince operatör etiket çıkmadığı için tuşa defalarca bastı ve her basış yeni token ürettiği için tek fiziksel top N kayıt doğurdu. Düzeltme "token'ı ref'te sabitlemek" DEĞİLDİR: KK1 tek yüksek-hacimli **seri giriş** ekranıdır (offline'da 5 top arka arkaya kuyruğa girer) ve sabit tek token onları birbirine çakıştırıp **sessizce yutardı** — kopyanın aynadaki ikizi, yani eksik stok. Doğru kural: token yalnız **sonucu BELİRSİZ** bırakan hatadan sonra yapışır (ağ hatası / zaman aşımı / 5xx — timeout "yazılmadı" demek DEĞİLDİR); **kesin 4xx'te yapışmaz**, çünkü orada hiçbir şey yazılmadığı kesindir ve yapışmak "Ürün silinmiş" gibi bir hatada aynı payload'ı sonsuza dek yeniden gönderen bir *Tekrar Dene* döngüsü kurar. Tek kaynak + bekçi: `mobil/src/offline/entryAttempt.ts` (+ `.test.ts`). Retry, formu/makineyi YENİDEN OKUMAZ; düşen payload'ı birebir gönderir (otomatik modda yeniden ölçmek metrajı değiştirip gereksiz 409 üretir).
  - **İstemciye güvenmeyen ikinci hat: `kk1.duplicateGuardEnabled`** (varsayılan **KAPALI**). Açıkken 90 sn içinde aynı operatör/makineden birebir aynı ürün+metraj+en → 409 `POSSIBLE_DUPLICATE`; **engelleme değil onaylatma** (`confirmDuplicate: true` ile geçilir — tekstilde aynı partiden eşit metrajlı toplar arka arkaya meşru olarak girilir). Tuzak `createInitialEntry`'de **`opts.duplicateGuard` ile opt-in**'dir (F221 deseni) — dahili çağıranlar (`tambur-manual.service` ×2) etkilenmez. ⚠️ **Bayrağı açmadan önce sahadaki tabletler 409'u tanıyan APK'ya güncellenmiş olmalı**, yoksa ham giriş çıkışsız kalır. Bekçi: `scripts/test_kk1_duplicate_guard.ts`. Geçmiş kopyaları arayan salt-okunur araç: `scripts/find_duplicate_rolls.ts`.

### Kurşun + QC2 = tek fiziksel istasyon (`StationKind.PROCESS_QC`)
<sub>eski kök `CLAUDE.md:174-175` · bölüm: Domain Kuralları</sub>

- **Kurşun + QC2 = tek fiziksel istasyon (`StationKind.PROCESS_QC`):** Tek bir `WorkOrderStep` olarak modellenir. Per-roll `RollOperation` log'u `KURSUN_APPLIED` / `QC2_COMPLETED` olarak iz tutar — her top kurşun görmez.
    - ⚠️ Profil gerçeği — "kurşun ile KK aynı istasyonda" adnansahin'in TOPOLOJİSİDİR; sektörde KK ayrı istasyonda ya da başka bir istasyonla birlikte yapılır (tasarım karar #11, §5.1). ⚠️ **2026-09-03 ölçüm düzeltmesi (mercek raporu yazıldıktan SONRA ölçüldü):** `Station.appliesQuality` artık VAR (`prisma/schema.prisma:843`) ve P4 **Faz A indi** — "bu adım KK yürütür mü" sorusunun cevabı İKİZ boğazdır: bellek-içi `stepCanApplyQuality(station)` + Prisma `QUALITY_STATION_WHERE` (`src/services/helpers/quality-station.helper.ts`). Yeni bir `kind === "PROCESS_QC"` karşılaştırması YAZMA, ikizden birini kullan; Faz B (kalan tek `kursun-qc` çağrısı + `RollError` çok-istasyonluluğu) hâlâ AÇIK.

### Hata yaşam döngüsü
<sub>eski kök `CLAUDE.md:176-177` · bölüm: Domain Kuralları</sub>

- **Hata yaşam döngüsü:** `RollError` PROCESS_QC'de (hata Tambur'da görülürse Tambur'da da) açılır; Tambur kararıyla kapanır (`isProcessed = true`, `actionTaken = CUT|NO_CUT`). Redye/parti ayırmada Tambur dışında `NO_CUT` ile idari kapanış olabilir.
    - ⚠️ "PROCESS_QC'de açılır" varsayımı kalite-yetenek dönüşümünün etki listesindedir (UYGULAMA-PLANI, Faz B · R5: hata çok-istasyonlu olunca partial unique 409 riski). Hata AÇILMA/KAPANMA semantiği (Tambur kararıyla kapanır, `isProcessed`, `CUT|NO_CUT`) ÇEKİRDEK'tir; hatanın hangi istasyonda açıldığı PROFİL'dir. Bu varsayıma yaslanan yeni yüzey yazmadan önce Faz B listesine bak.

### Fason dönüş
<sub>eski kök `CLAUDE.md:178-178` · bölüm: Domain Kuralları</sub>

- **Fason dönüş:** Kabulde orijinal rulolar `SUBCONTRACTOR_CONSUMED` ile emekliye ayrılır; makbuz (receipt) üzerinden `parentReceiptId`'li **yeni açık-kumaş `Roll`'lar doğar** (`entrySource=SUBCONTRACTOR_RETURN`, barcode null). Kabulde metraj girilir (zorunlu, ağırlık opsiyonel); kesin ölçüm sonraki istasyonun `FINISH`'inde damgalanır.

### Roll split
<sub>eski kök `CLAUDE.md:179-179` · bölüm: Domain Kuralları</sub>

- **Roll split:** Sadece Tambur'da (`CUT` kararı) olur — `parentRollId` + yeni barkod ile çocuk roll yaratılır. Çocuklar **işlemin yapıldığı Tambur adımını** damgalar (`producedInStepId` = Tambur step; 2026-07-27 — parent kalıtımı değil, `cutOpenFabric` ile aynı).

### Tambur finalize WO disiplini (2026-07-27)
<sub>eski kök `CLAUDE.md:180-181` · bölüm: Domain Kuralları</sub>

- **Tambur finalize WO disiplini (2026-07-27):** Finalize WO'yu topun **`currentStep`'inden** çözer (köken `producedInStep`'ten DEĞİL — Top Kesme çocuğu `producedInStepId=null` doğar). WO kapaması yalnız terminal-guard'lı `completeWorkOrderIfStepsDone` helper'ıyla yapılır (CANCELLED/SUPERSEDED asla COMPLETED'a dirilmez); iptal/devredilmiş WO'nun adımındaki top finalize/kesim **reddedilir** (pre-tx + kilit-altı taze guard). Ölü top kümesi tek kaynak: `K18_DEAD_STATUSES` (KARTELA_CONSUMED dahil) — liste/lane filtrelerinde elle statü listesi kopyalama. Movement kapanışında `qtyOut = qtyIn` (istasyona giren işlenmiş metraj; finalize öncesi kesimler hacimden düşmez). WO **üretim çıktısı** kümesi tek kaynak: `workorder.service.producedOutputWhere` (Tambur birinci-nesil çocukları + Tambur'suz finalize çıktıları) — liste ÇIKAN metriği ve detay `producedRolls` aynı kümeyi kullanır, elle kopyalama.

### UUID primary key, tüm modellerde `createdAt`/`updatedAt` (M:N pivot ve append-only log tabloları har
<sub>eski kök `CLAUDE.md:283-283` · bölüm: Ortak Konvansiyonlar</sub>

- UUID primary key, tüm modellerde `createdAt`/`updatedAt` (M:N pivot ve append-only log tabloları hariç — bunlarda sadece `createdAt`).

### Sadece soft delete — `isActive: false` veya `RollStatus.CANCELLED` (`SCRAP` = gerçek fire **kararıdı
<sub>eski kök `CLAUDE.md:284-284` · bölüm: Ortak Konvansiyonlar</sub>

- Sadece soft delete — `isActive: false` veya `RollStatus.CANCELLED` (`SCRAP` = gerçek fire **kararıdır**, arşivleme değil); **asla** fiziksel DELETE. Bilinçli istisnalar: bağımlılık-guard'lı master-data `DELETE /:id/permanent` uçları, boş çuval silme, cihaz unpair, pivot replace, **`ItemPrice` satırı silme** (2026-08-14, Paket D — şemada `isActive` YOK ve bilinçli: pasif bir fiyat satırı `resolveItemPrice`'ın "müşteri istisnası > kart varsayılanı > null" sırasına ÜÇÜNCÜ bir durum ekler ve "fiyat yok" ile "fiyat vardı, kaldırıldı" ayrımı hiçbir karara girmez; geçmiş belgeler zaten `InvoiceLine.unitPrice` / `Roll.purchasePrice` ile DONMUŞTUR, yani silme geçmişi değiştirmez).

### Her CUD operasyonu → `AuditService.log()` → `SystemLog` tablosu. (İstisna: `UserPreference` kişisel 
<sub>eski kök `CLAUDE.md:285-285` · bölüm: Ortak Konvansiyonlar</sub>

- Her CUD operasyonu → `AuditService.log()` → `SystemLog` tablosu. (İstisna: `UserPreference` kişisel UI blob'u. Audit **best-effort**'tur — yazım hatası isteği düşürmez, `/health` sayacına düşer; çağrı tx **dışında** yapılır.)

### BEŞ SAĞLAMLIK SINIFI (2026-08-14 — `docs/design/ON-MUHASEBE-SAGLAMLIK-TASARIM.md`; beşi de sahada/denetimde birer kez ısırdı, sınıf adıyla anılır ki altıncı kez açılmasınlar)
<sub>eski kök `CLAUDE.md:286-296` · bölüm: Ortak Konvansiyonlar</sub>

- **BEŞ SAĞLAMLIK SINIFI (2026-08-14 — `docs/design/ON-MUHASEBE-SAGLAMLIK-TASARIM.md`; beşi de sahada/denetimde birer kez ısırdı, sınıf adıyla anılır ki altıncı kez açılmasınlar):**
    1. **İki tarih kuralı** — yeni mali belge tipi eklerken sor: *kâğıdın üzerindeki tarih = bizim işlem tarihimiz mi?* Değilse İKİ alan (SAP Belegdatum/Buchungsdatum; emsal `Cheque.issueDate` ↔ `postingDate` — defter/kilit/belge-no/kur DÖRDÜ de işlem tarihinden). Payment/Invoice tek tarihli ve **meşru** (ödeme = paranın el değiştirdiği gün; fatura = tahakkuk tarihi) — çift tarihi her tabloya yaymak reddedilmiş bir karardır.
    2. **Ters yol kuralı** — deftere yazan her ileri kaynak tipinin tipli `*_CANCEL` yolu olmalı; enum'a ileri değer eklerken ters değerini de düşün (emsal: `ADJUSTMENT` ↔ `ADJUSTMENT_CANCEL`, `reversesTxnId` self-FK bağıyla — SAP FB08). Ters kayıt DAİMA bugüne yazılır (kapanmış fotoğraf değişmez).
    3. **Kilit sırası kuralı** — tek tx'te birden çok advisory/satır kilidi = deterministik sıra (çoğul helper `assertPeriodsOpenTx` ya da kanonik anahtar sıralaması); uzaylar arası = uzay numarası artan. Envanter: `helpers/period-guard.helper.ts` başlığı. İkinci katman: PG sınıf-40 (40P01/40001) kullanıcıya 500 değil 409 "tekrar deneyin".
    4. **Çift yüklem kuralı** — durum ↔ sayaç çifti olan her modelde İKİ yazar da karşı tarafın koşulunu kendi atomik WHERE'ine koyar (emsal: `claimTx allocatedTotal=0` ↔ `bumpChequeAllocated status NOT IN terminal`) + DB CHECK seddi (`cheques_terminal_not_allocated`). Tek yönlü CAS, karşı yazarla yarışta sessiz tutarsızlık üretir.
    5. **Tek kaynak satır kuralı** — çok-tipli çocukları olan belge satırlarını TEK assembler'dan verir (emsal: `assembleReceiptLines` kind FABRIC|YARN; `_shipped.ts`, `producedOutputWhere`); tüketici tabloya doğrudan gitmez — beşinci tüketici yazıldığı gün sınıf yeniden açılır.
    - **2026-08-14 inceleme turunun iki eki:** ① **count-0 tanısı sayaç kaynaklarında SİMETRİK** — atomik `updateMany` claim'i 0 dönünce sebep tx içinde TAZE okumayla söylenir ve bu tanı `explain*BumpZeroTx` aile deseniyle ÜÇ kaynakta da aynıdır (çek · tahsilat · fatura); tek kaynağa yazıp diğerlerini bırakmak, yarışın kaybedenine "tavan aşıldı" YALANI bastırır (fatura o sırada iptal edilmişken). ② **Bekçide gate-tx promise'i `await`'ten ÖNCE reddedebilir** — henüz await edilmemiş promise'e no-op `.catch` konmazsa unhandled rejection süreci Sonuç satırı basılmadan öldürür: ❌ bile yok, en sessiz kırmızı (test_payment_allocation §12m'de iki koşumda ölçüldü). ③ **Olay defterinde kronoloji `createdAt`'tir, olay tarihi DEĞİL** — `eventDate` kullanıcı girdisidir ve geriye tarihlenebilir; "en son olay" araması `eventDate desc` ile yapılırsa storno + geriye tarihli yeniden kayıt zincirinde YANLIŞ satır bulunur (cheque cancelCollect'te canlı ölçüldü: para yanlış hesaptan geri çekiliyordu). Append-only defterde yazım sırası = gerçek kronoloji.
    - **Sınıf 4 emsal ekleri (2026-08-15 I paketi):** ① GR addLines‖cancel — satır doğuran her tx'in İLK işi kap-belgesini status şartıyla claim'lemek (`createInitialEntry.txGate` F221 deseni); iptalin top kümesi claim'den SONRA tx İÇİNDE taze okunur. ② 5 finans ucunda eşzamanlı aynı-clientToken çift gönderim PO deseniyle kapalı: `withBarcodeRetry`'a `!isClientTokenP2002` yüklemi + tx-dışı catch → findUnique → CACHED yanıt; cached yanıtın şekli normal yanıtla BİREBİR olmak zorunda (ayrışırsa replay istemciden ayırt edilir). ③ Ekstre satırı ters-kayıt bağını KENDİSİ taşır (`reversedByTxnId`) — panel yüklemleri kesin bilgiyle çalışır, sezgisel sayım yalnız eski-backend fallback'idir.
    - **Çek teslim bordrosu ANLIK çıktıdır** (`Cheques/chequeBordro.ts`): bordro GRUBUNU sahiplenen kaynak model olmadığı için donmuş `PrintedDocument` üretilmez — belge no/sürüm yok ve bu, kâğıdın üstünde de yazılıdır ("düzenlendiği andaki seçimi yansıtır"). Donmuş sürüm istenirse önce `ChequeBatch` benzeri bir kaynak modeli gerekir (J kararı). Aynı sınıf karar: bordro basmak çekin DURUMUNU değiştirmez (bankaya veriş ayrı işlemdir).
    - **Ticaret bayrakları (2026-08-14 sektör analizi):** `finance.blockNegativeCashEnabled` (varsayılan KAPALI — kasa eksiye düşecekse 4 İLERİ yol 409; BANKA ve TERS yollar/storno MUAF, muafiyet `test_cash_negative_guard`ın asıl negatif sondası; guard `FOR UPDATE` derinlik savunmasıdır, asıl serileştirici 8028 advisory kilidi) ve `finance.defaultVatRate` (varsayılan 20 — panel `emptyLine` + mal-kabulden alış taslağı TEK kaynaktan). ⚠️ `test_feature_flag_contract` artık SAYISAL anahtarları da denetler — "bekçi yalnız boolean bakar" varsayımı bayattır. Bayrak OLMAYACAKLAR listesi (defter semantiği · mevzuat · ikinci-kaynak sınıfları) yol haritasının bayrak bölümünde gerekçeli.
    - **Yarış bekçisi yazarken pencere ELLE AÇIK TUTULAN tx ile kurulur** (`Promise.allSettled` tarzı serbest yarış pencereyi bazen ıskalar ve sahte-yeşil kalır); sondanın tuttuğu kilit bilinçli `FOR NO KEY UPDATE` olabilir — `FOR UPDATE` FK KEY SHARE'i de bloklar ve sondanın kendisi kilitlenir (emsal: `test_goods_receipt_invoice` §10/§11). "Bekledi" ölçümleri (süre eşiği) yalnız pozitif yönde anlamlıdır; deterministik kırmızı SONUÇ kontrolleridir.

### Validation hata mesajları Türkçe.
<sub>eski kök `CLAUDE.md:297-297` · bölüm: Ortak Konvansiyonlar</sub>

- Validation hata mesajları Türkçe.

### TR-only BİLİNÇLİDİR (2026-08-15 kullanıcı kararı)
<sub>eski kök `CLAUDE.md:298-298` · bölüm: Ortak Konvansiyonlar</sub>

- **TR-only BİLİNÇLİDİR (2026-08-15 kullanıcı kararı):** arayüz ve backend mesajları Türkçe kalır — hedef pazar Türk tekstil firmaları; i18n altyapısı KURULMAZ (sözlük katmanı sürekli bakım borcu doğurur ve bugün okuyucusu yok). Yabancı müşteri gerçekten doğarsa önce YALNIZ ticaret yüzeyleri (cari/fatura/çek/kasa/mal kabul) sınırlı sözlüğe alınır — o gün planlanır, bugünden hazırlık yapılmaz.

### Yıkıcı işlemlerde detaylı onay zorunlu
<sub>eski kök `CLAUDE.md:299-300` · bölüm: Ortak Konvansiyonlar</sub>

- **Yıkıcı işlemlerde detaylı onay zorunlu** (iptal/sil/scrap): confirm dialog'unda etkilenen her kaydı (WO, rulo, sipariş vb.) somut olarak listele. Backend tarafında preview endpoint döner, frontend per-record seçim sunar — "X kayıt etkilenecek" gibi soyut sayı yetmez.

---

## 2026-09-07 — Backend log kanalı: paket DEĞİL, `src/lib/logger.ts` [ÇEKİRDEK]

**Karar:** Backend'in log kanalı `src/lib/logger.ts`tir (`hata` / `uyari` /
`bilgi` + banner için `satir`). Yeni **paket eklenmedi**. 142 çıplak `console`
çağrısının tamamı taşındı; ESLint `no-console` `src/` blokunda `"error"` olarak
açıldı ve tek istisna kanalın kendi dosyasıdır (adlı blok).

**Neden şimdi:** `eslint.config.mjs` başlığı bu kuralı bilerek AÇMAMIŞTI —
"backend'de yapılandırılmış logger YOK, kural yazmak logger kararını dayatırdı;
karar ayrı bir iştir". `docs/standart/KUTUPHANELER.md` §8 de aynı maddeyi açık
tutuyordu. Bu not o maddeyi kapatır.

**Kararın dayanağı ÖLÇÜMDÜR.** Fabrika sunucusunun beş haftalık hata log'u
(31.07 → 04.09, 5648 satır) elle ayrıştırıldı:

| | |
|---|---|
| `[etiket]` taşıyan satır | 531 — saniyeler içinde gruplandı (`[offsite]` 505 · `[swagger]` 23 · `[audit]` 3) |
| etiketsiz satır | ~5100 — yığın izleri ve pg bağlantı nesnesi dökümleri; ancak OKUNARAK sınıflandı |

Somut bedel: 64 kez tekrarlayan bir sebep-kodu reddi (`TOP_BASI_MAKAS_PAYI`) ve
15 kez tekrarlayan bir controller-bind hatası, `error.middleware`in ETİKETSİZ
`console.error("Unhandled Exception:", err)` satırından geçtiği için `grep -c`
ile sayılamadı; sayım elle yapıldı.

**Paket neden reddedildi (`pino` / `winston`):** ikisi de bir bağımlılık, bir
yapılandırma ve bir TAŞIMA katmanı getirir. Bu kurulumda taşımayı pm2 yapıyor
(`out_file` / `error_file`, `time: true` ile satır başına zaman damgası),
rotasyonu `pm2-logrotate` (2026-09-07'de `kur.ps1`e eklendi). Kütüphanenin
çözdüğü iki sorun zaten çözülmüştü; geriye kalan tek eksik SEVİYE + ALAN ETİKETİ
disiplini ve o ~30 satırlık bir iş. [KU-07] ("elle yazmak her kayıtta gerçek bir
alternatiftir") burada uygulandı.

**Sözleşmenin üç değişmezi** (bekçi: `scripts/test_logger_kanali.ts`, 16 kontrol,
altı negatif sondayla ısırtıldı):
1. **Biçim** `SEVIYE [alan] mesaj` — tek satır, greplenebilir.
2. **Akış ayrımı** `bilgi` → stdout, `hata`/`uyari` → stderr. pm2 bu iki akışı
   AYRI dosyaya yazar; birleştirmek `backend-err.log`u işe yaramaz hale
   getirirdi (bugün orada 5 haftada 383 KB var, out'ta 57 MB).
3. **Sayılabilirlik** bir hata = TEK etiketli satır; yığın izi ALTINA etiketsiz
   basılır. Yukarıdaki 64/15 vakası tam da bu ayrım olmadığı için sayılamamıştı.

**Zaman damgası logger'da BASILMAZ** — pm2 `time: true` ile koyar; ikinci damga
her satırı iki kez tarihlerdi.

**Banner istisnası:** `satir()` etiket almaz. `server.ts`in açılış kutusu insan
okuru içindir; her satırına `BILGI [server]` eklemek kutuyu okunamaz yapardı.
Kaçış ADIYLA taşınır ve nerede kullanıldığı greplenebilir kalır.

**Kayıt:** `docs/standart/KUTUPHANELER.md` §2 satırı + §9 (altı satırlık karar
kaydı, sonuç "paket YOK").

## 2026-09-07 — Saha turu: 13 madde, üç ad ve "yan yana karşılaştırma" [PROFİL/ÇEKİRDEK karma]

Kullanıcı fabrikada paneli baştan sona gezdi ve 13 madde bildirdi. Çoğu yerel
düzeltme; üçü kural doğurdu.

**① ÇUVALIN İÇİNDE ÜÇ AD YAN YANA** [ÇEKİRDEK]. Çuvalın içi, mal sevk edilmeden
önceki SON bakış anıdır ve orada üç ad ayrışabilir: ① bizdeki (canlı kayıt)
② müşterideki (alias kademesi) ③ TOPUN ÜSTÜNDEKİ KÂĞITTA yazan
(`lastLabelSnapshot`, baskı anında donmuş). Bugüne kadar üçünü yan yana gösteren
hiçbir yüzey yoktu. Kullanıcının sözü: *"üçünü karşılaştırsak nasıl olur?"*

İki değişmez ölçülüyor (`scripts/test_sack_contents_uc_ad.ts`, 17 kontrol, üç
negatif sonda): **(a)** müşteri karşılığı YOKSA `null` döner — bizim adımız
"müşterideki ad" diye BASILMAZ (2026-09-06 kullanıcı düzeltmesinin devamı: çoğu
müşteri bizim adımızı kullanır, uydurma alias defteri kirletir). **(b)** etiket
adı SNAPSHOT'tan gelir, canlı veriden TÜRETİLMEZ — türetilseydi ölçmek istenen
ayrışmanın (kâğıt ↔ kayıt) kendisi gizlenirdi.

Ekran ile BELGE ayrı uçlardan beslendiği için (`getSackContents` ↔
`getContentDump`) bekçinin §5'i dökümü de ölçer: ekran düzeltilip belge
unutulursa PDF/Excel yine tek ad basardı.

**② YAN YANA KARŞILAŞTIRMA — İKİ PANEL AYNI ANDA** [ÇEKİRDEK]. "Siparişe
yazılamayanlar" ekranındaki satırlar tanım gereği gözden kaçmış işlerdir;
onarmadan önce sorulan soru hep aynı: *sevkiyattan çıkan mal, siparişte açık
duran kaleme gerçekten uyuyor mu?* Numaralar tıklanabilir yapıldı — sipariş
SOLDAN, sevkiyat SAĞDAN açılıyor ve **ikisi aynı anda açık kalıyor**.

Bunun için `ui/sheet`e opt-in `hideOverlay` eklendi: iki panel de kendi
karartmasını çizseydi aradaki şerit çift kararırdı. Yan etkisi FAYDALIDIR —
alttaki tablo tıklanabilir kalır, kullanıcı paneller açıkken başka bir sipariş
numarasına geçebilir. Kapatma yolu kaybolmaz (X + Esc yığını); düşen tek şey
"dışarı tıkla kapat" ve sekme içinde o zaten yalnız KENDİ karartmasına
tıklayınca çalışıyordu.

**Numara değil id taşınır:** liste ucu `orderNumbers`in YANINA
`orders: [{id, orderNumber}]` koydu. Numaradan id'yi arayarak bulmak ikinci bir
okuma yoluydu ve mükerrer numarada YANLIŞ siparişi açardı — sessiz yanlış,
görünür eksikten kötüdür. `orderNumbers` KALDIRILMADI (sahadaki panel onu
okuyor); iki alanın aynı kümeyi göstermesi bekçide ölçülür.

**③ SEÇENEK SUNMAK, KARŞILIĞI OLMAYAN DURUM ÜRETMEMELİ** [ÇEKİRDEK]. Sevkiyatı
geri alma penceresinde "sevkiyatı da kapat" kutusunun işaretini kaldırmak,
`shipping.confirmationEnabled` KAPALI olan bir kurulumda sevkiyatı PLANNED'a
düşürüyordu. O kurulumda PLANNED bir ARA DURAK DEĞİLDİR — "Sevk Kapısı" diye bir
adım yoktur — ve operatör bunu ikinci bir iptalle temizlemek zorunda kalıyordu.
Kullanıcının sözü: *"planlı sevkiyat diye bir şey yok ama şu an planlı sevkiyat
durumuna düşüyor."* Kutu artık yalnız onay AÇIKKEN çizilir; kapalıyken geri alma
daima serbest bırakır ve pencere bunu cümleyle söyler. **Varsayılan zaten buydu;
değişen şey yanlış seçimin artık MÜMKÜN OLMAMASI.** Sınıfın adı: bir bayrak
kapalıyken o bayrağın ürettiği duruma götüren seçenek de çizilmez.

**④ Araca yüklenen çuval adedi giriş ANINDA** [PROFİL]. Alan sevkiyat DETAYINDA
zaten vardı; eksik olan giriş anıydı — kamyon yüklenirken sayı bilinir, üç ekran
sonra hatırlanmaz. Yurtiçi sevkte mal çuvallara AYRILMIYOR (tartı gerekmediği
için 100 top tek çuval kaydına yazılıp gönderiliyor); sistem "1 çuval" sayıyor,
araca 10 çuval çıkıyor ve bu fark ne ekranda ne İRSALİYEDE görünüyordu. Alan bir
ANNOTATION'dır: donmuş belge çekirdeğine girmez, sürüm doğurmaz — o yüzden
sevkiyat kurulduktan SONRA ayrı yazımla kaydedilir.

**Kalan dokuz madde** yerel düzeltmedir ve sürüm notunda tek tek yazılıdır
(yerli onay penceresi · uzun açıklamaların (i) balonuna taşınması · şube kapalı
kurulumda şube sütunu · cari kapısının kendi yazdığı filtreyi "hedef" sayması ·
boş çuvalda sil düğmesi · muhasebe fişinin son hâli · "bu görünümü kalıcı yap" ·
belge şablonlarında ok hizası · özet kutularının başlığa yapışması).

## 2026-09-07 — Kurulum yarışı: `pm2 delete` döndüğünde süreç ölmemiş olabilir [ÇEKİRDEK]

2.9.8 kurulumunun BİRİNCİ denemesi `[5/9]`de düştü: `Move-Item app` "dosya
başka bir işlem tarafından kullanılıyor". Sunucudaki oturumun teşhisi doğruydu
— kapanan node sürecinin **çalışma dizini `app\`** ve işletim sistemi dizin
tanıtıcısını `pm2 delete` döndükten SONRA bırakıyor.

**Neden bugüne kadar görünmedi:** bu bir yarış ve önceki iki kurulumda
kazanılmıştı. Aynı paket, aynı komut üç dakika sonra sorunsuz geçti. Yani
"iki kurulumda çalıştı" bir kanıt değildi — sınıfın adı budur ve `kur.ps1`
başlığındaki diğer yarış notlarıyla (cwd `app\` içinde bırakılmaz) aynı aileden.

**Düşme zararsız atlatıldı** ve script'in tasarımı burada kendini gösterdi:
eşik ÖNCESİydi, `app.eski-*` hiç oluşmadı, hiçbir şey yer değiştirmedi, mevcut
kurulum yeniden başlatıldı, kesinti 3 sn. Veri/migration/ayar/audit_guard el
değmemiş doğrulandı. Ama kurulumu insanın ikinci kez başlatmasına bırakıyordu
ve `kur.ps1`in kendi çıktısı ("kilidi bul, yeniden koş") ile "başarısız
kurulumu tekrar deneme" kuralı çelişiyordu — oturum haklı olarak insana sordu.

**Düzeltme:** `TasiIsrarla` (5 deneme × 1,5 sn) + `[4/9]` sonrası 1,2 sn
yatışma. Taşıyan DÖRT yerin dördü de yardımcıdan geçiyor ([5/9] · otomatik geri
alma · `-GeriAl` aracının iki taşıması); biri çıplak `Move-Item`a dönerse yarış
oradan geri gelir, bekçi bunu ölçüyor.

**Yardımcı hatayı YUTMAZ** — son denemede aynen fırlatır. Yutsaydı düşen bir
taşımadan sonra kurulum yarım veriyle devam eder, otomatik geri alma hiç
koşmazdı; sessiz ve mümkün olan en kötü sonuç. Bekçinin en önemli tek kontrolü
bu (`scripts/test_deploy_move_retry.ts`, 11 kontrol, üç negatif sonda).

**"Sürecin ölüp ölmediğine" bakılmıyor:** tanıtıcı sahibi her zaman pm2'nin
bildiği süreç değil (Defender, Explorer önizlemesi, açık bir kabuk). Ölçülebilir
tek şey TAŞIMANIN KENDİSİ — o deneniyor.

**Düzeltme 2.9.8 PAKETİNDE YOK** (kurulum bittikten sonra yazıldı); bir sonraki
backend paketiyle sahaya gider. Gevşek `kur.ps1`i tek başına göndermek, paketin
içindekiyle ayrışırdı — 2026-09-07 sabahı bilerek kapatılan tuzağın aynısı.

**Not — sürüm sayımı yanlıştı:** sahadaki sürüm 2.9.6 değil 2.9.7'ydi (aynı
sabah kurulmuş, `backend-v2.9.7` etiketi var). Sunucudaki oturuma "2.9.6 → 2.9.8"
yazıldı; gerçek delta iki servis dosyası + yeniden derlenmiş `dist-web`ti.
`dist-web` PAKETE GİRER ve Electron kaynağından derlenir — panel değişikliği
yapılan her turda değişir, ayrıca beyan edilmeli.

## 2026-09-07 — `pg` DeprecationWarning (D-2): önerilen teşhis ÖLÇÜMLE ELENDİ [ÇEKİRDEK]

Sunucudaki oturum sahada iki satır buldu (`backend-err-5.log`, `backend-err-0.log`):
`Calling client.query() when the client is already executing a query is
deprecated and will be removed in pg@9.0`. Zamanlarına bakıp iki aday önerdi —
`auth.middleware.touchSessionLastSeen` ve `device.service.resolveDevice` — ve
"üç yazımı `await` et" dedi. Adayları kendisi kanıtlamadığını da dürüstçe yazdı.

**Öneri kabul EDİLMEDİ; mekanizma ölçüldü ve aday elendi.**

**① Uyarının koşulu İKİ değil ÜÇ eşzamanlı sorgudur.** `pg/lib/client.js:690`:
`if (this._queryQueue.length > 0) queryQueueLengthDeprecationNotice()`. İki
sorguda birincisi `activeQuery` olur, kuyruk BOŞ kalır ve uyarı DOĞMAZ. Ölçüldü:
iki sorgu → 0 uyarı, üç sorgu → 1 uyarı.

**② Uyarı SÜREÇ BAŞINA BİR KEZ basılır** (`util.deprecate`). Sahadaki iki satır
"iki kez oldu" değil "iki ayrı süreçte en az bir kez oldu" demektir; bu log'dan
SIKLIK ölçülemez.

**③ Prisma bu uyarıyı havuz üzerinden ÜRETEMEZ.** Her `prisma.*` çağrısı
`pool.query()`ye gider, havuz BOŞTA bir client verir ve meşgul client'ı ikinci
bir çağırana ASLA vermez (doluysa sıraya alır). Dört ayrı hipotez ölçüldü,
dördü de **0 uyarı**: (a) havuzdan dört serbest sorgu (b) tx içinde
`Promise.all` ile üç `tx.*` (c) tx zaman aşımı, sorgu hâlâ uçarken
(d) tx zaman aşımı + ardından eşzamanlı yük. Prisma pinlenmiş client'ta da
sorguları sıraya alıyor.

**④ Canlı sunucuda yeniden üretilemedi:** yerel sunucu `--trace-deprecation` ile
açıldı, 120+ paralel kimlikli istek (`x-device-id` yolu dahil) atıldı → 0 uyarı.

Yani `touchSessionLastSeen` ve `resolveDevice` **sebep olamaz**: ikisi de havuz
üzerinden gider ve zaten iki tanedir. Sıcak yolu (her kimlikli istek) kanıtsız
bir varsayım için değiştirmek yanlış olurdu.

**Geriye kalan tek yer PİNLENMİŞ bir `Client`tır.** Backend'de yalnız iki tane
var (`helpers/pg-admin-client.ts`, `db-copy-verify.service.ts`) ve ikisi de
sıralı `await` kullanıyor. Sebep henüz bilinmiyor — ve **tahminle kapatılmayacak.**

**Yapılan iş: tahmin değil, ÖLÇÜM ALTYAPISI.** Node'un kendi çıktısı
"nereden geldiğini görmek için `--trace-deprecation` ile başlat" diyor ve o
bayrak canlıda yeniden başlatma, yani kesinti demekti. **Ölçüldü: `warning`
olayının `w.stack` alanı çağrı yerini BAYRAKSIZ DA taşıyor** — Node yalnız
EKRANA basmıyor. `src/lib/process-warnings.ts` bu dinleyiciyi kurar; bir sonraki
paketle sahaya gider ve uyarı bir daha çıktığında ÇAĞRI YERİNİ log'a yazar.

İmza `ad|mesaj|ilk yığın karesi`dir — aynı metin başka bir yerden gelirse AYRI
sorundur, susturulmaz.

**Ciddiyet (oturumun değerlendirmesi doğru):** bugün sorun değil, `pg` ikinci
sorguyu sıraya alıyor. `pg@9`da fırlatacak. Yükseltmeden ÖNCE kapatılmalı;
bugünün acili değil.

**Bekçinin kendi hatası da kayda geçti:** §4 (tekrar basılmıyor) ilk yazımda
pg'nin uyarısıyla ölçülüyordu; o zaten süreç başına bir kez bastığı için sonda
`gorulen` kümesini kaldırdığında bile YEŞİL kaldı — **vakumen yeşil**. Tekrar
artık `process.emitWarning` ile ölçülüyor.

## 2026-09-10 — Aynı sevkiyat, iki ad: muhasebe fişi ad rejimini hiç sormuyordu [ÇEKİRDEK]

Fabrikadan aynı sevkiyata ait iki dosya geldi (`SVK0909260004`): PDF'te ürün
adı `BS-6650 EKRU 330cm.` (müşterinin adı), Excel'de `LİNEN EKRU 330cm.`
(bizim adımız). Veri sağlamdı — alias doğru kurulmuş, belge doğru donmuştu.

**Sebep bir YOL farkıydı, veri farkı değil.** İkisi de aynı `PrintedDocument`
snapshot'ından besleniyor ve snapshot İKİ ADI DA taşıyor (`name` ↔
`customerName`, `desen/varyant` ↔ `customerDesen/customerVaryant`). Ayrışan şey
KARARdı:

- **PDF** → `renderShipmentDispatchHtml`, rejimi (`shipping.docItemNameMode` +
  `docCekiNameMode` + `docProductColorSplit`) baskı anında CANLI okuyor.
- **Excel** → `getDispatchReport` → panelin `buildDispatchReportSheets`'i. Bu yol
  rejimi HİÇ sormuyordu; panelin `DispatchReport` tipinde müşteri adı alanları
  **tanımlı bile değildi**, yani backend gönderse de düşüyordu.

Aynı diyaloğun içindeydiler: `DispatchReceiptDialog` başlığı bunu zaten yazıyor —
*"önizleme + baskı backend'in HTML çıktısıdır… Excel + toplu etiket için
yapılandırılmış veri (getReport) AYRICA çekilir."* Ayrışmanın yeri o "ayrıca"ydı.

**Bunun bir hata olduğunun kanıtı ayarın kendi metnindeydi:** *"NOT: kapsam sevk
irsaliyesi + MUHASEBE FİŞİDİR."* Vaat yazılıydı, uygulama eksikti.

**Düzeltme — karar tek yere taşındı.** `document-render/shipment-name-mode.ts`:
`cozAdRejimi()` (üç ayarı "hangi kolon çizilir"e çevirir, `devral`ı çözer) +
`musteriAdiVeya()` (fail-open). Renderer'daki inline bayraklar oradan okuyor;
`getDispatchReport` aynı helper'ı çağırıp sonucu `adRejimi` alanıyla fişe
taşıyor; Excel kolonlarını o alandan kuruyor ve **kararı yeniden hesaplamıyor.**

**Bilinçli sınır:** `renkAyriSutun` Excel'de UYGULANMAZ. O bir YERLEŞİM kararı ve
ayarın kendi metnine göre yalnız MÜŞTERİYE GİDEN belgeyi ilgilendiriyor; fiş iç
dosyadır, müşteri adı tek birleşik hücrede kalır. Ad SEÇİMİ ikisinde de aynı.

**Fasondan doğrudan sevk** ayarın kapsamı dışında (ayar metni böyle diyor); o uç
`adRejimi`yi ADIYLA `bizdeki`ye sabitliyor — alanı boş bırakmak Excel'i tahmine
zorlardı.

**Geriye uyum:** `adRejimi` opsiyonel. Eski sunucuya bağlanan yeni panel bugünkü
gibi bizim adımızı basar (yeni davranışın varsayılanı = bugünkü davranış).

**Bekçiler:** `test_shipment_doc_customer_name.ts §10` (fiş rejimi taşıyor ·
rejim DONMAZ, ayar değişince aynı belge yeni rejimle geliyor · çeki kendi
rejimini izliyor) — sondalar: `adRejimi` düşürülünce 5 kırmızı, rejim
sabitlenince 2 kırmızı. Panel tarafı `accounting-export.test.ts` "ad rejimi"
bölümü — sondalar: müşteri kolonu dalı kaldırılınca 2 kırmızı, varsayılan rejim
"müşterideki"ye çevrilince 4 kırmızı.

**Yan bulgu:** gelen Excel'de 2 sayfa vardı (Kumaş + Çeki); güncel panel 3 sayfa
üretiyor (arada Çuval Listesi). Yani dosya eski bir panel derlemesinden çıkmış —
o makinede güncellemenin oturup oturmadığı ayrıca kontrol edilmeli.

## 2026-09-10 — Üç küçük iş: offsite yanlış alarmı + `kur.ps1` iki notu [ÇEKİRDEK]

Üçü de sunucudaki oturumun kurulum raporlarından çıktı; üçü de kurulumu
engellemiyordu ama üçü de aynı sınıfın örneği: **söylediği şeyi ölçmeyen kod.**

**① `[offsite]` YANLIŞ ALARMI.** `startOffsiteSweeper` boot'ta
`BACKUP_RCLONE_REMOTE` env'ine bakıp "hedef panelden ayarlanmadıysa tüm yedekler
aynı diskte" uyarısı basıyordu. Hedefin YETKİLİ kaynağı PANEL ayarıdır
(`readOffsiteRemote` → önce `SETTING_KEYS.BACKUP_OFFSITE_REMOTE`, env yalnız
yedek) ve fabrikada hedef tanımlıydı, süpürme çalışıyordu (2026-09-07'de rclone'a
doğrudan sorularak doğrulandı: yerelde 14 dump, Drive'da 14). Yani her açılışta
hata log'una bir felaket cümlesi düşüyordu — üstelik bir satır sonra kendi
"hedef panelden çözülecek" satırı vardı.

Boot'ta ayarı okumak açılışı DB hazırlığına bağlardı — ama okumaya GEREK YOK:
ilk süpürme 90 sn sonra hedefi GERÇEKTEN çözüyor ve yoksa `!res.configured`
dalı kesin cümleyle uyarıyor. **Sinyal silinmedi, ölçüldüğü ana taşındı.**
Bekçi ikisini BİRLİKTE kilitliyor: boot uyarısı geri gelirse de, süpürmedeki
uyarı silinirse de kırmızı (`test_offsite_sweep.ts`, iki sonda ölçüldü).

Kural olarak yazıldı: durumu ancak iş koşunca bilinen bir kontrol, uyarısını da
o koşumdan basar. Uyarı körlüğü gerçek felaketi de gizler.

**② ÇIKIŞ KODLARI TOPLANMIYOR.** `kur.ps1` logrotate bloğu
`$ayarKod += Pm2Kos set ...` yazıyordu. Toplam bir çıkış kodu DEĞİLDİR: hangi
ayarın yazılamadığını söylemez ve negatif kod dönen bir çağrı (Windows'ta olur)
toplamı sıfıra çekip "hepsi başarılı" yalanını üretebilir. Bloğun kendi yorumu
zaten "eskiden ekranda yine 'kuruldu' yazardı — mesaj gerçeği söylemezdi"
diyordu; aynı hata bir kademe aşağıda tekrarlanıyordu. Artık ayarlar ADLI bir
tabloda, başarısızlar adıyla toplanıp tek tek raporlanıyor.

**③ `[4/9]` "not found" SATIRI.** `pm2 delete <kayıtlı-olmayan>` stderr'e
"Process or Namespace not found" yazar ve satır EKRANA DÜŞER — stderr
yönlendirilemez (PowerShell 5.1'de `$ErrorActionPreference="Stop"` altında
ölümcül; `Pm2Kos` başlığındaki ölçüm). İlk kurulumda bu NORMALDİR. Çıkış kodu
okunup satır adıyla açıklanıyor: *"pm2'de kayıtlı '<ad>' yoktu — yukarıdaki
'not found' satırı BEKLENEN, hata değil."*

**Bekçi kendi şeklini değil KURALINI ölçmeli:** `test_deploy_log_rotation` §2
eskiden üç `Pm2Kos set` satırını literal arıyordu ve tablo+döngüye geçince
kırmızı verdi. Kural "üç ayar DEĞERİYLE yazılıyor"dur; kontrol ona çevrildi ve
üstüne "kod toplama yok" kontrolü eklendi. Üç sonda ölçüldü (ayar silme · `+=`
geri koyma · değer değiştirme).

## 2026-09-10 — K-1 kapatıldı: offsite hedefi sessizce yerel klasöre düşebiliyordu [ÇEKİRDEK]

**Bugün bir arıza YOK.** Fabrikada gece yedeği alınıyor ve Google Drive'a
gidiyor; kullanıcı sunucuda doğruladı, sunucudaki oturum da 2026-09-07'de
rclone'a doğrudan sorarak ölçtü (yerelde 14 dump, Drive'da 14). Kapatılan şey
bir arıza değil, **bir yalanın mümkün olması.**

**YAŞANAN (2026-09-05, K-1):** panelden hedef `gdrive` diye — İKİ NOKTA ÜST ÜSTE
OLMADAN — kaydedilmişti. rclone göreli bir argümanı uzak bağlantı değil yerel
yol sayar ve backend'in cwd'sine göre çözer. Bütün "makine dışı" yedekler
`C:\TeksERP\app\gdrive\` altına, yani veritabanıyla AYNI DİSKE kopyalandı.
Panel ve sağlık ucu buna yeşil dedi:

    {"configured":true,"ok":true,"localCount":4,"remoteCount":4,"warnings":[]}

**Yeşilliğin mekanizması:** süpürme kendi kendini doğruluyor. `copy` ve `lsf`
AYNI yanlış hedefe gittiği için sayılar HER ZAMAN tutar. Diğer her arıza log ya
da hata üretiyor; bu, operatöre "yedeğin güvende" diyordu — sessiz kalan tek
kritik hata sınıfı.

**İKİ KAPI, ve ikincisi asıl olan:**
1. **Yazarken** — `PATCH /backups/offsite` şeması reddediyor (400).
2. **Okurken** — `sweepOffsiteBackups` `configured:false` dönüyor. Yalnız (1)
   yazılsaydı SAHADA ZATEN KAYITLI olan yanlış sonsuza dek yeşil kalırdı; K-1'in
   kendisi tam olarak buydu. Test düğmesi de biçimi rclone'dan ÖNCE bakıyor —
   iki noktasız hedefte `lsd` BAŞARILI döner (yerel klasörü listeler) ve
   "bağlantı tamam" derdi.

**YASAK DAR VE ADLI: göreli/belirsiz hedef.** İlk yazımda kural "iki nokta şart"
diye kurulmuştu ve bekçinin kendi fixture'ı (mutlak tmp dizini) kırmızı verdi —
kural UNC (`\\SUNUCU\yedek`) ve POSIX mutlak yollarını da kesiyordu, oysa ikisi
de MEŞRU offsite hedefidir. Ölçülen risk o değildi: risk "bir uzak bağlantı ADI
gibi görünüp sessizce cwd altına düşen" biçimdi. Bekçi kuralı daralttı.

**Geçerli ama bu makinede olan hedef ENGELLENMEZ** (`D:\yedek`, ikinci disk,
geçici alan — operatör bilerek seçmiş olabilir): `ok:true` kalır ama
`remoteIsLocalPath` işaretlenir ve uyarı basılır. "Başarılı" ile "yeterli" ayrı
sorulardır; çalışan bir yapılandırmayı arıza gibi göstermek yanlış olurdu.
UNC işaretlenmez — o BAŞKA bir makinedir.

**Bekçi:** `test_offsite_sweep.ts §3` (54 kontrol). Dört negatif sonda ısırdı:
okuma kapısı kaldırıldı (3 kırmızı) · sürücü harfi rclone bağlantısı sayıldı
(1) · "makine dışı değil" uyarısı susturuldu (1) · PATCH şemasındaki `refine`
kaldırıldı (1). Şema kapısı PAYLAŞILAN doğrulayıcıyı çağırıyor; kendi regex'ini
yazsaydı yazma ile okuma kuralı sessizce ayrışırdı.

**Raporun 2. maddesi (rclone `listremotes` ile bölüm doğrulaması) YAPILMADI ve
gerekmiyor:** iki noktalı ama tanımsız bir hedefte (`gdrve:`) rclone zaten hata
veriyor → `ok:false`. Sessiz olan tek şekil iki noktasızdı ve o kapandı. Her
süpürmeye bir süreç çağrısı daha eklemenin kazancı yok.

## 2026-09-10 — O-1 kapatıldı: "Otomatik yedek saati" ölü bir kumandaydı [ÇEKİRDEK]

Kullanıcı sunucudaki oturuma "gece yedeğini bizim backend mi alıyor?" diye sordu
ve cevap iki sistemi ayırdı — aynı cevap O-1'in hâlâ açık olduğunu da gösterdi.

**SAHADAKİ DÜZEN (doğrulandı 2026-09-10):**
- **Dump'ı backend ALMIYOR.** Windows Görev Zamanlayıcı görevi
  (`TeksERP-DB-Backup-Yeni`, SYSTEM, her gece 03:00) `yedekle.ps1`i koşuyor;
  o da `pg_dump`ı doğrudan çağırıp `pg_restore --list` ile doğruluyor.
  Backend'e hiç bağlı değil — **bilinçli**: backend çökmüş ya da durdurulmuşken
  bile gece yedeği alınır (devir sırasında API kapalıyken fiilen test edilmiş).
- **Drive'a göndermeyi backend YAPIYOR** (saat başı `[offsite]` süpürücüsü).
- Backend'in kendi zamanlayıcısı KAPALI ve bunu açılışta söylüyor.

**BİLİNMESİ GEREKEN SINIR:** "yedek var" ile "yedek makine dışında" ayrı
şeylerdir; ikincisi backend'in ayakta olmasını gerektirir. Backend uzun süre
kapalı kalırsa dump'lar yerelde birikir, offsite'a çıkmaz (backend dönünce
süpürme telafi eder — `missing` kümesi tam da bunun için var).

**O-1 — ÖLÜ KUMANDA.** Bu düzende paneldeki "Otomatik yedek saati" hiçbir şey
yapmıyordu: alan yalnız backend'in kendi zamanlayıcısını yönetiyor, o da kapalı.
Kullanıcı saati değiştirdi, gerçek yedek başka saatte alınmaya devam etti —
**panel bir saat gösteriyor, sistem başka saatte yedek alıyor ve ikisinin ilgisi
yok.** Operatör bunu ancak dışarıdan ölçerek anlayabilirdi.

**Düzeltme:** `GET /backups` artık `scheduleEnabled` taşıyor; panel kumandayı
DEVRE DIŞI bırakıyor ve sebebini yazıyor: *"gece yedeğini harici bir zamanlanmış
görev alıyor — backend kapalıyken de yedek alınsın diye böyle kurulmuş. Saat
buradan değişmez; gerçek saat sunucudaki görevden ayarlanır."*

**Kumanda GİZLENMEDİ, kilitlendi.** Gizlemek "böyle bir ayar yok" derdi; oysa
ayar var ve başka bir yerden yönetiliyor — operatörün bilmesi gereken tam olarak
bu. Kullanıcının soracağı tek soru "peki nereden değişir" ve cevabı ekranda.

**Yüklem TEK:** uç `BACKUP_SCHEDULE_ENABLED !== "false"` diyor, yani
`backup-scheduler`ın `=== "false"` kapısının birebir tersi — **tanımsız = AÇIK**.
İki yerde iki farklı yüklem yazmak, panelin "açık" dediği bir kurulumda
zamanlayıcının kapalı olması demekti; bekçi üç değerde de ikisini karşılaştırıyor.

**Geriye uyum:** alan opsiyonel; göndermeyen eski sunucuda kumanda bugünkü gibi
açık kalır. Sorgu henüz dönmemişken de açık — yükleme anında kilitlenmiyor.

**Bekçiler:** `test_backup.ts §S` (+4 kontrol) ve
`Electron BackupScheduleCard.test.tsx` (5 kontrol). Dört negatif sonda ısırdı:
alan yükten düşürüldü (4 kırmızı) · yüklem ters çevrildi (2) · `disabled`daki
kapı kaldırıldı (1) · `!== false` yerine `=== true` (1 — eski sunucuda kumandayı
yanlışlıkla kilitlerdi).

**Sunucudaki oturumun ikinci notu:** `TeksERP-DB-Backup` adında ikinci bir görev
daha var — eski kurulumun görevi, **Disabled**, donmuş `tekserp` veritabanını
yedekliyordu. Silinmedi, kapatıldı. Bilerek duruyor.

## 2026-09-10 — Tanımlayıcı dili: kuralın yarısı ölçülmüyordu [ÇEKİRDEK]

Kullanıcı sordu: *"değişken isimlerini hep Türkçe mi verdik, karışık mı? bununla
ilgili bir standardımız var mı?"* Kural VARDI ([IL-16]: "Tanımlayıcılar
İNGİLİZCE ve ASCII") ama **zorlama yalnız yarısını tutuyordu**: ESLint
`naming-convention` sadece TÜRKÇE KARAKTERİ (ç, ğ, ı, ö, ş, ü) yasaklıyor.
`cozAdRejimi`, `zamanlayiciAcik`, `musteriAdiVeya`, `TasiIsrarla` gibi ASCII
yazılmış TÜRKÇE KELİMELER kapıdan geçiyordu.

**Ölçüm (2026-09-10):** backend `src/` 72 · panel `src/` 43 · bekçiler 299.
Dağılım tesadüf değil — ama yazılı bir kural da değildi, kendiliğinden oluşmuş
bir alışkanlıktı. **Aynı oturumda ben 8 tanımlayıcı bu şekilde ekledim ve hiçbir
kapı ses çıkarmadı.** Ölçülmeyen kural bir temennidir.

**KARAR (kullanıcı):** kodu kurala uydur + tekrarı engelle.

**① Yeniden adlandırma.** Bu oturumda üretim koduna eklenen adlar İngilizceye
çevrildi: `AdRejimi`→`DocNameMode` · `cozAdRejimi`→`resolveDocNameMode` ·
`musteriAdiVeya`→`customerNameOr` · `surecUyarilariniLogla`→`logProcessWarnings`
· `yiginIzi`→`stackTrace` · `zamanlayiciAcik`→`schedulerEnabled` ·
`OzetSerit`→`RepairSummary` · `SevkiyatTablosu`→`RepairShipmentTable` … ve
karşılık gelen alan adları (`adRejimi`→`docNameMode`). **Devralınan adlara
dokunulmadı** — 134 ad dondurulmuş durumda.

**⚠️ İKİ ŞEY BİLEREK ÇEVRİLMEDİ:** (a) `scripts/` bekçileri — 299 Türkçe ad,
yerleşik düzen, bekçi iç araçtır ve sözleşme taşımaz; çeviri hiçbir şey
kazandırmazdı. (b) `deploy/kur.ps1` — dosya baştan sona Türkçe (`Adim`, `Ok`,
`Uyar`, `Pm2Kos`) ve kendi içinde tutarlı; [IL-16] TS tanımlayıcılarının kuralı.

**⚠️ BİR AD ÇEVRİLİRKEN ÇAKIŞMA DOĞDU:** Excel sütun anahtarı `musteriAdi`
→ `customerName` yapılınca `products[].customerName` (donmuş belge alanı) ile
çakıştı ve bekçi "anahtar eklenmemeli" kontrolü kırmızı verdi — HAM veri ile
ÇÖZÜLMÜŞ (fail-open uygulanmış) değeri aynı ada koymak, ikisini ayırt
edilemez yapardı. Çözülmüş değer `docCustomerName`e taşındı ("belgede basılan").
Sonda olmasa sessiz geçerdi.

**② Kapı: `scripts/test_identifier_language.ts`.** Neden ESLint değil: Türkçe
kelime sözlüğü bir regex'e konsaydı yanlış pozitif patlaması olurdu — TR etiketli
VERİ anahtarları ([EL-34] onları açıkça muaf tutuyor), `ceki`/`desen` gibi
yerleşik domain terimleri. Bekçi bunları ADIYLA ve GEREKÇESİYLE muaf tutabilir.

**Taban SAYI DEĞİL AD KÜMESİDİR** ve bu bir düzeltmedir: ilk yazım sayı tutuyordu
ve bir ad eklenip başka biri silinince sayı aynı kalıyor, yeni Türkçe ad sessizce
geçiyordu. Ayrıca kırmızı mesajı "son 5 bulgu"yu basıyordu — YENİ olanı değil.
Ad kümesi ikisini birden çözer.

**BEKÇİ İLK YAZIMDA VAKUMEN YEŞİLDİ.** Taban dosyası yalnız tavan DÜŞÜNCE
yazılıyordu; ilk koşumda sayım tavana eşit olduğu için dosya hiç oluşmadı ve her
koşum tavanı KENDİ SAYIMINDAN üretti. `src/`e Türkçe bir ad eklendi, bekçi yeşil
kaldı. Sonda olmasa fark edilmezdi — bu oturumdaki İKİNCİ vakum-yeşil vakası
(diğeri `test_process_warnings` §4).

**Yanlış pozitifler ÖLÇÜLEREK elendi, tahminle değil:** ham `includes` `radius`
("adi"), `DefectSeverity` ("veri"), `TamburUndoPreview` ("tambURUNdo") yakalıyordu
→ eşleme camelCase PARÇASINA taşındı ve `veri`/`adi`/`sira` kökleri listeden
çıkarıldı. Kalan çakışmalar `EN_CAKISMA` kümesinde adıyla: `partial` ×26,
`listener` ×7. Bulgu 324 → 134'e indi.

**Kapıda koşuyor** (`pre-commit`, yalnız `src/` değişince, 0,4 sn) — çünkü bu tam
olarak "commit ederken fark edilmezse bir daha hiç fark edilmez" sınıfı.

**Dört negatif sonda:** backend `src/`e Türkçe ad → kırmızı (adıyla) · panel
`src/`e Türkçe ad → kırmızı · `partialListeners`/`radius`/`verifyPart` → YEŞİL
(yanlış pozitif yok) · bir ad çevrilince küme sıkışıyor.

## 2026-09-10 — FABRİKA PROD LOG'UNDAN ÜÇ BULGU [ÇEKİRDEK]

Kaynak: `errorlogs/` — 04.09–10.09 arası **47.645 istek**, 6 açılış. **5xx SIFIR**,
çökme yok, yakalanmamış istisna yok. 223 adet 4xx'in neredeyse tamamı tasarlandığı
gibi çalışan akışların normal adımıydı (44 `by-card` 400'ü kurşun bypass'ın kendisi
— hepsi aynı saniyede `bypass-complete` 200 ile eşleşiyor, 44↔44; 5 `initial-entry`
409'u mükerrer kapısı, beşinde de operatör onaylayıp devam etmiş). Log'un asıl
değeri **üç sessiz sınıfı** görünür kılması oldu.

### ① BELGE ŞABLONU ÖNİZLEMESİ DAR İZİNLİ TASARIMCIYA 403 VERİYORDU

`POST /api/printed-documents/:docType/sample-html` **yalnız `admin:settings`**
taşıyordu; ekranın kendisi 2026-08-05'te `DOCUMENT_DESIGN_READ`e taşınmıştı.
`document-template:read` ile giren büro personeli ekranı açıyor, soldaki ayarı
yapıyor, sağdaki önizleme sessizce 403 alıyordu. Belge tasarım yüzeyinin DÖRT
ucundan üçü (`free-document`, `traveler-template`, `traveler-card/sample-html`)
o turda taşınmıştı — bu biri ATLANMIŞTI. `traveler-card.routes.ts:133-141`'de
aynı hatanın düzeltme yorumu birebir duruyor, yani sınıf zaten biliniyordu.

**Bekçi neden yakalamadı:** `test_document_template_permission.ts` iki sabit
listeyi (backend ↔ Electron) ve dört route'u ölçüyordu; **önizleme uçlarının
ikisi de senaryo listesinde YOKTU**. Boşluk tam oradan sızdı. İkisi de eklendi,
körlük zemini 6→8. Negatif sonda: eski guard geri konunca 2 kırmızı.

### ② "BAS" AUDİT İZİ `null`A GİDİYORDU — SESSİZ KAYIP

`POST /api/labels/rolls/null/print` → 400. `LabelPreviewSheet.handlePrint` önce
`onPrint(payload)` çağırıyor, parent (`TamburScreen.tsx:6601`) o sırada sheet'i
kapatıp `rollId`yi null'a çekiyor; `printMut.mutate()` gövdesi ise **bir sonraki
render'ın kapanışıyla** koşuyor ve `rollId!` "null" stringine dönüşüyordu.

Bu **2026-08-13'teki "kesimde kat sessizce düşüyordu"** notunun ikizi: her ikisinde
de mutation gövdesi kimliği/alanı KAPANIŞTAN okuyor. Kural aynı: **mutation'a giden
her kimlik ve alan DEĞİŞKENDEN geçer, kapanıştan değil** — kapanış bir sonraki
render'ın olabilir.

Zararı sessizdir ve bu yüzden ağır: fiziksel baskı ÇALIŞIYOR, yalnız `LABEL_PRINTED`
audit'i düşmüyor. Kimse "etiket basılmadı" diye şikâyet etmez; eksik olan yalnız izdir.
`onPrintStock` yolu da aynı hatayı taşıyordu. Üç projede aynı şekil tarandı: `mutationFn`
içinde nullable `!` kullanan 8 yer daha var ama hepsinde diyalog mutation'dan SONRA
kapanıyor — ulaşılabilir değiller, dokunulmadı.

### ③ KAPANIŞ 5sn'yi DOLDURDUĞUNDA SEBEP HİÇBİR YERDE KALMIYORDU

6 kapanışın 2'si (09-07 03:35 ve 05:48) `process.exit(1)` ile zorla bitti ve log'da
tek cümle vardı: "Kapanış 5s'de tamamlanmadı". Hangi adımda takıldığı ÇIKARILAMIYOR.
İki teşhis denemesi ÖLÇÜMLE ÇÜRÜTÜLDÜ ve bu not onları da kaydeder ki üçüncü kez
denenmesin:

- **"Boştaki keep-alive soketi bloklar"** → YANLIŞ. Node 19'dan beri `server.close()`
  onları zaten kapatıyor; gerçek sunucuyla SIGTERM provası keep-alive soket açıkken
  **0,53 sn**'de temiz kapandı.
- **"`Promise.all([tx.*])` / advisory kilit"** → YANLIŞ. Üç proje AST ile tarandı,
  sıfır bulgu; interaktif tx + 8021 kilidi yerelde denendi, uyarı çıkmadı.

Kalan neden ölçüldü: **yarım kalan bir istek**. Sunucuya eksik başlıklı bir istek
gönderilip SIGTERM atıldığında fabrikadaki iz BİREBİR üredi — 5,12 sn, "Sunucu
kapandı." satırı YOK. Kritik körlük şu: **erişim log'u isteği yalnız BİTTİĞİNDE
yazar**, yani asılı bir istek hiç iz bırakmaz ve log'a bakarak asla bulunamaz.

Bu yüzden düzeltme değil ÖLÇÜM eklendi: kapanışa faz etiketi + zorla-çıkış anında
açık bağlantı sayısı. Bağlantı > 0 ise asılı istek, 0 ise zincir fazın kendisinde
durmuş. Bir sonraki kapanış nedeni ADIYLA söyleyecek — tahminle kapatılmadı.

### Log'un kapatmadığı iki şey (kayda geçsin)

- **192.168.1.56 panel 2.5.0'da kalmış** ve rapor menüsünün TAMAMI 404 veriyor
  (11 uç). Auto-update `b57c9c68` ile **2.8.2**'de geldi — o pakette updater kodu
  YOK, makine kendini asla güncellemeyecek. Elle kurulum şart. Yan bulgu: sistemde
  hangi makinenin hangi sürümü koştuğunu gösteren HİÇBİR yüzey yok (`Device`'ta
  sürüm kolonu yok), bu yüzden bir panel haftalarca 4 sürüm geride görünmez kaldı.
- **Sevkiyat defter onarımı görüldü ama uygulanmadı:** `shipping:repair-allocation`
  09-07 03:35'te yazıldı, 14:56'da iki `preview` açıldı, **tek POST yok**.

### Zaten kapalı çıkanlar

`a48f5329` (2026-09-06, "fabrika logundan cikan iki saha sorunu") bu paketteki çuval
404'ünü ve okutma 409'unu kapatmış: düzeltme öncesi 11 silmenin 11'i 404 üretiyordu,
sonrasında 11 silme 0 hata; okutma 409'u 6→0 (383 okutmada). Offsite açılış uyarısı
da aynı gün `7b84d5ea` ile yanlış-alarm gerekçesiyle kaldırılmış.

## 2026-09-10 — Backend sürüm belgesi: paneldeki kapının simetriği kuruldu [ÇEKİRDEK]

Kullanıcı sordu: *"neden bir update-notes gibi bir klasör içine her sürüm için
yazacağın notları yazmıyorsun kalıcı olarak?"* — ve haklıydı, ama boşluk
sandığı yerde değildi.

**NE VARDI:** `surum-notlari.json` — 13 yayın, **platform ayrımlı zaten**
(`kapsam: panel|tablet|her-ikisi`), git'te versiyonlu, uygulama içinde gösteriliyor,
`check-surum-notlari.mjs` ile kapıya bağlı. Operatör notları YAZILIYORDU.

**NE YOKTU:** backend'in hiçbir sürüm belgesi. `surum-notlari.json` "sunucu"
kapsamını BİLEREK reddediyor (operatör sunucuyu görmez — doğru karar), ama sonuç
şuydu: 2.9.0→2.9.9 arasında backend'de ne değiştiği okunabilir hiçbir yerde
yoktu. `docs/history/SURUM-*-DEPLOY.md` deseni denenmiş ve **2026-08-25'te
ölmüştü** — çünkü hiçbir kapı onu istemiyordu.

**ZARARI ÖLÇÜLDÜ, VARSAYILMADI.** Aynı gün, aynı oturumda:
- Kurana "2.9.6 → 2.9.8" denildi; sahadaki **2.9.7**'ydi. "Bu turda değişti"
  sayılan üç maddenin ikisi zaten canlıydı. Sunucudaki oturum yakaladı.
- `dist-web`in yeniden derlendiği beyan edilmemişti; yine o oturum yakaladı.
- Kurulum talimatı (SHA, beklenen sürüm, migration beklentisi, sınırlar,
  doğrulama listesi) **her seferinde elden yazılıyordu** — ve o mesaj zaten
  eksik olan belgenin ta kendisiydi.

**ÇÖZÜM: yeni sistem icat etmek değil, PANELDE ÇALIŞAN DESENİ BACKEND'E TAŞIMAK.**
- `docs/surumler/backend-<sürüm>.md` — sürüme bağlı, tarihe değil (git etiketiyle
  aynı ada oturur). Ad sahibini taşır → panel/tablet ileride katılırsa yapı değişmez.
- **Yedi sabit başlık.** Serbest metin altı ay sonra doldurulamaz; sabit başlık
  soruyu SORMAYA zorlar — `dist-web` tam da "ne değişti" başlığı olmadığı için
  atlanmıştı.
- **Kapı `paketle.ps1`de**, sürüm çözüldükten hemen sonra, ağır işten (npm ci +
  tsc + zip ≈ 3 dk) ÖNCE. Eksik belge 0. dakikada bulunur, 3. dakikada değil.
- **İŞ BÖLÜMÜ:** PowerShell yalnız "dosya var mı" der (markdown ayrıştırmak orada
  yanlış yer); içeriğin DOLU olduğunu bekçi ölçer. İkisi ayrı olmasaydı boş bir
  dosya açıp paketi geçirmek mümkün olurdu — kapı tam da kapatmak için var olduğu
  şeye izin verirdi.
- **ÜÇ ALANI MAKİNE YAZAR** (paket adı · SHA256 · commit): paketleme bitmeden
  bilinemezler ve 64 karakterlik bir özeti insanın kopyalaması tam da hatanın
  çıkacağı yerdir. Belge böylece kendini doğrular: içindeki özet, üretilen zip'in
  özetidir. Bekçi `_(paketleme doldurur)_` işaretini MEŞRU sayar, kalan her
  `<...>` yer tutucusunu kırmızı verir.

**GEÇMİŞ SÜRÜMLER YAZILMADI** (2.9.0–2.9.8). Arşivde varlar; geçmişi uydurmak
belgeyi güvenilmez yapardı. Bekçi VAR OLAN dosyaları ölçer, eksik olanı istemez —
eksik olanı `paketle.ps1` ister, yalnız üretilmekte olan sürüm için.

**REDDEDİLEN ALTERNATİF:** `surum-notlari.json`ı dosyalara bölmek. Onu üç şey
okuyor (kopyalama script'i, kapı, uygulama içi görüntüleyici); "daha okunabilir
olsun" diye çalışan bir VERİ artefaktını üç tüketicisiyle birlikte kırmak sıfır
kazanç, gerçek risk. JSON veri artefaktıdır, markdown belge artefaktıdır —
ayrı şeyler, ayrı okurlar.

**BEKÇİNİN KENDİ KUSURU SONDAYLA BULUNDU:** "cevaplanmış mı" kontrolü `\s*`
kullanıyordu ve SATIR SONUNU GEÇİP bir sonraki satırı cevap sayıyordu —
`**Var mı:**` boş bırakılınca altındaki `**Toplam migration:** 238` satırını
okuyup YEŞİL kalıyordu. `[ \t]*` ile düzeltildi. **Bekçinin kapatmak için var
olduğu şey (dolu görünen boş alan) bekçinin kendisinde vardı.**

---

## 2026-09-10 — Paketleme grubu: çuvalları sevk hazırlığına göre ayıran çalışma yaftası [ÇEKİRDEK/PROFİL]

### Saha sorusu

"Paketleme/çuvallar ekranında partilere ayırmalı mıyız? Bir carinin birden fazla
zamanda yapılacak sevkiyatı hazırda bekliyorsa?"

### Ölçüm

⚠️ **DÜZELTME (aynı gün):** aşağıdaki üç ölçüm TABLET ekranına
(`mobil/.../PaketlemeScreen`) aittir ve orada DOĞRUDUR — ama fabrikanın
kullandığı yüzey o DEĞİL. Kullanıcı beyanı: *"tabletteki sevkiyat ekranlarını şu
an kullanmıyoruz"* (geçici). Fabrikanın kullandığı yüzey PANELDE:
**Operasyon → Paketleme/Çuvallar** (`Electron/src/pages/Operations/SackContentEdit/`).

Bunun bağlayıcı sonucu: **panelde "sessiz yanlış sevk" tehlikesi YOKTUR.**
`CreateShipmentDialog` sevkiyatı SEÇİLİ çuvallardan kurar (`sacks:
ShipmentDialogSack[]`), "hepsini gönder" diye bir buton yoktur. Yani grubun
panel tarafındaki gerekçesi güvenlik değil DÜZEN: bloklara ayırma, gruba not,
grup filtresi, grup çıktısı. Tehlike argümanı yalnız tablet açıldığı gün
geçerlidir ve o gün "Hemen Sevk Et" daraltılmalıdır.

Tablet ölçümü (bugün kullanılmıyor, açıldığı gün geçerli):

- Liste 20'den uzunsa yalnız **son 20 çuval** çiziliyor (`SACK_WINDOW = 20`),
  gerisi gizli.
- **"Hemen Sevk Et" seçim TANIMIYOR**: `shippableSacks` = içi dolu her havuz
  çuvalı. Salı tırı için basılan buton gelecek haftanın çuvallarını da aynı
  sevkiyata koyuyor. Bu bir ekran rahatsızlığı değil, **sessiz yanlış sevk**.
- Ayırt edici tek imkân `sackNo` araması — yani operatörün aklında tuttuğu numara.

Yani sorunun kaynağı "gruplama yok" değil, **"gruplama yok + toplu buton var"**
birleşimi. Dilim 2'de buton daraltması yaftanın İÇİNE gömülüyor.

### Karar — yafta, rezervasyon DEĞİL

**[ÇEKİRDEK]** `PackingGroup`: bir carinin havuz çuvallarını "aynı sevke
hazırlananlar" diye ayıran çalışma nesnesi. Stok düşmez, çuvalı kilitlemez,
deftere yazmaz, başka bir sevkin o çuvalı almasını ENGELLEMEZ. Gerçek
rezervasyon ayrı karardır ve dokunulmadı (`shipping.reservationEnabled` — kendi
append-only defteriyle kurulur, `SackAllocation`a DOKUNMAZ).

**[ÇEKİRDEK] Üyelik çuvalın üstünde** (`Sack.packingGroupId`), ayrı pivot tablo
DEĞİL. Gerekçe mimari: çuvalı havuzdan çıkaran her MEVCUT yol (sevk · dağıtma ·
storno · çuval silme) grubu kendiliğinden doğru tutuyor. Ayrı üyelik listesi
olsaydı o yolların hepsine birer temizlik kancası gerekirdi ve unutulan biri
hayalet üyelik bırakırdı — bu depoda adı konmuş "ayrışan yüzey" sınıfı.

**[ÇEKİRDEK] Grup SİLİNMEZ, GÖRÜNMEZ olur.** "Canlı grup" = havuzda en az bir
çuvalı olan grup (`sacks.some(shipmentId: null)`, tek kaynak `LIVE_GROUP_WHERE`).
Son çuval çıkınca grup listelenmez ve numarası sayaçta sayılmaz. Ölümü SİLME ile
kurmak yukarıdaki beş yola kanca takmak demekti; bu tasarımda silme yolu hiç
doğmuyor.

**[ÇEKİRDEK] Sevkte `packingGroupId` TEMİZLENMEZ.** İki kazancı var: sevk anında
"grubun notu sevkiyata kopyalansın mı?" sorulabiliyor (kullanıcı kararı: SORULUR,
onaylanırsa kopyalanır — Dilim 2), ve `undoDispatch({releaseSacks})` çuvalı havuza
geri koyduğunda hazırlık grubu OLDUĞU GİBİ geri geliyor. Storno'nun sözleşmesi
"mal HİÇ ÇIKMADI"dır; hazırlığın da hiç bozulmamış olması doğru cevaptır.

**[ÇEKİRDEK] Numara KİMLİK DEĞİL, PARK YERİDİR.** Görünen ad ekrandan ibarettir:
belgeye, etikete, irsaliyeye BASILMAZ — bu yüzden geri kullanılabilir. Kimlik
`PackingGroup.id`dir (`Batch` ile aynı karar: P01…P99 sarar, kimlik UUID). Saha
"Excel/PDF çıktısı da olsun" dedi; çelişki ÇALIŞMA KÂĞIDI ayrımıyla çözüldü —
çıktının başlığı **cari + grup + üretim anı** taşır ve belge numarası yoktur, o
yüzden iki kâğıt yan yana geldiğinde hangisinin hangisi olduğu okunur (Dilim 3).

**[PROFİL] Sayaç rejimi `artan`** (`packing.groupNumbering`, varsayılan): yeni
grup CANLI grupların en büyüğünün bir fazlasını alır. "3. Grup sevk edildi, 5.
Grup duruyor" → yeni grup 6. Kullanıcı kararı; boşluğu doldurmanın yan etkisi
aynı gün aynı cari için iki farklı "3. Grup" dolaşmasıydı. ⚠️ İki rejim de
YALNIZ canlı gruplara baktığı için carinin havuzu tamamen boşaldığında sayaç
kendiliğinden 1'e döner — `artan` rejiminde bile numara sonsuza büyümez.
Alternatif rejim `bosluk-doldur` yazıldı ve panelden seçilebilir.

**[PROFİL] Görünen ad `"P1"`** (`formatPackingGroupName`, tek satır).
⚠️ Bu, notun ilk hâlindeki kararın TERSİ — aynı gün kullanıcı kararıyla
değiştirildi. İlk yazımda `"1. Grup"` seçilmişti; gerekçe, fabrikada "parti"
kelimesinin bugün ÜRETİM partisi olmasıydı (`Batch`, P01…P99, refakat kartına
basılı, KK1'de geçiyor) ve aynı fabrikada iki farklı "P3"ün dolaşacak olmasıydı.
Kullanıcı çakışmayı görüp BİLEREK kabul etti: saha zaten "P1" diyor ve sahanın
kendi kelimesini ekranda değiştirmek, çakışmadan daha pahalı.

Çakışmanın zararsızlığı ÖLÇÜLDÜ ve bir KOŞULA bağlı: grup adı HİÇBİR BELGEYE
BASILMIYOR (etiket · irsaliye · rapor — hepsinin dışında), yani iki P3 bir
KAYDI bozamaz; olsa olsa telefonda bir cümleyi belirsizleştirir. ⚠️ Muafiyet
adın EKRANDA KALMASINA bağlıdır — grup adı bir gün belgeye ya da rapora
girecekse (aynı kâğıtta iki farklı P3) bu ön ek yeniden düşünülmelidir. Koşul
`formatPackingGroupName` başlığında yazılı.

**[ÇEKİRDEK] Bir çuval TEK grupta** (kullanıcı kararı). `packingGroupId` tekil
kolon; başka gruptaki çuval seçilirse TAŞINIR. Aksi hâlde "sevk butonu grubu
gönderir" cümlesi bozulurdu.

**[PROFİL] Gruplanmamış çuval bugünkü gibi davranır** (kullanıcı kararı): ekranda
"Gruplanmamış" başlığı altında durur, bir grup gibi sevk edilebilir. Sevk için
grup ZORUNLU DEĞİL.

**[ÇEKİRDEK] Ad tekilliği yalnız CANLI gruplar arasında** ve UYGULAMA katmanında.
DB'de partial unique KURULAMAZ: "canlı" tanımı ÇOCUK satıra bakıyor ve bir unique
index başka tabloyu okuyamaz. Yarışı kapatan şey aşağıdaki advisory kilittir.

### Eşzamanlılık

**[ÇEKİRDEK] Advisory uzay 8031** (`PACKING_GROUP_LOCK_NS`,
`services/helpers/packing-group.helper.ts`) — parti no'nun 8022'sinden AYRI
tutuldu; aynı uzayda olsalardı üretim partisi üreteci ile paketleme sayacı
birbirini sessizce serileştirirdi. Kilit `nextPackingGroupSeqTx`in **İLK
İFADESİ**dir, anahtarı `hashtext(customerId)` (gruplar cariye özel olduğu için
iki cari birbirini beklemez). Sonraya alınsaydı klasik TOCTOU: iki tablet aynı
saniyede "Parti Ata"ya basar, ikisi de aynı numarayı alır — hata yok, log yok.

**[ÇEKİRDEK] Çuval bağlama ATOMİK CLAIM**: yüklem `updateMany`nin WHERE'inde
yaşıyor (`shipmentId: null` + `customerId`), `findUnique→if→update` DEĞİL.
Sayı tutmazsa tanı **tx içinde taze okumayla** konuyor ve mesaj "kaç tanesi"
değil "hangisi ve neden" söylüyor (sevkiyata girmiş / başka cariye ait /
bulunamadı, çuval numaralarıyla).

**[ÇEKİRDEK] İdempotency**: `PackingGroup.clientToken @unique`. Replay'in
DÖRDÜNCÜ DURUMU ele alındı — token'lı grup bu arada BOŞALMIŞSA cached kaydı
dönmek yanlış cevaptır (operatöre boş grup gösterirdi), 409 verilir.

### Kapı

**[ÇEKİRDEK]** `packing.groupsEnabled` varsayılan **KAPALI** = bugünkü davranış
(düz liste + "hepsini sevk et"). Yazma uçları TEK noktadan fail-closed kapılı
(`assertPackingGroupsEnabled` → 403 `PACKING_GROUPS_DISABLED`); okuma kapılı
DEĞİL (kapalıyken zaten boş döner). Yazma ucu açık bırakılsaydı eski/başıboş bir
istemci GÖRÜNMEYEN grup yaratabilirdi: çuvallar bir gruba bağlanır, hiçbir ekran
çizmez, operatör "çuvalım nerede" derdi.

### Kod çapaları

- `prisma/schema.prisma` — `model PackingGroup` + `Sack.packingGroupId`
- `src/services/packing-group.service.ts` (5 genel metot) ·
  `src/services/helpers/packing-group.helper.ts` (sayaç · canlı yüklem · claim ·
  ad tekilliği; servis 300 satır lint tavanına çekilirken ayrıldı)
- `src/services/helpers/period-guard.helper.ts` — 8031 envanter satırı
- `src/services/shipping.service.ts` — `listCustomerPoolSacks` artık
  `packingGroupId` ve `groups[]` döner (istemci ikinci tur atmasın)
- `src/routes/shipping.routes.ts` — `/api/shipping/packing-groups` ailesi;
  ⚠️ sabit `/remove-sacks` yolu `/:id`li yollardan ÖNCE mount edilir
- İzin: YENİ İZİN YOK — mevcut `READ`/`WRITE` (paketleme işi)

### Bekçi

`scripts/test_packing_group.ts` — 24 kontrol, §1-§12.
**Negatif sonda (beşi de ölçüldü, 2026-09-10):** kilit okumalardan sonraya
alındı → 1 kırmızı · `artan` dalı `seqs.length + 1` yapıldı → dosya kırmızı ·
`LIVE_GROUP_WHERE` boşaltıldı → 5 kırmızı · kapı gövdesi `return` yapıldı →
7 kırmızı · claim WHERE'inden `shipmentId: null` silindi → 1 kırmızı.

### Üç kapı

**Migration VAR** — iki dosya: `20260910120000_paketleme_grubu` (tablo + kolon +
index + FK) ve `20260910123000_paketleme_grubu_client_token`. İkincisi ayrı,
çünkü birincisi uygulanmıştı ve uygulanmış migration dosyası düzenlenmez.
İkisi de ADDITIVE ve idempotent. **Yeni izin YOK.** **APK GEREKMEZ — Dilim 2 OTA
ile gider** (düzeltme, aynı gün: not ilk yazıldığında "APK gerekir" deniyordu ve
bu YANLIŞTI). Tablet tarafı saf JS: ekran + servis çağrısı. APK ayrımının ölçütü
`mobil/CLAUDE.md`de yazılı — yeni native modül · izin · ikon · SDK; Dilim 2'de
bunların hiçbiri yok, `runtimeVersion` değişmiyor, `versionCode`a dokunulmuyor.
Mekanik kapı: `npm run yayinla:check -- --musteri=<kod>` (native parmak izi) —
kanal TAHMİN EDİLMEZ, o komuta sorulur. Backend tek başına da gidebilir: bayrak
varsayılan kapalı olduğu için eski tablet hiçbir şey görmez ve bugünkü düz
listede kalır.

### Dilimler

① backend (BU NOT — bitti) → ② PANEL "Paketleme/Çuvallar" ekranı (Electron +
web AYNI kod tabanı, `build:web`): grup şeridi (cari seçiliyken), "Grup" sütunu,
mevcut toplu-aksiyon çubuğuna "Parti Ata", grup notu/adı, sunucu tarafı grup
filtresi → ③ grup çıktısı (mevcut "İçerik Dökümü" üreticisinden doğar, ikinci
rakam üretmez; başlıkta cari + grup + üretim anı) → ④ tablet, ancak o ekranlar
yeniden açıldığında; oradaki iş "Hemen Sevk Et"in DARALTILMASI.

⚠️ ② için tasarım kararı: grup listede İÇ İÇE BLOK BAŞLIĞI olarak çizilmez.
Çuval listesi cursor'lu bir tablodur; blok başlığı sayfalamayla kavga eder ve
"liste + cursor + özet şeridi TEK where'den doğar" kuralını bozar. Blok hissi
şerit + sütun + sunucu süzmesiyle kurulur.

## 2026-09-10 — KÜNYESİZ İSTEMCİ GÖRÜNMEZDİ: sürüm UA'dan okunuyor [ÇEKİRDEK]

Saha vakası: `192.168.1.56`daki panel **2.5.0**'da kalmıştı, rapor menüsünün
TAMAMI 404 veriyordu (11 uç) ve bu **haftalarca** fark edilmedi.

**ÖNCE YANLIŞ TEŞHİS KOYDUM, ÖLÇÜMLE DÜZELTTİM** — kayda geçsin:
"sistemde hangi makinenin hangi sürümü koştuğunu gösteren yüzey yok, `Device`a
sürüm kolonu ekleyelim" dedim. **Yanlıştı ve neredeyse var olanı yeniden
yazıyordum:** `486dfb0e` (2026-09-04) ile *Sistem → Bağlı İstemciler* ekranı
ZATEN var — kurulum, sürüm, beklenen sürüm, "güncel değil" rozeti, son
kullanıcı. Üstelik sektör standardına uygun: sürüm **User-Agent'tan
ayıklanmıyor, `X-Client-Version` başlığıyla BEYAN EDİLİYOR**.

**GERÇEK BOŞLUK ÇOK DAHA DARDI** (`client-info.middleware.ts` satır 42):
`X-Client-Instance` yoksa middleware hiç kayıt açmadan çıkıyordu. Künye
başlıkları 2026-09-04'te geldi → ondan eski panel onları GÖNDERMEZ → makine
listede *"sürümü bilinmiyor"* olarak DEĞİL, **HİÇ** görünmüyordu.

**Kural bu vakadan çıkıyor: görülmesi en gereken istemci, kendini tanıtamayacak
kadar eski olandır.** Bir envanter ekranı yalnız kendini bildirenleri
listeliyorsa, tam da aradığı kitleyi kaçırır.

**ÇÖZÜM — beyan tercih, UA yedek** (Sentry SDK etiketi ↔ UA, Datadog agent ↔ UA
ile aynı düzen): başlık varsa yedek yola hiç gelinmez. Gelindiğinde satır
`declared:false` damgası taşır ve ekran *"sürümünü bildirmiyor — adres
bilgisinden okundu"* yazar. Çıkarılmış sürümü beyan edilmiş gibi göstermek
okuyucuyu yanıltır; ayrıca damganın kendisi bir bulgudur (beyan etmeyen kurulum
zaten 2026-09-04 öncesidir). Damga TEK YÖNLÜ kalkar: güncellenen istemci
künyesini bildirmeye başlayınca "beyan"a yükselir, tersi olmaz.

**KAPSAM BİLEREK DAR — yalnız Electron paneli.** Tablet UA'sı `okhttp/4.12.0`
yani KÜTÜPHANE sürümüdür; onu uygulama sürümü saymak sahada "tablet 4.12.0"
gibi var olmayan bir sürüm gösterirdi — **yanlış bilgi, bilgisizlikten
kötüdür**. Tablet OTA alır, tarayıcı her açılışta taze gelir; "aylardır eski
sürümde" durumuna yalnız elden kurulum isteyen panel düşer.

Ad **kara listeyle** ayrıştırılır, beyaz listeyle değil: uygulama adı müşteri
markasıdır (paket adı argümandan gelir) ve önceden bilinemez. Motor jetonları
(`Chrome/`, `Electron/`, `AppleWebKit/`, `okhttp/`, `curl/`…) elenir, kalan
jeton uygulamanındır. Yedek kimlik `legacy:<sha1(ip|ua)>` — IP **soketten**
okunur, başlıktan DEĞİL (`CLIENT_IP_HEADER` dersi: uydurulabilir başlık deftere
sınırsız sahte satır açtırırdı).

**UÇTAN UCA ÖLÇÜLDÜ:** gerçek sunucuya fabrikanın tam UA'sıyla künyesiz istek
atıldı → defterde `kind=electron version=2.5.0 declared=false`; aynı turda
`okhttp/4.12.0` satır AÇMADI. Değişiklikten önce o satır hiç yoktu.
Bekçi `test_client_registry.ts §5` fabrikanın GERÇEK UA'larını kullanır —
Türkçe karakterin bozulmuş hâli (`Adnan?ahinERP`) bilerek korunur, çünkü UA
taşımada bozuluyor ve ayrıştırma buna dayanmamalı.
Negatif sonda: motor jetonu elemesi kaldırılınca 2 kırmızı.

⚠️ **KALAN SINIR (bilinçli):** defter süreç belleğindedir, backend yeniden
başlayınca boşalır ve istemcinin ilk isteğiyle geri dolar. Saha vakası bunu
GEREKTİRMEDİ (o panel 1s40dk boyunca 226 istek attı, yani defterde olacaktı);
kalıcılık ancak "haftada bir açılan makine" için gerekir. `Device`a kolon
eklemek o gün ölçülerek yapılır, bugün değil.

## 2026-09-10 — Sevk irsaliyesi: liste sayfalarına kimlik şeridi + tek seferlik kâğıt boyu [PROFİL/ÇEKİRDEK karma]

**Saha bildirimi (adnansahin, WhatsApp).** İki şikâyet geldi: ① *"listeleri
yazdırdığımda kağıdın ufak bir bölümüne yazdırıyor ve yazılar küçük kalıyor"*
② *"hangi firmanın malı olduğu, sevk no vs. bilgilerin olduğu bölüm senin listede
sadece ürün listesinde var; onu ürün/çuval/çeki her listenin başında görünecek
şekilde ayarlayabilir misin"*. Ekli iki fotoğrafta bizim çıktımız ile eski
sistemin çıktısı yan yanaydı.

### ① Kök sebep: A5 ayarı, A4 kâğıt — KOD HATASI DEĞİL [PROFİL]

Fotoğraftaki oran ölçüldü: içerik kâğıdın %62'sini kaplıyor, iki yanda ~%19
boşluk var. A5 yazı alanı = 148mm − 2×9mm kenar = **130mm**; A4'ün 210mm'sinde
bu tam %62 eder. Chromium `@page size: A5`i A4 kâğıda **büyütmez**, olduğu gibi
ortalar. Üstüne `doc-density.ts` A5 profili puntoyu ×0.85 küçültüyor — "yazılar
küçük kalıyor" da buradan.

Doğrulandı: Belge Kişiselleştirme → Sevk İrsaliyesi → Sayfa boyutu **A5**
seçiliydi. Tablolar zaten `width:100%`; genişlik hatası yoktu.

**Bunun iki ikincil sonucu var ve ikisi de koda iş çıkardı:**

- Sayfa boyutu `DocumentConfig.style`in parçası ve freeze anında snapshot'a
  donuyor (`printed-document.service.ts:278` `docConfigOverride`). Yani ayarı
  A4'e çevirmek **eski irsaliyeleri düzeltmiyor**. Panelde tek çare
  "Güncel görünüm"dü ve o düğme yalnız `templateStale` iken beliriyor, üstelik
  yalnız `PrintedDocDialog`ta var — muhasebedeki "Fiş" penceresinde yok.
- Backend'de tek seferlik ezme **zaten vardı** (`?pageSize=A4|A5`,
  `printed-document.controller.ts:203` → `service.ts:584` `withPageSize`,
  snapshot'ın KOPYASINI kurar) ama panelde düğmesi yoktu; yalnız refakat kartı
  kullanıyordu. Ürün kararı: donmuş katmana hiç dokunmadan doğru kâğıda basmak
  için **her belge penceresine kâğıt boyu seçici** konur.

Ayrıca panelde A5 seçilince uyarı basılır (`DocumentStyleControls.tsx`) —
aynı tuzağa bir daha düşülmesin.

### ② Kimlik şeridi — `sections.listHeader` (OPT-IN) [PROFİL]

`shipment-dispatch.html.ts`te `splitPages = meta.mergeSections !== true` üç
listeyi ayrı sayfaya bölüyor (`.pgb { break-before: page }`) ama `<header>`
`.sheet`in tepesinde **bir kez** basılıyor → 2. ve 3. sayfa çıplak tablo.

**Sektör standardı** (SAP SmartForms "first page header ↔ next page header",
Oracle Reports, Logo/Netsis/Mikro): 1. sayfa tam antet, sonraki sayfaların
TEPESİNDE kısaltılmış devam başlığı, altta sayfa numarası. Müşterinin eski
sistemi de tam olarak böyle basıyor (başlık kutusu → `Sevk Edilen Firma /
Sevkiyat Fiş No` → tarih sağda → tablo) ve talebin kelimesi de "her listenin
**başında**" idi.

**Karar:** şerit tabloların `thead`'ine, caption ile kolon başlıkları arasına
girer; İLK basılan listeye KONMAZ.

- `thead` içinde olması LOAD-BEARING: `DOC_PAGINATION_CSS`in
  `table-header-group` kuralı sayesinde tablo sayfa sınırını aşınca şerit
  **devam sayfasında da tekrar eder**. Tablonun dışına blok koymak bunu vermez.
- İlk listeye konmaması sahanın istemediği tekrarı önler (o sayfada zaten tam
  antet var). Kalan tek açık: ilk liste tek başına sayfayı taşarsa devam sayfası
  şeritsiz kalır. Ürün listesi ürün+renk+en bazında gruplandığı için bunun için
  ~50+ farklı ürün satırı gerekir; kabul edildi. Gerekirse `position:fixed`
  sayfa altı şeridi EK olarak konur (filigranın kanıtlanmış mekanizması).
- `?merge=1` ile listeler tek sayfada aktığında şerit hiç basılmaz — orada
  hiçbir liste antetten kopmuyor, şerit yalnız gürültü olurdu.
- Şeridin alanları başlık toggle'larına saygılı: `sections.docNo` / `date`
  kapalıysa şeride de girmez.

**OPT-IN olması ZORUNLUYDU.** `sectionOn` bir BLOCKLIST'tir (`!== false`,
anahtar yoksa AÇIK); işaretsiz bırakmak bugüne kadar donmuş HER irsaliyenin
yeniden baskısını sormadan değiştirirdi. Renderer `cfg.sections?.listHeader
=== true` okur, panel `DocSectionDef.defaultHidden: true` taşır. Bu, bölümlerde
**allowlist dalının ilk gerçek kullanıcısı** — alan 2026-08-05'ten beri
tanımlıydı ama hiçbir bölüm kullanmıyordu (`documentConfig.ts:211` yorumu artık
bayat, güncellendi).

Kapsam bilerek DAR: yalnız sevk irsaliyesi. Diğer belgelerde çok listeli sayfa
bölme yok. Müşteri bazına inmek gerekirse ek kod istemez — `DocumentProfile.config`
genel ayarın üstüne biniyor (`printed-document.service.ts:253-271`).

### Donmuş katman ≠ donmuş kod (bu işin asıl dersi) [ÇEKİRDEK]

`PrintedDocument.snapshot` HTML tutmaz; `{ company, docConfigOverride, doc }`
JSON'u tutar ve HTML her baskıda renderer'dan yeniden üretilir. Yani **donan şey
AYAR, kod DEĞİL**: `renderShipmentDispatchHtml`teki her değişiklik eski
belgelerin çıktısını da değiştirir, `docConfigOverride` bunu durdurmaz. Belgeye
görünür bir şey ekleyen her iş bu yüzden opt-in doğmak zorundadır.

### Kod çapaları

- `doc-table.ts` — `buildDocTable`a `identityRow?: {left,right}`; thead'e
  caption'dan sonra basılır, tek kolonlu tabloda iki değer tek hücrede birleşir.
- `shipment-dispatch.html.ts` — `showListHeader` (`=== true`), `identityRow`,
  `secClass()` → `secOpts()` (sayfa sınıfı + şerit tek yerden), `.sec thead
  th.ident` CSS'i (`:not(.caption)` kuralından SONRA — eşit özgüllük, sonra gelen
  kazanır; sıra bozulursa şerit kolon başlığına benzer).
- `LABELS.tr.identTo = "Sevk Edilen Firma"` / `en.identTo = "Consignee"`.
- `Electron/src/components/print/PrintPageSizeToggle.tsx` — YENİ, tek kaynak.
  `readDocPageSize(html)` belgenin kendi boyutunu `@page`ten okur.
  `PrintedDocDialog`, `ShipmentDispatchNote` ve `TravelerCardPrintDialog`
  (kopyası silindi) bunu kullanır.
- `PrintedDocDialog` / `ShipmentDispatchNote` — `docPageSize` YALNIZ ezme
  YOKKEN okunur; ezmeli HTML'in `@page`i ezmeyi yansıtır ve onu "belgenin
  boyutu" sanmak düğmeyi kilitlerdi (A5 belge → A4 seç → dönüş yolu kalmaz).
- `documentConfig.ts` — `listHeader` bölümü `defaultHidden: true`;
  `docRows.ts` `SECTION_GROUP.shipmentDispatch = { listHeader: "table" }`
  (eşleşmemiş bölüm dalının varsayılanı `header`, yazılmazsa ayar ilgisiz
  biçimde başlık bandının altında çıkardı — `gridWidth` emsali).
- `DocumentStyleControls.tsx` — A5 seçiliyken uyarı şeridi.

### Bekçiler

- `scripts/test_shipment_dispatch_document.ts §3` (8 yeni kontrol, toplam 50):
  varsayılan kapalı · `false` da kapalı · açıkken 2 tabloda · ÜRÜN'de YOK
  (konum ölçüsü, düz `includes` ayırt edemez) · `thead` içinde · `?merge=1`
  kapalı · tek liste seçiliyse kapalı · docNo kapalıyken şeritte yok.
  **Negatif sonda:** opt-in `!== false`e çevrilince 2 kırmızı; ilk-liste
  atlaması kaldırılınca 4 kırmızı.
- `Electron/src/components/print/PrintPageSizeToggle.test.tsx` (8 vaka) —
  en önemlisi "belgenin kendi boyutuna basmak ezmeyi KALDIRIR".
- `Electron/src/pages/GeneralSettings/docRows.test.ts` — yeni "bölüm ALLOWLIST"
  bloğu (6 vaka). **Negatif sonda:** `defaultHidden` kaldırılınca 2 kırmızı.
- Backend `?pageSize=` ucu zaten `test_doc_pagesize_override.ts` ile korunuyordu.

### Üç kapı

Migration **yok** (ayar `SystemSetting` JSON'unda). Yeni izin **yok** (mevcut
`document-template:write` yeterli — `DOCUMENT_DESIGN_FLAG_KEYS` testinden geçer:
"yanlış girilirse etkisi belge çıktısıyla sınırlı mı?" → evet). APK **yok**
(mobil sevk irsaliyesi basmıyor).

---

## 2026-09-10 — Üç belge yüzeyi tek modalde birleşti (F1) [ÇEKİRDEK]

Kullanıcı sözü: *"2 tane ayrı modal olması çok kafa karıştırıcı."* Plan:
`docs/design/BELGE-YUZEYI-BIRLESTIRME.md` (uygulandı ve SİLİNDİ — hikâyesi bu nottur; git `5d72338a`).

### Dert

Muhasebe → Sevkiyatlar satırında **Fiş** ve **Belge** diye iki düğme vardı ve
ikisi de AYNI HTML'i (`renderShipmentDispatchHtml`) gösteriyordu. Ölçüldüğünde
asıl sorun bu değildi: aynı belgenin **üç** yüzeyi vardı (Sevkiyatlar → İrsaliye
`ShipmentDispatchNote`, Muhasebe → Fiş `DispatchReceiptDialog`, Muhasebe → Belge
`PrintedDocDialog`) ve üçü de birbirinin eksiğiydi — Excel yalnız Fiş'te, sürüm
çubuğu Fiş'te YOK, baskı seçenekleri ve belge notu yalnız İrsaliye'de, PDF yalnız
Belge'de. Muhasebeci Excel için birini, sürüm için ötekini açmak zorundaydı;
sevkiyatçı PDF alamıyordu.

### Karar — SLOT, registry DEĞİL

`PrintedDocDialog` 24 çağıranı olan JENERİK bileşendir. Sevk irsaliyesine özgü
şeyleri (Excel, toplu top etiketi, iade uyarısı, belge notu, liste seçimi) onun
içine gömmek `components/print/` → `pages/Operations/…` yönünde ters bağımlılık
kurardı ve jenerik bileşen bir belge TÜRÜNÜ tanır hâle gelirdi. Bunun yerine
`PrintedDocDialog` **slot** alır, sayfa katmanı doldurur:
`toolbarPrintMenu` · `toolbarDownloads` · `optionsExtras` · `infoBar` ·
`printParams`. Slot geçmeyen 22 çağıranın belge ÇIKTISI bayt-bayt aynı kalır
(değişen yalnız araç çubuğu düzeni — bilinçli, tek tasarım).

`printParams`ın ikinci işi var: bir anahtarı sayfa katmanı sahiplenince o
parametrenin YERLEŞİK kontrolü çizilmez. İki kutucuk aynı bayrağı sürseydi
kullanıcı hangisinin geçerli olduğunu bilemezdi.

### Ne değişti

- **YENİ** `components/print/PrintedDocToolbar.tsx` — tek çubuk:
  `[Yazdır ▾] [İndir ▾] [Baskı seçenekleri ▾] [A4|A5]`. Eskiden bu kalemler
  diyalog gövdesine dikey serpiliyordu (not alanı + iki tik + footer).
  "Yazdır" ek kalem YOKSA sade düğmedir, menü açmaz.
- **YENİ** `pages/Operations/Shipments/ShipmentDocDialog.tsx` + `shipmentDocSlots.tsx`
  — sevkiyata özgü her şeyi kuran tek yüzey; `SHIPMENT_DISPATCH` ve
  `SUBCONTRACTOR_DIRECT_SHIP` ikisini de bilir.
- `PdfSaveButton.tsx` — `usePdfSave` hook'u ayrıldı (düğme + menü kalemi tek
  kaynaktan; `window.api` yokluğu iki yerde ayrı kontrol edilmesin).
- `DispatchPrintOptions` → `DispatchPrintOptionsContent` (kendi popover'ı yok;
  ortak "Baskı seçenekleri ▾" gövdesine slot olarak girer).
- `BulkRollLabelButton` — opsiyonel KONTROLLÜ mod (`open`/`onOpenChange`):
  düğme çizilmez, açılışı çağıran sürer. Menü kalemi kendisi kapandığı için
  düğme menünün içinde kalsaydı önizleme de sökülürdü.
- Muhasebe satırındaki **iki düğme tek düğmeye** indi ("İrsaliye").
- **SİLİNDİ** `ShipmentDispatchNote.tsx`, `DispatchReceiptDialog.tsx`. Bununla
  birlikte `ShipmentDispatchNote.tsx:186`'daki BAYAT yorum da gitti
  ("PrintedDocDialog'a SHIPMENT_DISPATCH hiç düşmüyor" — 2026-09-07'den beri
  muhasebe ekranı tam olarak onu yapıyordu).

### Ölçülmüş iki davranış düzeltmesi

1. **Rapor tembel oldu.** Eski Fiş her açılışta `getReport`/`getDirectReport`
   koşuyordu; belgeye BAKMAK için açan kullanıcı o isteği hiç kullanmıyordu.
   Artık slot ("İndir ▾" / etiket kalemi) mount olunca isteniyor.
2. **`allowDraft` sabitlenmedi.** `ShipmentDispatchNote` her zaman `draft:true`
   geçiyordu, muhasebe "Fiş" hiç geçmiyordu. Yeni bileşende sevkiyat
   DURUMUNDAN türüyor (`status !== "DISPATCHED"`). Durum bilinmiyorsa taslak
   AÇIK kalır — Hızlı Sevk'ten dönen sevkiyat bayrağa göre PLANNED de olabilir
   (`createShipmentFromRolls`), sabit `DISPATCHED` varsaymak o dalda belgeyi
   boş gösterirdi.

`reissueOnlyWhenReconstructed` korundu: sevk irsaliyesi içeriği sevk anında
donar, normal revize aynı içeriği tekrar dondururdu. Düşürülseydi muhasebeye
anlamsız bir "Revize Et" düğmesi çıkardı.

### Bekçi

`Electron/src/pages/Operations/Shipments/ShipmentDocDialog.test.tsx` (4 vaka).
**Negatif sonda — dördü de kırmızı görüldü:** (a) docType'ı sabit
`SHIPMENT_DISPATCH` yapmak → §1b kırmızı; (b) `reportQ.enabled`ından
`reportWanted`ı düşürmek → §2 kırmızı; (c) Excel kalemini jenerik araç çubuğuna
gömmek ve (d) etiket kalemini "Yazdır" menüsüne gömmek → §3 kırmızı.

⚠️ Sondanın kendisi bir tuzak gösterdi: §3 ilk yazılışında `window.api.pdf`
stub'ı yoktu, "İndir ▾" hiç çizilmiyordu ve "Excel kalemi yok" iddiası BOŞTA
kalıyordu (sonda C yeşil geçti). Stub eklenince kırmızıya döndü. Menü içindeki
bir kalemi ölçen test, menünün gerçekten AÇILDIĞINI da ölçmek zorundadır.

### Üç kapı

Migration **yok** · yeni izin **yok** (`shipping:write` yeterli) · APK **yok**
(mobil sevk irsaliyesi basmıyor). Backend HİÇ değişmedi.


---

## 2026-09-10 — Paketleme grubu Dilim 2: panel yüzeyi, sıralama sınırı, döküm ad rejimi, hızlı iz [ÇEKİRDEK/PROFİL]

Önceki not: *Paketleme grubu: çuvalları sevk hazırlığına göre ayıran çalışma
yaftası* (backend). Bu not onun panel yarısı ve saha turunda eklenen dört isteği.

### Saha istekleri (kullanıcı, 2026-09-10)

1. Grup panelde görünsün — "Electron ve web panelinde". (Aynı kod tabanı:
   `build:web` ile ikisi de derleniyor; tek iş.)
2. Filtreleme ve sıralama da olsun; not ve ize göre de.
3. Çıktıda kumaş/renk adı bizden mi müşteriden mi — bayrağa bağla ve **ilgili
   modala koy**.
4. Çuvala hızlı iz ekleme tuşu; partiye iz ekleme; iz ekle/kaldır/değiştir kolay olsun.

### Karar — ŞERİT + SÜTUN, iç içe blok başlığı DEĞİL

**[ÇEKİRDEK]** Gruplar listenin İÇİNDE blok başlığı olarak çizilmez. Çuval
listesi keyset cursor ile sayfalanır; blok başlığı ikinci sayfada grubun yarısını
bırakır ve "liste + cursor + özet şeridi TEK where'den doğar" kuralını bozar.
Bunun yerine listenin üstünde **grup şeridi** (çipler) ve satırda **Grup sütunu**:
çip listeyi SUNUCUDA süzer, yani seçilen grubun TAMAMI gelir.

**[ÇEKİRDEK]** Şerit YALNIZ bayrak açık VE süzgeçte TEK cari varken çizilir.
Gruplar cariye özeldir; çok carili listede iki farklı "P1" yan yana gelir ve
numara benzersizmiş yanılgısı üretir.

**[ÇEKİRDEK]** Çip filtreyi yazarken `cursor` URL'den SİLİNİR. Bırakılsaydı yeni
süzgeç ESKİ süzgecin sayfa imleciyle devam eder ve liste sebepsiz boş görünürdü.

### Karar — SIRALAMA SINIRI ölçüldü ve yazıldı

**[ÇEKİRDEK]** `sortBy` allowlist'i yalnız `Sack`ın SKALER kolonlarını kabul eder:
`createdAt | sackNo | notes | weightKg` (son ikisi bu turda eklendi, `nulls: "last"`
+ cursor'da null fazı). Kabul EDİLMEYENLER ve gerekçeleri:

- **grup ve iz** → İLİŞKİ. Prisma sıralayabilir ama `dynamicCursorWhere` tek bir
  skaler kolon üzerinde `gt`/`lt` kurar; ilişki sıralaması sayfa sınırında satır
  atlatır/tekrarlatır.
- **metraj ve top adedi** → bu sorguda YOK; sayfa çekildikten SONRA ayrı bir
  `groupBy` ile hesaplanıyor. SQL sıralamasına giremez.

Kullanıcıya söylendi: bu ikisi için doğru araç sıralama değil FİLTRE. Sıralamak
isteniyorsa listeyi offset sayfalamaya çevirmek gerekir — büyük tabloda yasak.

**[ÇEKİRDEK]** Not METNİNDE arama eklendi (`noteText`, `contains` +
`mode:"insensitive"`). Serbest `search` kutusuna KARIŞTIRILMADI: o kutu kimlik
arar (çuval no / cari / sevkiyat no) ve not metnini oraya katmak "TR-4521" yazan
bir notu çuval numarası sanılan satırlarla karıştırırdı.

### Karar — GRUBUN TAMAMINA işlem yapan uçlar kapsamı SUNUCUDA çözer

**[ÇEKİRDEK]** `getContentDump` ve `SackTagService.bulkTags` artık
`packingGroupId` kabul eder ve çuval id'lerini kendileri çözer (kapsam:
`shipmentId: null`, grubun canlı tanımı). İstemcinin seçili satırlarından kurulan
kapsam, liste cursor'lu olduğu için grubun YARISINI işlerdi — "P2'nin dökümünü
al" dendiğinde eksik döküm, "gruba iz bırak" dendiğinde yarım gruba iz. İkisi de
sessiz yanlış cevap sınıfı.

### Karar — DÖKÜM AD REJİMİ

**[PROFİL]** `shipping.sackDumpNameMode`: `ikisi` (VARSAYILAN = bugünkü çıktı) |
`bizdeki` | `musterideki`. Ayar VARSAYILANI belirler; **döküm penceresi tek
seferlik ezer ve ayarı DEĞİŞTİRMEZ** (kâğıt boyu seçicisiyle aynı kalıp —
kullanıcı "flagı direkt ilgili modala koyabilirsin" dedi, ikisi birden yapıldı:
kalıcı ayar panelde, tek seferlik seçim menüde).

**[ÇEKİRDEK]** `musterideki` FAIL-OPEN DEĞİL: müşterinin karşılığı yoksa hücre
BOŞ kalır, bizim adımız müşterinin adıymış gibi basılmaz. ⚠️ Bu, sevk
irsaliyesindeki `docItemNameMode` ile BİLEREK ters yöndedir — orası müşteriye
giden RESMİ belgedir ve boş hücre kabul edilemez; bu döküm İÇ çalışma kâğıdıdır
ve "bunun müşteri karşılığı yok" ambarcı için gerçek bir bilgidir (kullanıcı
kararı: "kararı sen ver" → boş bırakılsın). Excel'de mod sütun KÜMESİNİ daraltır;
sütunu gizlemek ile boş bırakmak farklı sözlerdir (biri "bu kâğıtta o dil yok",
diğeri "karşılığı yok").

**[ÇEKİRDEK]** Kartela satırı da AYNI rejimden geçer — top tablosu müşteri adını
basarken kartelanın bizim adımızı basması tek kâğıtta iki dil olurdu.

### Karar — İZ KOLAYLIKLARI

**[ÇEKİRDEK]** Hızlı iz tuşu HER satırda (İz sütununda, ikon boyutunda) ve
izsiz çuvalda da durur — eskiden boş hücrede hiçbir giriş yoktu, iz bırakmak için
satırı seçip toplu menüye gitmek gerekiyordu. Aynı üç-durumlu popover kullanılır
(bırak → kaldır → dokunma), yani ekleme/kaldırma/değiştirme tek yerden. Katalog
sorgusu yalnız popover AÇILINCA koşar; her satır bir istek atmaz.

**[PROFİL]** "Partiye iz" = GRUBUN ÇUVALLARINA iz (kullanıcı kararı: "kararı sen
ver"). Grubun KENDİ iz tablosu AÇILMADI — iz zaten "nesnenin kendisini
değiştirmeyen işaret" olarak tanımlı ve o nesne çuvaldır; çuval gruptan çıkınca
izi üstünde kalır (doğru davranış). Gruba özel söz söylemenin yeri GRUP NOTUDUR.

### Kod çapaları

- `Electron/src/pages/Operations/SackContentEdit/PackingGroupBar.tsx` (şerit +
  grup menüsü + düzenleme penceresi) · `AssignPackingGroupDialog.tsx` ("Parti Ata")
- `sacksColumns.tsx` — Grup sütunu, hızlı iz tuşu, `notes`/`weightKg` sıralanabilir
- `SacksListView.tsx` — şerit yerleşimi, "Parti Ata" toplu aksiyonu
- `SackTagsBulkMenu.tsx` — `compact` (satır içi) + `packingGroupId` (grup kapsamı)
- `sackDump/dumpHtml.ts` + `dumpSheets.ts` — ad rejimi · `SackContentDumpMenu.tsx` — tek seferlik seçim
- Backend: `sack-search.service.ts` (grup filtresi · sıralama allowlist'i · not metni ·
  döküm grup kapsamı) · `sack-tag.service.ts` (bulk grup kapsamı) ·
  `system-setting.service.ts` (`sackDumpNameMode`)

### Bekçi

- `Teks-Erp/scripts/test_packing_group.ts` §13/§14 (30 kontrol). Negatif sonda:
  filtre WHERE'i silindi → 3 kırmızı; dökümdeki grup çözümü silindi → §14 düştü.
- `Electron/.../packingGroupUi.test.ts` (16 kontrol, §1-§8). Negatif sonda (dördü
  de ölçüldü): `cursor` silme kaldırıldı → 1 kırmızı · grup sütunu adı `seq`ten
  kuruldu → 1 kırmızı · `musterideki` FAIL-OPEN yapıldı → 1 kırmızı · Excel mod
  koşulları kaldırıldı → 2 kırmızı.

### Sonradan kapatılan açık (aynı gün)

Kural "grup çıktısının başlığı cari + grup + üretim anı taşır" diye yazılmıştı
ama ilk uygulamada başlık YALNIZ cari ve basım anını taşıyordu — **grup adı
yoktu**. Bu, numaranın geri kullanılabilir olmasının TEK dayanağını boşa
çıkarıyordu: geçen haftanın "P2" kâğıdı ile bugünkü P2 ayırt edilemezdi.
`SackDumpOptions.scopeLabel` eklendi; başlık tek cariyse cari adını kendisi
ekliyor ve Excel özetine "Kapsam" sütunu YALNIZ grup dökümünde çiziliyor.
Bekçi: `packingGroupUi.test.ts §9` (negatif sonda: etiket başlıktan düşürüldü →
kırmızı).

### Üç kapı

Migration **yok** (bu turda şema değişmedi). Yeni izin **yok**. APK **yok** —
tablet bu turda hiç değişmedi (saha beyanı: tabletteki sevkiyat ekranları şu an
kullanılmıyor, geçici). Panel Electron paketiyle gider; `build:web` aynı kodu
web'e de taşır.

---

## 2026-09-10 — DEFTER-ÖNCELİKLİ MİMARİ: hard delete yok · izlenebilirlik defterle · geri alma ters kayıttır [ÇEKİRDEK]

> ⚠️ **KISMEN GEÇERSİZ (2026-09-12)** — "ileri damgayı null'lamak yasaktır" cümlesinin `remainderClosedAt` örneği DÜŞTÜ: o kolon damga değil DURUM bayrağıdır (defteri `RollVariance(SUBCONTRACTOR_REMAINDER)`), null'a dönebilir → bkz. "2026-09-12 — DURUM BAYRAĞI ≠ DAMGA: `remainderClosedAt` yasak listesinden çıktı".

Kullanıcı üç ilke koydu ve bunlar tek bir doktrinin üç yüzüdür:

1. **Programda hard delete istemiyorum.**
2. **İzlenebilirlik/sorgulanabilirlik istiyorum, bunu hareket (transaction) tablolarıyla yapmak istiyorum.**
3. **Bir şeyi geri aldığımızda onu gerçekten geri almak değil, aynı işlemin tersini yapmak istiyorum — geri alma o işi hiç yapılmamış gibi göstermemeli, yıkıcı yöntem olmamalı.**

Doktrinin adı: **defter-öncelikli (ledger-first)**. Durum tabloları "şu an ne"yi
tutar; defterler "ne oldu"yu tutar ve **"ne oldu" asla değişmez**. Emsali SAP'nin
malzeme belgesidir: silinemez, yalnız storno atılır (MBST). Bizde `CariTransaction.reversesTxnId`,
`WarehouseEventType.SHIPMENT_REVERSAL` ve `RollVariance.reversedAt` zaten bu
desendir — sorun eksiklik değil **tutarsızlıktı**.

### Saha sorusu ve ölçüm

Soru şöyle başladı: "audit hangi tabloda" → "audit'ten iş verisi okuyor muyuz,
bu yanlış değil mi" → "eksik transaction tablolarımız var mı". Üç tarama koşuldu
(şema · servis katmanı · 13 alanlık sektör kapsamı) ve ortak kök şu çıktı: proje
defter mimarisini DOĞRU kurmuş ama **tutarlı uygulamamış**; boşluk hissedilen her
yerde geliştirici `system_logs`'a (audit) uzanmış — oysa audit 6 ayda arşivlenir
ve iş verisi taşıyamaz.

**ÖLÇÜM DÜZELTMESİ (bu notun en önemli parçası).** `docs/standart/VERITABANI.md`
§9 "sekiz hard delete sitesinin sekizi de meşru istisna" diyordu. 2026-09-10'da
yeniden sayıldı: **87 site** var —

- 17 doğrudan `prisma|tx|db.<model>.delete(` çağrısı
- 70 `.deleteMany(` çağrısı
- ayrıca `base.service.ts:1280` jenerik `hardDelete()`, master-data servislerinin
  ortak yolu (site sayısına dahil değil, çarpan)

Eski "sekiz" ölçümü yalnız bir alt kümeyi (muhtemelen tekil `.delete()`in bir
kısmını) saymış; `.deleteMany()` hiç görülmemiş. **Kapısız kural bir niyet
beyanıdır** ([DB-35]) — burada niyet ile gerçek arasındaki fark 11 kattı.

`.deleteMany()` model dağılımı (ilk sıralar): `rollOperation` 7 · `rollProperty` 5 ·
`workOrderToOrderLine` 4 · `rollMovement` 4 · `sackAllocation` 3 · `workSession` 2 ·
`userPermission` 2 · `paymentAllocation` 2 · `itemAllowedColor` 2 · `stationProperty` 2 …

### Karar

**A. Hard delete varsayılan olarak KAPALI.** Eski dört sınıf ikiye iner:

| Eski sınıf | Yeni hüküm |
|---|---|
| ① Bağımlılık-guard'lı silme (master-data permanent · boş çuval · cihaz unpair) | **KALKAR** → `isActive:false` / `SackStatus.VOIDED` / `DeviceEvent` defter satırı. Guard kalır, silme gider. |
| ② Alias / karar satırı | **KALKAR** → `revokedAt`/`revokedById`; yeni satır eskisini geçersizler, UNIQUE partial'a döner |
| ③ Pivot / çocuk satır replace | **İKİYE BÖLÜNÜR** — aşağı bak |
| ④ Deftere hiç yazmamış taslak (atomik claim'li) | **KALIR** — hiçbir şey olmadıysa geri alınacak bir şey de yoktur |

**③'ün bölünmesi doktrinin en ince yeri.** Ölçüt: *satırın parasal/ticari/kalite
sonucu var mı?*

- **③a TİCARİ pivot** (`ItemPrice` · `SackAllocation` · `PaymentAllocation` ·
  `WorkOrderToOrderLine` · belge satırları): versiyonlanır ya da ters kayıt alır.
  Sil-yaz YASAK.
- **③b YAPILANDIRMA pivotu** (`RollProperty` · `StationProperty` ·
  `ItemAllowedColor` · `ItemAllowedProperty` · `RouteStepProperty` ·
  `PermissionTemplateItem` · `CustomerTemplateRoute` · `LabelContextDefault` ·
  `PeripheralTemplateRoute` · `SubcontractorToCategory` · `StationColor`):
  sil-yaz KALIR — ama **değişikliğin KENDİSİ** bir karar defterine yazılır.
  Yüzlerce ayar satırını versiyonlamak tabloyu şişirir ve hiçbir soruyu
  cevaplamaz; cevaplanan soru "bu ayarı kim ne zaman değiştirdi"dir ve onun yeri
  pivot satırı değil karar satırıdır.

**B. İzlenebilirlik audit'ten değil defterden okunur.** `system_logs` teknik izdir,
6 ayda arşivlenir, **iş kararına giremez**. Bir soru iş kararına giriyorsa cevabı
bir hareket tablosunda ya da kalıcı kolonda durur. Ölçüt tek cümle: *bilgi iş
kararına giriyorsa deftere, yalnız denetime giriyorsa audit'e.*

**C. Geri alma = ters kayıt.** Sözleşme:

> Geri alma, ileri işlemin **ters kaydını bugüne yazar**; ileri kaydı ne siler ne
> değiştirir. İşlem sonrası DURUM ileri-öncesi durumla aynı olabilir; DEFTER asla
> aynı olmaz.

Bundan çıkan üç yasak: (i) defter satırı silmek, (ii) ileri damgayı `null`'lamak
(`dispatchedAt`/`dispatchedById`/`weighedAt` gibi), (iii) ileri satırın üzerine
yazmak.

### Doktrinin bugün ihlal edildiği yerler (bu notun açtığı iş)

Üç taramanın kesişimi. Her biri ayrı iştir, bu not yalnız kuralı koyar:

- `shipping.service.ts:3634` — sevk geri almada `dispatchedAt`/`dispatchedById` → `null`.
  `Shipment` modelinde `cancelledAt`/`cancelledById`/`cancelReason` kolonu HİÇ YOK
  (37 modelde var, iptal edilebilen tek belgede yok). SoD izni `shipping:undo-dispatch`ın
  kalıcı izi yok.
- `inventory.service.ts:3761` `restoreCancelledRoll` — iptal kolonlarını `null`lar,
  `WarehouseMovement` yazmaz; `WarehouseEventType`te `CANCEL_REVERSAL` yok.
- `return.service.ts:942` `cancelReturn` — ileri yol `:576` `RETURN` yazıyor, geri yol
  hiçbir şey yazmıyor; enum'da `RETURN_REVERSAL` yok.
- ⚠️ **DÜZELTME (2026-09-11)** — "fason asimetrisi metrajı İKİ KEZ saydırıyor" iddiası
  ÖLÇÜLDÜ ve YANLIŞ çıktı. `tekserp_demo`da çift-sayma adayı **0 top / 0 m**:
  fasona çıkan 364 topun (`AT_SUBCONTRACTOR` 31 + `SUBCONTRACTOR_CONSUMED` 333)
  HİÇBİRİNİN `warehouseId`'si yok, dolayısıyla hiçbirinin ENTRY satırı da yok —
  çıkış satırı da gerekmiyor. `writeWarehouseMovement` from/to boşken zaten satır
  yazmıyor (`warehouse-ledger.helper.ts:49`). Fason dönüşünde doğan topa ENTRY
  yazmak DOĞRU: mal gerçekten dışarıdan geldi ve ebeveyn defterde hiç yoktu.
- `subcontractor.service.ts:6438` — fasondan doğrudan sevkte mal firmadan çıkıyor,
  depo defterinde iz yok.
- `subcontractor.service.ts:5152`/`:5683` — doğan topların iptali ham `updateMany`,
  `inventory.softDelete` kapısını hiç geçmiyor → askıda ENTRY.
- `inventory.service.ts:3934` `hardDelete` (arşivleme) — kardeş `softDelete` `:3606`
  CANCEL yazarken bu yol yazmıyor.
- `kartela.service.ts:330`/`:680` — kartela sevki ve tüketiminde çıkış satırı yok.
- `RollOperation` 7 yerde `deleteMany` — şema başlığı append-only diyor, kod siliyor.
  "Bu topa kurşun uygulandı mı" sorusunun cevabı geriye dönük değişiyor.
- `RollMovement` — `updatedAt` taşıyor (`:3591`), bir satır iki olay tutuyor,
  4 yerde siliniyor; üstelik `recompute` statüyü BU tablodan türetiyor
  (`workorder-manual-move.service.ts:662`) → hem defter hem durum kaynağı.
- `ChequeEvent` — `ENDORSE`/`PAY`/`BOUNCE`/`RETURN` ileri olaylarının ters yolu YOK
  (`cheque.service.ts:1454` yalnız `[PORTFOLIO, AT_BANK, ISSUED]` kabul eder);
  `CariTxnSource`ta `CHEQUE_BOUNCE_CANCEL` de yok → cari bakiye kalıcı yanlış kalır.
- `PaymentAllocation` — çözme hard delete (`payment-allocation.service.ts:369`, `:868`);
  `Invoice.paidTotal`/`Payment.allocatedTotal`/`Cheque.allocatedTotal` düşer, satır kalmaz.
- `Sack.weightKg` — yeniden tartı üzerine yazar (`shipping.service.ts:1539`),
  sıfırlama tamamen siler (`:1633`). İrsaliyeye giden brüt kg'ın önceki değeri
  hiçbir kalıcı kolonda yok.
- `permission-management.service.ts:351`/`:434` — izin geri alma hard delete; SoD
  üçlüsünün geçmişi kalıcı değil.
- `master-data-merge.service.ts:148` — birleştirme geri alınamaz, taşınan satır
  dökümü yalnız audit yükünde.

### ÖLÇÜM (2026-09-11) — `WarehouseMovement` bir STOK DEFTERİ DEĞİLDİR

Yukarıdaki düzeltmeyi kovalarken asıl bulgu çıktı ve tek tek eksik çağrılardan
DAHA ÖNEMLİ: defter satırı yalnız topun `warehouseId`'si DOLUYKEN yazılır
(`warehouse-ledger.helper.ts:49` — from/to boşsa sessizce atlar). Üretimdeki top
depoya `finalize`/statü terfisiyle girer ve terfi bilinçli olarak satır YAZMAZ
("konum değişmiyor", helper başlığı). Sonuç: defter yalnız **dışarıdan gelen malın**
geliş/gidişini tutar, deponun kendisini değil.

`tekserp_demo` ölçümü (defter başlangıcı 2026-09-01, 842 satır):

- Defter sonrası doğan **1.231 topun yalnız 751'inde** defter satırı var; 838'inde
  `warehouseId` dolu → **87 top depoda ama defterde hiç yok**.
- Mutabakat (yalnız defter sonrası kohort): defter net **68.834,8 m** ↔ canlı depo
  **74.204,1 m** → fark **−5.369,3 m**.
- `CANCELLED` 69 topun **0'ında** CANCEL satırı var — hepsinin `warehouseId`'si
  boş olduğu için. Yani `softDelete`'in defter yazımı pratikte hiç ateşlenmiyor.
- Kartela: `AT_KARTELA` 6 + `KARTELA_CONSUMED` 8 topun ENTRY'si de çıkışı da 0.
- Sevk: defter sonrası doğan 3 `SHIPPED` topun 3'ünde de SHIPMENT satırı var (✅).
- İade: 2 iadenin 2'sinde de RETURN satırı var (✅); iptal edilmiş iade yok, o yüzden
  `RETURN_REVERSAL` boşluğu veriyle DOĞRULANMADI — kod boşluğu olarak durur.

**Karar gerektiren soru:** defter "dışarıdan gelen malın geçmişi" olarak mı kalacak
(bugünkü tutarlı hâli), yoksa gerçek bir STOK DEFTERİNE mi dönüşecek (her depoya
giriş/çıkış, terfi dahil)? İkincisi doktrinin (izlenebilirlik defterle) gereğidir
ama `warehouseId` atayan HER yolun deftere bağlanmasını ister. Bu ayrı bir karardır.

### Bilinen bedeller (baştan kabul edildi)

1. **UNIQUE kısıtları kırılır.** Silinmeyen satır çakışır; kısıtlar
   `WHERE "revokedAt" IS NULL` partial'ına döner. Desen zaten var
   (`item_price_default_uq`), yaygınlaştırılacak. Her yeni partial `test_db_invariants`
   envanterine yazılır ([DB-30], iki yönlü).
2. **Her okuma süzmek zorunda.** Klasik soft-delete tuzağı; bir yerde süzme unutulur,
   geçersiz satır listeye sızar. Tek-helper + AST bekçisi rejimi bu kolonlara da uygulanır.
3. **Defter arşivlenemez.** Audit 6 ayda arşivlenir; defter İŞ VERİSİDİR, arşivlenemez.
   `WarehouseMovement` en hızlı büyüyecek tablo olur; büyüme planı (tarih partition,
   index) baştan düşünülür.

### Neden şimdi ve neden çekirdek

Ürün tek fabrikadan tüm tekstil sektörüne açılıyor. Denetlenebilirlik (GOTS/OEKO-TEX
lot izlenebilirliği, müşteri denetimi, ticari ihtilaf) satılabilirliğin parçasıdır ve
sonradan eklenemez: silinmiş satır geri gelmez. Bu yüzden [ÇEKİRDEK] — her kurulumda,
her modülde geçerlidir, bayrakla açılıp kapanmaz.

### Kod çapaları

- Ölçüm: `grep -rn "\(tx\|prisma\|db\|client\)\.[a-zA-Z]*\.delete(" src/` → 17 ·
  `grep -rn "\.deleteMany(" src/` → 70 · `base.service.ts:1280` jenerik `hardDelete`
- Doğru emsaller (örnek alınacak): `CariTransaction.reversesTxnId` `schema.prisma:6634` ·
  `RollVariance.reversedAt` `:3217` · `WarehouseEventType.SHIPMENT_REVERSAL` `:6082` ·
  `PrintedDocument` versiyon defteri `:4388` · `invoice.service.ts:883` (claim'li taslak silme)
- Alan kuralları: `docs/kurallar/defter.md` (bu notla açıldı)

### Bekçi

**Bu turda bekçi YAZILMADI** — not yalnız kuralı koyar. Kapı ihtiyacı ölçüldü:
`scripts/test_warehouse_ledger.ts` ve `test_warehouse_movements.ts` yalnız OKUMA
yüzeyini ölçüyor, "hangi olay satır yazmalı" invariant'ını değil;
`scripts/consistency-check.sql`'de `warehouse_movements` mutabakatı HİÇ YOK.
Yani yukarıdaki ihlallerin hiçbirini bugün hiçbir bekçi kırmızıya düşürmez.
Gereken iki kapı ayrı iştir: ① defter mutabakatı (Σ hareket ↔ canlı durum),
② yeni `delete`/`deleteMany` sitesi için AST tripwire (allowlist'li).

### Üç kapı

Migration **yok** (bu not şema değiştirmez; doktrinin uygulanması ayrı migration'lar
doğuracak). Yeni izin **yok**. APK **yok**.


---

## 2026-09-11 — Fasondan kısmi sevkte `initialQty` düşürülüyordu + sarf kalemi top doğuruyordu [ÇEKİRDEK]

Defter doktrini turunun (2026-09-10) açtığı taramada çıkan İKİ canlı hata. İkisi de
düzeltildi, ikisi de negatif sondayla kırmızı görüldü.

### ① `initialQty` geriye dönük düşürülüyordu — kapatılmış bir sınıfın kaçak sitesi

**Ölçüm.** `grep -rn "initialQty: { decrement"` tüm `src/` + `scripts/` içinde TEK
isabet veriyordu: `subcontractor.service.ts` `createFasonShipChild` — fasondan
doğrudan müşteriye KISMİ sevkte ana top bölünürken `currentQty` ile birlikte
`initialQty` de düşüyordu.

Bu desen 2026-08-29 denetiminde **zaten yargılanmış ve yasaklanmıştı**
(`tambur.service.ts` parent-kısalma bloğu, üç ölçülmüş kusur: ① WO üretilen metrajı
geriye azalıyor — IE1408260004 −76,7 m, sahada 120 top · ② `rollWhole =
initialQty.equals(currentQty)` kesimden sonra TRUE kalıp metraj düzeltme kapısını
deliyor · ③ "Tümden Geri Al" sapma defterine OLMAYAN AŞIM satırı yazıyor). Fason
satırı o temizlikten ALTI HAFTA ÖNCE yazılmış ve taramada atlanmıştı. Yeni bir sınıf
değil, kapatılmış sınıfın hayatta kalan sitesi.

**Ağırlaştırıcı:** `directShip` TERMİNALDİR (`subcontractor.service.ts` — "Bu sevk
fasondan sevk edilmiş — geri alınamaz"), yani düşürülen giriş metrajı KALICIYDI.

**Bağlı düzeltme (bekçi yakaladı).** `coverage.helper.ts` `computeWoInput` içinde
hatanın TELAFİSİ duruyordu — yorumu birebir söylüyordu: *"fasondan-sevk charge-split
çocuğu: parent decrement edildi → charge geri ekle"*. Ebeveyn artık tam metrajını
koruduğu için bu dal çift sayıyordu (300 m top + 100 m çocuk = 400 m). Dal kaldırıldı;
charge zaten kökte tam duruyor.

**Veri etkisi.** `tekserp_demo`da 0 `DirectShipment` var → demo'da etkilenen top yok.
**Canlıda ÖLÇÜLMEDİ** — `DirectShipment` kullanan kurulumda `initialQty`si düşmüş
ebeveynler taranmalı (imza: `parentRollId` ile bağlı `directShipmentId` dolu çocuğu
olan ve `initialQty < Σ(çocuk initialQty) + currentQty` olan toplar).

### ② Sarf kalemi mal kabulde barkodlu KUMAŞ TOPU doğuruyordu — kapı yoktu

**Ölçüm.** `goods-receipt.service.ts` yalnız `ItemType.YARN`ı ayırıyordu; geri kalan
HER tür `inventory.createInitialEntry`'ye düşüyordu ve orada `ItemType`
karşılaştırması HİÇ YOKTU. Route zod'unda `colorId`/`width` opsiyonel olduğu için
sarf satırı doğrulamayı da geçiyordu. Kodda ÜÇ ayrı yorum bu boşluğu zaten
işaretlemişti (`yarn.service.ts` "CONSUMABLE bilinçli olarak DIŞARIDA",
`goods-receipt.service.ts` "üçüncü satır tipinin genişleme noktası",
`invoice.service.ts` "aynı deliği yeniden açar") — ama kapı hiç takılmamıştı.

**Kapı FAIL-CLOSED kuruldu:** `createInitialEntry` "CONSUMABLE değilse geç" değil
**"FABRIC ise geç"** der. Enuma dördüncü tür eklendiği gün sessizce top doğurmaz.
Kapı serviste olduğu için DÖRT çağıranın hepsini birden kapatır (mal kabul · elle top
ekleme · tambur manuel ×2) — iplik kaleminden elle top eklemeyi de artık engeller.

**Veri etkisi.** `tekserp_demo`da 0 `CONSUMABLE` kalem var (170 FABRIC + 4 YARN) →
hata LATENT'ti, hiç ateşlenmemişti. Negatif sondada gerçekliği kanıtlandı: kapı
kaldırılınca sarf kaleminden `created=1` ve `top=1` doğdu.

### Kod çapaları

- `src/services/subcontractor.service.ts` — `createFasonShipChild`, `initialQty` decrement kaldırıldı
- `src/services/helpers/coverage.helper.ts` — `computeWoInput`, telafi dalı kaldırıldı
- `src/services/inventory.service.ts` — `createInitialEntry`, `ItemType.FABRIC` fail-closed kapısı

### Bekçi

- `scripts/test_input_rolls_directship.ts` — 3 yeni kontrol (ebeveyn `initialQty`
  değişmedi · `currentQty` düştü · `rollWhole` artık FALSE). **Negatif sonda:** decrement
  geri kondu → 3 kırmızı (`initialQty=200`, `rollWhole` TRUE, `totalMeters=200`).
- `scripts/test_goods_receipt.ts` §A10/A10b/A10c — sarf satırı `failed[]`e düşer, sebep
  kalem türünü söyler, hiç top doğmaz. **Negatif sonda:** kapı `if (false)` yapıldı →
  3 kırmızı (`created=1`, `top=1`).
- Yeşil: `test_input_rolls_directship` 7/7 · `test_goods_receipt` 2/2 ·
  `wo_input_attach_window` · `wo_branch_redye` · `direct_ship` 4/4.

### Üç kapı

Migration **yok**. Yeni izin **yok**. APK **yok** (tablet bu yollara dokunmuyor).

## 2026-09-11 — Çalışma oturumu geçmişi silinmez: istasyon/makine kalıcı silmesini ENGELLER [ÇEKİRDEK]

### Soru / ölçüm

`guarded-hard-remove.ts` istasyon ve makine kalıcı silerken `tx.workSession.deleteMany`
ile oturum satırlarını temizliyordu (2026-09-10 sayımındaki `workSession` 2 site). Kod
yorumunun gerekçesi "denetim SystemLog'da append-only kalır" idi. Gerekçe GEÇERSİZ:
audit 6 ayda `system_log_archives`a arşivlenir ve iş kaynağı olarak okunamaz;
`WorkSession` ise teknik iz değil İŞ VERİSİDİR — "kim, ne zaman, hangi istasyonda/makinede
çalıştı" sorusunun tek cevabı. Sonuç: hiç üretim yapmamış ama oturum açılmış makine
silinince o geçmiş kalıcı kayboluyordu. Makine önizlemesi de "N oturum temizlenecek
(denetim izi SystemLog'da kalır)" diyerek bunu onaylatıyordu.

### Karar (kullanıcı, defter-öncelikli doktrinin "guard kalır, silme gider" hükmü)

- İki `deleteMany` KALKTI. Oturum satırı hiçbir silme yolundan silinmez.
- Oturum sayısı istasyon ve makine guard listelerine **engel** olarak girdi
  (`workSessionCount`): 409 + "N çalışma oturumu kaydı var — kalıcı silinemez.
  İstasyonu/Makineyi pasife alın." Çözüm yolu `isActive:false` (iki modelde de zaten var).
- İstasyon sayımı `OR: [stationId, machine.stationId]` — makinesiz istasyon oturumu da
  istasyonun makinelerindeki oturum da engeller. Guard sırası: kalıcı engeller (üretim izi,
  oturum) kaldırılabilir engellerden (cihaz eşleşmesi, donanım) ÖNCE — kullanıcı "önce
  eşleşmeyi kaldır"a uyup ardından yine reddedilmesin.
- FK zaten iki tarafta Restrict: guard ile tx arasındaki yarışta açılan oturum P2003 → 400
  ile düşer, satır kaybolmaz.
- **Makine önizlemesi** (`GET /api/machines/:id/delete-preview`): oturum artık `blockers`
  içinde; sayı guard'ın kendisinden okunur (ikinci sayım yüzeyi yok); `recentWorkSessions`
  en yeni 5 oturumu (kullanıcı adı, başlangıç, bitiş) döker ki "hiç kullanılmadı sanılan
  makine neden silinmiyor" kendini açıklasın. Aynı turda silmede boşa çıkacak donanım soyut
  sayıdan kayıt dökümüne çevrildi (`peripheralsToDetach`) — yıkıcı işlemde etkilenen her
  kayıt listelenir kuralı. `workSessionCount`/`peripheralDetachCount` alanları korundu.
- **Eski istemci:** oturumu olan makinede `deletable=false` gelir → eski panel blocker
  mesajını gösterir, eski "temizlenecek" dalına hiç girmez. `minVersion` gerekmez.

### Kod çapaları

- `Teks-Erp/src/services/helpers/guarded-hard-remove.ts:173` — istasyon guard'ı
- `Teks-Erp/src/services/helpers/guarded-hard-remove.ts:249` — makine guard'ı
- `Teks-Erp/src/services/helpers/guarded-hard-remove.ts:282` — `machineDeletePreview`
- `Teks-Erp/src/routes/station.routes.ts` — delete-preview Swagger açıklaması
- `Electron/src/pages/Stations/machineDeleteDescription.ts` — onay metni (sayfadan çıkarıldı)

### Bekçi

- `Teks-Erp/scripts/test_work_session_history_guard.ts` (19): A önizleme engel + döküm,
  409, satır/makine/donanım yerinde · B makinesiz istasyon oturumu 409 · C oturumlu makineli
  istasyon 409 · D körlük zemini: oturumsuz makine silinebilir · E AST: `src/` altında
  `workSession.delete/deleteMany` çağrısı ve ham `DELETE FROM work_sessions` YOK.
- `Electron/src/pages/Stations/machineDeleteDescription.test.ts` (3): "temizlen" geçmez,
  her oturum + "… ve N oturum daha", her donanım adıyla.
- `test_guarded_hard_remove.ts` güncellendi: oturum senaryosu yeni bekçiye taşındı, ham
  `username: "admin"` bağımlılığı kalktı, donanım dökümü ölçülüyor.
- **Negatif sondalar:** eski davranış (guard `0` + `deleteMany` geri) → 14 kırmızı ·
  yalnız guard kapalı (`deleteMany` yok) → 8 kırmızı (E yeşil kalır, guard kontrolleri
  AST'den bağımsız) · panel metni "temizlenecek"e döndü → 1 kırmızı. Hepsi geri alındı.
- Yeşil: `work_session` 4/4 · `station` 9/9 · `guarded_hard_remove` 16/16 ·
  `hard_delete_guard_coverage` 3/3; backend `typecheck:scripts` + eslint; Electron
  typecheck + lint tavanı.

### Üç kapı

Migration **yok** (şemaya dokunulmadı). Yeni izin **yok**. APK **yok**. Backend ÖNCE, panel sonra.


---

## 2026-09-11 — Fasoncu karnesi kısmi doğrudan sevkte YANLIŞ fire/açık üretiyor (TEŞHİS, düzeltilmedi) [ÇEKİRDEK]

> ✅ **ÇÖZÜLDÜ (2026-09-11)** — B kararı uygulandı, helper tüketici etkisi ölçüldü → bkz. "2026-09-11 — Fasoncu karnesi: müşteriye giden metre BAŞARILI TESLİM; alt küme doğrudan sevk kalemi KAPANIR".

`initialQty` onarım turunun yan gözlemi olarak çıktı, ayrı bir bulgudur ve
ÖLÇÜLDÜ. Düzeltme YAPILMADI — gerekçe aşağıda.

### Formül ve kusurun yeri

`subcontract-scorecard.report.service.ts` (`collectDispatchItems` + `toRow`).
Evren: dönemde sevk edilmiş, `cancelledAt IS NULL` **ve `directShippedAt IS NULL`**
olan sevklerin kalemleri. Kalem başına `giden = dispatchedQty`,
`dönen = Σ COALESCE(receivedQty, newRoll.currentQty)` + çekme düzeltmesi
(`RollVariance`, source SUBCONTRACTOR_RETURN). Kapalı kalem fire paydasına girer,
açık kalem `openQty += max(0, giden − dönen)`.

Kısmi doğrudan sevk bu tanımın DIŞINDA kalıyor:

- Bölünme çocuğu hiçbir kümede yok — sevk KALEMİ değil, `createFasonShipChild`
  ile doğan bir top.
- Ebeveyn kalemin `dispatchedQty`si (D) çocuğun müşteriye giden S metresini
  İÇERİYOR; "dönen" ise yalnız makbuzlardan geliyor. Kalem kapanınca S FİRE olur,
  açıkken açık bakiye S kadar şişer.
- Alt kümeyle TAM sevk edilen topun kalemi hiç makbuz ya da `remainderClosedAt`
  damgası almaz ve sevk kısmi kaldığı için `directShippedAt` NULL kalır → kalem
  SONSUZA DEK AÇIK görünür.

### Ölçüm (gerçek `dispatch`/`executeDirectShip`/`receive`/`closeRemainder` ile)

| Senaryo | Sistem | Doğrusu |
|---|---|---|
| K0 kontrol: 300 gitti / 300 döndü | fire 0 · açık 0 | ✅ temel durum doğru |
| K1: 300 → 100 müşteriye → 200 TAM kabul | **fire 100 m (%33,3)** | 0 |
| K2: 300 → 100 müşteriye → 100 kısmi kabul → 100 kapama | **fire 200 m (%66,7)** | 100/200 (%50) |
| K3: 300 → 100 müşteriye, kalan fasonda | **açık 300 m** | 200 m |
| K4: 2×200, biri tamamen müşteriye, diğeri tam kabul | **açık 1 kalem / 200 m**, `OPEN_OUTSTANDING`=1 | açık 0 |

### Çürütme denemeleri — telafi YOK

`dispatchedQty` hiçbir yerde düzeltilmiyor (`subcontractorDispatchItem` üzerindeki
5 update sitesinin hiçbiri metraja dokunmuyor: `remainderClosedAt` damga/geri alma
×2, `dispatchId` taşıma ×3). `executeDirectShip` makbuz satırı ya da
`remainderClosedAt` yazmıyor. Çekme sapması `receivedQty`ye göre hesaplanıyor,
S'i kapsamıyor. Yol CANLI: panel `DirectShipModal` her top için `rollShipQtys`
gönderiyor.

**Bekçi neden yakalamadı:** `test_subcontract_scorecard` yalnız TAM doğrudan
sevki fixture'la kuruyor (`directShippedAt` elle dolu); kısmi ve alt küme hiç
sınanmamış.

### Etki alanı

- Aynı fonksiyon Patron ekranını besliyor (`boss/overview.service.ts`).
- K4 yalnız karneyle sınırlı DEĞİL: tek kaynak `fason-open-dispatch.helper.ts`
  (`OPEN_OUTSTANDING`/`OUTSTANDING_ITEM`) alt kümeyle doğrudan sevk edilmiş kalemi
  "açık" sayıyor ve helper'ın **38 tüketici sitesi** var (WO listesi, iptal, kart
  uyarısı, bekleyen dönüşler…). **Tüketici etkisi ÖLÇÜLMEDİ** — yalnız helper'ın
  1 döndürdüğü ölçüldü.

### Veri durumu

`tekserp_demo`: karne evreni 377 sevk / 377 kalem / 1 firma; `DirectShipment` 0,
`directShipmentId` dolu top 0, doğrudan sevk operasyonu 0 → etkilenen kalem 0.
**KOD YOLU VAR, VERİ YOK.** Canlı ölçülmedi.

### Neden bu turda DÜZELTİLMEDİ

Üç gerekçe: ① yarıçapı geniş (38 tüketici, etkisi ölçülmemiş) ② gecenin yetkili
kapsamı defter B bölümüydü, bu yeni bir sınıf ③ **ticari karar boyutu var** —
"fasoncunun sorumluluğundaki giden metre" tanımı hakedişe ve firma seçimine girer,
mühendislik değil ürün kararıdır.

### Düzeltme yönü (uygulanmadı)

Fasoncunun sorumluluğundaki giden = `dispatchedQty` − Σ müşteriye giden (bölünme
çocukları + alt kümeyle tam sevk edilen top); alt kümeyle tam sevk edilen topun
kalemi KAPANMIŞ sayılmalı. Bekçiye kısmi ve alt küme senaryoları eklenmeli.

### Kod çapaları

- `Teks-Erp/scripts/olcum_scorecard_kismi_dogrudan_sevk.ts` — senaryo + ölçüm;
  canlı kopyada `--salt-okuma` ile yalnız teşhis koşar (`hedefDbEngeli` prod adında durur)
- `src/services/reports/subcontract-scorecard.report.service.ts`
- `src/services/helpers/fason-open-dispatch.helper.ts`

### Üç kapı

Migration yok · izin yok · APK yok. (Düzeltme yapılmadı; bu not yalnız bulguyu kaydeder.)


---

## 2026-09-11 — Çek defterinin dört ters yolu + çek-olayı kasa etkisi tek kaynakta [ÇEKİRDEK]

### Soru / ölçüm

Defter B bölümünün çek maddesi (kodda doğrulandı): `TERMINAL_STATUSES = [COLLECTED,
BOUNCED, RETURNED, PAID, CANCELLED]` içinde yalnız COLLECTED'ın tipli stornosu vardı
(`COLLECT_CANCEL`, K-2). BOUNCED/RETURNED/PAID çıkışsız terminaldi; ENDORSED terminal
değil ama tek çıkışı BOUNCE'tı. Yanlış girilmiş karşılıksız/ciro/iade kaydı CARİ
BAKİYEYİ, yanlış ödendi damgası KASA/BANKA bakiyesini kalıcı yanlış bırakıyordu.
Şemadaki `ChequeStatus.BOUNCED` yorumu ("defter TERS KAYITLA geri alınır") kodun
tutmadığı bir vaatti.

Yan bulgu: kasa/banka bakiyesinin üçüncü yazarı (`ChequeEvent`) için "hangi olay para
oynatır" kümesi BEŞ yerde elle kopyalanmıştı (`cash-period-close` ×2 · `cash-book.report`
· `test_consistency` §23/§24 · `test_cheque_portfolio` §13). `PAY_CANCEL` eklenip biri
unutulsa ilk ödeme stornosunda o yüzey sessiz drift basardı.

### Karar

- Dört yeni olay `ENDORSE_CANCEL · BOUNCE_CANCEL · RETURN_CANCEL · PAY_CANCEL`; üç yeni
  cari kaynak `CHEQUE_ENDORSE_CANCEL · CHEQUE_BOUNCE_CANCEL · CHEQUE_RETURN_CANCEL`.
  `CHEQUE_PAY_CANCEL` YOK: `pay()` `writeChequeLedgerTx` çağırmaz (borç doğuşta
  `CHEQUE_ISSUE` ile kapandı), tersi de çağırmaz — bekçi ölçer.
- `COLLECT_CANCEL` deseni genelleşti: storno TİPLİ olaydır · ileri satırı silmez · her
  ters cari satır orijinaline `reversesTxnId` ile bağlanır (borç↔alacak, TL karşılığı ve
  kur orijinalden) · `txnDate = now` · durum en yeni ileri olayın `fromStatus`una döner
  (`createdAt desc` — `eventDate` geriye tarihlenebilir) · olay/satır/hesap bulunamazsa
  FAIL-CLOSED 409 · sebep zorunlu · atomik claim ikinci stornoyu keser, `reversesTxnId
  @unique` DB seddi.
- `cancel()` ENDORSED'ı almaya GENİŞLETİLMEDİ: ciro gerçek ticari olaydır, "hiç olmamış"
  sayılamaz; tipli `cancelEndorse` yazıldı.
- Ciro stornosunda `endorsedToCariId` null'a döner — damga değil "çek şu an kimde"
  işaretçisi. Bu tercih değil DB zorunluluğu: `cheques_endorsed_cari` CHECK'i
  PORTFOLIO/AT_BANK/ISSUED'da alanın NULL olmasını ister. Ciro gerçeği defterde kalır:
  ENDORSE ve ENDORSE_CANCEL satırlarının ikisi de `counterCariId` taşır.
- Ödeme stornosunda başlık `bankAccountId` null'a döner (verilen çekte yalnız PAY yazar).
  Para AYNI hesaba girer; hesap pasif olsa da geçer; eksi kasa guard'ı sorulmaz (para giriyor).
- Karşılıksız stornosu ciro edilmiş çekte iki cariyi birden tersler; iki dönem kilidi
  deterministik sırayla önden alınır (SINIF 3, `bounce()` ile aynı).
- Kapama: BOUNCED/RETURNED'da `cheques_terminal_not_allocated` CHECK'i kapamayı zaten
  sıfır tutar; ciro/ödeme stornosu kapamaya dokunmaz. Panel aynası `blockedByAllocation:false`.
- İzin YENİ DEĞİL: `finance:cheque` (ileri geçişi yapan tersini de yapar, K-2 emsali).
- Yapılamaz mesajı çıkış yolunu gösterir (`REVERSAL_HINT`): "Kayıt HATALIYSA önce
  «Karşılıksızı Geri Al» yapın".
- **Tek kaynak:** `CHEQUE_EVENT_CASH_EFFECT` — `Record<ChequeEventType, {sign, reversal}>`
  tam kapsamlı; enum'a değer eklenince derleme bu tabloda karar ister. SQL parçaları
  (`chequeCashEventTypesSql` · `chequeCashInflowSql` · `chequeCashReversalSql`) beş
  tüketicinin hepsine bağlandı; elle literal AST-benzeri tripwire ile yasak.
- Panel: detay ucunun olay satırına `createdAt` eklendi (additive) — storno onay metni
  backend gibi en yeni YAZIMI seçsin.

### Kod çapaları

- `Teks-Erp/src/services/cheque.service.ts:463` `loadForwardEventTx` · `:489`
  `loadReversibleTxnTx` · `:515` `writeChequeReversalTx` · `:1316` `cancelEndorse` ·
  `:1476` `cancelBounce` · `:1608` `cancelReturn` · `:1724` `cancelPay` · `:147` `REVERSAL_HINT`
- `Teks-Erp/src/services/helpers/cheque-cash-events.helper.ts:17`
- `Teks-Erp/src/routes/cheque-reversal.routes.ts` — `cheque.routes.ts:36`'da gate'ten sonra
  bağlanan alt router (kapıyı miras alır; `cheque.routes.ts` lint `max-lines` tavanını
  aşmasın diye ayrıldı)
- `Electron/src/pages/Finance/Cheques/transitions.ts` (dört aksiyon + `reverses`) ·
  `reversal.ts` · `ChequeReversalSummary.tsx` · `ChequeActionDialog.tsx`

### Bekçi

- `Teks-Erp/scripts/test_cheque_reversal.ts` (65): dört storno × bakiye/durum/bağ/kronoloji,
  ciro→karşılıksız→storno zinciri, geriye tarihli ödeme zinciri, kasa defteri + dönem
  kapanışı önizlemesi + §23 formülü PAY_CANCEL sonrası saklı bakiyeyle eşit, eşzamanlı çift
  storno, orijinali kapalı dönemde kalan storno geçer, tek kaynak tripwire (src+scripts
  1.040 dosya) + enum↔tablo birebir.
- Negatif sondalar (10, hepsi md5 ile geri): taraf çevrilmedi 15 ❌ · `endorsedToCariId`
  null'lanmadı → DB CHECK ile çöktü · counterCariId yok 1 · PAY_CANCEL sign 0 → 4 ·
  ciro carisi terslenmedi 4 · `eventDate` sıralaması 3 · ters satır geçmişe 2 · kasa
  defterine literal 3 · başlık bankası 1 (ilk turda YEŞİL kaldı → §5i eklendi) ·
  `reversesTxnId` yok 5 + çöktü.
- Panel: `transitions.test.ts` (storno aynası; eski "BOUNCED/RETURNED/PAID menüsüz" testi
  yerine yalnız CANCELLED menüsüz) · `reversal.test.ts` (geriye tarihli zincir). Sondalar:
  `bounce-cancel` silindi 2 · kapama engeli 1 · yön kapısı 1 · createdAt yok sayıldı 1.
- Yeşil: `cheque` 114+65 · `payment_allocation` 181 · `consistency` 32+8 · `cash` 37+61 ·
  route auth/mount/swagger · `finance_regime_gate` · `feature_flag_contract` ·
  `audit_labels` · schema drift/hijyen/db_invariants; Electron typecheck + 223 dosya /
  2.371 test; üç projede lint tavanı aşılmadı.

### Üç kapı

- **Migration VAR** (iki dosya, yalnız `ADD VALUE IF NOT EXISTS`, kendi dosyalarında):
  `20260911100000_cheque_reversal_cari_sources` · `20260911100100_cheque_reversal_event_types`.
- Yeni izin **yok**. APK **yok**. Backend ÖNCE, panel sonra.
- **Eski istemci:** yeni uçları çağırmaz; yeni olay tipini detayda etiketsiz basar (kırılma
  değil). Olay satırındaki `createdAt` additive. `minVersion` gerekmez.


---

## 2026-09-11 — B-3: fatura kapamasını çözmek artık silmiyor, damgalıyor [ÇEKİRDEK]

Defter doktrini B bölümünün ilk maddesi. `PaymentAllocation` satırı çözülürken
FİZİKSEL siliniyordu (iki yol: toplu storno `releaseRowsTx` ve tekil
`deallocate`). Üç sayaç düşüyor (`Invoice.paidTotal` · `Payment.allocatedTotal` ·
`Cheque.allocatedTotal`), geriye hiçbir satır kalmıyordu: **"fatura ne zaman
kapandı, ne zaman kim açtı" cevapsızdı.**

### Neden DAMGA, neden negatif ters satır DEĞİL

`CariTransaction`ın `reversesTxnId` deseni buraya **uygulanamaz**: DB'de
`payment_allocations_amount_positive` CHECK'i var (`test_db_invariants.ts`
envanterinde kayıtlı), yani negatif tutarlı karşı satır yazılamaz. Gerekçe
tercih değil, seddin kendisi. Doğru yol `revokedAt`/`revokedById`/`revokeReason`
damgasıdır — bu, doktrinin "ters kaydın BİÇİMİ deftere göre değişir" maddesini
doğuran ilk somut vakadır.

### Atomik claim KORUNDU

Eski kod `deleteMany`i bilerek claim olarak kullanıyordu ("`findUnique → if →
delete` deseninde iki eşzamanlı istek aynı satırı iki kez çözer"). Yeni kod aynı
disiplini sürdürür: `updateMany({ where: { …, revokedAt: null } })` + `count`
kontrolü. Yani değişiklik claim'i zayıflatmadı, ev kuralına daha da uygun hâle
getirdi.

### SÜRPRİZ — okuma yüzeyi sandığımdan çok daha genişti

Plan "6 okuma yeri" diyordu. Gerçek: **servis içinde 5 + kur farkı raporu 1 +
YAŞLANDIRMA RAPORUNDA 7 HAM SQL**. `finance-aging.report.ts` `payment_allocations`
tablosunu ham `$queryRaw` ile yedi yerde okuyor ve **o raporun kendi bekçisi
YOK** — süzmeyi unutan tek bir kopya, geri alınmış kapamayı yaşlandırmada
yaşatırdı ve bunu hiçbir kontrol göremezdi. Bu, "ayrışan yüzey" sınıfının en
pahalı hâli.

Bu yüzden `test_payment_allocation.ts`e **§15s tripwire'ı** eklendi: yaşlandırma
dosyasının metnini okuyup `payment_allocations` geçen HER SQL parçasında
`revokedAt` arıyor (7/7), kur farkı raporunda `ACTIVE_ALLOCATION` kullanımını
ölçüyor, ve serviste `paymentAllocation.delete*` kalmadığını doğruluyor.

### AS-OF İNCELİĞİ — bilinçli olarak ALINMADI

Yaşlandırma bir as-of raporudur. Damga sayesinde artık `revokedAt > asOf`
("o tarihte aktifti") kurulabilir ve bu DAHA DOĞRU olurdu — silinen satırla bu
mümkün değildi. Ama rapor rakamlarını sessizce değiştirirdi. Kural: yeni
davranışın varsayılanı BUGÜNKÜ davranıştır (silinmiş satır her yerde yok
sayılıyordu) → düz `revokedAt IS NULL` kondu, iyileştirme ayrı iş olarak
`finance-aging.report.ts` başlığına yazıldı.

### SÖZLEŞME DEĞİŞİKLİĞİ

İkinci kez `deallocate` çağrısı **404 → 409** oldu. Eskiden satır silindiği için
"bulunamadı" dönüyordu; artık satır DURUYOR ve "bulunamadı" demek yalan olurdu.
Doğru cevap çakışmadır: kayıt var, zaten çözülmüş.

### Kod çapaları

- `prisma/migrations/20260911120000_payment_allocation_revoke/` — üç nullable
  kolon + üç composite index (`(x, revokedAt)`), eski tek kolonlu index'ler düştü
- `src/services/payment-allocation.service.ts` — `ACTIVE_ALLOCATION` tek kaynağı,
  `releaseRowsTx` damgaya çevrildi (sebep+aktör `ReleaseOptions`tan akıyor),
  `deallocate` claim'i korunarak damgaya çevrildi
- `src/services/reports/finance-aging.report.ts` — 7 ham SQL süzüldü + başlık notu
- `src/services/reports/finance-fx-diff.report.ts` — süzme + başlıktaki "satır
  silinir" cümlesi düzeltildi (artık yalandı)

### Bekçi

`scripts/test_payment_allocation.ts` **185 kontrol** (önce 181): dört bayat
beklenti güncellendi (§7b3 · §7f3 · §11c · §11d), iki yeni damga kontrolü
(§7b3b sebep `PAYMENT_CANCEL`, §11c2 sebep `DEALLOCATE`), §15s tripwire'ı,
ve §16 mutabakat sorgularının üçü de `revokedAt IS NULL` ile süzüldü.

**NEGATİF SONDA (ikisi de ölçüldü, geri alındı):**
① `ACTIVE_ALLOCATION` boşaltıldı (`{}`) → bekçi ÇÖKTÜ: çözülmüş satır yeniden
çözülüyor, sayaç iki kez düşüyor, `paidTotal` tutarsızlığı 409 veriyor. Yani tek
kaynak gerçekten yük taşıyor.
② Yaşlandırmadan BİR süzgeç silindi → §15s kırmızı (`süzgeçsiz=1/7`).

**YEŞİL:** payment_allocation 185/185 · consistency 2/2 · finance_reports ·
invoice 3/3 · cheque 2/2 · schema_drift · identifier_language · tam paket
473/474 (tek kırmızı `test_identifier_language` idi ve o da bu turda düzeltildi:
`damga`/`AKTIF_KAPAMA` → `revoked`/`ACTIVE_ALLOCATION`, ev konvansiyonu İngilizce).

### Üç kapı

Migration **var** (`20260911120000`, üç nullable kolon — canlıda tablo yeniden
yazımı YOK). Yeni izin **yok**. APK **yok**.

### Not — migration aracı: teşhis ve DÜZELTME (aynı gün)

İlk yazımda "`prisma db execute` sessizce yardım metni bastı" denmişti; **bu
ifade YANLIŞTI ve düzeltildi.** Ölçüldü: Prisma 7'de `db execute` artık
`--schema` KABUL ETMİYOR (datasource `prisma.config.ts`ten okunur) ve geçersiz
bayrak görünce yardım basıp **çıkış kodu 1** veriyor — yani Prisma doğru
davrandı, bozuk değil. Kusur komut zincirindeydi: `db execute` ile
`migrate resolve` `&&` ile bağlanmamıştı, ikincisi birincinin hatasına rağmen
koştu. `CLAUDE.md`'nin "resolve SQL'in koştuğunu doğrulamaz" uyarısı yine de
tam isabet: defter "uygulandı" derken kolonlar yoktu, `information_schema`
kontrolü yakaladı.

Geriye kalan GERÇEK boşluk araçtaydı ve kapatıldı: `apply-migration.ts` `psql`i
yalnız host'ta arıyordu, oysa geliştirme Postgres'i Docker'da koşuyor ve `psql`
istemcisi host'a kurulu olmayabiliyor. Betiğe `resolvePsql()` eklendi — host'ta
`psql` yoksa DB portunu yayınlayan container bulunur ve komut oradan koşar
(URL container içi `localhost:5432`ye yeniden yazılır, SQL dosyası container'da
bulunmadığı için `-f` yerine STDIN'den verilir).


---

## 2026-09-11 — B-1 + B-2: sevkiyat olay defteri ve çuval tartı defteri [ÇEKİRDEK]

Defter doktrini B bölümünün ikinci turu. İki delik aynı serviste olduğu için tek
migration turunda kapatıldı.

### B-1 — `Shipment`: damga siliniyordu, iptal künyesi hiç yoktu

**Bulgu.** `shipping.service.ts` geri almada `{ status: PLANNED, dispatchedAt:
null, dispatchedById: null }` yazıyordu: "sevk edildi" gerçeği siliniyor, SoD
izni `shipping:undo-dispatch`ın kalıcı izi kalmıyordu. Kodun kendi yorumu
doktrinle açıkça çelişiyordu — *"Storno 'mal HİÇ ÇIKMADI' der."* Ayrıca
`Shipment` modelinde `cancelledAt`/`cancelledById`/`cancelReason` **HİÇ YOKTU**
(37 modelde var, iptal edilebilen tek belgede yok).

**KARAR ve neden tek kolon YETMEZDİ.** `undispatchedAt` gibi tek bir damga
düşünülebilirdi ama sevk → geri al → sevk turunda **ikinci tur birincisini
ezerdi**. Bu yüzden `ShipmentEvent` olay defteri açıldı (şekil kardeşi
`ChequeEvent`): `PLANNED` · `DISPATCHED` · `UNDISPATCHED` · `CANCELLED` ·
`INVOICED` · `INVOICE_CLEARED`, `fromStatus`/`toStatus` ile. Ters yolu olan iki
çift: DISPATCHED↔UNDISPATCHED ve INVOICED↔INVOICE_CLEARED.

- `dispatchedAt`/`dispatchedById` artık **NULL'LANMAZ**; anlamları "EN SON ne
  zaman sevk edildi"dir, güncel gerçeği `status` taşır. Muhasebe listesi
  `status=DISPATCHED` ile süzdüğü için etkilenmedi (bekçiyle ölçüldü, varsayılmadı).
- İptal künyesi TEK KAYNAKTA yazılır: `cancelPlannedShipmentTx` — sevkiyat
  kuralı 70 gereği `cancelShipment` ve `undoDispatch({releaseSacks})` ikisi de
  oradan geçer, ikinci kopya yazılmadı.
- Geri alma GEREKÇESİ (zaten zorunlu, ≥3 karakter) deftere de yazılır.
- Fatura işareti yolu TEK TX'e alındı: damga ile defter satırı birlikte commit
  olur. Bu işaret aynı zamanda storno kapısıdır ("faturalanmış sevkiyat geri
  alınamaz"), yani kaldırmak bir YETKİ kararıdır ve izsiz olamaz.
- Doğuş olayı (`PLANNED`) da yazılır — defter sevkiyatın tüm hayatını taşısın.

### B-2 — `Sack.weightKg`: tartı üzerine yazılıyor, sıfırlama siliyordu

**Bulgu.** Yeniden tartı `weightKg`in üstüne yazıyordu; içerik değişiminde
`markSackContentChangedTx` dört alanı birden (`weightKg`, `weightSource`,
`weighedById`, `weighedAt`) `null`'luyordu. **İrsaliyeye ve faturaya giden BRÜT
kg'ın önceki değeri hiçbir kalıcı kolonda kalmıyordu** — tek iz audit, o da 6
ayda arşivleniyor.

**KARAR.** `SackWeighing` append-only ÖLÇÜM defteri (emsal `RollVariance` —
çekme de ölçümdür): `WEIGHED` · `REWEIGHED` · `CLEARED`. `Sack.weightKg`
denormalize GÜNCEL değer olarak KALIR — doktrin durum kolonunu yasaklamaz,
defterle DESTEKLENMESİNİ şart koşar.

⚠️ `CLEARED` satırında `weightKg` **NULL**: olayın SONUCU "tartı yok"tur.
Kaybolan değer defterde bir ÖNCEKİ satırda durur; burada tekrarlamak aynı kg'ı
iki satırda gösterip toplamı yalanlardı. Kaybolan miktar `notes`ta metin olarak
anılır.

### Kod çapaları

- `prisma/migrations/20260911140000_shipment_events_sack_weighings/` — iki yeni
  tablo + iki yeni enum tipi + `shipments`a dört nullable kolon. **Geriye dönük
  defter satırı ÜRETİLMEDİ**: olmayan geçmişi uydurmak defteri yalanlar; defter
  bu migration'dan İTİBAREN doludur, eski sevkiyatların geçmişi audit'te kalır.
- `src/services/helpers/shipment-event.helper.ts` — tek yazma kapısı
- `src/services/shipping.service.ts` — altı olay noktası + iptal künyesi + tartı defteri

### Bekçi

`scripts/test_shipment_event_ledger.ts` — **17 kontrol**. §3 turu özellikle
değerli: `PLANNED,DISPATCHED,UNDISPATCHED,DISPATCHED` dizisi tek kolonun neden
yetmeyeceğini VERİYLE gösteriyor.

**NEGATİF SONDA (ikisi de ölçüldü, geri alındı):**
① `dispatchedAt: null` geri kondu → §2b · §2c · §7 kırmızı (3/17).
② `CLEARED` olayı kaldırıldı → §6a · §6b kırmızı (2/17).

### Yol boyunca çıkan iki şey

1. **Şema çapası yanlış modele düştü.** `invoiceNo` hem `DirectShipment`ta hem
   `Shipment`ta var; iptal kolonları önce yanlışına yazıldı. **Drift bekçisi
   yakaladı** (`test_schema_drift`: "DB'de shipments'ta var, şemada
   direct_shipments'ta") — migration aracının bağımsız doğrulama adımı tam da
   bunun için var ve işini yaptı.
2. **`apply-migration.ts` bu turda uçtan uca çalıştı** (dünkü Docker düşüşü
   düzeltmesiyle) ve kendi doğrulaması kırmızı vererek hatayı durdurdu.

### Üç kapı

Migration **var** (`20260911140000`). Yeni izin **yok**. APK **yok**.


---

## 2026-09-11 — B-4a: top operasyon izi geri alınır, silinmez [ÇEKİRDEK]

> ⚠️ **KISMEN (2026-09-11)** — "29 okuma yüzeyi" eksikti: üçlü anahtarlı dört `upsert` geri alınmış satırı buluyordu (iş tekrarlanamıyordu) ve `Roll.operations` ilişki okumaları süzülmüyordu → bkz. "B-4b: top hareketi geri alınır, silinmez + B-4a'nın iki kalıntısı".

`RollOperation` şema başlığında append-only'ydi, kod YEDİ yerde `deleteMany` ile
siliyordu: "bu topa kurşun uygulandı mı / QC2'den geçti mi / fasona gitti mi"
sorusunun cevabı geriye dönük DEĞİŞİYORDU. İronisi: `tambur-undo.service.ts`
doğru ilkeyi bir satır aşağıda yazıyordu — *"SİLİNMEZ — append-only defterde
satır silmek geçmişi değiştirmek olurdu; işaretlenir"* (RollVariance için) — ve
hemen üstünde `RollOperation`ı siliyordu.

### PARTIAL UNIQUE — maddenin asıl işi ve İKİ migration'lık ders

`@@unique([rollId, workOrderStepId, operationType])` TAM kısıttı. Damgaya
geçince geri alınmış satır dururken aynı üçlü yeniden yazılamaz — yani **top o
adımı bir daha işleyemezdi.** Kısıt `WHERE "revokedAt" IS NULL` partial'ına
çevrildi.

⚠️ **İlk migration bunu YAPAMADI ve sessizce geçti.** `ALTER TABLE … DROP
CONSTRAINT IF EXISTS "…_key"` yazılmıştı; Prisma'nın `@@unique`i CONSTRAINT
DEĞİL **INDEX** üretiyor, dolayısıyla `IF EXISTS` hiçbir şey bulamayıp sessizce
başarılı döndü. Tam kısıt ayakta kaldı, partial olan da kuruldu ve B-4a'nın asıl
kazanımı çalışmıyordu. **Bekçi §2 yakaladı** (ikinci yazım P2002 aldı); ikinci
migration `DROP INDEX` ile düşürdü.

Ders tek cümle: *Prisma'nın `@@unique`i INDEX'tir — düşürmek için `DROP INDEX`
gerekir, `DROP CONSTRAINT IF EXISTS` sessizce hiçbir şey yapmaz.*

Şemada `@@unique` `map: "roll_operations_active_triple_uq"` ile adlandırıldı ki
drift bekçisi yalnız predicate farkını görsün (o fark sayılmaz, DB kuralı 3);
partial unique `test_db_invariants.ts` envanterine yazıldı ([DB-30]).

### Tek kaynak ve okuma yüzeyleri

`helpers/roll-operation.helper.ts` hem yüklemi hem yazımı taşır:
`ACTIVE_OPERATION` (`{ revokedAt: null }`) ve `revokeRollOperations()`. Dönen
sayı damgalanan satır sayısıdır — eski `deleteMany().count` ile aynı anlamı
taşıdığı için çağıranların sayaç mantığı bozulmadı.

**29 okuma yüzeyinin 26'sı süzüldü. ÜÇ BİLİNÇLİ İSTİSNA** (gerekçesi koda yazılı,
bekçi §6 sessiz muaf olmadığını ölçüyor):

- `backup-impact.service.ts` — ölçülen "kaç iz geçerli" değil "yedekten beri kaç
  satır YAZILDI"; geri alınmış satır da yazılmıştır.
- `guarded-hard-remove.ts` ×2 — geri alınmış iz de o makinede ÜRETİM YAPILDIĞININ
  kanıtıdır; silme guard'ı muhafazakâr olmalı.

### Bekçi

`scripts/test_roll_operation_revoke.ts` — 8 kontrol. En kritik ikisi §2 (geri
alınmış satır dururken aynı üçlü YENİDEN yazılabiliyor) ve §4 (iki AKTİF satır
hâlâ reddediliyor — sed görevde).

**NEGATİF SONDA:** `ACTIVE_OPERATION` boşaltıldı (`{}`) → §3 kırmızı
(`aktif=2 toplam=2`), geri alındı.

**BAYAT BEKLENTİ GÜNCELLENDİ:** `test_manual_move` ve
`test_manual_move_qc_reversal` "log silindi (kalan 0)" bekliyordu; artık AKTİF
sayı 0 ölçülüyor ve ayrıca "iz SİLİNMEDİ, damgalı duruyor" kontrolü eklendi.

### B-4b AYRILDI — `RollMovement` bu turda YAPILMADI

Plan Faz 1'i ikisini birlikte öngörüyordu; ölçüm ayırmayı gerektirdi:
`RollMovement`ın **47 okuma yüzeyi** var ve `recompute` adım DURUMUNU bu
tablodan türetiyor. Kaçırılan tek süzme yanlış adım durumu üretir — bu, geç
saatte tek turda kapatılacak bir iş değil. Taze oturuma bırakıldı.

### Yol boyunca iki kural ihlali (kendi bekçileri yakaladı)

Yeni bekçiler önce ham `username: "admin"` kullanıyordu → ortam bağımlılığı
tavanı (129) kırmızı verdi, `ensureTestAdmin` fixture'ına çevrildi. ⚠️ Tripwire
YORUMDAKİ literali de sayıyor — gerekçe cümlesi literalsiz yazılmak zorunda.

### Üç kapı

Migration **var** (`20260911170000` + `20260911180000`). Yeni izin **yok**.
APK **yok**.


---

## 2026-09-11 — Dev veritabanı FABRİKANIN CANLI YEDEĞİ oldu + beş migration canlı şemada doğrulandı [ÇEKİRDEK]

Kullanıcı fabrikanın `20260911_030001` yedeğini getirdi ve dev hedefi olmasını
istedi. `dump/tekserp_yeni_20260911_030001.dump` → `tekserp_fabrika_dev`
(5,3 MB custom dump → 54 MB DB). Eski `tekserp_demo` SİLİNMEDİ, duruyor.

### Beş migration GERÇEK ŞEMADA doğrulandı — uyum tam

`migrate deploy` beşini de sorunsuz uyguladı ve tek tek doğrulandı:

| Kontrol | Sonuç |
|---|---|
| `roll_operations` tam unique düştü, partial kuruldu | ✅ yalnız `roll_operations_active_triple_uq` |
| `shipment_events` · `sack_weighings` tabloları | ✅ oluştu, **0 satır** (geriye dönük üretim YOK — doğru) |
| `roll_operations` satır sayısı | ✅ 3.456, `revokedAt` dolu 0 |
| Veri kaybı | ✅ yok — 5.784 top, 116 sevkiyat (restore öncesiyle aynı) |
| `roll_movements_one_open_per_roll_step_uq` | ✅ var, predicate `WHERE "exitedAt" IS NULL` (B-4b devir notundaki iddia DOĞRULANDI) |

### Fabrikanın gerçek veri sağlığı (salt-okunur, test yazmadan ÖNCE ölçüldü)

Mutabakatın 20 bölümünden 17'si temiz. Üç bulgu:

- **§1d — 45 sevkiyat / 11.855,3 m siparişe yazılmamış** ve **§1c — 5 sevkiyat
  sipariş beyan ediyor ama tahsis satırı yok.** Hafızadaki not 42 sevkiyat /
  11.384 m diyordu, yani boşluk büyümüş.
  ⚠️ **KARAR (2026-09-11, kullanıcı): BU BİR KUSUR DEĞİL, FABRİKANIN BİLİNÇLİ
  TERCİHİ — onarım YAPILMAYACAK.** Elemanlar sipariş olsa bile işaretlemeden
  sevk ediyor ve fabrika bunu böyle sürdürüyor. Sonuç: onarım modülü koşulmaz
  (teşhis aracı ölçmek için durur), `test_consistency` §1c/§1d kırmızısı
  BEKLENEN DURUMDUR ve kovalanmaz, sayının büyümesi de alarm değildir.
- **§13 — 2 topta `currentQty > initialQty`** (492→698,9 ve 500→520,5; ikisi de
  barkodsuz, `IN_PRODUCTION`, Ağustos). Kaynağı ölçülmedi.

### `initialQty` hasarı fabrikada YOK — düzeltme ÖNLEYİCİYDİ

Teşhis script'i canlı şemada koşuldu: `DirectShipment` 0 olay, doğrudan sevk
edilen 0 top, eski-imza taraması da 0. Fabrika `directShip` yolunu HİÇ
KULLANMAMIŞ, yani 5980ff06'nın düzelttiği hata sahada hiç ateşlenmemiş. Aynı
şekilde `payment_allocations` 0 satır → B-3'ün de düzelttiği veri yok.

### ⚠️ YENİ VE CİDDİ TEHLİKE — yıkıcı betik kapısı artık gerçek veriye açık

`scripts/db-guard.ts` izin listesi SON EKE bakar (`_dev` · `_test` · `_local` ·
`_demo`) ve dosyanın kendi başlığı bunu zaten yazmış: *"tehlike sunucuda değil
GELİŞTİRİCİ MAKİNESİNDE … dev DB'nin KENDİSİ (bu projede dev DB, prod'un
kopyasıdır)"*. `tekserp_fabrika_dev` `_dev` ile bittiği için
`clean_test_residue.ts --apply` ve `reset-operational.ts` bu hedefte KOŞAR.

Bu soyut bir risk değil: aynı gün `clean_test_residue --apply` demo DB'de **468
fason sevkinin kalemlerini sildi, başlıklarını bıraktı** (betik `rollId`
üzerinden kalemi siliyor, başlığı bırakıyor → `totalQty` ile kalem toplamı
ayrışıyor). Fabrika verisinde `TEST-` önekli kayıt YOK (ölçüldü: top 0, müşteri
0, kalem 0) yani betik bugün gerçek satır silmez — ama bekçiler bu hedefte
koştukça fixture birikir ve o fixture'lar silinirken aynı sınıf hasar doğar.

**Kural: `tekserp_fabrika_dev` hedefinde yıkıcı betik ELLE ONAY olmadan
koşulmaz.** `docs/GELISTIRME-DONGUSU.md`'ye yazıldı.

### Üç kapı

Migration yok (bu not veri/ortam kararıdır). İzin yok. APK yok.


---

## 2026-09-11 — B-4b: top hareketi geri alınır, silinmez + B-4a'nın iki kalıntısı [ÇEKİRDEK]

`RollMovement` dört yerde `deleteMany` ile siliniyordu (kurşun/QC2 yeniden açma
`kursun-qc.service.ts` reopenStep · fason kabul iptali `subcontractor.service.ts`
cancelReceipt · fason aktarım geri alma undoTransfer · manuel taşıma
`workorder-manual-move.service.ts` manualMove). Tablo aynı zamanda adım DURUMUNUN
kaynağı: `recomputeStepStatus` açık/kapalı hareketleri SAYARAK türetiyor. Yani
kaçırılan tek süzgeç "hata yok, log yok, adım yanlış durumda" demekti.

### Karar

- Şemaya `revokedAt`/`revokedById`/`revokeReason` + `@@index([rollId, revokedAt])`
  (migration `20260911190000_roll_movement_revoke`). Satır şekli DEĞİŞMEDİ
  (açık satır çıkışta kapanır) — defter/durum ayrımı Faz 2, ayrı proje.
- Tek kaynak `helpers/roll-movement.helper.ts`: `ACTIVE_MOVEMENT` +
  `revokeRollMovements()` (dönen sayı = damgalanan satır; eski `count` anlamı).
- **Eşdeğerlik ilkesi:** bugün silinen satırı hiçbir okuma görmüyordu → "revoke +
  süzme ≡ silme" hedeflendi; varsayılan SÜZ, istisna yalnız "bu satır HİÇ yazıldı
  mı / geçmiş var mı" sorusu.
- **Şema-dışı partial unique** `roll_movements_one_open_per_roll_step_uq`
  predicate'i `"exitedAt" IS NULL AND "revokedAt" IS NULL` oldu — yoksa geri
  alınmış AÇIK satır dururken top o adıma bir daha giremezdi. Takas sed
  kesintisiz: yeni index geçici adla → eski `DROP INDEX` → `RENAME`. Mevcut satırların
  hepsi `revokedAt IS NULL` olduğu için küme aynı kaldı. `test_db_invariants`
  envanteri güncellendi.

### "47 okuma yüzeyi" eksikti

Devir notu 47 diyordu; tip denetleyicili tarama **~62 delegate çağrısı + 22 ilişki
okuması + 22 ham SQL başvurusu** buldu (`roll-disposition`, `coverage`,
`roll-step-scope`, `kursun-bypass-*` helper'ları ve `wip-scorecard`/`dashboard`
ham SQL'i listede yoktu). Uygulama 9 dosya grubunda paralel yapıldı, her grup iki
bağımsız doğrulayıcıdan (eksiksizlik + eşdeğerlik) geçti.

Bilinen üç tuzak kodda kapatıldı: manuel taşımanın ham `UPDATE … "exitedAt" IS
NULL`ı az önce geri alınmış AÇIK satırları kapatıp notlarını ezecekti; reopenStep'in
"son tur" okuması ve id'yle yeniden açan `updateMany`i geri alınmış kapalı satırı
yeniden açabilirdi; tambur-undo'nun "son kapalı hareket" okuması aynı sınıftı.

### Gerekçeli istisnalar (4 dosya, bekçi iki yönlü ölçüyor)

- `guarded-hard-remove.ts` ×2 — makine/istasyon kalıcı silme guard'ı; geri alınmış
  hareket de üretim kanıtı.
- `backup-impact.service.ts` — yedekten beri YAZILAN satır hacmi.
- `workorder.service.ts` rota düzenleme `_count.movements`/`operations` —
  adımın defter geçmişi. ⚠️ **Bilinen yan etki:** yalnız geri alınmış hareketi olan
  PENDING adım artık rotadan SİLİNEMEZ, istasyonu ve sırası değişmez (409). Silme
  eskiden geçiyordu çünkü geçmiş siliniyordu; şimdi hem RESTRICT FK engelliyor hem
  de istasyon değişimi "ne oldu"yu yalan söyletirdi. İlk doğrulayıcı turu burada
  yalnız aktifi saymayı önermişti; guard'ın kendi gerekçe yorumu ("geçmiş kayıt")
  bu yüzden reddedildi.
- `workorder-clone.helper.ts` repoint — bölmede hareket VE operasyon izi, geri
  alınmışlar dahil, topla birlikte aynı istasyonlu klon adıma taşınır; kaynakta
  bırakılsa topun defteri iki iş emrine bölünür.

### B-4a kalıntısı ① — upsert geri alınmış satırı buluyordu (ÜRETİMİ KİLİTLER)

`rollOperation.upsert` dört yerde (`kursun-qc.service.ts` QC2_COMPLETED +
KURSUN_APPLIED, `tambur.service.ts` TAMBUR_PROCESSED ×2) üçlü anahtarla
çağrılıyordu. B-4a unique'i partial yaptı ama upsert `where`ine aktif yüklem
konmadı. **Ölçüldü** (geri alınan tx içinde): geri alınmış tek satır varsa upsert
onu DÖNDÜRÜYOR ve yeni aktif satır YAZMIYOR; iki geri alınmış satır varsa Prisma
"Expected zero or one element, got 2" ATIYOR. Saha senaryosu: KK2'si geçmiş top
"Konumu Düzelt" ile geri taşınır (QC2 damgalanır) → KK2 yeniden yapılır → aktif
QC2 yazılmaz → `finishStep` "QC2 tamamlanmamış top var" der → top adımda takılır.
Düzeltme `where: { <üçlü>, ...ACTIVE_OPERATION }` — ölçüldü: yeni aktif satır
yazılıyor, tekrar çağrı idempotent. c45f8b28 origin'de ama son saha etiketi
`backend-v2.9.8`in atası DEĞİL (ölçüldü) — hata sahaya çıkmadan kapandı; bir sonraki
backend paketi B-4a ile B-4b'yi BİRLİKTE taşımalı, B-4a tek başına paketlenmemeli.

### B-4a kalıntısı ② — ilişki okumaları süzülmüyordu

B-4a'nın bekçisi regex'le yalnız delegate çağrılarına bakıyordu; `Roll.operations`
ilişki okumaları görünmüyordu: fason born-top blok nedenleri (6 yer), kesim
listesinde `kursunFinishedAt`, top listesi (`ROLL_LIST_INCLUDE` — tipsiz sabit) ve
detay yanıtı, operatör verim raporu ham SQL'i, mükerrer top taraması `ops` sayımı.
Hepsi `ACTIVE_OPERATION` aldı.

### Bekçi — tip denetleyicili tarama

`scripts/revoke-ast-tarama.ts` (yardımcı, test değil): TypeScript programı kurar
(~1,5 sn) ve `getContextualType(…, ContextFlags.Completions)` ile Prisma kısıt
tipini okur — `movements` adı WarehouseMovement ilişkilerinde de var, ayrım tipten.
Tipsiz include sabitinde model kardeş anahtarlardan şemadan çözülür. Ham SQL alias
bazında ölçülür (bir literalde iki tablonun süzgeci birbirini örtmez).

- `test_roll_movement_revoke.ts` (19): §1 damga · §2 partial unique yeniden yazım ·
  §3 iki aktif açık red · §4 aktif okuma · §5 kurşun reopen + geri manuel taşıma
  sonrası adım durumları · §6 tarama + istisna kümesi.
- `test_roll_operation_revoke.ts` +§7 tarama +§8 upsert davranışı; `PATOS` seed
  fixture'ına yaslanıyordu, fabrika DB'sinde hiç koşmuyordu → kendi TEST ürününü
  kuruyor.
- Servis düzeyi: `test_p2_kk2reopen` iki adımlı reopen senaryosu (nextStep dalı hiç
  koşmuyordu) + geri alınmış tur; `test_manual_move_qc_reversal` "damgalı açık
  satır kapatılmadı".

**NEGATİF SONDALAR (hepsi kırmızı, hepsi geri yüklendi, sha256 eşit):**
`ACTIVE_MOVEMENT = {}` → 5 kırmızı · recompute `openCount` süzgeci yok → §5b
Tambur **ACTIVE** (beklenen PENDING) · `closedCount` süzgeci yok → §5f ara adım
**ACTIVE** (beklenen PENDING) · manuel taşıma ham UPDATE süzgeci yok →
`test_manual_move_qc_reversal` kırmızı + §6d · KK2 upsert'ten `ACTIVE_OPERATION`
yok → §7a.

### Test ortamı — fabrika DB'sinde paket YANILTIYOR

`npm test` `tekserp_fabrika_dev`de 399/477: kırmızı 78'in **70'i** "Seed fixture
eksik: PATOS" ile çöktü — ve bunlar tam da bu değişikliği ölçen akış bekçileri
(manual_move, fason undo/cancel, split, batch). Fixture'lı ayrı DB kuruldu
(`tekserp_b4b_test`: migrate deploy + seed + seed:fixtures): **472/477**. Kalan
5'in (audit_depth, order_cancellation — paket sırasına bağlı, tek başına yeşil;
module_flag_off, module_grandfathering, module_profile — taze DB'de modül satırı)
HEAD worktree'sinde aynı DB'ye karşı koşumu **birebir aynı** → değişiklikten değil.
Kural `docs/GELISTIRME-DONGUSU.md` madde 3'e yazıldı.

Fabrika verisine özgü, değişiklikten bağımsız kırmızılar (geri alınmış satır
DB'de 0 iken süzgeçli sorgu eskisiyle özdeş): `test_consistency` §1c/§1d (bilinçli
tercih), §13 (2 top), **§20 — `IE0608260004` 2. adımı 2026-08-06'dan beri hiç
hareketi olmadan COMPLETED** (yeni veri bulgusu, kaynağı ölçülmedi);
`test_roll_warehouse_stamp`, `test_traveler_card_a5_batches` C3/C9/C10,
`test_recent_output_filters`, `test_sack_label` §0, `test_recipe` ('TUP' kat) —
hepsi fixture DB'de yeşil.

### Üç kapı

Migration **var** (`20260911190000`). İzin **yok**. APK/Electron **yok** —
sözleşme değişmedi; yanıtlar yalnız geri alınmış satırı artık döndürmüyor (B-4a
öncesi davranış).

---

## 2026-09-11 — Kartela stok düşümünün ters yolu: tek yönlü defter kapandı [ÇEKİRDEK]

Defter doktrini kalan borç ①. `SwatchStockReduction` yalnız DÜŞÜM satırı
yazıyordu: yanlış düşülen kartela geri gelmiyordu, hangi kartelaların düşüldüğü
yalnız audit yükündeydi (`swatchIds`, 6 ayda arşivlenir). "Deftere yazan her
ileri kaynağın ters yolu olmalı" kuralının doğrudan ihlaliydi.

### Karar

- **Ters kaydın biçimi DAMGA:** başlığa `reversedAt` · `reversedById` ·
  `reverseReason`. Negatif karşı satır `swatch_stock_reductions_count_pos`
  CHECK'i yüzünden yazılamaz (B-3 emsali). Bir düşüm bir kez geri alınır —
  yeniden düşüm YENİ satırdır, yani tek damga çevrimi ezmez (RollVariance
  `reversedAt` emsali).
- **Kalem tablosu `SwatchStockReductionItem`** (append-only, `@@unique([reductionId,
  swatchId])`): geri alma hangi kartelaları döndüreceğini audit'ten değil
  defterden okur. Kartela başına tekil DEĞİL — aynı kartela düşülüp geri alınıp
  yeniden düşülebilir.
- **`Swatch.cancelledAt` durum kolonudur**, defter değil: geri alma onu boşaltır,
  geçmiş düşüm satırında + kalemde + ters damgada kalır. (Yasak listesindeki
  "ileri damgayı null'lama" iş-yapıldı beyanlarıdır — `dispatchedAt` gibi;
  kartelanın iptal bayrağı stok sorgusunun kendisidir, 20+ okuma onu süzer.)
- **Kabul iptali ayrı satır yazmaz:** kabulle iptal edilen kartelayı belge
  künyesi açıklar (`KartelaReceipt.cancelledAt` + `Swatch.parentReceiptId`). İptal
  edilmiş kartelanın kaynağı deterministiktir: aktif düşüm kaleminde ise düşüm,
  değilse kabul iptali.
- **Geri alma kapısı** (`reverseStockReduction`): atomik claim
  `updateMany({id, reversedAt:null})` → kalemler taze okunur → her kartela hâlâ
  iptal, sevkiyat/çuval bağı yok, kabulü yaşıyor olmalı; biri bile değilse 409
  `REDUCTION_NOT_REVERSIBLE` + kart no listesi ve claim geri sarılır. Kabulü
  iptal edilmiş kartela "hiç gelmemiş" maldır — diriltilmez. Kalemsiz eski düşüm
  409 `REDUCTION_WITHOUT_ITEMS` (geçmiş uydurulmaz; fabrikada düşüm 0 satır).
- Yüklem boğaz-ikiz: `RESTORABLE_REDUCED_SWATCH` (WHERE) ↔
  `reductionBlockingReasons` (bellek-içi, liste + 409 gerekçesi).
- İzin: geri alma `kartela:write` (panel); düşümü yapabilen `mobile:depo`
  geri alamaz — düzeltmenin düzeltmesi masada. Yeni izin kodu yok.

### Kod çapaları

- `prisma/migrations/20260912090000_swatch_stock_reduction_reversal/`
- `src/services/kartela.service.ts` — `reduceStock` kalem yazar;
  `listStockReductions` · `reverseStockReduction` · `reverseStockReductionTx`
- `src/routes/kartela.routes.ts` — `GET /stock/reductions` · `POST /stock/reductions/:id/reverse`
- Panel: `Electron/src/pages/Operations/Rolls/KartelaReductionHistoryDialog.tsx`
  (Kartela Stoğu → "Düşüm Geçmişi"); düşüm diyaloğundaki "geri alınamaz" cümlesi düzeltildi.

### Bekçi

`scripts/test_swatch_stock_reduction_reversal.ts` — 25 kontrol (§1 kalem =
iptal kümesi · §2 stoğa dönüş + satır değişmedi + ters damga + kalem silinmedi ·
§3 çift geri alma 409 · §4 yeniden düşüm · §5 kabulü ölü kartela 409 + claim
geri sarıldı + dirilmedi · §6 kalemsiz 409 · §7 liste bayrakları · §8 404/400 ·
§9 kaynak: silen çağrı yok, tek diriltme yazımı yüklemi taşıyor).

**NEGATİF SONDA (üçü de kırmızı, dosya sha256 eşit geri yüklendi):**
① kalem `createMany` kaldırıldı → §1a/§1b kırmızı + §2 çöktü ·
② kabul-iptal engeli iki ikizden kaldırıldı → §5a/§5b/§5c/§7b kırmızı (5 ölü
kartela dirildi) · ③ claim'den `reversedAt: null` kaldırıldı → §3a kırmızı.

Yol boyunca: §4 ilk yazımda "FIFO en eski üç" varsaydı; tek `createMany`de doğan
kartelaların `createdAt`i eşit, sıra belirsiz — beklenti düzeltildi (kod değil).

### Üç kapı

Migration **var** (`20260912090000`: üç nullable kolon + yeni tablo). İzin
**yok** (mevcut `kartela:write`). APK **yok**; panel sürümü gerekir (geri alma
düğmesi). Eski panel: yeni uçları çağırmaz, davranışı değişmez.

---

## 2026-09-11 — Fasoncu karnesi: müşteriye giden metre BAŞARILI TESLİM; alt küme doğrudan sevk kalemi KAPANIR [ÇEKİRDEK]

Teşhis notunun ("Fasoncu karnesi kısmi doğrudan sevkte YANLIŞ fire/açık üretiyor")
uygulamasıdır. Tanım kullanıcının **B kararı**dır; aşağıdaki alt kararlar oturumda
verildi ve itiraza açıktır (ölçüt sırası: ① sektör standardı ② ölçeğimiz ③ kod deseni).

### Tanım (kullanıcı kararı, 2026-09-11)

Fasondan doğrudan müşteriye giden metre **başarılı teslimdir**:
`fire = giden − dönen − müşteriye giden`, payda fasona giden metrenin **tamamı**
(`dispatchedQty`, küçültülmez). Gerekçe: fasoncu o metreyi işledi ve müşteriye
gidecek kadar sağlamdı; fire "işlenen metre başına kayıp"tır. Reddedilen A şıkkı
paydayı küçültüyordu (300 gitti / 100 müşteriye / 180 döndü → A %10, **B %6,7**).

### Alt kararlar ve gerekçeleri

1. **Tam doğrudan sevk de evrene girdi.** Eski karne `directShippedAt` dolu sevki
   evrenden dışlıyordu. B tanımı gereği o metre de işlenmiş-teslim edilmiş metredir;
   dışlamak aynı fiziksel sonucu işlem sayısına göre farklı basar: iki topu tek
   işlemde sevk etmek (damga basılır → firma karneden düşer) ile iki ayrı işlemde
   sevk etmek (ilki alt küme → paydada) aynı firmanın oranını değiştirirdi
   ("ayrışan yüzey" sınıfı). ① Sektörde fasoncunun çıktısı kime teslim edildiğinden
   bağımsızdır. Etki: karnenin "giden" toplamı tam doğrudan sevki de içerir
   (bekçi §3: 300 → 800); fabrikada `DirectShipment` 0 olay → canlı rakam değişmez.
2. **Kapanış yüklemi helper'ın ikizi, metre atfı sevke bağlı.** Kalem kapanır:
   tam makbuz ∨ `remainderClosedAt` ∨ sevk damgası ∨ topun `directShipmentId`si
   (helper'la aynı, sevkten bağımsız). Teslim metresi ise yalnız bu sevkin DSK'sından
   sayılır (`direct_shipments.dispatchId = sd.id`): aynı top ardışık fasonda başka
   sevkten çıkmışsa o metre bu kalemin teslimi değildir. Topu sevk edilen kalemde
   teslim = `dispatchedQty` (doğrudan sevk kabulden önce gelir; bölünme çocukları
   dahil tüm metre müşteriye gitti); yalnız bölünmede teslim = çocukların
   `initialQty` toplamı (değişmez snapshot).
3. **Dönüş süresi doğrudan sevkte ölçülmez** — kalan-kapama emsali: DSK anı
   operatörün kayıt anıdır, fasoncunun teslim süresi değildir.
4. **Helper'a yeni kolon değil `roll: { directShipmentId: null }`.** `directShipmentId`
   yalnız `executeDirectShip` yazar (topu aynı tx'te `SUBCONTRACTOR_CONSUMED` yapar)
   ve ters yolu yoktur; türetilmiş koşul migration istemez (şema kilidi başka
   oturumdaydı), ② küçük ekip için sıfır veri taşıması en düşük risktir. Ham SQL
   ikizleri aynı süzgeci taşır: karne açık listesi, `consistency-check-derived.sql`
   §24c (meşru alt küme sevki drift sayılmasın) ve §24b (alt küme sevkinin topu hâlâ
   fasondaysa drift — aşağıdaki `reopenRemainder` deliğinin izi).
5. **Panel:** "Dönen" hücresine `+N m müşteriye` alt satırı, dışa aktarıma
   "Müşteriye (m)" kolonu; export'taki "doğrudan sevk kapsam dışıdır" cümlesi
   yanlış olduğu için değişti. Eski panel yeni alanı yok sayar; fire/oran backend'den
   doğru gelir, yalnız "giden − dönen ≠ fire" farkı açıklamasız görünür.
6. **Dosya bölündü** (lint tavanı `max-lines` 91>90 idi): sorgu
   `helpers/subcontract-scorecard-query.helper.ts`, saf hesap
   `helpers/subcontract-scorecard-calc.helper.ts` (tek fire formülü `fireOf`),
   sözleşme + birleştirme servis dosyasında kaldı.

### Ölçüm — düzeltmeden sonra (gerçek servisler, fixture DB)

| Senaryo | Eski | Yeni |
|---|---|---|
| 300 → 100 müşteriye → 200 TAM kabul | fire 100 m (%33,3) | fire 0 |
| 300 → 100 müşteriye → 180 döndü (karar örneği) | fire 120 m (%40) | fire 20 m (%6,7) |
| 300 → 100 müşteriye → 100 kısmi kabul → 100 kapama | fire 200 m (%66,7) | fire 100 m (%33,3) |
| 300 → 100 müşteriye, kalan fasonda | açık 300 m | açık 200 m (açık listesi de 200) |
| 2×200, biri tamamen müşteriye, diğeri tam kabul | açık 200 m sonsuza dek, `OPEN_OUTSTANDING`=1 | açık 0, `OPEN_OUTSTANDING`=0 |
| Tam doğrudan sevk 500 m | karnede yok | giden/kapanmış/teslim 500, fire 0 |

### Helper tüketici etkisi — ÖLÇÜLDÜ (değişiklikten önce)

"38 tüketici" import ve yorum satırlarını da sayıyordu; gerçek kullanım **25 site /
9 dosya**. Her site için K4a (diğer top fasonda), K4b (diğer top tam kabul), K4c
(diğer top kalan-kapama) ve bölünme durumu çözümlendi; her grup bağımsız ikinci
bir okumayla çürütülmeye çalışıldı (5 ölçüm + 5 doğrulama ajanı).

| Hüküm | Site | Nerede |
|---|---|---|
| Hatayı düzeltir | 17 | WO listesi `excludeWithOpenDispatch` · WO iptalinde `cancelBulk` seçimi ve kalan kararı (`prepareFasonCancelDecision` ×2) · kart `hasOpenDispatch` · bekleyen dönüşler (liste ×2 + grup detayı; detay kabulün firma bilgisini besler) · hızlı fason kabul önizlemesi (sevk + kalem) · parti kilidi `isBatchLockedTx` + manuel taşıma önizlemesindeki ikizi · parti birleştirme K15 · parti cerrahisi hedef sevki · kabulde firma/ikinci teslimat çözümü · `transferToNextFason` firma haritası · top listesi/detayı `dispatchItems` |
| Değişmez | 7 | kabulde kaynak kalem bağı · sevk replay bekçisi · `attachOpenDispatchInfo` · top filtresi `buildRollWhere` (hepsi zaten `AT_SUBCONTRACTOR` süzer) · iptal etkisi `fasonRemainders` · `undyedMove` · parti cerrahisi kaynak sevki |
| İncelenmeli | 1 | `cancel()` adım yeniden değerlendirmesi (`subcontractor.service.ts` ~2128): K4c + kardeş sevk iptali artık "sonsuza dek ACTIVE" yerine mevcut yanlış dala düşer (makbuz yoksa PENDING, `startedAt` silinir). Aynı dal bugün TAM doğrudan sevkte de var; kök kusur `receiptCount`un tek kanıt sayılması. Ağırlık artmadı, düzeltilmedi. |
| Risk | 0 | Yeni açılan hiçbir yol tüketilmiş topa yazamaz: kabul/iptal/taşıma yolları topu ayrıca `AT_SUBCONTRACTOR` ile claim eder. |

Canlı veri: `tekserp_fabrika_dev`'de doğrudan sevk operasyonu **0** (DSK 0, damgalı
sevk 0, `directShipmentId` dolu top 0) → bugün hiçbir rakam değişmez; düzeltme
önleyicidir. `directShipmentId` kolonundan önceki (2026-07-15 öncesi) alt küme
sevkleri helper'da açık görünmeye devam ederdi — fabrikada böyle satır yok.

### Bekçiler ve negatif sondalar

- `test_subcontract_scorecard.ts` — §3 yeniden yazıldı (tam sevk = teslim), §7 kısmi
  (4 senaryo), §8 alt küme (öncesi/sonrası + helper eşliği), açık listesi metrajı.
  31 kontrol.
- `test_fason_open_dispatch_semantics.ts` S3 — alt küme sevki: kalem-düzeyi sorgu,
  WO listesi, kart uyarısı, hızlı kabul önizlemesi. 25 kontrol.
- `test_consistency_derived.ts --probe` — `§24b-altküme` (drift yanar) ve
  `§24c-temiz` (meşru alt küme hiçbir bölümü yakmaz).
- Negatif sondalar (ayrı worktree'de, fixture DB): helper süzgeci silinince S3 5 +
  karne 8c kırmızı · teslim metresi 0'lanınca 9 kırmızı · alt küme kapanışı
  silinince 8a/8b kırmızı · açık listesi süzgeci + bölünme düşümü silinince 7d/8a
  kırmızı · §24b OR ve §24c süzgeci silinince iki sonda kırmızı. Hepsi geri alındı,
  yeşil.
- Paket fixture'lı ayrı DB'de koşuldu (`tekserp_fabrika_dev`'de değil).

### Yan bulgular — DÜZELTİLMEDİ (ölçüm sırasında çıktı, yöneticiye bildirildi)

1. **YÜKSEK — `reopenRemainder` topun geçmişine bakmıyor** (`subcontractor.service.ts`
   ~3507-3572): tek kapı `status === SUBCONTRACTOR_CONSUMED`; kalan-kapama izi,
   `directShipmentId`, adımın o topun sevkine ait olması denetlenmiyor, `stepId`
   gövdeden geliyor (izin: `workorder:write` | `roll:manual-adjust` |
   `mobile:fason-kabul`). Müşteriye doğrudan sevk edilmiş ya da tam kabul görmüş top
   API'den fasona geri diriltilebilir. Yeni §24b alt küme sondası bu izi yakalar.
2. **ORTA — bölünmeli kısmi sevkten sonra sevk iptali** (`cancel()` +
   `subcontractor-cancel.helper.ts`): DSK kontrolü yok; ebeveyn hâlâ fasonda, çocuk
   kalem değil → sevk iptal edilir, belge VOID olur, ama DSK ve tahsisler iptal
   edilmiş sevke bağlı kalır (müşteriye gitmiş malın sevki geri alınmış görünür).
   Aynı sınıf: K15 birleştirme konsolidasyonu ve K16 cerrahisi (`batch.service.ts`
   ~716-804, `batch-dispatch-surgery.helper.ts` ~253-347) kalemleri DSK'nın sevkinden
   başka sevke taşıyıp eskisini iptal edebiliyor → karnede teslim metresi atfı düşer.
3. **ORTA — damga sırası işleme bağlı** (`executeDirectShip` ~6390-6430): önce
   kalan-kapama sonra alt küme sevki → sevk damgalanır; tersi → hiç damgalanmaz.
   Helper değişikliği sorgu düzeyinde eşitler; `directShippedAt`i doğrudan okuyan
   kod (WO şeridi, iptal önizlemesi) hâlâ farklı cevap verir.
4. **ORTA — `getCancelImpact.fasonRemainders` spread ezmesi**
   (`workorder.service.ts` ~3218-3224): `receiptItems` anahtarı helper'ın
   `receiptItems.none`ını EZİYOR → tam kabul görmüş kalemler de "fasonda kalan"
   sayılır, iptal diyaloğu gereksiz fire onayı ister.
5. **DÜŞÜK** — WO şeridi sevk durumu/kilit rozeti (`workorder.service.ts` ~2546-2620)
   ve iptal önizlemesi açık sevk listesi (~3008, ~3116) elle türetiliyor; kalan-kapama
   ve alt küme sevkini görmüyor. Hızlı kabul önizlemesi `roll.status` seçip
   denetlemiyor. Top geçmişi doğrudan sevki "Fasondan Döndü" diye basıyor; iptal
   engeli mesajı "fason kabulde kapatılmış" diyor. Bölünmede ebeveynin açık hareket
   `qtyIn`i ve bekleyen dönüş rozeti müşteriye giden metreyi hâlâ içeriyor (WIP
   karnesi fason istasyonunu şişirir). `cancel()` WO iptalinde `fasonAction=SCRAP`
   ile tutarsızlık; `canSwitchToClose` hiç true olamıyor.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Panel sürümü önerilir (alt satır +
export kolonu + tanım cümlesi), zorunlu değil. Sözleşme: yanıta `deliveredQty` EKLENDİ
(kırıcı değil); karne "giden" rakamı tam doğrudan sevki artık içerir (anlam değişikliği,
fabrikada veri yok). Sıra: backend önce.

---

## 2026-09-11 — Sayım stornosu: tamamlanmış sayım artık terminal değil [ÇEKİRDEK]

Defter doktrini kalan borç ②. `StockCount` COMPLETED terminaldi; yanlış
"bulunamadı" işaretiyle tamamlanan sayım N topu iptal ediyordu ve tek çıkış
top-top `restoreCancelledRoll`du — o yol da depo defterine (`CANCEL` karşılığı) ve
sapma defterine (`RECORD_CORRECTION`) ters satır YAZMIYOR. Fabrika dev DB'sinde
sayım 0 satır (özellik sahada kullanılmamış) — düzeltme önleyici.

### Kararlar ve ölçüt (① sektör ② ölçek ③ mevcut desen)

- **Tek belgede storno (sektör):** SAP MM'de MI07 fark postalaması bir malzeme
  belgesidir, stornosu (MBST) aynı belgeye bağlı ters harekettir. Sayım
  satırları ve ileri defter satırları DEĞİŞMEZ.
- **Belge DAMGASI, yeni statü DEĞİL (desen):** `reversedAt`/`reversedById`/
  `reverseReason`; `status` COMPLETED kalır ("tamamlandı" gerçeği değişmez).
  Enum değeri eklemek panel/rapor aynalarına dokunurdu; storno bir kez yapılır,
  tek damga çevrimi ezmez.
- **Depo defteri: `WarehouseEventType.CANCEL_REVERSAL` (desen):** `TRANSFER_REVERSAL`
  / `SHIPMENT_REVERSAL` emsali. Satır: `toWarehouseId` = sayımın deposu,
  `fromWarehouseId` NULL, `qty` POZİTİF = sayımın sapma satırındaki metraj (CANCEL
  satırıyla aynı), `stockCountId` = sayım. Yön sunucuda from/to'dan türer → GİREN.
  Enum ayrı tek-ifadeli migration (55P04).
- **Kaynak belge bağı:** `WarehouseMovement.stockCountId` (FK RESTRICT) açıldı;
  `complete` artık CANCEL satırına `stockCountId`, sapma satırına
  `sourceRefId = count.id` yazar. Eski satırlar doldurulmaz; storno bağsız eski
  sapmayı `source=STOCK_COUNT` + iptal metniyle bulur.
- **Sapma defteri:** ters satır değil `reversedAt`/`reversedById` damgası
  (`roll_variances_qty_positive` CHECK — tambur-undo emsali).
- **İplik:** sayımın `stockCountId`'li hareketlerinin kalem başına NET'i tersine
  ADJUST (mal kabul stornosunun `reverseGoodsReceiptYarnTx` deseni); eksi bakiye
  REDDEDİLMEZ, önizleme uyarır (aynı emsalin gerekçesi: reddetmek defteri değil
  ekranı düzeltir). Kapalı iplik modülü önizlemede engel, motorda 403.
- **LIFO (ölçek + güvenlik):** yalnız deponun EN SON tamamlanmış, stornolanmamış
  sayımı geri alınır. Sonraki sayım fiziksel gerçeği doğruladı; eskisini geri
  almak onun iplik bakiyesini yalanlardı. Fason LIFO iptal emsali.
- **HEP-YA-HİÇ:** sayımın düşürdüğü her top hâlâ BU sayımın iptaliyle
  (`stockCountCancelReason(countNo)` tek kaynak metni) ve aynı depoda durmalı.
  Arada tek tek geri alınmış top varsa storno 409 `STOCK_COUNT_REVERSAL_BLOCKED`
  ve önizleme o topu gerekçesiyle listeler. Kısmi storno defteri iki belgeye
  bölerdi; elle geri almanın defter deliği ayrı bulgudur (aşağıda).
- **Kilit:** tx'in ilk ifadesi sayımın ve deponun DRAFT sayımlarının satır kilidi
  (`FOR UPDATE ORDER BY id`); DRAFT tamamlaması aynı satırı claim ettiği için
  storno ile sıralanır, sonraki taslak tamamlaması değişen iplik bakiyesini CAS'ıyla
  kapsam dışına düşürür.
- **Belge:** tutanak `voidForSource` ile VOIDED (`Storno: <gerekçe>`); builder
  `voidInfo`'yu `reversedAt`'ten türetir (lazy-init aynı filigranı basar).
- **İzin:** tamamlamayla aynı çift (`roll:manual-adjust` VE `yarn:write`) — SoD
  izni; önizleme `roll:manual-adjust`. Yeni izin kodu yok.

### Kod çapaları

- Migration'lar: `20260912100000_warehouse_event_cancel_reversal` (tek ifade) ·
  `20260912100100_stock_count_reversal` · `20260912100200_warehouse_movement_stock_count`
- `src/services/stock-count-reversal.service.ts` — `preview` · `reverse`
  (`claimAndPlanTx` → `reverseTx`); plan önizleme ve stornoda AYNI fonksiyon
- `src/services/stock-count.service.ts` — `stockCountCancelReason` ·
  `stockCountVoidReason` · `complete` bağları · builder `voidInfo`
- `src/routes/stock-count.routes.ts` — `GET /:id/reverse-preview` · `POST /:id/reverse`
- Panel: `ReverseStockCountDialog.tsx` (her top + iplik farkı + engeller),
  detayda "Stornola", listede/başlıkta "Stornolandı" rozeti; depo hareketleri
  aynası + bilinmeyen olay tipinde çökmeyen yedek etiket.

### Bekçi

`scripts/test_stock_count_reversal.ts` — 26 kontrol (§1 ileri bağlar · §2
önizleme · §3 storno: raf, CANCEL durur + CANCEL_REVERSAL, sapma durur + damga,
iplik net ters, satırlar değişmez, COMPLETED + damga, VOID · §4 çift storno · §5
LIFO + bağsız eski sapma · §6 hep-ya-hiç · §7 kaynak). `test_iplik_regime_gate`
`DEFTER_YAZARLARI`na storno servisi gerekçesiyle eklendi; `test_stock_count`
temizliği yeni FK sırasına göre.

**NEGATİF SONDA (beşi de kırmızı, sha256 eşit geri yüklendi):** (a) LIFO
kontrolü yok → §5a/§5b · (b) top engel yüklemi yok → §6a/§6d · (c) sapma damgası
yok → §3d · (d) CANCEL_REVERSAL yazımı yok → §3c · (e) `complete` `sourceRefId`
yok → §1b.

Paket (`tekserp_ea_test`, fixture'lı): 473/479; kırmızılar ortam — module_flag_off
/ module_grandfathering / module_profile (taze DB modül satırı), order_cancellation
(sıra bağımlı), scan_code_case (küçük tabloda Seq Scan) — ve iplik_regime_gate
(bu turda düzeltildi).

### Açık bulgu — elle "iptali geri al" defter yazmıyor

`inventory.restoreCancelledRoll` topu rafına döndürür ama softDelete'in yazdığı
`CANCEL` satırının karşılığını ve sapma damgasını YAZMAZ; tx de açmaz. Bugün kapsamı
dar ("hiç yaşamamış top") olduğu için etki küçük, ama `WarehouseMovement` stok
defterine dönüşürken (6e) bu yol `CANCEL_REVERSAL` yazmak ZORUNDA.

### Üç kapı

Migration **var** (üç dosya; enum değeri geri alınamaz). İzin **yok**. APK **yok**.
Panel sürümü gerekir (Stornola). ⚠️ Eski panel `CANCEL_REVERSAL` satırı gördüğü
depo hareketleri ekranında çöker (`WAREHOUSE_EVENT_META[kind]` undefined); satır
yalnız yeni paneldeki storno ile doğar ve fabrikada sayım yok → `minVersion`
yükseltilmedi, panel backend'le birlikte yayınlanmalı.

## 2026-09-12 — Devere · levent: levent kendi tablosunu ve defterini ister [ÇEKİRDEK] + [PROFİL]

2026-09-11 sektör taraması devere/leventlemeyi AYRICA taramamıştı (ajan istemi
"çözgü hazırlama" diyordu, dönen bulgular tezgah olaylarına kaymıştı). Bu tur o
boşluğu kapattı: şema ve kod elle okundu, dört soru paralel ajanlarla kanıtlandı.
Çıktı **`docs/design/DEVERE-LEVENT-TARAMASI.md`** (öneri; kod ve migration YOK).
Saha kaynağı `DOKUMA-DEVERE-SAHA-KAYNAGI.md`.

### Ölçüm

- Levent sistemde HİÇ yok (`warpBeam` şema/backend/panel/mobil grep'i 0). 15 eksik
  varlık/defter çıktı, hepsi "sektör geneli" — adnansahin çözgü yapmaz.
- **Devere bir iş emri ADIMI olamaz:** içinden top geçmeyen adımı `recompute`
  PENDING bırakır (`roll-step.helper.ts:140-151`) ve iş emri ancak tüm adımlar
  COMPLETED/SKIPPED iken kendiliğinden kapanır (`:202-221`) → Devere adımlı her iş
  emri sonsuza dek IN_PROGRESS kalırdı. Üstelik quickStart topları daima
  `steps[0]`'a bağlar (`workorder.service.ts:4672-4677`), yani Devere 1. adımsa
  kumaş topu devereye girerdi. `allowAsWorkOrderStep` backend'de UYGULANMIYOR;
  yalnız panel seçici süzgeci (`route.service.ts:162-171`).
- **Devere formülünün ölçeği çözüldü:** denye 9.000 m'nin gramı olduğu için
  `tel × denye × metre / 9.000` GRAM verir; kg için bölen 9.000.000. Kâğıttaki
  `/9000` yanlış değil, eksik: sonuç gramdır. Örnek `3500 × 300 × 7000` → 816,67 kg
  ve 300 cm iş eninde levent çapı ≈ 95 cm, yani 1000–1100 mm flanşa sığar. Sıra
  sorusu sonucu etkilemez (çarpma değişmeli). ⚠️ Formül NOMİNALDİR (haşıl, yağ,
  numara toleransı yok) — defter tartıdan beslenir, formül ön-dolumdur.
- **İki sessiz sayım tuzağı ölçüldü** (devere'den bağımsız, bugün de mayın):
  `test_consistency.ts:742,751` (§27) ve `purchase-order.service.ts:261-270` iplik
  hareket yönünü elle yazılmış `kind IN ('IN','ADJUST_IN')` listesiyle sayıyor;
  yeni bir "artıran" tür eklenince sessizce ters sayarlar. `yarnMovementSign`
  tek kaynağına bağlanmaları devere Faz 1'in zorunlu maddesi.
- Panelde `YARN_KIND_META[m.kind]` tanımadığı türde TypeError veriyor
  (`YarnMovementsSheet.tsx:206-217`) — yeni tür gelmeden geri düşüş etiketi şart.

### Karar — tasarım (ajan; itiraza açık)

- **[ÇEKİRDEK]** Levent `Roll` DEĞİLDİR: `Roll` kumaş dünyasının merkezidir
  (ölü statü kümesi, çuval/sevkiyat, Tambur, kalite, envanter ekranları); levent
  satırı her okumaya süzülmesi gereken sahte bir top olurdu ("ayrışan yüzey"
  sınıfı). Emsal: `yarn.service.ts:4-8` ipliği aynı gerekçeyle `Roll` yapmadı.
- **[ÇEKİRDEK]** Çözgü emri `WorkOrder` DEĞİLDİR, `WarpBeam.PLANNED` satırıdır:
  bir levent tek iş emrine ait değildir, haftalarca birçok desene/siparişe dokunur.
  Deftere hiç yazmadığı için ④ taslak sınıfıyla claim'li silinir.
- **[ÇEKİRDEK]** Durum/defter ayrımı: `WarpBeam` (durum) + `WarpBeamEvent`
  (append-only defter, `updatedAt` YOK). Doğuş gerçekleri durum tablosunda değil
  `WOUND` satırında durur — değişmezliği DB verir. Kalan metre KOLON DEĞİL,
  `Σ işaret(kind) × lengthM` ile türetilir (durum↔sayaç çifti açılmaz).
- **[ÇEKİRDEK]** Ters yol tipli: her ileri olayın `*_CANCEL`i, `reversesEventId`
  `@unique` (çift iptal DB'de imkânsız), LIFO (yalnız en yeni aktif ileri olay).
  İplikte `WARP_ISSUE_REVERSAL` — `ADJUST_IN` kullanılmadı, çünkü sayım fazlasıyla
  aynı kovaya düşerdi.
- **[ÇEKİRDEK]** Olay türü pg enum DEĞİL, `VarChar(32)` + CHECK ([DB-15]: küme
  fazlarla büyüyor); TS tuple tek kaynak, CHECK listesi ondan türer.
- **[ÇEKİRDEK]** "Fire 0" ile "fire ölçülmedi" ayrışsın diye sarım kg'ı kaynak
  beyanı taşır (`kgSource: WEIGHED|THEORETICAL`, `Sack.weightSource` emsali).
- **[ÇEKİRDEK]** Ad ASLA ayrıştırılmaz: "600 KAR İPİ 70 DN" kartından denye
  okunmaz; `Item.linearDensityDen` elle girilir, öneri/ipucu bile üretilmez.
- **[PROFİL]** Çözgü kartı (`WarpSpec`) ayrı tablodur: bir levent N deseni besler
  (saha kartında "Çözgü = UA6007"). `ProductRecipe` renge bağlı olduğu için
  reddedildi; `Item` öz-referansı çözgüyü bir kumaşın kolonlarına hapsederdi.
- **[PROFİL]** Lot yolu şemanın kendi notundaki yol: `YarnLot` + `YarnMovement.lotId`,
  lot bakiyesi TÜRETİLİR (ayrı bakiye tablosu açılmaz). Levent içi lot karışımı
  **çözgü yolu** (boyuna) üretir; **barre enine hatadır ve atkı lotuyla ilgilidir** —
  sebep kataloğunda karıştırılırsa kök neden yanlış atanır.
- **[PROFİL]** Fazlandırma "defter yazıyor mu" çizgisinden bölündü: **1a** katalog
  + bayrak + kolonlar (hiç defter satırı doğmaz, ters yol borcu doğmaz), **1b**
  levent doğuşu ileri VE geri yoluyla birlikte. `WOUND` bilerek 1a'ya alınmadı:
  iplik çıkışı olmadan doğan leventin ipliği sonradan deftere bağlanamaz.

### Karar — yönetici (`teks-erp-1e`, 2026-09-12)

- **[ÇEKİRDEK]** Rota ↔ devere: Dokuma rotada ADIM + topun giriş noktası (Faz 4,
  tezgah çıkışı motoruyla); Devere yalnız istasyon KATALOĞUNDA. Gerekçe: çözgü top
  doğmadan önceki hazırlıktır; çekirdek adım koduna dokunmak orantısız risktir.
  ⚠️ Kök `CLAUDE.md`'deki "devere/çözgü/haşıl yeni mimari istemez" cümlesi bu
  kararla DARALIR (top rotası için doğru, levent için eksik); kök dosya bu turda
  DEĞİŞTİRİLMEDİ, kullanıcı onayına bırakıldı.
- **[ÇEKİRDEK]** Bayrak adı: `tezgah.enabled` monitörizasyon olarak kalır,
  `dokuma.enabled` Faz 4'te doğar. Var olan DB anahtarının anlamı genişletilmez —
  anahtar kimliktir.
- **[ÇEKİRDEK]** `devere.enabled` varsayılan KAPALI; bağımlılık `iplikEnabled`
  (zincir: ticaret → iplik → devere). Yazma doğrulaması gövdenin dokunmadığı çifti
  atladığı için OKUMA kapısı zinciri ELLE ölçer; `effectiveModuleValue` switch'ine
  case eklemek zorunludur, yoksa iplik'e dokunan her PATCH 400 alır.
- **[PROFİL]** Profil: mevcut `perde` DEĞİŞMEZ (kumaşı hazır alan kurulum); hedef
  kitle için ayrı `perde-dokuma` profili doğar. Canlı kurulumun profil içeriğini
  değiştirmek sessiz davranış değişikliğidir.
- **[PROFİL]** Raşel ayrı modül değildir: `Station.consumesWarpBeam` +
  `Machine.warpBeamSlots` yeterlidir (raşelde kılavuz barı başına levent). Levent
  tüketen makine dokuma tezgahıyla sınırlanmaz.

### GEÇERSİZ → 2026-09-12

**ESKİ:** "Grandfathering değeri = dünkü davranış; sabit `false` YASAK"
(`docs/kurallar/modul-bayrak.md` reçete satırı, 2026-09-02 P1 notundan).
**YENİ:** yasak yalnız dünkü davranışı OLAN modüller içindir. Sıfırdan doğan,
yüzeyi olmayan modülde dünkü davranış tanım gereği kapalıdır ve değer sabit
`false` yazılır. Ölçüm: `20260902230000` grandfathering migration'ı `kumasTeknik`
ve `tezgah` için tam da bunu yapıyor ve `test_module_grandfathering` false'u ŞART
koşuyor — kural satırı düz okununca kodun yaptığını yasaklıyor görünüyordu.
⚠️ Devere, o migration'dan SONRA doğan ilk modül: kendi migration'ında damgalanır
ve tek dosyaya sabitlenmiş üç bekçi (`test_module_flags §6c`,
`test_module_profile §6c/§6d`, `test_module_grandfathering`) dosya LİSTESİNE
genişletilir. `MIGRASYON_DISI` yolu reddedildi (migration başlığı `finance`ı
olumsuz emsal sayıyor).

### Kod çapaları

Yok — bu tur tasarımdır. Tasarım belgesi: `docs/design/DEVERE-LEVENT-TARAMASI.md`
(§4 şema parçacıkları, §5 bayrak dokunuş listesi, §6 adnansahin sıfır-fark kanıtı,
§7 fazlandırma, §8 dokumacıya 22 soru, §9 yönetici kararları).

### Üç kapı

Migration **yok**, izin **yok**, APK **yok** (uygulama başlamadı). Uygulanınca:
Faz 1a bir migration (tablo + kolon + bayrak satırı), Faz 1b ikinci migration +
AYRI bir enum migration'ı (`ADD VALUE` tek ifadeli, aynı tx'te kullanılamaz).
Yeni izin kodu gerekecek (`devere:read`/`devere:write`) — katalog koda, atama
panele. Eski panel yeni iplik türünü görürse hareket listesi çöker; geri düşüş
etiketi devere yazmaya başlamadan ÖNCE yayınlanır, `minVersion` yükseltilmez.

---

## 2026-09-12 — Kalan kapaması geri alma kapısı topun GEÇMİŞİNDEN kurulur [ÇEKİRDEK]

Fason karnesi turunun tüketici ölçümünde çıkan en ağır yan bulgu (yönetici sırası 1).

### Bulgu

`SubcontractorService.reopenRemainder`in tek kapısı `roll.status ===
SUBCONTRACTOR_CONSUMED`ti ve `stepId` istek gövdesinden geliyordu. Bu durum
"kalan gelmeyecek" kararının kanıtı DEĞİL: aynı statüyü TAM KABUL de üretir,
doğrudan müşteriye sevk de. Sonuç: uç (izinler `workorder:write` ∨
`roll:manual-adjust` ∨ `mobile:fason-kabul`) kabul görmüş ya da müşteriye gitmiş
bir topu istenen ADIMDA fasona geri diriltebiliyordu — sistemde olmayan mal
"fasonda bekliyor" görünür, açık sevk yeniden açılır, adım COMPLETED'dan
ACTIVE'e döner. Panel ve tablet bu ucu çağırmıyor (API-only), canlıda iz yok.

### Karar

Kapı topun GEÇMİŞİNDEN kurulur: geri alınacak şey, bu adımda o topun
`remainderClosedAt` damgalı (iptal edilmemiş, doğrudan-sevk edilmemiş) sevk
kalemidir. Yoksa 409 `REMAINDER_NOT_CLOSED` ("bu adımda bu topun kapaması yok").
Topu doğrudan müşteriye sevk edilmişse (`roll.directShipmentId` dolu) 409
`ROLL_DIRECT_SHIPPED`. Damganın kaldırılması ATOMİK CLAIM'dir (`updateMany` +
`count===1`; eski kod sayıyı okumuyordu, iki eşzamanlı geri alma da "başarılı"
dönüyordu) ve WO kilidi tx'in İLK ifadesidir (`closeRemainder` ile aynı sıra).
Top claim'i ayrıca `directShipmentId: null` taşır (ikinci sed).

Ölçüt sırası: ① "geri alma" tanım gereği VERİLMİŞ bir kararı geri alır — kanıtı
kararın damgasıdır; ② yeni izin kodu / migration açmadan kapatılabiliyor (küçük
ekip, sahada atanacak bir adım daha yok); ③ `closeRemainder`ın aynası + atomik
claim kuralı.

### Bekçi ve negatif sonda

`scripts/test_fason_reopen_remainder_guard.ts` (15 kontrol): G1 meşru geri alma
(korunan davranış: top fasona döner, damga kalkar, sapma satırı terslenir, sevk
yeniden OPEN_OUTSTANDING, ikinci geri alma 409) · G2 alt küme doğrudan sevk →
409 `ROLL_DIRECT_SHIPPED` · G3 tam kabulle tüketilmiş top → 409
`REMAINDER_NOT_CLOSED` · G4 gövdeden gelen YANLIŞ adım → 409, top taşınmaz.
Negatif sonda (ayrı worktree): kapı silinince G2b/G3b/G4a kırmızı. Not: tx
içindeki claim'ler ikinci sed olarak veriyi yine koruyor — yani kapı kaldırılınca
hata KODU ve gerekçesi kayboluyor, veri bozulmuyor; asıl kayıp operatörün
okuduğu cevap.

### Kod çapaları

- `src/services/subcontractor.service.ts` — `reopenRemainder` (kanıt sorgusu +
  iki claim), Swagger gerekçesi `src/routes/subcontractor.routes.ts`
- Bekçi: `scripts/test_fason_reopen_remainder_guard.ts`

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: uç iki yeni `details.code`
döndürebilir; bugün çağıran istemci yok (panel/tablet bu ucu kullanmıyor).

---

## 2026-09-12 — ①-b: kartela düşüm stornosunun altı pürüzü (denetim turu) [ÇEKİRDEK]

①'in (kartela stok düşümü ters kaydı) bağımsız denetiminde çıkan ve hepsi DÜŞÜK
sınıflanan altı bulgu kapatıldı. Hiçbiri şema istemedi.

### ① TOCTOU — ölü kabulün kartelası dirilebiliyordu

Geri alma, kartelanın kabul belgesini (`KartelaReceipt`) KİLİTSİZ okuyordu;
`cancelReceipt` ise kartela listesini tx DIŞINDA okuyordu. READ COMMITTED'da iki
yol birbirini görmüyordu: iptal belgeyi claim etmişken (commit yok) storno
"kabul yaşıyor" görüp kartelayı stoğa döndürüyor, ya da tersi yönde storno'nun
dirilttiği kartela iptalin BAYAT listesinde olmadığı için iptal edilmeden
kalıyordu — ölü kabulün altında canlı kartela.

- Storno artık claim'den sonra kalemlerin kabul belgelerini `ORDER BY id FOR SHARE`
  ile kilitler ve engel kararını KİLİTTEN SONRAKİ taze okumaya dayandırır.
- `cancelReceipt` kartela kümesini tx İÇİNDE, belge claim'inin ARKASINDA çözer
  (`parentReceiptId` üzerinden); downstream (sevkiyat/çuval) kontrolü de oraya
  taşındı, dış okuma yalnız hızlı ret için kaldı. Audit artık tx içinde ölçülen
  gerçek sayıyı basar.
- Claim belgeyi UPDATE ile kilitlediği için iki yol HER ZAMAN sıralanır; hangisi
  önce girerse diğeri bekler ve taze gerçeği görür.

### ② Kalemsiz (defter öncesi) düşüm listede "geri alınabilir" görünüyordu

Panel düğmeyi açık bırakıyor, tıklayınca 409 geliyordu. Kalemsizlik artık
`reductionBlockingReasons`ın İÇİNDE (tek kaynak) — liste ve tx dalı boğaz ikizi;
tx hata kodunu `REDUCTION_WITHOUT_ITEMS` olarak korur.

### ③ Liste sessizce 50'de kesiliyordu

Keyset cursor (`createdAt desc, id desc`) + `hasMore`/`nextCursor`; panel sonsuz
kaydırmaya geçti (`useInfiniteQuery` + `AutoLoadMore`, "Daha Fazla Yükle" yok).
Sessiz kesme, ekranda "hepsi bu" diye okunuyordu.

### ④ Panel önbelleği ve hata yüzeyi

Düşüm diyaloğu başarıda geçmiş listesini de tazeler; geçmiş diyaloğunda `isError`
dalı ("Düşüm kaydı yok" yalnız BAŞARILI ve boş yanıtta); geri alma mutasyonu
`onSettled` ile iki anahtarı tazeler ve 409'un `details.blocked` dökümünü satırın
altında listeler.

### ⑤ Artık temizleyici başlığı bırakıyordu

`clean_test_residue` düşüm KALEMLERİNİ silip başlığı bırakıyordu (468 fason
sevkinde aynı sınıf hasar yaşanmıştı). Artık kalemi silinen düşümün başlığı da
silinir — kapsam TEST damgasıyla sınırlı (yalnız o topların kartelalarını düşen
düşümler) ve yalnız KALEMSİZ KALAN başlıklar.

### ⑥ Bekçi taraması üç silme biçimini de arıyor

§9a: delegate çağrısı · `swatch_stock_reduction*` tablolarına ham SQL silme
ifadesi · ilişki üzerinden `items: { deleteMany`. §9b artık TÜM `src/`i tarar
(diriltme yazımı başka servise kopyalanırsa da yakalanır).

### Bekçi

`test_swatch_stock_reduction_reversal.ts` 25 → **34 kontrol**: §7d kalemsiz satır,
§7e sayfa sınırı (iki sayfa ayrık), §10 İKİ YÖNLÜ YARIŞ (açık tutulan tx ile) +
iki körlük zemini (kalemin kabul bağı, rakip tx'in claim'i).

⚠️ Yarış sondası ilk yazımda YANILTICI kırmızı verdi: `reduceStock` FIFO'su
(ürün+renk genelinde en eski müsait kartela) başka bir kabulün kartelasını
seçiyordu, yani kilitlenen belge ile düşülen kartelanın belgesi farklıydı. Her
yarış bölümü artık KENDİ rengini alıyor — kurgu hatası, kod hatası değildi.

**NEGATİF SONDA (dördü de kırmızı, sha256 eşit geri yüklendi):** (i) `FOR SHARE`
kilidi kaldırıldı → §10a/§10b/§10c (ölü kabulün kartelası dirildi) · (ii) kabul
iptali bayat dış listeyi kullandı → §10e (dirilen kartela iptalden kaçtı) ·
(iii) kalemsizlik engeli kaldırıldı → §6a/§6b/§7d · (iv) `take + 1` kaldırıldı →
§7e (hasMore her zaman false).

### Üç kapı

Migration **yok**. İzin **yok**. APK **yok**; panel sürümü gerekir (sonsuz
kaydırma + hata dalı). Sözleşme: liste yanıtı artık `{data, nextCursor, hasMore}`
— eski panel `data`yı aynı yerde bulur, yalnız sayfalamayı kullanmaz.

---

## 2026-09-12 — Müşteriye doğrudan sevk yapılmış fason sevki kilitlenir (iptal yok, kalem taşıma yok) [ÇEKİRDEK]

Fason karnesi turunun ikinci yan bulgusu (yönetici sırası 2).

### Bulgu

Kısmi/alt küme doğrudan sevkte sevk DAMGALANMAZ (`directShippedAt` yalnız TÜM
toplar gidince basılır) ve bölünme çocuğu sevk kalemi değildir; kalan top fasonda
`AT_SUBCONTRACTOR` durur. Sonuç: sevkin "müşteriye mal çıkardığı" bilgisini
YALNIZ `DirectShipment` kaydı taşır ve onu görmeyen üç yol sevki serbest sanıyordu:

- `cancel()` — engel yüklemi yalnız iptal/kabul/taşınmış-top sinyallerine bakıyor;
  kısmi sevkte üçü de boş → sevk storno olur, irsaliye VOID alır, DSK ve tahsisler
  İPTAL EDİLMİŞ sevke bağlı kalır. Müşteriye gitmiş mal "hiç sevk edilmedi" olur.
- K15 parti birleştirme konsolidasyonu — kalemleri keeper'a taşır, kaynağı
  `K15_MERGE` ile kapatır.
- K16 cerrahisi (taşıma/bölme) — aynı şeyi Dal 1/2b'den yapar.

Kalem taşımanın ikinci zararı: fason karnesi teslim metresini DSK'nın SEVKİNDEN
okur (`direct_shipments.dispatchId = sd.id`); kalem başka sevke giderse o metre
atfını kaybeder (payda kalemle taşınır, teslim metresi kalmaz → sahte fire).

### Karar

**DSK taşıyan sevk iptal edilmez ve kalemleri taşınmaz.** Tek yüklem, üç yüzey:
`resolveDispatchCancelBlockReason`a `directShipmentNo` sinyali eklendi (uç + iptal
önizlemesi aynı kaynaktan okur); K15 konsolidasyonu DSK'lı sevki ne keeper ne loser
yapar ve atladığını audit'e yazar (`skippedDirectShip` — sessiz kırpma yok); K16
`performDispatchSurgeryTx` DSK'lı kaynak sevkte 409 verir.

Ölçüt: ① müşteriye teslim edilmiş mal geri alınamaz — sevk belgesi de storno
edilemez (defter doktrini: geri alma ters kayıttır, silme değil) ② tek fabrika /
küçük ekip: kilit yerine "atla + söyle" konsolidasyonu bloke etmez ③ mevcut desen:
yüklem tek kaynakta, guard'lar mutasyondan ÖNCE, mesajlar Türkçe ve somut.

Çıkmaz sokak YOK: WO iptali DSK'lı sevki `cancelBulk`ta atlar, mevcut
`FASON_REMAINDER_DECISION_REQUIRED` akışı devreye girer ve fasonda kalan mal
"kalan gelmeyecek" kapamasıyla kapanır (bekçi D2 bunu ölçer).

### Bekçi ve negatif sonda

`scripts/test_fason_direct_ship_dispatch_lock.ts` (20 kontrol): D1 sevk iptali 409
+ gerekçede DSK no + önizleme aynı cevabı verir · D2 WO iptali kararla ilerler,
sevk iptal edilmez, kalan kapanır · D3 K15 birleştirme patlamaz, DSK'lı sevk
dokunulmadan kalır · D4 K16 bölme 409, kalemler yerinde. Negatif sonda (ayrı
worktree): üç kapı birden silinince D1a/D1b/D1f, D3b/D3c, D4a/D4b/D4c kırmızı.

### Kod çapaları

- `src/services/helpers/subcontractor-cancel.helper.ts` — `directShipmentNo` sinyali
- `src/services/subcontractor.service.ts` `cancel()` · `src/services/workorder.service.ts`
  `getCancelImpact` (önizleme aynası)
- `src/services/batch.service.ts` K15 konsolidasyonu · `src/services/helpers/batch-dispatch-surgery.helper.ts` K16

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: iki yol yeni 409 verebilir
(panelde iptal butonu zaten `cancellable` bayrağını okuyor, aynı yüklemden gelir).

---

## 2026-09-12 — ②-b: sayım stornosunun çıkışsız kapısı açıldı (denetim turu) [ÇEKİRDEK]

②'nin (sayım stornosu) bağımsız denetiminde 1 ORTA + 3 DÜŞÜK bulgu doğrulandı;
hepsi kapatıldı, şema dokunuşu yalnız ŞERH düzeltmesi.

### ASIL KARAR — LEDGER_ONLY dalı (çıkışsız kapı kalktı)

LIFO + hep-ya-hiç birleşimi bir kilit üretiyordu: sayımın düşürdüğü toplardan
biri elle geri alınmışsa (`inventory.restoreCancelledRoll`) o sayım BİR DAHA
stornolanamıyor, LIFO yüzünden o deponun TÜM eski sayımlarının storno yolu da
kalıcı kapanıyordu — ve 409 metni operatöre imkânsız bir adım söylüyordu.

Üç seçenek tartıldı: (a) "stornolanamayan sonrakini engel saymama" — REDDEDİLDİ,
fiziksel gerçeği doğrulamış sayımı görmezden gelir; (b) kısmi storno — REDDEDİLDİ,
belgeyi ikiye böler; (c) **ÇIKIŞ DALI** — kabul edildi: elle geri alınmış top
stornoyu bloklamaz, `LEDGER_ONLY` dalına düşer. Statüsüne DOKUNULMAZ (zaten
rafında), yalnız defter karşılığı yazılır: `CANCEL_REVERSAL` + sapma damgası.
Gerekçe: elle geri alma defter YAZMIYOR (bilinen delik), yani storno o topun
defterini KAPATIR — iş hem tamamlanır hem mutabakat düzelir.

**ÇİFT YAZIM SEDDİ (6e sözleşmesi).** 6e `restoreCancelledRoll`u da
`CANCEL_REVERSAL` yazacak hâle getiriyor; ikisi birlikte sahaya çıkarsa aynı top
için İKİ ters satır doğardı. Üçüncü dal eklendi: ters satırı zaten yazılmış top
`ALREADY_REVERSED` — satır YAZILMAZ, yalnız sapma damgası atılır (iş bölümü:
defter satırı 6e'de, sapma damgası burada). Tespit bugün ARA KURAL ile yapılır
(`rollId` + `stockCountId` ∪ sayım tamamlamasından sonra yazılmış ters satır) ve
6e'nin `reversesMovementId` alanı gelince tek sorguya iner; ara dönemde yazılan
satırlar bağsız (grandfathered) ve fabrikada CANCEL_REVERSAL satırı bugün SIFIR.

### Diğer bulgular

- **Panel tazeleme kümesi:** storno üç yüzeyi oynatıyor; `["rolls"]`, `["yarn"]`,
  `["warehouses","movements"]` eklendi (kardeş tamamlama diyaloğuyla simetri).
  Belirti: Envanter sekmesi storno sonrası beş dakika bayat kalıyordu.
- **Önizleme hata dalı:** istek düşerse diyalog artık "bu bir 'storno yapılamaz'
  cevabı DEĞİLDİR" + Tekrar dene basıyor; eskiden düğme gerekçesiz disabled kalıyordu.
- **Şema şerhi:** `StockCountStatus` üzerindeki "COMPLETED TERMİNALDİR" paragrafı
  SİLİNDİ (iki cümle yan yana bırakılmaz); yerine bugünkü gerçek yazıldı ve
  `defter.md` "Geçersiz kılınan kurallar"a ESKİ → YENİ satırı girdi.
- **"Belge" sütunu:** depo hareket listesi `stockCountId`yi okuyor; sayım kaynaklı
  satır artık "Sayım SAY…" basıyor (eskiden "—").
- **Olay sözlüğü paritesi mekanikleşti:** `test_warehouse_movements` §8 panel
  aynasını (liste + META) `schema.prisma` enum'uyla İKİ YÖNLÜ karşılaştırır —
  sekiz değeri elle saymak bitti.
- **Bekçi aktörü ölçüyor:** `reversedById` damgası artık kontrol ediliyor
  (düşseydi yeşil kalırdı).

### Bekçi

`test_stock_count_reversal.ts` 26 → 32 kontrol: §6 yeniden yazıldı (LEDGER_ONLY
dalı + yanıtın iki dalı ayrı sayması + statüye dokunulmaması + iki topun da
defter karşılığı + iki sapma damgası), §6h-§6j ALREADY_REVERSED (ters satır
tekrar yazılmaz, damga yine atılır). `test_warehouse_movements` §8a-§8c parite.

**NEGATİF SONDA (dördü de kırmızı, sha256 eşit geri yüklendi):** (i) LEDGER_ONLY
dalı kaldırıldı → claim eşleşmedi, storno 409 · (ii) ALREADY_REVERSED tespiti
kapatıldı → ikinci ters satır yazıldı · (iii) sapma damgası yalnız defter yazılan
topa atıldı → ALREADY_REVERSED topun damgası düştü · (iv) panel olay listesinden
`CANCEL_REVERSAL` çıkarıldı → parite kırmızı.

### Üç kapı

Migration **yok** (şema dokunuşu yalnız yorum). İzin **yok**. APK **yok**; panel
sürümü gerekir (tazeleme kümesi + önizleme dalları + "Belge" sütunu).

---

## 2026-09-12 — Karne teslim atfı ve geri alma kapısı: denetim turunun sekiz düzeltmesi [ÇEKİRDEK]

İki commit'in (karne B kararı, reopen kapısı) bağımsız denetimi beş ORTA + üç
DÜŞÜK bulgu çıkardı; hepsi doğrudan sevk (DSK) yollarında, fabrikada 0 olay →
canlı rakam etkilenmedi, düzeltme önleyici.

### Karne: teslim atfı TOP düzeyine indi

Teslim yüklemi `sd."directShippedAt" IS NOT NULL OR …` ile SEVK düzeyinden
başlıyordu; damga kalemin kendi topuna bakmadan uygulanınca iki sonuç doğuyordu:
(1) kalan-kapamasıyla deftere yazılmış FİRE, kardeş top müşteriye gidip sevk
damgalanınca karnede SİLİNİYOR; (2) aynı iki işlem TERS SIRADA yapılınca karne
farklı oran veriyordu — yani rakam operatörün tuş sırasına bağlıydı.

Yeni yüklem üç durumludur: `ownDirectShip` (topu BU sevkin DSK'sıyla çıktı →
kapanır, tamamı teslim) · `foreignDirectShip` (DSK başka sevke ait → ÖLÇÜLEMEZ
kovası: ne fire, ne açık bakiye; sayısı `unattributedItems/Qty` ile basılır) ·
`legacyStampDelivered` (DSK kaydı olmayan eski damga; yalnız kabul ve kapama
GÖRMEMİŞ kalemde teslim sayılır). Kapanış ve atıf artık AYNI yüklemden gelir —
ayrıştıkları için kalem "kapandı ama teslimi 0" olup firmaya %100 fire yazıyordu.

Çekme sapmasının atfı da kaleme bağlandı (`sourceRefId` → makbuz kalemi): aynı
top aynı adımda iki kez sevk edildiyse sapma iki kaleme de yazılıyor, dönen
metraj çift sayılıyordu. Eski (sourceRefId'siz) satırlarda davranış korunur.

`getCancelImpact.fasonRemainders` yüklemi `AND` ile yazıldı: spread aynı anahtarı
(`receiptItems`) ikinci kez yazdığı için helper'ın `none` koşulunu EZİYOR ve
tamamen dönmüş kalemler "fasonda kalan" sayılıp iptal diyaloğunda gereksiz fire
onayı istiyordu.

### Geri alma: iş emri ve refakat kartı da dirilir

`reopenRemainder` topu diriltirken yalnız adımı elle ACTIVE'e çekiyordu. Son adımı
fason olan rotada `closeRemainder` WO'yu ve kartı COMPLETED yapar; sonuç "mal
fasonda ama iş emri kapalı" — ikinci sevk 409, kabul iptali 409, kart okutulamaz.
Artık repodaki diriltme sözleşmesi uygulanıyor (emsal `tambur-manual` / manuel
taşıma): `recomputeStepStatus` + `ensureWorkOrderInProgress` + WO
COMPLETED→IN_PROGRESS + `setWorkOrderCardStatusesTx(COMPLETED→ACTIVE)` + karta
INFO izi.

Kapama kalemi aramasından `dispatch.directShippedAt: null` süzgeci DÜŞTÜ: kardeş
top müşteriye gidince sevk damgalanır ve damgayı kapıya koymak MEŞRU bir kapamanın
geri alınmasını sonsuza dek imkânsız kılıyordu. "Mal müşteriye gitti" vakasını
topun kendi geçmişi (`roll.directShipmentId`) tutuyor.

Üç 409 artık üç ayrı kod taşıyor: `REMAINDER_NOT_CLOSED` (topun durumu uygun
değil) · `REMAINDER_NOT_CLOSED_AT_STEP` (bu adımda kapama damgası yok) ·
`REMAINDER_ALREADY_REOPENED` (eşzamanlı geri alma). Swagger açıklaması da onları
sayıyor.

### Bekçiler

- `test_subcontract_scorecard.ts` §9 — kapama + damga karışımı ve İKİ İŞLEM SIRASI
  aynı rakamı vermeli (9a ≡ 9b: fire 200 m / %50); §10 — yabancı DSK ölçülemez
  kovası. 36 kontrol.
- `test_fason_reopen_remainder_guard.ts` — G1'e yan etki kontrolleri (hareket
  yeniden açıldı: `exitedAt`/`qtyOut` null + `REMAINDER_REOPENED` notu; adım
  ACTIVE), G5 tek adımlı rotada WO + kart + kart izi, G6 damgalı sevkte meşru
  kapamanın geri alınabilmesi. 26 kontrol.
- Bekçi haritasında üst özet ile bölüm başlığı sayacı eşitlendi; `consistency-check-derived`
  §24a yorumu hangi koşulu UYGULAMADIĞINI söylüyor.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: karne satırına iki alan
EKLENDİ (`unattributedItems`, `unattributedQty`); panel tipleri ve dışa aktarım
açıklaması güncellendi, eski panel alanları yok sayar.

---

## 2026-09-12 — Doğrudan sevk damgası işlem sırasından bağımsızlaştı [ÇEKİRDEK]

Denetimin dördüncü maddesi (yönetici sırası 4).

### Bulgu

`executeDirectShip` damgayı "sevkin hâlâ fasonda kaç topu var" sayımından
veriyordu: `isFullDispatchShip = dispatchStillAtSub === shipRollIds.length`.
Kardeş kalem kalan-kapamasıyla kapandıysa o top artık `AT_SUBCONTRACTOR` olmadığı
için sayım tutuyor ve damga BASILIYOR; aynı iki işlem ters sırada yapılınca damga
BASILMIYOR. Yani `directShippedAt` — belgeyi donduran, karnede eski satırlar için
teslim sayılan, outstanding filtresinde sevki kapatan damga — operatörün tuş
sırasına bağlıydı.

### Karar

Damga ölçütü kalemlerin TOPUNDAN okunur: sevkin her kaleminin topu bu sevkin
DSK'sıyla müşteriye çıktıysa (`roll.directShipmentId` dolu) damga basılır, aksi
halde basılmaz. Kalan-kapamalı ya da kabul görmüş kalem varsa sevk "tamamen
müşteriye çıkmış" DEĞİLDİR — bu, damganın sözlük anlamıyla da örtüşür. Ölçüm
DSK kaydı yazıldıktan SONRA yapılır (atomik claim korunur); bölünmede ebeveyn
kalem fasonda kaldığı için ölçüt kendiliğinden false verir ve eski `anySplit`
geçersiz kılması gereksizleşti.

Ölçüt sırası: ① damga bir BELGE gerçeğidir (irsaliye dondurma) ve belgenin
doğruluğu işlem sırasına bağlı olamaz; ② tek fabrika: kalan tüketiciler
(`OPEN_OUTSTANDING`, karne) zaten kalem düzeyine indirilmişti, damga son
tüketiciydi; ③ atomik claim deseni korunur.

### Bekçi ve negatif sonda

`test_subcontract_scorecard.ts` §9 — aynı iki işlem iki sırada koşulur; 9a ≡ 9b
(fire 200 m / %50) ve 9c damganın İKİ SIRADA da basılmadığını ölçer. Negatif sonda
(ayrı worktree): ölçüt eski sayıma döndürülünce 9c kırmızı. Yan etki taraması:
`test_direct_ship_fason` (tam sevkte damga hâlâ basılıyor), `test_direct_ship_scenarios`,
`test_input_rolls_directship`, `test_fason_open_dispatch_semantics` yeşil.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: karışık kapanışlı sevkte
yanıt `partialShip: true` döner (eskiden `false`); panelde bu alan yalnız bilgi
satırıdır.

---

## 2026-09-12 — ④ Birleştirme defteri: master-data merge artık geri alınabilir [ÇEKİRDEK]

Defter doktrini kalan borç ④. `master-data-merge` başlığı "GERİ ALINAMAZ ve bu
açıkça söylenir" diyordu; ölçüm gösterdi ki geri alınamazlığın sebebi KARAR değil
EKSİK DEFTERdi: taşınan satırın KİMLİĞİ hiçbir yerde durmuyor, taşıma dökümü
yalnız audit yükünde (tablo başına SAYI) duruyordu ve audit 6 ayda arşivleniyor.
Fabrikada 19 birleştirme tombstone'u var (3 müşteri · 7 kumaş · 6 renk · 3 fason).

### Defter (üç tablo)

- `MergeOperation`: işlem başlığı — varlık, survivor, gerekçe, çözülen çakışma
  sayısı, `fieldPicks` (hangi alan hangi kayıttan + ÖNCEKİ değer) ve GERİ ALMA
  DAMGASI (`revertedAt`/`revertedById`/`revertReason`). İleri satır değişmez.
- `MergeOperationSource`: kaynakların TOMBSTONE ÖNCESİ hâli (ad, kod, `isActive`)
  — geri alma adı/aktifliği buradan yazar, audit'ten OKUMAZ.
- `MergeOperationRef`: tablo+kolon+kaynak başına tek satır; `MOVED` taşınan
  satırların PK'ları (tek kolonlu uuid PK'da `rowIds`, composite PK'da `rowKeys`),
  `DELETED` çakışma politikasının sildiği satırın TAM fotoğrafı, `FIELD_MERGED`
  survivor satırının zenginleşmeden önceki hâli.

### Yakalama — taşıma artık KAYNAK BAŞINA koşuyor

Eski kod tek `UPDATE … WHERE col = ANY(sources)` ile taşıyordu; o ifade hangi
satırın hangi kaynaktan geldiğini SÖYLEYEMEZ. Artık kaynak başına `UPDATE …
RETURNING <pk>` koşuyor (`movePerSourceTx`): kaynak sayısı ≤20 ve tablo sayısı
bir avuç olduğu için maliyet ihmal edilebilir, kazanç geri alınabilirlik.
Çakışma politikalarının sildiği satırlar `DELETE … RETURNING to_jsonb(s.*)` ile,
`MERGE_FIELDS`in zenginleştirdiği survivor satırları UPDATE'ten ÖNCE fotoğrafla
yakalanıyor. PK ÇALIŞMA ANINDA `pg_index`ten çözülür — haritaya ikinci bir
envanter yazmak "elle sayılan kapsam listesi" yasağına girerdi; bugün tek
composite PK'lı tablo `subcontractor_category_links` ve kod onu özel-kasa olarak
BİLMİYOR, PK'sından görüyor.

### Geri alma kuralları

- **LIFO:** bir kaydı ilgilendiren daha sonraki (geri alınmamış) birleştirme
  varsa 409 — aradaki operasyonun taşıdığı satırlar bu geri almanın kümesinde
  değildir ve sıra bozulursa iki defter birbirini yalanlar.
- **AD ÇAKIŞMASI KULLANICI KARARIDIR:** mükerrerlerin katlanmış adı çoğunlukla
  AYNIDIR; tombstone kalkar kalkmaz `<tablo>_nameFold_key` partial unique'i ikinci
  satırı reddeder. Geri alma isteği çakışan kaynak için YENİ AD taşır (409
  `UNMERGE_NEEDS_RENAME` + önizleme hangi kaydın çakıştığını söyler).
- **ATLANAN SATIR SESSİZ DEĞİL:** birleştirmeden sonra başka yere taşınmış,
  silinmiş ya da anahtarı yeniden doğmuş satır geri yazılamaz; sayısı yanıtta ve
  audit'te AYRI alan (`skippedRows`). "Hepsi döndü" yalanı yok.
- **Defter öncesi birleştirme geri alınamaz** (kalem dökümü yok) — geçmiş
  uydurulmaz; o küme için emniyet ağı gece yedeği + kopyaya geri yükleme.
- **Mükerrer kuyruğu:** geri alınan çift `MERGED` → `DEFERRED` (kuyrukta kalır,
  işaretli). `NOT_DUPLICATE` yalan olurdu, satırı silmek kararın izini yok ederdi.

### KİLİT SIRASI DEĞİŞMEZİ (ES-25)

Denetim bir deadlock yolu buldu: birleştirme `swatches` → `swatch_stock_reductions`
sırasında kilitlerken, kartela düşüm stornosu TERS sırada (düşüm başlığı → kartela)
ilerliyordu; iki tx aynı anda koşarsa 40P01. İki seçenek tartıldı — kartela stok
işini merge advisory uzayına (8030) bağlamak REDDEDİLDİ (yanlış eşleşme, gereksiz
serileşme); `MERGE_MAP`te düşüm kuralı kartela kuralından ÖNCEYE alındı. Artık iki
yolda tek sıra var: **düşüm defteri → kartela**. Kural `ESZAMANLILIK.md` [ES-25].

### Kod çapaları

- Migration `20260912130000_merge_operation_ledger` + `20260912130100` (rowIds
  DEFAULT'u düşürüldü — şema ikizliği); şema dilimi commit'i `03d7b9b2`.
- `helpers/merge-ledger.helper.ts` — yakalama + geri yazma SQL'leri (PK çözümü,
  `RETURNING`, fotoğraftan `jsonb_populate_recordset` ile yeniden yazma).
- `master-data-unmerge.service.ts` (claim + yazım + audit) ↔
  `helpers/master-data-unmerge-plan.helper.ts` (karar: engeller, LIFO, ad çakışması).
- Uçlar: `GET /api/master-data/merges` · `GET /merges/:id/revert-preview` ·
  `POST /merges/:id/revert` (izin `master-data:merge`; ikinci kapı
  `requireEntityWrite` kullanılamaz — yol `:entity` taşımıyor, varlık defterden
  çözülüyor ve geri alma yeni veri üretmiyor).
- Panel: Mükerrer Kayıtlar → "Birleştirme Geçmişi" diyaloğu (defter dökümü, engel
  listesi, çakışan kaynak için yeni ad alanı); `MergeConfirmGate`in "geri alınamaz"
  şeridi bugünkü gerçeğe çevrildi.

### Bekçi

`scripts/test_master_data_merge_revert.ts` — §1 defter yazımı (kaynak künyesi +
taşınan satırın kimliği) · §2 geri alma (referans kaynağına, tombstone kalkar, ad
defterden, operasyon satırı değişmez + damga) · §3 çift geri alma 409 · §4 LIFO ·
§5 ad çakışması (409 + yeni adla geçer) · §6 defter öncesi operasyon + kuyruk izi
`DEFERRED` · §7 kilit sırası değişmezi.

### Üç kapı

Migration **var** (iki dosya, şema dilimi `03d7b9b2`). İzin **yok** (mevcut
`master-data:merge`). APK **yok**; panel sürümü gerekir (Birleştirme Geçmişi).

## 2026-09-12 — Kalıcı silme kapsama bekçisi: izlenen model listesi route'tan TÜRÜYOR (K5) [ÇEKİRDEK]

### Saha sorusu ve ölçüm

`test_hard_delete_guard_coverage.ts` yalnız üç modeli izliyordu (`WATCHED = {Item,
Customer, Device}`) ve liste ELLE tutuluyordu. Sahada `DELETE /:id/permanent` ucu ON
DÖRT çıktı (13 route dosyası; `station.routes.ts` iki uç taşıyor). İlk grep'im ikisini
kaçırdı — `peripheral.routes.ts:134` ve `device.routes.ts:123` ayrı router değişkeni
kullanıyor, `defect-type.routes.ts:46` mount'u ÇOK SATIRLI yazıyor: "grep'le say"
yöntemi de elle liste kadar kör.

Uçların BEŞİ adına rağmen fiziksel silmiyor: Roll (`status CANCELLED` arşivi),
WorkOrder (`isActive:false`), LabelTemplate + PeripheralDevice (`deletedAt` mezar
taşı), Order (`hardDelete()` → `softDelete()` yönlendirmesi). O uçlarda gelen FK'nın
SetNull/Cascade aksiyonu hiç tetiklenmez. Geriye dokuz model kalıyor ve altısı
(Station, Machine, Route, ProductRecipe, Warehouse, DefectType) bekçiye hiç
görünmüyordu — 35 SetNull/Cascade bağının 16'sı ölçüm dışıydı.

### Karar

- `WATCHED` elle liste olmaktan çıktı: `ENDPOINT_TARGETS` (uç → fiziksel silinen
  model) haritasından TÜRER. Eksiksizlik İKİ YÖNLÜ ölçülür — haritasız yeni uç
  kırmızı, route'tan kaybolmuş harita satırı kırmızı.
- "Bu uç silmiyor" iddiası ÇAPALI: `null` eşlenen her uç için ilgili servis dosyasında
  `(prisma|tx).<model>.delete(Many)?(` BULUNMAMALI. Mezar taşı gerçek silmeye
  çevrilirse bekçi kırmızı olur ve EXPECTED satırı yazılmaya zorlar.
- Yeni §D: Machine'e gelen her FK kolonu ya `MACHINE_DELETE_GUARDS`ta sayılır ya
  `MACHINE_GUARD_EXEMPT`te gerekçelidir; ölü guard satırı ve ölü muaf da kırmızı verir.
- Ölçüm bir BOŞLUK buldu, aynı commit'te kapatıldı: `KursunBypassAssignment.machine`
  RESTRICT'ti ama sayımı yoktu — bypass ataması olan makineyi kalıcı silmek operatöre
  jenerik P2003 veriyordu. `kursunBypassCount` guard'ı eklendi (Türkçe 409 + somut sayı).

### Gerekçe

Elle tutulan izleme listesi sessiz körlük üretir: ilişki eklenince değil, UÇ eklenince
kör kalır — üç modelden on dörde geçen sürede kimse listeyi büyütmedi. Route keşfi o
kör noktayı kapatır; "bu uç neyi siliyor" eşlemesi elle kalır çünkü mekanik değildir,
ama artık ölçülen bir iddiadır. Mezar taşı uçlarının modellerini izlemek YANLIŞ olurdu:
FK aksiyonu tetiklenmediği için her satır "guard'sız delik" gibi görünür, gerçek
delikleri gürültüye gömerdi.

### Kod çapaları

- `Teks-Erp/scripts/test_hard_delete_guard_coverage.ts` — §A uç keşfi (yorumlar
  sökülür), §B mezar taşı çapası, §C SetNull/Cascade envanteri (9 model / 35 bağ),
  §D Machine guard alt kümesi (7 FK ↔ 6 sayım + 1 gerekçeli muaf).
- `Teks-Erp/src/services/helpers/guarded-hard-remove.ts` — `kursunBypassCount` guard'ı.

### Bekçi

17 kontrol yeşil. Negatif sondalar (üçü de kırmızı verdi, iki dosya sha256 ile geri
yüklendi): ① haritadan `machineHardRemove` satırı silindi → §A haritasız uç + §C beş
bayat Machine satırı · ② `MACHINE_DELETE_GUARDS`tan `kursunBypassAssignment` sayımı
yoruma alındı → §D sayımsız FK · ③ Order'ın mezar taşı çapası gerçekten silinen pivota
(`workOrderToOrderLine`) çevrildi → §B kırmızı. Yorum sökme ŞART: sondada yorumlanmış
satır "var" sayılsaydı ikinci sonda yeşil kalırdı.

### Üç kapı

Migration **yok** (şema değişmedi). İzin **yok**. APK/panel **yok** — değişiklik
backend guard mesajı + bekçi.
---

## 2026-09-12 — DSK kilidi tx'e indi; kalan-kapama geri alma terminal iş emrinde kapalı [ÇEKİRDEK]

`fb0ad67e` denetiminin iki ORTA'sı ve beş DÜŞÜK'ü.

### ORTA-1 — kilit doğruydu, yeri yanlıştı

`cancel()` DSK sinyalini tx DIŞINDA okuyordu; tx içindeki claim yalnız
`cancelledAt: null` ile korunuyordu. Yarış: iptal guard'ı geçer, eşzamanlı
`executeDirectShip` KISMİ sevk yapar (çocuk toplar tüketilir, EBEVEYNLER fasonda
kalır, `notDelivered ≥ 1` olduğu için damga da basılmaz), iptal tx'i uyanır, roll
claim'i ebeveynleri bulur ve İPTAL BAŞARIR — DSK ile tahsisler iptal edilmiş
sevke asılı kalır, karne `cancelledAt IS NULL` süzgeciyle müşteriye çıkmış metreyi
kaybeder. Pencere dar değildi: iki yol da aynı WO satırını kilitliyor ama kilit
guard okumasından SONRA alınıyordu (kök kuralın "kilit tx'in İLK ifadesidir"
maddesinin ihlali).

Düzeltme: koşul CLAIM'İN İÇİNDE (`directShipments: { none: {} }`); `count===0`'da
tanı tx içinde taze okunur ve mesaj `resolveDispatchCancelBlockReason`dan gelir
(önizlemeyle simetri). Tx dışı okuma önizleme olarak kaldı.

### ORTA-2 — terminal iş emrinde geri alma

`reopenRemainder` iş emrinin durumunu hiç sormuyordu. DSK kilidi operatörü "WO
iptal + kalan kapaması" yoluna ittiği için şu şekle kolayca düşülüyordu: iptal
edilmiş WO'nun adımına canlı top geri konur, kart diriltilmez, iz yazılmaz ve
çıkış yolu kalmaz (DB müdahalesi). Artık `closedItem` sorgusu WO durumunu okur;
CANCELLED/SUPERSEDED'de 409 `WORK_ORDER_TERMINAL` (fail-closed).

### Beş DÜŞÜK

1. Damga ölçütü yabancı DSK'yı "teslim" sayıyordu → ölçüt `ownDirectShip` ikizi
   oldu (topun DSK'sı BU sevke ait olmalı).
2. K15 "atlanan DSK'lı sevk" audit'i tek sevkli adımda da yazılıyordu (gürültü) →
   yalnız konsolidasyon imkânı olan (2+ sevk) adımda yazılır.
3. "Ölçülemez" kovası motorda vardı, yüzeyi yoktu → panelde kolon + dışa aktarım
   (ayrı commit).
4. Swagger bloğunda OpenAPI dışı `responses ek:` anahtarı vardı → beş 409 kodu
   gerçek `responses` bölümüne taşındı.
5. İptal önizlemesi DSK numarasını sırasız `take: 1` ile seçiyordu → uçla aynı
   `orderBy: shippedAt asc`.

### Bekçiler

`test_fason_direct_ship_dispatch_lock` D5 (eşzamanlı iptal + kısmi sevk: ikisi
birden olamaz, kazanan hangisiyse veri onunla tutarlı) ve D6 (claim yükleminin
metin sondası) · `test_fason_reopen_remainder_guard` G10 (terminal WO → 409).
24 + 42 kontrol.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: iptal ucu yeni bir 409
metni döndürebilir (aynı yüklemden), geri alma ucu yeni `WORK_ORDER_TERMINAL`
kodunu ekler.

---

## 2026-09-12 — Bekçi/paket hedefi FİXTURE DB olmak zorunda (üç ayaklı kapı) [ÇEKİRDEK]

### Bulgu

Ortak çalışma ağacındaki `Teks-Erp/.env` `tekserp_fabrika_dev`i — fabrikanın
canlı yedeğini — gösteriyor. Açık `DATABASE_URL` verilmeden koşulan HER bekçi
oraya yazar; tam paket 1.500'den fazla `deleteMany` gönderir. `productionDbGate`
yalnız HOST'a bakıyordu ve fabrika yedeği de localhost'ta olduğu için kapı bu
riski GÖRMÜYORDU. Aynı gün ölçüldü: 07:19'da fabrika yedeğinde üç fixture
(`TEST-GHR-ROTA/IST/MAK-*`) yaratılıp silinmiş — `test_guarded_hard_remove`'un
kendi temizliği. Gerçek kayıp yok; delik gerçek.

### Karar — kapı ÜÇ AYAKLI

1. **Host** (bugüne kadarki tek ayak): hedef yerel değilse DUR.
2. **Ad**: hedef DB adı `_test` ile bitmiyorsa DUR. İlk yazımda `_local` de
   kabul ediliyordu; o son eki taşıyan tek bir veritabanı olmadığı için kabul
   kümesi daraltıldı — kapının kabulü KULLANILAN adlardan geniş olmamalı.
   `db-guard.ts` daha geniş bir küme (`_dev`/`_demo`) tanımaya devam eder: o
   kapı "geliştirme hedefi mi", bu kapı "fixture hedefi mi" sorusunu cevaplar.
3. **Hacim**: hedefteki top sayısı 500'ü aşıyorsa DUR. Ad kalıbı yanılabilir
   (fabrikanın yarın `..._test` adıyla doğacak bir kopyası kalıptan geçer);
   veri hacmi yanılmaz — ölçüldü: fixture DB 28 top, fabrika yedeği 5.784.
   Ölçüm yapılamazsa koşum sürer ama "ölçülemedi" notu basılır: sessizlik
   "ölçüldü" sanılmasın.

Kaçış (2) ve (3) için `BEKCI_HEDEF_ONAY=1` — bilinçli karardır ve hedef adı ile
top sayısı log'a basılır. Yüklemler tek kaynakta: `scripts/lib/hedef-db-kapisi.ts`
(`fixtureHedefEngeli` · `hacimEngeliMetni` saf + `hacimHedefEngeli` I/O).

**Silen temizlik yolları da bu kapıdan geçer:** `clean_test_residue.ts` artık
`--apply` verilmeden de durur. Gerekçe: kuru koşum "zararsız" değildir, raporu
doğru sanan operatörün bir sonraki komutu `--apply` olur; ve `db-guard` `_dev`i
geliştirme hedefi sayıp o yolu açık bırakıyordu.

### Bekçi ve negatif sonda

`test_script_guards.ts` §6–§8, her ayak İKİ YÖNLÜ: fabrika adıyla koşucu durur
(exit 1 + gerekçe + hedef adı), fixture adıyla GEÇER; hacim yüklemi 28 topu
geçirir, eşiğin bir üstünü durdurur, eşiğin tam kendisini geçirir (sınır kapalı
değil); koşucunun `hacimGeciti()` çağrısı metinle ölçülür (yüklem var ≠ kapı
var); temizlik betiği fabrika adında `--apply`sız durur ve rapor başlığını bile
basmaz. Negatif sonda (ayrı worktree): kapı çağrısı silinince ilgili kontrol
kırmızı.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: açık `DATABASE_URL`
olmadan paket koşumu artık mümkün değil (kadro kuralı).
## 2026-09-12 — Sayım stornosu 6e'nin stok defteri kapısına bağlandı; çift yazım seddi tek alana indi (②-c) [ÇEKİRDEK]

### Ölçüm

②'de (2026-09-11) sayım stornosu yazılırken `reversesMovementId` alanı henüz yoktu;
"bu geri alma deftere yazıldı mı" sorusu ARA KURALLA cevaplanıyordu: `rollId` +
`stockCountId` + olay tipi ∪ "sayım tamamlamasından sonra yazılmış bağsız ters satır".
Bu yaklaşıktı ve bir denetim bulgusu üretmişti (kardeş sayımın ters satırı seddi
yanlış yerden kapatıyordu, §6k ile kapatılmıştı). 6e'nin A2 dilimi (`f3b0ebf8`)
alanı, `postStockMoves` toplu kapısını ve `reverseStockMove`a `eventType` override'ını
getirdi; bu not o bağlamayı kaydeder.

Ölçüm (fabrika yedeği, salt okunur): `stockCountId`'li CANCEL satırı 0 · `CANCEL_REVERSAL`
0 · `reversesMovementId` dolu satır 0 · `fromStatus` dolu satır 0 · stornolanmamış
tamamlanmış sayım 0. Yani geriye dönük veri taşıma (backfill) GEREKMİYOR; eski-satır
dalı yalnız savunma olarak duruyor ve sondayla ölçülüyor.

### Karar

- **Tespit tek alandan:** `ALREADY_REVERSED` dalı artık ileri (CANCEL) satırın
  terslenmiş olup olmadığına bakar (`reversedBy` zinciri). Tip sayma ve belge bağıyla
  eşleme KALDIRILDI.
- **İleri yazım stok defteri sözleşmesine geçti:** `writeWarehouseMovements` yerine
  `postStockMoves`; çıkış ucu `from: { warehouseId, status }` (topun İPTAL ÖNCESİ
  statüsü) ve `reasonCode: STOCK_COUNT`. `fromStatus` olmadan ters kaydın yönü
  aynalanamıyordu — eski yazıcı bu veriyi hiç üretmiyordu.
- **Ters satır tek-tek yazılır** (`reverseStockMove`, `eventType: CANCEL_REVERSAL`
  override'ı ile): her ters satır KENDİ ileri satırının id'sine bağlanmak zorunda,
  `createMany` ise id döndürmüyor. İleri yazım toplu kalır ("200 eksik topta 2 sorgu"
  gerekçesi korunur), ters yazım tekil.
- **Enum BETİMLEYİCİ:** satırın storno olduğu `reversesMovementId`den okunur; hareket
  listesi ucu her satırda `isReversal` döner (6e ile ortak karar — panel rozeti bundan
  okuyacak, `WAREHOUSE_EVENT_META.reversal` yalnız varsayılan ton).
- **Eski kayıt dalı (grandfathering):** ileri satır yok ya da `fromStatus` taşımıyorsa
  storno PATLAMAZ; ucu plandan (`ledgerToStatus`) kurar ve satır BAĞSIZ kalır. Σ
  etkilenmez (katkı yönden gelir, bağdan değil).
- Yan düzeltme: `master-data-unmerge.service.ts` advisory uzayı 8030'u İKİNCİ KEZ
  tanımlıyordu; merge servisinden ithal ediyor (envanter kuralı — uzay tek yerde).

### Gerekçe

İki kaynak olan her yerde biri gün gelir yalan söyler: "bu satır storno mudur"
sorusunun hem enum hem bağ tarafından cevaplanması, paneli ve raporu birbirinden
ayrı iki gerçeğe bağlardı. Enum'u silmek de doğru değildi — canlıda/testte o tiple
yazılmış satırlar var ve panel etiketi/ton oradan geliyor. Çözüm ayrım: KARAR bağdan,
TON enumdan.

### Kod çapaları

- `Teks-Erp/src/services/helpers/stock-count-reversal-plan.helper.ts` — ileri satır
  araması (`reversesMovementId: null` + `orderBy createdAt`), `cancelMovementId`,
  `cancelHasStatus`, `ledgerToStatus`.
- `Teks-Erp/src/services/stock-count-reversal.service.ts` — `reverseStockMove` dalı +
  bağsız eski-kayıt dalı.
- `Teks-Erp/src/services/stock-count.service.ts` — ileri CANCEL yazımı `postStockMoves`.
- `Teks-Erp/src/services/warehouse.service.ts` — liste ucunda `isReversal`.

### Bekçi

`test_stock_count_reversal.ts` 44 kontrol (yeni: §3c2 ileri satır sözleşmesi · §3c3
bağ + yön aynası · §6h bağlı taklit satır · §6h2 BAĞSIZ satır seddi açmaz · §6l
eski-satır dalı · §6m terslenmiş ileri satır seçilmez · §6n tipi `CANCEL` olan ters
satır ileri satır sanılmaz) · `test_warehouse_movements.ts` §9 (`isReversal` bağdan
türer: bağı dolu `CANCEL` satırı true, bağsız `CANCEL_REVERSAL` false). P2002 (aynı
satır iki kez terslenemez) 6e'nin helper bekçisinde ölçülüyor, burada tekrarlanmadı.

Negatif sondalar — ALTISI DA kırmızı verdi, dört dosya sha256 ile geri yüklendi:
① ters satırda `eventType` override'ını kaldır → §3b/§3c/§3c3/§6f · ② ileri satırın
sebep kodunu boz → §3c2 · ③ listeden `isReversal` alanını kaldır → §9b/§9c · ④ seçim
kuralını boz (terslenmemiş değil, son satırı al) → §6h + P2002 çökmesi · ⑤
ALREADY_REVERSED dalını kapat → §6h/§6n · ⑥ plan yükleminden `reversesMovementId: null`
çıkar → §6n.

⚠️ ÖLÇÜMÜN BULDUĞU KOD HATASI (kayda geçer): ilk yazımda `reversesMovementId: null`
yüklemini "terslenmemiş satır" sanmıştım; o yüklem "bu satır ters kayıt DEĞİL" der.
İkisini karıştıran kod, aynı sayımda aynı topun iki ileri satırı varken TERSLENMİŞ
olanı seçiyordu (dal yanlışlıkla ALREADY_REVERSED). §6m senaryosu bunu ilk koşumda
kırmızı verdi; doğru model "top başına ileri satırları grupla, TERSLENMEMİŞ olanı seç,
hiçbiri yoksa ALREADY_REVERSED"dır ve `reversedBy` zincirinden okunur. Yüklem yine
gerekli (tipi `CANCEL` olan ters satırı ayırır) ve artık §6n onu ölçüyor. Ders: sonda
kırmızı vermiyorsa ya kural ölçülmüyordur ya senaryo eksiktir — ikisi de niyettir.

### Üç kapı

Migration **yok** (alan 6e'nin diliminde geldi). İzin **yok**. APK **yok**; panel
rozeti `isReversal`a bağlanacak (6e, ayrı commit).

## 2026-09-12 — 0 metrajlı top sayım farkıyla kapatılamaz: kapsam kararı KURAL, defter süzgeci KEMER [ÇEKİRDEK]

### Saha sorusu ve ölçüm

②-c sayımın ileri CANCEL yazımını `postStockMoves`a taşıdı. O kapı `qty <= 0`da
SESSİZCE ATLAMAZ, `AppError.internal` FIRLATIR (DB seddi `warehouse_movements_qty_positive`
ikizi `qtyYazilabilir`) ve `createMany` tek sorgu olduğu için tüm tx geri sarılır.
Aynı gün `edea91d6` bu sınıf için DÖRT kardeş yazıcıya süzgeç ekledi; sayım çağrısı
dışarıda kalmıştı. Sonuç: depoda 0 metrajlı bir top "eksik" işaretlenirse sayım
tamamlama 500 veriyordu ve o sayım BİR DAHA KAPANMIYORDU.

Ölçümler (2026-09-12, fabrika kopyası, salt okunur):
- Sayılabilir statüde `currentQty <= 0` top: **2** — ama **ikisinin de deposu NULL**,
  sayım fotoğrafı `warehouseId = sayımın deposu` süzdüğü için bugün sayıma giremiyorlar.
- 6e'nin bağımsız ölçümü aynı yere çıktı: stok kümesinde (depo dolu + STOCK/WAREHOUSE/
  A1_STOCK/RETURNED) 0 metrajlı top **YOK**; defterde `qty <= 0` satır **0**.
- `warehouse_movements_qty_positive` CHECK'i canlı: push ÖNCESİ de aynı girdi 23514 ile
  düşüyordu, yani REGRESYON DEĞİL — değişen yalnız hatanın şekli.
- ⚠️ "Bugün ulaşılamaz" ile "imkânsız" AYNI ŞEY DEĞİL: `warehouse-ledger.helper`in kendi
  notu yolun gerçek olduğunu söylüyor ("Kurşun açık kumaşın `currentQty: 0` ile depoya
  inmesi bu yolu bayraksız tetikliyordu").

### Karar

- **0 metrajlı top "eksik stok" değil BOŞ KAYITTIR.** Sayım onu farkla kapatmaz: satır
  KAPSAM DIŞI kalır, gerekçesi metrajı VE çıkışı söyler ("Metrajı 0 — sayım farkı
  yazılamaz; topu kayıttan düşmek için top ekranından iptal/fire kullanın"), top İPTAL
  EDİLMEZ, ne defter ne sapma satırı doğar.
- Karar claim'den ÖNCE, tx içindeki TAZE okumanın `currentQty`si ile verilir (fotoğrafa
  güvenilmez; kapsam kontrolü CAS'tan ayrıdır ve ikisi de gereklidir).
- Eşik TEK yüklemden ithal edilir (`qtyYazilabilir`), ikinci bir eşik yazılmaz.
- **KURAL kapsam kararı, defter yazımındaki süzgeç yalnız KEMER** ve kemer SESSİZCE
  ATLAMAZ: `kapsam kararı atlanmış: <barkod>` diye ADIYLA fırlatır, tx geri sarılır.

### Gerekçe — önerilen düzeltmenin KENDİ SONUCU ölçüldü

İlk öneri "defter yazımını `qtyYazilabilir` ile süz" idi. Ölçüm onu çürüttü:
`recordVariancesTx` 0 metrajı ZATEN sessizce atlıyor (`if (!qtyD.greaterThan(0)) return null`).
Yalnız defteri süzmek, topu SAPMA KAYDI OLMADAN iptal ederdi; sayım stornosunun plan
katmanı her top için tam bir sapma kaydı aradığı için ("Sayımın sapma kaydı bulunamadı")
o sayım KALICI olarak stornolanamaz hâle gelirdi — bir kusuru kapatıp daha kötüsünü
açardı. Aynı nedenle KEMER de sessiz olamaz: sessiz kemer, kapattığımız sınıfın
(sessiz atlama) ikinci kopyasıdır.

Ders: **önerilen düzeltmeyi uygulamadan önce o düzeltmenin kendi sonucunu ölç.**

### Kod çapaları

- `Teks-Erp/src/services/stock-count.service.ts` — kapsam dalı (claim'den önce) +
  kemer iddiası (defter map'inden önce), ikisinin ayrımı yorumda yazılı.

### Bekçi

`test_stock_count.ts` §14 (6 kontrol): fotoğrafa girdi · tamamlama BAŞARILI · satır
kapsam dışı + gerekçe metrajı söylüyor · gerekçe çıkışı söylüyor · top iptal edilmedi ·
ne defter ne sapma satırı doğdu. Toplam 104/104 yeşil.
Negatif sonda (e): kapsam dalı kaldırıldı → §14b/14c/14c2 KIRMIZI ve hata mesajı
kemerin adını bastı ("Kapsam kararı atlanmış: … 0 metrajlı top defter yazımına ulaştı"),
yani kemerin ulaşılabilir ve ADLANDIRILMIŞ olduğu da ölçüldü. Dosya sha256 ile geri
yüklendi.

### Üç kapı

Migration **yok**. İzin **yok**. APK/panel **yok** — kapsam dışı gerekçesi zaten
tutanakta ve sayım ekranında basılıyor.

### Yan ölçüm (kayda geçsin)

Commit kapısı `--amend`de değişen kümeyi amend TABANINA göre hesaplıyor: büyük bir
değişikliği amend'e sıkıştırmak kapıyı SESSİZCE DARALTIR (ölçüldü 2026-09-12: mobil
commit'in amend'inde yalnız doküman adımı koştu, beş ayaklı mobil kapı koşmadı; teyit
elle yapıldı). Mekanikleştirme 5e'de.
---

## 2026-09-12 — "Sessiz atlama" sınıfı: HTTP bekçisi kendi kullanıcısını yaratır, yabancı sunucu KIRMIZIDIR [ÇEKİRDEK]

### Bulgu

Paket taban koşumunda beş bekçi 19 kontrolü "atlandı" diye bildirdi ve gerekçe
SUNUCU YOKLUĞU sanıldı. Ölçüldü: dört portta da `/health` 200 dönüyordu. İki ayrı
delik vardı, ikisi de aynı yerde bitiyordu — sessizlik:

1. `test_settings_password` ve `test_module_profile`, var olduğunu VARSAYDIĞI
   `p2test` kullanıcısıyla giriş deniyordu. O kullanıcıyı repoda yaratan tek satır
   yok; taze her fixture DB'sinde 401 gelir ve 16 kontrol düşerdi.
   `Teks-Erp/CLAUDE.md`'nin "HTTP bekçisi kendi kullanıcısını fixture ile yaratır"
   kuralı fiilen çiğnenmişti.
2. Sabit port BAŞKA bir oturumun sunucusunda olabiliyor ve o sunucu BAŞKA bir
   veritabanına bakıyor olabiliyordu (aynı gün 4101'de yaşandı). Bekçi o hâlde ya
   yanlış DB'yi ölçer ya 401 alıp "sunucu yok" der.

Sayaç da yanlıştı: `atla()` bir sayıyor, `test_module_profile`ın ölçülmeyen DÖRT
kontrolü "1 atlandı" görünüyordu — yani "19" gerçek kaybı OLDUĞUNDAN AZ gösteriyordu.

**Sessizliğin somut bedeli:** HTTP ayağı koşar koşmaz sekiz gündür saklanan bir
çelişki çıktı — `GET /admin/settings-password` in-process ayakta 403 beklenirken
HTTP ayağında hâlâ 404 bekleniyordu (2026-09-04 kararı yalnız bir ayağa
uygulanmıştı). Bekçi ölçmediği için kimse görmedi.

### Karar — YOKLUK ≠ YABANCI

Tek kaynak `scripts/lib/http-bekci-kapisi.ts`:
- **Sunucu yok** → beyan edilmiş ATLAMA; GERÇEK kontrol sayısı sayaca eklenir
  (`atla()` yalnız birini sayar, kalanı çağıran ekler). Kırmızı yapılmadı: beş
  sunucuyu her koşumda ayağa kaldırmak beklenmiyor ve paketin yeşil olma yolu
  kapanırsa "paket yeşil mi" sorusunun cevabı kalmaz.
- **Sunucu var ama YABANCI** → KIRMIZI: ölçüm yapıldığı sanılırken başka bir
  veritabanı ölçülüyor olurdu.
- **`TEKSERP_STRICT=1`** → yokluk da kırmızı. "Yeşil = kapsandı" ancak strict
  koşumda iddia edilir; anahtar TEK isimdir (ikinci bir strict bayrağı iki koşumu
  iki farklı şey iddia eder hâle getirir).

**"Aynı DB mi" kanıtı:** bekçi kullanıcısını Prisma ile KENDİ yaratır
(`ensureTestAdmin`), hemen ardından HTTP'den giriş dener; 200 ⇒ sunucu zorunlu
olarak aynı `users` tablosunu okumuştur. Kimliksiz `/health` ucuna kurulum damgası
koyma seçeneği REDDEDİLDİ: o uç LAN'dan görünür ve ürün koduna "yalnız
geliştirmede" dallanması sokardı. Var olan bir kullanıcıyla giriş denemek de
yetmez (401 belirsizdir) — kullanıcı AYNI koşumda yaratıldığı için belirsizlik kalkar.

### Ölçüm (öncesi → sonrası, fixture DB + ayakta sunucu)

`test_settings_password` 134/0/13 → 145/1/0 (o 1 kırmızı yukarıdaki bayat
beklentiydi, düzeltildi) · `test_module_profile` 56/0/1 → 60/0/0 ·
`test_superadmin` 103/0/3 (üçü veri koşullu: DB'de sistem hesabı yok, meşru) ·
`test_finance_flag_off` HTTP ayağı koşuyor.

### Bekçi ve negatif sonda

`test_script_guards §9`: `TEST_API_URL` geçen her bekçi kapıyı çağırmak zorunda
(körlük zemini ≥5 dosya), kapı yokluk ile yabancıyı AYRI alanlarda döndürmek
zorunda, strict anahtarı kaynakta bulunmak zorunda. Negatif sonda: sunucu kasten
BAŞKA veritabanına (`tekserp_yabanci_test`) bağlanır, bekçi KIRMIZI verir.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: HTTP ayaklı bekçi artık
`p2test` gibi ortamdan gelen bir kimliğe yaslanmaz; sabit port varsayımı da bekçi
sözleşmesinin dışında.

---

## 2026-09-12 — Kapının kenarları: tarama derinliği, yorum körlüğü, kendi hedefini kuran betik [ÇEKİRDEK]

### Bulgu (denetim turu 2, iki bağımsız mercek)

Hedef kapısı çalışıyordu ama KENARLARI açıktı:

- **Tarama derinliği kapsamı sessizce belirliyordu.** `test_script_guards`
  `readdirSync(scripts)` ile yalnız KÖKÜ tarıyordu; `scripts/lib/` altı hiçbir
  bölüme girmiyordu — kapının KENDİ dosyası bile denetim dışıydı.
- **§5 ham metinde arıyordu:** yorum satırına alınmış bir kapı çağrısı kontrolü
  YEŞİL bırakırdı. §1 yorumları ayıklıyordu, §5 ayıklamıyordu — aynı bekçide iki
  farklı disiplin.
- **Kendi hedefini kuran betik sınıfı hiç aranmıyordu:** `new Pool(` /
  `new PrismaClient(` / `DATABASE_URL` ataması yapan bir betik koşucunun
  kapısını da atlar (`npx tsx scripts/x.ts` doğrudan koşulunca hiçbir ayak
  çalışmaz). 07:19 vakası tam bu yoldan geldi.
- **Silme yolunun kaçış izi zayıftı:** `BEKCI_HEDEF_ONAY=1` ile geçildiğinde
  `db-guard`ın "🔓 Hedef doğrulandı" satırı ONAYLAYICI görünüyor, hedefin fixture
  OLMADIĞI çıktının hiçbir yerinde yazmıyordu.
- **Belge kendi içinde çelişiyordu:** TD-09 "üç geçit", TD-10b ve
  GELİŞTİRME-DÖNGÜSÜ "dört geçit" diyordu.

### Karar

`scripts/lib/ts-tarama.ts` (`walkTs`) TEK KAYNAK oldu; `test_script_guards` ve
`test_timestamptz_contract` aynı tarayıcıyı kullanır (ikincisi kendi kopyasını
taşıyordu). §5 artık `kodSatirlari()` ile yorumları ayıklar. Yeni **§10**: kendi
hedefini kuran betik bir kapı çağırmak zorunda — ölçüldü, beş dosya bu sınıfta,
dördü gerekçeli muaf (kapının kendisi · iki tarayıcı bekçi · havuz tüketim
testi), tavan `1` ve yalnız DÜŞER. Yeni **§11**: `--apply` alan betik hedef
veritabanını ADIYLA basar — ölçüldü, 24 betiğin 21'i basmıyor (devralınan borç),
o yüzden kural RATCHET olarak kondu: tavan 21 ve yalnız düşer, yeni borç kırmızı
verir. Yeni **§12**: özyinelemeli TS tarayıcısı yalnız TEK dosyada TANIMLI olur
(çağrı değil TANIM sayılır) — ikinci kopya yeniden doğarsa derinlik farkı yine
sessiz olurdu. `clean_test_residue` hedefini her koşumda basar ve kaçış anahtarı
verildiğinde bunu ayrıca uyarır. TD-09 dört geçide hizalandı, TD-10d eklendi.

### Yan bulgu — fixture DB kurulum reçetesinde bir boşluk

Paket ölçümünde `test_module_grandfathering` ve `test_module_flag_off §3`
kırmızı verdi ve sebebi KOD DEĞİL kurulum sırasıydı: `20260902230000`
grandfathering migration'ı `WHERE EXISTS (SELECT 1 FROM rolls)` ile koşulludur
(tanımı gereği yalnız GEÇMİŞİ OLAN kuruluma damga atar). Taze fixture DB'sinde
sıra "CREATE DATABASE → migrate deploy → seed" olduğu için migration BOŞ tabloda
koştu (ölçüldü: migration 12:28:08, ilk top 12:48:25) ve damga meşru biçimde
no-op kaldı; sonra seed topları yaratınca DB "geçmişi var ama damgasız" hâline
düştü. Reçeteye eklenecek satır: **fixture DB'sinde `seed`den SONRA modül
anahtarlarını elle damgala** (ya da bekçi "geçmiş" ölçüsünü migration ANINA göre
kursun). Kod tarafında yapılacak bir şey yok.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: bekçi kapsamı artık
dizin derinliğine bağlı değil; yeni bir alt dizin açmak denetimi daraltmaz.
## 2026-09-12 — ③ İçe aktarım geri sarma SÖZLEŞMESİ; hard delete ③b sınıfı iki alias pivotuyla genişledi [ÇEKİRDEK]

### Saha sorusu

"Yanlış dosya yükledim" bugün geri alınamıyor: `ImportRun` yalnız SAYAÇ tutuyor, hangi
kaydın yazıldığı yalnız AUDIT'te duruyor (`getRunRecords` → `system_logs`,
`newData.importRunId` + ±10 dk penceresi, dönüşte `archivedAfterMonths: 6`) ve motorun
audit satırında `oldData` YOK (`import.service.ts:585-594`). Yani iş kararına giren bilgi
6 ayda arşivlenen bir tabloda — kök kuralın tanımı.

### Ölçüm (17 adaptörün tamamı okundu)

- Yazım döngüsünde TEK TX YOK: ilk hatada kırılıyor, koşum `PARTIAL` + `stoppedAtRowNo`
  (`import.service.ts:571-607`) ⇒ geri sarma "dosya" değil YAZILAN SATIRLAR üzerinden.
- BEŞ varlıkta güncellemenin tersi bugün İMKÂNSIZ, çünkü çocuk koleksiyonu REPLACE
  ediliyor ve yok edilen küme hiçbir audit yükünde yok: `item` izin listeleri
  (`item.service.ts:470-483`) · `fabricProperty` istasyon linkleri (384-390) ·
  `subcontractor` kategorileri (`oldData` taşımıyor, 607-610) · `productRecipe`
  özellikleri (147-150) · `route` TÜM adım ağacı (`route.adapter.ts:294-298`).
- DÖRT varlıkta "CREATE" görünen satır DİRİLTME olabiliyor (kod dosyadan gelenler:
  item manuel kod · qualityGrade · subcontractorCategory · subcontractor) —
  `base.service.ts:1052-1062`, `item.service.ts:252-264`,
  `subcontractor-management.service.ts:533-542`.
- YEDİ varlıkta fiziksel silme reddedilMİYOR ama canlı belgeleri sessizce null'lar /
  cascade'ler (`customerBranch` · `qualityGrade` · `defectType` · `returnReason` ·
  `subcontractorCategory` · `route` · `productRecipe`).
- `order` dalında `promoteCustomerAliases` BAŞKA varlığın master satırlarını yazıyor
  (`order.service.ts:683-755`) ve sipariş iptalinden sonra da yaşıyor.
- Sır alanı YOK (17 adaptörün `COLUMNS` dizileri tarandı); kişisel veri VAR (vergi no,
  telefon, e-posta, adres).
- `/api/import/runs/:id/records` ucu var, panelde tüketicisi yok ⇒ o yetenek bugün
  "VAR SAYILMAZ" (motor + yüzey + izin üçlüsü).

### Kararlar

1. **`ImportRunLine` append-only defteri** (bant `20260912160000`): satır başına
   `action (CREATE|UPDATE|REVIVE)` · `changedFields {alan:{from,to}}` · REPLACE edilen
   çocukların `childSnapshot`ı · `sideEffects` · geri sarma damgası/atlama gerekçesi.
   Tam satır fotoğrafı SAKLANMAZ (dokunulmayan alanı geri yazmak aradaki meşru
   değişikliği ezer); çocuk koleksiyonu İSTİSNADIR çünkü yok edilen küme başka hiçbir
   yerde yok. Fotoğraf "yeniden kurmaya yetecek kadar"dır; ölçüm: en büyüğü `route`
   adım ağacı (`RouteStep` 17 alan, fabrikada rota başına en çok 4 adım) ⇒ ~1 KB.
2. **`REVIVE` üçüncü eylemdir** ve tersi PASİFE ATMA DEĞİL, "önceki alan değerleri +
   import'tan önceki aktif/pasif durum"dur. Karıştırmak, import'tan önce de var olan
   kaydı pasife atmak demektir.
3. **Hard delete ③b (yapılandırma pivotu) sınıfı `CustomerItemAlias` ve
   `CustomerColorAlias` ile genişledi.** Gerekçe üç ayaklı: (i) fiziksel silme YALNIZ o
   koşumun YARATTIĞI satırda olur — önceden var olan satır yalnız güncellenmiştir ve
   tersi eski değeri geri yazmaktır (`customerColorAlias.alias` NULLABLE olduğu için
   `null`a da dönülür; `customerItemAlias.alias` NOT NULL ve eski değer her zaman metin);
   (ii) geçmiş belge BOZULMAZ çünkü müşteri belgesindeki ad DONMUŞTUR (`belge-etiket.md`),
   alias yalnız bundan sonraki belgelerin adını seçer; (iii) satırın parasal/ticari/kalite
   sonucu yok ve değişikliğin KENDİSİ `ImportRunLine`da defterli kalıyor.
   ⚠️ Ölçüm: import yalnız `alias` yazıyor, `assigned` varsayılan `false` kalıyor ⇒
   koşumun yarattığı renk alias'ı HER ZAMAN `assigned:false`; müşteriye özel renk
   (`assigned:true`) satırı import tarafından yaratılmış olamaz, geri sarma onu silmez.
4. "Yalnız o alan hâlâ aynıysa" ATOMİK CLAIM ile yazılır (`findUnique→if→update` yasak);
   `count===0` hata değil DALDIR, satır gerekçesiyle ATLANDI listesine girer ve gerekçe
   `revertSkipReason`a yazılır.
5. Önizleme ucu yıkıcı-işlem kuralına uyar: her satır tek tek, atlama gerekçeleri AYRI
   AYRI, `sideEffects` ayrı bölüm ("bunlar kalacak"), seçim boşsa 400.

### Üç kapı

Migration **`20260912160000`** (ilk tahsis `130200` idi; ölçümle değişti — dizinde
`20260912150300` vardı, sıra-dışı ad aynı şemayı iki farklı sırayla kurardı). İzin YOK
(`data:import` + varlığın write izni). APK YOK, panel sürümü gerekir.
Aynı dilimde KAPI BOŞLUĞU kapanacak: `test_migration_hygiene.ts` ad sırası ölçmüyor →
"yeni migration adı uygulanmış en büyük addan BÜYÜK olmalı" kontrolü + negatif sonda.

---

## 2026-09-12 — BÖLÜNMÜŞ YAZMA: `apply-migration` SQL'i bir DB'ye, defter işaretini başkasına gönderiyordu [ÇEKİRDEK]

### Olay

Şema dilimi yazılırken `scripts/apply-migration.ts` DDL'i (bir kısmi index + iki
CHECK) **fabrikanın canlı yedeğine** (`tekserp_fabrika_dev`) uyguladı; oysa hedef
bir test veritabanıydı. Veri etkilenmedi — yalnız DDL.

### Kök sebep

İki yol iki farklı kaynaktan hedef çözüyordu:
- SQL yolu (`resolveDbUrl`) **yalnız `.env` DOSYASINI** okuyordu, `process.env`e
  hiç bakmıyordu.
- `resolve` adımı `npx prisma migrate resolve` ile koştuğu için Prisma'nın kendi
  çözümlemesini kullanıyor, yani **`process.env.DATABASE_URL`i onurlandırıyordu.**

Sonuç: `DATABASE_URL=<test> npx tsx scripts/apply-migration.ts <ad> --apply`
komutunda SQL `.env`in gösterdiği veritabanına, defter satırı ortamın gösterdiği
veritabanına gidiyordu. Betiğin kendi başlığı onu canlı fabrika deploy'unda
kullanılabilir ilan ettiği için bu bir SAHA riskiydi.

### Karar — üç ayak

1. **Hedef önceliği:** `process.env.DATABASE_URL` varsa O kullanılır; `.env`
   yalnız YEDEKtir ve hangisinin kullanıldığı çıktıda YAZAR.
2. **Hedef beyanı:** uygulamadan (dry-run dâhil) önce `🎯 Hedef veritabanı: <ad>
   @ <host> (kaynak: …)` basılır — `--apply` alan her betiğin hedefini adıyla
   basma sözleşmesinin (`test_script_guards §11`) parçası; bu betik o ratchet'in
   içindeydi, artık beyan ediyor ve tavan 21 → 20 indi.
3. **Tek hedef kilidi:** bağlanılan veritabanı `SELECT current_database()` ile
   doğrulanır (URL'yi okumak yetmez — Docker dalı host/port'u yeniden yazar) ve
   `resolve` adımına hedef URL **açıkça** geçirilir. Bölünmüş yazma böylece
   yapısal olarak imkânsız olur, disipline bırakılmaz.

### Negatif sonda

`DATABASE_URL=<test> … apply-migration <ad>` → hedef TEST veritabanı yazar ve
`.env`in gösterdiği veritabanına GİTMEZ; `DATABASE_URL` verilmeden aynı komut
`.env` kaynağını adıyla beyan eder.

**Güncelleme (aynı gün, sonda koşuldu):** ilk yazımda "`current_database()`
uyuşmazlık dalı ölçülmedi" deniyordu — SENTETİK SONDAYLA ölçüldü. Karşılaştırma
bilerek bozuldu (`hedefAd + "_SONDA"`), betik `HEDEF ÇELİŞKİSİ` basıp **çıkış
kodu 1** ile durdu ve SQL'e HİÇ geçmedi; dosya `git checkout` ile geri yüklendi,
sha256 baz değerle birebir. Kural olarak: **kırmızı verdiği görülmemiş kapı,
ölçtüğünü iddia eden yeşildir.**

"Hedef bir kez çözülür, iki adım da onu kullanır" cümlesi de İDDİA olmaktan
çıkarıldı: `test_script_guards §13` `resolveDbUrl`ün tek çağrı noktasını, resolve
adımının hedefi açıkça aldığını ve `current_database()` doğrulamasının varlığını
ölçer.

### Ratchet gözlemi

`--apply` beyan tavanı (§11) konduktan sonra taban 24 → 26 betiğe çıkarken
beyansız sayı 21 → 18'e indi: ratchet yalnız borcu DONDURMUYOR, davranışı da
ÇEKİYOR. Tavan, borç düştükçe kapanışta yeni gerçek sayıya indirilir.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**. Sözleşme: bu betiğin çıktısı artık
hedefi her koşumda adıyla söyler; sessiz hedef yok.

## 2026-09-12 — Ters kayıt KAPSAM ister; eşik "sessizce geç"e değil "yaz ya da gürültülü dur"a bağlanır [ÇEKİRDEK]

Stok defterinin ters kayıt yolu ve metraj eşiği aynı gün iki KRİTİK verdi. İkisinin
kökü aynı: **bir kapı iki farklı semantiği taşıyordu** ve hangisinin istendiği çağrı
yerinde beyan edilmiyordu.

### Ölçüm — kapsamsız ters kayıt hayalet stok üretiyordu

`reopenStep`, `reverseRollStockMoves` ile topun TERSLENMEMİŞ **tüm** ileri satırlarını
tersliyordu. Senaryo (fikstürle üretildi): 100 m depo topu iş emrine bağlanır
(A: −100, `PRODUCTION_ISSUE`), son adım kapanır (B: +100, `PRODUCTION_RECEIPT`, net 0),
adım yeniden açılır → **A ve B'nin İKİSİ de terslenir**, net 0 kalır ama top ÜRETİMDE:
depoda **100 m hayalet stok**. İkinci finish'te sapma **+100**'e çıkıyor — yani her tur
büyüyor. Üstelik A satırı `warehouse_movements_reversesMovementId_key` yüzünden kalıcı
"terslenmiş" damgası yediği için sapma **ileri yolla bir daha kapanmıyor**; telafi ancak
elle düzeltme kaydıyla olur.

**Bekçi bunu GÖREMİYORDU** ve sebebi bir ders: fikstür topu doğrudan üretimde
doğuruyordu, yani defterde attach ÇIKIŞI hiç yoktu. Kırmızı/yeşil üçlüsü:

| Bekçi | Sonuç |
|---|---|
| eski fikstür (top üretimde doğuyor) | **7/0 — kör** |
| fikstür gerçek `attachRolls` yolundan geçti, düzeltme ÖNCESİ | **3/6** |
| aynı bekçi, düzeltme SONRASI | **13/0** |

> **Ders:** bekçinin yeşil olması, doğru yeri ölçtüğünün kanıtı DEĞİLDİR. Fikstür
> gerçek yazma yolundan geçmiyorsa bekçi kendi kurduğu dünyayı doğrular.

**Somut kaçış yolu (soyut kural değil, bu dosyada olan şey):** fikstür topu
`prisma.roll.create` ile doğrudan `IN_PRODUCTION` + `currentStepId` yaratıyor ve
`attachRolls`ı **hiç çağırmıyordu**. Dolayısıyla defterde üretime-alma ÇIKIŞ satırı hiç
doğmadı; kapsamsız ters kayıt terslemek için o satırı bulamadı ve bekçi "yalnız kendi
girişini tersledi" sanısıyla yeşil kaldı. Ölçülmeyen şey **ters kaydın kapsamı**ydı:
bekçi "ters satır yazıldı mı" sorusunu ölçüyordu, "BAŞKA bir satıra dokundu mu"
sorusunu ölçmüyordu. İkinci soru ancak defterde en az iki ileri satır varken anlam
kazanır — yani fikstür gerçek yolu kullanmak zorundadır.

### Ölçüm — eşik hizalaması gürültülü hatayı sessiz veri kaybına çevirmişti

`edea91d6`'da eski iki kapının eşiği `qty >= 0`dan `qty > 0`a çekildi (niyet: DB seddi
`CHECK (qty > 0)` ile hizalanmak). Sonuç istenenin tersi oldu: 0 metrajlı satır artık
insert'e gitmiyor, **sessizce eleniyor** ve çağıranın tx'i COMMIT oluyor. Transfer
yolunda bu yalnız eksik satır değil — transfer İPTALİ defterden okuduğu için 0 m'lik
top hedef depoda **mahsur** kalırdı.

Kendi gerekçem ölçümle çürüdü: susturmayı meşrulaştıran "kurşun açık kumaş 0 m ile
depoya iniyor" dalı fabrika kopyasında **BOŞ** — stok kümesinde (`warehouseId` dolu +
STOCK/WAREHOUSE/A1_STOCK/RETURNED) 0 metrajlı top **0 kayıt**, defterde `qty <= 0`
satır **0**. 0 metrajlılar: TAMBUR_CONSUMED 250 · CANCELLED 52 · WAREHOUSE 2 (ikisinin
deposu NULL).

> **Ders:** ölçülmemiş gerekçeyle sözleşme yazılmaz; ölçüm gerekçeyi çürütürse
> sözleşme değişir.

### Karar

1. **İki semantik, iki fonksiyon; kapsam TİP DÜZEYİNDE zorunlu.**
   `reverseAllRollStockMoves` = "topun TÜM izini tersle" ve yalnız top tümden
   öldürülüyorsa (CANCELLED + `currentQty: 0`) kullanılır — tambur geri alma.
   `reverseLatestScopedStockMove(tx, rollIds, scope, args)` = "şu işlemi geri al";
   `scope` (`reasonCode` + `workOrderStepId`) ZORUNLUDUR, kapsam vermeyi unutmak
   derleme hatasıdır.
2. **Kapsam İKİ ADIMLI SORGUDUR, tek WHERE değil:** ① `reasonCode` + damgalı adım,
   ② bulunamazsa `reasonCode` + `workOrderStepId IS NULL` (geçiş dalı). `OR
   workOrderStepId IS NULL` tek yüklemde YASAK: o yüklem BAŞKA bir iş emrinin damgalı
   girişini de aday kümesine sokar ve "geçmişe dönük değiştirme" yasağını çiğner.
3. **`finalizeRollsAtLastStep` adım damgası yazar** (opsiyonel `workOrderStepId`);
   kurşun finish ve bypass geçer, kurtarma yolu bir adıma ait olmadığı için geçmez
   (`machineId=null` kuralının aynı mantığı).
4. **Eşik politikası çağrı yerinde BEYAN edilir:** `writeWarehouseMovement(s)` üçüncü
   parametre olarak `{ onZeroQty: "skip" | "throw" }` alır ve **varsayılanı yoktur**.
   `throw` = tutarsızlık sinyali (top girişi · transfer ileri+ters · fason dönüşü ·
   iade · sevk ileri+storno). `skip` = meşru atlama (0 metrajlı topun iptali; fabrikada
   52 böyle top).
5. **UÇSUZLUK POLİTİKAYA TABİ DEĞİL.** Defter öncesi doğan **4.553** topun
   `warehouseId`si NULL; "uçsuz satır da tutarsızlıktır" denmesi o topların sevkini ve
   iadesini kilitlerdi. Politika yalnız METRAJ içindir.
6. **Atlanan ve terslenemeyen SAYILIR ve GÖRÜNÜR.** Tekil kapı `boolean` döner ve
   `softDelete`in audit yüküne `ledgerRowWritten` olarak yazılır; reopen'ın
   `bulunamayan`/`statusuzAtlanan` sayıları ZATEN yazdığı `WORK_ORDER_STEP` kaydına alan
   olarak girer — yeni audit kaydı açılmaz (kalıcı yüzey geçici metriği kalıcılaştırır).
7. **`preEpoch` (ZAMANSAL) ≠ `statusuzAtlanan` (SEMANTİK).** İlki "satır fotoğraftan
   önce mi yazıldı", tek yazarı açılış fotoğrafı script'i; ikincisi "satırın iki ucu da
   statüsüz mü", `fromStatus IS NULL AND toStatus IS NULL`tan türer. Bugün örtüşüyorlar
   (721/721), yarın ayrışacaklar. Fotoğraf şerhi D6'ya yazıldı: epoch sonrası yalnız
   TOPLAM Σ güvenilir; depo×statü kırılımı ve as-of kesiti eski yazıcılar taşınana kadar
   BEYANLIDIR.
8. **GEREKÇELİ KAPATMA — ters satırın `eventType`i ileri satırdan kopyalanır.** Panelde
   "Üretim" satırı gibi görünmesi bulgu olarak açıldı; düzeltme YAZILMADI. Uygun bir enum
   değeri yok, PostgreSQL enum değeri **geri alınamaz** bir şema kararıdır ve D2a
   "tespit `reversesMovementId`den, enum yalnız betimleyici" diyor. Panel tarafı rozeti
   bağdan (`isReversal`) boyadığı için görünen semptom kapandı. Bugün kullanılmayan bir
   `eventType` override'ı da EKLENMEDİ: ölü yüzey, sonraki okuyucuya "demek ki bazen
   gerekiyor" der.

### Kod çapaları

`src/services/helpers/warehouse-ledger.helper.ts` (`ZeroQtyPolicy`, `hasWarehouseEnd`,
`reverseAllRollStockMoves`, `reverseLatestScopedStockMove`) ·
`src/services/kursun-qc.service.ts` (`finishStep` damgası, `reopenStep` kapsamlı çağrı,
audit `defter` alanı) · `src/services/kursun-bypass.service.ts` ·
`src/services/helpers/roll-finalize.helper.ts` · `src/services/inventory.service.ts`
(`ledgerRowWritten`) · transfer · subcontractor · return · shipping çağrı yerleri.

### Bekçi ve negatif sonda

`test_stock_ledger_kursun_reopen` (13): fikstür gerçek attach yolundan geçer · §2b ters
satır `workOrderStepId` damgasını taşır (canlı FK) · §3 net −METRAJ · §4 attach ÇIKIŞI
terslenmemiş kalır · §8 damgasız eski satır (geçiş dalı) · §9 ESKİ iş emrinin girişine
dokunulmaz · §10 fire dalında ters satır yazılmaz.
`test_stock_ledger_helper` (19): §4e eşik tripwire'ı İKİ AYAKLI (elle kopya yok **ve**
tek kaynağın kendisi canlı — vakumen geçme kapalı), kapsamı tek dosya ve çıktıda basılır ·
§10a/§10b/§10c politikanın üç dalı.
Negatif sondalar (altısı da kırmızı, geri yükleme sha256 birebir): kapsamsız çağrı →
6 kontrol · kapsam yanlış adıma → çöküş · toplu kapının `throw` dalı kaldırıldı → 2 ·
`finalize` damgası kaldırıldı → 1 · elle ikinci eşik → §4e · tek kaynak öldürüldü → §4e.

**Tambur tarafında iki eski borç aynı fikstürle kapandı.** `applySingleRestore` dalı
ayrı ölçülmüyordu (eski sonda iki `applySingle*` çağrısını BİRLİKTE kaldırıyordu, yani
hangi dalın ölçüldüğü belirsizdi) ve "her tur hayalet metre ekler" iddiası tambur
tarafında hiç ölçülmemişti. Senaryo C `{ mode: "SINGLE_RESTORE" }` ile dalı açıkça
sürüyor; SINGLE_RESTORE metrajı kaynağa geri koyup iş emrini dirilttiği için **ikinci
tur bu dalda mümkün**. Negatif sonda YALNIZ o dalın ters çağrısını kaldırdı
(`applySingle`a dokunmadan) ve iddia sayıya döndü: **§8 netler=[200,200] · §9 satır=2
`net=400` · §7 n=8 · §10 öksüz=2**. Yani iki tur, iki hayalet × 200 m — "anı" değil
ölçüm. Ayrıca körlük zemini senaryo sayısına bağlı sabitten (`n === 6`) yapısal
değişmeze çevrildi: **iptal edilmiş HER çocuğun ileri satırı terslenmiş olmak zorunda**
(öksüz satır yok) + `n >= 10`. Senaryo eklendikçe kırılan zemin, zemin olmaktan çıkar.

### Yeni hata sınıfı — mekanik rename YORUM metnine sızar

`src/` içindeki Türkçe değişken adları İngilizceye çevrilirken kelime-sınırı (`\b`)
temelli rename **iki Türkçe yorum cümlesini de bozdu** ("malı hedef depoda" → "malı
targetRow depoda"). İkisi de yakalandı, ama sınıf ilk kez kayda geçiyor.
**Önlem:** rename'den sonra YENİ adları yorum satırlarında ara
(`grep -nE "^\s*(//|\*).*\b<yeniAd>\b"`), yoksa kod doğru derlenirken belge yalan söyler.

### Yöntem notu — rebase kapıyı atlar

Bu dilim iki kez bayat tabanda kaldı (main altında ilerledi). Çözüm `git rebase`
DEĞİLDİ: **rebase hook'ları atlar**, yani kapı yeni taban üzerinde hiç koşmaz ve
"kapı temiz" cümlesi eski tabanın cümlesi olur. Yapılan: worktree yeni tabanda
sıfırdan kurulur, dosyalar kopyalanır ve **dosyalardan yeniden commit'lenir** —
kapı her commit'te gerçekten koşar ve "ölçüm hangi taban üzerinde yapıldı" sorusu
kendiliğinden cevaplanır.

### Bilinen açık — aynı sınıfın AYNA GÖRÜNTÜSÜ (sıradaki işin 1. maddesi)

Aynı gün ölçüldü (fikstür DB'si, gerçek servis çağrıları): **topun iptalini geri almak
depo defterini eksik bırakıyor.**

```
1) Top depoda (75 m, WAREHOUSE)
2) softDelete → TEK satır: CANCEL, qty 75, from=depo,
                fromStatus=NULL · toStatus=NULL · reasonCode=NULL   ← STATÜSÜZ (eski kapı)
3) restoreCancelledRoll → YENİ SATIR YOK;  top WAREHOUSE'a döner
```

Defter "75 m çıktı" der, geri döndüğünü söyleyen satır yoktur ⇒ stok **EKSİK** görünür.
Bu, yukarıdaki reopen kusurunun **ayna görüntüsüdür**: orada defter fazla (hayalet
stok), burada eksik. İkisi de tek sınıf — *ileri yol yazıp geri yol yazmayan defter*.

Düzeltmenin iki ayağı **AYRILAMAZ**: CANCEL satırı statüsüz olduğu için ters kayıt
yazacak uç yok, yani `restoreCancelledRoll`a ters kayıt yazdırmak ancak iptal çıkışı
`postStockMove`a taşındıktan sonra mümkün. Bekçi yazıldı ve kırmızı ölçüldü:
**3 geçti / 5 başarısız** (§1 statü=null sebep=null · §3 bağ yok · §4 net −75 · §7 n=1).

### "Önce kırmızıyı gör" kuralının PARALEL OTURUM kısıtı

Henüz var olmayan sabitlere/imzalara bakan bir `scripts/test_*.ts` **ortak ağaca
girmez**: tip denetimi `scripts/**`i de tarıyor ve commit kapısı HERKES için kırmızıya
döner. Kural şöyle okunur: kırmızıyı **kendi ağacında** görmek yeterlidir; bekçi repoya
**kodla AYNI commit'te** girer. Bugün bu yüzden bekçi scratchpad'de yazıldı ve orada
koşuldu.

### Üç kapı

Migration **yok** · izin **yok** · APK **yok**.
