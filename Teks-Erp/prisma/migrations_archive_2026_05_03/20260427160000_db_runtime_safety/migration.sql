-- =============================================================================
-- DB Runtime Safety — uzun çalışan sorgulara karşı koruma
-- =============================================================================
-- Tekstil fabrikası ERP'si yıllarca yerel sunucuda çalışacak. Bilinmeyen bir
-- endpoint veya unutulmuş filtre yüzünden DB tüm gün dönmesin.
--
-- 1) statement_timeout: tek bir sorgu 30 saniyeyi geçerse iptal edilir.
--    Olağan OLTP işlemleri milisaniye seviyesindedir; 30s rahatlıkla yeter.
--    Arşivleme batch'leri (5000 satır) yerel ağda çok altında kalır.
--
-- 2) log_min_duration_statement: 500ms+ süren tüm sorgular postgres log dosyasına
--    yazılır. Yıllık DB sağlık kontrolünde "hangi sorgu yavaşlamış" elimizde olur.
--
-- 3) idle_in_transaction_session_timeout: kapanmamış transaction'lar
--    5 dakika boyutunda tablo lock'ı tutmasın.
-- =============================================================================

-- App rolüne statement timeout uygula. Production'da pg user'ı ne ise onu kullan.
ALTER ROLE postgres SET statement_timeout = '30s';
ALTER ROLE postgres SET idle_in_transaction_session_timeout = '5min';

-- Slow query log (yalnızca bu DB için).
-- ALTER SYSTEM transaction bloğu içinde çalışamadığı ve Prisma migration'larını
-- transaction'a sardığı için ALTER DATABASE kullanıyoruz: aynı parametreler
-- (sighup-context GUC'lar) DB seviyesinde de set edilebilir, transaction-safe ve
-- yeni connection'larda otomatik aktif olur — pg_reload_conf() gerekmez.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET log_min_duration_statement = %L',
    current_database(), '500ms'
  );
  EXECUTE format(
    'ALTER DATABASE %I SET log_lock_waits = %L',
    current_database(), 'on'
  );
  EXECUTE format(
    'ALTER DATABASE %I SET log_temp_files = %L',
    current_database(), '10MB'
  );
END $$;
