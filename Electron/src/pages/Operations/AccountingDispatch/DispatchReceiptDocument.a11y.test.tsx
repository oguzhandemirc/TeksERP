import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { DispatchReceiptDocument } from "./DispatchReceiptDocument";
import type { DispatchReport } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// A11Y testi — jsdom'da layout YOK; renk-kontrast/odak-görünürlüğü gibi kurallar
// güvenilmez. Bu yüzden jsdom'da anlamlı çalışan SEMANTİK kurallara odaklanıyoruz
// (tablo başlık ilişkisi, ARIA rolleri, isimlendirme) ve 'critical'/'serious'
// ihlal sayısının 0 olduğunu doğruluyoruz. Bu belge yazdırma çıktısı (statik
// tablo), props deterministik → a11y için kararlı bir hedef.
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
    date: "2026-06-10T08:00:00.000Z",
  },
  products: [{ name: "MC 156 BEYAZ-GÜMÜŞ 150cm.", rollCount: 3, totalMeters: 105 }],
  sacks: [{ code: "AMB00001", seq: 1, totalMeters: 70, totalKg: 65.8, packageCount: 2 }],
  cekiRows: [
    { rollId: "r1", sackCode: "AMB00001", barcode: "G26126373", desen: "MC 156", varyant: "BEYAZ-GÜMÜŞ", meters: 35, kg: 65.8 },
    { rollId: "r2", sackCode: "AMB00001", barcode: "G26126379", desen: "MC 156", varyant: "BEYAZ-GÜMÜŞ", meters: 35, kg: 0 },
  ],
  totals: { totalRolls: 3, totalMeters: 105, totalKg: 65.8, sackCount: 1 },
};

// jsdom'da güvenilmez/anlamsız kuralları kapat (layout/renk gerektirenler).
const axeOptions = {
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false }, // yazdırma belgesi landmark gerektirmez
  },
} as const;

describe("DispatchReceiptDocument — a11y (saha #2 sevk fişi)", () => {
  it("kritik/ciddi erişilebilirlik ihlali yok", async () => {
    const { container } = render(<DispatchReceiptDocument report={report} />);
    const results = await axe(container, axeOptions);
    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(blocking).toEqual([]);
  });

  it("axe toHaveNoViolations matcher'ı çalışır (semantik kurallar)", async () => {
    const { container } = render(<DispatchReceiptDocument report={report} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
