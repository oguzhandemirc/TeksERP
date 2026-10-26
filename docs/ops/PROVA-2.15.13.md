# Backend 2.15.13 — canlı döküm şema provası

**Tarih:** 2026-10-26 · **Taban:** `origin/main` @ `0a3b031ee` (425 migration) · **Ortam:** yerel Docker PG 16
(`tekserp-local-db`), geçici DB `tekserp_prova_test` (prova sonunda `node scripts/test-db.mjs sil` ile silindi).
İkinci tur (bekçi + dry-run, §3/§4a) aynı dökümün yeni kopyası `tekserp_prova2_test`te; o da sonunda silindi.
Fabrika sunucusuna bağlanılmadı; ana ağacın `.env`ine dokunulmadı; düzeltme betiği yalnız teşhis kipinde koşuldu (§4a).
Kural: `docs/kurallar/deploy-kurulum.md` (şema provası en eski canlı dump'ta) · reçete `docs/RECETELER.md` § Migration md. 10.

## 1. Taban seçimi (ölçüldü, devralınmadı)

Eldeki dökümlerin `_prisma_migrations` satırları `pg_restore -a -t _prisma_migrations` ile sayıldı (geri yükleme yok):

| Döküm | Uygulanmış migration | Son migration |
|---|---|---|
| `tekserp_20260822_013613.dump` | 165 | `20260817121448_traveler_card_doc_versions` |
| `tekserp_20260902_201133.dump` | 191 | `20260825140000_reason_preset_rework_kind` |
| `Teks-Erp/dump/tekserp_yeni_20260905_030000.dump` | 232 | `20260904120442_cuval_izleri_etiket` |
| `~/Downloads/tekserp_yeni_20260911_030001.dump` | 238 | `20260905172000_kapsanan_fazla_indexler` |
| `dump/tekserp_yeni_20260923_030001.dump` | 238 | aynı |
| `~/Downloads/tekserp_yeni_20260926_030001.dump` | 347 | `20260924001000_roll_series_max_value` |
| **`~/Downloads/tekserp_yeni_20261015_030002.dump`** | **363** | `20260928133711_musteri_kumas_renk_adi` |
| `~/.tekserp/arsiv/fzt-demo-20261015/tekserp_demo.dump` (demo, canlı değil) | 227 | — |

Seçilen: **`tekserp_yeni_20261015_030002.dump`** — tek canlı fabrika kurulumunun eldeki EN YENİ dökümü (daha eskileri
aynı kurulumun geçmiş anlıklarıdır, canlı durumu temsil etmez). 363 → 425: **62 migration** uygulanır; 2.15.12
(395) sahasındaki kurulumun göreceği 30 migration bunun alt kümesidir. Veri ölçeği: 15.415 top, 35 cihaz, 135 MB.

## 2. Adımlar ve sonuçlar

| Adım | Sonuç | Süre |
|---|---|---|
| `test-db.mjs ac tekserp_prova_test` | açıldı (boş) | — |
| `pg_restore --no-owner --no-privileges --exit-on-error` | çıkış 0; 363 migration, 15.415 top | 9 sn |
| Veritabanı düzeyi ayarlar (sahadaki gibi): `statement_timeout=50s`, `idle_in_transaction_session_timeout=5min`, `teks.audit_guard=on` | kuruldu | — |
| `npx prisma migrate deploy` | **62 uygulandı, 0 düştü**; `_prisma_migrations` 425 bitmiş / 0 yarım | **2 sn** (duvar saati) |
| Yumuşak kapılı tekillik (`20261024025530_cihaz_baglama` → `devices_hw_digest_live_uq`) | KURULDU (mükerrer yok, ATLANMADI) | — |
| Geçersiz indeks (`pg_index.indisvalid=false`) | 0 | — |
| Naif `timestamp without time zone` kolon (iş tabloları) | 0 | — |
| Şema farkı `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` (salt okur) | yalnız 2 satır: `rolls_sackId_shipmentId_consistency_fkey`, `swatches_sackId_shipmentId_consistency_fkey` — ikisi de `test_schema_drift` beyanlı istisnası ve `test_db_invariants` DEFERRABLE_FKS envanterinde → **fark yok** | — |
| `test-db.mjs sil tekserp_prova_test` | silindi | — |

## 3. Bekçi ayağı — KOŞULDU (2026-10-26, kullanıcı izni BEKCI_HEDEF_ONAY=1)

İlk turda (sabah) üç bekçi hacim kapısında durmuştu (`lib/hedef-db-kapisi`: 14.682 top > eşik 500; `BEKCI_HEDEF_ONAY=1`
kullanıcı kararıdır, `docs/RECETELER.md` § Migration md. 10). Kullanıcı 2026-10-26 12:40'ta izni yalnız döküm KOPYASI için
verdi; ikinci tur aynı dökümün yeni kopyasında (`tekserp_prova2_test`, aynı DB düzeyi ayarlar, `migrate deploy` yine
62 uygulandı / 0 düştü / 425 bitmiş, 1,9 sn) `run-all-tests.ts <bekçi>` ile koşuldu. Kapı iki uyarıyla geçti
("FIXTURE OLMAYAN HEDEFE KOŞULUYOR", "FABRİKA ÖLÇEĞİNDE HEDEFE KOŞULUYOR — 14682 top"); istemci hizası ve şema hizası
(425 migration) yeşil. Koşum öncesi/sonrası `rolls` özeti (15.415 satır · Σ currentQty 988.866,79) değişmedi.

| Bekçi | Sonuç | Ayrıntı |
|---|---|---|
| `test_schema_drift` | **yeşil** (4/4) | DB ağaçla hizalı; DEFERRABLE FK istisnaları beyanlı |
| `test_db_invariants` | **kırmızı — BEKLENEN** (486 geçti, 2 başarısız) | iki kırmızı yüklem aynı kök: `rolls_qty_le_initial` NOT VALID (`convalidated=f`) — "mevcut ama NOT VALID — eski satırlar doğrulanmamış" ve "validate edilmemiş kısıt YOK". Göç hatası değil, döküm öncesi veri (§4). Diğer 486 yüklem (partial index, CHECK, DEFERRABLE FK, trigger, extended statistics) yeşil |
| `test_timestamptz_contract` | **yeşil** (13/13) | naif zaman damgası yok |

Başka kırmızı yok. **Profil boot ayağı ATLANDI** — ölçüm backend'i prova DB'ye karşı ayağa kaldırmayı gerektirir
(`/api/admin/health`, reçete md. 10 ölçümü); ikinci Node süreci yasağı gereği (`CLAUDE.md` § Dağıtım) prova ortamında
açılmadı. Göç + bekçi + salt okur ölçümlerle prova **4/4'ün üçü bekçiyle, biri şerhle**: boot ayağı yayın öncesi
thinkpad-1 provasında (`deploy-kurulum.md` § yedekten kur provası düzeni) koşulur.

## 4. Uyarılar

- `rolls_qty_le_initial` CHECK'i bu dökümde **NOT VALID** — bu sürümün göçünden değil: `20260912190000_rolls_qty_le_initial_validate`
  koşullu doğrulamadır, fabrika verisinde kısıtı ihlal eden satır olduğu için doğrulamayı atlamış (döküm öncesinden).
  Envanterdeki onarım yolu `npx tsx scripts/fix_tambur_undo_full_asim.ts` (dry-run varsayılan). Bekçi ayağı koşulsaydı
  `test_db_invariants` bu satırda kırmızı verebilirdi; yayını engellemez, ayrı veri kararıdır.
- Süre ölçümü ([DB-29b]) için büyük tabloya DDL yazan göç yok; 62 göç 2 sn sürdü — kurulum penceresine anlamlı ek yok.
- Göç zamanlarının `_prisma_migrations.started_at` farkı anlamlı değil (döküm satırları ile karışık); süre duvar saatinden.

### 4a. Onarım betiği DRY-RUN sonucu (2026-10-26, döküm kopyası, `--apply` YOK)

`DATABASE_URL=<prova kopyası> npx tsx scripts/fix_tambur_undo_full_asim.ts` (teşhis kipi) koşuldu; çıkış 0. Koşum
öncesi/sonrası `rolls` (15.415 · Σ currentQty 988.866,79 · Σ initialQty 1.391.724,30), `roll_variances` (638) ve
`system_logs` (58.135) sayıları birebir aynı — betik teşhiste yazmıyor.

| Ölçüm | Değer |
|---|---|
| `currentQty > initialQty` satır | **2** (ikisi de `IN_PRODUCTION`, barkodsuz; kimlikler betik çıktısında, belgeye yazılmadı) |
| Hüküm | KESİN 2 · BELİRSİZ 0 (üç çapa + sapma satırı 0 → tam imza) |
| Aşımlar | 20,5 m (giriş 500 → kalan 520,5; geri alma 08.08.2026) · 206,9 m (giriş 492 → kalan 698,9; geri alma 14.08.2026) |
| Onarılacak toplam aşım | **227,4 m** |
| Sapma defteri ilk satırı | 15.08.2026 16:18:51 (korumanın sahaya indiği sınır; iki olay bundan ÖNCE) |
| Latent aşım (ihlal DEĞİL) | 303 ebeveyn · 26.960,16 m (betik başlığındaki "114 / ~7.623 m" notu eski dökümden; sayı büyüdü, sınıf değişmedi) |
| `rolls_qty_le_initial` | `convalidated=f` |

`--apply` ne yapar (betik başlığı): her KESİN top için tek tx'te `initialQty := currentQty` + `RollVariance(OVERAGE,
source=TAMBUR_UNDO_FULL, qty=aşım, workOrderStepId=currentStepId, createdById=NULL)`; `--apply --onay=2 --hedef=<db>`
ister. Kısıtı VALIDATE etmez — `ALTER TABLE rolls VALIDATE CONSTRAINT rolls_qty_le_initial` ayrı karar ve ayrı adımdır;
sonra `test_db_invariants`teki `notValid` şerhi güncellenir. **`--apply` kullanıcı kararıdır**; fabrikada koşulacaksa
önce o günün dökümünde aynı teşhis tekrarlanır (sayı 2'den sapıyorsa durulur).
