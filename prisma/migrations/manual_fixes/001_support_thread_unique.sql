-- Run this AFTER your first `npx prisma migrate dev`, either by adding it to a
-- new migration folder or executing directly against the database.
--
-- Purpose: guarantees a user can never end up with two "Xpatswap Admin" support
-- threads, even under concurrent requests. Prisma's @@unique constraint on Thread
-- does not catch this case because Postgres treats NULL as distinct in unique
-- indexes, and SUPPORT threads have userBId = NULL.

CREATE UNIQUE INDEX IF NOT EXISTS thread_support_unique
  ON "Thread" ("userAId")
  WHERE "sourceType" = 'SUPPORT';
