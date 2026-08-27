// =============================================================================
// Bekçi: OS pencere-sürükleme bölgesi (-webkit-app-region)
// =============================================================================
// SAHA ARIZASI (2026-08-28): giriş ekranındaki uyuşmazlık modalı TAMAMEN ölüydü
// — çarpı dahil hiçbir düğme çalışmıyordu ve her tıklama maximize pencereyi
// eski boyutuna indirdiği için "modal boyut değiştiriyor" gibi görünüyordu.
//
// Sebep: `LoginPage` kökü `h-screen w-screen app-drag` idi, yani TÜM PENCERE bir
// OS sürükleme dikdörtgeniydi. Sürükleme bölgesi z-index'e değil GEOMETRİYE
// bakar: portal'lanan modal üstte çizilse de kendini bölgeden DÜŞÜRMEZ, tıklama
// DOM'a hiç ulaşmadan pencere-taşımaya gider. Hata yok, log yok.
//
// Aynı tuzak daha önce `ApiEndpointDialog`ı da ısırmış ve oraya TEK SEFERLİK
// `app-no-drag` yaması konmuştu; sonra eklenen `ServerIdentityMismatchDialog`
// o yamayı almadı. Yani "her yeni modalda hatırla" çözümü zaten bir kez
// başarısız oldu → koruma primitif düzeyine alındı ve bu bekçi iki ayağı da
// kilitler:
//   ① Portal'lanan HER katman türü global kuralda listeli olmalı.
//   ② Hiçbir yüzey pencerenin TAMAMINI sürükleme bölgesi yapmamalı.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const css = readFileSync(path.join(SRC, "index.css"), "utf8");

/** index.css'teki "portal'lanan katmanlar no-drag" bloğunun kapsadığı damgalar. */
function noDragKapsami(): Set<string> {
  const blok = css.match(/((?:\[data-[a-z-]+\][,\s]*)+)\{[^}]*app-region:\s*no-drag/g) ?? [];
  const damgalar = new Set<string>();
  for (const b of blok) {
    for (const m of b.matchAll(/\[data-([a-z-]+)\]/g)) if (m[1]) damgalar.add(m[1]);
  }
  return damgalar;
}

/** ui primitiflerinin gerçekten bastığı `data-ui-*` damgaları. */
function kullanilanDamgalar(): Set<string> {
  const dir = path.join(SRC, "components/ui");
  const damgalar = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx") && !f.includes(".test."))) {
    const src = readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/\bdata-(ui-[a-z-]+)=""/g)) if (m[1]) damgalar.add(m[1]);
  }
  return damgalar;
}

describe("sürükleme bölgesi — portal'lanan katmanlar", () => {
  it("⭐ ui primitiflerinin bastığı HER damga global no-drag kuralında var", () => {
    const kapsam = noDragKapsami();
    const eksik = [...kullanilanDamgalar()].filter((d) => !kapsam.has(d));
    // Eksik damga = o katman türü giriş ekranında ölü açılır (tıklamalar yutulur).
    expect(eksik).toEqual([]);
  });

  it("toast katmanı da kapsamda — sonner portal'lanır", () => {
    expect(noDragKapsami().has("sonner-toaster")).toBe(true);
  });
});

describe("sürükleme bölgesi — şerit, sayfa değil", () => {
  const tsxDosyalari = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
      return e.name.endsWith(".tsx") && !e.name.includes(".test.") ? [p] : [];
    });
  })(SRC);

  /** `app-drag` taşıyan her className'i (dosya, sınıflar) olarak toplar. */
  const dragTasiyanlar = tsxDosyalari.flatMap((f) => {
    const src = readFileSync(f, "utf8");
    return [...src.matchAll(/className="([^"]*\bapp-drag\b[^"]*)"/g)].map((m) => ({
      dosya: path.relative(SRC, f),
      siniflar: m[1] ?? "",
    }));
  });

  it("en az bir sürükleme şeridi var (pencere taşınabilir kalmalı)", () => {
    expect(dragTasiyanlar.length).toBeGreaterThan(0);
  });

  it("⭐ hiçbir `app-drag` elemanı pencerenin tamamını kaplamaz", () => {
    // `inset-x-0` MEŞRU (yatay tam genişlik, yükseklik sınırlı bir şerit);
    // yasak olan dikeyde de sınırsız olmak — orası portal'ların çizildiği yer.
    const tamEkran = dragTasiyanlar.filter((d) =>
      /\b(h-screen|min-h-screen|h-full|inset-0)\b/.test(d.siniflar),
    );
    expect(tamEkran).toEqual([]);
  });
});
