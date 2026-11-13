// Rapor koşumunu PDF / Excel paylaşma bekçisi (ERP kipi): §1 katman — Excel yaz→paylaş, PDF html→pdf→paylaş, paylaşılan
// dosya hemen SİLİNMEZ (alıcı uygulama geç okuyabilir), her turun başında önceki dosyalar süpürülür, paylaşım yoksa
// indirme yok · §2 dosya adı + hata iletileri · §3 yetenek (eski fabrika/bulut kapalı), bulut Raporcu ağa gitmez ·
// §4 koşum ekranı — düğme görünürlüğü, çevrimdışı kapalı, tıklama, hata Banner'ı, web'de PDF yok.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";
import { Platform } from "react-native";

jest.mock("expo-file-system", () => ({ Directory: jest.fn(), File: jest.fn(), Paths: { cache: "file:///cache" } }));
jest.mock("expo-print", () => ({ printToFileAsync: jest.fn() }));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));

const mockRaporcu = { katalog: jest.fn(), olustur: jest.fn(), gecmis: jest.fn(), kosum: jest.fn(), sil: jest.fn(), dosya: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-11-13T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: { reportGet: jest.fn(), reportCancel: jest.fn() }, raporcu: mockRaporcu, cache: mockCache, markOnline: jest.fn(),
  permissions: ["bulut:rapor:oku"] as string[], offline: false, offlineSince: null, facility: null, facilities: [], switchError: null, factoryStamp: null,
};
const mockParams: { value: Record<string, string> } = { value: {} };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
  usePathname: () => "/raporlar",
  useLocalSearchParams: () => mockParams.value,
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");
const yet = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const rapor = require("../src/api/rapor") as typeof import("../src/api/rapor");
const katman = require("../src/lib/rapor-dosya") as typeof import("../src/lib/rapor-dosya");
const yerel = require("../src/lib/rapor-dosya-yerel") as typeof import("../src/lib/rapor-dosya-yerel");
const ReportDetail = (require("../app/(app)/raporlar/[id]") as { default: () => React.ReactElement }).default;

const ID = "00000000-0000-4000-8000-000000000001";
const ERP_PERMS = ["report:sales", "patron-app:login"];
const bayt = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

function portlar(over: Partial<import("../src/lib/rapor-dosya").DosyaPortlari> = {}) {
  const log: string[] = [];
  const p = {
    supur: jest.fn(() => void log.push("supur")),
    yaz: jest.fn((ad: string) => (log.push(`yaz:${ad}`), `file:///cache/rapor-dosya/${ad}`)),
    metinOku: jest.fn(async (u: string) => (log.push(`oku:${u.split("/").pop()}`), "<html>rapor</html>")),
    pdfYap: jest.fn(async (_h: string, ad: string) => (log.push(`pdf:${ad}`), `file:///cache/rapor-dosya/${ad}`)),
    sil: jest.fn((u: string) => void log.push(`sil:${u.split("/").pop()}`)),
    paylasimVar: jest.fn(async () => true),
    paylas: jest.fn(async (u: string) => void log.push(`paylas:${u.split("/").pop()}`)),
    ...over,
  };
  return { p, log };
}

function raporcu(file = { fileName: "Ne-sevk-ettik-2026-11-13.xlsx", contentType: "x", data: bayt("PK") }) {
  return { ...mockRaporcu, dosya: jest.fn(async () => file) } as unknown as import("../src/api/rapor").Raporcu;
}

function kosum(over: Record<string, unknown> = {}) {
  return {
    id: ID, raporAnahtari: "sales/sevkiyat", aile: "sales", baslik: "Sevkiyat", parametreler: {}, parametreOzeti: "01.11.2026 – 13.11.2026",
    durum: "HAZIR", hataKodu: null, olusturulma: "2026-11-13T08:00:00.000Z", tamamlanma: "2026-11-13T08:00:02.000Z", sureMs: 2000,
    olusturan: { id: "u", kullaniciAdi: "patron" }, dosyaBicimleri: ["xlsx", "html"],
    sonuc: { veri: { toplam: 4200 }, hesaplandi: "2026-11-13T08:00:02.000Z", kaynakUfuk: null },
    ...over,
  };
}

async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => undefined);
}

describe("§1 katman", () => {
  it("Excel: önce süpür, sonra indir → yaz → paylaş; paylaşılan dosya silinmez", async () => {
    const { p, log } = portlar();
    const r = raporcu();
    await katman.raporDosyasiPaylas(r, ID, "excel", p, "Sevkiyat");
    expect(r.dosya).toHaveBeenCalledWith(ID, "xlsx");
    expect(log).toEqual(["supur", "yaz:Ne-sevk-ettik-2026-11-13.xlsx", "paylas:Ne-sevk-ettik-2026-11-13.xlsx"]);
    expect((p.paylas as jest.Mock).mock.calls[0][1]).toMatchObject({ mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", baslik: "Sevkiyat" });
    expect(p.sil).not.toHaveBeenCalled();
  });

  it("PDF: html yaz → oku → PDF → ara html silinir → PDF paylaşılır (PDF durur)", async () => {
    const { p, log } = portlar();
    const r = raporcu({ fileName: "Ne-sevk-ettik-2026-11-13.html", contentType: "text/html", data: bayt("<html/>") });
    await katman.raporDosyasiPaylas(r, ID, "pdf", p, "Sevkiyat");
    expect(r.dosya).toHaveBeenCalledWith(ID, "html");
    expect(log).toEqual([
      "supur", "yaz:Ne-sevk-ettik-2026-11-13.html", "oku:Ne-sevk-ettik-2026-11-13.html", "pdf:Ne-sevk-ettik-2026-11-13.pdf",
      "sil:Ne-sevk-ettik-2026-11-13.html", "paylas:Ne-sevk-ettik-2026-11-13.pdf",
    ]);
    expect((p.paylas as jest.Mock).mock.calls[0][1]).toMatchObject({ mimeType: "application/pdf" });
  });

  it("PDF üretimi patlarsa ara html yine silinir; hata yukarı çıkar, paylaşım açılmaz", async () => {
    const { p, log } = portlar({ pdfYap: jest.fn(async () => Promise.reject(new Error("print"))) });
    await expect(katman.raporDosyasiPaylas(raporcu(), ID, "pdf", p, "S")).rejects.toThrow("print");
    expect(log).toContain("sil:Ne-sevk-ettik-2026-11-13.html");
    expect(p.paylas).not.toHaveBeenCalled();
  });

  it("süpürme hatası akışı durdurmaz; paylaşım yoksa indirme ve süpürme yok", async () => {
    const { p } = portlar({ supur: jest.fn(() => { throw new Error("fs"); }) });
    await katman.raporDosyasiPaylas(raporcu(), ID, "excel", p, "S");
    expect(p.paylas).toHaveBeenCalledTimes(1);

    const yok = portlar({ paylasimVar: jest.fn(async () => false) });
    const r = raporcu();
    await expect(katman.raporDosyasiPaylas(r, ID, "excel", yok.p, "S")).rejects.toThrow("paylaşım kullanılamıyor");
    expect(r.dosya).not.toHaveBeenCalled();
    expect(yok.p.supur).not.toHaveBeenCalled();
  });

  it("oncekileriSupur: yerel port dizini siler; dizin yoksa dokunmaz; hata yutulur", () => {
    const fs = require("expo-file-system") as { Directory: jest.Mock };
    const del = jest.fn();
    fs.Directory.mockImplementation(() => ({ exists: true, delete: del }));
    katman.oncekileriSupur(yerel.yerelDosyaPortlari);
    expect(fs.Directory).toHaveBeenCalledWith("file:///cache", "rapor-dosya");
    expect(del).toHaveBeenCalledTimes(1);
    fs.Directory.mockImplementation(() => ({ exists: false, delete: del }));
    katman.oncekileriSupur(yerel.yerelDosyaPortlari);
    expect(del).toHaveBeenCalledTimes(1);
    expect(() => katman.oncekileriSupur({ supur: () => { throw new Error("x"); } })).not.toThrow();
  });
});

describe("§2 dosya adı ve iletiler", () => {
  it("dosyaAdi güvenli karakter bırakır, uzantıyı türe çevirir", () => {
    expect(katman.dosyaAdi("Ne-sevk-ettik-2026-11-13.html", "pdf")).toBe("Ne-sevk-ettik-2026-11-13.pdf");
    expect(katman.dosyaAdi("../a b/\"c\".xlsx", "excel")).toBe("a-b-c.xlsx");
    expect(katman.dosyaAdi("...", "excel")).toBe("rapor.xlsx");
    expect(katman.dosyaAdi("x".repeat(200) + ".xlsx", "excel")).toHaveLength(85);
  });

  it("hata iletileri Türkçe", () => {
    expect(katman.dosyaHataIletisi(new ApiError(409, "DISA_AKTARILAMAZ", "x"))).toBe("Bu rapor dosya olarak indirilemiyor.");
    expect(katman.dosyaHataIletisi(new ApiError(404, "NOT_FOUND", "x"))).toBe("Rapor bulunamadı; silinmiş olabilir.");
    expect(katman.dosyaHataIletisi(new ApiError(0, "NETWORK", "x"))).toMatch(/bağlantınızı/);
    expect(katman.dosyaHataIletisi(new Error("?"))).toBe("Dosya hazırlanamadı; tekrar deneyin.");
  });
});

describe("§3 yetenek ve kip", () => {
  it("patronReportExport yalnız rapor ucu varken açar; eski fabrika ve bulut kapalı", () => {
    expect(yet.erpYetenek([], ERP_PERMS, 1, false, 1).raporDisaAktar).toBe(true);
    expect(yet.erpYetenek([], ERP_PERMS, 1, false).raporDisaAktar).toBe(false);
    expect(yet.erpYetenek([], ERP_PERMS, undefined, false, 1).raporDisaAktar).toBe(false);
    expect(yet.erpYetenek([], ERP_PERMS, 1, false, "1").raporDisaAktar).toBe(false);
    expect(yet.BULUT_YETENEK.raporDisaAktar).toBe(false);
  });

  it("bulut Raporcu dosya isteğini ağa göndermeden reddeder", async () => {
    await expect(rapor.createBulutRaporcu().dosya(ID, "xlsx")).rejects.toBeInstanceOf(ApiError);
  });

  it("ERP Raporcu: belirteç adreste değil, biçim sorgu parametresi", async () => {
    const c = { download: jest.fn(async () => ({ fileName: "a.xlsx", contentType: "x", data: bayt("") })) };
    await rapor.createErpRaporcu(c as never).dosya(ID, "xlsx");
    expect(c.download).toHaveBeenCalledWith(`/patron/v1/raporlar/${ID}/dosya`, { bicim: "xlsx" });
  });
});

describe("§4 koşum ekranı", () => {
  const sharing = require("expo-sharing") as { isAvailableAsync: jest.Mock; shareAsync: jest.Mock };
  const fs = require("expo-file-system") as { Directory: jest.Mock; File: jest.Mock };
  const os = Platform.OS;

  beforeEach(() => {
    for (const f of Object.values(mockRaporcu)) f.mockReset();
    sharing.shareAsync.mockClear();
    mockSession.offline = false;
    mockParams.value = { id: ID };
    mockRaporcu.kosum.mockResolvedValue(kosum());
    mockRaporcu.dosya.mockResolvedValue({ fileName: "Sevkiyat-2026-11-13.xlsx", contentType: "x", data: bayt("PK") });
    fs.Directory.mockImplementation(() => ({ exists: true, delete: jest.fn(), create: jest.fn() }));
    fs.File.mockImplementation((_d: unknown, ad?: string) => ({ uri: `file:///cache/rapor-dosya/${ad}`, exists: false, create: jest.fn(), write: jest.fn(), delete: jest.fn() }));
    yet.setYetenek(yet.erpYetenek([], ERP_PERMS, 1, false, 1));
  });
  afterEach(() => {
    Platform.OS = os;
  });
  afterAll(() => yet.setYetenek(yet.BULUT_YETENEK));

  async function goster() {
    render(<ReportDetail />);
    await flush();
  }

  it("HAZIR koşumda PDF ve Excel düğmeleri; Excel tıklanınca indirip paylaşım sayfasını açar", async () => {
    await goster();
    expect(screen.getByTestId("disa-aktar-pdf")).toBeTruthy();
    fireEvent.press(screen.getByTestId("disa-aktar-excel"));
    await flush();
    expect(mockRaporcu.dosya).toHaveBeenCalledWith(ID, "xlsx");
    expect(sharing.shareAsync).toHaveBeenCalledWith("file:///cache/rapor-dosya/Sevkiyat-2026-11-13.xlsx", expect.objectContaining({ dialogTitle: "Sevkiyat" }));
    expect(screen.queryByTestId("disa-aktar-hata")).toBeNull();
  });

  it.each([
    ["yetenek yok (eski fabrika)", () => yet.setYetenek(yet.erpYetenek([], ERP_PERMS, 1, false))],
    ["HATA'lı koşum", () => mockRaporcu.kosum.mockResolvedValue(kosum({ durum: "HATA", hataKodu: "X", sonuc: null, dosyaBicimleri: [] }))],
    ["dosyaBicimleri boş (zarfsız sonuç)", () => mockRaporcu.kosum.mockResolvedValue(kosum({ dosyaBicimleri: [] }))],
    ["dosyaBicimleri yok (eski sunucu)", () => mockRaporcu.kosum.mockResolvedValue(kosum({ dosyaBicimleri: undefined }))],
  ])("%s → düğme yok", async (_ad, kur) => {
    kur();
    await goster();
    expect(screen.getByTestId("kosum-sonucu")).toBeTruthy();
    expect(screen.queryByTestId("disa-aktar")).toBeNull();
  });

  it("yalnız sunucunun bildirdiği biçim görünür", async () => {
    mockRaporcu.kosum.mockResolvedValue(kosum({ dosyaBicimleri: ["xlsx"] }));
    await goster();
    expect(screen.getByTestId("disa-aktar-excel")).toBeTruthy();
    expect(screen.queryByTestId("disa-aktar-pdf")).toBeNull();
  });

  it("çevrimdışı: düğmeler kapalı, istek gitmez", async () => {
    mockSession.offline = true;
    await goster();
    expect(screen.getByTestId("disa-aktar-cevrimdisi")).toBeTruthy();
    expect(screen.getByTestId("disa-aktar-excel").props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByTestId("disa-aktar-excel"));
    await flush();
    expect(mockRaporcu.dosya).not.toHaveBeenCalled();
  });

  it("indirme hatası Türkçe Banner olarak görünür", async () => {
    mockRaporcu.dosya.mockRejectedValue(new ApiError(409, "DISA_AKTARILAMAZ", "x"));
    await goster();
    fireEvent.press(screen.getByTestId("disa-aktar-pdf"));
    await flush();
    expect(screen.getByText("Bu rapor dosya olarak indirilemiyor.")).toBeTruthy();
    expect(sharing.shareAsync).not.toHaveBeenCalled();
  });

  it("web: PDF gizli, Excel görünür", async () => {
    Platform.OS = "web";
    await goster();
    expect(screen.queryByTestId("disa-aktar-pdf")).toBeNull();
    expect(screen.getByTestId("disa-aktar-excel")).toBeTruthy();
  });
});
