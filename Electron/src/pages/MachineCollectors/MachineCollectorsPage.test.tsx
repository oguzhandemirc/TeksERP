// Makine Kartları ekranı: liste, kayıt → sır BİR KEZ gösterilir (pencere kapanınca DOM'da ve sorgu/mutasyon
// önbelleğinde yok), sır yenileme onaydan geçer, iptal önizlemesi SUNUCU ucundan etkilenen her kaydı listeler,
// kayıt deneme başına clientToken taşır ve replay'de (secretWithheld) sır gösterilmez → sır yenileme onayı açılır, K4 şeridi.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { CollectorRevokePreview, MachineCollector } from "./types";

const SECRET = "ab".repeat(32);
const list = vi.fn<() => Promise<MachineCollector[]>>();
const revokePreview = vi.fn<(id: string) => Promise<CollectorRevokePreview>>();
const create = vi.fn();
const rotateSecret = vi.fn();
const revoke = vi.fn();
const flags = { tezgahAlarmEnabled: true, tezgahAlarmUnclassifiedEnabled: false };

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const warning = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: (...a: unknown[]) => warning(...a) } }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: flags } }) }));
vi.mock("./CollectorFormDialog", () => ({
  CollectorFormDialog: ({ open, onSubmit }: { open: boolean; onSubmit: (v: unknown) => void }) =>
    open ? <button onClick={() => onSubmit({ name: "Pano 2", collectorType: "TEKS-ESP32-V1", machineIds: ["m2"] })}>formu gönder</button> : null,
}));
vi.mock("./service", () => ({
  machineCollectorService: {
    list: () => list(),
    revokePreview: (id: string) => revokePreview(id),
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
  [list, revokePreview, create, rotateSecret, revoke, warning].forEach((f) => f.mockReset());
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
    expect(create).toHaveBeenCalledWith({ name: "Pano 2", collectorType: "TEKS-ESP32-V1", machineIds: ["m2"], clientToken: expect.stringMatching(/^[0-9a-f-]{36}$/) });
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

});

describe("MachineCollectorsPage — kayıt tekrarı ve iptal önizlemesi", () => {
  it("kayıt: belirsiz hatada token yapışır, kesin 4xx'te yenilenir", async () => {
    list.mockResolvedValue([]);
    create.mockRejectedValueOnce(new Error("Network Error")).mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValue({ collector: row({ id: "c2", name: "Pano 2" }), secret: SECRET });
    renderPage();
    fireEvent.click(await screen.findByText("Yeni kart"));
    fireEvent.click(screen.getByText("formu gönder"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByText("formu gönder"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByText("formu gönder"));
    await screen.findByTestId("collector-secret");
    const t = create.mock.calls.map((c) => (c[0] as { clientToken: string }).clientToken);
    expect(t[1]).toBe(t[0]);
    expect(t[2]).not.toBe(t[1]);
  });

  it("kayıt replay'i: sır gösterilmez, uyarı + sır yenileme onayı açılır", async () => {
    list.mockResolvedValue([]);
    create.mockResolvedValue({ collector: row({ id: "c2", name: "Pano 2" }), secret: null, secretWithheld: true });
    renderPage();
    fireEvent.click(await screen.findByText("Yeni kart"));
    fireEvent.click(screen.getByText("formu gönder"));
    expect(await screen.findByText("Kart sırrı yenilensin mi?")).toBeTruthy();
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/sırrı yenileyin/));
    expect(screen.queryByTestId("collector-secret")).toBeNull();
    expect(rotateSecret).not.toHaveBeenCalled();
  });

  it("iptal: sunucu önizlemesi tezgahları, açık duruşları ve bekleyen geç kapanışları listeler, onaydan sonra iptal eder", async () => {
    list.mockResolvedValue([row()]);
    const stop = { machineId: "m3", machineCode: "T-03", machineName: "Tezgah 3", startedAt: "2026-10-13T08:30:00Z", rawStopCode: "E-17", reasonCode: null };
    revokePreview.mockResolvedValue({
      collector: row(), revocable: true, block: null,
      machines: [{ machineId: "m1", machineCode: "T-01", machineName: "Tezgah 1" }, { machineId: "m3", machineCode: "T-03", machineName: "Tezgah 3" }],
      openStops: [{ ...stop, stopId: "s1" }],
      pendingEnds: [{ ...stop, stopId: "s2", machineCode: "T-01", endedAt: "2026-10-13T09:00:00Z", lateEndedAt: null }],
    });
    revoke.mockResolvedValue(row({ revokedAt: "2026-10-13T09:00:00Z", machines: [] }));
    renderPage();
    fireEvent.click(await screen.findByTitle("Kartı iptal et"));
    const ul = await screen.findByTestId("revoke-machines");
    expect(within(ul).getByText("T-03")).toBeTruthy();
    expect(within(screen.getByTestId("revoke-open-stops")).getByText(/E-17/)).toBeTruthy();
    expect(within(screen.getByTestId("revoke-pending-ends")).getByText(/artık gelmeyecek/)).toBeTruthy();
    expect(revokePreview).toHaveBeenCalledWith("c1");
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Kartı iptal et" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("c1"));
  });

  it("iptal: önizleme engel dönerse (zaten iptal) onay düğmesi pasif", async () => {
    list.mockResolvedValue([row()]);
    revokePreview.mockResolvedValue({ collector: row(), revocable: false, block: { code: "COLLECTOR_REVOKED", message: "Kart zaten iptal edilmiş." }, machines: [], openStops: [], pendingEnds: [] });
    renderPage();
    fireEvent.click(await screen.findByTitle("Kartı iptal et"));
    expect(await screen.findByText("Kart zaten iptal edilmiş.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Kartı iptal et" }) as HTMLButtonElement).disabled).toBe(true);
  });

});

describe("MachineCollectorsPage — iptal edilmiş kart", () => {
  it("iptal edilmiş kartta eylem düğmesi yok", async () => {
    list.mockResolvedValue([row({ revokedAt: "2026-10-13T09:00:00Z", machines: [] })]);
    renderPage();
    expect(await screen.findByText("İptal")).toBeTruthy();
    expect(screen.queryByTitle("Sırrı yenile")).toBeNull();
  });
});
