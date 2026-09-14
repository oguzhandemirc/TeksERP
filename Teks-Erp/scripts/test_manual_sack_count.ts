// =============================================================================
// Test: Sevkiyatta "araca yüklenen gerçek çuval adedi" (operatör beyanı)
// Çalıştır: npx tsx scripts/test_manual_sack_count.ts
//
// NEDEN VAR: sahada 10 çuval gönderilse bile hepsi TEK bir çuval kaydının içine
// yazılıyor. Sistemin saydığı `sacks.length` o yüzden fiziksel gerçeği vermiyor;
// irsaliyede "1 çuval" yazan bir araç 10 çuvalla yola çıkıyor.
//
// EN KRİTİK KONTROL — §1: beyan YOKKEN çıktı, özellikten ÖNCEKİ haliyle
// BİT-BİT AYNI olmalı. Özellik bir bayrağın arkasında ve varsayılan KAPALI;
// bugüne kadar basılmış her irsaliyenin aynı kalması bu testin işi. Tek bayt
// fark, "kapalı özellik sessizce belgeye sızdı" demektir.
//
// SAF renderer testi (DB yok) — `renderShipmentDispatchHtml` pure function.
// =============================================================================

import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/**
 * @param manual beyan; `undefined` = alan snapshot'ta HİÇ YOK (eski belgeler).
 * @param cfg belge yapılandırması (dil vb.). ⚠️ Dil `cfg.language`den gelir —
 *   `destination: "EXPORT"` TEK BAŞINA İngilizce yapmaz, `language: "auto"`
 *   ya da `"en"` gerekir.
 */
function snap(manual?: number | null, cfg: Record<string, unknown> | null = null): PrintedDocSnapshot {
  const totals: Record<string, unknown> = {
    totalRolls: 2, totalMeters: 200, totalKg: 70, sackCount: 2,
  };
  if (manual !== undefined) totals.manualSackCount = manual;
  return {
    schemaVersion: 1,
    frozenAt: new Date("2026-08-29T08:00:00Z").toISOString(),
    company: { name: "TEST TEKSTİL", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: cfg as never,
    doc: {
      header: {
        shipmentNo: "SVK2908260001", customerName: "TEST MÜŞTERİ", customerCode: "M1",
        customerTaxNumber: null, branchName: null, branchCode: null, procedureCode: null,
        destination: "DOMESTIC", status: "DISPATCHED", date: "2026-08-29T08:00:00Z",
        plateNumber: null, driverName: null, carrier: null, orderNos: "",
      },
      products: [{ name: "PAMUK 141cm.", rollCount: 2, totalMeters: 200 }],
      sacks: [
        { code: "CV2908260001", seq: 1, totalMeters: 120, totalKg: 40, packageCount: 1 },
        { code: "CV2908260002", seq: 2, totalMeters: 80, totalKg: 30, packageCount: 1 },
      ],
      cekiRows: [
        { sackCode: "CV2908260001", barcode: "T290826F0001", desen: "PAMUK", varyant: "", width: 141, meters: 120, kg: 40 },
        { sackCode: "CV2908260002", barcode: "T290826F0002", desen: "PAMUK", varyant: "", width: 141, meters: 80, kg: 0 },
      ],
      totals,
    } as unknown as Record<string, unknown>,
  };
}

function main(): void {
  console.log("\n§1 — Beyan YOKKEN çıktı değişmemeli (en kritik)");
  const yok = renderShipmentDispatchHtml(snap(null), {});
  const hicYok = renderShipmentDispatchHtml(snap(undefined), {}); // eski belgeler
  check("beyan null → 'Çuval Adedi' satırı BASILMAZ", !yok.includes("Çuval Adedi"));
  check("alan hiç yok (eski snapshot) → satır BASILMAZ", !hicYok.includes("Çuval Adedi"));
  check("null ile alansız çıktı BİT-BİT AYNI", yok === hicYok);

  console.log("\n§2 — Beyan varsa İKİ rakam birlikte");
  const var10 = renderShipmentDispatchHtml(snap(10), {});
  check("'Çuval Adedi' satırı basılıyor", var10.includes("Çuval Adedi"));
  check("fiziksel adet (10) görünüyor", var10.includes("<b>10</b>"));
  // Biri diğerinin yerine GEÇMEZ: fark meşrudur ve fark bilginin kendisidir.
  check("sistemin saydığı (2) da görünüyor", var10.includes("(2 sistemde)"));

  console.log("\n§3 — Beyan sistemle AYNI olsa bile basılır");
  // "Aynıysa gizle" cazip ama yanlış: operatörün SAYDIĞI ile sistemin saydığının
  // örtüşmesi bir bilgidir (doğrulanmış sevkiyat), gizlenirse "beyan edilmedi"
  // ile "beyan edildi ve tuttu" ayırt edilemez.
  const ayni = renderShipmentDispatchHtml(snap(2), {});
  check("beyan == sistem → yine basılır", ayni.includes("Çuval Adedi") && ayni.includes("(2 sistemde)"));

  console.log("\n§4 — İhracatta İngilizce");
  // ⚠️ Dil `cfg.language`den gelir; `destination: "EXPORT"` tek başına yetmez —
  // "auto" ile birleşince EN olur. (İlk yazımda bu atlanmıştı ve test kendi
  // varsayımı yüzünden kırmızı verdi, kod doğruydu.)
  const enSnap = snap(10, { language: "auto" });
  (enSnap.doc as { header: Record<string, unknown> }).header.destination = "EXPORT";
  const en = renderShipmentDispatchHtml(enSnap, {});
  check("EN başlık 'Package Count'", en.includes("Package Count"), en.includes("Çuval Adedi") ? "TR sızdı" : "");
  check("EN alt metin 'in system'", en.includes("(2 in system)"));

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
