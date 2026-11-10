// İE başlığı gruplu eylemler: menü klavyeyle açılır ve seçim onAction'a gider; tek öğeli grup düz düğme; boş grup yok.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkOrderHeaderActions } from "./WorkOrderHeaderActions";
import type { HeaderActionId, HeaderActionVisibility } from "./header-actions";

const ALL: HeaderActionId[] = [
  "addBatch", "fasonReceive", "linkOrder", "unlinkOrder", "changeColor",
  "changeWidth", "documents", "events", "complete", "cancel",
];
const vis = (on: HeaderActionId[]): HeaderActionVisibility =>
  Object.fromEntries(ALL.map((a) => [a, on.includes(a)])) as HeaderActionVisibility;

describe("WorkOrderHeaderActions", () => {
  it("§1 Durum menüsü klavyeyle açılır; İptal Et seçilince onAction('cancel')", async () => {
    const onAction = vi.fn();
    render(<WorkOrderHeaderActions visible={vis(ALL)} onAction={onAction} />);
    const trigger = screen.getByTestId("wo-actions-durum");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["Kapat", "İptal Et"]);
    expect(screen.getByRole("separator")).toBeTruthy();
    await userEvent.click(screen.getByTestId("wo-action-cancel"));
    expect(onAction).toHaveBeenCalledWith("cancel");
  });

  it("§2 tek öğeli grup düz düğme (eski ton), boş grup çizilmez, görünmeyen öğe yok", async () => {
    const onAction = vi.fn();
    render(<WorkOrderHeaderActions visible={vis(["documents", "events", "complete"])} onAction={onAction} />);
    expect(screen.queryByTestId("wo-actions-durum")).toBeNull();
    expect(screen.queryByTestId("wo-actions-uretim")).toBeNull();
    expect(screen.queryByTestId("wo-actions-degistir")).toBeNull();
    const kapat = screen.getByTestId("wo-action-complete");
    expect(kapat.className).toContain("bg-success");
    await userEvent.click(kapat);
    expect(onAction).toHaveBeenCalledWith("complete");
    expect(screen.queryByTestId("wo-action-cancel")).toBeNull();
    expect(screen.getByTestId("wo-actions-kayitlar")).toBeTruthy();
  });
});
