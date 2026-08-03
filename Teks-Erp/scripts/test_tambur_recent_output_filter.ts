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

    // ── MANUEL MOD TOPU DA LİSTEDE (2026-08-03 saha hatası) ──────────────────
    // Liste yalnız TAMBUR_SPLIT süzüyordu → "Manuel Ekle" ile eklenen top buraya
    // hiç düşmüyordu. Bu ekranda etiketi YENİDEN BASMANIN tek yolu Çıkanlar
    // önizlemesi olduğu için, yazıcı hata verdiğinde operatörün tek çıkar yolu
    // topu sıfırdan tekrar girmek — yani envantere MÜKERRER stok yazmaktı.
    const manualBarcode = `TEST-RCO-M-${stamp}`;
    const manual = await p.roll.create({
      data: {
        barcode: manualBarcode, itemId: item.id, initialQty: 250, currentQty: 250,
        status: "WAREHOUSE", entrySource: "TAMBUR_MANUAL", form: "TOP",
      },
      select: { id: true },
    });
    createdIds.push(manual.id);
    const manualRes = await svc.listRecentOutputRolls({ search: manualBarcode });
    ok(
      (manualRes.data as { id: string }[]).some((r) => r.id === manual.id),
      "TAMBUR_MANUAL topu listede (yeniden etiket basılabilir)",
    );
    const manualCursor = await svc.listRecentOutputRolls({ search: manualBarcode, mode: "cursor" });
    ok(
      (manualCursor.data as { id: string }[]).some((r) => r.id === manual.id),
      "cursor modunda da TAMBUR_MANUAL topu listede",
    );

    // Ölü manuel top yine düşmeli — entrySource genişledi diye statü kapısı
    // gevşemedi (iptal edilen manuel topun etiketi basılamaz).
    const deadManualBarcode = `TEST-RCO-MD-${stamp}`;
    const deadManual = await p.roll.create({
      data: {
        barcode: deadManualBarcode, itemId: item.id, initialQty: 250, currentQty: 250,
        status: "CANCELLED", entrySource: "TAMBUR_MANUAL", form: "TOP",
      },
      select: { id: true },
    });
    createdIds.push(deadManual.id);
    const deadManualRes = await svc.listRecentOutputRolls({ search: deadManualBarcode });
    ok(
      !(deadManualRes.data as { id: string }[]).some((r) => r.id === deadManual.id),
      "iptal edilmiş TAMBUR_MANUAL topu listede DEĞİL",
    );

    // İş emri süzgeci verilirse manuel top DÜŞER — `producedInStepId` null,
    // yani hiçbir WO'nun çıktısı değil. Mobil Çıkanlar modalı bu süzgeci geçmez.
    const woFiltered = await svc.listRecentOutputRolls({
      search: manualBarcode,
      workOrderId: "00000000-0000-0000-0000-000000000000",
    });
    ok(
      !(woFiltered.data as { id: string }[]).some((r) => r.id === manual.id),
      "iş emri süzgecinde manuel top listede DEĞİL (WO çıktısı değil)",
    );
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
