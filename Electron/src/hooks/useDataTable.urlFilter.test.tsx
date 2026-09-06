// =============================================================================
// BEKÇİ — arama debounce'u URL'deki FİLTREYİ silmez (2026-09-06)
// =============================================================================
// ⭐ SINIF: "bayat kapanış sessizce geri yazıyor". Arama debounce effect'inin
//    bağımlılığı yalnız [search]; kapanışındaki `searchParams` MOUNT anındaki
//    değerde DONAR. Zamanlayıcı 300 ms sonra o bayat kopyayı `replace` ile geri
//    yazınca arada eklenmiş her parametre URL'den DÜŞER.
// ⭐ SAHADAKİ BELİRTİ: Paketleme/Çuvallar kapısından bir cari seçmek
//    `filter[customerId]`i URL'e yazar ve AYNI tıkta listeyi mount eder;
//    react-router konum güncellemesini transition içinde yaptığı için liste
//    filtre işlenmeden mount olur, effect filtresiz kopyayı yakalar ve 300 ms
//    sonra filtreyi siler → liste O CARİNİN değil TÜM müşterilerin çuvallarını
//    gösterir. Sunucu temiz: süzgeci doğru kuruyor, parametre hiç ulaşmıyor.
// ⭐ NEGATİF SONDA (2026-09-06): `searchParamsRef.current` yerine kapanıştaki
//    `searchParams` konunca §2 KIRMIZI — ölçüldü.
// ⚠️ ÖLÇÜM BİR ADAY DÜZELTMEYİ ÇÜRÜTTÜ: "mount'ta hiç yazma"
//    (`if (search === lastPushedSearchRef.current) return;`) da denendi ve
//    kaldırıldığında HİÇBİR kontrol kırmızı vermedi — taze ref tek başına iki vakayı
//    da kapatıyor. Ölçülmemiş bir davranış değişikliği bırakılmadı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { useDataTable } from "./useDataTable";
import type { CursorPaginatedResponse } from "@/types/api";

vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, setPreference: () => {} }),
}));

type Row = { id: string };

/** Her çağrıda hangi filtrelerle istendiğini kaydeder — sunucuya NE gittiğinin kanıtı. */
const gorulenFiltreler: (string | undefined)[] = [];
function fetchFn(params: { filters?: Record<string, unknown> }): Promise<CursorPaginatedResponse<Row>> {
  gorulenFiltreler.push(params.filters?.customerId as string | undefined);
  return Promise.resolve({
    success: true,
    data: [{ id: "s1" }],
    pagination: { nextCursor: null, hasMore: false, limit: 100, totalEstimate: 1 },
  } as never);
}

let api: ReturnType<typeof useDataTable<Row>> | null = null;
let setParams: ReturnType<typeof useSearchParams>[1] | null = null;
let urlSimdi = "";

function Probe() {
  const [sp, set] = useSearchParams();
  setParams = set;
  urlSimdi = sp.toString();
  api = useDataTable<Row>({ queryKey: "sacks", queryKeyParts: ["sacks"], fetchFn, columns: [] });
  return null;
}

function Wrap({ qc, children }: { qc: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/sacks?filter%5BcustomerId%5D=MUS-X"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const tick = (ms = 80) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

beforeEach(() => {
  gorulenFiltreler.length = 0;
  api = null;
  setParams = null;
  urlSimdi = "";
});

describe("useDataTable — arama debounce'u filtreyi silmez", () => {
  it("⭐ §1 mount'tan 400 ms sonra URL'deki cari filtresi HÂLÂ duruyor", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <Wrap qc={qc}>
        <Probe />
      </Wrap>,
    );
    await tick(400); // debounce penceresinin (300 ms) ötesi

    expect(urlSimdi).toContain("filter%5BcustomerId%5D=MUS-X");
    // Sunucuya giden HER istek filtreyi taşımalı — filtresiz tek bir çağrı bile
    // sahada "tüm müşteriler listelendi" demektir.
    expect(gorulenFiltreler.length).toBeGreaterThan(0);
    expect(gorulenFiltreler.every((f) => f === "MUS-X")).toBe(true);
    view.unmount();
  });

  it("⭐ §2 arama yazarken filtre değişirse debounce ESKİ filtreyi geri yazmaz", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <Wrap qc={qc}>
        <Probe />
      </Wrap>,
    );
    await tick(400);

    // Kullanıcı yazmaya başlar → debounce zamanlayıcısı kurulur (henüz yazmadı).
    act(() => api!.setSearch("ab"));
    // 300 ms dolmadan filtre değişir (kapıdan başka cari seçildi).
    act(() => {
      setParams!((prev) => {
        const n = new URLSearchParams(prev);
        n.set("filter[customerId]", "MUS-Y");
        return n;
      });
    });
    await tick(400); // zamanlayıcı ateşler

    expect(urlSimdi).toContain("filter%5BcustomerId%5D=MUS-Y");
    expect(urlSimdi).toContain("search=ab");
    view.unmount();
  });

  it("§3 körlük zemini: filtresiz açılışta hiçbir şey uydurulmaz", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/sacks"]}>
          <Probe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await tick(400);
    expect(gorulenFiltreler.every((f) => f === undefined)).toBe(true);
    view.unmount();
  });
});
