-- =============================================================================
-- User-Direct Permission Model
-- =============================================================================
-- Role katmanı kaldırılıyor. Efektif yetki sadece UserPermission üzerinden okunur.
-- PermissionTemplate admin UI'sında "yetki paketi" kısayolu olarak yaşar; runtime
-- bağı yoktur — uygulandığında UserPermission'a kopyalanır.
--
-- Geliştirme aşaması: veri kaybı önemsiz, tüm legacy join verileri silinir.
-- Mevcut Permission satırlarını korumak istemiyoruz çünkü `category` sütunu yeni
-- ve seed'de yeniden oluşturulacaklar.
-- =============================================================================

-- 1) Legacy tabloları düşür
DROP TABLE IF EXISTS "user_roles" CASCADE;
DROP TABLE IF EXISTS "role_permissions" CASCADE;
DROP TABLE IF EXISTS "roles" CASCADE;

-- 2) Permission tablosunu sıfırla — yeni kolonlarla seed'den dolacak
DROP TABLE IF EXISTS "permissions" CASCADE;

CREATE TABLE "permissions" (
    "id"          TEXT NOT NULL,
    "code"        TEXT NOT NULL,
    "module"      TEXT NOT NULL,
    "category"    TEXT NOT NULL DEFAULT 'web',
    "description" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");
CREATE INDEX "permissions_module_idx" ON "permissions"("module");
CREATE INDEX "permissions_category_idx" ON "permissions"("category");

-- 3) Direct user → permission grant tablosu
CREATE TABLE "user_permissions" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "validFrom"    TIMESTAMP(3),
    "validUntil"   TIMESTAMP(3),
    "grantedById"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permissions_userId_permissionId_key"
    ON "user_permissions"("userId", "permissionId");
CREATE INDEX "user_permissions_userId_idx" ON "user_permissions"("userId");
CREATE INDEX "user_permissions_permissionId_idx" ON "user_permissions"("permissionId");

ALTER TABLE "user_permissions"
    ADD CONSTRAINT "user_permissions_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_permissions"
    ADD CONSTRAINT "user_permissions_permissionId_fkey"
        FOREIGN KEY ("permissionId") REFERENCES "permissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_permissions"
    ADD CONSTRAINT "user_permissions_grantedById_fkey"
        FOREIGN KEY ("grantedById") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- 4) Admin UI şablonu (rol değil — sadece kısayol)
CREATE TABLE "permission_templates" (
    "id"          TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "permission_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permission_templates_name_key" ON "permission_templates"("name");

CREATE TABLE "permission_template_items" (
    "templateId"   TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_template_items_pkey" PRIMARY KEY ("templateId", "permissionId")
);

CREATE INDEX "permission_template_items_permissionId_idx"
    ON "permission_template_items"("permissionId");

ALTER TABLE "permission_template_items"
    ADD CONSTRAINT "permission_template_items_templateId_fkey"
        FOREIGN KEY ("templateId") REFERENCES "permission_templates"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "permission_template_items"
    ADD CONSTRAINT "permission_template_items_permissionId_fkey"
        FOREIGN KEY ("permissionId") REFERENCES "permissions"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
