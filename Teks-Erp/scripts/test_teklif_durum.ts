// =============================================================================
// SATIŞ TEKLİFİ DURUM MAKİNESİ BEKÇİSİ (MAL-4; plan §3.3) — DB'li, yalnız test DB
// =============================================================================
// Ölçülenler:
//   §1 geçiş matrisi: her geçiş × her başlangıç durumu — izinli olan geçer, diğeri 409 QUOTE_STATUS_CONFLICT
//      (ölü durumlardan hiçbir geçiş çıkmaz)
//   §2 süresi dolan SENT kabul → 409 QUOTE_EXPIRED, durum SENT kalır
//   §3 "süresi doldu" bellek yüklemi ↔ Prisma parçası boğaz-ikiz (aynı kümeyi verir)
//   §4 DRAFT dışı düzenleme kilidi 409 (SENT teklif değişmez)
//   §5 revizyon: eski SUPERSEDED (+damga), yeni DRAFT aynı numara revisionNo+1, kalemler snapshot'la kopya;
//      aynı token replay aynı revizyonu döner; SUPERSEDED'ın ikinci revizyonu 409
//   §6 DB seddi: CONVERTED ⇔ sipariş bağı (ham SQL ihlali reddedilir), kur > 0, TRY kuru 1
//   §7 `statusChangedAt` trigger'ı: yalnız durum değişince tazelenir, uygulama yazamaz
//   §8 kalemsiz gönderim 400 QUOTE_EMPTY (DRAFT kalır) · ret sebebi zorunlu · kabulü geri al damgayı düşürür
//   §9 iki paralel gönderim → biri geçer, öteki 409
// Koşum: npx tsx scripts/test_teklif_durum.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import type { SalesQuoteStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import * as tr from "../src/services/sales-quote-transitions.service";
import {
  QUOTE_DEAD_STATUSES,
  QUOTE_TRANSITIONS,
  claimDraftQuoteTx,
  isQuoteExpired,
  quoteExpiredWhere,
  quoteToday,
} from "../src/services/helpers/sales-quote-state.helper";
import { teklifFiksturKur, teklifFiksturSil, teklifYaz, type TeklifFikstur } from "./lib/teklif-fikstur";
import { assertGelistirmeVeritabani } from "./db-guard";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<{ status?: number; code?: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string }; code?: string };
    return { status: err.statusCode, code: err.details?.code ?? err.code };
  }
}
const statusOf = async (id: string) => (await prisma.salesQuote.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

// convert (ACCEPTED → CONVERTED) sipariş doğuşuyla aynı tx'tedir — `test_teklif_donusum` ölçer.
const RUN: Record<Exclude<keyof typeof QUOTE_TRANSITIONS, "convert">, (id: string) => Promise<unknown>> = {
  send: (id) => tr.sendQuote(id),
  accept: (id) => tr.acceptQuote(id, {}),
  reject: (id) => tr.rejectQuote(id, { reason: "fiyat yüksek" }),
  cancel: (id) => tr.cancelQuote(id, { reason: "müşteri vazgeçti" }),
  unaccept: (id) => tr.unacceptQuote(id),
  revise: (id) => tr.reviseQuote(id, { clientToken: randomUUID() }),
};
const BASLANGIC: SalesQuoteStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "CANCELLED", "SUPERSEDED"];

async function main(): Promise<void> {
  assertGelistirmeVeritabani("test_teklif_durum");
  const f: TeklifFikstur = await teklifFiksturKur("TKD");
  try {
    // §1 matris
    let hucre = 0;
    for (const [ad, run] of Object.entries(RUN) as Array<[keyof typeof RUN, (id: string) => Promise<unknown>]>) {
      const t = QUOTE_TRANSITIONS[ad];
      for (const from of BASLANGIC) {
        const id = await teklifYaz(f, from);
        const izinli = (t.from as readonly SalesQuoteStatus[]).includes(from);
        const h = await hata(() => run(id));
        const after = await statusOf(id);
        hucre++;
        if (izinli) check(`§1 ${ad}: ${from} → ${t.to}`, h === null && after === t.to, h ? `${h.status} ${h.code}` : after);
        else check(`§1 ${ad}: ${from} yasak → 409, durum değişmez`, h?.status === 409 && h.code === "QUOTE_STATUS_CONFLICT" && after === from, `${h?.status} ${h?.code} ${after}`);
      }
    }
    check("§1 matris tam (6 geçiş × 6 başlangıç)", hucre === 36, String(hucre));
    const olu = new Set(QUOTE_DEAD_STATUSES);
    const oludenCikan = Object.values(QUOTE_TRANSITIONS).filter((t) => (t.from as readonly SalesQuoteStatus[]).some((s) => olu.has(s)));
    check("§1 ölü kümeden (CANCELLED·CONVERTED·SUPERSEDED) geçiş tanımlı değil", oludenCikan.length === 0);
    check("§1 olmayan teklif → 404", (await hata(() => tr.sendQuote(randomUUID())))?.status === 404);

    // §2 süresi dolan kabul
    const exp = await teklifYaz(f, "SENT", { validDays: -1 });
    const he = await hata(() => tr.acceptQuote(exp, {}));
    check("§2 süresi dolmuş SENT kabul → 409 QUOTE_EXPIRED", he?.status === 409 && he.code === "QUOTE_EXPIRED", `${he?.status} ${he?.code}`);
    check("§2 durum SENT kalır", (await statusOf(exp)) === "SENT");
    const bugun = await teklifYaz(f, "SENT", { validDays: 0 });
    check("§2 son gün (validUntilDate = bugün) kabul edilir", (await hata(() => tr.acceptQuote(bugun, { customerReference: "PO-77" }))) === null);
    check("§2 müşteri referansı yazılır", (await prisma.salesQuote.findUniqueOrThrow({ where: { id: bugun } })).customerReference === "PO-77");

    // §3 boğaz-ikiz
    const today = quoteToday();
    await teklifYaz(f, "DRAFT", { validDays: -3 });
    await teklifYaz(f, "SENT", { validDays: 1 });
    const rows = await prisma.salesQuote.findMany({ where: { customerId: f.customerId }, select: { id: true, status: true, validUntilDate: true } });
    const bellek = new Set(rows.filter((r) => isQuoteExpired(r, today)).map((r) => r.id));
    const sql = new Set((await prisma.salesQuote.findMany({ where: { customerId: f.customerId, ...quoteExpiredWhere(today) }, select: { id: true } })).map((r) => r.id));
    check("§3 süresi doldu: bellek yüklemi = Prisma parçası", bellek.size === sql.size && [...bellek].every((x) => sql.has(x)) && bellek.has(exp), `${bellek.size}/${sql.size}`);
    check("§3 DRAFT süresi geçmiş olsa da 'süresi doldu' değildir", rows.filter((r) => r.status === "DRAFT" && r.validUntilDate < today).every((r) => !bellek.has(r.id)));

    // §4 DRAFT kilidi
    const sent = await teklifYaz(f, "SENT");
    const h4 = await hata(() => prisma.$transaction((tx) => claimDraftQuoteTx(tx, sent, undefined)));
    check("§4 SENT teklifte düzenleme kilidi → 409", h4?.status === 409 && h4.code === "QUOTE_STATUS_CONFLICT", `${h4?.status} ${h4?.code}`);
    const dr = await teklifYaz(f, "DRAFT");
    check("§4 DRAFT teklifte kilit alınır", (await hata(() => prisma.$transaction((tx) => claimDraftQuoteTx(tx, dr, undefined)))) === null);

    // §5 revizyon
    const src = await teklifYaz(f, "SENT", { lines: 2, validDays: 20 });
    const tok = randomUUID();
    const rev = await tr.reviseQuote(src, { clientToken: tok });
    const old = await prisma.salesQuote.findUniqueOrThrow({ where: { id: src }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    check("§5 eski SUPERSEDED + supersededAt", old.status === "SUPERSEDED" && old.supersededAt !== null);
    check("§5 yeni DRAFT, aynı numara, revisionNo+1, revisionOfId", rev.status === "DRAFT" && rev.quoteNo === old.quoteNo && rev.revisionNo === old.revisionNo + 1 && rev.revisionOfId === src);
    check(
      "§5 kalemler snapshot ve fiyatla kopya",
      rev.lines.length === 2 && rev.lines.every((l, i) => JSON.stringify(l.costSnapshot) === JSON.stringify(old.lines[i].costSnapshot) && l.unitPrice.equals(old.lines[i].unitPrice) && l.costPerMTry.equals(old.lines[i].costPerMTry)),
    );
    const sure = (q: { quoteDate: Date; validUntilDate: Date }) => Math.round((q.validUntilDate.getTime() - q.quoteDate.getTime()) / 86_400_000);
    check("§5 geçerlilik süresi korunur, tarih bugünden", sure(rev) === sure(old) && rev.quoteDate.getTime() === quoteToday().getTime(), `${sure(rev)}/${sure(old)}`);
    const replay = await tr.reviseQuote(src, { clientToken: tok });
    check("§5 aynı token replay → aynı revizyon (ikinci kayıt yok)", replay.id === rev.id && (await prisma.salesQuote.count({ where: { revisionOfId: src } })) === 1);
    const h5 = await hata(() => tr.reviseQuote(src, { clientToken: randomUUID() }));
    check("§5 SUPERSEDED teklif yeniden revize edilemez → 409", h5?.status === 409, `${h5?.status} ${h5?.code}`);
    const h5b = await hata(() => tr.reviseQuote(src, {}));
    check("§5 token'sız revizyon → 400", h5b?.status === 400);

    // §6 DB seddi
    const ck = await teklifYaz(f, "ACCEPTED");
    const h6 = await hata(() => prisma.$executeRaw`UPDATE "sales_quotes" SET "status" = 'CONVERTED' WHERE "id" = ${ck}::uuid`);
    check("§6 CONVERTED sipariş bağı olmadan yazılamaz (sales_quotes_converted_ck)", h6 !== null && (await statusOf(ck)) === "ACCEPTED");
    const h6b = await hata(() => prisma.$executeRaw`UPDATE "sales_quotes" SET "fxRate" = 0 WHERE "id" = ${ck}::uuid`);
    check("§6 kur 0 yazılamaz (sales_quotes_fx_rate_ck)", h6b !== null);
    const h6c = await hata(() => prisma.$executeRaw`UPDATE "sales_quotes" SET "currency" = 'TRY', "fxRate" = 2 WHERE "id" = ${ck}::uuid`);
    check("§6 TRY teklifin kuru 1'den başka olamaz", h6c !== null);
    const h6d = await hata(() => prisma.$executeRaw`UPDATE "sales_quote_lines" SET "quantity" = 0 WHERE "quoteId" = ${ck}::uuid`);
    check("§6 kalem miktarı 0 yazılamaz", h6d !== null);

    // §7 trigger
    const st = await teklifYaz(f, "DRAFT");
    const t0 = (await prisma.salesQuote.findUniqueOrThrow({ where: { id: st } })).statusChangedAt;
    await new Promise((r) => setTimeout(r, 25));
    await prisma.salesQuote.update({ where: { id: st }, data: { notes: "not dokunuşu", statusChangedAt: new Date("2000-01-01T00:00:00Z") } });
    const t1 = (await prisma.salesQuote.findUniqueOrThrow({ where: { id: st } })).statusChangedAt;
    check("§7 durum değişmeden statusChangedAt değişmez (uygulama yazamaz)", t1.getTime() === t0.getTime());
    await tr.sendQuote(st);
    const t2 = (await prisma.salesQuote.findUniqueOrThrow({ where: { id: st } })).statusChangedAt;
    check("§7 durum değişince statusChangedAt tazelenir", t2.getTime() > t0.getTime());

    // §8 küçük kurallar
    const empty = await teklifYaz(f, "DRAFT", { lines: 0 });
    const h8 = await hata(() => tr.sendQuote(empty));
    check("§8 kalemsiz gönderim → 400 QUOTE_EMPTY, DRAFT kalır", h8?.status === 400 && h8.code === "QUOTE_EMPTY" && (await statusOf(empty)) === "DRAFT");
    const rj = await teklifYaz(f, "SENT");
    check("§8 ret sebebi zorunlu → 400", (await hata(() => tr.rejectQuote(rj, { reason: "  " })))?.status === 400 && (await statusOf(rj)) === "SENT");
    const ua = await teklifYaz(f, "SENT");
    await tr.acceptQuote(ua, {});
    await tr.unacceptQuote(ua);
    const uaq = await prisma.salesQuote.findUniqueOrThrow({ where: { id: ua } });
    check("§8 kabulü geri al → SENT, kabul damgası düşer", uaq.status === "SENT" && uaq.acceptedAt === null && uaq.acceptedById === null);

    // §9 yarış
    const race = await teklifYaz(f, "DRAFT");
    const r = await Promise.allSettled([tr.sendQuote(race), tr.sendQuote(race)]);
    const ok = r.filter((x) => x.status === "fulfilled").length;
    const c409 = r.filter((x) => x.status === "rejected" && (x.reason as { statusCode?: number }).statusCode === 409).length;
    check("§9 iki paralel gönderim → biri geçer, öteki 409", ok === 1 && c409 === 1, `${ok} ok / ${c409} 409`);
  } finally {
    await teklifFiksturSil(f);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
