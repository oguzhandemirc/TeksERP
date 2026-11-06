import { beforeEach, describe, expect, it, vi } from "vitest";

// PENCERE KAPANIŞ KORUMASI (ana süreç): renderer kirli sekme yüzünden `beforeunload`u engelleyince
// yerel "Kapat / Vazgeç" sorulur; "Kapat" engeli kaldırır (preventDefault), "Vazgeç" pencereyi açık tutar.

const h = vi.hoisted(() => ({ showMessageBoxSync: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showMessageBoxSync: h.showMessageBoxSync } }));

const { installUnloadGuard, unloadDialogOptions } = await import("../../electron/window-close-guard");

type Handler = (e: { preventDefault: () => void }) => void;
function fakeWindow() {
  const handlers = new Map<string, Handler>();
  const win = { webContents: { on: (ev: string, fn: Handler) => handlers.set(ev, fn) } };
  const fire = () => {
    const e = { preventDefault: vi.fn() };
    handlers.get("will-prevent-unload")!(e);
    return e.preventDefault;
  };
  return { win: win as never, fire };
}

beforeEach(() => h.showMessageBoxSync.mockReset());

describe("will-prevent-unload", () => {
  it("Kapat (0) → engel kaldırılır, pencere kapanır", () => {
    const { win, fire } = fakeWindow();
    installUnloadGuard(win);
    h.showMessageBoxSync.mockReturnValue(0);
    expect(fire()).toHaveBeenCalledOnce();
    expect(h.showMessageBoxSync).toHaveBeenCalledWith(win, unloadDialogOptions);
  });

  it("Vazgeç (1) / Esc → pencere açık kalır", () => {
    const { win, fire } = fakeWindow();
    installUnloadGuard(win);
    h.showMessageBoxSync.mockReturnValue(1);
    expect(fire()).not.toHaveBeenCalled();
    expect(unloadDialogOptions.cancelId).toBe(1);
    expect(unloadDialogOptions.defaultId).toBe(1); // Enter yanlışlıkla kapatmasın
  });

  it("kullanıcı kurulumu az önce onayladıysa ikinci kez sorulmaz", () => {
    const { win, fire } = fakeWindow();
    installUnloadGuard(win, () => true);
    expect(fire()).toHaveBeenCalledOnce();
    expect(h.showMessageBoxSync).not.toHaveBeenCalled();
  });
});
