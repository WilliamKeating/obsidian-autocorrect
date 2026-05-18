import {
	Plugin,
	MarkdownView,
	Editor,
	MarkdownFileInfo,
	Notice,
	RequestUrlParam,
	requestUrl,
	PluginSettingTab,
	Setting,
	App,
} from "obsidian";
import {
	buildCorrectionPrompt,
	parseCorrectionResponse,
	shouldCorrectLine,
	validateCorrection,
} from "./correction";

interface PluginSettings {
	api_key: string;
	status_notices: boolean;
	automatic_correction: boolean;
	correct_on_enter: boolean;
	correction_delay_ms: number;
	model: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
	status_notices: false,
	api_key: "",
	automatic_correction: true,
	correct_on_enter: true,
	correction_delay_ms: 1200,
	model: "openai/gpt-oss-120b",
};

export default class AutoCorrecter extends Plugin {
	settings: PluginSettings;
	pendingCorrections: Map<string, ReturnType<typeof setTimeout>> = new Map();
	lastAppliedTextByLine: Map<string, string> = new Map();
	hasShownMissingApiKeyNotice = false;

	async onload() {
		await this.loadSettings();
		this.onKeyDown = this.onKeyDown.bind(this);
		this.registerDomEvent(document, "keydown", this.onKeyDown, true);
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, info) =>
				this.onEditorChange(editor, info)
			)
		);
		this.addCommand({
			id: "autocorrect-current-line",
			name: "Autocorrect current line",
			editorCallback: async (_editor, view) => {
				if (view instanceof MarkdownView) {
					await this.correctLine(view.editor, view.editor.getCursor().line);
				}
			},
		});
		this.addSettingTab(new SettingTab(this.app, this));
		if (!this.settings.api_key) {
			this.showMissingApiKeyNoticeOnce();
		}
	}

	onunload() {
		this.clearPendingCorrections();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async onKeyDown(event: KeyboardEvent) {
		if (
			event.key === "Enter" &&
			this.settings.automatic_correction &&
			this.settings.correct_on_enter
		) {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				const lineToCorrect = view.editor.getCursor().line;
				this.scheduleCorrection(view.editor, lineToCorrect, 50);
			}
		}
	}

	onEditorChange(editor: Editor, _info: MarkdownView | MarkdownFileInfo) {
		if (!this.settings.automatic_correction || editor.somethingSelected()) {
			return;
		}

		const cursor = editor.getCursor();
		this.scheduleCorrection(editor, cursor.line, this.settings.correction_delay_ms);
	}

	scheduleCorrection(editor: Editor, line: number, delayMs: number) {
		const key = this.correctionKey(editor, line);
		const existing = this.pendingCorrections.get(key);
		if (existing) {
			clearTimeout(existing);
		}

		const timeout = setTimeout(() => {
			this.pendingCorrections.delete(key);
			void this.correctLine(editor, line);
		}, delayMs);

		this.pendingCorrections.set(key, timeout);
	}

	clearPendingCorrections() {
		this.pendingCorrections.forEach((timeout) => clearTimeout(timeout));
		this.pendingCorrections.clear();
	}

	async correctLine(editor: Editor, line: number) {
		if (line < 0 || line >= editor.lineCount()) {
			return;
		}

		if (!this.settings.api_key) {
			this.showMissingApiKeyNoticeOnce();
			return;
		}

		const originalLine = editor.getLine(line);
		const decision = shouldCorrectLine(originalLine);
		if (!decision.shouldCorrect) {
			return;
		}

		const key = this.correctionKey(editor, line);
		if (this.lastAppliedTextByLine.get(key) === originalLine) {
			return;
		}

		const originalBody = decision.editable.body;
		let status: Notice | null = null;
		if (this.settings.status_notices) {
			status = new Notice(
				"Correcting spelling on line " + (line + 1) + "...",
				0
			);
		}

		const response = await this.getLLMResponse(originalBody);
		const validation = validateCorrection(
			originalBody,
			response.corrected_spelling ?? null
		);

		if (validation.accepted && validation.corrected) {
			const latestLine = editor.getLine(line);
			const latestDecision = shouldCorrectLine(latestLine);
			if (
				!latestDecision.shouldCorrect ||
				latestDecision.editable.body !== originalBody
			) {
				status?.hide();
				return;
			}

			const correctedLine =
				latestDecision.editable.prefix + validation.corrected;
			const cursor = editor.getCursor();
			const cursorWasAtEnd = cursor.line === line && cursor.ch >= latestLine.length;

			editor.setLine(line, correctedLine);
			this.lastAppliedTextByLine.set(key, correctedLine);
			if (cursorWasAtEnd) {
				editor.setCursor({ line, ch: correctedLine.length });
			}

			if (status) {
				status.hide();
			}
		} else {
			if (status) {
				status.hide();
			}
			if (response.error) {
				new Notice(response.error);
			}
		}
	}

	async getLLMResponse(text: string): Promise<{
		corrected_spelling?: string;
		error?: string;
	}> {
		const url = "https://api.groq.com/openai/v1/chat/completions";
		const apiKey = this.settings.api_key;
		const content = buildCorrectionPrompt(text);

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		};

		const data = {
			model: this.settings.model,
			messages: [{ role: "user", content: content }],
			temperature: 0,
			max_tokens: Math.min(256, Math.max(32, text.length * 2)),
		};

		const params: RequestUrlParam = {
			method: "POST",
			headers,
			body: JSON.stringify(data),
			url: url,
		};
		try {
			const response: any = await requestUrl(params);
			const content = response.json?.choices?.[0]?.message?.content;
			if (typeof content !== "string") {
				return { error: "Autocorrect returned an invalid response." };
			}

			const parsedResponse = parseCorrectionResponse(content);
			if (parsedResponse === null) {
				return { error: "Autocorrect returned an empty response." };
			}

			return { corrected_spelling: parsedResponse };
		} catch (error) {
			console.error(error);
			return {
				error:
					"Error correcting spelling. Make sure the Groq API key is correct and Internet is working.",
			};
		}
	}

	showMissingApiKeyNoticeOnce() {
		if (this.hasShownMissingApiKeyNotice) {
			return;
		}

		this.hasShownMissingApiKeyNotice = true;
		new Notice(
			"Please enter your Groq API key in the settings tab to use Obsidian AutoCorrect."
		);
	}

	correctionKey(editor: Editor, line: number): string {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const filePath = view?.editor === editor ? view.file?.path ?? "active" : "active";
		return `${filePath}:${line}`;
	}
}
class SettingTab extends PluginSettingTab {
	plugin: AutoCorrecter;

	constructor(app: App, plugin: AutoCorrecter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Groq API Key")
			.setDesc(
				"Create a account at https://www.groq.com/ and enter your API key for the plugin to work."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your key")
					.setValue(this.plugin.settings.api_key)
					.onChange(async (value) => {
						this.plugin.settings.api_key = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Status Notices")
			.setDesc("Show status notice popups when correcting spelling.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.status_notices)
					.onChange(async (value) => {
						this.plugin.settings.status_notices = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Automatic Correction")
			.setDesc("Correct the active line automatically after typing pauses.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.automatic_correction)
					.onChange(async (value) => {
						this.plugin.settings.automatic_correction = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Correct after Enter")
			.setDesc(
				"When automatic correction is enabled, also correct the line you just finished after pressing Enter."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.correct_on_enter)
					.onChange(async (value) => {
						this.plugin.settings.correct_on_enter = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Correction Delay")
			.setDesc("Milliseconds to wait after typing stops before correcting.")
			.addText((text) =>
				text
					.setPlaceholder("1200")
					.setValue(String(this.plugin.settings.correction_delay_ms))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						if (!Number.isNaN(parsed) && parsed >= 300) {
							this.plugin.settings.correction_delay_ms = parsed;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Groq Model")
			.setDesc("OpenAI-compatible Groq model used for autocorrection.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.model)
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model =
							value.trim() || DEFAULT_SETTINGS.model;
						await this.plugin.saveSettings();
					})
			);
	}
}
