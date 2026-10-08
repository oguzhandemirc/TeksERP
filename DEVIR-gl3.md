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

## Kalan adımlar (sırayla)
1. `Teks-Erp/scripts/backend-bildirim.ts`: `dogrula|imzala --ortak --tar=<paket.tar>` → `ociPaketiAc` (+ `pgGereksinimi`
   hedefsiz; `--pg-kunye` OCI'de RED), bildirim `platform:"linux-x64-oci"`, `paket.ad`=tar adı, `imaj`, `guncelleyici`,
   `pg.hedef:null`, `gocSayisi`, `runtime.node`=künye `sunucu.nodeSurum`; öz-denetimde `verifyReleaseManifest(.., {platform})`
   (bugün platformsuz → Windows → SURUM_PLATFORM düşer!); `sonuc.json`a `ciKokeni`. Ayrıca `imaj-kimlik --arsiv=<tar.gz>`
   komutu (teslim betiği config özetini buradan alır).
2. `deploy/backend-yayinla.mjs --urun=backend-oci`: hedef `grupHedefi(GRUP,'backend-oci')`; paket `.tar` (`scripts/lib/
   backend-yayin.mjs` yeni `OCI_PAKET_ADI_DESENI` ve `yayinPlani` tar kabulü); PAKET.json/unzip okumaları OCI dalında
   tar'dan (`tar -xOf <paket> PAKET-DOCKER.json`), sürüm notu/terfi (`grupTerfiKapisi` urun backend-oci?)/profil kapıları
   aynen; `--pg-yayinla`/`--pg-kunye` OCI'de DUR; CI kökeni `sonuc.json`dan; defter `urun:'backend-oci'`.
3. `Teks-Erp/docker/korumali/teslim-paketle.sh`: yeni imza `<imaj-etiketi> <güncelleyici-dizini> <çıktı-dizini>`; etiket
   `tekserp-korumali:$SURUM` zorunlu; güncelleyici ELF + `kunye`yi imajda `docker run --network none --entrypoint
   /g/tekserp-guncelleyici -v dir:/g:ro` ile yeniden ölç (CI dosyasıyla eşit); gocSayisi imajdan; compose
   `sed s/@@SURUM@@/` + `@@` kalmadı denetimi; künyeye platform/gocSayisi/guncelleyici/imaj.kimlik(config özeti); sahne
   dizininde imza (`belge`), SHA256SUMS, dış tar (`--format=ustar`, uid/gid 0, `COPYFILE_DISABLE=1`, bsdtar/GNU ayrımı).
4. Bekçiler: `test_docker_hijyeni` §5c regex'leri (`$CIKTI/PAKET-DOCKER.json` → sahne değişkeni) + §7j TERSİNE (şablon
   pakete GİRMELİ, doldurulmuş; sondalar: elle compose girdi / doldurma kalktı → kırmızı) + §5k teslim satırı;
   `test_backend_yayin` yeni §3L (sentetik docker-save fikstürü TS'te: imzalı app + ince katman + config/manifest +
   dış künye `signManifestDocument` + dış tar): kuru kip · sahte hedefte `/<grup>/backend-oci/` düzeni + Windows son.json'a
   DOKUNULMAZ · imzasız taban DUR · label yok DUR · kimlik/etiket uyuşmaz DUR · zip'le --urun=backend-oci DUR · PG argümanı
   DUR; §1o `OCI_URUN_DIZINI` = protokol `RELEASE_PRODUCT_DIRS["linux-x64-oci"]`. Her yeni madde negatif sondalı.
5. G13 borcu (ucuz kısım): `Teks-Erp/docker/korumali/sahne.mjs` native kopyasından sonra `node scripts/native-capa-kipi.mjs
   <sahne native> <dist/server-kunye.json>` çağrısı + test_docker_hijyeni durağan madde + sonda. Köken borcu (Docker
   derlemesinin kayıtlı CI kökeni yok → üretim imzası `--ci-atla` ister) AÇIK kalır: önerilen kapanış imajın CI'da
   (ubuntu, buildx) derlenip yapıt olması — ayrı dilim.
6. Gerçek prova (Docker, test kökü): `prova-imaj-butunluk.mjs --birak` ile test köklü imzalı imaj → teslim-paketle.sh
   (test pkt anahtarı, çapraz derlenmiş güncelleyici) → `backend-yayinla.mjs --grup=test --urun=backend-oci --kuru` +
   ders imajı tar'ıyla imzasız taban RED. Ders imajı `tekserp-korumali:2.14.0-ders.5fb46d862` SİLİNMEZ.
7. Belgeler: GUNCELLEYICI.md §16'ya "kimlik = config özeti" + paket biçimi; runbook `docs/ops/LINUX-DOCKER-KURULUM.md` §8;
   `docs/kurallar/deploy-kurulum.md` tek satır; arşiv `docs/history/arsiv/2026-10.md` SONUNA; BEKCI-HARITASI satırları.
8. Testler: test_docker_hijyeni · test_korumali_imaj (--sonda) · prova-imaj-butunluk.mjs · test_backend_yayin ·
   test_paket_kapsami (yeşil) · test_guncelleme_protokol · prova-paket-zinciri.mjs · test_parola_kasasi · check-dagitim.

## Dokunma
L2b (Worker/satıcı belirteci), F1b satici/web, L1 Teks-Erp/native — paralel ajanlarda. Ana .env/VDS/CF/indir sunucusu ASLA.
