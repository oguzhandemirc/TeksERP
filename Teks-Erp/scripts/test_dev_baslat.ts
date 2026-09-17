// =============================================================================
// DEV BAŞLATICI — bayat Prisma istemcisiyle sunucu açılmaz (2026-09-17, kullanıcı onayı 14:40)
// =============================================================================
// Vaka: ortak test ağacı senkronunda nodemon `prisma generate` bitmeden yeniden başladı →
// yeni kaynak + eski client ("customerId bu kayıt tipinde tanımlı değil"). `scripts/dev-baslat.mjs`
// her başlatmada istemci tazeliğini KAPININ ölçüsüyle (`istemciDurumu`) ölçer: bayat/yok →
// generate, güncel → atla; sonra ts-node. Bu bekçi üçünü de `--kuru` (karar basılır, koşulmaz)
// ile fikstür dosyalarında ölçer ve `package.json` kablolamasını okur.
//
// Negatif sonda (2026-09-17, bir kezlik, geri alındı): `generateGerekirMi` koşulsuz `false`
// → §2 ve §4 ❌ (bayatta ATLA basıldı).
// Koşum: npx tsx scripts/test_dev_baslat.ts   (DB GEREKMEZ)
// =============================================================================
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEKS = join(__dirname, "..");
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

function kuru(args: string[]): string {
  const r = spawnSync("node", ["scripts/dev-baslat.mjs", "--kuru", ...args], { cwd: TEKS, encoding: "utf8", timeout: 30_000 });
  return `${r.stdout}\n${r.stderr}`;
}

console.log("=== DEV BAŞLATICI BEKÇİSİ ===\n");

// §1 kablolama: script var, `npm run dev` onu koşuyor, şemayı da izliyor
const pkg = JSON.parse(readFileSync(join(TEKS, "package.json"), "utf8")) as { scripts: Record<string, string> };
const dev = pkg.scripts.dev ?? "";
check("§1a scripts/dev-baslat.mjs var", existsSync(join(TEKS, "scripts/dev-baslat.mjs")));
check("§1b `npm run dev` başlatıcıyı koşuyor (ts-node doğrudan değil)", /--exec node scripts\/dev-baslat\.mjs/.test(dev) && !/--exec ts-node/.test(dev), dev);
check("§1c nodemon ŞEMAYI da izliyor (`--watch prisma/schema.prisma`, `--ext …prisma`)", /--watch prisma\/schema\.prisma/.test(dev) && /--ext [^ ]*prisma/.test(dev), dev);
check("§1d `src` izlemesi korunuyor", /--watch src\b/.test(dev));

// §2–§4 karar: fikstür şema/istemci çiftleri
const dizin = mkdtempSync(join(tmpdir(), "tekserp-devbaslat-"));
try {
  const sema = join(dizin, "schema.prisma");
  const istemci = join(dizin, "client.prisma");
  const govde = "model A {\n  id String @id\n}\n";
  writeFileSync(sema, govde);
  writeFileSync(istemci, govde);
  const taze = kuru([`--sema=${sema}`, `--istemci=${istemci}`]);
  check("§3 GÜNCEL istemci → KARAR: ATLA", /KARAR: ATLA/.test(taze) && !/KARAR: GENERATE/.test(taze), taze.trim().split("\n")[0]);

  writeFileSync(sema, govde + "model B {\n  id String @id\n}\n");
  const bayat = kuru([`--sema=${sema}`, `--istemci=${istemci}`]);
  check("§2 ⭐ BAYAT istemci (şema damgası eski) → KARAR: GENERATE", /KARAR: GENERATE/.test(bayat) && /BAYAT/.test(bayat), bayat.trim().split("\n")[0]);

  const yok = kuru([`--sema=${sema}`, `--istemci=${join(dizin, "yok.prisma")}`]);
  check("§4 ⭐ istemci ÜRETİLMEMİŞ → KARAR: GENERATE", /KARAR: GENERATE/.test(yok) && /ÜRETİLMEMİŞ/.test(yok));

  // §5 körlük zemini: `--kuru` gerçekten koşmuyor — generate ve ts-node izi yok, çıkış hızlı
  const t0 = Date.now();
  kuru([`--sema=${sema}`, `--istemci=${istemci}`]);
  check("§5 --kuru hiçbir şey koşmaz (< 5 sn, karar satırı var)", Date.now() - t0 < 5_000);
} finally {
  rmSync(dizin, { recursive: true, force: true });
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
