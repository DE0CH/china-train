import requests
import pandas
from tabulate import tabulate
from os import environ 

from dotenv import load_dotenv

load_dotenv()

SECRET = environ['API_KEY']

def get_tickets(start, end, date):

    # Define the URL and headers
    url = "https://jisutrain.market.alicloudapi.com/train/ticket"
    headers = {
        "Authorization": f"APPCODE {SECRET}"
    }

    # Define the parameters
    params = {
        "date": date,
        "start": start,
        "end": end
    }

    # Send the GET request
    response = requests.get(url, headers=headers, params=params)

    # Ensure the response is decoded as UTF-8
    response.encoding = 'utf-8'
    return response.json()


def time_minute(time):
    hour, minute = map(int, time.split(':'))
    return hour * 60 + minute

def minite_to_time(time):
    return f"{time // 60:02}:{time % 60:02}"


def tickets_simplified(tickets):
    ans = []
    tickets = tickets['result']['list']
    return tickets

def time_diff(start, end):
    """
    Very limited functionality, so don't want to use a lib
    24 hour time string separated by :
    """

    start = time_minute(start)
    end = time_minute(end)
    return end - start

def find_next(tickets, time, station):
    for ticket in tickets:
        if time_minute(ticket['departuretime']) >= time_minute(time) and ticket['station'] == station:
            return ticket
    raise ValueError('No train left')

def translate(word):
    dict = {
        '有': "Avail",
        '无': 'None',
    }
    return dict.get(word, word)

def summarize(solutions):
    ans = []
    for (leg1, leg2) in solutions:
        n = {
            'Departure Time': leg1['departuretime'],
            'Arrival Time': leg2['arrivaltime'],
            'Duration': time_minute(leg2['arrivaltime']) - time_minute(leg1['departuretime']),
            'Transit Time': time_minute(leg2['departuretime']) - time_minute(leg1['arrivaltime']),
            '1 Business': translate(leg1['numsw']),
            '1 First Class': translate(leg1['numyd']),
            '1 Second Class': translate(leg1['numed']),
            '1 Standing': translate(leg1['numwz']),
            '2 Business': translate(leg2['numsw']),
            '2 First Class': translate(leg2['numyd']),
            '2 Second Class': translate(leg2['numed']),
            '2 Standing': translate(leg2['numwz']),

        }
        ans.append(n)

    return pandas.DataFrame(ans)

def main():
    start = '深圳坪山'
    middle = '深圳北'
    end = '香港西九龙'
    date = '2025-06-30'
    transit_time = 10

    print("waiting for API...")
    leg1 = tickets_simplified(get_tickets(start, middle, date))
    leg2 = tickets_simplified(get_tickets(middle, end, date))
    print("received response from API, calculating...")

    solutions = []
    for ticket in leg1:
        end = ticket['arrivaltime']
        start2 = minite_to_time(time_minute(end) + transit_time)
        try: 
            ticket2 = find_next(leg2, start2, middle)
            solutions.append((ticket, ticket2))
        except ValueError:
            continue
    ans = summarize(solutions)

    print(tabulate(ans, headers='keys', tablefmt='psql'))

    
if __name__ == '__main__':
    main()


