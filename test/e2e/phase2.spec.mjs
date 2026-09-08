import { test, expect } from '@playwright/test';

test.describe('notes et statistiques individuelles', () => {
  test('l\'onglet Joueurs classe par note décroissante', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="players"]');

    const first = page.locator('.player-stat').first();
    await expect(first).toContainText('Ousmane Dembele');
    await expect(first.locator('.player-stat__rating')).toHaveText('8.4');
    // La ligne ne mentionne que ce que le joueur a fait, jamais des zeros.
    await expect(first).toContainText('2 buts');
    await expect(first).not.toContainText('0 but');
  });

  test('un clic sur un joueur ouvre sa fiche', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="players"]');
    await page.locator('.player-stat').first().click();
    await expect(page).toHaveURL(/#\/joueur\/\d+/);
  });
});

test.describe('composition sur le terrain', () => {
  test('place les onze titulaires de chaque équipe', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="lineups"]');

    await expect(page.locator('.pitch')).toHaveCount(2);
    await expect(page.locator('.pitch__player')).toHaveCount(22);
    // Le gardien occupe la première ligne, seul.
    await expect(page.locator('.pitch').first().locator('.pitch__line').first()
      .locator('.pitch__player')).toHaveCount(1);
  });
});

test.describe('classements individuels', () => {
  test('bascule entre buteurs, passeurs et cartons', async ({ page }) => {
    await page.goto('/#/competition/61?season=2023');
    await page.waitForSelector('table.standings');
    await page.click('[data-tab="scorers"]');

    const first = page.locator('#competition-panel .list-row').first();
    await expect(first).toContainText('Ousmane Dembele');
    await expect(first.locator('.list-row__value')).toHaveText('12');

    await page.click('[data-ranking="assists"]');
    await expect(first).toContainText('Vitinha');
    await expect(first.locator('.list-row__value')).toHaveText('11');

    await page.click('[data-ranking="yellow"]');
    await expect(first).toContainText('Balerdi');
    await expect(first.locator('.list-row__value')).toHaveText('12');
  });
});

test.describe('classement domicile et extérieur', () => {
  test('recalcule rang et points sur le bilan de la moitié concernée', async ({ page }) => {
    await page.goto('/#/competition/61?season=2023');
    await page.waitForSelector('table.standings');

    const leader = page.locator('table.standings tbody tr').first();
    await expect(leader).toContainText('Paris Saint Germain');

    await page.click('[data-side="home"]');
    await page.waitForSelector('table.standings');
    // A domicile : 5 matchs joués, donc jamais les 10 du classement général.
    await expect(page.locator('table.standings tbody tr').first().locator('td').nth(2)).toHaveText('5');
    // La légende européenne n'a pas de sens sur un classement partiel.
    await expect(page.locator('.legend')).toHaveCount(0);

    await page.click('[data-side="all"]');
    await page.waitForSelector('.legend');
    await expect(page.locator('table.standings tbody tr').first().locator('td').nth(2)).toHaveText('10');
  });
});

test.describe('fiche joueur', () => {
  test('affiche identité, statistiques, transferts et palmarès', async ({ page }) => {
    await page.goto('/#/joueur/1?season=2023');
    await page.waitForSelector('.mh');

    await expect(page.locator('.mh')).toContainText('Ousmane Dembele');
    await expect(page.locator('.mh')).toContainText('178 cm');
    await expect(page.locator('.kv__row').first()).toContainText('Matchs joues');

    await page.click('[data-tab="transferts"]');
    await expect(page.locator('.list-row').first()).toContainText('Barcelona');

    await page.click('[data-tab="palmares"]');
    await expect(page.locator('.list-row').first()).toContainText('Ligue 1');

    await page.click('[data-tab="absences"]');
    await expect(page.locator('.list-row').first()).toContainText('Hamstring');
  });
});

test.describe('fiche équipe enrichie', () => {
  test('affiche buts par quart d\'heure, records et formations', async ({ page }) => {
    await page.goto('/#/equipe/85');
    await page.waitForSelector('.minute-bars');

    // Deux graphiques : buts marqués et buts encaissés.
    await expect(page.locator('.minute-bars')).toHaveCount(2);
    await expect(page.locator('.card').filter({ hasText: 'Records de la saison' }))
      .toContainText('Plus longue serie de victoires');
    await expect(page.locator('.card').filter({ hasText: 'Formations utilisees' })
      .locator('.chip').first()).toContainText('4-3-3');
    await expect(page.locator('.card').filter({ hasText: 'penaltys' })).toContainText('88.89%');
  });
});
