// D4-F1c — Çuvallar "bu top nerede?": belirsiz müşteri kodu → aday modalı → iç barkodla aynı konum.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SHARED_CODE, ambiguousThen } from "@/test/helpers/musteri-kodu-aday-fikstur";

const locateRoll = vi.fn();
let lookupOn = true;
vi.mock("./service", () => ({ sackHubService: { locateRoll: (c: string, p: boolean) => locateRoll(c, p) } }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { scanCustomerCodeLookupEnabled: lookupOn } } }) }));
import { useRollLocate } from "./useRollLocate";

const setSearch = vi.fn();
function Probe() {
  const l = useRollLocate(setSearch);
  return (
    <>
      <button onClick={() => l.handleScan(SHARED_CODE)}>OKUT-ORTAK</button>
      <button onClick={() => l.handleScan("T-IC-A")}>OKUT-TEKIL</button>
      <button onClick={() => l.handleScan("ALFA PERDE")}>ARA-METIN</button>
      {l.located && <p>KONUM:{l.located.barcode}</p>}
      {l.dialog}
    </>
  );
}
const mount = () => render(<QueryClientProvider client={new QueryClient()}><Probe /></QueryClientProvider>);

beforeEach(() => {
  lookupOn = true;
  setSearch.mockReset();
  locateRoll.mockReset();
  locateRoll.mockImplementation(ambiguousThen((c) => ({ success: true, data: { barcode: c } })));
});

describe("Top nerede — belirsiz müşteri kodu", () => {
  it("409 → modal → seçim → iç barkodla aynı konum (arama da korunur)", async () => {
    mount();
    fireEvent.click(screen.getByText("OKUT-ORTAK"));
    fireEvent.click(await screen.findByTestId("customer-code-candidate-r-b"));
    expect(await screen.findByText("KONUM:T-IC-B")).toBeTruthy();
    expect(locateRoll.mock.calls.map((c) => c[0])).toEqual([SHARED_CODE, "T-IC-B"]);
    expect(setSearch).toHaveBeenCalledWith(SHARED_CODE);
  });

  it("Vazgeç → konum kartı yok, ikinci istek yok", async () => {
    mount();
    fireEvent.click(screen.getByText("OKUT-ORTAK"));
    fireEvent.click(await screen.findByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(/KONUM:/)).toBeNull();
    expect(locateRoll).toHaveBeenCalledTimes(1);
  });

  it("tekil kod → modal açılmaz", async () => {
    mount();
    fireEvent.click(screen.getByText("OKUT-TEKIL"));
    expect(await screen.findByText("KONUM:T-IC-A")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sessiz sondanın 404'ü ekrandaki konum kartını silmez", async () => {
    mount();
    fireEvent.click(screen.getByText("OKUT-TEKIL"));
    expect(await screen.findByText("KONUM:T-IC-A")).toBeTruthy();
    locateRoll.mockRejectedValueOnce(Object.assign(new Error("yok"), { response: { status: 404 } }));
    await act(async () => { fireEvent.click(screen.getByText("ARA-METIN")); });
    await waitFor(() => expect(locateRoll).toHaveBeenLastCalledWith("ALFA PERDE", true));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("KONUM:T-IC-A")).toBeTruthy();
  });

  it("ayar kapalı → serisiz kod yalnız aramaya gider (bugünkü davranış)", async () => {
    lookupOn = false;
    mount();
    await act(async () => { fireEvent.click(screen.getByText("OKUT-ORTAK")); });
    expect(setSearch).toHaveBeenCalledWith(SHARED_CODE);
    expect(locateRoll).not.toHaveBeenCalled();
  });
});
