# TagForge - AI Coding Agent Instructions

## Project Overview
TagForge is a Next.js 16 (App Router) site inventory management system for tracking equipment across multiple sites. It handles NFO (network facility operations), PMR (planned maintenance records), and analyst workflows with image uploads to Cloudflare R2 storage.

## Architecture

### Tech Stack
- **Framework**: Next.js 16.1 with App Router, React 19, TypeScript
- **Database**: Supabase (PostgreSQL) with anonymous auth
- **Storage**: Cloudflare R2 (S3-compatible) for image uploads
- **Styling**: Tailwind CSS v4
- **Image Processing**: browser-image-compression (client-side, target ≤100KB)

### Key Data Tables
- `main_inventory`: Core equipment records with site_id, serial numbers, tag IDs, and image URLs
- `v_main_inventory_audit`: Audit view with created_by_name/updated_by_name
- `nfo_profiles`: User profiles (full_name, region)
- `helper_catalog`: Product catalog for cascading dropdowns (category → equipment_type → product_name → product_number)
- `tag_category_helper`, `photo_category_helper`: Dropdown options with sort_order
- `site_category_requirements`: Site-specific rules (required_flag, rule_text, parse_note)
- `pmr_plan_2026_sheet1`: PMR schedule with Site_ID, Site_ID_1 (W-prefix), Planned_PMR_Date

### Application Structure
- **Three Main Views** (tabs): NFO ([/app/nfo](app/nfo)), PMR ([/app/pmr](app/pmr)), Analyst ([/app/analyst](app/analyst))
- [app/page.tsx](app/page.tsx) redirects to `/nfo` by default
- [components/AppHeaderTabs.tsx](components/AppHeaderTabs.tsx): Navigation preserves `?site=` param across views
- [components/AuthProvider.tsx](components/AuthProvider.tsx): Anonymous auth context with profile modal (user must enter full_name on first use)

## Development Patterns

### URL State Management
Use [lib/urlUtils.ts](lib/urlUtils.ts) helpers for all URL parameter handling:
```typescript
const site = getParam(searchParams, 'site', '');
setParams(router, pathname, searchParams, { site: 'W1234', tab: 'All' });
```
Pattern: Extract initial values from URL → maintain local state → debounce → update URL → fetch data. Enables back/forward navigation.

### Site ID Normalization
Sites have dual formats: `W2470` (canonical) and `2470` (digits only). Use these helpers from [components/NFOView.tsx](components/NFOView.tsx):
```typescript
const normalizeInputToDigits = (input: string): string => input.trim().replace(/\D/g, '');
const getCanonicalFromDigits = (digits: string): string => digits ? `W${digits}` : '';
```
Always store canonical `W` format in database, but support searching both formats.

### Image Upload Flow
1. **Client-side compression**: [lib/imageCompress.ts](lib/imageCompress.ts) iteratively reduces quality/dimensions until ≤100KB
2. **Upload via multipart**: POST to [/app/api/r2/upload/route.ts](app/api/r2/upload/route.ts) with FormData (file, siteId, rowId, kind: 'serial'|'tag')
3. **Storage path**: `sites/{safeSiteId}/{rowId}/{kind}.jpg` in R2
4. **Update DB**: Write public URL to `serial_pic_url` or `tag_pic_url` in main_inventory using [lib/mainInventory.ts](lib/mainInventory.ts)

Alternative: Presigned URLs via [/app/api/r2/presign/route.ts](app/api/r2/presign/route.ts) for client-direct uploads.

### Database Operations
- **Client queries**: Use [lib/supabaseClient.ts](lib/supabaseClient.ts) with NEXT_PUBLIC keys (anon role)
- **Server-only**: Use SUPABASE_SERVICE_ROLE_KEY in API routes for elevated permissions
- **Updates**: Call `updateMainInventoryRow(id, patch)` from [lib/mainInventory.ts](lib/mainInventory.ts)
- **Views**: Prefer views like `v_main_inventory_audit` for computed fields (e.g., creator names)

### Cascading Dropdowns
[components/NFOView.tsx](components/NFOView.tsx) loads `helper_catalog` into Maps at mount:
- Select category → filter equipment_types by category
- Select equipment_type → filter product_names by `${category}|${equipment_type}`
- Select product_name → filter product_numbers by `${category}|${equipment_type}|${product_name}`

Reset downstream fields when upstream changes (e.g., changing category clears equipment_type, product_name, product_number).

### Component State Patterns
Large view components (NFO, PMR, Analyst) use extensive useState for:
- Search/filter inputs with debounce (300-500ms)
- Inline editing with draft/original row tracking
- Modal states (add new, image preview)
- Loading/error states per operation

Example: Editing in NFOView:
```typescript
setEditingRowId(row.id);
setDraftRow({ ...row });
setOriginalRow({ ...row });
// User modifies draftRow via inputs
// On save: updateMainInventoryRow(editingRowId, draftRow)
```

## Environment Variables
Required in `.env.local`:
```bash
# Supabase (public)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Supabase (server-only)
SUPABASE_SERVICE_ROLE_KEY=

# Cloudflare R2
R2_ACCOUNT_ID=
R2_BUCKET=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_BASE_URL=
```

## Commands
```bash
npm run dev      # Start dev server on localhost:3000
npm run build    # Production build
npm run lint     # ESLint check
```

## Common Tasks

### Adding a New View
1. Create page in `app/{name}/page.tsx`
2. Create component in `components/{Name}View.tsx`
3. Add tab to [components/AppHeaderTabs.tsx](components/AppHeaderTabs.tsx)
4. Follow URL state pattern from existing views

### Adding a Database Table Helper
1. Query at component mount via useEffect
2. Store in useState (array or Map for lookups)
3. Handle loading/error states
4. Example: [components/NFOView.tsx](components/NFOView.tsx) lines 183-263 (catalog, tag_category_helper, photo_category_helper)

### Debugging Auth Issues
Check [components/AuthProvider.tsx](components/AuthProvider.tsx):
- Anonymous auth auto-triggers if no session
- Profile modal appears if nfo_profiles row missing
- User context available via `useAuth()` hook

## Code Style
- **Imports**: Use `@/` path alias for all imports
- **Components**: 'use client' directive for all components (App Router default is server)
- **TypeScript**: Strict mode, explicit interfaces for DB rows
- **Tailwind**: Utility-first, responsive classes (sm:, md:, lg:)
- **Errors**: console.error + user-friendly alert/toast, never silent failures
