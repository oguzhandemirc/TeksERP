-- =============================================================================
-- Reports modülü için 7 yeni permission ekle.
-- Admin kullanıcısına ve "Admin (Tam Yetki)" template'ine grant.
-- Idempotent — ON CONFLICT DO NOTHING (mevcut DB'lerde de tekrar koşturulabilir).
-- =============================================================================

-- 1) Permissions
INSERT INTO permissions (id, code, module, category, description, "createdAt", "updatedAt") VALUES
  (gen_random_uuid(), 'report:production',  'REPORTS', 'web', 'Üretim raporları',              now(), now()),
  (gen_random_uuid(), 'report:sales',       'REPORTS', 'web', 'Sipariş & sevkiyat raporları',  now(), now()),
  (gen_random_uuid(), 'report:quality',     'REPORTS', 'web', 'Kalite raporları',              now(), now()),
  (gen_random_uuid(), 'report:inventory',   'REPORTS', 'web', 'Stok & depo raporları',         now(), now()),
  (gen_random_uuid(), 'report:subcontract', 'REPORTS', 'web', 'Fason raporları',               now(), now()),
  (gen_random_uuid(), 'report:customer',    'REPORTS', 'web', 'Müşteri / satış profil raporları', now(), now()),
  (gen_random_uuid(), 'report:audit',       'REPORTS', 'web', 'Sistem / audit raporları',      now(), now())
ON CONFLICT (code) DO NOTHING;

-- 2) Admin kullanıcılarına (username='admin') grant — birden fazla varsa hepsi
INSERT INTO user_permissions (id, "userId", "permissionId", "grantedById", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u.id, p.id, u.id, now(), now()
FROM users u
CROSS JOIN permissions p
WHERE u.username = 'admin'
  AND p.code IN (
    'report:production','report:sales','report:quality',
    'report:inventory','report:subcontract','report:customer','report:audit'
  )
ON CONFLICT ("userId", "permissionId") DO NOTHING;

-- 3) "Admin (Tam Yetki)" template'ine ekle
INSERT INTO permission_template_items ("templateId", "permissionId", "createdAt")
SELECT t.id, p.id, now()
FROM permission_templates t
CROSS JOIN permissions p
WHERE t.name = 'Admin (Tam Yetki)'
  AND p.code IN (
    'report:production','report:sales','report:quality',
    'report:inventory','report:subcontract','report:customer','report:audit'
  )
ON CONFLICT ("templateId", "permissionId") DO NOTHING;
