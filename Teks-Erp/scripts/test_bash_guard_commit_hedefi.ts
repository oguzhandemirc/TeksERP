// =============================================================================
// BEKÇİ — KOMUT KAPISININ COMMIT KOLU DOĞRU AĞACIN KAPISINI MI KOŞUYOR
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts bash_guard_commit_hedefi   (DB'siz)
//
// NEDEN: kanca ana ağaçtan (`$CLAUDE_PROJECT_DIR`) koşar. Commit tespiti ham komut
// metninde regex'ti ve kapı betiğin KONUMUNUN ağacında koşuyordu ⇒ `cd <wt> && …
// --amend` ANA ağacın kapısını koşup onun kırmızısını verdi; `git -C <wt> …` hiç
// tanınmadı; heredoc/echo içindeki "git commit" metni de ana kapıyı koşturdu;
// `core.hooksPath` MUTLAK yazılınca git kancası "kurulu değil" sayıldı (çift koşum).
// §12: `scripts/hooks-kur.mjs --durum` aynı çözücüyü (`gitKapisiKurulu`) kullanır — mutlak yolu da tanır.
//
// Kurgu: geçici bir depo (ana + worktree) GERÇEK kanca betiğinin kopyasını taşır;
// commit gövdesi SAHTEDİR ve yalnız hangi ağaçta koştuğunu basar (ana'da çıkış 1).
// Git ortamı hermetik: global/sistem config okunmaz. Veritabanına dokunmaz.
// =============================================================================
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git as gitKos } from "./lib/git";

const KOK = join(__dirname, "..", "..");
const ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", TEKSERP_HOOK_SKIP: "0" };

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const git = (cwd: string, ...a: string[]): string => gitKos(a, { cwd, env: ENV, stdio: "yut" }).trim();

const SAHTE_GOVDE = `import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
const R = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.stderr.write("SAHTE-KAPI agac=" + basename(R) + " taban=" + (process.env.TEKSERP_COMMIT_BASE ?? "-") + "\\n");
process.exit(basename(R) === "ana" ? 1 : 0);
`;

function kur(tmp: string): { ana: string; wt: string } {
  const ana = join(tmp, "ana");
  const wt = join(tmp, "wt");
  mkdirSync(join(ana, "scripts", "hooks", "lib"), { recursive: true });
  mkdirSync(join(ana, "Teks-Erp", "src"), { recursive: true });
  cpSync(join(KOK, "scripts", "claude-hooks"), join(ana, "scripts", "claude-hooks"), { recursive: true });
  cpSync(join(KOK, "scripts", "hooks", "lib", "staged.mjs"), join(ana, "scripts", "hooks", "lib", "staged.mjs"));
  cpSync(join(KOK, "scripts", "hooks-kur.mjs"), join(ana, "scripts", "hooks-kur.mjs"));
  writeFileSync(join(ana, "scripts", "hooks", "pre-commit.mjs"), SAHTE_GOVDE);
  git(ana, "init", "-q", "-b", "main");
  git(ana, "config", "user.email", "t@t");
  git(ana, "config", "user.name", "t");
  for (const d of ["a", "b"]) {
    writeFileSync(join(ana, "Teks-Erp", "src", `${d}.ts`), d);
    git(ana, "add", "-A");
    git(ana, "commit", "-q", "--no-verify", "-m", d);
  }
  git(ana, "worktree", "add", "-q", "-b", "wt", wt, "HEAD");
  writeFileSync(join(wt, "Teks-Erp", "src", "c.ts"), "c");
  git(wt, "add", "Teks-Erp/src/c.ts");
  git(wt, "commit", "-q", "--no-verify", "-m", "c");
  writeFileSync(join(wt, "Teks-Erp", "src", "d.ts"), "d");
  git(wt, "add", "Teks-Erp/src/d.ts");
  return { ana, wt };
}

function kanca(ana: string, command: string, cwd = ana): { cikis: number | null; err: string } {
  const r = spawnSync("node", [join(ana, "scripts", "claude-hooks", "bash-guard.mjs")], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
    cwd, env: ENV, encoding: "utf8",
  });
  return { cikis: r.status, err: r.stderr ?? "" };
}

/** `hooks-kur.mjs --durum` çıktısı: kurulu mu (bash-guard ile aynı çözücü). */
const durumKurulu = (ana: string): boolean =>
  /KURULU/.test(spawnSync("node", [join(ana, "scripts", "hooks-kur.mjs"), "--durum"], { cwd: ana, env: ENV, encoding: "utf8" }).stdout ?? "");

const agac = (err: string): string => (err.match(/SAHTE-KAPI agac=(\S+)/)?.[1] ?? "yok");
const taban = (err: string): string => err.match(/taban=(\S+)/)?.[1] ?? "-";

function main(): void {
  console.log("=== Komut kapısı · commit kolunun hedef ağacı ===\n");
  const tmp = mkdtempSync(join(tmpdir(), "bg-hedef-"));
  try {
    const { ana, wt } = kur(tmp);
    const wtHead = git(wt, "rev-parse", "HEAD");
    const wtParent = git(wt, "rev-parse", "HEAD^");
    let r = kanca(ana, `cd ${wt} && git commit --amend --no-edit`);
    check("§1 ⭐ cd <wt> && … --amend → wt'nin kapısı, taban wt HEAD^", agac(r.err) === "wt" && taban(r.err) === wtParent && r.cikis === 0, `agac=${agac(r.err)} çıkış=${r.cikis}`);
    r = kanca(ana, `git -C ${wt} commit --amend --no-edit`);
    check("§2 ⭐ git -C <wt> … --amend → wt'nin kapısı", agac(r.err) === "wt" && taban(r.err) === wtParent, `agac=${agac(r.err)}`);
    writeFileSync(join(ana, "Teks-Erp", "src", "e.ts"), "e");
    git(ana, "add", "Teks-Erp/src/e.ts");
    r = kanca(ana, `cd ${wt} && git commit -m x`);
    check("§3 ⭐ ana'da staged varken cd <wt> commit → wt'nin kapısı, taban wt HEAD", agac(r.err) === "wt" && taban(r.err) === wtHead, `agac=${agac(r.err)}`);
    r = kanca(ana, "git commit -m x");
    check("§4 pozitif: ana'da commit → ana'nın kapısı koşar ve KIRMIZISI geçer (çıkış 2)", agac(r.err) === "ana" && r.cikis === 2, `agac=${agac(r.err)} çıkış=${r.cikis}`);
    r = kanca(ana, "echo 'git commit --amend' yazisi");
    check("§5 ⭐ echo metnindeki commit kapı koşturmaz", agac(r.err) === "yok" && r.cikis === 0, `agac=${agac(r.err)}`);
    r = kanca(ana, "cat > /dev/null <<'X'\ngit commit --amend\nX");
    check("§6 ⭐ heredoc gövdesindeki commit kapı koşturmaz", agac(r.err) === "yok" && r.cikis === 0, `agac=${agac(r.err)}`);
    r = kanca(ana, "git commit --no-verify -m x");
    check("§7a kaçış --no-verify → kapı yok", agac(r.err) === "yok" && r.cikis === 0);
    r = kanca(ana, "TEKSERP_HOOK_SKIP=1 git commit -m x");
    check("§7b ⭐ satır içi TEKSERP_HOOK_SKIP=1 → kapı yok", agac(r.err) === "yok" && r.cikis === 0, `agac=${agac(r.err)}`);
    r = kanca(ana, "cd \"$WT_YOK\" && git commit -m x");
    check("§8 ⭐ çözülemeyen hedef: yanlış ağaç koşmaz + ÖLÇÜLEMEDİ beyanı", agac(r.err) === "yok" && /çözülemedi/.test(r.err), `agac=${agac(r.err)}`);
    r = kanca(ana, "cd ../../wt && git commit -m x", join(ana, "Teks-Erp"));
    check("§9 göreli cd alt dizinden çözülür", agac(r.err) === "wt", `agac=${agac(r.err)}`);
    mkdirSync(join(ana, ".githooks"));
    writeFileSync(join(ana, ".githooks", "pre-commit"), 'exec node "$(git rev-parse --show-toplevel)/scripts/hooks/pre-commit.mjs"\n');
    git(ana, "config", "core.hooksPath", join(ana, ".githooks"));
    r = kanca(ana, `cd ${wt} && git commit -m x`);
    check("§10a ⭐ MUTLAK core.hooksPath → git kancası kurulu sayılır, çift koşum yok", agac(r.err) === "yok" && r.cikis === 0, `agac=${agac(r.err)}`);
    check("§12a ⭐ hooks-kur --durum MUTLAK yolu da KURULU der (tek çözücü)", durumKurulu(ana));
    git(ana, "config", "core.hooksPath", ".githooks");
    r = kanca(ana, "git commit -m x");
    check("§10b göreli core.hooksPath (.githooks) → kurulu", agac(r.err) === "yok");
    writeFileSync(join(ana, ".githooks", "pre-commit"), "exit 0\n");
    r = kanca(ana, "git commit -m x");
    check("§10c ⭐ bizim gövdeyi çağırmayan pre-commit kurulu SAYILMAZ", agac(r.err) === "ana");
    check("§12b hooks-kur --durum gövdesiz kancayı kurulu SAYMAZ", !durumKurulu(ana));
    git(ana, "config", "--unset", "core.hooksPath");
    r = kanca(ana, ["prisma", "migrate", "reset"].join(" "));
    check("§11 yasak kolu dokunulmadı: yasak komut çıkış 2", r.cikis === 2);
  } finally {
    temizle(tmp);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

function temizle(tmp: string): void {
  rmSync(tmp, { recursive: true, force: true });
}

main();
