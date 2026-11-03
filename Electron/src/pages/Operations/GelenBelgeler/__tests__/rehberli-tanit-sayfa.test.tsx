// K30-T A2/A3 panel rehberli tanıtma sayfası: varsayılan adım adım; değere dokun → otomatik önizleme → "Okunan: …";
// Bitir'de ad başlıktan; kaydet tek tık; benzer şablon diyaloğu (Yeni tip → POST, Aynı tip → o şablonu base ile sürümlü PUT).
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { ScanWord, ScanWords } from "../tanit/types";

const perms = { list: ["gelen-belge:read", "gelen-belge:template"] };
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.list.includes(p) }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => <div><h1>{title}</h1>{actions}</div> }));
const nav = { search: "" };
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useParams: () => ({ id: "n1" }), useSearchParams: () => [new URLSearchParams(nav.search)] }));
const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: unknown) => unknown) => sel({ navigateActive, openTab: navigateActive }) }));
vi.mock("../useScanImage", () => ({ useScanImage: () => ({ url: null, isLoading: false, isError: false, isPdf: false }) }));
const note = { data: { id: "n1", noteNo: "GB-1", templateId: null as string | null, scans: [{ id: "s1", pageNo: 1, status: "READ" as const, mimeType: "image/jpeg" }] }, isError: false };
vi.mock("../useNoteDetail", () => ({ useNoteDetail: () => ({ note }) }));

const api = { getScanWords: vi.fn(), suggestTemplate: vi.fn(), createUserTemplate: vi.fn(), updateUserTemplate: vi.fn(), getUserTemplate: vi.fn(), listUserTemplates: vi.fn() };
vi.mock("../tanit/service", () => ({
  TEACH_QUERY_KEY: ["gelen-belge", "tanitma"],
  USER_TEMPLATES_QUERY_KEY: ["gelen-belge", "sablonlar", "ozel"],
  getScanWords: (...a: unknown[]) => api.getScanWords(...a),
  suggestTemplate: (...a: unknown[]) => api.suggestTemplate(...a),
  createUserTemplate: (...a: unknown[]) => api.createUserTemplate(...a),
  updateUserTemplate: (...a: unknown[]) => api.updateUserTemplate(...a),
  getUserTemplate: (...a: unknown[]) => api.getUserTemplate(...a),
  listUserTemplates: (...a: unknown[]) => api.listUserTemplates(...a),
}));

const { TeachTemplatePage } = await import("../tanit/TanitPage");

// Fotoğraf 90° dönük saklanmış gibi: photoRect ≠ rect (öneri OCR çerçevesini almalı).
const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x: x + 1000, y: y + 2000, width, height: 20 }, lineNo, confidence: 0.99,
});
const SCAN: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [
    w("GÜLEÇSOY", [50, 20], 1, 120), w("BOYA", [180, 20], 1), w("ÇEKİ", [50, 60], 2), w("LİSTESİ", [120, 60], 2),
    w("Ham", [50, 300], 3), w("PartiNo:", [100, 300], 3), w("P2618733", [200, 300], 3, 90),
    w("Metre", [50, 600], 4), w("Kilo", [200, 600], 4), w("1234", [50, 1000], 9),
  ],
};

const okResult = (extra: Record<string, unknown> = {}) => ({
  template: { id: "u-gulecsoy" }, explain: [{ field: "partiNo", strategy: "anchor", label: "Ham PartiNo", direction: "right" }], errors: [],
  preview: { matched: true, score: 1, fields: { partiNo: "P2618733" }, lineCount: 4, warnings: [] }, ...extra,
});

beforeEach(() => {
  nav.search = "";
  navigateActive.mockReset();
  for (const f of Object.values(api)) f.mockReset();
  api.getScanWords.mockResolvedValue(SCAN);
  api.suggestTemplate.mockResolvedValue(okResult());
  api.createUserTemplate.mockResolvedValue({ code: "u-gulecsoy", name: "GÜLEÇSOY BOYA", version: 1 });
  api.updateUserTemplate.mockResolvedValue({ code: "u-a", name: "A Boya", version: 5 });
});

async function tapPartiNo() {
  renderWithProviders(<TeachTemplatePage />);
  expect(await screen.findByTestId("guided-identifiers")).toHaveTextContent("GÜLEÇSOY BOYA");
  await userEvent.click(screen.getByTestId("guided-next"));
  expect(screen.getByTestId("guided-step-musteri")).toBeInTheDocument();
  await userEvent.click(screen.getByTestId("guided-skip"));
  expect(screen.getByTestId("guided-step-partiNo")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Kelime ara"), "P26");
  await userEvent.click(screen.getByTestId("teach-word-6"));
}

describe("rehberli tanıtma sayfası", () => {
  it("değere dokun → önizleme kendiliğinden → Okunan; Bitir'de ad başlıktan; benzer yoksa tek tıkla yeni tip", async () => {
    await tapPartiNo();
    expect(await screen.findByTestId("guided-readout-ok")).toHaveTextContent("Okunan: P2618733");
    expect(api.suggestTemplate).toHaveBeenCalledTimes(1);
    expect(api.suggestTemplate.mock.calls[0]![0]).toMatchObject({ scanId: "s1", assignments: [{ field: "partiNo", rect: { x: 200, y: 300 } }] });
    await userEvent.click(screen.getByTestId("guided-chip-8"));
    expect(screen.getByTestId("guided-name")).toHaveValue("GÜLEÇSOY BOYA");
    await userEvent.click(screen.getByTestId("teach-save"));
    await waitFor(() => expect(api.createUserTemplate).toHaveBeenCalledTimes(1));
    expect(api.createUserTemplate.mock.calls[0]![0]).toMatchObject({ name: "GÜLEÇSOY BOYA", template: { id: "u-gulecsoy" } });
    expect(api.suggestTemplate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(navigateActive).toHaveBeenCalledWith("/operations/gelen-belgeler/n1"));
  });

  it("okunamayan değer: 'Okunamadı' + Etiketi değiştir alanı boşaltır", async () => {
    api.suggestTemplate.mockResolvedValue(okResult({ preview: { matched: true, score: 1, fields: { partiNo: null }, lineCount: 4, warnings: [] } }));
    await tapPartiNo();
    expect(await screen.findByTestId("guided-readout-fail")).toHaveTextContent("Okunamadı");
    await userEvent.click(screen.getByTestId("guided-relabel"));
    expect(screen.getByTestId("guided-step-partiNo")).toHaveTextContent("Henüz dokunulmadı.");
  });

  it("benzer şablon: Yeni tip → POST; Aynı tip → o şablon base ile önizlenip sürümlü PUT", async () => {
    api.suggestTemplate.mockResolvedValue(okResult({ benzerSablonlar: [{ kod: "u-a", ad: "A Boya", skor: 0.9 }] }));
    await tapPartiNo();
    await screen.findByTestId("guided-readout-ok");
    await userEvent.click(screen.getByTestId("teach-save"));
    expect(await screen.findByTestId("teach-similar")).toHaveTextContent("“A Boya” tipine benziyor");
    expect(api.createUserTemplate).not.toHaveBeenCalled();
    api.getUserTemplate.mockResolvedValue({ id: "t1", code: "u-a", name: "A Boya", version: 4, isActive: true, updatedAt: "", versions: [], template: { identifiers: { keywords: ["A BOYA SAN"] } } });
    api.suggestTemplate.mockResolvedValue(okResult({ template: { id: "u-a", merged: true } }));
    await userEvent.click(screen.getByTestId("teach-similar-same-u-a"));
    await waitFor(() => expect(api.updateUserTemplate).toHaveBeenCalledTimes(1));
    const last = api.suggestTemplate.mock.calls.at(-1)![0];
    expect(last.base).toEqual({ code: "u-a", keep: [] });
    expect(last.identifiers).toContain("A BOYA SAN");
    expect(api.updateUserTemplate.mock.calls[0]).toEqual(["u-a", { expectedVersion: 4, template: { id: "u-a", merged: true }, name: "A Boya" }]);
    expect(api.createUserTemplate).not.toHaveBeenCalled();
  });

  it("benzer şablon: Yeni tip olarak kaydet → POST", async () => {
    api.suggestTemplate.mockResolvedValue(okResult({ benzerSablonlar: [{ kod: "u-a", ad: "A Boya", skor: 0.9 }] }));
    await tapPartiNo();
    await screen.findByTestId("guided-readout-ok");
    await userEvent.click(screen.getByTestId("teach-save"));
    await userEvent.click(await screen.findByTestId("teach-similar-new"));
    await waitFor(() => expect(api.createUserTemplate).toHaveBeenCalledTimes(1));
    expect(api.updateUserTemplate).not.toHaveBeenCalled();
  });
});
