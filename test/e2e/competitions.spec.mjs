import { test, expect } from '@playwright/test';

test.describe('competitions', () => {
  test('le catalogue liste les competitions et se filtre', async ({ page }) => {
    await page.goto('/#/competitions');
    await page.waitForSelector('.list-row');
    await expect(page.locator('.list-row')).toHaveCount(3);

    await page.fill('#league-filter', 'ligue');
    await expect(page.locator('.list-row')).toHaveCount(1);
    await expect(page.locator('.list-row__name')).toHaveText('Ligue 1');
  });

  test('le classement affiche les colonnes et les zones', async ({ page }) => {
    await page.goto('/#/competition/61?season=2025');
    await page.waitForSelector('table.standings');

    await expect(page.locator('table.standings tbody tr')).toHaveCount(4);
    await expect(page.locator('tr.zone-ucl')).toHaveCount(2);
    await expect(page.locator('tr.zone-uel')).toHaveCount(1);
    await expect(page.locator('tr.zone-rel')).toHaveCount(1);

    const leader = page.locator('table.standings tbody tr').first();
    await expect(leader.locator('td.team')).toContainText('Paris Saint Germain');
    await expect(leader.locator('td.points')).toHaveText('23');
  });

  test('la forme est francisee en V/N/D', async ({ page }) => {
    await page.goto('/#/competition/61?season=2025');
    await page.waitForSelector('table.standings');
    await expect(page.locator('.form').first()).toHaveText('VVNDV');
  });

  test('l\'onglet buteurs affiche le classement des marqueurs', async ({ page }) => {
    await page.goto('/#/competition/61?season=2025');
    await page.waitForSelector('table.standings');
    await page.click('[data-tab="scorers"]');
    const first = page.locator('#competition-panel .list-row').first();
    await expect(first).toContainText('Ousmane Dembele');
    await expect(first.locator('.list-row__value')).toHaveText('12');
  });

  test('l\'onglet calendrier groupe par journee', async ({ page }) => {
    await page.goto('/#/competition/61?season=2025');
    await page.waitForSelector('table.standings');
    await page.click('[data-tab="fixtures"]');
    await expect(page.locator('#competition-panel .match')).toHaveCount(2);
  });
});

test.describe('equipe, recherche et favoris', () => {
  test('la fiche equipe affiche identite et stade', async ({ page }) => {
    await page.goto('/#/equipe/85');
    await page.waitForSelector('.mh');
    await expect(page.locator('.mh')).toContainText('Paris Saint Germain');
    await expect(page.locator('.mh')).toContainText('fonde en 1970');
    await expect(page.locator('.mh')).toContainText('Parc des Princes');
  });

  test('la recherche renvoie equipes et competitions', async ({ page }) => {
    await page.goto('/#/recherche?q=paris');
    await page.waitForSelector('.list-row');
    await expect(page.locator('.list-row').first()).toContainText('Paris Saint Germain');
  });

  test('la recherche depuis la barre du haut navigue', async ({ page }) => {
    await page.goto('/#/');
    await page.waitForSelector('.league');
    await page.fill('#search-input', 'paris');
    await page.press('#search-input', 'Enter');
    await expect(page).toHaveURL(/#\/recherche\?q=paris/);
  });

  test('la page favoris est vide au depart puis se remplit', async ({ page }) => {
    await page.goto('/#/favoris');
    await expect(page.locator('.empty h3')).toHaveText('Aucun favori');

    await page.goto('/#/');
    await page.waitForSelector('.league');
    await page.locator('.match[data-match="1001"] .match__star').click();

    await page.goto('/#/favoris');
    await expect(page.locator('.match')).toHaveCount(1);
  });

  test('la page direct ne montre que les rencontres en cours', async ({ page }) => {
    await page.goto('/#/live');
    await page.waitForSelector('.match');
    await expect(page.locator('.match')).toHaveCount(1);
    await expect(page.locator('.status-live')).toHaveText("67'");
  });

  test('une route inconnue affiche une page dediee', async ({ page }) => {
    await page.goto('/#/nimportequoi');
    await expect(page.locator('.empty h3')).toHaveText('Page introuvable');
  });
});
