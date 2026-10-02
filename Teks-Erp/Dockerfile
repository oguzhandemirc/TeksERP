# syntax=docker/dockerfile:1.7

# ----- 1) deps: bağımlılıkları kur + prisma client üret -----
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci && npx prisma generate

# ----- 2) build: TypeScript -> dist/ -----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Seed çalışma imajına KAYNAKSIZ gider: `prisma/seed.ts` `../src`yi içe aktarır ve
# runtime'da src yoktur; tek dosyaya derlenir, paketler node_modules'ten çözülür.
# tsc ~3 GB bellek ister; varsayılan yığın sınırında "heap out of memory" ile düşer.
RUN NODE_OPTIONS=--max-old-space-size=4096 npx tsc && npx esbuild prisma/seed.ts --bundle --platform=node --target=node22 \
      --format=cjs --packages=external --outfile=dist/tools/seed.cjs

# ----- 3) runtime: çalışan image -----
# Süreç KÖK DEĞİL (G22): uygulama ağacı root'a ait ve `node`a salt okunur; yazılabilir yalnız veri, lisans deposu
# (`<app>/../lisans`) ve LAN OTA deposu (`<app>/../mobil-guncelleme`) — compose bunları birime bağlar, kök FS salt okunur.
# `scripts/` (yıkıcı bakım betikleri dahil) çalışma imajına girmez; prisma CLI npx'siz çağrılır (yazılabilir önbellek yok).
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TZ=Europe/Istanbul \
    HOME=/tmp \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    PRISMA_BIN="node /app/node_modules/prisma/build/index.js"
RUN apk add --no-cache tini openssl libc6-compat tzdata postgresql16-client && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    install -d -o node -g node -m 0750 /app/data /lisans /mobil-guncelleme
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
USER node
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
