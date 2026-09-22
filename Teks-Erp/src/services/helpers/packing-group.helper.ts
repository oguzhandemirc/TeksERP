// =============================================================================
// PAKETLEME GRUBU — YARDIMCILAR (numara sayacı · canlı yüklem · atomik claim)
// =============================================================================
// Servisin (`packing-group.service.ts`) yanına ayrıldılar: kural gövdesi (sayaç
// rejimi, "canlı grup" yüklemi, ad tekilliği, çuval claim'i) tek yerde dursun ve
// servis yalnız beş genel metodu taşısın. Alan başlığı ve gerekçeler serviste.
// =============================================================================

import { Prisma, type PackingGroupStatus } from "@prisma/client";

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { nextSeriesNo, resolveSeriesFormat } from "../number-series.service";
import {
  PackageNoMode,
  PackageNumbering,
  PackingGroupMode,
  PackingGroupNumbering,
  readPackageNoMode,
  readPackageNoStartsAtZero,
  readPackageNumbering,
  readPackingLotPartialDispatch,
  readPackingLotRequired,
  effectivePackingGroupMode,
} from "../system-setting.service";


/**
 * Grup numarası sayacının `pg_advisory_xact_lock` NAMESPACE'i (2 argümanlı form).
 *
 * Parti numarasının 8022'sinden AYRI: aynı uzayda olsalardı üretim partisi
 * üreteci ile paketleme grubu sayacı birbirini sessizce serileştirirdi (yanlış
 * sonuç değil, teşhisi imkânsız gecikme). Envanterin TEK kaydı
 * `helpers/period-guard.helper.ts` başlığındadır.
 */
// Tip `number` (literal DEĞİL) — bekçi bunu diğer namespace'lerle karşılaştırıyor
// ve literal tiplerde TS "örtüşme yok" diye derlemede düşürürdü.
export const PACKING_GROUP_LOCK_NS: number = 8031;

/**
 * PARTİ KODU uzayı — kurulum-geneli tek anahtar (key 0): kod `PRT-YYMM-NNNN` aylık
 * sayaçtan gelir, cariye bağlı değildir. Parti doğuran tx'in İLK ifadesi; ardından
 * (otomatik adda) 8031 gelir — sıra her yerde 8034 → 8031.
 */
export const PACKING_GROUP_CODE_LOCK_NS: number = 8034;

/**
 * Sıradaki parti kodu — tx içinde, kilit ALINDIKTAN sonra: o ayın en büyük sayacı + 1.
 * `@unique` DB seddi ikinci kapıdır; kilit yarışı, unique ise kusuru yakalar.
 */
export async function nextPackingGroupCodeTx(tx: Prisma.TransactionClient, at: Date = new Date()): Promise<string> {
  // SAYISAL en büyük (metin sıralaması 10000'i 9999'un altına koyar; silinen taslak
  // partiler yüzünden COUNT da güvenilmez — boşluk kodu çakıştırır). Sorgu
  // `gte + startsWith`: gte index seek, startsWith collation-bağımsız tam-prefix.
  return nextSeriesNo("packingLotCode", async (full) => {
    const rows = await tx.packingGroup.findMany({
      where: { code: { gte: full, startsWith: full } },
      select: { code: true },
    });
    return rows.map((r) => r.code);
  }, at);
}

/**
 * Grubun EKRANDA görünen adı. Tek satır, tek yer.
 *
 * ⚠️ "P" ÖN EKİ ÜRETİM PARTİSİYLE ÇAKIŞIR ve bu BİLEREK kabul edildi
 * (kullanıcı kararı 2026-09-10): fabrikada "parti" bugün `Batch`tir (P01…P99,
 * refakat kartına basılı, KK1'de geçiyor) ve saha paketleme grubuna da "P1"
 * diyor. Sahanın kendi kelimesini değiştirmek yerine çakışmanın ZARARSIZ
 * olduğu ölçüldü: grup adı HİÇBİR BELGEYE BASILMIYOR (etiket · irsaliye ·
 * rapor — hepsinin dışında), yani çakışma bir KAYDI bozamaz; olsa olsa
 * telefonda bir cümleyi belirsizleştirir.
 *
 * ⚠️ Bu muafiyet ADIN EKRANDA KALMASINA BAĞLIDIR. Bir gün grup adı bir belgeye
 * ya da rapora girecekse çakışma zararsız olmaktan çıkar (aynı kâğıtta iki
 * farklı P3) — o karar verilirken bu ön ek de yeniden düşünülmelidir.
 *
 * Biçim değişecekse burada tek satır değişir; ekranlar bu fonksiyondan okur.
 */
export function formatPackingGroupName(seq: number, mode: PackingGroupMode = "grup"): string {
  // Sevk partisi BELGEYE BASILIR (K7): "P-n" (tireli) — üretim partisi "P02" ile aynı
  // kâğıtta ayırt edilir (kullanıcı tercihi 2026-09-22, önceki "SP-n" fazla uzundu).
  // Ön ek/ayraç `number_series` serisinden gelir; GRUP modunda ayraç DÜŞER (grup adı
  // belgeye girmez, kısa kalması sahanın tercihi).
  const fmt = resolveSeriesFormat("packingLotName");
  return mode === "sevk-partisi" ? `${fmt.prefix}${fmt.separator}${seq}` : `${fmt.prefix}${seq}`;
}

/** "Canlı grup" yüklemi — GRUP MODU. Havuzda en az bir çuvalı olan grup. */
export const LIVE_GROUP_WHERE = {
  sacks: { some: { shipmentId: null } },
} satisfies Prisma.PackingGroupWhereInput;

/**
 * "Canlı grup" — TEK KAYNAK, moda göre. Grup modunda çocuk satırdan türetilir
 * (boşalan grup görünmez olur); sevk partisi modunda `status = OPEN`dır — bu durum
 * elle değil SEVKTEN türer (son çuval sevk edilince CLOSED = "sevk edildi", storno
 * geri getirince OPEN) ve boş parti doğduğunda OPEN olduğu için YAŞAR. Üç tüketici
 * (liste · sayaç · ad tekilliği) buradan geçer; literal elle kopyalanmaz.
 */
export function liveGroupWhere(mode: PackingGroupMode): Prisma.PackingGroupWhereInput {
  return mode === "sevk-partisi" ? { status: "OPEN" } : LIVE_GROUP_WHERE;
}

/** `liveGroupWhere`in SQL İKİZİ (`loadPackingGroupDtos` için; takma ad `g`). Birlikte değişir. */
export function liveGroupSql(mode: PackingGroupMode): Prisma.Sql {
  return mode === "sevk-partisi"
    ? Prisma.sql`g.status::text = 'OPEN'`
    : Prisma.sql`EXISTS (SELECT 1 FROM sacks s WHERE s."packingGroupId" = g.id AND s."shipmentId" IS NULL)`;
}

/**
 * Sevk partisi ayar demeti — enforcement noktaları BUNU okur, ham okuyucuları değil.
 * `mode !== "sevk-partisi"` iken diğer alanlar VARSAYILANDA donar ve hiçbir yol
 * onları okumaz (grup modunda davranış değişmez).
 */
export interface PackingLotSettings {
  mode: PackingGroupMode;
  numbering: PackageNumbering;
  noMode: PackageNoMode;
  startsAtZero: boolean;
  required: boolean;
  partialDispatch: boolean;
}

export async function readPackingLotSettings(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<PackingLotSettings> {
  const mode = await effectivePackingGroupMode(tx);
  if (mode !== "sevk-partisi") {
    return { mode, numbering: "artan", noMode: "otomatik-ezilebilir", startsAtZero: false, required: false, partialDispatch: true };
  }
  return {
    mode,
    numbering: await readPackageNumbering(tx),
    noMode: await readPackageNoMode(tx),
    startsAtZero: await readPackageNoStartsAtZero(tx),
    required: await readPackingLotRequired(tx),
    partialDispatch: await readPackingLotPartialDispatch(tx),
  };
}

/**
 * Sıradaki grup numarası — tx İÇİNDE.
 *
 * ⚠️⚠️ KİLİT BU FONKSİYONUN İLK İFADESİDİR ve sırası LOAD-BEARING. Sonraya
 * alınsaydı klasik TOCTOU açılırdı: iki tablet aynı saniyede "Parti Ata"ya
 * basar, ikisi de aynı "en büyük numara"yı okur ve aynı numarayı alır — hata
 * yok, log yok, iki hazırlık tek adla. (Parti no üretecinde birebir aynı hata
 * yaşandı; oradaki ders buraya kopyalandı.)
 *
 * Kilit anahtarı CARİ: gruplar cariye özel olduğu için iki farklı carinin
 * "Parti Ata"sı birbirini beklemez.
 */
export async function nextPackingGroupSeqTx(
  tx: Prisma.TransactionClient,
  customerId: string,
  mode: PackingGroupNumbering,
  groupMode: PackingGroupMode = "grup",
): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PACKING_GROUP_LOCK_NS}::int, hashtext(${customerId}))`;

  // Sayaç YALNIZ `seq` taşıyan CANLI grupları okur. Elle adlandırılmış grup
  // (`seq: null`, ör. "Cuma tırı") sayacı ileri taşımaz — bir sıra numarası
  // değildir. Ölü grup da sayılmaz: numarası boşa çıkmıştır. SEVK PARTİSİ modunda
  // canlı = OPEN (sevk edilmemiş): sevk edilmiş SP-1'in numarası/adı yeni partiye
  // yeniden verilebilir (saha kararı 2026-09-22 — kimlik `id`dir, ad değil).
  const live = await tx.packingGroup.findMany({
    where: { ...liveGroupWhere(groupMode), customerId, seq: { not: null } },
    select: { seq: true },
    orderBy: { seq: "asc" },
  });
  const seqs = live.map((g) => g.seq as number).filter((n) => n >= 1);

  if (mode === "bosluk-doldur") {
    // EN KÜÇÜK boş numara: P1 ve P3 doluysa yeni grup P2 olur.
    let n = 1;
    for (const s of seqs) {
      if (s > n) break;
      if (s === n) n += 1;
    }
    return n;
  }

  // `artan` (varsayılan): boşalan numaraya GERİ DÖNÜLMEZ. P3 sevk edildi ve P5
  // duruyorsa yeni grup P6'dır. Havuz tamamen boşalınca canlı grup kalmadığı
  // için sayaç kendiliğinden 1'e döner — numara sonsuza büyümez.
  return (seqs.length ? seqs[seqs.length - 1] : 0) + 1;
}

/**
 * Ad tekilliği CANLI gruplar arasında. DB'de partial unique KURULAMAZ: "canlı"
 * tanımı ÇOCUK satıra bakıyor (havuzda çuvalı var mı) ve bir unique index başka
 * tabloyu okuyamaz. Yarışı kapatan şey `nextPackingGroupSeqTx`in advisory
 * kilididir — bu kontrol onun ARKASINDA, aynı tx içinde koşar.
 */
export async function assertGroupNameFreeTx(
  tx: Pick<Prisma.TransactionClient, "packingGroup">,
  customerId: string,
  name: string,
  opts: { exceptId: string | null; groupMode?: PackingGroupMode } = { exceptId: null },
): Promise<void> {
  const groupMode = opts.groupMode ?? "grup";
  const clash = await tx.packingGroup.findFirst({
    where: {
      ...liveGroupWhere(groupMode),
      customerId,
      name,
      ...(opts.exceptId ? { id: { not: opts.exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    const nesne = groupMode === "sevk-partisi" ? "sevk partisi" : "grubu";
    throw AppError.conflict(`Bu carinin açık bir "${name}" ${nesne} zaten var`, {
      code: "PACKING_GROUP_NAME_TAKEN",
    });
  }
}


/**
 * Çuvalları gruba ATOMİK CLAIM ile bağlar.
 *
 * ⚠️ `findUnique → if → update` DEĞİL: yüklem `updateMany`nin WHERE'inde yaşar.
 * Aksi hâlde okuma ile yazma arasında çuval sevk edilebilir ve sevk edilmiş bir
 * çuval hazırlık grubuna girerdi.
 *
 * ⚠️ BİR ÇUVAL TEK GRUPTA: `packingGroupId` tekil bir kolondur, yani başka
 * gruptaki çuval seçilirse TAŞINIR (çıkar-ekle). Kullanıcı kararı 2026-09-10.
 */
export async function claimSacksIntoGroupTx(
  tx: Prisma.TransactionClient,
  args: {
    customerId: string;
    sackIds: string[];
    groupId: string;
    /** Sevk partisi modu: claim'lenen her çuvala YENİ ambalaj no (havuzdan al / transfer). */
    lot?: { numbering: PackageNumbering; startsAtZero: boolean } | null;
  },
): Promise<void> {
  const res = await tx.sack.updateMany({
    where: {
      id: { in: args.sackIds },
      // Havuzda olmayan (sevkiyata atanmış / sevk edilmiş) çuval gruplanamaz.
      shipmentId: null,
      // Gruplar cariye özel: başka carinin çuvalı bu gruba giremez.
      customerId: args.customerId,
      // Parti modunda ZATEN ÜYE çuval yeniden numaralanmaz — claim dışı kalır ve
      // aşağıdaki tanıda adıyla söylenir.
      ...(args.lot ? { OR: [{ packingGroupId: null }, { packingGroupId: { not: args.groupId } }] } : {}),
    },
    // Transferde eski numara DÜŞER (kaynak partide boşluk kalır); yeni numara aşağıda.
    data: { packingGroupId: args.groupId, ...(args.lot ? { packageNo: null } : {}) },
  });
  if (res.count === args.sackIds.length && args.lot) {
    const nos = await reservePackageNosTx(tx, {
      groupId: args.groupId,
      count: args.sackIds.length,
      numbering: args.lot.numbering,
      startsAtZero: args.lot.startsAtZero,
    });
    // Sıralı — `tx.*` + Promise.all YASAK; numara sırası istemcinin seçim sırasıdır.
    for (let i = 0; i < args.sackIds.length; i += 1) {
      await tx.sack.update({ where: { id: args.sackIds[i] }, data: { packageNo: nos[i] } });
    }
  }
  if (res.count !== args.sackIds.length) {
    // Sayı tutmuyorsa tanı TX İÇİNDE taze okumayla konur — "kaç tanesi" değil
    // "hangisi ve neden" söylenir.
    const alive = await tx.sack.findMany({
      where: { id: { in: args.sackIds } },
      select: { id: true, sackNo: true, shipmentId: true, customerId: true, packingGroupId: true },
    });
    const missing = args.sackIds.filter((id) => !alive.some((s) => s.id === id));
    const shipped = alive.filter((s) => s.shipmentId !== null).map((s) => s.sackNo);
    const foreign = alive
      .filter((s) => s.shipmentId === null && s.customerId !== args.customerId)
      .map((s) => s.sackNo);
    const zatenUye = args.lot
      ? alive.filter((s) => s.shipmentId === null && s.packingGroupId === args.groupId).map((s) => s.sackNo)
      : [];
    const parts: string[] = [];
    if (shipped.length) parts.push(`sevkiyata girmiş: ${shipped.join(", ")}`);
    if (foreign.length) parts.push(`başka cariye ait: ${foreign.join(", ")}`);
    if (zatenUye.length) parts.push(`zaten bu partide: ${zatenUye.join(", ")}`);
    if (missing.length) parts.push(`bulunamadı: ${missing.length} çuval`);
    throw AppError.conflict(
      `Seçilen çuvalların bir kısmı gruplanamadı (${parts.join(" · ")}) — listeyi yenileyip tekrar deneyin.`,
      { code: "PACKING_GROUP_SACK_CLAIM_FAILED" },
    );
  }
}

/**
 * Sevk partisi AMBALAJ NO uzayı — `hashtext(packingGroupId)`; yalnız numaranın
 * sayaçtan GELMEDİĞİ yollarda (ezme · elle · `bosluk-doldur`) tx'in İLK ifadesi.
 * `artan` sayaç tek satır `UPDATE … RETURNING` olduğu için kilitsiz. 8031'den AYRI:
 * o carinin parti sırasını, bu partinin çuval numarasını korur.
 */
export const PACKAGE_NO_LOCK_NS: number = 8033;

/** İlk çuvalın ambalaj numarası (K3). */
export function packageNoStart(startsAtZero: boolean): number {
  return startsAtZero ? 0 : 1;
}

/**
 * Parti içinde `count` adet AMBALAJ NO ayırır — tx İÇİNDE.
 *
 *  • `artan`: tek satır `UPDATE … RETURNING` — kilitsiz, atomik; iki panel aynı
 *    partide aynı anda çuval açsa da numara çakışmaz, boşluk kalmaz.
 *  • `bosluk-doldur`: 8033 kilidi tx'in bu noktasında İLK ifadedir (öncesinde bu
 *    partiye dokunan okuma yok); açık+sevk edilmiş çuvalların tutmadığı en küçük
 *    numaralar verilir. Sayaç GREATEST ile ileri taşınır ki rejim sonradan
 *    `artan`a dönerse verilmiş bir numaranın üstüne basmasın.
 */
export async function reservePackageNosTx(
  tx: Prisma.TransactionClient,
  args: { groupId: string; count: number; numbering: PackageNumbering; startsAtZero: boolean },
): Promise<number[]> {
  if (args.count <= 0) return [];
  if (args.numbering === "artan") {
    const rows = await tx.$queryRaw<{ n: number }[]>`
      UPDATE "packing_groups" SET "nextPackageNo" = "nextPackageNo" + ${args.count}
      WHERE "id" = ${args.groupId}::uuid RETURNING "nextPackageNo" AS n`;
    if (rows.length !== 1) throw AppError.notFound("Sevk partisi bulunamadı");
    const end = Number(rows[0].n);
    return Array.from({ length: args.count }, (_, i) => end - args.count + i);
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PACKAGE_NO_LOCK_NS}::int, hashtext(${args.groupId}))`;
  const taken = new Set(
    (
      await tx.sack.findMany({
        where: { packingGroupId: args.groupId, packageNo: { not: null } },
        select: { packageNo: true },
      })
    ).map((r) => r.packageNo as number),
  );
  const out: number[] = [];
  let n = packageNoStart(args.startsAtZero);
  while (out.length < args.count) {
    if (!taken.has(n)) { out.push(n); taken.add(n); }
    n += 1;
  }
  const max = out[out.length - 1];
  await tx.$executeRaw`
    UPDATE "packing_groups" SET "nextPackageNo" = GREATEST("nextPackageNo", ${max + 1})
    WHERE "id" = ${args.groupId}::uuid`;
  return out;
}

/**
 * Elle verilen / ezilen ambalaj numarasının parti içinde BOŞ olduğunu doğrular —
 * 8033 kilidi altında (aynı numarayı iki panel aynı anda yazmasın); DB unique
 * (`sacks_packingGroupId_packageNo_key`) son seddir, bu kontrol Türkçe tanı içindir.
 * Sayaç `GREATEST(next, n+1)` ile ileri taşınır: "50 yazdım" → sonraki otomatik 51.
 */
export async function assertPackageNoFreeTx(
  tx: Prisma.TransactionClient,
  args: { groupId: string; packageNo: number; exceptSackId: string | null },
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PACKAGE_NO_LOCK_NS}::int, hashtext(${args.groupId}))`;
  const clash = await tx.sack.findFirst({
    where: {
      packingGroupId: args.groupId,
      packageNo: args.packageNo,
      ...(args.exceptSackId ? { id: { not: args.exceptSackId } } : {}),
    },
    select: { sackNo: true, shipmentId: true },
  });
  if (clash) {
    const stateNote = clash.shipmentId ? " (sevk edilmiş)" : "";
    throw AppError.conflict(
      `${args.packageNo} numarası bu partide ${clash.sackNo} çuvalının üstünde${stateNote} — başka bir numara verin.`,
      { code: "PACKAGE_NO_TAKEN" },
    );
  }
  await tx.$executeRaw`
    UPDATE "packing_groups" SET "nextPackageNo" = GREATEST("nextPackageNo", ${args.packageNo + 1})
    WHERE "id" = ${args.groupId}::uuid`;
}

/**
 * Elle/ezme numarasının moda göre kabul kapısı (tek yer): `otomatik` numara almaz,
 * `elle` numarasız kalamaz, `otomatik-ezilebilir` ikisini de kabul eder.
 */
export function assertPackageNoInputAllowed(noMode: PackageNoMode, packageNo: number | null | undefined): void {
  if (noMode === "otomatik" && packageNo != null) {
    throw AppError.badRequest("Ambalaj numarası otomatik verilir — elle numara kabul edilmiyor (ayar: otomatik)");
  }
  if (noMode === "elle" && packageNo == null) {
    throw AppError.badRequest("Ambalaj numarası zorunlu (ayar: elle)");
  }
}
