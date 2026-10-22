# Devpost text (fill [BRACKETS] honestly)

**Track:** Alexa+   **Mini challenge:** Open Source (MIT, public repo)   [AWS Builder only if you really add an AWS service]

## Project name / tagline
CityMind Voice Concierge: a weather-aware, multilingual Alexa+ travel guide for Maharashtra.

## Description
Travel advice breaks when the weather changes. CityMind Voice Concierge is a self-hosted MCP server (Streamable HTTP) that lets Alexa+ plan a day in six Maharashtra cities and adapt to live conditions: it removes outdoor stops when rain is likely, drops afternoon outdoor stops in extreme heat, and drops long outdoor stops when air quality is poor, and it tells the user why. It answers in English, Hindi and Marathi. The planner is deterministic and inspectable, so every recommendation can be explained. Five MCP tools: list_cities, search_places, check_conditions, plan_day, compare_places. Live weather and air quality come from Open-Meteo. We also built an Alexa+ simulator web app with voice input and spoken output that calls the server over real MCP and shows every tool call. Limits: small curated dataset, no live routing.

## Built with
Node.js, Express, Model Context Protocol SDK (Streamable HTTP), Zod, Open-Meteo API, Web Speech API.

## Before vs during hackathon
CityMind Maharashtra (concept/web app) existed before. [DATE]: this MCP server, simulator, dataset and tools were built during the hackathon window.

## Product feedback (write your real experience, 2-4 lines each)
- MCP TypeScript SDK / Streamable HTTP: used for [..]; worked well [..]; needs work [..]; onboarding [..]; build again [..]
- Alexa+ / Amazon Devices Builder Tools: [..]

## Friction log (optional, up to 10% bonus)
Task / steps / expected vs actual / severity / workaround / suggestion.
