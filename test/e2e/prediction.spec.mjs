import { test, expect } from '@playwright/test';

test.describe('onglet Pronostic', () => {
  test('affiche les deux sources et ce sur quoi le modèle s\'appuie', async ({ page }) => {
    // 1005 : match à venir dans le championnat collecté — le seul cas où les
    // deux sources peuvent répondre ensemble.
    await page.goto('/#/match/1005');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="prediction"]');
    await page.waitForSelector('.chip');

    const modele = page.locator('.card').filter({ hasText: 'Notre modele' });
    await expect(modele).toContainText('buts attendus');
    await expect(modele).toContainText('Les deux equipes marquent');
    await expect(modele).toContainText('Confiance');

    // La transparence est le point : le modèle doit dire d'où il tire sa réponse.
    const appuis = page.locator('.card').filter({ hasText: "Sur quoi il s'appuie" });
    await expect(appuis).toContainText('Rencontres analysees');
    await expect(appuis).toContainText('Attaque · Paris Saint Germain');

    await expect(page.locator('.card').filter({ hasText: 'fournisseur' })).toContainText('62%');
    await expect(page.locator('.chip')).toHaveCount(5);
  });

  test('sans données collectées, il le dit au lieu d\'inventer', async ({ page }) => {
    // 1003 : championnat espagnol, jamais collecté ici.
    await page.goto('/#/match/1003');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="prediction"]');

    // Le pronostic du fournisseur reste disponible, mais le modèle s'abstient
    // et explique pourquoi — c'est préférable à une réponse fabriquée.
    await expect(page.locator('.card').filter({ hasText: 'fournisseur' })).toBeVisible();
    await expect(page.locator('.card').filter({ hasText: 'Notre modele' })).toHaveCount(0);
    await expect(page.locator('#match-panel')).toContainText('Trop peu de rencontres collectees');
  });

  test('les probabilités affichées totalisent 100 %', async ({ page }) => {
    await page.goto('/#/match/1005');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="prediction"]');
    await page.waitForSelector('.chip');

    const texte = await page.locator('.card').filter({ hasText: 'Notre modele' }).innerText();
    const pourcentages = [...texte.matchAll(/(\d+(?:\.\d+)?)\s%/g)].map((m) => Number(m[1]));
    const [home, away, draw] = pourcentages;
    expect(Math.abs(home + away + draw - 100)).toBeLessThan(0.6);
  });
});
