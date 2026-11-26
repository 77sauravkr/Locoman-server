# LocoMan Server

API for LocoMan, an AI travel guide with text and voice chat.
Client: https://github.com/77sauravkr/locoMan-client

Express, MongoDB (Mongoose), OpenAI (chat, speech-to-text, text-to-speech).

## Run locally

Needs Node 20+, MongoDB and an OpenAI API key.

```bash
npm install
cp .env.example .env   # fill in JWT_SECRET and OPENAI_API_KEY
npm run dev            # http://localhost:10000
npm test               # needs MongoDB; the AI is faked, no key or cost
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | 200 when the database is connected |
| POST | `/api/auth/register`, `/login`, `/logout` | Session in an HTTP-only cookie |
| GET | `/api/auth/me` | Current user |
| GET | `/api/chats` | List chats |
| GET, PATCH, DELETE | `/api/chats/:chatId` | Read, rename, delete |
| POST | `/api/chats/:chatId/messages` | `{ text }`, reply streamed as Server-Sent Events |
| POST | `/api/chats/:chatId/voice` | Multipart field `audio` (max 10 MB) |

## Deploy (Render)

Set `NODE_ENV=production`, `MONGODB_URI`, `JWT_SECRET` (32+ characters) and `OPENAI_API_KEY`.
The server refuses to start if any of the last three is missing. Health check path: `/api/health`.

The client calls this API through a same-origin `/api` rewrite, so no CORS setting is needed.

## Safeguards

- OpenAI key stays on the server.
- Password hashing (bcrypt), login and message rate limits.
- Daily AI limits per user (`USER_DAILY_LIMIT`) and overall (`GLOBAL_DAILY_LIMIT`).
- Audio is processed in memory and never written to disk.
