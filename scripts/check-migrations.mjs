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
//
// Çalıştır: node scripts/check-migrations.mjs      (Teks-Erp: npm run check:migrations)
// Çıkış kodu: ihlal varsa 1, yoksa 0.
//
// ⚠️ Bu bekçinin değeri YERELDEDİR. CI'da checkout temiz olduğu için untracked
// dosya hiç görünmez — orada bilinçli olarak "her zaman yeşil" bir dokümantasyon
// adımıdır. Commit ETMEDEN sevk edemeyeceğini yerelde öğrenmen gerekir.
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
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
