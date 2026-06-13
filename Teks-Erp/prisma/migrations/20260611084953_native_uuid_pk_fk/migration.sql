/*
  Warnings:

  - The primary key for the `colors` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `customer_branches` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `customer_color_aliases` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `customer_item_aliases` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `customers` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `defect_types` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `devices` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `machineId` column on the `devices` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `fabric_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `item_allowed_colors` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `item_allowed_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `kartela_dispatch_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `kartela_dispatches` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `dispatchedById` column on the `kartela_dispatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `cancelledById` column on the `kartela_dispatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `kartela_receipt_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `sourceDispatchItemId` column on the `kartela_receipt_items` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `kartela_receipts` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `dispatchId` column on the `kartela_receipts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `receivedById` column on the `kartela_receipts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `cancelledById` column on the `kartela_receipts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `label_templates` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `machines` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `manifests` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `printedById` column on the `manifests` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `order_line_required_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `order_lines` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `colorId` column on the `order_lines` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `orders` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `branchId` column on the `orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `manualClosedById` column on the `orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `createdById` column on the `pairing_codes` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `permission_template_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `permission_templates` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `permissions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `printed_documents` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `printedById` column on the `printed_documents` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `product_recipe_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `product_recipes` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `colorId` column on the `product_recipes` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `routeId` column on the `product_recipes` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `quality_grades` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `return_reasons` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `roll_errors` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `defectTypeId` column on the `roll_errors` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `detectedAtStepId` column on the `roll_errors` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `detectedByUserId` column on the `roll_errors` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `processedAtStepId` column on the `roll_errors` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `processedByUserId` column on the `roll_errors` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `roll_movements` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `operatorId` column on the `roll_movements` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `machineId` column on the `roll_movements` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `roll_operations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `operatorId` column on the `roll_operations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `machineId` column on the `roll_operations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `inheritedFromParentRollId` column on the `roll_operations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `roll_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `roll_returns` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `fromShipmentId` column on the `roll_returns` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `orderId` column on the `roll_returns` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `colorId` column on the `roll_returns` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `reasonId` column on the `roll_returns` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `qualityGradeId` column on the `roll_returns` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `cancelledById` column on the `roll_returns` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `rolls` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `colorId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `qualityGradeId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `producedInStepId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `currentStepId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `parentRollId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `parentReceiptId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `createdById` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `shipmentId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `sackId` column on the `rolls` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `route_steps` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `routes` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `customerId` column on the `routes` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `sacks` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `shipmentId` column on the `sacks` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `shipment_allocations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `shipment_orders` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `shipments` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `branchId` column on the `shipments` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `station_colors` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `station_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `stations` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `defaultCategoryId` column on the `stations` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `subcontractor_categories` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `subcontractor_category_links` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `subcontractor_dispatch_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `subcontractor_dispatches` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `plannedSubcontractorId` column on the `subcontractor_dispatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `dispatchedById` column on the `subcontractor_dispatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `cancelledById` column on the `subcontractor_dispatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `subcontractor_receipt_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `sourceDispatchItemId` column on the `subcontractor_receipt_items` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `subcontractor_receipt_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `subcontractor_receipts` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `receivedById` column on the `subcontractor_receipts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `appliedColorId` column on the `subcontractor_receipts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `cancelledById` column on the `subcontractor_receipts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `subcontractors` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `swatches` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `colorId` column on the `swatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `parentRollId` column on the `swatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `createdById` column on the `swatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `shipmentId` column on the `swatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `sackId` column on the `swatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `parentReceiptId` column on the `swatches` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `system_log_archives` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `userId` column on the `system_log_archives` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `system_logs` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `userId` column on the `system_logs` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `updatedById` column on the `system_settings` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `traveler_card_scans` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `workOrderStepId` column on the `traveler_card_scans` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `scannedById` column on the `traveler_card_scans` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `traveler_cards` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `printedById` column on the `traveler_cards` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `user_permissions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `grantedById` column on the `user_permissions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `user_preferences` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `work_order_steps` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `requiredCategoryId` column on the `work_order_steps` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `plannedSubcontractorId` column on the `work_order_steps` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `work_order_target_properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `work_order_to_order_lines` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `work_orders` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `routeTemplateId` column on the `work_orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `targetItemId` column on the `work_orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `targetColorId` column on the `work_orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `splitFromId` column on the `work_orders` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `id` on the `colors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `customer_branches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `customerId` on the `customer_branches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `customer_color_aliases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `customerId` on the `customer_color_aliases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `colorId` on the `customer_color_aliases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `customer_item_aliases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `customerId` on the `customer_item_aliases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `customer_item_aliases` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `customers` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `defect_types` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `devices` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `fabric_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `item_allowed_colors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `item_allowed_colors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `colorId` on the `item_allowed_colors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `item_allowed_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `item_allowed_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `propertyId` on the `item_allowed_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `kartela_dispatch_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `dispatchId` on the `kartela_dispatch_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `rollId` on the `kartela_dispatch_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `kartela_dispatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `subcontractorId` on the `kartela_dispatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `kartela_receipt_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `receiptId` on the `kartela_receipt_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `consumedRollId` on the `kartela_receipt_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `kartela_receipts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `subcontractorId` on the `kartela_receipts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `label_templates` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `machines` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stationId` on the `machines` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `manifests` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderId` on the `manifests` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `order_line_required_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `orderLineId` on the `order_line_required_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `propertyId` on the `order_line_required_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `order_lines` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `orderId` on the `order_lines` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `order_lines` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `orders` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `customerId` on the `orders` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `machineId` on the `pairing_codes` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `templateId` on the `permission_template_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `permissionId` on the `permission_template_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `permission_templates` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `permissions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `printed_documents` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `product_recipe_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `recipeId` on the `product_recipe_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `propertyId` on the `product_recipe_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `product_recipes` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `product_recipes` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `quality_grades` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `return_reasons` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `roll_errors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `rollId` on the `roll_errors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `roll_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `rollId` on the `roll_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderStepId` on the `roll_movements` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `roll_operations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `rollId` on the `roll_operations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderStepId` on the `roll_operations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `roll_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `rollId` on the `roll_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `propertyId` on the `roll_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `roll_returns` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `rollId` on the `roll_returns` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `customerId` on the `roll_returns` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `roll_returns` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `receivedById` on the `roll_returns` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `rolls` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `rolls` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `route_steps` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `routeId` on the `route_steps` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stationId` on the `route_steps` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `routes` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `sacks` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `shipment_allocations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `shipmentId` on the `shipment_allocations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `orderLineId` on the `shipment_allocations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `shipmentId` on the `shipment_orders` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `orderId` on the `shipment_orders` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `shipments` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `customerId` on the `shipments` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `station_colors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stationId` on the `station_colors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `colorId` on the `station_colors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `station_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stationId` on the `station_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `propertyId` on the `station_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `stations` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subcontractor_categories` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `subcontractorId` on the `subcontractor_category_links` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `categoryId` on the `subcontractor_category_links` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subcontractor_dispatch_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `dispatchId` on the `subcontractor_dispatch_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `rollId` on the `subcontractor_dispatch_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subcontractor_dispatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderId` on the `subcontractor_dispatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stepId` on the `subcontractor_dispatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `subcontractorId` on the `subcontractor_dispatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subcontractor_receipt_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `receiptId` on the `subcontractor_receipt_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `newRollId` on the `subcontractor_receipt_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subcontractor_receipt_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `receiptId` on the `subcontractor_receipt_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `propertyId` on the `subcontractor_receipt_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subcontractor_receipts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderId` on the `subcontractor_receipts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stepId` on the `subcontractor_receipts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `subcontractorId` on the `subcontractor_receipts` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `subcontractors` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `swatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `itemId` on the `swatches` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `system_log_archives` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `system_logs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `traveler_card_scans` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `cardId` on the `traveler_card_scans` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stationId` on the `traveler_card_scans` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `traveler_cards` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderId` on the `traveler_cards` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `user_permissions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `user_permissions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `permissionId` on the `user_permissions` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `user_preferences` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `user_preferences` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `users` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `work_order_steps` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderId` on the `work_order_steps` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `stationId` on the `work_order_steps` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `work_order_target_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderId` on the `work_order_target_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `propertyId` on the `work_order_target_properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `workOrderId` on the `work_order_to_order_lines` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `orderLineId` on the `work_order_to_order_lines` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `work_orders` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "customer_branches" DROP CONSTRAINT "customer_branches_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_color_aliases" DROP CONSTRAINT "customer_color_aliases_colorId_fkey";

-- DropForeignKey
ALTER TABLE "customer_color_aliases" DROP CONSTRAINT "customer_color_aliases_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_item_aliases" DROP CONSTRAINT "customer_item_aliases_customerId_fkey";

-- DropForeignKey
ALTER TABLE "customer_item_aliases" DROP CONSTRAINT "customer_item_aliases_itemId_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT "devices_machineId_fkey";

-- DropForeignKey
ALTER TABLE "item_allowed_colors" DROP CONSTRAINT "item_allowed_colors_colorId_fkey";

-- DropForeignKey
ALTER TABLE "item_allowed_colors" DROP CONSTRAINT "item_allowed_colors_itemId_fkey";

-- DropForeignKey
ALTER TABLE "item_allowed_properties" DROP CONSTRAINT "item_allowed_properties_itemId_fkey";

-- DropForeignKey
ALTER TABLE "item_allowed_properties" DROP CONSTRAINT "item_allowed_properties_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_dispatch_items" DROP CONSTRAINT "kartela_dispatch_items_dispatchId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_dispatch_items" DROP CONSTRAINT "kartela_dispatch_items_rollId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_dispatches" DROP CONSTRAINT "kartela_dispatches_cancelledById_fkey";

-- DropForeignKey
ALTER TABLE "kartela_dispatches" DROP CONSTRAINT "kartela_dispatches_dispatchedById_fkey";

-- DropForeignKey
ALTER TABLE "kartela_dispatches" DROP CONSTRAINT "kartela_dispatches_subcontractorId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_receipt_items" DROP CONSTRAINT "kartela_receipt_items_consumedRollId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_receipt_items" DROP CONSTRAINT "kartela_receipt_items_receiptId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_receipt_items" DROP CONSTRAINT "kartela_receipt_items_sourceDispatchItemId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_receipts" DROP CONSTRAINT "kartela_receipts_cancelledById_fkey";

-- DropForeignKey
ALTER TABLE "kartela_receipts" DROP CONSTRAINT "kartela_receipts_dispatchId_fkey";

-- DropForeignKey
ALTER TABLE "kartela_receipts" DROP CONSTRAINT "kartela_receipts_receivedById_fkey";

-- DropForeignKey
ALTER TABLE "kartela_receipts" DROP CONSTRAINT "kartela_receipts_subcontractorId_fkey";

-- DropForeignKey
ALTER TABLE "machines" DROP CONSTRAINT "machines_stationId_fkey";

-- DropForeignKey
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_printedById_fkey";

-- DropForeignKey
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "order_line_required_properties" DROP CONSTRAINT "order_line_required_properties_orderLineId_fkey";

-- DropForeignKey
ALTER TABLE "order_line_required_properties" DROP CONSTRAINT "order_line_required_properties_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_colorId_fkey";

-- DropForeignKey
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_itemId_fkey";

-- DropForeignKey
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_orderId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_branchId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_customerId_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_manualClosedById_fkey";

-- DropForeignKey
ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_createdById_fkey";

-- DropForeignKey
ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_machineId_fkey";

-- DropForeignKey
ALTER TABLE "permission_template_items" DROP CONSTRAINT "permission_template_items_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "permission_template_items" DROP CONSTRAINT "permission_template_items_templateId_fkey";

-- DropForeignKey
ALTER TABLE "printed_documents" DROP CONSTRAINT "printed_documents_printedById_fkey";

-- DropForeignKey
ALTER TABLE "product_recipe_properties" DROP CONSTRAINT "product_recipe_properties_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "product_recipe_properties" DROP CONSTRAINT "product_recipe_properties_recipeId_fkey";

-- DropForeignKey
ALTER TABLE "product_recipes" DROP CONSTRAINT "product_recipes_colorId_fkey";

-- DropForeignKey
ALTER TABLE "product_recipes" DROP CONSTRAINT "product_recipes_itemId_fkey";

-- DropForeignKey
ALTER TABLE "product_recipes" DROP CONSTRAINT "product_recipes_routeId_fkey";

-- DropForeignKey
ALTER TABLE "roll_errors" DROP CONSTRAINT "roll_errors_defectTypeId_fkey";

-- DropForeignKey
ALTER TABLE "roll_errors" DROP CONSTRAINT "roll_errors_detectedAtStepId_fkey";

-- DropForeignKey
ALTER TABLE "roll_errors" DROP CONSTRAINT "roll_errors_detectedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "roll_errors" DROP CONSTRAINT "roll_errors_processedAtStepId_fkey";

-- DropForeignKey
ALTER TABLE "roll_errors" DROP CONSTRAINT "roll_errors_processedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "roll_errors" DROP CONSTRAINT "roll_errors_rollId_fkey";

-- DropForeignKey
ALTER TABLE "roll_movements" DROP CONSTRAINT "roll_movements_machineId_fkey";

-- DropForeignKey
ALTER TABLE "roll_movements" DROP CONSTRAINT "roll_movements_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "roll_movements" DROP CONSTRAINT "roll_movements_rollId_fkey";

-- DropForeignKey
ALTER TABLE "roll_movements" DROP CONSTRAINT "roll_movements_workOrderStepId_fkey";

-- DropForeignKey
ALTER TABLE "roll_operations" DROP CONSTRAINT "roll_operations_inheritedFromParentRollId_fkey";

-- DropForeignKey
ALTER TABLE "roll_operations" DROP CONSTRAINT "roll_operations_machineId_fkey";

-- DropForeignKey
ALTER TABLE "roll_operations" DROP CONSTRAINT "roll_operations_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "roll_operations" DROP CONSTRAINT "roll_operations_rollId_fkey";

-- DropForeignKey
ALTER TABLE "roll_operations" DROP CONSTRAINT "roll_operations_workOrderStepId_fkey";

-- DropForeignKey
ALTER TABLE "roll_properties" DROP CONSTRAINT "roll_properties_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "roll_properties" DROP CONSTRAINT "roll_properties_rollId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_cancelledById_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_colorId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_customerId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_fromShipmentId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_itemId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_orderId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_qualityGradeId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_reasonId_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_receivedById_fkey";

-- DropForeignKey
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_rollId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_colorId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_createdById_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_currentStepId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_itemId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_parentReceiptId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_parentRollId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_producedInStepId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_qualityGradeId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_sackId_fkey";

-- DropForeignKey
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_shipmentId_fkey";

-- DropForeignKey
ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_routeId_fkey";

-- DropForeignKey
ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_stationId_fkey";

-- DropForeignKey
ALTER TABLE "routes" DROP CONSTRAINT "routes_customerId_fkey";

-- DropForeignKey
ALTER TABLE "sacks" DROP CONSTRAINT "sacks_shipmentId_fkey";

-- DropForeignKey
ALTER TABLE "shipment_allocations" DROP CONSTRAINT "shipment_allocations_orderLineId_fkey";

-- DropForeignKey
ALTER TABLE "shipment_allocations" DROP CONSTRAINT "shipment_allocations_shipmentId_fkey";

-- DropForeignKey
ALTER TABLE "shipment_orders" DROP CONSTRAINT "shipment_orders_orderId_fkey";

-- DropForeignKey
ALTER TABLE "shipment_orders" DROP CONSTRAINT "shipment_orders_shipmentId_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_branchId_fkey";

-- DropForeignKey
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_customerId_fkey";

-- DropForeignKey
ALTER TABLE "station_colors" DROP CONSTRAINT "station_colors_colorId_fkey";

-- DropForeignKey
ALTER TABLE "station_colors" DROP CONSTRAINT "station_colors_stationId_fkey";

-- DropForeignKey
ALTER TABLE "station_properties" DROP CONSTRAINT "station_properties_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "station_properties" DROP CONSTRAINT "station_properties_stationId_fkey";

-- DropForeignKey
ALTER TABLE "stations" DROP CONSTRAINT "stations_defaultCategoryId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_category_links" DROP CONSTRAINT "subcontractor_category_links_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_category_links" DROP CONSTRAINT "subcontractor_category_links_subcontractorId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatch_items" DROP CONSTRAINT "subcontractor_dispatch_items_dispatchId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatch_items" DROP CONSTRAINT "subcontractor_dispatch_items_rollId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT "subcontractor_dispatches_cancelledById_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT "subcontractor_dispatches_dispatchedById_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT "subcontractor_dispatches_plannedSubcontractorId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT "subcontractor_dispatches_stepId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT "subcontractor_dispatches_subcontractorId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT "subcontractor_dispatches_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipt_items" DROP CONSTRAINT "subcontractor_receipt_items_newRollId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipt_items" DROP CONSTRAINT "subcontractor_receipt_items_receiptId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipt_items" DROP CONSTRAINT "subcontractor_receipt_items_sourceDispatchItemId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipt_properties" DROP CONSTRAINT "subcontractor_receipt_properties_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipt_properties" DROP CONSTRAINT "subcontractor_receipt_properties_receiptId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipts" DROP CONSTRAINT "subcontractor_receipts_appliedColorId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipts" DROP CONSTRAINT "subcontractor_receipts_cancelledById_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipts" DROP CONSTRAINT "subcontractor_receipts_receivedById_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipts" DROP CONSTRAINT "subcontractor_receipts_stepId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipts" DROP CONSTRAINT "subcontractor_receipts_subcontractorId_fkey";

-- DropForeignKey
ALTER TABLE "subcontractor_receipts" DROP CONSTRAINT "subcontractor_receipts_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_colorId_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_createdById_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_itemId_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_parentReceiptId_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_parentRollId_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_sackId_fkey";

-- DropForeignKey
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_shipmentId_fkey";

-- DropForeignKey
ALTER TABLE "system_logs" DROP CONSTRAINT "system_logs_userId_fkey";

-- DropForeignKey
ALTER TABLE "system_settings" DROP CONSTRAINT "system_settings_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "traveler_card_scans" DROP CONSTRAINT "traveler_card_scans_cardId_fkey";

-- DropForeignKey
ALTER TABLE "traveler_card_scans" DROP CONSTRAINT "traveler_card_scans_scannedById_fkey";

-- DropForeignKey
ALTER TABLE "traveler_card_scans" DROP CONSTRAINT "traveler_card_scans_stationId_fkey";

-- DropForeignKey
ALTER TABLE "traveler_card_scans" DROP CONSTRAINT "traveler_card_scans_workOrderStepId_fkey";

-- DropForeignKey
ALTER TABLE "traveler_cards" DROP CONSTRAINT "traveler_cards_printedById_fkey";

-- DropForeignKey
ALTER TABLE "traveler_cards" DROP CONSTRAINT "traveler_cards_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "user_permissions" DROP CONSTRAINT "user_permissions_grantedById_fkey";

-- DropForeignKey
ALTER TABLE "user_permissions" DROP CONSTRAINT "user_permissions_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "user_permissions" DROP CONSTRAINT "user_permissions_userId_fkey";

-- DropForeignKey
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_userId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_steps" DROP CONSTRAINT "work_order_steps_plannedSubcontractorId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_steps" DROP CONSTRAINT "work_order_steps_requiredCategoryId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_steps" DROP CONSTRAINT "work_order_steps_stationId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_steps" DROP CONSTRAINT "work_order_steps_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_target_properties" DROP CONSTRAINT "work_order_target_properties_propertyId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_target_properties" DROP CONSTRAINT "work_order_target_properties_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_to_order_lines" DROP CONSTRAINT "work_order_to_order_lines_orderLineId_fkey";

-- DropForeignKey
ALTER TABLE "work_order_to_order_lines" DROP CONSTRAINT "work_order_to_order_lines_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_routeTemplateId_fkey";

-- DropForeignKey
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_splitFromId_fkey";

-- DropForeignKey
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_targetColorId_fkey";

-- DropForeignKey
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_targetItemId_fkey";

-- AlterTable
ALTER TABLE "colors" DROP CONSTRAINT "colors_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "colors_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "customer_branches" DROP CONSTRAINT "customer_branches_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" UUID NOT NULL,
ADD CONSTRAINT "customer_branches_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "customer_color_aliases" DROP CONSTRAINT "customer_color_aliases_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID NOT NULL,
ADD CONSTRAINT "customer_color_aliases_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "customer_item_aliases" DROP CONSTRAINT "customer_item_aliases_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" UUID NOT NULL,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
ADD CONSTRAINT "customer_item_aliases_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "customers" DROP CONSTRAINT "customers_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "defect_types" DROP CONSTRAINT "defect_types_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "defect_types_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "devices" DROP CONSTRAINT "devices_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "machineId",
ADD COLUMN     "machineId" UUID,
ADD CONSTRAINT "devices_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "fabric_properties" DROP CONSTRAINT "fabric_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "fabric_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "item_allowed_colors" DROP CONSTRAINT "item_allowed_colors_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID NOT NULL,
ADD CONSTRAINT "item_allowed_colors_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "item_allowed_properties" DROP CONSTRAINT "item_allowed_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
DROP COLUMN "propertyId",
ADD COLUMN     "propertyId" UUID NOT NULL,
ADD CONSTRAINT "item_allowed_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "items" DROP CONSTRAINT "items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "kartela_dispatch_items" DROP CONSTRAINT "kartela_dispatch_items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "dispatchId",
ADD COLUMN     "dispatchId" UUID NOT NULL,
DROP COLUMN "rollId",
ADD COLUMN     "rollId" UUID NOT NULL,
ADD CONSTRAINT "kartela_dispatch_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "kartela_dispatches" DROP CONSTRAINT "kartela_dispatches_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "subcontractorId",
ADD COLUMN     "subcontractorId" UUID NOT NULL,
DROP COLUMN "dispatchedById",
ADD COLUMN     "dispatchedById" UUID,
DROP COLUMN "cancelledById",
ADD COLUMN     "cancelledById" UUID,
ADD CONSTRAINT "kartela_dispatches_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "kartela_receipt_items" DROP CONSTRAINT "kartela_receipt_items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "receiptId",
ADD COLUMN     "receiptId" UUID NOT NULL,
DROP COLUMN "consumedRollId",
ADD COLUMN     "consumedRollId" UUID NOT NULL,
DROP COLUMN "sourceDispatchItemId",
ADD COLUMN     "sourceDispatchItemId" UUID,
ADD CONSTRAINT "kartela_receipt_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "kartela_receipts" DROP CONSTRAINT "kartela_receipts_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "dispatchId",
ADD COLUMN     "dispatchId" UUID,
DROP COLUMN "subcontractorId",
ADD COLUMN     "subcontractorId" UUID NOT NULL,
DROP COLUMN "receivedById",
ADD COLUMN     "receivedById" UUID,
DROP COLUMN "cancelledById",
ADD COLUMN     "cancelledById" UUID,
ADD CONSTRAINT "kartela_receipts_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "label_templates" DROP CONSTRAINT "label_templates_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "machines" DROP CONSTRAINT "machines_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "stationId",
ADD COLUMN     "stationId" UUID NOT NULL,
ADD CONSTRAINT "machines_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "workOrderId",
ADD COLUMN     "workOrderId" UUID NOT NULL,
DROP COLUMN "printedById",
ADD COLUMN     "printedById" UUID,
ADD CONSTRAINT "manifests_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "order_line_required_properties" DROP CONSTRAINT "order_line_required_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "orderLineId",
ADD COLUMN     "orderLineId" UUID NOT NULL,
DROP COLUMN "propertyId",
ADD COLUMN     "propertyId" UUID NOT NULL,
ADD CONSTRAINT "order_line_required_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "orderId",
ADD COLUMN     "orderId" UUID NOT NULL,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID,
ADD CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "orders" DROP CONSTRAINT "orders_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" UUID NOT NULL,
DROP COLUMN "branchId",
ADD COLUMN     "branchId" UUID,
DROP COLUMN "manualClosedById",
ADD COLUMN     "manualClosedById" UUID,
ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "pairing_codes" DROP COLUMN "machineId",
ADD COLUMN     "machineId" UUID NOT NULL,
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID;

-- AlterTable
ALTER TABLE "permission_template_items" DROP CONSTRAINT "permission_template_items_pkey",
DROP COLUMN "templateId",
ADD COLUMN     "templateId" UUID NOT NULL,
DROP COLUMN "permissionId",
ADD COLUMN     "permissionId" UUID NOT NULL,
ADD CONSTRAINT "permission_template_items_pkey" PRIMARY KEY ("templateId", "permissionId");

-- AlterTable
ALTER TABLE "permission_templates" DROP CONSTRAINT "permission_templates_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "permission_templates_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "printed_documents" DROP CONSTRAINT "printed_documents_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "printedById",
ADD COLUMN     "printedById" UUID,
ADD CONSTRAINT "printed_documents_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "product_recipe_properties" DROP CONSTRAINT "product_recipe_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "recipeId",
ADD COLUMN     "recipeId" UUID NOT NULL,
DROP COLUMN "propertyId",
ADD COLUMN     "propertyId" UUID NOT NULL,
ADD CONSTRAINT "product_recipe_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "product_recipes" DROP CONSTRAINT "product_recipes_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID,
DROP COLUMN "routeId",
ADD COLUMN     "routeId" UUID,
ADD CONSTRAINT "product_recipes_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "quality_grades" DROP CONSTRAINT "quality_grades_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "quality_grades_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "return_reasons" DROP CONSTRAINT "return_reasons_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "return_reasons_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "roll_errors" DROP CONSTRAINT "roll_errors_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "rollId",
ADD COLUMN     "rollId" UUID NOT NULL,
DROP COLUMN "defectTypeId",
ADD COLUMN     "defectTypeId" UUID,
DROP COLUMN "detectedAtStepId",
ADD COLUMN     "detectedAtStepId" UUID,
DROP COLUMN "detectedByUserId",
ADD COLUMN     "detectedByUserId" UUID,
DROP COLUMN "processedAtStepId",
ADD COLUMN     "processedAtStepId" UUID,
DROP COLUMN "processedByUserId",
ADD COLUMN     "processedByUserId" UUID,
ADD CONSTRAINT "roll_errors_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "roll_movements" DROP CONSTRAINT "roll_movements_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "rollId",
ADD COLUMN     "rollId" UUID NOT NULL,
DROP COLUMN "workOrderStepId",
ADD COLUMN     "workOrderStepId" UUID NOT NULL,
DROP COLUMN "operatorId",
ADD COLUMN     "operatorId" UUID,
DROP COLUMN "machineId",
ADD COLUMN     "machineId" UUID,
ADD CONSTRAINT "roll_movements_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "roll_operations" DROP CONSTRAINT "roll_operations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "rollId",
ADD COLUMN     "rollId" UUID NOT NULL,
DROP COLUMN "workOrderStepId",
ADD COLUMN     "workOrderStepId" UUID NOT NULL,
DROP COLUMN "operatorId",
ADD COLUMN     "operatorId" UUID,
DROP COLUMN "machineId",
ADD COLUMN     "machineId" UUID,
DROP COLUMN "inheritedFromParentRollId",
ADD COLUMN     "inheritedFromParentRollId" UUID,
ADD CONSTRAINT "roll_operations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "roll_properties" DROP CONSTRAINT "roll_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "rollId",
ADD COLUMN     "rollId" UUID NOT NULL,
DROP COLUMN "propertyId",
ADD COLUMN     "propertyId" UUID NOT NULL,
ADD CONSTRAINT "roll_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "roll_returns" DROP CONSTRAINT "roll_returns_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "rollId",
ADD COLUMN     "rollId" UUID NOT NULL,
DROP COLUMN "fromShipmentId",
ADD COLUMN     "fromShipmentId" UUID,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" UUID NOT NULL,
DROP COLUMN "orderId",
ADD COLUMN     "orderId" UUID,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID,
DROP COLUMN "reasonId",
ADD COLUMN     "reasonId" UUID,
DROP COLUMN "qualityGradeId",
ADD COLUMN     "qualityGradeId" UUID,
DROP COLUMN "receivedById",
ADD COLUMN     "receivedById" UUID NOT NULL,
DROP COLUMN "cancelledById",
ADD COLUMN     "cancelledById" UUID,
ADD CONSTRAINT "roll_returns_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "rolls" DROP CONSTRAINT "rolls_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID,
DROP COLUMN "qualityGradeId",
ADD COLUMN     "qualityGradeId" UUID,
DROP COLUMN "producedInStepId",
ADD COLUMN     "producedInStepId" UUID,
DROP COLUMN "currentStepId",
ADD COLUMN     "currentStepId" UUID,
DROP COLUMN "parentRollId",
ADD COLUMN     "parentRollId" UUID,
DROP COLUMN "parentReceiptId",
ADD COLUMN     "parentReceiptId" UUID,
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID,
DROP COLUMN "shipmentId",
ADD COLUMN     "shipmentId" UUID,
DROP COLUMN "sackId",
ADD COLUMN     "sackId" UUID,
ADD CONSTRAINT "rolls_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "route_steps" DROP CONSTRAINT "route_steps_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "routeId",
ADD COLUMN     "routeId" UUID NOT NULL,
DROP COLUMN "stationId",
ADD COLUMN     "stationId" UUID NOT NULL,
ADD CONSTRAINT "route_steps_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "routes" DROP CONSTRAINT "routes_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" UUID,
ADD CONSTRAINT "routes_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "sacks" DROP CONSTRAINT "sacks_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "shipmentId",
ADD COLUMN     "shipmentId" UUID,
ADD CONSTRAINT "sacks_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "shipment_allocations" DROP CONSTRAINT "shipment_allocations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "shipmentId",
ADD COLUMN     "shipmentId" UUID NOT NULL,
DROP COLUMN "orderLineId",
ADD COLUMN     "orderLineId" UUID NOT NULL,
ADD CONSTRAINT "shipment_allocations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "shipment_orders" DROP CONSTRAINT "shipment_orders_pkey",
DROP COLUMN "shipmentId",
ADD COLUMN     "shipmentId" UUID NOT NULL,
DROP COLUMN "orderId",
ADD COLUMN     "orderId" UUID NOT NULL,
ADD CONSTRAINT "shipment_orders_pkey" PRIMARY KEY ("shipmentId", "orderId");

-- AlterTable
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" UUID NOT NULL,
DROP COLUMN "branchId",
ADD COLUMN     "branchId" UUID,
ADD CONSTRAINT "shipments_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "station_colors" DROP CONSTRAINT "station_colors_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "stationId",
ADD COLUMN     "stationId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID NOT NULL,
ADD CONSTRAINT "station_colors_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "station_properties" DROP CONSTRAINT "station_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "stationId",
ADD COLUMN     "stationId" UUID NOT NULL,
DROP COLUMN "propertyId",
ADD COLUMN     "propertyId" UUID NOT NULL,
ADD CONSTRAINT "station_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "stations" DROP CONSTRAINT "stations_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "defaultCategoryId",
ADD COLUMN     "defaultCategoryId" UUID,
ADD CONSTRAINT "stations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subcontractor_categories" DROP CONSTRAINT "subcontractor_categories_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "subcontractor_categories_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subcontractor_category_links" DROP CONSTRAINT "subcontractor_category_links_pkey",
DROP COLUMN "subcontractorId",
ADD COLUMN     "subcontractorId" UUID NOT NULL,
DROP COLUMN "categoryId",
ADD COLUMN     "categoryId" UUID NOT NULL,
ADD CONSTRAINT "subcontractor_category_links_pkey" PRIMARY KEY ("subcontractorId", "categoryId");

-- AlterTable
ALTER TABLE "subcontractor_dispatch_items" DROP CONSTRAINT "subcontractor_dispatch_items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "dispatchId",
ADD COLUMN     "dispatchId" UUID NOT NULL,
DROP COLUMN "rollId",
ADD COLUMN     "rollId" UUID NOT NULL,
ADD CONSTRAINT "subcontractor_dispatch_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subcontractor_dispatches" DROP CONSTRAINT "subcontractor_dispatches_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "workOrderId",
ADD COLUMN     "workOrderId" UUID NOT NULL,
DROP COLUMN "stepId",
ADD COLUMN     "stepId" UUID NOT NULL,
DROP COLUMN "subcontractorId",
ADD COLUMN     "subcontractorId" UUID NOT NULL,
DROP COLUMN "plannedSubcontractorId",
ADD COLUMN     "plannedSubcontractorId" UUID,
DROP COLUMN "dispatchedById",
ADD COLUMN     "dispatchedById" UUID,
DROP COLUMN "cancelledById",
ADD COLUMN     "cancelledById" UUID,
ADD CONSTRAINT "subcontractor_dispatches_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subcontractor_receipt_items" DROP CONSTRAINT "subcontractor_receipt_items_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "receiptId",
ADD COLUMN     "receiptId" UUID NOT NULL,
DROP COLUMN "newRollId",
ADD COLUMN     "newRollId" UUID NOT NULL,
DROP COLUMN "sourceDispatchItemId",
ADD COLUMN     "sourceDispatchItemId" UUID,
ADD CONSTRAINT "subcontractor_receipt_items_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subcontractor_receipt_properties" DROP CONSTRAINT "subcontractor_receipt_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "receiptId",
ADD COLUMN     "receiptId" UUID NOT NULL,
DROP COLUMN "propertyId",
ADD COLUMN     "propertyId" UUID NOT NULL,
ADD CONSTRAINT "subcontractor_receipt_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subcontractor_receipts" DROP CONSTRAINT "subcontractor_receipts_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "workOrderId",
ADD COLUMN     "workOrderId" UUID NOT NULL,
DROP COLUMN "stepId",
ADD COLUMN     "stepId" UUID NOT NULL,
DROP COLUMN "subcontractorId",
ADD COLUMN     "subcontractorId" UUID NOT NULL,
DROP COLUMN "receivedById",
ADD COLUMN     "receivedById" UUID,
DROP COLUMN "appliedColorId",
ADD COLUMN     "appliedColorId" UUID,
DROP COLUMN "cancelledById",
ADD COLUMN     "cancelledById" UUID,
ADD CONSTRAINT "subcontractor_receipts_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "subcontractors" DROP CONSTRAINT "subcontractors_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "subcontractors_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "swatches" DROP CONSTRAINT "swatches_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "itemId",
ADD COLUMN     "itemId" UUID NOT NULL,
DROP COLUMN "colorId",
ADD COLUMN     "colorId" UUID,
DROP COLUMN "parentRollId",
ADD COLUMN     "parentRollId" UUID,
DROP COLUMN "createdById",
ADD COLUMN     "createdById" UUID,
DROP COLUMN "shipmentId",
ADD COLUMN     "shipmentId" UUID,
DROP COLUMN "sackId",
ADD COLUMN     "sackId" UUID,
DROP COLUMN "parentReceiptId",
ADD COLUMN     "parentReceiptId" UUID,
ADD CONSTRAINT "swatches_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "system_log_archives" DROP CONSTRAINT "system_log_archives_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID,
ADD CONSTRAINT "system_log_archives_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "system_logs" DROP CONSTRAINT "system_logs_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID,
ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "system_settings" DROP COLUMN "updatedById",
ADD COLUMN     "updatedById" UUID;

-- AlterTable
ALTER TABLE "traveler_card_scans" DROP CONSTRAINT "traveler_card_scans_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "cardId",
ADD COLUMN     "cardId" UUID NOT NULL,
DROP COLUMN "stationId",
ADD COLUMN     "stationId" UUID NOT NULL,
DROP COLUMN "workOrderStepId",
ADD COLUMN     "workOrderStepId" UUID,
DROP COLUMN "scannedById",
ADD COLUMN     "scannedById" UUID,
ADD CONSTRAINT "traveler_card_scans_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "traveler_cards" DROP CONSTRAINT "traveler_cards_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "workOrderId",
ADD COLUMN     "workOrderId" UUID NOT NULL,
DROP COLUMN "printedById",
ADD COLUMN     "printedById" UUID,
ADD CONSTRAINT "traveler_cards_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "user_permissions" DROP CONSTRAINT "user_permissions_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
DROP COLUMN "permissionId",
ADD COLUMN     "permissionId" UUID NOT NULL,
DROP COLUMN "grantedById",
ADD COLUMN     "grantedById" UUID,
ADD CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "work_order_steps" DROP CONSTRAINT "work_order_steps_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "workOrderId",
ADD COLUMN     "workOrderId" UUID NOT NULL,
DROP COLUMN "stationId",
ADD COLUMN     "stationId" UUID NOT NULL,
DROP COLUMN "requiredCategoryId",
ADD COLUMN     "requiredCategoryId" UUID,
DROP COLUMN "plannedSubcontractorId",
ADD COLUMN     "plannedSubcontractorId" UUID,
ADD CONSTRAINT "work_order_steps_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "work_order_target_properties" DROP CONSTRAINT "work_order_target_properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "workOrderId",
ADD COLUMN     "workOrderId" UUID NOT NULL,
DROP COLUMN "propertyId",
ADD COLUMN     "propertyId" UUID NOT NULL,
ADD CONSTRAINT "work_order_target_properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "work_order_to_order_lines" DROP CONSTRAINT "work_order_to_order_lines_pkey",
DROP COLUMN "workOrderId",
ADD COLUMN     "workOrderId" UUID NOT NULL,
DROP COLUMN "orderLineId",
ADD COLUMN     "orderLineId" UUID NOT NULL,
ADD CONSTRAINT "work_order_to_order_lines_pkey" PRIMARY KEY ("workOrderId", "orderLineId");

-- AlterTable
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "routeTemplateId",
ADD COLUMN     "routeTemplateId" UUID,
DROP COLUMN "targetItemId",
ADD COLUMN     "targetItemId" UUID,
DROP COLUMN "targetColorId",
ADD COLUMN     "targetColorId" UUID,
DROP COLUMN "splitFromId",
ADD COLUMN     "splitFromId" UUID,
ADD CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "customer_branches_customerId_isActive_idx" ON "customer_branches"("customerId", "isActive");

-- CreateIndex
CREATE INDEX "customer_color_aliases_customerId_idx" ON "customer_color_aliases"("customerId");

-- CreateIndex
CREATE INDEX "customer_color_aliases_colorId_assigned_idx" ON "customer_color_aliases"("colorId", "assigned");

-- CreateIndex
CREATE UNIQUE INDEX "customer_color_aliases_customerId_colorId_key" ON "customer_color_aliases"("customerId", "colorId");

-- CreateIndex
CREATE INDEX "customer_item_aliases_customerId_idx" ON "customer_item_aliases"("customerId");

-- CreateIndex
CREATE INDEX "customer_item_aliases_itemId_idx" ON "customer_item_aliases"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_item_aliases_customerId_itemId_key" ON "customer_item_aliases"("customerId", "itemId");

-- CreateIndex
CREATE INDEX "devices_machineId_idx" ON "devices"("machineId");

-- CreateIndex
CREATE INDEX "item_allowed_colors_colorId_idx" ON "item_allowed_colors"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "item_allowed_colors_itemId_colorId_key" ON "item_allowed_colors"("itemId", "colorId");

-- CreateIndex
CREATE INDEX "item_allowed_properties_propertyId_idx" ON "item_allowed_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "item_allowed_properties_itemId_propertyId_key" ON "item_allowed_properties"("itemId", "propertyId");

-- CreateIndex
CREATE INDEX "kartela_dispatch_items_dispatchId_idx" ON "kartela_dispatch_items"("dispatchId");

-- CreateIndex
CREATE INDEX "kartela_dispatch_items_rollId_idx" ON "kartela_dispatch_items"("rollId");

-- CreateIndex
CREATE INDEX "kartela_dispatches_subcontractorId_dispatchedAt_idx" ON "kartela_dispatches"("subcontractorId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "kartela_dispatches_dispatchedById_idx" ON "kartela_dispatches"("dispatchedById");

-- CreateIndex
CREATE INDEX "kartela_dispatches_cancelledById_idx" ON "kartela_dispatches"("cancelledById");

-- CreateIndex
CREATE INDEX "kartela_receipt_items_receiptId_idx" ON "kartela_receipt_items"("receiptId");

-- CreateIndex
CREATE INDEX "kartela_receipt_items_consumedRollId_idx" ON "kartela_receipt_items"("consumedRollId");

-- CreateIndex
CREATE INDEX "kartela_receipt_items_sourceDispatchItemId_idx" ON "kartela_receipt_items"("sourceDispatchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "kartela_receipt_items_receiptId_consumedRollId_key" ON "kartela_receipt_items"("receiptId", "consumedRollId");

-- CreateIndex
CREATE INDEX "kartela_receipts_subcontractorId_receivedAt_idx" ON "kartela_receipts"("subcontractorId", "receivedAt");

-- CreateIndex
CREATE INDEX "kartela_receipts_dispatchId_idx" ON "kartela_receipts"("dispatchId");

-- CreateIndex
CREATE INDEX "kartela_receipts_receivedById_idx" ON "kartela_receipts"("receivedById");

-- CreateIndex
CREATE INDEX "kartela_receipts_cancelledById_idx" ON "kartela_receipts"("cancelledById");

-- CreateIndex
CREATE INDEX "machines_stationId_idx" ON "machines"("stationId");

-- CreateIndex
CREATE INDEX "manifests_workOrderId_idx" ON "manifests"("workOrderId");

-- CreateIndex
CREATE INDEX "order_line_required_properties_propertyId_idx" ON "order_line_required_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_required_properties_orderLineId_propertyId_key" ON "order_line_required_properties"("orderLineId", "propertyId");

-- CreateIndex
CREATE INDEX "order_lines_orderId_idx" ON "order_lines"("orderId");

-- CreateIndex
CREATE INDEX "order_lines_itemId_idx" ON "order_lines"("itemId");

-- CreateIndex
CREATE INDEX "order_lines_colorId_idx" ON "order_lines"("colorId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_branchId_idx" ON "orders"("branchId");

-- CreateIndex
CREATE INDEX "orders_manualClosedById_idx" ON "orders"("manualClosedById");

-- CreateIndex
CREATE INDEX "pairing_codes_machineId_idx" ON "pairing_codes"("machineId");

-- CreateIndex
CREATE INDEX "permission_template_items_permissionId_idx" ON "permission_template_items"("permissionId");

-- CreateIndex
CREATE INDEX "printed_documents_printedById_idx" ON "printed_documents"("printedById");

-- CreateIndex
CREATE INDEX "product_recipe_properties_propertyId_idx" ON "product_recipe_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_recipe_properties_recipeId_propertyId_key" ON "product_recipe_properties"("recipeId", "propertyId");

-- CreateIndex
CREATE INDEX "product_recipes_itemId_idx" ON "product_recipes"("itemId");

-- CreateIndex
CREATE INDEX "product_recipes_colorId_idx" ON "product_recipes"("colorId");

-- CreateIndex
CREATE INDEX "product_recipes_routeId_idx" ON "product_recipes"("routeId");

-- CreateIndex
CREATE INDEX "roll_errors_detectedAtStepId_idx" ON "roll_errors"("detectedAtStepId");

-- CreateIndex
CREATE INDEX "roll_errors_processedAtStepId_idx" ON "roll_errors"("processedAtStepId");

-- CreateIndex
CREATE INDEX "roll_errors_defectTypeId_idx" ON "roll_errors"("defectTypeId");

-- CreateIndex
CREATE INDEX "roll_errors_rollId_isProcessed_idx" ON "roll_errors"("rollId", "isProcessed");

-- CreateIndex
CREATE INDEX "roll_errors_processedByUserId_processedAt_idx" ON "roll_errors"("processedByUserId", "processedAt");

-- CreateIndex
CREATE INDEX "roll_movements_workOrderStepId_idx" ON "roll_movements"("workOrderStepId");

-- CreateIndex
CREATE INDEX "roll_movements_operatorId_idx" ON "roll_movements"("operatorId");

-- CreateIndex
CREATE INDEX "roll_movements_machineId_idx" ON "roll_movements"("machineId");

-- CreateIndex
CREATE INDEX "roll_movements_rollId_enteredAt_idx" ON "roll_movements"("rollId", "enteredAt" DESC);

-- CreateIndex
CREATE INDEX "roll_operations_rollId_idx" ON "roll_operations"("rollId");

-- CreateIndex
CREATE INDEX "roll_operations_operatorId_idx" ON "roll_operations"("operatorId");

-- CreateIndex
CREATE INDEX "roll_operations_machineId_idx" ON "roll_operations"("machineId");

-- CreateIndex
CREATE INDEX "roll_operations_inheritedFromParentRollId_idx" ON "roll_operations"("inheritedFromParentRollId");

-- CreateIndex
CREATE INDEX "roll_operations_workOrderStepId_createdAt_idx" ON "roll_operations"("workOrderStepId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "roll_operations_rollId_workOrderStepId_operationType_key" ON "roll_operations"("rollId", "workOrderStepId", "operationType");

-- CreateIndex
CREATE INDEX "roll_properties_propertyId_idx" ON "roll_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "roll_properties_rollId_propertyId_key" ON "roll_properties"("rollId", "propertyId");

-- CreateIndex
CREATE INDEX "roll_returns_orderId_idx" ON "roll_returns"("orderId");

-- CreateIndex
CREATE INDEX "roll_returns_customerId_createdAt_idx" ON "roll_returns"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "roll_returns_itemId_colorId_width_idx" ON "roll_returns"("itemId", "colorId", "width");

-- CreateIndex
CREATE INDEX "roll_returns_fromShipmentId_idx" ON "roll_returns"("fromShipmentId");

-- CreateIndex
CREATE INDEX "roll_returns_rollId_idx" ON "roll_returns"("rollId");

-- CreateIndex
CREATE INDEX "roll_returns_reasonId_idx" ON "roll_returns"("reasonId");

-- CreateIndex
CREATE INDEX "roll_returns_receivedById_idx" ON "roll_returns"("receivedById");

-- CreateIndex
CREATE INDEX "roll_returns_qualityGradeId_idx" ON "roll_returns"("qualityGradeId");

-- CreateIndex
CREATE INDEX "roll_returns_cancelledById_idx" ON "roll_returns"("cancelledById");

-- CreateIndex
CREATE INDEX "rolls_itemId_idx" ON "rolls"("itemId");

-- CreateIndex
CREATE INDEX "rolls_parentRollId_idx" ON "rolls"("parentRollId");

-- CreateIndex
CREATE INDEX "rolls_parentReceiptId_idx" ON "rolls"("parentReceiptId");

-- CreateIndex
CREATE INDEX "rolls_createdById_idx" ON "rolls"("createdById");

-- CreateIndex
CREATE INDEX "rolls_colorId_status_idx" ON "rolls"("colorId", "status");

-- CreateIndex
CREATE INDEX "rolls_producedInStepId_status_idx" ON "rolls"("producedInStepId", "status");

-- CreateIndex
CREATE INDEX "rolls_currentStepId_status_idx" ON "rolls"("currentStepId", "status");

-- CreateIndex
CREATE INDEX "rolls_qualityGradeId_idx" ON "rolls"("qualityGradeId");

-- CreateIndex
CREATE INDEX "rolls_shipmentId_idx" ON "rolls"("shipmentId");

-- CreateIndex
CREATE INDEX "rolls_sackId_idx" ON "rolls"("sackId");

-- CreateIndex
CREATE INDEX "rolls_status_itemId_colorId_width_idx" ON "rolls"("status", "itemId", "colorId", "width");

-- CreateIndex
CREATE INDEX "route_steps_routeId_sequence_idx" ON "route_steps"("routeId", "sequence");

-- CreateIndex
CREATE INDEX "routes_customerId_idx" ON "routes"("customerId");

-- CreateIndex
CREATE INDEX "sacks_shipmentId_idx" ON "sacks"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_allocations_shipmentId_idx" ON "shipment_allocations"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_allocations_orderLineId_idx" ON "shipment_allocations"("orderLineId");

-- CreateIndex
CREATE INDEX "shipment_orders_orderId_idx" ON "shipment_orders"("orderId");

-- CreateIndex
CREATE INDEX "shipments_customerId_status_idx" ON "shipments"("customerId", "status");

-- CreateIndex
CREATE INDEX "shipments_branchId_idx" ON "shipments"("branchId");

-- CreateIndex
CREATE INDEX "station_colors_colorId_idx" ON "station_colors"("colorId");

-- CreateIndex
CREATE UNIQUE INDEX "station_colors_stationId_colorId_key" ON "station_colors"("stationId", "colorId");

-- CreateIndex
CREATE INDEX "station_properties_propertyId_idx" ON "station_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "station_properties_stationId_propertyId_key" ON "station_properties"("stationId", "propertyId");

-- CreateIndex
CREATE INDEX "stations_defaultCategoryId_idx" ON "stations"("defaultCategoryId");

-- CreateIndex
CREATE INDEX "subcontractor_category_links_categoryId_idx" ON "subcontractor_category_links"("categoryId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatch_items_dispatchId_idx" ON "subcontractor_dispatch_items"("dispatchId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatch_items_rollId_idx" ON "subcontractor_dispatch_items"("rollId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_plannedSubcontractorId_idx" ON "subcontractor_dispatches"("plannedSubcontractorId");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_cancelledById_idx" ON "subcontractor_dispatches"("cancelledById");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_workOrderId_dispatchedAt_idx" ON "subcontractor_dispatches"("workOrderId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_subcontractorId_dispatchedAt_idx" ON "subcontractor_dispatches"("subcontractorId", "dispatchedAt");

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_stepId_dispatchedAt_idx" ON "subcontractor_dispatches"("stepId", "dispatchedAt" DESC);

-- CreateIndex
CREATE INDEX "subcontractor_dispatches_dispatchedById_idx" ON "subcontractor_dispatches"("dispatchedById");

-- CreateIndex
CREATE INDEX "subcontractor_receipt_items_receiptId_idx" ON "subcontractor_receipt_items"("receiptId");

-- CreateIndex
CREATE INDEX "subcontractor_receipt_items_newRollId_idx" ON "subcontractor_receipt_items"("newRollId");

-- CreateIndex
CREATE INDEX "subcontractor_receipt_items_sourceDispatchItemId_idx" ON "subcontractor_receipt_items"("sourceDispatchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_receipt_items_receiptId_newRollId_key" ON "subcontractor_receipt_items"("receiptId", "newRollId");

-- CreateIndex
CREATE INDEX "subcontractor_receipt_properties_propertyId_idx" ON "subcontractor_receipt_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_receipt_properties_receiptId_propertyId_key" ON "subcontractor_receipt_properties"("receiptId", "propertyId");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_stepId_idx" ON "subcontractor_receipts"("stepId");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_appliedColorId_idx" ON "subcontractor_receipts"("appliedColorId");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_workOrderId_receivedAt_idx" ON "subcontractor_receipts"("workOrderId", "receivedAt");

-- CreateIndex
CREATE INDEX "subcontractor_receipts_subcontractorId_receivedAt_idx" ON "subcontractor_receipts"("subcontractorId", "receivedAt");

-- CreateIndex
CREATE INDEX "swatches_itemId_idx" ON "swatches"("itemId");

-- CreateIndex
CREATE INDEX "swatches_colorId_idx" ON "swatches"("colorId");

-- CreateIndex
CREATE INDEX "swatches_parentReceiptId_idx" ON "swatches"("parentReceiptId");

-- CreateIndex
CREATE INDEX "swatches_parentRollId_idx" ON "swatches"("parentRollId");

-- CreateIndex
CREATE INDEX "swatches_shipmentId_idx" ON "swatches"("shipmentId");

-- CreateIndex
CREATE INDEX "swatches_sackId_idx" ON "swatches"("sackId");

-- CreateIndex
CREATE INDEX "system_logs_userId_createdAt_idx" ON "system_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "traveler_card_scans_stationId_scannedAt_idx" ON "traveler_card_scans"("stationId", "scannedAt");

-- CreateIndex
CREATE INDEX "traveler_card_scans_workOrderStepId_idx" ON "traveler_card_scans"("workOrderStepId");

-- CreateIndex
CREATE INDEX "traveler_card_scans_scannedById_idx" ON "traveler_card_scans"("scannedById");

-- CreateIndex
CREATE INDEX "traveler_card_scans_cardId_scannedAt_idx" ON "traveler_card_scans"("cardId", "scannedAt" DESC);

-- CreateIndex
CREATE INDEX "traveler_cards_workOrderId_idx" ON "traveler_cards"("workOrderId");

-- CreateIndex
CREATE INDEX "user_permissions_userId_idx" ON "user_permissions"("userId");

-- CreateIndex
CREATE INDEX "user_permissions_permissionId_idx" ON "user_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_permissions_userId_permissionId_key" ON "user_permissions"("userId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- CreateIndex
CREATE INDEX "work_order_steps_workOrderId_stepSequence_idx" ON "work_order_steps"("workOrderId", "stepSequence");

-- CreateIndex
CREATE INDEX "work_order_steps_workOrderId_status_idx" ON "work_order_steps"("workOrderId", "status");

-- CreateIndex
CREATE INDEX "work_order_steps_requiredCategoryId_idx" ON "work_order_steps"("requiredCategoryId");

-- CreateIndex
CREATE INDEX "work_order_steps_plannedSubcontractorId_idx" ON "work_order_steps"("plannedSubcontractorId");

-- CreateIndex
CREATE INDEX "work_order_steps_stationId_status_isUrgent_priority_started_idx" ON "work_order_steps"("stationId", "status", "isUrgent", "priority", "startedAt");

-- CreateIndex
CREATE INDEX "work_order_target_properties_propertyId_idx" ON "work_order_target_properties"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_target_properties_workOrderId_propertyId_key" ON "work_order_target_properties"("workOrderId", "propertyId");

-- CreateIndex
CREATE INDEX "work_order_to_order_lines_orderLineId_idx" ON "work_order_to_order_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "work_orders_routeTemplateId_idx" ON "work_orders"("routeTemplateId");

-- CreateIndex
CREATE INDEX "work_orders_targetItemId_idx" ON "work_orders"("targetItemId");

-- CreateIndex
CREATE INDEX "work_orders_targetColorId_idx" ON "work_orders"("targetColorId");

-- CreateIndex
CREATE INDEX "work_orders_splitFromId_idx" ON "work_orders"("splitFromId");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "devices" ADD CONSTRAINT "devices_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_steps" ADD CONSTRAINT "route_steps_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipes" ADD CONSTRAINT "product_recipes_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_properties" ADD CONSTRAINT "product_recipe_properties_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "product_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_recipe_properties" ADD CONSTRAINT "product_recipe_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_qualityGradeId_fkey" FOREIGN KEY ("qualityGradeId") REFERENCES "quality_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_parentRollId_fkey" FOREIGN KEY ("parentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_parentReceiptId_fkey" FOREIGN KEY ("parentReceiptId") REFERENCES "subcontractor_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_producedInStepId_fkey" FOREIGN KEY ("producedInStepId") REFERENCES "work_order_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_routeTemplateId_fkey" FOREIGN KEY ("routeTemplateId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetItemId_fkey" FOREIGN KEY ("targetItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_targetColorId_fkey" FOREIGN KEY ("targetColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_splitFromId_fkey" FOREIGN KEY ("splitFromId") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_operations" ADD CONSTRAINT "roll_operations_inheritedFromParentRollId_fkey" FOREIGN KEY ("inheritedFromParentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "roll_movements" ADD CONSTRAINT "roll_movements_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipts" ADD CONSTRAINT "subcontractor_receipts_appliedColorId_fkey" FOREIGN KEY ("appliedColorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipt_properties" ADD CONSTRAINT "subcontractor_receipt_properties_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "subcontractor_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_receipt_properties" ADD CONSTRAINT "subcontractor_receipt_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_parentReceiptId_fkey" FOREIGN KEY ("parentReceiptId") REFERENCES "kartela_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_parentRollId_fkey" FOREIGN KEY ("parentRollId") REFERENCES "rolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swatches" ADD CONSTRAINT "swatches_sackId_fkey" FOREIGN KEY ("sackId") REFERENCES "sacks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatches" ADD CONSTRAINT "kartela_dispatches_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatches" ADD CONSTRAINT "kartela_dispatches_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatches" ADD CONSTRAINT "kartela_dispatches_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatch_items" ADD CONSTRAINT "kartela_dispatch_items_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "kartela_dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_dispatch_items" ADD CONSTRAINT "kartela_dispatch_items_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "kartela_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_subcontractorId_fkey" FOREIGN KEY ("subcontractorId") REFERENCES "subcontractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipts" ADD CONSTRAINT "kartela_receipts_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipt_items" ADD CONSTRAINT "kartela_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "kartela_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipt_items" ADD CONSTRAINT "kartela_receipt_items_consumedRollId_fkey" FOREIGN KEY ("consumedRollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kartela_receipt_items" ADD CONSTRAINT "kartela_receipt_items_sourceDispatchItemId_fkey" FOREIGN KEY ("sourceDispatchItemId") REFERENCES "kartela_dispatch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "printed_documents" ADD CONSTRAINT "printed_documents_printedById_fkey" FOREIGN KEY ("printedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sacks" ADD CONSTRAINT "sacks_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "customer_branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_orders" ADD CONSTRAINT "shipment_orders_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_orders" ADD CONSTRAINT "shipment_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_allocations" ADD CONSTRAINT "shipment_allocations_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_allocations" ADD CONSTRAINT "shipment_allocations_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_rollId_fkey" FOREIGN KEY ("rollId") REFERENCES "rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_fromShipmentId_fkey" FOREIGN KEY ("fromShipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "return_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_qualityGradeId_fkey" FOREIGN KEY ("qualityGradeId") REFERENCES "quality_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roll_returns" ADD CONSTRAINT "roll_returns_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_properties" ADD CONSTRAINT "item_allowed_properties_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_properties" ADD CONSTRAINT "item_allowed_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "fabric_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_colors" ADD CONSTRAINT "item_allowed_colors_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_allowed_colors" ADD CONSTRAINT "item_allowed_colors_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_item_aliases" ADD CONSTRAINT "customer_item_aliases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_item_aliases" ADD CONSTRAINT "customer_item_aliases_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_color_aliases" ADD CONSTRAINT "customer_color_aliases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_color_aliases" ADD CONSTRAINT "customer_color_aliases_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
