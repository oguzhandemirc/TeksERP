// =============================================================================
// TEZGAH ETİKETİ — adet sınırı · WEAVING dışı gizli · 400'de ikinci toast yok · iz yalnız kâğıtta
// =============================================================================
// Negatif sonda (1, geri alındı): `isLoomLabelPrintable`ten tür koşulu düşürüldü →
// "WEAVING dışı gizli" ❌.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { StationKind } from "@/types/enums";
import { htmlOrJsonBody, parseLabelCopies } from "@/services/loomLabelService";
import { MachineRowActions } from "@/pages/Stations/MachineRowActions";
import { MachineLabelPrintDialog, isLoomLabelPrintable } from "./MachineLabelPrintDialog";
import type { Machine } from "./types";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
const printHtmlString = vi.fn();
vi.mock("@/lib/print", () => ({ printHtmlString: (...a: unknown[]) => printHtmlString(...a) }));
const toastError = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), warning: (...a: unknown[]) => toastWarning(...a), success: vi.fn() } }));
let permissions: string[] = ["label:print"];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => permissions.includes(p) }) }));

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: "m1", stationId: "s1", code: "T-07", name: "Tezgah 7", isActive: true, warpBeamSlots: 1,
  station: { id: "s1", code: "DK", name: "Dokuma", kind: StationKind.WEAVING }, createdAt: "", updatedAt: "", ...over,
});
const handlers = { onEdit: vi.fn(), onQr: vi.fn(), onPrintLabel: vi.fn(), onDeactivate: vi.fn(), onReactivate: vi.fn(), onDelete: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  permissions = ["label:print"];
  get.mockResolvedValue({ data: "<html><body>T-07</body></html>" });
  post.mockResolvedValue({ data: { success: true } });
});

describe("adet sınırı (1–200)", () => {
  it("⭐ yalnız 1..200 tam sayı geçer", () => {
    expect(parseLabelCopies("1")).toBe(1);
    expect(parseLabelCopies("200")).toBe(200);
    for (const bad of ["0", "201", "1.5", "", "-3", "abc"]) expect(parseLabelCopies(bad)).toBeNull();
  });
  it("⭐ 201 girilince uyarı çıkar, Yazdır kapanır", async () => {
    renderWithProviders(<MachineLabelPrintDialog machine={machine()} onOpenChange={() => {}} />);
    const yazdir = await screen.findByRole("button", { name: /Yazdır/ });
    await waitFor(() => expect(yazdir).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Adet"), { target: { value: "201" } });
    expect(screen.getByRole("alert")).toHaveTextContent("1–200");
    expect(yazdir).toBeDisabled();
  });
});

describe("görünürlük — yalnız aktif dokuma tezgahı", () => {
  it("⭐ WEAVING + aktif + label:print → düğme var", () => {
    renderWithProviders(<MachineRowActions m={machine()} canWrite={false} h={handlers} stationKind={StationKind.WEAVING} />);
    fireEvent.click(screen.getByTitle(/Tezgah etiketi bas/));
    expect(handlers.onPrintLabel).toHaveBeenCalledTimes(1);
  });
  it("⭐ WEAVING dışı istasyonda gizli", () => {
    renderWithProviders(<MachineRowActions m={machine({ station: undefined })} canWrite h={handlers} stationKind={StationKind.RAW_QC} />);
    expect(screen.queryByTitle(/Tezgah etiketi bas/)).toBeNull();
    expect(isLoomLabelPrintable(machine({ station: { id: "s", code: "K", name: "K", kind: StationKind.RAW_QC } }))).toBe(false);
  });
  it("pasif tezgahta ve label:print yoksa gizli", () => {
    expect(isLoomLabelPrintable(machine({ isActive: false }))).toBe(false);
    permissions = [];
    renderWithProviders(<MachineRowActions m={machine()} canWrite h={handlers} stationKind={StationKind.WEAVING} />);
    expect(screen.queryByTitle(/Tezgah etiketi bas/)).toBeNull();
  });
});

describe("baskı akışı", () => {
  it("⭐ N adet: HTML copies=N istenir, basılır, iz copies=N ile yazılır", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<MachineLabelPrintDialog machine={machine()} onOpenChange={onOpenChange} />);
    const yazdir = await screen.findByRole("button", { name: /Yazdır/ });
    await waitFor(() => expect(yazdir).toBeEnabled());
    expect(post).not.toHaveBeenCalled(); // önizleme iz bırakmaz
    fireEvent.change(screen.getByLabelText("Adet"), { target: { value: "12" } });
    fireEvent.click(yazdir);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(get).toHaveBeenLastCalledWith("/api/labels/machines/m1/html", expect.objectContaining({ params: { copies: 12 } }));
    expect(printHtmlString).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/labels/machines/m1/print-event", { copies: 12 }, { suppressErrorToast: true });
  });
  it("⭐ şablon yok (400): diyalog kendi toast'unu BASMAZ, satır içi açıklar, Yazdır kapalı", async () => {
    get.mockRejectedValue(Object.assign(new Error("400"), { response: { status: 400 } }));
    renderWithProviders(<MachineLabelPrintDialog machine={machine()} onOpenChange={() => {}} />);
    expect(await screen.findByText(/Etiket hazırlanamadı/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1); // retry yok ⇒ genel bildirim bir kez
    expect(toastError).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Yazdır/ })).toBeDisabled();
  });
  it("⭐ 400 gövdesi metin yanıtta da JSON çözülür (genel bildirim sunucunun cümlesini basar)", () => {
    const body = JSON.stringify({ success: false, message: "Tezgah etiketi şablonu yok", details: { code: "LABEL_TEMPLATE_MISSING" } });
    expect(htmlOrJsonBody(body, { "content-type": "application/json; charset=utf-8" })).toMatchObject({ message: "Tezgah etiketi şablonu yok" });
    expect(htmlOrJsonBody("<html></html>", { "content-type": "text/html" })).toBe("<html></html>");
  });
  it("iz düşerse tek uyarı: kâğıt geçerli", async () => {
    post.mockRejectedValue(new Error("ağ"));
    renderWithProviders(<MachineLabelPrintDialog machine={machine()} onOpenChange={() => {}} />);
    const yazdir = await screen.findByRole("button", { name: /Yazdır/ });
    await waitFor(() => expect(yazdir).toBeEnabled());
    fireEvent.click(yazdir);
    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastError).not.toHaveBeenCalled();
  });
});
