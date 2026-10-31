// D4-F1c — Yeniden Etiketle: belirsiz müşteri kodu → aday modalı → seçilen topun iç barkoduyla bağlam.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SHARED_CODE, ambiguousThen } from "@/test/helpers/musteri-kodu-aday-fikstur";

vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
const getContext = vi.fn();
vi.mock("./service", () => ({ relabelService: { getContext: (c: string) => getContext(c) } }));
vi.mock("./RelabelSpecForm", () => ({ RelabelSpecForm: () => null }));
vi.mock("@/components/labels/PrintForCustomerCard", () => ({ RelabelPrintForCustomer: () => null }));
vi.mock("./RollContextHeader", () => ({
  EmptyState: () => <p>BOŞ</p>,
  LastLabelBanner: () => null,
  RollContextHeader: ({ ctx }: { ctx: { barcode: string } }) => <p>BAĞLAM:{ctx.barcode}</p>,
}));
import { RelabelStationPage } from "./RelabelStationPage";

function scan(code: string) {
  const input = screen.getByPlaceholderText("Top barkodu okut/yaz → getir");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

beforeEach(() => {
  getContext.mockReset();
  getContext.mockImplementation(ambiguousThen((c) => ({ success: true, data: { id: c, barcode: c, lastLabelSnapshot: null } })));
});

describe("Yeniden Etiketle — belirsiz müşteri kodu", () => {
  it("409 → modal → seçim → iç barkodla aynı bağlam", async () => {
    renderWithProviders(<RelabelStationPage />);
    scan(SHARED_CODE);
    fireEvent.click(await screen.findByTestId("customer-code-candidate-r-b"));
    expect(await screen.findByText("BAĞLAM:T-IC-B")).toBeTruthy();
    expect(getContext.mock.calls.map((c) => c[0])).toEqual([SHARED_CODE, "T-IC-B"]);
  });

  it("Vazgeç → bağlam açılmaz, ikinci istek yok", async () => {
    renderWithProviders(<RelabelStationPage />);
    scan(SHARED_CODE);
    fireEvent.click(await screen.findByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("BOŞ")).toBeTruthy();
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("tekil kod → modal açılmaz", async () => {
    renderWithProviders(<RelabelStationPage />);
    scan("T-IC-A");
    expect(await screen.findByText("BAĞLAM:T-IC-A")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
