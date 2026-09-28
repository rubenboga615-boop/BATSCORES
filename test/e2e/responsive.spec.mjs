import { test, expect } from '@playwright/test';

test.describe('mise en page', () => {
  test('aucun debordement horizontal', async ({ page }) => {
    for (const route of ['/#/', '/#/match/1001', '/#/competition/61?season=2025', '/#/competitions']) {
      await page.goto(route);
      await page.waitForTimeout(600);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, `debordement horizontal sur ${route}`).toBe(false);
    }
  });

  test('la barre d\'onglets n\'apparait que sur petit ecran', async ({ page, isMobile }) => {
    await page.goto('/#/');
    await page.waitForSelector('.league');
    await expect(page.locator('.tab-bar')).toBeVisible({ visible: Boolean(isMobile) });
  });
});

test.describe('robustesse', () => {
  test('aucune erreur JavaScript en parcourant l\'application', async ({ page }) => {
    const failures = [];
    page.on('pageerror', (err) => failures.push(err.message));
    page.on('console', (msg) => {
      // Les logos pointent vers un domaine factice : leur echec de chargement
      // est attendu et sans rapport avec le code de l'application.
      if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) {
        failures.push(msg.text());
      }
    });

    for (const route of ['/#/', '/#/live', '/#/match/1001', '/#/competitions',
      '/#/competition/61?season=2025', '/#/equipe/85', '/#/favoris', '/#/recherche?q=paris']) {
      await page.goto(route);
      await page.waitForTimeout(500);
    }

    expect(failures).toEqual([]);
  });

  test('le manifeste PWA est servi', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.short_name).toBe('BATSCORES');
  });
});
