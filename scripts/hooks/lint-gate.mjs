#!/usr/bin/env node
// =============================================================================
// LINT KAPISI — commit'in KENDİ dosyalarında kırmızı, yabancı dosyada UYARI.
// =============================================================================
// VAKA (2026-09-13): ortak çalışma ağacında lint kapısı dört kez YANLIŞ KİŞİYİ
// durdurdu. Mekanizma GATE 1/4'ünkinden FARKLI: `npm run lint` → `eslint src
// scripts prisma`, yani DİZİN alır ve git'e hiç sormaz. Ölçüldü: ağaca takipsiz
// bir dosya kondu, 1114 dosya tarandı ve sonda dosyası TARANDI. Yani lint DOĞRU
// ağacı okuyor — kusur okumada değil, VERDİKTTE: başkasının yarım kalmış
// dosyasındaki hata benim commit'imi durduramaz.
//
// KARAR (kullanıcı onaylı, üç şart):
//   · commit'e GİREN dosyada hata  → KIRMIZI (çıkış 1)
//   · yalnız YABANCI dosyada hata  → UYARI + çıkış 0, dosya ADIYLA
//   · SAHİP UYDURULMAZ — "yabancı" yalnız "bu commit'e girmiyor" demektir; dosyayı
//     kimin bıraktığı ölçülemez (unutulmuş kendi düzenlemen de olabilir).
//
// ⚠️ TARANAN KÜME DARALMAZ, YALNIZ VERDİKT DARALIR. Aynı argv, aynı kural seti —
//    çünkü `lint tavanı` (check-lint-baseline.mjs) aynı kümeyi ölçmek zorundadır;
//    kapsamı burada daraltmak "tavan aşılmadı" cümlesini anlamsız kılardı.
//
// ⚠️ BU DOSYA CI'DA KOŞMAZ ve KOŞMAMALIDIR. CI checkout'unda hiçbir şey staged
//    değildir → her dosya "yabancı" olurdu → kapı yapısal olarak hep yeşil.
//    Kapsamı commit'e daraltan mantık YALNIZ hook yolunda yaşar; CI `npm run lint`i
//    doğrudan koşar (.github/workflows/ci.yml).
//
// ⚠️ SİNYAL `staged.mjs`TEN, `git status`TAN DEĞİL: kısmi (pathspec) commit'te git
//    geçici indeks kurar ve `status` yalan söyler (bkz. scripts/check-migrations.mjs
//    § GERÇEK İNDEKS). `git diff --cached` o geçici indekse karşı koşar ve TAM OLARAK
//    bu commit'e giren kümeyi verir — burada istenen de budur.
//
// ⚠️ ARKA DURAK YENİ BİR KAPI DEĞİL: yabancı dosyada uyarıyla geçilen hata CI'ın
//    mevcut Lint adımında yakalanır (backend, Electron, mobil üçünde de tam ağaç).
//    `.githooks/` altında pre-push YOKTUR (ölçüldü 2026-09-13); arka durak CI'dır.
//
// ⚠️ ARIZA ≠ İHLAL: eslint koşamazsa (config hatası, parse çökmesi) rapor JSON'u
//    oluşmaz ve kapı FAIL-CLOSED kırmızı verir — sessiz yeşil en kötü sonuçtur.
//
// Çalıştır: node scripts/hooks/lint-gate.mjs --proje=Teks-Erp|Electron|mobil
// =============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJELER, stagedFiles } from "./lib/staged.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * ESLint JSON raporunu VERDİKTE çevirir — kapının tek karar noktası.
 *
 * Dışa açık olmasının nedeni bekçidir: üç dalı ölçmek için 1100 dosyalık gerçek bir
 * lint koşumu (~40 sn) gerekmesin. Taramanın kendisi eslint'in işi, SINIFLANDIRMA
 * bizim işimiz — bekçi yalnız bizimkini ölçer (test_commit_gate_scope.ts § 2).
 */
export function degerlendir(sonuclar, staged, projeAdi, repo = REPO) {
  const kume = staged instanceof Set ? staged : new Set(staged);
  const benim = [];
  const yabanci = [];
  for (const d of sonuclar) {
    const hatalar = (d.messages ?? []).filter((m) => m.severity === 2 || m.fatal);
    if (hatalar.length === 0) continue;
    const yol = relative(repo, d.filePath).replace(/\\/g, "/");
    (kume.has(yol) ? benim : yabanci).push({ yol, hatalar });
  }

  const satirlar = [];

  if (benim.length > 0) {
    const toplam = benim.reduce((s, d) => s + d.hatalar.length, 0);
    satirlar.push(`❌ ${projeAdi}: commit'e giren ${benim.length} dosyada ${toplam} lint hatası`);
    for (const d of benim) {
      for (const m of d.hatalar.slice(0, 10)) {
        satirlar.push(`   ${d.yol}:${m.line}:${m.column}  ${m.ruleId ?? "parse"}  ${m.message}`);
      }
      if (d.hatalar.length > 10) satirlar.push(`   ${d.yol}: (+${d.hatalar.length - 10} hata daha)`);
    }
    return { kod: 1, satirlar, benim, yabanci };
  }

  if (yabanci.length > 0) {
    const toplam = yabanci.reduce((s, d) => s + d.hatalar.length, 0);
    satirlar.push(
      `⚠️  ${projeAdi}: ${yabanci.length} dosyada ${toplam} lint hatası var ama BU COMMIT'E GİRMİYOR — kapı geçti.`,
    );
    for (const d of yabanci.slice(0, 10)) satirlar.push(`   · ${d.yol} (${d.hatalar.length})`);
    if (yabanci.length > 10) satirlar.push(`   · (+${yabanci.length - 10} dosya daha)`);
    satirlar.push("   Arka durak: CI'ın Lint adımı tam ağacı tarar. Senin dosyansa commit'ten önce düzelt.");
    return { kod: 0, satirlar, benim, yabanci };
  }

  satirlar.push(`✅ ${projeAdi}: lint temiz (${sonuclar.length} dosya tarandı)`);
  return { kod: 0, satirlar, benim, yabanci };
}

/**
 * KÜME ÇAĞIRANDAN GELİR, YENİDEN TÜRETİLMEZ. `pre-commit.mjs` taban SHA'sını zaten
 * çözmüştür (amend'de HEAD^, normalde HEAD) ve listeyi stdin'den verir. Burada
 * `stagedFiles()`i yeniden çağırmak AYRIŞAN YÜZEY olurdu: bu süreç bash-guard'ın
 * çocuğu DEĞİL torunudur — `TEKSERP_COMMIT_BASE` guard'ı burada tutmaz ve amend
 * commit'inde küme HEAD'e göre DAR çıkardı; commit'e giren bir dosya "yabancı"
 * sayılıp kırmızı yerine uyarı alırdı. Elle koşumda (stdin yok) kendimiz türetiriz.
 */
function stagedKume() {
  try {
    const ham = readFileSync(0, "utf8");
    if (ham.trim().length > 0) return ham.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    /* stdin TTY ya da kapalı — elle koşum */
  }
  return stagedFiles(REPO);
}

function main() {
  const projeAd = process.argv
    .slice(2)
    .find((a) => a.startsWith("--proje="))
    ?.split("=")[1];
  const proje = PROJELER.find((p) => p.ad === projeAd);
  if (!proje) {
    console.error(
      `lint-gate: --proje=<${PROJELER.map((p) => p.ad).join("|")}> gerekli (verilen: ${projeAd ?? "yok"})`,
    );
    process.exit(2);
  }

  // --rapor=<yol>: rapor oraya yazılır ve SİLİNMEZ — lint tavanı aynı JSON'u okur,
  // eslint bir kapıda İKİ kez koşmaz (ölçüldü 2026-09-14: 19 sn + 3,5 GB tasarruf).
  const raporArg = process.argv.slice(2).find((a) => a.startsWith("--rapor="))?.split("=")[1];
  const gecici = raporArg ? null : mkdtempSync(join(tmpdir(), "tekserp-lint-"));
  const rapor = raporArg ?? join(gecici, "eslint.json");
  const r = spawnSync(proje.lint[0], [...proje.lint[1], "--", "-f", "json", "-o", rapor], {
    cwd: join(REPO, proje.ad),
    encoding: "utf8",
    env: process.env,
    timeout: 600_000,
  });

  let sonuclar = null;
  if (existsSync(rapor)) {
    try {
      sonuclar = JSON.parse(readFileSync(rapor, "utf8"));
    } catch {
      sonuclar = null;
    }
  }
  if (gecici) rmSync(gecici, { recursive: true, force: true });

  if (!Array.isArray(sonuclar)) {
    console.error(
      `❌ ${proje.ad}: ESLint koşulamadı — bu bir ihlal değil, ARIZA (çıkış ${r.status ?? r.error?.code}).`,
    );
    console.error(`${r.stdout || ""}\n${r.stderr || r.error?.message || ""}`.trimEnd().replace(/^/gm, "   | "));
    process.exit(1);
  }

  const { kod, satirlar } = degerlendir(sonuclar, stagedKume(), proje.ad);
  const yaz = kod === 0 ? console.log : console.error;
  for (const s of satirlar) yaz(s);
  process.exit(kod);
}

// Bekçi bu dosyayı MODÜL olarak içe aktarır; o yolda kapı koşmaz.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
