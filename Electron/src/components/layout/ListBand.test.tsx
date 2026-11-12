import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render } from "@testing-library/react";
import { BandStats, ListBand, ListFooter } from "./ListPage";

describe("BandStats — liste özetinin tek görünümü", () => {
  it("ham sayıyı binlik ayracısız basar, ton ve birim taşır", () => {
    const { container } = render(
      <ListBand>
        <BandStats
          label="Özet"
          scope="Depo"
          items={[
            { key: "a", label: "Top", value: 4295 },
            { key: "b", label: "Metre", value: "10500,5", unit: "m" },
            { key: "c", label: "Geciken", value: 3, tone: "danger", title: "ipucu" },
          ]}
        />
      </ListBand>,
    );
    const band = container.querySelector("[data-list-band]")!;
    expect(band.querySelector("[data-band-stats]")!.getAttribute("aria-label")).toBe("Özet");
    expect(band.textContent).toContain("Depo");
    expect(band.textContent).toContain("Top4295");
    expect(band.textContent).toContain("Metre10500,5m");
    const late = [...band.querySelectorAll("[title='ipucu'] span")].find((s) => s.textContent === "3")!;
    expect(late.className).toContain("text-destructive");
  });

  it("dikey dolgu yoğunluk belirtecinden; sıkı görünüm eskisi (py-1.5) kadar, ferah daha geniş", () => {
    const { container } = render(<ListBand>x</ListBand>);
    expect(container.querySelector("[data-list-band]")!.className).toContain("py-[var(--space-band)]");
    const css = readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");
    const band = (sel: string) => new RegExp(`${sel}[^}]*--space-band:\\s*([0-9.]+)rem`).exec(css)?.[1];
    expect(band('\\[data-density="compact"\\]')).toBe("0.375");
    expect(Number(band('\\[data-density="comfortable"\\]'))).toBeGreaterThan(0.375);
  });

  it("altlık sayıları da aynı biçimde", () => {
    const { container } = render(<ListFooter loaded={1250} total={3400} />);
    expect(container.textContent).toContain("Yüklü 1250 / 3400 kayıt");
  });
});

// Özet şeridi bantta durur, kendi kutusunu çizmez (2026-11-12 cila turu). Sayfa ↔ şerit dosyası çiftleri.
const SRC = path.resolve(__dirname, "../..");
const BANDED: Array<[page: string, strip: string]> = [
  ["pages/Operations/Orders/OrdersPage.tsx", "pages/Operations/Orders/OrdersStats.tsx"],
  ["pages/Cost/Quotes/QuotesPage.tsx", "pages/Cost/Quotes/QuoteSummaryStrip.tsx"],
  ["pages/Operations/Shipments/eirsaliye/EIrsaliyeSummaryStrip.tsx", "pages/Operations/Shipments/eirsaliye/EIrsaliyeSummaryStrip.tsx"],
  ["pages/Operations/Rolls/RollsPage.tsx", "pages/Operations/Rolls/RollsStats.tsx"],
  ["pages/Operations/FasonCockpit/FasonCockpitPage.tsx", "pages/Operations/FasonCockpit/CockpitSummary.tsx"],
  ["pages/Operations/ConsignmentDispatches/ConsignmentDispatchesPage.tsx", "pages/Operations/ConsignmentDispatches/ConsignmentDispatchFilters.tsx"],
  ["pages/Operations/LoomAlarms/LoomAlarmsPage.tsx", "pages/Operations/LoomAlarms/LoomAlarmsTable.tsx"],
  ["pages/Operations/KursunMeterDeviations/MeterDeviationsPage.tsx", "pages/Operations/KursunMeterDeviations/SummaryStrip.tsx"],
  ["pages/Operations/ReadyWorks/ReadyWorksPage.tsx", "pages/Operations/ReadyWorks/ReadyWorksTable.tsx"],
  ["pages/Operations/ConsignedWork/ConsignedWorkPage.tsx", "pages/Operations/ConsignedWork/ConsignedWorkTable.tsx"],
  ["pages/Quality/Inspections/InspectionList.tsx", "pages/Quality/Inspections/InspectionList.tsx"],
  ["pages/Quality/LabTests/LabTestList.tsx", "pages/Quality/LabTests/LabTestList.tsx"],
  ["pages/Quality/Certificates/CertificateList.tsx", "pages/Quality/Certificates/CertificateList.tsx"],
  ["pages/System/PrintHistory/PrintHistoryPage.tsx", "pages/System/PrintHistory/PrintHistoryPage.tsx"],
];

describe("liste özet şeritleri ListBand içinde", () => {
  it.each(BANDED)("%s bandı kullanır", (page, strip) => {
    expect(readFileSync(path.join(SRC, page), "utf8")).toMatch(/<ListBand\b/);
    // Şerit gruplamasız sayı biçimi kurmaz (ortak biçimleyici).
    expect(readFileSync(path.join(SRC, strip), "utf8")).not.toMatch(/useGrouping:\s*false/);
  });
});
