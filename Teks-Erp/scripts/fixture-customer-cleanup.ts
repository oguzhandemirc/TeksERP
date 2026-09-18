// =============================================================================
// FİXTURE — KART TEMİZLİĞİ (Z-A sonrası): kart hesabıyla doğar, teardown hesabı da siler ve HATAYI YUTMAZ
// =============================================================================
// `customerService.create` / `POST /api/customers` ile açılan kart, `finance.enabled` AÇIKKEN `CariAccount`la
// doğar (Restrict FK). `prisma.customer.delete(...).catch(() => {})` deseni bunu YUTUYORDU: bekçi yeşil bitiyor,
// kart + hesap DB'de kalıyor ve sonraki paketleri vergi-no seddi / bulanık ad grubuyla düşürüyordu (ölçüldü
// 2026-09-18: test_customer · customer_card_fields · data_integrity_gaps kalıntısı → duplicate_detection "4 kayıt",
// http_api 409). Kural: kalıntı bırakan teardown KIRMIZI verir — yeşil + kalıntı en kötü sonuçtur.
// Sıra FK'ya göre: hareket/bakiye → hesap (kartın ya da fason profilinin) → şube → kart. Yalnız `finally`den çağrılır.
// =============================================================================
import prisma from "../src/lib/prisma";

export async function cleanupTestCustomers(ids: ReadonlyArray<string | null | undefined>): Promise<void> {
  const kart = [...new Set(ids.filter((x): x is string => !!x))];
  if (kart.length === 0) return;
  const accs = await prisma.cariAccount.findMany({
    where: { OR: [{ customerId: { in: kart } }, { subcontractor: { customerId: { in: kart } } }] },
    select: { id: true },
  });
  const accIds = accs.map((a) => a.id);
  if (accIds.length > 0) {
    await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
    await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
    await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  }
  await prisma.customerBranch.deleteMany({ where: { customerId: { in: kart } } });
  await prisma.customer.deleteMany({ where: { id: { in: kart } } });
}
