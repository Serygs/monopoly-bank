-- The board catalog is a reference dictionary, not game-engine state: it stores
-- what a space costs and what it earns, never where a token stands. A row with
-- owner_user_id IS NULL is a canonical built-in board shared by every game;
-- a user-owned copy keeps source_board_id pointing at the board it was cloned
-- from. Money columns are positive safe integers in thousands, like every other
-- monetary value in this schema.
CREATE TABLE board_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  source_board_id TEXT REFERENCES board_definitions(id),
  jail_fee INTEGER NOT NULL CHECK (jail_fee > 0),
  unmortgage_interest_percent INTEGER NOT NULL CHECK (unmortgage_interest_percent BETWEEN 0 AND 100),
  house_bank_limit INTEGER NOT NULL CHECK (house_bank_limit >= 0),
  hotel_bank_limit INTEGER NOT NULL CHECK (hotel_bank_limit >= 0),
  utility_multiplier_single INTEGER NOT NULL CHECK (utility_multiplier_single > 0),
  utility_multiplier_pair INTEGER NOT NULL CHECK (utility_multiplier_pair > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX board_definitions_by_owner ON board_definitions(owner_user_id, created_at DESC);

-- Only ownable spaces are catalogued; GO, Chance, taxes and the corners carry no
-- price and stay out of the table. custom_name exists from the first migration so
-- a user-owned copy never needs a schema change: canonical rows keep it NULL and
-- render through translation_key, copies fill it and ignore the key.
-- rent_base..rent_hotel are the six street levels; railroads fill the first four
-- (one to four owned) and utilities leave all six NULL because their rent is the
-- dice total times the board multiplier.
CREATE TABLE board_spaces (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES board_definitions(id) ON DELETE CASCADE,
  board_index INTEGER NOT NULL CHECK (board_index BETWEEN 0 AND 39),
  kind TEXT NOT NULL CHECK (kind IN ('STREET', 'RAILROAD', 'UTILITY')),
  color_group TEXT NOT NULL,
  translation_key TEXT NOT NULL,
  custom_name TEXT,
  price INTEGER NOT NULL CHECK (price > 0),
  mortgage_value INTEGER NOT NULL CHECK (mortgage_value > 0),
  house_cost INTEGER CHECK (house_cost IS NULL OR house_cost > 0),
  rent_base INTEGER CHECK (rent_base IS NULL OR rent_base > 0),
  rent_house_1 INTEGER CHECK (rent_house_1 IS NULL OR rent_house_1 > 0),
  rent_house_2 INTEGER CHECK (rent_house_2 IS NULL OR rent_house_2 > 0),
  rent_house_3 INTEGER CHECK (rent_house_3 IS NULL OR rent_house_3 > 0),
  rent_house_4 INTEGER CHECK (rent_house_4 IS NULL OR rent_house_4 > 0),
  rent_hotel INTEGER CHECK (rent_hotel IS NULL OR rent_hotel > 0),
  UNIQUE (board_id, board_index),
  UNIQUE (id, board_id)
);

CREATE INDEX board_spaces_by_board ON board_spaces(board_id, board_index);

INSERT INTO board_definitions (
  id, name, owner_user_id, source_board_id, jail_fee, unmortgage_interest_percent,
  house_bank_limit, hotel_bank_limit, utility_multiplier_single, utility_multiplier_pair
) VALUES ('board-classic', 'Classic', NULL, NULL, 50, 10, 32, 12, 4, 10);

INSERT INTO board_spaces (
  id, board_id, board_index, kind, color_group, translation_key, custom_name,
  price, mortgage_value, house_cost,
  rent_base, rent_house_1, rent_house_2, rent_house_3, rent_house_4, rent_hotel
) VALUES
  ('board-classic-space-01', 'board-classic', 1, 'STREET', 'BROWN', 'boardSpaceMediterraneanAvenue', NULL, 60, 30, 50, 2, 10, 30, 90, 160, 250),
  ('board-classic-space-03', 'board-classic', 3, 'STREET', 'BROWN', 'boardSpaceBalticAvenue', NULL, 60, 30, 50, 4, 20, 60, 180, 320, 450),
  ('board-classic-space-05', 'board-classic', 5, 'RAILROAD', 'RAILROAD', 'boardSpaceReadingRailroad', NULL, 200, 100, NULL, 25, 50, 100, 200, NULL, NULL),
  ('board-classic-space-06', 'board-classic', 6, 'STREET', 'LIGHT_BLUE', 'boardSpaceOrientalAvenue', NULL, 100, 50, 50, 6, 30, 90, 270, 400, 550),
  ('board-classic-space-08', 'board-classic', 8, 'STREET', 'LIGHT_BLUE', 'boardSpaceVermontAvenue', NULL, 100, 50, 50, 6, 30, 90, 270, 400, 550),
  ('board-classic-space-09', 'board-classic', 9, 'STREET', 'LIGHT_BLUE', 'boardSpaceConnecticutAvenue', NULL, 120, 60, 50, 8, 40, 100, 300, 450, 600),
  ('board-classic-space-11', 'board-classic', 11, 'STREET', 'PINK', 'boardSpaceStCharlesPlace', NULL, 140, 70, 100, 10, 50, 150, 450, 625, 750),
  ('board-classic-space-12', 'board-classic', 12, 'UTILITY', 'UTILITY', 'boardSpaceElectricCompany', NULL, 150, 75, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('board-classic-space-13', 'board-classic', 13, 'STREET', 'PINK', 'boardSpaceStatesAvenue', NULL, 140, 70, 100, 10, 50, 150, 450, 625, 750),
  ('board-classic-space-14', 'board-classic', 14, 'STREET', 'PINK', 'boardSpaceVirginiaAvenue', NULL, 160, 80, 100, 12, 60, 180, 500, 700, 900),
  ('board-classic-space-15', 'board-classic', 15, 'RAILROAD', 'RAILROAD', 'boardSpacePennsylvaniaRailroad', NULL, 200, 100, NULL, 25, 50, 100, 200, NULL, NULL),
  ('board-classic-space-16', 'board-classic', 16, 'STREET', 'ORANGE', 'boardSpaceStJamesPlace', NULL, 180, 90, 100, 14, 70, 200, 550, 750, 950),
  ('board-classic-space-18', 'board-classic', 18, 'STREET', 'ORANGE', 'boardSpaceTennesseeAvenue', NULL, 180, 90, 100, 14, 70, 200, 550, 750, 950),
  ('board-classic-space-19', 'board-classic', 19, 'STREET', 'ORANGE', 'boardSpaceNewYorkAvenue', NULL, 200, 100, 100, 16, 80, 220, 600, 800, 1000),
  ('board-classic-space-21', 'board-classic', 21, 'STREET', 'RED', 'boardSpaceKentuckyAvenue', NULL, 220, 110, 150, 18, 90, 250, 700, 875, 1050),
  ('board-classic-space-23', 'board-classic', 23, 'STREET', 'RED', 'boardSpaceIndianaAvenue', NULL, 220, 110, 150, 18, 90, 250, 700, 875, 1050),
  ('board-classic-space-24', 'board-classic', 24, 'STREET', 'RED', 'boardSpaceIllinoisAvenue', NULL, 240, 120, 150, 20, 100, 300, 750, 925, 1100),
  ('board-classic-space-25', 'board-classic', 25, 'RAILROAD', 'RAILROAD', 'boardSpaceBAndORailroad', NULL, 200, 100, NULL, 25, 50, 100, 200, NULL, NULL),
  ('board-classic-space-26', 'board-classic', 26, 'STREET', 'YELLOW', 'boardSpaceAtlanticAvenue', NULL, 260, 130, 150, 22, 110, 330, 800, 975, 1150),
  ('board-classic-space-27', 'board-classic', 27, 'STREET', 'YELLOW', 'boardSpaceVentnorAvenue', NULL, 260, 130, 150, 22, 110, 330, 800, 975, 1150),
  ('board-classic-space-28', 'board-classic', 28, 'UTILITY', 'UTILITY', 'boardSpaceWaterWorks', NULL, 150, 75, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('board-classic-space-29', 'board-classic', 29, 'STREET', 'YELLOW', 'boardSpaceMarvinGardens', NULL, 280, 140, 150, 24, 120, 360, 850, 1025, 1200),
  ('board-classic-space-31', 'board-classic', 31, 'STREET', 'GREEN', 'boardSpacePacificAvenue', NULL, 300, 150, 200, 26, 130, 390, 900, 1100, 1275),
  ('board-classic-space-32', 'board-classic', 32, 'STREET', 'GREEN', 'boardSpaceNorthCarolinaAvenue', NULL, 300, 150, 200, 26, 130, 390, 900, 1100, 1275),
  ('board-classic-space-34', 'board-classic', 34, 'STREET', 'GREEN', 'boardSpacePennsylvaniaAvenue', NULL, 320, 160, 200, 28, 150, 450, 1000, 1200, 1400),
  ('board-classic-space-35', 'board-classic', 35, 'RAILROAD', 'RAILROAD', 'boardSpaceShortLine', NULL, 200, 100, NULL, 25, 50, 100, 200, NULL, NULL),
  ('board-classic-space-37', 'board-classic', 37, 'STREET', 'DARK_BLUE', 'boardSpaceParkPlace', NULL, 350, 175, 200, 35, 175, 500, 1100, 1300, 1500),
  ('board-classic-space-39', 'board-classic', 39, 'STREET', 'DARK_BLUE', 'boardSpaceBoardwalk', NULL, 400, 200, 200, 50, 200, 600, 1400, 1700, 2000);

-- Additive and nullable on purpose: every game created before the board
-- subsystem keeps board_id IS NULL and behaves exactly as it did.
ALTER TABLE games ADD COLUMN board_id TEXT REFERENCES board_definitions(id);

CREATE INDEX games_by_board_id ON games(board_id);
