// =============================================================================
// Bekçi: Offsite kartı — "son başarılı kopya" satırı ve bayatlık (2026-09-22)
//   §1 Bayat (`stale:true`) ⇒ eksik yok + ok olsa da durum "sorun"
//   §2 Eski sunucu `stale` göndermez ⇒ bayat SAYILMAZ (geriye dönük, kırmızı üretmez)
//   §3 Hedef yok ⇒ "yok"; bayat satırı YAZILMAZ (o ayrı kırmızı)
//   §4 lastOkAt satırı: tarih + göreli süre; hiç yoksa "henüz yok" cümlesi
//   §5 Bayat cümlesi ardışık hata sayısı ve son nedeni taşır
//   §6 relativeAgo: dk → sa → gün eşikleri
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-22):
//   (a) `state` hesabından `&& !stale` silindi -> §1 KIRMIZI
//   (b) `stale === true` yerine `o.stale !== false` (fail-open) -> §2 KIRMIZI
// =============================================================================
import { describe, expect, it } from "vitest";
import { offsiteCardView, relativeAgo } from "./offsiteState";
import type { OffsiteStatus } from "./service";

const now = new Date("2026-09-22T12:00:00.000Z");
const base: OffsiteStatus["offsite"] = {
  configured: true, ok: true, localCount: 28, remoteCount: 28, missingCount: 0, warnings: [],
  lastOkAt: "2026-09-22T09:00:00.000Z", stale: false, staleAfterHours: 6, consecutiveFailures: 0, lastError: null,
};

describe("offsiteCardView", () => {
  it("§1 bayat ⇒ sorun (eksik yok, ok:true olsa da)", () => {
    const v = offsiteCardView({ ...base, stale: true, consecutiveFailures: 3, lastError: "dial tcp: lookup www.googleapis.com" }, now);
    expect(v.state).toBe("sorun");
    expect(v.staleLine).toContain("3 sa");
    expect(v.staleLine).toContain("uzak kopya alınamıyor");
  });
  it("§2 eski sunucu (stale alanı yok) ⇒ bayat sayılmaz", () => {
    const { stale: _s, lastOkAt: _l, ...eski } = base;
    void _s; void _l;
    const v = offsiteCardView(eski, now);
    expect(v.state).toBe("iyi");
    expect(v.staleLine).toBeNull();
  });
  it("§3 hedef yok ⇒ yok, bayat satırı yazılmaz", () => {
    const v = offsiteCardView({ ...base, configured: false, stale: true, lastOkAt: null }, now);
    expect(v.state).toBe("yok");
    expect(v.staleLine).toBeNull();
  });
  it("§4 son başarılı satırı tarih + göreli süre; yoksa 'henüz yok'", () => {
    expect(offsiteCardView(base, now).lastOkLine).toMatch(/Son başarılı kopya: 22\.09 \d\d:00 \(3 sa önce\)/);
    expect(offsiteCardView({ ...base, lastOkAt: null, stale: true }, now).lastOkLine).toBe("Henüz hiç başarılı uzak kopya yok.");
  });
  it("§5 bayat cümlesi ardışık hata + neden taşır; hiç başarı yoksa ayrı kalıp", () => {
    const v = offsiteCardView({ ...base, stale: true, consecutiveFailures: 7, lastError: "rclone 1" }, now);
    expect(v.staleLine).toBe("3 sadir uzak kopya alınamıyor · 7 ardışık hata: rclone 1");
    const hic = offsiteCardView({ ...base, stale: true, lastOkAt: null, consecutiveFailures: 2, lastError: null }, now);
    expect(hic.staleLine).toBe("Uzak kopya hiçbir zaman başarılı olmadı · 2 ardışık hata");
  });
  it("§6 relativeAgo eşikleri", () => {
    const t = (ms: number): string => relativeAgo(new Date(now.getTime() - ms), now);
    expect(t(5 * 60_000)).toBe("5 dk önce");
    expect(t(3 * 3_600_000)).toBe("3 sa önce");
    expect(t(47 * 3_600_000)).toBe("47 sa önce");
    expect(t(72 * 3_600_000)).toBe("3 gün önce");
    expect(relativeAgo(new Date(now.getTime() + 60_000), now)).toBe("0 dk önce");
  });
});
