import { WorkflowEngineWidget } from "./workflow_engine";
import { ElephantLabNode } from "./elephant_lab_node";
import { COLORS } from "./style/colors";

function createWorkflowToolbar(engine: WorkflowEngineWidget): HTMLElement {

// Define general objects of the UI (Buttons & DropDowns)
const header = document.createElement('h3');
        header.textContent = 'Analysis Workflow';
        header.style.textAlign = 'center';
        engine.node.appendChild(header);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'workflow-button-container';

        const runWorkflowButton = document.createElement('button');
        runWorkflowButton.id = 'workflow-run-button';
        runWorkflowButton.textContent = '▶ Run Workflow';
        runWorkflowButton.title = 'Execute the entire workflow';
        runWorkflowButton.className = 'workflow-button';
        runWorkflowButton.style.backgroundColor = COLORS["Green"];
        runWorkflowButton.onclick = () => { engine.execute_workflow(); };
        buttonContainer.appendChild(runWorkflowButton);

        const clearWorkflowButton = document.createElement('button');
        clearWorkflowButton.textContent = '✖ Clear';
        clearWorkflowButton.title = 'Clear the workflow canvas';
        clearWorkflowButton.style.backgroundColor = COLORS["Red"];
        clearWorkflowButton.className = 'workflow-button';
        clearWorkflowButton.onclick = () => { engine.clearGraph(); };
        buttonContainer.appendChild(clearWorkflowButton)

        const resetZoomButton = document.createElement('button');
        resetZoomButton.textContent = '🔍 Reset Zoom';
        resetZoomButton.title = 'Reset the zoom level of the canvas';
        resetZoomButton.style.backgroundColor = COLORS["Orange"];
        resetZoomButton.className = 'workflow-button';
        resetZoomButton.onclick = () => { engine.resetZoom(); };
        buttonContainer.appendChild(resetZoomButton);

        const undoButton = document.createElement('button');
        undoButton.textContent = '↶ Undo';
        undoButton.title = 'Undo the last change (Ctrl/Cmd+Z)';
        undoButton.className = 'workflow-button';
        undoButton.onclick = () => { engine.undo(); };
        buttonContainer.appendChild(undoButton);

        const redoButton = document.createElement('button');
        redoButton.textContent = '↷ Redo';
        redoButton.title = 'Redo the last undone change (Ctrl/Cmd+Shift+Z)';
        redoButton.className = 'workflow-button';
        redoButton.onclick = () => { engine.redo(); };
        buttonContainer.appendChild(redoButton);

        const autoLayoutButton = document.createElement('button');
        autoLayoutButton.textContent = '▤ Auto Layout';
        autoLayoutButton.title = 'Arrange nodes into columns following the data flow';
        autoLayoutButton.className = 'workflow-button';
        autoLayoutButton.onclick = () => { engine.autoLayout(); };
        buttonContainer.appendChild(autoLayoutButton);

        const groupSelectedButton = document.createElement('button');
        groupSelectedButton.textContent = '▭ Group Selected';
        groupSelectedButton.title = 'Wrap the selected nodes in a group box (right-click the group to collapse/expand it)';
        groupSelectedButton.className = 'workflow-button';
        groupSelectedButton.onclick = () => { engine.groupSelectedNodes(); };
        buttonContainer.appendChild(groupSelectedButton);

        const generateCodeButton = document.createElement('button');
        generateCodeButton.textContent = '</> Generate Code';
        generateCodeButton.style.backgroundColor = COLORS["Olive"];
        generateCodeButton.title = 'Generate Python code from the workflow and add it to a new notebook cell';
        generateCodeButton.className = 'workflow-button';
        generateCodeButton.onclick = () => {
            engine.generateCodeFromWorkflow();

        };
        buttonContainer.appendChild(generateCodeButton);

        const importButton = document.createElement('button');
        importButton.innerHTML = 'Upload workflow <i class="fa fa-upload" aria-hidden="true"></i>';
        importButton.title = 'Import a workflow from a file';
        importButton.style.backgroundColor = COLORS["Teal"];
        importButton.className = 'workflow-button';
        importButton.onclick = () => engine.importWorkflow();
        buttonContainer.appendChild(importButton);

        const exportButton = document.createElement('button');
        exportButton.innerHTML = 'Download workflow <i class="fa fa-download" aria-hidden="true"></i>';
        exportButton.title = 'Export the workflow to a file';
        exportButton.style.backgroundColor = COLORS["Teal"];
        exportButton.className = 'workflow-button';
        exportButton.onclick = () => engine.exportWorkflow();
        buttonContainer.appendChild(exportButton);

        const toggleExecPinsContainer = document.createElement('div');
        toggleExecPinsContainer.style.display = 'inline-block';
        toggleExecPinsContainer.style.marginLeft = '10px';

        const toggleExecPinsCheckbox = document.createElement('input');
        toggleExecPinsCheckbox.type = 'checkbox';
        toggleExecPinsCheckbox.id = 'toggle-exec-pins';
        toggleExecPinsCheckbox.checked = ElephantLabNode.showExecPins;

        const toggleExecPinsLabel = document.createElement('label');
        toggleExecPinsLabel.htmlFor = 'toggle-exec-pins';
        toggleExecPinsLabel.textContent = ' Show Exec Pins';

        toggleExecPinsCheckbox.onchange = (event) => {
            const isChecked = (event.target as HTMLInputElement).checked;
            engine.toggleExecPins(isChecked);
        };

        toggleExecPinsContainer.appendChild(toggleExecPinsCheckbox);
        toggleExecPinsContainer.appendChild(toggleExecPinsLabel);
        buttonContainer.appendChild(toggleExecPinsContainer);

        return buttonContainer;
}

export { createWorkflowToolbar }