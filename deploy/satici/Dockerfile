# syntax=docker/dockerfile:1
# =============================================================================
# TeksERP SATICI (lisans) sunucusu — iki hedef: `sunucu` ve `yedek`
# =============================================================================
# Bağlam `imaj-derle.sh`in HEAD'den (git archive) kurduğu temiz dizindir; VDS'te derleme YOK,
# kaynak VDS'e gitmez (imaj `docker save` arşiviyle taşınır). Runbook: docs/ops/SATICI-KURULUM.md
#
#   sunucu — node dist/server.js (tek süreç, iki dinleyici) · Prisma şema motoru göç işi için içeride
#   yedek  — pg_dump 16 + yedek-sifrele.cjs (.tkenc) döngüsü; anahtar dizini arşivi de şifreli
#
# İkisi de root OLMAYAN kullanıcıyla (10001) koşar; compose kök FS'i salt okunur bağlar.
# Taban imajlar özetle sabitlenir (aynı etiket yarın başka bayt olmasın).
# =============================================================================
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG PG_IMAGE=postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS derleme
# Prisma şema motoru (migrate deploy) libssl ister; sorgu yolu WASM + pg bağdaştırıcısıdır.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /uygulama
COPY sunucu/package.json sunucu/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY sunucu/ ./
# generate: istemci + bu platformun şema motoru indirilir (çalışma anında ağ YOK — iç ağ internal).
# Portal kullanıcı CLI'ı (ilk yönetici · kurtarma) imajda derlenmiş durur: VDS'te tsx/kaynak yok.
RUN npx prisma generate \
 && npx prisma version \
 && npx tsc -p tsconfig.json \
 && npx tsc --ignoreConfig --outDir dist-cli --rootDir . --target es2022 --module commonjs --esModuleInterop \
      --strict --skipLibCheck --resolveJsonModule --types node scripts/portal-kullanici.ts \
 && npm prune --omit=dev \
 && test -f dist/server.js && test -f dist/keys/signer-child.js && test -f dist-cli/scripts/portal-kullanici.js \
 && ls node_modules/@prisma/engines | grep -q '^schema-engine-'

# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS sunucu
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 satici \
 && useradd -u 10001 -g 10001 -M -d /tmp -s /usr/sbin/nologin satici
WORKDIR /uygulama
# Uygulama dosyaları root'a ait ve salt okunur: süreç kendi kodunu değiştiremez.
COPY --from=derleme /uygulama/node_modules ./node_modules
COPY --from=derleme /uygulama/dist ./dist
COPY --from=derleme /uygulama/dist-cli ./dist-cli
COPY --from=derleme /uygulama/prisma ./prisma
COPY --from=derleme /uygulama/prisma.config.ts /uygulama/package.json ./
COPY --chmod=0755 satici-baslat.sh /usr/local/bin/satici-baslat
ENV NODE_ENV=production \
    HOME=/tmp \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    ANAHTAR_DIZINI=/anahtarlar
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/satici-baslat"]
CMD ["node", "dist/server.js"]

# -----------------------------------------------------------------------------
FROM ${PG_IMAGE} AS yedek
# Node yalnız yedek-sifrele.cjs için (bağımlılıksız tek dosya, node:crypto).
# /arac önceden 0755 açılır: COPY --chmod örtük yaratılan üst dizine de uygulanır (0444 → gezilemez).
RUN apk add --no-cache nodejs \
 && adduser -D -H -u 10001 -s /sbin/nologin satici \
 && install -d -m 0755 /arac
COPY --chmod=0444 yedek-sifrele.cjs /arac/yedek-sifrele.cjs
COPY --chmod=0755 yedek-dongusu.sh /arac/yedek-dongusu.sh
ENV HOME=/tmp
USER 10001:10001
ENTRYPOINT ["/arac/yedek-dongusu.sh"]
CMD ["dongu"]
