import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test('Jupyphant: Upload and Load .nix File', async ({ page }, testInfo) => {
  test.setTimeout(120000);

  // Setup: Open Notebook & Upload File
  await test.step('Setup: Upload File & Open Notebook', async () => {

    await page.goto('http://localhost:8888/lab?reset');
    await page.waitForSelector('#jupyterlab-splash', { state: 'detached', timeout: 30000 });

    // Calculate path to file
    const testFileDir = path.dirname(testInfo.file);
    const nixFilePath = path.join(testFileDir, 'test.nix');    
    
    // Break if file could not be found
    if (!fs.existsSync(nixFilePath)) {
      throw new Error(`CRITICAL: Cannot find test.nix at ${nixFilePath}`);
    }

    
    const fileChooserPromise = page.waitForEvent('filechooser');
    
    
    await page.getByRole('button', { name: 'Upload Files' }).click();
    
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(nixFilePath);

    // Wait for the file to appear in the JupyterLab file list
    const uploadedFile = page.locator('.jp-DirListing-item', { hasText: 'test.nix' });
    await expect(uploadedFile).toBeVisible({ timeout: 15000 });

    // Open Notebook via top menu
    console.log('Opening new notebook via File menu...');
    await page.getByRole('menuitem', { name: 'File' }).click();
    
    const newMenuItem = page.locator('.lm-Menu-itemLabel', { hasText: /^New$/ });
    await newMenuItem.click();
    
    const notebookMenuItem = page.locator('.lm-Menu-itemLabel', { hasText: /^Notebook$/ });
    await notebookMenuItem.click();

    // Handle the Kernel selection dialog
    const selectBtn = page.getByRole('button', { name: 'Select' });
    try {
      await selectBtn.waitFor({ state: 'visible', timeout: 5000 });
      await selectBtn.click();
    } catch (e) { 
      console.log('No kernel dialog appeared, proceeding...'); 
    }

    await page.waitForSelector('.jp-Notebook-cell', { timeout: 20000 });
  });

  // Step 1: Activate Jupyphant Sidebar
  await test.step('Step 1: Activate Sidebar', async () => {
    await page.evaluate(async () => {
      const commands = window.jupyterapp.commands.listCommands();
      const cmdId = commands.find(id => id.toLowerCase().includes('jupyphant'));
      if (cmdId) await window.jupyterapp.commands.execute(cmdId);
    });

    const jupyphantTab = page.getByRole('tab', { name: 'Jupyphant', exact: true });
    
    const isSelected = await jupyphantTab.getAttribute('aria-selected');
    if (isSelected !== 'true') {
      await jupyphantTab.click();
    }
    
    await expect(jupyphantTab).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  });

  // Step 2: Use Load Button & File Dialog
  await test.step('Step 2: Use Load Button & File Dialog', async () => {
    const loadButton = page.locator('button[title="Create a neoIO for given Path"]');
    await loadButton.click();

    const fileDialog = page.locator('.jp-Dialog', { hasText: 'Select' });
    await fileDialog.waitFor({ state: 'visible' });
    await fileDialog.locator('.jp-DirListing-item', { hasText: 'test.nix' }).dblclick();

    await fileDialog.waitFor({ state: 'hidden' })

    const ioDialog = page.locator('.jp-Dialog', { hasText: 'Enter neo IO class' });
    await ioDialog.waitFor({ state: 'visible' });
    
    // This button click closes the dialog immediately
    await ioDialog.locator('button', { hasText: 'Automatic' }).click();
    await ioDialog.waitFor({ state: 'hidden' });
  });

  // Step 3: Verify TestBlock in Tree
  await test.step('Step 3: Verify TestBlock in Tree', async () => {
    // Target the tab specifically in the sidebar tabbar
    const sidebarTab = page.locator('.lm-TabBar-tab').filter({ hasText: 'Jupyphant' });
    const neoTreePanel = page.locator('#jupyphant-right-panel');
    const treeNode = neoTreePanel.locator(':text-is("TestBlock")').first();

    await expect(async () => {
      // Force the sidebar tab to be active
      if (await sidebarTab.getAttribute('aria-selected') !== 'true') {
        await sidebarTab.click();
      }
      
      // Ensure the Jupyphant panel is actually visible
      await expect(neoTreePanel).toBeVisible();

      // Final assertion: the node must be visible
      await expect(treeNode).toBeVisible();
    }).toPass({ 
      timeout: 25000,
      intervals: [2000] // Give the UI 2 seconds between retries
    });

    await treeNode.highlight();
    console.log('Successfully found "TestBlock"!');
  });
});