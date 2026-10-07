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
		win.__penInputCapabilities = {
			secureContext: win.isSecureContext,
			rawUpdates: 'onpointerrawupdate' in win,
			coalescedEvents: typeof win.PointerEvent.prototype.getCoalescedEvents === 'function'
		};
		let entries = new WeakMap();
		let append = (entry) => {
			win.__penInputTrace.push(entry);
			if (win.__penInputTrace.length > 12000) win.__penInputTrace.shift();
		};
		let sample = event => ({
			type: event.type, time: event.timeStamp, pointerId: event.pointerId,
			pointerType: event.pointerType, x: event.clientX, y: event.clientY,
			screenX: event.screenX, screenY: event.screenY, isPrimary: event.isPrimary,
			pressure: event.pressure, buttons: event.buttons, detail: event.detail,
			trusted: event.isTrusted
		});
		let actionState = (includeSavedPaths = true) => ({
			action: view.action?.type || null, pointerId: view.action?.pointerId,
			start: view.action?.annotation?.position.paths?.[0]?.slice(0, 2),
			end: view.action?.annotation?.position.paths?.[0]?.slice(-2),
			lastEventType: view.action?.lastEvent?.type,
			pointerDownTriggered: view._pointerDownTriggered,
			tool: view._tool.type, pressureEnabled: view._tool.pressure,
			smoothingEnabled: view._tool.smoothing,
			currentPathLength: view.action?.annotation?.position.paths?.[0]?.length,
			savedInkPaths: includeSavedPaths
				? view._annotations.filter(annotation => annotation.type === 'ink')
					.reduce((count, annotation) => count + annotation.position.paths.length, 0)
				: undefined
		});
		let render = view._render.bind(view);
		view._render = (...args) => {
			let start = win.performance.now();
			try {
				return render(...args);
			}
			finally {
				let durationMs = win.performance.now() - start;
				if (durationMs > 20) append({ type: 'render-delay', time: start,
					durationMs, captureState: actionState(false) });
			}
		};
		// F8 marks a visibly missed stroke without recording document contents.
		win.addEventListener('keydown', (event) => {
			if (event.key !== 'F8' || event.repeat) return;
			event.preventDefault();
			append({
				type: 'missed-stroke-marker', time: event.timeStamp,
				captureState: actionState()
			});
		}, true);
		let lastFrame;
		function frame(time) {
			if (!win.document.hidden && lastFrame !== undefined && time - lastFrame > 40) {
				append({ type: 'frame-gap', time, durationMs: time - lastFrame,
					captureState: actionState(false) });
			}
			lastFrame = win.document.hidden ? undefined : time;
			win.requestAnimationFrame(frame);
		}
		win.requestAnimationFrame(frame);
		for (let type of ['pointerdown', 'pointerrawupdate', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
			win.addEventListener(type, (event) => {
				// Hover/boundary and compatibility-mouse events dominated the old
				// buffer and evicted the contacts marked by the user.
				if (event.pointerType !== 'pen') return;
				win.__penLastInputTime = win.performance.now();
				if (type === 'pointermove' && !event.buttons && view.action?.type !== 'ink') return;
				if (type === 'pointerrawupdate' && (event.pointerType !== 'pen' || !event.buttons && view.action?.type !== 'ink')) return;
				let entry = sample(event);
				let movement = type === 'pointermove' || type === 'pointerrawupdate';
				entry.dispatchDelayMs = win.performance.now() - event.timeStamp;
				if (type === 'pointerdown') {
					entry.target = {
						inViewer: !!event.target.closest?.('#viewerContainer'),
						inPage: !!event.target.closest?.('.page')
					};
				}
				// The view's pointerdown capture listener runs before this listener;
				// this is a capture-phase snapshot, not always a pre-handler state.
				entry.captureState = actionState(!movement);
				entries.set(event, entry);
				let coalesced = event.getCoalescedEvents?.() || [];
				entry.coalesced = coalesced.slice(0, 16).map(sample);
				entry.coalescedCount = coalesced.length;
				append(entry);
			}, true);
			// The view's bubble handlers were registered before this listener.
			// Capture the result before a subsequent contact can change it.
			win.addEventListener(type, (event) => {
				let entry = entries.get(event);
				if (!entry) return;
				entry.after = actionState(type !== 'pointermove' && type !== 'pointerrawupdate');
				entry.handlerDurationMs = win.performance.now() - event.timeStamp - entry.dispatchDelayMs;
			});
		}
		win.addEventListener('error', (event) => {
			append({ type: 'input-error', time: event.timeStamp,
				message: String(event.message), captureState: actionState() });
		});
	}
	let writing = false;
	let traces = new Map();
	let writeTrace = async () => {
		if (writing) return;
		writing = true;
		try {
			// Serializing the trace is synchronous in the reader window. Wait for
			// a pause so diagnostics themselves do not stall fast handwriting.
			let busy = false;
			for (let reader of Zotero.Reader._readers) {
				if (reader.type !== 'pdf' || !reader._internalReader?._primaryView?.initializedPromise) continue;
				await reader._internalReader._primaryView.initializedPromise;
				reader._iframeWindow.wrappedJSObject.eval(`(${install.toString()})()`);
				let readerBusy = reader._iframeWindow.wrappedJSObject.eval(`(() => {
					let view = window._reader._primaryView;
					let win = view._iframeWindow;
					return view.action?.type === 'ink'
						|| win.performance.now() - (win.__penLastInputTime || 0) < 500;
				})()`);
				busy ||= readerBusy;
			}
			if (busy) return;
			for (let reader of Zotero.Reader._readers) {
				if (reader.type !== 'pdf' || !reader._internalReader?._primaryView?.initializedPromise) continue;
				await reader._internalReader._primaryView.initializedPromise;
				let events = JSON.parse(reader._iframeWindow.wrappedJSObject.eval('JSON.stringify(window._reader._primaryView._iframeWindow.__penInputTrace)'));
				let capabilities = JSON.parse(reader._iframeWindow.wrappedJSObject.eval('JSON.stringify(window._reader._primaryView._iframeWindow.__penInputCapabilities)'));
				traces.set(reader, { capabilities, events });
				if (traces.size > 16) traces.delete(traces.keys().next().value);
			}
			let inputPreferences = {};
			for (let name of ['dom.w3c_pointer_events.scroll_by_pen.enabled', 'dom.w3c_pointer_events.dispatch_by_pointer_messages']) {
				inputPreferences[name] = Services.prefs.getBoolPref(name);
			}
			for (let name of ['apz.touch_move_tolerance', 'apz.touch_start_tolerance']) {
				inputPreferences[name] = Services.prefs.getStringPref(name);
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
