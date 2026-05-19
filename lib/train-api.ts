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

// Returns null if either station is unrecognized (API status 202), throws on real errors.
async function fetchTicketsRaw(
  start: string,
  end: string,
  date: string,
  apiKey: string
): Promise<TrainTicket[] | null> {
  const url = new URL("https://jisutrain.market.alicloudapi.com/train/ticket");
  url.searchParams.set("date", date);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("enable_booking", "2");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `APPCODE ${apiKey}` },
  });
  if (res.status === 401) {
    throw new Error("API key 无效或已过期，请重新设置 (401 Unauthorized)");
  }
  const data = (await res.json()) as {
    status?: string;
    result?: { list?: TrainTicket[] } | string;
  };
  if (data.status === "202") return null;
  const list = (data.result as { list?: TrainTicket[] })?.list ?? [];
  return list.filter(
    (t) => t.station === start && t.endstation === end
  ) as TrainTicket[];
}

export async function getTickets(
  start: string,
  end: string,
  date: string,
  apiKey: string
): Promise<TrainTicket[]> {
  const result = await fetchTicketsRaw(start, end, date, apiKey);
  if (result === null) throw new Error(`站名无效：「${start}」或「${end}」不存在，请检查输入`);
  return result;
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
    for (const ticket2 of findNext(leg2, endTime, safeStart2)) {
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
  transitMinutes: number = 10
): Promise<TicketSummary[]> {
  const [leg1, leg2] = await Promise.all([
    fetchTicketsRaw(start, transfer, date, apiKey),
    fetchTicketsRaw(transfer, end, date, apiKey),
  ]);

  if (leg1 !== null && leg2 !== null) return calculateRoute(leg1, leg2, transitMinutes);

  if (leg1 === null && leg2 !== null) {
    // transfer is valid (leg2 worked), so start is the bad one
    throw new Error(`站名无效：「${start}」不存在，请检查输入`);
  }

  if (leg1 !== null && leg2 === null) {
    // transfer is valid (leg1 worked), so end is the bad one
    throw new Error(`站名无效：「${end}」不存在，请检查输入`);
  }

  // Both legs failed — try start→end directly to see if transfer is the only problem
  const direct = await fetchTicketsRaw(start, end, date, apiKey);
  if (direct !== null) {
    throw new Error(`站名无效：「${transfer}」不存在，请检查输入`);
  }

  // All three lookups failed — more than one station is wrong, give up
  throw new Error("多个站名无效，请检查出发站、中转站和到达站");
}
