/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');
const { devices } = require('@playwright/test');

module.exports = {
  ...baseConfig,
  
  workers: 1, 
  fullyParallel: false, 

  use: {
    ...baseConfig.use,
    video: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {  
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    }
  ],
  
  webServer: {
    command: 'jlpm start',
    url: 'http://localhost:8888/lab',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
    cwd: __dirname,
    stdout: 'pipe',
    stderr: 'pipe',
    
    env: {
      JUPYTER_TOKEN: '',
      JUPYTER_PASSWORD: ''
    }
  }
};