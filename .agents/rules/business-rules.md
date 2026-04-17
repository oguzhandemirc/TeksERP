---
trigger: always_on
---

---
description: "Production, subcontracting, quality control, and shipment business logic rules for the TeksERP project."
globs: "*"
alwaysApply: true
---

# TeksERP Business Logic and Process Rules

## 1. Work Order (Batch) and Routing Logic
* **Flexibility (One-to-Many Relations):** A work order (batch) can be linked to multiple orders or can be produced directly for inventory (stock) without being linked to any order. A work order is not mandatory for shipping an order; it can be shipped directly from stock.
* **Routing Steps:** Stations in the production route must be followed sequentially. When each work order is finalized, a "Traveler Card" (Refakat Kartı) is generated to physically travel with the goods and trigger processes at stations.

## 2. Station and Subcontracting (External) Operations
* **Subcontractor Trigger:** The moment a product is shipped to an external subcontractor station (dyehouse, printing, etc.), that station's operation status changes to "Started" in the system. The system must allow real-time tracking that the product is "Being processed at a Subcontractor".
* **Subcontractor Return & Shrinkage:** When the product returns to the facility from outside, a goods receipt is entered. The system MUST explicitly ask for the "New Meterage/Weight" because processes like dyeing cause shrinkage or waste. The `currentQty` in the `Roll` table must be updated with this new value before the operation is confirmed as "Finished/Completed".

## 3. Kurşun (QC2) and Tambur (Decision Point) Relationship
* **Defect Detection:** Defective meterages detected at the Kurşun station are manually entered into the system. This data serves as "Input" for the Tambur station.
* **Tambur Decision Mechanism:** Defects entered at Kurşun appear as a list on the Tambur screen. The operator marks the defect as "Cut" or "Not Cut" on the screen.
* **Roll Splitting (Critical):** If an operator "Cuts" a defect, the system must NOT merely reduce the meterage of the existing roll. It MUST create a new `Roll` record (with a new barcode) for the cut piece, assigning it a status of `SCRAP` or `A1`. The original roll's `currentQty` is then updated to reflect the remaining net product.
* **Allocation:** The net product coming out of the Tambur can be allocated to multiple orders by planning or put directly into stock.

## 4. Logistics and Shipping Flexibility
* **Visibility:** The shipping department does not see work orders; they only see orders in the "Ready for Shipment" status on their independent interface.
* **Flexible Reassignment:** Goods reserved for one customer in the system can have their order link detached at the time of shipment and be reassigned and shipped to another customer's order.
* **Order Completion Trigger:** When a shipment is confirmed (`SHIPPED` status), the system must check the total `shippedQty` for that order. If the shipped quantity meets or exceeds the requested `quantity`, the order's status MUST automatically update to `COMPLETED`. Otherwise, it remains `PARTIAL_SHIPPED`.