---
trigger: always_on
---

---
description: "Core database (Prisma) and API (Express) standards for the TeksERP project."
globs: "*"
alwaysApply: true
---

# TeksERP Core Architecture Rules
## 1. Database and Prisma Standards
*Primary Keys (PK): The id field must strictly be defined as String @id @default(uuid()) in all tables.

*Timestamps: createdAt and updatedAt must be mandatorily included in every table.

*Audit Logging: For every "Create/Update/Delete" (CUD) operation in the system, the old and new states of the data must be automatically recorded in the SystemLog table.

*Deletion Logic: Physical deletion (DELETE) must not be performed. The isActive flag or specific statuses (e.g., RollStatus.SCRAP) should be used for Active/Passive states.

## 2. API and Controller Standards
*BaseController Structure: A common BaseController must be used for fundamental CRUD operations (Create, Read, Update, Delete). In particular, endpoints like /items, /customers, and /stations (Master Data) should operate through this base structure; no additional backend code should be written for them.

*Dynamic Query Engine: Filtering, sorting, and pagination parameters coming from the frontend must be automatically converted into Prisma queries within the BaseController.

*Dynamic Authorization (RBAC): For every incoming request, the user's access permission for that specific module (e.g., "order:write") must be verified via the Auth & Security Controller. Operations must be isolated.

## 3. Tech Stack & Allowed Packages
The agent MUST ONLY use the following specific NPM packages for the backend ecosystem. 

* **Language:** TypeScript MUST be used strictly for all files (use `.ts` extension). Never output raw `.js` files.
* **Core & Server:** `express`, `dotenv`, `cors`, `helmet`.
* **Database & ORM:** `prisma`, `@prisma/client`, `pg`.
* **Authentication & Security:** `jsonwebtoken`, `bcryptjs`.
* **Data Validation:** `zod`.
* **Logging:** `morgan`.
* **Utilities:** `uuid`.
* **Dev Dependencies:** `typescript`, `ts-node`, `nodemon`, `@types/node`, `@types/express`.
* **API Documentation:** `swagger-ui-express` and `swagger-jsdoc`.

## 4. TypeScript Standards
* **Strict Typing:** Always use strict typing. Do NOT use the `any` type.
* **Express Types:** Always type Express controllers properly (e.g., `req: Request`, `res: Response` imported from `express`).
* **Prisma Types:** Leverage Prisma's auto-generated types for database interactions (e.g., `Item`, `Roll`, `WorkOrder` from `@prisma/client`).

## 5. API Documentation Standards (Swagger)
* **Automatic Documentation:** Every controller and route MUST include Swagger/OpenAPI JSDoc comments.
* **Metadata:** Each endpoint must define:
    * `@openapi` or `@swagger` tag.
    * [cite_start]`summary` and `description` (consistent with TeksERP business terms). [cite: 3, 4]
    * `parameters` (for path/query params).
    * `requestBody` (with schema references where applicable).
    * `responses` (at least 200/201 for success and 400/401/500 for errors).
* **Central Hub:** A `/api-docs` route must be initialized to serve the Swagger UI.