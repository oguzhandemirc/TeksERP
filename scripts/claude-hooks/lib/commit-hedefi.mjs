// =============================================================================
// Komut satırındaki commit'lerin HEDEF ÇALIŞMA AĞACI — bash-guard'ın commit kolu.
// =============================================================================
// Kanca betiği ANA ağaçtan (`$CLAUDE_PROJECT_DIR`) koşar ama commit başka bir
// worktree'de atılabilir (`cd <wt> && …` · `git -C <wt> …`). Kapı betiğin
// konumunu değil KOMUTUN HEDEFİNİ ölçmezse yanlış ağacın kapısını koşar.
// Commit yalnız ÇALIŞTIRILAN parçalarda aranır (heredoc gövdesi, echo/grep
// metni commit değildir — `komut-cozumleme.mjs` ile aynı ayrım).
//
// Üç sonuç: hedef çözüldü (`cwd`) · commit yok (boş dizi) · ÇÖZÜLEMEDİ (`cwd:
// null` — değişkenli yol, `cd -`, `--git-dir`). Çözülemeyen hedefte yanlış
// ağacın kapısı KOŞULMAZ; git'in kendi kancası yedektir (bkz. bash-guard).
// Kapsam: `sh -c "…"` / `bash -lc "…"` içindeki commit ve alt kabuk `( … )`
// sınırı izlenmez — kabuk komutu incelenir, program davranışı değil.
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { calistirilacakParcalar } from "./komut-cozumleme.mjs";

/** Parçayı kabuk kelimelerine böler (tırnaklar soyulur, `\` kaçışı korunur). */
export function kelimeler(parca) {
  const out = [];
  let buf = "";
  let tirnak = null;
  let var_ = false;
  for (let i = 0; i < parca.length; i++) {
    const c = parca[i];
    if (tirnak) {
      if (c === tirnak) tirnak = null;
      else buf += c;
      continue;
    }
    if (c === "'" || c === '"') { tirnak = c; var_ = true; continue; }
    if (c === "\\" && i + 1 < parca.length) { buf += parca[++i]; var_ = true; continue; }
    if (/\s/.test(c)) { if (var_ || buf) out.push(buf); buf = ""; var_ = false; continue; }
    buf += c;
  }
  if (var_ || buf) out.push(buf);
  return out;
}

/** Yolu `cwd`ye göre çözer; değişken/komut ikamesi taşıyorsa `null` (ÖLÇÜLEMEDİ). */
export function yolCoz(cwd, yol) {
  let p = yol.replace(/^~(?=\/|$)/, homedir()).replace(/^\$(\{HOME\}|HOME)(?=\/|$)/, homedir());
  if (/[$`]/.test(p) || p === "-") return null;
  if (isAbsolute(p)) return resolve(p);
  return cwd === null ? null : resolve(cwd, p);
}

const ATAMA = /^[A-Za-z_]\w*=/;

/**
 * Komuttaki her `git … commit` için {cwd, amend, noVerify, kacis}.
 * `cwd` kabuğun başlangıç dizinidir (hook girdisindeki `cwd`).
 */
export function commitHedefleri(cmd, cwd) {
  const out = [];
  let dizin = cwd;
  for (const parca of calistirilacakParcalar(cmd)) {
    const k = kelimeler(parca.trim());
    const atamalar = [];
    while (k.length && ATAMA.test(k[0])) atamalar.push(k.shift());
    if (!k.length) continue;
    if (k[0] === "cd" || k[0] === "pushd") {
      dizin = k.length === 1 ? homedir() : yolCoz(dizin, k[1]);
      continue;
    }
    if (k[0].replace(/^.*\//, "") !== "git") continue;
    let hedef = dizin;
    let i = 1;
    while (i < k.length && k[i].startsWith("-")) {
      const o = k[i];
      if (o === "-C") { hedef = yolCoz(hedef, k[i + 1] ?? "$"); i += 2; continue; }
      if (o === "-c") { i += 2; continue; }
      if (/^--(git-dir|work-tree)\b/.test(o)) { hedef = null; i += o.includes("=") ? 1 : 2; continue; }
      i++;
    }
    if (k[i] !== "commit") continue;
    const arg = k.slice(i + 1);
    out.push({
      cwd: hedef,
      amend: arg.includes("--amend"),
      noVerify: arg.includes("--no-verify") || arg.includes("-n"),
      kacis: atamalar.includes("TEKSERP_HOOK_SKIP=1"),
    });
  }
  return out;
}

const SESSIZ = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };

/** Dizinin çalışma ağacı kökü; git deposu değilse `null`. */
export function agacKoku(dizin) {
  try {
    return execFileSync("git", ["-C", dizin, "rev-parse", "--show-toplevel"], SESSIZ).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Git'in kendi commit kapısı bu ağaç için kurulu mu. `core.hooksPath` göreli
 * (`.githooks`, ağaç köküne göre) ya da MUTLAK olabilir — worktree'ler ortak
 * config'i paylaşır ve kurulum mutlak yol yazmış olabilir. Kurulu sayılmak için
 * çözülen dizindeki `pre-commit` bizim gövdemizi (`scripts/hooks/pre-commit.mjs`) çağırmalı.
 */
export function gitKapisiKurulu(kok) {
  let hp = "";
  try { hp = execFileSync("git", ["-C", kok, "config", "--get", "core.hooksPath"], SESSIZ).trim(); } catch { return false; }
  if (!hp) return false;
  const kanca = join(isAbsolute(hp) ? hp : join(kok, hp), "pre-commit");
  if (!existsSync(kanca)) return false;
  try { return readFileSync(kanca, "utf8").includes("scripts/hooks/pre-commit.mjs"); } catch { return false; }
}
