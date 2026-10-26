// UX-4 tutarlılık bekçisi: ekran adı · gezinme grubu · boş durum simgesi tek kaynaktan.
// P1 "Bildirim Ayarları" · P2 dar ("Diğer") ve geniş (ray) aynı grup tablosu · P3 "Finans" sekmesi / "Ön Muhasebe" başlığı ·
// P4 başlık `access.ts`ten; boş durum simgesi `EMPTY_ICON`/alan simgesinden, metin nokta ile bitmez, "siz" dili.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODULES, moduleNavTitle, moduleTitle, type ModuleKey } from "../src/lib/access";
import { EMPTY_ICON } from "../src/ui/icons";
import { MORE_GROUPS, NAV_GROUPS, RAIL_GROUPS, TABS } from "../src/ui/tabs";

const ROOT = join(__dirname, "..");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const SOURCES = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "src"))].filter((f) => /\.tsx?$/.test(f));

describe("ekran adları (P1, P3, P4)", () => {
  it("sözlük adları", () => {
    expect(moduleTitle("bildirimler")).toBe("Bildirim Ayarları");
    expect(moduleTitle("finans")).toBe("Ön Muhasebe");
    expect(moduleNavTitle("finans")).toBe("Finans");
    expect(moduleTitle("gelen-kutusu")).toBe("Gelen Kutusu");
  });
  it("sekme adı modülün gezinme adından türer", () => {
    for (const t of TABS) if (t.module) expect(t.title).toBe(moduleNavTitle(t.module));
  });
  it("modül kök ekranları başlık YAZMAZ; başlık `Screen module` üzerinden access.ts'ten gelir", () => {
    const roots: Readonly<Partial<Record<ModuleKey, string>>> = {
      uretim: "app/(app)/(tabs)/uretim.tsx",
      finans: "app/(app)/(tabs)/finans.tsx",
      sevkiyat: "app/(app)/sevkiyat.tsx",
      stok: "app/(app)/stok.tsx",
      raporlar: "app/(app)/raporlar/index.tsx",
      "gelen-kutusu": "app/(app)/gelen-kutusu/index.tsx",
      hesaplar: "app/(app)/hesaplar/index.tsx",
      bildirimler: "app/(app)/bildirimler.tsx",
      profil: "app/(app)/profil.tsx",
    };
    for (const [key, file] of Object.entries(roots)) {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src).toContain(`<Screen module="${key}"`);
      expect(src).not.toMatch(new RegExp(`<Screen title="[^"]*" module="${key}"`));
    }
  });
});

describe("gezinme grupları (P2)", () => {
  it("Diğer ve ray aynı tabloyu çizer", () => {
    expect(MORE_GROUPS).toBe(NAV_GROUPS);
    expect(RAIL_GROUPS.slice(1)).toEqual(NAV_GROUPS);
    expect(RAIL_GROUPS[0]!.modules).toEqual(TABS.flatMap((t) => (t.module ? [t.module] : [])));
  });
  it("her modül tam bir kez: sekme ya da grup", () => {
    const all = [...RAIL_GROUPS.flatMap((g) => g.modules)].sort();
    expect(all).toEqual(MODULES.map((m) => m.key).sort());
  });
  it("gruptaki her satırın alt metni var", () => {
    for (const k of NAV_GROUPS.flatMap((g) => g.modules)) expect(MODULES.find((m) => m.key === k)?.hint).toBeTruthy();
  });
});

describe("boş durumlar", () => {
  const TAG = /<(Empty|ListStates|RemoteList|SnapshotGate)\b[\s\S]*?\/>/g;
  const elements = SOURCES.flatMap((f) => [...readFileSync(f, "utf8").matchAll(TAG)].map((m) => ({ f: f.slice(ROOT.length + 1), src: m[0] })));
  it("tarayıcı gerçekten eleman buluyor (sonda)", () => {
    expect(elements.length).toBeGreaterThan(15);
  });
  it("simge çıplak ad değil: EMPTY_ICON ya da alan simgesi", () => {
    const bad = elements.filter((e) => /\b(icon|emptyIcon)="/.test(e.src)).map((e) => e.f);
    expect(bad).toEqual([]);
  });
  it("metin nokta ile bitmez ve 'siz' dilindedir", () => {
    const bad = elements.flatMap((e) => [...e.src.matchAll(/"([^"]*[a-zçğıöşü][^"]*)"/gi)].map((m) => m[1]!).filter((txt) => /\.$/.test(txt) || /\w+(ebileceğin|abileceğin)\b/.test(txt)).map((txt) => `${e.f}: ${txt}`));
    expect(bad).toEqual([]);
  });
  it("EMPTY_ICON değerleri tekil", () => {
    const v = Object.values(EMPTY_ICON);
    expect(new Set(v).size).toBe(v.length);
  });
});
