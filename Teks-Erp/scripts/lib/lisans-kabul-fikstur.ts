// Lisans bekçilerinin SÖZLEŞME KABULÜ fikstürü (Ek-7): etkinleştirme artık kabul ister — bekçi, panelin kabul adımını
// servisin kendi yolundan (`recordLicenseAcceptance`) atar. `test_` öneki yok → koşucu bunu bekçi saymaz. Yaratılan
// satırlar kurulum anahtarıyla izlenir ve `temizleKabuller` yalnız onları siler (fikstür teardown'u).
import { randomUUID } from "node:crypto";
import prisma from "../../src/lib/prisma";
import { currentAcceptanceText } from "../../src/lib/license/acceptance-text";
import { getLicenseStore } from "../../src/lib/license/store";
import { recordLicenseAcceptance, type LicenseAcceptanceView } from "../../src/services/license-acceptance.service";
import { testActorId } from "../fixture-test-user";

const anahtarlar = new Set<string>();

/** Güncel metnin bütün kutularıyla kabul (o anki kurulum anahtarına bağlanır). */
export async function kabulEt(g: { userId?: string; adSoyad?: string; unvan?: string; clientToken?: string } = {}): Promise<LicenseAcceptanceView> {
  const t = currentAcceptanceText();
  const kid = getLicenseStore()?.key?.kid;
  if (kid) anahtarlar.add(kid);
  return recordLicenseAcceptance({
    userId: g.userId ?? (await testActorId()),
    input: {
      clientToken: g.clientToken ?? randomUUID(),
      metinKimligi: t.kimlik,
      metinOzeti: t.ozet,
      kutular: [...t.kutular],
      adSoyad: g.adSoyad ?? "Bekçi Yetkili",
      unvan: g.unvan ?? "Genel Müdür",
    },
    panelVersion: "1.5.0",
  });
}

/** Bekçinin kendi anahtarlarına ait kabul satırları (başka koşumun satırına dokunmaz). */
export function kabulAnahtariIzle(kid: string): void {
  anahtarlar.add(kid);
}

export async function temizleKabuller(): Promise<void> {
  if (anahtarlar.size === 0) return;
  await prisma.licenseAcceptance.deleteMany({ where: { installationKeyId: { in: [...anahtarlar] } } });
}
