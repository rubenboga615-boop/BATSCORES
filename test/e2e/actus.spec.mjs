import { test, expect } from '@playwright/test';

test.describe('actualités', () => {
  test('la page liste les articles avec leur source et leur ancienneté', async ({ page }) => {
    await page.goto('/#/actus');
    await page.waitForSelector('.news');

    const articles = page.locator('.news');
    await expect(articles).toHaveCount(2);

    const premier = articles.first();
    // Les accents et les entités HTML doivent arriver lisibles jusqu'à l'écran.
    await expect(premier).toContainText("Le PSG s'impose 3-1 face à l'OM");
    await expect(premier).toContainText('Dembélé');
    await expect(premier).toContainText('Faux Journal');
    await expect(premier).toContainText('il y a 1 h');

    await expect(articles.nth(1)).toContainText('latéral');
  });

  test('les articles sont classés du plus récent au plus ancien', async ({ page }) => {
    await page.goto('/#/actus');
    await page.waitForSelector('.news');
    const titres = await page.locator('.news__title').allTextContents();
    expect(titres[0]).toContain('PSG');
    expect(titres[1]).toContain('Mercato');
  });

  test('les liens sortent du site sans annoncer la provenance', async ({ page }) => {
    await page.goto('/#/actus');
    await page.waitForSelector('.news');
    const lien = page.locator('a.news').first();
    await expect(lien).toHaveAttribute('target', '_blank');
    await expect(lien).toHaveAttribute('rel', /noreferrer/);
    await expect(lien).toHaveAttribute('href', /^https:\/\//);
  });

  test('la navigation mène à la page Actus', async ({ page }) => {
    await page.goto('/#/');
    // Deux entrées portent ce repère : la barre du haut sur grand écran, la
    // barre d'onglets sur mobile. Seule la visible est cliquable.
    await page.locator('a[data-nav="news"]:visible').first().click();
    await expect(page).toHaveURL(/#\/actus/);
    await page.waitForSelector('.news');
  });
});

test.describe('notifications', () => {
  test('la carte explique ce qui sera envoyé avant de le proposer', async ({ page }) => {
    await page.goto('/#/favoris');
    const carte = page.locator('.card').filter({ hasText: 'Notifications' });
    await expect(carte).toBeVisible();
    // Les clés VAPID ne sont pas configurées dans la pile de test : la page
    // doit le dire clairement plutôt que d'afficher un bouton qui échouerait.
    await expect(carte).toContainText('npm run vapid');
    await expect(carte.locator('[data-notifications]')).toHaveCount(0);
  });

  test('le serveur annonce que les notifications sont éteintes', async ({ request }) => {
    const response = await request.get('/api/push/key');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.enabled).toBe(false);
    expect(body.publicKey).toBeUndefined();
  });
});
