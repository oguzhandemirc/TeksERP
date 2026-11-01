#!/usr/bin/env bash
# =============================================================================
# TeksERP barındırma kontrol listesi — bizim yönettiğimiz bulut VDS'inin KABUL KAPISI (SALT OKUR)
# =============================================================================
# Denetim 2026-11-01 O9. Sunucuda root olarak koşar; HİÇBİR ŞEYİ DEĞİŞTİRMEZ (yalnız ss/ufw status/sshd -T/
# fail2ban-client status/docker inspect/nginx -T/ls/stat/curl okuması). Sır basmaz: konteyner ortamından yalnız
# İZİNLİ anahtarlar okunur; yedek dosyalarının yalnız adı/yaşı.
#
# Kullanım (Mac'ten):  ssh <sunucu> 'bash -s' -- --ad <kanal>.etkiliyazilim.com < deploy/bulut/barindirma-kontrol.sh
#           (sunucuda): bash barindirma-kontrol.sh --ad <ad> [--proje <compose projesi>] [--kenar <konteyner>] [--cek-damga <dosya>]
# Her madde: YEŞİL / KIRMIZI / ÖLÇÜLEMEDİ. Çıkış kodu = KIRMIZI sayısı (en çok 100); ÖLÇÜLEMEDİ kırmızı sayılmaz
# ama özet satırında görünür. Bekçi: scripts/test_bulut_kenar.mjs §3. Runbook: docs/ops/LINUX-DOCKER-KURULUM.md §10.
# =============================================================================
set -u
export LC_ALL=C

AD=""
PROJE=""
KENAR=""
YEDEK_AZAMI_SAAT="${YEDEK_AZAMI_SAAT:-26}"
CEKIM_AZAMI_SAAT="${CEKIM_AZAMI_SAAT:-26}"
CEK_DAMGA="/var/lib/tekserp-cek/son-cekim"
while [ $# -gt 0 ]; do
  case "$1" in
    --ad) AD="${2:-}"; shift 2 ;;
    --proje) PROJE="${2:-}"; shift 2 ;;
    --kenar) KENAR="${2:-}"; shift 2 ;;
    --cek-damga) CEK_DAMGA="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" 2>/dev/null; exit 0 ;;
    *) echo "tanınmayan argüman: $1" >&2; exit 100 ;;
  esac
done

YESIL=0; KIRMIZI=0; OLCULEMEDI=0
yesil() { YESIL=$((YESIL + 1)); printf 'YEŞİL       %s\n' "$*"; }
kirmizi() { KIRMIZI=$((KIRMIZI + 1)); printf 'KIRMIZI     %s\n' "$*"; }
olculemedi() { OLCULEMEDI=$((OLCULEMEDI + 1)); printf 'ÖLÇÜLEMEDİ  %s\n' "$*"; }
var() { command -v "$1" >/dev/null 2>&1; }
bolum() { printf '\n== %s\n' "$*"; }

# --- 1. Ağ kenarı ------------------------------------------------------------
bolum "Ağ kenarı (ss · ufw)"
if var ss; then
  DINLEYEN=$(ss -Hltn 2>/dev/null | awk '{print $4}')
  ACIK_API=$(printf '%s\n' "$DINLEYEN" | grep -E ':(4000|5432)$' | grep -vE '^(127\.0\.0\.1|\[::1\]):' || true)
  if [ -n "$ACIK_API" ]; then kirmizi "4000/5432 döngü adresi dışında dinliyor: ${ACIK_API//$'\n'/ }"; else yesil "4000/5432 yalnız döngü adresinde (ya da hiç)"; fi
  if printf '%s\n' "$DINLEYEN" | grep -qE ':443$'; then yesil "443 dinleniyor (kenar)"; else kirmizi "443 dinlenmiyor (kenar ayakta değil)"; fi
else
  olculemedi "ss yok"
fi
if var ufw; then
  UFW=$(ufw status verbose 2>/dev/null || true)
  if printf '%s\n' "$UFW" | grep -q '^Status: active'; then yesil "ufw etkin"; else kirmizi "ufw etkin değil"; fi
  if printf '%s\n' "$UFW" | grep -q 'deny (incoming)'; then yesil "ufw gelen varsayılanı RED"; else kirmizi "ufw gelen varsayılanı RED değil"; fi
  # 443 kuralının kaynağı Anywhere ise Cloudflare süzgeci delinmiş demektir.
  HERKESE=$(ufw status 2>/dev/null | grep -E '^443(/tcp)?([[:space:]]|\(v6\))' | grep -E 'Anywhere([[:space:]]|\(v6\))*$' || true)
  CF443=$(ufw status 2>/dev/null | grep -cE '^443(/tcp)?.*ALLOW' || true)
  if [ -n "$HERKESE" ]; then kirmizi "443 herkese açık (yalnız Cloudflare olmalı)"
  elif [ "${CF443:-0}" -gt 0 ]; then yesil "443 yalnız kaynaklı kurallarla açık ($CF443 kural)"
  else kirmizi "443 için izin kuralı yok"; fi
else
  olculemedi "ufw yok"
fi

# --- 2. SSH (D5) ---------------------------------------------------------------
bolum "SSH (sshd -T)"
if var sshd; then
  SSHD=$(sshd -T 2>/dev/null || true)
  if [ -z "$SSHD" ]; then olculemedi "sshd -T okunamadı (root gerekir)"; else
    deger() { printf '%s\n' "$SSHD" | awk -v k="$1" '$1==k {print $2; exit}'; }
    beklenen() { # anahtar beklenen
      local d; d=$(deger "$1")
      if [ "$d" = "$2" ]; then yesil "sshd $1 $d"; else kirmizi "sshd $1 ${d:-?} (beklenen $2)"; fi
    }
    beklenen permitrootlogin no
    beklenen passwordauthentication no
    beklenen kbdinteractiveauthentication no
    beklenen x11forwarding no
    beklenen allowtcpforwarding no
    beklenen allowagentforwarding no
    LG=$(deger logingracetime); if [ -n "$LG" ] && [ "$LG" -le 30 ] 2>/dev/null; then yesil "sshd logingracetime $LG"; else kirmizi "sshd logingracetime ${LG:-?} (≤30)"; fi
    MA=$(deger maxauthtries); if [ -n "$MA" ] && [ "$MA" -le 3 ] 2>/dev/null; then yesil "sshd maxauthtries $MA"; else kirmizi "sshd maxauthtries ${MA:-?} (≤3)"; fi
    if printf '%s\n' "$SSHD" | grep -q '^allowusers '; then yesil "sshd AllowUsers tanımlı"; else kirmizi "sshd AllowUsers yok"; fi
  fi
else
  olculemedi "sshd yok"
fi

# --- 3. fail2ban ---------------------------------------------------------------
bolum "fail2ban"
if var fail2ban-client; then
  F2B=$(fail2ban-client status 2>/dev/null || true)
  if [ -z "$F2B" ]; then kirmizi "fail2ban yanıt vermiyor"; else
    yesil "fail2ban ayakta"
    if printf '%s\n' "$F2B" | grep -q 'sshd'; then yesil "fail2ban sshd hapsi"; else kirmizi "fail2ban sshd hapsi yok"; fi
    if printf '%s\n' "$F2B" | grep -q 'recidive'; then yesil "fail2ban recidive hapsi"; else kirmizi "fail2ban recidive hapsi yok"; fi
  fi
else
  kirmizi "fail2ban kurulu değil"
fi

# --- 4. Çekirdek yamaları (O6) -------------------------------------------------
bolum "Çekirdek ve otomatik güncelleme"
if [ -e /var/run/reboot-required ]; then
  GUN=$(( ( $(date +%s) - $(stat -c %Y /var/run/reboot-required 2>/dev/null || date +%s) ) / 86400 ))
  kirmizi "yeniden başlatma bekliyor ($GUN gündür)"
else
  yesil "bekleyen yeniden başlatma yok"
fi
if var apt-config; then
  AR=$(apt-config dump 2>/dev/null | awk -F'"' '/^Unattended-Upgrade::Automatic-Reboot /{print $2}')
  if [ "$AR" = "true" ]; then yesil "unattended-upgrades otomatik yeniden başlatma açık"; else kirmizi "unattended-upgrades Automatic-Reboot ${AR:-tanımsız} (true olmalı)"; fi
else
  olculemedi "apt-config yok"
fi

# --- 5. Docker: backend ortamı, kaynak sınırları, yedek ------------------------
bolum "Konteynerler"
if ! var docker; then
  olculemedi "docker yok — konteyner maddeleri atlandı"
else
  # Backend: proje verilmediyse imaj adı tekserp-korumali olan konteyner.
  if [ -n "$PROJE" ]; then
    BACKEND=$(docker ps --filter "label=com.docker.compose.project=$PROJE" --filter "label=com.docker.compose.service=backend" --format '{{.Names}}' | head -n1)
  else
    BACKEND=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /tekserp-korumali/ && $1 !~ /yedek/ {print $1; exit}')
  fi
  if [ -z "$BACKEND" ]; then olculemedi "backend konteyneri bulunamadı (--proje verin)"; else
    [ -n "$PROJE" ] || PROJE=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$BACKEND" 2>/dev/null)
    # Yalnız izinli anahtarlar: JWT_SECRET/DATABASE_URL gibi sırlar bu süzgeçten geçmez.
    ENV=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$BACKEND" 2>/dev/null \
      | grep -E '^(TRUST_PROXY|RATE_LIMIT_ENABLED|RATE_LIMIT_WINDOW_SEC|RATE_LIMIT_WRITE_MAX|RATE_LIMIT_LOGIN_MAX|HTTPS_ENABLED|CORS_ORIGINS|TEKSERP_KURULUM_SINIFI|LOGIN_LOCKOUT_SCOPE)=' || true)
    env_d() { printf '%s\n' "$ENV" | awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}'; }
    esit() { local d; d=$(env_d "$1"); if [ "$d" = "$2" ]; then yesil "backend $1=$d"; else kirmizi "backend $1=${d:-boş} (beklenen $2)"; fi; }
    esit TEKSERP_KURULUM_SINIFI BARINDIRILAN
    esit TRUST_PROXY 1
    esit RATE_LIMIT_ENABLED true
    esit HTTPS_ENABLED true
    printf 'BİLGİ       hız sınırı (- = kod varsayılanı): pencere=%s yazma=%s giriş=%s · CORS_ORIGINS=%s\n' \
      "$(env_d RATE_LIMIT_WINDOW_SEC | grep . || echo -)" "$(env_d RATE_LIMIT_WRITE_MAX | grep . || echo -)" \
      "$(env_d RATE_LIMIT_LOGIN_MAX | grep . || echo -)" "$(env_d CORS_ORIGINS | grep . || echo -)"
    API_PORT=$(docker port "$BACKEND" 4000/tcp 2>/dev/null || true)
    if [ -z "$API_PORT" ] || ! printf '%s\n' "$API_PORT" | grep -qvE '^(127\.0\.0\.1|\[::1\]):'; then yesil "API portu yalnız döngü adresinde yayımlı"; else kirmizi "API portu dışarıya yayımlı: ${API_PORT//$'\n'/ }"; fi
  fi
  # Kaynak sınırı: tek çekirdeği bir konteyner yerse fabrika durur (K1).
  if [ -n "$PROJE" ]; then
    for c in $(docker ps --filter "label=com.docker.compose.project=$PROJE" --format '{{.Names}}'); do
      read -r NCPU NMEM <<<"$(docker inspect -f '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}' "$c" 2>/dev/null)"
      if [ "${NCPU:-0}" != "0" ] && [ "${NMEM:-0}" != "0" ]; then yesil "$c kaynak sınırlı (cpu=$NCPU bellek=$NMEM)"; else kirmizi "$c kaynak sınırı yok (NanoCpus=${NCPU:-?} Memory=${NMEM:-?})"; fi
    done
  fi

  # Yedek birimi: son .tkenc yaşı, şifresiz .dump varlığı.
  YEDEK_KOK=""
  [ -n "$PROJE" ] && YEDEK_KOK=$(docker volume inspect -f '{{.Mountpoint}}' "${PROJE}_yedek" 2>/dev/null || true)
  if [ -z "$YEDEK_KOK" ] || [ ! -d "$YEDEK_KOK" ]; then olculemedi "yedek birimi bulunamadı (${PROJE:-?}_yedek)"; else
    SON=$(find "$YEDEK_KOK" -maxdepth 2 -type f -name '*.dump.tkenc' -printf '%T@ %f\n' 2>/dev/null | sort -n | tail -n1)
    if [ -z "$SON" ]; then kirmizi "şifreli yedek (.tkenc) yok"; else
      YAS=$(( ( $(date +%s) - ${SON%%.*} ) / 3600 ))
      if [ "$YAS" -le "$YEDEK_AZAMI_SAAT" ]; then yesil "son şifreli yedek $YAS saat önce"; else kirmizi "son şifreli yedek $YAS saat önce (≤$YEDEK_AZAMI_SAAT)"; fi
    fi
    DUZ=$(find "$YEDEK_KOK" -maxdepth 2 -type f \( -name '*.dump' -o -name '*.sql' -o -name '*.dump.part' \) 2>/dev/null | wc -l)
    if [ "$DUZ" -eq 0 ]; then yesil "şifresiz döküm yok"; else kirmizi "şifresiz döküm var ($DUZ dosya)"; fi
  fi
  # Makine dışı kopya (K2): yedek VDS'i çeker (deploy/bulut/yedek-cek); çekme kapısı her başarılı çekimde damga yazar.
  if [ ! -f "$CEK_DAMGA" ]; then kirmizi "makine dışı çekim hiç yapılmamış ($CEK_DAMGA yok — docs/ops/BULUT-YEDEK-CEKME.md)"; else
    CEK_YAS=$(( ( $(date +%s) - $(cat "$CEK_DAMGA" 2>/dev/null || echo 0) ) / 3600 ))
    if [ "$CEK_YAS" -le "$CEKIM_AZAMI_SAAT" ]; then yesil "son makine dışı çekim $CEK_YAS saat önce"; else kirmizi "son makine dışı çekim $CEK_YAS saat önce (≤$CEKIM_AZAMI_SAAT)"; fi
  fi

  # Kenar nginx yapılandırması (nginx -T yalnız okur).
  [ -n "$KENAR" ] || KENAR=$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /nginx/ {print $1; exit}')
  if [ -z "$KENAR" ]; then olculemedi "kenar konteyneri bulunamadı (--kenar verin)"; else
    NT=$(docker exec "$KENAR" nginx -T 2>/dev/null || true)
    if [ -z "$NT" ]; then olculemedi "kenar nginx -T okunamadı"; else
      if printf '%s\n' "$NT" | grep -q 'zone=kenar_ip:' && printf '%s\n' "$NT" | grep -q 'zone=kenar_giris_ip:' && printf '%s\n' "$NT" | grep -q 'zone=kenar_giris:'; then yesil "kenar hız bölgeleri (genel + IP giriş + toplam giriş)"; else kirmizi "kenar limit_req bölgeleri yok"; fi
      if printf '%s\n' "$NT" | grep -qE '^[[:space:]]*ssl_verify_client[[:space:]]+on;'; then yesil "kenar AOP (ssl_verify_client on)"; else kirmizi "kenar AOP yok (ssl_verify_client)"; fi
      if printf '%s\n' "$NT" | grep -qE '^[[:space:]]*access_log[^;]*tekserp_kenar;'; then yesil "kenar günlüğü sorgu dizesiz biçimde"; else kirmizi "kenar günlüğü varsayılan biçimde (sorgu dizesi düz yazılır)"; fi
      if printf '%s\n' "$NT" | grep -qE '^[[:space:]]*ssl_protocols[[:space:]]+TLSv1\.2 TLSv1\.3;'; then yesil "kenar TLS 1.2+"; else kirmizi "kenar ssl_protocols TLSv1.2 TLSv1.3 değil"; fi
    fi
  fi
fi

# --- 6. Donanım asgarisi (BULUT-KURULUM.md: ≥2 vCPU / 4 GB) -------------------
bolum "Donanım"
CPU=$(nproc 2>/dev/null || echo 0)
MEM=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
if [ "$CPU" -ge 2 ]; then yesil "vCPU $CPU"; else kirmizi "vCPU $CPU (≥2)"; fi
if [ "$MEM" -ge 3800 ]; then yesil "bellek ${MEM} MB"; else kirmizi "bellek ${MEM} MB (≥4 GB)"; fi

# --- 7. Dışarıdan (Cloudflare üzerinden) --------------------------------------
bolum "Dış yüz (curl, Cloudflare üzerinden)"
if [ -z "$AD" ]; then olculemedi "--ad verilmedi: HSTS / TLS / HTTP→HTTPS ölçülmedi"
elif ! var curl; then olculemedi "curl yok"
else
  BAS=$(curl -sS -o /dev/null -D - --max-time 15 "https://$AD/health" 2>/dev/null | tr -d '\r')
  if [ -z "$BAS" ]; then olculemedi "https://$AD/health yanıt vermedi"; else
    if printf '%s\n' "$BAS" | grep -qi '^strict-transport-security:'; then yesil "HSTS başlığı var"; else kirmizi "HSTS başlığı yok"; fi
  fi
  # İstemci tarafı (Ubuntu OpenSSL SECLEVEL=2) eski TLS'i kendisi reddeder; düşürülmezse yanlış YEŞİL çıkar.
  for v in 1.0 1.1; do
    # Yalnız el sıkışma reddi (35) YEŞİL; ad çözme/bağlantı/zaman aşımı (6/7/28) ölçüm değildir.
    TLS_KOD=0; curl -sS -o /dev/null --max-time 15 --tlsv1.0 --tls-max "$v" --ciphers 'DEFAULT@SECLEVEL=0' "https://$AD/health" 2>/dev/null || TLS_KOD=$?
    case "$TLS_KOD" in
      0) kirmizi "TLS $v kabul ediliyor" ;;
      35) yesil "TLS $v reddediliyor" ;;
      *) olculemedi "TLS $v sınaması sonuçsuz (curl çıkış $TLS_KOD)" ;;
    esac
  done
  H=$(curl -sS -o /dev/null -D - --max-time 15 "http://$AD/health" 2>/dev/null | tr -d '\r')
  KOD=$(printf '%s\n' "$H" | awk 'NR==1 {print $2}')
  if printf '%s\n' "$KOD" | grep -qE '^30[178]$' && printf '%s\n' "$H" | grep -qi '^location: https://'; then yesil "HTTP → HTTPS yönlendirmesi ($KOD)"; else kirmizi "HTTP → HTTPS yönlendirmesi yok (${KOD:-yanıt yok})"; fi
fi

printf '\nÖZET: %d YEŞİL · %d KIRMIZI · %d ÖLÇÜLEMEDİ\n' "$YESIL" "$KIRMIZI" "$OLCULEMEDI"
[ "$KIRMIZI" -gt 100 ] && exit 100
exit "$KIRMIZI"
