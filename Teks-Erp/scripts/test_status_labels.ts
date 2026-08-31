// =============================================================================
// BEKÇİ — HATA MESAJLARINDA VE BELGELERDE HAM ENUM YOK
// =============================================================================
// Çalıştırma: npx tsx scripts/test_status_labels.ts
//
// NEDEN VAR (2026-08-15 saha taraması, "ham-metin" merceği): bu projede
// kullanıcıya giden her metin Türkçedir, ama backend'in dört yüzeyi ham enum
// basıyordu ve biri KALICIYDI:
//   ⭐ `stock-count.service.blockReason` → "Statüsü değişti (AT_SUBCONTRACTOR)"
//      metni `StockCountLine.outOfScopeReason` KOLONUNA yazılır ve sayım
//      tutanağı DONDURULUR → kâğıda bir kez basıldığında geriye dönük
//      düzeltilemez (tutanak sayım tartışmasının kanıt kâğıdıdır).
//   • depo transferi ön-kontrolü → "durumu uygun değil (AT_SUBCONTRACTOR)"
//   • depo transferi GERİ ALMA → dört FARKLI sebep için tek tip `(status)`
//     basıyordu; çuvala konmuş top için "T15… (WAREHOUSE)" diyordu, yani
//     kullanıcı durumu okuyor, hiçbir sorun görmüyor ve engeli çözemiyordu.
//     ⚠️ Bu kalemde ham enum'u Türkçeleştirmek TEK BAŞINA YETMEZ — söylenmesi
//     gereken şey DURUM değil SEBEPTİR (§3 bunu ölçer).
//   • çekle fatura kapatma reddi → "durumu BOUNCED" (sözlük `cheque.service`de
//     "tek kaynak" diye yazılıydı ama export edilmemişti)
//   • alış siparişi revizyon reddi → "(durum: PARTIAL)"
//
// ÖLÇÜLENLER:
//   §1 SÖZLÜK PARİTESİ — backend `ROLL_STATUS_TR` ≡ panel `rollStatusLabels`,
//      `PURCHASE_ORDER_STATUS_TR` ≡ panel `PO_STATUS_LABEL` (Electron backend'i
//      import EDEMEZ → kopya bilinçli, eşitlik MEKANİK doğrulanır)
//   §2 Depo transferi ön-kontrolü Türkçe durum basıyor (işlevsel)
//   §3 ⭐ Geri alma reddi SEBEBİ söylüyor — dört dalın üçü ayrı ayrı (işlevsel)
//   §4 Alış siparişi revizyon reddi Türkçe (işlevsel)
//   §5 Çekle kapama reddi Türkçe (işlevsel — `loadChequeTx` yolundan)
//   §6 KÖRLÜK ZEMİNİ + kaynak taraması (stock-count dalı: donmuş belge yolu
//      fixture'ı ağır olduğu için AST/metin taramasıyla kilitlenir)
//
// NEGATİF SONDALAR (2026-08-15 — üçü de koşuldu, kırmızı GÖRÜLDÜ, dosyalar
// shasum ile birebir geri yüklendi):
//   • `ROLL_STATUS_TR.AT_SUBCONTRACTOR` metni değiştirildi → §1 KIRMIZI
//   • `warehouse-transfer.cancel`ın sebep üreteci eski hâline (`(${r.status})`)
//     çevrildi → §3 KIRMIZI (üç dal da)
//   • `payment-allocation`daki `CHEQUE_STATUS_LABEL[...]` ham `c.status`a
//     çevrildi → §5 KIRMIZI
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ChequeStatus,
  InvoiceStatus,
  InvoiceType,
  PurchaseOrderStatus,
  RollStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ROLL_STATUS_TR, PURCHASE_ORDER_STATUS_TR } from "../src/constants/status-labels";
import { CHEQUE_STATUS_LABEL } from "../src/services/cheque.service";
import { warehouseTransferService } from "../src/services/warehouse-transfer.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { paymentAllocationService } from "../src/services/payment-allocation.service";
import { InventoryService } from "../src/services/inventory.service";

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const TAG = `TEST-LBL-${Date.now()}`;
const rollIds: string[] = [];
const warehouseIds: string[] = [];
const transferIds: string[] = [];
const sackIds: string[] = [];
const poIds: string[] = [];
const invoiceIds: string[] = [];
const chequeIds: string[] = [];
const cariIds: string[] = [];
const customerIds: string[] = [];

/** Panel sözlüğünü kaynak dosyadan okur (Electron ayrı proje — import EDİLEMEZ). */
function parsePanelDict(file: string, constName: string): Record<string, string> | null {
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf(`${constName}`);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  const close = src.indexOf("};", open);
  if (open < 0 || close < 0) return null;
  const body = src.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) out[m[1]!] = m[2]!;
  return Object.keys(out).length > 0 ? out : null;
}

async function main(): Promise<void> {
  console.log("=== Durum etiketi (ham enum) bekçisi ===\n");
  const KOK = path.resolve(__dirname, "../..");

  // ── §1 SÖZLÜK PARİTESİ ───────────────────────────────────────────────────
  const panelRoll = parsePanelDict(path.join(KOK, "Electron/src/types/enums.ts"), "rollStatusLabels");
  if (!panelRoll) {
    check("§1a Panel `rollStatusLabels` okunabildi", false, "dosya/desen bulunamadı — yol değişmiş olabilir");
  } else {
    // KÖRLÜK ZEMİNİ: 2 anahtarlık bir ayrıştırma hatası "hepsi eşit" derdi.
    check("§1a Panel sözlüğü okundu (körlük zemini: ≥10 anahtar)", Object.keys(panelRoll).length >= 10, `${Object.keys(panelRoll).length} anahtar`);
    const diffs: string[] = [];
    for (const [k, v] of Object.entries(ROLL_STATUS_TR)) {
      if (panelRoll[k] !== v) diffs.push(`${k}: backend="${v}" panel="${panelRoll[k] ?? "(yok)"}"`);
    }
    check("§1b ⭐ ROLL_STATUS_TR ≡ panel rollStatusLabels (metin metin)", diffs.length === 0, diffs.join(" · ") || "birebir");
  }
  const panelPo = parsePanelDict(
    path.join(KOK, "Electron/src/pages/Operations/PurchaseOrders/labels.ts"),
    "PO_STATUS_LABEL",
  );
  if (!panelPo) {
    check("§1c Panel `PO_STATUS_LABEL` okunabildi", false, "dosya/desen bulunamadı");
  } else {
    const diffs: string[] = [];
    for (const [k, v] of Object.entries(PURCHASE_ORDER_STATUS_TR)) {
      if (panelPo[k] !== v) diffs.push(`${k}: backend="${v}" panel="${panelPo[k] ?? "(yok)"}"`);
    }
    check("§1d PURCHASE_ORDER_STATUS_TR ≡ panel PO_STATUS_LABEL", diffs.length === 0, diffs.join(" · ") || "birebir");
  }
  // Enum kapsaması — `Record<Enum,string>` derlemede zorluyor; burada RUNTIME
  // olarak da ölçülür (Prisma enum'u genişlerse üretilen istemci ile şema
  // arasındaki boşluk da yakalanır).
  const missingRoll = Object.values(RollStatus).filter((s) => !(s in ROLL_STATUS_TR));
  check("§1e Her RollStatus için etiket var", missingRoll.length === 0, missingRoll.join(",") || "13/13");
  const missingPo = Object.values(PurchaseOrderStatus).filter((s) => !(s in PURCHASE_ORDER_STATUS_TR));
  check("§1f Her PurchaseOrderStatus için etiket var", missingPo.length === 0, missingPo.join(",") || "4/4");
  const missingCheque = Object.values(ChequeStatus).filter((s) => !(s in CHEQUE_STATUS_LABEL));
  check("§1g Her ChequeStatus için etiket var (export edilmiş sözlük)", missingCheque.length === 0, missingCheque.join(",") || "9/9");

  // ── FİXTURE: iki depo + toplar ───────────────────────────────────────────
  const item = await prisma.item.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
  const whA = await prisma.warehouse.create({ data: { code: `${TAG}-A`, name: `${TAG} A` }, select: { id: true } });
  const whB = await prisma.warehouse.create({ data: { code: `${TAG}-B`, name: `${TAG} B` }, select: { id: true } });
  warehouseIds.push(whA.id, whB.id);
  const makeRoll = async (warehouseId: string, qty: number): Promise<string> => {
    const res = await inventory.createInitialEntry({ itemId: item.id, initialQty: qty }, undefined, undefined, false, {
      warehouseId,
      forcedStatus: RollStatus.WAREHOUSE,
    });
    const id = (res.data as { id: string }).id;
    rollIds.push(id);
    return id;
  };

  // ── §2 ÖN-KONTROL: durum Türkçe ─────────────────────────────────────────
  const blocked = await makeRoll(whA.id, 90);
  await prisma.roll.update({ where: { id: blocked }, data: { status: RollStatus.AT_SUBCONTRACTOR } });
  const preMsg = await expectError(() =>
    warehouseTransferService.create({ fromWarehouseId: whA.id, toWarehouseId: whB.id, rollIds: [blocked] }),
  );
  check(
    "§2a Ön-kontrol Türkçe durum basıyor ('Fasonda')",
    preMsg.includes(ROLL_STATUS_TR.AT_SUBCONTRACTOR),
    preMsg.slice(0, 110),
  );
  check("§2b Ham enum YOK", !preMsg.includes("AT_SUBCONTRACTOR"), preMsg.slice(0, 110));
  await prisma.roll.update({ where: { id: blocked }, data: { status: RollStatus.WAREHOUSE } });

  // ── §3 GERİ ALMA: SEBEP-BAŞINA cümle ────────────────────────────────────
  // Üç ayrı dal tek transferde kurulur: (a) depo değişmiş, (b) çuvala konmuş,
  // (c) durumu uygun değil. Mesajın hepsini birden söylemesi de ölçülür —
  // kullanıcı üç topu tek seferde düzeltebilmeli.
  const rMoved = await makeRoll(whA.id, 40);
  const rSacked = await makeRoll(whA.id, 41);
  const rScrap = await makeRoll(whA.id, 42);
  const tr = await warehouseTransferService.create({
    fromWarehouseId: whA.id,
    toWarehouseId: whB.id,
    rollIds: [rMoved, rSacked, rScrap],
  });
  const trId = (tr.data as { id: string }).id;
  transferIds.push(trId);

  // (a) hedef depodan çıktı
  await prisma.roll.update({ where: { id: rMoved }, data: { warehouseId: whA.id } });
  // (b) transferden SONRA bir çuvala kondu
  const sack = await prisma.sack.create({ data: { sackNo: `${TAG}-CV`, seq: 1 }, select: { id: true } });
  sackIds.push(sack.id);
  await prisma.roll.update({ where: { id: rSacked }, data: { sackId: sack.id } });
  // (c) durum artık transfer edilebilir değil
  await prisma.roll.update({ where: { id: rScrap }, data: { status: RollStatus.SCRAP } });

  const undoMsg = await expectError(() => warehouseTransferService.cancel(trId, "TEST"));
  check("§3a Geri alma reddedildi", undoMsg.length > 0, undoMsg.slice(0, 80));
  check("§3b ⭐ 'hedef depoda değil' sebebi söylendi", undoMsg.includes("hedef depoda değil"), undoMsg.slice(0, 200));
  check("§3c ⭐ 'çuvala konmuş' sebebi söylendi (eski kod burada 'WAREHOUSE' diyordu)", undoMsg.includes("çuvala konmuş"), undoMsg.slice(0, 240));
  check("§3d ⭐ 'durumu uygun değil (Fire)' sebebi söylendi", undoMsg.includes(`durumu uygun değil (${ROLL_STATUS_TR.SCRAP})`), undoMsg.slice(0, 240));
  check(
    "§3e Ham enum YOK (WAREHOUSE/SCRAP/AT_SUBCONTRACTOR)",
    !/\b(WAREHOUSE|SCRAP|AT_SUBCONTRACTOR|A1_STOCK)\b/.test(undoMsg),
    undoMsg.slice(0, 240),
  );

  // Temizlik ön koşulu: engelleri kaldırıp transferi gerçekten geri al
  // (fixture kendi izini bırakmasın).
  await prisma.roll.update({ where: { id: rMoved }, data: { warehouseId: whB.id } });
  await prisma.roll.update({ where: { id: rSacked }, data: { sackId: null } });
  await prisma.roll.update({ where: { id: rScrap }, data: { status: RollStatus.WAREHOUSE } });
  await warehouseTransferService.cancel(trId, "TEST — temizlik");

  // ── §4 ALIŞ SİPARİŞİ REVİZYON REDDİ ─────────────────────────────────────
  const supplier = await prisma.customer.create({
    data: { code: `${TAG}-SUP`, name: `${TAG} Tedarikçi`, type: "SUPPLIER" },
    select: { id: true },
  });
  customerIds.push(supplier.id);
  const po = await purchaseOrderService.create({
    supplierId: supplier.id,
    currency: "TRY",
    lines: [{ itemId: item.id, qty: 100, unitPrice: 5 }],
  });
  const poId = (po.data as { id: string }).id;
  poIds.push(poId);
  // Durumu doğrudan PARTIAL yap: mesajın ETİKETİNİ ölçüyoruz, karşılanma
  // zincirini değil (o `test_purchase_order`ın işi).
  await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: PurchaseOrderStatus.PARTIAL } });
  const poMsg = await expectError(() => purchaseOrderService.update(poId, { notes: "revizyon denemesi" }));
  check("§4a Revizyon reddi Türkçe ('Kısmen geldi')", poMsg.includes(PURCHASE_ORDER_STATUS_TR.PARTIAL), poMsg.slice(0, 130));
  check("§4b Ham enum YOK ('PARTIAL')", !poMsg.includes("PARTIAL"), poMsg.slice(0, 130));

  // ── §5 ÇEKLE FATURA KAPATMA REDDİ ───────────────────────────────────────
  // Fatura ve çek DOĞRUDAN yazılır: ölçülen şey `loadChequeTx`in ürettiği
  // MESAJ, onay/defter zinciri değil (o `test_payment_allocation`ın işi).
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: supplier.id },
    select: { id: true },
  });
  cariIds.push(cari.id);
  const inv = await prisma.invoice.create({
    data: {
      docNo: `${TAG}-SF`,
      type: InvoiceType.SALES,
      status: InvoiceStatus.CONFIRMED,
      cariId: cari.id,
      currency: "TRY",
      issueDate: new Date(),
      subtotal: "100.00",
      grandTotal: "100.00",
      grandTotalTry: "100.00",
      confirmedAt: new Date(),
    },
    select: { id: true },
  });
  invoiceIds.push(inv.id);
  const cheque = await prisma.cheque.create({
    data: {
      docNo: `${TAG}-CK`,
      kind: "RECEIVED",
      status: ChequeStatus.BOUNCED,
      cariId: cari.id,
      currency: "TRY",
      amount: "100.00",
      amountTry: "100.00",
      issueDate: new Date(),
      postingDate: new Date(),
      dueDate: new Date(),
    },
    select: { id: true },
  });
  chequeIds.push(cheque.id);
  const alcMsg = await expectError(() =>
    paymentAllocationService.allocate({ invoiceId: inv.id, chequeId: cheque.id, amount: "10.00" }),
  );
  check(
    "§5a Çek reddi Türkçe ('karşılıksız')",
    alcMsg.includes(CHEQUE_STATUS_LABEL.BOUNCED),
    alcMsg.slice(0, 150),
  );
  check("§5b Ham enum YOK ('BOUNCED')", !alcMsg.includes("BOUNCED"), alcMsg.slice(0, 150));

  // ── §6 KAYNAK TARAMASI — stok sayım tutanağı dalı ───────────────────────
  // ⚠️ NEDEN TARAMA: `blockReason` modül-PRIVATE ve tetiklemek için tam sayım
  // akışı (aç → okut → tamamla → dondur) gerekir; o zinciri `test_stock_count`
  // zaten koşuyor. Buradaki risk metnin İÇERİĞİDİR ve tarama onu kilitler.
  const scSrc = fs.readFileSync(path.resolve(__dirname, "../src/services/stock-count.service.ts"), "utf8");
  check(
    "§6a stock-count `blockReason` ham `roll.status` BASMIYOR",
    !/Statüsü değişti \(\$\{roll\.status\}\)/.test(scSrc),
    "donmuş belgeye ham enum yazılırsa geriye dönük düzeltilemez",
  );
  check("§6b stock-count ROLL_STATUS_TR kullanıyor", /ROLL_STATUS_TR\[roll\.status\]/.test(scSrc));
  const paSrc = fs.readFileSync(path.resolve(__dirname, "../src/services/payment-allocation.service.ts"), "utf8");
  check("§6c payment-allocation sözlüğü İTHAL ediyor (ikinci kopya YOK)", /import \{ CHEQUE_STATUS_LABEL \} from "\.\/cheque\.service"/.test(paSrc));

  check(
    "§6z Körlük zemini: fixture gerçekten kuruldu",
    rollIds.length >= 4 && transferIds.length >= 1 && poIds.length === 1 && chequeIds.length === 1,
    `top=${rollIds.length} transfer=${transferIds.length} po=${poIds.length} çek=${chequeIds.length}`,
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (chequeIds.length) await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
      if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      if (poIds.length) {
        await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
      }
      if (rollIds.length) {
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
      if (transferIds.length) await prisma.warehouseTransfer.deleteMany({ where: { id: { in: transferIds } } });
      if (warehouseIds.length) await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
      if (cariIds.length) await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
