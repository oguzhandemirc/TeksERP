#!/bin/sh
# Satıcı konteyner girişi: DATABASE_URL'i DB parola SIRRINDAN kurar ve komutu çalıştırır.
# Parola compose `secrets:` dosyasından okunur — imaj yapılandırmasına ve `docker inspect`e girmez.
# Parola URL güvenli olmalı (onaltılık üretilir; runbook §3).
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  dosya="${DB_PAROLA_DOSYASI:-/run/secrets/db_parolasi}"
  if [ ! -r "$dosya" ]; then
    echo "[satici] DB parola dosyası okunamıyor: $dosya (SIR_GID grubu ve 0440 izni?)" >&2
    exit 1
  fi
  parola="$(tr -d '\r\n' < "$dosya")"
  case "$parola" in
    *[!0-9A-Za-z]*|"") echo "[satici] DB parolası boş ya da URL güvenli değil (yalnız harf/rakam)" >&2; exit 1 ;;
  esac
  DATABASE_URL="postgresql://${DB_KULLANICI:-satici}:${parola}@${DB_HOST:-satici-db}:5432/${DB_ADI:-satici}?schema=public"
  export DATABASE_URL
  unset parola
fi

exec "$@"
