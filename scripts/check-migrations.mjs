#!/usr/bin/env node
// =============================================================================
// Migration hijyen bekçisi (zero-dep, Node ESM) — yerelde + CI'da koşar.
// =============================================================================
// NEDEN VAR: 2026-07-30'da ÜÇ migration dev DB'sine `prisma db execute` ile
// uygulandı ama GİT'E HİÇ GİRMEDİ (`git log -- <dizin>` boş). `prisma migrate
// deploy` YALNIZ dizindeki dosyaları uygular → production'da `sacks.notes` kolonu
// ve `LabelKind.SACK` enum değeri hiç oluşmaz. Deploy "All migrations applied"
// yazıp BAŞARILI görünür, sonra çuval akışının TAMAMI + HER irsaliye baskısı
// P2022 ile 500 döner (shipping.service `listCustomerPoolSacks` /
// `getShipmentSackContents` / `resolveLiveRowNotes`, sack-search'ün 4 ucu,
// label.service `getSackLabel`).
//
// Aynı oturumda `scripts/test_sack_notes.ts` de untracked'ti — yani CI'daki
// gerçek gate de (boş DB'ye `migrate deploy` + `npm test` → P2022 ile KIRMIZI)
// kör kalmıştı. Kolonu okuyan test commit edilir ama migration edilmezse CI
// yakalar; ikisi birlikte unutulursa hiçbir şey yakalamaz. Bu bekçi tam o
// pencereyi kapatır.
//
//   [GATE 1] prisma/migrations altında UNTRACKED dosya → FAIL.
//   [GATE 2] prisma/migrations altında MODIFIED/DELETED dosya → FAIL.
//            Uygulanmış migration IMMUTABLE'dır: `_prisma_migrations` checksum
//            tutar, dosyayı değiştirmek "migration modified after applied"
//            hatasıyla deploy'u kilitler.
//   [GATE 3] her migration dizini `migration.sql` içeriyor mu (boş/yarım dizin).
//   [GATE 4] scripts/test_*.ts UNTRACKED → FAIL. Test commit edilmezse CI'ın
//            P2022 gate'i kaybolur.
//   [GATE 5] package.json script'lerinin ANDIĞI yerel dosya UNTRACKED/EKSİK → FAIL.
//            2026-08-01 denetiminde tam bu boşluk yakalandı: `tsconfig.scripts.json`
//            ve `mobil/scripts/build-apk.mjs` commit EDİLMİŞ package.json'lardan
//            çağrılıyordu ama kendileri untracked'ti. Yerelde her şey yeşil (dosya
//            diskte var), temiz checkout'ta `npm test` ve `npm run build:apk` ilk
//            satırda ölür. GATE 1/4 ile aynı hata sınıfı, farklı dizin.
//

// Çalıştır: node scripts/check-migrations.mjs      (Teks-Erp: npm run check:migrations)
// Çıkış kodu: ihlal varsa 1, yoksa 0.
//
// ⚠️ Bu bekçinin değeri YERELDEDİR. CI'da checkout temiz olduğu için untracked
// dosya hiç görünmez — orada bilinçli olarak "her zaman yeşil" bir dokümantasyon
// adımıdır. Commit ETMEDEN sevk edemeyeceğini yerelde öğrenmen gerekir.
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = "Teks-Erp/prisma/migrations";
const SCRIPTS_DIR = "Teks-Erp/scripts";

function git(args) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

// `git status --porcelain` satırı: "XY <yol>". Untracked "??", değişmiş " M"/"M ",
// silinmiş " D"/"D ". `--untracked-files=all` dizin özeti yerine tek tek dosya verir
// (yoksa yeni bir migration dizini tek "?? .../dizin/" satırına çöker ve içindeki
// dosyaları göremeyiz).
function statusEntries(pathspec) {
  const out = git(["status", "--porcelain", "--untracked-files=all", "--", pathspec]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ code: l.slice(0, 2), path: l.slice(3).trim().replace(/^"|"$/g, "") }));
}

const problems = [];

// --- GATE 1 + 2: migration dizini git durumu -------------------------------
const migEntries = existsSync(join(REPO_ROOT, MIGRATIONS_DIR))
  ? statusEntries(MIGRATIONS_DIR)
  : [];

const untrackedMig = migEntries.filter((e) => e.code === "??");
// "A " = index'e EKLENMİŞ, çalışma kopyası temiz YENİ dosya. Bu, kuralın TAM
// OLARAK istediği ara durumdur (CLAUDE.md: `git add` → `prisma db execute` →
// `migrate resolve --applied` → doğrula → commit) ve GATE 2'ye girmez:
//   • GATE 1 sağlanır — dosya artık izleniyor, `migrate deploy` onu görecek.
//   • GATE 2 kavramsal olarak UYGULANMIŞ (yani commit'li geçmişte var olan) bir
//     dosyanın değiştirilmesini kovalar; henüz commit edilmemiş YENİ bir dosyanın
//     "checksum'ı bozuldu" diye kilitleyeceği bir deploy yok.
// "AM" (eklendikten SONRA düzenlenmiş) ve " M"/" D" hâlâ GATE 2'ye düşer —
// tam da `db execute` sonrası dosyayı kurcalayan tehlikeli hâl budur.
const changedMig = migEntries.filter((e) => e.code !== "??" && e.code !== "A ");

if (untrackedMig.length) {
  problems.push({
    gate: "GATE 1 — COMMIT EDİLMEMİŞ MIGRATION",
    why:
      "Bu dosyalar git'te YOK. `prisma migrate deploy` yalnız dizindeki dosyaları\n" +
      "  uygular; commit edilmezse production'a HİÇ gitmez ve kod eski şemaya karşı\n" +
      "  koşup P2022 verir (deploy yine 'başarılı' görünür).",
    items: untrackedMig.map((e) => e.path),
    fix: `git add ${MIGRATIONS_DIR}`,
  });
}

if (changedMig.length) {
  problems.push({
    gate: "GATE 2 — UYGULANMIŞ MIGRATION DEĞİŞTİRİLMİŞ",
    why:
      "Migration dosyaları IMMUTABLE'dır — `_prisma_migrations` checksum tutar.\n" +
      "  Uygulanmış bir dosyayı değiştirmek deploy'u 'migration modified after it\n" +
      "  was applied' ile KİLİTLER. Değişiklik gerekiyorsa YENİ migration yaz.",
    items: changedMig.map((e) => `${e.code.trim()} ${e.path}`),
    fix: "Dosyayı eski hâline al (git checkout --) ve düzeltmeyi YENİ bir migration'a yaz",
  });
}

// --- GATE 3: her migration dizini migration.sql içeriyor mu ----------------
const migRoot = join(REPO_ROOT, MIGRATIONS_DIR);
if (existsSync(migRoot)) {
  const emptyDirs = readdirSync(migRoot)
    .filter((d) => statSync(join(migRoot, d)).isDirectory())
    .filter((d) => !existsSync(join(migRoot, d, "migration.sql")));
  if (emptyDirs.length) {
    problems.push({
      gate: "GATE 3 — migration.sql EKSİK",
      why: "Prisma bu dizini pending sayar ama uygulayacak SQL bulamaz.",
      items: emptyDirs,
      fix: "Dizine migration.sql ekle ya da dizini sil",
    });
  }
}

// --- GATE 4: untracked test dosyaları --------------------------------------
const untrackedTests = existsSync(join(REPO_ROOT, SCRIPTS_DIR))
  ? statusEntries(SCRIPTS_DIR).filter(
      (e) => e.code === "??" && /(^|\/)test_[^/]*\.ts$/.test(e.path)
    )
  : [];

if (untrackedTests.length) {
  problems.push({
    gate: "GATE 4 — COMMIT EDİLMEMİŞ TEST",
    why:
      "Testler CI'ın gerçek şema gate'idir: boş DB'ye `migrate deploy` + `npm test`\n" +
      "  koşuluyor, yeni kolonu okuyan bir test migration'sız kalırsa CI KIRMIZI olur.\n" +
      "  Test de commit edilmezse o gate kaybolur ve hata production'da bulunur.",
    items: untrackedTests.map((e) => e.path),
    fix: `git add ${SCRIPTS_DIR}/test_*.ts`,
  });
}

// --- GATE 5: package.json script'lerinin andığı yerel dosyalar --------------
// NEDEN: `npm test` → `tsx scripts/run-all-tests.ts` → `tsc -p tsconfig.scripts.json`
// zinciri commit'li package.json'dan başlar. Zincirdeki BİR dosya untracked'se
// zincir yalnız bu makinede çalışır; CI/temiz klon/production'da kopar. Migration
// untracked'liğiyle aynı sessiz başarısızlık: "bende çalışıyordu".
const PKG_JSONS = ["package.json", "Teks-Erp/package.json", "mobil/package.json", "Electron/package.json"];
// Yalnız yerel dosya gibi görünen token'lar: bilinen uzantı + glob YOK.
// (`eslint src`, `expo start`, `2>&1` gibi token'lar elenir.)
const FILE_TOKEN = /^[.\w/-]+\.(?:ts|tsx|js|mjs|cjs|json)$/;

/** git index'te izleniyor mu? (staged-ama-commit'siz dosyalar da izleniyor SAYILIR) */
function isTracked(repoRelPath) {
  return git(["ls-files", "--", repoRelPath]).trim().length > 0;
}

/**
 * `.gitignore` bu yolu dışlıyor mu?
 *
 * ⚠️ 2026-09-05'te bu ayrım eklendi: DERLEME ÇIKTISI meşruen izlenmez. Backend
 * sunucu araçlarını `dist/tools/*.cjs`e derler (`npm run build`) ve package.json
 * onları oradan çağırır (`superadmin:kur`). Kapı bunu "commit edilmemiş dosya"
 * sanıp kırmızı veriyordu — kuralın konusu ise "bu makinede var, temiz klonda
 * yok" sınıfıdır ve derleme çıktısı o sınıfa GİRMEZ: temiz klonda `npm run build`
 * onu üretir.
 *
 * Ama muafiyet KOŞULLUDUR: yok sayılan bir yola atıf, ancak aynı package.json
 * onu ÜRETEN bir `build*` script'i taşıyorsa meşrudur. Yoksa dosya ne izlenir ne
 * üretilir — tam da kapının aradığı sessiz kopukluk.
 */
function isIgnored(repoRelPath) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", repoRelPath], { cwd: REPO_ROOT });
    return true;
  } catch {
    return false; // çıkış kodu 1 = yok sayılmıyor
  }
}

const scriptRefProblems = [];
for (const pkgRel of PKG_JSONS) {
  const pkgAbs = join(REPO_ROOT, pkgRel);
  if (!existsSync(pkgAbs)) continue;
  const pkgDir = dirname(pkgRel); // "." | "Teks-Erp" | ...
  let scripts;
  try {
    scripts = JSON.parse(readFileSync(pkgAbs, "utf8")).scripts ?? {};
  } catch {
    continue; // bozuk package.json bu bekçinin işi değil
  }
  for (const [name, cmd] of Object.entries(scripts)) {
    for (const raw of String(cmd).split(/\s+/)) {
      const token = raw.replace(/^["']|["']$/g, "");
      if (!FILE_TOKEN.test(token) || /[*?]/.test(token)) continue;
      // package.json'ın KENDİ dizinine göre çöz, sonra repo köküne indir.
      const repoRel = normalize(join(pkgDir, token)).replace(/\\/g, "/");
      if (repoRel.startsWith("..")) continue; // repo dışına çıkan referans (yok ama güvenli)
      const abs = join(REPO_ROOT, repoRel);
      // Derleme çıktısı: yok sayılan yol + aynı package.json'da onu üreten bir
      // `build*` script'i varsa muaf (yukarıdaki isIgnored notu).
      if (isIgnored(repoRel)) {
        const uretiliyor = Object.keys(scripts).some((s) => /^build/i.test(s));
        if (!uretiliyor) {
          scriptRefProblems.push(
            `${repoRel}  (YOK SAYILIYOR ama ÜRETEN build script'i YOK — ${pkgRel} → "${name}")`,
          );
        }
        continue;
      }
      if (!existsSync(abs)) {
        scriptRefProblems.push(`${repoRel}  (EKSİK — ${pkgRel} → "${name}")`);
      } else if (!isTracked(repoRel)) {
        scriptRefProblems.push(`${repoRel}  (UNTRACKED — ${pkgRel} → "${name}")`);
      }
    }
  }
}

if (scriptRefProblems.length) {
  problems.push({
    gate: "GATE 5 — package.json'un ANDIĞI DOSYA COMMIT EDİLMEMİŞ/EKSİK",
    why:
      "package.json commit'li ama çağırdığı dosya git'te YOK. Bu makinede çalışır,\n" +
      "  temiz klonda / CI'da / production'da komut ilk satırda ölür (`npm test`,\n" +
      "  `npm run build:apk` gibi). Migration untracked'liğiyle aynı hata sınıfı.",
    items: [...new Set(scriptRefProblems)],
    fix: "git add <dosya>  (ya da package.json'daki referansı kaldır)",
  });
}

// --- [ADVISORY] RESTRICT FK → o ebeveyni silen bekçiler ----------------------
// KIRMIZI VERMEZ. Kaybolan şey bilgi, karar değil.
//
// VAKA (2026-09-12, aynı gün İKİ kez): yeni bir defter tablosu `RESTRICT` ilişkisiyle
// doğdu, var olan bir bekçinin temizliği ebeveyni ÖNCE siliyordu → P2003. Migration'ı
// yazan kişi yeni tabloyu düşünüyor, ESKİ temizlikleri düşünmüyor; o listeyi kimse
// göstermiyordu.
//
// ⚠️ NEDEN MIGRATION-TETİKLİ: statik kurgu (şemadaki her RESTRICT ebeveyni × onu silen
// her bekçi) ölçüldü ve **1621 satır** veriyordu — okunmayan doğru, kapının üçüncü ölüm
// biçimi. Değişim ölçen kurgu `ImportRun` için **3 ad** basıyor. Fark kapsamda: biri
// DURUMU, öbürü DEĞİŞİMİ ölçer.
//
// ⚠️ ŞERH (2026-09-13): bu dosyanın `git status` okuması kısmi (pathspec) commit'te
// yanıltıcı olabiliyor — git geçici indeks kuruyor ve başkasının sahnelenmiş dosyası
// `??` görünüyor (d5 ölçtü, düzeltmesi ayrı iş). Aşağısı `merge-base` ve dosya okumaya
// dayanır, `status`a değil; yine de d5'in düzeltmesi gelince birlikte gözden geçirilecek.
const YENI_MIGRATION_TABAN = (() => {
  try {
    return git(["merge-base", "HEAD", "origin/main"]).trim();
  } catch {
    return "";
  }
})();

if (YENI_MIGRATION_TABAN) {
  let eskiDizinler = new Set();
  try {
    eskiDizinler = new Set(
      git(["ls-tree", "--name-only", `${YENI_MIGRATION_TABAN}:${MIGRATIONS_DIR}`])
        .split("\n")
        .map((x) => x.replace(/\/$/, ""))
        .filter(Boolean)
    );
  } catch {
    eskiDizinler = new Set();
  }

  const yeniDizinler = existsSync(join(REPO_ROOT, MIGRATIONS_DIR))
    ? readdirSync(join(REPO_ROOT, MIGRATIONS_DIR)).filter(
        (d) =>
          statSync(join(REPO_ROOT, MIGRATIONS_DIR, d)).isDirectory() && !eskiDizinler.has(d)
      )
    : [];

  // Yeni migration'larda eklenen RESTRICT/NO ACTION FK'larının EBEVEYN tablosu
  const ebeveynler = new Set();
  for (const d of yeniDizinler) {
    const sqlYol = join(REPO_ROOT, MIGRATIONS_DIR, d, "migration.sql");
    if (!existsSync(sqlYol)) continue;
    const sql = readFileSync(sqlYol, "utf8");
    for (const m of sql.matchAll(
      /REFERENCES\s+"?(\w+)"?\s*\([^)]*\)\s*ON DELETE (RESTRICT|NO ACTION)/gi
    )) {
      ebeveynler.add(m[1]);
    }
  }

  if (ebeveynler.size > 0) {
    const bekciler = existsSync(join(REPO_ROOT, SCRIPTS_DIR))
      ? readdirSync(join(REPO_ROOT, SCRIPTS_DIR)).filter(
          (f) => f.startsWith("test_") && f.endsWith(".ts")
        )
      : [];
    const uyarilar = [];
    for (const tablo of [...ebeveynler].sort()) {
      // `import_run_lines` → `importRun` (Prisma delegate adı)
      const tekil = tablo.replace(/s$/, "");
      const delegate = tekil.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const desen = new RegExp(`(?:prisma|tx)\\.${delegate}\\.deleteMany`);
      const eslesen = bekciler.filter((f) =>
        desen.test(readFileSync(join(REPO_ROOT, SCRIPTS_DIR, f), "utf8"))
      );
      if (eslesen.length > 0) uyarilar.push({ tablo, delegate, eslesen });
    }

    if (uyarilar.length > 0) {
      console.log("\n⚠️  [ADVISORY] yeni RESTRICT FK'sı — bu ebeveyni SİLEN bekçiler:");
      for (const u of uyarilar) {
        if (u.eslesen.length > 10) {
          // Uzunluğun kendisi bir bulgudur: bu kadar bekçiyi ilgilendiren bir FK
          // muhtemelen `Cascade` olmalıydı.
          console.log(
            `   ${u.tablo} (${u.delegate}) — ${u.eslesen.length} bekçi. GENİŞ ETKİLİ, ` +
              `onDelete kararını gözden geçir. İlk beşi:`
          );
          for (const f of u.eslesen.slice(0, 5)) console.log(`     · ${f}`);
        } else {
          console.log(`   ${u.tablo} (${u.delegate}):`);
          for (const f of u.eslesen) console.log(`     · ${f}`);
        }
      }
      console.log(
        "   → Bu bekçilerin temizliği ÇOCUĞU önce silmeli, yoksa P2003. Tavsiyedir, kırmızı değil.\n"
      );
    }
  }
}

// --- Rapor ------------------------------------------------------------------
if (problems.length === 0) {
  const count = existsSync(migRoot)
    ? readdirSync(migRoot).filter((d) => statSync(join(migRoot, d)).isDirectory()).length
    : 0;
  console.log(
    `✅ Migration bekçisi: ${count} migration izleniyor, commit edilmemiş/değiştirilmiş dosya yok.`
  );
  process.exit(0);
}

console.error("❌ Migration bekçisi ihlal buldu:\n");
for (const p of problems) {
  console.error(`  [${p.gate}]`);
  console.error(`  ${p.why}`);
  for (const it of p.items) console.error(`    • ${it}`);
  console.error(`  → Düzelt: ${p.fix}\n`);
}
console.error(
  "KURAL: elle yazılan migration `git add` EDİLMEDEN `prisma db execute` KOŞULMAZ\n" +
    "(Teks-Erp/CLAUDE.md). Dosya DB'ye uygulanmadan önce izlenir olmalı."
);
process.exit(1);
