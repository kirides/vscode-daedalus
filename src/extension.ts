/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ServerOptions, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/lib/node/main'
import { Trace } from 'vscode-jsonrpc';
import { stringify } from 'querystring';
import { log } from 'console';
import { exec, execFileSync } from 'child_process';

const LANGUAGE: string = "daedalus";
interface Dictionary<T> {
    [Key: string]: T;
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
	}

	// Create the language client and start the client.
	const client = new LanguageClient('daedalusLanguageServer', 'Daedalus Language Server', serverOptions, clientOptions);
	
	client.setTrace(Trace.Verbose);
	client.start();

	context.subscriptions.push(
		client,
	);
}
