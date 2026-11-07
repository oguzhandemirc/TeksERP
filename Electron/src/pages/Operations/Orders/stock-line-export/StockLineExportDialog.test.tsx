// Modal: "Depoda (tümü)" seçilebilir sütun; seçim tercihe yazılır ve run'a gider; eski tercihte kapalı gelir.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppPreferences } from "@/types/preferences";
import { StockLineExportDialog } from "./StockLineExportDialog";
import type { StockLineOptions } from "./options";

let prefs: AppPreferences = {};
const setPreference = vi.fn((patch: Partial<AppPreferences>) => {
  prefs = { ...prefs, ...patch };
});
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs, setPreference, ready: true }),
}));
const run = vi.fn(async (_o: StockLineOptions) => true);
vi.mock("./useStockLineExportRun", () => ({
  useStockLineExportRun: () => ({ run, progress: null, confirmDialog: null }),
}));

const renderDialog = () =>
  render(
    <StockLineExportDialog
      open
      onOpenChange={() => {}}
      fetchAll={async () => []}
      listScope={{} as never}
      productionEnabled
    />,
  );

const box = (name: string) => screen.getByRole("checkbox", { name });

beforeEach(() => {
  // PR #602 dönemi tercih: yeni anahtar hiç yok.
  prefs = { orders: { stockLineExport: { byColor: true, byWidth: true, onlyOpen: true, columns: ["ordered", "inStock"] } } };
  setPreference.mockClear();
  run.mockClear();
});

describe("StockLineExportDialog — depo sütunları", () => {
  it("iki ayrı seçenek; eski tercihte serbest açık, tümü kapalı gelir", () => {
    renderDialog();
    expect(box("Depoda hazır (serbest)")).toHaveAttribute("data-state", "checked");
    expect(box("Depoda (tümü)")).toHaveAttribute("data-state", "unchecked");
  });

  it("tümü işaretlenince tercihe katalog sırasıyla yazılır ve indirmeye gider", async () => {
    renderDialog();
    fireEvent.click(box("Depoda (tümü)"));
    fireEvent.click(screen.getByRole("button", { name: /Excel oluştur/ }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]?.[0].columns).toEqual(["ordered", "inStock", "inStockAll"]);
    const saved = prefs.orders?.stockLineExport as StockLineOptions;
    expect(saved.columns).toEqual(["ordered", "inStock", "inStockAll"]);
  });
});
