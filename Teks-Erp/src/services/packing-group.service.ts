// =============================================================================
// PAKETLEME GRUBU — havuz çuvallarını "aynı sevke hazırlananlar" diye ayıran
// ÇALIŞMA YAFTASI (2026-09-10 saha isteği)
// =============================================================================
// Saha derdi: bir carinin farklı zamanlarda çıkacak iki hazırlığı aynı havuzda
// bekliyor. Paketleme ekranı hepsini TEK düz liste gösteriyordu ve "Hemen Sevk
// Et" seçim tanımadığı için içi dolu HER çuvalı gönderiyordu — salı tırı için
// basılan buton gelecek haftanın çuvallarını da alıyordu.
//
// ── NE DEĞİL ───────────────────────────────────────────────────────────────
// REZERVASYON DEĞİL. Yafta stok düşmez, çuvalı kilitlemez, deftere yazmaz,
// başka bir sevkin o çuvalı almasını ENGELLEMEZ. Gerçek rezervasyon ayrı bir
// karardır (`shipping.reservationEnabled` — kendi append-only defteriyle kurulur
// ve `SackAllocation`a DOKUNMAZ; o sevk muhasebesidir).
//
// ── NUMARA KİMLİK DEĞİL, PARK YERİDİR ──────────────────────────────────────
// Görünen ad ekrandan ibarettir: belgeye, etikete, irsaliyeye BASILMAZ. Bu
// yüzden numara geri kullanılabilir; kimlik `PackingGroup.id`dir (`Batch` ile
// aynı karar: P01…P99 sarar, kimlik UUID'dir). Çıktılar (Excel/PDF) birer
// ÇALIŞMA KÂĞIDIDIR ve başlıkları cari + grup + ÜRETİM ANI taşır.
//
// ── GRUP SİLİNMEZ, GÖRÜNMEZ OLUR ───────────────────────────────────────────
// "Canlı grup" = havuzda EN AZ BİR çuvalı olan grup (`sacks.some(shipmentId:
// null)`). Son çuval sevk edilince grup listelenmez ve numarası sayaçta
// sayılmaz. Ölümü SİLME ile kurmak, çuvalı havuzdan çıkaran HER yola (sevk ·
// dağıtma · storno · çuval silme) birer temizlik kancası takmak demekti;
// unutulan biri hayalet grup bırakırdı. Üyelik çuvalın üstünde durduğu için o
// yolların hiçbirine dokunmaya gerek yok.
//
// ── STORNO İLE DİRİLME BİLİNÇLİDİR ─────────────────────────────────────────
// `undoDispatch({releaseSacks})` çuvalı havuza geri koyduğunda `packingGroupId`
// yerinde durduğu için hazırlık grubu da olduğu gibi geri gelir. Storno'nun
// sözleşmesi "mal HİÇ ÇIKMADI"dır; hazırlığın da hiç bozulmamış olması doğru
// cevaptır.
//
// ── SEVK PARTİSİ MODU (2026-09-21, `packing.groupMode = sevk-partisi`) ─────
// Aynı tablo, ikinci DAVRANIŞ (docs/design/SEVK-PARTISI-TASARIM.md): grup bir
// yafta değil KAPTIR — açık/kapalı durum taşır, boş doğar ve yaşar, parti sırası
// geri verilmez (adı belgeye basılır), her çuval parti içinde bir AMBALAJ NO alır
// ve sevk edildikten sonra da partide numarasıyla kalır. Yukarıdaki "numara park
// yeridir / grup görünmez olur" cümleleri YALNIZ grup moduna aittir; moda göre
// dallanan tek yüklem `liveGroupWhere`, tek ayar demeti `readPackingLotSettings`.
// =============================================================================

import { Prisma } from "@prisma/client";

import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import {
  readPackingGroupNumbering,
  readPackingGroupsEnabled,
} from "./system-setting.service";
import { assertReplayPayloadMatches } from "./helpers/idempotent-replay.helper";
import { markLotLabelsStale } from "./packing-lot.service";
import {
  assertGroupNameFreeTx,
  claimSacksIntoGroupTx,
  formatPackingGroupName,
  nextPackingGroupSeqTx,
  liveGroupSql,
  nextPackingGroupCodeTx,
  PACKING_GROUP_CODE_LOCK_NS,
  readPackingLotSettings,
} from "./helpers/packing-group.helper";
import { loadPackingGroupDto, loadPackingGroupDtos } from "./helpers/packing-group-dto.helper";
import type { PackingGroupDto } from "./helpers/packing-group-dto.helper";
import { packageNoStart } from "./helpers/packing-group.helper";
import { assertManualNumberAllowed } from "./helpers/manual-number.helper";

const GROUP_TABLE = "packing_groups";

/**
 * YAZMA KAPISI — TEK NOKTA, FAIL-CLOSED.
 *
 * Bayrak KAPALIYKEN (varsayılan) Paketleme ekranı grup göstermez. Yazma ucu açık
 * bırakılsaydı eski/başıboş bir istemci GÖRÜNMEYEN grup yaratabilirdi: çuvallar
 * bir gruba bağlanır, hiçbir ekran onu çizmez ve operatör "çuvalım nerede"
 * derdi. Okuma uçları kapılı DEĞİL — bayrak kapalıyken zaten boş dönerler.
 */
async function assertPackingGroupsEnabled(): Promise<void> {
  if (await readPackingGroupsEnabled()) return;
  throw AppError.forbidden("Paketleme grubu özelliği kapalı", {
    code: "PACKING_GROUPS_DISABLED",
  });
}

export type PackingGroupListStatus = "OPEN" | "CLOSED" | "ALL";

/**
 * `createWithSacks` replay'i (clientToken). GÖVDE KAPISI (F117): aynı token BAŞKA bir
 * yükle gelirse cached kaydı dönmek YANLIŞ cevaptır — operatör "atadım" sanır, seçtiği
 * çuvallar gruplanmamış kalır. Kimlik: cari + ÇUVAL KÜMESİ. REPLAY'İN DÖRDÜNCÜ DURUMU:
 * token'lı grup bu arada BOŞALMIŞSA (grup modu) cached kaydı dönmek yanlış cevaptır —
 * operatöre boş bir grup gösterirdi; parti modunda boş parti MEŞRUDUR, kapı yok.
 */
async function replayCreateWithSacks(
  clientToken: string,
  customerId: string,
  sackIds: string[],
  lotMode: boolean,
): Promise<ApiResponse<PackingGroupDto> | null> {
  const replay = await prisma.packingGroup.findUnique({
    where: { clientToken },
    select: { id: true, customerId: true, sacks: { where: { shipmentId: null }, select: { id: true } } },
  });
  if (!replay) return null;
  assertReplayPayloadMatches(
    [
      { ad: "customerId", mevcut: replay.customerId, gelen: customerId },
      {
        ad: "sackIds",
        mevcut: [...replay.sacks.map((sk) => sk.id)].sort().join(","),
        gelen: [...sackIds].sort().join(","),
      },
    ],
    "Bu istemci anahtarı BAŞKA bir çuval kümesiyle kullanılmış — listeyi yenileyip yeniden deneyin.",
  );
  if (replay.sacks.length === 0 && !lotMode) {
    throw AppError.conflict(
      "Bu grup daha önce oluşturulmuş ama içinde havuz çuvalı kalmamış — " +
        "çuvalları yeniden seçip yeni bir grup oluşturun.",
      { code: "PACKING_GROUP_REPLAY_EMPTY" },
    );
  }
  return { success: true, data: (await loadPackingGroupDto(prisma, replay.id))!, message: "Grup zaten oluşturulmuş" };
}


export const PackingGroupService = {
  /**
   * Bir carinin CANLI grupları. Ölü grup (havuzda çuvalı kalmamış) listelenmez —
   * silinmediği için hâlâ DB'dedir, yalnız hiçbir yüzeyden görünmez.
   */
  async list(
    customerId: string,
    opts: { status?: PackingGroupListStatus } = {},
  ): Promise<ApiResponse<PackingGroupDto[]>> {
    const lot = await readPackingLotSettings();
    // Parti modunda `status` süzgeci: AÇIK (varsayılan) · KAPALI · TÜMÜ. Grup
    // modunda süzgeç YOK — canlılık türetilmiş, bayat parametre sessizce yutulmaz.
    if (lot.mode !== "sevk-partisi" && opts.status && opts.status !== "OPEN") {
      throw AppError.badRequest("Durum süzgeci yalnız sevk partisi modunda var", { code: "PACKING_LOT_MODE_OFF" });
    }
    const status = opts.status ?? "OPEN";
    // Toplamlar DB'de (`loadPackingGroupDtos`, GROUP BY); canlılık `liveGroupSql` ikizinden.
    const cari = Prisma.sql`g."customerId" = ${customerId}::uuid`;
    const where =
      lot.mode === "sevk-partisi"
        ? status === "ALL"
          ? cari
          : status === "OPEN"
            ? Prisma.sql`${cari} AND ${liveGroupSql("sevk-partisi")}`
            : Prisma.sql`${cari} AND g.status::text = ${status}`
        : Prisma.sql`${cari} AND ${liveGroupSql("grup")}`;
    return { success: true, data: await loadPackingGroupDtos(prisma, where) };
  },

  /** Tek parti/grup (parti içi ekranın başlığı). */
  async get(groupId: string): Promise<ApiResponse<PackingGroupDto>> {
    const row = await loadPackingGroupDto(prisma, groupId);
    if (!row) throw AppError.notFound("Grup bulunamadı");
    return { success: true, data: row };
  },

  /**
   * "Parti Ata" — seçili çuvallardan YENİ grup kurar.
   *
   * ⚠️ GRUP ÇUVALSIZ DOĞMAZ: kurulum ve atama TEK tx'tedir. Boş grup
   * doğsaydı tanımı gereği "ölü" olurdu (havuzda çuvalı yok) — yani doğar
   * doğmaz görünmez olurdu ve operatör "grup kayboldu" derdi.
   */
  async createWithSacks(input: {
    customerId: string;
    sackIds: string[];
    name?: string | null;
    note?: string | null;
    clientToken?: string | null;
    userId?: string;
  }): Promise<ApiResponse<PackingGroupDto>> {
    await assertPackingGroupsEnabled();
    const lot = await readPackingLotSettings();
    const lotMode = lot.mode === "sevk-partisi";
    const sackIds = [...new Set(input.sackIds)];
    // Parti modunda BOŞ PARTİ MEŞRUDUR (K5: "sevk partisi oluştur" → içine çuval açılır).
    if (sackIds.length === 0 && !lotMode) throw AppError.badRequest("En az bir çuval seçin");

    if (input.clientToken) {
      const cached = await replayCreateWithSacks(input.clientToken, input.customerId, sackIds, lotMode);
      if (cached) return cached;
    }

    const mode = await readPackingGroupNumbering();
    const manualName = input.name?.trim() || null;
    // ⚠️ Bu seri OKUTULMUYOR: kapı yalnız MODA bakar, biçim sınaması yapmaz —
    // grup adı sahanın kendi kelimesidir ("P3"), barkod değil.
    assertManualNumberAllowed("packingLotName", manualName);

    const created = await prisma.$transaction(async (tx) => {
      // KOD KİLİDİ tx'in İLK ifadesi (8034, kurulum-geneli) — sonra ad sayacı (8031).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PACKING_GROUP_CODE_LOCK_NS}::int, 0)`;
      const code = await nextPackingGroupCodeTx(tx);
      // Elle ad verildiyse sayaç HİÇ ÇALIŞMAZ: "Cuma tırı" bir sıra numarası değildir
      // ve sonraki otomatik numarayı zıplatmamalı.
      const seq = manualName ? null : await nextPackingGroupSeqTx(tx, input.customerId, mode, lot.mode);
      const name = manualName ?? formatPackingGroupName(seq as number, lot.mode);

      await assertGroupNameFreeTx(tx, input.customerId, name, { exceptId: null, groupMode: lot.mode });

      const group = await tx.packingGroup.create({
        data: {
          customerId: input.customerId,
          code,
          name,
          seq,
          note: input.note?.trim() || null,
          clientToken: input.clientToken ?? null,
          createdById: input.userId ?? null,
          updatedById: input.userId ?? null,
          // Sayaç ilk çuvalın numarasından başlar (K3); grup modunda okunmaz.
          nextPackageNo: packageNoStart(lot.startsAtZero),
        },
        select: { id: true },
      });

      if (sackIds.length > 0) {
        await claimSacksIntoGroupTx(tx, {
          customerId: input.customerId,
          sackIds,
          groupId: group.id,
          lot: lotMode ? { numbering: lot.numbering, startsAtZero: lot.startsAtZero } : null,
        });
      }

      return (await loadPackingGroupDto(tx, group.id))!;
    });

    await AuditService.log({
      userId: input.userId,
      action: "CREATE",
      tableName: GROUP_TABLE,
      recordId: created.id,
      newData: { code: created.code, name: created.name, seq: created.seq, sackCount: created.sackCount },
    });
    return { success: true, data: created, message: `${created.name} oluşturuldu` };
  },

  /** Var olan CANLI gruba çuval ekler. */
  async addSacks(
    groupId: string,
    sackIds: string[],
    userId?: string,
  ): Promise<ApiResponse<PackingGroupDto>> {
    await assertPackingGroupsEnabled();
    const lot = await readPackingLotSettings();
    const lotMode = lot.mode === "sevk-partisi";
    const ids = [...new Set(sackIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçin");

    const group = await prisma.packingGroup.findUnique({
      where: { id: groupId },
      select: { id: true, customerId: true, name: true, status: true, sacks: { where: { shipmentId: null }, select: { id: true } } },
    });
    if (!group) throw AppError.notFound("Grup bulunamadı");
    if (lotMode) {
      // KAPALI PARTİYE ÇUVAL GİRMEZ — önce yeniden açılır (K5). Boş açık parti
      // MEŞRU, ölü-grup kapısı burada yok.
      if (group.status !== "OPEN") {
        throw AppError.conflict(`${group.name} kapalı — çuval eklemek için partiyi yeniden açın.`, {
          code: "PACKING_LOT_CLOSED",
        });
      }
    } else if (group.sacks.length === 0) {
      // ÖLÜ GRUP DİRİLTİLMEZ: boşalmış bir gruba çuval eklemek, geçen haftanın
      // notunu bugünkü çuvallara yapıştırırdı. Ölü grup zaten hiçbir listede yok;
      // buraya ancak elde kalmış bayat bir id ile gelinir.
      throw AppError.conflict(
        "Bu grup boşalmış (içinde havuz çuvalı kalmamış) — yeni bir grup oluşturun.",
        { code: "PACKING_GROUP_DEAD" },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await claimSacksIntoGroupTx(tx, {
        customerId: group.customerId,
        sackIds: ids,
        groupId,
        lot: lotMode ? { numbering: lot.numbering, startsAtZero: lot.startsAtZero } : null,
      });
      return (await loadPackingGroupDto(tx, groupId))!;
    });

    if (lotMode) await markLotLabelsStale(group.customerId, ids);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: GROUP_TABLE,
      recordId: groupId,
      newData: { addedSackIds: ids },
    });
    return { success: true, data: updated, message: lotMode ? `Çuvallar ${group.name} partisine alındı` : "Çuvallar gruba eklendi" };
  },

  /**
   * Çuvalları GRUPTAN ÇIKARIR ("Gruplanmamış"a döner). Grubu silmez: son çuval
   * da çıkarsa grup kendiliğinden ölür (görünmez olur).
   */
  async removeSacks(sackIds: string[], userId?: string): Promise<ApiResponse<{ count: number }>> {
    await assertPackingGroupsEnabled();
    const ids = [...new Set(sackIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçin");
    const res = await prisma.sack.updateMany({
      where: { id: { in: ids }, shipmentId: null },
      // Partiden çıkan çuvalın numarası da düşer (grup modunda zaten NULL).
      data: { packingGroupId: null, packageNo: null },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      // Çuvalın KENDİ geçmişine yazılır ("SACK"), grup kataloğuna değil —
      // iz atamalarıyla aynı emsal (`sack-tag.service.ts`).
      tableName: "SACK",
      recordId: ids[0],
      newData: { packingGroupId: null, sackIds: ids },
    });
    return { success: true, data: { count: res.count }, message: "Çuvallar gruptan çıkarıldı" };
  },

  /** Grup adını / notunu günceller (ad override + not). */
  async update(
    groupId: string,
    input: { name?: string | null; note?: string | null },
    userId?: string,
  ): Promise<ApiResponse<PackingGroupDto>> {
    await assertPackingGroupsEnabled();
    const lot = await readPackingLotSettings();
    const current = await prisma.packingGroup.findUnique({
      where: { id: groupId },
      select: { id: true, customerId: true, name: true, seq: true, note: true },
    });
    if (!current) throw AppError.notFound("Grup bulunamadı");

    const data: Prisma.PackingGroupUpdateInput = { updatedById: userId ?? null };
    if (input.name !== undefined) {
      const name = input.name?.trim();
      if (!name) throw AppError.badRequest("Grup adı boş olamaz");
      // Ad ELLE değiştirildi → `seq` DÜŞER. Numara artık bu grubu tarif etmiyor;
      // `seq` bırakılsaydı sayaç "3. Grup" diye bir grup varmış gibi davranır ve
      // ekranda hiç görünmeyen bir numarayı rezerve ederdi. (Parti modunda sayaç
      // kapalı partilere de baktığı için numara yine geri verilmez.)
      await assertGroupNameFreeTx(prisma, current.customerId, name, { exceptId: groupId, groupMode: lot.mode });
      data.name = name;
      data.seq = null;
    }
    if (input.note !== undefined) data.note = input.note?.trim() || null;

    const row = await prisma.packingGroup.update({
      where: { id: groupId },
      data,
      select: { id: true, name: true, seq: true, note: true },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: GROUP_TABLE,
      recordId: groupId,
      oldData: { name: current.name, seq: current.seq, note: current.note },
      newData: { name: row.name, seq: row.seq, note: row.note },
    });
    return { success: true, data: (await loadPackingGroupDto(prisma, groupId))!, message: "Grup güncellendi" };
  },
};
