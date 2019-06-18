/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, InitializeParams } from 'vscode-languageclient';
import { Trace } from 'vscode-jsonrpc';

interface CompletionAccumulator {
	(line: string): vscode.CompletionItem;
}

function readFileInto(filePath: string, target: vscode.CompletionItem[], accumulator: CompletionAccumulator) {
	if (fs.existsSync(filePath)) {
		fs.readFile(filePath, (err, data) => {
			var kw = data.toString();
			var lines = kw.split("\n");
			lines.filter(x => !(x.startsWith("//") || x.trimRight() === "")).forEach(line => {
				target.push(accumulator(line));
			});
		});
	} else {
		console.warn("No file at " + filePath);
	}
}

class Entry {
	name: string = "";
	detail: string = "";
	desc: string = "";
}
class Method extends Entry {
	params: string[] = [];
	source: string = "internal";
	sourceLine: number = -1;
	nameUpper = "";
}

interface ClassJson {
	name: string;
	methods: Method[];
	fields: Entry[];
}

export function activate(context: vscode.ExtensionContext) {
	var keywordCompletions: vscode.CompletionItem[] = [];
	var methodCompletions: vscode.CompletionItem[] = [];
	var constantCompletions: vscode.CompletionItem[] = [];
	var variableCompletions: vscode.CompletionItem[] = [];

	var keywordsPath = path.join(context.extensionPath, "completion", "keywords.csv")
	var constantsPath = path.join(context.extensionPath, "completion", "constants.csv")
	var variablesPath = path.join(context.extensionPath, "completion", "variables.csv")
	var completionsPath = path.join(context.extensionPath, "completion").toUpperCase();

	let methodInfos: Method[] = [];
	let classInfos: ClassJson[] = [];
	let globalVariables: Map<string, ClassJson> = new Map<string, ClassJson>();

	const workSpace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath.toUpperCase() : undefined;
	let watcher = vscode.workspace.createFileSystemWatcher("**/*.*", true);

	watcher.onDidChange(_ => {
		const ext = path.extname(_.fsPath).toUpperCase();
		if (ext !== "D" && ext !== "SRC") return;
		console.log("file changed: " + vscode.workspace.asRelativePath(_.fsPath))
		init();
	});
	watcher.onDidDelete(_ => {
		const ext = path.extname(_.fsPath).toUpperCase();
		if (ext !== "D" && ext !== "SRC") return;
		init();
	});
	function makeRelative(f: string) {
		return vscode.workspace.asRelativePath(f);
	}
	function parseMethodsSingle(file: string, methodStore: Method[], methodCompletionsStore: vscode.CompletionItem[]) {
		fs.readFile(file, (err, buf) => {
			if (err) {
				console.log(err);
				return;
			}
			let content = buf.toString();
			let rxFuncs = new RegExp(/^(?: |\t)*func\s+(\w+\s+([\w@^]+)\s*\((?:.|\s)*?\))(?:\s*\/\/(.*))?/igm);
			const meths: Method[] = [];
			let match = rxFuncs.exec(content);
			while (match !== null) {
				let m = new Method();
				if (match.length > 1) {
					// Normal
					m.name = match[2];
					m.detail = match[1].replace(/\s+/g, " ").replace(" )", ")").replace("( ", "(");
					m.source = makeRelative(file);
					let line = 0;
					for (let i = 0; i < match.index; i++) {
						if (content[i] === "\n") line++;
					}
					m.sourceLine = line;
					m.nameUpper = m.name.toUpperCase();
					// Kommentar
					m.desc = match[3] || "";
					prepareMethod(m);
					meths.push(m);
				}
				match = rxFuncs.exec(content);
			}
			meths.forEach(m => {
				if (methodStore.find(x => x.nameUpper === m.nameUpper) === undefined) {
					let completionItem = new vscode.CompletionItem(m.name.trim(), vscode.CompletionItemKind.Method);
					completionItem.documentation = "Source: " + m.source + "\n\n" + m.desc;
					completionItem.detail = m.detail;

					methodCompletionsStore.push(completionItem);
					methodStore.push(m);
				}
			})
		})
	}
	function parseMethodsGlobb(path: string, methodStore: Method[], methodCompletionsStore: vscode.CompletionItem[]) {
		glob(path, (err, files) => {
			if (err) {
				console.error(err);
				return;
			}
			files.forEach(f => parseMethodsSingle(f, methodStore, methodCompletionsStore))
		});
	}
	function readMethods(file: string, methodStore: Method[], methodCompletionsStore: vscode.CompletionItem[]) {
		fs.readFile(file, (err, buf) => {
			if (err) {
				console.error(err);
				return;
			}
			const meths: Method[] = JSON.parse(buf.toString());
			meths.forEach(m => {
				if (!m.source || m.source.trim().length === 0) {
					m.source = "internal";
					let baseName = path.basename(file).split(".");
					if (baseName.length > 2) {
						m.source = baseName[0];
					}
				}
				prepareMethod(m);

				let completionItem = new vscode.CompletionItem(m.name.trim(), vscode.CompletionItemKind.Method);
				completionItem.documentation = "Source: " + m.source + "\n\n" + m.desc;
				completionItem.detail = m.detail;

				methodCompletionsStore.push(completionItem);
				methodStore.push(m);
			})
			meths.forEach(m => m.nameUpper = m.name.toUpperCase());
		})
	}

	function readClasses(file: string, classStore: ClassJson[]) {
		fs.readFile(file, (err, buf) => {
			if (err) {
				console.error(err);
				return;
			}
			const classes: ClassJson[] = JSON.parse(buf.toString());
			classes.forEach(c => {
				if (c.methods) {
					c.methods.forEach(m => {
						if (!m.source || m.source.trim().length === 0) {
							m.source = "internal";
							let baseName = path.basename(file).split(".");
							if (baseName.length > 2) {
								m.source = baseName[0];
							}
						}
						prepareMethod(m);
					})
				}
				classStore.push(c);
			})
		})
	}

	function parseSource(f: string) {
		let baseDir = path.dirname(f);
		console.log("Parsing " + baseDir + "/" + path.basename(f));
		fs.readFile(f, (err, buf) => {
			if (err) {
				console.log("Error parsing " + f);
				console.log(err);
				return;
			}
			let body = buf.toString();
			body = body.replace("\r\n", "\n");
			let lines = body.split("\n");

			lines.forEach(l => {
				l = l.trim();
				if (l.length === 0) return;
				let absPath = path.join(baseDir, l).toUpperCase();
				if (absPath.endsWith(".D")) {
					if (absPath.includes("*")) {
						// Parse multiple
						parseMethodsGlobb(absPath, methodInfos, methodCompletions);
					} else {
						// Parse single
						if (fs.existsSync(absPath)) {
							parseMethodsSingle(absPath, methodInfos, methodCompletions);
						}
					}
				} else if (absPath.endsWith(".SRC")) {
					if (absPath.includes("*")) {
						// Parse multiple
						glob(absPath, (err, files) => {
							if (err) {
								console.error(err);
								return;
							}
							files.forEach(parseSource);
						});
					} else {
						// Parse single
						parseSource(absPath);
					}
				}
			});
			console.info("Parsed " + path.basename(f));
		});
	}
	function parseGothicSrc(): boolean {
		if (workSpace) {
			fs.readdir(workSpace, (err, files) => {
				if (err) {
					console.error(err);
					return;
				}
				for (const f of files) {
					if (f.toUpperCase() === "GOTHIC.SRC") {
						parseSource(path.join(workSpace, f));
						return true;
					}
				}
			})
		}
		return false;
	}
	function init() {
		methodInfos = [];
		keywordCompletions = [];
		constantCompletions = [];
		variableCompletions = [];
		methodCompletions = [];

		readFileInto(keywordsPath, keywordCompletions, (line) => {
			var name = line;
			var desc = "";
			if (line.indexOf("@") > 0) {
				var split = line.split("@");
				name = split[0];
				desc = split[1].trimRight();
			}
			let completionItem = new vscode.CompletionItem(name.trim(), vscode.CompletionItemKind.Keyword);
			completionItem.documentation = desc;
			return completionItem;
		});

		fs.readdir(completionsPath, (err, files) => {
			if (err) {
				console.error(err);
				return;
			}
			files.forEach(f => {
				if (f.endsWith("methods.json")) {
					const fullpath = path.join(completionsPath, f);
					readMethods(fullpath, methodInfos, methodCompletions);
				} else if (f.endsWith("classes.json")) {
					const fullpath = path.join(completionsPath, f);
					readClasses(fullpath, classInfos);
				}
			})
		})
		readFileInto(constantsPath, constantCompletions, (line) => {
			var name = line;
			var desc = "";
			if (line.indexOf("@") > 0) {
				var split = line.split("@");
				name = split[0];
				for (let i = 1; i < split.length; i++) {
					desc += split[i].trimRight();
					if (i + 1 < split.length) desc += "\n";
				}
			}
			let completionItem = new vscode.CompletionItem(name.trim(), vscode.CompletionItemKind.Constant);
			completionItem.documentation = desc;
			return completionItem;
		});
		readFileInto(variablesPath, variableCompletions, (line) => {
			var name = line;
			var desc = "";
			if (line.indexOf("@") > 0) {
				var split = line.split("@");
				name = split[0];
				for (let i = 1; i < split.length; i++) {
					desc += split[i].trimRight();
					if (i + 1 < split.length) desc += "\n";
				}
			}
			let completionItem = new vscode.CompletionItem(name.trim(), vscode.CompletionItemKind.Field);
			completionItem.documentation = desc;
			return completionItem;
		});

		if (!parseGothicSrc()) {
			console.log("no gothic.src found. Fall back to parse all .d")
			vscode.workspace.findFiles("**/*.{D,d}").then(files => {
				files.forEach(f => {
					parseMethodsSingle(f.fsPath, methodInfos, methodCompletions);
				})
			}, err => {
				console.error(err);
			});
		}
	}
	init();

	const globalProvider = vscode.languages.registerCompletionItemProvider('daedalus', {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
			// return all completion items as array
			return keywordCompletions.concat(methodCompletions).concat(constantCompletions).concat(variableCompletions);
		}
	});
	const signatureProvider = vscode.languages.registerSignatureHelpProvider('daedalus', {
		provideSignatureHelp(document, position, token, context): vscode.ProviderResult<vscode.SignatureHelp> {
			var sig = new vscode.SignatureHelp();
			let linePrefix = document.lineAt(position).text.substr(0, position.character);
			linePrefix = linePrefix.replace(/(?<=\(|,\s*)[\w.]*\(.*?\)/g, "C"); // Replaces Methodcalls with "C"
			if (/^\s*func\s+/i.test(linePrefix)) return undefined;

			const match = /(\w+)\s*\(.*$/.exec(linePrefix);

			if (match !== null) {
				const lineFrom = match[0].lastIndexOf('(')
				const sigCtx = match[0].substring(lineFrom + 1);
				const compareText = match![1].toUpperCase();
				const found = methodInfos.find(x => x.nameUpper === compareText);
				if (found) {
					let info = new vscode.SignatureInformation(found.detail, found.desc);
					sig.activeSignature = 0;
					sig.activeParameter = 0;
					if (found.params) {
						info.parameters = found.params.map(x => new vscode.ParameterInformation(x));
						sig.signatures.push(info);

						if (sigCtx.indexOf(",") >= 0) {
							sig.activeParameter = sigCtx.split(",").length - 1;
						}
					}
					return sig;
				}
			}
			return undefined;
		}
	}, '(', ',');

	const hoverProvider = vscode.languages.registerHoverProvider('daedalus', {
		provideHover(document, position, token): vscode.ProviderResult<vscode.Hover> {
			let range = document.getWordRangeAtPosition(position);
			if (range) {
				let linePrefix = document.getText(range);
				let found = methodInfos.find(x => x.name === linePrefix);
				if (found) {
					return new vscode.Hover(new vscode.MarkdownString("```\n" + found.detail + "\n```"));
				}
			}
			return undefined;
		}
	});

	const dotProvider = vscode.languages.registerCompletionItemProvider('daedalus', {
		provideCompletionItems(document, position) {
			// TODO: Implement
			return undefined;
		}
	}, '.' /* triggered whenever a '.' is being typed */);

	const goToDefProvider = vscode.languages.registerDefinitionProvider('daedalus', {
		provideDefinition(document, position, token) {
			let range = document.getWordRangeAtPosition(position);
			if (range) {
				let linePrefix = document.getText(range);
				let found = methodInfos.find(x => x.name === linePrefix);
				if (found && found.source !== "internal") {
					if (vscode.workspace.workspaceFolders) {
						let fullPath = path.resolve(vscode.workspace.workspaceFolders[0].uri.fsPath, found.source);
						let uri = vscode.Uri.file(fullPath);
						return new vscode.Location(
							uri,
							new vscode.Position(found.sourceLine, 0)
						);
					}
				}
			}
			return undefined;
		}
	});

	let serverExe = 'dotnet';

	let serverOptions: ServerOptions = {
		run: { command: serverExe, args: [path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer.dll')] },
		debug: { command: serverExe, args: [path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer.dll')] }
	}

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [
			{ pattern: '**/*.d', },
			{ pattern: '**/*.D', }
		],
		synchronize: {
			// Synchronize the setting section 'languageServerExample' to the server
			configurationSection: 'languageServer',
			fileEvents: vscode.workspace.createFileSystemWatcher('**/*.d')
		},
	}

	// Create the language client and start the client.
	const client = new LanguageClient('languageServer', 'Language Server', serverOptions, clientOptions);
	client.trace = Trace.Verbose;
	let languageServerClient = client.start();

	context.subscriptions.push(
		globalProvider,
		goToDefProvider,
		signatureProvider,
		hoverProvider,
		watcher,
		languageServerClient,
	);
}

function prepareMethod(m: Method) {
	if (m.detail && m.detail.length > 2) {
		let start = m.detail.indexOf("(");
		let end = m.detail.indexOf(")");
		let params = m.detail.substring(start + 1, end).trim();
		m.nameUpper = m.name.toUpperCase();
		m.params = [];
		if (params.includes(",")) {
			params.split(',')
				.map(x => x.trim())
				.filter(x => x !== "")
				.forEach(c => {
					m.params.push(c.trim());
				});
		}
		else if (params.length > 0) {
			m.params.push(params);
		}
	}
}
