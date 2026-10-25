// Zil istemcisi düşüş merdiveni (plan §3.10): SSE → bekle → ozet; epoch değişimi tam çekim; 404 → zil yok.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createBellClient, readSseEvents, BELL_SUMMARY_POLL_MS, type BellDeps } from "./zil-istemcisi";
import type { NotificationSummary } from "./types";

class HttpHata extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

const OZET: NotificationSummary = { enabled: true, okunmamis: 3, alarmAcik: 0, epoch: 100, rev: 1, alarmRev: 0 };

/** Elle beslenen SSE gövdesi: `yaz()` olay basar, `kapat()` akışı bitirir. */
function akis() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
  const enc = new TextEncoder();
  return {
    res: new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    yaz: (event: string, data: object) => ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),
    kapat: () => ctrl.close(),
  };
}

type Dep = BellDeps & {
  ozet: Mock<() => Promise<NotificationSummary>>;
  bekle: Mock<BellDeps["bekle"]>;
  akisAc: Mock<BellDeps["akisAc"]>;
};

function bagimlilik(over: Partial<Record<"ozet" | "bekle" | "akisAc", Mock>> = {}): Dep {
  return {
    ozet: vi.fn(async (): Promise<NotificationSummary> => ({ ...OZET })),
    bekle: vi.fn((_p: unknown, signal: AbortSignal) => new Promise<never>((_r, rej) => signal.addEventListener("abort", () => rej(new Error("abort"))))),
    akisAc: vi.fn(async (): Promise<Response> => new Response(null, { status: 500 })),
    httpDurum: (e: unknown) => (e instanceof HttpHata ? e.status : null),
    ...over,
  } as Dep;
}

const bosalt = async (n = 10) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe("zil istemcisi · düşüş merdiveni", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("SSE 3 kez başarısız → uzun yoklama; /bekle 404 → 30 sn /ozet yoklaması", async () => {
    const dep = bagimlilik({ bekle: vi.fn(async () => Promise.reject(new HttpHata(404))) });
    const z = createBellClient(dep);
    const birak = z.abone();
    await vi.advanceTimersByTimeAsync(0);
    expect(z.durum().kip).toBe("sse");
    await vi.advanceTimersByTimeAsync(20_000); // 1 sn + 3 sn yeniden bağlanma → 3. hata
    expect(dep.akisAc).toHaveBeenCalledTimes(3);
    expect(dep.bekle).toHaveBeenCalledTimes(1);
    expect(z.durum().kip).toBe("ozet");
    const once = dep.ozet.mock.calls.length;
    await vi.advanceTimersByTimeAsync(BELL_SUMMARY_POLL_MS);
    expect(dep.ozet.mock.calls.length).toBe(once + 1);
    birak();
    expect(z.durum().kip).toBe("kapali");
  });

  it("SSE 403/404 → beklemeden uzun yoklamaya düşer", async () => {
    const dep = bagimlilik({ akisAc: vi.fn(async () => new Response(null, { status: 404 })) });
    const z = createBellClient(dep);
    z.abone();
    await vi.advanceTimersByTimeAsync(0);
    expect(dep.akisAc).toHaveBeenCalledTimes(1);
    expect(z.durum().kip).toBe("bekle");
    expect(dep.bekle).toHaveBeenCalledTimes(1);
  });

  it("/ozet 404 (eski backend) → destek yok, akış hiç açılmaz", async () => {
    const dep = bagimlilik({ ozet: vi.fn(async () => Promise.reject(new HttpHata(404))) });
    const z = createBellClient(dep);
    z.abone();
    await vi.advanceTimersByTimeAsync(0);
    expect(z.durum()).toMatchObject({ hazir: true, destek: false, kip: "kapali" });
    expect(dep.akisAc).not.toHaveBeenCalled();
  });

  it("bayrak kapalı (`enabled:false`) → kip kapalı, akış açılmaz", async () => {
    const dep = bagimlilik({ ozet: vi.fn(async (): Promise<NotificationSummary> => ({ enabled: false })) });
    const z = createBellClient(dep);
    z.abone();
    await vi.advanceTimersByTimeAsync(0);
    expect(z.durum()).toMatchObject({ hazir: true, destek: true, enabled: false, kip: "kapali" });
    expect(dep.akisAc).not.toHaveBeenCalled();
  });

});

describe("zil istemcisi · olaylar ve abonelik", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("zil olayı → özet yeniden okunur, rozet güncellenir, liste 'degisti' duyar", async () => {
    const a = akis();
    const dep = bagimlilik({ akisAc: vi.fn(async () => a.res) });
    const z = createBellClient(dep);
    const olaylar: string[] = [];
    z.olayDinle((o) => olaylar.push(o));
    z.abone();
    await vi.advanceTimersByTimeAsync(0);
    a.yaz("merhaba", { epoch: 100, rev: 1, alarmRev: 0 });
    await bosalt();
    expect(olaylar).toEqual([]);
    dep.ozet.mockResolvedValueOnce({ ...OZET, okunmamis: 4, rev: 2 });
    a.yaz("zil", { k: "kutu", rev: 2, alarmRev: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(z.durum().okunmamis).toBe(4);
    expect(olaylar).toEqual(["degisti"]);
  });

  it("epoch değişimi (sunucu yeniden başladı) → 'tam' olayı = her şey baştan çekilir", async () => {
    const a = akis();
    const dep = bagimlilik({ akisAc: vi.fn(async () => a.res) });
    const z = createBellClient(dep);
    const olaylar: string[] = [];
    z.olayDinle((o) => olaylar.push(o));
    z.abone();
    await vi.advanceTimersByTimeAsync(0);
    dep.ozet.mockResolvedValue({ ...OZET, epoch: 200, rev: 0 });
    a.yaz("merhaba", { epoch: 200, rev: 0, alarmRev: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(olaylar).toContain("tam");
    expect(z.durum().epoch).toBe(200);
  });

  it("sağlıklı akış sunucu tarafından kapanırsa hata sayılmaz, yeniden bağlanır", async () => {
    const ilk = akis();
    const ikinci = akis();
    const dep = bagimlilik({ akisAc: vi.fn().mockResolvedValueOnce(ilk.res).mockResolvedValueOnce(ikinci.res) });
    const z = createBellClient(dep);
    z.abone();
    await vi.advanceTimersByTimeAsync(0);
    ilk.yaz("merhaba", { epoch: 100, rev: 1, alarmRev: 0 });
    await bosalt();
    ilk.kapat();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(dep.akisAc).toHaveBeenCalledTimes(2);
    expect(z.durum().kip).toBe("sse");
  });

  it("referans sayımı: iki abone tek akış; son bırakan kapatır", async () => {
    const a = akis();
    const dep = bagimlilik({ akisAc: vi.fn(async () => a.res) });
    const z = createBellClient(dep);
    const b1 = z.abone();
    const b2 = z.abone();
    await vi.advanceTimersByTimeAsync(0);
    expect(dep.akisAc).toHaveBeenCalledTimes(1);
    b1();
    expect(z.durum().kip).toBe("sse");
    b2();
    expect(z.durum().kip).toBe("kapali");
  });
});

describe("readSseEvents · ayrıştırıcı", () => {
  it("parçalı gelen olayları birleştirir, `: ping` yorumunu atlar", async () => {
    const enc = new TextEncoder();
    const parcalar = [": ping\n\nevent: mer", 'haba\ndata: {"epoch":1}\n', "\nevent: zil\r\ndata: {}\r\n\r\n"];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        parcalar.forEach((p) => c.enqueue(enc.encode(p)));
        c.close();
      },
    });
    const out: Array<{ event: string; data: string }> = [];
    for await (const e of readSseEvents(body)) out.push(e);
    expect(out).toEqual([
      { event: "merhaba", data: '{"epoch":1}' },
      { event: "zil", data: "{}" },
    ]);
  });
});
