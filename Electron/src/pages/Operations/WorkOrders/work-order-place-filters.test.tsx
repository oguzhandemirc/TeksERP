// İş Emirleri "Şu an hangi fasonda" süzgeci (aşama sorusu Durum menüsündeki konumIstasyon'un).
// Ölçülen: URL'e virgüllü UUID yazımı → liste isteğinde filter[fasonFirma],
// "Ad · sayı" etiketi, Temizle, boş/hata satırı, 400 INVALID_FILTER_VALUE'da seçimin düşmesi.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { FilterBar } from "@/components/data-table/FilterBar";
import { TERIM } from "@/lib/terim";
import { buildCursorQueryString, buildScopeQueryString, parseUrlToQueryParams } from "@/lib/query-builder";
import type { ListScope } from "@/types/api";
import {
  buildPlaceFilters,
  createPlaceLookupService,
  isInvalidFilterValueError,
  placeOptionLabel,
  stripPlaceFilters,
  type PlaceOptions,
} from "./work-order-filters";

const OPTIONS: PlaceOptions = {
  firms: [
    { id: "f1", name: "NY Hisar", workOrderCount: 7 },
    { id: "f2", name: "Çağlar Boya", workOrderCount: 2 },
    { id: "f3", name: "Boş Firma", workOrderCount: 0 },
  ],
};

let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}

function renderBar(ui: ReactElement, url = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          {children}
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    ),
  });
}

/** URL → useDataTable'ın liste isteğine verdiği sorgu dizgisi (aynı yol). */
function listQueryFromUrl(search: string) {
  const p = parseUrlToQueryParams(search.replace(/^\?/, ""), { pageSize: 50 });
  return new URLSearchParams(buildCursorQueryString({ limit: 50, filters: p.filters }));
}

describe("yer süzgeci etiketleri", () => {
  it("seçenek satırı 'Ad · sayı'", () => {
    expect(placeOptionLabel({ id: "f1", name: "NY Hisar", workOrderCount: 7 })).toBe("NY Hisar · 7");
    expect(placeOptionLabel({ id: "f3", name: "Boş Firma", workOrderCount: 0 })).toBe("Boş Firma · 0");
  });

  it("tek seçici: anahtar fasonFirma, günlük dil etiketi (aşama için ikinci seçici yok)", () => {
    const defs = buildPlaceFilters(async () => OPTIONS);
    expect(defs.map((d) => ("key" in d ? d.key : null))).toEqual(["fasonFirma"]);
    expect(defs.map((d) => d.label)).toEqual(["Şu an hangi fasonda"]);
    expect(defs.every((d) => d.kind === "multi-lookup")).toBe(true);
  });
});

describe("seçenek servisi (istemci araması)", () => {
  it("Türkçe katlamalı arama + açılışlar tek isteği paylaşır", async () => {
    const fetchOptions = vi.fn(async () => OPTIONS);
    const svc = createPlaceLookupService(fetchOptions);
    expect((await svc.firms.getAll({ search: "cag" })).data.map((o) => o.id)).toEqual(["f2"]);
    expect((await svc.firms.getAll({ search: "HİSAR" })).data.map((o) => o.id)).toEqual(["f1"]);
    expect((await svc.firms.getAll({})).data).toHaveLength(3);
    expect(fetchOptions).toHaveBeenCalledTimes(1);
  });

  it("hata önbelleğe yapışmaz — sonraki açılış yeniden dener", async () => {
    const fetchOptions = vi
      .fn<() => Promise<PlaceOptions>>()
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValue(OPTIONS);
    const svc = createPlaceLookupService(fetchOptions);
    await expect(svc.firms.getAll({})).rejects.toThrow("404");
    expect((await svc.firms.getAll({})).data).toHaveLength(3);
  });
});

describe("faceted kapsam (liste süzgeçleri seçenek ucuna gider)", () => {
  const SCOPE: ListScope = {
    filters: { status: "IN_PROGRESS,PLANNED", konumIstasyon: "s1", hideCancelled: "true", fasonFirma: "f2" },
    search: "Tül",
    dateField: "createdAt",
    dateFrom: "2026-10-05T00:00:00.000Z",
  };

  it("kapsam sorgu dizgisi = liste isteği eksi sayfalama/sıralama", () => {
    const scopeQs = new URLSearchParams(buildScopeQueryString(SCOPE).slice(1));
    const listQs = new URLSearchParams(buildCursorQueryString({ ...SCOPE, limit: 50, cursor: "c", withTotal: true, sortBy: "workOrderNumber" }));
    for (const k of ["mode", "limit", "cursor", "withTotal", "sortBy"]) listQs.delete(k);
    expect([...scopeQs.entries()].sort()).toEqual([...listQs.entries()].sort());
    expect(buildScopeQueryString({ filters: {} })).toBe("");
  });

  it("seçenek isteği kapsamı taşır; kapsam değişince önbellek anahtarı değişir", async () => {
    const fetchOptions = vi.fn(async (_scope?: ListScope) => OPTIONS);
    const [def] = buildPlaceFilters(fetchOptions, SCOPE);
    if (def?.kind !== "multi-lookup") throw new Error("multi-lookup bekleniyordu");
    await (def.service.getAll as (p: { search?: string }) => Promise<unknown>)({});
    expect(fetchOptions).toHaveBeenCalledWith(SCOPE);
    const [other] = buildPlaceFilters(fetchOptions, { ...SCOPE, filters: { status: "COMPLETED" } });
    expect(other && "queryKey" in other ? other.queryKey : "").not.toBe(def.queryKey);
    expect(def.queryKey).toContain(buildScopeQueryString(SCOPE));
  });

  it("FilterBar açılışında seçenekler o anki kapsamla istenir", async () => {
    const user = userEvent.setup();
    const fetchOptions = vi.fn(async (_scope?: ListScope) => OPTIONS);
    renderBar(<FilterBar filters={buildPlaceFilters(fetchOptions, SCOPE)} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi fasonda/ }));
    await screen.findByText("NY Hisar · 7");
    expect(fetchOptions.mock.calls.at(-1)?.[0]).toEqual(SCOPE);
  });
});

describe("FilterBar'da yer seçicileri", () => {
  it("iki firma seçimi URL'e virgüllü yazılır, liste isteğine filter[fasonFirma]=f1,f2 gider", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(async () => OPTIONS)} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi fasonda/ }));
    await user.click(await screen.findByText("NY Hisar · 7"));
    await user.click(await screen.findByText("Çağlar Boya · 2"));
    const qs = listQueryFromUrl(lastSearch);
    expect(qs.get("filter[fasonFirma]")).toBe("f1,f2");
  });

  it("tek seçimde tetik 'Ad · sayı' gösterir", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(async () => OPTIONS)} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi fasonda/ }));
    await user.click(await screen.findByText("NY Hisar · 7"));
    expect(listQueryFromUrl(lastSearch).get("filter[fasonFirma]")).toBe("f1");
    expect(await screen.findByRole("button", { name: /NY Hisar · 7/ })).toBeTruthy();
  });

  it("Temizle seçimi URL'den siler, diğer süzgeç kalır", async () => {
    const user = userEvent.setup();
    renderBar(
      <FilterBar filters={buildPlaceFilters(async () => OPTIONS)} />,
      "/?filter%5BfasonFirma%5D=f1,f2&filter%5BkonumIstasyon%5D=s1",
    );
    await user.click(await screen.findByRole("button", { name: /Şu an hangi fasonda \(2\)/ }));
    await user.click(await screen.findByRole("button", { name: "Temizle" }));
    const qs = listQueryFromUrl(lastSearch);
    expect(qs.has("filter[fasonFirma]")).toBe(false);
    expect(qs.get("filter[konumIstasyon]")).toBe("s1");
  });

  it("boş yanıtta açık satır: 'Şu an fasonda <iş emri> yok.' (TERIM)", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(async () => ({ firms: [] }))} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi fasonda/ }));
    expect(await screen.findByText(`Şu an fasonda ${TERIM.terbiyeIsEmri.tekilKucuk} yok.`)).toBeTruthy();
    expect(screen.queryByText("Sonuç yok.")).toBeNull();
  });

  it("uç hata verirse 'Seçenekler yüklenemedi' (boş sanılmaz)", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(() => Promise.reject(new Error("404")))} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi fasonda/ }));
    expect(await screen.findByText("Seçenekler yüklenemedi")).toBeTruthy();
    expect(screen.queryByText(`Şu an fasonda ${TERIM.terbiyeIsEmri.tekilKucuk} yok.`)).toBeNull();
  });
});

describe("400 INVALID_FILTER_VALUE", () => {
  it("kod details.code'dan okunur", () => {
    expect(isInvalidFilterValueError({ response: { data: { details: { code: "INVALID_FILTER_VALUE" } } } })).toBe(true);
    expect(isInvalidFilterValueError({ response: { data: { code: "INVALID_FILTER_VALUE" } } })).toBe(false);
    expect(isInvalidFilterValueError(null)).toBe(false);
  });

  it("yalnız fason firma süzgeci düşer; yoksa null (döngü yok)", () => {
    const sp = new URLSearchParams("filter[fasonFirma]=x&filter[konumIstasyon]=y&search=a");
    const next = stripPlaceFilters(sp)!;
    expect(next.toString()).toBe("filter%5BkonumIstasyon%5D=y&search=a");
    expect(stripPlaceFilters(next)).toBeNull();
  });

  it("İş Emirleri sayfası seçiciyi süzgeç çubuğuna koyar ve 400'de seçimi temizler", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "WorkOrdersPage.tsx"), "utf8");
    // Seçenekler listenin O ANKİ kapsamıyla istenir (faceted sayım, 2026-11-04 E2E).
    expect(src).toMatch(/buildPlaceFilters\(\(scope\) => workOrderService\.whereOptions\(scope\)[^\n]*, listScope\)/);
    expect(src).toMatch(/\[listScope\]/);
    expect(src).toMatch(/<FilterBar filters=\{filters\}/);
    expect(src).toMatch(/isInvalidFilterValueError\(query\.error\)[\s\S]{0,120}stripPlaceFilters\(searchParams\)/);
  });
});
