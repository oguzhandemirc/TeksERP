// =============================================================================
// G5 — müşterinin BI aracı için YALNIZ-OKUMA DB rolü (`<sahip>_okuma`)
// =============================================================================
// Rolü rol göçü (`db-rol-gocu.ts`, sahip rolüyle, her Docker açılışında) kurar/onarır; parolayı
// yalnız `okuma_rolu_parola(dogrulayici)` SECURITY DEFINER fonksiyonu değiştirir (uygulama rolü
// NOCREATEROLE — rol yaratamaz, yalnız BU rolün parolasını döndürebilir).
// Sır hariç tutma KOLON DÜZEYİ GRANT ile ve TEK KAYNAK aşağıdaki iki listedir: görünüm şeması her
// göçte bayatlar ve DROP COLUMN'u bağımlılıkla kilitler; kolon GRANT'ı açılışta katalogdan yeniden
// kurulur. Varsayılan ayrıcalık (ALTER DEFAULT PRIVILEGES) BİLEREK yok: tablo düzeyi SELECT verir,
// ileride sır kolonu taşıyan tabloyu da açardı — yeni tablo bir sonraki açılışta (göç de açılışta
// koşar) uzlaştırılır. `test_okuma_rolu` sır adlı her kolonun sınıflandırıldığını ölçer.
// =============================================================================

/** Tamamı kapalı tablolar: satırın kendisi sır ya da sır kapısının durumu. */
export const READ_ONLY_HIDDEN_TABLES: readonly string[] = [
  "system_settings", // `security.*` (ayar şifresi özeti) satır düzeyinde ayrılamaz
  "short_credential_key_escrows", // kısa kimlik anahtarı emaneti
  "totp_enrollments", // aday TOTP sırrı + tek kullanımlık bağlantı anahtarı
  "user_recovery_codes", // kurtarma kodu bcrypt özetleri
  "login_lockout_buckets", // giriş kilidi kovası (saldırgana deneme bütçesi söyler)
];

/** Tablo başına kapalı kolonlar; tablonun kalanı okunur. */
export const READ_ONLY_HIDDEN_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ["passwordHash", "cardToken", "quickPin", "quickPinDigest", "cardTokenDigest", "totpSecret", "systemAccountSeal"],
  sessions: ["jti"],
  // hwDigest (eşleme v2): kimlik doğrulamaz ama bilen biri bayrak kapalı kurulumda yeni localId'yle cihaz satırını devralabilir.
  devices: ["proofSalt", "hwDigest"],
  device_binding_events: ["hwDigest"],
  device_rebind_requests: ["hwDigest"],
  machine_collectors: ["secretSeed"],
};

/**
 * Adı sır çağrıştıran ama SIR OLMAYAN kolonlar (bekçi bunları sınıflandırılmış sayar). Ölçüt: değeri
 * tek başına kimlik/oturum/cihaz kanıtı üretmez (idempotency belirteci, iş anahtarı, durum damgası).
 */
export const READ_ONLY_NOT_SECRET_COLUMNS: readonly string[] = [
  "barcode", "barcodeText", "cancelReasonCode", "cardTokenLegacy", "chainHash", "clientToken", "code", "codeBefore",
  "collectorKey", "contentHash", "contentKey", "dedupeKey", "defaultPasswordChangedAt", "defaultPasswordIssuedAt", "digest", "digestHour",
  "entryReasonCode", "errorCode", "exportCode", "factoryDayKey", "finishingRateCode", "fromReasonCode", "groupKey", "inputHash", "installationKeyId",
  "key", "keyValue", "lastErrorCode", "mustChangePassword", "pairKey", "paramsDigest", "payloadDigest", "pendingKey",
  "permissionCode", "planReasonCode", "procedureCode", "quickPinSetAt", "rawCode", "rawKey", "rawStopCode",
  "reasonCode", "routeKey", "rowKeys", "sampleCode", "scopeKey", "sealGeneration", "sealState", "sealedAt", "sealedById",
  "secretIssuedAt", "seriesKey", "setKey", "signalStopKey", "stopKey", "subjectKey", "suggestedGradeCode", "textDigest", "toReasonCode",
  "tokenVersion", "totpEnabledAt", "totpLastStep",
];

/** Sır çağrıştıran kolon adı — bekçinin taradığı küme (fail-closed: eşleşen her ad sınıflandırılmalı). */
export const SECRET_NAME_PATTERN = /(hash|secret|passw|parola|pin|seal|salt|seed|token|jti|cipher|private|digest|otp|credential|key|code)/i;

/** Parolayı döndüren tek yetkili yol (sahip rolüyle tanımlanır, yalnız uygulama rolü çağırır). */
export const READ_ONLY_PASSWORD_FUNCTION = "okuma_rolu_parola";

/** Bağlantı sınırı: BI aracı fabrikanın havuzunu tüketemesin. */
export const READ_ONLY_CONNECTION_LIMIT = 5;

/** Rol yorumundaki son yenileme damgası öneki (`okuma-parola:<epoch sn>`). */
export const READ_ONLY_STAMP_PREFIX = "okuma-parola:";

export interface ReadOnlyCatalog {
  /** public şemadaki tablo ve görünümler (ad → kolonlar). */
  tables: ReadonlyMap<string, readonly string[]>;
  /** public şemadaki SECURITY DEFINER fonksiyonlar (`ad(arg tipleri)`). */
  definerFunctions: readonly string[];
  /** pg_catalog advisory kilit fonksiyonları (`ad(arg tipleri)`, kilit + try_ + unlock türevleri). */
  advisoryFunctions: readonly string[];
}

/** pg_catalog'daki advisory kilit/çözme fonksiyonlarının ad deseni (tüm imzalar). */
export const ADVISORY_FUNCTION_SQL = `SELECT p.oid::regprocedure::text AS f FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'pg_catalog' AND p.proname ~ '^pg_(try_)?advisory_' ORDER BY 1`;

const id = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Kataloğu okur (sahip bağlantısıyla). `q` = pg `Client.query`. */
export async function readOnlyCatalog(
  q: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>,
): Promise<ReadOnlyCatalog> {
  const k = await q(`
    SELECT c.relname AS t, a.attname AS k FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') ORDER BY 1, a.attnum`);
  const tables = new Map<string, string[]>();
  for (const r of k.rows) {
    const t = String(r.t);
    if (!tables.has(t)) tables.set(t, []);
    tables.get(t)!.push(String(r.k));
  }
  const f = await q(`
    SELECT p.oid::regprocedure::text AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef ORDER BY 1`);
  const a = await q(ADVISORY_FUNCTION_SQL);
  return { tables, definerFunctions: f.rows.map((r) => String(r.f)), advisoryFunctions: a.rows.map((r) => String(r.f)) };
}

/**
 * Okuma rolü ifadeleri (rol göçünün transaction'ı içinde, uygulama rolü ifadelerinden SONRA).
 * Her koşum yetkileri SIFIRDAN kurar (REVOKE ALL → GRANT): bozulmuş/eski yetki kalmaz.
 */
export function readOnlyPlan(o: {
  owner: string; db: string; appRole: string; role: string; roleExists: boolean;
  memberships: readonly string[]; catalog: ReadOnlyCatalog;
}): string[] {
  const R = id(o.role);
  const out: string[] = [];
  if (!o.roleExists) out.push(`CREATE ROLE ${R}`);
  // PASSWORD yazılmaz: parola yalnız fonksiyondan döner; açılış onu SİLMEZ (yeni rol parolasız → girişsiz).
  out.push(`ALTER ROLE ${R} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT `
    + `CONNECTION LIMIT ${READ_ONLY_CONNECTION_LIMIT}`);
  out.push(
    `ALTER ROLE ${R} SET default_transaction_read_only = on`,
    `ALTER ROLE ${R} SET statement_timeout = '300s'`,
    `ALTER ROLE ${R} SET idle_in_transaction_session_timeout = '300s'`,
  );
  for (const u of o.memberships) out.push(`REVOKE ${id(u)} FROM ${R}`);
  if (o.roleExists) out.push(`REASSIGN OWNED BY ${R} TO ${id(o.owner)}`);
  out.push(
    `GRANT CONNECT ON DATABASE ${id(o.db)} TO ${R}`,
    `GRANT USAGE ON SCHEMA public TO ${R}`,
    // Şema PUBLIC'e CREATE açıksa (eski dökümden dönmüş şema) okuma rolü nesne yaratabilirdi.
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${R}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${R}`,
    `REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM ${R}`,
  );
  for (const [t, columns] of o.catalog.tables) {
    if (READ_ONLY_HIDDEN_TABLES.includes(t)) continue;
    const hidden = READ_ONLY_HIDDEN_COLUMNS[t];
    if (!hidden) { out.push(`GRANT SELECT ON ${id(t)} TO ${R}`); continue; }
    const visible = columns.filter((k) => !hidden.includes(k));
    if (visible.length > 0) out.push(`GRANT SELECT (${visible.map(id).join(", ")}) ON ${id(t)} TO ${R}`);
  }
  // Definer fonksiyon PUBLIC'e açıksa okuma rolü onunla YAZAR (ör. audit_arsivle); uygulama rolü
  // EXECUTE'u açık GRANT'tan (rol göçü) alır, sahip zaten sahiptir.
  for (const f of o.catalog.definerFunctions) {
    if (f.startsWith(`${READ_ONLY_PASSWORD_FUNCTION}(`)) continue;
    out.push(`REVOKE EXECUTE ON FUNCTION ${f} FROM PUBLIC`);
  }
  // Advisory kilitler PUBLIC'e açıkken okuma rolü fabrika uzayını (period-guard envanteri) oturum
  // boyu tutup yazımı kilitleyebilirdi. ÖNCE sahip + uygulama rolüne açık GRANT, SONRA PUBLIC'ten
  // REVOKE (aynı kayıt noktası: biri düşerse ikisi birden geri alınır). Sahip süper değilse REVOKE
  // uyarıyla etkisiz kalır; `readRoleViolations` bunu ölçer ve okuma girişini kapatır (fail-closed).
  for (const f of o.catalog.advisoryFunctions) {
    out.push(`GRANT EXECUTE ON FUNCTION pg_catalog.${f} TO ${id(o.owner)}, ${id(o.appRole)}`);
  }
  for (const f of o.catalog.advisoryFunctions) out.push(`REVOKE EXECUTE ON FUNCTION pg_catalog.${f} FROM PUBLIC, ${R}`);
  out.push(...passwordFunction(o.role, o.appRole));
  return out;
}

/** Yalnız BU rolün parolasını SCRAM doğrulayıcısıyla değiştirir; düz parola fonksiyona hiç girmez. */
function passwordFunction(role: string, appRole: string): string[] {
  const F = `public.${id(READ_ONLY_PASSWORD_FUNCTION)}(text)`;
  return [
    `CREATE OR REPLACE FUNCTION public.${id(READ_ONLY_PASSWORD_FUNCTION)}(p_dogrulayici text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $f$
BEGIN
  IF p_dogrulayici IS NULL OR p_dogrulayici !~ '^SCRAM-SHA-256\\$[0-9]{4,7}:[A-Za-z0-9+/=]{16,64}\\$[A-Za-z0-9+/=]{40,64}:[A-Za-z0-9+/=]{40,64}$' THEN
    RAISE EXCEPTION 'okuma_rolu_parola: gecersiz dogrulayici' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('ALTER ROLE %I WITH PASSWORD %L', ${lit(role)}, p_dogrulayici);
  EXECUTE format('COMMENT ON ROLE %I IS %L', ${lit(role)}, ${lit(READ_ONLY_STAMP_PREFIX)} || extract(epoch FROM clock_timestamp())::bigint);
  RETURN ${lit(role)};
END
$f$`,
    // Rol adı fonksiyon yorumunda: durum okuyucusu fonksiyonu ÇAĞIRMADAN rolü bulur.
    `COMMENT ON FUNCTION ${F} IS ${lit(role)}`,
    `REVOKE ALL ON FUNCTION ${F} FROM PUBLIC`,
    `GRANT EXECUTE ON FUNCTION ${F} TO ${id(appRole)}`,
  ];
}
