// Determinizm: belge tarihi toLocaleDateString ile basılır; CI makinesinin saat
// dilimi UTC+14 gibi uçlarda gün sınırını kaydırabilir. Snapshot'ın makineden
// bağımsız olması için TZ'yi import'lardan ÖNCE UTC'ye sabitliyoruz (Node
// toLocaleDateString'i çağrı anında process.env.TZ'den okur).
process.env.TZ = "UTC";

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DispatchReceiptDocument } from "./DispatchReceiptDocument";
import type { DispatchReport } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// YAPISAL SNAPSHOT (deterministik "görsel regresyon"). Gerçek piksel ekran
// görüntüsü DEĞİL — render edilen HTML/DOM yapısı dondurulur. Bileşen statik bir
// yazdırma belgesi: sabit props, dinamik değer YOK (tarih TZ=UTC ile sabit) →
// snapshot kararlı. Tasarım/yapı kayarsa (kolon eklenir, sıra değişir) diff verir.
// __snapshots__/ dosyası repoya commit'lenir; bilinçli değişiklikte `-u` ile güncelle.
// ─────────────────────────────────────────────────────────────────────────────

const report: DispatchReport = {
  header: {
    shipmentNo: "SVK-001",
    customerName: "SOFİA HOME",
    customerCode: "MUS-1",
    branchName: null,
    procedureCode: "GB-2026-123",
    destination: "EXPORT",
    status: "DISPATCHED",
    date: "2026-06-10T12:00:00.000Z",
  },
  products: [{ name: "MC 156 BEYAZ-GÜMÜŞ 150cm.", rollCount: 3, totalMeters: 105 }],
  sacks: [{ code: "AMB00001", seq: 1, totalMeters: 70, totalKg: 65.8, packageCount: 2 }],
  cekiRows: [
    { rollId: "r1", sackCode: "AMB00001", barcode: "G26126373", desen: "MC 156", varyant: "BEYAZ-GÜMÜŞ", meters: 35, kg: 65.8 },
    { rollId: "r2", sackCode: "AMB00001", barcode: "G26126379", desen: "MC 156", varyant: "BEYAZ-GÜMÜŞ", meters: 35, kg: 0 },
  ],
  totals: { totalRolls: 3, totalMeters: 105, totalKg: 65.8, sackCount: 1 },
};

describe("DispatchReceiptDocument — yapısal snapshot", () => {
  it("3 bölümlü sevk fişi HTML yapısı sabit kalır", () => {
    const { container } = render(<DispatchReceiptDocument report={report} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
