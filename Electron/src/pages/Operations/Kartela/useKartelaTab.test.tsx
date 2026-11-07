// Kartela sekme geçişi: router yazımı sekme state'inden GEÇ çizilir (RR7 geçişi). Eski sekmenin
// süzgeci URL'de dururken yeni sekme bağlanırsa kayıtlı süzgeci derin bağlantı sanar → kapı.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

let url = new URLSearchParams();
const setSp = vi.fn();
vi.mock("react-router-dom", () => ({ useSearchParams: () => [url, setSp] }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

import { useKartelaTab } from "./useKartelaTab";

beforeEach(() => setSp.mockReset());

describe("useKartelaTab — geçiş kapısı", () => {
  it("⭐ eski sekmenin süzgeci URL'den çıkana dek settled=false; çıkınca true", () => {
    url = new URLSearchParams("filter[status]=active&search=x&tab=dispatches");
    const { result, rerender } = renderHook(() => useKartelaTab(() => {}));
    expect(result.current.settled).toBe(true);
    act(() => result.current.changeTab("receipts"));
    expect(setSp).toHaveBeenCalledTimes(1);
    expect(String(setSp.mock.calls[0]![0])).toBe("tab=dispatches");
    // Router henüz çizmedi: URL eski.
    expect(result.current.tab).toBe("receipts");
    expect(result.current.settled).toBe(false);
    url = new URLSearchParams("tab=dispatches");
    rerender();
    expect(result.current.settled).toBe(true);
  });

  it("süzgeçsiz geçişte URL yazılmaz, bekleme yok", () => {
    url = new URLSearchParams("");
    const { result } = renderHook(() => useKartelaTab(() => {}));
    act(() => result.current.changeTab("stock"));
    expect(setSp).not.toHaveBeenCalled();
    expect(result.current.settled).toBe(true);
  });
});
