Zotero.__penRecordState = { status: 'running' };
(async () => {
	await Zotero.initializationPromise;
	await Zotero.uiReadyPromise;
	let config = Zotero.__penRecordConfig;
	if (Zotero.DataDirectory.dir !== config.dataDir) {
		throw new Error('Refusing to record input outside the isolated test library');
	}
	function install() {
		let view = window._reader._primaryView;
		let win = view._iframeWindow;
		if (win.__penInputTrace) return;
		win.__penInputTrace = [];
		let entries = new WeakMap();
		let sample = event => ({
			type: event.type, time: event.timeStamp, pointerId: event.pointerId,
			pointerType: event.pointerType, x: event.clientX, y: event.clientY,
			pressure: event.pressure, buttons: event.buttons, detail: event.detail,
			trusted: event.isTrusted
		});
		for (let type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture', 'mousedown', 'mouseup']) {
			win.addEventListener(type, (event) => {
				let entry = sample(event);
				entries.set(event, entry);
				entry.coalesced = (event.getCoalescedEvents?.() || []).slice(0, 16).map(sample);
				win.__penInputTrace.push(entry);
				if (win.__penInputTrace.length > 6000) win.__penInputTrace.shift();
			}, true);
			// The view's bubble handlers were registered before this listener.
			// Capture the result before a subsequent contact can change it.
			win.addEventListener(type, (event) => {
				let entry = entries.get(event);
				if (!entry) return;
				let action = view.action;
				entry.after = {
					action: action?.type || null, pointerId: action?.pointerId,
					startTime: action?.startTime,
					start: action?.annotation?.position.paths?.[0]?.slice(0, 2),
					end: action?.annotation?.position.paths?.[0]?.slice(-2),
					pointerDownTriggered: view._pointerDownTriggered
				};
			});
		}
	}
	let writing = false;
	let traces = new Map();
	let writeTrace = async () => {
		if (writing) return;
		writing = true;
		try {
			for (let reader of Zotero.Reader._readers) {
				if (reader.type !== 'pdf' || !reader._internalReader?._primaryView?.initializedPromise) continue;
				await reader._internalReader._primaryView.initializedPromise;
				reader._iframeWindow.wrappedJSObject.eval(`(${install.toString()})()`);
				let events = JSON.parse(reader._iframeWindow.wrappedJSObject.eval('JSON.stringify(window._reader._primaryView._iframeWindow.__penInputTrace)'));
				traces.set(reader, { events });
				if (traces.size > 16) traces.delete(traces.keys().next().value);
			}
			await IOUtils.writeUTF8(config.output, JSON.stringify({ schema: 1, version: Zotero.version, capturedAt: new Date().toISOString(), readers: [...traces.values()] }, null, 2));
		}
		finally { writing = false; }
	};
	if (Zotero.__penRecordInterval) clearInterval(Zotero.__penRecordInterval);
	await writeTrace();
	Zotero.__penRecordFlush = writeTrace;
	Zotero.__penRecordInterval = setInterval(() => writeTrace().catch(error => Zotero.logError(error)), 1000);
	Zotero.__penRecordState = { status: 'passed', output: config.output };
})().catch(error => { Zotero.__penRecordState = { status: 'failed', error: String(error), stack: error.stack }; });
'Installing isolated pen input recording';
