// Belge tipi SIFIRLA (yıkıcı işlem kuralı): önizleme gelmeden POST yok; etkilenen her tip listelenir, kayıt başına seçim;
// seçilmeyen kod gövdeye girmez; sonuç done/failed ayrı görünür; pasif tip seçilemez.
// Negatif sonda: Sıfırla düğmesi önizlemesiz POST'a bağlanınca (disabled'dan `!preview.data` çıkarılıp mutationFn önizleme
// beklemeden `codes` gönderince) §1 kırmızı; `selected` yerine bütün `items` gönderilince §2 kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SablonSifirlaDialog } from "../tanit/SablonSifirlaDialog";
import type { TemplateResetPreviewItem } from "../tanit/types";

const previewTemplateReset = vi.fn();
const resetTemplates = vi.fn();
vi.mock("../tanit/service", () => ({
  previewTemplateReset: (...a: unknown[]) => previewTemplateReset(...a),
  resetTemplates: (...a: unknown[]) => resetTemplates(...a),
}));

const item = (o: Partial<TemplateResetPreviewItem>): TemplateResetPreviewItem => ({
  code: "u-a", name: "A Boya", version: 2, isActive: true, hitCount: 12, lastReadAt: "2026-11-08T07:00:00Z",
  notesByStatus: { APPROVED: 9, DRAFT: 3 }, drafts: [{ id: "n1", documentNo: "GB-0001", senderDocNo: null, createdAt: "" }], draftsTotal: 53,
  sender: { id: "c1", code: "C1", name: "Güleçsoy" }, ...o,
});

beforeEach(() => {
  previewTemplateReset.mockReset();
  resetTemplates.mockReset().mockResolvedValue({ done: [{ code: "u-a", version: 2 }], failed: [{ code: "u-b", reason: "VERSION_CHANGED", message: "Belge tipi bu arada değişti; önizlemeyi yenileyin." }] });
});

describe("belge tipi sıfırla diyaloğu", () => {
  it("⭐ §1 önizleme gelmeden Sıfırla kapalı ve POST yok", async () => {
    let release: (v: unknown) => void = () => {};
    previewTemplateReset.mockReturnValue(new Promise((r) => { release = r; }));
    renderWithProviders(<SablonSifirlaDialog codes={["u-a"]} onOpenChange={() => {}} />);
    const apply = screen.getByTestId("reset-apply");
    expect(apply).toBeDisabled();
    await userEvent.click(apply);
    expect(resetTemplates).not.toHaveBeenCalled();
    expect(previewTemplateReset).toHaveBeenCalledWith(["u-a"]);
    release({ items: [item({})], failed: [] });
    await waitFor(() => expect(screen.getByTestId("reset-apply")).toBeEnabled());
  });

  it("satır künyesi: sürüm, okuma, durum sayıları, gönderen, açık taslaklar +N daha", async () => {
    previewTemplateReset.mockResolvedValue({ items: [item({})], failed: [] });
    renderWithProviders(<SablonSifirlaDialog codes={["u-a"]} onOpenChange={() => {}} />);
    const row = await screen.findByTestId("reset-row-u-a");
    expect(row).toHaveTextContent("sürüm 2");
    expect(row).toHaveTextContent("12 okuma · 9 onaylandı · 3 taslak");
    expect(row).toHaveTextContent("gönderen Güleçsoy");
    expect(screen.getByTestId("reset-drafts-u-a")).toHaveTextContent("GB-0001 +52 daha");
    expect(screen.getByText(/Eski belgeler, iş emirleri ve okumalar DEĞİŞMEZ/)).toBeInTheDocument();
  });

  it("⭐ §2 çoklu kipte kutular boş başlar; seçilmeyen kod gövdeye girmez; sonuç done/failed ayrı", async () => {
    previewTemplateReset.mockResolvedValue({
      items: [item({}), item({ code: "u-b", name: "B Boya", version: 5 }), item({ code: "u-c", name: "C Boya" })],
      failed: [],
    });
    renderWithProviders(<SablonSifirlaDialog codes={["u-a", "u-b", "u-c"]} multi onOpenChange={() => {}} />);
    await screen.findByTestId("reset-row-u-c");
    expect(screen.getByTestId("reset-apply")).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "A Boya sıfırlansın" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "B Boya sıfırlansın" }));
    await userEvent.click(screen.getByTestId("reset-apply"));
    await waitFor(() => expect(resetTemplates).toHaveBeenCalledWith([{ code: "u-a", expectedVersion: 2 }, { code: "u-b", expectedVersion: 5 }]));
    expect(await screen.findByTestId("reset-done")).toHaveTextContent("1 tip sıfırlandı: A Boya");
    expect(within(screen.getByTestId("reset-failed")).getByText(/B Boya/).parentElement).toHaveTextContent("önizlemeyi yenileyin");
    expect(screen.queryByTestId("reset-apply")).toBeNull();
  });

  it("tekil kipte seçili gelir; zaten pasif tip seçilemez; bilinmeyen kod failed olarak görünür", async () => {
    previewTemplateReset.mockResolvedValue({ items: [item({}), item({ code: "u-p", name: "Pasif", isActive: false })], failed: [{ code: "u-x", reason: "NOT_FOUND", message: "Belge tipi bulunamadı." }] });
    renderWithProviders(<SablonSifirlaDialog codes={["u-a", "u-p", "u-x"]} onOpenChange={() => {}} />);
    expect(await screen.findByRole("checkbox", { name: "A Boya sıfırlansın" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Pasif sıfırlansın" })).toBeDisabled();
    expect(screen.getByTestId("reset-failed")).toHaveTextContent("Belge tipi bulunamadı.");
    await userEvent.click(screen.getByTestId("reset-apply"));
    await waitFor(() => expect(resetTemplates).toHaveBeenCalledWith([{ code: "u-a", expectedVersion: 2 }]));
  });
});
