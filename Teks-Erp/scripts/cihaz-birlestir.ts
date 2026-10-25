/**
 * Cihaz kopyası RAPORU (izlenebilirlik D4) — YALNIZ OKUR, hiçbir şey yazmaz.
 * Aynı fiziksel cihazın yeniden kurulumla doğmuş kopyalarını gruplar; gerekçe, önerilen ana
 * kayıt ve güven puanı basar. Uygulama YALNIZ panelden (önizleme + kayıt kayıt seçim):
 * sezgi yanlış pozitif verebilir, bu yüzden `--apply` BİLEREK YOKTUR.
 * Sezgi `src/services/device-merge.service.ts#buildMergeCandidates` (panel ucuyla ORTAK).
 *
 * Koşum: `cd Teks-Erp && npx tsx scripts/cihaz-birlestir.ts [--json]`
 */
import prisma from "../src/lib/prisma"; // İLK import: dotenv → DATABASE_URL
import { pool } from "../src/lib/prisma";
import { DeviceMergeService, type CandidateMember } from "../src/services/device-merge.service";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const GUVEN: Record<string, string> = { HIGH: "yüksek", MEDIUM: "orta", LOW: "düşük" };

function satir(m: CandidateMember): string {
  const son = m.lastSeenAt ? m.lastSeenAt.toISOString() : "—";
  return `${m.name} (${m.deviceId.slice(0, 8)}) · doğum ${m.createdAt.toISOString()} · son ${son}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--apply")) {
    console.error("❌ --apply yok: birleştirme yalnız panelden, önizleme ve kayıt kayıt onayla yapılır.");
    process.exit(2);
  }
  const { groups, scanned } = await DeviceMergeService.candidates();
  if (args.includes("--json")) {
    console.log(JSON.stringify({ scanned, groups }, null, 2));
    return;
  }
  console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  console.log(`🔎 Taranan birleşmemiş cihaz satırı: ${scanned} · kopya olabilecek grup: ${groups.length}`);
  console.log("ℹ️  RAPOR — veritabanına hiçbir şey yazılmadı. Uygulamak için: Panel → Cihazlar → Kopyaları birleştir.\n");
  groups.forEach((g, i) => {
    console.log(`── Grup ${i + 1} · ${g.kind} · güven ${GUVEN[g.confidence]} · ${g.sources.length + 1} kayıt`);
    console.log(`   ★ önerilen ana kayıt: ${satir(g.target)}`);
    for (const s of g.sources) {
      console.log(`   · ${satir(s)} — güven ${GUVEN[s.confidence]}`);
      if (s.reasons.length) console.log(`       gerekçe: ${s.reasons.join(", ")}`);
      for (const w of s.warnings) console.log(`       ⚠ ${w}`);
    }
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
