// DONANIM ONAYLARI — bileşen bekçisi (lisans v2 · K8): satır etken etken karşılaştırma taşır (güçlü etkenler kalın),
// değerlendirme üç durumludur (güçlüler tutuyor · kopya olabilir · zayıf tanıma), süzgeçler sunucuya gider,
// onay/ret kaydı ADIYLA gösterip sebep ister ve DOĞRU uca (onayla/reddet) yalnız işlem kimliği + sebep gönderir; kararlı
// talepte düğme yok.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { HardwareRequest } from "../shared/types";
import { renderApp, sessionFor, writes, type Recorded } from "./harness";

const BASE: HardwareRequest = {
  id: "6b000000-0000-4000-8000-000000000001",
  kurulumId: "6b000000-0000-4000-8000-0000000000c1",
  kurulum: { kurulumId: "9e8d7c6b-0000-4000-8000-0000000000c1", ad: "Ana sunucu", sinif: "URETIM", tesis: { ad: "Merkez", musteri: { ad: "Örnek Tekstil" } } },
  tur: "DONANIM",
  durum: "BEKLIYOR",
  anahtarKimligi: "kurulum-abc",
  kayip: [],
  gerekce: "anakart değişti",
  otomatik: false,
  bildirimSayisi: 2,
  sonBildirim: "2026-10-01T09:00:00.000Z",
  kararZamani: null,
  kararVeren: null,
  kararSebebi: null,
  createdAt: "2026-10-01T08:00:00.000Z",
  karsilastirma: { etkenler: { f1: "AYNI", f2: "FARKLI", f3: "AYNI", f4: "FARKLI", f5: "KAYIP" }, guclu: ["f2", "f3", "f4"], tutanGuclu: 1, kural: "standart", ogrenilebilir: false, zayif: false },
};
const WEAK: HardwareRequest = {
  ...BASE,
  id: "6b000000-0000-4000-8000-000000000002",
  tur: "ZAYIF_TANIMA",
  kurulum: { ...BASE.kurulum, ad: "Sanal sunucu" },
  karsilastirma: { etkenler: { f1: "AYNI", f2: "YOK", f3: "YOK", f4: "YOK", f5: "AYNI" }, guclu: ["f2", "f3", "f4"], tutanGuclu: 0, kural: "zayif", ogrenilebilir: true, zayif: true },
};
const DECIDED: HardwareRequest = { ...BASE, id: "6b000000-0000-4000-8000-000000000003", durum: "ONAYLANDI", otomatik: true, kurulum: { ...BASE.kurulum, ad: "Öğrenen sunucu" }, kararSebebi: "Güçlü etkenler tuttu" };

function open(role: "SATICI_OPERATOR" | "SATICI_YONETICI" = "SATICI_OPERATOR") {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/donanim-talepleri",
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      "GET /donanim-talepleri": (req: Recorded) => {
        const q = new URLSearchParams(req.path.split("?")[1] ?? "");
        const rows = [BASE, WEAK, DECIDED].filter((r) => (!q.get("durum") || r.durum === q.get("durum")) && (!q.get("tur") || r.tur === q.get("tur")));
        return { data: { items: rows, nextCursor: null } };
      },
      [`POST /donanim-talepleri/${BASE.id}/onayla`]: () => ({ data: { id: BASE.id, durum: "ONAYLANDI" } }),
      [`POST /donanim-talepleri/${WEAK.id}/reddet`]: () => ({ data: { id: WEAK.id, durum: "REDDEDILDI" } }),
    },
  });
}

const rowOf = async (text: string) => (await screen.findByText(new RegExp(text))).closest("tr")!;

describe("donanım onayları ekranı", () => {
  it("etken etken karşılaştırma (güçlüler kalın, durum ekran adıyla) ve üç durumlu değerlendirme", async () => {
    open();
    const row = await rowOf("Ana sunucu");
    expect(within(row).getByText("SMBIOS UUID: farklı").tagName).toBe("STRONG");
    expect(within(row).getByText("Makine kimliği: aynı").tagName).not.toBe("STRONG");
    expect(within(row).getByText("PostgreSQL kimliği: kayıp (okunamıyor)")).toBeInTheDocument();
    expect(within(row).getByText("Güçlü etken 1/3 — kopya olabilir")).toBeInTheDocument();
    expect(within(await rowOf("Sanal sunucu")).getByText("Zayıf tanıma: güçlü şartı sağlanamıyor")).toBeInTheDocument();
  });

  it("süzgeçler sunucuya gider: varsayılan BEKLIYOR, tür süzgeci `tur` parametresi", async () => {
    const user = userEvent.setup();
    const { calls } = open();
    await rowOf("Ana sunucu");
    expect(screen.queryByText(/Öğrenen sunucu/)).toBeNull();
    await user.selectOptions(screen.getByLabelText("Tür"), "ZAYIF_TANIMA");
    await screen.findByText(/Sanal sunucu/);
    expect(screen.queryByText(/Ana sunucu/)).toBeNull();
    expect(calls.some((c) => c.path.includes("durum=BEKLIYOR") && c.path.includes("tur=ZAYIF_TANIMA"))).toBe(true);
  });

  it("kararlı talep (kendiliğinden öğrenilmiş) düğmesiz ve 'kendiliğinden' yazar", async () => {
    const user = userEvent.setup();
    open();
    await rowOf("Ana sunucu");
    await user.selectOptions(screen.getByLabelText("Durum"), "ONAYLANDI");
    const row = await rowOf("Öğrenen sunucu");
    expect(within(row).getByText(/Onaylandı \(kendiliğinden\) — Güçlü etkenler tuttu/)).toBeInTheDocument();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("⭐ onay: kaydı adıyla gösterir, sebepsiz gönderilmez; /onayla ucuna yalnız işlem kimliği + sebep", async () => {
    const user = userEvent.setup();
    const { calls } = open();
    await user.click(within(await rowOf("Ana sunucu")).getByRole("button", { name: "Onayla" }));
    const dialog = await screen.findByRole("dialog", { name: "Talebi onayla" });
    expect(within(dialog).getByText(/Donanım değişikliği — Örnek Tekstil › Merkez › Ana sunucu — tutan güçlü etken 1\/3/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Bildirilen küme kabul edilen küme olur/)).toBeInTheDocument();
    const ok = within(dialog).getByRole("button", { name: "Onayla" });
    expect(ok).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Sebep/), "müşteri anakartı değiştirdi");
    await user.click(ok);
    const w = writes(calls);
    expect(w.map((c) => c.path)).toEqual([`/donanim-talepleri/${BASE.id}/onayla`]);
    expect(Object.keys(w[0]!.body ?? {}).sort()).toEqual(["clientToken", "sebep"]);
  });

  it("ret /reddet ucuna gider ve zayıf tanıma onayının metni ayrı", async () => {
    const user = userEvent.setup();
    const { calls } = open();
    const row = await rowOf("Sanal sunucu");
    await user.click(within(row).getByRole("button", { name: "Onayla" }));
    expect(await screen.findByText(/zayıf tanımayla etkinleşebilir/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Vazgeç" }));
    await user.click(within(row).getByRole("button", { name: "Reddet" }));
    const dialog = await screen.findByRole("dialog", { name: "Talebi reddet" });
    await user.type(within(dialog).getByLabelText(/Sebep/), "tanınmayan makine");
    await user.click(within(dialog).getByRole("button", { name: "Reddet" }));
    expect(writes(calls).map((c) => c.path)).toEqual([`/donanim-talepleri/${WEAK.id}/reddet`]);
  });
});
