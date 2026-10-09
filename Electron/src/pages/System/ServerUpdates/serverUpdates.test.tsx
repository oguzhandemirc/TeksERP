import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";
import { LICENSE_ACCESS } from "@/lib/permissions";
import type { UpdateStatus } from "@/types/server-update";
import { systemTiles } from "../tile-config";
import { decisionText, noticeLabel, progressPercent, resultCodeLabel, windowRuleText } from "./labels";
import { actionText } from "./UpdateApprovalCard";
import { refetchIntervalFor } from "./hooks";

const status = vi.fn();
const approve = vi.fn();
vi.mock("@/services/serverUpdateService", () => ({ serverUpdateService: { status: () => status(), approve: (b: unknown) => approve(b) } }));
const perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.includes(p)) }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// PageHeader chrome'u (favoriler → PreferencesProvider) bu testin konusu değil.
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
const { ServerUpdatesPage } = await import("./ServerUpdatesPage");

const PENCERE = { baslangic: "2026-10-01T23:00:00.000Z", bitis: "2026-10-02T02:00:00.000Z" };
const durum = (p: Partial<UpdateStatus> = {}): UpdateStatus => ({
  kuruluSurum: "2.12.0",
  kanal: "testfabrika",
  politika: { kip: "ONAYLI", pencere: { baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: "Europe/Istanbul" }, hedefSurum: null, kaynak: "KIRA" },
  donuk: false,
  sonrakiPencere: PENCERE,
  indirmeBelirteci: true,
  guncelleyici: { durum: "CALISIYOR", surum: "0.1.0" },
  bekleyen: { surum: "2.13.0", karar: "ONAY_BEKLIYOR", neden: null, zorunlu: false, ozet: "Sözleşme kabulü", aralik: null, pgGuncellemesi: false },
  son: null,
  yerel: { durum: "HAZIR", surum: "2.13.0", kuruluSurum: "2.12.0", urun: null, adim: null, hataKodu: null, mesaj: "2.13.0 hazır; ONAY_BEKLIYOR", ilerleme: null, planlanan: null, zaman: null, sonAyrinti: null },
  gecmis: [],
  karar: { karar: "ONAY_BEKLIYOR", neden: null },
  canlilik: { sonCanlilik: "2026-10-01T10:00:00.000Z", esikSn: 180, gecikmeSn: 20, yanitVermiyor: false },
  onay: null,
  eylemler: { hemen: true, pencere: true, geriAl: false, hedefSurum: "2.13.0", neden: null },
  ...p,
});

function hata(status: number): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError(String(status), "ERR", { headers }, null, {
    status, statusText: "", headers: {}, config: { headers },
    data: { success: false, message: "Kurulacak sürüm değişti (şu an 2.13.1); ekranı yenileyin.", details: { code: "UPDATE_APPROVAL_VERSION_CHANGED" } },
  });
}

describe("sunucu güncellemesi — sözlük (saf)", () => {
  it("karar + neden tek cümle; tanınmayan kod kendisiyle", () => {
    expect(decisionText("UYGUN_DEGIL", "KAYNAK_SURUM_ESKI")).toBe("Uygun değil — önce bir ara sürüm kurulmalı");
    expect(decisionText("GUNCEL", null)).toBe("Güncel");
    expect(resultCodeLabel("SAGLIK_HATASI")).toBe("Yeni sürüm sağlık denetiminden geçemedi");
    expect(resultCodeLabel("YENI_KOD")).toBe("YENI_KOD");
    // Disk dolu: kullanıcıya çareyi söyler (yer aç + yeniden onayla), salt "Disk dolu" yetmez.
    expect(resultCodeLabel("DISK_DOLU")).toMatch(/yer açın.*yeniden onaylayın/);
  });
  it("onarım kodları: üç arıza Sorun sözlüğünde, ONARILDI yalnız Bilgi sözlüğünde", () => {
    for (const k of ["ONARIM_TAVANI", "ONARIM_KAYNAK_YOK", "GUNCELLEYICI_KAPALI"]) expect(resultCodeLabel(k)).not.toBe(k);
    expect(noticeLabel("ONARILDI")).not.toBe("ONARILDI");
    expect(resultCodeLabel("ONARILDI")).toBe("ONARILDI");
  });
  it("Linux imaj/compose iç kodları Sorun sözlüğünde", () => {
    for (const k of ["IMAJ_KIMLIGI", "IMAJ_YUKLENEMEDI", "COMPOSE_HATASI"]) expect(resultCodeLabel(k)).not.toBe(k);
  });
  it("pencere kuralı ve ilerleme", () => {
    expect(windowRuleText({ baslangic: "02:00", bitis: "05:00", gunler: [1, 2, 3, 4, 5, 6, 7], saatDilimi: "Europe/Istanbul" })).toBe("Her gün 02:00–05:00");
    expect(windowRuleText({ baslangic: "23:00", bitis: "02:00", gunler: [1, 3], saatDilimi: "Europe/Istanbul" })).toBe("Pzt, Çar 23:00–02:00");
    expect(progressPercent({ indirilen: 50, toplam: 200 })).toBe(25);
    expect(progressPercent({ indirilen: 5, toplam: 0 })).toBeNull();
  });
  it("geri alma OTOMATİK kipte 'Pencereye bırak', ONAYLI kipte 'Onayı geri al'", () => {
    expect(actionText("GERI_AL", "2.13.0", "OTOMATIK", null).button).toBe("Pencereye bırak");
    expect(actionText("GERI_AL", "2.13.0", "ONAYLI", null).button).toBe("Onayı geri al");
    expect(actionText("HEMEN", "2.13.0", "ONAYLI", null).title).toBe("2.13.0 şimdi kurulsun mu?");
  });
  it("iş sürerken sık, boşta seyrek tazelenir", () => {
    expect(refetchIntervalFor(durum({ yerel: { ...durum().yerel!, durum: "UYGULANIYOR" } }))).toBe(5_000);
    expect(refetchIntervalFor(durum())).toBe(30_000);
  });
  it("karo izni route ile AYNI küme (license:view ∨ license:manage)", () => {
    expect(systemTiles.find((t) => t.key === "server-updates")?.permissionAny).toEqual(LICENSE_ACCESS);
  });
});

function sifirla(): void {
  status.mockReset();
  approve.mockReset();
  perms.length = 0;
}

describe("sunucu güncellemesi — ekran", () => {
  beforeEach(sifirla);

  it("ONAYLI + onay bekliyor: kurulu/yeni sürüm, politika; license:manage'e Şimdi kur + Bu gece kur", async () => {
    perms.push("license:manage");
    status.mockResolvedValue(durum());
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("2.13.0")).toBeTruthy();
    expect(screen.getByText("Onay bekliyor")).toBeTruthy();
    expect(screen.getByText("Onaylı (yetkili kişi onaylar)")).toBeTruthy();
    expect(screen.getByText("Her gün 02:00–05:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Şimdi kur" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bu gece kur" })).toBeTruthy();
  });

  it("license:view yalnız GÖRÜR — onay düğmesi yok", async () => {
    perms.push("license:view");
    status.mockResolvedValue(durum());
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Onay bekliyor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Şimdi kur" })).toBeNull();
  });

  it("Şimdi kur → onay penceresi → POST {clientToken, surum, HEMEN}; belirsiz hatada AYNI token, kesin 4xx'te YENİ", async () => {
    perms.push("license:manage");
    status.mockResolvedValue(durum());
    approve.mockRejectedValueOnce(new Error("Network Error")).mockRejectedValueOnce(hata(409)).mockResolvedValueOnce({ kayitId: "k1", niyet: { yazildi: true, kod: null }, durum: durum() });
    renderWithProviders(<ServerUpdatesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Şimdi kur" }));
    // Hata sonrası onay penceresi AÇIK kalır (yeniden deneme aynı pencereden).
    const onayla = async (n: number) => {
      const dlg = await screen.findByRole("dialog");
      await waitFor(() => expect(within(dlg).getByRole("button", { name: "Şimdi kur" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(within(dlg).getByRole("button", { name: "Şimdi kur" }));
      await waitFor(() => expect(approve).toHaveBeenCalledTimes(n));
    };
    await onayla(1);
    await onayla(2);
    await onayla(3);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const calls = approve.mock.calls.map((x) => x[0] as { clientToken: string; surum: string; zamanlama: string });
    const [a, b, c] = [calls[0]!, calls[1]!, calls[2]!];
    expect(a).toMatchObject({ surum: "2.13.0", zamanlama: "HEMEN" });
    expect(a.clientToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.clientToken).toBe(a.clientToken);
    expect(c.clientToken).not.toBe(b.clientToken);
  });

});

describe("sunucu güncellemesi — sonuç ve uyarılar", () => {
  beforeEach(sifirla);

  it("aday çalışan sürümse 'yeni sürüm' yok, durum Güncel, kritik rozeti yok; kira yoksa onay kartı gizli", async () => {
    perms.push("license:manage");
    status.mockResolvedValue(
      durum({
        kuruluSurum: "2.13.0",
        politika: null,
        sonrakiPencere: null,
        bekleyen: { ...durum().bekleyen!, surum: "2.13.0", karar: "KUR", zorunlu: true },
        eylemler: { hemen: false, pencere: false, geriAl: false, hedefSurum: null, neden: "Geçerli kira yok; güncelleme kapalı." },
      }),
    );
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Güncel")).toBeTruthy();
    expect(screen.getByText("Yok")).toBeTruthy();
    expect(screen.queryByText("Kritik güncelleme")).toBeNull();
    expect(screen.queryByText("Onay")).toBeNull();
  });

  it("geri dönmüş deneme: sonuç, neden ve iç ayrıntı görünür", async () => {
    perms.push("license:view");
    status.mockResolvedValue(
      durum({
        son: { kayitId: "a1", hedefSurum: "2.13.0", kaynakSurum: "2.12.0", sonuc: "GERI_DONDU", kod: "SAGLIK_HATASI", baslangic: "2026-09-30T23:30:00.000Z", bitis: "2026-09-30T23:33:00.000Z", veriGeriYuklendi: true },
        yerel: { ...durum().yerel!, durum: "GERI_DONDU", sonAyrinti: { urun: "backend", hataKodu: "SAGLIK_ZAMAN_ASIMI", mesaj: "status UP olmadı" } },
      }),
    );
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Geri dönüldü")).toBeTruthy();
    expect(screen.getByText("Yeni sürüm sağlık denetiminden geçemedi")).toBeTruthy();
    expect(screen.getByText("Güncelleme öncesi yedekten geri yüklendi")).toBeTruthy();
    expect(screen.getByTestId("geri-donus-ayrinti").textContent).toBe("SAGLIK_ZAMAN_ASIMI: status UP olmadı");
  });

  it("hazırlık dizini kilitliyken: iş Bekliyor + sorun 'Dosya kilitli' (indirme hatası DEĞİL) + onaylı sürümün bekleyiş nedeni", async () => {
    perms.push("license:view");
    status.mockResolvedValue(
      durum({
        yerel: { ...durum().yerel!, durum: "BEKLIYOR", hataKodu: "DOSYA_KILITLI", mesaj: "C:\\TeksERP\\surumler\\.hazirlik-2.13.0 başka bir program tarafından kullanılıyor" },
        eylemler: { hemen: false, pencere: false, geriAl: false, hedefSurum: null, neden: "2.13.0 onaylandı; bir dosya başka bir program tarafından kullanıldığı için bekliyor — kilit kalkınca kendiliğinden sürer." },
      }),
    );
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Dosya kilitli — başka bir program kullanıyor (kilit kalkınca kendiliğinden sürer)")).toBeTruthy();
    expect(screen.queryByText("Paket indirilemedi")).toBeNull();
    expect(screen.getByText("Bekliyor")).toBeTruthy();
  });

  it("paket şemanın gerisindeyken: iş Bekliyor + sorun 'Şema ileride' (geri indirme yok) + onaylı sürümün bekleyiş nedeni", async () => {
    perms.push("license:view");
    status.mockResolvedValue(
      durum({
        yerel: { ...durum().yerel!, durum: "BEKLIYOR", hataKodu: "SEMA_ILERIDE", mesaj: "2.13.0 kurulmaz: veritabanında paketin taşımadığı 1 bitmiş göç var (ilk: 20261001_x)" },
        eylemler: { hemen: false, pencere: false, geriAl: false, hedefSurum: null, neden: "2.13.0 onaylandı; veritabanı bu sürümün tanımadığı göçler taşıdığı için kurulmuyor." },
      }),
    );
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Şema ileride — veritabanında bu paketin tanımadığı göçler var; geri indirme yapılmaz (daha yeni sürüm gerekir)")).toBeTruthy();
    expect(screen.getByText("Bekliyor")).toBeTruthy();
  });

  it("güncelleyici yanıt vermiyor → uyarı + son sinyal; kurulu değil → sade not", async () => {
    perms.push("license:view");
    status.mockResolvedValueOnce(durum({ guncelleyici: { durum: "OLCULEMEDI", surum: null }, canlilik: { sonCanlilik: "2026-10-01T09:00:00.000Z", esikSn: 180, gecikmeSn: 3600, yanitVermiyor: true } }));
    const { unmount } = renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Güncelleyici yanıt vermiyor")).toBeTruthy();
    unmount();
    status.mockResolvedValueOnce(durum({ guncelleyici: { durum: "YOK", surum: null }, yerel: null, bekleyen: null, karar: null, canlilik: null }));
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Bu sunucuda güncelleyici kurulu değil")).toBeTruthy();
  });

  it("OTOMATİK kipte verilmiş onay 'Pencereye bırak' ile geri alınır (GERI_AL, onaylanan sürüm)", async () => {
    perms.push("license:manage");
    const onay = { onayId: "o1", surum: "2.13.0", zamanlama: "HEMEN" as const, onaylayan: { id: "u1", ad: "Ayşe Y." }, zaman: "2026-10-01T10:00:00.000Z", kullanildi: false };
    status.mockResolvedValue(durum({ politika: { ...durum().politika!, kip: "OTOMATIK" }, onay, eylemler: { hemen: false, pencere: false, geriAl: true, hedefSurum: "2.13.0", neden: null } }));
    approve.mockResolvedValue({ kayitId: "k2", niyet: { yazildi: true, kod: null }, durum: durum() });
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText(/2\.13\.0 · Şimdi kur · Ayşe Y\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pencereye bırak" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Pencereye bırak" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith(expect.objectContaining({ surum: "2.13.0", zamanlama: "GERI_AL" })));
  });
});

describe("sunucu güncellemesi — güncelleyicinin kendisi çalışmıyor (onar)", () => {
  beforeEach(sifirla);

  it("güncelleyici hizmeti kapatılmış (onar: GUNCELLEYICI_KAPALI) → Durdu + sorun cümlesi, onay düğmesi yok", async () => {
    perms.push("license:manage");
    status.mockResolvedValue(
      durum({
        guncelleyici: { durum: "DURDU", surum: "0.1.0" },
        bekleyen: null,
        karar: null,
        yerel: { ...durum().yerel!, durum: "HATA", hataKodu: "GUNCELLEYICI_KAPALI", mesaj: "TeksERP-Guncelleyici devre dışı" },
        eylemler: { hemen: false, pencere: false, geriAl: false, hedefSurum: null, neden: "Güncelleme programı hizmeti kapatılmış ya da kaldırılmış — yeniden açılmadıkça güncelleme yapılmaz." },
      }),
    );
    renderWithProviders(<ServerUpdatesPage />);
    expect(await screen.findByText("Güncelleme programı hizmeti kapatılmış ya da kaldırılmış — yeniden açılmadıkça güncelleme yapılmaz")).toBeTruthy();
    expect(screen.getByText("Durdu — müdahale gerekiyor")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Şimdi kur" })).toBeNull();
  });
});

describe("sunucu güncellemesi — bilgi (sorun değil)", () => {
  beforeEach(sifirla);

  it("şema hizası ölçülemedi → 'Bilgi' satırı (Sorun DEĞİL), durum Hazır kalır", async () => {
    perms.push("license:view");
    status.mockResolvedValue(
      durum({
        yerel: { ...durum().yerel!, bilgi: { kod: "SEMA_OLCULEMEDI", mesaj: "2.13.0 için şema hizası ölçülemedi (psql: bağlantı reddedildi)" } },
      }),
    );
    renderWithProviders(<ServerUpdatesPage />);
    const bilgi = await screen.findByTestId("guncelleyici-bilgi");
    expect(bilgi.textContent).toBe("Şema hizası ölçülemedi — güncelleme bu yüzden durdurulmadı (göç adımı veritabanını ayrıca denetler)");
    expect(bilgi.getAttribute("title")).toContain("psql");
    expect(screen.queryByText("Sorun")).toBeNull();
    expect(screen.getByText("Hazır")).toBeTruthy();
  });

  it("güncelleyici kendini onardı → 'Bilgi' satırı (ONARILDI), Sorun yok", async () => {
    perms.push("license:view");
    status.mockResolvedValue(durum({ yerel: { ...durum().yerel!, bilgi: { kod: "ONARILDI", mesaj: "ikili silinmişti — .lkg'den geri kondu" } } }));
    renderWithProviders(<ServerUpdatesPage />);
    const bilgi = await screen.findByTestId("guncelleyici-bilgi");
    expect(bilgi.textContent).toBe("Güncelleme programı kendini onardı — bozulan ya da silinen dosyası doğrulanmış kopyadan geri kondu");
    expect(screen.queryByText("Sorun")).toBeNull();
  });
});
