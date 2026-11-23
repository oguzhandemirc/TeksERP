import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportDialog, type ExportDialogChoice } from "./ExportDialog";
import type { ExportColumnOption } from "@/lib/export-columns";

const prefs: { exportDialog?: Record<string, unknown> } = {};
const setPreference = vi.fn();
vi.mock("@/providers/preferences-context", () => ({
  useOptionalPreferences: () => ({ ready: true, prefs, setPreference }),
}));

const catalog: ExportColumnOption[] = [
  { id: "a", label: "Alfa", visible: true },
  { id: "b", label: "Beta", visible: false },
  { id: "c", label: "Gama", visible: true },
];

function renderDialog(onRun: (c: ExportDialogChoice) => Promise<boolean | void>, prefKey?: string) {
  return render(<ExportDialog open onOpenChange={() => {}} title="Test çıktısı" catalog={catalog} prefKey={prefKey} onRun={onRun} />);
}

const box = (label: string) => screen.getByRole("checkbox", { name: label });

describe("ExportDialog", () => {
  beforeEach(() => {
    delete prefs.exportDialog;
    setPreference.mockReset();
  });

  it("gizli sütun listede işaretsiz ve 'ekranda gizli' etiketli", () => {
    renderDialog(async () => {});
    expect(box("Alfa")).toBeChecked();
    expect(box("Beta")).not.toBeChecked();
    expect(screen.getByText("ekranda gizli")).toBeInTheDocument();
    expect(screen.getByText("Sütunlar (2/3)")).toBeInTheDocument();
  });

  it("gizli sütun açılınca seçime girer; sıra katalog sırası", async () => {
    const onRun = vi.fn(async () => {});
    renderDialog(onRun);
    await userEvent.click(box("Beta"));
    await userEvent.click(screen.getByRole("button", { name: /Excel indir/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ format: "xlsx", columns: ["a", "b", "c"], scope: "all" }));
  });

  it("biçim seçimi onRun'a gider", async () => {
    const onRun = vi.fn(async () => {});
    renderDialog(onRun);
    await userEvent.click(screen.getByRole("radio", { name: "PDF" }));
    await userEvent.click(box("Alfa"));
    await userEvent.click(screen.getByRole("button", { name: /PDF indir/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ format: "pdf", columns: ["c"] }));
  });

  it("kayıtlı seçimdeki bilinmeyen id atılır, kalanlar katalog sırasında", async () => {
    prefs.exportDialog = { k: { columns: ["c", "silinmis", "b"], format: "csv" } };
    const onRun = vi.fn(async () => {});
    renderDialog(onRun, "k");
    expect(box("Alfa")).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /CSV indir/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ format: "csv", columns: ["b", "c"] }));
    expect(setPreference).toHaveBeenCalled();
  });

  it("açan düğmenin biçimi (defaultFormat) hatırlanan biçimin önüne geçer", async () => {
    prefs.exportDialog = { k: { format: "csv" } };
    const onRun = vi.fn(async () => {});
    render(<ExportDialog open onOpenChange={() => {}} title="T" catalog={catalog} prefKey="k" defaultFormat="pdf" onRun={onRun} />);
    await userEvent.click(screen.getByRole("button", { name: /PDF indir/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ format: "pdf" }));
  });

  it("hiç sütun seçili değilse indir düğmesi pasif", async () => {
    renderDialog(async () => {});
    await userEvent.click(box("Alfa"));
    await userEvent.click(box("Gama"));
    expect(screen.getByRole("button", { name: /Excel indir/ })).toBeDisabled();
  });
});
