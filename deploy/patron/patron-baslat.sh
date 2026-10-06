#!/bin/sh
# Patron konteyner girişi: DB URL'lerini ve satıcı iç API belirtecini docker SECRET dosyalarından kurar,
# komutu çalıştırır — sırlar imaj yapılandırmasına ve `docker inspect`e girmez. Üç rol, üç parola:
#   uygulama + eşitleme  → sunucu (DATABASE_URL · ESITLEME_DATABASE_URL)
#   göç (tablo sahibi)   → YALNIZ bağlıysa (patron-goc: migrate deploy · db-rolleri · tesis-db goc · tesis CLI'si;
#                          patron-hazirla: tesis-db izle)
# Parolalar URL güvenli olmalı (onaltılık üretilir; runbook §3).
set -eu

S=/run/secrets
DB="${DB_HOST:-patron-db}:5432/${DB_ADI:-patron}?schema=public"

parola() {
  if [ ! -r "$S/$1" ]; then
    echo "[patron] sır okunamıyor: $S/$1 (SIR_GID grubu ve 0440 izni?)" >&2
    exit 1
  fi
  p="$(tr -d '\r\n' < "$S/$1")"
  case "$p" in
    *[!0-9A-Za-z]*|"") echo "[patron] $1 boş ya da URL güvenli değil (yalnız harf/rakam)" >&2; exit 1 ;;
  esac
  printf '%s' "$p"
}

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL="postgresql://patron_uygulama:$(parola uygulama_parolasi)@$DB"
  ESITLEME_DATABASE_URL="postgresql://patron_esitleme:$(parola esitleme_parolasi)@$DB"
  export DATABASE_URL ESITLEME_DATABASE_URL
fi
if [ -z "${GOC_DATABASE_URL:-}" ] && [ -e "$S/goc_parolasi" ]; then
  GOC_DATABASE_URL="postgresql://patron_goc:$(parola goc_parolasi)@$DB"
  export GOC_DATABASE_URL
fi
# Tesis rol anahtarı (sunucu · göç · hazırlayıcı): sır bağlıysa yolu verilir; anahtarın kendisi ortama girmez.
if [ -z "${TESIS_ROL_ANAHTARI_DOSYASI:-}" ] && [ -e "$S/tesis_rol_anahtari" ]; then
  TESIS_ROL_ANAHTARI_DOSYASI="$S/tesis_rol_anahtari"
  export TESIS_ROL_ANAHTARI_DOSYASI
fi
# Boş sır dosyası = iç API kapalı (KURULUM_KAYNAGI=kayit); biçim denetimi sunucunun yapılandırmasında.
if [ -z "${SATICI_IC_API_BELIRTECI:-}" ] && [ -s "$S/ic_api_belirteci" ]; then
  SATICI_IC_API_BELIRTECI="$(tr -d '\r\n' < "$S/ic_api_belirteci")"
  export SATICI_IC_API_BELIRTECI
fi

exec "$@"
