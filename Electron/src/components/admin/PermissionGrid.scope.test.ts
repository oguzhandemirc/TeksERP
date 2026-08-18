import { describe, it, expect } from "vitest";
import { scopeOf, splitScopeStats } from "./permission-scope";

// =============================================================================
// Yetki ekranı MOBİL/MASAÜSTÜ sekmesi (2026-08-19)
// =============================================================================
// Saha isteği: "çok fazla yetki var, karışıyor." Ayrım yeni veri değil —
// `Permission.category` zaten mobile|web|admin taşıyor.
//
// ⚠️ SEKME BİR KISIT DEĞİL, GÖRÜNÜM: aynı kullanıcı iki sekmeden de yetki
// alabilir (saha personelinin bir kısmı kilit rolde ve masaüstü yetkisi de
// taşıyor — kullanıcı kararı). Bu yüzden testler "seçim korunuyor mu"yu da
// ölçer, yalnız süzmeyi değil.
// =============================================================================

const p = (id: string, category: string) =>
  ({ id, code: id, category, module: "X", description: null }) as never;

describe("yetki kapsamı (sekme)", () => {
  it("mobile → mobil sekmesi", () => {
    expect(scopeOf(p("a", "mobile"))).toBe("mobile");
  });

  it("web → masaüstü sekmesi", () => {
    expect(scopeOf(p("a", "web"))).toBe("desktop");
  });

  it("admin da MASAÜSTÜ sayılır — yönetim ekranları tablette açılmaz", () => {
    // Kolay kaçan durum: üçüncü kategori sessizce hiçbir sekmeye düşmezse
    // o yetkiler ekranda KAYBOLUR ve kimse fark etmez.
    expect(scopeOf(p("a", "admin"))).toBe("desktop");
  });

  it("bilinmeyen kategori masaüstüne düşer (yetki asla kaybolmaz)", () => {
    expect(scopeOf(p("a", "yeni-kategori"))).toBe("desktop");
  });
});

describe("sekme sayaçları", () => {
  const perms = [
    p("m1", "mobile"),
    p("m2", "mobile"),
    p("w1", "web"),
    p("a1", "admin"),
  ];

  it("her sekmenin toplamı ve seçili sayısı ayrı hesaplanır", () => {
    const st = splitScopeStats(perms, ["m1", "w1"], () => true);
    expect(st.mobile.total).toBe(2);
    expect(st.desktop.total).toBe(2);
    expect(st.mobile.selected).toBe(1);
    expect(st.desktop.selected).toBe(1);
  });

  it("arama isabetleri sekme başına sayılır — 'diğer sekmede N sonuç' ipucu bundan doğar", () => {
    // Sekme + arama klasik tuzağı: aranan yetki diğer sekmedeyse ekran "sonuç
    // yok" der ve kullanıcı yetkinin var olmadığını sanır.
    const st = splitScopeStats(perms, [], (x) => x.id.startsWith("w"));
    expect(st.mobile.hits).toBe(0);
    expect(st.desktop.hits).toBe(1);
  });

  it("seçim sekmeye bağlı DEĞİL — iki taraftaki seçili sayısı birlikte durur", () => {
    const st = splitScopeStats(perms, ["m1", "m2", "w1", "a1"], () => true);
    expect(st.mobile.selected + st.desktop.selected).toBe(4);
  });
});
