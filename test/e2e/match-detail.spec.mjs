import { test, expect } from '@playwright/test';

test.describe('fiche de match', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
  });

  test('affiche le score, le statut et la mi-temps', async ({ page }) => {
    await expect(page.locator('.mh__score')).toHaveText('3 - 1');
    await expect(page.locator('.mh__status').first()).toHaveText('Termine');
    await expect(page.locator('.mh__status').nth(1)).toHaveText('Mi-temps 1 - 0');
  });

  test('affiche le stade et l\'arbitre', async ({ page }) => {
    await expect(page.locator('.mh__meta')).toContainText('Parc des Princes');
    await expect(page.locator('.mh__meta')).toContainText('C. Turpin');
  });

  test('l\'onglet resume liste les faits de match', async ({ page }) => {
    await expect(page.locator('.event')).toHaveCount(3);
    const first = page.locator('.event').first();
    await expect(first.locator('.event__minute')).toHaveText("23'");
    await expect(first).toContainText('Ousmane Dembele');
    await expect(first).toContainText('But');
    await expect(first).toContainText('Vitinha');
  });

  test('le temps additionnel est affiche', async ({ page }) => {
    await expect(page.locator('.event').nth(2).locator('.event__minute')).toHaveText("90+3'");
  });

  test('l\'onglet statistiques compare les deux equipes', async ({ page }) => {
    await page.click('[data-tab="stats"]');
    const possession = page.locator('.stat').first();
    await expect(possession).toContainText('62%');
    await expect(possession).toContainText('Possession');
    await expect(possession).toContainText('38%');
  });

  test('l\'onglet compositions affiche formations et joueurs', async ({ page }) => {
    await page.click('[data-tab="lineups"]');
    await expect(page.locator('.lineup__formation').first()).toHaveText('4-3-3');
    await expect(page.locator('.player').first()).toContainText('G. Donnarumma');
    await expect(page.getByText('Luis Enrique')).toBeVisible();
  });

  test('l\'onglet confrontations liste les rencontres passees', async ({ page }) => {
    await page.click('[data-tab="h2h"]');
    await expect(page.locator('#match-panel .match')).toHaveCount(2);
  });

  test('la fiche s\'ouvre toujours sur le resume', async ({ page }) => {
    await page.click('[data-tab="stats"]');
    await page.goto('/#/');
    await page.waitForSelector('.league');
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await expect(page.locator('[data-tab="summary"]')).toHaveClass(/is-active/);
  });

  test('un clic sur une ligne de match ouvre sa fiche', async ({ page }) => {
    await page.goto('/#/');
    await page.locator('.match[data-match="1001"] .match__teams').click();
    await expect(page).toHaveURL(/#\/match\/1001/);
    await expect(page.locator('.mh__score')).toHaveText('3 - 1');
  });
});
