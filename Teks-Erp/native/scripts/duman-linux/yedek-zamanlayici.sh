#!/bin/sh
# Sahte yedek zamanlayıcısı: servis ayakta kalır, SIGTERM'de temiz çıkar (yedek almaz).
trap 'exit 0' TERM INT
while :; do sleep 3600 & wait $!; done
