interface Deferred {
	resolve: () => void;
	reject: (error: unknown) => void;
}

export interface SaveTimerApi {
	setTimeout(callback: () => void, delay: number): unknown;
	clearTimeout(handle: unknown): void;
}

export async function reportSaveFailure(
	save: Promise<void>,
	report: () => void,
): Promise<void> {
	try {
		await save;
	} catch (error) {
		report();
		throw error;
	}
}

/**
 * Coalesces nearby requests and guarantees that the writer never runs concurrently.
 * Each request settles with the write that includes its batch.
 */
export class SaveCoordinator {
	private pending: Deferred[] = [];
	private timer: { handle: unknown } | null = null;
	private writing = false;
	private flushAfterWrite = false;
	private idleWaiters: (() => void)[] = [];

	constructor(
		private readonly writer: () => Promise<void>,
		private readonly debounceMs: number,
		private readonly timers: SaveTimerApi,
	) {}

	request(): Promise<void> {
		const promise = new Promise<void>((resolve, reject) => {
			this.pending.push({ resolve, reject });
		});
		if (!this.writing) {
			this.schedule();
		}
		return promise;
	}

	async flush(): Promise<void> {
		if (this.timer !== null) {
			this.timers.clearTimeout(this.timer.handle);
			this.timer = null;
		}
		if (this.writing) {
			if (this.pending.length > 0) {
				this.flushAfterWrite = true;
			}
			await this.waitUntilIdle();
			return;
		}
		if (this.pending.length > 0) {
			this.startWrite();
		}
		await this.waitUntilIdle();
	}

	private schedule(): void {
		if (this.timer !== null || this.pending.length === 0) {
			return;
		}
		const handle = this.timers.setTimeout(() => {
			this.timer = null;
			this.startWrite();
		}, this.debounceMs);
		this.timer = { handle };
	}

	private startWrite(): void {
		if (this.writing || this.pending.length === 0) {
			return;
		}
		const batch = this.pending;
		this.pending = [];
		this.writing = true;
		void this.runWrite(batch);
	}

	private async runWrite(batch: Deferred[]): Promise<void> {
		try {
			await this.writer();
			for (const deferred of batch) {
				deferred.resolve();
			}
		} catch (error) {
			for (const deferred of batch) {
				deferred.reject(error);
			}
		} finally {
			this.writing = false;
			if (this.pending.length > 0) {
				if (this.flushAfterWrite) {
					this.flushAfterWrite = false;
					this.startWrite();
				} else {
					this.schedule();
				}
			} else {
				this.flushAfterWrite = false;
				this.resolveIdleWaiters();
			}
		}
	}

	private async waitUntilIdle(): Promise<void> {
		if (!this.writing && this.pending.length === 0 && this.timer === null) {
			return;
		}
		await new Promise<void>((resolve) => {
			this.idleWaiters.push(resolve);
		});
	}

	private resolveIdleWaiters(): void {
		if (this.writing || this.pending.length > 0 || this.timer !== null) {
			return;
		}
		const waiters = this.idleWaiters;
		this.idleWaiters = [];
		for (const resolve of waiters) {
			resolve();
		}
	}
}
