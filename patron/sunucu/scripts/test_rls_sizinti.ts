// =============================================================================
// RLS SIZINTI BEKÇİSİ — çok kiracılı tek DB'de kiracı yalıtımı DB DÜZEYİNDE (sözleşme §9.2–9.3).
// Ham `pg` bağlantısıyla (uygulama katmanı atlanarak) ölçer; kapı SQL'dedir, koda güvenilmez:
//   §1 şema: her tablo RLS ENABLE + FORCE + `tesis_yalitimi`; tablo kümesi ↔ CLOUD_TABLES ↔ migration
//      listesi birebir; rol yetkileri ↔ db-grants.ts BİREBİR; iki rol NOSUPERUSER NOBYPASSRLS.
//   §2 `app.tesis_id` AYARSIZ bağlantı → HATA (sıfır satır) · SIFIRLANMIŞ (önceki tx SET LOCAL) → HATA.
//   §3 tesis A kapsamında B'nin satırı görünmez (liste, kimlikle doğrudan, projeksiyon) · WITH CHECK:
//      A kapsamında B'ye yazılamaz · ön-kiracı arama yalnız TEK anahtarlı satırı açar.
//   §4 alan izni (RESTRICTIVE): izinsiz alt satır (`siparis.finans`) doğrudan SQL'le de 0 satır.
//   §5 rol ayrımı: uygulama rolü projeksiyona YAZAMAZ; eşitleme rolü hesap tablosunu OKUYAMAZ.
//   §6 kapsam yardımcısı: sıfır UUID / biçimsiz tesis / `*` projeksiyon REDDEDİLİR.
//   §7 açılış kapısı: RLS'i atlayabilen rol (göç rolü = süper kullanıcı) ile sunucu KALKMAZ.
// Koşum: npx tsx scripts/test_rls_sizinti.ts   (kendi *_test DB'si; roller her koşumda hizalanır)
// =============================================================================
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { APP_GRANTS, CLOUD_TABLES, SYNC_GRANTS } from "../src/lib/db-grants";
import { NO_TENANT, withTesis } from "../src/lib/tenant";
import { PATRON_KOKU, hesapKur, imzali, kontrol, ortamKur, paket, girdi, sonuc, temizleTesis, tesisKur, type Ortam } from "./lib/test-ortam";

async function istemci(url: string): Promise<Client> {
  const c = new Client({ connectionString: url, options: "-c timezone=UTC" });
  await c.connect();
  return c;
}

/** Sorgu HATA verdi mi (satır dönmedi) — fail-closed kanıtı. */
async function hataVerir(c: Client, sql: string, params: unknown[] = []): Promise<{ hata: boolean; mesaj: string; satir: number }> {
  try {
    const r = await c.query(sql, params);
    return { hata: false, mesaj: "", satir: r.rowCount ?? 0 };
  } catch (err) {
    return { hata: true, mesaj: (err as Error).message, satir: 0 };
  }
}

async function kapsamda<T>(c: Client, ayar: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    for (const [k, v] of Object.entries(ayar)) await c.query("SELECT set_config($1, $2, true)", [k, v]);
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

async function semaBolumu(o: Ortam): Promise<void> {
  console.log("\n§1 şema: RLS + FORCE + politika + yetkiler");
  const goc = await istemci(process.env.GOC_DATABASE_URL!);
  try {
    const t = await goc.query<{ relname: string; rls: boolean; force: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations' ORDER BY 1`,
    );
    const tables = t.rows.map((r) => r.relname);
    kontrol("§1a DB tablo kümesi = CLOUD_TABLES", JSON.stringify(tables) === JSON.stringify([...CLOUD_TABLES].sort()), tables.length + " tablo");
    const eksik = t.rows.filter((r) => !r.rls || !r.force).map((r) => r.relname);
    kontrol("§1b her tabloda RLS ENABLE + FORCE", eksik.length === 0, eksik.join(",") || "hepsi");
    const pol = await goc.query<{ tablename: string }>(`SELECT tablename FROM pg_policies WHERE policyname = 'tesis_yalitimi'`);
    const polSet = new Set(pol.rows.map((r) => r.tablename));
    kontrol("§1c her tabloda tesis_yalitimi politikası", tables.every((x) => polSet.has(x)));
    const mig = readFileSync(path.join(PATRON_KOKU, "prisma/migrations/20260929200000_ilk_sema/migration.sql"), "utf8");
    const dizi = /FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]/.exec(mig)?.[1] ?? "";
    const migTables = [...dizi.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    kontrol("§1d migration RLS listesi = CLOUD_TABLES", JSON.stringify(migTables) === JSON.stringify([...CLOUD_TABLES].sort()));
    for (const [label, url, want] of [
      ["uygulama", o.ctx.config.DATABASE_URL, APP_GRANTS],
      ["eşitleme", o.ctx.config.ESITLEME_DATABASE_URL, SYNC_GRANTS],
    ] as const) {
      const role = decodeURIComponent(new URL(url).username);
      const g = await goc.query<{ table_name: string; privilege_type: string }>(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = $1 AND table_schema = 'public'`,
        [role],
      );
      const got = new Map<string, string[]>();
      for (const r of g.rows) got.set(r.table_name, [...(got.get(r.table_name) ?? []), r.privilege_type].sort());
      const wantMap = new Map(Object.entries(want).map(([k, v]) => [k, [...v].sort()]));
      const same = got.size === wantMap.size && [...wantMap].every(([k, v]) => JSON.stringify(got.get(k)) === JSON.stringify(v));
      kontrol(`§1e ${label} rolü yetkileri = db-grants.ts (birebir)`, same, [...got].map(([k, v]) => `${k}:${v.join("/")}`).join(" ").slice(0, 200));
      const r = await goc.query<{ rolsuper: boolean; rolbypassrls: boolean }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1", [role]);
      kontrol(`§1f ${label} rolü NOSUPERUSER NOBYPASSRLS`, r.rows[0]?.rolsuper === false && r.rows[0]?.rolbypassrls === false);
    }
  } finally {
    await goc.end();
  }
}

async function ayarsizBolumu(o: Ortam): Promise<void> {
  console.log("\n§2 app.tesis_id ayarsız/sıfırlanmış → HATA, sıfır satır");
  const c = await istemci(o.ctx.config.DATABASE_URL);
  try {
    let hepsiHata = true;
    for (const t of ["accounts", "projection_rows", "inbox_messages", "facilities", "installations"]) {
      const r = await hataVerir(c, `SELECT * FROM ${t} LIMIT 5`);
      if (!r.hata) hepsiHata = false;
    }
    const ilk = await hataVerir(c, "SELECT count(*) FROM accounts");
    kontrol("§2a hiç ayarlanmamış oturum: 5 tabloda sorgu HATA (satır dönmez)", hepsiHata && ilk.hata, ilk.mesaj.slice(0, 80));
    await kapsamda(c, { "app.tesis_id": NO_TENANT }, async () => undefined);
    const sonra = await hataVerir(c, "SELECT count(*) FROM accounts");
    kontrol("§2b önceki tx'te SET LOCAL → tx sonrası değer boş → HATA", sonra.hata && /uuid/i.test(sonra.mesaj), sonra.mesaj.slice(0, 80));
    const nil = await kapsamda(c, { "app.tesis_id": NO_TENANT, "app.projeksiyonlar": "siparis" }, () => c.query("SELECT count(*)::int AS n FROM projection_rows"));
    kontrol("§2c sıfır UUID kapsamı (kiracısız kip) → 0 satır", nil.rows[0]?.n === 0);
  } finally {
    await c.end();
  }
}

async function capraz(o: Ortam, a: { tesisId: string; hesap: string; eposta: string }, b: { tesisId: string; hesap: string }): Promise<void> {
  console.log("\n§3 tesis A kapsamında B görünmez · WITH CHECK · ön-kiracı arama");
  const c = await istemci(o.ctx.config.DATABASE_URL);
  try {
    const ayarA = { "app.tesis_id": a.tesisId, "app.projeksiyonlar": "siparis,siparis.finans" };
    const hesaplar = await kapsamda(c, ayarA, () => c.query<{ tesis_id: string }>("SELECT tesis_id FROM accounts"));
    kontrol("§3a A kapsamında hesap listesi yalnız A", hesaplar.rows.length > 0 && hesaplar.rows.every((r) => r.tesis_id === a.tesisId), `${hesaplar.rows.length} satır`);
    const dogrudan = await kapsamda(c, ayarA, () => c.query("SELECT * FROM accounts WHERE id = $1", [b.hesap]));
    kontrol("§3b B'nin hesabı kimlikle doğrudan istense de 0 satır", dogrudan.rowCount === 0);
    const proj = await kapsamda(c, ayarA, () => c.query<{ tesis_id: string }>("SELECT tesis_id FROM projection_rows WHERE projection = 'siparis'"));
    kontrol("§3c projeksiyon: A kapsamında yalnız A'nın siparişi (B'ninki görünmez)", proj.rows.length === 1 && proj.rows[0]!.tesis_id === a.tesisId, `${proj.rows.length} satır`);
    const yaz = await kapsamda(c, ayarA, () =>
      hataVerir(c, "INSERT INTO account_audit (id, tesis_id, actor, event, entity) VALUES (gen_random_uuid(), $1, 'bekci', 'X', 'Y')", [b.tesisId]),
    );
    kontrol("§3d WITH CHECK: A kapsamında B'ye yazma HATA", yaz.hata && /row-level security/i.test(yaz.mesaj), yaz.mesaj.slice(0, 80));
    const guncelle = await kapsamda(c, ayarA, () => c.query("UPDATE accounts SET name = 'ele gecirildi' WHERE id = $1", [b.hesap]));
    kontrol("§3e A kapsamında B'nin hesabını güncelleme 0 satır", guncelle.rowCount === 0);
    const arama = await kapsamda(c, { "app.tesis_id": NO_TENANT, "app.giris_eposta": a.eposta }, () => c.query("SELECT id FROM accounts"));
    kontrol("§3f giriş araması yalnız o e-postanın TEK satırını açar", arama.rowCount === 1 && arama.rows[0].id === a.hesap);
    const aramaYan = await kapsamda(c, { "app.tesis_id": NO_TENANT, "app.giris_eposta": a.eposta, "app.projeksiyonlar": "siparis" }, () =>
      c.query("SELECT count(*)::int AS n FROM projection_rows"),
    );
    kontrol("§3g arama kipi başka tabloyu AÇMAZ (projeksiyon 0)", aramaYan.rows[0]?.n === 0);
  } finally {
    await c.end();
  }
}

async function alanIzni(o: Ortam, a: { tesisId: string }): Promise<void> {
  console.log("\n§4 alan izni (RESTRICTIVE): izinsiz alt satır doğrudan SQL'le de 0");
  const c = await istemci(o.ctx.config.DATABASE_URL);
  try {
    const n = async (liste: string, proj: string) =>
      (await kapsamda(c, { "app.tesis_id": a.tesisId, "app.projeksiyonlar": liste }, () => c.query<{ n: number }>("SELECT count(*)::int AS n FROM projection_rows WHERE projection = $1", [proj]))).rows[0]!.n;
    kontrol("§4a izinli (siparis,siparis.finans) → finans satırı 1", (await n("siparis,siparis.finans", "siparis.finans")) === 1);
    kontrol("§4b yalnız siparis izni → siparis.finans 0 satır", (await n("siparis", "siparis.finans")) === 0);
    kontrol("§4c yalnız siparis izni → siparis 1 satır", (await n("siparis", "siparis")) === 1);
    const bos = await kapsamda(c, { "app.tesis_id": a.tesisId, "app.projeksiyonlar": "" }, () => c.query<{ n: number }>("SELECT count(*)::int AS n FROM projection_rows"));
    kontrol("§4d boş projeksiyon listesi → 0 satır", bos.rows[0]!.n === 0);
  } finally {
    await c.end();
  }
}

async function rolAyrimi(o: Ortam, a: { tesisId: string }): Promise<void> {
  console.log("\n§5 rol ayrımı");
  const app = await istemci(o.ctx.config.DATABASE_URL);
  const sync = await istemci(o.ctx.config.ESITLEME_DATABASE_URL);
  try {
    const yaz = await kapsamda(app, { "app.tesis_id": a.tesisId, "app.projeksiyonlar": "siparis" }, () =>
      hataVerir(app, "INSERT INTO projection_rows (tesis_id, projection, record_id, data, version_at, sort_at) VALUES ($1, 'siparis', gen_random_uuid(), '{}', now(), now())", [a.tesisId]),
    );
    kontrol("§5a uygulama rolü projeksiyona YAZAMAZ (permission denied)", yaz.hata && /permission denied/i.test(yaz.mesaj), yaz.mesaj.slice(0, 60));
    const oku = await kapsamda(sync, { "app.tesis_id": a.tesisId }, () => hataVerir(sync, "SELECT * FROM accounts"));
    kontrol("§5b eşitleme rolü hesap tablosunu OKUYAMAZ", oku.hata && /permission denied/i.test(oku.mesaj), oku.mesaj.slice(0, 60));
    const oturum = await kapsamda(sync, { "app.tesis_id": a.tesisId }, () => hataVerir(sync, "SELECT * FROM sessions"));
    kontrol("§5c eşitleme rolü oturum tablosunu OKUYAMAZ", oturum.hata && /permission denied/i.test(oturum.mesaj));
  } finally {
    await app.end();
    await sync.end();
  }
}

async function yardimci(o: Ortam, a: { tesisId: string }): Promise<void> {
  console.log("\n§6 kapsam yardımcısı reddeder");
  const red = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return false;
    } catch {
      return true;
    }
  };
  kontrol("§6a sıfır UUID ile withTesis RED", await red(() => withTesis(o.ctx.app, { tesisId: NO_TENANT }, async () => 1)));
  kontrol("§6b biçimsiz tesis RED", await red(() => withTesis(o.ctx.app, { tesisId: "x' OR 1=1 --" }, async () => 1)));
  kontrol("§6c '*' projeksiyon RED", await red(() => withTesis(o.ctx.app, { tesisId: a.tesisId, projections: ["*"] }, async () => 1)));
  kontrol("§6d kapsamsız Prisma sorgusu (uygulama rolü) HATA", await red(() => o.ctx.app.account.findMany({ take: 1 })));
  const ok = await withTesis(o.ctx.app, { tesisId: a.tesisId }, (tx) => tx.account.count());
  kontrol("§6e kapsamlı sorgu çalışır", ok >= 1, `${ok} hesap`);
}

function acilis(url: string): Promise<{ kod: number | null; cikti: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd: PATRON_KOKU,
      env: { ...process.env, DATABASE_URL: url, PORT: "0", PATRON_ERISIM_GUNLUGU: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let cikti = "";
    p.stdout.on("data", (d: Buffer) => {
      cikti += d.toString();
      if (cikti.includes("PATRON_DINLIYOR")) p.kill("SIGTERM");
    });
    p.stderr.on("data", (d: Buffer) => (cikti += d.toString()));
    const zaman = setTimeout(() => p.kill("SIGKILL"), 30_000);
    p.on("exit", (kod) => {
      clearTimeout(zaman);
      resolve({ kod, cikti });
    });
  });
}

async function acilisKapisi(o: Ortam): Promise<void> {
  console.log("\n§7 açılış kapısı");
  const kotu = await acilis(process.env.GOC_DATABASE_URL!);
  kontrol("§7a RLS'i atlayabilen rol (göç = süper kullanıcı) ile sunucu KALKMAZ", kotu.kod === 1 && /RLS'i atlayabiliyor/.test(kotu.cikti), kotu.cikti.trim().split("\n").pop()?.slice(0, 100));
  const iyi = await acilis(o.ctx.config.DATABASE_URL);
  kontrol("§7b çalışma rolüyle sunucu kalkar", /PATRON_DINLIYOR/.test(iyi.cikti), iyi.cikti.trim().split("\n")[0]?.slice(0, 80));
}

async function main(): Promise<void> {
  const o = await ortamKur();
  const kA = await tesisKur(o);
  const kB = await tesisKur(o);
  try {
    const hA = await hesapKur(o, kA.tesisId, ["bulut:siparis:oku"]);
    const hB = await hesapKur(o, kB.tesisId, ["bulut:siparis:oku"]);
    const ufuk = new Date(o.saat.simdi() - 60_000);
    for (const k of [kA, kB]) {
      const id = randomUUID();
      const p = paket(k, {
        ufuk,
        kayitlar: [
          girdi("siparis", { yaz: [{ id, siparisNo: `S-${k.tesisId.slice(0, 4)}`, durum: "ACIK" }], yeni: { t: ufuk.toISOString(), k: "000000000001" } }),
          girdi("siparis.finans", { yaz: [{ id, tutar: "100.00" }], yeni: { t: ufuk.toISOString(), k: "000000000001" } }),
        ],
      });
      const r = await imzali(o, k, "/v1/esitle", { govde: p });
      if (r.status !== 200) throw new Error(`fikstür paketi: ${r.status} ${JSON.stringify(r.json)}`);
    }
    await semaBolumu(o);
    await ayarsizBolumu(o);
    await capraz(o, { tesisId: kA.tesisId, hesap: hA.accountId, eposta: hA.eposta }, { tesisId: kB.tesisId, hesap: hB.accountId });
    await alanIzni(o, kA);
    await rolAyrimi(o, kA);
    await yardimci(o, kA);
    await acilisKapisi(o);
  } finally {
    await temizleTesis(o, kA.tesisId);
    await temizleTesis(o, kB.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
