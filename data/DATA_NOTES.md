# Data Notes — NFL Offensive Weekly Player Stats, 2015–2025

## Source
Weekly player stats from the nflverse project (the same data returned by `nflreadr::load_player_stats()`),
downloaded 2026-09-28 from the `stats_player` release of github.com/nflverse/nflverse-data.
Data courtesy of nflverse; NFL data belongs to its respective owners.

## Scope
- Seasons 2015–2025 (11 complete seasons). 2026 excluded because the season is in progress.
- Offensive skill positions only: QB, RB, WR, TE.
- Regular season and postseason, distinguished by `season_type`.
- One row = one player's stat line in one game.
- Final file: 66,228 rows × 40 columns; 1,900 players; 32 teams; 3,028 games; 236 season-weeks.

## Cleaning steps (counts from `cleaning_log.txt`)
| Step | Action | Rows affected |
|---|---|---|
| Load | Combined 11 season files (identical 150-column schema) | 199,868 raw rows |
| M1 | Removed rows with no `player_id` (team-level placeholder rows, not players) | 236 removed |
| M2 | Kept QB/RB/WR/TE; dropped DB, DL, LB, SPEC, OL (almost always 0 on offensive measures) | 133,404 removed |
| M3 | Excluded 2026 (partial season) | not loaded |
| M6 | Reduced 150 columns to 40 | — |
| S2 | Derived `home_away` from `game_id` (format: season_week_AWAY_HOME), mapping historic codes OAK→LV, SD→LAC, STL→LA | 0 unresolved |
| S3 | Derived `total_tds`, `scrimmage_yards`, `total_yards` | — |
| S6 | `sack_yards` = sign-flipped `sack_yards_lost` (source stores it as negative) | — |
| S7 | `player_label` = "Name (POS)", with an ID suffix for the 6 names shared by different players | — |
| O1 | Added `team_name`, `conference`, `division`, `opponent_conference` | — |
| O3 | Flagged (did not remove) rows with no offensive stats: `no_stats_flag = True` | 6,530 flagged |

No values were modified; outliers were not removed. Validation checks (all PASS): no duplicate player-game,
no missing values, 32 teams, home/away fully resolved, completions ≤ attempts, receptions ≤ targets,
PPR − standard points = receptions.

## Rules for analysis (important for the website)
1. **Schedule length changed.** 16-game regular seasons through 2020, 17 games from 2021 (`reg_season_games`).
   Compare seasons using **per-game** values, not raw season totals.
2. **Default to `season_type = Regular`.** Postseason week numbers are 18–21 before 2021 and 19–22 after.
3. **Compute rates from sums**, never by averaging row-level ratios:
   completion % = Σcompletions / Σattempts; yards per carry = Σrushing_yards / Σcarries;
   catch rate = Σreceptions / Σtargets.
4. **Absence ≠ zero.** A player has a row only in games where he recorded a stat. Don't fill missing weeks with zeros.
5. **Per-player averages** should exclude `no_stats_flag` rows and use a minimum-games threshold for leaderboards.
6. **Team codes are current franchise codes applied to all years:** LV = Oakland Raiders 2015–2019,
   LAC = San Diego Chargers 2015–2016, LA = St. Louis Rams 2015.
7. Conference/division use the current alignment (unchanged since 2002).
8. Negative yards and negative fantasy points are real (losses, interceptions, fumbles).

## Column dictionary
| Column | Type | Description |
|---|---|---|
| season | int | NFL season (2015–2025) |
| week | int | Week number within season |
| season_type | text | Regular / Postseason |
| week_label | text | "Week 5" or "Postseason 19" |
| reg_season_games | int | Games in that season's regular season (16 or 17) |
| game_id | text | Game key, season_week_AWAY_HOME (historic team codes) |
| team, team_name | text | Player's team (current franchise code / full name) |
| conference, division | text | Team's conference and division |
| home_away | text | Home / Away |
| opponent_team, opponent_conference | text | Opponent code and conference |
| player_id | text | Unique player key — use this for grouping |
| player_name | text | Display name (not unique) |
| player_label | text | Unique display label for search/dropdowns |
| position, position_group | text | Listed position; group (QB/RB/WR/TE) |
| completions, attempts, passing_yards, passing_tds, passing_interceptions | int | Passing |
| sacks_suffered, sack_yards | int | Times sacked, yards lost to sacks (positive) |
| carries, rushing_yards, rushing_tds | int | Rushing |
| targets, receptions, receiving_yards, receiving_tds | int | Receiving |
| target_share | float | Share of team targets in that game (0–1) |
| scrimmage_yards | int | rushing + receiving yards |
| total_yards | int | passing + rushing + receiving yards |
| total_tds | int | passing + rushing + receiving + special-teams TDs |
| fumbles_lost | int | All fumbles lost |
| fantasy_points, fantasy_points_ppr | float | Standard and PPR fantasy points |
| no_stats_flag | bool | True if the row has no offensive stats |
