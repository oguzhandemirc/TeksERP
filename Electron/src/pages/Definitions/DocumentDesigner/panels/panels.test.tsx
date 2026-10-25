import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { applySettingsPatch } from "../binding/docSettings";
import { DEFAULT_PAGE_SETTINGS } from "../binding/pageSettings";
import { loadFixture } from "../binding/testContract";
import type { DesignerDraft } from "../useDesignerDraft";
import { nodeHtml } from "./DataTreePanel";
import { DocumentSettingsPanel } from "./DocumentSettingsPanel";
import { PageSettingsPanel } from "./PageSettingsPanel";

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasAnyPermission: () => true }) }));

const { contract, settings } = loadFixture();

function draftStub(over: Partial<DesignerDraft> = {}): DesignerDraft {
  return { docType: "SHIPMENT_DISPATCH", contract, settings, internalFields: [], languageWarnings: [], patchSettings: vi.fn(), touch: vi.fn(), ...over } as unknown as DesignerDraft;
}

describe("Belge ayarları paneli", () => {
  it("dil kilitli gösterilir, dil seçici yok; imza anahtarı settings'i değiştirir", () => {
    const draft = draftStub();
    render(<DocumentSettingsPanel draft={draft} />);
    const lock = screen.getByTestId("dil-kilidi");
    expect(within(lock).getByText("Türkçe")).toBeTruthy();
    expect(within(lock).getByText(/EN yalnız Sistem şablonunda/)).toBeTruthy();
    expect(screen.queryByRole("option", { name: "İngilizce" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "İmza kutularını bas" }));
    expect(draft.patchSettings).toHaveBeenCalledWith({ showSignatures: !settings.showSignatures });
    const patched = applySettingsPatch({ ...settings, language: "tr" }, { showSignatures: false, language: "en" });
    expect(patched.language).toBe("tr");
    expect(patched.showSignatures).toBe(false);
  });
  it("stil ayarları şablona taşındı notuyla salt-okunur", () => {
    render(<DocumentSettingsPanel draft={draftStub()} />);
    expect(screen.getByText(/Stil ayarları şablona taşındı/)).toBeTruthy();
  });
});

describe("Sayfa ayarı paneli", () => {
  it("kenar 0–50 mm'ye kısılır; alt bilgide sol kutu yok", () => {
    const onChange = vi.fn();
    render(<PageSettingsPanel value={DEFAULT_PAGE_SETTINGS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Üst kenar"), { target: { value: "80" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ kenar: { ...DEFAULT_PAGE_SETTINGS.kenar, ust: 50 } }));
    expect(screen.getByText(/Sol-alt köşe belge künyesine ayrılmıştır/)).toBeTruthy();
  });
  it("sayfa no konumu ile çakışan alt bilgi uyarı verir", () => {
    render(<PageSettingsPanel value={{ ...DEFAULT_PAGE_SETTINGS, altBilgi: { orta: "", sag: "x" }, sayfaNo: { konum: "alt-sag", bicim: "{n}" } }} onChange={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toMatch(/sağ-altta/);
  });
});

describe("veri ağacı düğümü", () => {
  it("kök alan → Veri alanı, tablo → Kalem tablosu, kolon bırakılmaz", () => {
    const d = { contract, internalFields: [] };
    const f = contract.kokler.find((x) => x.yol === "belge.tarih")!;
    expect(nodeHtml({ id: "x", label: "", path: "belge.tarih", kind: "field", field: f }, d)).toContain('data-alan="belge.tarih" data-filtre="tarih"');
    expect(nodeHtml({ id: "t", label: "", path: "tablolar.urun", kind: "table", tableKey: "urun" }, d)).toContain('data-each="satir in tablolar.urun"');
    expect(nodeHtml({ id: "c", label: "", path: "tablolar.urun[].ad", kind: "column", tableKey: "urun" }, d)).toBeNull();
  });
});
