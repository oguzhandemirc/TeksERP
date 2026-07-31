// =============================================================================
// Test: hardDelete guard kapsama bekçisi (A5 — 2026-07-31 veri bütünlüğü denetimi)
// Çalıştır: npx tsx scripts/test_hard_delete_guard_coverage.ts
//
// NEDEN: /:id/permanent guard'ları "bu modele point eden FK'ler" listesini ELLE
// tutar. Restrict FK'ler P2003 ile kendini korur; ama SetNull (Prisma'da opsiyonel
// ilişkinin SESSİZ varsayılanı!) ve Cascade bağlar guard'a yazılmazsa iz sessizce
// kaybolur — üç kez tekrarlanmış sistemik boşluk (Item/Customer/Device, rapor A5).
//
// NE YAPAR: schema.prisma'yı parse eder, izlenen modellere gelen EFEKTİF
// SetNull/Cascade ilişkileri çıkarır ve aşağıdaki allowlist ile karşılaştırır.
// Yeni bir SetNull/Cascade ilişki eklendiğinde bu test DÜŞER — geliştirici ya
// guard'a sayım ekler ya da bilinçli-cascade olarak buraya yazar (test_db_invariants
// deseninin kardeşi). Şema tek kaynak; DB'ye bağlanmaz.
// =============================================================================
import fs from "fs";
import path from "path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

/** İzlenen modeller = kalıcı silme guard'ı elle FK sayan servisler. */
const WATCHED = new Set(["Item", "Customer", "Device"]);

/** Beklenen envanter: "Hedef <- Kaynak.alan : Aksiyon" → gerekçe.
 *  guarded  = ilgili hardDelete sayımı blokluyor
 *  cascade-intended = bilinçli birlikte-ölüm (alias/pivot; parent'sız anlamsız) */
const EXPECTED: Record<string, string> = {
  "Customer <- CustomerBranch.customer : Cascade": "guarded (branchCount) — sayım 0 değilse silme zaten bloklanır",
  "Customer <- CustomerColorAlias.customer : Cascade": "cascade-intended — alias müşterisiz anlamsız",
  "Customer <- CustomerItemAlias.customer : Cascade": "cascade-intended — alias müşterisiz anlamsız",
  "Customer <- CustomerStandaloneLabel.customer : Cascade": "cascade-intended — müşteri etiket konfigürasyonu",
  "Customer <- CustomerTemplateRoute.customer : Cascade": "cascade-intended — müşteri şablon yönlendirmesi",
  "Customer <- Route.customer : SetNull": "guarded (routeCount, A5 2026-07-31)",
  "Customer <- Sack.customer : SetNull": "guarded (sackCount, 2026-07-15)",
  "Device <- DevicePeripheral.device : Cascade": "guarded (pivotCount, A5 2026-07-31)",
  "Device <- PeripheralDevice.device : SetNull": "guarded (peripheralCount, A5 2026-07-31)",
  "Item <- CustomerItemAlias.item : Cascade": "cascade-intended — alias ürünsüz anlamsız",
  "Item <- ItemAllowedColor.item : Cascade": "cascade-intended — izin pivotu (pivot replace istisnası)",
  "Item <- ItemAllowedProperty.item : Cascade": "cascade-intended — izin pivotu",
  "Item <- WorkOrder.targetItem : SetNull": "guarded (woCount, A5 2026-07-31)",
};

function scanSchema(): string[] {
  const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(schema))) {
    const source = m[1];
    for (const line of m[2].split("\n")) {
      // Yalnız FK-sahibi taraf (fields: [...] içeren @relation) — ters taraf listelenmez.
      const rel = line.match(/^\s*(\w+)\s+(\w+)(\?)?\s+.*@relation\([^)]*fields:\s*\[/);
      if (!rel) continue;
      const [, field, type, opt] = rel;
      if (!WATCHED.has(type)) continue;
      const onDelete = line.match(/onDelete:\s*(\w+)/)?.[1];
      // Prisma efektif varsayılanı: opsiyonel ilişki → SetNull, zorunlu → Restrict.
      const effective = onDelete ?? (opt ? "SetNull" : "Restrict");
      if (effective === "SetNull" || effective === "Cascade") {
        found.push(`${type} <- ${source}.${field} : ${effective}`);
      }
    }
  }
  return found.sort();
}

function main() {
  const found = scanSchema();
  check("şema tarandı, izlenen modellere gelen SetNull/Cascade bulundu", found.length > 0);

  const expectedKeys = Object.keys(EXPECTED).sort();
  const missing = expectedKeys.filter((k) => !found.includes(k));
  const unexpected = found.filter((k) => !EXPECTED[k]);

  check(
    "beklenen envanterin tamamı şemada duruyor (bayat satır yok)",
    missing.length === 0,
    missing.length ? `şemadan kaybolmuş: ${missing.join(" | ")}` : "",
  );
  check(
    "şemada ALLOWLIST-DIŞI SetNull/Cascade yok (yeni delik yok)",
    unexpected.length === 0,
    unexpected.length
      ? `karar bekleyen yeni ilişki: ${unexpected.join(" | ")} → ya guard'a sayım ekle ya EXPECTED'e gerekçeyle yaz`
      : "",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
