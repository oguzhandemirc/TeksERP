// =============================================================================
// FİXTÜR — kalite kataloğu satırı ROLDEN çözülür, KODDAN değil
// =============================================================================
// ⚠️ `test_` ÖNEKİ YOK ve olmamalı: koşucu `scripts/test_*.ts` dosyalarını TEST
// sanar; bu bir yardımcıdır (`fixture-test-user.ts` / `fixture-subcontractor.ts`
// emsali).
//
// NEDEN VAR — ölçülmüş bir borç (2026-09-13):
// Bekçilerin çoğu fikstürünü kurarken kalite satırını FABRİKANIN KODUYLA
// arıyordu:
//     need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" } }))
// Bu, bu fabrikanın kataloğunu bekçiye çakılı hâle getirir. Kataloğu
// `1K / 2K / HURDA` olan bir kurulumda satır bulunamaz ve bekçi ÇÖKER —
// ölçtüğü kuralla hiç ilgisi olmayan bir sebeple.
//
// ÖLÇÜM: `tekserp_ea_test` kataloğu `1K/2K/HURDA` yapıldı (top snapshot'ları da
// birlikte çevrildi), tam paket koşuldu:
//     taban 6 kırmızı → 65 kırmızı ⇒ KATALOG KAYNAKLI 61 bekçi, 53'ü ÇÖKME.
// Panzehir: ön koşulu ROLDEN çöz. Rol, kurulumdan bağımsızdır (`FIRST` her
// fabrikada "1. kalite"dir); kod fabrikaya aittir.
//
// ⚠️ NE ZAMAN KULLANILMAZ: bekçi KASITLI olarak "katalogda olmayan kod"
// davranışını ölçüyorsa (`'ZZZ-YOK'`, `' a1 '` gibi). Oradaki literal bir
// varsayım değil, ÖLÇÜMÜN KENDİSİDİR — dokunulmaz.
// =============================================================================
import type { QualityGradeRole } from "@prisma/client";
import prisma from "../src/lib/prisma";

export interface FixtureGrade {
  id: string;
  code: string;
}

/**
 * Rolün AKTİF katalog satırı. Yoksa Türkçe, ne yapılacağını söyleyen hata —
 * sessiz `null` değil: fikstürü kurulamayan bir bekçinin yeşil kalması,
 * kırmızı kalmasından kötüdür.
 *
 * `isActive` ŞARTI bilinçli: pasifleştirilmiş bir kaliteyle yeni top yazılamaz
 * (`resolveQualityGradeIdStrict` ile aynı kural), yani fikstür de yazamamalı.
 */
export async function roleGrade(role: QualityGradeRole): Promise<FixtureGrade> {
  const row = await prisma.qualityGrade.findFirst({
    where: { role, isActive: true },
    select: { id: true, code: true },
  });
  if (!row) {
    throw new Error(
      `Fikstür kurulamadı: katalogda '${role}' rolünü taşıyan AKTİF kalite yok. ` +
        `Seed koştu mu? (prisma/seed.ts üç kaliteye FIRST/SECOND/SCRAP yazar.)`,
    );
  }
  return row;
}

/** Kısayol — bekçilerin büyük çoğunluğu 1. kaliteyle top üretir. */
export const firstGrade = (): Promise<FixtureGrade> => roleGrade("FIRST");
