// BEKÇİ — DateRangeInput: iki takvim kutusu, bitiş < başlangıç → takas DEĞİL, amber + status; DateTimeInput değer
// katmanı. Negatif sonda: `rangeInverted` hep false yapılınca "uyarı" ❌; `joinDateTime` tarihsizken "" dönmeyince ❌.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { DateRangeInput, rangeInverted } from "./DateRangeInput";
import { DateTimeInput } from "./DateTimeInput";
import { joinDateTime, splitDateTime } from "@/lib/date-time-input";

describe("DateRangeInput", () => {
  it("iki DatePickerInput (GG.AA.YYYY maskeli, yerleşik type=date yok), aria-label'lar", () => {
    renderWithProviders(<DateRangeInput from="2026-09-01" to="2026-09-17" onFrom={() => {}} onTo={() => {}} />);
    const from = screen.getByLabelText("Başlangıç tarihi") as HTMLInputElement;
    const to = screen.getByLabelText("Bitiş tarihi") as HTMLInputElement;
    expect(from.type).toBe("text");
    expect(from.value).toBe("01.09.2026");
    expect(to.value).toBe("17.09.2026");
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("⭐ bitiş < başlangıç → takas edilmez, iki kutu aria-invalid + role=status uyarı; onChange yine geçer", async () => {
    const onTo = vi.fn();
    renderWithProviders(<DateRangeInput from="2026-09-17" to="2026-09-01" onFrom={() => {}} onTo={onTo} />);
    expect(rangeInverted("2026-09-17", "2026-09-01")).toBe(true);
    expect(rangeInverted("2026-09-01", "2026-09-17")).toBe(false);
    expect(rangeInverted("", "2026-09-01")).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(/Bitiş tarihi başlangıçtan önce/);
    expect(screen.getByLabelText("Bitiş tarihi")).toHaveAttribute("aria-invalid", "true");
    const to = screen.getByLabelText("Bitiş tarihi");
    await userEvent.click(to);
    await userEvent.clear(to);
    await userEvent.type(to, "20092026");
    await userEvent.tab();
    expect(onTo).toHaveBeenCalledWith("2026-09-20");
  });
});

describe("DateTimeInput + lib/date-time-input", () => {
  it("⭐ değer sözleşmesi datetime-local ile aynı: 'YYYY-MM-DDTHH:mm'; tarihsiz saat bir an değildir → ''", () => {
    expect(splitDateTime("2026-09-17T08:30")).toEqual({ date: "2026-09-17", time: "08:30" });
    expect(splitDateTime("2026-09-17T08:30:15")).toEqual({ date: "2026-09-17", time: "08:30" });
    expect(splitDateTime("")).toEqual({ date: "", time: "" });
    expect(joinDateTime("2026-09-17", "08:30")).toBe("2026-09-17T08:30");
    expect(joinDateTime("2026-09-17", "")).toBe("2026-09-17T00:00");
    expect(joinDateTime("2026-09-17", "", "07:00")).toBe("2026-09-17T07:00");
    expect(joinDateTime("", "08:30")).toBe("");
  });

  it("tarih kutusu takvimli metin, saat kutusu yerleşik time; saat değişince birleşik değer", async () => {
    const onChange = vi.fn();
    renderWithProviders(<DateTimeInput value="2026-09-17T08:30" onChange={onChange} aria-label="Duruş başlangıcı" />);
    const date = screen.getByLabelText("Duruş başlangıcı — tarih") as HTMLInputElement;
    const time = screen.getByLabelText("Duruş başlangıcı — saat") as HTMLInputElement;
    expect(date.type).toBe("text");
    expect(date.value).toBe("17.09.2026");
    expect(time.type).toBe("time");
    expect(time.value).toBe("08:30");
    fireEvent.change(time, { target: { value: "09:45" } }); // jsdom saat kutusuna harf harf yazımı sanitize eder
    expect(onChange).toHaveBeenLastCalledWith("2026-09-17T09:45");
  });
});

describe("DatePickerInput — girdi kutudan taşmaz", () => {
  it("⭐ <input> flex-1 + min-w-0 + w-0 taşır: içsel genişlik komşu düğmeleri görünmeden örtüyordu (saha 2026-09-22)", () => {
    const src = readFileSync(join(__dirname, "DatePickerInput.tsx"), "utf-8");
    const inputCls = src.match(/<input[\s\S]*?className="([^"]+)"/)?.[1] ?? "";
    expect(inputCls).toMatch(/\bmin-w-0\b/);
    expect(inputCls).toMatch(/\bw-0\b/);
    expect(inputCls).toMatch(/\bflex-1\b/);
  });
});
