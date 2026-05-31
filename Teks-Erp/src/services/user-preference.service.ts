// =============================================================================
// TeksERP - User Preference Service
// =============================================================================
// Kullanıcının kendi UI tercihleri (accent, tema, yoğunluk, menü favorileri,
// kayıtlı görünümler). Tek satır/kullanıcı, esnek Json blob. Frontend şekli
// sahiplenir; burada doğrulama gevşek (record) — yeni alan migration istemez.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

export type PreferencesData = Record<string, unknown>;

export class UserPreferenceService {
  /** Kullanıcının tercihlerini döner; kayıt yoksa boş obje. */
  static async get(userId: string): Promise<PreferencesData> {
    const row = await prisma.userPreference.findUnique({
      where: { userId },
      select: { preferences: true },
    });
    return (row?.preferences as PreferencesData) ?? {};
  }

  /**
   * Tercihleri upsert eder (tüm blob'u değiştirir). Kişisel UI durumu olduğu
   * için audit'e YAZILMAZ — aktivite akışını/bildirimleri gürültüyle doldurmasın
   * ve sık yazıldığından (accent, sütun sürükleme vb.) ek SystemLog yükü olmasın.
   *
   * Yarış-dayanıklı: kullanıcının ilk kaydında (satır yokken) iki yazma birden
   * upsert'in "create" dalına girip biri unique (P2002) / FK (P2003) hatası
   * alabilir. Satır artık var → düz update ile bir kez tekrar dener (idempotent).
   * Update de patlarsa (ör. kullanıcı gerçekten silinmiş → P2025) hata üst
   * katmana gider; sahte/transient hata kullanıcıya yansımaz.
   */
  static async save(userId: string, preferences: PreferencesData): Promise<PreferencesData> {
    const data = preferences as Prisma.InputJsonValue;
    try {
      const row = await prisma.userPreference.upsert({
        where: { userId },
        create: { userId, preferences: data },
        update: { preferences: data },
        select: { preferences: true },
      });
      return row.preferences as PreferencesData;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === "P2002" || err.code === "P2003")
      ) {
        const row = await prisma.userPreference.update({
          where: { userId },
          data: { preferences: data },
          select: { preferences: true },
        });
        return row.preferences as PreferencesData;
      }
      throw err;
    }
  }
}
