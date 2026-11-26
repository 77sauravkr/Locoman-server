# LocoMan Server

API for LocoMan, an AI travel guide with text and voice chat.
Client: https://github.com/77sauravkr/locoMan-client

Express, MongoDB (Mongoose), Google Gemini (chat, photos, speech-to-text).

## Architecture

Diagrams, data model, decisions, security notes and roadmap: [ARCHITECTURE.md](ARCHITECTURE.md).

## Run locally

Needs Node 20+, MongoDB and a Gemini API key (https://aistudio.google.com/apikey).

```bash
npm install
cp .env.example .env   # fill in JWT_SECRET and GEMINI_API_KEY
npm run dev            # http://localhost:10000
npm test               # needs MongoDB; the AI is faked, no key or cost
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | 200 when the database is connected |
| POST | `/api/auth/register`, `/login`, `/logout` | Session in an HTTP-only cookie |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/reset`, `/google`, `/password`, `/recovery-code` | Recovery, Google sign-in, account changes |
| DELETE | `/api/auth/account` | Delete the account and its data |
| various | `/api/trips` | Itineraries, group invites, expenses |
| POST | `/api/trips/generate`, `/recommend`, `/:id/revise`, `/:id/packing` | AI plan, destination ideas, AI changes, packing list |
| GET | `/api/places/weather`, `/locate` | Weather (Open-Meteo) and map lookup (OpenStreetMap) |
| GET | `/api/chats` | List chats |
| GET, PATCH, DELETE | `/api/chats/:chatId` | Read, rename, delete |
| POST | `/api/chats/:chatId/messages` | `{ text, image?, location? }`, reply streamed as Server-Sent Events |
| POST | `/api/chats/:chatId/voice` | Multipart field `audio` (max 10 MB) |

## Deploy (Vercel or Render)

Set `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (32+ characters) and `GEMINI_API_KEY`.
The server refuses to start if any of the last three is missing. Health check path: `/api/health`.

The client calls this API through a same-origin `/api` rewrite, so no CORS setting is needed.

## Safeguards

- The Gemini key stays on the server. Photos and location are used for one reply and not stored.
- Password hashing (bcrypt), login and message rate limits.
- Daily AI limits per user (`USER_DAILY_LIMIT`) and overall (`GLOBAL_DAILY_LIMIT`).
- Audio is processed in memory and never written to disk.
