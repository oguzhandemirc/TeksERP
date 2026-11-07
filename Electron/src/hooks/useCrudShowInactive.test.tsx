// CrudPage liste kaydı (opt-in): "Pasifleri göster" kayıtlı sayfada URL'de, diğerlerinde yerel (2026-11-07 dalga 3).
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { isPersistedKey } from "@/components/data-table/filter-row/filter-persist";
import { CRUD_PERSIST, SHOW_INACTIVE_PARAM, useShowInactive } from "./useCrudShowInactive";

function hook(urlBacked: boolean, initial = "/") {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  return renderHook(() => ({ state: useShowInactive(urlBacked), search: useLocation().search }), { wrapper });
}

describe("useShowInactive", () => {
  it("⭐ kayıtlı sayfada URL'den okur ve URL'ye yazar (kayıt geri yükleyebilsin)", () => {
    const h = hook(true, `/?${SHOW_INACTIVE_PARAM}=true`);
    expect(h.result.current.state[0]).toBe(true);
    act(() => h.result.current.state[1](false));
    expect(h.result.current.search).toBe("");
    act(() => h.result.current.state[1](true));
    expect(h.result.current.search).toBe(`?${SHOW_INACTIVE_PARAM}=true`);
  });

  it("opt-in olmayan sayfada yerel durum; URL'ye dokunmaz (bugünkü davranış)", () => {
    const h = hook(false, `/?${SHOW_INACTIVE_PARAM}=true`);
    expect(h.result.current.state[0]).toBe(false);
    act(() => h.result.current.state[1](true));
    expect(h.result.current.state[0]).toBe(true);
    expect(h.result.current.search).toBe(`?${SHOW_INACTIVE_PARAM}=true`);
  });

  it("kayıt: yalnız sıralama + Pasifleri göster (süzgeç anahtarı yok)", () => {
    expect(isPersistedKey(SHOW_INACTIVE_PARAM, CRUD_PERSIST)).toBe(true);
    expect(isPersistedKey("filter[isActive]", CRUD_PERSIST)).toBe(false);
  });
});
