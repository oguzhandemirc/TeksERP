/**
 * API TURU — müşterinin `demo` hesabıyla göreceği HER listeyi/raporu yoklar.
 *
 * Neden API: panelin içeriği sekme başına `createMemoryRouter`da yaşıyor, yani
 * tarayıcı turu ekranları ancak TIKLAYARAK gezebiliyor ve yerelde web derlemesi
 * takılıyor. Uçlar ise ekranların TEK veri kaynağı — bir liste boşsa ya da 5xx
 * veriyorsa müşteri onu ekranda görür.
 *
 * Ölçüm: HTTP kodu · satır sayısı · hata gövdesi. Çıktı üç kovaya ayrılır:
 *   ✗ HATA  (4xx/5xx)      → müşteri "bu özellik çalışmıyor" der
 *   ○ BOŞ   (200 ama 0)    → müşteri "bu özellik yok" der
 *   ✓ DOLU
 */
const BASE = process.env.TUR_BASE || "http://127.0.0.1:4000";
const USER = process.env.TUR_USER || "demo";
const PASS = process.env.TUR_PASS || "Zuo3LyGi9pNm";

const gun = (n) => new Date(Date.now() - n * 86400000).toISOString();
const ARALIK = `dateFrom=${encodeURIComponent(gun(120))}&dateTo=${encodeURIComponent(gun(-1))}`;

/** [ad, yol] — panelin gerçekten çağırdığı uçlar. */
const UCLAR = [
  ["Kumaşlar", "/api/items?page=1&pageSize=20"],
  ["Renkler", "/api/colors?page=1&pageSize=20"],
  ["Kumaş özellikleri", "/api/fabric-properties?page=1&pageSize=20"],
  ["Müşteriler", "/api/customers?page=1&pageSize=20"],
  ["Fason firmalar", "/api/subcontractors?page=1&pageSize=20"],
  ["İstasyonlar", "/api/stations?page=1&pageSize=20"],
  ["Makineler", "/api/machines?page=1&pageSize=20"],
  ["Rotalar", "/api/routes?page=1&pageSize=20"],
  ["Depolar", "/api/warehouses?page=1&pageSize=20"],
  ["Kalite sınıfları", "/api/quality-grades?page=1&pageSize=20"],
  ["Hata tipleri", "/api/defect-types?page=1&pageSize=20"],
  ["Etiket şablonları", "/api/label-templates?page=1&pageSize=20"],
  ["Siparişler", "/api/orders?page=1&pageSize=20"],
  ["İş emirleri", "/api/work-orders?page=1&pageSize=20"],
  ["Envanter — ham", "/api/rolls?page=1&pageSize=20&rollScope=RAW_STOCK_PURE"],
  ["Envanter — yarı mamul", "/api/rolls?page=1&pageSize=20&rollScope=SEMI_FINISHED"],
  ["Envanter — bitmiş", "/api/rolls?page=1&pageSize=20&status=WAREHOUSE"],
  ["Envanter — 2. kalite", "/api/rolls?page=1&pageSize=20&status=A1_STOCK"],
  ["Üretim akışı (Kanban)", "/api/rolls/production-flow"],
  ["Sevkiyatlar", "/api/shipping/shipments?page=1&pageSize=20"],
  ["Çuval havuzu (Paketleme)", "/api/shipping/pool"],
  // ⚠️ `/sack-store/board` çuval havuzu DEĞİL, SEVK KAPISI panosudur (PLANNED
  // sevkiyatlar) ve yalnız `shipping.confirmationEnabled` açıkken dolar —
  // kapalı rejimde BOŞ dönmesi DOĞRU davranıştır (2026-08-22 kararı).
  ["Sevk Kapısı (bayrak kapalıyken boş DOĞRU)", "/api/shipping/sack-store/board?limit=20"],
  ["Kartela sevkleri", "/api/kartela/dispatches?page=1&pageSize=20"],
  ["Kartela stoğu", "/api/kartela/stock?page=1&pageSize=20"],
  ["Fason sevkleri", "/api/subcontractor/dispatches?page=1&pageSize=20"],
  ["Mal kabul", "/api/goods-receipts?page=1&pageSize=20"],
  ["Alış siparişleri", "/api/purchase-orders?page=1&pageSize=20"],
  ["Depo transferleri", "/api/warehouse-transfers?page=1&pageSize=20"],
  ["Stok sayımları", "/api/stock-counts?page=1&pageSize=20"],
  ["İplik stoğu", "/api/yarn/stocks?page=1&pageSize=20"],
  ["Kalem fiyatları", "/api/item-prices?page=1&pageSize=20"],
  ["Cari hesaplar", "/api/finance/cari?page=1&pageSize=20"],
  ["Faturalar", "/api/finance/invoices?page=1&pageSize=20"],
  ["Tahsilat/ödeme", "/api/finance/payments?page=1&pageSize=20"],
  ["Çek/senet", "/api/finance/cheques?page=1&pageSize=20"],
  ["Kasa hareketleri", "/api/finance/cash-transactions?page=1&pageSize=20"],
  ["Kasa/banka hesapları", "/api/finance/cash-boxes?page=1&pageSize=20"],
  ["Döviz kurları", "/api/finance/exchange-rates?page=1&pageSize=20"],
  ["Kullanıcılar", "/api/admin/users?page=1&pageSize=20"],
  ["Yetki kataloğu", "/api/admin/permissions"],
  ["Cihazlar", "/api/admin/devices?page=1&pageSize=20"],
  ["Aktivite", "/api/admin/system-logs?page=1&pageSize=20"],
  // ── RAPORLAR ──
  ["Rapor: kalite karnesi", `/api/reports/quality/scorecard?${ARALIK}`],
  ["Rapor: fire karnesi", `/api/reports/quality/scrap-scorecard?${ARALIK}`],
  ["Rapor: stok karnesi", `/api/reports/inventory/scorecard?${ARALIK}`],
  ["Rapor: müşteri karnesi", `/api/reports/customer/scorecard?${ARALIK}`],
  ["Rapor: sipariş girişi", `/api/reports/sales/order-intake?${ARALIK}`],
  ["Rapor: sevkiyat karnesi", `/api/reports/sales/shipment-scorecard?${ARALIK}`],
  ["Rapor: sipariş iptal", `/api/reports/sales/order-cancellation?${ARALIK}`],
  ["Rapor: fason karnesi", `/api/reports/subcontract/scorecard?${ARALIK}`],
  ["Rapor: WIP", `/api/reports/production/wip?${ARALIK}`],
  ["Rapor: cari yaşlandırma", "/api/reports/finance/aging"],
  ["Rapor: kur farkı", `/api/reports/finance/fx-diff?${ARALIK}`],
];

function satirSay(gövde) {
  if (!gövde || typeof gövde !== "object") return 0;
  const d = gövde.data;
  if (Array.isArray(d)) return d.length;
  if (d && typeof d === "object") {
    for (const k of ["rows", "items", "lines", "columns", "groups", "buckets", "list"]) {
      if (Array.isArray(d[k])) return d[k].length;
    }
    const dizi = Object.values(d).find((v) => Array.isArray(v));
    if (dizi) return dizi.length;
    return Object.keys(d).length > 0 ? 1 : 0;
  }
  return 0;
}

const giris = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS, clientType: "electron" }),
});
if (!giris.ok) {
  console.error(`❌ GİRİŞ BAŞARISIZ (${giris.status}):`, (await giris.text()).slice(0, 300));
  process.exit(1);
}
const token = (await giris.json())?.data?.token;
if (!token) { console.error("❌ token yok"); process.exit(1); }
console.log(`✅ giriş: ${USER}\n`);

const hatalar = [], boslar = [], dolular = [];
for (const [ad, yol] of UCLAR) {
  try {
    const res = await fetch(BASE + yol, { headers: { authorization: `Bearer ${token}` } });
    const metin = await res.text();
    let gövde = null;
    try { gövde = JSON.parse(metin); } catch { /* JSON değil */ }
    if (!res.ok) {
      hatalar.push([ad, res.status, (gövde?.message ?? metin).slice(0, 110)]);
    } else {
      const n = satirSay(gövde);
      (n === 0 ? boslar : dolular).push([ad, n]);
    }
  } catch (e) {
    hatalar.push([ad, "AĞ", String(e).slice(0, 110)]);
  }
}

console.log(`=== ${UCLAR.length} uç · ✓ dolu ${dolular.length} · ○ boş ${boslar.length} · ✗ hata ${hatalar.length} ===\n`);
if (hatalar.length) {
  console.log("--- ✗ HATA (müşteri 'çalışmıyor' der) ---");
  for (const [a, k, m] of hatalar) console.log(`  ${String(k).padEnd(4)} ${a.padEnd(26)} ${m}`);
}
if (boslar.length) {
  console.log("\n--- ○ BOŞ (müşteri 'özellik yok' der) ---");
  for (const [a] of boslar) console.log(`  ${a}`);
}
console.log("\n--- ✓ DOLU ---");
for (const [a, n] of dolular) console.log(`  ${a.padEnd(26)} ${n}`);
process.exit(hatalar.length > 0 ? 1 : 0);
