# PostgreSQL büyük sürüm geçişi — runbook (kendi örnek)

> **Otomatik DEĞİLDİR.** Güncelleyici yalnız aynı ana sürüm içinde küçük sürüm uygular ve veri dizininin `PG_VERSION`'ı farklı bir paketi REDDEDER (`docs/design/KENDI-POSTGRESQL.md` §5). Ana sürüm geçişi katalog biçimini değiştirir: insan kararıyla, kullanıcı penceresinde (vardiya dışı), bayi ya da Etkili Yazılım koşar. Önce thinkpad-1'de uçtan uca, sonra fabrikada.
>
> Kapsam: kendi örneği (`TeksERP-PostgreSQL`, `<kök>\pgsql\<surum>-<derleme>`, `<kök>\pgveri`). Harici PG'li kurulum önce kendi örneğe taşınır (tasarım §7) — o taşıma zaten döküm/geri yüklemedir ve hedefi yeni ana sürüm olabilir.

## 0. Ne zaman

- 16 çizgisinin destek sonu **2028-11-09** (`https://www.postgresql.org/versions.json`, 2026-09-30). Geçiş en geç destek sonundan altı ay önce planlanır; hedef çizgi o günün en güncel desteklenen ana sürümüdür.
- **Önce yazılım:** yeni ana sürüm CI'da tam pakette yeşil olmadan saha geçişi yok — backend işinin `postgres:<yeni>` servisiyle `npm test` · `test_fold_contract` (katlama `normalize()`'a dayanır; Unicode sürümü ana sürümle değişebilir) · `test_db_invariants` · `test_schema_drift`. Kayıtta yeni çizgi AYRI bir karardır: `deploy/pg/pg-surumu.json` `cizgi` değişir, bekçi yeşil, `pg-ikili.yml` ikinci ağdan doğrular.

## 1. Ortak ön koşullar

1. Güncel, doğrulanmış yedek (gece yedeği + pencere başında elle yedek; `pg_restore --list` geçmiş). Yedek dosyası sunucu DIŞINA da kopyalanmış.
2. Disk: veri dizini boyutunun en az 3 katı boş (yeni küme + döküm + güvenlik payı). Boyut: `SELECT pg_size_pretty(pg_database_size('<db>'))`.
3. Yeni sürümün ikilisi `<kök>\pgsql\<yeni-surum>-<derleme>\` altına paketten açılmış ve manifestoya karşı doğrulanmış (tasarım §3, §4.3).
4. Uzantı ve collation ön kontrolü (yeni ikilide): `share/extension/pg_trgm.control` var; ICU var.
5. Backend ve güncelleyici politikası pencere boyunca **DONDUR**.

## 2. Yöntem A — döküm / geri yükleme (VARSAYILAN)

Bizim ölçeğimizde (bugün ~85 MB DB tahmini) en sade ve en iyi sınanmış yol: gece yedeği ve kopyaya geri yükleme her gün aynı araçlarla koşuyor. ICU/collation farkını kendiliğinden çözer (index'ler yeni kümede sıfırdan kurulur).

1. **Yeni küme, geçici portta:** tasarım §4 adımları yeni ikiliyle — ayrı veri dizini (`<kök>\pgveri-<yeni-cizgi>`), `initdb` aynı argümanlarla (`pg-ornegi.json` `initdb.argumanlar`: UTF8 · C · scram · checksum), şablonlar, geçici hizmet `TeksERP-PostgreSQL-<yeni-cizgi>`, portSec ile boş port. Rolleri `.env`'deki MEVCUT parolalarla kur (SCRAM doğrulayıcı yeniden hesaplanır — `.env` değişmez); boş DB §4.12 ile.
2. **Backend'i durdur** — bundan sonra yazma yok. Saati not et.
3. **Son döküm, YENİ `pg_dump` ile:** `<kök>\pgsql\<yeni>\bin\pg_dump.exe -h 127.0.0.1 -p <eski-port> -U tekserp -Fc -f <yedek>\buyuk-gecis-<damga>.dump <db>`; `pg_restore --list` ile doğrula.
4. **Geri yükle:** `pg_restore -h 127.0.0.1 -p <yeni-port> -U tekserp -d <db> --no-owner --no-privileges <döküm>`; DB düzeyi üç ayarı yeniden kur (döküm taşımaz); bakım rolünün yetkileri (`bakim-rolu.ps1` §4 anlamı).
5. **Doğrula:** her tablonun satır sayısı iki kümede eşit (her iki tarafta aynı sorgu: `SELECT relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, relname), false, true, '')))[1]::text::bigint FROM pg_stat_user_tables ORDER BY 1`) · `_prisma_migrations` sayısı eşit · `tr_sort` ICU ve `pg_trgm` var · `ANALYZE`.
6. **Değiştir:** eski hizmeti durdur, başlangıcını Manuel yap (SİLME). Yeni kümenin `tekserp.conf` portunu ESKİ porta çevir (`pg-sablon.mjs` ile yeniden üret) → yeni hizmeti yeniden başlat → `.env` DEĞİŞMEZ. Hizmet adını sabitlemek için: yeni hizmeti durdur, `pg_ctl unregister -N TeksERP-PostgreSQL-<yeni-cizgi>`, eski `TeksERP-PostgreSQL`'i `pg_ctl unregister` et ve yeni ikiliyle `TeksERP-PostgreSQL` adıyla yeniden kaydet (tasarım §4.9–§4.10; veri dizini ACL'i yeni sanal hesap SID'iyle). `<kök>\pgsql\bin` junction'ı yeni `bin`'e.
7. **Backend'i başlat** → `/health` → panelde okuma + bir yazma denemesi → gece yedeği görevinin yeni `pg_dump`'la geçtiğini ölç (bir elle yedek).
8. `ornek.json`: yeni sürüm/derleme/dizinler; eski küme dizini ve eski ikili **geri dönüş için N gün KALIR** (öneri: bir sonraki başarılı gece yedeğinden en az 7 gün sonra silinir — kullanıcı kararı).

**Süre (tahmin, ölçülmedi — thinkpad-1 provasında ölçülüp buraya yazılacak):** 85 MB DB için döküm < 1 dk, geri yükleme + index kurulumu 1–3 dk, doğrulama 1–2 dk; kurulum/değiştirme adımlarıyla toplam pencere ~30 dk. Kaba ölçek: süre DB boyutuyla doğrusal.

**Geri dönüş (A):** yeni hizmeti durdur → eski `TeksERP-PostgreSQL`'i (adı değiştiyse eski ikiliyle yeniden kaydet) Otomatik + başlat → junction eski `bin`'e → backend'i başlat. Eski küme HİÇ değişmedi. ⚠️ Değiştirmeden sonra yazılan veri eski kümede YOKTUR: geri dönüş yalnız aynı pencerede ya da yeni kümeden alınan ters dökümle (yeni `pg_dump` → eski sunucuya geri yükleme her zaman mümkün değildir; ters yön ancak eski sürüm yeni dökümü okuyabiliyorsa).

## 3. Yöntem B — `pg_upgrade` (büyük DB ya da çok kısa pencere)

1. Yeni küme §2.1'deki gibi `initdb` (aynı collation; **sağlama iki kümede aynı** — kendi örnek `--data-checksums` ile doğar, harici küme sağlamasızsa yeni küme `--no-data-checksums` ister).
2. Backend ve iki PostgreSQL hizmeti durur. Yönetici konsolunda (initdb gibi kısıtlı token; iki veri dizinine de yazma izni):
   `<yeni>\bin\pg_upgrade.exe -b <eski>\bin -B <yeni>\bin -d <kök>\pgveri -D <kök>\pgveri-<yeni> -U postgres --check` → temizse aynı komut `--check`'siz, **`--copy`** ile (varsayılan; eski küme dokunulmadan kalır). `--link` (sabit bağ, saniyeler) yalnız süre zorunluysa: yeni küme bir kez başladıktan sonra eski küme KULLANILAMAZ (geri dönüş yalnız yedekten).
3. Yeni veri dizinine sanal hesap ACL'i (tasarım §4.10), hizmeti yeni ikili + yeni veri dizinine kaydet, `tekserp.conf`/`pg_hba.conf` şablondan (pg_upgrade yapılandırma dosyalarını TAŞIMAZ), başlat.
4. Sonra: `vacuumdb --all --analyze-in-stages` · `ALTER EXTENSION pg_trgm UPDATE` · ICU sürümü değiştiyse tasarım §5 U9 (bağlı index'leri yeniden kur + `REFRESH VERSION`) · §2.5 doğrulaması · backend + sağlık.
5. `pg_upgrade`'in bıraktığı `delete_old_cluster.bat` yalnız geri dönüş penceresi bittikten SONRA (kullanıcı kararı).

**Süre (B):** `--copy` veri boyutuyla doğrusal (85 MB'ta dakikanın altı, tahmin); `--link` boyuttan bağımsız saniyeler. **Geri dönüş (B, `--copy`):** eski hizmet eski ikili + eski veri dizini → başlat; yeni kümede yazılan veri kaybolur (A ile aynı sınır).

## 4. Kontrol listesi (pencere günü)

- [ ] CI'da yeni ana sürümle tam paket yeşil; kayıtta yeni çizgi bekçi + `pg-ikili.yml` yeşil
- [ ] thinkpad-1'de bu runbook uçtan uca koşuldu, süreler §2'ye yazıldı
- [ ] Doğrulanmış yedek sunucu dışında · disk ≥ 3× · güncelleme politikası DONDUR
- [ ] Yöntem seçildi (A varsayılan) · geri dönüş adımları okundu
- [ ] Sonrası: `/health` · panel okuma/yazma · elle yedek yeni `pg_dump` ile · `ornek.json` güncel · eski küme silme tarihi kullanıcıya bildirildi
