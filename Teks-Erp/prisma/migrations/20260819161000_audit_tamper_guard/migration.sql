-- =============================================================================
-- AUDIT DEĞİŞTİRİLEMEZLİĞİ — UPDATE/DELETE/TRUNCATE ENGELİ (ISO 27001 A.8.15)
-- =============================================================================
-- Tasarım: docs/design/AUDIT-DERINLESTIRME-TASARIM.md
--
-- SORUN: `system_logs` sıradan bir tabloydu. DB erişimi olan biri bir audit
-- satırını değiştirebilir ya da silebilirdi ve BUNUN İZİ KALMAZDI. Denetim
-- kaydının bütün değeri "sonradan oynanamaz" olmasındadır; A.8.15 bunu açıkça
-- ister ve SAP'ta change document'a uygulama katmanından yazma yolu yoktur.
--
-- NEDEN TRIGGER, uygulama kodu değil: uygulama kodu yalnız KENDİ yolunu korur.
-- psql, yedekten yükleme sonrası elle düzeltme, ileride yazılacak bir script —
-- hepsi uygulamayı atlar. Koruma verinin yanında durmalı.
--
-- ⚠️ İKİ GUC, İKİSİ DE LOAD-BEARING:
--   · `teks.audit_guard = 'on'` → koruma AÇIK. Varsayılan KAPALI ve bu bilinçli
--     bir karardır: 79 test dosyası + 4 fixture script'i cleanup'ta audit satırı
--     siler ZORUNDA (`system_logs.userId → users` FK'sı RESTRICT; kullanıcıyı
--     silmek için önce log'unu silmek gerekiyor). Her ortamda katı koruma o 83
--     dosyanın elden geçmesini ve yeni test yazan herkesin bir sarmalayıcıyı
--     bilmesini gerektirirdi — yeni-gelen tuzağı. Koruma PROD'da `ALTER DATABASE
--     tekserp SET teks.audit_guard = 'on'` ile açılır (statement_timeout emsali:
--     ortama özgü ayar migration'da değil, ops adımında).
--   · `teks.audit_purge = 'on'` → arşivleyicinin MEŞRU silmesi. `SET LOCAL` ile
--     yalnız o transaction'da açılır (`archiveOlderThan` tx'inin İLK ifadesi),
--     COMMIT'te söner. Arka kapı DEĞİLDİR: uygulama bağlantısından gelen sıradan
--     bir sorgu bu ayarı taşımaz.
--
-- ⚠️ `coalesce(current_setting(...), '')` — çıplak karşılaştırma YETMEZ: hiç set
-- edilmemiş placeholder NULL döner ama aynı oturumda bir kez set edilip
-- RESET'lenmişse BOŞ STRING döner. İki hâli de "kapalı" saymak zorundayız.
--
-- ⚠️ STATEMENT-LEVEL: satır başına maliyet YOK (audit'in normal akışı salt
-- INSERT'tir, trigger o yolda hiç ateşlenmez). TRUNCATE zaten yalnız
-- statement-level olabilir; BEFORE'da RAISE onu iptal eder ve TRUNCATE
-- transactional olduğu için ROLLBACK temizdir. Trigger 0 satır etkilense de
-- ateşlenir — guard için istenen davranış budur.
--
-- ⚠️ İKİ AYRI TRIGGER ADI (aynı fonksiyon): `test_db_invariants` trigger'ları
-- YALNIZ ADA GÖRE haritalıyor; iki tabloda aynı adı kullanmak envanteri sessizce
-- yanlış çalıştırırdı.
--
-- Bekçiler: scripts/test_audit_depth.ts §10 · scripts/test_db_invariants.ts §6
-- =============================================================================

CREATE OR REPLACE FUNCTION "audit_block_tamper"() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('teks.audit_guard', true), '') = 'on'
     AND coalesce(current_setting('teks.audit_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION
      'Audit kaydı değiştirilemez veya silinemez (tablo: %, işlem: %).', TG_TABLE_NAME, TG_OP
      USING
        ERRCODE = 'insufficient_privilege',
        HINT = 'Denetim kaydı salt-yazılırdır (ISO 27001 A.8.15). Meşru arşivleme yolu bu transaction icinde SET LOCAL teks.audit_purge = ''on'' ile acilir.';
  END IF;
  -- Statement-level trigger'da dönüş değeri yok sayılır.
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "system_logs_block_tamper"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "system_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_block_tamper"();

CREATE TRIGGER "system_log_archives_block_tamper"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "system_log_archives"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_block_tamper"();
