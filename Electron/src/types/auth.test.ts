import { describe, it, expect } from "vitest";
import { matchesPermission, hasAdminAccess, canEnterApp } from "./auth";

describe("matchesPermission (backend rbac ile birebir semantik)", () => {
  it("global * her şeyi açar", () => {
    expect(matchesPermission(["*"], "order:write")).toBe(true);
  });
  it("birebir kod eşleşir", () => {
    expect(matchesPermission(["order:read"], "order:read")).toBe(true);
  });
  it("tek-seviye domain wildcard yalnız kendi domainini açar", () => {
    expect(matchesPermission(["admin:*"], "admin:users")).toBe(true);
    expect(matchesPermission(["admin:*"], "order:read")).toBe(false);
  });
  it("eşleşme yoksa false", () => {
    expect(matchesPermission(["order:read"], "order:write")).toBe(false);
    expect(matchesPermission([], "order:read")).toBe(false);
  });
  it("admin:users TÜM admin'i açmaz (eski isAdmin kısayolu bug'ı)", () => {
    expect(matchesPermission(["admin:users"], "admin:settings")).toBe(false);
  });
});

describe("hasAdminAccess", () => {
  it("herhangi bir admin izni → true", () => {
    expect(hasAdminAccess(["admin:users"])).toBe(true);
    expect(hasAdminAccess(["admin:settings"])).toBe(true);
    expect(hasAdminAccess(["admin:*"])).toBe(true);
  });
  it("admin izni yoksa → false", () => {
    expect(hasAdminAccess(["order:read", "shipping:write"])).toBe(false);
  });
  // ⚠️ SATICI (SÜPERADMİN) HESABI — backend `getEffectivePermissions` ona
  // tek eleman olarak `["*"]` döner. Eski düz-`includes` yazımı bunu
  // TANIMIYORDU: Sistem hub'ında `adminOnly` karolar ve yalnız `adminOnly`
  // taşıyan komut paleti girdileri gizleniyordu (Sidebar ikinci dalıyla
  // kurtardığı için belirti KISMİ ve sessizdi).
  // NEGATİF SONDA (2026-09-03): gövde `permissions.includes(p)`e geri
  // döndürüldü → yalnız BU kontrol kırmızı ("*" beklenen true, alınan false),
  // diğer 5 assertion yeşil kaldı — yani sonda tam da körlüğü ölçüyor.
  it("global * (satıcı hesabı) admin görünürlüğünü açar", () => {
    expect(hasAdminAccess(["*"])).toBe(true);
  });
  it("başka bir joker admin görünürlüğü AÇMAZ (fazla-açma sondası)", () => {
    expect(hasAdminAccess(["order:*"])).toBe(false);
  });
});

describe("canEnterApp", () => {
  it("en az bir izin varsa girebilir", () => {
    expect(canEnterApp(["order:read"])).toBe(true);
  });
  it("hiç izin yoksa giremez", () => {
    expect(canEnterApp([])).toBe(false);
  });
});
