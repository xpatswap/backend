# Xpatswap API Reference

Base URL: `http://localhost:4000/api`

Authenticated routes require: `Authorization: Bearer <accessToken>`

Response shape:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "SOME_CODE", "message": "Human readable message" } }
```

---

## Auth

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | /auth/register | - | Create account. Sends OTP email. |
| POST | /auth/verify-otp | - | { userId, code } -> confirms email, returns tokens. |
| POST | /auth/resend-otp | - | { userId } - 30s cooldown. |
| POST | /auth/login | - | { email, password } - fails EMAIL_NOT_VERIFIED if unconfirmed. |
| POST | /auth/refresh | - | { refreshToken } -> rotated token pair. |
| POST | /auth/logout | - | { refreshToken } -> revokes it. |
| GET | /auth/me | yes | Current user + vendor profile. |

accountType: BUYER | SELL_ONLY | SELL_SWAP. The latter two auto-create a VendorProfile shell.

---

## Vendor KYC

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | /vendor/docs | yes | multipart: cacDocument, ninDocument + businessName, cacRegisteredName, ninRegisteredName. NAME_MISMATCH if names don't match. Sets status PENDING. |
| GET | /vendor/status | yes | NONE \| PENDING \| APPROVED \| REJECTED |
| PATCH | /vendor/profile | yes | Update business name/bio/address/email any time. |

Vendors cannot create listings until an admin sets status to APPROVED.

---

## Brands & Listings

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | /listings/brands | optional | Brand -> category folder tree with live counts. |
| GET | /listings?brand=&category=&condition=&q=&page=&pageSize= | optional | Browse/search. |
| GET | /listings/ranking | optional | Sorted by likes*1.5 + swaps*2. |
| GET | /listings/:id?myValue=560 | optional | Pass myValue for a fairness comparison. |
| GET | /listings/:id/seller-other-products | - | Other listings from same seller. |
| POST | /listings | yes (approved vendor) | multipart photos[] (1-6) + brandId, categoryId, name, model, condition, estimatedValue... REFURBISHED requires repairDetails[] or repairNotes. |
| PATCH | /listings/:id | yes (owner) | Update fields. |
| PATCH | /listings/:id/publish | yes (owner) | { published: true/false } |
| DELETE | /listings/:id | yes (owner) | Delete. |
| POST | /listings/:id/like | yes | Toggle like; notifies seller. |

condition enum: BRAND_NEW, UK_USED, NIGERIAN_USED, REFURBISHED.

---

## Communities (state groups)

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | /communities | optional | All 37 groups with member counts + last message. |
| POST | /communities/:id/join | yes | Join a group. |
| GET | /communities/:id/messages | yes | Paginated history. |
| POST | /communities/:id/messages | yes | { text } or { sharedListingId } |
| POST | /communities/:id/messages/media | yes | multipart file (image or audio) |

Join socket room `community:<id>` for live `community:new_message` events.

---

## Threads (unified private inbox)

Private replies from groups, listing-chat conversations, and the Xpatswap Admin support thread — all in one inbox.

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | /threads | yes | Full inbox, sorted by recent activity, with unread counts. |
| GET | /threads/support | yes | Returns/creates the user's Admin support thread. |
| POST | /threads/from-listing-chat | yes | { listingId } -> thread tagged "RE: <model>" |
| POST | /threads/from-group-reply | yes | { communityMessageId, replyText } -> snapshots quoted message |
| GET | /threads/:id/messages | yes | Full history; marks read. |
| POST | /threads/:id/messages | yes | { text } |
| POST | /threads/:id/messages/media | yes | multipart file |
| POST | /threads/:id/location | yes | { latitude, longitude, accuracyM } |

`thread:new_message` is pushed live to `user:<recipientId>`.

---

## Calls

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | /calls | yes | { receiverId, type: VOICE\|VIDEO, threadId? } |
| PATCH | /calls/:id/status | yes | { status: CONNECTED\|DECLINED\|MISSED\|ENDED } |
| GET | /calls/history | yes | Full call history. |

This only handles signaling + logging. Audio/video connects peer-to-peer via WebRTC using `call:signal` socket events to relay SDP/ICE. A STUN/TURN server (e.g. coturn) is needed for reliable connections in production.

---

## Profile & Sellers

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | /profile/me | yes | Full own profile incl. vendor status. |
| PATCH | /profile/me | yes | Update fullName/address. |
| POST | /profile/me/avatar | yes | multipart avatar |
| GET | /sellers/:userId | - | Public shop page. Never exposes a phone number. |

---

## Notifications & Reports

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | /notifications | yes | List. |
| PATCH | /notifications/:id/read | yes | Mark one read. |
| PATCH | /notifications/read-all | yes | Mark all read. |
| POST | /reports | yes | { reportedUserId? or reportedListingId?, reason, details? } |

---

## Admin (separate auth, internal review team)

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | /admin/login | - | { email, password } -> admin token |
| GET | /admin/vendors?status=PENDING | admin | Review queue. |
| GET | /admin/vendors/:id | admin | Single application incl. doc URLs. |
| POST | /admin/vendors/:id/approve | admin | Approves; emails vendor. |
| POST | /admin/vendors/:id/reject | admin | { reason } -> emails vendor. |
| GET | /admin/reports | admin | Moderation queue. |
| PATCH | /admin/reports/:id | admin | { status } |

Admin tokens use a separate JWT audience and middleware — a regular user session can never reach these routes.

---

## Real-time (Socket.IO)

Connect: `io(SERVER_URL, { auth: { token: accessToken } })`

Client -> server: community:join, community:leave, thread:join, thread:leave, thread:typing, call:signal
Server -> client: community:new_message, thread:new_message, thread:typing, call:incoming, call:status_changed, call:signal

---

## Error codes worth knowing

| Code | Meaning |
|---|---|
| EMAIL_NOT_VERIFIED | Login blocked until OTP confirmed |
| OTP_EXPIRED / OTP_MISMATCH / OTP_LOCKED / OTP_COOLDOWN | OTP flow states |
| VENDOR_NOT_APPROVED | Tried to list before approval |
| NAME_MISMATCH | CAC and NIN names don't match |
| NOT_A_VENDOR_ACCOUNT | Tried vendor docs on a BUYER account |
| PHOTOS_REQUIRED | Listing creation without photos |
| TOKEN_EXPIRED | Call /auth/refresh |
