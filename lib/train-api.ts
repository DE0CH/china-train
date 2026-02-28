export interface TrainTicket {
  station: string;
  endstation: string;
  departuretime: string;
  arrivaltime: string;
  numsw: string;
  numyd: string;
  numed: string;
  numwz: string;
  [key: string]: unknown;
}

export interface TicketSummary {
  出发时间: string;
  到达时间: string;
  时长: number;
  中转时间: number;
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

function* findNext(
  tickets: TrainTicket[],
  endTime: string,
  safeStart2: string
): Generator<TrainTicket> {
  const timeMin = timeMinute(endTime);
  const safeMin = timeMinute(safeStart2);
  for (const ticket of tickets) {
    const dep = timeMinute(ticket.departuretime);
    if (dep >= safeMin) {
      yield ticket;
      return;
    }
    if (dep >= timeMin) {
      yield ticket;
    }
  }
}

export async function getTickets(
  start: string,
  end: string,
  date: string,
  apiKey: string
): Promise<TrainTicket[]> {
  const url = new URL("https://jisutrain.market.alicloudapi.com/train/ticket");
  url.searchParams.set("date", date);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `APPCODE ${apiKey}` },
  });
  if (res.status === 401) {
    throw new Error("API key 无效或已过期，请重新设置 (401 Unauthorized)");
  }
  const data = (await res.json()) as {
    result?: { list?: TrainTicket[] };
  };
  const list = data?.result?.list ?? [];
  return list.filter(
    (t) => t.station === start && t.endstation === end
  ) as TrainTicket[];
}

const TRANSIT_MINUTES = 10;

export function calculateRoute(
  leg1: TrainTicket[],
  leg2: TrainTicket[]
): TicketSummary[] {
  const solutions: TicketSummary[] = [];
  for (const ticket of leg1) {
    const endTime = ticket.arrivaltime;
    const safeStart2 = minuteToTime(timeMinute(endTime) + TRANSIT_MINUTES);
    for (const ticket2 of findNext(leg2, endTime, safeStart2)) {
      solutions.push({
        出发时间: ticket.departuretime,
        到达时间: ticket2.arrivaltime,
        时长: timeMinute(ticket2.arrivaltime) - timeMinute(ticket.departuretime),
        中转时间:
          timeMinute(ticket2.departuretime) - timeMinute(ticket.arrivaltime),
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

export type RouteKey = "香港 到 坪山" | "坪山 到 香港";

export function getStations(route: RouteKey): { start: string; end: string } {
  if (route === "香港 到 坪山") {
    return { start: "香港西九龙", end: "深圳坪山" };
  }
  return { start: "深圳坪山", end: "香港西九龙" };
}

const MIDDLE = "深圳北";

export async function fetchRoute(
  route: RouteKey,
  date: string,
  apiKey: string
): Promise<TicketSummary[]> {
  const { start, end } = getStations(route);
  const [leg1, leg2] = await Promise.all([
    getTickets(start, MIDDLE, date, apiKey),
    getTickets(MIDDLE, end, date, apiKey),
  ]);
  return calculateRoute(leg1, leg2);
}
