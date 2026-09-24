import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

test("drawer lists registered calculators and Back closes it without changing calculation", async ({
  page
}) => {
  await page.getByRole("textbox", { name: "Выражение" }).fill("2+3");
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
  await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
  const drawer = page.getByRole("navigation", { name: "Калькуляторы" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "BigCalc" })).toHaveAttribute(
    "aria-current",
    "true"
  );
  await expect(drawer.getByRole("button")).toHaveCount(1);
  await expect(page.getByText("+ Добавить калькулятор")).toHaveCount(0);
  await page.goBack({ waitUntil: "networkidle" });
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("status", { name: "Результат" })).toHaveText("5");
});

test("overflow destinations and history follow the same browser navigation stack", async ({
  page
}) => {
  await page.getByRole("button", { name: "История" }).click();
  await page.getByRole("button", { name: "Меню" }).click();
  const menu = page.getByRole("menu", { name: "Меню приложения" });
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  await menu.getByRole("menuitem", { name: "О проекте" }).click();
  const about = page.getByRole("region", { name: "О проекте BigCalc" });
  await expect(about).toBeVisible();
  await expect(about.getByText("Версия 1.0")).toBeVisible();
  await expect(about.getByRole("link", { name: "Открыть GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/dimailcreator/BigCalc"
  );
  await page.goBack({ waitUntil: "networkidle" });
  await expect(about).toBeHidden();
  await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  await page.goBack({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await page.goForward({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "История" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
});

test("Escape and scrim close the top navigation layer", async ({ page }) => {
  await page.getByRole("button", { name: "Меню" }).click();
  const menu = page.getByRole("menu", { name: "Меню приложения" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
  const drawer = page.getByRole("navigation", { name: "Калькуляторы" });
  await expect(drawer).toBeVisible();
  await page
    .getByRole("button", { name: "Закрыть список калькуляторов" })
    .click({ position: { x: 370, y: 80 } });
  await expect(drawer).toBeHidden();
});

test("drawer, popup, and About fit portrait and tablet viewports", async ({ page }) => {
  for (const size of [
    { width: 360, height: 640 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 }
  ]) {
    await page.setViewportSize(size);
    await page.getByRole("button", { name: "Калькуляторы", exact: true }).click();
    const drawer = page.getByRole("navigation", { name: "Калькуляторы" });
    await expect(drawer).toBeVisible();
    const drawerBox = await drawer.boundingBox();
    expect(Math.abs(drawerBox.width - Math.min(size.width * 0.82, 360))).toBeLessThan(1);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "Меню" }).click();
    const menu = page.getByRole("menu", { name: "Меню приложения" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "О проекте" }).click();
    const about = page.getByRole("region", { name: "О проекте BigCalc" });
    await expect(about).toBeVisible();
    expect(await about.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
      false
    );
    await about.getByRole("button", { name: "Назад к калькулятору" }).click();
    await expect(about).toBeHidden();
  }
});
