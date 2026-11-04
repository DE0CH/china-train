# One-off research crawl: every train in the timetable, today's run, 12306's stops -> (station, 检票口, exit, waiting room)
import json, sys, time, random, threading, urllib.request, urllib.parse, datetime
from concurrent.futures import ThreadPoolExecutor
tt = json.load(open(sys.argv[1])); out = sys.argv[2]
day = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y%m%d")
codes = sorted({t[0] for t in tt["trains"]})
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40"
lock = threading.Lock(); f = open(out, "a"); done = [0]; errs = [0]
def one(code):
    body = urllib.parse.urlencode({"trainCode": code, "startDay": day, "startTime": "", "endDay": "", "endTime": ""}).encode()
    for attempt in range(4):
        try:
            r = urllib.request.urlopen(urllib.request.Request("https://mobile.12306.cn/wxxcx/wechat/main/travelServiceQrcodeTrainInfo", body, {"User-Agent": UA}), timeout=20)
            j = json.loads(r.read()); stops = (((j.get("data") or {}).get("trainDetail") or {}).get("stopTime")) or []
            rows = [{"train": code, "station": s.get("stationName"), "code": s.get("stationTelecode"), "no": s.get("stationNo"),
                     "arrive": s.get("arriveTime"), "depart": s.get("startTime"), "wicket": s.get("wicket"), "exit": s.get("exit"),
                     "waiting": s.get("waitingRoom")} for s in stops]
            with lock:
                for x in rows: f.write(json.dumps(x, ensure_ascii=False) + "\n")
                done[0] += 1
                if done[0] % 500 == 0: print(f"{done[0]}/{len(codes)} errors {errs[0]}", flush=True); f.flush()
            time.sleep(0.15); return
        except Exception as e:
            time.sleep(2 * (attempt + 1) + random.random())
    with lock: errs[0] += 1
with ThreadPoolExecutor(4) as ex: list(ex.map(one, codes))
f.close(); print(f"DONE {done[0]}/{len(codes)} errors {errs[0]}", flush=True)
