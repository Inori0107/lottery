export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  name_primary TEXT NOT NULL,
  name_aliases TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  location TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  match_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  discipline TEXT NOT NULL,
  round TEXT NOT NULL,
  played_on TEXT NOT NULL,
  source_team1_id TEXT NOT NULL,
  source_team2_id TEXT NOT NULL,
  side_a_id TEXT NOT NULL,
  side_b_id TEXT NOT NULL,
  side_a_won_match INTEGER,
  include_match INTEGER NOT NULL,
  include_game1 INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(event_id),
  FOREIGN KEY (side_a_id) REFERENCES players(player_id),
  FOREIGN KEY (side_b_id) REFERENCES players(player_id)
);

CREATE TABLE IF NOT EXISTS games (
  match_id TEXT NOT NULL,
  game_number INTEGER NOT NULL,
  points_a INTEGER NOT NULL,
  points_b INTEGER NOT NULL,
  side_a_won INTEGER NOT NULL,
  is_legal INTEGER NOT NULL,
  PRIMARY KEY (match_id, game_number),
  FOREIGN KEY (match_id) REFERENCES matches(match_id)
);

CREATE TABLE IF NOT EXISTS predictions (
  match_id TEXT NOT NULL,
  market_type TEXT NOT NULL,
  model_version TEXT NOT NULL,
  p_side_a REAL NOT NULL,
  feature_as_of TEXT NOT NULL,
  split TEXT NOT NULL,
  PRIMARY KEY (match_id, market_type),
  FOREIGN KEY (match_id) REFERENCES matches(match_id)
);

CREATE TABLE IF NOT EXISTS player_ratings (
  discipline TEXT NOT NULL,
  player_id TEXT NOT NULL,
  elo REAL NOT NULL,
  match_count INTEGER NOT NULL,
  game1_count INTEGER NOT NULL,
  last_played_on TEXT,
  game1_recent TEXT NOT NULL,
  PRIMARY KEY (discipline, player_id),
  FOREIGN KEY (player_id) REFERENCES players(player_id)
);

CREATE TABLE IF NOT EXISTS model_state (
  discipline TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  game1_method TEXT NOT NULL,
  payload TEXT NOT NULL,
  data_through TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS matches_discipline_date ON matches (discipline, played_on);
CREATE INDEX IF NOT EXISTS players_name ON players (name_primary);
CREATE INDEX IF NOT EXISTS ratings_discipline_count ON player_ratings (discipline, match_count);
`
