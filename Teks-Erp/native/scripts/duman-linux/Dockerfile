# T1 Linux dumanının (duman-linux.sh) TEST backend imajı — korumalı imajın güncelleyiciye görünen yüzü:
# `node` (sağlık sondası `compose exec backend node -e`), `goc` aracı, PG istemcisi (psql/pg_dump/pg_restore, araç
# konteyneri `yedek` servisi), yedek aracı (`/app/dist/tools/yedek-sifrele.cjs`) ve yedek zamanlayıcısı. Sürüm ve göç
# sayısı derlemede gömülür (her sürüm ayrı config ⇒ ayrı imaj kimliği). Üretim imajı DEĞİLDİR, teslim edilmez.
ARG PG_IMAJ=postgres:16-bookworm
ARG NODE_IMAJ=node:22-bookworm-slim
FROM ${NODE_IMAJ} AS node
FROM ${PG_IMAJ}
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY sunucu.js /app/sunucu.js
COPY yedek-sifrele.cjs /app/dist/tools/yedek-sifrele.cjs
COPY goc yedek-zamanlayici.sh /usr/local/bin/
ARG SURUM
ARG GOC_SAYISI
ARG GOC_DUSER=0
ENV TEKSERP_DUMAN_SURUM=${SURUM} TEKSERP_DUMAN_GOC=${GOC_SAYISI} TEKSERP_DUMAN_GOC_DUSER=${GOC_DUSER}
USER 10001:10001
ENTRYPOINT []
CMD ["node", "/app/sunucu.js"]
