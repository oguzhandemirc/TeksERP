// HATA RAPORLARI — bileşen bekçisi: özet kurulum bazında (grup + toplam + son görülme) ve ayrıntıya bağ;
// ayrıntıda gruplar yalnız allowlist alanlarını çizer, kaynak süzmesi SUNUCUYA gider; ekran hiçbir yazma isteği atmaz.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import { renderApp, sessionFor, writes, type Recorded } from "./harness";

const KURULUM = {
  id: "7c000000-0000-4000-8000-0000000000c1",
  kurulumId: "9e8d7c6b-0000-4000-8000-0000000000c1",
  ad: "Ana sunucu",
  tesis: { ad: "Merkez", musteri: { id: "7c000000-0000-4000-8000-0000000000a1", ad: "Örnek Tekstil" } },
};
const GROUPS = [
  { id: "7c000000-0000-4000-8000-000000000001", kaynak: "sunucu", surum: "2.12.0", kod: "UNHANDLED", sinif: "TypeError", bilesen: "rolls", yol: "/api/rolls/:id", yigin: ["src/services/roll.service.ts:120"], sayi: 7, ilk: "2026-10-06T07:00:00.000Z", son: "2026-10-06T09:00:00.000Z" },
  { id: "7c000000-0000-4000-8000-000000000002", kaynak: "panel", surum: "1.4.0", kod: "RENDER", sinif: "Error", bilesen: "ekran", yol: "/rolls/:p", yigin: [], sayi: 2, ilk: "2026-10-06T08:00:00.000Z", son: "2026-10-06T08:10:00.000Z" },
];

function open(path: string) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path,
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
      "GET /hata-raporlari": () => ({ data: { items: [{ kurulum: KURULUM, grupSayisi: 2, toplam: 9, sonGorulme: "2026-10-06T09:00:00.000Z" }, { kurulum: null, grupSayisi: 1, toplam: 1, sonGorulme: null }] } }),
      [`GET /hata-raporlari/${KURULUM.id}`]: (req: Recorded) => {
        const kaynak = new URLSearchParams(req.path.split("?")[1] ?? "").get("kaynak");
        return { data: { items: GROUPS.filter((g) => !kaynak || g.kaynak === kaynak) } };
      },
    },
  });
}

describe("hata raporları ekranı", () => {
  it("özet kurulum bazında: grup sayısı, toplam ve ayrıntıya bağ", async () => {
    const { calls } = open("/hata-raporlari");
    const link = await screen.findByRole("link", { name: /Örnek Tekstil › Merkez › Ana sunucu/ });
    expect(link.getAttribute("href")).toBe(`/hata-raporlari/${KURULUM.id}`);
    const row = link.closest("tr")!;
    expect(row.textContent).toContain("2");
    expect(row.textContent).toContain("9");
    expect(writes(calls)).toHaveLength(0);
  });

  it("ayrıntı grupları çizer; kaynak süzmesi sunucuya gider", async () => {
    const { calls } = open(`/hata-raporlari/${KURULUM.id}`);
    expect(await screen.findByText("UNHANDLED")).toBeTruthy();
    expect(screen.getByText("/api/rolls/:id")).toBeTruthy();
    expect(screen.getByText("src/services/roll.service.ts:120")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Kaynak"), "panel");
    expect(await screen.findByText("RENDER")).toBeTruthy();
    expect(screen.queryByText("UNHANDLED")).toBeNull();
    expect(calls.some((c) => c.path.startsWith(`/hata-raporlari/${KURULUM.id}?`) && c.path.includes("kaynak=panel"))).toBe(true);
    expect(writes(calls)).toHaveLength(0);
  });
});
