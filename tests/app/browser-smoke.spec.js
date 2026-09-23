import { expect, test } from "@playwright/test";

test("boots the browser shell with the calculation Worker boundary", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto("/", { waitUntil: "networkidle" });

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle("BigCalc");
  await expect(page.getByRole("heading", { level: 1, name: "BigCalc app booted" })).toBeVisible();
  await expect(page.locator("#app")).toHaveAttribute("data-calculation-worker", "started");
  await expect(page.locator(".app-shell")).toHaveCSS("display", "grid");
  expect(pageErrors).toEqual([]);
});

test("target browser structured-clones bigint exponents", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  const exponent = await page.evaluate(() => {
    const cloned = globalThis.structuredClone({ exponent10: 12345678901234567890n });
    return cloned.exponent10.toString();
  });

  expect(exponent).toBe("12345678901234567890");
});
