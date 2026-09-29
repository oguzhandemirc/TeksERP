// =============================================================================
// İŞ EMRİNİN ŞU ANKİ ADIMI — TEK KAYNAK
// =============================================================================
// Tanım: sıra numarasına göre ilk ACTIVE adım; yoksa ilk PENDING (sıradaki iş);
// hepsi bittiyse (COMPLETED/SKIPPED) son adım. Üretim zinciri raporu ile patron bulutu
// projeksiyonunun (`cloud-sync` · `aktifIstasyonId`) "iş emri şu an nerede" cevabı
// aynı olmak zorunda — ikinci bir tanım "ayrışan yüzey" sınıfıdır.
// =============================================================================
import { StepStatus } from "@prisma/client";

export function currentWorkOrderStep<T extends { readonly stepSequence: number; readonly status: StepStatus }>(
  steps: readonly T[],
): T | null {
  const sorted = [...steps].sort((a, b) => a.stepSequence - b.stepSequence);
  return (
    sorted.find((s) => s.status === StepStatus.ACTIVE) ??
    sorted.find((s) => s.status === StepStatus.PENDING) ??
    sorted[sorted.length - 1] ??
    null
  );
}
