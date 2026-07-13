// =============================================================================
// Kalite NULL görünürlüğü — Faz 3. qualityGrade nullable oldu; kaliteye bakılmamış
// (NULL) toplar varsayılan Envanter listesinde GÖRÜNMELİ (FIRE filtresi null'ı
// dışlamamalı) ve istatistikte "Belirsiz" kovasına düşmeli; FIRE topları yine dışlanır.
// Koşum: npx tsx scripts/test_null_quality_visibility.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { RollStatus } from "@prisma/client";
import { InventoryService } from "../src/services/inventory.service";
import type { Request } from "express";

const inv = new InventoryService();
const req = (query: Record<string, string>): Request => ({ query } as unknown as Request);

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) throw new Error("fixture eksik (item)");
  const stamp = Date.now();
  const created: string[] = [];

  const mk = async (qualityGrade: string | null, barcode: string): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode, itemId: item.id, initialQty: 100, currentQty: 100,
        status: RollStatus.WAREHOUSE, qualityGrade, entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    created.push(r.id);
    return r.id;
  };

  try {
    const nullId = await mk(null, `TNULLQ-${stamp}-N`);   // kalitesiz (Belirsiz)
    const fireId = await mk("FIRE", `TNULLQ-${stamp}-F`);  // fire → varsayılan listede YOK

    // 1) Varsayılan WAREHOUSE listesi (kalite filtresi override edilmeden → FIRE dışlanır).
    const listRes = (await inv.findAllRolls(
      req({ mode: "cursor", limit: "500", "filter[status]": "WAREHOUSE", sortBy: "createdAt", sortOrder: "desc" }),
    )) as { data: Array<{ id: string }> };
    const ids = new Set(listRes.data.map((r) => r.id));
    check("Kalitesiz (NULL) top varsayılan listede GÖRÜNÜR", ids.has(nullId));
    check("FIRE top varsayılan listede GÖRÜNMEZ (dışlandı)", !ids.has(fireId));

    // 2) İstatistik — NULL kalite "BELIRSIZ" kovasında; FIRE stat'ta da yok.
    const statRes = (await inv.getRollStats(req({ "filter[status]": "ALL" }))) as {
      data: { byQuality?: Record<string, number> };
    };
    const byQuality = statRes.data.byQuality ?? {};
    check("İstatistikte 'BELIRSIZ' kovası var (NULL kalite)", (byQuality["BELIRSIZ"] ?? 0) >= 1, JSON.stringify(byQuality));
    check("İstatistikte 'FIRE' kovası yok (dışlandı)", !("FIRE" in byQuality));
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
