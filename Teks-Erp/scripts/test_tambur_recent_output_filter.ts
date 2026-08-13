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

    // ── KUMAŞ FİLTRESİ (2026-08-12) ──────────────────────────────────────────
    // KK1 "Tüm Girişler" + Tambur "Son Çıkan Toplar" ORTAK filtre şeridi bunu
    // kullanıyor. ⚠️ Bilinmeyen anahtar Zod `z.object`te SESSİZCE ATILIR: filtre
    // seçili görünür, liste süzülmez ve operatör yanlış listeye bakar. Bu yüzden
    // kontrol "etkisi var mı" diye sorar — varlığına değil DAVRANIŞA bakar.
    const otherItem = await p.item.findFirst({
      where: { isActive: true, id: { not: item.id } },
      select: { id: true },
    });
    const byItem = await svc.listRecentOutputRolls({ mode: "cursor", limit: 50, itemId: item.id });
    const byItemRows = byItem.data as { id: string; itemId: string }[];
    ok(
      byItemRows.length > 0 && byItemRows.every((r) => r.itemId === item.id),
      "kumaş filtresi: dönen HER satır seçilen kumaşa ait",
    );
    if (otherItem) {
      const otherRes = await svc.listRecentOutputRolls({
        mode: "cursor",
        limit: 50,
        itemId: otherItem.id,
      });
      ok(
        !(otherRes.data as { id: string }[]).some((r) => r.id === alive.id),
        "kumaş filtresi: BAŞKA kumaş seçilince bu top listede DEĞİL",
      );
    }

    // ── MAKİNE + PERSONEL (2026-08-12) — "Bu makine" tuşu + Personel çipi ────
    // İki aktif Tambur makinesi var; liste varsayılan HEPSİNİ gösterir, süzgeç
    // opsiyoneldir. Körleşirse tuş "seçili" görünür ama liste süzülmez.
    const opUser = await p.user.create({
      data: { username: `${stamp}-tambur-op`.toLowerCase(), passwordHash: "x", fullName: "Tambur Op", isActive: true },
      select: { id: true },
    });
    const st = await p.station.create({
      data: { code: `TEST-RCO-ST-${stamp}`, name: `${stamp} İst`, kind: "TAMBUR", type: "INTERNAL" },
      select: { id: true },
    });
    const mach = await p.machine.create({
      data: { code: `TEST-RCO-M-${stamp}`, name: `${stamp} Makine`, stationId: st.id, isActive: true },
      select: { id: true },
    });
    const attributed = await p.roll.create({
      data: {
        barcode: `TEST-RCO-AT-${stamp}`, itemId: item.id, initialQty: 40, currentQty: 40,
        status: "WAREHOUSE", entrySource: "TAMBUR_SPLIT", form: "TOP",
        createdById: opUser.id, createdMachineId: mach.id,
      },
      select: { id: true },
    });
    createdIds.push(attributed.id);
    const byMachine = await svc.listRecentOutputRolls({ mode: "cursor", limit: 50, createdMachineId: mach.id });
    ok(
      (byMachine.data as { id: string }[]).some((r) => r.id === attributed.id) &&
        !(byMachine.data as { id: string }[]).some((r) => r.id === alive.id),
      "createdMachineId: yalnız o makinenin kesimleri",
    );
    const byCreator = await svc.listRecentOutputRolls({ mode: "cursor", limit: 50, createdById: opUser.id });
    ok(
      (byCreator.data as { id: string }[]).some((r) => r.id === attributed.id) &&
        !(byCreator.data as { id: string }[]).some((r) => r.id === alive.id),
      "createdById: yalnız o personelin kesimleri",
    );
    await p.roll.deleteMany({ where: { id: attributed.id } });
    createdIds.splice(createdIds.indexOf(attributed.id), 1);
    await p.machine.delete({ where: { id: mach.id } });
    await p.station.delete({ where: { id: st.id } });
    await p.user.delete({ where: { id: opUser.id } });

    // Tarih aralığı: gelecekteki pencere hiçbir şey döndürmemeli. `dateField`
    // sözleşmesinin mobil tarafı (buildRollQueryParams) buna dayanıyor.
    const future = await svc.listRecentOutputRolls({
      mode: "cursor",
      limit: 50,
      dateFrom: new Date(Date.now() + 86_400_000),
    });
    ok((future.data as unknown[]).length === 0, "tarih aralığı: gelecek pencerede 0 satır");

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
