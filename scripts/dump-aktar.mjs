#!/usr/bin/env node
// =============================================================================
// dump-aktar — bir fabrikanın İŞ verisini başka bir kurulumun KİMLİĞİ altına aktarır.
//
// KAYNAK = iş verisini veren döküm (HEDEF şemasına göç ettirilmiş) · DENEME = kimliği korunan
// canlı kurulumun DB'si (yalnız OKUNUR) · HEDEF = yeni DB (KAYNAK'tan klon + DENEME kimliği).
// Tablo sınıfları: scripts/lib/dump-aktar-siniflar.mjs (sınıfsız tablo → DUR).
//
//   node scripts/dump-aktar.mjs plan     --kaynak <db> --deneme <db>                  (varsayılan; salt okuma)
//   node scripts/dump-aktar.mjs birlestir --kaynak <db> --deneme <db> --hedef <db> [--apply]
//   node scripts/dump-aktar.mjs degistir --deneme <db> --hedef <db> --eski <db> [--apply]   (ad takası)
//
// --apply yoksa hiçbir komut yazmaz; `birlestir` önce `plan` çıktısını basar. `degistir` canlı DB'nin
// ADINI değiştirir: backend + yedek DURMUŞ olmalı (bağlı oturum varsa reddeder). Geri dönüş aynı komut
// ters adlarla. psql komutu DUMP_AKTAR_PSQL (JSON dizi), varsayılan yerel test konteyneri:
//   DUMP_AKTAR_PSQL='["ssh","tekserp-bulut-deneme","sudo","-n","docker","exec","-i","tekserp-test-musteri-postgres-1","psql","-U","tekserp"]'
// Çıktı değer basmaz (isim/vergi no/sır yok) — yalnız tablo adı, anahtar adı ve sayı.
// =============================================================================
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIT_KIMLIK_ETIKETLERI, IS_TABLOLARI, KURULUM_AYAR_ONEKLERI, KURULUM_AYAR_TAM, OZEL_TABLOLAR, SINIF, rezerveAnahtarlar,
} from "./lib/dump-aktar-siniflar.mjs";
import {
  KULLANICI_ONEKI, SAHNELENEN, birlestirSql, dogrulaSql, hazirlaSql, id, lit, sahneTablosuSql,
} from "./lib/dump-aktar-sql.mjs";

const KOK = join(dirname(fileURLToPath(import.meta.url)), "..");
const PSQL = JSON.parse(process.env.DUMP_AKTAR_PSQL || '["docker","exec","-i","tekserp-local-db","psql","-U","tekserp"]');
const PSQL_ARGS = ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];
const AD = /^[a-z][a-z0-9_]{1,62}$/;

function psql(db, sql) {
  const r = spawnSync(PSQL[0], [...PSQL.slice(1), ...PSQL_ARGS, "-d", db], { input: sql, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.error) throw new Error(`psql çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`psql (${db}) hata: ${(r.stderr || "").trim().split("\n").slice(0, 3).join(" | ")}`);
  return (r.stdout || "").trim();
}
const satirlar = (db, sql) => psql(db, sql).split("\n").filter(Boolean).map((l) => l.split("|"));

/** DENEME'den HEDEF'in hazırlık şemasına COPY akışı (iki psql, aradan stdout→stdin). */
function akit(deneme, hedef, tablo, kolonlar) {
  return new Promise((resolve, reject) => {
    const src = spawn(PSQL[0], [...PSQL.slice(1), ...PSQL_ARGS, "-d", deneme], { stdio: ["pipe", "pipe", "pipe"] });
    const dst = spawn(PSQL[0], [...PSQL.slice(1), ...PSQL_ARGS, "-d", hedef], { stdio: ["pipe", "pipe", "pipe"] });
    let hata = "";
    src.stderr.on("data", (d) => { hata += d; });
    dst.stderr.on("data", (d) => { hata += d; });
    dst.stdin.write(`COPY aktar_deneme.${id(tablo)} (${kolonlar}) FROM STDIN;\n`);
    src.stdout.pipe(dst.stdin, { end: false });
    src.stdout.on("end", () => dst.stdin.end("\\.\n"));
    src.stdin.end(`COPY (SELECT ${kolonlar} FROM public.${id(tablo)}) TO STDOUT;\n`);
    let bitti = 0; let kod = 0;
    const kapan = (c) => { kod ||= c ?? 1; if (++bitti === 2) (kod === 0 ? resolve() : reject(new Error(`${tablo} aktarılamadı: ${hata.trim().split("\n")[0]}`))); };
    src.on("close", kapan); dst.on("close", kapan);
  });
}

function bayraklar(argv) {
  const [komut = "plan", ...rest] = argv;
  const b = { komut };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--apply") b.apply = true;
    else if (/^--(kaynak|deneme|hedef|eski)$/.test(a)) b[a.slice(2)] = rest[++i];
    else throw new Error(`tanınmayan argüman: ${a}`);
  }
  for (const k of ["kaynak", "deneme", "hedef", "eski"]) if (b[k] !== undefined && !AD.test(b[k])) throw new Error(`geçersiz DB adı: --${k}`);
  return b;
}

function kurulumDesenleri() {
  const rezerve = rezerveAnahtarlar(readFileSync(join(KOK, "Teks-Erp/src/constants/reserved-settings.ts"), "utf8"));
  const desen = new Set([...KURULUM_AYAR_ONEKLERI.map((o) => `${o}%`), ...KURULUM_AYAR_TAM]);
  for (const k of rezerve) desen.add(k.endsWith(".") ? `${k}%` : k);
  return [...desen].sort();
}
const kurulumMu = (desenler, key) => desenler.some((d) => (d.endsWith("%") ? key.startsWith(d.slice(0, -1)) : key === d));

const SAYIM = `SELECT tablename || '|' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', tablename), false, true, '')))[1]::text
  FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;`;
const GOC = "SELECT count(*) || '|' || max(migration_name) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;";

/** Salt okuma plan: sınıf denetimi, göç eşitliği, tablo başına etki, çakışmalar, ayar anahtarı kararları. */
function plan({ kaynak, deneme }) {
  const hatalar = [];
  const [gk] = satirlar(kaynak, GOC); const [gd] = satirlar(deneme, GOC);
  console.log(`Şema: KAYNAK ${gk[0]} göç (son ${gk[1]}) · DENEME ${gd[0]} göç (son ${gd[1]})`);
  if (gk[0] !== gd[0] || gk[1] !== gd[1]) hatalar.push("göç kümeleri eşit değil — KAYNAK'ı önce DENEME sürümüne göç ettir (prisma migrate deploy)");

  const nk = new Map(satirlar(kaynak, SAYIM).map(([t, n]) => [t, Number(n)]));
  const nd = new Map(satirlar(deneme, SAYIM).map(([t, n]) => [t, Number(n)]));
  const sinifi = new Map([...IS_TABLOLARI.map((t) => [t, SINIF.IS]), ...Object.entries(OZEL_TABLOLAR).map(([t, [s]]) => [t, s])]);
  for (const t of new Set([...nk.keys(), ...nd.keys()])) {
    if (!sinifi.has(t)) hatalar.push(`sınıfsız tablo: ${t} (scripts/lib/dump-aktar-siniflar.mjs'e ekle)`);
    if (!nk.has(t) || !nd.has(t)) hatalar.push(`tablo iki DB'de birden yok: ${t}`);
  }
  for (const t of sinifi.keys()) if (!nk.has(t)) hatalar.push(`sınıflanmış tablo DB'de yok: ${t}`);

  const ozet = {};
  console.log("\nTablo · sınıf · KAYNAK · DENEME · HEDEF'e giren (yalnız sıfırdan farklılar):");
  for (const t of [...sinifi.keys()].sort()) {
    const s = sinifi.get(t); const a = nk.get(t) ?? 0; const d = nd.get(t) ?? 0;
    ozet[s] ??= { tablo: 0, kaynak: 0, deneme: 0 };
    ozet[s].tablo++; ozet[s].kaynak += a; ozet[s].deneme += d;
    if (a + d === 0) continue;
    const giren = { IS: `KAYNAK ${a} (DENEME ${d} atılır)`, KIMLIK: `DENEME ${d} (KAYNAK ${a} atılır)`, BIRLESIM: `KAYNAK ${a} pasif + DENEME ${d}`,
      AYAR: "anahtar bazlı (aşağıda)", AUDIT: "süzülür (aşağıda)", ESITLEME: "sıfır (+tur)", SEMA: `KAYNAK ${a}` }[s];
    console.log(`  ${t.padEnd(42)} ${s.padEnd(9)} ${String(a).padStart(7)} ${String(d).padStart(7)}  ${giren}`);
  }
  console.log("\nSınıf özeti (tablo · KAYNAK satır · DENEME satır):");
  for (const [s, o] of Object.entries(ozet)) console.log(`  ${s.padEnd(9)} ${String(o.tablo).padStart(4)} ${String(o.kaynak).padStart(9)} ${String(o.deneme).padStart(7)}`);

  // Çakışmalar: DENEME kimlikleri KAYNAK'ta var mı (PK/benzersiz) — varsa birleştirme PK hatasıyla düşerdi.
  const dUsers = satirlar(deneme, "SELECT id || '|' || lower(username) FROM users;");
  const dDev = satirlar(deneme, `SELECT id || '|' || "deviceId" FROM devices;`);
  const inList = (arr) => (arr.length ? arr.map(lit).join(",") : "NULL");
  const [cu] = satirlar(kaynak, `SELECT (SELECT count(*) FROM users WHERE id::text IN (${inList(dUsers.map((r) => r[0]))})) || '|' ||
    (SELECT count(*) FROM users WHERE lower(${lit(KULLANICI_ONEKI)} || username) IN (${inList(dUsers.map((r) => r[1]))})) || '|' ||
    (SELECT count(*) FROM devices WHERE id::text IN (${inList(dDev.map((r) => r[0]))}) OR "deviceId" IN (${inList(dDev.map((r) => r[1]))})) || '|' ||
    (SELECT count(*) FROM users WHERE length(${lit(KULLANICI_ONEKI)} || username) > 50);`);
  console.log(`\nÇakışma: kullanıcı kimliği ${cu[0]} · önekli ad ${cu[1]} · cihaz ${cu[2]} · 50 karakteri aşan önekli ad ${cu[3]}`);
  if (Number(cu[0]) + Number(cu[1]) + Number(cu[2]) > 0) hatalar.push("DENEME kimlikleri KAYNAK'la çakışıyor");
  if (Number(cu[3]) > 0) hatalar.push("önekli kullanıcı adı 50 karakteri aşıyor (kesilir → çakışma riski)");

  const [ku] = satirlar(kaynak, `SELECT count(*) || '|' || count(*) FILTER (WHERE "isActive") || '|' || count(*) FILTER (WHERE "isSystemAccount") FROM users;`);
  const [du] = satirlar(deneme, `SELECT count(*) || '|' || count(*) FILTER (WHERE "isActive") || '|' || count(*) FILTER (WHERE "totpEnabledAt" IS NOT NULL) || '|' || count(*) FILTER (WHERE "isSystemAccount") FROM users;`);
  console.log(`Kullanıcı: KAYNAK ${ku[0]} (aktif ${ku[1]}, sistem ${ku[2]}) → hepsi pasif/girişsiz/'${KULLANICI_ONEKI}' önekli · DENEME ${du[0]} (aktif ${du[1]}, TOTP ${du[2]}, sistem ${du[3]}) → aynen`);

  const desen = kurulumDesenleri();
  const kk = satirlar(kaynak, "SELECT key FROM system_settings ORDER BY 1;").map((r) => r[0]);
  const dk = satirlar(deneme, "SELECT key FROM system_settings ORDER BY 1;").map((r) => r[0]);
  console.log(`\nAyar: kurulum-özel desen ${desen.length} (rezerve küme reserved-settings.ts + önekler)`);
  console.log(`  KAYNAK'tan GİRMEYEN (kurulum-özel): ${kk.filter((k) => kurulumMu(desen, k)).join(", ") || "-"}`);
  console.log(`  KAYNAK'tan giren iş ayarı: ${kk.filter((k) => !kurulumMu(desen, k)).length}`);
  console.log(`  DENEME'den giren: ${dk.filter((k) => kurulumMu(desen, k)).join(", ") || "-"}`);
  console.log(`  DENEME'den GİRMEYEN (iş ayarı, KAYNAK'ınki geçerli): ${dk.filter((k) => !kurulumMu(desen, k)).join(", ") || "-"}`);
  if (!dk.includes("system.installationId")) hatalar.push("DENEME'de system.installationId yok");

  const [al] = satirlar(kaynak, `SELECT count(*) || '|' || count(*) FILTER (WHERE "chainSeq" IS NULL AND category::text IN ('DOMAIN','SYSTEM') AND action NOT LIKE 'AUDIT_CHAIN%'
      AND coalesce("tableName", '') NOT IN (${AUDIT_KIMLIK_ETIKETLERI.map(lit).join(",")}))
      || '|' || coalesce(max("createdAt") FILTER (WHERE "chainSeq" IS NULL), 'epoch')::text FROM system_logs;`);
  const [dl] = satirlar(deneme, `SELECT count(*) || '|' || coalesce(min("createdAt") FILTER (WHERE "chainSeq" IS NOT NULL), 'infinity')::text FROM system_logs;`);
  console.log(`\nAudit: KAYNAK ${al[0]} → taşınan iş ayak izi ${al[1]} (son ${al[2]}) · DENEME zinciri ${dl[0]} (başı ${dl[1]})`);
  if (!(new Date(al[2]) < new Date(dl[1]))) hatalar.push("KAYNAK audit'i DENEME zincir başından yeni — doğrulayıcı ZINCIRSIZ_SATIR verir");

  const [sw] = satirlar(deneme, "SELECT count(*) || '|' || count(*) FILTER (WHERE source = 'tur') FROM sync_watermarks;");
  console.log(`Eşitleme: DENEME filigranı ${sw[0]} satır → ${sw[1]} (tur) kalır; ilk tur her kayıt projeksiyonunu TAM gönderir`);

  console.log(hatalar.length ? `\n⛔ ${hatalar.length} engel:\n  - ${hatalar.join("\n  - ")}` : "\n✅ plan engelsiz");
  return hatalar.length === 0;
}

async function birlestir(b) {
  if (!plan(b)) return 1;
  if (!b.hedef) throw new Error("--hedef gerekli");
  const [var1] = satirlar("postgres", `SELECT count(*) FROM pg_database WHERE datname = ${lit(b.hedef)};`);
  if (var1[0] !== "0") { console.error(`⛔ HEDEF '${b.hedef}' zaten var — başka ad ya da önce elle kaldır`); return 1; }
  console.log(`\nUygulanacak: CREATE DATABASE ${b.hedef} TEMPLATE ${b.kaynak} → hazırlık şeması → DENEME'den ${SAHNELENEN.length} tablo akışı → TEK tx birleştirme → doğrulama → DB düzeyi ayar/yetki aynası (${b.deneme} → ${b.hedef}).`);
  console.log(`DENEME (${b.deneme}) yalnız OKUNUR; KAYNAK (${b.kaynak}) yalnız şablon olarak okunur (bağlı oturum olmamalı).`);
  if (!b.apply) { console.log("\n(kuru koşu — yazmak için --apply)"); return 0; }

  const t0 = Date.now();
  const sure = () => `${((Date.now() - t0) / 1000).toFixed(1)} sn`;
  psql("postgres", `CREATE DATABASE ${id(b.hedef)} TEMPLATE ${id(b.kaynak)};`);
  console.log(`① HEDEF klonlandı (${sure()})`);
  psql(b.hedef, hazirlaSql({ kurulumDesenleri: kurulumDesenleri() }));
  for (const t of SAHNELENEN) {
    const kolonlar = psql(b.hedef, sahneTablosuSql(t));
    await akit(b.deneme, b.hedef, t, kolonlar);
  }
  const [sahne] = satirlar(b.hedef, `SELECT ${SAHNELENEN.map((t) => `aktar_kontrol.say('aktar_deneme', ${lit(t)})`).join(" + ")};`);
  console.log(`② DENEME kimliği sahnelendi: ${SAHNELENEN.length} tablo, ${sahne[0]} satır (${sure()})`);
  psql(b.hedef, birlestirSql());
  console.log(`③ Birleştirme tx'i işlendi (${sure()})`);
  const sonuc = satirlar(b.hedef, dogrulaSql());
  const hata = sonuc.filter((r) => r[0] === "HATA");
  for (const r of sonuc) console.log(`   ${r[0] === "OK" ? "✓" : "✗"} ${r[1]}: ${r[2]}`);
  console.log(`④ Doğrulama (${sure()})`);
  if (hata.length) { console.error(`⛔ ${hata.length} doğrulama hatası — HEDEF '${b.hedef}' incelemeye bırakıldı (aktar_* şemaları içinde)`); return 1; }
  psql(b.hedef, "DROP SCHEMA aktar_deneme CASCADE; DROP SCHEMA aktar_kontrol CASCADE;");
  dbAynala(b.deneme, b.hedef);
  console.log(`⑤ Hazırlık şemaları kaldırıldı, DB düzeyi ayar/yetki aynalandı (${sure()})`);
  console.log(`\n✅ HEDEF hazır: ${b.hedef}. Takas: node scripts/dump-aktar.mjs degistir --deneme ${b.deneme} --hedef ${b.hedef} --eski <yedek-adı> --apply (backend + yedek DURMUŞKEN)`);
  return 0;
}

/** DENEME DB'sinin DB düzeyi ayarları (ör. teks.audit_guard) ve CONNECT/TEMP yetkileri HEDEF'e — ad takasından sonra aynı kalsın. */
function dbAynala(deneme, hedef) {
  const ayar = satirlar("postgres", `SELECT coalesce(r.rolname, '') || '|' || x FROM pg_db_role_setting s
     LEFT JOIN pg_roles r ON r.oid = s.setrole, unnest(s.setconfig) x
    WHERE s.setdatabase = (SELECT oid FROM pg_database WHERE datname = ${lit(deneme)});`);
  const sql = [];
  for (const [rol, kv] of ayar) {
    const i = kv.indexOf("="); const k = kv.slice(0, i); const v = kv.slice(i + 1);
    sql.push(rol ? `ALTER ROLE ${id(rol)} IN DATABASE ${id(hedef)} SET ${k} = ${lit(v)};` : `ALTER DATABASE ${id(hedef)} SET ${k} = ${lit(v)};`);
  }
  const yetki = satirlar("postgres", `SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END || '|' || a.privilege_type
     FROM pg_database d, aclexplode(d.datacl) a WHERE d.datname = ${lit(deneme)} AND a.grantee <> d.datdba;`);
  for (const [kime, ne] of yetki) sql.push(`GRANT ${ne} ON DATABASE ${id(hedef)} TO ${kime};`);
  if (sql.length) psql("postgres", sql.join("\n"));
  console.log(`   DB düzeyi: ${ayar.length} ayar · ${yetki.length} yetki aynalandı`);
}

function degistir(b) {
  for (const k of ["deneme", "hedef", "eski"]) if (!b[k]) throw new Error(`--${k} gerekli`);
  const [d] = satirlar("postgres", `SELECT
      (SELECT count(*) FROM pg_database WHERE datname = ${lit(b.deneme)}) || '|' ||
      (SELECT count(*) FROM pg_database WHERE datname = ${lit(b.hedef)}) || '|' ||
      (SELECT count(*) FROM pg_database WHERE datname = ${lit(b.eski)}) || '|' ||
      (SELECT count(*) FROM pg_stat_activity WHERE datname IN (${lit(b.deneme)}, ${lit(b.hedef)}));`);
  console.log(`Takas: ${b.deneme} → ${b.eski} · ${b.hedef} → ${b.deneme} (var: canlı ${d[0]} · hedef ${d[1]} · eski-adı ${d[2]} · bağlı oturum ${d[3]})`);
  const engel = [];
  if (d[0] !== "1") engel.push(`'${b.deneme}' yok`);
  if (d[1] !== "1") engel.push(`'${b.hedef}' yok`);
  if (d[2] !== "0") engel.push(`'${b.eski}' adı dolu`);
  if (d[3] !== "0") engel.push(`${d[3]} bağlı oturum — backend/yedek/okuma bağlantılarını durdur`);
  if (engel.length) { console.error(`⛔ ${engel.join(" · ")}`); return 1; }
  if (!b.apply) { console.log("(kuru koşu — takas için --apply)"); return 0; }
  psql("postgres", `ALTER DATABASE ${id(b.deneme)} RENAME TO ${id(b.eski)};\nALTER DATABASE ${id(b.hedef)} RENAME TO ${id(b.deneme)};`);
  console.log(`✅ takas tamam. Geri dönüş: degistir --deneme ${b.deneme} --hedef ${b.eski} --eski <yeni-yedek-adı> --apply`);
  return 0;
}

try {
  const b = bayraklar(process.argv.slice(2));
  if (b.komut === "plan" || b.komut === "birlestir") for (const k of ["kaynak", "deneme"]) if (!b[k]) throw new Error(`--${k} gerekli`);
  const kod = b.komut === "plan" ? (plan(b) ? 0 : 1) : b.komut === "birlestir" ? await birlestir(b) : b.komut === "degistir" ? degistir(b) : (() => { throw new Error(`bilinmeyen komut: ${b.komut}`); })();
  process.exit(kod);
} catch (e) {
  console.error(`⛔ ${e.message}`);
  process.exit(1);
}
