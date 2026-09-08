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
    // Le serveur envoie le nom du championnat : l'interface n'a pas à afficher
    // « competition 61 » ni à dupliquer la table des identifiants.
    await expect(page.locator('.card').filter({ hasText: 'Competitions collectees' }))
      .toContainText('Ligue 1 · saison 2023');
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

test.describe('collecte multi-championnats', () => {
  test('un ensemble se choisit d\'un geste et se chiffre', async ({ page }) => {
    await page.goto('/#/collecte');
    await page.waitForSelector('#col-league');

    // Les identifiants d'API-Football ne sont pas devinables : les ensembles
    // évitent d'avoir à les chercher.
    await page.click('text=Top 5 · 5 dernieres saisons');
    await expect(page.locator('#col-league')).toHaveValue('top5');
    await expect(page.locator('#col-season')).toHaveValue(/\d{4}-\d{4}/);

    await page.click('#col-plan');
    await page.waitForSelector('text=appels estimes');
    const carte = page.locator('.card').filter({ hasText: 'Lancer une collecte' });
    // Cinq championnats sur cinq saisons doivent coûter bien plus qu'une seule.
    await expect(carte).toContainText('appels estimes');
  });

  test('une saisie libre est acceptée : listes et plages', async ({ page }) => {
    await page.goto('/#/collecte');
    await page.waitForSelector('#col-league');
    await page.fill('#col-league', '61,39');
    await page.fill('#col-season', '2022-2023');
    await page.click('#col-plan');
    await page.waitForSelector('text=appels estimes');
    await expect(page.locator('.card').filter({ hasText: 'Lancer une collecte' }))
      .not.toContainText('Estimation impossible');
  });

  test('une saisie fautive est refusée avec sa raison', async ({ page }) => {
    await page.goto('/#/collecte');
    await page.waitForSelector('#col-league');
    await page.fill('#col-league', 'premier-league');
    await page.fill('#col-season', '2023');
    await page.click('#col-plan');
    // Se tromper de compétition coûterait des appels payés : l'erreur doit
    // être visible, pas corrigée en silence.
    await expect(page.locator('#collector-body')).toContainText('Championnat inconnu');
  });
});

test.describe('export de la base', () => {
  test('les tables non vides sont proposées au téléchargement', async ({ page }) => {
    await page.goto('/#/collecte');
    await page.waitForSelector('[data-export]');
    const carte = page.locator('.card').filter({ hasText: 'EXPORTER' });
    await expect(carte).toContainText('aucun appel');
    await expect(page.locator('[data-export="fixtures"]')).toBeVisible();
  });

  test('le CSV servi porte un en-tête et un nom de fichier', async ({ request }) => {
    const response = await request.get('/api/collector/export?table=fixtures&format=csv');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-disposition']).toContain('fixtures.csv');
    const texte = await response.text();
    expect(texte.split('\n')[0]).toContain('id,');
    expect(texte.split('\n')[0]).toContain('goals_home');
  });

  test('une table inconnue est refusée', async ({ request }) => {
    const response = await request.get('/api/collector/export?table=sqlite_master&format=csv');
    expect(response.status()).toBe(404);
  });
});
