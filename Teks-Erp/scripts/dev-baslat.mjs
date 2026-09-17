#!/usr/bin/env node
// =============================================================================
// DEV SUNUCUSU BAŞLATICI — Prisma istemcisi BAYATSA önce `prisma generate`, sonra ts-node
// =============================================================================
// NEDEN VAR (2026-09-17 12:46, kullanıcıda): ortak test ağacı senkronunda `git checkout`
// yeni `src/` + yeni `schema.prisma` getirdi; nodemon (`--watch src`) `prisma generate`
// bitmeden yeniden başladı → süreç YENİ kaynak + ESKİ Prisma client ("customerId bu kayıt
// tipinde tanımlı değil"). `--delay N` yarışı KAPATMAZ (generate boşta 2,5 sn, yük altında
// katlanır); deterministik yol her başlatmada istemci tazeliğini ÖLÇMEK — kapının ölçüsüyle
// (`scripts/hooks/lib/prisma-istemci.mjs` `istemciDurumu`): ağaçtaki şema ↔ üretilmiş kopya.
// Tazeyken bedel milisaniye, bayatken bir generate. nodemon `--watch prisma/schema.prisma`
// ile şema değişimi de yeniden başlatır; bu dosya generate'i o yeniden başlatmanın İÇİNE alır.
//
// Çalıştır: node scripts/dev-baslat.mjs            (package.json `dev` → nodemon exec)
//   --kuru                                          karar basılır, hiçbir şey koşulmaz (bekçi)
//   --sema=<yol> --istemci=<yol>                    yalnız sonda: ölçülen dosyalar değiştirilir
// =============================================================================
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { istemciDurumu } from "../../scripts/hooks/lib/prisma-istemci.mjs";

const TEKS = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEMA = join(TEKS, "prisma", "schema.prisma");
const ISTEMCI = join(TEKS, "node_modules", ".prisma", "client", "schema.prisma");

/** Saf karar: istemci durumu → generate gerekir mi. */
export function generateGerekirMi(durum) {
  return durum === "BAYAT" || durum === "ISTEMCI_YOK";
}

function arg(ad) {
  return process.argv.slice(2).find((a) => a.startsWith(`--${ad}=`))?.split("=").slice(1).join("=");
}

function main() {
  const kuru = process.argv.includes("--kuru");
  const semaYolu = arg("sema") ?? SEMA;
  const istemciYolu = arg("istemci") ?? ISTEMCI;
  const sema = readFileSync(semaYolu, "utf8"); // şema okunamıyorsa çökmek DOĞRU: sunucu da açılamazdı
  const istemci = existsSync(istemciYolu) ? readFileSync(istemciYolu, "utf8") : null;
  const { durum, fark } = istemciDurumu(sema, istemci);
  const gerek = generateGerekirMi(durum);
  const neden = durum === "ISTEMCI_YOK" ? "istemci ÜRETİLMEMİŞ" : durum === "BAYAT" ? `istemci BAYAT (${fark} satır fark)` : "istemci güncel";
  console.log(gerek ? `⟳ dev-baslat: ${neden} → prisma generate` : `✓ dev-baslat: ${neden} → generate atlandı`);
  if (kuru) {
    console.log(gerek ? "KARAR: GENERATE" : "KARAR: ATLA");
    return;
  }
  if (gerek) {
    // Düşerse ÇÖK: eski istemciyle sunucu açmak tam da önlenen hatadır; nodemon bekler, dosya değişince tekrar dener.
    execFileSync("npx", ["prisma", "generate"], { cwd: TEKS, stdio: "inherit" });
  }
  const tsNode = join(TEKS, "node_modules", ".bin", "ts-node");
  const cocuk = existsSync(tsNode)
    ? spawn(tsNode, ["src/server.ts"], { cwd: TEKS, stdio: "inherit" })
    : spawn("npx", ["ts-node", "src/server.ts"], { cwd: TEKS, stdio: "inherit" });
  // nodemon yeniden başlatmada bize sinyal gönderir; sunucuya AYNEN iletilir, tek süreç kuralı korunur.
  for (const sig of ["SIGTERM", "SIGINT", "SIGUSR2", "SIGHUP"]) {
    process.on(sig, () => {
      if (!cocuk.killed) cocuk.kill(sig);
    });
  }
  cocuk.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
