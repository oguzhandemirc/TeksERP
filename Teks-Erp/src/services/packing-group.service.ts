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
import {
  GROUP_WITH_SACKS_SELECT,
  LIVE_GROUP_WHERE,
  PackingGroupDto,
  assertGroupNameFreeTx,
  claimSacksIntoGroupTx,
  formatPackingGroupName,
  nextPackingGroupSeqTx,
  toDto,
} from "./helpers/packing-group.helper";

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

export const PackingGroupService = {
  /**
   * Bir carinin CANLI grupları. Ölü grup (havuzda çuvalı kalmamış) listelenmez —
   * silinmediği için hâlâ DB'dedir, yalnız hiçbir yüzeyden görünmez.
   */
  async list(customerId: string): Promise<ApiResponse<PackingGroupDto[]>> {
    const rows = await prisma.packingGroup.findMany({
      where: { ...LIVE_GROUP_WHERE, customerId },
      select: GROUP_WITH_SACKS_SELECT,
      orderBy: [{ seq: "asc" }, { createdAt: "asc" }],
    });
    return { success: true, data: rows.map(toDto) };
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
    const sackIds = [...new Set(input.sackIds)];
    if (sackIds.length === 0) throw AppError.badRequest("En az bir çuval seçin");

    if (input.clientToken) {
      const replay = await prisma.packingGroup.findUnique({
        where: { clientToken: input.clientToken },
        select: GROUP_WITH_SACKS_SELECT,
      });
      if (replay) {
        // REPLAY'İN DÖRDÜNCÜ DURUMU: token'lı grup bu arada BOŞALMIŞSA cached
        // kaydı dönmek yanlış cevaptır — operatöre boş bir grup gösterirdi ve
        // seçtiği çuvallar gruplanmamış kalırdı. Doğru hamle yeni bir deneme.
        if (replay.sacks.length === 0) {
          throw AppError.conflict(
            "Bu grup daha önce oluşturulmuş ama içinde havuz çuvalı kalmamış — " +
              "çuvalları yeniden seçip yeni bir grup oluşturun.",
            { code: "PACKING_GROUP_REPLAY_EMPTY" },
          );
        }
        return { success: true, data: toDto(replay), message: "Grup zaten oluşturulmuş" };
      }
    }

    const mode = await readPackingGroupNumbering();
    const manualName = input.name?.trim() || null;

    const created = await prisma.$transaction(async (tx) => {
      // Elle ad verildiyse sayaç HİÇ ÇALIŞMAZ (kilit de alınmaz): "Cuma tırı"
      // bir sıra numarası değildir ve sonraki otomatik numarayı zıplatmamalı.
      const seq = manualName ? null : await nextPackingGroupSeqTx(tx, input.customerId, mode);
      const name = manualName ?? formatPackingGroupName(seq as number);

      await assertGroupNameFreeTx(tx, input.customerId, name, null);

      const group = await tx.packingGroup.create({
        data: {
          customerId: input.customerId,
          name,
          seq,
          note: input.note?.trim() || null,
          clientToken: input.clientToken ?? null,
          createdById: input.userId ?? null,
          updatedById: input.userId ?? null,
        },
        select: { id: true },
      });

      await claimSacksIntoGroupTx(tx, {
        customerId: input.customerId,
        sackIds,
        groupId: group.id,
      });

      return tx.packingGroup.findUniqueOrThrow({
        where: { id: group.id },
        select: GROUP_WITH_SACKS_SELECT,
      });
    });

    await AuditService.log({
      userId: input.userId,
      action: "CREATE",
      tableName: GROUP_TABLE,
      recordId: created.id,
      newData: { name: created.name, seq: created.seq, sackCount: created.sacks.length },
    });
    return { success: true, data: toDto(created), message: `${created.name} oluşturuldu` };
  },

  /** Var olan CANLI gruba çuval ekler. */
  async addSacks(
    groupId: string,
    sackIds: string[],
    userId?: string,
  ): Promise<ApiResponse<PackingGroupDto>> {
    await assertPackingGroupsEnabled();
    const ids = [...new Set(sackIds)];
    if (ids.length === 0) throw AppError.badRequest("En az bir çuval seçin");

    const group = await prisma.packingGroup.findUnique({
      where: { id: groupId },
      select: { id: true, customerId: true, name: true, sacks: { where: { shipmentId: null }, select: { id: true } } },
    });
    if (!group) throw AppError.notFound("Grup bulunamadı");
    // ÖLÜ GRUP DİRİLTİLMEZ: boşalmış bir gruba çuval eklemek, geçen haftanın
    // notunu bugünkü çuvallara yapıştırırdı. Ölü grup zaten hiçbir listede yok;
    // buraya ancak elde kalmış bayat bir id ile gelinir.
    if (group.sacks.length === 0) {
      throw AppError.conflict(
        "Bu grup boşalmış (içinde havuz çuvalı kalmamış) — yeni bir grup oluşturun.",
        { code: "PACKING_GROUP_DEAD" },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      await claimSacksIntoGroupTx(tx, { customerId: group.customerId, sackIds: ids, groupId });
      return tx.packingGroup.findUniqueOrThrow({
        where: { id: groupId },
        select: GROUP_WITH_SACKS_SELECT,
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: GROUP_TABLE,
      recordId: groupId,
      newData: { addedSackIds: ids },
    });
    return { success: true, data: toDto(updated), message: "Çuvallar gruba eklendi" };
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
      data: { packingGroupId: null },
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "sacks",
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
      // ekranda hiç görünmeyen bir numarayı rezerve ederdi.
      await assertGroupNameFreeTx(prisma, current.customerId, name, groupId);
      data.name = name;
      data.seq = null;
    }
    if (input.note !== undefined) data.note = input.note?.trim() || null;

    const row = await prisma.packingGroup.update({
      where: { id: groupId },
      data,
      select: GROUP_WITH_SACKS_SELECT,
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: GROUP_TABLE,
      recordId: groupId,
      oldData: { name: current.name, seq: current.seq, note: current.note },
      newData: { name: row.name, seq: row.seq, note: row.note },
    });
    return { success: true, data: toDto(row), message: "Grup güncellendi" };
  },
};

