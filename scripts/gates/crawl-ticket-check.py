# One-off research crawl: 12306's own 检票口 query (www.12306.cn queryTicketCheck) for every (train, boarding stop)
# in the timetable, on its run that leaves its origin on DAY. Resumable: skips pairs already in the output.
import json, sys, time, random, threading, urllib.request, urllib.parse, datetime, os
from concurrent.futures import ThreadPoolExecutor
tt = json.load(open(sys.argv[1])); out = sys.argv[2]; day = datetime.date.fromisoformat(sys.argv[3]); limit = int(sys.argv[4]) if len(sys.argv) > 4 else 0
st = tt["stations"]
pairs = []
for code, no, stops in tt["trains"]:
    for p in range(len(stops) // 3 - 1):
        s, dep = stops[p * 3], stops[p * 3 + 2]
        pairs.append((code, st[s][0], st[s][1], str(day + datetime.timedelta(days=dep // 1440))))
done = set()
if os.path.exists(out):
    for l in open(out): x = json.loads(l); done.add((x["train"], x["code"]))
pairs = [p for p in pairs if (p[0], p[1]) not in done]
if limit: pairs = pairs[:limit]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
lock = threading.Lock(); f = open(out, "a"); n = [0]; errs = [0]; t0 = time.time()
def one(p):
    code, tele, name, date = p
    body = urllib.parse.urlencode({"trainDate": date, "station_train_code": code, "from_station_telecode": tele}).encode()
    for attempt in range(5):
        try:
            r = urllib.request.urlopen(urllib.request.Request("https://www.12306.cn/index/otn/index12306/queryTicketCheck", body,
                {"User-Agent": UA, "Referer": "https://www.12306.cn/index/view/infos/ticket_check.html"}), timeout=20)
            j = json.loads(r.read()); d = j.get("data") or {}
            with lock:
                f.write(json.dumps({"train": code, "code": tele, "station": name, "date": date, "result": d.get("result"), "gate": d.get("trainPlatform")}, ensure_ascii=False) + "\n")
                n[0] += 1
                if n[0] % 1000 == 0: print(f"{n[0]}/{len(pairs)} errors {errs[0]} {n[0]/(time.time()-t0):.1f}/s", flush=True); f.flush()
            time.sleep(0.2); return
        except Exception as e:
            time.sleep(3 * (attempt + 1) + random.random())
    with lock: errs[0] += 1
with ThreadPoolExecutor(6) as ex: list(ex.map(one, pairs))
f.close(); print(f"DONE {n[0]}/{len(pairs)} errors {errs[0]} {time.time()-t0:.0f}s", flush=True)
