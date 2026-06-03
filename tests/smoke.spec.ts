import { expect, test } from "@playwright/test";

test("App loads without React crashing", async ({ page }) => {
  // Listen for console errors
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (exception) => {
    errors.push(exception.message);
  });

  // Navigate to the built app
  await page.goto("/");

  // If the app crashes, React usually leaves a blank white screen or an error boundary.
  // We can assert that the main app shell actually appeared.
  await expect(page.locator("#root")).not.toBeEmpty();

  if (errors.length > 0) {
    console.log("Caught Console Errors:\n", errors.join("\n\n"));
  }

  // Assert no fatal React errors were logged
  expect(errors.length).toBe(0);
});
