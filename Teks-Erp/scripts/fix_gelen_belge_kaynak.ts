// =============================================================================
// ONARIM — Fotoğrafla açılıp "Kaynak: Elle" kalmış gelen belge TASLAKLARI (2026-11-02, Gülkesim demosu)
// Çalıştır: npx tsx scripts/fix_gelen_belge_kaynak.ts                     (TEŞHİS — hiçbir şey yazmaz)
//           npx tsx scripts/fix_gelen_belge_kaynak.ts --apply --onay=<N>  (listelenen N taslağı OCR'a çevirir)
// =============================================================================
// Hata: panel ve tablet yükleme akışı taslağı MANUAL açıp sayfa fotoğrafını sonra bağlıyordu; bugün bağlama claim'i
// satırsız MANUAL taslağı OCR yapar (`markPhotoSourceTx`). Bu betik ESKİ kayıtları aynı hükümle düzeltir:
//   ADAY  status DRAFT ∧ sourceKind MANUAL ∧ PDF olmayan en az bir tarama bağlı ∧ elle satır YOK (her satır `ocrRaw` taşır)
// DRAFT dışı belge YAZILMAZ (gelen-belge.md: DRAFT dışı başlık yazılmaz) — yalnız sayısı bildirilir.
// YAZIM tek ifade `updateMany WHERE id IN (liste) AND status DRAFT AND sourceKind MANUAL`; sayı tutmazsa tx geri alınır.
// İz audit'e (tx DIŞINDA, `reason: PHOTO_SOURCE_BACKFILL`). Defter etkisi yok (taslak defter değildir).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AuditService } from "../src/services/audit.service";
import { hedefDbAdi } from "./lib/hedef-db-kapisi";

const SOURCE = "scripts/fix_gelen_belge_kaynak.ts";
const PDF_MIME = "application/pdf";

interface Candidate { id: string; noteNo: string; status: string; photoCount: number; lineCount: number }

/** Yalnız okur: fotoğraflı, elle satırsız MANUAL belgeler (DRAFT ve DRAFT dışı ayrı). */
export async function diagnose(): Promise<{ drafts: Candidate[]; locked: Candidate[] }> {
  const rows = await prisma.customerDeliveryNote.findMany({
    where: { sourceKind: "MANUAL", scans: { some: { mimeType: { not: PDF_MIME } } }, lines: { none: { ocrRaw: { equals: Prisma.AnyNull } } } },
    select: { id: true, noteNo: true, status: true, _count: { select: { lines: true } }, scans: { where: { mimeType: { not: PDF_MIME } }, select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
  const all = rows.map((r) => ({ id: r.id, noteNo: r.noteNo, status: r.status, photoCount: r.scans.length, lineCount: r._count.lines }));
  return { drafts: all.filter((c) => c.status === "DRAFT"), locked: all.filter((c) => c.status !== "DRAFT") };
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  const { drafts, locked } = await diagnose();
  console.log(`\nAday (DRAFT, MANUAL → OCR): ${drafts.length}`);
  for (const c of drafts) console.log(`  ${c.noteNo}  ${c.photoCount} fotoğraf · ${c.lineCount} satır  (${c.id})`);
  if (locked.length) console.log(`\nDRAFT dışı (YAZILMAZ, yalnız bilgi): ${locked.length} — ${locked.map((c) => `${c.noteNo}/${c.status}`).join(", ")}`);
  if (!apply) {
    if (drafts.length) console.log(`\n  → Yazmak için: npx tsx ${SOURCE} --apply --onay=${drafts.length}`);
    return;
  }
  if (Number(arg("onay")) !== drafts.length) {
    console.log(`\n⛔ --onay=${arg("onay") ?? "(yok)"} ama aday ${drafts.length} — listeyi yeniden okuyun. Hiçbir şey yazılmadı.`);
    process.exitCode = 1;
    return;
  }
  if (!drafts.length) return;
  const ids = drafts.map((c) => c.id);
  await prisma.$transaction(async (tx) => {
    const c = await tx.customerDeliveryNote.updateMany({ where: { id: { in: ids }, status: "DRAFT", sourceKind: "MANUAL" }, data: { sourceKind: "OCR" } });
    if (c.count !== ids.length) throw new Error(`Veri değişti: ${c.count}/${ids.length} — geri alındı, yeniden koşun.`);
  });
  for (const c of drafts) {
    await AuditService.log({ userId: undefined, action: "UPDATE", tableName: "CUSTOMER_DELIVERY_NOTE", recordId: c.id, oldData: { sourceKind: "MANUAL" }, newData: { sourceKind: "OCR", reason: "PHOTO_SOURCE_BACKFILL", source: SOURCE } });
  }
  console.log(`\n✅ ${ids.length} taslak OCR kaynaklı yapıldı.`);
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(async () => { await prisma.$disconnect(); await pool.end().catch(() => {}); });
}
