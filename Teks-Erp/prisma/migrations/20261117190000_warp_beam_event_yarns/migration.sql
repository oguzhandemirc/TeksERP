-- FASON DEVERE D2 (2026-11-17) — WOUND doğuş kırılımı (DEFTER, append-only). YALNIZ EKLEME: mevcut kolon ve
-- satırlara dokunulmaz. Her mevcut WOUND'a TEK kırılım satırı geri doldurulur (yeniden koşulabilir).

-- CreateTable
CREATE TABLE "warp_beam_event_yarns" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "yarnItemId" UUID NOT NULL,
    "endsCount" INTEGER NOT NULL,
    "denier" DECIMAL(10,4) NOT NULL,
    "theoreticalKg" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warp_beam_event_yarns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warp_beam_event_yarns_yarnItemId_idx" ON "warp_beam_event_yarns"("yarnItemId");

-- CreateIndex
CREATE UNIQUE INDEX "warp_beam_event_yarns_eventId_yarnItemId_key" ON "warp_beam_event_yarns"("eventId", "yarnItemId");

-- AddForeignKey
ALTER TABLE "warp_beam_event_yarns" ADD CONSTRAINT "warp_beam_event_yarns_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "warp_beam_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warp_beam_event_yarns" ADD CONSTRAINT "warp_beam_event_yarns_yarnItemId_fkey" FOREIGN KEY ("yarnItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Şema-dışı seddi (`test_db_invariants` envanteri): tel > 0, denye > 0, kg ≥ 0.
ALTER TABLE "warp_beam_event_yarns" ADD CONSTRAINT "warp_beam_event_yarns_facts_ck" CHECK ("endsCount" > 0 AND "denier" > 0 AND "theoreticalKg" >= 0);

-- Geri doldurma: her mevcut WOUND'a kendi doğuş gerçeklerinden TEK satır (iplik = leventin kartının ana ipliği; tel,
-- denye, kg olayın KOPYASI — kart bugün değişmiş olsa da olaydaki sayı esas). `WHERE NOT EXISTS` ile yeniden koşulabilir.
INSERT INTO "warp_beam_event_yarns" ("id", "eventId", "yarnItemId", "endsCount", "denier", "theoreticalKg", "createdAt")
SELECT gen_random_uuid(), e."id", ws."yarnItemId", e."endsCount", e."denier", e."theoreticalKg", e."createdAt"
FROM "warp_beam_events" e
JOIN "warp_beams" b ON b."id" = e."beamId"
JOIN "warp_specs" ws ON ws."id" = b."warpSpecId"
WHERE e."kind" = 'WOUND'
  AND e."endsCount" > 0 AND e."denier" > 0 AND e."theoreticalKg" >= 0
  AND NOT EXISTS (SELECT 1 FROM "warp_beam_event_yarns" y WHERE y."eventId" = e."id");
