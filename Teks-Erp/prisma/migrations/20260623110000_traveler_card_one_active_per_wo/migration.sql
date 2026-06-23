-- TravelerCard: WO başına EN FAZLA 1 ACTIVE refakat kartı invariant'ı.
-- print() check-then-act (wo.travelerCards.length>0 tx-dışı oku → create) eşzamanlı
-- çift-tık/replay'de iki ACTIVE kart üretebiliyordu (malla iki barkod dolaşır).
-- PARTIAL UNIQUE (WHERE status='ACTIVE') ikinci create'i P2002 ile reddeder;
-- print/reprint bunu pre-check ile tutarlı 409'a çevirir (REPRINTED/VOIDED kartlar
-- kapsam dışı → yeniden-basım serbest).
-- Drift-free: schema.prisma'da @@index([workOrderId], map:"traveler_cards_wo_active_uniq").
DROP INDEX IF EXISTS "traveler_cards_wo_active_uniq";
CREATE UNIQUE INDEX "traveler_cards_wo_active_uniq"
  ON "traveler_cards" ("workOrderId")
  WHERE "status" = 'ACTIVE';
