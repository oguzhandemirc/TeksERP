// Sistem hesabı mührü (G1) bekçi fikstürleri: geçici LICENSE_DIR (ortak test dizinine mandal
// bırakmamak için) ve doğrudan yaratılan fikstür sistem hesabını gerçek doğuş gibi mühürleme.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import prisma from "../../src/lib/prisma";
import { loadLicenseStoreSync } from "../../src/lib/license/store";
import { resetSystemAccountSealCacheForTest, writeSeal } from "../../src/services/helpers/system-account-seal.helper";

/** Süreç için geçici lisans dizini (anahtar doğar, mandal yok); dönüşteki işlev dizini siler. */
export function geciciLisansDizini(ad: string): { dizin: string; temizle: () => void } {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), `tekserp-${ad}-`));
  process.env.LICENSE_DIR = dizin;
  loadLicenseStoreSync({ dir: dizin });
  resetSystemAccountSealCacheForTest();
  return { dizin, temizle: () => fs.rmSync(dizin, { recursive: true, force: true }) };
}

/**
 * Doğrudan `create` edilen fikstür sistem hesabını mühürler — mandallı ortamda gerçek hesap gibi
 * yetki alsın. Anahtar yoksa mühürsüz kalır (mandal da yoktur ⇒ bugünkü davranış).
 */
export async function fiksturMuhurle(userId: string): Promise<string> {
  const sonuc = await writeSeal(prisma, userId);
  resetSystemAccountSealCacheForTest();
  return sonuc.durum;
}
