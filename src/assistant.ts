import {
    Widget,
} from '@lumino/widgets';
import { KernelMessage, Kernel } from '@jupyterlab/services';
import { IComm } from '@jupyterlab/services/lib/kernel/kernel';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { closeIcon, addIcon } from "@jupyterlab/ui-components";
import type {
    AssistantConfiguration,
    AssistantConfigurationField,
    AssistantFieldSetting
} from './assistant_config';
import { ASSISTANT_CONFIGURATION_FIELDS } from './assistant_config';

export class Assistant {
    private comm?: IComm;
    public widget_assistant: Widget;

    private settingsPanel!: HTMLDivElement;
    private settingsError!: HTMLDivElement;
    private settingsButton!: HTMLButtonElement;
    private saveSettingsButton!: HTMLButtonElement;
    private composer!: HTMLDivElement;
    private settingsInputs!: Record<AssistantConfigurationField, {
        source: HTMLSelectElement;
        value: HTMLInputElement;
    }>;
    private configuration?: AssistantConfiguration;
    private saveConfiguration?: (configuration: AssistantConfiguration) => Promise<void>;
    private pendingConfigurationResponse?: {
        resolve: () => void;
        reject: (error: Error) => void;
    };

    private input!: HTMLTextAreaElement;
    private output!: HTMLDivElement;
    private submitButton!: HTMLButtonElement;
    private selectionContextButton!: HTMLButtonElement;
    private selectedCount = 0;
    private includeSelection = false;

    // Tracks the currently displayed loading indicator.
    private loadingMessage?: HTMLDivElement;

    // Identifies the current conversation generation.
    // Incremented whenever the conversation is cleared so that
    // responses from previous requests can be ignored.
    private contextGeneration = 0;

    constructor() {
        this.widget_assistant = new Widget();

        this.widget_assistant.node.style.width = "100%";
        this.widget_assistant.node.style.height = "100%";
        this.widget_assistant.node.style.minWidth = "0";
        this.widget_assistant.node.style.minHeight = "0";

        this.createUI();
    }

    public registerCommTarget(kernel: Kernel.IKernelConnection) {
        // Register the comm target to receive messages from Python
        kernel.registerCommTarget(
            'assistant_channel',
            (comm, msg) => {
                this.comm = comm;
                comm.onMsg = (msg) => this.handleCommMessage(msg);
            }
        );
    }

    public initializeConfiguration(
        configuration: AssistantConfiguration,
        saveConfiguration: (configuration: AssistantConfiguration) => Promise<void>
    ): void {
        this.saveConfiguration = saveConfiguration;
        this.populateSettings(configuration);

        this.openSettings();
    }

    private handleCommMessage(msg: KernelMessage.ICommMsgMsg) {
        const data = msg.content.data;

        switch (data.type) {
            case 'configuration_result':
                if (data.ok === true) {
                    this.pendingConfigurationResponse?.resolve();
                } else {
                    this.configuration = undefined;
                    this.pendingConfigurationResponse?.reject(
                        new Error(String(data.message || 'Assistant configuration failed.'))
                    );
                }
                this.pendingConfigurationResponse = undefined;
                break;

            case 'assistant_response':
                // Ignore responses belonging to a conversation that
                // was cleared while the request was running.
                if (data.generation === this.contextGeneration) {
                    if (typeof data.message === 'string') {
                        this.handleResponse(data.message);
                    } else {
                        this.handleResponse('The assistant returned an invalid response.');
                    }
                }
                break;

            case 'selection_changed':
                if (typeof data.selected_count === 'number') {
                    this.updateSelectedAdding(data.selected_count);
                }
                break;

            default:
                console.warn(
                    'Unknown plot message type',
                    data.type,
                    data.message
                );
        }
    }

    private createUI(): void {
        const container = document.createElement("div");
        container.className = "widget-assistant";

        const header = document.createElement("div");
        header.className = "widget-assistant__header";

        this.settingsButton = document.createElement("button");
        this.settingsButton.className = "widget-assistant__settings-button";
        this.settingsButton.type = "button";
        this.settingsButton.textContent = "Settings";
        this.settingsButton.addEventListener("click", () => this.openSettings());
        header.appendChild(this.settingsButton);

        // -------------------------
        // Output
        // -------------------------

        this.output = document.createElement("div");
        this.output.className = "widget-assistant__output";
        this.output.setAttribute("aria-live", "polite");

        // -------------------------
        // Composer
        // -------------------------

        this.composer = document.createElement("div");
        this.composer.className = "widget-assistant__composer";

        const inputRow = document.createElement("div");
        inputRow.className = "widget-assistant__input-row";

        const actionRow = document.createElement("div");
        actionRow.className = "widget-assistant__action-row";

        const contextActions = document.createElement("div");
        contextActions.className = "widget-assistant__context-actions";

        const submitActions = document.createElement("div");
        submitActions.className = "widget-assistant__submit-actions";

        // Textarea
        this.input = document.createElement("textarea");
        this.input.className = "widget-assistant__input";
        this.input.placeholder = "Message...";
        this.input.autocomplete = "off";
        this.input.rows = 1;
        this.input.setAttribute("aria-label", "Message");

        // Handle keyboard input
        this.input.addEventListener("keydown", (event) => {
            // Enter = send
            // Shift + Enter = new line
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                this.handleInput();
            }
        });

        // Auto-grow textarea
        this.input.addEventListener("input", () => {
            this.resizeInput();
        });

        // -------------------------
        // Selection context button
        // -------------------------

        this.selectionContextButton = document.createElement("button");
        this.selectionContextButton.className = "widget-assistant__selection";
        this.selectionContextButton.type = "button";

        this.selectionContextButton.addEventListener("click", () => {
            this.includeSelection = !this.includeSelection;
            this.updateSelectionContextButton();
        });

        // -------------------------
        // Clear context button
        // -------------------------

        const clearButton = document.createElement("button");
        clearButton.className = "widget-assistant__clear";
        clearButton.type = "button";
        clearButton.setAttribute("aria-label", "Clear context");
        clearButton.title = "Clear context";

        clearButton.innerHTML = `
            <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                <path
                    d="M4 7H20"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                />
                <path
                    d="M10 11V17"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                />
                <path
                    d="M14 11V17"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                />
                <path
                    d="M6 7L7 20H17L18 7"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linejoin="round"
                />
                <path
                    d="M9 7V4H15V7"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        `;

        clearButton.addEventListener("click", () => {
            const confirmed = window.confirm(
                "Clear this conversation?\n\nThis will remove the current conversation context."
            );

            if (!confirmed) {
                return;
            }

            this.clearContext();
            this.input.focus();
        });

        // -------------------------
        // Send button
        // -------------------------

        this.submitButton = document.createElement("button");
        this.submitButton.className = "widget-assistant__button";
        this.submitButton.type = "button";
        this.submitButton.setAttribute("aria-label", "Send message");
        this.submitButton.title = "Send";

        this.submitButton.innerHTML = `
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                <path
                    d="M5 12H19"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                />
                <path
                    d="M13 6L19 12L13 18"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        `;

        this.submitButton.addEventListener("click", () => {
            this.handleInput();
        });

        inputRow.appendChild(this.input);
        contextActions.appendChild(this.selectionContextButton);
        submitActions.appendChild(clearButton);
        submitActions.appendChild(this.submitButton);
        actionRow.appendChild(contextActions);
        actionRow.appendChild(submitActions);
        this.composer.appendChild(inputRow);
        this.composer.appendChild(actionRow);

        this.settingsPanel = this.createSettingsPanel();
        this.output.hidden = true;
        this.composer.hidden = true;
        this.settingsPanel.hidden = true;

        container.appendChild(header);
        container.appendChild(this.output);
        container.appendChild(this.composer);
        container.appendChild(this.settingsPanel);

        this.widget_assistant.node.appendChild(container);

        // Initial state
        this.updateSelectionContextButton();
        this.updateSendButton();
    }

    private createSettingsPanel(): HTMLDivElement {
        const panel = document.createElement("div");
        panel.className = "widget-assistant__settings-panel";

        const heading = document.createElement("h2");
        heading.textContent = "Assistant connection";
        panel.appendChild(heading);

        const description = document.createElement("p");
        description.textContent =
            "Choose whether each field is a direct value or the name of an environment variable. " +
            "Settings are saved in JupyterLab; use environment variables for secrets.";
        panel.appendChild(description);

        this.settingsInputs = {
            apiUrl: this.createSettingsField(panel, "API URL", "https://example.com/v1", false),
            apiKey: this.createSettingsField(panel, "API key", "API key or environment variable name", true),
            model: this.createSettingsField(panel, "Model", "Model name or environment variable name", false),
        };

        this.settingsError = document.createElement("div");
        this.settingsError.className = "widget-assistant__settings-error";
        this.settingsError.setAttribute("role", "alert");
        panel.appendChild(this.settingsError);

        const actions = document.createElement("div");
        actions.className = "widget-assistant__settings-actions";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "widget-assistant__settings-cancel";
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", () => this.closeSettings());

        this.saveSettingsButton = document.createElement("button");
        this.saveSettingsButton.type = "button";
        this.saveSettingsButton.className = "widget-assistant__settings-save";
        this.saveSettingsButton.textContent = "Save and start";
        this.saveSettingsButton.addEventListener("click", () => {
            void this.saveSettings();
        });

        actions.appendChild(cancelButton);
        actions.appendChild(this.saveSettingsButton);
        panel.appendChild(actions);

        return panel;
    }

    private createSettingsField(
        panel: HTMLDivElement,
        labelText: string,
        placeholder: string,
        isSecret: boolean
    ): { source: HTMLSelectElement; value: HTMLInputElement } {
        const row = document.createElement("label");
        row.className = "widget-assistant__settings-field";

        const label = document.createElement("span");
        label.textContent = labelText;

        const source = document.createElement("select");
        source.setAttribute("aria-label", `${labelText} source`);

        const directOption = document.createElement("option");
        directOption.value = "value";
        directOption.textContent = "Direct value";
        const environmentOption = document.createElement("option");
        environmentOption.value = "environment";
        environmentOption.textContent = "Environment variable";
        source.append(directOption, environmentOption);

        const value = document.createElement("input");
        value.type = isSecret ? "password" : "text";
        value.autocomplete = "off";
        value.placeholder = placeholder;
        value.setAttribute("aria-label", labelText);

        source.addEventListener("change", () => {
            value.type = isSecret && source.value === "value" ? "password" : "text";
            value.placeholder = source.value === "environment"
                ? `Environment variable name for ${labelText}`
                : placeholder;
        });

        row.append(label, source, value);
        panel.appendChild(row);
        return { source, value };
    }

    private populateSettings(configuration: AssistantConfiguration): void {
        ASSISTANT_CONFIGURATION_FIELDS.forEach((field) => {
            const input = this.settingsInputs[field];
            input.source.value = configuration[field].source;
            input.value.value = configuration[field].value;
            input.source.dispatchEvent(new Event("change"));
        });
    }

    private readSettings(): AssistantConfiguration {
        const readField = (field: AssistantConfigurationField): AssistantFieldSetting => {
            const input = this.settingsInputs[field];
            const source = input.source.value;
            if (source !== 'value' && source !== 'environment') {
                throw new Error(`Invalid source selected for ${field}.`);
            }
            return {
                source,
                value: input.value.value.trim(),
            };
        };
        return {
            apiUrl: readField("apiUrl"),
            apiKey: readField("apiKey"),
            model: readField("model"),
        };
    }

    private hasConfiguration(configuration: AssistantConfiguration): boolean {
        return ASSISTANT_CONFIGURATION_FIELDS
            .every((field) => configuration[field].value.trim().length > 0);
    }

    private openSettings(populate = true): void {
        if (populate && this.configuration) {
            this.populateSettings(this.configuration);
        }
        this.settingsError.textContent = "";
        this.settingsPanel.hidden = false;
        this.output.hidden = true;
        this.composer.hidden = true;
        this.settingsButton.hidden = true;
    }

    private closeSettings(): void {
        if (!this.configuration) {
            return;
        }
        this.settingsPanel.hidden = true;
        this.output.hidden = false;
        this.composer.hidden = false;
        this.settingsButton.hidden = false;
    }

    private async saveSettings(): Promise<void> {
        try {
            const configuration = this.readSettings();
            if (!this.hasConfiguration(configuration)) {
                this.settingsError.textContent = "Enter a value or environment variable name for each field.";
                return;
            }
            await this.applyConfiguration(configuration, true);
        } catch (error) {
            this.settingsError.textContent = error instanceof Error
                ? error.message
                : String(error);
        }
    }

    private async applyConfiguration(
        configuration: AssistantConfiguration,
        persist = false
    ): Promise<void> {
        this.settingsError.textContent = "";
        this.saveSettingsButton.disabled = true;

        try {
            const comm = this.comm;
            if (!comm) {
                throw new Error("The assistant is not connected to the active Jupyter kernel.");
            }

            await new Promise<void>((resolve, reject) => {
                this.pendingConfigurationResponse = { resolve, reject };
                comm.send({
                    type: "configure",
                    configuration,
                });
            });

            this.configuration = configuration;
            if (persist) {
                if (!this.saveConfiguration) {
                    throw new Error("Assistant settings storage is not available.");
                }
                await this.saveConfiguration(configuration);
            }
            this.contextGeneration++;
            this.output.replaceChildren();
            this.removeLoadingIndicator();
            this.updateSendButton();
            this.closeSettings();
        } catch (error) {
            this.settingsError.textContent = error instanceof Error
                ? error.message
                : String(error);
            this.openSettings(false);
        } finally {
            this.saveSettingsButton.disabled = false;
        }
    }

    private resizeInput(): void {
        this.input.style.height = "auto";

        const maxHeight = 200;
        const newHeight = Math.min(
            this.input.scrollHeight,
            maxHeight
        );

        this.input.style.height = `${newHeight}px`;

        this.updateSendButton();
    }

    private updateSelectedAdding(selectedCount: number): void {
        selectedCount = Math.max(0, selectedCount);
        if (selectedCount > 0) {
            if (this.selectedCount === 0) {
                this.includeSelection = true;
            }
        } else {
            this.includeSelection = false;
        }
        this.selectedCount = selectedCount;

        this.updateSelectionContextButton();
    }

    private updateSelectionContextButton(): void {
        const hasSelection = this.selectedCount > 0;
        this.selectionContextButton.hidden = !hasSelection;

        if (!hasSelection) {
            return;
        }

        const action = this.includeSelection ? "Remove" : "Add";
        const icon = this.includeSelection ? closeIcon : addIcon;

        // Clear previous contents.
        this.selectionContextButton.replaceChildren();

        // Add proper icon.
        const iconElement = icon.element({
            className: "widget-assistant__selection-icon"
        });

        this.selectionContextButton.appendChild(iconElement);

        // Add count/text.
        const text = document.createElement("span");
        text.textContent = `${this.selectedCount} selected`;
        this.selectionContextButton.appendChild(text);

        this.selectionContextButton.setAttribute(
            "aria-label",
            `${action} ${this.selectedCount} selected items ${this.includeSelection ? "from" : "to"
            } context`
        );

        this.selectionContextButton.title =
            `${action} selection ${this.includeSelection ? "from" : "to"
            } context`;
    }

    private canSendUserMessage(): boolean {
        const hasText = this.input.value.trim().length > 0;
        return hasText && !this.loadingMessage;
    }

    private updateSendButton(): void {
        this.submitButton.disabled = !this.canSendUserMessage();
    }

    private clearContext(): void {
        // Invalidate any response that is currently in flight.
        this.contextGeneration++;

        // Remove any active loading indicator.
        this.removeLoadingIndicator();

        // Clear the displayed conversation.
        this.output.innerHTML = "";

        // Clear the input.
        this.input.value = "";
        this.input.style.height = "auto";

        // Reset the send button.
        this.updateSendButton();

        // Tell the backend to clear its conversation context.
        this.comm?.send({
            type: "clear_context"
        });
    }


    private handleInput(): void {
        if (!this.canSendUserMessage()) {
            return;
        }

        const value = this.input.value.trim();

        // Capture the current conversation generation.
        // If the user clears the context while this request is
        // running, the generation will change and this response
        // will become obsolete.
        const requestGeneration = this.contextGeneration;

        // -------------------------
        // User message
        // -------------------------

        const userMessage = document.createElement("div");
        userMessage.className =
            "widget-assistant__message widget-assistant__message--user";

        userMessage.textContent = value;

        this.output.appendChild(userMessage);

        // -------------------------
        // Loading indicator
        // -------------------------

        this.showLoadingIndicator();

        // -------------------------
        // Reset input
        // -------------------------

        this.input.value = "";
        this.input.style.height = "auto";

        this.updateSendButton();

        this.input.focus();

        // Keep newest message visible
        this.scrollToBottom();

        // -------------------------
        // Send to backend
        // -------------------------

        this.comm?.send({
            type: "user_message",
            generation: requestGeneration,
            message: value,
            include_selection: this.includeSelection,
        });
    }

    private showLoadingIndicator(): void {
        // Remove any stale indicator first.
        this.removeLoadingIndicator();

        const loadingMessage = document.createElement("div");

        loadingMessage.className =
            "widget-assistant__message widget-assistant__message--assistant widget-assistant__message--loading";

        loadingMessage.setAttribute("role", "status");
        loadingMessage.setAttribute("aria-label", "Assistant is thinking");

        loadingMessage.innerHTML = `
            <span class="widget-assistant__loading-content" >
                <span class="widget-assistant__loading-dot" > </span>
                <span class="widget-assistant__loading-dot" > </span>
                <span class="widget-assistant__loading-dot" > </span>
            </span>
        `;

        this.loadingMessage = loadingMessage;
        this.output.appendChild(loadingMessage);

        this.scrollToBottom();
    }

    private removeLoadingIndicator(): void {
        if (!this.loadingMessage) {
            return;
        }

        this.loadingMessage.remove();
        this.loadingMessage = undefined;
    }

    private scrollToBottom(): void {
        this.output.scrollTop = this.output.scrollHeight;
    }

    private scrollToMessage(message: HTMLElement): void {
        // Scroll so the beginning of the message is visible.
        // `block: "start"` puts the top of the message at the
        // top of the scrollable viewport.
        message.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    }

    private async handleResponse(
        assistantMessageText: string
    ): Promise<void> {
        // Remove the loading indicator before displaying
        // the actual assistant response.
        this.removeLoadingIndicator();

        const assistantMessage = document.createElement("div");

        assistantMessage.className =
            "widget-assistant__message widget-assistant__message--assistant";

        const html = await marked.parse(assistantMessageText);

        // Sanitize the Markdown-generated HTML first.
        assistantMessage.innerHTML = DOMPurify.sanitize(html);

        // Add a copy button to every code block.
        assistantMessage.querySelectorAll("pre").forEach((pre) => {
            const code = pre.querySelector("code");

            if (!code) {
                return;
            }

            pre.classList.add("widget-assistant__code-block");

            const button = document.createElement("button");

            button.type = "button";
            button.className = "widget-assistant__code-copy";
            button.textContent = "Copy";
            button.setAttribute("aria-label", "Copy code");

            button.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(
                        code.textContent ?? ""
                    );

                    button.textContent = "Copied!";
                    button.classList.add("is-copied");

                    setTimeout(() => {
                        button.textContent = "Copy";
                        button.classList.remove("is-copied");
                    }, 1500);
                } catch (error) {
                    console.error("Failed to copy code:", error);

                    button.textContent = "Failed";

                    setTimeout(() => {
                        button.textContent = "Copy";
                    }, 1500);
                }
            });

            pre.prepend(button);
        });

        this.output.appendChild(assistantMessage);

        // Show the beginning of the new response rather than
        // jumping all the way to its end.
        this.scrollToMessage(assistantMessage);

        // Re-enable sending.
        this.updateSendButton();
    }
}