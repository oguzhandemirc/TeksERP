// =============================================================================
// BEKÇİ — üretilmiş Prisma istemcisi ↔ prisma/schema.prisma hizası (boot uyarısı)
// =============================================================================
// Ölçülmüş arıza (2026-11-07): `prisma generate` koşmamış ağaçta açılan sunucu, #588'in
// getirdiği `WorkOrder.customer` ilişkisini tanımadı; her `/api/work-orders` listesi 400
// "Geçersiz veri yapısı" döndü, pano "Geciken İE" kartı "Veri alınamadı" dedi ve teşhis
// panelin `filter[status]` CSV'sine yöneldi. Boot karşılaştırması bu durumu adıyla söyler.
// DB'siz: yalnız dosya metinleri kıyaslanır.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { comparePrismaSchemas, checkPrismaClientAlignment, normalizeSchemaText } from "../src/lib/prisma-istemci-hizasi";

let gecti = 0;
let kaldi = 0;
function check(label: string, ok: boolean, ek = ""): void {
  if (ok) gecti++;
  else kaldi++;
  console.log(`${ok ? "✅" : "❌"} ${label}${ek ? ` — ${ek}` : ""}`);
}

const KAYNAK = `// yorum
model WorkOrder {
  id         String    @id @db.Uuid
  customerId String?   @db.Uuid
  customer   Customer? @relation(fields: [customerId], references: [id])
}
`;
// `prisma generate` kopyası hizalamayı yeniden yazar, yorumları korur/atar — anlam aynı.
const BICIMLENMIS = `model WorkOrder {
  id String @id @db.Uuid
  customerId    String?   @db.Uuid   // açıklama
  customer Customer? @relation(fields: [customerId], references: [id])
}`;
const BAYAT = `model WorkOrder {
  id String @id @db.Uuid
}`;

function main(): void {
  console.log("=== Prisma istemci ↔ şema hizası ===\n");

  check("§1 biçim/yorum farkı hizalı sayılır", comparePrismaSchemas(BICIMLENMIS, KAYNAK) === "hizali");
  check("§2 eksik alan bayat sayılır", comparePrismaSchemas(BAYAT, KAYNAK) === "bayat");
  check("§3 dosya yoksa ölçülemedi (hizalı DEĞİL)", comparePrismaSchemas(null, KAYNAK) === "olculemedi");
  check("§4 normalizasyon alan satırını korur", normalizeSchemaText(KAYNAK).includes("customer Customer?"));

  // §5 bu ağacın gerçek dosyaları: CI ve doğru kurulmuş ağaç `generate` koşmuştur.
  const uyarilar: string[] = [];
  const sonuc = checkPrismaClientAlignment({ warn: (m) => uyarilar.push(m), info: () => {} });
  check("§5 bu ağacın istemcisi şemayla hizalı", sonuc === "hizali", `sonuç=${sonuc}`);

  // §6 bayat istemci gerçekten UYARI üretir (gerçek şema metni + bir modeli eksik kopya).
  const gercek = readFileSync(join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const eksik = gercek.replace(/^\s*customer\s+Customer\?\s+@relation\("WorkOrderCustomer".*$/m, "");
  check("§6a sonda kopyası gerçekten bir satır eksik", eksik !== gercek);
  check("§6b gerçek şemada eksik ilişki bayat sayılır", comparePrismaSchemas(eksik, gercek) === "bayat");
  check("§6c hizalı ağaçta uyarı basılmadı", uyarilar.length === 0, uyarilar[0] ?? "");

  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
  process.exitCode = kaldi > 0 ? 1 : 0;
}

main();
