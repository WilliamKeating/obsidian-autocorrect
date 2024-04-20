import {
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
	stripLeadingWhitespace(input: string): [string, string] {
		const match = input.match(/^[\t ]*/);
		const leadingWhitespace = match ? match[0] : "";
		const parsedText = input.replace(/^[\t ]*/, "");
		return [leadingWhitespace, parsedText];
	}

	async onKeyDown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			// Make sure the user is editing a Markdown file.
			if (view) {
				const cursor = view.editor.getCursor();
				const text = view.editor.getLine(cursor.line);
				// LLM has a very hard time reproducing the leading tabs in markdown bullet points
				const [leadingWhitespace, parsedText] =
					this.stripLeadingWhitespace(text);
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
				const response: any = await this.getLLMResponse(parsedText);
				console.log(response);
				if (response.corrected_spelling) {
					const correctedText =
						leadingWhitespace + response.corrected_spelling;
					view.editor.setLine(cursor.line, correctedText);
					if (status) {
						status.hide();
					}
				} else {
					if (status) {
						status.hide();
					}
					new Notice(
						"Error correcting spelling. Make sure API key is correct and Internet is working."
					);
				}
			}
		}
	}
	async getLLMResponse(text: string) {
		const url = "https://api.groq.com/openai/v1/chat/completions";
		const apiKey = this.settings.api_key;
		const content = `Your task is to take input text that may contain spelling errors and correct those errors while
			preserving the original meaning, grammar, punctuation and formatting. The text may contain Markdown
			or other formatting which should be maintained in the output.
			
			Here is the input text that needs to be corrected:
			
			<input_text>
			${text}
			</input_text>
			
			First, think through your approach in a <scratchpad> section:
			- Carefully read through the text and identify any words that appear to be misspelled
			- For each potential misspelling, consider the context and your understanding of the intended
			meaning to determine the most likely correct spelling
			- Make sure to preserve any grammatical errors, unusual punctuation, proper nouns, slang,
			abbreviations or intentionally informal language in the original text
			- Check that your proposed corrections don't change the meaning or formatting of the original text
			
			Then, provide the corrected version of the input text with all formatting perfectly preserved inside
			<corrected_text> tags. ONLY correct clear spelling mistakes. Do not make any other changes.
			
			Example format for your response:
  			<scratchpad>Carefully read through the text and identify any words that appear to be misspelled.<scratchpad>
  			<corrected_text>Corrected version of the input text with all formatting perfectly preserved.</corrected_text>`;

		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		};

		const data = {
			model: "llama3-70b-8192",
			messages: [{ role: "user", content: content }],
		};

		const params: RequestUrlParam = {
			method: "POST",
			headers,
			body: JSON.stringify(data),
			url: url,
		};
		try {
			const response: any = await requestUrl(params);
			console.log(response);
			const parsedResponse = response.json.choices[0].message.content
				.split("<corrected_text>")[1]
				.split("</corrected_text>")[0]
				.replace(/\n/g, "");

			return { corrected_spelling: parsedResponse };
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
	}
}
