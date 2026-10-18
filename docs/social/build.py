# -*- coding: utf-8 -*-
"""Build the November 2026 social calendar workbook (and the JSON the playbook page reads).

    python3 docs/social/build.py                 # writes the .xlsx next to this file
    python3 docs/social/build.py --json out.json # also writes the page data
"""
import datetime as dt
import json
import os
import sys

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import strategy as S  # noqa: E402
from posts import POSTS  # noqa: E402

OUT = os.path.join(HERE, "Mada_Social_Calendar_Nov2026.xlsx")

GREEN, SAND, GOLD, INK = "1E352D", "E9E2D8", "D9B77A", "0F1A16"
PLATFORM = {
    "IG": ("Instagram", "F3E1EC"),
    "TT": ("TikTok", "DDEFF0"),
    "X": ("X", "E6E6E6"),
    "LI": ("LinkedIn", "DCE7F5"),
}
PILLAR = {p["code"]: p["name"] for p in S.PILLARS}
STATUSES = S.STATUSES

F = "Arial"
thin = Side(style="thin", color="D8CFC1")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")
RTL = Alignment(wrap_text=True, vertical="top", horizontal="right", readingOrder=2)


def date_of(d):
    return dt.date(2026, 11, d)


def post_id(p):
    """Stable id for a post (day-platform-time). The playbook page keys shared status and owner on it."""
    return f"{p['d']:02d}-{p['p']}-{p['t'].replace(':', '')}"


def sorted_posts():
    order = {"IG": 0, "TT": 1, "X": 2, "LI": 3}
    return [dict(p, id=post_id(p)) for p in sorted(POSTS, key=lambda p: (p["d"], order[p["p"]], p["t"]))]


def header(ws, row, labels, widths=None, fill=GREEN):
    for i, label in enumerate(labels, 1):
        c = ws.cell(row=row, column=i, value=label)
        c.font = Font(name=F, bold=True, color="FFFFFF" if fill == GREEN else INK, size=10)
        c.fill = PatternFill("solid", fgColor=fill)
        c.alignment = Alignment(wrap_text=True, vertical="center")
        c.border = BORDER
    if widths:
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[get_column_letter(i)].width = w


def title(ws, text, sub=None):
    ws["A1"] = text
    ws["A1"].font = Font(name=F, bold=True, size=16, color=GREEN)
    if sub:
        ws["A2"] = sub
        ws["A2"].font = Font(name=F, italic=True, size=10, color="5D7A6E")
    ws.sheet_view.showGridLines = False


def table(ws, start_row, labels, rows, widths, rtl_cols=()):
    header(ws, start_row, labels, widths)
    for r, row in enumerate(rows, start_row + 1):
        for c, val in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=val)
            cell.font = Font(name=F, size=10)
            cell.alignment = RTL if c in rtl_cols else WRAP
            cell.border = BORDER
    return start_row + len(rows)


def is_arabic(s):
    return any("؀" <= ch <= "ۿ" for ch in s or "")


# ─────────────────────────── sheets ───────────────────────────

def sheet_start(wb):
    ws = wb.active
    ws.title = "Start here"
    title(ws, "Mada Trips · Social Media Plan · November 2026",
          "Instagram · TikTok · X · LinkedIn. Researched 18 Oct 2026. Times are Riyadh (AST, UTC+3).")
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 110
    r = 4
    blocks = [
        ("Situation", S.SITUATION),
        ("Objectives", [f"{a}: {b}" for a, b in S.OBJECTIVES]),
        ("How to use this file", [
            "Calendar: every post with its hook, poster text (EN/AR), caption (AR/EN), keywords, hashtags, CTA and production direction. Filter by platform, week or pillar.",
            "Assign each post with the Owner dropdown (Mehnaz, Bilal, Musa, Abdul Rehman, Usman) and move it along with Status: Idea → Scripted → Shot → Designed → Approved → Scheduled → Posted (or Paused). 'Team board' counts who has what at each stage.",
            "After posting, fill the yellow results columns (Reach … Saves). The engagement rate calculates itself, and 'KPIs & tracking' rolls it up by platform.",
            "Rows flagged in the Notes column (OFFER, APPROVAL, SENSITIVITY) can't be scheduled without that sign-off.",
            "Scope column: Global, GCC, Saudi, Mixed, B2B or All. At least 55% of destination posts are abroad (see the mix below).",
            "Month view: the whole month at a glance. Guidelines, Keywords, Competitors and Moments hold the research behind every post.",
        ]),
    ]
    for head, lines in blocks:
        ws.cell(row=r, column=1, value=head).font = Font(name=F, bold=True, size=11, color=GREEN)
        for line in lines:
            c = ws.cell(row=r, column=2, value=line)
            c.font = Font(name=F, size=10)
            c.alignment = WRAP
            r += 1
        r += 1
    ws.cell(row=r, column=1, value="Posts this month").font = Font(name=F, bold=True, size=11, color=GREEN)
    r += 1
    header(ws, r, ["Platform", "Posts (counted from Calendar)"])
    for i, (code, (name, _)) in enumerate(PLATFORM.items(), 1):
        ws.cell(row=r + i, column=1, value=name).font = Font(name=F, size=10)
        c = ws.cell(row=r + i, column=2, value=f'=COUNTIF(Calendar!${col("Platform")}:${col("Platform")},"{name}")')
        c.font = Font(name=F, size=10)
        c.alignment = Alignment(horizontal="left")
    ws.cell(row=r + 5, column=1, value="Total").font = Font(name=F, bold=True, size=10)
    c = ws.cell(row=r + 5, column=2, value=f"=SUM(B{r + 1}:B{r + 4})")
    c.font = Font(name=F, bold=True, size=10)
    c.alignment = Alignment(horizontal="left")
    r += 7
    ws.cell(row=r, column=1, value="Where the trips go").font = Font(name=F, bold=True, size=11, color=GREEN)
    header(ws, r + 1, ["Scope", "Posts (counted from Calendar)"])
    scopes = ["Global", "GCC", "Saudi", "Mixed", "B2B", "All"]
    sc = col("Scope")
    for i, name in enumerate(scopes, 1):
        ws.cell(row=r + 1 + i, column=1, value=name).font = Font(name=F, size=10)
        c = ws.cell(row=r + 1 + i, column=2, value=f'=COUNTIF(Calendar!${sc}:${sc},"{name}")')
        c.font = Font(name=F, size=10)
        c.alignment = Alignment(horizontal="left")
    rr = r + 2 + len(scopes)
    ws.cell(row=rr, column=1, value="Global + GCC share of destination posts").font = Font(name=F, bold=True, size=10)
    c = ws.cell(row=rr, column=2, value=f"=IFERROR((B{r + 2}+B{r + 3})/(B{r + 2}+B{r + 3}+B{r + 4}+B{r + 5}),0)")
    c.font = Font(name=F, bold=True, size=10)
    c.number_format = "0%"
    c.alignment = Alignment(horizontal="left")
    ws.cell(row=rr + 1, column=1, value="Scope key: Global = abroad beyond the Gulf · GCC = Gulf neighbours · Saudi = at home · Mixed = home and abroad in one post · B2B = business services · All = brand, offers, service.").font = Font(name=F, italic=True, size=9, color="5D7A6E")


CAL_COLS = [
    ("#", 5), ("Post ID", 13), ("Date", 11), ("Day", 6), ("Time (AST)", 8), ("Platform", 10), ("Format", 14),
    ("Pillar", 15), ("Scope", 9), ("Series", 16), ("Moment / trend", 22), ("Working title", 30),
    ("Hook (first 1-3s / first line)", 34), ("On-poster / on-screen text (EN)", 30),
    ("On-poster / on-screen text (AR)", 30), ("Caption / copy (AR)", 55), ("Caption / copy (EN)", 55),
    ("Search keywords", 28), ("Hashtags (max 5)", 30), ("CTA", 20), ("Visual / audio / production direction", 55),
    ("Notes · approvals · risks", 34), ("Owner", 12), ("Status", 11),
    ("Reach", 9), ("Views", 9), ("Likes", 8), ("Comments", 9), ("Shares", 8), ("Saves", 8), ("Eng. rate", 9),
]


def col(name):
    """Column letter of a Calendar column, by header name."""
    return get_column_letter([c for c, _ in CAL_COLS].index(name) + 1)


def sheet_calendar(wb):
    ws = wb.create_sheet("Calendar")
    header(ws, 1, [c for c, _ in CAL_COLS], [w for _, w in CAL_COLS])
    ws.row_dimensions[1].height = 34
    yellow = PatternFill("solid", fgColor="FFF6D6")
    R, L, C, SH, SV = col("Reach"), col("Likes"), col("Comments"), col("Shares"), col("Saves")
    ci = {c: i + 1 for i, (c, _) in enumerate(CAL_COLS)}
    rtl = {ci["Hook (first 1-3s / first line)"], ci["On-poster / on-screen text (AR)"], ci["Caption / copy (AR)"], ci["Hashtags (max 5)"]}
    for i, p in enumerate(sorted_posts(), 1):
        r = i + 1
        name, fill = PLATFORM[p["p"]]
        vals = [i, p["id"], date_of(p["d"]), date_of(p["d"]).strftime("%a"), p["t"], name, p["f"],
                PILLAR[p["pil"]], p["sc"], p["series"], p["moment"], p["title"], p["hook"], p["pen"], p["par"],
                p["car"], p["cen"], p["kw"], p["tags"], p["cta"], p["dir"], p["note"], "", S.DEFAULT_STATUS,
                None, None, None, None, None, None,
                f'=IF(OR({R}{r}="",{R}{r}=0),"",({L}{r}+{C}{r}+{SH}{r}+{SV}{r})/{R}{r})']
        for c, v in enumerate(vals, 1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = Font(name=F, size=9, bold=(c == ci["Working title"]))
            cell.border = BORDER
            cell.alignment = RTL if (isinstance(v, str) and c in rtl and is_arabic(v)) else WRAP
            if c <= ci["Platform"]:
                cell.fill = PatternFill("solid", fgColor=fill)
            if ci["Reach"] <= c <= ci["Saves"]:
                cell.fill = yellow
        ws.cell(row=r, column=ci["Date"]).number_format = "dd mmm"
        ws.cell(row=r, column=ci["Eng. rate"]).number_format = "0.0%"
        if p["note"] and any(k in p["note"] for k in ("OFFER", "APPROVAL", "SENSITIVITY", "SALES", "MANAGEMENT")):
            ws.cell(row=r, column=ci["Notes · approvals · risks"]).font = Font(name=F, size=9, bold=True, color="A3342B")
    last = len(POSTS) + 1
    dv = DataValidation(type="list", formula1='"' + ",".join(STATUSES) + '"', allow_blank=True)
    ws.add_data_validation(dv)
    st = col("Status")
    dv.add(f"{st}2:{st}{last}")
    dvo = DataValidation(type="list", formula1='"' + ",".join(S.TEAM) + '"', allow_blank=True)
    ws.add_data_validation(dvo)
    ow = col("Owner")
    dvo.add(f"{ow}2:{ow}{last}")
    ws.conditional_formatting.add(f"{st}2:{st}{last}", FormulaRule(formula=[f'${st}2="Posted"'], fill=PatternFill("solid", fgColor="D6EAD8")))
    ws.conditional_formatting.add(f"{st}2:{st}{last}", FormulaRule(formula=[f'${st}2="Paused"'], fill=PatternFill("solid", fgColor="F4D6D2")))
    ws.freeze_panes = f"{col('Working title')}2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(CAL_COLS))}{last}"
    ws.cell(row=last + 2, column=1, value="Yellow columns = fill after posting. Eng. rate = (likes + comments + shares + saves) / reach. Use reach, not followers, so rates compare across a growing account.").font = Font(name=F, italic=True, size=9, color="5D7A6E")


def sheet_month(wb):
    ws = wb.create_sheet("Month view")
    title(ws, "November 2026 at a glance", "Saudi week: Sunday-Thursday work, Friday-Saturday weekend. Bold = moment of the day.")
    days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    header(ws, 4, days, [34] * 7)
    moment_of = {}
    weak = lambda m: not m or m.startswith(("Evergreen", "Weekend"))
    for p in sorted_posts():
        if weak(moment_of.get(p["d"])) and not weak(p["moment"]) or p["d"] not in moment_of:
            moment_of[p["d"]] = p["moment"]
    by_day = {}
    for p in sorted_posts():
        by_day.setdefault(p["d"], []).append(f"{PLATFORM[p['p']][0][:2].upper() if p['p'] != 'X' else 'X '} · {p['f'].split()[0]} · {p['title']}")
    row = 5
    first = date_of(1).isoweekday() % 7  # Sunday = 0
    day = 1
    week = 0
    while day <= 30:
        for col in range(7):
            if week == 0 and col < first or day > 30:
                continue
            text = f"{day} Nov — {moment_of.get(day, '')}\n" + "\n".join(by_day.get(day, []))
            c = ws.cell(row=row, column=col + 1, value=text)
            c.font = Font(name=F, size=8)
            c.alignment = WRAP
            c.border = BORDER
            if col >= 5:
                c.fill = PatternFill("solid", fgColor="F6F2EC")
            if 20 <= day <= 28:
                c.fill = PatternFill("solid", fgColor="FBEFD9")
            day += 1
        ws.row_dimensions[row].height = 190
        row += 1
        week += 1
    ws.cell(row=row + 1, column=1, value="Shaded gold = school autumn break (20-28 Nov). IG = Instagram · TI = TikTok · X = X · LI = LinkedIn.").font = Font(name=F, italic=True, size=9, color="5D7A6E")


def sheet_playbook(wb):
    ws = wb.create_sheet("Platform playbook")
    title(ws, "Platform playbook", "Each platform has its own job. Same idea, native execution, never a cross-post.")
    rows = []
    for pl in S.PLATFORMS:
        rows.append([pl["name"], pl["role"], pl["cadence"], pl["language"], pl["times"],
                     "\n".join("• " + x for x in pl["formats"]), "\n".join("• " + x for x in pl["rules"])])
    table(ws, 4, ["Platform", "Role", "Cadence", "Language", "Best times (AST)", "Formats that work", "Rules"],
          rows, [14, 30, 28, 28, 28, 60, 60])


def sheet_pillars(wb):
    ws = wb.create_sheet("Pillars & series")
    title(ws, "Content pillars and recurring series")
    end = table(ws, 4, ["Code", "Pillar", "Target share", "What goes here", "Series"],
                [[p["code"], p["name"], p["share"], p["what"], p["series"]] for p in S.PILLARS],
                [8, 22, 12, 70, 40])
    r = end + 2
    ws.cell(row=r, column=1, value="Actual mix this month").font = Font(name=F, bold=True, color=GREEN)
    header(ws, r + 1, ["Code", "Pillar", "Posts", "Share"])
    for i, p in enumerate(S.PILLARS):
        rr = r + 2 + i
        ws.cell(row=rr, column=1, value=p["code"]).font = Font(name=F, size=10)
        ws.cell(row=rr, column=2, value=p["name"]).font = Font(name=F, size=10)
        ws.cell(row=rr, column=3, value=f'=COUNTIF(Calendar!${col("Pillar")}:${col("Pillar")},B{rr})').font = Font(name=F, size=10)
        lo, hi = r + 2, r + 1 + len(S.PILLARS)
        c = ws.cell(row=rr, column=4, value=f"=IF(SUM($C${lo}:$C${hi})=0,0,C{rr}/SUM($C${lo}:$C${hi}))")
        c.font = Font(name=F, size=10)
        c.number_format = "0%"
    r = r + 4 + len(S.PILLARS)
    ws.cell(row=r, column=1, value="Recurring series").font = Font(name=F, bold=True, color=GREEN)
    table(ws, r + 1, ["Series", "Where", "How often", "Format"], [list(s) for s in S.SERIES], [30, 26, 18, 80])


def sheet_guidelines(wb):
    ws = wb.create_sheet("Guidelines")
    title(ws, "Brand voice, design and profile guidelines")
    r = table(ws, 4, ["Voice & copy", "Guideline"], [list(v) for v in S.VOICE], [24, 110]) + 2
    r = table(ws, r, ["Design", "Guideline"], [list(v) for v in S.DESIGN], [24, 110]) + 2
    r = table(ws, r, ["Instagram Stories", "Daily pattern"], [list(v) for v in S.STORIES], [24, 110]) + 2
    header(ws, r, ["Profile", "Display name", "Bio", "Note"])
    for i, b in enumerate(S.BIOS, 1):
        for c, v in enumerate(b, 1):
            cell = ws.cell(row=r + i, column=c, value=v)
            cell.font = Font(name=F, size=10)
            cell.alignment = RTL if c in (2, 3) and is_arabic(v) else WRAP
            cell.border = BORDER
    ws.column_dimensions["C"].width = 50
    ws.column_dimensions["D"].width = 40


def sheet_keywords(wb):
    ws = wb.create_sheet("Keywords")
    title(ws, "Keyword bank (search on TikTok, Instagram and Google)")
    r = 4
    for line in S.KEYWORD_METHOD:
        c = ws.cell(row=r, column=1, value="• " + line)
        c.font = Font(name=F, size=10)
        c.alignment = WRAP
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
        ws.row_dimensions[r].height = 28
        r += 1
    table(ws, r + 1, ["Cluster", "Arabic keywords", "English keywords"], [list(k) for k in S.KEYWORDS], [18, 80, 60], rtl_cols=(2,))


def sheet_competitors(wb):
    ws = wb.create_sheet("Competitors")
    title(ws, "Competitor analysis", "Follower counts are approximate. Instagram and TikTok analytics are login-gated, so verify by hand before quoting.")
    end = table(ws, 4, ["Brand", "Handles", "Size (approx.)", "Style", "What wins", "Gap for Mada"],
                [[c["name"], c["handles"], c["size"], c["style"], c["wins"], c["gap"]] for c in S.COMPETITORS],
                [26, 26, 26, 40, 44, 44])
    table(ws, end + 2, ["White space for Mada", "How we take it"], [list(w) for w in S.WHITE_SPACE], [26, 110])


def sheet_moments(wb):
    ws = wb.create_sheet("Moments")
    title(ws, "Moments calendar: Nov 2026 with Dec-Feb teasers")
    end = table(ws, 4, ["Date", "Moment", "Where", "How we use it", "Status", "Scope"], [list(m) for m in S.MOMENTS], [18, 56, 26, 36, 20, 9])
    ws.cell(row=end + 2, column=1, value="Cancelled / moved / unconfirmed: don't promote").font = Font(name=F, bold=True, color="A3342B")
    for i, line in enumerate(S.CANCELLED, 1):
        ws.cell(row=end + 2 + i, column=1, value="• " + line).font = Font(name=F, size=10)


def sheet_destinations(wb):
    ws = wb.create_sheet("Global destinations")
    title(ws, "Where Saudis travel abroad this winter", "Ranked synthesis of Almosafer, Wego and winter seasonality (Oct 2026). Visa rules change: verify before every post.")
    end = table(ws, 4, ["What we know", "Insight"], [list(x) for x in S.GLOBAL_INSIGHTS], [22, 120])
    table(ws, end + 2, ["#", "Destination", "Why now", "Segment", "Visa for Saudis", "Flight from RUH", "Direct?", "Best months"],
          [list(x) for x in S.TOP_DESTINATIONS], [5, 30, 48, 20, 24, 14, 16, 16])


def sheet_team(wb):
    ws = wb.create_sheet("Team board")
    title(ws, "Team board: who's on what", "Counts update from the Owner and Status columns in Calendar. Filter Calendar by Owner or Status to see each person's list.")
    ow, st = col("Owner"), col("Status")
    labels = ["Person"] + STATUSES + ["Total", "Posted %"]
    header(ws, 4, labels, [18] + [11] * len(STATUSES) + [9, 10])
    people = S.TEAM + ["Unassigned"]
    for i, name in enumerate(people, 5):
        ws.cell(row=i, column=1, value=name).font = Font(name=F, size=10, bold=True)
        for j, s in enumerate(STATUSES, 2):
            L = get_column_letter(j)
            if name == "Unassigned":  # everything in this status not owned by a named person
                f = f'=COUNTIF(Calendar!${st}:${st},"{s}")-SUM({L}5:{L}{i - 1})'
            else:
                f = f'=COUNTIFS(Calendar!${ow}:${ow},"{name}",Calendar!${st}:${st},"{s}")'
            c = ws.cell(row=i, column=j, value=f)
            c.font = Font(name=F, size=10)
            c.border = BORDER
        tot = get_column_letter(len(STATUSES) + 2)
        first, lastc = get_column_letter(2), get_column_letter(len(STATUSES) + 1)
        c = ws.cell(row=i, column=len(STATUSES) + 2, value=f"=SUM({first}{i}:{lastc}{i})")
        c.font = Font(name=F, size=10, bold=True)
        posted = get_column_letter(STATUSES.index("Posted") + 2)
        c = ws.cell(row=i, column=len(STATUSES) + 3, value=f"=IF({tot}{i}=0,0,{posted}{i}/{tot}{i})")
        c.font = Font(name=F, size=10)
        c.number_format = "0%"
    end = 4 + len(people)
    ws.cell(row=end + 1, column=1, value="All posts").font = Font(name=F, size=10, bold=True)
    for j in range(2, len(STATUSES) + 3):
        L = get_column_letter(j)
        c = ws.cell(row=end + 1, column=j, value=f"=SUM({L}5:{L}{end})")
        c.font = Font(name=F, size=10, bold=True)
    ws.conditional_formatting.add(f"B5:{get_column_letter(len(STATUSES) + 1)}{end}",
                                  FormulaRule(formula=["B5>0"], fill=PatternFill("solid", fgColor="EFE9E0")))
    ws.cell(row=end + 3, column=1, value="Team: " + ", ".join(S.TEAM) + ". Add a name to S.TEAM in strategy.py to extend the dropdowns and this board.").font = Font(name=F, italic=True, size=9, color="5D7A6E")


def sheet_kpis(wb):
    ws = wb.create_sheet("KPIs & tracking")
    title(ws, "KPIs and tracking", "Targets for month one, set against published benchmarks. The live columns read the Calendar results.")
    header(ws, 4, ["KPI", "Month-1 target", "Benchmark / why"], [44, 22, 90])
    for i, k in enumerate(S.KPIS, 5):
        for c, v in enumerate(k, 1):
            cell = ws.cell(row=i, column=c, value=v)
            cell.font = Font(name=F, size=10)
            cell.alignment = WRAP
            cell.border = BORDER
    r = 5 + len(S.KPIS) + 2
    ws.cell(row=r, column=1, value="Live results by platform (from Calendar)").font = Font(name=F, bold=True, color=GREEN)
    header(ws, r + 1, ["Platform", "Posts planned", "Posted", "Total reach", "Avg eng. rate (posted)", "Total saves", "Total shares"])
    for letter, w in zip("DEFG", (16, 22, 14, 14)):
        ws.column_dimensions[letter].width = w
    for i, (code, (name, _)) in enumerate(PLATFORM.items()):
        rr = r + 2 + i
        cells = [name,
                 f'=COUNTIF(Calendar!${col("Platform")}:${col("Platform")},A{rr})',
                 f'=COUNTIFS(Calendar!${col("Platform")}:${col("Platform")},A{rr},Calendar!${col("Status")}:${col("Status")},"Posted")',
                 f'=SUMIF(Calendar!${col("Platform")}:${col("Platform")},A{rr},Calendar!${col("Reach")}:${col("Reach")})',
                 f'=IFERROR(AVERAGEIFS(Calendar!${col("Eng. rate")}:${col("Eng. rate")},Calendar!${col("Platform")}:${col("Platform")},A{rr},Calendar!${col("Status")}:${col("Status")},"Posted"),"")',
                 f'=SUMIF(Calendar!${col("Platform")}:${col("Platform")},A{rr},Calendar!${col("Saves")}:${col("Saves")})',
                 f'=SUMIF(Calendar!${col("Platform")}:${col("Platform")},A{rr},Calendar!${col("Shares")}:${col("Shares")})']
        for c, v in enumerate(cells, 1):
            cell = ws.cell(row=rr, column=c, value=v)
            cell.font = Font(name=F, size=10)
            cell.border = BORDER
        ws.cell(row=rr, column=5).number_format = "0.0%"
        ws.cell(row=rr, column=4).number_format = "#,##0"


def sheet_ops(wb):
    ws = wb.create_sheet("Workflow & sensitivity")
    title(ws, "Weekly workflow and sensitivity protocol")
    r = table(ws, 4, ["When", "What"], [list(w) for w in S.WORKFLOW], [22, 120]) + 2
    ws.cell(row=r, column=1, value="Sensitivity protocol").font = Font(name=F, bold=True, color="A3342B")
    for i, line in enumerate(S.SENSITIVITY, 1):
        c = ws.cell(row=r + i, column=2, value=line)
        c.font = Font(name=F, size=10)
        c.alignment = WRAP
        ws.cell(row=r + i, column=1, value=i).font = Font(name=F, size=10)


def sheet_sources(wb):
    ws = wb.create_sheet("Sources")
    title(ws, "Sources", "Research compiled 18 Oct 2026. Vendor benchmarks use different methods, so only compare figures from the same source.")
    header(ws, 4, ["Source", "URL"], [60, 110])
    for i, (name, url) in enumerate(S.SOURCES, 5):
        ws.cell(row=i, column=1, value=name).font = Font(name=F, size=10)
        c = ws.cell(row=i, column=2, value=url)
        c.hyperlink = url
        c.font = Font(name=F, size=10, color="1F5FAD", underline="single")


def build_xlsx():
    wb = Workbook()
    sheet_start(wb)
    sheet_calendar(wb)
    sheet_team(wb)
    sheet_month(wb)
    sheet_playbook(wb)
    sheet_pillars(wb)
    sheet_guidelines(wb)
    sheet_keywords(wb)
    sheet_competitors(wb)
    sheet_moments(wb)
    sheet_destinations(wb)
    sheet_kpis(wb)
    sheet_ops(wb)
    sheet_sources(wb)
    wb.save(OUT)
    return OUT


def day_notes():
    """The default scrapbook decorations, with each photo shrunk to a small inline JPEG."""
    import base64
    import io
    try:
        from PIL import Image
    except ImportError:  # photos are optional; labels and stickers still work
        Image = None
    root = os.path.dirname(os.path.dirname(HERE))
    out = {}
    for day, note in S.DAY_NOTES.items():
        note = dict(note)
        src = note.pop("photo", None)
        if src and Image:
            im = Image.open(os.path.join(root, src)).convert("RGB")
            w, h = im.size
            side = min(w, h)  # square crop from the centre, like a polaroid
            im = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2)).resize((220, 220))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=68, optimize=True, progressive=True)
            note["photo"] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
        out[day] = note
    return out


def build_json(path):
    data = {k: getattr(S, k) for k in ("MONTH", "SITUATION", "OBJECTIVES", "PLATFORMS", "PILLARS", "SERIES", "STORIES",
                                       "VOICE", "DESIGN", "BIOS", "KEYWORDS", "KEYWORD_METHOD", "COMPETITORS", "WHITE_SPACE",
                                       "MOMENTS", "CANCELLED", "KPIS", "WORKFLOW", "SENSITIVITY", "SOURCES",
                                       "GLOBAL_INSIGHTS", "TOP_DESTINATIONS", "TEAM", "STATUSES", "DEFAULT_STATUS", "HOOKS", "CAPTION_FORMULAS", "POST_CHECKLIST")}
    data["POSTS"] = sorted_posts()
    data["DAY_NOTES"] = day_notes()
    data["TILE_COLORS"] = S.TILE_COLORS
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    return path


def build_html(path):
    """Inline the plan data into playbook_template.html (the shareable playbook page)."""
    tmp = path + ".json"
    build_json(tmp)
    with open(tmp, encoding="utf-8") as fh:
        payload = fh.read().replace("</", "<\\/")
    os.remove(tmp)
    with open(os.path.join(HERE, "playbook_template.html"), encoding="utf-8") as fh:
        page = fh.read().replace("/*DATA*/", payload)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(page)
    return path


if __name__ == "__main__":
    print(build_xlsx())
    if "--json" in sys.argv:
        print(build_json(sys.argv[sys.argv.index("--json") + 1]))
    if "--html" in sys.argv:
        print(build_html(sys.argv[sys.argv.index("--html") + 1]))
