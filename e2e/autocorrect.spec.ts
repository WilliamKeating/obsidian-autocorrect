import { Browser, chromium, expect, test } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import http from "http";
import os from "os";
import path from "path";

const PLUGIN_ID = "obsidian-autocorrect";
const COMMAND_ID = `${PLUGIN_ID}:autocorrect-current-line`;

test.skip(
	!process.env.OBSIDIAN_PATH,
	"Set OBSIDIAN_PATH to an Obsidian desktop executable to run E2E tests."
);

test("manual command corrects a note through Obsidian", async () => {
	test.setTimeout(120_000);

	const root = await mkdtemp(path.join(os.tmpdir(), "obsidian-autocorrect-e2e-"));
	const vault = path.join(root, "vault");
	const pluginDir = path.join(vault, ".obsidian", "plugins", PLUGIN_ID);
	const notePath = path.join(vault, "Autocorrect E2E.md");
	const repoRoot = path.resolve(__dirname, "..");
	const remoteDebuggingPort = 9222;
	let obsidian: ChildProcessWithoutNullStreams | null = null;
	let browser: Browser | null = null;

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

	try {
		console.log("Launching Obsidian test process");
		obsidian = spawn(process.env.OBSIDIAN_PATH as string, [
			vault,
			`--remote-debugging-port=${remoteDebuggingPort}`,
			"--no-sandbox",
			"--disable-gpu",
		], {
			detached: true,
			env: {
				...process.env,
				XDG_CONFIG_HOME: path.join(root, "xdg-config"),
			},
		});
		obsidian.stdout.on("data", (data) => process.stdout.write(data));
		obsidian.stderr.on("data", (data) => process.stderr.write(data));

		await waitForCdp(remoteDebuggingPort);
		console.log("Connected to Obsidian CDP endpoint");
		browser = await chromium.connectOverCDP(
			`http://127.0.0.1:${remoteDebuggingPort}`
		);
		const context = browser.contexts()[0] ?? (await browser.newContext());
		const page = context.pages()[0] ?? (await context.waitForEvent("page"));

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
		console.log("Plugin loaded");

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
		console.log("Command executed");

		await expect
			.poll(async () =>
				page.evaluate(() => window.app.workspace.activeEditor?.editor?.getLine(0))
			)
			.toBe("the quick brown fox");

		console.log("Editor text corrected");
	} finally {
		if (browser) {
			await browser.close().catch(() => undefined);
		}
		if (obsidian?.pid) {
			try {
				process.kill(-obsidian.pid, "SIGKILL");
			} catch {
				obsidian.kill("SIGKILL");
			}
		} else if (obsidian && !obsidian.killed) {
			obsidian.kill("SIGKILL");
		}
		await rm(root, { recursive: true, force: true });
	}
});

function waitForCdp(port: number): Promise<void> {
	const deadline = Date.now() + 45_000;

	return new Promise((resolve, reject) => {
		const check = () => {
			const request = http.get(
				`http://127.0.0.1:${port}/json/version`,
				(response) => {
					response.resume();
					if (response.statusCode === 200) {
						resolve();
						return;
					}
					retry();
				}
			);

			request.on("error", retry);
			request.setTimeout(1000, () => {
				request.destroy();
				retry();
			});
		};

		const retry = () => {
			if (Date.now() > deadline) {
				reject(new Error("Timed out waiting for Obsidian CDP endpoint."));
				return;
			}
			setTimeout(check, 500);
		};

		check();
	});
}
