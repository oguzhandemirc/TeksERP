// F-tablet: Tambur "geçmiş çıktılar" listesi ölü topları göstermesin.
// entrySource=TAMBUR_SPLIT çocuk sonradan re-cut ile TAMBUR_CONSUMED (currentQty=0)
// olursa listeden düşmeli — liste "etiketi yeniden bas" amaçlı, fiziksel olmayan
// top basılamaz. Fixture: iki TEST- topu (WAREHOUSE + TAMBUR_CONSUMED) yarat,
// barkod araması ile listRecentOutputRolls sonucunu doğrula, finally'de sök.
import p from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

(async () => {
  const item = await p.item.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const stamp = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  const aliveBarcode = `TEST-RCO-A-${stamp}`;
  const deadBarcode = `TEST-RCO-D-${stamp}`;
  const createdIds: string[] = [];

  try {
    const alive = await p.roll.create({
      data: {
        barcode: aliveBarcode, itemId: item.id, initialQty: 100, currentQty: 100,
        status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", form: "TOP",
      },
      select: { id: true },
    });
    createdIds.push(alive.id);
    const dead = await p.roll.create({
      data: {
        barcode: deadBarcode, itemId: item.id, initialQty: 100, currentQty: 0,
        status: "TAMBUR_CONSUMED", entrySource: "TAMBUR_SPLIT", form: "TOP",
        parentRollId: alive.id,
      },
      select: { id: true },
    });
    createdIds.push(dead.id);

    const svc = new TamburService();
    const aliveRes = await svc.listRecentOutputRolls({ search: aliveBarcode });
    const deadRes = await svc.listRecentOutputRolls({ search: deadBarcode });
    const aliveHit = (aliveRes.data as { id: string }[]).some((r) => r.id === alive.id);
    const deadHit = (deadRes.data as { id: string }[]).some((r) => r.id === dead.id);
    ok(aliveHit, "canlı TAMBUR_SPLIT çocuğu listede");
    ok(!deadHit, "TAMBUR_CONSUMED (0m) çocuk listede DEĞİL");

    // Cursor mode da aynı where'i paylaşır — ölü top orada da görünmemeli.
    const cursorRes = await svc.listRecentOutputRolls({ search: deadBarcode, mode: "cursor" });
    const cursorHit = (cursorRes.data as { id: string }[]).some((r) => r.id === dead.id);
    ok(!cursorHit, "cursor modunda da ölü top listede DEĞİL");
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      // dead.parentRollId=alive → önce dead silinir (createdIds ters sırası).
      for (const id of [...createdIds].reverse()) {
        await p.systemLog.deleteMany({ where: { recordId: id } });
        await p.roll.delete({ where: { id } });
      }
      console.log("(temizlendi — TEST- fixture topları silindi)");
    } catch (e) {
      console.error("cleanup hata:", e instanceof Error ? e.message : e);
    }
    await p.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
