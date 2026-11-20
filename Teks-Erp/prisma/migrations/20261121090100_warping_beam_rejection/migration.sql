-- Devere ek C1 — kusurlu levent ret belgesi + yeniden sarım bağı. Yalnız EKLEME/gevşetme.

-- Sarım olay türü evreni genişler (`WARP_BEAM_EVENT_KINDS` ↔ CHECK iki yönlü).
ALTER TABLE "warp_beam_events" DROP CONSTRAINT IF EXISTS "warp_beam_events_kind_ck";
ALTER TABLE "warp_beam_events" ADD CONSTRAINT "warp_beam_events_kind_ck" CHECK ("kind" IN (
  'WOUND', 'WOUND_CANCEL', 'SHIP_OUT', 'SHIP_OUT_CANCEL', 'RETURNED_IN', 'RETURNED_IN_CANCEL',
  'MOUNTED', 'MOUNT_CANCEL', 'DISMOUNTED', 'DISMOUNT_CANCEL', 'CONSUMED', 'CONSUMED_CANCEL',
  'ADJUST_IN', 'ADJUST_OUT', 'EXHAUSTED', 'EXHAUST_CANCEL', 'SCRAPPED', 'SCRAP_CANCEL',
  'SHIP_TO_OWNER', 'SHIP_TO_OWNER_CANCEL',
  'REJECT_OUT', 'REJECT_OUT_CANCEL'
));

-- Yeniden sarım bağı (doğum niteliği).
ALTER TABLE "warp_beams" ADD COLUMN "reworkOfBeamId" UUID;
CREATE INDEX "warp_beams_reworkOfBeamId_idx" ON "warp_beams"("reworkOfBeamId");
ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_reworkOfBeamId_fkey" FOREIGN KEY ("reworkOfBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warp_beams" ADD CONSTRAINT "warp_beams_rework_ck" CHECK ("reworkOfBeamId" IS NULL OR ("warpingOrderId" IS NOT NULL AND "reworkOfBeamId" <> "id"));
-- Bir reddedilen sarımın en çok BİR canlı yeniden sarımı (iptal edilen sarım bağı serbest bırakır).
CREATE UNIQUE INDEX "warp_beams_rework_of_live_uq" ON "warp_beams"("reworkOfBeamId") WHERE "reworkOfBeamId" IS NOT NULL AND "status" <> 'CANCELLED';

-- Ret belgesi.
CREATE TABLE "warping_beam_rejections" (
    "id" UUID NOT NULL,
    "docNo" VARCHAR(64) NOT NULL,
    "clientToken" UUID,
    "warpingOrderId" UUID NOT NULL,
    "subcontractorId" UUID NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "reasonText" VARCHAR(300) NOT NULL,
    "notes" VARCHAR(500),
    "expectRework" BOOLEAN NOT NULL,
    "rejectedAt" TIMESTAMPTZ NOT NULL,
    "cancelledAt" TIMESTAMPTZ,
    "cancelledById" UUID,
    "cancelReason" VARCHAR(300),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_beam_rejections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warping_beam_rejections_docNo_key" ON "warping_beam_rejections"("docNo");
CREATE UNIQUE INDEX "warping_beam_rejections_clientToken_key" ON "warping_beam_rejections"("clientToken");
CREATE INDEX "warping_beam_rejections_warpingOrderId_createdAt_idx" ON "warping_beam_rejections"("warpingOrderId", "createdAt");
CREATE INDEX "warping_beam_rejections_subcontractorId_createdAt_idx" ON "warping_beam_rejections"("subcontractorId", "createdAt");
CREATE INDEX "warping_beam_rejections_createdAt_idx" ON "warping_beam_rejections"("createdAt");
ALTER TABLE "warping_beam_rejections" ADD CONSTRAINT "warping_beam_rejections_warpingOrderId_fkey" FOREIGN KEY ("warpingOrderId") REFERENCES "warping_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warping_beam_rejections" ADD CONSTRAINT "warping_beam_rejections_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- İptal üçlüsü birlikte dolar (emsal beam_body_returns_cancel_ck).
ALTER TABLE "warping_beam_rejections" ADD CONSTRAINT "warping_beam_rejections_cancel_ck"
  CHECK (("cancelledAt" IS NULL) = ("cancelReason" IS NULL) AND ("cancelledAt" IS NOT NULL OR "cancelledById" IS NULL));
ALTER TABLE "warping_beam_rejections" ADD CONSTRAINT "warping_beam_rejections_reason_ck" CHECK (length(btrim("reasonCode")) > 0 AND length(btrim("reasonText")) > 0);

-- Ret belgesi kalemi (append-only).
CREATE TABLE "warping_beam_rejection_items" (
    "id" UUID NOT NULL,
    "rejectionId" UUID NOT NULL,
    "warpBeamId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warping_beam_rejection_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warping_beam_rejection_items_eventId_key" ON "warping_beam_rejection_items"("eventId");
CREATE UNIQUE INDEX "warping_beam_rejection_items_rejectionId_warpBeamId_key" ON "warping_beam_rejection_items"("rejectionId", "warpBeamId");
CREATE INDEX "warping_beam_rejection_items_warpBeamId_idx" ON "warping_beam_rejection_items"("warpBeamId");
ALTER TABLE "warping_beam_rejection_items" ADD CONSTRAINT "warping_beam_rejection_items_rejectionId_fkey" FOREIGN KEY ("rejectionId") REFERENCES "warping_beam_rejections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warping_beam_rejection_items" ADD CONSTRAINT "warping_beam_rejection_items_warpBeamId_fkey" FOREIGN KEY ("warpBeamId") REFERENCES "warp_beams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warping_beam_rejection_items" ADD CONSTRAINT "warping_beam_rejection_items_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "warp_beam_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ret fotoğrafı (≤ 5 MB; emsal certificate_files).
CREATE TABLE "warping_beam_rejection_photos" (
    "id" UUID NOT NULL,
    "rejectionId" UUID NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "warping_beam_rejection_photos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "warping_beam_rejection_photos_rejectionId_sha256_key" ON "warping_beam_rejection_photos"("rejectionId", "sha256");
ALTER TABLE "warping_beam_rejection_photos" ADD CONSTRAINT "warping_beam_rejection_photos_rejectionId_fkey" FOREIGN KEY ("rejectionId") REFERENCES "warping_beam_rejections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warping_beam_rejection_photos" ADD CONSTRAINT "warping_beam_rejection_photos_size_ck" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880 AND octet_length("content") = "sizeBytes");
