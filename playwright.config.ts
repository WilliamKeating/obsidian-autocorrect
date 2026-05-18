import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 90_000,
	globalTimeout: 180_000,
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
});
