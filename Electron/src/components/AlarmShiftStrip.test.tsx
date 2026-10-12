// Tezgah Salonu alarm vardiya şeridi: sunucu kodu → ortak Türkçe cümle; bağlantı yalnız izinli kullanıcıya.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AlarmShiftStrip } from "./AlarmShiftStrip";
import { ALARM_SHIFT_NOTICE_TEXT } from "@/lib/alarm-shift-notice";

const ciz = (notice: string | null | undefined, linkVisible = true) =>
  render(<MemoryRouter><AlarmShiftStrip notice={notice} linkVisible={linkVisible} /></MemoryRouter>);

describe("AlarmShiftStrip", () => {
  it("⭐ NO_SHIFT_DEFINED / NO_SHIFT_NOW → ortak cümle + Vardiya Tanımları bağlantısı", () => {
    for (const code of ["NO_SHIFT_DEFINED", "NO_SHIFT_NOW"] as const) {
      const { unmount } = ciz(code);
      const s = screen.getByTestId("alarm-shift-strip");
      expect(s.textContent).toContain(ALARM_SHIFT_NOTICE_TEXT[code]);
      expect(screen.getByRole("link", { name: "Vardiya Tanımları" }).getAttribute("href")).toBe("/definitions/shift-definitions");
      unmount();
    }
  });

  it("şerit yok: null · undefined (eski sunucu) · tanınmayan kod (yeni sunucu) — uydurma cümle basılmaz", () => {
    for (const n of [null, undefined, "BILINMEYEN"]) {
      const { unmount } = ciz(n);
      expect(screen.queryByTestId("alarm-shift-strip")).toBeNull();
      unmount();
    }
  });

  it("bağlantı izni/görünürlüğü yoksa (ya da TV kipi) cümle kalır, bağlantı çizilmez", () => {
    ciz("NO_SHIFT_NOW", false);
    expect(screen.getByTestId("alarm-shift-strip")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
