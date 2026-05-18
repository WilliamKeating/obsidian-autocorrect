import { _electron as electron, expect, test } from "@playwright/test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

const PLUGIN_ID = "obsidian-autocorrect";
const COMMAND_ID = `${PLUGIN_ID}:autocorrect-current-line`;

test.skip(
	!process.env.OBSIDIAN_PATH,
	"Set OBSIDIAN_PATH to an Obsidian desktop executable to run E2E tests."
);

test("manual command corrects a note through Obsidian", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "obsidian-autocorrect-e2e-"));
	const vault = path.join(root, "vault");
	const pluginDir = path.join(vault, ".obsidian", "plugins", PLUGIN_ID);
	const notePath = path.join(vault, "Autocorrect E2E.md");
	const repoRoot = path.resolve(__dirname, "..");

	await mkdir(pluginDir, { recursive: true });
	await cp(path.join(repoRoot, "main.js"), path.join(pluginDir, "main.js"));
	await cp(path.join(repoRoot, "manifest.json"), path.join(pluginDir, "manifest.json"));
	await cp(path.join(repoRoot, "styles.css"), path.join(pluginDir, "styles.css"));
	await writeFile(notePath, "teh quick brown fox", "utf8");
	await writeFile(
		path.join(vault, ".obsidian", "community-plugins.json"),
		JSON.stringify([PLUGIN_ID]),
		"utf8"
	);
	await writeFile(
		path.join(pluginDir, "data.json"),
		JSON.stringify({
			api_key: "test-key",
			automatic_correction: false,
			correct_on_enter: false,
			status_notices: false,
			model: "openai/gpt-oss-120b",
		}),
		"utf8"
	);

	const app = await electron.launch({
		executablePath: process.env.OBSIDIAN_PATH,
		args: [vault, "--no-sandbox", "--disable-gpu"],
		env: {
			...process.env,
			XDG_CONFIG_HOME: path.join(root, "xdg-config"),
		},
	});

	try {
		const page = await app.firstWindow();
		await page.route("https://api.groq.com/**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									corrected: "the quick brown fox",
								}),
							},
						},
					],
				}),
			});
		});

		await page.waitForFunction(
			(id) => Boolean(window.app?.plugins?.plugins?.[id]),
			PLUGIN_ID
		);

		await page.evaluate(async ({ commandId }) => {
			const file = window.app.vault.getAbstractFileByPath("Autocorrect E2E.md");
			if (!file) {
				throw new Error("E2E note was not found in the test vault.");
			}

			const leaf = window.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			const editor = window.app.workspace.activeEditor?.editor;
			if (!editor) {
				throw new Error("No active Markdown editor is available.");
			}

			editor.setCursor({ line: 0, ch: editor.getLine(0).length });
			await window.app.commands.executeCommandById(commandId);
		}, { commandId: COMMAND_ID });

		await expect
			.poll(async () =>
				page.evaluate(() => window.app.workspace.activeEditor?.editor?.getLine(0))
			)
			.toBe("the quick brown fox");
	} finally {
		await app.close();
		await rm(root, { recursive: true, force: true });
	}
});
