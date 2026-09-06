// =============================================================================
// BEKÇİ — SEVK İRSALİYESİ NE ZAMAN DONAR (sevk ANINDA, ilk baskıda DEĞİL)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts doc_freeze_timing
//
// ⭐ NEDEN YAZILDI: 2026-09-06'da ölçüldü — `performDispatchTx` /
//    `dispatchShipment` içindeki iki `freezeForSource(SHIPMENT_DISPATCH, …)`
//    çağrısı SİLİNDİĞİNDE beş belge bekçisinin (dispatch_document ·
//    doc_batch_column · dispatch_print_options · sack_note_document ·
//    manual_sack_count) HİÇBİRİ kırmızı vermedi.
//
//    Sebebi öğretici: `getCurrent` LAZY-INIT yapar — donmuş belge yoksa okuma
//    anında kurar. Bu yüzden "belge var mı" sorusu kapı silindikten sonra da
//    EVET döner ve bekçiler hiçbir şey fark etmez. Değişen tek şey SNAPSHOT'IN
//    ALINDIĞI AN'dır: sevkten sonra kaynak veride olan her değişiklik
//    (müşteri adı, vergi no, unvan) "donmuş" belgeye SIZAR. Sahada bu, aynı
//    irsaliye numarasının iki farklı isimle basılması demektir.
//
// NE ÖLÇER: donma ANI.
//   §2 sevkten hemen SONRA, HİÇ okuma yapılmadan belge var mı (v1, ACTIVE)
//   §3 sevkten sonra müşteri adı değişirse belge ESKİ adı taşımaya devam eder
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `shipping.service.ts`teki iki
//    `freezeForSource(tx, PrintedDocType.SHIPMENT_DISPATCH, shipmentId, userId)`
//    satırı silinince §2 ve §3 KIRMIZI (§3'te lazy-init YENİ adı dondurur).
//    Geri alındığında yeşil.
// =============================================================================
import { PrintedDocStatus, PrintedDocType, RollStatus, RollEntrySource, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ShippingService } from "../src/services/shipping.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { ensureTestAdmin } from "./fixture-test-user";

const ship = new ShippingService();
const TS = Date.now();
const P = `TEST-DFT-${TS}`;
const ILK_AD = `${P} MUSTERI ILK`;
const YENI_AD = `${P} MUSTERI SONRA`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

let itemId = "";
let customerId = "";
let userId = "";
const createdRolls: string[] = [];
const createdSacks: string[] = [];
const createdShipments: string[] = [];

async function run(): Promise<void> {
  userId = (await ensureTestAdmin()).id;
  customerId = (await prisma.customer.create({
    data: { code: `${P}-C`, name: ILK_AD }, select: { id: true },
  })).id;
  itemId = (await prisma.item.create({
    data: { code: `${P}-I`, name: `${P} KUMAS`, itemType: "FABRIC" }, select: { id: true },
  })).id;

  const roll = await prisma.roll.create({
    data: {
      barcode: `${P}-R1`, itemId, width: 150, initialQty: 100, currentQty: 100,
      status: RollStatus.WAREHOUSE, qualityGrade: "1.KALITE",
      entrySource: RollEntrySource.SUPPLIER_RECEIPT,
    },
    select: { id: true, barcode: true },
  });
  createdRolls.push(roll.id);

  const sack = (await ship.openSack({ customerId }, userId)).data as { id: string };
  createdSacks.push(sack.id);
  await ship.scanIntoSack({ sackId: sack.id, barcode: roll.barcode! }, userId);

  const sh = (await ship.createShipment(
    { sackIds: [sack.id], customerId, orderless: true }, userId,
  )).data as { id: string };
  createdShipments.push(sh.id);

  // ── §1 KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────
  // Bu bekçi ancak sevkiyat GERÇEKTEN sevk edilmişse anlamlıdır (sevk onayı
  // bayrağı AÇIK olsaydı PLANNED kalırdı ve §2 vakumen yeşil olurdu).
  console.log("\n§1 — körlük zemini");
  const durum = await prisma.shipment.findUnique({
    where: { id: sh.id }, select: { status: true },
  });
  check("fixture: sevkiyat DISPATCHED durumda", durum?.status === ShipmentStatus.DISPATCHED,
    `ölçülen ${durum?.status}`);

  // ── §2 BELGE SEVK ANINDA DOĞAR ───────────────────────────────────────────
  // DİKKAT: buraya kadar HİÇ belge OKUMASI yapılmadı — `getCurrent` lazy-init
  // ettiği için bir okuma bu kontrolü sahte yeşile çevirirdi.
  console.log("\n§2 — belge sevk ANINDA donmuş (okuma yapılmadan)");
  const rows = await prisma.printedDocument.findMany({
    where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: sh.id },
    select: { version: true, status: true, snapshot: true },
    orderBy: { version: "asc" },
  });
  check("⭐ sevkten hemen sonra donmuş belge VAR (lazy-init'e bırakılmamış)", rows.length === 1,
    `${rows.length} satır`);
  check("belge v1 ve ACTIVE",
    rows[0]?.version === 1 && rows[0]?.status === PrintedDocStatus.ACTIVE);

  // ── §3 SONRAKİ DEĞİŞİKLİK BELGEYE SIZMAZ ─────────────────────────────────
  console.log("\n§3 — sevkten sonraki müşteri adı değişikliği belgeye sızmaz");
  await prisma.customer.update({ where: { id: customerId }, data: { name: YENI_AD } });
  const cur = (await printedDocumentService.getCurrent(
    PrintedDocType.SHIPMENT_DISPATCH, sh.id,
  )).data as { snapshot: { doc: { header: { customerName: string } } } } | null;
  const adBelgede = cur?.snapshot?.doc?.header?.customerName ?? "";
  check("⭐ belgedeki müşteri adı SEVK ANINDAKİ ad (sonraki değişiklik sızmadı)",
    adBelgede === ILK_AD, `belgede "${adBelgede}"`);
  check("canlı kayıtta ad gerçekten değişmiş (sonda gerçekten çalıştı)",
    (await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } }))?.name === YENI_AD);
}

async function teardown(): Promise<void> {
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: createdShipments } } }).catch(() => {});
  await prisma.sackAllocation.deleteMany({ where: { sackId: { in: createdSacks } } }).catch(() => {});
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRolls } } }).catch(() => {});
  await prisma.roll.updateMany({
    where: { id: { in: createdRolls } }, data: { sackId: null, shipmentId: null },
  }).catch(() => {});
  await prisma.roll.deleteMany({ where: { id: { in: createdRolls } } }).catch(() => {});
  await prisma.sack.deleteMany({ where: { id: { in: createdSacks } } }).catch(() => {});
  await prisma.shipment.deleteMany({ where: { id: { in: createdShipments } } }).catch(() => {});
  if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
}

run()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await teardown().catch((e) => console.error("teardown hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
