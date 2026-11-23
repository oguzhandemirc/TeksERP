// Bekçi: kullanıcıya görünen metinde terim "filtre"dir; "süzgeç" panelde yalnız kod yorumunda kalabilir
// (kullanıcı kararı 2026-11-23). Test dosyaları ve yorum satırları taranmaz.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "test" ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

export function eskiTerimSatirlari(src: string): string[] {
  return src.split("\n").filter((l) => {
    if (COMMENT_LINE.test(l)) return false;
    const code = l.replace(/\s\/\/\s.*$/, "");
    return /süzge|SÜZGE/i.test(code);
  });
}

describe("terim: süzgeç → filtre", () => {
  it("kaynakta kullanıcıya görünen 'süzgeç' kalmaz", () => {
    const bad = files(ROOT).flatMap((f) =>
      eskiTerimSatirlari(readFileSync(f, "utf-8")).map((l) => `${relative(ROOT, f)}: ${l.trim().slice(0, 100)}`),
    );
    expect(bad).toEqual([]);
  });

  it("sonda: metin içindeki eski terim yakalanır, yorum yakalanmaz", () => {
    expect(eskiTerimSatirlari('const t = "Süzgece uyan kayıt yok";')).toHaveLength(1);
    expect(eskiTerimSatirlari("  <span>SÜZGEÇ</span>")).toHaveLength(1);
    expect(eskiTerimSatirlari("// süzgeç sunucuda")).toHaveLength(0);
    expect(eskiTerimSatirlari("const a = 1; // süzgeç notu")).toHaveLength(0);
  });
});
