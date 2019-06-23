/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient';
import { Trace } from 'vscode-jsonrpc';


export function activate(context: vscode.ExtensionContext) {
	let serverExe = path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer.exe');

	let serverOptions: ServerOptions = {
		run: { command: serverExe },
		debug: { command: serverExe }
	}

	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: [
			{ language: 'daedalus', },
			{ pattern: '**/*.d', },
			{ pattern: '**/*.D', }
		]
	}

	// Create the language client and start the client.
	const client = new LanguageClient('languageServer', 'Language Server', serverOptions, clientOptions);
	client.trace = Trace.Verbose;
	let languageServerClient = client.start();

	context.subscriptions.push(
		languageServerClient,
	);
}
