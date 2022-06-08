/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { ServerOptions, LanguageClient, LanguageClientOptions } from 'vscode-languageclient/lib/node/main'
import { Trace } from 'vscode-jsonrpc';

const LANGUAGE: string = "daedalus";

export function activate(context: vscode.ExtensionContext) {
	const platform = os.platform();
	
	let serverExe = path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer');
	if (platform === 'win32') {
		serverExe = path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer.exe');
	} else if (platform === 'darwin') {
		serverExe = path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer_darwin');
	};

	if(os.hostname()) {
		var hostname = os.platform();
		if (hostname == 'win32') { // windows
			serverExe = path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer.exe');
		} else if (hostname == 'darwin') { // macOS 
			serverExe = path.join(context.extensionPath, 'languageserver', 'dls_darwin');
		} else if (hostname == 'linux') { // linux
			serverExe = path.join(context.extensionPath, 'languageserver', 'dls_linux');
		}
	}

	if(os.hostname()) {
		var hostname = os.platform();
		if (hostname == 'win32') { // windows
			serverExe = path.join(context.extensionPath, 'languageserver', 'DaedalusLanguageServer.exe');
		} else if (hostname == 'darwin') { // macOS 
			serverExe = path.join(context.extensionPath, 'languageserver', 'dls_darwin');
		} else if (hostname == 'linux') { // linux
			serverExe = path.join(context.extensionPath, 'languageserver', 'dls_linux');
		}
	}

	let serverOptions: ServerOptions = {
		run: { command: serverExe, args: ["-loglevel", "info"] },
		debug: { command: serverExe, args: ["-loglevel", "debug"] }
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
		}
	}

	// Create the language client and start the client.
	const client = new LanguageClient('languageServer', 'Language Server', serverOptions, clientOptions);
	client.trace = Trace.Verbose;
	let languageServerClient = client.start();

	context.subscriptions.push(
		languageServerClient,
	);
}
