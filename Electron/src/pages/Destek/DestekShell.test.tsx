import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { DestekRoot } from "./DestekRoot";
import { DestekTopbarButton } from "./DestekTopbarButton";
import { useDestekStore } from "./destek-store";
import { destekService } from "./service";
import { codeError, httpError } from "./testing";

vi.mock("./service", () => ({
  destekService: { durum: vi.fn(), unread: vi.fn(), create: vi.fn(), list: vi.fn() },
}));

const svc = vi.mocked(destekService);

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DestekTopbarButton />
      <DestekRoot />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  useDestekStore.getState().reset();
  useAuthStore.setState({ user: { userId: "u1", username: "ayse", permissions: [] }, isSystemAccount: false });
});

describe("destek kapalıyken görünmez", () => {
  it("durum etkin:false → düğme yok, form yok, başka destek isteği yok", async () => {
    svc.durum.mockResolvedValue({ etkin: false, firmaYoneticisi: false });
    mount();
    await waitFor(() => expect(svc.durum).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Destek/ })).toBeNull();
    expect(screen.queryByText("Sorun bildir")).toBeNull();
    expect(svc.unread).not.toHaveBeenCalled();
  });

  it("eski backend (uç yok → 404) sessizce kapalı sayılır", async () => {
    svc.durum.mockRejectedValue(httpError(404));
    mount();
    await waitFor(() => expect(svc.durum).toHaveBeenCalled());
    await act(async () => {});
    expect(useDestekStore.getState().enabled).toBe(false);
    expect(screen.queryByRole("button", { name: /Destek/ })).toBeNull();
    expect(svc.unread).not.toHaveBeenCalled();
  });

  it("Ctrl+Shift+B kapalıyken hiçbir şey açmaz", async () => {
    svc.durum.mockResolvedValue({ etkin: false, firmaYoneticisi: false });
    mount();
    await waitFor(() => expect(svc.durum).toHaveBeenCalled());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "B", code: "KeyB", ctrlKey: true, shiftKey: true }));
    await act(async () => {});
    expect(useDestekStore.getState().report.open).toBe(false);
  });
});

describe("destek açıkken", () => {
  it("düğme ve okunmamış rozeti çizilir", async () => {
    svc.durum.mockResolvedValue({ etkin: true, firmaYoneticisi: false });
    svc.unread.mockResolvedValue({ count: 3, tickets: 2 });
    mount();
    expect(await screen.findByRole("button", { name: "Destek, 2 yanıtlanmış talep" })).toBeInTheDocument();
    expect(svc.unread).toHaveBeenCalledWith("mine");
  });

  it("firma kapsamı sunucunun firmaYoneticisi kararından gelir (yerel izin çıkarımı YOK)", async () => {
    useAuthStore.setState({ user: { userId: "u1", username: "ayse", permissions: ["admin:settings"] }, isSystemAccount: true });
    svc.durum.mockResolvedValue({ etkin: true, firmaYoneticisi: false });
    svc.unread.mockResolvedValue({ count: 0, tickets: 0 });
    mount();
    await waitFor(() => expect(svc.unread).toHaveBeenCalledWith("mine"));
    expect(svc.unread).not.toHaveBeenCalledWith("tenant");
  });

  it("firmaYoneticisi:true → izin listesi boş olsa da firma rozeti yoklanır", async () => {
    svc.durum.mockResolvedValue({ etkin: true, firmaYoneticisi: true });
    svc.unread.mockResolvedValue({ count: 0, tickets: 0 });
    mount();
    await waitFor(() => expect(svc.unread).toHaveBeenCalledWith("tenant"));
    expect(useDestekStore.getState().tenantAdmin).toBe(true);
  });

  it("rozet yoklaması merkez hatasını yutar: düğme durur, rozet yok, hata fırlamaz", async () => {
    svc.durum.mockResolvedValue({ etkin: true, firmaYoneticisi: false });
    svc.unread.mockRejectedValue(codeError(502, "DESTEK_ULASILAMADI"));
    mount();
    expect(await screen.findByRole("button", { name: "Destek" })).toBeInTheDocument();
    await waitFor(() => expect(svc.unread).toHaveBeenCalled());
    expect(useDestekStore.getState().unreadMine).toBeNull();
  });
});
