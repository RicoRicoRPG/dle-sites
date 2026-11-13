-- Draftdle D1 schema. Votes, runs, boards and names are written by the Pages Functions.
-- players, groups, serve, collect, sports and flags are rebuilt by the nightly job
-- (scripts/draftdle-nightly.mjs) and are never served as files, so Endless answers stay private.

-- Every vote, Daily and Endless. lo/hi are the pair's player ids, sorted; pick 0 = lo, 1 = hi.
CREATE TABLE votes (
  sport TEXT NOT NULL,
  lo TEXT NOT NULL,
  hi TEXT NOT NULL,
  pick INTEGER NOT NULL,
  mode TEXT NOT NULL,
  day TEXT NOT NULL,
  voter TEXT NOT NULL,
  UNIQUE (sport, lo, hi, voter)
);

-- One row per Endless run. pending = the pair served and not yet answered (JSON).
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  voter TEXT NOT NULL,
  started INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  picks INTEGER NOT NULL DEFAULT 0,
  scored INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  pending TEXT,
  recent TEXT NOT NULL DEFAULT '[]',
  nowin_last INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  ended INTEGER NOT NULL DEFAULT 0
);

-- Each browser's best entry per board: pct25 ... pct1000, streak.
CREATE TABLE boards (
  sport TEXT NOT NULL,
  board TEXT NOT NULL,
  voter TEXT NOT NULL,
  run TEXT NOT NULL,
  value REAL NOT NULL,
  at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sport, board, voter)
);
CREATE INDEX boards_rank ON boards (sport, board, hidden, value DESC, at);
CREATE INDEX boards_run ON boards (run);

CREATE TABLE names (
  voter TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL
);

-- Per-sport state, written nightly. phase: scouting | open. tiers_open: 0..3.
CREATE TABLE sports (
  sport TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  tiers_open INTEGER NOT NULL,
  rate REAL NOT NULL,
  n_cand INTEGER NOT NULL,
  n_settled INTEGER NOT NULL,
  n_collect INTEGER NOT NULL,
  updated TEXT NOT NULL
);

-- The pool. gidx numbers players within (sport, tier, grp) so a random partner costs one read.
CREATE TABLE players (
  sport TEXT NOT NULL,
  id TEXT NOT NULL,
  tier INTEGER NOT NULL,
  grp TEXT NOT NULL,
  gidx INTEGER NOT NULL,
  card TEXT NOT NULL,
  PRIMARY KEY (sport, id)
);
CREATE INDEX players_pick ON players (sport, tier, grp, gidx);

CREATE TABLE groups (
  sport TEXT NOT NULL,
  tier INTEGER NOT NULL,
  grp TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (sport, tier, grp)
);

-- Scored Endless pairs. kind: cand (needs votes for a future Daily) | settled. idx is 0..n-1 per kind.
CREATE TABLE serve (
  sport TEXT NOT NULL,
  kind TEXT NOT NULL,
  idx INTEGER NOT NULL,
  lo TEXT NOT NULL,
  hi TEXT NOT NULL,
  winner TEXT NOT NULL,
  share REAL NOT NULL,
  votes INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (sport, kind, idx)
);

-- Players who still need votes; Endless asks no-winner questions about them.
CREATE TABLE collect (
  sport TEXT NOT NULL,
  idx INTEGER NOT NULL,
  player TEXT NOT NULL,
  tier INTEGER NOT NULL,
  grp TEXT NOT NULL,
  PRIMARY KEY (sport, idx)
);

-- Pairs held out of Daily and Endless after a suspicious swing.
CREATE TABLE flags (
  sport TEXT NOT NULL,
  lo TEXT NOT NULL,
  hi TEXT NOT NULL,
  day TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (sport, lo, hi)
);
