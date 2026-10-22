# CityMind Voice Concierge (Alexa+ track)

A self-hosted MCP server (Streamable HTTP) that gives Alexa+ a Maharashtra city concierge whose plans adapt to **live weather and air quality** (Open-Meteo, free, no API key). It speaks English, Hindi and Marathi. A built-in Alexa+ simulator (voice in, voice out) calls the server over real MCP and shows every tool call.

## Tools
`list_cities`, `search_places`, `check_conditions`, `plan_day`, `compare_places`

## Decision rules in `plan_day` (no hidden AI, fully inspectable)
- Rain chance >= 60% or rain/thunderstorm forecast: remove outdoor stops
- Max temperature >= 38 C: remove afternoon outdoor stops
- US AQI > 150 (today only): remove outdoor stops longer than 2 hours
- Live data unavailable: plan still works and says conditions were ignored
Stops are ordered morning to evening within a time budget (relaxed 4h, balanced 6h, packed 8h) plus a 30-minute travel allowance (an estimate, not a live route).

## Run (Windows cmd, Node 18+)
    npm install
    npm start
- Simulator: http://localhost:3000
- MCP endpoint: http://localhost:3000/mcp
- Inspect: `npx @modelcontextprotocol/inspector` (Streamable HTTP, URL above)

## Deploy
Any HTTPS Node host (Render, Railway, Fly). Start command `npm start`. Public MCP URL: `https://<host>/mcp`.

## Data honesty
`data/places.json` is a small hand-curated set with no hours or prices. Weather and AQI are live from Open-Meteo. Verify details locally before visiting.

## License
MIT
