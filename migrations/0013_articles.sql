-- Wortling 0013(v11 4단계, 2026-11-02): 오늘의 기사 + 저장한 표현.
-- articles: 평일 11:05 KST 작업(scripts/articles/run.mjs)이 KBS 독일어 기사를 골라 공부 자료(lesson JSON)와 함께 넣는다.
--   본문(body)은 30일 뒤 지우고(사용자 결정 D1 안전장치) 제목·주소·공부 자료만 남긴다. role = main(그날 기사) | extra(한 편 더)
-- expressions: 기사에서 저장한 표현. 복습 칸은 cards 와 같은 FSRS 칸
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  ext_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  published_at TEXT NOT NULL,
  day TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'extra',
  body TEXT,
  words INTEGER NOT NULL DEFAULT 0,
  score REAL,
  lesson TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  opened_at TEXT,
  done_at TEXT,
  quiz_score INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (source, ext_id)
);
CREATE INDEX IF NOT EXISTS articles_day ON articles(day, role);

CREATE TABLE IF NOT EXISTS expressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id),
  base TEXT NOT NULL UNIQUE,
  meaning_ko TEXT NOT NULL,
  sentence TEXT,
  created_at TEXT NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,
  due TEXT NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  learning_steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_review TEXT
);
CREATE INDEX IF NOT EXISTS expressions_due ON expressions(due);
