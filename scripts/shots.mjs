import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:5174";
const OUT = new URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  console.log("saved", name);
}

// ---------- Desktop ----------
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await desktop.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("PAGE ERROR:", m.text());
});
page.on("pageerror", (e) => console.log("PAGE EXCEPTION:", e.message));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await shot(page, "01-desktop-chat");

// Model selector dropdown
await page.getByTitle("Select model").click();
await page.waitForTimeout(350);
await shot(page, "02-desktop-model-selector");
await page.mouse.click(900, 120);

// Attach menu
await page.getByTitle("Add attachment").click();
await page.waitForTimeout(300);
await shot(page, "03-desktop-attach-menu");
await page.mouse.click(900, 120);

// Sidebar conversation menu
const chatItem = page.getByRole("button", { name: /Refactor the streaming/ }).first();
await chatItem.hover();
await page.getByLabel("Conversation actions").first().click();
await page.waitForTimeout(250);
await shot(page, "04-desktop-chat-menu");
await page.mouse.click(900, 120);


// Settings — Preferences
await page.getByTitle("Settings").first().click();
await page.waitForTimeout(400);
await shot(page, "05-settings-preferences");

// API Keys
await page.getByRole("button", { name: "API Keys", exact: true }).click();
await page.waitForTimeout(300);
await shot(page, "06-settings-api-keys");

// Models
await page.getByRole("button", { name: "Models", exact: true }).click();
await page.waitForTimeout(600);
await shot(page, "07-settings-models");

// Local AI guided setup panel
await page.getByRole("button", { name: "+ Add Local Provider" }).click();
await page.waitForTimeout(1200);
await shot(page, "07b-local-setup-panel");
await page.getByLabel("Close setup").click();
await page.waitForTimeout(200);

// Account
await page.getByRole("button", { name: "Account", exact: true }).click();
await page.waitForTimeout(400);
await shot(page, "08-settings-account");

// Usage
await page.getByRole("button", { name: "Usage", exact: true }).click();
await page.waitForTimeout(400);
await shot(page, "09-settings-usage");

// Close settings
await page.getByLabel("Close settings").click();
await page.waitForTimeout(300);

// Rename modal
await chatItem.hover();
await page.getByLabel("Conversation actions").first().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Rename", exact: true }).click();
await page.waitForTimeout(300);
await shot(page, "14-rename-modal");
await page.getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(200);

// Delete modal
await chatItem.hover();
await page.getByLabel("Conversation actions").first().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.waitForTimeout(300);
await shot(page, "15-delete-modal");
await page.getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(200);

// Terminal panel (from the composer attach menu)
await page.getByTitle("Add attachment").click();
await page.waitForTimeout(250);
await page.getByRole("menuitem", { name: "Terminal" }).click();
await page.waitForTimeout(600);
await shot(page, "16-terminal-panel");
await page.getByLabel("Close workspace panel").click();
await page.waitForTimeout(200);

// New chat empty state
await page.getByRole("button", { name: "New chat" }).click();
await page.waitForTimeout(500);
await shot(page, "10-empty-state");

// Simulated streaming reply
await page.getByLabel("Message input").fill("How should I structure a model selector?");
await page.getByLabel("Send message").click();
await page.waitForTimeout(700);
await shot(page, "11-streaming");
await page.waitForTimeout(4500);
await shot(page, "12-reply");

// Light theme
await page.getByTitle("Settings").first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "light", exact: true }).click();
await page.waitForTimeout(400);
await page.getByLabel("Close settings").click();
await page.waitForTimeout(300);
await shot(page, "13-light-chat");
await page.getByTitle("Settings").first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "dark", exact: true }).click();
await page.waitForTimeout(300);
await page.getByLabel("Close settings").click();

await desktop.close();

// ---------- Mobile ----------
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2
});
const m = await mobile.newPage();
m.on("pageerror", (e) => console.log("MOBILE EXCEPTION:", e.message));
await m.goto(BASE, { waitUntil: "networkidle" });
await m.waitForTimeout(900);
await shot(m, "20-mobile-chat");

await m.getByLabel("Open sidebar").click();
await m.waitForTimeout(500);
await shot(m, "21-mobile-drawer");

await m.getByTitle("Settings").first().click();
await m.waitForTimeout(500);
await shot(m, "22-mobile-settings");
await m.getByRole("button", { name: "Models", exact: true }).click();
await m.waitForTimeout(600);
await shot(m, "23-mobile-settings-models");
await m.getByLabel("Close settings").click();
await m.waitForTimeout(300);
await m.mouse.click(195, 300);
await m.waitForTimeout(300);

// Composer model picker on mobile
await m.getByTitle("Select model").click();
await m.waitForTimeout(400);
await shot(m, "24-mobile-model-selector");

await browser.close();
console.log("done");
