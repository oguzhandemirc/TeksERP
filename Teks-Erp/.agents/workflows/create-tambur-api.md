---
description: Workflow to generate the Tambur (Finalization & Allocation) API endpoints.
---

---
description: "Workflow to generate the Tambur (Finalization & Allocation) API endpoints."
globs: "*"
---

# Workflow: Create Tambur & Allocation API

**Objective:** Build the API endpoints for final quality decisions, roll splitting based on defects, and order allocation at the Tambur station.

## Step 1: Initialize Controller and Service
* Create `TamburController` and `TamburService`.
* Ensure `SystemLog` capabilities are injected to audit all cuts and allocations.

## Step 2: Implement Pending Rolls Endpoint (`GET /tambur/pending-rolls`)
* **Logic:**
  * Fetch rolls that are currently `IN_PRODUCTION` and waiting at the Tambur station.
  * Include related `RollError` records (defects reported at Kurşun) where `isProcessed` is `false`.

## Step 3: Implement Finalization & Splitting Endpoint (`POST /tambur/finalize`)
* **Logic:**
  * Accept `rollId`, final net `currentQty`, and an array of decisions for the related `RollError` records.
  * For each error, if the decision is `CUT`:
      * **CRITICAL BUSINESS RULE (Roll Splitting):** Do not just reduce the original roll's quantity. Create a *new* `Roll` record in the database.
      * Generate a new `barcode` for this cut piece.
      * Set its `status` to `SCRAP`.
      * Set its `qualityGrade` to `FIRE` or `A1` based on the request.
  * Update the original roll's `currentQty` to the new net value. Change its `status` to `PRODUCED`.
  * Update the processed `RollError` records to `isProcessed: true` and log the `actionTaken`.
  * Trigger `SystemLog` entries for both the update of the original roll and the creation of any new scrap/A1 rolls.

## Step 4: Implement Order Allocation Endpoint (`POST /tambur/allocate`)
* **Logic:**
  * Accept `rollId`, `orderLineId`, and `allocatedQty`.
  * Verify the roll is `PRODUCED` and has sufficient `currentQty`.
  * Create an `OrderAllocation` record linking the roll to the `OrderLine`.
  * Trigger `SystemLog` for the allocation.

## Step 5: Security & RBAC
* Apply authentication middleware.
* Apply RBAC middleware checking for `tambur:write` on POST routes and `tambur:read` on GET routes.