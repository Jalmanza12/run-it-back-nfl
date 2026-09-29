"""
clean_nfl.py
Builds a cleaned, website-ready dataset from nflverse weekly player stats.

Source : https://github.com/nflverse/nflverse-data/releases (tag: stats_player)
         files stats_player_week_{season}.csv  (same data as nflreadr::load_player_stats)
Output : ../data/nfl_offense_weekly_2015_2025_clean.csv
         ../data/cleaning_log.txt

Raw files are downloaded into analysis/raw/ (or reused if already there) and are never modified.
Run:  python analysis/clean_nfl.py
"""
import os
import urllib.request

import numpy as np
import pandas as pd

SEASONS = range(2015, 2026)  # 2015-2025 complete seasons; 2026 excluded (in progress)
HERE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(HERE, "raw")  # raw downloads (git-ignored)
URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{}.csv"
OUT_FILE = os.path.join(HERE, "..", "data", "nfl_offense_weekly_2015_2025_clean.csv")
LOG_FILE = os.path.join(HERE, "..", "data", "cleaning_log.txt")
OFFENSE = ["QB", "RB", "WR", "TE"]

# game_id keeps historic team codes; the `team` column uses current franchise codes
HISTORIC_TO_CURRENT = {"OAK": "LV", "SD": "LAC", "STL": "LA"}

# Team metadata (current alignment; conferences/divisions unchanged since 2002)
TEAMS = {
    "BUF": ("Buffalo Bills", "AFC", "AFC East"), "MIA": ("Miami Dolphins", "AFC", "AFC East"),
    "NE": ("New England Patriots", "AFC", "AFC East"), "NYJ": ("New York Jets", "AFC", "AFC East"),
    "BAL": ("Baltimore Ravens", "AFC", "AFC North"), "CIN": ("Cincinnati Bengals", "AFC", "AFC North"),
    "CLE": ("Cleveland Browns", "AFC", "AFC North"), "PIT": ("Pittsburgh Steelers", "AFC", "AFC North"),
    "HOU": ("Houston Texans", "AFC", "AFC South"), "IND": ("Indianapolis Colts", "AFC", "AFC South"),
    "JAX": ("Jacksonville Jaguars", "AFC", "AFC South"), "TEN": ("Tennessee Titans", "AFC", "AFC South"),
    "DEN": ("Denver Broncos", "AFC", "AFC West"), "KC": ("Kansas City Chiefs", "AFC", "AFC West"),
    "LV": ("Las Vegas Raiders", "AFC", "AFC West"), "LAC": ("Los Angeles Chargers", "AFC", "AFC West"),
    "DAL": ("Dallas Cowboys", "NFC", "NFC East"), "NYG": ("New York Giants", "NFC", "NFC East"),
    "PHI": ("Philadelphia Eagles", "NFC", "NFC East"), "WAS": ("Washington Commanders", "NFC", "NFC East"),
    "CHI": ("Chicago Bears", "NFC", "NFC North"), "DET": ("Detroit Lions", "NFC", "NFC North"),
    "GB": ("Green Bay Packers", "NFC", "NFC North"), "MIN": ("Minnesota Vikings", "NFC", "NFC North"),
    "ATL": ("Atlanta Falcons", "NFC", "NFC South"), "CAR": ("Carolina Panthers", "NFC", "NFC South"),
    "NO": ("New Orleans Saints", "NFC", "NFC South"), "TB": ("Tampa Bay Buccaneers", "NFC", "NFC South"),
    "ARI": ("Arizona Cardinals", "NFC", "NFC West"), "LA": ("Los Angeles Rams", "NFC", "NFC West"),
    "SF": ("San Francisco 49ers", "NFC", "NFC West"), "SEA": ("Seattle Seahawks", "NFC", "NFC West"),
}

log = []


def note(msg):
    print(msg)
    log.append(msg)


# ---------------------------------------------------------------- 1. load raw
os.makedirs(RAW_DIR, exist_ok=True)
frames = []
for s in SEASONS:
    path = os.path.join(RAW_DIR, f"stats_player_week_{s}.csv")
    if not os.path.exists(path):
        urllib.request.urlretrieve(URL.format(s), path)
    frames.append(pd.read_csv(path, low_memory=False))
schemas = {tuple(f.columns) for f in frames}
assert len(schemas) == 1, "Season files have different schemas"
raw = pd.concat(frames, ignore_index=True)
note(f"[load] {len(SEASONS)} season files, {len(raw):,} rows x {raw.shape[1]} columns (identical schemas)")

df = raw.copy()

# ---------------------------------------------------------------- 2. remove team placeholder rows (M1)
no_pid = df["player_id"].isna()
note(f"[M1] removed {no_pid.sum():,} rows with no player_id (team-level placeholder rows)")
df = df[~no_pid]

# ---------------------------------------------------------------- 3. offense-only scope (M2)
before = len(df)
counts = df["position_group"].value_counts()
df = df[df["position_group"].isin(OFFENSE)]
note(f"[M2] kept QB/RB/WR/TE: {len(df):,} of {before:,} player rows "
     f"(dropped {', '.join(f'{k} {v:,}' for k, v in counts.items() if k not in OFFENSE)})")

# ---------------------------------------------------------------- 4. derived columns
gid = df["game_id"].str.split("_", expand=True)
away = gid[2].replace(HISTORIC_TO_CURRENT)
home = gid[3].replace(HISTORIC_TO_CURRENT)
df["home_away"] = np.select([df["team"].eq(home), df["team"].eq(away)], ["Home", "Away"], default="Unknown")
note(f"[S2] home_away derived from game_id (historic codes mapped {HISTORIC_TO_CURRENT}); "
     f"unresolved: {(df['home_away'] == 'Unknown').sum()}")

df["season_type"] = df["season_type"].map({"REG": "Regular", "POST": "Postseason"})
# NFL: 16-game seasons through 2020, 17-game seasons from 2021 (17 and 18 weeks incl. bye)
df["reg_season_games"] = np.where(df["season"] >= 2021, 17, 16)
df["week_label"] = np.where(df["season_type"] == "Regular",
                            "Week " + df["week"].astype(str),
                            "Postseason " + df["week"].astype(str))

df["total_tds"] = df["passing_tds"] + df["rushing_tds"] + df["receiving_tds"] + df["special_teams_tds"]
df["scrimmage_yards"] = df["rushing_yards"] + df["receiving_yards"]
df["total_yards"] = df["passing_yards"] + df["rushing_yards"] + df["receiving_yards"]
df["sack_yards"] = -df["sack_yards_lost"]  # stored as negative in source (S6)
note("[S3] derived total_tds, scrimmage_yards, total_yards; [S6] sack_yards = -sack_yards_lost")

df["team_name"] = df["team"].map(lambda t: TEAMS[t][0])
df["conference"] = df["team"].map(lambda t: TEAMS[t][1])
df["division"] = df["team"].map(lambda t: TEAMS[t][2])
df["opponent_conference"] = df["opponent_team"].map(lambda t: TEAMS[t][1])
note("[O1] added team_name, conference, division, opponent_conference (current alignment)")

# Player label, disambiguated where different players share a display name (S7)
base = df["player_display_name"] + " (" + df["position"] + ")"
dup_names = df.groupby("player_display_name")["player_id"].nunique()
dup_names = set(dup_names[dup_names > 1].index)
df["player_label"] = np.where(df["player_display_name"].isin(dup_names),
                              base + " #" + df["player_id"].str[-4:], base)
note(f"[S7] player_label built; {len(dup_names)} display names shared by >1 player were disambiguated")

stat_cols = ["completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
             "sacks_suffered", "carries", "rushing_yards", "rushing_tds", "targets", "receptions",
             "receiving_yards", "receiving_tds", "fumbles_lost_total"]
df["no_stats_flag"] = (df[stat_cols].abs().sum(axis=1) == 0) & (df["fantasy_points_ppr"] == 0)
note(f"[O3] flagged (not removed) {df['no_stats_flag'].sum():,} rows with no offensive stats recorded")

# ---------------------------------------------------------------- 5. select + order columns (M6)
cols = [
    # time
    "season", "week", "season_type", "week_label", "reg_season_games",
    # game / team
    "game_id", "team", "team_name", "conference", "division", "home_away",
    "opponent_team", "opponent_conference",
    # player
    "player_id", "player_display_name", "player_label", "position", "position_group",
    # passing
    "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
    "sacks_suffered", "sack_yards",
    # rushing
    "carries", "rushing_yards", "rushing_tds",
    # receiving
    "targets", "receptions", "receiving_yards", "receiving_tds", "target_share",
    # totals
    "scrimmage_yards", "total_yards", "total_tds", "fumbles_lost_total",
    "fantasy_points", "fantasy_points_ppr",
    # flags
    "no_stats_flag",
]
clean = df[cols].rename(columns={"player_display_name": "player_name",
                                 "fumbles_lost_total": "fumbles_lost"})
clean["target_share"] = clean["target_share"].round(4)
clean = clean.sort_values(["season", "week", "team", "position_group", "player_name"]).reset_index(drop=True)

# ---------------------------------------------------------------- 6. validation
checks = {
    "no duplicate player_id + game_id": not clean.duplicated(["player_id", "game_id"]).any(),
    "no missing values": clean.isna().sum().sum() == 0,
    "32 teams": clean["team"].nunique() == 32,
    "home_away fully resolved": (clean["home_away"] != "Unknown").all(),
    "completions <= attempts": (clean["completions"] <= clean["attempts"]).all(),
    "receptions <= targets": (clean["receptions"] <= clean["targets"]).all(),
    "PPR - standard == receptions": np.allclose(clean["fantasy_points_ppr"] - clean["fantasy_points"],
                                                clean["receptions"]),
    "rows >= 50,000": len(clean) >= 50_000,
    "columns >= 8": clean.shape[1] >= 8,
}
for name, ok in checks.items():
    note(f"[check] {'PASS' if ok else 'FAIL'}  {name}")
assert all(checks.values()), "Validation failed"

clean.to_csv(OUT_FILE, index=False)
note(f"[save] {os.path.basename(OUT_FILE)}: {len(clean):,} rows x {clean.shape[1]} columns, "
     f"{os.path.getsize(OUT_FILE) / 1e6:.1f} MB")

with open(LOG_FILE, "w") as f:
    f.write("\n".join(log) + "\n")
