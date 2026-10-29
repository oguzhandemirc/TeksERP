// Gelen belge ekranları: liste (süzgeç sunucuya), toplam şeridi (blok başına), eşleme önerisi, onay sonucu,
// rejim (modül kapalı → karo ve palet girişi gizli).
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { IncomingDocumentsPage } from "../GelenBelgelerPage";
import { TotalsStrip } from "../TotalsStrip";
import { SuggestionChips } from "../SuggestionChips";
import { ApproveDialog } from "../ApproveDialog";
import type { DeliveryNoteHeader, DeliveryNoteLine } from "../types";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions, titleExtra }: { title: string; actions?: ReactNode; titleExtra?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {titleExtra}
      {actions}
    </div>
  ),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/CustomerPickerField", () => ({
  CustomerPickerField: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
}));

const listDeliveryNotes = vi.fn();
const approveNote = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  listDeliveryNotes: (...a: unknown[]) => listDeliveryNotes(...a),
  approveNote: (...a: unknown[]) => approveNote(...a),
  createManualNote: vi.fn(),
  getReaderStatus: vi.fn(() => new Promise(() => {})),
}));

const header = (o: Partial<DeliveryNoteHeader>): DeliveryNoteHeader => ({
  id: "n1", noteNo: "GB-0001", status: "DRAFT", sourceKind: "OCR", ownerCustomerId: null, senderCustomerId: null,
  senderText: "Akın Tekstil", senderDocNo: "A-77", senderDocDate: null, customerBatchNo: null, processText: null,
  templateId: null, templateScore: null, pageCount: 1, declaredTopCount: null, totalsDeclared: null, varianceReason: null,
  warnings: null, approvedAt: null, cancelledAt: null, createdAt: "2026-10-29T08:00:00Z", updatedAt: "2026-10-29T08:00:00Z",
  ownerCustomer: { id: "c1", code: "C1", name: "Gül Örme" }, senderCustomer: null, _count: { lines: 3, scans: 1 }, ...o,
});
const summary = { DRAFT: 1, APPROVING: 0, APPROVED: 0, PARTIAL: 0, CANCELLED: 0, total: 1 };

beforeEach(() => {
  listDeliveryNotes.mockResolvedValue({ items: [header({})], nextCursor: null, summary });
});

describe("liste", () => {
  it("satırları çizer; durum süzgeci SUNUCUYA gider", async () => {
    renderWithProviders(<IncomingDocumentsPage />);
    expect(await screen.findByText("GB-0001")).toBeInTheDocument();
    expect(listDeliveryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, status: undefined }));
    const group = screen.getByRole("group", { name: "Durum süzgeci" });
    expect(within(group).getByText(/Tümü \(1\)/)).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: /Onaylandı/ }));
    await waitFor(() => expect(listDeliveryNotes).toHaveBeenLastCalledWith(expect.objectContaining({ status: "APPROVED" })));
  });
  it("liste hatası 'belge yok' gibi gösterilmez", async () => {
    listDeliveryNotes.mockRejectedValue(new Error("ağ"));
    renderWithProviders(<IncomingDocumentsPage />);
    expect(await screen.findByText("Liste yüklenemedi.", {}, { timeout: 4000 })).toBeInTheDocument();
  });
});

const ln = (o: Partial<DeliveryNoteLine>) => ({ blockNo: 1, meters: "100", weightKg: null, status: "PENDING", ...o }) as DeliveryNoteLine;

describe("toplam şeridi", () => {
  it("blok başına beyan: tutan yeşil, tutmayan kırmızı + sebep, beyansız doğrulanamaz", () => {
    renderWithProviders(
      <TotalsStrip
        note={{
          lines: [ln({ blockNo: 1 }), ln({ blockNo: 1 }), ln({ blockNo: 2, meters: "50" }), ln({ blockNo: 3 })],
          totalsDeclared: { blocks: [{ blockNo: 1, count: "2", m: "200", kg: null }, { blockNo: 2, count: null, m: "60", kg: null }] },
          declaredTopCount: 5,
        }}
      />,
    );
    expect(screen.getByTestId("block-1").dataset.ok).toBe("true");
    expect(screen.getByTestId("block-2").dataset.ok).toBe("false");
    expect(within(screen.getByTestId("block-2")).getByText("beyan 60 m, satır 50 m")).toBeInTheDocument();
    expect(screen.getByTestId("block-3").dataset.ok).toBe("unknown");
    expect(screen.getByText("Belgede 5 top yazıyor, satır 4 (uyarı)")).toBeInTheDocument();
  });
});

describe("eşleme önerisi", () => {
  it("öğrenilmiş öneri önce; mevcut seçim tekrar önerilmez; tık seçimi uygular", async () => {
    const onPick = vi.fn();
    renderWithProviders(
      <SuggestionChips
        currentId="x"
        onPick={onPick}
        suggestion={{
          rawText: "LACİVERT",
          source: "ALIAS",
          suggested: { id: "c1", code: null, name: "Lacivert", score: 1 },
          list: [{ id: "x", code: null, name: "Seçili", score: 0.95 }, { id: "c2", code: null, name: "Laci", score: 0.84 }],
        }}
      />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Lacivert (öğrenilmiş)", "Laci %84"]);
    await userEvent.click(buttons[1]!);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "c2" }));
  });
});

const conflict = (code: string) =>
  new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { message: "Toplam tutmuyor", details: { code } } } as AxiosResponse);

describe("onay", () => {
  it("TOTAL_MISMATCH → gerekçe ister; gerekçeyle ikinci deneme → PARTIAL sonucu FAILED satırlarla", async () => {
    approveNote.mockRejectedValueOnce(conflict("TOTAL_MISMATCH")).mockResolvedValueOnce({
      warnings: [],
      result: {
        note: { status: "PARTIAL", lines: [{ status: "FAILED", lineNo: 4, blockNo: 2, failReason: "Ürün çözülemedi" }] },
        summary: { entered: 5, failed: 1, skipped: 0, replayed: 0, rollIds: [] },
      },
    });
    const onDone = vi.fn();
    renderWithProviders(<ApproveDialog noteId="n1" open onOpenChange={() => {}} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    const reason = await screen.findByLabelText("Fark gerekçesi");
    expect(approveNote).toHaveBeenLastCalledWith("n1", null);
    await userEvent.type(reason, "Belgede toplam yanlış");
    await userEvent.click(screen.getByRole("button", { name: "Gerekçeyle onayla" }));
    const res = await screen.findByTestId("approve-result");
    expect(approveNote).toHaveBeenLastCalledWith("n1", "Belgede toplam yanlış");
    expect(res.dataset.status).toBe("PARTIAL");
    expect(within(res).getByText("Blok 2, satır 4: Ürün çözülemedi")).toBeInTheDocument();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  it("gerekçe istemeyen 409 (claim çakışması) gerekçe alanı açmaz", async () => {
    approveNote.mockRejectedValueOnce(conflict("CONFLICT"));
    renderWithProviders(<ApproveDialog noteId="n1" open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    expect(await screen.findByTestId("approve-error")).toBeInTheDocument();
    expect(screen.queryByLabelText("Fark gerekçesi")).toBeNull();
  });
});

describe("rejim — modül kapalı → karo ve palet girişi gizli", () => {
  const tile = operationsTiles.find((t) => t.to === "/operations/gelen-belgeler");
  const entry = allCommandEntries.find((e) => e.to === "/operations/gelen-belgeler");
  it("karo ve palet girişi var, ikisi de modül yüklemine bağlı", () => {
    expect(tile?.offHint).toBeUndefined();
    expect(entry?.visibleWhen).toBeTypeOf("function");
    expect(ROUTE_MODULE["operations/gelen-belgeler"]).toBe("gelenBelgeEnabled");
  });
  it("kapalı → ikisi de görünmez; açık → görünür", () => {
    const ctx = (on: boolean) => ({ gelenBelgeEnabled: on }) as Parameters<NonNullable<typeof entry>["visibleWhen"] & object>[0];
    expect(tile!.visibleWhen!(ctx(false))).toBe(false);
    expect(entry!.visibleWhen!(ctx(false))).toBe(false);
    expect(tile!.visibleWhen!(ctx(true))).toBe(true);
    expect(entry!.visibleWhen!(ctx(true))).toBe(true);
  });
});
