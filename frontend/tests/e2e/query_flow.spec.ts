import { test, expect } from "@playwright/test";

test.describe("Query Flow", () => {
  test("submits a question and receives results", async ({ page }) => {
    await page.goto("/");
    // Type in the query input
    await page.getByRole("textbox").fill("How many orders were completed?");
    await page.keyboard.press("Control+Enter");
    
    // Wait for SQL panel to appear
    await expect(page.locator('[data-testid="sql-panel"]')).toBeVisible({ timeout: 15000 });
    
    // Wait for result table to render
    await expect(page.locator('[data-testid="result-table"]')).toBeVisible({ timeout: 30000 });
    
    // Verify explanation appears
    await expect(page.locator('[data-testid="explanation-panel"]')).toBeVisible({ timeout: 30000 });
  });

  test("shows error for injection attempt", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox").fill("Drop the orders table");
    await page.keyboard.press("Control+Enter");
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 15000 });
  });

  test("example suggestion chips work", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-testid="suggestion-chip"]').first().click();
    await expect(page.getByRole("textbox")).not.toHaveValue("");
  });

  test("cancel button stops streaming", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox").fill("Show me all orders");
    await page.keyboard.press("Control+Enter");
    
    // Wait for streaming to start and cancel button to be visible
    await expect(page.locator('[data-testid="cancel-button"]')).toBeVisible({ timeout: 5000 });
    
    // Click cancel button
    await page.locator('[data-testid="cancel-button"]').click();
    
    // Stream should stop and cancel button should disappear
    await expect(page.locator('[data-testid="cancel-button"]')).not.toBeVisible({ timeout: 3000 });
  });
});
