import {
    Widget,
} from '@lumino/widgets';
import { KernelMessage, Kernel } from '@jupyterlab/services';
import { IComm } from '@jupyterlab/services/lib/kernel/kernel';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export class Assistant {
    private comm?: IComm;
    public widget_assistant: Widget;

    private input!: HTMLTextAreaElement;
    private output!: HTMLDivElement;
    private submitButton!: HTMLButtonElement;

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

    public registerCommTarge(kernel: Kernel.IKernelConnection) {
        // Register the comm target to receive messages from Python
        kernel.registerCommTarget(
            'assistant_channel',
            (comm, msg) => {
                this.comm = comm;
                comm.onMsg = (msg) => this.handleCommMessage(msg);
            }
        );
    }

    private handleCommMessage(msg: KernelMessage.ICommMsgMsg) {
        const data = msg.content.data;

        switch (data.type) {
            case 'assistant_response':
                // Ignore responses belonging to a conversation that
                // was cleared while the request was running.
                if (data.generation === this.contextGeneration) {
                    this.handleResponse(data.message as string);
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

        // -------------------------
        // Output
        // -------------------------

        this.output = document.createElement("div");
        this.output.className = "widget-assistant__output";
        this.output.setAttribute("aria-live", "polite");

        // -------------------------
        // Composer
        // -------------------------

        const composer = document.createElement("div");
        composer.className = "widget-assistant__composer";

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

        composer.appendChild(this.input);
        composer.appendChild(this.submitButton);
        composer.appendChild(clearButton);

        container.appendChild(this.output);
        container.appendChild(composer);

        this.widget_assistant.node.appendChild(container);

        // Initial state
        this.updateSendButton();
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

        assistantMessage.innerHTML = DOMPurify.sanitize(html);

        this.output.appendChild(assistantMessage);

        // Show the beginning of the new response rather than
        // jumping all the way to its end.
        this.scrollToMessage(assistantMessage);

        // Re-enable sending.
        this.updateSendButton();
    }
}