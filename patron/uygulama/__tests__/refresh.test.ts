// Ekran açılışı tazelemesi (§14 S47) + web dili (I6 kararı d): pano ve rapor ekranı açılınca `POST /api/tazele`,
// sunucunun `sonrakiMs` aralığına SAYGI; web çıktısı `lang="tr"`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENDPOINTS } from "../src/api/endpoints";
import { REFRESH_FAIL_BACKOFF_MS, REFRESH_MIN_GAP_MS, createRefreshGate, dueForRefetch } from "../src/lib/refresh";

jest.mock("expo-router", () => ({ useFocusEffect: jest.fn() }));
jest.mock("../src/state/session", () => ({ useSession: jest.fn() }));
const { AFTER_DOORBELL_MS, followDoorbell } = require("../src/state/useOpenRefresh") as typeof import("../src/state/useOpenRefresh");

const KOK = path.join(__dirname, "..");
const oku = (rel: string): string => readFileSync(path.join(KOK, rel), "utf8");

describe("ekran açılışı tazelemesi — aralığa saygı", () => {
  it("ilk açılış çağırır; sunucunun sonrakiMs'i dolmadan ikinci açılış çağırmaz, dolunca çağırır", async () => {
    const g = createRefreshGate();
    let saat = 1_000_000;
    const call = jest.fn().mockResolvedValue({ zil: true, sonrakiMs: 30_000 });
    expect(await g.request(saat, call, () => saat)).toBe(true);
    saat += 29_000;
    expect(await g.request(saat, call, () => saat)).toBe(false);
    saat += 1_000;
    expect(await g.request(saat, call, () => saat)).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("zil çalmadıysa (aralık içi) sunucunun kalan süresine uyar; çok kısa süre en az alt sınır kadar bekletir", async () => {
    const g = createRefreshGate();
    let saat = 0;
    const call = jest.fn().mockResolvedValueOnce({ zil: false, sonrakiMs: 12_000 }).mockResolvedValue({ zil: true, sonrakiMs: 1 });
    await g.request(saat, call, () => saat);
    saat += 11_999;
    expect(await g.request(saat, call, () => saat)).toBe(false);
    saat += 1;
    expect(await g.request(saat, call, () => saat)).toBe(true);
    saat += REFRESH_MIN_GAP_MS - 1;
    expect(await g.request(saat, call, () => saat)).toBe(false);
  });

  it("hata (ağ/5xx) sessizdir ve geri çekilir; uçuştaki istek varken ikinci açılış düşer", async () => {
    const g = createRefreshGate();
    let saat = 0;
    const hata = jest.fn().mockRejectedValue(new Error("ağ yok"));
    await expect(g.request(saat, hata, () => saat)).resolves.toBe(true);
    saat += REFRESH_FAIL_BACKOFF_MS - 1;
    expect(await g.request(saat, hata, () => saat)).toBe(false);
    saat += 1;
    let bitir: (v: { zil: boolean; sonrakiMs: number }) => void = () => undefined;
    const yavas = jest.fn(() => new Promise<{ zil: boolean; sonrakiMs: number }>((r) => (bitir = r)));
    const ilk = g.request(saat, yavas, () => saat);
    expect(await g.request(saat, yavas, () => saat)).toBe(false);
    bitir({ zil: true, sonrakiMs: 30_000 });
    expect(await ilk).toBe(true);
    expect(yavas).toHaveBeenCalledTimes(1);
  });
});

describe("zil sonrası çekme (P2) — fabrika paketi aynı ekranda görünür", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("3/6/10 sn'de damgaya bakar; damga değişince BİR kez geçersizleştirir ve kalan adımlar düşer", async () => {
    expect(AFTER_DOORBELL_MS).toEqual([3_000, 6_000, 10_000]);
    const stamps = ["A", "B", "C"];
    const check = jest.fn(async () => stamps.shift() ?? null);
    const changed = jest.fn();
    followDoorbell("A", check, changed);
    await jest.advanceTimersByTimeAsync(2_999);
    expect(check).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(changed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(changed).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("damga hiç değişmezse 3 bakıştan sonra durur; odak kaybında bekleyenler iptal", async () => {
    const check = jest.fn(async () => "A");
    const changed = jest.fn();
    followDoorbell("A", check, changed);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(3);
    expect(changed).not.toHaveBeenCalled();
    const check2 = jest.fn(async () => "B");
    const cancel = followDoorbell("A", check2, changed);
    cancel();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(check2).not.toHaveBeenCalled();
  });

  it("odak/öne gelme aralığı: son çekimden en az REFRESH_MIN_GAP_MS", () => {
    expect(dueForRefetch(1_000, 1_000 + REFRESH_MIN_GAP_MS - 1)).toBe(false);
    expect(dueForRefetch(1_000, 1_000 + REFRESH_MIN_GAP_MS)).toBe(true);
  });
});

describe("bağlantı — pano ve rapor ekranı tazeler, uç sunucuda", () => {
  it("uç `POST /tazele` tabloda; kanca kapıdan `api.refresh`i çağırır", () => {
    expect(ENDPOINTS.refresh).toEqual(["post", "/tazele"]);
    const kanca = oku("src/state/useOpenRefresh.ts");
    expect(kanca).toMatch(/useFocusEffect\(/);
    expect(kanca).toMatch(/openRefreshGate\s*\.request\(Date\.now\(\), \(\) => api\.refresh\(\)/);
    // Zil çaldıysa takip, damga değişince bütün veri kancaları (zil TÜM projeksiyonları tazeler).
    expect(kanca).toMatch(/rang\?\.zil/);
    expect(kanca).toMatch(/invalidate\(\[ALL_TAGS\]\)/);
  });

  it.each(["app/(app)/pano.tsx", "app/(app)/raporlar/index.tsx"])("%s açılınca tazeler", (dosya) => {
    expect(oku(dosya)).toMatch(/^\s*useOpenRefresh\(\);$/m);
  });
});

describe("web sürümü dili", () => {
  it("app.json web.lang = tr (Expo index.html `lang` özniteliği buradan)", () => {
    const cfg = JSON.parse(oku("app.json")) as { expo: { web?: { lang?: string } } };
    expect(cfg.expo.web?.lang).toBe("tr");
  });
});
