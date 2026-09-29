// =============================================================================
// Kod koruma 2a — PRISMA ŞEMA YORUM SIZINTISI: yorumsuz kopyadan `generate` provası
// =============================================================================
// Üretilmiş istemci şemanın yorumlarını ÜÇ kanaldan taşır: `.prisma/client/schema.prisma`
// kopyası, `index.js`/`edge.js` içindeki `inlineSchema` dizgesi ve `index.d.ts` JSDoc'u
// (`///` satırları). Bu betik şemanın yorumsuz kopyasını geçici dizine yazar, oradan
// `prisma generate` eder, üç kanalı sayar ve çalışma anı veri modelinin (runtimeDataModel +
// parameterizationSchema) mevcut istemciyle BİREBİR aynı olduğunu, `migrate diff`in de
// iki şema arasında SIFIR SQL ifadesi ürettiğini ölçer.
// Koşum (Teks-Erp/ içinden; DB'ye bağlanmaz):
//   npx tsx scripts/olcum/prisma-yorumsuz.ts            → çıktı geçici dizine (ağaca dokunmaz)
//   npx tsx scripts/olcum/prisma-yorumsuz.ts --uygula   → çıktı BU ağacın node_modules/.prisma/client'ına
//     (yalnız izole ağaçta: .prisma gerçek dizin olmalı; sonra `npx prisma generate` ile geri dön)
// =============================================================================
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const TEKS = path.resolve(__dirname, "..", "..");
const KAYNAK = path.join(TEKS, "prisma", "schema.prisma");
const MEVCUT = path.join(TEKS, "node_modules", ".prisma", "client");
const uygula = process.argv.includes("--uygula");

/** Satır sonu yorumunu dizge içindeki `//`i koruyarak keser. */
export function stripLineComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "/" && line[i + 1] === "/") return line.slice(0, i).trimEnd();
  }
  return line;
}

export function stripSchemaComments(src: string): string {
  const out: string[] = [];
  for (const raw of src.split("\n")) {
    const line = stripLineComment(raw);
    if (line.trim() === "" && raw.trim() !== "") continue; // yalnız yorumdan ibaret satır
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Yorumsuz sözcük dizisi — prisma inlineSchema'yı yeniden biçimlediği için (hizalama) boşluk karşılaştırılmaz. */
function sozcukler(t: string): string[] {
  return t
    .split("\n")
    .map(stripLineComment)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}

function sayYorum(t: string): number {
  return t.split("\n").filter((l) => /^\s*\/\//.test(l)).length;
}

function oku(dir: string): { inline: string; runtime: string; param: string; dts: string; kopya: string } {
  const js = readFileSync(path.join(dir, "index.js"), "utf8");
  const inline = JSON.parse(/"inlineSchema":\s*("(?:[^"\\]|\\.)*")/.exec(js)![1]) as string;
  const runtime = /config\.runtimeDataModel = JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(js)?.[1] ?? "";
  const param = /config\.parameterizationSchema = ([^\n]*)/.exec(js)?.[1] ?? "";
  return {
    inline,
    runtime,
    param,
    dts: readFileSync(path.join(dir, "index.d.ts"), "utf8"),
    kopya: readFileSync(path.join(dir, "schema.prisma"), "utf8"),
  };
}

function main(): void {
  const src = readFileSync(KAYNAK, "utf8");
  const yorumsuz = stripSchemaComments(src);
  // `generate` @prisma/client'ı ŞEMANIN dizininden yukarı arar: geçici kopya bir node_modules
  // atasının altında durmalı (tmpdir'de "Could not resolve @prisma/client" — ölçüldü).
  if (lstatSync(path.join(TEKS, "node_modules")).isSymbolicLink() || lstatSync(MEVCUT).isSymbolicLink()) {
    console.error("X yalnız izole ağaçta: node_modules/.prisma paylaşılan bağ — ortak ağaca yazılırdı.");
    process.exit(2);
  }
  const cache = path.join(TEKS, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const gecici = mkdtempSync(path.join(cache, "prisma-yorumsuz-"));
  const cikti = uygula ? MEVCUT : path.join(gecici, "client");
  const once = uygula ? null : oku(MEVCUT);
  // generator bloğuna çıktı yolu eklenir; başka hiçbir şey değişmez.
  const semaYolu = path.join(gecici, "schema.prisma");
  const hedefli = yorumsuz.replace(/generator client \{\n/, `generator client {\n  output = ${JSON.stringify(cikti)}\n`);
  writeFileSync(semaYolu, hedefli);
  const prisma = path.join(TEKS, "node_modules", ".bin", "prisma");
  const kos = (argv: string[]): void => {
    try {
      execFileSync(prisma, argv, { cwd: TEKS, stdio: "pipe", encoding: "utf8" });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      console.error(`X prisma ${argv[0]} düştü:\n${err.stdout ?? ""}${err.stderr ?? ""}`);
      process.exit(1);
    }
  };
  kos(["validate", "--schema", semaYolu]);
  const t0 = Date.now();
  kos(["generate", "--schema", semaYolu]);
  const ms = Date.now() - t0;
  const sonra = oku(cikti);
  // Paketteki şemanın kendisi yorumsuz olabilir mi: migrate açısından veri modeli farkı SIFIR olmalı.
  let migrateFarki = "";
  try {
    migrateFarki = execFileSync(prisma, ["migrate", "diff", "--from-schema", KAYNAK, "--to-schema", semaYolu, "--script"], {
      cwd: TEKS,
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env, DOTENV_CONFIG_QUIET: "true" }, // dotenv afişi stdout'a düşüp SQL sayılmasın
    });
  } catch (e) {
    migrateFarki = `HATA: ${(e as { stderr?: string }).stderr ?? String(e)}`;
  }
  const migrateSql = migrateFarki
    .split("\n")
    .filter((l) => l.trim() !== "" && !/^\s*--/.test(l));

  const ucluSatir = src
    .split("\n")
    .filter((l) => /^\s*\/\/\/ /.test(l))
    .map((l) => l.replace(/^\s*\/\/\/\s*/, "").trim())
    .filter((l) => l.length > 25);
  const dtsIsabet = (dts: string): number => ucluSatir.filter((l) => dts.includes(l)).length;

  // Paket `prisma/migrations`ı da taşır (kur.ps1 migrate deploy); SQL yorumu ayrı bir sızıntı kanalıdır.
  const migDir = path.join(TEKS, "prisma", "migrations");
  const sql = readdirSync(migDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readFileSync(path.join(migDir, e.name, "migration.sql"), "utf8"))
    .join("\n")
    .split("\n");
  const rapor = {
    migrationSql: { satir: sql.length, yorumSatiri: sql.filter((l) => /^\s*--/.test(l)).length },
    kaynak: { satir: src.split("\n").length, yorumSatiri: sayYorum(src), bayt: src.length },
    yorumsuz: { satir: yorumsuz.split("\n").length, yorumSatiri: sayYorum(yorumsuz), bayt: yorumsuz.length },
    generateMs: ms,
    migrateDiff: { sqlIfadesi: migrateSql.length, ilkSatir: migrateSql[0] ?? null, ham: migrateFarki.trim().slice(0, 120) },
    cikti: uygula ? "node_modules/.prisma/client (bu ağaç)" : "geçici dizin",
    sizinti: {
      once: once && { kopyaYorum: sayYorum(once.kopya), inlineYorum: sayYorum(once.inline), dtsUcluIsabet: dtsIsabet(once.dts) },
      sonra: { kopyaYorum: sayYorum(sonra.kopya), inlineYorum: sayYorum(sonra.inline), dtsUcluIsabet: dtsIsabet(sonra.dts) },
      ucluSatirOrneklemi: ucluSatir.length,
    },
    esdegerlik: once && {
      runtimeDataModelAyni: once.runtime.length > 0 && once.runtime === sonra.runtime,
      parameterizationSchemaAyni: once.param.length > 0 && once.param === sonra.param,
      inlineSozcukAyni: sozcukler(once.inline).join(" ") === sozcukler(sonra.inline).join(" ").replace(/output = "[^"]*" /, ""),
      dtsKB: { once: Math.round(once.dts.length / 1024), sonra: Math.round(sonra.dts.length / 1024) },
    },
  };
  process.stdout.write(JSON.stringify(rapor, null, 2) + "\n");
  rmSync(gecici, { recursive: true, force: true });
}

main();
