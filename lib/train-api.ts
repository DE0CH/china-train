export interface TrainTicket {
  station: string;
  endstation: string;
  departuretime: string;
  arrivaltime: string;
  numsw: string;
  numyd: string;
  numed: string;
  numwz: string;
  trainno?: string;
  [key: string]: unknown;
}

export interface TicketSummary {
  出发时间: string;
  到达时间: string;
  时长: number;
  中转时间: number;
  "1 到达": string;
  "2 出发": string;
  "1 车次": string;
  "2 车次": string;
  "1 商务": string;
  "1 一等": string;
  "1 二等": string;
  "1 站票": string;
  "2 商务": string;
  "2 一等": string;
  "2 二等": string;
  "2 站票": string;
}

function timeMinute(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minuteToTime(minutes: number): string {
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

function translate(word: string): string {
  return word;
}

// Yields the first leg-2 train departing at or after safeStart2 (arrival +
// minimum transit time). Trains departing before the cutoff are not returned.
function* findNext(
  tickets: TrainTicket[],
  safeStart2: string
): Generator<TrainTicket> {
  const safeMin = timeMinute(safeStart2);
  for (const ticket of tickets) {
    if (timeMinute(ticket.departuretime) >= safeMin) {
      yield ticket;
      return;
    }
  }
}

// 聚合数据 "12306火车票时刻表余票查询服务" on the Aliyun API marketplace
// (product cmapi00071761). Called straight from the browser: the gateway host
// answers CORS preflights with `Access-Control-Allow-Origin: *`.
const API_URL = "https://trainss.market.alicloudapi.com/fapigw/train/query";

interface JuhePrice {
  seat_name: string;
  seat_type_code?: string;
  price?: number | null;
  num?: string | null;
}

interface JuheTrain {
  train_no: string;
  departure_station: string;
  arrival_station: string;
  departure_time: string;
  arrival_time: string;
  duration?: string;
  enable_booking?: string;
  prices?: JuhePrice[];
}

interface JuheResponse {
  reason?: string;
  result?: JuheTrain[] | null;
  error_code?: number | string;
}

// Seat classes the app displays, keyed by the seat_name juhe uses. 特等座 is
// the business-class equivalent on some older sets, so it counts as 商务.
const SEAT_ALIASES: Record<"sw" | "yd" | "ed" | "wz", string[]> = {
  sw: ["商务座", "特等座"],
  yd: ["一等座"],
  ed: ["二等座"],
  wz: ["无座"],
};

function seatNum(prices: JuhePrice[] | undefined, names: string[]): string {
  for (const name of names) {
    const p = prices?.find((x) => x.seat_name === name);
    if (p && p.num != null && p.num !== "") return String(p.num);
  }
  return "--";
}

function toTicket(t: JuheTrain): TrainTicket {
  return {
    station: t.departure_station,
    endstation: t.arrival_station,
    departuretime: t.departure_time,
    arrivaltime: t.arrival_time,
    trainno: t.train_no,
    numsw: seatNum(t.prices, SEAT_ALIASES.sw),
    numyd: seatNum(t.prices, SEAT_ALIASES.yd),
    numed: seatNum(t.prices, SEAT_ALIASES.ed),
    numwz: seatNum(t.prices, SEAT_ALIASES.wz),
  };
}

async function fetchTicketsRaw(
  start: string,
  end: string,
  date: string,
  apiKey: string
): Promise<TrainTicket[]> {
  const url = new URL(API_URL);
  url.searchParams.set("search_type", "1"); // 1 = station names, 2 = station codes
  url.searchParams.set("departure_station", start);
  url.searchParams.set("arrival_station", end);
  url.searchParams.set("date", date);
  url.searchParams.set("enable_booking", "2"); // 2 = all trains, not only bookable

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `APPCODE ${apiKey}` },
    });
  } catch {
    throw new Error("网络请求失败，请检查网络连接后重试");
  }

  // Aliyun API Gateway reports auth/quota problems via the HTTP status and the
  // X-Ca-Error-Message header (exposed to browsers), usually with an empty or
  // non-JSON body. Handle these BEFORE parsing the body, otherwise parsing the
  // non-JSON body throws a cryptic browser error instead of the real cause.
  const caError = res.headers.get("X-Ca-Error-Message") || "";
  const detail = caError ? `（${caError}）` : "";

  if (res.status === 401 || res.status === 400) {
    throw new Error(`API key（APPCODE）无效或已过期，请重新设置${detail}`);
  }
  if (res.status === 403) {
    if (/quota/i.test(caError)) {
      throw new Error("API 调用次数已用尽（配额耗尽），请在阿里云 API 市场充值或更换 APPCODE");
    }
    throw new Error(`API 拒绝访问：配额可能已用尽或 APPCODE 已过期，请检查阿里云 API 市场的订阅${detail}`);
  }
  if (!res.ok) {
    throw new Error(`请求失败（HTTP ${res.status}）${detail}，请稍后重试`);
  }

  const body = await res.text();
  let data: JuheResponse;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `服务器返回了非预期的响应${detail || "，请稍后重试或重新设置 API key"}`
    );
  }

  const code = Number(data.error_code ?? 0);
  if (code !== 0) {
    // juhe puts the human-readable cause in `reason` (unknown station, date
    // outside the 15-day booking window, backend hiccup, ...).
    throw new Error(`查询失败：${data.reason || `错误码 ${code}`}（${start} → ${end}）`);
  }

  const list = Array.isArray(data.result) ? data.result : [];
  return list
    .map(toTicket)
    .filter((t) => t.station === start && t.endstation === end);
}

export async function getTickets(
  start: string,
  end: string,
  date: string,
  apiKey: string
): Promise<TrainTicket[]> {
  return fetchTicketsRaw(start, end, date, apiKey);
}

export function calculateRoute(
  leg1: TrainTicket[],
  leg2: TrainTicket[],
  transitMinutes: number
): TicketSummary[] {
  const solutions: TicketSummary[] = [];
  for (const ticket of leg1) {
    const endTime = ticket.arrivaltime;
    const safeStart2 = minuteToTime(timeMinute(endTime) + transitMinutes);
    for (const ticket2 of findNext(leg2, safeStart2)) {
      solutions.push({
        出发时间: ticket.departuretime,
        到达时间: ticket2.arrivaltime,
        时长: timeMinute(ticket2.arrivaltime) - timeMinute(ticket.departuretime),
        中转时间: timeMinute(ticket2.departuretime) - timeMinute(ticket.arrivaltime),
        "1 到达": ticket.arrivaltime,
        "2 出发": ticket2.departuretime,
        "1 车次": ticket.trainno ?? "",
        "2 车次": ticket2.trainno ?? "",
        "1 商务": translate(ticket.numsw),
        "1 一等": translate(ticket.numyd),
        "1 二等": translate(ticket.numed),
        "1 站票": translate(ticket.numwz),
        "2 商务": translate(ticket2.numsw),
        "2 一等": translate(ticket2.numyd),
        "2 二等": translate(ticket2.numed),
        "2 站票": translate(ticket2.numwz),
      });
    }
  }
  return solutions;
}

export async function fetchRoute(
  start: string,
  transfer: string,
  end: string,
  date: string,
  apiKey: string,
  transitMinutes: number = 8,
): Promise<TicketSummary[]> {
  const [leg1, leg2] = await Promise.all([
    fetchTicketsRaw(start, transfer, date, apiKey),
    fetchTicketsRaw(transfer, end, date, apiKey),
  ]);
  return calculateRoute(leg1, leg2, transitMinutes);
}
