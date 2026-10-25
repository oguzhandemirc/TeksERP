// =============================================================================
// Özel rapor KOD MODU (R2-KOD) — panel
// =============================================================================
// §1 hata yolu → satır/sütun (iç içe dizi, kaçışlı anahtar, bulunamayan yol ataya/başa; deterministik) ·
// §2 tamamlama YALNIZ katalog kimlikleri (küple daraltma; yuva dışı yok) · §3 geçiş kilidi (sözdizimi, bekleyen,
// sunucu hatası, ulaşılamayan sunucu) + 500 ms gecikme · §4 görsel → kod → görsel taslağı değiştirmez; temiz kod
// taslağa yazılır · §5 Türkçe hata gösterimi + [Görsel | Kod] sekmesi oluşturucuda · §6 istemci şemayı kopyalamaz.
//
// NEGATİF SONDALAR (2026-10-25 ÖLÇÜLDÜ; cp + md5 ile birebir geri alındı; taban 17/0):
//   N1 `useCodeMode.showVisual` kilit denetimi kaldırıldı → §4 ❌ 1 · N2 `pathToRange` dizi indisi +1 kaydırıldı → §1 ❌ 4 ·
//   N3 küp tamamlamasına katalog dışı kimlik eklendi → §2 ❌ 1 · N4 istemciye zod şeması eklendi → §6 ❌ 1
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { json } from "@codemirror/lang-json";
import { EditorState } from "@codemirror/state";

const validate = vi.fn();
let validateReply: () => Promise<unknown> = () => Promise.resolve({ gecerli: true, hatalar: [] });

const BODY = {
  surum: 1,
  baslik: "Sevk özeti",
  parametreler: [{ ad: "donem", tur: "tarihAraligi", varsayilan: "son30gun" }],
  bloklar: [
    { id: "ana", tur: "anaSayi", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre"], boyutlar: [], zaman: { param: "donem" } } },
    { id: "tablo", tur: "tablo", sorgu: { kup: "sevk", olculer: ["sevk.brutMetre", "sevk.adet"], boyutlar: ["musteri"], zaman: { param: "donem" } } },
  ],
};
const CATALOG = [
  {
    kimlik: "sevk", ad: "Sevk",
    olculer: [{ kimlik: "sevk.brutMetre", ad: "Brüt sevk", aciklama: "Brüt metre", birim: "m", boyutlar: null }, { kimlik: "sevk.adet", ad: "Sevk adedi", aciklama: "", birim: "adet", boyutlar: null }],
    boyutlar: [{ kimlik: "musteri", ad: "Müşteri", tur: "kategori", islecler: ["in"] }],
  },
  {
    kimlik: "uretim", ad: "Üretim",
    olculer: [{ kimlik: "uretim.metre", ad: "Üretilen metre", aciklama: "", birim: "m", boyutlar: null }],
    boyutlar: [{ kimlik: "istasyon", ad: "İstasyon", tur: "kategori", islecler: ["in"] }],
  },
] as const;

vi.mock("@/services/apiClient", () => ({
  default: {
    get: (url: string) => Promise.resolve({ data: { success: true, data: url === "/api/rapor-semantik/katalog" ? CATALOG : url.startsWith("/api/rapor-tanimlari/r1") ? detail() : [] } }),
    post: (url: string, body: { govde: unknown }) => {
      if (url.endsWith("/dogrula")) {
        validate(body.govde);
        return validateReply().then((d) => ({ data: { success: true, data: d } }));
      }
      if (url.endsWith("/onizle")) return Promise.resolve({ data: { success: true, data: { tanim: { id: "r1", ad: "x", surumNo: 1 }, baslik: "x", itibariylaMetni: "", bloklar: [] } } });
      return Promise.reject(new Error(`beklenmeyen ${url}`));
    },
    put: vi.fn(),
    patch: vi.fn(),
  },
}));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: {}, setPreference: vi.fn(), resetPreferences: vi.fn(), ready: true }) }));
vi.mock("@/store/auth", () => ({ useAuthStore: (sel: (s: { user: { userId: string } }) => unknown) => sel({ user: { userId: "u1" } }) }));

const detail = () => ({
  id: "r1", tur: "OZEL", ad: "Sevk özeti", aciklama: null, kategori: { id: "k", ad: "Kayıtlı", kod: null }, sahip: { id: "u1", ad: "Ayşe" },
  gorunurluk: "OZEL", durum: "YAYINDA", aktifSurum: { id: "s1", no: 1, tarih: "" }, bozuk: false, duzenleyebilir: true, guncellendi: "", govde: BODY,
});

import { parseIssuePath, pathToRange } from "./pathToPosition";
import { completionAt } from "./completion";
import { codeLock, useCodeCheck } from "./useCodeCheck";
import { formatDefinition, parseDefinitionText } from "./definition-text";
import { useCodeMode } from "./useCodeMode";
import { serverDiagnostics } from "./code-diagnostics";
import { normalizedBody, type DefinitionBody } from "../layout/layout-model";
import { ReportLayoutPage } from "../layout/ReportLayoutPage";
import type { CatalogCube } from "../custom-api";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [json()] });
/** Aralığın kapsadığı metin + başlangıcın 1 tabanlı satır/sütunu. */
function at(doc: string, path: string) {
  const s = stateOf(doc);
  const r = pathToRange(s, path);
  const line = s.doc.lineAt(r.from);
  return { text: doc.slice(r.from, r.to), line: line.number, col: r.from - line.from + 1, exact: r.exact };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  validate.mockClear();
  validateReply = () => Promise.resolve({ gecerli: true, hatalar: [] });
});
afterEach(() => vi.useRealTimers());

describe("§1 hata yolu → konum", () => {
  const doc = formatDefinition(BODY);
  it("⭐ iç içe dizi: bloklar[1].sorgu.olculer[1] → doğru dizge, doğru satır/sütun", () => {
    const r = at(doc, "bloklar[1].sorgu.olculer[1]");
    expect(r).toMatchObject({ text: '"sevk.adet"', exact: true });
    const lines = doc.split("\n");
    expect(lines[r.line - 1]!.indexOf('"sevk.adet"') + 1).toBe(r.col);
  });
  it("nesne değeri anahtarından çizilir; kök belgenin başı", () => {
    expect(at(doc, "bloklar[0].sorgu").text).toBe('"sorgu"');
    expect(at(doc, "(kök)")).toMatchObject({ line: 1, col: 1, exact: true });
  });
  it("kaçışlı anahtar çözülür", () => {
    const d = '{\n  "a\\"b": [1, {"c\\u0021": 7}]\n}';
    expect(at(d, 'a"b[1].c!').text).toBe("7");
  });
  it("⭐ bulunamayan yol en yakın ataya, o da yoksa başa bağlanır (hata kaybolmaz)", () => {
    expect(at(doc, "bloklar[1].sorgu.tavan")).toMatchObject({ text: '"sorgu"', exact: false });
    expect(at(doc, "bloklar[9].sorgu")).toMatchObject({ text: '"bloklar"', exact: false });
    expect(at(doc, "yok.alan")).toMatchObject({ line: 1, col: 1, exact: false });
    expect(at("{ bozuk", "bloklar[0]").exact).toBe(false);
  });
  it("yol ayrıştırma deterministik; biçimsiz yol null", () => {
    expect(parseIssuePath("bloklar[1].sorgu.olculer[0]")).toEqual(["bloklar", 1, "sorgu", "olculer", 0]);
    expect(parseIssuePath("duzen[0].i")).toEqual(["duzen", 0, "i"]);
    expect(parseIssuePath(".x")).toBeNull();
    expect(at(doc, "bloklar[1].sorgu.olculer[1]")).toEqual(at(doc, "bloklar[1].sorgu.olculer[1]"));
  });
});

describe("§2 tamamlama yalnız katalogdan", () => {
  const ids = new Set<string>(CATALOG.flatMap((c) => [c.kimlik, ...c.olculer.map((m) => m.kimlik), ...c.boyutlar.map((d) => d.kimlik)]));
  const cubes = CATALOG as unknown as CatalogCube[];
  const complete = (doc: string, marker: string) => {
    const pos = doc.indexOf(marker) + marker.length;
    return completionAt(stateOf(doc), pos, cubes);
  };
  it("⭐ ölçü yuvası: yalnız sorgunun küpündeki ölçüler, hepsi katalogda, Türkçe ad açıklamada", () => {
    const doc = '{"bloklar":[{"sorgu":{"kup":"sevk","olculer":["sev"]}}]}';
    const r = complete(doc, '["sev');
    expect(r?.kind).toBe("measure");
    expect(r?.options.map((o) => o.label)).toEqual(["sevk.brutMetre", "sevk.adet"]);
    expect(r?.options[0]!.detail).toBe("Brüt sevk");
    expect(r?.options.every((o) => ids.has(o.label))).toBe(true);
  });
  it("boyut, süzgeç alanı ve küp yuvaları; küp bilinmiyorsa bütün katalog", () => {
    expect(complete('{"sorgu":{"kup":"uretim","boyutlar":["i"]}}', '["i')?.options.map((o) => o.label)).toEqual(["istasyon"]);
    expect(complete('{"sorgu":{"kup":"sevk","suzgec":{"rules":[{"field":"m"}]}}}', '"field":"m')?.kind).toBe("dimension");
    expect(complete('{"sorgu":{"kup":"s"}}', '"kup":"s')?.options.map((o) => o.label)).toEqual(["sevk", "uretim"]);
    expect(complete('{"sorgu":{"olculer":["x"]}}', '["x')?.options).toHaveLength(3);
  });
  it("yuva dışında (başlık, anahtar adı) tamamlama yok", () => {
    expect(complete('{"baslik":"Sev"}', '"Sev')).toBeNull();
    expect(complete('{"olculer":1}', '"olc')).toBeNull();
  });
  it("katalog boşsa (izin yok) hiçbir kimlik önerilmez", () => {
    expect(completionAt(stateOf('{"sorgu":{"kup":"sevk","olculer":["s"]}}'), 33, [])?.options ?? []).toEqual([]);
  });
});

describe("§3 geçiş kilidi ve gecikme", () => {
  const fresh = { fresh: true, failed: false, issues: [] };
  it("⭐ kilit: sözdizimi → sunucu hatası → bekleyen → ulaşılamayan; temiz ya da değişmemiş metinde yok", () => {
    expect(codeLock(parseDefinitionText("{"), fresh, false)?.kind).toBe("syntax");
    expect(codeLock(parseDefinitionText("{}"), { ...fresh, issues: [{ yol: "baslik", mesaj: "Zorunlu alan eksik." }] }, false)?.message).toBe("Önce hataları düzeltin: 1 sorun var.");
    expect(codeLock(parseDefinitionText("{}"), { ...fresh, fresh: false }, false)?.kind).toBe("pending");
    expect(codeLock(parseDefinitionText("{}"), { fresh: false, failed: true, issues: [] }, false)?.kind).toBe("unavailable");
    expect(codeLock(parseDefinitionText("{}"), fresh, false)).toBeNull();
    expect(codeLock(parseDefinitionText("{"), fresh, true)).toBeNull();
  });
  it("⭐ sunucu doğrulaması 500 ms gecikmeli, ardışık yazım tek istek; sözdizimi kırıkken istek yok", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ t }) => useCodeCheck(t, true), { wrapper, initialProps: { t: '{"a":1}' } });
    rerender({ t: '{"a":12}' });
    await act(async () => void vi.advanceTimersByTime(300));
    rerender({ t: '{"a":123}' });
    await act(async () => void vi.advanceTimersByTime(499));
    expect(validate).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(1));
    await act(async () => void (await Promise.resolve()));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith({ a: 123 });
    rerender({ t: '{"a":' });
    await act(async () => void vi.advanceTimersByTime(1000));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(result.current.parsed.ok).toBe(false);
  });
});

describe("§4 iki yönlü geçiş", () => {
  const setup = () => {
    let draft = normalizedBody(structuredClone(BODY) as DefinitionBody);
    const apply = vi.fn((fn: (b: DefinitionBody) => DefinitionBody | null) => {
      const n = fn(draft);
      if (n) draft = n;
      return Boolean(n);
    });
    const hook = renderHook(() => useCodeMode(draft, apply, true), { wrapper });
    return { hook, apply, get draft() { return draft; } };
  };
  it("⭐ görsel → kod → görsel: metin şema sırasında, taslak DEĞİŞMEZ", () => {
    const { hook, apply } = setup();
    act(() => hook.result.current.showCode());
    expect(hook.result.current.mode).toBe("code");
    expect(hook.result.current.text.startsWith('{\n  "surum": 1,\n  "baslik": "Sevk özeti",\n  "parametreler"')).toBe(true);
    act(() => hook.result.current.showVisual());
    expect(hook.result.current.mode).toBe("visual");
    expect(apply).not.toHaveBeenCalled();
  });
  it("⭐ geçersiz JSON → görsele dönüş kilitli, taslağa yazılmaz", () => {
    const { hook, apply } = setup();
    act(() => hook.result.current.showCode());
    act(() => hook.result.current.setText('{"surum": 1,'));
    expect(hook.result.current.lock?.kind).toBe("syntax");
    act(() => hook.result.current.showVisual());
    expect(hook.result.current.mode).toBe("code");
    expect(apply).not.toHaveBeenCalled();
  });
  it("sunucu hatası varken kilitli; temiz hüküm gelince taslağa yazılır ve görsele dönülür", async () => {
    validateReply = () => Promise.resolve({ gecerli: false, hatalar: [{ yol: "bloklar[0].sorgu.olculer[0]", mesaj: "\"Sevk\" küpünde \"sevk.brut\" ölçüsü yok.", oneri: "sevk.brutMetre" }] });
    const s = setup();
    act(() => s.hook.result.current.showCode());
    act(() => s.hook.result.current.setText(s.hook.result.current.text.replace('"sevk.brutMetre"', '"sevk.brut"')));
    await waitFor(() => expect(s.hook.result.current.lock?.kind).toBe("issues"), { timeout: 2000 });
    expect(s.apply).not.toHaveBeenCalled();
    validateReply = () => Promise.resolve({ gecerli: true, hatalar: [] });
    act(() => s.hook.result.current.setText(s.hook.result.current.text.replace('"Sevk özeti"', '"Sevk özeti 2"').replace('"sevk.brut"', '"sevk.brutMetre"')));
    await waitFor(() => expect(s.apply).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(s.draft.baslik).toBe("Sevk özeti 2");
    act(() => s.hook.result.current.showVisual());
    expect(s.hook.result.current.mode).toBe("visual");
  });
});

describe("§5 Türkçe hata gösterimi ve bulunabilirlik", () => {
  it("sunucu mesajı AYNEN + öneri; konum bulunamazsa yol yazılır", () => {
    const doc = formatDefinition(BODY);
    const d = serverDiagnostics(stateOf(doc), [
      { yol: "bloklar[1].sorgu.olculer[1]", mesaj: "\"Sevk\" küpünde \"sevk.adet\" ölçüsü yok.", oneri: "sevk.brutMetre" },
      { yol: "bloklar[5]", mesaj: "Zorunlu alan eksik." },
    ]);
    expect(d[0]!.message).toBe("\"Sevk\" küpünde \"sevk.adet\" ölçüsü yok. Şunu mu demek istediniz: \"sevk.brutMetre\"?");
    expect(doc.slice(d[0]!.from, d[0]!.to)).toBe('"sevk.adet"');
    expect(d[1]!.message).toBe("Zorunlu alan eksik. (konum: bloklar[5])");
  });
  it("⭐ oluşturucuda [Görsel | Kod] sekmesi; Kod açılınca JSON düzenleyicisi", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/reports/ozel/r1/duzen"]}>
          <Routes>
            <Route path="/reports/ozel/:id/duzen" element={<ReportLayoutPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const codeTab = await screen.findByRole("tab", { name: /Kod/ });
    expect(screen.getByRole("tab", { name: /Görsel/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(codeTab);
    expect(await screen.findByLabelText("Rapor tanımı (JSON)", {}, { timeout: 3000 })).toBeTruthy();
    expect(codeTab.getAttribute("aria-selected")).toBe("true");
  });
});

describe("§6 istemci şemayı kopyalamaz", () => {
  it("⭐ kod modu dosyaları zod / şema sabitleri içermez; tamamlama sabit kimlik yazmaz", () => {
    const dir = __dirname;
    const src = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.tsx")).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    expect(src).not.toMatch(/from "zod"|\bz\.(object|enum|literal)\(|CHART_KINDS|DATE_PRESETS|FILTER_OPERATORS|from "[^"]*rapor-tanimi/);
    expect(readFileSync(join(dir, "completion.ts"), "utf8")).not.toMatch(/"[a-z]+\.[a-zA-Z]+"/);
  });
});
