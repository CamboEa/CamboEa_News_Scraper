import { writeFileSync } from "fs";
import { scrape, scrapeWithDetails } from "./scraper.js";

interface CliArgs {
  details: boolean;
  pretty: boolean;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);

  let output = "calendar_data.json";
  const outIdx = args.indexOf("--output");
  const oIdx = args.indexOf("-o");
  if (outIdx !== -1 && outIdx + 1 < args.length) {
    output = args[outIdx + 1];
  } else if (oIdx !== -1 && oIdx + 1 < args.length) {
    output = args[oIdx + 1];
  }

  return {
    details: args.includes("--details"),
    pretty: args.includes("--pretty"),
    output,
  };
}

async function main() {
  const { details, pretty, output } = parseArgs();

  console.log(
    details
      ? "Scraping with event details (Playwright)..."
      : "Scraping calendar data..."
  );

  const data = details ? await scrapeWithDetails() : await scrape();

  const json = JSON.stringify(data, null, pretty ? 2 : undefined);
  writeFileSync(output, json, "utf-8");

  console.log(`Scraped ${data.length} events -> ${output}`);
}

main().catch((err) => {
  console.error("Scraper failed:", err.message);
  process.exit(1);
});
