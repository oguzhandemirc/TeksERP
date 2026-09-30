// BİLDİRİMLER görünümü — kanal durumu (sunucu satırların sonucundan türetir) + son bildirimler + deneme bildirimi.
// Deneme düğmesi yalnız `bildirim:yonet`te (yönetici) çizilir ve işlem kimliğiyle giden kutusuna yazar; operatör
// yalnız okur. Satır bağlantısı gövdenin portal yoluna gider.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PORTAL_ROUTES } from "../portal/routes";
import type { PortalRole } from "../shared/permissions";
import type { NotificationOverview, NotificationRow } from "../shared/types";
import { renderApp, sessionFor, writes } from "./harness";

const TALEP = "7f1e2d3c-0000-4000-8000-00000000d001";

const OVERVIEW: NotificationOverview = {
  kanallar: [
    { kanal: "EPOSTA", durum: "YAPILANDIRILMAMIS", sonGonderim: null, sonSonuc: { durum: "KAPALI", kod: "KANAL_YAPILANDIRILMAMIS", zaman: "2026-09-30T10:00:00.000Z" }, bekleyen: 0, geciken: 0 },
    { kanal: "TELEGRAM", durum: "CALISIYOR", sonGonderim: "2026-09-30T10:00:05.000Z", sonSonuc: { durum: "GONDERILDI", kod: null, zaman: "2026-09-30T10:00:05.000Z" }, bekleyen: 1, geciken: 0 },
  ],
  esikler: { sessizSaat: 24, vadeGun: 7, taramaDk: 15, sessizSiniflar: ["URETIM", "DR", "BARINDIRILAN"] },
};

const ROW: NotificationRow = {
  id: "7f1e2d3c-0000-4000-8000-00000000b001",
  olay: "DESTEK_TALEBI",
  kanal: "TELEGRAM",
  durum: "GONDERILDI",
  deneme: 1,
  sonrakiDeneme: "2026-09-30T10:00:00.000Z",
  sonHata: null,
  gonderimZamani: "2026-09-30T10:00:05.000Z",
  govde: { musteri: "Örnek Tekstil", tesis: "Ana tesis", kurulum: "Merkez sunucu", lisansNo: "TKS-2026-0042", sinif: "URETIM", konu: "Tartı ekranı donuyor", referans: "DST-000012", tarih: null, portalYolu: `/destek/${TALEP}` },
  kurulumId: "5b0c6a4e-1111-4000-8000-000000000001",
  createdAt: "2026-09-30T10:00:00.000Z",
  updatedAt: "2026-09-30T10:00:05.000Z",
};

function open(role: PortalRole) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path: "/bildirimler",
    handlers: {
      "GET /oturum": () => ({ data: sessionFor(role) }),
      "GET /bildirimler/durum": () => ({ data: OVERVIEW }),
      "GET /bildirimler": () => ({ data: { items: [ROW], nextCursor: null } }),
      "POST /bildirimler/deneme": () => ({ status: 201, data: { yazilan: 2, kanallar: ["EPOSTA", "TELEGRAM"] } }),
    },
  });
}

describe("bildirimler görünümü", () => {
  it("kanal durumu ve son bildirimler çizilir; satır portal yoluna bağlanır", async () => {
    open("SATICI_OPERATOR");
    expect(await screen.findByText("Kanal yapılandırılmamış")).toBeInTheDocument();
    expect(screen.getByText("Çalışıyor")).toBeInTheDocument();
    expect(screen.getByText(/Gönderildi/, { selector: ".badge" })).toBeInTheDocument();
    const row = (await screen.findByText("Örnek Tekstil › Ana tesis › Merkez sunucu")).closest("tr")!;
    expect(within(row).getByText("Yeni destek talebi")).toBeInTheDocument();
    expect(within(row).getByText("Tartı ekranı donuyor")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Aç" })).toHaveAttribute("href", `/destek/${TALEP}`);
    expect(screen.getByText("24 saat başarılı yoklama yok")).toBeInTheDocument();
  });

  it("operatör deneme düğmesini görmez (bildirim:yonet yalnız yönetici)", async () => {
    open("SATICI_OPERATOR");
    await screen.findByText("Çalışıyor");
    expect(screen.queryByRole("button", { name: "Deneme bildirimi gönder" })).toBeNull();
  });

  it("yönetici deneme bildirimi gönderir: işlem kimliğiyle tek yazma", async () => {
    const user = userEvent.setup();
    const { calls } = open("SATICI_YONETICI");
    await user.click(await screen.findByRole("button", { name: "Deneme bildirimi gönder" }));
    expect(await screen.findByText(/Giden kutusuna 2 satır yazıldı/)).toBeInTheDocument();
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe("/bildirimler/deneme");
    expect(w[0]!.body).toEqual({ clientToken: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) });
  });
});
