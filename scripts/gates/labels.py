# Offline: every (station, exact 检票口 string) seen in the crawl -> a short label, or none (the page then shows the
# Research tool (china-train README "检票口 short forms"), run by hand: see scripts/gates/.
# original). Strict: a string must parse completely into gate tokens; anything else is left alone.
import json, re, sys, collections
NUM = r"(\d{1,2})([AB]?)"
PARTS = [
    re.compile(rf"^(?:{NUM}、)*{NUM}(?:进站)?(?:检票口)?$"),       # 6A、7A / 20检票口 / 6A、7A进站检票口 / 3
    re.compile(rf"^检票口{NUM}$"),                                  # 检票口1
    re.compile(r"^([AB])(\d{1,2})$"),                               # A5 (side first)
    re.compile(r"^(?:三层候车室|二层候车室|高架层)?([AB])(\d{1,2})(?:检票口)?$"),   # 三层候车室A21
    re.compile(r"^一层换乘区(\d{1,2})$"),                            # 广州南: the same gate number downstairs
]
FAST = re.compile(r"^快速进站\d厅(\d{1,2})、(\d{1,2})检票口$")       # 北京南: the fast lane to the same gates

TOK = re.compile(r"([AB]?)(\d{1,2})([AB]?)")
def tokens(part):
    for p in PARTS[3:5]:   # 广州南's halls: 三层候车室A21 / 一层换乘区21
        m = p.match(part)
        if m: return [(int(m[2]), m[1])] if p is PARTS[3] else [(int(m[1]), "")]
    if re.search(r"[层楼候厅室区站台楼栋号层东西南北通道自助特殊口]", re.sub(r"(进站)?检票口$|^(?:检票口|第)+|号检票口$|号$", "", part)): return None
    s = re.sub(r"^(?:检票口|第)+", "", part)
    s = re.sub(r"(号)?(进站)?(检票口)?$", "", s)
    if not s: return None
    out, rest = [], s
    pieces = re.split(r"([、_\-])", s)
    prev_sep = None
    for piece in pieces:
        if piece in ("、", "_", "-"): prev_sep = piece; continue
        ms = list(TOK.finditer(piece))
        if not ms or "".join(m[0] for m in ms) != piece: return None
        if len(ms) > 1 and not all(m[1] or m[3] for m in ms): return None   # 809: digits run together, ambiguous
        here = []
        for m in ms:
            if m[1] and m[3]: return None
            here.append((int(m[2]), m[1] or m[3]))
        if prev_sep == "-" and out and len(here) == 1 and out[-1][1] == here[0][1] and out[-1][0] < here[0][0] <= out[-1][0] + 4:
            here = [(n, here[0][1]) for n in range(out[-1][0] + 1, here[0][0] + 1)]
        elif prev_sep == "-": return None
        out += here
        prev_sep = None
    return out

def label(raw):
    raw = raw.strip()
    toks, fast = [], []
    for part in raw.split(","):
        part = part.strip()
        m = FAST.match(part)
        if m: fast += [int(m[1]), int(m[2])]; continue
        t = tokens(part)
        if t is None: return None
        toks += t
    if not toks: return None
    nums = sorted({n for n, _ in toks})
    if any(n not in nums for n in fast): return None
    sides = {n: {s for m, s in toks if m == n} for n in nums}
    # every gate on both sides (or no sides named): the numbers alone; else each gate with its side
    # a gate on both sides, or named without a side: its number alone; else with its side (12A)
    whole = lambda n: "" in sides[n] or sides[n] == {"A", "B"}
    out = "/".join(str(n) if whole(n) else "".join(f"{n}{x}" for x in sorted(sides[n])) for n in nums)
    return None if out == raw else out

rows = collections.defaultdict(collections.Counter); names = {}
for l in open(sys.argv[1]):
    x = json.loads(l); w = (x["wicket"] or "").strip()
    if w and set(w) != {"-"} and x["code"]: rows[x["code"]][w] += 1; names[x["code"]] = x["station"]
table, unparsed = {}, collections.Counter()
for code, c in sorted(rows.items()):
    for raw in c:
        lab = label(raw)
        if lab: table.setdefault(code, {})[raw] = lab
        elif not re.fullmatch(r"\d{1,2}[AB]?|[AB]\d{1,2}", raw): unparsed[(names[code], raw)] += c[raw]
json.dump(table, open(sys.argv[2], "w"), ensure_ascii=False, sort_keys=True, indent=0)
print("stations", len(rows), "strings", sum(len(c) for c in rows.values()), "labelled", sum(len(v) for v in table.values()), "kept as is", len(unparsed))
with open(sys.argv[3], "w") as f:
    for (n, raw), k in sorted(unparsed.items()): f.write(f"{n}\t{raw}\t{k}\n")
