# Obsidian Autocorrect

An Obsidian plug-in that autocorrects spelling errors. When the enter/return key is pressed the plugin will replace the previous line with the corrected text. This plugin requires a Together.ai API to function. It currently uses Mixtral-8x7B-Instruct-v0.1 for spelling correction. Considering this uses an LLM hallucinations may occasionally occur. While a smaller model could be used Mixtral is currently fairly affordable and I have found it follows directions better than other models. Together.ai is currently offering $25 in free credits which should allow you to use this plugin indefinitely. Mixtral is instructed to only correct spelling but minor punctuation errors are often also fixed.

## Contribution

Contributions are always welcome! If you have any ideas, suggestions, or found a bug, please open an issue on the GitHub repository. If you'd like to contribute code, please fork the repository and submit a pull request.

## License

Obsidian Autocorrect is licensed under the MIT License. See the [LICENSE](LICENSE) file for more details.
