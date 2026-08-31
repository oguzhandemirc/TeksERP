# =============================================================================
# TeksERP — DEMO YAYIN İMAJI (backend API + web paneli TEK origin)
# =============================================================================
# Bu imaj yalnız DEMO içindir. Fabrika kurulumu Windows sunucuda pm2'siz,
# doğrudan Node ile koşuyor ve bu dosyadan ETKİLENMEZ.
#
# ⚠️ TEK KONTEYNER, TEK ORIGIN: backend `WEB_DIST_DIR` ile panelin build'ini
# kendisi servis ediyor (app.ts'te opt-in blok). Böylece CORS / mixed-content /
# "sunucu adresi ayarı" üçlüsü tamamen düşer — panel ile API aynı adreste.
#
# ⚠️ ALPINE DEĞİL bookworm-slim: Prisma'nın musl motoru ek `openssl` sürüm
# eşleşmesi istiyor ve alpine'da "Unable to require libquery_engine" sınıfı
# sessiz hatalar üretiyor. Boyut farkı (~40 MB) bu riski almaya değmez.
#
# ⚠️ BUILD CONTEXT DEPO KÖKÜDÜR (Teks-Erp/ + Electron/ birlikte gerekiyor):
# panel de burada derleniyor ki imaj kendi kendine yeter olsun ve "yerelde
# derledim, sunucuya kopyaladım" sınıfı sürüm kayması olmasın.
# =============================================================================

# ---------------------------------------------------------------------------
# 1) PANEL — Electron kod tabanının WEB hedefi (vite.config.web.ts)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS panel
WORKDIR /panel
COPY Electron/package.json Electron/package-lock.json ./
# ⚠️ `--ignore-scripts`: Electron paketi ve native donanım modülleri
# (serialport, node-hid) kurulum betiği koşturuyor — web hedefinde HİÇBİRİ
# kullanılmıyor, derlemede yalnız zaman ve hata riski üretirler.
RUN npm ci --ignore-scripts
COPY Electron/ ./
RUN npm run build:web

# ---------------------------------------------------------------------------
# 2) BACKEND — TypeScript derlemesi + Prisma istemcisi
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS backend
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY Teks-Erp/package.json Teks-Erp/package-lock.json ./
RUN npm ci
COPY Teks-Erp/prisma ./prisma
RUN npx prisma generate
COPY Teks-Erp/tsconfig.json ./
COPY Teks-Erp/src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# 3) ÇALIŞMA İMAJI
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ⚠️ postgresql-client-16 PGDG DEPOSUNDAN — Debian bookworm'un kendi paketi
# v15'tir ve `pg_dump` sunucudan ESKİ olduğunda "server version mismatch" ile
# REDDEDER. Yedekleme servisi (`backup.service`) pg_dump'ı ayrı bir süreçte
# çağırıyor; sürüm tutmazsa gece yedeği her gece SESSİZCE başarısız olur
# (hata /health sayacına düşer ama kimse bakmaz). Sunucudaki PG 16.14.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl gnupg && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

COPY Teks-Erp/package.json Teks-Erp/package-lock.json ./
# ⚠️ `--omit=dev` AMA İKİ ARAÇ AYRICA GEREKLİ, ikisi de devDependencies'te:
#   • prisma CLI → `migrate deploy` konteyner içinde koşuyor
#   • tsx        → demo seed'i (prisma/seed-ticaret-demo.ts) TS olarak koşuyor
# Sürümleri package.json'dan OKUNUR, elle sabitlenmez: elle yazılan sürüm
# `@prisma/client` ile ayrışırsa Prisma "client/CLI version mismatch" der.
RUN npm ci --omit=dev \
  && PRISMA_V="$(node -p "require('./package.json').devDependencies.prisma || require('./package.json').dependencies.prisma")" \
  && TSX_V="$(node -p "require('./package.json').devDependencies.tsx || 'latest'")" \
  && npm i --no-save "prisma@${PRISMA_V}" "tsx@${TSX_V}" \
  && npm cache clean --force

COPY Teks-Erp/prisma ./prisma
# ⚠️ `prisma.config.ts` ZORUNLU: Prisma 7 datasource URL'ini schema'dan değil
# BU dosyadan okuyor. Kopyalanmazsa `migrate deploy` çalışma anında
# "datasource.url property is required" ile durur — ve bu, imaj derlenirken
# DEĞİL ilk deploy denemesinde ortaya çıkar (ölçüldü).
COPY Teks-Erp/prisma.config.ts ./
RUN npx prisma generate

COPY --from=backend /app/dist ./dist
# ⚠️ KAYNAK DA GEREKLİ — yalnız `dist` yetmiyor: seed script'leri TypeScript'tir
# ve `../src/services/...` üzerinden SERVİS KATMANINI çağırır (ham insert yerine
# gerçek defter/bakiye/belge zincirini üretsinler diye). Yalnız dist kopyalanınca
# `npx tsx prisma/seed.ts` MODULE_NOT_FOUND ile durur (ölçüldü). Maliyet ~5 MB;
# karşılığında konteynerin içinde seed/bakım script'i koşturulabiliyor.
COPY Teks-Erp/src ./src
COPY Teks-Erp/tsconfig.json ./
# Etiket fontları ve varlıklar — raster etiket üreticisi bunları dosyadan okur
# (`assets/fonts/`); kopyalanmazsa etiket baskısı çalışma anında patlar.
COPY Teks-Erp/assets ./assets
# Panel build'i — `WEB_DIST_DIR` bunu gösterir.
COPY --from=panel /panel/dist-web ./dist-web

# Yedek dizini: `BACKUP_DIR` TANIMSIZSA YEDEK HİÇ ALINMAZ (backup.service).
# Dizini imajda hazırlıyoruz; compose onu kalıcı bir birime bağlıyor.
RUN mkdir -p /app/backups

EXPOSE 4000
# ⚠️ Sağlık yoklaması `/health` ucuna: uygulama havuz metriklerini oradan
# yayınlıyor ve DB'ye gerçekten dokunuyor — TCP yoklaması "ayakta ama DB'siz"
# bir konteyneri sağlıklı gösterirdi.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
