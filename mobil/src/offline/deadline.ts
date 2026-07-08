// =============================================================================
// withDeadline — kullanıcı-görünür beklemelere tavan (bounded wait).
// =============================================================================
// Saha kuralı (SAHA-AG-DAYANIKLILIK.md §1): UI'ı bekleten HER ağ işleminin bir
// tavanı olmalı. Tavan dolduğunda beklemeyi bırakırız ama işi İPTAL ETMEYİZ —
// altta yatan promise arka planda tamamlanabilir (ör. flush kuyruğu göndermeye
// devam eder; kayıtlar kaybolmaz, sadece kullanıcı beklemez).
//
// ASLA reject etmez: hem timeout hem hata "bekleme bitti" olarak çözülür.
// (Çağıranlar best-effort akışlar — flush/closeSession kendi hatasını zaten
// yutar; buradan sızan bir rejection logout'u yarıda bırakırdı.)

export interface DeadlineResult<T> {
  /** true → tavan doldu, iş hâlâ arka planda sürüyor olabilir. */
  timedOut: boolean;
  /** İş tavandan önce başarıyla bittiyse değeri (hata/timeout'ta undefined). */
  value?: T;
}

export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
): Promise<DeadlineResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Hata da "bitti" sayılır (value'suz) — rejection burada tüketilir ki tavan
  // dolduktan sonra geç gelen hata unhandled-rejection üretmesin.
  const settled = promise.then(
    (value): DeadlineResult<T> => ({ timedOut: false, value }),
    (): DeadlineResult<T> => ({ timedOut: false }),
  );
  const timeout = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  try {
    return await Promise.race([settled, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
