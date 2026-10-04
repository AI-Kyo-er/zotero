import fs from 'node:fs';
import process from 'node:process';

let input = process.argv[2] || 'work/pen-input-events.json';
let trace = JSON.parse(fs.readFileSync(input, 'utf8'));
let summaries = trace.readers.map(({ events }) => {
	let pending = new Map();
	let contacts = [];
	let markers = [];
	let anomalies = [];
	let distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
	for (let event of events) {
		if (event.type === 'missed-stroke-marker') {
			markers.push({ time: event.time, state: event.captureState,
				precedingContacts: contacts.slice(-5) });
			continue;
		}
		if (event.type === 'input-error') {
			anomalies.push(event);
			continue;
		}
		if (event.pointerType !== 'pen') continue;
		if (event.type === 'pointerdown') {
			if (pending.has(event.pointerId)) {
				anomalies.push({ type: 'second-down-without-up', time: event.time });
			}
			pending.set(event.pointerId, { down: event, moves: [] });
			if (event.after && event.after.tool === 'ink' && event.after.action !== 'ink') {
				anomalies.push({ type: 'down-without-ink-action', time: event.time,
					state: event.after });
			}
		}
		else if (event.type === 'pointermove' && pending.has(event.pointerId)) {
			pending.get(event.pointerId).moves.push(event);
		}
		else if (['pointerup', 'pointercancel'].includes(event.type)
				&& pending.has(event.pointerId)) {
			let { down, moves } = pending.get(event.pointerId);
			pending.delete(event.pointerId);
			// Legacy "before" was recorded after the view's down handler.
			// Only up's captureState can measure the save handler's path delta.
			let countBefore = event.captureState?.savedInkPaths;
			let countAfter = event.after?.savedInkPaths;
			contacts.push({
				downTime: down.time, upTime: event.time, pointerId: event.pointerId,
				pressureEnabled: down.after?.pressureEnabled,
				durationMs: event.time - down.time, moves: moves.length,
				endpointDeltaPx: distance(down, event),
				firstMoveDelayMs: moves.length ? moves[0].time - down.time : null,
				firstMoveDeltaPx: moves.length ? distance(down, moves[0]) : null,
				savedPathDelta: Number.isFinite(countBefore) && Number.isFinite(countAfter)
					? countAfter - countBefore
					: null,
				actionAfterUp: event.after?.action,
				endedBy: event.type
			});
		}
	}
	let median = (values) => {
		if (!values.length) return null;
		values.sort((a, b) => a - b);
		let middle = Math.floor(values.length / 2);
		return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
	};
	return {
		eventCount: events.length, completeContacts: contacts.length,
		noMoveContacts: contacts.filter(contact => !contact.moves).length,
		medianFirstMoveDelayMs: median(contacts.map(contact => contact.firstMoveDelayMs)
			.filter(value => value !== null)),
		medianFirstMoveDeltaPx: median(contacts.map(contact => contact.firstMoveDeltaPx)
			.filter(value => value !== null)),
		contactsWithSaveCounts: contacts.filter(contact => contact.savedPathDelta !== null).length,
		contactsWithoutNewSavedPath: contacts.filter(contact => contact.savedPathDelta === 0),
		unfinishedContacts: [...pending.values()].map(({ down }) => ({ time: down.time, pointerId: down.pointerId })),
		markers, anomalies, contacts
	};
});
let result = { version: trace.version, capturedAt: trace.capturedAt,
	inputPreferences: trace.inputPreferences, readers: summaries };
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, readers: summaries.map(({ contacts: _contacts, ...summary }) => summary) }, null, 2));
