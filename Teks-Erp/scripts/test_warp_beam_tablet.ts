// =============================================================================
// BEKÇİ — Devere TABLET dilimi (DEVERE-LEVENT-TARAMASI §11): kapı genişlemesi + bağlam ucu allowlist
// =============================================================================
// SORU 1 (statik): tabletin çağırdığı her uç `mobile:devere`yi web izninin ALTERNATİFİ
//   olarak kabul ediyor mu; iptal + önizleme yalnız `mobile:devere-iptal` mı; PATCH tablet
//   izni almıyor mu (yanlış plan silinir, düzenlenmez)?
// SORU 2 (DB): `GET /tablet-context` cevabı OPT-IN allowlist mi — cari/tedarikçi satırından
//   vergi no, adres, bakiye gibi başka alan SIZMAZ (1e ek şart ②, `test_kimlik_sizintisi`
//   sınıfı). Fikstürlü ölçüm: her liste ≥1 satır (boş liste = sessiz yeşil).
// SORU 3 (DB): denye TEK kaynaktan (`resolveDenier`) — kartta denye yoksa `null` döner.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-14): `POST /:id/wind` guard'ından `...MOBILE_DEVERE`
//    düşürülünce §1b KIRMIZI · `/:id/cancel` guard'ına `mobile:devere` eklenince §1c KIRMIZI ·
//    `warp-beam-tablet.service` `suppliers.map`ine `taxNumber` eklenince §2b/§2e KIRMIZI (yalnız `select` genişletmek
//    sızdırmaz — allowlist `map`tir, ölçüldü).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Fikstür `TEST-LVT-<pid>`, finally'de silinir.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { StationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { getWarpBeamTabletContext } from "../src/services/warp-beam-tablet.service";

const ROOT = path.resolve(__dirname, "..");
const TAG = `TEST-LVT-${process.pid}`;
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

/** `router.<m>("<yol>", <guard…>` çağrısının guard metnini döner (parantez dengeli). */
function guardOf(src: string, method: string, routePath: string): string | null {
  const re = new RegExp(`router\\.${method}\\(\\s*"${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*,`);
  const m = re.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      if (depth === 0) break;
      depth--;
    } else if (src[i] === "," && depth === 0) break;
  }
  return src.slice(start, i);
}

function statik(): void {
  console.log("── §1 Route kapıları (statik) ──");
  const src = readFileSync(path.join(ROOT, "src/routes/warp-beam.routes.ts"), "utf8");
  check("§1a ekran ve yetenek izin kümeleri adlı sabit (bekçi tarayıcıları çözer)", /const MOBILE_DEVERE = \["mobile:devere"\] as const;/.test(src) && /const MOBILE_DEVERE_IPTAL = \["mobile:devere-iptal"\] as const;/.test(src));
  const ekran: [string, string][] = [["get", "/"], ["get", "/devere-machines"], ["get", "/tablet-context"], ["get", "/:id"], ["post", "/"], ["delete", "/:id"], ["post", "/:id/wind"]];
  for (const [m, p] of ekran) {
    const g = guardOf(src, m, p);
    check(`§1b ${m.toUpperCase()} ${p} → requireAnyPermission(<web>, ...MOBILE_DEVERE)`, g != null && /requireAnyPermission\("warpbeam:(read|write)", \.\.\.MOBILE_DEVERE\)/.test(g), g ?? "route yok");
  }
  for (const [m, p] of [["get", "/:id/cancel-preview"], ["post", "/:id/cancel"]] as [string, string][]) {
    const g = guardOf(src, m, p);
    check(`§1c ${m.toUpperCase()} ${p} → yalnız yetenek izni (MOBILE_DEVERE_IPTAL; ekran izni KABUL EDİLMEZ)`, g != null && /requireAnyPermission\("warpbeam:cancel", \.\.\.MOBILE_DEVERE_IPTAL\)/.test(g) && !/\.\.\.MOBILE_DEVERE\)/.test(g), g ?? "route yok");
  }
  const patch = guardOf(src, "patch", "/:id");
  check("§1d PATCH /:id tablet izni ALMAZ (yanlış plan silinir, düzenlenmez — §11 A2)", patch != null && /requirePermission\("warpbeam:write"\)/.test(patch) && !/mobile:/.test(patch), patch ?? "route yok");
  check("§1e tablet-context, `/:id`den ÖNCE kayıtlı (yoksa 'tablet-context' bir id sanılır → 400)", src.indexOf('router.get("/tablet-context"') < src.indexOf('router.get("/:id"'));
  const kat = readFileSync(path.join(ROOT, "src/constants/screen-catalog.ts"), "utf8");
  check("§1f SCREEN_CATALOG mobil satırı: Devere · devereEnabled · mobile:devere · yetenek mobile:devere-iptal", /key: "Devere", app: "mobile", modul: "devereEnabled", title: "[^"]+", requires: \["mobile:devere"\], capabilities: \[\{ code: "mobile:devere-iptal"/.test(kat));
}

const ALLOW = {
  warpSpecs: ["id", "code", "name", "endsCount", "denier"],
  machines: ["id", "code", "name", "stationName"],
  warehouses: ["id", "name", "isDefault"],
  subcontractors: ["id", "name"],
  suppliers: ["id", "name", "type"],
} as const;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== DEVERE TABLET DİLİMİ BEKÇİSİ ===\n");
  statik();

  console.log("\n── §2 tablet-context OPT-IN allowlist (DB, fikstürlü) ──");
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  const yarnDenyesiz = await prisma.item.create({ data: { code: `${TAG}-IP0`, name: `${TAG} denyesiz`, itemType: "YARN", unit: "KG" }, select: { id: true } });
  const spec = await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3500 }, select: { id: true } });
  const specDenyesiz = await prisma.warpSpec.create({ data: { code: `${TAG}-CK0`, name: `${TAG} denyesiz`, yarnItemId: yarnDenyesiz.id, endsCount: 100 }, select: { id: true } });
  const specPasif = await prisma.warpSpec.create({ data: { code: `${TAG}-CKP`, name: `${TAG} pasif`, yarnItemId: yarn.id, endsCount: 100, isActive: false }, select: { id: true } });
  const st = await prisma.station.create({ data: { name: `${TAG}-DEVERE`, code: `${TAG}-DV`.slice(0, 32), type: StationType.INTERNAL, producesWarpBeam: true }, select: { id: true } });
  const mk = await prisma.machine.create({ data: { stationId: st.id, name: `${TAG}-M1`, code: `${TAG}-M1`.slice(0, 32) }, select: { id: true } });
  const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fasoncu` }, select: { id: true } });
  // Cari satırı BİLEREK zengin: vergi no + adres — bunlar cevaba SIZMAMALI.
  const cari = await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} tedarikçi`, type: "SUPPLIER", taxNumber: "9990001112", address: `${TAG} gizli adres` }, select: { id: true } });
  try {
    const ctx = (await getWarpBeamTabletContext()).data;
    for (const [liste, alanlar] of Object.entries(ALLOW) as [keyof typeof ALLOW, readonly string[]][]) {
      const rows = ctx[liste] as Record<string, unknown>[];
      check(`§2a ${liste}: fikstür satırı listede (boş liste = sessiz yeşil, ölçülmedi sayılır)`, rows.length >= 1, `${rows.length} satır`);
      const kacak = rows.flatMap((r) => Object.keys(r).filter((k) => !alanlar.includes(k)));
      check(`§2b ${liste}: her satırın anahtar kümesi ALLOWLIST'e eşit`, kacak.length === 0 && rows.every((r) => alanlar.every((k) => k in r)), kacak.length ? `sızan: ${[...new Set(kacak)].join(",")}` : `${alanlar.join(",")}`);
    }
    const cariSatir: Record<string, unknown> | undefined = ctx.suppliers.find((c) => c.id === cari.id);
    check("§2c tedarikçi adayı listede (CompanyType duvar değil; SUPPLIER/BOTH önce)", !!cariSatir);
    check("§2e ⭐ cari satırında vergi no / adres YOK (opt-in; `map` genişletilse buradan ısırır)", !!cariSatir && !("taxNumber" in cariSatir) && !("address" in cariSatir) && !JSON.stringify(ctx).includes("9990001112") && !JSON.stringify(ctx).includes("gizli adres"));
    check("§2d pasif çözgü kartı listede DEĞİL", !ctx.warpSpecs.some((s) => s.id === specPasif.id));
    check("§2d devere makinesi listede, istasyon adıyla", ctx.machines.some((m) => m.id === mk.id && m.stationName === `${TAG}-DEVERE`));
    console.log("\n── §3 denye tek kaynak ──");
    const s1 = ctx.warpSpecs.find((s) => s.id === spec.id);
    const s0 = ctx.warpSpecs.find((s) => s.id === specDenyesiz.id);
    check("§3a denyeli kart: `denier` = resolveDenier(item) (300)", s1?.denier === 300, String(s1?.denier));
    check("§3b denyesiz kart: `denier` null (form 'kartta denye yok' uyarısı çizer, kaydet 400 bekler)", s0 != null && s0.denier === null);
  } finally {
    await prisma.warpSpec.deleteMany({ where: { id: { in: [spec.id, specDenyesiz.id, specPasif.id] } } });
    await prisma.item.deleteMany({ where: { id: { in: [yarn.id, yarnDenyesiz.id] } } });
    await prisma.machine.delete({ where: { id: mk.id } }).catch(() => undefined);
    await prisma.station.delete({ where: { id: st.id } }).catch(() => undefined);
    await prisma.subcontractor.delete({ where: { id: sub.id } }).catch(() => undefined);
    await prisma.customer.delete({ where: { id: cari.id } }).catch(() => undefined);
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
