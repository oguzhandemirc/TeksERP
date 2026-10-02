// İPTAL BELGELERİ + ANAHTARLAR — bileşen bekçisi (lisans v2 · G4 §2.3). İptal ekranı fabrikalara giden sırayı, kapıda
// bekleyen belgeyi ve engellerini (HAK → yeniden bas · ANAHTAR → emekliye ayır) gösterir. Toplu yeniden basım ara imzacı
// parolası ister: düğme YALNIZ tailnet/geri döngü oturumunda (genel yolda ERİŞİM düğme yok, yol gösteren açıklama var,
// uç çağrılmaz); gövde seçilen HAK'lar + sebep + parola, sonuç satır satır (basılan · atlanan + neden). Anahtarlar ekranı
// ara imzacıyı türüyle, sertifikayı veren kökle, emekli anahtarları ayrı bölümde gösterir.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { REISSUE_OFF_PUBLIC } from "../portal/pages/Revocations";
import { PORTAL_ROUTES } from "../portal/routes";
import type { SessionListener } from "../shared/session";
import type { KeyStatus, ReissueResponse, RevocationStatus } from "../shared/types";
import { renderApp, sessionFor, writes, type Handler } from "./harness";

const HAK_A = "8c000000-0000-4000-8000-0000000000a1";
const HAK_B = "8c000000-0000-4000-8000-0000000000b1";
const STATUS: RevocationStatus = {
  belgeler: [
    { id: "r5", iptalId: "iptal-5", sira: 5, imzalayanKid: "kok-2026-1", verilis: "2026-10-01T08:00:00.000Z", kidler: ["ara-2026-1"], yukleyen: "kurulum-cli", createdAt: "2026-10-01T09:00:00.000Z" },
    { id: "r3", iptalId: "iptal-3", sira: 3, imzalayanKid: "kok-2026-1", verilis: "2026-07-01T08:00:00.000Z", kidler: ["alt-2026-1"], yukleyen: "kurulum-cli", createdAt: "2026-07-01T09:00:00.000Z" },
  ],
  dagitilanSira: 3,
  bekleyen: {
    sira: 5,
    engeller: [
      { tur: "HAK", hakId: HAK_A, lisansNo: "TKS-2026-0201", surum: 4, kid: "ara-2026-1" },
      { tur: "HAK", hakId: HAK_A, lisansNo: "TKS-2026-0201", surum: 3, kid: "ara-2026-1" },
      { tur: "HAK", hakId: HAK_B, lisansNo: "TKS-2026-0202", surum: 2, kid: "ara-2026-1" },
      { tur: "ANAHTAR", kid: "ara-2026-1" },
    ],
  },
};
const RESULT: ReissueResponse = {
  basilan: [{ hakId: HAK_A, surum: 5, imzalayanKid: "ara-2026-2" }],
  sonuclar: [
    { hakId: HAK_A, durum: "IMZALANACAK", neden: null },
    { hakId: HAK_B, durum: "ATLANDI", neden: "kurulum hak-ara yeteneği bildirmiyor" },
  ],
};

function open(path: string, dinleyici: SessionListener = "TAILNET", extra: Record<string, Handler> = {}) {
  return renderApp({
    base: "/portal/api",
    routes: PORTAL_ROUTES,
    path,
    handlers: {
      "GET /oturum": () => ({ data: { ...sessionFor("SATICI_OPERATOR"), dinleyici } }),
      "GET /iptal-belgeleri": () => ({ data: STATUS }),
      "POST /haklar/toplu-yeniden-bas": () => ({ status: 201, data: RESULT }),
      ...extra,
    },
  });
}

describe("iptal belgeleri ekranı", () => {
  it("dağıtılan sıra, kapıda bekleyen belge ve engelleri (ne yapılacağıyla); defterde durum rozeti", async () => {
    open("/iptal-belgeleri");
    expect(await screen.findByText("Sıra 5 — 4 engel")).toBeInTheDocument();
    const blockers = screen.getByText("Bekleyen belgenin engelleri (sıra 5)").closest("section")!;
    expect(within(blockers).getByText("TKS-2026-0201 — sürüm 4 (ara-2026-1)")).toBeInTheDocument();
    expect(within(blockers).getAllByText(/emekliye ayrılmalı/).length).toBe(1);
    const ledger = screen.getByText("Defter").closest("section")!;
    expect(within(within(ledger).getByText("ara-2026-1").closest("tr")!).getByText("Kapıda bekliyor")).toBeInTheDocument();
    expect(within(within(ledger).getByText("alt-2026-1").closest("tr")!).getByText("Dağıtılıyor")).toBeInTheDocument();
  });

  it("⭐ toplu yeniden basım (tailnet): HAK başına tek satır, sebep + parola zorunlu; gövde seçilen HAK'lar; sonuç satır satır", async () => {
    const user = userEvent.setup();
    const { calls } = open("/iptal-belgeleri");
    await user.click(await screen.findByRole("button", { name: "Engelli HAK'ları yeniden bas…" }));
    const dialog = await screen.findByRole("dialog", { name: "Engelli HAK'ları ara imzacıyla yeniden bas" });
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);
    const go = within(dialog).getByRole("button", { name: "Yeniden bas" });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/^Sebep/), "acil iptal turu");
    await user.type(within(dialog).getByLabelText(/^Ara imzacı parolası/), "ara-parola");
    await user.click(go);
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe("/haklar/toplu-yeniden-bas");
    expect(w[0]!.body).toMatchObject({ hakIdleri: [HAK_A, HAK_B], sebep: "acil iptal turu", imzaParolasi: "ara-parola" });
    const done = await screen.findByRole("dialog", { name: "Toplu yeniden basım sonucu" });
    expect(within(within(done).getByText("TKS-2026-0201").closest("tr")!).getByText("Yeniden basıldı")).toBeInTheDocument();
    expect(within(done).getByText("kurulum hak-ara yeteneği bildirmiyor")).toBeInTheDocument();
  });

  it("⭐ genel yol (ERİŞİM): yeniden basım düğmesi YOK, tailnet yolunu anlatan açıklama var, uç çağrılmaz", async () => {
    const { calls } = open("/iptal-belgeleri", "ERISIM");
    expect(await screen.findByText(REISSUE_OFF_PUBLIC)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /yeniden bas/ })).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(writes(calls)).toHaveLength(0);
  });

  it("menüde 'İptal belgeleri' (anahtar:oku) görünür", async () => {
    open("/iptal-belgeleri");
    expect(await screen.findByRole("link", { name: "İptal belgeleri" })).toBeInTheDocument();
  });
});

const KEYS: KeyStatus = {
  capa: { kaynak: "gomulu", kokler: [{ kid: "kok-2026-1", x: "x".repeat(43), siniflar: ["URETIM"] }] },
  anahtarlar: [
    { kid: "ara-2026-2", tur: "ARA", acikAnahtar: "a".repeat(43), siniflar: ["URETIM"], baslangic: "2026-10-01T00:00:00.000Z", bitis: new Date(Date.now() + 10 * 86_400_000).toISOString(), durum: "AKTIF", yuklu: true, suresiDoldu: false, capada: null, sertifikaVeren: "kok-2026-1", updatedAt: "2026-10-01T00:00:00.000Z" },
    { kid: "ara-2026-1", tur: "ARA", acikAnahtar: "b".repeat(43), siniflar: ["URETIM"], baslangic: "2026-06-01T00:00:00.000Z", bitis: "2026-09-29T00:00:00.000Z", durum: "EMEKLI", yuklu: false, suresiDoldu: true, capada: null, sertifikaVeren: "kok-2026-1", updatedAt: "2026-10-01T00:00:00.000Z" },
  ],
  kiraImzalayabilir: true,
  indirmeAnahtari: "ind-2026-2",
  uyarilar: [],
};

describe("anahtarlar ekranı (ara imzacı · sertifika · emekli)", () => {
  it("ara imzacı türüyle, sertifikayı veren kökle ve tören uyarısıyla; emekli anahtar ayrı bölümde", async () => {
    open("/anahtarlar", "TAILNET", { "GET /anahtarlar": () => ({ data: KEYS }) });
    const active = (await screen.findByText("Anahtar künyesi")).closest("section")!;
    const row = within(active).getByText("ara-2026-2").closest("tr")!;
    expect(within(row).getByText("Ara imzacı (HAK)")).toBeInTheDocument();
    expect(within(row).getByText("kök imzalı (kok-2026-1)")).toBeInTheDocument();
    expect(within(row).getByText(/gün kaldı — dönem töreni/)).toBeInTheDocument();
    expect(within(active).queryByText("ara-2026-1")).toBeNull();
    const retired = screen.getByText("Emekli anahtarlar").closest("section")!;
    expect(within(retired).getByText("ara-2026-1")).toBeInTheDocument();
    expect(within(retired).queryByText(/gün kaldı/)).toBeNull();
  });
});
