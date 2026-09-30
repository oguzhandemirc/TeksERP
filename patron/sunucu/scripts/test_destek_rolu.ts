// =============================================================================
// DESTEK ROLÜ BEKÇİSİ (Ek-6/B §3.2) — ham `pg` bağlantısıyla (uygulama katmanı yok), gerçek destek rolüyle:
//   §1 rol + yetki: NOSUPERUSER NOBYPASSRLS, varsayılan NOLOGIN · hiçbir tabloda yazma yetkisi yok · okunabilir
//      tablo kümesi = SUPPORT_GRANTS = `destek_kapisi` politikalı tablolar (İKİ YÖNLÜ) · sır kolonu okunamaz ·
//      erişim kaydı + imha kaydı okunamaz · kapı fonksiyonları yalnız destek rolüne açık · bütün kullanıcı
//      şemalarında okunabilir İLİŞKİ (görünüm dahil — sahibinin yetkisiyle koşar, RLS'i atlayabilir) = beyan ·
//      ÇALIŞTIRILABİLİR fonksiyon (PUBLIC'ten gelen dahil) = SUPPORT_FUNCTIONS · SECURITY DEFINER'da search_path sabit
//   §2 RLS atlanamaz: izinsiz sorgu HATA · `app.tesis_id` elle yazılsa da 0 satır · izin açıkken başka tesise
//      geçilemez · başka oturum izni devralamaz · süresi dolan izin 0 satır · kapatınca HATA (fail-closed)
//   §3 salt okunur: yazma/silme/boşaltma ve kendi erişim kaydını okuma/değiştirme `permission denied`
//   §4 erişim kaydı: kim · tesis · talep · gerekçe · kapsam · bitiş · kapanış; hatalı açılış kayıt bırakmaz;
//      kayıt SİLİNEMEZ, kapanmış kayıt değiştirilemez (tablo sahibi dahil)
//   §5 Lisans Alan kendi tesisinin erişim kaydını dışa aktarımda görür, başka tesisinkini görmez
// Koşum: npx tsx scripts/test_destek_rolu.ts   (rol LOGIN'i yalnız koşum süresince açılır, `finally`de kapanır)
// =============================================================================
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { CLOUD_TABLES, SUPPORT_FUNCTIONS, SUPPORT_GRANTS, supportRoleName } from "../src/lib/db-grants";
import { withTesis } from "../src/lib/tenant";
import { hesapKur, girdi, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, type Ortam, type TestKurulumu } from "./lib/test-ortam";

const SIR_KOLONU = /^(password_hash|totp_secret_sealed|totp_last_step|invite_token_hash|token_hash|token)$/;

async function istemci(url: string): Promise<Client> {
  const c = new Client({ connectionString: url, options: "-c timezone=UTC" });
  await c.connect();
  return c;
}

async function dene(c: Client, sql: string, params: unknown[] = []): Promise<{ hata: string | null; satir: number; rows: Record<string, unknown>[] }> {
  try {
    const r = await c.query(sql, params);
    return { hata: null, satir: r.rowCount ?? 0, rows: r.rows as Record<string, unknown>[] };
  } catch (err) {
    return { hata: (err as Error).message, satir: 0, rows: [] };
  }
}

async function fikstur(o: Ortam, k: TestKurulumu, etiket: string): Promise<void> {
  const ufuk = new Date(o.saat.simdi() - 60_000);
  const w = { t: ufuk.toISOString(), k: "000000000001" };
  const kayitlar = [girdi("siparis", { yaz: [{ id: randomUUID(), siparisNo: `S-${etiket}` }, { id: randomUUID(), siparisNo: `S2-${etiket}` }], yeni: w })];
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk, kayitlar }) });
  if (r.status !== 200) throw new Error(`fikstür: ${r.status}`);
}

async function rolBolumu(goc: Client, rol: string, uygulamaRolu: string, esitlemeRolu: string): Promise<void> {
  console.log("\n§1 rol + yetki");
  const r = await goc.query<{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>("SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1", [rol]);
  kontrol("§1a rol var: NOSUPERUSER NOBYPASSRLS, varsayılan NOLOGIN (giriş runbook'la açılır)", r.rows[0]?.rolsuper === false && r.rows[0].rolbypassrls === false && r.rows[0].rolcanlogin === false, JSON.stringify(r.rows[0]));
  const yazma = await goc.query<{ t: string; p: string }>(
    `SELECT t, p FROM unnest($1::text[]) t, unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege($2, t, p)`,
    [[...CLOUD_TABLES], rol],
  );
  const kolonYazma = await goc.query("SELECT 1 FROM information_schema.column_privileges WHERE grantee = $1 AND privilege_type <> 'SELECT'", [rol]);
  kontrol("§1b hiçbir tabloda/kolonda yazma yetkisi YOK (salt okunur)", yazma.rowCount === 0 && kolonYazma.rowCount === 0, yazma.rows.map((x) => `${x.t}:${x.p}`).join(",") || "temiz");
  const okunur = await goc.query<{ t: string }>("SELECT t FROM unnest($1::text[]) t WHERE has_any_column_privilege($2, t, 'SELECT') ORDER BY t", [[...CLOUD_TABLES], rol]);
  const politikali = await goc.query<{ tablename: string }>("SELECT tablename FROM pg_policies WHERE policyname = 'destek_kapisi' AND permissive = 'RESTRICTIVE' AND $1 = ANY(roles) ORDER BY tablename", [rol]);
  const beyan = Object.keys(SUPPORT_GRANTS).sort();
  kontrol("§1c okunabilir tablolar = SUPPORT_GRANTS = destek_kapisi politikalı tablolar (iki yönlü)", JSON.stringify(okunur.rows.map((x) => x.t)) === JSON.stringify(beyan) && JSON.stringify(politikali.rows.map((x) => x.tablename)) === JSON.stringify(beyan), `${okunur.rowCount}/${politikali.rowCount}/${beyan.length}`);
  const kolonlar = await goc.query<{ table_name: string; column_name: string }>("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [[...CLOUD_TABLES]]);
  const sizan = kolonlar.rows.filter((k) => SIR_KOLONU.test(k.column_name));
  const okunanSir: string[] = [];
  for (const k of sizan) {
    const p = await goc.query<{ ok: boolean }>("SELECT has_column_privilege($1, $2, $3, 'SELECT') AS ok", [rol, k.table_name, k.column_name]);
    if (p.rows[0]?.ok) okunanSir.push(`${k.table_name}.${k.column_name}`);
  }
  kontrol("§1d sır kolonları (parola · TOTP · davet/oturum özeti · push belirteci) destek rolüne KAPALI", sizan.length >= 6 && okunanSir.length === 0, okunanSir.join(",") || `${sizan.length} kolon kapalı`);
  const kayit = await goc.query<{ ok: boolean }>("SELECT has_any_column_privilege($1, 'support_access', 'SELECT') OR has_any_column_privilege($1, 'facility_destructions', 'SELECT') AS ok", [rol]);
  kontrol("§1e erişim kaydı ve imha kaydı destek rolüne KAPALI", kayit.rows[0]?.ok === false);
  const fn = await goc.query<{ f: string; pub: boolean; app: boolean; destek: boolean }>(
    `SELECT f, has_function_privilege('public', f, 'EXECUTE') AS pub, has_function_privilege($1, f, 'EXECUTE') AS app, has_function_privilege($2, f, 'EXECUTE') AS destek
       FROM unnest($3::text[]) f`,
    [uygulamaRolu, rol, [...SUPPORT_FUNCTIONS]],
  );
  kontrol("§1f kapı fonksiyonları yalnız destek rolüne açık (PUBLIC ve uygulama rolü çalıştıramaz)", fn.rows.length === 3 && fn.rows.every((x) => !x.pub && !x.app && x.destek));

  // Kullanıcı şemaları (sistem kataloğu dışı HER şema): tablo listesinin dışında kalan ilişki ve fonksiyon da ölçülür.
  const KULLANICI_SEMASI = "n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'";
  const iliski = await goc.query<{ ad: string }>(
    `SELECT n.nspname || '.' || c.relname || ' (' || c.relkind::text || ')' AS ad FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${KULLANICI_SEMASI} AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege($1, c.oid, 'SELECT') ELSE has_any_column_privilege($1, c.oid, 'SELECT') END
      ORDER BY 1`,
    [rol],
  );
  const beyanIliski = beyan.map((t) => `public.${t} (r)`).sort();
  const fazlaIliski = iliski.rows.map((x) => x.ad).filter((x) => !beyanIliski.includes(x));
  kontrol(
    "§1g ⭐ okunabilir İLİŞKİLER (görünüm · somut görünüm · yabancı tablo · dizi dahil, bütün kullanıcı şemaları) = SUPPORT_GRANTS tabloları — beyansız ilişki KIRMIZI",
    JSON.stringify(iliski.rows.map((x) => x.ad)) === JSON.stringify(beyanIliski),
    fazlaIliski.length ? `beyansız: ${fazlaIliski.join(", ")}` : `${iliski.rowCount} ilişki`,
  );
  const calisir = await goc.query<{ f: string }>(
    `SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${KULLANICI_SEMASI} AND has_function_privilege($1, p.oid, 'EXECUTE') ORDER BY 1`,
    [rol],
  );
  const beyanFn = [...SUPPORT_FUNCTIONS].sort();
  const fazlaFn = calisir.rows.map((x) => x.f).filter((x) => !beyanFn.includes(x));
  kontrol(
    "§1h ⭐ destek rolünün ÇALIŞTIRABİLDİĞİ fonksiyonlar (PUBLIC'ten gelen dahil) = SUPPORT_FUNCTIONS (iki yönlü)",
    JSON.stringify(calisir.rows.map((x) => x.f)) === JSON.stringify(beyanFn),
    fazlaFn.length ? `beyansız: ${fazlaFn.join(", ")}` : `${calisir.rowCount}/${beyanFn.length}`,
  );
  const tanimci = await goc.query<{ f: string; yol: string | null }>(
    `SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS f,
            (SELECT substr(x, length('search_path=') + 1) FROM unnest(p.proconfig) x WHERE x LIKE 'search\\_path=%') AS yol
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE ${KULLANICI_SEMASI} AND p.prosecdef ORDER BY 1`,
  );
  const yazilabilir = await goc.query<{ s: string }>(
    `SELECT n.nspname AS s FROM pg_namespace n
      WHERE has_schema_privilege('public', n.oid, 'CREATE') OR EXISTS (SELECT 1 FROM unnest($1::text[]) r WHERE has_schema_privilege(r, n.oid, 'CREATE'))`,
    [[rol, uygulamaRolu, esitlemeRolu]],
  );
  const acikSema = new Set(yazilabilir.rows.map((x) => x.s));
  const gevsek = tanimci.rows.filter((x) => {
    const yol = (x.yol ?? "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    return yol.length === 0 || yol.at(-1) !== "pg_temp" || yol.some((s) => s === "$user" || acikSema.has(s));
  });
  kontrol(
    "§1i SECURITY DEFINER fonksiyonların search_path'i SABİT: tanımlı · `pg_temp` sonda · çağıranın/PUBLIC'in yazabildiği şema yok",
    (tanimci.rowCount ?? 0) >= 3 && gevsek.length === 0,
    gevsek.map((x) => `${x.f} → ${x.yol ?? "sabit değil"}`).join(" · ") || `${tanimci.rowCount} tanımcı fonksiyon`,
  );
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const a = await tesisKur(o);
  const b = await tesisKur(o);
  const db = decodeURIComponent(new URL(process.env.GOC_DATABASE_URL!).pathname.slice(1));
  const rol = supportRoleName(db);
  const parola = randomBytes(24).toString("hex");
  const goc = await istemci(process.env.GOC_DATABASE_URL!);
  const destekUrl = (() => {
    const u = new URL(process.env.GOC_DATABASE_URL!);
    u.username = rol;
    u.password = parola;
    return u.toString();
  })();
  const ekler: Client[] = [];
  try {
    const hA = await hesapKur(o, a.tesisId, ["bulut:hesap:yonet", "bulut:siparis:oku"]);
    const hB = await hesapKur(o, b.tesisId, ["bulut:hesap:yonet"]);
    await fikstur(o, a, "A");
    await fikstur(o, b, "B");
    await rolBolumu(goc, rol, decodeURIComponent(new URL(o.ctx.config.DATABASE_URL).username), decodeURIComponent(new URL(o.ctx.config.ESITLEME_DATABASE_URL).username));

    await goc.query(`ALTER ROLE "${rol}" LOGIN PASSWORD '${parola}'`);
    const d = await istemci(destekUrl);
    ekler.push(d);

    console.log("\n§2 RLS atlanamaz");
    const izinsiz = await dene(d, "SELECT count(*)::int AS n FROM projection_rows");
    kontrol("§2a izin açılmadan sorgu HATA (app.tesis_id yok)", izinsiz.hata !== null, izinsiz.hata?.slice(0, 60));
    await d.query("SELECT set_config('app.tesis_id', $1, false), set_config('app.projeksiyonlar', 'siparis', false)", [a.tesisId]);
    const sahte = await dene(d, "SELECT count(*)::int AS n FROM projection_rows");
    kontrol("§2b app.tesis_id ELLE yazılsa da 0 satır (kapı sunucu kaydında, GUC değil)", sahte.hata === null && sahte.rows[0]?.n === 0, JSON.stringify(sahte.rows[0] ?? sahte.hata));
    const kisa = await dene(d, "SELECT public.destek_ac($1, 'x', 'gerekçe yeterince uzun', 'kapsam', 30)", [a.tesisId]);
    const uzun = await dene(d, "SELECT public.destek_ac($1, 'DST-1', 'gerekçe yeterince uzun', 'kapsam', 999)", [a.tesisId]);
    kontrol("§2c talep no/süre kuralı: kısa talep ve 8 saati aşan süre RED", kisa.hata !== null && uzun.hata !== null);
    const ac = await dene(d, "SELECT public.destek_ac($1, 'DST-2026-0042', 'Eşitleme gecikmesi incelemesi (fabrika talebi)', 'projection_rows: siparis · sync_state', 60) AS id", [a.tesisId]);
    kontrol("§2d destek_ac izin + kayıt açar", ac.hata === null && typeof ac.rows[0]?.id === "string", ac.hata ?? "");
    const oku = await dene(d, "SELECT count(*)::int AS n FROM projection_rows WHERE projection = 'siparis'");
    const hesaplar = await dene(d, "SELECT DISTINCT tesis_id FROM accounts");
    kontrol("§2e izinli tesisin satırları görünür (sipariş 2, hesaplar yalnız bu tesis)", oku.rows[0]?.n === 2 && hesaplar.rows.length === 1 && hesaplar.rows[0]!.tesis_id === a.tesisId, JSON.stringify({ oku: oku.rows[0], hesap: hesaplar.rows.length }));
    await d.query("SELECT set_config('app.tesis_id', $1, false)", [b.tesisId]);
    const atla = await dene(d, "SELECT count(*)::int AS n FROM projection_rows");
    kontrol("§2f izin açıkken app.tesis_id başka tesise çevrilirse 0 satır (tesis atlanamaz)", atla.rows[0]?.n === 0, JSON.stringify(atla.rows[0] ?? atla.hata));
    await d.query("SELECT set_config('app.tesis_id', $1, false)", [a.tesisId]);
    const ikinci = await istemci(destekUrl);
    ekler.push(ikinci);
    await ikinci.query("SELECT set_config('app.tesis_id', $1, false), set_config('app.projeksiyonlar', 'siparis', false)", [a.tesisId]);
    const devral = await dene(ikinci, "SELECT count(*)::int AS n FROM projection_rows");
    kontrol("§2g başka oturum (aynı rol) izni devralamaz → 0 satır", devral.rows[0]?.n === 0, JSON.stringify(devral.rows[0] ?? devral.hata));
    const sir = await dene(d, "SELECT password_hash FROM accounts");
    kontrol("§2h sır kolonu sorgusu permission denied", /permission denied/i.test(sir.hata ?? ""), sir.hata?.slice(0, 60));

    console.log("\n§3 salt okunur");
    const yazmalar = [
      ["INSERT account_audit", `INSERT INTO account_audit (id, tesis_id, actor, event, entity) VALUES (gen_random_uuid(), '${a.tesisId}', 'destek', 'X', 'Y')`],
      ["UPDATE accounts", "UPDATE accounts SET name = 'x'"],
      ["DELETE projection_rows", "DELETE FROM projection_rows"],
      ["TRUNCATE inbox_messages", "TRUNCATE inbox_messages"],
      ["SELECT support_access", "SELECT * FROM support_access"],
      ["UPDATE support_access", "UPDATE support_access SET closed_at = now(), close_reason = 'KAPATILDI'"],
    ] as const;
    const gecen: string[] = [];
    for (const [ad, sql] of yazmalar) if (!/permission denied/i.test((await dene(d, sql)).hata ?? "")) gecen.push(ad);
    kontrol("§3a yazma · silme · boşaltma · kendi erişim kaydını okuma/değiştirme: hepsi permission denied", gecen.length === 0, gecen.join(",") || `${yazmalar.length} deneme`);

    console.log("\n§4 erişim kaydı");
    const kayit = await withTesis(o.goc.prisma, { tesisId: a.tesisId }, (tx) => tx.supportAccess.findMany({ where: { tesisId: a.tesisId }, orderBy: { createdAt: "asc" } }));
    const k0 = kayit[0];
    kontrol("§4a hatalı açılışlar kayıt bırakmaz; tek kayıt: kim · talep · gerekçe · kapsam · 60 dk bitiş", kayit.length === 1 && k0?.dbUser === rol && k0.ticket === "DST-2026-0042" && k0.scope.startsWith("projection_rows") && k0.expiresAt.getTime() - k0.createdAt.getTime() === 3_600_000, JSON.stringify(kayit.map((x) => [x.dbUser, x.ticket])));
    const kapat = await dene(d, "SELECT public.destek_kapat() AS n");
    const sonra = await dene(d, "SELECT count(*)::int AS n FROM projection_rows");
    kontrol("§4b destek_kapat izni kapatır; sonraki sorgu HATA (fail-closed)", kapat.rows[0]?.n === 1 && sonra.hata !== null, sonra.hata?.slice(0, 50));
    const kapali = await withTesis(o.goc.prisma, { tesisId: a.tesisId }, (tx) => tx.supportAccess.findUnique({ where: { id: k0!.id } }));
    kontrol("§4c kayıtta kapanış damgası + nedeni", kapali?.closedAt !== null && kapali?.closeReason === "KAPATILDI");
    const sil = await dene(goc, "DELETE FROM support_access WHERE id = $1", [k0!.id]);
    const degis = await dene(goc, "UPDATE support_access SET ticket = 'DEGISTI' WHERE id = $1", [k0!.id]);
    const yenidenKapat = await dene(goc, "UPDATE support_access SET closed_at = now() WHERE id = $1", [k0!.id]);
    const bosalt = await dene(goc, "TRUNCATE support_access");
    kontrol("§4d kayıt SİLİNEMEZ · değiştirilemez · kapanmış kayıt yeniden kapanmaz · boşaltılamaz (tablo sahibi dahil)", [sil, degis, yenidenKapat, bosalt].every((x) => /silinemez|değiştirilemez/.test(x.hata ?? "")), [sil, degis, yenidenKapat, bosalt].map((x) => (x.hata ?? "GECTI").slice(0, 25)).join(" | "));
    await d.query("SELECT public.destek_ac($1, 'DST-2026-0043', 'Süre dolumu denemesi (bekçi)', 'projection_rows', 5)", [a.tesisId]);
    await goc.query("BEGIN");
    await goc.query("SET LOCAL session_replication_role = replica");
    await goc.query("UPDATE support_access SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE ticket = 'DST-2026-0043' AND tesis_id = $1", [a.tesisId]);
    await goc.query("COMMIT");
    const doldu = await dene(d, "SELECT count(*)::int AS n FROM projection_rows");
    kontrol("§4e süresi dolan izin 0 satır açar", doldu.rows[0]?.n === 0, JSON.stringify(doldu.rows[0] ?? doldu.hata));

    console.log("\n§5 Lisans Alan'ın dökümü");
    const disaA = await fetch(`${o.adres}/api/disa-aktar/destek-erisimi`, { headers: { Authorization: `Bearer ${hA.belirtec}` } }).then((r) => r.text());
    const disaB = await fetch(`${o.adres}/api/disa-aktar/destek-erisimi`, { headers: { Authorization: `Bearer ${hB.belirtec}` } }).then((r) => r.text());
    kontrol("§5a tesis yöneticisi kendi tesisinin erişim kaydını görür (kim · talep · gerekçe)", disaA.includes("DST-2026-0042") && disaA.includes(rol) && disaA.includes("Eşitleme gecikmesi"));
    kontrol("§5b başka tesisin dökümünde bu kayıt YOK", !disaB.includes("DST-2026-0042"));
  } finally {
    for (const c of ekler) await c.end().catch(() => undefined);
    await goc.query(`ALTER ROLE "${rol}" NOLOGIN PASSWORD NULL`).catch(() => undefined);
    await goc.end();
    await temizleTesis(o, a.tesisId);
    await temizleTesis(o, b.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
