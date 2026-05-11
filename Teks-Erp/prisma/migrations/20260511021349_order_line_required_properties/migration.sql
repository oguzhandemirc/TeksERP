-- =============================================================================
-- Add OrderLineRequiredProperty M:N
-- =============================================================================
-- Müşterinin sipariş satırı için istediği özellikler. WO açılırken planlamacıya
-- targetProperties önerisi olarak iletilir.
-- =============================================================================

CREATE TABLE "order_line_required_properties" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_line_required_properties_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_line_required_properties_propertyId_idx" ON "order_line_required_properties"("propertyId");
CREATE UNIQUE INDEX "order_line_required_properties_orderLineId_propertyId_key" ON "order_line_required_properties"("orderLineId", "propertyId");

ALTER TABLE "order_line_required_properties" ADD CONSTRAINT "order_line_required_properties_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_line_required_properties" ADD CONSTRAINT "order_line_required_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
