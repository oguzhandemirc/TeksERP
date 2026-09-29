// KURULUM KAYDI (3d-2): fabrikanın `kur.ps1` geçmişi yoklamayla gelir ve `kurulum_kaydi` DEFTERİNE
// yazılır. Kimlik fabrikanın `kayitId`sidir: (kurulum, kaynakKayitId) UNIQUE → tekrar yoklama aynı
// satırı ikinci kez yazmaz (ON CONFLICT DO NOTHING; defter satırı değişmez).
import type { Prisma } from "@prisma/client";
import type { InstallRecord } from "../lisans-protokol";
import type { Db } from "../lib/prisma";

export const INSTALL_RECORD_EVENTS = { KURULUM: "BACKEND_KURULDU", GERI_ALMA: "BACKEND_GERI_ALINDI" } as const;

export async function recordInstallHistory(
  db: Db,
  g: { installationDbId: string; kid: string; records: readonly InstallRecord[] | undefined },
): Promise<number> {
  if (!g.records || g.records.length === 0) return 0;
  const r = await db.kurulumKaydi.createMany({
    data: g.records.map((k) => ({
      kurulumId: g.installationDbId,
      olay: INSTALL_RECORD_EVENTS[k.tur],
      anahtarKimligi: g.kid,
      ayrinti: k as unknown as Prisma.InputJsonObject,
      yapan: "kurulum",
      kaynakKayitId: k.kayitId,
    })),
    skipDuplicates: true,
  });
  return r.count;
}
