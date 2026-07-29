// =============================================================================
// Test: Belgede müşteri İHRACAT KODU (tek satır) — render + "exportCode" toggle
// Çalıştır: npx tsx scripts/test_branch_code_docs.ts   (DB gerekmez — saf render)
// Kullanıcı kararı: sevk belgelerinde İhracat Kodu TEK değerdir →
//   şube kodu (CustomerBranch.code) doluysa ONU, yoksa müşteri ihracat kodunu
//   (Customer.exportCode) bas. Ayrı "Şube Kodu" satırı ARTIK YOK.
// Doğrulananlar (SHIPMENT_DISPATCH + SUBCONTRACTOR_DIRECT_SHIP örnek belgeleri):
//   1. Şube kodu dolu → "İhracat Kodu: <şube kodu>" görünür; ayrı "Şube Kodu:" satırı YOK.
//   2. Şube kodu boş → "İhracat Kodu: <müşteri ihracat kodu>" görünür.
//   3. Toggle KAPALI (sections.exportCode=false) → satır tamamen gizli.
//   4. Şube ADI (branchName) her durumda hâlâ görünür (ayrı, dokunulmadı).
// =============================================================================
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { renderFasonDirectShipHtml } from "../src/services/document-render/fason-direct-ship.html";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Örnek doc'u istenen section config'iyle bir snapshot zarfına sar. */
function snap(doc: Record<string, unknown>, sections?: Record<string, boolean>): PrintedDocSnapshot {
  return {
    schemaVersion: 1,
    frozenAt: "2026-07-16T00:00:00.000Z",
    company: { name: "TEST FİRMA", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: sections ? { sections } : null,
    doc,
  };
}

// Örnek belgelerde şube kodu = "IST-01", müşteri ihracat kodu = "EXP-TR-042".
const BRANCH_CODE = "IST-01";
const EXPORT_CODE = "EXP-TR-042";
const LABEL = "İhracat Kodu";

// ---- SHIPMENT_DISPATCH (sevk irsaliyesi + muhasebe fişi) ----
const shipDoc = SAMPLE_PRINTED_DOCS.SHIPMENT_DISPATCH;
// Şube kodu boş varyantı → müşteri ihracat koduna düşmeli.
const shipNoBranch = { ...shipDoc, header: { ...(shipDoc.header as Record<string, unknown>), branchCode: null } };

const shipOn = renderShipmentDispatchHtml(snap(shipDoc), {});
const shipNoBr = renderShipmentDispatchHtml(snap(shipNoBranch), {});
const shipOff = renderShipmentDispatchHtml(snap(shipDoc, { exportCode: false }), {});

check(
  "sevk irsaliyesi: şube kodu dolu → 'İhracat Kodu: <şube kodu>' görünür",
  shipOn.includes(LABEL) && shipOn.includes(BRANCH_CODE),
);
check(
  "sevk irsaliyesi: ayrı 'Şube Kodu:' satırı YOK + müşteri export gizli (şube ezer)",
  !shipOn.includes("Şube Kodu") && !shipOn.includes(EXPORT_CODE),
);
check(
  "sevk irsaliyesi: şube kodu boş → 'İhracat Kodu: <müşteri export>' görünür",
  shipNoBr.includes(LABEL) && shipNoBr.includes(EXPORT_CODE) && !shipNoBr.includes(BRANCH_CODE),
);
check(
  "sevk irsaliyesi: toggle KAPALI (exportCode=false) → satır tamamen gizli",
  !shipOff.includes(LABEL) && !shipOff.includes(BRANCH_CODE) && !shipOff.includes(EXPORT_CODE),
);
check("sevk irsaliyesi: KAPALI'da şube ADI hâlâ var", shipOff.includes("Merkez Şube"));

// ---- SUBCONTRACTOR_DIRECT_SHIP (fasondan sevk irsaliyesi + muhasebe direkt fişi) ----
const dsDoc = SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DIRECT_SHIP;
const dsNoBranch = { ...dsDoc, customer: { ...(dsDoc.customer as Record<string, unknown>), branchCode: null } };

const dsOn = renderFasonDirectShipHtml(snap(dsDoc), {});
const dsNoBr = renderFasonDirectShipHtml(snap(dsNoBranch), {});
const dsOff = renderFasonDirectShipHtml(snap(dsDoc, { exportCode: false }), {});

check(
  "fasondan sevk irsaliyesi: şube kodu dolu → 'İhracat Kodu: <şube kodu>' görünür",
  dsOn.includes(LABEL) && dsOn.includes(BRANCH_CODE),
);
check(
  "fasondan sevk irsaliyesi: ayrı 'Şube Kodu:' satırı YOK + müşteri export gizli (şube ezer)",
  !dsOn.includes("Şube Kodu") && !dsOn.includes(EXPORT_CODE),
);
check(
  "fasondan sevk irsaliyesi: şube kodu boş → 'İhracat Kodu: <müşteri export>' görünür",
  dsNoBr.includes(LABEL) && dsNoBr.includes(EXPORT_CODE) && !dsNoBr.includes(BRANCH_CODE),
);
check(
  "fasondan sevk irsaliyesi: toggle KAPALI (exportCode=false) → satır tamamen gizli",
  !dsOff.includes(LABEL) && !dsOff.includes(BRANCH_CODE) && !dsOff.includes(EXPORT_CODE),
);
check("fasondan sevk irsaliyesi: KAPALI'da şube ADI hâlâ var", dsOff.includes("Merkez Şube"));

// ---- YENİ ALAN TOGGLE'LARI (Yön / Vergi No / Müşteri Kodu) — hepsi varsayılan AÇIK ----
const shipDirOff = renderShipmentDispatchHtml(snap(shipDoc, { direction: false }), {});
const shipTaxOff = renderShipmentDispatchHtml(snap(shipDoc, { taxNo: false }), {});
const shipCodeOff = renderShipmentDispatchHtml(snap(shipDoc, { customerCode: false }), {});
check("sevk irsaliyesi: 'Yön' varsayılan AÇIK görünür", shipOn.includes("Yön"));
check("sevk irsaliyesi: sections.direction=false → 'Yön' gizli", !shipDirOff.includes("Yön"));
check("sevk irsaliyesi: sections.taxNo=false → 'V.No' gizli (varsayılan görünür)", shipOn.includes("V.No") && !shipTaxOff.includes("V.No"));
check("sevk irsaliyesi: sections.customerCode=false → 'Kod:' gizli", shipOn.includes("Kod:") && !shipCodeOff.includes("Kod:"));

const shipDocNoOff = renderShipmentDispatchHtml(snap(shipDoc, { docNo: false }), {});
const shipDateOff = renderShipmentDispatchHtml(snap(shipDoc, { date: false }), {});
check("sevk irsaliyesi: sections.docNo=false → 'İrsaliye No' gizli", shipOn.includes("İrsaliye No") && !shipDocNoOff.includes("İrsaliye No"));
check("sevk irsaliyesi: sections.date=false → 'Tarih' gizli", shipOn.includes("Tarih") && !shipDateOff.includes("Tarih"));

console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
