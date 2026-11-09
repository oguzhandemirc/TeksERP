// İE detayı "Gelen" künyesi (2026-11-09): belge no bağlantısı (izin varsa) + gelen en + müşteri parti no; eski sunucu / belgesiz
// İE → çizilmez. Negatif sonda: `canOpen` dalı kaldırılıp hep Link çizilince §2 kırmızı; `widthCm == null` dalı kaldırılınca
// (Number(null)=0) §3 "Gelen en 0 cm" çıkar ve kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IncomingDoc } from "./IncomingDoc";

const perm = { read: true };
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (c: string) => c === "gelen-belge:read" && perm.read }) }));

const view = (incoming: Parameters<typeof IncomingDoc>[0]["incoming"]) =>
  render(
    <MemoryRouter>
      <IncomingDoc incoming={incoming} />
    </MemoryRouter>,
  );

describe("İE detayı Gelen künyesi", () => {
  beforeEach(() => {
    perm.read = true;
  });

  it("⭐ §1 belge no gelen belge detayına bağlantı; en + müşteri parti görünür", () => {
    view({ meters: 150, kg: null, kgSource: null, notes: [{ id: "n1", noteNo: "GB-1" }, { id: "n2", noteNo: "GB-2" }], widthCm: "152.50", customerBatchNo: "A, B" });
    expect(screen.getByRole("link", { name: "GB-1" }).getAttribute("href")).toBe("/operations/gelen-belgeler/n1");
    expect(screen.getByRole("link", { name: "GB-2" }).getAttribute("href")).toBe("/operations/gelen-belgeler/n2");
    expect(screen.getByTestId("wo-incoming-width")).toHaveTextContent(/^Gelen en 152,5 cm$/);
    expect(screen.getByTestId("wo-incoming-batch")).toHaveTextContent(/^Müşteri parti A, B$/);
  });

  it("⭐ §2 gelen belge okuma izni yoksa belge no düz metin (bağlantı yok)", () => {
    perm.read = false;
    view({ meters: 150, kg: null, kgSource: null, notes: [{ id: "n1", noteNo: "GB-1" }], widthCm: null, customerBatchNo: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("wo-incoming-notes")).toHaveTextContent("Belge GB-1");
  });

  it("⭐ §3 en karışık/eksik (null) → en satırı yok; parti no yoksa parti satırı yok", () => {
    view({ meters: 150, kg: null, kgSource: null, notes: [{ id: "n1", noteNo: "GB-1" }], widthCm: null, customerBatchNo: null });
    expect(screen.queryByTestId("wo-incoming-width")).toBeNull();
    expect(screen.queryByTestId("wo-incoming-batch")).toBeNull();
  });

  it("eski sunucu (yeni alanlar yok) ya da belgesiz İE → çizilmez", () => {
    const { container } = view({ meters: 150, kg: "10", kgSource: "DOCUMENT" });
    expect(container).toBeEmptyDOMElement();
    view(null);
    expect(screen.queryByTestId("wo-incoming-notes")).toBeNull();
  });
});
