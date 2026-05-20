---
trigger: manual
---

# Arvs Chat App - Project Rules

## Tech Stack
- **Frontend**: React 19 + TypeScript (strict mode)
- **Mobile**: Ionic React 8.5 + Capacitor 8
- **Backend**: Supabase (Auth, Database, Realtime)
- **Build**: Vite
- **Router**: React Router 5
- **Testing**: Vitest (unit) + Cypress (e2e)

## Directory Structure
```
src/
├── components/     # Reusable UI components
├── pages/         # Route-level page components
├── supabaseClient.ts  # Supabase client configuration
├── App.tsx
└── main.tsx
```

## Code Style Guidelines

### TypeScript
- Use strict TypeScript configuration
- Prefer `interface` over `type` for object shapes
- Use explicit return types on exported functions
- Avoid `any` - use `unknown` with type guards instead

### React
- Use functional components with hooks
- Props interface named `{ComponentName}Props`
- Use React.FC sparingly, prefer explicit props typing
- Keep components focused and small (< 200 lines)

### Naming Conventions
- Components: PascalCase (e.g., `ChatMessage.tsx`)
- Hooks: camelCase starting with 'use' (e.g., `useAuth.ts`)
- Utilities: camelCase (e.g., `formatDate.ts`)
- Constants: UPPER_SNAKE_CASE

### Imports
```typescript
// Order: React -> Third-party -> Absolute -> Relative
import { useState } from 'react';
import { IonButton } from '@ionic/react';
import { supabase } from '@/supabaseClient';
import { ChatMessage } from './ChatMessage';
```

## Supabase Best Practices

### Client Setup
- Supabase URL and anon key must be hardcoded for Capacitor mobile builds
- Use `import.meta.env` only for web development

### Auth
- Always use `onAuthStateChange` to listen for auth changes
- Store user session in React Context or state management
- Handle OAuth redirects properly for mobile

### Realtime
- Subscribe to changes in `useEffect` hooks
- Always unsubscribe in cleanup function
- Handle connection errors gracefully

### Database
- Use Row Level Security (RLS) policies
- Create types for database tables in `src/types/database.ts`

## Mobile/Capacitor Specific

### Environment Variables
```typescript
// For mobile APK, hardcode values:
const supabaseUrl = 'https://your-project.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIs...';

// Or use fallback pattern:
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project.supabase.co';
```

### Android Setup
- Package name: `com.arvin.arvs` (update in `capacitor.config.ts`)
- SHA-1 fingerprint required for Google Sign-In
- Run from `arvs/` directory, not parent

### Build Commands
```bash
# Web dev
npm run dev

# Build for mobile
npm run build
npx cap sync android
npx cap open android

# Testing
cd arvs && npm run test.unit
```

## Testing

### Unit Tests (Vitest)
- Co-locate tests with source files: `Component.test.tsx`
- Mock Supabase calls
- Test from `arvs/` directory

### E2E Tests (Cypress)
- Store in `cypress/e2e/`
- Test critical user flows (auth, messaging)

## Security

### Never Commit
- `.env` files
- Service account keys
- Keystore files (`*.keystore`, `*.jks`)

### Environment Variables
```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Git Workflow
- Feature branches: `feature/description`
- Commit messages in present tense: "Add user authentication"
- Squash commits before merging to main

## Common Issues

### Vitest "test is not defined"
→ Run from `arvs/` directory, not parent folder

### Capacitor build fails
→ Ensure `webDir: 'dist'` in `capacitor.config.ts` matches Vite output

### Google Sign-In not working on APK
→ Add SHA-1 fingerprint to Google Cloud Console OAuth credentials

## Performance
- Use React.memo for expensive components
- Lazy load routes with `React.lazy()`
- Optimize images before adding to `public/`
- Use Ionic's virtual scroll for long lists

## Accessibility
- Use semantic HTML elements
- Add `aria-label` to interactive elements
- Ensure color contrast meets WCAG 2.1 AA
- Test with screen readers

