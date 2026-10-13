// Makine Kartları ekranı: liste, kayıt → sır BİR KEZ gösterilir (pencere kapanınca DOM'da ve sorgu/mutasyon
// önbelleğinde yok), sır yenileme onaydan geçer, iptal önizlemesi bağlı tezgahları taze okumadan listeler, K4 şeridi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MachineCollector } from "./types";

const SECRET = "ab".repeat(32);
const list = vi.fn<() => Promise<MachineCollector[]>>();
const get = vi.fn<(id: string) => Promise<MachineCollector>>();
const create = vi.fn();
const rotateSecret = vi.fn();
const revoke = vi.fn();
const flags = { tezgahAlarmEnabled: true, tezgahAlarmUnclassifiedEnabled: false };

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: flags } }) }));
vi.mock("./CollectorFormDialog", () => ({
  CollectorFormDialog: ({ open, onSubmit }: { open: boolean; onSubmit: (v: unknown) => void }) =>
    open ? <button onClick={() => onSubmit({ name: "Pano 2", collectorType: "TEKS-ESP32-V1", machineIds: ["m2"] })}>formu gönder</button> : null,
}));
vi.mock("./service", () => ({
  machineCollectorService: {
    list: () => list(),
    get: (id: string) => get(id),
    create: (...a: unknown[]) => create(...a),
    rotateSecret: (...a: unknown[]) => rotateSecret(...a),
    revoke: (...a: unknown[]) => revoke(...a),
  },
}));

import { MachineCollectorsPage } from "./MachineCollectorsPage";

const row = (over: Partial<MachineCollector> = {}): MachineCollector => ({
  id: "c1", name: "Pano 1", collectorType: "TEKS-ESP32-V1", status: "APPROVED", isActive: true,
  secretIssuedAt: "2026-10-13T08:00:00Z", lastSeenAt: null, silentSince: null, revokedAt: null,
  createdAt: "2026-10-13T08:00:00Z", updatedAt: "2026-10-13T08:00:00Z",
  machines: [{ machine: { id: "m1", code: "T-01", name: "Tezgah 1" } }],
  ...over,
});

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><MachineCollectorsPage /></MemoryRouter></QueryClientProvider>);
}

/** Önbelleklerde (sorgu + mutasyon) sır izi var mı — sır yalnız pencerenin yerel state'inde yaşamalı. */
function cacheHasSecret(): boolean {
  const q = qc.getQueryCache().getAll().map((x) => JSON.stringify(x.state.data ?? null));
  const m = qc.getMutationCache().getAll().map((x) => JSON.stringify(x.state.data ?? null));
  return [...q, ...m].some((s) => s.includes(SECRET));
}

beforeEach(() => {
  [list, get, create, rotateSecret, revoke].forEach((f) => f.mockReset());
  flags.tezgahAlarmEnabled = true;
  flags.tezgahAlarmUnclassifiedEnabled = false;
});

describe("MachineCollectorsPage", () => {
  it("liste + K4 şeridi (sebepsiz alarm kapalı)", async () => {
    list.mockResolvedValue([row()]);
    renderPage();
    expect(await screen.findByText("Pano 1")).toBeTruthy();
    expect(screen.getByText("T-01")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Sebepsiz duruşta alarm/);
  });

  it("K4 şeridi ayarlar açıkken çizilmez", async () => {
    flags.tezgahAlarmUnclassifiedEnabled = true;
    list.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/Kayıtlı kart yok/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("kayıt: sır bir kez gösterilir, kapanınca DOM'da ve önbellekte yok", async () => {
    list.mockResolvedValue([]);
    create.mockResolvedValue({ collector: row({ id: "c2", name: "Pano 2" }), secret: SECRET });
    renderPage();
    fireEvent.click(await screen.findByText("Yeni kart"));
    fireEvent.click(screen.getByText("formu gönder"));
    expect((await screen.findByTestId("collector-secret")).textContent).toBe(SECRET);
    expect(create).toHaveBeenCalledWith({ name: "Pano 2", collectorType: "TEKS-ESP32-V1", machineIds: ["m2"] });
    expect(cacheHasSecret()).toBe(false);
    fireEvent.click(screen.getByText(/kapat$/));
    await waitFor(() => expect(screen.queryByTestId("collector-secret")).toBeNull());
    expect(document.body.textContent).not.toContain(SECRET);
    expect(cacheHasSecret()).toBe(false);
  });

  it("sır yenileme onaydan geçer ve yeni sırrı bir kez gösterir", async () => {
    list.mockResolvedValue([row()]);
    rotateSecret.mockResolvedValue({ collector: row(), secret: SECRET });
    renderPage();
    fireEvent.click(await screen.findByTitle("Sırrı yenile"));
    expect(rotateSecret).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sırrı yenile" }));
    expect((await screen.findByTestId("collector-secret")).textContent).toBe(SECRET);
    expect(rotateSecret).toHaveBeenCalledWith("c1");
  });

  it("iptal: önizleme taze okumadaki bağlı tezgahları listeler, onaydan sonra iptal eder", async () => {
    list.mockResolvedValue([row()]);
    get.mockResolvedValue(row({ machines: [{ machine: { id: "m1", code: "T-01", name: "Tezgah 1" } }, { machine: { id: "m3", code: "T-03", name: "Tezgah 3" } }] }));
    revoke.mockResolvedValue(row({ revokedAt: "2026-10-13T09:00:00Z", machines: [] }));
    renderPage();
    fireEvent.click(await screen.findByTitle("Kartı iptal et"));
    const ul = await screen.findByTestId("revoke-machines");
    expect(within(ul).getByText("T-03")).toBeTruthy();
    expect(get).toHaveBeenCalledWith("c1");
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kartı iptal et" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("c1"));
  });

  it("iptal edilmiş kartta eylem düğmesi yok", async () => {
    list.mockResolvedValue([row({ revokedAt: "2026-10-13T09:00:00Z", machines: [] })]);
    renderPage();
    expect(await screen.findByText("İptal")).toBeTruthy();
    expect(screen.queryByTitle("Sırrı yenile")).toBeNull();
  });
});
