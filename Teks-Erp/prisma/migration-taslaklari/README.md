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
