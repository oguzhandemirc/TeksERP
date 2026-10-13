// G4 — "bağlı rol audit'i kurcalayabilir mi" yüklemi TEK kaynak: /health (`readAuditProtection`)
// ve rol göçü aracı (`src/lib/db-rol-gocu.ts`, uygulama rolüyle bağlanıp doğrular) aynı metni koşar.
// Süper · tablo sahibi üyeliği · UPDATE/DELETE/TRUNCATE yetkisi → kurcalayabilir (true).
export const AUDIT_TAMPER_SQL = `
    SELECT (r.rolsuper
      OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'public.system_logs'::regclass), 'MEMBER')
      OR pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'public.system_log_archives'::regclass), 'MEMBER')
      OR has_table_privilege('public.system_logs', 'UPDATE, DELETE, TRUNCATE')
      OR has_table_privilege('public.system_log_archives', 'UPDATE, DELETE, TRUNCATE')) AS tamper
    FROM pg_roles r WHERE r.rolname = current_user`;
