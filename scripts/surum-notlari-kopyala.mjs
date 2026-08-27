#!/usr/bin/env node
// =============================================================================
// surum-notlari.json → panel ve tablet paketlerine kopyala
// =============================================================================
// Notlar TEK KAYNAKTA yaşar (repo kökü) ama İKİ pakete gömülür. Kopyalar
// commit edilir — üretilip .gitignore'a atılsalardı `npm run dev` ve testler
// dosyasız kalırdı. Drift'i bekçi kilitler: scripts/test_surum_notlari.ts
//
// Kullanım:
//   node scripts/surum-notlari-kopyala.mjs            # kopyala
//   node scripts/surum-notlari-kopyala.mjs --kontrol  # yalnız kıyasla (CI/bekçi)
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KAYNAK = path.join(kok, "surum-notlari.json");
const HEDEFLER = [
  path.join(kok, "Electron", "src", "data", "surum-notlari.json"),
  path.join(kok, "mobil", "src", "data", "surum-notlari.json"),
];

const kontrolKipi = process.argv.includes("--kontrol");

if (!fs.existsSync(KAYNAK)) {
  console.error(`HATA: kaynak yok — ${KAYNAK}`);
  process.exit(1);
}
const icerik = fs.readFileSync(KAYNAK, "utf8");

let sapma = 0;
for (const hedef of HEDEFLER) {
  const gorunen = path.relative(kok, hedef);
  const mevcut = fs.existsSync(hedef) ? fs.readFileSync(hedef, "utf8") : null;
  if (mevcut === icerik) {
    if (!kontrolKipi) console.log(`= ${gorunen}`);
    continue;
  }
  if (kontrolKipi) {
    console.error(`✗ ${gorunen} — kaynakla AYNI DEĞİL (node scripts/surum-notlari-kopyala.mjs)`);
    sapma++;
    continue;
  }
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  fs.writeFileSync(hedef, icerik);
  console.log(`→ ${gorunen}`);
}

if (kontrolKipi && sapma > 0) process.exit(1);
if (kontrolKipi) console.log("Kopyalar kaynakla aynı.");
