// =============================================================================
// TEDARİKÇİ TARAFI — "alış HER cariden yapılabilir" (saha planı C4, 2026-08-15)
// =============================================================================
// Alış belgelerinin (mal kabul fişi + alış siparişi) tedarikçisi İKİ tabloda
// yaşayabilir: `Customer` (müşteri-tipli cari, `CompanyType.SUPPLIER`) ya da
// `Subcontractor` (fason firma). Sektör dayanağı Logo/Mikro/SAP BP: alış her
// cariden yapılır ve boyahaneden mal almak meşrudur. Fatura/tahsilat/cari
// katmanı İKİ tarafı da zaten taşıyor (`CariAccount.customerId` XOR
// `subcontractorId`, `ensureCariAccountTx`) — eksik olan yalnız alış tarafıydı.
//
// ⚠️ XOR TEK KAPIDA. Şemada iki kolonlu CHECK bilinçli olarak YOK (migration
// 9dc16510 notu): kısıt "23514" diye çıplak bir constraint adı basar, oysa
// operatörün duyması gereken şey somut bir cümledir. O cümlenin İKİ kopyası
// olmamalı — mal kabul ile alış siparişi aynı soruya farklı kelimelerle cevap
// verirse kullanıcı kuralın ne olduğunu iki ekrandan öğrenmek zorunda kalır.
//
// ⚠️ İKİ MOD, TEK FONKSİYON:
//   • `required: true`  → alış SİPARİŞİ. Sipariş bir TAAHHÜTTÜR; kime verildiği
//     belirsiz bir taahhüt yoktur (şemada `supplierId` bu yüzden NOT NULL'dı ve
//     C4 ile nullable oldu — kısıt kolondan servise TAŞINDI, kaldırılmadı).
//   • `required: false` → mal KABUL fişi. `GoodsReceipt.supplierId` C4'ten ÖNCE
//     de opsiyoneldi (mal önce girer, tedarikçi sonra netleşir) ve o davranış
//     bayt-bayt korunur. Kural yalnız "EN FAZLA biri dolu"dur. Faturaya
//     giderken tedarikçi ZORUNLU olur — o kapı `createDraftFromGoodsReceipt`te.
//
// ⚠️ `CompanyType` KONTROL EDİLMEZ (mevcut `assertSupplier` gerekçesi aynen
// geçerli): şema notu tipin "bir ETİKET, duvar DEĞİL" olduğunu söylüyor ve
// kardeş akış `GoodsReceipt` de tipe bakmıyordu. Tek tarafta zorlamak, siparişi
// reddedip aynı firmadan mal kabulünü kabul eden tutarsız bir çift üretirdi.
//
// ⚠️ TEDARİKÇİ KİMLİĞİNİN TEK ADRESİ KART (rol modeli faz 2, E): fason bacağı
// YAZIMDA profilin bağlı kartına çözülür (`resolvePartyToCardTx`, cari hesapla
// aynı helper) — bağlı fasona alış/mal kabul `supplierId = kart` yazar, ikinci
// adres doğmaz; bağsız profil eskisi gibi (`subcontractorId`). Okuma iki bacağı
// da kabul eder (eski kayıtlar).
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { resolvePartyToCardTx } from "./party-card.helper";

export interface SupplierPartyInput {
  /** Müşteri-tipli cari (`Customer`). */
  supplierId?: string | null;
  /** Fason firma (`Subcontractor`) — C4 bacağı. */
  subcontractorId?: string | null;
}

export interface ResolvedSupplierParty {
  supplierId: string | null;
  subcontractorId: string | null;
}

/** İki bacaktan biri (ya da hiçbiri) beyan edilmiş mi — girdi TAŞIYOR mu. */
export function hasSupplierPartyInput(input: SupplierPartyInput): boolean {
  return input.supplierId !== undefined || input.subcontractorId !== undefined;
}

/**
 * SAF XOR KAPISI — DB'ye dokunmaz, yalnız kombinasyonu ölçer.
 *
 * Ayrı durmasının sebebi: kural bir CÜMLEDİR ve cümle testte de, iki serviste
 * de aynı yerden okunmalı. Varlık/aktiflik kontrolü ayrı bir sorudur ve ayrı
 * bir sorgu ister (`resolveSupplierParty`).
 */
export function assertSupplierPartyXor(
  input: SupplierPartyInput,
  opts: { required: boolean },
): ResolvedSupplierParty {
  const supplierId = input.supplierId ?? null;
  const subcontractorId = input.subcontractorId ?? null;

  if (supplierId && subcontractorId) {
    throw AppError.badRequest(
      "Tedarikçi YA müşteri-tipli cari YA fason firma olabilir — ikisi birden seçilemez. Birini boşaltın.",
    );
  }
  if (opts.required && !supplierId && !subcontractorId) {
    throw AppError.badRequest(
      "Tedarikçi zorunlu — müşteri-tipli cari ya da fason firma seçin.",
    );
  }
  return { supplierId, subcontractorId };
}

/** Kayıtlı tarafı (sipariş/fiş satırı) karta çözer — mal kabul siparişten devralırken aynı adresi görsün. */
export async function resolveStoredSupplierParty(
  party: ResolvedSupplierParty,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ResolvedSupplierParty> {
  const card = await resolvePartyToCardTx(db, { customerId: party.supplierId, subcontractorId: party.subcontractorId });
  return { supplierId: card.customerId, subcontractorId: card.subcontractorId };
}

/**
 * XOR + varlık + aktiflik + KARTA ÇÖZÜM. Seçilen bacak hangisiyse YALNIZ o sorgulanır (boş
 * bacakta tek sorgu bile koşmaz → tedarikçisiz mal kabul yolu bayt-bayt aynı); bağlı fason
 * profili karta çözülür ve kartın aktifliği de ölçülür (kart artık kimliktir).
 *
 * ⚠️ Mesajlar C4 ÖNCESİYLE BİREBİR ("Tedarikçi bulunamadı." / `"X" pasif
 * durumda.`): mevcut yolun kullanıcı-görünür davranışı bu köprü yüzünden
 * değişmemeli. Fason bacağının mesajı ise TARAFI SÖYLER ("Fason firma
 * bulunamadı.") — iki tablodan hangisinde arandığı belirsiz kalırsa kullanıcı
 * yanlış ekranda kayıt aramaya gider.
 */
export async function resolveSupplierParty(
  input: SupplierPartyInput,
  opts: { required: boolean },
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<ResolvedSupplierParty> {
  const declared = assertSupplierPartyXor(input, opts);

  if (declared.subcontractorId) {
    const sub = await db.subcontractor.findUnique({
      where: { id: declared.subcontractorId },
      select: { id: true, name: true, isActive: true },
    });
    if (!sub) throw AppError.badRequest("Fason firma bulunamadı.");
    if (!sub.isActive) throw AppError.badRequest(`"${sub.name}" pasif durumda.`);
  }

  const party = await resolveStoredSupplierParty(declared, db);

  if (party.supplierId) {
    const sup = await db.customer.findUnique({
      where: { id: party.supplierId },
      select: { id: true, name: true, isActive: true },
    });
    if (!sup) throw AppError.badRequest("Tedarikçi bulunamadı.");
    if (!sup.isActive) throw AppError.badRequest(`"${sup.name}" pasif durumda.`);
  }

  return party;
}

/** İki bacak da boş mu (tedarikçisiz belge). */
export function isPartyEmpty(party: ResolvedSupplierParty): boolean {
  return !party.supplierId && !party.subcontractorId;
}

/** İki taraf AYNI cariyi mi işaret ediyor (bacak + kimlik birlikte). */
export function samePartyAs(a: ResolvedSupplierParty, b: ResolvedSupplierParty): boolean {
  return a.supplierId === b.supplierId && a.subcontractorId === b.subcontractorId;
}
