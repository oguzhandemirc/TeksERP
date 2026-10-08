# syntax=docker/dockerfile:1.7
# =============================================================================
# TeksERP — KORUMALI LINUX İMAJI (Faz 2f · müşteri teslimi · BARINDIRILAN sınıfının temeli)
# =============================================================================
# Demo imajından (kök Dockerfile) FARKI: çalışma aşaması KAYNAK TAŞIMAZ — sunucu V8 bayt
# kodu (.jsc, bytenode) + yükleyici, araçlar karartılmış tek dosya, native lisans çekirdeği,
# prod node_modules, Prisma şema motoru (debian-openssl-3.0.x) ve migration SQL. src · tsx ·
# seed .ts · .map YOK; süreç root DEĞİL; kök dosya sistemi salt-okunur koşabilir.
#
# ⚠ BAĞLAM DEPO KÖKÜDÜR (deploy/node-surumu.json + scripts/lib gerekir); içerik
#   `Dockerfile.dockerignore` İZİN LİSTESİYLE sınırlı. Native `.node` önceden derlenir:
#   `cd Teks-Erp/native/lisans-cekirdek && npm run derle:linux:uretim` (glibc ≤ 2.28).
# ⚠ .jsc V8'e KİLİTLİ: derleme ve çalışma AYNI node ikilisiyle (node-surumu.json, SHA256
#   doğrulamalı) — `runtime-node` aşaması onu bir kez indirir, iki aşama da onu kullanır.
# Derleme (Mac'te dahil):  docker buildx build --platform linux/amd64 \
#   -f Teks-Erp/docker/korumali/Dockerfile --build-arg TEKSERP_COMMIT=$(git rev-parse HEAD) \
#   -t tekserp-korumali:<sürüm>-imzasiz --load .
# İmzala (Mac, PAKET anahtarı): imaj içi bütünlük listesi ince son katman olarak eklenir —
#   TEKSERP_PAKET_ANAHTARI=<anahtar> node Teks-Erp/docker/korumali/imaj-imzala.mjs <…-imzasiz> tekserp-korumali:<sürüm>
# Kaynak haritası (REPO DIŞI arşiv):  aynı komut + --target kaynak-haritasi \
#   --output type=local,dest=$HOME/.tekserp/kaynak-haritalari/<ad>
# Runbook: docs/ops/LINUX-DOCKER-KURULUM.md
# =============================================================================

# ---------------------------------------------------------------------------
# 1) RUNTIME NODE — tek kaynak deploy/node-surumu.json, SHA256 doğrulamalı indirme
# ---------------------------------------------------------------------------
FROM --platform=linux/amd64 node:24-bookworm-slim AS runtime-node
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /w
COPY deploy/node-surumu.json deploy/node-surumu.json
COPY scripts/lib/node-surumu.mjs scripts/lib/node-surumu.mjs
COPY scripts/koruma-runtime-indir.mjs scripts/koruma-runtime-indir.mjs
RUN node scripts/koruma-runtime-indir.mjs linux-x64 /w/sahne \
  && /w/sahne/runtime/bin/node -e "console.log('runtime node', process.version, 'V8', process.versions.v8)"

# ---------------------------------------------------------------------------
# 2) DERLE — esbuild + bytenode (.jsc) + karartılmış araçlar + prod node_modules
# ---------------------------------------------------------------------------
FROM --platform=linux/amd64 node:24-bookworm-slim AS derle
ARG TEKSERP_COMMIT=""
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=runtime-node /w/sahne/runtime/bin/node /opt/tekserp/bin/node
WORKDIR /repo/Teks-Erp
COPY Teks-Erp/package.json Teks-Erp/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY deploy/node-surumu.json /repo/deploy/node-surumu.json
COPY scripts/lib/node-surumu.mjs /repo/scripts/lib/node-surumu.mjs
COPY Teks-Erp/tsconfig.json ./
COPY Teks-Erp/src ./src
COPY Teks-Erp/scripts ./scripts
COPY Teks-Erp/prisma ./prisma
COPY Teks-Erp/deploy/prisma.config.prod.js ./deploy/prisma.config.prod.js
COPY Teks-Erp/public ./public
COPY Teks-Erp/assets ./assets
COPY Teks-Erp/native/lisans-cekirdek/dist-uretim/lisans-cekirdek.linux-x64-gnu.node \
     ./native/lisans-cekirdek/dist-uretim/lisans-cekirdek.linux-x64-gnu.node
COPY Teks-Erp/docker/korumali/sahne.mjs ./docker/korumali/sahne.mjs
RUN KORUMA_COMMIT="$TEKSERP_COMMIT" KORUMA_ARSIV_DIZINI=/arsiv \
    /opt/tekserp/bin/node docker/korumali/sahne.mjs /sahne/app
# Prod bağımlılıkları + Prisma istemcisi YORUMSUZ şemadan; şema motoru Linux ikilisi (ELF kapısı).
# `node_modules/.bin` sembolik bağdır: imzalı kapsamda bağ imzalanmaz (Windows paketi de taşımaz); prisma doğrudan çağrılır.
WORKDIR /sahne/app
RUN npm ci --omit=dev --no-audit --no-fund \
  && PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x npx prisma generate \
  && ls node_modules/@prisma/engines/ | grep -q '^schema-engine-debian-openssl-3.0.x$' \
  && head -c 4 node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x | grep -q 'ELF' \
  && find node_modules/@prisma/engines -maxdepth 1 -name 'schema-engine-*' ! -name 'schema-engine-debian-openssl-3.0.x' -delete \
  && find node_modules -name '*.map' -type f -delete \
  && rm -rf node_modules/.bin \
  && rm -f package-lock.json && npm cache clean --force

# ---------------------------------------------------------------------------
# 2b) KAYNAK HARİTASI — yalnız --target ile, --output local (REPO DIŞI arşiv; imaja girmez)
# ---------------------------------------------------------------------------
FROM scratch AS kaynak-haritasi
COPY --from=derle /arsiv /

# ---------------------------------------------------------------------------
# 3) ÇALIŞMA İMAJI
# ---------------------------------------------------------------------------
FROM --platform=linux/amd64 debian:bookworm-slim AS korumali
ARG TEKSERP_COMMIT=""
# pg_dump/pg_restore/psql 16 PGDG'den (bookworm'unki 15: "server version mismatch" → gece
# yedeği sessizce düşer). tini: PID 1 sinyal/zombi. /etc/machine-id imaja GİRMEZ (parmak izi
# F1 konaktan salt-okunur bağlanır; imajda dolu olursa her kopya aynı kimliği taşır).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg tini tzdata \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/machine-id /var/lib/dbus/machine-id \
  && groupadd --system --gid 10001 tekserp \
  && useradd --system --uid 10001 --gid tekserp --home-dir /nonexistent --shell /usr/sbin/nologin tekserp \
  && install -d -o tekserp -g tekserp -m 0700 /var/lib/tekserp/lisans /var/lib/tekserp/yedek /var/lib/tekserp/yedek-anahtar
# Uygulama ağacı root'a ait ve süreç kullanıcısına SALT-OKUNUR (yamalı .jsc yazılamasın). Runtime Node
# imzalı kapsamdaki `runtime/` altında durur (Windows paketiyle aynı kapsam); PATH'teki ad ona bağdır.
COPY --from=derle --chown=root:root /sahne/app /app
COPY --from=runtime-node --chown=root:root /w/sahne/runtime/bin/node /app/runtime/bin/node
RUN ln -s /app/runtime/bin/node /usr/local/bin/node
COPY --chmod=0755 Teks-Erp/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chmod=0755 Teks-Erp/docker/korumali/yedek-zamanlayici.sh /usr/local/bin/yedek-zamanlayici.sh
WORKDIR /app
ENV NODE_ENV=production TZ=Europe/Istanbul HOME=/tmp \
    PRISMA_BIN="node /app/node_modules/prisma/build/index.js" \
    CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
    LICENSE_DIR=/var/lib/tekserp/lisans BACKUP_DIR=/var/lib/tekserp/yedek \
    BACKUP_KEY_DIR=/var/lib/tekserp/yedek-anahtar BACKUP_SCHEDULE_ENABLED=false
LABEL org.opencontainers.image.title="tekserp-korumali" \
      org.opencontainers.image.revision="$TEKSERP_COMMIT" \
      tr.tekserp.imaj="korumali"
USER 10001:10001
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
