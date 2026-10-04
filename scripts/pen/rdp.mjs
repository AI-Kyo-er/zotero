import net from 'node:net';
import fs from 'node:fs';

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
socket.on('data', data => {
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
let expression = args[2] ? fs.readFileSync(args[2], 'utf8') : 'JSON.stringify({zotero:typeof Zotero, services:typeof Services})';
if (args[2]?.endsWith('runtime-test.js')) {
	let config = { root: fs.realpathSync('.'), dataDir: fs.realpathSync('work/runtime-data') };
	expression = `Zotero.__penTestConfig = ${JSON.stringify(config)};\n` + expression;
}
async function evaluate(text) {
	let immediate = await request(consoleActor, 'evaluateJSAsync', { text });
	return next(packet => packet.type === 'evaluationResult' && packet.resultID === immediate.resultID);
}
let evaluated = await evaluate(expression);
console.log(JSON.stringify({ result: evaluated.result, exception: evaluated.exceptionMessage }));
if (args[2]?.endsWith('runtime-test.js') || args[2]?.endsWith('runtime-export.js')) {
	let finished = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		await new Promise(resolve => setTimeout(resolve, 500));
		let state = await evaluate('JSON.stringify(Zotero.__penTestResult)');
		if (typeof state.result === 'string') {
			let result = JSON.parse(state.result);
			if (result.status !== 'running') {
				console.log(JSON.stringify({ status: result.status, checks: result.results?.map(item => ({ name: item.name, passed: item.passed })), error: result.error, stack: result.stack }, null, 2));
				fs.writeFileSync('work/runtime-results.json', JSON.stringify(result, null, 2));
				finished = true;
				if (result.status !== 'passed') (await import('node:process')).default.exitCode = 1;
				break;
			}
		}
	}
	if (!finished) throw new Error('Runtime test did not complete within 50 seconds');
}
socket.end();
