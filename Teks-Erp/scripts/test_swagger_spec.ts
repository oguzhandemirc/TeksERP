// =============================================================================
// Test: OpenAPI (swagger-jsdoc) bloklarının TAMAMI geçerli YAML mı? (2026-08-21)
// Çalıştır: npx tsx scripts/test_swagger_spec.ts
// =============================================================================
// NEDEN: `swagger-jsdoc` bozuk bir `@openapi` bloğunu varsayılan ayarda yalnız
// KONSOLA yazar ve atlar — uç Swagger UI'dan SESSİZCE kaybolur, hiçbir test
// kırmızı vermez. 2026-08-21'de `GET /api/work-orders/{id}/roll-attribute-targets`
// böyle kayboldu: `summary: "Toplara da uygula" için …` (tırnaklı değerin
// ardından metin → YAML hatası). Bu bekçi aynı seçenekleri `failOnErrors: true`
// ile koşar → bozuk blok = KIRMIZI, hangi dosya olduğu mesajda yazar.
//
// Körlük zemini: spec'teki yol sayısı alt sınırın altındaysa da KIRMIZI —
// glob/uzantı kayarsa "hata yok" ile "hiçbir şey taranmadı" aynı yeşile çıkmasın
// (F11 dersi: apis glob'u CWD'ye bağlıyken prod'da 0 dosya eşlenmişti).
// =============================================================================
import swaggerJSDoc from "swagger-jsdoc";
import { swaggerOptions } from "../src/config/swagger";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Bugün ~190 yol var; zemin bilerek gevşek (yeni uç ekleyen bekçiyi güncellemesin). */
const PATH_COUNT_FLOOR = 120;

type Spec = { paths?: Record<string, Record<string, unknown>> };

function main(): void {
  let spec: Spec | null = null;
  let error: string | null = null;
  try {
    spec = swaggerJSDoc({ ...swaggerOptions, failOnErrors: true }) as Spec;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check("tüm @openapi blokları geçerli YAML (failOnErrors)", error === null, (error ?? "").split("\n").slice(0, 3).join(" | "));

  const paths = spec?.paths ?? {};
  const pathCount = Object.keys(paths).length;
  check(`körlük zemini: en az ${PATH_COUNT_FLOOR} yol tarandı`, pathCount >= PATH_COUNT_FLOOR, `${pathCount} yol`);

  // Yol+metot çakışması: aynı uç iki blokta tanımlıysa swagger sonuncuyu sessizce kazandırır.
  const ops = Object.entries(paths).flatMap(([p, methods]) =>
    Object.keys(methods).filter((m) => ["get", "post", "put", "patch", "delete"].includes(m)).map((m) => `${m.toUpperCase()} ${p}`),
  );
  check("yol+metot kümesi boş değil", ops.length > 0, `${ops.length} işlem`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
