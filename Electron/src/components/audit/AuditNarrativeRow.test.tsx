import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab }) } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasAnyPermission: () => true }),
}));

import { AuditNarrativeRow } from "./AuditNarrativeRow";
import type { Anlati } from "@/types/systemLog";

const ANLATI: Anlati = {
  metin: "Ahmet Y., SP-2026-0148 siparişinin Termin tarihini 18.10.2026 → 25.10.2026 yaptı",
  parcalar: [
    { t: "kisi", text: "Ahmet Y." },
    { t: "metin", text: ", " },
    { t: "kayit", text: "SP-2026-0148", ref: { table: "ORDER", id: "11111111-1111-1111-1111-111111111111" } },
    { t: "metin", text: " siparişinin Termin tarihini " },
    { t: "deger", text: "18.10.2026" },
    { t: "metin", text: " → " },
    { t: "deger", text: "25.10.2026" },
    { t: "metin", text: " yaptı" },
  ],
};

describe("AuditNarrativeRow — sunucu anlatısının tek çizicisi", () => {
  it("kişi kalın, değer vurgulu, kayıt tıklanır bağlantı", async () => {
    const { container } = render(<AuditNarrativeRow anlati={ANLATI} />);
    expect(container.querySelector("strong")?.textContent).toBe("Ahmet Y.");
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["18.10.2026", "25.10.2026"]);
    const link = screen.getByRole("link", { name: "SP-2026-0148" });
    fireEvent.click(link);
    await vi.waitFor(() => expect(openTab).toHaveBeenCalled());
    expect(openTab).toHaveBeenCalledWith("/operations/orders?focus=11111111-1111-1111-1111-111111111111", undefined);
    expect(container.textContent).toBe(ANLATI.metin);
  });

  it("anlatı yoksa (eski backend) çağıranın eski satırına düşer", () => {
    render(<AuditNarrativeRow anlati={undefined} fallback={<span>ESKİ SATIR</span>} />);
    expect(screen.getByText("ESKİ SATIR")).toBeTruthy();
    expect(screen.queryByTestId("audit-narrative")).toBeNull();
  });

  it("reddedilen deneme kırmızımsı ikonla işaretlenir", () => {
    render(<AuditNarrativeRow anlati={ANLATI} reddedildi />);
    expect(screen.getByLabelText("Reddedildi")).toBeTruthy();
  });

  it("eşlenmemiş tablodaki kayıt düz metin kalır (ölü bağlantı yok)", () => {
    render(
      <AuditNarrativeRow anlati={{ metin: "X", parcalar: [{ t: "kayit", text: "X-1", ref: { table: "LEVENT", id: "a" } }] }} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

// ── TEK ÇİZİCİ BEKÇİSİ ─────────────────────────────────────────────────────
// Etkinlik akışı ile ⓘ Geçmiş AYNI bileşeni kullanır; anlatı parçalarını başka
// bir dosyada yeniden çizmek (kopya bileşen) yasak — biri bağlantıyı öğrenip
// öteki düz metinde kalırdı. Sondalar (2026-10-25): kopya `parcalar.map(` → 1 kırmızı;
// servise `post(BASE, { anlati })` → 1 kırmızı.
const SRC = join(__dirname, "..", "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("tek çizici: Etkinlik ↔ Geçmiş", () => {
  const IMPORT = /from\s+"@\/components\/audit\/AuditNarrativeRow"/;
  it.each([
    "components/RecordHistoryDialog.tsx",
    "pages/System/Activity/ActivityFeed.tsx",
    "pages/System/Activity/ActivityDetailSheet.tsx",
  ])("%s AuditNarrativeRow'u ithal eder", (f) => {
    expect(readFileSync(join(SRC, f), "utf8")).toMatch(IMPORT);
  });

  it("anlatı parçalarını yalnız AuditNarrativeRow çizer", () => {
    const kopya = walk(SRC)
      .filter((p) => /parcalar\s*\.\s*map\s*\(/.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p));
    expect(kopya).toEqual(["components/audit/AuditNarrativeRow.tsx"]);
  });

  it("istemci anlatıyı sunucuya geri yazmaz (anlatı yalnız görüntü)", () => {
    const yazan = walk(join(SRC, "services"))
      .concat(walk(join(SRC, "lib")))
      .filter((p) => /\.(post|put|patch)\s*(<[^>]*>)?\s*\([^;]*\banlati\b/s.test(readFileSync(p, "utf8")))
      .map((p) => relative(SRC, p));
    expect(yazan).toEqual([]);
  });
});
