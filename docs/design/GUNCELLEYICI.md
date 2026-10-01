# Güncelleyici — backend dağıtım sözleşmesi (Dağıtım v2)

> **Durum:** §1–§3 **DONMUŞ** (D1, 2026-09-30) — satıcı, backend, CF Worker ve Rust güncelleyici (D2) buna karşı yazılır. §4 ve sonrası (yerel dizin düzeni · yerel IPC/niyet ve durum dosyaları · durum makinesi · geri dönüş) **D2**'nin; bu belgeye eklenir.
>
> | Sözleşme sürümü | Ne zaman | Ne değişti |
> |---|---|---|
> | 1 | 2026-09-30, D1 ilk dondurma | bildirim `tekserp-surum`, kira `guncelleme`, karar, rapor, ortak vektörler |
> | **2** | 2026-10-01, D1 (bu belgenin §1.6'sı) | **PG eki (D4 isteği, `KENDI-POSTGRESQL.md` §8):** bildirimin `pg` bloğu `{cizgi, enAz, hedef}` oldu (1'deki `{gerekenSurum, paket}` KALKTI — yayınlanmış bildirim yoktu, tel `v` 1 kalır); PG paketi AYRI imzalı künyeyle (`tekserp-pg`) `/<kanal>/backend/pg/<sürüm>-<derleme>/`; `PG_BAGI` kodu; karar girdisi `pgSurumu` → `pg {kip, surum, derleme}`; farklı ANA sürümlü PG hiçbir yoldan kurulmaz. Vektörler yeniden üretildi — D2 bu sürüme göre yazar. |
> | 3 | 2026-10-01, D1 (§3.2 — yalnız EKLER) | Fabrika API'si uygulandı: `UpdateStatus`a `yerel` (güncelleyicinin durum dosyası) + `gecmis` (son backend denemeleri) eklendi; rapor ve panel görünümü D2'nin `durum.json` + `gecmis.jsonl` (§5) biçiminden TEK eşlemeyle doğar (`src/services/update-status.service.ts`). Tel ve vektörler DEĞİŞMEDİ. |
> | **4** | 2026-10-01, D7 (§3.2 · §4.3 · §5.1 · §8.7) | **Backend güncelleyiciye hizalandı:** eşleme `durum.json`un KESİN bloklarını (`bekleyen` · `son` · `karar`) DOĞRUDAN okur (sezgisel çeviri kalktı), canlılık kalp atışından (`sonCanlilik` + `canlilikEsigiSn`); `UpdateStatus`a yalnız EKLER (`karar` · `canlilik` · `onay` · `eylemler` · `yerel.urun` · `yerel.sonAyrinti` · bekleyen ayrıntısı · geçmişte PG satırı); `POST /api/guncelleme/onay` + backend'in TEK niyet yazıcısı (§5.1); **sağlık sondasının yolu `/health` → `/health/yerel`** (public `/health`in alan kümesi DONMUŞ — §8.7; D2'nin `health::url`i değişir); `TEKSERP_DOGRULAMA_KIPI` kapsamı (§4.3). Tel (yoklama raporu) ve vektörler DEĞİŞMEDİ; D2'nin yedi senaryo çıktısı `native/test-vektorleri/guncelleyici-durum/` altında okuyucu vektörü. |
> **Tek kaynak KOD'dur:** `Teks-Erp/src/lib/license/protocol/guncelleme.ts` (bildirim · paket bağı · sürüm karşılaştırma · karar sözlüğü · rapor) + `protocol/guncelleme-ortak.ts` (paket künyesi · PAKET anahtar kümesi · işaretçi) + `protocol/guncelleme-pg.ts` (PG gereksinimi · PG künyesi · PG bağı) + `protocol/guncelleme-karar.ts` (pencere aritmetiği · etkin politika · karar) + `protocol/belgeler.ts` (`TYP.SURUM`, `UPDATE_MODES`, `LeaseUpdatePolicySchema`, `defaultUpdatePolicy`, `DOWNLOAD_PRODUCTS`, `ReleaseVersionSchema`) + `protocol/uclar.ts` (`PollRequestSchema.guncelleme`). Satıcı ve patron aynası bayt-eşit (`test_lisans_protokol_aynasi`). Belge ayrışırsa kod kazanır.
> **Ortak test vektörleri:** `Teks-Erp/native/test-vektorleri/guncelleme-surum.json` · `guncelleme-kira.json` · `guncelleme-karar.json` · `guncelleme-rapor.json` — üretici `npx tsx scripts/test_guncelleme_protokol.ts --vektor-yaz` (Teks-Erp'te), elle düzenlenmez; bekçi her kaydın beklenenini bugünkü TS ile yeniden hesaplar. Rust güncelleyici aynı dosyaları okur (kayıt başına `{vektor, beklenen}`; hata metni değil yalnız `code` karşılaştırılır).
> **Üst plan:** Dağıtım v2 (kullanıcı onayı 2026-09-30): backend Windows hizmeti, pm2 kalkar; güncelleyici baştan Rust; backend sürümleri kanal bazlı; politika kurulum başına (OTOMATIK · ONAYLI · DONDUR).

## 0. Roller — kim imzalar, kim doğrular

| Belge / veri | Üreten (anahtar) | Doğrulayan | Yetki mi? |
|---|---|---|---|
| Sürüm bildirimi `tekserp-surum` | yayın betiği `deploy/backend-yayinla.mjs` (PAKET anahtarı, satıcı Mac'i) | güncelleyici | **evet** — hangi paket, hangi kanal |
| Paket içi `butunluk.jws` (`tekserp-butunluk`) | `build-korumali-imza.ts zip` (PAKET) | güncelleyici + native çekirdek | **evet** — paketin dosyaları |
| Kira `guncelleme` alanı | satıcı (ALT, kök zinciri) | güncelleyici; backend yalnız gösterir | **evet** — ne zaman / hangi sürüme kadar |
| İndirme belirteci `/<kanal>/backend/` | satıcı (İNDİRME) | CF Worker | yalnız CDN bileti |
| Yerel onay + belirteç (niyet dosyası, §4 D2) | backend (panel onayı) | güncelleyici | **HAYIR** — yalnız tetik |
| Güncelleme raporu (yoklama) | backend (güncelleyicinin durum dosyasından) | satıcı | bilgi (filo görünümü) |

## 1. Sürüm bildirimi (manifest)

### 1.1 Yayın düzeni

```
<VDS kökü>/html/<kanal>/backend/<sürüm>/tekserp-backend-<sürüm>.zip   ← paket (içinde PAKET imzalı butunluk.jws)
<VDS kökü>/html/<kanal>/backend/<sürüm>/surum.json                     ← sürümün DEĞİŞMEZ işaretçisi
<VDS kökü>/html/<kanal>/backend/son.json                               ← kanalın EN YENİ sürümü — EN SON yüklenir
<VDS kökü>/html/<kanal>/backend/pg/<a.k>-<derleme>/<PG zip>            ← PG sahne paketi (sözleşme 2, §1.6) — AYRI, değişmez
<VDS kökü>/html/<kanal>/backend/pg/<a.k>-<derleme>/pg.json             ← PG künyesi işaretçisi (`tekserp-pg`)
<VDS kökü>/defter/<kanal>-BACKEND-YAYIN-DEFTERI.tsv                    ← yayın defteri
```

- Adres `https://guncelleme.etkiliyazilim.com/<kanal>/backend/…` (yollar `releasePointerPath` · `releaseFilePath`). Kanal kaydında türetilmiş `yayin.backendFeed` · `backendManifest` · `vdsBackend` · `backendDefter` (`deploy/kanallar.json`, bekçi `check-kanallar` §3).
- **Kapı:** `/<kanal>/backend/*` CF Worker indirme kapısının kapsamındadır — `yolOneki = /<kanal>/backend/` taşıyan İNDİRME belirteci ister (`X-TKL-Indirme` başlığı ya da `?t=`). `son.json` DEĞİŞKEN dosyadır (kenar önbelleği yok); sürüm dizini DEĞİŞMEZ (uzun önbellek) — yayın betiği var olan sürüm dizinini ezmez, aynı sürüm ikinci kez yayınlanmaz (yeni yama numarası alır).
- **Sıra:** paket(ler) → `<sürüm>/surum.json` → yükleme doğrulaması (boyut + sha256 uzakta) → `son.json` (EN SON). Yarım yayında `son.json` eski sürümü gösterir; hiçbir kurulum eksik pakete yönlenmez.
- **Yayıncı:** `node deploy/backend-yayinla.mjs --musteri=<kod> --paket=<imzalı zip> --anahtar=<PAKET anahtarı> --pg-cizgi=<16> --pg-en-az=<ana.küçük> [--pg-kunye=<pg.json>] [--min-kaynak=<sürüm>] [--zorunlu] [--kuru] [--terfi-atla="<cümle>"]` (PG paketi ayrı: §1.6). Kapı sırası: kanal kaydı → paket künyesi (`backendKanal` = hedef, prova yalnız hazırlıkta) → sürüm notu (`docs/surumler/backend-<sürüm>.md` "Özet"i = `notlar.ozet`; prova ise sabit özet) → terfi (K5; kaynak = hazırlık kanalının `son.json`u, prova terfiye YETMEZ) → `Teks-Erp/scripts/backend-bildirim.ts` (paketi açar, imzalı dosya listesini PAKET çapasıyla TAM denetler, bildirimi kurar ve paketi imzalayan anahtarla imzalar — parola TTY/stdin) → yayın belirteci var mı → monotonluk (yeni sürüm > yayındaki) → sürüm dizini yok mu → yükleme sırası → kenardan belirteçle `son.json` = yüklenen. `--kuru` ağa çıkmaz, bildirimi imzasız kurar. Bekçi `scripts/test_backend_yayin.mjs`.

### 1.2 İşaretçi (`son.json` ve `<sürüm>/surum.json`)

KATI `{ "v": 1, "bildirim": "<JWS>" }` (`ReleasePointerSchema`, ≤ 64 KB). Bozuksa `SURUM_ISARETCI`, `v ≠ 1` ise `BELGE_SURUM`. İşaretçinin kendisine GÜVENİLMEZ — yalnız imzalı `bildirim` okunur. `son.json`, en yeni sürümün `surum.json`'unun bayt-eşit kopyasıdır.

### 1.3 Bildirim yükü (`tekserp-surum`, PAKET imzalı, `v: 1`, `ReleaseManifestSchema`)

| Alan | Tip | Anlam |
|---|---|---|
| `urun` | `"backend"` | bugün tek ürün; güncelleyicinin kendisi backend paketinin İÇİNDE gelir (§4 D2) |
| `platform` | `"win32-x64"` | Linux/Docker kapsam dışı |
| `kanal` | kanal kodu | bildirim YALNIZ bu kanalda geçerli (kanallar arası tekrar oynatma `SURUM_KANAL`) |
| `surum` | `x.y.z` ya da `x.y.z-ön.sürüm` (`ReleaseVersionSchema`; `+yapı` eki YOK, URL segmenti) | |
| `commit` | 7–40 hex | kurulum kaydına geçer |
| `derlemeTarihi` | ISO | paketin imzalı künyesiyle AYNI an; HAK `bakimBitis`iyle kıyaslanır (§3.8) |
| `yayinZamani` | ISO | `derlemeTarihi ≤ yayinZamani + 10 dk` |
| `paket` | `{ad, boyut, sha256, paketId}` | `ad` sürüm dizininde `*.zip` (yol yok), `boyut` 1 B–4 GiB, `sha256` küçük harf hex (zip baytları), `paketId` = künyedeki `paketId` |
| `paketImzaKid` | `paket-…` | paketin `butunluk.jws`ini imzalayan anahtar = bu bildirimi imzalayan anahtar (`SURUM_ANAHTAR`) |
| `minKaynakSurum` | sürüm \| null | doğrudan geçişin en eski kaynağı (`< surum`); daha eski kurulum `KAYNAK_SURUM_ESKI` alır ve portaldan ara sürüme SABİTLENİR |
| `gocSayisi` | int ≥ 0 | paketteki migration klasörü sayısı (bilgi + göç sonrası denetim) |
| `pg` | `{cizgi: 16, enAz: "16.9", hedef: {surum: "16.15", derleme: 4, paket: {ad, boyut, sha256}, icerikSha256, icuSurum: "67"} \| null}` (sözleşme 2, `PgRequirementSchema`) | bu backend sürümünün desteklediği PG = [`enAz`, `cizgi`.*]; `enAz` ve `hedef` çizginin ana sürümünde, `hedef ≥ enAz`. Kendi örnekte hedef kuruludan yeniyse PG küçük sürüm güncellemesi backend'den ÖNCE ayrı adımda (§1.6); harici örnekte yalnız `enAz` denetlenir; ana sürüm farkı OTOMATİK DEĞİL |
| `runtime` | `{node: "24.18.0"}` | paketin taşıdığı `runtime/node.exe` (bilgi) |
| `notlar` | `{ozet: 1–2000}` | panel ve portalda gösterilir (sürüm notu kapısından geçmiş metin) |
| `zorunlu` | bool | YALNIZ gösterim ("kritik"); zamanlamayı politikadan başka hiçbir şey belirlemez |

`z.object`: v:1 içinde yeni bilgi alanı `.optional()` eklenir, eski doğrulayıcı ATAR; anlam daraltan değişiklik `v`yi artırır (LİSANS-PROTOKOLU §9 aynen).

### 1.4 Doğrulama sırası (`verifyReleaseManifest(token, {keys, kanal})`)

1. JWS: `typ = tekserp-surum` (`JWS_TYP`), `kid` çağıranın anahtar kümesinde (`JWS_KID`), imza (`JWS_IMZA`).
2. Şema (`BELGE_SURUM` bilinmeyen `v`, `BELGE_SEMA`).
3. İmzalayan kid = `paketImzaKid` (`SURUM_ANAHTAR`).
4. `kanal` = kiranın `kanal.kod`u (`SURUM_KANAL`).

**Anahtar kümesi PARAMETREDİR** (güven çapası kuralı): güncelleyici gömülü `PACKAGE_PUBLIC_KEYS` aynasını kurulumun HAK sınıfına göre süzer — hazırlık anahtarı (`paket-hazirlik*`) yalnız TEST/DEMO kurulumunda kümeye girer (`integrity-scope.ts` `isStagingPackageKid` / `STAGING_PACKAGE_CLASSES`; paket bütünlüğüyle aynı kural). Rust aynası aynı sırayla aynı kodu verir (vektör `guncelleme-surum.json`).

### 1.5 Paket bağı (indirmeden sonra, uygulamadan önce)

1. İndirilen dosyanın boyu ve sha256'sı bildirimle birebir (değilse sonuç kodu `PAKET_OZETI`, dosya silinir).
2. Zip ayrı bir sahne dizinine açılır (sürüm dizini değil); `butunluk.jws` PAKET anahtar kümesiyle (1.4 ile aynı süzgeç) doğrulanır ve dosya listesi `verifyIntegrity` ile GEÇERLİ olmalı (`BUTUNLUK_GECERSIZ`).
3. `checkPackageBinding(bildirim, künye)`: künyeyi imzalayan kid = `paketImzaKid` · `paketId` · `urun` · `surum` · `derlemeTarihi` (an olarak) aynı; künyenin `musteri`si `null` (kanal-dışı paket) ya da bildirimin kanalı (`PAKET_BAGI`).
4. PG paketi varsa boyu + sha256'sı bildirimle birebir.

### 1.6 PostgreSQL paketi (sözleşme sürümü 2 — şartname `KENDI-POSTGRESQL.md`)

- **Ayrı dosya, ayrı künye:** PG sahne zip'i (sunucu alt kümesi, ~1.600 dosya, ~93 MB + `TEKSERP-ICERIK.sha256` içerik manifestosu) her backend sürümünde yeniden taşınmaz; `/<kanal>/backend/pg/<a.k>-<derleme>/` DEĞİŞMEZ dizininde paketle birlikte `pg.json` (işaretçi `{v, bildirim}`) durur. Künye `tekserp-pg`, PAKET imzalı, **kanaldan bağımsız** (aynı ikili her kanalda aynı): `{v, urun: "postgresql", platform, cizgi, surum, derleme, paket: {ad, boyut, sha256}, icerikSha256, icuSurum, yayinZamani}`; `surum`un ana sürümü `cizgi` olmalı (`PgPackageManifestSchema`). `icerikSha256` zip'teki içerik manifestosunun özetidir — imzalayan araç onu zip'ten ÖLÇER (`backend-bildirim.ts pg-imzala`), elle yazılmaz.
- **Doğrulama:** `verifyPgPackageManifest(token, {keys})` — JWS (typ `tekserp-pg` · kid · imza) → şema. Anahtar kümesi bildirimdekiyle aynı süzgeçten.
- **Bağ:** `checkPgBinding(bildirim.pg, künye)` — hedef yoksa ya da çizgi (ANA SÜRÜM) · sürüm · derleme · paket (ad, boy, özet) · içerik özeti · ICU'dan biri farklıysa `PG_BAGI`. Güncelleyici paketi indirir → boy + sha256 bildirimin hedefiyle → künye imzası + bağ → açar → her dosyayı içerik manifestosuna, manifestoyu `icerikSha256`ya karşı ölçer; ancak sonra kullanır (şartname §5 U0–U1).
- **Ana sürüm REDDİ (üç kat):** künye şeması (sürüm ≠ çizgi RED) · bağ (künye çizgisi ≠ bildirim çizgisi `PG_BAGI`) · karar (kurulu PG'nin ana sürümü ≠ bildirim çizgisi `UYGUN_DEGIL/PG_ANA_SURUM`, kendi ve harici kipte). Ana sürüm geçişi yalnız runbook'la (D4'ün büyük sürüm geçişi runbook'u, `dagitim/d4-pg` dalında).
- **Yayın:** `node deploy/backend-yayinla.mjs --musteri=<kod> --pg-yayinla --pg-paket=<zip> --pg-kunye=<pg.json>` (künye imzası + zip ölçümü → geçici ad → uzak ölçüm → yeniden ad; `son.json`a dokunmaz; var olan dizin EZİLMEZ). Onu hedefleyen backend bildirimi `--pg-kunye=<pg.json>` ile üretilir ve PG paketi kanalda yoksa yayıncı DURUR.
- **Kurulu PG (karar girdisi):** `pg: {kip: "KENDI" | "HARICI", surum: "16.15", derleme: 4 | null}` — kendi kipte derleme ZORUNLU (`pgsql/ornek.json`, şartname §6; yerel dosya biçimi §4 D2), harici kipte `null`; sürüm her koşumda `SHOW server_version`dan. Ölçülemezse `PG_OLCULEMEDI`.

## 2. Kira `guncelleme` alanı — politika (`LeaseUpdatePolicySchema`)

Satıcı kurulum başına portaldan ayarlar; her kirada ALT imzayla gelir. Güncelleyici yalnız GEÇERLİ kiranın alanına bakar (`effectiveUpdatePolicy`: kira yok ya da `bitis + 10 dk` geçmişse `null` ⇒ karar `DONDURULDU/KIRA_YOK` — lisans kademesine etkisi YOK, yalnız güncelleme durur).

| Alan | Tip | Anlam |
|---|---|---|
| `kip` | `OTOMATIK` · `ONAYLI` · `DONDUR` | OTOMATIK: pencerede kendiliğinden · ONAYLI: yalnız yerel onayla (HEMEN ya da PENCERE) · DONDUR: hiçbir şey, onay da açmaz |
| `pencere` | `{baslangic "HH:MM", bitis "HH:MM"\|"24:00", gunler [1..7 artan], saatDilimi}` \| null | İNSAN kuralı (portal/panel gösterimi). Günler ISO haftası (1 = Pazartesi) ve BAŞLANGIÇ gününe göre; `bitis < baslangic` gece yarısını aşar; `24:00` gün sonu; `baslangic = bitis` RED. `OTOMATIK` pencere ister |
| `araliklar` | `[{baslangic ISO, bitis ISO}]` ≤ 64, sıralı, çakışmasız (bitişik serbest), her biri ≤ 25 sa | kuralın kiranın ömrü boyunca MUTLAK karşılığı — satıcı kira basarken `windowIntervals(pencere, verilis, bitis)` ile hesaplar; her aralık kira ömrüyle kesişir. **Güncelleyici YALNIZ bunu okur**, saat dilimi hesabı yapmaz |
| `hedefSurum` | sürüm \| null | sabitleme: bu sürüm kurulur, ÖTESİNE geçilmez; kurulu sürüm ≥ hedef ise `GUNCEL/HEDEF_ULASILDI` (geri inme YOK). Güncelleyici sabitlemede `son.json` yerine `<hedef>/surum.json`u okur |

- **Saat dilimi tek kaynaktan:** fabrika her yoklamada BUGÜNKÜ dilimini (`factory_timezone_periods` → `constants/time.ts`) `guncelleme.saatDilimi` ile bildirir; satıcı pencere kuralını bununla çevirir ve kuralın `saatDilimi`ne yazar. Hiç bildirmemiş kurulumda `Europe/Istanbul` (fabrika varsayılanıyla aynı). Portal dilimi ELLE seçtirmez (iki kaynak olmasın).
- **Yaptırım önceliği:** kiranın `yaptirim.guncellemeDonuk` (K1) her kipi ve her onayı ezer (`DONDURULDU/YAPTIRIM`). Satıcı bakım bitmiş ya da K1'li kuruluma indirme belirteci zaten vermez; karar ikinci kapıdır.
- **Varsayılan (alan YOK — eski satıcı):** `defaultUpdatePolicy()` = `{kip: ONAYLI, pencere: null, araliklar: [], hedefSurum: null}` — bugünkü davranış: hiçbir şey kendiliğinden kurulmaz; yalnız yetkili kişinin "şimdi kur" onayı.
- **Zil:** portalda politika değişince satıcı kuruluma `guncelleme` zili çalar (konu `DOORBELL_TOPICS`te zaten var) → fabrika yoklar → yeni kira yeni politikayı taşır.

### 2.1 Geriye uyum — "eski istemci ne yapar"

- **Eski backend + yeni satıcı:** kira şeması `z.object` → `guncelleme` ATILIR (TS ve native `schema.rs` aynı kural); imzalı kira dosyada alanla birlikte durur. Backend davranışı değişmez.
- **Yeni backend + eski satıcı:** kira alan taşımaz → varsayılan ONAYLI. Yoklama gövdesindeki YENİ `guncelleme` raporu eski satıcıda KATI şema yüzünden `GOVDE_GECERSIZ` alır ⇒ **satıcı ÖNCE** yayınlanır (LİSANS-PROTOKOLU §12 madde 14 ile aynı kural).
- **İndirme öneki `/<kanal>/backend/`:** eski Worker bu öneki tanımaz → belirteç doğrulansa da yol kapsam dışı/önek RED (fail-closed). Worker, ilk backend yayınından ÖNCE güncellenir.
- **`GET /api/license/indirme-belirteci?urun=backend`:** eski backend `urun`u `electron|mobil` diye doğrular → 400. Güncelleyici ile backend aynı paketle gelir; karışık sürüm yok.
- **Native lisans çekirdeği (Rust, `lisans-cekirdek`):** bugün `guncelleme` alanını ATAR. Güncelleyicinin ortak crate'i alanı AYNALAMAK zorundadır (D2) — `guncelleme-kira.json` vektörleri; aynalanana dek Rust tarafı alanı "yok" görür ve varsayılana (ONAYLI) düşer, OTOMATİK hiç tetiklenmez (fail-closed yön).

## 3. Güvenlik ve karar ilkeleri (D2 uygular, bekçiler ölçer)

1. **Yetki yalnız satıcı imzalı veriden:** kira (ALT → kök zinciri) + bildirim (PAKET) + paket bütünlüğü (PAKET). HTTP başlığı, dosya adı, işaretçinin imzasız alanları ve backend'in yazdığı hiçbir şey yetki DEĞİLDİR.
2. **Yerel niyet dosyası YETKİ DEĞİL:** backend (panel onayı, izinli kullanıcı + denetim satırı) yalnız iki şey yazar — **onay** `{surum, zamanlama: HEMEN|PENCERE, …}` ve **indirme belirteci** (kiranın yanıtındaki `/<kanal>/backend/` belirteci). Onay yalnız politika ONAYLI/OTOMATIK iken ve AYNI sürüm için sayılır (başka sürümün onayı `ONAY_BEKLIYOR`); DONDUR ve K1'i açamaz; kurulacak sürüm ve paket her zaman imzalı bildirimden gelir. Sahte belirteç Worker'da düşer; geçse bile içerik imzayla doğrulanır. Biçim ve konum §4 (D2).
3. **Tek karar noktası:** `decideUpdate(girdi)` SAF — sıra: yetki (kira yok · K1 · DONDUR) → sürüm (kurulu sürüm biçimi · sabitleme · aday · geri inme yok · sabitleme dışı · kaynak sınırı) → uygunluk (HAK · bakım · PostgreSQL) → zamanlama (HEMEN onayı · ONAYLI'da onay · aralık içi/sonraki). Kararlar `GUNCEL · DONDURULDU · UYGUN_DEGIL · ONAY_BEKLIYOR · PENCERE_BEKLIYOR · KUR`; nedenler `UPDATE_DECISION_REASONS`. Rust güncelleyici bu tabloyu `guncelleme-karar.json` ile aynalar; backend'in durum ekranı aynı fonksiyonu çağırır.
4. **Geri inme yok:** kurulu ≥ aday ⇒ `GUNCEL`; sabitleme geri indirmez; göçler ileri yönlüdür. Veri geri dönüşü yalnız AYNI denemenin güncelleme öncesi yedeğinden (§4 D2).
5. **Pencere:** aralıklar yarı açıktır `[baslangic, bitis)`. Uygulama aralık İÇİNDE BAŞLATILIR; başlamış uygulama pencere kapansa da biter ya da geri döner (göç yarıda bırakılmaz). Aralık yoksa (kira sonu) `PENCERE_BEKLIYOR/PENCERE_YOK`.
6. **Kanal bağı:** bildirimin kanalı kiranın kanalıdır; paket künyesinin müşterisi `null` ya da o kanal.
7. **Bakım:** `derlemeTarihi > HAK.bakimBitis` ⇒ `UYGUN_DEGIL/BAKIM_DISI` (kurulsaydı lisans durumu `BAKIM_IHLALI` ek süresine düşerdi — `state-rules-package.ts`). HAK doğrulanamıyorsa `HAK_YOK`.
8. **PostgreSQL (sözleşme 2):** kurulu PG ölçülemezse (kendi kipte derleme dahil) `PG_OLCULEMEDI`; ana sürümü bildirimin `cizgi`si değilse `PG_ANA_SURUM` — hiçbir kipte otomatik değil (runbook); kendi örnekte `hedef` kuruludan (sürüm, derleme) YENİYSE `pgGuncellemesi: true` (PG adımı backend'den önce, başarısızsa backend'e dokunulmaz), eskiyse PG'ye dokunulmaz (geri inme yok); harici örnekte PG'ye dokunulmaz, yalnız `enAz` — altındaysa `PG_SURUMU_ESKI`.
9. **Taze kira:** karar yalnız süresi geçmemiş kirayla (+10 dk tolerans) verilir; çevrimdışı kurulum kendiliğinden güncellenmez.
10. **Sır hijyeni:** yoklama raporu serbest metin taşımaz — sonuç kodu deseni `^[A-Z0-9_]{2,40}$`, belgeli küme `UPDATE_RESULT_CODES`; dosya yolu, kullanıcı adı, ham hata metni GİRMEZ.

### 3.1 Yoklamadaki güncelleme raporu (`PollRequestSchema.guncelleme`, KATI, OPSİYONEL)

```ts
guncelleme?: {
  saatDilimi: string;                                   // fabrikanın BUGÜNKÜ IANA dilimi (§2)
  guncelleyici: { durum: "CALISIYOR" | "DURDU" | "YOK" | "OLCULEMEDI"; surum: string | null };
  bekleyen: { surum: string; karar: UpdateDecisionKind; neden: string | null } | null;   // en yeni adayın son kararı
  son: {                                                // son TAMAMLANAN deneme
    kayitId: uuid;                                      // güncelleyicide doğar — satıcı (kurulum, kayitId) ile idempotent yazar
    hedefSurum: string; kaynakSurum: string | null;
    sonuc: "BASARILI" | "GERI_DONDU" | "BASARISIZ"; kod: string | null;   // BASARILI ⇔ kod null
    baslangic: ISO; bitis: ISO; veriGeriYuklendi: boolean;
  } | null;
}
```

Kurulu backend sürümü ayrıca taşınmaz: `ortam.uygulamaSurum` odur. Rapor yoksa alan HİÇ gönderilmez. Satıcı `son`u kurulum geçmişi defterine (`kurulum_kaydi`, `kaynakKayitId = kayitId`) yazar; `guncelleyici` + `bekleyen` + `saatDilimi` kurulumun durum kolonlarına (filo görünümü).

### 3.2 Fabrika API'si (panel "Sistem → Güncellemeler" — ekran D7)

| Uç | İzin | Gövde / sorgu | `data` |
|---|---|---|---|
| `GET /api/license/indirme-belirteci` | (mevcut) onaylı cihaz ya da oturum | `?urun=electron\|mobil\|backend&kanal=` | `LicenseDownloadToken` — K1'de 403 `LICENSE_UPDATES_FROZEN` |
| `GET /api/guncelleme/durum` | `license:view` ∨ `license:manage` | — | `UpdateStatus` (aşağıda) |
| `POST /api/guncelleme/onay` | `license:manage` (kısıtlı kipte de açık — kurtarma yolu) | `{clientToken, surum, zamanlama: HEMEN \| PENCERE \| GERI_AL}` — KATI (tanınmayan alan 400), `surum` yayın sürümü biçiminde | `{kayitId, niyet: {yazildi, kod}, durum: UpdateStatus}` (201); 409 `UPDATE_APPROVAL_NOT_ALLOWED` · `UPDATE_APPROVAL_VERSION_CHANGED` · `CLIENT_TOKEN_COLLISION` |

```ts
interface UpdateStatus {                                 // src/services/update-status.service.ts (tek eşleme)
  kuruluSurum: string;                                   // çalışan backend
  kanal: string | null;                                  // kiranın kanalı
  politika: { kip: "OTOMATIK" | "ONAYLI" | "DONDUR"; pencere: UpdateWindowRule | null; hedefSurum: string | null;
              kaynak: "KIRA" | "VARSAYILAN" } | null;    // null = geçerli kira yok
  donuk: boolean;                                        // K1 (yaptirim.guncellemeDonuk)
  sonrakiPencere: { baslangic: string; bitis: string } | null;   // şimdiki ya da sıradaki mutlak aralık
  indirmeBelirteci: boolean;                             // /<kanal>/backend/ belirteci elde mi
  guncelleyici: { durum: "CALISIYOR" | "DURDU" | "YOK" | "OLCULEMEDI"; surum: string | null };
  bekleyen: { surum: string; karar: string; neden: string | null } | null;
  son: UpdateResult | null;
  // sürüm 3 (yalnız EKLER) — panel ekranı (D7) için:
  yerel: { durum: string; surum: string | null; kuruluSurum: string | null; adim: string | null; hataKodu: string | null;
           mesaj: string | null; ilerleme: { indirilen: number; toplam: number } | null; planlanan: string | null;
           zaman: string | null } | null;                // güncelleyicinin `durum.json`u (§5.2); okunamıyorsa null
  gecmis: UpdateResult[];                                // son backend denemeleri, en yeni önce (≤ 20; §5.3)
  // sürüm 4 (yalnız EKLER) — D7:
  karar: { karar: UpdateDecisionKind; neden: string | null } | null;   // durum.json `karar` (adaysız karar dahil)
  canlilik: { sonCanlilik: string | null; esikSn: number | null; gecikmeSn: number | null; yanitVermiyor: boolean } | null;
  onay: { onayId; surum; zamanlama: "HEMEN" | "PENCERE"; onaylayan: {id, ad}; zaman; kullanildi: boolean } | null;
  eylemler: { hemen: boolean; pencere: boolean; geriAl: boolean; hedefSurum: string | null; neden: string | null };
  // bekleyen'e: zorunlu · ozet · aralik · pgGuncellemesi · yerel'e: urun · sonAyrinti{urun, hataKodu, mesaj}
  // gecmis satırına: urun ("backend" | "pg") · ayrintiKodu · pgSurum · onayId (PG satırında hedefSurum = hedefBackend)
}
```

**Güncelleyici dosyalarından eşleme (TEK yer: `update-status.service.ts`; dosyalar `src/lib/license/updater-ipc.ts` ile okunur — sürüm 4: SEZGİSİZ).** Kök: `TEKSERP_GUNCELLEME_DIZINI` (mutlak; geliştirme/test) > Windows'ta `%ProgramData%\TeksERP\guncelleme` > yok. Dosya düz olmalı (bağlantı İZLENMEZ), `durum.json` ≤ 64 KB, geçmişin son 64 KB'ı okunur. `guncelleyici.durum`: dosya yok → `YOK` · okunamıyor/biçimsiz → `OLCULEMEDI` · `durum = HATA` (insan gerekir) → `DURDU` · kalp atışı (§5.2) `şimdi − sonCanlilik > canlilikEsigiSn` ya da alan yok/biçimsiz ya da 5 dk'dan fazla gelecekte → `OLCULEMEDI` (panelde "güncelleyici yanıt vermiyor"; eşik 24 sa ile tavanlı) · diğer → `CALISIYOR`. `bekleyen` = `durum.json`un `bekleyen` bloğu `{surum, karar, neden}` AYNEN (kurulu sürüm güncelken `GUNCEL/SURUM_GUNCEL`, geri dönmüş aday `ONAY_BEKLIYOR` — güncelleyici öyle yazar); `son` = `durum.json`un `son` bloğu, `UpdateResultSchema` ile KATI (başarısız PG adımı dahil); `karar` = `karar` bloğu. Biçimsiz KESİN blok yalnız kendini düşürür (o alan `null`), dosyanın tamamı "ölçülemedi" olmaz. `gecmis` = `gecmis.jsonl` (`urun` backend + pg; `HATA` → `BASARISIZ`, kodsuz başarısızlık `BILINMEYEN`, `hataKodu` = raporun belgeli kodu, `ayrintiKodu` = iç kod; `kayitId` = `islemId`, UUID değilse satır atlanır; PG satırında `hedefSurum` = `hedefBackend`). Rapor `UpdateReportSchema`dan geçmezse GÖNDERİLMEZ (yoklama bu yüzden düşmez); güncelleyici yoksa alan hiç gitmez. Bekçi: `test_guncelleme_durumu` (D2'nin yedi senaryo dosyası vektör) · `test_lisans_yoklama_allowlist` §5.

**Onay (`POST /api/guncelleme/onay`, D7):** karar eklemeli `update_approvals` satırıdır (yeni karar yeni satır; yürürlükteki = EN SON satır, `GERI_AL` ise onay yok; satır `id`si niyetin `onayId`si), `clientToken` + `tokenReplay` ile idempotent, audit ayak izi `UPDATE_APPROVAL`. Kapı `approvalActions` — panelin düğmeleri (`UpdateStatus.eylemler`) ile AYNI yüklem: güncelleyici YOK · uygulanıyor · kira yok · K1 · DONDUR → onay yok (geri alma açık); hedef sürüm = güncelleyicinin doğruladığı aday (`bekleyen.karar` ONAY_BEKLIYOR ∨ PENCERE_BEKLIYOR; HATA sonrası son denemenin hedefi); `PENCERE` yalnız kirada sıradaki aralık varken. Başka sürüme onay `UPDATE_APPROVAL_VERSION_CHANGED`. Onay sonrası backend niyeti yeniden yazar (§5.1); elde backend belirteci yoksa yoklamayı dürter. Bekçi: `test_guncelleme_onay`.

## §4 Fabrika sunucusu — dizin düzeni ve hizmetler (YEREL SÖZLEŞME, D2)

> **§4–§13 D2'nindir** (fabrika sunucusundaki yerel sözleşme: dizinler · hizmetler · IPC · güven · durum makinesi · adımlar). Dizin/ortam adları ve güvenilmez dizin kuralı D3 (`hizmet-duzeni.ts`) ile, PG düzeni D4 (`KENDI-POSTGRESQL.md`) ile, karar/bildirim/kira/rapor §0–§3 ile hizalıdır.
> **Kod:** `Teks-Erp/native/` Cargo çalışma alanı — `tekserp-dogrulama` (ORTAK doğrulama; kiranın `guncelleme` şeması dahil — lisans çekirdeği ile güncelleyici aynı kodu bağlar) · `tekserp-guncelleyici` (hizmet `TeksERP-Guncelleyici`; §0–§3'ün Rust aynası `release.rs` + `decision.rs`, ortak vektörlerle ölçülür) · `tekserp-hizmet` (backend hizmet konağı `TeksERP-Backend`) · `lisans-cekirdek` (napi `.node`).

### §4.1 Dizin düzeni

Kök `<KOK>` kuruluma özgüdür (varsayılan `C:\TeksERP`; SAHINSRV de `C:\TeksERP` — `docs/ops/SUNUCU-ENVANTERI.md` 2026-09-29; `C:\Etkili-Yazilim` ESKİ köktür) — hiçbir ikili kökü koda gömmez, iki hizmet de `--kok <KOK>` argümanıyla kurulur (§4.2). Dizin adları backend'in `hizmet-duzeni.ts` `SERVICE_DIRS`iyle AYNIDIR (D3, dal `dagitim/d3-hizmet`; Rust tarafı `tekserp-hizmet/src/contract.rs`).

| Yol | İçerik | Yazan | Not |
|---|---|---|---|
| `<KOK>\surumler\<surum>\` | Backend paketinin AÇILMIŞ hâli (zip kökü = bu dizin): `dist\` · `runtime\node.exe` · `runtime\tekserp-hizmet.exe` · `runtime\tekserp-guncelleyici.exe` · `native\` · `node_modules\` · `prisma\` · `public\` · `assets\` · `package.json` · `butunluk.jws` · `butunluk-liste.txt` · `PAKET.json` | yalnız güncelleyici | Açıldıktan sonra DEĞİŞMEZ; imzalı kapsamın içine dosya eklenmez (bütünlük `FAZLA` verir). |
| `<KOK>\surumler\.hazirlik-<surum>\` | Açılmakta olan sürüm | güncelleyici | Bütünlük GEÇERLİ olunca `surumler\<surum>`e yeniden adlandırılır; yarım kalanı sonraki tur siler. |
| `<KOK>\current` | **Dizin bağlantısı (junction)** → `surumler\<surum>` | yalnız güncelleyici | Backend hizmeti YALNIZ bu yoldan koşar. Backend DURMUŞKEN değiştirilir. |
| `<KOK>\yapilandirma\.env` | Backend ortamı (bugünkü `app\.env` + ecosystem `env` bloğu; D6 taşır) | kurulum (D5) · geçiş (D6) · yönetici | Sır. Backend kendisi okur (`TEKSERP_KOK` → `resolveEnvFilePath`); konak OKUMAZ; güncelleyici yalnız `DATABASE_URL` · `PORT` · `BACKUP_*` · `PG_BIN_DIR` · `LICENSE_DIR` için okur (§6.5) — backend'in okuyucusunun (dotenv 17.4.2) Rust AYNASIYLA (`tekserp-hizmet/src/envfile.rs`; ortak vektörler `native/test-vektorleri/env-dosyasi.json`, üreten gerçek dotenv): içerikten hata doğmaz, biçimsiz satır backend'de olduğu gibi sessizce atlanır; `DATABASE_URL` ZORUNLU (yok/boş → `AYAR_EKSIK`, postgres adresi çözülemez → `AYAR_BICIMSIZ`). |
| `<KOK>\guncelleyici\` | `tekserp-guncelleyici.exe` (+ kendini güncellemede `.yeni.exe` / `.eski.exe`) · `ayar.json` · `gunluk\guncelleyici.log` | kurulum · güncelleyici | Hizmetin ImagePath'i buradadır (`current`in DIŞINDA — geri dönüş güncelleyiciyi değiştirmez). Günlük BURADA: backend'in yazabildiği `logs\` altında olsaydı önceden konan bir bağlantı SYSTEM'in yazısını yönlendirebilirdi. |
| `<KOK>\lisans\` | `LICENSE_DIR` (kira, HAK, kurulum anahtarı, `durum.json`) | backend | Güncelleyici YALNIZ OKUR, güvenilmez girdi olarak (§6.5). |
| `<KOK>\logs\` | Konak: `backend-out.log` · `backend-err.log` (satır başı yerel saat + ofset, 10 MB × 14, eskiler gzip) · `hizmet.log` | konak (backend hesabı) | D3 düzeni. |
| `<KOK>\backups\` | Gece yedekleri (SYSTEM görevi `yedekle.ps1`, D3/D5) | zamanlanmış görev | Güncelleme öncesi yedek burada DEĞİL (aşağıda `is\yedek\`). |
| `<KOK>\yedek-anahtar\` | `*.tkpub` alıcılar (+ `yerel.tkkey`) — `BACKUP_KEY_DIR` varsa o | kurulum | Güncelleyici yalnız `*.tkpub` okur. |
| `<KOK>\veri\` · `mobil-guncelleme\` · `rclone\` · `pg-setup\` | D3 `SERVICE_DIRS` | backend / kurulum | Güncelleyici dokunmaz. |
| `<KOK>\pgsql\<surum>-<derleme>\` | PostgreSQL ikilileri, sürüm başına YAN YANA (D4 `KENDI-POSTGRESQL.md` §0) — ör. `pgsql\16.15-4` | kurulum · güncelleyici | Bir önceki sürüm geri dönüş için kalır, daha eskisi silinir (D4 §5 U11). |
| `<KOK>\pgsql\bin` | **junction** → etkin sürümün `bin`'i | kurulum · güncelleyici | `PG_BIN_DIR` bu yoldur; yedekleme, bakım betikleri ve backend bu yolu okur — sözleşme KORUNUR (D4). |
| `<KOK>\pgsql\ornek.json` | Örnek kaydı (D4 §6): `{bicim, kip: kendi\|harici, hizmet, surum, derleme, ikiliDizin, oncekiIkiliDizin, veriDizini, port, kuruldu, guncellendi}` | kurulum · güncelleyici (SYSTEM/Administrators) | `kip: harici` ⇒ güncelleyici PG'ye HİÇ dokunmaz (§9). |
| `<KOK>\pgveri\` | `PGDATA` (D4; başka sabit NTFS sürücü seçilebilir — yol `ornek.json`da) | PG hizmeti | Güncelleyici veri dizinine DOKUNMAZ (küçük sürüm aynı disk biçimi). |
| `<KOK>\kurulum-gecmisi.jsonl` | Kurulum/geri alma kayıtları (`InstallRecordSchema`, `dirname(LICENSE_DIR)`) | güncelleyici | Backend son 10 satırı yoklamada satıcıya taşır — biçim bugünkü `kur.ps1` ile BİREBİR (§8.8). Dosya bir bağlantıysa YAZILMAZ. |
| `%ProgramData%\TeksERP\guncelleme\niyet\niyet.json` | NİYET (§5.1) | backend | Güncelleyici bu dizinde hiçbir şeyi yazmaz/silmez. |
| `%ProgramData%\TeksERP\guncelleme\durum\durum.json` · `gecmis.jsonl` | DURUM (§5.2) · işlem geçmişi (§5.3) | güncelleyici | |
| `%ProgramData%\TeksERP\guncelleme\is\` | Güncelleyicinin ÖZEL alanı: işlem günlüğü `islem.jsonl`, `indirme\`, `hazir\` (paket hazır işaretleri), `ertele.json` (kesin paket hatası aralığı), `kendi.json` (kendini güncelleme), `anahtar\<islemId>\` (geçici yedek anahtarı, DPAPI), **`yedek\<islemId>\`** (güncelleme öncesi şifreli yedek) | güncelleyici | Backend ERİŞEMEZ: güncelleyici her turda korumalı DACL'i (SYSTEM + Administrators, miras kesik) KENDİSİ uygular; `is\` ya da üstü bağlantıysa hiçbir şey yapmaz (fail-closed). |

Konak açılışta `<KOK>\current`i ÇÖZER (bağlantı `<KOK>\surumler\<ad>` dışını gösteriyorsa node başlatılmaz, çıkış 14): çalışma dizini SÜRÜM dizinidir; backend bütün yollarını `TEKSERP_KOK`tan türetir (D3), `cwd\..` varsayımı yoktur.

### §4.2 Hizmetler (SCM)

| Hizmet | İkili (ImagePath) | Hesap | Başlatma | Bağımlılık | Kurtarma |
|---|---|---|---|---|---|
| `TeksERP-PostgreSQL` | `<KOK>\pgsql\<surum>-<derleme>\bin\pg_ctl.exe runservice -N TeksERP-PostgreSQL -D "<PGDATA>" -w` (D4 §4.9; küçük sürümde güncelleyici sürüm dizinini değiştirir) | `NT SERVICE\TeksERP-PostgreSQL` | otomatik | — | 60 sn · 60 sn · 300 sn (D4) |
| `TeksERP-Backend` (ya da `--ad`) | `"<KOK>\current\runtime\tekserp-hizmet.exe" hizmet --kok "<KOK>" --ad <ad>` | `NT SERVICE\<ad>` (sanal hesap, parolasız; SID türü unrestricted; ayrıcalıklar YALNIZ `SeChangeNotifyPrivilege` + `SeCreateGlobalPrivilege` — SeImpersonate düşer, D3) | gecikmeli otomatik | `TeksERP-PostgreSQL` (varsa; harici PG'de `--pg-hizmeti <ad>`) | 5 sn · 5 sn · 30 sn; sayaç 1 günde sıfırlanır; çökmesiz hata çıkışında da (D3) |
| `TeksERP-Guncelleyici` (ya da `--ad`) | `"<KOK>\guncelleyici\tekserp-guncelleyici.exe" hizmet --kok "<KOK>" [--veri <VERİ>] --ad <ad>` | `LocalSystem` | gecikmeli otomatik | — | 10 sn · 30 sn · 60 sn; çökmesiz hata çıkışında da |

- Kayıt ikililerin kendi alt komutuyla, TEK kaynaktan: `tekserp-hizmet.exe hizmet-kur --kok <KOK> [--ad <ad>] [--pg-hizmeti <ad> | --pg-yok]` · `tekserp-guncelleyici.exe hizmet-kur --kok <KOK> [--veri <VERİ>] [--ad <ad>]` (ve `hizmet-kaldir [--ad <ad>]`).
- **Hizmet adı PARAMETREDİR (aynı makinede iki kanal):** `--ad` yoksa `TeksERP-Backend` · `TeksERP-Guncelleyici`. İkinci kanal kanal kaydının `backend.hizmetAdi`ni (`kanal-kapisi.mjs backend-paketle` → `TEKSERP_HIZMET_ADI`, ör. `TeksERP-Backend-demofabrika`) konağa `--ad` ile, güncelleyicisine `ayar.json` `backendHizmeti` ile verir; kendi güncelleyicisi ayrı ad (`--ad TeksERP-Guncelleyici-<kanal>`) ve ayrı veri kökü (`--veri <VERİ>`; o kanalın backend'i `TEKSERP_GUNCELLEME_DIZINI=<VERİ>\guncelleme`) alır — iki kanal ne hizmet ne IPC paylaşır. Ad: harf/rakamla başlar; harf · rakam · `.` · `_` · `-`; ≤ 80 (SCM adı, olay kaynağı ve `NT SERVICE\<ad>` olur). Konak adı node'a `TEKSERP_HIZMET_ADI` olarak verir. Hesap, SID türü, ayrıcalıklar, bağımlılık, kurtarma, açıklama ve olay günlüğü kaynağı buradan gelir; D3'ün `deploy/hizmet/backend-hizmeti.ps1`i dizin İZİNLERİNİ uygular ve kayıt için bu komutu çağırır (iki yerde kayıt yazılmaz — ayrışma riski).
- **Kurulum sırası BAĞLAYICIDIR (ölçüldü: thinkpad-1, Windows 11 26200):** ① dizin iskeleti → ② `hizmet-kur` (sanal hesap `NT SERVICE\<ad>` ANCAK hizmet kaydıyla doğar) → ③ ACL'ler (sanal hesaba verilen izin kayıttan ÖNCE `icacls` 1332 "hesap adlarıyla SID'ler eşlenmedi" ile düşer) → ④ başlat. Aynı sıra PG hizmeti için de geçerlidir (D4 §4.9–§4.10). Güncelleyicinin kendi özel alanı (`guncelleme\is\`) yalnız iyi bilinen SID'leri (SYSTEM, Administrators) kullandığından bu sıraya bağlı değildir.
- Konak `current` ÜZERİNDEN koşar (`<KOK>\hizmet\` KULLANILMAZ): konak sürümle birlikte imzalı gelir, geri dönüşte eskisine döner; ayrı bir kendini güncelleme yolu yoktur.
- "Tek backend süreci": konak KENDİNİ `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` işine koyar, node işe kendiliğinden girer — konak ölürse node da ölür; SCM yeniden başlattığında yetim node portu tutmaz. Güncelleyici de kendini ve araç çocuklarını aynı yolla bağlar (yarım `pg_dump`/`migrate` yaşamaz); her aracın ağacı ayrıca kendi işinde (zaman aşımında bütün ağaç sonlanır).

### §4.3 Backend hizmet konağı (`tekserp-hizmet`) sözleşmesi — D3 ile kesinleşti

- **Başlatma:** `<KOK>\current` çözülür → `<sürüm>\runtime\node.exe <sürüm>\dist\server.js`, çalışma dizini `<sürüm>`. `<KOK>\yapilandirma\.env` yoksa node BAŞLATILMAZ (çıkış 12; konak dosyayı OKUMAZ, yalnız varlığını ölçer). Ortam = hizmet ortamı + `TEKSERP_KOK=<KOK>` · `TEKSERP_HIZMET_ADI=TeksERP-Backend` · `TEKSERP_KAPANIS=stdin` · `NODE_ENV=production` · `NODE_USE_SYSTEM_CA=1` (Node açılışta okur, `.env`den gelirse etkisiz); **`NODE_OPTIONS` SİLİNİR** (yükleyici enjeksiyonu). stdin = boru; stdout → `logs\backend-out.log`, stderr → `logs\backend-err.log` (satır başı RFC 3339 yerel saat + ofset, ms; 10 MB × 14, eskiler gzip; yazım hatası çocuğu bloklamaz — satır düşer, sayılır). Ortam DEĞERİ günlüğe yazılmaz (yalnız anahtar adları).
- **Doğrulama kipi:** hizmet `--dogrulama` başlatma argümanıyla başlatılırsa (güncelleyici §8.6'da böyle başlatır) ortama `HOST=127.0.0.1` ve `TEKSERP_DOGRULAMA_KIPI=1` eklenir (`.env` bunları ezmez: dotenv var olanı değiştirmez). **Backend (D7, `src/lib/dogrulama-kipi.ts`):** kip yalnız `"1"`; HOST `127.0.0.1`e ZORLANIR; zamanlayıcıyla tekrarlayan ya da dışarı konuşan işler BAŞLAMAZ (denetim arşivi · gece yedeği · makine dışı yedek · mDNS · TCMB kuru · vardiya takvimi/karnesi · lisans kapı zili · patron bulutu), tek seferlik idempotent açılış uzlaştırmaları KOŞAR (izin/rol kataloğu · kurulum kimliği · süperadmin kaydı · profil · varsayılan depo — doğrulama tam da bunları ölçer); lisans motoru YEREL ölçümü (kimlik → DB olguları → parmak izi → bütünlük) bitirip `CALISIYOR`a çıkar ama satıcıya yoklama zamanlamaz; niyet yazılmaz. Bekçi `test_dogrulama_kipi` `server.ts`teki her `start*` çağrısını iki listeye karşı iki yönlü ölçer.
- **Durdurma:** SCM `STOP`/`PRESHUTDOWN` → stdin'e `kapat\n` + boru kapanır; backend `gracefulShutdown` yolunu koşar (D3: ≤ 5,3 sn); konak 15 sn bekler (SCM'e `STOP_PENDING` + bekleme ipucu), çıkmazsa sonlandırır.
- **Çıkış kodları (hizmete özgü, SCM kurtarmasını tetikler; konak döngü KURMAZ):** `0` istenen durdurma · `10` node beklenmedik çıktı · `11` node başlatılamadı (`runtime\node.exe`/`dist\server.js` yok) · `12` `.env` yok · `13` iş nesnesi kurulamadı · `14` `current` çözülemedi ya da sürümler dışını gösteriyor. Node'un kendi kodu (ör. korumalı yükleyicinin `78`i) `logs\hizmet.log`a ve olay günlüğüne yazılır.

### §4.4 Erişim denetimi (ACL) ve güvenilmez dizinler — D3 uygular

| Yol | SYSTEM · Administrators | `NT SERVICE\TeksERP-Backend` |
|---|---|---|
| `<KOK>` (kök) · `surumler\` (+ `current` üzerinden) · `mobil-guncelleme\` · `rclone\` | Tam | Okuma + Yürütme |
| `yapilandirma\` · `yedek-anahtar\` | Tam | Okuma |
| `lisans\` · `backups\` · `logs\` · `veri\` | Tam | Değiştirme |
| `guncelleyici\` · `pg-setup\` · `pgsql\` · `pgveri\` | Tam (PG dizinleri D4) | — |
| `%ProgramData%\TeksERP\guncelleme\niyet\` | Tam | Değiştirme |
| `%ProgramData%\TeksERP\guncelleme\durum\` | Tam | Okuma |
| `%ProgramData%\TeksERP\guncelleme\is\` | Tam — korumalı DACL'i güncelleyici her turda kendisi uygular | — |

İki IPC dosyası AYRI dizinlerdedir: aynı dizinde "niyet yazılabilir / durum salt okunur" atomik yeniden adlandırmayla kurulamaz (yeni dosya dizinin mirasını alır). **Güvenilmez dizin kuralı (D3):** backend'in yazabildiği dizinler (`lisans\` · `backups\` · `logs\` · `veri\` · `guncelleme\niyet\`) SYSTEM'in gözünde güvenilmez girdidir — güncelleyici oralara YAZMAZ, oradan okurken bağlantı izlemez ve boyu sınırlar (§6.5); kendi günlüğü, yedeği ve anahtarı backend'in erişemediği dizinlerdedir.

## §5 IPC — niyet · durum · geçmiş

Genel: UTF-8 (BOM'suz) JSON; yazan taraf `<ad>.tmp`e yazar, diske boşaltır (`FlushFileBuffers`) ve `<ad>`ın üstüne yeniden adlandırır — okuyan yarım dosya görmez. Zaman damgaları UTC ISO-8601 (`Z`). Alan adları Türkçe; tanınmayan alan yok sayılır (ileri uyum).

### §5.1 `niyet\niyet.json` — backend yazar, güncelleyici okur (YETKİ DEĞİL, sözleşme §3 madde 2)

```json
{
  "v": 1,
  "yazildi": "2026-10-01T20:00:00Z",
  "indirme": { "belirtec": "<JWS tekserp-indirme, yolOneki /<kanal>/backend/>", "bitis": "2026-10-01T21:05:00Z" },
  "onay": { "onayId": "…uuid", "surum": "2.13.0", "zamanlama": "HEMEN", "kullaniciId": "…uuid", "ad": "Ayşe Y.", "zaman": "2026-10-01T19:58:00Z" }
}
```

- `indirme`: kiranın yoklamasıyla gelen İNDİRME belirteci (`X-TKL-Indirme` başlığıyla sunulur, Worker doğrular). Aday (`son.json` · `<hedef>/surum.json`), paket ve PG künyesi/paketi bu belirteçle iner — OTOMATİK kipte de gereklidir: backend belirteci süresi dolmadan tazeleyip niyeti yeniden yazar. Yoksa `BELIRTEC_YOK`, süresi geçmişse `BELIRTEC_SURESI_DOLDU` (güncelleyici bekler).
- `onay`: panel "Şimdi kur" (`HEMEN`) · "Pencerede kur" (`PENCERE`); izin ve denetim satırı backend'de. Karar girdisi yalnız `{surum, zamanlama}`dır (sözleşme §3 madde 3): onay yalnız AYNI sürüm için sayılır, DONDUR'u ve K1'i açamaz. `onayId` her yeni insan kararında YENİDİR (backend'in onay kaydı kimliği); `kullaniciId` · `ad` · `zaman` yalnız geçmiş satırına geçer.
- **Yeniden deneme kuralı:** `GERI_DONDU` ile biten sürüm kendiliğinden yeniden denenmez (her gece dur-yedekle-geri dön döngüsü olmasın); aynı sürüme `onayId`si farklı bir onay gelirse denenir. `HATA` (geri alınamadı) sonrası YENİ bir onay gelene dek hiçbir işlem başlatılmaz (`durum: HATA`, `hataKodu: INSAN_GEREKIYOR`).
- Biçimsiz ya da bağlantı olan niyet yok sayılır (belirteç ve onay yokmuş gibi; belirteç gerekince `NIYET_BICIMSIZ`).
- **Backend yazıcısı (D7, `src/services/update-intent.service.ts` — dosyanın TEK yazarı):** niyet her yazımda iki girdinin BUGÜNKÜ hâlinden kurulur — bellekteki `/<kanal>/backend/` belirteci (`bitis` = belirtecin `exp`i; yeniden başlatmada ilk yoklamaya dek niyetteki süresi geçmemiş belirteç korunur, süresi geçen korunmaz; güncelleme donuksa (K1) hiçbiri) + yürürlükteki onay (`update_approvals`ın en son satırı; `GERI_AL`sa `onay: null`). Tetik: her kabul edilen kira yanıtı (yoklama saatlik, belirteç ≤ 70 dk) ve her onay kararı; süreç içinde yazımlar SIRALI. Şema KATI (`UpdaterIntentSchema`, tanınmayan anahtar yazılamaz; belirteç yalnız JWS karakterleri, ad tek satır ≤ 200); yazım `niyet.json.tmp` (yalnız yeni dosya) → `fsync` → `niyet.json` üstüne yeniden adlandırma (Windows'ta okuyucu açık tutuyorsa kısa yeniden deneme); `niyet\` dizini yoksa ya da dizin/dosya bağlantıysa YAZILMAZ. Değerlerde yol · komut · adres · dosya adı YOK (bekçi değerlerde `/` `\` arar).

### §5.2 `durum\durum.json` — güncelleyici yazar (her turda), backend okur

```json
{
  "v": 1, "zaman": "2026-10-01T23:05:12.000Z", "sonCanlilik": "2026-10-01T23:05:12.000Z", "canlilikEsigiSn": 180,
  "turSn": 60, "guncelleyiciSurum": "0.1.0",
  "kuruluSurum": "2.12.4", "durum": "HAZIR",
  "surum": "2.13.0", "kaynakSurum": "2.12.4", "urun": null, "islemId": null, "adim": null,
  "hataKodu": null, "mesaj": "2.13.0 hazır; PENCERE_BEKLIYOR", "ilerleme": null, "planlanan": "2026-10-01T23:00:00Z",
  "politika": { "kip": "OTOMATIK", "izin": true, "neden": null, "kaynak": "KIRA", "hedefSurum": null, "donuk": false },
  "karar": { "karar": "PENCERE_BEKLIYOR", "neden": null, "aralik": { "baslangic": "…", "bitis": "…" }, "pgGuncellemesi": false },
  "bekleyen": { "surum": "2.13.0", "karar": "PENCERE_BEKLIYOR", "neden": null, "aralik": { … }, "pgGuncellemesi": false, "zorunlu": false, "ozet": "…" },
  "son": { "kayitId": "…uuid", "hedefSurum": "2.12.4", "kaynakSurum": "2.12.3", "sonuc": "BASARILI", "kod": null, "baslangic": "…", "bitis": "…", "veriGeriYuklendi": false },
  "sonAyrinti": { "urun": "backend", "hataKodu": null, "mesaj": null }
}
```

- **Kalp atışı:** `sonCanlilik` her turun sonunda (turlar arası ≤ `turSn`) ve işlem/indirme ilerledikçe yazılır — değişen bir şey olmasa da; güncelleyici durmuşsa dosya kalır ama damga eskir. `canlilikEsigiSn` o durumda iki atış arasının en uzun beklenen süresidir (boşta 3 × `turSn`; `INDIRILIYOR` + 10 dk; `UYGULANIYOR` en uzun adımın zaman aşımı + 5 dk). Backend: `şimdi − sonCanlilik ≤ canlilikEsigiSn` ⇒ `CALISIYOR`, aşılırsa `OLCULEMEDI`; `durum: HATA` ⇒ `DURDU` (dosya yok ⇒ `YOK`).
- **Kesin alanlar (tek kaynak — TS aynası):** `karar` = `decideUpdate`in çıktısı (aday olsun olmasın: `DONDURULDU/KIRA_YOK` gibi adaysız kararlar da); `bekleyen` = en yeni adayın kararı (yoklama raporunun `bekleyen`i `{surum, karar, neden}` buradan AYNEN; aday geri dönmüş sürümse ve yeni onay yoksa `karar` ne derse desin `ONAY_BEKLIYOR` — o sürüm ancak yeni onayla denenir); `son` = son TAMAMLANAN deneme, `UpdateResultSchema` ile BİREBİR (KATI; rapora aynen gider — başarısız PG adımı da bir denemenin sonucudur: `hedefSurum` = backend adayı, `kod: PG_GUNCELLEME_HATASI`); `sonAyrinti` = iç kod + ileti (panel/destek).
- **Geriye uyumlu alanlar** (backend okuyucusu `updater-ipc.ts` `UpdaterStatusDocSchema`, sözleşme sürümü 3): `durum` · `surum` (aday ya da süren işlemin hedefi; PG adımında backend adayı) · `kaynakSurum` · `kuruluSurum` · `adim` (`GERI_DON:<adım>` geri almada) · `hataKodu` · `mesaj` (≤ 400 karakter; okuyucu 500'den uzununu dosyayla birlikte reddeder) · `ilerleme` · `planlanan` · `politika{kip, izin, neden}` (karar DONDURULDU/UYGUN_DEGIL ise `izin: false`, `neden` okuyucunun sözlüğünden: `POLITIKA_DONDUR` · `YAPTIRIM_DONUK` · `KIRA_YOK` · UYGUN_DEGIL'de nedenin kendisi) · `guncelleyiciSurum` · `zaman`. Backend eşlemesi `bekleyen`/`son`u doğrudan okuyabilir (§13 D1).
- `hataKodu`/`mesaj` ŞU ANKİ sorundur (indirme · doğrulama · kira · ayar); sonuçların kodu `son`da. `mesaj` Türkçe, insan içindir, sır taşımaz.

| `durum` | Anlamı |
|---|---|
| `BEKLIYOR` | İş yok ya da karar engelliyor (`karar`), ya da bir sorun var (`hataKodu`) |
| `INDIRILIYOR` | Aday doğrulandı, paket iniyor (`ilerleme`) ya da ağ hatasıyla sürdürülecek |
| `HAZIR` | Paket(ler) doğrulandı ve açıldı; karar `ONAY_BEKLIYOR` ya da `PENCERE_BEKLIYOR` (`planlanan` = sıradaki aralığın başı) |
| `UYGULANIYOR` | İşlem sürüyor (`urun` · `islemId` · `adim`) |
| `BASARILI` | Son deneme bu kurulumun sürümüne başarıyla geçti ve yeni iş yok |
| `GERI_DONDU` | Aday, geri dönmüş sürümdür ve yeni onay bekler (`son`) |
| `HATA` | Geri dönüş de TAMAMLANAMADI — İNSAN gerekir (`INSAN_GEREKIYOR`); olay günlüğüne hata düşer |

### §5.3 `durum\gecmis.jsonl` — güncelleyici ekler (panelin "geçmiş"i)

Her SONUÇLANAN işlem için bir satır: `{v:1, islemId, onayId, urun: backend|pg, hedefBackend? (PG satırında), kaynakSurum, surum, sonuc: BASARILI|GERI_DONDU|HATA, hataKodu (raporun belgeli kodu), ayrintiKodu (iç kod), veriGeriYuklendi, basladi, bitti, gocSayisi: {once, sonra}, yedek, onay}`. 1000 satırı aşınca en eskisi atılır (kopya + yeniden adlandırma).

## §6 Güven modeli — güncelleyici neye güvenir

Güncelleyici SYSTEM'dir; backend düşük yetkilidir. Yetki yalnız satıcı imzalı veriden gelir (sözleşme §3 madde 1); her doğrulama lisans çekirdeğiyle AYNI koddur (`tekserp-dogrulama`) ve gömülü çapa da aynıdır: ikili TEK kipin kök + PAKET anahtarlarını taşır (G3 — özelliksiz derleme ÜRETİM, `hazirlik-capasi` HAZIRLIK; künye `capaKipi`), öteki kipin imzalı kirası/bildirimi/paketi `KOK_BILINMIYOR`/`JWS_KID` alır (`tests/capa_kipi.rs`, iki kipte). Paket güncelleyiciyi paketin (bayt kodunun) kipinde taşır: `paketle.ps1` künyeyi kıyaslar, CI kipi bayt kodu künyesinden seçer ve sözleşmenin TS aynası `tekserp-guncelleyici/src/{release,decision}.rs` D1'in vektörleriyle ölçülür (`tests/sozlesme_vektorleri.rs`; kiranın `guncelleme` şeması `tekserp-dogrulama/tests/guncelleme_kira.rs`).

### §6.1 Kendi ayarı — `<KOK>\guncelleyici\ayar.json` (yalnız SYSTEM/Administrators yazar)

`{v:1, guncellemeSunucusu: "https://…", vekil: null | "http://host:port", backendHizmeti?: "TeksERP-Backend-<kanal>", saglikZamanAsimiSn: 180, durdurmaZamanAsimiSn: 60, gocZamanAsimiSn: 1800, yedekZamanAsimiSn: 3600, turAraligiSn: 60}`. `guncellemeSunucusu` ZORUNLU ve yalnız `https://` (test derlemesinde `http://127.0.0.1`); niyet başka bir sunucuya yönlendiremez. `backendHizmeti` yoksa `TeksERP-Backend` (biçimsizse `AYAR_BICIMSIZ`, hiçbir şey yapılmaz).

### §6.2 Kira ve HAK (yetki kaynağı)

`LICENSE_DIR`deki `kira.jws` gömülü kök çapasıyla zincirden doğrulanır (`chain::verify_lease`); kira şeması `guncelleme` politikasını da ölçer (TS `LeaseSchema` aynası: biçimsiz politika = bozuk kira). Etkin politika sözleşme §2'dir: kira yoksa ya da `bitis + 10 dk` geçtiyse YETKİ YOK (`DONDURULDU/KIRA_YOK`; lisans ek süresi güncelleme açmaz), alan yoksa `ONAYLI`; `yaptirim.guncellemeDonuk` her kipi ve onayı ezer. Kira silinerek dondurma atlatılamaz (kira yoksa güncelleme yok). `hak.jws` doğrulanıp kiraya bağlanırsa `bakimBitis` (`BAKIM_DISI` · `HAK_YOK`) ve `sinif` (§6.3 anahtar süzgeci) ondan gelir.

### §6.3 Aday — işaretçi → sürüm bildirimi (sözleşme §1.2–§1.4)

- Yol: sabitleme yoksa `/<kanal>/backend/son.json`, varsa `/<kanal>/backend/<hedefSurum>/surum.json`; kanal kiranın `kanal.kod`u. İşaretçinin kendisine güvenilmez: KATI `{v, bildirim}`, ≤ 64 KB.
- Doğrulama sırası TS ile aynı: JWS (typ `tekserp-surum` · kid · imza) → şema (`BELGE_SURUM` · `BELGE_SEMA`) → imzalayan = `paketImzaKid` (`SURUM_ANAHTAR`) → kanal (`SURUM_KANAL`). Hata kodu `durum.hataKodu`na olduğu gibi yazılır.
- **Anahtar kümesi:** gömülü PAKET anahtarları, hazırlık anahtarı (`paket-hazirlik*`) yalnız HAK sınıfı TEST/DEMO iken; sınıf bilinmiyorsa dışarıda (`JWS_KID`). Aynı küme bütünlük listesi ve PG künyesi için de kullanılır.
- Doğrulanmış aday 5 dk bellekte tutulur; uygulamadan hemen önce (1 dk'dan eskiyse) yeniden indirilip doğrulanır ve karar yeniden verilir — aday değiştiyse uygulama o turda başlamaz.

### §6.4 Paket (sözleşme §1.5)

Önce boş disk (≥ paket × 3 + 2 GB, `DISK_DOLU`), sonra `/<kanal>/backend/<surum>/<paket.ad>` sürdürülebilir iner; boy + sha256 (küçük harf hex) bildirimle EŞİT olmadan zip AÇILMAZ (`PAKET_OZETI`, parça silinir). Açma yalnız `surumler\.hazirlik-<surum>`e ve yalnız göreli yollarla (`PAKET_YOL`; sembolik bağ girdisi RED). `butunluk.jws` aynı anahtar kümesiyle ve dosya listesi GEÇERLİ olmalı (`BUTUNLUK_GECERSIZ`); künye bildirimle BAĞLANMALI (`checkPackageBinding`: imzalayan · `paketId` · `urun` · `surum` · `derlemeTarihi` · müşteri null ya da kanal — `PAKET_BAGI`). Kesin paket hatasında (özet · yol · bütünlük · bağ) aynı paket 15 dk × 4ⁿ (≤ 24 sa) yeniden indirilmez (`is\ertele.json`, `INDIRME_ERTELENDI`).

### §6.5 Güvenilmez girdi (D3 güvenlik kuralı)

Backend'in yazabildiği ya da okuyabildiği dizinlerden okunan her dosya (`lisans\kira.jws` · `hak.jws` · `guncelleme\niyet\niyet.json` · `yapilandirma\.env` · `<PGDATA>\PG_VERSION`) şöyle okunur: dosya da üst dizini de bağlantı (junction/sembolik bağ) OLAMAZ, düz dosya olmalı, boy tavanı var (JWS/niyet 64 KB, `.env` 256 KB), Windows'ta tutamaç `FILE_FLAG_OPEN_REPARSE_POINT` ile açılır ve açılan tutamaç yeniden ölçülür; hata iletisi içerikten beslenmez. SYSTEM yazdığı hiçbir dosyayı backend'in yazabildiği dizine koymaz; ekleme yaptığı `kurulum-gecmisi.jsonl` bir bağlantıysa yazmaz. Çocuk araçların ortamından `NODE_OPTIONS` silinir; göç ve araçlar `.env`i `DOTENV_CONFIG_PATH`ten okur (sırlar ortama kopyalanmaz).

**Bilinen sınır:** kira kurulum kimliğine (parmak izi) güncelleyicide bağlanmaz — başka bir kurulumun kirası ancak aynı kanalın belirteciyle birlikte işe yarar ve yalnız o kanalın imzalı sürümünü kurdurur.

## §7 Durum makinesi ve çökme güvenliği

- **İşlem günlüğü** `is\islem.jsonl`: her adımın BAŞLADI satırı adım ÇALIŞMADAN önce, BİTTİ satırı adım bittikten sonra yazılır; her satır `FlushFileBuffers` ile diske iner. Satır: `{sira, islemId, adim, olay: ISLEM|BASLADI|BITTI|HATA|TELAFI_BASLADI|TELAFI_BITTI|SONUC, zaman, veri}`. ISLEM satırı PLANI taşır (önceki `current` hedefi, göç sayısı öncesi, lisans görüntüsü, onay…) ki yeniden başlayan süreç yeniden HESAPLAMASIN; `TELAFI_BITTI` telafinin sonucunu taşır (`GOC`: `geriYuklendi`).
- **Açılış:** son işlem SONUÇ satırı taşımıyorsa YARIM işlemdir → §8'deki "yarımda" sütunu: DEVAM (adım yeniden koşulur — her adım tekrarlanabilir) ya da GERİ AL (telafiler ters sırada; her telafi tekrarlanabilir). Geri alma da yarım kalabilir; açılış onu da sürdürür. Yarım satır (yırtık yazım) okunurken atılır.
- **Değişmez:** her son durumda (`BASARILI` · `GERI_DONDU`) backend TEK süreçtir ve `current`in gösterdiği sürümle DB şeması uyumludur: `BASARILI` ⇒ `current` → yeni + göç uygulandı; `GERI_DONDU` ⇒ `current` → eski + DB işlem öncesi hâlinde (göç başladıysa yedekten geri yüklendi). Bunu sağlayamayan tek son durum `HATA`dır (insan).
- **Kilit:** tek güncelleyici süreci — `is\kilit` dosyası paylaşımsız açık tutulur; ikinci süreç (elle koşulan CLI dahil) `KILIT_DOLU` ile çıkar.

## §8 Tur ve backend güncellemesinin adımları

**§8.0 Tur** (`turSn`, varsayılan 60 sn): yarım işlem varsa ÖNCE o sürdürülür → kira + HAK (§6.2) → adaysız karar (`DONDURULDU` · `KURULU_SURUM_BICIMSIZ` · `HEDEF_ULASILDI` ağa çıkmadan biter) → aday (§6.3) → karar (PG yalnız karar ona gelirse ölçülür) → `KUR` · `ONAY_BEKLIYOR` · `PENCERE_BEKLIYOR` ise disk + hazırlık (§6.4; PG gerekiyorsa §9 hazırlığı) → `HAZIR` → karar `KUR` ise aday tazelenir ve uygulanır (önce PG, sonra backend). Başlamış uygulama pencere kapansa da biter ya da geri döner (sözleşme §3 madde 5).

| # | Adım (`adim`) | İş | Telafi (GERİ AL) | Yarımda (açılış) |
|---|---|---|---|---|
| 1 | `BACKEND_DURDUR` | `TeksERP-Backend` durdur (≤ `durdurmaZamanAsimiSn`); plan (önceki hedef, göç sayısı, lisans görüntüsü) backend ÇALIŞIRKEN ölçülüp ISLEM satırına yazılmıştır | backend'i ESKİ `current` ile başlat + sağlık | DEVAM |
| 2 | `YEDEK` | backend DURMUŞKEN `pg_dump -Fc` → `pg_restore --list` → `yedek-sifrele sifrele` (alıcılar: `yedek-anahtar\*.tkpub` + işleme özgü GEÇİCİ anahtar, §8.3) → düz döküm silinir; sonuç `is\yedek\<islemId>\db.dump.tkenc` | — | DEVAM (yeniden al) |
| 3 | `GECIS` | `current` → `surumler\<yeni>` | `current` → önceki hedef | DEVAM |
| 4 | `GOC` | `<yeni>\runtime\node.exe node_modules\prisma\build\index.js migrate deploy` (çalışma dizini `<yeni>`; ortam `DOTENV_CONFIG_PATH=<KOK>\yapilandirma\.env` + `NODE_ENV=production`) → göç sayısı (sonra) | göç DB'yi değiştirdiyse (bitmiş ya da toplam satır sayısı farklı; ölçülemezse değiştirmiş sayılır): yedek aracıyla geçici anahtardan çöz → `public` şeması sıfırlanır → `pg_restore` → göç sayısı = önceki | GERİ AL |
| 5 | `DOGRULAMA` | backend'i `--dogrulama` ile başlat (yalnız 127.0.0.1) → sağlık (§8.7) | backend'i durdur | DEVAM (yeniden doğrula) |
| 6 | `BASLAT` | durdur → normal başlat → sağlık (sürüm + DB) | backend'i durdur | DEVAM |
| 7 | `ONAY` | SONUÇ=BASARILI · `kurulum-gecmisi.jsonl` · `gecmis.jsonl` · eski sürüm dizinlerini buda (`current` + bir önceki kalır) · eski yedekleri buda (son 3) · kendini güncelleme denetimi (§10) | — | DEVAM |

- **§8.3 Geçici yedek anahtarı (yer: `is\anahtar\<islemId>\`, yedek: `is\yedek\<islemId>\` — backend ERİŞEMEZ):** mevcut `.tkenc` yerel anahtarı YEDEK PAROLASIYLA sarılıdır — sunucu kendi yedeğini gözetimsiz ÇÖZEMEZ. Otomatik geri dönüş için güncelleyici her işlemde paketteki araçla (`yedek-sifrele anahtar-uret --ad guncelleme --dizin <is> --ozel-cikti <dosya>`) bir X25519 çifti üretir, özel yarıyı DPAPI (SYSTEM kapsamı) ile sarar ve düzünü siler; yedek hem kurulumun kendi alıcılarına hem bu anahtara şifrelenir (`--alici` tekrarlı). Müşteri anahtarı yedeği her zaman açar; geçici anahtar yalnız bu sunucuda ve bir sonraki başarılı işleme kadar yaşar. `yedek-anahtar\` boşsa yedek yalnız geçici anahtara şifrelenir.
- **§8.5 Göç:** SİSTEM node'u DEĞİL, sürümün kendi `runtime\node.exe`si. Göç sayısı iki değerle ölçülür (`<PG_BIN_DIR>\psql.exe`): bitmiş (bugünkü `kur.ps1` sorgusu: `finished_at IS NOT NULL AND rolled_back_at IS NULL`) + TOPLAM satır (başlamış ama bitmemiş göç de görünsün); ölçülemezse "göç BAŞLADI ve bilinmiyor" sayılır (geri dönüşte DB geri yüklenir). `migrate deploy` 30 dk'dan uzun sürerse süreç ağacı sonlandırılır → geri dönüş. Geri yükleme veritabanını ve DB düzeyi ayarlarını (`teks.*`) KORUR: yalnız `public` şeması sıfırlanıp döküm aynı rolle geri yüklenir (`pg_restore`un bilinen zararsız hataları — `schema "public" already exists`, `must be owner of extension plpgsql` — yok sayılır, başarının ölçüsü göç sayısıdır). Rol DB sahibi olmalı (D4: `tekserp` sahip; `BACKUP_PG_USER` = bakım rolü `tekserp` üyesi).
- **§8.6 İki aşamalı başlatma:** doğrulama başlatması (5) istemcilere kapalıdır; bu yüzden sağlık düşerse DB'yi yedekten geri yüklemek istemci yazısı KAYBETTİRMEZ. Normal başlatmadan (6) sonra geri dönüş gerekirse aradaki kısa pencerenin yazısı kaybolabilir — adım 6 yalnız "sürüm + DB" bakar ve doğrulamadan geçmiş aynı ikiliyle koşar.
- **§8.7 Sağlık:** `GET http://127.0.0.1:<PORT>/health/yerel` (sözleşme 4; 5 sn istek zaman aşımı, 2 sn aralık, toplam `saglikZamanAsimiSn`): HTTP 200 · `status = UP` · `db = UP` · `version = <yeni surum>` · `lisans: {kip, butunluk, cekirdek}`. **Neden ayrı yol:** public `/health`in alan kümesi DONMUŞTUR (F-CORE-GUV-002; `test_discovery_identity` §4) — lisans kademesi, bütünlük ve çekirdek kaynağı kimliksiz bir LAN istemcisine söylenmez. `/health/yerel` yalnız döngü adresinden DOĞRUDAN gelen isteğe cevap verir (vekil başlığı — `X-Forwarded-For` · `Forwarded` · `X-Real-IP` · `Via` · `X-Forwarded-Host` · beyanlı `CLIENT_IP_HEADER` — taşıyan istek döngüden gelse de yerel sayılmaz: aynı makinedeki bir ters vekil LAN isteğini döngüden iletir); dışarıya 404. Değerler: `kip` = UYGULANAN kademe (`NORMAL · UYARI · EK_SURE · KISITLI · DURDURULMUS`), `butunluk` = `GECERLI · GECERSIZ · OLCULEMEDI · KAPSAM_DISI`, `cekirdek` = `native · ts · yok`. `lisans` motor YEREL ölçümünü bitirmeden (bütünlük dahil) YOKTUR — yarım ölçüm ("bütünlük ölçülemedi") kötüleşme sanılıp geri döndürmesin, güncelleyici beklemeye devam eder. Güncelleyici yeni sürümde bu alanı ZORUNLU sayar (yoksa `SAGLIK_LISANS_OLCULEMEDI`) ve işlem öncesi görüntüden KÖTÜ olamaz: `butunluk` önce `GECERLI` idiyse sonra da `GECERLI`, `cekirdek` önce `native` idiyse sonra da `native`, `kip` önce `KISITLI`/`DURDURULMUS` değilken sonra o olamaz. ⚠️ **D2'ye iş:** `health::url` `/health` → `/health/yerel` (bugünkü `/health` lisans TAŞIMAZ; değişmezse her doğrulama `SAGLIK_LISANS_OLCULEMEDI` ile geri döner — güvenli yön ama güncelleme hiç tamamlanmaz). İşlem öncesi görüntü de aynı yoldan alınır; eski sürüm (2.13.x) bu yolu bilmez → `license_before` yok → yalnız mutlak kural (GECERSIZ değil) uygulanır.
- **§8.8 Kurulum kaydı:** `<KOK>\kurulum-gecmisi.jsonl`e `kur.ps1` ile birebir biçim (`InstallRecordSchema`): `tur` KURULUM (başarı) · GERI_ALMA (geri dönüş sonrası, `oncekiSurum` yeni, `yeniSurum` eski) · `damga` = işlem başlangıcı `yyyyMMdd_HHmmss` · `paketOzeti` = bildirimin `paket.sha256`sı · `commit` = bildirimin `commit`i · `geriDonus {kod: true, veri: true, veriSifreli: true}` · `kayitId` işlemden türetilir (yeniden koşulan ONAY aynı kaydı yazar).

## §9 PostgreSQL küçük sürümü (sözleşme §1.6 · D4 `KENDI-POSTGRESQL.md` §5 U0–U11)

**Koşul — karardan:** `pgGuncellemesi: true` (kendi örnek, bildirimin `pg.hedef` (sürüm, derleme) kuruludan yeni). Kurulu PG: kip `pgsql\ornek.json`dan (`kendi` · `harici`; dosya YOKSA harici sayılır — bugünkü kurulumlar), sürüm her koşumda `SHOW server_version`dan (`ana.küçük`), kendi kipte derleme `ornek.json`dan; ölçülemezse `UYGUN_DEGIL/PG_OLCULEMEDI`. Ana sürüm bildirimin `cizgi`si değilse `UYGUN_DEGIL/PG_ANA_SURUM` (hiçbir kipte otomatik değil; ayrıca veri dizini `PG_VERSION` ≠ çizgi ⇒ `PG_BUYUK_SURUM`). Harici kipte PG'ye DOKUNULMAZ; yalnız `enAz` (altındaysa `UYGUN_DEGIL/PG_SURUMU_ESKI`). Aynı koşuda PG adımı backend'den ÖNCE gelir; PG işlemi `GERI_DONDU`/`HATA` ise backend'e dokunulmaz.

- **Hazırlık (canlı sisteme dokunmaz — U0–U2):** künye `/<kanal>/backend/pg/<surum>-<derleme>/pg.json` (işaretçi `{v, bildirim}`) → `tekserp-pg` doğrulaması (aynı anahtar kümesi) → `checkPgBinding(bildirim.pg, künye)` (`PG_BAGI`) → aynı dizindeki `<paket.ad>` boy + sha256 (hex) ile iner → `pgsql\.hazirlik-<surum>-<derleme>`e açılır → her dosya `TEKSERP-ICERIK.sha256`ya, o da künyenin `icerikSha256`sına karşı ölçülür, listede olmayan dosya RED → `bin\icuuc<N>.dll` = künyenin `icuSurum`u → `bin\postgres.exe --version` = hedef sürüm → `pgsql\<surum>-<derleme>`e yeniden adlandırılır. Hata `PG_PAKET` (ertelemeli, §6.4).
- **Uygulama (işlem günlüğüyle, `urun: pg`, plan `hedefBackend` = backend adayı):**

| # | Adım (`adim`) | İş | Telafi (GERİ AL) | Yarımda |
|---|---|---|---|---|
| U3 | `PG_YEDEK` | §8.3'teki şifreli yedek, ESKİ `bin` ile | — | DEVAM |
| U4 | `BACKEND_DURDUR` | backend'i durdur | backend'i başlat + sağlık | DEVAM |
| U5 | `PG_DURDUR` | `TeksERP-PostgreSQL` durdur; `postmaster.pid` kalmadığını ölç | PG'yi (eski yolla) başlat → `SHOW server_version` = eski → ICU adımı başlamışsa eski ikililerle U9 | DEVAM |
| U6 | `PG_YOL` | hizmetin ImagePath'indeki `<eski>` dizini → `<yeni>` (geri okunur) | ImagePath → `<eski>` | DEVAM |
| U7 | `PG_BAGLANTI` | `pgsql\bin` junction → `<yeni>\bin` (hedef ölçülür) | junction → `<eski>\bin` | DEVAM |
| U8 | `PG_BASLAT` | başlat → hazır → `SHOW server_version` = yeni | PG'yi durdur | DEVAM |
| U9 | `PG_ICU` | ICU sürümü değiştiyse (`icuuc<N>.dll` eski ≠ yeni): ICU collation'a bağlı index'ler katalogdan bulunur → `REINDEX INDEX` → `ALTER COLLATION … REFRESH VERSION` | (U5'in telafisinde yeniden) | DEVAM |
| U10 | `BACKEND_BASLAT` | backend'i başlat → sağlık (§8.7) | backend'i durdur | DEVAM |
| U11 | `ONAY` | `ornek.json`: yeni sürüm + `oncekiIkiliDizin = <eski>`; bir önceki dizin KALIR, daha eskiler silinir | — | DEVAM |

Küçük sürüm veri dizinini değiştirmez: telafide DB geri yüklemesi YOKTUR (yalnız veri bozulması şüphesinde, insan kararı). Büyük sürüm geçişi OTOMATİK DEĞİLDİR (D4 runbook'u).

## §10 Kendini güncelleme

Paket `runtime\tekserp-guncelleyici.exe` taşır. Backend işlemi `BASARILI` olunca, paketteki ikilinin sürümü çalışanınkinden büyükse: `guncelleyici\tekserp-guncelleyici.yeni.exe`ye kopyalanır → `.yeni.exe kunye` çalıştırılır (0 ve beklenen ad/sürüm dönmeli; çapa kipi (`capaKipi`) çalışanınkiyle AYNI olmalı — kendini güncelleme hazırlık ↔ üretim arasında GEÇMEZ, öteki kipli ya da kipsiz aday yerleşmez, G3) → çalışan ikili `.eski.exe`ye, `.yeni.exe` asıl ada yeniden adlandırılır (çalışan exe yeniden adlandırılabilir) → hizmet `KENDI_GUNCELLEME` koduyla (20) çıkar, SCM kurtarması yeni ikiliyle başlatır. Yeni ikili İLK iş olarak bir açılış sayacı tutar (`is\kendi.json`): doğrulanmadan 3 açılışı aşarsa `.eski.exe`yi geri koyar ve çıkar (A/B); ilk sağlıklı turdan sonra `.eski.exe`yi siler. İki yeniden adlandırma arasında ölüm: eski ikili asıl adda kalır, yarım `.yeni.exe` sonraki açılışta silinir.

## §11 Günlük

- **Olay günlüğü** (Uygulama): kaynaklar `TeksERP-Guncelleyici` · `TeksERP-Backend`; `hizmet-kur` kaydeder. Bilgi: işlem başladı/bitti, sürüm; Uyarı: geri dönüş; Hata: `HATA` durumu, özel alan kurulamadı, konağın beklenmedik node çıkışı.
- **Dosya:** güncelleyici `<KOK>\guncelleyici\gunluk\guncelleyici.log` (UTC, 10 MB × 10) · konak `<KOK>\logs\hizmet.log` · node çıktısı `<KOK>\logs\backend-out.log` + `backend-err.log` (yerel saat + ofset, 10 MB × 14, gzip). Satır: `<zaman> <DÜZEY> <ileti>`; sır YOK (`.env` değerleri, belirteç, parolalar yazılmaz; araç çıktısındaki `şema://kullanıcı:parola@` maskelenir).

## §12 Kodlar

**`durum.hataKodu` (şu anki sorun):** `NIYET_BICIMSIZ` · `BELIRTEC_YOK` · `BELIRTEC_SURESI_DOLDU` · `KILIT_DOLU` · `AYAR_BICIMSIZ` · `AYAR_EKSIK` · `KURULU_SURUM_YOK` · `KIRA_YOK` · `KIRA_GECERSIZ` · `INSAN_GEREKIYOR` · `MANIFEST_INDIRILEMEDI` · `INDIRME_REDDEDILDI` · `INDIRME_HATASI` · `INDIRME_ERTELENDI` · `DISK_DOLU` · `PAKET_OZETI` · `PAKET_YOL` · `BUTUNLUK_GECERSIZ` · `PG_BUYUK_SURUM` · `PG_PAKET` · sözleşmenin kodları olduğu gibi (`SURUM_ISARETCI` · `SURUM_KANAL` · `SURUM_ANAHTAR` · `PAKET_BAGI` · `PG_BAGI` · `JWS_*` · `BELGE_SURUM` · `BELGE_SEMA`) · işlem sonrası o işlemin iç kodu. Karar nedenleri `karar.neden`de (sözleşme §3 madde 3), `hataKodu`na girmez.

**İşlem iç kodları (`sonAyrinti.hataKodu` · `gecmis.ayrintiKodu`) → rapor kodu (`son.kod` · `gecmis.hataKodu`, TS `UPDATE_RESULT_CODES`):**

| İç kod | Rapor kodu |
|---|---|
| `HIZMET_YOK` · `HIZMET_DURMADI` | `DURDURMA_HATASI` |
| `YEDEK_HATASI` | `YEDEK_HATASI` |
| `GECIS_HATASI` | `DOSYA_KILITLI` |
| `GOC_HATASI` · `GOC_ZAMAN_ASIMI` | `GOC_HATASI` |
| `HIZMET_BASLAMADI` | `BASLATMA_HATASI` |
| `SAGLIK_ZAMAN_ASIMI` · `SAGLIK_SURUM` · `SAGLIK_DB` · `SAGLIK_LISANS` · `SAGLIK_LISANS_OLCULEMEDI` | `SAGLIK_HATASI` |
| `PG_DURMADI` · `PG_BASLAMADI` · `PG_SURUM_UYUSMAZ` · `PG_ICU_HATASI` · `PG_YOL_HATASI` · `PG_PAKET` · `PG_BUYUK_SURUM` | `PG_GUNCELLEME_HATASI` |
| `GERI_YUKLEME_HATASI` · `GERI_DONUS_SAGLIKSIZ` | `GERI_DONUS_HATASI` |
| `KESINTI` (yarım göç açılışta geri alındı) | `KESINTI` |
| `DISK_DOLU` · `PAKET_OZETI` · `BUTUNLUK_GECERSIZ`/`PAKET_YOL` · `PAKET_BAGI`/`PG_BAGI` · imza/şema kodları · indirme kodları | aynı adlı ya da `BUTUNLUK_GECERSIZ` · `PAKET_BAGI` · `IMZA_GECERSIZ` · `INDIRME_HATASI` |
| `IC_HATA` ve tanınmayan | `BILINMEYEN` |

## §13 Diğer dilimlerin bu sözleşmeden işi

- **D1:** CEVAPLANDI — sözleşme sürüm 1–3 bu belgenin §0–§3'ü; güncelleyici onun Rust aynasıdır (vektörler D1 dalıyla BAYT-EŞİT kopya; D1 yeniden üretirse aynı dosya D2'nin cargo testinden de geçmeli — iniş sırası D1 → D2, kâhin §0h D1'in `belgeler.ts` desenlerini ister). AÇIK: backend eşlemesi (`update-status.service.ts`) `bekleyen`/`son`u `durum.json`dan doğrudan okuyabilir (kesin; PG denemesi dahil) — geriye uyumlu alanların sezgisel çevirisi o zaman gereksizleşir; `guncelleyici.durum` kalp atışından (§5.2: `sonCanlilik` + `canlilikEsigiSn`); ölçüldü: bu dalın motorunun yedi senaryodaki dosyaları bugünkü okuyucudan geçiyor, `son` birebir; onay ucu `POST /api/guncelleme/onay` §5.1 biçimini yazar (`onayId` = onay kaydı kimliği); paket `runtime\`e iki Rust ikilisini (`tekserp-hizmet.exe` · `tekserp-guncelleyici.exe`) koyar — `runtime` imzalı kapsamdadır.
- **D3:** CEVAPLANDI (dal `dagitim/d3-hizmet`: `hizmet-duzeni.ts` · stdin kapanışı · `backend-hizmeti.ps1`) — bu sözleşmeye alındı (§4.1–§4.4, §6.5). AÇIK: `TEKSERP_DOGRULAMA_KIPI` (arka plan işleri başlamaz) · `/health` döngü adresine `lisans{kip,butunluk,cekirdek}` · niyet yazıcısı (belirteç tazeleme + onay, §5.1) · `backend-hizmeti.ps1`: `-Uygula` sırası bugün izinler → kayıt (TERS: önce `tekserp-hizmet.exe hizmet-kur`, sonra izinler — §4.2) · kaydı `hizmet-kur`a bırakması · `durum.json`u `guncelleme\durum\` altında ölçmesi · `guncelleme\is\`i yasak sınıfa alması · `hizmet\` dizininin (konak `current\runtime\`de) düşmesi.
- **D4:** CEVAPLANDI (şartname `KENDI-POSTGRESQL.md`, dal `dagitim/d4-pg`): `pgsql\<surum>-<derleme>` + `pgsql\bin` junction + `ornek.json` bu sözleşmeye alındı (§4.1, §9); `PG_BIN_DIR = <KOK>\pgsql\bin`.
- **D5:** CEVAPLANDI (dal `dagitim/d5-kurulum`: `deploy/kurulum/` — Inno sihirbazı `tekserp-kurulum.iss` + aşama koşucusu `kurulum.ps1`, CI `kurulum-windows.yml`) — paketi KURULUMUN KENDİ güncelleyici ikilisiyle doğrular (`kurulum-paket` · `kurulum-pg` · `kurulum-dizin`; güncelleyiciyle aynı kod), `surumler\<v>` + `current`, iskelet `backend-hizmeti.ps1 -Uygula -YalnizIskelet` SIRDAN ÖNCE, `yapilandirma\.env` (sade biçim `KEY=değer`; ikinci kanalda `TEKSERP_GUNCELLEME_DIZINI`) + `pg-setup\db-credentials.json`, kayıt + ACL `backend-hizmeti.ps1 -Uygula`, güncelleyici `guncelleyici-hizmeti.ps1 -Uygula` (`ayar.json` `guncellemeSunucusu` cevaptan, zorunlu) — kurulum `hizmet-kur`u KENDİSİ çağırmaz (kayıt tek yerde: D6'nın iki betiği); kendi PG örneği `pgsql\ornek.json` `kip: "kendi"` (hizmet GERÇEK sürüm dizininden kaydedilir: ImagePath `ikiliDizin`i taşır); kurulum sağlığı `/health/yerel` (eski backend'de `/health`); ikinci kanal son eki (`-<kanal>`) güncelleyici · PG hizmeti · veri kökü (`%ProgramData%\TeksERP-<kanal>`) · gece yedeği görevi · mDNS kuralı · AppId adlarına geçer.
- **D6:** CEVAPLANDI (dal `dagitim/d6-gecis`: `deploy/gecis/gecis.ps1` + `gecis-yardimci.cjs`, runbook `docs/ops/GECIS-PM2-HIZMET.md`) — paket `app\`teki derlemenin AYNISI (veritabanına dokunulmaz; göç pm2 düzeninde `kur.ps1` ile) zipten `surumler\<surum>`e açılır, `current` kurulur, `app\.env` + ecosystem `env` → `yapilandirma\.env` (etkin değerler aynı; iki `.env` okuyucusunda aynı okunur), kayıt + ACL `backend-hizmeti.ps1` (§4.2 sırası), güncelleyici `guncelleyici-hizmeti.ps1`; `backups\` · `logs\` · `lisans\` · `yedek-anahtar\` · `kurulum-gecmisi.jsonl` yerinde; harici PG için `pgsql\ornek.json` `kip: "harici"` İSTEĞE BAĞLI (`-PgKaydiYaz`; yoksa güncelleyici zaten harici sayar). pm2 yolu geçiş dönemi boyunca dondu (çift yol).
- **D7:** CEVAPLANDI (dal `dagitim/d7-ekran`): eşleme doğrudan (§3.2) · onay ucu + niyet yazıcısı (§3.2, §5.1) · `/health/yerel` (§8.7) · doğrulama kipi (§4.3) · panel "Sistem → Sunucu Güncellemeleri" · satıcı bildirimi (`GUNCELLEME_TAMAMLANDI` · `GUNCELLEME_GERI_DONDU` · `GUNCELLEME_BASARISIZ`, defter satırıyla aynı tx'te bir kez). D2 kodu okundu (değiştirilmedi): onay yalnız imzalı adayla AYNI sürüme sayılır (`engine.rs` `used_approval`), sunucu adresi yalnız `ayar.json`dan (niyet yönlendiremez), niyet `read_untrusted` (64 KB, bağlantı izlenmez) + `validate`; tanınmayan niyet alanı yok sayılır. AÇIK (D2): `health::url` → `/health/yerel` (§8.7); HATA sonrası kilidi açan onay sürüme bağlı değil (yalnız yeni `onayId` arar) — panel onu yalnız son denemenin hedefi için sunar.
