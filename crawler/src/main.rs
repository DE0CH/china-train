// Builds the national timetable the route planner searches: every station (12306's station_name.js)
// and every train with its stops and times, written as one compact JSON file.
//
//   timetable OUT.json [--seed FILE]… [--search-minutes N] [YYYY-MM-DD …]
//   (default dates: the next Wednesday and the next Saturday)
//
// Sources, all 12306's own and free (12306's transfer planner, lcquery, refuses every route that
// touches 香港西九龙, so the app plans itself):
//   - train list: search.12306.cn/search/v1/train/search?keyword=PREFIX&date=YYYYMMDD returns at most
//     200 trains per keyword (99 for longer prefixes), so prefixes are split digit by digit until a
//     keyword returns fewer. It blocks an IP (HTTP 403) after a burst: slow, with backoff.
//   - stops: kyfw.12306.cn/otn/queryTrainInfo/query?leftTicketDTO.train_no=…&leftTicketDTO.train_date=…
//     (no cookie needed, takes ~15 requests/s).
// The search API also blocks whole networks, so it gets a time budget (--search-minutes, default
// 20) and its failures are not fatal: the train list is the union of what it found and the seeds
// (a previous timetable.json, or crawler/seed-trains.json, a JSON list of {train_no,
// station_train_code}). Every candidate's stops are then fetched for the crawl dates; a seed
// train with no stops on either date no longer runs and drops out.
// A train only running on other days is missed; the dates cover a weekday and a weekend day.
use anyhow::{bail, Context, Result};
use chrono::{Datelike, Duration, Local, NaiveDate, Weekday};
use futures::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::time::Duration as StdDuration;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const FIRST: &str = "GDCZTKSYL0123456789";

#[derive(Deserialize, Clone)]
struct Listed { train_no: String, station_train_code: String }

#[derive(Deserialize)]
struct Stop { station_name: String, arrive_time: String, start_time: String, #[serde(default)] arrive_day_diff: String }

async fn get_text(c: &reqwest::Client, url: &str, tries: u32, base_wait: u64) -> Result<String> {
    let mut wait = base_wait;
    for i in 0..tries {
        match c.get(url).send().await {
            Ok(r) if r.status().is_success() => return Ok(r.text().await?),
            Ok(r) => eprintln!("{} → HTTP {} (try {})", url, r.status(), i + 1),
            Err(e) => eprintln!("{} → {} (try {})", url, e, i + 1),
        }
        tokio::time::sleep(StdDuration::from_secs(wait)).await;
        wait = (wait * 2).min(300);
    }
    bail!("gave up on {url}")
}

async fn stations(c: &reqwest::Client) -> Result<Vec<[String; 5]>> {
    let js = get_text(c, "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js", 5, 5).await?;
    // @bjb|北京北|VAP|beijingbei|bjb|0|0357|北京|||
    let mut out = Vec::new();
    for e in js.split('@').skip(1) {
        let f: Vec<&str> = e.split('|').collect();
        if f.len() >= 8 && f[2].len() == 3 {
            out.push([f[2].into(), f[1].split_whitespace().collect(), f[3].into(), f[4].into(), f[7].into()]);
        }
    }
    if out.len() < 1000 { bail!("station list looked wrong ({} stations)", out.len()) }
    Ok(out)
}

async fn list_trains(c: &reqwest::Client, date: NaiveDate, trains: &mut BTreeMap<String, (String, Option<NaiveDate>)>) -> Result<()> {
    let d = date.format("%Y%m%d").to_string();
    let mut front: Vec<String> = FIRST.chars().map(String::from).collect();
    let mut calls = 0;
    let mut found = 0;
    while !front.is_empty() {
        let results: Vec<(String, Result<Vec<Listed>>)> = stream::iter(front.clone())
            .map(|k| { let d = &d; async move {
                let url = format!("https://search.12306.cn/search/v1/train/search?keyword={k}&date={d}");
                let r = async {
                    let t = get_text(c, &url, 4, 20).await?;
                    let v: Value = serde_json::from_str(&t).context("search: not JSON")?;
                    Ok(serde_json::from_value::<Vec<Listed>>(v["data"].clone()).unwrap_or_default())
                }.await;
                tokio::time::sleep(StdDuration::from_millis(400)).await;
                (k, r)
            }})
            .buffer_unordered(2)
            .collect().await;
        calls += results.len();
        let mut next = Vec::new();
        for (k, r) in results {
            let r = r?;
            if r.len() >= 99 && k.chars().count() < 6 { next.extend("0123456789".chars().map(|ch| format!("{k}{ch}"))) }
            for t in r { found += 1; trains.entry(t.train_no).or_insert((t.station_train_code, Some(date))); }
        }
        front = next;
    }
    eprintln!("{date}: {found} trains in {calls} searches");
    Ok(())
}

// seeds: a previous timetable.json ({"trains": [[code, train_no, stops]…]}) or a list of {train_no, station_train_code}
fn read_seed(path: &str, trains: &mut BTreeMap<String, (String, Option<NaiveDate>)>) -> Result<()> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).with_context(|| format!("seed {path}"))?)?;
    let before = trains.len();
    if let Some(list) = v["trains"].as_array() {
        for t in list { if let (Some(code), Some(no)) = (t[0].as_str(), t[1].as_str()) { trains.entry(no.into()).or_insert((code.into(), None)); } }
    } else if let Some(list) = v.as_array() {
        for t in list { if let (Some(code), Some(no)) = (t["station_train_code"].as_str(), t["train_no"].as_str()) { trains.entry(no.into()).or_insert((code.into(), None)); } }
    }
    eprintln!("seed {path}: {} new trains", trains.len() - before);
    Ok(())
}

fn minutes(hm: &str) -> Option<i64> {
    let (h, m) = hm.split_once(':')?;
    Some(h.parse::<i64>().ok()? * 60 + m.parse::<i64>().ok()?)
}

#[tokio::main]
async fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let out = args.next().context("usage: timetable OUT.json [--seed FILE]… [--search-minutes N] [YYYY-MM-DD …]")?;
    let (mut seeds, mut search_minutes, mut dates) = (Vec::new(), 20u64, Vec::new());
    while let Some(a) = args.next() {
        match a.as_str() {
            "--seed" => seeds.push(args.next().context("--seed FILE")?),
            "--search-minutes" => search_minutes = args.next().context("--search-minutes N")?.parse()?,
            d => dates.push(NaiveDate::parse_from_str(d, "%Y-%m-%d")?),
        }
    }
    if dates.is_empty() {
        let today = Local::now().date_naive();
        dates = [Weekday::Wed, Weekday::Sat].iter().map(|w| {
            let mut d = today + Duration::days(1);
            while d.weekday() != *w { d += Duration::days(1) }
            d
        }).collect();
    }
    let c = reqwest::Client::builder().user_agent(UA).timeout(StdDuration::from_secs(30)).gzip(true).build()?;

    let st = stations(&c).await?;
    let idx: HashMap<String, usize> = st.iter().enumerate().map(|(i, s)| (s[1].clone(), i)).collect();

    // train_no → (code, a date it is known to run)
    let mut listed: BTreeMap<String, (String, Option<NaiveDate>)> = BTreeMap::new();
    let deadline = tokio::time::Instant::now() + StdDuration::from_secs(search_minutes * 60);
    for d in &dates {
        match tokio::time::timeout_at(deadline, list_trains(&c, *d, &mut listed)).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => { eprintln!("search for {d} failed ({e}); continuing with what was found and the seeds"); break }
            Err(_) => { eprintln!("search ran out of its {search_minutes} min; continuing with what was found and the seeds"); break }
        }
    }
    eprintln!("search found {} trains", listed.len());
    for p in &seeds { read_seed(p, &mut listed)?; }
    let fetched: Vec<Option<Value>> = stream::iter(listed.iter())
        .map(|(no, (code, known))| {
            let c = &c; let idx = &idx; let dates = &dates;
            async move {
                let mut stops: Vec<Stop> = Vec::new();
                for d in known.iter().chain(dates.iter().filter(|d| Some(**d) != *known)) {
                    let url = format!("https://kyfw.12306.cn/otn/queryTrainInfo/query?leftTicketDTO.train_no={no}&leftTicketDTO.train_date={d}&rand_code=");
                    let t = match get_text(c, &url, 5, 5).await { Ok(t) => t, Err(e) => { eprintln!("{e}"); return None } };
                    let v: Value = serde_json::from_str(&t).ok()?;
                    stops = serde_json::from_value(v["data"]["data"].clone()).unwrap_or_default();
                    if !stops.is_empty() { break }
                }
                // flat [station index, arrive, depart] in minutes from the first departure day's midnight
                let mut flat = Vec::new();
                for s in &stops {
                    let Some(&i) = idx.get(&s.station_name.split_whitespace().collect::<String>()) else { continue };
                    let day = s.arrive_day_diff.parse::<i64>().unwrap_or(0) * 1440;
                    let dep = minutes(&s.start_time).map(|m| m + day);
                    let arr = minutes(&s.arrive_time).map(|m| m + day).or(dep);
                    let (Some(a), Some(mut dp)) = (arr, dep.or(arr)) else { continue };
                    if dp < a { dp += 1440 } // departs after midnight on the next day
                    flat.extend([i as i64, a, dp]);
                }
                if flat.len() < 6 { return None }
                Some(json!([code, no, flat]))
            }
        })
        .buffer_unordered(12)
        .collect().await;
    let trains: Vec<Value> = fetched.into_iter().flatten().collect();
    eprintln!("stops for {} of {} trains (the rest do not run on the crawl dates)", trains.len(), listed.len());
    if trains.len() < 5000 { bail!("only {} trains with stops; something is wrong", trains.len()) }

    let doc = json!({
        "generated": Local::now().to_rfc3339(),
        "dates": dates.iter().map(|d| d.to_string()).collect::<Vec<_>>(),
        "stations": st,
        "trains": trains,
    });
    std::fs::write(&out, serde_json::to_string(&doc)?)?;
    Ok(())
}
