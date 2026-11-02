// Okuma uyarıları: taslak detayında `notices` şeridi (backend helper'ı; panel metin ayrıştırmaz), el yazısı şüpheli
// satır etiketi (SUSPECT_VALUE) + "yalnız sorunlu satırlar" süzgeci, Genel Ayarlar → şüpheli değer oranı alanı.
// Negatif sonda: NoticesStrip'i `return null` yapmak → "şerit başlık + ayrıntı" kırmızı; PROBLEM_LABEL'dan
// SUSPECT_VALUE silmek → "Şüpheli değer etiketi" kırmızı; `od.body` gövdeden çıkarılınca "oran 6 gider" kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { NoticesStrip } from "../NoticesStrip";
import { LinesTable } from "../LinesTable";
import { IncomingDocumentSettingsSection } from "@/pages/GeneralSettings/GelenBelgeSettingsSection";
import type { DeliveryNoteDetail, DeliveryNoteLine } from "../types";

const getSettings = vi.fn();
const updateSettings = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => getSettings(),
  updateIncomingDocumentSettings: (b: unknown) => updateSettings(b),
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ isLoading: false, data: { data: { gelenBelgeEnabled: true } } }),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({ EntityPickerModal: () => null }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => null }));

describe("okuma uyarıları şeridi", () => {
  it("⭐ 0246 benzeri: ikinci belge izi başlık + ayrıntıyla görünür; sayı başlıkta", () => {
    renderWithProviders(
      <NoticesStrip
        notices={[
          { code: "SECOND_DOCUMENT_TRACE", title: "Sayfada ikinci belge var", detail: "Bu sayfada ikinci bir belge izi var: Ürün sevk fişi (Sevk No 46399) — ayrı fotoğrafla yükleyin" },
          { code: "GRID_SUSPECT_VALUES", title: "Şüpheli el yazısı değerler", detail: "2, 3, 13 numaralı hücre(ler)in metresi şüpheli" },
        ]}
      />,
    );
    expect(screen.getByTestId("notices-strip")).toHaveTextContent("Okuma uyarıları (2)");
    const items = screen.getAllByTestId("notice");
    expect(items.map((x) => x.dataset.code)).toEqual(["SECOND_DOCUMENT_TRACE", "GRID_SUSPECT_VALUES"]);
    expect(items[0]).toHaveTextContent("Sayfada ikinci belge var — Bu sayfada ikinci bir belge izi var: Ürün sevk fişi (Sevk No 46399) — ayrı fotoğrafla yükleyin");
  });

  it("uyarı yoksa ya da eski backend alanı göndermezse şerit çizilmez", () => {
    const { unmount } = renderWithProviders(<NoticesStrip notices={[]} />);
    expect(screen.queryByTestId("notices-strip")).toBeNull();
    unmount();
    renderWithProviders(<NoticesStrip notices={undefined} />);
    expect(screen.queryByTestId("notices-strip")).toBeNull();
  });
});

const line = (id: string, lineNo: number, o: Partial<DeliveryNoteLine> = {}): DeliveryNoteLine =>
  ({
    id, noteId: "n1", lineNo, blockNo: 1, lineKind: "TOP", senderRollNo: String(lineNo), meters: "137", weightKg: null, widthCm: null, itemText: null, itemId: "i1",
    colorText: null, colorId: null, processText: null, confidence: null, needsReview: false, sourceRects: null, status: "PENDING", failReason: null, rollId: null,
    item: { id: "i1", code: "K", name: "Kumaş" }, color: null, problems: [], ...o,
  }) as DeliveryNoteLine;

describe("el yazısı şüpheli satır", () => {
  it("⭐ backend SUSPECT_VALUE → 'Şüpheli değer' etiketi; süzgeç şüpheli satırı kapsar", async () => {
    renderWithProviders(
      <LinesTable
        note={{ id: "n1", status: "DRAFT", ownerCustomerId: null, lines: [line("a", 1), line("b", 2, { meters: "1370", needsReview: true, problems: ["NEEDS_REVIEW", "SUSPECT_VALUE"] })] } as unknown as DeliveryNoteDetail}
        suggestions={undefined}
        editable
        canWrite
        selectedId={null}
        onSelect={vi.fn()}
        onPatch={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId("problem-filter"));
    expect(screen.getAllByTestId("line-row")).toHaveLength(1);
    const tags = screen.getAllByTestId("line-problem");
    expect(tags.map((t) => t.textContent)).toEqual(["Gözden geçirilmedi", "Şüpheli değer"]);
  });
});

const BASE = { defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: false, defaultRoute: null, routeSuggestionPriority: "CUSTOMER_FIRST", defaultRouteSuggestionPriority: "CUSTOMER_FIRST" };

describe("Genel Ayarlar → Gelen Belge: şüpheli değer oranı", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
  });

  it("⭐ oran 4 → 6 yapılınca YALNIZ handwritingOutlierFactor gider; aralık dışı değer kaydettirmez", async () => {
    getSettings.mockResolvedValue({ ...BASE, handwritingOutlierFactor: 4, defaultHandwritingOutlierFactor: 4, handwritingOutlierFactorRange: { min: 2, max: 20 } });
    updateSettings.mockResolvedValue({ ...BASE, handwritingOutlierFactor: 6, defaultHandwritingOutlierFactor: 4, handwritingOutlierFactorRange: { min: 2, max: 20 } });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    const input = await screen.findByLabelText("El yazısı şüpheli değer oranı");
    expect(input).toHaveValue(4);
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    expect(screen.getByText("Oran 2 ile 20 arasında olmalı.")).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "6");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toEqual({ handwritingOutlierFactor: 6 });
  });

  it("eski backend alanı göndermezse oran alanı çizilmez", async () => {
    getSettings.mockResolvedValue(BASE);
    renderWithProviders(<IncomingDocumentSettingsSection />);
    expect(await screen.findByTestId("gelen-belge-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("gb-outlier-factor")).toBeNull();
  });
});
