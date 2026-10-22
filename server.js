// CityMind Voice Concierge: Streamable HTTP MCP server for Alexa+ (stateless) + Alexa+ simulator web app.
import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const port = process.env.PORT || 3000;
const __dir = path.dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(path.join(__dir, "data/places.json"), "utf8"));
const CITY_KEYS = Object.keys(DATA.cities);
// City-centre coordinates, used only to request live weather / air quality.
const COORDS = { pune: [18.5204, 73.8567], mumbai: [19.076, 72.8777], nashik: [19.9975, 73.7898], nagpur: [21.1458, 79.0882], kolhapur: [16.705, 74.2433], sambhajinagar: [19.8762, 75.3433] };
const SLOT = { morning: 0, afternoon: 1, evening: 2, any: 1 };
const BUDGET = { relaxed: 240, balanced: 360, packed: 480 };
const BUFFER = 30;
const OUTDOOR_HERITAGE = new Set(["pune-shaniwar-wada", "pune-aga-khan-palace", "mumbai-gateway", "mumbai-elephanta", "nashik-pandavleni", "nagpur-sitabuldi", "sambhajinagar-ajanta", "sambhajinagar-ellora"]);
const isOutdoor = (p) => p.category === "nature" || p.category === "viewpoint" || OUTDOOR_HERITAGE.has(p.id);

const T = {
  en: { plan: (c, p) => `${p} day in ${c}:`, rain: "Rain is likely, so I removed outdoor stops.", heat: "It will be very hot, so I removed afternoon outdoor stops.", aqi: "Air quality is poor, so I removed long outdoor stops.", live: "Live weather is unavailable right now, so this plan ignores conditions.", none: "Nothing fits those conditions. Try another day or different interests." },
  hi: { plan: (c, p) => `${c} के लिए ${p} दिन की योजना:`, rain: "बारिश की संभावना अधिक है, इसलिए खुले स्थान हटा दिए गए हैं।", heat: "बहुत गर्मी होगी, इसलिए दोपहर के खुले स्थान हटा दिए गए हैं।", aqi: "हवा की गुणवत्ता खराब है, इसलिए लंबे खुले स्थान हटा दिए गए हैं।", live: "लाइव मौसम अभी उपलब्ध नहीं है, इसलिए योजना में मौसम शामिल नहीं है।", none: "इन परिस्थितियों में कुछ उपयुक्त नहीं मिला। दूसरा दिन या अलग रुचि चुनें।" },
  mr: { plan: (c, p) => `${c} साठी ${p} दिवसाची योजना:`, rain: "पावसाची शक्यता जास्त आहे, म्हणून खुली ठिकाणे वगळली आहेत.", heat: "खूप उष्णता असेल, म्हणून दुपारची खुली ठिकाणे वगळली आहेत.", aqi: "हवेची गुणवत्ता खराब आहे, म्हणून लांब खुली ठिकाणे वगळली आहेत.", live: "थेट हवामान सध्या उपलब्ध नाही, म्हणून योजनेत हवामान विचारात घेतलेले नाही.", none: "या परिस्थितीत काही योग्य सापडले नाही. दुसरा दिवस किंवा वेगळ्या आवडी निवडा." },
};

const cityKey = (s) => {
  const t = String(s).toLowerCase().replace(/[^a-z]/g, "");
  if (t.includes("sambhajinagar") || t.includes("aurangabad")) return "sambhajinagar";
  return CITY_KEYS.find((k) => t.includes(k));
};
const text = (t, extra = {}) => ({ content: [{ type: "text", text: t }], ...extra });
const fmt = (p) => `${p.name} (${p.category}, ${p.area}): ${p.note} Best in the ${p.bestTime}; plan about ${p.durationMins} minutes.`;

function wx(code) {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 80 && code <= 82) return "rain showers";
  if (code >= 95) return "thunderstorm";
  return "mixed weather";
}

// Live data from Open-Meteo (free, no key). Returns {ok:false} on any failure; never invents values.
async function getConditions(k, day = 0) {
  const [lat, lon] = COORDS[k];
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FKolkata&forecast_days=3`, { signal: AbortSignal.timeout(6000) });
    const d = (await r.json()).daily;
    const out = { ok: true, date: d.time[day], code: d.weathercode[day], tmax: d.temperature_2m_max[day], tmin: d.temperature_2m_min[day], rain: d.precipitation_probability_max[day], aqi: null };
    if (day === 0) {
      try {
        const a = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=Asia%2FKolkata`, { signal: AbortSignal.timeout(6000) })).json();
        out.aqi = a.current?.us_aqi ?? null;
      } catch {}
    }
    return out;
  } catch { return { ok: false }; }
}
const condLine = (c, name) => `${name} on ${c.date}: ${wx(c.code)}, ${Math.round(c.tmin)} to ${Math.round(c.tmax)} degrees Celsius, rain chance ${c.rain}%` + (c.aqi != null ? `, air quality index ${c.aqi} (US scale).` : ".");

function buildServer() {
  const server = new McpServer({ name: "citymind-voice-concierge", version: "0.2.0" });

  server.registerTool("list_cities", { description: "List the Maharashtra cities covered and how many curated places each has.", inputSchema: {} }, async () =>
    text(CITY_KEYS.map((k) => `${DATA.cities[k]}: ${DATA.places.filter((p) => p.city === k).length} places`).join("\n")));

  server.registerTool("search_places", {
    description: "Find places in a Maharashtra city, optionally by category (heritage, religious, nature, viewpoint, food) or keyword.",
    inputSchema: { city: z.string(), category: z.enum(["heritage", "religious", "nature", "viewpoint", "food"]).optional(), keyword: z.string().optional() },
  }, async ({ city, category, keyword }) => {
    const k = cityKey(city);
    if (!k) return text(`I don't cover "${city}" yet. Covered: ${CITY_KEYS.map((c) => DATA.cities[c]).join(", ")}.`);
    let r = DATA.places.filter((p) => p.city === k);
    if (category) r = r.filter((p) => p.category === category);
    if (keyword) r = r.filter((p) => (p.name + " " + p.note).toLowerCase().includes(keyword.toLowerCase()));
    return r.length ? text(r.map(fmt).join("\n"), { structuredContent: { places: r } }) : text(`No matching places in ${DATA.cities[k]}.`);
  });

  server.registerTool("check_conditions", {
    description: "Live weather forecast (today to 2 days ahead) and current air quality for a covered Maharashtra city.",
    inputSchema: { city: z.string(), day_offset: z.number().int().min(0).max(2).default(0) },
  }, async ({ city, day_offset }) => {
    const k = cityKey(city);
    if (!k) return text(`I don't cover "${city}" yet.`);
    const c = await getConditions(k, day_offset);
    return c.ok ? text(condLine(c, DATA.cities[k]), { structuredContent: { conditions: c, source: "Open-Meteo" } }) : text("Live weather is unavailable right now.");
  });

  server.registerTool("plan_day", {
    description: "Build a one-day itinerary that adapts to LIVE weather and air quality: rain removes outdoor stops, extreme heat removes afternoon outdoor stops, poor air removes long outdoor stops. Supports English, Hindi and Marathi.",
    inputSchema: {
      city: z.string(),
      interests: z.array(z.enum(["heritage", "religious", "nature", "viewpoint", "food"])).optional(),
      pace: z.enum(["relaxed", "balanced", "packed"]).default("balanced"),
      day_offset: z.number().int().min(0).max(2).default(0),
      language: z.enum(["en", "hi", "mr"]).default("en"),
    },
  }, async ({ city, interests, pace, day_offset, language }) => {
    const k = cityKey(city);
    if (!k) return text(`I don't cover "${city}" yet.`);
    const L = T[language];
    const cond = await getConditions(k, day_offset);
    const notes = [];
    let pool = DATA.places.filter((p) => p.city === k && (!interests?.length || interests.includes(p.category)));
    const drop = (fn, msg) => { const n = pool.length; pool = pool.filter((p) => !fn(p)); if (pool.length < n) notes.push(msg); };
    if (cond.ok) {
      if (cond.rain >= 60 || cond.code >= 61) drop(isOutdoor, L.rain);
      if (cond.tmax >= 38) drop((p) => isOutdoor(p) && p.bestTime === "afternoon", L.heat);
      if (cond.aqi != null && cond.aqi > 150) drop((p) => isOutdoor(p) && p.durationMins > 120, L.aqi);
    } else notes.push(L.live);
    pool.sort((a, b) => SLOT[a.bestTime] - SLOT[b.bestTime] || a.durationMins - b.durationMins);
    let used = 0; const plan = [];
    for (const p of pool) { const cost = p.durationMins + (plan.length ? BUFFER : 0); if (used + cost <= BUDGET[pace]) { plan.push(p); used += cost; } }
    if (!plan.length) return text([L.none, ...notes].join("\n"), { structuredContent: { conditions: cond, itinerary: [], notes } });
    const lines = plan.map((p, i) => `${i + 1}. ${p.bestTime}: ${p.name}, about ${p.durationMins} min. ${p.note}`);
    const head = cond.ok ? condLine(cond, DATA.cities[k]) : "";
    return text([L.plan(DATA.cities[k], pace), ...lines, ...notes, head, `Travel between stops is a fixed ${BUFFER}-minute allowance, not a live route.`].filter(Boolean).join("\n"),
      { structuredContent: { conditions: cond, itinerary: plan, notes } });
  });

  server.registerTool("compare_places", {
    description: "Compare two known places side by side.",
    inputSchema: { place_a: z.string(), place_b: z.string() },
  }, async ({ place_a, place_b }) => {
    const find = (q) => DATA.places.find((p) => p.name.toLowerCase().includes(q.toLowerCase()) || p.id === q);
    const a = find(place_a), b = find(place_b);
    if (!a || !b) return text(`I couldn't find ${!a ? place_a : place_b}.`);
    return text(`${a.name} vs ${b.name}\nCategory: ${a.category} vs ${b.category}\nArea: ${a.area} vs ${b.area}\nBest time: ${a.bestTime} vs ${b.bestTime}\nTime needed: ${a.durationMins} vs ${b.durationMins} min\nOutdoor: ${isOutdoor(a) ? "yes" : "mostly no"} vs ${isOutdoor(b) ? "yes" : "mostly no"}`);
  });
  return server;
}

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dir, "public")));

app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
  catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }); }
});
const no = (_q, res) => res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp", no); app.delete("/mcp", no);

// ---- Alexa+ simulator: maps an utterance to an MCP tool call and executes it over real Streamable HTTP ----
const DEVA = { "पुणे": "pune", "मुंबई": "mumbai", "नाशिक": "nashik", "नागपूर": "nagpur", "नागपुर": "nagpur", "कोल्हापूर": "kolhapur", "संभाजीनगर": "sambhajinagar", "औरंगाबाद": "sambhajinagar" };
const STOP = new Set(["temple", "caves", "palace", "national", "park", "chhatrapati", "maharaj", "terminus", "nashik", "vineyards", "museum", "shivaji", "gandhi", "sanjay", "hill", "fort", "and", "the", "with", "from", "what", "than"]);
function mentioned(t) {
  const words = new Set(t.split(/[^a-z]+/));
  return DATA.places.filter((p) => p.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 4 && !STOP.has(w) && words.has(w)));
}
function route(q, lang) {
  const t = q.toLowerCase().replace(/^\s*alexa[,!.]?\s*/, "");
  let city; for (const [d, k] of Object.entries(DEVA)) if (t.includes(d)) city = k; city ||= cityKey(t);
  const has = (re) => re.test(t);
  const day_offset = has(/day after|परसों|परवा/) ? 2 : has(/tomorrow|\bkal\b|उद्या|कल/) ? 1 : 0;
  const interests = [];
  if (has(/heritage|history|historic|fort|palace|caves/)) interests.push("heritage");
  if (has(/temple|religio|spiritual|मंदिर/)) interests.push("religious");
  if (has(/nature|trek|hike|park/)) interests.push("nature");
  if (has(/view|sunset|promenade/)) interests.push("viewpoint");
  if (has(/food|wine|vineyard|eat/)) interests.push("food");
  const pace = has(/relax|slow|easy/) ? "relaxed" : has(/packed|busy|full|max/) ? "packed" : "balanced";
  if (has(/\bcities\b|cover|शहर/)) return ["list_cities", {}];
  const m = mentioned(t);
  if (m.length >= 2 && has(/compare|\bvs\b|versus|difference|better|तुलना/)) return ["compare_places", { place_a: m[0].name, place_b: m[1].name }];
  if (!city) return null;
  if (has(/weather|rain|air|aqi|forecast|temperature|मौसम|हवामान|पाऊस|बारिश/)) return ["check_conditions", { city, day_offset }];
  if (has(/plan|itinerary|trip|day|visit|schedule|योजना|प्लान|आराखडा/)) return ["plan_day", { city, ...(interests.length ? { interests } : {}), pace, day_offset, language: lang }];
  return ["search_places", { city, ...(interests[0] ? { category: interests[0] } : {}) }];
}
app.post("/api/ask", async (req, res) => {
  const q = String(req.body?.text ?? "").slice(0, 300);
  const lang = ["en", "hi", "mr"].includes(req.body?.lang) ? req.body.lang : "en";
  const r = route(q, lang);
  if (!r) return res.json({ reply: "Tell me a Maharashtra city, for example: plan a day in Pune, or compare Ajanta and Ellora.", trace: [] });
  const [name, args] = r;
  const client = new Client({ name: "citymind-alexa-simulator", version: "0.2.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    const result = await client.callTool({ name, arguments: args });
    res.json({ reply: (result.content || []).map((c) => c.text).join("\n"), trace: [{ tool: name, args, structured: result.structuredContent ?? null }] });
  } catch (e) { console.error(e); res.status(500).json({ reply: "Something went wrong calling the MCP server.", trace: [] }); }
  finally { await client.close().catch(() => {}); }
});

app.listen(port, () => console.log(`CityMind Voice Concierge: simulator http://localhost:${port}  |  MCP endpoint http://localhost:${port}/mcp`));
