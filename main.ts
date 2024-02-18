import {
	Editor,
	Plugin,
	MarkdownView,
	Notice,
	RequestUrlParam,
	requestUrl,
	PluginSettingTab,
	Setting,
	App,
} from "obsidian";

interface PluginSettings {
	api_key: string;
	status_notices: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	status_notices: true,
	api_key: "",
};

export default class AutoCorrecter extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();
		this.onKeyDown = this.onKeyDown.bind(this);
		this.registerDomEvent(document, "keydown", this.onKeyDown, true);
		this.addSettingTab(new SettingTab(this.app, this));
		if (!this.settings.api_key) {
			new Notice(
				"Please enter your Together.ai API key in the settings tab to use Obsidian AutoCorrect."
			);
		}
	}

	onunload() {}

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
		if (event.key === "Enter") {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			// Make sure the user is editing a Markdown file.
			if (view) {
				const cursor = view.editor.getCursor();
				const text = view.editor.getLine(cursor.line);
				console.log(cursor);
				console.log(text);
				let status: Notice | null = null;
				if (this.settings.status_notices) {
					status = new Notice(
						"Correcting spelling on line " +
							(cursor.line + 1) +
							"...",
						0
					);
				}
				const response: any = await this.getLLMResponse(text);
				console.log(response);
				if (response.corrected_spelling) {
					view.editor.setLine(
						cursor.line,
						response.corrected_spelling
					);
					if (status) {
						status.hide();
					}
				} else {
					if (status) {
						status.setMessage(
							"Error correcting spelling. Make sure API key is correct and Internet is working."
						);
					} else {
						new Notice(
							"Error correcting spelling. Make sure API key is correct and Internet is working."
						);
					}
				}
			}
		}
	}
	async getLLMResponse(text: string) {
		const url = "https://api.together.xyz/v1/chat/completions";
		const apiKey = this.settings.api_key;
		const system_content =
			"You will receive user input containing text with potential spelling errors. Your task is to correct these errors while preserving the original meaning. The original text may contain markdown, which should be maintained. You should ONLY correct spelling errors; grammar and punctuation should remain EXACTLY the same. The output should be a corrected version of the input text. Additionally, the model should leave correct words verbatim, even if they may be offensive, slang, abbreviations, brand names, or other non-standard language intentionally input by the user. This system will be utilized for real-time autocorrection, so refrain from altering a word unless you understand the user's intended meaning.";
		const user_content = '{"user_text": "' + text + '"}';

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		};

		const data = {
			model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
			messages: [
				{ role: "system", content: system_content },
				{ role: "user", content: user_content },
			],
			response_format: {
				type: "json_object",
				schema: {
					type: "object",
					properties: {
						corrected_spelling: { type: "string" },
					},
					required: ["corrected_spelling"],
				},
			},
			temperature: 0.7,
			max_tokens: 500,
		};

		const params: RequestUrlParam = {
			method: "POST",
			headers,
			body: JSON.stringify(data),
			url: url,
		};
		try {
			const response = await requestUrl(params);
			const json_response = JSON.parse(
				response.json.choices[0].message.content
			);
			return json_response;
		} catch (error) {
			console.error(error);
			return error;
		}
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
			.setName("Together.ai API Key")
			.setDesc(
				"Create a account at https://www.together.ai/ and enter your API key for the plugin to work."
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
	}
}
