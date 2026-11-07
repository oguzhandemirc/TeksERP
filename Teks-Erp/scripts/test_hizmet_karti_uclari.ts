// =============================================================================
// BEKÇİ — Hizmet kartı uçları (`/api/service-items`, D1b) + eski istemci uyumluluk yolu
// =============================================================================
// Çalıştırma: npx tsx scripts/test_hizmet_karti_uclari.ts  (kendi sunucusunu boş portta açar)
//
// ÖLÇÜLENLER:
//   §1 CRUD: oluştur (kod boş → HZM-NNNNNN, ad TR-büyük), listede/aramada görünür, detay, PATCH ad/birim, audit SERVICE_ITEM
//   §2 400 mesajları: boş ad, bilinmeyen alan (strict), geçersiz birim, STK-/HZM- öneki, PATCH code; ürün kartı HZM- reddi
//   §3 iki yönlü kimlik: hizmet kodu = ürün kodu (harf farkıyla) → 409 CARD_CODE_TAKEN_BY_OTHER_KIND (iki yön);
//      ad çakışması → 409 CARD_NAME_TAKEN_BY_OTHER_KIND (iki yön); hizmet ↔ hizmet aynı ad 409;
//      §3g/h ad yarışı benzetimi (ön kontrol atlanır) → DB seddi Türkçe ad 409'u, kod yeniden denemesi değil
//   §4 eski uç şekli: GET /api/items?filter[itemType]=SERVICE ve GET /api/items/:id hizmeti `itemType:SERVICE`
//      ile döner; PATCH /api/items/:id hizmeti düzenler; POST /api/items {itemType:SERVICE} hizmet kartı açar (service_items);
//      §4f/g SERVICE dalı item:write ister (mobile:kumas 403, kumaş dalı açık); §4h audit anlatısı "hizmet kartı"
//   §5 yaşam döngüsü: DELETE Pasif'e alır, önizleme şekli, yeniden Aktif; izin: item:read yazamaz (403)
// Negatif sonda (2026-11-08): `item.service.ts` create'teki `assertCodeFreeInOtherKind` çağrıları kaldırılınca
// §3c (ürün → hizmet yönü) ❌ 201; `wantsLegacyServiceList` yönlendirmesi kapatılınca §4a ❌ n=0 (25/27).
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { ItemType } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { AuthService } from "../src/services/auth.service";
import { serviceItemService } from "../src/services/service-item.service";
import { itemService } from "../src/routes/item.routes";
import { narrateRows, type Anlati, type NarrativeRow } from "../src/services/audit-narrative";
import { islemBasligi } from "../src/services/audit-narrative/islem";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const STAMP = randomUUID().slice(0, 6).toUpperCase();
const TAG = `TST-HKU-${STAMP}`;
const ids = { users: [] as string[], items: [] as string[], services: [] as string[] };

interface Resp { status: number; body: { success?: boolean; data?: unknown; message?: string; details?: { code?: string }; errors?: Array<{ field: string; message: string }>; pagination?: unknown } }

async function main(): Promise<void> {
  console.log("=== Hizmet kartı uçları (D1b) ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB test DB'si", false, engel); return; }
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const call = async (method: string, p: string, token: string, body?: unknown): Promise<Resp> => {
      const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Resp["body"] };
    };
    const kullanici = async (ek: string, izinler: string[], clientType = "electron"): Promise<string> => {
      const username = `${TAG}-${ek}`.toLowerCase();
      const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
      ids.users.push(u.id);
      const perms = await prisma.permission.findMany({ where: { code: { in: izinler } }, select: { id: true } });
      await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test123456", clientType }) });
      const token = ((await r.json()) as { data?: { token?: string } }).data?.token;
      if (!token) throw new Error(`login başarısız: ${username} (${r.status})`);
      return token;
    };
    const yazar = await kullanici("w", ["item:read", "item:write"]);
    const okur = await kullanici("r", ["item:read"]);
    const kod = (r: Resp) => r.body.details?.code ?? "";
    const data = (r: Resp) => r.body.data as Record<string, unknown>;

    console.log("\n── §1 CRUD ──");
    const c1 = await call("POST", "/api/service-items", yazar, { name: `${TAG} kurşun hizmeti`, unit: "KG" });
    const s1 = data(c1) ?? {};
    if (typeof s1.id === "string") ids.services.push(s1.id);
    check("§1a oluştur 201 + kod boş → HZM-NNNNNN", c1.status === 201 && /^HZM-\d{6}$/.test(String(s1.code)), `${c1.status} ${String(s1.code)}`);
    check("§1b ad TR-büyük harfe normalize, birim yazıldı, Aktif doğdu", s1.name === `${TAG} KURŞUN HİZMETİ` && s1.unit === "KG" && s1.lifecycleStatus === "ACTIVE", String(s1.name));
    const c1b = await call("POST", "/api/service-items", yazar, { name: `${TAG} tambur hizmeti` });
    const s1b = data(c1b) ?? {};
    if (typeof s1b.id === "string") ids.services.push(s1b.id);
    const n1 = Number(String(s1.code).slice(4));
    const n2 = Number(String(s1b.code).slice(4));
    check("§1c ikinci kart sıradaki HZM numarası, varsayılan birim MT", n2 > n1 && s1b.unit === "MT", `${String(s1.code)} → ${String(s1b.code)}`);
    const l1 = await call("GET", `/api/service-items?search=${encodeURIComponent(TAG)}&pageSize=50`, okur);
    const liste = (l1.body.data ?? []) as Array<{ id: string }>;
    check("§1d liste/arama yalnız hizmet kartlarını döner (iki kart)", l1.status === 200 && liste.length === 2 && liste.every((x) => ids.services.includes(x.id)), `${l1.status} n=${liste.length}`);
    const d1 = await call("GET", `/api/service-items/${String(s1.id)}`, okur);
    check("§1e detay 200", d1.status === 200 && data(d1)?.code === s1.code, String(d1.status));
    const p1 = await call("PATCH", `/api/service-items/${String(s1.id)}`, yazar, { name: `${TAG} kurşun işçiliği`, unit: "ADET" });
    check("§1f PATCH ad + birim", p1.status === 200 && data(p1)?.name === `${TAG} KURŞUN İŞÇİLİĞİ` && data(p1)?.unit === "ADET", `${p1.status} ${p1.body.message ?? ""}`);
    const audit = await prisma.systemLog.count({ where: { tableName: "SERVICE_ITEM", recordId: String(s1.id) } });
    check("§1g audit SERVICE_ITEM (oluştur + güncelle)", audit >= 2, String(audit));

    console.log("\n── §2 400 mesajları ──");
    const e2a = await call("POST", "/api/service-items", yazar, { name: "" });
    check("§2a boş ad → 400 Türkçe", e2a.status === 400 && (e2a.body.errors ?? []).some((e) => e.message === "Hizmet adı boş bırakılamaz"), JSON.stringify(e2a.body.errors));
    const e2b = await call("POST", "/api/service-items", yazar, { name: `${TAG} X`, itemType: "SERVICE" });
    check("§2b bilinmeyen alan (strict) → 400", e2b.status === 400, String(e2b.status));
    const e2c = await call("POST", "/api/service-items", yazar, { name: `${TAG} X`, unit: "TOP" });
    check("§2c geçersiz birim → 400 Türkçe", e2c.status === 400 && (e2c.body.errors ?? []).some((e) => e.message.includes("Birim")), JSON.stringify(e2c.body.errors));
    const e2d = await call("POST", "/api/service-items", yazar, { name: `${TAG} X`, code: "hzm-999999" });
    check("§2d HZM-/STK- öneki elle yazılamaz → 400", e2d.status === 400 && (e2d.body.message ?? "").includes("HZM-"), e2d.body.message ?? "");
    const e2e = await call("PATCH", `/api/service-items/${String(s1.id)}`, yazar, { code: "YENI" });
    check("§2e PATCH code → 400", e2e.status === 400, String(e2e.status));
    const e2f = await call("POST", "/api/items", yazar, { name: `${TAG} HZM ONEK`, itemType: "FABRIC", code: "hzm-123456" });
    if (e2f.status === 201 && typeof data(e2f)?.id === "string") ids.items.push(String(data(e2f).id));
    check("§2f ürün kartı HZM- önekiyle açılamaz → 400 ITEM_CODE_RESERVED_PREFIX", e2f.status === 400 && kod(e2f) === "ITEM_CODE_RESERVED_PREFIX", `${e2f.status} ${kod(e2f)}`);

    console.log("\n── §3 ürün ↔ hizmet kimliği (iki yönlü) ──");
    const urun = await prisma.item.create({ data: { code: `${TAG}-K`, name: `${TAG} KUMAŞ`, itemType: ItemType.FABRIC, unit: "MT" }, select: { id: true } });
    ids.items.push(urun.id);
    const e3a = await call("POST", "/api/service-items", yazar, { name: `${TAG} Y`, code: `${TAG}-k`.toLowerCase() });
    check("§3a hizmet kodu = ürün kodu (harf farkı) → 409 CARD_CODE_TAKEN_BY_OTHER_KIND", e3a.status === 409 && kod(e3a) === "CARD_CODE_TAKEN_BY_OTHER_KIND", `${e3a.status} ${kod(e3a)}`);
    const c3 = await call("POST", "/api/service-items", yazar, { name: `${TAG} brode`, code: `${TAG}-BR` });
    if (typeof data(c3)?.id === "string") ids.services.push(String(data(c3).id));
    check("§3b elle kod kabul edilir", c3.status === 201 && data(c3)?.code === `${TAG}-BR`, String(c3.status));
    const e3c = await call("POST", "/api/items", yazar, { name: `${TAG} Z`, itemType: "FABRIC", code: `${TAG}-br`.toLowerCase() });
    if (e3c.status === 201 && typeof data(e3c)?.id === "string") ids.items.push(String(data(e3c).id));
    check("§3c ürün kodu = hizmet kodu → 409 CARD_CODE_TAKEN_BY_OTHER_KIND (ters yön)", e3c.status === 409 && kod(e3c) === "CARD_CODE_TAKEN_BY_OTHER_KIND", `${e3c.status} ${kod(e3c)}`);
    const e3d = await call("POST", "/api/service-items", yazar, { name: `${TAG} kumaş` });
    check("§3d hizmet adı = ürün adı → 409 CARD_NAME_TAKEN_BY_OTHER_KIND", e3d.status === 409 && kod(e3d) === "CARD_NAME_TAKEN_BY_OTHER_KIND", `${e3d.status} ${kod(e3d)}`);
    const e3e = await call("POST", "/api/items", yazar, { name: `${TAG} tambur hizmeti`, itemType: "FABRIC" });
    if (e3e.status === 201 && typeof data(e3e)?.id === "string") ids.items.push(String(data(e3e).id));
    check("§3e ürün adı = hizmet adı → 409 CARD_NAME_TAKEN_BY_OTHER_KIND (ters yön)", e3e.status === 409 && kod(e3e) === "CARD_NAME_TAKEN_BY_OTHER_KIND", `${e3e.status} ${kod(e3e)}`);
    const e3f = await call("POST", "/api/service-items", yazar, { name: `${TAG} tambur hizmeti` });
    check("§3f hizmet ↔ hizmet aynı ad → 409", e3f.status === 409, String(e3f.status));
    // §3g ad YARIŞI benzetimi: ön kontrol atlanınca (iki istek aynı anda) DB seddi P2002 verir; otomatik kod
    // yeniden denemesi yalnız KOD çakışmasına uygulanır ⇒ ad çakışması "denemede başarısız" değil Türkçe ad 409'u.
    const svcAny = serviceItemService as unknown as { assertNameNotDuplicate: (...a: unknown[]) => Promise<void> };
    const itmAny = itemService as unknown as { assertNameNotDuplicate: (...a: unknown[]) => Promise<void> };
    svcAny.assertNameNotDuplicate = async () => {};
    itmAny.assertNameNotDuplicate = async () => {};
    try {
      const r3g = await call("POST", "/api/service-items", yazar, { name: `${TAG} tambur hizmeti` });
      check("§3g ⭐ hizmet ad yarışı → 409 Türkçe ad mesajı (kod yeniden denemesine girmez)",
        r3g.status === 409 && (r3g.body.message ?? "").includes("ad") && !(r3g.body.message ?? "").includes("deneme"), `${r3g.status} ${r3g.body.message ?? ""}`);
      const r3h = await call("POST", "/api/items", yazar, { name: `${TAG} kumaş`, itemType: "FABRIC" });
      if (r3h.status === 201 && typeof data(r3h)?.id === "string") ids.items.push(String(data(r3h).id));
      check("§3h ⭐ ürün ad yarışı → 409 Türkçe ad mesajı (kod yeniden denemesine girmez)",
        r3h.status === 409 && (r3h.body.message ?? "").includes("ad") && !(r3h.body.message ?? "").includes("deneme"), `${r3h.status} ${r3h.body.message ?? ""}`);
    } finally {
      delete (svcAny as Partial<typeof svcAny>).assertNameNotDuplicate;
      delete (itmAny as Partial<typeof itmAny>).assertNameNotDuplicate;
    }

    console.log("\n── §4 eski istemci uyumluluk yolu ──");
    const l4 = await call("GET", `/api/items?filter[itemType]=SERVICE&search=${encodeURIComponent(TAG)}&pageSize=50`, okur);
    const l4d = (l4.body.data ?? []) as Array<{ id: string; itemType: string; allowedColors: unknown[] }>;
    check("§4a GET /api/items?filter[itemType]=SERVICE hizmet kartlarını eski şekilde döner",
      l4.status === 200 && l4d.length === 3 && l4d.every((x) => x.itemType === "SERVICE" && Array.isArray(x.allowedColors)) && l4.body.pagination !== undefined, `${l4.status} n=${l4d.length}`);
    const l4b = await call("GET", `/api/items?filter[itemType]=FABRIC&search=${encodeURIComponent(TAG)}&pageSize=50`, okur);
    check("§4b ürün listesi hizmet içermez", ((l4b.body.data ?? []) as Array<{ id: string }>).every((x) => !ids.services.includes(x.id)), String(l4b.status));
    const d4 = await call("GET", `/api/items/${String(s1.id)}`, okur);
    check("§4c GET /api/items/:id (hizmet id) → 200 itemType SERVICE", d4.status === 200 && data(d4)?.itemType === "SERVICE" && data(d4)?.code === s1.code, String(d4.status));
    const p4 = await call("PATCH", `/api/items/${String(s1.id)}`, yazar, { name: `${TAG} kurşun eski panel`, unit: "MT" });
    check("§4d PATCH /api/items/:id (hizmet id) hizmet kartını düzenler", p4.status === 200 && data(p4)?.itemType === "SERVICE"
      && (await prisma.serviceItem.findUnique({ where: { id: String(s1.id) }, select: { name: true } }))?.name === `${TAG} KURŞUN ESKİ PANEL`, `${p4.status} ${p4.body.message ?? ""}`);
    const e4 = await call("POST", "/api/items", yazar, { name: `${TAG} yeni hizmet`, itemType: "SERVICE" });
    const e4id = typeof data(e4)?.id === "string" ? String(data(e4).id) : null;
    if (e4id) ids.services.push(e4id);
    const e4svc = e4id ? await prisma.serviceItem.findUnique({ where: { id: e4id }, select: { code: true } }) : null;
    const e4item = e4id ? await prisma.item.findUnique({ where: { id: e4id }, select: { id: true } }) : null;
    check("§4e ⭐ POST /api/items {itemType:SERVICE} hizmet kartı açar (service_items, HZM- kodu, eski şekil)",
      (e4.status === 200 || e4.status === 201) && data(e4)?.itemType === "SERVICE" && e4svc !== null && /^HZM-/.test(e4svc.code) && e4item === null,
      `${e4.status} ${kod(e4) ?? ""} svc=${e4svc?.code ?? "yok"} item=${e4item ? "var" : "yok"}`);

    // §4f/g inceleme 2026-11-08: eski yolun SERVICE dalı `mobile:kumas` ile hizmet kartı AÇAMAZ; kumaş dalı açık kalır.
    const mobil = await kullanici("m", ["mobile:kumas"], "mobile"); // mobil-only hesap masaüstü kanalına giremez
    const e4f = await call("POST", "/api/items", mobil, { name: `${TAG} mobil hizmet`, itemType: "SERVICE" });
    const e4fRow = await prisma.serviceItem.findFirst({ where: { name: { startsWith: `${TAG} MOBİL` } }, select: { id: true } });
    if (e4fRow) ids.services.push(e4fRow.id);
    check("§4f ⭐ POST /api/items {itemType:SERVICE} yalnız mobile:kumas ile → 403 PERMISSION_DENIED (item:write), kart açılmaz",
      e4f.status === 403 && kod(e4f) === "PERMISSION_DENIED" && e4fRow === null, `${e4f.status} ${kod(e4f)} kart=${e4fRow ? "var" : "yok"}`);
    const e4g = await call("POST", "/api/items", mobil, { name: `${TAG} mobil kumaş`, itemType: "FABRIC", unit: "MT" });
    const e4gId = typeof data(e4g)?.id === "string" ? String(data(e4g).id) : null;
    if (e4gId) ids.items.push(e4gId);
    check("§4g mobile:kumas kumaş açmaya devam eder (izin kapısından geçer)", e4g.status !== 403, `${e4g.status} ${kod(e4g)} ${e4g.body.message ?? ""}`);
    // §4h eski yolun audit anlatısı + işlem başlığı "hizmet kartı" der (POST /api/items katalogda yok → kök satır anlatısı).
    const e4logs = e4id ? await prisma.systemLog.findMany({ where: { recordId: e4id }, include: { user: true } }) : [];
    const e4n = await narrateRows(e4logs as never) as Array<NarrativeRow & { anlati: Anlati }>;
    const baslik = islemBasligi(e4logs[0]?.user as never ?? null, { method: "POST", routeKey: "/api/items", status: 201, errorCode: null }, e4n);
    check("§4h eski yol SERVICE create audit'i SERVICE_ITEM ve anlatı/başlık \"hizmet kartını oluşturdu\" (ürün kartı değil)",
      e4n.length === 1 && e4n[0]!.tableName === "SERVICE_ITEM" && e4n[0]!.anlati.metin.includes("hizmet kartını oluşturdu") && baslik.metin.includes("hizmet kartını oluşturdu") && !/ürün|stok kalem|kumaş/i.test(baslik.metin),
      `${e4n.map((x) => `${x.tableName}: ${x.anlati.metin}`).join(" | ")} · başlık: ${baslik.metin}`);

    console.log("\n── §5 yaşam döngüsü + izin ──");
    const pv = await call("GET", `/api/service-items/${String(s1b.id)}/lifecycle-preview?to=ARCHIVED`, yazar);
    check("§5a önizleme: canlı referans yok → canTransition", pv.status === 200 && data(pv)?.canTransition === true && data(pv)?.liveTotal === 0, String(pv.status));
    const del = await call("DELETE", `/api/service-items/${String(s1b.id)}`, yazar);
    const st = await prisma.serviceItem.findUnique({ where: { id: String(s1b.id) }, select: { lifecycleStatus: true, isActive: true } });
    check("§5b DELETE = Pasif'e al (satır durur)", del.status === 200 && st?.lifecycleStatus === "ARCHIVED" && st.isActive === false, `${del.status} ${st?.lifecycleStatus}`);
    const back = await call("POST", `/api/service-items/${String(s1b.id)}/lifecycle`, yazar, { to: "ACTIVE" });
    check("§5c yeniden Aktif", back.status === 200 && data(back)?.lifecycleStatus === "ACTIVE", String(back.status));
    const e5 = await call("POST", "/api/service-items", okur, { name: `${TAG} yetkisiz` });
    check("§5d item:read ile yazım 403", e5.status === 403, String(e5.status));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function cleanup(): Promise<void> {
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.services, ...ids.items] } } });
  await prisma.serviceItem.deleteMany({ where: { id: { in: ids.services } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.session.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
}

main()
  .catch((e) => { fail++; console.error("\n💥 ÇÖKTÜ:", e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error("temizlik:", (e as Error).message); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
