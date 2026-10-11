// Alarm Sorumluları ekranı: hol × vardiya ızgarası, alarmı göremeyen kişi uyarısı, "+" kişi seçiciyi DOĞRUDAN açar
// ve seçim yaratma ucuna deneme token'ıyla gider, kaldırma onaydan geçer, sunucu "kapalı" derse kapalı cümlesi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { DutyOverview } from "./types";

const overview = vi.fn<() => Promise<DutyOverview>>();
const createResponsible = vi.fn();
const revoke = vi.fn();
const createRule = vi.fn();

vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("./service", () => ({
  loomAlarmDutyService: {
    overview: () => overview(),
    options: () => Promise.resolve({ halls: [{ id: "h1", name: "Hol A" }], shifts: [{ id: "s1", code: "V1", name: "Sabah" }, { id: "s2", code: "V2", name: "Akşam" }], permissions: [{ code: "loom:alarm-view", description: "Tezgah alarmlarını görme" }] }),
    candidates: () => Promise.resolve([
      { id: "u1", name: "Ali Usta", canViewAlarms: true, canEscalate: false },
      { id: "u2", name: "Veli Göremez", canViewAlarms: false, canEscalate: false },
    ]),
    shiftInstances: () => Promise.resolve([]),
    createResponsible: (...a: unknown[]) => createResponsible(...a),
    createRule: (...a: unknown[]) => createRule(...a),
    revoke: (...a: unknown[]) => revoke(...a),
  },
}));

import { LoomAlarmDutyPage } from "./LoomAlarmDutyPage";

const base: DutyOverview = {
  responsibles: [{ id: "r1", tier: 1, createdAt: "", station: { id: "h1", name: "Hol A" }, shiftDefinition: { id: "s1", code: "V1", name: "Sabah" }, user: { id: "u2", name: "Veli Göremez", canViewAlarms: false } }],
  overrides: [],
  rules: [],
  warnings: ["Veli Göremez alarmları göremiyor — bildirim gitmez."],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><LoomAlarmDutyPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  overview.mockReset();
  createResponsible.mockReset();
  revoke.mockReset();
  createRule.mockReset();
});

describe("LoomAlarmDutyPage", () => {
  it("ızgara: hol satırı, vardiya sütunları, kademe başına kişi; uyarı şeridi", async () => {
    overview.mockResolvedValue(base);
    renderPage();
    expect(await screen.findByText("Hol A")).toBeTruthy();
    expect(await screen.findByText("Akşam")).toBeTruthy();
    expect(screen.getAllByText("Veli Göremez").length).toBeGreaterThan(0);
    expect(screen.getByText(/bildirim gitmez\./)).toBeTruthy();
    expect(screen.getAllByText(/Kural yok — holün vardiya sorumlusuna/)).toHaveLength(2);
  });

  it("'+' seçiciyi doğrudan açar; seçim deneme token'ıyla yaratma ucuna gider", async () => {
    overview.mockResolvedValue(base);
    createResponsible.mockResolvedValue({ success: true, data: {}, message: "Sorumlu atandı." });
    renderPage();
    await screen.findByText("Akşam");
    fireEvent.click(screen.getAllByLabelText("Kademe 2 sorumlusu ekle")[1]!);
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Kademe 2 sorumlusu seç")).toBeTruthy();
    expect(within(dlg).getByText(/bildirim gitmez/)).toBeTruthy();
    fireEvent.click(within(dlg).getByText("Ali Usta"));
    await waitFor(() => expect(createResponsible).toHaveBeenCalledTimes(1));
    const [body, token] = createResponsible.mock.calls[0] ?? [];
    expect(body).toEqual({ stationId: "h1", shiftDefinitionId: "s2", tier: 2, userId: "u1" });
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("kaldırma onay penceresinde kaydı adıyla gösterir; onaydan sonra uç çağrılır", async () => {
    overview.mockResolvedValue(base);
    revoke.mockResolvedValue({ success: true, data: { id: "r1" }, message: "Kaldırıldı." });
    renderPage();
    fireEvent.click(await screen.findByLabelText("Veli Göremez sorumluluğunu kaldır"));
    expect(await screen.findByText(/Hol A · Sabah · Kademe 1: Veli Göremez/)).toBeTruthy();
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kaldır" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("responsibles", "r1"));
  });

  it("yetki kuralı: katalogdan yetki seçilir, gövde yalnız yetki kodunu taşır", async () => {
    overview.mockResolvedValue(base);
    createRule.mockResolvedValue({ success: true, data: {}, message: "Kademe kuralı eklendi." });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Kural$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Belirli yetkiye sahip herkes" }));
    fireEvent.click(screen.getByRole("button", { name: /Yetki seç/ }));
    fireEvent.click(await screen.findByText("Tezgah alarmlarını görme"));
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
    expect(createRule.mock.calls[0]?.[0]).toEqual({ tier: 1, kind: "PERMISSION", userId: null, permissionCode: "loom:alarm-view" });
  });

  it("alarm bayrağı kapalı (403 LOOM_ALARM_DISABLED) → yetki hatası değil 'kapalı' cümlesi", async () => {
    overview.mockRejectedValue({ response: { status: 403, data: { details: { code: "LOOM_ALARM_DISABLED" } } } });
    renderPage();
    await waitFor(() => expect(screen.queryByText("Yükleniyor…")).toBeNull());
    expect(screen.queryByText("Hol A")).toBeNull();
    expect(screen.queryByText(/Okunamadı/)).toBeNull();
  });
});
