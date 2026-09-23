// =============================================================================
// BEKÇİ — KODU SUNUCUDA ÜRETİLEN HER MASTER UCU, GÖVDEDE `code` OLMADAN 2xx DÖNER
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts master_kod_http
//
// ⭐ NEDEN (K20, 2026-09-23 — d3 e2e ölçümü): fason firma ve fason kategori
//    servisleri boş koda FSN/KAT üretiyordu (`ensureSubCode`), ama controller zod'u
//    `code`u ZORUNLU tutuyordu → panelin kodsuz "Yeni" kaydı 400 alıyordu. Servis
//    bekçisi (`test_subcontractor_code_autogen`) servisi DOĞRUDAN çağırdığı için bu
//    kapıyı hiç görmedi. Bu bekçi HTTP'den ölçer: gerçek app, gerçek zod, gerçek yetki.
//
// NE ÖLÇER: aşağıdaki her uçta kodsuz POST → 2xx, yanıtta `code` dolu ve serinin
// BUGÜNKÜ ön ekiyle başlıyor (`GET /api/number-series`). Yeni bir master varlık
// sunucuda kod üretmeye başlarsa buraya bir satır eklenir.
//
// ⭐ NEGATİF SONDA (2026-09-23, ölçüldü): subcontractor-management.controller.ts'te
//    `code` yeniden zorunlu yapılınca fason firma + kategori satırları KIRMIZI (400);
//    geri alınınca yeşil.
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const MARK = `TEST-MKH${Date.now().toString(36).slice(-5).toUpperCase()}`;
const BAYRAKLAR = ["finance.enabled", "production.enabled"] as const;
const olusanCariler: string[] = [];

async function main() {
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let token = "";
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; message?: string } };
  };
  const once = await prisma.systemSetting.findMany({ where: { key: { in: [...BAYRAKLAR] } } });
  try {
    // Finans + üretim modülü açık olmalı (kasa/banka · rota/şablon uçları modül kapılı). try İÇİNDE.
    for (const key of BAYRAKLAR) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    const cred = await ensureTestAdmin();
    const login = await call("POST", "/api/auth/login", { username: cred.username, password: cred.password });
    token = String(login.body.data?.token ?? "");
    check("login", login.status === 200 && token.length > 20, `status=${login.status}`);

    const seriler = ((await call("GET", "/api/number-series")).body.data ?? []) as unknown as Array<{ key: string; prefix: string }>;
    const onek = (key: string) => seriler.find((s) => s.key === key)?.prefix ?? "?";
    const istasyon = async (appliesProperty: boolean) =>
      String((await call("POST", "/api/stations", { name: `${MARK} İST ${appliesProperty ? "Ö" : "M"}`, type: "INTERNAL", appliesProperty })).body.data?.id ?? "");
    const [urun] = await prisma.item.findMany({ where: { isActive: true, itemType: "FABRIC" }, take: 1, select: { id: true } });

    const UCLAR: Array<[string, string, () => Promise<unknown> | unknown]> = [
      ["customer", "/api/customers", () => ({ name: `${MARK} Cari`, isCustomerRole: true })],
      ["subcontractor", "/api/subcontractors", () => ({ name: `${MARK} Fason` })],
      ["subcontractorCategory", "/api/subcontractor-categories", () => ({ name: `${MARK} Kategori`, description: null })],
      ["fabricProperty", "/api/fabric-properties", async () => ({ name: `${MARK} Özellik`, stationIds: [await istasyon(true)] })],
      ["item", "/api/items", () => ({ name: `${MARK} Ürün`, itemType: "FABRIC" })],
      ["color", "/api/colors", () => ({ name: `${MARK} Renk` })],
      ["station", "/api/stations", () => ({ name: `${MARK} İstasyon`, type: "INTERNAL" })],
      ["machine", "/api/machines", async () => ({ stationId: await istasyon(false), name: `${MARK} Makine` })],
      ["cashAccount", "/api/finance/cash-boxes", () => ({ name: `${MARK} Kasa` })],
      ["bankAccount", "/api/finance/bank-accounts", () => ({ name: `${MARK} Banka` })],
      ["returnReason", "/api/return-reasons", () => ({ name: `${MARK} İade Nedeni` })],
      ["productRecipe", "/api/product-recipes", () => ({ name: `${MARK} Şablon`, itemId: urun?.id })],
      ["defectType", "/api/defect-types", () => ({ name: `${MARK} Hata` })],
      ["warehouse", "/api/warehouses", () => ({ name: `${MARK} Depo` })],
      ["routeTemplate", "/api/routes", () => ({ name: `${MARK} Rota` })],
    ];
    for (const [key, uc, govde] of UCLAR) {
      const r = await call("POST", uc, await govde());
      const kod = String(r.body.data?.code ?? "");
      if (key === "customer" && r.body.data?.id) olusanCariler.push(String(r.body.data.id));
      check(`${key}: kodsuz POST ${uc} → 2xx, kod sunucudan (${onek(key)}…)`, r.status >= 200 && r.status < 300 && kod.startsWith(onek(key)),
        `status=${r.status} kod=${kod || "—"} ${r.status >= 300 ? String(r.body.message ?? "").slice(0, 120) : ""}`);
    }
  } finally {
    await temizlik(once);
    await new Promise((r) => server.close(() => r(undefined)));
  }
}

/** Teardown: bu koşumun işaretli satırları + bayrakların eski değeri. */
async function temizlik(once: Array<{ key: string; value: unknown }>): Promise<void> {
  const ad = { contains: MARK, mode: "insensitive" as const };
  await cleanupTestCustomers(olusanCariler).catch(() => undefined);
  await prisma.productRecipe.deleteMany({ where: { name: ad } }).catch(() => undefined);
  await prisma.machine.deleteMany({ where: { name: ad } }).catch(() => undefined);
  await prisma.fabricProperty.deleteMany({ where: { name: ad } }).catch(() => undefined);
  await prisma.station.deleteMany({ where: { name: ad } }).catch(() => undefined);
  for (const m of ["item", "color", "returnReason", "defectType", "warehouse", "route", "cashBox", "bankAccount", "subcontractor", "subcontractorCategory"] as const) {
    await (prisma[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { name: ad } }).catch(() => undefined);
  }
  for (const key of BAYRAKLAR) {
    const o = once.find((x) => x.key === key);
    if (o) await prisma.systemSetting.update({ where: { key }, data: { value: o.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main()
  .then(() => { console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`); })
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
