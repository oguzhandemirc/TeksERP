// =============================================================================
// TEST: KUMAŞA ÖZEL MÜŞTERİ RENK ADI — uç sözleşmesi (C/D hata tablosu, yarış)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_customer_item_color_alias
// =============================================================================
// Sözleşme: docs/design/MUSTERI-KUMAS-RENK-ADI.md §12.2–§12.3. Controller +
// servis sunucusuz koşulur (HTTP yok); hata `next(err)`e düşer ve AppError'ın
// `statusCode` + `details.code`u ölçülür (istemci `details.code` okur).
//
// Ölçülen: yol parametresi UUID kapısı · Zod gövdesi · normalize sonrası boş ·
// üç yazma kapısı (müşteri · kumaş DEFINITION · renk) kardeşle aynı sırada ·
// upsert idempotent + BÜYÜK harf · audit satırı · atomik silme + P2025→404 ·
// iki liste ucu (sıralama, pasif kumaş LİSTELENİR) · eşzamanlı ilk PUT'ta 500 YOK.
//
// NEGATİF SONDALAR (ölçüldü, md5 ile geri alındı):
//   ② silmedeki P2025 yakalaması kaldırılır     → 1 kırmızı (Prisma hatası, kodsuz)
//   ③ `assertItemUsable` kapısı kaldırılır      → 4 kırmızı (NOT_FOUND/PHASE_OUT/INACTIVE/MERGED)
//   ① SESSİZ (kapı kör değil, tehlike üretilmiyor): upsert'teki P2002 yakalaması
//      kaldırılınca §4 yine yeşil — 5 tur × 3 eşzamanlı ilk PUT'un hepsi 200 aldı,
//      yani upsert bugün tek ifadede (ON CONFLICT) koşuyor ve yarış P2002 doğurmuyor.
//      Yakalama savunmadır; §4 sözleşmenin sonucunu ("500 ASLA") ölçer.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { ItemLifecycleStatus, ItemType } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { CustomerAliasController } from "../src/controllers/customer-alias.controller";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const P = `TEST-CICA-${Date.now().toString().slice(-7)}`;
const ctl = new CustomerAliasController();
const id: Record<string, string> = {};

type Sonuc = { status: number; body: unknown; err: unknown };

async function cagir(
  h: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  params: Record<string, string>,
  body?: unknown,
): Promise<Sonuc> {
  const out: Sonuc = { status: 0, body: null, err: null };
  const res = {
    status: (s: number) => { out.status = s; return res; },
    json: (b: unknown) => { out.body = b; return res; },
  } as unknown as Response;
  const req = { params, body, user: { userId: undefined, permissions: ["*"] } } as unknown as Request;
  await h(req, res, (e?: unknown) => { out.err = e ?? null; });
  return out;
}

const kodu = (r: Sonuc): string | undefined =>
  r.err instanceof AppError ? (r.err.details?.code as string | undefined) : undefined;
const durumu = (r: Sonuc): number => (r.err instanceof AppError ? r.err.statusCode : r.err ? -1 : r.status);
const anahtar = (c = id.C, i = id.I, k = id.K) => ({ customerId: c, itemId: i, colorId: k });

async function kur(): Promise<void> {
  for (const [ad, aktif] of [["C", true], ["C_PASIF", false]] as const) {
    id[ad] = (await prisma.customer.create({ data: { code: `${P}-${ad}`, name: `${P} ${ad}`, isActive: aktif }, select: { id: true } })).id;
  }
  for (const [ad, aktif] of [["K", true], ["K_PASIF", false]] as const) {
    id[ad] = (await prisma.color.create({ data: { code: `${P}-${ad}`, name: `${P} ${ad}`, isActive: aktif }, select: { id: true } })).id;
  }
  const kumaslar: Array<[string, ItemLifecycleStatus]> = [
    ["I", ItemLifecycleStatus.ACTIVE],
    ["I_TUKEN", ItemLifecycleStatus.PHASE_OUT],
    ["I_PASIF", ItemLifecycleStatus.ARCHIVED],
    ["I_BIRLESIK", ItemLifecycleStatus.ARCHIVED],
  ];
  for (const [ad, lc] of kumaslar) {
    id[ad] = (await prisma.item.create({
      data: { code: `${P}-${ad}`, name: `${P} ${ad}`, itemType: ItemType.FABRIC, lifecycleStatus: lc, isActive: lc !== ItemLifecycleStatus.ARCHIVED },
      select: { id: true },
    })).id;
  }
  await prisma.item.update({ where: { id: id.I_BIRLESIK }, data: { mergedIntoId: id.I } });
}

async function govdeVeKapilar(): Promise<void> {
  console.log("\n§1 — yol parametresi, gövde, normalize");
  const kotuUuid = await cagir(ctl.upsertItemColorAlias, { customerId: "x", itemId: id.I, colorId: id.K }, { alias: "a" });
  check("UUID olmayan yol parametresi 400 (kardeşten farklı: açıkça)", durumu(kotuUuid) === 400 &&
    (kotuUuid.err as Error).message.startsWith("Geçersiz UUID formatı: 'customerId'"), (kotuUuid.err as Error)?.message);
  const govdesiz = await cagir(ctl.upsertItemColorAlias, anahtar(), undefined);
  check("gövde yok → Zod", govdesiz.err instanceof ZodError);
  const bos = await cagir(ctl.upsertItemColorAlias, anahtar(), { alias: "" });
  check("alias '' → Zod 'Alias boş olamaz'", bos.err instanceof ZodError && bos.err.issues[0]?.message === "Alias boş olamaz");
  const uzun = await cagir(ctl.upsertItemColorAlias, anahtar(), { alias: "X".repeat(201) });
  check("alias > 200 → Zod", uzun.err instanceof ZodError && uzun.err.issues[0]?.message === "Alias 200 karakteri aşamaz");
  const bosluk = await cagir(ctl.upsertItemColorAlias, anahtar(), { alias: "   " });
  check("normalize sonrası boş → 400 'Alias boş olamaz'", durumu(bosluk) === 400 && (bosluk.err as Error).message === "Alias boş olamaz");

  console.log("\n§2 — üç yazma kapısı (müşteri · kumaş DEFINITION · renk)");
  const yok = "00000000-0000-4000-8000-000000000000";
  const vakalar: Array<[string, ReturnType<typeof anahtar>, number, string | undefined]> = [
    ["müşteri yok → 404", anahtar(yok), 404, undefined],
    ["müşteri pasif → 400", anahtar(id.C_PASIF), 400, undefined],
    ["kumaş yok → 400 ITEM_NOT_FOUND", anahtar(id.C, yok), 400, "ITEM_NOT_FOUND"],
    ["kumaş 'Tükenene kadar' → 409 ITEM_PHASE_OUT (karar 5)", anahtar(id.C, id.I_TUKEN), 409, "ITEM_PHASE_OUT"],
    ["kumaş Pasif → 409 ITEM_INACTIVE", anahtar(id.C, id.I_PASIF), 409, "ITEM_INACTIVE"],
    ["kumaş birleştirilmiş → 409 ITEM_MERGED", anahtar(id.C, id.I_BIRLESIK), 409, "ITEM_MERGED"],
    ["renk yok → 404", anahtar(id.C, id.I, yok), 404, undefined],
    ["renk pasif → 400", anahtar(id.C, id.I, id.K_PASIF), 400, undefined],
  ];
  for (const [ad, k, st, kod] of vakalar) {
    const r = await cagir(ctl.upsertItemColorAlias, k, { alias: "ad" });
    check(ad, durumu(r) === st && kodu(r) === kod, `${durumu(r)} ${String(kodu(r))} ${(r.err as Error)?.message ?? ""}`);
  }
}

async function yazVeSil(): Promise<void> {
  console.log("\n§3 — upsert idempotent, BÜYÜK harf, audit; atomik silme");
  const r1 = await cagir(ctl.upsertItemColorAlias, anahtar(), { alias: " ozel ekru " });
  const r2 = await cagir(ctl.upsertItemColorAlias, anahtar(), { alias: " ozel ekru " });
  const row = (r1.body as { data?: { alias: string; id: string } })?.data;
  check("PUT 200 ve ad normalize (BÜYÜK, kırpık)", r1.status === 200 && row?.alias === "OZEL EKRU", row?.alias);
  check("aynı gövde ikinci kez 200 (idempotent, clientToken yok)", r2.status === 200);
  const loglar = await prisma.systemLog.findMany({
    where: { tableName: "CUSTOMER_ITEM_COLOR_ALIAS", recordId: row?.id },
    select: { action: true },
    orderBy: { createdAt: "asc" },
  });
  check("audit: CREATE sonra UPDATE", loglar.map((l) => l.action).join(",") === "CREATE,UPDATE", loglar.map((l) => l.action).join(","));

  const listeA = await cagir(ctl.listItemColorAliases, { customerId: id.C });
  const a0 = (listeA.body as { data: Array<{ item: { lifecycleStatus: string }; color: { hex: unknown } }> }).data[0];
  check("A: liste satırı item.lifecycleStatus + color özeti taşır", !!a0?.item.lifecycleStatus && a0 !== undefined && "hex" in a0.color);
  const pasifListe = await cagir(ctl.listItemColorAliases, { customerId: id.C_PASIF });
  check("A: pasif müşteri 400 (kardeş gibi)", durumu(pasifListe) === 400);

  await prisma.item.update({ where: { id: id.I }, data: { lifecycleStatus: ItemLifecycleStatus.PHASE_OUT } });
  const listeB = await cagir(ctl.listItemColorAliasesByItem, { id: id.I });
  check("B: 'Tükenene kadar' kumaşın satırı LİSTELENİR", (listeB.body as { data: unknown[] }).data.length === 1);
  const yokB = await cagir(ctl.listItemColorAliasesByItem, { id: "00000000-0000-4000-8000-000000000000" });
  check("B: kumaş yok → 404", durumu(yokB) === 404);

  const sil = await cagir(ctl.deleteItemColorAlias, anahtar(), undefined);
  check("D: pasif karttaki adı silmek serbest (kapı yok) → 200", sil.status === 200 && (sil.body as { data: { deleted: boolean } }).data.deleted === true);
  const silLog = await prisma.systemLog.findFirst({ where: { tableName: "CUSTOMER_ITEM_COLOR_ALIAS", recordId: row?.id, action: "DELETE" }, select: { oldData: true } });
  check("D: audit DELETE oldData silinen satırdan", (silLog?.oldData as { alias?: string } | null)?.alias === "OZEL EKRU");
  const tekrar = await cagir(ctl.deleteItemColorAlias, anahtar(), undefined);
  check("D: satır yok → 404 ITEM_COLOR_ALIAS_NOT_FOUND", durumu(tekrar) === 404 && kodu(tekrar) === "ITEM_COLOR_ALIAS_NOT_FOUND",
    `${durumu(tekrar)} ${String(kodu(tekrar))}`);
  await prisma.item.update({ where: { id: id.I }, data: { lifecycleStatus: ItemLifecycleStatus.ACTIVE } });
}

async function yaris(): Promise<void> {
  console.log("\n§4 — eşzamanlı ilk PUT: 200 ya da 409, 500 ASLA");
  for (let tur = 0; tur < 5; tur++) {
    await prisma.customerItemColorAlias.deleteMany({ where: { customerId: id.C } });
    const sonuclar = await Promise.all([1, 2, 3].map((n) => cagir(ctl.upsertItemColorAlias, anahtar(), { alias: `YARIS ${n}` })));
    const kotu = sonuclar.filter((r) => !(r.status === 200 || (durumu(r) === 409 && kodu(r) === "ITEM_COLOR_ALIAS_CONFLICT")));
    check(`tur ${tur + 1}: her deneme 200 ya da kodlu 409`, kotu.length === 0,
      kotu.map((r) => `${durumu(r)} ${(r.err as Error)?.message ?? ""}`).join(" | "));
  }
  check("yarış sonunda TEK satır", (await prisma.customerItemColorAlias.count({ where: { customerId: id.C } })) === 1);
}

async function temizle(): Promise<void> {
  const sus = <T>(p: Promise<T>) => p.catch(() => undefined);
  if (id.C) await sus(prisma.customerItemColorAlias.deleteMany({ where: { customerId: id.C } }));
  if (id.I_BIRLESIK) await sus(prisma.item.update({ where: { id: id.I_BIRLESIK }, data: { mergedIntoId: null } }));
  for (const k of ["I_BIRLESIK", "I_PASIF", "I_TUKEN", "I"]) if (id[k]) await sus(prisma.item.delete({ where: { id: id[k] } }));
  for (const k of ["K", "K_PASIF"]) if (id[k]) await sus(prisma.color.delete({ where: { id: id[k] } }));
  for (const k of ["C", "C_PASIF"]) if (id[k]) await sus(prisma.customer.delete({ where: { id: id[k] } }));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    fail++;
    return;
  }
  await kur();
  await govdeVeKapilar();
  await yazVeSil();
  await yaris();
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await temizle().catch((e) => console.error("temizlik hatası:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
