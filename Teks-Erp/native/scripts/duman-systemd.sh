#!/usr/bin/env bash
# L6 systemd dumanı (GUNCELLEYICI-SAGLAMLIK §4.3, §4.7 L-B/L-C) — YALNIZ ubuntu-latest CI'da, sudo ile, atılabilir
# makinede. Gerçek systemd'de ölçer: `hizmet-kur` taban birim + ek dosya yazar (systemd-analyze bilinmeyen anahtar
# bulmaz) · Type=notify READY gelir · gözcü (WatchdogSec) bildirimi sürer · onarım satırları ikili yokken başlatmayı
# durdurmaz · kill -9 → Restart=always · elle bozulan ek dosya açılışta geri yazılır · stop temiz · hizmet-kaldir
# yalnız kendi dosyalarını siler. Ek ölçüm (karar girdisi, kırmızı vermez): OnFailure= + Restart=always tetiklenir mi.
# T1'in `duman-linux.sh`i (compose, imaj, CDN) DEĞİLDİR.
set -euo pipefail

IKILI=${1:?kullanım: duman-systemd.sh <tekserp-guncelleyici ikilisi>}
AD=tekserp-guncelleyici-duman
KOK=/opt/tekserp-duman
VERI=/var/lib/tekserp-duman
BIRIM=/etc/systemd/system/$AD.service
EKDIZIN=/etc/systemd/system/$AD.service.d
G=$KOK/guncelleyici/tekserp-guncelleyici

hata() { echo "::error title=L6 systemd dumanı::$*"; exit 1; }
ozellik() { systemctl show -p "$1" --value "$AD.service"; }
bekle_aktif() {
  for _ in $(seq 1 "$1"); do [ "$(ozellik ActiveState)" = active ] && return 0; sleep 1; done
  return 1
}
temizle() {
  set +e
  echo "── günlük (son 60) ──"; sudo journalctl -u "$AD.service" --no-pager -n 60
  [ -x "$G" ] && sudo "$G" hizmet-kaldir --ad "$AD" >/dev/null 2>&1
  sudo rm -rf "$KOK" "$VERI" "$EKDIZIN" "$BIRIM" /etc/systemd/system/tekserp-olcum*.service /tmp/tekserp-onfailure
  sudo systemctl daemon-reload
}
trap temizle EXIT

echo "systemd: $(systemctl --version | head -1)"
sudo install -d -m 0755 "$KOK/guncelleyici"
sudo install -m 0755 "$IKILI" "$G"

echo "── 1. hizmet-kur ──"
sudo "$G" hizmet-kur --kok "$KOK" --veri "$VERI" --ad "$AD"
[ -f "$BIRIM" ] && [ -f "$EKDIZIN/50-tekserp.conf" ] || hata "taban birim ya da ek dosya yazılmadı"
grep -q "^ExecStartPre=-$G.lkg onar --yalniz-asil-ad " "$BIRIM" || hata "onarım satırı (.lkg) taban birimde yok"
analiz=$(sudo systemd-analyze verify "$BIRIM" 2>&1 || true)
echo "$analiz"
echo "$analiz" | grep -Ei "unknown (key|section|lvalue)|failed to parse|invalid" && hata "systemd-analyze birimi tanımadı"
[ "$(systemctl is-enabled "$AD.service")" = enabled ] || hata "birim etkin değil"
[ "$(ozellik Type)" = notify ] || hata "Type=$(ozellik Type)"
[ "$(ozellik WatchdogUSec)" = 3min ] || hata "ek dosyanın WatchdogSec'i etkin değil: $(ozellik WatchdogUSec)"
[ "$(ozellik OOMScoreAdjust)" = -500 ] || hata "OOMScoreAdjust=$(ozellik OOMScoreAdjust)"

echo "── 2. başlat (READY) + gözcü 6 sn ──"
printf '[Service]\nWatchdogSec=6\n' | sudo tee "$EKDIZIN/60-duman.conf" >/dev/null
sudo systemctl daemon-reload
# .lkg ve current/ ikilisi YOK: `-` önekli onarım satırları başlatmayı durdurmamalı.
timeout 60 sudo systemctl start "$AD.service" || hata "start düştü (READY gelmedi ya da onarım satırı başlatmayı durdurdu)"
[ "$(ozellik ActiveState)" = active ] || hata "aktif değil: $(ozellik ActiveState)/$(ozellik SubState)"
sleep 20
[ "$(ozellik ActiveState)" = active ] && [ "$(ozellik NRestarts)" = 0 ] || hata "gözcü öldürdü (WATCHDOG=1 gelmiyor): $(ozellik Result) NRestarts=$(ozellik NRestarts)"

echo "── 3. kill -9 → Restart=always ──"
pid=$(ozellik MainPID)
sudo kill -9 "$pid"
sleep 2
bekle_aktif 30 || hata "kill -9 sonrası geri gelmedi"
[ "$(ozellik NRestarts)" -ge 1 ] && [ "$(ozellik MainPID)" != "$pid" ] || hata "yeniden başlatma görülmedi"

echo "── 4. elle bozulan ek dosya açılışta geri yazılır ──"
sudo sed -i 's/^OOMScoreAdjust=.*/OOMScoreAdjust=0/' "$EKDIZIN/50-tekserp.conf"
sudo systemctl restart "$AD.service"
bekle_aktif 30 || hata "restart sonrası aktif değil"
for _ in $(seq 1 10); do grep -q '^OOMScoreAdjust=-500$' "$EKDIZIN/50-tekserp.conf" && break; sleep 1; done
grep -q '^OOMScoreAdjust=-500$' "$EKDIZIN/50-tekserp.conf" || hata "ek dosya gömülü şablona hizalanmadı"

echo "── 5. .lkg varken onarım satırı koşar, tur koşmaz ──"
sudo cp "$G" "$G.lkg"
sudo systemctl restart "$AD.service"
bekle_aktif 30 || hata "onarım satırıyla başlatma düştü"
sudo journalctl -u "$AD.service" --no-pager -n 200 | grep -q 'asıl ikilisi yok' && hata "asıl ad sağlamken uyarı"

echo "── 6. stop temiz ──"
sudo systemctl stop "$AD.service"
[ "$(ozellik Result)" = success ] || hata "stop sonucu $(ozellik Result)"

echo "── 7. hizmet-kaldir yalnız kendi dosyalarını siler ──"
sudo rm -f "$EKDIZIN/60-duman.conf"
printf '[Service]\nLimitNOFILE=4096\n' | sudo tee "$EKDIZIN/70-yerel.conf" >/dev/null
sudo "$G" hizmet-kaldir --ad "$AD"
[ ! -f "$BIRIM" ] && [ ! -f "$EKDIZIN/50-tekserp.conf" ] || hata "kaldırma birimi/ek dosyayı silmedi"
[ -f "$EKDIZIN/70-yerel.conf" ] || hata "kaldırma yerel ek dosyayı sildi"
sudo rm -rf "$EKDIZIN"

echo "── 8. ölçüm: OnFailure= + Restart=always + StartLimitIntervalSec=0 ──"
sudo tee /etc/systemd/system/tekserp-olcum-isaret.service >/dev/null <<'B'
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo x >> /tmp/tekserp-onfailure'
B
sudo tee /etc/systemd/system/tekserp-olcum.service >/dev/null <<'B'
[Unit]
StartLimitIntervalSec=0
OnFailure=tekserp-olcum-isaret.service
[Service]
ExecStart=/bin/false
Restart=always
RestartSec=1
B
sudo rm -f /tmp/tekserp-onfailure
sudo systemctl daemon-reload
sudo systemctl start tekserp-olcum.service || true
sleep 8
sudo systemctl stop tekserp-olcum.service || true
n=$(sudo sh -c 'wc -l < /tmp/tekserp-onfailure 2>/dev/null || echo 0')
r=$(systemctl show -p NRestarts --value tekserp-olcum.service)
echo "::notice title=L6 OnFailure ölçümü::$(systemctl --version | head -1): Restart=always ile ~8 sn'de NRestarts=$r, OnFailure tetiklenme=$n"
echo "✅ L6 systemd dumanı yeşil"
