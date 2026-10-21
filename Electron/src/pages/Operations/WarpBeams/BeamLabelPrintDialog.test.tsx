// Levent etiketi: uç `warp-beams`, iz yalnız Yazdır'da, iptal edilmiş levent pasif.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { BeamLabelPrintDialog, isBeamLabelPrintable } from "./BeamLabelPrintDialog";
import type { WarpBeam } from "./types";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
vi.mock("@/lib/print", () => ({ printHtmlString: vi.fn() }));

const beam = { id: "b1", beamNo: "LV261021-0007", physicalBeamNo: "G-12", status: "READY" } as WarpBeam;

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: "<html></html>" });
  post.mockResolvedValue({ data: {} });
});

describe("levent etiketi", () => {
  it("⭐ iptal edilmiş levent basılmaz, diğer durumlar basılır", () => {
    expect(isBeamLabelPrintable({ status: "CANCELLED" })).toBe(false);
    for (const s of ["PLANNED", "READY", "MOUNTED", "EXHAUSTED"] as const) expect(isBeamLabelPrintable({ status: s })).toBe(true);
  });
  it("⭐ warp-beams ucu; önizleme iz bırakmaz, Yazdır copies ile iz yazar", async () => {
    const onClose = vi.fn();
    renderWithProviders(<BeamLabelPrintDialog beam={beam} onClose={onClose} />);
    expect(screen.getByText("LV261021-0007 · gövde G-12")).toBeInTheDocument();
    const yazdir = await screen.findByRole("button", { name: /Yazdır/ });
    await waitFor(() => expect(yazdir).toBeEnabled());
    expect(get).toHaveBeenCalledWith("/api/labels/warp-beams/b1/html", expect.objectContaining({ params: { copies: 1 } }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(yazdir);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/api/labels/warp-beams/b1/print-event", { copies: 1 }, { suppressErrorToast: true });
  });
});
