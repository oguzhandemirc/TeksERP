// Bildirim ikonu kapsaması (denetim 2026-11-15): fabrika kataloğundaki her tür ön eki genel zile DÜŞMEZ.
// Katalog metin olarak okunur (içe aktarma yok). NEGATİF SONDA (geri alındı): `stok` ön eki silinince ❌.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { erpBildirimGorunusu, onEkGorunusu } from "../src/lib/erp-bildirim";

const KATALOG = join(__dirname, "../../../Teks-Erp/src/constants");
const onEkler = (): string[] => {
  const set = new Set<string>();
  for (const f of readdirSync(KATALOG).filter((n) => n.startsWith("notification-catalog") && n.endsWith(".ts"))) {
    for (const m of readFileSync(join(KATALOG, f), "utf8").matchAll(/\n\s*"([a-z]+)\.[a-z0-9-]+":\s*\{/g)) set.add(m[1]!);
  }
  return [...set].sort();
};

describe("ERP bildirim ikonu", () => {
  it("⭐ katalogdaki her ön ek tanınır (genel zile düşmez)", () => {
    const hepsi = onEkler();
    expect(hepsi.length).toBeGreaterThan(15);
    const dusen = hepsi.filter((k) => onEkGorunusu(k).icon === "notifications-outline");
    expect(dusen).toEqual([]);
  });
  it("grup ikonu: teklif satış belgesi, stok depo, dokuma katman; bilinmeyen ön ek zil", () => {
    expect(erpBildirimGorunusu("teklif.kabul")).toEqual({ ad: "teklif.kabul", domain: "siparisler", icon: "document-text-outline" });
    expect(erpBildirimGorunusu("stok.yaslanan").domain).toBe("stok");
    expect(erpBildirimGorunusu("dokuma.levent-bitti").icon).toBe("layers-outline");
    expect(erpBildirimGorunusu("cari.kilitlendi").domain).toBe("cariler");
    expect(erpBildirimGorunusu("bilinmeyen.x").icon).toBe("notifications-outline");
    expect(erpBildirimGorunusu(42).ad).toBe("—");
  });
});
