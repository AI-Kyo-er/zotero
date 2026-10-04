import fs from 'node:fs';
import process from 'node:process';

let trace = JSON.parse(fs.readFileSync(process.argv[2] || 'work/pen-input-events.json', 'utf8'));
let summary = {
	capturedAt: trace.capturedAt,
	version: trace.version,
	inputPreferences: trace.inputPreferences || null,
	trustedEvents: 0,
	inkContacts: 0,
	repeatedStarts: []
};
for (let [readerIndex, reader] of trace.readers.entries()) {
	let previousDown;
	let hover;
	let released = false;
	for (let event of reader.events) {
		if (!event.trusted) continue;
		summary.trustedEvents++;
		if (event.pointerType !== 'pen') continue;
		if (event.type === 'pointerup' && event.pointerId === previousDown?.pointerId) released = true;
		if (event.type === 'pointermove' && event.buttons === 0 && event.pressure === 0) hover = event;
		if (event.type !== 'pointerdown' || event.after?.action !== 'ink') continue;
		summary.inkContacts++;
		let interval = event.time - previousDown?.time;
		let hoverAge = event.time - hover?.time;
		// A repeated point alone can be intentional. Report only the observed
		// signature: distinct recent hover after release, followed by an exact
		// repeat of the preceding contact's down point.
		if (released && event.pointerId === previousDown?.pointerId
			&& event.x === previousDown.x && event.y === previousDown.y
			&& interval > 0 && interval <= 250
			&& hover?.pointerId === event.pointerId && hover.time > previousDown.time
			&& hoverAge >= 0 && hoverAge <= 64
			&& Math.hypot(hover.x - event.x, hover.y - event.y) >= 2) {
			summary.repeatedStarts.push({
				reader: readerIndex, time: event.time, interval,
				down: [event.x, event.y], hover: [hover.x, hover.y], hoverAge
			});
		}
		previousDown = event;
		released = false;
		hover = undefined;
	}
}
summary.repeatedStartCount = summary.repeatedStarts.length;
console.log(JSON.stringify(summary, null, 2));
