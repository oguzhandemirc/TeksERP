// Onaylı gelen belge iptali (K15): diyalog her topu + bağlı iş emrini listeler, engeller kırmızı kutuda; işlem görmemiş
// iş emri işaretlenmeden ve sebep (≥3) yazılmadan onay düğmesi kapalı; onay seçilen iş emirleriyle + token'la gider;
// düğme yalnız APPROVED/PARTIAL + `gelen-belge:cancel` izninde görünür.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CancelNoteDialog } from "../CancelNoteDialog";
import { CancelNoteAction } from "../CancelNoteAction";
import type { NoteCancelPreview } from "../cancelTypes";

const perms = { cancel: true };
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ permission, children }: { permission: string; children: ReactNode }) => (permission !== "gelen-belge:cancel" || perms.cancel ? <>{children}</> : null),
}));
const getNoteCancelPreview = vi.fn();
const cancelNote = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  getNoteCancelPreview: (...a: unknown[]) => getNoteCancelPreview(...a),
  cancelNote: (...a: unknown[]) => cancelNote(...a),
}));

const NOTE = { id: "n1", noteNo: "GB-0009" };
const preview = (o: Partial<NoteCancelPreview> = {}): NoteCancelPreview => ({
  note: { id: "n1", noteNo: "GB-0009", status: "APPROVED", senderDocNo: "A-1", ownerName: "Gül Örme" },
  cancellable: true,
  rolls: [
    { rollId: "r1", barcode: "T0001", lineNo: 1, senderRollNo: "A-1-1", meters: "40", status: "IN_PRODUCTION", location: "Kurşun · IE01", outcome: "CANCEL", blockers: [] },
    { rollId: "r2", barcode: "T0002", lineNo: 2, senderRollNo: "A-1-2", meters: "41", status: "STOCK", location: "Merkez Depo", outcome: "CANCEL", blockers: [] },
  ],
  workOrders: [{ id: "w1", workOrderNumber: "IE01", status: "IN_PROGRESS", selectable: true, noteRollCount: 1, otherRollCount: 0, effect: "Birlikte iptal edilir." }],
  blockers: [],
  summary: { rollCount: 2, cancelRollCount: 2, cancelMeters: "81.000", workOrderCount: 1 },
  ...o,
});

beforeEach(() => {
  perms.cancel = true;
  getNoteCancelPreview.mockReset();
  cancelNote.mockReset();
});

describe("onaylı gelen belge iptali", () => {
  it("§1 diyalog her topu ve iş emrini listeler; özet sayıları sunucudan", async () => {
    getNoteCancelPreview.mockResolvedValue(preview());
    renderWithProviders(<CancelNoteDialog note={NOTE} open onOpenChange={() => {}} />);
    const rows = await screen.findAllByTestId("cancel-roll-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("T0001")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Merkez Depo")).toBeInTheDocument();
    expect(screen.getByTestId("cancel-summary")).toHaveTextContent("(81 m)"); // ham "81.000" binlik gibi okunuyordu
    expect(screen.getByTestId("cancel-summary")).not.toHaveTextContent("81.000");
    expect(within(screen.getByTestId("cancel-work-orders")).getByText("IE01")).toBeInTheDocument();
  });

  it("§2 engel kırmızı kutuda; düğme kapalı, işlem görmüş iş emri seçilemez", async () => {
    getNoteCancelPreview.mockResolvedValue(preview({
      cancellable: false,
      workOrders: [{ id: "w1", workOrderNumber: "IE01", status: "IN_PROGRESS", selectable: false, noteRollCount: 1, otherRollCount: 0, effect: "İş emrinde işlem başlamış" }],
      blockers: [{ code: "ROLL_STATUS", message: "T0002: top ham stokta değil (SHIPPED) — önce o işlemi geri alın.", rollId: "r2" }],
    }));
    renderWithProviders(<CancelNoteDialog note={NOTE} open onOpenChange={() => {}} />);
    expect(await screen.findByTestId("cancel-blockers")).toHaveTextContent("ham stokta değil");
    expect(screen.getByRole("checkbox", { name: /IE01/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("İptal sebebi"), "Yanlış belge");
    expect(screen.getByTestId("cancel-note-confirm")).toBeDisabled();
  });

  it("§3 sebep zorunlu + iş emri işaretlenmeli; onay seçimle ve token'la gider", async () => {
    getNoteCancelPreview.mockResolvedValue(preview());
    cancelNote.mockResolvedValue({ note: { id: "n1", noteNo: "GB-0009", status: "CANCELLED", cancelledAt: null, cancelReason: "Yanlış belge" }, cancelledRollCount: 2, cancelledWorkOrders: [{ id: "w1", workOrderNumber: "IE01" }] });
    const onOpenChange = vi.fn();
    renderWithProviders(<CancelNoteDialog note={NOTE} open onOpenChange={onOpenChange} />);
    await screen.findAllByTestId("cancel-roll-row");
    const confirm = screen.getByTestId("cancel-note-confirm");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("İptal sebebi"), "ab");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("İptal sebebi"), "c");
    expect(confirm).toBeDisabled(); // iş emri işaretsiz
    expect(screen.getByText("İşaretlemezseniz belge iptal edilemez.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /IE01/ }));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(cancelNote).toHaveBeenCalledTimes(1));
    const [id, body] = cancelNote.mock.calls[0] as [string, { clientToken: string; reason: string; workOrderIds: string[] }];
    expect(id).toBe("n1");
    expect(body.reason).toBe("abc");
    expect(body.workOrderIds).toEqual(["w1"]);
    expect(body.clientToken).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("§3b 409 sonrası tazelenen önizlemede seçilemez olan iş emri seçimden düşer", async () => {
    getNoteCancelPreview.mockResolvedValueOnce(preview());
    getNoteCancelPreview.mockResolvedValue(preview({
      cancellable: false,
      workOrders: [{ id: "w1", workOrderNumber: "IE01", status: "IN_PROGRESS", selectable: false, noteRollCount: 1, otherRollCount: 0, effect: "İş emrinde işlem başlamış" }],
    }));
    cancelNote.mockRejectedValue(Object.assign(new Error("çakışma"), { response: { status: 409, data: { error: { details: { code: "CONFLICT" } } } } }));
    renderWithProviders(<CancelNoteDialog note={NOTE} open onOpenChange={() => {}} />);
    await screen.findAllByTestId("cancel-roll-row");
    await userEvent.type(screen.getByLabelText("İptal sebebi"), "Yanlış belge");
    await userEvent.click(screen.getByRole("checkbox", { name: /IE01/ }));
    expect(screen.getByRole("checkbox", { name: /IE01/ })).toBeChecked();
    await userEvent.click(screen.getByTestId("cancel-note-confirm"));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /IE01/ })).toBeDisabled());
    expect(screen.getByRole("checkbox", { name: /IE01/ })).not.toBeChecked();
  });

  it("§4 düğme yalnız APPROVED/PARTIAL ve izinle", () => {
    const { unmount } = renderWithProviders(<CancelNoteAction note={{ ...NOTE, status: "APPROVED" }} />);
    expect(screen.getByTestId("note-cancel")).toBeInTheDocument();
    unmount();
    const r2 = renderWithProviders(<CancelNoteAction note={{ ...NOTE, status: "DRAFT" }} />);
    expect(screen.queryByTestId("note-cancel")).toBeNull();
    r2.unmount();
    perms.cancel = false;
    renderWithProviders(<CancelNoteAction note={{ ...NOTE, status: "PARTIAL" }} />);
    expect(screen.queryByTestId("note-cancel")).toBeNull();
  });
});
