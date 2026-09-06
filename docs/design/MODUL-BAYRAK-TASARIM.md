# Modül & Bayrak Stratejisi — Tek Koddan Çok Fabrikaya

> **Tarih:** 2026-09-02 · **Durum:** ✅ P1–P8 UYGULANDI (2026-09-02/04) — `constants/module-flags.ts`, `module.middleware.ts`, `constants/module-profiles.ts`, `User.isSystemAccount`, `npm run superadmin:kur`, ayar şifresi.
> ⚠️ **Adlandırma:** tasarımdaki `modul.*` KAVRAMSAL addır ve koda GİRMEZ; DB anahtarları `finance.enabled` kalıbındadır (`ticaret.enabled`, `iplik.enabled`, `depo.multiEnabled`, `kumasTeknik.enabled`, `tezgah.enabled`). Profiller `deploy/profiller/*.json` değil TS sabitidir. `adnansahin` dalı emekli edildi. Canlı kural özeti: `docs/kurallar/modul-bayrak.md`.
> **Karar sahibi:** kullanıcı (bu belgedeki her karar soru-cevapla tek tek onaylandı)
> **Kaynak analiz:** 7 ajanlık tarama — 77 mevcut ayar anahtarı, tüm route/ekran
> envanteri, 8 sıkı/gevşek bağ, 5 sektör segmenti, ERP standartları.

## 0. Vizyon — tek cümle

**Bir gövde, bir şema, bir sürüm çizgisi; müşteri farkı yalnız bayrak profilinde.**
Müşteri dalı/forku YASAK (`adnansahin` dalı emekli edilecek); "adnansahin'de yok"
demek "bayrağı kapalı" demek. Sektör karşılığı: SAP "clean core" + customizing,
Odoo modül aç/kapa. Fork'un bilinen sonu: her düzeltme N dala, sürüm numarası
kod kimliği olmaktan çıkar, üçüncü müşteride işin yarısı merge.

**Kutsal kısıt:** Adnan Şahin'de hiçbir davranış değişmez. Her yeni anahtar
migration'la mevcut DB'ye "dünkü davranış" değeriyle damgalanır; yeni müşteri
varsayılanını kurulum profili (seed) yazar. Bilinçli istisnalar karar #4'te (§4):
mal kabul ve depo transferi uçları — ikisi de fabrikada erişilmeyen yüzey.

**Kabul testi:** fabrikanın gerçek dump'ı (`tekserp_20260902_201133.dump` emsali)
locale geri yüklenir → `migrate deploy` → bekçiler + `test_consistency` → basit
profille boot → LAN davranış regresyonu. Sürpriz fabrikada değil burada çıkar.

---

## 1. Kavramlar

| Kavram | Ne | Emsal |
|---|---|---|
| **Modül anahtarı** (`modul.*`) | Koca bir işlev ağacını açar/kapar; **cache'siz okunur** (rejim anahtarı sınıfı) | `finance.enabled` + `requireFinanceEnabled` |
| **Alt bayrak** | Modülün İÇİNDE yaşayan davranış/görünüm anahtarı; modül kapalıyken **okunmaz bile** | `finance.blockNegativeCashEnabled` |
| **Ayar** | Sayı/metin/JSON (eşik, tolerans, config) — bayrak değil | `fason.shrinkTolerancePct` |
| **Profil** | Kurulumda `SystemSetting`e basılan başlangıç seti; runtime kilidi DEĞİL | — |

Depo: mevcut `SystemSetting` tablosu (key-value, tek tablo). Yeni mekanizma YOK.
Her anahtar mevcut dört kapıdan geçer: SETTING_KEYS + sanitize + controller Zod +
Electron aynası; `test_feature_flag_contract` genişler.

---

## 2. Modül ağacı — 10 anahtar + 5 kapatılamaz çekirdek blok

### Çekirdek bloklar (anahtar YOK)

Ana Veri (katalog/mükerrer/birleştirme) · Stok & Giriş (Roll defteri + **giriş
MOTORU** — bkz. KK1 kararı §5.2) · Sipariş & Müşteri · Sevkiyat & Depo (muhasebe
köprüsü DAHİL — §6) · Sistem & Kimlik & Belge. Beş segmentin beşi de kullanıyor;
kapatılabilir yapmak mikro bölme.

### Anahtarlı modüller

| Anahtar | Kapsam | Bağımlılık | Adnan Şahin |
|---|---|---|---|
| `modul.uretim` | WO/rota/istasyon/kurşun/tambur/parti/refakat + **KK1 istasyon ekranı** | — | AÇIK |
| `modul.fason` | Fason sevk/kabul/kısmi/çekme (hizmet ALAN yön) | uretim | AÇIK |
| `modul.kartela` | Swatch akışı (WO'suz; fason firma TANIMI çekirdekte kalır) | — | AÇIK |
| `modul.finans` | Cari/fatura/tahsilat/kasa-banka/çek/dönem (= mevcut `finance.enabled`) | — | KAPALI |
| `modul.ticaret` | Alış siparişi, mal kabul, fiyat listeleri, stok sayımı — **finanstan AYRILIR** (bugün yanlış evde: finanssız satın alma meşru) | — | KAPALI |
| `modul.iplik` | YarnStock/YarnMovement kg defteri | ticaret | KAPALI |
| `modul.coklu-depo` | Depo seçici/transfer/kolonlar (şema hazır; `ctx.multiWarehouse` veri-türevi yerine anahtar) | — | KAPALI |
| `modul.kumas-teknik` | Item teknik kartı: en/gramaj/kompozisyon/atkı/çözgü | — | KAPALI |
| `modul.tezgah-izleme` | Dokuma tezgah monitörizasyonu (§8) | uretim | KAPALI |
| `modul.patron` | Boss overview (anahtarı operasyonel: tünel+4001 — app-içi bayrak bilinçli yok) | — | AÇIK |

Mevcut ~30 davranış bayrağı bu ağacın alt bayrakları olarak yerleşir (tam eşleme
sentez çıktısında; ör. `tambur.*`/`batch.*`/`production.kursunBypassEnabled` →
uretim altı, `fason.shrink*` → fason altı, `finance.*` → finans altı).
**Köprü bayrağı deseni:** `finance.yarnOutOnInvoiceEnabled` yalnız
`modul.finans && modul.iplik` açıkken okunur; köprü kodu kancada yaşar
(`maybeAutoDraftInvoiceAfterDispatch` no-op emsali).

---

## 3. Hiyerarşi semantiği — tek kural seti

1. `modul.*` **cache'siz** okunur; PATCH guard'ı anahtar-kapsamlı, `modul.*`
   yalnız süperadmin yazar (§7).
2. Modül kapalıyken: LAN'da **403 + `MODULE_DISABLED`** (finans emsali), internete
   açık yüzeyde (tünel) **404** (boss emsali — 403 keşfe davet).
3. UI: karo/menü **hiç çizilmez** (`tile-config.visibleWhen` ctx — mevcut mekanizma).
4. **İzinler dokunulmaz:** modül kapanınca atamalar silinmez, açılınca geri gelir.
   Bayrak ve izin ayrı eksen; sonuç fail-closed (ikisi de açık olmadan yüzey yok).
5. **Alt bayraklar uyur, sıfırlanmaz** — modül kapalıyken ayar ekranı salt-okunur
   + "modül kapalı" bandı.
6. **Tek resolver:** etkin değer = `modülAçık && altBayrak` TEK fonksiyonda
   (`resolveShortCutConfig` emsali); alt bayrağı doğrudan okuyan ikinci nokta yasak.
7. **Kanca deseni:** opsiyonel modül çekirdeğe kanca atar, çekirdek onu çağırmaz.
   Test sorusu: "bu modül silinse çekirdek derlenir mi?"
8. Modülün raporları modülle kapanır; çekirdek rapora giren türetilmiş rakamın
   TANIMI bayraktan etkilenmez (defter semantiği bayrak-üstü).
9. İstemcinin tanıması gereken hata kodu üreten bayrak, APK/panel güncellenmeden
   AÇILMAZ (`kk1.duplicateGuardEnabled` emsali).
10. **Grandfathering:** yeni anahtar migration'la eski DB'ye dünkü davranışı yazar;
    çatışan varsayılanın çözümü koddaki default değil kurulum profilidir.

**Tamlık bekçisi (yeni):** `screen-catalog`'daki HER ekran bir modüle ya da
çekirdek bloğa eşlenmek ZORUNDA; eşlenmemiş ekran CI'ı kırar. "Tüm bayrakları
düşündük mü" sorusunun cevabı hafıza değil mekanik kapıdır — yeni eklenen her
ekran soruyu otomatik sorar.

---

## 4. Karar defteri (kullanıcı onaylı)

| # | Konu | Karar |
|---|---|---|
| 1 | Sevk–sipariş bağı | **Enum** `shipping.orderRequirement = off\|warn\|block`, varsayılan `warn` (bugünkü davranış — kod zaten uyarı basıyor) |
| 2 | KK1 | **Motor çekirdek** (Roll doğuran servis + guard'lar tek kaynak, kapatılamaz); **iki sunum**: KK1 istasyon ekranı üretim modülünde, toptancıya aynı motorun üstüne ayrı sade "Mal Girişi" ekranı (ilk toptancı müşteride yazılır) |
| 3 | Atkı/çözgü/gramaj | **Item'a nullable kolonlar** (`modul.kumas-teknik`). Tekstile özel ERP pratiği (Datatex tarzı); FabricProperty'ye NUMERIC eklenmez (katalog ayrık sınıflar için). SAP tarzı esnek sayısal katalog ileride üstüne eklenebilir, çelişmez |
| 4 | Mal kabul + depo transferi uçları | Mal kabul `modul.ticaret`, depo transferi `modul.coklu-depo` kapısına girer — planın İKİ bilinçli statü değişikliği (2026-09-02 P1 ölçümü: fabrika dump'ında 0 mal kabul, 0 depo, 0 transfer; transfer karosu tek depoda zaten gizli). Bugün ikisi de bilinçli kapısız; `warehouse.service` defteri KAPISIZ KALIR (fabrika yolları da yazar) |
| 5 | Yönetim yetkisi | `modul.*` yalnız süperadmin; davranış bayrakları fabrika admininde (bugünkü `admin:settings`) + **ayar şifresi** (§7.2) |
| 6 | Rezervasyon | **Şimdi altyapı kurulacak** (maliyet uyarısı yapıldı, kullanıcı kararı). Kendi append-only defteri + çift-yüklem kuralı + DB CHECK; `SackAllocation`a DOKUNULMAZ (o sevk muhasebesidir) |
| 7 | Süperadmin uzak erişim | Tünelden girebilir, **TOTP zorunlu**, muafiyet yok |
| 8 | Süperadmin audit izi | Her işlem audit'e **TAM** yazılır; fabrika yüzeylerinde aktör **"Sistem Bakımı"** takma adı, gerçek kimlik yalnız süperadmin ekranında |
| 9 | Süperadmin tablet girişi | Kendi **6 haneli PIN'i** — isim listesiz, sadece PIN'le. (PIN girişi zaten LAN-only + PIN kilidi var → kabul edilebilir) |
| 10 | Faturalama rejimi | `shipping.invoiceMode = dis\|ic\|ikisi`, varsayılan **`dis`** (§6) |
| 11 | Kalite = istasyon YETENEĞİ | **İlk dilime dahil** (kullanıcı kararı; riski söylendi). §5.1 |
| 12 | Hedef segment rotası | ① İşlemeci/apreci (+perde üreticisi) ② Dokuma/örme ③ Boyahane(hizmet veren). **Rafta:** toptancı, ev tekstili (SKU/koli/GS1, konfeksiyon katmanı yazılmaz) |

---

## 5. Üretim esnekliği

### 5.1 Kalite: istasyon TÜRÜnden istasyon YETENEĞİne

Sektör gerçeği: kimi fabrika KK'yı kurşunla birlikte yapar (adnansahin —
`PROCESS_QC` çifti), kimi ayrı istasyonda, kimi başka istasyonla birlikte.
Bugünkü tek katılık: kalite `StationKind`'a gömülü. Çözüm: `station
.appliesQuality` yeteneği — üç topoloji de rota kurulumu olur, kod değişmez.
Renk (`appliesColor`, 2026-08-02) ve özellik (`StationProperty`) aynı dönüşümü
yaşadı ve iyi sonuç verdi; kalite üçüncüsü.

⚠️ Etki listesi çıkarılacak: `RollError` yaşam döngüsü ("PROCESS_QC'de açılır"
varsayımı), kurşun bypass bayrağı, tabletin istasyon-türünden ekran seçimi.
Adnansahin regresyonu: dump provası + LAN turu ŞART (canlı üretim çekirdeği).

### 5.2 Dokuma hazırlık: devere/çözgü/haşıl = KATALOG işi

Devere (levend/çile/bobin aktarma), çözgü vb. **yeni mimari istemez**: istasyon
kataloğuna istasyon + rotaya adım. "Kumaş hazır gelir" adnansahin'in rotasıydı,
sistemin değil. Dokuma diliminin tek tasarım işi: rotanın başında top
**TEZGAHTAN doğar** — doğum damgası tezgah + çözgü levendi + iplik lotu.

---

## 6. Muhasebe köprüsü — dış muhasebeyle çakışmama

Bugün fabrikada açık olan üçlü ("Sevkiyatlar (Muhasebe)" ekranı + `invoiceNo`
fatura izi + Excel/PDF dışa aktarım) finans modülünün PARÇASI DEĞİL — çekirdek
sevkiyatın **dış muhasebe köprüsü**. Muhasebecisi ayrı program kullanan her
müşteride (adnansahin dahil) aynen kalır; finans açılınca aynı ekran terfi eder
(iç fatura taslağı düğmesi zaten `financeEnabled` koşuluyla yazılı).

Çakışan tek nokta: aynı sevke hem elle iz (`invoiceNo`) hem iç fatura (`Invoice`)
yazılabilmesi → **`shipping.invoiceMode`**: `dis` (varsayılan — bugünkü),
`ic` (elle iz kapanır; dış/resmi numara `Invoice.externalNo`'ya), `ikisi`
(geçiş dönemi — iç faturalı sevke elle iz amber uyarı, engel yok).
Şema hazır: `Invoice.shipmentId` FK + `invoices_one_active_per_shipment`.

---

## 7. Süperadmin (satıcı hesabı)

DB'de **gizli GERÇEK satır** (docs/history/denetim-2026-08/FK gerçek kullanıcı ister; sanal kullanıcı
olmaz). Tüm listelerden süzülür: kullanıcı yönetimi, PIN listesi,
`mobile-users`, oturum listeleri. Tam yetki (izin denetiminden muaf değil —
tüm izinler atanmış). Şifresi/PIN'i fabrikaya asla verilmez.

- **Giriş:** panelde parola (+uzakta TOTP); tablette kendi 6 haneli PIN'i.
- **Audit:** karar #8 — tam iz, fabrika yüzeyinde "Sistem Bakımı".
- **Yetkisi:** `modul.*` yazımı YALNIZ süperadmin.
- **TOTP kurtarma kodu BİLİNÇLİ YOK (2026-09-03):** süperadminde
  `remainingRecoveryCodes: 0`. Cihaz kaybı zaten iki yollu (LAN'dan parola/PIN +
  sunucuda `npm run superadmin:kur -- --rotate` ile TOTP'yi yeniden üretme);
  kurtarma kodu bir sır yüzeyi daha demek (üretilir, saklanır, yedeğe sızar).
  Az yüzey > konfor. Giriş kilidi süperadmini de KAPSAR (muafiyet = parolaya
  sınırsız deneme); kilitlenince LAN yolu açık.
  ⚠️ **2026-09-03 (P8) — `.env` TOHUMLAMA YOLU KALDIRILDI.** Hesap artık env'den
  doğmaz; `SUPERADMIN_USERNAME/PASSWORD_HASH/PIN/TOTP_SECRET/FORCE_SYNC`
  satırlarını hiçbir kod okumaz (boot job'ı yalnız kalanları UYARIR — anahtar
  adı basar, değer asla). Tek doğuş/rotasyon yolu sunucuda elle koşulan
  `npm run superadmin:kur` (`--rotate`), ve script **gerçek TTY ister**
  (`ssh -t` / `docker exec -it`; kapı olmadan boruda sessizce donuyordu).

### 7.2 Ayar şifresi (kullanıcı isteği)

Davranış bayrağı ekranı her değişiklikte **ikinci bir şifre** sorar — açık
kalmış bir admin oturumundan bayrak değiştirilmesin diye. Süperadmin üretir/
dağıtır/değiştirir/iptal eder. Hash'li saklanır, deneme sınırlı, her kullanım
audit'e düşer.

### 7.3 Sistem Profili ekranı (kullanıcı isteği: "ayarlardan ayrı, profesyonel")

Süperadmine özel ekran: modül kartları (aç/kapa + bağımlılık gösterimi +
"kapatırsan şunlar gizlenir" önizlemesi) · alt bayraklar kart içinde gruplu ·
profil uygula + fark (diff) göster · değişiklik geçmişi (audit'ten). Fabrika
admini yalnız davranış bayraklarının sade ekranını görür (ayar şifreli).

---

## 8. `modul.tezgah-izleme` — dokuma monitörizasyonu

Üç kademeli veri toplama; **her kademe tek başına çalışır** (bağlantısız tezgah
modülü kilitlemez):

1. **Makine bağlantısı** — yeni nesil: ethernet/OPC-UA; eski nesil: sinyal
   retrofiti (atkı sayacı pulse + çalış/dur kontağı — marka bağımsız, birinci
   sınıf yol). Marka sürücüleri (Picanol, Itema, Toyota...) müşteri pilotunda.
2. **Operatör tableti** — duruş SEBEBİ insandan; mevcut `ReasonPreset`
   altyapısı birebir kullanılır (yeni kind).
3. **Elle vardiya girişi** — hiç bağlantı yokken bile randıman raporu çıkar.

**Mimari:** makinelerden okuyan **ayrı toplayıcı ajan** (fabrika LAN'ında)
backend'e API'den basar — tablet gibi bir istemcidir. Backend'e seri port/
polling girmez; tek-process invariantı korunur. Veri append-only (okuma +
olay tabloları); canlı pano `stations/live-state` üstüne; patron ekranına özet.

⚠️ Repo kuralı geçerli: donanım gerçek kodu şimdilik simüle — geliştirme
simülatörle, gerçek sürücü ilk dokuma müşterisinin sahasında pilotla.
Maliyet kodda değil saha çeşitliliğinde; dürüst satış cümlesi: "②+③ hemen,
① makinelerinize göre pilotla".

---

## 9. Eksik bayraklar (öncelikli liste)

Varsayılanlar = bugünkü davranış. Tam liste + maliyet analizi sentez çıktısında;
öne çıkanlar: `shipping.orderRequirement` (enum, karar #1) ·
`quality.gradeRequiredEnabled` · `batch.requiredEnabled` ·
`shipping.weighRequiredEnabled` · `shipping.manualWeightRestrictedEnabled` ·
`inventory.simpleEntryEnabled` · `order.lineUnitEnabled` (satırda KG/ADET —
**stok metre kalır**, Roll birimlendirilmez) · `inventory.ownershipEnabled`
(emanet mal — boyahane yolunun ilk taşı) · `warehouse.locationEnabled` ·
`ui.terminologyOverrides` (görünen ad sözlüğü; kod/kimlik sabit) ·
`quality.gramajSpecEnabled` · `finance.invoiceBeforeDispatchEnabled` ·
`shipping.invoiceTraceWarnDays` · `workorder.stockProductionEnabled`
(varsayılan AÇIK) · `shipping.reservationEnabled` (karar #6).

---

## 10. Profiller

| Profil | uretim | fason | kartela | finans | ticaret | iplik | coklu-depo | kumas-teknik | tezgah | Not |
|---|---|---|---|---|---|---|---|---|---|---|
| **Basit — İşlemeci** (adnansahin bugün) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Tüm davranış bayrakları bugünkü değerde |
| **Standart** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | invoiceMode profille `ic` |
| **Perde üreticisi** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ⚠️ Perde fabrikası da TOP dünyasında (tambur→top→çuval→sevk — kullanıcı düzeltmesi; dikim perakendecinin işi). Konfeksiyon katmanı GEREKMEZ |
| **Dokuma/örme** | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | + gramaj; devere/çözgü istasyon kataloğundan |
| **Tam** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| Boyahane (hizmet VEREN) | — | | | | | | | | | Bugün SATILMAZ: fason aynası + tarife ayrı tasarım; `ownershipEnabled` ilk taş |

---

## 11. Yapılmayacaklar (bayrak teklifi gelirse red gerekçesi)

- **Defter semantiği bayraklanmaz** (brüt sevk, storno≠iade, donmuş belge, ters
  kayıt bugüne) — iki müşterinin raporu aynı kelimeyle farklı şey söyleyemez.
- **Veri bütünlüğü değişmezleri bayraklanmaz** (kilit sırası, idempotency,
  atomik claim, fail-closed kapılar).
- **Mevzuat bayraklanmaz** — e-fatura/e-irsaliye entegrasyon/sürüm işidir.
- **Geçmişe etki eden bayrak yok** — değer değişince dünkü verinin anlamı
  değişiyorsa tasarım hatası.
- **`if (musteri === 'X')` yasak** — fork'un ilk sinyali. Müşteriye özel
  migration/kolon yok; farklılık veri/bayrakta yaşar.
- **Domain bayrakla bükülmez** — boyahane aynası ve konfeksiyon katmanı bayrak
  değil modül/edition; Roll'un birimlendirilmesi kırıcı.
- Boolean çoğalması yerine **enum**; iki sürümdür herkeste aynı değerde duran
  bayrak ya varsayılana gömülür ya ölür.

---

## 12. Uygulama kuralları (Dilim 0+1 — kod yazan herkes/her model için)

> Model geçişleri olacak (Fable → Opus) ve oturumlar tazelenecek; kurallar
> sohbette değil BURADA yaşar. 2026-09-02'de gözden geçirildi: iki eksik
> kapatıldı (#7, #8), iki orantı düzeltildi (#1 kapsamı, #3 muafiyeti).

1. **Adnansahin sıfır fark** — kod paketi (P1-P6) dump provası + mevcut test
   seti yeşil olmadan bitmiş sayılmaz. Bilinçli istisna İKİ uç: mal kabul 403 +
   depo transferi 403 (karar #4). (P7 doküman işi — prova kapsamı dışı.)
2. **Grandfathering mekaniktir:** yeni anahtarın mevcut DB'deki değeri
   migration DAMGASIDIR; koddaki default yalnız satır-yok sigortasıdır; yeni
   kurulumun değerini profil yazar. Varsayılan çatışması koddaki default'la
   değil profille çözülür.
3. **Modül bağı kanca ile:** iş mantığı seviyesinde çekirdek modülü çağırmaz,
   modül kancaya abone olur ("bu modül silinse çekirdek derlenir mi?").
   Route'a middleware takmak bu kuralın DIŞINDA — o altyapıdır.
4. **Alt bayrak tek resolver'dan:** etkin değer = `modülAçık && altBayrak`
   TEK fonksiyonda; alt bayrağı doğrudan okuyan ikinci nokta yasak.
5. **Adlandırılmış middleware:** `requireTicaretEnabled` gibi; jenerik
   `requireModule("x")` YASAK — bekçiler middleware adını metin olarak arar.
6. **`if (musteri === 'X')` yasak** — fork'un ilk sinyali; farklılık
   bayrak/profilde yaşar.
7. **Gizli-hesap süzgeci TEK kaynaktan:** `isSystemAccount:false` süzgeci
   paylaşılan where-parçası/helper'dan gelir + AST bekçisi; beş noktaya elle
   kopyalanırsa altıncı yüzey unutulur ("unutulmuş altıncı enum" sınıfı).
8. **Sır hijyeni:** süperadmin parolası/PIN'i ve ayar şifresi repoya, log'a
   ve audit diff'ine GİRMEZ (audit-diff redaksiyon listesi genişletilir —
   `quickPin` emsali); dağıtım yalnız `.env` + parola yöneticisi.
9. **Bekçi disiplini orantılıdır:** her yeni KAPI negatif sondalı bekçi ister
   (kırmızı verebildiği kanıtlanmadan kapı yok); kapı üretmeyen değişiklik
   (salt UI dizilimi) bekçi zorunluluğu taşımaz.
10. **Paket disiplini:** her iş paketi kendi commit serisi; commit mesajında
    bekçi kanıtı; deploy sırası backend ÖNCE; model/oturum geçişinde bağlam
    bu doküman + plan dosyasıdır.
11. **Para yalnız Decimal:** para aritmetiği `Prisma.Decimal` ile;
    para yolunda `.toNumber()`/`parseFloat` YASAK (mevcut durum zaten temiz —
    `computeLineAmounts` tek hesap noktası, ROUND_HALF_UP satır bazında;
    bozan ilk PR'ı bekçi yakalamalı). İSTEMCİ PARA HESAPLAMAZ, gösterir —
    Decimal JSON'da string'dir, panelde toplanmaz ("mobil brütü elle kurmaz"
    emsali). Türkçe virgül girişi ("12,50") finans formuna dokunan ilk işte
    ölçülür.
12. **Süreç: ajan/test sunucusunu yalnız KENDİ PID'inle öldür** — `pkill -f
    "tsx src/server.ts"` YASAK (2026-09-03: bir ajanın :4100 test sunucusunu
    kapatırken kullanıcının :4000 dev sunucusunu da düşürdüğü ölçüldü; aynı komut
    satırı). Sunucuyu `run_in_background` ile başlat, PID'i sakla, o PID'i öldür;
    paralel ajanlara AYRI port ver (4100 paylaşımı sahte kırmızı üretti).

## 13. Uygulama dilimleri (kod onayı ayrıca alınacak)

0. **Ön koşul:** repo birleşmesi — `feature/patron-modulu` → `integration` →
   `main`; `adnansahin` + `feature/depo-mal-kabul` dalları emekli.
1. **Dilim 1:** `modul.*` anahtarları + uretim/ticaret/iplik ayrıştırması
   (finans middleware kopyası) + süperadmin + ayar şifresi + Sistem Profili
   ekranı + tamlık bekçisi + **kalite-yetenek dönüşümü** (karar #11) + basit/tam
   profiller. Kabul: dump provası + adnansahin LAN regresyonu.
2. **Dilim 2:** davranış bayrakları — `orderRequirement`, `weighRequired`,
   `invoiceMode`, `gradeRequired`, `batchRequired` (en ucuz: mevcut uyarı/kural
   → kapı).
3. **Dilim 3:** `modul.kumas-teknik` şeması (additive) + rezervasyon altyapısı
   (karar #6; ayrı tasarım turu ŞART).
4. **Dilim 4 (dokuma satışıyla):** tezgah-izleme (②+③ önce, ① pilotla) +
   "top tezgahtan doğar" damgası.
5. **Rafta:** toptancı basit-giriş ekranı, boyahane aynası, SKU/koli/GS1.

Her dilim: bekçi (negatif sondalı) + `surum-notlari` + dump provası. Deploy
sırası her zamanki: backend ÖNCE.
