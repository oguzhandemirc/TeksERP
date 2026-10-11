// Kart levent rozeti: ilk bitecek leventin kalanı görünür, levent no ipucunda ve ekran okuyucu
// metninde; levent yoksa rozet yok (ölçülmeyen değer uydurulmaz). Kaynak etiketi: elle veri
// ölçülmüş gibi okunmaz; durumu bilinmeyen kart "Veri yok".
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FloorHintProvider } from "./FloorHint";
import { LoomCard } from "./LoomCard";
import type { LiveLoom } from "./types";

const NOW = Date.parse("2026-10-10T08:30:00.000Z");

function loom(over: Partial<LiveLoom>): LiveLoom {
  return {
    id: "m1", code: "07", hall: "Hol A", monitored: true, stateSource: "elle", loomType: null, targetRpm: null, rpm: null, picksPerCm: null,
    openStop: null, shift: null, today: { runSec: 2700, plannedSec: 3600 }, stops: [], dayBreakdown: [], events: [],
    job: null, beams: [], source: "OPERATOR", ...over,
  };
}

describe("LoomCard levent rozeti", () => {
  it("⭐ iki levent: rozet ilk biteceğin kalanını basar, +1 ve ikisinin numarası ipucunda", () => {
    render(<LoomCard loom={loom({ beams: [
      { no: "LV-1", slot: 1, warpSpec: "CK", totalM: 1000, remainingM: 900 },
      { no: "LV-2", slot: 2, warpSpec: "CK", totalM: 1000, remainingM: 40 },
    ] })} now={NOW} star={false} onSelect={() => undefined} />);
    const badge = screen.getByTestId("beam-badge");
    expect(badge.textContent).toBe("40 m+1");
    expect(badge.getAttribute("title")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("levent LV-2 40 m kaldı");
  });

  it("levent yoksa rozet çizilmez, ekran okuyucu metninde levent yok", () => {
    render(<LoomCard loom={loom({})} now={NOW} star={false} onSelect={() => undefined} />);
    expect(screen.queryByTestId("beam-badge")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-label")).not.toContain("levent");
  });
});

describe("LoomCard kaynak etiketi", () => {
  const stop = {
    reasonCode: "MEKANIK", label: "Mekanik arıza", lossClass: "UNPLANNED" as const, startedAt: NOW - 30 * 60_000, targetMin: 10, graceMin: 0,
    attendant: null, notifiedAt: null, respondedAt: null, escalatedAt: null,
  };

  it("⭐ elle açılmış duruş: kart boyalı, sayaç işler, kaynak 'Elle' ve ekran okuyucu metninde", () => {
    render(<LoomCard loom={loom({ openStop: stop })} now={NOW} star={false} onSelect={() => undefined} />);
    expect(screen.getByTestId("source-tag").textContent).toBe("Elle");
    const aria = screen.getByRole("button").getAttribute("aria-label")!;
    expect(aria).toContain("duruyor (elle): Mekanik arıza");
    expect(aria).toContain("Hedef süre aşıldı");
  });

  it("sensörden ölçülen tezgah 'Ölçülen' yazar", () => {
    render(<LoomCard loom={loom({ stateSource: "olculen" })} now={NOW} star={false} onSelect={() => undefined} />);
    expect(screen.getByTestId("source-tag").textContent).toBe("Ölçülen");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("çalışıyor (ölçülen)");
  });

  it("durumu bilinmeyen tezgah: etiket yok, 'Veri yok'", () => {
    render(<LoomCard loom={loom({ monitored: false, stateSource: "cikarim" })} now={NOW} star={false} onSelect={() => undefined} />);
    expect(screen.queryByTestId("source-tag")).toBeNull();
    expect(screen.getByRole("button").textContent).toContain("Veri yok");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("veri yok");
  });

  it("eski sunucu (alan yok): etiket çizilmez", () => {
    render(<LoomCard loom={loom({ stateSource: null })} now={NOW} star={false} onSelect={() => undefined} />);
    expect(screen.queryByTestId("source-tag")).toBeNull();
  });
});

describe("LoomCard ipucu (FloorHint)", () => {
  const stop = {
    reasonCode: "MEKANIK_ARIZA", label: "Mekanik arıza", lossClass: "UNPLANNED" as const, startedAt: NOW - 30 * 60_000, targetMin: 10, graceMin: 0,
    attendant: null, notifiedAt: null, respondedAt: null, escalatedAt: null,
  };
  const card = (over: Partial<LiveLoom>, hints = true) => (
    <FloorHintProvider enabled={hints}>
      <LoomCard loom={loom({ code: "MAK1010260002", ...over })} now={NOW} star={false} onSelect={() => undefined} />
    </FloorHintProvider>
  );

  it("⭐ klavye odağı kartın ipucunu açar: sebep, süre, hedef aşımı, kaynak", async () => {
    render(card({ openStop: stop }));
    await act(async () => fireEvent.focus(screen.getAllByRole("button")[0]!));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("MAK1010260002");
    expect(tip.textContent).toContain("Mekanik arıza");
    expect(tip.textContent).toContain("30 dk duruyor");
    expect(tip.textContent).toContain("20 dk aşıldı");
    expect(tip.textContent).toContain("Elle");
  });

  it("fareyle tıklanan kart ipucu açmaz (yalnız klavye odağı)", async () => {
    render(card({ openStop: stop }));
    const btn = screen.getAllByRole("button")[0]!;
    await act(async () => {
      fireEvent.pointerDown(btn);
      fireEvent.focus(btn);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("⭐ sebep simgesi ve uzun ad: simgenin ipucu durumu anlatır; ad kırpılır, tam adı ipucunda", async () => {
    render(card({ openStop: stop }));
    const name = screen.getByTestId("loom-name");
    expect(name.className).toContain("truncate");
    await act(async () => {
      fireEvent.pointerMove(screen.getByTestId("reason-icon"));
      await new Promise((r) => setTimeout(r, 350));
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("Arıza / kopuş");
    expect(tip.textContent).toContain("Başladı");
  });

  it("TV kipi (sağlayıcı kapalı): ipucu yok, düz `title` da yok", async () => {
    render(card({ openStop: stop }, false));
    await act(async () => fireEvent.focus(screen.getByRole("button")));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(document.querySelector("[title]")).toBeNull();
  });
});
