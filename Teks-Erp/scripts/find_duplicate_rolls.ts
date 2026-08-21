// =============================================================================
// Tespit: mükerrer ham giriş ("aynı topu iki kez kaydetmişiz") — SALT OKUNUR
// Çalıştır: npx tsx scripts/find_duplicate_rolls.ts                (son 30 gün)
//           npx tsx scripts/find_duplicate_rolls.ts --days=90
//           npx tsx scripts/find_duplicate_rolls.ts --window=300   (saniye)
//           npx tsx scripts/find_duplicate_rolls.ts --csv          (makine okunur)
// =============================================================================
// ⚠️ BU SCRIPT HİÇBİR ŞEY YAZMAZ. `--apply` YOKTUR. Önce ne olduğunu görürüz,
// temizlik yolu çıktıya bakılarak AYRICA kararlaştırılır (canlı veri kuralı).
//
// ⚠️ TESPİT MANTIĞI BURADA DEĞİL: `src/services/duplicate-rolls.service.ts`
// (2026-08-22, mükerrer paneli v2 P3c). Bu dosya artık yalnız BİR YAZICI —
// panel (Sistem → Mükerrer Kayıtlar → Toplar) ile aynı servisten besleniyor,
// böylece "script ne diyor, panel ne diyor" ayrışması yapısal olarak imkânsız.
// SAHA VAKASI ve aracın sınırları servis başlığında yazılı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { DuplicateRollsService } from "../src/services/duplicate-rolls.service";

function arg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const v = Number(hit.split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

const DAYS = arg("days", 30);
const WINDOW_SEC = arg("window", 120);
const CSV = process.argv.includes("--csv");

async function main() {
  const scan = await DuplicateRollsService.scan({ days: DAYS, windowSec: WINDOW_SEC });

  if (!CSV) {
    console.log("=".repeat(78));
    console.log("MÜKERRER HAM GİRİŞ TARAMASI — SALT OKUNUR (hiçbir kayıt değişmez)");
    console.log("=".repeat(78));
    console.log(`Pencere : birbirine ≤ ${scan.windowSec} sn içinde doğmuş toplar`);
    console.log(`Kapsam  : son ${scan.days} gün`);
    console.log("");
    console.log(`Taranan giriş topu : ${scan.totals.scanned}`);
    console.log(
      `Hareket görmüş     : ${scan.totals.touched} (elendi — üretime girmiş top kopya olamaz)`,
    );
    console.log(`Değerlendirilen    : ${scan.totals.evaluated}`);
  }

  if (scan.clusters.length === 0) {
    if (!CSV) {
      console.log("");
      console.log("✅ Şüpheli küme bulunamadı.");
    }
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  if (CSV) {
    console.log("kume,skor,barkod,id,olusma,statu,urun,metraj,en,operator,clientToken,etiketBasili,engel");
    scan.clusters.forEach((c, gi) => {
      for (const r of c.rolls) {
        console.log(
          [
            gi + 1, c.score, r.barcode ?? "", r.id, r.createdAt.toISOString(), r.status,
            JSON.stringify(c.itemName ?? ""), String(c.initialQty), String(c.width ?? ""),
            JSON.stringify(c.operatorName ?? ""), r.clientToken ?? "",
            r.labelPrinted ? "evet" : "hayır", JSON.stringify(r.blockedReason ?? ""),
          ].join(","),
        );
      }
    });
  } else {
    console.log(`Şüpheli küme     : ${scan.totals.clusters}`);
    console.log(
      `Fazladan kayıt   : ${scan.totals.extras} top (her kümede 1 tanesi gerçek kabul edilirse)`,
    );
    console.log("");
    scan.clusters.forEach((c, gi) => {
      const flag = c.level === "STRONG" ? "🔴 GÜÇLÜ ŞÜPHE" : c.level === "SUSPECT" ? "🟠 ŞÜPHELİ" : "🟡 ZAYIF";
      console.log("-".repeat(78));
      console.log(`Küme ${gi + 1}/${scan.clusters.length}  ${flag} (skor ${c.score}/6)`);
      console.log(`  Ürün      : ${c.itemName ?? c.itemId}${c.colorName ? ` / ${c.colorName}` : ""}`);
      console.log(`  Metraj/En : ${c.initialQty} m / ${c.width ?? "—"} cm`);
      console.log(`  Operatör  : ${c.operatorName ?? "—"}`);
      console.log(`  Sinyaller : ${c.reasons.join(" · ")}`);
      console.log("  Toplar:");
      for (const r of c.rolls) {
        const marks = [
          r.id === c.suggestedKeepId ? "ÖNERİLEN ASIL" : "",
          r.labelPrinted ? "etiket BASILI" : "",
          r.blockedReason ?? "",
        ].filter(Boolean);
        console.log(
          `    ${r.createdAt.toISOString()}  ${(r.barcode ?? "(barkodsuz)").padEnd(20)} ` +
            `${r.status.padEnd(10)} ${r.id}${marks.length ? `  [${marks.join(" · ")}]` : ""}`,
        );
      }
      if (c.level === "STRONG") {
        console.log(
          `  → Önerilen asıl tutulup diğer ${c.rolls.length - 1} tanesi İNCELENMELİ ` +
            "(fiziksel sayımla doğrula).",
        );
      } else {
        console.log("  → Zayıf sinyal: büyük olasılıkla meşru seri giriş. Karar için fiziksel sayım şart.");
      }
    });
    console.log("-".repeat(78));
    console.log("");
    console.log("⚠️  BASILMIŞ ETİKETLER: iptal edilecek her top için fiziksel etiket");
    console.log("    basılmış olabilir. Kayıt temizlense de sahadaki kâğıt kalır —");
    console.log("    o barkodlar toplanıp imha edilmeli.");
    console.log("");
    console.log("⚠️  BU BİR KANIT DEĞİL, ŞÜPHE LİSTESİDİR. KK1 seri girişi meşru olarak");
    console.log("    aynı deseni üretir. Bu script YAZMAZ; temizlik kararı fiziksel");
    console.log("    sayım + operatör teyidi ile ayrıca verilir. Panelden yapmak için:");
    console.log("    Sistem → Mükerrer Kayıtlar → Toplar (roll:manual-adjust).");
  }

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
