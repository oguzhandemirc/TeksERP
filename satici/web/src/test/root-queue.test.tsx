// KÖK İMZASI KUYRUĞU — bileşen bekçisi (lisans v2 · G4): ACİL talepler ayrı bölümde ve en üstte, liste süzgeci sunucuya
// gider, iptal kaydı ADIYLA gösterip sebep ister (gövde yalnız işlem kimliği + sebep), kapanmış talepte iptal düğmesi yok,
// tören yönergesi runbook yolunu gösterir; genel yolda (ERİŞİM) iptal ucu ERİŞİM listesinde olduğundan düğme kalır.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CEREMONY_RUNBOOK } from "../portal/pages/RootQueue";
import { PORTAL_ROUTES } from "../portal/routes";
import type { SessionListener } from "../shared/session";
import type { RootRequest } from "../shared/types";
import { renderApp, sessionFor, writes, type Recorded } from "./harness";

const URGENT: RootRequest = {
  id: "7a000000-0000-4000-8000-000000000001",
  hakId: "7a000000-0000-4000-8000-0000000000a1",
  lisansNo: "TKS-2026-0101",
  kurulumId: "7a000000-0000-4000-8000-0000000000c1",
  kurulum: { kurulumId: "9e8d7c6b-0000-4000-8000-0000000000c1", ad: "Ana sunucu", sinif: "URETIM" },
  tabanSurum: 2,
  surum: 3,
  uzunUfuk: false,
  acil: true,
  durum: "BEKLIYOR",
  sebep: "Yetenek düşüşü: güncel şartların kök imzası",
  yapan: "sistem:yetenek-dususu",
  kapanisZamani: null,
  kapanisSebebi: null,
  createdAt: "2026-10-01T09:00:00.000Z",
};
const DONE: RootRequest = { ...URGENT, id: "7a000000-0000-4000-8000-000000000002", lisansNo: "TKS-2026-0102", acil: false, durum: "IMZALANDI", kapanisZamani: "2026-10-01T10:00:00.000Z" };

function open(dinleyici: SessionListener = "ERISIM") {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/kok-kuyrugu",
    handlers: {
      "GET /oturum": () => ({ data: { ...sessionFor("SATICI_OPERATOR"), dinleyici } }),
      "GET /kok-kuyrugu": (req: Recorded) => {
        const q = new URLSearchParams(req.path.split("?")[1] ?? "");
        if (q.get("acil") === "true") return { data: { items: [URGENT], nextCursor: null } };
        const rows = [URGENT, DONE].filter((r) => !q.get("durum") || r.durum === q.get("durum"));
        return { data: { items: rows, nextCursor: null } };
      },
      [`POST /kok-kuyrugu/${URGENT.id}/iptal`]: () => ({ data: { id: URGENT.id, durum: "IPTAL" } }),
    },
  });
}

describe("kök imzası kuyruğu ekranı", () => {
  it("ACİL bölümü fabrikanın kira alamadığını söyler; tören yönergesi runbook yolunu gösterir", async () => {
    const { calls } = open();
    const urgent = (await screen.findByText("Acil kök imzası gerekiyor")).closest("section")!;
    expect(await within(urgent).findByText("TKS-2026-0101")).toBeInTheDocument();
    expect(within(urgent).getByText("ACİL — fabrika kira alamıyor")).toBeInTheDocument();
    expect(screen.getByText(CEREMONY_RUNBOOK)).toBeInTheDocument();
    expect(screen.getByText(/kuyruk-disa-aktar/)).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes("acil=true") && c.path.includes("durum=BEKLIYOR"))).toBe(true);
  });

  it("liste süzgeci sunucuya gider (BEKLIYOR varsayılan, 'Tümü' süzgeçsiz); kapanmış talepte iptal düğmesi yok", async () => {
    const user = userEvent.setup();
    const { calls } = open();
    const list = (await screen.findByText("Liste")).closest("section")!;
    await within(list).findByText("TKS-2026-0101");
    expect(within(list).queryByText("TKS-2026-0102")).toBeNull();
    await user.selectOptions(within(list).getByLabelText("Durum"), "");
    expect(await within(list).findByText("TKS-2026-0102")).toBeInTheDocument();
    const doneRow = within(list).getByText("TKS-2026-0102").closest("tr")!;
    expect(within(doneRow).queryByRole("button", { name: "İptal et" })).toBeNull();
    expect(calls.some((c) => c.method === "GET" && c.path.startsWith("/kok-kuyrugu") && !c.path.includes("durum="))).toBe(true);
  });

  it("⭐ iptal: kaydı ADIYLA gösterir, sebepsiz gönderilmez; gövde yalnız işlem kimliği + sebep", async () => {
    const user = userEvent.setup();
    const { calls } = open();
    const urgent = (await screen.findByText("Acil kök imzası gerekiyor")).closest("section")!;
    await user.click(await within(urgent).findByRole("button", { name: "İptal et" }));
    const dialog = await screen.findByRole("dialog", { name: "Kök imzası talebini iptal et" });
    expect(within(dialog).getByText("TKS-2026-0101 — sürüm 2 → 3 (ACİL)")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "İptal et" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Sebep/), "müşteri yeni derlemeye geçti");
    await user.click(confirm);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe(`/kok-kuyrugu/${URGENT.id}/iptal`);
    expect(Object.keys(w[0]!.body ?? {}).sort()).toEqual(["clientToken", "sebep"]);
    expect(w[0]!.body?.sebep).toBe("müşteri yeni derlemeye geçti");
  });

  it("genel yol (ERİŞİM): iptal düğmesi kalır (uç ERİŞİM listesinde, parola taşımaz)", async () => {
    open("ERISIM");
    const urgent = (await screen.findByText("Acil kök imzası gerekiyor")).closest("section")!;
    expect(await within(urgent).findByRole("button", { name: "İptal et" })).toBeInTheDocument();
  });
});
