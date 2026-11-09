# Inkcadence backend

Node 18+ · Express · PostgreSQL. The same code runs as a long-lived server on a
VPS and as a serverless function on Vercel.

> **Status: exercised locally, never deployed.** The API and the browser storage
> adapter were both run against an in-memory PostgreSQL: `npm test` passes 81
> assertions, and the server was booted and driven over HTTP. Nothing here has
> been run against a real PostgreSQL server, Docker, a VPS or Vercel yet.

The static app keeps working without any of this. The frontend only talks to the
API when it is reachable.

## Layout

```
server/app.js          express app: CORS, headers, routes, static, errors
server/index.js        VPS entry point (listens on PORT)
server/db.js           pg pool, query helpers, transactions
server/migrate.js      runs server/migrations/*.sql in order, once each
server/auth.js         signup, login, logout, me, session middleware
server/packs.js        style pack CRUD, scoped to the owner
server/security.js     scrypt hashing, session tokens
server/validate.js     input validation, ApiError
server/ratelimit.js    in-memory sliding window
server/memory-db.js    in-memory Postgres, for `npm run dev`
server/dev.js          dev launcher: in-memory database, localhost only
api/index.js           serverless entry point for Vercel
test/api.test.js       end-to-end API checks (53 assertions)
test/frontend.test.js  storage adapter against the live API (28 assertions)
```

## Try it in one minute

You need Node 18+ and nothing else — no database server to install:

```bash
npm install
npm run dev
```

Open <http://localhost:8080>. That runs the real server against an in-memory
PostgreSQL, created and migrated on startup. Everything is lost when the process
stops, so it is for looking around rather than for keeping work.

To check the backend without opening a browser:

```bash
npm test
```

81 assertions run against the live API and the browser storage adapter: token
auth, cookie auth, ownership isolation, validation limits, CORS preflight, and
the fallback to on-device storage. Still no database server needed.

## Run it locally with Docker

```bash
cp .env.example .env
docker compose up --build
```

Then open <http://localhost:8080>. The database is created and migrated on
startup.

## Run it locally without Docker

You need Node 18+ and a Postgres database (a free Neon or Supabase project works
fine — paste its connection string into `DATABASE_URL`).

```bash
npm install
cp .env.example .env
npm run migrate
npm start
```

`npm run dev` restarts on file changes.

## Configuration

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Required. |
| `PORT` | Listen port. Default `8080`. |
| `CORS_ORIGIN` | Comma-separated browser origins allowed to call the API. Set this when the HTML is served somewhere else, for example the GitHub Pages build. |
| `COOKIE_SECURE` | `1` on HTTPS sites, so the session cookie is `Secure`. |
| `SESSION_DAYS` | Login lifetime in days. Default `30`. |
| `PG_POOL_MAX` | Pool size. Use `1`–`2` on serverless hosts. |

## API

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | no | checks the database |
| POST | `/api/auth/signup` | no | `{ username, password, displayName? }` |
| POST | `/api/auth/login` | no | `{ username, password }` |
| POST | `/api/auth/logout` | no | clears the cookie and the session row |
| GET | `/api/auth/me` | no | `{ user: null }` when signed out |
| GET | `/api/packs` | yes | summaries; add `?include=data` for full packs |
| POST | `/api/packs` | yes | `{ name, data }` |
| GET | `/api/packs/:id` | yes | full pack |
| PATCH | `/api/packs/:id` | yes | `{ name?, data? }` |
| DELETE | `/api/packs/:id` | yes | |

Errors are always `{ "error": { "code": "...", "message": "..." } }`.

A signed-in request carries either the session cookie **or** an
`Authorization: Bearer <token>` header. Send `X-Session-Mode: token` when signing
up or logging in and the token comes back in the JSON body instead of a cookie —
that is what the GitHub Pages build does.

## Smoke test

With the server on `localhost:8080`:

```bash
curl -s localhost:8080/api/health

curl -s -c jar.txt -X POST localhost:8080/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"username":"demo","password":"correct-horse"}'

curl -s -b jar.txt localhost:8080/api/auth/me

curl -s -b jar.txt -X POST localhost:8080/api/packs \
  -H 'content-type: application/json' \
  -d '{"name":"My hand","data":{"slant":-4,"ink":"#1b2a4a"}}'

curl -s -b jar.txt localhost:8080/api/packs
```

The last four should never return 401 — if they do, the cookie is not being
stored or sent.

To test the token path the Pages build uses, add `-H 'X-Session-Mode: token'` to
the signup call and pass `-H "Authorization: Bearer <token from the response>"`
on the requests that follow.

## Deploy: HTML on GitHub Pages, API elsewhere

This is the layout the project uses. The page is served from
`https://mafzalkalwardev.github.io/inkcadence/` and the API runs on a VPS or
Vercel at a different origin.

**Sessions use a bearer token here, not a cookie.** A cookie set by your API
domain is a third-party cookie on the Pages origin — browsers block it, and
`SameSite=Lax` would stop it being sent at all. So the client asks for a token
with the `X-Session-Mode: token` header, keeps it in `localStorage`, and sends
`Authorization: Bearer <token>` on every call.

1. Deploy the API (see the VPS or Vercel section below).
2. Set `CORS_ORIGIN=https://mafzalkalwardev.github.io` in the API environment.
   Without it the browser blocks every request from the page.
3. Edit `js/config.js` and set `apiBase` to your API origin, no trailing slash:
   ```js
   apiBase: 'https://api.yourdomain.com',
   ```
4. Commit and push. GitHub Pages redeploys and the app switches to server mode.

The login card tells you which mode is active. If it says the server could not be
reached, the page silently falls back to on-device storage — check the browser
console, then `CORS_ORIGIN` and `apiBase`, in that order.

**Trade-off worth knowing:** a token in `localStorage` can be read by any script
running on the Pages origin. Cookies marked `HttpOnly` cannot. That is the cost of
a split origin; serving the HTML from the API's own origin avoids it and uses
cookies instead.

## Deploy: VPS

```bash
git clone https://github.com/mafzalkalwardev/inkcadence.git
cd inkcadence
cp .env.example .env      # then edit it
docker compose up -d --build
```

Put nginx or Caddy in front for TLS, proxy to port 8080, and set
`COOKIE_SECURE=1`. Keep `assets/concepts`, `logo-options.html` and `publish.cmd`
out of the image — `.dockerignore` already does.

## Deploy: Vercel

1. Import the repository at vercel.com.
2. Add `DATABASE_URL` (use a pooled Neon/Supabase URL), `COOKIE_SECURE=1`, and
   `CORS_ORIGIN` in Project Settings → Environment Variables.
3. Deploy. Vercel serves the HTML, `js/` and `assets/` from its CDN and routes
   `/api/*` to `api/index.js`.
4. Run the migration once, from a machine that can reach the database:
   `DATABASE_URL=... npm run migrate`.

On a serverless host keep `PG_POOL_MAX` at 1–2 and use a connection pooler.

## Security notes

- Passwords are hashed with `scrypt` from Node's standard library, with a random
  per-user salt. The format is `scrypt$N$r$p$salt$key`.
- Session tokens are 32 random bytes. Only their SHA-256 hash is stored, so a
  database leak does not hand over live sessions.
- Session cookies are `HttpOnly` and `SameSite=Lax`, and `Secure` when
  `COOKIE_SECURE=1`.
- Every style pack query is scoped by `user_id` in SQL, so a guessed id cannot
  reach another account's row.
- Login and signup are rate limited per IP. The limiter is per-process, not
  shared — see the note in `server/ratelimit.js`.
- Login does the same work whether or not the username exists, and returns one
  message for both cases.

## Known gaps

- No password reset and no email verification — there is no mail sender wired up.
- No per-user storage quota beyond the 4 MB per-pack cap.
- The rate limiter is not shared between processes or instances.
