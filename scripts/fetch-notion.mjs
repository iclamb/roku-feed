// Fetches the Notion "Project Hub" database and writes a clean JSON feed
// that the Roku channel can render. No dependencies — uses Node 20+ global fetch.
//
// Reads two env vars (set as GitHub Actions secrets/vars):
//   NOTION_TOKEN  – Notion internal integration secret (secret_...)
//   DATABASE_ID   – the Project Hub database id
//
// Writes: public/rokuhub.json

import { writeFile, mkdir } from "node:fs/promises";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.DATABASE_ID || "15246b43-db12-42b4-a5ca-db7ff9c22c44";
const NOTION_VERSION = "2022-06-28";

if (!NOTION_TOKEN) {
  console.error("Missing NOTION_TOKEN environment variable.");
  process.exit(1);
}

// --- Property extraction helpers -------------------------------------------

function plainText(rich) {
  if (!Array.isArray(rich)) return "";
  return rich.map((t) => t.plain_text).join("").trim();
}

function readProp(props, name) {
  const p = props[name];
  if (!p) return null;
  switch (p.type) {
    case "title":
      return plainText(p.title);
    case "rich_text":
      return plainText(p.rich_text);
    case "select":
      return p.select ? p.select.name : null;
    case "multi_select":
      return p.multi_select.map((o) => o.name);
    case "url":
      return p.url || null;
    case "checkbox":
      return p.checkbox;
    case "date":
      return p.date ? p.date.start : null;
    case "people":
      return p.people.map((u) => u.name || u.id);
    default:
      return null;
  }
}

// --- Fetch all rows (handles pagination) -----------------------------------

async function queryDatabase() {
  const rows = [];
  let cursor = undefined;

  do {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          start_cursor: cursor,
        }),
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`Notion API error ${res.status}: ${body}`);
      process.exit(1);
    }

    const data = await res.json();
    rows.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return rows;
}

// --- Shape into the feed ----------------------------------------------------

function toItem(page) {
  const props = page.properties;
  return {
    id: page.id,
    title: readProp(props, "Title") || "Untitled",
    status: readProp(props, "Status"),
    type: readProp(props, "Type"),
    formats: readProp(props, "Format") || [],
    assignees: readProp(props, "Content Creator") || [],
    dueDate: readProp(props, "Due Date"),
    publishDate: readProp(props, "Publish Date"),
    notes: readProp(props, "Brief / Notes") || "",
    finalLink: readProp(props, "Final Link"),
    sizes: readProp(props, "Sizes") || "",
    archived: readProp(props, "Archive") === true,
    url: page.url,
  };
}

async function main() {
  const rows = await queryDatabase();
  const items = rows.map(toItem).filter((it) => !it.archived);

  const feed = {
    title: "Project Hub",
    generatedAt: new Date().toISOString(),
    count: items.length,
    items,
  };

  await mkdir("public", { recursive: true });
  await writeFile("public/rokuhub.json", JSON.stringify(feed, null, 2));
  console.log(`Wrote public/rokuhub.json with ${items.length} items.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
