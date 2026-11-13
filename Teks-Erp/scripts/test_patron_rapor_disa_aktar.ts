// =============================================================================
// BEKÇİ — PATRON RAPOR DOSYASI: `GET /api/patron/v1/raporlar/:id/dosya?bicim=xlsx|html` (2026-11-13)
// =============================================================================
//   §1 statik: uç toplu kapının ARKASINDA · `/auth/me` `patronReportExport` · HTML dış kaynak yüklemez
//   §2 panel ↔ backend: aynı fikstürden Excel sayfaları + HTML ALTINA bayt bayt eşit (panel tarafı
//      `Electron/src/pages/Reports/_v2/patronDisaAktarAltin.test.ts`; hangi kopya saparsa o kırmızı)
//   §3 PDF = Excel: gerçek .xlsx ile HTML'de aynı tablolar, aynı sütun, aynı satır, aynı toplam, aynı görünen metin
//   §4 kaçış: kullanıcı metni HTML'de işaretleme olamaz (script/img/olay özniteliği yok)
//   §5 uç: sahibi 200 (Content-Disposition, nosniff) · içerik = SAKLI sonuç (yeniden hesap yok) · başkasının koşumu 404 ·
//      silinmiş 404 · HATA'lı 409 · zarfsız 409 · tanınmayan/eksik biçim 400 · bozuk kimlik 400 · `dosyaBicimleri` alanı
// NEGATİF SONDA: `docs/bekci-harita/raporlar.md` satırında.
// Koşum: npx tsx scripts/run-all-tests.ts patron_rapor_disa_aktar   (kendi _test DB'si)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma"; // İLK import: dotenv.config()
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import ExcelJS from "exceljs";
import { AuthService } from "../src/services/auth.service";
import { PATRON_LOGIN_PERMISSION } from "../src/constants/permission-catalog";
import { PATRON_REPORTS } from "../src/services/patron-rapor/katalog";
import { buildExportSpec } from "../src/services/patron-rapor/disa-aktar/spec";
import { buildReportHtml, esc, toSheets } from "../src/services/patron-rapor/disa-aktar/cikti";
import { reportCellText } from "../src/services/patron-rapor/disa-aktar/sayi";
import { reconcilePermissionCatalog } from "../src/jobs/permission-catalog.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const ROOT = join(__dirname, "..", "..");
const FIX = join(__dirname, "fixtures", "patron-rapor-disa-aktar");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const fix = (f: string) => readFileSync(join(FIX, f), "utf8");
const SUNUM = JSON.parse(fix("sunum.json")) as Record<string, unknown>;
const EK = { meta: ["Oluşturuldu: 13.11.2026 10:15"], basimAni: new Date("2026-11-13T07:30:00.000Z") };

type HtmlTable = { headers: string[]; rows: string[][]; total: string[] | null };
/** HTML'deki tablo bölümleri (sırayla): başlık hücreleri, gövde satırları, toplam satırı. */
function htmlTables(html: string): HtmlTable[] {
  return [...html.matchAll(/<section class="tbl-wrap">([\s\S]*?)<\/section>/g)].map((m) => {
    const cells = (s: string, tag: string) => [...s.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((c) => c[1]!);
    const trs = [...m[1]!.matchAll(/<tr( class="tot")?>([\s\S]*?)<\/tr>/g)];
    const body = trs.slice(1);
    const tot = body.find((t) => t[1]);
    return { headers: cells(trs[0]![2]!, "th"), rows: body.filter((t) => !t[1]).map((t) => cells(t[2]!, "td")), total: tot ? cells(tot[2]!, "td") : null };
  });
}

type XlsxTable = { name: string; headers: string[]; rows: string[][]; total: string[] | null };
/** Gerçek .xlsx'ten tablo: başlık satırı = gri dolgulu satır; değer Excel'in sütun biçimiyle görünen metne çevrilir. */
async function xlsxTables(buf: Buffer): Promise<XlsxTable[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    let headerNo = 0;
    ws.eachRow((row, n) => { if (!headerNo && (row.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb === "FFEFEFEF") headerNo = n; });
    const width = ws.getRow(headerNo).cellCount;
    const text = (n: number) => Array.from({ length: width }, (_, i) => {
      const c = ws.getRow(n).getCell(i + 1);
      const fmt = ws.getColumn(i + 1).numFmt;
      return esc(typeof c.value === "number" && fmt ? reportCellText(c.value, fmt) : String(c.value ?? ""));
    });
    const rows: string[][] = [];
    let total: string[] | null = null;
    for (let n = headerNo + 1; n <= ws.rowCount; n++) {
      const row = ws.getRow(n);
      if (!row.hasValues) break;
      if (row.font?.bold) total = text(n); else rows.push(text(n));
    }
    return { name: ws.name, headers: text(headerNo), rows, total };
  });
}

async function main(): Promise<void> {
  console.log("=== §1 statik ===");
  const route = read("Teks-Erp/src/routes/patron-rapor.routes.ts");
  const gate = route.indexOf("router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION))");
  check("§1a dosya ucu toplu kapının ARKASINDA", gate > 0 && route.indexOf('router.get("/:id/dosya"') > gate);
  check("§1b /auth/me patronReportExport yayımlar", read("Teks-Erp/src/controllers/auth.controller.ts").includes("patronReportExport: PATRON_REPORT_EXPORT_VERSION"));

  console.log("\n=== §2 panel ↔ backend altını ===");
  const spec = { ...buildExportSpec(SUNUM as never), ...EK };
  const sheets = JSON.stringify(toSheets(spec), null, 2) + "\n";
  const html = buildReportHtml(spec);
  check("§2a Excel sayfaları altına eşit (panel `toSheets`)", sheets === fix("sheets.golden.json"));
  check("§2b PDF HTML'i altına bayt bayt eşit (panel `buildReportHtml`)", html === fix("html.golden.html"));
  check("§2c basım saati fabrika diliminde (07:30Z → 10:30)", html.includes("Basım: 13.11.2026 10:30"));
  check("§1c HTML dış kaynak yüklemez (etikette src/href, url(, @import, http yok)", !/<[^>]+\s(src|href)\s*=|url\(|@import|https?:\/\//i.test(html) && html.includes("onerror=alert(1)&gt;"));

  console.log("\n=== §4 kaçış ===");
  check("§4a kullanıcı metni işaretleme olamaz (<script / <img / <b> yok)", !/<script|<img|<b>/i.test(html));
  check("§4b kaçışlı metin yerinde (&lt;script&gt; · &amp; · &quot;)", html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && html.includes("Kaya &amp; Ortakları") && html.includes("&quot;Tırnaklı&quot;"));

  const block = hedefDbEngeli();
  if (block) { check("§0 hedef DB yazılabilir", false, block); return; }
  await reconcilePermissionCatalog();
  process.env.RATE_LIMIT_ENABLED = "false";
  const T = `TEST-PRD-${Date.now()}`;
  const PASS = "Deneme-patron-disa-12345";
  const userIds: string[] = [];
  const report = [...PATRON_REPORTS.values()][0]!;
  const app = (await import("../src/app")).default;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const codeOf = async (r: Response) => ((await r.json().catch(() => ({}))) as { details?: { code?: string } }).details?.code;
  const makeUser = async (tag: string) => {
    const perms = await prisma.permission.findMany({ where: { code: { in: [PATRON_LOGIN_PERMISSION, ...report.erpPermissions] } }, select: { id: true } });
    const u = await prisma.user.create({ data: { username: `${T}-${tag}`, passwordHash: await AuthService.hashPassword(PASS), fullName: `TEST patron dosya ${tag}`, permissions: { create: perms.map((p) => ({ permissionId: p.id })) } }, select: { id: true, username: true } });
    userIds.push(u.id);
    const r = await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u.username, password: PASS, clientType: "patron", confirmKick: true }) });
    const token = ((await r.json()) as { data?: { token?: string } }).data?.token;
    if (!token) throw new Error(`giriş başarısız ${tag}: ${r.status}`);
    return { id: u.id, token };
  };
  const run = (userId: string, data: { status: string; result?: unknown; errorCode?: string; deletedAt?: Date }) =>
    prisma.patronReportRun.create({
      data: { userId, reportKey: report.remote.key, params: {}, status: data.status as never, result: (data.result ?? undefined) as never, errorCode: data.errorCode ?? null, deletedAt: data.deletedAt ?? null, finishedAt: new Date("2026-11-13T07:15:00.000Z") },
      select: { id: true, updatedAt: true },
    });
  try {
    const boss = await makeUser("boss");
    const other = await makeUser("other");
    const me = await (await get("/auth/me", boss.token)).json() as { data?: { patronReportExport?: unknown } };
    check("§1d /auth/me patronReportExport = 1", me.data?.patronReportExport === 1);
    const stored = { ...SUNUM, baslik: `${T} Saklı başlık` };
    const ok = await run(boss.id, { status: "HAZIR", result: stored });
    const failed = await run(boss.id, { status: "HATA", errorCode: "ZAMAN_ASIMI" });
    const raw = await run(boss.id, { status: "HAZIR", result: { satirlar: [1, 2, 3] } });
    const gone = await run(boss.id, { status: "HAZIR", result: stored, deletedAt: new Date() });

    console.log("\n=== §5 uç ===");
    const detail = await (await get(`/patron/v1/raporlar/${ok.id}`, boss.token)).json() as { data?: { dosyaBicimleri?: string[] } };
    const rawDetail = await (await get(`/patron/v1/raporlar/${raw.id}`, boss.token)).json() as { data?: { dosyaBicimleri?: string[] } };
    check("§5a detay dosyaBicimleri: zarflı [xlsx,html] · zarfsız []", detail.data?.dosyaBicimleri?.join() === "xlsx,html" && rawDetail.data?.dosyaBicimleri?.length === 0);
    const x = await get(`/patron/v1/raporlar/${ok.id}/dosya?bicim=xlsx`, boss.token);
    const xbuf = Buffer.from(await x.arrayBuffer());
    check("§5b xlsx 200 + ek adı + nosniff + no-store", x.status === 200 && /^attachment; filename="[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.xlsx"$/.test(x.headers.get("content-disposition") ?? "") && x.headers.get("x-content-type-options") === "nosniff" && x.headers.get("cache-control") === "no-store", `${x.status} ${x.headers.get("content-disposition")}`);
    const h = await get(`/patron/v1/raporlar/${ok.id}/dosya?bicim=html`, boss.token);
    const htmlOut = await h.text();
    check("§5c html 200 text/html utf-8", h.status === 200 && (h.headers.get("content-type") ?? "").startsWith("text/html") && htmlOut.startsWith("<!doctype html>"));
    const xt = await xlsxTables(xbuf);
    check("§5d içerik = SAKLI sonuç (saklı başlık iki dosyada da)", htmlOut.includes(`<h1>${T} Saklı başlık</h1>`) && xbuf.length > 0 && xt.length > 0);
    const after = await prisma.patronReportRun.findUnique({ where: { id: ok.id }, select: { updatedAt: true } });
    const count = await prisma.patronReportRun.count({ where: { userId: boss.id } });
    check("§5e yeniden hesap yok (satır değişmedi, yeni koşum doğmadı)", after?.updatedAt.getTime() === ok.updatedAt.getTime() && count === 4);

    console.log("\n=== §3 PDF = Excel (gerçek dosyalar) ===");
    const ht = htmlTables(htmlOut);
    const data = xt.slice(1); // "Özet" sayfası HTML'de kart/anlatı/tanım bloklarıdır
    check("§3a tablo sayısı eşit (grafik verisi + varyant + dönem + tablo)", data.length === ht.length && ht.length === 4, `${data.length}/${ht.length}`);
    data.forEach((s, i) => {
      const t = ht[i];
      check(`§3b[${s.name}] sütunlar eşit`, !!t && s.headers.join("|") === t.headers.join("|"), `${s.headers.join("|")} ↔ ${t?.headers.join("|")}`);
      check(`§3c[${s.name}] satırlar ve görünen metin eşit`, !!t && JSON.stringify(s.rows) === JSON.stringify(t.rows), `${JSON.stringify(s.rows).slice(0, 160)} ↔ ${JSON.stringify(t?.rows).slice(0, 160)}`);
      check(`§3d[${s.name}] toplam eşit`, !!t && JSON.stringify(s.total) === JSON.stringify(t.total));
    });
    const ozet = xt[0]!;
    check("§3e Özet sayfası kartları HTML'deki metinle (ana sayı + kıyas)", ozet.name === "Özet" && ozet.rows.some((r) => r[0] === "Ana sayı" && htmlOut.includes(`<div class="kart-deger">${r[2]}</div>`) && htmlOut.includes(r[3]!)));
    const tablo = data.find((s) => s.name === "Tablo");
    check("§3f para kolonu binlikli 2 hane, ölçü ayırıcısız (325.684,90 · 1200,6)", !!tablo?.rows[0]?.includes("325.684,90") && !!tablo.rows[0]?.includes("1200,6"));

    const cBoss = await get(`/patron/v1/raporlar/${ok.id}/dosya?bicim=xlsx`, other.token);
    check("§5f başkasının koşumu 404", cBoss.status === 404 && (await codeOf(cBoss)) === "RAPOR_KOSUMU_YOK");
    const cGone = await get(`/patron/v1/raporlar/${gone.id}/dosya?bicim=xlsx`, boss.token);
    check("§5g silinmiş koşum 404", cGone.status === 404);
    const cFail = await get(`/patron/v1/raporlar/${failed.id}/dosya?bicim=html`, boss.token);
    check("§5h HATA'lı koşum 409 DISA_AKTARILAMAZ", cFail.status === 409 && (await codeOf(cFail)) === "DISA_AKTARILAMAZ");
    const cRaw = await get(`/patron/v1/raporlar/${raw.id}/dosya?bicim=xlsx`, boss.token);
    check("§5i zarfsız sonuç 409 DISA_AKTARILAMAZ", cRaw.status === 409 && (await codeOf(cRaw)) === "DISA_AKTARILAMAZ");
    for (const q of ["?bicim=pdf", "?bicim=XLSX", "", "?bicim=xlsx&bicim=html"]) {
      const r = await get(`/patron/v1/raporlar/${ok.id}/dosya${q}`, boss.token);
      check(`§5j biçim "${q || "(yok)"}" 400 PATRON_RAPOR_BICIM`, r.status === 400 && (await codeOf(r)) === "PATRON_RAPOR_BICIM", String(r.status));
    }
    const cId = await get(`/patron/v1/raporlar/bozuk/dosya?bicim=xlsx`, boss.token);
    check("§5k bozuk kimlik 400", cId.status === 400);
    const cAnon = await fetch(`${base}/patron/v1/raporlar/${ok.id}/dosya?bicim=xlsx`);
    check("§5l oturumsuz 401", cAnon.status === 401);
  } finally {
    await prisma.patronReportRun.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.updateMany({ where: { userId: { in: userIds } }, data: { revokedAt: new Date() } });
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { isActive: false } });
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

main()
  .catch((e) => { check("beklenmeyen hata", false, String((e as Error)?.stack ?? e)); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
