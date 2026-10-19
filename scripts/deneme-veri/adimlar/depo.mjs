// Depo/stok dolgusu (dolgu-2): yeni alış siparişleri (teslim alınan · kısmi · bekleyen · gecikmiş · sarf) + mal kabul,
// iplik üretime çıkışı ve iki AÇIK sayım (iplik deposu: sayım girildi, bir bobin farkı · mamul B: yarıda). Sayım TAMAMLANMAZ:
// tamamlama `roll:manual-adjust` (SoD) ister, hizmet hesabında yoktur — taslak "sayım sürüyor" görünümüdür, depoyu kilitlemez.
// Tokenlı uçlar replay'e düşer; sayım ve iplik hareketi tokensızdır → notlardaki [DV2-…] işaretiyle aranır.
import { katlaAd } from "../lib/baglam.mjs";
import { belirlenimliToken } from "../lib/token.mjs";
import { iplikHareketi } from "./ticaret.mjs";

export const EK_TEDARIKCI = ["Marmara Ambalaj Sanayi", "Bursa"];

export async function depo(c) {
  const k = c.kayit;
  const [doruk, pinar] = ["Doruk İplik Sanayi", "Pınar Elyaf Ticaret"].map((n) => k.tedarikci[n]);
  const iplikDepo = k.depo["İplik Deposu"];
  const ambalaj = (await c.bulYaDaYarat("cari", async () => (await c.hepsi(`/api/customers?search=${encodeURIComponent("Marmara Ambalaj")}`)).find((x) => katlaAd(x.name) === katlaAd(EK_TEDARIKCI[0])),
    async () => (await c.api("POST", "/api/customers", { name: EK_TEDARIKCI[0], isSupplierRole: true, isCustomerRole: false, city: EK_TEDARIKCI[1] }, { tekDeneme: true })).data)).id;

  // Alış siparişleri: PO4 bu hafta teslim (tam kabul) · PO5 kısmi kabul · PO6 sarf (bekliyor) · PO7 termini geçmiş (gecikmiş)
  const po4 = await c.tokenli("satinalma", "dv2:po:4", "/api/purchase-orders", {
    supplierId: doruk, currency: "USD", orderDate: c.gunStr(-12), expectedDate: c.gunStr(0), notes: "Atkı ipliği — jakar siparişleri için ek alım",
    lines: [{ itemId: k.kalem["PES 300/96 ATKI İPLİĞİ"], qty: 1600, unitPrice: 2.05 }],
  });
  const po5 = await c.tokenli("satinalma", "dv2:po:5", "/api/purchase-orders", {
    supplierId: pinar, currency: "USD", orderDate: c.gunStr(-9), expectedDate: c.gunStr(3), notes: "Viskon — iki sevkiyatta teslim",
    lines: [{ itemId: k.kalem["VİSKON 150 DENYE İPLİK"], qty: 1000, unitPrice: 3.1 }],
  });
  await c.tokenli("satinalma", "dv2:po:6", "/api/purchase-orders", {
    supplierId: ambalaj, currency: "TRY", orderDate: c.gunStr(-4), expectedDate: c.gunStr(6), notes: "Paketleme sarfı — aylık",
    lines: [{ itemId: k.kalem["KARTON MASURA 280 CM"], qty: 400, unitPrice: 38 }, { itemId: k.kalem["AMBALAJ NAYLONU"], qty: 250, unitPrice: 96 }],
  });
  await c.tokenli("satinalma", "dv2:po:7", "/api/purchase-orders", {
    supplierId: pinar, currency: "USD", orderDate: c.gunStr(-41), expectedDate: c.gunStr(-27), notes: "Pamuk ipliği — tedarikçi gecikmesi, takipte",
    lines: [{ itemId: k.kalem["PAMUK NE 30/1 İPLİK"], qty: 900, unitPrice: 3.35 }],
  });
  const satir = (anahtar, ad, kg, lot, bobin, fiyat) => ({ itemId: k.kalem[ad], initialQty: kg, lotNo: lot, bobbinCount: bobin, unitPrice: fiyat, clientToken: belirlenimliToken(anahtar) });
  k.malKabul2 = [];
  k.malKabul2.push(await c.tokenli("mal-kabul", "dv2:gr:4", "/api/goods-receipts", {
    warehouseId: iplikDepo, supplierId: doruk, purchaseOrderId: po4.id, currency: "USD", deliveryNoteNo: "IRS-DRK-1107",
    lines: [satir("dv2:gr:4:a", "PES 300/96 ATKI İPLİĞİ", 1600, "DRK-2610-300C", 270, 2.05)],
  }));
  k.malKabul2.push(await c.tokenli("mal-kabul", "dv2:gr:5", "/api/goods-receipts", {
    warehouseId: iplikDepo, supplierId: pinar, purchaseOrderId: po5.id, currency: "USD", deliveryNoteNo: "IRS-PNR-0431",
    lines: [satir("dv2:gr:5:a", "VİSKON 150 DENYE İPLİK", 520, "PNR-2610-V150", 104, 3.1)],
  }));

  // İplik üretime çıkışı (dokuma salonu) — tokensız, gerekçedeki işaretle aranır
  const CIKIS = [
    ["DV2-CIKIS-1", "PES 300/96 ATKI İPLİĞİ", 420, "Dokuma salonu atkı ihtiyacı — DK1/DK2"],
    ["DV2-CIKIS-2", "PES 300/96 ATKI İPLİĞİ", 365, "Dokuma salonu atkı ihtiyacı — DK4/DK5"],
    ["DV2-CIKIS-3", "VİSKON 150 DENYE İPLİK", 140, "Jakar desen atkısı — DK6"],
  ];
  for (const [isaret, ad, kg, neden] of CIKIS) {
    await iplikHareketi(c, isaret, { itemId: k.kalem[ad], warehouseId: iplikDepo, kind: "OUT", qtyKg: kg, reason: `${neden} [${isaret}]` });
  }

  // Sayımlar (DRAFT): fotoğraf açılışta donar; satır işaretleri canlı satır durumundan karar verir (ikinci koşum no-op).
  const sayimAc = async (isaret, warehouseId, notes) => c.bulYaDaYarat("stok-sayim", async () => (await c.hepsi(`/api/stock-counts?warehouseId=${warehouseId}`)).find((s) => (s.notes ?? "").includes(`[${isaret}]`) && s.status !== "CANCELLED"),
    async () => (await c.api("POST", "/api/stock-counts", { warehouseId, notes }, { tekDeneme: true })).data);
  const satirlar = async (id) => { const d = (await c.api("GET", `/api/stock-counts/${id}`)).data; return { durum: d.status, satir: (d.lines ?? []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))) }; };

  const s1 = await sayimAc("DV2-SAYIM-IPLIK", iplikDepo, "Ekim sonu iplik sayımı — bobin bazında [DV2-SAYIM-IPLIK]");
  {
    const { durum, satir } = await satirlar(s1.id);
    if (durum === "DRAFT") {
      for (const [i, l] of satir.entries()) {
        const beklenen = Number(l.expectedQty ?? l.systemQty ?? l.bookQty ?? 0);
        const sayilan = i === 0 ? +(beklenen - 8.5).toFixed(3) : beklenen;
        await c.kosulluYaz("stok-sayim-satir", async () => l.countedQty == null && l.found == null,
          () => c.api("PATCH", `/api/stock-counts/${s1.id}/lines/${l.id}`, { found: true, countedQty: sayilan, notes: i === 0 ? "Bir bobin eksik — fire kontrol edilecek" : null }));
      }
    }
  }
  const mamulB = k.depo["Mamul Deposu B"];
  const s2 = await sayimAc("DV2-SAYIM-MAMUL", mamulB, "B binası raf sayımı — devam ediyor [DV2-SAYIM-MAMUL]");
  {
    const { durum, satir } = await satirlar(s2.id);
    if (durum === "DRAFT") {
      for (const l of satir.slice(0, Math.max(1, satir.length - 1))) {
        await c.kosulluYaz("stok-sayim-satir", async () => l.found == null, () => c.api("PATCH", `/api/stock-counts/${s2.id}/lines/${l.id}`, { found: true }));
      }
    }
  }
}
