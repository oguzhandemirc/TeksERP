import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIVITY_EXPORT_COLUMNS, buildFeedParams, effectiveView, type FeedItem } from "./activity-view";
import type { SystemLogIslem, SystemLogListItem } from "@/types/systemLog";

const row = (over: Partial<SystemLogListItem> = {}): SystemLogListItem => ({
  id: "l1", category: "DOMAIN", action: "UPDATE", tableName: "ORDER", recordId: "r1", ipAddress: null,
  createdAt: "2026-10-25T10:00:00Z", user: { id: "u", username: "ahmet", fullName: "Ahmet Yılmaz" }, ...over,
});
const islem = (over: Partial<SystemLogIslem> = {}): SystemLogIslem => ({
  id: "q1", requestId: "q1", createdAt: "2026-10-25T10:00:00Z", user: null, kayitSayisi: 3, reddedildi: false, iz: null,
  anlati: { metin: "Ahmet Y. SV-1 sevkiyatını onayladı ve 2 kayıt daha etkilendi", parcalar: [] },
  satirlar: [{ id: "l1", tableName: "SHIPMENT", recordId: "r", action: "UPDATE", createdAt: "2026-10-25T10:00:00Z" }], ...over,
});

describe("süzme SUNUCUDA — süzgeç → sorgu parametresi", () => {
  it("varsayılan görünüm işlem; gün çipi tarih aralığını sunucuya bırakır", () => {
    const p = buildFeedParams({ gun: "dun", userId: "u1", dateFrom: "2026-10-01T00:00:00.000Z" }, undefined, 50);
    expect(p).toMatchObject({ gorunum: "islem", gun: "dun", userId: "u1", category: "DOMAIN", limit: 50 });
    expect(p.dateFrom).toBeUndefined();
  });
  it("tüm satırlar görünümünde `gorunum` gönderilmez; kısa arama gönderilmez", () => {
    const p = buildFeedParams({ gorunum: "satir", q: " S " }, "c1", 50);
    expect(p.gorunum).toBeUndefined();
    expect(p.q).toBeUndefined();
    expect(p.cursor).toBe("c1");
    expect(buildFeedParams({ q: " SP-2026-0148 " }, undefined, 50).q).toBe("SP-2026-0148");
  });

  it("Reddedilenler: yalnız İşlemler görünümünde ve aramasızken `reddedilen: 1`", () => {
    expect(buildFeedParams({ reddedilen: true }, undefined, 50).reddedilen).toBe(1);
    expect(buildFeedParams({ reddedilen: true, gorunum: "satir" }, undefined, 50).reddedilen).toBeUndefined();
    expect(buildFeedParams({ reddedilen: true, q: "SP-1" }, undefined, 50).reddedilen).toBeUndefined();
    expect(buildFeedParams({}, undefined, 50).reddedilen).toBeUndefined();
  });

  // Sonda (2026-10-25): ActivityPage'e `.filter(` eklemek → 1 kırmızı.
  it.each(["ActivityPage.tsx", "ActivityFeed.tsx", "ActivityFilters.tsx"])("%s dönen listeyi süzmez", (f) => {
    const src = readFileSync(join(__dirname, f), "utf8");
    expect(src).not.toMatch(/\.\s*filter\s*\(/);
  });
});

describe("eski backend düşüşü", () => {
  it("işlem istendi ama sunucu satır döndürdü → Tüm satırlar", () => {
    expect(effectiveView("islem", [row()])).toBe("satir");
    expect(effectiveView("islem", [islem()])).toBe("islem");
    expect(effectiveView("islem", [])).toBe("islem");
    expect(effectiveView("satir", [islem()])).toBe("satir");
  });
});

describe("dışa aktarma — Açıklama kolonu = anlati.metin", () => {
  const col = ACTIVITY_EXPORT_COLUMNS.find((c) => c.label === "Açıklama")!;
  it("anlatı varsa sunucunun cümlesi", () => {
    expect(col.value(islem() as FeedItem)).toBe("Ahmet Y. SV-1 sevkiyatını onayladı ve 2 kayıt daha etkilendi");
    expect(col.value(row({ anlati: { metin: "CÜMLE", parcalar: [] } }))).toBe("CÜMLE");
  });
  it("anlatı yoksa eski özet", () => {
    expect(String(col.value(row()))).toMatch(/^Ahmet Yılmaz → Sipariş kaydını \S+/);
  });
});
