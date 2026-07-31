-- 2026-07-31 denetimi — dusuk-oncelik unique seddleri (rapor: A7 + Bolum C-A +
-- CustomerBranch bulgusu). On-tarama: dort kural da dev'de 0 ihlal (2026-07-31).
SET statement_timeout = 0;

-- RouteStep (routeId, sequence) → UNIQUE'e yukselt (faz4 D-12 WorkOrderStep emsali:
-- DROP + CREATE UNIQUE, Prisma @@unique _key adi — drift-free).
DROP INDEX "route_steps_routeId_sequence_idx";
CREATE UNIQUE INDEX "route_steps_routeId_sequence_key" ON "route_steps"("routeId", "sequence");

-- CustomerBranch (customerId, code) UNIQUE — musteri-ici sube kodu tekil.
-- code NULL satirlar serbest (PG unique NULL'lari ayirt eder, partial gerekmez).
CREATE UNIQUE INDEX "customer_branches_customerId_code_key" ON "customer_branches"("customerId", "code");

-- A7: kullanici adi / yetki sablonu adinin case-insensitive tekilligi. App katmani
-- zaten mode:'insensitive' kontrol ediyor (sirali istekte dostane 409); bu expression
-- unique'ler YARIS penceresinin DB seddi ("Depocu"/"depocu" ayni anda ikisi de gecemez).
-- username ASCII alfanumerik (admin.routes regex) → lower() guvenli (İ/ı sorunu yok).
-- SEMA-DISI nesneler (Prisma expression index modelleyemez) — envanter:
-- test_db_invariants.ts EXPRESSION_UNIQUES.
CREATE UNIQUE INDEX "users_username_lower_uq" ON "users"(lower(username));
CREATE UNIQUE INDEX "permission_templates_name_lower_uq" ON "permission_templates"(lower(name));
