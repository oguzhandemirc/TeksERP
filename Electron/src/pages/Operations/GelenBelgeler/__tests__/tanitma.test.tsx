// S1b belge tipi tanıtma: kutu seçimi → alan ataması → öneri gövdesi (OCR çerçevesi), kimlik (öneri hazır seçili), tekrar eden bölüm,
// önizleme ve kaydet (yeni POST + clientToken | güncelle PUT expectedVersion + birleşim), tanınmadı şeridi, Gönderen Şablonları düzenle.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import {
  assignColumn, assignField, initialTeach, keptOldFields, oldParts, setRepeats, toggleKeepOld, suggestBody, suggestIdentifiers, teachProblems, toggleWord, wordAt,
} from "../tanit/teachDraft";
import { fromScreen, toScreen, type Rotation } from "../scanView";
import { isUnrecognized } from "../tanit/teachScans";
import { TEACH_ROUTE, teachPath } from "../paths";
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
const { UnknownTypeStrip } = await import("../tanit/TeachEntry");

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
const W = SCAN.words;

beforeEach(() => {
  perms.list = ["gelen-belge:read", "gelen-belge:template"];
  nav.search = "";
  note.data.templateId = null;
  navigateActive.mockReset();
  for (const f of Object.values(api)) f.mockReset();
  api.getScanWords.mockResolvedValue(SCAN);
  api.suggestTemplate.mockResolvedValue({ template: { id: "u-gulecsoy", fields: [{ key: "partiNo" }], identifiers: { keywords: ["GÜLEÇSOY BOYA"] } }, explain: [{ field: "partiNo", strategy: "anchor", label: "Ham PartiNo", direction: "right" }], errors: [], preview: { matched: true, score: 1, fields: { partiNo: "P2618733" }, lineCount: 4, warnings: [] } });
  api.createUserTemplate.mockResolvedValue({ code: "u-gulecsoy", name: "Güleçsoy", version: 1 });
  api.updateUserTemplate.mockResolvedValue({ code: "u-gulecsoy", name: "Güleçsoy", version: 3 });
});

describe("tanıtma çekirdeği (saf)", () => {
  it("dokunulan nokta fotoğraf çerçevesindeki kelimeyi bulur; boşluk null", () => {
    expect(wordAt(W, { x: 1210, y: 2310 })).toBe(6);
    expect(wordAt(W, { x: 10, y: 10 })).toBeNull();
  });

  it("fromScreen toScreen'in tersidir (dört yönelim)", () => {
    const nat = { w: 800, h: 1200 };
    for (const rot of [0, 90, 180, 270] as Rotation[]) {
      const v = { scale: 0.7, tx: 13, ty: -40, rot };
      const p = fromScreen(v, nat, toScreen(v, nat, { x: 123, y: 456 }));
      expect(p.x).toBeCloseTo(123);
      expect(p.y).toBeCloseTo(456);
    }
  });

  it("kimlik önerisi üst bölgedeki yazı satırları, hazır seçili; rakam satırı ve alt bölge dışarıda", () => {
    expect(suggestIdentifiers(SCAN)).toEqual(["GÜLEÇSOY BOYA", "ÇEKİ LİSTESİ", "Ham PartiNo: P2618733"]);
    const s = initialTeach(SCAN, "Güleçsoy");
    expect(s.identifiers.every((d) => d.on)).toBe(true);
  });

  it("kutu atama → öneri gövdesi: alan + OCR çerçevesinde kutu; değeri içeren kimlik kapanır; sütun başlığı kimlik olur", () => {
    let s = initialTeach(SCAN, "Güleçsoy");
    s = assignField(toggleWord(s, 6), W, "partiNo");
    s = assignColumn(toggleWord(s, 7), W, "m");
    const b = suggestBody(s, W, "s1");
    expect(b.assignments).toEqual([{ field: "partiNo", rect: { x: 200, y: 300, width: 90, height: 20 } }]);
    expect(b.identifiers).toEqual(["GÜLEÇSOY BOYA", "ÇEKİ LİSTESİ", "Metre"]);
    expect(b.table).toEqual({ columns: [{ key: "m", header: "Metre" }], totalsLabel: null });
    expect(b.sectionStartLabel).toBeUndefined();
  });

  it("tekrar eden bölüm: başlangıç etiketi + parti künyesi alanı bölüm başına", () => {
    let s = assignField(toggleWord(initialTeach(SCAN, "G"), 6), W, "partiNo");
    s = setRepeats(s, true);
    expect(teachProblems({ ...s, name: "Güleçsoy" })).toEqual(["Tekrar eden bölümün başlangıç yazısını seçin.", "Tekrar eden bölümde top tablosu gerekli: tablonun Metre sütun başlığını işaretleyin."]);
    s = { ...s, name: "Güleçsoy", sectionStart: "Ham PartiNo" };
    const b = suggestBody(s, W, "s1");
    expect(b.assignments[0]).toMatchObject({ field: "partiNo", section: true });
    expect(b.sectionStartLabel).toBe("Ham PartiNo");
  });

  it("güncelle kipi: gövde base taşır; eski tablo/bölüm varsayılan korunur, kutu kaldırılınca keep'ten düşer (s1b inceleme)", () => {
    const old = { fields: [{ key: "partiNo", label: "Parti No" }, { key: "tarih", label: "Tarih" }], tables: [{ key: "toplar" }], sections: { startLabels: ["Ham PartiNo"], fields: ["partiNo"] } };
    expect(oldParts(old)).toEqual(["tables", "sections"]);
    expect(oldParts({ fields: [] })).toEqual([]);
    let s = { ...assignField(toggleWord(initialTeach(SCAN, "G", [], { keepOld: oldParts(old) }), 6), W, "partiNo"), name: "Güleçsoy" };
    expect(suggestBody(s, W, "s1", "u-x").base).toEqual({ code: "u-x", keep: ["tables", "sections"] });
    s = toggleKeepOld(s, "sections");
    expect(suggestBody(s, W, "s1", "u-x").base).toEqual({ code: "u-x", keep: ["tables"] });
    expect(suggestBody(s, W, "s1").base).toBeUndefined();
    expect(keptOldFields(old, s)).toEqual(["Tarih"]);
  });

  it("tanınmadı = şablon bağı yok + okunmuş fotoğraf; yol sabiti", () => {
    expect(isUnrecognized({ templateId: null, scans: [{ status: "READ", mimeType: "image/jpeg" }] })).toBe(true);
    expect(isUnrecognized({ templateId: "t1", scans: [{ status: "READ", mimeType: "image/jpeg" }] })).toBe(false);
    expect(isUnrecognized({ templateId: null, scans: [{ status: "PENDING", mimeType: "image/jpeg" }] })).toBe(false);
    expect(teachPath("n1", "u-a")).toBe("/operations/gelen-belgeler/n1/tanit?sablon=u-a");
    expect(TEACH_ROUTE).toBe("/operations/gelen-belgeler/:id/tanit");
  });
});

async function markPartiNo() {
  await userEvent.type(await screen.findByLabelText("Kelime ara"), "P26");
  await userEvent.click(screen.getByTestId("teach-word-6"));
  await userEvent.click(screen.getByTestId("teach-field-partiNo"));
}

describe("tanıtma sayfası", () => {
  it("kelime seç → alan ata → önizle → kaydet (yeni tip, clientToken)", async () => {
    renderWithProviders(<TeachTemplatePage />);
    await userEvent.click(await screen.findByTestId("teach-mode-advanced"));
    await userEvent.clear(screen.getByTestId("teach-name"));
    await userEvent.type(screen.getByTestId("teach-name"), "Güleçsoy");
    await markPartiNo();
    expect(screen.getByTestId("teach-assigned-f-partiNo")).toHaveTextContent("P2618733");
    await userEvent.click(screen.getByTestId("teach-preview-run"));
    await waitFor(() => expect(api.suggestTemplate).toHaveBeenCalledTimes(1));
    const body = api.suggestTemplate.mock.calls[0]![0];
    // Önizleme sabit geçici adla koşar (ad yazarken istek atılmaz); gerçek ad yalnız kayıtta gider.
    expect(body).toMatchObject({ scanId: "s1", name: "Yeni belge tipi", assignments: [{ field: "partiNo", rect: { x: 200, y: 300 } }] });
    expect(body.identifiers).toContain("GÜLEÇSOY BOYA");
    expect(await screen.findByTestId("teach-preview-match")).toHaveTextContent("tanınıyor");
    expect(screen.getByTestId("teach-preview-explain")).toHaveTextContent('Parti No ← "Ham PartiNo" sağında');
    await userEvent.click(screen.getByTestId("teach-save"));
    await waitFor(() => expect(api.createUserTemplate).toHaveBeenCalledTimes(1));
    const saved = api.createUserTemplate.mock.calls[0]![0];
    expect(saved).toMatchObject({ name: "Güleçsoy", template: { id: "u-gulecsoy" } });
    expect(saved.clientToken).toMatch(/[0-9a-f-]{36}/);
    await waitFor(() => expect(navigateActive).toHaveBeenCalledWith("/operations/gelen-belgeler/n1"));
  });

  it("önizlemeden sonra işaretleme değişirse önizleme bayat görünür; kaydet tek tıkla önce tazeler (K30-T)", async () => {
    renderWithProviders(<TeachTemplatePage />);
    await userEvent.click(await screen.findByTestId("teach-mode-advanced"));
    await userEvent.clear(screen.getByTestId("teach-name"));
    await userEvent.type(screen.getByTestId("teach-name"), "Güleçsoy");
    await markPartiNo();
    await userEvent.click(screen.getByTestId("teach-preview-run"));
    await waitFor(() => expect(api.suggestTemplate).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByLabelText("Kimlik: ÇEKİ LİSTESİ"));
    expect(await screen.findByTestId("teach-preview-stale")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("teach-save"));
    await waitFor(() => expect(api.createUserTemplate).toHaveBeenCalledTimes(1));
    expect(api.suggestTemplate).toHaveBeenCalledTimes(2);
    expect(api.suggestTemplate.mock.calls[1]![0].identifiers).not.toContain("ÇEKİ LİSTESİ");
  });

  it("şablonu güncelle: eski kimlikler hazır seçili, önizleme base ile birleşik, PUT önizlenen şablonu aynen gönderir", async () => {
    nav.search = "sablon=u-gulecsoy";
    api.getUserTemplate.mockResolvedValue({ id: "t9", code: "u-gulecsoy", name: "Güleçsoy", version: 2, isActive: true, updatedAt: "", versions: [], template: { fields: [{ key: "tarih", label: "Tarih" }], sections: { startLabels: ["X"], fields: ["tarih"] }, identifiers: { keywords: ["ESKİ KİMLİK"] } } });
    const merged = { id: "u-gulecsoy", fields: [{ key: "partiNo" }, { key: "tarih" }], identifiers: { keywords: ["ESKİ KİMLİK"] } };
    api.suggestTemplate.mockResolvedValue({ template: merged, explain: [], errors: [], preview: { matched: true, score: 1, fields: { partiNo: "P2618733" }, lineCount: 4, warnings: [] } });
    renderWithProviders(<TeachTemplatePage />);
    await userEvent.click(await screen.findByTestId("teach-mode-advanced"));
    expect(await screen.findByLabelText("Kimlik: ESKİ KİMLİK")).toBeChecked();
    expect(screen.getByTestId("teach-keep-old-fields")).toHaveTextContent("Tarih");
    expect(screen.getByLabelText("Eski Tekrar eden bölüm korunsun")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Eski Tekrar eden bölüm korunsun"));
    await markPartiNo();
    await userEvent.click(screen.getByTestId("teach-preview-run"));
    await waitFor(() => expect(api.suggestTemplate).toHaveBeenCalledTimes(1));
    expect(api.suggestTemplate.mock.calls[0]![0].base).toEqual({ code: "u-gulecsoy", keep: [] });
    await waitFor(() => expect(screen.getByTestId("teach-save")).toBeEnabled());
    await userEvent.click(screen.getByTestId("teach-save"));
    await waitFor(() => expect(api.updateUserTemplate).toHaveBeenCalledTimes(1));
    const [code, b] = api.updateUserTemplate.mock.calls[0]!;
    expect(code).toBe("u-gulecsoy");
    expect(b.expectedVersion).toBe(2);
    expect(b.template).toEqual(merged);
    expect(api.createUserTemplate).not.toHaveBeenCalled();
  });
});

describe("belge tanınmadı şeridi", () => {
  it("Listeden seç → o şablonu güncelle; Yeni tip tanıt → tanıtma", async () => {
    api.listUserTemplates.mockResolvedValue([{ code: "u-a", name: "A tipi", version: 1, isActive: true }, { code: "u-p", name: "Pasif", version: 1, isActive: false }]);
    const go = vi.fn();
    renderWithProviders(<UnknownTypeStrip note={note.data} go={go} />);
    await userEvent.click(screen.getByTestId("teach-unknown-choose"));
    const dlg = await screen.findByTestId("teach-type-dialog");
    expect(within(dlg).queryByText("Pasif")).toBeNull();
    await userEvent.click(await within(dlg).findByTestId("teach-type-u-a"));
    expect(go).toHaveBeenCalledWith("/operations/gelen-belgeler/n1/tanit?sablon=u-a");
    await userEvent.click(within(dlg).getByTestId("teach-type-new"));
    expect(go).toHaveBeenLastCalledWith("/operations/gelen-belgeler/n1/tanit");
  });

  it("izinsiz ya da tanınmış belgede çizilmez", () => {
    perms.list = ["gelen-belge:read"];
    const { container } = renderWithProviders(<UnknownTypeStrip note={note.data} go={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
