// =============================================================================
// TeksERP - Station Service (extends BaseService)
// =============================================================================
// Tek override: **kategori seçilince yetenek bayrakları TOHUMLANIR** (2026-08-10).
//
// Yetenek (`appliesColor`/`appliesProperty`) artık istasyonun KENDİ alanı — eskiden
// `defaultCategory`'den türetiliyordu ve kategorisi olmayan iç istasyon tanım
// gereği "renk veremez" oluyordu. Türetmeyi kaldırırken şu ergonomi kaybolurdu:
// "Boyahane" kategorisini seçen admin, AYRICA "renk uygular" kutusunu işaretlemek
// zorunda kalırdı — unutulduğunda yeni fason istasyonu SESSİZCE yeteneksiz doğar
// ve rota adımına renk atanamaz (sebebi hiçbir yerde yazmaz).
//
// KURAL: `defaultCategoryId` GÖNDERİLDİ ve bayrak AÇIKÇA gönderilmediyse →
// kategoriden doldur. Bayrak açıkça geldiyse İSTEMCİ KAZANIR (tohum, kilit değil).
// `defaultCategoryId: null` (kategori kaldırma) bayraklara DOKUNMAZ: istasyonun
// yeteneği, kategorisi kaldırıldı diye kaybolmamalı.
//
// ⚠️ Bu bir TÜRETME DEĞİL. Kayıt sonrası tek doğruluk kaynağı istasyonun kendi
// alanıdır; kategori sonradan değişirse eski bayraklar KALIR (fabrika bilinçli
// olarak farklılaştırmış olabilir). Türetmeye geri dönmek, iç istasyon
// senaryosunu yeniden kapatır.
// =============================================================================

import { BaseService } from "./base.service";
import { ApiResponse } from "../types/api.types";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { assertStationDefaultLabelCopies } from "./helpers/label-copies.helper";

/**
 * `kind` API davranış dispatch'inin anahtarıdır: rota/iş emri adımı, top girişi,
 * makine ya da oturum bağlı istasyonda değişimi geçmişin anlamını kaydırır → 409.
 * Kullanılmamış istasyonda (yeni tanım düzeltmesi) serbest.
 */
async function assertKindChangeAllowed(id: string, data: Record<string, unknown>): Promise<void> {
  if (data.kind === undefined) return;
  const cur = await prisma.station.findUnique({ where: { id }, select: { kind: true } });
  if (!cur || cur.kind === data.kind) return;
  const [routeSteps, workOrderSteps, rolls, machines, sessions] = [
    await prisma.routeStep.count({ where: { stationId: id } }),
    await prisma.workOrderStep.count({ where: { stationId: id } }),
    await prisma.roll.count({ where: { entryStationId: id } }),
    await prisma.machine.count({ where: { stationId: id } }),
    await prisma.workSession.count({ where: { stationId: id } }),
  ];
  if (routeSteps + workOrderSteps + rolls + machines + sessions === 0) return;
  throw AppError.conflict(
    "Bu istasyon kullanımda — türü değiştirilemez. Yeni türde ayrı bir istasyon tanımlayın.",
    { code: "STATION_KIND_IN_USE", routeSteps, workOrderSteps, rolls, machines, sessions },
  );
}

/** Kategori seçildiyse ve bayrak gönderilmediyse kategoriden tohumla. */
async function seedCapabilityFromCategory(data: Record<string, unknown>): Promise<void> {
  const catId = data.defaultCategoryId;
  if (typeof catId !== "string" || catId.length === 0) return;
  const needColor = data.appliesColor === undefined;
  const needProperty = data.appliesProperty === undefined;
  if (!needColor && !needProperty) return;

  const cat = await prisma.subcontractorCategory.findUnique({
    where: { id: catId },
    select: { appliesColor: true, appliesProperty: true },
  });
  if (!cat) return; // FK doğrulaması BaseService/Prisma'da — burada sessiz geç
  if (needColor) data.appliesColor = cat.appliesColor;
  if (needProperty) data.appliesProperty = cat.appliesProperty;
}

export class StationService extends BaseService {
  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    assertStationDefaultLabelCopies(data);
    await seedCapabilityFromCategory(data);
    return super.create(data, userId);
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    assertStationDefaultLabelCopies(data);
    await assertKindChangeAllowed(id, data);
    await seedCapabilityFromCategory(data);
    return super.update(id, data, userId);
  }
}
