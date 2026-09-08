import { test, expect } from '@playwright/test';

test.describe('onglet Contexte', () => {
  test('affiche la météo prévue à l\'heure du coup d\'envoi', async ({ page }) => {
    await page.goto('/#/match/1005');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="context"]');
    await page.waitForSelector('.weather');

    const carte = page.locator('.card').filter({ hasText: 'Meteo au stade' });
    await expect(carte).toContainText('14 °C');
    await expect(carte).toContainText('Pluie faible');
    await expect(carte).toContainText('Paris');
    await expect(carte).toContainText('Risque de pluie');
    await expect(carte).toContainText('23 km/h de ouest');
    // La source est nommée : personne ne doit croire que c'est une mesure au stade.
    await expect(carte).toContainText('Open-Meteo');
  });

  test('un match à venir n\'annonce pas de résumé vidéo', async ({ page }) => {
    await page.goto('/#/match/1005');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="context"]');
    await page.waitForSelector('.weather');
    await expect(page.locator('#match-panel')).toContainText('une fois la rencontre commencee');
  });

  test('sans fournisseur vidéo, des liens de recherche sont proposés et expliqués', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="context"]');
    await page.waitForSelector('a.chip');

    const liens = page.locator('a.chip');
    await expect(liens).toHaveCount(2);
    await expect(liens.first()).toHaveAttribute('target', '_blank');
    await expect(liens.first()).toHaveAttribute('rel', /noreferrer/);
    // La recherche doit porter sur les deux équipes et l'année.
    const href = decodeURIComponent(await liens.first().getAttribute('href'));
    expect(href).toContain('Paris Saint Germain');
    expect(href).toContain('Marseille');

    await expect(page.locator('#match-panel')).toContainText('VIDEO_FEED_URL');
  });
});
