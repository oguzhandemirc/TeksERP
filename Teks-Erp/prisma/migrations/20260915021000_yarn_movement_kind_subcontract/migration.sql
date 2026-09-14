-- =============================================================================
-- `YarnMovementKind` + SUBCONTRACT_OUT · _CANCEL · SUBCONTRACT_RETURN · _CANCEL (fason G1, 2/4)
-- =============================================================================
-- ⚠️ YALNIZ ADD VALUE (55P04); kolon/CHECK 20260915023000'de. İki KARŞI OLAY çifti
--   (defter-beyan `KARSI_OLAY`): çıkış ↔ çıkış iptali · dönüş ↔ dönüş iptali. İdempotent, GERİ ALINAMAZ.
ALTER TYPE "YarnMovementKind" ADD VALUE IF NOT EXISTS 'SUBCONTRACT_OUT';
ALTER TYPE "YarnMovementKind" ADD VALUE IF NOT EXISTS 'SUBCONTRACT_OUT_CANCEL';
ALTER TYPE "YarnMovementKind" ADD VALUE IF NOT EXISTS 'SUBCONTRACT_RETURN';
ALTER TYPE "YarnMovementKind" ADD VALUE IF NOT EXISTS 'SUBCONTRACT_RETURN_CANCEL';
