#!/usr/bin/env node
// Quartz Sea flights relay.
//
// Snapshots public ADS-B data (adsb.lol) into a static JSON file. A scheduled
// GitHub Action runs this every 10 minutes and commits flights.json, which the
// Cloudflare Worker then reads from raw.githubusercontent.com — because
// Cloudflare's own egress IPs are blocked / rate-limited by the ADS-B networks
// (adsb.lol 429, OpenSky 522, adsb.fi / airplanes.live 403).

import { writeFileSync } from 'node:fs';

const UA = 'QuartzSea-Terminal-Relay/1.0 (+https://terminal.quartz-sea.com)';
const HEADERS = { 'User-Agent': UA, 'Accept': 'application/json' };

// Europe / Mediterranean / Middle East theater.
const BOUNDS = { lamin: 20, lamax: 74, lomin: -35, lomax: 60 };

const FEEDS = [
  { name: 'mil', url: 'https://api.adsb.lol/v2/mil', timeout: 15000 },
  { name: 'central', url: 'https://api.adsb.lol/v2/point/51.0/10.0/250' },
  { name: 'britain', url: 'https://api.adsb.lol/v2/point/53.5/-2.5/250' },
  { name: 'west', url: 'https://api.adsb.lol/v2/point/49.0/2.0/250' },
  { name: 'iberia', url: 'https://api.adsb.lol/v2/point/40.0/-4.0/250' },
  { name: 'italy', url: 'https://api.adsb.lol/v2/point/42.0/14.0/250' },
  { name: 'balkans', url: 'https://api.adsb.lol/v2/point/44.0/21.0/250' },
  { name: 'nordics', url: 'https://api.adsb.lol/v2/point/58.0/15.0/250' },
  { name: 'baltic', url: 'https://api.adsb.lol/v2/point/55.5/24.0/250' },
  { name: 'east', url: 'https://api.adsb.lol/v2/point/52.0/21.0/250' },
  { name: 'turkey', url: 'https://api.adsb.lol/v2/point/39.5/33.0/250' },
  { name: 'levant', url: 'https://api.adsb.lol/v2/point/33.0/35.0/250' }
];

// Only the keys the terminal's ingest pipeline reads, to keep the file small.
const KEEP = ['hex', 'flight', 'r', 't', 'lat', 'lon', 'alt_baro', 'alt_geom', 'gs', 'track', 'baro_rate', 'ownOp', 'squawk', 'dbFlags', 'category'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inBounds = (a) =>
  typeof a.lat === 'number' && typeof a.lon === 'number' &&
  a.lat !== 0 && a.lon !== 0 && !a.ground && a.alt_baro !== 'ground' &&
  a.lat >= BOUNDS.lamin && a.lat <= BOUNDS.lamax &&
  a.lon >= BOUNDS.lomin && a.lon <= BOUNDS.lomax;

const trim = (a) => {
  const out = {};
  for (const k of KEEP) if (a[k] !== undefined) out[k] = a[k];
  return out;
};

async function fetchFeed(feed) {
  const res = await fetch(feed.url, { headers: HEADERS, signal: AbortSignal.timeout(feed.timeout || 12000) });
  if (!res.ok) return { status: res.status, ac: [] };
  const data = await res.json();
  return { status: res.status, ac: Array.isArray(data.ac) ? data.ac : [] };
}

async function main() {
  const byHex = new Map();
  const report = [];

  for (const feed of FEEDS) {
    let r;
    try {
      r = await fetchFeed(feed);
    } catch (e) {
      report.push({ feed: feed.name, error: String((e && e.name) || e) });
      await sleep(400);
      continue;
    }
    let kept = 0;
    for (const a of r.ac) {
      if (!inBounds(a)) continue;
      const hex = String(a.hex || '').toLowerCase();
      if (!hex) continue;
      byHex.set(hex, trim(a));
      kept++;
    }
    report.push({ feed: feed.name, status: r.status, got: r.ac.length, kept });
    if (r.status === 429) break; // rate limited: stop and keep what we have
    await sleep(400);            // spacing keeps us inside adsb.lol's limit
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'adsb.lol',
    bounds: BOUNDS,
    count: byHex.size,
    feeds: report,
    ac: Array.from(byHex.values())
  };

  writeFileSync('flights.json', JSON.stringify(payload) + '\n');
  console.log(`Wrote flights.json with ${payload.count} aircraft`);
  console.log(JSON.stringify(report));

  if (payload.count === 0) {
    console.error('No aircraft collected — not publishing an empty snapshot.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
