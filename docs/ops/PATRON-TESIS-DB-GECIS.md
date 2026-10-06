# Patron bulutu — tesis başına ayrı veritabanına geçiş (VDS uygulama adımları)

> **Durum:** HAZIR, UYGULANMADI. Kod `gece/patron-tesis-db` dalında (dilim 1–7); VDS'e hiçbir adım kullanıcının "uygula" cümlesi olmadan uygulanmaz. Tasarım: `docs/design/PATRON-TESIS-DB.md`. Kurulum runbook'u (kalıp, yollar, imaj taşıma): `docs/ops/PATRON-BULUTU-KURULUM.md` §2–§8.

## 0. Ne değişir, ne değişmez

- Mevcut `patron` DB'si **merkez** olur: yalnız yönlendirme (`facility_databases` · `installation_routes` · `login_routes`) ve tutanak (`facility_destructions` · imhada kopyalanan `support_access`). Kiracı tabloları merkezde boş ve çalışma rollerine yetkisiz kalır.
- Her yeni tesis kendi DB'sinde (`patron_t<16 onaltılık>`) ve kendi iki rolüyle (`<db>_uyg` · `<db>_esit`; destek `<db>_destek` NOLOGIN) doğar. Rol parolaları yeni sırdan (`tesis_rol_anahtari`) türetilir, hiçbir yerde saklanmaz.
- Yeni uzun ömürlü servis `patron-hazirla` (96m / 0,25 CPU / 50 süreç, yalnız `ic`); bellek bütçesi 1024 → 1120 MiB (KARAR-1).
- `patron-goc` zinciri: merkez `migrate deploy` → `db-rolleri` (merkez kipi) → `tesis-db goc` (HAZIR her tesis DB'sine eksik göçler, tek tek).
- Yedek: merkez + HAZIR her tesis ayrı döküm (`tesis_<tesisId>_<damga>.dump.tkenc`); imha edilmiş tesisin dökümü en-az-N kuralından muaf.
- **Değişmeyen:** fabrika tel şeması (eski fabrika istemcisi aynen çalışır; yeni tesisin ilk isteği bir kez 503 `TEKRAR_DENEYIN` alabilir, istemci 5xx'te zaten yeniden dener) · `minVersion` · max_connections 40 (tesis 5'i geçince yükseltilir).
- **Kırılan:** oturum/davet belirteci biçimi (43 → 66 karakter, tesis ön ekli); eski belirteç 401 — buluta bağlı hesap 0 olduğundan kimse düşmez (önce ölçüm §1 ③ bunu doğrular).

## 1. Önce ölçüm (VDS, salt okuma) — biri tutmazsa DUR

```
cd /opt/stack/apps/tekserp-patron-uretim
sudo docker compose ps                                        # patron · patron-db · patron-yedek sağlıklı
sudo docker compose exec -T patron-db psql -U patron_goc -d patron -Atc \
  "SELECT 'facilities', count(*) FROM facilities UNION ALL SELECT 'installations', count(*) FROM installations
   UNION ALL SELECT 'accounts', count(*) FROM accounts UNION ALL SELECT 'projection_rows', count(*) FROM projection_rows
   UNION ALL SELECT 'sessions', count(*) FROM sessions"
sudo docker compose exec -T patron-db psql -U patron_goc -d patron -Atc \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL"
sudo docker compose exec -T patron-db psql -U patron_goc -d patron -Atc "SHOW max_connections"
free -m; sudo docker stats --no-stream
```

Beklenen: ① beş sayı da **0** (tesis 0; dalda merkez → tesis veri taşıma yolu YOK — sıfır değilse geçiş DURUR, taşıma ayrı iş olur) · ② yarım göç satırı yok · ③ `sessions` 0 · ④ `max_connections` 40 · ⑤ boş bellek yeni 96 MiB tavanı karşılar. Sayıları kayda (§6) yaz.

## 2. Mac'te hazırlık

1. Dal `main`e indi ve terfi kuralına göre sürüm notu hazır (sunucu imajı; panel/tablet etkilenmez).
2. Anahtar (repo DIŞINDA, `docs/ops/PATRON-BULUTU-KURULUM.md` §2.1 kalıbı): `node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url")+"\n")' > tesis-rol-anahtari` — 32 bayt base64url. Kaybı veri kaybı DEĞİLDİR (`tesis-db goc` parolaları yeni anahtarla yeniden yazar, giriş dizini aynı komutla yeniden kurulur) ama anahtarı değiştirmek bütün tesis rollerini döndürür; bir kopya Mac + USB'de.
3. İmaj: temiz ağaçtan `deploy/patron/imaj-derle.sh --platform linux/amd64` (Dockerfile `dist-cli/scripts/tesis-db.js`i derler ve `test -f` ile doğrular).
4. Yerel duman: `deploy/patron/duman.sh kur <sha>` — göç zinciri `tesis-db goc` ile biter, `patron-hazirla` ayağa kalkar, yedek turu merkez + tesis dökümünü üretir ve ikisi de özel yarıyla açılır, `docker stats` dört uzun ömürlü servisi gösterir. `duman.sh kaldir <sha>`.
5. `.env`: `ornek.env`teki yeni satır `TESIS_ROL_ANAHTARI_DOSYASI_HOST=/opt/stack/apps/tekserp-patron-uretim/sirlar/tesis-rol-anahtari`; yeni `docker-compose.yml`.
6. `node deploy/patron/compose-denetle.mjs --env-file <patron .env> --satici-env <satıcının .env'i>` → 0 ihlal, 0 ölçülemedi (5 servis · bütçe ≤ 1120 MiB · göç parolası DB/göç/hazırlayıcı/yedek · tesis rol anahtarı yalnız sunucu/göç/hazırlayıcı · hazırlayıcı yalnız `ic`).

## 3. Uygulama (VDS YAZIMI — kullanıcının "uygula" cümlesiyle)

1. **Önce yedek:** `sudo docker compose exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `patron_<damga>.dump.tkenc` + `anahtarlar_<damga>.tar.tkenc`; Mac'e çek, iki uçta sha eşit, özel yarıyla aç, `pg_restore --list` (KURULUM §7). Geri dönüşün DB yarısı budur.
2. **Sır:** `tesis-rol-anahtari` dosyasını `sirlar/` altına koy, `root:<SIR_GID> 0440` (öteki sırlarla aynı); `.env`i yedekle (`cp .env ~/ptd-env-yedek-<eski sha>`), yeni satırı ekle; yeni `docker-compose.yml`i koy (eskisini yedekle).
3. **İmaj:** scp → `sha256sum -c` → `docker load` (iki uçta imaj kimliği aynı). Eski imaj VDS'te KALIR.
4. **Eski sunucuyu durdur** (yeni `db-rolleri` merkezde kiracı tablolarının yetkisini geri alır; eski sunucu onlarla çalışamaz — tesis 0 olduğundan kesinti kimseyi etkilemez): `sudo docker compose stop patron`.
5. **Göç `.env`'e dokunmadan:** `sudo PATRON_IMAJ=tekserp-patron:<yeni sha> docker compose --profile goc run --rm --no-deps patron-goc` (kabuk değişkeni `.env`i ezer; göç başarısız olursa `.env` eski kalır) → `Applying migration 20261006120000_tesis_veritabanlari` · `All migrations have been successfully applied` · `✅ roller hizalandı` · `PATRON_TESIS_GOC` özeti (0 tesis). Hata → §5 geri alma.
6. **`.env`'de iki imaj etiketi** yeni sha'ya; `sudo docker compose up -d` → `patron`, `patron-hazirla`, `patron-yedek` (yeni imaj) ayakta.
7. **İlk yedek** (yeni betik): `sudo docker compose exec -T patron-yedek /arac/yedek-dongusu.sh tek` → `tamam: … + 0 tesis dökümü`.

## 4. Sonra ölçüm

```
sudo docker compose ps                                                       # dört servis sağlıklı (hazirla: healthcheck yok, "running")
sudo docker compose logs --tail=5 patron-hazirla                              # "PATRON_HAZIRLA izliyor aralik=10s"
sudo docker compose --profile goc run --rm --no-deps patron-goc node dist-cli/scripts/tesis-db.js durum   # 0 tesis, sır basmaz
sudo docker compose exec -T patron-db psql -U patron_goc -d patron -Atc "SELECT current_setting('app.veritabani_tesisi', true)"   # merkez
sudo docker compose exec -T patron-db psql -U patron_goc -d patron -Atc \
  "SELECT has_table_privilege('patron_uygulama','accounts','SELECT'), has_table_privilege('patron_uygulama','login_routes','SELECT')"   # f · t
curl -s -o /dev/null -w '%{http_code}\n' https://<PATRON_HOST>/saglik             # 200
sudo docker stats --no-stream                                                  # hazırlayıcı < 96 MiB
```

**Uçtan uca (ayrı onayla; tesis ilk müşteriyle doğar):** satıcı kipinde ilk imzalı istek `facility_databases`a ISTENDI yazar ve bir kez 503 alır → hazırlayıcı ≤ 10 sn'de HAZIR yapar → sonraki istek 200; `tesis-db.js durum` tesisi HAZIR gösterir; sonraki yedek turu `tesis_<id>_*` dökümünü üretir. Ya da satıcı CLI'siyle `tesis.js tesis-ac` (eşzamanlı hazırlar).

## 5. Geri alma

- **Göç adımında hata (§3.5):** sunucu zaten durdu; `.env` eski hâlinde. `sudo docker compose up -d patron` eski imajla — yeni göç yalnız EKLER (üç merkez tablosu + kısıtlar), eski sürüm onlarla çalışır; ama yeni `db-rolleri` koştuysa merkez yetkileri geri alınmıştır ⇒ önce eski imajla `sudo docker compose --profile goc run --rm --no-deps patron-goc` (eski `db-rolleri` kiracı tablolarının yetkisini merkezde yeniden verir), sonra `up -d patron`.
- **Sonradan geri dönüş:** `.env`'i `~/ptd-env-yedek-<eski sha>`ten geri yaz, eski `docker-compose.yml`i geri koy, eski imajla `patron-goc` (yetkiler) + `up -d`; `patron-hazirla` eski compose'da yoktur (`docker compose up -d --remove-orphans`). Geçişten sonra doğmuş tesis DB'leri merkezin dışında kalır — eski sürüm onları GÖRMEZ: geri dönüşten önce `tesis-db.js durum` ile say; sıfır değilse geri dönüş veri kaybı demektir (kullanıcı kararı), dökümleri `tesis_<id>_*` yedeklerinde durur.
- Göç geri alınamaz; veri gerekiyorsa §3.1 yedeğinden geri yükleme (KURULUM §7).

## 6. Kayıt

(Uygulamada doldurulur: önce ölçüm sayıları · imaj kimlikleri · göç çıktısı · sonra ölçüm · süreler.)
