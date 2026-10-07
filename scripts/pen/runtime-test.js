Zotero.__penTestResult = { status: 'running' };
(async () => {
	await Zotero.initializationPromise;
	await Zotero.uiReadyPromise;
	let config = Zotero.__penTestConfig;
	let results = [];
	function check(name, condition, detail) {
		results.push({ name, passed: !!condition, detail });
		if (!condition) throw new Error(name + ': ' + JSON.stringify(detail));
	}
	check('isolated data directory', Zotero.DataDirectory.dir === config.dataDir, Zotero.DataDirectory.dir);
	await Zotero.Libraries.get(Zotero.Libraries.userLibraryID).waitForDataLoad('item');
	Zotero.Prefs.set('reader.inkSize', String(config.inkSize));
	Zotero.Prefs.set('reader.inkColor', '#2ea8e5');
	Zotero.Prefs.set('reader.inkSmoothing', true);
	Zotero.Prefs.set('reader.inkPressure', false);
	let penScroll = Services.prefs.getBoolPref('dom.w3c_pointer_events.scroll_by_pen.enabled');
	check('platform pen input behavior is preserved', penScroll === true, penScroll);
	if (config.fineInput) {
		let moveTolerance = Number(Services.prefs.getStringPref('apz.touch_move_tolerance'));
		let startTolerance = Number(Services.prefs.getStringPref('apz.touch_start_tolerance'));
		check('native fine input disables the content-move threshold', moveTolerance === 0, moveTolerance);
		check('native fine input preserves the scrolling gesture threshold', startTolerance === 0.1, startTolerance);
	}
	let attachment = await Zotero.Attachments.importFromFile({ file: PathUtils.join(config.root, 'test', 'tests', 'data', 'test.pdf') });
	let reader = await Zotero.Reader.open(attachment.id);
	await reader._initPromise;
	let internal = reader._internalReader;
	check('configured default ink width is applied to a new reader', internal._tools.ink.size === config.inkSize, internal._tools.ink.size);
	let view = internal._primaryView;
	await view.initializedPromise;
	await Zotero.Promise.delay(1000);
	await Zotero.__penRecordFlush?.();
	let result = reader._iframeWindow.wrappedJSObject.eval(`(() => {
		let reader = window._reader;
		let view = reader._primaryView;
		let win = view._iframeWindow;
		let page = win.PDFViewerApplication.pdfViewer._pages[0];
		let rect = page.div.getBoundingClientRect();
		let target = page.div.querySelector('.textLayer') || page.div;
		let x = rect.left + 80, y = rect.top + 100;
		let results = [];
		function event(type, dx, dy, id = 7, pressure = 0.5) {
			return new win.PointerEvent(type, { bubbles: true, pointerType: 'pen', pointerId: id, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y + dy, pressure });
		}
		function send(type, dx, dy, id, pressure) { target.dispatchEvent(event(type, dx, dy, id, pressure)); }
		function check(name, condition, detail) {
			results.push({ name, passed: !!condition, detail });
			if (!condition) throw new Error(name + ': ' + JSON.stringify(detail));
		}
		reader.setTool({ type: 'ink', smoothing: false, pressure: false });
		let originalOverlayPage = view._pages[0];
		let benchmarkDiv = win.document.createElement('div');
		benchmarkDiv.style.cssText = 'position:absolute;left:-100000px;visibility:hidden;pointer-events:none';
		win.document.body.append(benchmarkDiv);
		let benchmarkPage = new originalOverlayPage.constructor(view, { id: 1, div: benchmarkDiv, viewport: page.viewport });
		let overlayTimings = [];
		let createdVectors = 0;
		let createVector = benchmarkPage._createVectorElement.bind(benchmarkPage);
		benchmarkPage._createVectorElement = (...args) => {
			createdVectors++;
			return createVector(...args);
		};
		try {
			let saved = Array.from({ length: 3500 }, (_, i) => ({ kind: 'path',
				d: 'M ' + i % 500 + ' ' + i % 400 + ' l 1 2 l 3 4 l 5 6',
				stroke: '#000000', strokeWidth: 1, cap: 'round', join: 'round' }));
			benchmarkPage._applyDisplayList(saved);
			let firstSavedNode = benchmarkDiv.querySelector('path');
			for (let frame = 0; frame < 10; frame++) {
				let start = win.performance.now();
				benchmarkPage._applyDisplayList([...saved, { kind: 'path', d: 'M 0 0 L ' + frame + ' 20', stroke: '#000000', strokeWidth: 1 }]);
				overlayTimings.push(win.performance.now() - start);
			}
			check('ink updates preserve existing overlay nodes on a heavily annotated page', benchmarkDiv.querySelector('path') === firstSavedNode);
			check('ten ink frames create only the ten changing vector nodes', createdVectors === 3510, createdVectors);
			let rectItem = { kind: 'rect', rect: [0, 0, 10, 20], color: '#ffff00', opacity: 0.4, blend: 'multiply' };
			let pathItem = saved[0];
			let circleItem = { kind: 'circle', cx: 10, cy: 10, r: 3, fill: '#000000' };
			benchmarkPage._applyDisplayList([rectItem, pathItem, rectItem, circleItem]);
			let overlay = benchmarkDiv.querySelector('.annotationOverlay');
			let oldRect = overlay.firstChild;
			let oldPath = overlay.querySelector('path');
			benchmarkPage._applyDisplayList([rectItem, pathItem, circleItem]);
			check('mixed rect and vector paint order survives removing a middle rect',
				overlay.children.length === 2 && overlay.lastChild.children.length === 2
					&& overlay.firstChild === oldRect && overlay.querySelector('path') === oldPath);
			benchmarkPage._applyDisplayList([{ ...rectItem, blend: undefined, color: '#ff0000' }, pathItem]);
			check('changed overlay style removes obsolete blending and vector nodes',
				overlay.firstChild.style.mixBlendMode === '' && !overlay.querySelector('circle')
					&& overlay.querySelector('path') === oldPath);
			let oldSVG = overlay.lastChild;
			let oldViewport = benchmarkPage._originalPage.viewport;
			benchmarkPage._originalPage.viewport = { ...oldViewport, width: oldViewport.width * 2, height: oldViewport.height * 2 };
			benchmarkPage._applyDisplayList([{ ...rectItem, blend: undefined, color: '#ff0000' }, pathItem]);
			check('overlay reuse updates the SVG view box after zoom', oldSVG.getAttribute('viewBox') === '0 0 ' + oldViewport.width * 2 + ' ' + oldViewport.height * 2);
			benchmarkPage._applyDisplayList([]);
			check('removing all annotations removes the overlay', !benchmarkDiv.querySelector('.annotationOverlay'));
			benchmarkPage._applyDisplayList([pathItem]);
			check('a removed overlay is rebuilt with its vector geometry', benchmarkDiv.querySelector('path').getAttribute('d') === pathItem.d);
		}
		finally { benchmarkDiv.remove(); }
		check('overlay benchmark completed for a page with 3500 saved paths', overlayTimings.length === 10, overlayTimings);
		let viewerContainer = win.document.getElementById('viewerContainer');
		check('ink declares the page as a drawing surface before contact', win.getComputedStyle(page.div).touchAction === 'none', win.getComputedStyle(page.div).touchAction);
		check('ink leaves the surrounding viewer available for native scrolling', win.getComputedStyle(viewerContainer).touchAction === 'auto', win.getComputedStyle(viewerContainer).touchAction);
		reader.setTool({ type: 'pointer' });
		check('leaving ink restores the page pan behavior', win.getComputedStyle(page.div).touchAction === 'auto', win.getComputedStyle(page.div).touchAction);
		reader.setTool({ type: 'ink', smoothing: false, pressure: false });
		let expectedStart = (dx, dy) => page.viewport.convertToPdfPoint(x + dx + page.div.scrollLeft - rect.left, y + dy + page.div.scrollTop - rect.top);
		let near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 0.001);
		send('pointerdown', 0, 0);
		send('pointerup', 2, 2);
		send('pointerdown', 12, 0);
		check('rapid pen contacts start at their own coordinates', near(view.action.annotation.position.paths[0].slice(0, 2), expectedStart(12, 0)), view.action.annotation.position.paths);
		send('pointerup', 14, 2);
		let last = reader._state.annotations.filter(a => a.type === 'ink').at(-1);
		check('merged annotations retain separate stroke origins', near(last.position.paths.at(-1).slice(0, 2), expectedStart(12, 0)), last.position.paths);
		view._lastAddedInkAnnotationID = null;
		let mouseDown = new win.PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1, clientX: x + 48, clientY: y });
		target.dispatchEvent(mouseDown);
		let compatibilityDown = new win.MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: x + 48, clientY: y, detail: 1 });
		target.dispatchEvent(compatibilityDown);
		// MouseEvent coordinates are integers, while PointerEvent accepts fractions.
		check('mouse ink preserves the original compatibility event flow', !!view.action && near(view.action.annotation.position.paths[0].slice(0, 2), expectedStart(compatibilityDown.clientX - x, compatibilityDown.clientY - y)), view.action?.annotation?.position);
		target.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', pointerId: 1, button: 0, buttons: 0, clientX: x + 50, clientY: y + 2 }));
		view._lastAddedInkAnnotationID = null;
		send('pointerdown', 0, 0);
		send('pointerup', 0.1, 0.1);
		let annotation = reader._state.annotations.filter(a => a.type === 'ink').at(-1);
		check('fast down/up persists a segment', annotation?.position.paths[0].length >= 4, annotation?.position);
		view._lastAddedInkAnnotationID = null;
		send('pointerdown', 20, 0);
		send('pointerup', 20, 0);
		annotation = reader._state.annotations.filter(a => a.type === 'ink').at(-1);
		check('pen tap persists a drawable dot', annotation?.position.paths[0].length === 4, annotation?.position);
		view._lastAddedInkAnnotationID = null;
		send('pointerdown', 40, 0);
		let move = event('pointermove', 46, 5);
		Object.defineProperty(move, 'getCoalescedEvents', { value: () => [event('pointermove', 42, 2), event('pointermove', 44, 4)] });
		target.dispatchEvent(move);
		let path = view.action.annotation.position.paths[0];
		let sampleCount = path.length;
		check('all coalesced samples reach the active stroke', path.length === 10, path);
		view._handleOtherPointerMove(event('pointermove', 200, 200));
		check('queued hover cannot contaminate active ink', path.length === sampleCount, path.length);
		send('pointerup', 80, 20, 8);
		check('unrelated pointerup does not interrupt ink', view.action?.pointerId === 7, view.action?.pointerId);
		send('pointerup', 48, 6);
		annotation = reader._state.annotations.filter(a => a.type === 'ink').at(-1);
		check('unsmoothed coordinates are preserved', annotation?.position.paths[0].length === 12, annotation?.position.paths);
		view._lastAddedInkAnnotationID = null;
		send('pointerdown', 60, 0);
		send('pointermove', 65, 5);
		send('pointercancel', 0, 0);
		check('cancelled pen stream saves collected ink and resets the tool', !view.action && !view._pointerDownTriggered, view.action?.type);
		view._lastAddedInkAnnotationID = null;
		reader.setTool({ type: 'ink', smoothing: true });
		send('pointerdown', 80, 0);
		send('pointerup', 80.1, 0.1);
		annotation = reader._state.annotations.filter(a => a.type === 'ink').at(-1);
		check('smoothed sub-point stroke stays drawable', annotation?.position.paths[0].length >= 4, annotation?.position);
		view._lastAddedInkAnnotationID = null;
		send('pointerdown', 100, 0);
		send('pointermove', 105, 5);
		send('lostpointercapture', 0, 0);
		check('lost capture saves the last sample and releases the action', !view.action && !view._pointerDownTriggered, view.action?.type);
		reader.setTool({ type: 'ink', smoothing: false, pressure: true });
		send('pointerdown', 0, 30, 7, 0.05);
		send('pointermove', 40, 30, 7, 1);
		send('pointerup', 80, 30, 7, 0);
		let pressureAnnotations = reader._state.annotations.filter(a => a.type === 'ink' && a.position.paths.some(p => p[1] < annotation.position.paths[0][1] - 10));
		check('pressure creates multiple persistent native widths', new Set(pressureAnnotations.map(a => a.position.width)).size > 1, pressureAnnotations.map(a => a.position.width));
		check('pressure stores only standard position keys', pressureAnnotations.every(a => Object.keys(a.position).every(key => ['pageIndex', 'width', 'paths'].includes(key))), pressureAnnotations.map(a => Object.keys(a.position)));
		let overlayPaths = page.div.querySelectorAll('.annotationOverlay path');
		check('ink has a rendered SVG overlay', overlayPaths.length > 0, overlayPaths.length);
		return JSON.stringify(results);
	})()`);
	results.push(...JSON.parse(result));
	await Zotero.__penRecordFlush?.();
	Zotero.Prefs.set('reader.inkSmoothing', true);
	check('smoothing preference observer updates the active reader', internal._tools.ink.smoothing === true, internal._tools.ink.smoothing);
	Zotero.Prefs.set('reader.inkPressure', false);
	check('pressure preference observer updates the active reader', internal._tools.ink.pressure === false, internal._tools.ink.pressure);
	internal._annotationManager._skipAnnotationSavingDebounce = true;
	await internal._annotationManager._triggerSaving();
	await Zotero.Promise.delay(1500);
	let annotations = attachment.getAnnotations();
	check('ink reaches the Zotero database', annotations.length >= 6, annotations.length);
	let exportPath = PathUtils.join(Zotero.DataDirectory.dir, 'pen-export.pdf');
	let exported = await Zotero.PDFWorker.export(attachment.id, exportPath, true);
	check('PDF export writes every ink annotation', exported === annotations.length, exported);
	reader.close();
	await Zotero.Promise.delay(500);
	reader = await Zotero.Reader.open(attachment.id);
	await reader._initPromise;
	await reader._internalReader._primaryView.initializedPromise;
	let reopened = reader._internalReader._state.annotations.filter(a => a.type === 'ink');
	check('reopening preserves all ink annotations', reopened.length === annotations.length, reopened.length);
	let exportedAttachment = await Zotero.Attachments.importFromFile({ file: exportPath });
	let exportReader = await Zotero.Reader.open(exportedAttachment.id);
	await exportReader._initPromise;
	await exportReader._internalReader._primaryView.initializedPromise;
	let pdfAnnotations = JSON.parse(await exportReader._iframeWindow.wrappedJSObject.eval(`window._reader._primaryView._iframeWindow.PDFViewerApplication.pdfDocument.getPage(1).then(page => page.getAnnotations()).then(annotations => JSON.stringify(annotations))`));
	let exportedInk = pdfAnnotations.filter(annotation => annotation.subtype === 'Ink');
	check('exported PDF contains standard Ink objects', exportedInk.length === annotations.length, exportedInk.length);
	let priorInk = JSON.stringify(reader._internalReader._state.annotations.filter(annotation => annotation.type === 'ink'));
	let settings = { color: '#000000', size: 3.5, smoothing: false, pressure: true };
	function selectInk(target, settings = {}) {
		target._internalReader.setTool(Cu.cloneInto({ type: 'ink', ...settings }, target._iframeWindow));
	}
	selectInk(reader, settings);
	for (let [key, value] of Object.entries(settings)) {
		let stored = Zotero.Prefs.get('reader.ink' + key[0].toUpperCase() + key.slice(1));
		check('toolbar saves the last ink ' + key, String(stored) === String(value), stored);
		check('an already open PDF receives the last ink ' + key,
			exportReader._internalReader._tools.ink[key] === value, exportReader._internalReader._tools.ink[key]);
	}
	selectInk(exportReader);
	let newAttachment = await Zotero.Attachments.importFromFile({ file: PathUtils.join(config.root, 'test', 'tests', 'data', 'test.pdf') });
	let newReader = await Zotero.Reader.open(newAttachment.id);
	await newReader._initPromise;
	await newReader._internalReader._primaryView.initializedPromise;
	for (let [key, value] of Object.entries(settings)) {
		check('a different PDF opens with the last ink ' + key,
			newReader._internalReader._tools.ink[key] === value, newReader._internalReader._tools.ink[key]);
	}
	selectInk(newReader, { color: '#5fb236', size: 1.5, smoothing: true, pressure: false });
	for (let [key, value] of Object.entries({ color: '#5fb236', size: 1.5, smoothing: true, pressure: false })) {
		check('the active ink tool in an older PDF receives ' + key,
			exportReader._internalReader._state.tool[key] === value, exportReader._internalReader._state.tool[key]);
	}
	check('changing brush defaults preserves existing ink annotations',
		JSON.stringify(reader._internalReader._state.annotations.filter(annotation => annotation.type === 'ink')) === priorInk);
	check('ink color changes do not change the highlighter color',
		reader._internalReader._tools.highlight.color === '#ffd400', reader._internalReader._tools.highlight.color);
	selectInk(newReader, settings);
	await IOUtils.writeJSON(PathUtils.join(config.root, 'work', 'ink-persistence-fixture.json'),
		{ dataDir: config.dataDir, attachmentID: newAttachment.id, settings });
	Zotero.__penTestAttachmentID = attachment.id;
	Zotero.__penTestResult = { status: 'passed', results, attachmentID: attachment.id, annotationCount: annotations.length, exportPath };
})().catch((error) => {
	Zotero.__penTestResult = { status: 'failed', error: String(error), stack: error.stack };
});
// eslint-disable-next-line no-unused-expressions -- Return a status message to the debugger evaluation.
'Runtime ink tests started';
