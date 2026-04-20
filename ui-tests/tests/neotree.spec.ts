import { expect, test, Page } from '@playwright/test';

async function ensureElephantLabActive(page: Page) {
  const elephantLabTab = page.getByRole('tab', { name: 'Elephant Lab', exact: true });
  const rightPanel = page.locator('#elephant-lab-right-panel');

  await expect(async () => {
    if (await elephantLabTab.getAttribute('aria-selected') !== 'true') {
      await elephantLabTab.click();
    }
    await expect(elephantLabTab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
    await expect(rightPanel).not.toHaveClass(/lm-mod-hidden/, { timeout: 1000 });

  }).toPass({ timeout: 10000 });
}

test.describe('Elephant Lab: Additional Neo Tree & Data Tests', () => {
  test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
      await page.goto('http://127.0.0.1:8888/lab?reset');
      await page.waitForSelector('#jupyterlab-splash', { state: 'detached', timeout: 30000 });
  
      // 1. Open Notebook
      await page.locator('.jp-LauncherCard[data-category="Notebook"] >> text=Python 3').click();
      const selectBtn = page.locator('button:has-text("Select")');
      if (await selectBtn.isVisible({ timeout: 5000 })) {
        await selectBtn.click();
      }
      await page.waitForSelector('.jp-Notebook-cell', { timeout: 10000 });
  
    // 2. Wait a bit for kernel to fully initialize
    await page.waitForTimeout(1000);
  
    // 3. Create Data in Notebook
      const neoCode = `
from neo.core import (
    Block, Segment, AnalogSignal, SpikeTrain, Epoch, Event,
    IrregularlySampledSignal, ImageSequence, ChannelView, Group,
    CircularRegionOfInterest, PolygonRegionOfInterest, RectangularRegionOfInterest
)
import quantities as pq
import numpy as np

test_block = Block(name="TestBlock")
test_block.segments.append(Segment(name="my_segment"))
test_block.segments[0].analogsignals.append(
    AnalogSignal([1, 2, 3], name="my_analogsignal", t_stop=4, units='s', 
                 sampling_rate=1*pq.Hz, id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].spiketrains.append(
    SpikeTrain([1, 2, 3], name="my_spiketrain", t_stop=4, units='s', 
               id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].spiketrains.append(
    SpikeTrain([1, 2, 3, 4], name="my_spiketrain2", t_stop=4, units='s', 
               id='Unit 2', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].epochs.append(
    Epoch(times=[0, 1, 2]*pq.s, durations=[0.5, 0.5, 0.5]*pq.s, labels=['a', 'b', 'c'], 
          name="my_epoch", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].events.append(
    Event(times=[0.5, 1.5, 2.5]*pq.s, labels=['x', 'y', 'z'], 
          name="my_event", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].irregularlysampledsignals.append(
    IrregularlySampledSignal(signal=[1.1, 2.2, 3.3], times=[0, 1, 2]*pq.s, units='V', 
                             name="my_irregularsignal", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

img_sequence_array = [[[column for column in range(20)]for row in range(20)]
                        for frame in range(10)]

test_block.segments[0].imagesequences.append(
    ImageSequence(img_sequence_array, units='V',
                               sampling_rate=1 * pq.Hz,
                               spatial_scale=1 * pq.micrometer,
                               name="my_imagesequence")
)

my_group = Group(name="my_group", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
test_block.groups.append(my_group)

my_channelview = ChannelView(test_block.segments[0].analogsignals[0], index=[0], 
                             name="my_channelview", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')

my_imageseq = test_block.segments[0].imagesequences[0]

print("Created:", test_block.name)
      `.trim();
  
      await page.evaluate((code) => {
        const widgets = Array.from(window.jupyterapp.shell.widgets('main'));
        const notebookWidget = widgets.find((w: any) => w.sessionContext && w.model && w.model.cells);
        if (notebookWidget && notebookWidget.model.cells.get(0).sharedModel) {
          notebookWidget.model.cells.get(0).sharedModel.setSource(code);
        }
      }, neoCode);
  
      // 4. Execute cell and wait for output
      const firstCell = page.locator('.jp-Notebook-cell').first();
      await firstCell.click();
      
      // Use Jupyter's internal execution method for reliability
      await page.evaluate(async () => {
        await window.jupyterapp.commands.execute('notebook:run-cell-and-select-next');
      });
  
      // Wait for output area to appear AND contain the expected text
      // This handles async execution properly
      await expect(async () => {
        const outputArea = firstCell.locator('.jp-OutputArea-child').first();
        await expect(outputArea).toBeVisible({ timeout: 2000 });
        await expect(outputArea).toContainText('Created: TestBlock', { timeout: 2000 });
      }).toPass({ timeout: 30000 });
  
      // 5. Activate Elephant Lab Sidebar
      await page.evaluate(async () => {
        const commands = window.jupyterapp.commands.listCommands();
        const cmdId = commands.find(id => id.toLowerCase().includes('elephant-lab'));
        if (cmdId) await window.jupyterapp.commands.execute(cmdId);
      });
  
      await ensureElephantLabActive(page);
  
      // 6. Ensure tree is populated before handing off to the tests
      const treeWidget = page.getByRole('tree');
      await treeWidget.waitFor({ state: 'visible', timeout: 10000 });
      const treeNode = treeWidget.getByRole('treeitem').filter({ hasText: 'TestBlock' });
      await expect(treeNode).toBeVisible({ timeout: 10000 });
    });


  // --- TEST: Select multiple nodes and check Overview ---
  test('should display multi-selection SpikeTrain Overview in the Details tab', async ({ page }) => {
  await ensureElephantLabActive(page);

  // Expand all nodes to ensure the spiketrains are visible
  const expandButton = page.locator('[title="Expand all containers"]');
  if (await expandButton.isVisible()) {
    await expandButton.click();
    await page.waitForTimeout(500);
  }

  const rightPanel = page.locator('#elephant-lab-right-panel');
  const treeContainer = rightPanel.locator('div[role="tree"]');
  
  // match items with text "my_spiketrain" to get both spiketrains
  const spiketrainAnchors = treeContainer.locator('a.jstree-anchor').filter({ hasText: /my_spiketrain/ });
  
  const anchor1 = spiketrainAnchors.nth(0);  // my_spiketrain
  const anchor2 = spiketrainAnchors.nth(1);  // my_spiketrain2
  
  await expect(anchor1).toBeAttached({ timeout: 5000 });
  await expect(anchor2).toBeAttached({ timeout: 5000 });
  
  // Verify we got the right elements
  const text1 = await anchor1.textContent();
  const text2 = await anchor2.textContent();
  expect(text1).toMatch(/my_spiketrain/);
  expect(text2).toMatch(/my_spiketrain2/);

  // Select first node
  await anchor1.scrollIntoViewIfNeeded();
  await anchor1.click();
  await page.waitForTimeout(300);
  
  // Switch to Details tab
  const detailsTabLabel = page.locator('#elephant-lab-right-panel .lm-TabBar-tabLabel', { hasText: 'Details' }).first();
  const tabpanel = page.locator('#elephant-lab-right-panel');

  if (await detailsTabLabel.getAttribute('aria-selected') !== 'true') {
      await detailsTabLabel.click();
  }

  await page.waitForTimeout(500);
  
  // Verify single selection details appear
  await expect(tabpanel).toContainText(/Time Range/i, { timeout: 10000 });
  
  // Control+Click the second anchor to add to selection
  await anchor2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await anchor2.click({ modifiers: ['Control'] });
  await page.waitForTimeout(500);
  
  // After multi-select, Details should show the SpikeTrain Overview
  await expect(tabpanel).toContainText(/Overview/i, { timeout: 10000 });
  
  // This is again specific to our test data 
  // Verify aggregated data (3 spikes + 4 spikes = 7 total)
  await expect(tabpanel).toContainText(/Count.*2/i, { timeout: 5000 });
  await expect(tabpanel).toContainText(/Total.*Spikes.*7|7.*spike/i, { timeout: 5000 });
  await expect(tabpanel).toContainText(/Units/, { timeout: 5000 });  
  });

  // --- TEST: Performance with "large" dataset ---
  test('should handle large number of nodes efficiently', async ({ page }) => {
    // Create more data in notebook
    const bulkCode = `
for i in range(10):
    test_block.segments[0].epochs.append(
        Epoch(times=[0, 1]*pq.s, durations=[0.5, 0.5]*pq.s, labels=['x', 'y'],
              name=f"epoch_{i}", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
    )
print("Created 10 epochs")
    `.trim();

    await page.evaluate((code) => {
      const widgets = Array.from(window.jupyterapp.shell.widgets('main'));
      const notebookWidget = widgets.find((w: any) => w.sessionContext && w.model && w.model.cells);
      const cells = notebookWidget.model.cells;
      const lastIdx = cells.length - 1;
      cells.get(lastIdx).sharedModel.setSource(code);
    }, bulkCode);

    const lastCell = page.locator('.jp-Notebook-cell').last();
    await lastCell.click();
    await page.evaluate(async () => {
      await window.jupyterapp.commands.execute('notebook:run-cell-and-select-next');
    });

    // Expand tree to show more than 10 items at once
    const expandButton = page.locator('[title="Expand all containers"]');
    if (await expandButton.isVisible()) {
        await expandButton.click();
    }

    // Execute and measure tree update performance
    const startTime = Date.now();
    
    await ensureElephantLabActive(page);
    const treeWidget = page.getByRole('tree');
    const epochNodes = treeWidget.getByRole('treeitem').filter({ hasText: /epoch_\d+/ });
    
    // Should load all nodes within reasonable time
    await expect(epochNodes.first()).toBeVisible({ timeout: 10000 });
    
    const duration = Date.now() - startTime;
    console.log(`Tree loaded with bulk data in ${duration}ms`);
    expect(duration).toBeLessThan(15000);
  });

  // --- TEST: Refresh tree when data changes ---
  test('should update tree when notebook variables are modified', async ({ page }) => {
    await ensureElephantLabActive(page);
    
    const treeWidget = page.getByRole('tree');
    let blockNode = treeWidget.getByRole('treeitem').filter({ hasText: 'TestBlock' });
    
    // Modify block name in notebook
    const modifyCode = `test_block.name = "TestBlockModified"\nprint("Modified")`;
    
    await page.evaluate((code) => {
      const widgets = Array.from(window.jupyterapp.shell.widgets('main'));
      const notebookWidget = widgets.find((w: any) => w.sessionContext && w.model && w.model.cells);
      const cells = notebookWidget.model.cells;
      const lastIdx = cells.length - 1;
      cells.get(lastIdx).sharedModel.setSource(code);
    }, modifyCode);

    const lastCell = page.locator('.jp-Notebook-cell').last();
    await lastCell.click();
    await page.evaluate(async () => {
      await window.jupyterapp.commands.execute('notebook:run-cell-and-select-next');
    });

    await page.waitForTimeout(1000); // Wait for tree update
    
    // Tree should now show modified name
    blockNode = treeWidget.getByRole('treeitem').filter({ hasText: 'TestBlockModified' });
    await expect(blockNode).toBeVisible({ timeout: 10000 });
  });
  
    // --- TEST: Deletion ---
  test('should remove node from tree when deleted in Notebook', async ({ page }) => {
    // 1. Insert Deletion Code into the next empty cell 
    const delCode = `del test_block\nprint("Deleted: TestBlock")`;

    await page.evaluate((code) => {
      const widgets = Array.from(window.jupyterapp.shell.widgets('main'));
      const notebookWidget = widgets.find((w: any) => w.sessionContext && w.model && w.model.cells);
      const cells = notebookWidget.model.cells;
      cells.get(cells.length - 1).sharedModel.setSource(code);
    }, delCode);

    const lastCell = page.locator('.jp-Notebook-cell').nth(1);
    await lastCell.click();
    await page.getByRole('button', { name: 'Run this cell and advance (Shift+Enter)' }).click();
    await expect(lastCell.locator('.jp-OutputArea-output')).toContainText('Deleted: TestBlock', { timeout: 20000 });

    // 2. Verify Deletion in Sidebar
    await ensureElephantLabActive(page);
    const treeNode = page.getByRole('tree').getByRole('treeitem').filter({ hasText: 'TestBlock' });
    await expect(treeNode).toBeHidden({ timeout: 15000 });
    
    await page.screenshot({ path: './outputs/tree-verification-deleted.png' });
  });

  // --- TEST: Filtering ---
  test('should hide and show node when filter is toggled', async ({ page }) => {

    const neoFilters = [
        { name: 'Block', testNode: 'TestBlock' },
        { name: 'Segment', testNode: 'my_segment' },
        { name: 'Spiketrain', testNode: 'my_spiketrain' },
        { name: 'Analogsignal', testNode: 'my_analogsignal' },
        { name: 'Epoch' },
        { name: 'Channelview' },
        { name: 'Group' },
        { name: 'Irregularlysampledsignal' },
        { name: 'Event' },
        { name: 'Imagesequence' },
        { name: 'Circularregionofinterest' },
        { name: 'Polygonregionofinterest' },
        { name: 'Rectangularregionofinterest' }
    ]

    await ensureElephantLabActive(page);

    for (const filter of neoFilters) {
        await test.step(`Toggle ${filter.name} filter`, async () => {
            
            await ensureElephantLabActive(page);
            const filterLabel = page.locator(`label[title="Hide/Show ${filter.name}(s)"]`);
            await filterLabel.click();
            await expect(filterLabel).toHaveAttribute('data-checked', 'false');
            await expect(filterLabel).toHaveClass(/unchecked-label/);

            if (filter.testNode) {
                const treeNode = page.getByRole('tree').getByRole('treeitem').filter({ hasText: filter.testNode }).first();
                await expect(treeNode).toBeHidden({ timeout: 10000 });

            }
            // Toggle back ON for next tests
            await filterLabel.click();
            await expect(filterLabel).toHaveAttribute('data-checked', 'true');
            
            if (filter.testNode) {
                const treeNode = page.getByRole('tree').getByRole('treeitem').filter({ hasText: filter.testNode }).first();
                await expect(treeNode).toBeVisible({ timeout: 10000 });
            }
        });
    }


    await page.screenshot({ path: './outputs/tree-filter-hidden.png' });

  });
});