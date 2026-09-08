import { test, expect } from '@playwright/test';

test.describe('momentum', () => {
  test('la courbe apparaît sur un match joué, avec ses repères de buts', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');

    const bloc = page.locator('.card').filter({ hasText: 'Momentum' });
    await expect(bloc).toBeVisible();
    await expect(bloc.locator('svg.momentum')).toBeVisible();

    // Quatre buts dans le mock (3-1) : quatre pastilles, trois du cote local.
    await expect(bloc.locator('.momentum__goal')).toHaveCount(4);
    await expect(bloc.locator('.momentum__goal.home')).toHaveCount(3);
    await expect(bloc.locator('.momentum__goal.away')).toHaveCount(1);
    await expect(bloc).toContainText("temps a l'avantage");
    // La limite de l'exercice est annoncée, pas dissimulée.
    await expect(bloc).toContainText('indice de pression');
  });

  test('un match à venir n\'affiche pas de courbe inventée', async ({ page }) => {
    await page.goto('/#/match/1005');
    await page.waitForSelector('.mh');
    await expect(page.locator('.card').filter({ hasText: 'Momentum' })).toHaveCount(0);
  });
});

test.describe('onglet Cotes', () => {
  test('affiche les probabilités nettes de marge et le mouvement', async ({ page }) => {
    await page.goto('/#/match/1005');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="odds"]');
    await page.waitForSelector('.odd:not(.odd--head)');

    const marche = page.locator('.card').filter({ hasText: 'Resultat du match' });
    await expect(marche).toBeVisible();
    await expect(marche).toContainText('Victoire domicile');
    await expect(marche).toContainText('marge retiree');

    // Les trois issues du 1N2, plus la ligne d'en-tête.
    await expect(marche.locator('.odd')).toHaveCount(4);

    // La cote domicile a baissé entre les deux relevés : la probabilité monte.
    const domicile = marche.locator('.odd').nth(1);
    await expect(domicile.locator('.drift')).toContainText('▲');

    const texte = await marche.innerText();
    const parts = [...texte.matchAll(/(\d+(?:\.\d+)?) %/g)].map((m) => Number(m[1]));
    const total = parts.slice(0, 3).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 100)).toBeLessThan(1);
  });

  test('un marché sans cote exploitable ne s\'affiche pas', async ({ page }) => {
    await page.goto('/#/match/1005');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="odds"]');
    await page.waitForSelector('.odd:not(.odd--head)');
    // La base semée contient un relevé vide pour le marché « plus/moins » :
    // il doit disparaître plutôt qu'apparaître vide.
    await expect(page.locator('.card').filter({ hasText: 'Plus / moins' })).toHaveCount(0);
  });
});

test.describe('comparateur', () => {
  test('s\'ouvre depuis la fiche de match et départage les indicateurs', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await page.click('text=Comparer les deux equipes');

    await page.waitForSelector('.versus-head');
    await expect(page.locator('.versus-head')).toContainText('Paris Saint Germain');
    await expect(page.locator('.versus-head')).toContainText('Marseille');

    const lignes = page.locator('.versus');
    expect(await lignes.count()).toBeGreaterThan(9);

    // Au moins une ligne doit désigner un vainqueur, sinon la comparaison
    // ne compare rien.
    expect(await page.locator('.versus__value.is-leader').count()).toBeGreaterThan(0);

    await expect(page.locator('.card').filter({ hasText: 'Buts marques par tranche' })).toBeVisible();
    await expect(page.locator('.minute-bars--versus').first().locator('.minute-bar')).toHaveCount(6);
  });

  test('sans équipes, il explique quoi faire au lieu de planter', async ({ page }) => {
    await page.goto('/#/comparer');
    await expect(page.locator('#app')).toContainText('Comparaison impossible');
  });
});

test.describe('profil par quart d\'heure', () => {
  test('la fiche équipe superpose buts marqués et encaissés sur un seul axe', async ({ page }) => {
    await page.goto('/#/equipe/85');
    await page.waitForSelector('.minute-bars--split');
    const bloc = page.locator('.card').filter({ hasText: 'Buts par tranche de 15 minutes' });
    await expect(bloc.locator('.minute-bar')).toHaveCount(6);
    await expect(bloc.locator('.minute-bar__col.against').first()).toBeVisible();
    await expect(page.locator('.versus__legend').first()).toContainText('encaisses');
  });
});
