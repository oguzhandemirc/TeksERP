// Ticaret (fiyat kartı · alış siparişi · mal kabul) + iplik (lot, stok) + emanet (müşteri ipliği) + çoklu depo transferi.
// Satınalma/kabul/transfer clientToken'lı; fiyat upsert doğası gereği idempotent; tokensız iplik hareketi gerekçesindeki
// [DV-…] işaretiyle aranır.

const FIYAT_SATIS = [["HAM PERDELİK 280", 92], ["HAM DÖŞEMELİK 140", 118], ["HAM TÜL 300", 64], ["JAKARLI DÖŞEMELİK 140", 185],
  ["KETEN GÖRÜNÜMLÜ PERDE 280", 124], ["SATEN DÖŞEMELİK 140", 158]];
const FIYAT_ALIS = [["PES 150/48 ÇÖZGÜ İPLİĞİ", "USD", 2.35], ["PES 300/96 ATKI İPLİĞİ", "USD", 2.1], ["PAMUK NE 30/1 İPLİK", "USD", 3.4],
  ["VİSKON 150 DENYE İPLİK", "USD", 3.05], ["HAM PERDELİK 280", "TRY", 61]];

export async function ticaret(c) {
  const k = c.kayit;
  for (const [ad, fiyat] of FIYAT_SATIS) {
    await c.api("POST", "/api/item-prices", { itemId: k.kalem[ad], kind: "SALE", currency: "TRY", price: fiyat });
    c.say("fiyat (upsert)", "yeni");
  }
  for (const [ad, cur, fiyat] of FIYAT_ALIS) {
    await c.api("POST", "/api/item-prices", { itemId: k.kalem[ad], kind: "PURCHASE", currency: cur, price: fiyat });
    c.say("fiyat (upsert)", "yeni");
  }
  const [doruk, pinar] = ["Doruk İplik Sanayi", "Pınar Elyaf Ticaret"].map((n) => k.tedarikci[n]);
  const iplikDepo = k.depo["İplik Deposu"];

  // PO1 tam kabul; PO2 kısmi kabul (açık bakiye ekranda görünsün); PO3 hiç kabul yok (bekleyen)
  const po1 = await c.tokenli("satinalma", "dv:po:1", "/api/purchase-orders", {
    supplierId: doruk, currency: "USD", orderDate: c.gunStr(-24), expectedDate: c.gunStr(-17), notes: "Çözgü ve atkı ipliği — aylık alım",
    lines: [{ itemId: k.kalem["PES 150/48 ÇÖZGÜ İPLİĞİ"], qty: 2400, unitPrice: 2.35 }, { itemId: k.kalem["PES 300/96 ATKI İPLİĞİ"], qty: 1800, unitPrice: 2.1 }],
  });
  const po2 = await c.tokenli("satinalma", "dv:po:2", "/api/purchase-orders", {
    supplierId: pinar, currency: "USD", orderDate: c.gunStr(-14), expectedDate: c.gunStr(-3), notes: "Pamuk ve viskon — iki partide teslim",
    lines: [{ itemId: k.kalem["PAMUK NE 30/1 İPLİK"], qty: 1200, unitPrice: 3.4 }, { itemId: k.kalem["VİSKON 150 DENYE İPLİK"], qty: 800, unitPrice: 3.05 }],
  });
  await c.tokenli("satinalma", "dv:po:3", "/api/purchase-orders", {
    supplierId: doruk, currency: "USD", orderDate: c.gunStr(-2), expectedDate: c.gunStr(12), notes: "Kasım ihtiyacı",
    lines: [{ itemId: k.kalem["PES 150/48 ÇÖZGÜ İPLİĞİ"], qty: 3000, unitPrice: 2.3 }],
  });
  const iplikSatir = (anahtar, ad, kg, lot, bobin, fiyat) => ({ itemId: k.kalem[ad], initialQty: kg, lotNo: lot, bobbinCount: bobin, unitPrice: fiyat, clientToken: belirle(c, anahtar) });
  await c.tokenli("mal-kabul", "dv:gr:1", "/api/goods-receipts", {
    warehouseId: iplikDepo, supplierId: doruk, purchaseOrderId: po1.id, currency: "USD", deliveryNoteNo: "IRS-DRK-1021",
    lines: [iplikSatir("dv:gr:1:a", "PES 150/48 ÇÖZGÜ İPLİĞİ", 2400, "DRK-2609-150A", 480, 2.35), iplikSatir("dv:gr:1:b", "PES 300/96 ATKI İPLİĞİ", 1800, "DRK-2609-300B", 300, 2.1)],
  });
  await c.tokenli("mal-kabul", "dv:gr:2", "/api/goods-receipts", {
    warehouseId: iplikDepo, supplierId: pinar, purchaseOrderId: po2.id, currency: "USD", deliveryNoteNo: "IRS-PNR-0388",
    lines: [iplikSatir("dv:gr:2:a", "PAMUK NE 30/1 İPLİK", 600, "PNR-2610-P30", 120, 3.4)],
  });
  // Ham kumaş alımı (top doğar) → bir kısmı ikinci depoya transfer
  const gr3 = await c.tokenli("mal-kabul", "dv:gr:3", "/api/goods-receipts", {
    warehouseId: k.depo.varsayilan, supplierId: pinar, currency: "TRY", deliveryNoteNo: "IRS-PNR-0412", notes: "Ham perdelik — dış alım",
    lines: [101.5, 98.2, 104.8, 99.6, 102.3, 97.9].map((m, i) => ({ itemId: k.kalem["HAM PERDELİK 280"], initialQty: m, width: 280, qualityGrade: "1.KALITE", unitPrice: 61, lineClass: "FINISHED", clientToken: belirle(c, `dv:gr:3:${i}`) })),
  });
  const detay = (await c.api("GET", `/api/goods-receipts/${gr3.id}`)).data;
  const toplar = (detay.rolls ?? detay.lines?.map((l) => l.roll).filter(Boolean) ?? []).map((r) => r.id).sort();
  k.alimToplari = toplar;
  if (toplar.length >= 3) {
    await c.tokenli("depo-transfer", "dv:tr:1", "/api/warehouse-transfers", {
      fromWarehouseId: k.depo.varsayilan, toWarehouseId: k.depo["Mamul Deposu B"], rollIds: toplar.slice(0, 3), notes: "Sevk öncesi B binasına aktarım",
    });
  } else console.log(`  ⚠ mal kabul detayında top bulunamadı (${toplar.length}) — transfer atlandı`);

  // Emanet: müşterinin kendi ipliği (sahiplik doğum niteliği) — lot + stok girişi
  const emanetSahibi = k.musteriler[0].id;
  const lot = await c.bulYaDaYarat("iplik-lot", async () => (await c.hepsi(`/api/yarn/lots?search=EMN-2610`)).find((x) => x.lotNo === "EMN-2610-02"),
    async () => (await c.api("POST", "/api/yarn/lots", { itemId: k.kalem["PES 150/48 ÇÖZGÜ İPLİĞİ"], lotNo: "EMN-2610-02", notes: "Müşteri emaneti — fason dokuma için", ownerCustomerId: emanetSahibi }, { tekDeneme: true })).data);
  k.emanetLot = lot.id;
  await iplikHareketi(c, "DV-EMANET-1", { itemId: k.kalem["PES 150/48 ÇÖZGÜ İPLİĞİ"], warehouseId: iplikDepo, kind: "IN", qtyKg: 450, lotId: lot.id, reason: "Müşteri emanet ipliği girişi [DV-EMANET-1]" });
  // Sayım farkı (gerçekçi küçük düzeltme)
  await iplikHareketi(c, "DV-SAYIM-1", { itemId: k.kalem["PES 300/96 ATKI İPLİĞİ"], warehouseId: iplikDepo, kind: "ADJUST_OUT", qtyKg: 12.5, reason: "Sayım farkı — bobin firesi [DV-SAYIM-1]" });
}

export async function iplikHareketi(c, isaret, govde) {
  await c.bulYaDaYarat("iplik-hareket", async () => (await c.hepsi(`/api/yarn/movements?itemId=${govde.itemId}`)).find((m) => (m.reason ?? "").includes(`[${isaret}]`)),
    async () => (await c.api("POST", "/api/yarn/movements", govde, { tekDeneme: true })).data);
}

import { belirlenimliToken } from "../lib/token.mjs";
const belirle = (_c, anahtar) => belirlenimliToken(anahtar);
