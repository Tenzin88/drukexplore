# DrukExplore – Discover Bhutan. Experience the Extraordinary.

Full-stack tourism app: HTML/CSS/vanilla JS frontend, Node.js + Express backend, SQLite database,
JWT authentication, Socket.IO real-time chat, and a RAG travel assistant.

## 1. Run locally
```
npm install
cp .env.example .env      # set JWT_SECRET and AI_API_KEY
npm start                 # http://localhost:3000
```
Without `AI_API_KEY` the assistant still retrieves from the knowledge base and shows the retrieved text (no LLM wording).

## 2. Architecture
| Layer | Technology | Role |
|---|---|---|
| Frontend | `public/*.html`, `style.css`, `js/common.js` | Pages, DOM rendering, validation, animations |
| API | Express (`server.js`) | Auth, destinations, chat history, AI route |
| Database | SQLite (`drukexplore.db`) | `users`, `messages`, `destinations` tables |
| Auth | bcrypt password hashes + signed JWT (7 days) | Server verifies the token on every protected API call and socket connection |
| Real-time chat | Socket.IO | Server saves each message, then broadcasts to every connected user |
| RAG | `rag.js` + `knowledge-base/*.json` | Retrieve, then generate from context only |

## 3. RAG process
1. Load every entry in `knowledge-base/` as a chunk (destinations, festivals, travel rules, tourism info, FAQ).
2. Tokenize the question (lowercase, stop-words removed, light plural stemming).
3. Score chunks with TF-IDF (rare words weigh more), normalised by chunk length.
4. If 50% or fewer of the question's key terms appear in the knowledge base, return the "not found" message **without calling the AI**.
5. Otherwise send the top 3 chunks to the model with a system prompt that forbids outside facts.
6. Return the answer and the source titles. The API key stays on the server (`.env`).

## 4. API
`POST /api/auth/signup` · `POST /api/auth/login` · `GET /api/auth/me` · `GET /api/destinations[/:id]` ·
`GET /api/chat/messages` (auth) · `POST /api/ai/ask` (auth). Chat messages are sent over the Socket.IO `message` event.

## 5. Four-user demo
Register Tashi, Pema, Sonam and Karma (e.g. tashi@example.com) through the Sign Up page, then sign in on four browsers/incognito windows/devices and open **Chat**.
Assistant tests: "What attractions can I visit in Paro?" (answered, with sources) and "What is the capital of Japan?" (refused).

## 6. Deploy (Render)
Create a Web Service from the repo: build `npm install`, start `npm start`. Add env vars `JWT_SECRET`, `AI_API_KEY`, `AI_MODEL`.
Frontend and backend deploy together because Express serves `public/`. Free tiers have ephemeral disks: add a persistent disk and set `DB_PATH` to it, or the database resets on redeploy.

## 7. Test checklist
Auth: valid/invalid signup, duplicate email, valid/invalid login, sign out, open `app.html` while signed out (redirects).
Chat: four users send, all see messages instantly with names and times; empty message rejected.
RAG: in-scope question answered; out-of-scope refused. Responsive: check at 1200, 768 and 375 px.

## 8. Known limitations
Keyword retrieval (no embeddings); single chat room; knowledge-base facts like visa fees and the SDF change, so verify against official Bhutan tourism sources before relying on them; destination cards use colour panels instead of photos (add images under `public/`).
