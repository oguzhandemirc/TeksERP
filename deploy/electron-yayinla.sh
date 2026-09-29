#!/usr/bin/env bash
# =============================================================================
# Electron panelinin yeni sürümünü güncelleme sunucusuna yayınlar (macOS/Linux;
# Windows'ta Git Bash/WSL). Kapısız ikinci yol YOK: `deploy/electron-yayinla.ps1`
# fail-closed saplamadır.
#
# Kullanım:
#   ./deploy/electron-yayinla.sh --musteri=adnansahin             # paketin sürümüne yayınla
#   ./deploy/electron-yayinla.sh --musteri=adnansahin 2.8.1       # belirli sürümü yayınla
#   ./deploy/electron-yayinla.sh --musteri=adnansahin --dogrula   # YÜKLEME YOK — yayını denetle
#   ./deploy/electron-yayinla.sh --musteri=testfabrika --kuru     # AĞ YOK — yerel kapılar + yükleme planı
#   ./deploy/electron-yayinla.sh --musteri=adnansahin --terfi-atla="<kullanıcının cümlesi>"  # K5 acil kaçışı
#
# ⚠️ TERFİ (K5): `terfiKaynagi` olan kanala (adnansahin) yalnız terfi etiketli commit'ten, hazırlık
# kanalında yayınlanmış sürüm çıkar (scripts/lib/terfi.mjs); kaçış yalnız kullanıcının cümlesiyle.
# Reçete: docs/ops/ELECTRON-OTOMATIK-GUNCELLEME.md
#
# Script'in asıl işi YÜKLEME SIRASINI korumaktır: `latest.yml` EN SON gider.
# Ters sırada, henüz yüklenmemiş bir .exe'yi işaret eden bir latest.yml yayında
# kalır ve o aralıkta kontrol yapan paneller "sürüm dosyası bulunamadı" der.
#
# ⚠️ HEDEF PAKETİN KİMLİĞİNDEN ÇÖZÜLÜR: `--musteri` NİYETTİR, paketin gömülü
# kimliği (app-update.yml adresi · updater önbelleği · exe adı) OTORİTEDİR; ikisi
# aynı kanalı göstermezse ssh'tan ÖNCE durulur. Çalışma ağacındaki musteri.json
# OKUNMAZ: o bir beyandır ve yarıda kalan bir paketleme onu başka kanalda bırakır.
# =============================================================================
set -euo pipefail

# ~/.ssh/config takma adı. ⚠️ 2026-09-01'de `yenisunucu`dan `tekserp-yayin`e
# çevrildi: yayın 80.253.255.188'e taşındı ve DNS de oraya döndü. İki ayrıntı
# load-bearing:
#  · `yenisunucu` artık ESKİ sunucudur (91.217.119.138) — adı yanıltıcı ama
#    demo işi ve bir haftalık geri dönüş yolu orada, o yüzden bırakıldı.
#  · `tekserp-yayin` kullanıcısı `yayinci`: sudo YOK, yalnız yayın ağacına
#    yazar. Yönetici hesabıyla yayın yapılmaz.
SSH_HEDEF="${SSH_HEDEF:-tekserp-yayin}"
YAYIN_KOK="${YAYIN_KOK:-/opt/stack/apps/tekserp-guncelleme/html}"
BASE_URL="${BASE_URL:-https://guncelleme.etkiliyazilim.com}"

kok="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_dir="$kok/Electron"

hata() { echo "HATA: $*" >&2; exit 1; }

# --- Argümanlar ------------------------------------------------------------
musteri=""
denetim_kipi=0
kuru=0
surum_arg=""
terfi_atla=""
terfi_atla_verildi=0
for a in "$@"; do
  case "$a" in
    --musteri=*) musteri="${a#--musteri=}" ;;
    --dogrula) denetim_kipi=1 ;;
    --kuru) kuru=1 ;;
    --terfi-atla=*) terfi_atla="${a#--terfi-atla=}"; terfi_atla_verildi=1 ;;
    --terfi-atla) terfi_atla=""; terfi_atla_verildi=1 ;;
    -*) hata "Tanınmayan seçenek: $a" ;;
    *)
      [ -z "$surum_arg" ] || hata "Fazla argüman: $a"
      surum_arg="$a"
      ;;
  esac
done

[ "$kuru" = "1" ] && [ "$denetim_kipi" = "1" ] && hata "--kuru ile --dogrula birlikte verilemez (--dogrula yayına bakar, --kuru hiç ağa çıkmaz)."
[ "$terfi_atla_verildi" = "1" ] && [ "$denetim_kipi" = "1" ] && hata "--terfi-atla yalnız yayında verilir (--dogrula hiçbir şey yüklemez)."

[ -n "$musteri" ] || hata "HANGİ KANALA YAYINLANIYOR? --musteri=<kod> zorunlu.
  Hedef klasör paketin kimliğinden çözülür; argüman niyettir ve onunla birebir olmalı.
  Örnek: ./deploy/electron-yayinla.sh --musteri=adnansahin"

# Kanal kayıtlı mı (kayıt defteri kırmızıysa da DUR) — hiçbir ağ/ssh işinden ÖNCE.
node "$kok/scripts/kanal-kapisi.mjs" kanal "$musteri" \
  || hata "Kanal kapısı geçilmedi (kayıt defteri: deploy/kanallar.json)."

# --- YAYIN BELİRTECİ (3c') — hiçbir ağ/ssh işinden ÖNCE ------------------------
# Güncelleme sunucusu anonim okumaya kapalıdır (Cloudflare Worker, X-TKL-Indirme).
# "Ne yayında" sorusu SSH ile VDS diskinden okunur; "kenardan ne görünüyor"
# doğrulaması (dogrula) yalnız satıcı yayın belirteciyle yapılır. Belirteç yoksa
# DUR — anonim okumaya düşülmez. Belirteç argv'ye düşmesin diye `curl -H @dosya`.
# --kuru ağa çıkmadığı için belirteç istemez.
BELIRTEC_BASLIK=""
if [ "$kuru" = "0" ]; then
  BELIRTEC_BASLIK="$(mktemp "${TMPDIR:-/tmp}/tekserp-belirtec.XXXXXX")" || hata "Geçici dosya açılamadı."
  trap 'rm -f "$BELIRTEC_BASLIK"' EXIT
  node --input-type=module -e "
    import { baslikDosyasiYaz } from '$kok/scripts/lib/yayin-okuma.mjs';
    try { baslikDosyasiYaz(process.argv[1], process.argv[2]); } catch (e) { console.error('HATA: ' + e.message); process.exit(3); }
  " -- "$BELIRTEC_BASLIK" "/$musteri/electron/" || hata "Yayın belirteci yok — hiçbir şey yüklenmedi (anonim okumaya düşülmez)."
  [ -s "$BELIRTEC_BASLIK" ] || hata "Yayın belirteci başlık dosyası boş — hiçbir şey yüklenmedi."
fi
# Güncelleme sunucusuna TEK sanksiyonlu HTTP okuması (bekçi: scripts/check-yayin-okuma.mjs).
belirtecli_curl() { curl -H "@$BELIRTEC_BASLIK" "$@"; }

rel=""
if [ "$denetim_kipi" = "0" ]; then
  surum="${surum_arg:-$(node -p "require('$electron_dir/package.json').version")}"
  rel="$electron_dir/release/$musteri/$surum"
  if [ ! -d "$rel" ]; then
    if [ -d "$electron_dir/release/$surum" ]; then
      hata "Paket ESKİ düzende: release/$surum (kanal ayrımından önce üretilmiş).
  Yayıncı paketi release/<kanal>/<sürüm>/ altında arar ve kimliğini oradan okur.
  Yeniden paketle: ./deploy/electron-paketle.sh $musteri"
    fi
    hata "Paket klasörü yok: $rel
  Önce derle: ./deploy/electron-paketle.sh $musteri
  Sürüm numarasını ARTIRMAYI unutma."
  fi
  # ARTEFAKT OTORİTESİ — paket gerçekten bu kanalın mı? (ssh'tan ÖNCE)
  node "$kok/scripts/kanal-kapisi.mjs" panel-yayin "$musteri" "$rel" \
    || hata "Paket '$musteri' kanalının değil ya da kimliği okunamadı — yükleme yapılmadı."
  # TERFİ KAPISI (K5) — üretim kanalına yalnız hazırlık kanalında yayınlanmış, kullanıcının terfi
  # etiketiyle onayladığı commit (ssh'tan ÖNCE). --kuru ağa çıkmaz: kaynak kanalın sürümü orada ölçülmez.
  terfi_ek=()
  [ "$kuru" = "1" ] && terfi_ek+=("--kuru")
  [ "$terfi_atla_verildi" = "1" ] && terfi_ek+=("--terfi-atla=$terfi_atla")
  if [ "${#terfi_ek[@]}" -gt 0 ]; then
    node "$kok/scripts/kanal-kapisi.mjs" terfi "$musteri" panel "$surum" "${terfi_ek[@]}" \
      || hata "Terfi kapısı geçilmedi — yükleme yapılmadı."
  else
    node "$kok/scripts/kanal-kapisi.mjs" terfi "$musteri" panel "$surum" \
      || hata "Terfi kapısı geçilmedi — yükleme yapılmadı."
  fi
fi

# Hedef yalnız doğrulanmış kanal kodundan türer.
UZAK_DIZIN="${UZAK_DIZIN:-$YAYIN_KOK/$musteri/electron}"
YAYIN_URL="${YAYIN_URL:-$BASE_URL/$musteri/electron}"

# --- Salt denetim kipi ---------------------------------------------------
# `--dogrula [sürüm]` yükleme YAPMADAN mevcut yayını denetler. İki işi var:
# ① "yayın hâlâ ayakta mı" sorusunun ucuz cevabı (elle tur sırasında, ya da
#    bir makine güncelleme alamıyor diye şüphelenince);
# ② aşağıdaki `dogrula()` dallarının ölü harf olmadığını sınayabilmek.
if [ "$denetim_kipi" = "1" ]; then
  denetim_surum="$surum_arg"
  if [ -z "$denetim_surum" ]; then
    # Hangi sürüm yayında: VDS diskinden (SSH, salt okuma) — kenar görünümünü aşağıda dogrula() ölçer.
    denetim_surum=$(ssh "$SSH_HEDEF" "cat '$UZAK_DIZIN/latest.yml'" 2>/dev/null | grep "^version:" | awk '{print $2}') \
      || hata "Yayındaki latest.yml okunamadı: $SSH_HEDEF:$UZAK_DIZIN/latest.yml"
    [ -n "$denetim_surum" ] || hata "Yayında latest.yml yok ya da sürüm satırı okunamadı."
  fi
  echo "Yayın denetleniyor: $musteri / $denetim_surum"
  surum="$denetim_surum"
else
  echo "Müşteri: $musteri · Sürüm: $surum"
fi

setup="$rel/TeksERP-$surum-Setup.exe"
blockmap="$setup.blockmap"
latest="$rel/latest.yml"

if [ "$denetim_kipi" = "0" ]; then
  for f in "$setup" "$blockmap" "$latest"; do
    [ -f "$f" ] || hata "Eksik dosya: $f
  latest.yml yoksa package.json > build.publish eksik olabilir."
  done
fi

if [ "$denetim_kipi" = "0" ]; then
  # latest.yml gerçekten BU sürümü mü gösteriyor? (eski build kalıntısı tuzağı)
  grep -q "^version: $surum\$" "$latest" || hata "latest.yml '$surum' sürümünü göstermiyor — eski build kalıntısı olabilir."

  mb=$(( $(wc -c < "$setup") / 1024 / 1024 ))
  echo "Yüklenecek: TeksERP-$surum-Setup.exe (${mb} MB) + blockmap + latest.yml"

  # --- KURU KİP: yerel kapıların hepsi geçti; hiçbir ağ/ssh/scp/curl/etiket işi yok ---
  if [ "$kuru" = "1" ]; then
    echo "[kuru] hedef      : $SSH_HEDEF:$UZAK_DIZIN/"
    echo "[kuru] sıra       : 1) TeksERP-$surum-Setup.exe + .blockmap  2) latest.yml (EN SON)"
    echo "[kuru] yayın adresi: $YAYIN_URL/latest.yml"
    echo "[kuru] defter     : $(dirname "$YAYIN_KOK")/defter/$musteri-YAYIN-DEFTERI.tsv"
    echo "[kuru] değişmezlik · sha512 · dış doğrulama · budama · panel-v$surum etiketi ATLANDI (ağ gerektirir)"
    [ "$terfi_atla_verildi" = "1" ] && echo "[kuru] terfi atlama kaydı (yayın defteri + etiket mesajı) ATLANDI (yayın yok)"
    echo "KURU — paket '$musteri' kanalının; yükleme yapılmadı."
    exit 0
  fi

  # --- DEĞİŞMEZLİK KAPISI ------------------------------------------------
  # Yayınlanmış bir sürümün dosyaları ÜZERİNE YAZILMAZ. Aynı numarayla farklı
  # bayt iki şeyi birden bozar: ① `blockmap` delta güncellemesi eski pakete
  # göre hesaplandığı için sahadaki panel bozuk indirme yapar; ② "1.0.0 hangi
  # derleme" sorusu cevapsız kalır — hata raporu ile paket eşleşmez.
  # Aynı bayt ise yükleme atlanır (yeniden yayın zararsız/idempotent olsun).
  uzak_sha=$(ssh "$SSH_HEDEF" "test -f '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' && \
      sha256sum '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' | cut -d' ' -f1" 2>/dev/null || true)
  if [ -n "$uzak_sha" ]; then
    yerel_sha=$(shasum -a 256 "$setup" | cut -d' ' -f1)
    if [ "$uzak_sha" = "$yerel_sha" ]; then
      echo "  ↷ $surum sunucuda AYNI baytlarla zaten var — yükleme atlanıyor."
      atla_yukleme=1
    else
      hata "DEĞİŞMEZLİK İHLALİ — $surum sunucuda FARKLI baytlarla duruyor.
  sunucu: $uzak_sha
  yerel : $yerel_sha
  Yayınlanmış bir sürümün üzerine yazmak, sahadaki panellerin delta
  güncellemesini bozar. Sürüm numarasını ARTIR ve yeniden paketle."
    fi
  fi

  if [ "${atla_yukleme:-0}" != "1" ]; then
  echo "1/2  paket + blockmap..."
  scp "$setup" "$blockmap" "$SSH_HEDEF:$UZAK_DIZIN/"

  echo "2/2  latest.yml (en son — sıra önemli)..."
  scp "$latest" "$SSH_HEDEF:$UZAK_DIZIN/"
  fi

  # --- SAĞLAMA DOĞRULAMASI (boyut YETMEZ) --------------------------------
  # Boyut kıyası yarım yüklemeyi yakalar ama BOZUK yüklemeyi yakalamaz: aynı
  # uzunlukta bozulmuş bayt dizisi de doğru boyutu verir. `latest.yml`in
  # taşıdığı sha512 zaten electron-updater'ın kuracağı beklentidir — sunucuya
  # İNEN dosyadan yeniden hesaplayıp karşılaştırmak, panel indirmeden önce
  # aynı soruyu sormak demektir. Hesap SUNUCUDA yapılır (141 MB'ı geri
  # indirmeden).
  bek_sha512=$(grep -m1 -A2 "url: TeksERP-$surum-Setup.exe" "$latest" | grep -m1 "sha512:" | awk '{print $2}')
  if [ -n "$bek_sha512" ]; then
    gercek_sha512=$(ssh "$SSH_HEDEF" \
      "openssl dgst -sha512 -binary '$UZAK_DIZIN/TeksERP-$surum-Setup.exe' | openssl base64 -A")
    if [ "$bek_sha512" != "$gercek_sha512" ]; then
      hata "SAĞLAMA UYUŞMUYOR — sunucudaki paket latest.yml'in söylediği dosya DEĞİL.
  beklenen: $bek_sha512
  sunucuda: $gercek_sha512
  Panel bu paketi reddeder. Yeniden yükle."
    fi
    echo "  ✓ sha512 doğrulandı (latest.yml ↔ sunucudaki paket)"
  else
    echo "  ⚠️ latest.yml'de sha512 bulunamadı — sağlama doğrulaması ATLANDI."
  fi
fi

echo "Doğrulanıyor..."

# Her dosyayı ÖNCE temiz URL ile, sorun varsa önbelleği atlayarak dener.
# Amaç, "404" ile "önbellekte kalmış 404"ü YÜKLEME ANINDA ayırmak: ikisi aynı
# görünür ama biri yeniden yüklemekle, diğeri yalnız Cloudflare purge'üyle
# çözülür. (2026-08-26'da bu ayrım elle yapıldı; buraya o yüzden kondu.)
dogrula() {
  local ad="$1" yerel="$2" url kod origin uzak
  url="$YAYIN_URL/$ad"
  kod=$(belirtecli_curl -s -o /dev/null -w "%{http_code}" -I "$url")
  if [ "$kod" != "200" ]; then
    origin=$(belirtecli_curl -s -o /dev/null -w "%{http_code}" -I "$url?onbellek-atla=$$")
    # ⚠️ Bu dal İSTEYEREK ÜRETİLEMEDİ (2026-08-27, mobil oturumuyla birlikte
    # ölçüldü): sunucudaki `error_page 404 → Cache-Control: no-store` ikinci
    # hattı 404'lerin Cloudflare önbelleğine girmesini zaten engelliyor
    # (`cf-cache-status: DYNAMIC`). Yani dal bugün teoride kalıyor ve kodda
    # savunma derinliği olarak duruyor: o nginx kuralı değişirse ya da başka
    # bir hata yolu önbelleğe girerse, tek sinyal bu olur.
    if [ "$origin" = "200" ]; then
      hata "$ad — ÖNBELLEK SORUNU (temiz URL: $kod, origin: 200).
  Dosya sunucuda DURUYOR; Cloudflare eski bir yanıtı önbellekte tutuyor.
  Çözüm: Cloudflare → Caching → Configuration → Purge Cache → Custom Purge → By URL:
    $url"
    fi
    hata "$ad — yayında görünmüyor (HTTP $kod). Dosya gerçekten yüklenmemiş olabilir."
  fi
  # Boyut kıyası: yarım yüklenmiş dosya 200 döner ama eksiktir.
  uzak=$(belirtecli_curl -s -o /dev/null -w "%{size_download}" "$url?onbellek-atla=$$")
  if [ -n "$yerel" ] && [ "$uzak" != "$yerel" ]; then
    hata "$ad — boyut uyuşmuyor (yerel: $yerel, yayında: $uzak). Yükleme yarım kalmış olabilir."
  fi
}

yayindaki=$(belirtecli_curl -fsS "$YAYIN_URL/latest.yml?onbellek-atla=$$" | grep "^version:" | awk '{print $2}')
[ "$yayindaki" = "$surum" ] || hata "Yayındaki sürüm '$yayindaki', beklenen '$surum'."

dogrula "latest.yml" ""
if [ "$denetim_kipi" = "1" ]; then
  # Yerel paket yoksa boyut kıyası yapılamaz; yalnız erişilebilirlik denetlenir.
  dogrula "TeksERP-$surum-Setup.exe.blockmap" ""
  dogrula "TeksERP-$surum-Setup.exe" ""
else
  dogrula "TeksERP-$surum-Setup.exe.blockmap" "$(wc -c < "$blockmap" | tr -d ' ')"
  dogrula "TeksERP-$surum-Setup.exe" "$(wc -c < "$setup" | tr -d ' ')"
fi

echo "OK — yayında: $surum"
[ "$denetim_kipi" = "1" ] && exit 0

# --- YAYIN DEFTERİ ---------------------------------------------------------
# "Bu sürümü kim, ne zaman, hangi makineden, hangi sağlamayla yayınladı."
# Sahada bir panel bozulduğunda ilk soru "hangi paketi almış" olur; defter
# olmadan cevap yalnız dosya tarihidir ve o da kopyalamayla değişir.
#
# ⚠️ Defter yayın ağacının (html/) DIŞINDA durur. İlk yazımda html/ içindeydi ve
# internete AÇIKTI (ölçüldü: HTTP 200) — iç makine adlarını ve yayın geçmişini
# sızdırıyordu. nginx'e kural yazmak da olurdu ama kırılgan: yarın oraya konan
# ikinci bir iç dosya yine sızardı. Ayrım DİZİNDE olmalı — html/ yalnız kamuya
# açık olması gereken şeyleri barındırır.
DEFTER_DIZIN="$(dirname "$YAYIN_KOK")/defter"
# Terfi atlandıysa (S4) kullanıcının cümlesi 6. kolon olur; tek tırnak uzak kabuk için kaçırılır.
defter_bicim='%s\t%s\t%s\t%s\t%s\n'
defter_ek=""
if [ "$terfi_atla_verildi" = "1" ]; then
  defter_bicim='%s\t%s\t%s\t%s\t%s\t%s\n'
  terfi_atla_kacisli=$(printf '%s' "$terfi_atla" | tr '\t\r\n' '   ' | sed "s/'/'\\\\''/g")
  defter_ek=" 'terfi-atlandi: $terfi_atla_kacisli'"
fi
ssh "$SSH_HEDEF" "mkdir -p '$DEFTER_DIZIN' && printf '$defter_bicim' \
  '$(date -Iseconds)' '$surum' '$(whoami)@$(hostname -s)' \
  '$(shasum -a 256 "$setup" | cut -c1-16)' '$(wc -c < "$setup" | tr -d " ")'$defter_ek \
  >> '$DEFTER_DIZIN/$musteri-YAYIN-DEFTERI.tsv'" 2>/dev/null \
  && echo "  ✓ yayın defterine yazıldı" \
  || echo "  ⚠️ yayın defteri yazılamadı (yayın etkilenmedi)"

# --- ESKİ SÜRÜMLERİ BUDA ---------------------------------------------------
# Son 5 sürüm durur. Bugün sınırsız birikiyordu: her paket ~141 MB, yılda
# birkaç sürümle disk sessizce doluyor. `latest.yml` her zaman korunur;
# silinen yalnız ARTIK GÖSTERİLMEYEN eski paketlerdir.
# ⚠️ Silmeden önce yayındaki sürüm dışlanır — çalışan yayına dokunulmaz.
ssh -T "$SSH_HEDEF" bash -s -- "$UZAK_DIZIN" "$surum" <<'BUDA' 2>/dev/null || true
  dizin="$1"; guncel="$2"; tut=5
  cd "$dizin" || exit 0
  ls -1t TeksERP-*-Setup.exe 2>/dev/null | grep -v "TeksERP-$guncel-Setup.exe" \
    | tail -n +$tut | while read -r eski; do
        echo "  ↷ budandı: $eski"
        rm -f "$eski" "$eski.blockmap"
      done
BUDA

# --- SÜRÜM ETİKETİ ---------------------------------------------------------
# Bir sonraki turun tabanı budur (`electron-paketle.sh` okur). Etiket YAYIN
# BİTTİKTEN sonra atılır — "sahaya çıkan kod tam olarak buydu" kaydıdır, elle
# verilen bir karar değil.
#
# ⚠️ BEST-EFFORT: yayın zaten yapıldı. Etiketleme düşerse UYARI basılır, yayın
# başarısız sayılmaz — aksi hâlde operatör başarılı bir yayını tekrarlamaya
# itilirdi. Var olan etiket TAŞINMAZ: aynı turda ikinci müşteriye yayın
# yaparken `-f` ile taşımak, etiketin işaret ettiği kodu sessizce değiştirirdi.
#
# Terfi atlandıysa (S4) kullanıcının cümlesi etiket MESAJINA girer: yeni atılan sürüm etiketine ve
# `terfi/<kanal>/panel-vX` kaçış etiketine (cümle argv'den — kabuk metnine gömülmez).
node --input-type=module -e "
  import { etiketAt } from '$kok/scripts/lib/surum.mjs';
  import { cumleDenetle, terfiAtlaMesaji } from '$kok/scripts/lib/terfi.mjs';
  const cumle = process.argv[1] ? cumleDenetle(process.argv[1]).cumle : '';
  const s = etiketAt('panel', '$surum', cumle ? { mesaj: terfiAtlaMesaji({ kod: '$musteri', urun: 'panel', surum: '$surum', cumle }) } : {});
  const mesaj = {
    'atildi': '  ✓ sürüm etiketi atıldı: ' + s.ad,
    'zaten-var': '  · sürüm etiketi zaten var: ' + s.ad + ' (aynı tur)',
    'basarisiz': '  ⚠️ sürüm etiketi atılamadı: ' + s.ad + ' (yayın etkilenmedi)',
  }[s.durum];
  console.log(mesaj + (s.not ? ' — ' + s.not : ''));
" -- "$terfi_atla" || echo "  ⚠️ sürüm etiketi atılamadı (yayın etkilenmedi)"
if [ "$terfi_atla_verildi" = "1" ]; then
  node "$kok/scripts/kanal-kapisi.mjs" terfi-atla-kaydi "$musteri" panel "$surum" "$terfi_atla" \
    || echo "  ⚠️ terfi atlama etiketi atılamadı (yayın etkilenmedi; kayıt yayın defterinde)"
fi

# --- PORTALA YAYIN BİLDİRİMİ (Faz 3d) ---------------------------------------
# Satıcı portalının sürüm/kanal görünümü + yayın defteri: YAYIN (+ üretim kanalında TERFI, kaçışta
# TERFI_ATLANDI), yayıncı anahtarıyla imzalı (scripts/lib/yayin-bildirim.mjs). ⚠️ BEST-EFFORT: yardımcı
# ASLA fırlatmaz, gitmezse yalnız uyarı basar — yayın zaten yapıldı, durdurulmaz.
bildirim_terfi=""
[ "$terfi_atla_verildi" = "1" ] && bildirim_terfi="--terfi-atla=$terfi_atla"
node "$kok/scripts/lib/yayin-bildirim.mjs" bildir-yayin --urun=panel --kanal="$musteri" --surum="$surum" --tur=kurulum \
  --sha16="$(shasum -a 256 "$setup" | cut -c1-16)" --boyut="$(wc -c < "$setup" | tr -d ' ')" \
  ${bildirim_terfi:+"$bildirim_terfi"} || echo "  ⚠️ portala yayın bildirimi gönderilemedi (yayın etkilenmedi)"

echo "Bu kanaldaki paneller en geç 15 dk içinde görür (açılışta 30 sn)."
echo "Hemen denemek için: Genel Ayarlar > Bu Bilgisayar > Güncelleme > Şimdi kontrol et"
