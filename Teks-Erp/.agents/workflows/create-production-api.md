---
description: Workflow to generate the Production and Tablet Operations API endpoints.
---

---
description: "Workflow to generate the Production and Tablet Operations API endpoints."
globs: "*"
---

# Workflow: Create Production & Tablet API

**Objective:** Build the API endpoints for shop-floor tablet operations, including station start/finish tracking, subcontractor handling, and defect reporting at QC2 (Kurşun).

## Step 1: Initialize Controller and Service
* Create `ProductionController` and `ProductionService`.
* Inject `SystemLog` capabilities for auditing all production movements.

## Step 2: Implement Station Action Endpoint (`POST /production/step-action`)
* **Logic:**
  * Accept `barcode` (or `rollId`), `stationId`, and `action` (START or FINISH).
  * Locate the current `WorkOrderStep` for this roll.
  * If `action` is `START`: Update `StepStatus` to `ACTIVE` and log `startedAt`.
  * If `action` is `FINISH`: Update `StepStatus` to `COMPLETED` and log `completedAt`. Move the roll's `currentStepId` to the next step in the route.
  * **Business Rule Constraint (Subcontractor):** If the station `type` is `EXTERNAL` and action is `FINISH`, the system MUST require `newQty` (and/or `newWeight`) in the request body to account for shrinkage/waste. Update the Roll's `currentQty` accordingly before completing the step.

## Step 3: Implement Dashboard Endpoint (`GET /production/active-steps`)
* **Logic:**
  * Return a list of all machines/stations currently processing a roll. 
  * Query `WorkOrderStep` where status is `ACTIVE`, including `Machine`, `WorkOrder`, and `Roll` details.

## Step 4: Implement Defect Reporting Endpoint (`POST /production/report-error`)
* **Logic:**
  * Designed for the Kurşun (QC2) station.
  * Accept `rollId`, `startMeter`, `endMeter`, and `errorType`.
  * Create a `RollError` record. Ensure `isProcessed` defaults to `false`.
  * Trigger a `SystemLog` entry for defect creation.

## Step 5: Security & RBAC
* Apply authentication middleware.
* Apply RBAC middleware checking for `production:write` on POST routes and `production:read` on GET routes.