import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

let source = fs.readFileSync(new URL('./record-input.js', import.meta.url), 'utf8');

async function install(write, dataDir = 'isolated-test-data', readers = []) {
	let calls = [];
	let intervals = [];
	let delays = [];
	let Zotero = {
		initializationPromise: Promise.resolve(), uiReadyPromise: Promise.resolve(),
		__penRecordConfig: { dataDir, output: 'session/pen-input-events.json' },
		DataDirectory: { dir: 'isolated-test-data' }, Reader: { _readers: readers },
		version: '10.0.5', logError: (error) => {
			throw error;
		}
	};
	vm.runInNewContext(source, {
		Zotero, Services: { prefs: { getBoolPref: () => false, getStringPref: () => '0.1' } },
		IOUtils: { writeUTF8: async (...args) => {
			calls.push(args);
			await write(...args);
		} },
		setTimeout: (callback, delay) => {
			delays.push(delay);
			queueMicrotask(callback);
		},
		setInterval: (callback) => {
			intervals.push(callback);
			return 1;
		},
		clearInterval: () => {}
	});
	for (let attempt = 0; attempt < 100; attempt++) {
		await new Promise(resolve => setImmediate(resolve));
		if (Zotero.__penRecordState.status !== 'running') return { Zotero, calls, intervals, delays };
	}
	throw new Error('Recorder did not finish initializing');
}

test('transient file locks recover without losing the initial snapshot', async () => {
	let attempts = 0;
	let result = await install(async () => {
		if (++attempts <= 2) throw new Error('NotAllowedError: NS_ERROR_FILE_IS_LOCKED');
	});
	assert.equal(result.Zotero.__penRecordState.status, 'passed');
	assert.equal(result.calls.length, 3);
	assert.deepEqual(result.delays, [100, 200]);
	assert.equal(result.calls[0][1], result.calls[2][1]);
	let snapshot = JSON.parse(result.calls[2][1]);
	assert.equal(snapshot.schema, 2);
	assert.equal(snapshot.version, '10.0.5');
	assert.equal(result.calls[2][2].tmpPath, 'session/pen-input-events.json.tmp');
	assert.equal(result.intervals.length, 1);
});

test('recording keeps listeners installed but defers serialization until ink is idle', async () => {
	let busy = true;
	let installed = false;
	let serialized = false;
	let reader = {
		type: 'pdf', _internalReader: { _primaryView: { initializedPromise: Promise.resolve() } },
		_iframeWindow: { wrappedJSObject: { eval: (expression) => {
			if (expression.includes('function install')) {
				installed = true;
				return null;
			}
			if (expression.includes('return view.action')) return busy;
			serialized = true;
			if (expression.includes('__penInputTrace')) return '[]';
			if (expression.includes('__penInputCapabilities')) return '{}';
			throw new Error('Unexpected reader evaluation');
		} } }
	};
	let result = await install(async () => {}, 'isolated-test-data', [reader]);
	assert.equal(result.Zotero.__penRecordState.status, 'passed');
	assert.equal(installed, true);
	assert.equal(serialized, false);
	assert.equal(result.calls.length, 0);
	busy = false;
	await result.Zotero.__penRecordFlush();
	assert.equal(serialized, true);
	assert.equal(result.calls.length, 1);
	assert.equal(JSON.parse(result.calls[0][1]).readers.length, 1);
});

test('a permanent lock reports failure after bounded retries', async () => {
	let result = await install(async () => {
		throw new Error('NS_ERROR_FILE_IS_LOCKED');
	});
	assert.equal(result.Zotero.__penRecordState.status, 'failed');
	assert.equal(result.calls.length, 6);
	assert.equal(result.delays.length, 5);
	assert.equal(result.intervals.length, 0);
});

test('unrelated write failures are reported without lock retries', async () => {
	let result = await install(async () => {
		throw new Error('disk full');
	});
	assert.equal(result.Zotero.__penRecordState.status, 'failed');
	assert.match(result.Zotero.__penRecordState.error, /disk full/);
	assert.equal(result.calls.length, 1);
	assert.equal(result.delays.length, 0);
});

test('recording refuses a non-test library before attempting a write', async () => {
	let result = await install(async () => {}, 'personal-library');
	assert.equal(result.Zotero.__penRecordState.status, 'failed');
	assert.match(result.Zotero.__penRecordState.error, /outside the isolated test library/);
	assert.equal(result.calls.length, 0);
});
