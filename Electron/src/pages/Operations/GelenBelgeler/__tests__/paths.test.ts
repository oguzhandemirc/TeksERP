// E4b paths.ts tek kaynak: route tablosu `path: "…"` YAZISINI taşımak zorunda (command-entries · route-modules ·
// search-targets bekçileri content-routes kaynak metnini regex'le okur; sabite çevirmek onları kör ederdi).
// Bu yüzden yazı sabitle EŞİTLİĞE bağlanır: biri yalnız birini değiştirirse kırmızı.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_DEFAULTS_PATH, TEACH_ROUTE, TEACH_START_PATH } from "../paths";
// T5: gelen belge kurulum karoları Tanımlar'a taşındı (adresleri aynı).
import { incomingDocumentTiles } from "@/pages/Definitions/tiles/incoming-documents";

const ROUTES_SRC = readFileSync(resolve(__dirname, "../../../../routes/content-routes.tsx"), "utf8");
const routePaths = [...ROUTES_SRC.matchAll(/path:\s*"([^"]+)"/g)].map((m) => `/${m[1]}`);

describe("gelen belge alt ekran adresleri tek kaynak", () => {
  it("route tablosundaki müşteri varsayılanları yolu CUSTOMER_DEFAULTS_PATH ile aynı", () => {
    expect(routePaths).toContain(CUSTOMER_DEFAULTS_PATH);
    expect(routePaths.filter((p) => p.endsWith("/varsayilan-urunler"))).toEqual([CUSTOMER_DEFAULTS_PATH]);
  });
  it("karo aynı sabite gider", () => {
    const tile = incomingDocumentTiles.find((t) => t.key === "gelen-belge-varsayilan-urunler");
    expect(tile?.to).toBe(CUSTOMER_DEFAULTS_PATH);
  });
  it("tanıtma (S1b) yolu route tablosunda TEACH_ROUTE ile aynı", () => {
    expect(routePaths.filter((p) => p.endsWith("/tanit"))).toEqual([TEACH_START_PATH, TEACH_ROUTE]);
  });
  it("Belge Tanıt karosu (K30-T) başlangıç yoluna gider; route statik segmenti `:id`den önce", () => {
    expect(incomingDocumentTiles.find((t) => t.key === "gelen-belge-tanit")?.to).toBe(TEACH_START_PATH);
    expect(routePaths.indexOf(TEACH_START_PATH)).toBeLessThan(routePaths.indexOf("/operations/gelen-belgeler/:id"));
  });
});
