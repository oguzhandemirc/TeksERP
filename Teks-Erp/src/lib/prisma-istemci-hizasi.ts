// Üretilmiş Prisma istemcisi ↔ `prisma/schema.prisma` hizası (boot uyarısı).
// Bayat istemci (şema değişti, `prisma generate` koşmadı) sorgu kurulurken PrismaClientValidationError
// atar; liste uçları sessizce bozulur (2026-11-07: pano "Geciken İE" kartı, `WorkOrder.customer` yok).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `prisma format` hizalaması ve yorumlar dışarıda: yalnız anlamlı satırlar kıyaslanır. */
export function normalizeSchemaText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export type PrismaClientAlignment = "hizali" | "bayat" | "olculemedi";

/** İki metin verilirse kıyaslar; biri yoksa ölçülemedi (yanlış alarm yerine sessiz değil, beyanlı). */
export function comparePrismaSchemas(generated: string | null, source: string | null): PrismaClientAlignment {
  if (generated === null || source === null) return "olculemedi";
  return normalizeSchemaText(generated) === normalizeSchemaText(source) ? "hizali" : "bayat";
}

function readIfExists(path: string | null): string | null {
  try {
    return path && existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function generatedSchemaPath(): string | null {
  try {
    return require.resolve(".prisma/client/schema.prisma");
  } catch {
    return null;
  }
}

/** İstemci modülü yüklenirken bir kez (lib/prisma): bayatsa sebebi ve çaresini söyler; durdurmaz. */
export function checkPrismaClientAlignment(log: { warn: (m: string) => void; info: (m: string) => void }): PrismaClientAlignment {
  const generated = readIfExists(generatedSchemaPath());
  // src/lib ve dist/lib ikisinden de iki üst = Teks-Erp/.
  const source = readIfExists(join(__dirname, "..", "..", "prisma", "schema.prisma"));
  const result = comparePrismaSchemas(generated, source);
  if (result === "bayat") {
    log.warn(
      "üretilmiş Prisma istemcisi prisma/schema.prisma ile HİZASIZ — sorgular 'Unknown field' ile düşer. " +
        "Çare: `npm run prisma:generate`, sonra sunucuyu yeniden başlat.",
    );
  } else if (result === "olculemedi") {
    log.info("istemci ↔ şema hizası ölçülemedi (şema ya da üretilmiş istemci dosyası bulunamadı)");
  }
  return result;
}
