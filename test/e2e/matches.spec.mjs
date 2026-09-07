import { test, expect } from '@playwright/test';

test.describe('liste des matchs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/');
    await page.waitForSelector('.league');
  });

  test('groupe les rencontres par competition, majeures en tete', async ({ page }) => {
    await expect(page.locator('.league')).toHaveCount(4);
    await expect(page.locator('.league__name')).toHaveText([
      'Premier League', 'La Liga', 'Bundesliga', 'Ligue 1',
    ]);
  });

  test('traduit les pays en francais', async ({ page }) => {
    await expect(page.locator('.league__country')).toHaveText([
      'Angleterre', 'Espagne', 'Allemagne', 'France',
    ]);
  });

  test('affiche le score des rencontres terminees', async ({ page }) => {
    const match = page.locator('.match[data-match="1001"]');
    await expect(match.locator('.match__score')).toContainText('3');
    await expect(match.locator('.match__score')).toContainText('1');
    await expect(match.locator('.status-ft')).toHaveText('Term.');
  });

  test('affiche la minute de jeu des rencontres en cours', async ({ page }) => {
    await expect(page.locator('.match[data-match="1002"] .status-live')).toHaveText("67'");
  });

  test('affiche l\'heure de coup d\'envoi des rencontres a venir', async ({ page }) => {
    // La pile de test fixe le coup d'envoi a 20:00 heure de Paris.
    await expect(page.locator('.match[data-match="1003"] .match__time')).toHaveText('20:00');
  });

  test('signale les rencontres reportees', async ({ page }) => {
    await expect(page.locator('.match[data-match="1004"] .status-cancel')).toHaveText('Reporte');
  });

  test('les filtres restreignent la liste', async ({ page }) => {
    await page.click('[data-filter="live"]');
    await expect(page.locator('.match')).toHaveCount(1);

    await page.click('[data-filter="finished"]');
    await expect(page.locator('.match')).toHaveCount(1);

    await page.click('[data-filter="scheduled"]');
    await expect(page.locator('.match')).toHaveCount(1);

    await page.click('[data-filter="all"]');
    await expect(page.locator('.match')).toHaveCount(4);
  });

  test('une competition peut etre repliee et depliee', async ({ page }) => {
    const first = page.locator('.league').first();
    await first.locator('.league__head').click();
    await expect(first).toHaveClass(/is-collapsed/);
    await first.locator('.league__head').click();
    await expect(first).not.toHaveClass(/is-collapsed/);
  });

  test('la navigation par date met a jour l\'URL', async ({ page }) => {
    await page.click('[data-shift="1"]');
    await expect(page).toHaveURL(/\?date=\d{4}-\d{2}-\d{2}/);
  });

  test('mettre un match en favori met a jour le compteur', async ({ page }) => {
    await page.locator('.match__star').first().click();
    await expect(page.locator('#fav-count')).toHaveText('1');
    // Le favori survit a un rechargement.
    await page.reload();
    await page.waitForSelector('.league');
    await expect(page.locator('#fav-count')).toHaveText('1');
  });
});
