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

// The app's own Vercel function (api/query.ts) queries 12306 directly — China Railway's official
// site, which has no daily cap and no API key — and returns the trains between two stations.
export interface QueryTrain {
  trainno: string; from: string; to: string;
  departuretime: string; arrivaltime: string; duration: string;
  origin: string; terminus: string; canBuy: boolean;
  numsw: string; numyd: string; numed: string; numwz: string;
}

async function fetchTicketsRaw(start: string, end: string, date: string): Promise<TrainTicket[]> {
  const url = new URL("/api/query", window.location.origin);
  url.searchParams.set("from", start);
  url.searchParams.set("to", end);
  url.searchParams.set("date", date);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    throw new Error("网络请求失败，请检查网络连接后重试");
  }
  const body = await res.text();
  let data: { trains?: QueryTrain[]; error?: string };
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(`服务器返回了非预期的响应（HTTP ${res.status}），请稍后重试`);
  }
  if (!res.ok || data.error) throw new Error(data.error || `请求失败（HTTP ${res.status}），请稍后重试`);
  return (data.trains || []).map((t) => ({
    station: t.from,
    endstation: t.to,
    departuretime: t.departuretime,
    arrivaltime: t.arrivaltime,
    trainno: t.trainno,
    numsw: t.numsw,
    numyd: t.numyd,
    numed: t.numed,
    numwz: t.numwz,
    canBuy: t.canBuy,
  }));
}

export async function getTickets(start: string, end: string, date: string): Promise<TrainTicket[]> {
  return fetchTicketsRaw(start, end, date);
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
  transitMinutes: number = 8,
): Promise<TicketSummary[]> {
  const [leg1, leg2] = await Promise.all([
    fetchTicketsRaw(start, transfer, date),
    fetchTicketsRaw(transfer, end, date),
  ]);
  return calculateRoute(leg1, leg2, transitMinutes);
}
