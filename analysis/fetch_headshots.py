"""
fetch_headshots.py
Builds data/player_headshots.csv: player_id -> headshot URL for every player in the cleaned dataset.

Source : nflverse players table (https://github.com/nflverse/nflverse-data/releases, tag: players),
         column `headshot`, joined on gsis_id == player_id.
The images themselves are NOT downloaded; the site links to them and falls back to initials
if an image is missing or fails to load. Headshots are used for display only, never for analysis.

Run:  python analysis/fetch_headshots.py
"""
import os
import urllib.request

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"
RAW = os.path.join(HERE, "raw", "players.csv")

os.makedirs(os.path.dirname(RAW), exist_ok=True)
if not os.path.exists(RAW):
    urllib.request.urlretrieve(URL, RAW)

players = pd.read_csv(RAW, usecols=["gsis_id", "headshot"], low_memory=False).dropna()
ids = pd.read_csv(os.path.join(DATA, "nfl_offense_weekly_2015_2025_clean.csv"), usecols=["player_id"])
ids = ids["player_id"].drop_duplicates()

out = (players[players["gsis_id"].isin(ids)]
       .drop_duplicates("gsis_id")
       .rename(columns={"gsis_id": "player_id", "headshot": "headshot_url"})
       .sort_values("player_id"))
out.to_csv(os.path.join(DATA, "player_headshots.csv"), index=False)
print(f"headshots found for {len(out):,} of {len(ids):,} players")
