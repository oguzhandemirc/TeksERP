// test_gelen_belge_cok_parti §15 (Gülkesim 214279 provası, 2026-11-06): çok partili kağıtta (a) partinin metresi beyan ara
// toplamından önerilir (Σ satır yalnız beyan yoksa; tek partili yolun önceliği) · (b) kağıttaki parti no SERIES kipinde de
// kaybolmaz: İE partisi seriden doğar ama no künyeye (`parameters.customerBatchNo`) yazılır, istasyon + panel aramasında bulunur;
// DOCUMENT kipinde parti no'su doğrudan kağıttaki no'dur · (c) onaydan sonra elle düzeltilen parti metresi `recordedMeters`te (§15f). Dosya boyu tavanı için ayrı.
import prisma from "../../src/lib/prisma";
import { stationWorkSearchWhere } from "../../src/services/helpers/workorder-doc-search.helper";
import { SETTING_KEYS } from "../../src/services/system-setting.service";

type Check = (label: string, ok: boolean, extra?: string) => void;
type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };
interface Ctx {
  check: Check;
  tag: string;
  mkNote: () => Promise<string>;
  parties: (id: string) => Promise<Resp>;
  formWo: (id: string, body: unknown) => Promise<Resp>;
  body: (n: number, extra?: Record<string, unknown>) => Record<string, unknown>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  get: (path: string) => Promise<Resp>;
}
type WoOut = { workOrderId: string; workOrderNo: string; batchNumber: string | null };
type PartyView = { blockNo: number; meters: number; declaredMeters: number | null; suggestedMeters?: number | null; suggestedMetersSource?: string | null; recordedMeters?: number | null };

/** Notun blok beyanını değiştirir (OCR'ın okuduğu ara toplam) — satırlar aynı kalır. */
async function setDeclaredMeters(noteId: string, m: Record<number, string | null>): Promise<void> {
  const n = await prisma.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { totalsDeclared: true } });
  const blocks = ((n?.totalsDeclared as { blocks?: Array<Record<string, unknown>> } | null)?.blocks ?? [])
    .map((b) => (typeof b.blockNo === "number" && b.blockNo in m ? { ...b, m: m[b.blockNo] } : b));
  await prisma.customerDeliveryNote.update({ where: { id: noteId }, data: { totalsDeclared: { blocks } as never } });
}

export async function cokPartiKagitNo(c: Ctx): Promise<void> {
  console.log("§15 214279: parti metresi beyan ara toplamından · parti no SERIES'te künyede");
  // Satırlar 100+110+120 (=330) / 200+210 (=410). Kağıt: parti 1 ara toplamı 586 (OCR satır kaçırdı), parti 2'nin toplamı okunamadı.
  const n = await c.mkNote();
  await setDeclaredMeters(n, { 1: "586", 2: null });
  const ps = ((await c.parties(n)).data?.parties ?? []) as PartyView[];
  c.check("§15a ⭐ parti 1: beyan ara toplamı (586) önerilir, Σ satır (330) değil; parti 2 beyansız → Σ satır (410)",
    ps[0]?.suggestedMeters === 586 && ps[0]?.suggestedMetersSource === "TOTAL" && ps[0]?.meters === 330
      && ps[1]?.suggestedMeters === 410 && ps[1]?.suggestedMetersSource === "LINE_SUM",
    JSON.stringify(ps.map((p) => [p.blockNo, p.meters, p.declaredMeters, p.suggestedMeters, p.suggestedMetersSource])));

  await c.setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "SERIES");
  const paper = [`${c.tag.slice(-6)}K-24749`, `${c.tag.slice(-6)}K-24750`];
  const r = await c.formWo(n, c.body(15, { mode: "PER_PARTY", parties: [{ blockNo: 1, batchNo: paper[0], meters: 586 }, { blockNo: 2, batchNo: paper[1], meters: 3935 }] }));
  const wos = (r.data?.workOrders ?? []) as WoOut[];
  const rows = await prisma.workOrder.findMany({ where: { id: { in: wos.map((w) => w.workOrderId) } }, select: { id: true, parameters: true, batches: { select: { batchNumber: true, numberSource: true } } } });
  const of = (id: string | undefined) => rows.find((x) => x.id === id);
  const param = (id: string | undefined) => (of(id)?.parameters as { customerBatchNo?: string } | null)?.customerBatchNo;
  c.check("§15b ⭐ SERIES + PER_PARTY: 2 İE, parti seriden (kağıt no DEĞİL), kağıttaki parti no her İE'nin künyesinde (kendi partisi)",
    r.status === 201 && wos.length === 2 && wos.every((w) => !!w.batchNumber && !paper.includes(w.batchNumber))
      && of(wos[0]?.workOrderId)?.batches[0]?.numberSource === "SERIES" && param(wos[0]?.workOrderId) === paper[0] && param(wos[1]?.workOrderId) === paper[1],
    `${r.status} ${r.code ?? ""} ${JSON.stringify(rows.map((x) => [x.parameters, x.batches]))}`);

  // 2. prova: tablette 2. partinin metresi elle 3935'e düzeltildi, panel Partiler kartı Σ satırı (410 burada) göstermeye devam etti.
  const after = ((await c.parties(n)).data?.parties ?? []) as PartyView[];
  c.check("§15f ⭐ onaydan sonra parti kaydının (elle girilen) metresi `/partiler`de: 586 / 3935; Σ satır ayrı kalır (330 / 410)",
    after[0]?.recordedMeters === 586 && after[1]?.recordedMeters === 3935 && after[0]?.meters === 330 && after[1]?.meters === 410,
    JSON.stringify(after.map((p) => [p.blockNo, p.meters, p.recordedMeters])));
  const fresh = ((await c.parties(await c.mkNote())).data?.parties ?? []) as PartyView[];
  c.check("§15f onaysız belgede parti kaydı yok → recordedMeters null", fresh.length === 2 && fresh.every((p) => p.recordedMeters === null), JSON.stringify(fresh.map((p) => p.recordedMeters)));

  const hits = async (q: string) => {
    const where = stationWorkSearchWhere(q);
    return where ? (await prisma.workOrder.findMany({ where, select: { id: true } })).map((h) => h.id) : [];
  };
  const h2 = await hits(paper[1]!);
  const h2lower = await hits(paper[1]!.toLowerCase());
  c.check("§15c ⭐ istasyon araması kağıttaki parti 2 no'suyla YALNIZ parti 2'nin İE'sini bulur (küçük harfle de)",
    h2.includes(wos[1]?.workOrderId ?? "-") && !h2.includes(wos[0]?.workOrderId ?? "-") && h2lower.includes(wos[1]?.workOrderId ?? "-"), JSON.stringify({ h2, h2lower }));
  const list = await c.get(`/api/work-orders?search=${encodeURIComponent(paper[1]!)}&limit=20`);
  const listIds = (((list.data as { items?: Array<{ id: string }> } | undefined)?.items ?? (Array.isArray(list.data) ? list.data : [])) as Array<{ id: string }>).map((x) => x.id);
  c.check("§15d ⭐ panel İE listesi araması da kağıttaki parti no'yla bulur", list.status === 200 && listIds.includes(wos[1]?.workOrderId ?? "-") && !listIds.includes(wos[0]?.workOrderId ?? "-"),
    `${list.status} ${JSON.stringify(listIds)}`);

  await c.setSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, "DOCUMENT");
  const nd = await c.mkNote();
  const rd = await c.formWo(nd, c.body(16, { mode: "PER_PARTY", parties: [{ blockNo: 1, batchNo: `${paper[0]}D`, meters: 586 }, { blockNo: 2, batchNo: `${paper[1]}D`, meters: 3935 }] }));
  const wd = (rd.data?.workOrders ?? []) as WoOut[];
  c.check("§15e ⭐ DOCUMENT + PER_PARTY: İE parti no'su kağıttaki parti no'su (parti başına)",
    rd.status === 201 && wd.length === 2 && wd[0]?.batchNumber === `${paper[0]}D` && wd[1]?.batchNumber === `${paper[1]}D`, `${rd.status} ${rd.code ?? ""} ${JSON.stringify(wd)}`);
}
