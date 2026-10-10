# T1 Linux dumanının (duman-linux.sh) TEST backend imajı — korumalı imajın güncelleyiciye görünen yüzü:
# `node` (sağlık sondası `compose exec backend node -e`), `goc` aracı, PG istemcisi (psql/pg_dump/pg_restore, araç
# konteyneri `yedek` servisi), yedek aracı (`/app/dist/tools/yedek-sifrele.cjs`), yedek zamanlayıcısı ve birim bağ noktaları. Sürüm ve göç
# sayısı derlemede gömülür (her sürüm ayrı config ⇒ ayrı imaj kimliği). Üretim imajı DEĞİLDİR, teslim edilmez.
ARG PG_IMAJ=postgres:16-bookworm
ARG NODE_IMAJ=node:22-bookworm-slim
FROM ${NODE_IMAJ} AS node
FROM ${PG_IMAJ}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# Birimlerin bağ noktaları korumalı imajdaki gibi 10001 0700: adlı birim ilk bağlanışta bu sahiplikle doğar (alıcı
# biriminin izni yedek adımının gerçek koşuludur — yetkisiz kök araç oraya giremez).
RUN install -d -o 10001 -g 10001 -m 0700 /var/lib/tekserp/lisans /var/lib/tekserp/yedek /var/lib/tekserp/yedek-anahtar
COPY sunucu.js /app/sunucu.js
COPY yedek-sifrele.cjs /app/dist/tools/yedek-sifrele.cjs
COPY goc yedek-zamanlayici.sh /usr/local/bin/
ARG SURUM
ARG GOC_SAYISI
ARG GOC_DUSER=0
# Göçler korumalı imajdaki yerinde (`/app/prisma/migrations/<ad>/migration.sql`, adlar `goc` aracınınkiyle aynı):
# güncelleyicinin şema ön denetimi onları imajdan okur — paket dizininde göç yoktur.
RUN i=1; while [ "$i" -le "$GOC_SAYISI" ]; do d=/app/prisma/migrations/$(printf 'duman_%03d' "$i"); \
      mkdir -p "$d" && echo "-- duman" >"$d/migration.sql"; i=$((i + 1)); done
ENV TEKSERP_DUMAN_SURUM=${SURUM} TEKSERP_DUMAN_GOC=${GOC_SAYISI} TEKSERP_DUMAN_GOC_DUSER=${GOC_DUSER}
USER 10001:10001
ENTRYPOINT []
CMD ["node", "/app/sunucu.js"]
