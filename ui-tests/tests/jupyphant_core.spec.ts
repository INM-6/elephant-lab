import { test, expect } from '@playwright/test';

test.describe('Elephant Lab: Core Initialization & API', () => {

  // TEST 1: Check Activation Message
  test('should emit an activation console message on load', async ({ page, baseURL }) => {
    // Attach the listener BEFORE navigating
    const activationMessagePromise = page.waitForEvent('console', {
      predicate: msg => msg.text().includes('Elephant Lab is activated'), 
      timeout: 15000
    });

    // Navigate to JupyterLab to trigger the load
    await page.goto(baseURL || 'http://localhost:8888/lab?reset');

    // Await the listener resolving
    const msg = await activationMessagePromise;
    expect(msg.text()).toContain('Elephant Lab is activated');
  });


  // TEST 2: Execute API Command
  test('should execute Elephant Lab directly via API', async ({ page, baseURL }) => {
    // Navigate again for a fresh state
    await page.goto(baseURL || 'http://localhost:8888/lab?reset');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached', timeout: 30000 });

    const pythonKernelTile = page.locator('.jp-LauncherCard[data-category="Notebook"] >> text=Python 3');
    await pythonKernelTile.click();

    // Handle Kernel dialog
    const selectButton = page.locator('button:has-text("Select")');
    if (await selectButton.isVisible({ timeout: 5000 })) {
      await selectButton.click();
    }

    await page.waitForSelector('.jp-Notebook-cell');
    await page.waitForTimeout(2000);

    console.log('Executing Elephant Lab command via internal API...');
    const result = await page.evaluate(async () => {
      // Access JupyterLab's internal API
      const commands = window.jupyterapp.commands.listCommands();
      const cmdId = commands.find(id => id.toLowerCase().includes('elephant-lab'));

      if (cmdId) {
        await window.jupyterapp.commands.execute(cmdId);
        return `Executed command: ${cmdId}`;
      } else {
        throw new Error(`Elephant Lab command not found! Available commands: ${commands.filter(c => !c.startsWith('jlab')).join(', ')}`);
      }
    });

    console.log(result);
    
    expect(result).toContain('Executed command');
    
    await page.screenshot({ path: './outputs/elephant-lab-api-execution.png' });
  });

});