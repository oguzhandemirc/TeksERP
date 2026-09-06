#!/bin/zsh
# =============================================================================
# Denetim skill'lerindeki rg/grep komutlarının SÖZDİZİMİNİ sınar.
# =============================================================================
# NEDEN: bir denetim skill'indeki kırık regex "0 sonuç" gibi görünür ve
# SAHTE DOĞRULAMA üretir ("sınır durumu yok", "partial unique yok" gibi).
# Bu, skill'lerin kendi uyardığı körlük sınıfının ta kendisidir.
# 2026-08-09'da iki gerçek vaka bulundu ve düzeltildi:
#   • `reduce\(.*, *(0|\[\]|\{\}))`  -> fazladan parantez, regex parse error
#   • `CHECK (` kaçışsız + `rg -rn`  -> `-r` ripgrep'te REPLACE demek, çıktıyı bozuyor
#
# NE HATA SAYILIR: yalnız SÖZDİZİMİ hatası. "0 satır döndü" hata DEĞİLDİR —
# desen geçerli olabilir ve bu repoda gerçekten eşleşme olmayabilir.
#
# ÇALIŞTIR:  zsh audit/tools/check-skill-commands.sh
# ÇIKIŞ:     0 = temiz, 1 = en az bir kırık komut
#
# NEGATİF SONDA (aracın kör olmadığının kanıtı): bir skill komutunu kasten boz
# (ör. `CHECK \(` -> `CHECK (`), aracı koştur, "sözdizimi hatası: 1" görmelisin.
# 2026-08-09'da bu sonda koşturuldu ve araç doğru şekilde kırmızı verdi.
# =============================================================================

# `rg` bu makinede etkileşimli profilde tanımlı bir SHELL FONKSİYONUDUR
# (Claude Code sarmalayıcısı) ve alt-shell'e miras kalmaz. Shim olmadan her rg
# komutu "command not found" ile düşer, sözdizimi hiç sınanmaz ve araç
# YANLIŞ YEŞİL verir. Gerçek binary'e köprü:
if ! command -v rg >/dev/null 2>&1; then
  _cc="${CLAUDE_CODE_EXECPATH:-/Users/oad/.local/bin/claude}"
  if [[ -x "$_cc" ]]; then
    rg() { ARGV0=rg "$_cc" "$@"; }
  else
    print -u2 "UYARI: rg bulunamadı — rg komutları SINANMADI (yanlış yeşil riski)."
  fi
fi

REPO=/Users/oad/Documents/projeler/AdnanSahin
BE=$REPO/Teks-Erp

files=(
  ~/.claude/skills/express-api-audit/SKILL.md
  ~/.claude/skills/express-api-audit/references/*.md(N)
  ~/.claude/skills/code-review-skill/SKILL.md
  ~/.claude/skills/code-review-skill/references/*.md(N)
)

typeset -i total=0 broken=0 skipped=0
typeset -a lines
typeset n cmd wd err

for f in $files; do
  [[ -f "$f" ]] || continue
  lines=("${(@f)$(grep -nE '^[[:space:]]*(rg|grep) ' "$f" 2>/dev/null)}")
  for entry in $lines; do
    [[ -z "$entry" ]] && continue
    n="${entry%%:*}"
    cmd="${entry#*:}"
    # <...> yer tutucu taşıyan satırlar ŞABLONDUR, koşturulmaz (yer tutucu
    # gerçek bir desen değildir; koşturmak sahte hata üretir).
    if [[ "$cmd" == *"<"*">"* ]]; then
      (( skipped++ ))
      continue
    fi
    # İKİ KÖK: skill'ler hem backend'e (src/, prisma/) hem denetim defterine
    # (audit/) göre komut yazıyor. Tek cwd ile koşmak, defter komutlarını her
    # koşuda IO hatasına düşürür ve gerçek kırıklık o gürültüde kaybolur.
    wd=$BE
    [[ "$cmd" == *"audit/"* ]] && wd=$REPO
    (( total++ ))
    err=$(cd "$wd" && eval "$cmd" 2>&1 >/dev/null)
    if [[ "$err" == *"parse error"* || "$err" == *"not balanced"* || \
          "$err" == *"nmatched"*    || "$err" == *"Invalid"*      || \
          "$err" == *"nterminated"* || "$err" == *"Trailing backslash"* ]]; then
      (( broken++ ))
      print -r -- "KIRIK  ${f:h:t}/${f:t}:$n"
      print -r -- "       $cmd"
      print -r -- "       -> $(print -r -- "$err" | head -2 | tr '\n' ' ')"
    fi
  done
done

print -r -- "---"
print -r -- "taranan dosya: ${#files} · koşturulan komut: $total · şablon (atlandı): $skipped · sözdizimi hatası: $broken"
(( broken == 0 )) || exit 1
