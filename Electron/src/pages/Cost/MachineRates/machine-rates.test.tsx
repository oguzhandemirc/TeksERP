// Makine saat ücretleri: liste (ücretli + ücretsiz makine), değiştir diyaloğu (token MANTIKSAL DENEME başına;
// sunucunun 409 cümlesi diyalogda kalır) ve izinsiz görünüm (yazma düğmesi yok, makine listesi sorgusu atılmaz).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import type { MachineCostRate } from "./service";

const svc = vi.hoisted(() => ({ machineOptions: vi.fn(), listActive: vi.fn(), history: vi.fn(), create: vi.fn(), change: vi.fn(), revoke: vi.fn() }));
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), machineRateService: svc }));
const loadMachines = vi.fn();
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: (...a: unknown[]) => loadMachines(...a) }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ onChange, placeholder }: { onChange: (id: string) => void; placeholder: string }) =>
    <button type="button" onClick={() => onChange("m2")}>{placeholder}</button>,
}));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (l: string[]) => l.some((p) => perms.includes(p)),
    hasAllPermissions: (l: string[]) => l.every((p) => perms.includes(p)),
  }),
}));

import { MachineRatesPage, mergeMachineRows } from "./MachineRatesPage";
import { MachineRateDialog } from "./MachineRateDialog";

const rate: MachineCostRate = {
  id: "r1", machineId: "m1", hourRateTry: "250.0000", normMPerHour: "120.00", note: null,
  createdAt: "2026-10-30T09:00:00Z", revokedAt: null, revokeReason: null,
  machine: { id: "m1", code: "TMB-1", name: "Tambur 1", isActive: true },
};
const machines = [{ id: "m1", code: "TMB-1", name: "Tambur 1" }, { id: "m2", code: "BRD-1", name: "Brode 1" }];
const err = (status: number | null, message = "x") =>
  new AxiosError(String(status), "ERR", undefined, undefined,
    status === null ? undefined : ({ status, data: { success: false, message, details: { code: "COST_RATE_STALE" } } } as AxiosResponse));

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  loadMachines.mockReset();
  svc.listActive.mockResolvedValue([rate]);
  svc.machineOptions.mockResolvedValue(machines);
  loadMachines.mockResolvedValue({ data: machines });
});

describe("MachineRatesPage — liste", () => {
  it("ücretli makine ücret/norm ile, ücretsiz makine 'ücret yok' + 'Ücret gir' ile listelenir", async () => {
    perms = ["cost:read", "cost:write", "station:read"];
    renderWithProviders(<MachineRatesPage />);
    expect(await screen.findByText("BRD-1")).toBeInTheDocument();
    expect(screen.getByText("250 TL")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("ücret yok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ücreti değiştir" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ücret gir" }).length).toBe(2); // başlık + ücretsiz satır
  });
  it("birleştirme: koda göre sıralı, ücretli makine tekrar etmez", () => {
    expect(mergeMachineRows([rate], machines).map((r) => [r.machine.code, !!r.rate])).toEqual([["BRD-1", false], ["TMB-1", true]]);
    expect(mergeMachineRows([rate], null)).toHaveLength(1);
  });
});

describe("MachineRatesPage — izinsiz görünüm", () => {
  it("cost:write yok → yazma düğmesi yok; station:read yok → istasyon ucu ATILMAZ, makineler cost:read seçenek ucundan", async () => {
    perms = ["cost:read"];
    renderWithProviders(<MachineRatesPage />);
    expect(await screen.findByText("TMB-1")).toBeInTheDocument();
    expect(await screen.findByText("BRD-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ücreti değiştir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ücret gir" })).toBeNull();
    expect(loadMachines).not.toHaveBeenCalled();
    expect(svc.machineOptions).toHaveBeenCalled();
  });

  it("Muhasebe (cost:read + cost:write, station:read YOK) ücretsiz makineye satırından ücret girer", async () => {
    perms = ["cost:read", "cost:write"];
    svc.create.mockResolvedValue({ success: true, data: rate });
    const user = userEvent.setup();
    renderWithProviders(<MachineRatesPage />);
    await user.click(await screen.findByRole("button", { name: "Ücret gir" }));
    expect(screen.getByText(/BRD-1 —/)).toBeInTheDocument();
    expect(loadMachines).not.toHaveBeenCalled();
  });

  it("station:read varken seçenek ucu çağrılmaz (istasyon ucu kullanılır)", async () => {
    perms = ["cost:read", "station:read"];
    renderWithProviders(<MachineRatesPage />);
    expect(await screen.findByText("BRD-1")).toBeInTheDocument();
    expect(svc.machineOptions).not.toHaveBeenCalled();
  });
});

describe("MachineRateDialog — deneme token'ı ve 409", () => {
  async function submit(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
  }
  it("belirsiz hata (ağ) → ikinci tıklama AYNI token; kesin 409 → sunucu cümlesi görünür ve sonraki tıklama YENİ token", async () => {
    perms = ["cost:read", "cost:write"];
    svc.change
      .mockRejectedValueOnce(err(null))
      .mockRejectedValueOnce(err(409, "Bu saat ücreti aynı anda başka bir işlemle değişti ya da kaldırıldı — listeyi yenileyin."))
      .mockResolvedValueOnce({ success: true, data: rate, message: "Saat ücreti değiştirildi." });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<MachineRateDialog current={rate} onClose={onClose} />);
    const input = screen.getByLabelText("Saat ücreti");
    await user.clear(input);
    await user.type(input, "275,5");
    await submit(user);
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(1));
    await submit(user);
    await waitFor(() => expect(svc.change).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("aynı anda başka bir işlemle değişti");
    await submit(user);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const tokens = svc.change.mock.calls.map((c) => (c[1] as { clientToken: string }).clientToken);
    expect(svc.change.mock.calls[0]![0]).toBe("r1");
    expect(svc.change.mock.calls[0]![1]).toMatchObject({ hourRateTry: "275.5", normMPerHour: "120" });
    expect(tokens[1]).toBe(tokens[0]);
    expect(tokens[2]).not.toBe(tokens[1]);
  });
  it("yaratma: makine seçici doğrudan modal; seçilmeden Kaydet kapalı; gövde machineId ile gider", async () => {
    perms = ["cost:read", "cost:write", "station:read"];
    svc.create.mockResolvedValue({ success: true, data: rate });
    const user = userEvent.setup();
    renderWithProviders(<MachineRateDialog onClose={() => {}} />);
    await user.type(screen.getByLabelText("Saat ücreti"), "100");
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Makine seç…" }));
    await submit(user);
    await waitFor(() => expect(svc.create).toHaveBeenCalled());
    expect(svc.create.mock.calls[0]![0]).toBe("m2");
    expect(svc.create.mock.calls[0]![1]).toMatchObject({ hourRateTry: "100", normMPerHour: null });
  });
});
