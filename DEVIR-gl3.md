# DEVİR — gl3 (GUNCELLEYICI-SAGLAMLIK L3: Linux/OCI paketi + yayıncı) — bağlam sınırı

Worktree `Teks-Erp-wt/gl3`, dal `gece/gl3` (origin/main `ecad5e133`'ten). node_modules ana ağaca bağ (kök + Teks-Erp).
Plan: `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §1.3 + §10 L3; sözleşme `docs/design/GUNCELLEYICI.md` §16.

## Yapılanlar (bu commit'te; sha için `git log gece/gl3`)
1. `.github/workflows/korumali-paket.yml`: yeni iş `guncelleyici-linux` (runs-on **ubuntu-22.04**, özelliksiz
   `cargo build --release --locked -p tekserp-guncelleyici`, ELF x86-64 denetimi, `kunye` → `guncelleyici-kunye.json`,
   ad/hedef linux/testCapasi false/capaKipi uretim denetimi, yapıt `guncelleyici-linux-x64`).
2. `Teks-Erp/scripts/test_paket_kapsami.ts` §7L + sondalar N19–N21 → 32/0 yeşil.
3. `scripts/lib/dagitim.mjs`: `OCI_URUN_DIZINI='backend-oci'` + `turet()`te `'backend-oci'` hedefi (feed/manifest/vds/
   defter `<grup>-backend-oci-YAYIN-DEFTERI.tsv`). `URUN_DIZINI`ne EKLENMEDİ (satıcı DOWNLOAD_PRODUCTS/Worker ile aynı
   küme bekçisi; L2b ekleyince katılır). `check-dagitim.mjs` yeşil. `grupHedefi('test','backend-oci')` çalışıyor.
4. YENİ `Teks-Erp/scripts/lib/oci-arsiv.ts` — Docker'sız akışlı tar/`docker save` okuyucu (`imajArsiviOlc`: config özeti,
   RepoTags, label, son katmanın diff_id denetimi + içeriği). Gerçek ders imajı arşiviyle denendi (~0,4 sn, 209 MB).
5. YENİ `Teks-Erp/scripts/lib/oci-paket.ts` — `backend-oci` paket biçimi sabitleri (`ociUyeler`, `ociKapsam`,
   `ociPaketAdi` = `tekserp-backend-oci-<sürüm>.tar`, `ociImajArsivi`) + `ociPaketiAc` (dış tar TAM üye kümesi, künye
   `PAKET-DOCKER.json.jws` verifyIntegrity, platform/commit/gocSayisi/imaj/guncelleyici alanları, ELF, güncelleyici
   künyesi, compose doluluğu, `imajDenetle`: imzasız taban RED). tsc temiz; HENÜZ HİÇBİR YERE BAĞLI DEĞİL.
6. Linux güncelleyici Mac'te çapraz derlendi: `cargo zigbuild --release --locked -p tekserp-guncelleyici --target
   x86_64-unknown-linux-gnu.2.28` (PATH'e `~/.cargo/bin`) → `Teks-Erp/native/target/x86_64-unknown-linux-gnu/release/
   tekserp-guncelleyici`; ders imajında `kunye` = `{"ad":"tekserp-guncelleyici","capaKipi":"uretim","hedef":"linux",…,"testCapasi":false}`.

## Kararlar / bulgular
- ⚠ **İmaj kimliği = CONFIG ÖZETİ**, `docker image inspect .Id` DEĞİL: Docker 29 containerd deposunda `.Id` index özetidir
  (ölçüldü: ders imajı `.Id` 5854ca… ≠ config 98741c…); klasik depoda config özetidir. Kimlik her yerde ARŞİVDEN ölçülür.
  **L4b'ye iş:** hedefte etiketi `.Id` ile değil (arşivden config özeti + `RootFS.Layers` = diff_ids) ölçmeli. Plan §1.2'deki
  `docker image inspect --format '{{.Id}}'` satırı bu yüzden yanlış; GUNCELLEYICI.md §16'ya kural olarak yazılmalı.
- Paket üyeleri (düz ad, dizin yok): imaj tar.gz · docker-compose.yml (güncelleyicili şablon, `@@SURUM@@` dolu) · .env.ornek ·
  tekserp-guncelleyici · guncelleyici-kunye.json · PAKET-DOCKER.json(.jws) · butunluk-liste.txt · SHA256SUMS. İmaj etiketi
  zorunlu `tekserp-korumali:<sürüm>` (compose onu ister). Dış künye tek imza (`paket-*` → takım eski, `pkt-*` → zincir).
- Yayıncı "kuru" kipi varsayılana ÇEVRİLMEDİ (mevcut `--kuru` bayrağı aynen); "yerel sahte hedef" = test_backend_yayin'in
  sahte ssh/scp + geçici ağaç düzeni.

## Oturum 2 (2026-10-09) — yapılanlar (commit: `git log gece/gl3`, "L3 ikinci ara")
1. `backend-bildirim.ts`: `dogrula|imzala --ortak --tar=<paket.tar>` → `ociPaketiAc` + üretim anahtar ailesi + ad = `ociPaketAdi`;
   bildirim `platform:"linux-x64-oci"`, `imaj`, `guncelleyici`, `pg.hedef:null` (`--pg-kunye` RED), `runtime.node`=künye
   `sunucu.nodeSurum`, şema öz-denetimi; imza öz-denetimi `verifyReleaseManifest(..., {platform})`; `sonuc.json`a `ciKokeni`.
   Yeni komut `imaj-kimlik --arsiv=<tar.gz>`. `oci-arsiv.ts` yorumlarındaki `.Id` ifadesi düzeltildi.
2. `deploy/backend-yayinla.mjs --urun=backend-oci` (+ `scripts/lib/backend-yayin.mjs`: `OCI_PAKET_ADI_DESENI`, `YAYIN_URUNLERI`,
   `yayinPlani({urun})`, ürün başına `kopruYolu`, `ciKokeniSuz`). Terfi etiketi sürümün (`urun:'backend'`); portal olayı
   `urun:'backend'` + `ayrinti.platform`. PG argümanları OCI'de DUR; zip↔tar ürün yolu uyuşmazlığı DUR.
3. `teslim-paketle.sh` yeni imza `<etiket> <güncelleyici-dizini> <çıktı>` (oci-paket.ts biçimi, şablon doldurma, kimlik
   arşivden, güncelleyici künyesi imajda ölçülür, ustar dış tar).
4. Bekçiler: `test_docker_hijyeni` §5c (sahne değişkeni) · YENİ §5l (teslim OCI biçimi, 9 sonda) · YENİ §5m (sahne çapa kipi,
   2 sonda) · §7j TERSİNE (teslim güncelleyicili şablonu taşır) → 182/0. `test_backend_yayin` YENİ §1o/§1o2 + §3L1–§3L6
   (sentetik fikstür `Teks-Erp/scripts/lib/oci-fikstur.ts`) → 140/0. Negatif sondalar elle: öz-denetimden platform
   kalktı → §3L5–6 4 ❌; ürün yolu kapısı + ince katman denetimi kalktı → §3L2/§3L3/§3L3b 3 ❌; geri alınınca yeşil.
5. `sahne.mjs` native kopyasından sonra `native-capa-kipi.mjs` (G13 borcunun ucuz kısmı).
6. Gerçek prova: `prova-imaj-butunluk.mjs --birak` 16/0 (yeni sahne.mjs ile) → `teslim-paketle.sh` (test kökü kok-2099-3 /
   pkt-2099-3 dış imza, çapraz derlenmiş güncelleyici 0.1.3) → 213 MB tar, imaj config özeti sha256:c25df486… →
   `backend-yayinla.mjs --grup=test --urun=backend-oci --kuru` ÇIKIŞ 0 (bildirim linux-x64-oci, göç 373, CI kaçışı uyarısı).
   Geçici etiket `tekserp-korumali:2.14.0` silindi. Prova imajları (`tekserp-korumali:prova-g13-071a03*`, 6 adet) ve
   geçici dizin `/var/folders/7j/.../tekserp-imaj-prova-j04JP8` DURUYOR — işi bitiren siler (ders imajı SİLİNMEZ).
7. `satici/sunucu/node_modules` worktree'de `npm ci` ile kuruldu (prova için; gitignore'lu).

## Kalan adımlar (sırayla)
1. Ders imajıyla imzasız taban RED uçtan uca (isteğe bağlı): teslim-paketle.sh'in `--imzali` satırı çıkarılmış KOPYASIyla
   (scratch'te) ders imajı → tar → yayıncı kuru → "son katman ince imza katmanı değil" / "İMZASIZ TABAN" beklenir.
2. Belgeler: plan `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §1.2'deki `docker image inspect --format '{{.Id}}'` satırı YANLIŞ →
   "imaj kimliği = config özeti, arşivden (`RootFS.Layers` + config); containerd'de `.Id` index özetidir" olarak düzelt;
   §1.3 paket biçimine `.env.ornek` + SHA256SUMS + `tekserp-backend-oci-<sürüm>.tar` adı; GUNCELLEYICI.md §16 kural + paket
   biçimi; runbook `docs/ops/LINUX-DOCKER-KURULUM.md` §8 (yeni teslim-paketle imzası, dış tar); `docs/kurallar/deploy-kurulum.md`
   tek satır; arşiv `docs/history/arsiv/2026-10.md` SONUNA L3 notu ([ÇEKİRDEK] kimlik=config özeti; [PROFİL] yok);
   `Teks-Erp/docs/BEKCI-HARITASI.md`: test_docker_hijyeni §5l/§5m/§7j, test_backend_yayin §1o/§3L satırları.
3. Koşulmamış bekçiler: test_korumali_imaj (--sonda) · test_paket_kapsami · test_guncelleme_protokol · prova-paket-zinciri.mjs ·
   test_parola_kasasi · check-dagitim · tsc (scripts + backend) — sonra commit.
4. İNİŞ (görev metni): fetch → `gece/gl3`ü origin/main üzerine rebase (arşiv/kural çakışmalarında ikisini de koru) → kapı
   (rebase tetiklemezse `git reset --soft origin/main` → `node scripts/hooks/pre-commit.mjs` → commit'leri geri kur;
   TEKSERP_HOOK_SKIP YASAK) → alan bekçileri + ilgili npm test → `git push origin HEAD:main` (force YASAK).
5. Açık (kullanıcı/sonraki dilim): OCI terfisinde kaynak grup ölçümü bugün Windows `backend/son.json`dan (ARTEFAKT backend
   `olculmez`; gerçek yükleme YENI_ADRES_KAPISI ile kapalı) — D5+D8 dilimi backend-oci kaynağını ölçmeli · Worker
   `backend-oci` yolu L2b'de (ilk gerçek OCI yayınından önce) · Docker derlemesinin CI kökeni yok (`--ci-atla`) · L4b: hedefte
   etiketi `.Id` ile değil config özetiyle ölç.

## Dokunma
L2b (Worker/satıcı belirteci), F1b satici/web, L1 Teks-Erp/native — paralel ajanlarda. Ana .env/VDS/CF/indir sunucusu ASLA.
