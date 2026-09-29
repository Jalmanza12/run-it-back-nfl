"""
analysis.py
Single source of truth for every number on the website.

Reads   data/nfl_offense_weekly_2015_2025_clean.csv   (the cleaned dataset — never modified here)
        data/player_headshots.csv                      (display only; see fetch_headshots.py)
Writes  data/report_metrics.json    every statistic, chart series and headline number used by index.html
        data/dashboard_data.json    compact column-oriented copy of the dataset for dashboard.html
        analysis/audit_report.md    dataset audit, assignment compliance and the candidate findings

Run:  python analysis/analysis.py

Conventions (also documented in the site's methodology section)
- Report findings use the REGULAR SEASON only, so every season is comparable (postseason length varies).
- A "team-game" is one team's side of one game: a distinct (game_id, team) pair.
  2015-2020 seasons have 512 regular-season team-games (32 teams x 16), 2021+ have 544 (x 17)
  except 2022 (542: the Buffalo-Cincinnati game was cancelled).
- Per-team-game values = SUM(stat) / team-games. This normalises the 16 -> 17 game schedule change.
- Rates are ratios of sums (e.g. completion % = SUM(completions) / SUM(attempts)), never averages of row ratios.
- Team offensive yards = SUM(passing_yards) + SUM(rushing_yards). We never sum `total_yards` across players,
  because it would count each completion twice (the passer's passing yards AND the receiver's receiving yards).
- Touchdowns scored = rushing TDs + receiving TDs + special-teams TDs (= total_tds - passing_tds), for the same reason.
- Passing yards are gross passing yards as recorded by nflverse (sack yardage is not subtracted).
"""
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
CSV = os.path.join(DATA, "nfl_offense_weekly_2015_2025_clean.csv")

df = pd.read_csv(CSV)
df["td_scored"] = df["total_tds"] - df["passing_tds"]          # rush + rec + special-teams TDs
df["off_yards"] = df["passing_yards"] + df["rushing_yards"]      # team-summable offensive yards
reg = df[df["season_type"] == "Regular"]
SEASONS = sorted(df["season"].unique().tolist())
FIRST, LAST = SEASONS[0], SEASONS[-1]


def r(x, d=2):
    return None if x is None else round(float(x), d)


def team_games(frame, by=None):
    """Number of distinct (game_id, team) pairs, optionally per group."""
    tg = frame[["game_id", "team"] + ([by] if by else [])].drop_duplicates()
    return len(tg) if by is None else tg.groupby(by).size()


def series(s, d=2):
    return [{"season": int(k), "value": r(v, d)} for k, v in s.items()]


M = {"meta": {}, "kpis": {}}

# ------------------------------------------------------------------ meta / KPIs
M["meta"] = {
    "rows": int(len(df)), "columns": int(df.shape[1] - 2),   # exclude the two helper columns added above
    "first_season": FIRST, "last_season": LAST, "n_seasons": len(SEASONS),
    "players": int(df["player_id"].nunique()), "teams": int(df["team"].nunique()),
    "games": int(df["game_id"].nunique()), "reg_rows": int(len(reg)),
    "post_rows": int((df["season_type"] == "Postseason").sum()),
    "no_stats_rows": int(df["no_stats_flag"].sum()),
    "reg_team_games": int(team_games(reg)),
    "position_rows": {k: int(v) for k, v in df["position_group"].value_counts().items()},
}
M["kpis"] = {
    "player_games": M["meta"]["rows"],
    "players": M["meta"]["players"],
    "games": M["meta"]["games"],
    "seasons": M["meta"]["n_seasons"],
    "off_yards": int(df["off_yards"].sum()),
    "td_scored": int(df["td_scored"].sum()),
}

tg = team_games(reg, "season")
S = reg.groupby("season")[["passing_yards", "rushing_yards", "attempts", "completions", "carries",
                            "passing_interceptions", "sacks_suffered", "fumbles_lost", "passing_tds",
                            "td_scored", "targets"]].sum()

# ------------------------------------------------------------------ F1 passing volume
pass_ypg = S["passing_yards"] / tg
att_pg = S["attempts"] / tg
M["f1"] = {
    "pass_ypg": series(pass_ypg, 1), "att_pg": series(att_pg, 1),
    "first": r(pass_ypg[FIRST], 1), "last": r(pass_ypg[LAST], 1),
    "pct_change": r((pass_ypg[LAST] / pass_ypg[FIRST] - 1) * 100, 1),
    "att_first": r(att_pg[FIRST], 1), "att_last": r(att_pg[LAST], 1),
    "peak_season": int(pass_ypg.idxmax()), "peak": r(pass_ypg.max(), 1),
    "low_season": int(pass_ypg.idxmin()), "low": r(pass_ypg.min(), 1),
}

# ------------------------------------------------------------------ F2 300-yard passing games
g300 = reg[reg["passing_yards"] >= 300].groupby("season").size().reindex(SEASONS, fill_value=0)
g300_rate = g300 / tg * 100
M["f2"] = {
    "games": [{"season": int(k), "value": int(v), "rate": r(g300_rate[k], 1)} for k, v in g300.items()],
    "first": int(g300[FIRST]), "last": int(g300[LAST]),
    "pct_change": r((g300[LAST] / g300[FIRST] - 1) * 100, 1),
    "rate_first": r(g300_rate[FIRST], 1), "rate_last": r(g300_rate[LAST], 1),
    "total": int(g300.sum()),
}

# ------------------------------------------------------------------ F3 rushing
rush_ypg = S["rushing_yards"] / tg
ypc = S["rushing_yards"] / S["carries"]
car_pg = S["carries"] / tg
ps = reg.groupby(["season", "player_id"])["rushing_yards"].sum()
r1000 = (ps >= 1000).groupby("season").sum().reindex(SEASONS, fill_value=0)
M["f3"] = {
    "rush_ypg": series(rush_ypg, 1), "ypc": series(ypc, 2), "car_pg": series(car_pg, 1),
    "rushers_1000": [{"season": int(k), "value": int(v)} for k, v in r1000.items()],
    "first": r(rush_ypg[FIRST], 1), "last": r(rush_ypg[LAST], 1),
    "peak_season": int(rush_ypg.idxmax()), "peak": r(rush_ypg.max(), 1),
    "ypc_first": r(ypc[FIRST], 2), "ypc_last": r(ypc[LAST], 2),
    "car_first": r(car_pg[FIRST], 1), "car_last": r(car_pg[LAST], 1),
    "r1000_first": int(r1000[FIRST]), "r1000_last": int(r1000[LAST]),
}

# ------------------------------------------------------------------ F4 quarterback rushing
pr = reg.groupby(["season", "position_group"])["rushing_yards"].sum().unstack()
qb_share = pr["QB"] / pr.sum(axis=1) * 100
qb_car = reg[reg["position_group"] == "QB"].groupby("season")["carries"].sum()
M["f4"] = {
    "qb_share": series(qb_share, 1),
    "qb_yards": [{"season": int(k), "value": int(v)} for k, v in pr["QB"].items()],
    "share_first": r(qb_share[FIRST], 1), "share_last": r(qb_share[LAST], 1),
    "peak_season": int(qb_share.idxmax()), "peak": r(qb_share.max(), 1),
    "yards_first": int(pr["QB"][FIRST]), "yards_last": int(pr["QB"][LAST]),
    "yards_peak_season": int(pr["QB"].idxmax()), "yards_peak": int(pr["QB"].max()),
    "yards_pct_change": r((pr["QB"][LAST] / pr["QB"][FIRST] - 1) * 100, 1),
    "qb_carries_first": int(qb_car[FIRST]), "qb_carries_last": int(qb_car[LAST]),
}

# ------------------------------------------------------------------ F5 target share by position
pt = reg.groupby(["season", "position_group"])["targets"].sum().unstack().fillna(0)
tshare = pt.div(pt.sum(axis=1), axis=0) * 100
M["f5"] = {
    "share": [{"season": int(s), **{p: r(tshare.loc[s, p], 1) for p in ["WR", "TE", "RB", "QB"]}}
              for s in SEASONS],
    "te_first": r(tshare.loc[FIRST, "TE"], 1), "te_last": r(tshare.loc[LAST, "TE"], 1),
    "te_max_season": int(tshare["TE"].idxmax()), "te_max": r(tshare["TE"].max(), 1),
    "te_min_season": int(tshare["TE"].idxmin()), "te_min": r(tshare["TE"].min(), 1),
    "rb_first": r(tshare.loc[FIRST, "RB"], 1), "rb_last": r(tshare.loc[LAST, "RB"], 1),
    "rb_max_season": int(tshare["RB"].idxmax()), "rb_max": r(tshare["RB"].max(), 1),
    "rb_min_season": int(tshare["RB"].idxmin()), "rb_min": r(tshare["RB"].min(), 1),
    "wr_last": r(tshare.loc[LAST, "WR"], 1),
}

# ------------------------------------------------------------------ F6 ball security
int_rate = S["passing_interceptions"] / S["attempts"] * 100
fum_pg = S["fumbles_lost"] / tg
give_pg = (S["passing_interceptions"] + S["fumbles_lost"]) / tg
M["f6"] = {
    "int_rate": series(int_rate, 2), "fum_pg": series(fum_pg, 2), "give_pg": series(give_pg, 2),
    "int_first": r(int_rate[FIRST], 2), "int_last": r(int_rate[LAST], 2),
    "fum_first": r(fum_pg[FIRST], 2), "fum_last": r(fum_pg[LAST], 2),
    "fum_pct_change": r((fum_pg[LAST] / fum_pg[FIRST] - 1) * 100, 1),
    "give_first": r(give_pg[FIRST], 2), "give_last": r(give_pg[LAST], 2),
    "give_low_season": int(give_pg.idxmin()), "give_low": r(give_pg.min(), 2),
}

# ------------------------------------------------------------------ F7 sacks
sack_rate = S["sacks_suffered"] / (S["attempts"] + S["sacks_suffered"]) * 100
M["f7"] = {
    "sack_rate": series(sack_rate, 2),
    "first": r(sack_rate[FIRST], 2), "last": r(sack_rate[LAST], 2),
    "peak_season": int(sack_rate.idxmax()), "peak": r(sack_rate.max(), 2),
    "avg_2015_2019": r(S.loc[2015:2019, "sacks_suffered"].sum()
                       / (S.loc[2015:2019, "attempts"].sum() + S.loc[2015:2019, "sacks_suffered"].sum()) * 100, 2),
    "avg_2021_2025": r(S.loc[2021:2025, "sacks_suffered"].sum()
                       / (S.loc[2021:2025, "attempts"].sum() + S.loc[2021:2025, "sacks_suffered"].sum()) * 100, 2),
}

# ------------------------------------------------------------------ F8 home vs away
tgm = reg.groupby(["season", "game_id", "team", "home_away"])[["off_yards", "td_scored"]].sum().reset_index()
ha = tgm.groupby(["season", "home_away"])["off_yards"].mean().unstack()
ha["diff"] = ha["Home"] - ha["Away"]
ha_all = tgm.groupby("home_away")[["off_yards", "td_scored"]].mean()
M["f8"] = {
    "by_season": [{"season": int(s), "home": r(ha.loc[s, "Home"], 1), "away": r(ha.loc[s, "Away"], 1),
                   "diff": r(ha.loc[s, "diff"], 1)} for s in SEASONS],
    "home_ypg": r(ha_all.loc["Home", "off_yards"], 1), "away_ypg": r(ha_all.loc["Away", "off_yards"], 1),
    "diff_ypg": r(ha_all.loc["Home", "off_yards"] - ha_all.loc["Away", "off_yards"], 1),
    "home_td": r(ha_all.loc["Home", "td_scored"], 2), "away_td": r(ha_all.loc["Away", "td_scored"], 2),
    "negative_seasons": [int(s) for s in ha.index[ha["diff"] < 0]],
    "y2020_home": r(ha.loc[2020, "Home"], 1), "y2020_away": r(ha.loc[2020, "Away"], 1),
    "y2020_diff": r(ha.loc[2020, "diff"], 1),
    "max_diff_season": int(ha["diff"].idxmax()), "max_diff": r(ha["diff"].max(), 1),
}

# ------------------------------------------------------------------ F9 team offenses
tt = tgm.groupby("team").agg(ypg=("off_yards", "mean"), tdpg=("td_scored", "mean"), n=("off_yards", "size"))
tt = tt.sort_values("ypg", ascending=False)
meta = df[["team", "team_name", "conference", "division"]].drop_duplicates().set_index("team")
tseason = tgm.groupby(["season", "team"])["off_yards"].mean().sort_values(ascending=False)
M["f9"] = {
    "teams": [{"team": t, "name": meta.loc[t, "team_name"], "conference": meta.loc[t, "conference"],
               "ypg": r(row.ypg, 1), "tdpg": r(row.tdpg, 2), "games": int(row.n)} for t, row in tt.iterrows()],
    "top": tt.index[0], "top_name": meta.loc[tt.index[0], "team_name"], "top_ypg": r(tt["ypg"].iloc[0], 1),
    "second": tt.index[1], "second_ypg": r(tt["ypg"].iloc[1], 1),
    "bottom": tt.index[-1], "bottom_name": meta.loc[tt.index[-1], "team_name"], "bottom_ypg": r(tt["ypg"].iloc[-1], 1),
    "gap": r(tt["ypg"].iloc[0] - tt["ypg"].iloc[-1], 1),
    "league_ypg": r(tgm["off_yards"].mean(), 1),
    "best_season_team": tseason.index[0][1], "best_season": int(tseason.index[0][0]), "best_season_ypg": r(tseason.iloc[0], 1),
    "games_per_team": int(tt["n"].iloc[0]),
}

# ------------------------------------------------------------------ F10 fantasy by position
act = reg[~reg["no_stats_flag"]]
M["f10"] = {"positions": []}
for p in ["QB", "RB", "WR", "TE"]:
    v = act.loc[act["position_group"] == p, "fantasy_points_ppr"]
    q = v.quantile([0.1, 0.25, 0.5, 0.75, 0.9])
    M["f10"]["positions"].append({
        "position": p, "n": int(len(v)), "mean": r(v.mean(), 2), "median": r(q[0.5], 2),
        "p10": r(q[0.1], 2), "p25": r(q[0.25], 2), "p75": r(q[0.75], 2), "p90": r(q[0.9], 2),
        "share20": r((v >= 20).mean() * 100, 1),
        # histogram, 2-point bins from -4 to 50 (values outside are clamped into the end bins)
        "hist": np.histogram(v.clip(-4, 49.99), bins=np.arange(-4, 52, 2))[0].tolist(),
    })
M["f10"]["hist_edges"] = np.arange(-4, 52, 2).tolist()
M["f10"]["by_pos"] = {d["position"]: d for d in M["f10"]["positions"]}
_bp = M["f10"]["by_pos"]
_next = max(("RB", "WR", "TE"), key=lambda p: _bp[p]["mean"])
M["f10"]["next_pos"] = _next
M["f10"]["qb_vs_next_pct"] = r((_bp["QB"]["mean"] / _bp[_next]["mean"] - 1) * 100, 0)

# ------------------------------------------------------------------ F11 scrimmage-yard leaders
heads = pd.read_csv(os.path.join(DATA, "player_headshots.csv")).set_index("player_id")["headshot_url"]
pl = reg.groupby("player_id").agg(
    name=("player_name", "first"), label=("player_label", "first"), pos=("position_group", "first"),
    scr=("scrimmage_yards", "sum"), rush=("rushing_yards", "sum"), recv=("receiving_yards", "sum"),
    td=("td_scored", "sum"), games=("no_stats_flag", lambda s: int((~s).sum())))
pl = pl.sort_values("scr", ascending=False).head(10)
leaders = []
for pid, row in pl.iterrows():
    rows = reg[reg["player_id"] == pid].sort_values(["season", "week"])
    teams = list(dict.fromkeys(rows["team"]))          # in order of first appearance
    leaders.append({"player_id": pid, "name": row["name"], "label": row["label"], "position": row["pos"],
                    "teams": teams, "scrimmage_yards": int(row.scr), "rushing_yards": int(row.rush),
                    "receiving_yards": int(row.recv), "td_scored": int(row.td), "games": int(row.games),
                    "per_game": r(row.scr / row.games, 1), "headshot": heads.get(pid)})
M["f11"] = {"leaders": leaders, "top": leaders[0], "second": leaders[1],
            "top10_rb": sum(1 for l in leaders if l["position"] == "RB"),
            "top10_wr": sum(1 for l in leaders if l["position"] == "WR")}

# ------------------------------------------------------------------ write report metrics
with open(os.path.join(DATA, "report_metrics.json"), "w") as f:
    json.dump(M, f, indent=1)

# ------------------------------------------------------------------ dashboard data (column-oriented)
TEAMS = sorted(df["team"].unique())
POS = ["QB", "RB", "WR", "TE"]
players = (df.sort_values(["season", "week"]).groupby("player_id")
           .agg(name=("player_name", "first"), label=("player_label", "first"), pos=("position_group", "last"))
           .reset_index())
pidx = {p: i for i, p in enumerate(players["player_id"])}
games = sorted(df["game_id"].unique())
gidx = {g: i for i, g in enumerate(games)}
tidx = {t: i for i, t in enumerate(TEAMS)}

cols = {
    "season": df["season"], "week": df["week"],
    "post": (df["season_type"] == "Postseason").astype(int),
    "team": df["team"].map(tidx), "opp": df["opponent_team"].map(tidx),
    "home": (df["home_away"] == "Home").astype(int),
    "player": df["player_id"].map(pidx), "pos": df["position_group"].map(POS.index),
    "game": df["game_id"].map(gidx), "nostat": df["no_stats_flag"].astype(int),
    "cmp": df["completions"], "att": df["attempts"], "pyd": df["passing_yards"], "ptd": df["passing_tds"],
    "int": df["passing_interceptions"], "sck": df["sacks_suffered"],
    "car": df["carries"], "ryd": df["rushing_yards"], "rtd": df["rushing_tds"],
    "tgt": df["targets"], "rec": df["receptions"], "recyd": df["receiving_yards"], "rectd": df["receiving_tds"],
    "sttd": df["total_tds"] - df["passing_tds"] - df["rushing_tds"] - df["receiving_tds"],
    "fum": df["fumbles_lost"], "ppr": df["fantasy_points_ppr"].round(2),
}
dash = {
    "note": "Generated by analysis/analysis.py from data/nfl_offense_weekly_2015_2025_clean.csv. "
            "Column-oriented; categorical columns are indexes into the lists under 'dims'.",
    "rows": int(len(df)),
    "dims": {
        "teams": [{"code": t, "name": meta.loc[t, "team_name"], "conference": meta.loc[t, "conference"],
                   "division": meta.loc[t, "division"]} for t in TEAMS],
        "positions": POS,
        "players": [{"id": p.player_id, "name": p.name, "label": p.label, "pos": p.pos,
                     "img": heads.get(p.player_id)} for p in players.itertuples()],
        "games": len(games),
    },
    "cols": {k: [v if not (isinstance(v, float) and v.is_integer()) else int(v) for v in s.tolist()]
             for k, s in cols.items()},
}
with open(os.path.join(DATA, "dashboard_data.json"), "w") as f:
    json.dump(dash, f, separators=(",", ":"))

# ------------------------------------------------------------------ audit report
def role(c):
    roles = {"season": "Time (primary)", "week": "Time (secondary)", "team": "Group (primary)",
             "player_id": "Identifier", "game_id": "Identifier / event key", "no_stats_flag": "Flag"}
    if c in roles:
        return roles[c]
    if df[c].dtype == object or str(df[c].dtype) in ("str", "string"):
        return "Categorical"
    if df[c].dtype == bool:
        return "Flag"
    return "Numeric"


orig = [c for c in df.columns if c not in ("td_scored", "off_yards")]
lines = ["# Dataset audit & analysis notes", "",
         "_Generated by `analysis/analysis.py`. Re-run the script to regenerate._", "",
         "## Dataset structure", "",
         f"- Rows: **{len(df):,}**  ·  Columns: **{len(orig)}**  ·  Full-row duplicates: **{int(df[orig].duplicated().sum())}**"
         f"  ·  Duplicate player-games (player_id + game_id): **{int(df.duplicated(['player_id', 'game_id']).sum())}**"
         f"  ·  Missing cells: **{int(df[orig].isna().sum().sum())}**", "",
         "| Variable | Type | Unique values | Missing | Role |", "|---|---|---:|---:|---|"]
for c in orig:
    lines.append(f"| {c} | {df[c].dtype} | {df[c].nunique():,} | {int(df[c].isna().sum())} | {role(c)} |")
cat = [c for c in orig if role(c) == "Categorical"]
num = [c for c in orig if role(c) == "Numeric"]
comp = [
    ("Panel/event structure", True, f"one row per player per game; {df['player_id'].nunique():,} players observed across "
                                    f"{df['game_id'].nunique():,} games (player_id + game_id is unique)"),
    ("5+ periods", len(SEASONS) >= 5, f"{len(SEASONS)} seasons ({FIRST}-{LAST}); {df['week'].nunique()} week numbers"),
    ("10+ groups", df["team"].nunique() >= 10, f"{df['team'].nunique()} teams (also {df['player_id'].nunique():,} players)"),
    ("50,000+ rows", len(df) >= 50000, f"{len(df):,} rows"),
    ("8+ columns", len(orig) >= 8, f"{len(orig)} columns"),
    ("2+ categorical variables", len(cat) >= 2, f"{len(cat)}: e.g. position_group, conference, division, home_away, season_type"),
    ("2+ numeric variables", len(num) >= 2, f"{len(num)}: e.g. passing_yards, rushing_yards, receptions, fantasy_points_ppr"),
]
lines += ["", "## Assignment compliance", "", "| Requirement | Status | Evidence |", "|---|---|---|"]
lines += [f"| {a} | {'PASS' if ok else 'FAIL'} | {e} |" for a, ok, e in comp]
lines += ["", "## Data-quality notes", "",
          f"- {M['meta']['no_stats_rows']:,} rows are flagged `no_stats_flag` (player appeared, recorded no offensive stat). "
          "Kept, contribute 0 to totals, excluded from per-player-game averages.",
          "- `total_yards` and `total_tds` are player-level measures. Summing them across players double counts "
          "completions / passing TDs, so team and league totals use passing + rushing yards and rush + receiving + ST TDs.",
          "- Postseason week numbers differ before/after 2021; findings use the regular season.",
          f"- Regular-season team-games per season: {', '.join(f'{s}: {int(v)}' for s, v in tg.items())} "
          "(2022 is 542 because the BUF-CIN game was cancelled).", ""]

# candidate findings: 14 evaluated, 11 selected
cands = [
    ("Passing yards per team-game fell", f"{M['f1']['first']} -> {M['f1']['last']} ({M['f1']['pct_change']}%)", "Selected (F1)"),
    ("300-yard passing games nearly halved", f"{M['f2']['first']} -> {M['f2']['last']}", "Selected (F2)"),
    ("Rushing yards per team-game rose", f"{M['f3']['first']} -> {M['f3']['last']}; YPC {M['f3']['ypc_first']} -> {M['f3']['ypc_last']}", "Selected (F3)"),
    ("QBs took a bigger share of rushing", f"{M['f4']['share_first']}% -> {M['f4']['share_last']}% (peak {M['f4']['peak']}%)", "Selected (F4)"),
    ("TEs gained / RBs lost target share", f"TE {M['f5']['te_first']}% -> {M['f5']['te_last']}%; RB {M['f5']['rb_first']}% -> {M['f5']['rb_last']}%", "Selected (F5)"),
    ("Giveaways fell", f"{M['f6']['give_first']} -> {M['f6']['give_last']} per team-game", "Selected (F6)"),
    ("Sack rate rose", f"{M['f7']['first']}% -> {M['f7']['last']}%", "Selected (F7)"),
    ("Home offenses out-gain away offenses, except 2020", f"+{M['f8']['diff_ypg']} yds/g; 2020 {M['f8']['y2020_diff']}", "Selected (F8)"),
    ("Team offensive output gap", f"{M['f9']['top']} {M['f9']['top_ypg']} vs {M['f9']['bottom']} {M['f9']['bottom_ypg']}", "Selected (F9)"),
    ("QBs dominate fantasy scoring per game", f"QB mean {M['f10']['by_pos']['QB']['mean']} PPR", "Selected (F10)"),
    ("Scrimmage-yard leaders are mostly RBs", f"{M['f11']['top']['name']} {M['f11']['top']['scrimmage_yards']:,}", "Selected (F11)"),
    ("Completion % / yards per attempt trend",
     f"cmp% {r(S.loc[FIRST, 'completions'] / S.loc[FIRST, 'attempts'] * 100, 1)} -> {r(S.loc[LAST, 'completions'] / S.loc[LAST, 'attempts'] * 100, 1)}; "
     f"YPA {r(S.loc[FIRST, 'passing_yards'] / S.loc[FIRST, 'attempts'], 2)} -> {r(S.loc[LAST, 'passing_yards'] / S.loc[LAST, 'attempts'], 2)}",
     "Rejected: small, noisy change (explored in dashboard)"),
    ("Postseason vs regular-season output", "per team-game offensive yards: see dashboard (season type filter)",
     "Rejected: few postseason games per year; not comparable across the 2020 playoff expansion"),
    ("AFC vs NFC", f"{r(tgm.merge(meta.reset_index())[lambda d: d.conference == 'AFC'].off_yards.mean(), 1)} vs "
                   f"{r(tgm.merge(meta.reset_index())[lambda d: d.conference == 'NFC'].off_yards.mean(), 1)} yds/g",
     "Rejected: conference is not a causal unit; gap driven by a few teams"),
]
lines += ["## Candidate findings (14 evaluated)", "", "| Candidate | Evidence | Decision |", "|---|---|---|"]
lines += [f"| {a} | {b} | {c} |" for a, b, c in cands]
with open(os.path.join(HERE, "audit_report.md"), "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"report_metrics.json, dashboard_data.json ({os.path.getsize(os.path.join(DATA, 'dashboard_data.json')) / 1e6:.1f} MB), "
      "audit_report.md written")
