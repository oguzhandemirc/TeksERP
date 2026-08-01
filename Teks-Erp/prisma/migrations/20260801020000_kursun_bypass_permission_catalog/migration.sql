-- Kurşun bypass izin KATALOĞU — migration ile gelir, elle INSERT edilmez.
--
-- NEDEN MIGRATION:
--   `requirePermission("workorder:distribute")` yazıldığı anda o satırın DB'de
--   olması bir ZORUNLULUK olur — yoksa Admin dışı herkes 403 alır. Yani izin
--   kodu kodun sözleşmesinin parçasıdır, ortama göre değişmez. `prisma/seed.ts`
--   YALNIZ ilk kurulumda koştuğu için mevcut bir fabrikada bu satırlar hiç
--   doğmuyordu ve "canlı DB'ye elle INSERT et" diye bir deploy adımı gerekiyordu.
--   O adım unutulabilir bir adımdı (2026-08-01'de fiilen unutuldu: ekran açıldı
--   ama izin olmadığı için kimse göremedi). `migrate deploy` zaten deploy'un
--   parçası → katalog artık kendiliğinden gelir.
--
-- KAPSAM AYRIMI (bilinçli):
--   • İzin KATALOĞU (kod/modül/kategori/açıklama) → BURADA. Ortamdan bağımsız.
--   • Şablon (PermissionTemplate) + içeriği → BURADA. Bizim tanımladığımız
--     kullanım kolaylığı paketi; adı çakışırsa DOKUNULMAZ (fabrika düzenlemiş
--     olabilir).
--   • Kullanıcı ATAMALARI (kim hangi izne sahip) → BURADA DEĞİL. Fabrikaya
--     özgüdür (bir kurulumda planlamacı Ahmet, diğerinde Mehmet). Panelden ya da
--     scripts/sync-kursun-bypass-permissions.ts ile verilir.
--
-- Tümü İDEMPOTENT (ON CONFLICT DO NOTHING): seed'in koştuğu taze kurulumda da,
-- satırların elle açıldığı bir kurulumda da güvenle yeniden koşar.
-- `updatedAt` DEFAULT'suz olduğu için elle verilir; kolonlar `timestamp`
-- (timezone'suz) → `now() AT TIME ZONE 'UTC'` (düz now() Europe/Istanbul'da
-- 3 saat kaydırır — O-11 tuzağı).

-- 1) İzin katalogu ------------------------------------------------------------
INSERT INTO "permissions" ("id", "code", "module", "category", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'workorder:distribute', 'PRODUCTION', 'web',
   'Kurşun dağıtım — fason dönüşü iş emrini fiziksel kurşun makinesine atama + son-adım tamamlama',
   now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'),
  (gen_random_uuid(), 'mobile:kursun-dagitim', 'MOBILE', 'mobile',
   'Mobil — Kurşun Dağıtım ekranı',
   now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
ON CONFLICT ("code") DO NOTHING;

-- 2) Şablon (varsa DOKUNMA) ---------------------------------------------------
-- Web ikizi `workorder:distribute` bu MOBİL şablona BİLİNÇLİ olarak konmaz —
-- saha kullanıcısına masaüstü yetkisi taşımasın; planlamacıya panelden verilir.
INSERT INTO "permission_templates" ("id", "name", "description", "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'Mobil — Kurşun Dağıtım',
        'Kurşun dağıtım ekranı (iş emrini fiziksel kurşun makinesine ata + son adımsa işi bitir)',
        true, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
ON CONFLICT DO NOTHING;

-- 3) Şablon içeriği -----------------------------------------------------------
-- Şablon adı üzerinden çözülür; eksik kalemler tamamlanır, fazlası SİLİNMEZ
-- (fabrika şablona ekleme yapmış olabilir). Kod DB'de yoksa o satır sessizce
-- atlanır — JOIN eşleşmez.
INSERT INTO "permission_template_items" ("templateId", "permissionId", "createdAt")
SELECT t."id", p."id", now() AT TIME ZONE 'UTC'
  FROM "permission_templates" t
  JOIN "permissions" p
    ON p."code" IN ('mobile:kursun-dagitim', 'workorder:read', 'roll:read', 'station:read')
 WHERE t."name" = 'Mobil — Kurşun Dağıtım'
ON CONFLICT ("templateId", "permissionId") DO NOTHING;
