import requests
import pandas
from tabulate import tabulate
from os import environ 
from http.server import BaseHTTPRequestHandler, HTTPServer
from string import Template
from urllib.parse import urlparse, parse_qs

from dotenv import load_dotenv

load_dotenv()

SECRET = environ['API_KEY']
PATH_TOKEN = environ['PATH_TOKEN']

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
    dict = {}
    # dict = {
    #     '有': "Avail",
    #     '无': 'None',
    # }
    return dict.get(word, word)

def summarize(solutions):
    ans = []
    for (leg1, leg2) in solutions:
        n = {
            '出发时间': leg1['departuretime'],
            '到达时间': leg2['arrivaltime'],
            '时长': time_minute(leg2['arrivaltime']) - time_minute(leg1['departuretime']),
            '中转时间': time_minute(leg2['departuretime']) - time_minute(leg1['arrivaltime']),
            '1 商务': translate(leg1['numsw']),
            '1 一等': translate(leg1['numyd']),
            '1 二等': translate(leg1['numed']),
            '1 站票': translate(leg1['numwz']),
            '2 商务': translate(leg2['numsw']),
            '2 一等': translate(leg2['numyd']),
            '2 二等': translate(leg2['numed']),
            '2 站票': translate(leg2['numwz']),

        }
        ans.append(n)

    return pandas.DataFrame(ans)

    # Create a custom handler for the HTTP server
class SimpleHTTPRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path)
        if path.path == f'/{PATH_TOKEN}/form':
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            # Write the HTML string to the response body
            with open('form.html', 'r') as f:
                self.wfile.write(f.read().encode('utf-8'))
        elif path.path == f'/{PATH_TOKEN}/result':
            qs = parse_qs(path.query)
            html_solution = calculate_route(qs['route'][0], qs['date'][0])
            d = {
                'table': html_solution,
            }
            with open('results.html', 'r') as f:
                src = Template(f.read())
                result = src.substitute(d)
            self.send_response(200)
            # Set the content type to text/html
            self.send_header("Content-type", "text/html")
            self.end_headers()
            # Write the HTML string to the response body
            self.wfile.write(result.encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b'404 Not Found')

# Set up and start the server
def run(server_class=HTTPServer, handler_class=SimpleHTTPRequestHandler, port=8000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f"Serving on port {port}...")
    httpd.serve_forever()
        
def calculate_route(route, date):
    if route == '香港 到 坪山':
        end = '深圳坪山'
        start = '香港西九龙'
    elif route == '坪山 到 香港':
        start = '深圳坪山'
        end = '香港西九龙'
    middle = '深圳北'
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
    html  = ans.to_html()
    html = html.replace('class="dataframe"', 'class="table table-striped"').replace('<tr style="text-align: right;">', '<tr>')
    return html

def main():

    run()


if __name__ == '__main__':
    main()


