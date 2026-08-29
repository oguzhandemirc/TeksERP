import { ReasonPresetKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { ReasonPresetService } from "../src/services/reason-preset.service";

async function main() {
  const label = "Ölçüm cihazı arızalıydı";
  const existing = await prisma.reasonPreset.findFirst({
    where: { kind: ReasonPresetKind.ROLL_RECORD_CORRECTION, label },
    select: { id: true, code: true, label: true },
  });
  if (existing) {
    console.log("ZATEN VAR:", existing);
    return;
  }
  const row = await ReasonPresetService.create({
    kind: ReasonPresetKind.ROLL_RECORD_CORRECTION,
    label,
  });
  console.log("EKLENDI:", { code: row.code, label: row.label, isSystem: row.isSystem });
}
main().finally(async () => { await prisma.$disconnect(); process.exit(0); });
