/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check

// Keeps `dock.ps1` running apart from Orbit. The helper has to outlive Orbit's extensions for
// a moment (it is the one that brings the application's window back in front of the user when
// they go), and a program started by them the ordinary way is stopped with them. PowerShell
// cannot be started apart by itself: without a console or pipes of its own it leaves at once.
// So this small program is the one started apart, and PowerShell runs under it.
// Run with Orbit's own runtime: `dock-host.js <arguments of powershell.exe>`.
const child = require('child_process').spawn('powershell.exe', process.argv.slice(2), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.resume();
child.stderr.resume();
child.on('error', () => process.exit(1));
child.on('exit', code => process.exit(code ?? 0));
