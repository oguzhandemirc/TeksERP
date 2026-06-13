// DB-1: PK + FK String kolonlarına native @db.Uuid ekle.
// Hedef: (a) @id @default(uuid()) PK'ler, (b) @relation(fields:[...]) FK'leri,
// (c) SystemLogArchive.id + userId (uuid değer taşır ama @default/@relation yok).
// ATLA: PairingCode.code, SystemSetting.key (uuid değil PK), recordId/batchSplitId
// (formal FK olmayan, uuid olmayabilen string kolonlar) — bunlar otomatik hariç.
import fs from "fs";

const path = "prisma/schema.prisma";
const lines = fs.readFileSync(path, "utf8").split("\n");

// --- Pass 1: model başına hedef alan adları ---
let model = null;
const targets = {};
for (const line of lines) {
  const mm = line.match(/^model\s+(\w+)\s*\{/);
  if (mm) { model = mm[1]; targets[model] = new Set(); continue; }
  if (line.trim() === "}") { model = null; continue; }
  if (!model) continue;
  const rel = line.match(/@relation\([^)]*fields:\s*\[([^\]]+)\]/);
  if (rel) rel[1].split(",").forEach((f) => targets[model].add(f.trim()));
  if (/@id\b/.test(line) && /@default\(uuid\(\)\)/.test(line)) {
    targets[model].add(line.trim().split(/\s+/)[0]);
  }
}
// SystemLogArchive: id (kopyalanan uuid, @default yok) + userId (relation yok ama uuid)
if (targets["SystemLogArchive"]) {
  targets["SystemLogArchive"].add("id");
  targets["SystemLogArchive"].add("userId");
}

// --- Pass 2: hedef scalar String alanlara @db.Uuid ekle ---
model = null;
let changed = 0;
const out = lines.map((line) => {
  const mm = line.match(/^model\s+(\w+)\s*\{/);
  if (mm) { model = mm[1]; return line; }
  if (line.trim() === "}") { model = null; return line; }
  if (!model || line.includes("@db.Uuid")) return line;
  const fm = line.match(/^(\s+)(\w+)(\s+)(String\??)(.*)$/);
  if (!fm) return line;
  if (!targets[model].has(fm[2])) return line;
  changed++;
  return `${fm[1]}${fm[2]}${fm[3]}${fm[4]} @db.Uuid${fm[5]}`;
});

fs.writeFileSync(path, out.join("\n"));
console.log("Annotated @db.Uuid alan sayısı:", changed);
