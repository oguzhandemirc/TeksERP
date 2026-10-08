// İPTAL BELGELERİ + ANAHTARLAR — bileşen bekçisi (lisans v2 · G4 §2.3). İptal ekranı fabrikalara giden sırayı, kapıda
// bekleyen belgeyi ve engellerini (HAK → yeniden bas · ANAHTAR → emekliye ayır) gösterir. Toplu yeniden basım ara imzacı
// parolası ister: düğme internet (ERİŞİM) oturumunda çıkar (kullanıcı kararı 2026-10-04); gövde seçilen
// HAK'lar + sebep + parola, sonuç satır satır (basılan · atlanan + neden). Anahtarlar ekranı ara imzacıyı türüyle,
// sertifikayı veren kökle, emekli anahtarları ayrı bölümde gösterir.
// NEGATİF SONDA (2026-10-04, dosya DIŞI, shasum ile geri alındı): Revocations.tsx'te düğme koşuluna ERISIM'de false
// (eski kilit) geri konuldu → ERİŞİM yeniden basım testi ❌, öteki dört test yeşil.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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

function open(path: string, dinleyici: SessionListener = "ERISIM", extra: Record<string, Handler> = {}) {
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

  it("⭐ toplu yeniden basım: HAK başına tek satır, sebep + parola zorunlu; gövde seçilen HAK'lar; sonuç satır satır", async () => {
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

  it("⭐ internet (ERİŞİM): yeniden basım düğmesi VAR, tünel açıklaması yok; uç aynı gövdeyle çağrılır", async () => {
    const user = userEvent.setup();
    const { calls } = open("/iptal-belgeleri", "ERISIM");
    await user.click(await screen.findByRole("button", { name: "Engelli HAK'ları yeniden bas…" }));
    expect(screen.queryByText(/tailnet|portal-baglan|bu bağlantıdan yapılamaz/)).toBeNull();
    const dialog = await screen.findByRole("dialog", { name: "Engelli HAK'ları ara imzacıyla yeniden bas" });
    await user.type(within(dialog).getByLabelText(/^Sebep/), "acil iptal turu");
    await user.type(within(dialog).getByLabelText(/^Ara imzacı parolası/), "ara-parola");
    await user.click(within(dialog).getByRole("button", { name: "Yeniden bas" }));
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe("/haklar/toplu-yeniden-bas");
    expect(w[0]!.body).toMatchObject({ hakIdleri: [HAK_A, HAK_B], sebep: "acil iptal turu", imzaParolasi: "ara-parola" });
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
    open("/anahtarlar", "ERISIM", { "GET /anahtarlar": () => ({ data: KEYS }) });
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

// DAĞITIM İPTALİ + AÇIK SERTİFİKALAR (ISTEMCI · PAKET; 2026-10-08): iptal ekranı dağıtım iptali defterini salt okunur
// gösterir (kirada giden sıra rozeti, iptal edilen ve bu sunucuda duran sertifikalar; yazma düğmesi yok); anahtarlar
// ekranı açık sertifikaları kullanımı, OTA yaprağı ve iptal/süre durumuyla gösterir; kök Mac'teyse "beklenen" der.
const PKG_STATUS: RevocationStatus = {
  ...STATUS,
  bekleyen: null,
  dagitimIptali: {
    belgeler: [
      { id: "p2", iptalId: "pi-2", sira: 2, imzalayanKid: "kok-2026-1", verilis: "2026-10-08T08:00:00.000Z", kidler: ["ist-2026-1", "pkt-2027-1"], yukleyen: "cli:donem-ice-aktar", createdAt: "2026-10-08T09:00:00.000Z" },
      { id: "p1", iptalId: "pi-1", sira: 1, imzalayanKid: "kok-2026-1", verilis: "2026-10-07T08:00:00.000Z", kidler: ["pkt-2027-1"], yukleyen: "cli:donem-ice-aktar", createdAt: "2026-10-07T09:00:00.000Z" },
    ],
    kiradakiSira: 2,
    iptalEdilenYukluler: ["ist-2026-1"],
  },
};

describe("dağıtım iptali (salt okuma)", () => {
  it("defter satırları, kirada giden sıra ve bu sunucudaki iptal edilmiş sertifika; yazma düğmesi yok", async () => {
    const { calls } = open("/iptal-belgeleri", "ERISIM", { "GET /iptal-belgeleri": () => ({ data: PKG_STATUS }) });
    const section = (await screen.findByText("Dağıtım iptalleri (panel/tablet ve paket imzası)")).closest("section")!;
    expect(within(within(section).getByText("ist-2026-1, pkt-2027-1").closest("tr")!).getByText("Kirada")).toBeInTheDocument();
    expect(within(within(section).getByText("pkt-2027-1").closest("tr")!).queryByText("Kirada")).toBeNull();
    expect(within(section).getByText("ist-2026-1")).toBeInTheDocument();
    expect(within(section).queryAllByRole("button")).toHaveLength(0);
    expect(writes(calls)).toEqual([]);
  });

  it("eski sunucu (alan yok) → bölüm çizilmez, sayfa kırılmaz", async () => {
    open("/iptal-belgeleri");
    expect(await screen.findByText("Defter")).toBeInTheDocument();
    expect(screen.queryByText("Dağıtım iptalleri (panel/tablet ve paket imzası)")).toBeNull();
  });
});

const DAY = 86_400_000;
const OPEN_KEYS: KeyStatus = {
  ...KEYS,
  anahtarlar: [
    ...KEYS.anahtarlar,
    { kid: "kok-2026-1", tur: "KOK", acikAnahtar: "k".repeat(43), siniflar: ["URETIM"], baslangic: null, bitis: null, durum: "AKTIF", yuklu: false, suresiDoldu: false, capada: true, sertifikaVeren: null, updatedAt: "2026-09-30T00:00:00.000Z" },
  ],
  acikSertifikalar: [
    {
      kid: "ist-2026-1",
      kullanim: "ISTEMCI",
      acikAnahtar: "i".repeat(43),
      sertifikaId: "59a12742-dae0-4ef3-bf30-d94621206279",
      sertifikaVeren: "kok-2026-1",
      baslangic: "2026-10-07T18:13:13.105Z",
      bitis: new Date(Date.now() + 300 * DAY).toISOString(),
      suresiDoldu: false,
      iptalSira: 2,
      otaYapraklari: [],
    },
    {
      kid: "ist-2026-2",
      kullanim: "ISTEMCI",
      acikAnahtar: "j".repeat(43),
      sertifikaId: "445390c4-15a3-47bb-89e6-b7f5fae9acc4",
      sertifikaVeren: "kok-2026-1",
      baslangic: "2026-10-07T18:13:14.141Z",
      bitis: new Date(Date.now() + 300 * DAY).toISOString(),
      suresiDoldu: false,
      iptalSira: null,
      otaYapraklari: [{ dosya: "istemci/ota-yaprak-yedek.pem", parmakIzi: "68:67:C6:FB:ED:74:64:0F:52:D5:E6:2A:65:E9:50:8D", baslangic: "2026-10-07T18:13:14.000Z", bitis: new Date(Date.now() + 20 * DAY).toISOString() }],
    },
  ],
};

describe("anahtarlar ekranı — açık sertifikalar ve çevrimdışı kök", () => {
  it("ISTEMCI satırları kullanım, OTA yaprağı ve durumla (iptal sırası · erken biten OTA yaprağı uyarısı)", async () => {
    open("/anahtarlar", "ERISIM", { "GET /anahtarlar": () => ({ data: OPEN_KEYS }) });
    const section = (await screen.findByText("İstemci ve paket sertifikaları (açık)")).closest("section")!;
    const revoked = within(section).getByText("ist-2026-1").closest("tr")!;
    expect(within(revoked).getByText("İptal (dağıtım iptali sıra 2)")).toBeInTheDocument();
    expect(within(revoked).getByText("İstemci (panel/tablet güncelleme imzası)")).toBeInTheDocument();
    const spare = within(section).getByText("ist-2026-2").closest("tr")!;
    expect(within(spare).getByText(/68:67:C6:FB:ED:74:64:0F/)).toBeInTheDocument();
    expect(within(spare).getByText("20 gün kaldı — dönem töreni")).toBeInTheDocument();
  });

  it("kök bu sunucuda değil ama çapada → 'beklenen' rozeti (yüklü değil uyarısı yerine)", async () => {
    open("/anahtarlar", "ERISIM", { "GET /anahtarlar": () => ({ data: OPEN_KEYS }) });
    const active = (await screen.findByText("Anahtar künyesi")).closest("section")!;
    const root = within(active).getByText("kok-2026-1").closest("tr")!;
    expect(within(root).getByText("Bu sunucuda değil — kök Mac'te (beklenen)")).toBeInTheDocument();
    expect(within(root).getByText("Aktif")).toBeInTheDocument();
  });

  it("sertifika geçerli ama OTA yaprağı bitmiş → eksi gün değil 'OTA yaprağının süresi doldu'", async () => {
    const [, spare] = OPEN_KEYS.acikSertifikalar!;
    const leaf = { ...spare!.otaYapraklari[0]!, bitis: new Date(Date.now() - 3 * DAY).toISOString() };
    const data: KeyStatus = { ...OPEN_KEYS, acikSertifikalar: [{ ...spare!, otaYapraklari: [leaf] }] };
    open("/anahtarlar", "ERISIM", { "GET /anahtarlar": () => ({ data }) });
    const section = (await screen.findByText("İstemci ve paket sertifikaları (açık)")).closest("section")!;
    const row = within(section).getByText("ist-2026-2").closest("tr")!;
    expect(within(row).getByText("OTA yaprağının süresi doldu")).toBeInTheDocument();
    expect(within(row).queryByText(/gün kaldı/)).toBeNull();
  });

  it("eski sunucu (alan yok) → boş tablo, sayfa kırılmaz", async () => {
    open("/anahtarlar", "ERISIM", { "GET /anahtarlar": () => ({ data: KEYS }) });
    const section = (await screen.findByText("İstemci ve paket sertifikaları (açık)")).closest("section")!;
    expect(within(section).getByText("Anahtar biriminde açık sertifika yok")).toBeInTheDocument();
  });
});
