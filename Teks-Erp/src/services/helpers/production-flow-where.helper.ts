// =============================================================================
// Üretim akışı Kurşun/Tambur kuyruklarının ADIM yüklemi — TEK KAYNAK
// =============================================================================
// Akış panosu (`inventory/production-flow` kolonları) ile patron iş emri aşama kırılımı
// (`cloud-sync/work-order-facts`) aynı kümeyi saymak zorunda; ikinci tanım "ayrışan yüzey"dir.
// =============================================================================
import { StationKind, StepStatus, type Prisma } from "@prisma/client";
import { STEP_FLOW_WHERE } from "./quality-station.helper";

/** Kurşun kolonu: kart akışı (Kurşun + KK2) yürüten istasyonun bitmemiş adımı. */
export const KURSUN_FLOW_STEP_WHERE = {
  station: { ...STEP_FLOW_WHERE },
  status: { not: StepStatus.COMPLETED },
} satisfies Prisma.WorkOrderStepWhereInput;

/** Tambur kolonu: Tambur istasyonunun bitmemiş adımı. */
export const TAMBUR_FLOW_STEP_WHERE = {
  station: { kind: StationKind.TAMBUR },
  status: { not: StepStatus.COMPLETED },
} satisfies Prisma.WorkOrderStepWhereInput;
