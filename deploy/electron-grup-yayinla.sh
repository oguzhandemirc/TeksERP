#!/usr/bin/env bash
# =============================================================================
# TEK ORTAK PANEL PAKETİNİ bir güncelleme grubuna yayınlar / terfi ettirir (macOS/Linux; Windows'ta Git Bash/WSL).
# Eski kanal yayıncısı (`deploy/electron-yayinla.sh --musteri=…`) BAYT-DONUKTUR ve bu betik onun yerine geçmez:
# grup yayını yalnız dağıtım kaydındaki gruplara (`deploy/dagitim.json`: test → oncu → genel) gider; eski kanal kodu
# hedef olamaz. Paket `deploy/electron-paketle.sh <sürüm>` ile BİR kez derlenir (Electron/release/ortak/<sürüm>).
#
# Kullanım:
#   ./deploy/electron-grup-yayinla.sh --grup=test --anahtar=<panel imza anahtarı>        # ilk yayın (terfi etiketi yok)
#   ./deploy/electron-grup-yayinla.sh --grup=oncu  [sürüm]                                # test'te yayında + onay etiketi
#   ./deploy/electron-grup-yayinla.sh --grup=genel [sürüm]                                # K-6: AYRI ikinci onay etiketi
#   ./deploy/electron-grup-yayinla.sh --grup=oncu --dogrula                               # YÜKLEME YOK — yayını denetle
#   ./deploy/electron-grup-yayinla.sh --grup=oncu --kuru                                  # AĞ YOK — yerel kapılar + plan
#   ./deploy/electron-grup-yayinla.sh --grup=oncu --terfi-atla="<kullanıcının cümlesi>"   # terfi kaçışı
#   ./deploy/electron-grup-yayinla.sh --grup=oncu --profil-matrisi-atla="<cümle>"         # profil matrisi kaçışı
#
# ⚠️ KÜNYE HEDEF GRUPLA İMZALANIR: panel künyenin kanalını KENDİ güncelleme grubuyla eşler. Terfide paket dosyası
# BAYT-EŞİT kalır (ortak paketten, sembolik bağla); yalnız `latest.yml` künyesi hedef grubun adıyla yeniden imzalanır.
# ⚠️ YÜKLEME SIRASI pazarlık dışı: paket + blockmap ÖNCE, `latest.yml` EN SON (yayını açan adım). Cloudflare proxy AÇIK kalır.
# ⚠️ GERÇEK YAYIN kullanıcı onayıyla yapılır; `--kuru` ağa hiç çıkmaz.
# Hedef (ssh takma adı · VDS dizini · doğrulama adresi · defter) YALNIZ deploy/dagitim.json'dan türer
# (`grup-yayin-kapisi.mjs hedef`); SSH_HEDEF · UZAK_DIZIN · YAYIN_KOK · YAYIN_URL · BASE_URL ortamda doluysa betik DURUR.
# Reçete: docs/kurallar/surum-yayin.md · docs/design/TEK-ORTAK-PAKET.md §3.5
# =============================================================================
set -euo pipefail

kok="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
electron_dir="$kok/Electron"

hata() { echo "HATA: $*" >&2; exit 1; }

# --- Argümanlar ------------------------------------------------------------
grup=""
denetim_kipi=0
kuru=0
surum_arg=""
terfi_atla=""
terfi_atla_verildi=0
profil_atla=""
profil_atla_verildi=0
panel_anahtar="${TEKSERP_PANEL_IMZA_ANAHTARI:-}"
for a in "$@"; do
  case "$a" in
    --grup=*) grup="${a#--grup=}" ;;
    --anahtar=*) panel_anahtar="${a#--anahtar=}" ;;
    --dogrula) denetim_kipi=1 ;;
    --kuru) kuru=1 ;;
    --terfi-atla=*) terfi_atla="${a#--terfi-atla=}"; terfi_atla_verildi=1 ;;
    --terfi-atla) terfi_atla=""; terfi_atla_verildi=1 ;;
    --profil-matrisi-atla=*) profil_atla="${a#--profil-matrisi-atla=}"; profil_atla_verildi=1 ;;
    --musteri=*|--musteri) hata "--musteri eski kanal yayıncısının argümanıdır (deploy/electron-yayinla.sh); grup yayını --grup=<test|oncu|genel> alır." ;;
    -*) hata "Tanınmayan seçenek: $a" ;;
    *)
      [ -z "$surum_arg" ] || hata "Fazla argüman: $a"
      surum_arg="$a"
      ;;
  esac
done

[ "$kuru" = "1" ] && [ "$denetim_kipi" = "1" ] && hata "--kuru ile --dogrula birlikte verilemez (--dogrula yayına bakar, --kuru hiç ağa çıkmaz)."
[ "$terfi_atla_verildi" = "1" ] && [ "$denetim_kipi" = "1" ] && hata "--terfi-atla yalnız yayında verilir (--dogrula hiçbir şey yüklemez)."
[ "$profil_atla_verildi" = "1" ] && [ "$denetim_kipi" = "1" ] && hata "--profil-matrisi-atla yalnız yayında verilir (--dogrula hiçbir şey yüklemez)."

[ -n "$grup" ] || hata "HANGİ GRUBA YAYINLANIYOR? --grup=<test|oncu|genel> zorunlu.
  Örnek: ./deploy/electron-grup-yayinla.sh --grup=test"

# Grup kayıtlı mı + ESKİ KANAL kodu değil mi — hiçbir ağ/ssh işinden ÖNCE.
node "$kok/scripts/grup-yayin-kapisi.mjs" grup "$grup" \
  || hata "Grup kapısı geçilmedi (kayıt: deploy/dagitim.json) — hiçbir şey yüklenmedi."

# --- YAYIN HEDEFİ — YALNIZ dağıtım kaydından; ortamda ezme varsa CLI durdurur ------
hedef_satirlari=$(node "$kok/scripts/grup-yayin-kapisi.mjs" hedef "$grup" panel) \
  || hata "Yayın hedefi dağıtım kaydından çözülemedi — hiçbir şey yüklenmedi."
SSH_HEDEF=""; UZAK_DIZIN=""; YAYIN_URL=""; DEFTER_YOLU=""; TERFI_KAYNAGI="-"
while IFS='=' read -r ad deger; do
  case "$ad" in
    SSH_HEDEF) SSH_HEDEF="$deger" ;;
    UZAK_DIZIN) UZAK_DIZIN="$deger" ;;
    YAYIN_URL) YAYIN_URL="$deger" ;;
    DEFTER) DEFTER_YOLU="$deger" ;;
    TERFI_KAYNAGI) TERFI_KAYNAGI="$deger" ;;
  esac
done <<< "$hedef_satirlari"
{ [ -n "$SSH_HEDEF" ] && [ -n "$UZAK_DIZIN" ] && [ -n "$YAYIN_URL" ] && [ -n "$DEFTER_YOLU" ]; } \
  || hata "Yayın hedefi eksik çözüldü — hiçbir şey yüklenmedi."

# --- YAYIN BELİRTECİ — hiçbir ağ/ssh işinden ÖNCE ----------------------------------
# Güncelleme sunucusu anonim okumaya kapalıdır (Cloudflare Worker, X-TKL-Indirme); "ne yayında" VDS diskinden
# SSH ile okunur, kenar doğrulaması yalnız satıcı yayın belirteciyle yapılır. Belirteç yoksa DUR. --kuru ağa çıkmaz.
BELIRTEC_BASLIK=""
if [ "$kuru" = "0" ]; then
  BELIRTEC_BASLIK="$(mktemp "${TMPDIR:-/tmp}/tekserp-belirtec.XXXXXX")" || hata "Geçici dosya açılamadı."
  trap 'rm -f "$BELIRTEC_BASLIK"' EXIT
  node --input-type=module -e "
    import { baslikDosyasiYaz } from '$kok/scripts/lib/yayin-okuma.mjs';
    try { baslikDosyasiYaz(process.argv[1], process.argv[2]); } catch (e) { console.error('HATA: ' + e.message); process.exit(3); }
  " -- "$BELIRTEC_BASLIK" "/$grup/electron/" || hata "Yayın belirteci yok — hiçbir şey yüklenmedi (anonim okumaya düşülmez)."
  [ -s "$BELIRTEC_BASLIK" ] || hata "Yayın belirteci başlık dosyası boş — hiçbir şey yüklenmedi."
fi
# Güncelleme sunucusuna TEK sanksiyonlu HTTP okuması (bekçi: scripts/check-yayin-okuma.mjs).
belirtecli_curl() { curl -H "@$BELIRTEC_BASLIK" "$@"; }
# Uzak komut: betik stdin'den (`bash -s`), değerler KONUMSAL argüman; her değer tek sözcük kalmalı (çıkış 97).
uzak() {
  local a
  for a in "$@"; do
    { [ "${#a}" -le 512 ] && printf '%s' "$a" | grep -qE '^[A-Za-z0-9@%+,./:=_-]+$'; } \
      || { echo "HATA: uzak komut değeri biçimsiz, gönderilmedi: $a" >&2; return 97; }
  done
  ssh -T "$SSH_HEDEF" bash -s -- "$@"
}
surum_denetle() {
  printf '%s' "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$' || hata "Sürüm biçimsiz: '$1' (x.y.z bekleniyor) — uzak komutlara gidemez."
}

rel=""
grup_dizini=""
if [ "$denetim_kipi" = "0" ]; then
  surum="${surum_arg:-$(node -p "require('$electron_dir/package.json').version")}"
  surum_denetle "$surum"
  rel="$electron_dir/release/ortak/$surum"
  [ -d "$rel" ] || hata "Ortak paket klasörü yok: $rel
  Önce derle: ./deploy/electron-paketle.sh $surum   (sürüm numarasını ARTIRMAYI unutma)"

  # SÜRÜM NOTU KAPISI — beklenen sürüm ARGÜMANDAN; notu olmayan sürüm hiçbir gruba çıkmaz.
  node "$kok/scripts/check-surum-notlari.mjs" --panel="$surum" \
    || hata "Sürüm notu kapısı kırmızı — $surum için operatör notu yok ya da kuralları ihlal ediyor (yükleme yapılmadı)."
  # TEMİZ AĞAÇ — HEAD yayınlanan commit olmalı (kirli ağaçta HEAD yayınlanan şey değildir).
  node "$kok/scripts/kanal-kapisi.mjs" temiz-agac > /dev/null \
    || hata "Çalışma ağacı temiz değil — yükleme yapılmadı."
  # ARTEFAKT OTORİTESİ — paket gerçekten ORTAK kimlikte mi, imza çapası gömülü mü, künye HEAD'e bağlı mı (ssh'tan ÖNCE)
  node "$kok/scripts/panel-kimlik-kapisi.mjs" paket "$rel" \
    || hata "Paket ortak kimlikte değil — yükleme yapılmadı."
  node "$kok/scripts/grup-yayin-kapisi.mjs" capa "$rel" \
    || hata "Panel imza çapası kapıdan geçmedi — yükleme yapılmadı."
  node "$kok/scripts/grup-yayin-kapisi.mjs" derleme-bagi "$rel" "$surum" \
    || hata "Derleme bağı kopuk — yükleme yapılmadı."
  # TERFİ KAPISI — test grubu etiket istemez; oncu/genel: HEAD == panel-vX, terfi/<grup>/panel-vX onay etiketi,
  # kaynak grupta yayındaki sürüm ≥ X, kaynak artefaktın özeti = yüklenecek artefaktın özeti, genel için K-6 ikinci onay.
  terfi_ek=("--dizin=$rel")
  [ "$kuru" = "1" ] && terfi_ek+=("--kuru")
  [ "$terfi_atla_verildi" = "1" ] && terfi_ek+=("--terfi-atla=$terfi_atla")
  node "$kok/scripts/grup-yayin-kapisi.mjs" terfi "$grup" panel "$surum" "${terfi_ek[@]}" \
    || hata "Terfi kapısı geçilmedi — yükleme yapılmadı."
  # PROFİL MATRİSİ KAPISI — kök grup muaf; diğer gruplarda commit'in matris raporu yeşil olmalı (rapor yoksa ÖLÇÜLEMEDİ = DUR).
  if [ "$profil_atla_verildi" = "1" ]; then
    node "$kok/scripts/profil-matrisi-kapisi.mjs" --grup="$grup" --profil-matrisi-atla="$profil_atla" \
      || hata "Profil matrisi kapısı geçilmedi — yükleme yapılmadı."
  else
    node "$kok/scripts/profil-matrisi-kapisi.mjs" --grup="$grup" \
      || hata "Profil matrisi kapısı geçilmedi — yükleme yapılmadı."
  fi
  # Hedef grubun künye dizini: paket baytları sembolik bağ, latest.yml kopya (ortak paketin kendisi DEĞİŞMEZ).
  grup_dizini=$(node "$kok/scripts/grup-yayin-kapisi.mjs" hazirla "$grup" "$rel" "$surum") \
    || hata "Grup künye dizini hazırlanamadı — yükleme yapılmadı."
fi

# --- İMZALI KÜNYE KAPISI — ssh'tan ÖNCE ----------------------------------------
# Künyenin kanalı HEDEF GRUPTUR; imzasızsa imza aracı burada çağrılır (parola TTY'den). --kuru imzalamaz.
if [ "$denetim_kipi" = "0" ]; then
  imza_durum=0
  node "$kok/scripts/grup-yayin-kapisi.mjs" imza "$grup" "$grup_dizini" || imza_durum=$?
  if [ "$imza_durum" = "3" ] && [ "$kuru" = "1" ]; then
    echo "[kuru] künye     : İMZASIZ — gerçek yayında '$grup' adıyla imzalanır (--anahtar=<dosya> + parola)"
  elif [ "$imza_durum" = "3" ]; then
    [ -n "$panel_anahtar" ] || hata "Panel künyesi İMZASIZ ve imza anahtarı verilmedi — yükleme yapılmadı.
  --anahtar=<panel imza anahtarı dosyası> (ya da TEKSERP_PANEL_IMZA_ANAHTARI); parola TTY'den sorulur."
    ( cd "$kok/Teks-Erp" && npx tsx scripts/panel-imza.ts imzala --musteri="$grup" --dizin-paket="$grup_dizini" --anahtar="$panel_anahtar" ) \
      || hata "Künye imzalanamadı — yükleme yapılmadı."
    node "$kok/scripts/grup-yayin-kapisi.mjs" imza "$grup" "$grup_dizini" \
      || hata "İmzalanan künye kapıdan geçmedi — yükleme yapılmadı."
  elif [ "$imza_durum" != "0" ]; then
    hata "Panel künyesi geçersiz — yükleme yapılmadı (yukarıdaki satırlar)."
  fi
fi

# --- Salt denetim kipi ---------------------------------------------------
if [ "$denetim_kipi" = "1" ]; then
  denetim_surum="$surum_arg"
  if [ -z "$denetim_surum" ]; then
    denetim_surum=$(uzak "$UZAK_DIZIN/latest.yml" 2>/dev/null <<'UZAK' | grep "^version:" | awk '{print $2}'
cat -- "$1"
UZAK
) || hata "Yayındaki latest.yml okunamadı: $SSH_HEDEF:$UZAK_DIZIN/latest.yml"
    [ -n "$denetim_surum" ] || hata "Yayında latest.yml yok ya da sürüm satırı okunamadı."
  fi
  surum_denetle "$denetim_surum"
  echo "Yayın denetleniyor: $grup / $denetim_surum"
  surum="$denetim_surum"
else
  echo "Grup: $grup · Sürüm: $surum"
fi

setup="$rel/TeksERP-$surum-Setup.exe"
blockmap="$setup.blockmap"
latest="$grup_dizini/latest.yml"

if [ "$denetim_kipi" = "0" ]; then
  for f in "$setup" "$blockmap" "$latest"; do
    [ -f "$f" ] || hata "Eksik dosya: $f"
  done
  grep -q "^version: $surum\$" "$latest" || hata "latest.yml '$surum' sürümünü göstermiyor — eski build kalıntısı olabilir."

  mb=$(( $(wc -c < "$setup") / 1024 / 1024 ))
  echo "Yüklenecek: TeksERP-$surum-Setup.exe (${mb} MB) + blockmap + latest.yml (künye kanalı: $grup)"

  # --- KURU KİP: yerel kapıların hepsi geçti; hiçbir ağ/ssh/scp/curl/etiket işi yok ---
  if [ "$kuru" = "1" ]; then
    echo "[kuru] hedef      : $SSH_HEDEF:$UZAK_DIZIN/"
    echo "[kuru] sıra       : 1) TeksERP-$surum-Setup.exe + .blockmap (ortak paketten)  2) latest.yml (EN SON, '$grup' künyeli)"
    echo "[kuru] yayın adresi: $YAYIN_URL/latest.yml"
    echo "[kuru] defter     : $DEFTER_YOLU"
    echo "[kuru] değişmezlik · sha512 · dış doğrulama · budama · panel-v$surum etiketi ATLANDI (ağ gerektirir)"
    [ "$terfi_atla_verildi" = "1" ] && echo "[kuru] terfi atlama kaydı (yayın defteri + etiket mesajı) ATLANDI (yayın yok)"
    echo "KURU — ortak paket '$grup' grubuna hazır; yükleme yapılmadı."
    exit 0
  fi

  # --- DEĞİŞMEZLİK KAPISI: yayınlanmış bir sürümün dosyaları ÜZERİNE YAZILMAZ; aynı bayt ise yükleme atlanır ---
  uzak_sha=$(uzak "$UZAK_DIZIN/TeksERP-$surum-Setup.exe" 2>/dev/null <<'UZAK' || true
test -f "$1" && sha256sum -- "$1" | cut -d' ' -f1
UZAK
)
  if [ -n "$uzak_sha" ]; then
    yerel_sha=$(shasum -a 256 "$setup" | cut -d' ' -f1)
    if [ "$uzak_sha" = "$yerel_sha" ]; then
      echo "  ↷ $surum '$grup' grubunda AYNI baytlarla zaten var — yükleme atlanıyor."
      atla_yukleme=1
    else
      hata "DEĞİŞMEZLİK İHLALİ — $surum '$grup' grubunda FARKLI baytlarla duruyor.
  sunucu: $uzak_sha
  yerel : $yerel_sha
  Yayınlanmış bir sürümün üzerine yazmak delta güncellemesini bozar. Sürüm numarasını ARTIR ve yeniden paketle."
    fi
  fi

  # --- ROTASYON KİLİDİ: yayındaki latest.yml künyeliyse yeni imzalayan onun `capa`sında olmalı ---
  yayindaki_yml="$(mktemp "${TMPDIR:-/tmp}/tekserp-yayindaki.XXXXXX")" || hata "Geçici dosya açılamadı."
  rot_kod=0
  uzak "$UZAK_DIZIN/latest.yml" 2>/dev/null <<'UZAK' || rot_kod=$?
test -f "$1"
UZAK
  if [ "$rot_kod" = "0" ]; then
    uzak "$UZAK_DIZIN/latest.yml" > "$yayindaki_yml" 2>/dev/null <<'UZAK' \
      || { rm -f "$yayindaki_yml"; hata "Yayındaki latest.yml okunamadı — rotasyon kilidi ÖLÇÜLEMEDİ, yükleme yapılmadı."; }
cat -- "$1"
UZAK
  elif [ "$rot_kod" != "1" ]; then
    rm -f "$yayindaki_yml"
    hata "Yayın sunucusuna ulaşılamadı (ssh $rot_kod) — rotasyon kilidi ÖLÇÜLEMEDİ, yükleme yapılmadı."
  fi
  node "$kok/scripts/grup-yayin-kapisi.mjs" rotasyon "$grup" "$grup_dizini" "$yayindaki_yml" \
    || { rm -f "$yayindaki_yml"; hata "Rotasyon kilidi — yükleme yapılmadı."; }

  if [ "${atla_yukleme:-0}" != "1" ]; then
  echo "1/2  paket + blockmap..."
  scp -s "$setup" "$blockmap" "$SSH_HEDEF:$UZAK_DIZIN/"

  echo "2/2  latest.yml (en son — sıra önemli)..."
  scp -s "$latest" "$SSH_HEDEF:$UZAK_DIZIN/"
  elif ! cmp -s "$yayindaki_yml" "$latest"; then
    echo "2/2  latest.yml (paket zaten yayında; '$grup' künyeli latest.yml yükleniyor)..."
    scp -s "$latest" "$SSH_HEDEF:$UZAK_DIZIN/"
  fi
  rm -f "$yayindaki_yml"

  # --- SAĞLAMA DOĞRULAMASI (boyut YETMEZ): hesap SUNUCUDA yapılır ---
  bek_sha512=$(grep -m1 -A2 "url: TeksERP-$surum-Setup.exe" "$latest" | grep -m1 "sha512:" | awk '{print $2}')
  if [ -n "$bek_sha512" ]; then
    gercek_sha512=$(uzak "$UZAK_DIZIN/TeksERP-$surum-Setup.exe" <<'UZAK'
openssl dgst -sha512 -binary "$1" | openssl base64 -A
UZAK
)
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

# Her dosyayı ÖNCE temiz URL ile, sorun varsa önbelleği atlayarak dener ("404" ile "önbellekte kalmış 404"ü ayırır).
dogrula() {
  local ad="$1" yerel="$2" url kod origin uzak
  url="$YAYIN_URL/$ad"
  kod=$(belirtecli_curl -s -o /dev/null -w "%{http_code}" -I "$url")
  if [ "$kod" != "200" ]; then
    origin=$(belirtecli_curl -s -o /dev/null -w "%{http_code}" -I "$url?onbellek-atla=$$")
    if [ "$origin" = "200" ]; then
      hata "$ad — ÖNBELLEK SORUNU (temiz URL: $kod, origin: 200).
  Dosya sunucuda DURUYOR; Cloudflare eski bir yanıtı önbellekte tutuyor.
  Çözüm: Cloudflare → Caching → Configuration → Purge Cache → Custom Purge → By URL:
    $url"
    fi
    hata "$ad — yayında görünmüyor (HTTP $kod). Dosya gerçekten yüklenmemiş olabilir."
  fi
  uzak=$(belirtecli_curl -s -o /dev/null -w "%{size_download}" "$url?onbellek-atla=$$")
  if [ -n "$yerel" ] && [ "$uzak" != "$yerel" ]; then
    hata "$ad — boyut uyuşmuyor (yerel: $yerel, yayında: $uzak). Yükleme yarım kalmış olabilir."
  fi
}

yayindaki=$(belirtecli_curl -fsS "$YAYIN_URL/latest.yml?onbellek-atla=$$" | grep "^version:" | awk '{print $2}')
[ "$yayindaki" = "$surum" ] || hata "Yayındaki sürüm '$yayindaki', beklenen '$surum'."

dogrula "latest.yml" ""

# --- KENARDAKİ KÜNYE — panelin indireceği latest.yml imzalı ve KANALI BU GRUP mu? ---------------
uzak_yml="$(mktemp "${TMPDIR:-/tmp}/tekserp-uzak-yml.XXXXXX")" || hata "Geçici dosya açılamadı."
belirtecli_curl -fsS "$YAYIN_URL/latest.yml?onbellek-atla=$$" > "$uzak_yml" \
  || { rm -f "$uzak_yml"; hata "Yayındaki latest.yml indirilemedi — künye denetlenemedi."; }
if [ "$denetim_kipi" = "1" ]; then
  uzak_kod=0
  node "$kok/scripts/grup-yayin-kapisi.mjs" imza-uzak "$grup" "$uzak_yml" || uzak_kod=$?
  if [ "$uzak_kod" = "3" ]; then echo "  ⚠️ yayındaki latest.yml KÜNYESİZ — imza denetleyen paneller bu sürümü kurmaz";
  elif [ "$uzak_kod" != "0" ]; then rm -f "$uzak_yml"; hata "Yayındaki künye geçersiz."; fi
else
  cmp -s "$uzak_yml" "$latest" \
    || { rm -f "$uzak_yml"; hata "Kenardaki latest.yml yerelde imzalanan dosya DEĞİL — Cloudflare önbelleği ya da yarım yükleme (Purge by URL: $YAYIN_URL/latest.yml)."; }
  echo "  ✓ kenardaki latest.yml = '$grup' künyeli yerel dosya"
fi
rm -f "$uzak_yml"

if [ "$denetim_kipi" = "1" ]; then
  dogrula "TeksERP-$surum-Setup.exe.blockmap" ""
  dogrula "TeksERP-$surum-Setup.exe" ""
else
  dogrula "TeksERP-$surum-Setup.exe.blockmap" "$(wc -c < "$blockmap" | tr -d ' ')"
  dogrula "TeksERP-$surum-Setup.exe" "$(wc -c < "$setup" | tr -d ' ')"
fi

echo "OK — '$grup' grubunda yayında: $surum"
[ "$denetim_kipi" = "1" ] && exit 0

# --- YAYIN DEFTERİ (yayın ağacının DIŞINDA; defter yolu dağıtım kaydından) ------------------------------
defter_kim="$(whoami)@$(hostname -s)"
printf '%s' "$defter_kim" | grep -qE '^[A-Za-z0-9._@-]{1,120}$' || defter_kim="?"
terfi_b64=""
if [ "$terfi_atla_verildi" = "1" ]; then
  terfi_b64=$(printf '%s' "$terfi_atla" | tr '\t\r\n' '   ' | base64 | tr -d '\n')
fi
uzak "$DEFTER_YOLU" "$(date -Iseconds)" "$surum" "$defter_kim" "$(shasum -a 256 "$setup" | cut -c1-16)" "$(wc -c < "$setup" | tr -d ' ')" ${terfi_b64:+"$terfi_b64"} 2>/dev/null <<'UZAK' && echo "  ✓ yayın defterine yazıldı" || echo "  ⚠️ yayın defteri yazılamadı (yayın etkilenmedi)"
d="$1"; shift
mkdir -p "$(dirname "$d")" || exit 1
if [ -n "${6:-}" ]; then
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" "terfi-atlandi: $(printf '%s' "$6" | base64 -d)" >> "$d"
else
  printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >> "$d"
fi
UZAK

# --- ESKİ SÜRÜMLERİ BUDA: son 5 sürüm durur; yayındaki sürüm dışlanır ---------------------------------
uzak "$UZAK_DIZIN" "$surum" <<'BUDA' 2>/dev/null || true
  dizin="$1"; guncel="$2"; tut=5
  cd "$dizin" || exit 0
  ls -1t TeksERP-*-Setup.exe 2>/dev/null | grep -v "TeksERP-$guncel-Setup.exe" \
    | tail -n +$tut | while read -r eski; do
        echo "  ↷ budandı: $eski"
        rm -f "$eski" "$eski.blockmap"
      done
BUDA

# --- SÜRÜM ETİKETİ (best-effort; var olan etiket TAŞINMAZ) ve kaçış kaydı -------------------------------
if [ "$terfi_atla_verildi" = "1" ]; then
  node "$kok/scripts/grup-yayin-kapisi.mjs" surum-etiketi panel "$surum" "$grup" "$terfi_atla" \
    || echo "  ⚠️ sürüm etiketi atılamadı (yayın etkilenmedi)"
else
  node "$kok/scripts/grup-yayin-kapisi.mjs" surum-etiketi panel "$surum" \
    || echo "  ⚠️ sürüm etiketi atılamadı (yayın etkilenmedi)"
fi
if [ "$terfi_atla_verildi" = "1" ]; then
  node "$kok/scripts/grup-yayin-kapisi.mjs" terfi-atla-kaydi "$grup" panel "$surum" "$terfi_atla" \
    || echo "  ⚠️ terfi atlama etiketi atılamadı (yayın etkilenmedi; kayıt yayın defterinde)"
fi

# --- PORTALA YAYIN BİLDİRİMİ — best-effort: yardımcı ASLA fırlatmaz, gitmezse yalnız uyarı basar ----------
bildirim_ek=()
[ "$terfi_atla_verildi" = "1" ] && bildirim_ek+=("--terfi-atla=$terfi_atla")
[ "$terfi_atla_verildi" = "0" ] && [ "$TERFI_KAYNAGI" != "-" ] && bildirim_ek+=("--terfi-etiketi=terfi/$grup/panel-v$surum")
node "$kok/scripts/lib/yayin-bildirim.mjs" bildir-yayin --urun=panel --kanal="$grup" --surum="$surum" --tur=kurulum \
  --sha16="$(shasum -a 256 "$setup" | cut -c1-16)" --boyut="$(wc -c < "$setup" | tr -d ' ')" \
  ${bildirim_ek[@]+"${bildirim_ek[@]}"} || echo "  ⚠️ portala yayın bildirimi gönderilemedi (yayın etkilenmedi)"

echo "'$grup' grubundaki paneller en geç 15 dk içinde görür (açılışta 30 sn)."
