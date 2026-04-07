const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { Pool } = require("pg");

async function initDb(options) {
  const { databaseUrl, databasePath } = options;

  if (databaseUrl) {
    return initPostgresDb(databaseUrl);
  }

  return initSqliteDb(databasePath);
}

async function initSqliteDb(databasePath) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = await open({
    filename: databasePath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS photo_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      score INTEGER NOT NULL,
      shot_at_text TEXT NOT NULL,
      location_text TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reset_requests (
      group_id TEXT PRIMARY KEY,
      requested_by_user_id TEXT NOT NULL,
      requested_by_name TEXT NOT NULL,
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reset_approvals (
      group_id TEXT NOT NULL,
      approved_by_user_id TEXT NOT NULL,
      approved_by_name TEXT NOT NULL,
      approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, approved_by_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_photo_entries_group_score
      ON photo_entries (group_id, score DESC, created_at ASC);
  `);

  return createStore({
    kind: "sqlite",
    queryOne: (sql, params = []) => db.get(sql, params),
    queryAll: (sql, params = []) => db.all(sql, params),
    run: (sql, params = []) => db.run(sql, params),
    close: () => db.close()
  });
}

async function initPostgresDb(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? false
      : {
          rejectUnauthorized: false
        }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS photo_entries (
      id BIGSERIAL PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      message_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      score INTEGER NOT NULL,
      shot_at_text TEXT NOT NULL,
      location_text TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reset_requests (
      group_id TEXT PRIMARY KEY,
      requested_by_user_id TEXT NOT NULL,
      requested_by_name TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reset_approvals (
      group_id TEXT NOT NULL,
      approved_by_user_id TEXT NOT NULL,
      approved_by_name TEXT NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, approved_by_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_photo_entries_group_score
      ON photo_entries (group_id, score DESC, created_at ASC);
  `);

  return createStore({
    kind: "postgres",
    queryOne: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return result.rows[0];
    },
    queryAll: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    run: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return { changes: result.rowCount || 0 };
    },
    close: () => pool.end()
  });
}

function createStore(driver) {
  const sql = buildSql(driver.kind);

  return {
    kind: driver.kind,
    close: driver.close,
    async upsertGroupMember({ groupId, userId, displayName }) {
      await driver.run(sql.upsertGroupMember, [groupId, userId, displayName]);
    },
    async savePhotoEntry(entry) {
      await driver.run(sql.insertPhotoEntry, [
        entry.groupId,
        entry.userId,
        entry.displayName,
        entry.messageId,
        entry.title,
        entry.score,
        entry.shotAtText,
        entry.locationText,
        entry.summary
      ]);
    },
    async getTopRankings(groupId, limit = 5) {
      return driver.queryAll(sql.getTopRankings(limit), [groupId]);
    },
    async getRankingPosition(groupId, messageId) {
      const rows = await driver.queryAll(sql.getTopRankings(100), [groupId]);
      return rows.findIndex((row) => row.messageId === messageId) + 1;
    },
    async createResetRequest({ groupId, requestedByUserId, requestedByName }) {
      await driver.run(sql.deleteResetApprovalsByGroup, [groupId]);
      await driver.run(sql.upsertResetRequest, [groupId, requestedByUserId, requestedByName]);
      return driver.queryOne(sql.getResetRequest, [groupId]);
    },
    async getResetRequest(groupId) {
      return driver.queryOne(sql.getResetRequest, [groupId]);
    },
    async approveReset({ groupId, approvedByUserId, approvedByName }) {
      const request = await driver.queryOne(sql.getResetRequest, [groupId]);

      if (!request) {
        return { status: "missing" };
      }

      if (request.requestedByUserId === approvedByUserId) {
        return { status: "self_approval_blocked", request };
      }

      await driver.run(sql.insertResetApproval, [groupId, approvedByUserId, approvedByName]);
      const approvalCountRow = await driver.queryOne(sql.getResetApprovalCount, [groupId]);
      const approvalCount = Number(approvalCountRow?.approvalCount || approvalCountRow?.approval_count || 0);

      if (approvalCount < 1) {
        return { status: "pending", request, approvalCount };
      }

      await driver.run(sql.deletePhotoEntriesByGroup, [groupId]);
      await driver.run(sql.deleteResetApprovalsByGroup, [groupId]);
      await driver.run(sql.deleteResetRequestByGroup, [groupId]);

      return { status: "completed", request, approvalCount };
    }
  };
}

function buildSql(kind) {
  const useDollar = kind === "postgres";
  const p = (index) => (useDollar ? `$${index}` : "?");

  return {
    upsertGroupMember: `
      INSERT INTO group_members (group_id, user_id, display_name, updated_at)
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${currentTimestamp(kind)})
      ${useDollar ? "ON CONFLICT (group_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()" : "ON CONFLICT(group_id, user_id) DO UPDATE SET display_name = excluded.display_name, updated_at = CURRENT_TIMESTAMP"}
    `,
    insertPhotoEntry: `
      INSERT INTO photo_entries (
        group_id,
        user_id,
        display_name,
        message_id,
        title,
        score,
        shot_at_text,
        location_text,
        summary
      )
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)})
    `,
    getTopRankings: (limit) => `
      SELECT
        id,
        group_id AS "groupId",
        user_id AS "userId",
        display_name AS "displayName",
        message_id AS "messageId",
        title,
        score,
        shot_at_text AS "shotAtText",
        location_text AS "locationText",
        summary,
        created_at AS "createdAt"
      FROM photo_entries
      WHERE group_id = ${p(1)}
      ORDER BY score DESC, created_at ASC
      LIMIT ${limit}
    `,
    upsertResetRequest: `
      INSERT INTO reset_requests (group_id, requested_by_user_id, requested_by_name, requested_at)
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${currentTimestamp(kind)})
      ${useDollar ? "ON CONFLICT (group_id) DO UPDATE SET requested_by_user_id = EXCLUDED.requested_by_user_id, requested_by_name = EXCLUDED.requested_by_name, requested_at = NOW()" : "ON CONFLICT(group_id) DO UPDATE SET requested_by_user_id = excluded.requested_by_user_id, requested_by_name = excluded.requested_by_name, requested_at = CURRENT_TIMESTAMP"}
    `,
    getResetRequest: `
      SELECT
        group_id AS "groupId",
        requested_by_user_id AS "requestedByUserId",
        requested_by_name AS "requestedByName",
        requested_at AS "requestedAt"
      FROM reset_requests
      WHERE group_id = ${p(1)}
    `,
    insertResetApproval: `
      INSERT INTO reset_approvals (group_id, approved_by_user_id, approved_by_name, approved_at)
      VALUES (${p(1)}, ${p(2)}, ${p(3)}, ${currentTimestamp(kind)})
      ${useDollar ? "ON CONFLICT (group_id, approved_by_user_id) DO UPDATE SET approved_by_name = EXCLUDED.approved_by_name, approved_at = NOW()" : "ON CONFLICT(group_id, approved_by_user_id) DO UPDATE SET approved_by_name = excluded.approved_by_name, approved_at = CURRENT_TIMESTAMP"}
    `,
    getResetApprovalCount: `
      SELECT COUNT(*) AS "approvalCount"
      FROM reset_approvals
      WHERE group_id = ${p(1)}
    `,
    deleteResetApprovalsByGroup: `
      DELETE FROM reset_approvals
      WHERE group_id = ${p(1)}
    `,
    deleteResetRequestByGroup: `
      DELETE FROM reset_requests
      WHERE group_id = ${p(1)}
    `,
    deletePhotoEntriesByGroup: `
      DELETE FROM photo_entries
      WHERE group_id = ${p(1)}
    `
  };
}

function currentTimestamp(kind) {
  return kind === "postgres" ? "NOW()" : "CURRENT_TIMESTAMP";
}

module.exports = {
  initDb
};
