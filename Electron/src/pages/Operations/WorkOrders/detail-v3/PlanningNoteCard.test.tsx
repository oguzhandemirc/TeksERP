import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const getNote = vi.fn();
const saveNote = vi.fn();
vi.mock("../planning-service", () => ({
  WORK_ORDER_NOTE_MAX: 2000,
  workOrderPlanningService: {
    getNote: (...a: unknown[]) => getNote(...a),
    setNote: (...a: unknown[]) => saveNote(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
let canWrite = true;
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => p !== "workorder:write" || canWrite, hasAnyPermission: () => true }),
}));

import { PlanningNoteCard } from "./PlanningNoteCard";

const view = (body: string | null) => ({
  success: true,
  data: {
    workOrderId: "wo1",
    body,
    updatedAt: body ? "2026-11-17T10:30:00.000Z" : null,
    updatedBy: body ? { id: "u1", fullName: "Planlamacı Bir" } : null,
  },
});

describe("PlanningNoteCard", () => {
  beforeEach(() => {
    canWrite = true;
    getNote.mockReset();
    saveNote.mockReset();
  });

  it("yazma izni: not yüklenir, sayaç ve son düzenleyen basılır; açılışta YAZIM YOK", async () => {
    getNote.mockResolvedValue(view("Önce X firmasına"));
    renderWithProviders(<PlanningNoteCard workOrderId="wo1" />);
    expect(await screen.findByLabelText("Planlama notu")).toHaveValue("Önce X firmasına");
    expect(screen.getByTestId("planning-note-count")).toHaveTextContent("16/2000");
    expect(screen.getByTestId("planning-note-meta")).toHaveTextContent("Son düzenleyen: Planlamacı Bir");
    expect(screen.getByText(/yalnız panelde görünür; istasyonlara, karta ve etikete çıkmaz/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("Kaydet → PUT gövdesi metin; boşaltınca boş metin (temizle, sunucu satırı silmez)", async () => {
    getNote.mockResolvedValue(view("eski"));
    saveNote.mockResolvedValue(view(null));
    renderWithProviders(<PlanningNoteCard workOrderId="wo1" />);
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Planlama notu");
    await user.clear(box);
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith("wo1", ""));
    saveNote.mockResolvedValue(view("yeni"));
    await user.type(box, "yeni");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(saveNote).toHaveBeenLastCalledWith("wo1", "yeni"));
  });

  it("≤ 2000: maxLength 2000; 2001 karakter (yapıştırma) → sayaç kırmızı, Kaydet kapalı", async () => {
    getNote.mockResolvedValue(view(null));
    renderWithProviders(<PlanningNoteCard workOrderId="wo1" />);
    const box = await screen.findByLabelText("Planlama notu");
    expect(box).toHaveAttribute("maxLength", "2000");
    fireEvent.change(box, { target: { value: "a".repeat(2001) } });
    expect(screen.getByTestId("planning-note-count")).toHaveTextContent("2001/2000");
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "a".repeat(2000) } });
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeEnabled();
  });

  it("yazma izni yok → salt okunur metin, kutu ve Kaydet yok", async () => {
    canWrite = false;
    getNote.mockResolvedValue(view("Yalnız okunur not"));
    renderWithProviders(<PlanningNoteCard workOrderId="wo1" />);
    expect(await screen.findByText("Yalnız okunur not")).toBeInTheDocument();
    expect(screen.queryByLabelText("Planlama notu")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Kaydet" })).not.toBeInTheDocument();
  });
});
