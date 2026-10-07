import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function recordingConfig(dataDir) {
	let root = fs.realpathSync('.');
	// Keep each recording outside cloud-watched project directories. Never
	// truncate an earlier session's evidence when installing the recorder.
	let sessionDir = path.join(os.tmpdir(), 'zotero-pen-recordings', randomUUID());
	fs.mkdirSync(sessionDir, { recursive: true });
	let config = { root, dataDir: fs.realpathSync(dataDir),
		output: path.join(sessionDir, 'pen-input-events.json') };
	fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify({
		...config, createdAt: new Date().toISOString()
	}, null, 2));
	return config;
}

let socket;
for (let attempt = 0; attempt < 40; attempt++) {
	try {
		socket = await new Promise((resolve, reject) => {
			let candidate = net.connect(11192, '127.0.0.1');
			candidate.once('connect', () => resolve(candidate));
			candidate.once('error', reject);
		});
		break;
	}
	catch (error) {
		if (attempt === 39) throw error;
		await new Promise(resolve => setTimeout(resolve, 500));
	}
}
let buffer = Buffer.alloc(0);
let pending = [];
let packets = [];
socket.on('data', (data) => {
	buffer = Buffer.concat([buffer, data]);
	while (true) {
		let colon = buffer.indexOf(58);
		if (colon < 0) break;
		let length = Number(buffer.subarray(0, colon).toString());
		if (buffer.length < colon + 1 + length) break;
		let packet = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length));
		buffer = buffer.subarray(colon + 1 + length);
		let index = pending.findIndex(waiter => waiter.matches(packet));
		if (index >= 0) {
			let [waiter] = pending.splice(index, 1);
			clearTimeout(waiter.timer);
			waiter.resolve(packet);
		}
		else packets.push(packet);
	}
});
function next(matches) {
	let index = packets.findIndex(matches);
	if (index >= 0) return Promise.resolve(packets.splice(index, 1)[0]);
	return new Promise((resolve, reject) => {
		let waiter = { matches, resolve, timer: setTimeout(() => reject(new Error('RDP timeout')), 30000) };
		pending.push(waiter);
	});
}
function send(packet) {
	let body = Buffer.from(JSON.stringify(packet));
	socket.write(Buffer.concat([Buffer.from(body.length + ':'), body]));
}
async function request(to, type, params = {}) {
	let result = next(packet => packet.from === to && !['consoleAPICall', 'pageError', 'evaluationResult'].includes(packet.type));
	send({ to, type, ...params });
	return result;
}
await next(packet => packet.from === 'root');
let process = await request('root', 'getProcess', { id: 0 });
let consoleActor = process.form?.consoleActor || process.process?.consoleActor;
if (!consoleActor && process.processDescriptor?.actor) {
	let target = await request(process.processDescriptor.actor, 'getTarget');
	consoleActor = target.process?.consoleActor || target.target?.consoleActor;
}
if (!consoleActor) throw new Error('No process console actor');
// global process above is the RDP packet, so use the CLI argument via import.
let args = (await import('node:process')).argv;
let integrationTest = ['runtime-test.js', 'runtime-restart-test.js'].some(name => args[2]?.endsWith(name));
let runtimeDirectory = args.find(arg => arg.startsWith('--runtime-dir='))?.slice('--runtime-dir='.length);
let runtimeDataDir = integrationTest
	? fs.realpathSync(runtimeDirectory ? path.join(runtimeDirectory, 'runtime-data') : 'work/runtime-data')
	: undefined;
let expression = args[2] ? fs.readFileSync(args[2], 'utf8') : 'JSON.stringify({zotero:typeof Zotero, services:typeof Services})';
if (integrationTest) {
	let config = { root: fs.realpathSync('.'), dataDir: runtimeDataDir,
		fineInput: args.includes('--native-fine'),
		inkSize: Number(args.find(arg => arg.startsWith('--ink-size='))?.split('=')[1] || 2) };
	expression = `Zotero.__penTestConfig = ${JSON.stringify(config)};\n` + expression;
}
if (args[2]?.endsWith('record-input.js')) {
	let dataDir = args[3] ? fs.realpathSync(args[3]) : fs.realpathSync('pen-data');
	let config = recordingConfig(dataDir);
	expression = `Zotero.__penRecordConfig = ${JSON.stringify(config)};\n` + expression;
}
async function evaluate(text) {
	let immediate = await request(consoleActor, 'evaluateJSAsync', { text });
	return next(packet => packet.type === 'evaluationResult' && packet.resultID === immediate.resultID);
}
if (args[2]?.endsWith('runtime-test.js') && args.includes('--record')) {
	let config = recordingConfig(runtimeDataDir);
	let recording = `Zotero.__penRecordConfig = ${JSON.stringify(config)};\n` + fs.readFileSync('scripts/pen/record-input.js', 'utf8');
	await evaluate(recording);
}
let evaluated = await evaluate(expression);
console.log(JSON.stringify({ result: evaluated.result, exception: evaluated.exceptionMessage }));
if (integrationTest || args[2]?.endsWith('runtime-export.js') || args[2]?.endsWith('record-input.js')) {
	let finished = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		await new Promise(resolve => setTimeout(resolve, 500));
		let state = await evaluate(args[2].endsWith('record-input.js')
			? 'JSON.stringify(Zotero.__penRecordState)'
			: 'JSON.stringify(Zotero.__penTestResult)');
		if (typeof state.result === 'string') {
			let result = JSON.parse(state.result);
			if (result.status !== 'running') {
				console.log(JSON.stringify({ status: result.status, checks: result.results?.map(item => ({ name: item.name, passed: item.passed })), output: result.output, error: result.error, stack: result.stack }, null, 2));
				if (!args[2].endsWith('record-input.js')) {
					let output = args[2].endsWith('runtime-restart-test.js') ? 'work/runtime-restart-results.json' : 'work/runtime-results.json';
					fs.writeFileSync(output, JSON.stringify(result, null, 2));
				}
				finished = true;
				if (result.status !== 'passed') (await import('node:process')).default.exitCode = 1;
				if (integrationTest && result.status === 'passed') {
					let dataDir = runtimeDataDir;
					await evaluate(`if (Zotero.DataDirectory.dir !== ${JSON.stringify(dataDir)}) throw new Error('Refusing to close a personal library'); setTimeout(() => Zotero.Utilities.Internal.quit(), 200); 'Closing isolated test normally'`);
				}
				break;
			}
		}
	}
	if (!finished) throw new Error('Runtime test did not complete within 50 seconds');
}
socket.end();
