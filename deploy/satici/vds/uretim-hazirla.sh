#!/bin/sh
# =============================================================================
# Üretim satıcısının VDS dizinleri + iki sırrı — YARDIMCI KONTEYNERDE root olarak koşar (oguzhan'ın sudo'su
# etkileşimsiz oturumda parola ister). Yalnız hedef yollar bağlanır; `-v` eksik host dizinini root 755 yaratır:
#   docker run --rm -i --network none --user 0 -e SIR_GID=61063 \
#     -v /opt/stack/apps/tekserp-satici-uretim:/k -v /srv/tekserp-satici-yedek/uretim:/y \
#     -v /srv/tekserp-satici-dosya/uretim:/d --entrypoint sh tekserp-satici-yedek:<sha> -s < deploy/satici/vds/uretim-hazirla.sh
# İdempotent. Var olan sır dosyasının ÜSTÜNE YAZMAZ ve hiçbir sırrı basmaz (yalnız ad + sahip + izin).
# Runbook: docs/ops/SATICI-KURULUM.md §13.4-2
# =============================================================================
set -eu
: "${SIR_GID:?SIR_GID gerekli (üretim .env'indeki sayı)}"
for yol in /k /y /d; do
  [ -d "$yol" ] || { echo "bağlı değil: $yol" >&2; exit 2; }
done

install -d -m 755 -o 0 -g 0 /k/yedek-alici /k/derlemeler
install -d -m 700 -o 10001 -g 10001 /k/anahtarlar
chown 10001:10001 /y /d
chmod 700 /y /d
# 711: sudo'suz `docker compose` (oguzhan) sır dosyası yolunu çözebilsin; içerik yine 0440 root:SIR_GID.
install -d -m 711 -o 0 -g "$SIR_GID" /k/sirlar

for ad in db-parolasi ic-api-belirteci; do
  p="/k/sirlar/$ad"
  if [ -e "$p" ]; then
    echo "$ad: vardı, korundu"
    continue
  fi
  # 64 onaltılık: satici-baslat DB parolasını URL'e koyar (yalnız harf/rakam kabul eder); iç API ≥ 32 görünür ASCII ister.
  node -e 'require("fs").writeFileSync(process.argv[1], require("crypto").randomBytes(32).toString("hex"), { mode: 0o440, flag: "wx" })' "$p"
  chown "0:$SIR_GID" "$p"
  chmod 440 "$p"
  echo "$ad: üretildi (0440 root:$SIR_GID)"
done

echo "--- /k"
ls -ln /k
echo "--- /k/sirlar"
ls -ln /k/sirlar
echo "--- /y /d"
ls -lnd /y /d
