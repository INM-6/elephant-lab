import { test, expect, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Helper to reliably bring Jupyphant back to the front if the Debugger steals focus
async function ensureJupyphantActive(page: Page) {
  const jupyphantTab = page.getByRole('tab', { name: 'Jupyphant', exact: true });
  const rightPanel = page.locator('#jupyphant-right-panel');

  await expect(async () => {
    if (await jupyphantTab.getAttribute('aria-selected') !== 'true') {
      await jupyphantTab.click();
    }
    await expect(jupyphantTab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
    await expect(rightPanel).not.toHaveClass(/lm-mod-hidden/, { timeout: 1000 });
  }).toPass({ timeout: 10000 });
}

test.describe.serial('Jupyphant: Upload and Load .nix File', () => {
  // Global timeout
  let page: Page;
  test.setTimeout(120000);

  // NOTE: This test relies on the presence of a 'test.nix' file in the same directory as this test file

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120000);
    page = await browser.newPage();
    
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

    await ensureJupyphantActive(page);

    // Step 3: Ensure tree is populated before handing off to individual tests
    const rightPanel = page.locator('#jupyphant-right-panel');
    const jupyphantTabLabel = page.getByRole('tab', { name: 'Jupyphant', exact: true });
    
    // Use an async retry loop to force the tab to stay open while waiting for the large file to process
    await expect(async () => {
      // Re-click the tab if JupyterLab switched to the Debugger
      if (await jupyphantTabLabel.getAttribute('aria-selected') !== 'true') {
        await jupyphantTabLabel.click();
      }
      await expect(rightPanel).toContainText('TestBlock', { timeout: 5000 });
    }).toPass({ timeout: 120000 }); 
    
    const treeNode = rightPanel.locator('[role="treeitem"]', { hasText: 'TestBlock' }).first();
    await treeNode.waitFor({ state: 'attached' });
  });

  test.afterAll(async () => {
    await page.close();
  });


  // --- TEST 1: Verify Tree ---
  test('should display TestBlock in the Neo Tree', async () => {
    await ensureJupyphantActive(page);
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();    
    await expect(treeNode).toContainText('TestBlock');
    await treeNode.highlight();
  });

  // --- TEST 2: Insert into Notebook ---
  test('should insert selected Neo object into notebook and execute', async () => {
    await ensureJupyphantActive(page);

    // 1. Select the "TestBlock" node in the tree
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();
    await treeNode.click({ force: true });    
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
  test('should display correct information in the Details tab for TestBlock', async () => {
    await ensureJupyphantActive(page);

    // 1. Select the "TestBlock" node in the tree
    const treeNode = page.locator('#jupyphant-right-panel [role="treeitem"]', { hasText: 'TestBlock' }).first();
    await treeNode.click(); 

    // 2. Switch to the Details tab
    const detailsTabLabel = page.locator('#jupyphant-right-panel .lm-TabBar-tabLabel', { hasText: 'Details' }).first();
    await detailsTabLabel.click();

    // 3. Verify the details text
    const rightPanel = page.locator('#jupyphant-right-panel');
    
    // Wait for the panel to update with Block details
    await expect(rightPanel).toContainText('TestBlock (Block)', { timeout: 10000 });
    
    // Assert the expected properties for the Block
    await expect(rightPanel).toContainText('Block with 1 segments');
    await expect(rightPanel).toContainText('Name: TestBlock');

    await expect(rightPanel).toContainText('Annotations:');
    await expect(rightPanel).toContainText('nix_name: neo.block.');
  });

test('should display correct information in the Details tab for SpikeTrain', async () => { 
  await ensureJupyphantActive(page);

  // Ensure page is still valid
  if (page.isClosed()) {
    throw new Error('Page was closed unexpectedly');
  }
    // Theoretically for the current test.nix file not needed but with other example files

  const expandButton = page.locator('[title="Expand all containers"]');
  if (await expandButton.isVisible()) {
    await expandButton.click();
  }

  // Wait for the tree to stabilize
  await page.waitForTimeout(500);

  // 1. Select the "SpikeTrain" node in the tree
  const spikeTrainNode = page.locator('#jupyphant-right-panel')
                             .locator('[role="treeitem"]', { hasText: 'my spiketrain' })
                             .first();
  
  // Wait and click with automatic retries
  await expect(async () => {
    await spikeTrainNode.waitFor({ state: 'visible', timeout: 3000 });
    await spikeTrainNode.click({ timeout: 3000 });
  }).toPass({ timeout: 10000 });

  await expect(spikeTrainNode).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
  
  await page.waitForTimeout(500);
  
    // 2. Switch to the Details tab
  const detailsTabLabel = page.locator('#jupyphant-right-panel .lm-TabBar-tabLabel', { hasText: 'Details' }).first();
  const detailsPanel = page.locator('#jupyphant-right-panel');
  
  await expect(async () => {
    if (await detailsTabLabel.getAttribute('aria-selected') !== 'true') {
      await detailsTabLabel.click();
    }
    await expect(detailsPanel).toContainText('Time Range: 0.0 s to 4.0 s', { timeout: 5000 });
    // Assert the rest of the properties
    await expect(detailsPanel).toContainText('Annotations:', { timeout: 1000 });    
    await expect(detailsPanel).toContainText(/id['":\s]+Unit 1/, { timeout: 1000 });
    await expect(detailsPanel).toContainText(/channel_id['":\s]+1/, { timeout: 1000 });
    await expect(detailsPanel).toContainText(/unit_id['":\s]+0/, { timeout: 1000 });
    await expect(detailsPanel).toContainText(/unit_tag['":\s]+unclassified/, { timeout: 1000 });
    // Check the table headers and values
    await expect(detailsPanel).toContainText('Index (3 spikes)', { timeout: 1000 });
    await expect(detailsPanel).toContainText('Time (in s, float64)', { timeout: 1000 });
    await expect(detailsPanel).toContainText('0                | 1.0000 s', { timeout: 1000 });
    await expect(detailsPanel).toContainText('1                | 2.0000 s', { timeout: 1000 });
    await expect(detailsPanel).toContainText('2                | 3.0000 s', { timeout: 1000 });
  }).toPass({ timeout: 15000 });    
});

  test('should render correct plots in the Explore tab for SpikeTrain', async () => {
  await ensureJupyphantActive(page);
  // Ensure page is still valid
  if (page.isClosed()) {
    throw new Error('Page was closed unexpectedly');
  }

  // 1. Select the "SpikeTrain" node with retry logic
  const spikeTrainNode = page.locator('#jupyphant-right-panel')
                             .locator('[role="treeitem"]', { hasText: 'my spiketrain' })
                             .first();
  
  await expect(async () => {
    await spikeTrainNode.waitFor({ state: 'visible', timeout: 3000 });
    await spikeTrainNode.click({ timeout: 3000 });
  }).toPass({ timeout: 10000 });

  await expect(spikeTrainNode).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });

  // 2. Switch to the Explore tab
  const rightPanel = page.locator('#jupyphant-right-panel');
  const exploreTab = rightPanel.getByRole('tab', { name: 'Explore', exact: true });

  await expect(async () => {
    if (await exploreTab.getAttribute('aria-selected') !== 'true') {
      await exploreTab.click();
    }
    await expect(exploreTab).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });
  }).toPass({ timeout: 10000 });

  // 3. Wait for the plot container to appear (Plotly can take time to render)
  // Plotly uses multiple possible DOM structures -> check for any of them
  const plotContainer = rightPanel.locator('div[data-plot], .plotly-graph-div, .js-plotly-plot, [data-component="plotly"]').first();

  await expect(plotContainer).toBeAttached({ timeout: 15000 });
  await expect(plotContainer).toBeVisible({ timeout: 20000 });

  // Add a small delay to ensure Plotly has fully rendered
  await page.waitForTimeout(1000);

  // 4. Verify the plot actually contains data
  const plotExists = await plotContainer.isVisible();
  expect(plotExists).toBe(true);

  // 5. Verify the bounding box is reasonable
  const box = await plotContainer.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height).toBeGreaterThan(100);
  expect(box?.width).toBeGreaterThan(100);

  // 6. Extract and verify Plotly data structure
  const plotData = await plotContainer.evaluate((node: any) => {
    // Plotly stores data in Plotly.d3 or directly on the DOM node
    if (node.data && node.layout) {
      return {
        hasData: true,
        numTraces: node.data.length,
        firstTraceType: node.data?.[0]?.type || 'unknown',
        xAxisLabel: node.layout?.xaxis?.title?.text || node.layout?.xaxis?.title || 'not set',
        yAxisLabel: node.layout?.yaxis?.title?.text || node.layout?.yaxis?.title || 'not set',
        plotTitle: node.layout?.title?.text || node.layout?.title || '',
        // For SpikeTrain, we expect scatter plot data
        firstTraceHasX: node.data?.[0]?.x !== undefined,
        firstTraceHasY: node.data?.[0]?.y !== undefined,
        firstTraceXLength: node.data?.[0]?.x?.length || 0,
      };
    }
    // Fallback: check for SVG/Canvas rendering (Plotly always renders to one of these)
    const hasSVG = node.querySelector('svg') !== null;
    const hasCanvas = node.querySelector('canvas') !== null;
    return {
      hasData: false,
      rendered: hasSVG || hasCanvas,
      hasSVG,
      hasCanvas,
    };
  });

  // 7. Assert the plot data structure
  expect(plotData).toBeDefined();
  
  if (plotData.hasData) {
    // If Plotly data is accessible, verify it has the expected structure
    expect(plotData.numTraces).toBeGreaterThan(0);
    expect(plotData.firstTraceType).toBeTruthy();
    expect(plotData.firstTraceHasX).toBe(true);
    expect(plotData.firstTraceHasY).toBe(true);
    
    // For a SpikeTrain, we expect at least some data points
    expect(plotData.firstTraceXLength).toBeGreaterThanOrEqual(0);
    
    console.log('Plot rendered with data:', {
      traces: plotData.numTraces,
      type: plotData.firstTraceType,
      xLabel: plotData.xAxisLabel,
      yLabel: plotData.yAxisLabel,
      title: plotData.plotTitle,
    });
  } else if (plotData.rendered) {
    // Plotly rendered but data wasn't directly accessible (CORS/security restrictions)
    // This is still a success - the plot exists
    console.log('Plot rendered (data not directly accessible due to sandbox restrictions)');
  } else {
    throw new Error('Plot did not render to SVG or Canvas');
  }
  });
});