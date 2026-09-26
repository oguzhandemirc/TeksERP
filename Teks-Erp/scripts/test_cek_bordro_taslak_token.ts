// =============================================================================
// Bekçi: ÇEK TESLİM BORDROSU — TASLAK = RESMÎ + clientToken REPLAY (DB'li)
// Çalıştır: npx tsx scripts/test_cek_bordro_taslak_token.ts
// =============================================================================
// K1 (1e kararı 2026-09-26): resmî bordro (BRD) TEK belgedir; panelin eski anlık
// bordrosu onun numarasız TASLAĞIdır. Bu bekçi üç sözü ölçer:
//   §2 Taslak hiçbir şey yazmaz ve kayıtla AYNI seçim kapılarından geçer (aynı mesaj).
//   §3 Taslağın tabloları, aynı seçimden kesilen resmî bordronun tablolarıyla aynı.
//   §4 `clientToken` replay dört durumu: aynı token + aynı gövde → aynı BRD · aynı
//      token + farklı gövde → 409 · token sürerken ikinci istek → tek BRD · kesin
//      4xx sonrası aynı token → yapışmaz, düzeltilmiş gövdeyle kayıt açılır; ek olarak
//      iptal edilmiş bordronun token'ı → 409 DELIVERY_NOTE_CANCELLED. ③c: yarışın cevabı
//      token'dan gelir, iş kuralından değil (token kilidi 8036; sıra zorlanarak ölçülür).
//   §5 HTTP: taslak `finance:read` ile açılır (anlık bordroyu basan kullanıcı yetki
//      kaybetmez), kayıt `finance:write` ister; replay 200, ilk kayıt 201.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { CariKind, ChequeDocType, ChequeKind, ChequeStatus, Currency, PrintedDocType } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { chequeDeliveryNoteService } from "../src/services/cheque-delivery-note.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { ensureTestAdmin, kosumaOzguParola } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { zorlanmisSira } from "./lib/zorlanmis-sira";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

type Hata = { message: string; code?: string; statusCode?: number } | null;
async function hataOf(fn: () => Promise<unknown>): Promise<Hata> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { message: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message, code: err.details?.code, statusCode: err.statusCode };
  }
}

const TAG = `D8K${Date.now().toString(36).toUpperCase()}`;
const DAY = 864e5;
const asOf = new Date("2026-09-26T09:00:00.000Z");

const olusan = {
  customerId: null as string | null,
  cariId: null as string | null,
  bankAccountId: null as string | null,
  chequeIds: [] as string[],
  userIds: [] as string[],
};
let flagSatiriVardi: { value: unknown } | null = null;
let flagDokunuldu = false;
let server: Server | null = null;

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`\n❌ ${engel}\n`);
    fail++;
    return;
  }
  console.log("=== Çek teslim bordrosu: taslak + clientToken ===\n");

  // ── §1 FİKSTÜR ────────────────────────────────────────────────────────────
  const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
  const customer = await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } });
  olusan.customerId = customer.id;
  const cari = await prisma.cariAccount.create({ data: { kind: CariKind.CUSTOMER, customerId: customer.id }, select: { id: true } });
  olusan.cariId = cari.id;
  const bank = await prisma.bankAccount.create({
    data: { code: `${TAG}-B`, name: `${TAG} Banka`, currency: Currency.TRY },
    select: { id: true, name: true },
  });
  olusan.bankAccountId = bank.id;

  let seq = 0;
  const cek = async (kind: ChequeKind, amount: number, currency: Currency = Currency.TRY, status: ChequeStatus = ChequeStatus.PORTFOLIO, dueDays = 30) => {
    seq++;
    const c = await prisma.cheque.create({
      data: {
        docNo: `${TAG}-${seq}`,
        kind,
        docType: ChequeDocType.CHEQUE,
        status,
        cariId: cari.id,
        currency,
        exchangeRate: 1,
        amount,
        amountTry: amount,
        issueDate: new Date(asOf.getTime() - 3 * DAY),
        postingDate: new Date(asOf.getTime() - 3 * DAY),
        dueDate: new Date(asOf.getTime() + dueDays * DAY),
        serialNo: seq % 2 ? `SR-${seq}` : null,
        bankName: seq % 3 ? "Test Bankası" : null,
        drawerName: `${TAG} Keşideci & <Ortak>`,
      },
      select: { id: true },
    });
    olusan.chequeIds.push(c.id);
    return c.id;
  };
  const R = ChequeKind.RECEIVED;
  const c1 = await cek(R, 1500, Currency.TRY, ChequeStatus.PORTFOLIO, 40);
  const c2 = await cek(R, 2500.5, Currency.TRY, ChequeStatus.PORTFOLIO, 10);
  const c3 = await cek(R, 300, Currency.USD, ChequeStatus.PORTFOLIO, 20);
  const cIssued = await cek(ChequeKind.ISSUED, 900, Currency.TRY, ChequeStatus.ISSUED);
  const cCancelled = await cek(R, 100, Currency.TRY, ChequeStatus.CANCELLED);
  const c5 = await cek(R, 50);
  const c6 = await cek(R, 60);
  const c7 = await cek(R, 70);
  const c8 = await cek(R, 80);
  const c9 = await cek(R, 90);
  const c10 = await cek(R, 100);
  const c11 = await cek(R, 110);
  const c12 = await cek(R, 120);
  const c13 = await cek(R, 130);

  const fixtureNoteCount = () =>
    prisma.chequeDeliveryNote.count({ where: { items: { some: { chequeId: { in: olusan.chequeIds } } } } });
  const tokenNoteCount = (t: string) => prisma.chequeDeliveryNote.count({ where: { clientToken: t } });

  // ── §2 TASLAK hiçbir şey yazmaz; kayıtla AYNI kapılar ──────────────────────
  console.log("§2 Taslak — numarasız, yazmaz, kayıtla aynı kapılar");
  const girdi = {
    chequeIds: [c1, c2, c3],
    deliveryDate: asOf,
    bankAccountId: bank.id,
    targetLabel: "Kadıköy Şb.",
    notes: `${TAG} not <b>`,
  };
  const notesBefore = await prisma.chequeDeliveryNote.count();
  const docsBefore = await prisma.printedDocument.count();
  const taslak = await chequeDeliveryNoteService.draft(girdi, admin.id);
  const th = taslak.data!.html;
  const tt = taslak.data!.tables;
  check("TASLAK filigranı basılı", th.includes('<div class="wm wm-draft">TASLAK</div>'));
  check("belge numarası yok — 'Belge No: TASLAK'", th.includes("Belge No: <b>TASLAK</b>") && !/BRD\d/.test(th));
  check("Excel başlığı TASLAK ile başlar", tt.header[0]?.[0] === "TASLAK" && tt.header[0]?.[1] === null);
  check("üç çek, kâğıt sırasıyla (vade: c2, c3, c1)",
    JSON.stringify(tt.tables[0]?.rows.map((r) => r[1])) === JSON.stringify([`${TAG}-2`, `${TAG}-3`, `${TAG}-1`]),
    JSON.stringify(tt.tables[0]?.rows.map((r) => r[1])));
  check("hedef = banka adı — serbest metin", tt.header.some(([l, v]) => l === "Teslim Edilen Banka" && v === `${bank.name} — Kadıköy Şb.`));
  check("taslak kayıt yazmadı (bordro sayısı aynı)", (await prisma.chequeDeliveryNote.count()) === notesBefore);
  check("taslak belge dondurmadı (printedDocument sayısı aynı)", (await prisma.printedDocument.count()) === docsBefore);

  const kapilar: Array<[string, Record<string, unknown>]> = [
    ["karışık yön", { chequeIds: [c1, cIssued] }],
    ["iptal edilmiş kayıt", { chequeIds: [c1, cCancelled] }],
    ["çift hedef", { chequeIds: [c1], bankAccountId: bank.id, cariId: cari.id }],
    ["boş seçim", { chequeIds: [] }],
    ["bulunamayan çek", { chequeIds: [c1, randomUUID()] }],
  ];
  for (const [ad, g] of kapilar) {
    const d = await hataOf(() => chequeDeliveryNoteService.draft(g as never, admin.id));
    const k = await hataOf(() => chequeDeliveryNoteService.create(g as never, admin.id));
    check(`${ad}: taslak ve kayıt AYNI 400 mesajı`, d?.statusCode === 400 && d?.message === k?.message, `${d?.message} | ${k?.message}`);
  }
  check("kapı denemeleri kayıt yazmadı", (await fixtureNoteCount()) === 0);

  // ── §3 TASLAK tabloları = RESMÎ bordronun tabloları ─────────────────────────
  console.log("§3 Taslak = resmî (aynı seçim, aynı çözücü)");
  const t0 = randomUUID();
  const kayit = await chequeDeliveryNoteService.create({ ...girdi, clientToken: t0 }, admin.id);
  const noteId = kayit.data!.id;
  check("kayıt BRD numarası aldı", /^BRD/.test(kayit.data!.docNo), kayit.data!.docNo);
  check("ilk kayıt replay DEĞİL", kayit.data!.replayed === undefined);
  const resmi = (await printedDocumentService.getTables(PrintedDocType.CHEQUE_DELIVERY_NOTE, noteId)).data!;
  check("resmî bordro Excel tablosu üretir (renderTables kayıtlı)", resmi.tables.length === 1 && resmi.tables[0]!.rows.length === 3);
  check("⭐ çek tablosu taslakla HÜCRE HÜCRE aynı", JSON.stringify(resmi.tables) === JSON.stringify(tt.tables));
  check("dipnotlar (ara toplam · beyan · not) aynı", JSON.stringify(resmi.notes) === JSON.stringify(tt.notes));
  const hdrFark = (h: Array<[string, string | null]>) => h.filter(([l]) => l !== "TASLAK" && l !== "Belge No");
  check("başlık bloğu yalnız TASLAK satırı ve belge no'da ayrışır",
    JSON.stringify(hdrFark(resmi.header)) === JSON.stringify(hdrFark(tt.header)),
    JSON.stringify(resmi.header));
  check("resmî Excel'de belge no BRD", resmi.header.some(([l, v]) => l === "Belge No" && v === kayit.data!.docNo));

  // ── §4 clientToken REPLAY ────────────────────────────────────────────────────
  console.log("§4 clientToken replay");
  const tekrar = await chequeDeliveryNoteService.create({ ...girdi, clientToken: t0 }, admin.id).catch((e: Error) => ({ data: null, message: e.message }));
  check("① aynı token + aynı gövde → AYNI BRD, replayed", tekrar.data?.id === noteId && tekrar.data?.replayed === true, tekrar.message ?? "");
  check("① ikinci BRD açılmadı", (await tokenNoteCount(t0)) === 1 && (await fixtureNoteCount()) === 1);
  const tekrarTarihsiz = await chequeDeliveryNoteService.create({ ...girdi, deliveryDate: undefined, clientToken: t0 }, admin.id);
  check("① tarih gönderilmezse ('şimdi') yine aynı BRD", tekrarTarihsiz.data!.id === noteId);

  const carpisma = await hataOf(() => chequeDeliveryNoteService.create({ ...girdi, chequeIds: [c1], clientToken: t0 }, admin.id));
  check("② aynı token + farklı çek kümesi → 409 CLIENT_TOKEN_COLLISION", carpisma?.statusCode === 409 && carpisma.code === "CLIENT_TOKEN_COLLISION", `${carpisma?.code}`);
  const carpisma2 = await hataOf(() => chequeDeliveryNoteService.create({ ...girdi, targetLabel: "başka yer", clientToken: t0 }, admin.id));
  check("② aynı token + farklı hedef metni → 409 CLIENT_TOKEN_COLLISION", carpisma2?.code === "CLIENT_TOKEN_COLLISION");
  check("② çarpışma kayıt yazmadı", (await fixtureNoteCount()) === 1);

  const t2 = randomUUID();
  const eszamanli = await Promise.allSettled([
    chequeDeliveryNoteService.create({ chequeIds: [c5, c6], clientToken: t2 }, admin.id),
    chequeDeliveryNoteService.create({ chequeIds: [c5, c6], clientToken: t2 }, admin.id),
  ]);
  const basarili = eszamanli.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof chequeDeliveryNoteService.create>>>).value);
  check("③ token sürerken ikinci istek: ikisi de başarılı", basarili.length === 2,
    eszamanli.map((r) => (r.status === "rejected" ? String((r.reason as Error).message) : "ok")).join(" | "));
  check("③ ikisi AYNI BRD'yi döner", basarili.length === 2 && basarili[0]!.data!.id === basarili[1]!.data!.id);
  check("③ tek BRD yazıldı, biri replay", (await tokenNoteCount(t2)) === 1 && basarili.filter((b) => b.data!.replayed).length === 1);

  // ③b Aynı token'lı yarışın cevabı token'dan gelir, iş kuralından ("zaten aktif bordroda")
  // DEĞİL: kaybeden 409 ALREADY_IN_ACTIVE_NOTE alırsa panel token'ı bırakır ve onay bandı
  // aynı denemeden ikinci BRD kestirir. Farklı gövdede gün farklı → `docNo` çarpışmaz.
  const kodOf = (r: PromiseSettledResult<unknown>) =>
    r.status === "fulfilled" ? "ok" : String((r.reason as { details?: { code?: string } }).details?.code ?? (r.reason as Error).message.slice(0, 60));
  const t2a = randomUUID();
  const ayniYaris = await Promise.allSettled(
    [1, 2, 3, 4].map(() => chequeDeliveryNoteService.create({ chequeIds: [c11], deliveryDate: asOf, clientToken: t2a }, admin.id)),
  );
  const ayniOk = ayniYaris.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof chequeDeliveryNoteService.create>>>).value.data!);
  check("③b aynı gövde, dört eşzamanlı: tek BRD, dördü başarılı (biri yeni, üçü replay)",
    ayniOk.length === 4 && new Set(ayniOk.map((d) => d.id)).size === 1 && ayniOk.filter((d) => d.replayed).length === 3 && (await tokenNoteCount(t2a)) === 1,
    ayniYaris.map(kodOf).join(" | "));

  const t2b = randomUUID();
  const gunler = [1, 2, 3, 4].map((k) => new Date(asOf.getTime() + k * DAY));
  const yaris = await Promise.allSettled(
    gunler.map((d) => chequeDeliveryNoteService.create({ chequeIds: [c10], deliveryDate: d, clientToken: t2b }, admin.id)),
  );
  const yarisKod = yaris.map(kodOf);
  check("③b farklı gövde, dört eşzamanlı: tek BRD, üçü 409 CLIENT_TOKEN_COLLISION (ham P2002 yok)",
    yarisKod.filter((k) => k === "ok").length === 1 && yarisKod.filter((k) => k === "CLIENT_TOKEN_COLLISION").length === 3 && (await tokenNoteCount(t2b)) === 1,
    yarisKod.join(" | "));

  // ③c ZORLANMIŞ SIRA — ③b'nin yükle açılan penceresi deterministik: B token'ı okuyup
  // seçimde bekletilir, A koşar; B, A bitince ya da A bir kilitte beklerken devam eder.
  for (const [ad, cekId, aGunu] of [["aynı gövde", c12, asOf], ["farklı gövde", c13, new Date(asOf.getTime() + DAY)]] as const) {
    const t = randomUUID();
    // B token'ı okuduktan sonra seçim okumasında (tx'teki ilk `cheque.findMany`) bekletilir.
    const s = await zorlanmisSira(
      { model: "cheque", metod: "findMany" },
      () => chequeDeliveryNoteService.create({ chequeIds: [cekId], deliveryDate: asOf, clientToken: t }, admin.id),
      () => chequeDeliveryNoteService.create({ chequeIds: [cekId], deliveryDate: aGunu, clientToken: t }, admin.id),
    );
    const kodlar = s.sonuclar.map(kodOf);
    const ok = s.sonuclar.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof chequeDeliveryNoteService.create>>>).value.data!);
    const beklenen = ad === "aynı gövde"
      ? ok.length === 2 && ok[0]!.id === ok[1]!.id && ok.filter((d) => d.replayed).length === 1
      : ok.length === 1 && kodlar.filter((k) => k === "CLIENT_TOKEN_COLLISION").length === 1;
    check(`③c zorlanmış sıra, ${ad}: tek BRD, kaybeden ${ad === "aynı gövde" ? "replay" : "409 CLIENT_TOKEN_COLLISION"} (iş kuralı 409'u değil)`,
      beklenen && (await tokenNoteCount(t)) === 1,
      `B | A = ${kodlar.join(" | ")} · kapı: ${s.kapi}`);
  }

  const t3 = randomUUID();
  const kesin = await hataOf(() => chequeDeliveryNoteService.create({ chequeIds: [c7, cIssued], clientToken: t3 }, admin.id));
  check("④ kesin 4xx (karışık yön) → 400", kesin?.statusCode === 400, kesin?.message);
  check("④ 4xx token'ı YAPIŞTIRMADI (satır yok)", (await tokenNoteCount(t3)) === 0);
  const duzeltilmis = await chequeDeliveryNoteService.create({ chequeIds: [c7], clientToken: t3 }, admin.id);
  check("④ aynı token + düzeltilmiş gövde → YENİ BRD (replay değil)", !duzeltilmis.data!.replayed && (await tokenNoteCount(t3)) === 1);

  await chequeDeliveryNoteService.cancel(noteId, `${TAG} iptal`, admin.id);
  const iptal = await hataOf(() => chequeDeliveryNoteService.create({ ...girdi, clientToken: t0 }, admin.id));
  check("⑤ iptal edilmiş bordronun token'ı → 409 DELIVERY_NOTE_CANCELLED", iptal?.statusCode === 409 && iptal.code === "DELIVERY_NOTE_CANCELLED", `${iptal?.code}`);

  // ── §5 HTTP — izin ve durum kodları ─────────────────────────────────────────
  console.log("§5 HTTP");
  flagSatiriVardi = await prisma.systemSetting.findUnique({ where: { key: "finance.enabled" }, select: { value: true } });
  flagDokunuldu = true;
  await prisma.systemSetting.upsert({
    where: { key: "finance.enabled" },
    update: { value: true },
    create: { key: "finance.enabled", value: true },
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await r.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: r.status, body: json };
  };
  const login = async (username: string, password: string) => {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, clientType: "electron" }),
    });
    const j = (await r.json()) as { data?: { token?: string } };
    return j.data?.token ?? "";
  };
  const adminToken = await login(admin.username, admin.password);
  check("admin login", adminToken.length > 0);

  const bcrypt = await import("bcryptjs");
  const parola = kosumaOzguParola();
  const okuma = await prisma.permission.findFirstOrThrow({ where: { code: "finance:read" }, select: { id: true } });
  const dar = await prisma.user.create({
    data: {
      username: `${TAG}-dar`.toLowerCase(),
      passwordHash: await bcrypt.hash(parola, 10),
      fullName: `${TAG} Yalnız Okuma`,
      isActive: true,
      permissions: { create: { permissionId: okuma.id, grantedById: admin.id } },
    },
    select: { id: true, username: true },
  });
  olusan.userIds.push(dar.id);
  const darToken = await login(dar.username, parola);
  check("finance:read kullanıcısı login", darToken.length > 0);

  const P = "/api/finance/cheque-delivery-notes";
  const hDraft = await call("POST", `${P}/draft`, darToken, { chequeIds: [c8, c9] });
  const hData = (hDraft.body.data ?? {}) as { html?: string; tables?: { tables?: unknown[] } };
  check("⭐ taslak finance:read ile 200 (anlık bordroyu basan yetki kaybetmez)", hDraft.status === 200 && !!hData.html && (hData.tables?.tables?.length ?? 0) === 1, `status=${hDraft.status}`);
  const hDarKayit = await call("POST", P, darToken, { chequeIds: [c8, c9], clientToken: randomUUID() });
  check("kayıt finance:read ile 403", hDarKayit.status === 403, `status=${hDarKayit.status}`);
  const hKotuToken = await call("POST", P, adminToken, { chequeIds: [c8, c9], clientToken: "abc" });
  check("uuid olmayan clientToken → 400", hKotuToken.status === 400, `status=${hKotuToken.status}`);
  const t4 = randomUUID();
  const h1 = await call("POST", P, adminToken, { chequeIds: [c8, c9], clientToken: t4 });
  const h2 = await call("POST", P, adminToken, { chequeIds: [c8, c9], clientToken: t4 });
  const id1 = (h1.body.data as { id?: string } | undefined)?.id;
  const id2 = (h2.body.data as { id?: string; replayed?: boolean } | undefined)?.id;
  check("ilk kayıt 201", h1.status === 201, `status=${h1.status}`);
  check("aynı token tekrarı 200 + aynı id + replayed", h2.status === 200 && id1 === id2 && (h2.body.data as { replayed?: boolean }).replayed === true, `status=${h2.status}`);
  const hTables = await call("GET", `/api/printed-documents/CHEQUE_DELIVERY_NOTE/${id1}/tables`, darToken);
  check("resmî bordro Excel ucu finance:read ile 200", hTables.status === 200 && Array.isArray((hTables.body.data as { tables?: unknown[] })?.tables), `status=${hTables.status}`);
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
  if (flagDokunuldu) {
    await adim("finance.enabled geri", () =>
      flagSatiriVardi
        ? prisma.systemSetting.update({ where: { key: "finance.enabled" }, data: { value: flagSatiriVardi.value as never } })
        : prisma.systemSetting.delete({ where: { key: "finance.enabled" } }),
    );
  }
  // Küme fikstürden türetilir (test gövdesinin id defterinden değil): sonda turunda
  // kaydı yazılmamış bir bordro da çeklere bağlıdır.
  const notlar = olusan.chequeIds.length
    ? (await prisma.chequeDeliveryNoteItem.findMany({ where: { chequeId: { in: olusan.chequeIds } }, select: { noteId: true } })).map((n) => n.noteId)
    : [];
  const noteIds = [...new Set(notlar)];
  if (noteIds.length) {
    await adim("bordro kalemleri", () => prisma.chequeDeliveryNoteItem.deleteMany({ where: { noteId: { in: noteIds } } }));
    await adim("bordrolar", () => prisma.chequeDeliveryNote.deleteMany({ where: { id: { in: noteIds } } }));
    await adim("donmuş belgeler", () => prisma.printedDocument.deleteMany({ where: { sourceId: { in: noteIds } } }));
  }
  if (olusan.chequeIds.length) {
    await adim("çek olayları", () => prisma.chequeEvent.deleteMany({ where: { chequeId: { in: olusan.chequeIds } } }));
    await adim("çekler", () => prisma.cheque.deleteMany({ where: { id: { in: olusan.chequeIds } } }));
  }
  if (olusan.cariId) {
    await adim("cari bakiye", () => prisma.cariBalance.deleteMany({ where: { cariId: olusan.cariId! } }));
    await adim("cari", () => prisma.cariAccount.deleteMany({ where: { id: olusan.cariId! } }));
  }
  if (olusan.bankAccountId) await adim("banka", () => prisma.bankAccount.deleteMany({ where: { id: olusan.bankAccountId! } }));
  if (olusan.customerId) await adim("müşteri", () => prisma.customer.deleteMany({ where: { id: olusan.customerId! } }));
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
