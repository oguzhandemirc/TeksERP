// =============================================================================
// TeksERP — FASON DEVERE dönüş kabulü SATIR şeması (tek sipariş `/receive` + dönüş kabul belgesi, devere ek E1)
// =============================================================================
// İki uç aynı satır allowlist'ini kullanır: alan bir kez eklenir, iki gövde birlikte genişler.
// =============================================================================
import { z } from "zod";
import { BEAM_BODY_MAX_MACHINES } from "../services/beam-body/write";
import { BEAM_BODY_OWNER_KINDS, type BeamBodyOwnerKind } from "../constants/beam-body";

export const ReceiveId = z.uuid("Geçersiz kimlik");
const Kg = z.number({ message: "Tartı (kg) sayı olmalı" }).min(0, "Tartı negatif olamaz").max(100_000, "Tartı çok büyük");
const Cm = z.number({ message: "Ölçü sayı olmalı" }).positive("Ölçü sıfırdan büyük olmalı").max(10_000, "Ölçü çok büyük");
// B3: tanımsız gövde yerinde (sahip zorunlu); `devere.beamBodyMode=OFF`ta servis 403 verir.
const NewBody = z.strictObject({
  bodyNo: z.string().trim().max(32, "Gövde no en çok 32 karakter").nullable().optional(),
  owner: z.strictObject({
    kind: z.enum(BEAM_BODY_OWNER_KINDS as [BeamBodyOwnerKind, ...BeamBodyOwnerKind[]], { message: "Gövde sahibi geçersiz" }),
    customerId: ReceiveId.nullable().optional(),
    subcontractorId: ReceiveId.nullable().optional(),
  }),
  widthCm: Cm.nullable().optional(),
  flangeDiameterCm: Cm.nullable().optional(),
  tareKg: Kg.positive("Gövde darası sıfırdan büyük olmalı").nullable().optional(),
  machineIds: z.array(ReceiveId).max(BEAM_BODY_MAX_MACHINES, `En çok ${BEAM_BODY_MAX_MACHINES} tezgâh`).optional(),
});
export const ReceiveBeamLine = z.strictObject({
  lengthM: z.number({ message: "Levent metresi sayı olmalı" }).positive("Levent metresi sıfırdan büyük olmalı").max(1_000_000, "Levent metresi çok büyük"),
  physicalBeamNo: z.string().trim().max(32, "Gövde no en çok 32 karakter").nullable().optional(),
  grossKg: Kg.nullable().optional(),
  tareKg: Kg.nullable().optional(),
  beamBodyId: ReceiveId.nullable().optional(),
  newBody: NewBody.nullable().optional(),
  reworkOfBeamId: ReceiveId.nullable().optional(),
});
export const DeliveryNoteNo = z.string().trim().max(64, "İrsaliye no en çok 64 karakter").nullable().optional();
