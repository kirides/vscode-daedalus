/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ServerOptions, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/lib/node/main'
import { Trace } from 'vscode-jsonrpc';
import { log } from 'console';
import { execFileSync } from 'child_process';

const LANGUAGE: string = "daedalus";
interface Dictionary<T> {
    [Key: string]: T;
}

function mapArgsToVscShowReferences(args : any[]) : (vscode.Location[] | vscode.Uri | vscode.Position)[] {
	const locations: vscode.Location[] = args[2]
		.map((l : any) => new vscode.Location(vscode.Uri.parse(l.uri), l.range));
	const typedArgs = [
		vscode.Uri.parse(args[0]), 
		new vscode.Position(args[1].line, args[1].character),
		locations
	];
	return typedArgs;
}
function mapLensFromLspToVscode(lens : vscode.CodeLens | null | undefined) : (vscode.CodeLens | null | undefined) {
	if (lens) {
		const args = lens.command?.arguments;
		if (args && lens.command) {
			if (lens.command.command === 'editor.action.showReferences') {
				lens.command.arguments = mapArgsToVscShowReferences(args)
			}
		}
	}
	return lens;
}

function updateFileEncoding() {
	const config = vscode.workspace.getConfiguration();
	const globalEncoding = config.inspect('daedalusLanguageServer.fileEncoding')?.globalValue;
	const workspaceEncoding = config.inspect('daedalusLanguageServer.fileEncoding')?.workspaceValue;

	if (workspaceEncoding !== undefined && workspaceEncoding !== globalEncoding) {
		const encoding = config.get<string>('daedalusLanguageServer.fileEncoding');
		if (!encoding) return;
		config.update(
			'[daedalus]',
			{ 'files.encoding': encoding.toLowerCase().replace('windows-', 'windows') },
			vscode.ConfigurationTarget.Workspace
		);
	} else {
		const encoding = config.get<string>('daedalusLanguageServer.fileEncoding');
		if (!encoding) return;
		config.update(
			'[daedalus]',
			{ 'files.encoding': encoding.toLowerCase().replace('windows-', 'windows') },
			vscode.ConfigurationTarget.Global
		);
	}
}


export function activate(context: vscode.ExtensionContext) {
	const lspPath = path.join(context.extensionPath, 'languageserver');
	
	const lookup : Dictionary<string> = {
		"linux-x32": 'DaedalusLanguageServer.x86',
		"linux-ia32": 'DaedalusLanguageServer.x86',
		"linux-x64": 'DaedalusLanguageServer.x64',

		"win32-x32": 'DaedalusLanguageServer.exe',
		"win32-ia32": 'DaedalusLanguageServer.exe',
		"win32-x64": 'DaedalusLanguageServer.exe',

		"darwin-x64": 'DaedalusLanguageServer_darwin.x64',
		"darwin-arm64": 'DaedalusLanguageServer_darwin.arm64',
	}
	const platform = os.platform();
	
	const executable = lookup[`${platform}-${process.arch}`];
	if (!executable) {
		log(`Unsupported OS/Arch combination: ${platform}/${process.arch}`)
		return;
	}

	let serverExe = path.join(lspPath, executable);

	if (platform != 'win32') {
		// mark server executable
		execFileSync('chmod', ['+x', serverExe]);
	}

	let serverOptions: ServerOptions = {
		run: { command: serverExe, args: ["-loglevel", "info"] },
		debug: { command: serverExe, args: ["-loglevel", "debug"] },
	}

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [
			{ language: LANGUAGE, },
			{ pattern: '**/*.d', },
			{ pattern: '**/*.D', }
		],
		synchronize: {
			configurationSection: 'daedalusLanguageServer',
		},
		middleware: {
			async provideCodeLenses(document, token, next) {
				const ret = await next(document, token);
				ret?.map(lens => mapLensFromLspToVscode(lens));
				return ret;
			},
			async resolveCodeLens(codeLens, token, next) {
				const lens = await next(codeLens, token);
				return mapLensFromLspToVscode(lens);
			},
		}
	}

	// Create the language client and start the client.
	const client = new LanguageClient('daedalusLanguageServer', 'Daedalus Language Server', serverOptions, clientOptions);
	client.setTrace(Trace.Verbose);
	client.start();

	context.subscriptions.push(
		client,
	);

	// Update file encoding and add listen for changes
	updateFileEncoding();
	vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('daedalusLanguageServer.fileEncoding')) {
			updateFileEncoding();
		}
	});
}
