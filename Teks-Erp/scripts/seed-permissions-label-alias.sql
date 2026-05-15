-- =============================================================================
-- Canlı DB'ye yeni 7 permission ekle + admin'e ata
-- =============================================================================
-- Eklenen kodlar:
--   customer-alias:read, customer-alias:write  (SALES modülü)
--   label:read, label:print, label:edit         (LOGISTICS modülü)
--   label-template:read, label-template:write   (LOGISTICS modülü)
--
-- Idempotent: ON CONFLICT (code) DO NOTHING — tekrar çalıştırılabilir.
-- Admin'e atama da idempotent (ON CONFLICT (userId, permissionId) DO NOTHING).
--
-- Çalıştırma:
--   psql "$DATABASE_URL" -f scripts/seed-permissions-label-alias.sql
-- =============================================================================

INSERT INTO permissions (id, code, module, category, description, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'customer-alias:read',  'SALES',     'web', NULL, now(), now()),
  (gen_random_uuid(), 'customer-alias:write', 'SALES',     'web', NULL, now(), now()),
  (gen_random_uuid(), 'label:read',            'LOGISTICS', 'web', 'Etiket payload''unu görüntüleme (önizleme)', now(), now()),
  (gen_random_uuid(), 'label:print',           'LOGISTICS', 'web', 'Etiket basma aksiyonu (yazıcıya gönderme)', now(), now()),
  (gen_random_uuid(), 'label:edit',            'LOGISTICS', 'web', 'Sipariş satırı bazlı müşteri ismi/renk override etme', now(), now()),
  (gen_random_uuid(), 'label-template:read',   'LOGISTICS', 'web', 'Etiket template''lerini listele', now(), now()),
  (gen_random_uuid(), 'label-template:write',  'LOGISTICS', 'web', 'Template oluştur/düzenle/default değiştir', now(), now())
ON CONFLICT (code) DO NOTHING;

-- Admin'e ata (admin user'ın username'i 'admin' kabul edilir)
INSERT INTO user_permissions (id, "userId", "permissionId", "grantedById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  u.id,
  p.id,
  u.id,
  now(),
  now()
FROM users u
CROSS JOIN permissions p
WHERE u.username = 'admin'
  AND p.code IN (
    'customer-alias:read',
    'customer-alias:write',
    'label:read',
    'label:print',
    'label:edit',
    'label-template:read',
    'label-template:write'
  )
ON CONFLICT ("userId", "permissionId") DO NOTHING;

-- Admin (Tam Yetki) şablonuna da ekle
INSERT INTO permission_template_items ("templateId", "permissionId", "createdAt")
SELECT
  pt.id,
  p.id,
  now()
FROM permission_templates pt
CROSS JOIN permissions p
WHERE pt.name = 'Admin (Tam Yetki)'
  AND p.code IN (
    'customer-alias:read',
    'customer-alias:write',
    'label:read',
    'label:print',
    'label:edit',
    'label-template:read',
    'label-template:write'
  )
ON CONFLICT ("templateId", "permissionId") DO NOTHING;
