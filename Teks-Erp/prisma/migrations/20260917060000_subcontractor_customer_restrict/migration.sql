-- =============================================================================
-- Subcontractor.customerId FK: ON DELETE SET NULL → ON DELETE RESTRICT (1e kararı 2026-09-17)
-- =============================================================================
-- Fason profili olan cari SERT SİLİNEMEZ; önce bağ kaldırılır (CariAccount→Customer ile aynı,
-- fail-closed). Önceki migration (20260917050000) sahaya ÇIKMADI ama sonda DB'lerinde uygulandı —
-- dosyaya dokunulmaz, düzeltme bu ayrı migration'la. YALNIZ kısıt davranışı değişir; kolon/veri aynen.
-- İdempotent: DROP IF EXISTS + ADD (ikinci koşumda aynı sonuç).
-- =============================================================================
ALTER TABLE "subcontractors" DROP CONSTRAINT IF EXISTS "subcontractors_customerId_fkey";
ALTER TABLE "subcontractors" ADD CONSTRAINT "subcontractors_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
