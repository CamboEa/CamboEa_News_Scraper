import "dotenv/config";
import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { scrape, scrapeWithDetails } from "./scraper.js";
import {
  saveEvents,
  loadEvents,
  loadEventsByImpact,
  loadEventsByCountry,
  getScrapeStatus,
} from "./firebase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3333;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(ROOT, "public")));

let scraping = false;

// --- API Routes ---

app.get("/api/events", async (_req, res) => {
  try {
    const events = await loadEvents();
    res.json({ count: events.length, events });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/events/high-impact", async (_req, res) => {
  try {
    const events = await loadEventsByImpact("High");
    res.json({ count: events.length, events });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/events/by-country/:country", async (req, res) => {
  try {
    const country = req.params.country.toUpperCase();
    const events = await loadEventsByCountry(country);
    res.json({ count: events.length, events });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/status", async (_req, res) => {
  try {
    const meta = await getScrapeStatus();
    res.json({ scraping, ...meta });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/scrape", async (req, res) => {
  if (scraping) {
    res.status(409).json({ error: "A scrape is already in progress" });
    return;
  }

  const withDetails = req.body?.details === true;
  scraping = true;

  try {
    console.log(
      `Scrape started (${withDetails ? "with details" : "quick"})...`
    );
    const events = withDetails ? await scrapeWithDetails() : await scrape();

    console.log(`Saving ${events.length} events to Firebase...`);
    await saveEvents(events);
    console.log("Saved to Firebase");

    res.json({
      success: true,
      count: events.length,
      withDetails,
      events,
    });
  } catch (err) {
    console.error("Scrape failed:", err);
    res.status(500).json({ error: (err as Error).message });
  } finally {
    scraping = false;
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`API:  http://localhost:${PORT}/api/events`);
  console.log(`UI:   http://localhost:${PORT}`);
});
