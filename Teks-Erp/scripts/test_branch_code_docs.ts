// =============================================================================
// Test: Belgede müşteri ŞUBE KODU (ihracat) — render + "branchCode" toggle
// Çalıştır: npx tsx scripts/test_branch_code_docs.ts   (DB gerekmez — saf render)
// Doğrulananlar (SHIPMENT_DISPATCH + SUBCONTRACTOR_DIRECT_SHIP örnek belgeleri):
//   1. Toggle AÇIK/verilmemiş (varsayılan) → "Şube Kodu: <kod>" belgede görünür.
//   2. Toggle KAPALI (sections.branchCode=false) → kod GİZLENİR; şube ADI hâlâ görünür.
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

// Örnek belgelerde şube kodu = "IST-01" (sample-data.ts).
const CODE = "IST-01";

// ---- SHIPMENT_DISPATCH (sevk irsaliyesi + muhasebe fişi) ----
const shipDoc = SAMPLE_PRINTED_DOCS.SHIPMENT_DISPATCH;
const shipOn = renderShipmentDispatchHtml(snap(shipDoc), {});
const shipOff = renderShipmentDispatchHtml(snap(shipDoc, { branchCode: false }), {});
check("sevk irsaliyesi: toggle AÇIK → 'Şube Kodu' + kod görünür", shipOn.includes("Şube Kodu") && shipOn.includes(CODE));
check("sevk irsaliyesi: toggle KAPALI → kod gizli", !shipOff.includes(CODE) && !shipOff.includes("Şube Kodu"));
check("sevk irsaliyesi: KAPALI'da şube ADI hâlâ var", shipOff.includes("Merkez Şube"));

// ---- SUBCONTRACTOR_DIRECT_SHIP (fasondan sevk irsaliyesi + muhasebe direkt fişi) ----
const dsDoc = SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DIRECT_SHIP;
const dsOn = renderFasonDirectShipHtml(snap(dsDoc), {});
const dsOff = renderFasonDirectShipHtml(snap(dsDoc, { branchCode: false }), {});
check("fasondan sevk irsaliyesi: toggle AÇIK → 'Şube Kodu' + kod görünür", dsOn.includes("Şube Kodu") && dsOn.includes(CODE));
check("fasondan sevk irsaliyesi: toggle KAPALI → kod gizli", !dsOff.includes("Şube Kodu") && !dsOff.includes(CODE));
check("fasondan sevk irsaliyesi: KAPALI'da şube ADI hâlâ var", dsOff.includes("Merkez Şube"));

console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
