#!/usr/bin/env bash
# =============================================================================
# KORUMALI BACKEND PAKETİ — Mac'ten tek komutla thinkpad-1'de (Windows x64) derle
# =============================================================================
# Bayt kodu (.jsc) hedef platforma kilitli olduğundan Windows'ta üretilir (paketle.ps1 -Korumali).
# Rust parçaları (lisans çekirdeği .node + iki hizmet ikilisi) Mac'te cargo-xwin ile derlenir:
# thinkpad'e Rust kurulmaz. Zip Mac'e çekilir, SHA256 iki uçta eşlenir. İMZA YOK — satıcı Mac'inde
# ayrı adım (build-korumali-imza.ts zip). İki kip (varsayılan güvenli olan = prova):
#   prova  : paketle.ps1 -Prova — sürüm `<surum>-prova.<commit>`, belge/etiket yok, kur.ps1 -ProvaKabul ister.
#   gercek : --surum ZORUNLU · Mac ağacı temiz · kaynak = HEAD = origin/main'deki commit · sürüm belgesi o
#            commit'te · `backend-v<surum>` etiketi yoksa son etiketten büyük; etiket derleme SONRASI Mac'te
#            yerel atılır (push YOK). paketle.ps1 -EtiketAtma ile koşar (thinkpad'deki kopya etiketlemez).
# DERLEME KÜNYESİ: zip'in yanına `<zip>.derleme.json` (kip + sürüm · makine + ölçülen Tailscale IP · bu betiğin
# commit'i ve SHA256'sı · kaynak commit · ağaç temizliği · Rust parça özetleri · iki uçta eşleşen zip SHA256).
# İmza aracı `--derleme-kunyesi=` ile yapıtla çapraz ölçer (scripts/lib/thinkpad-kokeni.ts; kip ⇔ PAKET.json
# prova iki yönlü); künyesiz zip thinkpad kökenli imzalanmaz.
#
# Kullanım:  deploy/korumali-thinkpad.sh [--kip prova|gercek] [--surum <x.y.z>] [--ref <rev>] [--cikti <dizin>] [--kuru]
#   --kip    prova (varsayılan) | gercek
#   --surum  paketin sürümü; gercek kipte ZORUNLU (prova kipinde taban: <surum>-prova.<commit>)
#   --ref    derlenecek commit (prova varsayılanı origin/main; gercek kipte yalnız HEAD'e çözülen ref kabul)
#   --cikti  zip'in Mac'teki yeri (varsayılan ~/.tekserp/korumali-derleme)
#   --kuru   yalnız Mac kapıları + plan (paketle argümanları, atılacak etiket); thinkpad'e bağlanmaz
#   --pilde-kabul  makine pildeyse de başlat (yalnız kullanıcı cümlesiyle; şarj kesilirse derleme yarıda kalır)
# Ortam:     TP_SSH (varsayılan oguzhan@100.70.47.46) · TP_TS_IP (kimlik kapısı, varsayılan 100.70.47.46)
#
# Kapılar: argüman 2 · Mac kapısı (kirli ağaç, ana dal, belge, etiket) 3 · Tailscale kimliği tutmazsa 99 ·
# makine pildeyse 98 (runbook LISANS-DEVREYE-ALMA-TESTFABRIKA §1.3) · paketle.ps1'in kendi kapıları.
# Bekçi: scripts/test_korumali_thinkpad.mjs (kuru + sahte ssh/scp/npm ile uçtan uca).
# =============================================================================
set -euo pipefail
PIL_KABUL=0
KIP=prova
KURU=0
REF=""
CIKTI="$HOME/.tekserp/korumali-derleme"
SURUM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --kip) KIP="${2:-}"; shift $(( $# >= 2 ? 2 : 1 )) ;;
    --ref) REF="$2"; shift 2 ;;
    --cikti) CIKTI="$2"; shift 2 ;;
    --surum) SURUM="$2"; shift 2 ;;
    --kuru) KURU=1; shift ;;
    --pilde-kabul) PIL_KABUL=1; shift ;;
    *) echo "tanınmayan argüman: $1" >&2; exit 2 ;;
  esac
done
case "$KIP" in prova|gercek) ;; *) echo "--kip prova|gercek olmalı: '$KIP'" >&2; exit 2 ;; esac
if [ -n "$SURUM" ] && ! [[ "$SURUM" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "--surum x.y.z olmalı: $SURUM" >&2; exit 2; fi
if [ "$KIP" = gercek ] && [ -z "$SURUM" ]; then echo "DUR: gerçek kipte --surum x.y.z ZORUNLU (yama hanesi thinkpad'de etiketsiz sığ klondan hesaplanamaz)" >&2; exit 2; fi
TP_SSH="${TP_SSH:-oguzhan@100.70.47.46}"
TP_TS_IP="${TP_TS_IP:-100.70.47.46}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
SSH_OPT=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
bas=$(date +%s)
adim() { echo "== [$(( $(date +%s) - bas ))s] $*"; }
dur() { echo "DUR: $*" >&2; exit 3; }

# Uzak PowerShell 5.1: önce kimlik kapısı (tp.sh kalıbı), sonra gövde. Çıkış kodu korunur.
uzak() {
  local govde="\$ProgressPreference='SilentlyContinue'; \$ErrorActionPreference='Stop'
\$ip = (tailscale ip -4); if (\$ip -ne '$TP_TS_IP') { Write-Output \"KIMLIK KAPISI: YANLIS MAKINE (\$ip)\"; exit 99 }
$1"
  local enc
  enc=$(printf '%s' "$govde" | iconv -f UTF-8 -t UTF-16LE | base64)
  ssh -n "${SSH_OPT[@]}" "$TP_SSH" "powershell -NoProfile -NonInteractive -EncodedCommand $enc"
}

adim "kaynak + kip: $KIP"
git -C "$REPO" fetch -q origin
BETIK_SHA=$(shasum -a 256 "$0" | cut -d' ' -f1)
BETIK_COMMIT=$(git -C "$REPO" rev-parse HEAD)
ETIKET="" ; ETIKET_VAR=0
if [ "$KIP" = gercek ]; then
  # Gerçek sürüm yalnız ana daldaki commit'ten ve o commit'in betiğiyle: kaynak = HEAD, ağaç temiz.
  KIRLI=$(git -C "$REPO" status --porcelain)
  [ -z "$KIRLI" ] || { printf '%s\n' "$KIRLI" | head -10 >&2; dur "çalışma ağacı kirli/izlenmeyen dosya var — gerçek sürüm yalnız temiz ağaçtan"; }
  SHA=$(git -C "$REPO" rev-parse --verify "${REF:-HEAD}^{commit}") || dur "ref çözülemedi: ${REF:-HEAD}"
  [ "$SHA" = "$BETIK_COMMIT" ] || dur "kaynak (${REF:-HEAD} → ${SHA:0:12}) betiğin commit'i (HEAD ${BETIK_COMMIT:0:12}) değil — sürüm commit'ine geç (git checkout --detach <commit>) ve betiği oradan koş"
  git -C "$REPO" rev-parse -q --verify "origin/main^{commit}" >/dev/null || dur "origin/main ölçülemedi"
  git -C "$REPO" merge-base --is-ancestor "$SHA" origin/main || dur "commit ${SHA:0:12} origin/main'de değil — gerçek sürüm yalnız ana daldaki commit'ten derlenir"
  BELGE="docs/surumler/backend-$SURUM.md"
  git -C "$REPO" cat-file -e "$SHA:$BELGE" 2>/dev/null || dur "sürüm belgesi YOK: $BELGE (commit ${SHA:0:12}) — şablon docs/surumler/SABLON.md; belge main'e girmeden paket üretilmez"
  ETIKET="backend-v$SURUM"
  YEREL_ET=$(git -C "$REPO" rev-parse -q --verify "refs/tags/$ETIKET^{commit}" || true)
  UZAK_SATIR=$(git -C "$REPO" ls-remote --tags origin "refs/tags/$ETIKET" "refs/tags/$ETIKET^{}") || dur "origin etiketleri okunamadı"
  UZAK_ET=$(printf '%s\n' "$UZAK_SATIR" | awk -v e="refs/tags/$ETIKET" '$2==e"^{}"{p=$1} $2==e{q=$1} END{print (p!="" ? p : q)}')
  for ol in "$YEREL_ET" "$UZAK_ET"; do
    [ -z "$ol" ] || [ "$ol" = "$SHA" ] || dur "$ETIKET zaten başka commit'te (${ol:0:12} ≠ ${SHA:0:12}) — numara harcanmış, yeni sürüm numarası ver"
  done
  if [ -n "$UZAK_ET" ] && [ -z "$YEREL_ET" ]; then dur "$ETIKET uzakta var, yerelde yok — önce: git fetch origin tag $ETIKET"; fi
  if [ -n "$YEREL_ET" ]; then
    ETIKET_VAR=1
  else
    SON=$(git -C "$REPO" tag -l 'backend-v*' | sed 's/^backend-v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 || true)
    if [ -n "$SON" ]; then
      BUYUK=$(printf '%s\n%s\n' "$SON" "$SURUM" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
      { [ "$BUYUK" = "$SURUM" ] && [ "$SURUM" != "$SON" ]; } || dur "sürüm $SURUM son etiket backend-v$SON'dan büyük değil"
    fi
  fi
  PAKETLE_ARG="-Korumali -Surum $SURUM -EtiketAtma"
else
  SHA=$(git -C "$REPO" rev-parse --verify "${REF:-origin/main}^{commit}")
  git -C "$REPO" diff --quiet HEAD -- deploy/korumali-thinkpad.sh \
    || echo "UYARI: betik HEAD'deki sürümünden farklı — derleme künyesi imza aracında TUTMAYACAK" >&2
  PAKETLE_ARG="-Korumali -Prova"; [ -n "$SURUM" ] && PAKETLE_ARG="$PAKETLE_ARG -Surum $SURUM"
fi
REF="${REF:-$([ "$KIP" = gercek ] && echo HEAD || echo origin/main)}"
K=${SHA:0:9}
echo "  kip      $KIP"
echo "  kaynak   $SHA ($REF)"
echo "  betik    $BETIK_COMMIT"
echo "  paketle  deploy\\paketle.ps1 $PAKETLE_ARG"
if [ "$KIP" = gercek ]; then
  if [ "$ETIKET_VAR" = 1 ]; then echo "  etiket   $ETIKET zaten ${SHA:0:12}'de (yeniden atılmaz)"
  else echo "  etiket   $ETIKET → $SHA (derleme sonrası Mac'te, yerel; push YOK)"; fi
fi
if [ "$KURU" = 1 ]; then echo "KURU: thinkpad'e bağlanılmadı, derleme koşulmadı."; exit 0; fi
YEREL=$(mktemp -d "${TMPDIR:-/tmp}/korumali-thinkpad.XXXXXX")
trap 'rm -rf "$YEREL"' EXIT
mkdir -p "$CIKTI"

adim "kapı: thinkpad kimlik + priz + araçlar"
KAPI=$(uzak '
$b = Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1
if ($b -and -not $b.PowerOnline) { if ('"$PIL_KABUL"' -eq 1) { Write-Output "UYARI: thinkpad pilde - kullanici kabul etti" } else { Write-Output "PIL: thinkpad prizde degil - uzun is baslatilmaz (--pilde-kabul)"; exit 98 } }
$pw = (Get-Command pwsh -ErrorAction SilentlyContinue); if (-not $pw) { Write-Output "pwsh 7 yok"; exit 97 }
foreach ($a in "node","npm.cmd","git","tar") { if (-not (Get-Command $a -ErrorAction SilentlyContinue)) { Write-Output "arac yok: $a"; exit 97 } }
$bos = (Get-PSDrive C).Free / 1GB; if ($bos -lt 10) { Write-Output ("C: bos alan {0:N1} GB < 10" -f $bos); exit 97 }
Write-Output ("tamam: node {0} · C: {1:N0} GB bos" -f (node -v), $bos)
Write-Output ("TSIP=" + $ip)') || { kod=$?; echo "$KAPI"; exit "$kod"; }
# Uzak çıktı UTF-8 olmayabilir (PowerShell "·" gibi baytları kod sayfasıyla yollar): bayt işleyen araçlar LC_ALL=C ile koşar.
KAPI=$(printf '%s\n' "$KAPI" | LC_ALL=C tr -d '\r')
printf '%s\n' "$KAPI" | LC_ALL=C grep -v '^TSIP=' || true
TS_IP_OLCULEN=$(printf '%s\n' "$KAPI" | LC_ALL=C sed -n 's/^TSIP=//p' | head -1)
[ "$TS_IP_OLCULEN" = "$TP_TS_IP" ] || { echo "Tailscale IP ölçülemedi/tutmadı: '$TS_IP_OLCULEN'"; exit 99; }

adim "Mac: sığ klon ($K)"
git init -q "$YEREL/kaynak"
git -C "$YEREL/kaynak" fetch -q --depth 1 --upload-pack="git -c uploadpack.allowAnySHA1InWant=true upload-pack" "file://$REPO" "$SHA"
git -C "$YEREL/kaynak" -c advice.detachedHead=false checkout -q FETCH_HEAD

adim "Mac: Rust parçaları (cargo-xwin, üretim çapası)"
export CARGO_TARGET_DIR="$CIKTI/cargo-target"
( cd "$YEREL/kaynak/Teks-Erp/native/lisans-cekirdek" && npm ci --no-audit --no-fund >"$YEREL/rust.log" 2>&1 && npm run -s derle:win:uretim >>"$YEREL/rust.log" 2>&1 ) \
  || { tail -20 "$YEREL/rust.log"; echo "native lisans çekirdeği derlenemedi"; exit 1; }
( cd "$YEREL/kaynak/Teks-Erp/native" && npm run -s derle:hizmetler:win >>"$YEREL/rust.log" 2>&1 ) \
  || { tail -20 "$YEREL/rust.log"; echo "hizmet ikilileri derlenemedi"; exit 1; }
mkdir -p "$YEREL/rust"
cp "$YEREL/kaynak/Teks-Erp/native/lisans-cekirdek/dist-uretim/lisans-cekirdek.win32-x64-msvc.node" "$YEREL/rust/"
cp "$CARGO_TARGET_DIR/x86_64-pc-windows-msvc/release/tekserp-hizmet.exe" "$CARGO_TARGET_DIR/x86_64-pc-windows-msvc/release/tekserp-guncelleyici.exe" "$YEREL/rust/"
RUST_SHA=$(cd "$YEREL/rust" && shasum -a 256 lisans-cekirdek.win32-x64-msvc.node tekserp-hizmet.exe tekserp-guncelleyici.exe | awk '{print $2"="$1}' | paste -sd, -)
rm -rf "$YEREL/kaynak/Teks-Erp/native/lisans-cekirdek/node_modules" "$YEREL/kaynak/Teks-Erp/native/lisans-cekirdek/dist-uretim"
git -C "$YEREL/kaynak" status --porcelain | grep -q . && { echo "sığ klon kirlendi (Rust derlemesi)"; git -C "$YEREL/kaynak" status --short | head; exit 1; }

adim "aktarım"
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -czf "$YEREL/kaynak.tgz" -C "$YEREL/kaynak" .
COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -czf "$YEREL/rust.tgz" -C "$YEREL/rust" .
UZ="tkd\\$K"
uzak "\$d = Join-Path \$env:USERPROFILE '$UZ'; if (Test-Path \$d) { Write-Output \"uzak dizin zaten var: \$d (silinmez; elle bak)\"; exit 96 }; New-Item -ItemType Directory -Force -Path \$d | Out-Null"
scp -q "${SSH_OPT[@]}" "$YEREL/kaynak.tgz" "$YEREL/rust.tgz" "$TP_SSH:tkd/$K/"

adim "thinkpad: paketle.ps1 $PAKETLE_ARG (uzun sürer)"
set +e
uzak "
\$d = Join-Path \$env:USERPROFILE '$UZ'
New-Item -ItemType Directory -Path \"\$d\\src\",\"\$d\\rust\",\"\$d\\cikti\" -Force | Out-Null
tar -xzf \"\$d\\kaynak.tgz\" -C \"\$d\\src\"; if (\$LASTEXITCODE) { exit 95 }
tar -xzf \"\$d\\rust.tgz\" -C \"\$d\\rust\"; if (\$LASTEXITCODE) { exit 95 }
Set-Location \"\$d\\src\"
git config core.fileMode false; if (git status --porcelain) { Write-Output \"aktarilan agac temiz degil\"; git status --short | Select-Object -First 5; exit 94 }
\$ErrorActionPreference = 'Continue'
pwsh -NoProfile -ExecutionPolicy Bypass -File deploy\\paketle.ps1 $PAKETLE_ARG -NativeYol \"\$d\\rust\\lisans-cekirdek.win32-x64-msvc.node\" -HizmetIkiliDizini \"\$d\\rust\" -Cikti \"\$d\\cikti\" *>&1 | Tee-Object -FilePath \"\$d\\paketle.log\" | Select-String -Pattern '^\s*(\[|\+|X|!|==|surum=|dal=)|PAKET|SHA256|MB  \|' | ForEach-Object { \$_.Line }
exit \$LASTEXITCODE" | tee "$CIKTI/paketle-$K.log"
kod=${PIPESTATUS[0]}
set -e
[ "$kod" -eq 0 ] || { echo "paketleme DÜŞTÜ (çıkış $kod) — uzak günlük: %USERPROFILE%\\$UZ\\paketle.log"; exit "$kod"; }

adim "zip'i Mac'e çek + SHA256 eşle"
UZAKZIP=$(uzak "Get-ChildItem (Join-Path \$env:USERPROFILE '$UZ\\cikti') -Filter *.zip | ForEach-Object { \$_.Name + '|' + (Get-FileHash \$_.FullName -Algorithm SHA256).Hash.ToLower() }" | LC_ALL=C tr -d '\r')
[ "$(printf '%s\n' "$UZAKZIP" | LC_ALL=C grep -c '|')" -eq 1 ] || { echo "uzak çıktıda tek zip beklenirdi: $UZAKZIP"; exit 1; }
ZAD=${UZAKZIP%%|*}; ZSHA=${UZAKZIP##*|}
scp -q "${SSH_OPT[@]}" "$TP_SSH:tkd/$K/cikti/$ZAD" "$CIKTI/$ZAD"
MSHA=$(shasum -a 256 "$CIKTI/$ZAD" | cut -d' ' -f1)
[ "$MSHA" = "$ZSHA" ] || { echo "SHA256 TUTMADI: uzak $ZSHA · Mac $MSHA"; exit 1; }

adim "özet + derleme künyesi"
KIP="$KIP" SURUM="$SURUM" TP_MAKINE=thinkpad-1 TS_IP_OLCULEN="$TS_IP_OLCULEN" BETIK_SHA="$BETIK_SHA" BETIK_COMMIT="$BETIK_COMMIT" KAYNAK="$SHA" REF="$REF" \
  RUST_SHA="$RUST_SHA" ZSHA="$ZSHA" MSHA="$MSHA" node - "$CIKTI/$ZAD" <<'JS'
const { execFileSync } = require('node:child_process');
const zip = process.argv[2];
const e = process.env;
const liste = execFileSync('unzip', ['-Z1', zip], { maxBuffer: 1 << 28 }).toString().split('\n').filter(Boolean);
const oku = (g) => execFileSync('unzip', ['-p', zip, g], { maxBuffer: 1 << 26 });
const pkt = JSON.parse(oku(liste.find((g) => /(^|\/)PAKET\.json$/.test(g))).toString());
const kunyeYol = liste.find((g) => /dist\/server-kunye\.json$/.test(g));
const kunye = kunyeYol ? JSON.parse(oku(kunyeYol).toString()) : {};
const var_ = (re) => liste.some((g) => re.test(g));
const satir = {
  girdi: liste.length, surum: pkt.uygulamaSurumu, commit: pkt.commit, prova: pkt.prova, korumali: pkt.korumali,
  hedef: pkt.korumaHedef, runtimeNode: pkt.runtimeNodeSurumu, migration: pkt.migrationSayisi,
  jsc: var_(/dist\/server\.jsc$/), jscUretildi: kunye.jscUretildi, v8: kunye.v8Taban, capa: kunye.guvenCapasi,
  'dist/*.ts|map': liste.filter((g) => /^(app\/)?dist\/.*\.(ts|map)$/.test(g)).length,
  nodeExe: var_(/runtime\/node\.exe$/), hizmet: var_(/runtime\/tekserp-hizmet\.exe$/), guncelleyici: var_(/runtime\/tekserp-guncelleyici\.exe$/),
  native: var_(/native\/lisans-cekirdek\.win32-x64-msvc\.node$/), imzaJws: var_(/butunluk\.jws$/), seed: liste.filter((g) => /seed[^/]*\.ts$/.test(g)).length,
};
for (const [k, v] of Object.entries(satir)) console.log(`  ${k.padEnd(14)} ${v}`);
// Kip iki yönlü: prova koşusu prova paketi, gerçek koşu gerçek paketi (sürüm = --surum) üretmiş olmalı.
const gercek = e.KIP === 'gercek';
const surum = String(satir.surum ?? '');
const kipTutar = gercek
  ? satir.prova === false && surum === e.SURUM
  : satir.prova === true && (e.SURUM ? surum.startsWith(`${e.SURUM}-prova.`) : /-prova\./.test(surum));
if (!kipTutar) { console.error(`  ÖZET KAPISI: kip ${e.KIP} ama paket prova=${satir.prova} sürüm "${surum}"`); process.exit(1); }
const kotu = satir.korumali !== true || satir.hedef !== 'win-x64' || !satir.jsc || satir.jscUretildi === false || !satir.nodeExe || !satir.hizmet || !satir.guncelleyici || !satir.native || satir.seed > 0 || satir['dist/*.ts|map'] > 0;
if (kotu) { console.error('  ÖZET KAPISI: beklenen parça eksik / fazla'); process.exit(1); }
// Derleme künyesi — imza aracı (`--derleme-kunyesi`) her alanı yapıtla çapraz ölçer; bu dosya imzalı DEĞİLDİR.
const derleme = {
  v: 1, tur: 'thinkpad-derleme', zaman: new Date().toISOString(),
  kip: e.KIP, surum: e.SURUM || null,
  makine: { ad: e.TP_MAKINE, tailscaleIp: e.TS_IP_OLCULEN },
  betik: { yol: 'deploy/korumali-thinkpad.sh', commit: e.BETIK_COMMIT, sha256: e.BETIK_SHA },
  kaynak: { commit: e.KAYNAK, ref: e.REF },
  agac: { macKlonTemiz: true, uzakAgacTemiz: pkt.calismaAgaciTemiz === true },
  rust: Object.fromEntries(e.RUST_SHA.split(',').map((s) => s.split('='))),
  zip: { ad: require('node:path').basename(zip), sha256: e.MSHA, uzakSha256: e.ZSHA },
};
require('node:fs').writeFileSync(`${zip}.derleme.json`, `${JSON.stringify(derleme, null, 2)}\n`);
console.log(`  künye          ${zip}.derleme.json`);
JS
echo "  zip     $CIKTI/$ZAD"
echo "  sha256  $MSHA (iki uçta eşit)"
if [ "$KIP" = gercek ]; then
  adim "etiket (Mac, yerel; push YOK)"
  if [ "$ETIKET_VAR" = 1 ]; then
    echo "  $ETIKET zaten ${SHA:0:12}'de — yeniden atılmadı"
  else
    git -C "$REPO" tag -a "$ETIKET" "$SHA" -m "backend $SURUM — thinkpad-1 derlemesi, zip sha256 $MSHA"
    echo "  $ETIKET → $SHA atıldı (yerel)"
  fi
  echo "  push ayrı adım (test grubuna yayın kararıyla): git push origin $ETIKET"
  echo "  sürüm belgesinin Paket/SHA256/Commit satırları repoda doldurulmadı (ağaç temiz kalır; yayıncı künye commit'i = HEAD ister):"
  echo "    Paket $ZAD · SHA256 $MSHA · Commit ${SHA:0:9}"
fi
echo "  İMZASIZ — kur.ps1/kurulum imzasız korumalı paketi reddeder; imza satıcı Mac'inde ayrı adım:"
echo "    npx tsx Teks-Erp/scripts/build-korumali-imza.ts zip --zip=$CIKTI/$ZAD --anahtar=<PAKET anahtarı> --derleme-kunyesi=$CIKTI/$ZAD.derleme.json"
adim "bitti (uzak dizin %USERPROFILE%\\$UZ yerinde bırakıldı)"
