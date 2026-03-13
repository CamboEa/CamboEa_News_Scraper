import { chromium, type BrowserContext, type Page } from "playwright";
import type { CalendarEvent, EmbeddedEvent, EventDetail } from "./types.js";

const CALENDAR_URL = "https://www.forexfactory.com/calendar";
const BASE_URL = "https://www.forexfactory.com";
const TIMEZONE = "America/New_York";

const IMPACT_MAP: Record<string, string> = {
  "High Impact Expected": "High",
  "Medium Impact Expected": "Medium",
  "Low Impact Expected": "Low",
  "Non-Economic": "Holiday",
};

async function createStealthContext() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    timezoneId: TIMEZONE,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  return { browser, context };
}

function datelineToISO(dateline: number): string {
  const date = new Date(dateline * 1000);

  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(
    date.toLocaleString("en-US", { timeZone: TIMEZONE })
  );
  const offsetMs = utc.getTime() - local.getTime();
  const offsetMinutes = offsetMs / 60_000;
  const offsetH = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetM = Math.abs(offsetMinutes) % 60;
  const sign = offsetMinutes >= 0 ? "-" : "+";

  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}` +
    `T${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}` +
    `${sign}${pad(offsetH)}:${pad(offsetM)}`
  );
}

function makeKey(currency: string, title: string): string {
  return `${currency}::${title}`;
}

async function extractEventsFromPage(
  page: Page
): Promise<{ events: CalendarEvent[]; soloUrls: Map<string, string> }> {
  const raw = await page.evaluate(() => {
    const w = window as any;
    const result: {
      name: string;
      currency: string;
      dateline: number;
      actual: string;
      forecast: string;
      previous: string;
      impactTitle: string;
      soloUrl: string;
    }[] = [];

    const states = w.calendarComponentStates;
    if (!states) return result;

    for (const key of Object.keys(states)) {
      const state = states[key];
      if (!state?.days) continue;
      for (const day of state.days) {
        for (const evt of day.events) {
          result.push({
            name: evt.name ?? "",
            currency: evt.currency ?? "",
            dateline: evt.dateline ?? 0,
            actual: evt.actual ?? "",
            forecast: evt.forecast ?? "",
            previous: evt.previous ?? "",
            impactTitle: evt.impactTitle ?? "",
            soloUrl: evt.soloUrl ?? "",
          });
        }
      }
    }
    return result;
  });

  const soloUrls = new Map<string, string>();

  const events: CalendarEvent[] = raw.map((evt) => {
    const key = makeKey(evt.currency, evt.name);
    if (evt.soloUrl && !soloUrls.has(evt.soloUrl)) {
      soloUrls.set(evt.soloUrl, key);
    }

    return {
      title: evt.name,
      country: evt.currency,
      date: datelineToISO(evt.dateline),
      impact: IMPACT_MAP[evt.impactTitle] ?? evt.impactTitle,
      actual: evt.actual,
      forecast: evt.forecast,
      previous: evt.previous,
      detail: null,
    };
  });

  return { events, soloUrls };
}

async function waitForCloudflare(
  page: Page,
  timeout = 15_000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const title = await page.title();
    if (!title.includes("Just a moment")) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}

async function fetchDetailFromSoloPage(
  page: Page,
  soloUrl: string
): Promise<EventDetail | null> {
  try {
    await page.goto(`${BASE_URL}${soloUrl}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    if (!(await waitForCloudflare(page))) {
      console.warn(`  Cloudflare blocked: ${soloUrl}`);
      return null;
    }

    try {
      await page.waitForSelector(".broker-profile__row", { timeout: 5000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    const result = await page.evaluate(() => {
      const rows = document.querySelectorAll(".broker-profile__row");
      const fields: Record<string, string> = {};

      rows.forEach((row) => {
        const label =
          row
            .querySelector(".broker-profile__label h6")
            ?.textContent?.trim()
            ?.replace(/:$/, "")
            .toLowerCase() ?? "";
        const value =
          row
            .querySelector(".broker-profile__data-value")
            ?.textContent?.trim() ?? "";
        if (label && value) fields[label] = value;
      });

      const w = window as any;
      const upcoming = w.calendarSoloState?.upcoming;

      return {
        usual_effect: fields["usual effect"] ?? "",
        frequency: fields["frequency"] ?? "",
        next_release: upcoming?.date ?? "",
      };
    });

    return result.usual_effect || result.frequency || result.next_release
      ? result
      : null;
  } catch (err) {
    console.warn(`  Failed: ${soloUrl} - ${(err as Error).message}`);
    return null;
  }
}

export async function scrape(): Promise<CalendarEvent[]> {
  const { browser, context } = await createStealthContext();
  try {
    const page = await context.newPage();
    await page.goto(CALENDAR_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const { events } = await extractEventsFromPage(page);
    await page.close();
    return events;
  } finally {
    await browser.close();
  }
}

export async function scrapeWithDetails(): Promise<CalendarEvent[]> {
  const { browser, context } = await createStealthContext();
  try {
    const page = await context.newPage();
    await page.goto(CALENDAR_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForTimeout(5000);

    const { events, soloUrls } = await extractEventsFromPage(page);

    const soloEntries = [...soloUrls.entries()];
    const detailCache = new Map<string, EventDetail | null>();

    console.log(
      `Fetching details for ${soloEntries.length} unique events...`
    );

    const detailPage = await context.newPage();

    for (let i = 0; i < soloEntries.length; i++) {
      const [soloUrl] = soloEntries[i];
      const detail = await fetchDetailFromSoloPage(detailPage, soloUrl);
      detailCache.set(soloUrl, detail);

      if ((i + 1) % 10 === 0 || i === soloEntries.length - 1) {
        console.log(`  Progress: ${i + 1}/${soloEntries.length}`);
      }

      await detailPage.waitForTimeout(500);
    }

    await detailPage.close();
    await page.close();

    for (const event of events) {
      const key = makeKey(event.country, event.title);
      for (const [soloUrl, mappedKey] of soloUrls) {
        if (mappedKey === key) {
          event.detail = detailCache.get(soloUrl) ?? null;
          break;
        }
      }
    }

    return events;
  } finally {
    await browser.close();
  }
}
