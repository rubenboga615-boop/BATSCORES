import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || '4600';
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Les essais navigateur tournent contre la pile de test (faux fournisseur +
 * application) : aucun appel ne part vers le vrai API-Football, donc aucun
 * quota consomme et des resultats reproductibles.
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Fuseau et langue fixes : les libelles d'heure et de date sont testes.
    timezoneId: 'Europe/Paris',
    locale: 'fr-FR',
  },

  projects: [
    {
      name: 'bureau',
      use: {
        ...devices['Desktop Chrome'],
        // Echappatoire pour les machines disposant deja d'un Chromium systeme
        // (developpement hors ligne). Inutilise en integration continue.
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 5'],
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
  ],

  webServer: {
    command: 'node test/stack.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
