// T1/T9 — eski Müşteriler / Fason Firmalar adresleri Cariler'e yönlenir; kırık link olmaz, arama ve rol taşınır.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTabMeta } from "@/components/layout/tabs/tab-meta";
import { cariFilters } from "../CarilerFilterRow";
import { cariSearchPath, legacyCariTarget } from "./legacy-cari";

const ROUTES = readFileSync(resolve(__dirname, "../../../routes/content-routes.tsx"), "utf8");

describe("eski cari adresleri → Cariler", () => {
  it("Müşteriler → süzgeçsiz Cariler; arama terimi taşınır", () => {
    expect(legacyCariTarget("customers", new URLSearchParams())).toBe("/definitions/cariler");
    expect(legacyCariTarget("customers", new URLSearchParams({ search: "moda" }))).toBe("/definitions/cariler?search=moda");
  });

  it("⭐ Fason Firmalar → Cariler + 'Fason yapan' süzgeci (Cariler'in kendi süzgeci okur)", () => {
    const target = legacyCariTarget("subcontractors", new URLSearchParams({ search: "boya" }));
    const params = new URL(target, "http://x").searchParams;
    expect(cariFilters(params.get("filter[direction]"), params.get("filter[subcontractor]"))).toEqual({ direction: "ALL", subcontractor: "YES" });
    expect(params.get("search")).toBe("boya");
  });

  it("palet 'Tümünü aç' yolu Cariler'dir", () => {
    expect(cariSearchPath("a b")).toBe("/definitions/cariler?search=a+b");
  });

  it("⭐ iki eski adres route'ta yönlendirme olarak duruyor (kırık link yok) ve sekme adı 'Cariler'", () => {
    expect(ROUTES).toMatch(/path: "definitions\/customers", element: <LegacyCariRedirect screen="customers" \/>/);
    expect(ROUTES).toMatch(/path: "definitions\/subcontractors", element: <LegacyCariRedirect screen="subcontractors" \/>/);
    expect(resolveTabMeta("/definitions/customers").title).toBe("Cariler");
    expect(resolveTabMeta("/definitions/subcontractors?search=x").title).toBe("Cariler");
  });
});
