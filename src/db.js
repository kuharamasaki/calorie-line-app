const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const { Pool } = require("pg");
const { getWeekStartKey } = require("./week");

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
