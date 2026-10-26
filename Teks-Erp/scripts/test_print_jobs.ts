// =============================================================================
// BEKÇİ — YAZDIRMA GEÇMİŞİ (`print_jobs`) — izlenebilirlik A1
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts print_jobs
//
// NEDEN: kullanıcı "yazıcıdan kimin ne çıkardığını, varsa hatayı görmek" istedi. Satırı yalnız
//   `print-job.service` yazar; tablo TELEMETRİDİR (hiçbir karar okumaz — iptal guard'ı
//   `labelPrintedAt` okur). Bu bekçi tek yazarı, replay'i, liste↔özet tek where'ini, budamanın
//   yalnız yaş yüklemini ve toplu etiket damgasını ölçer.
//
// NE ÖLÇER (HTTP — gerçek app, gerçek zod, gerçek yetki):
//   §1 replay: aynı token + aynı gövde → tek satır; farklı gövde → 409; eşzamanlı ikili → tek satır
//   §2 bilinmeyen tür → 400 PRINT_SUBJECT_UNKNOWN; HATA'da errorCode zorunlu; yok kayıt → 400
//   §3 userId token'dan; gövdedeki userId yok sayılır
//   §4 liste ve özet aynı where (süzgeçli sayım = liste uzunluğu); izinsiz kullanıcı 403
//   §5 budama yalnız yaş (genç satır kalır, 0 = budama yok)
//   §6 SIMULE ≠ ILETILDI (özet başarı saymaz); sunucu test gönderimi SIMULE satırı doğurur;
//      gönderim hatası sınıflı errorCode'a iner
//   §7 KIMLIK_KARTI meta düşer
//   §8 toplu damga: 3 top → hepsi labelPrintedAt dolu + labelDirty=false, tek job, 3 audit; yok id 400
//   §9 eski gövdeyle /rolls/:id/print → audit + damga bugünkü gibi + ILETILDI satırı (transport NULL)
//   §10 AST: `printJob` delegesi ve `print_jobs` ham SQL'i yalnız print-job.service.ts'te
//   §11 telemetri yazım hatası iş yanıtını değiştirmez (enjekte hata; sayaç artar)
//   §12 çeki listesi basımı printJob'suz → BELIRSIZ; ekli → ILETILDI
//   §13 belge baskısı `printedDocumentId` taşır → `?subjectId=<belge>` listede VE özette (tek where)
//
// NEGATİF SONDALAR (2026-10-24, ölçüldü; md5 ile geri yüklendi):
//   (a) §4 — `summarizePrintJobs` toplamı `where` yerine `{}` ile sayınca: §4b + §4c = 2 KIRMIZI
//   (b) §8 — `stampRollLabelPrinted`tan updateMany çıkarılınca: §8b + §9b = 2 KIRMIZI
//   (c) §10 — `label.service.ts`e `prisma.printJob.findMany` eklenince: §10b = 1 KIRMIZI
//   (d) §13 — süzgeç OR'undan `printedDocumentId` çıkarılınca: §13a + §13b = 2 KIRMIZI (2026-10-25)
// =============================================================================
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import ts from "typescript";
import * as bcrypt from "bcryptjs";
import { RollEntrySource, RollStatus } from "@prisma/client";
import app from "../src/app";
import prisma from "../src/lib/prisma";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import {
  getPrintJobHealth,
  outcomeFromTransport,
  prunePrintJobs,
  setPrintJobWriteFaultForTest,
} from "../src/services/print-job.service";
import { resetPrintJobRateForTest } from "../src/controllers/print-job.controller";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-PJ${Date.now().toString(36).slice(-5).toUpperCase()}`;
const olusan = { rollIds: [] as string[], userIds: [] as string[], itemId: null as string | null, cariIds: [] as string[], sackIds: [] as string[], manifestIds: [] as string[] };

type Resp = { status: number; body: { data?: Record<string, unknown>; details?: Record<string, unknown>; message?: string } & Record<string, unknown> };

// ─── §10 AST taraması (DB'siz) ─────────────────────────────────────────────
const SRC = path.resolve(__dirname, "../src");
const OWNER = path.join("services", "print-job.service.ts");
const DELEGATE_METHODS = new Set([
  "create", "createMany", "createManyAndReturn", "findMany", "findFirst", "findFirstOrThrow", "findUnique",
  "findUniqueOrThrow", "update", "updateMany", "upsert", "delete", "deleteMany", "count", "groupBy", "aggregate",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** `X.printJob.<delege metodu>` erişimleri + `print_jobs` geçen ham SQL dizgeleri (yorum değil). */
export function findPrintJobAccess(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === "printJob" && ts.isPropertyAccessExpression(node.parent)
      && DELEGATE_METHODS.has(node.parent.name.text)) {
      hits.push(`${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} .printJob.${node.parent.name.text}`);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && /\bprint_jobs\b/.test(node.text)) {
      hits.push(`${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} "print_jobs"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function section10(): void {
  const offenders: string[] = [];
  let ownerHits = 0;
  for (const f of walk(SRC)) {
    const hits = findPrintJobAccess(f, readFileSync(f, "utf8"));
    if (path.relative(SRC, f) === OWNER) ownerHits += hits.length;
    else offenders.push(...hits);
  }
  check("§10a sahip dosya delegeyi gerçekten kullanıyor (tarayıcı kör değil)", ownerHits >= 5, `isabet=${ownerHits}`);
  check("§10b ⭐ printJob delegesi / print_jobs ham SQL'i yalnız print-job.service.ts'te", offenders.length === 0, offenders.join(" · "));
  const probe = findPrintJobAccess("probe.ts", "async function x(){ await prisma.printJob.findMany({}); await db.$queryRawUnsafe('SELECT 1 FROM print_jobs'); const a = body.printJob; }");
  check("§10c tarayıcı sondası: delege + ham SQL yakalanır, gövde alanı (`body.printJob`) yakalanmaz", probe.length === 2, probe.join(" · "));
}

async function main() {
  section10();

  const server: Server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", "X-Client-Kind": "electron", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Resp["body"] };
  };
  const login = async (username: string, password: string) =>
    String((await call("POST", "/api/auth/login", "", { username, password, clientType: "electron" })).body.data?.token ?? "");
  const jobsOf = (where: Record<string, unknown>) =>
    // Bekçi okuması: sahiplik kuralı src/ içindir; bekçi satırı doğrudan sayar.
    prisma.printJob.findMany({ where, orderBy: { createdAt: "asc" } });

  try {
    resetPrintJobRateForTest();
    const admin = await ensureTestAdmin();
    const adminToken = await login(admin.username, admin.password);
    check("admin login", adminToken.length > 20);

    const parola = kosumaOzguParola();
    const labelPrint = await prisma.permission.findFirstOrThrow({ where: { code: "label:print" }, select: { id: true } });
    const dar = await prisma.user.create({
      data: {
        username: `${TAG}-dar`.toLowerCase(),
        passwordHash: await bcrypt.hash(parola, 10),
        fullName: `${TAG} Etiketçi`,
        isActive: true,
        permissions: { create: { permissionId: labelPrint.id, grantedById: admin.id } },
      },
      select: { id: true, username: true },
    });
    olusan.userIds.push(dar.id);
    const darToken = await login(dar.username, parola);
    check("dar kullanıcı login", darToken.length > 20);

    const item = await prisma.item.create({ data: { code: `${TAG}-ITM`, name: `${TAG} KUMAS`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
    olusan.itemId = item.id;
    const makeRoll = async (dirty: boolean) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `${TAG}-${olusan.rollIds.length + 1}`, itemId: item.id, width: 150, initialQty: 100, currentQty: 100,
          status: RollStatus.WAREHOUSE, entrySource: RollEntrySource.SUPPLIER_RECEIPT,
          labelPrintedAt: null, labelDirty: dirty,
        },
        select: { id: true },
      });
      olusan.rollIds.push(r.id);
      return r.id;
    };

    // §1 — replay
    const subj = await makeRoll(false);
    const report = (over: Record<string, unknown> = {}) => ({
      clientToken: randomUUID(), subjectKind: "ETIKET_TOP", status: "ILETILDI", subjectTable: "rolls", subjectId: subj,
      transport: "SERI", printerName: `${TAG}-YAZICI`, ...over,
    });
    const b1 = report();
    const r1 = await call("POST", "/api/print-jobs", darToken, b1);
    const r1b = await call("POST", "/api/print-jobs", darToken, b1);
    const rows1 = await jobsOf({ clientToken: b1.clientToken });
    check("§1a ilk bildirim 201", r1.status === 201, `status=${r1.status} ${r1.body.message ?? ""}`);
    check("§1b ⭐ aynı token + aynı gövde → TEK satır, aynı kayıt döner", rows1.length === 1 && r1b.status < 300 && r1b.body.id === r1.body.id, `satır=${rows1.length} status=${r1b.status}`);
    const r1c = await call("POST", "/api/print-jobs", darToken, { ...b1, status: "HATA", errorCode: "KAGIT_YOK" });
    check("§1c ⭐ aynı token + farklı gövde → 409", r1c.status === 409, `status=${r1c.status}`);
    const b1d = report();
    const [p1, p2] = await Promise.all([call("POST", "/api/print-jobs", darToken, b1d), call("POST", "/api/print-jobs", darToken, b1d)]);
    check("§1d eşzamanlı aynı token → tek satır", (await jobsOf({ clientToken: b1d.clientToken })).length === 1 && p1.status < 300 && p2.status < 300, `${p1.status}/${p2.status}`);
    const tokensiz = await call("POST", "/api/print-jobs", darToken, { subjectKind: "ETIKET_TOP", status: "ILETILDI" });
    check("§1e token'sız bildirim 400", tokensiz.status === 400, `status=${tokensiz.status}`);

    // §2 — fail-closed
    const r2 = await call("POST", "/api/print-jobs", darToken, report({ subjectKind: "UYDURMA_TUR" }));
    check("§2a ⭐ bilinmeyen tür 400 PRINT_SUBJECT_UNKNOWN", r2.status === 400 && r2.body.details?.code === "PRINT_SUBJECT_UNKNOWN", `status=${r2.status} code=${String(r2.body.details?.code)}`);
    const r2b = await call("POST", "/api/print-jobs", darToken, report({ status: "HATA" }));
    check("§2b HATA'da errorCode yoksa 400", r2b.status === 400, `status=${r2b.status}`);
    const r2c = await call("POST", "/api/print-jobs", darToken, report({ subjectId: randomUUID() }));
    check("§2c olmayan kayıt 400 PRINT_SUBJECT_NOT_FOUND", r2c.status === 400 && r2c.body.details?.code === "PRINT_SUBJECT_NOT_FOUND", `status=${r2c.status}`);
    const r2d = await call("POST", "/api/print-jobs", darToken, report({ subjectTable: "users_secret" }));
    check("§2d tanınmayan tablo 400", r2d.status === 400 && r2d.body.details?.code === "PRINT_SUBJECT_TABLE_UNKNOWN", `status=${r2d.status}`);

    // §3 — kullanıcı token'dan
    const b3 = { ...report(), userId: admin.id };
    const r3 = await call("POST", "/api/print-jobs", darToken, b3);
    const row3 = (await jobsOf({ clientToken: b3.clientToken }))[0];
    check("§3 ⭐ satırın kullanıcısı token'dan (gövdedeki userId yok sayıldı)", r3.status === 201 && row3?.userId === dar.id, `userId=${row3?.userId}`);
    check("§3b kaynak başlıktan (X-Client-Kind electron → PANEL_MASAUSTU)", row3?.source === "PANEL_MASAUSTU", String(row3?.source));

    // §6 — SIMULE başarı sayılmaz (önce iki satır daha: HATA + SIMULE)
    await call("POST", "/api/print-jobs", darToken, report({ status: "HATA", errorCode: "KAGIT_YOK", errorMessage: "Kağıt bitti" }));
    await call("POST", "/api/print-jobs", darToken, report({ status: "SIMULE" }));

    // §4 — liste ve özet aynı where; izinsiz 403
    const q = `/api/print-jobs?subjectId=${subj}&ozet=1&limit=200`;
    const r4 = await call("GET", q, adminToken);
    const data4 = (r4.body.data as unknown as unknown[]) ?? [];
    const ozet = r4.body.ozet as { toplam: number; durum: Record<string, number>; basarili: number; enCokHata: { printerName: string | null } | null } | undefined;
    check("§4a liste 200", r4.status === 200 && Array.isArray(data4), `status=${r4.status}`);
    check("§4b ⭐ özet toplamı = süzgeçli liste uzunluğu (tek where)", !!ozet && ozet.toplam === data4.length && data4.length === 5, `toplam=${ozet?.toplam} liste=${data4.length}`);
    const r4s = await call("GET", `/api/print-jobs?subjectId=${subj}&status=HATA&ozet=1`, adminToken);
    const ozetS = r4s.body.ozet as { toplam: number } | undefined;
    check("§4c durum süzgeci özette de uygulanır", ozetS?.toplam === ((r4s.body.data as unknown as unknown[]) ?? []).length && ozetS?.toplam === 1, `toplam=${ozetS?.toplam}`);
    check("§4d en çok hata veren yazıcı özetlenir", ozet?.enCokHata?.printerName === `${TAG}-YAZICI`, String(ozet?.enCokHata?.printerName));
    const r4x = await call("GET", "/api/print-jobs", darToken);
    check("§4e ⭐ izinsiz kullanıcı listede 403", r4x.status === 403, `status=${r4x.status}`);
    const r4y = await call("GET", `/api/print-jobs/${row3?.id}`, darToken);
    check("§4f izinsiz kullanıcı tekil kayıtta 403", r4y.status === 403, `status=${r4y.status}`);
    const r4z = await call("GET", "/api/print-jobs?status=UYDURMA", adminToken);
    check("§4g tanınmayan süzgeç değeri 400", r4z.status === 400, `status=${r4z.status}`);
    check("§6a ⭐ SIMULE başarı sayılmaz (basarili = yalnız ILETILDI)", !!ozet && ozet.basarili === ozet.durum.ILETILDI && ozet.durum.SIMULE >= 1 && ozet.basarili < ozet.toplam - ozet.durum.HATA, JSON.stringify(ozet?.durum));
    const r6 = await call("POST", "/api/labels/test-native", adminToken, { printerIp: "127.0.0.1", port: 9 });
    const row6 = (await jobsOf({ subjectKind: "TEST", userId: admin.id })).pop();
    check("§6b sunucu test gönderimi (nativeSend kapalı) → SIMULE + SUNUCU_TCP", r6.status === 200 && row6?.status === "SIMULE" && row6?.transport === "SUNUCU_TCP" && row6?.source === "SUNUCU", `status=${r6.status} satır=${row6?.status}`);
    const o1 = outcomeFromTransport({ delivered: false, simulated: false, error: "Cihaz bağlantısı zaman aşımı" });
    const o2 = outcomeFromTransport({ delivered: false, simulated: false, error: "connect ECONNREFUSED 10.0.0.9:9100" });
    const o3 = outcomeFromTransport({ delivered: true, simulated: false });
    check("§6c gönderim hatası sınıflı koda iner (ZAMAN_ASIMI · BAGLANTI_REDDEDILDI · ILETILDI)", o1.status === "HATA" && o1.errorCode === "ZAMAN_ASIMI" && o2.errorCode === "BAGLANTI_REDDEDILDI" && o3.status === "ILETILDI");

    // §7 — KIMLIK_KARTI meta düşer
    const b7 = report({ subjectKind: "KIMLIK_KARTI", subjectTable: "users", subjectId: dar.id, meta: { pin: "0000", kart: "SIR" } });
    const r7 = await call("POST", "/api/print-jobs", adminToken, b7);
    const row7 = (await jobsOf({ clientToken: b7.clientToken }))[0];
    check("§7 ⭐ KIMLIK_KARTI satırında meta YOK", r7.status === 201 && row7 != null && row7.meta == null, JSON.stringify(row7?.meta));

    // §5 — budama yalnız yaş
    const young = (await jobsOf({ clientToken: b1.clientToken }))[0]!;
    const oldJob = (await jobsOf({ clientToken: b3.clientToken }))[0]!;
    await prisma.printJob.update({ where: { id: oldJob.id }, data: { createdAt: new Date(Date.now() - 200 * 86_400_000) } });
    const none = await prunePrintJobs(new Date(), 0);
    check("§5a 0 gün = budama yok", none.deleted === 0 && none.cutoff === null);
    await prunePrintJobs(new Date(), 180);
    const youngLeft = await prisma.printJob.count({ where: { id: young.id } });
    const oldLeft = await prisma.printJob.count({ where: { id: oldJob.id } });
    check("§5b ⭐ 180 günden eski satır budandı, genç satır kaldı", oldLeft === 0 && youngLeft === 1, `eski=${oldLeft} genç=${youngLeft}`);

    // §8 — toplu damga
    const bulk = [await makeRoll(true), await makeRoll(true), await makeRoll(false)];
    const auditBefore = await prisma.systemLog.count({ where: { tableName: "LABEL_PRINT_EVENT", recordId: { in: bulk } } });
    const tok8 = randomUUID();
    const r8 = await call("POST", "/api/labels/rolls/bulk-print-event", adminToken, { rollIds: bulk, printJob: { clientToken: tok8, transport: "SISTEM_PENCERESI", printerName: `${TAG}-A4` } });
    const rolls8 = await prisma.roll.findMany({ where: { id: { in: bulk } }, select: { labelPrintedAt: true, labelDirty: true } });
    const jobs8 = await jobsOf({ clientToken: tok8 });
    const auditAfter = await prisma.systemLog.count({ where: { tableName: "LABEL_PRINT_EVENT", recordId: { in: bulk } } });
    check("§8a toplu uç 200", r8.status === 200, `status=${r8.status} ${r8.body.message ?? ""}`);
    check("§8b ⭐ üç topun hepsi damgalı (labelPrintedAt dolu, labelDirty=false)", rolls8.length === 3 && rolls8.every((r) => r.labelPrintedAt != null && r.labelDirty === false));
    check("§8c ⭐ TEK ETIKET_TOPLU satırı, subjectIds = 3 top, itemCount 3", jobs8.length === 1 && jobs8[0]!.subjectKind === "ETIKET_TOPLU" && jobs8[0]!.subjectIds.length === 3 && jobs8[0]!.itemCount === 3);
    check("§8d top başına audit (3)", auditAfter - auditBefore === 3, `fark=${auditAfter - auditBefore}`);
    const r8x = await call("POST", "/api/labels/rolls/bulk-print-event", adminToken, { rollIds: [bulk[0], randomUUID()] });
    const missing = r8x.body.details?.missing as unknown[] | undefined;
    check("§8e var olmayan id → 400 ve hangisi olduğu listelenir", r8x.status === 400 && Array.isArray(missing) && missing.length === 1, `status=${r8x.status}`);

    // §9 — eski gövde (printJob yok)
    const old9 = await makeRoll(true);
    const auditBefore9 = await prisma.systemLog.count({ where: { tableName: "LABEL_PRINT_EVENT", recordId: old9 } });
    const r9 = await call("POST", `/api/labels/rolls/${old9}/print`, adminToken, { stock: true });
    const roll9 = await prisma.roll.findUnique({ where: { id: old9 }, select: { labelPrintedAt: true, labelDirty: true } });
    const jobs9 = await jobsOf({ subjectId: old9, subjectKind: "ETIKET_TOP" });
    const auditAfter9 = await prisma.systemLog.count({ where: { tableName: "LABEL_PRINT_EVENT", recordId: old9 } });
    check("§9a eski gövde 200 + yanıt bayt-eşit ({recorded:true})", r9.status === 200 && JSON.stringify(r9.body.data) === JSON.stringify({ recorded: true }), `status=${r9.status}`);
    check("§9b ⭐ damga bugünkü gibi (labelPrintedAt dolu, labelDirty=false) + audit 1", roll9?.labelPrintedAt != null && roll9.labelDirty === false && auditAfter9 - auditBefore9 === 1);
    check("§9c ⭐ ILETILDI satırı doğdu, transport NULL, isReprint=false", jobs9.length === 1 && jobs9[0]!.status === "ILETILDI" && jobs9[0]!.transport === null && jobs9[0]!.isReprint === false, `satır=${jobs9.length}`);

    // §11 — enjekte telemetri hatası iş yanıtını değiştirmez
    const h0 = getPrintJobHealth();
    setPrintJobWriteFaultForTest(new Error("enjekte: print_jobs yazılamadı"));
    const r11 = await call("POST", `/api/labels/rolls/${old9}/print`, adminToken, {});
    setPrintJobWriteFaultForTest(null);
    const jobs11 = await jobsOf({ subjectId: old9, subjectKind: "ETIKET_TOP" });
    check("§11a ⭐ telemetri düştü ama iş yanıtı 200", r11.status === 200 && JSON.stringify(r11.body.data) === JSON.stringify({ recorded: true }), `status=${r11.status}`);
    check("§11b satır yazılmadı, düşüş sayacı arttı", jobs11.length === 1 && getPrintJobHealth().dusen === h0.dusen + 1, `satır=${jobs11.length}`);

    // §12 — çeki listesi: künyesiz BELIRSIZ, künyeli ILETILDI
    const cari = await call("POST", "/api/customers", adminToken, { name: `${TAG} Cari`, isCustomerRole: true, defaultDestination: "DOMESTIC" });
    const cariId = String(cari.body.data?.id ?? "");
    olusan.cariIds.push(cariId);
    const sack = await call("POST", "/api/shipping/sacks", adminToken, { customerId: cariId, clientToken: randomUUID() });
    const sackId = String(sack.body.data?.id ?? "");
    olusan.sackIds.push(sackId);
    const pl1 = await call("POST", "/api/shipping/sack-search/pick-list/print", adminToken, { sackIds: [sackId], clientToken: randomUUID() });
    const manifestId = String(pl1.body.data?.id ?? "");
    olusan.manifestIds.push(manifestId);
    const pjTok = randomUUID();
    const pl2 = await call("POST", "/api/shipping/sack-search/pick-list/print", adminToken, { sackIds: [sackId], clientToken: randomUUID(), printJob: { clientToken: pjTok, transport: "SISTEM_PENCERESI" } });
    const jobs12 = await jobsOf({ subjectId: manifestId, subjectKind: "CEKI_LISTESI" });
    check("§12a çeki listesi basımı 201/200", pl1.status === 201 && pl2.status === 200, `${pl1.status}/${pl2.status}`);
    check("§12b ⭐ künyesiz basım BELIRSIZ, künyeli yeniden basım ILETILDI + isReprint", jobs12.length === 2 && jobs12[0]!.status === "BELIRSIZ" && jobs12[1]!.status === "ILETILDI" && jobs12[1]!.isReprint === true && jobs12[1]!.clientToken === pjTok, jobs12.map((j) => j.status).join(","));

    // §13 — belge baskısı belge kimliğiyle bulunur (belge detayı > Baskı geçmişi)
    const docId = randomUUID();
    const topSay = async () => ((await call("GET", `/api/print-jobs?subjectId=${subj}&limit=200`, adminToken)).body.data as unknown as unknown[] ?? []).length;
    const topOnce = await topSay();
    const r13 = await call("POST", "/api/print-jobs", darToken, report({ subjectKind: "BELGE", subjectTable: undefined, subjectId: undefined, printedDocumentId: docId, docVersion: 1 }));
    const r13l = await call("GET", `/api/print-jobs?subjectId=${docId}&ozet=1`, adminToken);
    const data13 = (r13l.body.data as unknown as Array<{ printedDocumentId: string | null }>) ?? [];
    const ozet13 = r13l.body.ozet as { toplam: number } | undefined;
    check("§13a ⭐ belge kimliğiyle süzgeç belge baskısını listeler", r13.status === 201 && r13l.status === 200 && data13.length === 1 && data13[0]!.printedDocumentId === docId, `post=${r13.status} get=${r13l.status} liste=${data13.length}`);
    check("§13b özet şeridi aynı where'den (toplam = 1)", ozet13?.toplam === 1, `toplam=${ozet13?.toplam}`);
    const topSonra = await topSay();
    check("§13c top süzgeci belge satırını içermez (OR yalnız aynı kimliği eşler)", topSonra === topOnce && topOnce > 0, `önce=${topOnce} sonra=${topSonra}`);
    await server.close();
  } catch (e) {
    console.error("\n💥 ÇÖKTÜ:", e instanceof Error ? e.stack : e);
    fail++;
    server.close();
  }
}

async function temizlik(): Promise<void> {
  const adim = async (_ad: string, f: () => Promise<unknown>) => { await f().catch(() => undefined); };
  await adim("basım satırları (bekçinin yarattıkları)", () => prisma.printJob.deleteMany({ where: { OR: [{ userId: { in: olusan.userIds } }, { subjectId: { in: [...olusan.rollIds, ...olusan.manifestIds] } }, { subjectIds: { hasSome: olusan.rollIds } }, { printerName: { startsWith: TAG } }] } }));
  await adim("çeki listeleri", () => prisma.manifest.deleteMany({ where: { id: { in: olusan.manifestIds.filter(Boolean) } } }));
  await adim("çuvallar", () => prisma.sack.deleteMany({ where: { id: { in: olusan.sackIds.filter(Boolean) } } }));
  await adim("cariler", () => cleanupTestCustomers(olusan.cariIds.filter(Boolean)));
  if (olusan.rollIds.length) {
    await adim("top varyans", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: olusan.rollIds } } }));
    await adim("top hareket", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: olusan.rollIds } } }));
    await adim("top operasyon", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: olusan.rollIds } } }));
    await adim("toplar", () => prisma.roll.deleteMany({ where: { id: { in: olusan.rollIds } } }));
  }
  if (olusan.itemId) await adim("ürün", () => prisma.item.deleteMany({ where: { id: olusan.itemId! } }));
  for (const id of olusan.userIds) {
    await adim("oturum", () => prisma.session.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı logları", () => prisma.systemLog.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı izinleri", () => prisma.userPermission.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı", () => prisma.user.delete({ where: { id } }));
  }
}

main()
  .catch((e) => { console.error(e); fail++; })
  .finally(async () => {
    await temizlik();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
