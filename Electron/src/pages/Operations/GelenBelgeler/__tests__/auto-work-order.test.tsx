// Onaydan sonra otomatik iş emri (`gelenBelge.autoWorkOrder`): ayar anahtarı (varsayılan kapalı, yalnız değişen alan
// gönderilir) + onay sonucu bildirimi ("2 iş emri açıldı, 1 grup elle açılmalı"); alan yoksa diyalog bugünkü gibi.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { summarizeAutoWorkOrders } from "../approveFlow";
import { ApproveDialog } from "../ApproveDialog";
import { IncomingDocumentSettingsSection } from "@/pages/GeneralSettings/GelenBelgeSettingsSection";
import type { AutoWorkOrderResult } from "../types";

const approveNote = vi.fn();
const getSettings = vi.fn();
const updateSettings = vi.fn();
// Ayar bölümünün `@/pages/.../service` içe aktarımı da aynı modüldür — tek mock ikisini karşılar.
vi.mock("../service", () => ({
  approveNote: (...a: unknown[]) => approveNote(...a),
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  getSuggestions: () => Promise.resolve({ noteId: "n1", lines: [] }),
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

const RESULT: AutoWorkOrderResult = {
  opened: 2, manual: 1, reason: null,
  groups: [
    { key: "a", itemName: "Perde", targets: ["Desen Q10"], rollCount: 3, outcome: "OPENED", workOrderNumber: "IE0211260001", attached: 3 },
    { key: "b", itemName: "Perde", targets: ["Desen Q11"], rollCount: 2, outcome: "OPENED", workOrderNumber: "IE0211260002", attached: 2 },
    { key: "c", itemName: "Perde", targets: [], rollCount: 1, outcome: "SKIPPED", reason: "İşlem değeri (desen/gramaj) çözülemedi; grup elle açılmalı." },
  ],
};

describe("summarizeAutoWorkOrders", () => {
  it("alan yoksa (ayar kapalı / eski backend) null", () => {
    expect(summarizeAutoWorkOrders(undefined)).toBeNull();
  });
  it("⭐ başlık 'N iş emri açıldı, M grup elle açılmalı' + grup başına İE no / neden", () => {
    const s = summarizeAutoWorkOrders(RESULT)!;
    expect(s.title).toBe("2 iş emri açıldı, 1 grup elle açılmalı.");
    expect(s.tone).toBe("warn");
    expect(s.lines.map((l) => l.text)).toEqual([
      "Perde · Desen Q10 (3 top): IE0211260001 açıldı, 3 top bağlandı",
      "Perde · Desen Q11 (2 top): IE0211260002 açıldı, 2 top bağlandı",
      "Perde · desensiz (1 top): elle açılmalı — İşlem değeri (desen/gramaj) çözülemedi; grup elle açılmalı.",
    ]);
  });
  it("genel neden (izin yok) tek cümlede, grup satırı tekrarlanmaz", () => {
    const s = summarizeAutoWorkOrders({ opened: 0, manual: 2, reason: "Onaylayanın iş emri açma yetkisi yok", groups: RESULT.groups.slice(0, 2).map((g) => ({ ...g, outcome: "SKIPPED" as const })) })!;
    expect(s.title).toBe("2 grup elle açılmalı — Onaylayanın iş emri açma yetkisi yok.");
    expect(s.lines).toEqual([]);
  });
});

describe("ApproveDialog otomatik iş emri sonucu", () => {
  beforeEach(() => {
    approveNote.mockReset();
    getSettings.mockReset().mockResolvedValue({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN" });
  });
  const ok = (extra: object) => ({ warnings: [], result: { note: { status: "APPROVED", lines: [] }, summary: { entered: 6, failed: 0, skipped: 0, replayed: 0, rollIds: [] }, ...extra } });
  it("⭐ sonuç diyaloğu açılan/elle grupları gösterir", async () => {
    approveNote.mockResolvedValueOnce(ok({ autoWorkOrders: RESULT }));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    const box = await screen.findByTestId("approve-auto-wo");
    expect(box).toHaveTextContent("2 iş emri açıldı, 1 grup elle açılmalı.");
    expect(box).toHaveTextContent("IE0211260001 açıldı");
    expect(box).toHaveTextContent("elle açılmalı — İşlem değeri");
  });
  it("alan yoksa blok çizilmez (bugünkü diyalog)", async () => {
    approveNote.mockResolvedValueOnce(ok({}));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await screen.findByTestId("approve-result");
    expect(screen.queryByTestId("approve-auto-wo")).toBeNull();
  });
});

describe("Genel Ayarlar → Gelen Belge: otomatik iş emri anahtarı", () => {
  beforeEach(() => {
    updateSettings.mockReset();
    getSettings.mockReset();
  });
  it("⭐ eski backend alanı göndermez → kapalı; açıp kaydedince YALNIZ autoWorkOrder gider", async () => {
    getSettings.mockResolvedValue({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN" });
    updateSettings.mockResolvedValue({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: true });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    const sw = await screen.findByRole("switch", { name: "Onaydan sonra iş emrini otomatik aç" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("gb-auto-work-order")).toHaveTextContent("Varsayılan: KAPALI");
    await userEvent.click(sw);
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toEqual({ autoWorkOrder: true });
  });
  it("sunucu açık derse anahtar açık gelir", async () => {
    getSettings.mockResolvedValue({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: true });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    const sw = await screen.findByRole("switch", { name: "Onaydan sonra iş emrini otomatik aç" });
    expect(sw).toHaveAttribute("aria-checked", "true");
  });
});
