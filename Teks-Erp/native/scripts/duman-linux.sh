#!/usr/bin/env bash
# =============================================================================
# CI DUMANI — Linux güncelleyicisinin GERÇEK dünyası (T1, plan GUNCELLEYICI-SAGLAMLIK §9.1 K2 · §9.3 "K2 L")
# =============================================================================
# NE ZAMAN: yalnız CI (ubuntu-latest, parolasız sudo, gerçek systemd + Docker), `native-linux.yml`. Yerel makinede
#   KOŞMA: müşteri yolunun varsayılan köklerini (/opt/tekserp · /var/lib/tekserp — compose şablonunun bağ kaynağı
#   sabit) ve `tekserp-guncelleyici.service`i kurar, sonunda siler. `GITHUB_ACTIONS` yoksa ya da kökler/birim varsa
#   reddeder.
# DÜNYA: sahte dünyanın anahtarlarıyla imzalı GERÇEK teslim paketleri (`tests/duman_linux.rs` fikstürü): gerçek imaj
#   arşivleri (`duman-linux/Dockerfile` — node + PG istemcisi + `goc` + yedek aracı), teslim paketine giren güncelleyicili
#   compose şablonu, test çapalı ikili; yerel CDN (`duman-linux/cdn.py`, Range + yavaş kip); iş dizini küçük bir loop
#   dosya sisteminde (müşterinin ayrı küçük diski). Çapa birime `90-duman.conf` ek dosyasıyla verilir (güncelleyicinin
#   hizaladığı `50-tekserp.conf` değil).
# ÖLÇER (her adım sonunda değişmezler: current = sağlık sürümü = durum.kuruluSurum · tek backend konteyneri · yetim
#   araç konteyneri yok · `.tmp` artığı yok · birim etkin):
#   1. `kur` KURU hiçbir şey yazmaz · `kur --uygula` ilk kurulum (iskelet, paket, imaj, ilk göç, compose, birim) ·
#      ikinci `kur` "kurulum tam"
#   2. mutlu yol: yayın + kira yenilenir → OTOMATİK güncelleme BASARILI, veri korunur, göç sayısı artar
#   3. göç düşer → GERI_DONDU + veri geri yüklendi: yarım göç ve tablosu yok, önceki sürüm sağlıklı
#   4. işlem ortasında güncelleyiciye `kill -9` → systemd yeniden başlatır, günlükten sonuçlanır
#   5. işlem ortasında `systemctl restart docker` → konteynerler döner, işlem sonuçlanır
#   6. indirme sürerken iş diski (loop) dolar → DISK_DOLU görünür, artık yok, sürüm değişmez; yer açılınca BASARILI
# Argüman: TEST ÇAPALI güncelleyici ikilisi (`cargo build --release -p tekserp-guncelleyici --features test-anchor`).
# =============================================================================
set -euo pipefail

IKILI_GIRDI=$(readlink -f "${1:?kullanım: duman-linux.sh <test çapalı tekserp-guncelleyici>}")
NATIVE=$(cd "$(dirname "$0")/.." && pwd)
IMAJ_DIZINI=$NATIVE/scripts/duman-linux
SABLON=$NATIVE/../docker/korumali/docker-compose.guncelleyici.yml
KOK=/opt/tekserp
VERI=/var/lib/tekserp
AD=tekserp-guncelleyici
PROJE=tekserp
FX=/opt/tekserp-duman-fikstur
LOOP=/mnt/tekserp-duman-is.img
PORT=18480
SUNUCU=http://127.0.0.1:$PORT
G=$KOK/guncelleyici/tekserp-guncelleyici
EK=/etc/systemd/system/$AD.service.d/90-duman.conf
PG_AYNA=mirror.gcr.io/library/postgres:16-bookworm
NODE_AYNA=mirror.gcr.io/library/node:22-bookworm-slim
# sürüm · göç sayısı · göç bilerek düşer mi
SURUMLER=("0.0.1-duman 2 0" "0.0.2-duman 3 0" "0.0.3-duman 4 1" "0.0.4-duman 4 0" "0.0.5-duman 4 0" "0.0.6-duman 5 0")
KIRA=1
T0=$(date +%s)
# Fikstürün yazdığı yollar (`yollar.env`, güncelleyicinin düzeninden) — temizlik erken düşerse de tanımlı olsun.
NIYET="" DURUM=/yok LISANS="" IS="" KANAL=""

adim() { printf '\n== [%ss] %s\n' "$(($(date +%s) - T0))" "$*"; }
dur() {
  echo "::error title=T1 Linux dumanı::$*" >&2
  exit 1
}
durum() { sudo jq -r "$1" "$DURUM" 2>/dev/null || true; }
saglik() { curl -fsS --max-time 5 "http://127.0.0.1:4000/health/yerel" 2>/dev/null | jq -r '.version + " " + .db' || true; }
konteyner() { docker ps -q --filter "label=com.docker.compose.project=$PROJE" --filter "label=com.docker.compose.service=$1"; }
pgc() { docker exec "$(konteyner postgres)" psql -U tekserp -d tekserp -X -tAc "$1"; }
calisan_surum() { basename "$(sudo readlink "$KOK/current")"; }

if [ "${GITHUB_ACTIONS:-}" != true ]; then dur "yalnız CI'da koşar (GITHUB_ACTIONS=true değil)"; fi
for y in "$KOK" "$VERI" "$FX" "/etc/systemd/system/$AD.service"; do
  if sudo test -e "$y"; then dur "$y zaten var — duman gerçek kuruluma dokunmaz"; fi
done

temizle() {
  local rc=$?
  set +e
  if [ "$rc" != 0 ]; then
    echo "── TANI (çıkış $rc) ──"
    sudo cat "$DURUM" 2>/dev/null
    sudo journalctl -u "$AD.service" --no-pager -n 120
    sudo sh -c "tail -n 80 $KOK/guncelleyici/gunluk/*.log" 2>/dev/null
    docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}'
    [ -n "$(konteyner backend)" ] && docker logs --tail 30 "$(konteyner backend)"
    tail -n 30 "$FX/cdn/istek.log" 2>/dev/null
    df -h "${IS:-/}" 2>/dev/null
  fi
  [ -n "${CDN_PID:-}" ] && kill "$CDN_PID" 2>/dev/null
  sudo systemctl disable --now "$AD.service" >/dev/null 2>&1
  [ -x "$G" ] && sudo "$G" hizmet-kaldir --ad "$AD" >/dev/null 2>&1
  sudo rm -rf "/etc/systemd/system/$AD.service.d" "/etc/systemd/system/$AD.service"
  sudo systemctl daemon-reload
  docker ps -aq --filter "label=com.docker.compose.project=$PROJE" | xargs -r docker rm -f >/dev/null
  docker ps -aq --filter "name=tekserp-arac-" | xargs -r docker rm -f >/dev/null
  docker volume ls -q --filter "label=com.docker.compose.project=$PROJE" | xargs -r docker volume rm >/dev/null
  docker network ls -q --filter "label=com.docker.compose.project=$PROJE" | xargs -r docker network rm >/dev/null
  if [ -n "${IS:-}" ] && mountpoint -q "$IS"; then sudo umount "$IS" || sudo umount -l "$IS"; fi
  sudo rm -rf "$KOK" "$VERI" "$FX" "$LOOP"
  exit "$rc"
}
trap temizle EXIT

# Değişmezler (her senaryonun sonunda): kurulu sürüm üç yerden aynı, tek backend, yetim/artık yok, birim etkin.
degismez() {
  local v=$1 s
  s=$(saglik)
  [ "$(calisan_surum)" = "$v" ] || dur "$2: current $(calisan_surum), beklenen $v"
  [ "$s" = "$v DOWN" ] || dur "$2: sağlık '$s', beklenen '$v UP'"
  [ "$(durum .kuruluSurum)" = "$v" ] || dur "$2: durum.kuruluSurum $(durum .kuruluSurum), beklenen $v"
  [ "$(konteyner backend | wc -l)" = 1 ] || dur "$2: backend konteyneri $(konteyner backend | wc -l) adet"
  [ -z "$(docker ps -aq --filter name=tekserp-arac-)" ] || dur "$2: yetim araç konteyneri: $(docker ps -a --filter name=tekserp-arac- --format '{{.Names}}')"
  local tmp
  tmp=$(sudo find "$KOK" "$VERI" -name '*.tmp' 2>/dev/null)
  [ -z "$tmp" ] || dur "$2: yarım .tmp artığı: $tmp"
  [ "$(systemctl is-active "$AD.service")" = active ] || dur "$2: birim etkin değil"
  echo "   değişmezler tamam ($2: $v)"
}

# Sürüm yayınlanır (işaretçi), kira yenilenir, niyet tazelenir (güncelleyici niyet değişince uyanır, kira yenilenince sorar).
yayinla() {
  KIRA=$((KIRA + 1))
  cp "$KANAL/$1/surum.json" "$KANAL/.son.json" && mv -f "$KANAL/.son.json" "$KANAL/son.json"
  sudo install -m 0600 "$FX/lisans/kira-$KIRA.jws" "$LISANS/kira.jws"
  sudo sh -c "jq --arg t '$(date -u +%Y-%m-%dT%H:%M:%S.000Z)' '.yazildi = \$t' '$FX/niyet.json' > '$NIYET.yeni' && chown 10001:10001 '$NIYET.yeni' && chmod 0600 '$NIYET.yeni' && mv -f '$NIYET.yeni' '$NIYET'"
  echo "   yayın $1 · kira-$KIRA"
}

# İşlem sonuçlanana dek (son.hedefSurum = v ve UYGULANIYOR değil); sonucu basar.
bekle_sonuc() {
  local v=$1 sure=${2:-600}
  for _ in $(seq $((sure * 2))); do
    if [ "$(durum .son.hedefSurum)" = "$v" ] && [ "$(durum .durum)" != UYGULANIYOR ]; then
      durum .son.sonuc
      return 0
    fi
    sleep 0.5
  done
  dur "$v: ${sure} sn'de sonuçlanmadı (durum $(durum .durum) · adım $(durum .adim) · kod $(durum .hataKodu))"
}

bekle_durum() {
  local d=$1 sure=$2
  for _ in $(seq $((sure * 2))); do
    [ "$(durum .durum)" = "$d" ] && return 0
    sleep 0.5
  done
  dur "durum $d olmadı ($sure sn; durum $(durum .durum) · kod $(durum .hataKodu))"
}

adim "0. hazırlık: imajlar, fikstür, loop iş diski, yerel CDN"
echo "systemd: $(systemctl --version | head -1) · docker $(docker version --format '{{.Server.Version}}') · $(docker compose version)"
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0755 "$FX"
install -m 0755 "$IKILI_GIRDI" "$FX/tekserp-guncelleyici"
"$FX/tekserp-guncelleyici" kunye >"$FX/kunye.json"
jq -e '.testCapasi == true and .hedef == "linux"' "$FX/kunye.json" >/dev/null || dur "ikili test çapalı Linux derlemesi değil: $(cat "$FX/kunye.json")"
for i in "$PG_AYNA" "$NODE_AYNA"; do
  for deneme in 1 2 3; do docker pull -q "$i" && break; [ "$deneme" = 3 ] && dur "$i çekilemedi"; sleep 20; done
done
docker tag "$PG_AYNA" postgres:16-bookworm
surum_json="[]"
for s in "${SURUMLER[@]}"; do
  read -r v goc duser <<<"$s"
  docker build -q -t "tekserp-korumali:$v" --build-arg PG_IMAJ="$PG_AYNA" --build-arg NODE_IMAJ="$NODE_AYNA" \
    --build-arg SURUM="$v" --build-arg GOC_SAYISI="$goc" --build-arg GOC_DUSER="$duser" "$IMAJ_DIZINI" >/dev/null
  docker save "tekserp-korumali:$v" | gzip -1 >"$FX/imaj-$v.tar.gz"
  docker image rm -f "tekserp-korumali:$v" >/dev/null
  surum_json=$(jq -c --arg v "$v" --argjson g "$goc" --arg a "$FX/imaj-$v.tar.gz" '. + [{surum: $v, gocSayisi: $g, arsiv: $a}]' <<<"$surum_json")
done
jq -n --arg s "$SABLON" --arg g "$FX/tekserp-guncelleyici" --arg k "$FX/kunye.json" --arg kok "$KOK" --arg veri "$VERI" \
  --argjson sv "$surum_json" '{sablon: $s, guncelleyici: $g, kunye: $k, kok: $kok, veri: $veri, kiraSayisi: 8, surumler: $sv}' >"$FX/girdi.json"
(cd "$NATIVE" && TEKSERP_DUMAN_LINUX=$FX cargo test -q --release --locked -p tekserp-guncelleyici --test duman_linux -- --ignored --exact duman_linux_hazirla)
rm -f "$FX"/imaj-*.tar.gz
# shellcheck source=/dev/null
. "$FX/yollar.env"
sudo truncate -s 3G "$LOOP"
sudo mkfs.ext4 -q -m 0 -F "$LOOP"
sudo install -d -m 0700 "$IS"
sudo mount -o loop "$LOOP" "$IS"
sudo install -d -m 0700 "$LISANS"
sudo install -m 0600 "$FX/lisans/kira-1.jws" "$LISANS/kira.jws"
sudo install -m 0600 "$FX/lisans/hak.jws" "$LISANS/hak.jws"
V1=$(cut -d' ' -f1 <<<"${SURUMLER[0]}")
cp "$KANAL/$V1/surum.json" "$KANAL/son.json"
python3 -I "$IMAJ_DIZINI/cdn.py" "$FX/cdn" "$PORT" &
CDN_PID=$!
for _ in $(seq 20); do curl -fsS -o /dev/null "$SUNUCU/testkanal/backend-oci/son.json" && break; sleep 0.5; done
sudo install -d -m 0755 "/etc/systemd/system/$AD.service.d"
printf '[Service]\nEnvironment=TEKSERP_TEST_CAPASI=%s/capa.json\n' "$FX" | sudo tee "$EK" >/dev/null
sudo install -d -m 0700 "$KOK/yapilandirma"
printf 'POSTGRES_PASSWORD=duman-%s\nJWT_SECRET=duman-jwt-%s\n' "$RANDOM$RANDOM" "$RANDOM$RANDOM" | sudo tee "$KOK/yapilandirma/.env" >/dev/null
sudo chmod 0600 "$KOK/yapilandirma/.env"

KUR=(sudo env "TEKSERP_TEST_CAPASI=$FX/capa.json" "$FX/tekserp-guncelleyici" kur --tar "$FX/paket/tekserp-backend-oci-$V1.tar" --proje "$PROJE" --sunucu "$SUNUCU")

adim "1. kur: KURU → --uygula → yeniden (kurulum tam)"
"${KUR[@]}" | tee "$FX/kur-kuru.txt"
grep -q "KURU koşum" "$FX/kur-kuru.txt" || dur "KURU koşum satırı yok"
if sudo test -e "$KOK/current" || sudo test -e "$KOK/surumler"; then dur "KURU koşum diske yazdı"; fi
"${KUR[@]}" --uygula | tee "$FX/kur.txt"
grep -q "^TAMAM: kurulum $V1" "$FX/kur.txt" || dur "kur --uygula TAMAM demedi"
[ "$(systemctl is-enabled "$AD.service")" = enabled ] || dur "birim etkin (enabled) değil"
systemctl show -p DropInPaths --value "$AD.service" | grep -q 50-tekserp.conf || dur "güncelleyicinin ek dosyası yok"
sudo "$G" kunye | jq -e '.testCapasi == true' >/dev/null || dur "kurulan ikili paketteki test çapalı ikili değil"
for _ in $(seq 120); do [ "$(durum .kuruluSurum)" = "$V1" ] && break; sleep 0.5; done
degismez "$V1" "ilk kurulum"
[ "$(pgc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")" = 2 ] || dur "ilk göç sayısı 2 değil"
"${KUR[@]}" --uygula | tee "$FX/kur2.txt"
grep -q "kurulum tam" "$FX/kur2.txt" || dur "ikinci kur 'kurulum tam' demedi"
pgc "CREATE TABLE duman_veri (id int PRIMARY KEY, ad text); INSERT INTO duman_veri SELECT g, 'satir ' || g FROM generate_series(1, 500) g;" >/dev/null

adim "2. mutlu yol: 0.0.2-duman OTOMATİK"
yayinla 0.0.2-duman
[ "$(bekle_sonuc 0.0.2-duman)" = BASARILI ] || dur "0.0.2-duman BASARILI değil: $(durum .son)"
degismez 0.0.2-duman "mutlu yol"
[ "$(pgc "SELECT count(*) FROM duman_veri")" = 500 ] || dur "veri korunmadı"
[ "$(pgc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")" = 3 ] || dur "göç sayısı 3 değil"

adim "3. göç düşer: 0.0.3-duman → GERI_DONDU + veri geri yüklendi"
pgc "INSERT INTO duman_veri VALUES (501, 'gocten once')" >/dev/null
yayinla 0.0.3-duman
[ "$(bekle_sonuc 0.0.3-duman)" = GERI_DONDU ] || dur "0.0.3-duman GERI_DONDU değil: $(durum .son)"
[ "$(durum .son.veriGeriYuklendi)" = true ] || dur "veri geri yüklenmedi: $(durum .son)"
degismez 0.0.2-duman "göç düşer"
[ "$(pgc "SELECT count(*) FROM duman_veri")" = 501 ] || dur "geri yükleme veriyi korumadı"
[ "$(pgc "SELECT count(*) FROM _prisma_migrations")" = 3 ] || dur "yarım göç satırı geri yüklemeden sonra duruyor"
[ -z "$(pgc "SELECT to_regclass('public.duman_yarim')")" ] || dur "düşen göçün tablosu duruyor"

adim "4. işlem ortasında kill -9: 0.0.4-duman"
yayinla 0.0.4-duman
bekle_durum UYGULANIYOR 300
eski_pid=$(systemctl show -p MainPID --value "$AD.service")
echo "   adım $(durum .adim) · pid $eski_pid → SIGKILL"
sudo kill -9 "$eski_pid"
sonuc=$(bekle_sonuc 0.0.4-duman)
yeni_pid=$(systemctl show -p MainPID --value "$AD.service")
[ "$yeni_pid" != "$eski_pid" ] && [ "$yeni_pid" != 0 ] || dur "systemd güncelleyiciyi yeniden başlatmadı"
echo "   sonuç $sonuc (yeni pid $yeni_pid · NRestarts $(systemctl show -p NRestarts --value "$AD.service"))"
case "$sonuc" in BASARILI) v4=0.0.4-duman ;; GERI_DONDU) v4=0.0.2-duman ;; *) dur "kill -9 sonrası sonuç $sonuc" ;; esac
degismez "$v4" "kill -9"
[ "$(pgc "SELECT count(*) FROM duman_veri")" = 501 ] || dur "kill -9 sonrası veri değişti"

adim "5. işlem ortasında systemctl restart docker: 0.0.5-duman"
yayinla 0.0.5-duman
bekle_durum UYGULANIYOR 300
echo "   adım $(durum .adim) → systemctl restart docker"
sudo systemctl restart docker
sonuc=$(bekle_sonuc 0.0.5-duman 900)
echo "   sonuç $sonuc"
case "$sonuc" in BASARILI) v5=0.0.5-duman ;; GERI_DONDU) v5=$v4 ;; *) dur "Docker yeniden başlatması sonrası sonuç $sonuc" ;; esac
for _ in $(seq 120); do [ "$(saglik)" = "$v5 UP" ] && break; sleep 1; done
degismez "$v5" "docker restart"
[ "$(pgc "SELECT count(*) FROM duman_veri")" = 501 ] || dur "Docker yeniden başlatması sonrası veri değişti"

adim "6. indirme sürerken iş diski dolar: 0.0.6-duman → DISK_DOLU → yer açılınca BASARILI"
touch "$FX/cdn/.yavas"
yayinla 0.0.6-duman
bekle_durum INDIRILIYOR 300
bos=$(df --output=avail -B1 "$IS" | tail -1)
sudo fallocate -l "$bos" "$IS/dolgu" || true
sudo dd if=/dev/zero of="$IS/dolgu2" bs=1M status=none 2>/dev/null || true
echo "   iş diski dolu: $(df -h --output=avail "$IS" | tail -1 | tr -d ' ') boş"
for _ in $(seq 600); do
  [ "$(sudo jq -r '[.hataKodu, .sonAyrinti.hataKodu, .son.kod] | index("DISK_DOLU") != null' "$DURUM" 2>/dev/null)" = true ] && break
  sleep 0.5
done
[ "$(sudo jq -r '[.hataKodu, .sonAyrinti.hataKodu, .son.kod] | index("DISK_DOLU") != null' "$DURUM")" = true ] || dur "DISK_DOLU görünmedi: $(sudo cat "$DURUM")"
echo "   durum $(durum .durum) · kod DISK_DOLU · ileti: $(durum .mesaj)"
degismez "$v5" "disk dolu"
sudo rm -f "$IS/dolgu" "$IS/dolgu2" "$FX/cdn/.yavas"
yayinla 0.0.6-duman
[ "$(bekle_sonuc 0.0.6-duman)" = BASARILI ] || dur "yer açılınca 0.0.6-duman BASARILI değil: $(durum .son)"
degismez 0.0.6-duman "disk dolu sonrası"
[ "$(pgc "SELECT count(*) FROM duman_veri")" = 501 ] || dur "veri korunmadı"
[ "$(pgc "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")" = 5 ] || dur "göç sayısı 5 değil"

adim "7. durdurma temiz"
sudo systemctl stop "$AD.service"
[ "$(systemctl show -p Result --value "$AD.service")" = success ] || dur "durdurma sonucu $(systemctl show -p Result --value "$AD.service")"
echo "TAMAM: T1 Linux dumanı ($(($(date +%s) - T0)) sn)"
