# Üretim satıcısı — anahtar töreni (kullanıcıyla, gerçek terminalde)

> **Durum (2026-09-30):** TÖREN YAPILDI (22:17, kullanıcı, gerçek terminalde; `dogrula` ✅ 15 dosya — kayıt §7) · güven çapası dilimi yazıldı (§5.1, iniş yöneticide) · USB kopyası BEKLİYOR (§4). Kullanıcı kararı: tören **USB'siz** (USB kopyası sonra, §4); kâğıda **yalnız kök parolası**.
> **Araç:** [`deploy/satici/uretim-toren.mjs`](../../deploy/satici/uretim-toren.mjs) — kriptoyu yazmaz, var olan araçları sırayla koşturur; PAKET anahtarını ayrı dilimin PAKET aracı üretir (`lisans/uretim-gecis`; tören onu tek satırlık `PAKET_KOMUTU` ile çağırır). Bekçi `satici/sunucu/scripts/test_uretim_toren.ts`. Kurallar: [`kurallar/lisans.md`](../kurallar/lisans.md). Sonraki adım (VDS): [`SATICI-KURULUM.md`](SATICI-KURULUM.md) §13.
> **Değişmez:** adnansahin (SAHINSRV, adnansahin kanalı, VDS'teki `html/adnansahin/**`) bu törenden ETKİLENMEZ — tören yalnız Mac'e (`~/.tekserp/satici-uretim/`) yazar; ağa çıkmaz, VDS'e dokunmaz.
> **⚠️ Lisans v2 kararları (kullanıcı, 2026-10-01 — [`LISANS-V2-CEVRIMDISI-KIRA.md`](../design/LISANS-V2-CEVRIMDISI-KIRA.md) §2, kural `kurallar/lisans.md`):** bu runbook'un üç varsayımı değişti, adımlar ilgili dilimde yeniden yazılır. (1) Kök VDS'te DURMAZ: §0 tablosundaki "VDS anahtar birimi" kök için geçicidir — Mac ve Drive kopyaları doğrulandıktan SONRA, kullanıcının "uygula" cümlesiyle VDS'ten kaldırılır (A düzeni); ara imzacı inene dek HAK imzası gerekirse kök yalnız o imza oturumunda VDS'e konur. (2) VDS dışı şifreli yedek USB yerine kullanıcının elle yüklediği Google Drive'dır (yalnız şifreli/açık dosyalar; kök parolası kâğıtta) — §4'teki USB adımı bu kararla değişir. (3) G4 inince HAK'ı VDS'teki ara imzacı imzalar; ALT · ara imzacı · İNDİRME 120 gün yaşar ve üç ayda bir `uretim-toren.mjs donem` töreniyle yenilenir — §6'daki 180/365 günlük tek tek rotasyonun yerine geçer (dilim L2-3).

## 0. Ne üretilir, nerede durur

| Dosya (`~/.tekserp/satici-uretim/`) | Ne | Koruma | Nereye gider |
|---|---|---|---|
| `anahtarlar/kok-2026-1.kok.json` | KÖK — HAK'ları ve ALT/İNDİRME/BAYİ sertifikalarını imzalar (bütün sınıflar) | **kök parolası** | Mac · VDS anahtar birimi · USB (sonra) |
| `anahtarlar/alt-2026-1.anahtar.json` | ALT — kira imzası, 180 gün | düz, 0600 | Mac · VDS anahtar birimi |
| `anahtarlar/ind-2026.anahtar.json` | İNDİRME — indirme belirteci, 365 gün | düz, 0600 | Mac · VDS anahtar birimi (açık yarısı CF Worker'a) |
| `anahtarlar/portal-totp.key` · `etkinlestirme-kodu.pepper` · `modul-kasasi.key` | sunucu sırları | düz, 0600 | Mac · VDS anahtar birimi |
| `paket/paket-2026.paket.json` | PAKET — korumalı paketin bütünlük listesi imzası (PAKET aracının çıktısı) | **paket parolası** | Mac · VDS anahtar birimi (ARA kopya, USB gelene dek) · USB |
| `modul-anahtarlari/depo.multiEnabled.1.json` | şifreli modül anahtarı | düz, 0600 | Mac (derleme) · VDS kasası (`ice-aktar`; dosya VDS'te kalmaz) |
| `yedek-alici/satici-uretim-mac.tkpub` · `satici-uretim-kurtarma.tkpub` | satıcı yedeklerinin iki alıcısı (açık) | — | Mac · VDS `yedek-alici/` |
| `yedek-ozel/satici-uretim-mac.txt` | yedekleri açar (rutin) | düz, 0600 | **YALNIZ Mac** |
| `yedek-ozel/satici-uretim-kurtarma.tkkey` | yedekleri açar (kurtarma) | **kök parolası** | Mac → USB |
| `kurtarma/sirlar.tar.tkenc` | `anahtarlar/` + `paket/` + modül anahtarları arşivi | iki alıcıya şifreli | Mac → USB |
| `yedek-sinama.txt.tkenc` | sınama dosyası (anahtar hâlâ açıyor mu?) | iki alıcıya şifreli | Mac → USB |
| `TOREN-KUNYE.json` · `BENIOKU.md` | açık künye (kid · açık anahtar · parmak izi · dosya özetleri) + ne-nedir/nasıl geri yüklenir | sır YOK | Mac → USB; künye yöneticiye |

- **Kâğıt:** YALNIZ kök parolası. Kurtarma anahtarı da kök parolasıyla sarılıdır → USB + kâğıt, Mac olmadan her şeyi geri getirir (§6).
- **Kök ve paket parolaları AYRI parolalardır:** tören kök parolasını sorar, paket parolasını 7. adımda PAKET aracı kendi istemiyle sorar; tören kök parolasını PAKET aracına GEÇİRMEZ. Paket parolası kökten FARKLI seçilir (araçlar aynı olmasını engellemez; önerilmez): kök parolası portalda (VDS'te) yazılır, paket anahtarı da VDS'te ara kopya olarak durur — biri sızarsa öteki korunsun. Paket parolası parola yöneticisinde durur; kaybı telafi edilir (§6).
- **Üçüncü yedek alıcısı:** Etkili Yazılım çevrimdışı anahtarı ([`YEDEK-SIFRELEME.md`](YEDEK-SIFRELEME.md) §2, töreni henüz yok) — eklenince açık yarısı VDS `yedek-alici/`ye konur; o güne dek satıcı yedekleri iki alıcılıdır.
- VDS'e ASLA gitmeyen: `yedek-ozel/`, `kurtarma/`, modül anahtarı dosyaları (yalnız kasaya içe aktarılır).

## 1. Hazırlık (tören öncesi, ~10 dk)

1. **İki parola belirle** (ekranda görünmezler, her biri iki kez yazılır): **kök parolası** — en az 12 karakter, öneri 5–6 rastgele kelime; kâğıda yazılacak (tören sorar). **Paket parolası** — en az 12 karakter, kökten farklı; parola yöneticisine ("TeksERP paket-2026") (7. adımda PAKET aracı sorar).
2. **Kâğıt + kalem** hazır; kâğıdın duracağı yer (kasa) belli. USB gelince USB, kâğıtla AYNI yerde durmaz (biri ele geçerse öteki tek başına işe yaramasın).
3. **Temiz ağaç + bağımlılıklar** (repo kökünde) — ZORUNLU, tören kendisi ölçer ve parola sormadan REDDEDER:

   ```bash
   git fetch && git switch main && git pull --ff-only && git status --short   # boş çıkmalı (izlenmeyen dosya da sayılır)
   (cd satici/sunucu && npm ci) && (cd Teks-Erp && npm ci)                    # ZORUNLU: node_modules kilit dosyasından
   ls ~/.tekserp/satici-uretim                                                # "No such file" görülmeli — varsa DUR
   ```

   Tören başında: ağaç temiz mi (`git status --porcelain --untracked-files=all` boş), HEAD origin/main'de mi (ya da açık `--etiket=<ad>` o commit'i mi gösteriyor), iki projede `npm ls --all` hatasız mı — biri tutmazsa RED (çıkış 2). HEAD'in tam sha'sı ve iki `package-lock.json` özeti ekrana ve künyeye (`kaynak`) yazılır.

4. **PAKET aracı hazır:** üretim PAKET anahtarını üreten araç ayrı dilimdedir (`lisans/uretim-gecis`); o `main`e inmeden tören 7. adımda durur (bugünkü araç üretim kid'ini reddeder; yarım dizin silinir, hedefe hiçbir şey yazılmaz). Yönetici "PAKET aracı indi" demeden tören başlatılmaz.

## 2. Tören — tek komut

```bash
node deploy/satici/uretim-toren.mjs
```

| Ekranda | Sen |
|---|---|
| `kaynak : <tam sha> (temiz · origin/main · npm ls hatasız)` · iki `kilit : …package-lock.json sha256 …` · hedef · `USB : verilmedi …` · kid'ler (`kok-2026-1 · alt-2026-1 (180 gün) · ind-2026 (365 gün) · paket-2026 · modül: depo.multiEnabled`) · `PAKET : <komut>` | `PAKET` satırında `varsayılan DEĞİL` görürsen Ctrl+C, yöneticiye sor (kirli ağaç / origin/main dışı HEAD tören tarafından zaten REDDEDİLİR) |
| `[1/10] Önkoşullar ✓` · `[2/10] Kök parolası …` | — |
| `Kök parolası (en az 12 karakter):` → `Kök parolası (tekrar):` | kök parolasını iki kez yaz (görünmez), Enter |
| `[3/10] KÖK` … `[6/10] Sunucu sırları` | bekle; hiçbir şey sorulmaz |
| `[7/10] PAKET paket-2026 … — PAKET aracı kendi parolasını sorar` + aracın kendi istemi | **paket parolasını** aracın istediği kadar (yeni + tekrar) yaz |
| `[8/10]` … `[10/10] Kurtarma arşivi · künye · BENIOKU · izinler · yerine koy` | bekle (≈ 10–30 sn) |
| `✅ Tören tamam.` + KÖK · ALT · İNDİRME · PAKET · MODÜL · YEDEK satırları (kid + açık anahtar + tarih + parmak izi) + "Sonraki adımlar" | §3'e geç |

**Kâğıda yaz:** başlık `TeksERP üretim kökü kok-2026-1`, altına **kök parolası**, altına ekrandaki `KÖK … x=` değerinin ilk 8 karakteri (hangi köke ait olduğunu tanımak için; sır değil) ve tarih. Paket parolası kâğıda YAZILMAZ → parola yöneticisine.

**Sır hijyeni:** ekran yalnız açık bilgi basar (kid · açık anahtar · parmak izi · yol). Kök parolası alt süreçlere yalnız stdin borusuyla gider (PAKET aracına HİÇ gitmez); paket parolasını PAKET aracı terminalden kendisi okur. Tören `--*parola*` argümanını reddeder, ortam değişkeninden parola okumaz.

**Hata olursa (hepsinde hedefe HİÇBİR ŞEY yazılmaz):**

| İleti | Anlamı | Ne yap |
|---|---|---|
| `iki giriş eşleşmedi` · `en az 12 karakter` | kök parolası kabul edilmedi, anahtar üretilmedi | komutu yeniden koş |
| `PAKET başarısız …` · `beklenen dosyayı üretmedi` · `PAROLASIZ` | PAKET aracı reddetti/hazır değil (§1.4) ya da parolasız dosya üretti; yarım dizin silindi | yöneticiye ilet |
| `<adım> başarısız …` + `yarım dizin silindi` | bir alt adım düştü; yarım dizin (düz ALT/İNDİRME taşıyabilirdi) silindi | hata satırını yöneticiye ilet, yeniden koş |
| `Hedef zaten var` | tören daha önce yapılmış — üstüne yazılmaz | DUR; yöneticiye sor (yeniden tören ancak hiçbir açık anahtar çapaya girmediyse) |
| `Yarım kalmış tören dizini var` | önceki koşum elektrik/kapanma ile yarıda kaldı | `rm -rf ~/.tekserp/satici-uretim.yarim-*` sonra yeniden |
| `Önkoşul: … npm ci` | bağımlılık yok | §1.3 |
| `Ağaç KİRLİ` · `origin/main'de DEĞİL` · `--etiket=… HEAD'i göstermiyor` | kaynak donmuş değil (değişiklik / izlenmeyen dosya / başka commit) — parola sorulmadı | §1.3 (`git status --short` boş, `git switch main && git pull --ff-only`); yöneticiye sor |
| `npm ls --all hatalı` | node_modules kilit dosyasıyla aynı değil | `(cd <proje> && npm ci)` sonra yeniden |
| `Yolda sembolik bağ` · `Üst dizine grup/başkaları yazabiliyor` · `Üst dizin başka kullanıcının` | hedef yolu güvensiz (bağ izlenmez; üst dizin yalnız senin olmalı) | gerçek yolu ver / `chmod go-w <üst dizin>`; yöneticiye sor |
| `Araya giren yol` · `Hedef tören sürerken doğdu` | tören sürerken yarım dizin ya da hedef başka biri/şey tarafından yaratıldı — dokunulmadı, hedefe hiçbir şey yazılmadı | DUR; o yolu kimin yarattığını yöneticiye bildir |

Ctrl+C her an güvenlidir: yarım dizin silinir.

## 3. Tören sonrası (salt okuma)

```bash
node deploy/satici/uretim-toren.mjs dogrula      # izinler (dizin 700 · dosya 600) + özetler künyeyle aynı → ✅
cat ~/.tekserp/satici-uretim/TOREN-KUNYE.json    # AÇIK künye — yöneticiye iletilir (çapa dilimi + VDS kurulumu)
```

Künyenin çapa satırları (`capaSatirlari`): `ROOT_PUBLIC_KEYS` (kök, bütün sınıflar) · `PACKAGE_PUBLIC_KEYS` (paket) · `CF_WORKER_INDIRME` (CF Worker İNDİRME listesi satırı: kid · `x` · kanallar · pencere, tek satır JSON; L2-8) · `CF_WORKER_LISTESI` (o satırın gireceği liste: `uretim` | `hazirlik`). 2026-09-30 töreninin künyesi L2-8'den öncedir: satırı yalnız `{kid, x}` taşır — Worker'a yeni biçimde girer ([`INDIRME-KAPISI-WORKER.md`](INDIRME-KAPISI-WORKER.md) §1). Kök ve paket açık anahtarları koda ayrı dilimle girer (§5.1); o inmeden üretim satıcısı ALT/İNDİRME sertifikalarını kullanmaz (`Kök … güven çapasında yok`) ve fabrika üretim HAK'ını kabul etmez.

## 4. USB kopyası — BEKLİYOR (USB gelince)

```bash
node deploy/satici/uretim-toren.mjs usb-kopyala --usb=/Volumes/<USB adı>
```

- **Hiçbir şey üretmez:** künyedeki listeyi (`usb` alanı) kopyalar, her dosyanın özetini hem Mac'teki künyeyle hem USB'deki kopyayla karşılaştırır. Mac'teki dosya künyeyle uyuşmuyorsa kopyalamaz; USB'de `tekserp-satici-uretim/` zaten varsa üstüne yazmaz.
- **USB'ye giden (9 dosya, hepsi şifreli ya da açık):** `anahtarlar/kok-2026-1.kok.json` (kök parolası) · `paket/paket-2026.paket.json` (paket parolası) · `yedek-ozel/satici-uretim-kurtarma.tkkey` (kök parolası) · `yedek-alici/*.tkpub` · `kurtarma/sirlar.tar.tkenc` · `yedek-sinama.txt.tkenc` · `TOREN-KUNYE.json` · `BENIOKU.md`. Düz sır (ALT/İNDİRME, sunucu sırları, modül anahtarı, Mac özel yarısı) USB'ye GİRMEZ.
- İkinci USB: aynı komut başka USB'yle. USB kasaya; kâğıttan AYRI yerde.
- USB alındıktan sonra VDS anahtar birimindeki PAKET ara kopyasının kaldırılması kullanıcı kararıdır (SATICI-KURULUM §13.4-4).

## 5. Sonraki adımlar (sıra)

1. **Güven çapası (repo commit'i; yalnız kid + x okunur):**

   ```bash
   cd Teks-Erp
   npx tsx scripts/guven-capasi-ekle.ts kok   --dosya=$HOME/.tekserp/satici-uretim/anahtarlar/kok-2026-1.kok.json     # KURU: yazılacak dört yeri basar
   npx tsx scripts/guven-capasi-ekle.ts paket --dosya=$HOME/.tekserp/satici-uretim/paket/paket-2026.paket.json     # KURU
   # ikisi de doğruysa aynı komutlar --yaz ile → TS kök/paket çapası + satıcı/patron aynası + native anchor.rs birlikte
   ```

   Commit yöneticide; yeni backend sürümü (native yeniden derlenir). Üretim satıcısının imajı bu commit'ten SONRAKİ HEAD'den derlenir (satıcının gömülü çapası). G3'ten (2026-10-01) beri çapa İKİ kiptir: betik `kok-*`/`paket-<yıl>`ı ÜRETİM, `hazirlik-*`/`paket-hazirlik*`ı HAZIRLIK listesine yazar; üretim paketinin native'i `derle:*:uretim`, satıcı `GUVEN_CAPASI=uretim` (compose `ORTAM`).
   **YAPILDI (2026-09-30, dal `lisans/capa`):** iki kuru koşumun `x`i yöneticinin aktardığı değerle birebir → `--yaz`; dört yer yazıldı, ikinci koşum "zaten çapada" (kayıt §7). Kalan: iniş · yeni backend sürümü (native `derle:win:uretim` / `derle:linux:uretim`) · satıcı imajı (SATICI-KURULUM §13.2).
2. **CF Worker — VDS'ten ÖNCE:** künyenin `capaSatirlari.CF_WORKER_INDIRME` satırı `TKL_INDIRME_AYAR.indirmeListesi.<CF_WORKER_LISTESI>` dizisine eklenir (kullanıcı; yerel denetim + Deploy: [`INDIRME-KAPISI-WORKER.md`](INDIRME-KAPISI-WORKER.md) §8). Satıcı İNDİRME anahtarı yüklendiği an onunla basar; Worker'da yoksa her belirteç 403 `JWS_KID`.
3. **VDS:** [`SATICI-KURULUM.md`](SATICI-KURULUM.md) §13 — anahtar birimi, ayrı DB, yedek döngüsü, iç API, DNS (`lisans`).
4. **Patron bulutu:** iç API kaynağı hazırlıktan üretime — [`PATRON-BULUTU-KURULUM.md`](PATRON-BULUTU-KURULUM.md) §14.
5. **Paket imzası (üretim):** `cd Teks-Erp && npx tsx scripts/build-korumali-imza.ts zip --zip=<paket> --anahtar=$HOME/.tekserp/satici-uretim/paket/paket-2026.paket.json --ci-kosu=<id>` (aynı `imzala` · `belge`) → paket parolasını TTY'den (TTY yoksa stdin'in ilk satırı) ister. `--ci-kosu` (G22/ALT-9) yapıtı üreten `korumali-paket.yml` koşusunun numarasıdır (`gh run list --workflow=korumali-paket.yml`): koşu başarıyla bitmiş, `main` dalından ve commit'i yapıtın `dist/server-kunye.json`ı ile PAKET.json'unkiyle aynı değilse ya da `gh` okuyamazsa imza parola sorulmadan reddedilir. CI koşusu YOKSA (CI kırık, acil yama) kaçış yalnız KULLANICININ kendi cümlesiyle: `--ci-kosu` yerine `--ci-atla="<kullanıcının onay cümlesi>"` — cümle + saat + makine + HEAD imzalı künyeye girer, `deploy/backend-yayinla.mjs` yayında uyarır ve defterine yazar; cümleyi imzalayan uydurmaz. Şifreli modül derlemesi üretim anahtarıyla: `paketle.ps1 -ModulAnahtarDizini` / `build-korumali.mjs --modul-anahtar-dizini=$HOME/.tekserp/satici-uretim/modul-anahtarlari`.

## 6. Rotasyon ve kayıp

| Olay | Ne yapılır |
|---|---|
| ALT sertifikası biterken (180 gün; tarih künyede) | `cd satici/sunucu && npx tsx scripts/anahtar.ts alt-uret --kid=alt-2026-2 --kok=kok-2026-1 --dizin=$HOME/.tekserp/satici-uretim/anahtarlar` (kök parolası sorulur) → VDS anahtar birimine kopya (satıcı dakikada bir yeniden okur); eski örtüşme süresince kalır. Sonra kurtarma arşivi yenilenir (aşağıda) |
| İNDİRME biterken (365 gün) | dönem töreni (§8) yenisini üretir (120 gün); Worker satırı VDS'ten ÖNCE (§8 adım 4) |
| PAKET (yıllık) ya da paket parolası kayboldu | PAKET aracıyla yeni kid (`paket-2027` · `--dizin=$HOME/.tekserp/satici-uretim/paket`; komut `BENIOKU.md` §Rotasyon) + çapa sürümü; eski anahtarla imzalı paketler geçerli kalır |
| Kök parolası unutuldu | kök KULLANILAMAZ → yeni kök töreni (`kok-<yıl>-2`) + çapa sürümü + HAK'ların yeniden imzası. Bu yüzden kâğıt |
| Mac kayboldu | USB + kâğıt: `BENIOKU.md` §Geri yükleme 2 (kurtarma arşivi kök parolasıyla açılır → `anahtarlar/` · `paket/` · `modul-anahtarlari/` geri gelir) |
| VDS kayboldu | Mac'teki `anahtarlar/` + Mac'e çekilmiş satıcı yedekleri (`satici_<damga>.dump.tkenc`, Mac anahtarıyla açılır) → yeni VDS (SATICI-KURULUM §13) |

Kurtarma arşivini yenilemek (rotasyondan sonra; eski arşiv silinmez, yenisi tarihli ad alır):

```bash
D=~/.tekserp/satici-uretim; T=$(mktemp -d); umask 077
COPYFILE_DISABLE=1 tar -C "$D" -cf "$T/s.tar" anahtarlar paket modul-anahtarlari
(cd Teks-Erp && npx tsx scripts/yedek-sifrele.ts sifrele --girdi "$T/s.tar" --cikti "$D/kurtarma/sirlar-$(date +%Y%m%d).tar.tkenc" \
  --alici "$D/yedek-alici/satici-uretim-mac.tkpub" --alici "$D/yedek-alici/satici-uretim-kurtarma.tkpub" --duzu-sil) && rmdir "$T"
```

`dogrula` bu yeni dosyaları "künyede olmayan dosya (rotasyon sonrası beklenir)" diye listeler; USB'ye elle kopyalanır.

## 7. Tören kaydı — 2026-09-30 (YAPILDI)

Hepsi açık bilgi (künyeden ve çapa betiğinin kuru çıktısından; sır, parola, özel yarı YOK). Açık anahtarın ilk 8 karakteri kâğıttaki satırla eşleşir (§2).

| Alan | Değer |
|---|---|
| Zaman | 2026-09-30 22:17 (İstanbul; künye `tarih` `2026-09-30T19:17:24.518Z`) · `dogrula` ✅ 15 dosya (≈22:25) · USB'siz (§4 bekliyor) |
| Kaynak | `3cae05ef` — `origin/main`, ağaç temiz, iki projede `npm ls --all` hatasız (künye `kaynak`) |
| KÖK | `kok-2026-1` · URETIM · TEST · DR · DEMO · BAYI · BARINDIRILAN · `x` ilk 8: `sPveT3g3` |
| ALT | `alt-2026-1` · 2026-09-30 → 2027-03-29 (180 gün) · `x` ilk 8: `6goSeQri` |
| İNDİRME | `ind-2026` · 2026-09-30 → 2027-09-30 (365 gün) · `x` ilk 8: `ckusT12f` (CF Worker'a giden tam değer künyenin `capaSatirlari.CF_WORKER_INDIRME` satırında — L2-8 öncesi biçim, `{kid, x}`; Worker satırı `uretim` listesine bu `x` + künyenin `indirme.baslangic/bitis`i + üretim çapalı kanallarla girer; SATICI-KURULUM §10) |
| PAKET | `paket-2026` · `x` ilk 8: `j7xjeBy3` |
| Modül anahtarı | `depo.multiEnabled` sürüm 1 |
| Yedek alıcıları | `satici-uretim-mac` (parmak izi `ff7b57fd2d1d2361`) · `satici-uretim-kurtarma` (`161678a8ce9dec7f`) |
| Künye özeti | `TOREN-KUNYE.json` sha256 `39242ad386e301c26f4ffb5eba983e6b322fa7e5f1834b98f54cf02e201fbf8f` (4886 bayt) |
| Güven çapası | §5.1 — `kok-2026-1` + `paket-2026` dört yerde (TS kök + satıcı/patron aynası · TS PAKET · native `anchor.rs`); iniş yöneticide |

## 8. Dönem töreni — üç ayda bir (lisans v2, G4 · K4)

> **Durum:** araç (`uretim-toren.mjs donem`) + VDS komutları (`anahtar.js kuyruk-disa-aktar · donem-ice-aktar · emekliye-ayir`) + bekçiler (`test_uretim_toren` §6 · `test_ara_imzaci` · `test_iptal_belgesi`) hazır (L2-3). **İlk üretim töreni** tasarımın §5.1 sırasıyla (G3 iniş → satıcı hazırlıkta prova → testfabrika) ve yalnız kullanıcının "uygula" cümlesiyle. Hazırlık ortamı aynı akışı hazırlık köküyle provalar (`--dizin=~/.tekserp/satici-hazirlik --kok=hazirlik-2026-1`).

**Ne zaman:** portal/Telegram `ANAHTAR_SURESI_BITIYOR` — kullanım başına (ALT · ara imzacı · İNDİRME) en yeni sertifikanın bitişine **30 gün** kala (tören günü), 15 · 7 · 1 gün kala tekrar. Atlanırsa 120. günde yeni kira, HAK ve indirme belirteci basılamaz; fabrikalar ödenmiş tarihe (P) dek etkilenmez.

**Ne üretir (Mac, `~/.tekserp/satici-uretim/donemler/<damga>/`):** `vds-paketi/` → `anahtarlar/alt-<yıl>-<n>.anahtar.json` · `ara-<yıl>-<n>.ara.json` (ARA parolasıyla sarılı) · `ind-<yıl>-<n>.anahtar.json` (üçü 120 gün = 90 + 30 örtüşme) · `iptal.json` (ilk dönem sıra 1; `--iptal` verilirse sıra + 1, önceki satırlar taşınır; yoksa önceki belge aynen) · `ice-aktar.json` (iptal belgesi + kökle imzalanmış kuyruk HAK'ları) · `DONEM-KUNYE.json` (kid · açık anahtar · tarih · emekliye listesi · özetler) · `SHA256SUMS`. **Pakette KÖK YOKTUR** (araç ölçer, varsa RED). Paketin dışında `kok-imzali-haklar.json` (Mac arşivi).

**Ortam ve kid'ler:** ortam kök dosyasının KENDİ kimliğinden çözülür (`kok-*` üretim · `hazirlik-*` hazırlık, sınıfları yalnız TEST/DEMO), bayrakla seçilmez. Hazırlık kökünün dönemi `alt-hazirlik-<yıl>-<n>` · `ara-hazirlik-<yıl>-<n>` · `ind-hazirlik-<yıl>-<n>` basar (numara, önekli ilk anahtarlar `alt-hazirlik-2026-1` · `ind-hazirlik-2026` dahil iki biçimden de ilerler); üretiminki öneksizdir — iki satıcı aynı kid'i asla basmaz (aynı kid CF Worker'ın iki listesinde olursa bütün indirmeler 503 olur). Tören, yeni kid'ler karşı ortamın kalıbındaysa ya da anahtar kümesindeyse (`--karsi-dizin`, varsayılan öteki ortamın Mac dizini: `~/.tekserp/satici-hazirlik` ↔ `~/.tekserp/satici-uretim`; dizin yoksa yalnız kalıp ölçülür) parola sormadan durur.

**Parolalar:** kök parolası (kâğıttan, tören başında BİR kez) · **yeni ara imzacı parolası** (iki kez; kökünkinden FARKLI olmak ZORUNDA — araç aynısını reddeder; portalda HAK imzalarken VDS'te yazılır → parola yöneticisine "TeksERP ara-<yıl>-<n>"). İkisi de argv/env/log/dosyaya girmez.

| # | Nerede | Komut / iş | Beklenen |
|---|---|---|---|
| 1 | VDS (salt okuma) | `v "cd $K && docker compose exec -T satici satici-baslat node dist-cli/scripts/anahtar.js kuyruk-disa-aktar" > ~/kuyruk-$(date +%F).json` | `{"v":1,"tur":"tekserp-kok-kuyrugu",…}` — talep yoksa `talepler: []` (adım 2'de `--kuyruk` verilmez) |
| 2 | Mac | §1-3'teki gibi temiz ağaç + `npm ci`, sonra `node deploy/satici/uretim-toren.mjs donem [--kuyruk=~/kuyruk-<tarih>.json]` | `[1/8] Önkoşullar ✓` → kök parolası → ara parolası × 2 → `[4/8]…[8/8]` → `✅ Dönem töreni tamam.` + yeni kid'ler, iptal sırası, EMEKLİYE listesi, paket yolu |
| 3 | Mac → VDS | `scp -P 2222 -rp <paket>/vds-paketi oguzhan@80.253.255.188:donem-paketi && v 'cd ~/donem-paketi && sha256sum -c SHA256SUMS'` | her satır `OK` |
| 4 | CF Worker (kullanıcı — adım 5'ten ÖNCE) | `DONEM-KUNYE.json` → `capaSatirlari.CF_WORKER_INDIRME` satırını OLDUĞU GİBİ `TKL_INDIRME_AYAR.indirmeListesi.<CF_WORKER_LISTESI>` dizisinin sonuna ekle (tören ekranının "2. CF Worker" satırı aynısıdır); eski satır KALIR → yerel denetim (`ayarCoz`, [`INDIRME-KAPISI-WORKER.md`](INDIRME-KAPISI-WORKER.md) §8 adım 2) `ok: true` → Deploy | eski ve yeni kid aynı anda listede (30 g örtüşme); eski satırın penceresi kendi bitişinde kendiliğinden kapanır. Atlanırsa: satıcı adım 5'ten sonraki dakika yeni kid'le basar, Worker her belirteci 403 `JWS_KID` ile düşürür (güncelleme durur) |
| 5 | VDS (YAZIM — kullanıcının "uygula" cümlesiyle) | `v "docker run --rm --network none --user 0 -v \$HOME/donem-paketi/anahtarlar:/g:ro -v $K/anahtarlar:/a --entrypoint sh $Y -c 'install -m 600 -o 10001 -g 10001 /g/* /a/'"` | üç yeni dosya anahtar biriminde (0600, 10001) |
| 6 | VDS | `v "cd $K && docker compose exec -T satici satici-baslat node dist-cli/scripts/anahtar.js donem-ice-aktar" < <paket>/vds-paketi/ice-aktar.json` | `iptal belgesi sıra N: EKLENDI` (tekrarında `VARDI`) + her kuyruk talebi `IMZALANDI` (HAK alanı değiştiyse `ESKIDI`, yeniden talep) |
| 7 | portal (1 dk sonra — anahtar deposu dakikada bir yenilenir) | Anahtarlar: yeni ALT · ARA · İNDİRME satırları `yuklu: true`, uyarı yok · İptal belgeleri: `dagitilanSira` = paketinki · fabrikadan yeni indirme belirteci (yeni kid) Worker'da 200 | `bekleyen` doluysa engeller listelenir: HAK → ara imzacıyla yeniden bas · ANAHTAR → adım 8 |
| 8 | VDS (YAZIM) | `v "docker run --rm --network none --user 10001:10001 -v $K/anahtarlar:/a --entrypoint node $Y dist-cli/scripts/anahtar.js emekliye-ayir --dizin=/a --kid=<EMEKLİYE listesi>"` (kuru) → listeyi oku → aynı komut `--uygula` | her eski ALT/İND/ARA için `özel yarı silinir → <kid>.sertifika.json`; aynı türde yeni anahtar yoksa RED (imza durmasın) |
| 9 | VDS | `v 'shred -u ~/donem-paketi/anahtarlar/* && rm -rf ~/donem-paketi'` · `~/kuyruk-*.json` Mac'te silinebilir | paket kopyası VDS'te kalmaz |

- **Acil durum (VDS ele geçti):** `donem --iptal=<ara/alt/ind kid'leri> --neden="VDS ele geçti"` → adım 4, ama iptal edilen `ind-…` satırı aynı Deploy'da SİLİNİR (iptal belgesi Worker'a ulaşmaz; Worker'daki karşılığı satırın yokluğudur — pencerenin dolması beklenmez) → temizlenmiş sunucuya adım 5–6 → yetenekli kurulumların HAK'larını yeni ara imzacıyla toplu yeniden bas (`POST /portal/api/haklar/toplu-yeniden-bas`, tailnet) → adım 8. İptal belgesi, onu geçersiz kılacağı HAK yeniden basılıp eski anahtar emekliye ayrılmadan dağıtılmaz (önceki belge dağıtılmaya devam eder); fabrikalara yeni derleme gerekmez.
- **Geri alma:** adım 6'dan önce: yeni üç dosyayı anahtar biriminden kaldır (Worker'daki yeni satır zararsızdır, kalabilir), başka hiçbir şey değişmedi. Adım 6'dan sonra içe aktarılan iptal belgesi GERİ ALINMAZ (defter; satır düşüren yeni belge reddedilir) — iptali kaldırmak ayrı bir karardır. Emekliye ayrılan özel yarı Mac'teki dönem dizininden geri konabilir.
- **Mac'te kalan:** `donemler/<damga>/` (700/600; ALT/İND düz, ara parolalı). USB kopyası (`usb-kopyala`) bugün yalnız ilk törenin kümesini kopyalar; dönem paketleri kapsamaz (borç — sonraki dilim).

## Ek A — yönetici için teknik özet

- **Alt süreçler:** kök/ALT/İNDİRME/sırlar `satici/sunucu/scripts/anahtar.ts` (`kok-uret` · `alt-uret` · `indirme-uret` · `sirlar-uret`), PAKET = `PAKET_KOMUTU` (tek satır, törenin başında: `Teks-Erp/scripts/build-korumali-imza.ts anahtar-uret --kid={kid} --dizin={dizin} --json` — arayüz değişirse yalnız bu satır; `--paket-komutu="…"` koşum başına ezer ve ekranda `varsayılan DEĞİL` diye görünür), modül `satici/sunucu/scripts/modul-anahtari.ts uret` (DB'siz), yedek alıcıları + sınama + kurtarma arşivi `Teks-Erp/scripts/yedek-sifrele.ts`. Kurtarma alıcısı `--parolali --parola-stdin` ile KÖK parolasına sarılır.
- **PAKET sözleşmesi:** araç `{dizin}/{kid}.paket.json` üretir (parolalı v2, 0600, `kid` + `x`; ham `d` alanı OLMAZ — parolasız dosya RED) ve `--json` ile stdout'a tek satır `{"v":1,"kid","x","dosya","parolali":true}` basar; tören bu özeti dosyayla karşılaştırır (kid · x · dosya · `parolali`), uyuşmazsa RED. TTY'de terminali devralıp parolayı kendisi sorar (iki kez), TTY yoksa törenin stdin'inde kalan satırlar ona geçer; kök parolası ona hiç verilmez. Ölçüm (2026-09-30): `lisans/uretim-gecis` dalının aracıyla bekçi §4a yeşil (34/0); `expect` ile gerçek terminalde iki parola da ekrana hiç yansımadı; `guven-capasi-ekle.ts` kuru kipte törenin kök ve paket dosyalarını okudu.
- **Parola yolu:** kök parolası TTY'den gizli (TTY yoksa stdin satırları: kök, kök tekrar, sonra PAKET aracının satırları — yalnız bekçi); alt süreçlere yalnız stdin; alt süreç ortamı yalın (`PATH` · `HOME` · `TMPDIR` · `COPYFILE_DISABLE`) — `ANAHTAR_DIZINI`, `GUVEN_CAPASI_DOSYASI`, `DATABASE_URL`, `NODE_OPTIONS` geçmez. Alt süreç hata çıktısı parola baytı içeriyorsa hiç basılmaz.
- **Hepsi ya da hiçbiri:** `<hedef>.yarim-<pid>`de kurulur, en sonda tek `rename`; her hata ve Ctrl+C yarım dizini siler (yalnız törenin YARATTIĞI yolu — araya giren yol/bağ dokunulmadan kalır). Hedef ya da yarım kalıntı VARSA parola sorulmadan RED.
- **Yol güvenliği (TOCTOU):** yol boyunca her bileşen `lstat`la ölçülür — sembolik bağ RED (root'a ait sistem bağı, macOS `/var` · `/tmp`, hariç); üst dizin kullanıcının ve grup/başkalarına kapalı olmalı (yoksa bileşen bileşen 0700 yaratılır); yarım dizin ve alt dizinleri recursive OLMADAN yaratılır (varsa RED); tören dosyaları `wx` (varsa ezmez); hedef rename'den HEMEN önce yeniden ölçülür ve özel `mkdir` ile sahiplenilir — araya giren boş dizinin üstüne geçilmez.
- **Kaynak kapısı:** ağaç temiz + HEAD origin/main'de ya da `--etiket=<ad>`in commit'i + `npm ls --all` hatasız (iki proje); künyede `kaynak{commit (tam sha), dayanak, kirli:false, kilitler{yol: sha256}, npmLs}`.
- **Künye** (`TOREN-KUNYE.json`, açık): `kok{kid,x,siniflar}` · `alt`/`indirme`{kid,x,baslangic,bitis} · `paket{kid,x}` · `modulAnahtarlari[]{modul,surum,kid}` · `yedekAlicilari[]{ad,parmakIzi}` · `capaSatirlari{ROOT_PUBLIC_KEYS, PACKAGE_PUBLIC_KEYS, CF_WORKER_INDIRME, CF_WORKER_LISTESI}` · `vds{anahtarBirimi, yedekAlici, kasayaIceAktar}` · `usb[]` · `ozetler{yol: sha256}` · `kaynak{commit, dayanak, kirli, kilitler, npmLs}`. Çapa ekleme betiği bu dosyayı girdi olarak okur.
- **Seçenekler:** `--dizin` · `--yil` (kid'ler `kok-<yıl>-1` · `alt-<yıl>-1` · `ind-<yıl>` · `paket-<yıl>`) · `--alt-gun` (180) · `--ind-gun` (365) · `--moduller=a.b,c.d|yok` (varsayılan şifreli modül kataloğu `Teks-Erp/src/lib/license/sifreli-moduller.json`) · `--usb` (törenle aynı anda kopya) · `--etiket=<git etiketi>` (HEAD origin/main'de değilse: etiket HEAD'i göstermeli) · `--paket-komutu` (yukarıda).
