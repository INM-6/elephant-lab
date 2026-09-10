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
                this.handleResponse(data.message as string);
                break;
            default:
                console.warn('Unknown plot message type', data.type, data.message);
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

        // Send button
        this.submitButton = document.createElement("button");
        this.submitButton.className = "widget-assistant__button";
        this.submitButton.type = "button";
        this.submitButton.setAttribute("aria-label", "Send message");
        this.submitButton.title = "Send";

        // Send icon
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

    private updateSendButton(): void {
        const hasText = this.input.value.trim().length > 0;

        this.submitButton.disabled = !hasText;
    }

    private handleInput(): void {
        const value = this.input.value.trim();

        if (!value) {
            return;
        }

        // -------------------------
        // User message
        // -------------------------

        const userMessage = document.createElement("div");
        userMessage.className = "widget-assistant__message widget-assistant__message--user";
        userMessage.textContent = value;

        this.output.appendChild(userMessage);

        // -------------------------
        // Reset input
        // -------------------------

        this.input.value = "";
        this.input.style.height = "auto";

        this.updateSendButton();

        this.input.focus();

        // Keep newest message visible
        this.output.scrollTop = this.output.scrollHeight;

        this.comm?.send({
            type: 'user_message',
            message: value,
        })
    }

    private async handleResponse(assistantMessageText: string): Promise<void> {
        const assistantMessage = document.createElement("div");

        assistantMessage.className =
            "widget-assistant__message widget-assistant__message--assistant";

        const html = await marked.parse(assistantMessageText);

        assistantMessage.innerHTML = DOMPurify.sanitize(html);

        this.output.appendChild(assistantMessage);

        this.output.scrollTop = this.output.scrollHeight;
    }
}