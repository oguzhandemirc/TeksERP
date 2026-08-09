// =============================================================================
// Test: TOPLU ETİKET HEDEFİ (`seedRollLabelSnapshotsBulk`) — 2026-08-09
// Çalıştır: npx tsx scripts/test_label_bulk_seed.ts
// =============================================================================
// Saha isteği: *"son çıkan etiketleri toplu seçim yapıp etiketleri
// çıkarabilelim, istersek toplu müşteri de değişebilelim. Kuşakları değişen
// ürünlerin toplu etiket çıkarıp yenilenmesi gerekebilir."*
//
// §1 ⭐ SONUÇ PARÇALIDIR ve ATLANAN YUTULMAZ — bu bekçinin asıl işi.
//    Tek transaction DEĞİL (hepsi-ya-hiç yanlış semantiktir: listedeki bir top
//    bu arada arşive düştüyse diğerlerinin etiketini geri almak operatörün
//    niyetine aykırıdır). Karşılığında atlanan HER satır somut sebebiyle döner.
//    *"42 yazıldı"* deyip 8'inin sebebini yutmak en kötü davranıştır.
// §2 Arşiv topu REDDEDİLİR (tarama yolundaki korumayla aynı kural)
// §3 Yazım gerçekten oluyor: snapshot + `labelCustomerId` AYNI update'te
// §4 Stok hedefi müşteriyi TEMİZLER (eski müşteri yapışıp kalmaz)
// =============================================================================
import { RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const labels = new LabelService();

async function main(): Promise<void> {
  const ts = Date.now();
  const rollIds: string[] = [];
  let itemId = "";
  let customerId = "";

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-BS-${ts}`, name: `TEST Toplu ${ts}`, itemType: "FABRIC" },
      select: { id: true },
    });
    itemId = item.id;
    const cust = await prisma.customer.create({
      data: { code: `TEST-BSC-${ts}`, name: `TEST Müşteri ${ts}` },
      select: { id: true },
    });
    customerId = cust.id;

    const mk = async (tag: string, status: RollStatus) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-BS-${tag}-${ts}`,
          itemId, status,
          initialQty: 40, currentQty: 40,
          qualityGrade: "1.KALITE",
          entrySource: "TAMBUR_SPLIT",
        },
        select: { id: true },
      });
      rollIds.push(r.id);
      return r.id;
    };

    const live1 = await mk("L1", RollStatus.WAREHOUSE);
    const live2 = await mk("L2", RollStatus.WAREHOUSE);
    const dead = await mk("DEAD", RollStatus.TAMBUR_CONSUMED);
    const cancelled = await mk("CANC", RollStatus.CANCELLED);
    const ghostId = "00000000-0000-0000-0000-0000000000ff";

    // ── §1 + §2 PARÇALI SONUÇ ───────────────────────────────────────────────
    console.log("\n── §1 ⭐ Parçalı sonuç — atlanan yutulmaz ──");

    const res = await labels.seedRollLabelSnapshotsBulk(
      [live1, dead, live2, cancelled, ghostId],
      undefined,
      { customerId },
    );
    const { seeded, failed } = res.data;

    check(
      "⭐ uygun toplar YAZILDI (biri düştü diye hepsi geri alınmadı)",
      seeded.length === 2 && seeded.includes(live1) && seeded.includes(live2),
      `${seeded.length} yazıldı`,
    );
    check(
      "⭐ atlanan HER top listede (sessiz kayıp yok)",
      failed.length === 3,
      `${failed.length} atlandı — 42 yazıldı deyip 8'ini yutmak en kötüsü`,
    );
    check(
      "atlananlar BARKODLA raporlanıyor (operatör id'yi tanımaz)",
      failed.filter((f) => f.rollId !== ghostId).every((f) => !!f.barcode),
    );
    check(
      "arşiv topunun sebebi SOMUT",
      /Arşivde/.test(failed.find((f) => f.rollId === dead)?.reason ?? ""),
      failed.find((f) => f.rollId === dead)?.reason ?? "-",
    );
    check(
      "iptal edilmiş top da reddedilir",
      failed.some((f) => f.rollId === cancelled),
    );
    check(
      "var olmayan top sessizce atlanmaz",
      /bulunamadı/i.test(failed.find((f) => f.rollId === ghostId)?.reason ?? ""),
    );

    // ── §3 Yazım gerçekten oldu mu ──────────────────────────────────────────
    console.log("\n── §3 Snapshot + ayna AYNI update'te ──");

    const after = await prisma.roll.findMany({
      where: { id: { in: [live1, live2] } },
      select: { id: true, labelCustomerId: true, lastLabelSnapshot: true },
    });
    check(
      "sorgulanabilir ayna (`labelCustomerId`) yazıldı",
      after.every((r) => r.labelCustomerId === customerId),
      after.map((r) => r.labelCustomerId).join(","),
    );
    check(
      "JSON snapshot da yazıldı (ikisi ayrışmadı)",
      after.every((r) => {
        const s = r.lastLabelSnapshot as { customerId?: string } | null;
        return s?.customerId === customerId;
      }),
    );
    const untouched = await prisma.roll.findUnique({
      where: { id: dead },
      select: { labelCustomerId: true },
    });
    check("arşiv topuna DOKUNULMADI", untouched?.labelCustomerId === null);

    // ── §4 Stok hedefi müşteriyi temizler ───────────────────────────────────
    console.log("\n── §4 Stok hedefi ──");

    const res2 = await labels.seedRollLabelSnapshotsBulk([live1], undefined, { stock: true });
    check("stok yazımı başarılı", res2.data.seeded.length === 1);
    const stocked = await prisma.roll.findUnique({
      where: { id: live1 },
      select: { labelCustomerId: true },
    });
    check(
      "stok hedefi müşteriyi TEMİZLER (eski müşteri yapışmaz)",
      stocked?.labelCustomerId === null,
      "aksi halde 'müşterisiz bas' dendiğinde eski müşteri etiketi basılırdı",
    );

    // Körlük zemini: motor hiç yazmıyorsa yukarıdaki "temizlendi" kontrolü de
    // vakumen yeşil kalırdı.
    check("körlük zemini: motor gerçekten yazıyor", seeded.length > 0 && failed.length > 0);
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
  }
}

main().then(
  () => process.exit(fail > 0 ? 1 : 0),
  (e) => { console.error(e); process.exit(1); },
);
