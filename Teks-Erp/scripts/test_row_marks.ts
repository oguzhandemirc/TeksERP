// =============================================================================
// BEKÇİ — SATIR İŞARETİ + NOT (kişisel / paylaşılan)
// Çalıştır: npx tsx scripts/run-all-tests.ts row_marks
// =============================================================================
//   §0 statik — tür kümesinin her okuma izni PERMISSION_CATALOG'da; panel aynası anahtarları bayt-eşit
//   §1 görünürlük — başkasının KİŞİSEL işareti dönmez; paylaşılan döner + sahibinin adı; kendi işaretin önce;
//      pasif sahibin paylaşılan işareti dönmez; başkası paylaşılanı değiştiremez (kendi satırını yazar)
//   §2 kapı — tür okuma izni yoksa lookup/put/mine 403; tanınmayan tür 400 ROW_MARK_ENTITY_UNKNOWN;
//      201 kimlik 400; not 501 karakter 400; geçersiz renk 400
//   §3 upsert — eşzamanlı iki PUT → tek satır; renk+not boş → satır silinir; DB CHECK boş satırı reddeder (23514)
//   §4 mine — renk süzgeci + sayfalama
//   §5 audit — RowMark muaf (KULLANICI_TERCIHI): not metni SystemLog'a girmez
//   §6 liste id süzgeci — "İşaretliler" süzgecinin dayandığı `filter[id]` sipariş / terbiye iş emri / top
//      listelerinde SUNUCUDA uygulanır (var olmayan kimlik → 0 satır)
//
// ⭐ NEGATİF SONDA (2026-11-13, izole ağaç, md5 ile geri yüklendi; tam koşum 27/0, 2 kol boş listeden atlandı):
//    ① lookup OR'undan `shared: true` kaldırıldı → §1b ❌ (başkasının kişisel işareti döndü) ·
//    ② tür kapısındaki matchesPermission atlandı → §2a ❌ (200/200/200) · ③ boş işaret silme dalı
//    kaldırıldı → §3b ❌ (DB CHECK 23514 seddi devreye girdi, servis 4xx/5xx verdi).
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik `finally`de.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { customerService } from "../src/routes/customer.routes";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { ROW_MARK_ENTITY_PERMISSIONS, ROW_MARK_ENTITIES } from "../src/constants/row-mark-entities";

let pass = 0;
let fail = 0;
let atlanan = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const ROOT = path.resolve(__dirname, "..");
const TAG = `TEST-RMK-${process.pid}`;
type Mark = { recordId: string; color: string | null; note: string | null; shared: boolean; mine: boolean; ownerName: string | null };
type Resp = { status: number; body: { message?: string; details?: { code?: string }; data?: Record<string, unknown> } };

function statik(): void {
  console.log("§0 statik");
  const katalog = new Set(PERMISSION_CATALOG.map((p) => p.code));
  const eksik = Object.values(ROW_MARK_ENTITY_PERMISSIONS).filter((k) => !katalog.has(k));
  check("§0a her türün okuma izni katalogda", eksik.length === 0, eksik.join(", "));
  const ayna = readFileSync(path.join(ROOT, "../Electron/src/lib/row-mark-entities.ts"), "utf8");
  const panel = [...ayna.matchAll(/^\s+"([A-Za-z]+)",$/gm)].map((m) => m[1]);
  check("§0b panel aynası anahtarları backend kümesiyle aynı sırada", JSON.stringify(panel) === JSON.stringify(ROW_MARK_ENTITIES), `panel=${panel.join(",")}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== SATIR İŞARETİ BEKÇİSİ ===\n");
  statik();

  const userIds: string[] = [];
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const admin = await ensureTestAdmin();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string | null, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let parsed: Resp["body"] = {};
    try {
      parsed = (await r.json()) as Resp["body"];
    } catch {
      /* boş gövde */
    }
    return { status: r.status, body: parsed };
  };
  const login = async (u: string, p: string): Promise<string> => {
    const r = await call("POST", "/api/auth/login", null, { username: u, password: p });
    const t = (r.body as { data?: { token?: string } }).data?.token;
    if (!t) throw new Error(`login başarısız: ${u} (${r.status})`);
    return t;
  };
  const kullanici = async (ek: string, izinler: string[]): Promise<{ id: string; token: string; fullName: string }> => {
    const username = `${TAG}-${ek}`.toLowerCase();
    const fullName = `${TAG} ${ek}`;
    const u = await prisma.user.create({ data: { username, fullName, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    userIds.push(u.id);
    const perms = await prisma.permission.findMany({ where: { code: { in: izinler } }, select: { id: true } });
    if (perms.length) await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
    return { id: u.id, token: await login(username, "test123456"), fullName };
  };
  const put = (token: string, recordId: string, color: string | null, note: string | null, shared = false, entityType = "order") =>
    call("PUT", "/api/row-marks", token, { entityType, recordId, color, note, shared });
  const lookup = async (token: string, recordIds: string[], entityType = "order"): Promise<{ status: number; marks: Mark[]; code?: string }> => {
    const r = await call("POST", "/api/row-marks/lookup", token, { entityType, recordIds });
    return { status: r.status, marks: ((r.body.data?.marks as Mark[]) ?? []), code: r.body.details?.code };
  };

  try {
    const a = await kullanici("a", ["order:read"]);
    const b = await kullanici("b", ["order:read"]);
    const c = await kullanici("c", ["customer:read"]);
    const rec1 = randomUUID();
    const rec2 = randomUUID();
    const notMetni = `${TAG} gizli-not-${randomUUID().slice(0, 8)}`;

    console.log("\n§1 görünürlük");
    const p1 = await put(a.token, rec1, "YELLOW", null);
    check("§1a kişisel işaret yazıldı (200, mine)", p1.status === 200 && (p1.body.data?.mark as Mark | undefined)?.mine === true, `status=${p1.status}`);
    const bGorur1 = await lookup(b.token, [rec1]);
    check("§1b başkasının KİŞİSEL işareti dönmez", bGorur1.status === 200 && bGorur1.marks.length === 0, `marks=${bGorur1.marks.length}`);
    await put(a.token, rec2, null, notMetni, true);
    const bGorur2 = await lookup(b.token, [rec1, rec2]);
    const paylasilan = bGorur2.marks.find((m) => m.recordId === rec2);
    check("§1c paylaşılan işaret döner + sahibinin adı", !!paylasilan && paylasilan.mine === false && paylasilan.ownerName === a.fullName && paylasilan.note === notMetni, JSON.stringify(paylasilan ?? null));
    const bYazar = await put(b.token, rec2, "RED", null);
    const aninki = await prisma.rowMark.findUnique({ where: { userId_entityType_recordId: { userId: a.id, entityType: "order", recordId: rec2 } }, select: { note: true, color: true } });
    check("§1d başkası paylaşılanı değiştiremez (kendi satırını yazar, sahibinki aynı)", bYazar.status === 200 && aninki?.note === notMetni && aninki?.color === null);
    const bSirasi = await lookup(b.token, [rec2]);
    check("§1e kendi işaretin önce, paylaşılan sonra (ikisi de döner)", bSirasi.marks.length === 2 && bSirasi.marks[0].mine && !bSirasi.marks[1].mine);
    await prisma.user.update({ where: { id: a.id }, data: { isActive: false } });
    const pasif = await lookup(b.token, [rec2]);
    check("§1f pasif sahibin paylaşılan işareti dönmez (satır kalır)", pasif.marks.every((m) => m.mine) && (await prisma.rowMark.count({ where: { userId: a.id } })) === 2);
    await prisma.user.update({ where: { id: a.id }, data: { isActive: true } });

    console.log("\n§2 kapı");
    const cLook = await lookup(c.token, [rec1]);
    const cPut = await put(c.token, rec1, "BLUE", null);
    const cMine = await call("GET", "/api/row-marks/mine?entityType=order", c.token);
    check("§2a tür okuma izni yoksa lookup/put/mine 403", cLook.status === 403 && cPut.status === 403 && cMine.status === 403, `${cLook.status}/${cPut.status}/${cMine.status}`);
    const cCustomer = await put(c.token, rec1, "BLUE", null, false, "customer");
    check("§2b izni olan türde yazabilir (customer:read → customer)", cCustomer.status === 200);
    const bilinmez = await lookup(a.token, [rec1], "uydurmaTur");
    check("§2c tanınmayan tür 400 ROW_MARK_ENTITY_UNKNOWN", bilinmez.status === 400 && bilinmez.code === "ROW_MARK_ENTITY_UNKNOWN", `${bilinmez.status} ${bilinmez.code}`);
    const proto = await lookup(a.token, [rec1], "constructor");
    check("§2d prototip adı tür sayılmaz (400)", proto.status === 400);
    const cok = await lookup(a.token, Array.from({ length: 201 }, () => randomUUID()));
    const iki = await lookup(a.token, Array.from({ length: 200 }, () => randomUUID()));
    check("§2e 201 kimlik 400, 200 kimlik 200", cok.status === 400 && iki.status === 200, `${cok.status}/${iki.status}`);
    const uzun = await put(a.token, rec1, null, "x".repeat(501));
    const sinir = await put(a.token, randomUUID(), null, "x".repeat(500));
    check("§2f not 501 karakter 400, 500 karakter 200", uzun.status === 400 && sinir.status === 200, `${uzun.status}/${sinir.status}`);
    const renk = await put(a.token, rec1, "ORANGE", null);
    check("§2g geçersiz renk 400", renk.status === 400);

    console.log("\n§3 upsert");
    const rec3 = randomUUID();
    const [y1, y2] = await Promise.all([put(a.token, rec3, "GREEN", null), put(a.token, rec3, "BLUE", "ikinci")]);
    const satir = await prisma.rowMark.count({ where: { userId: a.id, recordId: rec3 } });
    check("§3a eşzamanlı iki PUT → ikisi 200, tek satır", y1.status === 200 && y2.status === 200 && satir === 1, `${y1.status}/${y2.status} satır=${satir}`);
    const bos = await put(a.token, rec3, null, "   ");
    check("§3b renk + not (boşluk) boş → satır silinir", bos.status === 200 && bos.body.data?.mark === null && (await prisma.rowMark.count({ where: { userId: a.id, recordId: rec3 } })) === 0);
    let ckKodu = "geçti";
    try {
      await prisma.$executeRaw`INSERT INTO row_marks (id, "userId", "entityType", "recordId", "updatedAt") VALUES (${randomUUID()}::uuid, ${a.id}::uuid, 'order', ${randomUUID()}::uuid, clock_timestamp())`;
    } catch (e) {
      ckKodu = String((e as { meta?: { code?: string }; code?: string }).meta?.code ?? (e as Error).message);
    }
    check("§3c DB CHECK boş satırı reddeder (row_marks_not_empty_chk)", /23514|row_marks_not_empty_chk/.test(ckKodu), ckKodu.slice(0, 120));

    console.log("\n§4 mine");
    const sar = await call("GET", "/api/row-marks/mine?entityType=order&color=YELLOW", a.token);
    const sarIds = (sar.body.data?.recordIds as string[]) ?? [];
    check("§4a renk süzgeci yalnız o renkteki kendi kimliklerini döner", sar.status === 200 && sarIds.length === 1 && sarIds[0] === rec1, JSON.stringify(sarIds));
    const s1 = await call("GET", "/api/row-marks/mine?entityType=order&limit=1", a.token);
    const s2 = await call("GET", `/api/row-marks/mine?entityType=order&limit=1&cursor=${String(s1.body.data?.nextCursor)}`, a.token);
    const ilk = (s1.body.data?.recordIds as string[]) ?? [];
    const ikinci = (s2.body.data?.recordIds as string[]) ?? [];
    check("§4b sayfalama: limit=1 → hasMore + farklı ikinci sayfa", s1.body.data?.hasMore === true && ilk.length === 1 && ikinci.length === 1 && ilk[0] !== ikinci[0]);

    console.log("\n§5 audit");
    const loglar = await prisma.systemLog.count({ where: { OR: [{ tableName: { in: ["RowMark", "ROW_MARK", "row_marks"] } }, { recordId: { in: [rec1, rec2, rec3] } }] } });
    const metin = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM system_logs WHERE "createdAt" > now() - interval '1 hour' AND concat_ws(' ', "newData"::text, "oldData"::text, "changes"::text) LIKE ${"%" + notMetni + "%"}`; // tz-ok: göreli pencere
    check("§5a not metni ve işaret satırı audit'e girmez", loglar === 0 && Number(metin[0]?.n ?? 0) === 0, `satır=${loglar} metin=${String(metin[0]?.n)}`);

    console.log("\n§6 liste id süzgeci (İşaretliler)");
    const adminToken = await login(admin.username, admin.password);
    // Örnek kimlik listenin KENDİ ilk satırından (ortam verisine yaslanmaz; liste boşsa kol beyanla atlanır).
    // Sipariş + cari kolu körlüğe düşmesin: damgalı bir cari + sipariş kur (iş emri/top listesi boşsa beyanla atlanır).
    const kart = (await customerService.create({ name: `${TAG} cari`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
    customerIds.push(kart.data.id);
    const siparis = await prisma.order.create({ data: { orderNumber: `${TAG}-O`, customerId: kart.data.id, orderDate: new Date() }, select: { id: true } });
    orderIds.push(siparis.id);
    const listeler = [
      { ad: "cari", yol: "/api/customers" },
      { ad: "sipariş", yol: "/api/orders" },
      { ad: "terbiye iş emri", yol: "/api/work-orders" },
      { ad: "top", yol: "/api/rolls" },
    ];
    const satirIds = (r: Resp): string[] | null => {
      const d = (r.body as { data?: Array<{ id: string }> }).data;
      return Array.isArray(d) ? d.map((x) => x.id) : null;
    };
    for (const l of listeler) {
      const yok = await call("GET", `${l.yol}?limit=5&filter[id]=${randomUUID()}`, adminToken);
      const yokIds = satirIds(yok);
      check(`§6 ${l.ad}: var olmayan kimlik → 200 + 0 satır`, yok.status === 200 && yokIds?.length === 0, `status=${yok.status} satır=${yokIds?.length ?? "?"}`);
      const ornek = satirIds(await call("GET", `${l.yol}?limit=2`, adminToken)) ?? [];
      if (ornek.length === 0) {
        atlanan++;
        console.log(`⏭  §6 ${l.ad}: liste boş — CSV kolu ölçülmedi (körlük beyanı)`);
        continue;
      }
      const var1 = satirIds(await call("GET", `${l.yol}?limit=5&filter[id]=${ornek[0]},${randomUUID()}`, adminToken)) ?? [];
      check(`§6 ${l.ad}: CSV kimlik listesi yalnız o kaydı döner`, var1.length === 1 && var1[0] === ornek[0], `satır=${var1.length}`);
    }
  } finally {
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...orderIds, ...customerIds] } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await cleanupTestCustomers(customerIds);
    await prisma.rowMark.deleteMany({ where: { userId: { in: userIds } } });
    for (const u of userIds) {
      await prisma.userPermission.deleteMany({ where: { userId: u } });
      await prisma.session.deleteMany({ where: { userId: u } }).catch(() => undefined);
      await prisma.systemLog.deleteMany({ where: { userId: u } });
      await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
    }
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===${atlanan ? ` (${atlanan} kol atlandı: boş liste)` : ""}`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
