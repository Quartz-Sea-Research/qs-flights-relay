# qs-flights-relay

Static ADS-B relay for **The QS Terminal**.

Cloudflare's shared egress IPs are blocked or rate-limited by the free ADS-B
networks (OpenSky returns HTTP 522 to the edge, `adsb.fi` / `airplanes.live` /
`adsb.one` return 403, and `adsb.lol` rate-limits to 429), so the terminal's
edge function cannot fetch live flight positions directly.

Instead, a scheduled GitHub Action (`relay.yml`, every 10 minutes) runs
`collect.mjs`, which queries `adsb.lol` for the Europe / Mediterranean / Middle
East theater and commits the result to `flights.json` here. The worker then
reads it from:

```
https://raw.githubusercontent.com/<owner>/qs-flights-relay/main/flights.json
```

## `flights.json` shape

```json
{
  "generatedAt": "2026-10-05T08:00:00.000Z",
  "source": "adsb.lol",
  "bounds": { "lamin": 20, "lamax": 74, "lomin": -35, "lomax": 60 },
  "count": 812,
  "feeds": [{ "feed": "central", "status": 200, "got": 648, "kept": 512 }],
  "ac": [{ "hex": "4ca820", "flight": "IAM1420", "t": "F35", "lat": 45.1, "lon": 12.3 }]
}
```

Only the fields the terminal's ingest pipeline reads are kept, to keep the file
small. Raw `adsb.lol` field names are preserved so the worker reuses the same
normalisation code as its direct feed.

## Manual run

```bash
node collect.mjs   # writes flights.json
```
