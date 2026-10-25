import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplatePreviewResult } from "@/services/documentTemplateService";
import { LatestRequestRunner, PREVIEW_DEBOUNCE_MS } from "./latestRequest";
import { PREVIEW_IFRAME_TITLE, PreviewPane } from "./PreviewPane";
import { PREVIEW_TIMEOUT_NOTE, nextPreviewState, type PreviewState } from "./usePreview";

const ok = (html: string): TemplatePreviewResult => ({ html, hatalar: [], uyarilar: [], kesilenler: [], olcum: { ms: 12, bayt: 2048 } });
const bad: TemplatePreviewResult = { html: "", hatalar: [{ satir: 3, sutun: 5, mesaj: "Bilinmeyen filtre" }], uyarilar: [], kesilenler: [], olcum: { ms: 0, bayt: 0 } };

describe("canlı önizleme zamanlayıcısı — 400 ms debounce + yalnız son istek", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("susma süresince yazılan değişiklikler TEK isteğe toplanır (400 ms)", async () => {
    const fetcher = vi.fn(async (i: number) => i);
    const out = vi.fn();
    const r = new LatestRequestRunner(fetcher, out);
    r.schedule(1);
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS - 1);
    r.schedule(2);
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS - 1);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(PREVIEW_DEBOUNCE_MS).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(2);
    expect(out).toHaveBeenCalledWith({ kind: "ok", value: 2 });
  });

  it("yarış: yavaş ESKİ cevap yeni cevabın üstüne yazılmaz; eski istek iptal edilir", async () => {
    const resolvers: Array<(v: string) => void> = [];
    const signals: AbortSignal[] = [];
    const out = vi.fn();
    const r = new LatestRequestRunner<string, string>((_, signal) => {
      signals.push(signal);
      return new Promise((res) => resolvers.push(res));
    }, out);
    r.schedule("eski");
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
    r.schedule("yeni");
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
    expect(signals[0]!.aborted).toBe(true);
    resolvers[1]!("yeni-cevap");
    await vi.advanceTimersByTimeAsync(0);
    resolvers[0]!("eski-cevap");
    await vi.advanceTimersByTimeAsync(0);
    expect(out.mock.calls).toEqual([[{ kind: "ok", value: "yeni-cevap" }]]);
  });

  it("dispose sonrası gelen cevap çizilmez", async () => {
    let res: (v: number) => void = () => undefined;
    const out = vi.fn();
    const r = new LatestRequestRunner<number, number>(() => new Promise((x) => (res = x)), out);
    r.schedule(1);
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
    r.dispose();
    res(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(out).not.toHaveBeenCalled();
  });
});

describe("önizleme durumu", () => {
  const empty: PreviewState = { status: "idle", result: null, lastGood: null, message: null };
  it("hatalı derleme son başarılıyı korur; hata listesi cevaptan", () => {
    const s1 = nextPreviewState(empty, { kind: "ok", value: ok("<p>1</p>") });
    const s2 = nextPreviewState(s1, { kind: "ok", value: bad });
    expect(s2.status).toBe("error");
    expect(s2.lastGood?.html).toBe("<p>1</p>");
    expect(s2.result?.hatalar).toHaveLength(1);
  });
  it("zaman aşımı: son başarılı korunur, Türkçe not", () => {
    const s1 = nextPreviewState(empty, { kind: "ok", value: ok("<p>1</p>") });
    const s2 = nextPreviewState(s1, { kind: "error", error: { code: "ECONNABORTED" } });
    expect(s2.status).toBe("timeout");
    expect(s2.message).toBe(PREVIEW_TIMEOUT_NOTE);
    expect(s2.lastGood?.html).toBe("<p>1</p>");
  });
});

describe("önizleme paneli", () => {
  const base = { sampleText: "Örnek", onSample: vi.fn(), onIssue: vi.fn(), docType: "SHIPMENT_DISPATCH", title: "t" };

  it("⭐ iframe sandbox özniteliği BOŞ (script yok, köken yok); HTML srcdoc ile", () => {
    render(<PreviewPane {...base} state={{ status: "ok", result: ok("<p>Merhaba</p>"), lastGood: ok("<p>Merhaba</p>"), message: null }} />);
    const f = screen.getByTitle(PREVIEW_IFRAME_TITLE);
    expect(f.getAttribute("sandbox")).toBe("");
    expect(f.getAttribute("srcdoc")).toBe("<p>Merhaba</p>");
    expect(screen.getByTestId("onizleme-olcum").textContent).toBe("12 ms · 2 KB");
  });

  it("zaman aşımında son başarılı soluk; hata satırı tıklanınca konum bildirilir", () => {
    const onIssue = vi.fn();
    render(<PreviewPane {...base} onIssue={onIssue} state={{ status: "error", result: bad, lastGood: ok("<p>eski</p>"), message: null }} />);
    expect(screen.getByTitle(PREVIEW_IFRAME_TITLE).className).toContain("opacity-40");
    screen.getByText("Satır 3, sütun 5 — Bilinmeyen filtre").click();
    expect(onIssue).toHaveBeenCalledWith(bad.hatalar[0]);
    expect((screen.getByRole("button", { name: /PDF önizleme/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
