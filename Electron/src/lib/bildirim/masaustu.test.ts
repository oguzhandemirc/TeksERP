// Masaüstü bildirimi çekirdeği (plan §6.7): ilk okuma taban (fırtına yok) · yeni satır TEK OS bildirimi ·
// aynı satır ikinci kez bildirilmez · pencere öndeyse tost · seçilmemiş tür / ALARM / okunmuş bildirilmez ·
// köprü yok (web) ya da seçim boş → liste hiç çekilmez · rozet zil durumundan (bayrak kapalı → null).
import { describe, expect, it, vi } from "vitest";
import type { BildirimDesktopApi } from "@shared/ipc-contract";
import { createDesktopNotifier, desktopTextOf, pickFreshRows, rozetIstegi } from "./masaustu";
import type { NotificationItem } from "./types";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function item(n: number, over: Partial<NotificationItem> = {}): NotificationItem {
  const an = `2026-10-25T10:00:${String(n).padStart(2, "0")}Z`;
  return {
    id: ID(n), tur: "siparis.patron-siparisi", sinif: "BILDIRIM", altTur: "OLAY", grup: "Sipariş",
    baslik: `Patron siparişi ${n}`, govde: "Ali Tekstil", yol: `/operations/orders?focus=o${n}`, konu: { tip: "order", id: `o${n}` },
    sayac: 1, ilkAn: an, sonAn: an, neden: "IZIN", okunduAn: null, erteleBitis: null, cozulduAn: null, ...over,
  };
}

function kur(sonuc: Awaited<ReturnType<BildirimDesktopApi["notify"]>> = { shown: true }, bridgeVar = true) {
  let satirlar: NotificationItem[] = [];
  const notify = vi.fn(async (_req: unknown) => sonuc);
  const bridge = bridgeVar ? ({ notify, rozet: vi.fn(), onOpen: vi.fn() } as unknown as BildirimDesktopApi) : null;
  const liste = vi.fn(async () => satirlar);
  const tost = vi.fn();
  const n = createDesktopNotifier({ bridge, liste, tost });
  return { n, notify, liste, tost, set: (x: NotificationItem[]) => void (satirlar = x) };
}

describe("createDesktopNotifier", () => {
  it("ilk okuma tabandır; sonra gelen yeni satır tek OS bildirimi, ikinci kez bildirilmez", async () => {
    const k = kur();
    k.n.turleriAyarla(["siparis.patron-siparisi"]);
    k.set([item(1), item(2)]);
    await k.n.kontrol();
    expect(k.notify).not.toHaveBeenCalled();
    k.set([item(3), item(1), item(2)]);
    await k.n.kontrol();
    expect(k.notify).toHaveBeenCalledTimes(1);
    expect(k.notify).toHaveBeenCalledWith({
      kind: "siparis.patron-siparisi", baslik: "Patron siparişi 3", govde: "Ali Tekstil",
      yol: "/operations/orders?focus=o3", klass: "BILDIRIM", bildirimId: ID(3),
    });
    await k.n.kontrol();
    expect(k.notify).toHaveBeenCalledTimes(1);
    expect(k.liste).toHaveBeenLastCalledWith(["siparis.patron-siparisi"]);
  });

  it("aynı partide birden çok yeni satır → en yenisi + 've N yeni bildirim daha'", async () => {
    const k = kur();
    k.n.turleriAyarla(["siparis.patron-siparisi"]);
    await k.n.kontrol();
    k.set([item(4), item(6), item(5)]);
    await k.n.kontrol();
    expect(k.notify).toHaveBeenCalledTimes(1);
    expect(k.notify.mock.calls[0]![0]).toMatchObject({ bildirimId: ID(6), govde: "Ali Tekstil · ve 2 yeni bildirim daha" });
  });

  it("pencere öndeyse (focused) OS bildirimi yok → uygulama içi tost", async () => {
    const k = kur({ shown: false, reason: "focused" });
    k.n.turleriAyarla(["siparis.patron-siparisi"]);
    await k.n.kontrol();
    k.set([item(7)]);
    await k.n.kontrol();
    expect(k.tost).toHaveBeenCalledWith(expect.objectContaining({ id: ID(7) }), 0);
  });

  it("OS bildirimi çıktıysa tost yok; desteklenmiyorsa da tost yok", async () => {
    for (const r of [{ shown: true } as const, { shown: false, reason: "unsupported" } as const]) {
      const k = kur(r);
      k.n.turleriAyarla(["siparis.patron-siparisi"]);
      await k.n.kontrol();
      k.set([item(8)]);
      await k.n.kontrol();
      expect(k.tost).not.toHaveBeenCalled();
    }
  });

  it("köprü yok (web) ya da seçim boş → liste hiç çekilmez, hata yok", async () => {
    const web = kur({ shown: true }, false);
    web.n.turleriAyarla(["siparis.patron-siparisi"]);
    await web.n.kontrol();
    await web.n.kontrol();
    expect(web.liste).not.toHaveBeenCalled();
    const bos = kur();
    await bos.n.kontrol();
    expect(bos.liste).not.toHaveBeenCalled();
  });

  it("seçim değişince yeni taban: eski okunmamışlar bildirilmez", async () => {
    const k = kur();
    k.n.turleriAyarla(["siparis.patron-siparisi"]);
    await k.n.kontrol();
    k.n.turleriAyarla(["siparis.patron-siparisi", "sistem.yedek-basarisiz"]);
    k.set([item(9, { tur: "sistem.yedek-basarisiz" })]);
    await k.n.kontrol();
    expect(k.notify).not.toHaveBeenCalled();
  });

  it("liste hatası sessizdir ve sonraki zil yeniden dener", async () => {
    const k = kur();
    k.n.turleriAyarla(["siparis.patron-siparisi"]);
    k.liste.mockRejectedValueOnce(new Error("ağ"));
    await expect(k.n.kontrol()).resolves.toBeUndefined();
    await k.n.kontrol();
    expect(k.liste).toHaveBeenCalledTimes(2);
  });
});

describe("pickFreshRows", () => {
  it("okunmuş, ALARM, seçilmemiş tür, görülmüş ve dış adresli satır elenir", () => {
    const secili = new Set(["siparis.patron-siparisi", "dokuma.tezgah-alarmi"]);
    const rows = [
      item(1, { okunduAn: "2026-10-25T10:00:00Z" }),
      item(2, { sinif: "ALARM", tur: "dokuma.tezgah-alarmi" }),
      item(3, { tur: "sistem.yedek-basarisiz" }),
      item(4),
      item(5, { yol: "https://kotu.example/x" }),
      item(6),
    ];
    expect(pickFreshRows(rows, new Set([ID(6)]), secili).map((b) => b.id)).toEqual([ID(4)]);
  });
});

describe("rozetIstegi + desktopTextOf", () => {
  const s = { hazir: true, destek: true, enabled: true, okunmamis: 12, alarmAcik: 1 };
  it("zil çizilmiyorsa (bayrak kapalı / eski backend / ilk özet yok) rozet isteği yok", () => {
    expect(rozetIstegi({ ...s, enabled: false })).toBeNull();
    expect(rozetIstegi({ ...s, destek: false })).toBeNull();
    expect(rozetIstegi({ ...s, hazir: false })).toBeNull();
  });
  it("sayı zil rozetinin sayısı; açık alarm → alarm:true", () => {
    expect(rozetIstegi(s)).toEqual({ okunmamis: 12, alarm: true });
    expect(rozetIstegi({ ...s, okunmamis: 0, alarmAcik: 0 })).toEqual({ okunmamis: 0, alarm: false });
  });
  it("boş gövde alanı yollanmaz", () => {
    expect(desktopTextOf(item(1, { govde: "" }), 0)).toEqual({ baslik: "Patron siparişi 1" });
  });
});
