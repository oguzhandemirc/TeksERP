# Üretim satıcısı — anahtar töreni (kullanıcıyla, gerçek terminalde)

> **Durum (2026-09-30):** YAZILDI, UYGULANMADI. Kullanıcı kararı: tören ŞİMDİ, **USB'siz** (USB kopyası sonra, §4); kâğıda **yalnız kök parolası**.
> **Araç:** [`deploy/satici/uretim-toren.mjs`](../../deploy/satici/uretim-toren.mjs) — kriptoyu yazmaz, var olan araçları sırayla koşturur; PAKET anahtarını ayrı dilimin PAKET aracı üretir (`lisans/uretim-gecis`; tören onu tek satırlık `PAKET_KOMUTU` ile çağırır). Bekçi `satici/sunucu/scripts/test_uretim_toren.ts`. Kurallar: [`kurallar/lisans.md`](../kurallar/lisans.md). Sonraki adım (VDS): [`SATICI-KURULUM.md`](SATICI-KURULUM.md) §13.
> **Değişmez:** adnansahin (SAHINSRV, adnansahin kanalı, VDS'teki `html/adnansahin/**`) bu törenden ETKİLENMEZ — tören yalnız Mac'e (`~/.tekserp/satici-uretim/`) yazar; ağa çıkmaz, VDS'e dokunmaz.

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

Künyenin çapa satırları (`capaSatirlari`): `ROOT_PUBLIC_KEYS` (kök, bütün sınıflar) · `PACKAGE_PUBLIC_KEYS` (paket) · `CF_WORKER_INDIRME` (İNDİRME açık yarısı). Kök ve paket açık anahtarları koda ayrı dilimle girer (§5.1); o inmeden üretim satıcısı ALT/İNDİRME sertifikalarını kullanmaz (`Kök … güven çapasında yok`) ve fabrika üretim HAK'ını kabul etmez.

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

   Commit yöneticide; yeni backend sürümü (native yeniden derlenir). Üretim satıcısının imajı bu commit'ten SONRAKİ HEAD'den derlenir (satıcının gömülü çapası).
2. **VDS:** [`SATICI-KURULUM.md`](SATICI-KURULUM.md) §13 — anahtar birimi, ayrı DB, yedek döngüsü, iç API, DNS (`lisans`).
3. **CF Worker:** İNDİRME açık anahtarı (`capaSatirlari.CF_WORKER_INDIRME`) [`INDIRME-KAPISI-WORKER.md`](INDIRME-KAPISI-WORKER.md) ayarına eklenir (kullanıcı).
4. **Patron bulutu:** iç API kaynağı hazırlıktan üretime — [`PATRON-BULUTU-KURULUM.md`](PATRON-BULUTU-KURULUM.md) §14.
5. **Paket imzası (üretim):** `cd Teks-Erp && npx tsx scripts/build-korumali-imza.ts zip --zip=<paket> --anahtar=$HOME/.tekserp/satici-uretim/paket/paket-2026.paket.json` (aynı `imzala` · `belge`) → paket parolasını TTY'den (TTY yoksa stdin'in ilk satırı) ister. Şifreli modül derlemesi üretim anahtarıyla: `paketle.ps1 -ModulAnahtarDizini` / `build-korumali.mjs --modul-anahtar-dizini=$HOME/.tekserp/satici-uretim/modul-anahtarlari`.

## 6. Rotasyon ve kayıp

| Olay | Ne yapılır |
|---|---|
| ALT sertifikası biterken (180 gün; tarih künyede) | `cd satici/sunucu && npx tsx scripts/anahtar.ts alt-uret --kid=alt-2026-2 --kok=kok-2026-1 --dizin=$HOME/.tekserp/satici-uretim/anahtarlar` (kök parolası sorulur) → VDS anahtar birimine kopya (satıcı dakikada bir yeniden okur); eski örtüşme süresince kalır. Sonra kurtarma arşivi yenilenir (aşağıda) |
| İNDİRME biterken (365 gün) | `indirme-uret --kid=ind-2027 --kok=kok-2026-1 …` + CF Worker'a açık anahtar |
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

## Ek A — yönetici için teknik özet

- **Alt süreçler:** kök/ALT/İNDİRME/sırlar `satici/sunucu/scripts/anahtar.ts` (`kok-uret` · `alt-uret` · `indirme-uret` · `sirlar-uret`), PAKET = `PAKET_KOMUTU` (tek satır, törenin başında: `Teks-Erp/scripts/build-korumali-imza.ts anahtar-uret --kid={kid} --dizin={dizin} --json` — arayüz değişirse yalnız bu satır; `--paket-komutu="…"` koşum başına ezer ve ekranda `varsayılan DEĞİL` diye görünür), modül `satici/sunucu/scripts/modul-anahtari.ts uret` (DB'siz), yedek alıcıları + sınama + kurtarma arşivi `Teks-Erp/scripts/yedek-sifrele.ts`. Kurtarma alıcısı `--parolali --parola-stdin` ile KÖK parolasına sarılır.
- **PAKET sözleşmesi:** araç `{dizin}/{kid}.paket.json` üretir (parolalı v2, 0600, `kid` + `x`; ham `d` alanı OLMAZ — parolasız dosya RED) ve `--json` ile stdout'a tek satır `{"v":1,"kid","x","dosya","parolali":true}` basar; tören bu özeti dosyayla karşılaştırır (kid · x · dosya · `parolali`), uyuşmazsa RED. TTY'de terminali devralıp parolayı kendisi sorar (iki kez), TTY yoksa törenin stdin'inde kalan satırlar ona geçer; kök parolası ona hiç verilmez. Ölçüm (2026-09-30): `lisans/uretim-gecis` dalının aracıyla bekçi §4a yeşil (34/0); `expect` ile gerçek terminalde iki parola da ekrana hiç yansımadı; `guven-capasi-ekle.ts` kuru kipte törenin kök ve paket dosyalarını okudu.
- **Parola yolu:** kök parolası TTY'den gizli (TTY yoksa stdin satırları: kök, kök tekrar, sonra PAKET aracının satırları — yalnız bekçi); alt süreçlere yalnız stdin; alt süreç ortamı yalın (`PATH` · `HOME` · `TMPDIR` · `COPYFILE_DISABLE`) — `ANAHTAR_DIZINI`, `GUVEN_CAPASI_DOSYASI`, `DATABASE_URL`, `NODE_OPTIONS` geçmez. Alt süreç hata çıktısı parola baytı içeriyorsa hiç basılmaz.
- **Hepsi ya da hiçbiri:** `<hedef>.yarim-<pid>`de kurulur, en sonda tek `rename`; her hata ve Ctrl+C yarım dizini siler (yalnız törenin YARATTIĞI yolu — araya giren yol/bağ dokunulmadan kalır). Hedef ya da yarım kalıntı VARSA parola sorulmadan RED.
- **Yol güvenliği (TOCTOU):** yol boyunca her bileşen `lstat`la ölçülür — sembolik bağ RED (root'a ait sistem bağı, macOS `/var` · `/tmp`, hariç); üst dizin kullanıcının ve grup/başkalarına kapalı olmalı (yoksa bileşen bileşen 0700 yaratılır); yarım dizin ve alt dizinleri recursive OLMADAN yaratılır (varsa RED); tören dosyaları `wx` (varsa ezmez); hedef rename'den HEMEN önce yeniden ölçülür ve özel `mkdir` ile sahiplenilir — araya giren boş dizinin üstüne geçilmez.
- **Kaynak kapısı:** ağaç temiz + HEAD origin/main'de ya da `--etiket=<ad>`in commit'i + `npm ls --all` hatasız (iki proje); künyede `kaynak{commit (tam sha), dayanak, kirli:false, kilitler{yol: sha256}, npmLs}`.
- **Künye** (`TOREN-KUNYE.json`, açık): `kok{kid,x,siniflar}` · `alt`/`indirme`{kid,x,baslangic,bitis} · `paket{kid,x}` · `modulAnahtarlari[]{modul,surum,kid}` · `yedekAlicilari[]{ad,parmakIzi}` · `capaSatirlari{ROOT_PUBLIC_KEYS, PACKAGE_PUBLIC_KEYS, CF_WORKER_INDIRME}` · `vds{anahtarBirimi, yedekAlici, kasayaIceAktar}` · `usb[]` · `ozetler{yol: sha256}` · `kaynak{commit, dayanak, kirli, kilitler, npmLs}`. Çapa ekleme betiği bu dosyayı girdi olarak okur.
- **Seçenekler:** `--dizin` · `--yil` (kid'ler `kok-<yıl>-1` · `alt-<yıl>-1` · `ind-<yıl>` · `paket-<yıl>`) · `--alt-gun` (180) · `--ind-gun` (365) · `--moduller=a.b,c.d|yok` (varsayılan şifreli modül kataloğu `Teks-Erp/src/lib/license/sifreli-moduller.json`) · `--usb` (törenle aynı anda kopya) · `--etiket=<git etiketi>` (HEAD origin/main'de değilse: etiket HEAD'i göstermeli) · `--paket-komutu` (yukarıda).
