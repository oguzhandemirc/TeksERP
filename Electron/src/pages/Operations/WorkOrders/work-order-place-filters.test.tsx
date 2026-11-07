// İş Emirleri "Şu an hangi fasonda / hangi aşamada" süzgeçleri (panel 1.3.10).
// Ölçülen: URL'e virgüllü UUID yazımı → liste isteğinde filter[fasonFirma]/filter[asama],
// "Ad · sayı" etiketi, Temizle, boş/hata satırı, 400 INVALID_FILTER_VALUE'da seçimin düşmesi.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { FilterBar } from "@/components/data-table/FilterBar";
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
  stages: [
    { id: "s1", name: "Kurşun", workOrderCount: 4 },
    { id: "s2", name: "Tambur", workOrderCount: 1 },
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

  it("iki seçici: anahtar fasonFirma/asama, günlük dil etiketleri", () => {
    const defs = buildPlaceFilters(async () => OPTIONS);
    expect(defs.map((d) => ("key" in d ? d.key : null))).toEqual(["fasonFirma", "asama"]);
    expect(defs.map((d) => d.label)).toEqual(["Şu an hangi fasonda", "Şu an hangi aşamada"]);
    expect(defs.every((d) => d.kind === "multi-lookup")).toBe(true);
  });
});

describe("seçenek servisi (istemci araması)", () => {
  it("Türkçe katlamalı arama + iki seçici tek istek paylaşır", async () => {
    const fetchOptions = vi.fn(async () => OPTIONS);
    const svc = createPlaceLookupService(fetchOptions);
    expect((await svc.firms.getAll({ search: "cag" })).data.map((o) => o.id)).toEqual(["f2"]);
    expect((await svc.stages.getAll({ search: "KURSUN" })).data.map((o) => o.id)).toEqual(["s1"]);
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

describe("FilterBar'da yer seçicileri", () => {
  it("iki firma seçimi URL'e virgüllü yazılır, liste isteğine filter[fasonFirma]=f1,f2 gider", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(async () => OPTIONS)} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi fasonda/ }));
    await user.click(await screen.findByText("NY Hisar · 7"));
    await user.click(await screen.findByText("Çağlar Boya · 2"));
    const qs = listQueryFromUrl(lastSearch);
    expect(qs.get("filter[fasonFirma]")).toBe("f1,f2");
    expect(qs.has("filter[asama]")).toBe(false);
  });

  it("aşama seçimi filter[asama]; tek seçimde tetik 'Ad · sayı' gösterir", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(async () => OPTIONS)} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi aşamada/ }));
    await user.click(await screen.findByText("Kurşun · 4"));
    expect(listQueryFromUrl(lastSearch).get("filter[asama]")).toBe("s1");
    expect(await screen.findByRole("button", { name: /Kurşun · 4/ })).toBeTruthy();
  });

  it("Temizle seçimi URL'den siler, diğer süzgeç kalır", async () => {
    const user = userEvent.setup();
    renderBar(
      <FilterBar filters={buildPlaceFilters(async () => OPTIONS)} />,
      "/?filter%5BfasonFirma%5D=f1,f2&filter%5Basama%5D=s1",
    );
    await user.click(await screen.findByRole("button", { name: /Şu an hangi fasonda \(2\)/ }));
    await user.click(await screen.findByRole("button", { name: "Temizle" }));
    const qs = listQueryFromUrl(lastSearch);
    expect(qs.has("filter[fasonFirma]")).toBe(false);
    expect(qs.get("filter[asama]")).toBe("s1");
  });

  it("boş yanıtta açık satır: 'Şu an fasonda iş emri yok.'", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(async () => ({ firms: [], stages: [] }))} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi fasonda/ }));
    expect(await screen.findByText("Şu an fasonda iş emri yok.")).toBeTruthy();
    expect(screen.queryByText("Sonuç yok.")).toBeNull();
  });

  it("uç hata verirse 'Seçenekler yüklenemedi' (boş sanılmaz)", async () => {
    const user = userEvent.setup();
    renderBar(<FilterBar filters={buildPlaceFilters(() => Promise.reject(new Error("404")))} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi aşamada/ }));
    expect(await screen.findByText("Seçenekler yüklenemedi")).toBeTruthy();
    expect(screen.queryByText("Şu an üretim aşamasında iş emri yok.")).toBeNull();
  });
});

describe("400 INVALID_FILTER_VALUE", () => {
  it("kod details.code'dan okunur", () => {
    expect(isInvalidFilterValueError({ response: { data: { details: { code: "INVALID_FILTER_VALUE" } } } })).toBe(true);
    expect(isInvalidFilterValueError({ response: { data: { code: "INVALID_FILTER_VALUE" } } })).toBe(false);
    expect(isInvalidFilterValueError(null)).toBe(false);
  });

  it("yalnız yer süzgeçleri düşer; yoksa null (döngü yok)", () => {
    const sp = new URLSearchParams("filter[fasonFirma]=x&filter[asama]=y&filter[fasonda]=1&search=a");
    const next = stripPlaceFilters(sp)!;
    expect(next.toString()).toBe("filter%5Bfasonda%5D=1&search=a");
    expect(stripPlaceFilters(next)).toBeNull();
  });

  it("İş Emirleri sayfası seçicileri Fasonda'nın ardına koyar ve 400'de seçimi temizler", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "WorkOrdersPage.tsx"), "utf8");
    expect(src).toMatch(
      / {2}FASONDA_FILTER,\n(?: {2}\/\/[^\n]*\n)* {2}\.\.\.buildPlaceFilters\(\(scope\) => workOrderService\.whereOptions\(scope\)\.then\(\(r\) => r\.data\), listScope\),/,
    );
    // Süzgeç dizisi listenin kapsamından kurulur (useDataTable'ın listScope'u) ve tek satır çubuğa o gider.
    expect(src).toMatch(/useMemo\(\(\) => buildFilters\(listScope\), \[listScope\]\)/);
    expect(src).toMatch(/<WorkOrdersFilterRow\s+filters=\{filterDefs\}/);
    expect(src).toMatch(/isInvalidFilterValueError\(query\.error\)[\s\S]{0,120}stripPlaceFilters\(searchParams\)/);
  });
});

// ── Bulgu 1 (2026-11-04): seçenek sayısı listenin süzgeçleri İÇİNDE (faceted) ──────
const SCOPE_A: ListScope = {
  filters: { status: "IN_PROGRESS", fasonFirma: "f1", hideCancelled: "true" },
  search: "İE-1",
  dateField: "createdAt",
  dateFrom: "2026-10-05T00:00:00.000Z",
  dateTo: "2026-11-04T20:59:59.999Z",
};

describe("seçenek isteğine listenin kapsamı geçer", () => {
  it("kapsam sorgu dizgisi liste isteğinin süzgeç/arama/tarih kısmıyla birebir", () => {
    const scopeQs = new URLSearchParams(buildScopeQueryString(SCOPE_A));
    const listQs = new URLSearchParams(buildCursorQueryString({ limit: 50, ...SCOPE_A }));
    listQs.delete("mode");
    listQs.delete("limit");
    expect([...scopeQs].sort()).toEqual([...listQs].sort());
    expect(scopeQs.get("filter[fasonFirma]")).toBe("f1");
    expect(scopeQs.get("dateFrom")).toBe(SCOPE_A.dateFrom);
    expect(buildScopeQueryString({ filters: {} })).toBe("");
  });

  it("seçenek servisi kapsamı uca aynen verir; iki seçici yine tek istek", async () => {
    const fetchOptions = vi.fn(async (_s?: ListScope) => OPTIONS);
    const svc = createPlaceLookupService(fetchOptions, undefined, SCOPE_A);
    await svc.firms.getAll({});
    await svc.stages.getAll({});
    expect(fetchOptions).toHaveBeenCalledTimes(1);
    expect(fetchOptions).toHaveBeenCalledWith(SCOPE_A);
  });

  it("kapsam değişince seçici önbellek anahtarı değişir (yeniden çekilir)", () => {
    const keysA = buildPlaceFilters(async () => OPTIONS, SCOPE_A).map((d) => ("queryKey" in d ? d.queryKey : ""));
    const keysB = buildPlaceFilters(async () => OPTIONS, { ...SCOPE_A, dateFrom: "2026-09-01T00:00:00.000Z" }).map(
      (d) => ("queryKey" in d ? d.queryKey : ""),
    );
    expect(keysA[0]).not.toBe(keysB[0]);
    expect(keysA[1]).not.toBe(keysB[1]);
    expect(keysA[0]).not.toBe(keysA[1]);
  });

  it("FilterBar: seçici açılınca uç o anki kapsamla çağrılır; kapsam değişince yeni kapsamla", async () => {
    const user = userEvent.setup();
    const fetchOptions = vi.fn(async (_s?: ListScope) => OPTIONS);
    const scopeB: ListScope = { ...SCOPE_A, filters: { ...SCOPE_A.filters, status: "PLANNED" } };
    const view = renderBar(<FilterBar filters={buildPlaceFilters(fetchOptions, SCOPE_A)} />);
    await user.click(screen.getByRole("button", { name: /Şu an hangi aşamada/ }));
    await screen.findByText("Kurşun · 4");
    expect(fetchOptions).toHaveBeenLastCalledWith(SCOPE_A);
    view.rerender(<FilterBar filters={buildPlaceFilters(fetchOptions, scopeB)} />);
    await vi.waitFor(() => expect(fetchOptions).toHaveBeenLastCalledWith(scopeB));
  });
});
