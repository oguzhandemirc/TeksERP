-- Add CANCELLED status to RollStatus enum.
-- Used for operator cancellation (yanlış giriş) — distinct from SCRAP (gerçek fire).
ALTER TYPE "RollStatus" ADD VALUE 'CANCELLED';
