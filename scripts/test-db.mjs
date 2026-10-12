#!/usr/bin/env node
// =============================================================================
// Oturum test DB'si aracı — açar, listeler, GÜVENLE siler (yerel Docker PG).
//
//   node scripts/test-db.mjs ac <ad> [--sablon <kaynak>] [--kim <metin>]
//   node scripts/test-db.mjs sil <ad> [--kayitsiz] [--baska-agac]
//   node scripts/test-db.mjs liste
//
// Ad yalnız `tekserp_[a-z0-9]+_test`; tekserp_fabrika_* · postgres · template* adla
// reddedilir. Kabuk kapısı (`bash-guard`) silme SQL'ini komut satırında yasaklar;
// araç onu kendi içinde kurar ve aynı korumayı ADLA + kayıtla + oturum ölçümüyle
// zorlar (gerekçe: docs/history/arsiv/2026-10.md, 2026-10-12 test DB aracı).
// Çıkış: 0 tamam · 1 reddedildi/başarısız · 2 ölçülemedi (konteyner yok).
// Ortam: TEKSERP_TEST_DB_KONTEYNER (tekserp-local-db) · TEKSERP_TEST_DB_KULLANICI (tekserp)
//        · TEKSERP_TEST_DB_KAYIT (~/.tekserp/test-db-kayit.jsonl)
//        · TEKSERP_TEST_DB_EK_AGACLAR (bekçi içindir: .env'i taranacak ek ağaçlar)
// =============================================================================
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adHatasi, envDbAdi, klonKaynagiKarari, literal, silmeKarari, tanimlayici, yorumOku, yorumYaz,
} from "./lib/test-db.mjs";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const KONTEYNER = process.env.TEKSERP_TEST_DB_KONTEYNER || "tekserp-local-db";
const KULLANICI = process.env.TEKSERP_TEST_DB_KULLANICI || "tekserp";
const KAYIT = process.env.TEKSERP_TEST_DB_KAYIT || join(homedir(), ".tekserp", "test-db-kayit.jsonl");

class Olculemedi extends Error {}

function psql(db, sql) {
  const r = spawnSync(
    "docker",
    ["exec", "-i", KONTEYNER, "psql", "-X", "-U", KULLANICI, "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "\t"],
    { input: sql, encoding: "utf8" },
  );
  if (r.error) throw new Olculemedi(`docker çalıştırılamadı: ${r.error.message}`);
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

/** postgres DB'sinde salt okuma; başarısızsa ÖLÇÜLEMEDİ (karar verilmez). */
function oku(sql) {
  const r = psql("postgres", sql);
  if (!r.ok) throw new Olculemedi(`PG okunamadı (${KONTEYNER}): ${r.err.split("\n")[0]}`);
  return r.out;
}

const dbVarMi = (ad) => oku(`select count(*) from pg_database where datname = ${literal(ad)}`) === "1";
const bagliOturum = (ad) => Number(oku(`select count(*) from pg_stat_activity where datname = ${literal(ad)}`));
const dbYorumu = (ad) => oku(`select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = ${literal(ad)}`);

/** rolls sayısı · "tablo-yok" · null (ölçülemedi). */
function rollsSay(ad) {
  const t = psql(ad, "select to_regclass('public.rolls') is not null");
  if (!t.ok) return null;
  if (t.out === "f") return "tablo-yok";
  const c = psql(ad, "select count(*) from public.rolls");
  return c.ok && /^\d+$/.test(c.out) ? Number(c.out) : null;
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
const gercekYol = (p) => { try { return realpathSync(p); } catch { return p; } };
const buAgac = () => { const t = git(["rev-parse", "--show-toplevel"], process.cwd()); return t ? gercekYol(t) : null; };

function kayitOlaylari() {
  if (!existsSync(KAYIT)) return [];
  return readFileSync(KAYIT, "utf8").split("\n").filter(Boolean).flatMap((s) => { try { return [JSON.parse(s)]; } catch { return []; } });
}
function kayitYaz(olay) {
  mkdirSync(dirname(KAYIT), { recursive: true });
  appendFileSync(KAYIT, JSON.stringify(olay) + "\n");
}
/** Açılış kaydı: önce DB yorumu (DB'yle yaşar), yoksa jsonl'deki son olay `ac` ise o. */
function kayitBul(ad, yorum) {
  const y = yorumOku(yorum);
  if (y) return y;
  const son = kayitOlaylari().filter((o) => o.ad === ad).at(-1);
  return son?.olay === "ac" ? son : null;
}

/** Bu DB'yi `Teks-Erp/.env`inde gösteren, BU ağaç dışındaki canlı ağaçlar. */
function envReferanslari(ad, mevcut) {
  const porc = git(["worktree", "list", "--porcelain"], KOK) ?? "";
  const agaclar = porc.split("\n").filter((s) => s.startsWith("worktree ")).map((s) => s.slice(9));
  const ek = (process.env.TEKSERP_TEST_DB_EK_AGACLAR || "").split(delimiter).filter(Boolean);
  return [...new Set([...agaclar, ...ek].map(gercekYol))].filter((t) => {
    if (t === mevcut) return false;
    const env = join(t, "Teks-Erp", ".env");
    return existsSync(env) && envDbAdi(readFileSync(env, "utf8")) === ad;
  });
}

function bayraklariAyir(args, izinli) {
  const konum = [];
  const b = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) { konum.push(a); continue; }
    const ad = a.slice(2);
    if (!(ad in izinli)) throw new Error(`tanınmayan seçenek: ${a}`);
    if (izinli[ad] === "deger") {
      if (args[i + 1] === undefined || args[i + 1].startsWith("--")) throw new Error(`${a} bir değer ister`);
      b[ad] = args[++i];
    } else b[ad] = true;
  }
  return { konum, b };
}

function ac(args) {
  const { konum, b } = bayraklariAyir(args, { sablon: "deger", kim: "deger" });
  if (konum.length !== 1) throw new Error("kullanım: test-db.mjs ac <ad> [--sablon <kaynak>] [--kim <metin>]");
  const ad = konum[0];
  const ah = adHatasi(ad);
  if (ah) return red([ah]);
  if (dbVarMi(ad)) return red([`'${ad}' zaten var — başka bir ad seç ya da önce sil`]);
  const kaynak = b.sablon;
  if (kaynak !== undefined) {
    if (kaynak === ad) return red(["kaynak ile hedef aynı olamaz"]);
    const varMi = adHatasi(kaynak) ? false : dbVarMi(kaynak);
    const oturum = varMi ? bagliOturum(kaynak) : 0;
    const rolls = varMi ? rollsSay(kaynak) : null;
    const k = klonKaynagiKarari({ kaynak, varMi, rolls, bagliOturum: oturum });
    if (!k.izin) return red(k.sebepler);
    hizaUyarisi(kaynak);
  }
  const sql = `CREATE DATABASE ${tanimlayici(ad)}${kaynak ? ` TEMPLATE ${tanimlayici(kaynak)}` : ""}`;
  const r = psql("postgres", sql);
  if (!r.ok) return red([`açılamadı: ${r.err.split("\n")[0]}`]);
  const agac = buAgac();
  const kayit = {
    ac: new Date().toISOString(),
    kim: b.kim || process.env.TEKSERP_OTURUM || userInfo().username,
    agac: agac ?? "(git dışı)",
    dal: (agac && git(["rev-parse", "--abbrev-ref", "HEAD"], agac)) || "?",
    sablon: kaynak,
  };
  const y = psql("postgres", `COMMENT ON DATABASE ${tanimlayici(ad)} IS ${literal(yorumYaz(kayit))}`);
  if (!y.ok) console.error(`⚠️  yorum yazılamadı (kayıt yalnız jsonl'de): ${y.err.split("\n")[0]}`);
  kayitYaz({ olay: "ac", ad, ...kayit, zaman: kayit.ac });
  console.log(`✅ açıldı: ${ad}${kaynak ? ` (şablon: ${kaynak})` : " (boş — sonraki adımlar: docs/RECETELER.md § İzole oturum md. 4c)"}`);
  console.log(`   kayıt: ağaç ${kayit.agac} · dal ${kayit.dal} · ${KAYIT}`);
  return 0;
}

/** Şablonun migration hizası (hizasız şablon test_schema_drift'i sahte kırmızıya düşürür) — yalnız uyarı. */
function hizaUyarisi(kaynak) {
  const dizin = join(KOK, "Teks-Erp", "prisma", "migrations");
  if (!existsSync(dizin)) return;
  const beklenen = readdirSync(dizin, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d/.test(d.name)).length;
  const r = psql(kaynak, "select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null");
  if (r.ok && Number(r.out) !== beklenen) {
    console.error(`⚠️  şablon hizasız: '${kaynak}' ${r.out} migration · bu ağaç ${beklenen} — klondan sonra eksikleri uygula`);
  }
}

function sil(args) {
  const { konum, b } = bayraklariAyir(args, { kayitsiz: "bayrak", "baska-agac": "bayrak" });
  if (konum.length !== 1) throw new Error("kullanım: test-db.mjs sil <ad> [--kayitsiz] [--baska-agac]");
  const ad = konum[0];
  const ah = adHatasi(ad);
  if (ah) return red([ah]);
  const varMi = dbVarMi(ad);
  const mevcut = buAgac();
  const yorum = varMi ? dbYorumu(ad) : "";
  const kayit = varMi ? kayitBul(ad, yorum) : null;
  const kayitAgaci = kayit?.agac && existsSync(kayit.agac) ? gercekYol(kayit.agac) : null;
  const karar = silmeKarari({
    ad, varMi, kayit,
    kayitAgaciBaska: kayitAgaci !== null && kayitAgaci !== mevcut,
    envReferanslari: varMi ? envReferanslari(ad, mevcut) : [],
    bagliOturum: varMi ? bagliOturum(ad) : 0,
    bayraklar: { kayitsiz: b.kayitsiz === true, baskaAgac: b["baska-agac"] === true },
  });
  if (karar.yok) { console.log(`ℹ️  ${karar.sebepler[0]} — yapılacak bir şey yok`); return 0; }
  if (!karar.izin) return red(karar.sebepler);
  // FORCE YOK: arada bağlanan oturum olursa PG silmeyi kendisi reddeder.
  const r = psql("postgres", `DROP DATABASE ${tanimlayici(ad)}`);
  if (!r.ok) return red([`silinemedi: ${r.err.split("\n")[0]}`]);
  if (dbVarMi(ad)) return red([`'${ad}' silme komutundan sonra hâlâ duruyor`]);
  kayitYaz({ olay: "sil", ad, zaman: new Date().toISOString(), agac: mevcut ?? "(git dışı)", kayitsiz: !kayit });
  console.log(`✅ silindi: ${ad}${kayit ? ` (açılış ${kayit.ac ?? kayit.zaman ?? "?"} · ${kayit.agac ?? "?"})` : " (kayıtsız, adla onaylandı)"}`);
  return 0;
}

function liste() {
  const satirlar = oku(
    `select datname, pg_database_size(datname), pg_size_pretty(pg_database_size(datname)),
            (select count(*) from pg_stat_activity a where a.datname = d.datname),
            coalesce(shobj_description(oid, 'pg_database'), '')
       from pg_database d where datname like '%\\_test' order by datname`,
  ).split("\n").filter(Boolean);
  if (satirlar.length === 0) { console.log("_test DB'si yok"); return 0; }
  let toplam = 0;
  for (const s of satirlar) {
    const [ad, bayt, boyut, oturum, yorum] = s.split("\t");
    toplam += Number(bayt);
    const rolls = rollsSay(ad);
    const veri = rolls === null ? "rolls ?" : rolls === "tablo-yok" ? "şema yok" : rolls > 0 ? `⚠️ FABRİKA VERİSİ (${rolls} top)` : "temiz (0 top)";
    const k = kayitBul(ad, yorum);
    const kim = k ? `kayıt: ${k.kim ?? "?"} · ${k.ac ?? k.zaman ?? "?"} · ${k.agac ?? "?"}${k.sablon ? ` · şablon ${k.sablon}` : ""}` : "kayıtsız";
    const bicim = adHatasi(ad) ? " · biçim dışı (araç işlemez)" : "";
    console.log(`${ad}  ${boyut}  oturum ${oturum}  ${veri}  ${kim}${bicim}`);
  }
  console.log(`— ${satirlar.length} DB · toplam ${(toplam / 1048576).toFixed(0)} MB`);
  return 0;
}

function red(sebepler) {
  for (const s of sebepler) console.error(`⛔ ${s}`);
  return 1;
}

const [komut, ...args] = process.argv.slice(2);
const KOMUTLAR = { ac, sil, liste };
if (!KOMUTLAR[komut]) {
  console.error("kullanım: node scripts/test-db.mjs ac <ad> [--sablon <kaynak>] | sil <ad> [--kayitsiz] [--baska-agac] | liste");
  process.exit(1);
}
try {
  process.exit(KOMUTLAR[komut](args));
} catch (e) {
  if (e instanceof Olculemedi) { console.error(`⏸  ÖLÇÜLEMEDİ: ${e.message}`); process.exit(2); }
  console.error(`⛔ ${e.message}`);
  process.exit(1);
}
