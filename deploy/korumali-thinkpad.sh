#!/usr/bin/env bash
# =============================================================================
# KORUMALI BACKEND PAKETİ — Mac'ten tek komutla thinkpad-1'de (Windows x64) derle
# =============================================================================
# Bayt kodu (.jsc) hedef platforma kilitli olduğundan Windows'ta üretilir (paketle.ps1 -Korumali).
# Rust parçaları (lisans çekirdeği .node + iki hizmet ikilisi) Mac'te cargo-xwin ile derlenir:
# thinkpad'e Rust kurulmaz. Zip Mac'e çekilir, SHA256 iki uçta eşlenir. İMZA YOK — satıcı Mac'inde
# ayrı adım (build-korumali-imza.ts zip). Yalnız PROVA paketi: etiket/push/sürüm belgesi yazılmaz.
# DERLEME KÜNYESİ: zip'in yanına `<zip>.derleme.json` (makine + ölçülen Tailscale IP · bu betiğin commit'i ve
# SHA256'sı · kaynak commit · ağaç temizliği · Rust parça özetleri · iki uçta eşleşen zip SHA256). İmza aracı
# `--derleme-kunyesi=` ile yapıtla çapraz ölçer (scripts/lib/thinkpad-kokeni.ts); künyesiz zip thinkpad kökenli imzalanmaz.
#
# Kullanım:  deploy/korumali-thinkpad.sh [--ref <rev>] [--cikti <mac-dizini>] [--surum <x.y.z>]
#   --ref    derlenecek commit (varsayılan origin/main; önce fetch edilir)
#   --cikti  zip'in Mac'teki yeri (varsayılan ~/.tekserp/korumali-derleme)
#   --pilde-kabul  makine pildeyse de başlat (yalnız kullanıcı cümlesiyle; şarj kesilirse derleme yarıda kalır)
#   --surum  paketin taban sürümü (paket yine <surum>-prova.<commit> olur; repo değişmez)
# Ortam:     TP_SSH (varsayılan oguzhan@100.70.47.46) · TP_TS_IP (kimlik kapısı, varsayılan 100.70.47.46)
#
# Kapılar: Tailscale kimliği tutmazsa 99 · makine pildeyse 98 (pilde uzun iş başlatılmaz,
# runbook LISANS-DEVREYE-ALMA-TESTFABRIKA §1.3) · paketle.ps1'in kendi kapıları (MZ, künye, çapa, zip sayımı).
# =============================================================================
set -euo pipefail
PIL_KABUL=0

REF=origin/main
CIKTI="$HOME/.tekserp/korumali-derleme"
SURUM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --cikti) CIKTI="$2"; shift 2 ;;
    --surum) SURUM="$2"; shift 2 ;;
    --pilde-kabul) PIL_KABUL=1; shift ;;
    *) echo "tanınmayan argüman: $1" >&2; exit 2 ;;
  esac
done
TP_SSH="${TP_SSH:-oguzhan@100.70.47.46}"
TP_TS_IP="${TP_TS_IP:-100.70.47.46}"
if [ -n "$SURUM" ] && ! [[ "$SURUM" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "--surum x.y.z olmalı: $SURUM" >&2; exit 2; fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"
SSH_OPT=(-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=8)
bas=$(date +%s)
adim() { echo "== [$(( $(date +%s) - bas ))s] $*"; }

# Uzak PowerShell 5.1: önce kimlik kapısı (tp.sh kalıbı), sonra gövde. Çıkış kodu korunur.
uzak() {
  local govde="\$ProgressPreference='SilentlyContinue'; \$ErrorActionPreference='Stop'
\$ip = (tailscale ip -4); if (\$ip -ne '$TP_TS_IP') { Write-Output \"KIMLIK KAPISI: YANLIS MAKINE (\$ip)\"; exit 99 }
$1"
  local enc
  enc=$(printf '%s' "$govde" | iconv -f UTF-8 -t UTF-16LE | base64)
  ssh -n "${SSH_OPT[@]}" "$TP_SSH" "powershell -NoProfile -NonInteractive -EncodedCommand $enc"
}

adim "kaynak: $REF"
git -C "$REPO" fetch -q origin
SHA=$(git -C "$REPO" rev-parse --verify "$REF^{commit}")
K=${SHA:0:9}
BETIK_SHA=$(shasum -a 256 "$0" | cut -d' ' -f1)
BETIK_COMMIT=$(git -C "$REPO" rev-parse HEAD)
git -C "$REPO" diff --quiet HEAD -- deploy/korumali-thinkpad.sh \
  || echo "UYARI: betik HEAD'deki sürümünden farklı — derleme künyesi imza aracında TUTMAYACAK" >&2
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
KAPI=$(printf '%s\n' "$KAPI" | tr -d '\r')
printf '%s\n' "$KAPI" | grep -v '^TSIP=' || true
TS_IP_OLCULEN=$(printf '%s\n' "$KAPI" | sed -n 's/^TSIP=//p' | head -1)
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

adim "thinkpad: paketle.ps1 -Korumali -Prova (uzun sürer)"
SURUM_ARG=""; [ -n "$SURUM" ] && SURUM_ARG="-Surum $SURUM"
set +e
uzak "
\$d = Join-Path \$env:USERPROFILE '$UZ'
New-Item -ItemType Directory -Path \"\$d\\src\",\"\$d\\rust\",\"\$d\\cikti\" -Force | Out-Null
tar -xzf \"\$d\\kaynak.tgz\" -C \"\$d\\src\"; if (\$LASTEXITCODE) { exit 95 }
tar -xzf \"\$d\\rust.tgz\" -C \"\$d\\rust\"; if (\$LASTEXITCODE) { exit 95 }
Set-Location \"\$d\\src\"
git config core.fileMode false; if (git status --porcelain) { Write-Output \"aktarilan agac temiz degil\"; git status --short | Select-Object -First 5; exit 94 }
\$ErrorActionPreference = 'Continue'
pwsh -NoProfile -ExecutionPolicy Bypass -File deploy\\paketle.ps1 -Korumali -Prova $SURUM_ARG -NativeYol \"\$d\\rust\\lisans-cekirdek.win32-x64-msvc.node\" -HizmetIkiliDizini \"\$d\\rust\" -Cikti \"\$d\\cikti\" *>&1 | Tee-Object -FilePath \"\$d\\paketle.log\" | Select-String -Pattern '^\s*(\[|\+|X|!|==|surum=|dal=)|PAKET|SHA256|MB  \|' | ForEach-Object { \$_.Line }
exit \$LASTEXITCODE" | tee "$CIKTI/paketle-$K.log"
kod=${PIPESTATUS[0]}
set -e
[ "$kod" -eq 0 ] || { echo "paketleme DÜŞTÜ (çıkış $kod) — uzak günlük: %USERPROFILE%\\$UZ\\paketle.log"; exit "$kod"; }

adim "zip'i Mac'e çek + SHA256 eşle"
UZAKZIP=$(uzak "Get-ChildItem (Join-Path \$env:USERPROFILE '$UZ\\cikti') -Filter *.zip | ForEach-Object { \$_.Name + '|' + (Get-FileHash \$_.FullName -Algorithm SHA256).Hash.ToLower() }" | tr -d '\r')
[ "$(printf '%s\n' "$UZAKZIP" | grep -c '|')" -eq 1 ] || { echo "uzak çıktıda tek zip beklenirdi: $UZAKZIP"; exit 1; }
ZAD=${UZAKZIP%%|*}; ZSHA=${UZAKZIP##*|}
scp -q "${SSH_OPT[@]}" "$TP_SSH:tkd/$K/cikti/$ZAD" "$CIKTI/$ZAD"
MSHA=$(shasum -a 256 "$CIKTI/$ZAD" | cut -d' ' -f1)
[ "$MSHA" = "$ZSHA" ] || { echo "SHA256 TUTMADI: uzak $ZSHA · Mac $MSHA"; exit 1; }

adim "özet + derleme künyesi"
TP_MAKINE=thinkpad-1 TS_IP_OLCULEN="$TS_IP_OLCULEN" BETIK_SHA="$BETIK_SHA" BETIK_COMMIT="$BETIK_COMMIT" KAYNAK="$SHA" REF="$REF" \
  RUST_SHA="$RUST_SHA" ZSHA="$ZSHA" MSHA="$MSHA" node - "$CIKTI/$ZAD" <<'JS'
const { execFileSync } = require('node:child_process');
const zip = process.argv[2];
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
const kotu = satir.korumali !== true || satir.prova !== true || satir.hedef !== 'win-x64' || !satir.jsc || satir.jscUretildi === false || !satir.nodeExe || !satir.hizmet || !satir.guncelleyici || !satir.native || satir.seed > 0 || satir['dist/*.ts|map'] > 0;
if (kotu) { console.error('  ÖZET KAPISI: beklenen parça eksik / fazla'); process.exit(1); }
// Derleme künyesi — imza aracı (`--derleme-kunyesi`) her alanı yapıtla çapraz ölçer; bu dosya imzalı DEĞİLDİR.
const e = process.env;
const kunye = {
  v: 1, tur: 'thinkpad-derleme', zaman: new Date().toISOString(),
  makine: { ad: e.TP_MAKINE, tailscaleIp: e.TS_IP_OLCULEN },
  betik: { yol: 'deploy/korumali-thinkpad.sh', commit: e.BETIK_COMMIT, sha256: e.BETIK_SHA },
  kaynak: { commit: e.KAYNAK, ref: e.REF },
  agac: { macKlonTemiz: true, uzakAgacTemiz: pkt.calismaAgaciTemiz === true },
  rust: Object.fromEntries(e.RUST_SHA.split(',').map((s) => s.split('='))),
  zip: { ad: require('node:path').basename(zip), sha256: e.MSHA, uzakSha256: e.ZSHA },
};
require('node:fs').writeFileSync(`${zip}.derleme.json`, `${JSON.stringify(kunye, null, 2)}\n`);
console.log(`  künye          ${zip}.derleme.json`);
JS
echo "  zip     $CIKTI/$ZAD"
echo "  sha256  $MSHA (iki uçta eşit)"
echo "  İMZASIZ — kur.ps1/kurulum imzasız korumalı paketi reddeder; imza satıcı Mac'inde ayrı adım:"
echo "    npx tsx Teks-Erp/scripts/build-korumali-imza.ts zip --zip=$CIKTI/$ZAD --anahtar=<PAKET anahtarı> --derleme-kunyesi=$CIKTI/$ZAD.derleme.json"
adim "bitti (uzak dizin %USERPROFILE%\\$UZ yerinde bırakıldı)"
