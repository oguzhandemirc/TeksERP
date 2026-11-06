import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StockKalemTab } from "./StockKalemTab";
import { KALEM_SERVER_OUTDATED } from "./stockKalem";

// Eski sunucu (uç yok): sekme tablo yerine güncelleme cümlesini basar, çökmez.
describe("StockKalemTab hata durumu", () => {
  it("errorText varken yalnız uyarı görünür", () => {
    render(<StockKalemTab data={undefined} isLoading={false} errorText={KALEM_SERVER_OUTDATED} />);
    expect(screen.getByRole("alert").textContent).toBe(KALEM_SERVER_OUTDATED);
    expect(screen.queryByText("Ham")).toBeNull();
  });
});
