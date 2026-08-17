// =============================================================================
// KAYIT BİLGİSİ — "bunu kim oluşturdu, en son kim değiştirdi?" (2026-08-17)
// =============================================================================
// Saha isteği: sipariş/iş emri gibi önemli kayıtlarda bir ⓘ düğmesi; basınca
// ilk oluşturulma ve son değişiklik anı + kim yaptığı görünsün.
//
// ── BACKENDİ EN AZ YORAN TASARIM ────────────────────────────────────────────
// Üç karar bunun için verildi:
//
//   1. LİSTE VE DETAY PAYLOAD'LARINA HİÇBİR ŞEY EKLENMEDİ. Bilgi yalnız ⓘ'ye
//      BASILINCA çekilir. Tersi (her satıra "son değiştiren" iliştirmek) her
//      liste isteğine bir join daha bindirirdi ve bilgiye yüz satırda bir kez
//      bakılıyor.
//
//   2. TARİHLER SUNUCUDAN İSTENMEZ. `createdAt`/`updatedAt` istemcinin elindeki
//      kayıtta ZATEN var; buradan yalnız KİM sorusunun cevabı döner. Böylece
//      sorgu ikinci bir tabloya (siparişe/iş emrine) hiç gitmez.
//
//   3. İKİ İNDEKSLİ SORGU. `system_logs` üzerinde `@@index([tableName, recordId])`
//      mevcut; ilk CREATE ve son kayıt bu indeksten iki `findFirst` ile okunur.
//
// ⚠️ TABLO ALLOWLIST'İ VE YETKİ ROUTE KATMANINDA (`record-info.routes.ts`):
// yetkilendirme guard'ın işi. Bu servis, çağrıldığı ana kadar doğrulamanın
// yapıldığını varsayar ve YALNIZ route'tan çağrılır.
//
// ⚠️ AUDIT 6 AYDA BİR ARŞİVLENİR (`jobs/archive-scheduler`). Eski kayıtlarda
// satır bulunamaz — bu bir HATA DEĞİL, dürüst cevaptır: `null` döner ve arayüz
// "kayıt arşivlenmiş" der. Sessizce "bilinmiyor" yazmak, veriyi kaybettiğimizi
// gizlerdi.
// =============================================================================

import prisma from "../lib/prisma";
import { ApiResponse } from "../types/api.types";

export interface RecordActor {
  at: string;
  userId: string | null;
  userName: string | null;
  action?: string;
}

export interface RecordInfo {
  /** İlk CREATE kaydı — audit arşivlendiyse null. */
  created: RecordActor | null;
  /** En son herhangi bir kayıt (UPDATE/DELETE/CREATE) — yoksa null. */
  lastChange: RecordActor | null;
  /** Audit'te bu kayda ait HİÇ satır yok mu (arşiv ya da hiç yazılmamış). */
  auditEmpty: boolean;
}

function toActor(row: {
  createdAt: Date;
  action?: string;
  userId: string | null;
  user: { fullName: string | null; username: string } | null;
}): RecordActor {
  return {
    at: row.createdAt.toISOString(),
    userId: row.userId,
    // Ad yoksa kullanıcı adına düş — "—" yazmak "kim olduğu bilinmiyor"
    // demektir, oysa biliyoruz.
    userName: row.user?.fullName?.trim() || row.user?.username || null,
    ...(row.action ? { action: row.action } : {}),
  };
}

export class RecordInfoService {
  /**
   * Kaydın ilk oluşturucusu + son değiştireni. İki indeksli `findFirst`.
   *
   * `CREATE` satırı ayrı aranır çünkü en eski satır her zaman CREATE olmayabilir
   * (audit kısmen arşivlenmiş olabilir ya da kayıt migration'la doğmuş olabilir).
   */
  async get(tableName: string, recordId: string): Promise<ApiResponse<RecordInfo>> {
    const userSelect = {
      createdAt: true,
      action: true,
      userId: true,
      user: { select: { fullName: true, username: true } },
    } as const;

    const [createdRow, lastRow] = await Promise.all([
      prisma.systemLog.findFirst({
        where: { tableName, recordId, action: "CREATE" },
        orderBy: { createdAt: "asc" },
        select: userSelect,
      }),
      prisma.systemLog.findFirst({
        where: { tableName, recordId },
        orderBy: { createdAt: "desc" },
        select: userSelect,
      }),
    ]);

    return {
      success: true,
      data: {
        created: createdRow ? toActor(createdRow) : null,
        lastChange: lastRow ? toActor(lastRow) : null,
        auditEmpty: !createdRow && !lastRow,
      },
    };
  }
}

export const recordInfoService = new RecordInfoService();
