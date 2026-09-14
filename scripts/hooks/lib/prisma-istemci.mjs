#!/usr/bin/env node
// =============================================================================
// PRISMA İSTEMCİSİ GÜNCEL Mİ — şema ile üretilmiş istemci ayrışınca tip kapısı YANLIŞ konuşur
// =============================================================================
// ⭐ NEDEN VAR (2026-09-14 gecesi, 1e hükmü): izole ağaçta rebase şemayı taşır, ÜRETİLENİ
//    taşımaz (`node_modules/.prisma/client` ağaca özel). Sonra tip kapısı "Property 'WEAVING'
//    does not exist" / "Property 'sacks' does not exist" diye 30–90 sn'lik bir tsc'den sonra
//    kırmızı verir — hata ŞEMADA değil BAYAT İSTEMCİDE, ama mesaj onu söylemez. Aynı gece
//    d9 · 82 · d5 (×2) ısırıldı; reçetede yazılı ("generate kapıdan ÖNCE") ama kendine
//    uygulanmayan kural için tek çare kapıdır. Bu adım UCUZ (ms) ve tip kapısından ÖNCE koşar.
//
// ÖLÇÜT: `prisma/schema.prisma` (INDEX — commit'e giren; okunamazsa ağaç) ile Prisma'nın
//    üretimde yazdığı kopya `node_modules/.prisma/client/schema.prisma` SATIR KÜMESİ olarak
//    eşit mi. Prisma kopyayı yeniden biçimler (hizalama) ve blok özniteliklerini (`@@unique`)
//    yeniden sıralar ⇒ boşluk silinir, yorum atılır, satırlar SIRALANIR (ölçüldü: üretim
//    sonrası 0 fark; d05067c3 öncesi şemayla 15 fark).
//
// ÜÇ SONUÇ: GÜNCEL (çıkış 0) · BAYAT / İSTEMCİ YOK (çıkış 1, çare basılır: `cd Teks-Erp &&
//    npx prisma generate`) · ŞEMA OKUNAMADI (çıkış 2, ARIZA — ihlal değil).
//
// Çalıştır: node scripts/hooks/lib/prisma-istemci.mjs [--sema=<yol>] [--istemci=<yol>]
//    (argümanlar yalnız sonda için; üretimde kapı argümansız çağırır)
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const SEMA = "Teks-Erp/prisma/schema.prisma";
export const ISTEMCI_SEMA = "Teks-Erp/node_modules/.prisma/client/schema.prisma";

/** Biçimden bağımsız satır kümesi: yorum yok, boşluk yok, sıralı. */
export function normalize(metin) {
  return metin
    .split("\n")
    .map((l) => l.replace(/\s+/g, ""))
    .filter((l) => l !== "" && !l.startsWith("//"))
    .sort();
}

/** Şema (INDEX, yoksa ağaç) ↔ üretilmiş kopya. */
export function istemciDurumu(semaMetni, istemciMetni) {
  if (istemciMetni === null) return { durum: "ISTEMCI_YOK", fark: null };
  const a = normalize(semaMetni);
  const b = normalize(istemciMetni);
  const sa = new Set(a);
  const sb = new Set(b);
  let fark = 0;
  for (const l of a) if (!sb.has(l)) fark++;
  for (const l of b) if (!sa.has(l)) fark++;
  return { durum: fark === 0 ? "GUNCEL" : "BAYAT", fark };
}

function semaOku(yol) {
  if (yol) return readFileSync(yol, "utf8");
  try {
    return execFileSync("git", ["show", `:${SEMA}`], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 });
  } catch {
    return readFileSync(join(REPO, SEMA), "utf8");
  }
}

function main() {
  const arg = (ad) => process.argv.slice(2).find((a) => a.startsWith(`--${ad}=`))?.split("=").slice(1).join("=");
  let sema;
  try {
    sema = semaOku(arg("sema"));
  } catch (e) {
    console.error(`❌ prisma istemcisi: şema OKUNAMADI (${e.message}) — ARIZA, ihlal değil.`);
    process.exit(2);
  }
  const istemciYolu = arg("istemci") ?? join(REPO, ISTEMCI_SEMA);
  const istemci = existsSync(istemciYolu) ? readFileSync(istemciYolu, "utf8") : null;
  const { durum, fark } = istemciDurumu(sema, istemci);
  if (durum === "GUNCEL") {
    console.log("✅ prisma istemcisi şemayla güncel");
    process.exit(0);
  }
  console.error(
    durum === "ISTEMCI_YOK"
      ? "❌ prisma istemcisi ÜRETİLMEMİŞ (node_modules/.prisma/client/schema.prisma yok)"
      : `❌ prisma istemcisi BAYAT — şema ile üretilmiş kopya arasında ${fark} satır fark (rebase şemayı taşıdı, üretileni taşımadı)`,
  );
  console.error("   ⇒ koş: cd Teks-Erp && npx prisma generate   (sonra commit'i tekrarla)");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
