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

    // 2. Create Data in Notebook
    const neoCode = `
from neo.core import Block, Segment, AnalogSignal, SpikeTrain
import quantities as pq
test_block = Block(name="TestBlock")
test_block.segments.append(Segment(name="my segment"))
test_block.segments[0].analogsignals.append(AnalogSignal([1,2,3], name="my analogsignal", t_stop=4, units='s', sampling_rate=1*pq.Hz, id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified'))
test_block.segments[0].spiketrains.append(SpikeTrain([1,2,3], name="my spiketrain", t_stop=4, units='s', id='Unit 1', channel_id=1, unit_id=0, unit_tag='unclassified'))
print("Created:", test_block.name)
    `.trim();

    await page.evaluate((code) => {
      const widgets = Array.from(window.jupyterapp.shell.widgets('main'));
      const notebookWidget = widgets.find((w: any) => w.sessionContext && w.model && w.model.cells);
      if (notebookWidget && notebookWidget.model.cells.get(0).sharedModel) {
        notebookWidget.model.cells.get(0).sharedModel.setSource(code);
      }
    }, neoCode);

    const firstCell = page.locator('.jp-Notebook-cell').first();
    await firstCell.click();
    await page.getByRole('button', { name: 'Run this cell and advance (Shift+Enter)' }).click();    
    await expect(firstCell.locator('.jp-OutputArea-output')).toContainText('Created: TestBlock', { timeout: 20000 });

    // 3. Activate Jupyphant Sidebar
    await page.evaluate(async () => {
      const commands = window.jupyterapp.commands.listCommands();
      const cmdId = commands.find(id => id.toLowerCase().includes('jupyphant'));
      if (cmdId) await window.jupyterapp.commands.execute(cmdId);
    });

    await ensureJupyphantActive(page);

    // 4. Ensure tree is populated before handing off to the tests
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
  test('should hide and show node when Block filter is toggled', async ({ page }) => {
    const blockFilterLabel = page.locator('label[title="Hide/Show Block(s)"]');
    const treeNode = page.getByRole('tree').getByRole('treeitem').filter({ hasText: 'TestBlock' });

    // 1. Toggle OFF
    await blockFilterLabel.click();
    await expect(blockFilterLabel).toHaveAttribute('data-checked', 'false');
    await expect(blockFilterLabel).toHaveClass(/unchecked-label/);

    await ensureJupyphantActive(page);
    await expect(treeNode).toBeHidden({ timeout: 10000 });
    await page.screenshot({ path: './outputs/tree-filter-hidden.png' });

    // 2. Toggle ON
    await ensureJupyphantActive(page);
    await blockFilterLabel.click();
    
    await expect(treeNode).toBeVisible({ timeout: 10000 });
  });

});