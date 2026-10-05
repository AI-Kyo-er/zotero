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
			screenX: event.screenX, screenY: event.screenY, isPrimary: event.isPrimary,
			pressure: event.pressure, buttons: event.buttons, detail: event.detail,
			trusted: event.isTrusted
		});
		let actionState = () => ({
			action: view.action?.type || null, pointerId: view.action?.pointerId,
			start: view.action?.annotation?.position.paths?.[0]?.slice(0, 2),
			end: view.action?.annotation?.position.paths?.[0]?.slice(-2),
			lastEventType: view.action?.lastEvent?.type,
			pointerDownTriggered: view._pointerDownTriggered,
			tool: view._tool.type, pressureEnabled: view._tool.pressure,
			currentPathLength: view.action?.annotation?.position.paths?.[0]?.length,
			savedInkPaths: view._annotations.filter(annotation => annotation.type === 'ink')
				.reduce((count, annotation) => count + annotation.position.paths.length, 0)
		});
		// F8 marks a visibly missed stroke without recording document contents.
		win.addEventListener('keydown', (event) => {
			if (event.key !== 'F8' || event.repeat) return;
			event.preventDefault();
			win.__penInputTrace.push({
				type: 'missed-stroke-marker', time: event.timeStamp,
				captureState: actionState()
			});
		}, true);
		for (let type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'mousedown', 'mouseup']) {
			win.addEventListener(type, (event) => {
				let entry = sample(event);
				// The view's pointerdown capture listener runs before this listener;
				// this is a capture-phase snapshot, not always a pre-handler state.
				entry.captureState = actionState();
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
				entry.after = actionState();
			});
		}
		win.addEventListener('error', (event) => {
			win.__penInputTrace.push({ type: 'input-error', time: event.timeStamp,
				message: String(event.message), captureState: actionState() });
		});
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
			let inputPreferences = {};
			for (let name of ['dom.w3c_pointer_events.scroll_by_pen.enabled', 'dom.w3c_pointer_events.dispatch_by_pointer_messages']) {
				inputPreferences[name] = Services.prefs.getBoolPref(name);
			}
			let snapshot = JSON.stringify({ schema: 2, version: Zotero.version, capturedAt: new Date().toISOString(), inputPreferences, readers: [...traces.values()] }, null, 2);
			// Antivirus/indexing can briefly hold even a session-specific file.
			// Awaiting the delay leaves input handling responsive; retries reuse
			// the same snapshot instead of dropping the current event buffer.
			for (let attempt = 0; ; attempt++) {
				try {
					await IOUtils.writeUTF8(config.output, snapshot, { tmpPath: config.output + '.tmp' });
					break;
				}
				catch (error) {
					if (attempt >= 5 || !String(error).includes('NS_ERROR_FILE_IS_LOCKED')) throw error;
					await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
				}
			}
		}
		finally {
			writing = false;
		}
	};
	if (Zotero.__penRecordInterval) clearInterval(Zotero.__penRecordInterval);
	await writeTrace();
	Zotero.__penRecordFlush = writeTrace;
	Zotero.__penRecordInterval = setInterval(() => writeTrace().catch(error => Zotero.logError(error)), 1000);
	Zotero.__penRecordState = { status: 'passed', output: config.output };
})().catch((error) => {
	Zotero.__penRecordState = { status: 'failed', error: String(error), stack: error.stack };
});
// eslint-disable-next-line no-unused-expressions -- Return a status message to the debugger evaluation.
'Installing isolated pen input recording';
