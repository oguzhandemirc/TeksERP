import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithProviders } from "@/test/render";
import { RollLabelDialog } from "./RollLabelDialog";

// =============================================================================
// TOP ETİKETİ PENCERESİ (2026-11-10): açılışta TEK önizleme (+ yakınlaştırma), "Etiketi düzenle"
// kipinde canlı taslak önizleme + form; Kaydet BASMAZ, "Kaydet ve bas" kaydedip kayıtlı hâli basar;
// listede olmayan müşteri adı serbest metin olarak yazılır (cariye gitmez).
// Negatif sonda (2026-11-10, 4/4 ısırdı): Kaydet → onSave(true) · basımda taze önizleme yerine eski ·
// tekerlekte Ctrl koşulu kaldırıldı · alan girdisi taslağı göstermez → ilgili test kırmızı; geri alındı.
// =============================================================================

vi.mock("@/lib/runtime-env", () => ({ IS_ELECTRON: true }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { scrapGradeLabelEnabled: false } } }) }));
vi.mock("@/pages/QualityGrades/service", () => ({ qualityGradeService: { listCursor: () => Promise.resolve({ data: [] }) } }));
vi.mock("@/hooks/useDebouncedValue", () => ({ useDebouncedValue: <T,>(v: T) => v }));
// Seçici modalı: tek düğme, tıklanınca kayıtlı bir cari/kumaş "seçer".
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: (p: { placeholder?: string; title?: string; onChange: (id: string, item: unknown) => void }) => (
    <button type="button" onClick={() => p.onChange("c9", { id: "c9", code: "C9", name: "Kayıtlı Cari" })}>
      {p.title ?? p.placeholder ?? "seç"}
    </button>
  ),
}));

const printTracked = vi.fn();
vi.mock("@/lib/print", () => ({ printTracked: (...a: unknown[]) => printTracked(...a) }));
vi.mock("@/hooks/useLabelPrinter", () => ({
  useLabelPrinter: () => ({ directEnabled: false, printRoll: vi.fn(), peripheralId: undefined }),
}));

const getRollPreview = vi.fn();
const printRollLabel = vi.fn();
vi.mock("@/services/labelService", () => ({
  labelService: {
    getRollLabel: () => Promise.resolve({ success: true, data: { rollId: "r1", barcode: "B1", qualityGrade: "A" } }),
    getRollPreview: (...a: unknown[]) => getRollPreview(...a),
    printRollLabel: (...a: unknown[]) => printRollLabel(...a),
  },
}));

const getEditForm = vi.fn();
const previewDraft = vi.fn();
const save = vi.fn();
vi.mock("@/services/rollLabelEditService", () => ({
  rollLabelEditService: {
    getEditForm: (...a: unknown[]) => getEditForm(...a),
    previewDraft: (...a: unknown[]) => previewDraft(...a),
    save: (...a: unknown[]) => save(...a),
  },
}));

const VIEW = {
  rollId: "r1",
  barcode: "B1",
  locked: null,
  labelEditedAt: "2026-11-10T08:00:00.000Z",
  templateId: null,
  chainTemplateId: "t1",
  templates: [
    { id: "t1", name: "Standart", boundKeys: ["customerName", "lengthMeters"] },
    { id: "t2", name: "Özel", boundKeys: ["itemName"] },
  ],
  fields: [
    { key: "itemName", label: "Ürün (müşterideki ad)", measured: false, column: true, value: "Kumaş", overridden: false },
    { key: "customerName", label: "Müşteri", measured: false, column: false, value: "Eski Cari", overridden: false },
    { key: "lengthMeters", label: "Metraj (m)", measured: true, column: false, value: "50 m", overridden: false },
  ],
  customerId: "c1",
  customerName: "Eski Cari",
  ownerCustomerId: null,
  consigneeId: null,
};

function openDialog() {
  renderWithProviders(<RollLabelDialog rollId="r1" onOpenChange={() => undefined} />);
}
async function enterEdit() {
  openDialog();
  const btn = await screen.findByRole("button", { name: /Etiketi düzenle/ });
  // Düğme payload gelene dek kapalı.
  await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(btn);
  await screen.findByLabelText(/Şablon/);
}

beforeEach(() => {
  vi.clearAllMocks();
  getRollPreview.mockResolvedValue({ mode: "html", language: "RASTER_HTML", content: "<p>kayitli</p>", kind: "ROLL_FINISHED" });
  previewDraft.mockResolvedValue({ mode: "html", language: "RASTER_HTML", content: "<p>taslak</p>", kind: "ROLL_FINISHED" });
  getEditForm.mockResolvedValue(VIEW);
  save.mockResolvedValue({ ...VIEW, changed: true });
  printTracked.mockResolvedValue({ status: "ILETILDI", proceed: true, printJob: { transport: "SISTEM_PENCERESI" } });
  printRollLabel.mockResolvedValue({ success: true, data: { rollId: "r1" } });
});

describe("RollLabelDialog — tek önizleme", () => {
  it("açılışta yalnız önizleme, teknik dil satırı ve müşteri için bas kartı yok", async () => {
    openDialog();
    expect(await screen.findByTitle("Top etiketi")).toBeTruthy();
    expect(screen.queryByText(/Aktif dil/)).toBeNull();
    expect(screen.queryByText(/Müşteri İçin/i)).toBeNull();
    // Başlıktaki X da "Kapat" adını taşır; alt çubukta görünür metinli Kapat düğmesi aranır.
    expect(screen.getByText("Kapat", { selector: "button" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Etiketi düzenle/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Bas$/ })).toBeTruthy();
    expect(getEditForm).not.toHaveBeenCalled();
  });

  it("yakınlaştırma: + / − / %100 / Ctrl+tekerlek yüzdeyi değiştirir", async () => {
    openDialog();
    await screen.findByTitle("Top etiketi");
    const pct = () => screen.getByTestId("zoom-percent").textContent;
    fireEvent.click(screen.getByRole("button", { name: "%100 (gerçek boyut)" }));
    expect(pct()).toBe("%100");
    fireEvent.click(screen.getByRole("button", { name: "Yakınlaştır" }));
    expect(pct()).toBe("%125");
    fireEvent.click(screen.getByRole("button", { name: "Uzaklaştır" }));
    fireEvent.click(screen.getByRole("button", { name: "Uzaklaştır" }));
    expect(pct()).toBe("%80");
    fireEvent.wheel(screen.getByTestId("zoom-viewport"), { deltaY: -100, ctrlKey: true });
    expect(pct()).toBe("%88");
    // Ctrl'süz tekerlek yakınlaştırmaz (kaydırmadır).
    fireEvent.wheel(screen.getByTestId("zoom-viewport"), { deltaY: -100 });
    expect(pct()).toBe("%88");
    expect(screen.getByRole("button", { name: /Sığdır/ })).toBeTruthy();
  });
});

describe("RollLabelDialog — Etiketi düzenle", () => {
  it("form şablonun bağladığı alanları gösterir; tümünü göster gizlileri açar", async () => {
    await enterEdit();
    const list = screen.getByTestId("label-edit-fields");
    expect(within(list).getByLabelText("Müşteri")).toBeTruthy();
    expect(within(list).queryByLabelText("Ürün (müşterideki ad)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tüm alanları göster" }));
    expect(within(list).getByLabelText("Ürün (müşterideki ad)")).toBeTruthy();
    expect(await screen.findByTitle("Düzenlenen etiket")).toBeTruthy();
  });

  it("listede olmayan müşteri adı serbest yazılır, taslak önizlemeye gider, geri alınabilir", async () => {
    await enterEdit();
    fireEvent.change(screen.getByLabelText("Müşteri"), { target: { value: "Kayıtsız Tekstil" } });
    await waitFor(() =>
      expect(previewDraft).toHaveBeenCalledWith("r1", expect.objectContaining({ fields: { customerName: "Kayıtsız Tekstil" } }), expect.anything()),
    );
    expect((screen.getByLabelText("Müşteri") as HTMLInputElement).value).toBe("Kayıtsız Tekstil");
    expect(screen.getByText("değişti")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Müşteri geri al" }));
    expect((screen.getByLabelText("Müşteri") as HTMLInputElement).value).toBe("Eski Cari");
  });

  it("Kaydet basmaz: yama + sürüm belirteci gider, baskı yolu çağrılmaz", async () => {
    await enterEdit();
    fireEvent.change(screen.getByLabelText("Metraj (m)"), { target: { value: "48,5" } });
    fireEvent.change(screen.getByLabelText(/Şablon/), { target: { value: "t2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Kaydet$/ }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("r1", { templateId: "t2", fields: { lengthMeters: "48,5" } }, VIEW.labelEditedAt);
    await screen.findByRole("button", { name: /Etiketi düzenle/ });
    expect(printTracked).not.toHaveBeenCalled();
    expect(printRollLabel).not.toHaveBeenCalled();
  });

  it("Kaydet ve bas: kaydeder, kayıtlı hâlin taze önizlemesini basar", async () => {
    await enterEdit();
    fireEvent.click(screen.getByRole("button", { name: /Kayıtlı Cari|Eski Cari/ }));
    getRollPreview.mockResolvedValue({ mode: "html", language: "RASTER_HTML", content: "<p>yeni</p>", kind: "ROLL_FINISHED" });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet ve bas/ }));
    await waitFor(() => expect(printTracked).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith("r1", { fields: {}, customer: { customerId: "c9" } }, VIEW.labelEditedAt);
    expect(printTracked.mock.calls[0]?.[0]).toMatchObject({ html: "<p>yeni</p>", subject: { kind: "ETIKET_TOP", id: "r1" } });
    await waitFor(() => expect(printRollLabel).toHaveBeenCalledTimes(1));
  });

  it("Vazgeç kaydetmeden önizlemeye döner", async () => {
    await enterEdit();
    fireEvent.change(screen.getByLabelText("Müşteri"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    await screen.findByRole("button", { name: /Etiketi düzenle/ });
    expect(save).not.toHaveBeenCalled();
  });
});
