// =============================================================================
// PRISMA GENERATE KAPISI — izole worktree ORTAK client'ı EZMESİN
// =============================================================================
// ÖLÇÜLDÜ (2026-09-12): `schema.prisma`da generator `output` YOK ⇒ üretilen
// client `node_modules/.prisma/client`a yazılır. İzole worktree'ler
// `Teks-Erp/node_modules`ü ortak ağaca SYMLINK ediyor (o gün ölçüldü: symlink
// taşıyan altı ağaç). Bir worktree'de `prisma generate` koşulursa o ağacın
// HENÜZ İNMEMİŞ şemasıyla ORTAK client ezilir; diğer oturumların `typecheck`i ve
// bekçileri var olmayan modellere göre ya kırmızı ya YANILTICI YEŞİL verir.
// Isırmadan yakalandı; kapı o yüzden var.
//
// NEDEN EYLEM KAPISI, NEDEN DÜZEN DEĞİŞİKLİĞİ DEĞİL (ölçüldü):
//   • `.prisma` (33 MB) + `@prisma/client` (71 MB) her ağaca KOPYALANSA worktree
//     başına ~104 MB ve "kopya bayatladı" sınıfı yeni bir borç doğar.
//   • Generator `output` eklemek şema + paketleme + CI yüzeyine dokunur
//     (`PRISMA_CLI_BINARY_TARGETS`, `deploy/paketle.ps1`, dist paketleme).
//   • En dar yüzey: worktree'de generate KOŞULMAZ. Şema değişikliği zaten ana
//     ağaçta üretilir; worktree'nin işi commit atmaktır.
//
// KAPSAM: `npm run prisma:generate` yolu. Doğrudan `npx prisma generate` (deploy
// betikleri, sunucu kurulumu) kapsanmaz ve KAPSANMAMALI — oralarda ortak client
// diye bir şey yok, tek ağaç var.
//
// KAÇIŞ: `PRISMA_GENERATE_WORKTREE_ONAY=1`. Bilinçli karardır; kapı hedefi ve
// gerekçeyi basar.
// =============================================================================
import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KOK = dirname(dirname(fileURLToPath(import.meta.url))); // …/Teks-Erp

function git(...args) {
  return execFileSync("git", args, { cwd: KOK, encoding: "utf8" }).trim();
}

function main() {
  let gitDir;
  let ortakDir;
  try {
    gitDir = git("rev-parse", "--absolute-git-dir");
    ortakDir = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  } catch {
    // Git yoksa (paket içi kurulum) kapı sessizce geçer — bu yol zaten tek ağaç.
    process.exit(0);
  }

  if (gitDir === ortakDir) process.exit(0); // ana ağaç

  // İZOLE WORKTREE. Tehlike yalnız node_modules ORTAK ağaca symlink ise doğar:
  // gerçek bir dizinse üretilen client o ağaçta kalır, kimseyi ezmez.
  let symlink = false;
  try {
    symlink = lstatSync(join(KOK, "node_modules")).isSymbolicLink();
  } catch {
    symlink = false;
  }
  if (!symlink) process.exit(0);

  if (process.env.PRISMA_GENERATE_WORKTREE_ONAY === "1") {
    console.warn(
      `\n⚠️  İZOLE WORKTREE'DE GENERATE — ortak client EZİLECEK: ${join(KOK, "node_modules")}\n` +
        "   PRISMA_GENERATE_WORKTREE_ONAY=1 ile bilinçli olarak geçildi.\n",
    );
    process.exit(0);
  }

  console.error(
    "\n⛔ `prisma generate` İZOLE WORKTREE'DE DURDURULDU.\n" +
      `   Ağaç : ${KOK}\n` +
      "   Sebep: `node_modules` ORTAK ağaca symlink; üretilen client\n" +
      "          `node_modules/.prisma/client`a yazılır ve bu ağacın HENÜZ İNMEMİŞ\n" +
      "          şemasıyla ortak client'ı ezer. Diğer oturumların typecheck'i ve\n" +
      "          bekçileri var olmayan modellere göre kırmızı ya da YANILTICI YEŞİL verir.\n" +
      "   Yap  : şema işini ANA AĞAÇTA yürüt ve generate'i orada koş.\n" +
      "   Bilerek koşuyorsan: PRISMA_GENERATE_WORKTREE_ONAY=1 npm run prisma:generate\n",
  );
  process.exit(1);
}

main();
