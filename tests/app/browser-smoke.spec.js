import { expect, test } from "@playwright/test";

test("boots the browser shell through the public Core alias", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/", { waitUntil: "networkidle" });

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle("BigCalc");
  await expect(page.getByRole("heading", { level: 1, name: "BigCalc app booted" })).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-core-api-version", "1.0.0");
  await expect(page.locator(".app-shell")).toHaveCSS("display", "grid");
  expect(pageErrors).toEqual([]);
});
