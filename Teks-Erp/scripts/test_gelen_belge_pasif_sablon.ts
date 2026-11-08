// =============================================================================
// GELEN BELGE — PASİF DOSYA ŞABLONU MOTORA GİRMEZ (Gülkesim demo, 2026-11-04)
// =============================================================================
// HTTP + gerçek DB + gerçek motor. Panelin Aktif/Pasif anahtarı (`PATCH /api/gelen-belge/sablonlar/:code`) yerleşik
// (dosya) şablonu pasife alınca belge o şablonla TANINMAZ: GENEL yedeğe düşer, okuma özeti `tanitim` TANITILMAMIS.
// Yeniden aktif → yine o şablon. Sınanan:
//   §1 başlangıç: 0243 kesim-takip-formu şablonuyla okunur, `tanitim` SISTEM (hazır şablon, "Yeniden tanıt")
//   §2 ⭐ pasif: `engineTemplates` kodu içermez, GENEL içerir; 0243 bölgesi GENEL; `tanitim` TANITILMAMIS; liste inEngine false, inFile true
//   §3 ⭐ yeniden aktif: motor kümesinde, 0243 yine kesim-takip-formu; liste inEngine true
//   §0 dosyası kalmamış yerleşik kodun satırı `GET /sablonlar` listesinde yok (2026-11-09)
// Negatif sonda (2026-11-04, ölçüldü): `engineTemplates` süzgeci (`!off.has`) kaldırılınca §2 kırmızı.
// Koşum tekil (run-all-tests seri); şablon satırının ilk hâli finally'de geri yüklenir.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import type { AddressInfo } from "net";
import type { Server } from "http";
import prisma from "../src/lib/prisma";
import app from "../src/app";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { engineTemplates } from "../src/services/gelen-belge-ozel-sablon.service";
import { buildDraft, fillBoundDraftTx } from "../src/services/gelen-belge-taslak-doldur.service";
import type { OcrResult } from "../src/lib/gelen-belge/motor";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testSablonlariniKaydet } from "./lib/gelen-belge-test-sablonlar";

// Gönderen şablonları pakette yok (2026-11-09): bekçi onları süreç içi dosya şablonu olarak kaydeder.
testSablonlariniKaydet();

const blocked = hedefDbEngeli();
if (blocked) {
  console.error(`⛔ DURDURULDU — ${blocked}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const FIXTURES = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur", "gercek");
const OCR = JSON.parse(readFileSync(join(FIXTURES, "0243-kesim-takip-formu.json"), "utf8")) as OcrResult;
const CODE = "kesim-takip-formu";
const ORPHAN = `test-kaldirilmis-${Date.now()}`;
const TAG = `TEST-GPS${Date.now().toString(36).toUpperCase()}`;
const made = { notes: [] as string[], scans: [] as string[] };
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI];

type Resp = { status: number; code?: string; data?: unknown };

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function run(url: string): Promise<void> {
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  for (const k of [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  await setSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, null);
  const lr = await fetch(`${url}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }) });
  const tk = ((await lr.json()) as { data?: { token?: string } }).data?.token ?? "";
  check("admin login", tk.length > 0);
  const call = async (method: string, path: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${url}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { data?: unknown; details?: { code?: string } };
    return { status: r.status, code: j.details?.code, data: j.data };
  };

  /** Okuma anı (okuma işinin yazdığı kolonlar): boş MANUAL taslak → buildDraft → tarama bağla. Bölge şablonları + özet `tanitim`. */
  const read = async (): Promise<{ regions: Array<string | null>; tanitim: { durum?: string; sablonKodu?: string } | undefined; status: number }> => {
    const n = await call("POST", "/api/gelen-belge/irsaliyeler", { sourceKind: "MANUAL", senderText: `${TAG} GÖNDEREN` });
    const id = (n.data as { id?: string } | undefined)?.id ?? "";
    made.notes.push(id);
    const built = await buildDraft(OCR, admin.id, { bumpHit: false });
    const content = Buffer.from(`${TAG}-${randomUUID()}`);
    const s = await prisma.documentScan.create({
      data: { noteId: id, pageNo: 1, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: built.envelope as never },
      select: { id: true },
    });
    made.scans.push(s.id);
    await prisma.$transaction((tx) => fillBoundDraftTx(tx, id, { id: s.id, pageNo: 1 }, built));
    const sum = await call("GET", `/api/gelen-belge/irsaliyeler/${id}/okuma-ozeti`);
    const regions = ((built.envelope as { regions?: Array<{ templateId?: string | null }> }).regions ?? []).map((r) => r.templateId ?? null);
    return { regions, tanitim: (sum.data as { tanitim?: { durum?: string; sablonKodu?: string } } | undefined)?.tanitim, status: sum.status };
  };
  const listed = async () => {
    const l = await call("GET", "/api/gelen-belge/sablonlar");
    return ((l.data ?? []) as Array<{ code: string; isActive: boolean; inEngine: boolean; inFile: boolean }>).find((x) => x.code === CODE);
  };
  const engineIds = async () => (await engineTemplates()).map((t) => t.id);

  console.log("§0 dosyası kalmamış yerleşik şablon satırı (2026-11-09 kalıntısı) listede yok");
  await prisma.senderTemplate.create({ data: { code: ORPHAN, version: 1, template: { id: ORPHAN, name: "Kaldırılmış" }, isActive: false } });
  const l0 = await call("GET", "/api/gelen-belge/sablonlar");
  const codes0 = ((l0.data ?? []) as Array<{ code: string }>).map((x) => x.code);
  check("§0 ⭐ dosyasız yerleşik kod listelenmez; dosya şablonu listelenir", l0.status === 200 && !codes0.includes(ORPHAN) && codes0.includes(CODE), JSON.stringify(codes0));

  console.log("§1 başlangıç (aktif)");
  await call("PATCH", `/api/gelen-belge/sablonlar/${CODE}`, { isActive: true });
  const a = await read();
  check("§1 0243 kesim-takip-formu şablonuyla okunur; `tanitim` SISTEM", a.regions.length > 0 && a.regions.every((r) => r === CODE) && a.tanitim?.durum === "SISTEM" && a.tanitim.sablonKodu === CODE, JSON.stringify(a));

  console.log("§2 pasif");
  const off = await call("PATCH", `/api/gelen-belge/sablonlar/${CODE}`, { isActive: false });
  check("§2 PATCH isActive=false 200", off.status === 200, `${off.status} ${off.code ?? ""}`);
  const ids = await engineIds();
  check("§2 ⭐ motor kümesinde pasif dosya şablonu YOK, GENEL hep var (sonda)", !ids.includes(CODE) && ids[ids.length - 1] === "genel", JSON.stringify(ids));
  const b = await read();
  check("§2 ⭐ 0243 GENEL'e düşer; `tanitim` TANITILMAMIS", b.status === 200 && b.regions.length > 0 && b.regions.every((r) => r === "genel") && b.tanitim?.durum === "TANITILMAMIS", JSON.stringify(b));
  const lb = await listed();
  check("§2 liste: isActive false, inEngine false, inFile true (anahtar açılabilir)", lb?.isActive === false && lb.inEngine === false && lb.inFile === true, JSON.stringify(lb));

  console.log("§3 yeniden aktif");
  const on = await call("PATCH", `/api/gelen-belge/sablonlar/${CODE}`, { isActive: true });
  check("§3 PATCH isActive=true 200", on.status === 200, `${on.status} ${on.code ?? ""}`);
  check("§3 ⭐ motor kümesinde yeniden var", (await engineIds()).includes(CODE));
  const c = await read();
  check("§3 ⭐ 0243 yine kesim-takip-formu; `tanitim` SISTEM", c.regions.length > 0 && c.regions.every((r) => r === CODE) && c.tanitim?.durum === "SISTEM" && c.tanitim.sablonKodu === CODE, JSON.stringify(c));
  const lc = await listed();
  check("§3 liste: isActive true, inEngine true, inFile true", lc?.isActive === true && lc.inEngine === true && lc.inFile === true, JSON.stringify(lc));
}

async function main(): Promise<void> {
  console.log("=== Gelen belge pasif dosya şablonu bekçisi ===\n");
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  const priorRow = await prisma.senderTemplate.findUnique({ where: { code: CODE }, select: { id: true, isActive: true } });
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    server.close();
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    const swallow = () => undefined;
    await prisma.customerDeliveryNoteLine.updateMany({ where: { noteId: { in: made.notes } }, data: { scanId: null } }).catch(swallow);
    await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
    await prisma.customerDeliveryNoteLine.deleteMany({ where: { noteId: { in: made.notes } } }).catch(swallow);
    await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch(swallow);
    await prisma.senderTemplate.deleteMany({ where: { code: ORPHAN } }).catch(swallow);
    // Şablon satırı ilk hâline: yoksa PATCH'in doğurduğu satır kalkar (yapılandırma), varsa aktiflik geri yazılır.
    if (!priorRow) await prisma.senderTemplate.deleteMany({ where: { code: CODE } }).catch(swallow);
    else await prisma.senderTemplate.updateMany({ where: { id: priorRow.id }, data: { isActive: priorRow.isActive } }).catch(swallow);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!blocked) void main();
else void prisma.$disconnect();
