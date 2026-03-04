import { test, expect, Page } from '@playwright/test';

// Define JupyterLab window types
declare global {
  interface Window {
    jupyterapp: {
      commands: {
        execute: (command: string, args?: any) => Promise<any>;
        listCommands: () => string[];
      };
      shell: {
        widgets: (area: string) => IterableIterator<any>;
        activateById: (id: string) => void;
      };
    };
  }
}

// Helper to reliably bring Jupyphant back to the front if the Debugger steals focus
async function ensureJupyphantActive(page: Page) {
  const jupyphantTab = page.getByRole('tab', { name: 'Jupyphant', exact: true });
  if (await jupyphantTab.getAttribute('aria-selected') !== 'true') {
    await jupyphantTab.click();
    await expect(jupyphantTab).toHaveAttribute('aria-selected', 'true');
  }
}

test.describe('Jupyphant: Neo Tree Interactions', () => {
  // Global timeout for the suite
  test.setTimeout(120000);

  // --- SETUP: Runs BEFORE every test ---
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8888/lab?reset');
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
test_block.segments.append(Segment(name="my segment"))
test_block.segments[0].analogsignals.append(
    AnalogSignal([1, 2, 3], name="my analogsignal", t_stop=4, units='s', 
                 sampling_rate=1*pq.Hz, id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].spiketrains.append(
    SpikeTrain([1, 2, 3], name="my spiketrain", t_stop=4, units='s', 
               id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].epochs.append(
    Epoch(times=[0, 1, 2]*pq.s, durations=[0.5, 0.5, 0.5]*pq.s, labels=['a', 'b', 'c'], 
          name="my epoch", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].events.append(
    Event(times=[0.5, 1.5, 2.5]*pq.s, labels=['x', 'y', 'z'], 
          name="my event", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].irregularlysampledsignals.append(
    IrregularlySampledSignal(signal=[1.1, 2.2, 3.3], times=[0, 1, 2]*pq.s, units='V', 
                             name="my irregularsignal", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

test_block.segments[0].imagesequences.append(
    ImageSequence(image_data=np.empty((3, 10, 10)), sampling_rate=1*pq.Hz, units='V', spatial_scale=1*pq.um, 
                  name="my imagesequence", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
)

my_group = Group(name="my group", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')
test_block.groups.append(my_group)

my_channelview = ChannelView(test_block.segments[0].analogsignals[0], index=[0], 
                             name="my channelview", id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified')

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

    // 5. Activate Jupyphant Sidebar
    await page.evaluate(async () => {
      const commands = window.jupyterapp.commands.listCommands();
      const cmdId = commands.find(id => id.toLowerCase().includes('jupyphant'));
      if (cmdId) await window.jupyterapp.commands.execute(cmdId);
    });

    await ensureJupyphantActive(page);

    // 6. Ensure tree is populated before handing off to the tests
    const treeWidget = page.getByRole('tree');
    await treeWidget.waitFor({ state: 'visible', timeout: 10000 });
    const treeNode = treeWidget.getByRole('treeitem').filter({ hasText: 'TestBlock' });
    await expect(treeNode).toBeVisible({ timeout: 10000 });
  });

  // --- TEST 1: Deletion ---
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
    await ensureJupyphantActive(page);
    const treeNode = page.getByRole('tree').getByRole('treeitem').filter({ hasText: 'TestBlock' });
    await expect(treeNode).toBeHidden({ timeout: 15000 });
    
    await page.screenshot({ path: './outputs/tree-verification-deleted.png' });
  });

  // --- TEST 2: Filtering ---
  test('should hide and show node when filter is toggled', async ({ page }) => {

    const neoFilters = [
        { name: 'Block', testNode: 'TestBlock' },
        { name: 'Segment', testNode: 'my segment' },
        { name: 'Spiketrain', testNode: 'my spiketrain' },
        { name: 'Analogsignal', testNode: 'my analogsignal' },
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

    await ensureJupyphantActive(page);

    for (const filter of neoFilters) {
        await test.step(`Toggle ${filter.name} filter`, async () => {
            
            await ensureJupyphantActive(page);
            const filterLabel = page.locator(`label[title="Hide/Show ${filter.name}(s)"]`);
            await filterLabel.click();
            await expect(filterLabel).toHaveAttribute('data-checked', 'false');
            await expect(filterLabel).toHaveClass(/unchecked-label/);

            if (filter.testNode) {
                const treeNode = page.getByRole('tree').getByRole('treeitem').filter({ hasText: filter.testNode });
                await expect(treeNode).toBeHidden({ timeout: 10000 });

            }
            // Toggle back ON for next tests
            await filterLabel.click();
            await expect(filterLabel).toHaveAttribute('data-checked', 'true');
            
            if (filter.testNode) {
                const treeNode = page.getByRole('tree').getByRole('treeitem').filter({ hasText: filter.testNode });
                await expect(treeNode).toBeVisible({ timeout: 10000 });
            }
        });
    }


    await page.screenshot({ path: './outputs/tree-filter-hidden.png' });

  });

});