// BEKÇİ — fason sevkinde beklenen dönüş (F6): üç durum ayrı gövdeye düşer; boş = alan YOK (sunucu varsayılanı,
// eski davranış), "Termin yok" = açık null, gün = fabrika gününün son anı; geçmiş gün butonu kilitler.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { factoryDayEndIso } from "@/lib/factory-time";
import { expectedReturnBody, isPastExpectedReturn } from "./expectedReturn";
import { FasonStepRollSelectModal } from "@/pages/Operations/WorkOrders/FasonStepRollSelectModal";

describe("expectedReturnBody", () => {
  it("⭐ varsayılan alan göndermez; termin yok null; gün ISO (fabrika günü sonu)", () => {
    expect(expectedReturnBody({ mode: "DEFAULT" })).toEqual({});
    expect("expectedReturnAt" in expectedReturnBody({ mode: "DEFAULT" })).toBe(false);
    expect(expectedReturnBody({ mode: "NONE" })).toEqual({ expectedReturnAt: null });
    expect(expectedReturnBody({ mode: "DATE", day: "2026-11-20" })).toEqual({ expectedReturnAt: factoryDayEndIso("2026-11-20") });
    expect(expectedReturnBody({ mode: "DATE", day: "" })).toEqual({});
  });

  it("geçmiş gün tespiti fabrika gününe göre", () => {
    expect(isPastExpectedReturn({ mode: "DATE", day: "2026-11-07" }, "2026-11-08")).toBe(true);
    expect(isPastExpectedReturn({ mode: "DATE", day: "2026-11-08" }, "2026-11-08")).toBe(false);
    expect(isPastExpectedReturn({ mode: "NONE" }, "2026-11-08")).toBe(false);
  });
});

describe("FasonStepRollSelectModal — beklenen dönüş", () => {
  const rolls = [{ id: "r1", barcode: "T1", currentQty: 100, status: "IN_PRODUCTION" }] as never;
  const base = { open: true, onOpenChange: () => {}, title: "Sevk", rolls, destinationName: "Boyahane", confirmLabel: "Sevk Et", isPending: false };

  it("⭐ sevk kipinde alan var; dokunulmazsa ikinci argüman boş (eski gövde bayt-aynı)", () => {
    const onConfirm = vi.fn();
    render(<FasonStepRollSelectModal {...base} mode="dispatch" onConfirm={onConfirm} />);
    expect(screen.getByText("Beklenen dönüş")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sevk Et \(1\)/ }));
    expect(onConfirm).toHaveBeenCalledWith(["r1"], {});
  });

  it("⭐ 'Termin yok' açık null gönderir", () => {
    const onConfirm = vi.fn();
    render(<FasonStepRollSelectModal {...base} mode="dispatch" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Termin yok" }));
    fireEvent.click(screen.getByRole("button", { name: /Sevk Et \(1\)/ }));
    expect(onConfirm).toHaveBeenCalledWith(["r1"], { expectedReturnAt: null });
  });

  it("aktarım kipinde alan yok", () => {
    render(<FasonStepRollSelectModal {...base} mode="transfer" onConfirm={() => {}} />);
    expect(screen.queryByText("Beklenen dönüş")).toBeNull();
  });
});
