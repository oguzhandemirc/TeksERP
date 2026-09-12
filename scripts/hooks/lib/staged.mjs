// =============================================================================
// Staged dosyalardan "hangi alt proje etkilendi" çözümü — TEK KAYNAK.
// =============================================================================
// İki kapı aynı soruyu soruyor: `.githooks/pre-commit` (git) ve
// `scripts/claude-hooks/bash-guard.mjs` (Claude'un Bash aracı). Ayrı kopyalar
// ayrışırsa biri commit'i durdurur öbürü geçirir ve hangisinin doğru olduğu
// belli olmaz — bu repoda "türetilmiş alan / ayrışan yüzey" sınıfı tam olarak
// budur (kök CLAUDE.md § Tek kaynak).
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Kod dosyası mı — tip/lint kapısının konusu. */
export function codeFile(f) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|prisma)$/.test(f);
}

const BOS_AGAC = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// ⚠️ stderr YUTULUR: ilk commit'te `HEAD^` yoktur ve git "fatal: Needed a single
// revision" basar. Yakalanan bir hatanın metnini kullanıcıya göstermek, kapı
// çalışıyorken "bir şey bozuldu" izlenimi verir; dal zaten geniş tarafa düşüyor.
const SESSIZ = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
const ps = (pid) => execFileSync("ps", ["-o", "args=", "-p", String(pid)], SESSIZ);
const revParse = (repo, ref) =>
  execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: repo, ...SESSIZ }).trim();

/**
 * OLUŞACAK COMMIT'İN EBEVEYNİ — normalde HEAD, `--amend`'de HEAD^.
 *
 * NEDEN: `git diff --cached` **index ↔ HEAD**'dir. `--amend`'de HEAD, değiştirilmekte
 * olan commit'in KENDİSİDİR; kapı yalnız amend'de EKLENEN deltayı görür, ortaya çıkan
 * commit'in içeriğini değil. Bu bir hata değil, YANLIŞ TABAN. Ölçüm (2026-09-12):
 * mobil kod commit'i + amend ile bir `.md` eklenince kapı 6 adım yerine 1 adım koştu;
 * mobil tip/lint/867 test ve tanımlayıcı dili SESSİZCE düştü. Aynı gün ikinci vaka
 * daha görüldü — yani tek seferlik değil.
 *
 * Git pre-commit'e amend'i bildiren bir değişken YOKTUR (iki koşumun ortamı yan yana
 * döküldü: `GIT_*` birebir aynı). Kademeli teşhis, her basamağın hata yönü GENİŞ tarafa:
 *
 *   1) TEKSERP_COMMIT_BASE — KESİN yol. `bash-guard.mjs` komut METNİNİ elinde tutar
 *      (`git commit --amend`), tahmine gerek yok. O yolda git HENÜZ KOŞMAMIŞTIR:
 *      ne `GIT_AUTHOR_DATE` vardır ne PPID git'tir, yani 2 ve 3 orada ÇALIŞMAZ ve
 *      kademe hep son basamağa düşerdi (her commit geniş koşardı).
 *   2) `ps` ile ebeveyn komut satırında `--amend` — git hook yolu (hook'un ebeveyni
 *      doğrudan git sürecidir, araya sh girmediği ölçüldü).
 *   3) `GIT_AUTHOR_DATE` == HEAD'in author date'i — amend author date'i KORUR.
 *   Hiçbiri okunamazsa AMEND VARSAYILIR.
 *
 * ⚠️ DARALTAN SİNYALİN KURALI — değeri değil KAYNAĞI doğrula. Env yalnız ebeveyn
 * sürecin gerçekten `bash-guard.mjs` olduğu ÖLÇÜLDÜĞÜNDE dinlenir (beyan değil ölçüm)
 * ve yalnız {HEAD, HEAD^} kümesinden bir değer kabul edilir — env üçüncü bir yer icat
 * edemez. `rev-parse --verify` tek başına YETMEZ: bir SHA'nın VAR olduğunu kanıtlar,
 * DOĞRU ebeveyn olduğunu değil.
 *
 * ⚠️ NEDEN BOOLEAN DEĞİL SHA: `TEKSERP_AMEND=0` ebediyen geçerli, dolayısıyla ebediyen
 * tehlikelidir — kabukta unutulursa kapıyı sonsuza dek daraltır. SHA ise repo bir commit
 * ilerlediği anda ne HEAD'e ne HEAD^'e uyar ve REDDEDİLİR: yanlış değer kendi kendini
 * emekliye ayırır.
 *
 * ⚠️ KAPININ ÇÖKMESİ KAÇIŞ KULLANMAKTAN BETERDİR: kaçış bir karardır ve commit mesajında
 * görünür; çökme herkesi SESSİZCE kapısız bırakır. Bu yüzden her dal try/catch'li ve her
 * catch geniş tarafa düşer — ilk commit'te `HEAD^` yoktur, orada boş ağaç hash'i döner
 * (küme = index'in tamamı, en geniş hâl).
 */
export function commitTabani(repo, acikAmend) {
  let head = null;
  let parent = null;
  let psOk = false;
  let bashGuard = false;
  try { head = revParse(repo, "HEAD"); } catch { /* ilk commit */ }
  try { parent = revParse(repo, "HEAD^"); } catch { /* kök commit */ }
  // AYNI SÜREÇTE çağıran bilgiyi AÇIKÇA veriyorsa tahmin yok: `bash-guard.mjs`
  // komut metnini elinde tutar ve `commitTabani(REPO, /--amend/.test(cmd))` der.
  // Env'e hiç dokunulmaz; env yalnız AYRI SÜREÇTE (spawn edilen pre-commit) gerekir.
  if (typeof acikAmend === "boolean") return acikAmend ? (parent ?? BOS_AGAC) : (head ?? BOS_AGAC);

  try { bashGuard = /bash-guard\.mjs/.test(ps(process.ppid)); psOk = true; } catch { /* ps yok */ }

  if (psOk && bashGuard) {
    const istenen = (process.env.TEKSERP_COMMIT_BASE || "").trim();
    if (istenen && (istenen === head || istenen === parent)) return istenen;
  }
  if (!psOk) return parent ?? BOS_AGAC;

  let amend = false;
  let kararVerildi = false;
  try { amend = /--amend\b/.test(ps(process.ppid)); kararVerildi = true; } catch { /* yukarıda */ }
  if (!kararVerildi) {
    try {
      const env = (process.env.GIT_AUTHOR_DATE || "").replace(/^@/, "").split(" ")[0];
      const at = execFileSync("git", ["log", "-1", "--format=%at"], { cwd: repo, ...SESSIZ }).trim();
      if (env) { amend = env === at; kararVerildi = true; }
    } catch { /* okunamadı */ }
  }
  if (!kararVerildi) amend = true;

  return amend ? (parent ?? BOS_AGAC) : (head ?? BOS_AGAC);
}

/** Commit'e alınmış (staged) dosyalar — TABAN'a karşı. Git yoksa boş dizi. */
export function stagedFiles(repo, acikAmend) {
  try {
    return execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR", commitTabani(repo, acikAmend)],
      { cwd: repo, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Alt proje tanımları — dizin, tip kontrolü ve test komutları. */
export const PROJELER = [
  {
    ad: "Teks-Erp",
    typecheck: ["npm", ["run", "typecheck:plain"]],
    lint: ["npm", ["run", "lint"]],
    // Backend bekçi paketi 6,5 dakikadır → commit kadansında DEĞİL (K8: PR/push).
    test: null,
  },
  {
    ad: "Electron",
    typecheck: ["npm", ["run", "typecheck:plain"]],
    lint: ["npm", ["run", "lint"]],
    test: ["npx", ["vitest", "run"]], // ölçüm: 23 sn
  },
  {
    ad: "mobil",
    typecheck: ["npx", ["tsc", "--noEmit", "--pretty", "false"]],
    lint: ["npm", ["run", "lint"]],
    test: ["npx", ["jest", "--runInBand"]], // ölçüm: 29 sn
  },
];

/** Staged dosyalardan etkilenen alt projeler (kod dosyası şartıyla). */
export function etkilenenProjeler(repo, staged) {
  return PROJELER.filter(
    (p) =>
      staged.some((f) => f.startsWith(`${p.ad}/`) && codeFile(f)) &&
      existsSync(join(repo, p.ad, "package.json")),
  );
}
