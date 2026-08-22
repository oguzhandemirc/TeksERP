import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SERVİS YOLU `/api` ÖNEKİ — mekanik bekçi.
 *
 * `apiClient`'ın `baseURL`'i `http://<sunucu>:4000`'dir; **`/api` İÇERMEZ**.
 * Yani her çağrı yolunu TAM yazmak zorundadır (`/api/...`). Öneki unutmak
 * derlemede de testte de görünmez; backend 404 döner ve ekrana göre ya
 * "Sonuç yok" diye yutulur ya da jenerik bir hataya düşer.
 *
 * ⚠️ Bu SOYUT bir risk değil: `d0575389` (2026-08-10) ile gelen offsite yedek
 * kartının BEŞ çağrısı da öneksizdi ve ekran **on iki gün** boyunca açılışta
 * hata verdi (2026-08-22'de bulundu). Kural CLAUDE.md'de yazılıydı ama
 * ölçen bir şey yoktu — yazılı kural, ölçülmeyen kuraldır.
 *
 * Muaf: backend'de gerçekten KÖKTE mount edilmiş yollar (`/health`). Muaf
 * listesi bayatlığa karşı da denetlenir — artık kullanılmayan bir muaf,
 * gerçek bir ihlali sessizce kapsam dışında tutar.
 */

/** Backend'de `/api` ALTINDA OLMAYAN yollar — gerekçesiyle. */
const ROOT_MOUNTED: Record<string, string> = {
  "/health": "app.ts kökte mount eder (sunucu erişilebilirlik yoklaması)",
};

const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = resolve(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

interface Call {
  file: string;
  line: number;
  path: string;
}

/** `apiClient.get("/x")` / `.post<T>(`/x`)` … → çağrılan yol. */
function collectCalls(): Call[] {
  const re = /apiClient\.(?:get|post|patch|put|delete)(?:<[^>]*>)?\(\s*["`](\/[^"`]*)/g;
  const calls: Call[] = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) {
      const line = src.slice(0, m.index).split("\n").length;
      calls.push({ file: file.replace(SRC + "/", ""), line, path: m[1]! });
    }
  }
  return calls;
}

describe("apiClient yolları", () => {
  const calls = collectCalls();

  it("körlük zemini — tarayıcı gerçekten çağrı buluyor", () => {
    // Dizin düzeni değişir / regex kayarsa "ihlal yok" ile "hiçbir şeye
    // bakılmadı" aynı yeşile çıkar. Zemin bunu ayırır. Bugün 35 düz-metin
    // çağrı var; zemin 25'te, yani tarayıcı çökerse düşer ama normal
    // temizlikler kırmızıya döndürmez.
    //
    // ⚠️ Kapsam: yalnız yolu DÜZ METİN başlayan çağrılar. Yol tamamen bir
    // değişkenden geliyorsa statik olarak görülemez — yeni bir servis
    // yazarken yolu sabitle, değişkeni sonuna ekle (`\`/api/x/${id}\`` gibi).
    expect(calls.length).toBeGreaterThan(25);
  });

  it("her çağrı `/api` ile başlar (kökte mount edilenler hariç)", () => {
    const bad = calls.filter(
      (c) => !c.path.startsWith("/api/") && !(c.path in ROOT_MOUNTED),
    );
    expect(
      bad.map((c) => `${c.file}:${c.line} → ${c.path}`),
      "öneksiz yol backend'de 404 alır ve sessizce yutulur",
    ).toEqual([]);
  });

  it("muaf listesi bayat değil — her muaf hâlâ kullanılıyor", () => {
    const used = new Set(calls.map((c) => c.path));
    const stale = Object.keys(ROOT_MOUNTED).filter((p) => !used.has(p));
    expect(stale, "kullanılmayan muaf gerçek bir ihlali gizleyebilir").toEqual([]);
  });
});
