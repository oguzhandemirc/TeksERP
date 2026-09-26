// =============================================================================
// GÜZERGÂH · IE — iş emri hareket defteri paketi (2.11.0 · D2 · D3 · D4 · D7 · D8)
// =============================================================================
//   IE1 HAZIRLIK (API): iki iç adımlı iş emri (2 top) + fason adımlı iş emri, iki partiyle (quick-start + Parti Ekle ucu)
//   IE2 D2 Rengi Değiştir (yan panel) → FIELD_CHANGED targetColorId, sebep
//   IE3 D2 Eni Değiştir (yan panel) → en 185, FIELD_CHANGED width
//   IE4 B13 Parti Ekle (yan panel → Top Seç → Ham Stok → Ekle (1) → Parti Ekle (1)) → yeni parti, BATCH_ADDED
//   IE5 D1 Hareketler (yan panel) → açılış · renk · en · "Parti eklendi" satırları
//   IE6 D2 Operasyon → İş Emri Hareketleri → top barkodu → Excel sütunları ekrandakiyle aynı
//   IE7 D7 geçmiş doldurma (kuru → --apply) + D3 tamamlanmış iş emri detayında "Kapanışta (yaklaşık …)"; Parti Ekle tuşu YOK
//   IE8 B14 fason adımında Sevk Et → iki partiden → 409 MULTI_BATCH → "Birden çok parti" (Ayrı sevk seçili) → iki sevk
// D6 Top Çıkar panelde yüzeyi olmadığı için (yalnız tablet) burada koşmaz.
// =============================================================================
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_KOK = path.resolve(BURASI, "../../../Teks-Erp");
const ExcelJS = createRequire(import.meta.url)("exceljs");
// Ara kanıt görüntüleri (diyalog açıkken) — sürücünün adım sonu görüntüsüne ek; yalnız E2E_KANIT_DIZINI verilirse.
const KANIT = process.env.E2E_KANIT_DIZINI ?? null;
async function kanit(page, ad) {
  if (!KANIT) return;
  fs.mkdirSync(KANIT, { recursive: true });
  await page().screenshot({ path: path.join(KANIT, `${ad}.png`) }).catch(() => undefined);
}

const olc = {
  kumas: null, toplar: [], anaIe: null, fasonIe: null, renk: null,
  hareketMetni: "", excelBaslik: null, ekranBaslik: null, excelSatir: 0,
  kapaliIe: null, kunyeMetni: null, partiEkleTusu: null, onay: null, backfillCikis: null,
};

async function iseGit({ git, gor, page }, ie, { tamamlanan = false } = {}) {
  await git("İş Emirleri");
  if (tamamlanan) {
    // Tamamlanmış iş emirleri varsayılan gizli — insan yolu: araç çubuğundaki "Tamamlananları göster".
    const kutu = page().getByText("Tamamlananları göster", { exact: true }).filter({ visible: true }).first();
    const secili = await kutu.locator("xpath=..").getByRole("checkbox").first().getAttribute("data-state").catch(() => null);
    if (secili !== "checked") { await kutu.click({ timeout: 10_000 }); await page().waitForTimeout(1200); }
  }
  const ara = page().getByPlaceholder(/ara/i).filter({ visible: true }).first();
  await ara.fill(ie.no);
  await page().waitForTimeout(1200);
  const satir = page().getByRole("row").filter({ hasText: ie.no }).filter({ visible: true }).first();
  await gor(satir, { sure: 20_000 });
  await satir.click({ timeout: 15_000 });
  await page().waitForTimeout(1200);
}

async function hedefDegistir(ctx, dugme, baslik, doldur) {
  const { page, gor } = ctx;
  await iseGit(ctx, olc.anaIe);
  await page().getByRole("button", { name: dugme }).filter({ visible: true }).first().click({ timeout: 15_000 });
  // Başlıkla seçilir: yan panel de role=dialog ve iş emri numarasını taşır.
  const d = page().getByRole("dialog").filter({ hasText: baslik }).last();
  await gor(d);
  await doldur(d);
  await d.locator("#change-reason").fill("E2E düzeltme");
  await kanit(page, `${baslik.startsWith("Eni") ? "IE3" : "IE2"}-diyalog`);
  await d.getByRole("button", { name: "Değiştir", exact: true }).click({ timeout: 15_000 });
  await d.waitFor({ state: "detached", timeout: 20_000 });
  await page().waitForTimeout(800);
  await page().keyboard.press("Escape");
}

export const IS_EMRI_ADIMLARI = [
  {
    id: "IE1", rol: "P",
    yol: "HAZIRLIK (API): Hızlı İş Emri ile iç rotalı iş emri (2 top) + zımpara fasonlu iş emri (1 top) + Parti Ekle ucuyla ikinci parti", rota: "operations/work-orders",
    async yap({ api, sql }) {
      const [k] = await sql(`SELECT i.id FROM rolls r JOIN items i ON i.id=r."itemId" WHERE r.status='STOCK' AND r."sackId" IS NULL AND r."shipmentId" IS NULL AND r."currentStepId" IS NULL AND r.barcode IS NOT NULL AND i."lifecycleStatus"='ACTIVE' GROUP BY i.id ORDER BY count(*) DESC LIMIT 1`);
      olc.kumas = k.id;
      olc.toplar = (await sql(`SELECT barcode FROM rolls WHERE "itemId"=$1 AND status='STOCK' AND "sackId" IS NULL AND "shipmentId" IS NULL AND "currentStepId" IS NULL AND barcode IS NOT NULL ORDER BY barcode LIMIT 5`, [olc.kumas])).map((r) => r.barcode);
      if (olc.toplar.length < 5) throw new Error("yeterli stok topu yok");
      const ist = Object.fromEntries((await sql(`SELECT code, id FROM stations WHERE code IN ('KURSUN_KK2','TAMBUR_1','ZIMPARA_FASON')`)).map((r) => [r.code, r.id]));
      const [fasoncu] = await sql(`SELECT id FROM subcontractors WHERE "isActive" AND name ILIKE '%zımpara%' LIMIT 1`);
      const ac = async (steps, rollBarcodes) => {
        const r = await api(`/api/work-orders/quick-start`, { method: "POST", body: JSON.stringify({ steps, rollBarcodes, targetItemId: olc.kumas, width: 180, clientToken: crypto.randomUUID() }) });
        if (r.status >= 300) throw new Error(`quick-start ${r.status} ${JSON.stringify(r.govde).slice(0, 200)}`);
        return { id: r.govde.data.workOrder.id, no: r.govde.data.workOrder.workOrderNumber };
      };
      olc.anaIe = await ac([{ stationId: ist.KURSUN_KK2 }, { stationId: ist.TAMBUR_1 }], olc.toplar.slice(0, 2));
      olc.fasonIe = await ac([{ stationId: ist.ZIMPARA_FASON, plannedSubcontractorId: fasoncu.id }, { stationId: ist.TAMBUR_1 }], [olc.toplar[2]]);
      const p2 = await api(`/api/work-orders/${olc.fasonIe.id}/batches`, { method: "POST", body: JSON.stringify({ clientToken: crypto.randomUUID(), rollBarcodes: [olc.toplar[3]] }) });
      if (p2.status >= 300) throw new Error(`parti ekle ${p2.status} ${JSON.stringify(p2.govde).slice(0, 200)}`);
    },
    dogrula: [
      { ad: "ana iş emri Üretimde, 2 top ilk adımda", sql: `SELECT wo.status::text s, (SELECT count(*)::int FROM rolls r JOIN batches b ON b.id=r."batchId" WHERE b."workOrderId"=wo.id) n FROM work_orders wo WHERE wo.id=$1`, params: () => [olc.anaIe?.id], oku: (r) => `${r[0]?.s}:${r[0]?.n}`, beklenen: "IN_PROGRESS:2" },
      { ad: "fason iş emrinde 2 parti, ikincisi BATCH_ADDED olayıyla", sql: `SELECT (SELECT count(*)::int FROM batches WHERE "workOrderId"=$1) b, (SELECT count(*)::int FROM work_order_events WHERE "workOrderId"=$1 AND type='BATCH_ADDED') e`, params: () => [olc.fasonIe?.id], oku: (r) => `${r[0].b}:${r[0].e}`, beklenen: "2:1" },
    ],
  },
  {
    id: "IE2", rol: "P", gerektirir: ["IE1"],
    yol: "İş Emirleri → iş emri → yan panel → Rengi Değiştir → renk seç → sebep → Değiştir", rota: "operations/work-orders",
    async yap(ctx) {
      const [c] = await ctx.sql(`SELECT id, name FROM colors WHERE "isActive" ORDER BY name LIMIT 1`);
      olc.renk = c;
      await hedefDegistir(ctx, /Rengi Değiştir/, "Üretim Rengini Değiştir —", async (d) => { await d.locator("#new-color").selectOption(c.id); await ctx.page().waitForTimeout(1500); });
    },
    dogrula: [
      { ad: "hedef renk yazıldı + FIELD_CHANGED(targetColorId), sebep satırda", sql: `SELECT wo."targetColorId"::text c, (SELECT count(*)::int FROM work_order_events e WHERE e."workOrderId"=wo.id AND e.type='FIELD_CHANGED' AND e.field='targetColorId' AND e.reason='E2E düzeltme') n FROM work_orders wo WHERE wo.id=$1`, params: () => [olc.anaIe?.id], oku: (r) => `${r[0].c === olc.renk?.id}:${r[0].n}`, beklenen: "true:1" },
    ],
  },
  {
    id: "IE3", rol: "P", gerektirir: ["IE1"],
    yol: "İş Emirleri → iş emri → yan panel → Eni Değiştir → 185 → sebep → Değiştir", rota: "operations/work-orders",
    async yap(ctx) {
      await hedefDegistir(ctx, /Eni Değiştir/, "Eni Değiştir —", async (d) => { await d.locator("#new-width").fill("185"); });
    },
    dogrula: [
      { ad: "en 185 + FIELD_CHANGED(width) 180 → 185", sql: `SELECT wo.width::int w, (SELECT count(*)::int FROM work_order_events e WHERE e."workOrderId"=wo.id AND e.type='FIELD_CHANGED' AND e.field='width' AND e."toValue"='185') n FROM work_orders wo WHERE wo.id=$1`, params: () => [olc.anaIe?.id], oku: (r) => `${r[0].w}:${r[0].n}`, beklenen: "185:1" },
    ],
  },
  {
    id: "IE4", rol: "P", gerektirir: ["IE1"],
    yol: "İş Emirleri → iş emri → yan panel → Parti Ekle → Top Seç → (Ham Stok) → topu işaretle → Ekle (1) → Parti Ekle (1)", rota: "operations/work-orders",
    async yap(ctx) {
      const { page, gor } = ctx;
      await iseGit(ctx, olc.anaIe);
      await page().getByRole("button", { name: /Parti Ekle/ }).filter({ visible: true }).first().click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: `Parti Ekle — ${olc.anaIe.no}` }).last();
      await gor(d);
      await d.getByRole("button", { name: /Top Seç/ }).click({ timeout: 15_000 });
      const s = page().getByRole("dialog").filter({ hasText: "Top Seç" }).last();
      await gor(s);
      await s.getByPlaceholder("Barkod / kumaş / renk ara...").fill(olc.toplar[4]);
      const satir = s.locator("label").filter({ hasText: olc.toplar[4] }).first();
      await gor(satir, { sure: 20_000 });
      await satir.click({ timeout: 10_000 });
      await s.getByRole("button", { name: "Ekle (1)" }).click({ timeout: 10_000 });
      await gor(d.getByText(/Yeni parti açılacak · 1 top/).first());
      await kanit(page, "IE4-onizleme");
      await d.getByRole("button", { name: "Parti Ekle (1)" }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(800);
      await page().keyboard.press("Escape");
    },
    dogrula: [
      { ad: "ana iş emrinde 2 parti; eklenen top ilk adımda üretimde; BATCH_ADDED 1", sql: `SELECT (SELECT count(*)::int FROM batches WHERE "workOrderId"=$1) b, (SELECT status::text FROM rolls WHERE barcode=$2) s, (SELECT count(*)::int FROM work_order_events WHERE "workOrderId"=$1 AND type='BATCH_ADDED') e`, params: () => [olc.anaIe?.id, olc.toplar[4]], oku: (r) => `${r[0].b}:${r[0].s}:${r[0].e}`, beklenen: "2:IN_PRODUCTION:1" },
    ],
  },
  {
    id: "IE5", rol: "P", gerektirir: ["IE2", "IE3", "IE4"],
    yol: "İş Emirleri → iş emri → yan panel → Hareketler", rota: "operations/work-orders",
    async yap(ctx) {
      const { page, gor } = ctx;
      await iseGit(ctx, olc.anaIe);
      await page().getByRole("button", { name: /Hareketler/ }).filter({ visible: true }).first().click({ timeout: 15_000 });
      const sh = page().getByRole("dialog").filter({ hasText: `${olc.anaIe.no} — Hareketler` }).last();
      await gor(sh);
      await gor(sh.getByText("Parti eklendi").first(), { sure: 20_000 });
      olc.hareketMetni = (await sh.innerText()).replace(/\s+/g, " ");
      await kanit(page, "IE5-hareketler");
      await page().keyboard.press("Escape");
    },
    dogrula: [
      { ad: "çizelgede açılış · renk · en · parti satırları", sql: `SELECT 1`, oku: () => ["İş emri açıldı", "185", "Parti eklendi", "E2E düzeltme"].filter((t) => !olc.hareketMetni.includes(t)).join(",") || "tamam", beklenen: "tamam" },
      { ad: "tetikler Türkçe: 'Parti Ekle' var, ham 'BATCH_ADD' yok", sql: `SELECT 1`, oku: () => `${olc.hareketMetni.includes("Parti Ekle")}:${olc.hareketMetni.includes("BATCH_ADD")}`, beklenen: "true:false" },
      { ad: "defterde en az 5 satır (açılış · başlama · renk · en · parti)", sql: `SELECT count(*)::int n FROM work_order_events WHERE "workOrderId"=$1`, params: () => [olc.anaIe?.id], oku: (r) => r[0].n, beklenen: (n) => n >= 5 },
    ],
  },
  {
    id: "IE6", rol: "P", gerektirir: ["IE5"],
    yol: "Operasyon → İş Emri Hareketleri → top barkodu → Ara → Excel (sütunlar ekrandakiyle aynı)", rota: "operations/work-order-events",
    async yap({ git, gor, page, app }) {
      await git("İş Emri Hareketleri");
      const ara = page().getByPlaceholder("İş emri no (IE…) ya da top barkodu okutun");
      await ara.fill(olc.toplar[0]);
      await page().getByRole("button", { name: "Ara", exact: true }).click({ timeout: 10_000 });
      await gor(page().getByRole("heading", { name: olc.anaIe.no }).first(), { sure: 20_000 });
      const tablo = page().locator("table").filter({ visible: true }).first();
      olc.ekranBaslik = (await tablo.locator("thead th").allInnerTexts()).map((t) => t.trim().toLocaleLowerCase("tr"));
      const hedef = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-ie-")), "hareketler.xlsx");
      await app().evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, hedef);
      await page().getByRole("button", { name: "Excel" }).filter({ visible: true }).first().click({ timeout: 15_000 });
      for (let i = 0; i < 20 && !fs.existsSync(hedef); i++) await page().waitForTimeout(500);
      if (!fs.existsSync(hedef)) throw new Error("Excel dosyası yazılmadı");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(hedef);
      const ws = wb.worksheets[0];
      // Dosya başlığı (ve boş satır) üstte olabilir — sütun satırı ekrandaki sütun sayısı kadar dolu İLK satırdır.
      const hucreler = (i) => (ws.getRow(i).values ?? []).slice(1).map((v) => String(v ?? "").trim()).filter(Boolean);
      let bas = 1;
      while (bas <= ws.rowCount && hucreler(bas).length < olc.ekranBaslik.length) bas += 1;
      olc.excelBaslik = hucreler(bas).map((v) => v.toLocaleLowerCase("tr"));
      olc.excelSatir = ws.rowCount - bas;
    },
    dogrula: [
      { ad: "Excel başlıkları = ekran sütunları (aynı sıra)", sql: `SELECT 1`, oku: () => `${JSON.stringify(olc.excelBaslik)} ≟ ${JSON.stringify(olc.ekranBaslik)}`, beklenen: () => JSON.stringify(olc.excelBaslik) === JSON.stringify(olc.ekranBaslik) },
      { ad: "Excel satır sayısı = defter + kaynaklı satırlar (≥ 5)", sql: `SELECT 1`, oku: () => olc.excelSatir, beklenen: (n) => n >= 5 },
    ],
  },
  {
    id: "IE7", rol: "P",
    yol: "D7: geçmiş doldurma kuru koşum → --apply (e2e kopyası) · İş Emirleri → tamamlanmış iş emri → Detayı Aç → Üretilen Nihai Toplar başlığı; Parti Ekle tuşu YOK", rota: "operations/work-orders",
    async yap(ctx) {
      const { page, gor, sql } = ctx;
      const env = { ...process.env, DATABASE_URL: `postgresql://tekserp:tekserp@localhost:55433/${ctx.ortam.dbName}?schema=public` };
      const kuruKos = () => spawnSync("npx", ["tsx", "scripts/backfill_workorder_events.ts"], { cwd: BACKEND_KOK, encoding: "utf-8", env });
      const kuru = kuruKos();
      olc.onay = kuru.stdout.match(/--onay=(\d+)/)?.[1] ?? null;
      // Önceki turda uygulandıysa kuru koşum komut basmaz (yazılacak satır yok).
      if (olc.onay && olc.onay !== "0") {
        const uyg = spawnSync("npx", ["tsx", "scripts/backfill_workorder_events.ts", "--apply", `--onay=${olc.onay}`, `--hedef=${ctx.ortam.dbName}`], { cwd: BACKEND_KOK, encoding: "utf-8", env });
        if (uyg.status !== 0) throw new Error(`--apply ${uyg.status}: ${uyg.stderr.slice(-300)}`);
      }
      olc.ikinciKuru = kuruKos().stdout.match(/olay: (\d+)/)?.[1] ?? "?";
      const [w] = await sql(`SELECT wo.id, wo."workOrderNumber" no FROM work_orders wo JOIN work_order_close_snapshots s ON s."workOrderId"=wo.id WHERE wo.status='COMPLETED' AND s."closeKind"='BACKFILL' ORDER BY wo."createdAt" DESC LIMIT 1`);
      olc.kapaliIe = { id: w.id, no: w.no };
      await iseGit(ctx, olc.kapaliIe, { tamamlanan: true });
      olc.partiEkleTusu = await page().getByRole("button", { name: /Parti Ekle/ }).filter({ visible: true }).count();
      await page().getByRole("button", { name: /Detayı Aç/ }).filter({ visible: true }).first().click({ timeout: 15_000 });
      const kunye = page().getByText(/Kapanışta \(yaklaşık · sonradan türetildi\)/).filter({ visible: true }).first();
      await gor(kunye, { sure: 20_000 });
      olc.kunyeMetni = (await kunye.innerText()).trim();
      await kunye.scrollIntoViewIfNeeded();
      await kanit(page, "IE7-kunye");
      olc.partiEkleTusu += await page().getByRole("button", { name: /Parti Ekle/ }).filter({ visible: true }).count();
    },
    dogrula: [
      { ad: "geçmiş doldurma uygulandı (BACKFILL satırları) ve ikinci kuru koşum 0 olay", sql: `SELECT count(*)::int n FROM work_order_events WHERE channel='BACKFILL'`, oku: (r) => `${r[0].n} satır · ikinci kuru ${olc.ikinciKuru}`, beklenen: (v) => /^[1-9]\d* satır · ikinci kuru 0$/.test(v) },
      { ad: "künye başlığı 'Kapanışta (yaklaşık · sonradan türetildi)'", sql: `SELECT 1`, oku: () => olc.kunyeMetni, beklenen: (v) => typeof v === "string" && v.startsWith("Kapanışta (yaklaşık") },
      { ad: "tamamlanmış iş emrinde Parti Ekle tuşu yok (yan panel + detay)", sql: `SELECT 1`, oku: () => olc.partiEkleTusu, beklenen: 0 },
    ],
  },
  {
    id: "IE8", rol: "P", gerektirir: ["IE1"],
    yol: "İş Emirleri → fason iş emri → Detayı Aç → Rota & Dağılım → Zımpara: Sevk Et → Sevk Et (2) → 'Birden çok parti' (Ayrı sevk seçili) → Sevk Et",
    rota: "operations/work-orders",
    beklenenHatalar: [{ status: 409, url: /\/api\/subcontractor\/dispatch\/bulk/ }],
    async yap(ctx) {
      const { page, gor } = ctx;
      await iseGit(ctx, olc.fasonIe);
      await page().getByRole("button", { name: /Detayı Aç/ }).filter({ visible: true }).first().click({ timeout: 15_000 });
      await page().waitForTimeout(1500);
      await page().getByRole("button", { name: /^Sevk Et/ }).filter({ visible: true }).first().click({ timeout: 15_000 });
      const m = page().getByRole("dialog").filter({ hasText: "Toplu Fason Sevki" }).last();
      await gor(m);
      await m.getByRole("button", { name: "Sevk Et (2)" }).click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Birden çok parti" }).last();
      await gor(d, { sure: 20_000 });
      await kanit(page, "IE8-birden-cok-parti");
      if (!(await d.getByRole("radio", { name: /Ayrı sevk/ }).isChecked().catch(() => false))) {
        const r = d.locator("label").filter({ hasText: "Ayrı sevk" }).locator("input");
        if (!(await r.isChecked())) throw new Error("Ayrı sevk varsayılan seçili değil");
      }
      await d.getByRole("button", { name: "Sevk Et", exact: true }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 30_000 });
      await page().waitForTimeout(1200);
    },
    dogrula: [
      { ad: "iki ayrı sevk, iki farklı parti", sql: `SELECT count(*)::int n, count(DISTINCT "batchId")::int b FROM subcontractor_dispatches WHERE "workOrderId"=$1 AND "cancelledAt" IS NULL`, params: () => [olc.fasonIe?.id], oku: (r) => `${r[0].n}:${r[0].b}`, beklenen: "2:2" },
      { ad: "iki top fasonda", sql: `SELECT count(*)::int n FROM rolls WHERE barcode = ANY($1) AND status='AT_SUBCONTRACTOR'`, params: () => [olc.toplar.slice(2, 4)], oku: (r) => r[0].n, beklenen: 2 },
    ],
  },
];
