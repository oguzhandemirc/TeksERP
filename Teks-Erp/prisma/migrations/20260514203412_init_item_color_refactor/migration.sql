-- CreateEnum
CREATE TYPE "StationType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "StationKind" AS ENUM ('RAW_QC', 'PROCESS_QC', 'TAMBUR', 'SUBCONTRACTOR', 'PACKAGING', 'SHIPPING', 'OTHER');

-- CreateEnum
CREATE TYPE "RollOperationType" AS ENUM ('KURSUN_APPLIED', 'QC2_COMPLETED', 'TAMBUR_PROCESSED', 'PACKAGED', 'SUBCONTRACTOR_SENT', 'SUBCONTRACTOR_RETURNED');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('YARN', 'WARP', 'FABRIC', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "RollEntrySource" AS ENUM ('PRODUCTION', 'SUPPLIER_RECEIPT', 'CUSTOMER_SUPPLIED', 'TAMBUR_SPLIT');

-- CreateEnum
CREATE TYPE "RollStatus" AS ENUM ('STOCK', 'IN_PRODUCTION', 'PRODUCED', 'READY_FOR_SHIP', 'SHIPPED', 'SCRAP', 'CANCELLED', 'AT_SUBCONTRACTOR', 'A1_STOCK', 'RETURNED_FROM_SUBCONTRACTOR', 'WAREHOUSE', 'TAMBUR_CONSUMED');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('CUSTOMER', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'APPROVED', 'PARTIAL_SHIPPED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderType" AS ENUM ('ORDER_PRODUCTION', 'STOCK_PRODUCTION', 'SAMPLE_PRODUCTION', 'REPAIR_REWORK', 'SERVICE_PRODUCTION');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PREPARING', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TravelerCardStatus" AS ENUM ('ACTIVE', 'REPRINTED', 'VOIDED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('ARRIVAL', 'DEPARTURE', 'INFO');

-- CreateEnum
CREATE TYPE "PackagingQueueStatus" AS ENUM ('WAITING', 'TAKEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShippingQueueStatus" AS ENUM ('WAITING', 'TAKEN', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'web',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permission_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_template_items" (
    "templateId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_template_items_pkey" PRIMARY KEY ("templateId","permissionId")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "StationType" NOT NULL,
    "kind" "StationKind" NOT NULL DEFAULT 'OTHER',
    "department" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceIp" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "customerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_steps" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "defaultNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'MT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rolls" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "colorId" TEXT,
    "ownerCustomerId" TEXT,
    "customerDescription" TEXT,
    "initialQty" DOUBLE PRECISION NOT NULL,
    "currentQty" DOUBLE PRECISION NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "status" "RollStatus" NOT NULL DEFAULT 'STOCK',
    "qualityGrade" TEXT NOT NULL DEFAULT '1.KALITE',
    "width" DOUBLE PRECISION,
    "entrySource" "RollEntrySource" NOT NULL DEFAULT 'SUPPLIER_RECEIPT',
    "producedInStepId" TEXT,
    "currentStepId" TEXT,
    "parentRollId" TEXT,
    "createdById" TEXT,
    "packageId" TEXT,
    "grossWeightKg" DOUBLE PRECISION,
    "netWeightKg" DOUBLE PRECISION,
    "packagingDate" TIMESTAMP(3),
    "sackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxNumber" TEXT,
    "type" "CompanyType" NOT NULL DEFAULT 'CUSTOMER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_branches" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "district" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "totalAmount" DECIMAL(10,2),
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "manualClosedById" TEXT,
    "manualCloseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "colorId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DECIMAL(10,2),
    "width" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_required_properties" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_required_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reproduction_backlog" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "qtyDeficit" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,

    CONSTRAINT "reproduction_backlog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_queue" (
    "id" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "plannedOrderId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "PackagingQueueStatus" NOT NULL DEFAULT 'WAITING',
    "assignedOperatorId" TEXT,
    "addedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "urgentMarkedAt" TIMESTAMP(3),
    "takenAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packaging_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_queue" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "urgentMarkedAt" TIMESTAMP(3),
    "status" "ShippingQueueStatus" NOT NULL DEFAULT 'WAITING',
    "assignedOperatorId" TEXT,
    "addedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "takenAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "type" "WorkOrderType" NOT NULL DEFAULT 'ORDER_PRODUCTION',
    "width" DOUBLE PRECISION,
    "targetQuantity" DOUBLE PRECISION,
    "parameters" JSONB,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedStartDate" TIMESTAMP(3),
    "plannedEndDate" TIMESTAMP(3),
    "routeTemplateId" TEXT,
    "servicePricePerMeter" DECIMAL(10,2),
    "targetItemId" TEXT,
    "targetColorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_steps" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "stepSequence" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "stepData" JSONB,
    "notes" TEXT,
    "skipReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "requiredCategoryId" TEXT,
    "plannedSubcontractorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_to_order_lines" (
    "workOrderId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "allocatedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_to_order_lines_pkey" PRIMARY KEY ("workOrderId","orderLineId")
);

-- CreateTable
CREATE TABLE "quality_grades" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "targetStatus" "RollStatus" NOT NULL DEFAULT 'SCRAP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "defect_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roll_errors" (
    "id" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "startMeter" DOUBLE PRECISION NOT NULL,
    "endMeter" DOUBLE PRECISION NOT NULL,
    "defectTypeId" TEXT,
    "errorType" TEXT,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "actionTaken" TEXT,
    "detectedAtStepId" TEXT,
    "detectedByUserId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAtStepId" TEXT,
    "processedByUserId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roll_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roll_operations" (
    "id" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "workOrderStepId" TEXT NOT NULL,
    "operationType" "RollOperationType" NOT NULL,
    "operatorId" TEXT,
    "metadata" JSONB,
    "inheritedFromParentRollId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_allocations" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "allocatedQty" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "shipmentNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT,
    "driverName" TEXT,
    "plateNumber" TEXT,
    "carrier" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PREPARING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "plannedDate" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "shippedById" TEXT,
    "customerCodeSnapshot" TEXT,
    "customerNameSnapshot" TEXT,
    "branchNameSnapshot" TEXT,
    "printSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_planned_orders" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_planned_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "shippedQty" DOUBLE PRECISION NOT NULL,
    "shippedWeight" DOUBLE PRECISION,
    "rollBarcodeSnapshot" TEXT,
    "itemCodeSnapshot" TEXT,
    "itemNameSnapshot" TEXT,
    "orderNumberSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "current_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "current_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_logs" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "logType" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machine_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traveler_cards" (
    "id" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "TravelerCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "traveler_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traveler_card_scans" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "workOrderStepId" TEXT,
    "scanType" "ScanType" NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedById" TEXT,
    "deviceId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traveler_card_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roll_movements" (
    "id" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "workOrderStepId" TEXT NOT NULL,
    "qtyIn" DOUBLE PRECISION NOT NULL,
    "qtyOut" DOUBLE PRECISION,
    "weightIn" DOUBLE PRECISION,
    "weightOut" DOUBLE PRECISION,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "operatorId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_dispatches" (
    "id" TEXT NOT NULL,
    "dispatchNo" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "plannedSubcontractorId" TEXT,
    "plateNumber" TEXT,
    "driverName" TEXT,
    "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedById" TEXT,
    "notes" TEXT,
    "totalQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "printSnapshot" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontractor_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_dispatch_items" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "dispatchedQty" DOUBLE PRECISION NOT NULL,
    "dispatchedWeight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_receipts" (
    "id" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "manifestNo" TEXT,
    "workOrderId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "subcontractorId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontractor_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_receipt_items" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "newRollId" TEXT NOT NULL,
    "sourceDispatchItemId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesColor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontractor_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxNumber" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_category_links" (
    "subcontractorId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subcontractor_category_links_pkey" PRIMARY KEY ("subcontractorId","categoryId")
);

-- CreateTable
CREATE TABLE "swatches" (
    "id" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "colorId" TEXT,
    "width" DOUBLE PRECISION,
    "length" DOUBLE PRECISION NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "workOrderId" TEXT,
    "parentRollId" TEXT,
    "purpose" TEXT,
    "createdById" TEXT,
    "sackId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sacks" (
    "id" TEXT NOT NULL,
    "sackNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "notes" TEXT,
    "shipmentId" TEXT,
    "shippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifests" (
    "id" TEXT NOT NULL,
    "manifestNo" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedById" TEXT,
    "snapshot" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "colors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_properties" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fabric_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_allowed_properties" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_allowed_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_allowed_colors" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_allowed_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_target_properties" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_target_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roll_properties" (
    "id" TEXT NOT NULL,
    "rollId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roll_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_colors" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "colorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_colors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "station_properties" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "station_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_log_archives" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_log_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "permissions_category_idx" ON "permissions"("category");

-- CreateIndex
CREATE INDEX "user_permissions_userId_idx" ON "user_permissions"("userId");

-- CreateIndex
CREATE INDEX "user_permissions_permissionId_idx" ON "user_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_userId_permissionId_key" ON "user_permissions"("userId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "permission_templates_name_key" ON "permission_templates"("name");

-- CreateIndex
CREATE INDEX "permission_template_items_permissionId_idx" ON "permission_template_items"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "stations_code_key" ON "stations"("code");

-- CreateIndex
CREATE INDEX "stations_type_idx" ON "stations"("type");

-- CreateIndex
CREATE INDEX "stations_kind_idx" ON "stations"("kind");

-- CreateIndex
CREATE INDEX "stations_defaultCategoryId_idx" ON "stations"("defaultCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "machines_code_key" ON "machines"("code");

-- CreateIndex
CREATE INDEX "machines_stationId_idx" ON "machines"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "routes_code_key" ON "routes"("code");

-- CreateIndex
CREATE INDEX "routes_customerId_idx" ON "routes"("customerId");

-- CreateIndex
CREATE INDEX "routes_isFavorite_idx" ON "routes"("isFavorite");

-- CreateIndex
CREATE INDEX "route_steps_routeId_sequence_idx" ON "route_steps"("routeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "items_code_key" ON "items"("code");

-- CreateIndex
CREATE INDEX "items_itemType_idx" ON "items"("itemType");

-- CreateIndex
CREATE UNIQUE INDEX "rolls_barcode_key" ON "rolls"("barcode");

-- CreateIndex
CREATE INDEX "rolls_itemId_idx" ON "rolls"("itemId");

-- CreateIndex
CREATE INDEX "rolls_colorId_idx" ON "rolls"("colorId");

-- CreateIndex
CREATE INDEX "rolls_status_idx" ON "rolls"("status");

-- CreateIndex
CREATE INDEX "rolls_parentRollId_idx" ON "rolls"("parentRollId");

-- CreateIndex
CREATE INDEX "rolls_currentStepId_idx" ON "rolls"("currentStepId");

-- CreateIndex
CREATE INDEX "rolls_producedInStepId_idx" ON "rolls"("producedInStepId");

-- CreateIndex
CREATE INDEX "rolls_ownerCustomerId_idx" ON "rolls"("ownerCustomerId");

-- CreateIndex
CREATE INDEX "rolls_createdById_idx" ON "rolls"("createdById");

-- CreateIndex
CREATE INDEX "rolls_sackId_idx" ON "rolls"("sackId");

-- CreateIndex
CREATE INDEX "rolls_status_createdAt_idx" ON "rolls"("status", "createdAt");

-- CreateIndex
CREATE INDEX "rolls_colorId_status_idx" ON "rolls"("colorId", "status");

-- CreateIndex
CREATE INDEX "rolls_entrySource_createdAt_idx" ON "rolls"("entrySource", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_type_idx" ON "customers"("type");

-- CreateIndex
CREATE INDEX "customer_branches_customerId_idx" ON "customer_branches"("customerId");

-- CreateIndex
CREATE INDEX "customer_branches_customerId_isActive_idx" ON "customer_branches"("customerId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_branchId_idx" ON "orders"("branchId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_manualClosedById_idx" ON "orders"("manualClosedById");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "orders_deadline_idx" ON "orders"("deadline");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "order_lines_itemId_idx" ON "order_lines"("itemId");

-- CreateIndex
CREATE INDEX "order_lines_colorId_idx" ON "order_lines"("colorId");

-- CreateIndex
CREATE INDEX "order_line_required_properties_propertyId_idx" ON "order_line_required_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_required_properties_orderLineId_propertyId_key" ON "order_line_required_properties"("orderLineId", "propertyId");

-- CreateIndex
CREATE INDEX "reproduction_backlog_orderLineId_resolvedAt_idx" ON "reproduction_backlog"("orderLineId", "resolvedAt");

-- CreateIndex
CREATE INDEX "reproduction_backlog_resolvedAt_idx" ON "reproduction_backlog"("resolvedAt");

-- CreateIndex
CREATE INDEX "packaging_queue_status_priority_createdAt_idx" ON "packaging_queue"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "packaging_queue_status_isUrgent_urgentMarkedAt_priority_cre_idx" ON "packaging_queue"("status", "isUrgent", "urgentMarkedAt", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "packaging_queue_rollId_idx" ON "packaging_queue"("rollId");

-- CreateIndex
CREATE INDEX "packaging_queue_plannedOrderId_idx" ON "packaging_queue"("plannedOrderId");

-- CreateIndex
CREATE INDEX "packaging_queue_assignedOperatorId_idx" ON "packaging_queue"("assignedOperatorId");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_queue_orderId_key" ON "shipping_queue"("orderId");

-- CreateIndex
CREATE INDEX "shipping_queue_status_priority_createdAt_idx" ON "shipping_queue"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "shipping_queue_status_isUrgent_urgentMarkedAt_priority_crea_idx" ON "shipping_queue"("status", "isUrgent", "urgentMarkedAt", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "shipping_queue_assignedOperatorId_idx" ON "shipping_queue"("assignedOperatorId");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_batchNumber_key" ON "work_orders"("batchNumber");

-- CreateIndex
CREATE INDEX "work_orders_status_idx" ON "work_orders"("status");

-- CreateIndex
CREATE INDEX "work_orders_routeTemplateId_idx" ON "work_orders"("routeTemplateId");

-- CreateIndex
CREATE INDEX "work_orders_targetItemId_idx" ON "work_orders"("targetItemId");

-- CreateIndex
CREATE INDEX "work_orders_targetColorId_idx" ON "work_orders"("targetColorId");

-- CreateIndex
CREATE INDEX "work_orders_status_createdAt_idx" ON "work_orders"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "work_orders_status_plannedEndDate_idx" ON "work_orders"("status", "plannedEndDate");

-- CreateIndex
CREATE INDEX "work_order_steps_workOrderId_stepSequence_idx" ON "work_order_steps"("workOrderId", "stepSequence");

-- CreateIndex
CREATE INDEX "work_order_steps_stationId_idx" ON "work_order_steps"("stationId");

-- CreateIndex
CREATE INDEX "work_order_steps_workOrderId_status_idx" ON "work_order_steps"("workOrderId", "status");

-- CreateIndex
CREATE INDEX "work_order_steps_requiredCategoryId_idx" ON "work_order_steps"("requiredCategoryId");

-- CreateIndex
CREATE INDEX "work_order_steps_plannedSubcontractorId_idx" ON "work_order_steps"("plannedSubcontractorId");

-- CreateIndex
CREATE INDEX "work_order_to_order_lines_orderLineId_idx" ON "work_order_to_order_lines"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "quality_grades_code_key" ON "quality_grades"("code");

-- CreateIndex
CREATE INDEX "quality_grades_isActive_sortOrder_idx" ON "quality_grades"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "defect_types_code_key" ON "defect_types"("code");

-- CreateIndex
CREATE INDEX "defect_types_isActive_idx" ON "defect_types"("isActive");

-- CreateIndex
CREATE INDEX "roll_errors_rollId_idx" ON "roll_errors"("rollId");

-- CreateIndex
CREATE INDEX "roll_errors_detectedAtStepId_idx" ON "roll_errors"("detectedAtStepId");

-- CreateIndex
CREATE INDEX "roll_errors_processedAtStepId_idx" ON "roll_errors"("processedAtStepId");

-- CreateIndex
CREATE INDEX "roll_errors_isProcessed_idx" ON "roll_errors"("isProcessed");

-- CreateIndex
CREATE INDEX "roll_errors_defectTypeId_idx" ON "roll_errors"("defectTypeId");

-- CreateIndex
CREATE INDEX "roll_errors_rollId_isProcessed_idx" ON "roll_errors"("rollId", "isProcessed");

-- CreateIndex
CREATE INDEX "roll_operations_rollId_idx" ON "roll_operations"("rollId");

-- CreateIndex
CREATE INDEX "roll_operations_workOrderStepId_idx" ON "roll_operations"("workOrderStepId");

-- CreateIndex
CREATE INDEX "roll_operations_operationType_idx" ON "roll_operations"("operationType");

-- CreateIndex
CREATE INDEX "roll_operations_operatorId_idx" ON "roll_operations"("operatorId");

-- CreateIndex
CREATE INDEX "roll_operations_inheritedFromParentRollId_idx" ON "roll_operations"("inheritedFromParentRollId");

-- CreateIndex
CREATE UNIQUE INDEX "roll_operations_rollId_workOrderStepId_operationType_key" ON "roll_operations"("rollId", "workOrderStepId", "operationType");

-- CreateIndex
CREATE INDEX "order_allocations_orderLineId_idx" ON "order_allocations"("orderLineId");

-- CreateIndex
CREATE INDEX "order_allocations_rollId_idx" ON "order_allocations"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_shipmentNumber_key" ON "shipments"("shipmentNumber");

-- CreateIndex
CREATE INDEX "shipments_customerId_idx" ON "shipments"("customerId");

-- CreateIndex
CREATE INDEX "shipments_branchId_idx" ON "shipments"("branchId");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "shipments_status_priority_plannedDate_idx" ON "shipments"("status", "priority", "plannedDate");

-- CreateIndex
CREATE INDEX "shipments_status_createdAt_idx" ON "shipments"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "shipments_shippedAt_idx" ON "shipments"("shippedAt");

-- CreateIndex
CREATE INDEX "shipments_shippedById_idx" ON "shipments"("shippedById");

-- CreateIndex
CREATE INDEX "shipment_planned_orders_shipmentId_idx" ON "shipment_planned_orders"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_planned_orders_orderId_idx" ON "shipment_planned_orders"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_planned_orders_shipmentId_orderId_key" ON "shipment_planned_orders"("shipmentId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_rollId_key" ON "shipment_items"("rollId");

-- CreateIndex
CREATE INDEX "shipment_items_shipmentId_idx" ON "shipment_items"("shipmentId");

-- CreateIndex
CREATE INDEX "current_accounts_customerId_idx" ON "current_accounts"("customerId");

-- CreateIndex
CREATE INDEX "machine_logs_machineId_idx" ON "machine_logs"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "traveler_cards_cardNumber_key" ON "traveler_cards"("cardNumber");

-- CreateIndex
CREATE UNIQUE INDEX "traveler_cards_barcode_key" ON "traveler_cards"("barcode");

-- CreateIndex
CREATE INDEX "traveler_cards_workOrderId_idx" ON "traveler_cards"("workOrderId");

-- CreateIndex
CREATE INDEX "traveler_cards_barcode_idx" ON "traveler_cards"("barcode");

-- CreateIndex
CREATE INDEX "traveler_cards_status_idx" ON "traveler_cards"("status");

-- CreateIndex
CREATE INDEX "traveler_card_scans_cardId_idx" ON "traveler_card_scans"("cardId");

-- CreateIndex
CREATE INDEX "traveler_card_scans_stationId_scannedAt_idx" ON "traveler_card_scans"("stationId", "scannedAt");

-- CreateIndex
CREATE INDEX "traveler_card_scans_workOrderStepId_idx" ON "traveler_card_scans"("workOrderStepId");

-- CreateIndex
CREATE INDEX "traveler_card_scans_scannedById_idx" ON "traveler_card_scans"("scannedById");

-- CreateIndex
CREATE INDEX "roll_movements_rollId_idx" ON "roll_movements"("rollId");

-- CreateIndex
CREATE INDEX "roll_movements_workOrderStepId_idx" ON "roll_movements"("workOrderStepId");

-- CreateIndex
CREATE INDEX "roll_movements_enteredAt_idx" ON "roll_movements"("enteredAt");

-- CreateIndex
CREATE INDEX "roll_movements_operatorId_idx" ON "roll_movements"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_dispatches_dispatchNo_key" ON "subcontractor_dispatches"("dispatchNo");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_workOrderId_idx" ON "subcontractor_dispatches"("workOrderId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_stepId_idx" ON "subcontractor_dispatches"("stepId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_subcontractorId_idx" ON "subcontractor_dispatches"("subcontractorId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_plannedSubcontractorId_idx" ON "subcontractor_dispatches"("plannedSubcontractorId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_cancelledById_idx" ON "subcontractor_dispatches"("cancelledById");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_dispatchedAt_idx" ON "subcontractor_dispatches"("dispatchedAt");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_workOrderId_dispatchedAt_idx" ON "subcontractor_dispatches"("workOrderId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_subcontractorId_dispatchedAt_idx" ON "subcontractor_dispatches"("subcontractorId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_dispatchedById_idx" ON "subcontractor_dispatches"("dispatchedById");

-- CreateIndex
CREATE INDEX "subcontractor_dispatch_items_dispatchId_idx" ON "subcontractor_dispatch_items"("dispatchId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatch_items_rollId_idx" ON "subcontractor_dispatch_items"("rollId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_receipts_receiptNo_key" ON "subcontractor_receipts"("receiptNo");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_workOrderId_idx" ON "subcontractor_receipts"("workOrderId");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_stepId_idx" ON "subcontractor_receipts"("stepId");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_subcontractorId_idx" ON "subcontractor_receipts"("subcontractorId");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_manifestNo_idx" ON "subcontractor_receipts"("manifestNo");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_receivedAt_idx" ON "subcontractor_receipts"("receivedAt");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_workOrderId_receivedAt_idx" ON "subcontractor_receipts"("workOrderId", "receivedAt");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_subcontractorId_receivedAt_idx" ON "subcontractor_receipts"("subcontractorId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_receipt_items_newRollId_key" ON "subcontractor_receipt_items"("newRollId");

-- CreateIndex
CREATE INDEX "subcontractor_receipt_items_receiptId_idx" ON "subcontractor_receipt_items"("receiptId");

-- CreateIndex
CREATE INDEX "subcontractor_receipt_items_newRollId_idx" ON "subcontractor_receipt_items"("newRollId");

-- CreateIndex
CREATE INDEX "subcontractor_receipt_items_sourceDispatchItemId_idx" ON "subcontractor_receipt_items"("sourceDispatchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_categories_code_key" ON "subcontractor_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractors_code_key" ON "subcontractors"("code");

-- CreateIndex
CREATE INDEX "subcontractor_category_links_categoryId_idx" ON "subcontractor_category_links"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "swatches_cardNumber_key" ON "swatches"("cardNumber");

-- CreateIndex
CREATE UNIQUE INDEX "swatches_barcode_key" ON "swatches"("barcode");

-- CreateIndex
CREATE INDEX "swatches_itemId_idx" ON "swatches"("itemId");

-- CreateIndex
CREATE INDEX "swatches_colorId_idx" ON "swatches"("colorId");

-- CreateIndex
CREATE INDEX "swatches_workOrderId_idx" ON "swatches"("workOrderId");

-- CreateIndex
CREATE INDEX "swatches_parentRollId_idx" ON "swatches"("parentRollId");

-- CreateIndex
CREATE INDEX "swatches_barcode_idx" ON "swatches"("barcode");

-- CreateIndex
CREATE INDEX "swatches_sackId_idx" ON "swatches"("sackId");

-- CreateIndex
CREATE UNIQUE INDEX "sacks_sackNumber_key" ON "sacks"("sackNumber");

-- CreateIndex
CREATE INDEX "sacks_customerId_idx" ON "sacks"("customerId");

-- CreateIndex
CREATE INDEX "sacks_shipmentId_idx" ON "sacks"("shipmentId");

-- CreateIndex
CREATE INDEX "sacks_customerId_shipmentId_idx" ON "sacks"("customerId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "manifests_manifestNo_key" ON "manifests"("manifestNo");

-- CreateIndex
CREATE INDEX "manifests_workOrderId_idx" ON "manifests"("workOrderId");

-- CreateIndex
CREATE INDEX "manifests_manifestNo_idx" ON "manifests"("manifestNo");

-- CreateIndex
CREATE UNIQUE INDEX "colors_code_key" ON "colors"("code");

-- CreateIndex
CREATE INDEX "colors_isActive_sortOrder_idx" ON "colors"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_properties_code_key" ON "fabric_properties"("code");

-- CreateIndex
CREATE INDEX "fabric_properties_isActive_sortOrder_idx" ON "fabric_properties"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "fabric_properties_category_idx" ON "fabric_properties"("category");

-- CreateIndex
CREATE INDEX "item_allowed_properties_propertyId_idx" ON "item_allowed_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "item_allowed_properties_itemId_propertyId_key" ON "item_allowed_properties"("itemId", "propertyId");

-- CreateIndex
CREATE INDEX "item_allowed_colors_colorId_idx" ON "item_allowed_colors"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "item_allowed_colors_itemId_colorId_key" ON "item_allowed_colors"("itemId", "colorId");

-- CreateIndex
CREATE INDEX "work_order_target_properties_propertyId_idx" ON "work_order_target_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_target_properties_workOrderId_propertyId_key" ON "work_order_target_properties"("workOrderId", "propertyId");

-- CreateIndex
CREATE INDEX "roll_properties_propertyId_idx" ON "roll_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "roll_properties_rollId_propertyId_key" ON "roll_properties"("rollId", "propertyId");

-- CreateIndex
CREATE INDEX "station_colors_colorId_idx" ON "station_colors"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "station_colors_stationId_colorId_key" ON "station_colors"("stationId", "colorId");

-- CreateIndex
CREATE INDEX "station_properties_propertyId_idx" ON "station_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "station_properties_stationId_propertyId_key" ON "station_properties"("stationId", "propertyId");

-- CreateIndex
CREATE INDEX "system_logs_userId_idx" ON "system_logs"("userId");

-- CreateIndex
CREATE INDEX "system_logs_tableName_recordId_idx" ON "system_logs"("tableName", "recordId");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_log_archives_tableName_recordId_idx" ON "system_log_archives"("tableName", "recordId");

-- CreateIndex
CREATE INDEX "system_log_archives_createdAt_idx" ON "system_log_archives"("createdAt");

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_template_items" ADD CONSTRAINT "permission_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "permission_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_template_items" ADD CONSTRAINT "permission_template_items_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stations" ADD CONSTRAINT "stations_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "subcontractor_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_ownerCustomerId_fkey" FOREIGN KEY ("ownerCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_parentRollId_fkey" FOREIGN KEY ("parentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_producedInStepId_fkey" FOREIGN KEY ("producedInStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_branches" ADD CONSTRAINT "customer_branches_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_manualClosedById_fkey" FOREIGN KEY ("manualClosedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_required_properties" ADD CONSTRAINT "order_line_required_properties_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_required_properties" ADD CONSTRAINT "order_line_required_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reproduction_backlog" ADD CONSTRAINT "reproduction_backlog_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_queue" ADD CONSTRAINT "packaging_queue_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_queue" ADD CONSTRAINT "packaging_queue_plannedOrderId_fkey" FOREIGN KEY ("plannedOrderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_queue" ADD CONSTRAINT "packaging_queue_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_queue" ADD CONSTRAINT "packaging_queue_assignedOperatorId_fkey" FOREIGN KEY ("assignedOperatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_queue" ADD CONSTRAINT "shipping_queue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_queue" ADD CONSTRAINT "shipping_queue_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_queue" ADD CONSTRAINT "shipping_queue_assignedOperatorId_fkey" FOREIGN KEY ("assignedOperatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routeTemplateId_fkey" FOREIGN KEY ("routeTemplateId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetItemId_fkey" FOREIGN KEY ("targetItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetColorId_fkey" FOREIGN KEY ("targetColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_requiredCategoryId_fkey" FOREIGN KEY ("requiredCategoryId") REFERENCES "subcontractor_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_steps" ADD CONSTRAINT "work_order_steps_plannedSubcontractorId_fkey" FOREIGN KEY ("plannedSubcontractorId") REFERENCES "subcontractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_to_order_lines" ADD CONSTRAINT "work_order_to_order_lines_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_to_order_lines" ADD CONSTRAINT "work_order_to_order_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_defectTypeId_fkey" FOREIGN KEY ("defectTypeId") REFERENCES "defect_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_detectedAtStepId_fkey" FOREIGN KEY ("detectedAtStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_processedAtStepId_fkey" FOREIGN KEY ("processedAtStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_detectedByUserId_fkey" FOREIGN KEY ("detectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_errors" ADD CONSTRAINT "roll_errors_processedByUserId_fkey" FOREIGN KEY ("processedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_inheritedFromParentRollId_fkey" FOREIGN KEY ("inheritedFromParentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_shippedById_fkey" FOREIGN KEY ("shippedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_planned_orders" ADD CONSTRAINT "shipment_planned_orders_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_planned_orders" ADD CONSTRAINT "shipment_planned_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_planned_orders" ADD CONSTRAINT "shipment_planned_orders_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "current_accounts" ADD CONSTRAINT "current_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_logs" ADD CONSTRAINT "machine_logs_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_cards" ADD CONSTRAINT "traveler_cards_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_cards" ADD CONSTRAINT "traveler_cards_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_card_scans" ADD CONSTRAINT "traveler_card_scans_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "traveler_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_card_scans" ADD CONSTRAINT "traveler_card_scans_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_card_scans" ADD CONSTRAINT "traveler_card_scans_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "traveler_card_scans" ADD CONSTRAINT "traveler_card_scans_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_workOrderStepId_fkey" FOREIGN KEY ("workOrderStepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_plannedSubcontractorId_fkey" FOREIGN KEY ("plannedSubcontractorId") REFERENCES "subcontractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatches" ADD CONSTRAINT "subcontractor_dispatches_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "subcontractor_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_dispatch_items" ADD CONSTRAINT "subcontractor_dispatch_items_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "work_order_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipt_items" ADD CONSTRAINT "subcontractor_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "subcontractor_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipt_items" ADD CONSTRAINT "subcontractor_receipt_items_newRollId_fkey" FOREIGN KEY ("newRollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipt_items" ADD CONSTRAINT "subcontractor_receipt_items_sourceDispatchItemId_fkey" FOREIGN KEY ("sourceDispatchItemId") REFERENCES "subcontractor_dispatch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_category_links" ADD CONSTRAINT "subcontractor_category_links_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_category_links" ADD CONSTRAINT "subcontractor_category_links_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "subcontractor_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_parentRollId_fkey" FOREIGN KEY ("parentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_properties" ADD CONSTRAINT "item_allowed_properties_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_properties" ADD CONSTRAINT "item_allowed_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_colors" ADD CONSTRAINT "item_allowed_colors_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_colors" ADD CONSTRAINT "item_allowed_colors_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_target_properties" ADD CONSTRAINT "work_order_target_properties_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_target_properties" ADD CONSTRAINT "work_order_target_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_properties" ADD CONSTRAINT "roll_properties_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_properties" ADD CONSTRAINT "roll_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_colors" ADD CONSTRAINT "station_colors_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_colors" ADD CONSTRAINT "station_colors_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_properties" ADD CONSTRAINT "station_properties_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "station_properties" ADD CONSTRAINT "station_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
