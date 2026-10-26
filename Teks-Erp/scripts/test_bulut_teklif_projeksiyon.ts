// =============================================================================
// PATRON BULUTU — TEKLİF / STANDART MALİYET PROJEKSİYONU BEKÇİSİ (MAL-8)
// =============================================================================
// `teklif` · `teklif-kalemi` · `standart-maliyet` buluta salt-okunur yansıma olarak gider:
//   §1 ⭐ kırpma: tutar/kur/maliyet/marj kolonu ve türetilmiş alanı YALNIZ `.finans`ta (kök satırda yok);
//      `.finans` izni `bulut:maliyet:oku` — fiyat izni AÇMAZ; finans/fiyat/sipariş alt satır izinleri DEĞİŞMEDİ
//   §2 ⭐ bulut hesap yapmaz: `brutMarjPct` ve `suresiDoldu` FABRİKADA türetilir (panelin `quoteMargin`i ve
//      `isQuoteExpired`i), "süresi doldu" zaman geçişi `gecerlilik` ile beyanlı; bulut özeti (katalog-ozeti.json)
//      kök satırda para alanını YASAK sayar ve `.finans`a maliyet izni bağlar
//   §3 ⭐ canlı kurulum: taslak teklif buluta GİRMEZ (KAPSAM_DISI); gönderilmiş teklif kök satırı para taşımaz,
//      `.finans` marjı panel yanıtıyla AYNI; aynı kök iki kez kurulunca bayt-eşit satır (idempotent senkron)
//   §4 geçiş: geçerlilik günü dönünce SENT teklif yeniden seçilir (önceki gün seçilmez)
//   §5 standart maliyet grup toplamları kalemlerden fabrikada; beş grubun toplamı metre maliyetine eşit
// NEGATİF SONDALAR — 2026-10-26 koşuldu (cp + shasum ile birebir geri alındı): commit mesajında.
// Koşum: npx tsx scripts/test_bulut_teklif_projeksiyon.ts   (yalnız _test DB)
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { RECORD_PROJECTIONS, projectionPermissions, subRowPermission, type RecordProjection } from "../src/cloud-sync/projections";
import { DERIVERS } from "../src/cloud-sync/derived";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { quoteMargin } from "../src/services/helpers/quote-view.helper";
import { quoteToday } from "../src/services/helpers/sales-quote-state.helper";
import { factoryDayStart } from "../src/constants/time";
import { teklifFiksturKur, teklifFiksturSil, teklifYaz, type TeklifFikstur } from "./lib/teklif-fikstur";
import { fiksturKur, fiksturSil, type MaliyetFikstur } from "./lib/maliyet-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

const COST = ["teklif", "teklif-kalemi", "standart-maliyet"] as const;
/** Para/maliyet/marj taşıyan kaynak kolon ya da tel adı — maliyet projeksiyonunda YALNIZ FINANS. */
const PARA_KAYNAK = /amount|price|cost|fxRate|exchangeRate|markup|lineTotal|Try$/i;
const PARA_TEL = /tutar|fiyat|maliyet|marj|kur$|^kur|karPct|Tl$/i;

/** Saf denetçi (sondalar sentetik kopyaya uygular): maliyet projeksiyonunda para alanı kök satıra sızmış mı. */
export function maliyetKirpmaDenetimi(projs: readonly RecordProjection[]): string[] {
  const out: string[] = [];
  for (const p of projs.filter((x) => x.module === "maliyet.enabled")) {
    for (const c of p.columns) if ((PARA_KAYNAK.test(c.source) || PARA_TEL.test(c.wire)) && c.dataClass !== "FINANS") out.push(`${p.name}.${c.wire} kök satırda`);
    for (const d of p.derived) if (PARA_TEL.test(d.wire) && d.dataClass !== "FINANS") out.push(`${p.name}.${d.wire} (türetilmiş) kök satırda`);
  }
  return out;
}

const byName = (n: string): RecordProjection | undefined => RECORD_PROJECTIONS.find((p) => p.name === n);

function katalogBolumu(): void {
  console.log("\n§1 — katalog: kırpma ve alt satır izni");
  const eksik = COST.filter((n) => byName(n)?.module !== "maliyet.enabled" || byName(n)?.permission !== "bulut:teklif:oku");
  check("§1a üç projeksiyon `maliyet.enabled` modülünde, kök izni `bulut:teklif:oku`", eksik.length === 0, eksik.join(",") || "3/3");
  const s = maliyetKirpmaDenetimi(RECORD_PROJECTIONS);
  check("§1b ⭐ tutar/kur/maliyet/marj YALNIZ `.finans`ta", s.length === 0, s.join(" · ") || "temiz");
  const sonda = maliyetKirpmaDenetimi(RECORD_PROJECTIONS.map((p) => (p.name === "teklif" ? { ...p, columns: p.columns.map((c) => (c.wire === "toplamTutar" ? { ...c, dataClass: "ISLEM" as const } : c)) } : p)));
  check("§1b' kalıcı sonda: `toplamTutar` kök satıra taşınınca denetçi ısırır", sonda.some((x) => x.startsWith("teklif.toplamTutar")), sonda.join(","));
  const map = projectionPermissions();
  const finans = COST.map((n) => map.get(`${n}.finans`));
  check("§1c ⭐ maliyet `.finans` alt satırı `bulut:maliyet:oku` (fiyat izni açmaz)", finans.every((x) => x === "bulut:maliyet:oku"), finans.join(","));
  const fp = byName("teklif");
  check("§1d `subRowPermission` maliyet dalı (kişisel dal değişmedi)", !!fp && subRowPermission(fp, "FINANS") === "bulut:maliyet:oku" && subRowPermission(fp, "KISISEL") === "bulut:cari:oku");
  const degismez = { "siparis.finans": "bulut:fiyat:oku", "siparis-kalemi.finans": "bulut:fiyat:oku", "fiyat.finans": "bulut:fiyat:oku", "fatura.finans": "bulut:fatura:oku", "tahsilat-odeme.finans": "bulut:tahsilat:oku" };
  const kayan = Object.entries(degismez).filter(([k, v]) => map.get(k) !== v);
  check("§1e finans/fiyat/sipariş alt satır izinleri DEĞİŞMEDİ", kayan.length === 0, kayan.map(([k]) => `${k}→${map.get(k)}`).join(",") || "5/5");
}

function hesapBolumu(): void {
  console.log("\n§2 — bulut hesap yapmaz");
  const t = byName("teklif");
  const marj = t?.derived.find((d) => d.wire === "brutMarjPct");
  check("§2a ⭐ `brutMarjPct` fabrikada türetilir (FINANS, kaynak `quoteMargin`)", !!marj && marj.dataClass === "FINANS" && /quoteMargin/.test(marj.helper));
  const dolu = t?.derived.find((d) => d.wire === "suresiDoldu");
  check("§2b ⭐ `suresiDoldu` fabrikada (isQuoteExpired), zamana bağlı ve geçiş kaynağı `gecerlilik`", !!dolu && dolu.timeBound && /isQuoteExpired/.test(dolu.helper) && (t?.crossings ?? []).some((c) => c.name === "gecerlilik"));
  const sm = byName("standart-maliyet");
  const gruplar = ["cozguTl", "atkiTl", "dokumaTl", "terbiyeTl", "genelGiderTl"];
  check("§2c standart maliyet grup toplamları fabrikada türetilir (FINANS)", gruplar.every((g) => sm?.derived.some((d) => d.wire === g && d.dataClass === "FINANS")));
  check("§2d türeticiler kayıtlı (teklif · standart-maliyet)", typeof DERIVERS.teklif === "function" && typeof DERIVERS["standart-maliyet"] === "function");
  const ozet = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "patron", "sunucu", "src", "catalog", "katalog-ozeti.json"), "utf8")) as {
    ROOT_PROJECTIONS: Array<{ name: string; forbiddenRootFields?: string[] }>;
    PROJECTION_PERMISSIONS: Record<string, string[]>;
  };
  const yasak = ozet.ROOT_PROJECTIONS.find((r) => r.name === "teklif")?.forbiddenRootFields ?? [];
  check("§2e bulut özeti `teklif` kökünde para alanlarını YASAK sayar", ["toplamTutar", "kur", "toplamMaliyetTl", "brutMarjPct"].every((f) => yasak.includes(f)), yasak.join(","));
  const bulutIzin = COST.map((n) => ozet.PROJECTION_PERMISSIONS[`${n}.finans`] ?? []);
  check("§2f bulut özeti `.finans`a maliyet izni bağlar, fiyat iznine DEĞİL", bulutIzin.every((x) => x.includes("bulut:maliyet:oku") && !x.includes("bulut:fiyat:oku")), JSON.stringify(bulutIzin));
}

async function canliBolum(f: TeklifFikstur): Promise<void> {
  console.log("\n§3 — canlı kurulum (taslak · kırpma · idempotent)");
  const draft = await teklifYaz(f, "DRAFT");
  const sent = await teklifYaz(f, "SENT", { lines: 2 });
  const expired = await teklifYaz(f, "SENT", { validDays: -1 });
  const p = byName("teklif")!;
  const now = Date.now();
  const a = await buildRecords(p, [draft, sent, expired], now);
  check("§3a ⭐ taslak teklif buluta GİRMEZ (KAPSAM_DISI)", a.removed.some((r) => r.id === draft && r.neden === "KAPSAM_DISI") && !(a.rows.get("teklif") ?? []).some((r) => r.id === draft));
  const kok = (a.rows.get("teklif") ?? []).find((r) => r.id === sent);
  const fin = (a.rows.get("teklif.finans") ?? []).find((r) => r.id === sent);
  const paraKokte = kok ? Object.keys(kok).filter((k) => PARA_TEL.test(k)) : ["(kök yok)"];
  check("§3b ⭐ kök satırda para alanı YOK", paraKokte.length === 0, paraKokte.join(","));
  const q = await prisma.salesQuote.findUniqueOrThrow({ where: { id: sent }, select: { totalAmount: true, fxRate: true, totalCostTry: true } });
  const panel = quoteMargin(q)?.marjPct ?? null;
  check("§3c ⭐ `.finans` marjı panelin `quoteMargin`iyle AYNI; tutar/kur/maliyet ham değer", !!fin && fin.brutMarjPct === panel && fin.toplamTutar === "500" && fin.kur === "34" && fin.toplamMaliyetTl === "15408", JSON.stringify(fin));
  const dolan = (a.rows.get("teklif") ?? []).find((r) => r.id === expired);
  check("§3d `suresiDoldu` fabrikada: geçerliliği dün biten SENT → true, ileri tarihli → false", dolan?.suresiDoldu === true && kok?.suresiDoldu === false);
  const b = await buildRecords(p, [draft, sent, expired], now);
  check("§3e ⭐ idempotent: aynı kökler aynı anla iki kez → bayt-eşit satırlar", JSON.stringify([...a.rows]) === JSON.stringify([...b.rows]));
  const lp = byName("teklif-kalemi")!;
  const lines = await prisma.salesQuoteLine.findMany({ where: { quoteId: { in: [draft, sent] } }, select: { id: true, quoteId: true } });
  const k = await buildRecords(lp, lines.map((l) => l.id), now);
  const kalemKok = k.rows.get("teklif-kalemi") ?? [];
  const taslakKalem = lines.filter((l) => l.quoteId === draft).map((l) => l.id);
  check("§3f taslağın kalemi kapsam dışı; gönderilmiş teklifin 2 kalemi gider, kökte birim fiyat/maliyet yok",
    kalemKok.length === 2 && taslakKalem.every((id) => k.removed.some((r) => r.id === id && r.neden === "KAPSAM_DISI")) && kalemKok.every((r) => !("birimFiyat" in r) && !("metreMaliyetiTl" in r)));
  const kf = k.rows.get("teklif-kalemi.finans") ?? [];
  check("§3g kalem `.finans` birim fiyat · tutar · metre maliyeti · kâr", kf.length === 2 && kf.every((r) => r.birimFiyat === "2.5" && r.tutar === "250" && r.metreMaliyetiTl === "77.0395" && r.karPct === "18"), JSON.stringify(kf[0]));
}

async function gecisBolumu(f: TeklifFikstur): Promise<void> {
  console.log("\n§4 — geçerlilik geçişi");
  const id = await teklifYaz(f, "SENT", { validDays: 0 });
  const crossing = byName("teklif")!.crossings!.find((c) => c.name === "gecerlilik")!;
  const today = quoteToday();
  const tomorrowStart = factoryDayStart(new Date(factoryDayStart().getTime() + 36 * 3_600_000));
  const sec = async (from: Date, to: Date): Promise<boolean> =>
    (await prisma.$queryRawUnsafe<Array<{ root_id: string }>>(crossing.sql, from, to)).some((r) => r.root_id === id);
  const yarinIcinden = await sec(new Date(tomorrowStart.getTime() - 60_000), new Date(tomorrowStart.getTime() + 60_000));
  const bugunIcinden = await sec(new Date(factoryDayStart().getTime() + 60_000), new Date(factoryDayStart().getTime() + 120_000));
  check("§4a ⭐ geçerliliği BUGÜN biten teklif, ertesi fabrika gününün başını kapsayan pencerede seçilir", yarinIcinden, today.toISOString().slice(0, 10));
  check("§4b aynı gün içindeki pencerede seçilmez (gereksiz yeniden gönderim yok)", !bugunIcinden);
}

async function maliyetBolumu(): Promise<void> {
  console.log("\n§5 — standart maliyet grupları");
  let mf: MaliyetFikstur | null = null;
  let versionId: string | null = null;
  try {
    mf = await fiksturKur("BTP");
    const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
    const comps = [["WARP_YARN", "10.1"], ["WEFT_YARN", "8.2"], ["LOOM_MACHINE", "3"], ["LOOM_LABOR", "2"], ["ENERGY", "1"], ["BEAM_PREP", "0.5"], ["FINISHING", "6"], ["LENGTH_SHRINK", "0.4"], ["FABRIC_WASTE", "0.6"], ["OVERHEAD", "1.7"]] as const;
    const v = await prisma.standardCostVersion.create({
      data: {
        itemId: mf.fabricId, versionNo: 1, parameterSetId: mf.paramId, rawCostPerMTry: D("27.4"), finishedCostPerMTry: D("33.8"), totalCostPerMTry: D("33.5"),
        warpKgPerM: D("0.1"), weftKgPerM: D("0.1"), loomMPerHour: D("10"), fxRates: {}, inputSnapshot: {}, inputHash: "a".repeat(64), warnings: [],
        lines: { create: comps.map(([component, amount], i) => ({ lineNo: i + 1, component, label: component, amountPerMTry: D(amount) })) },
      },
      select: { id: true },
    });
    versionId = v.id;
    const r = await buildRecords(byName("standart-maliyet")!, [v.id], Date.now());
    const fin = (r.rows.get("standart-maliyet.finans") ?? [])[0];
    const kok = (r.rows.get("standart-maliyet") ?? [])[0];
    check("§5a ⭐ grup toplamları kalemlerden (çözgü · atkı · dokuma · terbiye · genel)", !!fin && fin.cozguTl === "10.1" && fin.atkiTl === "8.2" && fin.dokumaTl === "6.5" && fin.terbiyeTl === "6.4" && fin.genelGiderTl === "2.3", JSON.stringify(fin));
    const toplam = ["cozguTl", "atkiTl", "dokumaTl", "terbiyeTl", "genelGiderTl"].reduce((s, g) => s.plus(D(String(fin?.[g] ?? 0))), D("0"));
    check("§5b beş grubun toplamı = metre maliyeti", toplam.eq(D(String(fin?.metreMaliyetiTl ?? -1))), `${toplam.toString()} / ${String(fin?.metreMaliyetiTl)}`);
    check("§5c kök satırda maliyet yok; ürün adı türetilmiş", !!kok && !("metreMaliyetiTl" in kok) && typeof kok.urunAdi === "string" && kok.surum === 1);
  } finally {
    if (versionId) {
      await prisma.standardCostLine.deleteMany({ where: { versionId } });
      await prisma.standardCostVersion.delete({ where: { id: versionId } });
    }
    if (mf) await fiksturSil(mf);
  }
}

async function main(): Promise<void> {
  katalogBolumu();
  hesapBolumu();
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`⛔ DB bölümleri DURDURULDU — ${engel}`);
    process.exitCode = 1;
    return;
  }
  const f = await teklifFiksturKur("BTP");
  try {
    await canliBolum(f);
    await gecisBolumu(f);
  } finally {
    await teklifFiksturSil(f);
  }
  await maliyetBolumu();
}

main()
  .catch((e) => {
    fail++;
    console.error(e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
