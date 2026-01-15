import { WorkflowEngineWidget } from "./workflow_engine";
import { JupyphantNode } from "./jupyphant_node";

function createWorkflowToolbar(engine: WorkflowEngineWidget): HTMLElement {

// Define general objects of the UI (Buttons & DropDowns)
const header = document.createElement('h3');
        header.textContent = 'Analysis Workflow';
        header.style.textAlign = 'center';
        engine.node.appendChild(header);

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'workflow-button-container';

        const runWorkflowButton = document.createElement('button');
        runWorkflowButton.textContent = '▶ Run Workflow';
        runWorkflowButton.title = 'Execute the entire workflow';
        runWorkflowButton.className = 'workflow-button workflow-button-run';
        runWorkflowButton.onclick = () => { engine.execute_workflow(); };
        buttonContainer.appendChild(runWorkflowButton);

        const clearWorkflowButton = document.createElement('button');
        clearWorkflowButton.textContent = '✖ Clear';
        clearWorkflowButton.title = 'Clear the workflow canvas';
        clearWorkflowButton.className = 'workflow-button workflow-button-clear';
        clearWorkflowButton.onclick = () => { engine.clearGraph(); };
        buttonContainer.appendChild(clearWorkflowButton)

        const resetZoomButton = document.createElement('button');
        resetZoomButton.textContent = '🔍 Reset Zoom';
        resetZoomButton.title = 'Reset the zoom level of the canvas';
        resetZoomButton.className = 'workflow-button workflow-button-debug';
        resetZoomButton.onclick = () => { engine.resetZoom(); };
        buttonContainer.appendChild(resetZoomButton);

        const generateCodeButton = document.createElement('button');
        generateCodeButton.textContent = '</> Generate Code';
        generateCodeButton.title = 'Generate Python code from the workflow and add it to a new notebook cell';
        generateCodeButton.className = 'workflow-button workflow-button-generate';
        generateCodeButton.onclick = () => {
            engine.generateCodeFromWorkflow();

        };
        buttonContainer.appendChild(generateCodeButton);

        const importButton = document.createElement('button');
        importButton.innerHTML = 'Upload workflow from file <i class="fa fa-upload" aria-hidden="true"></i>';
        importButton.title = 'Import a workflow from a file';
        importButton.className = 'workflow-button workflow-button-io';
        importButton.onclick = () => engine.importWorkflow();
        buttonContainer.appendChild(importButton);

        const exportButton = document.createElement('button');
        exportButton.innerHTML = 'Download workflow as file <i class="fa fa-download" aria-hidden="true"></i>';
        exportButton.title = 'Export the workflow to a file';
        exportButton.className = 'workflow-button workflow-button-io';
        exportButton.onclick = () => engine.exportWorkflow();
        buttonContainer.appendChild(exportButton);

        const toggleExecPinsContainer = document.createElement('div');
        toggleExecPinsContainer.style.display = 'inline-block';
        toggleExecPinsContainer.style.marginLeft = '10px';

        const toggleExecPinsCheckbox = document.createElement('input');
        toggleExecPinsCheckbox.type = 'checkbox';
        toggleExecPinsCheckbox.id = 'toggle-exec-pins';
        toggleExecPinsCheckbox.checked = JupyphantNode.showExecPins;

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