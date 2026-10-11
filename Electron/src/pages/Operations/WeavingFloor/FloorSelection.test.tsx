// Salon seçim katmanı (tasarım TEZGAH-SALONU-SECIM-IS-VERME §A/§B, 1. dilim): tık / Ctrl / Shift,
// lasso (4 px eşiği), Ctrl+A / Esc, klavye, sağ tık + "⋯" menüsü (modül kapalı → yok, izin yok →
// pasif + neden), tazelemede kimlikle korunan seçim, dokunmatik uzun bas ve TV kipinde seçim yokluğu.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";

vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));
const flags = vi.hoisted(() => ({ dokuma: true }));
vi.mock("@/hooks/usePricingEnabled", async (orig) => ({ ...(await orig<object>()), useDokumaEnabled: () => flags.dokuma }));

import { WeavingFloorView } from "./WeavingFloorView";
import { LONG_PRESS_MS } from "./useLongPress";
import type { FloorState, LiveLoom } from "./types";

const NOW = Date.parse("2026-10-10T08:30:00.000Z");

const mk = (id: string, hall: string): LiveLoom => ({
  id, code: `T-${id}`, hall, monitored: false, stateSource: "elle", loomType: null, targetRpm: null, rpm: null, picksPerCm: null, shift: null,
  today: { runSec: 0, plannedSec: 0 }, stops: [], dayBreakdown: [], events: [], job: null, beams: [], source: "OPERATOR", openStop: null,
});
const LOOMS = [mk("a", "Hol A"), mk("b", "Hol A"), mk("c", "Hol A"), mk("d", "Hol B"), mk("e", "Hol B")];
const floorOf = (looms: LiveLoom[]): FloorState => ({ shift: null, halls: ["Hol A", "Hol B"], looms, updatedAt: NOW, rng: 1 });

// Kart yerleşimi (jsdom yerleşim yapmaz): 3 kolon, 100×80 kart, 10 px boşluk.
const POS: Record<string, [number, number]> = { a: [0, 0], b: [110, 0], c: [220, 0], d: [0, 120], e: [110, 120] };

beforeAll(() => {
  if (!("PointerEvent" in window)) {
    class PointerEventPoly extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: PointerEventPoly, configurable: true });
  }
});

beforeEach(() => {
  flags.dokuma = true;
  setPerms(["*"]);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const p = POS[this.dataset.loomId ?? ""];
    const [x, y] = p ?? [0, 0];
    const [w, h] = p ? [100, 80] : [0, 0];
    return { left: x, top: y, right: x + w, bottom: y + h, x, y, width: w, height: h, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  useAuthStore.setState({ user: null });
});

function setPerms(permissions: string[]) {
  useAuthStore.setState({ user: { userId: "u1", username: "k", permissions } as unknown as JwtPayload });
}

function view(opts: { tv?: boolean; looms?: LiveLoom[] } = {}) {
  const el = (looms: LiveLoom[]) => (
    <MemoryRouter>
      <WeavingFloorView floor={floorOf(looms)} now={NOW} sampleData={false} tv={opts.tv} tvExit={opts.tv ? { onExit: () => undefined, label: "TV kipinden çık" } : undefined} />
    </MemoryRouter>
  );
  const r = render(el(opts.looms ?? LOOMS));
  return { ...r, refresh: (looms: LiveLoom[]) => r.rerender(el(looms)) };
}

const card = (id: string) => document.querySelector<HTMLElement>(`[data-loom-id="${id}"]`)!;
const pressed = () => [...document.querySelectorAll<HTMLElement>("[data-loom-id][aria-pressed=true]")].map((e) => e.dataset.loomId).sort();
const detailOpen = () => screen.queryByRole("dialog") !== null;
const bar = () => screen.queryByRole("toolbar", { name: "Seçim çubuğu" });
const lassoArea = () => card("a").closest("section")!.parentElement!;

describe("tık / Ctrl / Shift", () => {
  it("tek tık detayı açar VE tezgahı tek seçili yapar", () => {
    view();
    fireEvent.click(card("b"));
    expect(pressed()).toEqual(["b"]);
    expect(detailOpen()).toBe(true);
    expect(bar()?.textContent).toContain("1 tezgah seçili");
  });

  it("⭐ Ctrl/Cmd+tık ekler/çıkarır ve detay AÇMAZ", () => {
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.click(card("d"), { metaKey: true });
    expect(pressed()).toEqual(["a", "d"]);
    expect(detailOpen()).toBe(false);
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(pressed()).toEqual(["d"]);
  });

  it("Shift+tık çapadan görünen sırayla aralık seçer (hol sınırını geçer)", () => {
    view();
    fireEvent.click(card("b"), { ctrlKey: true });
    fireEvent.click(card("d"), { shiftKey: true });
    expect(pressed()).toEqual(["b", "c", "d"]);
    expect(detailOpen()).toBe(false);
  });

  it("hol başlığına çift tık o holün görünen tezgahlarını seçer", () => {
    view();
    fireEvent.doubleClick(document.querySelector('[data-hall-header="Hol B"]')!);
    expect(pressed()).toEqual(["d", "e"]);
  });
});

describe("klavye: Ctrl+A, Esc, ok, Boşluk", () => {
  it("⭐ Ctrl+A görünenleri seçer; yazı kutusundayken tarayıcıya bırakır", () => {
    view();
    const input = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(input, { key: "a", ctrlKey: true });
    expect(pressed()).toEqual([]);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(pressed()).toEqual(["a", "b", "c", "d", "e"]);
    input.remove();
  });

  it("⭐ Esc sırası: önce detay kapanır, sonra seçim bırakılır", () => {
    view();
    fireEvent.click(card("a"));
    expect(detailOpen()).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(detailOpen()).toBe(false);
    expect(pressed()).toEqual(["a"]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(pressed()).toEqual([]);
    expect(bar()).toBeNull();
  });

  it("detay açıkken seçim değişse de Esc önce detayı kapatır", () => {
    view();
    fireEvent.click(card("a"));
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.click(card("c"), { ctrlKey: true });
    expect(detailOpen()).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(detailOpen()).toBe(false);
    expect(pressed()).toEqual(["c"]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(pressed()).toEqual([]);
  });

  it("ok tuşu komşu karta odaklanır; Shift+ok aralığı büyütür; Boşluk seçer/bırakır", () => {
    view();
    card("a").focus();
    fireEvent.keyDown(card("a"), { key: " " });
    expect(pressed()).toEqual(["a"]);
    fireEvent.keyDown(card("a"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(card("b"));
    fireEvent.keyDown(card("b"), { key: "ArrowRight", shiftKey: true });
    expect(document.activeElement).toBe(card("c"));
    expect(pressed()).toEqual(["a", "b", "c"]);
    fireEvent.keyDown(card("c"), { key: " " });
    expect(pressed()).toEqual(["a", "b"]);
  });
});

describe("sürükle-seç (lasso)", () => {
  const drag = (from: [number, number], to: [number, number], init: Partial<PointerEventInit> = {}, target: Element = lassoArea()) => {
    fireEvent.pointerDown(target, { button: 0, pointerType: "mouse", clientX: from[0], clientY: from[1], ...init });
    fireEvent.pointerMove(window, { clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(window, { clientX: to[0], clientY: to[1], ...init });
  };

  it("⭐ boş alandan sürükleme değen kartları seçer", () => {
    view();
    drag([105, 75], [225, 125]);
    expect(pressed()).toEqual(["b", "c", "e"]);
  });

  it("4 px'ten kısa sürükleme seçmez (boşluğa tık seçimi bırakır)", () => {
    view();
    fireEvent.click(card("c"), { ctrlKey: true });
    drag([95, 75], [98, 77]);
    expect(pressed()).toEqual([]);
  });

  it("Ctrl basılıyken mevcut seçime ekler; kart üstünden başlayan sürükleme lasso değildir", () => {
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    drag([105, 75], [115, 125], { ctrlKey: true });
    expect(pressed()).toEqual(["a", "b", "e"]);
    drag([50, 40], [300, 300], {}, card("a"));
    expect(pressed()).toEqual(["a", "b", "e"]);
  });
});

describe("sağ tık ve '⋯' menüsü (tek liste)", () => {
  it("seçimde olmayan kartta sağ tık seçimi o karta indirir; menü öğeleri listelenir", async () => {
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    await act(async () => fireEvent.contextMenu(card("c")));
    expect(pressed()).toEqual(["c"]);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("1 tezgah seçili")).toBeTruthy();
    expect(within(menu).getByText("Detayı aç")).toBeTruthy();
    expect(within(menu).getByText("Duruş listesi")).toBeTruthy();
  });

  it("⭐ izin yok: öğe görünür, pasif ve nedenini söyler", async () => {
    setPerms(["loom:live-view"]);
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    await act(async () => fireEvent.contextMenu(card("a")));
    const menu = await screen.findByRole("menu");
    const item = within(menu).getByText("Duruş listesi").closest("[role=menuitem]")!;
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("Yetkiniz yok — Tezgah Duruşları izni gerekir.");
  });

  it("⭐ dokuma modülü kapalı: duruş listesi ve raporlar hiç görünmez", async () => {
    flags.dokuma = false;
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(within(bar()!).queryByText("Dokuma raporları")).toBeNull();
    await act(async () => fireEvent.contextMenu(card("a")));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Duruş listesi")).toBeNull();
    expect(within(menu).queryByText("Dokuma raporları")).toBeNull();
  });

  it("hol başlığında sağ tık 'Bu holü seç' sunar", async () => {
    view();
    await act(async () => fireEvent.contextMenu(document.querySelector('[data-hall-header="Hol A"]')!));
    fireEvent.click(await screen.findByText("Bu holü seç (Hol A)"));
    expect(pressed()).toEqual(["a", "b", "c"]);
  });

  it("çubuktaki pasif düğme nedenini taşır; '⋯' aynı listeyi açar", async () => {
    setPerms([]);
    view();
    fireEvent.click(card("a"), { ctrlKey: true });
    expect(within(bar()!).getByLabelText("Dokuma raporları — Yetkiniz yok — Üretim raporları izni gerekir.")).toBeTruthy();
    const more = within(bar()!).getByRole("button", { name: "Diğer eylemler" });
    await act(async () => fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Duruş listesi").closest("[role=menuitem]")!.getAttribute("aria-disabled")).toBe("true");
    expect(within(menu).getByText("Seçimi bırak")).toBeTruthy();
  });
});

describe("canlı tazeleme", () => {
  it("⭐ seçim kimlikle korunur; düşen tezgah çıkar ve çubuk sayısını söyler", () => {
    const { refresh } = view();
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.click(card("d"), { ctrlKey: true });
    refresh([LOOMS[4]!, LOOMS[3]!, LOOMS[2]!, LOOMS[1]!]);
    expect(pressed()).toEqual(["d"]);
    expect(bar()?.textContent).toContain("1 tezgah seçili");
    expect(bar()?.textContent).toContain("1 tezgah artık listede yok");
  });
});

describe("dokunmatik", () => {
  const touchDown = (id: string) => fireEvent.pointerDown(card(id), { pointerType: "touch", clientX: 10, clientY: 10 });
  const touchUp = (id: string) => fireEvent.pointerUp(card(id), { pointerType: "touch" });

  it("⭐ uzun bas seçim kipine girer + kartı seçer; ardından gelen tık yutulur; sonraki dokunuş ekler, detay açmaz", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    view();
    touchDown("b");
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    touchUp("b");
    fireEvent.click(card("b"));
    expect(pressed()).toEqual(["b"]);
    expect(bar()?.textContent).toContain("Bitti");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(card("e"));
    expect(pressed()).toEqual(["b", "e"]);
    expect(detailOpen()).toBe(false);
    fireEvent.click(within(bar()!).getByRole("button", { name: "Bitti — seçimi bırak" }));
    expect(pressed()).toEqual([]);
  });

  it("parmak kayarsa (kaydırma) uzun bas iptal; dokunmatikte sağ tık menüsü açılmaz", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    view();
    touchDown("b");
    fireEvent.pointerMove(card("b"), { pointerType: "touch", clientX: 10, clientY: 40 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    });
    expect(pressed()).toEqual([]);
    touchUp("b");
    await act(async () => fireEvent.contextMenu(card("b")));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("TV kipi", () => {
  it("⭐ seçim, menü, lasso ve çubuk YOK; kart aria-pressed taşımaz", async () => {
    view({ tv: true });
    fireEvent.click(card("a"), { ctrlKey: true });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    await act(async () => fireEvent.contextMenu(card("a")));
    expect(card("a").hasAttribute("aria-pressed")).toBe(false);
    expect(document.querySelectorAll("[aria-pressed]").length).toBe(0);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(bar()).toBeNull();
    expect(detailOpen()).toBe(false);
  });
});
