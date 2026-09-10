// =============================================================================
// PAKETLEME GRUBU — YARDIMCILAR (numara sayacı · canlı yüklem · atomik claim)
// =============================================================================
// Servisin (`packing-group.service.ts`) yanına ayrıldılar: kural gövdesi (sayaç
// rejimi, "canlı grup" yüklemi, ad tekilliği, çuval claim'i) tek yerde dursun ve
// servis yalnız beş genel metodu taşısın. Alan başlığı ve gerekçeler serviste.
// =============================================================================

import { Prisma } from "@prisma/client";

import { AppError } from "../../utils/app-error";
import { PackingGroupNumbering } from "../system-setting.service";

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
export function formatPackingGroupName(seq: number): string {
  return `P${seq}`;
}

/** "Canlı grup" yüklemi — TEK KAYNAK. Havuzda en az bir çuvalı olan grup. */
export const LIVE_GROUP_WHERE = {
  sacks: { some: { shipmentId: null } },
} satisfies Prisma.PackingGroupWhereInput;

export interface PackingGroupDto {
  id: string;
  name: string;
  seq: number | null;
  note: string | null;
  sackCount: number;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  weightKg: number | null;
  createdAt: Date;
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
): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PACKING_GROUP_LOCK_NS}::int, hashtext(${customerId}))`;

  // Sayaç YALNIZ `seq` taşıyan CANLI grupları okur. Elle adlandırılmış grup
  // (`seq: null`, ör. "Cuma tırı") sayacı ileri taşımaz — bir sıra numarası
  // değildir. Ölü grup da sayılmaz: numarası boşa çıkmıştır.
  const live = await tx.packingGroup.findMany({
    where: { ...LIVE_GROUP_WHERE, customerId, seq: { not: null } },
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

export const GROUP_WITH_SACKS_SELECT = {
  id: true,
  // Replay gövde kapısının (F117) kimlik alanı — token'lı grup BAŞKA bir cariye
  // aitse cached kaydı dönmek yanlış cevap olurdu.
  customerId: true,
  name: true,
  seq: true,
  note: true,
  createdAt: true,
  sacks: {
    where: { shipmentId: null },
    select: {
      id: true,
      weightKg: true,
      rolls: { select: { currentQty: true } },
      swatches: { select: { id: true } },
    },
  },
} satisfies Prisma.PackingGroupSelect;

type GroupRow = Prisma.PackingGroupGetPayload<{ select: typeof GROUP_WITH_SACKS_SELECT }>;

export function toDto(g: GroupRow): PackingGroupDto {
  let rollCount = 0;
  let swatchCount = 0;
  let totalQty = new Prisma.Decimal(0);
  let weight = new Prisma.Decimal(0);
  let anyWeight = false;
  for (const sk of g.sacks) {
    rollCount += sk.rolls.length;
    swatchCount += sk.swatches.length;
    for (const r of sk.rolls) totalQty = totalQty.plus(r.currentQty);
    if (sk.weightKg != null) {
      weight = weight.plus(sk.weightKg);
      anyWeight = true;
    }
  }
  return {
    id: g.id,
    name: g.name,
    seq: g.seq,
    note: g.note,
    sackCount: g.sacks.length,
    rollCount,
    swatchCount,
    totalQty: Number(totalQty),
    weightKg: anyWeight ? Number(weight) : null,
    createdAt: g.createdAt,
  };
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
  exceptId: string | null,
): Promise<void> {
  const clash = await tx.packingGroup.findFirst({
    where: {
      ...LIVE_GROUP_WHERE,
      customerId,
      name,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw AppError.conflict(`Bu carinin açık bir "${name}" grubu zaten var`, {
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
  args: { customerId: string; sackIds: string[]; groupId: string },
): Promise<void> {
  const res = await tx.sack.updateMany({
    where: {
      id: { in: args.sackIds },
      // Havuzda olmayan (sevkiyata atanmış / sevk edilmiş) çuval gruplanamaz.
      shipmentId: null,
      // Gruplar cariye özel: başka carinin çuvalı bu gruba giremez.
      customerId: args.customerId,
    },
    data: { packingGroupId: args.groupId },
  });
  if (res.count !== args.sackIds.length) {
    // Sayı tutmuyorsa tanı TX İÇİNDE taze okumayla konur — "kaç tanesi" değil
    // "hangisi ve neden" söylenir.
    const alive = await tx.sack.findMany({
      where: { id: { in: args.sackIds } },
      select: { id: true, sackNo: true, shipmentId: true, customerId: true },
    });
    const missing = args.sackIds.filter((id) => !alive.some((s) => s.id === id));
    const shipped = alive.filter((s) => s.shipmentId !== null).map((s) => s.sackNo);
    const foreign = alive
      .filter((s) => s.shipmentId === null && s.customerId !== args.customerId)
      .map((s) => s.sackNo);
    const parts: string[] = [];
    if (shipped.length) parts.push(`sevkiyata girmiş: ${shipped.join(", ")}`);
    if (foreign.length) parts.push(`başka cariye ait: ${foreign.join(", ")}`);
    if (missing.length) parts.push(`bulunamadı: ${missing.length} çuval`);
    throw AppError.conflict(
      `Seçilen çuvalların bir kısmı gruplanamadı (${parts.join(" · ")}) — listeyi yenileyip tekrar deneyin.`,
      { code: "PACKING_GROUP_SACK_CLAIM_FAILED" },
    );
  }
}
