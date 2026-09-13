// =============================================================================
// `_shipped.ts` STATUS SÜZGECİ — kaybı ancak ANOMALİ KURULARAK görülür
//
// ⭐ NEDEN BU BEKÇİ BÖYLE YAZILDI (ölçüldü 2026-09-13):
// `docs/kurallar/raporlar.md` *"status='DISPATCHED' süzgecini SİLME: kaybını
// hiçbir bekçi göremez"* diyordu ve bunu DOĞRULADIM — süzgeci kaldırıp koştum:
// scorecard 9/9 · shipment 19/19 · direct_ship 5/5 · iade 1/1 = **34 dosya,
// SIFIR kırmızı**. ⇒ Kapanış koşulu *"bir bekçi yaz"* OLAMAZDI.
//
// SEBEP: storno (`undoDispatch`) `dispatchedAt`i NULL'lar ⇒ PLANNED bir
// sevkiyatın tarihi ZATEN olmaz ve alttaki aralık süzgeci onu eler. Yani doğal
// veriyle üretilen HİÇBİR satır status süzgecine çarpmaz — süzgeç, o invariant'a
// GÜVENMEMEK için duruyor (ikinci savunma hattı).
// ⇒ ***Kaybı görmek için, invariant'ın YASAKLADIĞI satırı ELLE KURMAK gerekir:***
//    `dispatchedAt` aralık İÇİNDE, ama statü DISPATCHED DEĞİL.
//
// ⚠️ VE O SATIR KURULABİLİR — ölçüldü: `shipments` tablosunda `status` ile
// `dispatchedAt`i bağlayan HİÇBİR CHECK yok (0 satır). Invariant yalnız servis
// katmanında yaşıyor. ⇒ Süzgeç teorik bir savunma değil, GERÇEK bir savunma.
//
// ⛔ BU BEKÇİNİN ÖLÇMEDİĞİ: invariant'ın kendisi ("storno gerçekten NULL'lar mı").
// O ayrı bir sorudur ve başka bir bekçinin konusudur. Burada ölçülen tek şey,
// invariant BOZULDUĞUNDA süzgecin hâlâ tutuyor olması.
//
// Koşum: npx tsx scripts/test_shipped_status_filter.ts
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { collectShipped, shippedGrossTotal } from "../src/services/reports/_shipped";
import type { DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const TAG = `TSF-${Date.now()}`;  // `code` VarChar(32) — kısa tutulur
// ⚠️ UZAK GELECEK: gerçek fabrika verisiyle karışmasın. 2095 `test_shipment_
// scorecard`ın penceresi — çakışmasın diye 2096.
const RANGE: DateRange = {
  from: new Date("2096-04-01T00:00:00.000Z"),
  to: new Date("2096-04-30T23:59:59.999Z"),
};
const PENCERE_ICI = new Date("2096-04-15T10:00:00.000Z");

const MIKTAR = { dispatched: 500, planned: 700, cancelled: 900 } as const;

const ids = { rolls: [] as string[], shipments: [] as string[], item: "", customer: "" };

async function main(): Promise<void> {
  console.log("\n=== `_shipped.ts` status süzgeci — ANOMALİ ile ölçülür ===\n");

  // ⛔ ORTAMDA ARAMA YOK — `findFirst({ isActive: true })` "ne bulursan" demektir
  // ve bekçiyi ORTAMA yaslar: fikstür değişince sessizce başka bir kaydı ölçer.
  // Kendi fikstürünü İŞ ANAHTARIYLA (`code` @unique) kurmak, bekçiyi ortamdan
  // BAĞIMSIZ yapar. (d5'in keyfi-arama mandalı bunu ölçer; bu dosya onu bir kez
  // kırdı — yeni dosya, dizinini tarayan BÜTÜN tarayıcılara koşturulur.)
  const item = await prisma.item.create({
    data: { code: `${TAG}-I`, name: `${TAG} kumaş`, itemType: "FABRIC" },
    select: { id: true },
  });
  ids.item = item.id;
  const customer = await prisma.customer.create({
    data: { code: `${TAG}-C`, name: `${TAG} müşteri` },
    select: { id: true },
  });
  ids.customer = customer.id;

  const mkShipment = async (ek: string, status: "DISPATCHED" | "PLANNED" | "CANCELLED") => {
    const s = await prisma.shipment.create({
      // ⚠️ SERVİS KATMANI ATLANIYOR ve bu BİLİNÇLİ: kurulan şey, servisin
      // ÜRETMEYECEĞİ bir satır. Servisle kursaydım invariant'ı test ederdim,
      // süzgeci değil.
      data: { shipmentNo: `${TAG}-${ek}`, customerId: customer.id, status, dispatchedAt: PENCERE_ICI },
      select: { id: true },
    });
    ids.shipments.push(s.id);
    return s.id;
  };
  const mkRoll = async (qty: number, shipmentId: string) => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id,
        initialQty: qty,
        currentQty: qty,
        status: "SHIPPED",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId,
        barcode: `${TAG}-R${ids.rolls.length}`,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
  };

  const sOk = await mkShipment("OK", "DISPATCHED");
  const sPlanned = await mkShipment("ANOMALI-PLANNED", "PLANNED");
  const sCancelled = await mkShipment("ANOMALI-CANCELLED", "CANCELLED");
  await mkRoll(MIKTAR.dispatched, sOk);
  await mkRoll(MIKTAR.planned, sPlanned);
  await mkRoll(MIKTAR.cancelled, sCancelled);

  // ── §0 ANOMALİ GERÇEKTEN KURULDU MU ───────────────────────────────────────
  // ⚠️ Bu bölüm olmadan §2 boş bir yeşil olurdu: kurulamamış bir anomaliyi
  // dışlamak marifet değildir.
  console.log("§0 — anomali KURULDU mu (kurulamayan anomaliyi dışlamak marifet değil)");
  const anomaliler = await prisma.shipment.findMany({
    where: { id: { in: [sPlanned, sCancelled] }, dispatchedAt: { not: null } },
    select: { id: true, status: true, dispatchedAt: true },
  });
  check(
    "§0 ⭐ statüsü DISPATCHED OLMAYAN 2 sevkiyat, dispatchedAt DOLU olarak DB'de",
    anomaliler.length === 2 && anomaliler.every((a) => a.status !== "DISPATCHED"),
    anomaliler.map((a) => `${a.status}@${a.dispatchedAt?.toISOString().slice(0, 10)}`).join(" · "),
  );
  console.log("");

  // ── §1 POZİTİF KONTROL ────────────────────────────────────────────────────
  // ⚠️ Sürekli 0 döndüren bir sorgu §2'yi de geçerdi. Önce SAYDIĞINI ölç.
  console.log("§1 — pozitif kontrol: meşru sevk SAYILIYOR");
  const toplam = await shippedGrossTotal(RANGE);
  check(`§1 ⭐ toplam = ${MIKTAR.dispatched} (yalnız DISPATCHED)`, toplam === MIKTAR.dispatched, `gelen: ${toplam}`);
  console.log("");

  // ── §2 ANOMALİ DIŞLANIYOR ─────────────────────────────────────────────────
  console.log("§2 — anomali DIŞLANIYOR (süzgecin asıl işi)");
  check(
    `§2a ⭐ PLANNED'in ${MIKTAR.planned} m'si toplamda YOK`,
    toplam !== MIKTAR.dispatched + MIKTAR.planned && toplam < MIKTAR.dispatched + MIKTAR.planned,
    `süzgeç silinirse ${MIKTAR.dispatched + MIKTAR.planned} olurdu`,
  );
  check(
    `§2b ⭐ CANCELLED'in ${MIKTAR.cancelled} m'si toplamda YOK`,
    toplam < MIKTAR.dispatched + MIKTAR.cancelled,
    `üçü birden sızsaydı ${MIKTAR.dispatched + MIKTAR.planned + MIKTAR.cancelled} olurdu`,
  );
  const hucreler = await collectShipped(RANGE);
  const hucreToplam = hucreler.reduce((a, c) => a + c.qty, 0);
  check("§2c hücre kırılımı ile toplam AYNI tanımdan", hucreToplam === toplam, `${hucreToplam} = ${toplam}`);
  console.log("");

  // ── §3 KAPSAM BEYANI ──────────────────────────────────────────────────────
  console.log("§3 — bu bekçinin ÖLÇMEDİĞİ");
  console.log("   · invariant'ın KENDİSİ ölçülmez: 'storno dispatchedAt'i NULL'lar mı' ayrı bir sorudur.");
  console.log("     Burada ölçülen tek şey: invariant BOZULDUĞUNDA süzgecin hâlâ tuttuğu.");
  console.log("   · Süzgecin İKİNCİ savunma hattı olduğu bu yeşille değişmez — birinci hat servistedir.");
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.shipments.length) await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    // ⚠️ FK sırası: top → sevkiyat → ürün/müşteri.
    if (ids.customer) await prisma.customer.deleteMany({ where: { id: ids.customer } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: ids.item } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
