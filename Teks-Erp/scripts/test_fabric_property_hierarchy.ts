// =============================================================================
// KUMAŞ ÖZELLİĞİ HİYERARŞİ LİSTESİ — `GET /fabric-properties?sortBy=hierarchy` (K21, gk-s9)
// =============================================================================
// NEDEN: panel listesi düzdü; çeşit (Kurşunlu → KURŞUN GRAMAJI) bağı yalnız formda görünüyordu.
// Liste cursor'lı → sıra ve bağlam SUNUCUDA (filtre-liste.md): çeşit ebeveyninin HEMEN altında,
// çeşit eşleşince ebeveyni bağlam (`listContext`), ebeveyn eşleşince çeşidi (süzgeci geçiyorsa) altında.
// §1 saf sıra · §2 aramasız sıra + include · §3 çeşit eşleşir → ebeveyn bağlam · §4 ebeveyn eşleşir →
// çeşit altında · §5 süzgeç: pasif ebeveyn bağlam, süzgeci geçmeyen çeşit gelmez · §6 cursor sayfaları ∪ =
// ağaç, totalEstimate · §7 offset modu · §8 başka sortBy BaseService yolu (alan yok).
// NEGATİF SONDALAR (ölçüldü 2026-11-03): `orderHierarchy` çeşidi köklerle sıralayınca §1b/§1c/§2a/§3a/§4a/
//   §5a/§6a/§7a ❌ (8) · bağlam ebeveyni sorgusu (`parentIds` kolu) kaldırılınca §3a/§5a ❌ (2).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; fikstür `TEST-FPH-<pid>`, `finally` temizler.
// =============================================================================
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { fabricPropertyService } from "../src/routes/fabric-property.routes";
import { orderHierarchy } from "../src/services/helpers/fabric-property-hierarchy.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-FPH-${process.pid}`;
type Row = {
  id: string; name: string; listLevel?: number; listContext?: boolean;
  variantOf?: { name: string } | null; variant?: { name: string } | null;
};
type Res = { data: Row[]; pagination: { nextCursor?: string | null; totalEstimate?: number; total?: number } };
const req = (query: Record<string, string>): Request => ({ query: { sortBy: "hierarchy", ...query } }) as unknown as Request;
const list = async (query: Record<string, string>) => (await fabricPropertyService.findAll(req(query))) as Res;
/** Ortamdaki başka özellikler sayılmaz: yalnız bu koşumun satırları, sunucu sırasıyla. */
const mine = (r: Res) => r.data.filter((x) => x.name.startsWith(TAG));
const shape = (rows: Row[]) => rows.map((r) => `${r.name.slice(TAG.length + 1)}:${r.listLevel}${r.listContext ? "*" : ""}`).join(" | ");

function pure(): void {
  console.log("── §1 Saf sıra ──");
  const n = (id: string, sortOrder: number, parent: string | null = null) => ({ id, name: id, sortOrder, variantOfPropertyId: parent });
  const out = orderHierarchy([n("V", 99, "P"), n("B", 5), n("P", 10), n("A", 1)], new Set(["P"]));
  check("§1a ⭐ çeşit ebeveyninin HEMEN altında (sortOrder'ı 99 olsa da)", out.map((r) => r.id).join(",") === "A,B,P,V", out.map((r) => r.id).join(","));
  check("§1b seviye + bağlam işareti", out.map((r) => `${r.listLevel}${r.listContext ? "*" : ""}`).join(",") === "0,0,0*,1");
  const desc = orderHierarchy([n("V", 99, "P"), n("B", 5), n("P", 10)], new Set(), "desc");
  check("§1c desc yönü kökleri ters çevirir, çeşit yine ebeveynin altında", desc.map((r) => r.id).join(",") === "P,V,B");
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== KUMAŞ ÖZELLİĞİ HİYERARŞİ LİSTESİ BEKÇİSİ ===\n");
  pure();
  const mk = (suffix: string, name: string, sortOrder: number, extra: Record<string, unknown> = {}) =>
    prisma.fabricProperty.create({ data: { code: `${TAG}-${suffix}`, name: `${TAG} ${name}`, sortOrder, ...extra }, select: { id: true } });
  const created: string[] = [];
  try {
    const p4 = await mk("P4", "Bağımsız seçim", 1, { valueType: "CHOICE" });
    const p2 = await mk("P2", "Yanmaz", 5);
    const p1 = await mk("P1", "Kurşunlu", 10);
    const p3 = await mk("P3", "Pasif ebeveyn", 20, { isActive: false });
    created.push(p4.id, p2.id, p1.id, p3.id);
    const v1 = await mk("V1", "Kurşun gramajı", 99, { valueType: "CHOICE", variantOfPropertyId: p1.id });
    const v3 = await mk("V3", "Aktif çeşit", 0, { valueType: "CHOICE", variantOfPropertyId: p3.id });
    created.push(v1.id, v3.id);

    console.log("── §2 Aramasız ──");
    const all = await list({ mode: "cursor", limit: "200" });
    const want2 = "Bağımsız seçim:0 | Yanmaz:0 | Kurşunlu:0 | Kurşun gramajı:1 | Pasif ebeveyn:0 | Aktif çeşit:1";
    check("§2a ⭐ ebeveyn sırası → çeşidi hemen altında", shape(mine(all)) === want2, shape(mine(all)));
    const row = (r: Res, id: string) => r.data.find((x) => x.id === id);
    check("§2b çeşit satırı ebeveyn adını taşır (variantOf)", row(all, v1.id)?.variantOf?.name === `${TAG} Kurşunlu`);
    check("§2c ebeveyn satırı çeşidini taşır (variant)", row(all, p1.id)?.variant?.name === `${TAG} Kurşun gramajı`);

    console.log("── §3 Çeşit eşleşir ──");
    const s3 = mine(await list({ mode: "cursor", search: "Kurşun gramajı" }));
    check("§3a ⭐ ebeveyn BAĞLAM (soluk) + çeşit altında", shape(s3) === "Kurşunlu:0* | Kurşun gramajı:1", shape(s3));

    console.log("── §4 Ebeveyn eşleşir ──");
    const s4 = mine(await list({ mode: "cursor", search: "Kurşunlu" }));
    check("§4a ⭐ çeşit (aramaya uymasa da) ebeveynin altında, bağlam değil", shape(s4) === "Kurşunlu:0 | Kurşun gramajı:1", shape(s4));

    console.log("── §5 Süzgeç ──");
    const s5 = mine(await list({ mode: "cursor", "filter[isActive]": "true", search: TAG }));
    check("§5a ⭐ pasif ebeveyn aktif çeşidin bağlamı olarak gelir", shape(s5).endsWith("Pasif ebeveyn:0* | Aktif çeşit:1"), shape(s5));
    const s5b = mine(await list({ mode: "cursor", "filter[isActive]": "false", search: TAG }));
    check("§5b süzgeci geçmeyen çeşit eşleşen ebeveynin altına girmez", shape(s5b) === "Pasif ebeveyn:0", shape(s5b));

    console.log("── §6 Cursor sayfaları ──");
    const pages: Row[] = [];
    let cursor: string | null | undefined = null;
    let first: Res | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await list({ cursor: cursor ?? "", limit: "2", search: TAG, ...(i === 0 ? { withTotal: "true" } : {}) });
      first ??= r;
      pages.push(...r.data);
      cursor = r.pagination.nextCursor;
      if (!cursor) break;
    }
    check("§6a ⭐ sayfalar ∪ = tek istekteki ağaç (kopuksuz, mükerrersiz)", shape(mine({ data: pages } as Res)) === want2, shape(mine({ data: pages } as Res)));
    check("§6b totalEstimate = ağaç satır sayısı", first?.pagination.totalEstimate === pages.length, `${first?.pagination.totalEstimate} / ${pages.length}`);

    console.log("── §7 Offset modu ──");
    const off = await list({ page: "1", pageSize: "100", search: TAG });
    check("§7a offset modu aynı sırayı + total verir", shape(mine(off)) === want2 && off.pagination.total === off.data.length);

    console.log("── §8 Başka sortBy ──");
    const flat = (await fabricPropertyService.findAll({ query: { sortBy: "sortOrder", sortOrder: "asc", mode: "cursor", search: TAG } } as unknown as Request)) as Res;
    check("§8a düz sıralama BaseService yolu: seviye alanı yok, çeşit sortOrder'ına göre", mine(flat).every((r) => r.listLevel === undefined) && mine(flat).at(-1)?.id === v1.id);
  } finally {
    const variants = created.slice(4);
    if (variants.length) await prisma.fabricProperty.deleteMany({ where: { id: { in: variants } } });
    await prisma.fabricProperty.deleteMany({ where: { id: { in: created } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
