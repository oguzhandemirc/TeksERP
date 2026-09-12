// =============================================================================
// TS DOSYA TARAMASI — özyinelemeli, TEK KAYNAK
// =============================================================================
// NEDEN: AST/metin bekçileri dosyaları kendileri topluyordu ve iki farklı
// derinlik kullanıyorlardı. `test_script_guards` `readdirSync(scripts)` ile
// YALNIZ kökü tarıyordu; `scripts/lib/` altı hiçbir bölüme girmiyordu — kapının
// KENDİ dosyası bile denetim dışıydı (2026-09-12 denetimi). Tarama derinliği bir
// bekçinin kapsamını sessizce belirler; o yüzden tek yerde yaşar.
import { readdirSync } from "fs";
import { join } from "path";

/** Türetilmiş/üçüncü-parti ağaçlar: taranırsa kapsam gürültüye boğulur. */
const ATLANAN_DIZINLER = new Set(["node_modules", "migrations", "generated", "dist", "coverage"]);

/** `dir` altındaki tüm `.ts` dosyalarının MUTLAK yolları (özyinelemeli). */
export function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ATLANAN_DIZINLER.has(entry.name)) continue;
      walkTs(abs, out);
    } else if (entry.name.endsWith(".ts")) {
      out.push(abs);
    }
  }
  return out;
}
