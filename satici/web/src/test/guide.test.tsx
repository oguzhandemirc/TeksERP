// KILAVUZ — bileşen bekçisi (yıllık tören, 2026-10-06). Menüde görünür; sıradaki tören tarihi anahtar künyesinden
// CANLI türer (kullanım başına en geç biten yüklü aktif sertifika → en erkeni − 30 gün; sunucunun süre uyarısıyla aynı
// seçim); sayfa hiçbir açık anahtar/sır göstermez ve yalnız okur.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { nextCeremony } from "../portal/pages/Guide";
import { PORTAL_ROUTES } from "../portal/routes";
import { fmtDate } from "../shared/format";
import type { KeyStatus } from "../shared/types";
import { renderApp, sessionFor, writes } from "./harness";

const DAY = 86_400_000;
type Row = KeyStatus["anahtarlar"][number];

function row(kid: string, tur: string, endMs: number | null, over: Partial<Row> = {}): Row {
  return {
    kid,
    tur,
    acikAnahtar: `GIZLI-ACIK-${kid}-${"x".repeat(30)}`,
    siniflar: ["URETIM"],
    baslangic: endMs === null ? null : new Date(endMs - 395 * DAY).toISOString(),
    bitis: endMs === null ? null : new Date(endMs).toISOString(),
    durum: "AKTIF",
    yuklu: true,
    suresiDoldu: false,
    capada: null,
    sertifikaVeren: "kok-2026-1",
    updatedAt: "2026-10-05T10:00:00.000Z",
    ...over,
  };
}

function keys(now: number): KeyStatus {
  return {
    capa: { kaynak: "gömülü", kokler: [{ kid: "kok-2026-1", x: "KOK-ACIK-ANAHTAR-SIZMAMALI", siniflar: ["URETIM"] }] },
    anahtarlar: [
      row("kok-2026-1", "KOK", null, { sertifikaVeren: null }),
      row("alt-2026-1", "ALT", now + 20 * DAY), // aynı kullanımda daha yenisi var → seçilmez
      row("alt-2026-2", "ALT", now + 120 * DAY),
      row("ara-2026-1", "ARA", now + 125 * DAY),
      row("ind-2026-2", "INDIRME", now + 400 * DAY),
      row("ind-2026", "INDIRME", now + 5 * DAY, { durum: "EMEKLI", yuklu: false }),
    ],
    kiraImzalayabilir: true,
    indirmeAnahtari: "ind-2026-2",
    uyarilar: [],
  };
}

function open(data: KeyStatus) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/kilavuz",
    handlers: {
      "GET /oturum": () => ({ data: sessionFor("SATICI_OPERATOR") }),
      "GET /anahtarlar": () => ({ data }),
    },
  });
}

describe("kılavuz sayfası", () => {
  it("menüde görünür; sıradaki tören = kullanım başına en geç bitişlerin en erkeni − 30 gün, kalan gün canlı", async () => {
    const now = Date.now();
    const { calls } = open(keys(now));
    const line = await screen.findByTestId("sonraki-toren");
    expect(within(screen.getByRole("navigation", { name: "Ana menü" })).getByRole("link", { name: "Kılavuz" })).toBeInTheDocument();
    expect(line).toHaveTextContent(`Sıradaki tören: ${fmtDate(new Date(now + 90 * DAY).toISOString())}`);
    expect(line).toHaveTextContent("90 gün kaldı");
    expect(screen.getByText(/İlk bitecek anahtar: Alt \(kira imzası\) · alt-2026-2/)).toBeInTheDocument();
    expect(writes(calls)).toEqual([]);
    expect(calls.map((c) => c.path).sort()).toEqual(["/anahtarlar", "/oturum"]);
  });

  it("sayfada sır yok: açık anahtarlar, çapa değeri ve parola biçimli metin görünmez; yerler ve kayıt adları var", async () => {
    const now = Date.now();
    const data = keys(now);
    const { container } = open(data);
    await screen.findByTestId("sonraki-toren");
    const text = container.textContent ?? "";
    for (const r of data.anahtarlar) expect(text).not.toContain(r.acikAnahtar);
    expect(text).not.toContain("KOK-ACIK-ANAHTAR-SIZMAMALI");
    expect(text).not.toMatch(/parola\s*[:=]\s*\S/i);
    for (const yer of ["TeksERP-Drive-Yedek", "TeksERP ara-2026-1", "~/.tekserp/satici-uretim", "kâğıtta", "dönem töreni yapalım"]) expect(text).toContain(yer);
  });

  it("tören zamanı geçti / süre doldu / eksik kullanım ayrı uyarılır", async () => {
    const now = Date.now();
    open({ ...keys(now), anahtarlar: [row("alt-2026-2", "ALT", now + 10 * DAY), row("ara-2026-1", "ARA", now + 200 * DAY)] });
    expect(await screen.findByTestId("sonraki-toren")).toHaveTextContent("Tören zamanı geldi — bitişe 10 gün");
    expect(screen.getByText(/Yüklü anahtarı olmayan tür: İndirme belirteci/)).toBeInTheDocument();
  });
});

describe("nextCeremony (saf)", () => {
  const now = Date.parse("2026-10-06T00:00:00.000Z");
  it("emekli, yüklü olmayan, bitişsiz ve tören dışı türler sayılmaz; hiç yoksa null", () => {
    expect(nextCeremony([row("kok-2026-1", "KOK", null), row("bayi-x", "BAYI", now + DAY), row("alt-2026-1", "ALT", now + DAY, { yuklu: false })])).toBeNull();
    const p = nextCeremony(keys(now).anahtarlar)!;
    expect(p).toMatchObject({ tur: "ALT", kid: "alt-2026-2", endMs: now + 120 * DAY, ceremonyMs: now + 90 * DAY, missing: [] });
  });

  it("bugünkü üretim anahtarları (bitiş 2027-02-02) → tören 2027-01-03", () => {
    const end = Date.parse("2027-02-02T12:00:00.000Z");
    const p = nextCeremony([row("alt-2026-2", "ALT", end), row("ara-2026-1", "ARA", end), row("ind-2026-2", "INDIRME", end)])!;
    expect(new Date(p.ceremonyMs).toISOString().slice(0, 10)).toBe("2027-01-03");
  });
});
