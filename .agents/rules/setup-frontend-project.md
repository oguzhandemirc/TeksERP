---
description: "Vite + React Project Setup Workflow"
globs: "*"
alwaysApply: false
globs: *
alwaysApply: false
---

# Setup Frontend Project Workflow

Yeni projeyi veya temel ortamı başlatmak için aşağıdaki adımlar izlenmelidir:

1. **Vite Kurulumu:** 
   `npx create-vite@latest . --template react-ts`
2. **Tailwind CSS Kurulumu:** 
   - `npm install -D tailwindcss postcss autoprefixer`
   - `npx tailwindcss init -p`
   - `.css` dosyasında Tailwind katmanlarını `@tailwind base; @tailwind components; @tailwind utilities;` olarak ayarlama.
3. **Core Kütüphanelerin Temini:** 
   `npm install react-router-dom axios zustand @tanstack/react-query lucide-react`
4. **Shadcn UI (Eğer Seçildiyse):** 
   - `npx shadcn-ui@latest init` 
   - Konfigürasyon dosyasında renk temalarını ayarlama.
5. **Klasör Ağacının İnşası:** 
   `src/` dizini altına kurallara uygun (`components`, `pages`, `hooks`, `services`) klasör yapısını kurma.
6. **API Client'ı (Axios) Kurmak:** 
   - `src/services/apiClient.ts` oluşturmak.
   - Timeout ve VITE_API_BASE_URL ayarlarını yapmak.
