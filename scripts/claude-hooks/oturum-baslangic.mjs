#!/usr/bin/env node
// Claude Code SessionStart hook (startup|clear): kullanıcı hafızasındaki
// `yapilacaklar-listesi.md`nin YALNIZ "## GÜNCEL DURUM" bölümünü (yoksa ilk 15 satırı)
// bağlama basar; çıktı TAVAN_KARAKTER ile kesilir — her açılış/clear bağlam bütçesinden
// yer (2026-11-03 ölçüm: 40 satır sınırı uzun satırlarda ~16 bin karakter basıyordu).
// Bekçi: scripts/test_oturum_baslangic.mjs. Her hatada sessizce çıkar (exit 0).
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const TAVAN_KARAKTER = 2000;
export const YEDEK_SATIR = 15;
const KESIK = "\n…(kesildi — tamamı hafızada: yapilacaklar-listesi.md)\n";

/** Hafıza gövdesinden basılacak parça: "## GÜNCEL DURUM" bölümü, yoksa ilk YEDEK_SATIR satır. */
export function guncelParca(metin) {
  const satirlar = metin.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
  const bas = satirlar.findIndex((s) => /^##\s+GÜNCEL DURUM/.test(s));
  if (bas === -1) return { baslik: `ilk ${YEDEK_SATIR} satır`, govde: satirlar.slice(0, YEDEK_SATIR).join("\n").trim() };
  let son = satirlar.findIndex((s, i) => i > bas && /^##\s/.test(s));
  if (son === -1) son = satirlar.length;
  return { baslik: "GÜNCEL DURUM", govde: satirlar.slice(bas, son).join("\n").trim() };
}

/** Basılacak tam metin — TAVAN_KARAKTER'i (kesik notu dâhil) asla aşmaz; satır sınırında keser. */
export function ciktiMetni(metin) {
  const { baslik, govde } = guncelParca(metin);
  const tam = `## Yapılacaklar (hafıza: yapilacaklar-listesi.md, ${baslik})\n${govde}\n`;
  if (tam.length <= TAVAN_KARAKTER) return tam;
  const pay = TAVAN_KARAKTER - KESIK.length;
  const kesit = tam.slice(0, pay);
  const sonSatir = kesit.lastIndexOf("\n");
  return (sonSatir > 0 ? kesit.slice(0, sonSatir) : kesit) + KESIK;
}

function main() {
  if (process.env.TEKSERP_HOOK_SKIP === "1") return;
  try {
    // Worktree'de de ANA ağacın hafızası okunur: proje anahtarı ortak git dizininden çözülür.
    const ortak = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const anaAgac = resolve(dirname(ortak));
    const anahtar = anaAgac.replace(/[^A-Za-z0-9]/g, "-");
    const dosya = join(homedir(), ".claude", "projects", anahtar, "memory", "yapilacaklar-listesi.md");
    if (!existsSync(dosya)) return;
    process.stdout.write(ciktiMetni(readFileSync(dosya, "utf8")));
  } catch {
    // sessiz: kanca oturumu asla engellemez
  }
}

if (process.argv[1] && process.argv[1].endsWith("oturum-baslangic.mjs")) main();
