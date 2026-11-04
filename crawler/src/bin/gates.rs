// 检票口 research for train.deyaochen.com (README "检票口 short forms"); run by .github/workflows/gates.yml.
//
//   gates check  TIMETABLE OUT.jsonl YYYY-MM-DD I/N   12306's own 检票口 query for every (train, boarding stop) whose
//                                                      origin date is that day, shard I of N
//   gates stops  TIMETABLE OUT.jsonl YYYYMMDD   I/N   the WeChat mini-program's stops for every train that day (each
//                                                      stop's wicket; filled in for trains running today), shard I of N
//   gates labels OUT.json IN.jsonl…                    every station's exact 检票口 strings -> a short form, where the
//                                                      strict grammar below reads the whole string; else none
//
// Rows written by the crawls: {"code": telecode, "station": name, "wicket": 12306's string}.
use anyhow::{anyhow, Result};
use chrono::{Duration, NaiveDate};
use futures::stream::{self, StreamExt};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::sync::OnceLock;
use std::time::Duration as StdDuration;

const UA_DESKTOP: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const UA_WECHAT: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40";
const WORKERS: usize = 3;

#[tokio::main]
async fn main() -> Result<()> {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("check") if a.len() == 6 => crawl(&a[2], &a[3], &a[4], &a[5], true).await,
        Some("stops") if a.len() == 6 => crawl(&a[2], &a[3], &a[4], &a[5], false).await,
        Some("labels") if a.len() >= 4 => labels(&a[2], &a[3..]),
        _ => Err(anyhow!("usage: gates check|stops TIMETABLE OUT DATE I/N | gates labels OUT IN…")),
    }
}

// ---- the crawls ------------------------------------------------------------------------------------------------

async fn post_form(c: &reqwest::Client, url: &str, referer: Option<&str>, form: &[(&str, &str)]) -> Result<Value> {
    let mut wait = 3;
    for attempt in 0..5 {
        let mut r = c.post(url).form(form);
        if let Some(rf) = referer { r = r.header("Referer", rf); }
        match r.send().await {
            Ok(res) => match res.json::<Value>().await {
                Ok(v) => return Ok(v),
                Err(e) if attempt == 4 => return Err(e.into()),
                Err(_) => {}
            },
            Err(e) if attempt == 4 => return Err(e.into()),
            Err(_) => {}
        }
        tokio::time::sleep(StdDuration::from_secs(wait)).await;
        wait *= 2;
    }
    unreachable!()
}

async fn crawl(timetable: &str, out: &str, day: &str, shard: &str, check: bool) -> Result<()> {
    let tt: Value = serde_json::from_str(&std::fs::read_to_string(timetable)?)?;
    let (i, n) = shard.split_once('/').ok_or_else(|| anyhow!("shard is I/N"))?;
    let (i, n): (usize, usize) = (i.parse()?, n.parse()?);
    let st = tt["stations"].as_array().ok_or_else(|| anyhow!("no stations"))?;
    let station = |k: usize| (st[k][0].as_str().unwrap_or("").to_string(), st[k][1].as_str().unwrap_or("").to_string());
    // check: one job per (train, boarding stop), the date it leaves that stop; stops: one per train
    let mut jobs: Vec<(String, String, String, String)> = vec![];   // code, telecode, name, date
    for t in tt["trains"].as_array().ok_or_else(|| anyhow!("no trains"))? {
        let code = t[0].as_str().unwrap_or("").to_string();
        let stops: Vec<i64> = t[2].as_array().map(|v| v.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
        if check {
            let d0 = NaiveDate::parse_from_str(day, "%Y-%m-%d")?;
            for p in 0..(stops.len() / 3).saturating_sub(1) {
                let (tele, name) = station(stops[p * 3] as usize);
                let date = (d0 + Duration::days(stops[p * 3 + 2].div_euclid(1440))).format("%Y-%m-%d").to_string();
                jobs.push((code.clone(), tele, name, date));
            }
        } else {
            jobs.push((code, String::new(), String::new(), day.to_string()));
        }
    }
    let jobs: Vec<_> = jobs.into_iter().enumerate().filter(|(k, _)| k % n == i).map(|(_, j)| j).collect();
    let c = reqwest::Client::builder().user_agent(if check { UA_DESKTOP } else { UA_WECHAT }).timeout(StdDuration::from_secs(20)).build()?;
    let mut f = std::fs::File::create(out)?;
    let (mut done, mut failed, total) = (0usize, 0usize, jobs.len());
    let mut results = stream::iter(jobs.into_iter().map(|(code, tele, name, date)| {
        let c = c.clone();
        async move {
            tokio::time::sleep(StdDuration::from_millis(200)).await;
            let rows: Result<Vec<Value>> = if check {
                post_form(&c, "https://www.12306.cn/index/otn/index12306/queryTicketCheck",
                          Some("https://www.12306.cn/index/view/infos/ticket_check.html"),
                          &[("trainDate", &date), ("station_train_code", &code), ("from_station_telecode", &tele)]).await
                    .map(|v| {
                        let g = v["data"]["trainPlatform"].as_str().unwrap_or("").trim().to_string();
                        if g.is_empty() { vec![] } else { vec![json!({"code": tele, "station": name, "wicket": g})] }
                    })
            } else {
                post_form(&c, "https://mobile.12306.cn/wxxcx/wechat/main/travelServiceQrcodeTrainInfo", None,
                          &[("trainCode", &code), ("startDay", &date), ("startTime", ""), ("endDay", ""), ("endTime", "")]).await
                    .map(|v| v["data"]["trainDetail"]["stopTime"].as_array().cloned().unwrap_or_default().iter().filter_map(|s| {
                        let w = s["wicket"].as_str().unwrap_or("").trim().to_string();
                        let tele = s["stationTelecode"].as_str().unwrap_or("");
                        (!w.is_empty() && !w.chars().all(|ch| ch == '-') && !tele.is_empty())
                            .then(|| json!({"code": tele, "station": s["stationName"], "wicket": w}))
                    }).collect())
            };
            rows
        }
    })).buffer_unordered(WORKERS);
    while let Some(r) = results.next().await {
        match r {
            Ok(rows) => for row in rows { writeln!(f, "{row}")?; },
            Err(_) => failed += 1,
        }
        done += 1;
        if done % 1000 == 0 { eprintln!("{done}/{total}, {failed} failed"); }
    }
    eprintln!("done {done}/{total}, {failed} failed");
    Ok(())
}

// ---- the short forms -------------------------------------------------------------------------------------------

fn re(s: &str) -> Regex { Regex::new(s).unwrap() }
macro_rules! rx { ($name:ident, $s:expr) => { fn $name() -> &'static Regex { static R: OnceLock<Regex> = OnceLock::new(); R.get_or_init(|| re($s)) } }; }
rx!(hall_side, r"^(?:三层候车室|二层候车室|高架层)?([AB])(\d{1,2})(?:检票口)?$");   // 广州南: 三层候车室A21
rx!(hall_floor, r"^一层换乘区(\d{1,2})$");                                     // 广州南: the same gate downstairs
rx!(fast_lane, r"^快速进站\d厅(\d{1,2})、(\d{1,2})检票口$");                     // 北京南: the fast lane to the same gates
rx!(strip_for_check, r"(进站)?检票口$|^(?:检票口|第)+|号检票口$|号$");
rx!(names_a_place, r"[层楼候厅室区站台栋东西南北通道自助特殊口号]");            // floors, halls, sides: left as written
rx!(lead, r"^(?:检票口|第)+");
rx!(tail, r"(号)?(进站)?(检票口)?$");
rx!(tok, r"([AB]?)(\d{1,2})([AB]?)");
rx!(already_short, r"^(\d{1,2}[AB]?|[AB]\d{1,2})$");

type Gate = (u32, String);   // number, side ("" when none named)

// a gate number, in ASCII or full-width digits (北京: 第１、２检票口)
fn num(s: &str) -> Option<u32> {
    s.chars().map(|c| c.to_digit(10).or_else(|| ('０'..='９').contains(&c).then(|| c as u32 - '０' as u32))).try_fold(0, |n, d| Some(n * 10 + d?))
}

fn tokens(part: &str) -> Option<Vec<Gate>> {
    if let Some(m) = hall_side().captures(part) { return Some(vec![(num(&m[2])?, m[1].to_string())]); }
    if let Some(m) = hall_floor().captures(part) { return Some(vec![(num(&m[1])?, String::new())]); }
    if names_a_place().is_match(&strip_for_check().replace_all(part, "")) { return None; }
    let s = lead().replace_all(part, "").to_string();
    let s = tail().replace_all(&s, "").to_string();
    if s.is_empty() { return None; }
    let (mut out, mut prev_sep): (Vec<Gate>, Option<char>) = (vec![], None);
    let mut piece = String::new();
    let mut pieces: Vec<(Option<char>, String)> = vec![];   // the separator before each piece
    for ch in s.chars() {
        if matches!(ch, '、' | '_' | '-') { pieces.push((prev_sep, std::mem::take(&mut piece))); prev_sep = Some(ch); } else { piece.push(ch); }
    }
    pieces.push((prev_sep, piece));
    for (sep, piece) in pieces {
        let ms: Vec<_> = tok().captures_iter(&piece).collect();
        if ms.is_empty() || ms.iter().map(|m| m[0].to_string()).collect::<String>() != piece { return None; }
        if ms.len() > 1 && !ms.iter().all(|m| !m[1].is_empty() || !m[3].is_empty()) { return None; }   // 809: ambiguous
        let mut here: Vec<Gate> = vec![];
        for m in &ms {
            if !m[1].is_empty() && !m[3].is_empty() { return None; }
            here.push((num(&m[2])?, format!("{}{}", &m[1], &m[3])));
        }
        if sep == Some('-') {
            // a range: 6A-7A (at most four gates, the same side)
            let last = out.last()?.clone();
            if here.len() != 1 || last.1 != here[0].1 || !(last.0 < here[0].0 && here[0].0 <= last.0 + 4) { return None; }
            here = ((last.0 + 1)..=here[0].0).map(|k| (k, last.1.clone())).collect();
        }
        out.extend(here);
    }
    Some(out)
}

fn label(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let (mut toks, mut fast): (Vec<Gate>, Vec<u32>) = (vec![], vec![]);
    for part in raw.split(',') {
        let part = part.trim();
        if let Some(m) = fast_lane().captures(part) { fast.push(num(&m[1])?); fast.push(num(&m[2])?); continue; }
        toks.extend(tokens(part)?);
    }
    if toks.is_empty() { return None; }
    let nums: BTreeSet<u32> = toks.iter().map(|t| t.0).collect();
    if fast.iter().any(|n| !nums.contains(n)) { return None; }
    let out = nums.iter().map(|&n| {
        let sides: BTreeSet<&str> = toks.iter().filter(|t| t.0 == n).map(|t| t.1.as_str()).collect();
        // a gate on both sides, or named without a side: its number alone; else with its side (12A)
        if sides.contains("") || sides == BTreeSet::from(["A", "B"]) { n.to_string() } else { sides.iter().map(|x| format!("{n}{x}")).collect() }
    }).collect::<Vec<_>>().join("/");
    (out != raw).then_some(out)
}

fn labels(out: &str, inputs: &[String]) -> Result<()> {
    let mut seen: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for path in inputs {
        for line in std::fs::read_to_string(path)?.lines().filter(|l| !l.trim().is_empty()) {
            let v: Value = serde_json::from_str(line)?;
            let (code, w) = (v["code"].as_str().unwrap_or(""), v["wicket"].as_str().unwrap_or("").trim());
            if !code.is_empty() && !w.is_empty() && !w.chars().all(|c| c == '-') { seen.entry(code.to_string()).or_default().insert(w.to_string()); }
        }
    }
    let (mut table, mut kept): (BTreeMap<&String, BTreeMap<&String, String>>, usize) = (BTreeMap::new(), 0);
    for (code, raws) in &seen {
        for raw in raws {
            match label(raw) {
                Some(l) => { table.entry(code).or_default().insert(raw, l); }
                None => if !already_short().is_match(raw) { kept += 1; },
            }
        }
    }
    std::fs::write(out, serde_json::to_string(&table)?)?;
    eprintln!("stations {}, strings {}, short forms {}, left as written {kept}",
              seen.len(), seen.values().map(BTreeSet::len).sum::<usize>(), table.values().map(BTreeMap::len).sum::<usize>());
    Ok(())
}
