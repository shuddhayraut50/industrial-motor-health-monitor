# Local Development Setup Guide

## Project: `industrial-motor-health-monitor`

This guide explains how to install dependencies, run the local Next.js development server, execute unit tests, and perform end-to-end browser tests.

---

### Prerequisites

- **Node.js**: v20 or higher (v24 LTS recommended)
- **npm**: v10+
- **Git**: Installed and available in PATH

---

### Quick Start

1. **Clone or Navigate to the Workspace**
   ```bash
   cd "c:\Users\Shudd\OneDrive\Desktop\Shuddhay\AI motor"
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   For local testing, the default mock database fallback is enabled (`ENABLE_MOCK_FALLBACK=true`), allowing full offline functionality, charts, and Playwright verification without requiring live Supabase credentials.

4. **Run Unit Tests (Vitest)**
   ```bash
   npm run test
   ```

5. **Run End-to-End Tests (Playwright)**
   ```bash
   npm run test:e2e
   ```

6. **Start the Local Development Server**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts Next.js development server with Turbopack |
| `npm run build` | Compiles production bundle with strict typecheck & page generation |
| `npm run start` | Serves compiled production application on `http://localhost:3000` |
| `npm run lint` | Runs ESLint 9 across all TypeScript and React source files |
| `npm run typecheck` | Executes TypeScript type checking (`tsc --noEmit`) |
| `npm run test` | Runs fast in-memory unit tests with Vitest |
| `npm run test:e2e` | Runs comprehensive Playwright browser tests across Desktop & Mobile |
