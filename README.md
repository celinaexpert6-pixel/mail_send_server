# Claim Form Server

Node.js server that receives claim form submissions from the theme’s claim form, **sends each submission to a specific email** via Resend, and optionally stores them in PostgreSQL.

## Setup

1. **Install dependencies**
   ```bash
   cd server
   npm install
   ```

2. **Copy environment file**
   ```bash
   cp .env.example .env
   ```

3. **Resend (to send claims to your email)**
   - Sign up at [resend.com](https://resend.com) and create an API key.
   - In `.env` set:
     - `RESEND_API_KEY=re_xxx...`
     - `CLAIM_FORM_EMAIL=your@email.com` (the address that receives every claim)
   - Optional: `RESEND_FROM_EMAIL` and `RESEND_FROM_NAME` for the “From” address (use `onboarding@resend.dev` for testing; verify your domain for production).
   - If both are set, every claim is emailed to `CLAIM_FORM_EMAIL` with a formatted HTML table of items.

4. **Optional: PostgreSQL**
   - To also store claims in a database, set `DATABASE_URL` in `.env` and run `npm run init-db` to create tables. If `DATABASE_URL` is not set, the server runs in **email-only mode** (no database required).

5. **Run the server**
   ```bash
   npm start
   ```
   For development with auto-reload: `npm run dev`

## Theme configuration

In the Shopify theme editor, open the Claim Form section and set **Claim form API URL** to your server base URL (e.g. `https://your-server.com` or `http://localhost:3000` for testing). The form will POST to `{API_URL}/api/claims`.

## API

- **POST /api/claims**  
  Body: `application/x-www-form-urlencoded` (or JSON) with:
  - `contact[date]`, `contact[company_name]`, `contact[customer_id]`
  - `contact[item_1_style_no]`, `contact[item_1_description]`, … (one set per row)
  - Optional: `success_url` – if present and valid, server responds with 302 redirect to this URL.

  On success: 201 + JSON `{ success: true, claim_id: number | string }`.  
  On error: 400/500/503 + JSON `{ error: "message" }`.

- **GET /api/health**  
  Returns `{ ok: true, database: true|false }`.

## Deployment

The server is a standard Node.js app: set `PORT` and env vars, then run `npm start`. Deploy to any platform that runs Node.

### Option 1: Railway

1. Push your code to GitHub (e.g. put the `server` folder at the repo root, or in a `server` subfolder).
2. Go to [railway.app](https://railway.app) → **Start a New Project** → **Deploy from GitHub** and select the repo.
3. Set the **root directory** to `server` if the app is in a `server` subfolder.
4. In the service → **Variables**, add:
   - `RESEND_API_KEY` = your Resend API key  
   - `CLAIM_FORM_EMAIL` = email that receives claims  
   - Optional: `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`, `CLAIM_FORM_ORIGIN`, `DATABASE_URL`
5. Under **Settings** → **Networking** → **Generate Domain** to get a public HTTPS URL (e.g. `https://your-app.up.railway.app`).
6. In the Shopify theme editor, set **Claim form API URL** to that URL.

### Option 2: Render

1. Push your code to GitHub.
2. Go to [render.com](https://render.com) → **New** → **Web Service**, connect the repo.
3. Set **Root Directory** to `server` if needed. **Runtime**: Node. **Build**: `npm install`. **Start**: `npm start`.
4. Under **Environment**, add `RESEND_API_KEY`, `CLAIM_FORM_EMAIL`, and any optional vars.
5. Create the service; Render gives you an HTTPS URL (e.g. `https://your-app.onrender.com`).
6. In the Shopify theme editor, set **Claim form API URL** to that URL.

### After deploy

- Set **Claim form API URL** in the theme to your deployed URL (must be **HTTPS** for Shopify).
- Set **CLAIM_FORM_ORIGIN** (optional) to your Shopify store URL (e.g. `https://your-store.myshopify.com`) to restrict CORS; use `*` only for testing.
- If you use a database, add `DATABASE_URL` in the platform’s env and run `npm run init-db` once (e.g. via a one-off job or locally pointing at the hosted DB).
