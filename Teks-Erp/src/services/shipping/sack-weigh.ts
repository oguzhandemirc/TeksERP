// =============================================================================
// Shipping Service / sack-weigh
// =============================================================================
// Çuval tartımı (weighSack/finishWeigh) ve çuval silme.
// `shipping.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../shipping.service`) okunur.
// =============================================================================

import {
  Prisma,
  SackWeightSource,
  SackWeighingKind,
  SwatchEventType,
} from "@prisma/client";
import prisma from "../../lib/prisma";
import { weightWarning } from "../helpers/measurement-threshold.helper";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import {
  readShippingManualWeightRestrictedEnabled,
  readSimulatedWeightEnabled,
} from "../system-setting.service";
import {
  assertManualWeightAllowed,
} from "../helpers/shipping-weigh-gate.helper";
import {
  touchWarehouseSackTx,
} from "../helpers/shipment-locks.helper";
import { ApiResponse } from "../../types/api.types";
import { transitionSwatchesTx } from "../helpers/swatch-event.helper";
import { ekranYolu } from "../../constants/panel-ekran-yolu";
import type { ShippingServiceThis } from "./shared";

// eslint-disable-next-line max-params -- `this` bağlam bildirimi parametre değil; özgün metot 4 parametreli
export async function weighSack(this: ShippingServiceThis, 
    data: {
      sackId: string;
      weightKg?: number | null;
      source?: "SCALE" | "MANUAL" | "SIMULATED";
    },
    userId?: string,
    stamp?: { machineId?: string | null; stationId?: string | null },
    /** F221 deseni — verilmezse elle-tartı kısıtı ATLANIR (dahili çağrı). */
    opts?: { permissions?: string[] }
  ): Promise<ApiResponse<unknown>> {
    const hasWeight = data.weightKg !== undefined && data.weightKg !== null;
    if (!hasWeight) throw AppError.badRequest("Tartı girilmeli");
    if (!(data.weightKg! > 0)) throw AppError.badRequest("Geçerli bir kg girilmeli");

    // ── SİMÜLE KANTAR KORUMASI ────────────────────────────────────────────────
    // Çuval kg'si sevk irsaliyesine VE çeki listesine basılır (müşteri/gümrük
    // belgesi) → uydurulmuş bir sayı buraya girmemeli. `PeripheralDevice.simulate`
    // açık bir kantar 10–100 kg arası RASTGELE değer üretiyor ve tek-dokunuş tartı
    // onu DOĞRUDAN kaydediyordu; tek koruma bir toast'tı.
    //
    // İKİ SİNYAL (derinlemesine savunma):
    //  (a) İSTEMCİ BEYANI (`source`) — Electron'da TEK sinyal olmak zorunda:
    //      `useMachineScale` kantarı yerel tercihlerden çözebiliyor (DB kaydı OLMAYAN
    //      "local-scale") → backend o cihazı GÖREMEZ.
    //  (b) SUNUCU ÇÖZÜMÜ — mobil oturumda cihaz makine/istasyondan çözülür; cihazın
    //      `simulate`'i açıksa beyan ne olursa olsun reddedilir (istemci yalanına kapalı).
    //
    // `MANUAL` MUAF: operatör kg'yi elle yazmıştır, kantarın simüle olması onu
    // ilgilendirmez — kantarsız/arızalı durumun kaçış yolu bu ve kapatılmamalı.
    //
    // İstemci yalanı (SIMULATED'ı MANUAL diye göndermek) bilinçli kabul: tehdit modeli
    // kötü niyet değil OPERATÖR KAFA KARIŞIKLIĞI (LAN-only kurulum) ve kalan yüzey
    // `weighedById` + audit ile izlenebilir. `DEVICE_PAIRING_REQUIRED`'ın kabul ettiği
    // güven seviyesiyle aynı.
    const declaredSource = data.source ?? "MANUAL";
    // ── ELLE TARTI KISITI (`shipping.manualWeightRestrictedEnabled`) ──────────
    // ⚠️ SIRA LOAD-BEARING: manual-restrict SİMÜLE korumasından ÖNCE koşar,
    // çünkü MANUAL beyanı simüle dalına HİÇ GİRMEZ (orada bilinçli olarak muaf).
    // Sonraya konsaydı kapı MANUAL yolunda hiç çalışmazdı.
    // ⚠️ `declaredSource`e bakar, `data.source`a DEĞİL: `source` opsiyoneldir ve
    // gönderilmezse MANUAL sayılır — ham alana bakan bir guard eski istemciyi
    // (undefined) sessizce geçirir ve bayrak fail-open olur.
    if (declaredSource === "MANUAL") {
      assertManualWeightAllowed({
        restricted: await readShippingManualWeightRestrictedEnabled(),
        permissions: opts?.permissions,
      });
    }
    // ⚠️ `simulated` blok DIŞINDA: kolona ÇÖZÜLMÜŞ kaynak yazılacak, beyan edilen
    // değil. Aksi halde bayrak AÇIKKEN (demo/eğitim) sunucu çapraz kontrolü cihazı
    // simüle bulup isteği GEÇİRDİĞİNDE kolona "SCALE" yazılırdı — yani kolonun tek
    // varlık sebebi (simüle 47.3 ≠ gerçek 47.3) kaybolurdu.
    let simulated = declaredSource === "SIMULATED";
    if (declaredSource !== "MANUAL") {
      if (!simulated && (stamp?.machineId || stamp?.stationId)) {
        const scale = await prisma.peripheralDevice.findFirst({
          where: {
            kind: "SCALE",
            isActive: true,
            deletedAt: null,
            ...(stamp.machineId
              ? { machineId: stamp.machineId }
              : { stationId: stamp.stationId!, machineId: null }),
          },
          orderBy: { createdAt: "asc" },
          select: { simulate: true },
        });
        if (scale?.simulate) simulated = true;
      }
      if (simulated && !(await readSimulatedWeightEnabled())) {
        throw AppError.badRequest(
          `Simüle kantarla tartı kaydedilemez — ${ekranYolu("donanim")} ekranındaki Cihaz Kaydı'ndan bu kantarın ` +
            '"simülasyon" bayrağını kapatın, ya da ⋮ → "Elle kg gir" ile girin.'
        );
      }
    }

    const sack = await prisma.sack.findUnique({ where: { id: data.sackId }, select: { id: true, shipmentId: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuvalın tartısı değiştirilemez");

    // Atomik claim: yukarıdaki tx-dışı guard yalnız UX (404 + okunaklı mesaj) —
    // findUnique ile update arasında çuval bir sevkiyata claim edilebilirdi
    // (check-then-act; tartı DISPATCH sırasında yazılırdı). Otorite kilitte:
    // touchWarehouseSackTx WHERE shipmentId IS NULL, atanmışsa 409.
    // ÇÖZÜLMÜŞ kaynak — beyan edilen DEĞİL. Sunucu cihazı simüle bulduysa (ve bayrak
    // açık olduğu için istek geçtiyse) kolona SIMULATED yazılır; aksi halde kolon
    // "SCALE" der ve simüle 47.3 ile gerçek 47.3 yine ayırt edilemezdi.
    const resolvedSource: SackWeightSource = simulated
      ? SackWeightSource.SIMULATED
      : (declaredSource as SackWeightSource);

    await prisma.$transaction(async (tx) => {
      await touchWarehouseSackTx(tx, data.sackId);
      // ÖLÇÜM DEFTERİ (2026-09-11): yeniden tartı eskiden `weightKg`in ÜSTÜNE
      // yazıyordu ve irsaliyeye giden BRÜT kg'ın önceki değeri hiçbir kalıcı
      // kolonda kalmıyordu. Önceki değeri okuyup olay tipini ondan çözüyoruz.
      const onceki = await tx.sack.findUnique({
        where: { id: data.sackId },
        select: { weightKg: true },
      });
      const stamp = new Date();
      await tx.sack.update({
        where: { id: data.sackId },
        data: {
          weightKg: new Prisma.Decimal(data.weightKg!),
          weightSource: resolvedSource,
          weighedBy: userId ? { connect: { id: userId } } : { disconnect: true },
          weighedAt: stamp,
        },
      });
      await tx.sackWeighing.create({
        data: {
          sackId: data.sackId,
          kind: onceki?.weightKg == null ? SackWeighingKind.WEIGHED : SackWeighingKind.REWEIGHED,
          weightKg: new Prisma.Decimal(data.weightKg!),
          weightSource: resolvedSource,
          weighedById: userId ?? null,
          weighedAt: stamp,
        },
      });
    });
    // Kaynak hem KOLONA (sorgulanabilir, kalıcı) hem AUDİT'e (kim/ne zaman bağlamıyla)
    // yazılır. Kolon iç izdir: belgeye/etikete BASILMAZ (bkz. schema.prisma doc).
    return this.finishWeigh(data, resolvedSource, userId);
  }

export async function finishWeigh(
    data: { sackId: string; weightKg?: number | null },
    resolvedSource: SackWeightSource,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const thresholdWarning = weightWarning(data.weightKg!);
    await AuditService.log({ userId, action: "UPDATE", tableName: "SACK", recordId: data.sackId, newData: { kind: "WEIGH", weightKg: data.weightKg, source: resolvedSource, ...(thresholdWarning ? { thresholdWarning } : {}) } });
    return { success: true, data: {}, message: "Çuval tartısı güncellendi", ...(thresholdWarning ? { warnings: [thresholdWarning] } : {}) };
  }

export async function removeSack(sackId: string, userId?: string, withContents = false): Promise<ApiResponse<unknown>> {
    const sack = await prisma.sack.findUnique({
      where: { id: sackId },
      select: { id: true, sackNo: true, shipmentId: true, _count: { select: { rolls: true, swatches: true } } },
    });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    if (sack.shipmentId != null) throw AppError.conflict("Sevkiyata atanmış çuval silinemez — önce sevkiyattan çıkarın");

    const hasContents = sack._count.rolls > 0 || sack._count.swatches > 0;
    if (hasContents && !withContents) {
      throw AppError.conflict("Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya depoya çıkar");
    }

    const rolls = hasContents ? await prisma.roll.findMany({ where: { sackId }, select: { id: true, barcode: true } }) : [];
    await prisma.$transaction(async (tx) => {
      // Atomik claim: tx-dışı shipmentId guard'ı yalnız UX — "atama-önce-silme-sonra"
      // yarışında PLANNED (onay kapalıysa DISPATCHED) sevkiyattan çuval sessizce
      // silinir, toplar "sevkiyatta ama çuvalsız" limboya düşerdi. Otorite kilitte
      // (dosyadaki diğer tüm depo-çuval mutasyonlarıyla aynı desen).
      await touchWarehouseSackTx(tx, sackId);
      // İçerik sayımı kilit ALTINDA taze — tx-dışı _count bayat olabilir (araya
      // giren okutma dolu çuvalı "boş" diye sildirtmesin). updateMany'ler koşulsuz
      // (boş çuvalda no-op); tx-dışı sayımlar yalnız audit/mesaj için kalır.
      const freshRolls = await tx.roll.count({ where: { sackId } });
      const freshSwatches = await tx.swatch.count({ where: { sackId } });
      if (!withContents && freshRolls + freshSwatches > 0) {
        throw AppError.conflict("Dolu çuval silinemez — önce içindeki top/kartelaları başka çuvala aktar veya depoya çıkar");
      }
      await tx.roll.updateMany({ where: { sackId }, data: { sackId: null } });
      // Çuval satırı silinir; olay satırı çuval numarasını donuk taşır.
      await transitionSwatchesTx(tx, SwatchEventType.UNSACKED, { scope: { sackIds: [sackId] }, sack: { id: sackId, sackNo: sack.sackNo }, ctx: { trigger: "SACK_REMOVE", userId } });
      await tx.sack.delete({ where: { id: sackId } });
    });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "SACK",
      recordId: sackId,
      oldData: { sackNo: sack.sackNo, ...(hasContents ? { kind: "SACK_REMOVE_WITH_CONTENTS", returnedRolls: rolls.map((r) => r.barcode ?? r.id), rollCount: sack._count.rolls, swatchCount: sack._count.swatches } : {}) },
    });
    const n = sack._count.rolls + sack._count.swatches;
    return { success: true, data: { returnedToWarehouse: n }, message: n > 0 ? `Çuval silindi — ${n} top/kartela depoya döndü` : "Çuval silindi" };
  }
