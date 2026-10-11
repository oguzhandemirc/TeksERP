// Hazır Sebepler › Tezgah Duruşu hedef süre sütunu: "hedefi girilmemiş N sebep" yalnız aktif + süre
// izlenen sebepleri sayar; yetkisizde salt-okuma (girdi YOK); yetkilide geçerli değer PATCH'e gider,
// geçersiz değer gitmez; "çalışma dışı" sınıfı "izlenmez".
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ReasonPreset } from "./service";

const update = vi.fn();
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  reasonPresetService: { update: (...a: unknown[]) => update(...a) },
}));

import { StopTargetCell, StopTargetGapCallout, missingTargetCount } from "./StopTargetColumn";

const row = (over: Partial<ReasonPreset> = {}): ReasonPreset => ({
  id: "r1", kind: "MACHINE_STOP", code: "IP", label: "İp atlama", fullText: null, requiresText: false,
  sortOrder: 1, isActive: true, isSystem: false, stopLossClass: "UNPLANNED", targetMinutes: null, ...over,
});

afterEach(() => update.mockReset());

describe("hedef süre sütunu", () => {
  it("⭐ eksik sayısı: yalnız aktif, süre izlenen, hedefsiz tezgah duruşu sebebi", () => {
    expect(
      missingTargetCount([
        row(),
        row({ id: "2", targetMinutes: 10 }),
        row({ id: "3", isActive: false }),
        row({ id: "4", stopLossClass: "NON_SCHEDULED" }),
        row({ id: "5", kind: "ROLL_SCRAP" }),
        row({ id: "6", stopLossClass: "SETUP" }),
      ]),
    ).toBe(2);
  });

  it("uyarı: alarm açıkken 'alarm üretmez' der; eksik yoksa çizilmez", () => {
    const { rerender } = renderWithProviders(<StopTargetGapCallout count={3} alarmOn />);
    expect(screen.getByText("Hedef süresi girilmemiş 3 sebep")).toBeTruthy();
    expect(screen.getByText(/alarm üretmez/)).toBeTruthy();
    rerender(<StopTargetGapCallout count={0} alarmOn />);
    expect(screen.queryByText(/Hedef süresi girilmemiş/)).toBeNull();
  });

  it("⭐ yetki yoksa salt-okuma: girdi yok, 'girilmemiş' / 'N dk' / 'izlenmez' yazar", () => {
    renderWithProviders(
      <>
        <StopTargetCell row={row()} canEdit={false} />
        <StopTargetCell row={row({ id: "2", targetMinutes: 15 })} canEdit={false} />
        <StopTargetCell row={row({ id: "3", stopLossClass: "NON_SCHEDULED" })} canEdit={false} />
      </>,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("girilmemiş")).toBeTruthy();
    expect(screen.getByText("15 dk")).toBeTruthy();
    expect(screen.getByText("izlenmez")).toBeTruthy();
  });

  it("⭐ yetkili: geçerli değer PATCH'e gider; geçersiz ve değişmemiş değer gitmez", async () => {
    update.mockResolvedValue(row({ targetMinutes: 12 }));
    renderWithProviders(<StopTargetCell row={row()} canEdit />);
    const input = screen.getByRole("textbox", { name: /İp atlama — hedef süre/ });
    fireEvent.change(input, { target: { value: "2000" } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(update).toHaveBeenCalledWith("r1", { targetMinutes: 12 }));
  });

  it("çalışma dışı sınıfta yetkiliye de girdi çizilmez", () => {
    renderWithProviders(<StopTargetCell row={row({ stopLossClass: "NON_SCHEDULED" })} canEdit />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
