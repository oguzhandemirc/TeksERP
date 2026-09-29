import { fireEvent, render, screen } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NOTIFICATION_KINDS, type NotificationKindInfo, type NotificationSettings } from "../src/api/wire";
import { base64UrlToBytes, fromForm, safeRoute, toForm } from "../src/lib/notification-form";
import { NotificationSettingsForm } from "../src/ui/NotificationSettingsForm";

const SETTINGS: NotificationSettings = {
  acik: true,
  turler: Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, true])) as NotificationSettings["turler"],
  sessiz: { acik: true, baslangic: "22:00", bitis: "07:00" },
  esikler: { hamStokAlt: 1500.5, bitmisStokAlt: null, gecikenKalemUst: 0, gunlukUretimAlt: null, gunlukUretimSaati: 18, esitlemeGecikmeDk: 60 },
};

describe("bildirim ayar formu", () => {
  it("ayar → form → ayar gidiş-dönüşü aynı (boş eşik null, TR ondalık)", () => {
    const f = toForm(SETTINGS);
    expect(f.hamStokAlt).toBe("1500,5");
    expect(fromForm(f)).toEqual({ ok: true, settings: SETTINGS });
  });
  it("biçimsiz saat, sınır dışı değer TR hata verir (sunucuya gitmez)", () => {
    const f = toForm(SETTINGS);
    expect(fromForm({ ...f, baslangic: "25:00" })).toEqual({ ok: false, error: expect.stringContaining("SS:DD") });
    expect(fromForm({ ...f, gunlukUretimSaati: "24" })).toEqual({ ok: false, error: expect.stringContaining("0–23") });
    expect(fromForm({ ...f, esitlemeGecikmeDk: "2" })).toEqual({ ok: false, error: expect.stringContaining("5–10080") });
    expect(fromForm({ ...f, gecikenKalemUst: "1,5" })).toEqual({ ok: false, error: expect.stringContaining("Geciken") });
    expect(fromForm({ ...f, hamStokAlt: "-3" })).toEqual({ ok: false, error: expect.stringContaining("Ham stok") });
  });
});

describe("bildirime dokununca açılan yol", () => {
  it("yalnız uygulamanın kendi ekranı açılır", () => {
    expect(safeRoute("/siparisler")).toBe("/siparisler");
    expect(safeRoute("/bildirimler")).toBe("/bildirimler");
    expect(safeRoute("/gelen-kutusu/3f2b8c1e-0000-4000-8000-000000000001")).toBe("/gelen-kutusu/3f2b8c1e-0000-4000-8000-000000000001");
  });
  it("dış adres, // ile başlayan, bilinmeyen bölüm, kayıtsız bölümde alt yol → açılmaz", () => {
    for (const r of ["https://kotu.ornek/x", "//kotu.ornek", "/bilinmeyen", "/stok/abc", "/siparisler/../hesaplar", "", null, 42]) expect(safeRoute(r)).toBeNull();
  });
  it("service worker aynı yol kalıbını taşır (web ile telefon aynı süzgeç)", () => {
    const sw = readFileSync(path.join(__dirname, "..", "public", "bildirim-sw.js"), "utf8");
    const lib = readFileSync(path.join(__dirname, "..", "src", "lib", "notification-form.ts"), "utf8");
    const kalip = "/^\\/[a-z-]+(\\/[A-Za-z0-9-]{1,64})?$/";
    expect(sw).toContain(kalip);
    expect(lib).toContain(kalip);
  });
  it("VAPID açık anahtarı base64url → bayt", () => {
    expect(Array.from(base64UrlToBytes("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
  });
});

describe("ayar ekranı görünümü", () => {
  const kinds: NotificationKindInfo[] = [
    { tur: "geciken-siparis", ad: "Geciken sipariş", aciklama: "Termini geçmiş", finans: false, izinli: true },
    { tur: "cek-vadesi", ad: "Çek/senet vadesi", aciklama: "Vadesi yaklaşan", finans: true, izinli: false },
  ];
  it("izni yetmeyen tür açıklanır ve kapatılamaz/açılamaz; ana anahtar formu değiştirir", () => {
    const onChange = jest.fn();
    render(<NotificationSettingsForm form={toForm(SETTINGS)} kinds={kinds} onChange={onChange} />);
    expect(screen.getByText("Çek/senet vadesi (finans)")).toBeTruthy();
    expect(screen.getByText("Yetkiniz bu bildirimi almaya yetmiyor")).toBeTruthy();
    expect(screen.getByTestId("tur-cek-vadesi").props.disabled).toBe(true);
    expect(screen.getByTestId("tur-geciken-siparis").props.disabled).toBe(false);
    fireEvent(screen.getByTestId("bildirim-ana"), "valueChange", false);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ acik: false }));
  });
  it("bildirimler kapalıyken tür anahtarları pasif", () => {
    render(<NotificationSettingsForm form={{ ...toForm(SETTINGS), acik: false }} kinds={kinds} onChange={jest.fn()} />);
    expect(screen.getByTestId("tur-geciken-siparis").props.disabled).toBe(true);
  });
});
