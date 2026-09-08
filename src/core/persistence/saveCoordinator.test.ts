import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportSaveFailure, SaveCoordinator } from './saveCoordinator.ts';

const timers = {
	setTimeout: (callback: () => void, delay: number): ReturnType<typeof setTimeout> =>
		setTimeout(callback, delay),
	clearTimeout: (handle: unknown): void =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};

test('rapid save requests coalesce and all promises settle', async () => {
	let writes = 0;
	const coordinator = new SaveCoordinator(async () => {
		writes++;
	}, 10, timers);

	const requests = [
		coordinator.request(),
		coordinator.request(),
		coordinator.request(),
	];
	await Promise.all(requests);

	assert.equal(writes, 1);
});

test('save writes are serialized when requested during a write', async () => {
	let activeWrites = 0;
	let maxActiveWrites = 0;
	let releaseFirst: (() => void) | undefined;
	let writes = 0;
	const coordinator = new SaveCoordinator(async () => {
		writes++;
		activeWrites++;
		maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
		if (writes === 1) {
			await new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
		}
		activeWrites--;
	}, 0, timers);

	const first = coordinator.request();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const second = coordinator.request();
	releaseFirst?.();
	await Promise.all([first, second]);

	assert.equal(writes, 2);
	assert.equal(maxActiveWrites, 1);
});

test('coalesced request promises reject with the write failure', async () => {
	const coordinator = new SaveCoordinator(
		async () => {
			throw new Error('save failed');
		},
		0,
		timers,
	);

	const first = coordinator.request();
	const second = coordinator.request();
	await assert.rejects(first, /save failed/);
	await assert.rejects(second, /save failed/);
});

test('save failure is reported while preserving rejection', async () => {
	const error = new Error('save failed');
	let reports = 0;
	const observed = reportSaveFailure(
		Promise.reject(error),
		() => {
			reports++;
		},
	);

	await assert.rejects(observed, (actual) => actual === error);
	assert.equal(reports, 1);
});

test('flush forces a request queued behind an active write', async () => {
	let writes = 0;
	let releaseFirst: (() => void) | undefined;
	const coordinator = new SaveCoordinator(async () => {
		writes++;
		if (writes === 1) {
			await new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
		}
	}, 0, timers);

	const first = coordinator.request();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	const latest = coordinator.request();
	const flushed = coordinator.flush();
	releaseFirst?.();

	await Promise.all([first, latest, flushed]);
	assert.equal(writes, 2);
});
