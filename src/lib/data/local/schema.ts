/**
 * On-device schema — a faithful port of prisma/schema.prisma (Chat,
 * Message, ScheduledMessage, AppSetting) to plain SQLite DDL.
 *
 * Conventions:
 *  • DateTime columns are stored as ISO-8601 strings (UTC), matching the
 *    JSON the API already sends to the UI.
 *  • Booleans are stored as SQLite integers (0/1) and converted at the
 *    client boundary.
 *  • Column names and defaults mirror the Prisma models 1:1 so Phase 2 can
 *    swap transports without reshaping data.
 */

export const SCHEMA_VERSION = 1

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "Chat" (
  "id"           TEXT    NOT NULL PRIMARY KEY,
  "title"        TEXT    NOT NULL DEFAULT '',
  "isGroup"      INTEGER NOT NULL DEFAULT 0,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "mediaCount"   INTEGER NOT NULL DEFAULT 0,
  "firstAt"      TEXT,
  "lastAt"       TEXT,
  "lastPreview"  TEXT    NOT NULL DEFAULT '',
  "lastSender"   TEXT,
  "lastType"     TEXT    NOT NULL DEFAULT 'text',
  "sourceFile"   TEXT    NOT NULL DEFAULT '',
  "pinned"       INTEGER NOT NULL DEFAULT 0,
  "archived"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS "Message" (
  "id"            TEXT    NOT NULL PRIMARY KEY,
  "chatId"        TEXT    NOT NULL,
  "idx"           INTEGER NOT NULL,
  "ts"            TEXT    NOT NULL,
  "sender"        TEXT,
  "body"          TEXT    NOT NULL DEFAULT '',
  "type"          TEXT    NOT NULL DEFAULT 'text',
  "mediaPath"     TEXT,
  "mediaName"     TEXT,
  "starred"       INTEGER NOT NULL DEFAULT 0,
  "edited"        INTEGER NOT NULL DEFAULT 0,
  "forwardedFrom" TEXT,
  "pollOptions"   TEXT,
  "pinned"        INTEGER NOT NULL DEFAULT 0,
  "reactions"     TEXT,
  "replyToId"     TEXT,
  FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Message_chatId_idx_idx" ON "Message"("chatId", "idx");
CREATE INDEX IF NOT EXISTS "Message_chatId_ts_idx"  ON "Message"("chatId", "ts");

CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
  "id"        TEXT    NOT NULL PRIMARY KEY,
  "chatId"    TEXT    NOT NULL,
  "body"      TEXT    NOT NULL,
  "sender"    TEXT    NOT NULL DEFAULT 'You',
  "deliverAt" TEXT    NOT NULL,
  "createdAt" TEXT    NOT NULL,
  "status"    TEXT    NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS "ScheduledMessage_chatId_status_idx" ON "ScheduledMessage"("chatId", "status");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_status_deliverAt_idx" ON "ScheduledMessage"("status", "deliverAt");

CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key"       TEXT NOT NULL PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "_meta" (
  "key"   TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL
);
`
