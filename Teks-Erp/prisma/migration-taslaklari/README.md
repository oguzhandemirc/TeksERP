# Migration TASLAKLARI — denetim önerileri (2026-08-29)

⚠️ **Buradaki dosyalar migration DEĞİLDİR.** `prisma migrate deploy` yalnız
`prisma/migrations/` altını çalıştırır; bu klasör bilerek onun DIŞINDADIR.

Denetimin (bkz. `audit/RAPOR-2026-08-29.md` §12.1) veritabanı seviyesinde
önerdiği kısıtların hazır SQL'i. Her dosya kendi gerekçesini, kilit/etki
analizini ve geri alma yolunu taşır.

## Uygulama sırası (her biri için AYRI karar)

1. Dosyayı oku — özellikle "kilit/etki" notunu.
2. Dev kopyada dene: `createdb tekserp_kisit_deneme -T tekserp_saha_0825` sonra `psql ... -f <dosya>`.
3. Beklenen ihlal sayısını ölç (dosyadaki doğrulama sorgusu).
4. Kullanıcı onayı al — bazıları mevcut veriyi reddeder ve o veri **iş kararı** ister.
5. Onaylananı `prisma/migrations/<damga>_<ad>/migration.sql` olarak taşı, **vardiya dışında** deploy et.

⚠️ `CREATE INDEX CONCURRENTLY` Prisma migration'ının transaction'ı içinde ÇALIŞMAZ;
o taslaklar `psql` ile elle koşulur ya da migration dosyasında transaction kapatılır.

## DURUM (2026-08-29 akşamı — fabrika verisinin kopyasında ÖLÇÜLDÜ)

Sekiz taslağın tamamı `tekserp_saha_0825`'in birebir kopyasına (33 MB, gerçek
fabrika verisi) **gerçekten kuruldu**; her adım < 0,1 sn.

| Taslak | Ölçüm | Karar |
|---|---|---|
| **K1** metraj üst sınırı | kuruldu · fabrikada **2 eski ihlal** · `VALIDATE` düşüyor | ✅ **UYGULANDI** — `NOT VALID` yumuşak kapı; yeni yazımları zorlar, 2 eski satır görünür kalır |
| **K2** kumaş adı tekilliği | ❌ **DÜŞTÜ** — `v-1430` adını iki pasif kumaş taşıyor (`BGR150`, `MC155`) | ⛔ **BEKLİYOR** — önce mükerrer panelinden birleştirme |
| **K3** kod harf-duyarsız tekillik | ❌ **DÜŞTÜ** — 3 grup: `MC155`(3) · `BGR150`(2) · **`SANTUK`(2, İKİSİ DE AKTİF)** | ⛔ **BEKLİYOR** — `SANTUK`/`santuk` iki FARKLI aktif kumaş (BORANCIK ↔ ŞANTUK); biri yeniden adlandırılmalı |
| **K4** mezar taşı korunsun | kuruldu | ⛔ **UYGULANMADI (bilinçli)** — repo 2026-08-19'da bu bağın SetNull kalmasına gerekçeli karar verdi; ayrıca `/permanent` ucunun bağımlılık kapısı mezar taşına bakmıyor → kısıt orada okunaklı 400 değil HAM FK hatası üretirdi |
| **K5** iş emri↔sipariş bağı | kuruldu · 140 bağ | ✅ **UYGULANDI** + kod ön koşulu (silme kapısı iptal edilmiş iş emirlerini de sayıyor, okunaklı 409) |
| **K6** audit değiştirilemezliği | kuruldu · 10.485 log | ✅ **UYGULANDI** — ölçüldü: uygulamada kullanıcıyı SERT silen yol YOK, yani saha akışı etkilenmiyor (yalnız iki test temizliği düzeltildi) |
| **K7** rapor indeksleri | üçü de kuruldu | ✅ **UYGULANDI** — `CONCURRENTLY` KULLANILMADI (Prisma migration tek tx'te koşar); `orders` 278 satır, düz `CREATE INDEX` ms mertebesinde |
| **K8** kart basım tarihi | kuruldu · 153 kart yalan tarih taşıyor | ✅ **UYGULANDI** — yalnız VARSAYILAN kalktı, mevcut satırlara dokunulmadı; sıralama NULL'a hazırlandı |

Uygulananlar: `prisma/migrations/20260829140000_denetim_sema_kisitlari/`.

⚠️ **K6'nın ops ikizi migration DEĞİL:** `ALTER DATABASE <db> SET teks.audit_guard = 'on'`
sahada elle koşulur (deploy adımı).

## Taslaklar

| Dosya | Ne yapar | SQL bloğu |
|---|---|---:|
| `K1-rolls-metraj-ust-siniri-prod-da-calistirma.sql` | `rolls`: metraj üst sınırı `[PROD'DA ÇALIŞTIRMA]` | 1 |
| `K2-items-ad-seddinin-enforce-u-prod-da-calistirma.sql` | `items`: ad seddinin enforce'u `[PROD'DA ÇALIŞTIRMA]` | 1 |
| `K3-items-kod-tekilliginin-harf-duyarsiz-seddi-prod-.sql` | `items`: kod tekilliğinin harf-duyarsız seddi `[PROD'DA ÇALIŞTIRMA]` | 1 |
| `K4-birlestirme-mezar-tasi-korunsun-prod-da-calistir.sql` | Birleştirme mezar taşı korunsun `[PROD'DA ÇALIŞTIRMA]` | 1 |
| `K5-i-s-emri-siparis-bagi-silinmesin-prod-da-calisti.sql` | İş emri ↔ sipariş bağı silinmesin `[PROD'DA ÇALIŞTIRMA]` | 1 |
| `K6-audit-degistirilemezligi-prod-da-calistirma.sql` | Audit değiştirilemezliği `[PROD'DA ÇALIŞTIRMA]` | 1 |
| `K7-rapor-ve-iz-indeksleri-prod-da-calistirma.sql` | Rapor ve iz indeksleri `[PROD'DA ÇALIŞTIRMA]` | 1 |
| `K8-traveler-cards-printedat-gercegi-soylesin-prod-d.sql` | `traveler_cards.printedAt` gerçeği söylesin `[PROD'DA ÇALIŞTIRMA]` | 1 |
