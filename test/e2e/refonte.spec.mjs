import { test, expect } from '@playwright/test';

/**
 * Les écrans que la refonte apporte : cotes comparées, alertes par type,
 * terrain en direct, confrontations enrichies, fil par équipe.
 *
 * Ce sont des chemins neufs : sans essai, rien ne dirait qu'ils fonctionnent
 * avant qu'un utilisateur ne les ouvre.
 */

test.describe('cotes comparées', () => {
  test('sans rencontre choisie, la page propose les matchs à venir', async ({ page }) => {
    await page.goto('/#/cotes');
    await page.waitForSelector('.page-head__title');
    await expect(page.locator('.page-head__title')).toContainText('Cotes comparees');
    // Seules les rencontres non commencées ont des cotes publiées.
    await expect(page.locator('.list-row').first()).toBeVisible();
  });

  test('une rencontre montre probabilités, dérive et écart au modèle', async ({ page }) => {
    await page.goto('/#/cotes?match=1005');
    await page.waitForSelector('.odd:not(.odd--head)');

    await expect(page.locator('.page-head__title')).toContainText('nettes de marge');

    const lignes = page.locator('.odd:not(.odd--head)');
    expect(await lignes.count()).toBeGreaterThanOrEqual(3);

    // Les probabilités affichées sont dégonflées de la marge : elles totalisent 100 %.
    const texte = await page.locator('#odds-body').innerText();
    const parts = [...texte.matchAll(/(\d+(?:\.\d+)?) %/g)].map((m) => Number(m[1]));
    const total = parts.slice(0, 3).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 100)).toBeLessThan(1);

    await expect(page.locator('.note').first()).toContainText('marge du bookmaker');
  });
});

test.describe('alertes par type', () => {
  test('la grille couvre chaque type et chaque portée', async ({ page }) => {
    await page.goto('/#/alertes');
    await page.waitForSelector('.notif-matrix');

    // Dix types d'événement, trois portées chacun.
    await expect(page.locator('.notif-matrix__row')).toHaveCount(10);
    await expect(page.locator('.notif-matrix__row').first().locator('.tick')).toHaveCount(3);

    // Le réglage par défaut est celui que l'ancienne version envoyait déjà.
    const but = page.locator('.notif-matrix__row').filter({ hasText: 'But' }).first();
    await expect(but.locator('.tick.is-on')).toHaveCount(1);
  });

  test('un clic change la portée, un second l\'éteint', async ({ page }) => {
    await page.goto('/#/alertes');
    await page.waitForSelector('.notif-matrix');

    const ligne = page.locator('.notif-matrix__row').filter({ hasText: 'Carton rouge' }).first();
    const equipes = ligne.locator('.tick').first();

    await expect(equipes).toHaveAttribute('aria-pressed', 'false');
    await equipes.click();
    await expect(ligne.locator('.tick').first()).toHaveAttribute('aria-pressed', 'true');

    // Recliquer la case déjà cochée éteint le type : sans cela, impossible de
    // revenir en arrière sans un quatrième bouton.
    await ligne.locator('.tick').first().click();
    await expect(ligne.locator('.tick').first()).toHaveAttribute('aria-pressed', 'false');
  });

  test('« tout désactiver » vide la grille', async ({ page }) => {
    await page.goto('/#/alertes');
    await page.waitForSelector('.notif-matrix');
    expect(await page.locator('.tick.is-on').count()).toBeGreaterThan(0);

    await page.click('[data-alert-clear]');
    await expect(page.locator('.tick.is-on')).toHaveCount(0);
  });

  test('sans abonnement, la page le dit au lieu de promettre', async ({ page }) => {
    await page.goto('/#/alertes');
    await page.waitForSelector('.notif-matrix');
    // Les clés VAPID ne sont pas configurées dans la pile de test.
    await expect(page.locator('.note').first()).toContainText('notifications');
  });
});

test.describe('terrain en direct', () => {
  test('place le dernier fait et explique ce que le schéma montre', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="pitch"]');
    await page.waitForSelector('.pitch-live');

    await expect(page.locator('.pitch-live__ball')).toHaveCount(1);
    await expect(page.locator('.ticker').first()).toBeVisible();

    // La limite est annoncée, pas masquée : le fournisseur ne donne aucune
    // coordonnée, le schéma déduit la zone du type de fait.
    await expect(page.locator('.pitch-live__legend')).toContainText('pas un releve de position');
  });

  test('une rencontre non commencée n\'offre pas l\'onglet', async ({ page }) => {
    await page.goto('/#/match/1003');
    await page.waitForSelector('.mh');
    await expect(page.locator('[data-tab="pitch"]')).toHaveCount(0);
  });
});

test.describe('confrontations enrichies', () => {
  test('chiffre le bilan et les seuils que le score suffit à trancher', async ({ page }) => {
    await page.goto('/#/match/1001');
    await page.waitForSelector('.mh');
    await page.click('[data-tab="h2h"]');
    await page.waitForSelector('.totals');

    await expect(page.locator('.totals__cell')).toHaveCount(4);
    await expect(page.locator('.totals').first()).toContainText('Buts par match');

    const seuils = page.locator('.threshold');
    expect(await seuils.count()).toBeGreaterThan(0);
    await expect(seuils.first().locator('.threshold__pct')).toContainText('%');

    // Corners et cartons manquent à la réponse : l'écran le dit plutôt que
    // d'afficher un seuil inventé.
    await expect(page.locator('.note').last()).toContainText('Corners et cartons');
  });
});

test.describe('fil par équipe', () => {
  test('assemble résultats, prochain match et indisponibles', async ({ page }) => {
    await page.goto('/#/equipe/85');
    await page.waitForSelector('.feed');

    const entrees = page.locator('.feed');
    expect(await entrees.count()).toBeGreaterThan(0);

    // Le rail de droite porte le prochain match et l'infirmerie.
    await expect(page.locator('.section-title').filter({ hasText: 'Prochain match' })).toBeVisible();
    await expect(page.locator('.section-title').filter({ hasText: 'Indisponibles' })).toBeVisible();
  });

  test('le club peut être suivi depuis sa fiche', async ({ page }) => {
    await page.goto('/#/equipe/85');
    await page.waitForSelector('[data-team-star]');

    const bouton = page.locator('[data-team-star]');
    await expect(bouton).toContainText('Suivre cette equipe');
    await bouton.click();
    await expect(bouton).toContainText('Equipe suivie');

    // Le club suivi apparaît dans les favoris.
    await page.goto('/#/favoris');
    await expect(page.locator('#fav-teams .list-row').first()).toContainText('Paris Saint Germain');
  });
});

test.describe('recherche', () => {
  test('trois colonnes, dont les joueurs', async ({ page }) => {
    await page.goto('/#/recherche?q=dembele');
    await page.waitForSelector('.cols3');

    await expect(page.locator('.section-title').filter({ hasText: 'Joueurs' })).toBeVisible();
    await expect(page.locator('[data-player-link]').first()).toContainText('Dembele');
    await expect(page.locator('.search-big__count')).toContainText('resultat');
  });
});
