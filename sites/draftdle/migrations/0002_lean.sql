-- Fewer D1 rows written. D1 bills every index entry a write touches as a row written. A WITHOUT
-- ROWID table stores its primary key as the table itself, so an insert no longer also writes a
-- separate key index: a vote costs 1 row instead of 2, a players row 2 instead of 3.
CREATE TABLE votes_v2 (
  sport TEXT NOT NULL, lo TEXT NOT NULL, hi TEXT NOT NULL, pick INTEGER NOT NULL,
  mode TEXT NOT NULL, day TEXT NOT NULL, voter TEXT NOT NULL,
  PRIMARY KEY (sport, lo, hi, voter)
) WITHOUT ROWID;
INSERT INTO votes_v2 SELECT sport, lo, hi, pick, mode, day, voter FROM votes;
DROP TABLE votes;
ALTER TABLE votes_v2 RENAME TO votes;

CREATE TABLE runs_v2 (
  id TEXT PRIMARY KEY, sport TEXT NOT NULL, voter TEXT NOT NULL, started INTEGER NOT NULL, last_at INTEGER NOT NULL,
  picks INTEGER NOT NULL DEFAULT 0, scored INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0, pending TEXT,
  recent TEXT NOT NULL DEFAULT '[]', nowin_last INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
INSERT INTO runs_v2 SELECT id, sport, voter, started, last_at, picks, scored, matches, streak, best_streak, pending, recent, nowin_last, flagged, ended FROM runs;
DROP TABLE runs;
ALTER TABLE runs_v2 RENAME TO runs;

CREATE TABLE boards_v2 (
  sport TEXT NOT NULL, board TEXT NOT NULL, voter TEXT NOT NULL, run TEXT NOT NULL,
  value REAL NOT NULL, at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sport, board, voter)
) WITHOUT ROWID;
INSERT INTO boards_v2 SELECT sport, board, voter, run, value, at, hidden FROM boards;
DROP TABLE boards;
ALTER TABLE boards_v2 RENAME TO boards;
CREATE INDEX boards_rank ON boards (sport, board, hidden, value DESC, at);
CREATE INDEX boards_run ON boards (run);

-- Rebuilt by the nightly job, so these start empty; the next run refills them.
DROP TABLE players;
CREATE TABLE players (
  sport TEXT NOT NULL, id TEXT NOT NULL, tier INTEGER NOT NULL, grp TEXT NOT NULL, gidx INTEGER NOT NULL, card TEXT NOT NULL,
  PRIMARY KEY (sport, id)
) WITHOUT ROWID;
CREATE INDEX players_pick ON players (sport, tier, grp, gidx);

DROP TABLE serve;
CREATE TABLE serve (
  sport TEXT NOT NULL, kind TEXT NOT NULL, idx INTEGER NOT NULL, lo TEXT NOT NULL, hi TEXT NOT NULL,
  winner TEXT NOT NULL, share REAL NOT NULL, votes INTEGER NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (sport, kind, idx)
) WITHOUT ROWID;

DROP TABLE collect;
CREATE TABLE collect (
  sport TEXT NOT NULL, idx INTEGER NOT NULL, player TEXT NOT NULL, tier INTEGER NOT NULL, grp TEXT NOT NULL,
  PRIMARY KEY (sport, idx)
) WITHOUT ROWID;

DROP TABLE groups;
CREATE TABLE groups (
  sport TEXT NOT NULL, tier INTEGER NOT NULL, grp TEXT NOT NULL, n INTEGER NOT NULL,
  PRIMARY KEY (sport, tier, grp)
) WITHOUT ROWID;
