#!/bin/bash
# Senaryoları sahte klasörlerle koşar; her senaryo ayrı pwsh süreci (fonksiyon exit 1 ile biter).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${1:-$HERE/../kur.ps1}"
BASE="$(mktemp -d)"
pass=0; fail=0
check() { if [ "$2" = "1" ]; then pass=$((pass+1)); echo "  ✅ $1"; else fail=$((fail+1)); echo "  ❌ $1"; fi; }
setup() {  # $1 senaryo
  R="$BASE/$1"; rm -rf "$R"; mkdir -p "$R/app"
  printf '#!/bin/bash\necho "$@" >> "%s/pm2.log"\n' "$R" > "$R/fakepm2.sh"; chmod +x "$R/fakepm2.sh"; : > "$R/pm2.log"
  echo "$R"
}
run() { "${PWSH:-pwsh}" -NoProfile -File "$HERE/kur-gerialma.harness.ps1" -Script "$SCRIPT" -Root "$1" -Scenario "$2" >"$1/out.txt" 2>&1; echo $?; }

echo "=== $SCRIPT ==="
# S1: app.eski YOK, app\ çalışan kurulum → dokunulmamalı, pm2 start+save çağrılmalı, exit 1
R=$(setup noeski); touch "$R/app/ecosystem.config.js" "$R/app/MARKER-CALISAN"
rc=$(run "$R" noeski)
check "S1 çıkış kodu 1 (rc=$rc)" $([ "$rc" = "1" ] && echo 1 || echo 0)
check "S1 app\\ YERİNDE (MARKER-CALISAN duruyor)" $([ -f "$R/app/MARKER-CALISAN" ] && echo 1 || echo 0)
check "S1 pm2 start + save çağrıldı" $(grep -q "^start ecosystem.config.js" "$R/pm2.log" && grep -q "^save" "$R/pm2.log" && echo 1 || echo 0)
check "S1 mesaj: DOKUNULMADI" $(grep -q "DOKUNULMADI" "$R/out.txt" && echo 1 || echo 0)

# S2: app.eski VAR, app\ yeni/bozuk → app\ eskisiyle DEĞİŞMELİ, pm2 start+save, exit 1
R=$(setup eski); touch "$R/app/YENI-BOZUK"; mkdir -p "$R/app.eski-TEST"; touch "$R/app.eski-TEST/ecosystem.config.js" "$R/app.eski-TEST/MARKER-ESKI"
rc=$(run "$R" eski)
check "S2 çıkış kodu 1 (rc=$rc)" $([ "$rc" = "1" ] && echo 1 || echo 0)
check "S2 app\\ = eski kurulum (MARKER-ESKI var, YENI-BOZUK yok)" $([ -f "$R/app/MARKER-ESKI" ] && [ ! -e "$R/app/YENI-BOZUK" ] && echo 1 || echo 0)
check "S2 app.eski-TEST taşındı (artık yok)" $([ ! -e "$R/app.eski-TEST" ] && echo 1 || echo 0)
check "S2 iç içe klasör OLUŞMADI (app/app.eski-TEST yok)" $([ ! -e "$R/app/app.eski-TEST" ] && echo 1 || echo 0)
check "S2 pm2 start + save çağrıldı" $(grep -q "^start ecosystem.config.js" "$R/pm2.log" && grep -q "^save" "$R/pm2.log" && echo 1 || echo 0)

# S3: app.eski VAR ama ecosystem.config.js YOK → geri konur, pm2 ÇAĞRILMAZ, exit 1
R=$(setup eski-ecosystemsiz); touch "$R/app/YENI-BOZUK"; mkdir -p "$R/app.eski-TEST"; touch "$R/app.eski-TEST/MARKER-ESKI"
rc=$(run "$R" eski-ecosystemsiz)
check "S3 çıkış kodu 1 (rc=$rc)" $([ "$rc" = "1" ] && echo 1 || echo 0)
check "S3 app\\ geri kondu (MARKER-ESKI)" $([ -f "$R/app/MARKER-ESKI" ] && echo 1 || echo 0)
check "S3 pm2 HİÇ çağrılmadı (ecosystem yok)" $([ ! -s "$R/pm2.log" ] && echo 1 || echo 0)

echo "=== Sonuç: $pass geçti, $fail başarısız ==="
echo "(çıktılar: $BASE)"
[ $fail -eq 0 ]
