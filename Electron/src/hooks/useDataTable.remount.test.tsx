// =============================================================================
// BEKÇİ — sekme içi git-gel YÜKLÜ TÜM SAYFALARI yeniden çekmez (2026-09-05)
// =============================================================================
// ⭐ SINIF: "sessizce çarpan istek". `useInfiniteQuery` refetch'te yüklü sayfa
//    sayısı kadar isteği SIRAYLA atar (query-core infiniteQueryBehavior). Hook
//    `refetchOnMount:"always"` + `staleTime:0` taşıdığı için sekme İÇİ gezinti
//    (Sidebar → navigateActive, sayfayı unmount eder) her dönüşte bu turu
//    tekrarlıyordu. Ölçüm 2026-09-05: 832 top / pageSize 100 → 9 sayfa yüklüyken
//    remount = 9 seri istek. Kapıdan sonra 0.
// ⭐ TAZELİK KAYBOLMAZ: `invalidateQueries` staleTime'dan BAĞIMSIZ olarak
//    refetch tetikler — 27 top mutasyonunun tazelemesi aynen sürüyor (vaka 2).
//    Pencere dolduğunda (15 sn) remount yine çeker (vaka 3).
// ⭐ NEGATİF SONDA: `staleTime: 15_000` yerine eski `refetchOnMount:"always"` +
//    `staleTime: 0` konunca vaka 1 kırmızı verir (0 yerine 9 istek) —
//    doğrulandı 2026-09-05.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useDataTable } from "./useDataTable";
import type { CursorPaginatedResponse } from "@/types/api";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, setPreference: () => {} }),
}));

type Row = { id: string };
const PAGES = 9;
let calls = 0;

function fetchFn(params: { cursor?: string | null }): Promise<CursorPaginatedResponse<Row>> {
  calls++;
  const idx = params.cursor ? Number(params.cursor) : 0;
  return Promise.resolve({
    success: true,
    data: [{ id: `r${idx}` }],
    pagination: {
      nextCursor: idx + 1 < PAGES ? String(idx + 1) : null,
      hasMore: idx + 1 < PAGES,
      limit: 100,
      totalEstimate: 832,
    },
  } as never);
}

let api: ReturnType<typeof useDataTable<Row>> | null = null;
function Probe() {
  api = useDataTable<Row>({ queryKey: "rolls", queryKeyParts: ["rolls"], fetchFn, columns: [] });
  return null;
}

function Wrap({ qc, children }: { qc: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const tick = (ms = 80) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** 9 sayfayı yükleyip istek sayacını sıfırlar; açık görünümü döndürür. */
async function mountWithNinePages(qc: QueryClient) {
  const view = render(
    <Wrap qc={qc}>
      <Probe />
    </Wrap>,
  );
  await tick();
  for (let i = 1; i < PAGES; i++) {
    await act(async () => {
      await api!.pagination.loadMore();
    });
  }
  await tick();
  expect(calls).toBe(PAGES);
  calls = 0;
  return view;
}

beforeEach(() => {
  calls = 0;
  api = null;
});

describe("useDataTable — remount istek sayısı", () => {
  it("⭐ 9 sayfa yüklüyken unmount → remount SIFIR istek atar (eskiden 9)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = await mountWithNinePages(qc);
    first.unmount();

    const second = render(
      <Wrap qc={qc}>
        <Probe />
      </Wrap>,
    );
    await tick(200);
    expect(calls).toBe(0);
    // Satırlar cache'ten geri geliyor — liste boşalmıyor.
    expect(api!.pagination.loaded).toBe(PAGES);
    second.unmount();
  });

  it("⭐ mutasyon invalidate'i TÜM sayfaları yine tazeler (tazelik iddiası korunur)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = await mountWithNinePages(qc);
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ["rolls"] });
    });
    await tick(200);
    expect(calls).toBe(PAGES);
    view.unmount();
  });

  it("⭐ tazelik penceresi DOLUNCA remount yine çeker (staleTime sonsuz değil)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = await mountWithNinePages(qc);
    first.unmount();

    // 15 sn'lik pencereyi gerçek zaman beklemeden aş: sorgunun dataUpdatedAt'ini geri al.
    const entry = qc.getQueryCache().getAll()[0]!;
    (entry.state as { dataUpdatedAt: number }).dataUpdatedAt = Date.now() - 60_000;

    const second = render(
      <Wrap qc={qc}>
        <Probe />
      </Wrap>,
    );
    await tick(250);
    expect(calls).toBe(PAGES);
    second.unmount();
  });
});
