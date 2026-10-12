#!/usr/bin/env node
// =============================================================================
// BEKÇİ — test DB aracı (scripts/test-db.mjs) yalnız kendi ad uzayını siler · zero-dep
// =============================================================================
//   §1 saf kararlar (DB'siz): ad kapısı · klon kaynağı (rolls>0 / ölçülemedi RED) ·
//      silme kararı (kayıtsız · başka ağaç · .env hedefi · bağlı oturum) · yorum biçimi
//   §2 CLI kapısı DB'ye dokunmadan reddeder (olmayan konteynerle: 2 değil 1 döner)
//   §3 gerçek DB (yerel Docker PG): geçici `tekserp_tdbs<rnd>*_test` DB'leri açar/siler;
//      fabrika/postgres/template/desen dışı reddi, rolls>0 kaynaktan klon reddi,
//      bağlı oturumda silmeme, başka ağaç/.env hedefi reddi, kayıtsız DB'nin bayrak istemesi;
//      komşu DB kümesinin DEĞİŞMEDİĞİ ölçülür.
//
//   node scripts/test_test_db_araci.mjs           # §1 + §2 + §3 (konteyner yoksa 2 = ÖLÇÜLEMEDİ)
//   node scripts/test_test_db_araci.mjs --dbsiz   # §1 + §2 (CI) — §3 ⏭ beyanlı
//   node scripts/test_test_db_araci.mjs --sonda   # kalıcı negatif sondalar: bozulmuş kararlarda §1 KIRMIZI mı
// Çıkış: 0 yeşil · 1 kırmızı · 2 ölçülemedi.
// =============================================================================
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(KOK, "scripts", "lib", "test-db.mjs");
const CLI = join(KOK, "scripts", "test-db.mjs");
const KONTEYNER = process.env.TEKSERP_TEST_DB_KONTEYNER || "tekserp-local-db";
const KULLANICI = process.env.TEKSERP_TEST_DB_KULLANICI || "tekserp";
const argv = new Set(process.argv.slice(2));

let pass = 0;
let fail = 0;
function check(label, ok, detay = "") {
  if (ok) { pass++; console.log(`✅ ${label}`); } else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

// ── §1 saf kararlar — `--sonda` aynı listeyi bozulmuş kopyalara karşı koşar ──
function safKontroller(L) {
  const k = [];
  const t = (label, ok) => k.push({ label, ok: Boolean(ok) });
  t("§1a geçerli ad kabul: tekserp_ab12_test", L.adHatasi("tekserp_ab12_test") === null);
  for (const ad of ["tekserp_fabrika_0923", "tekserp_fabrika0923_test", "tekserp_fabrikakopya_test", "postgres", "template0", "template1"]) {
    t(`§1b korunan ad RED: ${ad}`, /korunan/.test(L.adHatasi(ad) ?? ""));
  }
  for (const ad of ["tekserp_test", "tekserp_a_b_test", "Tekserp_x_test", "tekserp_X_test", "sat_x_test", "tekserp_x_test2",
    "tekserp_x_test\n", 'tekserp_x_test"; select 1; --', "x_tekserp_x_test", "", undefined]) {
    t(`§1c desen dışı RED: ${JSON.stringify(ad)}`, L.adHatasi(ad) !== null);
  }
  const kk = (o) => L.klonKaynagiKarari({ kaynak: "tekserp_sablon_test", varMi: true, rolls: 0, bagliOturum: 0, ...o });
  t("§1d temiz kaynak (rolls=0) klonlanır", kk({}).izin);
  t("§1d boş şema kaynak (rolls tablosu yok) klonlanır", kk({ rolls: "tablo-yok" }).izin);
  t("§1e rolls=1 kaynak RED", !kk({ rolls: 1 }).izin);
  t("§1e rolls=8381 kaynak RED (`_test` adlı fabrika kopyası)", !kk({ rolls: 8381 }).izin);
  t("§1e rolls ÖLÇÜLEMEDİ kaynak RED (fail-closed)", !kk({ rolls: null }).izin);
  t("§1e bağlı oturumlu kaynak RED", !kk({ bagliOturum: 1 }).izin);
  t("§1e olmayan kaynak RED", !kk({ varMi: false }).izin);
  for (const kaynak of ["tekserp_fabrika_0923", "postgres", "template1", "tekserp_a_b_test"]) {
    t(`§1e kaynak adı RED: ${kaynak}`, !kk({ kaynak }).izin);
  }
  const kayit = { ac: "2026-10-12T00:00:00Z", agac: "/x" };
  const sk = (o) => L.silmeKarari({ ad: "tekserp_ab12_test", varMi: true, kayit, kayitAgaciBaska: false, envReferanslari: [], bagliOturum: 0, bayraklar: {}, ...o });
  const hepsi = { kayitsiz: true, baskaAgac: true };
  t("§1f kayıtlı, kendi ağacı, bağlantısız → silinir", sk({}).izin);
  t("§1f kayıtsız + bayraksız RED", !sk({ kayit: null }).izin);
  t("§1f kayıtsız + --kayitsiz → silinir", sk({ kayit: null, bayraklar: { kayitsiz: true } }).izin);
  t("§1f başka ağaç + bayraksız RED", !sk({ kayitAgaciBaska: true }).izin);
  t("§1f başka ağaç + --baska-agac → silinir", sk({ kayitAgaciBaska: true, bayraklar: { baskaAgac: true } }).izin);
  t("§1g başka canlı ağacın .env hedefi RED (bayraklar AŞAMAZ)", !sk({ envReferanslari: ["/wt/x"], bayraklar: hepsi }).izin);
  t("§1g bağlı oturum RED (bayraklar AŞAMAZ)", !sk({ bagliOturum: 1, bayraklar: hepsi }).izin);
  t("§1g korunan ad RED (bayraklar AŞAMAZ)", !sk({ ad: "tekserp_fabrika_0923", bayraklar: hepsi }).izin);
  t("§1g postgres RED (bayraklar AŞAMAZ)", !sk({ ad: "postgres", bayraklar: hepsi }).izin);
  t("§1g olmayan DB → 'yok' (silme yok)", sk({ varMi: false }).yok === true && sk({ varMi: false }).izin === false);
  const y = L.yorumYaz({ ac: "2026-10-12T01:02:03Z", kim: "a|kim=b", agac: "/wt/x", dal: "d", sablon: "tekserp_s_test" });
  const o = L.yorumOku(y);
  t("§1h yorum gidiş-dönüş + `|`/`=` enjeksiyonu ayıklanır", o?.agac === "/wt/x" && o?.kim === "a_kim_b" && o?.sablon === "tekserp_s_test");
  t("§1h yabancı yorum kayıt SAYILMAZ", L.yorumOku("default administrative connection database") === null && L.yorumOku("") === null);
  t("§1i .env DATABASE_URL ayrıştırma", L.envDbAdi("PORT=4001\nDATABASE_URL='postgresql://u:p@localhost:55433/tekserp_ab12_test?schema=public'\n") === "tekserp_ab12_test"
    && L.envDbAdi('export DATABASE_URL="postgresql://u@h/x_test"') === "x_test" && L.envDbAdi("# yok") === null);
  t("§1j tanımlayıcı çift tırnağı kaçırır", L.tanimlayici('a"b') === '"a""b"' && L.literal("a'b") === "'a''b'");
  return k;
}

async function sonda() {
  const kaynak = readFileSync(LIB, "utf8");
  const dizin = mkdtempSync(join(tmpdir(), "tdb-sonda-"));
  const mutasyonlar = [
    ["ad deseni gevşek (/_test$/)", "export const AD_DESENI = /^tekserp_[a-z0-9]+_test$/;", "export const AD_DESENI = /_test$/;"],
    ["korunan aile listesi boş", "const KORUNAN = [/^tekserp_fabrika/, /^postgres$/, /^template/];", "const KORUNAN = [];"],
    ["klonda rolls>0 kabul", 'else if (rolls !== "tablo-yok"', 'else if (false && rolls !== "tablo-yok"'],
    ["klonda ölçülemeyen rolls 0 sayılır", "if (rolls === null || rolls === undefined) sebepler.push", "if (false) sebepler.push",
      "!(Number.isInteger(rolls) && rolls === 0)", "!((rolls ?? 0) === 0)"],
    ["silmede bağlı oturum yok sayılır", "if (bagliOturum > 0) sebepler.push(`'${ad}' üzerinde", "if (false) sebepler.push(`'${ad}' üzerinde"],
    ["silmede .env hedefi yok sayılır", "if (envReferanslari?.length) sebepler", "if (false) sebepler"],
    ["silmede kayıt şartı yok", "if (!kayit && !bayraklar?.kayitsiz)", "if (false)"],
  ];
  let i = 0;
  for (const [ad, ...ciftler] of mutasyonlar) {
    let bozuk = kaynak;
    let bayat = false;
    for (let j = 0; j < ciftler.length; j += 2) {
      if (!bozuk.includes(ciftler[j])) bayat = true;
      bozuk = bozuk.replace(ciftler[j], ciftler[j + 1]);
    }
    if (bayat) { check(`sonda '${ad}' UYGULANDI`, false, "metin bulunamadı — sonda bayat"); continue; }
    const yol = join(dizin, `m${i++}.mjs`);
    writeFileSync(yol, bozuk);
    const L = await import(pathToFileURL(yol).href);
    const kirmizi = safKontroller(L).filter((x) => !x.ok).map((x) => x.label);
    check(`sonda '${ad}' → §1 KIRMIZI (${kirmizi.length})`, kirmizi.length > 0);
  }
  const L = await import(pathToFileURL(LIB).href);
  check("pozitif sonda: bozulmamış çekirdekte §1 yeşil", safKontroller(L).every((x) => x.ok));
  rmSync(dizin, { recursive: true, force: true });
}

function cli(args, { cwd = KOK, env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { kod: r.status, cikti: `${r.stdout}${r.stderr}` };
}

function psql(db, sql) {
  const r = spawnSync("docker", ["exec", "-i", KONTEYNER, "psql", "-X", "-U", KULLANICI, "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt"], { input: sql, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
const varMi = (ad) => psql("postgres", `select count(*) from pg_database where datname = '${ad}'`).out === "1";
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

async function dbBolumu() {
  if (!psql("postgres", "select 1").ok) {
    console.error(`⏸  ÖLÇÜLEMEDİ: ${KONTEYNER} konteynerine ulaşılamadı (§3 için yerel Docker PG gerekir; CI'da --dbsiz)`);
    process.exit(2);
  }
  const rnd = Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, "x");
  const ad = (son) => `tekserp_tdbs${rnd}${son}_test`;
  const [A, S, K, U, F] = ["a", "s", "k", "u", "f"].map(ad);
  const benimkiler = [A, S, K, U, F];
  const komsular = () => psql("postgres", `select string_agg(datname, ',' order by datname) from pg_database where datname not like 'tekserp\\_tdbs${rnd}%'`).out;
  const komsuOnce = komsular();
  const gecici = mkdtempSync(join(tmpdir(), "tdb-bekci-"));
  const env = { TEKSERP_TEST_DB_KAYIT: join(gecici, "kayit.jsonl") };
  let uyuyan = null;
  try {
    let r = cli(["ac", A], { env });
    check("§3a ac → 0 ve DB var", r.kod === 0 && varMi(A), r.cikti);
    const yorum = psql("postgres", `select shobj_description(oid, 'pg_database') from pg_database where datname = '${A}'`).out;
    check("§3a açılış kaydı DB yorumunda (ağaç bu worktree)", yorum.startsWith("test-db.mjs|") && yorum.includes(`agac=${KOK}`), yorum);
    check("§3a açılış kaydı jsonl'de", readFileSync(env.TEKSERP_TEST_DB_KAYIT, "utf8").includes(`"olay":"ac","ad":"${A}"`));
    check("§3b var olan ada ikinci ac RED", cli(["ac", A], { env }).kod === 1);
    r = cli(["liste"], { env });
    check("§3c liste yeni DB'yi kayıtlı gösterir", r.kod === 0 && new RegExp(`${A}.*kayıt:`).test(r.cikti), r.cikti);

    for (const korunan of ["tekserp_fabrika_0923", "postgres", "template1", "tekserp_a_b_test"]) {
      r = cli(["sil", korunan, "--kayitsiz", "--baska-agac"], { env });
      check(`§3d sil ${korunan} RED (bayraklarla bile)`, r.kod === 1 && /korunan|biçim dışı/.test(r.cikti), r.cikti);
    }

    // Bağlı oturum: arka planda uyuyan bir oturum açılır; silme reddedilir, DB durur.
    uyuyan = spawn("docker", ["exec", KONTEYNER, "psql", "-X", "-U", KULLANICI, "-d", A, "-c", "select pg_sleep(60)"], { stdio: "ignore" });
    let n = 0;
    for (let i = 0; i < 50 && n === 0; i++) {
      await bekle(100);
      n = Number(psql("postgres", `select count(*) from pg_stat_activity where datname = '${A}'`).out);
    }
    r = cli(["sil", A], { env });
    check("§3e bağlı oturumda sil RED ve DB duruyor", n > 0 && r.kod === 1 && /bağlı oturum/.test(r.cikti) && varMi(A), `oturum ${n} · ${r.cikti}`);
    psql("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${A}'`);
    uyuyan.kill();
    uyuyan = null;
    for (let i = 0; i < 50 && Number(psql("postgres", `select count(*) from pg_stat_activity where datname = '${A}'`).out) > 0; i++) await bekle(100);

    r = cli(["sil", A], { env, cwd: gecici });
    check("§3f başka ağaçtan (git dışı cwd) sil RED", r.kod === 1 && /başka bir ağaçtan/.test(r.cikti) && varMi(A), r.cikti);

    const ekAgac = join(gecici, "komsu-agac");
    mkdirSync(join(ekAgac, "Teks-Erp"), { recursive: true });
    writeFileSync(join(ekAgac, "Teks-Erp", ".env"), `DATABASE_URL='postgresql://u:p@localhost:55433/${A}'\n`);
    r = cli(["sil", A, "--kayitsiz", "--baska-agac"], { env: { ...env, TEKSERP_TEST_DB_EK_AGACLAR: ekAgac } });
    check("§3g başka canlı ağacın .env hedefi RED (bayraklarla bile)", r.kod === 1 && /\.env/.test(r.cikti) && varMi(A), r.cikti);

    r = cli(["sil", A], { env });
    check("§3h kendi ağacından sil → 0 ve DB yok", r.kod === 0 && !varMi(A), r.cikti);
    check("§3h silme olayı jsonl'de", readFileSync(env.TEKSERP_TEST_DB_KAYIT, "utf8").includes(`"olay":"sil","ad":"${A}"`));
    check("§3h olmayan DB'yi sil → 0 (yapılacak bir şey yok)", cli(["sil", A], { env }).kod === 0);

    // Klon kaynağı: rolls > 0 RED, rolls = 0 kabul, korunan kaynak adları RED.
    check("§3i kaynak açıldı", cli(["ac", S], { env }).kod === 0);
    check("§3i kaynağa 1 top", psql(S, "create table rolls (id int); insert into rolls values (1);").ok);
    r = cli(["ac", K, "--sablon", S], { env });
    check("§3i rolls>0 kaynaktan klon RED ve hedef açılmadı", r.kod === 1 && /top taşıyor/.test(r.cikti) && !varMi(K), r.cikti);
    psql(S, "delete from rolls where id = 1;");
    r = cli(["ac", K, "--sablon", S], { env });
    check("§3j rolls=0 kaynaktan klon → 0 ve şablon yorumda", r.kod === 0 && varMi(K)
      && psql("postgres", `select shobj_description(oid, 'pg_database') from pg_database where datname = '${K}'`).out.includes(`sablon=${S}`), r.cikti);
    for (const kaynak of ["tekserp_fabrika_0923", "postgres", "template1"]) {
      r = cli(["ac", F, "--sablon", kaynak], { env });
      check(`§3k korunan kaynak '${kaynak}' RED ve hedef açılmadı`, r.kod === 1 && !varMi(F), r.cikti);
    }

    // Kayıtsız DB (araç dışında açılmış): bayraksız RED, --kayitsiz ile silinir.
    check("§3l kayıtsız DB araç dışında açıldı", psql("postgres", `CREATE DATABASE "${U}"`).ok);
    r = cli(["sil", U], { env });
    check("§3l kayıtsız DB bayraksız RED", r.kod === 1 && /kayıt yok/.test(r.cikti) && varMi(U), r.cikti);
    r = cli(["sil", U, "--kayitsiz"], { env });
    check("§3l kayıtsız DB --kayitsiz ile silinir", r.kod === 0 && !varMi(U), r.cikti);
    for (const x of [K, S]) check(`§3m temizlik: ${x} silindi`, cli(["sil", x], { env }).kod === 0 && !varMi(x));
  } finally {
    if (uyuyan) uyuyan.kill();
    for (const x of benimkiler) {
      if (!varMi(x)) continue;
      psql("postgres", `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${x}'`);
      const r = cli(["sil", x, "--kayitsiz", "--baska-agac"], { env });
      if (r.kod !== 0) console.error(`⚠️  geçici DB kaldı: ${x} — ${r.cikti}`);
    }
    rmSync(gecici, { recursive: true, force: true });
  }
  check("§3n komşu DB kümesi değişmedi (yalnız kendi geçici DB'lerine dokundu)", komsular() === komsuOnce);
}

console.log("test_test_db_araci — test DB aracı yalnız kendi ad uzayını siler\n");
if (argv.has("--sonda")) {
  await sonda();
} else {
  const L = await import(pathToFileURL(LIB).href);
  for (const x of safKontroller(L)) check(x.label, x.ok);
  // §2: korunan/desen dışı ad DB'ye gitmeden reddedilir — olmayan konteynerle 2 (ölçülemedi) değil 1 döner.
  const yok = { TEKSERP_TEST_DB_KONTEYNER: "tekserp-olmayan-konteyner-tdb" };
  for (const [ad, args] of [["sil fabrika", ["sil", "tekserp_fabrika_0923"]], ["sil postgres", ["sil", "postgres"]],
    ["ac desen dışı", ["ac", "tekserp_a_b_test"]], ["ac template", ["ac", "template1"]], ["tanınmayan seçenek", ["sil", "tekserp_ab_test", "--force"]]]) {
    const r = cli(args, { env: yok });
    check(`§2 ${ad} DB'ye dokunmadan RED (çıkış 1)`, r.kod === 1, `çıkış ${r.kod}: ${r.cikti}`);
  }
  check("§2 bilinmeyen komut RED", cli(["drop", "tekserp_ab_test"], { env: yok }).kod === 1);
  if (argv.has("--dbsiz")) console.log("⏭  §3 (gerçek DB) atlandı: --dbsiz (CI'da yerel Docker PG yok)");
  else await dbBolumu();
}
console.log(`\n${pass} geçti · ${fail} kaldı`);
process.exit(fail ? 1 : 0);
