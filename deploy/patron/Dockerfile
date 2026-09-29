# syntax=docker/dockerfile:1
# =============================================================================
# TeksERP PATRON BULUTU — iki hedef: `sunucu` ve `yedek`
# =============================================================================
# Bağlam `imaj-derle.sh`in HEAD'den (git archive) kurduğu temiz dizindir; VDS'te derleme YOK,
# kaynak VDS'e gitmez (imaj `docker save` arşiviyle taşınır). Runbook: docs/ops/PATRON-BULUTU-KURULUM.md
#
#   sunucu — node dist/server.js (tek süreç, tek dinleyici: /v1 · /api · /saglik · web sürümü `/`) ·
#            Prisma şema motoru + derlenmiş CLI (göç rolleri · tesis/ilk yönetici) patron-goc için içeride
#   yedek  — pg_dump 16 + yedek-sifrele.cjs (.tkenc) döngüsü; anahtar dizini arşivi de şifreli
#
# İkisi de root OLMAYAN kullanıcıyla (10001) koşar; compose kök FS'i salt okunur bağlar.
# Taban imajlar özetle sabitlenir (satıcıyla aynı özetler — aynı etiket yarın başka bayt olmasın).
# =============================================================================
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG PG_IMAGE=postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

# -----------------------------------------------------------------------------
# Web sürümü: `expo export --platform web` çıktısı platformdan bağımsız statik dosyadır → derleme
# makinesinin kendi mimarisinde (öykünmesiz). Yalnız çıktı sunucu imajına geçer; uygulamanın
# kaynağı ve node_modules'ü geçmez. Adres `koken`: API ile aynı kökenden (src/lib/config.ts).
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web
ENV CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_PATRON_API=koken
WORKDIR /web
COPY uygulama/package.json uygulama/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY uygulama/ ./
RUN npx expo export --platform web --output-dir /web-cikti \
 && rm -f /web-cikti/metadata.json \
 && test -f /web-cikti/index.html \
 && ls /web-cikti/_expo/static/js/web/ | grep -q '^entry-.*\.js$'

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
# generate: istemci + bu platformun şema motoru indirilir (çalışma anında ağ YOK — ic ağı internal).
# CLI'lar (göç rolleri · tesis/ilk yönetici) imajda derlenmiş durur: VDS'te tsx/kaynak yok.
RUN npx prisma generate \
 && npx prisma version \
 && npx tsc -p tsconfig.json \
 && npx tsc --ignoreConfig --outDir dist-cli --rootDir . --target es2022 --module commonjs --esModuleInterop \
      --strict --skipLibCheck --resolveJsonModule --types node scripts/tesis.ts scripts/db-rolleri.ts \
 && npm prune --omit=dev \
 && test -f dist/server.js && test -f dist/http/web-static.js \
 && test -f dist-cli/scripts/tesis.js && test -f dist-cli/scripts/db-rolleri.js \
 && ls node_modules/@prisma/engines | grep -q '^schema-engine-'

# -----------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS sunucu
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 patron \
 && useradd -u 10001 -g 10001 -M -d /tmp -s /usr/sbin/nologin patron
WORKDIR /uygulama
# Uygulama dosyaları root'a ait ve salt okunur: süreç kendi kodunu değiştiremez.
COPY --from=derleme /uygulama/node_modules ./node_modules
COPY --from=derleme /uygulama/dist ./dist
COPY --from=derleme /uygulama/dist-cli ./dist-cli
COPY --from=derleme /uygulama/prisma ./prisma
COPY --from=derleme /uygulama/prisma.config.ts /uygulama/package.json ./
COPY --from=web /web-cikti ./web
COPY --chmod=0755 patron-baslat.sh /usr/local/bin/patron-baslat
ENV NODE_ENV=production \
    HOME=/tmp \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    ANAHTAR_DIZINI=/anahtarlar \
    PATRON_WEB_DIZINI=/uygulama/web
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/patron-baslat"]
CMD ["node", "dist/server.js"]

# -----------------------------------------------------------------------------
FROM ${PG_IMAGE} AS yedek
# Node yalnız yedek-sifrele.cjs için (bağımlılıksız tek dosya, node:crypto).
# /arac önceden 0755 açılır: COPY --chmod örtük yaratılan üst dizine de uygulanır (0444 → gezilemez).
RUN apk add --no-cache nodejs \
 && adduser -D -H -u 10001 -s /sbin/nologin patron \
 && install -d -m 0755 /arac
COPY --chmod=0444 yedek-sifrele.cjs /arac/yedek-sifrele.cjs
COPY --chmod=0755 yedek-dongusu.sh /arac/yedek-dongusu.sh
ENV HOME=/tmp
USER 10001:10001
ENTRYPOINT ["/arac/yedek-dongusu.sh"]
CMD ["dongu"]
