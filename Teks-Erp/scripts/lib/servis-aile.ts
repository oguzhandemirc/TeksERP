// =============================================================================
// BÖLÜNMÜŞ SERVİS AİLESİ — tarayıcıların TEK aile tanımı (bekçi altyapısı, test DEĞİL)
// =============================================================================
// Büyük servisler 2026-11-08'de (S1–S7) cephe `<ad>.service.ts` + yanındaki `<ad>/` dizinine bölündü.
// Bölmeden önce aile TEK DOSYAYDI; dosya-içi bir ilişkiyi ölçen tarayıcı (rejim kapısı derinliği,
// damgalı defter süzgeç izlemesi, modül sınırı ölçümü) aileyi tek düğüm sayar. Tanım burada tek:
// iki tarayıcı ayrı tanım taşıyınca biri genişler, öteki sessizce eski kapsamda kalır.
// Cephesiz dizin (`helpers/`, `reports/`…) aile DEĞİLDİR — o dosyalar hiçbir zaman tek dosya olmadı.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";

function dizinMi(p: string): boolean {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

/**
 * Dosyanın ait olduğu ailenin cephesi (mutlak yol) ya da `null`. `kok` taramanın kökü (genelde `src`);
 * yukarı yürüyüş onun dışına çıkmaz. Ad öneki aile sayılmaz (`famA-ek/` ≠ `famA.service.ts`).
 */
export function aileCephesi(dosya: string, kok: string): string | null {
  if (dosya.endsWith(".service.ts") && dizinMi(dosya.slice(0, -".service.ts".length))) return dosya;
  let bulunan: string | null = null;
  const k = path.resolve(kok);
  // En DIŞ ata kazanır: `<ad>/` altındaki bir alt dizin kendi başına yeni aile açmaz.
  for (let d = path.dirname(dosya); d.startsWith(k + path.sep); d = path.dirname(d)) {
    if (fs.existsSync(`${d}.service.ts`)) bulunan = `${d}.service.ts`;
  }
  return bulunan;
}

/** Ailenin bütün üyeleri (cephe + `<ad>/**` altındaki `.ts`; alt router hariç), sıralı. */
export function aileUyeleri(cephe: string): string[] {
  const cikti = [cephe];
  const yuru = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const tam = path.join(dir, e.name);
      if (e.isDirectory()) yuru(tam);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".routes.ts")) cikti.push(tam);
    }
  };
  yuru(cephe.slice(0, -".service.ts".length));
  return cikti.sort();
}
