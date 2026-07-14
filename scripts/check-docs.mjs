#!/usr/bin/env node
// =============================================================================
// Doküman bayatlık bekçisi (zero-dep, Node ESM) — CI'da koşar.
// =============================================================================
// AMAÇ: Dokümantasyonun koda karşı sessizce bayatlamasını önlemek. Bu proje hızlı
// redesign'lar geçirdi (çuval/parti/kart/rota-final); docs kolayca kaldırılmış
// dosya/sembollere atıf yapar hâle gelir ve yapay zekayı / yeni geliştiriciyi
// yanlış yönlendirir. İki mekanik kontrol (prose doğruluğu makineyle denetlenemez):
//
//   [GATE] ÖLÜ DOKÜMAN-LİNK: bir doküman repo-içi dosyaya (docs/... , Teks-Erp/src/...)
//     atıf yapıyor ama dosya YOKSA → CI FAIL. Hassas, ~sıfır false-positive.
//     (Bu oturumda bir doküman taşındığında referanslar kırıldı — tam bu senaryo.)
//
//   [ADVISORY] KALDIRILMIŞ-SEMBOL: docs kaldırılmış bir sembolü (batchSplitId,
//     MachineLog, packedQty...) anıyorsa listeler. CI'ı FAIL ETMEZ — tasarım
//     dokümanları doğası gereği "X'ten Y'ye geçtik" anlatır (tarihsel bağlam
//     meşrudur), bu yüzden gürültülüdür; periyodik insan-incelemesi için rapor.
//
// Çalıştır: node scripts/check-docs.mjs           (npm run check:docs)
// Çıkış kodu: ölü-link varsa 1, yoksa 0 (advisory çıkışı etkilemez).
// =============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Redesign'larda KALDIRILAN semboller (advisory). `word:true` → kelime-sınırı ile
// eşleş (uzun tanımlayıcıların içinde yanlış eşleşmesin, ör. writeShipmentAllocationsTx).
const REMOVED_SYMBOLS = [
  { sym: "batchSplitId", word: false },
  { sym: "MachineLog", word: true },
  { sym: "packedQty", word: false },
  { sym: "rebalanceCustomerPool", word: false },
  { sym: "sealSack", word: false },
  { sym: "sealedAt", word: false },
  { sym: "sealedById", word: false },
  { sym: "markReady", word: false },
  { sym: "readyById", word: false },
  { sym: "ShipmentAllocation", word: true },
  { sym: "manualCode", word: false },
  { sym: "recover-to-production", word: false },
  { sym: "Durum Düzelt", word: false },
  { sym: "PRODUCED", word: true },
  { sym: "AT_DOOR", word: true },
];

// "Bu kaldırıldı/tarihsel" bağlam işaretçileri — satırda VEYA ±2 komşu satırda
// varsa advisory listesine ALINMAZ (meşru "we removed X" / "eski model" açıklaması).
const REMOVAL_MARKER = /(kalk|kaldır|removed|supersed|süpersed|\beski\b|önceki|YOK|artık|DROP|drop|DEĞİL|değil|terk edil|silin|çıkar|söker|değişti|legacy|deprecated|~~|→)/i;

// tsx, ts'ten ÖNCE denenmeli (tsx? ile) yoksa 'foo.tsx' → 'foo.ts' yanlış eşleşir.
const PATH_RE = /(docs|Teks-Erp|Electron|mobil)\/[A-Za-z0-9._/-]+\.(md|tsx?|sql|mjs)/g;

const SKIP_DIRS = new Set(["node_modules", ".git", ".expo", "dist", "build", ".next"]);
const SKIP_PATHS = ["docs/history/", "docs/akademik/"];
const SKIP_FILES = new Set(["GEREKSIZ-ADAYLAR.md"]); // geçici karar-aidi (bilerek bayat-sembol tartışır)

function walkMd(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(REPO_ROOT, full).replace(/\\/g, "/");
    if (SKIP_PATHS.some((p) => rel.startsWith(p))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walkMd(full, out);
    else if (name.endsWith(".md") && !SKIP_FILES.has(name)) out.push(full);
  }
  return out;
}

function symMatches(line, sym, word) {
  if (!word) return line.includes(sym);
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${esc}([^A-Za-z0-9_]|$)`).test(line);
}

const deadLinks = [];
const advisories = [];
const mdFiles = walkMd(REPO_ROOT);

for (const file of mdFiles) {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  // ±2 satır penceresinde removal-marker var mı?
  const nearMarker = (i) =>
    [lines[i - 2], lines[i - 1], lines[i], lines[i + 1], lines[i + 2]]
      .some((l) => l && REMOVAL_MARKER.test(l));

  lines.forEach((line, i) => {
    // [GATE] Ölü doküman-link
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[0];
      if (p.includes("*") || p.includes("...") || p.includes("<")) continue;
      if (!existsSync(join(REPO_ROOT, p))) {
        deadLinks.push({ file: rel, line: i + 1, path: p, text: line.trim().slice(0, 130) });
      }
    }
    // [ADVISORY] Kaldırılmış-sembol (removal-context'siz)
    if (!nearMarker(i)) {
      for (const { sym, word } of REMOVED_SYMBOLS) {
        if (symMatches(line, sym, word)) {
          advisories.push({ file: rel, line: i + 1, sym, text: line.trim().slice(0, 110) });
        }
      }
    }
  });
}

// --- ADVISORY (CI'ı etkilemez) ---
if (advisories.length) {
  console.log(`⚠️  ADVISORY — ${advisories.length} kaldırılmış-sembol atfı (removal-marker'sız; tarihsel bağlam meşru olabilir, insan incelemesi):`);
  for (const a of advisories) console.log(`    ${a.file}:${a.line}  '${a.sym}'  → ${a.text}`);
  console.log("");
}

// --- GATE: ölü-link (CI FAIL) ---
if (deadLinks.length === 0) {
  console.log(`✅ Doküman bekçisi: ölü doküman-link yok (${mdFiles.length} .md tarandı).`);
  process.exit(0);
}

console.error(`❌ Doküman bekçisi ${deadLinks.length} ÖLÜ LİNK buldu (${mdFiles.length} .md tarandı):\n`);
for (const d of deadLinks) {
  console.error(`  ${d.file}:${d.line}`);
  console.error(`      '${d.path}' mevcut değil (taşınmış/yeniden-adlandırılmış?)`);
  console.error(`      → ${d.text}\n`);
}
console.error("Düzelt: yolu güncelle (dosya taşındıysa yeni yerine), ya da atfı kaldır.");
process.exit(1);
