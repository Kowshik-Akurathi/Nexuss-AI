# Nexuss Design Prototype

A standalone, editable high-fidelity replica of the Nexuss **internal (authenticated)** app UI, built for redesign experiments. It ports the real components from the parent repo nearly verbatim (same Tailwind classNames and design tokens) and swaps the backend for mock data.

## Run

```bash
npm install
npm run dev        # http://localhost:5174
```

Other scripts: `npm run typecheck`, `npm run build`, `npm run preview`.

## Stack

Vite 6 · React 19 · TypeScript · Tailwind CSS 3 · zustand. Design tokens live in `src/styles/globals.css` + `tailwind.config.js` (copied from the original app). Default theme is dark; light theme works via the Preferences tab. Font: Inter. Logo: `public/nexuss-logo.png`.

## What's included

- **Sidebar**: search, New chat, Recents, Settings, Log out, workspace/user footer
- **Chat workspace**: markdown messages with syntax highlighting, code blocks, copy/regenerate actions, streaming simulation
- **Composer**: attachment menu, model selector (hosted + local Ollama sections), keyboard-aware layout
- **Settings modal** (all tabs): Preferences, Account (+ delete-account modal), API Keys, Models (provider/model pickers, local providers), Usage
- **Local AI setup**: Ollama detection states (detected / no models / not installed / not running), model pull simulation
- **Terminal workspace panel**: connection states + terminal connection screen (simplified, see below)
- **Modals**: rename chat, delete chat
- **States**: empty chat, streaming, signed-out card (after Log out)
- **Responsive**: mobile drawer sidebar, stacked settings, mobile model picker

## Mocks (no backend)

| Area | Mock |
| --- | --- |
| Chat | `src/store/chatStore.ts` — seeded conversations, simulated token streaming (26 ms/tick), canned replies |
| Local models | `src/store/localModelStore.ts` — one connected Ollama provider + 3 discovered models, simulated pull progress |
| Ollama detection | `src/services/ollamaSetup.ts` — `MOCK_DETECTION_STATE` |
| Terminal | `src/workspace/terminalConnection.ts` — `MOCK_CONNECT_OUTCOME` |
| API keys / account / usage | `src/services/{apiKeys,account,accountData}.ts`, `src/data/mockData.ts` |

Hydration of persisted-looking state (local providers, chats) happens in effects in `src/App.tsx`.

## Not reproduced

- **Agent staging / command execution** inside the terminal panel — `src/components/WorkspacePanel.tsx` is a simplified port (header, status, connection screen, file search only).
- **Landing, marketing, and auth screens** (login/register/onboarding) — out of scope; Log out shows a minimal signed-out card instead.
- **Backend/API calls and real API keys** — everything is local mock data; nothing leaves the browser.
- Real screen-sharing, real Ollama/terminal connectivity, persistence between reloads (state is in-memory).

## Verification

`scripts/shots.mjs` (Playwright, run against the dev server) captures 22 screenshots — desktop 1440×900 and mobile 390×844 — into `scripts/shots/`. `npm run typecheck` and `npm run build` both pass.
