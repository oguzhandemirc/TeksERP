// =============================================================================
// BEKÇİ — lookup katalogları AÇILMADAN çekilmez (2026-09-05 performans turu)
// =============================================================================
// ⭐ ÖLÇÜM: Envanter (RollsPage) tek açılışta 7 lookup isteği atıyordu (SUBCONTRACTOR
//    sekmesinde 8), dropdown'ların hiçbiri açılmadan. `open` state'i zaten vardı,
//    `useQuery`ye bağlanmamıştı. Kapıdan sonra mount'ta 0 istek.
// ⭐ KAPI `open || seçim var` — düz `enabled: open` DEĞİL: seçili filtrenin tetik
//    yazısı `items` listesinden çözülüyor, katalog gelmezse düğme ham id basardı
//    (kayıtlı görünüm / route-memory ile dönüşte filtre DOLU gelir).
// ⭐ NEGATİF SONDA: `enabled` satırları silinince 1. ve 2. vaka kırmızı verir
//    (mount'ta 2 istek sayılır) — doğrulandı 2026-09-05.
// =============================================================================
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { FilterBar, type FilterDef } from "./FilterBar";

function renderBar(ui: ReactElement, url = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

const getAll = vi.fn();
const service = { getAll: (...a: unknown[]) => getAll(...a) } as never;

const MULTI: FilterDef = {
  kind: "multi-lookup",
  key: "itemId",
  label: "Kumaş",
  service,
  queryKey: "items",
};
const SINGLE: FilterDef = {
  kind: "lookup",
  key: "customerId",
  label: "Müşteri",
  service,
  queryKey: "customers",
};

beforeEach(() => {
  getAll.mockReset();
  getAll.mockResolvedValue({
    data: [{ id: "i1", name: "PATOS" }],
    pagination: { page: 1, pageSize: 200, total: 1, totalPages: 1 },
  });
});

describe("lookup katalog kapısı", () => {
  it("⭐ SEÇİMSİZ mount: hiçbir katalog isteği atılmaz (7 → 0)", async () => {
    renderBar(<FilterBar filters={[MULTI, SINGLE]} />);
    await new Promise((r) => setTimeout(r, 120));
    expect(getAll).toHaveBeenCalledTimes(0);
  });

  it("⭐ dropdown AÇILINCA tam bir kez çekilir", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={[MULTI]} />);
    await user.click(screen.getByRole("button", { name: /Kumaş/ }));
    expect(await screen.findByText("PATOS")).toBeTruthy();
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("⭐ SEÇİM VARSA açılmadan çekilir — tetik yazısı ham id'ye düşmez (multi)", async () => {
    renderBar(<FilterBar filters={[MULTI]} />, "/?filter%5BitemId%5D=i1");
    expect(await screen.findByRole("button", { name: /PATOS/ })).toBeTruthy();
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("⭐ SEÇİM VARSA açılmadan çekilir — tetik yazısı ham id'ye düşmez (tekli)", async () => {
    renderBar(<FilterBar filters={[SINGLE]} />, "/?filter%5BcustomerId%5D=i1");
    expect(await screen.findByRole("button", { name: /PATOS/ })).toBeTruthy();
    expect(getAll).toHaveBeenCalledTimes(1);
  });
});
