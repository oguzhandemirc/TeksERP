// D4-F1c — İş Emri Hareketleri (iz sür): belirsiz müşteri kodu → aday modalı → iç barkodla aynı arama.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SHARED_CODE, ambiguousThen } from "@/test/helpers/musteri-kodu-aday-fikstur";

vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
const lookup = vi.fn();
vi.mock("../WorkOrders/events", () => ({ lookupWorkOrdersForEvents: (q: string) => lookup(q) }));
vi.mock("../WorkOrders/WorkOrderEventsPanel", () => ({ WorkOrderEventsPanel: () => <p>HAREKETLER</p> }));
import { WorkOrderEventsPage } from "./WorkOrderEventsPage";

const hit = (n: string) => [{ id: n, workOrderNumber: n, status: "IN_PROGRESS", createdAt: "2026-10-30T10:00:00Z", via: "ROLL" }];

function search(code: string) {
  fireEvent.change(screen.getByLabelText("Terbiye iş emri no ya da top barkodu"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Ara" }));
}

beforeEach(() => {
  lookup.mockReset();
  lookup.mockImplementation(ambiguousThen((c) => hit(`IE-${c}`)));
});

describe("İş Emri Hareketleri — belirsiz müşteri kodu", () => {
  it("409 → modal → seçim → iç barkodla aynı arama", async () => {
    renderWithProviders(<WorkOrderEventsPage />);
    search(SHARED_CODE);
    fireEvent.click(await screen.findByTestId("customer-code-candidate-r-b"));
    expect(await screen.findByText("IE-T-IC-B")).toBeTruthy();
    expect(lookup.mock.calls.map((c) => c[0])).toEqual([SHARED_CODE, "T-IC-B"]);
  });

  it("Vazgeç → arama yok, 'bulunamadı' da denmez", async () => {
    renderWithProviders(<WorkOrderEventsPage />);
    search(SHARED_CODE);
    fireEvent.click(await screen.findByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/bulunamadı/)).toBeNull();
    expect(screen.queryByText("HAREKETLER")).toBeNull();
  });

  it("tekil kod → modal açılmaz", async () => {
    renderWithProviders(<WorkOrderEventsPage />);
    search("T-IC-A");
    expect(await screen.findByText("IE-T-IC-A")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
