-- =============================================================================
-- TASLAK K6 — Audit değiştirilemezliği `[PROD'DA ÇALIŞTIRMA]`
-- =============================================================================
-- ⚠️ BU DOSYA BİR MIGRATION DEĞİLDİR ve `prisma migrate deploy` onu ÇALIŞTIRMAZ.
-- Denetim (2026-08-29) tarafından ÖNERİ olarak yazıldı; sahaya uygulanmadan önce
-- (1) dev kopyada denenir, (2) kullanıcı onayı alınır, (3) VARDİYA DIŞINDA
-- gerçek migration dizinine taşınır. Geri alma yolu aşağıda yazılıdır.
-- Gerekçe ve ölçümler: audit/RAPOR-2026-08-29.md §12.1 (K6).
-- =============================================================================

-- ⚠️ **`audit_guard` sahada KAPALI** ve kopyaya taşınmadığı için doğrulanamadı (`ERISILEMEYEN.md` ①). Bu, SoD zayıflığının (O-15) **en ucuz telafi edici kontrolüdür**. **Geri alma:** `SET teks.audit_guard = 'off'` + FK'nın `SET NULL` hâli.

-- ── uygulama ──
-- Kapattığı bulgu: BULGU-T1-034 (şema/migration 'RESTRICT' diyor, gerçek FK SET NULL)
ALTER TABLE system_logs DROP CONSTRAINT "system_logs_userId_fkey";
ALTER TABLE system_logs ADD CONSTRAINT "system_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT;
-- ve ASIL kontrol (kod değil ops):
ALTER DATABASE tekserp SET teks.audit_guard = 'on';   -- oturum yenilenince etkin
