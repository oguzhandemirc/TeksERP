-- =============================================================================
-- system_logs_category_createdAt_idx → PARTIAL (perf turu 2026-09-05, BULGU 2)
-- =============================================================================
-- NE YAPIYOR: index'i DÜŞÜRÜP aynı adla `WHERE category IN ('AUTH','SYSTEM')`
-- predicate'iyle yeniden kurar. Kolonlar (category, "createdAt") AYNI kalır —
-- şemadaki `@@index([category, createdAt])` değişmez ([DB-14]: predicate ham
-- SQL'de yaşar, Prisma predicate farkını drift saymaz).
--
-- ADDITIVE Mİ: HAYIR — DROP içerir ve DROP GERİ ALINAMAZ. Yanlış giderse çözüm
-- `migrate deploy`u geri sarmak değil, bu dosyanın CREATE'ini predicate'siz
-- tekrar eden YENİ bir migration yazmaktır ([DB-28], [DB-31]).
-- Kilit: 51k satırlık tabloda ~0,1 sn'lik ACCESS EXCLUSIVE. `kur.ps1` pm2'yi
-- [4/9]'da durdurup migration'ları [7/9]'da koştuğu için eşzamanlı yazan yok
-- ([DB-29b]). [DB-26] gereği CONCURRENTLY YAZILMAZ.
-- ÜRETİLMİŞ ÇIKTIDAN SİLİNEN SATIR: yok (dosya tamamen elle yazıldı).
--
-- ÖLÇÜM (tekserp_demo, PG 16.15, 51.164 satır — dağılım DOMAIN 49.879 / AUTH 664
-- / SYSTEM 621):
--   index boyutu           3.600 kB → 56 kB (%98,4 azalma)
--   yazma bakımı           her INSERT → INSERT'lerin %97,5'i (DOMAIN) artık
--                          predicate'i TUTMUYOR, bu index'e hiç girdi yazılmıyor.
--                          system_logs n_tup_ins=68.800 ile DB'nin en çok yazılan
--                          tablosudur; kazanç oradadır.
--   category='AUTH'        Index Cond ile aynı index → 57 → 47 buffer / 0,214 →
--                          0,084 ms  (predicate İSPATI TUTUYOR — doğrulandı)
--   category='SYSTEM'      Index Cond ile aynı index → 34 → 33 buffer / 0,106 →
--                          0,067 ms  (predicate İSPATI TUTUYOR — doğrulandı)
--   category IN (A,S)      planlayıcı zaten `system_logs_createdAt_idx`i seçiyordu;
--                          ÖNCE = SONRA (597 buffer). Regresyon YOK, kazanç da yok.
--   category='DOMAIN'      ÖNCE = SONRA (23 buffer, `createdAt` index'i) — bu index
--                          DOMAIN yolunda ZATEN hiç seçilmiyordu.
--
-- KAPSAMA DOĞRULAMASI (kod): `category` süzen TÜM yüzeyler —
--   ActivityPage.tsx:51 / NotificationBell.tsx:36 / ArchiveSearchPage.tsx:27 → 'DOMAIN'
--   SystemEventsPage.tsx:28 → 'AUTH,SYSTEM' | 'AUTH' | 'SYSTEM'
-- `SystemLogCategory` KAPALI bir enum'dur (DOMAIN/AUTH/SYSTEM), yani predicate
-- "DOMAIN olmayan her şey"i tam kapsar ve index'in tek kullanıcısı olan üç sorgu
-- (AUTH · SYSTEM · AUTH,SYSTEM) predicate'in İÇİNDEDİR.
-- ⚠️ Enum'a DÖRDÜNCÜ bir kategori eklenirse bu predicate onu DIŞARIDA bırakır ve
--    o kategorinin liste sorgusu sessizce `createdAt` index'ine düşer. Reçete
--    (`docs/RECETELER.md` § enum'a yeni değer) bu dosyayı da gezmeli.
-- =============================================================================
SET statement_timeout = 0;

DROP INDEX IF EXISTS "system_logs_category_createdAt_idx";

CREATE INDEX IF NOT EXISTS "system_logs_category_createdAt_idx"
  ON "system_logs" ("category", "createdAt")
  WHERE "category" IN ('AUTH', 'SYSTEM');
