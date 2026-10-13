#!/usr/bin/env bash
# =============================================================================
# VDS'te adnansahin'e ait her baytın TABANLA birebir aynı olduğunu ölçer — VDS'e SALT OKUMA.
# =============================================================================
# Kullanım (Mac, repo kökünden):
#   deploy/vds-dogrula.sh [--taban=<dizin>]               ölç: 0 AYNI · 1 FARK (dur) · 2 ÖLÇÜLEMEDİ (dur)
#   deploy/vds-dogrula.sh [--taban=<dizin>] --taban-yaz   tabanı VDS'in ŞİMDİKİ hâlinden yaz (dizin boş olmalı)
#   deploy/vds-dogrula.sh --komut-yaz                     VDS'e gidecek TEK uzak komutu bas, bağlanma (bekçi okur)
# Taban sahaya özgü VERİDİR, repoya girmez: varsayılan ~/.tekserp/vds-taban (ortam TEKSERP_VDS_TABAN ezer),
# üç dosya adnansahin.sha · kok.sha · diger.sha. Tazeleme reçetesi: docs/ops/LISANS-DEVREYE-ALMA-TESTFABRIKA.md §1.2.
# Uzak komut deploy/lisans-devreye/lib/ag.mjs salt-okuma izin listesinden geçer (bekçi: test_lisans_devreye_kuru §5).
# Aynı VDS'teki satıcı yedeğinin tazeliği de ölçülür (B3): en yeni DB dökümü ve anahtar arşivi uzak saatle 26 saatten
# yeni olmalı; bayat ya da okunamayan yedek ❌ (çıkış 1). Konteyner adı TEKSERP_SATICI_YEDEK_KONTEYNER ile ezilir.
set -u
K=/opt/stack/apps/tekserp-guncelleme
SSH_HEDEF=tekserp-yayin
YEDEK_KONTEYNER="${TEKSERP_SATICI_YEDEK_KONTEYNER:-tekserp-satici-uretim-yedek}"
TABAN="${TEKSERP_VDS_TABAN:-$HOME/.tekserp/vds-taban}"
KIP=olc
for a in "$@"; do
  case "$a" in
    --taban=*) TABAN="${a#--taban=}" ;;
    --taban-yaz) KIP=taban ;;
    --komut-yaz) KIP=komut ;;
    *) echo "ÖLÇÜLEMEDİ: bilinmeyen argüman $a" >&2; exit 2 ;;
  esac
done
UZAK="cd $K/html && find adnansahin -type f -print0 | sort -z | xargs -0 sha256sum; echo '@@KOK'; find electron -type f -print0 | sort -z | xargs -0 sha256sum; echo '@@DIGER'; sha256sum $K/defter/adnansahin-YAYIN-DEFTERI.tsv $K/nginx/default.conf $K/docker-compose.yml; echo '@@YEDEK'; date -u -d '26 hours ago' +%Y%m%d_%H%M%S; docker exec $YEDEK_KONTEYNER ls -1 /yedek; echo '@@LS'; ls -1 $K/html $K/defter"
if [ "$KIP" = komut ]; then printf '%s\n' "$UZAK"; exit 0; fi

DOSYALAR="adnansahin.sha kok.sha diger.sha"
if [ "$KIP" = olc ]; then
  for f in $DOSYALAR; do [ -f "$TABAN/$f" ] || { echo "ÖLÇÜLEMEDİ: taban yok: $TABAN/$f (önce --taban-yaz)"; exit 2; }; done
else
  for f in $DOSYALAR; do [ -e "$TABAN/$f" ] && { echo "ÖLÇÜLEMEDİ: taban zaten var: $TABAN/$f — ezilmez; eskisini kenara al ya da başka --taban ver"; exit 2; }; done
fi

out=$(ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_HEDEF" "$UZAK") || { echo "ÖLÇÜLEMEDİ: ssh"; exit 2; }
a=$(printf '%s\n' "$out" | sed -n '1,/^@@KOK$/p' | grep -v '^@@' | sort -k2)
k=$(printf '%s\n' "$out" | sed -n '/^@@KOK$/,/^@@DIGER$/p' | grep -v '^@@' | sort -k2)
d=$(printf '%s\n' "$out" | sed -n '/^@@DIGER$/,/^@@YEDEK$/p' | grep -v '^@@' | sort -k2)
y=$(printf '%s\n' "$out" | sed -n '/^@@YEDEK$/,/^@@LS$/p' | grep -v '^@@')
l=$(printf '%s\n' "$out" | sed -n '/^@@LS$/,$p' | grep -v '^@@')
na=$(printf '%s\n' "$a" | grep -c .)
[ "$na" -lt 300 ] && { echo "ÖLÇÜLEMEDİ: adnansahin dosya sayısı $na (<300)"; exit 2; }

if [ "$KIP" = taban ]; then
  mkdir -p "$TABAN"
  printf '%s\n' "$a" > "$TABAN/adnansahin.sha"
  printf '%s\n' "$k" > "$TABAN/kok.sha"
  printf '%s\n' "$d" > "$TABAN/diger.sha"
  echo "✅ taban yazıldı: $TABAN ($na adnansahin dosyası)"
  exit 0
fi

rc=0
diff <(printf '%s\n' "$a") "$TABAN/adnansahin.sha" >/dev/null || { echo "❌ FARK: html/adnansahin"; diff <(printf '%s\n' "$a") "$TABAN/adnansahin.sha" | head -20; rc=1; }
diff <(printf '%s\n' "$k") "$TABAN/kok.sha" >/dev/null || { echo "❌ FARK: html/electron (kök)"; rc=1; }
diff <(printf '%s\n' "$d") "$TABAN/diger.sha" >/dev/null || { echo "❌ FARK: defter/nginx/compose"; diff <(printf '%s\n' "$d") "$TABAN/diger.sha"; rc=1; }
[ $rc -eq 0 ] && echo "✅ adnansahin AYNI ($na dosya) · kök electron AYNI · defter/nginx/compose AYNI"
# Satıcı yedek tazeliği: damga adlarda (UTC, sıralanabilir), kesim uzak saatten — iki makinenin saati karışmaz.
kesim=$(printf '%s\n' "$y" | head -n 1)
son_db=$(printf '%s\n' "$y" | grep -E '^satici_[0-9]{8}_[0-9]{6}\.dump\.tkenc$' | sort | tail -n 1 | cut -c8-22)
son_an=$(printf '%s\n' "$y" | grep -E '^anahtarlar_[0-9]{8}_[0-9]{6}\.tar\.tkenc(\.tkenc)?$' | sort | tail -n 1 | cut -c12-26)
if ! printf '%s' "$kesim" | grep -Eq '^[0-9]{8}_[0-9]{6}$'; then
  echo "❌ YEDEK ÖLÇÜLEMEDİ: uzak kesim zamanı okunamadı"; rc=1
elif [ -z "$son_db" ] || [[ "$son_db" < "$kesim" ]]; then
  echo "❌ YEDEK BAYAT: en yeni DB dökümü ${son_db:-YOK} (kesim $kesim UTC; $YEDEK_KONTEYNER günlüğüne bakın)"; rc=1
elif [ -z "$son_an" ] || [[ "$son_an" < "$kesim" ]]; then
  echo "❌ YEDEK BAYAT: en yeni anahtar arşivi ${son_an:-YOK} (kesim $kesim UTC; katman alıcısı — SATICI-KURULUM §13.7)"; rc=1
else
  echo "✅ satıcı yedeği taze: DB $son_db · anahtar $son_an (kesim $kesim UTC)"
fi
echo "html/ + defter/: $(printf '%s\n' "$l" | tr '\n' ' ')"
exit $rc
