import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Helper to reliably bring Jupyphant back to the front if the Debugger steals focus
async function ensureJupyphantActive(page: Page) {
  const jupyphantTab = page.getByRole('tab', { name: 'Jupyphant', exact: true });
  if (await jupyphantTab.getAttribute('aria-selected') !== 'true') {
    await jupyphantTab.click();
    await expect(jupyphantTab).toHaveAttribute('aria-selected', 'true');
  }
}

test.describe.serial('Jupyphant: Upload and Load .nix File', () => {
  // Global timeout
  test.setTimeout(120000);

  // NOTE: This test relies on the presence of a 'test.nix' file in the same directory as this test file

  test.beforeEach(async ({ page }, testInfo) => {
    await page.goto('http://localhost:8888/lab?reset');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached', timeout: 30000 });

    await page.evaluate(async () => {
        if (window.jupyterapp) {
          await window.jupyterapp.serviceManager.sessions.shutdownAll();
        }
    });

    // Calculate path to file
    const testFileDir = path.dirname(testInfo.file);
    const nixFilePath = path.join(testFileDir, 'test.nix');    
    
    // Break if file could not be found
    if (!fs.existsSync(nixFilePath)) {
      throw new Error(`CRITICAL: Cannot find test.nix at ${nixFilePath}`);
    }

    // Upload File
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload Files' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(nixFilePath);

    const overwriteButton = page.getByRole('button', { name: /Overwrite/i});

    try {
      await overwriteButton.waitFor({ state: 'visible', timeout: 4000 });
      await overwriteButton.click();
      await page.waitForTimeout(2000);
    } catch (e) {
      // Dialog didnt appear, proceeding without interruption
    }

    const uploadedFile = page.locator('.jp-DirListing-item', { hasText: 'test.nix' });
    await expect(uploadedFile).toBeVisible({ timeout: 15000 });

    // Open Notebook via top menu
    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.locator('.lm-Menu-itemLabel', { hasText: /^New$/ }).click();
    await page.locator('.lm-Menu-itemLabel', { hasText: /^Notebook$/ }).click();

    // Handle the Kernel selection dialog
    const selectBtn = page.getByRole('button', { name: 'Select' });
    try {
      await selectBtn.waitFor({ state: 'visible', timeout: 5000 });
      await selectBtn.click();
    } catch (e) { 
      // No kernel dialog appeared, proceeding naturally
    }
    await page.waitForSelector('.jp-Notebook-cell', { timeout: 20000 });

    // Step 1: Activate Jupyphant Sidebar
    await page.evaluate(async () => {
      const commands = window.jupyterapp.commands.listCommands();
      const cmdId = commands.find(id => id.toLowerCase().includes('jupyphant'));
      if (cmdId) await window.jupyterapp.commands.execute(cmdId);
    });

    const jupyphantTab = page.locator('.lm-TabBar-tab').filter({ hasText: 'Jupyphant' });
    if (await jupyphantTab.getAttribute('aria-selected') !== 'true') {
      await jupyphantTab.click();
    }
    await expect(jupyphantTab).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });

    // Step 2: Use Load Button & File Dialog
    await page.locator('button[title="Create a neoIO for given Path"]').click();
    const fileDialog = page.locator('.jp-Dialog', { hasText: 'Select' });
    await fileDialog.waitFor({ state: 'visible' });
    await fileDialog.locator('.jp-DirListing-item', { hasText: 'test.nix' }).dblclick();

    await fileDialog.waitFor({ state: 'hidden' });

    const ioDialog = page.locator('.jp-Dialog', { hasText: 'Enter neo IO class' });
    await ioDialog.waitFor({ state: 'visible' });
    
    // This button click closes the dialog immediately
    await ioDialog.locator('button', { hasText: 'Automatic' }).click();
    await ioDialog.waitFor({ state: 'hidden' });

    await expect(page.getByRole('button', { name: /Python 3.*Idle/})).toBeVisible({ timeout: 200000 });
    await ensureJupyphantActive(page);

    // Step 3: Ensure tree is populated before handing off to individual tests
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();
    await expect(async () => {
      await ensureJupyphantActive(page);
      await expect(treeNode).toBeVisible();
    }).toPass({ timeout: 30000 });
  });


  // --- TEST 1: Verify Tree ---
  test('should display TestBlock in the Neo Tree', async ({ page }) => {
    await ensureJupyphantActive(page);
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();    await expect(treeNode).toBeVisible();
    await expect(treeNode).toBeVisible();
    await treeNode.highlight();
  });

  // --- TEST 2: Insert into Notebook ---
  test('should insert selected Neo object into notebook and execute', async ({ page }) => {
    await ensureJupyphantActive(page);

    // 1. Select the "TestBlock" node in the tree
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();
    await treeNode.click(); 
    await ensureJupyphantActive(page);
    // 2. Click the Insert button
    const insertButton = page.locator('button[title="Insert selected neo objects into current notebook"]');
    await insertButton.click();

    // 3. Ensure the kernel is ready
    await expect(page.getByRole('button', { name: /Python 3.*Idle/ })).toBeVisible({ timeout: 20000 });

    // 4. Focus the notebook cell and run it
    const firstCell = page.locator('.jp-Notebook-cell').first();
    await firstCell.click(); // Ensure notebook has context focus
    
    // Execute the cell using Jupyter's internal command registry (our bulletproof method)
    await page.evaluate(async () => {
      await window.jupyterapp.commands.execute('notebook:run-cell-and-select-next');
    });

    // 5. Verify the cell output
    const outputArea = firstCell.locator('.jp-OutputArea-output');
    
    // assert substrings
    await expect(outputArea).toContainText('Block with', { timeout: 20000 });
    await expect(outputArea).toContainText("name: 'TestBlock'");
    await expect(outputArea).toContainText('segments');
  });

  // --- TEST 3: Verify Details Tab ---
  test('should display correct information in the Details tab for TestBlock', async ({ page }) => {
    await ensureJupyphantActive(page);

    // 1. Select the "TestBlock" node in the tree
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();
    await treeNode.click(); 

    // 2. Switch to the Details tab
    const detailsTab = page.locator('#jupyphant-right-panel').getByRole('tab', { name: 'Details', exact: true });
    await detailsTab.click();

    // 3. Verify the details text
    const rightPanel = page.locator('#jupyphant-right-panel');
    
    await expect(rightPanel).toContainText('Multiple Object Types Selected', { timeout: 10000 });
    
    // Assert the rest of the expected properties
    await expect(rightPanel).toContainText('Total Objects: 7');
    await expect(rightPanel).toContainText('Object Types:');
    await expect(rightPanel).toContainText('- SpikeTrain: 1');
    await expect(rightPanel).toContainText('- Segment: 1');
    await expect(rightPanel).toContainText('- ObjectList: 2');
    await expect(rightPanel).toContainText('- AnalogSignal: 1');
    await expect(rightPanel).toContainText('- Block: 1');
    await expect(rightPanel).toContainText('- SpikeTrainList: 1');
    await expect(rightPanel).toContainText('ObjectList Overview');
    await expect(rightPanel).toContainText('Count: 2');
  });

  test('should display correct information in the Details tab for SpikeTrain', async ({ page }) => { 
    await ensureJupyphantActive(page);

    // Theoretically for the current test.nix file not needed but with other example files
    const expandButton = page.locator('[title="Expand all containers"]');
    if (await expandButton.isVisible()) {
      await expandButton.click();
    }

    // 1. Select the "SpikeTrain" node in the tree
    const spikeTrainNode = page.locator('#jupyphant-right-panel')
                               .locator('[role="treeitem"]', { hasText: 'my spiketrain' })
                               .first();

    await spikeTrainNode.waitFor({ state: 'visible' });
    await spikeTrainNode.click();
    await expect(spikeTrainNode).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    // 2. Switch to the Explore tab
    const detailsPanel = page.getByRole('tabpanel', { name: 'Details' });

    await detailsPanel.click();
    
    await expect(detailsPanel).toContainText('Time Range: 0.0 s to 4.0 s', { timeout: 15000 });

    // Assert the rest of the properties instantly
    await expect(detailsPanel).toContainText('Annotations:');
    await expect(detailsPanel).toContainText('id: Unit 1');
    await expect(detailsPanel).toContainText('channel_id: 1');
    await expect(detailsPanel).toContainText('unit_id: 0');
    await expect(detailsPanel).toContainText('unit_tag: unclassified');
    
    // Check the table headers and values
    await expect(detailsPanel).toContainText('Index (3 spikes)');
    await expect(detailsPanel).toContainText('Time (in s, float64)');
    await expect(detailsPanel).toContainText('0                | 1.0000 s');
    await expect(detailsPanel).toContainText('1                | 2.0000 s');
    await expect(detailsPanel).toContainText('2                | 3.0000 s');

  });

  test('should render plots in the Explorer tab for TestBlock', async ({ page })=> {
    await ensureJupyphantActive(page);

    // 1. Select the "TestBlock" node in the tree
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();
    await treeNode.click();

    // 2. Switch to the Explore tab
    const exploreTab = page.locator('#jupyphant-right-panel').getByRole('tab', { name: 'Explore', exact: true });
    await exploreTab.click();

    const rightPanel = page.locator('#jupyphant-right-panel');

    // Because Jupyphant uses Plotly, we check for Plotly's signature container class to appear
    const plotContainer = rightPanel.locator('.js-plotly-plot, .plotly, svg, canvas').first();

    // Plots sometimes take a second to render, so we give them time
    await expect(plotContainer).toBeVisible({ timeout: 15000 });

    // This does not check for correct plots but whether any were generated at all
    const box = await plotContainer.boundingBox();
    expect(box?.height).toBeGreaterThan(50);
    expect(box?.width).toBeGreaterThan(50);
  });
});