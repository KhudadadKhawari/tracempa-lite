# TraceMap Lite

TraceMap Lite is a lightweight static traceroute visualizer.

It does **not** run traceroute by itself. You manually run traceroute or tracert on your machine, paste the output into the app, and TraceMap Lite parses public IP hops, geolocates them, and draws the route on an interactive world map.

## Screenshot

```text
Screenshot placeholder:
Add a screenshot here after running the app.
```

## Features

- Static web app
- No backend
- No database
- No build tools
- No npm
- No tracking
- Works by opening `index.html`
- Parses common Linux/macOS `traceroute` output
- Parses common Windows `tracert` output
- Skips private/reserved IP addresses
- Skips no-response hops like `* * *`
- Geolocates public IPv4 hops
- Draws markers on a Leaflet map
- Connects hops with a route line
- Shows hop details in a table
- Supports optional manual source location

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript
- Leaflet.js
- OpenStreetMap tiles
- ip-api.com GeoIP API

## Project Structure

```text
tracemap-lite/
├── index.html
├── styles.css
├── app.js
└── README.md
```

## How to Use

1. Open `index.html` in your browser.

2. Run traceroute manually on your machine.

Linux/macOS:

```bash
traceroute google.com
```

Windows PowerShell:

```powershell
tracert google.com
```

Optional TCP traceroute on Linux:

```bash
traceroute -T google.com
```

3. Paste the output into the textarea.

4. Optionally enter your source location:

```text
Latitude: 34.5553
Longitude: 69.2075
Label: Kabul
```

5. Click:

```text
Visualize Route
```

## Example Input

```text
traceroute to google.com (142.250.190.78), 30 hops max
 1  192.168.1.1  1.123 ms  0.932 ms  0.901 ms
 2  10.10.0.1  4.211 ms  4.002 ms  3.991 ms
 3  8.8.8.8  20.214 ms  21.332 ms  19.921 ms
 4  1.1.1.1  35.011 ms  34.600 ms  35.222 ms
 5  142.250.190.78  40.223 ms  41.100 ms  39.890 ms
```

## API Notes

TraceMap Lite uses the free `ip-api.com` endpoint.

Important limitations:

- Free endpoint has around 45 requests per minute.
- Free endpoint is for non-commercial use.
- Free endpoint uses HTTP, not HTTPS.
- If you host this app on HTTPS, browser mixed-content rules may block GeoIP requests.
- For best testing, open `index.html` directly or serve it locally over HTTP.

Example local static server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## OpenStreetMap Tile Usage

This app uses public OpenStreetMap tiles through Leaflet.

Use respectfully:

- Do not spam refresh.
- Do not bulk-load huge routes.
- Do not use public tiles for heavy production traffic.
- For production usage, use a proper tile provider or host your own tiles.

## Limitations

IP geolocation is approximate.

Common issues:

- Some router hops hide their IPs.
- Private IPs are skipped.
- Reserved/test IP ranges are skipped.
- CDN and Anycast destinations may not map exactly.
- ISP routers may geolocate to company headquarters instead of the real router location.
- Some hops may show the ISP location, not the physical router.
- IPv6 parsing is detected but not fully geolocated.
- `* * *` hops cannot be mapped.

## Privacy

TraceMap Lite has no backend and no database.

The app does not store your traceroute data anywhere.

However, public IP addresses from your pasted traceroute are sent to `ip-api.com` for geolocation lookup.

## License

Use freely for learning, demos, and personal projects.
