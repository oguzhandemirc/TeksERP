// =============================================================================
// Bekçi: ÇEK TESLİM BORDROSU = HAREKET FİŞİ (K3, bayrak `finance.chequeNoteMovementEnabled`) — DB'li
// Çalıştır: npx tsx scripts/run-all-tests.ts cek_bordro_hareket
// =============================================================================
// Tasarım `docs/design/CEK-TESLIM-BORDROSU-TASARIM.md` §4 K3 (1e onayı 2026-09-26). Ölçülen sözler:
//   §1  KAPALI kol = bugünkü davranış: yapılandırılmış hedefte de çek değişmez, tekil bankaya verme
//       bordro kesmez, cevaplarda yeni alan yok.
//   §2  Banka hedefi → bankaya verme (olaylar bordroya bağlı, cari/banka bakiyesi OKUNARAK aynı).
//   §3  Cari hedefi → ciro (ciro carisine Σ BORÇ, txnDate = teslim tarihi, kronoloji createdAt).
//   §4  Kural tablosu fail-closed + satır kapısı TAM LİSTE (hiçbir şey yazılmaz).
//   §5  Serbest metin hedef AÇIKKEN de belge-only.
//   §6  Tam iptal: ters olay bağlı, reversesTxnId, ileri satır SİLİNMEZ, CANCELLED + VOIDED;
//       bayrak sonradan kapansa da hareketli bordro hareketiyle döner.
//   §7  İlerlemiş kalem → 409 listeli, hiçbir şey geri alınmaz; önizleme her kalemi söyler.
//   §8  Kısmi iptal; son canlı kalemde bordro kendiliğinden CANCELLED.
//   §9  Tek yol: tekil bankaya verme/ciro tek satırlı BRD keser, tekil storno bordrodan yürür;
//       bağsız eski olay eski yoldan; AST: DEPOSIT/ENDORSE olayı yalnız çekirdekte yazılır.
//   §10 Eşzamanlılık: aynı çekte iki bordro → biri 409 · aynı token → tek bordro tek olay ·
//       ZORLANMIŞ SIRA: çok satırlı ciro ‖ tekil ciro kilitlenme döngüsü kurmaz (satır → 8026).
//   §11 Kapalı dönem (8026) teslim TARİHİYLE ölçülür → 409, hiçbir şey yazılmaz.
//   §12 İzin + eski istemci (HTTP): hareket `finance:cheque` ister; seçimsiz iptal 409.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import ts from "typescript";
import {
  CariKind,
  CariTxnSource,
  ChequeDeliveryNoteStatus,
  ChequeDocType,
  ChequeEventType,
  ChequeKind,
  ChequeStatus,
  Currency,
  PrintedDocStatus,
  PrintedDocType,
} from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { chequeService } from "../src/services/cheque.service";
import { chequeDeliveryNoteService } from "../src/services/cheque-delivery-note.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SIRA_ZORLANDI, zorlanmisSira } from "./lib/zorlanmis-sira";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

type Hata = { message: string; code?: string; statusCode?: number; details?: Record<string, unknown> } | null;
async function hataOf(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message: string; statusCode?: number; details?: Record<string, unknown> };
    return { message: err.message, code: err.details?.code as string | undefined, statusCode: err.statusCode, details: err.details };
  }
}

const TAG = `K3H${Date.now().toString(36).toUpperCase()}`;
const DAY = 864e5;
const FLAG = "finance.chequeNoteMovementEnabled";
const FIN = "finance.enabled";

const olusan = {
  customerIds: [] as string[],
  cariIds: [] as string[],
  bankIds: [] as string[],
  chequeIds: [] as string[],
  userIds: [] as string[],
  periodCloseIds: [] as string[],
};
const ayarYedek = new Map<string, { value: unknown } | null>();
let server: Server | null = null;

async function ayar(key: string, value: boolean): Promise<void> {
  if (!ayarYedek.has(key)) {
    ayarYedek.set(key, await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } }));
  }
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
const bayrak = (on: boolean) => ayar(FLAG, on);

async function durum(id: string) {
  return prisma.cheque.findUniqueOrThrow({
    where: { id },
    select: { status: true, bankAccountId: true, endorsedToCariId: true },
  });
}
async function bakiye(cariId: string, currency: Currency): Promise<number> {
  const r = await prisma.cariBalance.findUnique({ where: { cariId_currency: { cariId, currency } }, select: { balance: true } });
  return r ? Number(r.balance) : 0;
}
async function bankaBakiye(id: string): Promise<number> {
  return Number((await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);
}
async function bagliOlaylar(noteId: string) {
  return prisma.chequeEvent.findMany({ where: { deliveryNoteId: noteId }, select: { chequeId: true, type: true } });
}
async function notOf(chequeId: string): Promise<string[]> {
  return (await prisma.chequeDeliveryNoteItem.findMany({ where: { chequeId }, select: { noteId: true } })).map((n) => n.noteId);
}

// ── FİKSTÜR ─────────────────────────────────────────────────────────────────
interface Fikstur {
  adminId: string;
  cariA: string; // çekleri veren müşteri (keşideci tarafı)
  cariB: string; // ciro edilen tedarikçi
  bankTry: string;
  bankUsd: string;
  cek: (o?: { kind?: ChequeKind; amount?: number; currency?: Currency; status?: ChequeStatus; cariId?: string }) => Promise<string>;
}

async function fikstur(adminId: string): Promise<Fikstur> {
  const kart = async (ek: string) => {
    const c = await prisma.customer.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} ${ek}` }, select: { id: true } });
    olusan.customerIds.push(c.id);
    const cari = await prisma.cariAccount.create({ data: { kind: CariKind.CUSTOMER, customerId: c.id }, select: { id: true } });
    olusan.cariIds.push(cari.id);
    return cari.id;
  };
  const banka = async (ek: string, currency: Currency) => {
    const b = await prisma.bankAccount.create({ data: { code: `${TAG}-${ek}`, name: `${TAG} ${ek}`, currency }, select: { id: true } });
    olusan.bankIds.push(b.id);
    return b.id;
  };
  const cariA = await kart("A");
  const cariB = await kart("B");
  const bankTry = await banka("BTRY", Currency.TRY);
  const bankUsd = await banka("BUSD", Currency.USD);
  let seq = 0;
  const cek: Fikstur["cek"] = async (o = {}) => {
    seq++;
    const amount = o.amount ?? 100 * seq;
    const c = await prisma.cheque.create({
      data: {
        docNo: `${TAG}-${String(seq).padStart(3, "0")}`,
        kind: o.kind ?? ChequeKind.RECEIVED,
        docType: ChequeDocType.CHEQUE,
        status: o.status ?? ChequeStatus.PORTFOLIO,
        cariId: o.cariId ?? cariA,
        currency: o.currency ?? Currency.TRY,
        exchangeRate: 1,
        amount,
        amountTry: amount,
        issueDate: new Date(Date.now() - 3 * DAY),
        postingDate: new Date(Date.now() - 3 * DAY),
        dueDate: new Date(Date.now() + (10 + seq) * DAY),
        drawerName: `${TAG} Keşideci`,
      },
      select: { id: true },
    });
    olusan.chequeIds.push(c.id);
    return c.id;
  };
  return { adminId, cariA, cariB, bankTry, bankUsd, cek };
}

const hareketli = { canMoveCheques: true } as const;

// ── §1 KAPALI KOL ───────────────────────────────────────────────────────────
async function kapaliKol(f: Fikstur): Promise<void> {
  console.log("§1 Bayrak KAPALI — bugünkü davranış");
  await bayrak(false);
  const c1 = await f.cek();
  const c2 = await f.cek();
  const res = await chequeDeliveryNoteService.create({ chequeIds: [c1, c2], bankAccountId: f.bankTry }, f.adminId, hareketli);
  const noteId = res.data!.id;
  check("§1a yapılandırılmış hedefte de çek DEĞİŞMEZ", (await durum(c1)).status === ChequeStatus.PORTFOLIO && (await durum(c2)).status === ChequeStatus.PORTFOLIO);
  check("§1b bordroya bağlı olay yok", (await bagliOlaylar(noteId)).length === 0);
  check("§1c cevapta `movement` anahtarı YOK (bayt bayt bugünkü)", !("movement" in (res.data as object)));
  const d = await chequeDeliveryNoteService.draft({ chequeIds: [c1], bankAccountId: f.bankTry }, f.adminId);
  check("§1d taslakta `movement` anahtarı YOK", !("movement" in (d.data as object)));
  const c3 = await f.cek();
  const dep = await chequeService.deposit(c3, { bankAccountId: f.bankTry }, f.adminId);
  check("§1e tekil bankaya verme bordro KESMEZ", (await notOf(c3)).length === 0 && !("deliveryNote" in (dep.data as object)));
  const ev = await prisma.chequeEvent.findFirst({ where: { chequeId: c3, type: ChequeEventType.DEPOSIT }, select: { deliveryNoteId: true } });
  check("§1f tekil olay bağsız", ev?.deliveryNoteId === null);
  const iptal = await chequeDeliveryNoteService.cancel(noteId, "belge-only iptal", f.adminId);
  check("§1g belge-only bordro iptali bugünkü gibi (sebep opsiyonel, çek aynı)", iptal.success && (await durum(c1)).status === ChequeStatus.PORTFOLIO);
}

// ── §2 BANKA ────────────────────────────────────────────────────────────────
async function bankaHedefi(f: Fikstur): Promise<string> {
  console.log("§2 Banka hedefi → bankaya verme");
  await bayrak(true);
  const d1 = await f.cek({ amount: 1000 });
  const d2 = await f.cek({ amount: 2000 });
  const cariOnce = await bakiye(f.cariA, Currency.TRY);
  const bankaOnce = await bankaBakiye(f.bankTry);
  const taslak = await chequeDeliveryNoteService.draft({ chequeIds: [d1, d2], bankAccountId: f.bankTry }, f.adminId);
  const plan = (taslak.data as { movement?: { type: string; rows: Array<{ toStatus: string; blockedReason: string | null }> } }).movement;
  check("§2a taslak planı: iki satır bankaya, engel yok", plan?.type === "DEPOSIT" && plan.rows.length === 2 && plan.rows.every((r) => r.toStatus === "AT_BANK" && !r.blockedReason));
  check("§2b taslak hiçbir şey YAZMAZ", (await durum(d1)).status === ChequeStatus.PORTFOLIO && (await notOf(d1)).length === 0);
  const res = await chequeDeliveryNoteService.create({ chequeIds: [d1, d2], bankAccountId: f.bankTry }, f.adminId, hareketli);
  const noteId = res.data!.id;
  const s1 = await durum(d1);
  const s2 = await durum(d2);
  check("§2c iki çek AT_BANK + başlık bankası", s1.status === ChequeStatus.AT_BANK && s2.status === ChequeStatus.AT_BANK && s1.bankAccountId === f.bankTry);
  const ev = await bagliOlaylar(noteId);
  check("§2d iki DEPOSIT olayı bordroya bağlı", ev.length === 2 && ev.every((e) => e.type === ChequeEventType.DEPOSIT));
  check("§2e cevapta movement=DEPOSIT", (res.data as { movement?: string }).movement === "DEPOSIT");
  check("§2f cari bakiyesi OKUNARAK aynı", (await bakiye(f.cariA, Currency.TRY)) === cariOnce);
  check("§2g banka bakiyesi OKUNARAK aynı (bankaya verme para değildir)", (await bankaBakiye(f.bankTry)) === bankaOnce);
  const not = await prisma.chequeEvent.findFirst({ where: { deliveryNoteId: noteId }, select: { notes: true } });
  check("§2h olay notunda bordro no (eski panel geçmişinde görünür)", (not?.notes ?? "").startsWith(res.data!.docNo));
  return noteId;
}

// ── §3 CARİ ─────────────────────────────────────────────────────────────────
async function cariHedefi(f: Fikstur): Promise<{ noteId: string; ids: string[]; onceTry: number; onceUsd: number }> {
  console.log("§3 Cari hedefi → ciro");
  const e1 = await f.cek({ amount: 300 });
  const e2 = await f.cek({ amount: 450, status: ChequeStatus.AT_BANK });
  const e3 = await f.cek({ amount: 70, currency: Currency.USD });
  const onceTry = await bakiye(f.cariB, Currency.TRY);
  const onceUsd = await bakiye(f.cariB, Currency.USD);
  const onceA = await bakiye(f.cariA, Currency.TRY);
  const teslim = new Date(Date.now() - 2 * DAY);
  const res = await chequeDeliveryNoteService.create(
    { chequeIds: [e1, e2, e3], cariId: f.cariB, deliveryDate: teslim, targetLabel: "Merkez ofis" },
    f.adminId,
    hareketli,
  );
  const noteId = res.data!.id;
  const s = await Promise.all([e1, e2, e3].map((id) => durum(id)));
  check("§3a üç çek ENDORSED, ciro carisi B", s.every((x) => x.status === ChequeStatus.ENDORSED && x.endorsedToCariId === f.cariB));
  const satirlar = await prisma.cariTransaction.findMany({
    where: { chequeId: { in: [e1, e2, e3] }, sourceType: CariTxnSource.CHEQUE_ENDORSE },
    select: { cariId: true, debit: true, txnDate: true, createdAt: true },
  });
  check("§3b ciro carisine üç BORÇ satırı", satirlar.length === 3 && satirlar.every((t) => t.cariId === f.cariB));
  check("§3c TRY bakiyesi +750, USD +70", (await bakiye(f.cariB, Currency.TRY)) - onceTry === 750 && (await bakiye(f.cariB, Currency.USD)) - onceUsd === 70);
  check("§3d çeki veren cariye dokunulmadı", (await bakiye(f.cariA, Currency.TRY)) === onceA);
  check(
    "§3e txnDate = teslim tarihi (kullanıcı girdisi), kronoloji createdAt = bugün",
    satirlar.every((t) => t.txnDate.getTime() === teslim.getTime() && Date.now() - t.createdAt.getTime() < 60_000),
  );
  return { noteId, ids: [e1, e2, e3], onceTry, onceUsd };
}

// ── §4 KURAL TABLOSU + SATIR KAPISI ─────────────────────────────────────────
async function kuralTablosu(f: Fikstur): Promise<void> {
  console.log("§4 Kural tablosu fail-closed + satır kapısı");
  const i1 = await f.cek({ kind: ChequeKind.ISSUED, status: ChequeStatus.ISSUED, cariId: f.cariB });
  const hBank = await hataOf(() => chequeDeliveryNoteService.create({ chequeIds: [i1], bankAccountId: f.bankTry }, f.adminId, hareketli));
  check("§4a verdiğimiz çek + banka → 400 (gerekçeli)", hBank?.statusCode === 400 && /bankaya teslim edilmez/.test(hBank.message), hBank?.message);
  const hBaska = await hataOf(() => chequeDeliveryNoteService.create({ chequeIds: [i1], cariId: f.cariA }, f.adminId, hareketli));
  check("§4b verdiğimiz çek + başka cari → 400", hBaska?.statusCode === 400 && /verildiği cari farklı/.test(hBaska.message), hBaska?.message);
  const okIssued = await chequeDeliveryNoteService.create({ chequeIds: [i1], cariId: f.cariB }, f.adminId, hareketli);
  check(
    "§4c verdiğimiz çek + kendi carisi → geçiş yok (movement=null, durum ISSUED)",
    (okIssued.data as { movement?: unknown }).movement === null && (await durum(i1)).status === ChequeStatus.ISSUED && (await bagliOlaylar(okIssued.data!.id)).length === 0,
  );

  const p1 = await f.cek();
  const p2 = await f.cek({ status: ChequeStatus.AT_BANK });
  const p3 = await f.cek({ status: ChequeStatus.COLLECTED });
  const p4 = await f.cek({ currency: Currency.USD });
  const ids = [p1, p2, p3, p4];
  const notlarOnce = await prisma.chequeDeliveryNote.count();
  const h = await hataOf(() => chequeDeliveryNoteService.create({ chequeIds: ids, bankAccountId: f.bankTry }, f.adminId, hareketli));
  const rows = (h?.details?.rows ?? []) as Array<{ chequeId: string; reason: string }>;
  check("§4d ⭐ karışık seçim → 409 DELIVERY_ROWS_BLOCKED", h?.statusCode === 409 && h.code === "DELIVERY_ROWS_BLOCKED", h?.message);
  check(
    "§4e ⭐ BÜTÜN engelli satırlar listede (ilk hatada durmaz): AT_BANK · COLLECTED · USD≠TRY",
    rows.length === 3 && [p2, p3, p4].every((id) => rows.some((r) => r.chequeId === id)) && rows.some((r) => /USD çek\/senet bu hesaba işlenemez/.test(r.reason)),
    `${rows.length} satır`,
  );
  check(
    "§4f hiçbir şey yazılmadı (bordro yok, p1 PORTFOLIO, olay yok)",
    (await prisma.chequeDeliveryNote.count()) === notlarOnce && (await durum(p1)).status === ChequeStatus.PORTFOLIO &&
      (await prisma.chequeEvent.count({ where: { chequeId: p1 } })) === 0,
  );
  const h2 = await hataOf(() => chequeDeliveryNoteService.create({ chequeIds: [p1], cariId: f.cariA }, f.adminId, hareketli));
  const r2 = (h2?.details?.rows ?? []) as Array<{ reason: string }>;
  check("§4g çeki veren cariye bordro → satır reddi 'İADE' (tekil ucun mesajı)", h2?.code === "DELIVERY_ROWS_BLOCKED" && /İADE/.test(r2[0]?.reason ?? ""));
  const h3 = await hataOf(() => chequeDeliveryNoteService.create({ chequeIds: [p1], bankAccountId: f.bankTry }, f.adminId, {}));
  check("§4h hareket izni yoksa 403 PERMISSION_DENIED (required finance:cheque)", h3?.statusCode === 403 && h3.code === "PERMISSION_DENIED" && h3.details?.required === "finance:cheque");
}

// ── §5 SERBEST METİN ────────────────────────────────────────────────────────
async function serbestMetin(f: Fikstur): Promise<void> {
  console.log("§5 Serbest metin hedef");
  const s1 = await f.cek();
  const res = await chequeDeliveryNoteService.create({ chequeIds: [s1], targetLabel: "Avukat Ofisi" }, f.adminId, hareketli);
  check(
    "§5a AÇIKKEN de belge-only (movement=null, çek PORTFOLIO, olay yok)",
    (res.data as { movement?: unknown }).movement === null && (await durum(s1)).status === ChequeStatus.PORTFOLIO && (await bagliOlaylar(res.data!.id)).length === 0,
  );
}

// ── §6 TAM İPTAL ────────────────────────────────────────────────────────────
async function tamIptal(f: Fikstur, bankNote: string, cari: Awaited<ReturnType<typeof cariHedefi>>): Promise<void> {
  console.log("§6 Tam iptal (ters yol)");
  const bankItems = (await bagliOlaylar(bankNote)).map((e) => e.chequeId);
  const r = await chequeDeliveryNoteService.cancel(bankNote, "yanlış bankaya teslim", f.adminId, { chequeIds: bankItems, ...hareketli });
  check("§6a banka bordrosu CANCELLED", (await prisma.chequeDeliveryNote.findUniqueOrThrow({ where: { id: bankNote }, select: { status: true } })).status === ChequeDeliveryNoteStatus.CANCELLED && r.data?.cancelled === true);
  const s = await Promise.all(bankItems.map((id) => durum(id)));
  check("§6b çekler PORTFOLIO, başlık bankası düştü", s.every((x) => x.status === ChequeStatus.PORTFOLIO && x.bankAccountId === null));
  const ev = await bagliOlaylar(bankNote);
  check(
    "§6c ⭐ ileri satırlar SİLİNMEDİ + ters olaylar bağlı (2 DEPOSIT + 2 DEPOSIT_CANCEL)",
    ev.filter((e) => e.type === ChequeEventType.DEPOSIT).length === 2 && ev.filter((e) => e.type === ChequeEventType.DEPOSIT_CANCEL).length === 2,
  );
  const doc = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.CHEQUE_DELIVERY_NOTE, sourceId: bankNote }, orderBy: { version: "desc" }, select: { status: true } });
  check("§6d belge VOIDED", doc?.status === PrintedDocStatus.VOIDED);

  // Bayrak SONRADAN kapansa da hareketli bordro hareketiyle döner (bağ seçer, bayrak değil).
  await bayrak(false);
  await chequeDeliveryNoteService.cancel(cari.noteId, "ciro yanlış cariye", f.adminId, { chequeIds: cari.ids, ...hareketli });
  await bayrak(true);
  const tersler = await prisma.cariTransaction.findMany({
    where: { chequeId: { in: cari.ids }, sourceType: CariTxnSource.CHEQUE_ENDORSE_CANCEL },
    select: { reversesTxnId: true },
  });
  check("§6e ⭐ bayrak KAPALIYKEN de hareketli bordro ters kayıtla döner (3 ters satır, reversesTxnId dolu)", tersler.length === 3 && tersler.every((t) => t.reversesTxnId));
  check("§6f ciro carisi bakiyeleri eski yerinde", (await bakiye(f.cariB, Currency.TRY)) === cari.onceTry && (await bakiye(f.cariB, Currency.USD)) === cari.onceUsd);
  const s3 = await Promise.all(cari.ids.map((id) => durum(id)));
  check("§6g çekler ileri olayın fromStatus'una (PORTFOLIO/AT_BANK), ciro carisi düştü", s3[0]?.status === ChequeStatus.PORTFOLIO && s3[1]?.status === ChequeStatus.AT_BANK && s3.every((x) => x.endorsedToCariId === null));
}

// ── §7-§8 İLERLEMİŞ KALEM + KISMİ İPTAL ────────────────────────────────────
async function ilerlemisVeKismi(f: Fikstur): Promise<void> {
  console.log("§7 İlerlemiş kalem + önizleme · §8 kısmi iptal");
  const g1 = await f.cek({ amount: 500 });
  const g2 = await f.cek({ amount: 600 });
  const noteId = (await chequeDeliveryNoteService.create({ chequeIds: [g1, g2], bankAccountId: f.bankTry }, f.adminId, hareketli)).data!.id;
  await chequeService.collect(g1, { bankAccountId: f.bankTry }, f.adminId);
  const h = await hataOf(() => chequeDeliveryNoteService.cancel(noteId, "iptal", f.adminId, { chequeIds: [g1, g2], ...hareketli }));
  const items = (h?.details?.items ?? []) as Array<{ chequeId: string }>;
  check("§7a ⭐ tahsil edilmiş kalem → 409 DELIVERY_ITEMS_ADVANCED, yalnız o listede", h?.code === "DELIVERY_ITEMS_ADVANCED" && items.length === 1 && items[0]?.chequeId === g1, h?.message);
  check("§7b hiçbir şey geri alınmadı (g2 hâlâ AT_BANK)", (await durum(g2)).status === ChequeStatus.AT_BANK);
  const pv = (await chequeDeliveryNoteService.cancelPreview(noteId)).data!;
  const p1 = pv.items.find((i) => i.chequeId === g1);
  const p2 = pv.items.find((i) => i.chequeId === g2);
  check("§7c önizleme: g1 geri alınamaz + neden (tahsil)", p1?.reversible === false && /tahsil/.test(p1.reason ?? ""), p1?.reason ?? "");
  check("§7d önizleme: g2 geri alınabilir, hareket DEPOSIT", p2?.reversible === true && p2.action === "DEPOSIT" && pv.hasMovements);

  await chequeDeliveryNoteService.cancel(noteId, "g2 yanlış", f.adminId, { chequeIds: [g2], ...hareketli });
  const n1 = await prisma.chequeDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { status: true } });
  check("§8a kısmi iptal: g2 PORTFOLIO, bordro ACTIVE", (await durum(g2)).status === ChequeStatus.PORTFOLIO && n1.status === ChequeDeliveryNoteStatus.ACTIVE);
  const doc = await prisma.printedDocument.findFirst({ where: { docType: PrintedDocType.CHEQUE_DELIVERY_NOTE, sourceId: noteId }, orderBy: { version: "desc" }, select: { status: true, version: true } });
  check("§8b donmuş belge DEĞİŞMEDİ (v1 ACTIVE)", doc?.status === PrintedDocStatus.ACTIVE && doc.version === 1);
  const pv2 = (await chequeDeliveryNoteService.cancelPreview(noteId)).data!;
  check("§8c önizleme g2'yi 'geri alındı' gösterir", pv2.items.find((i) => i.chequeId === g2)?.reversed === true);
  const hTekrar = await hataOf(() => chequeDeliveryNoteService.cancel(noteId, "tekrar", f.adminId, { chequeIds: [g2], ...hareketli }));
  check("§8d geri alınmış kalemi yeniden seçmek → 400", hTekrar?.statusCode === 400);

  await chequeService.cancelCollect(g1, "tahsil yanlış", f.adminId);
  await chequeDeliveryNoteService.cancel(noteId, "g1 de yanlış", f.adminId, { chequeIds: [g1], ...hareketli });
  const n2 = await prisma.chequeDeliveryNote.findUniqueOrThrow({ where: { id: noteId }, select: { status: true } });
  check("§8e son canlı kalem → bordro kendiliğinden CANCELLED", n2.status === ChequeDeliveryNoteStatus.CANCELLED && (await durum(g1)).status === ChequeStatus.PORTFOLIO);
}

// ── §9 TEK YOL ──────────────────────────────────────────────────────────────
async function tekYol(f: Fikstur): Promise<void> {
  console.log("§9 Tek yol");
  const t1 = await f.cek();
  const dep = await chequeService.deposit(t1, { bankAccountId: f.bankTry, notes: "tekil not" }, f.adminId);
  const brd = dep.data?.deliveryNote;
  check("§9a ⭐ tekil bankaya verme tek satırlı BRD keser (cevapta deliveryNote)", !!brd && (await notOf(t1)).length === 1 && /BRD/.test(brd.docNo));
  check("§9b olay bordroya bağlı", (await bagliOlaylar(brd!.id)).length === 1);
  const iade = await chequeService.cancelDeposit(t1, "yanlış", f.adminId);
  const n = await prisma.chequeDeliveryNote.findUniqueOrThrow({ where: { id: brd!.id }, select: { status: true } });
  check("§9c tekil storno bordrodan yürür → tek satırlı bordro CANCELLED", n.status === ChequeDeliveryNoteStatus.CANCELLED && (await durum(t1)).status === ChequeStatus.PORTFOLIO && iade.data?.deliveryNote?.id === brd!.id);

  const t2 = await f.cek({ amount: 777 });
  const once = await bakiye(f.cariB, Currency.TRY);
  const end = await chequeService.endorse(t2, { toCariId: f.cariB }, f.adminId);
  check("§9d tekil ciro tek satırlı BRD + ciro carisine BORÇ", !!end.data?.deliveryNote && (await bakiye(f.cariB, Currency.TRY)) - once === 777);
  await chequeService.cancelEndorse(t2, "ciro yanlış", f.adminId);
  check("§9e tekil ciro stornosu bordrodan, bakiye geri", (await bakiye(f.cariB, Currency.TRY)) === once && (await durum(t2)).status === ChequeStatus.PORTFOLIO);

  const hTekrar = await hataOf(() => chequeService.cancelDeposit(t1, "tekrar", f.adminId));
  check("§9f geri alınmış kalemde tekil storno → tekil yolun 409'u (portföyde)", hTekrar?.statusCode === 409 && /portföyde/.test(hTekrar.message), hTekrar?.message);

  // Sahiplik kapısı: bordronun olayını bordrosuz yol da başka bordro da geri ALAMAZ.
  const t4 = await f.cek();
  const n4 = (await chequeDeliveryNoteService.create({ chequeIds: [t4], bankAccountId: f.bankTry }, f.adminId, hareketli)).data!;
  const hBagsiz = await hataOf(() => chequeService.prepareReversalTx(prisma, t4, ChequeEventType.DEPOSIT, null));
  check("§9g ⭐ bağlı olay bordrosuz yoldan geri alınamaz (sahiplik kapısı)", hBagsiz?.statusCode === 409 && hBagsiz.message.includes(n4.docNo), hBagsiz?.message);
  const hBaska = await hataOf(() => chequeService.prepareReversalTx(prisma, t4, ChequeEventType.DEPOSIT, randomUUID()));
  check("§9h ⭐ başka bordro bu olayı geri alamaz", hBaska?.statusCode === 409 && /yeniden hareket etti/.test(hBaska.message), hBaska?.message);

  await bayrak(false);
  const t3 = await f.cek();
  await chequeService.deposit(t3, { bankAccountId: f.bankTry }, f.adminId);
  await bayrak(true);
  await chequeService.cancelDeposit(t3, "eski kayıt", f.adminId);
  check("§9i bağsız eski olay AÇIKKEN de eski yoldan geri alınır (bordro yok)", (await durum(t3)).status === ChequeStatus.PORTFOLIO && (await notOf(t3)).length === 0);

  // AST: DEPOSIT/ENDORSE olayı YALNIZ çekirdekte (`writeForwardTx`) yazılır — ikinci yazar tek yolu deler.
  const kaynak = readFileSync(path.join(__dirname, "../src/services/cheque.service.ts"), "utf8");
  const sf = ts.createSourceFile("cheque.service.ts", kaynak, ts.ScriptTarget.Latest, true);
  const yazarlar: string[] = [];
  const dogrudan: string[] = [];
  const gez = (n: ts.Node, fn: string): void => {
    const ad = ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) ? n.name.text : ts.isFunctionDeclaration(n) && n.name ? n.name.text : fn;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "writeEventTx") {
      const arg = n.arguments[1];
      const tip = arg && ts.isObjectLiteralExpression(arg)
        ? arg.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "type")
        : undefined;
      const deger = tip && ts.isPropertyAssignment(tip) ? tip.initializer.getText(sf) : "";
      if (/ChequeEventType\.(DEPOSIT|ENDORSE)$/.test(deger)) dogrudan.push(`${ad}:${deger}`);
      if (deger === "move.type") yazarlar.push(ad);
    }
    ts.forEachChild(n, (c) => gez(c, ad));
  };
  gez(sf, "");
  check("§9j AST: DEPOSIT/ENDORSE tipli doğrudan writeEventTx yok", dogrudan.length === 0, dogrudan.join(", "));
  check("§9k AST: ileri teslim olayının tek yazarı writeForwardTx", yazarlar.length === 1 && yazarlar[0] === "writeForwardTx", yazarlar.join(", "));
}

// ── §10 EŞZAMANLILIK ────────────────────────────────────────────────────────
const kilitlenme = (r: PromiseSettledResult<unknown>): boolean =>
  r.status === "rejected" && /deadlock|40P01/i.test(String((r.reason as { message?: string })?.message ?? r.reason));

async function eszamanlilik(f: Fikstur): Promise<void> {
  console.log("§10 Eşzamanlılık");
  const k1 = await f.cek();
  const yaris = await Promise.allSettled([
    chequeDeliveryNoteService.create({ chequeIds: [k1], bankAccountId: f.bankTry, clientToken: randomUUID() }, f.adminId, hareketli),
    chequeDeliveryNoteService.create({ chequeIds: [k1], bankAccountId: f.bankTry, clientToken: randomUUID() }, f.adminId, hareketli),
  ]);
  const olay = await prisma.chequeEvent.count({ where: { chequeId: k1, type: ChequeEventType.DEPOSIT } });
  check("§10a aynı çekte iki bordro → biri geçer biri reddedilir, tek DEPOSIT", yaris.filter((r) => r.status === "fulfilled").length === 1 && olay === 1, `olay=${olay}`);

  const k2 = await f.cek();
  const tok = randomUUID();
  const r1 = await chequeDeliveryNoteService.create({ chequeIds: [k2], bankAccountId: f.bankTry, clientToken: tok }, f.adminId, hareketli);
  const r2 = await chequeDeliveryNoteService.create({ chequeIds: [k2], bankAccountId: f.bankTry, clientToken: tok }, f.adminId, hareketli);
  check(
    "§10b aynı token → aynı bordro (replay), hareket yeniden KOŞMAZ",
    r2.data?.replayed === true && r1.data?.id === r2.data?.id && (await prisma.chequeEvent.count({ where: { chequeId: k2 } })) === 1,
  );

  // ⭐ ZORLANMIŞ SIRA: B tekil ciro (1 satırlı bordro) R2'yi claim'ler ve kapıda bekler; A çok satırlı ciro
  // [R1, R2]. Doğru sırada (satır → 8026) A R2'de bekler, 8026'yı TUTMAZ → B biter, A 409. 8026 satırların
  // arasına alınırsa A 8026'yı tutup R2'yi, B R2'yi tutup 8026'yı bekler → PG kilitlenme (40P01).
  const z1 = await f.cek({ amount: 11 });
  const z2 = await f.cek({ amount: 12 });
  // B'nin tx'inde bordro numarası okuması (claim'DEN SONRA — B çek satırını tutar) kapıda bekler.
  const { sonuclar, kapi } = await zorlanmisSira(
    { model: "chequeDeliveryNote", metod: "findMany" },
    () => chequeService.endorse(z2, { toCariId: f.cariB }, f.adminId),
    () => chequeDeliveryNoteService.create({ chequeIds: [z1, z2], cariId: f.cariB }, f.adminId, hareketli),
  );
  const [b, a] = sonuclar;
  check("§10c0 kapı sırayı gerçekten zorladı (A, B'nin tuttuğu satırda bekledi)", SIRA_ZORLANDI.has(kapi), `kapı: ${kapi}`);
  check("§10c ⭐ kilitlenme YOK (satır → 8026 sırası)", !kilitlenme(b) && !kilitlenme(a), `kapı: ${kapi}`);
  check("§10d tekil ciro geçti, çok satırlı bordro 409 (R2 artık ciro edilmiş)", b?.status === "fulfilled" && a?.status === "rejected" && (a.reason as { statusCode?: number }).statusCode === 409, `kapı: ${kapi}`);
  check("§10e z1 yarım kalmadı (PORTFOLIO)", (await durum(z1)).status === ChequeStatus.PORTFOLIO);
}

// ── §11 KAPALI DÖNEM ────────────────────────────────────────────────────────
async function kapaliDonem(f: Fikstur): Promise<void> {
  console.log("§11 Kapalı dönem teslim tarihiyle");
  const kapanis = await prisma.cariPeriodClose.create({
    data: { cariId: f.cariB, currency: Currency.TRY, periodEnd: new Date(Date.now() - 20 * DAY), closingBalance: 0, txnCount: 0 },
    select: { id: true },
  });
  olusan.periodCloseIds.push(kapanis.id);
  const c = await f.cek({ amount: 55 });
  const notlarOnce = await prisma.chequeDeliveryNote.count();
  const h = await hataOf(() =>
    chequeDeliveryNoteService.create({ chequeIds: [c], cariId: f.cariB, deliveryDate: new Date(Date.now() - 30 * DAY) }, f.adminId, hareketli),
  );
  check("§11a teslim tarihi kapalı dönemde → 409 (kontrol deliveryDate ile)", h?.statusCode === 409 && /KAPALI|kapalı/.test(h.message), h?.message);
  check("§11b hiçbir şey yazılmadı", (await prisma.chequeDeliveryNote.count()) === notlarOnce && (await durum(c)).status === ChequeStatus.PORTFOLIO);
  const ok = await chequeDeliveryNoteService.create({ chequeIds: [c], cariId: f.cariB }, f.adminId, hareketli);
  check("§11c bugünkü teslim açık dönemde geçer", ok.success && (await durum(c)).status === ChequeStatus.ENDORSED);
}

// ── §12 HTTP: İZİN + ESKİ İSTEMCİ ──────────────────────────────────────────
async function http(f: Fikstur, admin: { username: string; password: string }): Promise<void> {
  console.log("§12 HTTP — izin + eski istemci");
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; details?: { code?: string } };
    return { status: r.status, body: json };
  };
  const login = async (username: string, password: string) => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, clientType: "electron" }),
    });
    return ((await r.json()) as { data?: { token?: string } }).data?.token ?? "";
  };
  const bcrypt = await import("bcryptjs");
  const parola = kosumaOzguParola();
  const kullanici = async (ek: string, kodlar: string[]) => {
    const izinler = await prisma.permission.findMany({ where: { code: { in: kodlar } }, select: { id: true } });
    const u = await prisma.user.create({
      data: {
        username: `${TAG}-${ek}`.toLowerCase(),
        passwordHash: await bcrypt.hash(parola, 10),
        fullName: `${TAG} ${ek}`,
        isActive: true,
        permissions: { create: izinler.map((p) => ({ permissionId: p.id, grantedById: f.adminId })) },
      },
      select: { id: true, username: true },
    });
    olusan.userIds.push(u.id);
    return login(u.username, parola);
  };
  const yazici = await kullanici("yazici", ["finance:read", "finance:write"]);
  const kasiyer = await kullanici("kasiyer", ["finance:read", "finance:cheque"]);
  const adminTok = await login(admin.username, admin.password);
  const P = "/api/finance/cheque-delivery-notes";

  const h1 = await f.cek();
  const r1 = await call("POST", P, yazici, { chequeIds: [h1], bankAccountId: f.bankTry });
  check("§12a yalnız finance:write → hareketli bordro 403 (required finance:cheque)", r1.status === 403 && r1.body.details?.code === "PERMISSION_DENIED", `status=${r1.status}`);
  const r2 = await call("POST", P, yazici, { chequeIds: [h1], targetLabel: "Noter" });
  check("§12b yalnız finance:write → serbest metin bordro 201 (belge-only)", r2.status === 201 && (await durum(h1)).status === ChequeStatus.PORTFOLIO, `status=${r2.status}`);
  const r3 = await call("POST", `/api/finance/cheques/${h1}/deposit`, kasiyer, { bankAccountId: f.bankTry });
  check("§12c kasiyer (finance:cheque) tekil bankaya verme → 200 + deliveryNote", r3.status === 200 && !!(r3.body.data as { deliveryNote?: unknown })?.deliveryNote, `status=${r3.status}`);
  const r4 = await call("POST", P, kasiyer, { chequeIds: [await f.cek()], bankAccountId: f.bankTry });
  check("§12d kasiyer çok satırlı bordro kesemez (finance:write yok → 403)", r4.status === 403, `status=${r4.status}`);

  const h2 = await f.cek();
  const r5 = await call("POST", P, adminTok, { chequeIds: [h2], bankAccountId: f.bankTry });
  const noteId = r5.body.data?.id as string;
  const pv = await call("GET", `${P}/${noteId}/cancel-preview`, yazici);
  check("§12e önizleme finance:read ile 200", pv.status === 200 && Array.isArray((pv.body.data as { items?: unknown[] })?.items));
  const eski = await call("POST", `${P}/${noteId}/cancel`, adminTok, { reason: "eski panel" });
  check("§12f ⭐ eski istemci (chequeIds yok) → 409 DELIVERY_NOTE_HAS_MOVEMENTS, çek yerinde", eski.status === 409 && eski.body.details?.code === "DELIVERY_NOTE_HAS_MOVEMENTS" && (await durum(h2)).status === ChequeStatus.AT_BANK, `status=${eski.status}`);
  const sebepsiz = await call("POST", `${P}/${noteId}/cancel`, adminTok, { chequeIds: [h2] });
  check("§12g hareketli iptalde sebep zorunlu → 400", sebepsiz.status === 400, `status=${sebepsiz.status}`);
  const yaziciIptal = await call("POST", `${P}/${noteId}/cancel`, yazici, { reason: "x", chequeIds: [h2] });
  check("§12h yalnız finance:write → hareketli iptal 403", yaziciIptal.status === 403, `status=${yaziciIptal.status}`);
  const yeni = await call("POST", `${P}/${noteId}/cancel`, adminTok, { reason: "yanlış", chequeIds: [h2] });
  check("§12i seçimli iptal 200 + çek PORTFOLIO", yeni.status === 200 && (await durum(h2)).status === ChequeStatus.PORTFOLIO, `status=${yeni.status}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    fail++;
    return;
  }
  console.log("=== Çek teslim bordrosu: hareket fişi (K3) ===\n");
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  await ayar(FIN, true);
  const f = await fikstur(admin.id);

  await kapaliKol(f);
  const bankNote = await bankaHedefi(f);
  const cari = await cariHedefi(f);
  await kuralTablosu(f);
  await serbestMetin(f);
  await tamIptal(f, bankNote, cari);
  await ilerlemisVeKismi(f);
  await tekYol(f);
  await eszamanlilik(f);
  await kapaliDonem(f);
  await http(f, admin);
}

async function temizlik(): Promise<void> {
  const adim = async (ad: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      fail++;
      console.error(`  ❌ temizlik "${ad}" düştü: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  if (server) await adim("sunucu", () => new Promise<void>((r, j) => server!.close((e) => (e ? j(e) : r()))));
  for (const [key, eski] of ayarYedek) {
    await adim(`${key} geri`, () =>
      eski
        ? prisma.systemSetting.update({ where: { key }, data: { value: eski.value as never } })
        : prisma.systemSetting.delete({ where: { key } }),
    );
  }
  // Küme fikstürden türetilir: sondada kaydı yazılmamış bordro da çeklere bağlıdır.
  const noteIds = olusan.chequeIds.length
    ? [...new Set((await prisma.chequeDeliveryNoteItem.findMany({ where: { chequeId: { in: olusan.chequeIds } }, select: { noteId: true } })).map((n) => n.noteId))]
    : [];
  if (olusan.chequeIds.length) {
    // Olay → bordro FK'sı (Restrict): olaylar bordrodan ÖNCE.
    await adim("çek olayları", () => prisma.chequeEvent.deleteMany({ where: { chequeId: { in: olusan.chequeIds } } }));
    await adim("cari satırları (ters önce)", () => prisma.cariTransaction.deleteMany({ where: { chequeId: { in: olusan.chequeIds }, reversesTxnId: { not: null } } }));
    await adim("cari satırları", () => prisma.cariTransaction.deleteMany({ where: { chequeId: { in: olusan.chequeIds } } }));
  }
  if (noteIds.length) {
    await adim("bordro kalemleri", () => prisma.chequeDeliveryNoteItem.deleteMany({ where: { noteId: { in: noteIds } } }));
    await adim("bordrolar", () => prisma.chequeDeliveryNote.deleteMany({ where: { id: { in: noteIds } } }));
    await adim("donmuş belgeler", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: noteIds } } }));
  }
  if (olusan.chequeIds.length) await adim("çekler", () => prisma.cheque.deleteMany({ where: { id: { in: olusan.chequeIds } } }));
  if (olusan.periodCloseIds.length) await adim("dönem kapanışı", () => prisma.cariPeriodClose.deleteMany({ where: { id: { in: olusan.periodCloseIds } } }));
  if (olusan.cariIds.length) {
    await adim("cari bakiye", () => prisma.cariBalance.deleteMany({ where: { cariId: { in: olusan.cariIds } } }));
    await adim("cari", () => prisma.cariAccount.deleteMany({ where: { id: { in: olusan.cariIds } } }));
  }
  if (olusan.bankIds.length) await adim("banka", () => prisma.bankAccount.deleteMany({ where: { id: { in: olusan.bankIds } } }));
  if (olusan.customerIds.length) await adim("müşteri", () => prisma.customer.deleteMany({ where: { id: { in: olusan.customerIds } } }));
  for (const id of olusan.userIds) {
    await adim("oturum", () => prisma.session.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı logları", () => prisma.systemLog.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı izinleri", () => prisma.userPermission.deleteMany({ where: { userId: id } }));
    await adim("kullanıcı", () => prisma.user.delete({ where: { id } }));
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e instanceof Error ? e.stack : e);
    fail++;
  })
  .finally(async () => {
    await temizlik();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
