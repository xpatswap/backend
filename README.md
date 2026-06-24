# Xpatswap Backend

A complete REST + real-time API for Xpatswap: auth with email OTP verification,
vendor KYC (CAC/NIN review + admin approval), brand/category folder browsing,
listings with fairness scoring, state-wide communities (all 36 states + FCT),
a unified private-message inbox, voice/video call signaling, likes/ranking,
notifications, and moderation/reporting.

Stack: **Node.js + Express + PostgreSQL (via Prisma) + Socket.IO + JWT auth**

> **The frontend is already wired to call this API.** Open the frontend's
> `index.html` directly in a browser (no build step needed), and as long as
> this backend is running at `http://localhost:4000`, registration, login,
> listings, communities, and chat all hit real endpoints instead of using
> in-memory demo data. If you deploy this backend elsewhere, update
> `window.XPATSWAP_API_URL` near the top of the frontend's `<script>` tag,
> and set `CLIENT_ORIGIN` below to match wherever the frontend is served from.

---

## What this covers (mapped to the frontend prototype)

| Frontend feature | Backend support |
|---|---|
| Registration, email OTP, login | /auth/* - real bcrypt password hashing, real OTP via SMTP email |
| Vendor CAC/NIN upload + name matching | /vendor/docs - uploads to S3-compatible storage, server-side name validation |
| Admin approval queue | /admin/* - separate admin auth, approve/reject with email notification |
| Brand New folder/sub-folder browsing | /listings/brands - full Apple/Samsung/etc. catalog with live counts |
| Listings, condition, repair disclosure | /listings - enforces repair checklist requirement for Refurbished items |
| Ranking (likes + swaps) | /listings/ranking |
| 36 states + FCT communities | seeded automatically, /communities/* |
| Reply-privately from group -> Inbox | /threads/from-group-reply |
| "Propose swap" listing chat -> Inbox | /threads/from-listing-chat |
| Xpatswap Admin support thread | /threads/support |
| Real-time message delivery | Socket.IO rooms (community:<id>, user:<id>) |
| Voice/video calls | /calls/* + WebRTC signaling relay over sockets |
| Seller shop pages (no phone shown) | /sellers/:userId |
| Search by phone or business name | q param on /listings, matches model + vendor business name |

---

## Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or use the included docker-compose.yml)
- An SMTP provider for real OTP emails (SendGrid, Resend, Mailgun, AWS SES)
- An S3-compatible storage bucket (AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, or local MinIO for dev)

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Start a local database (optional)
```bash
docker compose up -d
```

### 3. Configure environment
```bash
cp .env.example .env
```
Fill in DATABASE_URL, JWT secrets, SMTP credentials, and S3 credentials. Without
real SMTP/S3 configured locally, the app degrades gracefully:
- No SMTP -> OTP codes are logged to the console instead of emailed
- No S3 -> file uploads throw a clear error (storage is required for vendor docs and listing photos)

### 4. Run database migrations
```bash
npx prisma migrate dev --name init
```

Then apply the manual support-thread uniqueness fix:
```bash
psql "$DATABASE_URL" -f prisma/migrations/manual_fixes/001_support_thread_unique.sql
```

### 5. Seed the database
```bash
npm run seed
```
Creates:
- All 9 brand folders (Apple, Samsung, Infinix, Tecno, Itel, Redmi, Oppo, Vivo, Honor) with sub-category folders
- All 37 communities (36 states + FCT)
- A default admin: admin@xpatswap.com / ChangeMe123! - change this immediately in production

### 6. Run the server
```bash
npm run dev      # auto-reload (nodemon)
npm start        # production
```

API live at http://localhost:4000/api. Health check: GET /api/health.

---

## Project structure

```
src/
  config/        env loader, Prisma client singleton
  controllers/   business logic per feature area
  routes/        Express route definitions
  middleware/    auth, admin auth, validation, file upload, error handling
  services/      email (SMTP) and file storage (S3) integrations
  sockets/       Socket.IO real-time layer
  utils/         JWT/password/OTP helpers, custom errors, Joi validators
  app.js         Express app assembly
  server.js      entrypoint (HTTP server + Socket.IO)
prisma/
  schema.prisma            full database schema
  seed.js                  brands/categories/communities/admin seed data
  migrations/manual_fixes/ hand-written SQL for edge cases Prisma can't express
```

---

## Security notes

- Passwords and refresh tokens are bcrypt/SHA-256 hashed, never stored in plaintext.
- OTP codes are hashed and rate-limited (max attempts + resend cooldown).
- Admin auth uses a separate JWT audience from regular users, so a compromised
  user session can never reach /admin/* routes.
- File uploads are validated by MIME type and size before reaching storage.
- Helmet + CORS + global rate limiting applied by default.
- Before production: rotate JWT secrets to long random values, change the seeded
  admin password, and restrict CLIENT_ORIGIN to your real frontend domain.

---

## IMEI ownership transfer

A seller can optionally link one of their registered devices (My Devices / IMEI checker) to a listing when posting it. When that listing sells and the order is released (seller enters the buyer's handoff code), ownership of the `Device` record automatically transfers to the buyer — recorded permanently in `DeviceOwnershipTransfer`, so a device's full chain of legitimate owners is always reconstructable (`GET /devices/:id/ownership-history`).

This means a phone's IMEI registration follows real, proven sales automatically — no manual re-registration needed, and the stolen-device registry stays accurate as phones legitimately change hands through the app. A device can only be linked to one active listing at a time, and stolen devices can't be listed at all.

## Wallet, escrow & in-app payments

Every transaction is forced through the app to prevent off-platform fraud:

1. Buyer deposits money into their Xpatswap wallet (`POST /wallet/deposits`)
2. Buyer creates an order for a listing (`POST /orders`) and pays (`POST /orders/:id/pay`) — funds move into **escrow**, not directly to the seller. The buyer is shown a one-time 6-digit handoff code in this response (never recoverable afterward — see `getHandoffCode`'s deliberate `CODE_NOT_RECOVERABLE` response).
3. Seller ships/delivers the device in person
4. At physical handoff, the buyer shows/tells the seller their code. The **seller** enters it (`POST /orders/:id/release { code }`) — **this is the only action that releases escrowed funds**, and it's rate-limited to 5 attempts before the order auto-locks into DISPUTED for admin review. This proves the buyer was actually present/approved the handoff, rather than relying on a tap-to-confirm either party could trigger by mistake.
5. Seller withdraws to their real bank account (`POST /wallet/payouts`)

If something goes wrong before release, either party can dispute (`POST /orders/:id/dispute`), which freezes the order for admin review (`GET /admin/orders?status=DISPUTED`, `POST /admin/orders/:id/resolve`).

**Current mode: MANUAL.** No real payment processor (Paystack, Flutterwave, etc.) is connected yet — this is a deliberate, safe starting point:
- Deposits show the buyer your business bank account details; they transfer manually, then an admin confirms it arrived (`GET /admin/deposits?status=PENDING`, `POST /admin/deposits/:id/confirm`) before the wallet is credited.
- Payouts work the same way in reverse — admin sends the real transfer themselves, then marks it paid.
- This avoids holding real customer funds through unlicensed custom infrastructure. See `src/services/paymentProviderService.js` for where to plug in a real licensed provider later — the wallet/escrow logic itself (`src/services/walletService.js`) never needs to change, only this one file.

**Important:** holding and moving customer money is a regulated activity in Nigeria (CBN licensing). Manual mode keeps you out of that territory since no money moves through code — but if you scale this beyond informal/manual reconciliation, talk to a licensed PSP (Paystack, Flutterwave, Korapay, Anchor) about their virtual account / wallet APIs rather than continuing to hold funds yourself.

## Intentionally out of scope

- TURN/STUN server for WebRTC - calls need this for reliable cross-network
  connections. Use a managed service (Twilio, Daily, Agora) or self-host coturn.
- Push notifications (FCM/APNs) - the Notification model is ready; actual push
  delivery is a follow-up integration.
- Payments/escrow - not part of the current frontend, so not modeled yet.
- Admin dashboard UI - the admin API is complete; no frontend was requested for it.
