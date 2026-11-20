-- Devere ek C1 — kusurlu levent reddi: yalnız enum değeri EKLEME (ayrı migration: ADD VALUE aynı tx'te kullanılamaz).
ALTER TYPE "WarpBeamStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "ReasonPresetKind" ADD VALUE IF NOT EXISTS 'WARP_BEAM_REJECT';
