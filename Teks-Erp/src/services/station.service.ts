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
    await seedCapabilityFromCategory(data);
    return super.create(data, userId);
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    await seedCapabilityFromCategory(data);
    return super.update(id, data, userId);
  }
}
