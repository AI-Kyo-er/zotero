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
	check('restart uses the isolated data directory', Zotero.DataDirectory.dir === config.dataDir, Zotero.DataDirectory.dir);
	let fixture = await IOUtils.readJSON(PathUtils.join(config.root, 'work', 'ink-persistence-fixture.json'));
	check('restart fixture belongs to the isolated data directory', fixture.dataDir === config.dataDir, fixture.dataDir);
	let reader = await Zotero.Reader.open(fixture.attachmentID);
	// Selecting a restored, unloaded tab returns before its reader is created.
	for (let attempt = 0; !reader && attempt < 100; attempt++) {
		await Zotero.Promise.delay(100);
		reader = Zotero.Reader._readers.find(candidate => candidate.itemID === fixture.attachmentID && !candidate._isTabClosed);
	}
	check('the PDF reader is restored after restart', !!reader);
	await reader._initPromise;
	for (let [key, value] of Object.entries(fixture.settings)) {
		let pref = 'reader.ink' + key[0].toUpperCase() + key.slice(1);
		check('a fresh process retains the saved ink ' + key,
			String(Zotero.Prefs.get(pref)) === String(value), Zotero.Prefs.get(pref));
		check('a reader after restart uses the saved ink ' + key,
			reader._internalReader._tools.ink[key] === value, reader._internalReader._tools.ink[key]);
	}
	Zotero.__penTestResult = { status: 'passed', results };
})().catch((error) => {
	Zotero.__penTestResult = { status: 'failed', error: String(error), stack: error.stack };
});
// eslint-disable-next-line no-unused-expressions -- Return a status message to the debugger evaluation.
'Runtime ink persistence restart tests started';
