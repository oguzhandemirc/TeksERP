---
description: Workflow to generate the Inventory and QC1 (Mal Kabul) API endpoints, controllers, and services.
---

---
description: "Workflow to generate the Inventory and QC1 (Mal Kabul) API endpoints, controllers, and services."
globs: "*"
---

# Workflow: Create Inventory & QC1 API

**Objective:** Build the API endpoints for initial goods receipt (Ham Mal Girişi) and inventory tracking, adhering to the core architecture and business rules.

## Step 1: Initialize Controller and Service
* Create `InventoryController` and `InventoryService` files.
* Ensure the controller extends or utilizes the standard `BaseController` logic for basic CRUD operations.
* Inject Prisma client and a logging service (for `SystemLog`).

## Step 2: Implement Initial Entry Endpoint (`POST /rolls/initial-entry`)
* **Route:** Create the `POST` route.
* **Logic:** * Accept `itemId`, `initialQty`, `weightKg`, and `qualityGrade` from the request body.
  * Generate a unique `UUID` for the roll's `id`.
  * Generate a unique `barcode` string.
  * Set `status` strictly to `STOCK`.
  * Create the `Roll` record in the database.
* **Audit:** Automatically trigger an insert into `SystemLog` with `action: "CREATE"`, `entityType: "ROLL"`, and the new roll data.

## Step 3: Implement Inventory Fetching Endpoint (`GET /rolls`)
* **Route:** Create the `GET` route.
* **Logic:**
  * Implement the Dynamic Query Engine to parse `filter`, `sort`, and `pagination` from query parameters.
  * **Business Rule Constraint:** By default, only return rolls where `status` is `STOCK` (Ambar). Do not return rolls that are `IN_PRODUCTION` or `SHIPPED` unless explicitly requested by a specific filter.

## Step 4: Security and Route Registration
* Register these endpoints in the main Express router.
* Apply authentication middleware.
* Apply RBAC (Role-Based Access Control) middleware checking for `inventory:write` permission on the `POST` route, and `inventory:read` on the `GET` route.