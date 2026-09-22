// BEKÇİ — sevk yönü alanı (S4, 2026-09-23): kilitliyse ROZET + kaynak + ihracat kodu, seçici YOK;
// zincir boşsa tek seferlik seçici ve "karta yazılır" notu (şubeli sevkte şubenin kartı).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DestinationLockField } from "./DestinationLockField";

const kilit = { destination: "EXPORT" as const, source: "BRANCH" as const, exportCode: "EXP-B", quickShipBlockedReason: "x" };

describe("DestinationLockField", () => {
  it("⭐ kilitli → rozet, kaynak ve ihracat kodu; seçici çizilmez", () => {
    render(<DestinationLockField lock={kilit} isLoading={false} picked={null} onPick={() => {}} hasBranch />);
    expect(screen.getByTestId("destination-lock-badge")).toHaveTextContent("Yurtdışı");
    expect(screen.getByText("Şubeden")).toBeInTheDocument();
    expect(screen.getByText("İhracat Kodu: EXP-B")).toBeInTheDocument();
    expect(screen.queryByTestId("destination-first-pick")).toBeNull();
  });
  it("⭐ zincir boş → seçici + 'carinin kartına yazılır'; tık seçimi bildirir", () => {
    const onPick = vi.fn();
    render(<DestinationLockField lock={{ destination: null, source: null, exportCode: null, quickShipBlockedReason: null }} isLoading={false} picked={null} onPick={onPick} hasBranch={false} />);
    expect(screen.getByText(/carinin kartına yazılır/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yurtdışı" }));
    expect(onPick).toHaveBeenCalledWith("EXPORT");
  });
  it("şubeli ilk sevk → 'şubenin kartına'", () => {
    render(<DestinationLockField lock={{ destination: null, source: null, exportCode: null, quickShipBlockedReason: null }} isLoading={false} picked={null} onPick={() => {}} hasBranch />);
    expect(screen.getByText(/şubenin kartına yazılır/)).toBeInTheDocument();
  });
});
