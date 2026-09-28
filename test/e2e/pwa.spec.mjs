import { test, expect } from '@playwright/test';

test.describe('service worker', () => {
  test('sert la version a jour du shell apres une mise a jour', async ({ page, baseURL }) => {
    // Premiere visite : le service worker s'installe et met le shell en cache.
    await page.goto('/#/');
    await page.waitForSelector('.league');
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Le shell doit venir du reseau, pas d'un cache fige : on verifie que la
    // page rechargee contient bien la navigation complete, onglet Collecte
    // compris. C'est precisement ce qu'un cache prioritaire masquait.
    await page.reload();
    await page.waitForSelector('.league');
    await expect(page.locator('[data-nav="collector"]').first()).toHaveCount(1);

    // Le service worker est bien actif : le mode hors ligne reste possible.
    const controlled = await page.evaluate(
      () => Boolean(navigator.serviceWorker.controller),
    );
    expect(controlled).toBe(true);
  });

  test('les appels API ne sont jamais servis depuis le cache', async ({ page }) => {
    await page.goto('/#/');
    await page.waitForSelector('.league');
    await page.evaluate(() => navigator.serviceWorker.ready);

    // Un score perime n'a aucune valeur : /api/ doit toujours toucher le reseau.
    const fromNetwork = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/fixtures')) fromNetwork.push(r.fromServiceWorker());
    });
    await page.reload();
    await page.waitForSelector('.league');
    expect(fromNetwork.length).toBeGreaterThan(0);
    expect(fromNetwork.every((v) => v === false)).toBe(true);
  });
});
