// Patron bulutu teknik kullanıcısının kimliği — TEK okuyucu (kayıt `system_settings`te; `User`a işaret kolonu yok).
// Ayrı dosya: `auth.service` (kimliksiz liste süzgeci) ile `patron-cloud.service` arasında döngü kurulmasın.
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { PATRON_CLOUD_USER_SETTING_KEY } from "../../constants/reserved-settings";

/** Kayıttaki teknik kullanıcı kimliği (yoksa null). Önbellek YOK: ucuz tek satır, değişiklik anında görünsün. */
export async function readPatronCloudUserId(db: Pick<Prisma.TransactionClient, "systemSetting"> = prisma): Promise<string | null> {
  const row = await db.systemSetting.findUnique({ where: { key: PATRON_CLOUD_USER_SETTING_KEY }, select: { value: true } });
  const v = row?.value;
  return typeof v === "string" && v.length > 0 ? v : null;
}
