/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

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
	nameUpper = "";
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

	let methods: Method[] = [];
	
	const workSpace = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath.toUpperCase() : undefined;
	let watcher = vscode.workspace.createFileSystemWatcher("**/*.*", true);
	watcher.onDidChange(_ => {
		if (_.fsPath.includes("node_modules")) return;
		init();
	});
	watcher.onDidDelete(_ => {
		if (_.fsPath.includes("node_modules")) return;
		init();
	});
	function makeRelative(f: string) {
		if (workSpace && f.includes(workSpace)) {
			return path.relative(workSpace, f);
		} else if (f.includes(completionsPath)) {
			return path.relative(completionsPath, f);
		}
		return f;
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
					m.nameUpper = m.name.toUpperCase();
					// Kommentar
					m.desc = match[3] || "";
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
				if (m.detail && m.detail.length > 2) {
					let start = m.detail.indexOf("(");
					let end = m.detail.indexOf(")");
					let params = m.detail.substring(start + 1, end).trim();
					m.params = [];
					if (params.includes(",")) {
						params.split(',')
							.map(x => x.trim())
							.filter(x => x !== "")
							.forEach(c => {
								m.params.push(c.trim());
							})
					} else if (params.length > 0) {
						m.params.push(params);
					}
				}

				let completionItem = new vscode.CompletionItem(m.name.trim(), vscode.CompletionItemKind.Method);
				completionItem.documentation = "Source: " + m.source + "\n\n" + m.desc;
				completionItem.detail = m.detail;

				methodCompletionsStore.push(completionItem);
				methodStore.push(m);
			})
			meths.forEach(m => m.nameUpper = m.name.toUpperCase());
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
						parseMethodsGlobb(absPath, methods, methodCompletions);
					} else {
						// Parse single
						if (fs.existsSync(absPath)) {
							parseMethodsSingle(absPath, methods, methodCompletions);
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
	function parseGothicSrc() {
		if (workSpace) {
			fs.readdir(workSpace, (err, files) => {
				if (err) {
					console.error(err);
					return;
				}
				for (const f of files) {
					if (f.toUpperCase() === "GOTHIC.SRC") {
						parseSource(path.join(workSpace, f));
						return;
					}
				}
			})
		}
	}
	function init() {
		methods = [];
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
					readMethods(fullpath, methods, methodCompletions);
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

		parseGothicSrc();
	}
	init();

	const globalProvider = vscode.languages.registerCompletionItemProvider('daedalus', {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {
			// return all completion items as array
			return keywordCompletions.concat(methodCompletions).concat(constantCompletions).concat(variableCompletions).sort((a, b) => {
				if (a.label > b.label) {
					return 1;
				} else if (a.label < b.label) {
					return -1;
				}
				return 0;
			});
		}
	});
	const signatureProvider = vscode.languages.registerSignatureHelpProvider('daedalus', {
		provideSignatureHelp(document, position, token, context): vscode.ProviderResult<vscode.SignatureHelp> {
			var sig = new vscode.SignatureHelp();
			let linePrefix = document.lineAt(position).text.substr(0, position.character);
			linePrefix = linePrefix.replace(/(?<=\(|,\s*)[\w.]+\(.*?\)/g, "C"); // Replaces Methodcalls with "C"
			if (/^\s*func\s+/i.test(linePrefix)) return undefined;

			const match = /(\w+)\s*\(.*$/.exec(linePrefix);

			if (match !== null) {
				const lineFrom = match[0].lastIndexOf('(')
				const sigCtx = match[0].substring(lineFrom + 1);
				const compareText = match![1].toUpperCase();
				const found = methods.find(x => x.nameUpper === compareText);
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
				let found = methods.find(x => x.name === linePrefix);
				if (found) {
					return new vscode.Hover(new vscode.MarkdownString("```\n" + found.detail + "\n```"));
				}
			}
			return undefined;
		}
	});

	const dotProvider = vscode.languages.registerCompletionItemProvider('daedalus', {
		provideCompletionItems(document, position) {
			// get all text until the `position` and check if it reads `console.`
			// and iff so then complete if `log`, `warn`, and `error`
			let linePrefix = document.lineAt(position).text.substr(0, position.character);
			if (!linePrefix.endsWith('console.')) {
				return undefined;
			}

			return [
				new vscode.CompletionItem('log', vscode.CompletionItemKind.Method),
				new vscode.CompletionItem('warn', vscode.CompletionItemKind.Method),
				new vscode.CompletionItem('error', vscode.CompletionItemKind.Method),
			];
		}
	},
		'.' // triggered whenever a '.' is being typed
	);

	context.subscriptions.push(globalProvider, dotProvider, signatureProvider, hoverProvider);
}