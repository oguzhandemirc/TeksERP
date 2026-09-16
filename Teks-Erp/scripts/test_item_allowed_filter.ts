// =============================================================================
// ÜRÜN LİSTESİ İLİŞKİ SÜZGECİ — `filter[allowedColorId]` / `filter[allowedPropertyId]` (ürün seçici modalı, 2026-09-17)
// =============================================================================
// NEDEN: seçici modalı "bu rengi / bu özelliği alabileceğim ürünler" diye süzer; renk ürüne kimlik olarak bağlı
// DEĞİL, `ItemAllowedColor` yalnız izinli liste ve BOŞ liste = her renk serbest. Yani doğru yüklem
// `none OR some{colorId}`; yalnız `some` yazılsa listesiz ürünler (çoğunluk) kaybolurdu. Süzme SUNUCUDA,
// offset ve cursor aynı where'den (`buildListWhere` tek nokta). Anahtar `safeFilters`ten (kolon değil)
// düşer, `extraWhere` ham filters'tan `readIdCondition` ile okur — CSV de string'dir.
// §1 renk: listesiz + X'li gelir, Y'li gelmez; CSV X,Y ikisini de alır · §2 özellik aynı kalıp · §3 ikisi AND ·
// §4 süzgeç yokken üçü de gelir (bayt bayt) · §5 cursor yolu da süzer · §6 bilinmeyen uuid → yalnız listesizler.
// NEGATİF SONDALAR (ölçüldü): OR'dan `none` kolu düşer → §1a/§1b/§1c/§3a/§5a/§6a/§6b ❌ (7) · `readIdCondition`
//   yerine ham string → §1c'de CSV uuid kolonuna gider, koşum P2007 ile düşer (çıkış 1).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; fikstür `TEST-IAF-<pid>`, `finally` temizler.
// =============================================================================
import type { Request } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ItemService } from "../src/services/item.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-IAF-${process.pid}`;
const YOK = "00000000-0000-4000-8000-000000000000";
// Route config'iyle birebir (item.routes.ts).
const service = new ItemService({
  modelName: "item",
  tableName: "ITEM",
  searchFields: ["name"],
  codeSearchFields: ["code"],
  defaultInclude: { allowedColors: { include: { color: true } }, allowedProperties: { include: { property: true } } },
  duplicateNameField: "name",
  entityLabel: "ürün",
});
const req = (query: Record<string, string>): Request => ({ query: { search: TAG, ...query } }) as unknown as Request;
type Res = { data: Array<{ id: string }> };
const ids = async (query: Record<string, string>) => new Set(((await service.findAll(req(query))) as Res).data.map((r) => r.id));
const same = (a: Set<string>, ...want: string[]) => a.size === want.length && want.every((w) => a.has(w));

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== ÜRÜN İLİŞKİ SÜZGECİ BEKÇİSİ (allowedColorId / allowedPropertyId) ===\n");
  const cx = await prisma.color.create({ data: { code: `${TAG}-X`, name: `${TAG} renk X` }, select: { id: true } });
  const cy = await prisma.color.create({ data: { code: `${TAG}-Y`, name: `${TAG} renk Y` }, select: { id: true } });
  const px = await prisma.fabricProperty.create({ data: { code: `${TAG}-PX`, name: `${TAG} özellik X` }, select: { id: true } });
  const py = await prisma.fabricProperty.create({ data: { code: `${TAG}-PY`, name: `${TAG} özellik Y` }, select: { id: true } });
  const mk = (suffix: string, colorId?: string, propertyId?: string) =>
    prisma.item.create({
      data: {
        code: `${TAG}-${suffix}`, name: `${TAG} kumaş ${suffix}`, itemType: "FABRIC",
        ...(colorId ? { allowedColors: { create: { colorId } } } : {}),
        ...(propertyId ? { allowedProperties: { create: { propertyId } } } : {}),
      },
      select: { id: true },
    });
  const free = await mk("SERBEST");
  const withX = await mk("X", cx.id, px.id);
  const withY = await mk("Y", cy.id, py.id);
  const all = [free.id, withX.id, withY.id];
  try {
    console.log("── §1 Renk ──");
    check("§1a ⭐ allowedColorId=X → listesiz + X'li (Y'li YOK)", same(await ids({ "filter[allowedColorId]": cx.id }), free.id, withX.id));
    check("§1b allowedColorId=Y → listesiz + Y'li", same(await ids({ "filter[allowedColorId]": cy.id }), free.id, withY.id));
    check("§1c CSV X,Y → üçü de (readIdCondition → in)", same(await ids({ "filter[allowedColorId]": `${cx.id},${cy.id}` }), ...all));
    console.log("── §2 Özellik ──");
    check("§2a ⭐ allowedPropertyId=PX → listesiz + X'li", same(await ids({ "filter[allowedPropertyId]": px.id }), free.id, withX.id));
    console.log("── §3 İkisi birlikte AND ──");
    check("§3a renk X + özellik PY → yalnız listesiz (X'li özelliğe, Y'li renge takılır)", same(await ids({ "filter[allowedColorId]": cx.id, "filter[allowedPropertyId]": py.id }), free.id));
    console.log("── §4 Süzgeç yok ──");
    check("§4a anahtar yok → üçü de; boş değer → süzgeç yok (bayt bayt)", same(await ids({}), ...all) && same(await ids({ "filter[allowedColorId]": "" }), ...all));
    console.log("── §5 Cursor yolu ──");
    const cur = (await service.findAll(req({ mode: "cursor", limit: "50", "filter[allowedColorId]": cx.id }))) as Res;
    check("§5a ⭐ cursor modu aynı where'i görür → listesiz + X'li", same(new Set(cur.data.map((r) => r.id)), free.id, withX.id));
    console.log("── §6 Bilinmeyen kimlik ──");
    check("§6a bilinmeyen renk uuid → yalnız listesizler (hata değil)", same(await ids({ "filter[allowedColorId]": YOK }), free.id));
    check("§6b itemType süzgeciyle birlikte çalışır (FABRIC + X → listesiz + X'li; YARN + X → boş)", same(await ids({ "filter[itemType]": "FABRIC", "filter[allowedColorId]": cx.id }), free.id, withX.id) && (await ids({ "filter[itemType]": "YARN", "filter[allowedColorId]": cx.id })).size === 0);
  } finally {
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: all } } });
    await prisma.itemAllowedProperty.deleteMany({ where: { itemId: { in: all } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: all } } });
    await prisma.item.deleteMany({ where: { id: { in: all } } });
    await prisma.color.deleteMany({ where: { id: { in: [cx.id, cy.id] } } });
    await prisma.fabricProperty.deleteMany({ where: { id: { in: [px.id, py.id] } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
