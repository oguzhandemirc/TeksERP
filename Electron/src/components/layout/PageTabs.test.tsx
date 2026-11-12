import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Package, Ruler } from "lucide-react";
import { PageTabs } from "./PageTabs";
import { ReorderableTabBar } from "./ReorderableTabBar";

describe("PageTabs — sayfa içi alt sekme bandı", () => {
  it("tablist + seçili sekme, bant işareti, alt çizgili düz sekme", () => {
    const { container } = render(<PageTabs label="Siparişler görünümü" tabs={[{ key: "list", label: "Siparişler" }, { key: "plan", label: "Üretim planı" }]} active="list" onSelect={() => {}} />);
    expect(container.querySelector("[data-page-tabs]")).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Siparişler görünümü" })).toBeTruthy();
    const sel = screen.getByRole("tab", { name: "Siparişler" });
    expect(sel.getAttribute("aria-selected")).toBe("true");
    expect(sel.className).toContain("border-b-2");
    // Kabuk sekmesinin kutucuk görünümü (dolu zemin) taşınmaz.
    expect(sel.className).not.toMatch(/\bbg-primary\b/);
  });

  it("tıklama ve ok tuşu seçimi bildirir (adres çubuğunu çağıran yazar)", async () => {
    const onSelect = vi.fn();
    render(<PageTabs label="g" tabs={[{ key: "a", label: "A" }, { key: "b", label: "B" }]} active="a" onSelect={onSelect} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "B" }));
    expect(onSelect).toHaveBeenCalledWith("b");
    onSelect.mockClear();
    const a = screen.getByRole("tab", { name: "A" });
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    // Radix odağı bir sonraki görevde taşır; otomatik seçim odakla birlikte bildirir.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("B"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

describe("ReorderableTabBar — aynı görünüm ve klavye", () => {
  it("bant işareti, tab rolü ve ok tuşuyla seçim", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ReorderableTabBar tabs={[{ key: "a", label: "Depo", Icon: Package }, { key: "b", label: "Üretimde", Icon: Ruler }]} activeKey="a" onSelect={onSelect} onReorder={() => {}} />,
    );
    expect(container.querySelector("[data-page-tabs][role='tablist']")).toBeTruthy();
    const a = screen.getByRole("tab", { name: /Depo/ });
    expect(a.getAttribute("aria-selected")).toBe("true");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});

// Sayfa düzeyindeki alt sekmeler ortak banda bağlı (2026-11-12 cila turu).
const SRC = path.resolve(__dirname, "../..");
const PAGES = [
  "pages/Operations/Orders/OrdersViewTabs.tsx",
  "pages/Operations/ConsignedWork/ConsignedWorkPage.tsx",
  "pages/Quality/LabTests/LabTestsPage.tsx",
  "pages/Quality/Certificates/CertificatesPage.tsx",
  "pages/Operations/Yarn/YarnStockPage.tsx",
  "pages/Operations/PurchaseOrders/PurchaseOrdersPage.tsx",
  "pages/System/WorkSessions/WorkSessionsPage.tsx",
  "pages/Finance/PeriodClose/PeriodClosePage.tsx",
  "pages/Definitions/DocumentDesigner/DocumentDesignerPage.tsx",
  "pages/Labels/EtiketlerPage.tsx",
];

describe("sayfa içi sekmeler PageTabs kullanır", () => {
  it.each(PAGES)("%s", (f) => {
    const src = readFileSync(path.join(SRC, f), "utf8");
    expect(src).toMatch(/from "@\/components\/layout\/PageTabs"/);
    expect(src).not.toMatch(/<TabsList\b/);
  });
});
