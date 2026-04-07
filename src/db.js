const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { Pool } = require("pg");
const { getDateKey, getLastDateKeys, getWeekStartKey } = require("./week");

function parseStoredTimestamp(value) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(value.replace(" ", "T") + "Z");
  }

  return new Date(value);
}

function buildDailyTotals(rows, timezone, days = 7, date = new Date()) {
  const dateKeys = getLastDateKeys(days, date, timezone);
  const totals = new Map(dateKeys.map((dateKey) => [dateKey, 0]));

  for (const row of rows) {
    const timestamp = parseStoredTimestamp(row.created_at);

    if (Number.isNaN(timestamp.getTime())) {
      continue;
    }

    const dateKey = getDateKey(timestamp, timezone);

    if (!totals.has(dateKey)) {
      continue;
    }

    totals.set(dateKey, totals.get(dateKey) + Number(row.estimated_calories || 0));
  }

  return dateKeys.map((dateKey) => ({
    dateKey,
    totalCalories: totals.get(dateKey) || 0
  }));
}

async function initDb(options) {
  const { databaseUrl, databasePath, timezone } = options;

  if (databaseUrl) {
    return initPostgresDb(databaseUrl, timezone);
  }

  return initSqliteDb(databasePath, timezone);
}

async function initSqliteDb(databasePath, timezone) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = await open({
    filename: databasePath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_targets (
      source_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS meal_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      estimated_calories INTEGER NOT NULL,
      meal_name TEXT NOT NULL,
      description TEXT NOT NULL,
      walking_minutes INTEGER NOT NULL,
      jogging_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      source_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_id, report_date)
    );

    CREATE INDEX IF NOT EXISTS idx_meal_logs_user_week
      ON meal_logs (user_id, week_start);
  `);

  async function setActiveWeek(weekStart) {
    await db.run(
      `
        INSERT INTO app_state (key, value)
        VALUES ('active_week_start', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      weekStart
    );
  }

  async function ensureCurrentWeek(date = new Date()) {
    const currentWeekStart = getWeekStartKey(date, timezone);
    const row = await db.get(`SELECT value FROM app_state WHERE key = 'active_week_start'`);

    if (!row || row.value !== currentWeekStart) {
      await setActiveWeek(currentWeekStart);
    }

    return currentWeekStart;
  }

  await ensureCurrentWeek();

  return {
    kind: "sqlite",
    db,
    ensureCurrentWeek,
    async registerChatTarget(target) {
      await db.run(
        `
          INSERT INTO chat_targets (source_id, source_type, last_seen_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(source_id) DO UPDATE SET
            source_type = excluded.source_type,
            last_seen_at = CURRENT_TIMESTAMP
        `,
        target.sourceId,
        target.sourceType
      );
    },
    async logMeal(entry) {
      const activeWeekStart = await ensureCurrentWeek();

      await db.run(
        `
          INSERT INTO meal_logs (
            user_id,
            week_start,
            estimated_calories,
            meal_name,
            description,
            walking_minutes,
            jogging_minutes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        entry.userId,
        activeWeekStart,
        entry.estimatedCalories,
        entry.mealName,
        entry.description,
        entry.walkingMinutes,
        entry.joggingMinutes
      );
    },
    async getWeeklyTotal(userId) {
      const activeWeekStart = await ensureCurrentWeek();
      const row = await db.get(
        `
          SELECT COALESCE(SUM(estimated_calories), 0) AS total_calories
          FROM meal_logs
          WHERE user_id = ? AND week_start = ?
        `,
        userId,
        activeWeekStart
      );

      return {
        weekStart: activeWeekStart,
        totalCalories: row?.total_calories || row?.totalCalories || 0
      };
    },
    async getDailyTotals(userId, days = 7, date = new Date()) {
      const rows = await db.all(
        `
          SELECT estimated_calories, created_at
          FROM meal_logs
          WHERE user_id = ?
            AND created_at >= DATETIME('now', ?)
          ORDER BY created_at ASC
        `,
        userId,
        `-${Math.max(days + 1, 8)} days`
      );

      return buildDailyTotals(rows, timezone, days, date);
    },
    async getNotificationTargets() {
      return db.all(
        `
          SELECT source_id AS sourceId, source_type AS sourceType
          FROM chat_targets
          ORDER BY last_seen_at ASC
        `
      );
    },
    async markDailyReportSent(sourceId, reportDate) {
      const result = await db.run(
        `
          INSERT OR IGNORE INTO daily_reports (source_id, report_date)
          VALUES (?, ?)
        `,
        sourceId,
        reportDate
      );

      return result.changes > 0;
    },
    async resetWeek(date = new Date()) {
      const newWeekStart = getWeekStartKey(date, timezone);
      await setActiveWeek(newWeekStart);
      return newWeekStart;
    }
  };
}

async function initPostgresDb(databaseUrl, timezone) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? false
      : {
          rejectUnauthorized: false
        }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_targets (
      source_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS meal_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      week_start TEXT NOT NULL,
      estimated_calories INTEGER NOT NULL,
      meal_name TEXT NOT NULL,
      description TEXT NOT NULL,
      walking_minutes INTEGER NOT NULL,
      jogging_minutes INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      source_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (source_id, report_date)
    );

    CREATE INDEX IF NOT EXISTS idx_meal_logs_user_week
      ON meal_logs (user_id, week_start);
  `);

  async function setActiveWeek(weekStart) {
    await pool.query(
      `
        INSERT INTO app_state (key, value)
        VALUES ('active_week_start', $1)
        ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
      `,
      [weekStart]
    );
  }

  async function ensureCurrentWeek(date = new Date()) {
    const currentWeekStart = getWeekStartKey(date, timezone);
    const result = await pool.query(`SELECT value FROM app_state WHERE key = 'active_week_start'`);
    const row = result.rows[0];

    if (!row || row.value !== currentWeekStart) {
      await setActiveWeek(currentWeekStart);
    }

    return currentWeekStart;
  }

  await ensureCurrentWeek();

  return {
    kind: "postgres",
    db: {
      close: () => pool.end()
    },
    ensureCurrentWeek,
    async registerChatTarget(target) {
      await pool.query(
        `
          INSERT INTO chat_targets (source_id, source_type, last_seen_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT(source_id) DO UPDATE SET
            source_type = EXCLUDED.source_type,
            last_seen_at = NOW()
        `,
        [target.sourceId, target.sourceType]
      );
    },
    async logMeal(entry) {
      const activeWeekStart = await ensureCurrentWeek();

      await pool.query(
        `
          INSERT INTO meal_logs (
            user_id,
            week_start,
            estimated_calories,
            meal_name,
            description,
            walking_minutes,
            jogging_minutes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          entry.userId,
          activeWeekStart,
          entry.estimatedCalories,
          entry.mealName,
          entry.description,
          entry.walkingMinutes,
          entry.joggingMinutes
        ]
      );
    },
    async getWeeklyTotal(userId) {
      const activeWeekStart = await ensureCurrentWeek();
      const result = await pool.query(
        `
          SELECT COALESCE(SUM(estimated_calories), 0) AS total_calories
          FROM meal_logs
          WHERE user_id = $1 AND week_start = $2
        `,
        [userId, activeWeekStart]
      );

      return {
        weekStart: activeWeekStart,
        totalCalories: Number(result.rows[0]?.total_calories || 0)
      };
    },
    async getDailyTotals(userId, days = 7, date = new Date()) {
      const result = await pool.query(
        `
          SELECT estimated_calories, created_at
          FROM meal_logs
          WHERE user_id = $1
            AND created_at >= NOW() - ($2 || ' days')::INTERVAL
          ORDER BY created_at ASC
        `,
        [userId, String(Math.max(days + 1, 8))]
      );

      return buildDailyTotals(result.rows, timezone, days, date);
    },
    async getNotificationTargets() {
      const result = await pool.query(
        `
          SELECT source_id AS "sourceId", source_type AS "sourceType"
          FROM chat_targets
          ORDER BY last_seen_at ASC
        `
      );

      return result.rows;
    },
    async markDailyReportSent(sourceId, reportDate) {
      const result = await pool.query(
        `
          INSERT INTO daily_reports (source_id, report_date)
          VALUES ($1, $2)
          ON CONFLICT (source_id, report_date) DO NOTHING
          RETURNING source_id
        `,
        [sourceId, reportDate]
      );

      return result.rowCount > 0;
    },
    async resetWeek(date = new Date()) {
      const newWeekStart = getWeekStartKey(date, timezone);
      await setActiveWeek(newWeekStart);
      return newWeekStart;
    }
  };
}

module.exports = {
  initDb
};
