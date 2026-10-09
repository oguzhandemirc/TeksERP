#!/usr/bin/env bash
# =============================================================================
# CI DUMANI — Linux karşılıklı onarım (W1b L-A + L-B, plan GUNCELLEYICI-SAGLAMLIK §4.7) gerçek systemd ile
# =============================================================================
# NE ZAMAN: yalnız CI (ubuntu-latest, parolasız sudo), `native-linux.yml`. Yerel makinede KOŞMA: /opt ve
#   /etc/systemd/system altına bir TEST birimi kurar ve siler; aynı adlı birim varsa reddeder.
# BİRİM: L6'nın donmuş taban birimine DOKUNMAZ — onun `ExecStartPre=-….lkg onar --yalniz-asil-ad` satırının
#   aynısını taşıyan ayrı bir test birimidir. Linux hizmet gövdesi (L6) gelene dek "ana süreç" asıl adın
#   `kunye`sini koşturup ayakta kalan küçük bir sarmalayıcıdır: asıl ad çalıştırılamıyorsa birim düşer.
#   Kurulumun ölçüsünü (`kendi.json` lkgOzet/calisanOzet) bugün hizmet yazamadığı için duman tohumlar.
# ÖLÇER:
#   1. ikili silindi + `kill -9` → systemd yeniden başlatır, ExecStartPre `.lkg`den geri koyar, birim ayakta
#   2. son 4 KB kesildi + yeniden başlatma → özeti tutmayan ikili onarılır (yarım bayt çalışmaz)
#   3. yönetici `disable --now` + `mask`: kimse onarmaz/başlatmaz; `unmask` + `start` → onarır
#   4. tavan: 24 saatte 3 onarımdan sonra systemd her saniye yeniden denese de onarım 3'te durur,
#      durum.json ONARIM_TAVANI; ikili onarılmaz (döngü yok)
#   5. disk dolu (küçük tmpfs): çıkış 13, durum.json DISK_DOLU, hiçbir dosya silinmez, yarım kopya kalmaz;
#      yer açılınca onarır
# Argüman: güncelleyici ikilisi (Linux derlemesi).
# =============================================================================
set -euo pipefail

BIN=$(readlink -f "${1:?kullanım: duman-linux-onarim.sh <tekserp-guncelleyici>}")
if [ "$(id -u)" != 0 ]; then exec sudo -E bash "$0" "$BIN"; fi

AD=tekserp-onarim-duman
KOK=/opt/$AD
VERI=/var/lib/$AD
# /etc dışında: `systemctl mask` /etc/systemd/system/<ad> bağını yazar, aynı adlı birim dosyası orada olamaz.
BIRIM=/usr/local/lib/systemd/system/$AD.service
KOK2=/mnt/$AD-dolu
VERI2=/var/lib/$AD-dolu
ASIL=$KOK/guncelleyici/tekserp-guncelleyici
LKG=$ASIL.lkg

adim() { printf '\n== %s\n' "$*"; }
dur() {
  printf 'XX %s\n' "$*" >&2
  systemctl status "$AD" --no-pager 2>/dev/null | tail -20 >&2 || true
  journalctl -u "$AD" --no-pager -n 40 >&2 || true
  exit 1
}
# Güncelleyicinin özet biçimi: sha256, base64url, dolgusuz.
ozet() { openssl dgst -sha256 -binary "$1" | base64 -w0 | tr '+/' '-_' | tr -d '='; }
onarim_sayisi() { [ -f "$VERI/guncelleme/is/onarim.json" ] && jq '.onarimlar | length' "$VERI/guncelleme/is/onarim.json" || echo 0; }
hata_kodu() { jq -r '.hataKodu // empty' "$1/guncelleme/durum/durum.json" 2>/dev/null || true; }
ana_pid() { systemctl show -p MainPID --value "$AD"; }
# Birim etkin ve ana süreç `kunye`yi geçmiş (kunye.json taze) — en çok 30 sn.
bekle_ayakta() {
  local eski=${1:-0}
  for _ in $(seq 60); do
    local p
    p=$(ana_pid)
    if [ "$(systemctl is-active "$AD" || true)" = active ] && [ "$p" != 0 ] && [ "$p" != "$eski" ] && [ -s "$VERI/kunye.json" ]; then
      return 0
    fi
    sleep 0.5
  done
  dur "birim ayağa kalkmadı"
}
kes_4kb() {
  local n
  n=$(stat -c %s "$1")
  dd if=/dev/null of="$1" bs=1 seek=$((n - 4096)) status=none
}

if systemctl cat "$AD" >/dev/null 2>&1; then dur "$AD zaten kayıtlı — duman gerçek birime dokunmaz"; fi
# Temizlik hatası dumanın sonucunu değiştirmez (çıkış kodu korunur) ama sessiz de kalmaz: ekrana yazılır.
temizle() {
  local rc=$?
  set +e
  systemctl unmask "$AD" >/dev/null 2>&1
  systemctl disable --now "$AD" >/dev/null 2>&1
  rm -f "$BIRIM" || echo "TEMİZLİK: $BIRIM silinemedi" >&2
  systemctl daemon-reload || echo "TEMİZLİK: daemon-reload başarısız" >&2
  if mountpoint -q "$KOK2"; then
    # Önce düz ayırma; meşgulse tembel ayırma (bağ hemen kalkar, açık tutamaçlar kapanınca serbest kalır).
    umount "$KOK2" 2>/dev/null || umount -l "$KOK2" || echo "TEMİZLİK: $KOK2 ayrılamadı" >&2
  fi
  rm -rf "$KOK" "$VERI" "$KOK2" "$VERI2" || echo "TEMİZLİK: test dizinleri silinemedi" >&2
  exit "$rc"
}
trap temizle EXIT

kur() { # <kök> <veri>: asıl ad + .lkg + kurulumun ölçüsü
  mkdir -p "$1/guncelleyici" "$2/guncelleme/is"
  install -m 0755 "$BIN" "$1/guncelleyici/tekserp-guncelleyici"
  install -m 0755 "$BIN" "$1/guncelleyici/tekserp-guncelleyici.lkg"
  local d v
  d=$(ozet "$BIN")
  v=$("$BIN" kunye | jq -r .surum)
  jq -n --arg v "$v" --arg d "$d" \
    '{durum:"KURULUM",eskiSurum:$v,yeniSurum:$v,acilis:0,zaman:"2026-10-09T00:00:00.000Z",lkgSurum:$v,lkgOzet:$d,calisanOzet:$d}' \
    > "$2/guncelleme/is/kendi.json"
}

adim "0. kurulum: test birimi (L-B satırı) + asıl ad + .lkg"
kur "$KOK" "$VERI"
OZET=$(ozet "$BIN")
cat > "$KOK/calistir.sh" <<'EOF'
#!/bin/sh
# Ana süreç: asıl adı çalıştırabiliyorsa ayakta kalır (gerçek hizmet gövdesi L6'da).
rm -f "$2"
"$1" kunye > "$2.tmp" || exit 1
mv "$2.tmp" "$2"
exec sleep infinity
EOF
chmod 0755 "$KOK/calistir.sh"
mkdir -p "$(dirname "$BIRIM")"
cat > "$BIRIM" <<EOF
[Unit]
Description=TeksERP onarim dumani (TEST birimi; L6 taban birimine dokunmaz)
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStartPre=-$LKG onar --yalniz-asil-ad --kok $KOK --veri $VERI
ExecStart=$KOK/calistir.sh $ASIL $VERI/kunye.json
Restart=always
RestartSec=1

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$AD"
bekle_ayakta
[ "$(onarim_sayisi)" = 0 ] || dur "sağlam kurulumda onarım yapıldı"

adim "1. ikili silindi + kill -9: ExecStartPre .lkg'den geri koyar"
pid=$(ana_pid)
rm -f "$ASIL"
systemctl kill -s KILL "$AD"
bekle_ayakta "$pid"
[ "$(ozet "$ASIL")" = "$OZET" ] || dur "asıl ad doğrulanmış ikili değil"
[ -x "$ASIL" ] || dur "geri konan ikili çalıştırılabilir değil"
[ "$(onarim_sayisi)" = 1 ] || dur "onarım sayısı 1 değil: $(onarim_sayisi)"
jq -e '.onarimlar[0].neden == "EKSIK"' "$VERI/guncelleme/is/onarim.json" >/dev/null || dur "neden EKSIK değil"

adim "2. son 4 KB kesildi: yeniden başlatmada onarılır"
pid=$(ana_pid)
kes_4kb "$ASIL"
systemctl restart "$AD"
bekle_ayakta "$pid"
[ "$(ozet "$ASIL")" = "$OZET" ] || dur "kesik ikili geri konmadı"
[ "$(onarim_sayisi)" = 2 ] || dur "onarım sayısı 2 değil"
ls "$KOK/guncelleyici" | grep -qE '\.(onarim|tmp)' && dur "yarım kopya kaldı: $(ls "$KOK/guncelleyici")"

adim "3. yönetici kararı: disable --now + mask → kimse onarmaz; unmask + start → onarır"
systemctl disable --now "$AD"
systemctl mask "$AD"
rm -f "$ASIL"
systemctl start "$AD" 2>/dev/null && dur "maskeli birim başladı"
sleep 3
[ -e "$ASIL" ] && dur "maskeli birimde ikili geri kondu (yönetici kararı aşıldı)"
[ "$(onarim_sayisi)" = 2 ] || dur "maskeli birimde onarım sayıldı"
systemctl unmask "$AD"
systemctl enable --now "$AD"
bekle_ayakta
[ "$(ozet "$ASIL")" = "$OZET" ] || dur "unmask sonrası onarılmadı"
[ "$(onarim_sayisi)" = 3 ] || dur "onarım sayısı 3 değil"

adim "4. tavan: 3 onarımdan sonra systemd her saniye yeniden dener, onarım durur"
kes_4kb "$ASIL"
BOZUK=$(ozet "$ASIL")
systemctl restart "$AD" || true
for _ in $(seq 30); do
  [ "$(hata_kodu "$VERI")" = ONARIM_TAVANI ] && break
  sleep 0.5
done
[ "$(hata_kodu "$VERI")" = ONARIM_TAVANI ] || dur "durum.json ONARIM_TAVANI değil: $(cat "$VERI/guncelleme/durum/durum.json" 2>/dev/null)"
sleep 5 # systemd en az birkaç kez daha yeniden başlatır (RestartSec=1)
denemeler=$(journalctl -u "$AD" --no-pager | grep -c "ONARIM_TAVANI" || true)
[ "$(onarim_sayisi)" = 3 ] || dur "tavanda onarım sayısı arttı: $(onarim_sayisi)"
[ "$(ozet "$ASIL")" = "$BOZUK" ] || dur "tavanda ikiliye dokunuldu"
jq -e '.tavanda == true' "$VERI/guncelleme/is/onarim.json" >/dev/null || dur "tavanda işareti yok"
echo "   tavanda $denemeler deneme günlükte, onarım 3'te kaldı"
systemctl disable --now "$AD"

adim "5. disk dolu (küçük tmpfs): DISK_DOLU, hiçbir şey silinmez, yer açılınca onarır"
boy=$(stat -c %s "$BIN")
mkdir -p "$KOK2"
mount -t tmpfs -o size=$((boy * 2 + 2 * 1024 * 1024)) tmpfs "$KOK2"
kur "$KOK2" "$VERI2"
rm -f "$KOK2/guncelleyici/tekserp-guncelleyici"
bos=$(df --output=avail -B1 "$KOK2" | tail -1)
dd if=/dev/zero of="$KOK2/dolgu" bs=1M count=$(((bos - 512 * 1024) / 1048576)) status=none 2>/dev/null || true
once=$(find "$KOK2" -type f | sort | xargs -r sha256sum)
set +e
"$KOK2/guncelleyici/tekserp-guncelleyici.lkg" onar --yalniz-asil-ad --kok "$KOK2" --veri "$VERI2"
kod=$?
set -e
[ "$kod" = 13 ] || dur "disk dolu: çıkış 13 beklenirdi ($kod)"
[ "$(hata_kodu "$VERI2")" = DISK_DOLU ] || dur "durum.json DISK_DOLU değil"
sonra=$(find "$KOK2" -type f | sort | xargs -r sha256sum)
[ "$once" = "$sonra" ] || dur "disk dolu: dosya silindi/değişti ya da yarım kopya kaldı: $(diff <(echo "$once") <(echo "$sonra"))"
rm -f "$KOK2/dolgu"
"$KOK2/guncelleyici/tekserp-guncelleyici.lkg" onar --yalniz-asil-ad --kok "$KOK2" --veri "$VERI2" || dur "yer açılınca onarmadı"
[ "$(ozet "$KOK2/guncelleyici/tekserp-guncelleyici")" = "$OZET" ] || dur "yer açılınca konan ikili doğrulanmış değil"

printf '\nOK Linux onarım dumanı: silinme, kesik bayt, yönetici kararı, tavan, disk dolu\n'
