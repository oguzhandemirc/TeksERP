// Sayaç açıklamaları TASLAĞA göre seçilir: sarmalı seride "geriye alınamaz" ve
// "hane genişler" cümleleri başa dönen seriyle çelişiyordu (kısa parti no,
// kullanıcı ekran görüntüsü 2026-09-24).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NumberingCounterFields } from "./NumberingCounterFields";
import type { NumberSeriesRow, SeriesCounterInput } from "./types";

const RESET = "Sayaç geriye alınamaz: sıra 1'e döndürülse bile ilk boş numaraya kadar ilerler.";

function ciz(counter: SeriesCounterInput, digits: number) {
  const row = {
    key: "batchShort",
    counter: { startValue: true, step: true, maxValue: true, reset: false, resetReason: RESET },
  } as unknown as NumberSeriesRow;
  render(
    <NumberingCounterFields row={row} counter={counter} digits={digits} exhaustion={null} onChange={() => {}} />,
  );
}

describe("Sayaç açıklamaları taslağa göre", () => {
  it("⭐ sarmalı seride 'geriye alınamaz' ve 'hane genişler' cümleleri ÇİZİLMEZ", () => {
    ciz({ startValue: null, step: null, maxValue: 99, wrap: true }, 2);
    expect(screen.queryByText(/geriye alınamaz/)).toBeNull();
    expect(screen.queryByText(/hane genişler/)).toBeNull();
    expect(screen.getByText(/başa dön/)).toBeInTheDocument();
  });

  it("⭐ sınırsız seride dolgu sınırı HANEDEN hesaplanır (sabit 9999 değil)", () => {
    ciz({ startValue: null, step: null, maxValue: null, wrap: false }, 2);
    expect(screen.getByText(/numara 99'u aşınca hane genişler/)).toBeInTheDocument();
    expect(screen.getByText(/geriye alınamaz/)).toBeInTheDocument();
  });

  it("sınırlı ama sarmayan seride sınır cümlesi + sıfırlama gerekçesi çizilir", () => {
    ciz({ startValue: null, step: null, maxValue: 10, wrap: false }, 4);
    expect(screen.getByText(/sayacı üst sınır durdurur/)).toBeInTheDocument();
    expect(screen.queryByText(/hane genişler/)).toBeNull();
    expect(screen.getByText(/geriye alınamaz/)).toBeInTheDocument();
  });
});
