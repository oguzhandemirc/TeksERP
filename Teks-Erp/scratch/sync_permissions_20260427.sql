-- Tek seferlik permission senkronizasyonu (2026-04-27)
-- Idempotent: ON CONFLICT ile birden fazla çalıştırılabilir
-- 1. item:read, item:write ekle
-- 2. Admin + diğer rollere ata
-- 3. Dead permission'ları sil

BEGIN;

-- 1. Yeni permission'ları ekle (varsa skip)
INSERT INTO permissions (id, code, module, "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'item:read', 'PRODUCTION', NOW(), NOW()),
  (gen_random_uuid(), 'item:write', 'PRODUCTION', NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

-- 2. Admin'e item:read + item:write (varsa skip)
INSERT INTO role_permissions ("roleId", "permissionId", "createdAt", "updatedAt")
SELECT r.id, p.id, NOW(), NOW()
FROM roles r, permissions p
WHERE r.name = 'Admin' AND p.code IN ('item:read', 'item:write')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 3. Diğer rollere item:read (varsa skip)
INSERT INTO role_permissions ("roleId", "permissionId", "createdAt", "updatedAt")
SELECT r.id, p.id, NOW(), NOW()
FROM roles r, permissions p
WHERE r.name IN ('Planlama Şefi', 'Üretim Operatörü', 'Kalite Kontrol', 'Satış Temsilcisi', 'Sevkiyatçı')
  AND p.code = 'item:read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 4. Dead permission'ları sil (CASCADE ile role_permissions temizlenir)
DELETE FROM permissions WHERE code IN (
  'order:delete',
  'workorder:create',
  'finance:read',
  'finance:write',
  'allocation:read'
);

COMMIT;
