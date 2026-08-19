// =============================================================================
// BİRLEŞTİRME HARİTASI KAPSAMA BEKÇİSİ (Faz B5)
// =============================================================================
// EN YÜKSEK HASAR × EN DÜŞÜK TESPİT sınıfı: `MERGE_MAP` elle yazılmış bir
// listedir. Gelecek yıl biri Customer'a işaret eden 13. FK'yı eklerse, merge o
// tabloyu SESSİZCE atlar — kaynak kayıt tombstone olur, o satırlar ölü bir
// kimliğe bakmaya devam eder ve hiçbir hata çıkmaz. Bu test o sapmayı
// mekanik olarak yakalar ve İKİ YÖNLÜ çalışır (`ROLE_COVERAGE_EXEMPT` deseni):
// bilinmeyen FK testi düşürür, ölü harita girişi de düşürür.
//
// ⚠️ TÜRETME KAYNAĞI ŞEMA METNİ, `Prisma.dmmf` DEĞİL — ölçüldü (2026-08-19):
// Prisma 7'nin runtime DMMF'i ilişki alanında yalnız
// `{name, kind, type, relationName}` taşır. `relationFromFields` YOKTUR, yani
// "Roll ile Item ilişkili" bilinir ama HANGİ KOLON üzerinden bilinmez; üstelik
// aynı kayıt ilişkinin iki yanında da görünür, yani FK'yı KİMİN taşıdığı
// ayırt edilemez. DMMF yine de KÖRLÜK ZEMİNİ olarak kullanılıyor (§4).

import { readFileSync } from "fs";
import { join } from "path";
import { Prisma } from "@prisma/client";
import { MERGE_ENTITIES, MERGE_MAP, type MergeEntity } from "../src/constants/merge-map";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const SCHEMA = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

/** Model adı → hedef model adı (PascalCase). */
const ENTITY_MODEL: Record<MergeEntity, string> = {
  customer: "Customer",
  item: "Item",
  color: "Color",
  subcontractor: "Subcontractor",
};

interface Fk {
  model: string;
  table: string;
  column: string;
  target: string;
  relationName: string | null;
}

/** `model X { ... }` bloklarını ayrıştır; her blokta @relation'ları topla. */
function parseForeignKeys(): Fk[] {
  const out: Fk[] = [];
  const modelRe = /^model\s+(\w+)\s*\{$([\s\S]*?)^\}$/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(SCHEMA)) !== null) {
    const model = m[1] as string;
    const body = m[2] as string;
    const mapMatch = /@@map\("([^"]+)"\)/.exec(body);
    const table = mapMatch?.[1] ?? model;
    // `mergedInto Customer? @relation("CustomerMergeLineage", fields: [mergedIntoId], references: [id])`
    const relRe =
      /^\s*\w+\s+(\w+)(\?|\[\])?\s+@relation\(([^)]*)\)/gm;
    let r: RegExpExecArray | null;
    while ((r = relRe.exec(body)) !== null) {
      const target = r[1] as string;
      const args = r[3] as string;
      const fieldsMatch = /fields:\s*\[([^\]]+)\]/.exec(args);
      if (!fieldsMatch) continue; // ters taraf (FK taşımıyor)
      const nameMatch = /^\s*"([^"]+)"/.exec(args);
      for (const col of (fieldsMatch[1] as string).split(",").map((c) => c.trim()).filter(Boolean)) {
        out.push({ model, table, column: col, target, relationName: nameMatch?.[1] ?? null });
      }
    }
  }
  return out;
}

const ALL_FKS = parseForeignKeys();

/**
 * Haritada BULUNMAMASI meşru olan FK'lar. Girişler gerekçelidir ve BAYATLIĞA
 * KARŞI denetlenir (§3): artık var olmayan bir muaf, gerçek bir ihlali sessizce
 * kapsam dışında tutar.
 */
const EXEMPT: Record<string, string> = {
  "Customer.mergedIntoId": "birleştirme soy bağının KENDİSİ — servis onu ayrıca yazar",
  "Item.mergedIntoId": "birleştirme soy bağının KENDİSİ",
  "Color.mergedIntoId": "birleştirme soy bağının KENDİSİ",
  "Subcontractor.mergedIntoId": "birleştirme soy bağının KENDİSİ",
};

console.log("=== Birleştirme haritası kapsama bekçisi ===\n");

// —— 1) Her FK haritada var mı ————————————————————————————————————————
console.log("── 1) Şemadaki her FK haritada kapsanıyor mu ──");
for (const entity of MERGE_ENTITIES) {
  const targetModel = ENTITY_MODEL[entity];
  const fks = ALL_FKS.filter((f) => f.target === targetModel);
  const rules = MERGE_MAP[entity];
  const missing: string[] = [];
  for (const fk of fks) {
    const key = `${fk.model}.${fk.column}`;
    if (EXEMPT[key]) continue;
    const covered = rules.some((r) => r.model === fk.model && r.column === fk.column);
    if (!covered) missing.push(key);
  }
  check(
    `${targetModel}: şemadaki ${fks.length} FK'nın hepsi haritada`,
    missing.length === 0,
    missing.length ? `KAPSANMAYAN: ${missing.join(", ")}` : `${rules.length} kural`,
  );
}

// —— 2) Ölü harita girişi var mı (ters yön) ——————————————————————————
console.log("\n── 2) Haritada şemada olmayan giriş var mı (ölü kural) ──");
for (const entity of MERGE_ENTITIES) {
  const targetModel = ENTITY_MODEL[entity];
  const fks = ALL_FKS.filter((f) => f.target === targetModel);
  const dead = MERGE_MAP[entity].filter(
    (r) => !fks.some((f) => f.model === r.model && f.column === r.column),
  );
  check(
    `${targetModel}: ölü harita girişi yok`,
    dead.length === 0,
    dead.length ? `ÖLÜ: ${dead.map((d) => `${d.model}.${d.column}`).join(", ")}` : "temiz",
  );
}

// —— 3) Muaf listesi bayat mı ——————————————————————————————————————
console.log("\n── 3) Muaf listesi bayat mı ──");
const staleExempt = Object.keys(EXEMPT).filter(
  (k) => !ALL_FKS.some((f) => `${f.model}.${f.column}` === k),
);
check("her muaf giriş şemada gerçekten var", staleExempt.length === 0, staleExempt.join(", ") || "temiz");
for (const [k, why] of Object.entries(EXEMPT)) console.log(`     muaf: ${k} — ${why}`);

// —— 4) Körlük zemini —————————————————————————————————————————————
// Ayrıştırıcı bozulursa ("model X {" yazımı değişir, dosya taşınır) "ihlal yok"
// ile "hiçbir şeye bakmadım" AYNI YEŞİLE çıkar. DMMF bağımsız bir kaynak:
// ilişki KOLONUNU bilmez ama ilişkili MODELLERİ bilir.
console.log("\n── 4) Körlük zemini ──");
check("şemadan FK ayrıştırıldı", ALL_FKS.length > 200, `${ALL_FKS.length} FK kolonu`);
const dmmfModels =
  (Prisma as unknown as { dmmf?: { datamodel?: { models?: Array<{ name: string; fields: Array<{ name: string; kind: string; type: string }> }> } } })
    .dmmf?.datamodel?.models ?? [];
check("DMMF okunabildi", dmmfModels.length > 50, `${dmmfModels.length} model`);

for (const entity of MERGE_ENTITIES) {
  const targetModel = ENTITY_MODEL[entity];
  // DMMF: bu modele ilişki alanı taşıyan modeller (iki yön de görünür)
  const dmmfRelated = new Set(
    dmmfModels
      .filter((m) => m.fields.some((f) => f.kind === "object" && f.type === targetModel))
      .map((m) => m.name),
  );
  const parsedOwners = new Set(ALL_FKS.filter((f) => f.target === targetModel).map((f) => f.model));
  // Metin ayrıştırması DMMF'in gördüğü modellerin bir ALT KÜMESİ olmalı; boş
  // küme = ayrıştırıcı hiçbir şey eşlememiş demektir.
  const orphan = [...parsedOwners].filter((m) => !dmmfRelated.has(m));
  check(
    `${targetModel}: ayrıştırma DMMF ile tutarlı`,
    parsedOwners.size > 0 && orphan.length === 0,
    `${parsedOwners.size} sahip model` + (orphan.length ? ` · DMMF'te YOK: ${orphan.join(", ")}` : ""),
  );
}

// —— 5) Harita iç tutarlılığı ——————————————————————————————————————
console.log("\n── 5) Harita iç tutarlılığı ──");
for (const entity of MERGE_ENTITIES) {
  const rules = MERGE_MAP[entity];
  const dupes = rules
    .map((r) => `${r.model}.${r.column}`)
    .filter((k, i, arr) => arr.indexOf(k) !== i);
  check(`${entity}: aynı kolon iki kez yazılmamış`, dupes.length === 0, dupes.join(", ") || "temiz");
  const badTable = rules.filter((r) => {
    const fk = ALL_FKS.find((f) => f.model === r.model && f.column === r.column);
    return fk && fk.table !== r.table;
  });
  check(
    `${entity}: tablo adları @@map ile uyuşuyor`,
    badTable.length === 0,
    badTable.map((b) => `${b.model} → ${b.table}`).join(", ") || "temiz",
  );
  const conflictsWithoutWhy = rules.filter((r) => r.kind === "CONFLICT" && !r.why.trim());
  check(`${entity}: her çakışma kuralının gerekçesi yazılı`, conflictsWithoutWhy.length === 0);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
