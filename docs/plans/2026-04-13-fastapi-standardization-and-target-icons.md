# FastAPI Standardization And Target Icons Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Standardize the backend into a layered FastAPI `app/` package inspired by deer-flow's structure, and replace map circle-only target markers with type-appropriate air/sea/underwater symbols.

**Architecture:** Introduce an `app` package with `core`, `api`, `models`, `schemas`, and `services` modules, while keeping thin compatibility shims at the old top-level module paths. For the frontend, add a shared marker-symbol helper that generates deterministic SVG-backed assets for MapLibre and Cesium so 2D/3D views render target-type-specific markers consistently.

**Tech Stack:** FastAPI, SQLAlchemy asyncio, Pydantic Settings, Next.js 16, React 19, MapLibre GL, Cesium, TypeScript.

### Task 1: Backfill regression coverage for backend structure

**Files:**
- Create: `nexus-backend/tests/test_app_structure.py`
- Modify: `nexus-backend/tests/test_tools.py`

**Step 1: Write the failing test**

Add tests that import the standardized app factory and assert:
- `create_app()` mounts `/health`
- `/api/conversations` is registered
- compatibility exports from top-level `main.py` still expose `app`

**Step 2: Run test to verify it fails**

Run: `pytest -q nexus-backend/tests/test_app_structure.py`
Expected: FAIL because `app.main:create_app` does not exist yet.

**Step 3: Write minimal implementation**

Create the `app` package layout and a factory-based FastAPI entrypoint, then keep `nexus-backend/main.py` as a compatibility import shim.

**Step 4: Run test to verify it passes**

Run: `pytest -q nexus-backend/tests/test_app_structure.py`
Expected: PASS

### Task 2: Standardize backend package layout

**Files:**
- Create: `nexus-backend/app/__init__.py`
- Create: `nexus-backend/app/main.py`
- Create: `nexus-backend/app/core/config.py`
- Create: `nexus-backend/app/core/db.py`
- Create: `nexus-backend/app/api/__init__.py`
- Create: `nexus-backend/app/api/router.py`
- Create: `nexus-backend/app/api/routes/chat.py`
- Create: `nexus-backend/app/api/routes/conversations.py`
- Create: `nexus-backend/app/models/__init__.py`
- Create: `nexus-backend/app/models/conversation.py`
- Create: `nexus-backend/app/schemas/__init__.py`
- Create: `nexus-backend/app/schemas/chat.py`
- Create: `nexus-backend/app/schemas/conversation.py`
- Create: `nexus-backend/app/services/__init__.py`
- Create: `nexus-backend/app/services/llm.py`
- Create: `nexus-backend/app/services/tools.py`
- Modify: `nexus-backend/config.py`
- Modify: `nexus-backend/database.py`
- Modify: `nexus-backend/models.py`
- Modify: `nexus-backend/schemas.py`
- Modify: `nexus-backend/services/llm.py`
- Modify: `nexus-backend/services/tools.py`
- Modify: `nexus-backend/routers/chat.py`
- Modify: `nexus-backend/routers/conversations.py`

**Step 1: Preserve behavior**

Keep request/response models, DB session helpers, tool execution, and streaming chat behavior unchanged while relocating them into the new package.

**Step 2: Keep compatibility**

Turn the old top-level modules into thin re-export shims so existing commands like `uvicorn main:app` still work.

**Step 3: Run focused tests**

Run: `pytest -q nexus-backend/tests`
Expected: PASS

### Task 3: Add frontend marker-symbol coverage

**Files:**
- Create: `nexus-ui/src/lib/map-symbols.ts`
- Create: `nexus-ui/src/lib/map-symbols.test.mjs`

**Step 1: Write the failing test**

Add tests for:
- air/sea/underwater symbols produce distinct SVG payloads
- hostile/friendly colors are reflected in generated output
- registered IDs remain stable

**Step 2: Run test to verify it fails**

Run: `node --test nexus-ui/src/lib/map-symbols.test.mjs`
Expected: FAIL because the helper does not exist yet.

**Step 3: Write minimal implementation**

Implement deterministic SVG symbol generation with stable IDs and data-URL helpers consumable by both MapLibre and Cesium.

**Step 4: Run test to verify it passes**

Run: `node --test nexus-ui/src/lib/map-symbols.test.mjs`
Expected: PASS

### Task 4: Replace circle-only map markers

**Files:**
- Modify: `nexus-ui/src/components/map/Map2D.tsx`
- Modify: `nexus-ui/src/components/map/Map3D.tsx`
- Modify: `nexus-ui/src/components/military/MilSymbol.tsx`

**Step 1: Update 2D map symbols**

Register generated marker images on map load, switch the primary track layer from `circle` to `symbol`, and keep highlight/label interactions working.

**Step 2: Update 3D map entities**

Replace `point` entities with billboard icons generated from the same helper while preserving labels and selection.

**Step 3: Align panel iconography**

Ensure list/detail military icons visually match the new map symbols for air and sea targets.

**Step 4: Run validation**

Run: `pnpm lint`
Run: `npm run build`
Expected: PASS or actionable frontend errors to fix.

### Task 5: Final verification

**Files:**
- Review only

**Step 1: Backend verification**

Run: `pytest -q nexus-backend/tests`

**Step 2: Frontend verification**

Run: `pnpm lint`
Run: `npm run build`
Run: `node --test nexus-ui/src/lib/map-symbols.test.mjs`

**Step 3: Summarize residual risk**

Document whether map markers were verified only by static build/lint versus full browser rendering.
