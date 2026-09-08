import { test, expect } from '@playwright/test';

test.describe('page Collecte', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/collecte');
    await page.waitForSelector('.card, .empty');
  });

  test('affiche le quota consomme du jour', async ({ page }) => {
    const quota = page.locator('.card').filter({ hasText: "Quota d'aujourd'hui" });
    await expect(quota).toContainText('12');
    await expect(quota).toContainText('7 500');
    await expect(quota).toContainText('appels restants');
  });

  test('affiche l\'avancement et les echecs', async ({ page }) => {
    const progress = page.locator('.card').filter({ hasText: 'Avancement' });
    await expect(progress).toContainText('5 / 8');
    await expect(progress).toContainText('En echec');
  });

  test('liste les competitions collectees et le contenu de la base', async ({ page }) => {
    await expect(page.locator('.card').filter({ hasText: 'Competitions collectees' }))
      .toContainText('Competition 61 · saison 2023');
    await expect(page.locator('.card').filter({ hasText: 'Contenu de la base' }))
      .toContainText('Reponses brutes archivees');
  });

  test('montre la derniere execution', async ({ page }) => {
    await expect(page.locator('.card').filter({ hasText: 'Dernieres executions' }))
      .toContainText('essentiel');
  });

  test('le lancement est desactive tant qu\'aucun jeton n\'est configure', async ({ page }) => {
    const launch = page.locator('.card').filter({ hasText: 'Lancer une collecte' });
    await expect(launch).toContainText('COLLECTOR_ADMIN_TOKEN');
    await expect(launch.locator('#col-start')).toBeDisabled();
    // Le champ de jeton n'est pas propose puisque le pilotage est desactive.
    await expect(launch.locator('#col-token')).toHaveCount(0);
  });

  test('l\'estimation du cout fonctionne sans consommer de quota', async ({ page }) => {
    await page.fill('#col-league', '61');
    await page.fill('#col-season', '2023');
    await page.selectOption('#col-profile', 'complet');
    await page.click('#col-plan');

    const launch = page.locator('.card').filter({ hasText: 'Lancer une collecte' });
    await expect(launch).toContainText('appels estimes');
    // Le calendrier est deja en base : l'estimation porte sur des chiffres
    // reels (3 rencontres, 6 equipes), pas sur une hypothese.
    await expect(launch).toContainText('3 rencontres');
    await expect(launch).toContainText('6 equipes');

    // Le quota affiche ne doit pas avoir bouge : estimer ne coute rien.
    await expect(page.locator('.card').filter({ hasText: "Quota d'aujourd'hui" })).toContainText('12');
  });

  test('la page est accessible depuis la navigation', async ({ page, isMobile }) => {
    await page.goto('/#/');
    await page.waitForSelector('.league');
    const lien = isMobile
      ? page.locator('.tab-bar a[data-nav="collector"]')
      : page.locator('.app-nav a[data-nav="collector"]');
    await lien.click();
    await expect(page).toHaveURL(/#\/collecte/);
    await expect(page.locator('.card').first()).toBeVisible();
  });
});
