// "İş emri oluştur" girişi (K6): seçici iki satır (Standart: Terbiye/Dokuma · Özel: kısayollar); kısayol yok + dokuma yok →
// bugünkü form; kısayol → rota uygulanmış form + üstte "Belge okut" (formun kendi düğmesi kapalı).
// Negatif sonda: KisayolIsEmri'de `belgeOkut: false` kaldırılınca "formun kendi düğmesi kapalı" kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { IsEmriGiris } from "../IsEmriGiris";
import { newWorkOrderTitle } from "../nav";
import { toShortcuts, type WorkOrderShortcut } from "../service";

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: unknown) => unknown) => sel({ navigateActive }) }));
const shortcuts: { list: WorkOrderShortcut[] } = { list: [] };
vi.mock("../service", async (orig) => ({ ...(await orig<typeof import("../service")>()), listWorkOrderShortcuts: () => Promise.resolve(shortcuts.list) }));
const flags = { dokuma: false, gelenBelge: true };
vi.mock("@/hooks/usePricingEnabled", () => ({ useDokumaEnabled: () => flags.dokuma, useGelenBelgeEnabled: () => flags.gelenBelge }));
const perms = { list: ["workorder:write", "weavingorder:write", "gelen-belge:write"] };
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.list.includes(p) }) }));
vi.mock("@/pages/Operations/GelenBelgeler/UploadDialog", () => ({ UploadDialog: (p: { autoSend?: boolean }) => <div data-testid="upload-dialog" data-auto={String(p.autoSend ?? false)} /> }));
vi.mock("../BelgedenIsEmriForm", () => ({ BelgedenIsEmriForm: ({ noteId }: { noteId: string }) => <div data-testid="doc-form">{noteId}</div> }));
vi.mock("../TopluBelgeForm", () => ({ TopluBelgeForm: () => <div /> }));
vi.mock("../TopluYukleDialog", () => ({ TopluYukleDialog: () => <div data-testid="bulk-dialog" /> }));

const manual = vi.fn((routeId: string | null, opts?: { belgeOkut?: boolean; shortcut?: boolean }): ReactNode => (
  <div data-testid="manual-form" data-route={routeId ?? ""} data-okut={String(opts?.belgeOkut ?? true)} data-shortcut={String(opts?.shortcut ?? false)} />
));
const sc: WorkOrderShortcut = { id: "rt-k", name: "Kurşun & Tambur", description: null, shortcutOrder: 1, stepNames: ["Kurşun", "Tambur"], hasKursun: true };

beforeEach(() => {
  navigateActive.mockReset();
  manual.mockClear();
  shortcuts.list = [];
  flags.dokuma = false;
  flags.gelenBelge = true;
  perms.list = ["workorder:write", "weavingorder:write", "gelen-belge:write"];
});

describe("İş emri türü seçici", () => {
  it("kısayol ve dokuma yoksa bugünkü form doğrudan (seçici yok)", async () => {
    renderWithProviders(<IsEmriGiris start={null} renderManual={manual} />);
    expect(await screen.findByTestId("manual-form")).toHaveAttribute("data-route", "");
    expect(screen.queryByTestId("oie-picker")).toBeNull();
  });
  it("⭐ iki satır: Standart (Terbiye + Dokuma) ve Özel (kısayollar); kısayol tıkı rotalı formu açar", async () => {
    shortcuts.list = [sc];
    flags.dokuma = true;
    renderWithProviders(<IsEmriGiris start={null} renderManual={manual} />);
    expect(await screen.findByTestId("oie-row-standard")).toBeInTheDocument();
    expect(screen.getByTestId("oie-terbiye")).toBeInTheDocument();
    expect(screen.getByTestId("oie-dokuma")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Kurşun & Tambur"));
    expect(navigateActive).toHaveBeenCalledWith("/operations/work-orders/new", { state: { oie: { kind: "shortcut", route: { id: "rt-k", name: "Kurşun & Tambur", hasKursun: true } } } });
    await userEvent.click(screen.getByTestId("oie-dokuma"));
    expect(navigateActive).toHaveBeenLastCalledWith("/operations/weaving-orders", { state: { openNew: true } });
  });
  it("kısayol yoksa 2. satır görünmez; dokuma izni yoksa Dokuma gizli", async () => {
    flags.dokuma = true;
    perms.list = ["workorder:write"];
    shortcuts.list = [sc];
    const { unmount } = renderWithProviders(<IsEmriGiris start={null} renderManual={manual} />);
    await screen.findByTestId("oie-picker");
    expect(screen.queryByTestId("oie-dokuma")).toBeNull();
    unmount();
    perms.list = ["workorder:write", "weavingorder:write"];
    shortcuts.list = [];
    renderWithProviders(<IsEmriGiris start={null} renderManual={manual} />);
    await screen.findByTestId("oie-picker");
    expect(screen.queryByTestId("oie-row-shortcuts")).toBeNull();
  });
  it("Terbiye seçimi → bugünkü form, rota yok", () => {
    renderWithProviders(<IsEmriGiris start={{ kind: "terbiye" }} renderManual={manual} />);
    expect(screen.getByTestId("manual-form")).toHaveAttribute("data-route", "");
    expect(screen.getByTestId("manual-form")).toHaveAttribute("data-shortcut", "false");
  });
});

describe("Kısayol iş emri formu", () => {
  it("⭐ rota uygulanmış form + üstte Belge okut; formun kendi Belge okut düğmesi kapalı; başlık '<ad> iş emri'", async () => {
    renderWithProviders(<IsEmriGiris start={{ kind: "shortcut", route: { id: "rt-k", name: "Kurşun & Tambur" } }} renderManual={manual} />);
    const form = screen.getByTestId("manual-form");
    expect(form).toHaveAttribute("data-route", "rt-k");
    expect(form).toHaveAttribute("data-okut", "false");
    // Elle doldurulan kısayol formu da `refakatAutoPrint`e uyar (WorkOrderFormPage bu işaretle basar).
    expect(form).toHaveAttribute("data-shortcut", "true");
    expect(newWorkOrderTitle({ kind: "shortcut", route: { id: "rt-k", name: "Kurşun & Tambur" } })).toBe("Kurşun & Tambur terbiye iş emri");
    await userEvent.click(screen.getByTestId("oie-scan"));
    // Belge okut: dosya seçilince yükleme kendiliğinden (ayrı "Gönder" yok).
    expect(screen.getByTestId("upload-dialog")).toHaveAttribute("data-auto", "true");
    expect(screen.getByTestId("oie-scan-many")).toBeInTheDocument();
  });
  it("dışarıdan okutulan belgeyle doğrudan belge doldurmalı form; 'Elle doldur' bugünkü forma döner", async () => {
    renderWithProviders(<IsEmriGiris start={{ kind: "shortcut", route: { id: "rt-k", name: "K" }, noteId: "n9" }} renderManual={manual} />);
    expect(screen.getByTestId("doc-form")).toHaveTextContent("n9");
    await userEvent.click(screen.getByTestId("oie-manual"));
    expect(screen.getByTestId("manual-form")).toBeInTheDocument();
  });
  it("gelen belge modülü kapalıysa üst şerit yok, form yine rotalı", () => {
    flags.gelenBelge = false;
    renderWithProviders(<IsEmriGiris start={{ kind: "shortcut", route: { id: "rt-k", name: "K" } }} renderManual={manual} />);
    expect(screen.queryByTestId("oie-scan")).toBeNull();
    expect(screen.getByTestId("manual-form")).toHaveAttribute("data-route", "rt-k");
  });
});

describe("toShortcuts", () => {
  it("işaretsiz/pasif rotalar atılır (eski backend süzmez), shortcutOrder sırası", () => {
    const out = toShortcuts([
      { id: "a", name: "B", isWorkOrderShortcut: true, shortcutOrder: 2 },
      { id: "b", name: "A", isWorkOrderShortcut: true, shortcutOrder: 1, steps: [{ sequence: 2, station: { name: "Tambur" } }, { sequence: 1, station: { name: "Kurşun" } }] },
      { id: "c", name: "C" },
      { id: "d", name: "D", isWorkOrderShortcut: true, isActive: false },
    ]);
    expect(out.map((s) => s.id)).toEqual(["b", "a"]);
    expect(out[0]!.stepNames).toEqual(["Kurşun", "Tambur"]);
  });
});
