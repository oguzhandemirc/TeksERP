---
description: "Workflow to initialize the Node.js project and install necessary dependencies
---

---
description: "Advanced workflow to initialize the TeksERP Node.js/TypeScript project with Express, Prisma, and Swagger."
globs: "*"
---

# Workflow: Advanced Project Initialization & Setup

**Objective:** Create a professional-grade TypeScript/Express environment for TeksERP, incorporating all necessary architectural layers and documentation tools.

## Step 1: Core Node.js & TypeScript Initialization
* **Initialize NPM:** Run `npm init -y`.
* **Install TypeScript:** Run `npm install typescript ts-node nodemon --save-dev`.
* **Initialize TSConfig:** Run `npx tsc --init`.
* **Configure TSConfig:** Update `tsconfig.json` to ensure `rootDir: "./src"`, `outDir: "./dist"`, and `strict: true`.

## Step 2: Install Project Dependencies
* **Core Framework:** Run `npm install express dotenv cors helmet`.
* **Database & ORM:** Run `npm install prisma @prisma/client pg`.
* **Authentication:** Run `npm install jsonwebtoken bcryptjs`.
* **Validation & Utilities:** Run `npm install zod uuid morgan`.
* **Documentation:** Run `npm install swagger-ui-express swagger-jsdoc`.
* **Types for TS:** Run `npm install --save-dev @types/node @types/express @types/cors @types/jsonwebtoken @types/bcryptjs @types/swagger-ui-express @types/swagger-jsdoc @types/morgan`.

## Step 3: Initialize Prisma & Environment
* **Prisma Init:** Run `npx prisma init`.
* **Env Setup:** Create a `.env` file in the root and define `DATABASE_URL` (PostgreSQL) and `JWT_SECRET`.
* **Schema Alignment:** Remind the user to copy the Prisma models provided in the project documentation into `prisma/schema.prisma`.

## Step 4: Scaffold Directory Structure
Create the following directory hierarchy within the `src/` folder:
* `src/config/` (for Swagger and Database config)
* `src/controllers/` (extending BaseController)
* `src/services/` (business logic layer)
* `src/routes/` (Express routing)
* `src/middlewares/` (Auth, RBAC, Error Handling)
* `src/models/` (Zod schemas for validation)
* `src/types/` (Custom TypeScript interfaces)

## Step 5: Initialize Swagger & Central Entry Point
* **Swagger Config:** Create `src/config/swagger.ts` to define the OpenAPI metadata.
* **App Entry:** Create `src/app.ts` to initialize Express, apply middlewares (Helmet, CORS, JSON), and register the `/api-docs` route.
* **Server Entry:** Create `src/server.ts` to listen on the specified `PORT`.

## Step 6: Verify and Audit
* Run `npx prisma generate` to sync types with the schema.
* Perform a dummy build check using `npx tsc` to ensure no environment mismatches exist.