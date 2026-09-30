# Güncelleyici — backend dağıtım sözleşmesi (Dağıtım v2)

> **Durum:** §1–§3 **DONMUŞ** (D1, 2026-09-30) — satıcı, backend, CF Worker ve Rust güncelleyici (D2) buna karşı yazılır. §4 ve sonrası (yerel dizin düzeni · yerel IPC/niyet ve durum dosyaları · durum makinesi · geri dönüş) **D2**'nin; bu belgeye eklenir.
>
> | Sözleşme sürümü | Ne zaman | Ne değişti |
> |---|---|---|
> | 1 | 2026-09-30, D1 ilk dondurma | bildirim `tekserp-surum`, kira `guncelleme`, karar, rapor, ortak vektörler |
> | **2** | 2026-10-01, D1 (bu belgenin §1.6'sı) | **PG eki (D4 isteği, `KENDI-POSTGRESQL.md` §8):** bildirimin `pg` bloğu `{cizgi, enAz, hedef}` oldu (1'deki `{gerekenSurum, paket}` KALKTI — yayınlanmış bildirim yoktu, tel `v` 1 kalır); PG paketi AYRI imzalı künyeyle (`tekserp-pg`) `/<kanal>/backend/pg/<sürüm>-<derleme>/`; `PG_BAGI` kodu; karar girdisi `pgSurumu` → `pg {kip, surum, derleme}`; farklı ANA sürümlü PG hiçbir yoldan kurulmaz. Vektörler yeniden üretildi — D2 bu sürüme göre yazar. |
> | 3 | 2026-10-01, D1 (§3.2 — yalnız EKLER) | Fabrika API'si uygulandı: `UpdateStatus`a `yerel` (güncelleyicinin durum dosyası) + `gecmis` (son backend denemeleri) eklendi; rapor ve panel görünümü D2'nin `durum.json` + `gecmis.jsonl` (§5) biçiminden TEK eşlemeyle doğar (`src/services/update-status.service.ts`). Tel ve vektörler DEĞİŞMEDİ. |
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
}
```

**Güncelleyici dosyalarından eşleme (TEK yer: `update-status.service.ts`; dosyalar `src/lib/license/updater-ipc.ts` ile okunur).** Kök: `TEKSERP_GUNCELLEME_DIZINI` (mutlak; geliştirme/test) > Windows'ta `%ProgramData%\TeksERP\guncelleme` > yok. Dosya düz olmalı (bağlantı İZLENMEZ), `durum.json` ≤ 64 KB, geçmişin son 64 KB'ı okunur. `guncelleyici.durum`: dosya yok → `YOK` · okunamıyor/biçimsiz → `OLCULEMEDI` · `durum = HATA` (insan gerekir) → `DURDU` · diğer → `CALISIYOR` (canlılık SCM'den ölçülmez; `durum.json` yalnız değişince yazılır). `bekleyen` (yalnız `BEKLIYOR · INDIRILIYOR · HAZIR · UYGULANIYOR` ve `surum ≠ kuruluSurum`): `UYGULANIYOR` → `KUR` · `politika.izin = false` ya da `BEKLIYOR` + `hataKodu` → güncelleyici kodu rapor sözlüğüne (`POLITIKA_DONDUR` → `DONDURULDU/POLITIKA` · `YAPTIRIM_DONUK` → `DONDURULDU/YAPTIRIM` · `KIRA_*` → `DONDURULDU/KIRA_YOK` · `SURUM_IZINSIZ` → `UYGUN_DEGIL/HEDEF_DISI` · `KAYNAK_SURUM_ESKI` · `PG_SURUM_ESKI` → `PG_SURUMU_ESKI` · `PG_BUYUK_SURUM` → `PG_ANA_SURUM`; tanınmayan kod `UYGUN_DEGIL` + kodun kendisi) · `ONAYLI` + planlanmamış → `ONAY_BEKLIYOR` · diğer → `PENCERE_BEKLIYOR`. `son`/`gecmis`: yalnız `urun = backend` satırları; `HATA` → `BASARISIZ`, kodsuz başarısızlık `BILINMEYEN`; `kayitId` = `islemId` (UUID değilse satır atlanır); `veriGeriYuklendi` satırda açıkça `true` değilse `false`. Rapor `UpdateReportSchema`dan geçmezse GÖNDERİLMEZ (yoklama bu yüzden düşmez); güncelleyici yoksa alan hiç gitmez. Bekçi: `test_guncelleme_durumu` · `test_lisans_yoklama_allowlist` §5.

Onay yazan uç (`POST /api/guncelleme/onay` — `{clientToken, surum, zamanlama}`) niyet dosyasının biçimi (§4, D2) donunca bağlanır; izin ve denetim satırı o dilimde.

## 4+. Yerel düzen · IPC · durum makinesi — D2

_(D2 dilimi bu başlığın altına yazar: sürüm dizinleri + `current`, niyet dosyası biçimi ve ACL'si, güncelleyici durum dosyası (backend'in okuduğu), olay günlüğü, adım adım durum makinesi, geri dönüş, kendini güncelleme; D4'ün önerdiği `pgsql/ornek.json` (şartname §6) de bu yerel sözleşmeye girer.)_
